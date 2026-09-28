'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff, uid } = require('./helpers.js');

async function course(editor, access = 'members') {
  const c = (await editor.post('/api/studio/courses', { title: 'Reset Fundamentals', summary: 'Slow the ball down.', access })).body;
  const l1 = (await editor.post(`/api/studio/courses/${c.id}/lessons`, { title: 'Why reset', module: 'Foundations', body: '## Idea\n\nTake **pace** off.', preview: true, minutes: 5 })).body;
  const l2 = (await editor.post(`/api/studio/courses/${c.id}/lessons`, { title: 'Footwork', module: 'Foundations', body: 'Split step.' })).body;
  const l3 = (await editor.post(`/api/studio/courses/${c.id}/lessons`, { title: 'Live drill', module: 'Application', body: 'Go.' })).body;
  return { c, l1, l2, l3 };
}

test('course access: drafts hidden, previews open, members-only locked, video protected', async (t) => {
  const s = await start(); t.after(s.close);
  const { owner, editor, coach } = await staff(s);
  const { c, l1, l2 } = await course(editor);
  const u = s.client(); const me = (await u.signup('Lea Rner', 'lea@lab.test')).body.user;
  const anon = s.client();

  assert.equal((await u.get('/api/courses')).body.length, 0, 'draft hidden');
  assert.equal((await u.get(`/api/courses/${c.slug}`)).status, 404);
  await editor.put(`/api/studio/courses/${c.id}`, { status: 'published' });
  assert.ok((await u.get('/api/notifications')).body.items.some(n => /New course/.test(n.title)));

  const view = (await u.get(`/api/courses/${c.slug}`)).body;
  assert.equal(view.unlocked, false);
  assert.match(view.locked_reason, /members/);
  assert.deepEqual(view.modules.map(m => [m.title, m.lessons.length]), [['Foundations', 2], ['Application', 1]]);
  assert.deepEqual(view.modules[0].lessons.map(l => l.open), [true, false]);

  const prev = await u.get(`/api/courses/${c.slug}/lessons/${l1.id}`);
  assert.equal(prev.status, 200);
  assert.match(prev.body.body_html, /<h2>Idea<\/h2>/);
  assert.equal(prev.body.next.id, l2.id);
  const locked = await u.get(`/api/courses/${c.slug}/lessons/${l2.id}`);
  assert.equal(locked.status, 403);
  assert.equal(locked.body.locked, true);
  assert.equal(locked.body.body, undefined);
  assert.equal((await anon.get(`/api/courses/${c.slug}/lessons/${l1.id}`)).status, 200, 'public preview for anyone');

  // Lesson video: only editors upload; locked lesson video is not downloadable.
  const vid = Buffer.alloc(500, 1);
  assert.equal((await coach.call('POST', `/api/media?lesson_id=${l2.id}`, vid, { 'Content-Type': 'video/mp4' })).status, 403);
  const up = (await editor.call('POST', `/api/media?lesson_id=${l2.id}`, vid, { 'Content-Type': 'video/mp4', 'X-Upload-Id': uid() })).body;
  await editor.put(`/api/studio/lessons/${l2.id}`, { video_media_id: up.id });
  assert.equal((await u.get(`/api/media/${up.id}`)).status, 404);

  // Grant membership: unlocked, video downloadable.
  await owner.put(`/api/admin/users/${me.id}/membership`, { status: 'active', plan: 'annual' });
  assert.equal((await u.get(`/api/courses/${c.slug}`)).body.unlocked, true);
  assert.equal((await u.get(`/api/courses/${c.slug}/lessons/${l2.id}`)).status, 200);
  assert.equal((await u.get(`/api/media/${up.id}`)).status, 200);
  // Expired membership locks again.
  await owner.put(`/api/admin/users/${me.id}/membership`, { status: 'active', expires_at: '2020-01-01T00:00:00Z' });
  assert.equal((await u.get(`/api/courses/${c.slug}/lessons/${l2.id}`)).status, 403);
  assert.equal((await u.get('/api/me/learning')).body.membership.active, false);
  assert.equal((await coach.put(`/api/admin/users/${me.id}/membership`, { status: 'active' })).status, 403);
});

test('cohort courses, progress tracking, public courses', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach, editor } = await staff(s);
  const { c, l1, l2, l3 } = await course(editor, 'cohort');
  await editor.put(`/api/studio/courses/${c.id}`, { status: 'published' });
  const a = s.client(); await a.signup('Co Hort', 'co@lab.test');
  const b = s.client(); await b.signup('Out Side', 'out@lab.test');

  const cohort = (await coach.post('/api/cohorts', { title: 'Fall 4.0 group', course_id: c.id })).body;
  const add = (await coach.post(`/api/cohorts/${cohort.id}/members`, { emails: ['co@lab.test', 'nobody@lab.test'] })).body;
  assert.deepEqual([add.added, add.missing], [1, ['nobody@lab.test']]);
  assert.equal((await a.get(`/api/courses/${c.slug}/lessons/${l3.id}`)).status, 200);
  assert.equal((await b.get(`/api/courses/${c.slug}/lessons/${l3.id}`)).status, 403);
  assert.equal((await b.get('/api/cohorts')).status, 403);

  await a.post(`/api/lessons/${l1.id}/complete`);
  const p = (await a.post(`/api/lessons/${l2.id}/complete`)).body;
  assert.deepEqual([p.done.length, p.total], [2, 3]);
  assert.equal((await a.get('/api/courses')).body[0].completed, 2);
  assert.equal((await a.get('/api/me/learning')).body.courses[0].completed, 2);
  await a.del(`/api/lessons/${l2.id}/complete`);
  assert.equal((await a.get(`/api/courses/${c.slug}`)).body.completed, 1);
  // Can't mark a locked lesson complete.
  assert.equal((await b.post(`/api/lessons/${l3.id}/complete`)).status, 404);

  const pub = (await editor.post('/api/studio/courses', { title: 'Open Basics', access: 'public' })).body;
  const pl = (await editor.post(`/api/studio/courses/${pub.id}/lessons`, { title: 'Grip' })).body;
  await editor.put(`/api/studio/courses/${pub.id}`, { status: 'published' });
  assert.equal((await b.get(`/api/courses/${pub.slug}/lessons/${pl.id}`)).status, 200);
});

test('saved posts, rendered post HTML, markdown safety', async (t) => {
  const s = await start(); t.after(s.close);
  const { editor } = await staff(s);
  const u = s.client(); await u.signup('Sav Er', 'sav@lab.test');
  const p = (await editor.post('/api/studio/posts', { title: 'Kitchen', lane: 'the_work', body: '## Head\n\n<script>x</script> [bad](javascript:alert(1)) **ok**' })).body;
  assert.equal((await u.put(`/api/me/saved/${p.id}`)).status, 404, 'can’t save a draft');
  await editor.post(`/api/studio/posts/${p.id}/publish`, {});
  assert.equal((await u.put(`/api/me/saved/${p.id}`)).status, 204);
  await u.put(`/api/me/saved/${p.id}`);
  assert.equal((await u.get('/api/me/saved')).body.length, 1);
  const art = (await u.get(`/api/posts/${p.slug}`)).body;
  assert.match(art.body_html, /<h2>Head<\/h2>/);
  assert.match(art.body_html, /&lt;script&gt;/);
  assert.doesNotMatch(art.body_html, /href="javascript/);
  assert.match(art.body_html, /<strong>ok<\/strong>/);
  await u.del(`/api/me/saved/${p.id}`);
  assert.equal((await u.get('/api/me/saved')).body.length, 0);
});
