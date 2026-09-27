'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff } = require('./helpers.js');

test('sign up, sign in, sign out, bad credentials', async (t) => {
  const s = await start(); t.after(s.close);
  const c = s.client();
  assert.equal((await c.signup('Short', 'short@lab.test', 'short')).status, 400);
  assert.equal((await c.signup('Ann', 'ann@lab.test')).status, 201);
  assert.equal((await s.client().signup('Ann2', 'ANN@lab.test')).status, 409);
  assert.equal((await c.get('/api/me')).body.user.email, 'ann@lab.test');
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/me')).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'ann@lab.test', password: 'wrong password!' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'Ann@lab.test', password: 'correct horse battery' })).status, 200);
});

test('owner email bootstraps admin; admin grants roles', async (t) => {
  const s = await start(); t.after(s.close);
  const owner = s.client();
  const me = (await owner.signup('Owner', 'owner@lab.test')).body.user;
  assert.ok(me.roles.includes('admin'));
  const u = s.client(); const uu = (await u.signup('U', 'u@lab.test')).body.user;
  const set = await owner.put(`/api/admin/users/${uu.id}/roles`, { roles: ['coach'] });
  assert.deepEqual(set.body.roles, ['athlete', 'coach']);
  assert.equal((await owner.put(`/api/admin/users/${me.id}/roles`, { roles: ['coach'] })).status, 400);
  assert.equal((await owner.put(`/api/admin/users/${uu.id}/roles`, { roles: ['god'] })).status, 400);
});

test('password reset by email link, single use', async (t) => {
  const s = await start(); t.after(s.close);
  const c = s.client(); await c.signup('Rae', 'rae@lab.test');
  const other = s.client();
  assert.equal((await other.post('/api/auth/reset/request', { email: 'nobody@lab.test' })).status, 202);
  assert.equal((await other.post('/api/auth/reset/request', { email: 'rae@lab.test' })).status, 202);
  assert.equal(s.resets.length, 1);
  const tok = s.resets[0].link.split('/reset/')[1];
  assert.equal((await other.post('/api/auth/reset/confirm', { token: tok, password: 'brand new password' })).status, 200);
  assert.equal((await c.get('/api/me')).status, 401, 'old sessions are signed out');
  assert.equal((await other.post('/api/auth/reset/confirm', { token: tok, password: 'another new password' })).status, 400);
  assert.equal((await s.client().post('/api/auth/login', { email: 'rae@lab.test', password: 'brand new password' })).status, 200);
});

test('account deletion keeps coach history but removes the athlete’s own data', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const made = (await coach.post('/api/athletes', { name: 'Del Me' })).body;
  const a = s.client(); await a.signup('Del Me', 'del@lab.test');
  await a.post('/api/claim', { code: made.claim_code });
  await a.post(`/api/athletes/${made.athlete.id}/notes`, { body: 'my reflection' });
  assert.equal((await a.post('/api/me/delete', { password: 'nope' })).status, 400);
  assert.equal((await a.post('/api/me/delete', { password: 'correct horse battery' })).status, 204);
  assert.equal((await a.get('/api/me')).status, 401);
  const view = (await coach.get(`/api/athletes/${made.athlete.id}`)).body;
  assert.equal(view.athlete.claimed, false);
  assert.equal(view.notes.filter(n => n.kind === 'reflection').length, 0);
  assert.equal((await s.client().post('/api/auth/login', { email: 'del@lab.test', password: 'correct horse battery' })).status, 401);

  // A self-made profile with no coach is removed entirely.
  const solo = s.client(); await solo.signup('Solo', 'solo@lab.test');
  const mine = (await solo.post('/api/me/athlete', { hand: 'left' })).body.athlete.id;
  await solo.post('/api/me/delete', { password: 'correct horse battery' });
  const owner = s.client(); await owner.post('/api/auth/login', { email: 'owner@lab.test', password: 'correct horse battery' });
  assert.equal((await owner.get(`/api/athletes/${mine}`)).status, 404);
});

test('media: type check, idempotent retry, range requests', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const aid = (await coach.post('/api/athletes', { name: 'Vid' })).body.athlete.id;
  assert.equal((await coach.call('POST', `/api/media?athlete_id=${aid}`, Buffer.from('x'), { 'Content-Type': 'text/html' })).status, 415);
  const id = require('node:crypto').randomUUID();
  const data = Buffer.alloc(1000, 7);
  const first = await coach.call('POST', `/api/media?athlete_id=${aid}`, data, { 'Content-Type': 'video/mp4', 'X-Upload-Id': id });
  const retry = await coach.call('POST', `/api/media?athlete_id=${aid}`, data, { 'Content-Type': 'video/mp4', 'X-Upload-Id': id });
  assert.deepEqual([first.status, retry.status, retry.body.id], [201, 200, id]);
  const part = await coach.get(`/api/media/${id}`, { Range: 'bytes=100-199' });
  assert.equal(part.status, 206);
  assert.equal(part.body.length, 100);
  assert.equal(part.headers.get('content-range'), 'bytes 100-199/1000');
});

test('validation and plumbing', async (t) => {
  const s = await start(); t.after(s.close);
  const c = s.client();
  assert.equal((await c.call('POST', '/api/auth/login', '{bad', { 'Content-Type': 'application/json' })).status, 400);
  assert.equal((await c.call('POST', '/api/auth/login', 'email=x', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await c.get('/api/nope')).status, 404);
  assert.equal((await c.call('PATCH', '/api/me')).status, 405);
  const html = await fetch(s.base + '/');
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-security-policy'), /default-src 'self'/);
  const trav = await fetch(s.base + '/..%2f..%2fserver%2fdb.js');
  assert.notEqual(trav.status, 200);
});
