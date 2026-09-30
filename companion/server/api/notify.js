'use strict';
const { HttpError, withStatus, int } = require('../http.js');
const { now } = require('../db.js');

/* Notification kinds a person can switch off. All on by default. */
const PREFS = {
  courts: 'Court assignments and rotations',
  up_next: 'You’re up next',
  feedback: 'Shared feedback from your coach',
  training: 'Training assigned by your coach',
  matches: 'Match confirmations and corrections',
  events: 'Event registration and check-in',
  reminders: 'Reminders before events',
  content: 'New Field Notes'
};
const SETTINGS = { email_notifications: 'Email me coach notes, training and event updates', leaderboard: 'Show me on leaderboards' };

function prefsOf(row) {
  let p = {};
  try { p = JSON.parse(row.prefs || '{}'); } catch {}
  const out = {};
  Object.keys(PREFS).concat(Object.keys(SETTINGS)).forEach(k => { out[k] = p[k] !== false; });
  return out;
}

/* notify(userIds, kind, title, body, link): respects each person's prefs.
   `link` is an in-app route like "#/play/events/3", used as a deep link. */
function createNotifier(db, push, mailer, publicUrl = '') {
  const ins = db.prepare('INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?, ?, ?, ?, ?)');
  const esc = v => String(v || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  function notify(userIds, kind, title, body = '', link = '') {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return 0;
    let n = 0;
    ids.forEach(uid => {
      const u = db.prepare('SELECT email, prefs FROM users WHERE id = ?').get(uid);
      if (!u || prefsOf(u)[kind] === false) return;
      const notificationId = Number(ins.run(uid, kind, title, body, link).lastInsertRowid); n++;
      if (push) push.toUser(uid, { title, body, link });
      if (mailer && mailer.enabled && prefsOf(u).email_notifications && kind !== 'content') {
        const url = publicUrl && link ? `${publicUrl}/${link}` : publicUrl;
        mailer.sendSoon({ to: u.email, subject: title, text: `${body}${url ? `\n\nOpen THE LAB: ${url}` : ''}\n\nYou can turn email notifications off in Profile > Notifications and privacy.`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#171b23"><p style="font-size:12px;letter-spacing:.12em;color:#d64336;font-weight:700">THE LAB</p><h1 style="font-size:24px">${esc(title)}</h1><p style="line-height:1.6">${esc(body)}</p>${url ? `<p><a href="${esc(url)}" style="display:inline-block;background:#171b23;color:white;padding:12px 18px;text-decoration:none;border-radius:6px">Open THE LAB</a></p>` : ''}<p style="font-size:12px;color:#667085">Manage email notifications in Profile &gt; Notifications and privacy.</p></div>`,
          idempotencyKey: `lab-notification-${notificationId}` });
      }
    });
    return n;
  }
  /* Users linked to these athlete records. */
  function usersOfAthletes(athleteIds) {
    if (!athleteIds.length) return [];
    return db.prepare(`SELECT user_id FROM athletes WHERE id IN (${athleteIds.map(() => '?').join(',')}) AND user_id IS NOT NULL`).all(...athleteIds).map(r => r.user_id);
  }
  return { notify, usersOfAthletes, emailEnabled: !!(mailer && mailer.enabled) };
}

function routes(r, ctx) {
  const { db, auth } = ctx;
  r.get('/api/notifications', ({ user }) => {
    auth.require(user);
    const items = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(user.id);
    const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(user.id).n;
    return { unread, items };
  });
  r.post('/api/notifications/read', ({ user, body }) => {
    auth.require(user);
    if (body.id) db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?').run(now(), int(body.id, 'id', { min: 1 }), user.id);
    else db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), user.id);
    return withStatus(204, null);
  });
  /* Phone push: the app subscribes with the browser's push service. */
  r.get('/api/push/key', () => {
    if (!ctx.push || !ctx.push.enabled) throw new HttpError(404, 'Phone notifications aren\u2019t set up on this server yet.');
    return { publicKey: ctx.push.publicKey };
  });
  r.post('/api/push/subscribe', ({ user, body }) => {
    auth.require(user);
    if (!ctx.push || !ctx.push.enabled) throw new HttpError(404, 'Phone notifications aren\u2019t set up on this server yet.');
    const endpoint = String(body.endpoint || '');
    let u; try { u = new URL(endpoint); } catch { throw new HttpError(400, 'endpoint must be a URL.'); }
    if (u.protocol !== 'https:') throw new HttpError(400, 'endpoint must be https.');
    const keys = body.keys || {};
    if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100) throw new HttpError(400, 'keys.p256dh and keys.auth are required.');
    db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`).run(user.id, endpoint, keys.p256dh, keys.auth);
    return withStatus(204, null);
  });
  r.post('/api/push/unsubscribe', ({ user, body }) => {
    auth.require(user);
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(user.id, String(body.endpoint || ''));
    return withStatus(204, null);
  });
  r.post('/api/push/test', ({ user }) => {
    auth.require(user);
    if (!ctx.push || !ctx.push.enabled) throw new HttpError(404, 'Phone notifications aren\u2019t set up on this server yet.');
    ctx.push.toUser(user.id, { title: 'THE LAB', body: 'Phone notifications are working.', link: '#/notifications' });
    return withStatus(202, { sent: db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(user.id).n });
  });
  r.get('/api/me/prefs', ({ user }) => {
    auth.require(user);
    return { prefs: prefsOf(db.prepare('SELECT prefs FROM users WHERE id = ?').get(user.id)), labels: { ...PREFS, ...SETTINGS } };
  });
  r.put('/api/me/prefs', ({ user, body }) => {
    auth.require(user);
    const cur = prefsOf(db.prepare('SELECT prefs FROM users WHERE id = ?').get(user.id));
    Object.keys(body || {}).forEach(k => {
      if (!(k in PREFS) && !(k in SETTINGS)) throw new HttpError(400, `Unknown setting ${k}.`);
      if (typeof body[k] !== 'boolean') throw new HttpError(400, `${k} must be true or false.`);
      cur[k] = body[k];
    });
    db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(cur), user.id);
    return { prefs: cur, labels: { ...PREFS, ...SETTINGS } };
  });
}

module.exports = { createNotifier, routes, prefsOf, PREFS };
