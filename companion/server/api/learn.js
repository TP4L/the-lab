'use strict';
const crypto = require('node:crypto');
const { HttpError, withStatus, str, oneOf, int, isoTime, list } = require('../http.js');
const { tx, now } = require('../db.js');
const MD = require('../../web/markdown.js');

const ACCESS = { public: 'Everyone', members: 'Members', cohort: 'Cohort' };
const slugify = t => (t.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 60) || 'course') + '-' + crypto.randomBytes(2).toString('hex');

module.exports = function learn(r, ctx) {
  const { db, auth, notifier } = ctx;

  /* ---------- access ---------- */
  function membership(user) {
    if (!user) return null;
    const m = db.prepare('SELECT * FROM memberships WHERE user_id = ?').get(user.id);
    if (!m) return null;
    const active = m.status === 'active' && (!m.expires_at || m.expires_at > now());
    return { ...m, active };
  }
  const staff = user => auth.has(user, 'coach', 'editor');
  function inCohortFor(user, courseId) {
    return !!user && !!db.prepare('SELECT 1 FROM cohort_members cm JOIN cohorts c ON c.id = cm.cohort_id WHERE cm.user_id = ? AND c.course_id = ?').get(user.id, courseId);
  }
  /* Full access to a course's lessons. Previews are handled per lesson. */
  function canAccess(user, c) {
    if (staff(user)) return true;
    if (c.status !== 'published' || !user) return false;
    if (c.access === 'public') return true;
    if (c.access === 'members') { const m = membership(user); return !!(m && m.active) || inCohortFor(user, c.id); }
    return inCohortFor(user, c.id);
  }
  function lockedReason(user, c) {
    if (!user) return 'Sign in to start this course.';
    if (c.access === 'members') return 'This course is for THE LAB members.';
    return 'This course is for a coaching cohort.';
  }
  function canViewLesson(user, c, l) {
    if (staff(user)) return true;
    if (c.status !== 'published') return false;
    return !!l.preview || canAccess(user, c);
  }
  function mediaAllowed(user, m, write) {
    if (write) return staff(user);
    if (m.lesson_id) {
      const l = db.prepare('SELECT * FROM lessons WHERE id = ?').get(m.lesson_id);
      const c = l && db.prepare('SELECT * FROM courses WHERE id = ?').get(l.course_id);
      return !!(c && canViewLesson(user, c, l));
    }
    const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(m.course_id);
    return !!c && (staff(user) || c.status === 'published'); // covers are catalogue art
  }
  ctx.learn = { mediaAllowed, membership };

  function courseBySlug(user, slug) {
    const c = db.prepare('SELECT * FROM courses WHERE slug = ?').get(String(slug));
    if (!c || (c.status !== 'published' && !staff(user))) throw new HttpError(404, 'Course not found.');
    return c;
  }
  function progressFor(user, courseId) {
    if (!user) return { done: [], total: 0 };
    const done = db.prepare('SELECT lp.lesson_id FROM lesson_progress lp JOIN lessons l ON l.id = lp.lesson_id WHERE lp.user_id = ? AND l.course_id = ?').all(user.id, courseId).map(r => r.lesson_id);
    return { done, total: db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE course_id = ?').get(courseId).n };
  }
  function mediaMap(where, id) {
    const map = {};
    db.prepare(`SELECT id, mime FROM media WHERE ${where} = ?`).all(id).forEach(m => { map[m.id] = m.mime; });
    return map;
  }
  function summary(user, c) {
    const p = progressFor(user, c.id);
    return {
      id: c.id, title: c.title, slug: c.slug, summary: c.summary, cover_media_id: c.cover_media_id, access: c.access, access_label: ACCESS[c.access],
      status: c.status, lessons: p.total, completed: p.done.length, unlocked: canAccess(user, c),
      minutes: db.prepare('SELECT COALESCE(SUM(minutes), 0) AS n FROM lessons WHERE course_id = ?').get(c.id).n
    };
  }

  /* ---------- learners ---------- */
  r.get('/api/courses', ({ user }) => {
    const rows = db.prepare(`SELECT * FROM courses ${staff(user) ? '' : "WHERE status = 'published'"} ORDER BY updated_at DESC`).all();
    return rows.map(c => summary(user, c));
  });
  r.get('/api/courses/:slug', ({ user, params }) => {
    const c = courseBySlug(user, params.slug);
    const p = progressFor(user, c.id);
    const unlocked = canAccess(user, c);
    const lessons = db.prepare('SELECT id, position, module, title, minutes, preview FROM lessons WHERE course_id = ? ORDER BY position, id').all(c.id)
      .map(l => ({ ...l, preview: !!l.preview, done: p.done.includes(l.id), open: unlocked || !!l.preview }));
    const modules = [];
    lessons.forEach(l => { let m = modules[modules.length - 1]; if (!m || m.title !== l.module) { m = { title: l.module, lessons: [] }; modules.push(m); } m.lessons.push(l); });
    return { ...summary(user, c), modules, locked_reason: unlocked ? null : lockedReason(user, c), cohorts: staff(user) ? db.prepare('SELECT id, title FROM cohorts WHERE course_id = ?').all(c.id) : undefined };
  });
  r.get('/api/courses/:slug/lessons/:id', ({ user, params }) => {
    const c = courseBySlug(user, params.slug);
    const l = db.prepare('SELECT * FROM lessons WHERE id = ? AND course_id = ?').get(int(params.id, 'id', { min: 1, required: true }), c.id);
    if (!l) throw new HttpError(404, 'Lesson not found.');
    if (!canViewLesson(user, c, l)) throw new HttpError(403, lockedReason(user, c), { locked: true, access: c.access });
    const ordered = db.prepare('SELECT id, title FROM lessons WHERE course_id = ? ORDER BY position, id').all(c.id);
    const i = ordered.findIndex(x => x.id === l.id);
    const media = mediaMap('lesson_id', l.id);
    return {
      ...l, preview: !!l.preview, course: { title: c.title, slug: c.slug }, media: Object.keys(media).map(id => ({ id, mime: media[id] })),
      body_html: MD.render(l.body, { media }),
      done: !!(user && db.prepare('SELECT 1 FROM lesson_progress WHERE user_id = ? AND lesson_id = ?').get(user.id, l.id)),
      prev: ordered[i - 1] || null, next: ordered[i + 1] || null
    };
  });
  function lessonForProgress(user, id) {
    auth.require(user);
    const l = db.prepare('SELECT * FROM lessons WHERE id = ?').get(int(id, 'id', { min: 1, required: true }));
    const c = l && db.prepare('SELECT * FROM courses WHERE id = ?').get(l.course_id);
    if (!l || !canViewLesson(user, c, l)) throw new HttpError(404, 'Lesson not found.');
    return l;
  }
  r.post('/api/lessons/:id/complete', ({ user, params }) => {
    const l = lessonForProgress(user, params.id);
    db.prepare('INSERT OR IGNORE INTO lesson_progress (user_id, lesson_id) VALUES (?, ?)').run(user.id, l.id);
    return progressFor(user, l.course_id);
  });
  r.del('/api/lessons/:id/complete', ({ user, params }) => {
    const l = lessonForProgress(user, params.id);
    db.prepare('DELETE FROM lesson_progress WHERE user_id = ? AND lesson_id = ?').run(user.id, l.id);
    return progressFor(user, l.course_id);
  });
  r.get('/api/me/learning', ({ user }) => {
    auth.require(user);
    const m = membership(user);
    const cohorts = db.prepare('SELECT c.id, c.title, c.starts_at, c.ends_at, co.title AS course_title, co.slug AS course_slug FROM cohort_members cm JOIN cohorts c ON c.id = cm.cohort_id LEFT JOIN courses co ON co.id = c.course_id WHERE cm.user_id = ?').all(user.id);
    const started = db.prepare(`SELECT DISTINCT l.course_id FROM lesson_progress lp JOIN lessons l ON l.id = lp.lesson_id WHERE lp.user_id = ?`).all(user.id)
      .map(x => db.prepare('SELECT * FROM courses WHERE id = ?').get(x.course_id)).filter(c => c && c.status === 'published').map(c => summary(user, c));
    return { membership: m ? { plan: m.plan, active: m.active, expires_at: m.expires_at } : null, cohorts, courses: started };
  });

  /* Saved posts */
  r.get('/api/me/saved', ({ user }) => {
    auth.require(user);
    return db.prepare(`SELECT p.id, p.lane, p.title, p.slug, p.summary, p.thumbnail_media_id FROM saved_posts s JOIN posts p ON p.id = s.post_id
      WHERE s.user_id = ? AND (p.status = 'published' OR (p.status = 'scheduled' AND p.publish_at <= ?)) ORDER BY s.created_at DESC`).all(user.id, now());
  });
  r.put('/api/me/saved/:id', ({ user, params }) => {
    auth.require(user);
    const id = int(params.id, 'id', { min: 1, required: true });
    if (!db.prepare("SELECT 1 FROM posts WHERE id = ? AND (status = 'published' OR (status = 'scheduled' AND publish_at <= ?))").get(id, now())) throw new HttpError(404, 'Post not found.');
    db.prepare('INSERT OR IGNORE INTO saved_posts (user_id, post_id) VALUES (?, ?)').run(user.id, id);
    return withStatus(204, null);
  });
  r.del('/api/me/saved/:id', ({ user, params }) => {
    auth.require(user);
    db.prepare('DELETE FROM saved_posts WHERE user_id = ? AND post_id = ?').run(user.id, int(params.id, 'id', { min: 1, required: true }));
    return withStatus(204, null);
  });

  /* ---------- studio: courses and lessons (editors) ---------- */
  function courseFields(b, cur = {}) {
    return {
      title: b.title === undefined ? cur.title : str(b.title, 'title', { required: true, max: 160 }),
      summary: b.summary === undefined ? cur.summary || '' : str(b.summary, 'summary', { max: 1000 }),
      access: b.access === undefined ? cur.access || 'members' : oneOf(b.access, Object.keys(ACCESS), 'access'),
      status: b.status === undefined ? cur.status || 'draft' : oneOf(b.status, ['draft', 'published'], 'status'),
      cover_media_id: b.cover_media_id === undefined ? cur.cover_media_id || null : (b.cover_media_id ? str(b.cover_media_id, 'cover_media_id', { max: 40 }) : null)
    };
  }
  function studioCourse(user, id) {
    auth.require(user, 'editor');
    const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(int(id, 'id', { min: 1, required: true }));
    if (!c) throw new HttpError(404, 'Course not found.');
    return c;
  }
  function studioFull(c) {
    return { ...c, lessons: db.prepare('SELECT * FROM lessons WHERE course_id = ? ORDER BY position, id').all(c.id).map(l => ({ ...l, preview: !!l.preview })),
      media: db.prepare('SELECT id, mime FROM media WHERE course_id = ?').all(c.id) };
  }
  r.post('/api/studio/courses', ({ user, body }) => {
    auth.require(user, 'editor');
    const f = courseFields(body);
    if (!f.title) throw new HttpError(400, 'title is required.');
    const id = Number(db.prepare('INSERT INTO courses (title, slug, summary, access, status, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(f.title, slugify(f.title), f.summary, f.access, 'draft', user.id).lastInsertRowid);
    return withStatus(201, studioFull(db.prepare('SELECT * FROM courses WHERE id = ?').get(id)));
  });
  r.get('/api/studio/courses/:id', ({ user, params }) => studioFull(studioCourse(user, params.id)));
  r.put('/api/studio/courses/:id', ({ user, params, body }) => {
    const c = studioCourse(user, params.id);
    const f = courseFields(body, c);
    if (f.cover_media_id) {
      const m = db.prepare('SELECT course_id, mime FROM media WHERE id = ?').get(f.cover_media_id);
      if (!m || m.course_id !== c.id || !m.mime.startsWith('image/')) throw new HttpError(400, 'Cover must be an image uploaded to this course.');
    }
    db.prepare('UPDATE courses SET title = ?, summary = ?, access = ?, status = ?, cover_media_id = ?, updated_at = ? WHERE id = ?').run(f.title, f.summary, f.access, f.status, f.cover_media_id, now(), c.id);
    if (f.status === 'published' && c.status !== 'published' && ctx.jobsFirst && ctx.jobsFirst(`course:${c.id}`)) {
      notifier.notify(db.prepare('SELECT id FROM users').all().map(u => u.id).filter(id => id !== user.id), 'content', `New course: ${f.title}`, f.summary, `#/learn/course/${c.slug}`);
    }
    return studioFull(db.prepare('SELECT * FROM courses WHERE id = ?').get(c.id));
  });
  r.del('/api/studio/courses/:id', ({ user, params }) => {
    const c = studioCourse(user, params.id);
    db.prepare('DELETE FROM courses WHERE id = ?').run(c.id);
    return withStatus(204, null);
  });
  function lessonFields(b, cur = {}) {
    return {
      title: b.title === undefined ? cur.title : str(b.title, 'title', { required: true, max: 160 }),
      module: b.module === undefined ? cur.module || '' : str(b.module, 'module', { max: 120 }),
      body: b.body === undefined ? cur.body || '' : str(b.body, 'body', { max: 60000 }),
      minutes: b.minutes === undefined ? cur.minutes || null : int(b.minutes, 'minutes', { min: 1, max: 600 }),
      preview: b.preview === undefined ? !!cur.preview : !!b.preview,
      video_media_id: b.video_media_id === undefined ? cur.video_media_id || null : (b.video_media_id ? str(b.video_media_id, 'video_media_id', { max: 40 }) : null),
      position: b.position === undefined ? cur.position : int(b.position, 'position', { min: 0, max: 10000 })
    };
  }
  r.post('/api/studio/courses/:id/lessons', ({ user, params, body }) => {
    const c = studioCourse(user, params.id);
    const f = lessonFields(body);
    if (!f.title) throw new HttpError(400, 'title is required.');
    const pos = f.position !== undefined && f.position !== null ? f.position : (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM lessons WHERE course_id = ?').get(c.id).n);
    const id = Number(db.prepare('INSERT INTO lessons (course_id, position, module, title, body, minutes, preview) VALUES (?, ?, ?, ?, ?, ?, ?)').run(c.id, pos, f.module, f.title, f.body, f.minutes, f.preview ? 1 : 0).lastInsertRowid);
    db.prepare('UPDATE courses SET updated_at = ? WHERE id = ?').run(now(), c.id);
    return withStatus(201, db.prepare('SELECT * FROM lessons WHERE id = ?').get(id));
  });
  r.put('/api/studio/lessons/:id', ({ user, params, body }) => {
    auth.require(user, 'editor');
    const l = db.prepare('SELECT * FROM lessons WHERE id = ?').get(int(params.id, 'id', { min: 1, required: true }));
    if (!l) throw new HttpError(404, 'Lesson not found.');
    const f = lessonFields(body, l);
    if (f.video_media_id) {
      const m = db.prepare('SELECT lesson_id, mime FROM media WHERE id = ?').get(f.video_media_id);
      if (!m || m.lesson_id !== l.id || !m.mime.startsWith('video/')) throw new HttpError(400, 'Lesson video must be a video uploaded to this lesson.');
    }
    db.prepare('UPDATE lessons SET title = ?, module = ?, body = ?, minutes = ?, preview = ?, video_media_id = ?, position = ?, updated_at = ? WHERE id = ?')
      .run(f.title, f.module, f.body, f.minutes, f.preview ? 1 : 0, f.video_media_id, f.position, now(), l.id);
    return { ...db.prepare('SELECT * FROM lessons WHERE id = ?').get(l.id), media: db.prepare('SELECT id, mime FROM media WHERE lesson_id = ?').all(l.id) };
  });
  r.get('/api/studio/lessons/:id', ({ user, params }) => {
    auth.require(user, 'editor');
    const l = db.prepare('SELECT * FROM lessons WHERE id = ?').get(int(params.id, 'id', { min: 1, required: true }));
    if (!l) throw new HttpError(404, 'Lesson not found.');
    return { ...l, preview: !!l.preview, media: db.prepare('SELECT id, mime FROM media WHERE lesson_id = ?').all(l.id), course: db.prepare('SELECT id, title, slug FROM courses WHERE id = ?').get(l.course_id) };
  });
  r.del('/api/studio/lessons/:id', ({ user, params }) => {
    auth.require(user, 'editor');
    db.prepare('DELETE FROM lessons WHERE id = ?').run(int(params.id, 'id', { min: 1, required: true }));
    return withStatus(204, null);
  });

  /* ---------- admin: membership and cohorts ---------- */
  r.put('/api/admin/users/:id/membership', ({ user, params, body }) => {
    auth.require(user, 'admin');
    const id = int(params.id, 'id', { min: 1, required: true });
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw new HttpError(404, 'User not found.');
    const status = oneOf(body.status, ['active', 'cancelled', 'none'], 'status');
    if (status === 'none') { db.prepare('DELETE FROM memberships WHERE user_id = ?').run(id); return { membership: null }; }
    const plan = str(body.plan || 'member', 'plan', { max: 40 });
    const expires = isoTime(body.expires_at, 'expires_at');
    const note = str(body.note, 'note', { max: 300 });
    db.prepare(`INSERT INTO memberships (user_id, plan, status, expires_at, note, granted_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, status = excluded.status, expires_at = excluded.expires_at, note = excluded.note, granted_by = excluded.granted_by, updated_at = excluded.updated_at`)
      .run(id, plan, status, expires, note, user.id, now());
    const m = membership({ id });
    return { membership: { plan: m.plan, status: m.status, active: m.active, expires_at: m.expires_at } };
  });

  function cohortFull(id) {
    const c = db.prepare('SELECT c.*, co.title AS course_title FROM cohorts c LEFT JOIN courses co ON co.id = c.course_id WHERE c.id = ?').get(id);
    if (!c) throw new HttpError(404, 'Cohort not found.');
    c.members = db.prepare('SELECT u.id, u.name, u.email FROM cohort_members cm JOIN users u ON u.id = cm.user_id WHERE cm.cohort_id = ? ORDER BY u.name').all(id);
    return c;
  }
  const cohortStaff = user => auth.require(user, 'coach', 'editor');
  r.get('/api/cohorts', ({ user }) => {
    cohortStaff(user);
    return db.prepare(`SELECT c.*, co.title AS course_title, (SELECT COUNT(*) FROM cohort_members WHERE cohort_id = c.id) AS members
      FROM cohorts c LEFT JOIN courses co ON co.id = c.course_id ORDER BY c.created_at DESC`).all();
  });
  function cohortFields(b) {
    const courseId = b.course_id ? int(b.course_id, 'course_id', { min: 1 }) : null;
    if (courseId && !db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId)) throw new HttpError(400, 'Course not found.');
    return { title: str(b.title, 'title', { required: true, max: 120 }), course_id: courseId, starts_at: isoTime(b.starts_at, 'starts_at'), ends_at: isoTime(b.ends_at, 'ends_at') };
  }
  r.post('/api/cohorts', ({ user, body }) => {
    cohortStaff(user);
    const f = cohortFields(body);
    const id = Number(db.prepare('INSERT INTO cohorts (title, course_id, starts_at, ends_at, created_by) VALUES (?, ?, ?, ?, ?)').run(f.title, f.course_id, f.starts_at, f.ends_at, user.id).lastInsertRowid);
    return withStatus(201, cohortFull(id));
  });
  r.get('/api/cohorts/:id', ({ user, params }) => { cohortStaff(user); return cohortFull(int(params.id, 'id', { min: 1, required: true })); });
  r.put('/api/cohorts/:id', ({ user, params, body }) => {
    cohortStaff(user);
    const c = cohortFull(int(params.id, 'id', { min: 1, required: true }));
    const f = cohortFields(body);
    db.prepare('UPDATE cohorts SET title = ?, course_id = ?, starts_at = ?, ends_at = ? WHERE id = ?').run(f.title, f.course_id, f.starts_at, f.ends_at, c.id);
    return cohortFull(c.id);
  });
  r.del('/api/cohorts/:id', ({ user, params }) => { cohortStaff(user); db.prepare('DELETE FROM cohorts WHERE id = ?').run(int(params.id, 'id', { min: 1, required: true })); return withStatus(204, null); });
  r.post('/api/cohorts/:id/members', ({ user, params, body }) => {
    cohortStaff(user);
    const c = cohortFull(int(params.id, 'id', { min: 1, required: true }));
    const emails = list(body.emails, 'emails', { max: 200, item: (e, f) => str(e, f, { required: true, max: 200 }).toLowerCase() });
    const added = [], missing = [];
    emails.forEach(e => {
      const u = db.prepare('SELECT id FROM users WHERE email = ?').get(e);
      if (!u) { missing.push(e); return; }
      if (Number(db.prepare('INSERT OR IGNORE INTO cohort_members (cohort_id, user_id) VALUES (?, ?)').run(c.id, u.id).changes)) added.push(u.id);
    });
    if (added.length) notifier.notify(added, 'content', `You’ve joined ${c.title}`, c.course_title ? `Course: ${c.course_title}` : '', '#/learn/courses');
    return { ...cohortFull(c.id), added: added.length, missing };
  });
  r.del('/api/cohorts/:id/members/:uid', ({ user, params }) => {
    cohortStaff(user);
    db.prepare('DELETE FROM cohort_members WHERE cohort_id = ? AND user_id = ?').run(int(params.id, 'id', { min: 1, required: true }), int(params.uid, 'uid', { min: 1, required: true }));
    return withStatus(204, null);
  });
};
