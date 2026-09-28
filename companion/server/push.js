'use strict';
/* Web Push without dependencies: message encryption (RFC 8291, aes128gcm)
   and VAPID sender identity (RFC 8292), on Node's crypto.
   Keys: run `node server/push.js --keys` once and set VAPID_PUBLIC_KEY,
   VAPID_PRIVATE_KEY and VAPID_SUBJECT (mailto:you@example.com) on the server. */
const crypto = require('node:crypto');

const b64u = buf => Buffer.from(buf).toString('base64url');
const fromB64u = s => Buffer.from(String(s), 'base64url');

function generateKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

/* Encrypt one payload for one subscription. Returns the request body. */
function encrypt(payload, p256dh, authSecret, { salt = crypto.randomBytes(16), serverKeys } = {}) {
  const uaPublic = fromB64u(p256dh);
  const auth = fromB64u(authSecret);
  if (uaPublic.length !== 65 || auth.length !== 16) throw new Error('Invalid subscription keys.');
  const as = serverKeys || crypto.createECDH('prime256v1');
  if (!serverKeys) as.generateKeys();
  const asPublic = as.getPublicKey();
  const shared = as.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]); // last-record delimiter
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/* VAPID: a short-lived ES256 JWT for the push service's origin. */
function vapidHeaders(endpoint, { publicKey, privateKey, subject }) {
  const pub = fromB64u(publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) };
  const key = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return { Authorization: `vapid t=${head}.${claims}.${b64u(sig)}, k=${publicKey}` };
}

function createPush(db, { publicKey, privateKey, subject, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const enabled = !!(publicKey && privateKey && subject);
  async function sendOne(sub, message) {
    const body = encrypt(JSON.stringify(message), sub.p256dh, sub.auth);
    const res = await fetchImpl(sub.endpoint, {
      method: 'POST',
      headers: { ...vapidHeaders(sub.endpoint, { publicKey, privateKey, subject }), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' },
      body
    });
    // Gone or unknown: the browser dropped this subscription.
    if (res.status === 404 || res.status === 410) {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
      db.prepare('DELETE FROM guest_push WHERE endpoint = ?').run(sub.endpoint);
    } else record(sub.endpoint, res.status);
    return res.status;
  }
  /* The push service's answer, so organizers can see whose alerts fail.
     Accepted only means the push service took it, not that the phone showed it. */
  function record(endpoint, status) {
    const t = new Date().toISOString();
    db.prepare('UPDATE push_subscriptions SET last_status = ?, last_at = ? WHERE endpoint = ?').run(status, t, endpoint);
    db.prepare('UPDATE guest_push SET last_status = ?, last_at = ? WHERE endpoint = ?').run(status, t, endpoint);
  }
  const fail = sub => e => { log(`[push error] ${e.message}`); try { record(sub.endpoint, 599); } catch {} };
  /* Fire-and-forget to every device the user has turned push on for. */
  function toUser(userId, message) {
    if (!enabled) return;
    db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId)
      .forEach(sub => sendOne(sub, message).catch(fail(sub)));
  }
  /* Players who joined an event with a link and no account. */
  function toGuest(athleteId, message) {
    if (!enabled) return;
    db.prepare('SELECT * FROM guest_push WHERE athlete_id = ?').all(athleteId)
      .forEach(sub => sendOne(sub, message).catch(fail(sub)));
  }
  return { enabled, publicKey, sendOne, toUser, toGuest };
}

module.exports = { createPush, encrypt, vapidHeaders, generateKeys };

if (require.main === module && process.argv.includes('--keys')) {
  const k = generateKeys();
  console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\nVAPID_SUBJECT=mailto:you@example.com`);
}
