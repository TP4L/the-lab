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

test('group closeout keeps individual cues private and retries one athlete safely', async t => {
  const s = await start(); t.after(s.close);
  const {coach, coach2} = await staff(s);
  async function make(name) {
    const made = (await coach.post('/api/athletes',{name})).body;
    const member = s.client();
    await member.signup(name,name+'@lab.test');
    await member.post('/api/claim',{code:made.claim_code});
    return {id:made.athlete.id,member};
  }
  const a=await make('First'), b=await make('Second');
  for(const id of [a.id,b.id]) {
    const response=await coach.put('/api/athletes/'+id,{training_needs:['Reset','reset','Bounce read']});
    assert.deepEqual(response.body.athlete.training_needs,['reset','bounce read']);
  }
  assert.equal((await a.member.get('/api/athletes/'+a.id)).body.athlete.training_needs,undefined);
  assert.equal((await a.member.put('/api/athletes/'+a.id,{training_needs:['test']})).status,403);
  const sid=uid(), session='/api/training/sessions/'+sid;
  await coach.post('/api/training/sessions',{id:sid,title:'Transition',athletes:[a.id,b.id],items:[{name:'Reset',measure:'reps'}]});
  const practice={source_session_id:sid,title:'Pitch and catch',constraint_text:'Wait for the bounce',success_evidence:'7 of 10',review_required:false};
  const path='/api/athletes/'+a.id+'/development-blocks';
  assert.equal((await coach.post(path,practice)).status,409);
  await coach.put(session,{version:1,status:'complete'});
  assert.equal((await coach2.post(path,practice)).status,404);
  const first=await coach.post(path,practice);
  assert.equal(first.status,201);
  assert.equal((await coach.post(path,practice)).body.id,first.body.id);
  const peer=await coach.post('/api/athletes/'+b.id+'/development-blocks',{...practice,constraint_text:'Hold the line'});
  assert.notEqual(peer.body.id,first.body.id);
  assert.equal((await b.member.get('/api/development-blocks/'+first.body.id)).status,404);
  const coachSession=(await coach.get(session)).body;
  assert.equal(coachSession.athletes[0].closeout_block_id,first.body.id);
  assert.deepEqual(coachSession.athletes[0].training_needs,['reset','bounce read']);
  const playerSession=(await a.member.get(session)).body;
  assert.equal(playerSession.athletes.length,1);
  assert.equal(playerSession.athletes[0].training_needs,undefined);
  const url='/api/development-blocks/'+first.body.id;
  const result={status:'evidence_submitted',attempt_id:uid(),conditions:'10 feeds from transition',athlete_reflection:'7/10'};
  assert.equal((await a.member.put(url,result)).body.status,'mastered');
  assert.equal((await a.member.put(url,result)).body.status,'mastered');
  assert.equal((await a.member.put(url,{...result,attempt_id:uid()})).status,409);
  await coach.put(url,{status:'ready_retest',retest_notes:'Repeat same feed'});
  await a.member.put(url,{...result,attempt_id:uid(),athlete_reflection:'8/10'});
  const history=(await a.member.get(url)).body.attempts;
  assert.deepEqual(history.map(a=>a.result),['7/10','8/10']);
  assert.equal(history[1].cue,'Repeat same feed');
  assert.equal(history[1].conditions,result.conditions);
});
