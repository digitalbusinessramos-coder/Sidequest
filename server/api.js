import express from 'express';
import crypto from 'node:crypto';
import { sendEmail, emailConfigured } from './email.js';
import { tx } from './db.js';
import { createPush } from './push.js';
import { config } from './config.js';
import { stripImageMetadata } from './images.js';
import { hashPassword, verifyPassword, needsRehash, burnPasswordCheck, createSession, destroySession, sessionUser, rateLimiter, takeRetryAfter, securityLog, maskEmail } from './auth.js';
import { localToUtcIso, utcToLocalInput, slotOf } from './time.js';
import { CATEGORIES, TEMPLATES, LANGUAGES, STAY_KINDS, BUDGETS, REPORT_REASONS, REC_CATEGORIES, MARKET_KINDS, MARKET_CATEGORIES, FEEDBACK_KINDS, PLAN_EMOJIS, categoryPhrase, slotLabel } from '../shared/catalog.js';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message); this.status = status; this.code = code;
    // Every "too many" answer says when to try again (Retry-After header), from the limit that was hit.
    if (status === 429) this.retryAfter = takeRetryAfter();
  }
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
// Known languages are stored by their English name; anything else is kept as the person typed it ("Add another language").
const languageList = (v) => list(v, null, 12).map((x) => LANGUAGES.find((l) => l.toLowerCase() === x.toLowerCase()) || x);
// Flags for the bio: two-letter region codes (countries and territories, e.g. IC for the Canary Islands). Purely decorative.
const flagList = (v) => list(v, null, 8).map((x) => x.toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x));
const REVISION = (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || 'local').slice(0, 7);
const RELEASE = 'pre-launch-11-potato-logo';
const TIME_MODES = ['exact', 'window', 'tbd'];
const DAY_MODES = ['day', 'weekend', 'week', 'flex'];
// Accounts used for testing are kept out of campaign numbers and never get emails: addresses with "+test" or on test domains.
const TEST_DOMAINS = (process.env.TEST_EMAIL_DOMAINS || 'example.com,example.org,test.invalid').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
const isTestEmail = (email) => /\+test[^@]*@/i.test(email) || TEST_DOMAINS.includes(email.split('@')[1]);
// Parts of a day, in local time. A "window" plan is listed until its window ends.
const TIME_WINDOWS = { morning: ['09:00', '13:00'], afternoon: ['14:00', '19:00'], evening: ['19:00', '23:59'] };
// Optional duration choices. Minutes are only used to decide when a plan stops being listed.
const DURATIONS = { hour: 60, few: 180, open: 240 };
const COST_MODES = ['free', 'estimate', 'unknown'];
// Suggested meeting areas that are not in the city's neighbourhood list, with an approximate centre for the map.
const AREA_ALIASES = [
  { words: ['canteras', 'guanarteme'], key: 'canteras' },
  { words: ['santa catalina', 'puerto'], key: 'santacatalina' },
  { words: ['triana', 'vegueta'], key: 'triana' },
  { words: ['tafira'], key: 'tafira' },
  { words: ['obelisco'], lat: 28.118, lng: -15.425 },
  { words: ['schamann', 'escaleritas'], key: 'schamann' },
  { words: ['siete palmas', 'tamaraceite'], key: 'sietepalmas' },
];
// Push services of Chrome/Edge/Android (Google), Firefox (Mozilla), Safari/iPhone (Apple) and Windows (Microsoft).
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
const SLOT_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].flatMap((d) => ['morning', 'afternoon', 'evening'].map((p) => `${d}_${p}`));

export function createApi(db) {
  const r = express.Router();
  const push = createPush(db);
  db.exec('CREATE TABLE IF NOT EXISTS plan_reminders (activity_id INTEGER NOT NULL, user_id INTEGER NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY (activity_id, user_id))');
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
  const loginAccountLimit = rateLimiter(10, 15 * 60e3);
  const signupLimit = rateLimiter(Number(process.env.SIGNUP_RATE_LIMIT || 20), 60 * 60e3); // new accounts per network per hour
  const forgotEmailLimit = rateLimiter(3, 60 * 60e3); // reset emails per address per hour
  const resetIpLimit = rateLimiter(10, 60 * 60e3); // tries with a reset link per network per hour
  const reportLimit = rateLimiter(20, 60 * 60e3); const reportIpLimit = rateLimiter(60, 60 * 60e3);
  const feedbackIpLimit = rateLimiter(30, 60 * 60e3);
  const photoLimit = rateLimiter(30, 60 * 60e3); const photoIpLimit = rateLimiter(100, 60 * 60e3);
  const guestWriteLimit = rateLimiter(60, 60 * 60e3); const guestWriteIpLimit = rateLimiter(300, 60 * 60e3);
  const photoRate = (req) => {
    if (!photoLimit(`u${req.user.id}`) || !photoIpLimit(req.ip)) { securityLog('photo_rate_limited', { user: req.user.id, ip: req.ip }); fail(429, 'rate', 'You uploaded a lot of pictures. Please wait a little.'); }
  };
  const guestLimit = rateLimiter(Number(process.env.GUEST_RATE_LIMIT || 60), 60 * 60e3);

  // ---------- email verification ----------
  const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
  const origin = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  async function startVerification(req, uid, email) {
    if (isTestEmail(email)) { db.prepare('UPDATE users SET is_test = 1 WHERE id = ?').run(uid); return { sent: false, test: true }; }
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
  function readJpeg(req) {
    const m = /^data:(image\/jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data || ''));
    if (!m) fail(400, 'invalid', 'Please choose a JPEG, PNG or WebP picture.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 600 * 1024) fail(413, 'too_large', 'That picture is too large. Please choose a smaller one.');
    if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) fail(400, 'invalid', 'That file does not look like a picture.');
    // Camera details and GPS position are removed before the picture is stored.
    return { mime: m[1], buf: stripImageMetadata(buf, m[1]) || fail(400, 'invalid', 'That file does not look like a picture.') };
  }
  const cityById = (id) => db.prepare('SELECT * FROM cities WHERE id = ?').get(id);
  const cityBySlug = (slug) => db.prepare('SELECT * FROM cities WHERE slug = ?').get(slug || config.defaultCity);
  const profileOf = (uid) => db.prepare('SELECT p.*, u.is_demo, u.is_guest, u.email_verified_at FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?').get(uid);

  /** Users I blocked or who blocked me. Hidden from each other everywhere. */
  const blockedSet = (uid) => new Set(
    db.prepare('SELECT blocked_id AS id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?')
      .all(uid, uid).map((x) => x.id)
  );

  // Profile pictures are only served with a key that the app hands out together with the person's name, so nobody can
  // collect everyone's pictures by trying numbers (also not people who chose "Only people in my plans can see me").
  const photoSecret = (() => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'photo_secret'").get();
    if (row) return row.value;
    const v = crypto.randomBytes(32).toString('hex');
    db.prepare("INSERT INTO settings (key, value) VALUES ('photo_secret', ?)").run(v);
    return v;
  })();
  const photoKey = (uid, v) => crypto.createHmac('sha256', photoSecret).update(`${uid}:${v}`).digest('base64url').slice(0, 22);
  const personSummary = (p) => p && ({
    id: p.user_id, first_name: p.first_name || 'Someone', is_demo: !!p.is_demo, is_guest: !!p.is_guest, avatar_hue: p.avatar_hue,
    photo: p.photo_v ? `/api/users/${p.user_id}/photo?v=${p.photo_v}&k=${photoKey(p.user_id, p.photo_v)}` : null,
    languages: J(p.languages), role: p.role,
  });

  // A status is shown only while it has not expired. Nothing is ever filled in for a user.
  const statusOf = (p) => {
    if (!p?.status_category || !p.status_expires_at || p.status_expires_at <= now()) return null;
    const city = cityById(p.city_id);
    const areaName = J(city?.areas || '[]').find((a) => a.key === p.status_area)?.name || null;
    return { category: p.status_category, slot: p.status_slot || null, area: p.status_area || null, area_name: areaName, note: p.status_note || '', expires_at: p.status_expires_at };
  };

  const publicProfile = (p) => p && ({
    ...personSummary(p),
    // The short card: name, photo, languages, interests and dates of stay. Intro, meeting area and university only if switched on.
    intro: p.show_intro ? p.intro : '', interests: J(p.interests),
    university: p.show_university ? p.university : null,
    exchange_start: p.exchange_start, exchange_end: p.exchange_end, stay: p.stay || null, flags: J(p.flags || '[]'),
    // Where they like to meet: free text since release 2; older profiles only have a neighbourhood key.
    area: p.show_area ? p.area : null, meet_area: p.show_area ? p.meet_area || null : null,
    status: null, // statuses were removed in release 2; stored rows are kept but never shown
    email_verified: !!p.email_verified_at, // means: confirmed they can receive email at their sign-up address. Nothing more.
  });

  const goingCount = (aid) => 1 + db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE activity_id = ? AND status = 'accepted'").get(aid).n;
  // Plans created since the pre-launch release store when they end (end of the time window or day); older plans use start + duration.
  const endOf = (a) => (a.ends_at ? new Date(a.ends_at).getTime() : new Date(a.starts_at).getTime() + (a.duration_min || 0) * 60e3);
  const isPast = (a) => endOf(a) < Date.now();
  const isCapped = (a) => a.capped == null || a.capped === 1;
  const isFull = (a) => isCapped(a) && goingCount(a.id) >= a.max_participants;
  const membershipOf = (aid, uid) => db.prepare('SELECT * FROM memberships WHERE activity_id = ? AND user_id = ?').get(aid, uid);
  const getActivity = (id) => db.prepare('SELECT * FROM activities WHERE id = ?').get(Number(id)) || fail(404, 'not_found', 'This activity no longer exists.');
  const systemMsg = (aid, body) => db.prepare("INSERT INTO messages (activity_id, kind, body) VALUES (?, 'system', ?)").run(aid, body);
  const nameOf = (uid) => profileOf(uid)?.first_name || 'Someone';

  // ---------- notifications ----------
  const notify = (uid, kind, aid, actorId = null, detail = '') => {
    if (!uid || uid === actorId) return;
    // Retries and repeated taps never stack identical unread updates.
    if (db.prepare('SELECT 1 FROM notifications WHERE user_id = ? AND kind = ? AND activity_id IS ? AND actor_id IS ? AND read_at IS NULL').get(uid, kind, aid, actorId)) return;
    db.prepare('INSERT INTO notifications (user_id, kind, activity_id, actor_id, detail) VALUES (?,?,?,?,?)').run(uid, kind, aid, actorId, detail);
    // Also as a pop-up on the person's devices, if they turned notifications on. Never from someone they blocked.
    if (actorId && blockedSet(uid).has(actorId)) return;
    const title = aid ? db.prepare('SELECT title FROM activities WHERE id = ?').get(aid)?.title || '' : '';
    const url = kind.startsWith('connect_') ? `/#/person/${actorId}` : aid && kind !== 'cancelled' ? `/#/activity/${aid}` : '/#/plans';
    push.send(uid, kind, { name: actorId ? nameOf(actorId) : '', plan: title, url });
  };
  const notifyMembers = (aid, statuses, kind, actorId, detail = '') => {
    const ph = statuses.map(() => '?').join(',');
    for (const m of db.prepare(`SELECT user_id FROM memberships WHERE activity_id = ? AND status IN (${ph})`).all(aid, ...statuses)) notify(m.user_id, kind, aid, actorId, detail);
  };
  const unreadChat = (aid, uid) => {
    const last = db.prepare('SELECT last_read_id FROM chat_reads WHERE user_id = ? AND activity_id = ?').get(uid, aid)?.last_read_id || 0;
    return db.prepare("SELECT COUNT(*) AS n FROM messages WHERE activity_id = ? AND id > ? AND kind = 'user' AND user_id != ?").get(aid, last, uid).n;
  };

  /** Approximate map position: the centre of the named neighbourhood, never an exact meeting point. */
  const approxSpot = (city, text) => {
    const t = String(text || '').toLowerCase();
    const extra = AREA_ALIASES.find((x) => x.words.some((w) => t.includes(w)));
    if (extra?.lat) return { lat: extra.lat, lng: extra.lng, area: text };
    const key = extra?.key;
    const area = J(city.areas).find((x) => x.key === key || t.includes(x.name.toLowerCase()) || x.name.toLowerCase().split(/[ /]+/).some((w) => w.length > 4 && w !== 'palmas' && t.includes(w)));
    return area ? { lat: area.lat, lng: area.lng, area: area.name } : null;
  };

  function activityView(a, viewerId) {
    const city = cityById(a.city_id);
    const going = goingCount(a.id);
    const m = viewerId ? membershipOf(a.id, viewerId) : null;
    const isOrg = viewerId === a.organiser_id;
    const past = isPast(a);
    const capped = isCapped(a);
    const state = a.status === 'cancelled' ? 'cancelled' : past ? 'past' : capped && going >= a.max_participants ? 'full' : 'open';
    // Cost: what the creator chose. Older plans have no cost_mode: a positive amount stays an estimate, an old 0 is shown as "not specified".
    const costMode = a.cost_mode || (a.cost_eur > 0 ? 'estimate' : null);
    const ev = a.event_id ? db.prepare('SELECT id, title, is_sample FROM events WHERE id = ?').get(a.event_id) : null;
    const v = {
      id: a.id, title: a.title, description: a.description, category: a.category, template: a.template,
      starts_at: a.starts_at, duration_min: a.duration_min || null, timezone: city.timezone, city: city.name,
      starts_local: utcToLocalInput(a.starts_at, city.timezone),
      time_mode: a.time_mode || 'exact', time_window: a.time_window || null, day: utcToLocalInput(a.starts_at, city.timezone).slice(0, 10),
      day_mode: a.day_mode || 'day', last_day: (a.day_mode || 'day') !== 'day' ? utcToLocalInput(a.ends_at, city.timezone).slice(0, 10) : null,
      duration_choice: a.duration_choice || null, ends_at: new Date(endOf(a)).toISOString(),
      meeting_area: a.meeting_area, cost_mode: costMode, cost_eur: costMode === 'estimate' ? a.cost_eur : null,
      capped, max_participants: capped ? a.max_participants : null,
      photo: a.photo_mime ? `/api/activities/${a.id}/photo?v=${a.photo_v || 0}` : null, emoji: a.emoji || '',
      beginner_friendly: !!a.beginner_friendly, pace: a.pace, transport: a.transport,
      languages: J(a.languages), solo_format: !!a.solo_format, is_sample: !!a.is_sample,
      status: a.status, cancel_reason: a.cancel_reason, state, going, spots_left: capped ? Math.max(0, a.max_participants - going) : null,
      organiser: personSummary(profileOf(a.organiser_id)), event: ev,
      my_status: isOrg ? 'organiser' : m?.status || null,
      welcome_plan: a.welcome_plan, recognise_tip: a.recognise_tip,
      join_mode: a.join_mode === 'open' ? 'open' : 'request', approx: approxSpot(city, a.meeting_area),
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
  // Guests (no email, one click) get a cap on everything that changes data: per guest and per network.
  r.use((req, _res, next) => {
    if (!req.user?.is_guest || ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path === '/auth/logout') return next();
    if (!guestWriteLimit(`g${req.user.id}`) || !guestWriteIpLimit(req.ip)) {
      securityLog('guest_write_rate_limited', { user: req.user.id, ip: req.ip });
      return next(new HttpError(429, 'rate', 'Too many changes in a short time. Please wait a little or create a free account.'));
    }
    next();
  });
  const auth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'auth', 'Please log in first.')));

  // ---------- meta ----------
  r.get('/meta', (_req, res) => {
    const cities = db.prepare('SELECT slug, name, country, timezone, areas FROM cities').all().map((c) => ({ ...c, areas: J(c.areas) }));
    const personas = []; // signing in as an example person is switched off for launch
    res.json({ appName: config.appName, demoMode: config.demoMode, passwordReset: emailConfigured(), cities, personas, categories: CATEGORIES, recCategories: REC_CATEGORIES, marketKinds: MARKET_KINDS, marketCategories: MARKET_CATEGORIES, feedbackKinds: FEEDBACK_KINDS, templates: TEMPLATES, languages: LANGUAGES, budgets: BUDGETS.map(({ key, label }) => ({ key, label })), reportReasons: REPORT_REASONS });
  });

  // Which code is running (the git commit Railway deployed), for deployment reports.
  r.get('/version', (_req, res) => res.json({ revision: REVISION, release: RELEASE }));

  // ---------- auth ----------
  r.post('/auth/signup', async (req, res) => {
    if (!authLimit(req.ip) || !signupLimit(req.ip)) { securityLog('signup_rate_limited', { ip: req.ip }); fail(429, 'rate', 'Too many attempts. Please wait a few minutes.'); }
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
    createSession(db, res, uid, req);
    const mail = await startVerification(req, uid, email);
    res.status(201).json({ ok: true, verification_sent: mail.sent });
  });

  r.post('/auth/login', (req, res) => {
    if (!authLimit(req.ip)) { securityLog('login_rate_limited_ip', { ip: req.ip }); fail(429, 'rate', 'Too many attempts. Please wait a few minutes.'); }
    const email = str(req.body.email, 200, 'Email').toLowerCase();
    // Also per account: at most 10 tries in 15 minutes, whatever network they come from (stops password guessing on one person).
    if (!loginAccountLimit(email)) { securityLog('login_rate_limited_account', { ip: req.ip, email: maskEmail(email) }); fail(429, 'rate', 'Too many attempts. Please wait a few minutes.'); }
    const u = db.prepare('SELECT * FROM users WHERE email = ? AND is_demo = 0').get(email);
    // No account: the same password check still runs, so the answer takes as long either way.
    if (!(u ? verifyPassword(req.body.password || '', u.password_hash) : burnPasswordCheck(req.body.password || ''))) {
      securityLog('login_failed', { ip: req.ip, email: maskEmail(email), known_account: !!u });
      fail(401, 'credentials', 'Email or password is not correct.');
    }
    if (needsRehash(u.password_hash)) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(req.body.password)), u.id);
    createSession(db, res, u.id, req);
    res.json({ ok: true });
  });

  r.post('/auth/demo', (req, res) => {
    if (!config.demoMode || !process.env.ALLOW_EXAMPLE_LOGIN) fail(410, 'demo_off', 'Example accounts are no longer available.');
    const u = db.prepare('SELECT id FROM users WHERE id = ? AND is_demo = 1').get(Number(req.body.personaId));
    if (!u) fail(404, 'not_found', 'Sample persona not found.');
    createSession(db, res, u.id);
    res.json({ ok: true });
  });

  // Guest access: one click, no email. Each visitor gets their own temporary account so permissions stay per person.
  // Guests are hidden from other people's buddy lists and are removed automatically after GUEST_DAYS.
  r.post('/auth/guest', (req, res) => {
    if (!config.demoMode) fail(403, 'demo_off', 'Guest access is switched off.');
    if (req.user) return res.json({ ok: true, existing: true });
    if (!guestLimit(req.ip)) { securityLog('guest_rate_limited', { ip: req.ip }); fail(429, 'rate', 'Too many guest visits from this network. Please wait a little or create an account.'); }
    const city = cityBySlug();
    const uid = tx(db, () => {
      const { lastInsertRowid } = db.prepare('INSERT INTO users (email, password_hash, is_guest) VALUES (?, ?, 1)')
        .run(`guest-${crypto.randomBytes(9).toString('hex')}@guest.invalid`, `nologin$${crypto.randomBytes(8).toString('hex')}`);
      const id = Number(lastInsertRowid);
      // No preset interests, languages, area or wishes: a guest has told us nothing yet, so nothing is claimed about them.
      db.prepare(`INSERT INTO profiles (user_id, first_name, intro, city_id, area, role, languages, interests, visible, onboarded, avatar_hue)
        VALUES (?, 'Guest', '', ?, NULL, 'exchange', '[]', '[]', 0, 1, ?)`).run(id, city.id, Math.floor(Math.random() * 360));
      return id;
    });
    createSession(db, res, uid);
    res.status(201).json({ ok: true });
  });

  // Turn a guest account into a normal account, keeping everything the guest did.
  r.post('/auth/claim', auth, async (req, res) => {
    if (!req.user.is_guest) fail(400, 'invalid', 'This account already has an email address.');
    if (!authLimit(req.ip)) fail(429, 'rate', 'Too many attempts. Please wait a few minutes.');
    const email = str(req.body.email, 200, 'Email', { required: true }).toLowerCase();
    const password = String(req.body.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || /@(sample|guest)\.invalid$/.test(email)) fail(400, 'invalid', 'Please enter a valid email address.');
    if (password.length < 8) fail(400, 'invalid', 'Password must be at least 8 characters.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'exists', 'An account with this email already exists. Try logging in.');
    const first = str(req.body.first_name, 40, 'First name');
    db.prepare('UPDATE users SET email = ?, password_hash = ?, is_guest = 0 WHERE id = ?').run(email, hashPassword(password), req.user.id);
    if (first) db.prepare('UPDATE profiles SET first_name = ? WHERE user_id = ?').run(first, req.user.id);
    db.prepare('UPDATE profiles SET visible = 1 WHERE user_id = ?').run(req.user.id);
    createSession(db, res, req.user.id, req); // new login token once the guest account becomes a real one
    const mail = await startVerification(req, req.user.id, email);
    res.json({ ok: true, verification_sent: mail.sent });
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

  // Password recovery. The answer never reveals whether an account exists. The link holds no plan information.
  const resetLimit = rateLimiter(5, 60 * 60e3);
  r.post('/auth/password/forgot', async (req, res) => {
    if (!resetLimit(req.ip)) { securityLog('password_reset_rate_limited', { ip: req.ip }); fail(429, 'rate', 'Too many attempts. Please wait a few minutes.'); }
    const email = str(req.body.email, 200, 'Email', { required: true }).toLowerCase();
    // Always the same answer, sent straight away: it never shows whether an account exists. Whether reset emails are
    // switched on at all is in /api/meta (passwordReset), the same for every address.
    if (!emailConfigured() || !forgotEmailLimit(email)) return res.json({ ok: true });
    const u = db.prepare("SELECT id FROM users WHERE email = ? AND is_demo = 0 AND is_guest = 0 AND password_hash NOT IN ('deleted')").get(email);
    if (u) {
      const token = crypto.randomBytes(24).toString('base64url');
      db.prepare('DELETE FROM password_tokens WHERE user_id = ?').run(u.id);
      db.prepare('INSERT INTO password_tokens (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha(token), u.id, new Date(Date.now() + 3600e3).toISOString());
      sendEmail({
        to: email, subject: `Choose a new password for ${config.appName}`,
        text: `Hi!\n\nSomeone asked to reset the password of your ${config.appName} account. To choose a new one, open this link within 1 hour:\n${origin(req)}/#/reset?token=${token}\n\nIf this wasn't you, ignore this email. Your password stays the same.`,
      }).catch((e) => console.error(e));
    }
    res.json({ ok: true });
  });
  r.post('/auth/password/reset', (req, res) => {
    if (!resetIpLimit(req.ip)) { securityLog('password_reset_rate_limited', { ip: req.ip }); fail(429, 'rate', 'Too many attempts. Please wait a few minutes.'); }
    const row = db.prepare('SELECT * FROM password_tokens WHERE token_hash = ?').get(sha(String(req.body.token || '')));
    if (!row || row.expires_at < now()) { securityLog('password_reset_bad_token', { ip: req.ip }); fail(400, 'invalid', 'This link is invalid or has expired. Ask for a new one from Log in.'); }
    const password = String(req.body.password || '');
    if (password.length < 8) fail(400, 'invalid', 'Password must be at least 8 characters.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.user_id);
    // The link was opened from the inbox, which shows the person receives email at this address.
    db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(now(), row.user_id);
    db.prepare('DELETE FROM password_tokens WHERE user_id = ?').run(row.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    securityLog('password_reset_done', { user: row.user_id, ip: req.ip });
    createSession(db, res, row.user_id, req);
    res.json({ ok: true });
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
        id: req.user.id, email: req.user.is_guest ? null : req.user.email, is_demo: req.user.is_demo, is_guest: req.user.is_guest, email_verified: !!p.email_verified_at, email_service: emailConfigured(), lang: p.lang,
        ...publicProfile(p), university: p.university, show_university: !!p.show_university,
        intro: p.intro, show_intro: !!p.show_intro, area: p.area, meet_area: p.meet_area || null, show_area: !!p.show_area,
        visible: !!p.visible, nearby_enabled: !!p.nearby_enabled, show_sample: !!p.show_sample, onboarded: !!p.onboarded, team: isAdmin(req), push_devices: push.count(req.user.id),
        city: city && { slug: city.slug, name: city.name, timezone: city.timezone },
      },
      counts: { toReview, invites, notifications: unreadNotifs, chats: unreadChats, dms: unreadDms(req.user.id), connect_requests: incomingCount(req.user.id) },
    });
  });

  r.put('/me/profile', auth, (req, res) => {
    const b = req.body;
    const city = cityBySlug(b.city);
    if (!city) fail(400, 'invalid', 'Unknown city.');
    const areas = J(city.areas).map((a) => a.key);
    const cur = profileOf(req.user.id);
    // Fields the client did not send stay as they are (the short sign-up only sends a first name).
    const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
    const area = has('area') ? (areas.includes(b.area) ? b.area : null) : cur.area;
    const date = (v) => (/^\d{4}-\d{2}(-\d{2})?$/.test(v || '') ? v : null);
    const stay = has('stay') ? (STAY_KINDS.includes(b.stay) ? b.stay : null) : cur.stay;
    // Dates only belong to "custom dates"; every other choice clears them. Older clients send dates without a stay kind.
    const keepDates = stay === 'custom' || (!has('stay') && (has('exchange_start') || has('exchange_end')));
    const start = keepDates ? date(has('exchange_start') ? b.exchange_start : cur.exchange_start) : null;
    const end = keepDates ? date(has('exchange_end') ? b.exchange_end : cur.exchange_end) : null;
    if (start && end && end < start) fail(400, 'invalid', 'The end date is before the start date.');
    if (has('show_intro')) db.prepare('UPDATE profiles SET show_intro = ? WHERE user_id = ?').run(b.show_intro ? 1 : 0, req.user.id);
    if (has('show_area')) db.prepare('UPDATE profiles SET show_area = ? WHERE user_id = ?').run(b.show_area ? 1 : 0, req.user.id);
    db.prepare(`UPDATE profiles SET first_name=?, intro=?, city_id=?, area=?, meet_area=?, university=?, show_university=?, exchange_start=?, exchange_end=?,
      stay=?, flags=?, role=?, languages=?, interests=?, onboarded=1 WHERE user_id=?`).run(
      str(b.first_name, 40, 'First name', { required: true }), has('intro') ? str(b.intro, 280, 'Introduction') : cur.intro, city.id, area,
      has('meet_area') ? (str(b.meet_area, 80, 'Where you like to meet') || null) : cur.meet_area,
      has('university') ? (str(b.university, 80, 'University') || null) : cur.university, has('show_university') ? (b.show_university ? 1 : 0) : cur.show_university,
      start, end, stay, has('flags') ? JSON.stringify(flagList(b.flags)) : (cur.flags || '[]'),
      has('role') ? (['exchange', 'international', 'intern', 'local'].includes(b.role) ? b.role : 'exchange') : cur.role,
      has('languages') ? JSON.stringify(languageList(b.languages)) : cur.languages,
      has('interests') ? JSON.stringify(list(b.interests, CAT_KEYS.filter((k) => k !== 'other'))) : cur.interests, req.user.id,
    );
    res.json({ ok: true });
  });

  r.put('/me/status', auth, (req, res) => {
    // Statuses were removed in release 2. Older rows stay in the database but are not shown or extended.
    if (!process.env.ALLOW_STATUS) fail(410, 'removed', 'Statuses are no longer available. Create a plan instead.');
    const b = req.body || {};
    const p = profileOf(req.user.id);
    const city = cityById(p.city_id);
    const category = CAT_KEYS.includes(b.category) ? b.category : fail(400, 'invalid', 'Choose what you feel like doing.');
    const slot = SLOT_KEYS.includes(b.slot) ? b.slot : null;
    const area = J(city.areas).some((a) => a.key === b.area) ? b.area : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.until || '')) fail(400, 'invalid', 'Choose until when your status is shown.');
    const expires = localToUtcIso(`${b.until}T23:59`, city.timezone);
    if (!expires || expires <= now()) fail(400, 'invalid', 'The end date has already passed.');
    if (new Date(expires).getTime() - Date.now() > 31 * 864e5) fail(400, 'invalid', 'A status can be shown for up to 30 days.');
    db.prepare('UPDATE profiles SET status_category=?, status_slot=?, status_area=?, status_note=?, status_expires_at=? WHERE user_id=?')
      .run(category, slot, area, str(b.note, 80, 'Note'), expires, req.user.id);
    res.json({ status: statusOf(profileOf(req.user.id)) });
  });

  r.delete('/me/status', auth, (req, res) => {
    db.prepare('UPDATE profiles SET status_category=NULL, status_slot=NULL, status_area=NULL, status_note=NULL, status_expires_at=NULL WHERE user_id=?').run(req.user.id);
    res.json({ ok: true });
  });

  r.put('/me/privacy', auth, (req, res) => {
    const p = profileOf(req.user.id);
    const city = cityById(p.city_id);
    const b = req.body;
    const set = (col, val) => db.prepare(`UPDATE profiles SET ${col} = ? WHERE user_id = ?`).run(val, req.user.id);
    if ('visible' in b) set('visible', b.visible ? 1 : 0);
    // Location-based discovery was removed: it can be switched off, never on.
    if ('nearby_enabled' in b && !b.nearby_enabled) set('nearby_enabled', 0);
    if ('show_sample' in b) set('show_sample', b.show_sample ? 1 : 0);
    if ('lang' in b && ['en', 'es'].includes(b.lang)) set('lang', b.lang);
    // Only an approximate area name is ever stored: never coordinates.
    if ('area' in b) set('area', J(city.areas).some((a) => a.key === b.area) ? b.area : null);
    res.json({ ok: true });
  });

  /** Remove a person's data (account deletion and expired guests). */
  function eraseUser(uid) {
    tx(db, () => {
      const own = db.prepare("SELECT id FROM activities WHERE organiser_id = ? AND status = 'active'").all(uid);
      for (const a of own) {
        systemMsg(a.id, 'This activity was cancelled because the organiser deleted their account.');
        notifyMembers(a.id, ['accepted', 'pending', 'invited'], 'cancelled', null, 'The organiser deleted their account.');
      }
      db.prepare("UPDATE activities SET status='cancelled', cancel_reason='The organiser deleted their account.' WHERE organiser_id = ? AND status='active'").run(uid);
      db.prepare("UPDATE activities SET title='Cancelled activity', description='', meeting_point='', welcome_plan='', recognise_tip='', photo=NULL, photo_mime=NULL WHERE organiser_id = ?").run(uid);
      for (const m of db.prepare("SELECT activity_id FROM memberships WHERE user_id = ? AND status = 'accepted'").all(uid)) systemMsg(m.activity_id, 'A participant left (account deleted).');
      db.prepare('DELETE FROM memberships WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM messages WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM wishes WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM event_interests WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM event_messages WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM photos WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM recommendations WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM rec_likes WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM rec_saves WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM listing_messages WHERE buyer_id = ? OR sender_id = ?').run(uid, uid);
      db.prepare('DELETE FROM listings WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM listing_saves WHERE user_id = ?').run(uid);
      db.prepare('UPDATE feedback SET user_id = NULL WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?').run(uid, uid);
      db.prepare('DELETE FROM connections WHERE requester_id = ? OR target_id = ?').run(uid, uid);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM user_sources WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM answer_votes WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM answers WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM questions WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(uid);
      db.prepare('UPDATE notifications SET actor_id = NULL WHERE actor_id = ?').run(uid);
      db.prepare('DELETE FROM email_tokens WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM password_tokens WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM chat_reads WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM dm_reads WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM plan_reminders WHERE user_id = ?').run(uid);
      // Keep an anonymous row only so cancelled activities still reference an organiser; all personal data is removed.
      db.prepare("UPDATE profiles SET first_name='Deleted user', intro='', photo_v=0, area=NULL, meet_area=NULL, university=NULL, show_university=0, show_intro=0, show_area=0, exchange_start=NULL, exchange_end=NULL, stay=NULL, flags='[]', languages='[]', interests='[]', visible=0 WHERE user_id = ?").run(uid);
      db.prepare("UPDATE users SET email = ?, password_hash = 'deleted' WHERE id = ?").run(`deleted-${uid}@deleted.invalid`, uid);
    });
  }

  r.delete('/me', auth, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!u.is_demo && !u.is_guest && !verifyPassword(req.body?.password || '', u.password_hash)) fail(403, 'credentials', 'Password is not correct.');
    if (u.is_demo) fail(403, 'demo', 'Sample personas cannot be deleted. Log out instead.');
    eraseUser(u.id);
    res.clearCookie('sq_session', { path: '/' });
    res.json({ ok: true });
  });

  // ---------- students in the city ----------
  // Everyone who chose to be visible, with shared interests first. Plain rules, explained in the response.
  r.get('/people', auth, (req, res) => {
    // Profiles are for students with an account: guests and search engines never see the list.
    if (req.user.is_guest) return res.json({ people: [], account_needed: true });
    const me = profileOf(req.user.id);
    const blocked = blockedSet(req.user.id);
    const tests = hideTests(req.user.id);
    const mine = new Set(J(me.interests));
    const city = cityById(me.city_id);
    const areaName = (k) => J(city.areas).find((a) => a.key === k)?.name || null;
    const rows = db.prepare(`SELECT p.*, u.is_demo, u.is_guest FROM profiles p JOIN users u ON u.id = p.user_id
      WHERE p.city_id = ? AND p.visible = 1 AND p.onboarded = 1 AND u.is_guest = 0 AND p.user_id != ? AND p.first_name != 'Deleted user'`).all(me.city_id, req.user.id);
    const people = rows
      .filter((p) => !blocked.has(p.user_id) && !p.is_demo && !tests.has(p.user_id))
      .map((p) => {
        const interests = J(p.interests);
        const plans = db.prepare(`SELECT COUNT(*) AS n FROM activities WHERE organiser_id = ? AND status = 'active' AND starts_at > ?`).get(p.user_id, now()).n;
        return { ...personSummary(p), intro: p.show_intro ? p.intro : '', interests, area: p.show_area ? p.meet_area || areaName(p.area) : null, stay: p.stay || null, flags: J(p.flags || '[]'),
          shared: interests.filter((i) => mine.has(i)), open_plans: plans };
      })
      .sort((a, b) => (b.shared.length - a.shared.length) || (b.open_plans - a.open_plans));
    res.json({ people });
  });

  // ---------- people, blocking, reporting ----------
  r.get('/users/:id', auth, (req, res) => {
    const id = Number(req.params.id);
    if (blockedSet(req.user.id).has(id)) fail(404, 'not_found', 'Profile not available.');
    const p = profileOf(id);
    if (!p || p.first_name === 'Deleted user') fail(404, 'not_found', 'Profile not available.');
    const c = connBetween(req.user.id, id);
    if (id !== req.user.id) {
      if (req.user.is_guest) fail(401, 'account_needed', 'Create a free account to see other students’ profiles.');
      // "Only people in my plans can see me": then only people sharing a plan (or already connected) can open the profile.
      if (!p.visible && !p.is_demo && !sharesPlan(req.user.id, id) && !(c && (c.status === 'accepted' || c.target_id === req.user.id))) fail(404, 'not_found', 'Profile not available.');
    }
    res.json({ profile: publicProfile(p), blocked_by_me: false, connection: connectionView(c, req.user.id) });
  });

  /** Both people are in the same plan: organiser, accepted, asked to join or invited. */
  function sharesPlan(a, b) {
    return !!db.prepare(`WITH inv AS (SELECT id AS aid, organiser_id AS uid FROM activities
        UNION SELECT activity_id, user_id FROM memberships WHERE status IN ('accepted', 'pending', 'invited'))
      SELECT 1 FROM inv x JOIN inv y ON x.aid = y.aid WHERE x.uid = ? AND y.uid = ? LIMIT 1`).get(a, b);
  }

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
      // Blocking ends a connection and its private chat.
      db.prepare('DELETE FROM connections WHERE (requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?)').run(req.user.id, id, id, req.user.id);
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
    if (!reportLimit(`u${req.user.id}`) || !reportIpLimit(req.ip)) { securityLog('report_rate_limited', { user: req.user.id, ip: req.ip }); fail(429, 'rate', 'You sent a lot of reports. Please wait a little.'); }
    const type = ['user', 'activity', 'message', 'recommendation', 'event_message', 'listing', 'listing_message', 'direct_message', 'question', 'answer'].includes(req.body.target_type) ? req.body.target_type : fail(400, 'invalid', 'Unknown report type.');
    const reason = REPORT_REASONS.includes(req.body.reason) ? req.body.reason : fail(400, 'invalid', 'Please choose a reason.');
    const { lastInsertRowid } = db.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?,?,?,?,?)')
      .run(req.user.id, type, Number(req.body.target_id) || 0, reason, str(req.body.details, 1000, 'Details'));
    // Tell the team. The alert has no names or message text, only that a report is waiting and where to read it.
    const to = (process.env.TEAM_ALERT_EMAIL || '').split(',').map((x) => x.trim()).filter(Boolean);
    let alerted = false;
    if (to.length && emailConfigured()) {
      sendEmail({ to, subject: `New report in ${config.appName}: ${reason}`,
        text: `A new report is waiting in the team inbox.\n\nType: ${type}\nReason: ${reason}\nTime: ${now()}\n\nOpen the team inbox to read and review it:\n${origin(req)}/#/team\n` })
        .catch((e) => console.error('Report alert failed', e));
      alerted = true;
    }
    // Only answer "saved" once the row exists, so the app never shows a false confirmation.
    res.status(201).json({ ok: true, saved: true, id: Number(lastInsertRowid), team_alerted: alerted });
  });

  // ---------- team inbox (reports, feedback, numbers) ----------
  // Access is checked on the server for every request. A team member is an account with is_admin = 1. An account becomes one by
  // entering the team access code (ADMIN_TOKEN) once while logged in, or automatically when its confirmed email is in ADMIN_EMAILS.
  const adminEmails = () => (process.env.ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const isAdmin = (req) => {
    if (!req.user || req.user.is_guest) return false;
    const u = db.prepare('SELECT email, is_admin, email_verified_at FROM users WHERE id = ?').get(req.user.id);
    return !!u.is_admin || (!!u.email_verified_at && adminEmails().includes(u.email.toLowerCase()));
  };
  const requireAdmin = (req) => { if (!isAdmin(req)) fail(403, 'forbidden', 'Only the project team can open this page.'); };
  const unlockLimit = rateLimiter(5, 60 * 60e3);
  // The app calls this once each time it is opened. Test and example accounts are not counted.
  const canaryDay = (d = new Date()) => utcToLocalInput(d.toISOString(), 'Atlantic/Canary').slice(0, 10);
  r.post('/visit', auth, (req, res) => {
    const u = db.prepare('SELECT is_test, is_demo, is_guest FROM users WHERE id = ?').get(req.user.id);
    if (u && !u.is_test && !u.is_demo) {
      db.prepare(`INSERT INTO daily_visits (day, user_id, kind) VALUES (?, ?, ?)
        ON CONFLICT(day, user_id) DO UPDATE SET opens = opens + 1, kind = excluded.kind`).run(canaryDay(), req.user.id, u.is_guest ? 'guest' : 'account');
      // A tagged link (?src=instagram) is counted for the team. Only the tag is kept: no cookies, IPs or outside trackers.
      const src = String(req.body?.src || '').trim().toLowerCase();
      if (/^[a-z0-9][a-z0-9_-]{0,31}$/.test(src)) {
        db.prepare('INSERT OR IGNORE INTO visit_sources (day, user_id, src) VALUES (?, ?, ?)').run(canaryDay(), req.user.id, src);
        db.prepare('INSERT OR IGNORE INTO user_sources (user_id, src, day) VALUES (?, ?, ?)').run(req.user.id, src, canaryDay());
      }
    }
    res.json({ ok: true });
  });

  r.get('/team/me', auth, (req, res) => res.json({ admin: isAdmin(req), code_configured: !!process.env.ADMIN_TOKEN, alert_email: !!process.env.TEAM_ALERT_EMAIL, email_service: emailConfigured() }));
  r.post('/team/unlock', auth, (req, res) => {
    if (req.user.is_guest) fail(401, 'account_needed', 'Log in with your own account first.');
    if (!unlockLimit(`${req.user.id}|${req.ip}`)) { securityLog('team_unlock_rate_limited', { user: req.user.id, ip: req.ip }); fail(429, 'rate', 'Too many attempts. Please wait an hour.'); }
    const code = String(req.body.code || '');
    const want = process.env.ADMIN_TOKEN || '';
    const a = crypto.createHash('sha256').update(code).digest(); const b = crypto.createHash('sha256').update(want).digest();
    if (!want || want.length < 12 || !crypto.timingSafeEqual(a, b)) { securityLog('team_unlock_failed', { user: req.user.id, ip: req.ip }); fail(403, 'forbidden', 'That access code is not correct.'); }
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(req.user.id);
    securityLog('team_unlock_ok', { user: req.user.id, ip: req.ip });
    res.json({ ok: true, admin: true });
  });
  r.post('/team/leave', auth, (req, res) => { db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(req.user.id); res.json({ ok: true }); });

  // What a report is about, in a few words, with a link the team can open.
  function reportTarget(type, id) {
    const person = (uid) => (uid ? { id: uid, first_name: nameOf(uid) } : null);
    if (type === 'user') return { label: nameOf(id), link: `#/person/${id}`, author: person(id) };
    if (type === 'activity') { const a = db.prepare('SELECT title, organiser_id FROM activities WHERE id = ?').get(id); return a && { label: a.title, link: `#/activity/${id}`, author: person(a.organiser_id) }; }
    if (type === 'message') { const m = db.prepare('SELECT body, user_id, activity_id FROM messages WHERE id = ?').get(id); return m && { label: m.body.slice(0, 200), link: `#/activity/${m.activity_id}/chat`, author: person(m.user_id) }; }
    if (type === 'event_message') { const m = db.prepare('SELECT body, user_id, event_id FROM event_messages WHERE id = ?').get(id); return m && { label: m.body.slice(0, 200), link: `#/event/${m.event_id}/chat`, author: person(m.user_id) }; }
    if (type === 'recommendation') { const x = db.prepare('SELECT title, user_id FROM recommendations WHERE id = ?').get(id); return x && { label: x.title, link: '#/guide', author: person(x.user_id) }; }
    if (type === 'listing') { const x = db.prepare('SELECT title, user_id FROM listings WHERE id = ?').get(id); return x && { label: x.title, link: `#/market/${id}`, author: person(x.user_id) }; }
    // A reported private message is shown to the team (the reporter chose to share it); the rest of the chat is not.
    if (type === 'direct_message') { const x = db.prepare('SELECT body, sender_id FROM direct_messages WHERE id = ?').get(id); return x && { label: x.body.slice(0, 200), link: `#/person/${x.sender_id}`, author: person(x.sender_id) }; }
    if (type === 'question') { const x = db.prepare('SELECT body, user_id FROM questions WHERE id = ?').get(id); return x && { label: x.body.slice(0, 200), link: `#/ask/${id}`, author: person(x.user_id) }; }
    if (type === 'answer') { const x = db.prepare('SELECT body, user_id, question_id FROM answers WHERE id = ?').get(id); return x && { label: x.body.slice(0, 200), link: `#/ask/${x.question_id}`, author: person(x.user_id) }; }
    if (type === 'listing_message') { const x = db.prepare('SELECT body, sender_id, listing_id FROM listing_messages WHERE id = ?').get(id); return x && { label: x.body.slice(0, 200), link: `#/market/${x.listing_id}`, author: person(x.sender_id) }; }
    return null;
  }
  r.get('/team/reports', auth, (req, res) => {
    requireAdmin(req);
    const rows = db.prepare('SELECT * FROM reports ORDER BY (status = \'open\') DESC, id DESC LIMIT 300').all();
    res.json({ reports: rows.map((x) => ({ id: x.id, target_type: x.target_type, target_id: x.target_id, reason: x.reason, details: x.details, status: x.status,
      created_at: x.created_at, reviewed_at: x.reviewed_at, reviewed_by: x.reviewed_by ? nameOf(x.reviewed_by) : null,
      reporter: x.reporter_id ? { id: x.reporter_id, first_name: nameOf(x.reporter_id) } : null, target: reportTarget(x.target_type, x.target_id) })) });
  });
  const setReviewed = (table) => (req, res) => {
    requireAdmin(req);
    const reviewed = req.body.status !== 'open';
    const info = db.prepare(`UPDATE ${table} SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?`)
      .run(reviewed ? 'reviewed' : 'open', reviewed ? now() : null, reviewed ? req.user.id : null, Number(req.params.id));
    if (!info.changes) fail(404, 'not_found', 'Not found.');
    res.json({ ok: true, status: reviewed ? 'reviewed' : 'open' });
  };
  r.post('/team/reports/:id', auth, setReviewed('reports'));
  r.post('/team/feedback/:id', auth, setReviewed('feedback'));
  r.get('/team/feedback', auth, (req, res) => {
    requireAdmin(req);
    const rows = db.prepare('SELECT * FROM feedback ORDER BY (status = \'open\') DESC, id DESC LIMIT 500').all();
    res.json({ feedback: rows.map((f) => ({ id: f.id, kind: f.kind, body: f.body, screen: f.screen, reply_email: f.reply_email, status: f.status,
      created_at: f.created_at, reviewed_at: f.reviewed_at, reviewed_by: f.reviewed_by ? nameOf(f.reviewed_by) : null,
      from: f.user_id ? { id: f.user_id, first_name: nameOf(f.user_id) } : null })) });
  });
  // Campaign numbers: real people only. Example, demo, guest and test accounts (and their plans) are never counted.
  r.get('/team/numbers', auth, (req, res) => {
    requireAdmin(req);
    const real = "u.is_demo = 0 AND u.is_guest = 0 AND u.is_test = 0 AND u.password_hash != 'deleted'";
    const since = (days) => new Date(Date.now() - days * 864e5).toISOString();
    const n = (sql, ...a) => db.prepare(sql).get(...a).n;
    res.json({
      accounts: n(`SELECT COUNT(*) AS n FROM users u WHERE ${real}`),
      accounts_7d: n(`SELECT COUNT(*) AS n FROM users u WHERE ${real} AND u.created_at > ?`, since(7)),
      plans: n(`SELECT COUNT(*) AS n FROM activities a JOIN users u ON u.id = a.organiser_id WHERE a.is_sample = 0 AND ${real}`),
      plans_upcoming: n(`SELECT COUNT(*) AS n FROM activities a JOIN users u ON u.id = a.organiser_id WHERE a.is_sample = 0 AND a.status = 'active' AND a.starts_at > ? AND ${real}`, now()),
      joins: n(`SELECT COUNT(*) AS n FROM memberships m JOIN activities a ON a.id = m.activity_id JOIN users u ON u.id = m.user_id WHERE m.status = 'accepted' AND a.is_sample = 0 AND ${real}`),
      reports_open: n("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
      feedback_open: n("SELECT COUNT(*) AS n FROM feedback WHERE status = 'open'"),
      excluded_test_accounts: n('SELECT COUNT(*) AS n FROM users WHERE is_test = 1'),
      notifications_on: n(`SELECT COUNT(DISTINCT s.user_id) AS n FROM push_subscriptions s JOIN users u ON u.id = s.user_id WHERE ${real}`),
      visitors: (() => {
        const days = Array.from({ length: 14 }, (_, i) => canaryDay(new Date(Date.now() - i * 864e5)));
        const uniq = (from) => n('SELECT COUNT(DISTINCT user_id) AS n FROM daily_visits WHERE day >= ?', from);
        return {
          today: uniq(days[0]), last_7_days: uniq(days[6]), last_30_days: uniq(canaryDay(new Date(Date.now() - 29 * 864e5))),
          opens_7_days: n('SELECT COALESCE(SUM(opens), 0) AS n FROM daily_visits WHERE day >= ?', days[6]),
          daily: days.map((day) => {
            const r2 = db.prepare("SELECT COUNT(*) AS people, COALESCE(SUM(opens), 0) AS opens, SUM(kind = 'guest') AS guests FROM daily_visits WHERE day = ?").get(day);
            return { day, people: r2.people, guests: r2.guests || 0, accounts: r2.people - (r2.guests || 0), opens: r2.opens };
          }),
          counting_since: db.prepare('SELECT MIN(day) AS d FROM daily_visits').get().d,
        };
      })(),
      // Tagged links: people who opened the app from each tag, and accounts whose first tagged link it was.
      sources: (() => {
        const d7 = canaryDay(new Date(Date.now() - 6 * 864e5)); const d30 = canaryDay(new Date(Date.now() - 29 * 864e5));
        return db.prepare(`SELECT s.src,
            COUNT(DISTINCT CASE WHEN s.day >= ? THEN s.user_id END) AS people_7d,
            COUNT(DISTINCT CASE WHEN s.day >= ? THEN s.user_id END) AS people_30d,
            (SELECT COUNT(*) FROM user_sources f JOIN users u ON u.id = f.user_id WHERE f.src = s.src AND ${real}) AS accounts
          FROM visit_sources s JOIN users vu ON vu.id = s.user_id WHERE vu.is_test = 0 AND vu.is_demo = 0 GROUP BY s.src ORDER BY people_30d DESC, s.src LIMIT 40`).all(d7, d30)
          .map((x) => ({ src: x.src, people_7d: x.people_7d, people_30d: x.people_30d, accounts: x.accounts }));
      })(),
    });
  });

  // Every real account, for the team: what other students can already see, plus activity counts and last visit day.
  r.get('/team/profiles', auth, (req, res) => {
    requireAdmin(req);
    const rows = db.prepare(`SELECT p.*, u.created_at AS joined_at, u.email_verified_at, u.is_admin FROM profiles p JOIN users u ON u.id = p.user_id
      WHERE u.is_demo = 0 AND u.is_guest = 0 AND u.is_test = 0 AND u.password_hash != 'deleted' ORDER BY u.id DESC LIMIT 1000`).all();
    const c = (sql, id) => db.prepare(sql).get(id).n;
    res.json({ profiles: rows.map((p) => ({
      ...personSummary(p), intro: p.intro, interests: J(p.interests), stay: p.stay || null, meet_area: p.meet_area || null, flags: J(p.flags || '[]'),
      joined_at: p.joined_at, visible: !!p.visible, email_confirmed: !!p.email_verified_at, team: !!p.is_admin,
      last_visit: db.prepare('SELECT MAX(day) AS d FROM daily_visits WHERE user_id = ?').get(p.user_id).d,
      plans_created: c('SELECT COUNT(*) AS n FROM activities WHERE organiser_id = ?', p.user_id),
      plans_joined: c("SELECT COUNT(*) AS n FROM memberships WHERE user_id = ? AND status = 'accepted'", p.user_id),
      listings: c('SELECT COUNT(*) AS n FROM listings WHERE user_id = ?', p.user_id),
      reports_about: c("SELECT COUNT(*) AS n FROM reports WHERE target_type = 'user' AND target_id = ?", p.user_id),
    })) });
  });

  // Older script access with the x-admin-token header (kept for the team's scripts). Same rules as the team code:
  // at least 12 characters, compared in constant time, at most 5 wrong tries per hour and network, every miss logged.
  const scriptLimit = rateLimiter(5, 60 * 60e3);
  const requireScriptToken = (req) => {
    const want = process.env.ADMIN_TOKEN || '';
    const got = String(req.get('x-admin-token') || '');
    const ok = want.length >= 12 && crypto.timingSafeEqual(crypto.createHash('sha256').update(got).digest(), crypto.createHash('sha256').update(want).digest());
    if (ok) return;
    securityLog('admin_token_failed', { ip: req.ip, path: req.path });
    if (!scriptLimit(req.ip)) fail(429, 'rate', 'Too many attempts. Please wait an hour.');
    fail(403, 'forbidden', 'Forbidden.');
  };
  r.get('/admin/reports', (req, res) => {
    requireScriptToken(req);
    res.json({ reports: db.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT 200').all() });
  });

  // ---------- activities ----------
  // Example content never appears in discovery or search (pre-launch release 1). One read-only example plan lives in the app's Help.
  // Test accounts (qa-…@example.com) only see each other: real students never see their plans or profiles.
  const testIds = () => new Set(db.prepare('SELECT id FROM users WHERE is_test = 1').all().map((x) => x.id));
  const hideTests = (uid) => { const t = testIds(); return t.has(uid) ? new Set() : t; };
  function visibleFilter(rows, uid) {
    const blocked = blockedSet(uid);
    const tests = hideTests(uid);
    return rows.filter((a) => !blocked.has(a.organiser_id) && !a.is_sample && !tests.has(a.organiser_id));
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
    // Only plans the creator marked free count as free. Unknown or unspecified costs never match a budget filter.
    const withinBudget = (v) => v.cost_mode === 'free' || (v.cost_mode === 'estimate' && v.cost_eur <= budget.max);
    const size = (v) => (v.max_participants == null ? 'group' : v.max_participants <= 2 ? 'buddy' : v.max_participants <= 5 ? 'small' : 'group');
    return views.filter((v) =>
      (!q.category || v.category === q.category) &&
      (!budget || withinBudget(v)) &&
      (!q.size || size(v) === q.size) &&
      (!q.lang || v.languages.length === 0 || v.languages.includes(q.lang)) &&
      (q.beginner !== '1' || v.beginner_friendly) &&
      (q.open !== '1' || v.state === 'open') &&
      (!q.q || `${v.title} ${v.description} ${v.meeting_area}`.toLowerCase().includes(String(q.q).toLowerCase())));
  }

  r.get('/activities', auth, (req, res) => {
    const city = cityBySlug(req.query.city) || fail(404, 'not_found', 'Unknown city.');
    const rows = db.prepare(`SELECT * FROM activities WHERE city_id = ? AND status = 'active' AND is_sample = 0
      AND COALESCE(datetime(ends_at), datetime(starts_at, '+' || duration_min || ' minutes')) > datetime('now') ORDER BY starts_at LIMIT 300`).all(city.id);
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

  /**
   * What the creator said, and nothing more. Time is an exact time, a part of a day ("Saturday afternoon") or a day with the time
   * still to be agreed. Duration, cost and group size are optional and stay blank when skipped.
   * Older clients that still send starts_local / duration_min / cost_eur / max_participants keep working.
   */
  function readActivityInput(b, city, existing) {
    const tz = city.timezone;
    const mode = TIME_MODES.includes(b.time_mode) ? b.time_mode : 'exact';
    const dayMode = DAY_MODES.includes(b.day_mode) ? b.day_mode : 'day';
    let day; let lastDay = null;
    if (dayMode === 'day') {
      day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') ? b.day : (b.starts_local || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(400, 'invalid', 'Please choose a day.');
    } else {
      // Day not fixed yet: the plan is listed from the first possible day until the last one.
      if (mode === 'exact') fail(400, 'invalid', 'When the day isn’t fixed, choose a part of the day or “to be agreed”.');
      const today = utcToLocalInput(new Date().toISOString(), tz).slice(0, 10);
      const plus = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
      if (dayMode === 'weekend') { day = dow === 0 || dow === 6 ? today : plus(today, 6 - dow); lastDay = new Date(`${day}T12:00:00Z`).getUTCDay() === 0 ? day : plus(day, 1); }
      else if (dayMode === 'week') { day = today; lastDay = plus(today, 6); }
      else { day = today; lastDay = plus(today, 13); }
    }
    let startLocal; let endLocal = null; let win = null;
    if (mode === 'exact') {
      const time = /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : (b.starts_local || '').slice(11, 16);
      if (!/^\d{2}:\d{2}$/.test(time)) fail(400, 'invalid', 'Please choose a time, or pick a part of the day.');
      startLocal = `${day}T${time}`;
    } else if (mode === 'window') {
      win = TIME_WINDOWS[b.time_window] ? b.time_window : fail(400, 'invalid', 'Please choose morning, afternoon or evening.');
      [startLocal, endLocal] = TIME_WINDOWS[win].map((hm) => `${day}T${hm}`);
    } else {
      startLocal = `${day}T12:00`; // sorting only: shown as "time to be agreed"
      endLocal = `${day}T23:59`;
    }
    if (lastDay) endLocal = `${lastDay}T23:59`;
    const startsIso = localToUtcIso(startLocal, tz) || fail(400, 'invalid', 'Please choose a day.');
    const durationChoice = DURATIONS[b.duration_choice] ? b.duration_choice : null;
    const legacyDuration = b.duration_choice === undefined && Number(b.duration_min) >= 15 && Number(b.duration_min) <= 24 * 60 ? Math.round(Number(b.duration_min)) : 0;
    let endsIso;
    if (endLocal) endsIso = localToUtcIso(endLocal, tz);
    else {
      // Only used to decide when a plan stops being listed; never shown as a duration.
      const mins = durationChoice ? DURATIONS[durationChoice] : legacyDuration || 180;
      endsIso = new Date(new Date(startsIso).getTime() + mins * 60e3).toISOString();
      if (durationChoice === 'open') endsIso = [endsIso, localToUtcIso(`${day}T23:59`, tz)].sort()[1];
    }
    if (!existing && new Date(mode === 'exact' ? startsIso : endsIso) < new Date()) fail(400, 'invalid', mode === 'exact' ? 'The start time is in the past.' : 'That day has already passed.');

    // Group size: blank means no limit. A limit includes the creator.
    const rawMax = b.max_participants;
    const capped = !(rawMax === '' || rawMax == null || rawMax === 0);
    const max = capped ? Math.round(Number(rawMax)) : 30;
    if (capped && !(max >= 2 && max <= 30)) fail(400, 'invalid', 'Group size must be between 2 and 30 people, including you.');

    // Cost: free, an estimate per person, "there's a cost, amount unknown", or left blank.
    let costMode = COST_MODES.includes(b.cost_mode) ? b.cost_mode : null;
    if (b.cost_mode === undefined && Number(b.cost_eur) > 0) costMode = 'estimate';
    let cost = 0;
    if (costMode === 'estimate') {
      cost = Number(b.cost_eur);
      if (!(cost > 0 && cost <= 500)) fail(400, 'invalid', 'Add an estimated cost between €0.50 and €500, or choose another cost option.');
    }
    return {
      template: TEMPLATES.some((t) => t.key === b.template) ? b.template : 'other',
      category: CAT_KEYS.includes(b.category) ? b.category : 'other',
      title: str(b.title, 80, 'Title', { required: true }),
      description: str(b.description, 600, 'Description'),
      starts_at: startsIso, ends_at: endsIso, time_mode: mode, time_window: win, day_mode: dayMode,
      duration_min: durationChoice ? 0 : legacyDuration, duration_choice: durationChoice,
      meeting_area: str(b.meeting_area, 80, 'Meeting area', { required: true }),
      meeting_point: str(b.meeting_point, 200, 'Meeting point'),
      cost_eur: Math.round(cost * 100) / 100, cost_mode: costMode, max_participants: max, capped: capped ? 1 : 0,
      beginner_friendly: b.beginner_friendly ? 1 : 0,
      join_mode: b.join_mode === 'open' ? 'open' : 'request',
      emoji: PLAN_EMOJIS.includes(b.emoji) ? b.emoji : '',
    };
  }

  const requireAccount = (req) => {
    if (req.user.is_guest) fail(401, 'account_needed', 'Create a free account or log in to continue. It takes a few seconds and brings you straight back here.');
  };

  r.post('/activities', auth, (req, res) => {
    requireAccount(req);
    const p = profileOf(req.user.id);
    const city = cityById(p.city_id);
    const d = readActivityInput(req.body, city, null);
    const id = tx(db, () => {
      const { lastInsertRowid } = db.prepare(`INSERT INTO activities (city_id, organiser_id, template, category, title, description, starts_at, ends_at, time_mode, time_window,
        duration_min, duration_choice, meeting_area, meeting_point, cost_eur, cost_mode, max_participants, capped, beginner_friendly, is_sample, join_mode, emoji, day_mode)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        city.id, req.user.id, d.template, d.category, d.title, d.description, d.starts_at, d.ends_at, d.time_mode, d.time_window,
        d.duration_min, d.duration_choice, d.meeting_area, d.meeting_point, d.cost_eur, d.cost_mode, d.max_participants, d.capped, d.beginner_friendly,
        req.user.is_demo ? 1 : 0, d.join_mode, d.emoji, d.day_mode);
      // A student plan can point at an event (e.g. a visit to the Christmas market on a chosen day). It reserves nothing there.
      const ev = req.body.event_id && db.prepare("SELECT id FROM events WHERE id = ? AND city_id = ? AND status = 'active'").get(Number(req.body.event_id), city.id);
      if (ev) db.prepare('UPDATE activities SET event_id = ? WHERE id = ?').run(ev.id, lastInsertRowid);
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
      if (d.capped && d.max_participants < goingCount(a.id)) fail(409, 'capacity', `${goingCount(a.id)} people are already going. Remove someone before lowering the group size.`);
      db.prepare(`UPDATE activities SET template=?, category=?, title=?, description=?, starts_at=?, ends_at=?, time_mode=?, time_window=?, duration_min=?, duration_choice=?,
        meeting_area=?, meeting_point=?, cost_eur=?, cost_mode=?, max_participants=?, capped=?, beginner_friendly=?, join_mode=?, emoji=?, day_mode=?, updated_at=? WHERE id=?`).run(
        d.template, d.category, d.title, d.description, d.starts_at, d.ends_at, d.time_mode, d.time_window, d.duration_min, d.duration_choice,
        d.meeting_area, d.meeting_point, d.cost_eur, d.cost_mode, d.max_participants, d.capped, d.beginner_friendly, d.join_mode, d.emoji, d.day_mode, now(), a.id);
      const changes = [];
      if (d.starts_at !== a.starts_at || d.time_mode !== (a.time_mode || 'exact') || d.day_mode !== (a.day_mode || 'day')) changes.push('time');
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

  // Optional plan picture (resized in the browser). Only logged-in people see it.
  r.put('/activities/:id/photo', auth, (req, res) => {
    const a = ownActivity(req);
    photoRate(req);
    const { mime, buf } = readJpeg(req);
    const m = [null, mime];
    db.prepare('UPDATE activities SET photo_mime = ?, photo = ?, photo_v = photo_v + 1 WHERE id = ?').run(m[1], buf, a.id);
    res.json({ ok: true });
  });
  r.delete('/activities/:id/photo', auth, (req, res) => {
    const a = ownActivity(req);
    db.prepare('UPDATE activities SET photo_mime = NULL, photo = NULL, photo_v = photo_v + 1 WHERE id = ?').run(a.id);
    res.json({ ok: true });
  });
  r.get('/activities/:id/photo', auth, (req, res) => {
    const a = getActivity(req.params.id);
    if (blockedSet(req.user.id).has(a.organiser_id) || !a.photo_mime) fail(404, 'not_found', 'Not found.');
    res.set('Content-Type', a.photo_mime);
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(Buffer.from(a.photo));
  });

  // Request to join (or re-request after leaving).
  r.post('/activities/:id/requests', auth, (req, res) => {
    const uid = req.user.id;
    requireAccount(req);
    const result = tx(db, () => {
      const a = getActivity(req.params.id);
      if (a.organiser_id === uid) fail(409, 'own', 'You are the organiser of this activity.');
      if (a.is_sample && !req.user.is_demo) fail(409, 'example', 'This is an example plan, so nobody can join it.');
      if (a.status === 'cancelled') fail(409, 'cancelled', 'This activity was cancelled.');
      if (isPast(a)) fail(409, 'past', 'This activity has already happened.');
      if (blockedSet(uid).has(a.organiser_id)) fail(404, 'not_found', 'This activity is not available.');
      const m = membershipOf(a.id, uid);
      // A repeated tap on a request that already went through is answered with the current state, not a second request.
      if (m && ['pending', 'accepted'].includes(m.status)) return { status: m.status, repeated: true };
      if (isFull(a)) fail(409, 'full', 'This activity is full.');
      const msg = str(req.body.message, 280, 'Message');
      const open = a.join_mode === 'open';
      const status = open ? 'accepted' : 'pending';
      if (m) {
        if (m.status === 'pending') fail(409, 'duplicate', 'You already asked to join. Waiting for the organiser.');
        if (m.status === 'accepted') fail(409, 'duplicate', 'You are already going.');
        if (m.status === 'invited') fail(409, 'invited', 'You were invited. Accept the invitation instead.');
        if (m.status === 'declined' || m.status === 'removed') fail(403, 'not_allowed', 'The organiser has not accepted you for this activity.');
        db.prepare('UPDATE memberships SET status=?, message=?, created_at=?, updated_at=? WHERE id=?').run(status, msg, now(), now(), m.id);
      } else {
        db.prepare('INSERT INTO memberships (activity_id, user_id, status, message) VALUES (?, ?, ?, ?)').run(a.id, uid, status, msg);
      }
      if (open) {
        // Open plans: no approval step. The organiser can still remove someone afterwards.
        systemMsg(a.id, `${nameOf(uid)} joined.`);
        notify(a.organiser_id, 'joined', a.id, uid);
      } else notify(a.organiser_id, 'request_received', a.id, uid);
      return { status };
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
        if (isFull(a)) fail(409, 'full', 'The activity is full. Increase the group size or decline the request.');
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
    // Since release 2 anyone who is visible in Buddies can be invited to a specific plan. They decide whether to join.
    const tp = profileOf(targetId);
    return !!tp && !!tp.visible && !!tp.onboarded && !tp.is_guest && !tp.is_demo && tp.first_name !== 'Deleted user' && tp.city_id === a.city_id;
  }

  function invite(a, organiserId, targetId) {
    if (targetId === organiserId) fail(400, 'own', 'You cannot invite yourself.');
    if (a.status === 'cancelled' || isPast(a)) fail(409, 'state', 'This activity is not open.');
    if (blockedSet(organiserId).has(targetId)) fail(404, 'not_found', 'This person is not available.');
    if (!inviteEligible(a, targetId)) fail(403, 'not_eligible', 'This person cannot be invited right now.');
    // A brake on mass invitations: at most 30 a day per organiser.
    const sent = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE actor_id = ? AND kind = 'invited' AND created_at > ?").get(organiserId, new Date(Date.now() - 864e5).toISOString()).n;
    if (sent >= 30) fail(429, 'rate', 'You sent a lot of invitations today. Please try again tomorrow.');
    if (isFull(a)) fail(409, 'full', 'This activity is full.');
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
        requireAccount(req);
        if (isFull(a)) fail(409, 'full', 'Sorry, the activity filled up.');
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
    const others = db.prepare("SELECT user_id FROM memberships WHERE activity_id = ? AND status = 'accepted' UNION SELECT organiser_id FROM activities WHERE id = ?").all(a.id, a.id);
    for (const o of others) {
      if (o.user_id === req.user.id || blockedSet(o.user_id).has(req.user.id)) continue;
      push.sendChat(o.user_id, `a${a.id}`, { name: nameOf(req.user.id), plan: a.title, url: `/#/activity/${a.id}/chat`, tag: `chat-${a.id}` });
    }
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  // ---------- connections and private chat ----------
  // A "Connect" request is accepted or declined by the other person. A private chat exists only between connected people.
  // The requester is never told about a decline: the request simply stays "sent".
  const connBetween = (a, b) => db.prepare('SELECT * FROM connections WHERE (requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?)').get(a, b, b, a);
  const connectionView = (c, uid) => {
    if (!c) return null;
    const incoming = c.target_id === uid;
    if (c.status === 'declined') return incoming ? null : { id: c.id, status: 'pending', direction: 'outgoing' };
    return { id: c.id, status: c.status, direction: incoming ? 'incoming' : 'outgoing', note: incoming && c.status === 'pending' ? c.note : undefined };
  };
  const unreadDm = (cid, uid) => {
    const last = db.prepare('SELECT last_read_id FROM dm_reads WHERE connection_id = ? AND user_id = ?').get(cid, uid)?.last_read_id || 0;
    return db.prepare('SELECT COUNT(*) AS n FROM direct_messages WHERE connection_id = ? AND id > ? AND sender_id != ?').get(cid, last, uid).n;
  };
  const myConnections = (uid) => db.prepare("SELECT * FROM connections WHERE status = 'accepted' AND (requester_id = ? OR target_id = ?)").all(uid, uid)
    .filter((c) => !blockedSet(uid).has(c.requester_id === uid ? c.target_id : c.requester_id));
  const unreadDms = (uid) => myConnections(uid).reduce((n, c) => n + unreadDm(c.id, uid), 0);
  const incomingCount = (uid) => {
    const bl = blockedSet(uid);
    return db.prepare("SELECT requester_id FROM connections WHERE target_id = ? AND status = 'pending'").all(uid).filter((c) => !bl.has(c.requester_id)).length;
  };
  const connectLimit = rateLimiter(20, 24 * 3600e3);
  const myConn = (req) => {
    const c = db.prepare('SELECT * FROM connections WHERE id = ?').get(Number(req.params.id));
    if (!c || (c.requester_id !== req.user.id && c.target_id !== req.user.id)) fail(404, 'not_found', 'Not found.');
    const other = c.requester_id === req.user.id ? c.target_id : c.requester_id;
    if (blockedSet(req.user.id).has(other)) fail(404, 'not_found', 'Not found.');
    return { c, other };
  };

  r.post('/users/:id/connect', auth, (req, res) => {
    requireAccount(req);
    const id = Number(req.params.id);
    if (id === req.user.id) fail(400, 'invalid', 'You cannot connect with yourself.');
    if (blockedSet(req.user.id).has(id)) fail(404, 'not_found', 'This person is not available.');
    const tp = profileOf(id);
    if (!tp || !tp.visible || !tp.onboarded || tp.is_guest || tp.is_demo || tp.first_name === 'Deleted user') fail(403, 'not_eligible', 'You can’t connect with this person right now.');
    const existing = connBetween(req.user.id, id);
    if (existing) {
      // They already asked me: connecting means accepting.
      if (existing.target_id === req.user.id && existing.status === 'pending') {
        db.prepare("UPDATE connections SET status = 'accepted', responded_at = ? WHERE id = ?").run(now(), existing.id);
        notify(id, 'connect_accepted', null, req.user.id);
      }
      return res.json({ connection: connectionView(connBetween(req.user.id, id), req.user.id) });
    }
    if (!connectLimit(String(req.user.id))) fail(429, 'rate', 'You sent a lot of requests today. Please try again tomorrow.');
    const note = str(req.body?.note, 200, 'Message');
    db.prepare('INSERT INTO connections (requester_id, target_id, note) VALUES (?,?,?)').run(req.user.id, id, note);
    notify(id, 'connect_request', null, req.user.id);
    res.status(201).json({ connection: connectionView(connBetween(req.user.id, id), req.user.id) });
  });
  r.post('/connections/:id/:action(accept|decline)', auth, (req, res) => {
    const { c } = myConn(req);
    if (c.target_id !== req.user.id || c.status !== 'pending') fail(409, 'state', 'This request is no longer open.');
    const accept = req.params.action === 'accept';
    db.prepare('UPDATE connections SET status = ?, responded_at = ? WHERE id = ?').run(accept ? 'accepted' : 'declined', now(), c.id);
    db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND kind = 'connect_request' AND actor_id = ? AND read_at IS NULL").run(now(), req.user.id, c.requester_id);
    if (accept) notify(c.requester_id, 'connect_accepted', null, req.user.id);
    res.json({ connection: connectionView(db.prepare('SELECT * FROM connections WHERE id = ?').get(c.id), req.user.id) });
  });
  // Withdraw a request, or remove a connection (its chat goes too). The other person is not told.
  r.delete('/connections/:id', auth, (req, res) => {
    const { c } = myConn(req);
    if (c.status === 'declined' && c.target_id === req.user.id) fail(404, 'not_found', 'Not found.');
    db.prepare('DELETE FROM connections WHERE id = ?').run(c.id);
    res.json({ ok: true });
  });
  r.get('/connections', auth, (req, res) => {
    const uid = req.user.id;
    const bl = blockedSet(uid);
    const person = (id) => personSummary(profileOf(id));
    const incoming = db.prepare("SELECT * FROM connections WHERE target_id = ? AND status = 'pending' ORDER BY id DESC").all(uid)
      .filter((c) => !bl.has(c.requester_id)).map((c) => ({ id: c.id, person: person(c.requester_id), note: c.note, created_at: c.created_at }));
    const outgoing = db.prepare("SELECT * FROM connections WHERE requester_id = ? AND status IN ('pending','declined') ORDER BY id DESC").all(uid)
      .filter((c) => !bl.has(c.target_id)).map((c) => ({ id: c.id, person: person(c.target_id), created_at: c.created_at }));
    const connected = myConnections(uid).map((c) => {
      const other = c.requester_id === uid ? c.target_id : c.requester_id;
      const last = db.prepare('SELECT body, sender_id, created_at FROM direct_messages WHERE connection_id = ? ORDER BY id DESC LIMIT 1').get(c.id);
      return { id: c.id, person: person(other), unread: unreadDm(c.id, uid), last: last ? { body: last.body.slice(0, 80), mine: last.sender_id === uid, created_at: last.created_at } : null, since: c.responded_at };
    }).sort((a, b) => (b.last?.created_at || b.since || '').localeCompare(a.last?.created_at || a.since || ''));
    res.json({ incoming, outgoing, connected });
  });
  r.get('/connections/:id/messages', auth, (req, res) => {
    const { c, other } = myConn(req);
    if (c.status !== 'accepted') fail(403, 'not_connected', 'You can message each other once the request is accepted.');
    const after = Number(req.query.after) || 0;
    const rows = db.prepare('SELECT * FROM direct_messages WHERE connection_id = ? AND id > ? ORDER BY id LIMIT 200').all(c.id, after);
    const maxId = rows.length ? rows[rows.length - 1].id : after;
    if (maxId) db.prepare('INSERT INTO dm_reads (connection_id, user_id, last_read_id) VALUES (?,?,?) ON CONFLICT(connection_id, user_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)').run(c.id, req.user.id, maxId);
    res.json({ other: personSummary(profileOf(other)), messages: rows.map((m) => ({ id: m.id, body: m.body, mine: m.sender_id === req.user.id, created_at: m.created_at })) });
  });
  r.post('/connections/:id/messages', auth, (req, res) => {
    if (!msgLimit(String(req.user.id))) fail(429, 'rate', 'You are sending messages too quickly.');
    const { c, other } = myConn(req);
    if (c.status !== 'accepted') fail(403, 'not_connected', 'You can message each other once the request is accepted.');
    const body = str(req.body.body, 1000, 'Message', { required: true });
    const { lastInsertRowid } = db.prepare('INSERT INTO direct_messages (connection_id, sender_id, body) VALUES (?,?,?)').run(c.id, req.user.id, body);
    push.sendChat(other, `dm${c.id}`, { kind: 'dm', name: nameOf(req.user.id), url: `/#/dm/${c.id}`, tag: `dm-${c.id}` });
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  // ---------- pop-up notifications (Web Push) ----------
  const pushLimit = rateLimiter(10, 60 * 60e3);
  r.get('/push/key', (_req, res) => res.json({ key: push.publicKey }));
  r.post('/push/subscribe', auth, (req, res) => {
    const b = req.body || {};
    const endpoint = String(b.endpoint || '');
    const p256dh = String(b.keys?.p256dh || '');
    const authKey = String(b.keys?.auth || '');
    if (!/^https:\/\/[^\s]{10,}$/.test(endpoint) || endpoint.length > 1000 || !/^[\w-]{20,200}$/.test(p256dh) || !/^[\w-]{8,100}$/.test(authKey)) fail(400, 'invalid', 'This browser sent an invalid subscription.');
    // The server sends pop-ups to this address, so only the browsers' real push services are accepted (never other servers).
    let host = '';
    try { host = new URL(endpoint).hostname.toLowerCase(); } catch { /* checked below */ }
    if (!PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) { securityLog('push_endpoint_rejected', { user: req.user.id, host }); fail(400, 'invalid', 'This browser sent an invalid subscription.'); }
    if (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(req.user.id).n >= 10) {
      db.prepare('DELETE FROM push_subscriptions WHERE id = (SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY id LIMIT 1)').run(req.user.id);
    }
    push.subscribe(req.user.id, { endpoint, p256dh, auth: authKey });
    res.json({ ok: true, devices: push.count(req.user.id) });
  });
  r.post('/push/unsubscribe', auth, (req, res) => {
    push.unsubscribe(req.user.id, String(req.body?.endpoint || ''));
    res.json({ ok: true, devices: push.count(req.user.id) });
  });
  r.post('/push/test', auth, (req, res) => {
    if (!pushLimit(String(req.user.id))) fail(429, 'rate', 'Too many test notifications. Please wait a bit.');
    const devices = push.count(req.user.id);
    if (devices) push.send(req.user.id, 'test', { url: '/#/profile', tag: 'test' });
    res.json({ ok: true, devices });
  });
  if (process.env.NODE_ENV === 'test') r.get('/push/_sent', (_req, res) => res.json({ sent: push.sent }));

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
    out.events = db.prepare(`SELECT e.* FROM events e JOIN event_interests i ON i.event_id = e.id WHERE i.user_id = ?
      AND datetime(e.starts_at, '+' || e.duration_min || ' minutes') > datetime('now') ORDER BY e.starts_at`).all(uid)
      .map((e) => { const { _seekers, ...v } = eventView(e, uid); return v; });
    res.json(out);
  });

  // ---------- events (official or sample events; we never handle registration) ----------
  // A multi-day listing (e.g. a market) stays open until its last listed day.
  const eventPast = (e) => (e.listed_until ? new Date(e.listed_until).getTime() < Date.now() : isPast(e));

  function eventView(e, uid) {
    const city = cityById(e.city_id);
    const blocked = blockedSet(uid);
    const showSample = false; // examples are never mixed into discovery
    const seekers = db.prepare(`SELECT i.*, u.is_demo FROM event_interests i JOIN profiles p ON p.user_id = i.user_id JOIN users u ON u.id = i.user_id
      WHERE i.event_id = ? AND p.visible = 1`).all(e.id).filter((i) => !blocked.has(i.user_id) && (showSample || !i.is_demo));
    return {
      id: e.id, title: e.title, description: e.description, category: e.category, starts_at: e.starts_at,
      starts_local: utcToLocalInput(e.starts_at, city.timezone), timezone: city.timezone,
      duration_min: e.duration_min, venue: e.venue, organiser_name: e.organiser_name, official_url: e.official_url,
      price_note: e.price_note, is_sample: !!e.is_sample, status: e.status, photo_key: e.photo_key || null,
      // Real-event details (empty for example events): Spanish texts, venue address, ticketing, age, source and when it was checked.
      ext_id: e.ext_id || null, description_es: e.desc_es || null, price_es: e.price_es || null, price_short: e.price_short || null, listed_by: e.listed_by || null, note_en: e.note_en || null, note_es: e.note_es || null,
      venue_address: e.venue_address || null, ticket_platform: e.ticket_platform || null, ticket_url: e.ticket_url || null, age_note: e.age_note || null,
      source_name: e.source_name || null, source_url: e.source_url || null, checked_at: e.checked_at || null,
      series_key: e.series_key || null, series_label: e.series_label || null, time_known: e.time_known !== 0, listed_until: e.listed_until || null,
      state: e.status === 'cancelled' ? 'cancelled' : eventPast(e) ? 'past' : 'open',
      seeking_count: seekers.filter((s) => s.user_id !== uid).length,
      approx: e.lat != null ? { lat: e.lat, lng: e.lng, area: e.venue } : approxSpot(city, e.venue),
      chat_count: db.prepare('SELECT COUNT(*) AS n FROM event_messages WHERE event_id = ?').get(e.id).n,
      tickets_count: db.prepare("SELECT COUNT(*) AS n FROM listings WHERE event_id = ? AND kind = 'ticket' AND status != 'sold'").get(e.id).n,
      groups_count: db.prepare("SELECT COUNT(*) AS n FROM activities WHERE event_id = ? AND status = 'active' AND is_sample = 0 AND starts_at > ?").get(e.id, now()).n,
      i_am_seeking: seekers.some((s) => s.user_id === uid) || !!db.prepare('SELECT 1 FROM event_interests WHERE event_id=? AND user_id=?').get(e.id, uid),
      _seekers: seekers,
    };
  }

  r.get('/events', auth, (req, res) => {
    const city = cityBySlug(req.query.city) || fail(404, 'not_found', 'Unknown city.');
    const showSample = false; // examples are never mixed into discovery
    const rows = db.prepare(`SELECT * FROM events WHERE city_id = ? AND status = 'active'
      AND COALESCE(datetime(listed_until), datetime(starts_at, '+' || duration_min || ' minutes')) > datetime('now') ORDER BY starts_at`).all(city.id)
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
    // Profiles are for students with an account (same rule as Buddies): guests see how many, not who.
    v.seekers = mine && !req.user.is_guest ? _seekers.filter((s) => s.user_id !== uid).map((s) => {
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
    // Other dates or sessions of the same listing, each its own event with its own link.
    v.sessions = e.series_key ? db.prepare(`SELECT id, starts_at FROM events WHERE series_key = ? AND status = 'active'
      AND datetime(starts_at, '+' || duration_min || ' minutes') > datetime('now') ORDER BY starts_at`).all(e.series_key) : [];
    v.groups = db.prepare("SELECT * FROM activities WHERE event_id = ? AND status = 'active' AND is_sample = 0").all(e.id)
      .filter((a) => !blocked.has(a.organiser_id)).map((a) => activityView(a, uid));
    res.json({ event: v });
  });

  r.put('/events/:id/interest', auth, (req, res) => {
    const e = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id)) || fail(404, 'not_found', 'Event not found.');
    if (e.status === 'cancelled' || eventPast(e)) fail(409, 'state', 'This event is not upcoming.');
    const b = req.body;
    const pref = ['buddy', 'small', 'either'].includes(b.group_pref) ? b.group_pref : 'either';
    db.prepare(`INSERT INTO event_interests (event_id, user_id, group_pref, languages, meeting_option, note) VALUES (?,?,?,?,?,?)
      ON CONFLICT(event_id, user_id) DO UPDATE SET group_pref=excluded.group_pref, languages=excluded.languages, meeting_option=excluded.meeting_option, note=excluded.note`)
      .run(e.id, req.user.id, pref, JSON.stringify(languageList(b.languages)), str(b.meeting_option, 80, 'Meeting option'), str(b.note, 200, 'Note'));
    res.json({ ok: true });
  });

  r.delete('/events/:id/interest', auth, (req, res) => {
    db.prepare('DELETE FROM event_interests WHERE event_id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  // Invite someone who is also looking for company. Creates (or reuses) my "going together" group for the event.
  r.post('/events/:id/invite', auth, (req, res) => {
    requireAccount(req);
    const uid = req.user.id;
    const out = tx(db, () => {
      const e = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id)) || fail(404, 'not_found', 'Event not found.');
      const mine = db.prepare('SELECT * FROM event_interests WHERE event_id = ? AND user_id = ?').get(e.id, uid);
      if (!mine) fail(409, 'no_interest', 'First tell us you are looking for company for this event.');
      // From an event page you can only invite people who said they are looking for company for that event.
      if (!db.prepare('SELECT 1 FROM event_interests WHERE event_id = ? AND user_id = ?').get(e.id, Number(req.body.userId))) fail(403, 'not_eligible', 'This person is not looking for company for this event.');
      let a = db.prepare("SELECT * FROM activities WHERE event_id = ? AND organiser_id = ? AND status = 'active'").get(e.id, uid);
      if (!a) {
        const meet = new Date(new Date(e.starts_at).getTime() - 20 * 60e3).toISOString();
        const max = mine.group_pref === 'buddy' ? 2 : 4;
        const p = profileOf(uid);
        const { lastInsertRowid } = db.prepare(`INSERT INTO activities (city_id, organiser_id, event_id, template, category, title, description, starts_at, duration_min,
          meeting_area, cost_eur, max_participants, beginner_friendly, languages, welcome_plan, recognise_tip, is_sample)
          VALUES (?,?,?,?,?,?,?,?,?,?,0,?,0,?,?,?,?)`).run(
          e.city_id, uid, e.id, 'other', e.category, `Going together: ${e.title}`.slice(0, 80),
          'A small group going to this event together. Joining this group does not register you for the event or buy a ticket. Use the official link for that.',
          meet, e.duration_min + 20, mine.meeting_option || `Near ${e.venue}`, max, mine.languages,
          '', '', req.user.is_demo ? 1 : 0);
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
    // Wishes and wish matching were removed in release 2; nothing subscribes people to alerts any more. Old rows are kept.
    if (!process.env.ALLOW_STATUS) fail(410, 'removed', 'Wishes are no longer available. Create a plan or invite someone from Buddies instead.');
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
        if (blocked.has(o.user_id) || o.is_demo) continue;
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
    const rows = db.prepare(`SELECT n.*, a.title, a.status AS astatus, l.title AS ltitle, q.body AS qbody FROM notifications n LEFT JOIN activities a ON a.id = n.activity_id
      LEFT JOIN listings l ON l.id = n.listing_id LEFT JOIN questions q ON q.id = n.question_id WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 50`).all(req.user.id);
    res.json({
      notifications: rows.filter((n) => !blocked.has(n.actor_id)).map((n) => ({
        id: n.id, kind: n.kind, detail: n.detail, read: !!n.read_at, created_at: n.created_at,
        activity: n.activity_id ? { id: n.activity_id, title: n.title, status: n.astatus } : null,
        listing: n.listing_id ? { id: n.listing_id, title: n.ltitle } : null,
        question: n.question_id && n.qbody ? { id: n.question_id, title: n.qbody.length > 60 ? `${n.qbody.slice(0, 57)}…` : n.qbody } : null,
        actor: n.actor_id ? { id: n.actor_id, first_name: nameOf(n.actor_id) } : null,
      })),
      // Unread chat messages, one line per plan (not one per message).
      chats: db.prepare(`SELECT id, title FROM activities WHERE status = 'active' AND (organiser_id = ? OR id IN
        (SELECT activity_id FROM memberships WHERE user_id = ? AND status = 'accepted'))`).all(req.user.id, req.user.id)
        .map((a) => ({ activity: { id: a.id, title: a.title }, unread: unreadChat(a.id, req.user.id) })).filter((c) => c.unread > 0),
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
  // ---------- profile pictures ----------
  const PHOTO_TYPES = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
  r.put('/me/photo', auth, (req, res) => {
    photoRate(req);
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data || ''));
    if (!m) fail(400, 'invalid', 'Please choose a JPEG, PNG or WebP picture.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 600 * 1024) fail(413, 'too_large', 'That picture is too large. Please choose a smaller one.');
    if (!PHOTO_TYPES[m[1]].every((b, i) => buf[i] === b)) fail(400, 'invalid', 'That file does not look like a picture.');
    const clean = stripImageMetadata(buf, m[1]) || fail(400, 'invalid', 'That file does not look like a picture.');
    db.prepare(`INSERT INTO photos (user_id, mime, data, updated_at) VALUES (?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET mime=excluded.mime, data=excluded.data, updated_at=excluded.updated_at`).run(req.user.id, m[1], clean, now());
    db.prepare('UPDATE profiles SET photo_v = photo_v + 1 WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  });
  r.delete('/me/photo', auth, (req, res) => {
    db.prepare('DELETE FROM photos WHERE user_id = ?').run(req.user.id);
    db.prepare('UPDATE profiles SET photo_v = 0 WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  });
  // Only logged-in people can see pictures, and never someone who blocked them.
  r.get('/users/:id/photo', auth, (req, res) => {
    const id = Number(req.params.id);
    if (blockedSet(req.user.id).has(id)) fail(404, 'not_found', 'Not found.');
    if (id !== req.user.id) {
      const v = profileOf(id)?.photo_v;
      const k = String(req.query.k || '');
      const want = v ? photoKey(id, v) : '';
      if (!want || k.length !== want.length || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(want))) fail(404, 'not_found', 'Not found.');
    }
    const ph = db.prepare('SELECT mime, data FROM photos WHERE user_id = ?').get(id) || fail(404, 'not_found', 'Not found.');
    res.set('Content-Type', ph.mime);
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.send(Buffer.from(ph.data));
  });

  // ---------- student recommendations ----------
  const REC_KEYS = REC_CATEGORIES.map((c) => c.key);
  const getRec = (id) => db.prepare('SELECT * FROM recommendations WHERE id = ?').get(Number(id)) || fail(404, 'not_found', 'This recommendation no longer exists.');
  const recView = (x, uid) => ({
    id: x.id, category: x.category, title: x.title, body: x.body, area: x.area, url: x.url, is_sample: !!x.is_sample, created_at: x.created_at,
    author: personSummary(profileOf(x.user_id)), mine: x.user_id === uid,
    likes: db.prepare('SELECT COUNT(*) AS n FROM rec_likes WHERE rec_id = ?').get(x.id).n,
    liked: !!db.prepare('SELECT 1 FROM rec_likes WHERE rec_id = ? AND user_id = ?').get(x.id, uid),
    saved: !!db.prepare('SELECT 1 FROM rec_saves WHERE rec_id = ? AND user_id = ?').get(x.id, uid),
    approx: approxSpot(cityById(x.city_id), x.area),
  });
  r.get('/recommendations', auth, (req, res) => {
    const uid = req.user.id;
    const city = cityBySlug(req.query.city) || fail(404, 'not_found', 'Unknown city.');
    const blocked = blockedSet(uid);
    const showSample = false; // examples are never mixed into discovery
    let rows = db.prepare('SELECT * FROM recommendations WHERE city_id = ? ORDER BY id DESC LIMIT 300').all(city.id)
      .filter((x) => !blocked.has(x.user_id) && (showSample || !x.is_sample || x.user_id === uid));
    if (req.query.category) rows = rows.filter((x) => x.category === req.query.category);
    let out = rows.map((x) => recView(x, uid));
    if (req.query.saved === '1') out = out.filter((x) => x.saved);
    if (req.query.sort !== 'new') out.sort((a, b) => b.likes - a.likes || b.id - a.id);
    res.json({ recommendations: out });
  });
  r.post('/recommendations', auth, (req, res) => {
    requireAccount(req); // guests can read tips, sharing one needs an account (like Ask students)
    const b = req.body;
    const p = profileOf(req.user.id);
    const url = str(b.url, 300, 'Link');
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) fail(400, 'invalid', 'The link must start with http:// or https://');
    const { lastInsertRowid } = db.prepare('INSERT INTO recommendations (city_id, user_id, category, title, body, area, url, is_sample) VALUES (?,?,?,?,?,?,?,?)').run(
      p.city_id, req.user.id, REC_KEYS.includes(b.category) ? b.category : fail(400, 'invalid', 'Please choose a category.'),
      str(b.title, 80, 'Title', { required: true }), str(b.body, 500, 'Your tip'), str(b.area, 80, 'Area') || null, url || null, req.user.is_demo ? 1 : 0);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });
  r.delete('/recommendations/:id', auth, (req, res) => {
    const x = getRec(req.params.id);
    if (x.user_id !== req.user.id) fail(403, 'forbidden', 'You can only delete your own recommendations.');
    db.prepare('DELETE FROM recommendations WHERE id = ?').run(x.id);
    res.json({ ok: true });
  });
  for (const [kind, table] of [['like', 'rec_likes'], ['save', 'rec_saves']]) {
    r.put(`/recommendations/:id/${kind}`, auth, (req, res) => {
      const x = getRec(req.params.id);
      if (blockedSet(req.user.id).has(x.user_id)) fail(404, 'not_found', 'Not available.');
      db.prepare(`INSERT OR IGNORE INTO ${table} (rec_id, user_id) VALUES (?, ?)`).run(x.id, req.user.id);
      res.json({ ok: true });
    });
    r.delete(`/recommendations/:id/${kind}`, auth, (req, res) => {
      db.prepare(`DELETE FROM ${table} WHERE rec_id = ? AND user_id = ?`).run(Number(req.params.id), req.user.id);
      res.json({ ok: true });
    });
  }

  // ---------- ask students: questions about the city and answers from other students ----------
  const askLimit = rateLimiter(10, 24 * 3600e3);
  const answerLimit = rateLimiter(60, 24 * 3600e3);
  const getQuestion = (id) => db.prepare('SELECT * FROM questions WHERE id = ?').get(Number(id)) || fail(404, 'not_found', 'This question no longer exists.');
  const needAccount = (req) => { if (req.user.is_guest) fail(401, 'account_needed', 'Create a free account to ask or answer. It takes a few seconds.'); };
  // Hidden from each other: blocked people; test accounts are hidden from everyone else (they still see their own).
  const askHidden = (uid) => { const h = blockedSet(uid); for (const t of hideTests(uid)) h.add(t); return h; };
  const answerView = (x, uid) => ({
    id: x.id, body: x.body, created_at: x.created_at, author: personSummary(profileOf(x.user_id)), mine: x.user_id === uid,
    helpful: db.prepare('SELECT COUNT(*) AS n FROM answer_votes WHERE answer_id = ?').get(x.id).n,
    voted: !!db.prepare('SELECT 1 FROM answer_votes WHERE answer_id = ? AND user_id = ?').get(x.id, uid),
  });
  const questionView = (q, uid, hidden) => {
    const answers = db.prepare('SELECT * FROM answers WHERE question_id = ? ORDER BY id').all(q.id).filter((a) => !hidden.has(a.user_id));
    return { id: q.id, category: q.category, body: q.body, created_at: q.created_at, author: personSummary(profileOf(q.user_id)), mine: q.user_id === uid,
      answers: answers.length, last_answer_at: answers.length ? answers[answers.length - 1].created_at : null };
  };
  r.get('/questions', auth, (req, res) => {
    const uid = req.user.id;
    const city = cityBySlug(req.query.city) || cityById(profileOf(uid).city_id);
    const hidden = askHidden(uid);
    let out = db.prepare('SELECT * FROM questions WHERE city_id = ? ORDER BY id DESC LIMIT 300').all(city.id)
      .filter((q) => !hidden.has(q.user_id)).map((q) => questionView(q, uid, hidden));
    if (req.query.category) out = out.filter((q) => q.category === req.query.category);
    if (req.query.filter === 'unanswered') out = out.filter((q) => q.answers === 0);
    if (req.query.filter === 'mine') out = out.filter((q) => q.mine);
    res.json({ questions: out });
  });
  r.get('/questions/:id', auth, (req, res) => {
    const uid = req.user.id;
    const q = getQuestion(req.params.id);
    const hidden = askHidden(uid);
    if (hidden.has(q.user_id)) fail(404, 'not_found', 'This question no longer exists.');
    const answers = db.prepare('SELECT * FROM answers WHERE question_id = ? ORDER BY id').all(q.id).filter((a) => !hidden.has(a.user_id)).map((a) => answerView(a, uid))
      .sort((a, b) => b.helpful - a.helpful || a.id - b.id);
    if (q.user_id === uid) db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND question_id = ? AND read_at IS NULL').run(now(), uid, q.id);
    res.json({ question: questionView(q, uid, hidden), answers });
  });
  r.post('/questions', auth, (req, res) => {
    needAccount(req);
    const b = req.body || {};
    const category = REC_KEYS.includes(b.category) ? b.category : fail(400, 'invalid', 'Please choose a category.');
    const body = str(b.body, 300, 'Question', { required: true });
    if (body.length < 8) fail(400, 'invalid', 'Please write your question in a few more words.');
    if (!askLimit(String(req.user.id))) fail(429, 'rate', 'You asked a lot of questions today. Please try again tomorrow.');
    const { lastInsertRowid } = db.prepare('INSERT INTO questions (city_id, user_id, category, body) VALUES (?,?,?,?)').run(profileOf(req.user.id).city_id, req.user.id, category, body);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });
  r.delete('/questions/:id', auth, (req, res) => {
    const q = getQuestion(req.params.id);
    if (q.user_id !== req.user.id) fail(403, 'forbidden', 'You can only delete your own questions.');
    db.prepare('DELETE FROM questions WHERE id = ?').run(q.id);
    res.json({ ok: true });
  });
  r.post('/questions/:id/answers', auth, (req, res) => {
    needAccount(req);
    const q = getQuestion(req.params.id);
    if (askHidden(req.user.id).has(q.user_id)) fail(404, 'not_found', 'This question no longer exists.');
    const body = str(req.body?.body, 500, 'Answer', { required: true });
    if (!answerLimit(String(req.user.id))) fail(429, 'rate', 'You answered a lot today. Please try again tomorrow.');
    const { lastInsertRowid } = db.prepare('INSERT INTO answers (question_id, user_id, body) VALUES (?,?,?)').run(q.id, req.user.id, body);
    // Tell the person who asked (one unread update per question, and a pop-up if they turned them on).
    if (q.user_id !== req.user.id && !blockedSet(q.user_id).has(req.user.id)) {
      if (!db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND question_id = ? AND kind = 'answer' AND read_at IS NULL").get(q.user_id, q.id)) {
        db.prepare("INSERT INTO notifications (user_id, kind, question_id, actor_id) VALUES (?, 'answer', ?, ?)").run(q.user_id, q.id, req.user.id);
      }
      push.sendChat(q.user_id, `q${q.id}`, { kind: 'answer', name: nameOf(req.user.id), plan: q.body, url: `/#/ask/${q.id}`, tag: `answer-${q.id}` });
    }
    res.status(201).json({ id: Number(lastInsertRowid) });
  });
  r.delete('/answers/:id', auth, (req, res) => {
    const a = db.prepare('SELECT * FROM answers WHERE id = ?').get(Number(req.params.id)) || fail(404, 'not_found', 'Not found.');
    if (a.user_id !== req.user.id) fail(403, 'forbidden', 'You can only delete your own answers.');
    db.prepare('DELETE FROM answers WHERE id = ?').run(a.id);
    res.json({ ok: true });
  });
  r.put('/answers/:id/helpful', auth, (req, res) => {
    needAccount(req);
    const a = db.prepare('SELECT * FROM answers WHERE id = ?').get(Number(req.params.id)) || fail(404, 'not_found', 'Not found.');
    if (a.user_id === req.user.id) fail(400, 'invalid', 'You can’t mark your own answer as helpful.');
    db.prepare('INSERT OR IGNORE INTO answer_votes (answer_id, user_id) VALUES (?, ?)').run(a.id, req.user.id);
    res.json({ ok: true });
  });
  r.delete('/answers/:id/helpful', auth, (req, res) => {
    db.prepare('DELETE FROM answer_votes WHERE answer_id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  // ---------- event group chat (everyone who marked the event) ----------
  const eventFor = (id) => db.prepare('SELECT * FROM events WHERE id = ?').get(Number(id)) || fail(404, 'not_found', 'Event not found.');
  const inEvent = (eid, uid) => !!db.prepare('SELECT 1 FROM event_interests WHERE event_id = ? AND user_id = ?').get(eid, uid);
  r.get('/events/:id/messages', auth, (req, res) => {
    const e = eventFor(req.params.id);
    if (!inEvent(e.id, req.user.id)) fail(403, 'forbidden', 'Join the event group first to read this chat.');
    const blocked = blockedSet(req.user.id);
    const rows = db.prepare('SELECT * FROM event_messages WHERE event_id = ? AND id > ? ORDER BY id LIMIT 500').all(e.id, Number(req.query.after) || 0);
    const members = db.prepare('SELECT COUNT(*) AS n FROM event_interests WHERE event_id = ?').get(e.id).n;
    res.json({
      title: e.title, is_sample: !!e.is_sample, members, can_post: e.status === 'active' && !eventPast(e),
      messages: rows.map((m) => ({
        id: m.id, kind: 'user', created_at: m.created_at, mine: m.user_id === req.user.id, author: personSummary(profileOf(m.user_id)),
        body: blocked.has(m.user_id) ? null : m.body, hidden: blocked.has(m.user_id),
      })),
    });
  });
  r.post('/events/:id/messages', auth, (req, res) => {
    requireAccount(req);
    if (!msgLimit(String(req.user.id))) fail(429, 'rate', 'You are sending messages too quickly.');
    const e = eventFor(req.params.id);
    if (!inEvent(e.id, req.user.id)) fail(403, 'forbidden', 'Join the event group first to write in this chat.');
    if (e.status !== 'active' || eventPast(e)) fail(409, 'state', 'This event is over, so the chat is read-only.');
    const body = str(req.body.body, 1000, 'Message', { required: true });
    const { lastInsertRowid } = db.prepare('INSERT INTO event_messages (event_id, user_id, body) VALUES (?, ?, ?)').run(e.id, req.user.id, body);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  // ---------- feedback ----------
  const feedbackLimit = rateLimiter(10, 60 * 60e3);
  r.post('/feedback', auth, (req, res) => {
    if (!feedbackLimit(String(req.user.id)) || !feedbackIpLimit(req.ip)) fail(429, 'rate', 'Thanks! You have sent a lot of feedback this hour. Please try again later.');
    const kind = FEEDBACK_KINDS.some((k) => k.key === req.body.kind) ? req.body.kind : 'other';
    const reply = str(req.body.reply_email, 200, 'Email') || null;
    if (reply && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(reply)) fail(400, 'invalid', 'Please enter a valid email address, or leave it empty.');
    const { lastInsertRowid } = db.prepare('INSERT INTO feedback (user_id, kind, body, screen, reply_email) VALUES (?,?,?,?,?)')
      .run(req.user.id, kind, str(req.body.body, 2000, 'Feedback', { required: true }), str(req.body.screen, 60, 'Screen') || null, reply);
    res.status(201).json({ ok: true, saved: true, id: Number(lastInsertRowid) });
  });
  r.get('/admin/feedback', (req, res) => {
    requireScriptToken(req);
    res.json({ feedback: db.prepare('SELECT id, kind, body, screen, created_at FROM feedback ORDER BY id DESC LIMIT 500').all() });
  });

  // ---------- marketplace (no payments in the app) ----------
  const MK = MARKET_KINDS.map((k) => k.key);
  const MC = MARKET_CATEGORIES.map((c) => c.key);
  const getListing = (id) => db.prepare('SELECT * FROM listings WHERE id = ?').get(Number(id)) || fail(404, 'not_found', 'This listing no longer exists.');
  const listingView = (l, uid, full = false) => {
    const ev = l.event_id ? db.prepare('SELECT id, title, starts_at, is_sample, photo_key FROM events WHERE id = ?').get(l.event_id) : null;
    const v = {
      id: l.id, kind: l.kind, category: l.category, title: l.title, price_eur: l.price_eur, face_value_eur: l.face_value_eur,
      description: full ? l.description : l.description.slice(0, 140), area: l.area, status: l.status, is_sample: !!l.is_sample, created_at: l.created_at,
      // Tickets without their own picture show the event's city photo.
      photo: l.photo_mime ? `/api/market/${l.id}/photo?v=${encodeURIComponent(l.updated_at)}` : null,
      event: ev, seller: personSummary(profileOf(l.user_id)), mine: l.user_id === uid,
      saved: !!db.prepare('SELECT 1 FROM listing_saves WHERE listing_id = ? AND user_id = ?').get(l.id, uid),
      approx: approxSpot(cityById(l.city_id), l.area),
    };
    // Up to 4 pictures: the main one plus extras. Cards use the first.
    const extras = db.prepare('SELECT id FROM listing_photos WHERE listing_id = ? ORDER BY sort, id').all(l.id);
    v.photos = [...(v.photo ? [{ id: 'main', url: v.photo }] : []), ...extras.map((x) => ({ id: x.id, url: `/api/market/${l.id}/photos/${x.id}` }))];
    // Tickets without their own picture show the event's city photo.
    v.photo = v.photos[0]?.url || (ev?.photo_key && /^[a-z]+$/.test(ev.photo_key) ? `/photos/${ev.photo_key}.jpg` : null);
    return v;
  };
  function readListing(b) {
    const kind = MK.includes(b.kind) ? b.kind : fail(400, 'invalid', 'Please choose what kind of listing this is.');
    const category = kind === 'ticket' ? 'tickets' : MC.includes(b.category) ? b.category : 'other';
    const money = (v, field) => {
      if (v === '' || v == null) return null;
      const x = Number(v);
      if (!(x >= 0 && x <= 5000)) fail(400, 'invalid', `${field} must be between €0 and €5000.`);
      return Math.round(x * 100) / 100;
    };
    let price = kind === 'free' ? 0 : money(b.price_eur, 'Price');
    if (kind === 'sell' && price == null) fail(400, 'invalid', 'Please add a price.');
    let face = null; let eventId = null;
    if (kind === 'ticket') {
      face = money(b.face_value_eur, 'Original price');
      if (face == null) fail(400, 'invalid', 'Please add the price you paid for the ticket.');
      if (price == null) price = face;
      // Our own fairness rule: tickets are passed on at or below what the seller paid.
      if (price > face) fail(400, 'invalid', 'Tickets can only be offered at or below the price you paid.');
      if (b.event_id) eventId = (db.prepare('SELECT id FROM events WHERE id = ?').get(Number(b.event_id)) || fail(400, 'invalid', 'Unknown event.')).id;
    }
    return {
      kind, category, price, face, eventId,
      title: str(b.title, 80, 'Title', { required: true }), description: str(b.description, 1000, 'Description'), area: str(b.area, 80, 'Area') || null,
    };
  }
  r.get('/market', auth, (req, res) => {
    const uid = req.user.id;
    const city = cityBySlug(req.query.city) || fail(404, 'not_found', 'Unknown city.');
    const blocked = blockedSet(uid);
    const showSample = false; // examples are never mixed into discovery
    const mine = req.query.mine === '1';
    let rows = db.prepare(`SELECT * FROM listings WHERE city_id = ? ${mine ? 'AND user_id = ?' : "AND status != 'sold'"} ORDER BY id DESC LIMIT 300`)
      .all(...(mine ? [city.id, uid] : [city.id]))
      .filter((l) => !blocked.has(l.user_id) && (mine || showSample || !l.is_sample));
    if (req.query.kind) rows = rows.filter((l) => l.kind === req.query.kind);
    if (req.query.category) rows = rows.filter((l) => l.category === req.query.category);
    if (req.query.event) rows = rows.filter((l) => l.event_id === Number(req.query.event));
    if (req.query.q) { const q = String(req.query.q).toLowerCase(); rows = rows.filter((l) => `${l.title} ${l.description}`.toLowerCase().includes(q)); }
    let out = rows.map((l) => listingView(l, uid));
    if (req.query.saved === '1') out = out.filter((l) => l.saved);
    res.json({ listings: out });
  });
  r.get('/market/:id', auth, (req, res) => {
    const uid = req.user.id;
    const l = getListing(req.params.id);
    if (blockedSet(uid).has(l.user_id)) fail(404, 'not_found', 'This listing is not available.');
    const v = listingView(l, uid, true);
    if (l.user_id === uid) {
      const blocked = blockedSet(uid);
      v.conversations = db.prepare(`SELECT buyer_id, MAX(id) AS last_id, SUM(CASE WHEN sender_id != ? AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
        FROM listing_messages WHERE listing_id = ? GROUP BY buyer_id ORDER BY last_id DESC`).all(uid, l.id)
        .filter((c) => !blocked.has(c.buyer_id))
        .map((c) => ({ buyer: personSummary(profileOf(c.buyer_id)), unread: c.unread, last: db.prepare('SELECT body, created_at FROM listing_messages WHERE id = ?').get(c.last_id) }));
    }
    res.json({ listing: v });
  });
  r.post('/market', auth, (req, res) => {
    requireAccount(req); // no anonymous listings: guests can look, selling and messaging need an account
    const d = readListing(req.body);
    const p = profileOf(req.user.id);
    const { lastInsertRowid } = db.prepare(`INSERT INTO listings (city_id, user_id, kind, category, title, description, price_eur, face_value_eur, event_id, area, is_sample)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(p.city_id, req.user.id, d.kind, d.category, d.title, d.description, d.price, d.face, d.eventId, d.area, req.user.is_demo ? 1 : 0);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });
  const ownListing = (req) => {
    const l = getListing(req.params.id);
    if (l.user_id !== req.user.id) fail(403, 'forbidden', 'Only the seller can change this listing.');
    return l;
  };
  r.put('/market/:id', auth, (req, res) => {
    const l = ownListing(req);
    const d = readListing({ ...l, ...req.body });
    const status = ['active', 'reserved', 'sold'].includes(req.body.status) ? req.body.status : l.status;
    db.prepare(`UPDATE listings SET kind=?, category=?, title=?, description=?, price_eur=?, face_value_eur=?, event_id=?, area=?, status=?, updated_at=? WHERE id=?`)
      .run(d.kind, d.category, d.title, d.description, d.price, d.face, d.eventId, d.area, status, now(), l.id);
    res.json({ ok: true });
  });
  r.delete('/market/:id', auth, (req, res) => {
    const l = ownListing(req);
    db.prepare('DELETE FROM listings WHERE id = ?').run(l.id);
    res.json({ ok: true });
  });
  r.put('/market/:id/photo', auth, (req, res) => {
    const l = ownListing(req);
    photoRate(req);
    const { mime, buf } = readJpeg(req);
    const m = [null, mime];
    db.prepare('UPDATE listings SET photo_mime = ?, photo = ?, updated_at = ? WHERE id = ?').run(m[1], buf, now(), l.id);
    res.json({ ok: true });
  });
  r.post('/market/:id/photos', auth, (req, res) => {
    const l = ownListing(req);
    photoRate(req);
    const { mime, buf } = readJpeg(req);
    const id = tx(db, () => {
      const count = (l.photo_mime ? 1 : 0) + db.prepare('SELECT COUNT(*) AS n FROM listing_photos WHERE listing_id = ?').get(l.id).n;
      if (count >= 4) fail(409, 'limit', 'A listing can have up to 4 pictures.');
      if (!l.photo_mime) { db.prepare('UPDATE listings SET photo_mime = ?, photo = ?, updated_at = ? WHERE id = ?').run(mime, buf, now(), l.id); return 'main'; }
      const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM listing_photos WHERE listing_id = ?').get(l.id).s;
      return Number(db.prepare('INSERT INTO listing_photos (listing_id, sort, mime, data) VALUES (?,?,?,?)').run(l.id, sort, mime, buf).lastInsertRowid);
    });
    res.status(201).json({ ok: true, id });
  });
  r.delete('/market/:id/photos/:pid', auth, (req, res) => {
    const l = ownListing(req);
    if (req.params.pid === 'main') db.prepare('UPDATE listings SET photo_mime = NULL, photo = NULL, updated_at = ? WHERE id = ?').run(now(), l.id);
    else db.prepare('DELETE FROM listing_photos WHERE id = ? AND listing_id = ?').run(Number(req.params.pid), l.id);
    res.json({ ok: true });
  });
  r.get('/market/:id/photos/:pid', auth, (req, res) => {
    const l = getListing(req.params.id);
    const p = db.prepare('SELECT mime, data FROM listing_photos WHERE id = ? AND listing_id = ?').get(Number(req.params.pid), l.id);
    if (blockedSet(req.user.id).has(l.user_id) || !p) fail(404, 'not_found', 'Not found.');
    res.set('Content-Type', p.mime);
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(Buffer.from(p.data));
  });
  r.get('/market/:id/photo', auth, (req, res) => {
    const l = getListing(req.params.id);
    if (blockedSet(req.user.id).has(l.user_id) || !l.photo_mime) fail(404, 'not_found', 'Not found.');
    res.set('Content-Type', l.photo_mime);
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(Buffer.from(l.photo));
  });
  r.put('/market/:id/save', auth, (req, res) => {
    const l = getListing(req.params.id);
    db.prepare('INSERT OR IGNORE INTO listing_saves (listing_id, user_id) VALUES (?, ?)').run(l.id, req.user.id);
    res.json({ ok: true });
  });
  r.delete('/market/:id/save', auth, (req, res) => {
    db.prepare('DELETE FROM listing_saves WHERE listing_id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });
  // Private messages: the seller and one interested person. The seller passes ?buyer=ID to open a conversation.
  const convoOf = (req, l) => {
    const uid = req.user.id;
    if (l.user_id === uid) {
      const buyer = Number(req.query.buyer || req.body?.buyer) || fail(400, 'invalid', 'Choose a conversation.');
      if (!db.prepare('SELECT 1 FROM listing_messages WHERE listing_id = ? AND buyer_id = ?').get(l.id, buyer)) fail(404, 'not_found', 'No conversation with this person yet.');
      return buyer;
    }
    return uid;
  };
  r.get('/market/:id/messages', auth, (req, res) => {
    const uid = req.user.id;
    const l = getListing(req.params.id);
    if (blockedSet(uid).has(l.user_id)) fail(404, 'not_found', 'This listing is not available.');
    const buyer = convoOf(req, l);
    if (blockedSet(uid).has(buyer)) fail(404, 'not_found', 'This conversation is not available.');
    db.prepare('UPDATE listing_messages SET read_at = ? WHERE listing_id = ? AND buyer_id = ? AND sender_id != ? AND read_at IS NULL').run(now(), l.id, buyer, uid);
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND listing_id = ? AND read_at IS NULL').run(now(), uid, l.id);
    const rows = db.prepare('SELECT * FROM listing_messages WHERE listing_id = ? AND buyer_id = ? AND id > ? ORDER BY id LIMIT 500').all(l.id, buyer, Number(req.query.after) || 0);
    res.json({
      other: personSummary(profileOf(l.user_id === uid ? buyer : l.user_id)), title: l.title, status: l.status,
      messages: rows.map((m) => ({ id: m.id, kind: 'user', body: m.body, created_at: m.created_at, mine: m.sender_id === uid, author: personSummary(profileOf(m.sender_id)) })),
    });
  });
  r.post('/market/:id/messages', auth, (req, res) => {
    requireAccount(req);
    if (!msgLimit(String(req.user.id))) fail(429, 'rate', 'You are sending messages too quickly.');
    const uid = req.user.id;
    const l = getListing(req.params.id);
    if (blockedSet(uid).has(l.user_id)) fail(404, 'not_found', 'This listing is not available.');
    const buyer = convoOf(req, l);
    if (blockedSet(uid).has(buyer)) fail(404, 'not_found', 'This conversation is not available.');
    if (l.user_id !== uid && l.status === 'sold') fail(409, 'sold', 'This item is already sold.');
    const body = str(req.body.body, 1000, 'Message', { required: true });
    const { lastInsertRowid } = db.prepare('INSERT INTO listing_messages (listing_id, buyer_id, sender_id, body) VALUES (?,?,?,?)').run(l.id, buyer, uid, body);
    const to = l.user_id === uid ? buyer : l.user_id;
    // One unread notice per conversation is enough.
    if (!db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND listing_id = ? AND kind = 'market_message' AND read_at IS NULL").get(to, l.id)) {
      db.prepare("INSERT INTO notifications (user_id, kind, listing_id, actor_id) VALUES (?, 'market_message', ?, ?)").run(to, l.id, uid);
    }
    push.sendChat(to, `l${l.id}:${buyer}`, { kind: 'market_message', name: nameOf(uid), plan: l.title, url: '/#/plans', tag: `market-${l.id}` });
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  r.get('/guide', (req, res) => {
    const city = cityBySlug(req.query.city) || fail(404, 'not_found', 'Unknown city.');
    res.json({ city: city.name, items: db.prepare('SELECT section, kind, title, summary, url, source_name, checked_at FROM guide_items WHERE city_id = ? ORDER BY sort, id').all(city.id) });
  });

  // Expired guest accounts are erased in the background.
  const guestDays = Number(process.env.GUEST_DAYS || 7);
  const cleanupGuests = () => {
    const cutoff = new Date(Date.now() - guestDays * 864e5).toISOString();
    for (const g of db.prepare("SELECT id FROM users WHERE is_guest = 1 AND created_at < ?").all(cutoff)) {
      try { eraseUser(g.id); db.prepare('UPDATE users SET is_guest = 0 WHERE id = ?').run(g.id); } catch (e) { console.error('guest cleanup', e.message); }
    }
  };
  // Expired logins are removed too, so old session rows don't pile up in the database.
  const cleanup = () => { cleanupGuests(); db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()); db.prepare('DELETE FROM password_tokens WHERE expires_at < ?').run(now()); };
  cleanup();
  setInterval(cleanup, 6 * 3600e3).unref();

  // About an hour before a plan with an exact time, everyone going gets a reminder pop-up (once).
  const sendReminders = () => {
    const from = new Date(Date.now() + 40 * 60e3).toISOString();
    const to = new Date(Date.now() + 75 * 60e3).toISOString();
    const acts = db.prepare(`SELECT a.*, c.timezone FROM activities a JOIN cities c ON c.id = a.city_id
      WHERE a.status = 'active' AND a.is_sample = 0 AND COALESCE(a.time_mode, 'exact') = 'exact' AND a.starts_at > ? AND a.starts_at <= ?`).all(from, to);
    let n = 0;
    for (const a of acts) {
      const time = new Intl.DateTimeFormat('en-GB', { timeZone: a.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(a.starts_at));
      const people = db.prepare("SELECT user_id FROM memberships WHERE activity_id = ? AND status = 'accepted' UNION SELECT organiser_id FROM activities WHERE id = ?").all(a.id, a.id);
      for (const p of people) {
        if (db.prepare('INSERT OR IGNORE INTO plan_reminders (activity_id, user_id, sent_at) VALUES (?,?,?)').run(a.id, p.user_id, now()).changes) {
          push.send(p.user_id, 'reminder', { plan: a.title, time, area: a.meeting_area, url: `/#/activity/${a.id}`, tag: `reminder-${a.id}` });
          n++;
        }
      }
    }
    return n;
  };
  setInterval(() => { try { sendReminders(); } catch (e) { console.error('reminders', e.message); } }, 5 * 60e3).unref();
  if (process.env.NODE_ENV === 'test') r.post('/push/_remind', (_req, res) => res.json({ sent: sendReminders() }));

  return r;
}
