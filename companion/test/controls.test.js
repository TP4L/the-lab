'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff } = require('./helpers.js');

const soon = () => new Date(Date.now() + 3600e3).toISOString();
const tokenOf = link => link.split('/').pop();
async function event(coach, extra) {
  return (await coach.post('/api/events', { title: 'Controls', starts_at: soon(), status: 'published', ...extra })).body;
}
async function guests(s, e, n, prefix) {
  const anon = s.client(); const out = [];
  for (let i = 0; i < n; i++) out.push((await anon.post(`/api/public/events/${tokenOf(e.links.share)}/register`, { name: `${prefix}${i} P`, email: `${prefix.toLowerCase()}${i}@x.test` })).body);
  return { anon, list: out };
}
async function checkInAll(coach, e) {
  const ev = (await coach.get(`/api/events/${e.id}`)).body;
  for (const p of ev.people.filter(x => x.state === 'registered' && !x.checked_in)) await coach.put(`/api/events/${e.id}/people/${p.athlete_id}`, { checked_in: true });
  return (await coach.get(`/api/events/${e.id}`)).body;
}
const live = ev => ev.rounds[ev.rounds.length - 1];

test('round timer: starts paused, start, stop keeps time, resume, add a minute, reset, stale screens and ended rounds refused', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const e = await event(coach, { round_minutes: 5, courts: 1 });
  await guests(s, e, 4, 'T');
  await checkInAll(coach, e);
  let ev = (await coach.post(`/api/events/${e.id}/rounds`, { seed: 1 })).body;
  assert.deepEqual(live(ev).timer, { duration: 300, running: false, ends_at: null, remaining: 300, started: false });

  ev = (await coach.post(`/api/events/${e.id}/timer`, { round: 1, running: true })).body;
  assert.equal(live(ev).timer.running, true);
  assert.ok(live(ev).ends_at);
  // Pause: remaining time is kept (and survives a reload).
  s.app.db.prepare('UPDATE rounds SET ends_at = ? WHERE number = 1').run(new Date(Date.now() + 200e3).toISOString());
  ev = (await coach.post(`/api/events/${e.id}/timer`, { round: 1, running: false })).body;
  let tm = live(ev).timer;
  assert.equal(tm.running, false);
  assert.ok(tm.remaining >= 199 && tm.remaining <= 200, String(tm.remaining));
  assert.equal(live((await coach.get(`/api/events/${e.id}`)).body).timer.remaining, tm.remaining, 'saved with the event');
  // Add a minute while paused: still paused.
  ev = (await coach.post(`/api/events/${e.id}/timer/adjust`, { round: 1, operation: 'add' })).body;
  assert.equal(live(ev).timer.remaining, tm.remaining + 60);
  assert.equal(live(ev).timer.running, false);
  // Resume, then add a minute while running: keeps running.
  ev = (await coach.post(`/api/events/${e.id}/timer`, { round: 1, running: true })).body;
  ev = (await coach.post(`/api/events/${e.id}/timer/adjust`, { round: 1, operation: 'add' })).body;
  assert.equal(live(ev).timer.running, true);
  assert.ok(live(ev).timer.remaining >= tm.remaining + 119);
  // Out of time: adding a minute leaves it paused for the host to restart.
  s.app.db.prepare('UPDATE rounds SET ends_at = ? WHERE number = 1').run(new Date(Date.now() - 1000).toISOString());
  assert.equal((await coach.post(`/api/events/${e.id}/timer`, { round: 1, running: false })).status, 200);
  assert.equal((await coach.post(`/api/events/${e.id}/timer`, { round: 1, running: true })).status, 409, 'time is up');
  ev = (await coach.post(`/api/events/${e.id}/timer/adjust`, { round: 1, operation: 'add' })).body;
  assert.deepEqual([live(ev).timer.running, live(ev).timer.remaining], [false, 60]);
  // Reset: original length, paused. Scores stay.
  const m = live(ev).matches[0];
  await coach.put(`/api/matches/${m.id}`, { version: m.version, games: [[11, 7]] }).catch(() => {});
  ev = (await coach.post(`/api/events/${e.id}/timer/adjust`, { round: 1, operation: 'reset' })).body;
  assert.equal((await coach.post(`/api/events/${e.id}/timer/adjust`, { round: 1, operation: 'reset' })).status, 409, 'round ended once its only court was scored');
  // Upcoming rounds get the new length; the round that ran keeps its own.
  await coach.put(`/api/events/${e.id}`, { round_minutes: 8 });
  ev = (await coach.post(`/api/events/${e.id}/rounds`, { seed: 2 })).body;
  assert.equal(live(ev).timer.duration, 480);
  assert.equal(ev.rounds[0].timer.duration, 300);
  assert.equal((await coach.post(`/api/events/${e.id}/timer`, { round: 1, running: true })).status, 409, 'a stale screen can’t touch round 1');
  // An older running round (end time only) still works.
  s.app.db.prepare('UPDATE rounds SET duration_sec = NULL, remaining_sec = NULL, ends_at = ? WHERE number = 2').run(new Date(Date.now() + 90e3).toISOString());
  ev = (await coach.get(`/api/events/${e.id}`)).body;
  assert.equal(live(ev).timer.running, true);
  ev = (await coach.post(`/api/events/${e.id}/timer`, { round: 2, running: false })).body;
  assert.equal(live(ev).timer.running, false);
  assert.ok(live(ev).timer.remaining > 80);
});

test('chosen court numbers, preview saved for starting, stale previews, late joining, fairness table', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const e = await event(coach, { court_numbers: [4, 5], mode: 'rivalry' });
  assert.deepEqual(e.court_numbers, [4, 5]);
  const { anon } = await guests(s, e, 8, 'C');
  await checkInAll(coach, e);

  // Preview, then start without a seed: exactly the preview.
  const pv = (await coach.get(`/api/events/${e.id}/rounds/preview`)).body;
  assert.deepEqual(pv.courts.map(c => c.court), [4, 5]);
  let ev = (await coach.get(`/api/events/${e.id}`)).body;
  assert.deepEqual(ev.draw, { stale: false, kind: 'round' });
  ev = (await coach.post(`/api/events/${e.id}/rounds`, {})).body;
  assert.deepEqual(live(ev).matches.map(m => m.court), [4, 5]);
  assert.deepEqual(live(ev).matches.flatMap(m => m.players.map(p => p.athlete_id)).sort(), pv.courts.flatMap(c => c.teams.flatMap(x => x.players.map(p => p.athlete_id))).sort());
  assert.equal(ev.draw, null);

  // Add court 6 for future rounds: current matches keep their courts; the preview goes stale.
  await coach.get(`/api/events/${e.id}/rounds/preview`);
  ev = (await coach.post(`/api/events/${e.id}/courts`, { numbers: [4, 5, 6] })).body;
  assert.deepEqual(ev.draw, { stale: true, kind: null });
  assert.deepEqual(live(ev).matches.map(m => m.court), [4, 5]);
  assert.equal((await coach.post(`/api/events/${e.id}/rounds`, { force: true })).body.stale_preview, true);
  assert.equal((await coach.post(`/api/events/${e.id}/courts`, { numbers: [] })).status, 400);

  // Late joining: players join with the same link and are in the next round.
  const pub = (await anon.get(`/api/public/events/${tokenOf(e.links.share)}`)).body;
  assert.deepEqual([pub.registration.open, pub.registration.late], [true, true]);
  for (let i = 0; i < 4; i++) {
    const r = await anon.post(`/api/public/events/${tokenOf(e.links.share)}/register`, { name: `Late${i} P`, email: `late${i}@x.test` });
    assert.equal(r.status, 201);
  }
  ev = (await coach.get(`/api/events/${e.id}`)).body;
  assert.equal(ev.people.filter(p => /^Late/.test(p.name) && p.checked_in).length, 4, 'late arrivals are checked in');
  const pv2 = (await coach.get(`/api/events/${e.id}/rounds/preview?seed=3`)).body;
  assert.deepEqual(pv2.courts.map(c => c.court), [4, 5, 6]);
  ev = (await coach.post(`/api/events/${e.id}/rounds`, { force: true })).body;
  assert.equal(live(ev).matches.length, 3);
  // Close late joining.
  await coach.put(`/api/events/${e.id}`, { late_join: false });
  assert.equal((await anon.post(`/api/public/events/${tokenOf(e.links.share)}/register`, { name: 'Too Late', email: 'toolate@x.test' })).status, 409);
  assert.equal((await anon.get(`/api/public/events/${tokenOf(e.links.share)}`)).body.registration.open, false);

  // Fairness: one row per player, completed rounds only.
  for (const m of live(ev).matches) await coach.put(`/api/matches/${m.id}`, { version: m.version, games: [[11, 4]] });
  ev = (await coach.get(`/api/events/${e.id}`)).body;
  const f = ev.fairness;
  assert.equal(f.length, 12);
  const late = f.filter(r => /^Late/.test(r.name));
  assert.ok(late.every(r => r.rests === 0), 'time before arriving isn’t a rest round');
  assert.equal(f.reduce((a, r) => a + r.games, 0), 4 * (2 + 3), 'games across both completed rounds');
  assert.equal(f.reduce((a, r) => a + r.rests, 0), 0 + 0, '8 players on 2 courts, then 12 on 3: nobody rested');
  assert.ok(f.every(r => ['playing', 'resting', 'waiting', 'on break', 'left'].includes(r.now)));
});

test('fixed-team events: rosters and courts lock once started; fallout preview shows the full bracket and starts from it', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const e = await event(coach, { mode: 'fallout', elimination: 'double', court_numbers: [2, 3] });
  const { anon } = await guests(s, e, 6, 'F');
  await coach.post(`/api/events/${e.id}/teams/auto`);
  const pv = (await coach.get(`/api/events/${e.id}/bracket/preview?seeding=order`)).body;
  const b = pv.bracket;
  assert.equal(b.rounds[0].slots.filter(x => x.bye).length, 1, '3 teams in a bracket of 4: one bye');
  assert.ok(b.rounds[1].slots[0].team_a, 'the bye team already shows in the next round');
  assert.equal(b.losers.length, 2);
  assert.equal(b.finals.length, 2);
  // A team change makes the preview stale.
  const t0 = (await coach.get(`/api/events/${e.id}`)).body.teams[0];
  await coach.del(`/api/events/${e.id}/teams/${t0.id}`);
  assert.equal((await coach.post(`/api/events/${e.id}/bracket`, {})).status, 409);
  await coach.post(`/api/events/${e.id}/teams/auto`);
  await coach.get(`/api/events/${e.id}/bracket/preview?seeding=order`);
  const ev = (await coach.post(`/api/events/${e.id}/bracket`, {})).body;
  const firstGame = ev.bracket.rounds[0].slots.find(x => x.match);
  assert.equal(firstGame.match.court, 2, 'bracket games go on the chosen courts');
  // Locked now.
  assert.equal((await anon.post(`/api/public/events/${tokenOf(e.links.share)}/register`, { name: 'Late', email: 'late@x.test' })).status, 409);
  assert.equal((await coach.post(`/api/events/${e.id}/walkin`, { name: 'Walk' })).status, 409);
  assert.equal((await coach.post(`/api/events/${e.id}/courts`, { numbers: [1] })).status, 409);
});
