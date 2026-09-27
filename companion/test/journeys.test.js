'use strict';
/* The acceptance journeys from the build brief that this slice covers.
   Journey 3 (record a match, correct it) belongs to the Play slice. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff, uid } = require('./helpers.js');

test('Journey 1: athlete signs in, claims the right profile, sees only shared notes', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);

  const made = await coach.post('/api/athletes', { name: 'Riley Park', hand: 'right', side: 'left', claim_email: 'riley@lab.test', focus: 'Third-shot drop depth' });
  assert.equal(made.status, 201);
  const aid = made.body.athlete.id;
  const code = made.body.claim_code;
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  await coach.post(`/api/athletes/${aid}/notes`, { body: 'Great reset footwork today.', visibility: 'shared' });
  await coach.post(`/api/athletes/${aid}/notes`, { body: 'Private: watch the left knee.', visibility: 'private' });

  // Wrong email can't claim a reserved profile.
  const imposter = s.client(); await imposter.signup('Not Riley', 'someone@lab.test');
  assert.equal((await imposter.post('/api/claim', { code })).status, 403);

  const riley = s.client();
  await riley.signup('Riley Park', 'riley@lab.test');
  assert.equal((await riley.post('/api/claim', { code: 'WXYZ-2345' })).status, 400);
  const claimed = await riley.post('/api/claim', { code: code.toLowerCase().replace('-', ' ') });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.athlete.id, aid, 'claims the existing record, no duplicate');
  assert.equal(claimed.body.access, 'self');
  assert.deepEqual(claimed.body.notes.map(n => n.body), ['Great reset footwork today.']);
  assert.equal(claimed.body.athlete.focus, 'Third-shot drop depth');

  // Code is single-use and the account now has one profile.
  const again = s.client(); await again.signup('Again', 'again@lab.test');
  assert.equal((await again.post('/api/claim', { code })).status, 400);
  assert.equal((await riley.get('/api/me')).body.athlete_id, aid);

  // Athlete can edit goals but not the coach's plan.
  const up = await riley.put(`/api/athletes/${aid}`, { goals: 'Win 4.0 bracket', plan: 'hacked', focus: 'hacked' });
  assert.equal(up.body.athlete.goals, 'Win 4.0 bracket');
  assert.equal(up.body.athlete.focus, 'Third-shot drop depth');

  // Reflections are always shared; the coach sees them alongside private notes.
  await riley.post(`/api/athletes/${aid}/notes`, { body: 'Felt rushed at the kitchen line.', visibility: 'private' });
  const coachView = (await coach.get(`/api/athletes/${aid}`)).body;
  assert.equal(coachView.notes.length, 3);
  assert.ok(coachView.notes.find(n => n.kind === 'reflection' && n.visibility === 'shared'));
});

test('Journey 2: four-player session, each athlete gets their own results', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const ids = [];
  for (const name of ['A One', 'B Two', 'C Three', 'D Four']) ids.push((await coach.post('/api/athletes', { name })).body.athlete.id);

  const sid = uid();
  const created = await coach.post('/api/training/sessions', {
    id: sid, title: 'Tuesday group', athletes: ids,
    items: [{ name: 'Drops to target', measure: 'reps', target: '7/10' }, { name: 'Dink rally', measure: 'score' },
      { name: 'Reset under pace', measure: 'reps' }, { name: 'Session feel', measure: 'feel' }]
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.athletes.length, 4);

  const ev = (athlete_id, kind, extra = {}) => ({ id: uid(), item_idx: 0, athlete_id, kind, at: new Date().toISOString(), ...extra });
  const batch = [];
  // A: 3 makes 1 miss. B: 1 make. C: 2 misses. D: 1 make then an accidental make, undone.
  batch.push(ev(ids[0], 'make'), ev(ids[0], 'make'), ev(ids[0], 'make'), ev(ids[0], 'miss'));
  batch.push(ev(ids[1], 'make'));
  batch.push(ev(ids[2], 'miss'), ev(ids[2], 'miss'));
  const oops = ev(ids[3], 'make');
  batch.push(ev(ids[3], 'make'), oops, ev(ids[3], 'undo', { undoes: oops.id }));
  batch.push(ev(ids[0], 'value', { item_idx: 1, value: 11 }), ev(ids[0], 'value', { item_idx: 1, value: 7 }));
  const res = await coach.post(`/api/training/sessions/${sid}/events`, { events: batch });
  assert.equal(res.status, 200);
  assert.equal(res.body.stored, batch.length);

  const cell = (sum, aid, idx = 0) => sum.find(c => c.athlete_id === aid && c.item_idx === idx);
  const sum = res.body.summary;
  assert.deepEqual([cell(sum, ids[0]).makes, cell(sum, ids[0]).misses, cell(sum, ids[0]).pct], [3, 1, 75]);
  assert.equal(cell(sum, ids[1]).makes, 1);
  assert.equal(cell(sum, ids[2]).misses, 2);
  assert.equal(cell(sum, ids[3]).makes, 1, 'undo cancels the accidental tap');
  assert.deepEqual([cell(sum, ids[0], 1).best, cell(sum, ids[0], 1).last], [11, 7]);

  // Athlete B claims their profile and sees only their own row.
  const code = (await coach.post(`/api/athletes/${ids[1]}/claim-code`, {})).body.claim_code;
  const b = s.client(); await b.signup('B Two', 'b@lab.test');
  await b.post('/api/claim', { code });
  const mine = (await b.get(`/api/training/sessions/${sid}`)).body;
  assert.equal(mine.athletes.length, 1);
  assert.ok(mine.summary.every(c => c.athlete_id === ids[1]));
  const results = (await b.get(`/api/athletes/${ids[1]}/results`)).body;
  assert.equal(results[0].items[0].makes, 1);
  // B can't read A's results or post scores.
  assert.equal((await b.get(`/api/athletes/${ids[0]}/results`)).status, 404);
  assert.equal((await b.post(`/api/training/sessions/${sid}/events`, { events: [ev(ids[1], 'make')] })).status, 404);
});

test('Journey 4: contributor drafts on mobile, editor publishes, website feed shows it', async (t) => {
  const s = await start(); t.after(s.close);
  const { writer, editor } = await staff(s);
  const pub = s.client();

  const d = await writer.post('/api/studio/posts', { title: 'Why the reset wins', lane: 'the_work', body: 'Para one.\n\nPara two.', tags: ['Reset', 'kitchen'] });
  assert.equal(d.status, 201);
  const id = d.body.id;
  assert.equal(d.body.status, 'draft');
  assert.deepEqual(d.body.tags, ['reset', 'kitchen']);

  // Thumbnail upload attached to the post.
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const up = await writer.call('POST', `/api/media?post_id=${id}`, png, { 'Content-Type': 'image/png', 'X-Upload-Id': uid() });
  assert.equal(up.status, 201);
  const saved = await writer.put(`/api/studio/posts/${id}`, { version: d.body.version, thumbnail_media_id: up.body.id, summary: 'Short.' });
  assert.equal(saved.status, 200);

  // Stale save is rejected, not silently overwritten.
  const stale = await writer.put(`/api/studio/posts/${id}`, { version: d.body.version, title: 'Overwrite' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.current.title, 'Why the reset wins');

  // Contributor can't publish; not visible publicly or to anonymous media fetch yet.
  assert.equal((await writer.post(`/api/studio/posts/${id}/publish`)).status, 403);
  assert.equal((await pub.get('/api/posts')).body.length, 0);
  assert.equal((await pub.get(`/api/media/${up.body.id}`)).status, 404);

  assert.equal((await writer.post(`/api/studio/posts/${id}/submit`)).body.status, 'in_review');
  const returned = await editor.post(`/api/studio/posts/${id}/return`, { note: 'Tighten the intro.' });
  assert.equal(returned.body.status, 'draft');
  assert.equal(returned.body.review_note, 'Tighten the intro.');
  await writer.post(`/api/studio/posts/${id}/submit`);
  const live = await editor.post(`/api/studio/posts/${id}/publish`, {});
  assert.equal(live.body.status, 'published');

  const feed = (await pub.get('/api/posts')).body;
  assert.equal(feed.length, 1);
  assert.equal(feed[0].lane_name, 'The Work');
  const article = (await pub.get(`/api/posts/${feed[0].slug}`)).body;
  assert.equal(article.body, 'Para one.\n\nPara two.');
  assert.equal(article.review_note, undefined);
  assert.equal((await pub.get(`/api/media/${up.body.id}`)).status, 200, 'post media is public once live');

  // Live post: contributor can't edit, editor can, and a revision is kept.
  assert.equal((await writer.put(`/api/studio/posts/${id}`, { version: live.body.version, title: 'x' })).status, 403);
  assert.equal((await editor.put(`/api/studio/posts/${id}`, { version: live.body.version, title: 'Why the reset wins, revised' })).status, 200);
  assert.ok((await editor.get(`/api/studio/posts/${id}/revisions`)).body.length >= 4);

  // Scheduling: future post is hidden until its time.
  const f = (await writer.post('/api/studio/posts', { title: 'Future', lane: 'quick_read' })).body;
  await editor.post(`/api/studio/posts/${f.id}/publish`, { publish_at: new Date(Date.now() + 864e5).toISOString() });
  assert.equal((await pub.get('/api/posts?lane=quick_read')).body.length, 0);
  assert.equal((await editor.get(`/api/studio/posts/${f.id}`)).body.status, 'scheduled');
});

test('Journey 5: offline session replays safely with no duplicates', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const aid = (await coach.post('/api/athletes', { name: 'Solo' })).body.athlete.id;
  const sid = uid();
  const body = { id: sid, title: 'Solo counter', athletes: [aid], items: [{ name: 'Serves deep', measure: 'reps' }], started_at: '2026-09-27T10:00:00Z' };
  // Device created the session offline and retries the create after reconnecting.
  assert.equal((await coach.post('/api/training/sessions', body)).status, 201);
  assert.equal((await coach.post('/api/training/sessions', body)).status, 200);
  assert.equal((await coach.get('/api/training/sessions')).body.length, 1);

  const events = Array.from({ length: 6 }, (_, i) => ({ id: uid(), item_idx: 0, athlete_id: aid, kind: i % 3 ? 'make' : 'miss', at: `2026-09-27T10:0${i}:00Z` }));
  const first = await coach.post(`/api/training/sessions/${sid}/events`, { events: events.slice(0, 4) });
  assert.equal(first.body.stored, 4);
  // Connection dropped before the reply; the device resends everything.
  const replay = await coach.post(`/api/training/sessions/${sid}/events`, { events });
  assert.deepEqual([replay.body.stored, replay.body.duplicates], [2, 4]);
  const c = replay.body.summary[0];
  assert.deepEqual([c.makes, c.misses], [4, 2]);

  // Notes with a client_id are idempotent too.
  const cid = uid();
  const n1 = await coach.post(`/api/athletes/${aid}/notes`, { body: 'Offline note', visibility: 'shared', client_id: cid });
  const n2 = await coach.post(`/api/athletes/${aid}/notes`, { body: 'Offline note', visibility: 'shared', client_id: cid });
  assert.equal(n1.body.id, n2.body.id);

  // Two devices editing the session metadata: the stale one gets 409, scores untouched.
  const v = (await coach.get(`/api/training/sessions/${sid}`)).body.version;
  assert.equal((await coach.put(`/api/training/sessions/${sid}`, { version: v, title: 'Renamed' })).status, 200);
  const conflict = await coach.put(`/api/training/sessions/${sid}`, { version: v, status: 'complete' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.current.title, 'Renamed');
  assert.equal(conflict.body.current.summary[0].makes, 4);
});

test('Journey 6: unauthorized users are kept out', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach, coach2, writer } = await staff(s);
  const anon = s.client();
  const athlete = s.client(); await athlete.signup('Plain Athlete', 'plain@lab.test');

  const aid = (await coach.post('/api/athletes', { name: 'Protected' })).body.athlete.id;
  await coach.post(`/api/athletes/${aid}/notes`, { body: 'secret', visibility: 'private' });
  const jpg = Buffer.from('ffd8ffe000104a464946', 'hex');
  const priv = (await coach.call('POST', `/api/media?athlete_id=${aid}&visibility=private`, jpg, { 'Content-Type': 'image/jpeg' })).body;
  assert.equal(priv.visibility, 'private');

  for (const c of [anon, athlete, coach2, writer]) {
    assert.ok([401, 404].includes((await c.get(`/api/athletes/${aid}`)).status));
    assert.ok([401, 404].includes((await c.get(`/api/media/${priv.id}`)).status));
    assert.ok([401, 404].includes((await c.post(`/api/athletes/${aid}/notes`, { body: 'x', visibility: 'shared' })).status));
  }
  assert.equal((await coach.get(`/api/media/${priv.id}`)).status, 200);

  // Roster and studio are role-gated.
  assert.equal((await anon.get('/api/athletes')).status, 401);
  assert.equal((await athlete.get('/api/athletes')).status, 403);
  assert.equal((await athlete.post('/api/athletes', { name: 'x' })).status, 403);
  assert.equal((await athlete.get('/api/studio/posts')).status, 403);
  assert.equal((await athlete.post('/api/studio/posts', { title: 'x' })).status, 403);
  assert.equal((await coach.get('/api/studio/posts')).status, 403);
  assert.equal((await writer.get('/api/admin/users')).status, 403);

  // Contributors see only their own drafts; other drafts are invisible.
  const other = s.client(); await other.signup('Other', 'other@lab.test');
  const d = (await writer.post('/api/studio/posts', { title: 'Mine' })).body;
  assert.equal((await other.get(`/api/studio/posts/${d.id}`)).status, 403);

  // Signing up can't grant a role.
  const sneaky = s.client();
  const r = await sneaky.call('POST', '/api/auth/signup', { name: 'S', email: 'sneaky@lab.test', password: 'long enough pw', roles: ['admin'], role: 'coach' });
  assert.deepEqual(r.body.user.roles, ['athlete']);

  // Cross-site writes are refused even with a valid cookie.
  assert.equal((await coach.call('POST', '/api/athletes', { name: 'x' }, { Origin: 'https://evil.example' })).status, 403);
});
