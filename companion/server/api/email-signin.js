'use strict';
const { HttpError, withStatus, str } = require('../http.js');
const { sha256, token } = require('../auth.js');
const { tx } = require('../db.js');

module.exports = function emailSignIn(r, { db, auth, config }) {
  db.exec(`CREATE TABLE IF NOT EXISTS email_signins (
    token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS email_signin_limits (
    key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );`);
  function rate(key, max) {
    const t = Date.now();
    db.prepare('DELETE FROM email_signin_limits WHERE expires_at<=?').run(t);
    const row = db.prepare(`INSERT INTO email_signin_limits VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`).get(sha256(key), t + 3600000);
    if (row.count > max) throw new HttpError(429, 'Too many sign-in requests. Try again in an hour.');
  }
  r.post('/api/auth/email/request', async ({ body, req }) => {
    const email = str(body.email, 'email', { required: true, max: 200 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (!config.magicEnabled) throw new HttpError(503, 'Email sign-in is unavailable. Please try another sign-in option.');
    // Bound both recipient and total per-connection sends; limits survive restarts.
    rate('email:' + email, 5);
    rate('ip:' + (req.socket.remoteAddress || 'unknown'), 50);
    const t = token();
    db.prepare('DELETE FROM email_signins WHERE expires_at<=?').run(Date.now());
    db.prepare('INSERT INTO email_signins VALUES (?,?,?)').run(sha256(t), email, Date.now() + 900000);
    try { await config.onSignInLink(email, `${config.publicUrl}/#/email-signin/${t}`); }
    catch {
      db.prepare('DELETE FROM email_signins WHERE token_hash=?').run(sha256(t));
      throw new HttpError(503, 'We could not send your sign-in email. Please try again shortly.');
    }
    return withStatus(202, { ok: true });
  });
  // POST only: mail security scanners opening the link cannot consume it.
  r.post('/api/auth/email/confirm', ({ body, res }) => {
    const value = str(body.token, 'token', { required: true, max: 100 });
    const user = tx(db, () => {
      const row = db.prepare('DELETE FROM email_signins WHERE token_hash=? AND expires_at>? RETURNING email').get(sha256(value), Date.now());
      if (!row) throw new HttpError(400, 'This sign-in link has expired or was already used. Request a new link.');
      let u = db.prepare('SELECT * FROM users WHERE email=?').get(row.email);
      if (!u) {
        const roles = config.adminEmail && row.email === config.adminEmail.toLowerCase()
          ? ['athlete', 'coach', 'contributor', 'editor', 'admin'] : ['athlete'];
        const id = db.prepare('INSERT INTO users(email,name,password_hash,roles) VALUES (?,?,?,?)')
          .run(row.email, row.email.split('@')[0].slice(0,80), 'oauth$' + token(), JSON.stringify(roles)).lastInsertRowid;
        u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      }
      return u;
    });
    const session = auth.startSession(user.id);
    res.setHeader('Set-Cookie', session.cookie);
    res.setHeader('Cache-Control', 'no-store');
    return { user: auth.userRow(user), athlete_id: auth.ownAthleteId(user), has_password: !user.password_hash.startsWith('oauth$') };
  });
};
