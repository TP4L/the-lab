'use strict';
/* Fast session capture. A coach records the format, date and players of a
   session in seconds, tags the session focus, and notes attributes per player.
   Everything here is private coaching record: nothing is delivered to athletes
   and observations never become profile traits. */
const { HttpError, str, int, oneOf, list } = require('../http');
const { now, tx } = require('../db');
const crypto = require('node:crypto');
const lab = require('../lab');

const FORMATS = { private_lesson: 'Private lesson', clinic: 'Clinic', group_class: 'Group class', group_lesson: 'Group lesson', drill_with_pro: 'Drill with a pro' };
const SETTINGS = { private_lesson: 'lesson', clinic: 'drill', group_class: 'conditioned_play', group_lesson: 'lesson', drill_with_pro: 'drill' };
const SPORTS = ['pickleball', 'padel', 'tennis', 'squash', 'speed', 'other'];
const SUGGESTED = {
  focus: ['Third-shot drops', 'Dinking', 'Resets', 'Speed-ups and counters', 'Transition zone', 'Serve and return', 'Court positioning', 'Height reads', 'Time reads', 'Balance reads', 'Respect the X', 'The Triangle', 'Doubles communication', 'Live points'],
  player: ['Late contact', 'Early contact', 'Balanced recovery', 'Off balance', 'Lifting from the wrist', 'Paddle face steady', 'Good patience', 'Rushed decisions', 'Read the height well', 'Late to the line', 'Split-step present', 'Split-step missing', 'Strong reset', 'Pop-ups under pressure', 'Clear communication', 'Confidence up', 'Fatigue late']
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function day(v) { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) throw new HttpError(400, 'Date must be a valid date.'); return v; }
const cleanTag = t => String(t || '').trim().replace(/\s+/g, ' ').slice(0, 40);
function tags(v, field) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, field + ' must be a list.');
  const out = []; for (const t of v) { const c = cleanTag(t); if (c && !out.some(x => x.toLowerCase() === c.toLowerCase())) out.push(c); }
  if (out.length > 20) throw new HttpError(400, field + ': 20 tags at most.');
  return out;
}

module.exports = function (r, ctx) {
  const { db, auth } = ctx;

  function own(user, id) {
    auth.require(user, 'coach');
    const row = db.prepare('SELECT * FROM captures WHERE id=?').get(String(id));
    if (!row || (row.coach_id !== user.id && !auth.has(user, 'admin'))) throw new HttpError(404, 'Capture not found.');
    return row;
  }
  function players(id) {
    return db.prepare('SELECT p.*, a.name AS athlete_name FROM capture_players p LEFT JOIN athletes a ON a.id=p.athlete_id WHERE p.capture_id=? ORDER BY p.sort, p.id').all(id)
      .map(p => ({ id: p.id, athlete_id: p.athlete_id, name: p.athlete_name || p.guest_name, guest_name: p.guest_name, linked: !!p.athlete_id, attributes: lab.parse(p.attributes, []), observation: p.observation }));
  }
  function shape(row) {
    return { id: row.id, format: row.format, format_label: FORMATS[row.format], occurred_on: row.occurred_on, name: row.name, sport: row.sport, duration_min: row.duration_min, focus_tags: lab.parse(row.focus_tags, []), notes: row.notes, status: row.status, version: row.version, created_at: row.created_at, updated_at: row.updated_at, players: players(row.id), default_setting: SETTINGS[row.format] };
  }
  function bumpTags(userId, focus, playerTags) {
    const up = db.prepare('INSERT INTO capture_tags(coach_id,tag,scope,uses,last_used) VALUES(?,?,?,1,?) ON CONFLICT(coach_id,tag,scope) DO UPDATE SET uses=uses+1,last_used=excluded.last_used');
    for (const t of focus) up.run(userId, t, 'focus', now());
    for (const t of playerTags) up.run(userId, t, 'player', now());
  }
  function playerRows(user, body) {
    return list(body.players || [], 'players', { max: 40, item: (p, f) => {
      if (!p || typeof p !== 'object') throw new HttpError(400, f + ' must be an object.');
      const athleteId = p.athlete_id ? int(p.athlete_id, f + '.athlete_id', { min: 1 }) : null;
      if (athleteId && !auth.coachesAthlete(user, athleteId)) throw new HttpError(404, 'Athlete not found.');
      const guest = athleteId ? '' : str(p.name || p.guest_name, f + '.name', { max: 80 });
      if (!athleteId && !guest) throw new HttpError(400, 'Each player needs an athlete or a name.');
      return { id: p.id ? int(p.id, f + '.id', { min: 1 }) : null, athlete_id: athleteId, guest_name: guest, attributes: tags(p.attributes, f + '.attributes'), observation: str(p.observation, f + '.observation', { max: 2000 }) };
    } });
  }
  function fields(body, partial) {
    const f = {}; const want = k => !partial || body[k] !== undefined;
    if (want('format')) f.format = oneOf(body.format || 'private_lesson', Object.keys(FORMATS), 'format');
    if (want('occurred_on')) { f.occurred_on = body.occurred_on ? day(body.occurred_on) : today(); if (f.occurred_on > today()) throw new HttpError(400, 'Session date cannot be in the future.'); }
    if (body.name !== undefined) f.name = str(body.name, 'name', { max: 120 });
    if (body.sport !== undefined) f.sport = oneOf(body.sport || 'pickleball', SPORTS, 'sport');
    if (body.duration_min !== undefined) f.duration_min = body.duration_min === null || body.duration_min === '' ? null : int(body.duration_min, 'duration', { min: 5, max: 600 });
    if (body.focus_tags !== undefined) f.focus_tags = JSON.stringify(tags(body.focus_tags, 'focus_tags'));
    if (body.notes !== undefined) f.notes = str(body.notes, 'notes', { max: 5000 });
    if (body.status !== undefined) f.status = oneOf(body.status, ['saved', 'complete'], 'status');
    return f;
  }

  r.get('/api/captures/meta', ({ user }) => {
    auth.require(user, 'coach');
    const recent = scope => db.prepare('SELECT tag FROM capture_tags WHERE coach_id=? AND scope=? ORDER BY last_used DESC LIMIT 12').all(user.id, scope).map(x => x.tag);
    const frequent = scope => db.prepare('SELECT tag FROM capture_tags WHERE coach_id=? AND scope=? ORDER BY uses DESC, last_used DESC LIMIT 12').all(user.id, scope).map(x => x.tag);
    const attrs = db.prepare('SELECT name FROM skill_attributes WHERE archived_at IS NULL ORDER BY sort,id').all().map(x => x.name);
    const roster = db.prepare('SELECT id, name FROM athletes ORDER BY name').all().filter(a => auth.coachesAthlete(user, a.id));
    return { formats: FORMATS, settings: SETTINGS, sports: SPORTS, suggested: { focus: [...new Set([...SUGGESTED.focus, ...attrs])], player: SUGGESTED.player }, recent: { focus: recent('focus'), player: recent('player') }, frequent: { focus: frequent('focus'), player: frequent('player') }, roster, today: today() };
  });

  r.get('/api/captures', ({ user, query }) => {
    auth.require(user, 'coach');
    const where = ['c.coach_id=?'], args = [user.id];
    if (query.get('format')) { where.push('c.format=?'); args.push(oneOf(query.get('format'), Object.keys(FORMATS), 'format')); }
    if (query.get('athlete')) { where.push('EXISTS(SELECT 1 FROM capture_players p WHERE p.capture_id=c.id AND p.athlete_id=?)'); args.push(int(query.get('athlete'), 'athlete', { min: 1 })); }
    if (query.get('from')) { where.push('c.occurred_on>=?'); args.push(day(query.get('from'))); }
    if (query.get('to')) { where.push('c.occurred_on<=?'); args.push(day(query.get('to'))); }
    const q = (query.get('q') || '').trim().toLowerCase();
    if (q) { where.push("(lower(c.name) LIKE ? OR lower(c.focus_tags) LIKE ? OR lower(c.notes) LIKE ? OR EXISTS(SELECT 1 FROM capture_players p LEFT JOIN athletes a ON a.id=p.athlete_id WHERE p.capture_id=c.id AND (lower(a.name) LIKE ? OR lower(p.guest_name) LIKE ? OR lower(p.attributes) LIKE ? OR lower(p.observation) LIKE ?)))"); const like = '%' + q + '%'; args.push(like, like, like, like, like, like, like); }
    const limit = Math.min(200, Math.max(10, Number(query.get('limit')) || 60));
    const rows = db.prepare('SELECT c.* FROM captures c WHERE ' + where.join(' AND ') + ' ORDER BY c.occurred_on DESC, c.created_at DESC LIMIT ?').all(...args, limit);
    return { captures: rows.map(c => { const ps = players(c.id); return { id: c.id, format: c.format, format_label: FORMATS[c.format], occurred_on: c.occurred_on, name: c.name, sport: c.sport, duration_min: c.duration_min, focus_tags: lab.parse(c.focus_tags, []), status: c.status, has_notes: !!c.notes, players: ps.map(p => ({ name: p.name, linked: p.linked, athlete_id: p.athlete_id, tagged: p.attributes.length > 0 })), unlinked: ps.filter(p => !p.linked).length, updated_at: c.updated_at }; }), formats: FORMATS };
  });

  // Athlete-scoped history for the coaching record.
  r.get('/api/athletes/:id/captures', ({ user, params }) => {
    auth.require(user, 'coach');
    const aid = int(params.id, 'athlete', { min: 1, required: true });
    if (!auth.coachesAthlete(user, aid)) throw new HttpError(404, 'Athlete not found.');
    const rows = db.prepare('SELECT c.*, p.attributes, p.observation FROM captures c JOIN capture_players p ON p.capture_id=c.id WHERE p.athlete_id=? ORDER BY c.occurred_on DESC, c.created_at DESC LIMIT 100').all(aid);
    return { captures: rows.map(c => ({ id: c.id, format: c.format, format_label: FORMATS[c.format], occurred_on: c.occurred_on, name: c.name, focus_tags: lab.parse(c.focus_tags, []), attributes: lab.parse(c.attributes, []), observation: c.observation, coach_id: c.coach_id })) };
  });

  r.get('/api/captures/:id', ({ user, params }) => shape(own(user, params.id)));

  r.post('/api/captures', ({ user, body }) => {
    auth.require(user, 'coach');
    const key = body.client_key ? str(body.client_key, 'client_key', { max: 80 }) : null;
    if (key) { const prior = db.prepare('SELECT * FROM captures WHERE client_key=?').get(key); if (prior) return shape(prior); }
    const f = fields(body, false), ps = playerRows(user, body);
    const id = crypto.randomUUID();
    tx(db, () => {
      db.prepare('INSERT INTO captures(id,coach_id,format,occurred_on,name,sport,duration_min,focus_tags,notes,status,version,client_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?)')
        .run(id, user.id, f.format, f.occurred_on, f.name || '', f.sport || 'pickleball', f.duration_min || null, f.focus_tags || '[]', f.notes || '', f.status || 'saved', key, now(), now());
      ps.forEach((p, i) => db.prepare('INSERT INTO capture_players(capture_id,athlete_id,guest_name,attributes,observation,sort) VALUES(?,?,?,?,?,?)').run(id, p.athlete_id, p.guest_name, JSON.stringify(p.attributes), p.observation, i));
      bumpTags(user.id, lab.parse(f.focus_tags, []), ps.flatMap(p => p.attributes));
    });
    return shape(db.prepare('SELECT * FROM captures WHERE id=?').get(id));
  });

  // Full update. `version` guards against stale overwrites: the client sends the version it loaded.
  r.put('/api/captures/:id', ({ user, params, body }) => {
    const row = own(user, params.id);
    if (body.version !== undefined && Number(body.version) !== row.version) throw new HttpError(409, 'This capture changed since you opened it. Reload to see the latest, then make your edit again.');
    const f = fields(body, true);
    const ps = body.players !== undefined ? playerRows(user, body) : null;
    tx(db, () => {
      const keys = Object.keys(f);
      db.prepare('UPDATE captures SET ' + keys.map(k => k + '=?').join(',') + (keys.length ? ',' : '') + ' version=version+1, updated_at=? WHERE id=?').run(...keys.map(k => f[k]), now(), row.id);
      if (ps) {
        const keep = new Set();
        ps.forEach((p, i) => {
          if (p.id && db.prepare('SELECT 1 FROM capture_players WHERE id=? AND capture_id=?').get(p.id, row.id)) { db.prepare('UPDATE capture_players SET athlete_id=?,guest_name=?,attributes=?,observation=?,sort=? WHERE id=?').run(p.athlete_id, p.guest_name, JSON.stringify(p.attributes), p.observation, i, p.id); keep.add(p.id); }
          else keep.add(Number(db.prepare('INSERT INTO capture_players(capture_id,athlete_id,guest_name,attributes,observation,sort) VALUES(?,?,?,?,?,?)').run(row.id, p.athlete_id, p.guest_name, JSON.stringify(p.attributes), p.observation, i).lastInsertRowid));
        });
        const existing = db.prepare('SELECT id FROM capture_players WHERE capture_id=?').all(row.id).map(x => x.id);
        for (const id of existing) if (!keep.has(id)) db.prepare('DELETE FROM capture_players WHERE id=?').run(id);
        bumpTags(user.id, f.focus_tags ? lab.parse(f.focus_tags, []) : [], ps.flatMap(p => p.attributes));
      } else if (f.focus_tags) bumpTags(user.id, lab.parse(f.focus_tags, []), []);
    });
    return shape(db.prepare('SELECT * FROM captures WHERE id=?').get(row.id));
  });

  // Connect a name-only player to an athlete record. Explicit, never by name match.
  r.post('/api/captures/:id/players/:pid/link', ({ user, params, body }) => {
    const row = own(user, params.id);
    const p = db.prepare('SELECT * FROM capture_players WHERE id=? AND capture_id=?').get(int(params.pid, 'player', { min: 1, required: true }), row.id);
    if (!p) throw new HttpError(404, 'Player not found.');
    const aid = int(body.athlete_id, 'athlete_id', { min: 1, required: true });
    if (!auth.coachesAthlete(user, aid)) throw new HttpError(404, 'Athlete not found.');
    db.prepare('UPDATE capture_players SET athlete_id=? WHERE id=?').run(aid, p.id);
    db.prepare('UPDATE captures SET version=version+1, updated_at=? WHERE id=?').run(now(), row.id);
    return shape(db.prepare('SELECT * FROM captures WHERE id=?').get(row.id));
  });

  r.del('/api/captures/:id', ({ user, params }) => { const row = own(user, params.id); db.prepare('DELETE FROM captures WHERE id=?').run(row.id); return { ok: true }; });
};
module.exports.FORMATS = FORMATS;
module.exports.SETTINGS = SETTINGS;
