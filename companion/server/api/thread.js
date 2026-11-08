'use strict';
/* The athlete thread: one chronological conversation per athlete that merges
   coach notes and replies, athlete reflections and questions, pre-session
   check-ins, skill assessments, goals and completed sessions. Writes go
   through the existing notes endpoints; this module is the read model plus
   "seen" bookkeeping. */
const { HttpError, int } = require('../http');
const { now } = require('../db');
const lab = require('../lab');

module.exports = function (r, ctx) {
  const { db, auth } = ctx;
  const SCALE = require('./skills.js').SCALE;

  function access(user, id) {
    auth.require(user); id = int(id, 'athlete', { min: 1, required: true });
    const level = auth.athleteAccess(user, id);
    if (!level) throw new HttpError(404, 'Athlete not found.');
    return { a: db.prepare('SELECT * FROM athletes WHERE id=?').get(id), level };
  }
  const name = id => id ? ((db.prepare('SELECT name FROM users WHERE id=?').get(id) || {}).name || '') : '';

  function build(a, level, viewer, limit) {
    const coachView = level === 'coach';
    const items = [];
    const notes = db.prepare('SELECT n.*, u.name AS author FROM notes n LEFT JOIN users u ON u.id=n.author_id WHERE n.athlete_id=? ORDER BY n.created_at DESC LIMIT ?').all(a.id, limit);
    for (const n of notes) {
      if (n.visibility === 'private' && !coachView) continue;
      const isCoach = n.kind === 'coach';
      let type = isCoach ? (n.reply_to ? 'reply' : 'note') : 'reflection', body = n.body, title = '';
      if (!isCoach && /^Question\n/.test(body)) { type = 'question'; body = body.replace(/^Question\n/, ''); }
      else if (!isCoach && /^Video review\n/.test(body)) { type = 'video'; body = body.replace(/^Video review\n/, ''); title = 'Video for review'; }
      items.push({ id: 'note:' + n.id, note_id: n.id, type, side: isCoach ? 'coach' : 'athlete', author: n.author || (isCoach ? 'Coach' : a.name), body, title, private: n.visibility === 'private', media_id: n.media_id || null, reply_to: n.reply_to || null, reviewed: !!n.reviewed_at, session_id: n.session_id || null, tags: lab.parse(n.tags, {}), at: n.created_at, mine: viewer && n.author_id === viewer.id });
    }
    const checkins = db.prepare('SELECT * FROM pre_session_checkins WHERE athlete_id=? ORDER BY created_at DESC LIMIT 20').all(a.id);
    for (const c of checkins) {
      items.push({ id: 'checkin:' + c.id, type: 'checkin', side: 'athlete', author: a.name, title: 'Pre-session check-in', body: 'Working: ' + c.working + '\nNot working: ' + c.not_working + '\nFocus: ' + c.focus, status: c.status, link: coachView ? '#/coach/checkins/' + c.id : '#/check-in', media_id: c.media_id || null, at: c.created_at });
      if (c.coach_note || c.first_test) items.push({ id: 'checkin-plan:' + c.id, type: 'plan', side: 'coach', author: 'Coach', title: 'Session plan', body: [c.hypothesis && 'Hypothesis: ' + c.hypothesis, c.first_test && 'First test: ' + c.first_test, c.constraint_text && 'Constraint: ' + c.constraint_text, c.coach_note].filter(Boolean).join('\n'), link: coachView ? '#/coach/checkins/' + c.id : '#/train', at: c.updated_at || c.created_at });
    }
    const ratings = db.prepare('SELECT r.rated_on, r.coach_id, r.created_at, r.rating, r.comment, sa.name FROM skill_ratings r JOIN skill_attributes sa ON sa.id=r.attribute_id WHERE r.athlete_id=? ORDER BY r.created_at DESC LIMIT 200').all(a.id);
    const byDay = new Map();
    for (const x of ratings) { const k = x.rated_on + ':' + x.coach_id; if (!byDay.has(k)) byDay.set(k, { at: x.created_at, coach: x.coach_id, on: x.rated_on, rows: [] }); byDay.get(k).rows.push(x); }
    for (const g of byDay.values()) items.push({ id: 'rating:' + g.on + ':' + g.coach, type: 'rating', side: 'coach', author: name(g.coach) || 'Coach', title: 'Skill assessment · ' + g.rows.length + ' skill' + (g.rows.length === 1 ? '' : 's'), body: g.rows.map(x => x.name + ': ' + x.rating + ' ' + SCALE[x.rating - 1].label + (x.comment ? ': ' + x.comment : '')).join('\n'), link: coachView ? '#/skills/' + a.id : '#/skills', at: g.on < g.at.slice(0, 10) ? g.on + 'T17:00:00.000Z' : g.at });
    const goals = db.prepare('SELECT g.*, sa.name AS attribute_name FROM skill_goals g LEFT JOIN skill_attributes sa ON sa.id=g.attribute_id WHERE g.athlete_id=? ORDER BY g.created_at DESC LIMIT 40').all(a.id);
    for (const g of goals) {
      items.push({ id: 'goal:' + g.id, type: 'goal', side: 'coach', author: name(g.coach_id) || 'Coach', title: 'New goal', tags: { reads: lab.parse(g.reads, []) }, body: g.title + (g.attribute_name ? ' · ' + g.attribute_name : '') + (g.note ? '\n' + g.note : ''), link: coachView ? '#/skills/' + a.id : '#/skills', at: g.created_at });
      if (g.completed_at) items.push({ id: 'goal-done:' + g.id, type: 'milestone', side: 'system', title: 'Goal completed', body: g.title, link: coachView ? '#/skills/' + a.id : '#/skills', at: g.completed_at });
    }
    const sessions = db.prepare("SELECT s.id, s.title, s.status, s.started_at, s.completed_at FROM training_sessions s JOIN training_athletes ta ON ta.session_id=s.id WHERE ta.athlete_id=? AND s.status!='live' ORDER BY s.started_at DESC LIMIT 30").all(a.id);
    for (const s of sessions) items.push({ id: 'session:' + s.id, type: 'session', side: 'system', title: 'Session', body: s.title, link: '#/train/' + s.id, at: s.completed_at || s.started_at });
    const blocks = db.prepare("SELECT id, title, status, draft, coach_feedback, athlete_reflection, updated_at, created_at FROM development_blocks WHERE athlete_id=? " + (coachView ? '' : 'AND draft=0 ') + "ORDER BY updated_at DESC LIMIT 30").all(a.id);
    for (const b of blocks) {
      items.push({ id: 'block:' + b.id, type: 'block', side: 'coach', author: 'Coach', title: b.draft ? 'Practice draft (not shared)' : 'Practice', body: b.title, link: '#/development/' + b.id, at: b.created_at, private: !!b.draft });
      if (b.coach_feedback) items.push({ id: 'block-fb:' + b.id, type: 'note', side: 'coach', author: 'Coach', title: 'Feedback · ' + b.title, body: b.coach_feedback, link: '#/development/' + b.id, at: b.updated_at });
    }
    const orders = coachView ? db.prepare("SELECT o.id, o.paid_at, o.amount_cents, p.name FROM orders o JOIN products p ON p.id=o.product_id WHERE o.athlete_id=? AND o.status='paid' ORDER BY o.paid_at DESC LIMIT 20").all(a.id) : [];
    for (const o of orders) items.push({ id: 'order:' + o.id, type: 'purchase', side: 'system', title: 'Purchase', body: o.name + ' · $' + (o.amount_cents / 100).toFixed(0), link: '#/coach/' + a.id + '/credits', at: o.paid_at, private: true });
    items.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
    const unreviewed = coachView ? notes.filter(n => n.kind === 'reflection' && !n.reviewed_at).length : 0;
    return { athlete: { id: a.id, name: a.name, user_id: a.user_id }, viewer: coachView ? 'coach' : 'athlete', items: items.slice(0, limit), unreviewed, vocab: lab.vocab() };
  }

  r.get('/api/athletes/:id/thread', ({ user, params, query }) => {
    const { a, level } = access(user, params.id);
    return build(a, level, user, Math.min(300, Math.max(20, Number(query.get('limit')) || 120)));
  });
  r.get('/api/me/thread', ({ user, query }) => {
    auth.require(user);
    const id = auth.ensureOwnAthleteId(user);
    return build(db.prepare('SELECT * FROM athletes WHERE id=?').get(id), 'self', user, Math.min(300, Math.max(20, Number(query.get('limit')) || 120)));
  });
  // Coach has read the athlete's messages: clears them from the review queue without a reply.
  r.post('/api/athletes/:id/thread/seen', ({ user, params }) => {
    const { a, level } = access(user, params.id);
    if (level !== 'coach') throw new HttpError(403, 'Only a coach can mark messages seen.');
    const n = db.prepare("UPDATE notes SET reviewed_at=?, reviewed_by=? WHERE athlete_id=? AND kind='reflection' AND reviewed_at IS NULL").run(now(), user.id, a.id).changes;
    return { ok: true, marked: Number(n) };
  });
};
