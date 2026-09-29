'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff } = require('./helpers.js');
const F = require('../server/formats.js');

const soon = () => new Date(Date.now() + 3600e3).toISOString();
const tokenOf = link => link.split('/').pop();
async function event(coach, extra) {
  return (await coach.post('/api/events', { title: 'Mixer', starts_at: soon(), status: 'published', courts: 2, ...extra })).body;
}
/* n players who join through the share link, without accounts. */
async function guests(s, e, n, prefix = 'G') {
  const anon = s.client();
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = await anon.post(`/api/public/events/${tokenOf(e.links.share)}/register`, { name: `${prefix}${i} Player`, email: `${prefix.toLowerCase()}${i}@x.test` });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    out.push({ token: r.body.token, number: r.body.number, state: r.body.state });
  }
  return { anon, list: out };
}
async function checkInAll(coach, e) {
  const ev = (await coach.get(`/api/events/${e.id}`)).body;
  for (const p of ev.people.filter(x => x.state === 'registered')) await coach.put(`/api/events/${e.id}/people/${p.athlete_id}`, { checked_in: true });
  return (await coach.get(`/api/events/${e.id}`)).body;
}

test('formats: bracket graphs, 3v3 pairings, snake draft', () => {
  const single = F.bracketGraph(5, 'single');
  assert.equal(single.size, 8);
  assert.equal(single.games.length, 7);
  const dbl = F.bracketGraph(8, 'double');
  assert.equal(dbl.games.filter(g => g.section === 'L').length, 6);
  assert.deepEqual(dbl.games.filter(g => g.section === 'F').map(g => g.code), ['F0-0', 'F1-0']);
  // Every losers-side source points at a real game.
  const codes = new Set(dbl.games.map(g => g.code));
  dbl.games.forEach(g => [g.src_a, g.src_b].forEach(s => { if (!s.startsWith('seed:')) assert.ok(codes.has(s.split(':')[1]), s); }));
  // 3v3: everyone partners each teammate once.
  const gs = F.draftGames([1, 2, 3], [4, 5, 6]);
  assert.equal(gs.length, 3);
  const partners = new Set(gs.map(g => g[0].join('+')));
  assert.equal(partners.size, 3);
  assert.deepEqual(F.snakeTeams(['a', 'b', 'c', 'd', 'e', 'f'], 2), [['a', 'd', 'e'], ['b', 'c', 'f']]);
});

test('guest sign-up link, player page, own score, host confirm, spectator link, link resets', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const e = await event(coach, { capacity: 5 });
  assert.ok(e.links.share && e.links.watch, 'organizer gets links');
  const share = tokenOf(e.links.share);

  // Anyone with the link sees the event; drafts are hidden.
  const anon = s.client();
  const pub = (await anon.get(`/api/public/events/${share}`)).body;
  assert.equal(pub.title, 'Mixer');
  assert.equal(pub.registration.open, true);
  assert.equal(pub.links, undefined, 'no host links on the public page');

  const g = await guests(s, e, 6);
  assert.deepEqual(g.list.map(x => x.number), [1, 2, 3, 4, 5, 6], 'player numbers in order');
  assert.equal(g.list[5].state, 'waitlist', 'capacity 5: sixth is waitlisted');
  // Same email twice is refused.
  assert.equal((await anon.post(`/api/public/events/${share}/register`, { name: 'Again', email: 'g0@x.test' })).status, 409);

  // Host sees contact details and player links.
  let ev = (await coach.get(`/api/events/${e.id}`)).body;
  const p0 = ev.people.find(p => p.number === 1);
  assert.equal(p0.email, 'g0@x.test');
  assert.ok(p0.link.startsWith('#/g/'));
  assert.equal(p0.alerts, 'off');

  // Walk-in, then everyone checks in; 5 registered + 1 walk-in = 6 players.
  const w = await coach.post(`/api/events/${e.id}/walkin`, { name: 'Walk In' });
  assert.equal(w.status, 201);
  ev = await checkInAll(coach, e);
  assert.equal(ev.counts.checked_in, 6);

  // Preview, then start exactly the previewed round.
  const pv = (await coach.get(`/api/events/${e.id}/rounds/preview?seed=11`)).body;
  assert.equal(pv.number, 1);
  assert.equal(pv.courts.length, 1);
  assert.equal(pv.sitting.length, 2);
  ev = (await coach.post(`/api/events/${e.id}/rounds`, { seed: 11 })).body;
  const m = ev.rounds[0].matches[0];
  assert.deepEqual(m.players.map(p => p.athlete_id).sort(), pv.courts[0].teams.flatMap(x => x.players.map(p => p.athlete_id)).sort(), 'started as previewed');

  // A guest on court: the player page shows it; they acknowledge and score it.
  const onCourt = ev.people.find(p => m.players.some(x => x.athlete_id === p.athlete_id) && p.link);
  const gt = tokenOf(onCourt.link);
  let gv = (await anon.get(`/api/g/${gt}`)).body;
  assert.equal(gv.me.athlete_id, onCourt.athlete_id);
  assert.ok(gv.guest.qr.startsWith('THELAB:'));
  assert.equal((await anon.post(`/api/g/${gt}/ack`, { match_id: m.id })).status, 204);
  const mine = m.players.find(p => p.athlete_id === onCourt.athlete_id).team;
  gv = (await anon.post(`/api/g/${gt}/score`, { match_id: m.id, games: [mine === 1 ? [11, 7] : [7, 11]] })).body;
  const scored = gv.rounds[0].matches[0];
  assert.equal(scored.status, 'recorded');
  assert.ok(scored.acks.includes(onCourt.athlete_id));
  // A guest can't score someone else's match.
  const sitter = ev.people.find(p => ev.rounds[0].sitting_out.some(x => x.athlete_id === p.athlete_id) && p.link);
  assert.equal((await anon.post(`/api/g/${tokenOf(sitter.link)}/score`, { match_id: m.id, games: [[11, 0]] })).status, 404);

  // Host confirms; the guest can no longer change it; host can reopen.
  assert.equal((await coach.post(`/api/matches/${m.id}/verify`)).status, 200);
  assert.equal((await anon.post(`/api/g/${gt}/score`, { match_id: m.id, games: [[11, 1]] })).status, 409);
  const re = (await coach.post(`/api/matches/${m.id}/reopen`)).body;
  assert.equal(re.status, 'scheduled');
  assert.equal((await anon.post(`/api/g/${gt}/score`, { match_id: m.id, games: [mine === 1 ? [11, 9] : [9, 11]] })).status, 200);

  // Spectators see courts and standings, no contact details, no registration.
  const watch = tokenOf(ev.links.watch);
  const sv = (await anon.get(`/api/watch/${watch}`)).body;
  assert.equal(sv.rounds.length, 1);
  assert.ok(sv.people.every(p => p.email === undefined));
  assert.equal(sv.standings.length, 4);

  // Resetting the share link kills the old one; registered players keep theirs.
  await coach.post(`/api/events/${e.id}/links`, { reset: 'share' });
  assert.equal((await anon.get(`/api/public/events/${share}`)).status, 404);
  assert.equal((await anon.get(`/api/g/${gt}`)).status, 200);
  await coach.post(`/api/events/${e.id}/links`, { reset: 'watch' });
  assert.equal((await anon.get(`/api/watch/${watch}`)).status, 404);

  // Closing registration stops new sign-ups.
  ev = (await coach.put(`/api/events/${e.id}`, { registration_open: false })).body;
  assert.equal((await anon.post(`/api/public/events/${tokenOf(ev.links.share)}/register`, { name: 'Late', email: 'late@x.test' })).status, 409);
  // Hidden roster: players don't see who's coming.
  await coach.put(`/api/events/${e.id}`, { show_roster: false });
  assert.equal((await anon.get(`/api/g/${gt}`)).body.people.length, 0);
});

test('breaks, leaving, waitlist promotion, attendance undo', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const e = await event(coach, { capacity: 4 });
  const { anon, list } = await guests(s, e, 5);
  let ev = await checkInAll(coach, e);
  const tok = list[0].token;

  // Break: out of the next round; back: in again.
  await anon.post(`/api/g/${tok}/status`, { action: 'break' });
  ev = (await coach.get(`/api/events/${e.id}`)).body;
  assert.equal(ev.people.find(p => p.number === 1).on_break, true);
  assert.equal((await coach.post(`/api/events/${e.id}/rounds`, { seed: 1 })).status, 400, 'only 3 playing');
  await anon.post(`/api/g/${tok}/status`, { action: 'back' });

  // Leaving frees the spot: number 5 moves off the waitlist.
  await anon.post(`/api/g/${tok}/status`, { action: 'leave' });
  ev = (await coach.get(`/api/events/${e.id}`)).body;
  assert.equal(ev.people.find(p => p.number === 5).state, 'registered');
  assert.match(ev.undo.label, /left/);

  // Undo puts both back as they were.
  ev = (await coach.post(`/api/events/${e.id}/attendance/undo`)).body;
  assert.equal(ev.people.find(p => p.number === 1).state, 'registered');
  assert.equal(ev.people.find(p => p.number === 5).state, 'waitlist');

  // Once a round starts, earlier changes can't be undone.
  await coach.post(`/api/events/${e.id}/rounds`, { seed: 2 });
  ev = (await coach.get(`/api/events/${e.id}`)).body;
  assert.equal(ev.undo, null);
  assert.equal((await coach.post(`/api/events/${e.id}/attendance/undo`)).status, 409);
});

test('timed rounds, first-court stop, stop all courts, ties when stopped, round limit', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const e = await event(coach, { round_end: 'first', round_minutes: 12, round_limit: 2 });
  await guests(s, e, 8);
  let ev = await checkInAll(coach, e);
  ev = (await coach.post(`/api/events/${e.id}/rounds`, { seed: 5 })).body;
  const rd = ev.rounds[0];
  assert.deepEqual([rd.timer.duration, rd.timer.running, rd.ends_at], [720, false, null], 'a new round waits, timer paused');
  assert.equal(rd.matches.length, 2);
  // A tie isn't allowed while play is on.
  assert.equal((await coach.put(`/api/matches/${rd.matches[0].id}`, { version: rd.matches[0].version, games: [[8, 8]] })).status, 400);
  await coach.put(`/api/matches/${rd.matches[0].id}`, { version: rd.matches[0].version, games: [[11, 6]] });
  ev = (await coach.get(`/api/events/${e.id}`)).body;
  assert.equal(ev.rounds[0].stopped, true, 'first finished court stops the round');
  // Now the other court enters the score as it stands, tie allowed.
  const other = ev.rounds[0].matches[1];
  assert.equal((await coach.put(`/api/matches/${other.id}`, { version: other.version, games: [[7, 7]] })).status, 200);
  ev = (await coach.get(`/api/events/${e.id}`)).body;
  assert.ok(ev.standings.some(x => x.draws === 1));
  assert.equal(ev.rounds[0].status, 'done');

  await coach.post(`/api/events/${e.id}/rounds`, { seed: 6 });
  ev = (await coach.post(`/api/events/${e.id}/stop`)).body;
  assert.equal(ev.rounds[1].stopped, true);
  for (const m of ev.rounds[1].matches) await coach.put(`/api/matches/${m.id}`, { version: m.version, games: [[5, 4]] });
  assert.equal((await coach.post(`/api/events/${e.id}/rounds`, { seed: 7 })).status, 409, 'round limit 2');
});

test('race to a target ends the event; unlucky head starts; rivalry repeats opponents', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const race = await event(coach, { mode: 'race', race_target: 20, courts: 1 });
  await guests(s, race, 4, 'R');
  await checkInAll(coach, race);
  for (let i = 0; i < 3; i++) {
    const res = await coach.post(`/api/events/${race.id}/rounds`, { seed: i });
    if (res.status === 409) break;
    const ev = res.body;
    const m = ev.rounds[ev.rounds.length - 1].matches[0];
    await coach.put(`/api/matches/${m.id}`, { version: m.version, games: [[11, 9]] });
  }
  let ev = (await coach.get(`/api/events/${race.id}`)).body;
  assert.equal(ev.race.finished, true);
  assert.ok(ev.race.leader.points >= 20);
  assert.equal(ev.status, 'complete');
  assert.equal((await coach.post(`/api/events/${race.id}/rounds`, {})).status, 409);

  const un = await event(coach, { mode: 'unlucky', courts: 2 });
  await guests(s, un, 8, 'U');
  await checkInAll(coach, un);
  const pv = (await coach.get(`/api/events/${un.id}/rounds/preview?seed=3`)).body;
  pv.courts.forEach(c => c.start.forEach(x => assert.ok([0, 3, 6].includes(x))));
  ev = (await coach.post(`/api/events/${un.id}/rounds`, { seed: 3 })).body;
  const m = ev.rounds[0].matches.find(x => x.start1 || x.start2) || ev.rounds[0].matches[0];
  assert.deepEqual([m.start1, m.start2], pv.courts[m.court - 1].start);
  if (m.start1 > 0) assert.equal((await coach.put(`/api/matches/${m.id}`, { version: m.version, games: [[m.start1 - 1, 11]] })).status, 400, 'below the head start');

  // Rivalry: over several rounds you face fewer different opponents than in a normal mixer.
  const repeats = async (mode) => {
    const x = await event(coach, { mode, courts: 2 });
    await guests(s, x, 8, mode.slice(0, 2).toUpperCase());
    await checkInAll(coach, x);
    for (let i = 0; i < 4; i++) {
      const y = (await coach.post(`/api/events/${x.id}/rounds`, { seed: 40 + i, force: true })).body;
      for (const mm of y.rounds[y.rounds.length - 1].matches) await coach.put(`/api/matches/${mm.id}`, { version: mm.version, games: [[11, 5]] });
    }
    const y = (await coach.get(`/api/events/${x.id}`)).body;
    const faced = {};
    y.rounds.forEach(rd => rd.matches.forEach(mm => mm.players.filter(p => p.team === 1).forEach(a => mm.players.filter(p => p.team === 2).forEach(b => { const k = [a.athlete_id, b.athlete_id].sort().join(':'); faced[k] = (faced[k] || 0) + 1; }))));
    return Object.keys(faced).length; // distinct opponent pairs
  };
  assert.ok(await repeats('rivalry') < await repeats('rotate'), 'rivalry keeps meeting the same opponents');
});

test('pre-mapped doubles: whole schedule up front, rebuilt when attendance changes', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const e = await event(coach, { mode: 'premapped', round_limit: 4, courts: 2 });
  const { anon, list } = await guests(s, e, 9, 'M');
  let ev = (await coach.post(`/api/events/${e.id}/schedule`, { seed: 9 })).body;
  assert.equal(ev.schedule.length, 4, 'four rounds planned from sign-ups');
  ev = await checkInAll(coach, e);
  const planned = ev.schedule[0];
  ev = (await coach.post(`/api/events/${e.id}/rounds`, {})).body;
  const firstNames = ev.rounds[0].matches.map(m => [1, 2].map(tm => m.players.filter(p => p.team === tm).map(p => p.name.split(' ')[0]).join(' & ')));
  assert.deepEqual(firstNames, planned.courts, 'round 1 follows the schedule');
  for (const m of ev.rounds[0].matches) await coach.put(`/api/matches/${m.id}`, { version: m.version, games: [[11, 3]] });
  // Someone leaves: the next round is rebuilt around who is here.
  await anon.post(`/api/g/${list[0].token}/status`, { action: 'leave' });
  const pv = (await coach.get(`/api/events/${e.id}/rounds/preview?seed=1`)).body;
  assert.equal(pv.rebuilt, true);
  assert.ok(pv.courts.every(c => c.teams.every(tm => tm.players.every(p => p.name !== 'M0 Player'))));
  ev = (await coach.post(`/api/events/${e.id}/rounds`, { seed: 1 })).body;
  assert.equal(ev.schedule.length, 2, 'rounds 3 and 4 still planned');
});

test('3v3 team draft: snake-drafted teams, three games per matchup, team standings, teams locked', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const e = await event(coach, { mode: 'draft3', courts: 1 });
  await guests(s, e, 6, 'D');
  let ev = (await coach.post(`/api/events/${e.id}/teams/auto`)).body;
  assert.equal(ev.teams.length, 2);
  assert.ok(ev.teams.every(tm => tm.p3));
  ev = await checkInAll(coach, e);
  ev = (await coach.post(`/api/events/${e.id}/rounds`, { seed: 2 })).body;
  const ms = ev.rounds[0].matches;
  assert.equal(ms.length, 3);
  assert.equal(new Set(ms.map(m => m.matchup)).size, 1);
  // Team 1 of the first match wins two of three games: that team takes the matchup.
  const a = ev.teams.find(tm => [tm.p1, tm.p2, tm.p3].includes(ms[0].players.find(p => p.team === 1).athlete_id));
  await coach.put(`/api/matches/${ms[0].id}`, { version: ms[0].version, games: [[11, 4]] });
  await coach.put(`/api/matches/${ms[1].id}`, { version: ms[1].version, games: [[11, 6]] });
  await coach.put(`/api/matches/${ms[2].id}`, { version: ms[2].version, games: [[3, 11]] });
  ev = (await coach.get(`/api/events/${e.id}`)).body;
  const top = ev.team_standings[0];
  assert.equal(top.team_id, a.id);
  assert.equal(top.wins, 1);
  assert.equal(top.games_won, 2);
  assert.equal((await coach.del(`/api/events/${e.id}/teams/${a.id}`)).status, 409, 'teams lock once play starts');
});

test('fallout double elimination: losers side, grand final and deciding game', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const e = await event(coach, { mode: 'fallout', elimination: 'double' });
  await guests(s, e, 8, 'F');
  await coach.post(`/api/events/${e.id}/teams/auto`);
  let ev = (await coach.post(`/api/events/${e.id}/bracket`, { seeding: 'order' })).body;
  assert.equal(ev.bracket.elimination, 'double');
  assert.equal(ev.bracket.rounds.length, 2, 'winners: semis and final for 4 teams');
  assert.equal(ev.bracket.losers.length, 2);
  // Play every scheduled match with team 1 winning, except the grand final,
  // where the losers-side team (team 2) wins to force the deciding game.
  const openMatches = b => [...b.rounds, ...b.losers, ...b.finals].flatMap(r => r.slots).filter(x => x.match && x.match.status === 'scheduled');
  for (let guard = 0; guard < 10; guard++) {
    const todo = openMatches(ev.bracket);
    if (!todo.length) break;
    for (const x of todo) {
      const m = (await coach.get(`/api/matches/${x.match.id}`)).body;
      await coach.put(`/api/matches/${m.id}`, { version: m.version, games: [x.code === 'F0-0' ? [4, 11] : [11, 4]] });
    }
    ev = (await coach.get(`/api/events/${e.id}`)).body;
  }
  const f = ev.bracket.finals;
  assert.equal(f.length, 2);
  assert.ok(f[1].slots[0].match, 'deciding game was played');
  assert.ok(ev.bracket.champion);
  // Too many teams for double elimination.
  const big = await event(coach, { mode: 'fallout', elimination: 'double' });
  await guests(s, big, 18, 'H');
  await coach.post(`/api/events/${big.id}/teams/auto`);
  assert.equal((await coach.post(`/api/events/${big.id}/bracket`, {})).status, 400);
});

test('weekly duplicates, account self-service, acknowledgments, linking a guest registration', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const e = await event(coach, { mode: 'rivalry', round_limit: 6 });
  const d = await coach.post(`/api/events/${e.id}/duplicate`, { weeks: 3 });
  assert.equal(d.status, 201);
  assert.equal(d.body.length, 3);
  const w1 = (await coach.get(`/api/events/${d.body[0].id}`)).body;
  assert.equal(w1.status, 'draft');
  assert.equal(w1.mode, 'rivalry');
  assert.equal(w1.people.length, 0);
  assert.equal(new Date(w1.starts_at) - new Date(e.starts_at), 7 * 864e5);
  assert.notEqual(w1.links.share, e.links.share);
  assert.equal((await coach.post(`/api/events/${e.id}/duplicate`, { weeks: 9 })).status, 400);

  // A player with an account registers, gets a court, acknowledges, takes a break.
  const pc = s.client(); await pc.signup('Pat Account', 'pat@x.test');
  await pc.post('/api/me/athlete', {});
  await pc.post(`/api/events/${e.id}/register`);
  const { anon, list } = await guests(s, e, 3, 'L');
  await checkInAll(coach, e);
  let ev = (await coach.post(`/api/events/${e.id}/rounds`, { seed: 1 })).body;
  const m = ev.rounds[0].matches[0];
  assert.equal((await pc.post(`/api/matches/${m.id}/ack`)).status, 204);
  ev = (await pc.post(`/api/events/${e.id}/me`, { action: 'break' })).body;
  assert.equal(ev.me.on_break, true);

  // A guest later makes an account and links the registration: My Events.
  const gc = s.client(); await gc.signup('Lee Guest', 'lee@x.test');
  const link = await gc.post('/api/me/link-guest', { token: `https://lab.test/#/g/${list[0].token}` });
  assert.equal(link.status, 200);
  assert.equal(link.body.event_id, e.id);
  const mine = (await gc.get('/api/events')).body.find(x => x.id === e.id);
  assert.equal(mine.my_state, 'registered');
  assert.equal(mine.share_token, undefined, 'list never leaks links');
  // Already linked elsewhere: refused.
  assert.equal((await pc.post('/api/me/link-guest', { token: list[0].token })).status, 409);
  // An account that already has a profile merges the guest record into it.
  const hc = s.client(); await hc.signup('Hal Two', 'hal@x.test'); await hc.post('/api/me/athlete', {});
  assert.equal((await hc.post('/api/me/link-guest', { token: list[1].token })).status, 200);
  const hv = (await hc.get(`/api/events/${e.id}`)).body;
  assert.equal(hv.me.state, 'registered');
  assert.ok(hv.rounds[0].matches.some(mm => mm.players.some(p => p.athlete_id === hv.me.athlete_id)) || hv.rounds[0].sitting_out.some(p => p.athlete_id === hv.me.athlete_id));
  assert.equal((await anon.get(`/api/g/${list[1].token}`)).body.guest.linked, true);
});
