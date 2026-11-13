import express from 'express';
import crypto from 'node:crypto';
import { sendEmail, emailConfigured } from './email.js';
import { tx } from './db.js';
import { config } from './config.js';
import { hashPassword, verifyPassword, createSession, destroySession, sessionUser, rateLimiter } from './auth.js';
import { localToUtcIso, utcToLocalInput, slotOf } from './time.js';
import { CATEGORIES, TEMPLATES, LANGUAGES, BUDGETS, REPORT_REASONS, categoryPhrase, slotLabel } from '../shared/catalog.js';

export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new HttpError(status, code, message); };

const J = (s, d = []) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const now = () => new Date().toISOString();
const str = (v, max, field, { required = false } = {}) => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) fail(400, 'invalid', `${field} is required.`);
  if (s.length > max) fail(400, 'invalid', `${field} must be at most ${max} characters.`);
  return s;
};
const list = (v, allowed, max = 12) => {
  const arr = Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  return [...new Set(allowed ? arr.filter((x) => allowed.includes(x)) : arr.map((x) => x.trim().slice(0, 40)).filter(Boolean))].slice(0, max);
};
const CAT_KEYS = CATEGORIES.map((c) => c.key);
const SLOT_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].flatMap((d) => ['morning', 'afternoon', 'evening'].map((p) => `${d}_${p}`));

export function createApi(db) {
  const r = express.Router();
  // Express 4 does not forward errors from async handlers, so wrap every handler.
  for (const m of ['get', 'post', 'put', 'delete']) {
    const orig = r[m].bind(r);
    r[m] = (path, ...hs) => orig(path, ...hs.map((h) => (req, res, next) => {
      try { const p = h(req, res, next); if (p && typeof p.catch === 'function') p.catch(next); } catch (e) { next(e); }
    }));
  }
  const authLimit = rateLimiter(Number(process.env.AUTH_RATE_LIMIT || 100), 10 * 60e3); // per IP; generous because classmates may share one campus IP
  const msgLimit = rateLimiter(30, 60e3);
  const verifyLimit = rateLimiter(5, 60 * 60e3);

  // ---------- email verification ----------
  const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
  const origin = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  async function startVerification(req, uid, email) {
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare('DELETE FROM email_tokens WHERE user_id = ?').run(uid);
    db.prepare('INSERT INTO email_tokens (token_hash, user_id, email, expires_at) VALUES (?,?,?,?)')
      .run(sha(token), uid, email, new Date(Date.now() + 48 * 3600e3).toISOString());
    const link = `${origin(req)}/api/auth/verify?token=${token}`;
    return sendEmail({
      to: email,
      subject: `Confirm your email for ${config.appName}`,
      text: `Hi!\n\nTo confirm that this email address belongs to you, open this link within 48 hours:\n${link}\n\nThis only confirms your email address. It does not verify student status.\nIf you did not sign up for ${config.appName}, ignore this email.`,
    }).catch((e) => { console.error(e); return { sent: false, error: true }; });
  }

  // ---------- helpers ----------
  const cityById = (id) => db.prepare('SELECT * FROM cities WHERE id = ?').get(id);
  const cityBySlug = (slug) => db.prepare('SELECT * FROM cities WHERE slug = ?').get(slug || config.defaultCity);
  const profileOf = (uid) => db.prepare('SELECT p.*, u.is_demo, u.email_verified_at FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?').get(uid);

  /** Users I blocked or who blocked me. Hidden from each other everywhere. */
  const blockedSet = (uid) => new Set(
    db.prepare('SELECT blocked_id AS id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?')
      .all(uid, uid).map((x) => x.id)
  );

  const personSummary = (p) => p && ({
    id: p.user_id, first_name: p.first_name || 'Someone', is_demo: !!p.is_demo, avatar_hue: p.avatar_hue,
    languages: J(p.languages), role: p.role,
  });

  const publicProfile = (p) => p && ({
    ...personSummary(p),
    intro: p.intro, interests: J(p.interests),
    university: p.show_university ? p.university : null,
    exchange_start: p.exchange_start, exchange_end: p.exchange_end,
    area: p.area,
    email_verified: !!p.email_verified_at, // means: confirmed they can receive email at their sign-up address. Nothing more.
  });

  const goingCount = (aid) => 1 + db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE activity_id = ? AND status = 'accepted'").get(aid).n;
  const isPast = (a) => new Date(a.starts_at).getTime() + a.duration_min * 60e3 < Date.now();
  const membershipOf = (aid, uid) => db.prepare('SELECT * FROM memberships WHERE activity_id = ? AND user_id = ?').get(aid, uid);
  const getActivity = (id) => db.prepare('SELECT * FROM activities WHERE id = ?').get(Number(id)) || fail(404, 'not_found', 'This activity no longer exists.');
  const systemMsg = (aid, body) => db.prepare("INSERT INTO messages (activity_id, kind, body) VALUES (?, 'system', ?)").run(aid, body);
  const nameOf = (uid) => profileOf(uid)?.first_name || 'Someone';

  // ---------- notifications ----------
  const notify = (uid, kind, aid, actorId = null, detail = '') => {
    if (!uid || uid === actorId) return;
    db.prepare('INSERT INTO notifications (user_id, kind, activity_id, actor_id, detail) VALUES (?,?,?,?,?)').run(uid, kind, aid, actorId, detail);
  };
  const notifyMembers = (aid, statuses, kind, actorId, detail = '') => {
    const ph = statuses.map(() => '?').join(',');
    for (const m of db.prepare(`SELECT user_id FROM memberships WHERE activity_id = ? AND status IN (${ph})`).all(aid, ...statuses)) notify(m.user_id, kind, aid, actorId, detail);
  };
  const unreadChat = (aid, uid) => {
    const last = db.prepare('SELECT last_read_id FROM chat_reads WHERE user_id = ? AND activity_id = ?').get(uid, aid)?.last_read_id || 0;
    return db.prepare("SELECT COUNT(*) AS n FROM messages WHERE activity_id = ? AND id > ? AND kind = 'user' AND user_id != ?").get(aid, last, uid).n;
  };

  function activityView(a, viewerId) {
    const city = cityById(a.city_id);
    const going = goingCount(a.id);
    const m = viewerId ? membershipOf(a.id, viewerId) : null;
    const isOrg = viewerId === a.organiser_id;
    const past = isPast(a);
    const state = a.status === 'cancelled' ? 'cancelled' : past ? 'past' : going >= a.max_participants ? 'full' : 'open';
    const ev = a.event_id ? db.prepare('SELECT id, title, is_sample FROM events WHERE id = ?').get(a.event_id) : null;
    const v = {
      id: a.id, title: a.title, description: a.description, category: a.category, template: a.template,
      starts_at: a.starts_at, duration_min: a.duration_min, timezone: city.timezone, city: city.name,
      starts_local: utcToLocalInput(a.starts_at, city.timezone),
      meeting_area: a.meeting_area, cost_eur: a.cost_eur, max_participants: a.max_participants,
      beginner_friendly: !!a.beginner_friendly, pace: a.pace, transport: a.transport,
      languages: J(a.languages), solo_format: !!a.solo_format, is_sample: !!a.is_sample,
      status: a.status, cancel_reason: a.cancel_reason, state, going, spots_left: Math.max(0, a.max_participants - going),
      organiser: personSummary(profileOf(a.organiser_id)), event: ev,
      my_status: isOrg ? 'organiser' : m?.status || null,
      welcome_plan: a.welcome_plan, recognise_tip: a.recognise_tip,
    };
    if (isOrg || m?.status === 'accepted') v.unread = unreadChat(a.id, viewerId);
    if (isOrg) v.pending_count = db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE activity_id = ? AND status = 'pending'").get(a.id).n;
    return v;
  }

  function canChat(a, uid) {
    if (a.organiser_id === uid) return true;
    return membershipOf(a.id, uid)?.status === 'accepted';
  }

  // ---------- auth middleware ----------
  r.use((req, _res, next) => { req.user = sessionUser(db, req); next(); });
  const auth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'auth', 'Please log in first.')));

  // ---------- meta ----------
  r.get('/meta', (_req, res) => {
    const cities = db.prepare('SELECT slug, name, country, timezone, areas FROM cities').all().map((c) => ({ ...c, areas: J(c.areas) }));
    const personas = config.demoMode
      ? db.prepare("SELECT p.user_id AS id, p.first_name, p.intro, p.avatar_hue FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.is_demo = 1 ORDER BY p.user_id").all()
      : [];
    res.json({ appName: config.appName, demoMode: config.demoMode, cities, personas, categories: CATEGORIES, templates: TEMPLATES, languages: LANGUAGES, budgets: BUDGETS.map(({ key, label }) => ({ key, label })), reportReasons: REPORT_REASONS });
  });

  // ---------- auth ----------
  r.post('/auth/signup', async (req, res) => {
    if (!authLimit(req.ip)) fail(429, 'rate', 'Too many attempts. Please wait a few minutes.');
    const email = str(req.body.email, 200, 'Email', { required: true }).toLowerCase();
    const password = String(req.body.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'invalid', 'Please enter a valid email address.');
    if (email.endsWith('@sample.invalid')) fail(400, 'invalid', 'This address is reserved for sample profiles.');
    if (password.length < 8) fail(400, 'invalid', 'Password must be at least 8 characters.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'exists', 'An account with this email already exists. Try logging in.');
    const city = cityBySlug();
    const uid = tx(db, () => {
      const { lastInsertRowid } = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hashPassword(password));
      db.prepare('INSERT INTO profiles (user_id, city_id, avatar_hue) VALUES (?, ?, ?)').run(lastInsertRowid, city.id, Math.floor(Math.random() * 360));
      return Number(lastInsertRowid);
    });
    createSession(db, res, uid);
    const mail = await startVerification(req, uid, email);
    res.status(201).json({ ok: true, verification_sent: mail.sent });
  });

  r.post('/auth/login', (req, res) => {
    if (!authLimit(req.ip)) fail(429, 'rate', 'Too many attempts. Please wait a few minutes.');
    const email = str(req.body.email, 200, 'Email').toLowerCase();
    const u = db.prepare('SELECT * FROM users WHERE email = ? AND is_demo = 0').get(email);
    if (!u || !verifyPassword(req.body.password || '', u.password_hash)) fail(401, 'credentials', 'Email or password is not correct.');
    createSession(db, res, u.id);
    res.json({ ok: true });
  });

  r.post('/auth/demo', (req, res) => {
    if (!config.demoMode) fail(403, 'demo_off', 'Demo mode is switched off.');
    const u = db.prepare('SELECT id FROM users WHERE id = ? AND is_demo = 1').get(Number(req.body.personaId));
    if (!u) fail(404, 'not_found', 'Sample persona not found.');
    createSession(db, res, u.id);
    res.json({ ok: true });
  });

  r.post('/auth/verify/send', auth, async (req, res) => {
    const u = db.prepare('SELECT email, email_verified_at, is_demo FROM users WHERE id = ?').get(req.user.id);
    if (u.is_demo) fail(403, 'demo', 'Sample personas have no email address.');
    if (u.email_verified_at) return res.json({ ok: true, already: true });
    if (!verifyLimit(String(req.user.id))) fail(429, 'rate', 'Too many emails requested. Please wait an hour.');
    const mail = await startVerification(req, req.user.id, u.email);
    res.json({ ok: true, sent: mail.sent, configured: emailConfigured() });
  });

  // Opened from the email link: confirms the address, then sends the person back into the app.
  r.get('/auth/verify', (req, res) => {
    const row = db.prepare('SELECT * FROM email_tokens WHERE token_hash = ?').get(sha(String(req.query.token || '')));
    const u = row && db.prepare('SELECT email FROM users WHERE id = ?').get(row.user_id);
    if (!row || row.expires_at < now() || !u || u.email !== row.email) return res.redirect('/#/profile?verified=invalid');
    db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(now(), row.user_id);
    db.prepare('DELETE FROM email_tokens WHERE user_id = ?').run(row.user_id);
    res.redirect('/#/profile?verified=1');
  });

  r.post('/auth/logout', (req, res) => { destroySession(db, req, res); res.json({ ok: true }); });

  // ---------- me ----------
  r.get('/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    const p = profileOf(req.user.id);
    const city = cityById(p.city_id);
    const toReview = db.prepare(`SELECT COUNT(*) AS n FROM memberships m JOIN activities a ON a.id = m.activity_id
      WHERE a.organiser_id = ? AND m.status = 'pending' AND a.status = 'active' AND a.starts_at > ?`).get(req.user.id, now()).n;
    const unreadNotifs = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n;
    const chatActs = db.prepare(`SELECT id FROM activities WHERE status = 'active' AND (organiser_id = ? OR id IN
      (SELECT activity_id FROM memberships WHERE user_id = ? AND status = 'accepted'))`).all(req.user.id, req.user.id);
    const unreadChats = chatActs.reduce((n, a) => n + unreadChat(a.id, req.user.id), 0);
    const invites = db.prepare(`SELECT COUNT(*) AS n FROM memberships m JOIN activities a ON a.id = m.activity_id
      WHERE m.user_id = ? AND m.status = 'invited' AND a.status = 'active' AND a.starts_at > ?`).get(req.user.id, now()).n;
    res.json({
      user: {
        id: req.user.id, email: req.user.email, is_demo: req.user.is_demo, email_verified: !!p.email_verified_at, email_service: emailConfigured(), lang: p.lang,
        ...publicProfile(p), university: p.university, show_university: !!p.show_university,
        visible: !!p.visible, nearby_enabled: !!p.nearby_enabled, show_sample: !!p.show_sample, onboarded: !!p.onboarded,
        city: city && { slug: city.slug, name: city.name, timezone: city.timezone },
      },
      counts: { toReview, invites, notifications: unreadNotifs, chats: unreadChats },
    });
  });

  r.put('/me/profile', auth, (req, res) => {
    const b = req.body;
    const city = cityBySlug(b.city);
    if (!city) fail(400, 'invalid', 'Unknown city.');
    const areas = J(city.areas).map((a) => a.key);
    const area = areas.includes(b.area) ? b.area : null;
    const date = (v) => (/^\d{4}-\d{2}(-\d{2})?$/.test(v || '') ? v : null);
    db.prepare(`UPDATE profiles SET first_name=?, intro=?, city_id=?, area=?, university=?, show_university=?, exchange_start=?, exchange_end=?,
      role=?, languages=?, interests=?, onboarded=1 WHERE user_id=?`).run(
      str(b.first_name, 40, 'First name', { required: true }), str(b.intro, 280, 'Introduction'), city.id, area,
      str(b.university, 80, 'University') || null, b.show_university ? 1 : 0, date(b.exchange_start), date(b.exchange_end),
      ['exchange', 'international', 'local'].includes(b.role) ? b.role : 'exchange',
      JSON.stringify(list(b.languages, LANGUAGES)), JSON.stringify(list(b.interests, CAT_KEYS)), req.user.id,
    );
    res.json({ ok: true });
  });

  r.put('/me/privacy', auth, (req, res) => {
    const p = profileOf(req.user.id);
    const city = cityById(p.city_id);
    const b = req.body;
    const set = (col, val) => db.prepare(`UPDATE profiles SET ${col} = ? WHERE user_id = ?`).run(val, req.user.id);
    if ('visible' in b) set('visible', b.visible ? 1 : 0);
    if ('nearby_enabled' in b) set('nearby_enabled', b.nearby_enabled ? 1 : 0);
    if ('show_sample' in b) set('show_sample', b.show_sample ? 1 : 0);
    if ('lang' in b && ['en', 'es'].includes(b.lang)) set('lang', b.lang);
    // Only an approximate area name is ever stored: never coordinates.
    if ('area' in b) set('area', J(city.areas).some((a) => a.key === b.area) ? b.area : null);
    res.json({ ok: true });
  });

  r.delete('/me', auth, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!u.is_demo && !verifyPassword(req.body?.password || '', u.password_hash)) fail(403, 'credentials', 'Password is not correct.');
    if (u.is_demo) fail(403, 'demo', 'Sample personas cannot be deleted. Log out instead.');
    tx(db, () => {
      const uid = u.id;
      const own = db.prepare("SELECT id FROM activities WHERE organiser_id = ? AND status = 'active'").all(uid);
      for (const a of own) {
        systemMsg(a.id, 'This activity was cancelled because the organiser deleted their account.');
        notifyMembers(a.id, ['accepted', 'pending', 'invited'], 'cancelled', null, 'The organiser deleted their account.');
      }
      db.prepare("UPDATE activities SET status='cancelled', cancel_reason='The organiser deleted their account.' WHERE organiser_id = ? AND status='active'").run(uid);
      db.prepare("UPDATE activities SET title='Cancelled activity', description='', meeting_point='', welcome_plan='', recognise_tip='' WHERE organiser_id = ?").run(uid);
      for (const m of db.prepare("SELECT activity_id FROM memberships WHERE user_id = ? AND status = 'accepted'").all(uid)) systemMsg(m.activity_id, 'A participant left (account deleted).');
      db.prepare('DELETE FROM memberships WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM messages WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM wishes WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM event_interests WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?').run(uid, uid);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
      // Keep an anonymous row only so cancelled activities still reference an organiser; all personal data is removed.
      db.prepare("UPDATE profiles SET first_name='Deleted user', intro='', area=NULL, university=NULL, show_university=0, exchange_start=NULL, exchange_end=NULL, languages='[]', interests='[]', visible=0 WHERE user_id = ?").run(uid);
      db.prepare("UPDATE users SET email = ?, password_hash = 'deleted' WHERE id = ?").run(`deleted-${uid}@deleted.invalid`, uid);
    });
    res.clearCookie('sq_session', { path: '/' });
    res.json({ ok: true });
  });

  // ---------- people, blocking, reporting ----------
  r.get('/users/:id', auth, (req, res) => {
    const id = Number(req.params.id);
    if (blockedSet(req.user.id).has(id)) fail(404, 'not_found', 'Profile not available.');
    const p = profileOf(id);
    if (!p || p.first_name === 'Deleted user') fail(404, 'not_found', 'Profile not available.');
    res.json({ profile: publicProfile(p), blocked_by_me: false });
  });

  r.get('/me/blocks', auth, (req, res) => {
    const rows = db.prepare('SELECT blocked_id FROM blocks WHERE blocker_id = ?').all(req.user.id);
    res.json({ blocked: rows.map((x) => personSummary(profileOf(x.blocked_id))).filter(Boolean) });
  });

  r.post('/users/:id/block', auth, (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) fail(400, 'invalid', 'You cannot block yourself.');
    if (!profileOf(id)) fail(404, 'not_found', 'User not found.');
    tx(db, () => {
      db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').run(req.user.id, id);
      // Withdraw any open requests/invites between the two people in each other's activities.
      db.prepare(`UPDATE memberships SET status='withdrawn', updated_at=? WHERE status IN ('pending','invited') AND (
        (user_id = ? AND activity_id IN (SELECT id FROM activities WHERE organiser_id = ?)) OR
        (user_id = ? AND activity_id IN (SELECT id FROM activities WHERE organiser_id = ?)))`).run(now(), id, req.user.id, req.user.id, id);
    });
    res.json({ ok: true });
  });

  r.delete('/users/:id/block', auth, (req, res) => {
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, Number(req.params.id));
    res.json({ ok: true });
  });

  r.post('/reports', auth, (req, res) => {
    const type = ['user', 'activity', 'message'].includes(req.body.target_type) ? req.body.target_type : fail(400, 'invalid', 'Unknown report type.');
    const reason = REPORT_REASONS.includes(req.body.reason) ? req.body.reason : fail(400, 'invalid', 'Please choose a reason.');
    db.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?,?,?,?,?)')
      .run(req.user.id, type, Number(req.body.target_id) || 0, reason, str(req.body.details, 1000, 'Details'));
    res.status(201).json({ ok: true });
  });

  // Moderation inbox (no UI yet). Protected by an ADMIN_TOKEN environment variable.
  r.get('/admin/reports', (req, res) => {
    if (!process.env.ADMIN_TOKEN || req.get('x-admin-token') !== process.env.ADMIN_TOKEN) fail(403, 'forbidden', 'Forbidden.');
    res.json({ reports: db.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT 200').all() });
  });

  // ---------- activities ----------
  function visibleFilter(rows, uid) {
    const blocked = blockedSet(uid);
    const showSample = !!profileOf(uid)?.show_sample;
    return rows.filter((a) => !blocked.has(a.organiser_id) && (showSample || !a.is_sample));
  }

  function whenMatch(a, when, tz) {
    if (!when || when === 'any') return true;
    const day = utcToLocalInput(a.starts_at, tz).slice(0, 10);
    const today = utcToLocalInput(now(), tz).slice(0, 10);
    const addDays = (n) => utcToLocalInput(new Date(Date.now() + n * 864e5).toISOString(), tz).slice(0, 10);
    if (when === 'today') return day === today;
    if (when === 'tomorrow') return day === addDays(1);
    if (when === 'week') return day <= addDays(7);
    if (when === 'weekend') {
      const wd = slotOf(a.starts_at, tz).slice(0, 3);
      return day <= addDays(7) && (wd === 'sat' || wd === 'sun');
    }
    return true;
  }

  function applyFilters(views, q) {
    const budget = BUDGETS.find((b) => b.key === q.budget);
    return views.filter((v) =>
      (!q.category || v.category === q.category) &&
      (!budget || v.cost_eur <= budget.max) &&
      (!q.size || (q.size === 'buddy' ? v.max_participants <= 2 : q.size === 'small' ? v.max_participants >= 3 && v.max_participants <= 5 : v.max_participants >= 6)) &&
      (!q.lang || v.languages.length === 0 || v.languages.includes(q.lang)) &&
      (q.beginner !== '1' || v.beginner_friendly) &&
      (q.solo !== '1' || v.solo_format) &&
      (q.open !== '1' || v.state === 'open') &&
      (!q.q || `${v.title} ${v.description} ${v.meeting_area}`.toLowerCase().includes(String(q.q).toLowerCase())));
  }

  r.get('/activities', auth, (req, res) => {
    const city = cityBySlug(req.query.city) || fail(404, 'not_found', 'Unknown city.');
    const rows = db.prepare(`SELECT * FROM activities WHERE city_id = ? AND status = 'active'
      AND datetime(starts_at, '+' || duration_min || ' minutes') > datetime('now') ORDER BY starts_at LIMIT 300`).all(city.id);
    const views = visibleFilter(rows, req.user.id).filter((a) => whenMatch(a, req.query.when, city.timezone)).map((a) => activityView(a, req.user.id));
    res.json({ activities: applyFilters(views, req.query) });
  });

  r.get('/activities/:id', auth, (req, res) => {
    const a = getActivity(req.params.id);
    const uid = req.user.id;
    const blocked = blockedSet(uid);
    if (blocked.has(a.organiser_id)) fail(404, 'not_found', 'This activity is not available.');
    const v = activityView(a, uid);
    const isOrg = a.organiser_id === uid;
    const insider = canChat(a, uid);
    v.meeting_point = insider ? a.meeting_point : null; // exact meeting point only for confirmed people
    const accepted = db.prepare("SELECT user_id FROM memberships WHERE activity_id = ? AND status = 'accepted' ORDER BY updated_at").all(a.id);
    v.participants = insider ? accepted.map((m) => ({ ...personSummary(profileOf(m.user_id)), hidden: blocked.has(m.user_id) })) : null;
    if (isOrg) {
      const rows = db.prepare("SELECT * FROM memberships WHERE activity_id = ? AND status IN ('pending','invited') ORDER BY created_at").all(a.id);
      v.requests = rows.filter((m) => !blocked.has(m.user_id)).map((m) => ({ user: publicProfile(profileOf(m.user_id)), status: m.status, message: m.message, created_at: m.created_at }));
    }
    const mine = membershipOf(a.id, uid);
    if (mine) v.my_message = mine.message;
    res.json({ activity: v });
  });

  function readActivityInput(b, city, existing) {
    const tz = city.timezone;
    const startsIso = localToUtcIso(b.starts_local, tz) || fail(400, 'invalid', 'Please choose a date and time.');
    if (!existing && new Date(startsIso) < new Date()) fail(400, 'invalid', 'The start time is in the past.');
    const duration = Math.round(Number(b.duration_min));
    if (!(duration >= 15 && duration <= 24 * 60)) fail(400, 'invalid', 'Duration must be between 15 minutes and 24 hours.');
    const max = Math.round(Number(b.max_participants));
    if (!(max >= 2 && max <= 30)) fail(400, 'invalid', 'Group size must be between 2 and 30 people, including you.');
    const cost = Number(b.cost_eur || 0);
    if (!(cost >= 0 && cost <= 500)) fail(400, 'invalid', 'Cost must be between €0 and €500.');
    return {
      template: TEMPLATES.some((t) => t.key === b.template) ? b.template : 'other',
      category: CAT_KEYS.includes(b.category) ? b.category : 'other',
      title: str(b.title, 80, 'Title', { required: true }),
      description: str(b.description, 600, 'Description'),
      starts_at: startsIso, duration_min: duration,
      meeting_area: str(b.meeting_area, 80, 'Meeting area', { required: true }),
      meeting_point: str(b.meeting_point, 200, 'Meeting point'),
      cost_eur: Math.round(cost * 100) / 100, max_participants: max,
      beginner_friendly: b.beginner_friendly ? 1 : 0,
      pace: str(b.pace, 40, 'Pace') || null, transport: str(b.transport, 160, 'Transport') || null,
      languages: JSON.stringify(list(b.languages, LANGUAGES)),
      solo_format: b.solo_format ? 1 : 0,
      welcome_plan: str(b.welcome_plan, 300, 'Welcome plan'),
      recognise_tip: str(b.recognise_tip, 160, 'How to recognise the group'),
    };
  }

  r.post('/activities', auth, (req, res) => {
    const p = profileOf(req.user.id);
    const city = cityById(p.city_id);
    const d = readActivityInput(req.body, city, null);
    const id = tx(db, () => {
      const { lastInsertRowid } = db.prepare(`INSERT INTO activities (city_id, organiser_id, template, category, title, description, starts_at, duration_min,
        meeting_area, meeting_point, cost_eur, max_participants, beginner_friendly, pace, transport, languages, solo_format, welcome_plan, recognise_tip, is_sample)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        city.id, req.user.id, d.template, d.category, d.title, d.description, d.starts_at, d.duration_min, d.meeting_area, d.meeting_point,
        d.cost_eur, d.max_participants, d.beginner_friendly, d.pace, d.transport, d.languages, d.solo_format, d.welcome_plan, d.recognise_tip,
        req.user.is_demo ? 1 : 0);
      systemMsg(lastInsertRowid, `${p.first_name} created this activity. Confirmed participants can chat here.`);
      return Number(lastInsertRowid);
    });
    res.status(201).json({ id });
  });

  const ownActivity = (req) => {
    const a = getActivity(req.params.id);
    if (a.organiser_id !== req.user.id) fail(403, 'forbidden', 'Only the organiser can manage this activity.');
    return a;
  };

  r.put('/activities/:id', auth, (req, res) => {
    tx(db, () => {
      const a = ownActivity(req);
      if (a.status === 'cancelled') fail(409, 'cancelled', 'Cancelled activities cannot be edited.');
      if (isPast(a)) fail(409, 'past', 'Past activities cannot be edited.');
      const d = readActivityInput(req.body, cityById(a.city_id), a);
      if (d.max_participants < goingCount(a.id)) fail(409, 'capacity', `${goingCount(a.id)} people are already going. Remove someone before lowering the group size.`);
      db.prepare(`UPDATE activities SET template=?, category=?, title=?, description=?, starts_at=?, duration_min=?, meeting_area=?, meeting_point=?, cost_eur=?,
        max_participants=?, beginner_friendly=?, pace=?, transport=?, languages=?, solo_format=?, welcome_plan=?, recognise_tip=?, updated_at=? WHERE id=?`).run(
        d.template, d.category, d.title, d.description, d.starts_at, d.duration_min, d.meeting_area, d.meeting_point, d.cost_eur, d.max_participants,
        d.beginner_friendly, d.pace, d.transport, d.languages, d.solo_format, d.welcome_plan, d.recognise_tip, now(), a.id);
      const changes = [];
      if (d.starts_at !== a.starts_at) changes.push('time');
      if (d.meeting_point !== a.meeting_point || d.meeting_area !== a.meeting_area) changes.push('meeting point');
      if (changes.length) {
        systemMsg(a.id, `The organiser changed the ${changes.join(' and ')}. Check the meet-up card.`);
        notifyMembers(a.id, ['accepted'], 'changed', req.user.id, changes.join(','));
      }
    });
    res.json({ ok: true });
  });

  r.post('/activities/:id/cancel', auth, (req, res) => {
    tx(db, () => {
      const a = ownActivity(req);
      if (a.status === 'cancelled') fail(409, 'cancelled', 'Already cancelled.');
      const reason = str(req.body.reason, 200, 'Reason');
      db.prepare("UPDATE activities SET status='cancelled', cancel_reason=?, updated_at=? WHERE id=?").run(reason || null, now(), a.id);
      systemMsg(a.id, `The organiser cancelled this activity.${reason ? ` Reason: ${reason}` : ''}`);
      notifyMembers(a.id, ['accepted', 'pending', 'invited'], 'cancelled', req.user.id, reason);
    });
    res.json({ ok: true });
  });

  // Request to join (or re-request after leaving).
  r.post('/activities/:id/requests', auth, (req, res) => {
    const uid = req.user.id;
    const result = tx(db, () => {
      const a = getActivity(req.params.id);
      if (a.organiser_id === uid) fail(409, 'own', 'You are the organiser of this activity.');
      if (a.status === 'cancelled') fail(409, 'cancelled', 'This activity was cancelled.');
      if (isPast(a)) fail(409, 'past', 'This activity has already happened.');
      if (blockedSet(uid).has(a.organiser_id)) fail(404, 'not_found', 'This activity is not available.');
      if (goingCount(a.id) >= a.max_participants) fail(409, 'full', 'This activity is full.');
      const m = membershipOf(a.id, uid);
      const msg = str(req.body.message, 280, 'Message');
      if (m) {
        if (m.status === 'pending') fail(409, 'duplicate', 'You already asked to join. Waiting for the organiser.');
        if (m.status === 'accepted') fail(409, 'duplicate', 'You are already going.');
        if (m.status === 'invited') fail(409, 'invited', 'You were invited. Accept the invitation instead.');
        if (m.status === 'declined' || m.status === 'removed') fail(403, 'not_allowed', 'The organiser has not accepted you for this activity.');
        db.prepare("UPDATE memberships SET status='pending', message=?, created_at=?, updated_at=? WHERE id=?").run(msg, now(), now(), m.id);
      } else {
        db.prepare("INSERT INTO memberships (activity_id, user_id, status, message) VALUES (?, ?, 'pending', ?)").run(a.id, uid, msg);
      }
      notify(a.organiser_id, 'request_received', a.id, uid);
      return { status: 'pending' };
    });
    res.status(201).json(result);
  });

  // Withdraw a pending request, or leave a group you were confirmed in.
  r.delete('/activities/:id/requests/mine', auth, (req, res) => {
    tx(db, () => {
      const a = getActivity(req.params.id);
      const m = membershipOf(a.id, req.user.id);
      if (!m || !['pending', 'accepted', 'invited'].includes(m.status)) fail(409, 'not_member', 'You are not part of this activity.');
      const next = m.status === 'accepted' ? 'left' : 'withdrawn';
      db.prepare('UPDATE memberships SET status=?, updated_at=? WHERE id=?').run(next, now(), m.id);
      if (m.status === 'accepted') { systemMsg(a.id, `${nameOf(req.user.id)} left the activity.`); notify(a.organiser_id, 'left', a.id, req.user.id); }
    });
    res.json({ ok: true });
  });

  // Organiser decisions on a person: accept | decline | remove
  r.post('/activities/:id/members/:userId/:action', auth, (req, res) => {
    const target = Number(req.params.userId);
    const action = req.params.action;
    tx(db, () => {
      const a = ownActivity(req);
      if (target === req.user.id) fail(400, 'own', 'You cannot manage your own place.');
      const m = membershipOf(a.id, target) || fail(404, 'not_found', 'No request from this person.');
      if (action === 'accept') {
        if (m.status !== 'pending') fail(409, 'state', 'This request is no longer waiting.');
        if (a.status === 'cancelled') fail(409, 'cancelled', 'This activity was cancelled.');
        if (isPast(a)) fail(409, 'past', 'This activity has already happened.');
        if (goingCount(a.id) >= a.max_participants) fail(409, 'full', 'The activity is full. Increase the group size or decline the request.');
        db.prepare("UPDATE memberships SET status='accepted', updated_at=? WHERE id=?").run(now(), m.id);
        systemMsg(a.id, `${nameOf(target)} joined. Say hello!`);
        notify(target, 'request_accepted', a.id, req.user.id);
      } else if (action === 'decline') {
        if (!['pending', 'invited'].includes(m.status)) fail(409, 'state', 'This request is no longer waiting.');
        db.prepare("UPDATE memberships SET status=?, updated_at=? WHERE id=?").run(m.status === 'invited' ? 'withdrawn' : 'declined', now(), m.id);
        if (m.status === 'pending') notify(target, 'request_declined', a.id, req.user.id);
      } else if (action === 'remove') {
        if (m.status !== 'accepted') fail(409, 'state', 'This person is not in the group.');
        db.prepare("UPDATE memberships SET status='removed', updated_at=? WHERE id=?").run(now(), m.id);
        systemMsg(a.id, `${nameOf(target)} is no longer part of this activity.`);
        notify(target, 'removed', a.id, req.user.id);
      } else fail(400, 'invalid', 'Unknown action.');
    });
    res.json({ ok: true });
  });

  /**
   * Invitations are only allowed to people who opted in: they saved a matching wish, or said they are looking
   * for company for the linked event. This stops the app being used to message strangers out of the blue.
   */
  function inviteEligible(a, targetId) {
    const tp = profileOf(targetId);
    if (!tp || !tp.visible || tp.first_name === 'Deleted user') return false;
    if (a.event_id && db.prepare('SELECT 1 FROM event_interests WHERE event_id = ? AND user_id = ?').get(a.event_id, targetId)) return true;
    return !!db.prepare('SELECT 1 FROM wishes WHERE user_id = ? AND city_id = ? AND category = ?').get(targetId, a.city_id, a.category);
  }

  function invite(a, organiserId, targetId) {
    if (targetId === organiserId) fail(400, 'own', 'You cannot invite yourself.');
    if (a.status === 'cancelled' || isPast(a)) fail(409, 'state', 'This activity is not open.');
    if (blockedSet(organiserId).has(targetId)) fail(404, 'not_found', 'This person is not available.');
    if (!inviteEligible(a, targetId)) fail(403, 'not_eligible', 'You can only invite people who said they are interested in this kind of plan.');
    if (goingCount(a.id) >= a.max_participants) fail(409, 'full', 'This activity is full.');
    const m = membershipOf(a.id, targetId);
    if (m) {
      if (m.status === 'pending') fail(409, 'pending', 'They already asked to join. Accept their request instead.');
      if (['invited', 'accepted'].includes(m.status)) fail(409, 'duplicate', 'They are already invited or going.');
      if (['declined', 'removed'].includes(m.status)) fail(403, 'not_allowed', 'You cannot invite this person again for this activity.');
      db.prepare("UPDATE memberships SET status='invited', message='', created_at=?, updated_at=? WHERE id=?").run(now(), now(), m.id);
    } else {
      db.prepare("INSERT INTO memberships (activity_id, user_id, status) VALUES (?, ?, 'invited')").run(a.id, targetId);
    }
    notify(targetId, 'invited', a.id, organiserId);
  }

  r.post('/activities/:id/invite', auth, (req, res) => {
    tx(db, () => invite(ownActivity(req), req.user.id, Number(req.body.userId)));
    res.status(201).json({ ok: true });
  });

  r.post('/activities/:id/invitation/:action', auth, (req, res) => {
    tx(db, () => {
      const a = getActivity(req.params.id);
      const m = membershipOf(a.id, req.user.id);
      if (!m || m.status !== 'invited') fail(409, 'state', 'There is no open invitation.');
      if (req.params.action === 'accept') {
        if (a.status === 'cancelled' || isPast(a)) fail(409, 'state', 'This activity is no longer open.');
        if (goingCount(a.id) >= a.max_participants) fail(409, 'full', 'Sorry, the activity filled up.');
        db.prepare("UPDATE memberships SET status='accepted', updated_at=? WHERE id=?").run(now(), m.id);
        systemMsg(a.id, `${nameOf(req.user.id)} accepted the invitation and joined.`);
        notify(a.organiser_id, 'invite_accepted', a.id, req.user.id);
      } else if (req.params.action === 'decline') {
        db.prepare("UPDATE memberships SET status='withdrawn', updated_at=? WHERE id=?").run(now(), m.id);
      } else fail(400, 'invalid', 'Unknown action.');
    });
    res.json({ ok: true });
  });

  // ---------- chat ----------
  r.get('/activities/:id/messages', auth, (req, res) => {
    const a = getActivity(req.params.id);
    if (!canChat(a, req.user.id)) fail(403, 'forbidden', 'Only confirmed participants can read this chat.');
    const blocked = blockedSet(req.user.id);
    const after = Number(req.query.after) || 0;
    const rows = db.prepare('SELECT * FROM messages WHERE activity_id = ? AND id > ? ORDER BY id LIMIT 500').all(a.id, after);
    if (rows.length) {
      db.prepare(`INSERT INTO chat_reads (user_id, activity_id, last_read_id) VALUES (?, ?, ?)
        ON CONFLICT(user_id, activity_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`).run(req.user.id, a.id, rows[rows.length - 1].id);
    }
    res.json({
      messages: rows.map((m) => ({
        id: m.id, kind: m.kind, created_at: m.created_at, mine: m.user_id === req.user.id,
        author: m.user_id ? personSummary(profileOf(m.user_id)) : null,
        body: m.user_id && blocked.has(m.user_id) ? null : m.body, hidden: !!(m.user_id && blocked.has(m.user_id)),
      })),
      can_post: a.status === 'active',
    });
  });

  r.post('/activities/:id/messages', auth, (req, res) => {
    if (!msgLimit(String(req.user.id))) fail(429, 'rate', 'You are sending messages too quickly.');
    const a = getActivity(req.params.id);
    if (!canChat(a, req.user.id)) fail(403, 'forbidden', 'Only confirmed participants can post in this chat.');
    if (a.status !== 'active') fail(409, 'cancelled', 'This activity was cancelled, so the chat is read-only.');
    const body = str(req.body.body, 1000, 'Message', { required: true });
    const { lastInsertRowid } = db.prepare('INSERT INTO messages (activity_id, user_id, body) VALUES (?, ?, ?)').run(a.id, req.user.id, body);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  // ---------- my plans ----------
  r.get('/plans', auth, (req, res) => {
    const uid = req.user.id;
    const rows = db.prepare(`SELECT a.*, NULL AS mstatus FROM activities a WHERE a.organiser_id = ?
      UNION ALL SELECT a.*, m.status AS mstatus FROM activities a JOIN memberships m ON m.activity_id = a.id WHERE m.user_id = ?
      AND m.status IN ('pending','accepted','invited','left','removed','declined')`).all(uid, uid);
    const out = { organising: [], confirmed: [], waiting: [], invited: [], history: [] };
    for (const a of rows) {
      const v = activityView(a, uid);
      const done = v.state === 'past' || v.state === 'cancelled';
      if (done || ['left', 'removed', 'declined'].includes(a.mstatus)) {
        if (a.mstatus === 'declined' && !done) continue; // a declined request is not a plan; hide it quietly
        out.history.push(v);
      } else if (!a.mstatus) out.organising.push(v);
      else if (a.mstatus === 'accepted') out.confirmed.push(v);
      else if (a.mstatus === 'pending') out.waiting.push(v);
      else if (a.mstatus === 'invited') out.invited.push(v);
    }
    const byTime = (x, y) => x.starts_at.localeCompare(y.starts_at);
    for (const k of Object.keys(out)) out[k].sort(byTime);
    out.history.reverse();
    res.json(out);
  });

  // ---------- events (official or sample events; we never handle registration) ----------
  function eventView(e, uid) {
    const city = cityById(e.city_id);
    const blocked = blockedSet(uid);
    const showSample = !!profileOf(uid)?.show_sample;
    const seekers = db.prepare(`SELECT i.*, u.is_demo FROM event_interests i JOIN profiles p ON p.user_id = i.user_id JOIN users u ON u.id = i.user_id
      WHERE i.event_id = ? AND p.visible = 1`).all(e.id).filter((i) => !blocked.has(i.user_id) && (showSample || !i.is_demo));
    return {
      id: e.id, title: e.title, description: e.description, category: e.category, starts_at: e.starts_at,
      starts_local: utcToLocalInput(e.starts_at, city.timezone), timezone: city.timezone,
      duration_min: e.duration_min, venue: e.venue, organiser_name: e.organiser_name, official_url: e.official_url,
      price_note: e.price_note, is_sample: !!e.is_sample, status: e.status,
      state: e.status === 'cancelled' ? 'cancelled' : isPast(e) ? 'past' : 'open',
      seeking_count: seekers.filter((s) => s.user_id !== uid).length,
      i_am_seeking: seekers.some((s) => s.user_id === uid) || !!db.prepare('SELECT 1 FROM event_interests WHERE event_id=? AND user_id=?').get(e.id, uid),
      _seekers: seekers,
    };
  }

  r.get('/events', auth, (req, res) => {
    const city = cityBySlug(req.query.city) || fail(404, 'not_found', 'Unknown city.');
    const showSample = !!profileOf(req.user.id)?.show_sample;
    const rows = db.prepare(`SELECT * FROM events WHERE city_id = ? AND datetime(starts_at, '+' || duration_min || ' minutes') > datetime('now') ORDER BY starts_at`).all(city.id)
      .filter((e) => showSample || !e.is_sample).filter((e) => whenMatch(e, req.query.when, city.timezone))
      .filter((e) => !req.query.category || e.category === req.query.category);
    res.json({ events: rows.map((e) => { const { _seekers, ...v } = eventView(e, req.user.id); return v; }) });
  });

  r.get('/events/:id', auth, (req, res) => {
    const e = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id)) || fail(404, 'not_found', 'Event not found.');
    const uid = req.user.id;
    const { _seekers, ...v } = eventView(e, uid);
    const me = profileOf(uid);
    const myLangs = J(me.languages);
    const mine = db.prepare('SELECT * FROM event_interests WHERE event_id = ? AND user_id = ?').get(e.id, uid);
    v.my_interest = mine && { group_pref: mine.group_pref, languages: J(mine.languages), meeting_option: mine.meeting_option, note: mine.note };
    // Only people who have opted in themselves can see the list of others looking for company.
    v.seekers = mine ? _seekers.filter((s) => s.user_id !== uid).map((s) => {
      const p = profileOf(s.user_id);
      const shared = J(p.languages).filter((l) => myLangs.includes(l));
      const reasons = [];
      if (shared.length) reasons.push(`You both speak ${shared.join(' and ')}`);
      if (mine.group_pref !== 'either' && s.group_pref === mine.group_pref) reasons.push(mine.group_pref === 'buddy' ? 'You both prefer one buddy' : 'You both prefer a small group');
      if (s.meeting_option && s.meeting_option === mine.meeting_option) reasons.push(`Same meeting option: ${s.meeting_option}`);
      return { user: publicProfile(p), group_pref: s.group_pref, languages: J(s.languages), meeting_option: s.meeting_option, note: s.note, reasons,
        match: { shared_languages: shared, same_pref: mine.group_pref !== 'either' && s.group_pref === mine.group_pref ? mine.group_pref : null, same_meeting: !!s.meeting_option && s.meeting_option === mine.meeting_option } };
    }) : null;
    const blocked = blockedSet(uid);
    v.groups = db.prepare("SELECT * FROM activities WHERE event_id = ? AND status = 'active'").all(e.id)
      .filter((a) => !blocked.has(a.organiser_id)).map((a) => activityView(a, uid));
    res.json({ event: v });
  });

  r.put('/events/:id/interest', auth, (req, res) => {
    const e = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id)) || fail(404, 'not_found', 'Event not found.');
    if (e.status === 'cancelled' || isPast(e)) fail(409, 'state', 'This event is not upcoming.');
    const b = req.body;
    const pref = ['buddy', 'small', 'either'].includes(b.group_pref) ? b.group_pref : 'either';
    db.prepare(`INSERT INTO event_interests (event_id, user_id, group_pref, languages, meeting_option, note) VALUES (?,?,?,?,?,?)
      ON CONFLICT(event_id, user_id) DO UPDATE SET group_pref=excluded.group_pref, languages=excluded.languages, meeting_option=excluded.meeting_option, note=excluded.note`)
      .run(e.id, req.user.id, pref, JSON.stringify(list(b.languages, LANGUAGES)), str(b.meeting_option, 80, 'Meeting option'), str(b.note, 200, 'Note'));
    res.json({ ok: true });
  });

  r.delete('/events/:id/interest', auth, (req, res) => {
    db.prepare('DELETE FROM event_interests WHERE event_id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  // Invite someone who is also looking for company. Creates (or reuses) my "going together" group for the event.
  r.post('/events/:id/invite', auth, (req, res) => {
    const uid = req.user.id;
    const out = tx(db, () => {
      const e = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id)) || fail(404, 'not_found', 'Event not found.');
      const mine = db.prepare('SELECT * FROM event_interests WHERE event_id = ? AND user_id = ?').get(e.id, uid);
      if (!mine) fail(409, 'no_interest', 'First tell us you are looking for company for this event.');
      let a = db.prepare("SELECT * FROM activities WHERE event_id = ? AND organiser_id = ? AND status = 'active'").get(e.id, uid);
      if (!a) {
        const meet = new Date(new Date(e.starts_at).getTime() - 20 * 60e3).toISOString();
        const max = mine.group_pref === 'buddy' ? 2 : 4;
        const p = profileOf(uid);
        const { lastInsertRowid } = db.prepare(`INSERT INTO activities (city_id, organiser_id, event_id, template, category, title, description, starts_at, duration_min,
          meeting_area, cost_eur, max_participants, beginner_friendly, languages, welcome_plan, recognise_tip, is_sample)
          VALUES (?,?,?,?,?,?,?,?,?,?,0,?,1,?,?,?,?)`).run(
          e.city_id, uid, e.id, 'other', e.category, `Going together: ${e.title}`.slice(0, 80),
          'A small group going to this event together. Joining this group does not register you for the event or buy a ticket. Use the official link for that.',
          meet, e.duration_min + 20, mine.meeting_option || `Near ${e.venue}`, max, mine.languages,
          `${p.first_name} will wait at the meeting point 20 minutes before the start.`, '', req.user.is_demo ? 1 : 0);
        systemMsg(lastInsertRowid, `${p.first_name} started a group to go to "${e.title}" together.`);
        a = db.prepare('SELECT * FROM activities WHERE id = ?').get(lastInsertRowid);
      }
      invite(a, uid, Number(req.body.userId));
      return { activityId: a.id };
    });
    res.status(201).json(out);
  });

  // ---------- wishes and compatible-wish suggestions ----------
  r.get('/wishes', auth, (req, res) => {
    const rows = db.prepare('SELECT * FROM wishes WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
    res.json({ wishes: rows.map((w) => ({ id: w.id, category: w.category, note: w.note, slots: J(w.slots), budget: w.budget, created_at: w.created_at })) });
  });

  r.post('/wishes', auth, (req, res) => {
    const p = profileOf(req.user.id);
    const n = db.prepare('SELECT COUNT(*) AS n FROM wishes WHERE user_id = ?').get(req.user.id).n;
    if (n >= 10) fail(409, 'limit', 'You can save up to 10 wishes.');
    const category = CAT_KEYS.includes(req.body.category) ? req.body.category : fail(400, 'invalid', 'Choose what you would like to do.');
    const budget = ['free', 'low', 'any'].includes(req.body.budget) ? req.body.budget : 'any';
    const { lastInsertRowid } = db.prepare('INSERT INTO wishes (user_id, city_id, category, note, slots, budget) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, p.city_id, category, str(req.body.note, 140, 'Note'), JSON.stringify(list(req.body.slots, SLOT_KEYS, 21)), budget);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  r.delete('/wishes/:id', auth, (req, res) => {
    const info = db.prepare('DELETE FROM wishes WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
    if (!info.changes) fail(404, 'not_found', 'Wish not found.');
    res.json({ ok: true });
  });

  /**
   * Rule-based matching, explained in words. Two wishes are compatible when they are in the same city and category,
   * their available time slots overlap (or one person said "flexible"), and their budgets do not conflict.
   */
  r.get('/wishes/suggestions', auth, (req, res) => {
    const uid = req.user.id;
    const me = profileOf(uid);
    const blocked = blockedSet(uid);
    const myLangs = J(me.languages);
    const mine = db.prepare('SELECT * FROM wishes WHERE user_id = ?').all(uid);
    const out = [];
    for (const w of mine) {
      const others = db.prepare(`SELECT w.*, u.is_demo FROM wishes w JOIN profiles p ON p.user_id = w.user_id JOIN users u ON u.id = w.user_id
        WHERE w.city_id = ? AND w.category = ? AND w.user_id != ? AND p.visible = 1`).all(w.city_id, w.category, uid);
      for (const o of others) {
        if (blocked.has(o.user_id) || (!me.show_sample && o.is_demo)) continue;
        const a = J(w.slots); const b = J(o.slots);
        const overlap = a.length && b.length ? a.filter((s) => b.includes(s)) : [];
        const flexible = !a.length || !b.length;
        if (!overlap.length && !flexible) continue;
        const p = profileOf(o.user_id);
        const shared = J(p.languages).filter((l) => myLangs.includes(l));
        let reason = `You both want to ${categoryPhrase(w.category)}`;
        if (overlap.length) reason += ` and are available ${overlap.slice(0, 2).map(slotLabel).join(' or ')}`;
        else reason += '. One of you is flexible about timing';
        reason += '.';
        const extras = [];
        if (shared.length) extras.push(`You both speak ${shared.slice(0, 2).join(' and ')}.`);
        if (w.budget === 'free' || o.budget === 'free') extras.push(w.budget === o.budget ? 'You both prefer free plans.' : 'One of you prefers free plans, so keep it free.');
        out.push({ wish_id: w.id, other_wish_id: o.id, category: w.category, overlap, flexible, shared_languages: shared,
          budget_note: w.budget === 'free' || o.budget === 'free' ? (w.budget === o.budget ? 'both_free' : 'one_free') : null,
          user: publicProfile(p), other_note: o.note, reason, extras });
      }
    }
    res.json({ suggestions: out.slice(0, 30) });
  });

  r.get('/notifications', auth, (req, res) => {
    const blocked = blockedSet(req.user.id);
    const rows = db.prepare(`SELECT n.*, a.title, a.status AS astatus FROM notifications n LEFT JOIN activities a ON a.id = n.activity_id
      WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 50`).all(req.user.id);
    res.json({
      notifications: rows.filter((n) => !blocked.has(n.actor_id)).map((n) => ({
        id: n.id, kind: n.kind, detail: n.detail, read: !!n.read_at, created_at: n.created_at,
        activity: n.activity_id ? { id: n.activity_id, title: n.title, status: n.astatus } : null,
        actor: n.actor_id ? { id: n.actor_id, first_name: nameOf(n.actor_id) } : null,
      })),
    });
  });

  r.post('/notifications/read', auth, (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean).slice(0, 200) : null;
    if (ids?.length) {
      db.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`).run(now(), req.user.id, ...ids);
    } else if (req.body.all) {
      db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), req.user.id);
    }
    res.json({ ok: true });
  });

  r.get('/invitations', auth, (req, res) => {
    const rows = db.prepare(`SELECT a.* FROM activities a JOIN memberships m ON m.activity_id = a.id WHERE m.user_id = ? AND m.status = 'invited'
      AND a.status = 'active' ORDER BY a.starts_at`).all(req.user.id);
    res.json({ invitations: rows.filter((a) => !isPast(a)).map((a) => activityView(a, req.user.id)) });
  });

  // ---------- city guide ----------
  r.get('/guide', (req, res) => {
    const city = cityBySlug(req.query.city) || fail(404, 'not_found', 'Unknown city.');
    res.json({ city: city.name, items: db.prepare('SELECT section, kind, title, summary, url, source_name, checked_at FROM guide_items WHERE city_id = ? ORDER BY sort, id').all(city.id) });
  });

  return r;
}
