'use strict';
const { DatabaseSync } = require('node:sqlite');

/* One database for the website and the app. Every table the app writes is
   something the website reads through the same API. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '["athlete"]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

-- Athlete profiles. A coach can create one before the athlete has an account;
-- the athlete claims it with a one-time code, so history stays on one record.
CREATE TABLE IF NOT EXISTS athletes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  hand TEXT NOT NULL DEFAULT '',
  side TEXT NOT NULL DEFAULT '',
  rating TEXT NOT NULL DEFAULT '',
  goals TEXT NOT NULL DEFAULT '',
  focus TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  photo_media_id TEXT,
  claim_code_hash TEXT,
  claim_email TEXT COLLATE NOCASE,
  claim_attempts INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS coach_athletes (
  coach_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  PRIMARY KEY (coach_id, athlete_id)
);

-- Notes. visibility 'private' is coach-only; 'shared' is visible to the athlete.
-- kind 'reflection' is written by the athlete and is always shared.
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  client_id TEXT,
  athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('coach','reflection')),
  visibility TEXT NOT NULL CHECK (visibility IN ('private','shared')),
  body TEXT NOT NULL,
  media_id TEXT,
  session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (author_id, client_id)
);

-- Uploaded photos and video. Access is checked on every download.
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  athlete_id INTEGER REFERENCES athletes(id) ON DELETE CASCADE,
  post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','shared','public')),
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  file TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Training sessions (Scoreboard Studio). IDs are generated on the device so a
-- session can start offline. Scores are an append-only event log: devices can
-- merge by union, and undo points at the event it cancels.
CREATE TABLE IF NOT EXISTS training_sessions (
  id TEXT PRIMARY KEY,
  coach_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','complete')),
  version INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS training_athletes (
  session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  PRIMARY KEY (session_id, athlete_id)
);
CREATE TABLE IF NOT EXISTS training_items (
  session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  name TEXT NOT NULL,
  measure TEXT NOT NULL CHECK (measure IN ('reps','time','score','feel')),
  target TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, idx)
);
CREATE TABLE IF NOT EXISTS score_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  item_idx INTEGER NOT NULL,
  athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('make','miss','value','undo')),
  value REAL,
  undoes TEXT,
  at TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Publishing Studio.
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  lane TEXT NOT NULL CHECK (lane IN ('quick_read','the_work','field_study')),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  author_credit TEXT NOT NULL DEFAULT '',
  thumbnail_media_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','scheduled','published')),
  review_note TEXT NOT NULL DEFAULT '',
  publish_at TEXT,
  published_at TEXT,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS post_revisions (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  editor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS notes_athlete ON notes(athlete_id);
CREATE INDEX IF NOT EXISTS events_session ON score_events(session_id);
CREATE INDEX IF NOT EXISTS events_athlete ON score_events(athlete_id);
CREATE INDEX IF NOT EXISTS posts_status ON posts(status, publish_at);
CREATE INDEX IF NOT EXISTS media_athlete ON media(athlete_id);
`;

/* Play: matches, events, round robins, check-in, notifications. */
const PLAY = `
ALTER TABLE athletes ADD COLUMN checkin_code TEXT;
ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS athletes_checkin ON athletes(checkin_code);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  organizer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  capacity INTEGER,
  courts INTEGER NOT NULL DEFAULT 2,
  format TEXT NOT NULL DEFAULT 'round_robin' CHECK (format IN ('round_robin','open_play','clinic')),
  game_to INTEGER NOT NULL DEFAULT 11,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','live','complete','cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- One row per athlete per event. 'active' is the organizer's switch for late
-- arrivals and early departures: only active, checked-in players get courts.
CREATE TABLE IF NOT EXISTS event_people (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('interested','registered','waitlist','withdrawn')),
  checked_in_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (event_id, athlete_id)
);
CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','done')),
  sitting_out TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (event_id, number)
);

-- Matches. The recording device picks the UUID so a match can be saved offline.
-- status: recorded (self-recorded), confirmed (by an opponent),
-- verified (by an organizer or coach), disputed.
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('casual','training','competition')),
  game_to INTEGER NOT NULL DEFAULT 11,
  win_by INTEGER NOT NULL DEFAULT 2,
  best_of INTEGER NOT NULL DEFAULT 1,
  played_at TEXT NOT NULL,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
  court INTEGER,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('scheduled','recorded','confirmed','verified','disputed')),
  winner INTEGER,
  note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS match_players (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team INTEGER NOT NULL CHECK (team IN (1,2)),
  slot INTEGER NOT NULL CHECK (slot IN (1,2)),
  athlete_id INTEGER REFERENCES athletes(id) ON DELETE SET NULL,
  guest_name TEXT NOT NULL DEFAULT '',
  side TEXT NOT NULL DEFAULT '' CHECK (side IN ('','left','right')),
  PRIMARY KEY (match_id, team, slot)
);
CREATE TABLE IF NOT EXISTS match_games (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  team1 INTEGER NOT NULL,
  team2 INTEGER NOT NULL,
  PRIMARY KEY (match_id, idx)
);
CREATE TABLE IF NOT EXISTS match_log (
  id INTEGER PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  snapshot TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS mp_athlete ON match_players(athlete_id);
CREATE INDEX IF NOT EXISTS matches_event ON matches(event_id, round_id);
CREATE INDEX IF NOT EXISTS notif_user ON notifications(user_id, read_at);
`;

/* Ordered migrations, tracked with PRAGMA user_version. Never edit a shipped
   entry; add a new one. */
/* Background job bookkeeping: one row per notice already sent. */
const JOBS = `
CREATE TABLE IF NOT EXISTS job_log (
  key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

const MIGRATIONS = [SCHEMA, PLAY, JOBS];

function open(file) {
  const db = new DatabaseSync(file || ':memory:');
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  let v = db.prepare('PRAGMA user_version').get().user_version;
  // Databases created before migrations existed already have the base schema.
  if (v === 0 && db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'users'").get()) v = 1;
  for (; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return db;
}

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

const now = () => new Date().toISOString();

module.exports = { open, tx, now };
