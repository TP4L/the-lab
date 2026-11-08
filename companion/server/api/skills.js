'use strict';
/* Skill progress: coaches rate athlete attributes 1-5 over time and set goals.
   Attributes are coach-defined (add, rename, retire); ratings are append-only
   history so the athlete can see how each skill has moved. */
const { HttpError, str, int, oneOf, list } = require('../http');
const { now, tx } = require('../db');

const SCALE = [
  { value: 1, label: 'Learning', meaning: 'Knows what the shot or habit is. Succeeds sometimes in practice, rarely in games.' },
  { value: 2, label: 'Developing', meaning: 'Works in cooperative drills. Breaks down when pace, pressure or movement is added.' },
  { value: 3, label: 'Consistent', meaning: 'Reliable in games at the current level. The default choice when the read calls for it.' },
  { value: 4, label: 'Strong', meaning: 'A dependable strength. Holds up under pressure and against better players.' },
  { value: 5, label: 'Weapon', meaning: 'Wins points on its own. Opponents plan around it.' }
];
const GOAL_STATUS = ['not_started', 'in_progress', 'completed'];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function day(v, label, optional = false) {
  if (optional && !v) return '';
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw new HttpError(400, label + ' must be a valid date.');
  return v;
}

module.exports = function (r, ctx) {
  const { db, auth, notifier } = ctx;

  function athlete(user, id) {
    auth.require(user); id = int(id, 'athlete', { min: 1, required: true });
    const level = auth.athleteAccess(user, id);
    if (!level) throw new HttpError(404, 'Athlete not found.');
    return { row: db.prepare('SELECT * FROM athletes WHERE id=?').get(id), level };
  }
  function coachOf(user, id) {
    const a = athlete(user, id);
    if (a.level !== 'coach') throw new HttpError(403, 'Only a coach can do that.');
    return a.row;
  }
  function attr(id) {
    const row = db.prepare('SELECT * FROM skill_attributes WHERE id=?').get(int(id, 'attribute', { min: 1, required: true }));
    if (!row) throw new HttpError(404, 'Attribute not found.');
    return row;
  }
  function attributeFields(body, partial = false) {
    const out = {};
    if (!partial || body.name !== undefined) out.name = str(body.name, 'name', { required: true, max: 80 });
    if (!partial || body.category !== undefined) out.category = str(body.category, 'category', { max: 60 });
    if (!partial || body.description !== undefined) out.description = str(body.description, 'description', { max: 400 });
    if (body.sort !== undefined) out.sort = int(body.sort, 'sort', { min: 0, max: 10000 });
    return out;
  }
  function coachName(id) { return id ? (db.prepare('SELECT name FROM users WHERE id=?').get(id) || {}).name || '' : ''; }

  /* ---------- attributes ---------- */
  r.get('/api/skill-attributes', ({ user, query }) => {
    auth.require(user);
    const all = query.get('all') === '1' && auth.has(user, 'coach');
    return { attributes: db.prepare('SELECT * FROM skill_attributes ' + (all ? '' : 'WHERE archived_at IS NULL ') + 'ORDER BY sort,id').all(), scale: SCALE };
  });
  r.post('/api/skill-attributes', ({ user, body }) => {
    auth.require(user, 'coach');
    const f = attributeFields(body);
    const dup = db.prepare('SELECT id FROM skill_attributes WHERE lower(name)=lower(?) AND archived_at IS NULL').get(f.name);
    if (dup) throw new HttpError(409, 'An attribute with that name already exists.');
    const sort = f.sort !== undefined ? f.sort : (db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS n FROM skill_attributes').get().n);
    const id = db.prepare('INSERT INTO skill_attributes(name,category,description,sort,created_by,created_at) VALUES(?,?,?,?,?,?)').run(f.name, f.category || '', f.description || '', sort, user.id, now()).lastInsertRowid;
    return db.prepare('SELECT * FROM skill_attributes WHERE id=?').get(id);
  });
  r.put('/api/skill-attributes/:id', ({ user, params, body }) => {
    auth.require(user, 'coach');
    const a = attr(params.id), f = attributeFields(body, true);
    if (body.archived !== undefined) f.archived_at = body.archived ? (a.archived_at || now()) : null;
    const keys = Object.keys(f);
    if (keys.length) db.prepare('UPDATE skill_attributes SET ' + keys.map(k => k + '=?').join(',') + ' WHERE id=?').run(...keys.map(k => f[k]), a.id);
    return db.prepare('SELECT * FROM skill_attributes WHERE id=?').get(a.id);
  });

  /* ---------- athlete view ---------- */
  function progress(a, viewerIsCoach) {
    const attributes = db.prepare('SELECT * FROM skill_attributes WHERE archived_at IS NULL ORDER BY sort,id').all();
    const ratings = db.prepare('SELECT r.*, u.name AS coach FROM skill_ratings r LEFT JOIN users u ON u.id=r.coach_id WHERE r.athlete_id=? ORDER BY r.rated_on DESC, r.id DESC').all(a.id);
    const byAttr = new Map();
    for (const x of ratings) { if (!byAttr.has(x.attribute_id)) byAttr.set(x.attribute_id, []); byAttr.get(x.attribute_id).push({ id: x.id, rating: x.rating, label: SCALE[x.rating - 1].label, comment: x.comment, rated_on: x.rated_on, coach: x.coach || '' }); }
    // Attributes that were rated but have since been archived still show, so history is never lost.
    const archivedRated = [...byAttr.keys()].filter(id => !attributes.some(x => x.id === id));
    const extra = archivedRated.length ? db.prepare('SELECT * FROM skill_attributes WHERE id IN (' + archivedRated.map(() => '?').join(',') + ')').all(...archivedRated) : [];
    const skills = [...attributes, ...extra].map(x => {
      const h = byAttr.get(x.id) || [];
      const latest = h[0] || null, previous = h[1] || null;
      return { id: x.id, name: x.name, category: x.category, description: x.description, archived: !!x.archived_at, latest, previous, delta: latest && previous ? latest.rating - previous.rating : null, history: h };
    });
    const assessed = skills.filter(s => s.latest);
    const goals = db.prepare("SELECT g.*, sa.name AS attribute_name FROM skill_goals g LEFT JOIN skill_attributes sa ON sa.id=g.attribute_id WHERE g.athlete_id=? ORDER BY CASE g.status WHEN 'in_progress' THEN 0 WHEN 'not_started' THEN 1 ELSE 2 END, COALESCE(g.target_on,'9999'), g.id").all(a.id)
      .map(g => ({ id: g.id, title: g.title, note: g.note, status: g.status, target_on: g.target_on || '', completed_at: g.completed_at || '', attribute_id: g.attribute_id, attribute_name: g.attribute_name || '', coach: coachName(g.coach_id), created_at: g.created_at }));
    return {
      athlete: { id: a.id, name: a.name },
      viewer: viewerIsCoach ? 'coach' : 'athlete',
      summary: { assessed: assessed.length, improved_last: assessed.filter(s => s.delta > 0).length, slipped_last: assessed.filter(s => s.delta < 0).length, unassessed: skills.filter(s => !s.latest && !s.archived).length, goals_open: goals.filter(g => g.status !== 'completed').length, goals_completed: goals.filter(g => g.status === 'completed').length, last_rated_on: assessed.map(s => s.latest.rated_on).sort().pop() || '' },
      skills, goals, scale: SCALE
    };
  }
  r.get('/api/me/skills', ({ user }) => {
    auth.require(user);
    const id = auth.ownAthleteId(user);
    if (!id) throw new HttpError(404, 'Connect an athlete profile first.');
    return progress(db.prepare('SELECT * FROM athletes WHERE id=?').get(id), false);
  });
  r.get('/api/athletes/:id/skills', ({ user, params }) => { const a = athlete(user, params.id); return progress(a.row, a.level === 'coach'); });

  /* ---------- ratings (coach) ---------- */
  r.post('/api/athletes/:id/skill-ratings', ({ user, params, body }) => {
    const a = coachOf(user, params.id);
    const ratedOn = body.rated_on ? day(body.rated_on, 'Rating date') : today();
    if (ratedOn > today()) throw new HttpError(400, 'Rating date cannot be in the future.');
    const items = list(body.ratings, 'ratings', { max: 60, item: x => ({ attribute_id: int(x && x.attribute_id, 'attribute', { min: 1, required: true }), rating: int(x && x.rating, 'rating', { min: 1, max: 5, required: true }), comment: str(x && x.comment, 'comment', { max: 600 }) }) });
    if (!items.length) throw new HttpError(400, 'Rate at least one skill.');
    const clientKey = body.client_id ? str(body.client_id, 'client_id', { max: 80 }) : '';
    if (clientKey && db.prepare('SELECT 1 FROM skill_ratings WHERE client_id=?').get(clientKey + ':' + items[0].attribute_id)) return { ok: true, duplicate: true };
    const ins = db.prepare('INSERT INTO skill_ratings(athlete_id,attribute_id,rating,comment,rated_on,coach_id,client_id,created_at) VALUES(?,?,?,?,?,?,?,?)');
    let improved = 0, saved = 0;
    tx(db, () => {
      for (const it of items) {
        attr(it.attribute_id);
        const prev = db.prepare('SELECT rating FROM skill_ratings WHERE athlete_id=? AND attribute_id=? ORDER BY rated_on DESC,id DESC LIMIT 1').get(a.id, it.attribute_id);
        if (prev && prev.rating > 0 && it.rating > prev.rating) improved++;
        ins.run(a.id, it.attribute_id, it.rating, it.comment || '', ratedOn, user.id, clientKey ? clientKey + ':' + it.attribute_id : null, now());
        saved++;
      }
    });
    notifier.notify(notifier.usersOfAthletes([a.id]), 'feedback', `${user.name} rated ${saved} skill${saved === 1 ? '' : 's'}`, improved ? `${improved} moved up. Open My Progress to see the comments.` : 'Open My Progress to see where you stand.', '#/skills');
    return { ok: true, saved, improved };
  });
  r.del('/api/skill-ratings/:id', ({ user, params }) => {
    auth.require(user, 'coach');
    const row = db.prepare('SELECT * FROM skill_ratings WHERE id=?').get(int(params.id, 'rating', { min: 1, required: true }));
    if (!row) throw new HttpError(404, 'Rating not found.');
    coachOf(user, row.athlete_id);
    db.prepare('DELETE FROM skill_ratings WHERE id=?').run(row.id);
    return { ok: true };
  });

  /* ---------- goals ---------- */
  function goalFields(body, partial = false) {
    const f = {};
    if (!partial || body.title !== undefined) f.title = str(body.title, 'title', { required: true, max: 160 });
    if (!partial || body.note !== undefined) f.note = str(body.note, 'note', { max: 1000 });
    if (body.attribute_id !== undefined) f.attribute_id = body.attribute_id ? attr(body.attribute_id).id : null;
    if (body.target_on !== undefined) f.target_on = day(body.target_on, 'Target date', true) || null;
    if (body.status !== undefined) f.status = oneOf(body.status, GOAL_STATUS, 'status');
    return f;
  }
  r.post('/api/athletes/:id/skill-goals', ({ user, params, body }) => {
    const a = coachOf(user, params.id), f = goalFields(body);
    const id = db.prepare('INSERT INTO skill_goals(athlete_id,attribute_id,title,note,status,target_on,coach_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(a.id, f.attribute_id || null, f.title, f.note || '', f.status || 'not_started', f.target_on || null, user.id, now(), now()).lastInsertRowid;
    notifier.notify(notifier.usersOfAthletes([a.id]), 'feedback', `New goal from ${user.name}: ${f.title}`, 'Open My Progress to see it alongside your skills.', '#/skills');
    return db.prepare('SELECT * FROM skill_goals WHERE id=?').get(id);
  });
  r.put('/api/skill-goals/:id', ({ user, params, body }) => {
    auth.require(user);
    const g = db.prepare('SELECT * FROM skill_goals WHERE id=?').get(int(params.id, 'goal', { min: 1, required: true }));
    if (!g) throw new HttpError(404, 'Goal not found.');
    const a = athlete(user, g.athlete_id);
    let f;
    if (a.level === 'coach') f = goalFields(body, true);
    else { // athletes may move their own goal between not started and in progress
      f = {}; if (body.status !== undefined) { f.status = oneOf(body.status, ['not_started', 'in_progress'], 'status'); if (g.status === 'completed') throw new HttpError(403, 'Ask your coach to reopen a completed goal.'); }
    }
    if (f.status === 'completed' && g.status !== 'completed') f.completed_at = now();
    if (f.status && f.status !== 'completed') f.completed_at = null;
    const keys = Object.keys(f);
    if (keys.length) db.prepare('UPDATE skill_goals SET ' + keys.map(k => k + '=?').join(',') + ', updated_at=? WHERE id=?').run(...keys.map(k => f[k]), now(), g.id);
    if (a.level === 'coach' && f.status === 'completed' && g.status !== 'completed') notifier.notify(notifier.usersOfAthletes([g.athlete_id]), 'feedback', `Goal completed: ${g.title}`, `${user.name} marked it done.`, '#/skills');
    return db.prepare('SELECT * FROM skill_goals WHERE id=?').get(g.id);
  });
  r.del('/api/skill-goals/:id', ({ user, params }) => {
    auth.require(user, 'coach');
    const g = db.prepare('SELECT * FROM skill_goals WHERE id=?').get(int(params.id, 'goal', { min: 1, required: true }));
    if (!g) throw new HttpError(404, 'Goal not found.');
    coachOf(user, g.athlete_id);
    db.prepare('DELETE FROM skill_goals WHERE id=?').run(g.id);
    return { ok: true };
  });
};
module.exports.SCALE = SCALE;
