'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff } = require('./helpers.js');

test('athlete check-in becomes a coach session plan without losing athlete voice', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach, coach2 } = await staff(s);
  const made = (await coach.post('/api/athletes', { name: 'Jordan Lane' })).body;
  const athlete = s.client(); await athlete.signup('Jordan Lane', 'jordan@lab.test'); await athlete.post('/api/claim', { code: made.claim_code });

  const submitted = await athlete.post('/api/me/pre-session-checkins', {
    working: 'My resets are deeper.', not_working: 'I rush the transition.', focus: 'Recognizing the attackable ball.'
  });
  assert.equal(submitted.status, 201);
  assert.equal(submitted.body.status, 'submitted');
  assert.equal((await coach2.get('/api/coach/pre-session-checkins')).body.length, 0, 'unassigned coach cannot see it');
  assert.ok((await coach.get('/api/notifications')).body.items.some(n => n.link === `#/coach/checkins/${submitted.body.id}`));

  const prepared = await coach.put(`/api/coach/pre-session-checkins/${submitted.body.id}`, {
    hypothesis: 'Balance is late.', start_state: 'neutral', error_layer: 'decision', first_test: 'Call attack or reset before bounce',
    constraint_text: 'Attack only after earning balance', proof: '7 of 10 correct decisions', coach_note: 'We will test the read first.'
  });
  assert.equal(prepared.body.hypothesis, 'Balance is late.');
  const planned = await coach.post(`/api/coach/pre-session-checkins/${submitted.body.id}/plan`, {});
  assert.equal(planned.status, 201);
  assert.equal(planned.body.status, 'planned');
  assert.ok(planned.body.assignment_id);

  const mine = (await athlete.get('/api/me/pre-session-checkins')).body[0];
  assert.equal(mine.working, 'My resets are deeper.');
  assert.ok(mine.assignment_title.startsWith('Session focus'));
  assert.ok((await athlete.get('/api/notifications')).body.items.some(n => n.title.startsWith('Your session plan is ready')));
  const assignments = (await athlete.get('/api/me/assignments')).body;
  assert.match(assignments[0].note, /Hypothesis: Balance is late/);
});
