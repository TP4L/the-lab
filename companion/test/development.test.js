'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff, uid } = require('./helpers.js');

test('Development Blocks connect a lesson, training, athlete evidence and coach review', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach, coach2, editor } = await staff(s);
  const made = (await coach.post('/api/athletes', { name: 'Avery Read' })).body;
  const aid = made.athlete.id;
  const athlete = s.client(); await athlete.signup('Avery Read', 'avery@lab.test'); await athlete.post('/api/claim', { code: made.claim_code });

  const course = (await editor.post('/api/studio/courses', { title: 'Reading Time' })).body;
  const lesson = (await editor.post(`/api/studio/courses/${course.id}/lessons`, { title: 'Create Time in Transition', body: 'Read before you swing.' })).body;
  const template = (await coach.post('/api/templates', { name: 'Transition decisions', items: [{ name: 'Earn balance first', measure: 'reps', target: '7/10' }] })).body;

  assert.equal((await coach2.post(`/api/athletes/${aid}/development-blocks`, { title: 'No access' })).status, 404);
  const response = await coach.post(`/api/athletes/${aid}/development-blocks`, {
    title: 'Creating Time in Transition', problem: 'Attacking before balance is available', read_targets: ['time', 'balance'],
    start_state: 'neutral', desired_state: 'offensive', error_layer: 'decision', intensity: 'training', lesson_id: lesson.id,
    template_id: template.id, constraint_text: 'Earn balance before attacking', expected_ball: 'Short reply', success_evidence: '7 of 10 correct decisions',
    reflection_prompt: 'What told you it was safe to attack?', due_on: '2026-10-08'
  });
  assert.equal(response.status, 201);
  assert.deepEqual(response.body.read_targets, ['time', 'balance']);
  assert.equal(response.body.lesson_title, 'Create Time in Transition');
  assert.ok(response.body.assignment_id, 'linked training assignment created');

  const mine = (await athlete.get('/api/me/development-blocks')).body;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, 'assigned');
  const sessionId = uid();
  await coach.post('/api/training/sessions', { id: sessionId, title: 'Transition application', athletes: [aid], items: template.items, assignment_id: response.body.assignment_id });
  let linked = (await athlete.get(`/api/development-blocks/${mine[0].id}`)).body;
  assert.deepEqual([linked.session_id, linked.status], [sessionId, 'in_progress']);
  await coach.put(`/api/training/sessions/${sessionId}`, { version: 1, status: 'complete' });
  assert.ok((await athlete.get('/api/notifications')).body.items.some(n => n.title.startsWith('Training complete:')));
  assert.equal((await athlete.put(`/api/development-blocks/${mine[0].id}`, { status: 'ready_retest' })).status, 403);
  const evidence = (await athlete.put(`/api/development-blocks/${mine[0].id}`, { status: 'evidence_submitted', athlete_reflection: 'I waited for balance.', confidence: 4 })).body;
  assert.equal(evidence.status, 'evidence_submitted');
  assert.equal(evidence.confidence, 4);
  const dashboard = (await coach.get('/api/coach/dashboard')).body;
  assert.ok(dashboard.items.some(x => x.kind === 'development' && x.recordId === mine[0].id && x.priority === 'review'), 'submitted evidence reaches the coach queue');

  const reviewed = (await coach.put(`/api/development-blocks/${mine[0].id}`, { status: 'ready_retest', coach_feedback: 'The read is earlier now.', retest_notes: 'Sparring with consequence.' })).body;
  assert.equal(reviewed.status, 'ready_retest');
  assert.ok(reviewed.retest_assignment_id, 'ready to retest creates the next assignment');
  assert.equal(reviewed.coach_feedback, 'The read is earlier now.');
  const retestSession = uid();
  await coach.post('/api/training/sessions', { id: retestSession, title: 'Transition retest', athletes: [aid], items: template.items, assignment_id: reviewed.retest_assignment_id });
  await coach.put(`/api/training/sessions/${retestSession}`, { version: 1, status: 'complete' });
  const afterRetest = (await coach.get(`/api/development-blocks/${mine[0].id}`)).body;
  assert.deepEqual([afterRetest.retest_session_id, afterRetest.status], [retestSession, 'coach_review']);
  assert.ok((await athlete.get('/api/notifications')).body.items.some(n => n.link === `#/development/${mine[0].id}`));
});

test('coaches share complete pathways through the Development Library', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach, coach2 } = await staff(s);
  const saved = await coach.post('/api/development-library', {
    name: 'Transition patience', title: 'Create time before attacking', problem: 'Player attacks before balance is available',
    read_targets: ['time', 'balance'], start_state: 'neutral', desired_state: 'offensive', intensity: 'sparring',
    constraint_text: 'Earn balance first', success_evidence: '7 of 10 correct decisions', reflection_prompt: 'What made the ball attackable?'
  });
  assert.equal(saved.status, 201);
  const shared = (await coach2.get('/api/development-library')).body;
  assert.equal(shared.length, 1);
  assert.deepEqual(shared[0].read_targets, ['time', 'balance']);
  assert.equal((await coach2.del(`/api/development-library/${saved.body.id}`)).status, 403);
  assert.equal((await coach.del(`/api/development-library/${saved.body.id}`)).status, 204);
});
