'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff } = require('./helpers.js');

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

test('athlete profiles expose membership status while only admins can change access', async (t) => {
  const s = await start(); t.after(s.close);
  const { owner, coach } = await staff(s);
  const made = (await coach.post('/api/athletes', { name: 'Access Athlete' })).body;
  const athlete = s.client(); await athlete.signup('Access Athlete', 'access@lab.test'); await athlete.post('/api/claim', { code: made.claim_code });

  assert.equal((await coach.put(`/api/athletes/${made.athlete.id}/membership`, { status: 'active' })).status, 403);
  const updated = await owner.put(`/api/athletes/${made.athlete.id}/membership`, { status: 'active', plan: 'essentials', expires_at: '2027-01-15', note: 'Founding athlete' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.membership.active, true);
  assert.equal(updated.body.membership.complimentary, true);
  assert.equal(updated.body.membership_history[0].changed_by, 'Owner');
  assert.equal(updated.body.membership_history[0].note, 'Founding athlete');

  const roster = (await coach.get('/api/athletes')).body;
  assert.equal(roster.find(a => a.id === made.athlete.id).membership.active, true);
  const visible = (await coach.get(`/api/athletes/${made.athlete.id}`)).body;
  assert.equal(visible.membership.active, true);
  assert.equal((await athlete.get('/api/membership')).body.active, true);

  const removed = await owner.put(`/api/athletes/${made.athlete.id}/membership`, { status: 'none', note: 'Ended' });
  assert.equal(removed.body.membership, null);
  assert.equal(removed.body.membership_history[0].status, 'none');
});
