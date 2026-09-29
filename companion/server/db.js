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

/* Learn: courses, lessons, membership, cohorts, progress, saved posts. */
const LEARN = `
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL DEFAULT '',
  cover_media_id TEXT,
  access TEXT NOT NULL DEFAULT 'members' CHECK (access IN ('public','members','cohort')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  module TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  video_media_id TEXT,
  minutes INTEGER,
  preview INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Membership is granted by an admin for now; source records where it came from
-- so a payment provider can manage its own rows later.
CREATE TABLE IF NOT EXISTS memberships (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  expires_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT NOT NULL DEFAULT '',
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS cohorts (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  starts_at TEXT,
  ends_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS cohort_members (
  cohort_id INTEGER NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (cohort_id, user_id)
);
CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, lesson_id)
);
CREATE TABLE IF NOT EXISTS saved_posts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, post_id)
);
ALTER TABLE media ADD COLUMN lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL;
ALTER TABLE media ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS lessons_course ON lessons(course_id, position);
`;

/* Coaching: reusable session templates and training assigned to athletes. */
const COACHING = `
CREATE TABLE IF NOT EXISTS training_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  items TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY,
  athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES training_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  due_on TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  session_id TEXT REFERENCES training_sessions(id) ON DELETE SET NULL,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS assignments_athlete ON assignments(athlete_id, status);
CREATE INDEX IF NOT EXISTS notes_session ON notes(session_id);
CREATE INDEX IF NOT EXISTS matches_session ON matches(session_id);
`;

/* Team events (fixed partners) and single-elimination brackets. */
const TEAMS = `
ALTER TABLE events ADD COLUMN partner_mode TEXT NOT NULL DEFAULT 'rotating';
ALTER TABLE matches ADD COLUMN bracket INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS event_teams (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  p1 INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  p2 INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- One row per bracket position. Round 0 holds the seeded teams (null = bye);
-- later rounds fill in as winners are known.
CREATE TABLE IF NOT EXISTS bracket_slots (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  pos INTEGER NOT NULL,
  team_a INTEGER REFERENCES event_teams(id) ON DELETE SET NULL,
  team_b INTEGER REFERENCES event_teams(id) ON DELETE SET NULL,
  match_id TEXT REFERENCES matches(id) ON DELETE SET NULL,
  winner_team INTEGER,
  PRIMARY KEY (event_id, round, pos)
);
CREATE INDEX IF NOT EXISTS teams_event ON event_teams(event_id);
`;

/* Phone push subscriptions and sign-in with Google. */
const DEVICES = `
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
ALTER TABLE users ADD COLUMN google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users(google_sub);
`;

/* Event desk: formats, guest players, share links, timed rounds, brackets
   with a losers side, court acknowledgments and attendance history. */
const EVENT_DESK = `
ALTER TABLE events ADD COLUMN mode TEXT NOT NULL DEFAULT 'rotate';
ALTER TABLE events ADD COLUMN scoring TEXT NOT NULL DEFAULT 'traditional';
ALTER TABLE events ADD COLUMN round_limit INTEGER;
ALTER TABLE events ADD COLUMN round_minutes INTEGER;
ALTER TABLE events ADD COLUMN round_end TEXT NOT NULL DEFAULT 'all';
ALTER TABLE events ADD COLUMN race_target INTEGER;
ALTER TABLE events ADD COLUMN elimination TEXT NOT NULL DEFAULT 'single';
ALTER TABLE events ADD COLUMN registration_open INTEGER NOT NULL DEFAULT 1;
ALTER TABLE events ADD COLUMN show_roster INTEGER NOT NULL DEFAULT 1;
ALTER TABLE events ADD COLUMN share_token TEXT;
ALTER TABLE events ADD COLUMN watch_token TEXT;
ALTER TABLE events ADD COLUMN schedule TEXT;
ALTER TABLE events ADD COLUMN plan_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS events_share ON events(share_token);
CREATE UNIQUE INDEX IF NOT EXISTS events_watch ON events(watch_token);

ALTER TABLE event_people ADD COLUMN number INTEGER;
ALTER TABLE event_people ADD COLUMN guest_token TEXT;
ALTER TABLE event_people ADD COLUMN email TEXT;
ALTER TABLE event_people ADD COLUMN phone TEXT;
ALTER TABLE event_people ADD COLUMN on_break INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS ep_guest ON event_people(guest_token);

ALTER TABLE rounds ADD COLUMN ends_at TEXT;
ALTER TABLE rounds ADD COLUMN stopped_at TEXT;

ALTER TABLE matches ADD COLUMN start1 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE matches ADD COLUMN start2 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE matches ADD COLUMN matchup INTEGER;
ALTER TABLE matches ADD COLUMN bracket_code TEXT;

ALTER TABLE event_teams ADD COLUMN p3 INTEGER REFERENCES athletes(id) ON DELETE CASCADE;

-- Knockout brackets as a graph: each game takes its two teams from a seed,
-- or from the winner or loser of an earlier game. That covers single and
-- double elimination, byes included.
CREATE TABLE IF NOT EXISTS bracket_games (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  section TEXT NOT NULL CHECK (section IN ('W','L','F')),
  round INTEGER NOT NULL,
  pos INTEGER NOT NULL,
  src_a TEXT NOT NULL,
  src_b TEXT NOT NULL,
  team_a INTEGER,
  team_b INTEGER,
  match_id TEXT REFERENCES matches(id) ON DELETE SET NULL,
  winner_team INTEGER,
  loser_team INTEGER,
  settled INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, code)
);
CREATE TABLE IF NOT EXISTS match_acks (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (match_id, athlete_id)
);
-- Every roster change, so the last one can be undone before the next round.
CREATE TABLE IF NOT EXISTS attendance_log (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  before TEXT NOT NULL,
  by_user INTEGER REFERENCES users(id) ON DELETE SET NULL,
  undone INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Phone alerts for players who joined with a link instead of an account.
CREATE TABLE IF NOT EXISTS guest_push (
  id INTEGER PRIMARY KEY,
  athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  last_status INTEGER,
  last_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
ALTER TABLE push_subscriptions ADD COLUMN last_status INTEGER;
ALTER TABLE push_subscriptions ADD COLUMN last_at TEXT;
CREATE INDEX IF NOT EXISTS attendance_event ON attendance_log(event_id, id);
`;

/* Pending Interest (find the group before picking a date) and Team Planner
   (coached sessions with invitations, court blocks and player recaps). */
const PLANNING = `
CREATE TABLE IF NOT EXISTS interest_checks (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'training',
  description TEXT NOT NULL DEFAULT '',
  skill_level TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  timing TEXT NOT NULL DEFAULT '',
  min_people INTEGER,
  max_people INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','scheduled')),
  final_starts_at TEXT,
  plan_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS interest_options (
  id INTEGER PRIMARY KEY,
  check_id INTEGER NOT NULL REFERENCES interest_checks(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  starts_at TEXT
);
CREATE TABLE IF NOT EXISTS interest_responses (
  id INTEGER PRIMARY KEY,
  check_id INTEGER NOT NULL REFERENCES interest_checks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('interested','maybe','waitlist')),
  option_ids TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  edit_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (check_id, email)
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  timezone TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  sport TEXT NOT NULL DEFAULT 'Pickleball',
  coaches TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  agenda TEXT NOT NULL DEFAULT '',
  handoff TEXT NOT NULL DEFAULT '',
  capacity INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','done','cancelled')),
  interest_id INTEGER REFERENCES interest_checks(id) ON DELETE SET NULL,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS plan_blocks (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  start_time TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '',
  court TEXT NOT NULL DEFAULT '',
  lead TEXT NOT NULL DEFAULT '',
  drill TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS plan_players (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  athlete_id INTEGER REFERENCES athletes(id) ON DELETE SET NULL,
  court TEXT NOT NULL DEFAULT '',
  rsvp TEXT NOT NULL DEFAULT 'invited' CHECK (rsvp IN ('invited','in','out','maybe','waitlist')),
  rsvp_at TEXT,
  token TEXT NOT NULL UNIQUE,
  recap_observation TEXT NOT NULL DEFAULT '',
  recap_cue TEXT NOT NULL DEFAULT '',
  recap_next TEXT NOT NULL DEFAULT '',
  recap_published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Saved groups of players and saved drills, per coach.
CREATE TABLE IF NOT EXISTS plan_library (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('group','drill')),
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS plan_players_plan ON plan_players(plan_id);
CREATE INDEX IF NOT EXISTS plan_blocks_plan ON plan_blocks(plan_id, ord);
`;

/* Host controls: chosen court numbers, late joining, the saved preview
   ("draw") and per-round timers that start paused. */
const HOST_CONTROLS = `
ALTER TABLE events ADD COLUMN court_numbers TEXT;
ALTER TABLE events ADD COLUMN late_join INTEGER NOT NULL DEFAULT 1;
ALTER TABLE events ADD COLUMN draw TEXT;
ALTER TABLE rounds ADD COLUMN duration_sec INTEGER;
ALTER TABLE rounds ADD COLUMN remaining_sec INTEGER;
`;

const WEBSITE_CONNECTION = `
CREATE TABLE website_connections (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 athlete_id TEXT NOT NULL UNIQUE,
 athlete_name TEXT NOT NULL,
 token TEXT NOT NULL,
 connected_at TEXT NOT NULL
);`;
const WEBSITE_IDENTITY = `
CREATE TABLE website_identities (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 subject TEXT NOT NULL UNIQUE,
 athlete_id TEXT NOT NULL UNIQUE
);
CREATE TABLE website_profile_originals (
 athlete_id INTEGER PRIMARY KEY REFERENCES athletes(id) ON DELETE CASCADE,
 data TEXT NOT NULL
);
CREATE TABLE website_signin_states (
 state_hash TEXT PRIMARY KEY,
 verifier TEXT NOT NULL,
 user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);`;
const WEBSITE_STAFF = `CREATE TABLE website_staff_connections (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 subject TEXT NOT NULL UNIQUE,
 email TEXT NOT NULL,
 token TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);`;
const MIGRATIONS = [SCHEMA, PLAY, JOBS, LEARN, COACHING, TEAMS, DEVICES, EVENT_DESK, PLANNING, HOST_CONTROLS, WEBSITE_CONNECTION, WEBSITE_IDENTITY, WEBSITE_STAFF];

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
