'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {start}=require('./helpers');
test('website connection keeps credentials server-side and scopes access to signed-in user',async()=>{
 const calls=[];const token='a'.repeat(64);const s=await start({fetchImpl:async(url,opts)=>{assert.equal(url,'https://transcending-performance-lab.brettadamstp.chatgpt.site/api/app-bridge');const b=JSON.parse(opts.body);calls.push(b.action);if(b.action==='redeem')return Response.json({token,athlete:{id:'website-athlete',name:'Member'}});assert.equal(opts.headers.Authorization,'Bearer '+token);return Response.json(b.action==='read'?{notes:[],records:[]}:{ok:true});}});
 try{const a=s.client(),b=s.client();assert.equal((await a.get('/api/site-bridge')).status,401);await a.signup('Member','a@example.test');await b.signup('Other','b@example.test');assert.equal((await a.post('/api/site-bridge/connect',{code:'bad'})).status,400);assert.equal((await a.post('/api/site-bridge/connect',{code:'b'.repeat(64)},{Origin:'https://evil.test'})).status,403);const r=await a.post('/api/site-bridge/connect',{code:'b'.repeat(64)});assert.equal(r.status,200);assert(!JSON.stringify(r.body).includes(token));assert(!JSON.stringify((await a.get('/api/site-bridge')).body).includes(token));assert.equal((await b.get('/api/site-bridge/feed')).status,409);assert.equal((await a.get('/api/site-bridge/feed')).status,200);assert.equal((await a.post('/api/site-bridge/disconnect',{})).status,200);assert.equal((await a.get('/api/site-bridge/feed')).status,409);assert.deepEqual(calls,['redeem','read','revoke']);}finally{await s.close()}
});

test('connected staff roster is mirrored into app athletes without duplicates',async()=>{
 const token='c'.repeat(64),websiteId='11111111-1111-4111-8111-111111111111';
 const s=await start({fetchImpl:async(url,opts)=>{assert.equal(url,'https://transcending-performance-lab.brettadamstp.chatgpt.site/api/app-workspace');assert.equal(opts.headers.Authorization,'Bearer '+token);const b=JSON.parse(opts.body);assert.equal(b.action,'roster');return Response.json({name:'THE LAB',email:'brettadamstp@gmail.com',athletes:[{id:websiteId,name:'Existing Athlete',focus:'Reset decisions'}]});}});
 try{
  const brett=s.client();const signed=(await brett.signup('Brett Adams','brettadamstp@gmail.com')).body;
  s.app.db.prepare('INSERT INTO website_staff_connections(user_id,subject,email,token,expires_at) VALUES(?,?,?,?,?)').run(signed.user.id,'staff-brett','brettadamstp@gmail.com',token,Date.now()+86400000);
  const first=(await brett.get('/api/athletes')).body;
  assert.equal(first.length,1);assert.equal(first[0].name,'Existing Athlete');assert.equal(first[0].website_id,websiteId);
  const second=(await brett.get('/api/athletes')).body;
  assert.equal(second.length,1,'refreshing the website roster does not duplicate athletes');
  assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM website_athlete_links').get().n,1);
 }finally{await s.close()}
});

test('Development Blocks deliver once to the website and reuse their id on retry',async()=>{
 const token='d'.repeat(64),websiteId='22222222-2222-4222-8222-222222222222',assignments=[];let fail=true;
 const s=await start({fetchImpl:async(url,opts)=>{const b=JSON.parse(opts.body);if(b.action==='roster')return Response.json({name:'THE LAB',email:'brettadamstp@gmail.com',athletes:[{id:websiteId,name:'Connected Athlete',focus:'Decision timing'}]});if(b.action==='assign'){assignments.push(b);if(fail){fail=false;return Response.json({error:'Temporary website outage'},{status:503});}return Response.json({ok:true});}throw Error('Unexpected action '+b.action);}});
 try{
  const brett=s.client(),signed=(await brett.signup('Brett Adams','brettadamstp@gmail.com')).body;
  s.app.db.prepare('INSERT INTO website_staff_connections(user_id,subject,email,token,expires_at) VALUES(?,?,?,?,?)').run(signed.user.id,'staff-brett','brettadamstp@gmail.com',token,Date.now()+86400000);
  const athlete=(await brett.get('/api/athletes')).body[0];
  const created=await brett.post(`/api/athletes/${athlete.id}/development-blocks`,{title:'See time sooner',problem:'Late read',read_targets:['time'],constraint_text:'Call the read before contact',success_evidence:'8 of 10 early calls'});
  assert.equal(created.status,201);assert.equal(created.body.delivery.website,'failed');assert.equal(assignments.length,1);
  const retried=await brett.post(`/api/development-blocks/${created.body.id}/deliver`,{});
  assert.equal(retried.status,200);assert.equal(retried.body.delivery.website,'delivered');assert.equal(assignments.length,2);
  assert.equal(assignments[0].id,assignments[1].id,'retry keeps a stable id to prevent duplicate website records');
  assert.equal(assignments[1].data.athleteId,websiteId);
 }finally{await s.close()}
});
