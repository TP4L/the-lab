'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Engine = require('../web/engine.js');
const { open, tx } = require('./db.js');

const WEB_ROOT = path.join(__dirname, '..', 'web');
const MAX_BODY = 64 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};

const STATUS = Symbol('status');
const withStatus = (status, body) => ({ [STATUS]: status, body });

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------- validation helpers ---------- */
const CALL_IDS = Engine.CALLS.map(c => c.id);
const ERROR_IDS = Engine.ERRORS.map(e => e.id);

function str(v, field, { required = false, max = 2000 } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, `${field} must be text.`);
  v = String(v).trim();
  if (required && !v) throw new HttpError(400, `${field} is required.`);
  if (v.length > max) throw new HttpError(400, `${field} must be ${max} characters or fewer.`);
  return v;
}
function oneOf(v, list, field, { allowEmpty = false } = {}) {
  if ((v === undefined || v === null || v === '') && allowEmpty) return '';
  if (!list.includes(v)) throw new HttpError(400, `${field} must be one of: ${list.join(', ')}.`);
  return v;
}
function int(v, field, { min = 0, max = 1e6, required = false } = {}) {
  if ((v === undefined || v === null || v === '') && !required) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be a whole number from ${min} to ${max}.`);
  return n;
}
function positions(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, 'positions must be a list.');
  return [...new Set(v.map(p => oneOf(p, Engine.POSITIONS, 'positions')))];
}
function date(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, 'date must be YYYY-MM-DD.');
  return v;
}

/* ---------- row shaping ---------- */
const sitRow = r => r && ({ ...r, positions: JSON.parse(r.positions), inputs: JSON.parse(r.inputs), answer: Engine.run(JSON.parse(r.inputs)).call });
const drillRow = r => r && ({ ...r, positions: JSON.parse(r.positions) });
const playerRow = r => r && ({ ...r, demo: !!r.demo });

function createApp(opts = {}) {
  const db = opts.db || open(opts.file, opts);
  const coachKey = opts.coachKey || '';

  function getOr404(sql, id, what) {
    const row = db.prepare(sql).get(id);
    if (!row) throw new HttpError(404, `${what} ${id} not found.`);
    return row;
  }

  /* ---------- players ---------- */
  function playerFields(b) {
    return {
      name: str(b.name, 'name', { required: true, max: 80 }),
      number: str(b.number, 'number', { max: 4 }),
      position: oneOf(b.position, Engine.POSITIONS, 'position', { allowEmpty: true }),
      level: str(b.level, 'level', { max: 40 }),
      notes: str(b.notes, 'notes', { max: 2000 })
    };
  }

  function playerSummary(id) {
    const player = playerRow(getOr404('SELECT * FROM players WHERE id = ?', id, 'Player'));
    const errors = Object.fromEntries(ERROR_IDS.map(e => [e, 0]));
    db.prepare('SELECT error, COUNT(*) AS n FROM reps WHERE player_id = ? GROUP BY error').all(id).forEach(r => { errors[r.error] = r.n; });
    const att = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS right FROM attempts WHERE player_id = ?').get(id);
    const byCall = db.prepare(`SELECT answer AS call, COUNT(*) AS n, SUM(correct) AS right FROM attempts
                               WHERE player_id = ? GROUP BY answer ORDER BY answer`).all(id);
    const reps = db.prepare('SELECT * FROM reps WHERE player_id = ? ORDER BY created_at DESC, id DESC LIMIT 50').all(id);
    const attempts = db.prepare(`SELECT a.*, s.title FROM attempts a LEFT JOIN situations s ON s.id = a.situation_id
                                 WHERE a.player_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 30`).all(id)
      .map(a => ({ ...a, correct: !!a.correct }));
    const topError = ERROR_IDS.reduce((a, e) => (errors[e] > errors[a] ? e : a), ERROR_IDS[0]);
    return {
      player, errors, reps, attempts, byCall,
      film: { seen: att.n, right: att.right, accuracy: att.n ? att.right / att.n : null },
      focus: errors[topError] ? topError : null
    };
  }

  /* ---------- routes ---------- */
  const routes = [];
  const route = (method, pattern, handler, { write = method !== 'GET' } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([0-9]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler, write });
  };

  route('GET', '/api/health', () => ({ ok: true }));
  route('GET', '/api/meta', () => ({
    calls: Engine.CALLS, errors: Engine.ERRORS, rungs: Engine.RUNGS, states: Engine.STATES,
    positions: Engine.POSITIONS, auth: !!coachKey
  }));
  route('POST', '/api/engine/run', ({ body }) => Engine.run(body), { write: false });

  // Dashboard
  route('GET', '/api/dashboard', () => {
    const counts = {
      players: db.prepare('SELECT COUNT(*) AS n FROM players').get().n,
      situations: db.prepare('SELECT COUNT(*) AS n FROM situations').get().n,
      drills: db.prepare('SELECT COUNT(*) AS n FROM drills').get().n,
      plans: db.prepare('SELECT COUNT(*) AS n FROM plans').get().n
    };
    const errors = Object.fromEntries(ERROR_IDS.map(e => [e, 0]));
    db.prepare('SELECT error, COUNT(*) AS n FROM reps GROUP BY error').all().forEach(r => { errors[r.error] = r.n; });
    const film = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS right FROM attempts').get();
    const roster = db.prepare(`SELECT p.id, p.name, p.number, p.position, p.demo,
        (SELECT COUNT(*) FROM attempts a WHERE a.player_id = p.id) AS seen,
        (SELECT COALESCE(SUM(correct), 0) FROM attempts a WHERE a.player_id = p.id) AS right,
        (SELECT COUNT(*) FROM reps r WHERE r.player_id = p.id) AS reps
      FROM players p ORDER BY p.name COLLATE NOCASE`).all().map(playerRow);
    const missed = db.prepare(`SELECT s.id, s.title, COUNT(*) AS n, SUM(1 - a.correct) AS wrong
        FROM attempts a JOIN situations s ON s.id = a.situation_id
        GROUP BY s.id HAVING wrong > 0 ORDER BY (wrong * 1.0 / n) DESC, wrong DESC LIMIT 5`).all();
    const recent = db.prepare(`SELECT r.*, p.name AS player FROM reps r LEFT JOIN players p ON p.id = r.player_id
        ORDER BY r.created_at DESC, r.id DESC LIMIT 6`).all();
    const nextPlan = db.prepare(`SELECT id, title, date FROM plans WHERE date IS NULL OR date >= date('now')
        ORDER BY date IS NULL, date LIMIT 1`).get() || null;
    return { counts, errors, film, roster, missed, recent, nextPlan };
  });

  // Players
  route('GET', '/api/players', () => db.prepare('SELECT * FROM players ORDER BY name COLLATE NOCASE').all().map(playerRow));
  route('POST', '/api/players', ({ body }) => {
    const f = playerFields(body);
    const id = Number(db.prepare('INSERT INTO players (name, number, position, level, notes) VALUES (?, ?, ?, ?, ?)')
      .run(f.name, f.number, f.position, f.level, f.notes).lastInsertRowid);
    return withStatus(201, playerRow(db.prepare('SELECT * FROM players WHERE id = ?').get(id)));
  });
  route('DELETE', '/api/players/demo', () => {
    const r = db.prepare('DELETE FROM players WHERE demo = 1').run();
    return { deleted: Number(r.changes) };
  });
  route('GET', '/api/players/:id', ({ params }) => playerSummary(params.id));
  route('PUT', '/api/players/:id', ({ params, body }) => {
    getOr404('SELECT id FROM players WHERE id = ?', params.id, 'Player');
    const f = playerFields(body);
    db.prepare('UPDATE players SET name = ?, number = ?, position = ?, level = ?, notes = ?, demo = 0 WHERE id = ?')
      .run(f.name, f.number, f.position, f.level, f.notes, params.id);
    return playerRow(db.prepare('SELECT * FROM players WHERE id = ?').get(params.id));
  });
  route('DELETE', '/api/players/:id', ({ params }) => {
    getOr404('SELECT id FROM players WHERE id = ?', params.id, 'Player');
    db.prepare('DELETE FROM players WHERE id = ?').run(params.id);
    return withStatus(204, null);
  });

  // Reps (error log)
  route('GET', '/api/reps', ({ query }) => {
    const pid = int(query.get('player_id'), 'player_id', { min: 1 });
    return pid
      ? db.prepare('SELECT * FROM reps WHERE player_id = ? ORDER BY created_at DESC, id DESC').all(pid)
      : db.prepare('SELECT r.*, p.name AS player FROM reps r LEFT JOIN players p ON p.id = r.player_id ORDER BY r.created_at DESC, r.id DESC LIMIT 200').all();
  });
  route('POST', '/api/reps', ({ body }) => {
    const pid = int(body.player_id, 'player_id', { min: 1 });
    if (pid) getOr404('SELECT id FROM players WHERE id = ?', pid, 'Player');
    const note = str(body.note, 'note', { max: 2000 });
    const call = oneOf(body.call, CALL_IDS, 'call', { allowEmpty: true });
    const error = oneOf(body.error, ERROR_IDS, 'error');
    const id = Number(db.prepare('INSERT INTO reps (player_id, note, call, error) VALUES (?, ?, ?, ?)').run(pid, note, call, error).lastInsertRowid);
    return withStatus(201, db.prepare('SELECT * FROM reps WHERE id = ?').get(id));
  });
  route('DELETE', '/api/reps/:id', ({ params }) => {
    getOr404('SELECT id FROM reps WHERE id = ?', params.id, 'Rep');
    db.prepare('DELETE FROM reps WHERE id = ?').run(params.id);
    return withStatus(204, null);
  });

  // Situations
  function sitFields(b) {
    return {
      title: str(b.title, 'title', { required: true, max: 120 }),
      description: str(b.description, 'description', { required: true, max: 2000 }),
      positions: positions(b.positions),
      inputs: Engine.normalize(b.inputs && typeof b.inputs === 'object' ? b.inputs : {})
    };
  }
  route('GET', '/api/situations', ({ query }) => {
    let rows = db.prepare('SELECT * FROM situations ORDER BY id').all().map(sitRow);
    const pos = query.get('position'); const state = query.get('state'); const call = query.get('call');
    if (pos) rows = rows.filter(r => r.positions.includes(pos));
    if (state) rows = rows.filter(r => r.inputs.state === state);
    if (call) rows = rows.filter(r => r.answer === call);
    return rows;
  });
  route('GET', '/api/situations/:id', ({ params }) => {
    const s = sitRow(getOr404('SELECT * FROM situations WHERE id = ?', params.id, 'Situation'));
    return { ...s, output: Engine.run(s.inputs) };
  });
  route('POST', '/api/situations', ({ body }) => {
    const f = sitFields(body);
    const id = Number(db.prepare('INSERT INTO situations (title, description, source, positions, inputs) VALUES (?, ?, ?, ?, ?)')
      .run(f.title, f.description, 'Coach', JSON.stringify(f.positions), JSON.stringify(f.inputs)).lastInsertRowid);
    return withStatus(201, sitRow(db.prepare('SELECT * FROM situations WHERE id = ?').get(id)));
  });
  route('PUT', '/api/situations/:id', ({ params, body }) => {
    getOr404('SELECT id FROM situations WHERE id = ?', params.id, 'Situation');
    const f = sitFields(body);
    db.prepare('UPDATE situations SET title = ?, description = ?, positions = ?, inputs = ? WHERE id = ?')
      .run(f.title, f.description, JSON.stringify(f.positions), JSON.stringify(f.inputs), params.id);
    return sitRow(db.prepare('SELECT * FROM situations WHERE id = ?').get(params.id));
  });
  route('DELETE', '/api/situations/:id', ({ params }) => {
    getOr404('SELECT id FROM situations WHERE id = ?', params.id, 'Situation');
    db.prepare('DELETE FROM situations WHERE id = ?').run(params.id);
    return withStatus(204, null);
  });

  // Film attempts. The server grades, so a client can't record its own answer key.
  route('POST', '/api/attempts', ({ body }) => {
    const sid = int(body.situation_id, 'situation_id', { min: 1, required: true });
    const pid = int(body.player_id, 'player_id', { min: 1 });
    if (pid) getOr404('SELECT id FROM players WHERE id = ?', pid, 'Player');
    const s = sitRow(getOr404('SELECT * FROM situations WHERE id = ?', sid, 'Situation'));
    const guess = oneOf(body.guess, CALL_IDS, 'guess');
    const output = Engine.run(s.inputs);
    const correct = guess === output.call;
    const legal = output.legal.find(l => l.id === guess);
    if (pid) {
      db.prepare('INSERT INTO attempts (player_id, situation_id, guess, answer, correct) VALUES (?, ?, ?, ?, ?)')
        .run(pid, sid, guess, output.call, correct ? 1 : 0);
    }
    return withStatus(201, { correct, guess, answer: output.call, guessLegal: legal, output, saved: !!pid });
  }, { write: false });

  // Drills
  function drillFields(b) {
    return {
      name: str(b.name, 'name', { required: true, max: 120 }),
      call: oneOf(b.call, CALL_IDS, 'call', { allowEmpty: true }),
      positions: positions(b.positions),
      players: str(b.players, 'players', { max: 80 }),
      minutes: int(b.minutes, 'minutes', { min: 1, max: 120 }) || 10,
      setup: str(b.setup, 'setup', { max: 2000 }),
      steps: str(b.steps, 'steps', { max: 4000 }),
      points: str(b.points, 'points', { max: 2000 })
    };
  }
  route('GET', '/api/drills', ({ query }) => {
    let rows = db.prepare('SELECT * FROM drills ORDER BY name COLLATE NOCASE').all().map(drillRow);
    const pos = query.get('position'); const call = query.get('call');
    if (pos) rows = rows.filter(r => r.positions.includes(pos));
    if (call) rows = rows.filter(r => r.call === call);
    return rows;
  });
  route('GET', '/api/drills/:id', ({ params }) => drillRow(getOr404('SELECT * FROM drills WHERE id = ?', params.id, 'Drill')));
  route('POST', '/api/drills', ({ body }) => {
    const f = drillFields(body);
    const id = Number(db.prepare('INSERT INTO drills (name, call, positions, players, minutes, setup, steps, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(f.name, f.call, JSON.stringify(f.positions), f.players, f.minutes, f.setup, f.steps, f.points).lastInsertRowid);
    return withStatus(201, drillRow(db.prepare('SELECT * FROM drills WHERE id = ?').get(id)));
  });
  route('PUT', '/api/drills/:id', ({ params, body }) => {
    getOr404('SELECT id FROM drills WHERE id = ?', params.id, 'Drill');
    const f = drillFields(body);
    db.prepare('UPDATE drills SET name = ?, call = ?, positions = ?, players = ?, minutes = ?, setup = ?, steps = ?, points = ? WHERE id = ?')
      .run(f.name, f.call, JSON.stringify(f.positions), f.players, f.minutes, f.setup, f.steps, f.points, params.id);
    return drillRow(db.prepare('SELECT * FROM drills WHERE id = ?').get(params.id));
  });
  route('DELETE', '/api/drills/:id', ({ params }) => {
    getOr404('SELECT id FROM drills WHERE id = ?', params.id, 'Drill');
    db.prepare('DELETE FROM drills WHERE id = ?').run(params.id);
    return withStatus(204, null);
  });

  // Practice plans
  function planFull(id) {
    const plan = getOr404('SELECT * FROM plans WHERE id = ?', id, 'Plan');
    const items = db.prepare(`SELECT i.id, i.drill_id, i.minutes, i.position, d.name, d.call
        FROM plan_items i JOIN drills d ON d.id = i.drill_id WHERE i.plan_id = ? ORDER BY i.position`).all(id);
    return { ...plan, items, total: items.reduce((a, i) => a + i.minutes, 0) };
  }
  function planFields(b) {
    const items = Array.isArray(b.items) ? b.items : [];
    if (items.length > 40) throw new HttpError(400, 'A plan can have at most 40 drills.');
    return {
      title: str(b.title, 'title', { required: true, max: 120 }),
      date: date(b.date),
      notes: str(b.notes, 'notes', { max: 2000 }),
      items: items.map((it, i) => {
        const drill_id = int(it && it.drill_id, `items[${i}].drill_id`, { min: 1, required: true });
        getOr404('SELECT id FROM drills WHERE id = ?', drill_id, 'Drill');
        return { drill_id, minutes: int(it.minutes, `items[${i}].minutes`, { min: 1, max: 120, required: true }) };
      })
    };
  }
  function writeItems(planId, items) {
    db.prepare('DELETE FROM plan_items WHERE plan_id = ?').run(planId);
    const add = db.prepare('INSERT INTO plan_items (plan_id, drill_id, minutes, position) VALUES (?, ?, ?, ?)');
    items.forEach((it, i) => add.run(planId, it.drill_id, it.minutes, i));
  }
  route('GET', '/api/plans', () => db.prepare(`SELECT p.*, COALESCE(SUM(i.minutes), 0) AS total, COUNT(i.id) AS drills
      FROM plans p LEFT JOIN plan_items i ON i.plan_id = p.id GROUP BY p.id ORDER BY p.date IS NULL, p.date DESC, p.id DESC`).all());
  route('GET', '/api/plans/:id', ({ params }) => planFull(params.id));
  route('POST', '/api/plans', ({ body }) => {
    const f = planFields(body);
    const id = tx(db, () => {
      const id = Number(db.prepare('INSERT INTO plans (title, date, notes) VALUES (?, ?, ?)').run(f.title, f.date, f.notes).lastInsertRowid);
      writeItems(id, f.items);
      return id;
    });
    return withStatus(201, planFull(id));
  });
  route('PUT', '/api/plans/:id', ({ params, body }) => {
    getOr404('SELECT id FROM plans WHERE id = ?', params.id, 'Plan');
    const f = planFields(body);
    tx(db, () => {
      db.prepare('UPDATE plans SET title = ?, date = ?, notes = ? WHERE id = ?').run(f.title, f.date, f.notes, params.id);
      writeItems(params.id, f.items);
    });
    return planFull(params.id);
  });
  route('DELETE', '/api/plans/:id', ({ params }) => {
    getOr404('SELECT id FROM plans WHERE id = ?', params.id, 'Plan');
    db.prepare('DELETE FROM plans WHERE id = ?').run(params.id);
    return withStatus(204, null);
  });

  /* ---------- plumbing ---------- */
  function send(res, status, data, headers = {}) {
    const base = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', ...headers };
    if (data === null || status === 204) { res.writeHead(status, base); return res.end(); }
    const body = JSON.stringify(data);
    res.writeHead(status, { ...base, 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
    res.end(body);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', c => {
        size += c.length;
        if (size <= MAX_BODY) chunks.push(c);
        else if (size > MAX_BODY * 16) req.destroy();
      });
      req.on('end', () => {
        if (size > MAX_BODY) return reject(new HttpError(413, 'Request body is too large.'));
        if (!chunks.length) return resolve({});
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!v || typeof v !== 'object' || Array.isArray(v)) return reject(new HttpError(400, 'Body must be a JSON object.'));
          resolve(v);
        } catch { reject(new HttpError(400, 'Body is not valid JSON.')); }
      });
      req.on('error', reject);
    });
  }

  function authorized(req) {
    if (!coachKey) return true;
    const h = req.headers.authorization || '';
    const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
    const want = Buffer.from(coachKey);
    return given.length === want.length && crypto.timingSafeEqual(given, want);
  }

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.normalize(path.join(WEB_ROOT, rel));
    if (!file.startsWith(WEB_ROOT + path.sep)) return send(res, 404, { error: 'Not found.' });
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, { error: 'Not found.' });
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'
      });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  }

  async function handle(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, { error: 'Bad URL.' }); }
    const { pathname } = url;
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' });
      return serveStatic(req, res, pathname);
    }
    try {
      let matchedPath = false;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        matchedPath = true;
        if (r.method !== req.method) continue;
        if (r.write && !authorized(req)) throw new HttpError(401, 'Coach key required to make changes.');
        const params = {};
        r.keys.forEach((k, i) => { params[k] = Number(m[i + 1]); });
        const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};
        const out = r.handler({ params, body, query: url.searchParams, req });
        return out && out[STATUS] ? send(res, out[STATUS], out.body) : send(res, 200, out);
      }
      throw new HttpError(matchedPath ? 405 : 404, matchedPath ? 'Method not allowed.' : 'Not found.');
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      return send(res, 500, { error: 'Something went wrong on the server.' });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  return { server, db };
}

module.exports = { createApp };

if (require.main === module) {
  const port = Number(process.env.PORT) || 8787;
  const file = process.env.LAB_DB || path.join(__dirname, '..', 'data', 'lab.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { server } = createApp({ file, coachKey: process.env.COACH_KEY || '', demo: process.env.LAB_DEMO !== '0' });
  server.listen(port, () => console.log(`LAB Sideline running at http://localhost:${port}`));
}
