'use strict';
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {HttpError,int}=require('../http');
const SITE='https://transcending-performance-lab.brettadamstp.chatgpt.site';
module.exports=function(r,{db,auth,config}){
 function identity(user,q){
  auth.require(user);
  const wid=q.get('website');let a,c,staff=null;
  if(wid){
   staff=db.prepare('SELECT token FROM website_staff_connections WHERE user_id=? AND expires_at>?').get(user.id,Date.now());
   if(!user.workspace||!staff)throw new HttpError(403,'Connect staff access to open this athlete.');
   if(!/^[a-f0-9-]{36}$/i.test(wid))throw new HttpError(400,'Select an athlete.');
   a=db.prepare('SELECT a.* FROM athletes a JOIN website_connections c ON c.user_id=a.user_id WHERE c.athlete_id=?').get(wid);
   if(a&&!auth.athleteAccess(user,a.id))a=null;
   return {a,website:wid,token:staff.token,staff:true};
  }
  const id=q.has('athlete')?int(q.get('athlete'),'athlete',{min:1,required:true}):auth.ownAthleteId(user);
  if(id){a=db.prepare('SELECT * FROM athletes WHERE id=?').get(id);if(!a||!auth.athleteAccess(user,id))throw new HttpError(404,'Athlete not found.');}
  if(!a)throw new HttpError(409,'Connect your player profile first.');
  if(a.user_id)c=db.prepare('SELECT athlete_id,token FROM website_connections WHERE user_id=?').get(a.user_id);
  return {a,website:c?.athlete_id,token:c?.token,staff:false,access:auth.athleteAccess(user,a.id)};
 }
 async function remote(w,body){
  return config.fetchImpl(SITE+(w.staff?'/api/app-workspace':'/api/app-bridge'),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+w.token},body:JSON.stringify(body),signal:AbortSignal.timeout(body.action==='timeline-media'?120000:15000)});
 }
 function local(a,before,includePrivate){
  const parts=[
   `SELECT 'note' kind,CAST(id AS TEXT) id,created_at at,json_object('body',body,'kind',kind,'reply',reply_to,'reviewed',reviewed_at,'mediaId',media_id,'sessionId',session_id,'visibility',visibility) data FROM notes WHERE athlete_id=? AND visibility IN (${includePrivate?"'shared','private'":"'shared'"})`,
   "SELECT 'session' kind,s.id,s.started_at at,json_object('title',s.title,'status',s.status) data FROM training_sessions s JOIN training_athletes ta ON ta.session_id=s.id WHERE ta.athlete_id=?",
   "SELECT 'media' kind,id,created_at at,json_object('mime',mime) data FROM media WHERE athlete_id=? AND visibility='shared' AND id<>COALESCE((SELECT photo_media_id FROM athletes WHERE id=athlete_id),'')",
   "SELECT 'training' kind,CAST(id AS TEXT) id,COALESCE(NULLIF(due_on,''),created_at) at,json_object('title',title,'body',note,'status',status,'due',due_on) data FROM assignments WHERE athlete_id=?",
   "SELECT 'event' kind,CAST(e.id AS TEXT) id,e.starts_at at,json_object('title',e.title,'body',e.location,'status',e.status,'state',p.state) data FROM events e JOIN event_people p ON p.event_id=e.id WHERE p.athlete_id=? AND p.state<>'withdrawn' AND e.status<>'draft'",
   "SELECT 'checkin' kind,CAST(id AS TEXT) id,created_at at,json_object('title','Pre-session check-in','body',focus,'status',status) data FROM pre_session_checkins WHERE athlete_id=?",
   "SELECT 'development' kind,CAST(id AS TEXT) id,COALESCE(NULLIF(due_on,''),created_at) at,json_object('title',title,'body',problem,'status',status,'due',due_on) data FROM development_blocks WHERE athlete_id=?",
   "SELECT 'communication' kind,CAST(n.id AS TEXT) id,n.created_at at,json_object('title',n.title,'body',n.body,'status',n.email_state) data FROM notifications n JOIN athletes a ON a.user_id=n.user_id WHERE a.id=?"
  ];
  let c=null;try{c=before?JSON.parse(before):null;}catch{throw new HttpError(400,'Invalid history cursor.');}
  if(c&&(!Array.isArray(c)||c.length!==2||c.some(x=>typeof x!=='string')))throw new HttpError(400,'Invalid history cursor.');
  const rows=db.prepare("SELECT *,kind||':'||id sortkey FROM ("+parts.join(' UNION ALL ')+") WHERE (?='' OR at<? OR (at=? AND kind||':'||id<?)) ORDER BY at DESC,sortkey DESC LIMIT 61").all(...parts.map(()=>a.id),c?.[0]||'',c?.[0]||'',c?.[0]||'',c?.[1]||'');
  const page=rows.slice(0,60),items=page.map(r=>{
   const d=JSON.parse(r.data),v={id:'app:'+r.kind+':'+r.id,source:'app',kind:r.kind,at:r.at,title:d.title||'',body:d.body||'',status:d.status||'',due:d.due||'',media:null,href:''};
   if(r.kind==='note'){v.kind=d.reply?'feedback':d.kind==='coach'?'note':/^Question\n/.test(d.body)?'question':/^Feedback\n/.test(d.body)?'feedback':'reflection';v.title=d.reply?'Coach reply':d.kind==='coach'?(d.visibility==='private'?'Private coaching note':'Shared coaching note'):v.kind==='question'?'Question':v.kind==='feedback'?'Feedback':'Reflection';v.status=d.visibility==='private'?'Coach only':d.kind==='reflection'?(d.reviewed?'Reviewed':'Awaiting coach review'):'';v.private=d.visibility==='private';if(d.sessionId)v.href='#/train/'+d.sessionId;}
   if(r.kind==='session')v.href='#/train/'+r.id;
   if(r.kind==='training')v.href='#/train';
   if(r.kind==='event'){v.href='#/play/events/'+r.id;v.body=[v.body,d.state].filter(Boolean).join(' · ');v.due=r.at;}
   if(r.kind==='media'){v.title=d.mime.startsWith('video/')?'Training video':'Training photo';v.media={id:r.id,mime:d.mime,kind:'app'};}
   if(r.kind==='checkin')v.href=includePrivate?'#/coach/checkins/'+r.id:'#/check-in';
   if(r.kind==='development')v.href='#/development/'+r.id;
   return v;
  });const last=page.at(-1);
  return {items,next:rows.length>60?JSON.stringify([last.at,last.sortkey]):null,checkedAt:new Date().toISOString()};
 }
 r.get('/api/timeline',async({user,query,res})=>{
  res.setHeader('Cache-Control','no-store');const w=identity(user,query),sources={};
  const only=query.get('source');
  if(!only||only==='app')sources.app=w.a?{status:'ok',...local(w.a,query.get('appBefore')||'',w.access==='coach'||w.staff)}:{status:'unlinked',items:[],next:null,message:'No verified app profile is connected to this website athlete yet.'};
  if(!only||only==='website'){
   if(!w.token)sources.website={status:'unlinked',items:[],next:null,message:'Connect your website profile to include its history.'};
   else try{const up=await remote(w,{action:'timeline',...(w.staff?{id:w.website}:{}),before:query.get('webBefore')||''});const d=await up.json();if(!up.ok||d.error)throw Error(d.error||'Website history unavailable.');sources.website={status:'ok',...d};}catch(e){sources.website={status:'error',items:[],next:null,message:e.message||'Website history unavailable. Retry to load it.'};}
  }
  return {athlete:{id:w.a?.id,websiteId:w.website,name:w.a?.name||sources.website?.athlete?.name||'Athlete'},sources};
 });
 r.get('/api/timeline/media',async({user,query,req,res})=>{
  const w=identity(user,query);if(!w.token)throw new HttpError(409,'Connect the website profile first.');
  const id=query.get('id'),kind=query.get('kind');if(!/^[a-f0-9-]{36}$/i.test(id||'')||!['note','plan'].includes(kind))throw new HttpError(404,'Media unavailable.');
  const up=await remote(w,{action:'timeline-media',...(w.staff?{id:w.website,mediaId:id}:{id}),kind,range:req.headers.range||''});
  if(!up.ok){throw new HttpError([401,403,404,416].includes(up.status)?up.status:503,'Media unavailable. Reconnect or retry.');}
  res.statusCode=up.status;for(const name of ['content-type','content-length','content-range','accept-ranges'])if(up.headers.get(name))res.setHeader(name,up.headers.get(name));
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  await pipeline(Readable.fromWeb(up.body),res);
 });
};
