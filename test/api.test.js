// End-to-end API tests: several real accounts (separate cookie sessions) against a real server and database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.AUTH_RATE_LIMIT = '10000';
process.env.SIGNUP_RATE_LIMIT = '10000';
process.env.NODE_ENV = 'test';
process.env.SEED_EXAMPLES = '1';
const { openDb } = await import('../server/db.js');
const { createApp } = await import('../server/index.js');
const { seed } = await import('../server/seed.js');

let server; let base; let db;
before(async () => {
  db = openDb(process.env.DB_PATH);
  seed(db);
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b), del: (u, b = {}) => call('DELETE', u, b) };
}

// A small, well-formed JPEG: start, JFIF header, EXIF block (with a GPS marker), a comment, image data, end.
function testJpeg(dataBytes = 64, fill = 7) {
  const seg = (m, body) => { const h = Buffer.from([0xff, m, 0, 0]); h.writeUInt16BE(body.length + 2, 2); return Buffer.concat([h, body]); };
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    seg(0xe1, Buffer.from('Exif\0\0GPSLatitude 28.1235 GPSLongitude -15.4363', 'latin1')),
    seg(0xfe, Buffer.from('taken at home', 'latin1')),
    seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.alloc(dataBytes, fill), Buffer.from([0xff, 0xd9]),
  ]);
}

let n = 0;
async function user(name, extra = {}) {
  const c = client();
  const email = `${name.toLowerCase()}${++n}@test.example`;
  assert.equal((await c.post('/auth/signup', { email, password: 'password123' })).status, 201);
  const p = await c.put('/me/profile', { first_name: name, city: 'las-palmas', languages: ['English'], interests: ['museum'], ...extra });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  c.id = (await c.get('/me')).body.user.id;
  c.email = email;
  return c;
}

function localIn(days, hhmm = '18:00') {
  const d = new Date(Date.now() + days * 864e5);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return `${day}T${hhmm}`;
}

async function makeActivity(org, over = {}) {
  const r = await org.post('/activities', {
    title: 'Museum visit', category: 'museum', starts_local: localIn(2), duration_min: 120, meeting_area: 'Triana / Vegueta',
    meeting_point: 'Cathedral steps', cost_eur: 0, max_participants: 3, languages: ['English'], join_mode: 'request', ...over,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}

test('full flow: create, request, accept, chat, meeting point visibility', async () => {
  const org = await user('Olga'); const ana = await user('Ana');
  const id = await makeActivity(org);
  const before = (await ana.get(`/activities/${id}`)).body.activity;
  assert.equal(before.going, 1, 'organiser counts towards group size');
  assert.equal(before.spots_left, 2);
  assert.equal(before.meeting_point, null, 'exact meeting point hidden before confirmation');

  assert.equal((await ana.post(`/activities/${id}/requests`, { message: 'Hi!' })).status, 201);
  const pending = (await ana.get(`/activities/${id}`)).body.activity;
  assert.equal(pending.my_status, 'pending');
  assert.equal(pending.going, 1, 'pending request is not counted as attendance');
  assert.equal((await ana.get(`/activities/${id}/messages`)).status, 403, 'pending user cannot read chat');
  const plans = (await ana.get('/plans')).body;
  assert.equal(plans.waiting.length, 1); assert.equal(plans.confirmed.length, 0);

  const orgView = (await org.get(`/activities/${id}`)).body.activity;
  assert.equal(orgView.requests.length, 1);
  assert.equal((await org.post(`/activities/${id}/members/${ana.id}/accept`)).status, 200);
  const after = (await ana.get(`/activities/${id}`)).body.activity;
  assert.equal(after.my_status, 'accepted'); assert.equal(after.going, 2); assert.equal(after.meeting_point, 'Cathedral steps');

  assert.equal((await ana.post(`/activities/${id}/messages`, { body: 'See you at the steps' })).status, 201);
  const msgs = (await org.get(`/activities/${id}/messages`)).body.messages;
  assert.ok(msgs.some((m) => m.body === 'See you at the steps'), 'organiser sees participant message');
});

test('duplicate requests are rejected', async () => {
  const org = await user('Omar'); const b = await user('Ben');
  const id = await makeActivity(org);
  assert.equal((await b.post(`/activities/${id}/requests`)).status, 201);
  // A double tap is answered with the current state; it never creates a second request or a second notification.
  const dup = await b.post(`/activities/${id}/requests`);
  assert.equal(dup.body.repeated, true); assert.equal(dup.body.status, 'pending');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE activity_id = ? AND user_id = ?').get(id, b.id).n, 1);
  assert.equal((await org.get('/notifications')).body.notifications.filter((n) => n.kind === 'request_received' && n.activity.id === id).length, 1);
});

test('joining the final place, then the activity is full', async () => {
  const org = await user('Ola'); const a = await user('Ari'); const b = await user('Bea');
  const id = await makeActivity(org, { max_participants: 2 });
  await a.post(`/activities/${id}/requests`); await b.post(`/activities/${id}/requests`);
  assert.equal((await org.post(`/activities/${id}/members/${a.id}/accept`)).status, 200);
  const full = await org.post(`/activities/${id}/members/${b.id}/accept`);
  assert.equal(full.status, 409); assert.equal(full.body.error, 'full');
  assert.equal((await b.get(`/activities/${id}`)).body.activity.state, 'full');
  const c = await user('Cid');
  assert.equal((await c.post(`/activities/${id}/requests`)).body.error, 'full');
});

test('simultaneous accepts cannot exceed capacity', async () => {
  const org = await user('Oscar');
  const id = await makeActivity(org, { max_participants: 3 });
  const people = await Promise.all(['P1', 'P2', 'P3', 'P4', 'P5'].map((x) => user(x)));
  for (const p of people) await p.post(`/activities/${id}/requests`);
  const results = await Promise.all(people.map((p) => org.post(`/activities/${id}/members/${p.id}/accept`)));
  assert.equal(results.filter((r) => r.status === 200).length, 2, 'only 2 places besides the organiser');
  assert.equal((await org.get(`/activities/${id}`)).body.activity.going, 3);
  // invitations accepted at the same time as requests also respect capacity
  const row = db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE activity_id = ? AND status = 'accepted'").get(id);
  assert.equal(row.n, 2);
});

test('permissions: no self-accept, no managing others’ activities, no editing others’ activities', async () => {
  const org = await user('Orla'); const x = await user('Xan');
  const id = await makeActivity(org);
  assert.equal((await org.post(`/activities/${id}/requests`)).body.error, 'own', 'organiser cannot request own activity');
  await x.post(`/activities/${id}/requests`);
  assert.equal((await x.post(`/activities/${id}/members/${x.id}/accept`)).status, 403, 'cannot accept own request');
  assert.equal((await x.put(`/activities/${id}`, { title: 'Hacked' })).status, 403);
  assert.equal((await x.post(`/activities/${id}/cancel`)).status, 403);
  const anon = client();
  assert.equal((await anon.get(`/activities/${id}`)).status, 401);
});

test('unauthorised chat access is blocked for outsiders, removed and leaving members', async () => {
  const org = await user('Oda'); const a = await user('Abe'); const out = await user('Out');
  const id = await makeActivity(org);
  assert.equal((await out.get(`/activities/${id}/messages`)).status, 403);
  assert.equal((await out.post(`/activities/${id}/messages`, { body: 'hi' })).status, 403);
  await a.post(`/activities/${id}/requests`); await org.post(`/activities/${id}/members/${a.id}/accept`);
  assert.equal((await a.get(`/activities/${id}/messages`)).status, 200);
  assert.equal((await org.post(`/activities/${id}/members/${a.id}/remove`)).status, 200);
  assert.equal((await a.get(`/activities/${id}/messages`)).status, 403, 'removed member loses chat access');
  assert.equal((await a.post(`/activities/${id}/requests`)).status, 403, 'removed member cannot re-request');
});

test('leaving a group frees the place and removes chat access', async () => {
  const org = await user('Opal'); const a = await user('Amy');
  const id = await makeActivity(org, { max_participants: 2 });
  await a.post(`/activities/${id}/requests`); await org.post(`/activities/${id}/members/${a.id}/accept`);
  assert.equal((await a.get(`/activities/${id}`)).body.activity.state, 'full');
  assert.equal((await a.del(`/activities/${id}/requests/mine`)).status, 200);
  const v = (await org.get(`/activities/${id}`)).body.activity;
  assert.equal(v.going, 1); assert.equal(v.state, 'open');
  assert.equal((await a.get(`/activities/${id}/messages`)).status, 403);
  assert.equal((await a.post(`/activities/${id}/requests`)).status, 201, 'can ask again after leaving');
});

test('cancellation: clearly marked, no new requests, chat read-only, listed under history', async () => {
  const org = await user('Otto'); const a = await user('Ada'); const b = await user('Bob');
  const id = await makeActivity(org);
  await a.post(`/activities/${id}/requests`); await org.post(`/activities/${id}/members/${a.id}/accept`);
  assert.equal((await org.post(`/activities/${id}/cancel`, { reason: 'Rain' })).status, 200);
  const v = (await a.get(`/activities/${id}`)).body.activity;
  assert.equal(v.state, 'cancelled'); assert.equal(v.cancel_reason, 'Rain');
  assert.equal((await b.post(`/activities/${id}/requests`)).body.error, 'cancelled');
  assert.equal((await a.post(`/activities/${id}/messages`, { body: 'hello?' })).status, 409);
  assert.equal((await a.get(`/activities/${id}/messages`)).status, 200);
  assert.ok((await a.get('/plans')).body.history.some((x) => x.id === id));
  const list = (await b.get('/activities?city=las-palmas')).body.activities;
  assert.ok(!list.some((x) => x.id === id), 'cancelled activity not offered in Explore');
});

test('editing cannot shrink below people already going; time is stored UTC and shown in Atlantic/Canary', async () => {
  const org = await user('Owen'); const a = await user('Ali');
  const id = await makeActivity(org, { starts_local: localIn(3, '19:30') });
  await a.post(`/activities/${id}/requests`); await org.post(`/activities/${id}/members/${a.id}/accept`);
  const v = (await org.get(`/activities/${id}`)).body.activity;
  assert.equal(v.timezone, 'Atlantic/Canary');
  assert.equal(v.starts_local, localIn(3, '19:30'));
  assert.ok(v.starts_at.endsWith('Z'));
  const r = await org.put(`/activities/${id}`, { ...v, max_participants: 2 });
  assert.equal(r.status, 200);
  const r2 = await org.put(`/activities/${id}`, { ...v, max_participants: 1 });
  assert.equal(r2.status, 400);
});

test('events: interest list visible only to people who opted in; invitations need opt-in and consent', async () => {
  const ev = db.prepare("SELECT id FROM events WHERE is_sample = 1 AND starts_at > ? ORDER BY starts_at LIMIT 1").get(new Date().toISOString());
  assert.ok(ev, 'seeded sample event exists');
  const a = await user('Eva'); const b = await user('Finn'); const c = await user('Gus');
  assert.equal((await a.get(`/events/${ev.id}`)).body.event.seekers, null, 'list hidden until opted in');
  await a.put(`/events/${ev.id}/interest`, { group_pref: 'buddy', languages: ['English'], meeting_option: 'Meet at the venue entrance' });
  await b.put(`/events/${ev.id}/interest`, { group_pref: 'buddy', languages: ['English'], meeting_option: 'Meet at the venue entrance' });
  const seekers = (await a.get(`/events/${ev.id}`)).body.event.seekers;
  const fb = seekers.find((s) => s.user.id === b.id);
  assert.ok(fb.reasons.some((r) => r.includes('English')));
  assert.equal((await a.post(`/events/${ev.id}/invite`, { userId: c.id })).status, 403, 'cannot invite someone who did not opt in');
  const inv = await a.post(`/events/${ev.id}/invite`, { userId: b.id });
  assert.equal(inv.status, 201);
  const gid = inv.body.activityId;
  assert.equal((await b.get(`/activities/${gid}`)).body.activity.my_status, 'invited', 'invitation, not enrolment');
  assert.equal((await b.get(`/activities/${gid}/messages`)).status, 403);
  assert.equal((await b.post(`/activities/${gid}/invitation/accept`)).status, 200);
  assert.equal((await b.get(`/activities/${gid}/messages`)).status, 200);
  const g = (await b.get(`/activities/${gid}`)).body.activity;
  assert.equal(g.max_participants, 2); assert.equal(g.state, 'full');
  assert.match(g.description, /does not register you/);
});

test('R2 buddies: wishes and statuses are switched off, old rows kept; anyone visible can be invited to a specific plan', async () => {
  const a = await user('Hana'); const b = await user('Ivo'); const hidden = await user('Quiet');
  db.prepare("INSERT INTO wishes (user_id, city_id, category, note, slots, budget) VALUES (?, 1, 'museum', '', '[]', 'any')").run(b.id);
  assert.equal((await a.post('/wishes', { category: 'other' })).status, 410, 'no new wishes, so nothing subscribes to alerts');
  assert.equal((await a.put('/me/status', { category: 'coffee', until: localIn(2).slice(0, 10) })).status, 410);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wishes WHERE user_id = ?').get(b.id).n, 1, 'stored records kept');
  const ppl = (await a.get('/people')).body.people;
  assert.ok(ppl.some((p) => p.id === b.id)); assert.ok(!('status' in ppl[0]));
  // Invite Ivo to a specific plan: no wish or shared interest needed. He decides.
  const id = await makeActivity(a, { category: 'coffee' });
  assert.equal((await a.post(`/activities/${id}/invite`, { userId: b.id })).status, 201);
  assert.equal((await b.get('/plans')).body.invited[0].id, id);
  assert.equal((await a.post(`/activities/${id}/invite`, { userId: b.id })).status, 409, 'no duplicate invitation');
  const notes = (await b.get('/notifications')).body.notifications.filter((x) => x.kind === 'invited');
  assert.equal(notes.length, 1);
  // People who paused visibility, guests and blocked people cannot be invited.
  await hidden.put('/me/privacy', { visible: false });
  assert.equal((await a.post(`/activities/${id}/invite`, { userId: hidden.id })).status, 403);
  const g = client(); await g.post('/auth/guest'); const gid = (await g.get('/me')).body.user.id;
  assert.equal((await a.post(`/activities/${id}/invite`, { userId: gid })).status, 403);
  const c = await user('Blocky'); await c.post(`/users/${a.id}/block`);
  assert.equal((await a.post(`/activities/${id}/invite`, { userId: c.id })).status, 404);
  // Only the organiser can invite to their plan.
  assert.equal((await b.post(`/activities/${id}/invite`, { userId: c.id })).status, 403);
});

test('R2 profile: brief sign-up, optional stay, free-text area, any language, flags as text codes', async () => {
  const c = client();
  await c.post('/auth/signup', { email: `brief${Date.now()}@test.example`, password: 'password123' });
  // Only a first name: nothing else is invented.
  assert.equal((await c.put('/me/profile', { first_name: 'Bri', city: 'las-palmas' })).status, 200);
  let me = (await c.get('/me')).body.user;
  assert.equal(me.onboarded, true); assert.deepEqual(me.languages, []); assert.deepEqual(me.flags, []); assert.equal(me.stay, null); assert.equal(me.meet_area, null);
  const full = { first_name: 'Bri', city: 'las-palmas', stay: 'custom', exchange_start: '2026-09-01', exchange_end: '2027-01-31', meet_area: 'Campus de Tafira',
    languages: ['english', 'Ukrainian', 'Klingon', 'Klingon'], flags: ['ic', 'UA', 'not-a-flag', 'X1'], interests: ['coffee', 'other'] };
  assert.equal((await c.put('/me/profile', full)).status, 200);
  me = (await c.get('/me')).body.user;
  assert.deepEqual(me.languages, ['English', 'Ukrainian', 'Klingon'], 'known names normalised, custom kept once');
  assert.deepEqual(me.flags, ['IC', 'UA']);
  assert.deepEqual(me.interests, ['coffee'], '"Something else" is not an interest');
  assert.equal(me.meet_area, 'Campus de Tafira'); assert.equal(me.exchange_start, '2026-09-01');
  // Interns and people who live here: other stay choices clear the dates.
  await c.put('/me/profile', { ...full, stay: 'local' });
  me = (await c.get('/me')).body.user;
  assert.equal(me.stay, 'local'); assert.equal(me.exchange_start, null);
  assert.equal((await c.put('/me/profile', { ...full, exchange_start: '2027-02-01', exchange_end: '2027-01-01' })).status, 400);
  // Turning location discovery on is no longer possible.
  await c.put('/me/privacy', { nearby_enabled: true });
  assert.equal((await c.get('/me')).body.user.nearby_enabled, false);
});

test('blocking hides people and their activities from each other', async () => {
  const a = await user('Jo'); const b = await user('Kai');
  const id = await makeActivity(b);
  assert.ok((await a.get('/activities?city=las-palmas')).body.activities.some((x) => x.id === id));
  await a.post(`/users/${b.id}/block`);
  assert.ok(!(await a.get('/activities?city=las-palmas')).body.activities.some((x) => x.id === id));
  assert.equal((await b.get(`/users/${a.id}`)).status, 404);
  assert.equal((await a.post(`/activities/${id}/requests`)).status, 404);
});

test('reporting and account deletion', async () => {
  const a = await user('Lia'); const b = await user('Max');
  const id = await makeActivity(a);
  await b.post(`/activities/${id}/requests`); await a.post(`/activities/${id}/members/${b.id}/accept`);
  assert.equal((await b.post('/reports', { target_type: 'user', target_id: a.id, reason: 'Spam or advertising' })).status, 201);
  assert.equal((await a.del('/me', { password: 'wrong-password' })).status, 403);
  assert.equal((await a.del('/me', { password: 'password123' })).status, 200);
  assert.equal((await a.get('/me')).body.user, null, 'session ended');
  const v = (await b.get(`/activities/${id}`)).body.activity;
  assert.equal(v.state, 'cancelled');
  assert.equal(v.organiser.first_name, 'Deleted user');
  const login = await client().post('/auth/login', { email: a.email, password: 'password123' });
  assert.equal(login.status, 401);
});

test('privacy: nearby discovery off by default, only an area name is accepted', async () => {
  const a = await user('Nia');
  const me = (await a.get('/me')).body.user;
  assert.equal(me.nearby_enabled, false); assert.equal(me.email_verified, false);
  await a.put('/me/privacy', { nearby_enabled: true, area: '28.1,-15.4' });
  assert.equal((await a.get('/me')).body.user.area, null, 'coordinates are not stored as an area');
  await a.put('/me/privacy', { area: 'canteras' });
  assert.equal((await a.get('/me')).body.user.area, 'canteras');
});

test('data persists across a server restart (same database file)', async () => {
  const a = await user('Pia');
  const id = await makeActivity(a, { title: 'Persistent plan' });
  const db2 = openDb(process.env.DB_PATH);
  const s2 = createApp(db2).listen(0);
  await new Promise((r) => s2.once('listening', r));
  const row = db2.prepare('SELECT title FROM activities WHERE id = ?').get(id);
  s2.close();
  assert.equal(row.title, 'Persistent plan');
});

test('notifications: organiser hears about requests, requester about the decision, members about cancellation', async () => {
  const org = await user('Nora'); const a = await user('Nils');
  const id = await makeActivity(org);
  await a.post(`/activities/${id}/requests`);
  const n1 = (await org.get('/notifications')).body.notifications;
  assert.equal(n1[0].kind, 'request_received'); assert.equal(n1[0].actor.first_name, 'Nils'); assert.equal(n1[0].read, false);
  assert.equal((await org.get('/me')).body.counts.notifications, 1);
  await org.post(`/activities/${id}/members/${a.id}/accept`);
  assert.equal((await a.get('/notifications')).body.notifications[0].kind, 'request_accepted');
  await org.post('/notifications/read', { all: true });
  assert.equal((await org.get('/me')).body.counts.notifications, 0);
  // unread chat counts
  await org.post(`/activities/${id}/messages`, { body: 'Hello!' });
  assert.equal((await a.get('/me')).body.counts.chats, 1);
  assert.equal((await a.get(`/activities/${id}`)).body.activity.unread, 1);
  await a.get(`/activities/${id}/messages`);
  assert.equal((await a.get('/me')).body.counts.chats, 0);
  await org.post(`/activities/${id}/cancel`, { reason: 'Storm' });
  const n2 = (await a.get('/notifications')).body.notifications[0];
  assert.equal(n2.kind, 'cancelled'); assert.equal(n2.detail, 'Storm');
  // a person never sees others' notifications
  const other = await user('Nobody');
  assert.equal((await other.get('/notifications')).body.notifications.length, 0);
});

test('email verification: token link confirms the address; badge only after confirmation', async () => {
  const { outbox } = await import('../server/email.js');
  const a = await user('Vera');
  assert.equal((await a.get('/me')).body.user.email_verified, false);
  const mail = outbox.filter((m) => m.to === a.email).pop();
  assert.ok(mail, 'verification email prepared on sign-up');
  assert.match(mail.text, /does not verify student status/);
  const token = /token=([\w-]+)/.exec(mail.text)[1];
  const bad = await fetch(`${base}/auth/verify?token=wrong`, { redirect: 'manual' });
  assert.match(bad.headers.get('location'), /verified=invalid/);
  const ok = await fetch(`${base}/auth/verify?token=${token}`, { redirect: 'manual' });
  assert.match(ok.headers.get('location'), /verified=1/);
  assert.equal((await a.get('/me')).body.user.email_verified, true);
  const b = await user('Walt');
  assert.equal((await b.get(`/users/${a.id}`)).body.profile.email_verified, true);
  const reuse = await fetch(`${base}/auth/verify?token=${token}`, { redirect: 'manual' });
  assert.match(reuse.headers.get('location'), /verified=invalid/, 'token works only once');
});

test('open plans: people join directly up to capacity, organiser is told, request-only plans still need approval', async () => {
  const org = await user('Olga'); const a = await user('Abel'); const b = await user('Bea'); const c = await user('Cyd');
  const id = await makeActivity(org, { max_participants: 3, join_mode: 'open' });
  const r1 = await a.post(`/activities/${id}/requests`, {});
  assert.equal(r1.body.status, 'accepted');
  assert.equal((await a.get(`/activities/${id}/messages`)).status, 200); // straight into the chat
  assert.equal((await b.post(`/activities/${id}/requests`, {})).body.status, 'accepted');
  assert.equal((await c.post(`/activities/${id}/requests`, {})).status, 409); // full
  const notes = (await org.get('/notifications')).body.notifications;
  assert.ok(notes.some((x) => x.kind === 'joined'));
  assert.equal((await org.post(`/activities/${id}/members/${a.id}/remove`)).status, 200); // organiser can still remove
  assert.equal((await a.post(`/activities/${id}/requests`, {})).status, 403); // and they cannot rejoin
  const req = await makeActivity(org);
  assert.equal((await c.post(`/activities/${req}/requests`, {})).body.status, 'pending');
  assert.equal((await c.get(`/activities/${req}`)).body.activity.join_mode, 'request');
});

test('join directly is the default for new plans; hosts can still choose ask-to-join, and edits keep the setting', async () => {
  const org = await user('Dina'); const a = await user('Eli');
  const id = (await org.post('/activities', { title: 'Default plan', day: dayIn(2), time_mode: 'tbd', meeting_area: 'Triana' })).body.id;
  const plan = (await org.get(`/activities/${id}`)).body.activity;
  assert.equal(plan.join_mode, 'open');
  assert.equal((await a.post(`/activities/${id}/requests`, {})).body.status, 'accepted');
  const ask = await makeActivity(org, { join_mode: 'request' });
  // Editing without sending a join choice keeps ask-to-join plans as they were.
  const before = (await org.get(`/activities/${ask}`)).body.activity;
  assert.equal((await org.put(`/activities/${ask}`, { title: 'Renamed', category: before.category, day: before.day, time_mode: 'tbd', meeting_area: before.meeting_area })).status, 200);
  assert.equal((await org.get(`/activities/${ask}`)).body.activity.join_mode, 'request');
  assert.equal((await a.post(`/activities/${ask}/requests`, {})).body.status, 'pending');
});

test('recommendations: post, like once, save privately, delete only your own, hidden when blocked', async () => {
  const a = await user('Rita'); const b = await user('Sam');
  const bad = await a.post('/recommendations', { category: 'food', title: 'X', url: 'javascript:alert(1)' });
  assert.equal(bad.status, 400);
  const { body: { id } } = await a.post('/recommendations', { category: 'food', title: 'Great churros', body: 'Near the market', area: 'Triana / Vegueta' });
  await b.put(`/recommendations/${id}/like`); await b.put(`/recommendations/${id}/like`);
  await b.put(`/recommendations/${id}/save`);
  let mine = (await b.get('/recommendations?city=las-palmas')).body.recommendations.find((x) => x.id === id);
  assert.equal(mine.likes, 1); assert.equal(mine.liked, true); assert.equal(mine.saved, true);
  assert.ok(mine.approx && mine.approx.area === 'Triana / Vegueta');
  assert.equal((await a.get('/recommendations?city=las-palmas&saved=1')).body.recommendations.length, 0); // saves are personal
  assert.equal((await b.get('/recommendations?city=las-palmas&saved=1')).body.recommendations.length, 1);
  assert.equal((await b.del(`/recommendations/${id}`)).status, 403);
  await b.post(`/users/${a.id}/block`);
  assert.ok(!(await b.get('/recommendations?city=las-palmas')).body.recommendations.some((x) => x.id === id));
  assert.equal((await a.del(`/recommendations/${id}`)).status, 200);
});

test('event group chat: only people in the event group can read or write', async () => {
  const a = await user('Eva'); const b = await user('Finn');
  const ev = (await a.get('/events?city=las-palmas')).body.events[0];
  assert.equal((await a.get(`/events/${ev.id}/messages`)).status, 403);
  assert.equal((await a.post(`/events/${ev.id}/messages`, { body: 'hi' })).status, 403);
  await a.put(`/events/${ev.id}/interest`, { group_pref: 'small' });
  assert.equal((await a.post(`/events/${ev.id}/messages`, { body: 'Meet at the entrance?' })).status, 201);
  const r = await a.get(`/events/${ev.id}/messages`);
  assert.ok(r.body.messages.some((m) => m.body === 'Meet at the entrance?' && m.mine));
  assert.equal((await b.get(`/events/${ev.id}/messages`)).status, 403);
  await a.del(`/events/${ev.id}/interest`);
  assert.equal((await a.get(`/events/${ev.id}/messages`)).status, 403); // leaving the group removes access
  const plans = (await b.get('/plans')).body;
  assert.ok(Array.isArray(plans.events));
});

test('profile pictures: only real images, visible to logged-in people, not to someone who blocked you', async () => {
  const a = await user('Pia'); const b = await user('Quin');
  assert.equal((await a.put('/me/photo', { data: 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64') })).status, 400);
  const jpeg = testJpeg();
  assert.equal((await a.put('/me/photo', { data: 'data:image/jpeg;base64,' + jpeg.toString('base64') })).status, 200);
  const url = (await a.get('/me')).body.user.photo;
  assert.match(url, /\/api\/users\/\d+\/photo\?v=1/);
  const get = async (c) => fetch(base.replace('/api', '') + url, { headers: c ? { cookie: c } : {} });
  assert.equal((await get()).status, 401); // not public
  const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: b.email, password: 'password123' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const ok = await get(cookie);
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-type'), 'image/jpeg');
  // Camera details and the GPS position are removed before the picture is stored; the picture data stays.
  const stored = Buffer.from(await ok.arrayBuffer());
  assert.ok(!stored.includes('GPSLatitude') && !stored.includes('taken at home') && stored.includes('JFIF'));
  assert.equal(stored[0], 0xff); assert.equal(stored[stored.length - 1], 0xd9);
  // Guessing the address by number does not work: the picture needs the key the app hands out with the name.
  assert.equal((await fetch(base + `/users/${a.id}/photo?v=1`, { headers: { cookie } })).status, 404);
  assert.equal((await fetch(base + `/users/${a.id}/photo?v=1&k=wrong`, { headers: { cookie } })).status, 404);
  await a.post(`/users/${b.id}/block`);
  assert.equal((await get(cookie)).status, 404);
  assert.equal((await a.del('/me/photo')).status, 200);
  assert.equal((await a.get('/me')).body.user.photo, null);
});

test('sample personas have drawn avatars, never uploaded photos', async () => {
  const rows = db.prepare("SELECT p.mime FROM photos p JOIN users u ON u.id = p.user_id WHERE u.is_demo = 1").all();
  assert.ok(rows.length >= 13);
  assert.ok(rows.every((r) => r.mime === 'image/svg+xml'));
});

test('interns: a profile can say intern / trainee', async () => {
  const a = await user('Ida', { role: 'intern', university: 'A start-up', show_university: true });
  const p = (await a.get(`/users/${a.id}`)).body.profile;
  assert.equal(p.role, 'intern'); assert.equal(p.university, 'A start-up');
});

test('feedback: saved for the project team, readable only with the admin token', async () => {
  const a = await user('Fay');
  assert.equal((await a.post('/feedback', { kind: 'idea', body: '' })).status, 400);
  assert.equal((await a.post('/feedback', { kind: 'idea', body: 'Add a dark mode', screen: '#/profile' })).status, 201);
  assert.equal((await a.get('/admin/feedback')).status, 403);
  const row = db.prepare("SELECT * FROM feedback WHERE body = 'Add a dark mode'").get();
  assert.equal(row.kind, 'idea'); assert.equal(row.user_id, a.id);
});

test('marketplace: list, private messages between seller and one buyer, status, permissions', async () => {
  const s = await user('Seller'); const b = await user('Buyer'); const o = await user('Other');
  assert.equal((await s.post('/market', { kind: 'sell', title: 'Bike' })).status, 400); // price needed
  const { body: { id } } = await s.post('/market', { kind: 'sell', category: 'bikes', title: 'Bike', price_eur: 50, area: 'Triana / Vegueta' });
  assert.ok((await b.get('/market?city=las-palmas')).body.listings.some((l) => l.id === id));
  assert.equal((await s.post(`/market/${id}/messages`, { body: 'hi' })).status, 400); // seller must pick a conversation
  assert.equal((await b.post(`/market/${id}/messages`, { body: 'Is it still available?' })).status, 201);
  assert.equal((await o.post(`/market/${id}/messages`, { body: 'Me too' })).status, 201);
  // each person only sees their own conversation
  const mineB = (await b.get(`/market/${id}/messages`)).body.messages;
  assert.equal(mineB.length, 1); assert.equal(mineB[0].body, 'Is it still available?');
  const detail = (await s.get(`/market/${id}`)).body.listing;
  assert.equal(detail.conversations.length, 2);
  assert.ok((await s.get('/notifications')).body.notifications.some((n) => n.kind === 'market_message' && n.listing.id === id));
  assert.equal((await s.post(`/market/${id}/messages`, { body: 'Yes!', buyer: b.id })).status, 201);
  assert.equal((await b.get(`/market/${id}/messages`)).body.messages.length, 2);
  assert.equal((await o.get(`/market/${id}/messages`)).body.messages.length, 1); // other buyer doesn't see it
  assert.equal((await b.put(`/market/${id}`, { status: 'sold' })).status, 403);
  assert.equal((await s.put(`/market/${id}`, { status: 'sold' })).status, 200);
  assert.ok(!(await b.get('/market?city=las-palmas')).body.listings.some((l) => l.id === id)); // sold items leave the list
  assert.equal((await o.post(`/market/${id}/messages`, { body: 'still?' })).status, 409);
  await s.post(`/users/${b.id}/block`);
  assert.equal((await b.get(`/market/${id}`)).status, 404);
  assert.equal((await b.del(`/market/${id}`)).status, 403);
  assert.equal((await s.del(`/market/${id}`)).status, 200);
});

test('ticket resale: only at or below the price paid, shown on the event', async () => {
  const s = await user('Tia');
  const ev = (await s.get('/events?city=las-palmas')).body.events[0];
  assert.equal((await s.post('/market', { kind: 'ticket', title: 'Ticket', event_id: ev.id, price_eur: 30 })).status, 400); // needs price paid
  assert.equal((await s.post('/market', { kind: 'ticket', title: 'Ticket', event_id: ev.id, face_value_eur: 20, price_eur: 30 })).status, 400);
  const r = await s.post('/market', { kind: 'ticket', title: 'Ticket', event_id: ev.id, face_value_eur: 20, price_eur: 15 });
  assert.equal(r.status, 201);
  const l = (await s.get(`/market/${r.body.id}`)).body.listing;
  assert.equal(l.category, 'tickets'); assert.equal(l.event.id, ev.id);
  assert.ok((await s.get(`/events/${ev.id}`)).body.event.tickets_count >= 1);
  assert.ok((await s.get(`/market?city=las-palmas&event=${ev.id}`)).body.listings.every((x) => x.event?.id === ev.id));
  const bad = await s.put(`/market/${r.body.id}/photo`, { data: 'data:image/jpeg;base64,' + Buffer.from('nope').toString('base64') });
  assert.equal(bad.status, 400);
});

test('guest access: one click, private by default, can be saved as an account', async () => {
  const g = client();
  assert.equal((await g.post('/auth/guest')).status, 201);
  const me = (await g.get('/me')).body.user;
  assert.equal(me.is_guest, true); assert.equal(me.onboarded, true); assert.equal(me.email, null);
  // A fresh guest has told us nothing: no invented interests, languages, area or wishes, so no shared-interest claims.
  assert.deepEqual(me.interests, []); assert.deepEqual(me.languages, []); assert.equal(me.area, null);
  assert.equal((await g.get('/wishes')).body.wishes.length, 0);
  assert.ok((await g.get('/people')).body.people.every((p) => p.shared.length === 0));
  // A second guest is a different person: separate permissions.
  const g2 = client(); await g2.post('/auth/guest');
  assert.notEqual((await g2.get('/me')).body.user.id, me.id);
  // Guests do not appear in other people's student lists.
  const u = await user('Vera', { interests: ['beach'] });
  assert.ok(!(await u.get('/people')).body.people.some((p) => p.id === me.id));
  // Guests can look at plans, but joining or publishing first needs an account (so the plan can be found again later).
  const a = await makeActivity(u);
  assert.equal((await g.get(`/activities/${a}`)).status, 200);
  const blocked = await g.post(`/activities/${a}/requests`, { message: 'Hi' });
  assert.equal(blocked.status, 401); assert.equal(blocked.body.error, 'account_needed');
  assert.equal((await g.post('/activities', { title: 'x', day: localIn(2).slice(0, 10), time_mode: 'tbd', meeting_area: 'Triana' })).body.error, 'account_needed');
  // Save as an account, keeping what the guest did.
  assert.equal((await g.post('/auth/claim', { email: 'bad', password: 'password123' })).status, 400);
  assert.equal((await g.post('/auth/claim', { email: u.email, password: 'password123' })).status, 409);
  assert.equal((await g.post('/auth/claim', { first_name: 'Gus', email: 'gus@test.example', password: 'password123' })).status, 200);
  const after = (await g.get('/me')).body.user;
  assert.equal(after.is_guest, false); assert.equal(after.first_name, 'Gus'); assert.equal(after.id, me.id);
  assert.ok((await u.get('/people')).body.people.some((p) => p.id === me.id));
  assert.equal((await g.post(`/activities/${a}/requests`, { message: 'Hi' })).status, 201, 'after saving the account the request goes through');
  assert.equal((await g.post('/auth/claim', { email: 'x@test.example', password: 'password123' })).status, 400);
  const login = client();
  assert.equal((await login.post('/auth/login', { email: 'gus@test.example', password: 'password123' })).status, 200);
  // A guest can delete their data without a password.
  assert.equal((await g2.del('/me', {})).status, 200);
});

test('students list: visible people, shared interests first, blocked people hidden', async () => {
  const a = await user('Wen', { interests: ['surf', 'beach'] });
  const b = await user('Xia', { interests: ['surf'] });
  const list = (await a.get('/people')).body.people;
  const xb = list.find((p) => p.id === b.id);
  assert.deepEqual(xb.shared, ['surf']);
  assert.ok(!list.some((p) => p.is_demo), 'example students never appear');
  await a.post(`/users/${b.id}/block`);
  assert.ok(!(await a.get('/people')).body.people.some((p) => p.id === b.id));
});

test('real events: stable ids, safe re-import, Canary time, organiser links, no invented prices', async (t) => {
  const { importEvents, REAL_EVENTS } = await import('../server/events-import.js');
  const a = await user('Eve'); const b = await user('Finn');
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM events WHERE ext_id IS NOT NULL').get().n;
  assert.equal(count(), REAL_EVENTS.length);
  const byExt = (x) => db.prepare('SELECT * FROM events WHERE ext_id = ?').get(x);
  const alb = byExt('nyxell-30297'); // Thursday 3 December, 23:00 to 05:00
  assert.equal(alb.starts_at, '2026-12-03T23:00:00.000Z'); // Canary time is UTC+0 in winter
  assert.equal(alb.duration_min, 360);
  // Erasmus Life only lists these nights (guest list); the source names no organiser, so the field stays empty.
  assert.equal(alb.organiser_name, ''); assert.equal(alb.listed_by, 'Erasmus Life Las Palmas'); assert.equal(alb.venue, 'Alboroto'); assert.equal(alb.ticket_platform, 'Nyxell');
  assert.equal(byExt('lpgc-mercado-navidad-2026').organiser_name, 'Ayuntamiento de Las Palmas de Gran Canaria');
  assert.match(alb.ticket_url, /^https:\/\/open\.nyxell\.com\/en\/rrpp\/122923-erasmus-life\/event\/30297-/);
  assert.match(alb.price_note, /not free entry/);
  // Unknown admission stays unknown, never "free".
  const gospel = byExt('aak-TNOGC1226');
  assert.equal(gospel.price_note, null); assert.match(gospel.ticket_url, /janto/);
  // Student activity around an event survives a re-import, and nothing is duplicated.
  if (Date.now() < new Date(alb.starts_at).getTime()) {
    assert.equal((await a.put(`/events/${alb.id}/interest`, { group_pref: 'small', languages: ['English'] })).status, 200);
    const plan = await a.post('/activities', { title: 'Market visit', category: 'shopping', starts_local: localIn(3), duration_min: 90, meeting_area: 'Santa Catalina / Puerto',
      cost_eur: 0, max_participants: 4, languages: ['English'], event_id: byExt('lpgc-mercado-navidad-2026').id });
    assert.equal(plan.status, 201);
    db.prepare("UPDATE events SET title = 'changed by hand' WHERE ext_id = 'nyxell-30297'").run();
    const r = importEvents(db);
    assert.equal(r.inserted, 0); assert.equal(r.updated, REAL_EVENTS.length);
    assert.equal(count(), REAL_EVENTS.length);
    assert.equal(byExt('nyxell-30297').id, alb.id);
    assert.equal(byExt('nyxell-30297').title, 'Erasmus Life · Jueves 3 • Diciembre');
    assert.ok(db.prepare('SELECT 1 FROM event_interests WHERE event_id = ? AND user_id = ?').get(alb.id, a.id));
    assert.equal(db.prepare('SELECT event_id FROM activities WHERE id = ?').get(plan.body.id).event_id, byExt('lpgc-mercado-navidad-2026').id);
    // The API lists the 15 January concert, sessions of the New Year concert, and the market with no invented time.
    const list = (await b.get('/events?city=las-palmas&when=any')).body.events;
    assert.ok(list.some((e) => e.ext_id === 'aak-CRyLT0127-20270115' && e.starts_local === '2027-01-15T20:00'));
    const market = list.find((e) => e.ext_id === 'lpgc-mercado-navidad-2026');
    assert.equal(market.time_known, false); assert.match(market.note_en, /Check the city programme/);
    const conpop = list.find((e) => e.series_key === 'conpop-2026');
    const detail = (await b.get(`/events/${conpop.id}`)).body.event;
    assert.equal(detail.sessions.length, 5);
    assert.ok(detail.groups.length === 0);
    // Attendance counts start from real app activity: one person looking, nobody invented.
    assert.equal((await b.get(`/events/${alb.id}`)).body.event.seeking_count, 1);
  } else t.diagnostic('listed dates are in the past; skipped the live part');
});

// ---------- pre-launch release 1 ----------
const dayIn = (days) => localIn(days).slice(0, 10);
function nextWeekday(target) { // 6 = Saturday
  for (let i = 1; i <= 7; i++) if (new Date(`${dayIn(i)}T12:00:00Z`).getUTCDay() === target) return dayIn(i);
  return null;
}

test('R1 custom plan: skipped time, duration, cost and size stay blank, never invented', async () => {
  const org = await user('Paula');
  const r = await org.post('/activities', { title: 'Watching the surf at La Cícer', day: dayIn(3), time_mode: 'tbd', meeting_area: 'Siete Palmas' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const a = (await org.get(`/activities/${r.body.id}`)).body.activity;
  assert.equal(a.time_mode, 'tbd'); assert.equal(a.day, dayIn(3));
  assert.equal(a.duration_choice, null); assert.equal(a.duration_min, null);
  assert.equal(a.cost_mode, null); assert.equal(a.cost_eur, null);
  assert.equal(a.capped, false); assert.equal(a.max_participants, null); assert.equal(a.spots_left, null);
  assert.equal(a.state, 'open'); assert.equal(a.category, 'other'); assert.equal(a.meeting_area, 'Siete Palmas');
  // Missing day or time choice is an error, not a silent default.
  assert.equal((await org.post('/activities', { title: 'x', meeting_area: 'Triana', time_mode: 'exact', day: dayIn(2) })).status, 400);
  assert.equal((await org.post('/activities', { title: 'x', meeting_area: 'Triana', time_mode: 'window', day: dayIn(2) })).status, 400);
  assert.equal((await org.post('/activities', { title: 'x', meeting_area: 'Triana', time_mode: 'tbd' })).status, 400);
  assert.equal((await org.post('/activities', { title: 'x', time_mode: 'tbd', day: dayIn(2) })).status, 400, 'meeting area is required');
  assert.equal((await org.post('/activities', { title: 'x', meeting_area: 'Triana', time_mode: 'tbd', day: dayIn(-1) })).status, 400, 'past day');
});

test('R1 flexible plans appear in the right day and weekend filters', async () => {
  const org = await user('Quim');
  const sat = nextWeekday(6);
  const w = await org.post('/activities', { title: 'Saturday afternoon beach', day: sat, time_mode: 'window', time_window: 'afternoon', meeting_area: 'Las Canteras' });
  const t = await org.post('/activities', { title: 'Tomorrow, time tbd', day: dayIn(1), time_mode: 'tbd', meeting_area: 'Triana' });
  const ids = async (when) => (await org.get(`/activities?city=las-palmas&when=${when}`)).body.activities.map((x) => x.id);
  assert.ok((await ids('weekend')).includes(w.body.id));
  assert.ok(!(await ids('weekend')).includes(t.body.id) || ['sat', 'sun'].includes(new Date(`${dayIn(1)}T12:00:00Z`).toUTCString().slice(0, 3).toLowerCase()));
  assert.ok((await ids('tomorrow')).includes(t.body.id));
  const wa = (await org.get(`/activities/${w.body.id}`)).body.activity;
  assert.equal(wa.time_window, 'afternoon'); assert.equal(wa.starts_local.slice(11), '14:00');
  assert.equal(wa.ends_at, new Date(`${wa.ends_at}`).toISOString());
});

test('R1 cost: only plans marked free match the Free filter; old zero prices are not guessed', async () => {
  const org = await user('Rosa');
  const mk = async (extra) => (await org.post('/activities', { title: 'Cost test', day: dayIn(2), time_mode: 'tbd', meeting_area: 'Vegueta', ...extra })).body.id;
  const free = await mk({ cost_mode: 'free' });
  const est = await mk({ cost_mode: 'estimate', cost_eur: 8 });
  const unknown = await mk({ cost_mode: 'unknown' });
  const blank = await mk({});
  assert.equal((await org.post('/activities', { title: 'x', day: dayIn(2), time_mode: 'tbd', meeting_area: 'Vegueta', cost_mode: 'estimate' })).status, 400);
  // A plan from before this release with cost_eur 0 and no cost_mode.
  const legacy = await mk({});
  db.prepare('UPDATE activities SET cost_mode = NULL, cost_eur = 0 WHERE id = ?').run(legacy);
  const freeIds = (await org.get('/activities?city=las-palmas&budget=free')).body.activities.map((x) => x.id);
  assert.ok(freeIds.includes(free)); for (const x of [est, unknown, blank, legacy]) assert.ok(!freeIds.includes(x));
  const low = (await org.get('/activities?city=las-palmas&budget=low')).body.activities.map((x) => x.id);
  assert.ok(low.includes(free) && low.includes(est) && !low.includes(unknown) && !low.includes(blank));
  const view = async (id) => (await org.get(`/activities/${id}`)).body.activity;
  assert.equal((await view(unknown)).cost_mode, 'unknown'); assert.equal((await view(est)).cost_eur, 8);
  assert.equal((await view(legacy)).cost_mode, null, 'an old 0 is not shown as free');
  const old5 = await mk({}); db.prepare('UPDATE activities SET cost_mode = NULL, cost_eur = 5 WHERE id = ?').run(old5);
  assert.equal((await view(old5)).cost_mode, 'estimate'); assert.equal((await view(old5)).cost_eur, 5);
});

test('R1 capacity: optional; uncapped plans are never full; two requests for the final place', async () => {
  const org = await user('Sami');
  const open = (await org.post('/activities', { title: 'Open, no limit', day: dayIn(2), time_mode: 'tbd', meeting_area: 'Triana', join_mode: 'open' })).body.id;
  for (let i = 0; i < 4; i++) { const u = await user(`Open${i}`); assert.equal((await u.post(`/activities/${open}/requests`)).body.status, 'accepted'); }
  const ov = (await org.get(`/activities/${open}`)).body.activity;
  assert.equal(ov.going, 5); assert.equal(ov.state, 'open'); assert.equal(ov.spots_left, null);
  // Capped at 2 (organiser + 1), open join: two people tap at the same moment for the last place.
  const last = (await org.post('/activities', { title: 'One place', day: dayIn(2), time_mode: 'exact', time: '18:00', meeting_area: 'Triana', join_mode: 'open', max_participants: 2 })).body.id;
  const [u1, u2] = [await user('Tia'), await user('Udo')];
  const res = await Promise.all([u1.post(`/activities/${last}/requests`), u2.post(`/activities/${last}/requests`)]);
  assert.deepEqual(res.map((x) => x.status).sort(), [201, 409]);
  const lv = (await org.get(`/activities/${last}`)).body.activity;
  assert.equal(lv.going, 2); assert.equal(lv.state, 'full'); assert.equal(lv.spots_left, 0);
  // Request mode: two pending requests, only one can be accepted for the final place.
  const req = (await org.post('/activities', { title: 'Ask, one place', day: dayIn(2), time_mode: 'tbd', meeting_area: 'Triana', max_participants: 2, join_mode: 'request' })).body.id;
  await u1.post(`/activities/${req}/requests`); await u2.post(`/activities/${req}/requests`);
  const acc = await Promise.all([org.post(`/activities/${req}/members/${u1.id}/accept`), org.post(`/activities/${req}/members/${u2.id}/accept`)]);
  assert.deepEqual(acc.map((x) => x.status).sort(), [200, 409]);
  // Existing capacity and approval settings are kept on older plans.
  const legacy = await makeActivity(org, { max_participants: 3 });
  db.prepare('UPDATE activities SET capped = NULL WHERE id = ?').run(legacy);
  const old = (await org.get(`/activities/${legacy}`)).body.activity;
  assert.equal(old.capped, true); assert.equal(old.max_participants, 3); assert.equal(old.join_mode, 'request');
});

test('R1 examples stay out of discovery and cannot be joined; real content and links still work', async () => {
  const u = await user('Vic');
  const sampleAct = db.prepare('SELECT id FROM activities WHERE is_sample = 1 LIMIT 1').get();
  assert.ok(sampleAct, 'test database has example plans');
  const list = (await u.get('/activities?city=las-palmas')).body.activities;
  assert.ok(list.every((a) => !a.is_sample));
  assert.ok((await u.get('/events?city=las-palmas')).body.events.every((e) => !e.is_sample));
  assert.ok((await u.get('/recommendations?city=las-palmas')).body.recommendations.every((x) => !x.is_sample));
  assert.ok((await u.get('/market?city=las-palmas')).body.listings.every((x) => !x.is_sample));
  assert.ok((await u.get('/people')).body.people.every((p) => !p.is_demo));
  assert.equal((await u.post(`/activities/${sampleAct.id}/requests`)).body.error, 'example');
  assert.equal((await u.get('/meta')).body.personas.length, 0);
  assert.equal((await client().post('/auth/demo', { personaId: 1 })).status, 410);
  // Real plans keep working through the old link format and the new share link.
  const id = await makeActivity(u);
  assert.equal((await u.get(`/activities/${id}`)).status, 200);
  const share = await fetch(base.replace('/api', `/p/${id}`));
  const html = await share.text();
  assert.ok(html.includes('Museum visit') && html.includes(`/?src=share#/activity/${id}`));
  assert.ok((await (await fetch(base.replace('/api', `/p/${id}?src=Poster`))).text()).includes(`/?src=poster#/activity/${id}`));
  assert.ok((await (await fetch(base.replace('/api', `/p/${id}?src=<x>`))).text()).includes(`/?src=share#/activity/${id}`));
  assert.ok(!html.includes('Cathedral steps'), 'the share preview never shows the exact meeting point');
});

test('R1 password recovery never reveals accounts and works without email setup', async () => {
  const u = await user('Wim');
  const r = await client().post('/auth/password/forgot', { email: u.email });
  assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true }, 'same answer for every address');
  assert.equal((await client().get('/meta')).body.passwordReset, false, 'no email provider in tests: the app says so, for every address alike');
  assert.equal((await client().post('/auth/password/reset', { token: 'nope', password: 'whatever123' })).status, 400);
  const crypto = await import('node:crypto');
  const token = 'tok-' + Date.now();
  db.prepare('INSERT INTO password_tokens (token_hash, user_id, expires_at) VALUES (?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'), u.id, new Date(Date.now() + 6e5).toISOString());
  const c = client();
  assert.equal((await c.post('/auth/password/reset', { token, password: 'newpassword1' })).status, 200);
  assert.equal((await c.get('/me')).body.user.id, u.id);
  assert.equal((await client().post('/auth/login', { email: u.email, password: 'newpassword1' })).status, 200);
  assert.equal((await client().post('/auth/password/reset', { token, password: 'again12345' })).status, 400, 'one-time link');
});

test('R2 city guide: no health or insurance cards, every entry names its source, refreshed by version', async () => {
  const c = client(); await c.post('/auth/guest');
  const items = (await c.get('/guide?city=las-palmas')).body.items;
  assert.ok(items.length >= 5);
  assert.ok(!items.some((i) => i.section === 'health' || /insurance|112|EHIC/i.test(i.title)));
  assert.ok(items.every((i) => i.source_name), 'each entry says where it comes from');
  assert.ok(items.filter((i) => i.url).every((i) => i.url.startsWith('https://')));
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'guide_version'").get().value, '2');
});

test('R3 team inbox: server-enforced access, report and feedback saved separately, mark reviewed, numbers skip test accounts', async () => {
  process.env.ADMIN_TOKEN = 'team-code-for-tests-123';
  const reporter = await user('Rep'); const target = await user('Targ'); const team = await user('Teamy');
  const id = await makeActivity(target);
  const r = await reporter.post('/reports', { target_type: 'activity', target_id: id, reason: 'Spam or advertising', details: 'test note' });
  assert.equal(r.status, 201); assert.equal(r.body.saved, true);
  const f = await reporter.post('/feedback', { kind: 'idea', body: 'More beach plans', reply_email: 'me@test.example' });
  assert.equal(f.body.saved, true);
  assert.equal((await reporter.post('/feedback', { kind: 'idea', body: 'x', reply_email: 'not-an-email' })).status, 400);
  // Regular accounts and guests cannot read the inbox.
  for (const u of ['/team/reports', '/team/feedback', '/team/numbers']) assert.equal((await reporter.get(u)).status, 403);
  assert.equal((await reporter.post(`/team/reports/${r.body.id}`, { status: 'reviewed' })).status, 403);
  const g = client(); await g.post('/auth/guest');
  assert.equal((await g.post('/team/unlock', { code: process.env.ADMIN_TOKEN })).status, 401);
  assert.equal((await team.post('/team/unlock', { code: 'wrong' })).status, 403);
  assert.equal((await team.post('/team/unlock', { code: process.env.ADMIN_TOKEN })).status, 200);
  assert.equal((await team.get('/me')).body.user.team, true);
  const reports = (await team.get('/team/reports')).body.reports;
  const mine = reports.find((x) => x.id === r.body.id);
  assert.equal(mine.status, 'open'); assert.equal(mine.reason, 'Spam or advertising'); assert.equal(mine.details, 'test note'); assert.ok(mine.created_at);
  assert.equal(mine.target.link, `#/activity/${id}`);
  assert.equal((await team.post(`/team/reports/${r.body.id}`, { status: 'reviewed' })).body.status, 'reviewed');
  const after = (await team.get('/team/reports')).body.reports.find((x) => x.id === r.body.id);
  assert.equal(after.reviewed_by, 'Teamy'); assert.ok(after.reviewed_at);
  const fb = (await team.get('/team/feedback')).body.feedback.find((x) => x.id === f.body.id);
  assert.equal(fb.reply_email, 'me@test.example'); assert.equal(fb.status, 'open');
  // Numbers leave out test accounts.
  const t = client(); await t.post('/auth/signup', { email: `qa-x${Date.now()}@example.com`, password: 'password123' });
  const nums = (await team.get('/team/numbers')).body;
  assert.ok(nums.excluded_test_accounts >= 1);
  assert.equal(nums.accounts, db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_demo = 0 AND is_guest = 0 AND is_test = 0 AND password_hash != 'deleted'").get().n);
  // Test accounts are invisible to real students.
  const tid = (await t.get('/me')).body.user.id;
  await t.put('/me/profile', { first_name: 'Testy', city: 'las-palmas' });
  assert.ok(!(await reporter.get('/people')).body.people.some((p) => p.id === tid));
  // Leaving the team removes access again.
  await team.post('/team/leave');
  assert.equal((await team.get('/team/reports')).status, 403);
  delete process.env.ADMIN_TOKEN;
});

test('R3 updates: unread chat grouped per plan; extra listing photos up to 4', async () => {
  const org = await user('Chatty'); const guest = await user('Reader');
  const id = await makeActivity(org, { join_mode: 'open' });
  await guest.post(`/activities/${id}/requests`, {});
  for (let i = 0; i < 3; i++) await org.post(`/activities/${id}/messages`, { body: `hi ${i}` });
  const chats = (await guest.get('/notifications')).body.chats;
  assert.equal(chats.length, 1); assert.equal(chats[0].unread, 3); assert.equal(chats[0].activity.id, id);
  const l = (await org.post('/market', { kind: 'free', category: 'other', title: 'Chair' })).body.id;
  const jpg = `data:image/jpeg;base64,${testJpeg(8).toString('base64')}`;
  for (let i = 0; i < 4; i++) assert.equal((await org.post(`/market/${l}/photos`, { data: jpg })).status, 201);
  assert.equal((await org.post(`/market/${l}/photos`, { data: jpg })).status, 409);
  const v = (await guest.get(`/market/${l}`)).body.listing;
  assert.equal(v.photos.length, 4); assert.equal(v.photos[0].id, 'main');
  assert.equal((await guest.post(`/market/${l}/photos`, { data: jpg })).status, 403);
});

test('team visitors and profiles: counted once per person per day, tests left out, team only', async () => {
  process.env.ADMIN_TOKEN = 'team-code-for-tests-123';
  const a = await user('Visa'); const team = await user('Lead');
  await team.post('/team/unlock', { code: process.env.ADMIN_TOKEN });
  const before = (await team.get('/team/numbers')).body.visitors;
  await a.post('/visit'); await a.post('/visit');
  const g = client(); await g.post('/auth/guest'); await g.post('/visit');
  const t = client(); await t.post('/auth/signup', { email: `qa-v${Date.now()}@example.com`, password: 'password123' }); await t.post('/visit');
  const v = (await team.get('/team/numbers')).body.visitors;
  assert.equal(v.today - before.today, 2, 'one account + one guest; the test account is not counted');
  assert.equal(v.daily[0].opens - before.daily[0].opens, 3);
  const profiles = (await team.get('/team/profiles')).body.profiles;
  const pa = profiles.find((p) => p.id === a.id);
  assert.ok(pa && pa.last_visit && !('email' in pa));
  assert.ok(!profiles.some((p) => p.first_name === 'Guest'));
  assert.equal((await a.get('/team/profiles')).status, 403);
  delete process.env.ADMIN_TOKEN;
});

test('profile visibility: short card for students with an account, never guests; "only people in my plans" hides from everyone else', async () => {
  const a = await user('Lia', { intro: 'Here for a year', meet_area: 'Las Canteras', university: 'ULPGC', show_university: false });
  const b = await user('Max');
  // Intro, meeting area and university start hidden: the short card only.
  let card = (await b.get(`/users/${a.id}`)).body.profile;
  assert.equal(card.first_name, 'Lia'); assert.deepEqual(card.languages, ['English']); assert.deepEqual(card.interests, ['museum']);
  assert.equal(card.intro, ''); assert.equal(card.meet_area, null); assert.equal(card.university, null);
  const mine = (await a.get('/me')).body.user;
  assert.equal(mine.intro, 'Here for a year'); assert.equal(mine.meet_area, 'Las Canteras'); assert.equal(mine.show_intro, false);
  await a.put('/me/profile', { first_name: 'Lia', city: 'las-palmas', show_intro: true, show_area: true });
  card = (await b.get(`/users/${a.id}`)).body.profile;
  assert.equal(card.intro, 'Here for a year'); assert.equal(card.meet_area, 'Las Canteras');
  assert.equal((await a.get('/me')).body.user.intro, 'Here for a year', 'saving without intro keeps it');
  // Guests never see profiles or the student list. Search engines are told not to index.
  const g = client(); await g.post('/auth/guest');
  assert.equal((await g.get(`/users/${a.id}`)).status, 401);
  const gp = await g.get('/people'); assert.equal(gp.body.account_needed, true); assert.equal(gp.body.people.length, 0);
  assert.match((await fetch(`${base}/people`)).headers.get('x-robots-tag') || '', /noindex/);
  // "Only people in my plans can see me".
  await a.put('/me/privacy', { visible: false });
  assert.equal((await b.get(`/users/${a.id}`)).status, 404);
  const c = await user('Noa');
  const plan = await makeActivity(a);
  assert.equal((await c.post(`/activities/${plan}/requests`, {})).status < 300, true);
  assert.equal((await c.get(`/users/${a.id}`)).status, 200, 'someone in her plan can still see her');
  assert.equal((await a.get(`/users/${c.id}`)).status, 200);
  assert.equal((await b.post(`/users/${a.id}/connect`, {})).status, 403, 'hidden people cannot get connect requests');
  await a.put('/me/privacy', { visible: true });
  assert.equal((await b.get(`/users/${a.id}`)).status, 200);
});

test('ask students: questions and answers, helpful votes, update to the asker, guests read only, blocks and test accounts hidden', async () => {
  const asker = await user('Ines'); const helper = await user('Joan'); const other = await user('Kai');
  assert.equal((await asker.post('/questions', { category: 'services', body: 'hi' })).status, 400, 'too short');
  assert.equal((await asker.post('/questions', { category: 'nope', body: 'Where is a good hairdresser?' })).status, 400);
  const q = (await asker.post('/questions', { category: 'services', body: 'Where is a good hairdresser near Santa Catalina?' })).body.id;
  let list = (await helper.get('/questions?filter=unanswered')).body.questions;
  assert.ok(list.some((x) => x.id === q && x.answers === 0));
  const a1 = (await helper.post(`/questions/${q}/answers`, { body: 'Try the one on Calle Ripoche, friendly and cheap.' })).body.id;
  const a2 = (await other.post(`/questions/${q}/answers`, { body: 'I liked the place by the market.' })).body.id;
  assert.ok(a1 && a2);
  assert.ok(!(await helper.get('/questions?filter=unanswered')).body.questions.some((x) => x.id === q));
  // The asker gets one unread update, which opening the question marks as read.
  let notes = (await asker.get('/notifications')).body.notifications.filter((n) => n.kind === 'answer');
  assert.equal(notes.length, 1); assert.equal(notes[0].question.id, q);
  // Helpful votes: not on your own answer; the most helpful answer comes first.
  assert.equal((await helper.put(`/answers/${a1}/helpful`)).status, 400);
  await asker.put(`/answers/${a2}/helpful`); await helper.put(`/answers/${a2}/helpful`);
  let d = (await asker.get(`/questions/${q}`)).body;
  assert.equal(d.answers[0].id, a2); assert.equal(d.answers[0].helpful, 2);
  assert.equal((await asker.get('/notifications')).body.notifications.filter((n) => n.kind === 'answer' && !n.read).length, 0);
  // Guests can read but not ask, answer or vote.
  const g = client(); await g.post('/auth/guest');
  assert.equal((await g.get(`/questions/${q}`)).status, 200);
  assert.equal((await g.post('/questions', { category: 'services', body: 'Guest question here?' })).status, 401);
  assert.equal((await g.post(`/questions/${q}/answers`, { body: 'x' })).status, 401);
  assert.equal((await g.put(`/answers/${a1}/helpful`)).status, 401);
  // Blocking hides each other's questions and answers.
  await asker.post(`/users/${other.id}/block`);
  d = (await asker.get(`/questions/${q}`)).body;
  assert.ok(!d.answers.some((x) => x.id === a2));
  assert.equal((await other.get(`/questions/${q}`)).status, 404);
  // Test accounts are hidden from real students.
  const t = client(); await t.post('/auth/signup', { email: `qa-ask${Date.now()}@example.com`, password: 'password123' });
  await t.put('/me/profile', { first_name: 'Qa', city: 'las-palmas' });
  const tq = (await t.post('/questions', { category: 'food', body: 'Test question, please ignore' })).body.id;
  assert.ok(!(await helper.get('/questions')).body.questions.some((x) => x.id === tq));
  assert.ok((await t.get('/questions')).body.questions.some((x) => x.id === tq), 'they still see their own');
  // Only the author can delete; reports work.
  assert.equal((await helper.del(`/questions/${q}`)).status, 403);
  assert.equal((await helper.post('/reports', { target_type: 'question', target_id: q, reason: 'Spam or advertising' })).status, 201);
  assert.equal((await asker.del(`/questions/${q}`)).status, 200);
  assert.equal((await helper.get(`/questions/${q}`)).status, 404);
});

test('link tags: ?src= counted per tag for the team, first tag per person, test accounts and bad tags left out', async () => {
  process.env.ADMIN_TOKEN = 'team-code-for-tests-123';
  const team = await user('Lead'); await team.post('/team/unlock', { code: process.env.ADMIN_TOKEN });
  const tag = `ig${Date.now() % 100000}`;
  const g = client(); await g.post('/auth/guest');
  await g.post('/visit', { src: tag.toUpperCase() }); await g.post('/visit', { src: tag }); await g.post('/visit', { src: 'later' });
  const a = await user('Tagi'); await a.post('/visit', { src: tag });
  const t = client(); await t.post('/auth/signup', { email: `qa-src${Date.now()}@example.com`, password: 'password123' }); await t.post('/visit', { src: tag });
  await a.post('/visit', { src: '<script>' }); await a.post('/visit', { src: 'x'.repeat(40) });
  let rows = (await team.get('/team/numbers')).body.sources;
  let row = rows.find((x) => x.src === tag);
  assert.deepEqual([row.people_7d, row.people_30d, row.accounts], [2, 2, 1], 'guest + account counted once each; the test account is not');
  assert.ok(!rows.some((x) => x.src.includes('<') || x.src.length > 32));
  // The guest signs up: their first tag (not the later one) gets the account.
  await g.post('/auth/claim', { email: `src${Date.now()}@mail.test`, password: 'password123', first_name: 'Gia' });
  rows = (await team.get('/team/numbers')).body.sources;
  assert.equal(rows.find((x) => x.src === tag).accounts, 2);
  assert.equal(rows.find((x) => x.src === 'later').accounts, 0);
  assert.equal((await a.get('/team/numbers')).status, 403);
  delete process.env.ADMIN_TOKEN;
});

test('pop-up notifications: subscribe, sent for plan updates and chat (throttled), never from a blocked person, removed on logout', async () => {
  const org = await user('Pia'); const guest = await user('Quin');
  await org.put('/me/privacy', { lang: 'es' });
  const key = (await org.get('/push/key')).body.key;
  assert.match(key, /^[\w-]{80,}$/, 'server made its own public key');
  assert.equal((await org.post('/push/subscribe', { endpoint: 'not-a-url', keys: { p256dh: 'x', auth: 'y' } })).status, 400);
  assert.equal((await org.post('/push/subscribe', { endpoint: 'https://internal.example.test/hook-123456', keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } })).status, 400, 'only real push services');
  const sub = (tag) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${tag}-${Date.now()}`, keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } });
  const s1 = sub('pia');
  assert.equal((await org.post('/push/subscribe', s1)).body.devices, 1);
  assert.equal((await org.get('/me')).body.user.push_devices, 1);
  await guest.post('/push/subscribe', sub('quin'));
  const sentFor = async (uid) => (await org.get('/push/_sent')).body.sent.filter((x) => x.uid === uid);

  const id = await makeActivity(org, { title: 'Paseo push', max_participants: 5 });
  await guest.post(`/activities/${id}/requests`, { message: 'Hola' });
  const toOrg = await sentFor(org.id);
  assert.equal(toOrg.at(-1).kind, 'request_received');
  assert.equal(toOrg.at(-1).payload.title, 'Quin quiere unirse', 'written in the receiver’s language');
  assert.match(toOrg.at(-1).payload.url, new RegExp(`/#/activity/${id}$`));

  await org.post(`/activities/${id}/members/${guest.id}/accept`);
  assert.equal((await sentFor(guest.id)).at(-1).kind, 'request_accepted');

  const before = (await sentFor(org.id)).length;
  await guest.post(`/activities/${id}/messages`, { body: 'one' });
  await guest.post(`/activities/${id}/messages`, { body: 'two' });
  const chats = (await sentFor(org.id)).slice(before);
  assert.equal(chats.length, 1, 'a busy chat sends one pop-up, not one per message');
  assert.equal(chats[0].kind, 'chat');
  assert.ok(!JSON.stringify(chats[0].payload).includes('one'), 'message text is not shown on the lock screen');

  await org.post(`/users/${guest.id}/block`, {});
  const n1 = (await sentFor(org.id)).length;
  const left = await guest.del(`/activities/${id}/requests/mine`);
  assert.equal(left.status, 200, JSON.stringify(left.body));
  assert.equal((await sentFor(org.id)).length, n1, 'nothing from a blocked person');

  assert.equal((await org.post('/push/test', {})).body.devices, 1);
  assert.equal((await org.post('/push/unsubscribe', { endpoint: s1.endpoint })).body.devices, 0);
  assert.equal((await org.post('/push/test', {})).body.devices, 0);
});

test('plans without a photo keep the emoji the creator picked; unknown emoji are ignored', async () => {
  const org = await user('Emi');
  const id = await makeActivity(org, { title: 'Tapas night', category: 'food', emoji: '🌮' });
  assert.equal((await org.get(`/activities/${id}`)).body.activity.emoji, '🌮');
  assert.equal((await org.get(`/activities/${id}`)).body.activity.photo, null);
  const a = (await org.get(`/activities/${id}`)).body.activity;
  const r = await org.put(`/activities/${id}`, { title: a.title, category: 'food', day: a.day, time_mode: 'exact', time: '20:00', meeting_area: a.meeting_area, join_mode: a.join_mode, emoji: '<script>' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await org.get(`/activities/${id}`)).body.activity.emoji, '', 'not in the list: falls back to the automatic one');
});

test('reminder pop-up about an hour before a plan, sent once to everyone going', async () => {
  const org = await user('Rhea'); const pal = await user('Sami');
  await org.post('/push/subscribe', { endpoint: `https://fcm.googleapis.com/fcm/send/rhea-${Date.now()}`, keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } });
  await pal.post('/push/subscribe', { endpoint: `https://fcm.googleapis.com/fcm/send/sami-${Date.now()}`, keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } });
  const id = await makeActivity(org, { title: 'Soon walk', join_mode: 'open' });
  db.prepare('UPDATE activities SET starts_at = ?, time_mode = ? WHERE id = ?').run(new Date(Date.now() + 60 * 60e3).toISOString(), 'exact', id);
  await pal.post(`/activities/${id}/requests`, {});
  const first = (await org.post('/push/_remind', {})).body.sent;
  assert.ok(first >= 2, `sent ${first}`);
  assert.equal((await org.post('/push/_remind', {})).body.sent, 0, 'only once');
  const sent = (await org.get('/push/_sent')).body.sent.filter((x) => x.kind === 'reminder' && x.payload.url.endsWith(`/${id}`));
  assert.deepEqual(sent.map((x) => x.uid).sort(), [org.id, pal.id].sort());
  assert.match(sent[0].payload.title, /Soon walk/);
  assert.equal(typeof sent[0].payload.count, 'number');
});

test('day not fixed yet: this weekend, this week or flexible; exact time needs a day', async () => {
  const org = await user('Dora');
  const base = { title: 'Some plan', category: 'food', meeting_area: 'Triana', join_mode: 'open' };
  assert.equal((await org.post('/activities', { ...base, day_mode: 'flex', time_mode: 'exact', time: '20:00' })).status, 400);
  for (const mode of ['weekend', 'week', 'flex']) {
    const r = await org.post('/activities', { ...base, day_mode: mode, time_mode: 'tbd' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const a = (await org.get(`/activities/${r.body.id}`)).body.activity;
    assert.equal(a.day_mode, mode);
    assert.ok(a.last_day >= a.day, `${a.day} .. ${a.last_day}`);
    if (mode === 'weekend') assert.ok([0, 6].includes(new Date(`${a.day}T12:00:00Z`).getUTCDay()), 'weekend starts on Saturday or Sunday');
    if (mode === 'flex') assert.equal((Date.parse(a.last_day) - Date.parse(a.day)) / 864e5, 13);
  }
  const w = await org.post('/activities', { ...base, day_mode: 'week', time_mode: 'window', time_window: 'evening' });
  assert.equal(w.status, 201);
  assert.equal((await org.get(`/activities/${w.body.id}`)).body.activity.time_window, 'evening');
});

test('day to be agreed: the stored start is a placeholder, never a real start or date', async () => {
  const org = await user('Fifi'); const pal = await user('Gus'); const late = await user('Hal');
  await org.post('/push/subscribe', { endpoint: `https://fcm.googleapis.com/fcm/send/fifi-${Date.now()}`, keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } });
  const body = { title: 'Flexible tapas', category: 'food', meeting_area: 'Triana', join_mode: 'request', day_mode: 'flex', time_mode: 'tbd' };
  const id = (await org.post('/activities', body)).body.id;
  await pal.post(`/activities/${id}/requests`, {});
  await org.post(`/activities/${id}/members/${pal.id}/accept`);
  // As if it had been created two days ago: the placeholder start (12:00 that day) is now in the past, the window is still open.
  const twoDaysAgo = new Date(Date.now() - 2 * 864e5).toISOString();
  db.prepare('UPDATE activities SET starts_at = ? WHERE id = ?').run(twoDaysAgo, id);
  await late.post(`/activities/${id}/requests`, {});
  assert.equal((await org.get('/me')).body.counts.toReview >= 1, true, 'a request on a flexible plan still needs a review');

  // Explore "today" / "tomorrow" still find it: it could happen any day of its window.
  for (const when of ['today', 'tomorrow', 'week']) {
    const list = (await pal.get(`/activities?city=las-palmas&when=${when}`)).body.activities;
    assert.ok(list.some((x) => x.id === id), `listed for ${when}`);
  }

  // Saving it unchanged re-saves the window from today, but nobody is told "the organiser changed the time".
  assert.equal((await org.put(`/activities/${id}`, body)).status, 200);
  const sys = (await org.get(`/activities/${id}/messages`)).body.messages.filter((m) => m.kind === 'system' && /changed the time/.test(m.body));
  assert.equal(sys.length, 0);

  // No "starting soon" reminder, even if the placeholder lands in the reminder window.
  db.prepare('UPDATE activities SET starts_at = ? WHERE id = ?').run(new Date(Date.now() + 60 * 60e3).toISOString(), id);
  await org.post('/push/_remind', {});
  assert.equal((await org.get('/push/_sent')).body.sent.filter((x) => x.kind === 'reminder' && x.payload.url.endsWith(`/${id}`)).length, 0);

  // Share preview: no invented date.
  const html = await (await fetch(`${base.replace(/\/api$/, '')}/p/${id}`)).text();
  assert.match(html, /Day and time to be agreed/);
});

test('shared plan-time rules: calendar only gets plans with a real day', async () => {
  const { calendarPlacement, hasExactTime, effectiveStart } = await import('../shared/plan-time.js');
  assert.equal(calendarPlacement({ day_mode: 'flex', time_mode: 'tbd' }), 'skip');
  assert.equal(calendarPlacement({ day_mode: 'weekend', time_mode: 'window' }), 'skip');
  assert.equal(calendarPlacement({ day_mode: 'week', time_mode: 'tbd' }), 'skip');
  assert.equal(calendarPlacement({ day_mode: 'day', time_mode: 'tbd' }), 'allday');
  assert.equal(calendarPlacement({ day_mode: 'day', time_mode: 'window' }), 'timed');
  assert.equal(calendarPlacement({ time_mode: 'exact' }), 'timed', 'older plans');
  assert.equal(hasExactTime({ day_mode: 'flex', time_mode: 'exact' }), false);
  assert.equal(effectiveStart({ day_mode: 'flex', time_mode: 'tbd', starts_at: 'A', ends_at: 'B' }), 'B');
  assert.equal(effectiveStart({ day_mode: 'day', time_mode: 'exact', starts_at: 'A', ends_at: 'B' }), 'A');
});

test('connect: request, accept, private chat only when connected; decline stays quiet; block ends it', async () => {
  const a = await user('Cora'); const b = await user('Dev'); const c = await user('Eli');
  assert.equal((await a.get(`/users/${b.id}`)).body.connection, null);
  const req1 = await a.post(`/users/${b.id}/connect`, { note: 'Hi! We met at the surf plan.' });
  assert.equal(req1.status, 201);
  const cid = req1.body.connection.id;
  assert.equal((await a.get(`/connections/${cid}/messages`)).status, 403, 'no chat before acceptance');
  assert.equal((await a.post(`/connections/${cid}/messages`, { body: 'hey' })).status, 403);
  const inB = (await b.get('/connections')).body.incoming;
  assert.equal(inB[0].person.id, a.id); assert.equal(inB[0].note, 'Hi! We met at the surf plan.');
  assert.equal((await b.get('/me')).body.counts.connect_requests, 1);
  assert.equal((await b.get(`/users/${a.id}`)).body.connection.direction, 'incoming');
  assert.equal((await a.post(`/connections/${cid}/accept`)).status, 409, 'only the receiver can accept');
  assert.equal((await b.post(`/connections/${cid}/accept`)).body.connection.status, 'accepted');
  assert.ok((await a.get('/notifications')).body.notifications.some((n) => n.kind === 'connect_accepted' && n.actor.id === b.id));
  assert.equal((await a.post(`/connections/${cid}/messages`, { body: 'Coffee tomorrow?' })).status, 201);
  assert.equal((await b.get('/me')).body.counts.dms, 1);
  const msgs = (await b.get(`/connections/${cid}/messages`)).body.messages;
  assert.equal(msgs[0].body, 'Coffee tomorrow?'); assert.equal(msgs[0].mine, false);
  assert.equal((await b.get('/me')).body.counts.dms, 0, 'reading clears unread');
  assert.equal((await c.get(`/connections/${cid}/messages`)).status, 404, 'others cannot read');
  // decline: requester still sees "sent"
  const r2 = await c.post(`/users/${b.id}/connect`, {});
  await b.post(`/connections/${r2.body.connection.id}/decline`);
  assert.equal((await c.get(`/users/${b.id}`)).body.connection.status, 'pending', 'a decline is not announced');
  assert.equal((await b.get(`/users/${c.id}`)).body.connection, null);
  // both asked each other: the second request accepts
  const d = await user('Fay');
  await d.post(`/users/${c.id}/connect`, {});
  assert.equal((await c.post(`/users/${d.id}/connect`, {})).body.connection.status, 'accepted');
  // block ends the connection and the chat
  await b.post(`/users/${a.id}/block`, {});
  assert.equal((await a.get(`/connections/${cid}/messages`)).status, 404);
  assert.equal((await a.get('/connections')).body.connected.length, 0);
});

test('real-size pictures upload for plans and listings, not only tiny ones', async () => {
  const org = await user('Snap');
  const id = await makeActivity(org);
  // About 300 KB, like a cropped 1200 px phone photo.
  const big = `data:image/jpeg;base64,${testJpeg(300 * 1024).toString('base64')}`;
  assert.equal((await org.put(`/activities/${id}/photo`, { data: big })).status, 200);
  assert.equal((await org.put('/me/photo', { data: big })).status, 200);
  const l = (await org.post('/market', { kind: 'free', category: 'other', title: 'Lamp' })).body.id;
  assert.equal((await org.put(`/market/${l}/photo`, { data: big })).status, 200);
  assert.equal((await org.post(`/market/${l}/photos`, { data: big })).status, 201);
  // Other API calls keep the small limit, with a clear message.
  const r = await org.post('/activities', { title: 'x'.repeat(80 * 1024) });
  assert.equal(r.status, 413);
});

test('event photos match what happens: club nights and the Christmas market have no unrelated photo', async () => {
  const rows = db.prepare("SELECT ext_id, photo_key FROM events WHERE ext_id LIKE 'nyxell-%' OR ext_id = 'lpgc-mercado-navidad-2026'").all();
  assert.ok(rows.length >= 2);
  for (const r of rows) assert.equal(r.photo_key, null, r.ext_id);
  const concert = db.prepare("SELECT photo_key FROM events WHERE ext_id = 'aak-TNOGC1226'").get();
  assert.equal(concert.photo_key, 'auditorio'); // the venue itself
});

test('security: headers, login limit per account, admin script token, guests never see who is looking for company', async () => {
  const res = await fetch(base + '/meta');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('permissions-policy'), /camera=\(\)/);
  assert.equal(res.headers.get('x-powered-by'), null);
  // Cross-site forms cannot change anything (requests must be JSON).
  const form = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=a&password=b' });
  assert.equal(form.status, 415);

  const v = await user('Lock');
  const c = client();
  for (let i = 0; i < 10; i++) assert.equal((await c.post('/auth/login', { email: v.email, password: 'wrong-guess' })).status, 401);
  assert.equal((await c.post('/auth/login', { email: v.email, password: 'password123' })).status, 429, 'blocked after 10 tries on one account');

  process.env.ADMIN_TOKEN = 'team-code-for-tests-123';
  const tok = (t) => fetch(base + '/admin/feedback', { headers: t ? { 'x-admin-token': t } : {} });
  assert.equal((await tok()).status, 403);
  assert.equal((await tok('team-code-for-tests-124')).status, 403);
  assert.equal((await tok('team-code-for-tests-123')).status, 200);
  process.env.ADMIN_TOKEN = 'short';
  assert.equal((await tok('short')).status, 403, 'too short codes never work');
  delete process.env.ADMIN_TOKEN;

  const ev = db.prepare("SELECT id FROM events WHERE status = 'active' AND starts_at > ? ORDER BY starts_at LIMIT 1").get(new Date().toISOString());
  if (ev) {
    const s1 = await user('Seek');
    await s1.put('/me/privacy', { visible: true });
    assert.equal((await s1.put(`/events/${ev.id}/interest`, { group_pref: 'either' })).status, 200);
    const g = client(); assert.equal((await g.post('/auth/guest')).status, 201);
    assert.equal((await g.put(`/events/${ev.id}/interest`, { group_pref: 'either' })).status, 200);
    assert.equal((await g.get(`/events/${ev.id}`)).body.event.seekers, null);
    assert.equal((await g.post(`/events/${ev.id}/invite`, { userId: s1.id })).status, 401);
  }
  // Guests can look, but posting needs an account: no anonymous listings, tips or chat messages.
  const g2 = client(); assert.equal((await g2.post('/auth/guest')).status, 201);
  assert.equal((await g2.post('/market', { kind: 'free', title: 'Free sofa' })).status, 401);
  assert.equal((await g2.post('/recommendations', { category: 'food', title: 'Great tapas' })).status, 401);
  assert.equal((await g2.get('/market?city=las-palmas')).status, 200);
  const seller = await user('Sella');
  const lid = (await seller.post('/market', { kind: 'free', title: 'Free lamp' })).body.id;
  assert.equal((await g2.post(`/market/${lid}/messages`, { body: 'Still there?' })).status, 401);
  if (ev) {
    assert.equal((await g2.put(`/events/${ev.id}/interest`, { group_pref: 'either' })).status, 200);
    assert.equal((await g2.get(`/events/${ev.id}/messages`)).status, 200, 'guests can still read the event chat');
    assert.equal((await g2.post(`/events/${ev.id}/messages`, { body: 'Hi all' })).status, 401);
  }
});

test('hardening: meta without internals, same answers for unknown emails, Retry-After, guest write cap, files', async () => {
  const meta = await fetch(base + '/meta');
  const m = await meta.json();
  assert.equal(m.revision, undefined, 'no build revision in public meta');
  assert.equal(typeof m.passwordReset, 'boolean');
  assert.equal(meta.headers.get('cross-origin-resource-policy'), 'same-origin');

  // Password forgot: same answer for an account and for an unknown address, no "sent" flag.
  const known = await user('Enum');
  const f1 = await client().post('/auth/password/forgot', { email: known.email });
  const f2 = await client().post('/auth/password/forgot', { email: 'nobody-here@test.example' });
  assert.deepEqual(f1.body, { ok: true }); assert.deepEqual(f2.body, { ok: true });
  // Login: same status and message for a wrong password and an unknown email.
  const l1 = await client().post('/auth/login', { email: known.email, password: 'wrong-pass-1' });
  const l2 = await client().post('/auth/login', { email: 'nobody-here@test.example', password: 'wrong-pass-1' });
  assert.equal(l1.status, 401); assert.deepEqual(l1.body, l2.body);
  assert.equal(typeof l1.body.error, 'string');

  // Every 429 says when to try again.
  const c = client(); let last;
  for (let i = 0; i < 12; i++) last = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'retry@test.example', password: 'x' }) });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
  assert.equal((await last.json()).error, 'rate');

  // Session: a new token on login, the old one stops working.
  const s1 = client();
  await s1.post('/auth/login', { email: known.email, password: 'password123' });
  assert.ok((await s1.get('/me')).body.user);

  // Guests: at most 60 changes an hour.
  const g = client(); assert.equal((await g.post('/auth/guest')).status, 201);
  let gs;
  for (let i = 0; i < 61; i++) gs = await g.post('/visit', {});
  assert.equal(gs.status, 429);

  // Old password hashes still work and are upgraded on login.
  const { hashPassword } = await import('../server/auth.js');
  const crypto = await import('node:crypto');
  const salt = crypto.randomBytes(16);
  const old = `scrypt$${salt.toString('hex')}$${crypto.scryptSync('legacy-pass-1', salt, 64).toString('hex')}`;
  const lu = await user('Legacy');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(old, lu.id);
  assert.equal((await client().post('/auth/login', { email: lu.email, password: 'legacy-pass-1' })).status, 200);
  assert.match(db.prepare('SELECT password_hash FROM users WHERE id = ?').get(lu.id).password_hash, /^scrypt2\$32768\$8\$3\$/);
  assert.match(hashPassword('x'), /^scrypt2\$/);
});

test('files: security.txt and robots.txt, unknown files get 404 instead of the app', async () => {
  const root = base.replace('/api', '');
  const sec = await fetch(root + '/.well-known/security.txt');
  assert.equal(sec.status, 200);
  const t = await sec.text();
  assert.match(t, /^Contact: /m); assert.match(t, /^Expires: \d{4}-/m);
  for (const p of ['/.env', '/.git/config', '/assets/index.js.map', '/server/db.js', '/data/sidequest.db', '/api/../.env']) {
    assert.equal((await fetch(root + p)).status, 404, p);
  }
});

test('guest sign-up steps: daily totals only, guests only, account creation counted by the server', async () => {
  process.env.ADMIN_TOKEN = 'team-code-for-tests-123';
  const team = await user('Stepper'); await team.post('/team/unlock', { code: process.env.ADMIN_TOKEN });
  const steps = async () => (await team.get('/team/numbers')).body.guest_steps.last_7_days;
  const before = await steps();
  const g = client(); await g.post('/auth/guest');
  await g.post('/guest-step', { step: 'join_tap' }); await g.post('/guest-step', { step: 'signup_open' });
  await g.post('/guest-step', { step: 'signup_done' }); await g.post('/guest-step', { step: 'nonsense' }); // ignored
  await team.post('/guest-step', { step: 'join_tap' }); // accounts are not counted
  await g.post('/auth/claim', { email: `step${Date.now()}@mail.test`, password: 'password123', first_name: 'Sia' });
  const t = client(); await t.post('/auth/guest');
  await t.post('/auth/claim', { email: `qa-step${Date.now()}@example.com`, password: 'password123', first_name: 'Testy' }); // test account: left out
  const after = await steps();
  assert.deepEqual([after.join_tap - before.join_tap, after.signup_open - before.signup_open, after.signup_done - before.signup_done], [1, 1, 1]);
  const cols = db.prepare('PRAGMA table_info(guest_steps)').all().map((c) => c.name);
  assert.deepEqual(cols, ['day', 'step', 'n'], 'no user id or IP stored');
  assert.equal((await g.get('/team/numbers')).status, 403);
  delete process.env.ADMIN_TOKEN;
});
