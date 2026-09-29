'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers.js');
const { seedDemo, DEMO_USERS } = require('../server/demo.js');

test('demo mode: sample data seeds through the API; one-tap sign-in works only in demo mode', async (t) => {
  const s = await start({ demo: true, adminEmail: DEMO_USERS.host.email }); t.after(s.close);
  await seedDemo(s.base);
  const host = s.client();
  assert.equal((await host.post('/api/demo/login', { as: 'host' })).status, 200);
  assert.equal((await host.get('/api/meta')).body.demo, true);
  const events = (await host.get('/api/events')).body;
  assert.deepEqual(events.map(e => e.mode).sort(), ['draft3', 'fallout', 'race', 'rivalry']);
  const live = (await host.get(`/api/events/${events.find(e => e.mode === 'rivalry').id}`)).body;
  assert.equal(live.rounds.length, 2);
  assert.deepEqual(live.court_numbers, [4, 5]);
  assert.equal(live.rounds[1].timer.running, false, 'timer waits for the demo host');
  assert.equal((await host.get('/api/interest')).body.length, 1);
  assert.equal((await host.get('/api/plans')).body[0].status, 'published');

  const player = s.client();
  await player.post('/api/demo/login', { as: 'player' });
  const me = (await player.get('/api/me')).body;
  assert.equal(me.user.name, 'Jordan Reyes');
  const pe = (await player.get(`/api/events/${live.id}`)).body;
  assert.ok(pe.rounds[1].matches.some(m => m.players.some(p => p.athlete_id === me.athlete_id)), 'the demo player is on court');
  assert.equal((await player.post('/api/demo/login', { as: 'nobody' })).status, 400);

  const real = await start(); t.after(real.close);
  assert.equal((await real.client().post('/api/demo/login', { as: 'host' })).status, 404);
  assert.equal((await real.client().get('/api/meta')).body.demo, false);
});
