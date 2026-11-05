'use strict';
const { HttpError, str, int, uuid, list, withStatus } = require('../http');
const { tx } = require('../db');

module.exports = function programs(r, {db,auth,notifier}, deliverWebsite) {
  function stepsOf(body) {
    const steps = list(body.steps,'weeks',{max:16,item:(step,index)=>{
      if (!step || typeof step !== 'object') throw new HttpError(400,'Enter a practice for each week.');
      return {
        title:str(step.title,index+'.title',{required:true,max:120}),
        practice:str(step.practice,index+'.practice',{required:true,max:1000}),
        target:str(step.target,index+'.target',{required:true,max:1000}),
        setup:str(step.setup,index+'.setup',{max:600}),
        minutes:int(step.minutes,index+'.minutes',{min:1,max:480})
      };
    }});
    if (!steps.length) throw new HttpError(400,'Add at least one week.');
    return steps;
  }
  function createWeek(program, athleteId, index) {
    const step=JSON.parse(program.steps)[index];
    if (!step) return null;
    const due=new Date(program.start_day+'T12:00:00Z');
    due.setUTCDate(due.getUTCDate()+index*7);
    if(index>0){
      const today=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/Chicago'}).format(new Date());
      if(due.toISOString().slice(0,10)<today)due.setTime(Date.parse(today+'T12:00:00Z'));
    }
    due.setUTCDate(due.getUTCDate()+6);
    const inserted=db.prepare(`INSERT INTO development_blocks
      (athlete_id,assigned_by,title,problem,constraint_text,success_evidence,baseline_conditions,practice_minutes,program_id,program_step,due_on)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(athlete_id,program_id,program_step) DO NOTHING`)
      .run(athleteId,program.coach_id,step.title,program.goal,step.practice,step.target,step.setup,step.minutes,program.id,index,due.toISOString().slice(0,10));
    return inserted.changes ? {id:Number(inserted.lastInsertRowid),athleteId,title:step.title} : null;
  }
  async function announce(user,week) {
    if (!week) return;
    notifier.notify(notifier.usersOfAthletes([week.athleteId]),'training','Next practice: '+week.title,'Your coach has assigned your next program week.','#/development/'+week.id);
    await deliverWebsite(user,week.id);
  }
  function summary(p, user, coach) {
    const steps=JSON.parse(p.steps);
    const sql='SELECT b.id,b.athlete_id,b.program_step,b.status,a.name,b.coach_feedback FROM development_blocks b JOIN athletes a ON a.id=b.athlete_id WHERE b.program_id=?';
    const rows=coach ? db.prepare(sql+' ORDER BY a.name,b.program_step').all(p.id).filter(x=>auth.coachesAthlete(user,x.athlete_id)) :
      db.prepare(sql+' AND b.athlete_id=? ORDER BY b.program_step').all(p.id,auth.ownAthleteId(user));
    return {id:p.id,title:p.title,goal:p.goal,start_day:p.start_day,steps,blocks:rows};
  }
  r.get('/api/coach/programs',({user})=>{
    auth.require(user,'coach');
    return db.prepare('SELECT * FROM companion_programs WHERE coach_id=? ORDER BY id DESC').all(user.id).map(p=>summary(p,user,true));
  });
  r.get('/api/me/programs',({user})=>{
    auth.require(user);
    const aid=auth.ownAthleteId(user);
    if (!aid) return [];
    return db.prepare('SELECT p.* FROM companion_programs p WHERE EXISTS(SELECT 1 FROM development_blocks b WHERE b.program_id=p.id AND b.athlete_id=?) ORDER BY p.id DESC').all(aid).map(p=>summary(p,user,false));
  });
  r.post('/api/coach/programs',async ({user,body})=>{
    auth.require(user,'coach');
    const key=uuid(body.client_key,'client_key');
    const existing=db.prepare('SELECT * FROM companion_programs WHERE coach_id=? AND client_key=?').get(user.id,key);
    if (existing) return summary(existing,user,true);
    const title=str(body.title,'program title',{required:true,max:120}), goal=str(body.goal,'goal',{required:true,max:1000}), steps=stepsOf(body);
    const athletes=[...new Set(list(body.athletes,'athletes',{max:50,item:(x,f)=>int(x,f,{required:true,min:1})}))];
    if (!athletes.length) throw new HttpError(400,'Choose at least one athlete.');
    if (athletes.some(a=>!auth.coachesAthlete(user,a))) throw new HttpError(403,'Choose athletes on your roster.');
    const start=str(body.start_day,'start day',{required:true,max:10});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!Number.isFinite(Date.parse(start+'T12:00:00Z'))||new Date(start+'T12:00:00Z').toISOString().slice(0,10)!==start) throw new HttpError(400,'Choose a valid start date.');
    const {program,weeks}=tx(db,()=>{
      const id=Number(db.prepare('INSERT INTO companion_programs(coach_id,client_key,title,goal,steps,start_day) VALUES(?,?,?,?,?,?)').run(user.id,key,title,goal,JSON.stringify(steps),start).lastInsertRowid);
      const program=db.prepare('SELECT * FROM companion_programs WHERE id=?').get(id);
      return {program,weeks:athletes.map(a=>createWeek(program,a,0))};
    });
    await Promise.all(weeks.map(w=>announce(user,w)));
    return withStatus(201,summary(program,user,true));
  });
  return {
    advance(row) {
      if (!row.program_id) return null;
      const p=db.prepare('SELECT * FROM companion_programs WHERE id=?').get(row.program_id);
      return createWeek(p,row.athlete_id,row.program_step+1);
    },announce
  };
};
