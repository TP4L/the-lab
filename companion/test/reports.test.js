'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { start, staff, uid } = require('./helpers');

test('progress report builds a period, publishes a frozen public snapshot and can be revoked', async t => {
  const s = await start(); t.after(s.close); const { coach, coach2 } = await staff(s);
  const made = (await coach.post('/api/athletes', { name: 'Report athlete' })).body;
  const aid = made.athlete.id, p = s.client(); await p.signup('Report athlete', 'report@lab.test'); await p.post('/api/claim', { code: made.claim_code });
  const attrs = (await coach.get('/api/skill-attributes')).body.attributes, dink = attrs.find(a => a.name === 'Dinking').id;
  await coach.post('/api/athletes/' + aid + '/skill-ratings', { rated_on: '2026-09-01', ratings: [{ attribute_id: dink, rating: 2 }] });
  await coach.post('/api/athletes/' + aid + '/skill-ratings', { rated_on: '2026-10-20', ratings: [{ attribute_id: dink, rating: 3, comment: 'Patience showing' }] });
  const g = (await coach.post('/api/athletes/' + aid + '/skill-goals', { title: 'Own the cross-court dink' })).body;
  await coach.put('/api/skill-goals/' + g.id, { status: 'completed' });
  await coach.post('/api/athletes/' + aid + '/notes', { body: 'Great month.', visibility: 'shared', client_id: uid() });
  await coach.post('/api/athletes/' + aid + '/notes', { body: 'Private thought', visibility: 'private', client_id: uid() });

  const rep = (await coach.get('/api/athletes/' + aid + '/report?from=2026-10-01&to=2026-10-31')).body;
  assert.equal(rep.period.from, '2026-10-01');
  const sk = rep.skills.find(x => x.id === dink);
  assert.equal(sk.start, 2); assert.equal(sk.end, 3); assert.equal(sk.delta, 1); assert.equal(sk.comments[0].text, 'Patience showing');
  assert.equal(rep.summary.improved, 1); assert.ok(rep.highlights.some(x => /Dinking/.test(x)));
  assert.ok(!rep.coach_notes.some(n => n.body === 'Private thought'), 'private notes never reach a report');
  assert.equal((await coach2.get('/api/athletes/' + aid + '/report')).status, 404);
  assert.equal((await p.get('/api/me/report?from=2026-10-01&to=2026-10-31')).body.skills.length, 1);
  assert.equal((await coach.get('/api/athletes/' + aid + '/report?from=2026-11-01&to=2026-10-01')).status, 400);

  assert.equal((await p.post('/api/athletes/' + aid + '/reports', { from: '2026-10-01', to: '2026-10-31' })).status, 403);
  const pub = (await coach.post('/api/athletes/' + aid + '/reports', { from: '2026-10-01', to: '2026-10-31', summary: 'A strong month.' })).body;
  assert.ok(pub.token); assert.match(pub.url, /#\/report\//);
  // Public, no auth
  const anon = s.client();
  const snap = (await anon.get('/api/reports/' + pub.token)).body;
  assert.equal(snap.summary_text, 'A strong month.'); assert.equal(snap.summary.improved, 1); assert.equal(snap.athlete.name, 'Report athlete'); assert.equal(snap.skills[0].end, 3);
  // Later ratings do not change the published snapshot
  await coach.post('/api/athletes/' + aid + '/skill-ratings', { rated_on: '2026-10-25', ratings: [{ attribute_id: dink, rating: 5 }] });
  assert.equal((await anon.get('/api/reports/' + pub.token)).body.skills[0].end, 3);
  assert.equal((await p.get('/api/me/reports')).body.reports.length, 1);
  assert.equal((await p.put('/api/reports/' + pub.token, { revoked: true })).status, 403);
  assert.equal((await coach.put('/api/reports/' + pub.token, { revoked: true })).body.revoked, true);
  assert.equal((await anon.get('/api/reports/' + pub.token)).status, 404);
  assert.equal((await p.get('/api/me/reports')).body.reports.length, 0);
  const notes = (await p.get('/api/notifications')).body;
  assert.ok(notes.items.some(n => /progress report is ready/.test(n.title)));
});
