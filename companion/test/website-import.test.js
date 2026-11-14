'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {start,uid}=require('./helpers');
async function setup(t,{fail=false,backup=false}={}){
 const token='d'.repeat(64),wid=uid(),at='2026-09-21T12:30:00.000Z',noteId=uid(),privateId=uid();let downloads=0;
 const backupDir=backup?fs.mkdtempSync(path.join(os.tmpdir(),'lab-import-backup-')):null;
 const s=await start({backupDir,fetchImpl:async(url,o)=>{const b=JSON.parse(o.body);if(b.action==='roster')return Response.json({athletes:[{id:wid,name:'Player Example',focus:'Full original focus'}]});assert.equal(b.action,'timeline-media');assert.equal(b.id,wid);assert.equal(o.headers.Authorization,'Bearer '+token);downloads++;if(fail&&downloads===2)return Response.json({error:'Unavailable'},{status:503});return new Response(Buffer.from('media fixture'),{headers:{'content-type':'image/png','content-length':'13'}});}});
 t.after(async()=>{await s.close();if(backupDir)fs.rmSync(backupDir,{recursive:true,force:true});});
 const coach=s.client(),signed=(await coach.signup('Brett','brettadamstp@gmail.com')).body;
 s.app.db.prepare('INSERT INTO website_staff_connections(user_id,subject,email,token,expires_at) VALUES(?,?,?,?,?)').run(signed.user.id,'test','brettadamstp@gmail.com',token,Date.now()+8640000);
 const a=(await coach.get('/api/athletes')).body[0];
 const bundle={version:1,tables:{athletes:[{id:wid,data:JSON.stringify({id:wid,name:a.name,focus:'Full original focus and more',phone:'PRIVATE CONTACT',sport:'Pickleball'}),updated_at:at}],athlete_notes:[{id:noteId,athlete_id:wid,body:'Original shared coaching note',created_at:at,tags:'General',status:'none',pinned:0}],coach_notes:[{id:privateId,athlete_id:wid,body:'PRIVATE COACH NOTE',created_at:at}],note_media:[1,2].map((_,i)=>({id:uid(),athlete_id:wid,note_id:noteId,kind:'shared',name:'Photo '+i,type:'image/png',caption:'Caption '+i,created_at:at})),athlete_progress:[{id:uid(),athlete_id:wid,data:JSON.stringify({goal:'Read the ball',improving:'Footwork',next:'Retest'}),created_at:at}],athlete_coaching:[{id:wid+':focus:2026-09-21',athlete_id:wid,kind:'focus',data:JSON.stringify({date:'2026-09-21',items:['PRIVATE FOCUS']}),created_at:at}],athlete_messages:[{id:uid(),athlete_id:wid,subject:'Prior email',body:'PRIVATE COMMUNICATION',recipient:'private@example.test',channel:'email',status:'sent',created_at:at}]}};
 async function preview(){const r=await coach.post('/api/admin/website-import/preview',{bundle});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
 return {s,coach,bundle,a,preview,backupDir,downloads:()=>downloads};
}
test('imports into the linked profile, preserves all histories and attachments, private records stay private, retries do not duplicate',async t=>{
 const {s,coach,bundle,a,preview,backupDir,downloads}=await setup(t,{backup:true});
 await coach.post('/api/athletes/'+a.id+'/notes',{body:'Existing app history',visibility:'shared'});
 const member=s.client();await member.signup('Player Example','member@example.test');const code=(await coach.post('/api/athletes/'+a.id+'/claim-code',{})).body.claim_code;assert.equal((await member.post('/api/claim',{code})).status,200);
 const p=await preview();assert.equal(p.matches[0].athlete_id,a.id);assert.equal(p.counts.newRecords,7);
 let out=await coach.post('/api/admin/website-import/commit',{bundle,fingerprint:p.fingerprint});assert.equal(out.status,200,JSON.stringify(out.body));assert(out.body.backupSaved);assert.equal(fs.readdirSync(backupDir).length,1);
 const app=s.app.db;assert.equal(app.prepare('SELECT COUNT(*) n FROM athletes').get().n,1);assert.equal(downloads(),2);assert.equal(app.prepare('SELECT COUNT(*) n FROM notes').get().n,6);
 const full=(await coach.get('/api/athletes/'+a.id)).body;assert.equal(full.athlete.focus,'Full original focus and more');assert.equal(full.website_original.phone,'PRIVATE CONTACT');const note=full.notes.find(n=>n.body==='Original shared coaching note');assert.equal(note.created_at,bundle.tables.athlete_notes[0].created_at);assert.equal(note.attachments.length,2);assert.deepEqual(note.attachments.map(m=>m.caption).sort(),['Caption 0','Caption 1']);assert(full.notes.some(n=>n.body==='Existing app history'));
 const own=await member.get('/api/athletes/'+a.id);assert.equal(own.status,200);assert(!JSON.stringify(own.body).includes('PRIVATE'));assert(own.body.notes.some(n=>n.body.includes('Progress check-in')));
 for(const media of note.attachments){assert.equal((await member.get('/api/media/'+media.id)).status,200);assert.equal((await s.client().get('/api/media/'+media.id)).status,404);}
 const history=(await member.get('/api/timeline')).body;assert.equal(history.sources.website.status,'merged');assert(!JSON.stringify(history).includes('PRIVATE'));
 const alias=await coach.get('/api/timeline?website='+bundle.tables.athletes[0].id);assert.equal(alias.status,200);assert.equal(alias.body.athlete.id,a.id);
 const second=await preview();out=await coach.post('/api/admin/website-import/commit',{bundle,fingerprint:second.fingerprint});assert(out.body.alreadyImported);assert.equal(downloads(),2);assert.equal(app.prepare('SELECT COUNT(*) n FROM notes').get().n,6);assert.equal(app.prepare('PRAGMA foreign_key_check').all().length,0);
 assert.equal((await member.post('/api/admin/website-import/preview',{bundle})).status,403);assert.equal((await coach.post('/api/admin/website-import/preview',{bundle},{Origin:'https://evil.test'})).status,403);
 bundle.tables.coach_notes[0].body='Changed';assert.equal((await coach.post('/api/admin/website-import/preview',{bundle})).status,409);
});
test('failed attachment copy leaves no partial profile, notes, media, or staged files',async t=>{
 const {s,coach,bundle,preview}=await setup(t,{fail:true});const p=await preview();const out=await coach.post('/api/admin/website-import/commit',{bundle,fingerprint:p.fingerprint});assert.equal(out.status,503);for(const table of ['notes','media','website_athlete_imports','website_record_imports','website_import_runs'])assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table);assert.equal(fs.readdirSync(s.app.config.mediaDir).length,0);
});
test('stale previews, unknown identities, duplicate names and missing note parents block mutation',async t=>{
 const {s,coach,bundle,a,preview}=await setup(t);const p=await preview();s.app.db.prepare("UPDATE athletes SET focus='Changed in app' WHERE id=?").run(a.id);assert.equal((await coach.post('/api/admin/website-import/commit',{bundle,fingerprint:p.fingerprint})).status,409);
 const copy=structuredClone(bundle);copy.tables.note_media[0].note_id=uid();assert.equal((await coach.post('/api/admin/website-import/preview',{bundle:copy})).status,409);
 copy.tables.athletes[0].id=uid();assert.equal((await coach.post('/api/admin/website-import/preview',{bundle:copy})).status,409);
 s.app.db.prepare('INSERT INTO athletes(name) VALUES(?)').run(a.name);assert.equal((await coach.post('/api/admin/website-import/preview',{bundle})).status,409);assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM notes').get().n,0);
});
