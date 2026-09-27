'use strict';
const { HttpError, withStatus, str, oneOf, int, list } = require('../http.js');
const { ROLES, hashPassword, verifyPassword, sha256, token, limiter } = require('../auth.js');
const { tx, now } = require('../db.js');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = function account(r, { db, auth, config }) {
  const loginLimit = limiter(10, 15 * 60 * 1000);
  const resetLimit = limiter(5, 60 * 60 * 1000);

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
    return { user, athlete_id: athleteId };
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
    const key = (req.socket.remoteAddress || '') + '|' + e;
    if (!loginLimit(key)) throw new HttpError(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(e);
    if (!u || typeof body.password !== 'string' || !verifyPassword(body.password, u.password_hash)) throw new HttpError(401, 'Email or password is incorrect.');
    const s = auth.startSession(u.id);
    res.setHeader('Set-Cookie', s.cookie);
    return me(auth.userRow(u));
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
    if (typeof body.current !== 'string' || !verifyPassword(body.current, u.password_hash)) throw new HttpError(400, 'Current password is incorrect.');
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
    if (typeof body.password !== 'string' || !verifyPassword(body.password, u.password_hash)) throw new HttpError(400, 'Password is incorrect.');
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
    if (!resetLimit((req.socket.remoteAddress || '') + '|' + e)) throw new HttpError(429, 'Too many reset requests. Try again in an hour.');
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
    return db.prepare(`SELECT u.*, a.id AS athlete_id FROM users u LEFT JOIN athletes a ON a.user_id = u.id
      WHERE u.name LIKE ? OR u.email LIKE ? ORDER BY u.name COLLATE NOCASE LIMIT 200`).all(q, q)
      .map(u => ({ ...auth.userRow(u), athlete_id: u.athlete_id }));
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
