'use strict';
const crypto=require('node:crypto');
const {HttpError}=require('../http.js');
const {sha256}=require('../auth.js');
const {tx}=require('../db.js');
const SITE='https://transcending-performance-lab.brettadamstp.chatgpt.site';
const random=()=>crypto.randomBytes(32).toString('hex');
const hex=/^[a-f0-9]{64}$/;
module.exports=function(r,{db,auth,config}){
 const cookie=(value,age)=>`lab_site_state=${value}; Path=/api/site-bridge/signin; HttpOnly; SameSite=Lax; Max-Age=${age}${config.secureCookies?'; Secure':''}`;
 function redirect(res,to,cookies){res.writeHead(302,{Location:to,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...(cookies?{'Set-Cookie':cookies}:{})});res.end()}
 r.get('/api/site-bridge/signin/start',({user,res})=>{
  if(config.demo)throw new HttpError(403,'Shared sign-in is unavailable in demo mode.');
  const state=random(),verifier=random();
  db.prepare('DELETE FROM website_signin_states WHERE expires_at<?').run(Date.now());
  db.prepare('INSERT INTO website_signin_states(state_hash,verifier,user_id,expires_at) VALUES(?,?,?,?)').run(sha256(state),verifier,user?.id||null,Date.now()+600000);
  redirect(res,SITE+'/app-signin?'+new URLSearchParams({state,challenge:sha256(verifier)}),cookie(state,600));
 });
 r.get('/api/site-bridge/signin/callback',async({req,res,user,query})=>{
  const fail=message=>redirect(res,'/#/signin?error='+encodeURIComponent(message),cookie('',0));
  const state=query.get('state'),code=query.get('code');
  const match=/(?:^|;\s*)lab_site_state=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'');
  if(!hex.test(state||'')||!hex.test(code||'')||!match||match[1]!==state)return fail('Sign-in expired. Continue with THE LAB again.');
  const pending=db.prepare('DELETE FROM website_signin_states WHERE state_hash=? AND expires_at>? RETURNING *').get(sha256(state),Date.now());
  if(!pending||pending.user_id!==(user?.id||null))return fail('Your app account changed. Please restart sign-in.');
  let d;
  try{const response=await config.fetchImpl(SITE+'/api/app-signin',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'exchange',code,verifier:pending.verifier}),signal:AbortSignal.timeout(12000)});d=await response.json();if(!response.ok)throw Error(d.error||'Website sign-in unavailable.');}
  catch(e){return fail(e.message||'Website sign-in unavailable. Please retry.')}
  if(!hex.test(d.token||'')||typeof d.subject!=='string'||!d.subject||typeof d.email!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)||typeof d.athlete?.id!=='string'||typeof d.athlete?.name!=='string')return fail('Website identity could not be verified.');
  try{
   const id=tx(db,()=>{
    const identity=db.prepare('SELECT * FROM website_identities WHERE subject=?').get(d.subject);
    const linked=db.prepare('SELECT * FROM website_connections WHERE athlete_id=?').get(d.athlete.id);
    if(identity&&identity.athlete_id!==d.athlete.id)throw Error('Your website athlete claim changed. Ask your coach to review the link before reconnecting.');
    if(identity&&linked&&identity.user_id!==linked.user_id)throw Error('These profiles need a coach review before linking.');
    let id=identity?.user_id||linked?.user_id||pending.user_id;
    if(pending.user_id&&id!==pending.user_id)throw Error('This website profile belongs to a different app account. Sign out before continuing.');
    if(!id){
     if(db.prepare('SELECT id FROM users WHERE email=?').get(d.email))throw Error('You already have an app account. Sign in with your existing app login once, then choose Connect with THE LAB in Profile.');
     if(db.prepare('SELECT id FROM athletes WHERE user_id IS NULL AND claim_email=?').get(d.email))throw Error('Your coach has an existing app profile for you. Sign in and claim it first, then connect with THE LAB.');
     id=Number(db.prepare('INSERT INTO users(email,name,password_hash,roles) VALUES(?,?,?,?)').run(d.email,d.name||d.athlete.name,'oauth$website$'+random(),'["athlete"]').lastInsertRowid);
    }
    const other=db.prepare('SELECT subject FROM website_identities WHERE user_id=? AND subject<>?').get(id,d.subject);
    const existing=db.prepare('SELECT athlete_id FROM website_connections WHERE user_id=?').get(id);
    if(other||existing&&existing.athlete_id!==d.athlete.id)throw Error('This app account already has another player identity. Ask your coach to review it.');
    db.prepare('INSERT INTO website_identities(user_id,subject,athlete_id) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING').run(id,d.subject,d.athlete.id);
    if(!db.prepare('SELECT id FROM athletes WHERE user_id=?').get(id))db.prepare('INSERT INTO athletes(user_id,name) VALUES(?,?)').run(id,d.athlete.name);
    db.prepare('INSERT INTO website_connections(user_id,athlete_id,athlete_name,token,connected_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET athlete_id=excluded.athlete_id,athlete_name=excluded.athlete_name,token=excluded.token,connected_at=excluded.connected_at').run(id,d.athlete.id,d.athlete.name,d.token,new Date().toISOString());
    return id;
   });
   redirect(res,'/#/profile',[cookie('',0),auth.startSession(id).cookie]);
  }catch(e){return fail(e.message||'Profile connection could not complete.')}
 });
};
