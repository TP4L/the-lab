'use strict';
const { DatabaseSync } = require('node:sqlite');
const Engine = require('../web/engine.js');
const seed = require('./seed.js');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  number TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS situations (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'Coach',
  positions TEXT NOT NULL DEFAULT '[]',
  inputs TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS drills (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  call TEXT NOT NULL DEFAULT '',
  positions TEXT NOT NULL DEFAULT '[]',
  players TEXT NOT NULL DEFAULT '',
  minutes INTEGER NOT NULL DEFAULT 10,
  setup TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL DEFAULT '',
  points TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reps (
  id INTEGER PRIMARY KEY,
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  call TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY,
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  situation_id INTEGER REFERENCES situations(id) ON DELETE CASCADE,
  guess TEXT NOT NULL,
  answer TEXT NOT NULL,
  correct INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS plan_items (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  drill_id INTEGER NOT NULL REFERENCES drills(id) ON DELETE CASCADE,
  minutes INTEGER NOT NULL,
  position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reps_player ON reps(player_id);
CREATE INDEX IF NOT EXISTS attempts_player ON attempts(player_id);
CREATE INDEX IF NOT EXISTS plan_items_plan ON plan_items(plan_id);
`;

function open(file, opts) {
  opts = opts || {};
  const db = new DatabaseSync(file || ':memory:');
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  const empty = db.prepare('SELECT COUNT(*) AS n FROM situations').get().n === 0
    && db.prepare('SELECT COUNT(*) AS n FROM drills').get().n === 0;
  if (empty && opts.seed !== false) seedContent(db, opts.demo !== false);
  return db;
}

function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function seedContent(db, withDemo) {
  tx(db, () => {
    const addSit = db.prepare('INSERT INTO situations (title, description, source, positions, inputs) VALUES (?, ?, ?, ?, ?)');
    seed.SITUATIONS.forEach(s => addSit.run(s.title, s.description, s.source, JSON.stringify(s.positions), JSON.stringify(Engine.normalize(s.inputs))));

    const addDrill = db.prepare('INSERT INTO drills (name, call, positions, players, minutes, setup, steps, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const drillIds = {};
    seed.DRILLS.forEach(d => {
      drillIds[d.name] = Number(addDrill.run(d.name, d.call, JSON.stringify(d.positions), d.players, d.minutes, d.setup, d.steps, d.points).lastInsertRowid);
    });

    const planId = Number(db.prepare('INSERT INTO plans (title, date, notes) VALUES (?, ?, ?)').run(seed.PLAN.title, seed.PLAN.date, seed.PLAN.notes).lastInsertRowid);
    const addItem = db.prepare('INSERT INTO plan_items (plan_id, drill_id, minutes, position) VALUES (?, ?, ?, ?)');
    seed.PLAN.items.forEach((it, i) => addItem.run(planId, drillIds[it.drill], it.minutes, i));

    if (withDemo) {
      const addPlayer = db.prepare('INSERT INTO players (name, number, position, level, notes, demo) VALUES (?, ?, ?, ?, ?, 1)');
      const ids = seed.DEMO_PLAYERS.map(p => Number(addPlayer.run(p.name, p.number, p.position, p.level, p.notes).lastInsertRowid));
      const addRep = db.prepare('INSERT INTO reps (player_id, note, call, error) VALUES (?, ?, ?, ?)');
      seed.DEMO_REPS.forEach(r => addRep.run(ids[r.player], r.note, r.call, r.error));

      // A few graded film attempts so profiles open with numbers.
      const sits = db.prepare('SELECT id, inputs FROM situations ORDER BY id LIMIT 6').all();
      const addAttempt = db.prepare('INSERT INTO attempts (player_id, situation_id, guess, answer, correct) VALUES (?, ?, ?, ?, ?)');
      const guesses = [['gsg', 'own', 'ccs', 'osg', 'osg', 'hpo'], ['gsg', 'ccs', 'tri', 'ccs', 'ccs', 'ccs'], ['x', 'own', 'tri', 'own', 'osg', 'gsg']];
      ids.forEach((pid, pi) => sits.forEach((s, si) => {
        const answer = Engine.run(JSON.parse(s.inputs)).call;
        const guess = guesses[pi][si];
        addAttempt.run(pid, s.id, guess, answer, guess === answer ? 1 : 0);
      }));
    }
  });
}

module.exports = { open, tx };
