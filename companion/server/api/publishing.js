'use strict';
const crypto = require('node:crypto');
const { HttpError, withStatus, str, oneOf, int, isoTime, list } = require('../http.js');
const { tx, now } = require('../db.js');

const LANES = { quick_read: 'Quick Read', the_work: 'The Work', field_study: 'Field Study' };
const EDITABLE = ['lane', 'title', 'summary', 'body', 'tags', 'author_credit', 'thumbnail_media_id'];

/* A scheduled post whose time has come is published; readers never need a cron job. */
function effectiveStatus(p, at = now()) {
  return p.status === 'scheduled' && p.publish_at && p.publish_at <= at ? 'published' : p.status;
}
function shape(p) {
  if (!p) return p;
  return { ...p, tags: JSON.parse(p.tags), status: effectiveStatus(p), lane_name: LANES[p.lane] };
}
function slugify(title) {
  const base = title.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 70) || 'post';
  return base + '-' + crypto.randomBytes(3).toString('hex');
}

module.exports = function publishing(r, { db, auth, notifier }) {
  const LIVE = `(p.status = 'published' OR (p.status = 'scheduled' AND p.publish_at <= ?))`;

  function canEdit(user, p) {
    if (auth.has(user, 'editor')) return true;
    // Contributors edit their own work until it's live; published edits go through an editor.
    return auth.has(user, 'contributor') && p.author_id === user.id && ['draft', 'in_review'].includes(effectiveStatus(p));
  }
  function load(user, id) {
    auth.require(user, 'contributor', 'editor');
    const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    if (!p || !(auth.has(user, 'editor') || p.author_id === user.id)) throw new HttpError(404, 'Post not found.');
    return p;
  }
  function revise(p, editorId, status) {
    db.prepare('INSERT INTO post_revisions (post_id, version, editor_id, status, snapshot) VALUES (?, ?, ?, ?, ?)')
      .run(p.id, p.version, editorId, status, JSON.stringify(Object.fromEntries(EDITABLE.map(k => [k, p[k]]))));
  }
  function fields(body, cur = {}) {
    const f = {};
    f.lane = body.lane === undefined ? cur.lane || 'quick_read' : oneOf(body.lane, Object.keys(LANES), 'lane');
    f.title = body.title === undefined ? cur.title : str(body.title, 'title', { required: true, max: 160 });
    f.summary = body.summary === undefined ? cur.summary || '' : str(body.summary, 'summary', { max: 400 });
    f.body = body.body === undefined ? cur.body || '' : str(body.body, 'body', { max: 60000 });
    f.tags = body.tags === undefined ? cur.tags || '[]' : JSON.stringify([...new Set(list(body.tags, 'tags', { max: 12, item: (t, x) => str(t, x, { required: true, max: 30 }).toLowerCase() }))]);
    f.author_credit = body.author_credit === undefined ? cur.author_credit || '' : str(body.author_credit, 'author_credit', { max: 120 });
    f.thumbnail_media_id = body.thumbnail_media_id === undefined ? cur.thumbnail_media_id || null : (body.thumbnail_media_id ? str(body.thumbnail_media_id, 'thumbnail_media_id', { max: 40 }) : null);
    return f;
  }
  function checkThumb(f, postId) {
    if (!f.thumbnail_media_id) return;
    const m = db.prepare('SELECT post_id, mime FROM media WHERE id = ?').get(f.thumbnail_media_id);
    if (!m || m.post_id !== postId || !m.mime.startsWith('image/')) throw new HttpError(400, 'Thumbnail must be an image uploaded to this post.');
  }
  function full(id) {
    const p = shape(db.prepare('SELECT p.*, u.name AS author_name FROM posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.id = ?').get(id));
    p.media = db.prepare('SELECT id, mime, size FROM media WHERE post_id = ? ORDER BY created_at').all(id);
    return p;
  }

  /* ---------- studio ---------- */
  r.get('/api/studio/posts', ({ user, query }) => {
    auth.require(user, 'contributor', 'editor');
    const all = auth.has(user, 'editor');
    const rows = db.prepare(`SELECT p.id, p.lane, p.title, p.slug, p.status, p.publish_at, p.published_at, p.updated_at, p.version, p.author_id, p.review_note, p.thumbnail_media_id, p.tags, u.name AS author_name
      FROM posts p LEFT JOIN users u ON u.id = p.author_id ${all ? '' : 'WHERE p.author_id = ?'} ORDER BY p.updated_at DESC LIMIT 300`).all(...(all ? [] : [user.id]));
    const status = query.get('status');
    return rows.map(shape).filter(p => !status || p.status === status);
  });

  r.post('/api/studio/posts', ({ user, body }) => {
    auth.require(user, 'contributor', 'editor');
    const f = fields(body);
    if (!f.title) throw new HttpError(400, 'title is required.');
    const id = Number(db.prepare(`INSERT INTO posts (lane, title, slug, summary, body, tags, author_credit, author_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(f.lane, f.title, slugify(f.title), f.summary, f.body, f.tags, f.author_credit || user.name, user.id).lastInsertRowid);
    return withStatus(201, full(id));
  });

  r.get('/api/studio/posts/:id', ({ user, params }) => full(load(user, int(params.id, 'id', { min: 1, required: true })).id));

  /* Save. `version` must match, so two people editing never silently overwrite each other. */
  r.put('/api/studio/posts/:id', ({ user, params, body }) => {
    const p = load(user, int(params.id, 'id', { min: 1, required: true }));
    if (!canEdit(user, p)) throw new HttpError(403, effectiveStatus(p) === 'published' ? 'This post is live. An editor can change it.' : 'You can’t edit this post.');
    const version = int(body.version, 'version', { min: 1, required: true });
    if (version !== p.version) throw new HttpError(409, 'This post changed since you opened it. Your text is kept on this device; review the latest version.', { current: full(p.id) });
    const f = fields(body, p);
    checkThumb(f, p.id);
    tx(db, () => {
      revise(p, user.id, effectiveStatus(p));
      db.prepare(`UPDATE posts SET lane = ?, title = ?, summary = ?, body = ?, tags = ?, author_credit = ?, thumbnail_media_id = ?,
        version = version + 1, updated_at = ? WHERE id = ?`).run(f.lane, f.title, f.summary, f.body, f.tags, f.author_credit, f.thumbnail_media_id, now(), p.id);
    });
    return full(p.id);
  });

  function transition(user, id, allowed, next, extra = {}) {
    const p = load(user, id);
    const cur = effectiveStatus(p);
    if (!allowed.includes(cur)) throw new HttpError(409, `A ${cur.replace('_', ' ')} post can’t be moved to ${next.replace('_', ' ')}.`);
    tx(db, () => {
      revise(p, user.id, cur);
      db.prepare(`UPDATE posts SET status = ?, publish_at = ?, published_at = ?, review_note = ?, version = version + 1, updated_at = ? WHERE id = ?`)
        .run(next, extra.publish_at !== undefined ? extra.publish_at : p.publish_at,
          extra.published_at !== undefined ? extra.published_at : p.published_at,
          extra.review_note !== undefined ? extra.review_note : p.review_note, now(), p.id);
    });
    return full(p.id);
  }

  r.post('/api/studio/posts/:id/submit', ({ user, params }) => {
    const id = int(params.id, 'id', { min: 1, required: true });
    const p = load(user, id);
    if (p.author_id !== user.id && !auth.has(user, 'editor')) throw new HttpError(403, 'Only the author can submit this post.');
    return transition(user, id, ['draft'], 'in_review', { review_note: '' });
  });
  r.post('/api/studio/posts/:id/return', ({ user, params, body }) => {
    auth.require(user, 'editor');
    return transition(user, int(params.id, 'id', { min: 1, required: true }), ['in_review'], 'draft', { review_note: str(body.note, 'note', { max: 1000 }) });
  });
  r.post('/api/studio/posts/:id/publish', ({ user, params, body }) => {
    auth.require(user, 'editor');
    const id = int(params.id, 'id', { min: 1, required: true });
    const at = isoTime(body.publish_at, 'publish_at');
    const t = now();
    if (at && at > t) return transition(user, id, ['draft', 'in_review', 'scheduled'], 'scheduled', { publish_at: at, published_at: null });
    const wasLive = !!db.prepare('SELECT published_at FROM posts WHERE id = ?').get(id).published_at;
    const out = transition(user, id, ['draft', 'in_review', 'scheduled'], 'published', { publish_at: t, published_at: t });
    // Tell members about new posts (not re-publishes). Scheduled posts go out without a ping.
    if (!wasLive) notifier.notify(db.prepare('SELECT id FROM users').all().map(u => u.id).filter(uid => uid !== user.id), 'content', `New in ${LANES[out.lane]}: ${out.title}`, out.summary || '', `#/learn/${out.slug}`);
    return out;
  });
  r.post('/api/studio/posts/:id/unpublish', ({ user, params }) => {
    auth.require(user, 'editor');
    return transition(user, int(params.id, 'id', { min: 1, required: true }), ['published', 'scheduled'], 'draft', { publish_at: null });
  });
  r.get('/api/studio/posts/:id/revisions', ({ user, params }) => {
    const p = load(user, int(params.id, 'id', { min: 1, required: true }));
    return db.prepare(`SELECT r.id, r.version, r.status, r.created_at, u.name AS editor FROM post_revisions r LEFT JOIN users u ON u.id = r.editor_id
      WHERE r.post_id = ? ORDER BY r.id DESC LIMIT 100`).all(p.id);
  });
  r.del('/api/studio/posts/:id', ({ user, params }) => {
    const p = load(user, int(params.id, 'id', { min: 1, required: true }));
    if (!auth.has(user, 'editor') && (p.author_id !== user.id || p.published_at)) throw new HttpError(403, 'Only an editor can delete a post that has been published.');
    db.prepare('DELETE FROM posts WHERE id = ?').run(p.id);
    return withStatus(204, null);
  });

  /* ---------- public feed: what the website and the Learn tab read ---------- */
  r.get('/api/posts', ({ query }) => {
    const lane = query.get('lane');
    const tag = (query.get('tag') || '').toLowerCase();
    const limit = int(query.get('limit'), 'limit', { min: 1, max: 100 }) || 30;
    const rows = db.prepare(`SELECT p.id, p.lane, p.title, p.slug, p.summary, p.tags, p.author_credit, p.thumbnail_media_id, p.status, p.publish_at,
        COALESCE(p.published_at, p.publish_at) AS published_at, p.updated_at
      FROM posts p WHERE ${LIVE} ${lane ? 'AND p.lane = ?' : ''} ORDER BY COALESCE(p.published_at, p.publish_at) DESC LIMIT ?`)
      .all(...[now(), ...(lane ? [oneOf(lane, Object.keys(LANES), 'lane')] : []), limit * 3]);
    return rows.map(shape).filter(p => !tag || p.tags.includes(tag)).slice(0, limit);
  });
  r.get('/api/posts/:slug', ({ params }) => {
    const p = db.prepare(`SELECT p.*, COALESCE(p.published_at, p.publish_at) AS published_at FROM posts p WHERE p.slug = ? AND ${LIVE}`).get(String(params.slug), now());
    if (!p) throw new HttpError(404, 'Post not found.');
    const out = shape(p);
    out.media = db.prepare('SELECT id, mime FROM media WHERE post_id = ? ORDER BY created_at').all(p.id);
    delete out.review_note; delete out.author_id; delete out.version;
    return out;
  });
};
module.exports.LANES = LANES;
