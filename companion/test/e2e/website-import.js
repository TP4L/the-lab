/* Isolated acceptance test: import preview, commit, unified roster and history. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {start,uid}=require('../helpers');
(async()=>{
 const s=await start(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'lab-import-ui-'));let browser;
 try{
  s.app.config.publicUrl=s.base;
  const coach=s.client();await coach.signup('Owner','owner@lab.test');const a=(await coach.post('/api/athletes',{name:'Example Player'})).body.athlete;
  const wid=uid(),at='2026-09-21T00:00:00Z';s.app.db.prepare('INSERT INTO website_athlete_links(website_id,athlete_id) VALUES(?,?)').run(wid,a.id);
  const bundle={version:1,tables:{athletes:[{id:wid,data:JSON.stringify({id:wid,name:a.name,sport:'Pickleball'}),updated_at:at}],athlete_notes:[{id:uid(),athlete_id:wid,body:'Imported shared history',created_at:at}],coach_notes:[{id:uid(),athlete_id:wid,body:'Imported private history',created_at:at}],note_media:[],athlete_progress:[],athlete_coaching:[],athlete_messages:[]}};
  const file=path.join(dir,'history.json');fs.writeFileSync(file,JSON.stringify(bundle));
  browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium'});const p=await browser.newPage({viewport:{width:390,height:844}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(s.base+'/#/signin');await p.getByText('Other sign-in options',{exact:true}).click();await p.fill('#em','owner@lab.test');await p.fill('#pw','correct horse battery');await p.click('#f button[type=submit]');await p.waitForURL('**/#/');
  await p.goto(s.base+'/#/workspace');await p.locator('.workspace-player').waitFor();assert.equal(await p.locator('.workspace-player').count(),1);await p.getByRole('link',{name:'Import website history',exact:true}).click();await p.locator('#import-file').setInputFiles(file);await p.click('#import-preview');await p.locator('#import-commit').waitFor();assert.match(await p.locator('#import-result').innerText(),/1 matched athletes/);await p.click('#import-commit');await p.locator('#import-status').filter({hasText:'Import complete.'}).waitFor();
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await p.getByRole('link',{name:'Back to athletes'}).click();await p.locator('.workspace-player').click();await p.locator('[data-athlete-tab=notes]').click();assert.match(await p.locator('#app').innerText(),/Imported shared history/);assert.match(await p.locator('#app').innerText(),/Imported private history/);
  await p.goto(s.base+'/#/workspace/athlete/'+wid);await p.waitForURL('**/#/coach/'+a.id);assert.equal(errors.length,0,errors.join('\n'));
  console.log('Import UI, one roster, original notes, mobile fit and old-link redirect passed.');
 }finally{if(browser)await browser.close();await s.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
