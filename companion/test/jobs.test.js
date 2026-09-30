'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start, staff } = require('./helpers.js');
const { createMailer } = require('../server/mail.js');

test('event reminders go out once at 24h and 1h; scheduled posts notify when live', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach, editor } = await staff(s);
  const p = s.client(); await p.signup('Rem Inder', 'rem@lab.test'); await p.post('/api/me/athlete', {});
  const startsAt = new Date(Date.now() + 23.5 * 3600e3);
  const e = (await coach.post('/api/events', { title: 'Sat Social', starts_at: startsAt.toISOString(), status: 'published', location: 'Riverside' })).body;
  await p.post(`/api/events/${e.id}/register`);

  const jobs = s.app.jobs;
  jobs.runOnce(new Date());
  jobs.runOnce(new Date());
  let n = (await p.get('/api/notifications')).body.items.filter(x => x.kind === 'reminders');
  assert.equal(n.length, 1);
  assert.match(n[0].title, /tomorrow/);
  jobs.runOnce(new Date(startsAt.getTime() - 30 * 60e3));
  n = (await p.get('/api/notifications')).body.items.filter(x => x.kind === 'reminders');
  assert.equal(n.length, 2);
  assert.match(n[0].title, /in about an hour/);

  // Opt-out respected.
  await p.put('/api/me/prefs', { reminders: false });
  const e2 = (await coach.post('/api/events', { title: 'Sun Social', starts_at: new Date(Date.now() + 23 * 3600e3).toISOString(), status: 'published' })).body;
  await p.post(`/api/events/${e2.id}/register`);
  jobs.runOnce(new Date());
  assert.equal((await p.get('/api/notifications')).body.items.filter(x => x.kind === 'reminders').length, 2);

  // Scheduled post: silent until its time, then one notification.
  const post = (await editor.post('/api/studio/posts', { title: 'Later', lane: 'the_work' })).body;
  const at = new Date(Date.now() + 3600e3);
  await editor.post(`/api/studio/posts/${post.id}/publish`, { publish_at: at.toISOString() });
  jobs.runOnce(new Date());
  assert.equal((await p.get('/api/notifications')).body.items.filter(x => x.kind === 'content').length, 0);
  jobs.runOnce(new Date(at.getTime() + 60e3));
  jobs.runOnce(new Date(at.getTime() + 120e3));
  assert.equal((await p.get('/api/notifications')).body.items.filter(x => x.kind === 'content').length, 1);
});

test('nightly backup: one per day, keeps 7, admin can list and download', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-bk-'));
  const s = await start({ backupDir: dir }); t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); return s.close(); });
  const { owner, coach } = await staff(s);
  for (let d = 0; d < 9; d++) s.app.jobs.runOnce(new Date(Date.UTC(2026, 8, 1 + d, 3)));
  s.app.jobs.runOnce(new Date(Date.UTC(2026, 8, 9, 23)));
  const files = fs.readdirSync(dir).sort();
  assert.equal(files.length, 7);
  assert.equal(files[6], 'lab-2026-09-09.db');
  const list = (await owner.get('/api/admin/backups')).body;
  assert.equal(list[0].date, '2026-09-09');
  const dl = await owner.get('/api/admin/backups/2026-09-09');
  assert.equal(dl.status, 200);
  assert.equal(dl.body.slice(0, 15).toString(), 'SQLite format 3');
  const restored=path.join(dir,'restore-check.db');fs.writeFileSync(restored,dl.body);
  const copy=new (require('node:sqlite').DatabaseSync)(restored);
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(copy.prepare('SELECT COUNT(*) n FROM users').get().n,s.app.db.prepare('SELECT COUNT(*) n FROM users').get().n);copy.close();
  assert.equal((await coach.get('/api/admin/backups')).status, 403);
  assert.equal((await owner.get('/api/admin/backups/..%2f..%2fetc')).status, 404);
});

test('mailer: sends through Resend when configured, logs when not, never throws from sendSoon', async () => {
  const calls = [];
  const m = createMailer({ apiKey: 'k', from: 'THE LAB <a@b.c>', fetchImpl: async (url, o) => { calls.push({ url, o }); return { ok: true }; } });
  await m.send({ to: 'x@y.z', subject: 'Hi', text: 't' });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].o.headers.Authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(calls[0].o.body).to, ['x@y.z']);
  const logs = [];
  const off = createMailer({ log: l => logs.push(l) });
  assert.equal(off.enabled, false);
  assert.deepEqual(await off.send({ to: 'a', subject: 's', text: 't' }), { sent: false });
  const bad = createMailer({ apiKey: 'k', from: 'f', fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'down' }), log: l => logs.push(l) });
  bad.sendSoon({ to: 'a', subject: 's', text: 't' });
  await new Promise(r => setTimeout(r, 10));
  assert.ok(logs.some(l => /mail error/.test(l)));
});

test('password reset uses the mailer when no hook is given', async (t) => {
  const sent = [];
  const mailer = { enabled: true, send: async () => {}, sendSoon: msg => sent.push(msg) };
  const s = await start({ mailer, onResetLink: undefined }); t.after(s.close);
  const c = s.client(); await c.signup('Mae', 'mae@lab.test');
  await s.client().post('/api/auth/reset/request', { email: 'mae@lab.test' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'mae@lab.test');
  assert.match(sent[0].text, /http:\/\/lab\.test\/#\/reset\//);
  assert.equal((await (await staff(s)).owner.get('/api/admin/status')).body.email, true);
});

test('shared coach notes email athletes once and respect email preferences', async (t) => {
  const sent = [], mailer = { enabled: true, send: async () => {}, sendSoon: msg => sent.push(msg) };
  const s = await start({ mailer }); t.after(s.close);
  const { coach } = await staff(s);
  const made = (await coach.post('/api/athletes', { name: 'Email Athlete', claim_email: 'athlete@lab.test' })).body;
  const athlete = s.client(); await athlete.signup('Email Athlete', 'athlete@lab.test'); await athlete.post('/api/claim', { code: made.claim_code });
  await coach.post(`/api/athletes/${made.athlete.id}/notes`, { body: 'Your reset shape was calmer.', visibility: 'private' });
  assert.equal(sent.length, 0, 'private notes never send');
  await coach.post(`/api/athletes/${made.athlete.id}/notes`, { body: 'Your reset shape was calmer.', visibility: 'shared' });
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'athlete@lab.test'); assert.match(sent[0].subject, /New feedback/); assert.match(sent[0].idempotencyKey, /^lab-notification-/);
  await athlete.put('/api/me/prefs', { email_notifications: false });
  await coach.post(`/api/athletes/${made.athlete.id}/notes`, { body: 'Second shared note.', visibility: 'shared' });
  assert.equal(sent.length, 1, 'email opt-out keeps the in-app note but stops email');
});
