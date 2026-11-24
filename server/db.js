import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export function openDb(file = config.dbPath) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Additive migrations for databases created by earlier versions. */
function migrate(db) {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  if (!cols('users').includes('email_verified_at')) db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
  if (!cols('profiles').includes('lang')) db.exec("ALTER TABLE profiles ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'");
  // Intro and meeting area are shown on the profile only if the student switches them on. Intros written before this keep showing.
  if (!cols('profiles').includes('show_intro')) {
    db.exec('ALTER TABLE profiles ADD COLUMN show_intro INTEGER NOT NULL DEFAULT 0');
    db.exec("UPDATE profiles SET show_intro = 1 WHERE intro IS NOT NULL AND intro != ''");
  }
  if (!cols('profiles').includes('show_area')) db.exec('ALTER TABLE profiles ADD COLUMN show_area INTEGER NOT NULL DEFAULT 0');
  if (!cols('profiles').includes('photo_v')) db.exec('ALTER TABLE profiles ADD COLUMN photo_v INTEGER NOT NULL DEFAULT 0');
  if (!cols('activities').includes('join_mode')) db.exec("ALTER TABLE activities ADD COLUMN join_mode TEXT NOT NULL DEFAULT 'request'");
  // "Ask students": questions about the city (e.g. a good hairdresser) and other students' answers.
  db.exec(`CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY, city_id INTEGER NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS answers (id INTEGER PRIMARY KEY, question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_answers_q ON answers(question_id, id)');
  db.exec('CREATE TABLE IF NOT EXISTS answer_votes (answer_id INTEGER NOT NULL REFERENCES answers(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, PRIMARY KEY (answer_id, user_id))');
  if (!cols('notifications').includes('listing_id')) db.exec('ALTER TABLE notifications ADD COLUMN listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE');
  if (!cols('notifications').includes('question_id')) db.exec('ALTER TABLE notifications ADD COLUMN question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE');
  if (!cols('users').includes('is_guest')) db.exec('ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0');
  if (!cols('events').includes('photo_key')) db.exec('ALTER TABLE events ADD COLUMN photo_key TEXT');
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  if (!cols('events').includes('lat')) { db.exec('ALTER TABLE events ADD COLUMN lat REAL'); db.exec('ALTER TABLE events ADD COLUMN lng REAL'); }
  // Real events imported from organisers' own pages (see server/events-import.js). All nullable; sample events leave them empty.
  for (const [c, type] of [['ext_id', 'TEXT'], ['desc_es', 'TEXT'], ['price_es', 'TEXT'], ['price_short', 'TEXT'], ['listed_by', 'TEXT'], ['note_en', 'TEXT'], ['note_es', 'TEXT'], ['venue_address', 'TEXT'],
    ['ticket_platform', 'TEXT'], ['ticket_url', 'TEXT'], ['age_note', 'TEXT'], ['source_name', 'TEXT'], ['source_url', 'TEXT'], ['checked_at', 'TEXT'],
    ['series_key', 'TEXT'], ['series_label', 'TEXT'], ['time_known', 'INTEGER NOT NULL DEFAULT 1'], ['listed_until', 'TEXT']]) {
    if (!cols('events').includes(c)) db.exec(`ALTER TABLE events ADD COLUMN ${c} ${type}`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS events_ext_id ON events(ext_id)');
  // Buddies status: what I feel like doing, when, roughly where, until when. All optional, set only by the user.
  if (!cols('profiles').includes('status_category')) {
    for (const c of ['status_category', 'status_slot', 'status_area', 'status_note', 'status_expires_at']) db.exec(`ALTER TABLE profiles ADD COLUMN ${c} TEXT`);
  }
  // Pre-launch release 1 (Nov 2026): plans keep only what the creator actually said. All nullable, so older rows keep their meaning:
  // time_mode NULL = an exact time (older plans), cost_mode NULL = the historical cost_eur value, capped NULL = capped (older plans).
  for (const [c, type] of [['time_mode', 'TEXT'], ['time_window', 'TEXT'], ['ends_at', 'TEXT'], ['duration_choice', 'TEXT'], ['cost_mode', 'TEXT'],
    ['capped', 'INTEGER'], ['photo_mime', 'TEXT'], ['photo', 'BLOB'], ['photo_v', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!cols('activities').includes(c)) db.exec(`ALTER TABLE activities ADD COLUMN ${c} ${type}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS password_tokens (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL)`);
  // Test accounts are excluded from campaign numbers.
  if (!cols('users').includes('is_test')) db.exec('ALTER TABLE users ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0');
  // Pre-launch release 2: optional stay (first semester, full year, I live here…), flags for the bio, and a free-text meeting area.
  for (const [c, type] of [['stay', 'TEXT'], ['flags', "TEXT NOT NULL DEFAULT '[]'"], ['meet_area', 'TEXT']]) {
    if (!cols('profiles').includes(c)) db.exec(`ALTER TABLE profiles ADD COLUMN ${c} ${type}`);
  }
  // Pre-launch release 3: team inbox (admins, review status, reply address) and several photos per listing.
  if (!cols('users').includes('is_admin')) db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
  for (const c of ['reviewed_at', 'reviewed_by']) if (!cols('reports').includes(c)) db.exec(`ALTER TABLE reports ADD COLUMN ${c} ${c === 'reviewed_by' ? 'INTEGER' : 'TEXT'}`);
  for (const [c, type] of [['reply_email', 'TEXT'], ['status', "TEXT NOT NULL DEFAULT 'open'"], ['reviewed_at', 'TEXT'], ['reviewed_by', 'INTEGER']]) {
    if (!cols('feedback').includes(c)) db.exec(`ALTER TABLE feedback ADD COLUMN ${c} ${type}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS listing_photos (id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL DEFAULT 0, mime TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_listing_photos ON listing_photos(listing_id, sort)');
  // Connections between students: a request, accepted or declined by the other person. Private chat only once accepted.
  db.exec(`CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY,
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    responded_at TEXT,
    UNIQUE (requester_id, target_id)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_conn_target ON connections(target_id, status)');
  db.exec(`CREATE TABLE IF NOT EXISTS direct_messages (
    id INTEGER PRIMARY KEY,
    connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_dm_conn ON direct_messages(connection_id, id)');
  db.exec('CREATE TABLE IF NOT EXISTS dm_reads (connection_id INTEGER NOT NULL, user_id INTEGER NOT NULL, last_read_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (connection_id, user_id))');
  // The day can be left open: 'day' (a chosen day), 'weekend', 'week' or 'flex' (in the next two weeks).
  if (!cols('activities').includes('day_mode')) db.exec("ALTER TABLE activities ADD COLUMN day_mode TEXT NOT NULL DEFAULT 'day'");
  // Plans without a photo show an emoji the creator picked ('' = the category's emoji).
  if (!cols('activities').includes('emoji')) db.exec("ALTER TABLE activities ADD COLUMN emoji TEXT NOT NULL DEFAULT ''");
  // Visitor counts for the team: who opened the app on which day (Canary date), and how many times. No outside trackers, no IPs.
  db.exec(`CREATE TABLE IF NOT EXISTS daily_visits (day TEXT NOT NULL, user_id INTEGER NOT NULL, kind TEXT NOT NULL, opens INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (day, user_id))`);
  // Link tags (?src=instagram): which tagged link someone opened the app from, per day, and the first one per person.
  db.exec('CREATE TABLE IF NOT EXISTS visit_sources (day TEXT NOT NULL, user_id INTEGER NOT NULL, src TEXT NOT NULL, PRIMARY KEY (day, user_id, src))');
  db.exec('CREATE TABLE IF NOT EXISTS user_sources (user_id INTEGER PRIMARY KEY, src TEXT NOT NULL, day TEXT NOT NULL)');
  // Guest sign-up steps for the team (tapped Join, opened sign-up, created account): one total per step per day, no user ids.
  db.exec('CREATE TABLE IF NOT EXISTS guest_steps (day TEXT NOT NULL, step TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, step))');
}

/** Run fn inside an IMMEDIATE transaction (takes the write lock first, so capacity checks cannot race). */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cities (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  timezone TEXT NOT NULL,
  areas TEXT NOT NULL DEFAULT '[]' -- JSON [{key,name,lat,lng}] approximate neighbourhood centres
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL DEFAULT '',
  intro TEXT NOT NULL DEFAULT '',
  city_id INTEGER REFERENCES cities(id),
  area TEXT,
  university TEXT,
  show_university INTEGER NOT NULL DEFAULT 0,
  exchange_start TEXT,
  exchange_end TEXT,
  role TEXT NOT NULL DEFAULT 'exchange', -- exchange | international | intern | local
  languages TEXT NOT NULL DEFAULT '[]',
  interests TEXT NOT NULL DEFAULT '[]',
  visible INTEGER NOT NULL DEFAULT 1,
  nearby_enabled INTEGER NOT NULL DEFAULT 0,
  show_sample INTEGER NOT NULL DEFAULT 1,
  onboarded INTEGER NOT NULL DEFAULT 0,
  avatar_hue INTEGER NOT NULL DEFAULT 220
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 120,
  venue TEXT NOT NULL,
  organiser_name TEXT NOT NULL,
  official_url TEXT,
  price_note TEXT,
  is_sample INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  organiser_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES events(id),
  template TEXT NOT NULL DEFAULT 'other',
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  meeting_area TEXT NOT NULL,
  meeting_point TEXT NOT NULL DEFAULT '',
  cost_eur REAL NOT NULL DEFAULT 0,
  max_participants INTEGER NOT NULL CHECK (max_participants BETWEEN 2 AND 30),
  beginner_friendly INTEGER NOT NULL DEFAULT 0,
  pace TEXT,
  transport TEXT,
  languages TEXT NOT NULL DEFAULT '[]',
  solo_format INTEGER NOT NULL DEFAULT 0,
  welcome_plan TEXT NOT NULL DEFAULT '',
  recognise_tip TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active', -- active | cancelled
  cancel_reason TEXT,
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_act_city_time ON activities(city_id, starts_at);

-- One row per (activity, user). The organiser is NOT stored here; they always count as one place.
CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL, -- pending | invited | accepted | declined | left | removed | withdrawn
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (activity_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'user', -- user | system
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_act ON messages(activity_id, id);

CREATE TABLE IF NOT EXISTS event_interests (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_pref TEXT NOT NULL DEFAULT 'either', -- buddy | small | either
  languages TEXT NOT NULL DEFAULT '[]',
  meeting_option TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS wishes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  category TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  slots TEXT NOT NULL DEFAULT '[]', -- JSON ["thu_afternoon", ...]
  budget TEXT NOT NULL DEFAULT 'any', -- free | low | any
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL, -- user | activity | message
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- In-app notifications. Stored as a kind + references so the client can show them in the user's language.
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- request_received | request_accepted | request_declined | removed | invited | invite_accepted | left | cancelled | changed
  activity_id INTEGER REFERENCES activities(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  detail TEXT NOT NULL DEFAULT '',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id);

-- Last chat message each person has seen per activity, for unread counts.
CREATE TABLE IF NOT EXISTS chat_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, activity_id)
);

-- One-time email verification tokens (only a hash is stored).
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Profile pictures (resized in the browser before upload). Sample personas get drawn avatars, never photos of real people.
CREATE TABLE IF NOT EXISTS photos (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Student recommendations: places and tips, with likes and saves.
CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  area TEXT,
  url TEXT,
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS rec_likes (
  rec_id INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (rec_id, user_id)
);
CREATE TABLE IF NOT EXISTS rec_saves (
  rec_id INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (rec_id, user_id)
);

-- Group chat for everyone who marked an event as "I'm going / looking for company".
CREATE TABLE IF NOT EXISTS event_messages (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_evmsg ON event_messages(event_id, id);

-- Feedback and ideas from users, read by the project team (admin endpoint).
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL, -- idea | problem | other
  body TEXT NOT NULL,
  screen TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Marketplace: second-hand items and event tickets between students. No payments in the app.
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- sell | free | wanted | ticket
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_eur REAL,
  face_value_eur REAL, -- tickets only: what the seller says they paid
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  area TEXT,
  photo_mime TEXT,
  photo BLOB,
  status TEXT NOT NULL DEFAULT 'active', -- active | reserved | sold
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_listings_city ON listings(city_id, status, id);
CREATE TABLE IF NOT EXISTS listing_saves (
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (listing_id, user_id)
);
-- Private conversation between the seller and one interested person per listing.
CREATE TABLE IF NOT EXISTS listing_messages (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_lmsg ON listing_messages(listing_id, buyer_id, id);

CREATE TABLE IF NOT EXISTS guide_items (
  id INTEGER PRIMARY KEY,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  section TEXT NOT NULL, -- transport | housing | health | university | students | links
  kind TEXT NOT NULL, -- official | community | placeholder
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  url TEXT,
  source_name TEXT,
  checked_at TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
`;
