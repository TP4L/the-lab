'use strict';
const { HttpError, withStatus, str, oneOf, int, list } = require('../http.js');
const { now } = require('../db.js');

const MEASURES = ['reps', 'time', 'score', 'feel'];

/* Reusable session templates (a shared library for coaches) and training
   assigned to an athlete, which the athlete sees and the coach can run. */
module.exports = function coaching(r, { db, auth, notifier }) {
  function items(v) {
    const out = list(v, 'items', { max: 10, item: (x, f) => {
      if (!x || typeof x !== 'object') throw new HttpError(400, `${f} must be an object.`);
      return { name: str(x.name, `${f}.name`, { required: true, max: 120 }), measure: oneOf(x.measure || 'reps', MEASURES, `${f}.measure`),
        target: str(x.target, `${f}.target`, { max: 120 }), instructions: str(x.instructions, `${f}.instructions`, { max: 2000 }) };
    } });
    if (!out.length) throw new HttpError(400, 'Add at least one drill.');
    return out;
  }
  const shape = t => t && ({ ...t, items: JSON.parse(t.items) });
  function template(user, id) {
    auth.require(user, 'coach');
    const t = db.prepare('SELECT * FROM training_templates WHERE id = ?').get(int(id, 'id', { min: 1, required: true }));
    if (!t) throw new HttpError(404, 'Template not found.');
    return t;
  }
  r.get('/api/templates', ({ user }) => {
    auth.require(user, 'coach');
    return db.prepare('SELECT t.*, u.name AS author FROM training_templates t LEFT JOIN users u ON u.id = t.created_by ORDER BY t.name COLLATE NOCASE').all().map(shape);
  });
  r.post('/api/templates', ({ user, body }) => {
    auth.require(user, 'coach');
    const id = Number(db.prepare('INSERT INTO training_templates (name, items, created_by) VALUES (?, ?, ?)').run(str(body.name, 'name', { required: true, max: 120 }), JSON.stringify(items(body.items)), user.id).lastInsertRowid);
    return withStatus(201, shape(db.prepare('SELECT * FROM training_templates WHERE id = ?').get(id)));
  });
  r.get('/api/templates/:id', ({ user, params }) => shape(template(user, params.id)));
  r.put('/api/templates/:id', ({ user, params, body }) => {
    const t = template(user, params.id);
    db.prepare('UPDATE training_templates SET name = ?, items = ?, updated_at = ? WHERE id = ?').run(str(body.name, 'name', { required: true, max: 120 }), JSON.stringify(items(body.items)), now(), t.id);
    return shape(db.prepare('SELECT * FROM training_templates WHERE id = ?').get(t.id));
  });
  r.del('/api/templates/:id', ({ user, params }) => {
    const t = template(user, params.id);
    if (t.created_by !== user.id && !user.roles.includes('admin')) throw new HttpError(403, 'Only the coach who made this template can delete it.');
    db.prepare('DELETE FROM training_templates WHERE id = ?').run(t.id);
    return withStatus(204, null);
  });

  function assignmentRows(athleteId) {
    return db.prepare(`SELECT a.*, t.items AS template_items, u.name AS coach FROM assignments a LEFT JOIN training_templates t ON t.id = a.template_id
      LEFT JOIN users u ON u.id = a.assigned_by WHERE a.athlete_id = ? ORDER BY a.status, COALESCE(a.due_on, '9999'), a.id DESC LIMIT 100`).all(athleteId)
      .map(x => ({ ...x, template_items: x.template_items ? JSON.parse(x.template_items) : null }));
  }
  r.get('/api/athletes/:id/assignments', ({ user, params }) => {
    auth.require(user);
    const id = int(params.id, 'id', { min: 1, required: true });
    if (!auth.athleteAccess(user, id)) throw new HttpError(404, 'Athlete not found.');
    return assignmentRows(id);
  });
  r.get('/api/me/assignments', ({ user }) => {
    auth.require(user);
    const id = auth.ownAthleteId(user);
    return id ? assignmentRows(id) : [];
  });
  r.post('/api/athletes/:id/assignments', ({ user, params, body }) => {
    auth.require(user, 'coach');
    const aid = int(params.id, 'id', { min: 1, required: true });
    if (!auth.coachesAthlete(user, aid)) throw new HttpError(404, 'Athlete not found.');
    let tpl = null;
    if (body.template_id) { tpl = db.prepare('SELECT * FROM training_templates WHERE id = ?').get(int(body.template_id, 'template_id', { min: 1 })); if (!tpl) throw new HttpError(400, 'Template not found.'); }
    const title = body.title ? str(body.title, 'title', { max: 120 }) : (tpl ? tpl.name : '');
    if (!title) throw new HttpError(400, 'Give the assignment a title or pick a template.');
    const due = body.due_on ? str(body.due_on, 'due_on', { max: 10 }) : null;
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new HttpError(400, 'due_on must be YYYY-MM-DD.');
    const id = Number(db.prepare('INSERT INTO assignments (athlete_id, template_id, title, note, due_on, assigned_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(aid, tpl ? tpl.id : null, title, str(body.note, 'note', { max: 2000 }), due, user.id).lastInsertRowid);
    notifier.notify(notifier.usersOfAthletes([aid]), 'training', `New training from ${user.name}: ${title}`, due ? `Due ${due}.` : '', '#/train');
    return withStatus(201, assignmentRows(aid).find(x => x.id === id));
  });
  function assignment(user, id) {
    auth.require(user);
    const a = db.prepare('SELECT * FROM assignments WHERE id = ?').get(int(id, 'id', { min: 1, required: true }));
    const level = a && auth.athleteAccess(user, a.athlete_id);
    if (!level) throw new HttpError(404, 'Assignment not found.');
    return { a, level };
  }
  r.put('/api/assignments/:id', ({ user, params, body }) => {
    const { a } = assignment(user, params.id);
    const status = oneOf(body.status, ['open', 'done'], 'status');
    db.prepare('UPDATE assignments SET status = ?, completed_at = ? WHERE id = ?').run(status, status === 'done' ? (a.completed_at || now()) : null, a.id);
    return db.prepare('SELECT * FROM assignments WHERE id = ?').get(a.id);
  });
  r.del('/api/assignments/:id', ({ user, params }) => {
    const { a, level } = assignment(user, params.id);
    if (level !== 'coach') throw new HttpError(403, 'Only the coach can remove an assignment.');
    db.prepare('DELETE FROM assignments WHERE id = ?').run(a.id);
    return withStatus(204, null);
  });
};
