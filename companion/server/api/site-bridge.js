'use strict';
const { HttpError } = require('../http.js');
const { limiter } = require('../auth.js');
const SITE = 'https://transcending-performance-lab.brettadamstp.chatgpt.site';
module.exports = function(r, ctx) {
  const {db,auth,config}=ctx;
  const attempts = limiter(10, 15 * 60 * 1000), busy = new Set();
  async function remote(body, token) {
    let res;
    try { res = await config.fetchImpl(SITE + '/api/app-bridge', {method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)}); }
    catch { throw new HttpError(503,'Website unavailable. Your input has not been discarded; retry shortly.'); }
    let data;try{data=await res.json()}catch{throw new HttpError(503,'Website connection is not ready.')}
    if(!res.ok)throw new HttpError([400,401,403,409].includes(res.status)?res.status:503,data.error||'Website connection failed.');
    return data;
  }
  ctx.sharedProgress=async(a,action,data)=>{if(!a.user_id)return null;const c=db.prepare('SELECT token FROM website_connections WHERE user_id=?').get(a.user_id);return c?remote({action,data},c.token):null;};
  ctx.sharedProfile=async(a,fields,save=false)=>{
    if(!a.user_id)return null;
    const c=db.prepare('SELECT token FROM website_connections WHERE user_id=?').get(a.user_id);if(!c)return null;
    const data={name:fields.name,hand:fields.hand||'',rating:fields.rating||'',goals:fields.goals||'',side:fields.side||''};
    for(const key of ['sport','dash_15_seconds','dash_30_seconds','vertical_inches','weight_lbs','height_inches','l_drill_seconds'])if(fields[key]!==undefined)data[key]=fields[key];
    const out=await remote({action:save?'profile-save':'profile-read',data},c.token);
    if(!out.profile||typeof out.profile.name!=='string')throw new HttpError(503,'Shared player details are unavailable.');
    const p=out.profile;
    db.prepare('INSERT INTO website_profile_originals(athlete_id,data) VALUES(?,?) ON CONFLICT(athlete_id) DO NOTHING').run(a.id,JSON.stringify({name:a.name,hand:a.hand,rating:a.rating,goals:a.goals,side:a.side}));
    return p;
  };
  function connection(user){auth.require(user);const c=db.prepare('SELECT * FROM website_connections WHERE user_id=?').get(user.id);if(!c)throw new HttpError(409,'Connect your website profile first.');return c}
  r.get('/api/site-bridge/meta',()=>({protocol:1}));
  r.get('/api/site-bridge',({user})=>{auth.require(user);const c=db.prepare('SELECT athlete_id,athlete_name,connected_at FROM website_connections WHERE user_id=?').get(user.id);return {connected:!!c,athlete:c||null,website:SITE}});
  r.post('/api/site-bridge/connect',async({user,body})=>{
    auth.require(user);if(config.demo)throw new HttpError(403,'Connections are unavailable in demo mode.');
    if(!attempts(String(user.id)))throw new HttpError(429,'Wait before trying another connection code.');
    if(typeof body.code!=='string'||! /^[a-f0-9]{64}$/.test(body.code.trim()))throw new HttpError(400,'Paste the complete website connection code.');
    if(busy.has(user.id))throw new HttpError(409,'A connection is already in progress.');busy.add(user.id);
    try {
      const d=await remote({action:'redeem',code:body.code.trim()});
      if(!/^[a-f0-9]{64}$/.test(d.token)||typeof d.athlete?.id!=='string'||typeof d.athlete?.name!=='string')throw new HttpError(503,'Invalid website connection response.');
      const other=db.prepare('SELECT user_id FROM website_connections WHERE athlete_id=? AND user_id<>?').get(d.athlete.id,user.id);
      if(other){await remote({action:'revoke'},d.token);throw new HttpError(409,'This website profile is connected to another app account. Disconnect it there first.');}
      db.prepare('INSERT INTO website_connections(user_id,athlete_id,athlete_name,token,connected_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET athlete_id=excluded.athlete_id,athlete_name=excluded.athlete_name,token=excluded.token,connected_at=excluded.connected_at').run(user.id,d.athlete.id,d.athlete.name,d.token,new Date().toISOString());
      return {ok:true,athlete:d.athlete};
    } finally {busy.delete(user.id)}
  });
  r.get('/api/site-bridge/feed',async({user})=>{const c=connection(user);return remote({action:'read'},c.token)});
  r.post('/api/site-bridge/reflections',async({user,body})=>{const c=connection(user);return remote({action:'reflect',id:body.id,data:body.data},c.token)});
  r.post('/api/site-bridge/disconnect',async({user})=>{const c=connection(user);try{await remote({action:'revoke'},c.token)}catch(e){if(e.status!==401)throw e}db.prepare('DELETE FROM website_connections WHERE user_id=?').run(user.id);return {ok:true}});
};

