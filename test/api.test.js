// End-to-end API tests: several real accounts (separate cookie sessions) against a real server and database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.AUTH_RATE_LIMIT = '10000';
process.env.NODE_ENV = 'test';
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
    meeting_point: 'Cathedral steps', cost_eur: 0, max_participants: 3, languages: ['English'], ...over,
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
  const dup = await b.post(`/activities/${id}/requests`);
  assert.equal(dup.status, 409); assert.equal(dup.body.error, 'duplicate');
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

test('wishes: compatible suggestion explained in words, no automatic enrolment', async () => {
  const a = await user('Hana'); const b = await user('Ivo', { languages: ['English', 'Spanish'] });
  await a.post('/wishes', { category: 'museum', slots: ['thu_afternoon', 'sat_morning'], budget: 'free' });
  await b.post('/wishes', { category: 'museum', slots: ['thu_afternoon'], budget: 'any' });
  const s = (await a.get('/wishes/suggestions')).body.suggestions.find((x) => x.user.id === b.id);
  assert.ok(s);
  assert.equal(s.reason, 'You both want to visit a museum and are available Thursday afternoon.');
  assert.ok(!('score' in s));
  assert.equal((await b.get('/plans')).body.invited.length, 0);
  // Pausing visibility hides you from suggestions
  await b.put('/me/privacy', { visible: false });
  assert.ok(!(await a.get('/wishes/suggestions')).body.suggestions.some((x) => x.user.id === b.id));
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
