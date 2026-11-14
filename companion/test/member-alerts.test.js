'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers.js');
const { createMemberAlerts } = require('../server/member-alerts.js');
const { createAuth } = require('../server/auth.js');
const { createNotifier } = require('../server/api/notify.js');

function mailRecorder() {
  const messages = [];
  return { messages, enabled: true, async send(msg) { messages.push(msg); return { sent: true }; }, sendSoon() {} };
}

test('new password member alerts the owner once, even with general email off; admin can open and prepare their dashboard', async t => {
  const mailer = mailRecorder(), pushes = [];
  const s = await start({ mailer, push: { enabled: true, toUser: (id, msg) => pushes.push({ id, msg }) } }); t.after(s.close);
  const owner = s.client(); const ownerId = (await owner.signup('Owner','owner@lab.test')).body.user.id;
  await owner.put('/api/me/prefs', { email_mode: 'off' });
  const member = s.client(); const id = (await member.signup('Jo <Player>','jo@lab.test')).body.user.id;
  await s.app.memberAlerts.flush(); await s.app.memberAlerts.flush();
  assert.equal(mailer.messages.length, 1);
  assert.equal(mailer.messages[0].to, 'owner@lab.test');
  assert.match(mailer.messages[0].text, new RegExp('#/admin/members/' + id));
  assert.match(mailer.messages[0].html, /Jo &lt;Player&gt;/);
  assert.equal(pushes.length, 1); assert.equal(pushes[0].id, ownerId);
  assert.doesNotMatch(pushes[0].msg.body, /jo@/);
  const notes = (await owner.get('/api/notifications')).body.items;
  assert.equal(notes.filter(n => n.kind === 'new_member').length, 1);
  assert.equal((await member.get('/api/notifications')).body.items.length, 0);
  assert.equal((await owner.get('/api/admin/members')).body.unreviewed, 1);
  assert.equal((await owner.get('/api/admin/members/' + id)).body.athlete, null);
  assert.equal((await member.get('/api/admin/members/' + id)).status, 403);
  assert.equal((await member.post('/api/admin/members/' + id + '/profile')).status, 403);
  const a = (await owner.post('/api/admin/members/' + id + '/profile')).body.athlete_id;
  assert.equal((await owner.post('/api/admin/members/' + id + '/profile')).body.athlete_id, a);
  assert.equal((await owner.get('/api/athletes/' + a)).body.access, 'coach');
  assert.equal((await member.get('/api/me')).body.athlete_id, a);
  await owner.post('/api/admin/members/' + id + '/reviewed');
  assert.equal((await owner.get('/api/admin/members')).body.unreviewed, 0);
  await member.post('/api/auth/login', { email: 'jo@lab.test', password: 'correct horse battery' });
  assert.equal((await s.client().signup('Again','jo@lab.test')).status, 409);
  await s.app.memberAlerts.flush(); assert.equal(mailer.messages.length, 1);
});

test('Google and verified-email account creation enqueue once; rejected verification and returning logins do not', async t => {
  const mailer = mailRecorder(); let claims, emailToken;
  const s = await start({ mailer, googleClientId:'cid',googleClientSecret:'secret', onSignInLink:(_,link)=>{emailToken=link.split('/email-signin/')[1];}, fetchImpl:async()=>({ok:true,json:async()=>({id_token:'x.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.y'})}) }); t.after(s.close);
  const google = async () => {
    const start = await fetch(s.base+'/api/auth/google/start',{redirect:'manual'});
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    return fetch(s.base+'/api/auth/google/callback?code=test&state='+state,{redirect:'manual',headers:{Cookie:start.headers.get('set-cookie').split(';')[0]}});
  };
  claims={aud:'cid',iss:'https://accounts.google.com',exp:Date.now()/1000+600,sub:'google1',email:'google@lab.test',name:'Google Member',email_verified:false};
  await google(); await s.app.memberAlerts.flush(); assert.equal(mailer.messages.length,0);
  claims.email_verified=true; await google(); await google(); await s.app.memberAlerts.flush();
  assert.equal(mailer.messages.length,1);
  const c=s.client(); await c.post('/api/auth/email/request',{email:'email@lab.test'});
  await s.app.memberAlerts.flush(); assert.equal(mailer.messages.length,1);
  await c.post('/api/auth/email/confirm',{token:emailToken}); await s.app.memberAlerts.flush();
  assert.equal(mailer.messages.length,2);
  await c.post('/api/auth/email/request',{email:'email@lab.test'}); await c.post('/api/auth/email/confirm',{token:emailToken});
  // The website bridge also creates users through the same transactional trigger.
  s.app.db.prepare("INSERT INTO users(email,name,password_hash) VALUES ('bridge@lab.test','Bridge Member','oauth$website$test')").run();
  await s.app.memberAlerts.flush(); assert.equal(mailer.messages.length,3);
  await s.client().signup('Owner','owner@lab.test'); await s.app.memberAlerts.flush();
  assert.equal(s.app.db.prepare("SELECT count(*) n FROM notifications WHERE kind='new_member'").get().n,3,'owner can receive in-app notices after creating their account');
  assert.equal(mailer.messages.length,3);
});

test('failed delivery survives worker recreation, retries the same payload, and never duplicates the in-app notice', async t => {
  const calls=[]; let fail=true;
  const mailer={enabled:true,sendSoon(){},async send(msg){calls.push(msg);if(fail)throw Object.assign(Error('down'),{status:503});return {sent:true};}};
  const s=await start({mailer}); t.after(s.close);
  const owner=s.client(); await owner.signup('Owner','owner@lab.test');
  const id=(await s.client().signup('First name','retry@lab.test')).body.user.id;
  const at=new Date().toISOString(); await s.app.memberAlerts.flush(at);
  assert.equal(s.app.db.prepare('SELECT email_state FROM member_signups WHERE user_id=?').get(id).email_state,'pending');
  await s.app.memberAlerts.flush(at); assert.equal(calls.length,1,'backoff applies');
  s.app.db.prepare('UPDATE users SET name=? WHERE id=?').run('Changed name',id); fail=false;
  const auth=createAuth(s.app.db),push={enabled:false,toUser(){}};
  const worker=createMemberAlerts({db:s.app.db,auth,config:s.app.config,mailer,push,notifier:createNotifier(s.app.db,push,mailer,s.app.config.publicUrl)});
  await worker.flush(new Date(Date.parse(at)+60000).toISOString());
  assert.deepEqual(calls[1],calls[0]);
  assert.equal(s.app.db.prepare('SELECT email_state FROM member_signups WHERE user_id=?').get(id).email_state,'sent');
  assert.equal((await owner.get('/api/notifications')).body.items.length,1);
  await worker.flush(new Date(Date.parse(at)+120000).toISOString()); assert.equal(calls.length,2);
});

test('missing delivery configuration stays queued; permanent failures are visible; demo never sends', async t => {
  const mailer=mailRecorder(); mailer.enabled=false;
  const s=await start({mailer});t.after(s.close);
  const id=(await s.client().signup('Member','missing@lab.test')).body.user.id;
  await s.app.memberAlerts.flush(); assert.equal(mailer.messages.length,0);
  assert.equal(s.app.db.prepare('SELECT email_state FROM member_signups WHERE user_id=?').get(id).email_state,'pending');
  mailer.enabled=true; mailer.send=async()=>{throw Object.assign(Error('forbidden'),{status:403});};
  await s.app.memberAlerts.flush(); assert.equal(s.app.memberAlerts.status().failed,1);
  const demo=await start({demo:true,mailer:mailRecorder()});t.after(demo.close);
  await demo.client().signup('Demo','demo@lab.test');await demo.app.memberAlerts.flush();
  assert.equal(demo.app.memberAlerts.status().email_enabled,false);
  assert.equal(demo.app.db.prepare('SELECT attempts FROM member_signups').get().attempts,0);
});

test('matching prior athlete email blocks a duplicate profile and keeps claim access explicit', async t => {
  const s=await start();t.after(s.close);
  const owner=s.client();await owner.signup('Owner','owner@lab.test');
  const earlier=(await owner.post('/api/athletes',{name:'Existing athlete',claim_email:'existing@lab.test'})).body.athlete;
  const c=s.client(); const id=(await c.signup('Existing athlete','existing@lab.test')).body.user.id;
  assert.equal((await owner.get('/api/admin/members/'+id)).body.candidates[0].id,earlier.id);
  assert.equal((await owner.post('/api/admin/members/'+id+'/profile')).status,409);
  assert.equal((await c.get('/api/me')).body.athlete_id,null);
});

test('signup queue rolls back with failed account transactions; deleting an account cancels its pending email', async t => {
  const s=await start({mailer:mailRecorder()});t.after(s.close);
  s.app.db.exec("BEGIN; INSERT INTO users(email,name,password_hash) VALUES('rollback@lab.test','Rollback','x'); ROLLBACK;");
  assert.equal(s.app.db.prepare('SELECT count(*) n FROM member_signups').get().n,0);
  const c=s.client();await c.signup('Delete','delete@lab.test');
  await c.post('/api/me/delete',{password:'correct horse battery'});
  assert.equal(s.app.db.prepare('SELECT count(*) n FROM member_signups').get().n,0);
});

test('email member links survive sign-in and reject arbitrary external return destinations', () => {
  const fs=require('node:fs'),vm=require('node:vm');const store=new Map();
  const window={Lab:{h:String,api:{}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/invitationals.js'),'utf8'),{window,localStorage:{setItem:(k,v)=>store.set(k,v),getItem:k=>store.get(k),removeItem:k=>store.delete(k)},Date});
  window.LabInviteReturn.save('#/admin/members/42');assert.equal(window.LabInviteReturn.take(),'#/admin/members/42');
  assert.equal(window.LabInviteReturn.take(),null);
  window.LabInviteReturn.save('https://evil.test');assert.equal(window.LabInviteReturn.take(),null);
});

test('production request completion starts delivery without waiting for the minute timer', async t => {
  const mailer=mailRecorder();const s=await start({mailer,jobs:true});t.after(s.close);
  await s.client().signup('Immediate','immediate@lab.test');
  await s.app.memberAlerts.flush();
  assert.equal(mailer.messages.length,1);
  assert.equal(s.app.db.prepare("SELECT email_state FROM member_signups").get().email_state,'sent');
});

test('upgrade preserves existing accounts and queues only registrations after the migration', () => {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {open}=require('../server/db.js');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lab-signup-migration-')),file=path.join(dir,'test.db');
  let db;
  try {
    db=open(file);const version=db.prepare('PRAGMA user_version').get().user_version;
    db.exec('DROP TABLE website_import_runs; DROP TABLE note_attachments; DROP TABLE website_record_imports; DROP TABLE website_athlete_imports; DROP TRIGGER queue_member_welcome; DROP TABLE member_welcome; DROP TRIGGER queue_member_signup; DROP TABLE member_signups; PRAGMA user_version='+(version-3));
    db.prepare('INSERT INTO users(email,name,password_hash) VALUES(?,?,?)').run('earlier@lab.test','Earlier','x');db.close();db=null;
    db=open(file);assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,1);
    assert.equal(db.prepare('SELECT count(*) n FROM member_signups').get().n,0);
    db.prepare('INSERT INTO users(email,name,password_hash) VALUES(?,?,?)').run('later@lab.test','Later','x');
    assert.equal(db.prepare('SELECT count(*) n FROM member_signups').get().n,1);
  } finally { if(db)db.close();fs.rmSync(dir,{recursive:true,force:true}); }
});
