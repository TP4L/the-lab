'use strict';
const {HttpError}=require('../http');
const {tx,now}=require('../db');
const SITE='https://transcending-performance-lab.brettadamstp.chatgpt.site';
module.exports=function(r,ctx){
 const {db,auth,config}=ctx;
 async function call(user,body){
  auth.require(user);
  const c=db.prepare('SELECT * FROM website_staff_connections WHERE user_id=? AND expires_at>?').get(user.id,Date.now());
  if(!c||!user.workspace)throw new HttpError(403,'Connect your Brett or Austin staff account to open website athletes.');
  const upstream=await config.fetchImpl(SITE+'/api/app-workspace',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.token},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  let data;try{data=await upstream.json();}catch{throw new HttpError(503,'The website connection could not be reached. Your athletes have not been removed. Retry or reconnect staff access.');}
  if(upstream.status===401||upstream.status===403){db.prepare('DELETE FROM website_staff_connections WHERE user_id=?').run(user.id);throw new HttpError(403,'Staff connection expired. Connect again.');}
  if(!upstream.ok)throw new HttpError(upstream.status,data.error||'Workspace unavailable.');
  if(body.action==='disconnect')db.prepare('DELETE FROM website_staff_connections WHERE user_id=?').run(user.id);
  const rows=Array.isArray(data&&data.athletes)?data.athletes:[];
  return {...data,athletes:rows.map(row=>{const link=db.prepare('SELECT athlete_id FROM website_athlete_links WHERE website_id=?').get(row.id);return {...row,app_id:link?.athlete_id||null};})};
 }
 ctx.websiteWorkspace=call;
 function syncRoster(user,data){
  const rows=Array.isArray(data&&data.athletes)?data.athletes:[];
  tx(db,()=>rows.forEach(row=>{
   if(!row||typeof row.id!=='string'||!row.id||typeof row.name!=='string'||!row.name.trim())return;
   let linked=db.prepare('SELECT athlete_id FROM website_athlete_links WHERE website_id=?').get(row.id);
   if(!linked){
    const connected=db.prepare('SELECT a.id athlete_id FROM athletes a JOIN website_connections c ON c.user_id=a.user_id WHERE c.athlete_id=?').get(row.id);
    const athleteId=connected?.athlete_id||Number(db.prepare('INSERT INTO athletes(name,rating,focus,created_by) VALUES(?,?,?,?)').run(row.name.trim(),String(row.rating||row.level||'').slice(0,20),String(row.focus||'').slice(0,500),user.id).lastInsertRowid);
    db.prepare('INSERT OR IGNORE INTO website_athlete_links(website_id,athlete_id) VALUES(?,?)').run(row.id,athleteId);
    linked={athlete_id:athleteId};
   }
   db.prepare('INSERT OR IGNORE INTO coach_athletes(coach_id,athlete_id) VALUES(?,?)').run(user.id,linked.athlete_id);
   db.prepare('UPDATE website_athlete_links SET synced_at=? WHERE website_id=?').run(now(),row.id);
  }));
  return data;
 }
 ctx.syncWebsiteRoster=async user=>syncRoster(user,await call(user,{action:'roster'}));
 r.post('/api/workspace',async({user,body,res,req})=>{
  const origin=req.headers.origin;
  if(origin&&!['https://the-lab-8w5d.onrender.com',config.publicUrl].includes(origin))throw new HttpError(403,'Open THE LAB to use your workspace.');
  res.setHeader('Cache-Control','no-store');
  const data=await call(user,body);
  return body.action==='roster'?syncRoster(user,data):data;
 });
};
