'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/index.js');

async function start(opts = {}) {
  const { server } = createApp({ file: ':memory:', ...opts });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
  return { server, base, call, close: () => new Promise(r => server.close(r)) };
}

test('seeds library and demo roster', async (t) => {
  const s = await start(); t.after(s.close);
  const d = await s.call('GET', '/api/dashboard');
  assert.equal(d.status, 200);
  assert.equal(d.body.counts.situations, 14);
  assert.equal(d.body.counts.drills, 10);
  assert.equal(d.body.counts.players, 3);
  assert.ok(d.body.film.n > 0);
});

test('player CRUD, reps, and summary', async (t) => {
  const s = await start({ demo: false }); t.after(s.close);
  const bad = await s.call('POST', '/api/players', { name: '  ' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /name is required/);
  const badPos = await s.call('POST', '/api/players', { name: 'A', position: 'Pitcher' });
  assert.equal(badPos.status, 400);

  const p = (await s.call('POST', '/api/players', { name: 'Alex', number: '5', position: 'Defense' })).body;
  assert.equal(p.name, 'Alex');
  const up = await s.call('PUT', `/api/players/${p.id}`, { name: 'Alex K', number: '5', position: 'LSM' });
  assert.equal(up.body.position, 'LSM');

  assert.equal((await s.call('POST', '/api/reps', { player_id: p.id, error: 'nope' })).status, 400);
  assert.equal((await s.call('POST', '/api/reps', { player_id: 999, error: 'see' })).status, 404);
  assert.equal((await s.call('POST', '/api/reps', { player_id: p.id, error: 'need', call: 'osg', note: 'early slide' })).status, 201);
  await s.call('POST', '/api/reps', { player_id: p.id, error: 'need' });
  await s.call('POST', '/api/reps', { player_id: p.id, error: 'see' });

  const sum = (await s.call('GET', `/api/players/${p.id}`)).body;
  assert.equal(sum.errors.need, 2);
  assert.equal(sum.focus, 'need');
  assert.equal(sum.reps.length, 3);

  assert.equal((await s.call('DELETE', `/api/players/${p.id}`)).status, 204);
  assert.equal((await s.call('GET', `/api/players/${p.id}`)).status, 404);
  assert.equal((await s.call('GET', '/api/reps')).body.length, 0, 'reps cascade with the player');
});

test('attempts are graded by the server', async (t) => {
  const s = await start({ demo: false }); t.after(s.close);
  const p = (await s.call('POST', '/api/players', { name: 'Kai' })).body;
  const sit = (await s.call('GET', '/api/situations')).body[0];
  assert.equal(sit.answer, 'gsg');
  const wrong = await s.call('POST', '/api/attempts', { situation_id: sit.id, player_id: p.id, guess: 'osg', answer: 'osg', correct: true });
  assert.equal(wrong.body.correct, false);
  assert.equal(wrong.body.answer, 'gsg');
  assert.equal(wrong.body.guessLegal.ok, false);
  const right = await s.call('POST', '/api/attempts', { situation_id: sit.id, player_id: p.id, guess: 'gsg' });
  assert.equal(right.body.correct, true);
  const sum = (await s.call('GET', `/api/players/${p.id}`)).body;
  assert.deepEqual([sum.film.seen, sum.film.right], [2, 1]);
  const anon = await s.call('POST', '/api/attempts', { situation_id: sit.id, guess: 'gsg' });
  assert.equal(anon.body.saved, false);
});

test('situations, drills and plans', async (t) => {
  const s = await start({ demo: false }); t.after(s.close);
  const sit = await s.call('POST', '/api/situations', { title: 'T', description: 'D', positions: ['Defense'], inputs: { state: 'O', need: 3, b: 3, cert: 'high' } });
  assert.equal(sit.status, 201);
  assert.equal(sit.body.answer, 'tri');
  assert.equal((await s.call('GET', '/api/situations?position=Goalie')).body.length, 0);
  assert.ok((await s.call('GET', '/api/situations?state=O')).body.every(x => x.inputs.state === 'O'));

  const dr = await s.call('POST', '/api/drills', { name: 'New', call: 'x', minutes: 7, positions: ['Defense'] });
  assert.equal(dr.body.minutes, 7);
  assert.equal((await s.call('POST', '/api/drills', { name: 'Bad', call: 'zzz' })).status, 400);

  const plan = await s.call('POST', '/api/plans', { title: 'Tue', date: '2026-10-01', items: [{ drill_id: dr.body.id, minutes: 12 }, { drill_id: 1, minutes: 8 }] });
  assert.equal(plan.status, 201);
  assert.equal(plan.body.total, 20);
  assert.equal(plan.body.items[0].name, 'New');
  assert.equal((await s.call('POST', '/api/plans', { title: 'X', items: [{ drill_id: 9999, minutes: 5 }] })).status, 404);
  assert.equal((await s.call('POST', '/api/plans', { title: 'X', date: '10/01/2026' })).status, 400);

  await s.call('DELETE', `/api/drills/${dr.body.id}`);
  assert.equal((await s.call('GET', `/api/plans/${plan.body.id}`)).body.items.length, 1, 'plan items cascade with the drill');
});

test('coach key locks writes but not reads or film', async (t) => {
  const s = await start({ coachKey: 'secret', demo: false }); t.after(s.close);
  assert.equal((await s.call('GET', '/api/meta')).body.auth, true);
  assert.equal((await s.call('POST', '/api/players', { name: 'A' })).status, 401);
  assert.equal((await s.call('POST', '/api/players', { name: 'A' }, { Authorization: 'Bearer nope' })).status, 401);
  assert.equal((await s.call('POST', '/api/players', { name: 'A' }, { Authorization: 'Bearer secret' })).status, 201);
  assert.equal((await s.call('GET', '/api/players')).status, 200);
  assert.equal((await s.call('POST', '/api/attempts', { situation_id: 1, guess: 'gsg' })).status, 201);
});

test('bad requests and static files', async (t) => {
  const s = await start({ demo: false }); t.after(s.close);
  assert.equal((await s.call('POST', '/api/players', '{nope')).status, 400);
  assert.equal((await s.call('POST', '/api/players', 'x'.repeat(70000))).status, 413);
  assert.equal((await s.call('GET', '/api/nothing')).status, 404);
  assert.equal((await s.call('PATCH', '/api/players')).status, 405);
  const html = await fetch(s.base + '/');
  assert.equal(html.status, 200);
  assert.match(await html.text(), /LAB Sideline/);
  const eng = await fetch(s.base + '/engine.js');
  assert.match(eng.headers.get('content-type'), /javascript/);
  const trav = await fetch(s.base + '/..%2f..%2fserver%2fdb.js');
  assert.notEqual(trav.status, 200);
  assert.doesNotMatch(await trav.text(), /DatabaseSync/);
});
