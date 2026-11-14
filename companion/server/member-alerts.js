'use strict';
const { tx, now } = require('./db.js');
const { HttpError, int } = require('./http.js');

// The database trigger records account creation in the same transaction as the
// user. Existing-account logins never enqueue an alert. No historical backfill.
function createMemberAlerts({ db, auth, config, mailer, push, notifier }) {
  const ownerEmail = config.adminEmail.trim().toLowerCase();
  let running = null;
  const linkFor = id => `#/admin/members/${id}`;
  const owner = () => {
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(ownerEmail);
    return u && auth.has(auth.userRow(u), 'admin') ? u : null;
  };
  function status() {
    const u = owner();
    return {
      recipient: ownerEmail, email_enabled: !!(ownerEmail && mailer.enabled && config.publicUrl && !config.demo),
      phone_enabled: !!(push.enabled && u && db.prepare('SELECT 1 FROM push_subscriptions WHERE user_id=?').get(u.id)),
      pending: db.prepare("SELECT count(*) n FROM member_signups WHERE email_state='pending' AND user_id IN (SELECT id FROM users WHERE email<>?)").get(ownerEmail).n,
      failed: db.prepare("SELECT count(*) n FROM member_signups WHERE email_state='failed'").get().n
    };
  }
  async function deliver(at) {
    if (!ownerEmail || config.demo) return;
    const ownerUser = owner();
    const rows = db.prepare(`SELECT s.*,u.name,u.email,u.created_at FROM member_signups s JOIN users u ON u.id=s.user_id
      WHERE u.email<>? AND ((?=1 AND s.notified_at IS NULL) OR (s.email_state='pending' AND s.next_attempt_at<=?))
      ORDER BY u.created_at LIMIT 100`).all(ownerEmail, ownerUser ? 1 : 0, at);
    for (const row of rows) {
      const title = `New member: ${row.name}`;
      const body = `${row.name} signed up for THE LAB.\nEmail: ${row.email}\nJoined: ${row.created_at}\n\nOpen their member record to welcome them, review their profile and set their next step.`;
      const link = linkFor(row.user_id);
      if (ownerUser && !row.notified_at) {
        tx(db, () => {
          db.prepare("INSERT INTO notifications(user_id,kind,title,body,link) VALUES (?,'new_member',?,?,?)")
            .run(ownerUser.id, title, body, link);
          db.prepare('UPDATE member_signups SET notified_at=? WHERE event_key=?').run(at, row.event_key);
        });
        // Avoid putting member contact information on a locked phone screen.
        try { push.toUser(ownerUser.id, { title: 'New THE LAB member', body: 'A new member is ready for your welcome. Open their record.', link }); }
        catch { console.error('[member alerts] phone delivery unavailable'); }
      }
      if (row.email_state !== 'pending' || row.next_attempt_at > at || !mailer.enabled || !config.publicUrl) continue;
      // Freeze the payload so a retry uses exactly the same idempotency key AND
      // contents, even if the member edits their name before delivery succeeds.
      let msg = row.email_payload && JSON.parse(row.email_payload);
      if (!msg) {
        const url = `${config.publicUrl}/${link}`;
        msg = { to: ownerEmail, subject: title, text: `${body}\n\nOpen member: ${url}`, html: notifier.emailHtml(title, body, url, 'New-member alert for the owner of THE LAB.'), idempotencyKey: `lab-new-member-${row.event_key}` };
      }
      const attempt = row.attempts + 1;
      const first = row.first_attempt_at || at;
      // Stop ambiguous retries before the provider's 24-hour deduplication window.
      if (row.first_attempt_at && Date.parse(at) - Date.parse(first) >= 23 * 3600000) {
        db.prepare("UPDATE member_signups SET email_state='failed',last_error='Delivery needs review after the retry window' WHERE event_key=?").run(row.event_key);
        continue;
      }
      const next = new Date(Date.parse(at) + Math.min(3600000, 30000 * 2 ** Math.min(attempt - 1, 7))).toISOString();
      db.prepare('UPDATE member_signups SET email_payload=?,attempts=?,first_attempt_at=?,next_attempt_at=? WHERE event_key=?')
        .run(JSON.stringify(msg), attempt, first, next, row.event_key);
      try {
        const result = await mailer.send(msg);
        if (!result || result.sent !== true) throw new Error('Email was not accepted');
        db.prepare("UPDATE member_signups SET email_state='sent',email_sent_at=?,last_error='' WHERE event_key=?").run(now(), row.event_key);
      } catch (error) {
        const permanent = error.status >= 400 && error.status < 500 && error.status !== 429;
        db.prepare('UPDATE member_signups SET email_state=?,last_error=? WHERE event_key=?')
          .run(permanent || attempt >= 10 ? 'failed' : 'pending', error.status ? `Email provider returned ${error.status}` : 'Email delivery could not be confirmed', row.event_key);
      }
    }
  }
  function flush(at = now()) {
    if (running) return running;
    running = deliver(at).catch(() => console.error('[member alerts] queue processing failed')).finally(() => { running = null; });
    return running;
  }
  return { flush, status };
}

function routes(r, ctx) {
  const { db, auth, memberAlerts } = ctx;
  function member(user, rawId) {
    auth.require(user, 'admin');
    const id = int(rawId, 'member id', { min: 1, required: true });
    const u = db.prepare('SELECT id,name,email,created_at FROM users WHERE id=?').get(id);
    if (!u) throw new HttpError(404, 'Member not found.');
    return u;
  }
  r.get('/api/admin/members', ({ user }) => {
    auth.require(user, 'admin');
    const items = db.prepare(`SELECT u.id,u.name,u.email,u.created_at,a.id athlete_id,s.reviewed_at,s.email_state
      FROM users u LEFT JOIN athletes a ON a.user_id=u.id LEFT JOIN member_signups s ON s.user_id=u.id
      WHERE u.email<>? ORDER BY u.created_at DESC,u.id DESC LIMIT 100`).all(ctx.config.adminEmail);
    const unreviewed = db.prepare('SELECT count(*) n FROM member_signups s JOIN users u ON u.id=s.user_id WHERE s.reviewed_at IS NULL AND u.email<>?').get(ctx.config.adminEmail).n;
    return { items, unreviewed, alerts: memberAlerts.status() };
  });
  r.get('/api/admin/members/:id', ({ user, params }) => {
    const u = member(user, params.id);
    const athlete = db.prepare('SELECT id,name,focus,goals FROM athletes WHERE user_id=?').get(u.id) || null;
    const candidates = athlete ? [] : db.prepare('SELECT id,name FROM athletes WHERE user_id IS NULL AND claim_email=?').all(u.email);
    const signup = db.prepare('SELECT reviewed_at,email_state,email_sent_at,last_error FROM member_signups WHERE user_id=?').get(u.id) || null;
    return { member: u, athlete, candidates, signup };
  });
  r.post('/api/admin/members/:id/reviewed', ({ user, params }) => {
    const u = member(user, params.id);
    db.prepare('UPDATE member_signups SET reviewed_at=COALESCE(reviewed_at,?) WHERE user_id=?').run(now(), u.id);
    return { ok: true };
  });
  r.post('/api/admin/members/:id/profile', ({ user, params }) => {
    const u = member(user, params.id);
    return tx(db, () => {
      const existing = db.prepare('SELECT id FROM athletes WHERE user_id=?').get(u.id);
      if (existing) return { athlete_id: existing.id };
      if (db.prepare('SELECT 1 FROM athletes WHERE user_id IS NULL AND claim_email=?').get(u.email)) {
        throw new HttpError(409, 'An earlier profile matches this email. Open that record and use its claim code to preserve the history.');
      }
      const id = Number(db.prepare('INSERT INTO athletes(user_id,name,created_by) VALUES (?,?,?)').run(u.id,u.name,user.id).lastInsertRowid);
      db.prepare('INSERT INTO coach_athletes(coach_id,athlete_id) VALUES (?,?)').run(user.id,id);
      return { athlete_id: id };
    });
  });
}
module.exports = { createMemberAlerts, routes };
