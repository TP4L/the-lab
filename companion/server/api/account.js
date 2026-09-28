'use strict';
const { HttpError, withStatus, str, oneOf, int, list } = require('../http.js');
const { ROLES, hashPassword, verifyPassword, sha256, token, limiter } = require('../auth.js');
const { tx, now } = require('../db.js');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = function account(r, { db, auth, config }) {
  const loginLimit = limiter(10, 15 * 60 * 1000);
  const resetLimit = limiter(5, 60 * 60 * 1000);

  /* Behind a hosting proxy (TRUST_PROXY=1) the client is the first X-Forwarded-For hop. */
  function clientIp(req) {
    if (config.trustProxy) { const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (f) return f; }
    return req.socket.remoteAddress || '';
  }
  function email(v) {
    const e = str(v, 'email', { required: true, max: 200 }).toLowerCase();
    if (!EMAIL.test(e)) throw new HttpError(400, 'Enter a valid email address.');
    return e;
  }
  function password(v) {
    if (typeof v !== 'string' || v.length < 10) throw new HttpError(400, 'Password must be at least 10 characters.');
    if (v.length > 200) throw new HttpError(400, 'Password is too long.');
    return v;
  }
  function me(user) {
    const athleteId = auth.ownAthleteId(user);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    return { user, athlete_id: athleteId, has_password: !!row && !String(row.password_hash).startsWith('oauth$') };
  }

  r.post('/api/auth/signup', ({ body, res }) => {
    const e = email(body.email);
    const name = str(body.name, 'name', { required: true, max: 80 });
    const pw = password(body.password);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(e)) throw new HttpError(409, 'An account with that email already exists. Sign in instead.');
    // Everyone signs up as an athlete. Staff roles are granted by an admin,
    // except the configured owner email, which bootstraps the first admin.
    const roles = config.adminEmail && e === config.adminEmail.toLowerCase() ? ['athlete', 'coach', 'contributor', 'editor', 'admin'] : ['athlete'];
    const id = Number(db.prepare('INSERT INTO users (email, name, password_hash, roles) VALUES (?, ?, ?, ?)').run(e, name, hashPassword(pw), JSON.stringify(roles)).lastInsertRowid);
    const s = auth.startSession(id);
    res.setHeader('Set-Cookie', s.cookie);
    return withStatus(201, me(auth.userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(id))));
  });

  r.post('/api/auth/login', ({ body, res, req }) => {
    const e = email(body.email);
    const key = clientIp(req) + '|' + e;
    if (!loginLimit(key)) throw new HttpError(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(e);
    if (!u || typeof body.password !== 'string' || !verifyPassword(body.password, u.password_hash)) throw new HttpError(401, 'Email or password is incorrect.');
    const s = auth.startSession(u.id);
    res.setHeader('Set-Cookie', s.cookie);
    return me(auth.userRow(u));
  });

  /* ---------- Sign in with Google (OpenID Connect, authorization code flow) ----------
     The ID token comes straight from Google's token endpoint over TLS, so its
     claims are trusted after checking audience, issuer, expiry and email_verified.
     An existing account with the same verified email is signed in, never duplicated. */
  const GOOGLE_STATE = 'lab_oauth_state';
  const googleRedirect = () => `${config.publicUrl}/api/auth/google/callback`;
  r.get('/api/auth/google/start', ({ res }) => {
    if (!config.googleEnabled) throw new HttpError(404, 'Sign in with Google isn\u2019t set up on this server.');
    const state = token(16);
    const q = new URLSearchParams({ client_id: config.googleClientId, redirect_uri: googleRedirect(), response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
    res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, 'Set-Cookie': `${GOOGLE_STATE}=${state}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${config.secureCookies ? '; Secure' : ''}`, 'Cache-Control': 'no-store' });
    res.end();
  });
  r.get('/api/auth/google/callback', async ({ req, res, query }) => {
    const fail = msg => { res.writeHead(302, { Location: `/#/signin?error=${encodeURIComponent(msg)}`, 'Cache-Control': 'no-store' }); res.end(); };
    if (!config.googleEnabled) return fail('Sign in with Google isn\u2019t set up.');
    const m = /(?:^|;\s*)lab_oauth_state=([^;]+)/.exec(req.headers.cookie || '');
    if (!m || !query.get('state') || m[1] !== query.get('state')) return fail('Sign-in expired. Try again.');
    if (!query.get('code')) return fail('Google sign-in was cancelled.');
    let claims;
    try {
      const tr = await config.fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: query.get('code'), client_id: config.googleClientId, client_secret: config.googleClientSecret, redirect_uri: googleRedirect(), grant_type: 'authorization_code' }).toString()
      });
      const tok = await tr.json();
      if (!tr.ok || !tok.id_token) return fail('Google didn\u2019t accept the sign-in. Try again.');
      claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString('utf8'));
    } catch { return fail('Couldn\u2019t reach Google. Try again.'); }
    const nowS = Math.floor(Date.now() / 1000);
    if (claims.aud !== config.googleClientId || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || !(claims.exp > nowS) || claims.email_verified !== true || !claims.email) {
      return fail('That Google account couldn\u2019t be verified.');
    }
    const e = String(claims.email).toLowerCase();
    let u = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(claims.sub) || db.prepare('SELECT * FROM users WHERE email = ?').get(e);
    if (u && !u.google_sub) db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(claims.sub, u.id);
    if (!u) {
      const roles = config.adminEmail && e === config.adminEmail.toLowerCase() ? ['athlete', 'coach', 'contributor', 'editor', 'admin'] : ['athlete'];
      const id = Number(db.prepare('INSERT INTO users (email, name, password_hash, roles, google_sub) VALUES (?, ?, ?, ?, ?)')
        .run(e, String(claims.name || e.split('@')[0]).slice(0, 80), 'oauth$' + token(8), JSON.stringify(roles), claims.sub).lastInsertRowid);
      u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    }
    const s = auth.startSession(u.id);
    res.writeHead(302, { Location: '/#/', 'Set-Cookie': [s.cookie, `${GOOGLE_STATE}=; Path=/api/auth/google; Max-Age=0`], 'Cache-Control': 'no-store' });
    res.end();
  });

  r.post('/api/auth/logout', ({ req, res }) => {
    res.setHeader('Set-Cookie', auth.endSession(req));
    return withStatus(204, null);
  });

  r.get('/api/me', ({ user }) => me(auth.require(user)));

  r.put('/api/me', ({ user, body }) => {
    auth.require(user);
    const name = str(body.name, 'name', { required: true, max: 80 });
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
    return me({ ...user, name });
  });

  r.post('/api/me/password', ({ user, body, req }) => {
    auth.require(user);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    const googleOnly = String(u.password_hash).startsWith('oauth$');
    if (!googleOnly && (typeof body.current !== 'string' || !verifyPassword(body.current, u.password_hash))) throw new HttpError(400, 'Current password is incorrect.');
    const pw = password(body.password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), user.id);
    // Sign out other devices.
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?').run(user.id, sha256(readToken(req) || ''));
    return withStatus(204, null);
  });

  function readToken(req) {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) return h.slice(7);
    const m = /(?:^|;\s*)lab_session=([^;]+)/.exec(req.headers.cookie || '');
    return m ? decodeURIComponent(m[1]) : null;
  }

  /* Account deletion. The login, sessions and the athlete's own reflections
     and uploads are deleted. A profile a coach created stays with the coach,
     unlinked, so their session records aren't lost; a self-made profile with
     no coach is deleted outright. */
  r.post('/api/me/delete', ({ user, body, res, req }) => {
    auth.require(user);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (String(u.password_hash).startsWith('oauth$')) {
      if (body.confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm.');
    } else if (typeof body.password !== 'string' || !verifyPassword(body.password, u.password_hash)) throw new HttpError(400, 'Password is incorrect.');
    const files = [];
    tx(db, () => {
      const a = db.prepare('SELECT * FROM athletes WHERE user_id = ?').get(user.id);
      if (a) {
        db.prepare("DELETE FROM notes WHERE athlete_id = ? AND kind = 'reflection'").run(a.id);
        db.prepare('SELECT file FROM media WHERE athlete_id = ? AND owner_id = ?').all(a.id, user.id).forEach(m => files.push(m.file));
        db.prepare('DELETE FROM media WHERE athlete_id = ? AND owner_id = ?').run(a.id, user.id);
        const coached = db.prepare('SELECT 1 FROM coach_athletes WHERE athlete_id = ?').get(a.id);
        if (!coached) db.prepare('DELETE FROM athletes WHERE id = ?').run(a.id);
        else db.prepare("UPDATE athletes SET user_id = NULL, photo_media_id = NULL, updated_at = ? WHERE id = ?").run(now(), a.id);
      }
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    });
    config.removeFiles(files);
    res.setHeader('Set-Cookie', auth.endSession(req));
    return withStatus(204, null);
  });

  /* Account recovery. The response never says whether the email exists.
     Until an email provider is configured, the link goes to config.onResetLink
     (the server log by default) and admins can issue links from the Admin screen. */
  function issueReset(userId) {
    const t = token();
    db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(sha256(t), userId, new Date(Date.now() + 3600e3).toISOString());
    return `${config.publicUrl}/#/reset/${t}`;
  }
  r.post('/api/auth/reset/request', ({ body, req }) => {
    const e = email(body.email);
    if (!resetLimit(clientIp(req) + '|' + e)) throw new HttpError(429, 'Too many reset requests. Try again in an hour.');
    const u = db.prepare('SELECT id, email FROM users WHERE email = ?').get(e);
    if (u) config.onResetLink(u.email, issueReset(u.id));
    return withStatus(202, { ok: true });
  });
  r.post('/api/auth/reset/confirm', ({ body, res }) => {
    const t = str(body.token, 'token', { required: true, max: 100 });
    const pw = password(body.password);
    const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(t));
    if (!row || row.used || row.expires_at < new Date().toISOString()) throw new HttpError(400, 'This reset link has expired or was already used. Request a new one.');
    tx(db, () => {
      db.prepare('UPDATE password_resets SET used = 1 WHERE token_hash = ?').run(sha256(t));
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), row.user_id);
      db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(row.user_id);
    });
    const s = auth.startSession(row.user_id);
    res.setHeader('Set-Cookie', s.cookie);
    return me(auth.userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id)));
  });

  /* ---------- admin ---------- */
  r.get('/api/admin/users', ({ user, query }) => {
    auth.require(user, 'admin');
    const q = '%' + (query.get('q') || '').trim() + '%';
    return db.prepare(`SELECT u.*, a.id AS athlete_id, m.status AS m_status, m.expires_at AS m_expires, m.plan AS m_plan FROM users u
      LEFT JOIN athletes a ON a.user_id = u.id LEFT JOIN memberships m ON m.user_id = u.id
      WHERE u.name LIKE ? OR u.email LIKE ? ORDER BY u.name COLLATE NOCASE LIMIT 200`).all(q, q)
      .map(u => ({ ...auth.userRow(u), athlete_id: u.athlete_id,
        membership: u.m_status ? { plan: u.m_plan, status: u.m_status, expires_at: u.m_expires, active: u.m_status === 'active' && (!u.m_expires || u.m_expires > new Date().toISOString()) } : null }));
  });
  r.put('/api/admin/users/:id/roles', ({ user, params, body }) => {
    auth.require(user, 'admin');
    const id = int(params.id, 'id', { min: 1, required: true });
    const roles = [...new Set(list(body.roles, 'roles', { max: 5, item: (x, f) => oneOf(x, ROLES, f) }))];
    if (!roles.includes('athlete')) roles.unshift('athlete');
    if (id === user.id && !roles.includes('admin')) throw new HttpError(400, 'You can’t remove your own admin role.');
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw new HttpError(404, 'User not found.');
    db.prepare('UPDATE users SET roles = ? WHERE id = ?').run(JSON.stringify(roles), id);
    return auth.userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  });
  r.post('/api/admin/users/:id/reset-link', ({ user, params }) => {
    auth.require(user, 'admin');
    const id = int(params.id, 'id', { min: 1, required: true });
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw new HttpError(404, 'User not found.');
    return { link: issueReset(id), expires_in_minutes: 60 };
  });
};
