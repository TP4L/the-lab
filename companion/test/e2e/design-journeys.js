/* Isolated browser acceptance for the responsive LAB workspace.
 * CHROMIUM=/usr/bin/chromium node test/e2e/design-journeys.js
 * Creates an in-memory database; never writes to production or sends email. */
'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {start,uid}=require('../helpers');
const out=process.env.OUT||path.join(require('node:os').tmpdir(),'lab-design-qa');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const s=await start({googleClientId:'local-preview',googleClientSecret:'local-preview'});
 let browser,p;
 try{
  const ok=(r)=>{assert.ok(r.status<300,JSON.stringify(r.body));return r.body;};
  const coach=s.client();ok(await coach.signup('Brett Adams','owner@lab.test'));
  const made=ok(await coach.post('/api/athletes',{name:'Alex Rivera',claim_email:'alex@lab.test',focus:'Reset with control',goals:'Earn the kitchen'})),aid=made.athlete.id;
  const member=s.client();ok(await member.signup('Alex Rivera','alex@lab.test'));
  ok(await member.post('/api/me/welcome',{name:'Alex Rivera',connection:'claim',code:made.claim_code,sport:'Pickleball'}));
  const assignment=ok(await coach.post('/api/athletes/'+aid+'/assignments',{title:'50 controlled resets',note:'Keep the ball below the net.',due_on:new Date(Date.now()+864e5).toISOString().slice(0,10)}));
  const practice=ok(await coach.post('/api/athletes/'+aid+'/development-blocks',{title:'Build the reset',problem:'Rushing the transition',constraint_text:'Find balance before contact',success_evidence:'7 of 10 stay low'}));
  ok(await coach.post('/api/athletes/'+aid+'/notes',{body:'Find balance, then move through the ball.',visibility:'shared'}));
  ok(await coach.post('/api/athletes/'+aid+'/notes',{body:'PRIVATE COACH NOTE MUST NOT LEAK',visibility:'private'}));
  const sid=uid();ok(await coach.post('/api/training/sessions',{id:sid,title:'Kitchen control',athletes:[aid],items:[{name:'Cross-court reset',measure:'reps'}]}));
  ok(await coach.put('/api/training/sessions/'+sid,{version:1,status:'complete'}));
  const plan=ok(await coach.post('/api/plans',{title:'Reset and recover',starts_at:new Date(Date.now()+864e5).toISOString(),timezone:'America/Chicago',location:'Main courts',coaches:'Brett',players:[{athlete_id:aid}],blocks:[{drill:'Dink ladder',instructions:'Start with control'}]}));
  ok(await coach.post('/api/plans/'+plan.id+'/invite'));
  const course=ok(await coach.post('/api/studio/courses',{title:'Reading the ball',summary:'Make time for your next decision.'}));
  s.app.db.prepare("UPDATE courses SET status='published' WHERE id=?").run(course.id);
  if(process.env.PREVIEW_ONLY){console.log('Local preview: '+s.base);await new Promise(()=>{});}
  browser=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{executablePath:'/usr/bin/chromium'});
  const errors=[],badResponses=[];
  const context=await browser.newContext({viewport:{width:1440,height:1100}});p=await context.newPage();
  p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.status()>=500)badResponses.push(r.url());});
  const go=async(hash,selector)=>{await p.goto(s.base+'/'+hash);await p.locator(selector||'.lab-workspace').first().waitFor();await p.evaluate(()=>document.fonts.ready);};
  const fit=async()=>assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),JSON.stringify(await p.evaluate(()=>({width:innerWidth,overflow:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>[e.tagName,e.className,e.getBoundingClientRect().width]),fonts:[...document.fonts].map(f=>[f.family,f.status])}))));
  await go('#/signin','.auth-wrap');await p.getByText('Other sign-in options',{exact:true}).click();
  await p.fill('#em','alex@lab.test');await p.fill('#pw','correct horse battery');await p.click('#f button[type=submit]');
  await p.locator('.lab-lesson').waitFor();await p.evaluate(()=>document.fonts.ready);
  assert.match(await p.locator('#app').innerText(),/Reset and recover/);assert.match(await p.locator('#app').innerText(),/Build the reset/);
  assert.doesNotMatch(await p.locator('body').innerText(),/PRIVATE COACH|New members|Administration/);
  assert.equal(await p.locator('.lab-sidebar').isVisible(),true);assert.equal(await p.evaluate(()=>[...document.fonts].every(f=>f.status==='loaded')),true,'Self-hosted fonts must load');await fit();
  await p.screenshot({path:path.join(out,'member-desktop.png'),fullPage:true});
  await p.locator('[data-task="'+assignment.id+'"]').check();await p.locator('.lab-task-status').filter({hasText:'Practice marked complete.'}).waitFor();
  assert.equal(ok(await member.get('/api/me/assignments')).find(a=>a.id===assignment.id).status,'done');
  await p.click('#lab-collapse');assert.ok(await p.locator('body.lab-compact-sidebar').count());
  await p.reload();await p.locator('.lab-lesson').waitFor();assert.ok(await p.locator('body.lab-compact-sidebar').count());await p.click('#lab-collapse');
  await p.fill('#lab-search','Kitchen');await p.locator('.lab-side-search').evaluate(f=>f.requestSubmit());
  await p.locator('#search-results .lab-record').waitFor();assert.match(await p.locator('#search-results').innerText(),/Kitchen control/);
  await p.locator('#search-results a').first().click();await p.locator('#app').getByRole('heading',{name:'Kitchen control',exact:true}).waitFor();
  await go('#/library','#library-results');await p.locator('#library-results').getByRole('heading',{name:'Reading the ball'}).waitFor();
  await p.click('[data-kind=course]');await p.fill('#library-search','missing word');await p.getByRole('heading',{name:'No matching resources.'}).waitFor();
  await p.fill('#library-search','Reading');await p.locator('#library-results a').first().click();await p.locator('#app').getByRole('heading',{name:'Reading the ball',exact:true}).waitFor();
  await go('#/reviews','.lab-review-note');assert.doesNotMatch(await p.locator('#app').innerText(),/PRIVATE COACH/);
  await go('#/journey/feedback','#message-body');await p.fill('#message-body','How can I give myself more time?');
  await p.locator('.journey-compose button[type=submit]').click();await p.locator('#message-status').filter({hasText:'Saved to your coaching notes.'}).waitFor();
  await go('#/reviews','.lab-review-note');assert.match(await p.locator('#app').innerText(),/How can I give myself more time/);
  // Follow the dashboard into the reading, editing, and feedback surfaces.
  const memberPages=[['practice','#/train','#developmentPath .dev-card'],['development','#/development/'+practice.id,'.dev-hero'],['library','#/library','#library-results article'],['reviews','#/reviews','.lab-review-note'],['feedback','#/journey/feedback','#message-body'],['progress','#/progress','#test-form']];
  for(const [name,hash,selector] of memberPages){
   await p.setViewportSize({width:1440,height:1100});await go(hash,selector);await fit();await p.screenshot({path:path.join(out,name+'-desktop.png'),fullPage:true});
   for(const width of [390,320]){await p.setViewportSize({width,height:844});await fit();if(width===390)await p.screenshot({path:path.join(out,name+'-phone.png'),fullPage:true});}
  }
  await go('#/','.lab-lesson');
  for(const width of [390,320,768]){await p.setViewportSize({width,height:844});await fit();assert.ok(await p.locator('.lab-sidebar').evaluate(e=>e.getBoundingClientRect().right<=0),'Closed phone drawer must be off screen');await p.screenshot({path:path.join(out,'member-'+width+'.png'),fullPage:true});}
  await p.setViewportSize({width:390,height:844});await p.click('#lab-menu');assert.ok(await p.locator('body.lab-drawer-open').count());
  assert.equal(await p.locator('#app').evaluate(e=>e.inert),true);await p.keyboard.press('Escape');assert.equal(await p.locator('#app').evaluate(e=>e.inert),false);
  await p.click('#lab-menu');await p.locator('.lab-sidebar a[href="#/library"]').click();await p.locator('#library-results').waitFor();assert.equal(await p.locator('body.lab-drawer-open').count(),0);
  await go('#/','.lab-lesson');await context.setOffline(true);await p.reload();await p.locator('.lab-lesson').waitFor();assert.match(await p.locator('.lab-load-notice').innerText(),/offline/);await context.setOffline(false);
  await context.close();
  const cc=await browser.newContext({viewport:{width:1440,height:1100}});p=await cc.newPage();p.on('pageerror',e=>errors.push(e.message));
  ok({status:(await cc.request.post(s.base+'/api/auth/login',{data:{email:'owner@lab.test',password:'correct horse battery'}})).status()});
  await go('#/','.lab-lesson');await fit();assert.match(await p.locator('#app').innerText(),/Alex Rivera/);assert.match(await p.locator('#app').innerText(),/1 waiting for review/);
  await p.screenshot({path:path.join(out,'coach-desktop.png'),fullPage:true});
  await p.setViewportSize({width:390,height:844});await fit();await p.screenshot({path:path.join(out,'coach-phone.png'),fullPage:true});
  await go('#/coach/queue?filter=review','.coach-queue');await fit();await p.screenshot({path:path.join(out,'queue-phone.png'),fullPage:true});await p.click('#coach-refresh');await p.locator('.coach-queue').waitFor();await p.locator('[data-reply]').first().click();await p.locator('.coach-inline textarea').fill('Pause, find balance, and choose the next ball.');await p.locator('.coach-inline button[type=submit]').click();
  await p.waitForFunction(()=>!document.querySelector('[data-reply]'));
  assert.ok(ok(await member.get('/api/athletes/'+aid)).notes.some(n=>n.body==='Pause, find balance, and choose the next ball.'));
  for(const [name,hash,selector] of [['athlete','#/coach/'+aid,'.coach-focus-card'],['lesson','#/coach/lesson/'+plan.id,'#lessonStart'],['program','#/coach/programs','#programBuilder']]){
   await p.setViewportSize({width:1440,height:1100});await go(hash,selector);await fit();await p.screenshot({path:path.join(out,name+'-desktop.png'),fullPage:true});
   for(const width of [390,320]){await p.setViewportSize({width,height:844});await fit();if(width===390)await p.screenshot({path:path.join(out,name+'-phone.png'),fullPage:true});}
  }
  await go('#/more','.lab-library-grid');assert.match(await p.locator('#app').innerText(),/Quick make \/ miss/);await fit();
  await cc.close();
  const nc=await browser.newContext({viewport:{width:390,height:844}});p=await nc.newPage();p.on('pageerror',e=>errors.push(e.message));
  await go('#/signup','.auth-wrap');await p.screenshot({path:path.join(out,'signup.png'),fullPage:true});
  await p.getByText('Create an account with a password',{exact:true}).click();await p.fill('#nm','New Member');await p.fill('#em','new-member@lab.test');await p.fill('#pw','correct horse battery');await p.locator('#f button[type=submit]').click();
  await p.waitForURL(/#\/welcome/);await p.locator('#welcome-form').waitFor();await p.screenshot({path:path.join(out,'welcome.png'),fullPage:true});
  await p.fill('#welcome-sport','Pickleball');await p.fill('#welcome-goals','Find more control.');await p.check('input[value=new]');await p.locator('#welcome-form button[type=submit]').click();await p.locator('.lab-lesson').waitFor();assert.match(await p.locator('#app').innerText(),/Make it count/);await fit();await p.screenshot({path:path.join(out,'new-member.png'),fullPage:true});
  assert.equal(errors.length,0,errors.join('\n'));assert.deepEqual(badResponses,[]);
  console.log('PASS: member and coach dashboards; practice, development, library, feedback, progress, athlete, lesson and program screens at desktop and 320/390px; 768px dashboard, sidebar, search, courses, task persistence, private-note isolation, feedback round-trip, offline cache, signup and welcome.');
  console.log('Screenshots: '+out);
 }catch(e){if(p)await p.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw e;}
 finally{await browser?.close();await s.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
