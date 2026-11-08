'use strict';
/* Shop and credits: coach-defined products (lesson packs, single sessions,
   event fees), one-off Stripe Checkout, manual sales, and a per-athlete
   credit ledger that coaches redeem when a session happens. */
const { HttpError, str, int, oneOf } = require('../http');
const { now, tx } = require('../db');
const crypto = require('node:crypto');

const KINDS = ['pack', 'single', 'event', 'other'];
const CREDIT_KINDS = ['private', 'group', 'any'];
const money = c => '$' + (c / 100).toFixed(c % 100 ? 2 : 0);

module.exports = function (r, ctx) {
  const { db, auth, config, notifier } = ctx;
  const stripe = () => ctx.stripe;
  const enabled = () => !!(ctx.stripe && config.stripeWebhookSecret);

  function product(id, { allowInactive = false } = {}) {
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(int(id, 'product', { min: 1, required: true }));
    if (!p || (!allowInactive && !p.active)) throw new HttpError(404, 'Product not found.');
    return p;
  }
  function publicProduct(p) { return { id: p.id, code: p.code, name: p.name, kind: p.kind, description: p.description, price_cents: p.price_cents, price: money(p.price_cents), credits: p.credits, credit_kind: p.credit_kind, expires_days: p.expires_days, active: !!p.active, sort: p.sort }; }
  function fields(body, partial = false) {
    const f = {};
    const want = k => !partial || body[k] !== undefined;
    if (want('name')) f.name = str(body.name, 'name', { required: true, max: 80 });
    if (want('kind')) f.kind = oneOf(body.kind || 'pack', KINDS, 'kind');
    if (want('description')) f.description = str(body.description, 'description', { max: 600 });
    if (want('price_cents')) f.price_cents = int(body.price_cents, 'price', { min: 0, max: 5000000, required: true });
    if (want('credits')) f.credits = int(body.credits === undefined ? 0 : body.credits, 'credits', { min: 0, max: 500 });
    if (want('credit_kind')) f.credit_kind = oneOf(body.credit_kind || 'private', CREDIT_KINDS, 'credit kind');
    if (body.expires_days !== undefined) f.expires_days = body.expires_days === null || body.expires_days === '' ? null : int(body.expires_days, 'expires_days', { min: 1, max: 3650 });
    if (body.stripe_price_id !== undefined) f.stripe_price_id = str(body.stripe_price_id, 'stripe_price_id', { max: 80 }) || null;
    if (body.active !== undefined) f.active = body.active ? 1 : 0;
    if (body.sort !== undefined) f.sort = int(body.sort, 'sort', { min: 0, max: 10000 });
    if (body.code !== undefined) { f.code = str(body.code, 'code', { max: 40 }).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, ''); if (!f.code) delete f.code; }
    return f;
  }
  function athleteFor(user, athleteId) {
    if (athleteId) { const level = auth.athleteAccess(user, athleteId); if (!level) throw new HttpError(404, 'Athlete not found.'); return db.prepare('SELECT * FROM athletes WHERE id=?').get(athleteId); }
    const own = auth.ownAthleteId(user); return own ? db.prepare('SELECT * FROM athletes WHERE id=?').get(own) : null;
  }

  /* ---------- balances ---------- */
  function balance(athleteId) {
    const rows = db.prepare('SELECT credit_kind, SUM(delta) AS n FROM credit_ledger WHERE athlete_id=? AND (expires_at IS NULL OR expires_at > ? OR delta < 0) GROUP BY credit_kind').all(athleteId, now());
    const out = { private: 0, group: 0, any: 0 };
    for (const x of rows) out[x.credit_kind] = (out[x.credit_kind] || 0) + x.n;
    for (const k of CREDIT_KINDS) out[k] = Math.max(0, out[k] || 0);
    const soonest = db.prepare('SELECT MIN(expires_at) AS e FROM credit_ledger WHERE athlete_id=? AND delta > 0 AND expires_at > ?').get(athleteId, now()).e;
    return { ...out, total: out.private + out.group + out.any, expires_soonest: soonest || '' };
  }
  ctx.creditBalance = balance;
  function ledger(athleteId, limit = 50) {
    return db.prepare('SELECT l.*, u.name AS by_name, p.name AS product_name FROM credit_ledger l LEFT JOIN users u ON u.id=l.created_by LEFT JOIN orders o ON o.id=l.order_id LEFT JOIN products p ON p.id=o.product_id WHERE l.athlete_id=? ORDER BY l.created_at DESC, l.id DESC LIMIT ?').all(athleteId, limit)
      .map(x => ({ id: x.id, delta: x.delta, credit_kind: x.credit_kind, reason: x.reason, ref_type: x.ref_type, ref_id: x.ref_id, expires_at: x.expires_at || '', by: x.by_name || '', product: x.product_name || '', at: x.created_at }));
  }
  function grantCredits(athleteId, prod, orderId, by, reason) {
    if (!prod.credits || !athleteId) return;
    const expires = prod.expires_days ? new Date(Date.now() + prod.expires_days * 86400000).toISOString() : null;
    db.prepare('INSERT INTO credit_ledger(athlete_id,delta,credit_kind,reason,ref_type,ref_id,order_id,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(athleteId, prod.credits, prod.credit_kind, reason || prod.name, 'purchase', orderId, orderId, expires, by || null, now());
  }

  /* ---------- public catalogue ---------- */
  r.get('/api/shop', ({ user }) => {
    const products = db.prepare('SELECT * FROM products WHERE active=1 ORDER BY sort,id').all().map(publicProduct);
    const out = { products, checkout_enabled: enabled(), currency: 'usd' };
    if (user) { const a = athleteFor(user); if (a) { out.athlete_id = a.id; out.balance = balance(a.id); } }
    return out;
  });

  /* ---------- coach: products ---------- */
  r.get('/api/products', ({ user }) => { auth.require(user, 'coach'); return { products: db.prepare('SELECT * FROM products ORDER BY active DESC, sort, id').all().map(p => ({ ...publicProduct(p), stripe_price_id: p.stripe_price_id || '' })), checkout_enabled: enabled() }; });
  r.post('/api/products', ({ user, body }) => {
    auth.require(user, 'coach');
    const f = fields(body);
    const code = f.code || f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product';
    let unique = code, n = 2; while (db.prepare('SELECT 1 FROM products WHERE code=?').get(unique)) unique = code + '-' + n++;
    const sort = f.sort !== undefined ? f.sort : db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS n FROM products').get().n;
    const id = db.prepare('INSERT INTO products(code,name,kind,description,price_cents,credits,credit_kind,expires_days,stripe_price_id,active,sort,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(unique, f.name, f.kind, f.description || '', f.price_cents, f.credits || 0, f.credit_kind, f.expires_days || null, f.stripe_price_id || null, f.active === undefined ? 1 : f.active, sort, user.id, now(), now()).lastInsertRowid;
    return publicProduct(product(id, { allowInactive: true }));
  });
  r.put('/api/products/:id', ({ user, params, body }) => {
    auth.require(user, 'coach');
    const p = product(params.id, { allowInactive: true }), f = fields(body, true);
    if (f.code && f.code !== p.code && db.prepare('SELECT 1 FROM products WHERE code=?').get(f.code)) throw new HttpError(409, 'That code is already used.');
    const keys = Object.keys(f);
    if (keys.length) db.prepare('UPDATE products SET ' + keys.map(k => k + '=?').join(',') + ', updated_at=? WHERE id=?').run(...keys.map(k => f[k]), now(), p.id);
    return publicProduct(product(p.id, { allowInactive: true }));
  });

  /* ---------- checkout (one-off payment) ---------- */
  r.post('/api/shop/checkout', async ({ user, body }) => {
    auth.require(user);
    if (!enabled()) throw new HttpError(503, 'Online checkout is not connected yet. Your coach can record a purchase for you.');
    const prod = product(body.product_id);
    if (prod.price_cents <= 0) throw new HttpError(400, 'This product has no price.');
    const a = athleteFor(user);
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO orders(id,user_id,athlete_id,product_id,status,amount_cents,source,created_at) VALUES(?,?,?,?,'pending',?,'stripe',?)").run(id, user.id, a ? a.id : null, prod.id, prod.price_cents, now());
    const line = prod.stripe_price_id ? { price: prod.stripe_price_id, quantity: 1 } : { quantity: 1, price_data: { currency: 'usd', unit_amount: prod.price_cents, product_data: { name: prod.name, description: prod.description || undefined } } };
    const session = await stripe().checkout.sessions.create({
      mode: 'payment', customer_email: user.email, line_items: [line],
      success_url: `${config.publicUrl}/#/shop?order=${id}&checkout=success`, cancel_url: `${config.publicUrl}/#/shop?checkout=cancelled`,
      client_reference_id: String(user.id), metadata: { lab_kind: 'order', lab_order_id: id, lab_user_id: String(user.id) }, allow_promotion_codes: true, integration_identifier: config.stripeIntegrationIdentifier
    });
    db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run(session.id || null, id);
    return { url: session.url, order_id: id };
  });

  // Called inside the billing webhook transaction for every verified Stripe event.
  ctx.billingHooks = ctx.billingHooks || [];
  ctx.billingHooks.push(event => {
    const obj = event.data && event.data.object || {};
    if (!obj.metadata || obj.metadata.lab_kind !== 'order') return;
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(obj.metadata.lab_order_id);
    if (!order) return;
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      if (!['paid', 'no_payment_required'].includes(obj.payment_status)) return;
      if (order.status === 'paid') return;
      const prod = product(order.product_id, { allowInactive: true });
      db.prepare("UPDATE orders SET status='paid', paid_at=?, stripe_payment_intent=? WHERE id=?").run(now(), typeof obj.payment_intent === 'string' ? obj.payment_intent : null, order.id);
      grantCredits(order.athlete_id, prod, order.id, null, 'Purchased ' + prod.name);
      notifier.notify([order.user_id], 'training', `Payment received: ${prod.name}`, prod.credits ? `${prod.credits} ${prod.credit_kind === 'any' ? '' : prod.credit_kind + ' '}credit${prod.credits === 1 ? '' : 's'} added to your account.` : 'Thank you.', '#/shop');
      const coaches = db.prepare("SELECT DISTINCT u.id FROM users u WHERE u.roles LIKE '%coach%' OR u.roles LIKE '%admin%'").all().map(x => x.id);
      notifier.notify(coaches, 'training', `New purchase: ${prod.name}`, `${money(prod.price_cents)} · order ${order.id.slice(0, 8)}`, '#/coach/sales');
    } else if (event.type === 'checkout.session.expired') {
      if (order.status === 'pending') db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(order.id);
    } else if (event.type === 'charge.refunded' && order.status === 'paid') {
      db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(order.id);
      const granted = db.prepare('SELECT SUM(delta) AS n, credit_kind FROM credit_ledger WHERE order_id=? AND delta>0 GROUP BY credit_kind').all(order.id);
      for (const g of granted) if (g.n && order.athlete_id) db.prepare("INSERT INTO credit_ledger(athlete_id,delta,credit_kind,reason,ref_type,ref_id,order_id,created_at) VALUES(?,?,?,?,'adjust',?,?,?)").run(order.athlete_id, -g.n, g.credit_kind, 'Refund', order.id, order.id, now());
    }
  });

  /* ---------- my orders / credits ---------- */
  r.get('/api/me/credits', ({ user }) => {
    auth.require(user);
    const a = athleteFor(user);
    const orders = db.prepare('SELECT o.*, p.name AS product_name FROM orders o JOIN products p ON p.id=o.product_id WHERE o.user_id=? ORDER BY o.created_at DESC LIMIT 50').all(user.id).map(o => ({ id: o.id, product: o.product_name, status: o.status, amount: money(o.amount_cents), source: o.source, at: o.paid_at || o.created_at }));
    return { athlete_id: a ? a.id : null, balance: a ? balance(a.id) : null, ledger: a ? ledger(a.id) : [], orders };
  });
  r.get('/api/orders/:id', ({ user, params }) => {
    auth.require(user);
    const o = db.prepare('SELECT o.*, p.name AS product_name, p.credits FROM orders o JOIN products p ON p.id=o.product_id WHERE o.id=?').get(String(params.id));
    if (!o || (o.user_id !== user.id && !auth.has(user, 'coach'))) throw new HttpError(404, 'Order not found.');
    return { id: o.id, product: o.product_name, status: o.status, amount: money(o.amount_cents), credits: o.credits, at: o.paid_at || o.created_at };
  });

  /* ---------- coach: athlete credits ---------- */
  r.get('/api/athletes/:id/credits', ({ user, params }) => {
    auth.require(user);
    const a = athleteFor(user, int(params.id, 'athlete', { min: 1, required: true }));
    return { athlete: { id: a.id, name: a.name }, balance: balance(a.id), ledger: ledger(a.id) };
  });
  // Record a sale made outside Stripe (cash, Venmo, Zelle) or grant/adjust credits directly.
  r.post('/api/athletes/:id/credits', ({ user, params, body }) => {
    auth.require(user, 'coach');
    const a = athleteFor(user, int(params.id, 'athlete', { min: 1, required: true }));
    if (!auth.coachesAthlete(user, a.id)) throw new HttpError(404, 'Athlete not found.');
    if (body.product_id) {
      const prod = product(body.product_id, { allowInactive: true });
      const id = crypto.randomUUID(), source = oneOf(body.source || 'manual', ['manual', 'cash', 'venmo', 'zelle', 'comp', 'other'], 'source');
      const amount = body.amount_cents !== undefined ? int(body.amount_cents, 'amount', { min: 0, max: 5000000 }) : prod.price_cents;
      tx(db, () => {
        db.prepare("INSERT INTO orders(id,user_id,athlete_id,product_id,status,amount_cents,source,note,recorded_by,created_at,paid_at) VALUES(?,?,?,?,'paid',?,?,?,?,?,?)").run(id, a.user_id || user.id, a.id, prod.id, amount, source, str(body.note, 'note', { max: 300 }), user.id, now(), now());
        grantCredits(a.id, prod, id, user.id, (source === 'comp' ? 'Comped ' : 'Purchased ') + prod.name);
      });
      if (a.user_id) notifier.notify([a.user_id], 'training', `${prod.name} added by ${user.name}`, prod.credits ? `${prod.credits} credit${prod.credits === 1 ? '' : 's'} on your account.` : '', '#/shop');
      return { ok: true, order_id: id, balance: balance(a.id) };
    }
    const delta = int(body.delta, 'credits', { min: -500, max: 500, required: true });
    if (!delta) throw new HttpError(400, 'Credits must be a non-zero number.');
    const kind = oneOf(body.credit_kind || 'private', CREDIT_KINDS, 'credit kind');
    db.prepare("INSERT INTO credit_ledger(athlete_id,delta,credit_kind,reason,ref_type,created_by,created_at) VALUES(?,?,?,?,'adjust',?,?)").run(a.id, delta, kind, str(body.reason, 'reason', { max: 300 }) || (delta > 0 ? 'Credit added' : 'Credit removed'), user.id, now());
    return { ok: true, balance: balance(a.id) };
  });
  // Redeem one credit for a session that happened.
  r.post('/api/athletes/:id/credits/redeem', ({ user, params, body }) => {
    auth.require(user, 'coach');
    const a = athleteFor(user, int(params.id, 'athlete', { min: 1, required: true }));
    if (!auth.coachesAthlete(user, a.id)) throw new HttpError(404, 'Athlete not found.');
    const kind = oneOf(body.credit_kind || 'private', CREDIT_KINDS, 'credit kind');
    const sessionId = body.session_id ? str(body.session_id, 'session_id', { max: 80 }) : '';
    if (sessionId && db.prepare("SELECT 1 FROM credit_ledger WHERE athlete_id=? AND ref_type='session' AND ref_id=?").get(a.id, sessionId)) return { ok: true, duplicate: true, balance: balance(a.id) };
    const bal = balance(a.id);
    const use = bal[kind] > 0 ? kind : bal.any > 0 ? 'any' : null;
    if (!use) throw new HttpError(409, 'No ' + kind + ' credits left. Record a purchase first, or allow the session to go negative with an adjustment.');
    db.prepare("INSERT INTO credit_ledger(athlete_id,delta,credit_kind,reason,ref_type,ref_id,created_by,created_at) VALUES(?,?,?,?,'session',?,?,?)").run(a.id, -1, use, str(body.reason, 'reason', { max: 300 }) || 'Session', sessionId || null, user.id, now());
    const after = balance(a.id);
    if (a.user_id && after.total <= 1) notifier.notify([a.user_id], 'training', after.total === 0 ? 'You’re out of lesson credits' : 'One lesson credit left', 'Top up in the shop to keep your spot.', '#/shop');
    return { ok: true, balance: after };
  });

  /* ---------- coach: sales overview ---------- */
  r.get('/api/coach/sales', ({ user, query }) => {
    auth.require(user, 'coach');
    const days = Math.min(365, Math.max(7, Number(query.get('days')) || 90));
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const orders = db.prepare("SELECT o.*, p.name AS product_name, p.kind, a.name AS athlete_name, u.name AS user_name FROM orders o JOIN products p ON p.id=o.product_id LEFT JOIN athletes a ON a.id=o.athlete_id LEFT JOIN users u ON u.id=o.user_id WHERE o.status='paid' AND o.paid_at>=? ORDER BY o.paid_at DESC").all(since)
      .map(o => ({ id: o.id, product: o.product_name, kind: o.kind, who: o.athlete_name || o.user_name || '', amount_cents: o.amount_cents, amount: money(o.amount_cents), source: o.source, at: o.paid_at }));
    const revenue = orders.reduce((s, o) => s + o.amount_cents, 0);
    const outstanding = db.prepare('SELECT SUM(delta) AS n FROM credit_ledger WHERE expires_at IS NULL OR expires_at > ?').get(now()).n || 0;
    const byProduct = {}; for (const o of orders) { byProduct[o.product] = byProduct[o.product] || { product: o.product, count: 0, cents: 0 }; byProduct[o.product].count++; byProduct[o.product].cents += o.amount_cents; }
    return { days, revenue_cents: revenue, revenue: money(revenue), orders, by_product: Object.values(byProduct).sort((a, b) => b.cents - a.cents).map(x => ({ ...x, amount: money(x.cents) })), credits_outstanding: Math.max(0, outstanding), checkout_enabled: enabled() };
  });
};
module.exports.money = money;
