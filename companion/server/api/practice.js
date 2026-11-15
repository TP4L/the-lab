'use strict';
const { randomUUID } = require('node:crypto');
const { HttpError, int, isoTime, list, str, uuid } = require('../http.js');
const { now, tx } = require('../db.js');

module.exports = function practice(r, { db, auth }) {
  const fullAccess = user => !!db.prepare("SELECT 1 FROM memberships WHERE user_id=? AND status='active' AND (expires_at IS NULL OR expires_at>?)").get(user.id, now());
  const requireFull = user => {
    if (!fullAccess(user)) throw new HttpError(403, 'This practice tool is included with LAB Essentials.');
  };
  const owned = (user, value) => {
    auth.require(user);
    const row = db.prepare('SELECT * FROM personal_practices WHERE id=? AND user_id=?').get(uuid(value, 'practice'), user.id);
    if (!row) throw new HttpError(404, 'Practice not found.');
    return row;
  };
  const unpack = row => ({ ...row, drills: JSON.parse(row.drills), results: JSON.parse(row.results) });
  const drillsOf = drills => list(drills, 'drills', { max: 20, item: (d, field) => ({
    name: str(d?.name, field + '.name', { required: true, max: 120 }),
    attribute: str(d?.attribute, field + '.attribute', { max: 120 }),
    minutes: int(d?.minutes, field + '.minutes', { required: true, min: 1, max: 180 }),
    target: str(d?.target, field + '.target', { max: 250 })
  }) });
  r.get('/api/me/practices', ({ user }) => {
    auth.require(user);
    return { full: fullAccess(user), practices: db.prepare('SELECT * FROM personal_practices WHERE user_id=? ORDER BY COALESCE(scheduled_at, completed_at, updated_at) DESC').all(user.id).map(unpack) };
  });
  r.post('/api/me/practices', ({ user, body }) => {
    auth.require(user);
    const id = uuid(body.id, 'practice');
    const prior = db.prepare('SELECT * FROM personal_practices WHERE id=? AND user_id=?').get(id, user.id);
    if (prior) return unpack(prior);
    const routine = body.kind === 'routine';
    const repeats = list(body.repeat, 'repeat', { max: 11, item: (date, field) => isoTime(date, field) });
    if (routine || repeats.length) requireFull(user);
    const drills = drillsOf(body.drills);
    const title = str(body.title, 'title', { required: true, max: 120 });
    const scheduled = routine ? null : isoTime(body.scheduled_at, 'start');
    if (!routine && !scheduled) throw new HttpError(400, 'Choose a date and time.');
    if (routine && !drills.length) throw new HttpError(400, 'Add a drill to save a routine.');
    if (repeats.some((date, index) => !date || date <= (repeats[index - 1] || scheduled))) throw new HttpError(400, 'Choose future dates in order.');
    const insert = db.prepare('INSERT INTO personal_practices(id,user_id,kind,title,scheduled_at,drills,updated_at) VALUES (?,?,?,?,?,?,?)');
    tx(db, () => {
      insert.run(id, user.id, routine ? 'routine' : 'practice', title, scheduled, JSON.stringify(drills), now());
      repeats.forEach(date => insert.run(randomUUID(), user.id, 'practice', title, date, JSON.stringify(drills), now()));
    });
    return unpack(owned(user, id));
  });
  r.put('/api/me/practices/:id', ({ user, params, body }) => {
    const row = owned(user, params.id);
    if (row.completed_at) throw new HttpError(409, 'This practice is complete.');
    if (body.version !== row.version) throw new HttpError(409, 'This practice changed. Reopen it and try again.');
    if (row.kind === 'routine') requireFull(user);
    const drills = drillsOf(body.drills);
    const title = str(body.title, 'title', { required: true, max: 120 });
    const scheduled = row.kind === 'routine' ? null : isoTime(body.scheduled_at, 'start');
    if (row.kind === 'practice' && !scheduled) throw new HttpError(400, 'Choose a date and time.');
    if (row.kind === 'routine' && !drills.length) throw new HttpError(400, 'Add a drill to save a routine.');
    db.prepare('UPDATE personal_practices SET title=?,scheduled_at=?,drills=?,updated_at=?,version=version+1 WHERE id=?')
      .run(title, scheduled, JSON.stringify(drills), now(), row.id);
    return unpack(owned(user, row.id));
  });
  r.del('/api/me/practices/:id', ({ user, params }) => {
    const row = owned(user, params.id);
    if (row.completed_at) throw new HttpError(409, 'Completed practices are part of your history.');
    db.prepare('DELETE FROM personal_practices WHERE id=?').run(row.id);
    return { removed: true };
  });
  r.post('/api/me/practices/:id/finish', ({ user, params, body }) => {
    const row = owned(user, params.id);
    if (row.completed_at) return unpack(row);
    if (row.kind !== 'practice') throw new HttpError(400, 'Schedule this routine first.');
    if (body.version !== row.version) throw new HttpError(409, 'This practice changed. Reopen it before saving results.');
    const drills = JSON.parse(row.drills);
    const results = list(body.results, 'results', { max: 20, item: (x, field) => ({
      makes: int(x?.makes, field + '.makes', { required: true, min: 0, max: 100000 }),
      misses: int(x?.misses, field + '.misses', { required: true, min: 0, max: 100000 })
    }) });
    if (!drills.length || results.length !== drills.length) throw new HttpError(400, 'Results must match the practice drills.');
    db.prepare('UPDATE personal_practices SET results=?,completed_at=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(results), now(), now(), row.id);
    return unpack(owned(user, row.id));
  });
  r.post('/api/me/practices/:id/share', ({ user, params }) => {
    const row = unpack(owned(user, params.id));
    const athleteId = auth.ownAthleteId(user);
    if (!athleteId || !row.completed_at) throw new HttpError(400, 'Finish the practice and connect your athlete profile before sharing.');
    const lines = row.drills.map((d, i) => {
      const result = row.results[i];
      const attempts = result.makes + result.misses;
      return d.name + ' · ' + (attempts ? result.makes + '/' + attempts : 'No reps scored');
    });
    db.prepare("INSERT INTO notes (client_id,athlete_id,author_id,kind,visibility,body) VALUES (?,?,?,'reflection','shared',?) ON CONFLICT(author_id,client_id) DO NOTHING")
      .run(row.id, athleteId, user.id, ('Practice: ' + row.title + '\n' + lines.join('\n')).slice(0, 5000));
    return { shared: true };
  });
};