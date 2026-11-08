'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { start, staff } = require('./helpers.js');

test('shop: products, one-off checkout via webhook, manual sales, credit ledger and redemption', async t => {
  const calls = [];
  const stripe = {
    customers: { create: async () => ({ id: 'cus_x' }) },
    checkout: { sessions: { create: async data => { calls.push(data); return { id: 'cs_1', url: 'https://checkout.stripe.test/pack' }; } } },
    billingPortal: { sessions: { create: async () => ({ url: 'x' }) } },
    webhooks: { constructEvent: raw => JSON.parse(raw.toString('utf8')) }
  };
  const s = await start({ stripeClient: stripe, stripeWebhookSecret: 'whsec_test', stripePriceEssentials: 'price_essentials' }); t.after(s.close);
  const { coach, coach2 } = await staff(s);
  const made = (await coach.post('/api/athletes', { name: 'Paying athlete' })).body;
  const aid = made.athlete.id, p = s.client(); await p.signup('Paying athlete', 'pay@lab.test'); await p.post('/api/claim', { code: made.claim_code });

  // Public catalogue, seeded; coach can add and edit products.
  const anon = s.client();
  const shop = (await anon.get('/api/shop')).body;
  assert.ok(shop.products.length >= 4); assert.equal(shop.checkout_enabled, true);
  assert.equal((await p.post('/api/products', { name: 'Nope', price_cents: 100 })).status, 403);
  const clinic = (await coach.post('/api/products', { name: 'Saturday clinic', kind: 'event', price_cents: 3500, credits: 0 })).body;
  assert.equal(clinic.code, 'saturday-clinic'); assert.equal(clinic.price, '$35');
  assert.equal((await coach.put('/api/products/' + clinic.id, { active: false })).body.active, false);
  assert.ok(!(await anon.get('/api/shop')).body.products.some(x => x.id === clinic.id));

  // Checkout creates a pending order and never grants credits until the webhook says paid.
  const pack = shop.products.find(x => x.code === 'private-5');
  const co = (await p.post('/api/shop/checkout', { product_id: pack.id })).body;
  assert.equal(co.url, 'https://checkout.stripe.test/pack'); assert.equal(calls[0].mode, 'payment'); assert.equal(calls[0].metadata.lab_kind, 'order');
  assert.equal(calls[0].line_items[0].price_data.unit_amount, 55000);
  assert.equal((await p.get('/api/me/credits')).body.balance.private, 0);
  assert.equal((await p.get('/api/orders/' + co.order_id)).body.status, 'pending');
  const paid = { id: 'evt_order', type: 'checkout.session.completed', data: { object: { payment_status: 'paid', payment_intent: 'pi_1', metadata: { lab_kind: 'order', lab_order_id: co.order_id }, client_reference_id: '999' } } };
  assert.equal((await p.call('POST', '/api/billing/webhook', JSON.stringify(paid), { 'Stripe-Signature': 'ok' })).status, 200);
  let mine = (await p.get('/api/me/credits')).body;
  assert.equal(mine.balance.private, 5); assert.equal(mine.orders[0].status, 'paid'); assert.ok(mine.ledger[0].expires_at);
  assert.equal((await p.get('/api/membership')).body.active, false, 'a pack purchase must not activate membership');
  // replay is ignored
  await p.call('POST', '/api/billing/webhook', JSON.stringify(paid), { 'Stripe-Signature': 'ok' });
  assert.equal((await p.get('/api/me/credits')).body.balance.private, 5);

  // Coach records a cash sale and redeems credits; permissions hold.
  const single = shop.products.find(x => x.code === 'private-1');
  assert.equal((await coach2.post('/api/athletes/' + aid + '/credits', { product_id: single.id, source: 'cash' })).status, 404);
  assert.equal((await p.post('/api/athletes/' + aid + '/credits', { product_id: single.id })).status, 403);
  let r = (await coach.post('/api/athletes/' + aid + '/credits', { product_id: single.id, source: 'venmo', note: 'Paid courtside' })).body;
  assert.equal(r.balance.private, 6);
  r = (await coach.post('/api/athletes/' + aid + '/credits/redeem', { session_id: 'sess-1', reason: 'Tuesday private' })).body;
  assert.equal(r.balance.private, 5);
  assert.equal((await coach.post('/api/athletes/' + aid + '/credits/redeem', { session_id: 'sess-1' })).body.duplicate, true);
  assert.equal((await coach.post('/api/athletes/' + aid + '/credits/redeem', { credit_kind: 'group' })).status, 409);
  r = (await coach.post('/api/athletes/' + aid + '/credits', { delta: -5, reason: 'Transferred to partner' })).body;
  assert.equal(r.balance.private, 0);
  const view = (await coach.get('/api/athletes/' + aid + '/credits')).body;
  assert.equal(view.ledger.length, 4); assert.equal(view.ledger[0].ref_type, 'adjust');

  // Sales overview counts both Stripe and manual sales.
  const sales = (await coach.get('/api/coach/sales?days=30')).body;
  assert.equal(sales.orders.length, 2); assert.equal(sales.revenue_cents, 67000); assert.equal(sales.credits_outstanding, 0);
  assert.equal((await p.get('/api/coach/sales')).status, 403);

  // Athlete notified about payment and low balance.
  const notes = (await p.get('/api/notifications')).body;
  assert.ok(notes.items.some(n => /Payment received/.test(n.title)));
  assert.ok(notes.items.some(n => /added by/.test(n.title)));
});
