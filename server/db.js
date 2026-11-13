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
  if (!cols('profiles').includes('photo_v')) db.exec('ALTER TABLE profiles ADD COLUMN photo_v INTEGER NOT NULL DEFAULT 0');
  if (!cols('activities').includes('join_mode')) db.exec("ALTER TABLE activities ADD COLUMN join_mode TEXT NOT NULL DEFAULT 'request'");
  if (!cols('notifications').includes('listing_id')) db.exec('ALTER TABLE notifications ADD COLUMN listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE');
  if (!cols('events').includes('lat')) { db.exec('ALTER TABLE events ADD COLUMN lat REAL'); db.exec('ALTER TABLE events ADD COLUMN lng REAL'); }
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
