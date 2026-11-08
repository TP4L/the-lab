'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { start, staff } = require('./helpers');
test('business pulse aggregates clients, revenue, credits and a reach-out list for the coach', async t => {
  const s = await start(); t.after(s.close); const { coach } = await staff(s);
  const a1 = (await coach.post('/api/athletes', { name: 'Active one' })).body.athlete.id;
  const a2 = (await coach.post('/api/athletes', { name: 'Quiet two' })).body.athlete.id;
  const shop = (await coach.get('/api/shop')).body.products, single = shop.find(x => x.code === 'private-1');
  await coach.post('/api/athletes/' + a1 + '/credits', { product_id: single.id, source: 'cash' });
  await coach.post('/api/athletes/' + a1 + '/credits/redeem', { session_id: 'p1' });
  const p = (await coach.get('/api/coach/pulse')).body;
  assert.equal(p.clients.total, 2); assert.equal(p.clients.active, 1); assert.equal(p.clients.new_30d, 2);
  assert.equal(p.revenue.last_30_cents, 12000); assert.equal(p.credits.outstanding, 0); assert.equal(p.credits.athletes_out, 1);
  assert.equal(p.weeks.length, 8); assert.equal(p.weeks[7].credits_used, 1);
  const r = p.reach.find(x => x.id === a1); assert.ok(r && r.reasons.some(x => /Out of credits/.test(x)));
  assert.ok(p.reach.find(x => x.id === a2).reasons.includes('New this month'));
  const athlete = s.client(); await athlete.signup('Nope', 'nope@lab.test');
  assert.equal((await athlete.get('/api/coach/pulse')).status, 403);
});
