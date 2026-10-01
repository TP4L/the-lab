'use strict';
const { HttpError, withStatus, str, int, oneOf } = require('../http.js');
const { now, tx } = require('../db.js');

module.exports = function checkins(r, { db, auth, notifier }) {
  const view = id => db.prepare(`SELECT c.*, a.name AS athlete_name, a.user_id AS athlete_user_id,
    u.name AS coach_name, x.title AS assignment_title
    FROM pre_session_checkins c JOIN athletes a ON a.id = c.athlete_id
    LEFT JOIN users u ON u.id = c.reviewed_by LEFT JOIN assignments x ON x.id = c.assignment_id
    WHERE c.id = ?`).get(id);
  function row(user, raw) {
    auth.require(user);
    const id = int(raw, 'id', { min: 1, required: true });
    const c = view(id);
    if (!c || !auth.athleteAccess(user, c.athlete_id)) throw new HttpError(404, 'Check-in not found.');
    return c;
  }

  r.get('/api/me/pre-session-checkins', ({ user }) => {
    auth.require(user);
    const aid = auth.ownAthleteId(user);
    return aid ? db.prepare(`SELECT c.*, a.name AS athlete_name, x.title AS assignment_title FROM pre_session_checkins c
      JOIN athletes a ON a.id = c.athlete_id LEFT JOIN assignments x ON x.id = c.assignment_id
      WHERE c.athlete_id = ? ORDER BY c.created_at DESC LIMIT 25`).all(aid) : [];
  });
  r.post('/api/me/pre-session-checkins', ({ user, body }) => {
    auth.require(user);
    const aid = auth.ownAthleteId(user);
    if (!aid) throw new HttpError(409, 'Connect your athlete profile before sending a check-in.');
    const media = body.media_id ? db.prepare('SELECT id, athlete_id FROM media WHERE id = ?').get(str(body.media_id, 'media_id', { max: 80 })) : null;
    if (body.media_id && (!media || media.athlete_id !== aid)) throw new HttpError(400, 'That upload is not connected to your profile.');
    const fields = [
      str(body.working, 'working', { required: true, max: 1500 }),
      str(body.not_working, 'not_working', { required: true, max: 1500 }),
      str(body.focus, 'focus', { required: true, max: 1500 })
    ];
    const id = Number(db.prepare('INSERT INTO pre_session_checkins (athlete_id, working, not_working, focus, media_id) VALUES (?, ?, ?, ?, ?)')
      .run(aid, fields[0], fields[1], fields[2], media ? media.id : null).lastInsertRowid);
    const athlete = db.prepare('SELECT name FROM athletes WHERE id = ?').get(aid);
    const coaches = db.prepare('SELECT coach_id FROM coach_athletes WHERE athlete_id = ?').all(aid).map(x => x.coach_id);
    notifier.notify(coaches, 'feedback', `${athlete.name} sent a pre-session check-in`, fields[2], `#/coach/checkins/${id}`);
    return withStatus(201, view(id));
  });

  r.get('/api/coach/pre-session-checkins', ({ user, query }) => {
    auth.require(user, 'coach');
    const status = query.get('status');
    const where = user.roles.includes('admin') ? '1=1' : 'EXISTS (SELECT 1 FROM coach_athletes ca WHERE ca.athlete_id = c.athlete_id AND ca.coach_id = ?)';
    const args = user.roles.includes('admin') ? [] : [user.id];
    if (status) { oneOf(status, ['submitted','planned','complete'], 'status'); args.push(status); }
    return db.prepare(`SELECT c.*, a.name AS athlete_name, x.title AS assignment_title FROM pre_session_checkins c
      JOIN athletes a ON a.id = c.athlete_id LEFT JOIN assignments x ON x.id = c.assignment_id
      WHERE ${where}${status ? ' AND c.status = ?' : ''} ORDER BY CASE c.status WHEN 'submitted' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, c.created_at DESC LIMIT 100`).all(...args);
  });
  r.get('/api/coach/pre-session-checkins/:id', ({ user, params }) => {
    const c = row(user, params.id);
    if (auth.athleteAccess(user, c.athlete_id) !== 'coach') throw new HttpError(404, 'Check-in not found.');
    return c;
  });
  r.put('/api/coach/pre-session-checkins/:id', ({ user, params, body }) => {
    const c = row(user, params.id);
    if (auth.athleteAccess(user, c.athlete_id) !== 'coach') throw new HttpError(404, 'Check-in not found.');
    const status = body.status === undefined ? c.status : oneOf(body.status, ['submitted','planned','complete'], 'status');
    const vals = ['hypothesis','start_state','error_layer','first_test','constraint_text','proof','coach_note'].map(k => body[k] === undefined ? c[k] : str(body[k], k, { max: 2000 }));
    db.prepare(`UPDATE pre_session_checkins SET status=?, hypothesis=?, start_state=?, error_layer=?, first_test=?, constraint_text=?, proof=?, coach_note=?, reviewed_by=?, updated_at=? WHERE id=?`)
      .run(status, ...vals, user.id, now(), c.id);
    return view(c.id);
  });
  r.post('/api/coach/pre-session-checkins/:id/plan', ({ user, params, body }) => {
    const c = row(user, params.id);
    if (auth.athleteAccess(user, c.athlete_id) !== 'coach') throw new HttpError(404, 'Check-in not found.');
    if (c.assignment_id) return view(c.id);
    const title = str(body.title || `Session focus · ${c.focus}`, 'title', { required: true, max: 120 });
    const note = [c.coach_note, c.hypothesis && `Hypothesis: ${c.hypothesis}`, c.first_test && `First test: ${c.first_test}`, c.constraint_text && `Constraint: ${c.constraint_text}`, c.proof && `Proof: ${c.proof}`].filter(Boolean).join('\n');
    const assignmentId = tx(db, () => {
      const id = Number(db.prepare('INSERT INTO assignments (athlete_id, title, note, assigned_by) VALUES (?, ?, ?, ?)').run(c.athlete_id, title, note, user.id).lastInsertRowid);
      db.prepare("UPDATE pre_session_checkins SET status='planned', assignment_id=?, reviewed_by=?, updated_at=? WHERE id=?").run(id, user.id, now(), c.id);
      return id;
    });
    notifier.notify(notifier.usersOfAthletes([c.athlete_id]), 'training', `Your session plan is ready: ${title}`, 'Open THE LAB to see what you and your coach will focus on.', '#/train');
    return withStatus(201, { ...view(c.id), assignment_id: assignmentId });
  });
};
