'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff, uid } = require('./helpers.js');

test('templates, assignments, running an assignment, session notes and games', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach, coach2 } = await staff(s);
  const made = (await coach.post('/api/athletes', { name: 'Ash Lee' })).body;
  const aid = made.athlete.id;
  const ath = s.client(); await ath.signup('Ash Lee', 'ash@lab.test'); await ath.post('/api/claim', { code: made.claim_code });
  const other = (await coach.post('/api/athletes', { name: 'Bo Other' })).body.athlete.id;

  // Template library
  assert.equal((await ath.post('/api/templates', { name: 'x', items: [{ name: 'a' }] })).status, 403);
  assert.equal((await coach.post('/api/templates', { name: 'Empty', items: [] })).status, 400);
  const tpl = (await coach.post('/api/templates', { name: 'Kitchen day', items: [{ name: 'Drops', measure: 'reps', target: '7/10' }, { name: 'Feel', measure: 'feel' }] })).body;
  assert.equal(tpl.items.length, 2);
  assert.equal((await coach2.get('/api/templates')).body.length, 1, 'shared library');
  assert.equal((await coach2.del(`/api/templates/${tpl.id}`)).status, 403);

  // Assign; athlete notified and sees it
  assert.equal((await coach2.post(`/api/athletes/${aid}/assignments`, { template_id: tpl.id })).status, 404, 'not their athlete');
  const asg = (await coach.post(`/api/athletes/${aid}/assignments`, { template_id: tpl.id, due_on: '2026-10-05', note: 'Focus on depth' })).body;
  assert.equal(asg.title, 'Kitchen day');
  assert.equal(asg.template_items.length, 2);
  const mine = (await ath.get('/api/me/assignments')).body;
  assert.equal(mine[0].status, 'open');
  assert.ok((await ath.get('/api/notifications')).body.items.some(n => n.kind === 'training'));

  // Coach runs the assignment as a session: it's marked done and linked.
  const sid = uid();
  assert.equal((await coach.post('/api/training/sessions', { id: uid(), title: 'x', athletes: [other], items: tpl.items, assignment_id: asg.id })).status, 400, 'assignment must match an athlete');
  await coach.post('/api/training/sessions', { id: sid, title: 'Kitchen day', athletes: [aid, other], items: tpl.items, assignment_id: asg.id });
  const after = (await ath.get('/api/me/assignments')).body[0];
  assert.deepEqual([after.status, after.session_id], ['done', sid]);

  // Session notes: private stays with the coach; shared reaches the athlete; wrong athlete refused.
  await coach.post(`/api/athletes/${aid}/notes`, { body: 'Great depth on drops', visibility: 'shared', session_id: sid });
  await coach.post(`/api/athletes/${aid}/notes`, { body: 'Watch fatigue', visibility: 'private', session_id: sid });
  await coach.post(`/api/athletes/${other}/notes`, { body: 'Bo: good', visibility: 'shared', session_id: sid });
  const stranger = (await coach.post('/api/athletes', { name: 'Not In' })).body.athlete.id;
  assert.equal((await coach.post(`/api/athletes/${stranger}/notes`, { body: 'x', visibility: 'shared', session_id: sid })).status, 400);
  assert.equal((await coach.get(`/api/training/sessions/${sid}`)).body.notes.length, 3);
  const athView = (await ath.get(`/api/training/sessions/${sid}`)).body;
  assert.deepEqual(athView.notes.map(n => n.body), ['Great depth on drops']);

  // A game recorded from the session shows on it.
  const ashPid = 'LAB-' + String(aid).padStart(5, '0'), boPid = 'LAB-' + String(other).padStart(5, '0');
  const mid = uid();
  const rec = await coach.post('/api/matches', { id: mid, kind: 'training', session_id: sid, teams: [[{ player_id: ashPid }], [{ player_id: boPid }]], games: [[11, 6]] });
  assert.equal(rec.status, 201);
  assert.equal(rec.body.status, 'verified', 'a coach recording for their athletes');
  assert.equal((await ath.get(`/api/training/sessions/${sid}`)).body.matches.length, 1);
  const vsGuest = await coach.post('/api/matches', { id: uid(), kind: 'training', session_id: sid, teams: [[{ player_id: ashPid }], [{ guest_name: 'Guest Gary' }]], games: [[11, 4]] });
  assert.equal(vsGuest.body.status, 'verified', 'coach without own profile recording vs a guest');
  // Can't link a match to someone else's session.
  const outsider = s.client(); await outsider.signup('Out', 'out@lab.test'); await outsider.post('/api/me/athlete', {});
  assert.equal((await outsider.post('/api/matches', { id: uid(), session_id: sid, teams: [[{ athlete_id: (await outsider.get('/api/me')).body.athlete_id }], [{ guest_name: 'G' }]], games: [[11, 2]] })).status, 400);

  // Athlete can reopen/complete; only the coach can delete.
  assert.equal((await ath.put(`/api/assignments/${asg.id}`, { status: 'open' })).body.status, 'open');
  assert.equal((await ath.del(`/api/assignments/${asg.id}`)).status, 403);
  assert.equal((await coach.del(`/api/assignments/${asg.id}`)).status, 204);
});
