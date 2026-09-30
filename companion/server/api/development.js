'use strict';
const { HttpError, withStatus, str, oneOf, int, list } = require('../http.js');
const { tx, now } = require('../db.js');

const READS = ['height', 'time', 'balance'];
const STATES = ['defensive', 'neutral', 'offensive'];
const LAYERS = ['perception', 'read', 'state', 'need', 'decision', 'movement', 'technique', 'execution', 'recovery'];
const INTENSITIES = ['practice', 'move', 'flow', 'training', 'sparring', 'dueling', 'competition', 'dealers_choice'];
const STATUSES = ['assigned', 'in_progress', 'evidence_submitted', 'coach_review', 'ready_retest', 'mastered'];

module.exports = function development(r, { db, auth, notifier }) {
  function shape(row) {
    if (!row) return row;
    return { ...row, read_targets: JSON.parse(row.read_targets || '[]'), scramble: !!row.scramble,
      template_items: row.template_items ? JSON.parse(row.template_items) : null };
  }
  function select(where) {
    return `SELECT b.*, l.title AS lesson_title, c.title AS course_title, c.slug AS course_slug, m.mime AS evidence_mime,
      t.name AS template_name, t.items AS template_items, u.name AS coach
      FROM development_blocks b
      LEFT JOIN lessons l ON l.id = b.lesson_id LEFT JOIN courses c ON c.id = l.course_id
      LEFT JOIN media m ON m.id = b.evidence_media_id
      LEFT JOIN training_templates t ON t.id = b.template_id LEFT JOIN users u ON u.id = b.assigned_by
      ${where}`;
  }
  function block(user, id) {
    auth.require(user);
    const row = db.prepare(select('WHERE b.id = ?')).get(int(id, 'id', { min: 1, required: true }));
    const level = row && auth.athleteAccess(user, row.athlete_id);
    if (!level) throw new HttpError(404, 'Development Block not found.');
    return { row, level };
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
    return aid ? db.prepare(select("WHERE b.athlete_id = ? ORDER BY CASE b.status WHEN 'mastered' THEN 1 ELSE 0 END, b.updated_at DESC")).all(aid).map(shape) : [];
  });
  r.get('/api/athletes/:id/development-blocks', ({ user, params }) => {
    auth.require(user);
    const aid = int(params.id, 'id', { min: 1, required: true });
    if (!auth.athleteAccess(user, aid)) throw new HttpError(404, 'Athlete not found.');
    return db.prepare(select("WHERE b.athlete_id = ? ORDER BY CASE b.status WHEN 'mastered' THEN 1 ELSE 0 END, b.updated_at DESC")).all(aid).map(shape);
  });
  r.get('/api/development-blocks/:id', ({ user, params }) => shape(block(user, params.id).row));

  r.post('/api/athletes/:id/development-blocks', ({ user, params, body }) => {
    auth.require(user, 'coach');
    const aid = int(params.id, 'id', { min: 1, required: true });
    if (!auth.coachesAthlete(user, aid)) throw new HttpError(404, 'Athlete not found.');
    const title = str(body.title, 'title', { required: true, max: 120 });
    const reads = list(body.read_targets || [], 'read_targets', { max: 3, item: (x, f) => oneOf(x, READS, f) });
    const { lessonId, templateId } = references(body);
    const f = {
      problem: str(body.problem, 'problem', { max: 1000 }), start: oneOf(body.start_state || 'neutral', STATES, 'start_state'),
      desired: oneOf(body.desired_state || 'offensive', STATES, 'desired_state'), layer: oneOf(body.error_layer || 'decision', LAYERS, 'error_layer'),
      intensity: oneOf(body.intensity || 'training', INTENSITIES, 'intensity'), constraint: str(body.constraint_text, 'constraint_text', { max: 1000 }),
      expected: str(body.expected_ball, 'expected_ball', { max: 1000 }), evidence: str(body.success_evidence, 'success_evidence', { max: 1000 }),
      reflection: str(body.reflection_prompt, 'reflection_prompt', { max: 1000 }), due: due(body.due_on)
    };
    let blockId, assignmentId = null;
    tx(db, () => {
      if (templateId) assignmentId = Number(db.prepare('INSERT INTO assignments (athlete_id, template_id, title, note, due_on, assigned_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(aid, templateId, title, f.constraint, f.due, user.id).lastInsertRowid);
      blockId = Number(db.prepare(`INSERT INTO development_blocks
        (athlete_id, lesson_id, template_id, assignment_id, title, problem, read_targets, start_state, desired_state, scramble, error_layer, intensity, constraint_text, expected_ball, success_evidence, reflection_prompt, due_on, assigned_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(aid, lessonId, templateId, assignmentId, title, f.problem, JSON.stringify([...new Set(reads)]), f.start, f.desired, body.scramble ? 1 : 0,
          f.layer, f.intensity, f.constraint, f.expected, f.evidence, f.reflection, f.due, user.id).lastInsertRowid);
    });
    notifier.notify(notifier.usersOfAthletes([aid]), 'training', `New Development Block from ${user.name}: ${title}`, f.due ? `Due ${f.due}.` : 'Your learning and training are connected in one path.', `#/development/${blockId}`);
    return withStatus(201, shape(db.prepare(select('WHERE b.id = ?')).get(blockId)));
  });

  r.put('/api/development-blocks/:id', ({ user, params, body }) => {
    const { row, level } = block(user, params.id);
    const isCoach = level === 'coach';
    let status = body.status === undefined ? row.status : oneOf(body.status, STATUSES, 'status');
    if (!isCoach && !['assigned', 'in_progress', 'evidence_submitted'].includes(status)) throw new HttpError(403, 'Your coach advances review and retest stages.');
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
    if (!isCoach && status === 'assigned' && (reflection || confidence)) status = 'in_progress';
    let retestAssignmentId = row.retest_assignment_id;
    tx(db, () => {
      if (isCoach && status === 'ready_retest' && row.template_id && !retestAssignmentId) {
        retestAssignmentId = Number(db.prepare('INSERT INTO assignments (athlete_id, template_id, title, note, assigned_by) VALUES (?, ?, ?, ?, ?)')
          .run(row.athlete_id, row.template_id, `Retest · ${row.title}`, retest || row.success_evidence, user.id).lastInsertRowid);
      }
      db.prepare('UPDATE development_blocks SET athlete_reflection = ?, confidence = ?, coach_feedback = ?, retest_notes = ?, session_id = ?, evidence_media_id = ?, retest_assignment_id = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(reflection, confidence, feedback, retest, sessionId, evidenceId, retestAssignmentId, status, now(), row.id);
    });
    if (isCoach && status === 'ready_retest' && retestAssignmentId && !row.retest_assignment_id) notifier.notify(notifier.usersOfAthletes([row.athlete_id]), 'training', `Retest ready: ${row.title}`, retest || row.success_evidence, '#/train');
    if (isCoach && body.status && body.status !== row.status) notifier.notify(notifier.usersOfAthletes([row.athlete_id]), 'training', `${row.title}: ${body.status.replaceAll('_', ' ')}`, feedback, `#/development/${row.id}`);
    return shape(db.prepare(select('WHERE b.id = ?')).get(row.id));
  });
};
