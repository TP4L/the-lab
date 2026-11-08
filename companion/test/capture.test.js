'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { start, staff } = require('./helpers');

test('capture: group session with per-player attributes and no notes, idempotent save, stale-overwrite guard, name-only linking, history filters', async t => {
  const s = await start(); t.after(s.close); const { coach, coach2 } = await staff(s);
  const a1 = (await coach.post('/api/athletes', { name: 'Maya' })).body.athlete.id;
  const a2 = (await coach.post('/api/athletes', { name: 'Leo' })).body.athlete.id;
  const meta = (await coach.get('/api/captures/meta')).body;
  assert.ok(meta.formats.group_class && meta.suggested.player.includes('Late contact') && meta.roster.length >= 2);

  const body = { client_key: 'cap-1', format: 'group_class', occurred_on: '2026-11-07', focus_tags: ['Third-shot drops', 'Height reads'], players: [
    { athlete_id: a1, attributes: ['Late contact', 'Pop-ups under pressure'] }, { athlete_id: a2, attributes: ['Balanced recovery'] }, { name: 'Walk-in Sam', attributes: ['Good patience'] }] };
  const c = (await coach.post('/api/captures', body)).body;
  assert.equal(c.players.length, 3); assert.equal(c.notes, ''); assert.equal(c.players[0].attributes[0], 'Late contact'); assert.equal(c.players[2].linked, false);
  assert.equal(c.default_setting, 'conditioned_play'); assert.equal(c.version, 1);
  assert.equal((await coach.post('/api/captures', body)).body.id, c.id, 'same client key returns the same capture');
  assert.equal((await coach.get('/api/captures')).body.captures.length, 1);
  assert.equal((await coach2.get('/api/captures/' + c.id)).status, 404);

  // Save before the roster is complete: a capture with no players is fine.
  const quick = (await coach.post('/api/captures', { format: 'clinic' })).body;
  assert.equal(quick.players.length, 0); assert.equal(quick.occurred_on, meta.today);

  // Reopen to add notes; stale version is rejected, fresh version accepted.
  assert.equal((await coach.put('/api/captures/' + c.id, { version: 99, notes: 'late' })).status, 409);
  const upd = (await coach.put('/api/captures/' + c.id, { version: 1, notes: 'Everyone lifting under pressure.', players: [...c.players.map(p => ({ id: p.id, athlete_id: p.athlete_id, name: p.guest_name, attributes: p.attributes, observation: p.athlete_id === a1 ? 'Tends to rush the third ball' : '' }))] })).body;
  assert.equal(upd.version, 2); assert.equal(upd.players.find(p => p.athlete_id === a1).observation, 'Tends to rush the third ball');

  // Tag suggestions remember what was used.
  const meta2 = (await coach.get('/api/captures/meta')).body;
  assert.ok(meta2.recent.player.includes('Late contact') && meta2.recent.focus.includes('Height reads'));

  // Name-only player must be linked explicitly before follow-ups; linking is by id, never by name.
  const guest = upd.players.find(p => !p.linked);
  assert.equal((await coach.post('/api/captures/' + c.id + '/players/' + guest.id + '/link', { athlete_id: 999 })).status, 404);
  const linked = (await coach.post('/api/captures/' + c.id + '/players/' + guest.id + '/link', { athlete_id: a2 })).body;
  assert.equal(linked.players.filter(p => p.linked).length, 3);

  // Observations stay in the capture: not on the athlete profile, not in the athlete-facing thread.
  const athlete = s.client(); await athlete.signup('Maya', 'maya@lab.test');
  const claim = (await coach.get('/api/athletes/' + a1)).body; await athlete.post('/api/claim', { code: claim.claim_code });
  const thread = (await athlete.get('/api/me/thread')).body;
  assert.ok(!JSON.stringify(thread).includes('Late contact'));
  assert.equal((await athlete.get('/api/captures')).status, 403);

  // History filters
  assert.equal((await coach.get('/api/captures?athlete=' + a1)).body.captures.length, 1);
  assert.equal((await coach.get('/api/captures?format=clinic')).body.captures.length, 1);
  assert.equal((await coach.get('/api/captures?q=rush')).body.captures.length, 1);
  assert.equal((await coach.get('/api/athletes/' + a1 + '/captures')).body.captures[0].attributes[0], 'Late contact');
});

test('practice: private draft with coach context, approve shares to the intended athlete only, ratings carry setting and capture', async t => {
  const s = await start(); t.after(s.close); const { coach } = await staff(s);
  const a1 = (await coach.post('/api/athletes', { name: 'Maya' })).body, a2 = (await coach.post('/api/athletes', { name: 'Leo' })).body;
  const maya = s.client(); await maya.signup('Maya', 'maya2@lab.test'); await maya.post('/api/claim', { code: a1.claim_code });
  const leo = s.client(); await leo.signup('Leo', 'leo2@lab.test'); await leo.post('/api/claim', { code: a2.claim_code });
  const cap = (await coach.post('/api/captures', { format: 'group_lesson', players: [{ athlete_id: a1.athlete.id, attributes: ['Late contact'] }, { athlete_id: a2.athlete.id, attributes: ['Balanced recovery'] }] })).body;

  // Draft: nothing reaches the athlete.
  const draft = (await coach.post('/api/athletes/' + a1.athlete.id + '/development-blocks', { draft: true, title: 'Earlier contact on the third ball', reason: 'Late contact is why the drops pop up.', constraint_text: 'Shadow 20 third balls with contact in front of the hip.', success_evidence: 'Count how many you catch in front of the hip.', due_on: '2026-11-20', resource_url: 'https://example.com/clip', coach_context: 'From capture: Late contact, Pop-ups under pressure.', capture_id: cap.id })).body;
  assert.equal(draft.draft, true); assert.equal(draft.shared_at, null);
  assert.equal((await maya.get('/api/me/development-blocks')).body.length, 0);
  assert.equal((await maya.get('/api/development-blocks/' + draft.id)).status, 404);
  assert.ok(!JSON.stringify((await maya.get('/api/me/thread')).body).includes('Earlier contact'));
  assert.equal((await maya.get('/api/notifications')).body.items.filter(n => /practice/i.test(n.title)).length, 0);
  // Capture must include the athlete
  assert.equal((await coach.post('/api/athletes/' + a2.athlete.id + '/development-blocks', { draft: true, title: 'x', capture_id: 'nope' })).status, 404);
  // Edit the draft wording, guarded by expected_updated_at
  const edited = (await coach.put('/api/development-blocks/' + draft.id + '/practice', { expected_updated_at: draft.updated_at, constraint_text: 'Shadow 20 third balls; contact in front of the hip; say "early" out loud.' })).body;
  assert.match(edited.constraint_text, /early/);
  assert.equal((await coach.put('/api/development-blocks/' + draft.id + '/practice', { expected_updated_at: draft.updated_at, title: 'stale' })).status, 409);
  // Approve: now, and only Maya, sees it, without the coach context.
  assert.equal((await maya.post('/api/development-blocks/' + draft.id + '/approve', {})).status, 404);
  const shared = (await coach.post('/api/development-blocks/' + draft.id + '/approve', {})).body;
  assert.equal(shared.draft, false); assert.ok(shared.shared_at); assert.equal(shared.status, 'assigned');
  const mine = (await maya.get('/api/me/development-blocks')).body;
  assert.equal(mine.length, 1); assert.equal(mine[0].reason, 'Late contact is why the drops pop up.'); assert.equal(mine[0].resource_url, 'https://example.com/clip'); assert.equal(mine[0].coach_context, undefined);
  const detail = (await maya.get('/api/development-blocks/' + draft.id)).body; assert.equal(detail.coach_context, undefined); assert.equal(detail.capture_id, undefined);
  assert.equal((await leo.get('/api/me/development-blocks')).body.length, 0);
  assert.equal((await leo.get('/api/development-blocks/' + draft.id)).status, 404);
  assert.ok((await maya.get('/api/notifications')).body.items.some(n => /New practice/.test(n.title)));
  // Progress shows the approved practice first, and the goal can point at it.
  const prog = (await maya.get('/api/me/skills')).body;
  assert.equal(prog.practice.id, draft.id); assert.equal(prog.practice.next_check, 'Count how many you catch in front of the hip.'); assert.match(prog.context, /Pickleball/);
  const goal = (await coach.post('/api/athletes/' + a1.athlete.id + '/skill-goals', { title: 'Contact in front', block_id: draft.id })).body; assert.equal(goal.block_id, draft.id);
  assert.equal((await coach.post('/api/athletes/' + a2.athlete.id + '/skill-goals', { title: 'Wrong athlete', block_id: draft.id })).status, 400);
  // Athlete records an update; coach sees it.
  await maya.put('/api/development-blocks/' + draft.id, { athlete_reflection: 'Caught 14 of 20 in front.', confidence: 3 });
  assert.equal((await coach.get('/api/development-blocks/' + draft.id)).body.status, 'in_progress');
  // Ratings with setting and capture; reviewer attribution from the authenticated coach.
  const attrs = (await coach.get('/api/skill-attributes')).body.attributes;
  await coach.post('/api/athletes/' + a1.athlete.id + '/skill-ratings', { rated_on: '2026-11-07', setting: 'conditioned_play', capture_id: cap.id, ratings: [{ attribute_id: attrs[1].id, rating: 2, comment: 'Baseline' }] });
  await coach.post('/api/athletes/' + a1.athlete.id + '/skill-ratings', { rated_on: '2026-11-08', setting: 'lesson', ratings: [{ attribute_id: attrs[1].id, rating: 2 }] });
  assert.equal((await coach.post('/api/athletes/' + a1.athlete.id + '/skill-ratings', { setting: 'arena', ratings: [{ attribute_id: attrs[1].id, rating: 2 }] })).status, 400);
  assert.equal((await coach.post('/api/athletes/' + a2.athlete.id + '/skill-ratings', { capture_id: 'nope', ratings: [{ attribute_id: attrs[1].id, rating: 2 }] })).status, 404);
  const after = (await maya.get('/api/me/skills')).body;
  const sk = after.skills.find(x => x.id === attrs[1].id);
  assert.equal(sk.change, 'same'); assert.equal(sk.latest.setting_label, 'Lesson'); assert.equal(sk.history[1].setting_label, 'Conditioned play'); assert.ok(sk.latest.coach);
  assert.equal(after.summary.reassessed, 1); assert.equal(after.summary.baselines, 0); assert.equal(after.summary.same_last, 1);
});
