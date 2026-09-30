'use strict';
const {HttpError,str,int,uuid,oneOf}=require('../http');
const {now,tx}=require('../db');
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const METRICS=[['dash_15_seconds',120],['dash_30_seconds',120],['vertical_inches',100],['weight_lbs',1500],['height_inches',120],['l_drill_seconds',300]];
function day(v,label,optional=false){if(optional&&!v)return '';if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new HttpError(400,label+' must be a valid date.');return v;}
function measurement(body){
 const values={sport:str(body.values?.sport,'sport',{max:80})};
 for(const [k,max]of METRICS){const v=body.values?.[k];if(v==null||v==='')continue;if(typeof v!=='number'||!Number.isFinite(v)||v<=0||v>max)throw new HttpError(400,'Check '+k+'.');values[k]=v;}
 if(!METRICS.some(([k])=>values[k]!=null))throw new HttpError(400,'Enter at least one measurement.');
 const date=day(body.date,'Test date'),retestOn=day(body.retestOn,'Retest date',true);if(retestOn&&retestOn<date)throw new HttpError(400,'Retest date must follow the test.');
 return {id:uuid(body.id,'id'),date,values,notes:str(body.notes,'notes',{max:2000}),retestOn};
}
module.exports=function(r,ctx){
 const {db,auth}=ctx;
 function athlete(user,id){auth.require(user);id=int(id,'athlete',{min:1,required:true});const level=auth.athleteAccess(user,id);if(!level)throw new HttpError(404,'Athlete not found.');return db.prepare('SELECT * FROM athletes WHERE id=?').get(id);}
 function localRead(a){return {athlete:{id:a.id,name:a.name,sport:a.sport},measurements:db.prepare('SELECT data FROM athlete_measurements WHERE athlete_id=? ORDER BY recorded_at DESC,id DESC LIMIT 500').all(a.id).map(r=>JSON.parse(r.data)),source:'app',checkedAt:now()};}
 ctx.saveMeasurementSnapshot=(id,fields,prior={})=>{
  if(prior.user_id&&db.prepare('SELECT 1 FROM website_connections WHERE user_id=?').get(prior.user_id))return;
  if(!METRICS.some(([k])=>fields[k]!=null&&fields[k]!==prior[k]))return;
  const snapshot={id:require('node:crypto').randomUUID(),date:today(),values:{sport:fields.sport||''},notes:'Profile measurement update',retestOn:''};
  for(const [k]of METRICS)if(fields[k]!=null)snapshot.values[k]=fields[k];
  db.prepare('INSERT INTO athlete_measurements(id,athlete_id,data,recorded_at) VALUES(?,?,?,?)').run(snapshot.id,id,JSON.stringify(snapshot),snapshot.date+'|'+now());
 };
 r.get('/api/athletes/:id/progress',async({user,params})=>{
  const a=athlete(user,params.id);
  const shared=await ctx.sharedProgress?.(a,'progress-read');
  if(shared){const local=localRead(a);return {...shared,localMeasurements:local.measurements};}
  return localRead(a);
 });
 r.post('/api/athletes/:id/progress',async({user,params,body})=>{
  const a=athlete(user,params.id),data=measurement(body);
  const shared=await ctx.sharedProgress?.(a,'progress-save',data);if(shared)return shared;
  const old=db.prepare('SELECT athlete_id,data FROM athlete_measurements WHERE id=?').get(data.id);
  if(old){if(old.athlete_id!==a.id||old.data!==JSON.stringify(data))throw new HttpError(409,'This result already exists with different values.');return {ok:true};}
  tx(db,()=>{
   const latest=db.prepare('SELECT recorded_at FROM athlete_measurements WHERE athlete_id=? ORDER BY recorded_at DESC LIMIT 1').get(a.id);
   db.prepare('INSERT INTO athlete_measurements(id,athlete_id,data,recorded_at) VALUES(?,?,?,?)').run(data.id,a.id,JSON.stringify(data),data.date+'|'+now());
   if(!latest||latest.recorded_at.slice(0,10)<=data.date){const keys=Object.keys(data.values);db.prepare('UPDATE athletes SET '+keys.map(k=>k+'=?').join(',')+', updated_at=? WHERE id=?').run(...keys.map(k=>data.values[k]),now(),a.id);}
  });
  return {ok:true};
 });
 r.get('/api/coach/followups',({user})=>{
  auth.require(user,'coach');
  const athletes=db.prepare('SELECT id,name FROM athletes ORDER BY name').all().filter(a=>auth.coachesAthlete(user,a.id));
  const ids=new Set(athletes.map(a=>a.id));
  const notes=db.prepare("SELECT n.id,n.athlete_id,n.body,n.created_at,n.media_id,a.name,u.name author FROM notes n JOIN athletes a ON a.id=n.athlete_id LEFT JOIN users u ON u.id=n.author_id WHERE n.kind='reflection' AND n.reviewed_at IS NULL ORDER BY n.created_at LIMIT 1000").all().filter(n=>ids.has(n.athlete_id));
  const assignments=db.prepare("SELECT x.*,a.name FROM assignments x JOIN athletes a ON a.id=x.athlete_id WHERE x.status='open' AND x.due_on < ? ORDER BY x.due_on LIMIT 1000").all(today()).filter(x=>ids.has(x.athlete_id));
  const tasks=db.prepare('SELECT * FROM coach_followups ORDER BY updated_at DESC LIMIT 1000').all().filter(x=>ids.has(x.athlete_id)).map(x=>({...JSON.parse(x.data),revision:x.revision,name:athletes.find(a=>a.id===x.athlete_id)?.name}));
  const coaches=db.prepare('SELECT id,name,email,roles FROM users ORDER BY name').all().map(u=>auth.userRow(u)).filter(u=>u.roles.includes('coach')).map(u=>({id:u.id,name:u.name}));
  return {athletes,notes,assignments,tasks,coaches,checkedAt:now(),limited:notes.length===1000||assignments.length===1000||tasks.length===1000};
 });
 r.post('/api/coach/followups',({user,body})=>{
  auth.require(user,'coach');const id=uuid(body.id,'id'),aid=int(body.athleteId,'athlete',{required:true,min:1});if(!auth.coachesAthlete(user,aid))throw new HttpError(404,'Athlete not found.');
  const assignee=body.assignee?int(body.assignee,'assignee',{min:1}):null;
  if(assignee){const u=auth.userRow(db.prepare('SELECT * FROM users WHERE id=?').get(assignee));if(!u||!auth.coachesAthlete(u,aid))throw new HttpError(400,'Choose a coach with access to this athlete.');}
  const data={id,athleteId:aid,title:str(body.title,'title',{required:true,max:300}),due:day(body.due,'Due date',true),assignee,status:oneOf(body.status||'open',['open','done'],'status')};
  const revision=int(body.revision??0,'revision',{min:0}),old=db.prepare('SELECT * FROM coach_followups WHERE id=?').get(id);
  if(old&&old.athlete_id===aid&&old.data===JSON.stringify(data)&&old.revision===revision+1)return {ok:true};
  if(old){if(old.athlete_id!==aid||old.revision!==revision)throw new HttpError(409,'This changed on another device. Refresh before saving.');db.prepare('UPDATE coach_followups SET data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(JSON.stringify(data),now(),id,revision);}
  else {if(revision!==0)throw new HttpError(404,'Follow-up not found.');db.prepare('INSERT INTO coach_followups(id,athlete_id,data,revision,updated_at) VALUES(?,?,?,1,?)').run(id,aid,JSON.stringify(data),now());}
  return {ok:true};
 });
 r.post('/api/notes/:id/reply',({user,params,body})=>{
  auth.require(user,'coach');const n=db.prepare("SELECT * FROM notes WHERE id=? AND kind='reflection'").get(int(params.id,'id',{min:1,required:true}));
  if(!n||!auth.coachesAthlete(user,n.athlete_id))throw new HttpError(404,'Note not found.');
  const text=str(body.body,'reply',{required:true,max:5000}),client=uuid(body.client_id,'client_id');
  const prior=db.prepare('SELECT * FROM notes WHERE author_id=? AND client_id=?').get(user.id,client);
  if(prior){if(prior.reply_to!==n.id||prior.body!==text)throw new HttpError(409,'Reply conflict.');return {ok:true};}
  tx(db,()=>{db.prepare("INSERT INTO notes(athlete_id,author_id,kind,visibility,body,client_id,reply_to) VALUES(?,?,'coach','shared',?,?,?)").run(n.athlete_id,user.id,text,client,n.id);db.prepare('UPDATE notes SET reviewed_at=?,reviewed_by=? WHERE id=?').run(now(),user.id,n.id);});
  return {ok:true};
 });
};
