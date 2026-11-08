'use strict';
const crypto = require('node:crypto');
const { HttpError, withStatus, str, oneOf, int, list, uuid } = require('../http.js');
const { tx, now } = require('../db.js');

const READS = ['height', 'time', 'balance'];
const STATES = ['defensive', 'neutral', 'offensive'];
const LAYERS = ['perception', 'read', 'state', 'need', 'decision', 'movement', 'technique', 'execution', 'recovery'];
const INTENSITIES = ['practice', 'move', 'flow', 'training', 'sparring', 'dueling', 'competition', 'dealers_choice'];
const STATUSES = ['assigned', 'in_progress', 'evidence_submitted', 'coach_review', 'ready_retest', 'mastered'];

module.exports = function development(r, ctx) {
  const { db, auth, notifier } = ctx;
  const programs=require('./programs')(r,ctx,deliverWebsite);
  function score(makes,attempts) {
    const m=int(makes,'successes',{min:0,max:10000}), a=int(attempts,'attempts',{min:1,max:10000});
    if ((m===null)!==(a===null) || (a!==null && m>a)) throw new HttpError(400,'Enter successes and attempts together. Successes cannot exceed attempts.');
    return [m,a];
  }
  function shape(row) {
    if (!row) return row;
    return { ...row, draft: !!row.draft, read_targets: JSON.parse(row.read_targets || '[]'), scramble: !!row.scramble,
      template_items: row.template_items ? JSON.parse(row.template_items) : null,
      delivery: { app: row.athlete_user_id ? 'delivered' : 'needs_connection', website: row.website_id ? (row.website_delivery_status || 'pending') : 'not_linked', website_error: row.website_delivery_error || '', website_attempts: row.website_delivery_attempts || 0 } };
  }
  function select(where) {
    return `SELECT b.*, cp.title AS program_title, (SELECT prior.coach_feedback FROM development_blocks prior WHERE prior.program_id=b.program_id AND prior.athlete_id=b.athlete_id AND prior.program_step=b.program_step-1) AS previous_feedback, l.title AS lesson_title, c.title AS course_title, c.slug AS course_slug, m.mime AS evidence_mime,
      t.name AS template_name, t.items AS template_items, u.name AS coach, a.user_id AS athlete_user_id, a.name AS athlete_name, w.website_id,
      dd.status AS website_delivery_status, dd.error AS website_delivery_error, dd.attempts AS website_delivery_attempts
      FROM development_blocks b LEFT JOIN companion_programs cp ON cp.id=b.program_id
      LEFT JOIN lessons l ON l.id = b.lesson_id LEFT JOIN courses c ON c.id = l.course_id
      LEFT JOIN media m ON m.id = b.evidence_media_id
      LEFT JOIN training_templates t ON t.id = b.template_id LEFT JOIN users u ON u.id = b.assigned_by
      JOIN athletes a ON a.id = b.athlete_id LEFT JOIN website_athlete_links w ON w.athlete_id = b.athlete_id
      LEFT JOIN development_deliveries dd ON dd.block_id = b.id AND dd.destination = 'website'
      ${where}`;
  }
  function block(user, id) {
    auth.require(user);
    const row = db.prepare(select('WHERE b.id = ?')).get(int(id, 'id', { min: 1, required: true }));
    const level = row && auth.athleteAccess(user, row.athlete_id);
    if (!level || (row.draft && level !== 'coach')) throw new HttpError(404, 'Development Block not found.');
    return { row, level };
  }
  function detail(row) {
    const checkpoints=db.prepare(`SELECT p.session_id,p.item_idx,p.cue,p.at,t.name,t.measure
      FROM program_session_results p JOIN training_items t ON t.session_id=p.session_id AND t.idx=p.item_idx
      WHERE p.block_id=? ORDER BY p.at DESC LIMIT 50`).all(row.id).map(r=>{
      const events=db.prepare('SELECT id,item_idx,athlete_id,kind,undoes,at,value FROM score_events WHERE session_id=? AND athlete_id=? AND item_idx=?').all(r.session_id,row.athlete_id,r.item_idx);
      const [totals]=require('./training').summarize([{idx:r.item_idx}],[row.athlete_id],events);
      return {...r,makes:totals.makes,attempts:totals.attempts,last:totals.last};
    });
    return { ...shape(row),checkpoints, observations:db.prepare('SELECT body,makes,attempts,at FROM play_observations WHERE block_id=? ORDER BY id DESC LIMIT 30').all(row.id), attempts: db.prepare('SELECT result,conditions,cue,confidence,media_id,at,makes,attempts,game_makes,game_attempts FROM development_attempts WHERE block_id=? ORDER BY id').all(row.id) };
  }
  function due(value) {
    if (!value) return null;
    const out = str(value, 'due_on', { max: 10 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out)) throw new HttpError(400, 'due_on must be YYYY-MM-DD.');
    return out;
  }
  function references(body) {
    const lessonId = body.lesson_id ? int(body.lesson_id, 'lesson_id', { min: 1 }) : null;
    const templateId = body.template_id ? int(body.template_id, 'template_id', { min: 1 }) : null;
    if (lessonId && !db.prepare('SELECT 1 FROM lessons WHERE id = ?').get(lessonId)) throw new HttpError(400, 'Lesson not found.');
    if (templateId && !db.prepare('SELECT 1 FROM training_templates WHERE id = ?').get(templateId)) throw new HttpError(400, 'Training template not found.');
    return { lessonId, templateId };
  }
  function deliveryPayload(row) {
    const reads = JSON.parse(row.read_targets || '[]').map(x => x.toUpperCase()).join(' · ');
    return { action: 'assign', id: crypto.randomUUID(), data: {
      athleteId: row.website_id, title: row.title,
      why: [row.problem, reads && `Read ${reads}`, `${row.start_state} to ${row.desired_state}`, `Error layer ${row.error_layer}`].filter(Boolean).join('\n'),
      practice: [row.constraint_text, row.expected_ball && `Expected ball: ${row.expected_ball}`, `Intensity: ${row.intensity}`].filter(Boolean).join('\n'),
      test: [row.success_evidence, row.reflection_prompt && `Reflection: ${row.reflection_prompt}`].filter(Boolean).join('\n'),
      due: row.due_on || '', resource: ''
    }};
  }
  async function deliverWebsite(user, blockId) {
    const row = db.prepare(select('WHERE b.id = ?')).get(blockId);
    if (!row || !row.website_id) return row;
    const payload = deliveryPayload(row);
    const prior = db.prepare("SELECT payload FROM development_deliveries WHERE block_id=? AND destination='website'").get(blockId);
    if (prior) try { const saved = JSON.parse(prior.payload); if (saved.id) payload.id = saved.id; } catch {}
    db.prepare(`INSERT INTO development_deliveries(block_id,destination,status,payload,attempts,last_attempt_at) VALUES (?,'website','pending',?,1,?)
      ON CONFLICT(block_id,destination) DO UPDATE SET status='pending',payload=excluded.payload,error='',attempts=development_deliveries.attempts+1,last_attempt_at=excluded.last_attempt_at`).run(blockId, JSON.stringify(payload), now());
    try {
      if (!ctx.websiteWorkspace) throw new Error('Website workspace is not connected.');
      await ctx.websiteWorkspace(user, payload);
      db.prepare("UPDATE development_deliveries SET status='delivered',error='',delivered_at=? WHERE block_id=? AND destination='website'").run(now(), blockId);
    } catch (e) {
      db.prepare("UPDATE development_deliveries SET status='failed',error=? WHERE block_id=? AND destination='website'").run(String(e.message || 'Delivery failed.').slice(0, 500), blockId);
    }
    return db.prepare(select('WHERE b.id = ?')).get(blockId);
  }
  function libraryShape(row) {
    if (!row) return row;
    return { ...row, read_targets: JSON.parse(row.read_targets || '[]'), scramble: !!row.scramble };
  }
  function libraryFields(body, current = {}) {
    const reads = body.read_targets === undefined ? JSON.parse(current.read_targets || '[]') : list(body.read_targets, 'read_targets', { max: 3, item: (x, f) => oneOf(x, READS, f) });
    const refs = body.lesson_id === undefined && body.template_id === undefined
      ? { lessonId: current.lesson_id || null, templateId: current.template_id || null } : references(body);
    return {
      name: body.name === undefined ? current.name : str(body.name, 'name', { required: true, max: 120 }),
      title: body.title === undefined ? current.title : str(body.title, 'title', { required: true, max: 120 }),
      problem: body.problem === undefined ? current.problem || '' : str(body.problem, 'problem', { max: 1000 }),
      reads: [...new Set(reads)], start: body.start_state === undefined ? current.start_state || 'neutral' : oneOf(body.start_state, STATES, 'start_state'),
      desired: body.desired_state === undefined ? current.desired_state || 'offensive' : oneOf(body.desired_state, STATES, 'desired_state'),
      scramble: body.scramble === undefined ? !!current.scramble : !!body.scramble,
      layer: body.error_layer === undefined ? current.error_layer || 'decision' : oneOf(body.error_layer, LAYERS, 'error_layer'),
      intensity: body.intensity === undefined ? current.intensity || 'training' : oneOf(body.intensity, INTENSITIES, 'intensity'),
      constraint: body.constraint_text === undefined ? current.constraint_text || '' : str(body.constraint_text, 'constraint_text', { max: 1000 }),
      expected: body.expected_ball === undefined ? current.expected_ball || '' : str(body.expected_ball, 'expected_ball', { max: 1000 }),
      evidence: body.success_evidence === undefined ? current.success_evidence || '' : str(body.success_evidence, 'success_evidence', { max: 1000 }),
      reflection: body.reflection_prompt === undefined ? current.reflection_prompt || '' : str(body.reflection_prompt, 'reflection_prompt', { max: 1000 }),
      lessonId: refs.lessonId, templateId: refs.templateId
    };
  }

  r.get('/api/development-library', ({ user }) => {
    auth.require(user, 'coach');
    return db.prepare(`SELECT d.*, l.title AS lesson_title, t.name AS template_name, u.name AS coach
      FROM development_library d LEFT JOIN lessons l ON l.id = d.lesson_id LEFT JOIN training_templates t ON t.id = d.template_id
      LEFT JOIN users u ON u.id = d.created_by ORDER BY d.updated_at DESC`).all().map(libraryShape);
  });
  r.post('/api/development-library', ({ user, body }) => {
    auth.require(user, 'coach');
    const f = libraryFields(body);
    const id = Number(db.prepare(`INSERT INTO development_library
      (name,title,problem,read_targets,start_state,desired_state,scramble,error_layer,intensity,constraint_text,expected_ball,success_evidence,reflection_prompt,lesson_id,template_id,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(f.name, f.title, f.problem, JSON.stringify(f.reads), f.start, f.desired, f.scramble ? 1 : 0, f.layer, f.intensity, f.constraint, f.expected, f.evidence, f.reflection, f.lessonId, f.templateId, user.id).lastInsertRowid);
    return withStatus(201, libraryShape(db.prepare('SELECT * FROM development_library WHERE id = ?').get(id)));
  });
  r.del('/api/development-library/:id', ({ user, params }) => {
    auth.require(user, 'coach');
    const id = int(params.id, 'id', { min: 1, required: true });
    const row = db.prepare('SELECT created_by FROM development_library WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Library pathway not found.');
    if (row.created_by !== user.id && !auth.has(user, 'admin')) throw new HttpError(403, 'Only its creator or an admin can remove this pathway.');
    db.prepare('DELETE FROM development_library WHERE id = ?').run(id);
    return withStatus(204, null);
  });

  r.get('/api/me/development-blocks', ({ user }) => {
    auth.require(user);
    const aid = auth.ownAthleteId(user);
    return aid ? db.prepare(select("WHERE b.athlete_id = ? AND b.draft = 0 ORDER BY CASE b.status WHEN 'mastered' THEN 1 ELSE 0 END, b.updated_at DESC")).all(aid).map(shape).map(b => { delete b.coach_context; delete b.capture_id; return b; }) : [];
  });
  r.get('/api/athletes/:id/development-blocks', ({ user, params }) => {
    auth.require(user);
    const aid = int(params.id, 'id', { min: 1, required: true });
    const level = auth.athleteAccess(user, aid);
    if (!level) throw new HttpError(404, 'Athlete not found.');
    return db.prepare(select("WHERE b.athlete_id = ? " + (level === 'coach' ? '' : 'AND b.draft = 0 ') + "ORDER BY CASE b.status WHEN 'mastered' THEN 1 ELSE 0 END, b.updated_at DESC")).all(aid).map(shape);
  });
  r.get('/api/development-blocks/:id', ({ user, params }) => { const { row, level } = block(user, params.id); const d = detail(row); if (level !== 'coach') { delete d.coach_context; delete d.capture_id; } return d; });

  r.post('/api/athletes/:id/development-blocks', async ({ user, params, body }) => {
    auth.require(user, 'coach');
    const aid = int(params.id, 'id', { min: 1, required: true });
    if (!auth.coachesAthlete(user, aid)) throw new HttpError(404, 'Athlete not found.');
    const source = body.source_session_id ? uuid(body.source_session_id, 'source_session_id') : null;
    const key = body.client_key ? uuid(body.client_key, 'client_key') : null;
    if (source) {
      const session = db.prepare('SELECT s.coach_id,s.status FROM training_sessions s JOIN training_athletes ta ON s.id=ta.session_id WHERE s.id=? AND ta.athlete_id=?').get(source, aid);
      if (!session || (session.coach_id !== user.id && !auth.has(user, 'admin'))) throw new HttpError(404, 'Session not found.');
      if (session.status !== 'complete') throw new HttpError(409, 'Finish the session before assigning its closeout.');
    }
    const prior = db.prepare(select('WHERE b.athlete_id=? AND ((b.assigned_by=? AND b.client_key=?) OR b.source_session_id=?)')).get(aid, user.id, key, source);
    if (prior) return shape(prior);
    const conditions = str(body.baseline_conditions, 'test conditions', { max: 600 });
    const minutes = int(body.practice_minutes, 'minutes', { min: 1, max: 480 });
    const title = str(body.title, 'title', { required: true, max: 120 });
    const reads = list(body.read_targets || [], 'read_targets', { max: 3, item: (x, f) => oneOf(x, READS, f) });
    const { lessonId, templateId } = references(body);
    const f = {
      problem: str(body.problem, 'problem', { max: 1000 }), start: oneOf(body.start_state || 'neutral', STATES, 'start_state'),
      desired: oneOf(body.desired_state || 'offensive', STATES, 'desired_state'), layer: oneOf(body.error_layer || 'decision', LAYERS, 'error_layer'),
      intensity: oneOf(body.intensity || 'training', INTENSITIES, 'intensity'), constraint: str(body.constraint_text, 'constraint_text', { max: 1000 }),
      expected: str(body.expected_ball, 'expected_ball', { max: 1000 }), evidence: str(body.success_evidence, 'success_evidence', { max: 1000 }),
      reflection: str(body.reflection_prompt, 'reflection_prompt', { max: 1000 }), due: due(body.due_on),
      reason: str(body.reason, 'reason', { max: 2000 }), resource: str(body.resource_url, 'resource_url', { max: 500 }), context: str(body.coach_context, 'coach_context', { max: 4000 })
    };
    if (f.resource && !/^https?:\/\//i.test(f.resource)) throw new HttpError(400, 'Resource must be a full link starting with http:// or https://.');
    const draft = body.draft === true || body.draft === 1 || body.draft === 'true';
    let captureId = null;
    if (body.capture_id) {
      const cap = db.prepare('SELECT c.id, c.coach_id FROM captures c WHERE c.id=?').get(String(body.capture_id));
      if (!cap || (cap.coach_id !== user.id && !auth.has(user, 'admin'))) throw new HttpError(404, 'Capture not found.');
      if (!db.prepare('SELECT 1 FROM capture_players WHERE capture_id=? AND athlete_id=?').get(cap.id, aid)) throw new HttpError(400, 'That capture does not include this athlete.');
      captureId = cap.id;
    }
    let blockId, assignmentId = null;
    tx(db, () => {
      if (templateId) assignmentId = Number(db.prepare('INSERT INTO assignments (athlete_id, template_id, title, note, due_on, assigned_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(aid, templateId, title, f.constraint, f.due, user.id).lastInsertRowid);
      blockId = Number(db.prepare(`INSERT INTO development_blocks
        (athlete_id, lesson_id, template_id, assignment_id, title, problem, read_targets, start_state, desired_state, scramble, error_layer, intensity, constraint_text, expected_ball, success_evidence, reflection_prompt, due_on, assigned_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(aid, lessonId, templateId, assignmentId, title, f.problem, JSON.stringify([...new Set(reads)]), f.start, f.desired, body.scramble ? 1 : 0,
          f.layer, f.intensity, f.constraint, f.expected, f.evidence, f.reflection, f.due, user.id).lastInsertRowid);
      db.prepare('UPDATE development_blocks SET baseline_conditions=?,practice_minutes=?,review_required=?,client_key=?,source_session_id=?,reason=?,resource_url=?,coach_context=?,capture_id=?,draft=?,shared_at=? WHERE id=?')
        .run(conditions, minutes, body.review_required === false ? 0 : 1, key, source, f.reason, f.resource, f.context, captureId, draft ? 1 : 0, draft ? null : now(), blockId);
    });
    if (draft) return withStatus(201, shape(db.prepare(select('WHERE b.id = ?')).get(blockId)));
    notifier.notify(notifier.usersOfAthletes([aid]), 'training', `New Development Block from ${user.name}: ${title}`, f.due ? `Due ${f.due}.` : 'Your learning and training are connected in one path.', `#/development/${blockId}`);
    await deliverWebsite(user, blockId);
    return withStatus(201, shape(db.prepare(select('WHERE b.id = ?')).get(blockId)));
  });

  // Approve and share a draft: the athlete is notified now, not when the draft was written.
  r.post('/api/development-blocks/:id/approve', async ({ user, params, body }) => {
    const { row, level } = block(user, params.id);
    if (level !== 'coach') throw new HttpError(403, 'Only a coach can approve a practice.');
    if (body && body.expected_updated_at && row.updated_at !== body.expected_updated_at) throw new HttpError(409, 'This practice changed since you opened it. Reload and approve again.');
    if (!row.draft) return detail(row);
    if (!String(row.constraint_text || '').trim()) throw new HttpError(400, 'Write the practice before sharing it.');
    db.prepare("UPDATE development_blocks SET draft=0, shared_at=?, status='assigned', updated_at=? WHERE id=?").run(now(), now(), row.id);
    notifier.notify(notifier.usersOfAthletes([row.athlete_id]), 'training', `New practice from ${user.name}: ${row.title}`, row.due_on ? `Review by ${row.due_on}.` : 'Open it to see the focus, the practice and what to notice.', '#/development/' + row.id);
    await deliverWebsite(user, row.id);
    return detail(db.prepare(select('WHERE b.id = ?')).get(row.id));
  });
  // Edit the practice text (coach). Allowed while draft or shared; athlete-facing text only.
  r.put('/api/development-blocks/:id/practice', ({ user, params, body }) => {
    const { row, level } = block(user, params.id);
    if (level !== 'coach') throw new HttpError(403, 'Only a coach can edit a practice.');
    if (body.expected_updated_at && row.updated_at !== body.expected_updated_at) throw new HttpError(409, 'This practice changed since you opened it. Reload and make your edit again.');
    const f = {};
    if (body.title !== undefined) f.title = str(body.title, 'title', { required: true, max: 120 });
    if (body.reason !== undefined) f.reason = str(body.reason, 'reason', { max: 2000 });
    if (body.constraint_text !== undefined) f.constraint_text = str(body.constraint_text, 'constraint_text', { max: 1000 });
    if (body.success_evidence !== undefined) f.success_evidence = str(body.success_evidence, 'success_evidence', { max: 1000 });
    if (body.due_on !== undefined) f.due_on = due(body.due_on);
    if (body.resource_url !== undefined) { f.resource_url = str(body.resource_url, 'resource_url', { max: 500 }); if (f.resource_url && !/^https?:\/\//i.test(f.resource_url)) throw new HttpError(400, 'Resource must be a full link starting with http:// or https://.'); }
    if (body.coach_context !== undefined) f.coach_context = str(body.coach_context, 'coach_context', { max: 4000 });
    if (body.read_targets !== undefined) f.read_targets = JSON.stringify([...new Set(list(body.read_targets, 'read_targets', { max: 3, item: (x, ff) => oneOf(x, READS, ff) }))]);
    const keys = Object.keys(f);
    if (keys.length) db.prepare('UPDATE development_blocks SET ' + keys.map(k => k + '=?').join(',') + ', updated_at=? WHERE id=?').run(...keys.map(k => f[k]), now(), row.id);
    return detail(db.prepare(select('WHERE b.id = ?')).get(row.id));
  });

  r.post('/api/development-blocks/:id/deliver', async ({ user, params }) => {
    auth.require(user, 'coach');
    const { row, level } = block(user, params.id);
    if (level !== 'coach') throw new HttpError(403, 'Only a coach can resend this assignment.');
    if (!row.website_id) throw new HttpError(409, 'This athlete does not have a connected website profile.');
    await deliverWebsite(user, row.id);
    return shape(db.prepare(select('WHERE b.id = ?')).get(row.id));
  });

  r.post('/api/development-blocks/:id/observations',({user,params,body})=>{
    const {row}=block(user,params.id);
    if(auth.ownAthleteId(user)!==row.athlete_id)throw new HttpError(403,'Only this athlete can add a match observation.');
    const key=uuid(body.client_key,'client_key'),note=str(body.body,'observation',{required:true,max:1000});
    const [m,a]=score(body.makes,body.attempts);
    const saved=db.prepare('INSERT INTO play_observations(block_id,client_key,body,makes,attempts,at) VALUES(?,?,?,?,?,?) ON CONFLICT(block_id,client_key) DO NOTHING').run(row.id,key,note,m,a,now());
    if(saved.changes && row.assigned_by)notifier.notify([row.assigned_by],'feedback','Match observation · '+row.title,note.slice(0,200),'#/development/'+row.id);
    return detail(row);
  });
  r.put('/api/development-blocks/:id', async ({ user, params, body }) => {
    const { row, level } = block(user, params.id);
    const isCoach = level === 'coach';
    if (isCoach && ((body.expected_status && row.status !== body.expected_status) || (body.expected_updated_at && row.updated_at !== body.expected_updated_at))) throw new HttpError(409, 'This practice changed. Reopen it before saving your decision.');
    let status = body.status === undefined ? row.status : oneOf(body.status, STATUSES, 'status');
    const submitting = !isCoach && body.status === 'evidence_submitted';
    const key = submitting && body.attempt_id ? uuid(body.attempt_id, 'attempt_id') : null;
    if (key && db.prepare('SELECT 1 FROM development_attempts WHERE block_id=? AND request_key=?').get(row.id, key)) return detail(row);
    if (!isCoach && ['mastered','evidence_submitted','coach_review'].includes(row.status)) throw new HttpError(409, 'This result is saved. Your coach can open a new attempt.');
    if (!isCoach && !['assigned', 'in_progress', 'evidence_submitted'].includes(status)) throw new HttpError(403, 'Your coach advances review and retest stages.');
    if (row.program_id && row.status==='mastered' && status!=='mastered') throw new HttpError(409,'This program week has already closed.');
    const [makes,attempts]=score(body.makes,body.attempts),[gameMakes,gameAttempts]=score(body.game_makes,body.game_attempts);
    let nextWeek;
    const reflection = body.athlete_reflection === undefined ? row.athlete_reflection : str(body.athlete_reflection, 'athlete_reflection', { max: 4000 });
    const confidence = body.confidence === undefined || body.confidence === null || body.confidence === '' ? row.confidence : int(body.confidence, 'confidence', { min: 1, max: 5 });
    const feedback = body.coach_feedback === undefined || !isCoach ? row.coach_feedback : str(body.coach_feedback, 'coach_feedback', { max: 4000 });
    const retest = body.retest_notes === undefined || !isCoach ? row.retest_notes : str(body.retest_notes, 'retest_notes', { max: 4000 });
    const sessionId = body.session_id === undefined || !isCoach ? row.session_id : (str(body.session_id, 'session_id', { max: 36 }) || null);
    let evidenceId = row.evidence_media_id;
    if (body.evidence_media_id !== undefined) {
      evidenceId = body.evidence_media_id ? str(body.evidence_media_id, 'evidence_media_id', { max: 36 }) : null;
      if (evidenceId) {
        const media = db.prepare('SELECT athlete_id FROM media WHERE id = ?').get(evidenceId);
        if (!media || media.athlete_id !== row.athlete_id) throw new HttpError(400, 'Evidence must be uploaded to this athlete.');
      }
    }
    const conditions = submitting ? str(body.conditions, 'test conditions', { max: 600 }) : '';
    if (submitting && !str(body.athlete_reflection, 'result', {max:4000}) && !body.evidence_media_id && attempts===null && gameAttempts===null) throw new HttpError(400, 'Enter your result or attach evidence.');
    if (submitting && !row.review_required) status = 'mastered';
    if (!isCoach && status === 'assigned' && (reflection || confidence)) status = 'in_progress';
    let retestAssignmentId = row.retest_assignment_id;
    tx(db, () => {
      if (submitting) {
        db.prepare('INSERT INTO development_attempts(block_id,request_key,result,conditions,cue,confidence,media_id,at,makes,attempts,game_makes,game_attempts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(row.id, key || crypto.randomUUID(), str(body.athlete_reflection,'result',{max:4000}), conditions, row.retest_notes || row.coach_feedback || row.constraint_text, confidence, evidenceId, now(),makes,attempts,gameMakes,gameAttempts);
      }
      if (isCoach && status === 'ready_retest' && row.template_id && (!retestAssignmentId || (row.retest_session_id && row.status !== 'ready_retest'))) {
        retestAssignmentId = Number(db.prepare('INSERT INTO assignments (athlete_id, template_id, title, note, assigned_by) VALUES (?, ?, ?, ?, ?)')
          .run(row.athlete_id, row.template_id, `Retest · ${row.title}`, retest || row.success_evidence, user.id).lastInsertRowid);
        db.prepare('UPDATE development_blocks SET retest_session_id=NULL WHERE id=?').run(row.id);
      }
      db.prepare('UPDATE development_blocks SET athlete_reflection = ?, confidence = ?, coach_feedback = ?, retest_notes = ?, session_id = ?, evidence_media_id = ?, retest_assignment_id = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(reflection, confidence, feedback, retest, sessionId, evidenceId, retestAssignmentId, status, now(), row.id);
      if(status==='mastered' && row.status!=='mastered') nextWeek=programs.advance(row);
    });
    if(nextWeek) await programs.announce(user,nextWeek);
    if (isCoach && status === 'ready_retest' && retestAssignmentId && !row.retest_assignment_id) notifier.notify(notifier.usersOfAthletes([row.athlete_id]), 'training', `Retest ready: ${row.title}`, retest || row.success_evidence, '#/train');
    if (isCoach && body.status && body.status !== row.status) notifier.notify(notifier.usersOfAthletes([row.athlete_id]), 'training', `${row.title}: ${body.status.replaceAll('_', ' ')}`, feedback, `#/development/${row.id}`);
    return detail(db.prepare(select('WHERE b.id = ?')).get(row.id));
  });
};
