'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { start, staff } = require('./helpers');

test('skill attributes, ratings history, deltas and goals respect coach/athlete permissions', async t => {
  const s = await start(); t.after(s.close); const { coach, coach2 } = await staff(s);
  const made = (await coach.post('/api/athletes', { name: 'Rated athlete', rating: '3.5' })).body;
  const aid = made.athlete.id, p = s.client(); await p.signup('Rated athlete', 'rated@lab.test');
  assert.equal((await p.post('/api/claim', { code: made.claim_code })).status, 200);

  // Seeded attributes exist; coach can add, rename and retire; athletes cannot.
  let attrs = (await p.get('/api/skill-attributes')).body;
  assert.ok(attrs.attributes.length >= 10); assert.equal(attrs.scale.length, 5);
  assert.equal((await p.post('/api/skill-attributes', { name: 'Hacks' })).status, 403);
  const custom = (await coach.post('/api/skill-attributes', { name: 'Erne timing', category: 'Kitchen line', reads: ['time', 'balance'], level_min: 7, level_max: 13 })).body;
  assert.ok(custom.id); assert.deepEqual(custom.reads, ['time', 'balance']); assert.equal(custom.level_min, 7);
  assert.equal((await coach.post('/api/skill-attributes', { name: 'Bad', reads: ['luck'] })).status, 400);
  assert.ok(attrs.attributes.find(a => a.name === 'Dinking').reads.includes('height'), 'seeded attributes carry LAB reads');
  assert.equal((await coach.post('/api/skill-attributes', { name: 'erne timing' })).status, 409);
  assert.equal((await coach.put('/api/skill-attributes/' + custom.id, { name: 'Erne & ATP timing' })).body.name, 'Erne & ATP timing');

  // Ratings are append-only history with deltas.
  const dink = attrs.attributes.find(a => a.name === 'Dinking').id, drop = attrs.attributes.find(a => a.name === 'Third-shot drops').id;
  const path = '/api/athletes/' + aid + '/skill-ratings';
  assert.equal((await p.post(path, { ratings: [{ attribute_id: dink, rating: 5 }] })).status, 403);
  assert.equal((await coach2.post(path, { ratings: [{ attribute_id: dink, rating: 5 }] })).status, 404);
  assert.equal((await coach.post(path, { ratings: [{ attribute_id: dink, rating: 9 }] })).status, 400);
  assert.equal((await coach.post(path, { rated_on: '2026-08-20', ratings: [{ attribute_id: dink, rating: 3 }, { attribute_id: drop, rating: 1 }] })).status, 200);
  assert.equal((await coach.post(path, { rated_on: '2026-09-17', ratings: [{ attribute_id: drop, rating: 2, comment: 'Wrist lifting' }] })).status, 200);
  const r3 = await coach.post(path, { rated_on: '2026-11-03', client_id: 'once', ratings: [{ attribute_id: drop, rating: 3, comment: 'Landing 6 of 10' }, { attribute_id: dink, rating: 4 }] });
  assert.equal(r3.status, 200); assert.equal(r3.body.improved, 2);
  const again = await coach.post(path, { rated_on: '2026-11-03', client_id: 'once', ratings: [{ attribute_id: drop, rating: 3 }] });
  assert.equal(again.body.duplicate, true);

  let mine = (await p.get('/api/me/skills')).body;
  assert.equal(mine.viewer, 'athlete'); assert.equal(mine.summary.assessed, 2); assert.equal(mine.summary.improved_last, 2);
  const dropSkill = mine.skills.find(x => x.id === drop);
  assert.equal(dropSkill.latest.rating, 3); assert.equal(dropSkill.previous.rating, 2); assert.equal(dropSkill.delta, 1); assert.equal(dropSkill.history.length, 3);
  assert.equal(dropSkill.history[0].comment, 'Landing 6 of 10'); assert.equal(dropSkill.latest.label, 'Consistent');
  assert.equal((await coach2.get('/api/athletes/' + aid + '/skills')).status, 404);
  assert.equal((await coach.get('/api/athletes/' + aid + '/skills')).body.viewer, 'coach');

  // Retired attributes with history still show; without history they drop out.
  assert.equal((await coach.put('/api/skill-attributes/' + custom.id, { archived: true })).body.archived_at !== null, true);
  mine = (await p.get('/api/me/skills')).body;
  assert.ok(!mine.skills.some(x => x.id === custom.id));
  assert.equal((await coach.put('/api/skill-attributes/' + dink, { archived: true })).status, 200);
  mine = (await p.get('/api/me/skills')).body;
  assert.equal(mine.skills.find(x => x.id === dink).archived, true);
  await coach.put('/api/skill-attributes/' + dink, { archived: false });

  // Goals: coach creates and completes; athlete can only start them.
  const gpath = '/api/athletes/' + aid + '/skill-goals';
  assert.equal((await p.post(gpath, { title: 'Nope' })).status, 403);
  const g = (await coach.post(gpath, { title: 'Win a dink rally against a 4.0', attribute_id: dink })).body;
  assert.equal(g.status, 'not_started');
  assert.equal((await p.put('/api/skill-goals/' + g.id, { status: 'in_progress' })).status, 200);
  assert.equal((await p.put('/api/skill-goals/' + g.id, { status: 'completed' })).status, 400);
  assert.equal((await coach2.put('/api/skill-goals/' + g.id, { status: 'completed' })).status, 404);
  const done = (await coach.put('/api/skill-goals/' + g.id, { status: 'completed' })).body;
  assert.ok(done.completed_at);
  mine = (await p.get('/api/me/skills')).body;
  assert.equal(mine.summary.goals_completed, 1); assert.equal(mine.goals[0].attribute_name, 'Dinking');
  assert.deepEqual(mine.goals[0].reads, ['height'], 'goal inherits the attribute reads');
  assert.equal(mine.reads.height.count >= 1, true); assert.ok(mine.reads.height.avg);

  // Athlete was notified.
  const notes = (await p.get('/api/notifications')).body;
  assert.ok(notes.items.some(n => /rated 2 skills/.test(n.title)));
  assert.ok(notes.items.some(n => /Goal completed/.test(n.title)));
});
