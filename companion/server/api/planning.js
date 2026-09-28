'use strict';
/* Pending Interest: find out who wants to play before choosing a date.
   Team Planner: coached sessions with invitations, court blocks, private
   handoff notes and one-observation / one-cue / one-next-task recaps.
   An interest check converts into a plan; a plan converts into a live event. */
const crypto = require('node:crypto');
const { HttpError, withStatus, str, oneOf, int, isoTime, list } = require('../http.js');
const { tx, now } = require('../db.js');
const { sha256, limiter } = require('../auth.js');

const KINDS = { training: 'Training group', event: 'Event', league: 'League', clinic: 'Clinic', open_play: 'Open play' };
const MAX_PLAYERS = 100, MAX_BLOCKS = 30;
const token = () => crypto.randomBytes(16).toString('hex');
const email = (v, field = 'email', required = false) => {
  const e = str(v, field, { required, max: 200 }).toLowerCase();
  if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new HttpError(400, 'Enter a valid email address.');
  return e;
};

module.exports = function planning(r, ctx) {
  const { db, auth, notifier, config } = ctx;
  const respondLimit = limiter(40, 60 * 60 * 1000);
  const ip = req => (config.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'x';
  const owns = (user, row) => !!row && (row.owner_id === user.id || user.roles.includes('admin'));

  /* ================= Pending Interest ================= */
  function checkRow(id, user) {
    auth.require(user, 'coach');
    const c = db.prepare('SELECT * FROM interest_checks WHERE id = ?').get(int(id, 'id', { min: 1, required: true }));
    if (!owns(user, c)) throw new HttpError(404, 'Interest check not found.');
    return c;
  }
  function options(checkId) { return db.prepare('SELECT id, label, starts_at FROM interest_options WHERE check_id = ? ORDER BY id').all(checkId); }
  function responses(checkId) {
    return db.prepare('SELECT * FROM interest_responses WHERE check_id = ? ORDER BY created_at').all(checkId)
      .map(({ edit_token_hash, option_ids, ...x }) => ({ ...x, option_ids: JSON.parse(option_ids) }));
  }
  function counts(checkId) {
    const rows = db.prepare('SELECT status, COUNT(*) AS n FROM interest_responses WHERE check_id = ? GROUP BY status').all(checkId);
    const out = { interested: 0, maybe: 0, waitlist: 0 };
    rows.forEach(x => { out[x.status] = x.n; });
    return out;
  }
  function optionCounts(checkId) {
    const tally = {};
    db.prepare("SELECT option_ids, status FROM interest_responses WHERE check_id = ? AND status != 'waitlist'").all(checkId).forEach(x => JSON.parse(x.option_ids).forEach(id => {
      tally[id] = tally[id] || { interested: 0, maybe: 0 }; tally[id][x.status]++;
    }));
    return options(checkId).map(o => ({ ...o, ...(tally[o.id] || { interested: 0, maybe: 0 }) }));
  }
  function checkView(c, withResponses) {
    const n = counts(c.id);
    const out = {
      id: c.id, title: c.title, kind: c.kind, kind_label: KINDS[c.kind], description: c.description, skill_level: c.skill_level, location: c.location, timing: c.timing,
      min_people: c.min_people, max_people: c.max_people, status: c.status, final_starts_at: c.final_starts_at, plan_id: c.plan_id, created_at: c.created_at, updated_at: c.updated_at,
      counts: n, options: optionCounts(c.id),
      progress: { have: n.interested, need: c.min_people || 0, reached: !!c.min_people && n.interested >= c.min_people }
    };
    if (withResponses) { out.link = `#/interest/${c.token}`; out.responses = responses(c.id); }
    return out;
  }
  function checkInput(b, cur = {}) {
    const v = (k, fn) => (b[k] === undefined ? cur[k] : fn(b[k]));
    const n = (k, fn) => (b[k] === undefined ? (cur[k] === undefined ? null : cur[k]) : fn(b[k]));
    const out = {
      title: v('title', x => str(x, 'title', { required: true, max: 120 })),
      kind: v('kind', x => oneOf(x, Object.keys(KINDS), 'kind')) || 'training',
      description: v('description', x => str(x, 'description', { max: 4000 })) || '',
      skill_level: v('skill_level', x => str(x, 'skill_level', { max: 60 })) || '',
      location: v('location', x => str(x, 'location', { max: 200 })) || '',
      timing: v('timing', x => str(x, 'timing', { max: 300 })) || '',
      min_people: n('min_people', x => int(x, 'min_people', { min: 1, max: 500 })),
      max_people: n('max_people', x => int(x, 'max_people', { min: 1, max: 500 }))
    };
    if (!out.title) throw new HttpError(400, 'title is required.');
    if (out.min_people && out.max_people && out.min_people > out.max_people) throw new HttpError(400, 'The minimum can’t be more than the maximum.');
    return out;
  }
  const optionList = v => list(v, 'options', { max: 12, item: (o, f) => ({
    id: o && o.id ? int(o.id, `${f}.id`, { min: 1 }) : null,
    label: str(o && o.label, `${f}.label`, { required: true, max: 120 }),
    starts_at: isoTime(o && o.starts_at, `${f}.starts_at`)
  }) });
  function saveOptions(checkId, opts) {
    const keep = opts.filter(o => o.id).map(o => o.id);
    const existing = options(checkId).map(o => o.id);
    existing.filter(id => !keep.includes(id)).forEach(id => db.prepare('DELETE FROM interest_options WHERE id = ?').run(id));
    opts.forEach(o => {
      if (o.id && existing.includes(o.id)) db.prepare('UPDATE interest_options SET label = ?, starts_at = ? WHERE id = ?').run(o.label, o.starts_at, o.id);
      else db.prepare('INSERT INTO interest_options (check_id, label, starts_at) VALUES (?, ?, ?)').run(checkId, o.label, o.starts_at);
    });
  }

  r.get('/api/interest', ({ user }) => {
    auth.require(user, 'coach');
    const rows = user.roles.includes('admin') ? db.prepare('SELECT * FROM interest_checks ORDER BY created_at DESC').all() : db.prepare('SELECT * FROM interest_checks WHERE owner_id = ? ORDER BY created_at DESC').all(user.id);
    return rows.map(c => checkView(c, false));
  });
  r.post('/api/interest', ({ user, body }) => {
    auth.require(user, 'coach');
    const f = checkInput(body);
    const opts = optionList(body.options);
    const id = tx(db, () => {
      const id = Number(db.prepare(`INSERT INTO interest_checks (owner_id, token, title, kind, description, skill_level, location, timing, min_people, max_people) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(user.id, token(), f.title, f.kind, f.description, f.skill_level, f.location, f.timing, f.min_people, f.max_people).lastInsertRowid);
      saveOptions(id, opts);
      return id;
    });
    return withStatus(201, checkView(db.prepare('SELECT * FROM interest_checks WHERE id = ?').get(id), true));
  });
  r.get('/api/interest/:id', ({ user, params }) => checkView(checkRow(params.id, user), true));
  r.put('/api/interest/:id', ({ user, params, body }) => {
    const c = checkRow(params.id, user);
    const f = checkInput(body, c);
    tx(db, () => {
      db.prepare('UPDATE interest_checks SET title = ?, kind = ?, description = ?, skill_level = ?, location = ?, timing = ?, min_people = ?, max_people = ?, updated_at = ? WHERE id = ?')
        .run(f.title, f.kind, f.description, f.skill_level, f.location, f.timing, f.min_people, f.max_people, now(), c.id);
      if (body.options !== undefined) saveOptions(c.id, optionList(body.options));
    });
    return checkView(db.prepare('SELECT * FROM interest_checks WHERE id = ?').get(c.id), true);
  });
  /* Close or reopen responses. */
  r.post('/api/interest/:id/status', ({ user, params, body }) => {
    const c = checkRow(params.id, user);
    const st = oneOf(body.status, ['open', 'closed'], 'status');
    if (c.status === 'scheduled') throw new HttpError(409, 'This interest check already became a session.');
    db.prepare('UPDATE interest_checks SET status = ?, updated_at = ? WHERE id = ?').run(st, now(), c.id);
    return checkView(db.prepare('SELECT * FROM interest_checks WHERE id = ?').get(c.id), true);
  });
  r.del('/api/interest/:id/responses/:rid', ({ user, params }) => {
    const c = checkRow(params.id, user);
    const rid = int(params.rid, 'rid', { min: 1, required: true });
    const row = db.prepare('SELECT * FROM interest_responses WHERE id = ? AND check_id = ?').get(rid, c.id);
    if (!row) throw new HttpError(404, 'Response not found.');
    tx(db, () => { db.prepare('DELETE FROM interest_responses WHERE id = ?').run(rid); if (row.status === 'interested') promoteInterest(c); });
    return checkView(db.prepare('SELECT * FROM interest_checks WHERE id = ?').get(c.id), true);
  });
  r.del('/api/interest/:id', ({ user, params }) => {
    const c = checkRow(params.id, user);
    db.prepare('DELETE FROM interest_checks WHERE id = ?').run(c.id);
    return withStatus(204, null);
  });
  /* Set the final date and turn the interest into a Team Planner session.
     Interested players (and maybes, if asked) become invitees. */
  r.post('/api/interest/:id/schedule', ({ user, params, body }) => {
    const c = checkRow(params.id, user);
    if (c.status === 'scheduled' && c.plan_id && db.prepare('SELECT 1 FROM plans WHERE id = ?').get(c.plan_id)) throw new HttpError(409, 'This interest check already became a session.', { plan_id: c.plan_id });
    const starts = isoTime(body.starts_at, 'starts_at', { allowEmpty: false });
    const ends = isoTime(body.ends_at, 'ends_at');
    const who = db.prepare(`SELECT * FROM interest_responses WHERE check_id = ? AND status IN (${body.include_maybe ? "'interested','maybe'" : "'interested'"}) ORDER BY created_at`).all(c.id);
    const planId = tx(db, () => {
      const id = Number(db.prepare(`INSERT INTO plans (owner_id, title, starts_at, ends_at, timezone, location, message, capacity, interest_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(user.id, c.title, starts, ends, str(body.timezone, 'timezone', { max: 60 }), str(body.location, 'location', { max: 200 }) || c.location, c.description, c.max_people, c.id).lastInsertRowid);
      who.slice(0, MAX_PLAYERS).forEach(x => db.prepare('INSERT INTO plan_players (plan_id, name, email, phone, token) VALUES (?, ?, ?, ?, ?)').run(id, x.name, x.email, x.phone, token()));
      db.prepare("UPDATE interest_checks SET status = 'scheduled', final_starts_at = ?, plan_id = ?, updated_at = ? WHERE id = ?").run(starts, id, now(), c.id);
      return id;
    });
    return withStatus(201, { plan_id: planId });
  });

  /* Public response page. Shows counts, never other people's names. */
  function checkByToken(t) {
    const c = db.prepare('SELECT * FROM interest_checks WHERE token = ?').get(String(t));
    if (!c) throw new HttpError(404, 'This interest link isn’t valid. Ask the organizer for a new one.');
    return c;
  }
  function interestedCount(checkId, exceptId) {
    return db.prepare("SELECT COUNT(*) AS n FROM interest_responses WHERE check_id = ? AND status = 'interested' AND id != ?").get(checkId, exceptId || 0).n;
  }
  /* A spot opened: the longest-waiting response moves up. */
  function promoteInterest(c) {
    if (!c.max_people || interestedCount(c.id) >= c.max_people) return;
    const next = db.prepare("SELECT id FROM interest_responses WHERE check_id = ? AND status = 'waitlist' ORDER BY created_at LIMIT 1").get(c.id);
    if (next) db.prepare("UPDATE interest_responses SET status = 'interested', updated_at = ? WHERE id = ?").run(now(), next.id);
  }
  function publicCheck(c) {
    const v = checkView(c, false);
    const { plan_id, ...rest } = v;
    return { ...rest, open: c.status === 'open', spots_left: c.max_people ? Math.max(0, c.max_people - v.counts.interested) : null };
  }
  r.get('/api/public/interest/:token', ({ params, query }) => {
    const c = checkByToken(params.token);
    const out = publicCheck(c);
    // Returning visitor: their own answer, if the device kept its edit token.
    const et = query.get('edit');
    if (et) {
      const mine = db.prepare('SELECT name, email, phone, status, option_ids, notes FROM interest_responses WHERE check_id = ? AND edit_token_hash = ?').get(c.id, sha256(String(et)));
      if (mine) out.mine = { ...mine, option_ids: JSON.parse(mine.option_ids) };
    }
    return out;
  });
  r.post('/api/public/interest/:token/respond', ({ params, body, req }) => {
    const c = checkByToken(params.token);
    if (c.status !== 'open') throw new HttpError(409, 'This interest check is closed. The organizer isn’t taking new responses.');
    if (!respondLimit(ip(req))) throw new HttpError(429, 'Too many responses from this device. Try again later.');
    const name = str(body.name, 'name', { required: true, max: 60 });
    const em = email(body.email, 'email', true);
    const phone = str(body.phone, 'phone', { max: 30 });
    const want = oneOf(body.status || 'interested', ['interested', 'maybe'], 'status');
    const valid = new Set(options(c.id).map(o => o.id));
    const optionIds = list(body.option_ids, 'option_ids', { max: 12, item: (x, f) => int(x, f, { min: 1, required: true }) }).filter(id => valid.has(id));
    const notes = str(body.notes, 'notes', { max: 1000 });
    const existing = db.prepare('SELECT * FROM interest_responses WHERE check_id = ? AND email = ?').get(c.id, em);
    if (existing && (!body.edit_token || sha256(String(body.edit_token)) !== existing.edit_token_hash)) {
      throw new HttpError(409, 'That email has already responded. Use the same device to change your answer, or ask the organizer.');
    }
    let status = want;
    if (want === 'interested' && c.max_people && interestedCount(c.id, existing && existing.id) >= c.max_people) status = existing && existing.status === 'interested' ? 'interested' : 'waitlist';
    const edit = existing ? String(body.edit_token) : token();
    tx(db, () => {
      if (existing) {
        db.prepare('UPDATE interest_responses SET name = ?, phone = ?, status = ?, option_ids = ?, notes = ?, updated_at = ? WHERE id = ?').run(name, phone, status, JSON.stringify(optionIds), notes, now(), existing.id);
        if (existing.status === 'interested' && status !== 'interested') promoteInterest(c);
      } else {
        db.prepare('INSERT INTO interest_responses (check_id, name, email, phone, status, option_ids, notes, edit_token_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(c.id, name, em, phone, status, JSON.stringify(optionIds), notes, sha256(edit));
      }
    });
    if (!existing && c.owner_id) {
      const n = interestedCount(c.id);
      if (c.min_people && status === 'interested' && n === c.min_people) notifier.notify([c.owner_id], 'events', `${c.title} reached its minimum`, `${n} people are interested. You can set a date.`, `#/coach/interest/${c.id}`);
    }
    return withStatus(existing ? 200 : 201, { status, edit_token: edit, check: publicCheck(db.prepare('SELECT * FROM interest_checks WHERE id = ?').get(c.id)) });
  });

  /* ================= Team Planner ================= */
  function planRow(id, user) {
    auth.require(user, 'coach');
    const p = db.prepare('SELECT * FROM plans WHERE id = ?').get(int(id, 'id', { min: 1, required: true }));
    if (!owns(user, p)) throw new HttpError(404, 'Plan not found.');
    return p;
  }
  const blocks = planId => db.prepare('SELECT id, ord, start_time, end_time, court, lead, drill, instructions FROM plan_blocks WHERE plan_id = ? ORDER BY ord').all(planId);
  const playersOf = planId => db.prepare('SELECT * FROM plan_players WHERE plan_id = ? ORDER BY id').all(planId);
  function rsvpCounts(planId) {
    const out = { invited: 0, in: 0, out: 0, maybe: 0, waitlist: 0 };
    db.prepare('SELECT rsvp, COUNT(*) AS n FROM plan_players WHERE plan_id = ? GROUP BY rsvp').all(planId).forEach(x => { out[x.rsvp] = x.n; });
    return out;
  }
  function planView(p) {
    return {
      ...p, blocks: blocks(p.id), counts: rsvpCounts(p.id),
      players: playersOf(p.id).map(x => ({ ...x, link: `#/i/${x.token}` })),
      event_live: p.event_id ? !!db.prepare('SELECT 1 FROM events WHERE id = ?').get(p.event_id) : false
    };
  }
  const timeOfDay = (v, f) => { const s = str(v, f, { max: 5 }); if (s && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new HttpError(400, `${f} must be a time like 09:30.`); return s; };
  const blockList = v => list(v, 'blocks', { max: MAX_BLOCKS, item: (b, f) => ({
    start_time: timeOfDay(b && b.start_time, `${f}.start_time`), end_time: timeOfDay(b && b.end_time, `${f}.end_time`),
    court: str(b && b.court, `${f}.court`, { max: 40 }), lead: str(b && b.lead, `${f}.lead`, { max: 60 }),
    drill: str(b && b.drill, `${f}.drill`, { max: 120 }), instructions: str(b && b.instructions, `${f}.instructions`, { max: 2000 })
  }) });
  function planInput(b, cur = {}) {
    const v = (k, fn) => (b[k] === undefined ? cur[k] : fn(b[k]));
    const n = (k, fn) => (b[k] === undefined ? (cur[k] === undefined ? null : cur[k]) : fn(b[k]));
    const out = {
      title: v('title', x => str(x, 'title', { required: true, max: 120 })),
      starts_at: n('starts_at', x => isoTime(x, 'starts_at')),
      ends_at: n('ends_at', x => isoTime(x, 'ends_at')),
      timezone: v('timezone', x => str(x, 'timezone', { max: 60 })) || '',
      location: v('location', x => str(x, 'location', { max: 200 })) || '',
      sport: v('sport', x => str(x, 'sport', { max: 40 })) || 'Pickleball',
      coaches: v('coaches', x => str(x, 'coaches', { max: 200 })) || '',
      message: v('message', x => str(x, 'message', { max: 4000 })) || '',
      agenda: v('agenda', x => str(x, 'agenda', { max: 4000 })) || '',
      handoff: v('handoff', x => str(x, 'handoff', { max: 4000 })) || '',
      capacity: n('capacity', x => int(x, 'capacity', { min: 1, max: MAX_PLAYERS })),
      status: v('status', x => oneOf(x, ['draft', 'published', 'done', 'cancelled'], 'status')) || 'draft'
    };
    if (!out.title) throw new HttpError(400, 'title is required.');
    if (out.starts_at && out.ends_at && out.ends_at < out.starts_at) throw new HttpError(400, 'The session ends before it starts.');
    return out;
  }
  const PLAN_COLS = ['title', 'starts_at', 'ends_at', 'timezone', 'location', 'sport', 'coaches', 'message', 'agenda', 'handoff', 'capacity', 'status'];
  function saveBlocks(planId, bs) {
    db.prepare('DELETE FROM plan_blocks WHERE plan_id = ?').run(planId);
    bs.forEach((b, i) => db.prepare('INSERT INTO plan_blocks (plan_id, ord, start_time, end_time, court, lead, drill, instructions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(planId, i, b.start_time, b.end_time, b.court, b.lead, b.drill, b.instructions));
  }
  const playerInput = (user, x, f) => {
    let athleteId = null, name = str(x && x.name, `${f}.name`, { max: 60 });
    if (x && x.athlete_id) {
      athleteId = int(x.athlete_id, `${f}.athlete_id`, { min: 1 });
      if (!auth.athleteAccess(user, athleteId)) throw new HttpError(400, `${f}: add athletes you coach, or type a name.`);
      name = name || db.prepare('SELECT name FROM athletes WHERE id = ?').get(athleteId).name;
    }
    if (!name) throw new HttpError(400, `${f}.name is required.`);
    return { name, email: email(x.email, `${f}.email`), phone: str(x.phone, `${f}.phone`, { max: 30 }), athlete_id: athleteId, court: str(x.court, `${f}.court`, { max: 40 }) };
  };
  function addPlayers(user, p, ps) {
    const have = db.prepare('SELECT COUNT(*) AS n FROM plan_players WHERE plan_id = ?').get(p.id).n;
    if (have + ps.length > MAX_PLAYERS) throw new HttpError(400, `A plan can have up to ${MAX_PLAYERS} players.`);
    ps.forEach(x => {
      const t = token();
      db.prepare('INSERT INTO plan_players (plan_id, name, email, phone, athlete_id, court, token) VALUES (?, ?, ?, ?, ?, ?, ?)').run(p.id, x.name, x.email, x.phone, x.athlete_id, x.court, t);
      if (x.athlete_id && p.status === 'published') notifyInvite(p, x.athlete_id, t);
    });
  }
  function notifyInvite(p, athleteId, t) {
    notifier.notify(notifier.usersOfAthletes([athleteId]), 'training', `You’re invited: ${p.title}`, p.starts_at ? new Date(p.starts_at).toUTCString().slice(0, 22) : 'Tap to answer In, Out or Maybe.', `#/i/${t}`);
  }

  r.get('/api/plans', ({ user }) => {
    auth.require(user, 'coach');
    const rows = user.roles.includes('admin') ? db.prepare('SELECT * FROM plans ORDER BY COALESCE(starts_at, created_at) DESC').all() : db.prepare('SELECT * FROM plans WHERE owner_id = ? ORDER BY COALESCE(starts_at, created_at) DESC').all(user.id);
    return rows.map(p => ({ id: p.id, title: p.title, starts_at: p.starts_at, location: p.location, status: p.status, capacity: p.capacity, counts: rsvpCounts(p.id), event_id: p.event_id }));
  });
  r.post('/api/plans', ({ user, body }) => {
    auth.require(user, 'coach');
    const f = planInput(body);
    const bs = blockList(body.blocks);
    const ps = list(body.players, 'players', { max: MAX_PLAYERS, item: (x, fl) => playerInput(user, x, fl) });
    const id = tx(db, () => {
      const id = Number(db.prepare(`INSERT INTO plans (owner_id, ${PLAN_COLS.join(', ')}) VALUES (?, ${PLAN_COLS.map(() => '?').join(', ')})`).run(user.id, ...PLAN_COLS.map(c => f[c])).lastInsertRowid);
      saveBlocks(id, bs);
      addPlayers(user, db.prepare('SELECT * FROM plans WHERE id = ?').get(id), ps);
      return id;
    });
    return withStatus(201, planView(db.prepare('SELECT * FROM plans WHERE id = ?').get(id)));
  });
  r.get('/api/plans/:id', ({ user, params }) => planView(planRow(params.id, user)));
  r.put('/api/plans/:id', ({ user, params, body }) => {
    const p = planRow(params.id, user);
    if (body.version !== undefined && int(body.version, 'version', { min: 1 }) !== p.version) throw new HttpError(409, 'This plan changed on another device. Review the latest version.', { current: planView(p) });
    const f = planInput(body, p);
    const bs = body.blocks === undefined ? null : blockList(body.blocks);
    tx(db, () => {
      db.prepare(`UPDATE plans SET ${PLAN_COLS.map(c => c + ' = ?').join(', ')}, version = version + 1, updated_at = ? WHERE id = ?`).run(...PLAN_COLS.map(c => f[c]), now(), p.id);
      if (bs) saveBlocks(p.id, bs);
      // Publishing tells linked athletes they're invited.
      if (f.status === 'published' && p.status === 'draft') playersOf(p.id).filter(x => x.athlete_id).forEach(x => notifyInvite({ ...p, ...f }, x.athlete_id, x.token));
    });
    return planView(db.prepare('SELECT * FROM plans WHERE id = ?').get(p.id));
  });
  r.del('/api/plans/:id', ({ user, params }) => {
    const p = planRow(params.id, user);
    db.prepare('DELETE FROM plans WHERE id = ?').run(p.id);
    return withStatus(204, null);
  });
  r.post('/api/plans/:id/players', ({ user, params, body }) => {
    const p = planRow(params.id, user);
    const ps = list(body.players, 'players', { max: MAX_PLAYERS, item: (x, f) => playerInput(user, x, f) });
    tx(db, () => addPlayers(user, p, ps));
    return withStatus(201, planView(db.prepare('SELECT * FROM plans WHERE id = ?').get(p.id)));
  });
  function planPlayer(p, pid) {
    const x = db.prepare('SELECT * FROM plan_players WHERE id = ? AND plan_id = ?').get(int(pid, 'pid', { min: 1, required: true }), p.id);
    if (!x) throw new HttpError(404, 'Player not found.');
    return x;
  }
  /* Coach edits a player: contact, court, RSVP on their behalf, recap text. */
  r.put('/api/plans/:id/players/:pid', ({ user, params, body }) => {
    const p = planRow(params.id, user);
    const x = planPlayer(p, params.pid);
    const v = (k, fn) => (body[k] === undefined ? x[k] : fn(body[k]));
    const f = {
      name: v('name', y => str(y, 'name', { required: true, max: 60 })), email: v('email', y => email(y)), phone: v('phone', y => str(y, 'phone', { max: 30 })),
      court: v('court', y => str(y, 'court', { max: 40 })),
      recap_observation: v('recap_observation', y => str(y, 'recap_observation', { max: 1000 })), recap_cue: v('recap_cue', y => str(y, 'recap_cue', { max: 1000 })), recap_next: v('recap_next', y => str(y, 'recap_next', { max: 1000 }))
    };
    tx(db, () => {
      db.prepare('UPDATE plan_players SET name = ?, email = ?, phone = ?, court = ?, recap_observation = ?, recap_cue = ?, recap_next = ? WHERE id = ?')
        .run(f.name, f.email, f.phone, f.court, f.recap_observation, f.recap_cue, f.recap_next, x.id);
      if (body.rsvp !== undefined) setRsvp(p, x, oneOf(body.rsvp, ['invited', 'in', 'out', 'maybe', 'waitlist'], 'rsvp'), true);
    });
    return planView(db.prepare('SELECT * FROM plans WHERE id = ?').get(p.id));
  });
  r.del('/api/plans/:id/players/:pid', ({ user, params }) => {
    const p = planRow(params.id, user);
    const x = planPlayer(p, params.pid);
    tx(db, () => { db.prepare('DELETE FROM plan_players WHERE id = ?').run(x.id); if (x.rsvp === 'in') promotePlan(p); });
    return planView(db.prepare('SELECT * FROM plans WHERE id = ?').get(p.id));
  });
  /* Publish (or unpublish) one player's recap: one observation, one cue, one next task. */
  r.post('/api/plans/:id/players/:pid/recap', ({ user, params, body }) => {
    const p = planRow(params.id, user);
    const x = planPlayer(p, params.pid);
    if (body.publish && !(x.recap_observation || x.recap_cue || x.recap_next)) throw new HttpError(400, 'Write the recap before publishing it.');
    db.prepare('UPDATE plan_players SET recap_published_at = ? WHERE id = ?').run(body.publish ? now() : null, x.id);
    if (body.publish && x.athlete_id) notifier.notify(notifier.usersOfAthletes([x.athlete_id]), 'feedback', `Your recap from ${p.title}`, x.recap_cue ? `Cue: ${x.recap_cue}` : '', `#/i/${x.token}`);
    return planView(db.prepare('SELECT * FROM plans WHERE id = ?').get(p.id));
  });
  /* Email invitation links, when email is set up. The links work either way. */
  r.post('/api/plans/:id/invite', ({ user, params, body }) => {
    const p = planRow(params.id, user);
    if (p.status === 'draft') db.prepare("UPDATE plans SET status = 'published', version = version + 1, updated_at = ? WHERE id = ?").run(now(), p.id);
    const ids = body.player_ids ? list(body.player_ids, 'player_ids', { max: MAX_PLAYERS, item: (x, f) => int(x, f, { min: 1, required: true }) }) : null;
    const targets = playersOf(p.id).filter(x => (!ids || ids.includes(x.id)));
    if (p.status === 'draft') targets.filter(x => x.athlete_id).forEach(x => notifyInvite(p, x.athlete_id, x.token));
    let sent = 0;
    if (ctx.mailer && ctx.mailer.enabled && config.publicUrl) {
      targets.filter(x => x.email).forEach(x => {
        const link = `${config.publicUrl}/#/i/${x.token}`;
        const when = p.starts_at ? new Date(p.starts_at).toUTCString().slice(0, 22) + ' UTC' : '';
        ctx.mailer.sendSoon({ to: x.email, subject: `You’re invited: ${p.title}`, text: `${p.title}\n${when}\n${p.location}\n\n${p.message}\n\nAnswer In, Out or Maybe here:\n${link}`, html: `<p><b>${p.title.replace(/</g, '&lt;')}</b><br>${when}<br>${p.location.replace(/</g, '&lt;')}</p><p><a href="${link}">Answer In, Out or Maybe</a></p>` });
        sent++;
      });
    }
    return { sent, mail: !!(ctx.mailer && ctx.mailer.enabled), plan: planView(db.prepare('SELECT * FROM plans WHERE id = ?').get(p.id)) };
  });
  /* Turn the plan into a live event: everyone who said In is registered. */
  r.post('/api/plans/:id/event', ({ user, params, body }) => {
    const p = planRow(params.id, user);
    if (p.event_id && db.prepare('SELECT 1 FROM events WHERE id = ?').get(p.event_id)) throw new HttpError(409, 'This plan already has a live event.', { event_id: p.event_id });
    if (!p.starts_at) throw new HttpError(400, 'Set the date and time first.');
    const { insertEvent, eventRow, addGuest, addAthlete } = ctx.play;
    const eventId = tx(db, () => {
      const id = insertEvent(user.id, {
        title: p.title, description: p.message, location: p.location, starts_at: p.starts_at, ends_at: p.ends_at, capacity: null,
        courts: int(body.courts, 'courts', { min: 1, max: 40 }) || Math.max(1, new Set(blocks(p.id).map(b => b.court).filter(Boolean)).size) || 2,
        format: 'round_robin', mode: body.mode ? oneOf(body.mode, ['rotate', 'race', 'premapped', 'unlucky', 'rivalry', 'fixed', 'draft3', 'fallout'], 'mode') : 'rotate',
        partner_mode: ['fixed', 'fallout'].includes(body.mode) ? 'fixed' : 'rotating', scoring: 'traditional', game_to: 11, round_limit: null, round_minutes: null, round_end: 'all',
        race_target: body.mode === 'race' ? 50 : null, elimination: 'single', registration_open: 0, show_roster: 1, status: 'published'
      });
      const e = eventRow(id);
      playersOf(p.id).filter(x => x.rsvp === 'in').forEach(x => {
        if (x.athlete_id) addAthlete(e, x.athlete_id, user.id);
        else addGuest(e, { name: x.name, email: x.email, phone: x.phone }, { state: 'registered', checkedIn: false, byUser: user.id });
      });
      db.prepare('UPDATE events SET plan_id = ? WHERE id = ?').run(p.id, id);
      db.prepare('UPDATE plans SET event_id = ?, updated_at = ? WHERE id = ?').run(id, now(), p.id);
      return id;
    });
    return withStatus(201, { event_id: eventId });
  });

  /* Saved groups and drills. */
  r.get('/api/plan-library', ({ user }) => {
    auth.require(user, 'coach');
    return db.prepare('SELECT id, kind, name, data, created_at FROM plan_library WHERE owner_id = ? ORDER BY kind, name').all(user.id).map(x => ({ ...x, data: JSON.parse(x.data) }));
  });
  r.post('/api/plan-library', ({ user, body }) => {
    auth.require(user, 'coach');
    const kind = oneOf(body.kind, ['group', 'drill'], 'kind');
    const name = str(body.name, 'name', { required: true, max: 80 });
    let data;
    if (kind === 'group') data = list(body.data, 'data', { max: MAX_PLAYERS, item: (x, f) => playerInput(user, x, f) }).map(({ court, ...x }) => x);
    else { const d = body.data || {}; data = { drill: str(d.drill, 'data.drill', { required: true, max: 120 }), instructions: str(d.instructions, 'data.instructions', { max: 2000 }) }; }
    const id = Number(db.prepare('INSERT INTO plan_library (owner_id, kind, name, data) VALUES (?, ?, ?, ?)').run(user.id, kind, name, JSON.stringify(data)).lastInsertRowid);
    return withStatus(201, { id, kind, name, data });
  });
  r.del('/api/plan-library/:id', ({ user, params }) => {
    auth.require(user, 'coach');
    db.prepare('DELETE FROM plan_library WHERE id = ? AND owner_id = ?').run(int(params.id, 'id', { min: 1, required: true }), user.id);
    return withStatus(204, null);
  });

  /* ---------- invitation page (public, one link per player) ---------- */
  function invite(t) {
    const x = db.prepare('SELECT * FROM plan_players WHERE token = ?').get(String(t));
    const p = x && db.prepare('SELECT * FROM plans WHERE id = ?').get(x.plan_id);
    if (!x || !p || p.status === 'draft') throw new HttpError(404, 'This invitation isn’t active. Ask your coach for a new link.');
    return { x, p };
  }
  function inviteView(x, p) {
    const n = rsvpCounts(p.id);
    return {
      plan: {
        title: p.title, starts_at: p.starts_at, ends_at: p.ends_at, timezone: p.timezone, location: p.location, sport: p.sport, coaches: p.coaches,
        message: p.message, agenda: p.agenda, status: p.status, capacity: p.capacity, blocks: blocks(p.id).map(({ id, ...b }) => b),
        counts: { in: n.in, waitlist: n.waitlist }, spots_left: p.capacity ? Math.max(0, p.capacity - n.in) : null
      },
      me: {
        name: x.name, rsvp: x.rsvp, court: x.court,
        recap: x.recap_published_at ? { observation: x.recap_observation, cue: x.recap_cue, next: x.recap_next, published_at: x.recap_published_at } : null
      }
    };
  }
  function promotePlan(p) {
    if (!p.capacity) return;
    const n = db.prepare("SELECT COUNT(*) AS n FROM plan_players WHERE plan_id = ? AND rsvp = 'in'").get(p.id).n;
    if (n >= p.capacity) return;
    const next = db.prepare("SELECT * FROM plan_players WHERE plan_id = ? AND rsvp = 'waitlist' ORDER BY rsvp_at, id LIMIT 1").get(p.id);
    if (!next) return;
    db.prepare("UPDATE plan_players SET rsvp = 'in', rsvp_at = ? WHERE id = ?").run(now(), next.id);
    if (next.athlete_id) notifier.notify(notifier.usersOfAthletes([next.athlete_id]), 'training', `You’re in: ${p.title}`, 'A spot opened up and you’ve moved off the waitlist.', `#/i/${next.token}`);
    if (next.email && ctx.mailer && ctx.mailer.enabled && config.publicUrl) ctx.mailer.sendSoon({ to: next.email, subject: `You’re in: ${p.title}`, text: `A spot opened up and you've moved off the waitlist.\n\n${config.publicUrl}/#/i/${next.token}` });
  }
  /* In when full puts the player on the waitlist; the oldest waiting player
     moves in when a spot opens. */
  function setRsvp(p, x, want, byCoach) {
    let rsvp = want;
    if (want === 'in' && x.rsvp !== 'in' && p.capacity && !byCoach) {
      const n = db.prepare("SELECT COUNT(*) AS n FROM plan_players WHERE plan_id = ? AND rsvp = 'in'").get(p.id).n;
      if (n >= p.capacity) rsvp = 'waitlist';
    }
    if (rsvp === x.rsvp) return rsvp;
    db.prepare('UPDATE plan_players SET rsvp = ?, rsvp_at = ? WHERE id = ?').run(rsvp, now(), x.id);
    if (x.rsvp === 'in' && rsvp !== 'in') promotePlan(p);
    return rsvp;
  }
  r.get('/api/i/:token', ({ params }) => { const { x, p } = invite(params.token); return inviteView(x, p); });
  r.post('/api/i/:token/rsvp', ({ params, body }) => {
    const { x, p } = invite(params.token);
    if (['done', 'cancelled'].includes(p.status)) throw new HttpError(409, p.status === 'cancelled' ? 'This session was cancelled.' : 'This session has already happened.');
    const want = oneOf(body.rsvp, ['in', 'out', 'maybe'], 'rsvp');
    tx(db, () => setRsvp(p, x, want, false));
    const fresh = db.prepare('SELECT * FROM plan_players WHERE id = ?').get(x.id);
    return inviteView(fresh, db.prepare('SELECT * FROM plans WHERE id = ?').get(p.id));
  });
};
module.exports.KINDS = KINDS;
