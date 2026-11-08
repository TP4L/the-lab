'use strict';
/* Progress reports: build a period summary for an athlete (sessions, skills,
   reads, goals, coach notes), let the coach add a written summary, publish a
   frozen snapshot and share it by link. */
const { HttpError, str, int } = require('../http');
const { now } = require('../db');
const crypto = require('node:crypto');
const lab = require('../lab');

function day(v, label) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) throw new HttpError(400, label + ' must be a valid date.');
  return v;
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const fmt = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

module.exports = function (r, ctx) {
  const { db, auth, notifier, config } = ctx;
  const SCALE = require('./skills.js').SCALE;

  function access(user, id) {
    auth.require(user); id = int(id, 'athlete', { min: 1, required: true });
    const level = auth.athleteAccess(user, id);
    if (!level) throw new HttpError(404, 'Athlete not found.');
    return { a: db.prepare('SELECT * FROM athletes WHERE id=?').get(id), level };
  }
  function period(query) {
    let from = query.get('from'), to = query.get('to');
    if (!to) to = today();
    if (!from) { const d = new Date(to + 'T12:00:00'); d.setDate(d.getDate() - 29); from = d.toISOString().slice(0, 10); }
    day(from, 'from'); day(to, 'to');
    if (from > to) throw new HttpError(400, 'from must be before to.');
    return { from, to };
  }

  function build(a, from, to) {
    const toEnd = to + 'T23:59:59.999Z', fromStart = from + 'T00:00:00.000Z';
    const sessions = db.prepare("SELECT s.id, s.title, s.started_at, s.completed_at FROM training_sessions s JOIN training_athletes ta ON ta.session_id=s.id WHERE ta.athlete_id=? AND s.status='complete' AND s.started_at BETWEEN ? AND ? ORDER BY s.started_at").all(a.id, fromStart, toEnd);
    const attrs = db.prepare('SELECT * FROM skill_attributes ORDER BY sort,id').all();
    const ratings = db.prepare('SELECT * FROM skill_ratings WHERE athlete_id=? ORDER BY rated_on, id').all(a.id);
    const skills = [];
    for (const at of attrs) {
      const h = ratings.filter(x => x.attribute_id === at.id);
      if (!h.length) continue;
      const before = h.filter(x => x.rated_on < from).pop() || null;
      const inPeriod = h.filter(x => x.rated_on >= from && x.rated_on <= to);
      const end = inPeriod.length ? inPeriod[inPeriod.length - 1] : before;
      if (!end) continue;
      const start = before || (inPeriod.length ? inPeriod[0] : null);
      const comments = inPeriod.filter(x => x.comment).map(x => ({ on: x.rated_on, text: x.comment }));
      skills.push({ id: at.id, name: at.name, reads: lab.parse(at.reads, []), start: start ? start.rating : null, end: end.rating, end_label: SCALE[end.rating - 1].label, delta: start ? end.rating - start.rating : 0, assessed_in_period: inPeriod.length, comments, archived: !!at.archived_at });
    }
    const reads = {};
    for (const rd of lab.READS) { const rows = skills.filter(s => s.reads.includes(rd)); reads[rd] = { label: lab.LABELS.reads[rd], count: rows.length, avg: rows.length ? Math.round(rows.reduce((x, s) => x + s.end, 0) / rows.length * 10) / 10 : null, delta: rows.length ? Math.round(rows.reduce((x, s) => x + s.delta, 0) / rows.length * 10) / 10 : 0 }; }
    const goals = db.prepare('SELECT g.*, sa.name AS attribute_name FROM skill_goals g LEFT JOIN skill_attributes sa ON sa.id=g.attribute_id WHERE g.athlete_id=? ORDER BY g.created_at').all(a.id)
      .map(g => ({ id: g.id, title: g.title, status: g.status, attribute_name: g.attribute_name || '', reads: lab.parse(g.reads, []), created_at: g.created_at, completed_at: g.completed_at || '' }));
    const completed = goals.filter(g => g.completed_at && g.completed_at >= fromStart && g.completed_at <= toEnd);
    const open = goals.filter(g => g.status !== 'completed');
    const notes = db.prepare("SELECT n.body, n.created_at, n.tags, u.name AS author FROM notes n LEFT JOIN users u ON u.id=n.author_id WHERE n.athlete_id=? AND n.kind='coach' AND n.visibility='shared' AND n.created_at BETWEEN ? AND ? ORDER BY n.created_at").all(a.id, fromStart, toEnd)
      .map(n => ({ body: n.body, at: n.created_at, author: n.author || 'Coach', tags: lab.parse(n.tags, {}) }));
    const reflections = db.prepare("SELECT body, created_at FROM notes WHERE athlete_id=? AND kind='reflection' AND created_at BETWEEN ? AND ? ORDER BY created_at").all(a.id, fromStart, toEnd).map(n => ({ body: n.body.replace(/^(Question|Video review)\n/, ''), at: n.created_at }));
    const checkins = db.prepare('SELECT COUNT(*) AS n FROM pre_session_checkins WHERE athlete_id=? AND created_at BETWEEN ? AND ?').get(a.id, fromStart, toEnd).n;
    const blocks = db.prepare("SELECT title, status FROM development_blocks WHERE athlete_id=? AND draft=0 AND updated_at BETWEEN ? AND ?").all(a.id, fromStart, toEnd);
    const credits = db.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE athlete_id=? AND ref_type='session' AND created_at BETWEEN ? AND ?").get(a.id, fromStart, toEnd).n;
    const matches = db.prepare("SELECT COUNT(*) AS n FROM match_players mp JOIN matches m ON m.id=mp.match_id WHERE mp.athlete_id=? AND m.created_at BETWEEN ? AND ?").get(a.id, fromStart, toEnd);
    const improved = skills.filter(s => s.delta > 0).length, slipped = skills.filter(s => s.delta < 0).length;
    const highlights = [];
    if (sessions.length) highlights.push(`${sessions.length} coached session${sessions.length === 1 ? '' : 's'}`);
    if (improved) highlights.push(`${improved} skill${improved === 1 ? '' : 's'} moved up`);
    if (completed.length) highlights.push(`${completed.length} goal${completed.length === 1 ? '' : 's'} completed`);
    const best = skills.slice().sort((x, y) => y.delta - x.delta)[0];
    if (best && best.delta > 0) highlights.push(`Biggest gain: ${best.name} (+${best.delta})`);
    return {
      athlete: { id: a.id, name: a.name, rating: a.rating || '', focus: a.focus || '' },
      period: { from, to, label: fmt(from) + ' – ' + fmt(to) },
      summary: { sessions: sessions.length, assessments: new Set(ratings.filter(x => x.rated_on >= from && x.rated_on <= to).map(x => x.rated_on)).size, skills_tracked: skills.length, improved, slipped, goals_completed: completed.length, goals_open: open.length, checkins, credits_used: credits, matches: matches ? matches.n : 0, blocks: blocks.length },
      highlights, reads, skills, goals: { completed, open }, sessions: sessions.map(s => ({ id: s.id, title: s.title, at: s.started_at })), coach_notes: notes, reflections, scale: SCALE, vocab: lab.vocab()
    };
  }

  r.get('/api/athletes/:id/report', ({ user, params, query }) => { const { a } = access(user, params.id); const p = period(query); return build(a, p.from, p.to); });
  r.get('/api/me/report', ({ user, query }) => { auth.require(user); const id = auth.ownAthleteId(user); if (!id) throw new HttpError(404, 'Connect an athlete profile first.'); const p = period(query); return build(db.prepare('SELECT * FROM athletes WHERE id=?').get(id), p.from, p.to); });

  const shape = x => ({ id: x.id, token: x.token, title: x.title, summary: x.summary, period_from: x.period_from, period_to: x.period_to, published_at: x.published_at, revoked: !!x.revoked_at, coach: x.coach_name || '', url: `${config.publicUrl}/#/report/${x.token}` });
  r.get('/api/athletes/:id/reports', ({ user, params }) => { const { a } = access(user, params.id); return { reports: db.prepare('SELECT r.*, u.name AS coach_name FROM athlete_reports r LEFT JOIN users u ON u.id=r.coach_id WHERE r.athlete_id=? ORDER BY r.published_at DESC').all(a.id).map(shape) }; });
  r.get('/api/me/reports', ({ user }) => { auth.require(user); const id = auth.ownAthleteId(user); return { reports: id ? db.prepare('SELECT r.*, u.name AS coach_name FROM athlete_reports r LEFT JOIN users u ON u.id=r.coach_id WHERE r.athlete_id=? AND r.revoked_at IS NULL ORDER BY r.published_at DESC').all(id).map(shape) : [] }; });

  r.post('/api/athletes/:id/reports', ({ user, params, body }) => {
    const { a, level } = access(user, params.id);
    if (level !== 'coach') throw new HttpError(403, 'Only a coach can publish a report.');
    const from = day(body.from, 'from'), to = day(body.to, 'to'); if (from > to) throw new HttpError(400, 'from must be before to.');
    const data = build(a, from, to);
    const summary = str(body.summary, 'summary', { max: 4000 });
    const title = str(body.title, 'title', { max: 120 }) || ('Progress report · ' + new Date(to + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
    const token = crypto.randomBytes(9).toString('base64url');
    const snapshot = { ...data, title, summary_text: summary, coach: user.name, published_at: now() };
    const id = db.prepare('INSERT INTO athlete_reports(token,athlete_id,period_from,period_to,title,summary,snapshot,coach_id,published_at) VALUES(?,?,?,?,?,?,?,?,?)').run(token, a.id, from, to, title, summary, JSON.stringify(snapshot), user.id, now()).lastInsertRowid;
    if (a.user_id) notifier.notify([a.user_id], 'feedback', `Your progress report is ready: ${title}`, summary ? summary.slice(0, 140) : 'Open it to see the period in one place.', '#/report/' + token);
    return shape({ ...db.prepare('SELECT * FROM athlete_reports WHERE id=?').get(id), coach_name: user.name });
  });
  r.put('/api/reports/:token', ({ user, params, body }) => {
    const rep = db.prepare('SELECT * FROM athlete_reports WHERE token=?').get(String(params.token));
    if (!rep) throw new HttpError(404, 'Report not found.');
    const { level } = access(user, rep.athlete_id);
    if (level !== 'coach') throw new HttpError(403, 'Only a coach can change a report.');
    if (body.revoked !== undefined) db.prepare('UPDATE athlete_reports SET revoked_at=? WHERE id=?').run(body.revoked ? now() : null, rep.id);
    return shape(db.prepare('SELECT * FROM athlete_reports WHERE id=?').get(rep.id));
  });
  // Public: anyone with the link. Snapshot is frozen at publish time.
  r.get('/api/reports/:token', ({ params }) => {
    const rep = db.prepare('SELECT * FROM athlete_reports WHERE token=?').get(String(params.token));
    if (!rep || rep.revoked_at) throw new HttpError(404, 'This report is not available.');
    return JSON.parse(rep.snapshot);
  });
};
