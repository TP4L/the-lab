'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff } = require('./helpers.js');

const tokenOf = link => link.split('/').pop();

test('pending interest: options, responses, waitlist, minimum, close, convert to a plan', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach, coach2 } = await staff(s);
  const c = (await coach.post('/api/interest', {
    title: 'Tuesday 3.5 group', kind: 'training', skill_level: '3.0–3.5', location: 'Court 4', min_people: 3, max_people: 4,
    options: [{ label: 'Tue 6pm' }, { label: 'Thu 7pm', starts_at: new Date(Date.now() + 5 * 864e5).toISOString() }]
  })).body;
  assert.ok(c.link.startsWith('#/interest/'));
  assert.equal(c.options.length, 2);
  assert.equal((await coach2.get(`/api/interest/${c.id}`)).status, 404, 'other coaches can’t see it');
  const tok = tokenOf(c.link);

  const anon = s.client();
  const pub = (await anon.get(`/api/public/interest/${tok}`)).body;
  assert.equal(pub.title, 'Tuesday 3.5 group');
  assert.equal(pub.responses, undefined, 'no names on the public page');
  const [o1, o2] = pub.options.map(o => o.id);

  const answers = [];
  for (let i = 0; i < 5; i++) {
    const r = await anon.post(`/api/public/interest/${tok}/respond`, { name: `P${i}`, email: `p${i}@x.test`, status: i === 1 ? 'maybe' : 'interested', option_ids: i % 2 ? [o1] : [o1, o2] });
    assert.equal(r.status, 201);
    answers.push(r.body);
  }
  assert.deepEqual(answers.map(a => a.status), ['interested', 'maybe', 'interested', 'interested', 'interested']);
  let v = (await coach.get(`/api/interest/${c.id}`)).body;
  assert.equal(v.progress.have, 4);
  assert.equal(v.progress.reached, true);
  assert.equal(v.options.find(o => o.id === o1).interested, 4);
  assert.ok((await coach.get('/api/notifications')).body.items.some(n => /minimum/.test(n.title)));

  // Full: the next "interested" waits; changing an answer needs the edit token.
  const w = await anon.post(`/api/public/interest/${tok}/respond`, { name: 'P5', email: 'p5@x.test' });
  assert.equal(w.body.status, 'waitlist');
  assert.equal((await anon.post(`/api/public/interest/${tok}/respond`, { name: 'Imposter', email: 'p0@x.test', status: 'maybe' })).status, 409);
  // P0 switches to maybe with their token: P5 moves up.
  const sw = await anon.post(`/api/public/interest/${tok}/respond`, { name: 'P0', email: 'p0@x.test', status: 'maybe', edit_token: answers[0].edit_token });
  assert.equal(sw.status, 200);
  v = (await coach.get(`/api/interest/${c.id}`)).body;
  assert.equal(v.responses.find(x => x.email === 'p5@x.test').status, 'interested');
  // Returning visitor sees their own answer.
  assert.equal((await anon.get(`/api/public/interest/${tok}?edit=${answers[0].edit_token}`)).body.mine.status, 'maybe');

  // Close, then reopen.
  await coach.post(`/api/interest/${c.id}/status`, { status: 'closed' });
  assert.equal((await anon.post(`/api/public/interest/${tok}/respond`, { name: 'Late', email: 'late@x.test' })).status, 409);
  await coach.post(`/api/interest/${c.id}/status`, { status: 'open' });

  // Set the date: the interested people become Team Planner invitees.
  const when = new Date(Date.now() + 6 * 864e5).toISOString();
  const sch = await coach.post(`/api/interest/${c.id}/schedule`, { starts_at: when });
  assert.equal(sch.status, 201);
  const plan = (await coach.get(`/api/plans/${sch.body.plan_id}`)).body;
  assert.equal(plan.title, 'Tuesday 3.5 group');
  assert.equal(plan.players.length, 4);
  assert.equal(plan.capacity, 4);
  assert.equal((await coach.post(`/api/interest/${c.id}/schedule`, { starts_at: when })).status, 409);
  assert.equal((await coach.get(`/api/interest/${c.id}`)).body.status, 'scheduled');
});

test('team planner: blocks, invitations, in/out/maybe, waitlist, recaps, privacy, library, live event', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  // A coached athlete with an account, to check in-app invitations.
  const made = (await coach.post('/api/athletes', { name: 'Ari Linked', claim_email: 'ari@x.test' })).body;
  const ariId = made.athlete.id;
  const ari = s.client(); await ari.signup('Ari Linked', 'ari@x.test');
  await ari.post('/api/claim', { code: made.claim_code });

  const p = (await coach.post('/api/plans', {
    title: 'Saturday clinic', starts_at: new Date(Date.now() + 2 * 864e5).toISOString(), location: 'Main courts', coaches: 'Brett, Austin',
    message: 'Bring water.', agenda: 'Warm-up, drills, games', handoff: 'Sam: watch her backhand dink.', capacity: 3,
    blocks: [{ start_time: '09:00', end_time: '09:30', court: '1', lead: 'Brett', drill: 'Dink ladder', instructions: 'Cross-court only' }, { start_time: '09:30', end_time: '10:00', court: '2', lead: 'Austin', drill: 'Third shot drops' }],
    players: [{ name: 'Sam', email: 'sam@x.test', court: '1' }, { name: 'Jo', email: 'jo@x.test' }, { name: 'Max' }, { athlete_id: ariId }, { name: 'Kai' }]
  })).body;
  assert.equal(p.blocks.length, 2);
  assert.equal(p.players.length, 5);
  assert.equal((await coach.post('/api/plans', { title: 'Bad', blocks: [{ start_time: '9am' }] })).status, 400);

  // Draft invitations don't open; sending invitations publishes the plan.
  const sam = p.players.find(x => x.name === 'Sam');
  const anon = s.client();
  assert.equal((await anon.get(`/api/i/${tokenOf(sam.link)}`)).status, 404);
  const inv = (await coach.post(`/api/plans/${p.id}/invite`)).body;
  assert.equal(inv.plan.status, 'published');
  assert.equal(inv.mail, false);
  assert.ok((await ari.get('/api/notifications')).body.items.some(n => /invited/.test(n.title)), 'linked athlete gets an in-app invitation');

  // The player page: plan, blocks, own court. Never the handoff notes or the roster.
  const iv = (await anon.get(`/api/i/${tokenOf(sam.link)}`)).body;
  assert.equal(iv.plan.title, 'Saturday clinic');
  assert.equal(iv.plan.blocks.length, 2);
  assert.equal(iv.me.court, '1');
  assert.equal(JSON.stringify(iv).includes('backhand'), false, 'handoff notes stay private');
  assert.equal(JSON.stringify(iv).includes('jo@x.test'), false, 'no contact roster');

  // Capacity 3: the fourth "In" waits; an "Out" promotes the oldest waiting.
  const rs = async (name, rsvp) => (await anon.post(`/api/i/${tokenOf(p.players.find(x => x.name === name).link)}/rsvp`, { rsvp })).body;
  await rs('Sam', 'in'); await rs('Jo', 'in'); await rs('Max', 'in');
  assert.equal((await rs('Kai', 'in')).me.rsvp, 'waitlist');
  assert.equal((await rs('Jo', 'maybe')).me.rsvp, 'maybe');
  let v = (await coach.get(`/api/plans/${p.id}`)).body;
  assert.equal(v.players.find(x => x.name === 'Kai').rsvp, 'in');
  assert.deepEqual([v.counts.in, v.counts.maybe, v.counts.waitlist], [3, 1, 0]);

  // Recap: write it, publish it, the player sees it.
  await coach.put(`/api/plans/${p.id}/players/${sam.id}`, { recap_observation: 'Paddle drops after the dink.', recap_cue: 'Paddle up, ready.', recap_next: '50 cross-court dinks, paddle up.' });
  assert.equal((await anon.get(`/api/i/${tokenOf(sam.link)}`)).body.me.recap, null, 'not until published');
  await coach.post(`/api/plans/${p.id}/players/${sam.id}/recap`, { publish: true });
  assert.equal((await anon.get(`/api/i/${tokenOf(sam.link)}`)).body.me.recap.cue, 'Paddle up, ready.');
  const empty = p.players.find(x => x.name === 'Max');
  assert.equal((await coach.post(`/api/plans/${p.id}/players/${empty.id}/recap`, { publish: true })).status, 400);

  // Edits need the latest version.
  assert.equal((await coach.put(`/api/plans/${p.id}`, { version: 1, agenda: 'x' })).status, 409);
  v = (await coach.put(`/api/plans/${p.id}`, { version: v.version, agenda: 'Warm-up, drills, king of the court' })).body;
  assert.equal(v.agenda, 'Warm-up, drills, king of the court');

  // Saved groups and drills.
  await coach.post('/api/plan-library', { kind: 'group', name: 'Saturday regulars', data: [{ name: 'Sam', email: 'sam@x.test' }, { name: 'Jo' }] });
  await coach.post('/api/plan-library', { kind: 'drill', name: 'Dink ladder', data: { drill: 'Dink ladder', instructions: 'Cross-court only' } });
  const lib = (await coach.get('/api/plan-library')).body;
  assert.deepEqual(lib.map(x => x.kind).sort(), ['drill', 'group']);

  // Limits: 100 players.
  const many = Array.from({ length: 96 }, (_, i) => ({ name: 'Extra ' + i }));
  assert.equal((await coach.post(`/api/plans/${p.id}/players`, { players: many })).status, 400);

  // Into a live event: everyone who's In is registered (guests get player links).
  const ev = await coach.post(`/api/plans/${p.id}/event`, { mode: 'rotate' });
  assert.equal(ev.status, 201);
  const e = (await coach.get(`/api/events/${ev.body.event_id}`)).body;
  assert.equal(e.counts.registered, 3);
  assert.ok(e.people.every(x => x.link || !x.guest));
  assert.equal((await coach.post(`/api/plans/${p.id}/event`, {})).status, 409);

  // Cancelled: players can't answer any more.
  await coach.put(`/api/plans/${p.id}`, { status: 'cancelled' });
  assert.equal((await anon.post(`/api/i/${tokenOf(sam.link)}/rsvp`, { rsvp: 'out' })).status, 409);
});
