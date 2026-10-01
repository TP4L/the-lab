'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { LANES } = require('./api/publishing.js');

/* Background jobs, run every minute in the server process:
   - event reminders 24 hours and 1 hour before start
   - notifications when a scheduled post goes live
   - a nightly database backup (VACUUM INTO), keeping the last 7
   - cleanup of expired sign-in sessions and reset links
   Each notice is recorded in job_log so it is sent once, even across restarts. */
function createJobs(ctx) {
  const { db, notifier, config, mailer } = ctx;
  const once = db.prepare('INSERT OR IGNORE INTO job_log (key) VALUES (?)');
  const first = key => Number(once.run(key).changes) === 1;

  function eventReminders(now) {
    const soon = db.prepare(`SELECT * FROM events WHERE status IN ('published','live') AND starts_at > ? AND starts_at <= ?`)
      .all(now.toISOString(), new Date(now.getTime() + 24 * 3600e3).toISOString());
    let sent = 0;
    soon.forEach(e => {
      const mins = (new Date(e.starts_at) - now) / 60000;
      const which = mins <= 60 ? '1h' : mins >= 22 * 60 ? '24h' : null;
      if (!which || !first(`remind:${e.id}:${which}`)) return;
      const ids = db.prepare("SELECT athlete_id FROM event_people WHERE event_id = ? AND state IN ('registered','waitlist')").all(e.id).map(r => r.athlete_id);
      const when = which === '1h' ? 'in about an hour' : 'tomorrow';
      sent += notifier.notify(notifier.usersOfAthletes(ids), 'reminders', `${e.title} starts ${when}`, e.location ? `At ${e.location}.` : '', `#/play/events/${e.id}`);
      if (ctx.play) ctx.play.pushGuests(e, ids, `${e.title} starts ${when}`, e.location ? `At ${e.location}.` : '');
    });
    return sent;
  }

  function scheduledPosts(now) {
    const due = db.prepare(`SELECT id, lane, title, summary, slug, author_id FROM posts WHERE status = 'scheduled' AND publish_at <= ?`).all(now.toISOString());
    let sent = 0;
    due.forEach(p => {
      if (!first(`post:${p.id}`)) return;
      const users = db.prepare('SELECT id FROM users').all().map(u => u.id).filter(id => id !== p.author_id);
      sent += notifier.notify(users, 'content', `New in ${LANES[p.lane]}: ${p.title}`, p.summary || '', `#/learn/${p.slug}`);
    });
    return sent;
  }

  function backup(now) {
    if (!config.backupDir) return null;
    const day = now.toISOString().slice(0, 10);
    const file = path.join(config.backupDir, `lab-${day}.db`);
    if (fs.existsSync(file)) return null;
    fs.mkdirSync(config.backupDir, { recursive: true });
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const all = fs.readdirSync(config.backupDir).filter(f => /^lab-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    all.slice(0, Math.max(0, all.length - 7)).forEach(f => fs.rmSync(path.join(config.backupDir, f), { force: true }));
    return file;
  }

  function cleanup(now) {
    const t = now.toISOString();
    db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(t);
    db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(t);
  }

  function dailyDigests(now) {
    if (!mailer || !mailer.enabled) return 0;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const val = type => parts.find(x => x.type === type).value;
    const day = `${val('year')}-${val('month')}-${val('day')}`;
    if (Number(val('hour')) < 17) return 0;
    const users = db.prepare("SELECT DISTINCT user_id FROM notifications WHERE email_state = 'pending'").all();
    let sent = 0;
    users.forEach(({ user_id }) => {
      if (!first(`digest:${user_id}:${day}`)) return;
      const u = db.prepare('SELECT email FROM users WHERE id = ?').get(user_id);
      const items = db.prepare("SELECT id, title, body FROM notifications WHERE user_id = ? AND email_state = 'pending' ORDER BY id DESC LIMIT 25").all(user_id);
      if (!u || !items.length) return;
      const url = config.publicUrl ? `${config.publicUrl}/#/notifications` : '';
      const list = items.map(x => `- ${x.title}${x.body ? `: ${x.body}` : ''}`).join('\n');
      const summary = `${items.length} update${items.length === 1 ? '' : 's'} are waiting in THE LAB.\n\n${list}`;
      mailer.sendSoon({ to: u.email, subject: `THE LAB daily update · ${items.length} new`, text: `${summary}${url ? `\n\nOpen THE LAB: ${url}` : ''}\n\nManage email delivery in Profile > Notifications and privacy.`, html: notifier.emailHtml('Your daily LAB update', summary, url, 'Manage email delivery in Profile > Notifications and privacy.'), idempotencyKey: `lab-digest-${user_id}-${day}` });
      db.prepare(`UPDATE notifications SET email_state = 'sent' WHERE id IN (${items.map(() => '?').join(',')})`).run(...items.map(x => x.id));
      sent++;
    });
    return sent;
  }

  function runOnce(now = new Date()) {
    const out = { reminders: 0, posts: 0, digests: 0, backup: null };
    try { out.reminders = eventReminders(now); } catch (e) { console.error('[jobs] reminders', e); }
    try { out.posts = scheduledPosts(now); } catch (e) { console.error('[jobs] posts', e); }
    try { out.digests = dailyDigests(now); } catch (e) { console.error('[jobs] digests', e); }
    try { out.backup = backup(now); } catch (e) { console.error('[jobs] backup', e); }
    try { cleanup(now); } catch (e) { console.error('[jobs] cleanup', e); }
    return out;
  }
  let timer = null;
  return {
    runOnce,
    start(ms = 60000) { if (!timer) { timer = setInterval(() => runOnce(), ms); timer.unref(); } },
    stop() { clearInterval(timer); timer = null; }
  };
}
module.exports = { createJobs };
