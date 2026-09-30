'use strict';
const {HttpError}=require('../http');
const SITE='https://transcending-performance-lab.brettadamstp.chatgpt.site';
module.exports=function(r,{db,auth,config}){
 r.post('/api/workspace',async({user,body,res,req})=>{
  auth.require(user);
  const origin=req.headers.origin;
  if(origin&&!['https://the-lab-8w5d.onrender.com',config.publicUrl].includes(origin))throw new HttpError(403,'Open THE LAB to use your workspace.');
  res.setHeader('Cache-Control','no-store');
  const c=db.prepare('SELECT * FROM website_staff_connections WHERE user_id=? AND expires_at>?').get(user.id,Date.now());
  if(!c||!user.workspace)throw new HttpError(403,'Connect your Brett or Austin staff account to open website athletes.');
  const upstream=await config.fetchImpl(SITE+'/api/app-workspace',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.token},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  let data;try{data=await upstream.json();}catch{throw new HttpError(503,'The website connection could not be reached. Your athletes have not been removed. Retry or reconnect staff access.');}
  if(upstream.status===401||upstream.status===403){db.prepare('DELETE FROM website_staff_connections WHERE user_id=?').run(user.id);throw new HttpError(403,'Staff connection expired. Connect again.');}
  if(!upstream.ok)throw new HttpError(upstream.status,data.error||'Workspace unavailable.');
  if(body.action==='disconnect')db.prepare('DELETE FROM website_staff_connections WHERE user_id=?').run(user.id);
  return data;
 });
};

