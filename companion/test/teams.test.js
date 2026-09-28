'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff } = require('./helpers.js');

async function player(s, name, email) {
  const c = s.client(); await c.signup(name, email);
  const aid = (await c.post('/api/me/athlete', {})).body.athlete.id;
  return { c, aid, pid: 'LAB-' + String(aid).padStart(5, '0') };
}
const score = (c, m, a, b) => c.put(`/api/matches/${m.id}`, { version: m.version, games: [[a, b]] });

test('fixed partners: register together, auto-pair, team rounds, team standings', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const e = (await coach.post('/api/events', { title: 'Doubles Night', starts_at: new Date(Date.now() + 3600e3).toISOString(), status: 'published', courts: 2, partner_mode: 'fixed' })).body;
  const ps = []; for (let i = 0; i < 8; i++) ps.push(await player(s, `P${i} Last`, `p${i}@lab.test`));

  // P0 registers with P1 as partner: both in, one team, P1 notified.
  const r = await ps[0].c.post(`/api/events/${e.id}/register`, { partner_player_id: ps[1].pid });
  assert.equal(r.status, 200);
  assert.equal(r.body.teams.length, 1);
  assert.ok((await ps[1].c.get('/api/notifications')).body.items.some(n => /partner/.test(n.title)));
  for (const p of ps.slice(2)) await p.c.post(`/api/events/${e.id}/register`);
  // Rotating events refuse partner sign-up.
  const rot = (await coach.post('/api/events', { title: 'Rot', starts_at: new Date(Date.now() + 3600e3).toISOString(), status: 'published' })).body;
  assert.equal((await ps[2].c.post(`/api/events/${rot.id}/register`, { partner_player_id: ps[3].pid })).status, 400);

  let ev = (await coach.post(`/api/events/${e.id}/teams/auto`)).body;
  assert.equal(ev.teams.length, 4);
  assert.equal((await coach.post(`/api/events/${e.id}/teams`, { p1: ps[0].aid, p2: ps[2].aid })).status, 409, 'already on a team');

  for (const p of ps) await coach.post(`/api/events/${e.id}/checkin`, { athlete_id: p.aid });
  ev = (await coach.post(`/api/events/${e.id}/rounds`, { seed: 1 })).body;
  const rd = ev.rounds[0];
  assert.equal(rd.matches.length, 2);
  // Every match is two intact teams.
  const teamSet = new Set(ev.teams.map(x => [x.p1, x.p2].sort().join(':')));
  rd.matches.forEach(m => [1, 2].forEach(n => assert.ok(teamSet.has(m.players.filter(p => p.team === n).map(p => p.athlete_id).sort().join(':')))));
  await score(coach, rd.matches[0], 11, 4);
  await score(coach, rd.matches[1], 7, 11);
  ev = (await coach.get(`/api/events/${e.id}`)).body;
  assert.equal(ev.team_standings.length, 4);
  assert.equal(ev.team_standings.reduce((a, x) => a + x.wins, 0), 2);
  assert.equal((await coach.del(`/api/events/${e.id}/teams/${ev.teams[0].id}`)).status, 409, 'can’t split a team that played');
});

test('bracket: seeding with byes, winners advance, corrections re-route, champion', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const e = (await coach.post('/api/events', { title: 'Cup', starts_at: new Date(Date.now() + 3600e3).toISOString(), status: 'published', partner_mode: 'fixed' })).body;
  const ps = []; for (let i = 0; i < 10; i++) ps.push(await player(s, `B${i} X`, `b${i}@lab.test`));
  for (const p of ps) await p.c.post(`/api/events/${e.id}/register`);
  await coach.post(`/api/events/${e.id}/teams/auto`);
  const rot = (await coach.post('/api/events', { title: 'R', starts_at: new Date(Date.now() + 3600e3).toISOString(), status: 'published' })).body;
  assert.equal((await coach.post(`/api/events/${rot.id}/bracket`, {})).status, 400, 'fixed partners only');

  // 5 teams -> bracket of 8: top 3 seeds get byes.
  let ev = (await coach.post(`/api/events/${e.id}/bracket`, { seeding: 'order' })).body;
  const b = ev.bracket;
  assert.deepEqual(b.rounds.map(x => x.name), ['Quarterfinals', 'Semifinals', 'Final']);
  assert.equal(b.rounds[0].slots.filter(x => x.bye).length, 3);
  const qf = b.rounds[0].slots.filter(x => x.match);
  assert.equal(qf.length, 1, 'only seeds 4 v 5 play in the first round');
  // Seed 1 (first team) has a bye into the semis.
  assert.equal(b.rounds[1].slots[0].team_a.id, ev.teams[0].id);

  const m = (id) => coach.get(`/api/matches/${id}`).then(r => r.body);
  let qm = await m(qf[0].match.id);
  await score(coach, qm, 11, 3);
  ev = (await coach.get(`/api/events/${e.id}`)).body;
  const semis = ev.bracket.rounds[1].slots;
  assert.ok(semis.every(x => x.match), 'both semifinals now scheduled');
  const winnerQ = ev.bracket.rounds[0].slots.find(x => x.match).winner_team;

  // Correction before the semi is played: the other team moves on instead.
  qm = await m(qf[0].match.id);
  await coach.put(`/api/matches/${qm.id}`, { version: qm.version, games: [[5, 11]], reason: 'Scores were swapped' });
  ev = (await coach.get(`/api/events/${e.id}`)).body;
  assert.notEqual(ev.bracket.rounds[0].slots.find(x => x.match).winner_team, winnerQ);
  const semiWithQ = ev.bracket.rounds[1].slots.find(x => [x.team_a && x.team_a.id, x.team_b && x.team_b.id].includes(ev.bracket.rounds[0].slots.find(y => y.match).winner_team));
  assert.ok(semiWithQ && semiWithQ.match, 'semi re-created with the corrected winner');

  for (const sl of ev.bracket.rounds[1].slots) await score(coach, await m(sl.match.id), 11, 9);
  ev = (await coach.get(`/api/events/${e.id}`)).body;
  const fin = ev.bracket.rounds[2].slots[0];
  assert.ok(fin.match);
  await score(coach, await m(fin.match.id), 9, 11);
  ev = (await coach.get(`/api/events/${e.id}`)).body;
  assert.equal(ev.bracket.champion, ev.teams.find(x => x.id === ev.bracket.rounds[2].slots[0].team_b.id).label);
  // Rebuilding a bracket with results needs force.
  assert.equal((await coach.post(`/api/events/${e.id}/bracket`, {})).status, 409);
  assert.equal((await coach.post(`/api/events/${e.id}/bracket`, { force: true, seeding: 'standings', size: 4 })).status, 201);
});
