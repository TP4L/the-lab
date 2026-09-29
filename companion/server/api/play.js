'use strict';
const crypto = require('node:crypto');
const { HttpError, withStatus, str, oneOf, int, uuid, isoTime, list } = require('../http.js');
const { tx, now } = require('../db.js');
const { prefsOf } = require('./notify.js');
const { limiter } = require('../auth.js');
const F = require('../formats.js');

const KINDS = ['casual', 'training', 'competition'];
const FORMATS = ['round_robin', 'open_play', 'clinic'];
const LABEL = { scheduled: 'Scheduled', recorded: 'Self-recorded', confirmed: 'Opponent-confirmed', verified: 'Organizer-verified', disputed: 'Disputed' };
const SCORING = { traditional: 'Traditional scoring', rally: 'Rally scoring' };
const ROUND_END = { all: 'Every court finishes', timer: 'Timer ends', first: 'First court finishes, all courts stop' };
const TEAM_MODES = ['fixed', 'fallout', 'draft3'];
const newToken = () => crypto.randomBytes(16).toString('hex');
const flag = x => (x === true || x === 1 || x === '1' || x === 'true' ? 1 : 0);
const playerId = id => 'LAB-' + String(id).padStart(5, '0');
const parsePlayerId = s => { const m = /^LAB-?0*(\d{1,9})$/i.exec(String(s || '').trim()); return m ? Number(m[1]) : null; };

/* Winner is the team that won more games. */
function decide(games) {
  let a = 0, b = 0;
  games.forEach(([x, y]) => { if (x > y) a++; else if (y > x) b++; });
  return a > b ? 1 : b > a ? 2 : null;
}

module.exports = function play(r, ctx) {
  const { db, auth, notifier } = ctx;
  const { notify, usersOfAthletes } = notifier;
  const joinLimit = limiter(30, 60 * 60 * 1000);

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
    const acks = db.prepare('SELECT athlete_id FROM match_acks WHERE match_id = ?').all(id).map(x => x.athlete_id);
    const team = user ? myTeam(user, ps) : null;
    const recorderTeam = (() => { const rp = ps.find(p => p.user_id && p.user_id === m.recorded_by); return rp ? rp.team : null; })();
    return {
      ...m, status_label: LABEL[m.status], games: games(id), log, acks,
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
  /* allowTie: play was stopped (timer or first court done), so the score as
     it stands counts. starts: Unlucky head starts, the lowest valid score. */
  function gamesInput(v, bestOf, { allowTie = false, starts = [0, 0] } = {}) {
    const gs = list(v, 'games', { max: 5, item: (g, f) => {
      if (!Array.isArray(g) || g.length !== 2) throw new HttpError(400, `${f} must be [team1, team2].`);
      const a = int(g[0], `${f}[0]`, { min: 0, max: 250, required: true }), b = int(g[1], `${f}[1]`, { min: 0, max: 250, required: true });
      if (a === b && !allowTie) throw new HttpError(400, `Game ${Number(f.match(/\d+/)[0]) + 1} is tied. Every game needs a winner.`);
      if (a < starts[0] || b < starts[1]) throw new HttpError(400, `This game started at ${starts[0]}–${starts[1]}. Scores can’t be lower than that.`);
      return [a, b];
    } });
    if (!gs.length) throw new HttpError(400, 'Enter at least one game score.');
    if (gs.length > bestOf) throw new HttpError(400, `Best of ${bestOf} can’t have ${gs.length} games.`);
    if (!decide(gs) && !allowTie) throw new HttpError(400, 'The games are split evenly. Enter the deciding game.');
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
      inp = { games: gamesInput(body.games, m.best_of, scoreRules(m)), teams: [1, 2].map(t => ps.filter(p => p.team === t).map(p => ({ athlete_id: p.athlete_id, guest_name: p.guest_name, side: p.side }))), note: m.note, played_at: m.played_at, kind: m.kind, game_to: m.game_to, win_by: m.win_by, best_of: m.best_of };
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
    afterScore(m.id);
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


  /* ---------- live-event scoring rules ---------- */
  function roundRow(id) { return id ? db.prepare('SELECT * FROM rounds WHERE id = ?').get(id) : null; }
  function roundStopped(e, rd) { return !!rd && (!!rd.stopped_at || (e.round_end === 'timer' && !!rd.ends_at && rd.ends_at <= now())); }
  /* The courts in use, e.g. [4, 5]. Older events number from 1. */
  function courtNumbers(e) {
    try { const x = e.court_numbers && JSON.parse(e.court_numbers); if (Array.isArray(x) && x.length) return x; } catch {}
    return Array.from({ length: e.courts || 1 }, (_, i) => i + 1);
  }
  const LOCKED = ['draft3', 'fallout']; // fixed teams: roster and courts lock once play starts
  const started = e => e.status === 'live' || !!db.prepare('SELECT 1 FROM rounds WHERE event_id = ?').get(e.id) || !!db.prepare('SELECT 1 FROM bracket_games WHERE event_id = ?').get(e.id);
  /* A saved preview goes stale when the roster or settings change; the host
     is asked to preview again before starting. */
  function invalidateDraw(eid) { db.prepare(`UPDATE events SET draw = CASE WHEN draw IS NULL THEN NULL ELSE '{"stale":true}' END WHERE id = ?`).run(eid); }
  const drawOf = e => { try { return e.draw ? JSON.parse(e.draw) : null; } catch { return null; } };
  /* Round timer. Running: ends_at is set. Paused: remaining_sec holds the
     time left. Rounds from before timers could pause only have ends_at. */
  function timerOf(rd) {
    if (!rd) return null;
    const left = iso => Math.max(0, Math.round((new Date(iso) - Date.now()) / 1000));
    if (rd.duration_sec == null) return rd.ends_at ? { duration: null, running: true, ends_at: rd.ends_at, remaining: left(rd.ends_at), started: true } : null;
    const running = !!rd.ends_at;
    const remaining = running ? left(rd.ends_at) : rd.remaining_sec;
    return { duration: rd.duration_sec, running, ends_at: rd.ends_at, remaining, started: running || remaining !== rd.duration_sec };
  }
  function scoreRules(m) {
    const e = eventOf(m), rd = roundRow(m.round_id);
    return { allowTie: !!e && roundStopped(e, rd), starts: [m.start1 || 0, m.start2 || 0] };
  }
  /* After any event score: stop the other courts if the first finish ends
     the round, close finished rounds, end a race, move a bracket along. */
  function afterScore(matchId) {
    const m = matchRow(matchId);
    const e = eventOf(m);
    if (!e) return;
    const rd = roundRow(m.round_id);
    if (rd && e.round_end === 'first' && !rd.stopped_at && m.status !== 'scheduled') {
      db.prepare('UPDATE rounds SET stopped_at = ? WHERE id = ?').run(now(), rd.id);
      const waiting = db.prepare("SELECT id FROM matches WHERE round_id = ? AND status = 'scheduled'").all(rd.id).flatMap(x => players(x.id).map(p => p.athlete_id));
      tell(e, waiting, 'courts', `Stop play: round ${rd.number}`, 'Another court finished. Enter your score as it stands.');
    }
    if (rd) closeRoundIfScored(rd.id);
    if (m.bracket) resolveBracket(eventRow(e.id));
    if (e.mode === 'race' && e.status === 'live') {
      const race = raceInfo(e, standings(e));
      const open = db.prepare("SELECT 1 FROM rounds WHERE event_id = ? AND status = 'live'").get(e.id);
      if (race.finished && !open) {
        db.prepare("UPDATE events SET status = 'complete', updated_at = ? WHERE id = ?").run(now(), e.id);
        tell(e, people(e.id).filter(p => p.state === 'registered').map(p => p.athlete_id), 'events', `${race.leader.name} wins ${e.title}`, `First to ${e.race_target} points. Final standings are on the event page.`);
      }
    }
  }
  function closeRoundIfScored(roundId) {
    const left = db.prepare("SELECT COUNT(*) AS n FROM matches WHERE round_id = ? AND status = 'scheduled'").get(roundId).n;
    if (!left) db.prepare("UPDATE rounds SET status = 'done' WHERE id = ?").run(roundId);
  }

  /* Organizer reopens a result so it can be entered again. */
  r.post('/api/matches/:id/reopen', ({ user, params }) => {
    auth.require(user);
    const m = matchRow(uuid(params.id, 'id'));
    const e = m && eventOf(m);
    if (!m || !e || !isOrganizer(user, e)) throw new HttpError(404, 'Match not found.');
    if (m.status !== 'scheduled') {
      tx(db, () => {
        log(m.id, user.id, 'reopened', '', snapshot(m.id));
        db.prepare("UPDATE matches SET status = 'scheduled', winner = NULL, version = version + 1, updated_at = ? WHERE id = ?").run(now(), m.id);
        if (m.round_id) db.prepare("UPDATE rounds SET status = 'live' WHERE id = ?").run(m.round_id);
      });
      if (m.bracket) resolveBracket(e);
      tell(e, players(m.id).map(p => p.athlete_id), 'matches', `Court ${m.court || ''} score reopened`.replace('  ', ' '), 'Enter the score again.');
    }
    return full(m.id, user);
  });
  /* "Got it": the player has seen their court assignment. */
  r.post('/api/matches/:id/ack', ({ user, params }) => {
    auth.require(user);
    const m = matchRow(uuid(params.id, 'id'));
    const mine = auth.ownAthleteId(user);
    if (!m || !mine || !players(m.id).some(p => p.athlete_id === mine)) throw new HttpError(404, 'Match not found.');
    db.prepare('INSERT OR IGNORE INTO match_acks (match_id, athlete_id) VALUES (?, ?)').run(m.id, mine);
    return withStatus(204, null);
  });

  /* ---------- notifications, including players without an account ---------- */
  function pushGuests(e, athleteIds, title, body) {
    if (!ctx.push || !ctx.push.enabled || !athleteIds.length) return;
    db.prepare(`SELECT ep.athlete_id, ep.guest_token FROM event_people ep JOIN athletes a ON a.id = ep.athlete_id
      WHERE ep.event_id = ? AND a.user_id IS NULL AND ep.guest_token IS NOT NULL AND ep.athlete_id IN (${athleteIds.map(() => '?').join(',')})`).all(e.id, ...athleteIds)
      .forEach(g => ctx.push.toGuest(g.athlete_id, { title, body, link: `#/g/${g.guest_token}` }));
  }
  function tell(e, athleteIds, kind, title, body = '') {
    const ids = [...new Set(athleteIds.filter(Boolean))];
    if (!ids.length) return;
    notify(usersOfAthletes(ids), kind, title, body, `#/play/events/${e.id}`);
    pushGuests(e, ids, title, body);
  }

  /* ---------- player check-in code (QR on the player card) ---------- */
  function checkinCode(aid) {
    let code = db.prepare('SELECT checkin_code FROM athletes WHERE id = ?').get(aid).checkin_code;
    if (!code) { code = crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, 'x').slice(0, 10).toUpperCase(); db.prepare('UPDATE athletes SET checkin_code = ? WHERE id = ?').run(code, aid); }
    return code;
  }
  r.get('/api/me/checkin', ({ user }) => {
    auth.require(user);
    const aid = auth.ownAthleteId(user);
    if (!aid) throw new HttpError(404, 'Set up your athlete profile first.');
    const code = checkinCode(aid);
    return { player_id: playerId(aid), code, qr: 'THELAB:' + code };
  });

  /* ---------- events ---------- */
  function eventRow(id) { const e = db.prepare('SELECT * FROM events WHERE id = ?').get(id); if (!e) throw new HttpError(404, 'Event not found.'); return e; }
  function eventVisible(user, e) { return e.status !== 'draft' || isOrganizer(user, e); }
  function eventInput(b, cur = {}) {
    const v = (k, fn) => (b[k] === undefined ? cur[k] : fn(b[k]));
    const n = (k, fn) => (b[k] === undefined ? (cur[k] === undefined ? null : cur[k]) : fn(b[k]));
    let mode = v('mode', x => oneOf(x, Object.keys(F.MODES), 'mode'));
    // Older clients send partner_mode instead of mode.
    if (b.mode === undefined && b.partner_mode !== undefined) mode = oneOf(b.partner_mode, ['rotating', 'fixed'], 'partner_mode') === 'fixed' ? (cur.mode === 'fallout' ? 'fallout' : 'fixed') : (TEAM_MODES.includes(cur.mode) || !cur.mode ? 'rotate' : cur.mode);
    const scoring = v('scoring', x => oneOf(x, Object.keys(SCORING), 'scoring')) || 'traditional';
    const out = {
      title: v('title', x => str(x, 'title', { required: true, max: 120 })),
      description: v('description', x => str(x, 'description', { max: 4000 })) || '',
      location: v('location', x => str(x, 'location', { max: 200 })) || '',
      starts_at: v('starts_at', x => isoTime(x, 'starts_at', { allowEmpty: false })),
      ends_at: n('ends_at', x => isoTime(x, 'ends_at')),
      capacity: n('capacity', x => int(x, 'capacity', { min: 2, max: 500 })),
      courts: v('courts', x => int(x, 'courts', { min: 1, max: 40, required: true })) || 2,
      format: v('format', x => oneOf(x, FORMATS, 'format')) || 'round_robin',
      mode: mode || 'rotate',
      scoring,
      game_to: v('game_to', x => int(x, 'game_to', { min: 5, max: 30, required: true })) || (scoring === 'rally' ? 21 : 11),
      round_limit: n('round_limit', x => int(x, 'round_limit', { min: 2, max: 24 })),
      round_minutes: n('round_minutes', x => int(x, 'round_minutes', { min: 1, max: 60 })),
      round_end: v('round_end', x => oneOf(x, Object.keys(ROUND_END), 'round_end')) || 'all',
      race_target: n('race_target', x => int(x, 'race_target', { min: 11, max: 200 })),
      elimination: v('elimination', x => oneOf(x, ['single', 'double'], 'elimination')) || 'single',
      registration_open: b.registration_open === undefined ? (cur.registration_open === undefined ? 1 : cur.registration_open) : flag(b.registration_open),
      show_roster: b.show_roster === undefined ? (cur.show_roster === undefined ? 1 : cur.show_roster) : flag(b.show_roster),
      late_join: b.late_join === undefined ? (cur.late_join === undefined ? 1 : cur.late_join) : flag(b.late_join),
      court_numbers: b.court_numbers !== undefined ? (b.court_numbers === null ? null : JSON.stringify(courtList(b.court_numbers))) : b.courts !== undefined ? null : (cur.court_numbers === undefined ? null : cur.court_numbers),
      status: v('status', x => oneOf(x, ['draft', 'published', 'live', 'complete', 'cancelled'], 'status')) || 'draft'
    };
    if (!out.title || !out.starts_at) throw new HttpError(400, 'title and starts_at are required.');
    if (out.mode === 'race' && !out.race_target) out.race_target = 50;
    if (out.round_end === 'timer' && !out.round_minutes) throw new HttpError(400, 'Set the round length in minutes when the timer ends each round.');
    out.partner_mode = ['fixed', 'fallout'].includes(out.mode) ? 'fixed' : 'rotating';
    if (out.court_numbers) out.courts = JSON.parse(out.court_numbers).length;
    return out;
  }
  function courtList(v) {
    const nums = [...new Set(list(v, 'court_numbers', { max: 40, item: (x, f) => int(x, f, { min: 1, max: 40, required: true }) }))].sort((a, b) => a - b);
    if (!nums.length) throw new HttpError(400, 'Choose at least one court.');
    return nums;
  }
  const COLS = ['title', 'description', 'location', 'starts_at', 'ends_at', 'capacity', 'courts', 'format', 'mode', 'partner_mode', 'scoring', 'game_to', 'round_limit', 'round_minutes', 'round_end', 'race_target', 'elimination', 'registration_open', 'show_roster', 'status', 'late_join', 'court_numbers'];
  function insertEvent(organizerId, f) {
    return Number(db.prepare(`INSERT INTO events (organizer_id, ${COLS.join(', ')}, share_token, watch_token) VALUES (?, ${COLS.map(() => '?').join(', ')}, ?, ?)`)
      .run(organizerId, ...COLS.map(c => (f[c] !== undefined ? f[c] : { late_join: 1, court_numbers: null }[c])), newToken(), newToken()).lastInsertRowid);
  }
  function people(eventId) {
    return db.prepare(`SELECT ep.*, a.name, a.side AS preferred_side, a.user_id, a.rating FROM event_people ep JOIN athletes a ON a.id = ep.athlete_id
      WHERE ep.event_id = ? ORDER BY ep.state, ep.created_at`).all(eventId);
  }
  function standings(e) {
    const rows = {};
    db.prepare("SELECT id, winner FROM matches WHERE event_id = ? AND status NOT IN ('scheduled','disputed')").all(e.id).forEach(m => {
      const gs = games(m.id);
      const pf = [0, 0]; gs.forEach(([a, b]) => { pf[0] += a; pf[1] += b; });
      players(m.id).forEach(p => {
        if (!p.athlete_id) return;
        const s = rows[p.athlete_id] = rows[p.athlete_id] || { athlete_id: p.athlete_id, name: p.name, played: 0, wins: 0, losses: 0, draws: 0, points_for: 0, points_against: 0 };
        s.played++;
        if (!m.winner) s.draws++; else if (m.winner === p.team) s.wins++; else s.losses++;
        s.points_for += pf[p.team - 1]; s.points_against += pf[2 - p.team];
      });
    });
    const list = Object.values(rows).map(s => ({ ...s, diff: s.points_for - s.points_against }));
    return e.mode === 'race'
      ? list.sort((a, b) => b.points_for - a.points_for || b.wins - a.wins || a.name.localeCompare(b.name))
      : list.sort((a, b) => b.wins - a.wins || b.diff - a.diff || a.name.localeCompare(b.name));
  }
  function raceInfo(e, st) {
    if (e.mode !== 'race') return null;
    const top = st[0];
    return { target: e.race_target, leader: top ? { athlete_id: top.athlete_id, name: top.name, points: top.points_for } : null, finished: !!top && top.points_for >= e.race_target };
  }
  function roundsOf(e, user) {
    return db.prepare('SELECT * FROM rounds WHERE event_id = ? ORDER BY number').all(e.id).map(rd => ({
      id: rd.id, number: rd.number, status: rd.status, created_at: rd.created_at, ends_at: rd.ends_at, stopped_at: rd.stopped_at, stopped: roundStopped(e, rd), timer: timerOf(rd),
      sitting_out: JSON.parse(rd.sitting_out).map(id => ({ athlete_id: id, name: (db.prepare('SELECT name FROM athletes WHERE id = ?').get(id) || {}).name })),
      matches: db.prepare('SELECT id FROM matches WHERE round_id = ? ORDER BY court, matchup, created_at').all(rd.id).map(m => full(m.id, user))
    }));
  }
  /* Phone alerts for a player: 'on', 'failed' (the push service refused the
     last one) or 'off'. Acceptance by the push service doesn't prove the
     phone showed it. */
  function alertsOf(p) {
    const subs = p.user_id ? db.prepare('SELECT last_status FROM push_subscriptions WHERE user_id = ?').all(p.user_id) : db.prepare('SELECT last_status FROM guest_push WHERE athlete_id = ?').all(p.athlete_id);
    if (!subs.length) return 'off';
    return subs.some(s => !s.last_status || s.last_status < 300) ? 'on' : 'failed';
  }
  /* viewer: { org, athleteId, user }. Organizers also get contact details,
     share links, player links and alert status. */
  function eventData(e, viewer) {
    const org = !!viewer.org;
    if (org && (!e.share_token || !e.watch_token)) {
      db.prepare('UPDATE events SET share_token = COALESCE(share_token, ?), watch_token = COALESCE(watch_token, ?) WHERE id = ?').run(newToken(), newToken(), e.id);
      e = eventRow(e.id);
    }
    const ps = people(e.id);
    const me = viewer.athleteId ? ps.find(p => p.athlete_id === viewer.athleteId) : null;
    const st = standings(e);
    const out = {};
    ['id', 'title', 'description', 'location', 'starts_at', 'ends_at', 'capacity', 'courts', 'format', 'mode', 'partner_mode', 'scoring', 'game_to', 'round_limit', 'round_minutes', 'round_end', 'race_target', 'elimination', 'status', 'created_at', 'updated_at'].forEach(k => { out[k] = e[k]; });
    Object.assign(out, {
      mode_label: F.MODES[e.mode] || e.mode, registration_open: !!e.registration_open, show_roster: !!e.show_roster,
      court_numbers: courtNumbers(e), started: started(e), late_join: !!e.late_join, locked: LOCKED.includes(e.mode) && started(e),
      organizer: org, organizer_name: (db.prepare('SELECT name FROM users WHERE id = ?').get(e.organizer_id) || {}).name,
      me: me ? { athlete_id: me.athlete_id, number: me.number, state: me.state, checked_in: !!me.checked_in_at, active: !!me.active, on_break: !!me.on_break } : null,
      counts: { registered: ps.filter(p => p.state === 'registered').length, waitlist: ps.filter(p => p.state === 'waitlist').length, interested: ps.filter(p => p.state === 'interested').length, checked_in: ps.filter(p => p.checked_in_at && p.state === 'registered').length },
      people: ps.filter(p => p.state !== 'withdrawn' && (org || (p.state === 'registered' && e.show_roster))).map(p => {
        const x = { athlete_id: p.athlete_id, name: p.name, number: p.number, state: p.state, checked_in: !!p.checked_in_at, active: !!p.active, on_break: !!p.on_break, guest: !p.user_id };
        if (org) Object.assign(x, { player_id: playerId(p.athlete_id), email: p.email || '', phone: p.phone || '', link: p.guest_token && !p.user_id ? `#/g/${p.guest_token}` : null, alerts: alertsOf(p) });
        return x;
      }),
      rounds: roundsOf(e, viewer.user || null),
      standings: st,
      race: raceInfo(e, st),
      teams: teamsOf(e.id),
      team_standings: TEAM_MODES.includes(e.mode) ? teamStandings(e) : [],
      bracket: bracketOf(e)
    });
    if (org) {
      out.links = { share: `#/e/${e.share_token}`, watch: `#/watch/${e.watch_token}` };
      out.undo = lastUndo(e);
      const d = drawOf(e);
      out.draw = d ? { stale: !!d.stale, kind: d.kind || null } : null;
      if (e.mode !== 'fallout') out.fairness = fairness(e);
      if (e.mode === 'premapped') out.schedule = scheduleView(e);
    }
    return out;
  }
  function eventFull(e, user) { return eventData(e, { org: isOrganizer(user, e), athleteId: auth.ownAthleteId(user), user }); }

  /* ---------- teams: fixed pairs, and 3-player teams for 3v3 ---------- */
  const members = t => [t.p1, t.p2, t.p3].filter(Boolean);
  function teamsOf(eventId) {
    return db.prepare(`SELECT t.*, a1.name AS p1_name, a2.name AS p2_name, a3.name AS p3_name FROM event_teams t JOIN athletes a1 ON a1.id = t.p1 JOIN athletes a2 ON a2.id = t.p2 LEFT JOIN athletes a3 ON a3.id = t.p3
      WHERE t.event_id = ? ORDER BY t.id`).all(eventId).map(t => ({ ...t, label: t.name || [t.p1_name, t.p2_name, t.p3_name].filter(Boolean).map(n => n.split(' ')[0]).join(' & ') }));
  }
  const pairKey = F.pairKey;
  function teamByPair(eventId) { const m = {}; teamsOf(eventId).forEach(t => { m[pairKey(t.p1, t.p2)] = t; }); return m; }
  function matchTeams(matchId, byPair) {
    const ps = players(matchId);
    return [1, 2].map(n => { const ids = ps.filter(p => p.team === n).map(p => p.athlete_id); return ids.length === 2 ? byPair[pairKey(ids[0], ids[1])] : null; });
  }
  function teamStandings(e) {
    const teams = teamsOf(e.id);
    const rows = {};
    teams.forEach(t => { rows[t.id] = { team_id: t.id, label: t.label, played: 0, wins: 0, losses: 0, games_won: 0, diff: 0 }; });
    if (e.mode === 'draft3') {
      // A 3v3 matchup is three games; the team that wins two takes it.
      const memberOf = {}; teams.forEach(t => members(t).forEach(a => { memberOf[a] = t.id; }));
      const mus = {};
      db.prepare("SELECT id, winner, matchup FROM matches WHERE event_id = ? AND matchup IS NOT NULL AND status NOT IN ('scheduled','disputed')").all(e.id).forEach(m => {
        const ps = players(m.id);
        const t1 = memberOf[(ps.find(p => p.team === 1) || {}).athlete_id], t2 = memberOf[(ps.find(p => p.team === 2) || {}).athlete_id];
        if (!rows[t1] || !rows[t2]) return;
        const mu = mus[m.matchup] = mus[m.matchup] || { t: [t1, t2], w: [0, 0] };
        const pf = [0, 0]; games(m.id).forEach(([a, b]) => { pf[0] += a; pf[1] += b; });
        if (m.winner) { mu.w[m.winner - 1]++; rows[mu.t[m.winner - 1]].games_won++; }
        rows[t1].diff += pf[0] - pf[1]; rows[t2].diff += pf[1] - pf[0];
      });
      Object.values(mus).forEach(mu => {
        if (mu.w[0] < 2 && mu.w[1] < 2) return;
        const win = mu.w[0] >= 2 ? 0 : 1;
        rows[mu.t[0]].played++; rows[mu.t[1]].played++;
        rows[mu.t[win]].wins++; rows[mu.t[1 - win]].losses++;
      });
      return Object.values(rows).sort((a, b) => b.wins - a.wins || b.games_won - a.games_won || b.diff - a.diff || a.label.localeCompare(b.label));
    }
    const byPair = {}; teams.forEach(t => { byPair[pairKey(t.p1, t.p2)] = t; });
    db.prepare("SELECT id, winner FROM matches WHERE event_id = ? AND status NOT IN ('scheduled','disputed')").all(e.id).forEach(m => {
      const ts = matchTeams(m.id, byPair);
      const pf = [0, 0]; games(m.id).forEach(([a, b]) => { pf[0] += a; pf[1] += b; });
      ts.forEach((t, i) => { if (!t) return; const x = rows[t.id]; x.played++; if (m.winner === i + 1) { x.wins++; x.games_won++; } else if (m.winner) x.losses++; x.diff += pf[i] - pf[1 - i]; });
    });
    return Object.values(rows).sort((a, b) => b.wins - a.wins || b.diff - a.diff || a.label.localeCompare(b.label));
  }
  function teamOf(eventId, athleteId) { return db.prepare('SELECT * FROM event_teams WHERE event_id = ? AND (p1 = ? OR p2 = ? OR p3 = ?)').get(eventId, athleteId, athleteId, athleteId); }
  function makeTeam(e, ids, name) {
    const size = e.mode === 'draft3' ? 3 : 2;
    if (ids.length !== size) throw new HttpError(400, `Teams in this event have ${size} players.`);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'A team needs different players.');
    ids.forEach(x => {
      const p = db.prepare('SELECT state FROM event_people WHERE event_id = ? AND athlete_id = ?').get(e.id, x);
      if (!p || p.state === 'withdrawn') throw new HttpError(400, 'Every player must be signed up for this event.');
      if (teamOf(e.id, x)) throw new HttpError(409, 'One of these players is already on a team.');
    });
    return Number(db.prepare('INSERT INTO event_teams (event_id, name, p1, p2, p3) VALUES (?, ?, ?, ?, ?)').run(e.id, name || '', ids[0], ids[1], ids[2] || null).lastInsertRowid);
  }
  r.post('/api/events/:id/teams', ({ user, params, body }) => {
    const e = organizerEvent(user, params.id);
    if (!TEAM_MODES.includes(e.mode)) throw new HttpError(400, 'This event rotates partners. Switch it to Fixed Partners, Fallout or 3v3 Team Draft for teams.');
    const ids = [body.p1, body.p2, body.p3].filter(x => x !== undefined && x !== null && x !== '').map((x, i) => int(x, `p${i + 1}`, { min: 1, required: true }));
    makeTeam(e, ids, str(body.name, 'name', { max: 60 }));
    invalidateDraw(e.id);
    return withStatus(201, eventFull(eventRow(e.id), user));
  });
  /* Auto teams. Pairs: checked-in first, in sign-up order. 3v3: a snake
     draft by rating so each team gets a spread of levels. */
  r.post('/api/events/:id/teams/auto', ({ user, params }) => {
    const e = organizerEvent(user, params.id);
    if (!TEAM_MODES.includes(e.mode)) throw new HttpError(400, 'This event rotates partners.');
    const free = people(e.id).filter(p => p.state === 'registered' && !teamOf(e.id, p.athlete_id))
      .sort((a, b) => (b.checked_in_at ? 1 : 0) - (a.checked_in_at ? 1 : 0) || (a.created_at < b.created_at ? -1 : 1));
    tx(db, () => {
      if (e.mode === 'draft3') {
        const rated = free.slice().sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
        F.snakeTeams(rated, Math.floor(rated.length / 3)).forEach(t => makeTeam(e, t.map(p => p.athlete_id), ''));
      } else for (let i = 0; i + 1 < free.length; i += 2) makeTeam(e, [free[i].athlete_id, free[i + 1].athlete_id], '');
      invalidateDraw(e.id);
    });
    return eventFull(eventRow(e.id), user);
  });
  r.del('/api/events/:id/teams/:tid', ({ user, params }) => {
    const e = organizerEvent(user, params.id);
    const t = db.prepare('SELECT * FROM event_teams WHERE id = ? AND event_id = ?').get(int(params.tid, 'tid', { min: 1, required: true }), e.id);
    if (!t) throw new HttpError(404, 'Team not found.');
    const ids = members(t);
    const used = db.prepare(`SELECT 1 FROM matches m JOIN match_players p ON p.match_id = m.id WHERE m.event_id = ? AND p.athlete_id IN (${ids.map(() => '?').join(',')}) LIMIT 1`).get(e.id, ...ids);
    if (used) throw new HttpError(409, 'This team has already played. Teams are locked once they start.');
    db.prepare('DELETE FROM event_teams WHERE id = ?').run(t.id);
    invalidateDraw(e.id);
    return eventFull(eventRow(e.id), user);
  });

  /* Round of teams: fewest games first, fewest repeat opponents. */
  function buildTeamRound(pool, courts, eventId, rand) {
    const memberOf = {}; pool.forEach(t => members(t).forEach(a => { memberOf[a] = t.id; }));
    const played = {}, faced = {};
    db.prepare('SELECT id, matchup FROM matches WHERE event_id = ? AND bracket = 0').all(eventId).forEach(m => {
      const ps = players(m.id);
      const t1 = memberOf[(ps.find(p => p.team === 1) || {}).athlete_id], t2 = memberOf[(ps.find(p => p.team === 2) || {}).athlete_id];
      if (m.matchup && ps.length && m.id !== db.prepare('SELECT id FROM matches WHERE matchup = ? AND event_id = ? ORDER BY created_at, id LIMIT 1').get(m.matchup, eventId).id) return; // count a 3v3 matchup once
      [t1, t2].forEach(t => { if (t) played[t] = (played[t] || 0) + 1; });
      if (t1 && t2) { const k = pairKey(t1, t2); faced[k] = (faced[k] || 0) + 1; }
    });
    const c = Math.min(courts, Math.floor(pool.length / 2));
    const order = pool.map(t => ({ t, r: rand() })).sort((a, b) => (played[a.t.id] || 0) - (played[b.t.id] || 0) || a.r - b.r).map(x => x.t);
    const playing = order.slice(0, c * 2), sitting = order.slice(c * 2);
    let best = null;
    for (let trial = 0; trial < 300; trial++) {
      const sh = F.shuffle(playing, rand);
      let cost = 0; const pairs = [];
      for (let i = 0; i < sh.length; i += 2) { cost += faced[pairKey(sh[i].id, sh[i + 1].id)] || 0; pairs.push([sh[i], sh[i + 1]]); }
      if (!best || cost < best.cost) best = { cost, pairs };
      if (cost === 0) break;
    }
    return { pairs: best ? best.pairs : [], sitting };
  }
  function teamSides(t) {
    const a = db.prepare('SELECT id, name, side FROM athletes WHERE id = ?').get(t.p1), b = db.prepare('SELECT id, name, side FROM athletes WHERE id = ?').get(t.p2);
    if (a.side === 'right' || b.side === 'left') return [[a, 'right'], [b, 'left']];
    return [[a, 'left'], [b, 'right']];
  }
  function insertMatch(e, extra, teams) {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO matches (id, recorded_by, kind, game_to, win_by, best_of, played_at, event_id, round_id, court, status, bracket, bracket_code, start1, start2, matchup, note)
      VALUES (?, ?, 'competition', ?, 2, 1, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)`)
      .run(id, e.organizer_id, e.game_to, now(), e.id, extra.round_id || null, extra.court || null, extra.bracket ? 1 : 0, extra.code || null, extra.start1 || 0, extra.start2 || 0, extra.matchup || null, extra.note || '');
    teams.forEach((team, ti) => team.forEach(([aid, side], si) => db.prepare('INSERT INTO match_players (match_id, team, slot, athlete_id, side) VALUES (?, ?, ?, ?, ?)').run(id, ti + 1, si + 1, aid, side)));
    return id;
  }
  const teamPlayers = t => teamSides(t).map(([p, side]) => [p.id, side]);
  function notifyTeams(e, t1, t2, title) {
    tell(e, members(t1), 'courts', title, `vs ${t2.label}.`);
    tell(e, members(t2), 'courts', title, `vs ${t1.label}.`);
  }

  /* ---------- knockout brackets (Fallout): single or double elimination ---------- */
  function bracketOf(e) {
    const gs = db.prepare('SELECT * FROM bracket_games WHERE event_id = ?').all(e.id);
    return gs.length ? bracketView(e, gs) : null;
  }
  function bracketView(e, gs) {
    const teams = {}; teamsOf(e.id).forEach(t => { teams[t.id] = t; });
    const tm = id => (id && teams[id] ? { id, label: teams[id].label } : null);
    const view = g => {
      const m = g.match_id ? matchRow(g.match_id) : null;
      return {
        code: g.code, pos: g.pos, label: F.bracketLabel(g, gs, e.elimination), team_a: tm(g.team_a), team_b: tm(g.team_b), winner_team: g.winner_team,
        bye: !!g.settled && !g.match_id && g.section !== 'F' && (!g.team_a || !g.team_b),
        not_needed: g.section === 'F' && g.round === 1 && !!g.settled && !g.match_id,
        match: m ? { id: m.id, status: m.status, games: games(m.id), court: m.court } : null
      };
    };
    const group = section => {
      const rounds = [...new Set(gs.filter(g => g.section === section).map(g => g.round))].sort((a, b) => a - b);
      return rounds.map(rd => {
        const list = gs.filter(g => g.section === section && g.round === rd).sort((a, b) => a.pos - b.pos);
        return { round: rd, name: F.bracketLabel(list[0], gs, e.elimination), slots: list.map(view) };
      });
    };
    const last = e.elimination === 'double' ? gs.find(g => g.code === 'F1-0') : gs.filter(g => g.section === 'W').sort((a, b) => b.round - a.round)[0];
    return { elimination: e.elimination, rounds: group('W'), losers: group('L'), finals: group('F'), champion: last && last.settled && last.winner_team && teams[last.winner_team] ? teams[last.winner_team].label : null };
  }
  /* Walk the bracket until nothing changes: settle byes, schedule games once
     both teams are known, carry winners and losers forward. A later game is
     only re-routed while its match is still unplayed. */
  function resolveBracket(e) {
    const gs = db.prepare('SELECT * FROM bracket_games WHERE event_id = ?').all(e.id);
    if (!gs.length) return;
    const by = {}; gs.forEach(g => { by[g.code] = g; });
    const teams = {}; teamsOf(e.id).forEach(t => { teams[t.id] = t; });
    const UNK = undefined;
    const src = (g, side) => {
      const s = g['src_' + side];
      if (s.startsWith('seed:')) return g['team_' + side];
      const [kind, code] = s.split(':'), from = by[code];
      if (!from.settled) return UNK;
      return kind === 'W' ? from.winner_team : from.loser_team;
    };
    const created = [];
    const save = (g, next) => {
      const keys = ['team_a', 'team_b', 'match_id', 'winner_team', 'loser_team', 'settled'];
      if (keys.every(k => (g[k] ?? null) === (next[k] ?? null))) return false;
      db.prepare('UPDATE bracket_games SET team_a = ?, team_b = ?, match_id = ?, winner_team = ?, loser_team = ?, settled = ? WHERE event_id = ? AND code = ?')
        .run(next.team_a ?? null, next.team_b ?? null, next.match_id ?? null, next.winner_team ?? null, next.loser_team ?? null, next.settled ? 1 : 0, e.id, g.code);
      Object.assign(g, next);
      return true;
    };
    for (let pass = 0, changed = true; changed && pass < 40; pass++) {
      changed = false;
      for (const g of gs) {
        const m = g.match_id ? matchRow(g.match_id) : null;
        const played = m && m.status !== 'scheduled';
        let a, b, forced = UNK;
        if (g.src_a.startsWith('X:')) {
          const f = by[g.src_a.slice(2)];
          if (!f.settled) a = b = UNK;
          else if (f.winner_team === f.team_a) { a = b = null; forced = f.winner_team; } // winners-side team won: no deciding game
          else { a = f.team_a; b = f.team_b; }
        } else { a = src(g, 'a'); b = src(g, 'b'); }
        const next = { team_a: g.team_a, team_b: g.team_b, match_id: g.match_id, winner_team: null, loser_team: null, settled: 0 };
        if (played) {
          // Keep who played; take the result once it stands.
          if (m.winner && m.status !== 'disputed') { next.settled = 1; next.winner_team = m.winner === 1 ? g.team_a : g.team_b; next.loser_team = m.winner === 1 ? g.team_b : g.team_a; }
        } else {
          if (!g.src_a.startsWith('seed:')) next.team_a = a === UNK ? null : a;
          if (!g.src_b.startsWith('seed:')) next.team_b = b === UNK ? null : b;
          const known = a !== UNK && b !== UNK;
          const bothTeams = known && a && b;
          if (m && (!bothTeams || m.id && (g.team_a !== next.team_a || g.team_b !== next.team_b))) { db.prepare('DELETE FROM matches WHERE id = ?').run(m.id); next.match_id = null; }
          if (forced !== UNK) { next.settled = 1; next.winner_team = forced; next.team_a = next.team_b = null; }
          else if (known && !a && !b) next.settled = 1;
          else if (known && (!a || !b)) { next.settled = 1; next.winner_team = a || b; }
          else if (bothTeams && !next.match_id) {
            const busy = new Set(db.prepare("SELECT court FROM matches WHERE event_id = ? AND bracket = 1 AND status = 'scheduled' AND court IS NOT NULL").all(e.id).map(x => x.court));
            const court = courtNumbers(e).find(c => !busy.has(c)) || null;
            next.match_id = insertMatch(e, { bracket: true, code: g.code, court }, [teamPlayers(teams[a]), teamPlayers(teams[b])]);
            created.push([teams[a], teams[b], F.bracketLabel(g, gs, e.elimination)]);
          }
        }
        if (save(g, next)) changed = true;
      }
    }
    created.forEach(([a, b, name]) => notifyTeams(e, a, b, `${e.title}: ${name}`));
  }
  function seededTeams(e, seedingIn, sizeIn) {
    if (!['fixed', 'fallout'].includes(e.mode)) throw new HttpError(400, 'Brackets are for fixed-partner events. Switch the event to Fallout or Fixed Partners first.');
    const all = teamsOf(e.id);
    const seeding = oneOf(seedingIn || 'standings', ['standings', 'order'], 'seeding');
    let seeded = seeding === 'standings' ? teamStandings(e).map(s => all.find(t => t.id === s.team_id)).filter(Boolean) : all;
    const size = sizeIn ? int(sizeIn, 'size', { min: 2, max: 64 }) : null;
    seeded = seeded.slice(0, size || seeded.length);
    if (seeded.length < 2) throw new HttpError(400, 'A bracket needs at least 2 teams.');
    if (e.elimination === 'double' && seeded.length > 8) throw new HttpError(400, 'Double elimination takes up to 8 teams. Set the bracket size to 8 or fewer.');
    return { seeded, seeding, size };
  }
  /* The whole bracket before anything is created: first-round games, byes,
     and every later game with the teams that are already certain. */
  r.get('/api/events/:id/bracket/preview', ({ user, params, query }) => {
    const e = organizerEvent(user, params.id);
    const { seeded, seeding, size } = seededTeams(e, query.get('seeding'), query.get('size'));
    const graph = F.bracketGraph(seeded.length, e.elimination);
    const seedTeam = x => { const t = seeded[Number(x.slice(5)) - 1]; return t ? t.id : null; };
    const gs = graph.games.map(g => ({ ...g, team_a: g.src_a.startsWith('seed:') ? seedTeam(g.src_a) : null, team_b: g.src_b.startsWith('seed:') ? seedTeam(g.src_b) : null, settled: 0, winner_team: null, loser_team: null, match_id: null }));
    const by = {}; gs.forEach(g => { by[g.code] = g; });
    // Settle byes only; everything else waits for play.
    for (let pass = 0, changed = true; changed && pass < 40; pass++) {
      changed = false;
      gs.forEach(g => {
        if (g.settled || g.src_a.startsWith('X:')) return;
        const val = side => { const x = g['src_' + side]; if (x.startsWith('seed:')) return g['team_' + side]; const [k, c] = x.split(':'); const f = by[c]; return f.settled ? (k === 'W' ? f.winner_team : f.loser_team) : undefined; };
        const a = val('a'), b = val('b');
        if (a !== undefined) g.team_a = a;
        if (b !== undefined) g.team_b = b;
        if (a !== undefined && b !== undefined && (!a || !b)) { g.settled = 1; g.winner_team = a || b; changed = true; }
      });
    }
    db.prepare('UPDATE events SET draw = ? WHERE id = ?').run(JSON.stringify({ kind: 'bracket', seeding, size, at: now() }), e.id);
    return { seeding, size: seeded.length, bracket: bracketView(e, gs) };
  });
  r.post('/api/events/:id/bracket', ({ user, params, body }) => {
    const e = organizerEvent(user, params.id);
    let seedingIn = body.seeding, sizeIn = body.size;
    if (seedingIn === undefined && sizeIn === undefined) {
      const d = drawOf(e);
      if (d && d.stale) throw new HttpError(409, 'The teams or settings changed since your preview. Preview again before starting.', { stale_preview: true });
      if (d && d.kind === 'bracket') { seedingIn = d.seeding; sizeIn = d.size; }
    }
    const { seeded } = seededTeams(e, seedingIn, sizeIn);
    if (db.prepare("SELECT 1 FROM bracket_games g JOIN matches m ON m.id = g.match_id WHERE g.event_id = ? AND m.status != 'scheduled'").get(e.id) && !body.force) {
      throw new HttpError(409, 'The bracket already has results. Send force to rebuild it.');
    }
    const graph = F.bracketGraph(seeded.length, e.elimination);
    tx(db, () => {
      db.prepare('DELETE FROM matches WHERE event_id = ? AND bracket = 1').run(e.id);
      db.prepare('DELETE FROM bracket_games WHERE event_id = ?').run(e.id);
      const seedTeam = s => { const t = seeded[Number(s.slice(5)) - 1]; return t ? t.id : null; };
      graph.games.forEach(g => db.prepare('INSERT INTO bracket_games (event_id, code, section, round, pos, src_a, src_b, team_a, team_b) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(e.id, g.code, g.section, g.round, g.pos, g.src_a, g.src_b, g.src_a.startsWith('seed:') ? seedTeam(g.src_a) : null, g.src_b.startsWith('seed:') ? seedTeam(g.src_b) : null));
      if (e.status === 'published' || e.status === 'draft') db.prepare("UPDATE events SET status = 'live', updated_at = ? WHERE id = ?").run(now(), e.id);
      db.prepare('UPDATE events SET draw = NULL WHERE id = ?').run(e.id);
      resolveBracket(eventRow(e.id));
    });
    return withStatus(201, eventFull(eventRow(e.id), user));
  });

  /* ---------- event CRUD ---------- */
  const listFields = e => { const { share_token, watch_token, schedule, ...rest } = e; return rest; };
  r.get('/api/events', ({ user }) => {
    auth.require(user);
    const mine = auth.ownAthleteId(user) || -1;
    return db.prepare(`SELECT e.*, (SELECT state FROM event_people WHERE event_id = e.id AND athlete_id = ?) AS my_state,
        (SELECT COUNT(*) FROM event_people WHERE event_id = e.id AND state = 'registered') AS registered
      FROM events e WHERE e.status != 'draft' OR e.organizer_id = ? OR ? ORDER BY e.starts_at DESC LIMIT 200`)
      .all(mine, user.id, user.roles.includes('admin') ? 1 : 0).map(e => ({ ...listFields(e), mode_label: F.MODES[e.mode] || e.mode }));
  });
  r.post('/api/events', ({ user, body }) => {
    auth.require(user, 'coach');
    const id = insertEvent(user.id, eventInput(body));
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
    if (f.mode !== e.mode && db.prepare('SELECT 1 FROM matches WHERE event_id = ?').get(e.id)) throw new HttpError(409, 'The format can’t change once matches exist.');
    if (f.mode !== e.mode) db.prepare('DELETE FROM event_teams WHERE event_id = ?').run(e.id);
    if (LOCKED.includes(e.mode) && started(e) && JSON.stringify(courtNumbers({ ...e, ...f })) !== JSON.stringify(courtNumbers(e))) throw new HttpError(409, 'Courts are locked once a team event starts.');
    invalidateDraw(e.id);
    db.prepare(`UPDATE events SET ${COLS.map(c => c + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`).run(...COLS.map(c => f[c]), now(), e.id);
    if (f.status === 'cancelled' && e.status !== 'cancelled') {
      tell(e, people(e.id).filter(p => p.state !== 'withdrawn').map(p => p.athlete_id), 'events', `${e.title} was cancelled`, '');
    }
    return eventFull(eventRow(e.id), user);
  });
  /* Copy an event into weekly drafts. The format carries over; players and
     results don't. */
  r.post('/api/events/:id/duplicate', ({ user, params, body }) => {
    const e = organizerEvent(user, params.id);
    const weeks = int(body.weeks, 'weeks', { min: 1, max: 8, required: true });
    const shift = (iso, w) => (iso ? new Date(new Date(iso).getTime() + w * 7 * 864e5).toISOString() : null);
    const ids = tx(db, () => Array.from({ length: weeks }, (_, i) => insertEvent(user.id, { ...e, starts_at: shift(e.starts_at, i + 1), ends_at: shift(e.ends_at, i + 1), status: 'draft' })));
    return withStatus(201, ids.map(id => { const x = eventRow(id); return { id, title: x.title, starts_at: x.starts_at, status: x.status }; }));
  });
  /* New share or spectator link. Players already registered keep their own links. */
  r.post('/api/events/:id/links', ({ user, params, body }) => {
    const e = organizerEvent(user, params.id);
    const which = oneOf(body.reset, ['share', 'watch'], 'reset');
    db.prepare(`UPDATE events SET ${which === 'share' ? 'share_token' : 'watch_token'} = ?, updated_at = ? WHERE id = ?`).run(newToken(), now(), e.id);
    return eventFull(eventRow(e.id), user);
  });

  /* ---------- roster: registration, waitlist, attendance ---------- */
  const nextNo = eid => db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM event_people WHERE event_id = ?').get(eid).n;
  /* Every roster change is logged with what it replaced, so the latest one
     can be undone until the next change or the next round. */
  function roster(e, byUser, action, athleteId, fn) {
    const before = {};
    const touch = aid => { if (!(aid in before)) before[aid] = db.prepare('SELECT state, checked_in_at, active, on_break FROM event_people WHERE event_id = ? AND athlete_id = ?').get(e.id, aid) || null; };
    touch(athleteId);
    const out = fn(touch);
    db.prepare('INSERT INTO attendance_log (event_id, athlete_id, action, before, by_user) VALUES (?, ?, ?, ?, ?)').run(e.id, athleteId, action, JSON.stringify(before), byUser || null);
    invalidateDraw(e.id);
    return out;
  }
  function lastUndo(e) {
    const last = db.prepare('SELECT l.*, a.name FROM attendance_log l JOIN athletes a ON a.id = l.athlete_id WHERE l.event_id = ? AND l.undone = 0 ORDER BY l.id DESC LIMIT 1').get(e.id);
    if (!last) return null;
    if (db.prepare('SELECT 1 FROM rounds WHERE event_id = ? AND created_at >= ?').get(e.id, last.created_at)) return null;
    const words = { register: 'registered', waitlist: 'joined the waitlist', withdraw: 'withdrew', checkin: 'checked in', walkin: 'added as a walk-in', break: 'took a break', back: 'came back', leave: 'left', active: 'set to playing', inactive: 'set to not playing', promote: 'moved in from the waitlist', interest: 'marked interested' };
    return { id: last.id, label: `${last.name} ${words[last.action] || last.action}`, at: last.created_at };
  }
  function promoteWaitlist(e, touch) {
    const next = db.prepare("SELECT athlete_id FROM event_people WHERE event_id = ? AND state = 'waitlist' ORDER BY created_at LIMIT 1").get(e.id);
    if (!next) return;
    touch(next.athlete_id);
    db.prepare("UPDATE event_people SET state = 'registered' WHERE event_id = ? AND athlete_id = ?").run(e.id, next.athlete_id);
    tell(e, [next.athlete_id], 'events', `You’re in: ${e.title}`, 'A spot opened up and you’ve moved off the waitlist.');
  }
  function isFull(e) { return !!e.capacity && db.prepare("SELECT COUNT(*) AS n FROM event_people WHERE event_id = ? AND state = 'registered'").get(e.id).n >= e.capacity; }
  function openForSignup(e, organizer) {
    if (['complete', 'cancelled'].includes(e.status) || e.status === 'draft') throw new HttpError(409, 'This event isn’t open for sign-ups.');
    if (!e.registration_open && !organizer) throw new HttpError(409, 'Registration for this event is closed. Ask the host.');
    if (started(e)) {
      if (LOCKED.includes(e.mode)) throw new HttpError(409, 'Teams are locked now that play has started. Ask the host.');
      if (!e.late_join && !organizer) throw new HttpError(409, 'Late joining is closed for this event. Ask the host.');
    }
  }
  /* Joining after the start means you're here: checked in for the next round. */
  const lateCheckin = (e, state) => state === 'registered' && started(e);
  /* Signed-in athlete registers, joins the waitlist, marks interest or withdraws. */
  function setState(user, e, want) {
    const aid = auth.ownAthleteId(user);
    if (!aid) throw new HttpError(400, 'Set up your athlete profile first (Profile tab).');
    const cur = db.prepare('SELECT * FROM event_people WHERE event_id = ? AND athlete_id = ?').get(e.id, aid);
    if (want !== 'withdrawn') openForSignup(e, isOrganizer(user, e));
    else if (!cur) return eventFull(eventRow(e.id), user);
    if (want === 'registered' && cur && cur.state === 'registered') return eventFull(eventRow(e.id), user);
    const state = want === 'registered' && isFull(e) ? 'waitlist' : want;
    const late = lateCheckin(e, state);
    tx(db, () => roster(e, user.id, { registered: 'register', waitlist: 'waitlist', withdrawn: 'withdraw', interested: 'interest' }[state], aid, touch => {
      db.prepare(`INSERT INTO event_people (event_id, athlete_id, state, number) VALUES (?, ?, ?, ?)
        ON CONFLICT(event_id, athlete_id) DO UPDATE SET state = excluded.state, number = COALESCE(event_people.number, excluded.number)`).run(e.id, aid, state, nextNo(e.id));
      if (late) db.prepare('UPDATE event_people SET checked_in_at = COALESCE(checked_in_at, ?), active = 1, on_break = 0 WHERE event_id = ? AND athlete_id = ?').run(now(), e.id, aid);
      if (want === 'withdrawn') db.prepare('UPDATE event_people SET active = 0, on_break = 0 WHERE event_id = ? AND athlete_id = ?').run(e.id, aid);
      if (want === 'withdrawn' && cur && cur.state === 'registered') promoteWaitlist(e, touch);
    }));
    return eventFull(eventRow(e.id), user);
  }
  const visibleEvent = (user, id) => {
    auth.require(user);
    const e = eventRow(int(id, 'id', { min: 1, required: true }));
    if (!eventVisible(user, e)) throw new HttpError(404, 'Event not found.');
    return e;
  };
  r.post('/api/events/:id/interest', ({ user, params }) => setState(user, visibleEvent(user, params.id), 'interested'));
  r.post('/api/events/:id/register', ({ user, params, body }) => {
    const e = visibleEvent(user, params.id);
    const out = setState(user, e, 'registered');
    if (!body.partner_player_id) return out;
    // Fixed-partner events: sign up together. The partner is registered and told.
    if (e.partner_mode !== 'fixed') throw new HttpError(400, 'This event rotates partners.');
    const pid = parsePlayerId(body.partner_player_id);
    if (!pid || !db.prepare('SELECT 1 FROM athletes WHERE id = ?').get(pid)) throw new HttpError(400, `No player with ID ${body.partner_player_id}.`);
    const me = auth.ownAthleteId(user);
    if (db.prepare('SELECT state FROM event_people WHERE event_id = ? AND athlete_id = ?').get(e.id, me).state !== 'registered') return out; // waitlisted: pair later
    tx(db, () => roster(e, user.id, 'register', pid, () => {
      db.prepare(`INSERT INTO event_people (event_id, athlete_id, state, number) VALUES (?, ?, 'registered', ?) ON CONFLICT(event_id, athlete_id) DO UPDATE SET state = 'registered'`).run(e.id, pid, nextNo(e.id));
      makeTeam(e, [me, pid], '');
    }));
    tell(e, [pid], 'events', `${user.name} signed you up as a partner`, `${e.title}. Withdraw from the event page if that’s wrong.`);
    return eventFull(eventRow(e.id), user);
  });
  r.post('/api/events/:id/withdraw', ({ user, params }) => setState(user, visibleEvent(user, params.id), 'withdrawn'));

  /* Player's own status during the event: take a break, come back, or leave.
     Leaving frees the spot for the waitlist. Changes apply to future rounds. */
  function selfStatus(e, aid, action, byUser) {
    const cur = db.prepare('SELECT * FROM event_people WHERE event_id = ? AND athlete_id = ?').get(e.id, aid);
    if (!cur || cur.state === 'withdrawn') throw new HttpError(409, 'You aren’t registered for this event.');
    if (['complete', 'cancelled'].includes(e.status)) throw new HttpError(409, 'This event is over.');
    tx(db, () => roster(e, byUser, action, aid, touch => {
      if (action === 'break') db.prepare('UPDATE event_people SET on_break = 1 WHERE event_id = ? AND athlete_id = ?').run(e.id, aid);
      if (action === 'back') db.prepare('UPDATE event_people SET on_break = 0, active = 1 WHERE event_id = ? AND athlete_id = ?').run(e.id, aid);
      if (action === 'leave') {
        db.prepare("UPDATE event_people SET state = 'withdrawn', active = 0, on_break = 0 WHERE event_id = ? AND athlete_id = ?").run(e.id, aid);
        if (cur.state === 'registered') promoteWaitlist(e, touch);
      }
    }));
  }
  r.post('/api/events/:id/me', ({ user, params, body }) => {
    const e = visibleEvent(user, params.id);
    const aid = auth.ownAthleteId(user);
    if (!aid) throw new HttpError(400, 'Set up your athlete profile first.');
    selfStatus(e, aid, oneOf(body.action, ['break', 'back', 'leave'], 'action'), user.id);
    return eventFull(eventRow(e.id), user);
  });

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
    // Walk-ins are registered on the spot; the organizer is in control.
    tx(db, () => roster(e, user.id, 'checkin', aid, () => db.prepare(`INSERT INTO event_people (event_id, athlete_id, state, checked_in_at, active, number) VALUES (?, ?, 'registered', ?, 1, ?)
      ON CONFLICT(event_id, athlete_id) DO UPDATE SET state = 'registered', checked_in_at = COALESCE(checked_in_at, excluded.checked_in_at), active = 1, on_break = 0`).run(e.id, aid, now(), nextNo(e.id))));
    const name = db.prepare('SELECT name FROM athletes WHERE id = ?').get(aid).name;
    tell(e, [aid], 'events', `Checked in: ${e.title}`, 'You’ll be told when you’re on a court.');
    return { checked_in: { athlete_id: aid, name }, event: eventFull(eventRow(e.id), user) };
  });
  /* Players without an account. They get a player number and a private link. */
  function addGuest(e, { name, email, phone }, { state, checkedIn, byUser }) {
    const aid = Number(db.prepare('INSERT INTO athletes (name, created_by, claim_email) VALUES (?, ?, ?)').run(name, e.organizer_id, email || null).lastInsertRowid);
    const t = newToken();
    roster(e, byUser, checkedIn ? 'walkin' : state === 'waitlist' ? 'waitlist' : 'register', aid, () => db.prepare(`INSERT INTO event_people (event_id, athlete_id, state, number, guest_token, email, phone, checked_in_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(e.id, aid, state, nextNo(e.id), t, email || null, phone || null, checkedIn ? now() : null));
    return { athlete_id: aid, token: t };
  }
  function guestFields(b) {
    const email = b.email ? str(b.email, 'email', { max: 200 }).toLowerCase() : '';
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    return { name: str(b.name, 'name', { required: true, max: 60 }), email, phone: str(b.phone, 'phone', { max: 30 }) };
  }
  r.post('/api/events/:id/walkin', ({ user, params, body }) => {
    const e = organizerEvent(user, params.id);
    if (LOCKED.includes(e.mode) && started(e)) throw new HttpError(409, 'Teams are locked now that play has started.');
    const g = guestFields(body);
    const out = tx(db, () => addGuest(e, g, { state: 'registered', checkedIn: body.checked_in !== false, byUser: user.id }));
    return withStatus(201, { added: { athlete_id: out.athlete_id, name: g.name, link: `#/g/${out.token}` }, event: eventFull(eventRow(e.id), user) });
  });
  /* Organizer changes: playing / not playing, break, state (waitlist, move in, remove). */
  r.put('/api/events/:id/people/:aid', ({ user, params, body }) => {
    const e = organizerEvent(user, params.id);
    const aid = int(params.aid, 'aid', { min: 1, required: true });
    const cur = db.prepare('SELECT * FROM event_people WHERE event_id = ? AND athlete_id = ?').get(e.id, aid);
    if (!cur) throw new HttpError(404, 'That player isn’t in this event.');
    const action = body.state !== undefined ? ({ registered: 'promote', waitlist: 'waitlist', withdrawn: 'leave' }[body.state] || 'state') : body.on_break !== undefined ? (body.on_break ? 'break' : 'back') : body.checked_in ? 'checkin' : body.active ? 'active' : 'inactive';
    tx(db, () => roster(e, user.id, action, aid, touch => {
      if (body.active !== undefined) db.prepare('UPDATE event_people SET active = ? WHERE event_id = ? AND athlete_id = ?').run(body.active ? 1 : 0, e.id, aid);
      if (body.on_break !== undefined) db.prepare('UPDATE event_people SET on_break = ? WHERE event_id = ? AND athlete_id = ?').run(body.on_break ? 1 : 0, e.id, aid);
      if (body.checked_in) db.prepare('UPDATE event_people SET checked_in_at = COALESCE(checked_in_at, ?), active = 1 WHERE event_id = ? AND athlete_id = ?').run(now(), e.id, aid);
      if (body.state !== undefined) {
        const st = oneOf(body.state, ['registered', 'waitlist', 'withdrawn'], 'state');
        db.prepare('UPDATE event_people SET state = ? WHERE event_id = ? AND athlete_id = ?').run(st, e.id, aid);
        if (st === 'withdrawn') db.prepare('UPDATE event_people SET active = 0 WHERE event_id = ? AND athlete_id = ?').run(e.id, aid);
        if (st === 'withdrawn' && cur.state === 'registered') promoteWaitlist(e, touch);
      }
    }));
    return eventFull(eventRow(e.id), user);
  });
  r.post('/api/events/:id/attendance/undo', ({ user, params }) => {
    const e = organizerEvent(user, params.id);
    const u = lastUndo(e);
    if (!u) throw new HttpError(409, 'Nothing to undo. Changes can only be undone before the next round starts.');
    const last = db.prepare('SELECT * FROM attendance_log WHERE id = ?').get(u.id);
    tx(db, () => {
      Object.entries(JSON.parse(last.before)).forEach(([aid, row]) => {
        if (!row) db.prepare('DELETE FROM event_people WHERE event_id = ? AND athlete_id = ?').run(e.id, Number(aid));
        else db.prepare('UPDATE event_people SET state = ?, checked_in_at = ?, active = ?, on_break = ? WHERE event_id = ? AND athlete_id = ?').run(row.state, row.checked_in_at, row.active, row.on_break, e.id, Number(aid));
      });
      db.prepare('UPDATE attendance_log SET undone = 1 WHERE id = ?').run(last.id);
    });
    return eventFull(eventRow(e.id), user);
  });

  /* ---------- rounds ----------
     Built from whoever is checked in, playing and not on a break right now,
     so late arrivals join the next round and departures drop out of it. The
     organizer previews a round, then starts exactly that round (same seed). */
  function history(eventId) {
    const h = F.emptyHistory();
    db.prepare('SELECT id FROM matches WHERE event_id = ?').all(eventId).forEach(m => {
      const ps = players(m.id).filter(p => p.athlete_id);
      F.addMatch(h, [1, 2].map(t => ps.filter(p => p.team === t).map(p => ({ athlete_id: p.athlete_id, side: p.side }))));
    });
    db.prepare('SELECT sitting_out FROM rounds WHERE event_id = ?').all(eventId).forEach(rd => F.addSitting(h, JSON.parse(rd.sitting_out)));
    return h;
  }
  function pool(e) { return people(e.id).filter(p => p.state === 'registered' && p.checked_in_at && p.active && !p.on_break); }
  const nextRound = eid => (db.prepare('SELECT MAX(number) AS n FROM rounds WHERE event_id = ?').get(eid).n || 0) + 1;
  function planRound(e, seed) {
    const rand = F.rng(seed);
    const number = nextRound(e.id);
    if (e.mode === 'fallout') throw new HttpError(400, 'Fallout runs as a bracket. Build it on the Bracket tab.');
    if (e.round_limit && number > e.round_limit) throw new HttpError(409, `All ${e.round_limit} rounds have been played. Finish the event, or raise the round limit in Edit.`);
    if (e.mode === 'race') { const race = raceInfo(e, standings(e)); if (race.finished) throw new HttpError(409, `${race.leader.name} reached ${e.race_target}. The race is over.`); }
    const avail = pool(e);
    if (TEAM_MODES.includes(e.mode)) {
      const ready = new Set(avail.map(p => p.athlete_id));
      const teamPool = teamsOf(e.id).filter(t => members(t).every(a => ready.has(a)));
      if (teamPool.length < 2) throw new HttpError(400, `Need at least 2 teams with every player checked in. ${teamPool.length} now.`);
      const tp = buildTeamRound(teamPool, courtNumbers(e).length, e.id, rand);
      const onCourt = new Set(tp.pairs.flatMap(([a, b]) => members(a).concat(members(b))));
      return { number, kind: 'teams', pairs: tp.pairs.map(([a, b]) => [a.id, b.id]), sitting: avail.map(p => p.athlete_id).filter(id => !onCourt.has(id)) };
    }
    if (avail.length < 4) throw new HttpError(400, `Need at least 4 checked-in players who are playing. ${avail.length} now.`);
    if (e.mode === 'premapped') {
      let sched = e.schedule ? JSON.parse(e.schedule) : null;
      const entry = sched && sched.rounds[number - sched.first];
      const ids = new Set(avail.map(p => p.athlete_id));
      const inEntry = entry ? entry.courts.flat(2).map(x => x[0]).concat(entry.sitting) : [];
      const fits = entry && inEntry.every(id => ids.has(id)) && avail.every(p => inEntry.includes(p.athlete_id));
      if (fits) return { number, kind: 'players', courts: entry.courts, sitting: entry.sitting, starts: null };
      // Attendance changed (or no schedule yet): rebuild the rounds still to come.
      const total = e.round_limit || (sched ? sched.first + sched.rounds.length - 1 : 8);
      const left = Math.max(1, total - number + 1);
      sched = { first: number, rounds: F.premap(avail, courtNumbers(e).length, left, history(e.id), rand) };
      return { number, kind: 'players', courts: sched.rounds[0].courts, sitting: sched.rounds[0].sitting, starts: null, schedule: sched, rebuilt: !!e.schedule };
    }
    const plan = F.buildRound(avail, courtNumbers(e).length, history(e.id), rand, { rivalry: e.mode === 'rivalry' });
    return {
      number, kind: 'players',
      courts: plan.courts.map(teams => teams.map(t => t.map(([p, side]) => [p.athlete_id, side]))),
      sitting: plan.sitting.map(p => p.athlete_id),
      starts: e.mode === 'unlucky' ? F.headstarts(plan.courts.length, rand) : null
    };
  }
  const nameOf = id => (db.prepare('SELECT name FROM athletes WHERE id = ?').get(id) || {}).name || '';
  function planView(e, plan, seed) {
    const teams = {}; teamsOf(e.id).forEach(t => { teams[t.id] = t; });
    const nums = courtNumbers(e);
    const courts = plan.kind === 'teams'
      ? plan.pairs.map(([a, b], i) => ({ court: nums[i], teams: [teams[a], teams[b]].map(t => ({ label: t.label, players: members(t).map(id => ({ athlete_id: id, name: nameOf(id) })) })), games: e.mode === 'draft3' ? 3 : 1 }))
      : plan.courts.map((c, i) => ({ court: nums[i], start: plan.starts ? plan.starts[i] : [0, 0], teams: c.map(t => ({ players: t.map(([id, side]) => ({ athlete_id: id, name: nameOf(id), side })) })) }));
    // Pre-Mapped Doubles: the whole plan, not just the next round.
    const schedule = plan.schedule ? scheduleRounds(e, plan.schedule) : e.mode === 'premapped' ? scheduleView(e) : undefined;
    return { seed, number: plan.number, courts, sitting: plan.sitting.map(id => ({ athlete_id: id, name: nameOf(id) })), rebuilt: !!plan.rebuilt, schedule, timer_minutes: e.round_minutes || null };
  }
  function scheduleRounds(e, sched) {
    const nums = courtNumbers(e);
    return sched.rounds.map((rd, i) => ({ number: sched.first + i, courts: rd.courts.map(c => c.map(t => t.map(([id]) => nameOf(id).split(' ')[0]).join(' & '))), court_nums: rd.courts.map((_, ci) => nums[ci]), sitting: rd.sitting.map(id => nameOf(id).split(' ')[0]) }));
  }
  function scheduleView(e) {
    if (!e.schedule) return null;
    const sched = JSON.parse(e.schedule);
    const next = nextRound(e.id);
    return scheduleRounds(e, sched).filter(x => x.number >= next);
  }
  r.get('/api/events/:id/rounds/preview', ({ user, params, query }) => {
    const e = organizerEvent(user, params.id);
    const seed = query.get('seed') ? int(query.get('seed'), 'seed', { min: 0 }) : crypto.randomInt(1e9);
    const plan = planRound(e, seed);
    // Saved so "Start" runs exactly this draw. Previewing doesn't start anything.
    db.prepare('UPDATE events SET draw = ? WHERE id = ?').run(JSON.stringify({ kind: 'round', number: plan.number, seed, at: now() }), e.id);
    return planView(e, plan, seed);
  });
  /* Pre-Mapped Doubles: build (or rebuild) every round up front. */
  r.post('/api/events/:id/schedule', ({ user, params, body }) => {
    const e = organizerEvent(user, params.id);
    if (e.mode !== 'premapped') throw new HttpError(400, 'Only Pre-Mapped Doubles events have a schedule.');
    const seed = body.seed === undefined ? crypto.randomInt(1e9) : int(body.seed, 'seed', { min: 0 });
    let avail = pool(e);
    if (avail.length < 4) avail = people(e.id).filter(p => p.state === 'registered'); // before check-in: plan from sign-ups
    if (avail.length < 4) throw new HttpError(400, `Need at least 4 players. ${avail.length} now.`);
    const number = nextRound(e.id);
    const total = e.round_limit || 8;
    const sched = { first: number, rounds: F.premap(avail, courtNumbers(e).length, Math.max(1, total - number + 1), history(e.id), F.rng(seed)) };
    db.prepare('UPDATE events SET schedule = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(sched), now(), e.id);
    invalidateDraw(e.id);
    return eventFull(eventRow(e.id), user);
  });
  r.post('/api/events/:id/rounds', ({ user, params, body }) => {
    const e = organizerEvent(user, params.id);
    const open = db.prepare("SELECT number FROM rounds WHERE event_id = ? AND status = 'live'").get(e.id);
    if (open && !body.force) throw new HttpError(409, `Round ${open.number} still has matches without scores. Finish it, or start the next round anyway.`);
    let seed;
    if (body.seed !== undefined) seed = int(body.seed, 'seed', { min: 0 });
    else {
      const d = drawOf(e);
      if (d && d.stale) throw new HttpError(409, 'The roster or settings changed since your preview. Preview again before starting.', { stale_preview: true });
      seed = d && d.kind === 'round' && d.number === nextRound(e.id) ? d.seed : crypto.randomInt(1e9);
    }
    const plan = planRound(e, seed);
    const teams = {}; teamsOf(e.id).forEach(t => { teams[t.id] = t; });
    const nums = courtNumbers(e);
    // A new timed round starts ready, paused, until the host starts the timer.
    const dur = e.round_minutes ? e.round_minutes * 60 : null;
    tx(db, () => {
      if (open) db.prepare("UPDATE rounds SET status = 'done' WHERE event_id = ? AND status = 'live'").run(e.id);
      if (e.status === 'published' || e.status === 'draft') db.prepare("UPDATE events SET status = 'live', updated_at = ? WHERE id = ?").run(now(), e.id);
      const roundId = Number(db.prepare('INSERT INTO rounds (event_id, number, sitting_out, duration_sec, remaining_sec) VALUES (?, ?, ?, ?, ?)').run(e.id, plan.number, JSON.stringify(plan.sitting), dur, dur).lastInsertRowid);
      db.prepare('UPDATE events SET draw = NULL WHERE id = ?').run(e.id);
      if (plan.kind === 'teams') {
        plan.pairs.forEach(([a, b], ci) => {
          if (e.mode === 'draft3') {
            const mu = db.prepare('SELECT COALESCE(MAX(matchup), 0) + 1 AS n FROM matches WHERE event_id = ?').get(e.id).n;
            F.draftGames(members(teams[a]), members(teams[b])).forEach(([x, y], gi) => insertMatch(e, { round_id: roundId, court: nums[ci], matchup: mu, note: `Game ${gi + 1} of 3` }, [[[x[0], 'right'], [x[1], 'left']], [[y[0], 'right'], [y[1], 'left']]]));
          } else insertMatch(e, { round_id: roundId, court: nums[ci] }, [teamPlayers(teams[a]), teamPlayers(teams[b])]);
        });
      } else {
        plan.courts.forEach((c, ci) => insertMatch(e, { round_id: roundId, court: nums[ci], start1: plan.starts ? plan.starts[ci][0] : 0, start2: plan.starts ? plan.starts[ci][1] : 0 }, c));
      }
      if (plan.schedule) db.prepare('UPDATE events SET schedule = ? WHERE id = ?').run(JSON.stringify(plan.schedule), e.id);
    });
    // "Round 2: Court 1 · Left side with Sam vs Jo & Max"
    if (plan.kind === 'teams') plan.pairs.forEach(([a, b], ci) => notifyTeams(e, teams[a], teams[b], `Round ${plan.number}: Court ${nums[ci]}`));
    else plan.courts.forEach((c, ci) => c.forEach((team, ti) => team.forEach(([aid, side]) => {
      const partner = team.find(([q]) => q !== aid);
      const opp = c[1 - ti].map(([q]) => nameOf(q).split(' ')[0]).join(' & ');
      const head = plan.starts ? ` You start on ${plan.starts[ci][ti]}.` : '';
      tell(e, [aid], 'courts', `Round ${plan.number}: Court ${nums[ci]}`, `${side === 'left' ? 'Left' : 'Right'} side with ${partner ? nameOf(partner[0]).split(' ')[0] : ''} vs ${opp}.${head}`);
    })));
    tell(e, plan.sitting, 'up_next', 'You’re up next', `You’re resting in round ${plan.number}.`);
    return withStatus(201, eventFull(eventRow(e.id), user));
  });
  /* Stop all courts: players enter the score as it stands (ties allowed). */
  r.post('/api/events/:id/stop', ({ user, params }) => {
    const e = organizerEvent(user, params.id);
    const rd = db.prepare("SELECT * FROM rounds WHERE event_id = ? AND status = 'live' ORDER BY number DESC LIMIT 1").get(e.id);
    if (!rd) throw new HttpError(409, 'No round is being played.');
    if (!rd.stopped_at) db.prepare('UPDATE rounds SET stopped_at = ? WHERE id = ?').run(now(), rd.id);
    const waiting = db.prepare("SELECT id FROM matches WHERE round_id = ? AND status = 'scheduled'").all(rd.id).flatMap(x => players(x.id).map(p => p.athlete_id));
    tell(e, waiting, 'courts', `Stop play: round ${rd.number}`, 'Enter your score as it stands.');
    return eventFull(eventRow(e.id), user);
  });

  /* ---------- round timer: start, stop (pause), resume, add a minute, reset ----------
     Commands name the round, so a stale screen can't change a different one. */
  function currentRound(e, n) {
    const number = int(n, 'round', { min: 1, required: true });
    const rd = db.prepare('SELECT * FROM rounds WHERE event_id = ? AND number = ?').get(e.id, number);
    if (!rd) throw new HttpError(404, 'Round not found.');
    if (number !== nextRound(e.id) - 1) throw new HttpError(409, `Round ${number} isn’t the current round. Refresh the screen.`);
    if (rd.status === 'done' || rd.stopped_at) throw new HttpError(409, `Round ${number} has ended, so its timer can’t change.`);
    if (rd.duration_sec == null && !rd.ends_at) throw new HttpError(400, 'This round has no timer. Set a round length for upcoming rounds.');
    if (rd.duration_sec == null) { // an older running round: give it a duration so it can pause
      const left = Math.max(0, Math.round((new Date(rd.ends_at) - Date.now()) / 1000));
      rd.duration_sec = e.round_minutes ? e.round_minutes * 60 : left; rd.remaining_sec = left;
      db.prepare('UPDATE rounds SET duration_sec = ?, remaining_sec = ? WHERE id = ?').run(rd.duration_sec, rd.remaining_sec, rd.id);
    }
    return rd;
  }
  const setTimer = (rd, remaining, running) => db.prepare('UPDATE rounds SET remaining_sec = ?, ends_at = ? WHERE id = ?')
    .run(remaining, running ? new Date(Date.now() + remaining * 1000).toISOString() : null, rd.id);
  r.post('/api/events/:id/timer', ({ user, params, body }) => {
    const e = organizerEvent(user, params.id);
    const rd = currentRound(e, body.round);
    const t = timerOf(rd);
    const run = body.running === true;
    if (run && !t.running) {
      if (t.remaining <= 0) throw new HttpError(409, 'Time is up. Add a minute or reset the timer first.');
      setTimer(rd, t.remaining, true);
    } else if (!run && t.running) setTimer(rd, t.remaining, false);
    return eventFull(eventRow(e.id), user);
  });
  r.post('/api/events/:id/timer/adjust', ({ user, params, body }) => {
    const e = organizerEvent(user, params.id);
    const rd = currentRound(e, body.round);
    const op = oneOf(body.operation, ['add', 'reset'], 'operation');
    const t = timerOf(rd);
    if (op === 'reset') setTimer(rd, rd.duration_sec, false);
    else if (t.running && t.remaining > 0) setTimer(rd, t.remaining + 60, true);
    else setTimer(rd, t.remaining + 60, false); // paused, or ran out: stays paused for the host to restart
    return eventFull(eventRow(e.id), user);
  });
  /* Courts in use for future rounds. Current matches keep their courts. */
  r.post('/api/events/:id/courts', ({ user, params, body }) => {
    const e = organizerEvent(user, params.id);
    const nums = courtList(body.numbers);
    if (LOCKED.includes(e.mode) && started(e)) throw new HttpError(409, 'Courts are locked once a team event starts.');
    db.prepare('UPDATE events SET court_numbers = ?, courts = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(nums), nums.length, now(), e.id);
    invalidateDraw(e.id);
    return eventFull(eventRow(e.id), user);
  });

  /* ---------- rotation fairness (host visibility; not a balancing rule) ----------
     Counts completed rounds only. Time before arriving and breaks aren't
     scheduled rests, and rest is counted in rounds, not minutes. */
  function fairness(e) {
    const rounds = db.prepare('SELECT * FROM rounds WHERE event_id = ? ORDER BY number').all(e.id);
    const live = rounds.find(x => x.status === 'live');
    const ps = people(e.id).filter(p => p.state === 'registered' || (p.state === 'withdrawn' && p.checked_in_at));
    const stats = {};
    ps.forEach(p => { stats[p.athlete_id] = { athlete_id: p.athlete_id, name: p.name, number: p.number, games: 0, rests: 0, run: 0, longest_rest: 0, partners: {} }; });
    const inMatches = rd => {
      const out = new Set();
      db.prepare('SELECT id FROM matches WHERE round_id = ?').all(rd.id).forEach(m => players(m.id).forEach(p => out.add(p.athlete_id)));
      return out;
    };
    rounds.filter(x => x.status === 'done').forEach(rd => {
      const sat = new Set(JSON.parse(rd.sitting_out));
      db.prepare('SELECT id FROM matches WHERE round_id = ?').all(rd.id).forEach(m => {
        const pl = players(m.id);
        pl.forEach(p => {
          const st = stats[p.athlete_id]; if (!st) return;
          st.games++; st.run = 0;
          pl.filter(q => q.team === p.team && q.athlete_id !== p.athlete_id).forEach(q => { st.partners[q.athlete_id] = (st.partners[q.athlete_id] || 0) + 1; });
        });
      });
      sat.forEach(id => { const st = stats[id]; if (st) { st.rests++; st.run++; st.longest_rest = Math.max(st.longest_rest, st.run); } });
    });
    const playingNow = live ? inMatches(live) : new Set(), restingNow = live ? new Set(JSON.parse(live.sitting_out)) : new Set();
    return ps.map(p => {
      const st = stats[p.athlete_id];
      const now_ = p.state === 'withdrawn' ? 'left' : p.on_break ? 'on break' : playingNow.has(p.athlete_id) ? 'playing' : restingNow.has(p.athlete_id) ? 'resting' : 'waiting';
      return { athlete_id: st.athlete_id, name: st.name, number: st.number, now: now_, games: st.games, rests: st.rests, longest_rest: st.longest_rest, repeated_partners: Object.values(st.partners).reduce((a, n) => a + Math.max(0, n - 1), 0) };
    }).sort((a, b) => (a.number || 0) - (b.number || 0));
  }

  /* ---------- public links: sign-up page, spectator view, player page ---------- */
  function byShare(token) {
    const e = db.prepare('SELECT * FROM events WHERE share_token = ?').get(String(token));
    if (!e || e.status === 'draft') throw new HttpError(404, 'This event link isn’t active. Ask the host for a new one.');
    return e;
  }
  function byWatch(token) {
    const e = db.prepare('SELECT * FROM events WHERE watch_token = ?').get(String(token));
    if (!e || e.status === 'draft') throw new HttpError(404, 'This spectator link isn’t active. Ask the host for a new one.');
    return e;
  }
  function guestRow(token) {
    const ep = db.prepare('SELECT ep.*, a.name, a.user_id FROM event_people ep JOIN athletes a ON a.id = ep.athlete_id WHERE ep.guest_token = ?').get(String(token));
    if (!ep) throw new HttpError(404, 'This player link isn’t valid. Ask the host to resend it.');
    return { ep, e: eventRow(ep.event_id) };
  }
  const publicShape = (e, data) => {
    const st = started(e);
    const open = !!e.registration_open && ['published', 'live'].includes(e.status) && (!st || (!LOCKED.includes(e.mode) && !!e.late_join));
    return { ...data, registration: { open, full: isFull(e), late: st && open } };
  };
  r.get('/api/public/events/:token', ({ user, params }) => {
    const e = byShare(params.token);
    const aid = user ? auth.ownAthleteId(user) : null;
    return { ...publicShape(e, eventData(e, { org: false, athleteId: aid, user })), signed_in: !!user, has_profile: !!aid };
  });
  r.post('/api/public/events/:token/register', ({ user, params, body, req }) => {
    const e = byShare(params.token);
    openForSignup(e, false);
    if (user && auth.ownAthleteId(user)) { const out = setState(user, e, 'registered'); return withStatus(201, { event_id: e.id, account: true, state: out.me.state }); }
    const fwd = ctx.config.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
    if (!joinLimit(fwd || req.socket.remoteAddress || 'x')) throw new HttpError(429, 'Too many sign-ups from this device. Try again later.');
    const g = guestFields(body);
    if (!g.email) throw new HttpError(400, 'Enter your email so the host can reach you.');
    if (db.prepare("SELECT 1 FROM event_people WHERE event_id = ? AND email = ? AND state != 'withdrawn'").get(e.id, g.email)) {
      throw new HttpError(409, 'That email is already signed up for this event. Use the player link from when you signed up, or ask the host to resend it.');
    }
    const state = isFull(e) ? 'waitlist' : 'registered';
    const out = tx(db, () => addGuest(e, g, { state, checkedIn: lateCheckin(e, state), byUser: null }));
    if (ctx.mailer && ctx.mailer.enabled && ctx.config.publicUrl) {
      const link = `${ctx.config.publicUrl}/#/g/${out.token}`;
      ctx.mailer.sendSoon({ to: g.email, subject: `You’re ${state === 'waitlist' ? 'on the waitlist' : 'in'}: ${e.title}`, text: `${e.title}\n${e.location || ''}\n\nYour player page (keep this link; it shows your court, partner and scores):\n${link}`, html: `<p><b>${e.title.replace(/</g, '&lt;')}</b></p><p><a href="${link}">Open your player page</a>. Keep this link: it shows your court, partner and scores.</p>` });
    }
    const ep = db.prepare('SELECT number, state FROM event_people WHERE guest_token = ?').get(out.token);
    return withStatus(201, { token: out.token, state: ep.state, number: ep.number });
  });
  r.get('/api/watch/:token', ({ params }) => {
    const e = byWatch(params.token);
    return eventData(e, { org: false });
  });
  function guestView(ep, e) {
    const data = publicShape(e, eventData(e, { org: false, athleteId: ep.athlete_id }));
    data.guest = { name: ep.name, number: ep.number, linked: !!ep.user_id, player_id: playerId(ep.athlete_id), qr: 'THELAB:' + checkinCode(ep.athlete_id), alerts: db.prepare('SELECT COUNT(*) AS n FROM guest_push WHERE athlete_id = ?').get(ep.athlete_id).n > 0 };
    return data;
  }
  r.get('/api/g/:token', ({ params }) => { const { ep, e } = guestRow(params.token); return guestView(ep, e); });
  /* A player without an account enters the score for their own match. */
  r.post('/api/g/:token/score', ({ params, body }) => {
    const { ep, e } = guestRow(params.token);
    const m = matchRow(uuid(body.match_id, 'match_id'));
    const ps = m && players(m.id);
    if (!m || m.event_id !== e.id || !ps.some(p => p.athlete_id === ep.athlete_id)) throw new HttpError(404, 'Match not found.');
    if (m.status === 'verified' || m.status === 'confirmed') throw new HttpError(409, 'The host has confirmed this score. Ask them to reopen it.');
    if (body.version !== undefined && int(body.version, 'version', { min: 1 }) !== m.version) throw new HttpError(409, 'Someone else just entered this score. Check it.', { current: full(m.id, null) });
    const gs = gamesInput(body.games, m.best_of, scoreRules(m));
    const first = m.status === 'scheduled';
    tx(db, () => {
      log(m.id, null, first ? 'scored' : 'corrected', `by ${ep.name}`, first ? null : snapshot(m.id));
      db.prepare('DELETE FROM match_games WHERE match_id = ?').run(m.id);
      gs.forEach((g, i) => db.prepare('INSERT INTO match_games (match_id, idx, team1, team2) VALUES (?, ?, ?, ?)').run(m.id, i, g[0], g[1]));
      db.prepare("UPDATE matches SET status = 'recorded', winner = ?, version = version + 1, updated_at = ?, played_at = ? WHERE id = ?").run(decide(gs), now(), now(), m.id);
    });
    afterScore(m.id);
    notify(participantsUsers(ps, null), 'matches', `${ep.name} entered your score`, 'Confirm it, or dispute it.', `#/play/match/${m.id}`);
    return guestView(ep, eventRow(e.id));
  });
  r.post('/api/g/:token/ack', ({ params, body }) => {
    const { ep } = guestRow(params.token);
    const m = matchRow(uuid(body.match_id, 'match_id'));
    if (!m || !players(m.id).some(p => p.athlete_id === ep.athlete_id)) throw new HttpError(404, 'Match not found.');
    db.prepare('INSERT OR IGNORE INTO match_acks (match_id, athlete_id) VALUES (?, ?)').run(m.id, ep.athlete_id);
    return withStatus(204, null);
  });
  r.post('/api/g/:token/status', ({ params, body }) => {
    const { ep, e } = guestRow(params.token);
    selfStatus(e, ep.athlete_id, oneOf(body.action, ['break', 'back', 'leave'], 'action'), null);
    return guestView(guestRow(params.token).ep, eventRow(e.id));
  });
  r.post('/api/g/:token/push', ({ params, body }) => {
    const { ep } = guestRow(params.token);
    if (!ctx.push || !ctx.push.enabled) throw new HttpError(404, 'Phone notifications aren’t set up on this server yet.');
    const endpoint = String(body.endpoint || '');
    let u; try { u = new URL(endpoint); } catch { throw new HttpError(400, 'endpoint must be a URL.'); }
    if (u.protocol !== 'https:') throw new HttpError(400, 'endpoint must be https.');
    const keys = body.keys || {};
    if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100) throw new HttpError(400, 'keys.p256dh and keys.auth are required.');
    db.prepare(`INSERT INTO guest_push (athlete_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET athlete_id = excluded.athlete_id, p256dh = excluded.p256dh, auth = excluded.auth, last_status = NULL`).run(ep.athlete_id, endpoint, keys.p256dh, keys.auth);
    if (body.test) ctx.push.toGuest(ep.athlete_id, { title: 'THE LAB', body: 'Court alerts are on for this phone.', link: `#/g/${ep.guest_token}` });
    return withStatus(204, null);
  });
  r.post('/api/g/:token/push/off', ({ params, body }) => {
    const { ep } = guestRow(params.token);
    db.prepare('DELETE FROM guest_push WHERE athlete_id = ? AND endpoint = ?').run(ep.athlete_id, String(body.endpoint || ''));
    return withStatus(204, null);
  });

  /* ---------- My Events: bring a link-based registration into an account ---------- */
  function mergeAthlete(from, to) {
    db.prepare('SELECT event_id FROM event_people WHERE athlete_id = ?').all(from).forEach(({ event_id }) => {
      if (db.prepare('SELECT 1 FROM event_people WHERE event_id = ? AND athlete_id = ?').get(event_id, to)) throw new HttpError(409, 'Your account is already signed up for that event, so the two registrations can’t be combined. Ask the host to remove one.');
    });
    const events = db.prepare('SELECT event_id FROM event_people WHERE athlete_id = ?').all(from).map(x => x.event_id);
    db.prepare('UPDATE event_people SET athlete_id = ? WHERE athlete_id = ?').run(to, from);
    db.prepare('UPDATE match_players SET athlete_id = ? WHERE athlete_id = ?').run(to, from);
    ['p1', 'p2', 'p3'].forEach(c => db.prepare(`UPDATE event_teams SET ${c} = ? WHERE ${c} = ?`).run(to, from));
    db.prepare('UPDATE OR IGNORE match_acks SET athlete_id = ? WHERE athlete_id = ?').run(to, from);
    db.prepare('UPDATE attendance_log SET athlete_id = ? WHERE athlete_id = ?').run(to, from);
    const swap = id => (id === from ? to : id);
    events.forEach(eid => {
      db.prepare('SELECT id, sitting_out FROM rounds WHERE event_id = ?').all(eid).forEach(rd => db.prepare('UPDATE rounds SET sitting_out = ? WHERE id = ?').run(JSON.stringify(JSON.parse(rd.sitting_out).map(swap)), rd.id));
      const ev = db.prepare('SELECT schedule FROM events WHERE id = ?').get(eid);
      if (ev.schedule) {
        const s = JSON.parse(ev.schedule);
        s.rounds.forEach(rd => { rd.sitting = rd.sitting.map(swap); rd.courts = rd.courts.map(c => c.map(t => t.map(([id, side]) => [swap(id), side]))); });
        db.prepare('UPDATE events SET schedule = ? WHERE id = ?').run(JSON.stringify(s), eid);
      }
    });
    db.prepare('DELETE FROM athletes WHERE id = ?').run(from);
  }
  r.post('/api/me/link-guest', ({ user, body }) => {
    auth.require(user);
    const t = str(body.token, 'token', { required: true, max: 300 }).replace(/^.*#\/g\//, '').trim();
    const ep = db.prepare('SELECT ep.*, a.user_id FROM event_people ep JOIN athletes a ON a.id = ep.athlete_id WHERE ep.guest_token = ?').get(t);
    if (!ep) throw new HttpError(404, 'That player link wasn’t found.');
    if (ep.user_id) {
      if (ep.user_id === user.id) return { event_id: ep.event_id, linked: true };
      throw new HttpError(409, 'That registration is already linked to another account.');
    }
    const mine = auth.ownAthleteId(user);
    tx(db, () => {
      if (!mine) db.prepare('UPDATE athletes SET user_id = ?, updated_at = ? WHERE id = ?').run(user.id, now(), ep.athlete_id);
      else mergeAthlete(ep.athlete_id, mine);
    });
    return { event_id: ep.event_id, linked: true };
  });

  /* ---------- leaderboard ---------- */
  r.get('/api/leaderboard', ({ user, query }) => {
    auth.require(user);
    const days = int(query.get('days'), 'days', { min: 1, max: 3650 }) || 90;
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const rows = {};
    db.prepare("SELECT id, winner FROM matches WHERE status IN ('confirmed','verified') AND winner IS NOT NULL AND played_at >= ?").all(since).forEach(m => {
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

  /* For other modules: Team Planner turns a plan into a live event. */
  ctx.play = {
    tell, pushGuests, eventRow, insertEvent, addGuest,
    addAthlete(e, aid, byUser) {
      roster(e, byUser, 'register', aid, () => db.prepare(`INSERT INTO event_people (event_id, athlete_id, state, number) VALUES (?, ?, 'registered', ?) ON CONFLICT(event_id, athlete_id) DO NOTHING`).run(e.id, aid, nextNo(e.id)));
    }
  };
};
module.exports.decide = decide;
module.exports.SCORING = SCORING;
module.exports.ROUND_END = ROUND_END;
