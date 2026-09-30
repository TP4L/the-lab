'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers.js');

test('checkout waits for a verified webhook before membership unlocks', async (t) => {
  const calls = [];
  const stripe = {
    customers: { create: async data => { calls.push(['customer', data]); return { id: 'cus_lab' }; } },
    checkout: { sessions: { create: async data => { calls.push(['checkout', data]); return { url: 'https://checkout.stripe.test/session' }; } } },
    billingPortal: { sessions: { create: async data => ({ url: 'https://billing.stripe.test/portal', ...data }) } },
    webhooks: { constructEvent: raw => JSON.parse(raw.toString('utf8')) }
  };
  const s = await start({ stripeClient: stripe, stripeWebhookSecret: 'whsec_test', stripePriceEssentials: 'price_essentials' }); t.after(s.close);
  const athlete = s.client(); await athlete.signup('Member One', 'member@lab.test');
  assert.equal((await athlete.get('/api/membership')).body.active, false);
  const checkout = await athlete.post('/api/billing/checkout');
  assert.equal(checkout.body.url, 'https://checkout.stripe.test/session');
  assert.equal(calls[1][1].mode, 'subscription');
  assert.equal(calls[1][1].line_items[0].price, 'price_essentials');
  assert.equal((await athlete.get('/api/membership')).body.active, false, 'checkout creation alone never grants access');

  const event = { id: 'evt_paid', type: 'checkout.session.completed', data: { object: { customer: 'cus_lab', subscription: 'sub_lab', payment_status: 'paid' } } };
  assert.equal((await athlete.call('POST', '/api/billing/webhook', JSON.stringify(event), { 'Stripe-Signature': 'verified' })).status, 200);
  const membership = (await athlete.get('/api/membership')).body;
  assert.equal(membership.active, true);
  assert.equal(membership.membership.managed, true);
  assert.equal((await athlete.call('POST', '/api/billing/webhook', JSON.stringify(event), { 'Stripe-Signature': 'verified' })).body.duplicate, true);
  assert.equal((await athlete.post('/api/billing/portal')).body.url, 'https://billing.stripe.test/portal');
});
