'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

test('new members save a welcome once, create one profile and return without onboarding again', async t => {
  const s = await start(); t.after(s.close);
  const owner = s.client(); assert.equal((await owner.signup('Owner','owner@lab.test')).body.welcome_required,false);
  const c = s.client(), signup = await c.signup('New Member','new@lab.test');
  assert.equal(signup.body.welcome_required,true);
  const body = {name:'Riley',sport:'Pickleball',goals:'Feel confident at the kitchen',connection:'new'};
  const first = await c.post('/api/me/welcome',body);
  assert.equal(first.status,200); assert.ok(first.body.athlete_id);
  assert.equal((await c.post('/api/me/welcome',body)).body.athlete_id,first.body.athlete_id);
  assert.equal(s.app.db.prepare('SELECT count(*) n FROM athletes').get().n,1);
  const me = (await c.get('/api/me')).body;
  assert.equal(me.welcome_required,false); assert.equal(me.user.name,'Riley');
  const profile = (await c.get('/api/athletes/'+me.athlete_id)).body.athlete;
  assert.equal(profile.sport,body.sport); assert.equal(profile.goals,body.goals);
  const record = (await owner.get('/api/admin/members/'+me.user.id)).body;
  assert.equal(record.welcome.goals,body.goals);
  assert.equal((await s.client().get('/api/me/welcome')).status,401);
  assert.equal((await s.client().post('/api/me/welcome',body)).status,401);
  assert.equal((await c.get('/api/admin/members/'+me.user.id)).status,403);
  await c.post('/api/auth/logout');
  assert.equal((await c.post('/api/auth/login',{email:'new@lab.test',password:'correct horse battery'})).body.welcome_required,false);
});

test('claiming preserves history, invalid claims roll back, and earlier matching profiles cannot be duplicated', async t => {
  const s = await start(); t.after(s.close);
  const owner = s.client(); await owner.signup('Owner','owner@lab.test');
  const prior = (await owner.post('/api/athletes',{name:'Earlier Riley',claim_email:'riley@lab.test',goals:'Existing goal',sport:'Tennis',focus:'Coach focus'})).body;
  await owner.post('/api/athletes/'+prior.athlete.id+'/notes',{body:'Keep this history',visibility:'shared'});
  const c=s.client(); await c.signup('Riley','riley@lab.test');
  const body={name:'New name',sport:'Pickleball',goals:'A new goal',connection:'new'};
  assert.equal((await c.post('/api/me/welcome',body)).status,409);
  assert.equal((await c.post('/api/me/athlete',{})).status,409);
  assert.equal((await c.post('/api/me/welcome',{...body,connection:'claim',code:'BAD'})).status,400);
  let me=(await c.get('/api/me')).body;
  assert.equal(me.user.name,'Riley'); assert.equal(me.welcome_required,true); assert.equal(me.athlete_id,null);
  const result=await c.post('/api/me/welcome',{...body,connection:'claim',code:prior.claim_code});
  assert.equal(result.status,200); assert.equal(result.body.athlete_id,prior.athlete.id);
  const profile=(await c.get('/api/athletes/'+prior.athlete.id)).body;
  assert.equal(profile.athlete.goals,'Existing goal'); assert.equal(profile.athlete.sport,'Tennis');
  assert.equal(profile.athlete.focus,'Coach focus'); assert.equal(profile.notes[0].body,'Keep this history');
  assert.equal(s.app.db.prepare('SELECT count(*) n FROM athletes').get().n,1);
});

test('explore first saves goals for the owner without making a duplicate profile or blocking future setup', async t => {
  const s=await start();t.after(s.close);
  const owner=s.client();await owner.signup('Owner','owner@lab.test');
  const c=s.client();const u=(await c.signup('Explore','explore@lab.test')).body.user;
  const body={name:'Explore',sport:'Tennis',goals:'Build consistency',connection:'later'};
  assert.equal((await c.post('/api/me/welcome',body)).status,200);
  const me=(await c.get('/api/me')).body;assert.equal(me.athlete_id,null);assert.equal(me.welcome_required,false);
  assert.equal((await owner.get('/api/admin/members/'+u.id)).body.welcome.connection,'later');
  const profile=(await owner.post('/api/admin/members/'+u.id+'/profile')).body;
  const a=(await owner.get('/api/athletes/'+profile.athlete_id)).body.athlete;
  assert.equal(a.sport,body.sport); assert.equal(a.goals,body.goals);
  assert.equal((await c.post('/api/me/welcome',{...body,connection:'new'})).body.athlete_id,profile.athlete_id);
  assert.equal(s.app.db.prepare('SELECT count(*) n FROM athletes').get().n,1);
});

test('Google and verified email accounts receive the same welcome, and returning Google accounts keep their profile', async t => {
  let claims, emailToken;
  const s=await start({googleClientId:'test-client',googleClientSecret:'test-secret',onSignInLink:(_,link)=>{emailToken=link.split('/email-signin/')[1];},fetchImpl:async()=>({ok:true,json:async()=>({id_token:'x.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.y'})})});t.after(s.close);
  const google=async()=>{
    const begin=await fetch(s.base+'/api/auth/google/start',{redirect:'manual'});
    const state=new URL(begin.headers.get('location')).searchParams.get('state');
    const done=await fetch(s.base+'/api/auth/google/callback?code=test&state='+state,{redirect:'manual',headers:{cookie:begin.headers.get('set-cookie').split(';')[0]}});
    const cookie=done.headers.getSetCookie().find(c=>c.startsWith('lab_session='))?.split(';')[0];
    return {done,cookie};
  };
  claims={aud:'test-client',iss:'https://accounts.google.com',exp:Date.now()/1000+600,email:'google@lab.test',email_verified:true,sub:'google-one',name:'Google Member'};
  let g=await google(); assert.equal(g.done.headers.get('location'),'/#/');
  let me=await (await fetch(s.base+'/api/me',{headers:{cookie:g.cookie}})).json();assert.equal(me.welcome_required,true);
  const saved=await fetch(s.base+'/api/me/welcome',{method:'POST',headers:{cookie:g.cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'Google Member',sport:'Pickleball',goals:'Read the ball',connection:'new'})});assert.equal(saved.status,200);
  g=await google();me=await (await fetch(s.base+'/api/me',{headers:{cookie:g.cookie}})).json();assert.equal(me.welcome_required,false);assert.ok(me.athlete_id);
  const email=s.client();await email.post('/api/auth/email/request',{email:'email@lab.test'});
  assert.equal(s.app.db.prepare('SELECT count(*) n FROM users').get().n,1);
  assert.equal((await email.post('/api/auth/email/confirm',{token:emailToken})).body.welcome_required,true);
  const count=s.app.db.prepare('SELECT count(*) n FROM users').get().n;
  for(const bad of [null,{...claims,sub:''},{...claims,email_verified:false},{...claims,aud:'wrong'},{...claims,exp:0}]){
    claims=bad;const failed=await google();assert.match(failed.done.headers.get('location'),/signin\?error=/);assert.equal(failed.cookie,undefined);
  }
  assert.equal(s.app.db.prepare('SELECT count(*) n FROM users').get().n,count);
});

test('welcome validates fields before changing account data and clears with account deletion',async t=>{
  const s=await start();t.after(s.close);const c=s.client();await c.signup('Original','validation@lab.test');
  const body={name:'Updated',sport:'Tennis',goals:'A goal',connection:'new'};
  for(const change of [{name:''},{sport:'x'.repeat(81)},{goals:'x'.repeat(2001)},{connection:'admin'}])assert.equal((await c.post('/api/me/welcome',{...body,...change})).status,400);
  assert.equal((await c.get('/api/me')).body.user.name,'Original');assert.equal(s.app.db.prepare('SELECT count(*) n FROM athletes').get().n,0);
  await c.post('/api/me/delete',{password:'correct horse battery'});assert.equal(s.app.db.prepare('SELECT count(*) n FROM member_welcome').get().n,0);
});

test('welcome migration leaves existing accounts out of first-time setup',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{open}=require('../server/db');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lab-welcome-'));let db;
  try{const file=path.join(dir,'test.db');db=open(file);const version=db.prepare('PRAGMA user_version').get().user_version;
    db.exec('DROP TABLE website_import_runs; DROP TABLE note_attachments; DROP TABLE website_record_imports; DROP TABLE website_athlete_imports; DROP TRIGGER queue_member_welcome; DROP TABLE member_welcome; PRAGMA user_version='+(version-2));
    db.prepare('INSERT INTO users(email,name,password_hash) VALUES(?,?,?)').run('earlier@lab.test','Earlier','x');db.close();db=null;
    db=open(file);assert.equal(db.prepare('SELECT count(*) n FROM member_welcome').get().n,0);
    db.prepare('INSERT INTO users(email,name,password_hash) VALUES(?,?,?)').run('new@lab.test','New','x');assert.equal(db.prepare('SELECT count(*) n FROM member_welcome').get().n,1);
  }finally{if(db)db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
