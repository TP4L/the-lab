'use strict';
const crypto = require('node:crypto');
const { HttpError, withStatus, str, oneOf, int, uuid, isoTime, list } = require('../http.js');
const { tx, now } = require('../db.js');
const { prefsOf } = require('./notify.js');

const KINDS = ['casual', 'training', 'competition'];
const FORMATS = ['round_robin', 'open_play', 'clinic'];
const LABEL = { scheduled: 'Scheduled', recorded: 'Self-recorded', confirmed: 'Opponent-confirmed', verified: 'Organizer-verified', disputed: 'Disputed' };
const playerId = id => 'LAB-' + String(id).padStart(5, '0');
const parsePlayerId = s => { const m = /^LAB-?0*(\d{1,9})$/i.exec(String(s || '').trim()); return m ? Number(m[1]) : null; };

/* Winner is the team that won more games. */
function decide(games) {
  let a = 0, b = 0;
  games.forEach(([x, y]) => { if (x > y) a++; else if (y > x) b++; });
  return a > b ? 1 : b > a ? 2 : null;
}

module.exports = function play(r, { db, auth, notifier }) {
  const { notify, usersOfAthletes } = notifier;

  /* ---------- shared lookups ---------- */
  function matchRow(id) { return db.prepare('SELECT * FROM matches WHERE id = ?').get(id); }
  function players(matchId) {
    return db.prepare(`SELECT mp.team, mp.slot, mp.athlete_id, mp.guest_name, mp.side, a.name, a.user_id
      FROM match_players mp LEFT JOIN athletes a ON a.id = mp.athlete_id WHERE mp.match_id = ? ORDER BY mp.team, mp.slot`).all(matchId);
  }
  function games(matchId) { return db.prepare('SELECT team1, team2 FROM match_games WHERE match_id = ? ORDER BY idx').all(matchId).map(g => [g.team1, g.team2]); }
  function eventOf(m) { return m && m.event_id ? db.prepare('SELECT * FROM events WHERE id = ?').get(m.event_id) : null; }
  function isOrganizer(user, ev) { return !!user && !!ev && (ev.organizer_id === user.id || user.roles.includes('admin')); }

  /* Organizer of the event, a coach of any athlete in the match, or an admin. */
  function canVerify(user, m, ps) {
    if (!user) return false;
    if (user.roles.includes('admin')) return true;
    if (isOrganizer(user, eventOf(m))) return true;
    return ps.some(p => p.athlete_id && auth.coachesAthlete(user, p.athlete_id));
  }
  function myTeam(user, ps) {
    const mine = auth.ownAthleteId(user);
    const p = mine && ps.find(x => x.athlete_id === mine);
    return p ? p.team : null;
  }
  function canRead(user, m, ps) {
    if (!user) return false;
    if (m.recorded_by === user.id || myTeam(user, ps) || canVerify(user, m, ps)) return true;
    if (m.event_id) {
      const mine = auth.ownAthleteId(user);
      const ev = eventOf(m);
      if (ev && ev.status !== 'draft') return true; // event scores are visible to signed-in members
      return !!(mine && db.prepare('SELECT 1 FROM event_people WHERE event_id = ? AND athlete_id = ?').get(m.event_id, mine));
    }
    return false;
  }
  function full(id, user) {
    const m = matchRow(id);
    const ps = players(id);
    const log = db.prepare(`SELECT l.action, l.note, l.created_at, u.name AS by FROM match_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.match_id = ? ORDER BY l.id`).all(id);
    const team = user ? myTeam(user, ps) : null;
    const recorderTeam = (() => { const rp = ps.find(p => p.user_id && p.user_id === m.recorded_by); return rp ? rp.team : null; })();
    return {
      ...m, status_label: LABEL[m.status], games: games(id), log,
      players: ps.map(p => ({ team: p.team, slot: p.slot, side: p.side, athlete_id: p.athlete_id, player_id: p.athlete_id ? playerId(p.athlete_id) : null, name: p.athlete_id ? p.name : p.guest_name, guest: !p.athlete_id })),
      you: user ? {
        team,
        can_confirm: !!team && m.status !== 'scheduled' && m.status !== 'verified' && m.recorded_by !== user.id && (recorderTeam === null || recorderTeam !== team),
        can_verify: m.status !== 'scheduled' && canVerify(user, m, ps),
        can_edit: m.recorded_by === user.id || canVerify(user, m, ps) || (!!m.event_id && !!team && m.status === 'scheduled')
      } : null
    };
  }
  function participantsUsers(ps, exceptUserId) { return ps.filter(p => p.user_id && p.user_id !== exceptUserId).map(p => p.user_id); }
  function log(matchId, userId, action, note = '', snapshot = null) {
    db.prepare('INSERT INTO match_log (match_id, user_id, action, note, snapshot) VALUES (?, ?, ?, ?, ?)').run(matchId, userId, action, note, snapshot ? JSON.stringify(snapshot) : null);
  }

  /* ---------- match input ---------- */
  function gamesInput(v, bestOf) {
    const gs = list(v, 'games', { max: 5, item: (g, f) => {
      if (!Array.isArray(g) || g.length !== 2) throw new HttpError(400, `${f} must be [team1, team2].`);
      const a = int(g[0], `${f}[0]`, { min: 0, max: 99, required: true }), b = int(g[1], `${f}[1]`, { min: 0, max: 99, required: true });
      if (a === b) throw new HttpError(400, `Game ${Number(f.match(/\d+/)[0]) + 1} is tied. Every game needs a winner.`);
      return [a, b];
    } });
    if (!gs.length) throw new HttpError(400, 'Enter at least one game score.');
    if (gs.length > bestOf) throw new HttpError(400, `Best of ${bestOf} can’t have ${gs.length} games.`);
    if (!decide(gs)) throw new HttpError(400, 'The games are split evenly. Enter the deciding game.');
    return gs;
  }
  function resolvePlayer(user, p, f) {
    if (!p || typeof p !== 'object') throw new HttpError(400, `${f} must be an object.`);
    const side = oneOf(p.side || '', ['', 'left', 'right'], `${f}.side`);
    if (p.athlete_id) {
      const id = int(p.athlete_id, `${f}.athlete_id`, { min: 1, required: true });
      if (!auth.athleteAccess(user, id)) throw new HttpError(400, `${f}: use a player ID for athletes you don’t coach.`);
      return { athlete_id: id, guest_name: '', side };
    }
    if (p.player_id) {
      const id = parsePlayerId(p.player_id);
      if (!id || !db.prepare('SELECT 1 FROM athletes WHERE id = ?').get(id)) throw new HttpError(400, `${f}: no player with ID ${p.player_id}.`);
      return { athlete_id: id, guest_name: '', side };
    }
    return { athlete_id: null, guest_name: str(p.guest_name, `${f}.guest_name`, { required: true, max: 60 }), side };
  }
  function matchInput(user, b) {
    const bestOf = Number(oneOf(String(b.best_of || 1), ['1', '3', '5'], 'best_of'));
    const out = {
      kind: oneOf(b.kind || 'casual', KINDS, 'kind'),
      game_to: int(b.game_to || 11, 'game_to', { min: 5, max: 30 }),
      win_by: int(b.win_by || 2, 'win_by', { min: 1, max: 2 }),
      best_of: bestOf,
      played_at: isoTime(b.played_at, 'played_at') || now(),
      note: str(b.note, 'note', { max: 500 }),
      games: gamesInput(b.games, bestOf)
    };
    const teams = list(b.teams, 'teams', { max: 2 });
    if (teams.length !== 2) throw new HttpError(400, 'A match has two teams.');
    out.teams = teams.map((t, ti) => list(t, `teams[${ti}]`, { max: 2, item: (p, f) => resolvePlayer(user, p, f) }));
    if (!out.teams[0].length || out.teams[0].length !== out.teams[1].length) throw new HttpError(400, 'Teams need the same number of players: 1 for singles, 2 for doubles.');
    const ids = out.teams.flat().map(p => p.athlete_id).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'The same player is listed twice.');
    // You record matches you played in, or for athletes you coach.
    const mine = auth.ownAthleteId(user);
    if (!ids.includes(mine) && !ids.some(id => auth.coachesAthlete(user, id))) throw new HttpError(403, 'Record matches you played in, or for athletes you coach.');
    return out;
  }
  function fingerprint(teams, gs) {
    const side = t => t.map(p => p.athlete_id ? 'a' + p.athlete_id : 'g' + p.guest_name.toLowerCase()).sort().join('+');
    const [x, y] = [side(teams[0]), side(teams[1])];
    const g = x < y ? gs.map(v => v.join('-')) : gs.map(v => [v[1], v[0]].join('-'));
    return [x, y].sort().join(' v ') + ' ' + g.join(',');
  }
  function findDuplicate(inp, exceptId) {
    const fp = fingerprint(inp.teams, inp.games);
    const t = new Date(inp.played_at).getTime();
    const near = db.prepare(`SELECT id, played_at FROM matches WHERE id != ? AND event_id IS NULL AND played_at BETWEEN ? AND ?`)
      .all(exceptId || '', new Date(t - 12 * 3600e3).toISOString(), new Date(t + 12 * 3600e3).toISOString());
    for (const m of near) {
      const ps = players(m.id);
      const teams = [1, 2].map(tn => ps.filter(p => p.team === tn).map(p => ({ athlete_id: p.athlete_id, guest_name: p.guest_name })));
      if (fingerprint(teams, games(m.id)) === fp) return m.id;
    }
    return null;
  }
  function writePlayersGames(id, inp) {
    db.prepare('DELETE FROM match_players WHERE match_id = ?').run(id);
    db.prepare('DELETE FROM match_games WHERE match_id = ?').run(id);
    inp.teams.forEach((t, ti) => t.forEach((p, pi) => db.prepare('INSERT INTO match_players (match_id, team, slot, athlete_id, guest_name, side) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, ti + 1, pi + 1, p.athlete_id, p.guest_name, p.side)));
    inp.games.forEach((g, i) => db.prepare('INSERT INTO match_games (match_id, idx, team1, team2) VALUES (?, ?, ?, ?)').run(id, i, g[0], g[1]));
  }
  function snapshot(id) { return { match: matchRow(id), players: players(id).map(({ name, user_id, ...p }) => p), games: games(id) }; }

  /* ---------- matches ---------- */
  r.post('/api/matches', ({ user, body }) => {
    auth.require(user);
    const id = uuid(body.id, 'id');
    const prior = matchRow(id);
    if (prior) {
      if (prior.recorded_by !== user.id) throw new HttpError(409, 'Match ID already used.');
      return withStatus(200, full(id, user)); // offline retry
    }
    const inp = matchInput(user, body);
    if (!body.confirm_duplicate) {
      const dup = findDuplicate(inp);
      if (dup) throw new HttpError(409, 'This looks like a match that’s already recorded: same players and scores on the same day.', { duplicate_of: dup });
    }
    let sessionId = null;
    if (body.session_id) {
      sessionId = uuid(body.session_id, 'session_id');
      const sess = db.prepare('SELECT coach_id FROM training_sessions WHERE id = ?').get(sessionId);
      const mine = auth.ownAthleteId(user);
      if (!sess || !(sess.coach_id === user.id || (mine && db.prepare('SELECT 1 FROM training_athletes WHERE session_id = ? AND athlete_id = ?').get(sessionId, mine)))) throw new HttpError(400, 'You can only link matches to sessions you ran or played in.');
    }
    const probe = { event_id: null };
    const ownId = auth.ownAthleteId(user);
    const playing = !!ownId && inp.teams.flat().some(p => p.athlete_id === ownId);
    const status = canVerify(user, probe, inp.teams.flat().map(p => ({ athlete_id: p.athlete_id }))) && !playing ? 'verified' : 'recorded';
    tx(db, () => {
      db.prepare(`INSERT INTO matches (id, recorded_by, kind, game_to, win_by, best_of, played_at, status, winner, note, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, user.id, inp.kind, inp.game_to, inp.win_by, inp.best_of, inp.played_at, status, decide(inp.games), inp.note, sessionId);
      writePlayersGames(id, inp);
      log(id, user.id, 'recorded');
    });
    const ps = players(id);
    notify(participantsUsers(ps, user.id), 'matches', `${user.name} recorded a match with you`, 'Check the score and confirm it, or dispute it.', `#/play/match/${id}`);
    return withStatus(201, full(id, user));
  });

  r.get('/api/matches', ({ user, query }) => {
    auth.require(user);
    const aid = query.get('athlete_id') ? int(query.get('athlete_id'), 'athlete_id', { min: 1 }) : auth.ownAthleteId(user);
    if (query.get('athlete_id') && !auth.athleteAccess(user, aid)) throw new HttpError(404, 'Athlete not found.');
    const ids = aid ? db.prepare(`SELECT DISTINCT m.id FROM matches m JOIN match_players mp ON mp.match_id = m.id
        WHERE mp.athlete_id = ? AND m.status != 'scheduled' ORDER BY m.played_at DESC LIMIT 100`).all(aid).map(r => r.id)
      : db.prepare(`SELECT id FROM matches WHERE recorded_by = ? ORDER BY played_at DESC LIMIT 100`).all(user.id).map(r => r.id);
    return ids.map(id => {
      const m = full(id, user);
      const me = m.players.find(p => p.athlete_id === aid);
      return { ...m, result: me ? (m.winner === me.team ? 'W' : 'L') : null, perspective_team: me ? me.team : null };
    });
  });

  r.get('/api/matches/:id', ({ user, params }) => {
    auth.require(user);
    const m = matchRow(uuid(params.id, 'id'));
    if (!m || !canRead(user, m, players(m.id))) throw new HttpError(404, 'Match not found.');
    return full(m.id, user);
  });

  /* Correction. Keeps the old version in the log and asks for re-confirmation. */
  r.put('/api/matches/:id', ({ user, params, body }) => {
    auth.require(user);
    const m = matchRow(uuid(params.id, 'id'));
    const ps = m && players(m.id);
    if (!m || !canRead(user, m, ps)) throw new HttpError(404, 'Match not found.');
    const verifier = canVerify(user, m, ps);
    const inEventMatch = !!m.event_id && !!myTeam(user, ps);
    if (m.recorded_by !== user.id && !verifier && !inEventMatch) throw new HttpError(403, 'Only the person who recorded this match or an organizer can correct it.');
    const version = int(body.version, 'version', { min: 1, required: true });
    if (version !== m.version) throw new HttpError(409, 'This match changed since you opened it. Review the latest score.', { current: full(m.id, user) });
    const reason = m.status === 'scheduled' ? str(body.reason, 'reason', { max: 300 }) : str(body.reason, 'reason', { required: true, max: 300 });
    let inp;
    if (m.event_id) {
      // Event matches keep their players and format; only the score changes.
      inp = { games: gamesInput(body.games, m.best_of), teams: [1, 2].map(t => ps.filter(p => p.team === t).map(p => ({ athlete_id: p.athlete_id, guest_name: p.guest_name, side: p.side }))), note: m.note, played_at: m.played_at, kind: m.kind, game_to: m.game_to, win_by: m.win_by, best_of: m.best_of };
    } else {
      inp = matchInput(user, { ...body, kind: body.kind || m.kind });
      const dup = !body.confirm_duplicate && findDuplicate(inp, m.id);
      if (dup) throw new HttpError(409, 'That correction matches another recorded match.', { duplicate_of: dup });
    }
    const status = verifier ? 'verified' : 'recorded';
    const first = m.status === 'scheduled';
    tx(db, () => {
      log(m.id, user.id, first ? 'scored' : 'corrected', reason, first ? null : snapshot(m.id));
      db.prepare(`UPDATE matches SET kind = ?, game_to = ?, win_by = ?, best_of = ?, played_at = ?, note = ?, status = ?, winner = ?, version = version + 1, updated_at = ? WHERE id = ?`)
        .run(inp.kind, inp.game_to, inp.win_by, inp.best_of, first ? now() : inp.played_at, inp.note, status, decide(inp.games), now(), m.id);
      writePlayersGames(m.id, inp);
      if (first) db.prepare('UPDATE matches SET recorded_by = ? WHERE id = ?').run(user.id, m.id);
    });
    if (m.round_id) closeRoundIfScored(m.round_id);
    const after = players(m.id);
    if (status !== 'verified') notify(participantsUsers(after, user.id), 'matches', first ? `${user.name} entered your score` : `${user.name} corrected a match score`, first ? 'Confirm it, or dispute it.' : (reason ? `Reason: ${reason}. ` : '') + 'Please confirm the new score.', `#/play/match/${m.id}`);
    return full(m.id, user);
  });

  function transition(user, id, action, check) {
    auth.require(user);
    const m = matchRow(uuid(id, 'id'));
    const ps = m && players(m.id);
    if (!m || !canRead(user, m, ps)) throw new HttpError(404, 'Match not found.');
    const view = full(m.id, user);
    check(view);
    return { m, ps };
  }
  r.post('/api/matches/:id/confirm', ({ user, params }) => {
    const { m } = transition(user, params.id, 'confirm', v => { if (!v.you.can_confirm) throw new HttpError(403, 'Only a player on the other team can confirm this score.'); });
    tx(db, () => { db.prepare("UPDATE matches SET status = 'confirmed', version = version + 1, updated_at = ? WHERE id = ?").run(now(), m.id); log(m.id, user.id, 'confirmed'); });
    return full(m.id, user);
  });
  r.post('/api/matches/:id/dispute', ({ user, params, body }) => {
    const { m } = transition(user, params.id, 'dispute', v => { if (!v.you.can_confirm && !v.you.team) throw new HttpError(403, 'Only players in this match can dispute it.'); });
    const note = str(body.note, 'note', { required: true, max: 300 });
    tx(db, () => { db.prepare("UPDATE matches SET status = 'disputed', version = version + 1, updated_at = ? WHERE id = ?").run(now(), m.id); log(m.id, user.id, 'disputed', note); });
    notify([m.recorded_by], 'matches', `${user.name} disputed a match score`, note, `#/play/match/${m.id}`);
    return full(m.id, user);
  });
  r.post('/api/matches/:id/verify', ({ user, params }) => {
    const { m, ps } = transition(user, params.id, 'verify', v => { if (!v.you.can_verify) throw new HttpError(403, 'Only an organizer or the players’ coach can verify.'); });
    tx(db, () => { db.prepare("UPDATE matches SET status = 'verified', version = version + 1, updated_at = ? WHERE id = ?").run(now(), m.id); log(m.id, user.id, 'verified'); });
    notify(participantsUsers(ps, user.id), 'matches', 'A match score was verified', '', `#/play/match/${m.id}`);
    return full(m.id, user);
  });
  r.del('/api/matches/:id', ({ user, params }) => {
    auth.require(user);
    const m = matchRow(uuid(params.id, 'id'));
    const ps = m && players(m.id);
    if (!m || !canRead(user, m, ps)) throw new HttpError(404, 'Match not found.');
    if (m.event_id) throw new HttpError(400, 'Event matches are managed by the organizer.');
    const verifier = canVerify(user, m, ps);
    if (!verifier && !(m.recorded_by === user.id && m.status === 'recorded')) throw new HttpError(403, 'Once confirmed, only an organizer or coach can delete a match.');
    db.prepare('DELETE FROM matches WHERE id = ?').run(m.id);
    return withStatus(204, null);
  });

  /* ---------- player check-in code (QR on the player card) ---------- */
  r.get('/api/me/checkin', ({ user }) => {
    auth.require(user);
    const aid = auth.ownAthleteId(user);
    if (!aid) throw new HttpError(404, 'Set up your athlete profile first.');
    let code = db.prepare('SELECT checkin_code FROM athletes WHERE id = ?').get(aid).checkin_code;
    if (!code) { code = crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, 'x').slice(0, 10).toUpperCase(); db.prepare('UPDATE athletes SET checkin_code = ? WHERE id = ?').run(code, aid); }
    return { player_id: playerId(aid), code, qr: 'THELAB:' + code };
  });

  /* ---------- events ---------- */
  function eventRow(id) { const e = db.prepare('SELECT * FROM events WHERE id = ?').get(id); if (!e) throw new HttpError(404, 'Event not found.'); return e; }
  function eventVisible(user, e) { return e.status !== 'draft' || isOrganizer(user, e); }
  function eventInput(b, cur = {}) {
    const v = (k, fn) => (b[k] === undefined ? cur[k] : fn(b[k]));
    const out = {
      title: v('title', x => str(x, 'title', { required: true, max: 120 })),
      description: v('description', x => str(x, 'description', { max: 4000 })) || '',
      location: v('location', x => str(x, 'location', { max: 200 })) || '',
      starts_at: v('starts_at', x => isoTime(x, 'starts_at', { allowEmpty: false })),
      ends_at: v('ends_at', x => isoTime(x, 'ends_at')) || null,
      capacity: v('capacity', x => int(x, 'capacity', { min: 2, max: 500 })) || null,
      courts: v('courts', x => int(x, 'courts', { min: 1, max: 40, required: true })) || 2,
      format: v('format', x => oneOf(x, FORMATS, 'format')) || 'round_robin',
      game_to: v('game_to', x => int(x, 'game_to', { min: 5, max: 30, required: true })) || 11,
      status: v('status', x => oneOf(x, ['draft', 'published', 'live', 'complete', 'cancelled'], 'status')) || 'draft'
    };
    if (!out.title || !out.starts_at) throw new HttpError(400, 'title and starts_at are required.');
    return out;
  }
  function people(eventId) {
    return db.prepare(`SELECT ep.*, a.name, a.side AS preferred_side, a.user_id FROM event_people ep JOIN athletes a ON a.id = ep.athlete_id
      WHERE ep.event_id = ? ORDER BY ep.state, ep.created_at`).all(eventId);
  }
  function standings(eventId) {
    const rows = {};
    db.prepare("SELECT id, winner FROM matches WHERE event_id = ? AND status NOT IN ('scheduled','disputed')").all(eventId).forEach(m => {
      const gs = games(m.id);
      const pf = [0, 0]; gs.forEach(([a, b]) => { pf[0] += a; pf[1] += b; });
      players(m.id).forEach(p => {
        if (!p.athlete_id) return;
        const s = rows[p.athlete_id] = rows[p.athlete_id] || { athlete_id: p.athlete_id, name: p.name, played: 0, wins: 0, losses: 0, points_for: 0, points_against: 0 };
        s.played++; if (m.winner === p.team) s.wins++; else s.losses++;
        s.points_for += pf[p.team - 1]; s.points_against += pf[2 - p.team];
      });
    });
    return Object.values(rows).map(s => ({ ...s, diff: s.points_for - s.points_against }))
      .sort((a, b) => b.wins - a.wins || b.diff - a.diff || a.name.localeCompare(b.name));
  }
  function roundsOf(eventId, user) {
    return db.prepare('SELECT * FROM rounds WHERE event_id = ? ORDER BY number').all(eventId).map(rd => ({
      ...rd, sitting_out: JSON.parse(rd.sitting_out).map(id => ({ athlete_id: id, name: (db.prepare('SELECT name FROM athletes WHERE id = ?').get(id) || {}).name })),
      matches: db.prepare('SELECT id FROM matches WHERE round_id = ? ORDER BY court').all(rd.id).map(m => full(m.id, user))
    }));
  }
  function eventFull(e, user) {
    const mine = auth.ownAthleteId(user);
    const ps = people(e.id);
    const org = isOrganizer(user, e);
    const me = ps.find(p => p.athlete_id === mine);
    return {
      ...e, organizer: org, organizer_name: (db.prepare('SELECT name FROM users WHERE id = ?').get(e.organizer_id) || {}).name,
      me: me ? { state: me.state, checked_in: !!me.checked_in_at, active: !!me.active } : null,
      counts: { registered: ps.filter(p => p.state === 'registered').length, waitlist: ps.filter(p => p.state === 'waitlist').length, interested: ps.filter(p => p.state === 'interested').length, checked_in: ps.filter(p => p.checked_in_at).length },
      people: ps.filter(p => p.state !== 'withdrawn' && (org || p.state === 'registered')).map(p => ({ athlete_id: p.athlete_id, name: p.name, state: p.state, checked_in: !!p.checked_in_at, active: !!p.active, player_id: org ? playerId(p.athlete_id) : undefined })),
      rounds: roundsOf(e.id, user),
      standings: standings(e.id)
    };
  }

  r.get('/api/events', ({ user }) => {
    auth.require(user);
    const mine = auth.ownAthleteId(user) || -1;
    return db.prepare(`SELECT e.*, (SELECT state FROM event_people WHERE event_id = e.id AND athlete_id = ?) AS my_state,
        (SELECT COUNT(*) FROM event_people WHERE event_id = e.id AND state = 'registered') AS registered
      FROM events e WHERE e.status != 'draft' OR e.organizer_id = ? OR ? ORDER BY e.starts_at DESC LIMIT 200`)
      .all(mine, user.id, user.roles.includes('admin') ? 1 : 0);
  });
  r.post('/api/events', ({ user, body }) => {
    auth.require(user, 'coach');
    const e = eventInput(body);
    const id = Number(db.prepare(`INSERT INTO events (organizer_id, title, description, location, starts_at, ends_at, capacity, courts, format, game_to, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, e.title, e.description, e.location, e.starts_at, e.ends_at, e.capacity, e.courts, e.format, e.game_to, e.status).lastInsertRowid);
    return withStatus(201, eventFull(eventRow(id), user));
  });
  r.get('/api/events/:id', ({ user, params }) => {
    auth.require(user);
    const e = eventRow(int(params.id, 'id', { min: 1, required: true }));
    if (!eventVisible(user, e)) throw new HttpError(404, 'Event not found.');
    return eventFull(e, user);
  });
  r.put('/api/events/:id', ({ user, params, body }) => {
    auth.require(user);
    const e = eventRow(int(params.id, 'id', { min: 1, required: true }));
    if (!isOrganizer(user, e)) throw new HttpError(404, 'Event not found.');
    const f = eventInput(body, e);
    db.prepare(`UPDATE events SET title = ?, description = ?, location = ?, starts_at = ?, ends_at = ?, capacity = ?, courts = ?, format = ?, game_to = ?, status = ?, updated_at = ? WHERE id = ?`)
      .run(f.title, f.description, f.location, f.starts_at, f.ends_at, f.capacity, f.courts, f.format, f.game_to, f.status, now(), e.id);
    if (f.status === 'cancelled' && e.status !== 'cancelled') {
      notify(usersOfAthletes(people(e.id).filter(p => p.state !== 'withdrawn').map(p => p.athlete_id)), 'events', `${e.title} was cancelled`, '', `#/play/events/${e.id}`);
    }
    return eventFull(eventRow(e.id), user);
  });

  /* Registration by the athlete. Capacity overflow goes to a waitlist. */
  function setState(user, eventId, want) {
    auth.require(user);
    const e = eventRow(int(eventId, 'id', { min: 1, required: true }));
    if (!eventVisible(user, e) || ['complete', 'cancelled'].includes(e.status)) throw new HttpError(409, 'This event isn’t open for sign-ups.');
    const aid = auth.ownAthleteId(user);
    if (!aid) throw new HttpError(400, 'Set up your athlete profile first (Profile tab).');
    const cur = db.prepare('SELECT * FROM event_people WHERE event_id = ? AND athlete_id = ?').get(e.id, aid);
    let state = want;
    tx(db, () => {
      if (want === 'registered') {
        if (cur && cur.state === 'registered') return;
        const n = db.prepare("SELECT COUNT(*) AS n FROM event_people WHERE event_id = ? AND state = 'registered'").get(e.id).n;
        if (e.capacity && n >= e.capacity) state = 'waitlist';
      }
      db.prepare(`INSERT INTO event_people (event_id, athlete_id, state) VALUES (?, ?, ?)
        ON CONFLICT(event_id, athlete_id) DO UPDATE SET state = excluded.state`).run(e.id, aid, state);
      if (want === 'withdrawn' && cur && cur.state === 'registered') promoteWaitlist(e);
    });
    return eventFull(eventRow(e.id), user);
  }
  function promoteWaitlist(e) {
    const next = db.prepare("SELECT athlete_id FROM event_people WHERE event_id = ? AND state = 'waitlist' ORDER BY created_at LIMIT 1").get(e.id);
    if (!next) return;
    db.prepare("UPDATE event_people SET state = 'registered' WHERE event_id = ? AND athlete_id = ?").run(e.id, next.athlete_id);
    notify(usersOfAthletes([next.athlete_id]), 'events', `You’re in: ${e.title}`, 'A spot opened up and you’ve moved off the waitlist.', `#/play/events/${e.id}`);
  }
  r.post('/api/events/:id/interest', ({ user, params }) => setState(user, params.id, 'interested'));
  r.post('/api/events/:id/register', ({ user, params }) => setState(user, params.id, 'registered'));
  r.post('/api/events/:id/withdraw', ({ user, params }) => setState(user, params.id, 'withdrawn'));

  function organizerEvent(user, id) {
    auth.require(user);
    const e = eventRow(int(id, 'id', { min: 1, required: true }));
    if (!isOrganizer(user, e)) throw new HttpError(404, 'Event not found.');
    return e;
  }
  /* Check-in by scanning the player's QR (THELAB:<code>), their player ID, or athlete_id. */
  r.post('/api/events/:id/checkin', ({ user, params, body }) => {
    const e = organizerEvent(user, params.id);
    let aid = null;
    const raw = String(body.code || '').trim();
    if (body.athlete_id) aid = int(body.athlete_id, 'athlete_id', { min: 1 });
    else if (/^THELAB:/i.test(raw) || /^[A-Z0-9]{10}$/i.test(raw)) {
      const row = db.prepare('SELECT id FROM athletes WHERE checkin_code = ?').get(raw.replace(/^THELAB:/i, '').toUpperCase());
      aid = row && row.id;
    } else aid = parsePlayerId(raw);
    if (!aid || !db.prepare('SELECT 1 FROM athletes WHERE id = ?').get(aid)) throw new HttpError(404, 'No player matches that code.');
    const t = now();
    // Walk-ins are registered on the spot; the organizer is in control.
    db.prepare(`INSERT INTO event_people (event_id, athlete_id, state, checked_in_at, active) VALUES (?, ?, 'registered', ?, 1)
      ON CONFLICT(event_id, athlete_id) DO UPDATE SET state = 'registered', checked_in_at = COALESCE(checked_in_at, excluded.checked_in_at), active = 1`).run(e.id, aid, t);
    const name = db.prepare('SELECT name FROM athletes WHERE id = ?').get(aid).name;
    notify(usersOfAthletes([aid]), 'events', `Checked in: ${e.title}`, 'You’ll be notified when you’re on a court.', `#/play/events/${e.id}`);
    return { checked_in: { athlete_id: aid, name }, event: eventFull(eventRow(e.id), user) };
  });
  /* Late arrival / early departure: active players are scheduled, inactive ones aren't. */
  r.put('/api/events/:id/people/:aid', ({ user, params, body }) => {
    const e = organizerEvent(user, params.id);
    const aid = int(params.aid, 'aid', { min: 1, required: true });
    const cur = db.prepare('SELECT * FROM event_people WHERE event_id = ? AND athlete_id = ?').get(e.id, aid);
    if (!cur) throw new HttpError(404, 'That player isn’t in this event.');
    if (body.active !== undefined) db.prepare('UPDATE event_people SET active = ? WHERE event_id = ? AND athlete_id = ?').run(body.active ? 1 : 0, e.id, aid);
    if (body.state !== undefined) {
      const st = oneOf(body.state, ['registered', 'waitlist', 'withdrawn'], 'state');
      db.prepare('UPDATE event_people SET state = ? WHERE event_id = ? AND athlete_id = ?').run(st, e.id, aid);
      if (st === 'withdrawn' && cur.state === 'registered') promoteWaitlist(e);
    }
    return eventFull(eventRow(e.id), user);
  });

  /* ---------- round robin: rolling, one round at a time ----------
     Built from whoever is checked in and active right now, so late arrivals
     join the next round and early departures drop out of it. Players who've
     played least go first; groupings minimise repeat partners, then repeat
     opponents; sides alternate unless preferences settle it. */
  function history(eventId) {
    const h = { partner: {}, opp: {}, played: {}, right: {}, sat: {} };
    const key = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
    db.prepare('SELECT id FROM matches WHERE event_id = ?').all(eventId).forEach(m => {
      const ps = players(m.id).filter(p => p.athlete_id);
      ps.forEach(p => { h.played[p.athlete_id] = (h.played[p.athlete_id] || 0) + 1; if (p.side === 'right') h.right[p.athlete_id] = (h.right[p.athlete_id] || 0) + 1; });
      ps.forEach(a => ps.forEach(b => {
        if (a.athlete_id >= b.athlete_id) return;
        const bucket = a.team === b.team ? h.partner : h.opp;
        bucket[key(a.athlete_id, b.athlete_id)] = (bucket[key(a.athlete_id, b.athlete_id)] || 0) + 1;
      }));
    });
    db.prepare('SELECT sitting_out FROM rounds WHERE event_id = ?').all(eventId).forEach(rd => JSON.parse(rd.sitting_out).forEach(id => { h.sat[id] = (h.sat[id] || 0) + 1; }));
    h.key = key;
    return h;
  }
  function buildRound(pool, courts, h, rand) {
    const c = Math.min(courts, Math.floor(pool.length / 4));
    // Fewest games first, then most sit-outs, then random.
    const order = pool.map(p => ({ p, r: rand() })).sort((a, b) => (h.played[a.p.athlete_id] || 0) - (h.played[b.p.athlete_id] || 0) || (h.sat[b.p.athlete_id] || 0) - (h.sat[a.p.athlete_id] || 0) || a.r - b.r).map(x => x.p);
    const playing = order.slice(0, c * 4), sitting = order.slice(c * 4);
    const pc = (a, b) => h.partner[h.key(a, b)] || 0, oc = (a, b) => h.opp[h.key(a, b)] || 0;
    const groupCost = g => {
      // Best of the three ways to split four players into two teams.
      const splits = [[[g[0], g[1]], [g[2], g[3]]], [[g[0], g[2]], [g[1], g[3]]], [[g[0], g[3]], [g[1], g[2]]]];
      let best = null;
      splits.forEach(([t1, t2]) => {
        const cost = 10 * (pc(t1[0].athlete_id, t1[1].athlete_id) + pc(t2[0].athlete_id, t2[1].athlete_id)) +
          2 * [t1[0], t1[1]].reduce((s, a) => s + oc(a.athlete_id, t2[0].athlete_id) + oc(a.athlete_id, t2[1].athlete_id), 0);
        if (!best || cost < best.cost) best = { cost, teams: [t1, t2] };
      });
      return best;
    };
    let best = null;
    for (let trial = 0; trial < 400; trial++) {
      const s = playing.slice();
      for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; }
      const groups = []; let cost = 0;
      for (let i = 0; i < s.length; i += 4) { const g = groupCost(s.slice(i, i + 4)); cost += g.cost; groups.push(g.teams); }
      if (!best || cost < best.cost) best = { cost, groups };
      if (cost === 0) break;
    }
    const sides = team => {
      const [a, b] = team;
      const pref = p => p.preferred_side;
      if (pref(a) === 'left' && pref(b) !== 'left') return [[a, 'left'], [b, 'right']];
      if (pref(a) === 'right' && pref(b) !== 'right') return [[a, 'right'], [b, 'left']];
      if (pref(b) === 'left') return [[a, 'right'], [b, 'left']];
      if (pref(b) === 'right') return [[a, 'left'], [b, 'right']];
      return (h.right[a.athlete_id] || 0) <= (h.right[b.athlete_id] || 0) ? [[a, 'right'], [b, 'left']] : [[a, 'left'], [b, 'right']];
    };
    return { courts: (best ? best.groups : []).map(teams => teams.map(sides)), sitting };
  }

  r.post('/api/events/:id/rounds', ({ user, params, body }) => {
    const e = organizerEvent(user, params.id);
    const open = db.prepare("SELECT number FROM rounds WHERE event_id = ? AND status = 'live'").get(e.id);
    if (open && !body.force) throw new HttpError(409, `Round ${open.number} still has matches without scores. Finish it, or start the next round anyway.`);
    const pool = people(e.id).filter(p => p.state === 'registered' && p.checked_in_at && p.active);
    if (pool.length < 4) throw new HttpError(400, `Need at least 4 checked-in, active players. ${pool.length} now.`);
    const seed = body.seed === undefined ? crypto.randomInt(1e9) : int(body.seed, 'seed', { min: 0 });
    let st = seed; const rand = () => { st = (st * 1103515245 + 12345) % 2147483648; return st / 2147483648; };
    const plan = buildRound(pool, e.courts, history(e.id), rand);
    const number = (db.prepare('SELECT MAX(number) AS n FROM rounds WHERE event_id = ?').get(e.id).n || 0) + 1;
    const ids = [];
    tx(db, () => {
      if (open) db.prepare("UPDATE rounds SET status = 'done' WHERE event_id = ? AND status = 'live'").run(e.id);
      if (e.status === 'published' || e.status === 'draft') db.prepare("UPDATE events SET status = 'live', updated_at = ? WHERE id = ?").run(now(), e.id);
      const roundId = Number(db.prepare('INSERT INTO rounds (event_id, number, sitting_out) VALUES (?, ?, ?)').run(e.id, number, JSON.stringify(plan.sitting.map(p => p.athlete_id))).lastInsertRowid);
      plan.courts.forEach((teams, ci) => {
        const id = crypto.randomUUID(); ids.push(id);
        db.prepare(`INSERT INTO matches (id, recorded_by, kind, game_to, win_by, best_of, played_at, event_id, round_id, court, status) VALUES (?, ?, 'competition', ?, 2, 1, ?, ?, ?, ?, 'scheduled')`)
          .run(id, user.id, e.game_to, now(), e.id, roundId, ci + 1);
        teams.forEach((team, ti) => team.forEach(([p, side], si) => db.prepare('INSERT INTO match_players (match_id, team, slot, athlete_id, side) VALUES (?, ?, ?, ?, ?)').run(id, ti + 1, si + 1, p.athlete_id, side)));
      });
    });
    // "Court 2 · with Sam (left) vs Jo & Max"
    plan.courts.forEach((teams, ci) => teams.forEach((team, ti) => team.forEach(([p, side]) => {
      const partner = team.find(([q]) => q !== p);
      const opp = teams[1 - ti].map(([q]) => q.name.split(' ')[0]).join(' & ');
      notify(usersOfAthletes([p.athlete_id]), 'courts', `Round ${number}: Court ${ci + 1}`, `${side === 'left' ? 'Left' : 'Right'} side with ${partner ? partner[0].name.split(' ')[0] : ''} vs ${opp}.`, `#/play/events/${e.id}`);
    })));
    notify(usersOfAthletes(plan.sitting.map(p => p.athlete_id)), 'up_next', `You’re up next`, `You’re sitting out round ${number} and will play in round ${number + 1}.`, `#/play/events/${e.id}`);
    return withStatus(201, eventFull(eventRow(e.id), user));
  });

  function closeRoundIfScored(roundId) {
    const left = db.prepare("SELECT COUNT(*) AS n FROM matches WHERE round_id = ? AND status = 'scheduled'").get(roundId).n;
    if (!left) db.prepare("UPDATE rounds SET status = 'done' WHERE id = ?").run(roundId);
  }

  /* ---------- leaderboard ---------- */
  r.get('/api/leaderboard', ({ user, query }) => {
    auth.require(user);
    const days = int(query.get('days'), 'days', { min: 1, max: 3650 }) || 90;
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const rows = {};
    db.prepare("SELECT id, winner FROM matches WHERE status IN ('confirmed','verified') AND played_at >= ?").all(since).forEach(m => {
      players(m.id).forEach(p => {
        if (!p.athlete_id || !p.user_id) return; // only people who've claimed their profile
        const s = rows[p.athlete_id] = rows[p.athlete_id] || { athlete_id: p.athlete_id, name: p.name, user_id: p.user_id, played: 0, wins: 0 };
        s.played++; if (m.winner === p.team) s.wins++;
      });
    });
    return Object.values(rows)
      .filter(s => prefsOf(db.prepare('SELECT prefs FROM users WHERE id = ?').get(s.user_id)).leaderboard)
      .map(({ user_id, ...s }) => ({ ...s, losses: s.played - s.wins, pct: Math.round(s.wins / s.played * 100), player_id: playerId(s.athlete_id) }))
      .sort((a, b) => b.wins - a.wins || b.pct - a.pct || a.name.localeCompare(b.name))
      .slice(0, 100);
  });
};
module.exports.decide = decide;
