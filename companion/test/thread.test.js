'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { start, staff, uid } = require('./helpers');

test('thread merges notes, replies, check-ins, assessments and goals with per-side visibility', async t => {
  const s = await start(); t.after(s.close); const { coach, coach2 } = await staff(s);
  const made = (await coach.post('/api/athletes', { name: 'Thread athlete' })).body;
  const aid = made.athlete.id, p = s.client(); await p.signup('Thread athlete', 'thread@lab.test'); await p.post('/api/claim', { code: made.claim_code });
  await coach.post('/api/athletes/' + aid + '/notes', { body: 'Shared note', visibility: 'shared', client_id: uid(), tags: { reads: ['height'], error: 'read', call: 'triangle' } });
  assert.equal((await coach.post('/api/athletes/' + aid + '/notes', { body: 'x', visibility: 'shared', client_id: uid(), tags: { state: 'panic' } })).status, 400);
  await coach.post('/api/athletes/' + aid + '/notes', { body: 'Private note', visibility: 'private', client_id: uid() });
  const q = (await p.post('/api/athletes/' + aid + '/notes', { body: 'Question\nDrive or drop?', client_id: uid() })).body;
  await p.post('/api/me/pre-session-checkins', { working: 'Dinks', not_working: 'Drives', focus: 'Resets' });
  const attrs = (await coach.get('/api/skill-attributes')).body.attributes;
  await coach.post('/api/athletes/' + aid + '/skill-ratings', { ratings: [{ attribute_id: attrs[0].id, rating: 3, comment: 'Solid' }, { attribute_id: attrs[1].id, rating: 2 }] });
  await coach.post('/api/athletes/' + aid + '/skill-goals', { title: 'Hold the line' });

  const mine = (await p.get('/api/me/thread')).body;
  const types = mine.items.map(i => i.type);
  assert.ok(types.includes('note') && types.includes('question') && types.includes('checkin') && types.includes('rating') && types.includes('goal'));
  assert.ok(!mine.items.some(i => i.private), 'athlete never sees private notes');
  assert.equal(mine.items.find(i => i.type === 'rating').title, 'Skill assessment · 2 skills');
  assert.equal(mine.items.find(i => i.type === 'question').body, 'Drive or drop?');
  const tagged = mine.items.find(i => i.body === 'Shared note'); assert.deepEqual(tagged.tags, { reads: ['height'], error: 'read', call: 'triangle' });

  const theirs = (await coach.get('/api/athletes/' + aid + '/thread')).body;
  assert.ok(theirs.items.some(i => i.private && i.body === 'Private note'));
  assert.equal(theirs.unreviewed, 1);
  assert.equal((await coach2.get('/api/athletes/' + aid + '/thread')).status, 404);
  assert.equal((await p.post('/api/athletes/' + aid + '/thread/seen', {})).status, 403);
  await coach.post('/api/notes/' + q.id + '/reply', { body: 'Drop.', client_id: uid() });
  const after = (await coach.get('/api/athletes/' + aid + '/thread')).body;
  assert.equal(after.unreviewed, 0);
  assert.ok(after.items.some(i => i.type === 'reply' && i.body === 'Drop.' && i.reply_to === q.id));
  await p.post('/api/athletes/' + aid + '/notes', { body: 'Another thought', client_id: uid() });
  assert.equal((await coach.post('/api/athletes/' + aid + '/thread/seen', {})).body.marked, 1);
});
