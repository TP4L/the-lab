'use strict';
// Imports an owner-supplied website export into already-linked app profiles.
// No profile/account deletion, no guessed identities, and no outgoing notices.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {HttpError}=require('../http');
const {tx,now}=require('../db');
const SITE='https://transcending-performance-lab.brettadamstp.chatgpt.site';
const TABLES=['athletes','athlete_notes','coach_notes','note_media','athlete_progress','athlete_coaching','athlete_messages'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TYPES={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','video/mp4':'.mp4','video/quicktime':'.mov','video/webm':'.webm'};
const canonical=v=>JSON.stringify(v&&typeof v==='object'?(Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))]))):v);
const hash=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
const norm=s=>String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
const bad=message=>{throw new HttpError(409,message);};
function parsed(s){try{const d=typeof s==='string'?JSON.parse(s):s;if(!d||typeof d!=='object'||Array.isArray(d))throw Error();return d;}catch{throw new HttpError(400,'Invalid record data.');}}
function text(v){return typeof v==='string'?v:'';}
function time(v){if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))throw new HttpError(400,'A record is missing its original date.');return v;}

module.exports=function(r,{db,auth,config}){
 let busy=false;
 function check(user,req){auth.require(user,'admin');if(req.headers.origin&&req.headers.origin!==config.publicUrl)throw new HttpError(403,'Open THE LAB to import athletes.');}
 function prepare(bundle){
  if(!bundle||bundle.version!==1||!bundle.tables||typeof bundle.tables!=='object')throw new HttpError(400,'Choose a supported website export.');
  for(const [key,rows] of Object.entries(bundle.tables))if(!TABLES.includes(key)||!Array.isArray(rows)||rows.length>500)throw new HttpError(400,'Unsupported or oversized export table: '+key);
  for(const key of TABLES)if(!Array.isArray(bundle.tables[key]))throw new HttpError(400,'Export is missing '+key+'.');
  const tables=bundle.tables,profiles=[],records=[],seen=new Set();
  for(const row of tables.athletes){
   if(!UUID.test(row.id)||seen.has(row.id))throw new HttpError(400,'Invalid or duplicate athlete ID.');seen.add(row.id);
   const data=parsed(row.data),a=db.prepare('SELECT a.* FROM athletes a JOIN website_athlete_links w ON w.athlete_id=a.id WHERE w.website_id=?').get(row.id);
   if(!a)bad('Connect the website roster first. No existing app profile is linked to '+text(data.name)+'.');
   if(norm(a.name)!==norm(data.name))bad('Review the identity match for '+text(data.name)+' before importing.');
   // Never silently choose between two local accounts or same-name profiles.
   const duplicates=db.prepare('SELECT id,name FROM athletes WHERE id<>?').all(a.id).filter(x=>norm(x.name)===norm(a.name));
   if(duplicates.length)bad('More than one app profile matches '+a.name+'. Resolve that identity before importing.');
   const old=db.prepare('SELECT profile FROM website_athlete_imports WHERE website_id=?').get(row.id);
   if(old&&canonical(JSON.parse(old.profile))!==canonical(row))bad('The website profile changed after import. Review '+a.name+' before importing it again.');
   profiles.push({website_id:row.id,a,data,original:row,at:time(row.updated_at),imported:!!old});
  }
  if(!profiles.length)throw new HttpError(400,'The export has no athletes.');
  const byId=new Map(profiles.map(p=>[p.website_id,p]));
  for(const table of TABLES.filter(t=>t!=='athletes'))for(const row of tables[table]){
   if(typeof row.id!=='string'||!row.id||row.id.length>200||!byId.has(row.athlete_id))throw new HttpError(400,'An export record has an invalid athlete or source ID.');
   const key=table+':'+row.id;if(seen.has(key))throw new HttpError(400,'Duplicate export record.');seen.add(key);
   const p=byId.get(row.athlete_id),entry={key,table,row,p,at:time(row.created_at),visibility:'private',body:''};
   if(table==='athlete_notes'||table==='coach_notes'){entry.body=text(row.body);entry.visibility=table==='athlete_notes'?'shared':'private';}
   if(table==='athlete_progress'){
    const d=parsed(row.data);entry.visibility='shared';entry.body='Progress check-in\n\n'+[['Goal',d.goal],['Improving',d.improving],['Working on',d.working],['Next step',d.next],['Checkpoint',d.checkpoint]].filter(([,v])=>text(v)).map(([k,v])=>k+': '+v).join('\n\n');
   }
   if(table==='athlete_coaching'){
    const d=parsed(row.data);
    // Website focus records are coach-only. Do not infer public visibility.
    if(row.kind!=='focus'||!Array.isArray(d.items)||d.items.some(v=>typeof v!=='string'))bad('This export contains a coaching record requiring a separate review.');
    entry.body='Session focus · '+text(d.date)+'\n\n'+d.items.join('\n');
   }
   if(table==='athlete_messages')entry.body='Website communication record\n\n'+[row.subject,row.body,'Channel: '+text(row.channel),'Status: '+text(row.status),row.recipient?'Recipient: '+row.recipient:''].filter(Boolean).join('\n\n');
   if(table==='note_media'){
    if(!UUID.test(row.id)||!TYPES[row.type]||!['shared','private'].includes(row.kind))bad('Unsupported attachment in the export.');
    const parentTable=row.kind==='shared'?'athlete_notes':'coach_notes';
    if(!tables[parentTable].some(n=>n.id===row.note_id&&n.athlete_id===row.athlete_id))bad('An attachment is missing its original note.');
    if(row.kind==='private')bad('Private attachments need a coach-authorized media export before importing.');
    entry.visibility=row.kind;
   }else if(!entry.body.trim()||entry.body.length>40000)throw new HttpError(400,'A note is empty or too long.');
   const old=db.prepare('SELECT * FROM website_record_imports WHERE source_key=?').get(key);
   if(old&&canonical(JSON.parse(old.original))!==canonical(row))bad('A source record changed after import. Review it before importing again.');
   if(old&&((table==='note_media'&&!old.media_id)||(table!=='note_media'&&!old.note_id)))bad('An imported record was removed in the app. Review it before restoring.');
   entry.old=old;records.push(entry);
  }
  const counts={athletes:profiles.length,notes:tables.athlete_notes.length+tables.coach_notes.length,progress:tables.athlete_progress.length,focus:tables.athlete_coaching.length,communications:tables.athlete_messages.length,attachments:tables.note_media.length,newRecords:records.filter(x=>!x.old).length};
  // Binds commit to source content and the current profile identities/fields.
  return {profiles,records,counts,fingerprint:hash({bundle,profiles:profiles.map(p=>p.a)})};
 }
 function summary(p){return {fingerprint:p.fingerprint,counts:p.counts,matches:p.profiles.map(p=>({website_id:p.website_id,athlete_id:p.a.id,name:p.a.name,alreadyImported:p.imported}))};}
 r.get('/api/admin/website-import',({user})=>{auth.require(user,'admin');return {runs:db.prepare('SELECT id,created_at,summary FROM website_import_runs ORDER BY created_at DESC LIMIT 10').all().map(r=>({...r,summary:JSON.parse(r.summary)}))};});
 r.post('/api/admin/website-import/preview',({user,req,body,res})=>{check(user,req);res.setHeader('Cache-Control','no-store');return summary(prepare(body.bundle));});
 r.post('/api/admin/website-import/commit',async({user,req,body,res})=>{
  check(user,req);res.setHeader('Cache-Control','no-store');if(busy)bad('An athlete import is already running. Refresh to check it.');
  let p=prepare(body.bundle);if(body.fingerprint!==p.fingerprint)bad('The roster changed. Preview the import again.');
  if(p.profiles.every(x=>x.imported)&&!p.counts.newRecords)return {...summary(p),alreadyImported:true};
  busy=true;const files=[],runId=crypto.randomUUID();let backup=null,committed=false;
  try{
   const media=p.records.filter(x=>x.table==='note_media'&&!x.old);
   if(media.length){
    const c=db.prepare('SELECT token FROM website_staff_connections WHERE user_id=? AND expires_at>?').get(user.id,Date.now());
    if(!user.workspace||!c)throw new HttpError(403,'Connect staff access to copy the original attachments.');
    for(const entry of media){
     const up=await config.fetchImpl(SITE+'/api/app-workspace',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.token},body:JSON.stringify({action:'timeline-media',id:entry.row.athlete_id,mediaId:entry.row.id,kind:'note'}),signal:AbortSignal.timeout(120000)});
     if(!up.ok||!up.body||up.headers.get('content-type')?.split(';')[0].trim()!==entry.row.type)throw new HttpError(503,'An original attachment could not be copied. No athlete records were changed.');
     const id=crypto.randomUUID(),file=id+TYPES[entry.row.type],dest=path.join(config.mediaDir,file);let size=0;
     files.push(dest);const limit=new Transform({transform(chunk,encoding,done){size+=chunk.length;done(size>200*1024*1024?new Error('Attachment exceeds 200 MB.'):null,chunk);}});
     await pipeline(Readable.fromWeb(up.body),limit,fs.createWriteStream(dest,{flags:'wx',mode:0o600}));
     const length=up.headers.get('content-length');if(!size||(length&&Number(length)!==size))throw new HttpError(503,'Attachment copy was incomplete. Retry the import.');
     entry.media={id,file,size};
    }
   }
   if(prepare(body.bundle).fingerprint!==p.fingerprint)bad('The roster changed while copying attachments. Preview again.');
   if(config.backupDir){fs.mkdirSync(config.backupDir,{recursive:true});backup='lab-import-'+runId+'.db';db.prepare('VACUUM INTO ?').run(path.join(config.backupDir,backup));}
   tx(db,()=>{
    for(const profile of p.profiles){
     const {a,data,website_id}=profile;
     db.prepare('INSERT OR IGNORE INTO website_athlete_imports VALUES(?,?,?,?,?)').run(website_id,a.id,JSON.stringify(profile.original),now(),user.id);
     // Fill empty fields and restore previously truncated source text; never replace a conflicting app value.
     if(!profile.imported)for(const key of ['sport','hand','side','rating','goals','focus','plan']){
      const incoming=text(data[key]||(key==='rating'?data.level:''));
      if(incoming&&(!a[key]||incoming.startsWith(a[key])))db.prepare('UPDATE athletes SET '+key+'=? WHERE id=?').run(incoming,a.id);
     }
     db.prepare('INSERT OR IGNORE INTO coach_athletes VALUES(?,?)').run(user.id,a.id);
    }
    for(const entry of p.records.filter(x=>x.table!=='note_media'&&!x.old)){
     let note=db.prepare('SELECT id FROM notes WHERE athlete_id=? AND visibility=? AND kind=\'coach\' AND body=? AND created_at=?').get(entry.p.a.id,entry.visibility,entry.body,entry.at);
     if(!note)note={id:Number(db.prepare('INSERT INTO notes(athlete_id,author_id,kind,visibility,body,created_at,updated_at) VALUES(?,?,\'coach\',?,?,?,?)').run(entry.p.a.id,user.id,entry.visibility,entry.body,entry.at,entry.at).lastInsertRowid)};
     db.prepare('INSERT INTO website_record_imports VALUES(?,?,?,?,NULL)').run(entry.key,entry.p.website_id,JSON.stringify(entry.row),note.id);
    }
    for(const entry of p.records.filter(x=>x.table==='note_media'&&!x.old)){
     const m=entry.media,n=db.prepare('SELECT note_id FROM website_record_imports WHERE source_key=?').get((entry.row.kind==='shared'?'athlete_notes:':'coach_notes:')+entry.row.note_id);
     db.prepare('INSERT INTO media(id,owner_id,athlete_id,visibility,mime,size,file,created_at) VALUES(?,?,?,?,?,?,?,?)').run(m.id,user.id,entry.p.a.id,entry.visibility,entry.row.type,m.size,m.file,entry.at);
     db.prepare('INSERT INTO note_attachments VALUES(?,?,?,?)').run(n.note_id,m.id,text(entry.row.name),text(entry.row.caption));
     db.prepare('INSERT INTO website_record_imports VALUES(?,?,?,NULL,?)').run(entry.key,entry.p.website_id,JSON.stringify(entry.row),m.id);
    }
    db.prepare('INSERT INTO website_import_runs VALUES(?,?,?,?,?)').run(runId,user.id,now(),JSON.stringify(p.counts),backup);
   });committed=true;
   return {...summary(p),runId,backupSaved:!!backup};
  }finally{busy=false;if(!committed)for(const f of files)fs.rmSync(f,{force:true});}
 });
};
