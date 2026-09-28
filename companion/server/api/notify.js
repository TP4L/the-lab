'use strict';
const { HttpError, withStatus, int } = require('../http.js');
const { now } = require('../db.js');

/* Notification kinds a person can switch off. All on by default. */
const PREFS = {
  courts: 'Court assignments and rotations',
  up_next: 'You’re up next',
  feedback: 'Shared feedback from your coach',
  matches: 'Match confirmations and corrections',
  events: 'Event registration and check-in',
  reminders: 'Reminders before events',
  content: 'New Field Notes'
};
const SETTINGS = { leaderboard: 'Show me on leaderboards' };

function prefsOf(row) {
  let p = {};
  try { p = JSON.parse(row.prefs || '{}'); } catch {}
  const out = {};
  Object.keys(PREFS).concat(Object.keys(SETTINGS)).forEach(k => { out[k] = p[k] !== false; });
  return out;
}

/* notify(userIds, kind, title, body, link): respects each person's prefs.
   `link` is an in-app route like "#/play/events/3", used as a deep link. */
function createNotifier(db) {
  const ins = db.prepare('INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?, ?, ?, ?, ?)');
  function notify(userIds, kind, title, body = '', link = '') {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return 0;
    let n = 0;
    ids.forEach(uid => {
      const u = db.prepare('SELECT prefs FROM users WHERE id = ?').get(uid);
      if (!u || prefsOf(u)[kind] === false) return;
      ins.run(uid, kind, title, body, link); n++;
    });
    return n;
  }
  /* Users linked to these athlete records. */
  function usersOfAthletes(athleteIds) {
    if (!athleteIds.length) return [];
    return db.prepare(`SELECT user_id FROM athletes WHERE id IN (${athleteIds.map(() => '?').join(',')}) AND user_id IS NOT NULL`).all(...athleteIds).map(r => r.user_id);
  }
  return { notify, usersOfAthletes };
}

function routes(r, { db, auth }) {
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
