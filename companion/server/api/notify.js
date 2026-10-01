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
const PRIORITY = { up_next: 'urgent', reminders: 'urgent', feedback: 'important', training: 'important', matches: 'important', events: 'important', courts: 'routine', content: 'routine' };
const EMAIL_MODES = ['important', 'digest', 'all', 'off'];

function prefsOf(row) {
  let p = {};
  try { p = JSON.parse(row.prefs || '{}'); } catch {}
  const out = {};
  Object.keys(PREFS).concat(Object.keys(SETTINGS)).forEach(k => { out[k] = p[k] !== false; });
  out.email_mode = EMAIL_MODES.includes(p.email_mode) ? p.email_mode : (p.email_notifications === false ? 'off' : 'important');
  return out;
}

/* notify(userIds, kind, title, body, link): respects each person's prefs.
   `link` is an in-app route like "#/play/events/3", used as a deep link. */
function createNotifier(db, push, mailer, publicUrl = '') {
  const ins = db.prepare('INSERT INTO notifications (user_id, kind, title, body, link, email_state, email_priority) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const esc = v => String(v || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  function emailHtml(title, body, url, footer) {
    return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge"><title>${esc(title)}</title></head><body style="margin:0;background-color:#f2f4f6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#f2f4f6" style="padding-top:24px;padding-right:12px;padding-bottom:24px;padding-left:12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff"><tr><td style="padding-top:28px;padding-right:28px;padding-bottom:28px;padding-left:28px;font-family:Arial,Helvetica,sans-serif"><p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:16px;letter-spacing:2px;color:#d64336;font-weight:700;margin-top:0">THE LAB</p><h1 style="font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:30px;color:#171b23;margin-top:0">${esc(title)}</h1><p style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;color:#171b23;white-space:pre-line">${esc(body)}</p>${url ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#171b23" style="padding-top:12px;padding-right:18px;padding-bottom:12px;padding-left:18px"><a href="${esc(url)}" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;color:#ffffff;text-decoration:none">Open THE LAB</a></td></tr></table>` : ''}<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#667085;margin-bottom:0;margin-top:24px">${esc(footer)}</p></td></tr></table></td></tr></table></body></html>`;
  }
  function notify(userIds, kind, title, body = '', link = '') {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return 0;
    let n = 0;
    ids.forEach(uid => {
      const u = db.prepare('SELECT email, prefs FROM users WHERE id = ?').get(uid);
      if (!u || prefsOf(u)[kind] === false) return;
      const prefs = prefsOf(u), priority = PRIORITY[kind] || 'routine', mode = prefs.email_mode;
      const immediate = mode === 'all' || (mode === 'important' && (priority === 'important' || priority === 'urgent'));
      const pending = mode === 'digest' || (mode === 'important' && priority === 'routine');
      const notificationId = Number(ins.run(uid, kind, title, body, link, immediate ? 'sent' : pending ? 'pending' : 'none', priority).lastInsertRowid); n++;
      if (push) push.toUser(uid, { title, body, link });
      if (mailer && mailer.enabled && immediate) {
        const url = publicUrl && link ? `${publicUrl}/${link}` : publicUrl;
        mailer.sendSoon({ to: u.email, subject: title, text: `${body}${url ? `\n\nOpen THE LAB: ${url}` : ''}\n\nYou can turn email notifications off in Profile > Notifications and privacy.`,
          html: emailHtml(title, body, url, 'Manage email notifications in Profile > Notifications and privacy.'),
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
  return { notify, usersOfAthletes, emailEnabled: !!(mailer && mailer.enabled), emailHtml };
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
    return { prefs: prefsOf(db.prepare('SELECT prefs FROM users WHERE id = ?').get(user.id)), labels: { ...PREFS, leaderboard: SETTINGS.leaderboard }, email_modes: EMAIL_MODES };
  });
  r.put('/api/me/prefs', ({ user, body }) => {
    auth.require(user);
    const cur = prefsOf(db.prepare('SELECT prefs FROM users WHERE id = ?').get(user.id));
    Object.keys(body || {}).forEach(k => {
      if (k === 'email_mode') {
        if (!EMAIL_MODES.includes(body[k])) throw new HttpError(400, 'email_mode must be important, digest, all or off.');
        cur.email_mode = body[k]; cur.email_notifications = body[k] !== 'off'; return;
      }
      if (k === 'email_notifications') {
        if (typeof body[k] !== 'boolean') throw new HttpError(400, `${k} must be true or false.`);
        cur.email_notifications = body[k]; cur.email_mode = body[k] ? 'important' : 'off'; return;
      }
      if (!(k in PREFS) && !(k in SETTINGS)) throw new HttpError(400, `Unknown setting ${k}.`);
      if (typeof body[k] !== 'boolean') throw new HttpError(400, `${k} must be true or false.`);
      cur[k] = body[k];
    });
    db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(cur), user.id);
    return { prefs: cur, labels: { ...PREFS, leaderboard: SETTINGS.leaderboard }, email_modes: EMAIL_MODES };
  });
}

module.exports = { createNotifier, routes, prefsOf, PREFS, PRIORITY, EMAIL_MODES };
