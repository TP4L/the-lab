'use strict';
const { HttpError, withStatus, str, oneOf, int, num, uuid, isoTime, list } = require('../http.js');
const { tx, now } = require('../db.js');

const MEASURES = ['reps', 'time', 'score', 'feel'];
const MAX_ITEMS = 10;
const MAX_ATHLETES = 8;

/* Fold the event log into per-item, per-athlete totals. Undo cancels the event
   it names, so replaying the log in any order gives the same answer. */
function summarize(items, athleteIds, events) {
  const undone = new Set(events.filter(e => e.kind === 'undo' && e.undoes).map(e => e.undoes));
  const cells = {};
  items.forEach(it => athleteIds.forEach(aid => {
    cells[it.idx + ':' + aid] = { item_idx: it.idx, athlete_id: aid, makes: 0, misses: 0, values: [] };
  }));
  events.slice().sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).forEach(e => {
    if (e.kind === 'undo' || undone.has(e.id)) return;
    const c = cells[e.item_idx + ':' + e.athlete_id];
    if (!c) return;
    if (e.kind === 'make') c.makes++;
    else if (e.kind === 'miss') c.misses++;
    else if (e.kind === 'value') c.values.push(e.value);
  });
  return Object.values(cells).map(c => {
    const attempts = c.makes + c.misses;
    const v = c.values;
    return {
      ...c, attempts,
      pct: attempts ? Math.round(c.makes / attempts * 100) : null,
      last: v.length ? v[v.length - 1] : null,
      best: v.length ? Math.max(...v) : null,
      avg: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null
    };
  });
}

function loadSession(db, id) {
  const s = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(id);
  if (!s) return null;
  const items = db.prepare('SELECT * FROM training_items WHERE session_id = ? ORDER BY idx').all(id);
  const athletes = db.prepare(`SELECT ta.slot, a.id, a.name, a.hand, a.side FROM training_athletes ta JOIN athletes a ON a.id = ta.athlete_id
    WHERE ta.session_id = ? ORDER BY ta.slot`).all(id);
  const events = db.prepare('SELECT id, item_idx, athlete_id, kind, value, undoes, at FROM score_events WHERE session_id = ?').all(id);
  return { ...s, items, athletes, events, summary: summarize(items, athletes.map(a => a.id), events) };
}

/* Everything recorded for one athlete, newest first. Used on their profile. */
function athleteResults(db, athleteId) {
  const sessions = db.prepare(`SELECT s.* FROM training_athletes ta JOIN training_sessions s ON s.id = ta.session_id
    WHERE ta.athlete_id = ? ORDER BY s.started_at DESC LIMIT 50`).all(athleteId);
  return sessions.map(s => {
    const items = db.prepare('SELECT idx, name, measure, target FROM training_items WHERE session_id = ? ORDER BY idx').all(s.id);
    const events = db.prepare('SELECT id, item_idx, athlete_id, kind, value, undoes, at FROM score_events WHERE session_id = ? AND athlete_id = ?').all(s.id, athleteId);
    // Undo events carry the athlete of the event they cancel, so filtering by athlete is safe.
    const cells = summarize(items, [athleteId], events);
    return {
      session_id: s.id, title: s.title, status: s.status, started_at: s.started_at, completed_at: s.completed_at,
      items: items.map(it => ({ ...it, ...cells.find(c => c.item_idx === it.idx) }))
    };
  });
}

module.exports = function training(r, { db, auth, notifier }) {
  function sessionAccess(user, id, { write = false } = {}) {
    auth.require(user);
    const s = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(id);
    if (!s) throw new HttpError(404, 'Session not found.');
    const isCoach = s.coach_id === user.id || user.roles.includes('admin');
    if (isCoach) return s;
    if (!write) {
      const mine = auth.ownAthleteId(user);
      if (mine && db.prepare('SELECT 1 FROM training_athletes WHERE session_id = ? AND athlete_id = ?').get(id, mine)) return s;
    }
    throw new HttpError(404, 'Session not found.');
  }

  function itemFields(x, f) {
    if (!x || typeof x !== 'object') throw new HttpError(400, `${f} must be an object.`);
    return {
      name: str(x.name, `${f}.name`, { required: true, max: 120 }),
      measure: oneOf(x.measure || 'reps', MEASURES, `${f}.measure`),
      target: str(x.target, `${f}.target`, { max: 120 }),
      instructions: str(x.instructions, `${f}.instructions`, { max: 2000 })
    };
  }

  r.get('/api/training/sessions', ({ user }) => {
    auth.require(user);
    const mine = auth.ownAthleteId(user);
    const rows = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM training_athletes ta WHERE ta.session_id = s.id) AS athlete_count,
        (SELECT group_concat(a.name, ', ') FROM training_athletes ta JOIN athletes a ON a.id = ta.athlete_id WHERE ta.session_id = s.id) AS athlete_names
      FROM training_sessions s
      WHERE s.coach_id = ? OR EXISTS (SELECT 1 FROM training_athletes ta WHERE ta.session_id = s.id AND ta.athlete_id = ?)
      ORDER BY s.started_at DESC LIMIT 100`).all(user.id, mine || -1);
    return rows;
  });

  /* Create. The device picks the UUID, so creating offline and retrying later
     returns the same session instead of making a second one. */
  r.post('/api/training/sessions', ({ user, body }) => {
    auth.require(user, 'coach');
    const id = uuid(body.id, 'id');
    const prior = db.prepare('SELECT coach_id FROM training_sessions WHERE id = ?').get(id);
    if (prior) {
      if (prior.coach_id !== user.id) throw new HttpError(409, 'Session ID already used.');
      return withStatus(200, loadSession(db, id));
    }
    const title = str(body.title, 'title', { required: true, max: 120 });
    const athleteIds = [...new Set(list(body.athletes, 'athletes', { max: MAX_ATHLETES, item: (x, f) => int(x, f, { min: 1, required: true }) }))];
    if (!athleteIds.length) throw new HttpError(400, 'Add at least one athlete.');
    athleteIds.forEach(aid => { if (!auth.coachesAthlete(user, aid)) throw new HttpError(403, `You don’t coach athlete ${aid}.`); });
    const items = list(body.items, 'items', { max: MAX_ITEMS, item: itemFields });
    if (!items.length) throw new HttpError(400, 'Add at least one drill.');
    const startedAt = isoTime(body.started_at, 'started_at') || now();
    const assignment = body.assignment_id ? db.prepare('SELECT * FROM assignments WHERE id = ?').get(int(body.assignment_id, 'assignment_id', { min: 1 })) : null;
    if (body.assignment_id && (!assignment || !athleteIds.includes(assignment.athlete_id))) throw new HttpError(400, 'That assignment isn\u2019t for an athlete in this session.');
    tx(db, () => {
      db.prepare('INSERT INTO training_sessions (id, coach_id, title, started_at) VALUES (?, ?, ?, ?)').run(id, user.id, title, startedAt);
      athleteIds.forEach((aid, i) => db.prepare('INSERT INTO training_athletes (session_id, athlete_id, slot) VALUES (?, ?, ?)').run(id, aid, i + 1));
      items.forEach((it, i) => db.prepare('INSERT INTO training_items (session_id, idx, name, measure, target, instructions) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, i, it.name, it.measure, it.target, it.instructions));
      if (assignment) {
        db.prepare("UPDATE assignments SET status = 'done', session_id = ?, completed_at = ? WHERE id = ?").run(id, now(), assignment.id);
        db.prepare("UPDATE development_blocks SET session_id = ?, status = CASE WHEN status = 'assigned' THEN 'in_progress' ELSE status END, updated_at = ? WHERE assignment_id = ?")
          .run(id, now(), assignment.id);
        db.prepare('UPDATE development_blocks SET retest_session_id = ?, updated_at = ? WHERE retest_assignment_id = ?').run(id, now(), assignment.id);
      }
    });
    return withStatus(201, loadSession(db, id));
  });

  r.get('/api/training/sessions/:id', ({ user, params }) => {
    const s = sessionAccess(user, uuid(params.id, 'id'));
    const full = loadSession(db, s.id);
    const coachView = s.coach_id === user.id || user.roles.includes('admin');
    const mine = auth.ownAthleteId(user);
    // Notes written during this session; athletes see only what's shared with them.
    full.notes = db.prepare(`SELECT n.id, n.athlete_id, n.kind, n.visibility, n.body, n.created_at, u.name AS author, a.name AS athlete_name
      FROM notes n LEFT JOIN users u ON u.id = n.author_id JOIN athletes a ON a.id = n.athlete_id WHERE n.session_id = ? ORDER BY n.created_at`).all(s.id)
      .filter(n => coachView || (n.athlete_id === mine && n.visibility === 'shared'));
    // Games recorded from this session.
    full.matches = db.prepare('SELECT id, status, winner FROM matches WHERE session_id = ? ORDER BY played_at').all(s.id).map(m => {
      const ps = db.prepare('SELECT mp.team, mp.athlete_id, COALESCE(a.name, mp.guest_name) AS name FROM match_players mp LEFT JOIN athletes a ON a.id = mp.athlete_id WHERE mp.match_id = ? ORDER BY mp.team, mp.slot').all(m.id);
      const gs = db.prepare('SELECT team1, team2 FROM match_games WHERE match_id = ? ORDER BY idx').all(m.id).map(g => [g.team1, g.team2]);
      return { ...m, players: ps, games: gs };
    }).filter(m => coachView || m.players.some(p => p.athlete_id === mine));
    // An athlete viewing a group session sees only their own row.
    if (!coachView) {
      full.summary = full.summary.filter(c => c.athlete_id === mine);
      full.events = full.events.filter(e => e.athlete_id === mine);
      full.athletes = full.athletes.filter(a => a.id === mine);
    }
    return full;
  });

  /* Edit title/drills or complete the session. Optimistic concurrency: a stale
     version gets 409 with the current copy so the device can rebase. */
  r.put('/api/training/sessions/:id', ({ user, params, body }) => {
    const s = sessionAccess(user, uuid(params.id, 'id'), { write: true });
    const version = int(body.version, 'version', { min: 1, required: true });
    if (version !== s.version) throw new HttpError(409, 'Someone else changed this session. Your scores are safe; review the latest copy.', { current: loadSession(db, s.id) });
    const title = body.title === undefined ? s.title : str(body.title, 'title', { required: true, max: 120 });
    const status = body.status === undefined ? s.status : oneOf(body.status, ['live', 'complete'], 'status');
    tx(db, () => {
      if (body.items !== undefined) {
        const items = list(body.items, 'items', { max: MAX_ITEMS, item: itemFields });
        const existing = db.prepare('SELECT COUNT(*) AS n FROM training_items WHERE session_id = ?').get(s.id).n;
        if (items.length < existing) throw new HttpError(400, 'Drills can be renamed or added, not removed, once a session has started.');
        items.forEach((it, i) => db.prepare(`INSERT INTO training_items (session_id, idx, name, measure, target, instructions) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id, idx) DO UPDATE SET name = excluded.name, target = excluded.target, instructions = excluded.instructions`)
          .run(s.id, i, it.name, it.measure, it.target, it.instructions));
      }
      db.prepare('UPDATE training_sessions SET title = ?, status = ?, completed_at = ?, version = version + 1, updated_at = ? WHERE id = ?')
        .run(title, status, status === 'complete' ? (s.completed_at || now()) : null, now(), s.id);
      if (status === 'complete' && s.status !== 'complete') {
        db.prepare("UPDATE development_blocks SET status = 'coach_review', updated_at = ? WHERE retest_session_id = ?").run(now(), s.id);
      }
    });
    if (status === 'complete' && s.status !== 'complete') {
      const initial = db.prepare('SELECT id, athlete_id, title FROM development_blocks WHERE session_id = ? AND retest_session_id IS NULL').all(s.id);
      initial.forEach(b => notifier.notify(notifier.usersOfAthletes([b.athlete_id]), 'training', `Training complete: ${b.title}`, 'Add your reflection and evidence while the read is fresh.', `#/development/${b.id}`));
      const retests = db.prepare('SELECT id, athlete_id, assigned_by, title FROM development_blocks WHERE retest_session_id = ?').all(s.id);
      retests.forEach(b => notifier.notify([...new Set([b.assigned_by, user.id].filter(Boolean))], 'training', `Retest ready to review: ${b.title}`, 'Review the completed retest and decide the next stage.', `#/development/${b.id}`));
    }
    return loadSession(db, s.id);
  });

  r.del('/api/training/sessions/:id', ({ user, params }) => {
    const s = sessionAccess(user, uuid(params.id, 'id'), { write: true });
    db.prepare('DELETE FROM training_sessions WHERE id = ?').run(s.id);
    return withStatus(204, null);
  });

  /* Score events, in batches. Event IDs come from the device; resending a
     batch after a dropped connection is a no-op for events already stored. */
  r.post('/api/training/sessions/:id/events', ({ user, params, body }) => {
    const s = sessionAccess(user, uuid(params.id, 'id'), { write: true });
    const itemCount = db.prepare('SELECT COUNT(*) AS n FROM training_items WHERE session_id = ?').get(s.id).n;
    const athletes = new Set(db.prepare('SELECT athlete_id FROM training_athletes WHERE session_id = ?').all(s.id).map(r => r.athlete_id));
    const events = list(body.events, 'events', { max: 500, item: (e, f) => {
      if (!e || typeof e !== 'object') throw new HttpError(400, `${f} must be an object.`);
      const kind = oneOf(e.kind, ['make', 'miss', 'value', 'undo'], `${f}.kind`);
      const out = {
        id: uuid(e.id, `${f}.id`),
        item_idx: int(e.item_idx, `${f}.item_idx`, { min: 0, max: itemCount - 1, required: true }),
        athlete_id: int(e.athlete_id, `${f}.athlete_id`, { min: 1, required: true }),
        kind, value: kind === 'value' ? num(e.value, `${f}.value`, { min: -1e6, max: 1e6 }) : null,
        undoes: kind === 'undo' ? uuid(e.undoes, `${f}.undoes`) : null,
        at: isoTime(e.at, `${f}.at`) || now()
      };
      if (!athletes.has(out.athlete_id)) throw new HttpError(400, `${f}.athlete_id is not in this session.`);
      return out;
    } });
    let stored = 0;
    tx(db, () => {
      const ins = db.prepare(`INSERT OR IGNORE INTO score_events (id, session_id, item_idx, athlete_id, kind, value, undoes, at, author_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      events.forEach(e => { stored += Number(ins.run(e.id, s.id, e.item_idx, e.athlete_id, e.kind, e.value, e.undoes, e.at, user.id).changes); });
      db.prepare('UPDATE training_sessions SET updated_at = ? WHERE id = ?').run(now(), s.id);
    });
    const full = loadSession(db, s.id);
    return { stored, duplicates: events.length - stored, summary: full.summary, version: full.version };
  });

  r.get('/api/athletes/:id/results', ({ user, params }) => {
    auth.require(user);
    const id = int(params.id, 'id', { min: 1, required: true });
    if (!auth.athleteAccess(user, id)) throw new HttpError(404, 'Athlete not found.');
    return athleteResults(db, id);
  });
};
module.exports.athleteResults = athleteResults;
module.exports.summarize = summarize;
