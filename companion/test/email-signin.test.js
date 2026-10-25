'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
const { sha256 } = require('../server/auth');

test('email links reuse accounts and preserve roles, profile, password; one use only', async t => {
  const links = [];
  const s = await start({ onSignInLink: (email, link) => links.push({ email, token: link.split('/email-signin/')[1] }) }); t.after(s.close);
  const old = s.client(); const before = (await old.signup('Owner', 'owner@lab.test')).body;
  const c = s.client();
  assert.equal((await c.post('/api/auth/email/request', { email: 'OWNER@lab.test' })).status, 202);
  const tok = links[0].token;
  assert.equal((await c.get('/api/auth/email/confirm?token=' + tok)).status, 405);
  assert.equal((await c.get('/api/me')).status, 401);
  const result = await c.post('/api/auth/email/confirm', { token: tok });
  assert.equal(result.status, 200);
  assert.equal(result.body.user.id, before.user.id);
  assert.deepEqual(result.body.user.roles, before.user.roles);
  assert.equal(result.body.has_password, true);
  assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.equal((await c.get('/api/me')).body.user.id, before.user.id);
  assert.equal((await s.client().post('/api/auth/email/confirm', { token: tok })).status, 400);
  assert.equal(s.app.db.prepare('SELECT count(*) n FROM users').get().n, 1);
});

test('new account created only after verification; athlete cannot access admin; expiry and malformed input', async t => {
  let tok;
  const s = await start({ onSignInLink: (email, link) => { tok = link.split('/email-signin/')[1]; } }); t.after(s.close);
  const c = s.client();
  assert.equal((await c.post('/api/auth/email/request', { email: 'bad' })).status, 400);
  assert.equal((await c.post('/api/auth/email/request', { email: 'new@lab.test' })).status, 202);
  assert.equal(s.app.db.prepare('SELECT count(*) n FROM users').get().n, 0);
  assert.equal((await c.post('/api/auth/email/confirm', { token: 'wrong' })).status, 400);
  const result = await c.post('/api/auth/email/confirm', { token: tok });
  assert.deepEqual(result.body.user.roles, ['athlete']);
  assert.equal(result.body.has_password, false);
  assert.equal((await c.get('/api/admin/users')).status, 403);
  await c.post('/api/auth/email/request', { email: 'new@lab.test' });
  s.app.db.prepare('UPDATE email_signins SET expires_at=0').run();
  assert.equal((await c.post('/api/auth/email/confirm', { token: tok })).status, 400);
  for (let i=0;i<3;i++) await c.post('/api/auth/email/request', { email: 'new@lab.test' });
  assert.equal((await c.post('/api/auth/email/request', { email: 'new@lab.test' })).status, 429);
});

test('disabled email and failed sends do not claim success or leave usable tokens', async t => {
  const disabled = await start(); t.after(disabled.close);
  assert.equal((await disabled.client().post('/api/auth/email/request', { email: 'a@lab.test' })).status, 503);
  let tok;
  const s = await start({ onSignInLink: async (_, link) => { tok=link.split('/email-signin/')[1]; throw Error('secret provider error'); } }); t.after(s.close);
  const c=s.client(); const result=await c.post('/api/auth/email/request', { email:'a@lab.test' });
  assert.equal(result.status,503); assert.doesNotMatch(result.body.error,/secret/);
  assert.equal(s.app.db.prepare('SELECT * FROM email_signins WHERE token_hash=?').get(sha256(tok)), undefined);
});
