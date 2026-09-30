'use strict';
const { HttpError, withStatus } = require('../http.js');
const { tx, now } = require('../db.js');

const ACTIVE = new Set(['active', 'trialing']);

function readRaw(req, max = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size <= max) chunks.push(c); else req.destroy(); });
    req.on('end', () => size > max ? reject(new HttpError(413, 'Webhook is too large.')) : resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function stripeClient(key) {
  if (!key) return null;
  const Stripe = require('stripe');
  const Client = Stripe.StripeClient || Stripe.Stripe || Stripe;
  return new Client(key, { apiVersion: '2026-08-26.dahlia' });
}

module.exports = function billing(r, { db, auth, config, stripeClient: supplied }) {
  const stripe = supplied || stripeClient(config.stripeKey);
  const enabled = !!(stripe && config.stripePriceEssentials && config.stripeWebhookSecret);
  const current = user => user && db.prepare('SELECT * FROM memberships WHERE user_id = ?').get(user.id);
  const publicPlan = { code: 'essentials', name: 'LAB Essentials', price: 8, interval: 'month' };

  r.get('/api/membership', ({ user }) => {
    auth.require(user);
    const m = current(user);
    return { plan: publicPlan, active: !!(m && m.status === 'active' && (!m.expires_at || m.expires_at > now())), membership: m ? { plan: m.plan, status: m.status, expires_at: m.expires_at, source: m.source, managed: !!m.stripe_customer_id } : null, checkout_enabled: enabled };
  });

  r.post('/api/billing/checkout', async ({ user }) => {
    auth.require(user);
    if (!enabled) throw new HttpError(503, 'Membership checkout is not available yet.');
    let m = current(user), customerId = m && m.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.name, metadata: { lab_user_id: String(user.id) } });
      customerId = customer.id;
      db.prepare(`INSERT INTO memberships (user_id,plan,status,source,stripe_customer_id,updated_at) VALUES (?,'essentials','cancelled','stripe',?,?)
        ON CONFLICT(user_id) DO UPDATE SET source='stripe', stripe_customer_id=excluded.stripe_customer_id, updated_at=excluded.updated_at`).run(user.id, customerId, now());
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', customer: customerId, line_items: [{ price: config.stripePriceEssentials, quantity: 1 }],
      success_url: `${config.publicUrl}/#/membership?checkout=success`, cancel_url: `${config.publicUrl}/#/membership?checkout=cancelled`,
      client_reference_id: String(user.id), allow_promotion_codes: true, integration_identifier: config.stripeIntegrationIdentifier
    });
    return { url: session.url };
  });

  r.post('/api/billing/portal', async ({ user }) => {
    auth.require(user);
    if (!stripe) throw new HttpError(503, 'Membership management is not available yet.');
    const m = current(user);
    if (!m || !m.stripe_customer_id) throw new HttpError(400, 'This membership is not managed through online billing.');
    const session = await stripe.billingPortal.sessions.create({ customer: m.stripe_customer_id, return_url: `${config.publicUrl}/#/membership` });
    return { url: session.url };
  });

  function customerId(obj) { return typeof obj.customer === 'string' ? obj.customer : obj.customer && obj.customer.id; }
  function subscriptionId(obj) {
    if (typeof obj.subscription === 'string') return obj.subscription;
    if (obj.subscription && obj.subscription.id) return obj.subscription.id;
    const detail = obj.parent && obj.parent.subscription_details;
    return detail && (typeof detail.subscription === 'string' ? detail.subscription : detail.subscription && detail.subscription.id);
  }
  function setMembership(event) {
    const obj = event.data.object || {};
    const customer = customerId(obj);
    let userId = customer && db.prepare('SELECT user_id FROM memberships WHERE stripe_customer_id = ?').get(customer);
    if (!userId && event.type.startsWith('checkout.session.') && obj.client_reference_id) userId = { user_id: Number(obj.client_reference_id) };
    if (!userId) return;
    let active = false;
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded' || event.type === 'invoice.paid') active = event.type === 'invoice.paid' || ['paid', 'no_payment_required'].includes(obj.payment_status);
    else if (event.type.startsWith('customer.subscription.')) active = event.type !== 'customer.subscription.deleted' && ACTIVE.has(obj.status);
    const expires = obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null;
    const sub = subscriptionId(obj);
    db.prepare(`INSERT INTO memberships (user_id,plan,status,expires_at,source,note,stripe_customer_id,stripe_subscription_id,updated_at)
      VALUES (?,'essentials',?,?, 'stripe',?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET plan='essentials', status=excluded.status,
      expires_at=COALESCE(excluded.expires_at,memberships.expires_at), source='stripe', note=excluded.note,
      stripe_customer_id=COALESCE(excluded.stripe_customer_id,memberships.stripe_customer_id), stripe_subscription_id=COALESCE(excluded.stripe_subscription_id,memberships.stripe_subscription_id), updated_at=excluded.updated_at`)
      .run(userId.user_id, active ? 'active' : 'cancelled', expires, event.type, customer || null, sub || null, now());
  }

  r.post('/api/billing/webhook', async ({ req }) => {
    if (!stripe || !config.stripeWebhookSecret) throw new HttpError(503, 'Billing webhook is not configured.');
    const raw = await readRaw(req);
    let event;
    try { event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], config.stripeWebhookSecret); }
    catch { throw new HttpError(400, 'Invalid webhook signature.'); }
    if (db.prepare('SELECT 1 FROM billing_events WHERE id = ?').get(event.id)) return { received: true, duplicate: true };
    tx(db, () => {
      if (event.type.startsWith('checkout.session.') || event.type.startsWith('customer.subscription.') || event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') setMembership(event);
      db.prepare('INSERT INTO billing_events (id,event_type) VALUES (?,?)').run(event.id, event.type);
    });
    return { received: true };
  }, { raw: true });
};
