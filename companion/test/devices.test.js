'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { start, staff } = require('./helpers.js');
const { encrypt, vapidHeaders, generateKeys, createPush } = require('../server/push.js');
const { open } = require('../server/db.js');

/* The receiving side of RFC 8291, as a browser does it. */
function decrypt(body, ua, auth) {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  assert.equal(rs, 4096);
  const shared = ua.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
  return plain.subarray(0, plain.length - 1).toString();
}

test('web push: encryption round-trips, VAPID JWT verifies, gone subscriptions are removed', async () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const body = encrypt('{"title":"Court 2"}', ua.getPublicKey().toString('base64url'), auth.toString('base64url'));
  assert.equal(decrypt(body, ua, auth), '{"title":"Court 2"}');

  const keys = generateKeys();
  const hdr = vapidHeaders('https://fcm.googleapis.com/fcm/send/abc', { ...keys, subject: 'mailto:a@b.c' });
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(hdr.Authorization);
  assert.ok(m);
  const claims = JSON.parse(Buffer.from(m[2], 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  const pub = Buffer.from(keys.publicKey, 'base64url');
  const verifyKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: verifyKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')));

  const db = open(':memory:');
  db.prepare("INSERT INTO users (email, name, password_hash) VALUES ('p@x', 'P', 'x')").run();
  db.prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, ?, ?, ?)').run('https://push.example/gone', ua.getPublicKey().toString('base64url'), auth.toString('base64url'));
  const sent = [];
  const push = createPush(db, { ...keys, subject: 'mailto:a@b.c', fetchImpl: async (url, o) => { sent.push({ url, o }); return { status: 410 }; } });
  assert.equal(await push.sendOne(db.prepare('SELECT * FROM push_subscriptions').get(), { title: 'x' }), 410);
  assert.equal(sent[0].o.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(decrypt(sent[0].o.body, ua, auth), '{"title":"x"}');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 0);
});

test('notifications fan out to push subscriptions; subscribe validates input', async (t) => {
  const keys = generateKeys();
  const deliveries = [];
  const s = await start({ vapidPublic: keys.publicKey, vapidPrivate: keys.privateKey, vapidSubject: 'mailto:a@b.c', fetchImpl: async (url, o) => { deliveries.push(url); return { status: 201 }; } });
  t.after(s.close);
  const { coach } = await staff(s);
  const made = (await coach.post('/api/athletes', { name: 'Pu Sh' })).body;
  const a = s.client(); await a.signup('Pu Sh', 'push@lab.test'); await a.post('/api/claim', { code: made.claim_code });
  assert.equal((await a.get('/api/push/key')).body.publicKey, keys.publicKey);
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  assert.equal((await a.post('/api/push/subscribe', { endpoint: 'http://insecure', keys: {} })).status, 400);
  assert.equal((await a.post('/api/push/subscribe', { endpoint: 'https://push.example/x', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } })).status, 204);
  await coach.post(`/api/athletes/${made.athlete.id}/notes`, { body: 'Nice', visibility: 'shared' });
  await new Promise(r => setTimeout(r, 30));
  assert.deepEqual(deliveries, ['https://push.example/x']);
  await a.put('/api/me/prefs', { feedback: false });
  await coach.post(`/api/athletes/${made.athlete.id}/notes`, { body: 'Again', visibility: 'shared' });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(deliveries.length, 1, 'opted-out kinds don’t push either');
  assert.equal((await a.get('/api/meta')).body.push, true);
});

test('sign in with Google: state check, claim checks, links by email, creates new accounts', async (t) => {
  const idToken = claims => 'x.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.y';
  let next = null;
  const s = await start({ googleClientId: 'cid', googleClientSecret: 'sec', fetchImpl: async (url, o) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.match(o.body, /client_secret=sec/);
    return { ok: true, json: async () => ({ id_token: idToken(next) }) };
  } });
  t.after(s.close);
  const flow = async (claims, { badState } = {}) => {
    next = claims;
    const st = await fetch(s.base + '/api/auth/google/start', { redirect: 'manual' });
    assert.equal(st.status, 302);
    const loc = new URL(st.headers.get('location'));
    assert.equal(loc.origin, 'https://accounts.google.com');
    const state = loc.searchParams.get('state');
    const cookie = st.headers.get('set-cookie').split(';')[0];
    const cb = await fetch(`${s.base}/api/auth/google/callback?code=abc&state=${badState ? 'nope' : state}`, { redirect: 'manual', headers: { Cookie: cookie } });
    return { loc: cb.headers.get('location'), session: (cb.headers.get('set-cookie') || '').match(/lab_session=[^;]+/) };
  };
  const good = { aud: 'cid', iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, email: 'gia@lab.test', name: 'Gia G', sub: 'g-1' };
  assert.match((await flow(good, { badState: true })).loc, /error=Sign-in%20expired/);
  assert.match((await flow({ ...good, aud: 'other' })).loc, /error=/);
  assert.match((await flow({ ...good, email_verified: false })).loc, /error=/);

  // Existing password account with the same email is linked, not duplicated.
  const pw = s.client(); const orig = (await pw.signup('Gia G', 'gia@lab.test')).body.user;
  const r1 = await flow(good);
  assert.equal(r1.loc, '/#/');
  const me = await fetch(s.base + '/api/me', { headers: { Cookie: r1.session[0] } }).then(r => r.json());
  assert.equal(me.user.id, orig.id);

  // Brand-new Google account: athlete role, no password, can delete with DELETE.
  const r2 = await flow({ ...good, email: 'new@lab.test', sub: 'g-2', name: 'New Person' });
  const c = { Cookie: r2.session[0], 'Content-Type': 'application/json' };
  const me2 = await fetch(s.base + '/api/me', { headers: c }).then(r => r.json());
  assert.deepEqual([me2.user.roles, me2.has_password], [['athlete'], false]);
  assert.equal((await s.client().post('/api/auth/login', { email: 'new@lab.test', password: 'anything at all' })).status, 401);
  assert.equal((await fetch(s.base + '/api/me/password', { method: 'POST', headers: c, body: JSON.stringify({ password: 'my new password' }) })).status, 204);
  assert.equal((await fetch(s.base + '/api/me/delete', { method: 'POST', headers: c, body: JSON.stringify({ password: 'my new password' }) })).status, 204);
});
