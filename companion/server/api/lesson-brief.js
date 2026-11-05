'use strict';
const {HttpError}=require('../http');
const {shared}=require('../../web/lab-needs');

function lessonBrief(db,auth,user,id) {
  const plan=db.prepare('SELECT id,title,status,owner_id,starts_at,location,version FROM plans WHERE id=?').get(id);
  if(!plan || (plan.owner_id!==user.id && !auth.has(user,'admin')))throw new HttpError(404,'Lesson plan not found.');
  const session=db.prepare('SELECT id,status FROM training_sessions WHERE source_plan_id=?').get(id);
  const blocks=db.prepare('SELECT id,ord,drill,instructions,court FROM plan_blocks WHERE plan_id=? ORDER BY ord').all(id);
  const players=db.prepare(`SELECT pp.athlete_id AS id,pp.name,pp.rsvp,pp.court,pp.recap_cue,a.focus,a.training_needs
    FROM plan_players pp LEFT JOIN athletes a ON a.id=pp.athlete_id WHERE pp.plan_id=? ORDER BY pp.id`).all(id)
    .map(p=>{
      const eligible=Boolean(p.id && auth.coachesAthlete(user,p.id));
      if(!eligible) return {name:p.name,rsvp:p.rsvp,eligible:false};
      const previous=db.prepare(`SELECT b.title,b.constraint_text,b.retest_notes,b.coach_feedback,b.athlete_reflection,
        (SELECT trim(COALESCE(CASE WHEN attempts IS NOT NULL THEN makes || '/' || attempts || ' drill' END,'') || ' ' ||
        COALESCE(CASE WHEN game_attempts IS NOT NULL THEN game_makes || '/' || game_attempts || ' game' END,'') || ' ' || result)
        FROM development_attempts WHERE block_id=b.id ORDER BY id DESC LIMIT 1) AS result
        FROM development_blocks b WHERE b.athlete_id=? ORDER BY b.updated_at DESC,b.id DESC LIMIT 1`).get(p.id);
      return {id:p.id,name:p.name,rsvp:p.rsvp,court:p.court,eligible:true,training_needs:JSON.parse(p.training_needs||'[]'),
        cue:p.recap_cue||previous?.retest_notes||previous?.coach_feedback||previous?.constraint_text||p.focus||'',
        previous:previous?.title||'',result:previous?.result||previous?.athlete_reflection||''};
    });
  const available=players.filter(p=>p.eligible && !['out','waitlist'].includes(p.rsvp));
  return {plan,session:session||null,blocks,players,shared:shared([...new Map(available.map(p=>[p.id,p])).values()])};
}

function nextLesson(db,auth,user) {
  const live=db.prepare("SELECT id,title,started_at,source_plan_id FROM training_sessions WHERE coach_id=? AND status='live' ORDER BY started_at DESC LIMIT 1").get(user.id);
  if(live) return {live};
  const tz='America/Chicago',today=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const plans=db.prepare(`SELECT p.id,p.starts_at FROM plans p WHERE p.owner_id=? AND p.status IN ('draft','published') AND p.starts_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM training_sessions s WHERE s.source_plan_id=p.id) AND p.starts_at>=? ORDER BY p.starts_at ASC`).all(user.id,today);
  const first=plans.find(p=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(p.starts_at))>=today);
  return first ? {lesson:lessonBrief(db,auth,user,first.id)} : {};
}
module.exports={lessonBrief,nextLesson};
