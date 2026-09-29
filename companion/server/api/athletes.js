'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { HttpError, withStatus, str, oneOf, int, uuid, SECURITY_HEADERS } = require('../http.js');
const { claimCode, normalizeCode, sha256, limiter } = require('../auth.js');
const { tx, now } = require('../db.js');
const { athleteResults } = require('./training.js');

const HANDS = ['right', 'left'];
const SIDES = ['left', 'right', 'either'];
const MEDIA_TYPES = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm'
};
const MAX_MEDIA = 200 * 1024 * 1024;

module.exports = function athletes(r, ctx) {
  const { db, auth, config, notifier } = ctx;
  const claimLimit = limiter(8, 60 * 60 * 1000);

  function load(id) {
    const a = db.prepare('SELECT * FROM athletes WHERE id = ?').get(id);
    if (!a) throw new HttpError(404, 'Athlete not found.');
    return a;
  }
  function access(user, id) {
    auth.require(user);
    const a = load(id);
    const level = auth.athleteAccess(user, a.id);
    // Same answer for "doesn't exist" and "not yours" so IDs can't be probed.
    if (!level) throw new HttpError(404, 'Athlete not found.');
    return { a, level };
  }
  function publicAthlete(a, level) {
    const out = {
      id: a.id, name: a.name, hand: a.hand, side: a.side, rating: a.rating,
      goals: a.goals, focus: a.focus, plan: a.plan, photo_media_id: a.photo_media_id,
      claimed: !!a.user_id, updated_at: a.updated_at
    };
    if (level === 'coach') { out.claim_pending = !a.user_id && !!a.claim_code_hash; out.claim_email = a.claim_email || ''; }
    return out;
  }
  function notesFor(athleteId, level) {
    const rows = db.prepare(`SELECT n.*, u.name AS author, m.mime AS media_mime FROM notes n LEFT JOIN users u ON u.id = n.author_id LEFT JOIN media m ON m.id = n.media_id
      WHERE n.athlete_id = ? ${level === 'coach' ? '' : "AND n.visibility = 'shared'"} ORDER BY n.created_at DESC, n.id DESC LIMIT 200`).all(athleteId);
    return rows;
  }
  function mediaFor(athleteId, level) {
    return db.prepare(`SELECT id, mime, size, visibility, owner_id, created_at FROM media WHERE athlete_id = ?
      ${level === 'coach' ? '' : "AND visibility = 'shared'"} ORDER BY created_at DESC LIMIT 100`).all(athleteId);
  }
  function profile(a, level) {
    return {
      athlete: publicAthlete(a, level), access: level,
      notes: notesFor(a.id, level),
      media: mediaFor(a.id, level),
      results: athleteResults(db, a.id).slice(0, 20),
      coaches: db.prepare('SELECT u.id, u.name FROM coach_athletes c JOIN users u ON u.id = c.coach_id WHERE c.athlete_id = ?').all(a.id)
    };
  }

  function fields(body, level, current = {}) {
    const f = {
      name: body.name === undefined ? current.name : str(body.name, 'name', { required: true, max: 80 }),
      hand: body.hand === undefined || body.hand === current.hand ? current.hand || '' : oneOf(body.hand, HANDS, 'hand', { allowEmpty: true }),
      side: body.side === undefined ? current.side || '' : oneOf(body.side, SIDES, 'side', { allowEmpty: true }),
      rating: body.rating === undefined ? current.rating || '' : str(body.rating, 'rating', { max: 20 }),
      goals: body.goals === undefined ? current.goals || '' : str(body.goals, 'goals', { max: 2000 }),
      focus: current.focus || '', plan: current.plan || ''
    };
    // The coach owns focus and plan; an athlete can't rewrite their own plan.
    if (level === 'coach') {
      if (body.focus !== undefined) f.focus = str(body.focus, 'focus', { max: 500 });
      if (body.plan !== undefined) f.plan = str(body.plan, 'plan', { max: 4000 });
    }
    return f;
  }

  /* ---------- roster (coach) ---------- */
  r.get('/api/athletes', ({ user, query }) => {
    auth.require(user, 'coach');
    const q = '%' + (query.get('q') || '').trim() + '%';
    const isAdmin = user.roles.includes('admin') || user.workspace;
    const rows = db.prepare(`SELECT a.*,
        (SELECT MAX(s.started_at) FROM training_athletes ta JOIN training_sessions s ON s.id = ta.session_id WHERE ta.athlete_id = a.id) AS last_session
      FROM athletes a
      WHERE (${isAdmin ? '1' : 'EXISTS (SELECT 1 FROM coach_athletes c WHERE c.athlete_id = a.id AND c.coach_id = ?)'}) AND a.name LIKE ?
      ORDER BY a.name COLLATE NOCASE LIMIT 300`).all(...(isAdmin ? [q] : [user.id, q]));
    return rows.map(a => ({ ...publicAthlete(a, 'coach'), last_session: a.last_session }));
  });

  r.post('/api/athletes', ({ user, body }) => {
    auth.require(user, 'coach');
    const f = fields(body, 'coach');
    if (!f.name) throw new HttpError(400, 'name is required.');
    const claimEmail = body.claim_email ? str(body.claim_email, 'claim_email', { max: 200 }).toLowerCase() : null;
    const code = claimCode();
    const id = tx(db, () => {
      const id = Number(db.prepare(`INSERT INTO athletes (name, hand, side, rating, goals, focus, plan, claim_code_hash, claim_email, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.name, f.hand, f.side, f.rating, f.goals, f.focus, f.plan, sha256(normalizeCode(code)), claimEmail, user.id).lastInsertRowid);
      db.prepare('INSERT INTO coach_athletes (coach_id, athlete_id) VALUES (?, ?)').run(user.id, id);
      return id;
    });
    // The code is only ever returned here and on regenerate; only its hash is stored.
    return withStatus(201, { ...profile(load(id), 'coach'), claim_code: code });
  });

  r.get('/api/athletes/:id', async ({ user, params }) => {
    const { a, level } = access(user, int(params.id, 'id', { min: 1, required: true }));
    const out=profile(a,level);
    if(ctx.sharedProfile){try{const shared=await ctx.sharedProfile(a,a);if(shared){out.athlete={...out.athlete,...shared};out.shared_profile=true;}}catch(e){out.shared_profile_unavailable=true;}}
    return out;
  });

  r.put('/api/athletes/:id', async ({ user, params, body }) => {
    const { a, level } = access(user, int(params.id, 'id', { min: 1, required: true }));
    const currentShared=ctx.sharedProfile?await ctx.sharedProfile(a,a):null;
    const f = fields(body, level, currentShared?{...a,...currentShared}:a);
    const shared=ctx.sharedProfile?await ctx.sharedProfile(a,f,true):null;
    if(shared)Object.assign(f,shared);
    db.prepare('UPDATE athletes SET name = ?, hand = ?, side = ?, rating = ?, goals = ?, focus = ?, plan = ?, updated_at = ? WHERE id = ?')
      .run(f.name, f.hand, f.side, f.rating, f.goals, f.focus, f.plan, now(), a.id);
    return profile(load(a.id), level);
  });

  r.post('/api/athletes/:id/claim-code', ({ user, params, body }) => {
    const { a, level } = access(user, int(params.id, 'id', { min: 1, required: true }));
    if (level !== 'coach') throw new HttpError(403, 'Only the athlete’s coach can issue a claim code.');
    if (a.user_id) throw new HttpError(409, 'This profile has already been claimed.');
    const code = claimCode();
    const claimEmail = body.claim_email === undefined ? a.claim_email : (body.claim_email ? str(body.claim_email, 'claim_email', { max: 200 }).toLowerCase() : null);
    db.prepare('UPDATE athletes SET claim_code_hash = ?, claim_email = ?, claim_attempts = 0, updated_at = ? WHERE id = ?').run(sha256(normalizeCode(code)), claimEmail, now(), a.id);
    return { claim_code: code };
  });

  r.post('/api/athletes/:id/coaches', ({ user, params, body }) => {
    const { a, level } = access(user, int(params.id, 'id', { min: 1, required: true }));
    if (level !== 'coach') throw new HttpError(403, 'Only the athlete’s coach can add a coach.');
    const email = str(body.email, 'email', { required: true, max: 200 });
    const c = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!c || !auth.has(auth.userRow(c), 'coach')) throw new HttpError(404, 'No coach account with that email.');
    db.prepare('INSERT OR IGNORE INTO coach_athletes (coach_id, athlete_id) VALUES (?, ?)').run(c.id, a.id);
    return profile(load(a.id), level);
  });

  /* Athlete claims a coach-made profile. One code, one account, no duplicate record. */
  r.post('/api/claim', ({ user, body }) => {
    auth.require(user);
    if (!claimLimit('u' + user.id)) throw new HttpError(429, 'Too many attempts. Try again in an hour.');
    if (auth.ownAthleteId(user)) throw new HttpError(409, 'Your account already has an athlete profile.');
    const code = normalizeCode(body.code);
    if (code.length !== 8) throw new HttpError(400, 'Claim codes are 8 characters, like ABCD-2345.');
    const a = db.prepare('SELECT * FROM athletes WHERE claim_code_hash = ? AND user_id IS NULL').get(sha256(code));
    if (!a) throw new HttpError(400, 'That code doesn’t match a profile. Check it with your coach.');
    if (a.claim_email && a.claim_email.toLowerCase() !== user.email.toLowerCase()) {
      throw new HttpError(403, 'This profile is reserved for a different email address. Sign in with the email your coach has, or ask them to update it.');
    }
    db.prepare('UPDATE athletes SET user_id = ?, claim_code_hash = NULL, updated_at = ? WHERE id = ?').run(user.id, now(), a.id);
    return profile(load(a.id), 'self');
  });

  /* An athlete without a coach can start their own profile. */
  r.post('/api/me/athlete', ({ user, body }) => {
    auth.require(user);
    if (auth.ownAthleteId(user)) throw new HttpError(409, 'Your account already has an athlete profile.');
    const f = fields({ name: user.name, ...body }, 'self');
    const id = Number(db.prepare('INSERT INTO athletes (user_id, name, hand, side, rating, goals, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(user.id, f.name, f.hand, f.side, f.rating, f.goals, user.id).lastInsertRowid);
    return withStatus(201, profile(load(id), 'self'));
  });

  /* ---------- notes ---------- */
  r.post('/api/athletes/:id/notes', ({ user, params, body }) => {
    const { a, level } = access(user, int(params.id, 'id', { min: 1, required: true }));
    const text = str(body.body, 'body', { required: true, max: 5000 });
    const clientId = body.client_id ? uuid(body.client_id, 'client_id') : null;
    const kind = level === 'coach' && !(auth.ownAthleteId(user) === a.id) ? 'coach' : 'reflection';
    const visibility = kind === 'coach' ? oneOf(body.visibility, ['private', 'shared'], 'visibility') : 'shared';
    const mediaId = body.media_id ? str(body.media_id, 'media_id', { max: 40 }) : null;
    if (mediaId) {
      const m = db.prepare('SELECT * FROM media WHERE id = ? AND athlete_id = ?').get(mediaId, a.id);
      if (!m) throw new HttpError(400, 'Attached media must belong to this athlete.');
    }
    const sessionId = body.session_id ? uuid(body.session_id, 'session_id') : null;
    if (sessionId && !db.prepare('SELECT 1 FROM training_athletes WHERE session_id = ? AND athlete_id = ?').get(sessionId, a.id)) throw new HttpError(400, 'That session didn\u2019t include this athlete.');
    // client_id makes offline retries idempotent: the same note is never saved twice.
    if (clientId) {
      const prior = db.prepare('SELECT * FROM notes WHERE author_id = ? AND client_id = ?').get(user.id, clientId);
      if (prior) return withStatus(200, prior);
    }
    const id = Number(db.prepare('INSERT INTO notes (client_id, athlete_id, author_id, kind, visibility, body, media_id, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(clientId, a.id, user.id, kind, visibility, text, mediaId, sessionId).lastInsertRowid);
    if (mediaId && visibility === 'shared') db.prepare("UPDATE media SET visibility = 'shared' WHERE id = ?").run(mediaId);
    if (kind === 'coach' && visibility === 'shared' && a.user_id) notifier.notify([a.user_id], 'feedback', `New feedback from ${user.name}`, text.slice(0, 140), '#/profile');
    return withStatus(201, db.prepare('SELECT n.*, u.name AS author FROM notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.id = ?').get(id));
  });

  function ownNote(user, id) {
    auth.require(user);
    const n = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    if (!n || n.author_id !== user.id || !auth.athleteAccess(user, n.athlete_id)) throw new HttpError(404, 'Note not found.');
    return n;
  }
  r.put('/api/notes/:id', ({ user, params, body }) => {
    const n = ownNote(user, int(params.id, 'id', { min: 1, required: true }));
    const text = str(body.body, 'body', { required: true, max: 5000 });
    const visibility = n.kind === 'coach' ? oneOf(body.visibility === undefined ? n.visibility : body.visibility, ['private', 'shared'], 'visibility') : 'shared';
    db.prepare('UPDATE notes SET body = ?, visibility = ?, updated_at = ? WHERE id = ?').run(text, visibility, now(), n.id);
    return db.prepare('SELECT * FROM notes WHERE id = ?').get(n.id);
  });
  r.del('/api/notes/:id', ({ user, params }) => {
    const n = ownNote(user, int(params.id, 'id', { min: 1, required: true }));
    db.prepare('DELETE FROM notes WHERE id = ?').run(n.id);
    return withStatus(204, null);
  });

  /* ---------- media ---------- */
  function mediaAccess(user, m, write = false) {
    if (!m) return false;
    if (user && m.owner_id === user.id) return true;
    if (m.athlete_id) {
      const level = auth.athleteAccess(user, m.athlete_id);
      if (level === 'coach') return true;
      return !write && level === 'self' && m.visibility === 'shared';
    }
    if (m.post_id) {
      const p = db.prepare('SELECT status, publish_at, author_id FROM posts WHERE id = ?').get(m.post_id);
      if (!p) return false;
      if (auth.has(user, 'editor') || (user && p.author_id === user.id)) return true;
      const live = p.status === 'published' || (p.status === 'scheduled' && p.publish_at <= now());
      return !write && live;
    }
    // Course covers and lesson videos: gated by course access (learn.js).
    if (m.lesson_id || m.course_id) return ctx.learn ? ctx.learn.mediaAllowed(user, m, write) : false;
    return false;
  }

  /* Raw upload. X-Upload-Id (a UUID from the device) makes retries idempotent. */
  r.post('/api/media', async ({ user, req, query }) => {
    auth.require(user);
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!MEDIA_TYPES[mime]) throw new HttpError(415, 'Upload a photo (JPEG, PNG, WebP, GIF, HEIC) or video (MP4, MOV, WebM).');
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_MEDIA) throw new HttpError(413, 'Files can be up to 200 MB.');
    const id = req.headers['x-upload-id'] ? uuid(String(req.headers['x-upload-id']), 'X-Upload-Id') : crypto.randomUUID();

    const athleteId = query.get('athlete_id') ? int(query.get('athlete_id'), 'athlete_id', { min: 1 }) : null;
    const postId = query.get('post_id') ? int(query.get('post_id'), 'post_id', { min: 1 }) : null;
    const lessonId = query.get('lesson_id') ? int(query.get('lesson_id'), 'lesson_id', { min: 1 }) : null;
    const courseId = query.get('course_id') ? int(query.get('course_id'), 'course_id', { min: 1 }) : null;
    let visibility = 'private';
    if (athleteId) {
      const level = auth.athleteAccess(user, athleteId);
      if (!level) throw new HttpError(404, 'Athlete not found.');
      visibility = level === 'self' ? 'shared' : oneOf(query.get('visibility') || 'private', ['private', 'shared'], 'visibility');
    } else if (postId) {
      const p = db.prepare('SELECT author_id FROM posts WHERE id = ?').get(postId);
      if (!p || !(auth.has(user, 'editor') || (p.author_id === user.id && auth.has(user, 'contributor')))) throw new HttpError(404, 'Post not found.');
      visibility = 'public';
    } else if (lessonId || courseId) {
      if (!auth.has(user, 'editor')) throw new HttpError(403, 'Only editors can upload course media.');
      const ok = lessonId ? db.prepare('SELECT 1 FROM lessons WHERE id = ?').get(lessonId) : db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId);
      if (!ok) throw new HttpError(404, lessonId ? 'Lesson not found.' : 'Course not found.');
      visibility = 'private';
    } else {
      throw new HttpError(400, 'Attach the upload to an athlete, post, course or lesson.');
    }

    const prior = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
    if (prior) {
      if (prior.owner_id !== user.id) throw new HttpError(409, 'Upload ID already used.');
      req.resume();
      return withStatus(200, { id: prior.id, mime: prior.mime, size: prior.size, visibility: prior.visibility });
    }

    const file = id + MEDIA_TYPES[mime];
    const dest = path.join(config.mediaDir, file);
    const tmp = dest + '.part';
    const size = await new Promise((resolve, reject) => {
      let n = 0;
      const out = fs.createWriteStream(tmp);
      req.on('data', c => {
        n += c.length;
        if (n > MAX_MEDIA) { req.destroy(); out.destroy(); fs.rm(tmp, () => {}); reject(new HttpError(413, 'Files can be up to 200 MB.')); }
      });
      req.pipe(out);
      out.on('finish', () => resolve(n));
      out.on('error', reject);
      req.on('aborted', () => { out.destroy(); fs.rm(tmp, () => {}); reject(new HttpError(400, 'Upload was interrupted. Try again.')); });
    });
    if (!size) { fs.rmSync(tmp, { force: true }); throw new HttpError(400, 'The file is empty.'); }
    fs.renameSync(tmp, dest);
    db.prepare('INSERT INTO media (id, owner_id, athlete_id, post_id, lesson_id, course_id, visibility, mime, size, file) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, user.id, athleteId, postId, lessonId, courseId, visibility, mime, size, file);
    return withStatus(201, { id, mime, size, visibility });
  }, { raw: true });

  /* Download with access check and Range support (iOS video needs it). */
  r.get('/api/media/:id', ({ user, params, req, res }) => {
    const m = db.prepare('SELECT * FROM media WHERE id = ?').get(String(params.id));
    if (!mediaAccess(user, m)) throw new HttpError(404, 'Media not found.');
    const file = path.join(config.mediaDir, m.file);
    let stat;
    try { stat = fs.statSync(file); } catch { throw new HttpError(404, 'Media not found.'); }
    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': m.mime, 'Accept-Ranges': 'bytes',
      'Cache-Control': m.visibility === 'public' ? 'public, max-age=3600' : 'private, max-age=300',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline'
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      let start = range[1] === '' ? stat.size - Number(range[2]) : Number(range[1]);
      let end = range[1] === '' || range[2] === '' ? stat.size - 1 : Number(range[2]);
      if (start < 0 || start >= stat.size || end < start) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      end = Math.min(end, stat.size - 1);
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': stat.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    }
    return undefined; // response already written
  });

  r.del('/api/media/:id', ({ user, params }) => {
    auth.require(user);
    const m = db.prepare('SELECT * FROM media WHERE id = ?').get(String(params.id));
    if (!mediaAccess(user, m, true)) throw new HttpError(404, 'Media not found.');
    db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
    db.prepare('UPDATE athletes SET photo_media_id = NULL WHERE photo_media_id = ?').run(m.id);
    db.prepare('UPDATE posts SET thumbnail_media_id = NULL WHERE thumbnail_media_id = ?').run(m.id);
    config.removeFiles([m.file]);
    return withStatus(204, null);
  });

  r.put('/api/athletes/:id/photo', ({ user, params, body }) => {
    const { a, level } = access(user, int(params.id, 'id', { min: 1, required: true }));
    const mediaId = body.media_id ? str(body.media_id, 'media_id', { max: 40 }) : null;
    if (mediaId) {
      const m = db.prepare('SELECT * FROM media WHERE id = ? AND athlete_id = ?').get(mediaId, a.id);
      if (!m || !m.mime.startsWith('image/')) throw new HttpError(400, 'Profile photo must be an image uploaded to this athlete.');
      db.prepare("UPDATE media SET visibility = 'shared' WHERE id = ?").run(mediaId);
    }
    db.prepare('UPDATE athletes SET photo_media_id = ?, updated_at = ? WHERE id = ?').run(mediaId, now(), a.id);
    return profile(load(a.id), level);
  });

  return { mediaAccess };
};
