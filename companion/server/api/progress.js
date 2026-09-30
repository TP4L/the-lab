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
 r.get('/api/coach/dashboard',({user})=>{
  auth.require(user,'coach');
  const athletes=db.prepare('SELECT id,name FROM athletes ORDER BY name').all().filter(a=>auth.coachesAthlete(user,a.id));
  const ids=new Set(athletes.map(a=>a.id)),names=new Map(athletes.map(a=>[a.id,a.name]));
  const end=new Date(today()+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+7);const through=end.toISOString().slice(0,10);
  const notes=db.prepare("SELECT n.id,n.athlete_id,n.body,n.created_at,n.media_id,a.name FROM notes n JOIN athletes a ON a.id=n.athlete_id WHERE n.kind='reflection' AND n.reviewed_at IS NULL ORDER BY n.created_at").all().filter(n=>ids.has(n.athlete_id)).map(n=>({
   id:'note:'+n.id,recordId:n.id,athleteId:n.athlete_id,name:n.name,title:/^Video review\n/.test(n.body)?'Video needs review':/^Question\n/.test(n.body)?'Athlete question':'Athlete reflection',detail:n.body,at:n.created_at,kind:'review',priority:'review',hasMedia:!!n.media_id,source:'app'
  }));
  const assignments=db.prepare("SELECT x.*,a.name FROM assignments x JOIN athletes a ON a.id=x.athlete_id WHERE x.status='open' ORDER BY COALESCE(x.due_on,'9999'),x.id").all().filter(x=>ids.has(x.athlete_id)).map(x=>({
   id:'assignment:'+x.id,recordId:x.id,athleteId:x.athlete_id,name:x.name,title:x.title,detail:x.note,due:x.due_on||'',at:x.created_at,kind:'assignment',priority:!x.due_on?'open':x.due_on<today()?'overdue':x.due_on===today()?'today':x.due_on<=through?'soon':'later',source:'app'
  }));
  const tasks=db.prepare('SELECT * FROM coach_followups ORDER BY updated_at DESC LIMIT 1000').all().filter(x=>ids.has(x.athlete_id)).map(x=>({...JSON.parse(x.data),revision:x.revision,updatedAt:x.updated_at})).filter(x=>x.status==='open').map(x=>({
   id:'task:'+x.id,recordId:x.id,athleteId:x.athleteId,name:names.get(x.athleteId),title:x.title,detail:'Coach follow-up',due:x.due||'',at:x.updatedAt,kind:'task',priority:!x.due?'open':x.due<today()?'overdue':x.due===today()?'today':x.due<=through?'soon':'later',assignee:x.assignee,revision:x.revision,task:x,source:'app'
  }));
  const retests=db.prepare("SELECT m.athlete_id,m.data,m.recorded_at FROM athlete_measurements m WHERE NOT EXISTS(SELECT 1 FROM athlete_measurements n WHERE n.athlete_id=m.athlete_id AND (n.recorded_at>m.recorded_at OR (n.recorded_at=m.recorded_at AND n.id>m.id)))").all().filter(x=>ids.has(x.athlete_id)).map(x=>({...x,test:JSON.parse(x.data)})).filter(x=>x.test.retestOn).map(x=>({
   id:'retest:'+x.athlete_id,recordId:x.test.id,athleteId:x.athlete_id,name:names.get(x.athlete_id),title:'Retest '+Object.keys(x.test.values||{}).filter(k=>k!=='sport').map(k=>k.replaceAll('_',' ')).join(', '),detail:x.test.notes||'Repeat the latest test conditions.',due:x.test.retestOn,at:x.recorded_at,kind:'retest',priority:x.test.retestOn<today()?'overdue':x.test.retestOn===today()?'today':x.test.retestOn<=through?'soon':'later',source:'app'
  }));
  const sessions=db.prepare("SELECT DISTINCT s.id,s.title,s.started_at FROM training_sessions s JOIN training_athletes ta ON ta.session_id=s.id WHERE s.status='live' ORDER BY s.started_at DESC").all().filter(s=>db.prepare('SELECT athlete_id FROM training_athletes WHERE session_id=?').all(s.id).some(a=>ids.has(a.athlete_id))).map(s=>({
   id:'session:'+s.id,recordId:s.id,name:'Live training',title:s.title,detail:'Session is still running.',at:s.started_at,kind:'session',priority:'today',source:'app'
  }));
  const events=db.prepare("SELECT id,title,starts_at,location,status FROM events WHERE status IN ('published','live') AND substr(starts_at,1,10)<=? ORDER BY starts_at LIMIT 50").all(through).filter(e=>e.status==='live'||e.starts_at.slice(0,10)>=today()).map(e=>({
   id:'event:'+e.id,recordId:e.id,name:'Event',title:e.title,detail:e.location||'Location to be confirmed',due:e.starts_at,at:e.starts_at,kind:'event',priority:e.status==='live'||e.starts_at.slice(0,10)===today()?'today':'soon',source:'app'
  }));
  const coaches=db.prepare('SELECT id,name,email,roles FROM users ORDER BY name').all().map(u=>auth.userRow(u)).filter(u=>u.roles.includes('coach')).map(u=>({id:u.id,name:u.name,email:u.email}));
  return {viewer:{id:user.id,name:user.name,email:user.email},athletes,coaches,items:[...notes,...assignments,...tasks,...retests,...sessions,...events],checkedAt:now(),window:{today:today(),through}};
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
