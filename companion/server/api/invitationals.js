'use strict';
const crypto=require('node:crypto');
const {HttpError,int,str}=require('../http');
const {tx,now}=require('../db');
const PRODUCTION_KEY={"kty":"EC","x":"HcESAGIXX4Pj2XSRSH77C4rkVeD7KTbNrVcYRtuhxSw","y":"n324iZUSVbK_EjWcXx-qgPJlskTIvq2H4GBIh-HTl-k","crv":"P-256"};
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const fail=(status,msg)=>{throw new HttpError(status,msg);};
const TOKEN=/^[0-9a-f]{64}$/;
const idValid=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,90}$/.test(s);
const emailKey=s=>String(s||'').trim().toLowerCase();
const ttl=20*60000;

function drillBlocks(plan){
  if(!plan.trim())return [];
  // Preserve long notes instead of discarding the overflow.
  const chunks=plan.trim().split(/\n\s*\n/).flatMap(s=>s.match(/[\s\S]{1,1950}/g)||[]);
  if(chunks.length>30) return plan.match(/[\s\S]{1,1950}/g).map((p,i)=>({title:'Lesson notes '+(i+1),instructions:p}));
  return chunks.map((chunk,i)=>{const [first,...rest]=chunk.trim().split('\n');
    return first.length<=120?{title:first||'Drill '+(i+1),instructions:rest.join('\n')}:{title:'Drill '+(i+1),instructions:chunk};
  });
}
module.exports=function invitationals(r,{db,auth},publicKey=PRODUCTION_KEY){
  const key=crypto.createPublicKey({key:publicKey,format:'jwk'});
  function accept(body){
    const {payload,signature}=body;
    if(typeof payload!=='string'||payload.length>100000||!/^([a-f0-9]{128})$/.test(signature||'')||
      !crypto.verify('sha256',Buffer.from(payload),{key,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'hex')))fail(403,'Invitationals signature required.');
    let p;try{p=JSON.parse(payload);}catch{fail(400,'Invalid handoff.');}
    if(p?.type==='connection' && p.aud==='lab-companion' && p.iss==='lab-invitationals' && Number.isSafeInteger(p.iat) && Math.abs(Date.now()-p.iat)<=120000)return {connected:true};
    if(!p||p.aud!=='lab-companion'||p.iss!=='lab-invitationals'||p.type!=='lesson'||!Number.isSafeInteger(p.iat)||Math.abs(Date.now()-p.iat)>120000||
      !idValid(p.nonce)||!idValid(p.event?.id)||!emailKey(p.coach)||!Number.isSafeInteger(p.revision)||p.revision<0)fail(400,'Reopen this event in Invitationals.');
    const e=p.event;
    if(!e.title||e.title.length>120||typeof e.plan!=='string'||e.plan.length>12000||!Number.isFinite(Date.parse(e.starts_at))||
      !Array.isArray(p.roster)||p.roster.length>128||new Set(p.roster.map(x=>x.key)).size!==p.roster.length||
      p.roster.some(x=>!TOKEN.test(x.key)||typeof x.name!=='string'||!x.name.trim()||x.name.length>100||typeof x.court!=='string'||x.court.length>200))fail(400,'Invalid event roster or lesson.');
    const ticket=crypto.randomBytes(32).toString('hex');
    tx(db,()=>{
      db.prepare('DELETE FROM invitational_tickets WHERE expires<=?').run(Date.now());
      if(db.prepare('SELECT 1 FROM invitational_tickets WHERE nonce=?').get(p.nonce))fail(409,'Reopen the event for a fresh link.');
      db.prepare('INSERT INTO invitational_tickets(token_hash,nonce,event_key,coach_email,revision,payload,expires) VALUES(?,?,?,?,?,?,?)').run(hash(ticket),p.nonce,e.id,emailKey(p.coach),p.revision,payload,Date.now()+ttl);
    });
    return {ticket};
  }
  r.post('/api/invitationals/receive',({body})=>accept(body));
  r.post('/api/invitationals/enter',({body,res})=>{
    const result=accept(body);
    if(result.connected)return result;
    res.writeHead(303,{Location:'/#/invitational/'+result.ticket,'Referrer-Policy':'no-referrer','Cache-Control':'no-store'});
    res.end();
  });
  function access(user,token){
    auth.require(user,'coach');
    const t=TOKEN.test(token)?db.prepare('SELECT * FROM invitational_tickets WHERE token_hash=? AND expires>?').get(hash(token),Date.now()):null;
    if(!t)fail(410,'This handoff expired. Open the event again in Invitationals.');
    if(t.coach_email!==emailKey(user.email))fail(403,'Sign in to Companion with the same coach email you used in Invitationals.');
    const newer=db.prepare('SELECT max(revision) AS rev FROM invitational_tickets WHERE event_key=?').get(t.event_key);
    if(newer.rev>t.revision)fail(409,'A newer event roster is available. Open the event again in Invitationals.');
    return JSON.parse(t.payload);
  }
  function groups(event,user){
    return db.prepare(`SELECT g.group_num,g.plan_id,p.owner_id,p.version,p.status,s.id AS session_id,s.status AS session_status
      FROM invitational_groups g JOIN plans p ON p.id=g.plan_id LEFT JOIN training_sessions s ON s.source_plan_id=p.id WHERE g.event_key=? ORDER BY g.group_num`).all(event).map(g=>{
      if(g.owner_id!==user.id && !auth.has(user,'admin'))return {group_num:g.group_num,other_coach:true};
      const players=db.prepare("SELECT invitational_key FROM plan_players WHERE plan_id=? AND rsvp!='out' AND invitational_key IS NOT NULL").all(g.plan_id);
      return {group_num:g.group_num,plan_id:g.plan_id,version:g.version,status:g.status,session_id:g.session_id,session_status:g.session_status,keys:players.map(x=>x.invitational_key)};
    });
  }
  const lookup=(user,playerKey)=>db.prepare('SELECT athlete_id FROM invitational_players WHERE coach_id=? AND player_key=?').get(user.id,playerKey)?.athlete_id;
  r.get('/api/invitationals/open/:token',({user,params})=>{
    const p=access(user,params.token);
    return {event:p.event,groups:groups(p.event.id,user),roster:p.roster.map(x=>{
      const id=lookup(user,x.key);
      return {...x,athlete_id:id&&auth.coachesAthlete(user,id)?id:null};
    })};
  });
  r.post('/api/invitationals/open/:token',({user,params,body})=>{
    const p=access(user,params.token),e=p.event;
    const n=int(body.group,'court group',{required:true,min:1,max:128});
    return tx(db,()=>{
      const g=db.prepare(`SELECT g.*,p.owner_id,p.version,p.status,s.id AS session_id,s.status AS session_status FROM invitational_groups g JOIN plans p ON p.id=g.plan_id LEFT JOIN training_sessions s ON s.source_plan_id=p.id WHERE g.event_key=? AND g.group_num=?`).get(e.id,n);
      if(g && g.owner_id!==user.id&&!auth.has(user,'admin'))fail(403,'Another coach is running this court group.');
      const requestHash=hash(JSON.stringify([p.nonce,n,body.players,body.first_drill||'']));
      if(g?.session_id)return {plan_id:g.plan_id,session_id:g.session_id,session_status:g.session_status};
      if(g && (g.status==='done'||g.status==='cancelled'))fail(409,'This lesson is closed.');
      if(g && g.last_request===requestHash)return {plan_id:g.plan_id};
      if(g && (g.version!==body.expected_version||p.revision<g.source_revision))fail(409,'This court group changed. Reopen the event before updating.');
      if(!Array.isArray(body.players)||!body.players.length||body.players.length>8||new Set(body.players.map(x=>x.key)).size!==body.players.length)fail(400,'Select one to eight confirmed players for this court group.');
      const selected=[],aids=new Set();
      for(const choice of body.players){
        const member=p.roster.find(x=>x.key===choice.key);if(!member)fail(400,'Select a confirmed event player.');
        const existing=lookup(user,choice.key);
        let aid=null;
        if(choice.athlete==='new'){
          if(existing)fail(409,'This player already has a saved link. Refresh the roster.');
          aid=Number(db.prepare('INSERT INTO athletes(name,created_by) VALUES(?,?)').run(member.name,user.id).lastInsertRowid);
          db.prepare('INSERT INTO coach_athletes(coach_id,athlete_id) VALUES(?,?)').run(user.id,aid);
        }else if(choice.athlete!==null && choice.athlete!==undefined){
          aid=int(choice.athlete,'athlete',{min:1,required:true});
          if(!db.prepare('SELECT 1 FROM athletes WHERE id=?').get(aid)||!auth.coachesAthlete(user,aid))fail(403,'Select an athlete on your coach roster.');
        }
        if(aid){
          if(aids.has(aid))fail(400,'Two event players cannot share an athlete profile.');aids.add(aid);
          const other=db.prepare('SELECT player_key FROM invitational_players WHERE coach_id=? AND athlete_id=? AND player_key!=?').get(user.id,aid,choice.key);
          if(other)fail(409,'That athlete is already linked to another Invitational identity.');
          if(existing && existing!==aid && choice.replace_link!==existing)fail(409,'This player’s saved profile changed. Refresh and confirm the correction.');
          db.prepare('INSERT INTO invitational_players(coach_id,player_key,athlete_id) VALUES(?,?,?) ON CONFLICT(coach_id,player_key) DO UPDATE SET athlete_id=excluded.athlete_id').run(user.id,choice.key,aid);
        }
        selected.push({...member,aid});
      }
      const title=e.title+' · Group '+n;
      const fallback=str(body.first_drill,'first drill',{max:120});
      const blocks=drillBlocks(e.plan);
      if(!blocks.length&&!g && !fallback)fail(400,'Add a first drill here or save a lesson plan in Invitationals.');
      let pid=g?.plan_id;
      if(!pid){
        pid=Number(db.prepare('INSERT INTO plans(owner_id,title,starts_at,timezone,location,sport,agenda) VALUES(?,?,?,?,?,?,?)').run(user.id,title,e.starts_at,'America/Chicago',e.location,e.sport,e.plan).lastInsertRowid);
        db.prepare('INSERT INTO invitational_groups(event_key,group_num,plan_id,source_revision,source_plan,last_request) VALUES(?,?,?,?,?,?)').run(e.id,n,pid,p.revision,e.plan,requestHash);
      }else{
        db.prepare('UPDATE plans SET title=?,starts_at=?,location=?,sport=?,version=version+1,updated_at=? WHERE id=?').run(title,e.starts_at,e.location,e.sport,now(),pid);
        db.prepare('UPDATE invitational_groups SET source_revision=?,source_plan=?,last_request=? WHERE plan_id=?').run(p.revision,e.plan,requestHash,pid);
      }
      if(!g || (e.plan!==g.source_plan && blocks.length)){
        db.prepare('DELETE FROM plan_blocks WHERE plan_id=?').run(pid);
        db.prepare('UPDATE plans SET agenda=? WHERE id=?').run(e.plan,pid);
        (blocks.length?blocks:[{title:fallback,instructions:''}]).forEach((b,i)=>db.prepare('INSERT INTO plan_blocks(plan_id,ord,drill,instructions) VALUES(?,?,?,?)').run(pid,i,b.title,b.instructions));
      }
      db.prepare("UPDATE plan_players SET rsvp='out' WHERE plan_id=? AND invitational_key IS NOT NULL").run(pid);
      for(const m of selected)db.prepare(`INSERT INTO plan_players(plan_id,invitational_key,athlete_id,name,court,rsvp,token,invitational_arrival) VALUES(?,?,?,?,?,'in',?,?)
        ON CONFLICT(plan_id,invitational_key) DO UPDATE SET athlete_id=excluded.athlete_id,name=excluded.name,court=excluded.court,rsvp='in',invitational_arrival=excluded.invitational_arrival`)
        .run(pid,m.key,m.aid,m.name,m.court,crypto.randomBytes(16).toString('hex'),m.arrival);
      return {plan_id:pid};
    });
  });
  r.get('/api/me/invitationals/:event',({user,params})=>{
    auth.require(user);
    const athlete=auth.ownAthleteId(user);
    if(!athlete||!idValid(params.event))return {sessions:[]};
    const sessions=db.prepare(`SELECT s.id,s.title,s.completed_at FROM invitational_groups g JOIN training_sessions s ON s.source_plan_id=g.plan_id
      JOIN training_athletes a ON a.session_id=s.id WHERE g.event_key=? AND a.athlete_id=? AND s.status='complete' ORDER BY s.completed_at DESC`).all(params.event,athlete);
    for(const s of sessions)s.practices=db.prepare(`SELECT b.id,b.title FROM development_blocks b WHERE b.athlete_id=? AND
      (b.source_session_id=? OR EXISTS(SELECT 1 FROM program_session_results r WHERE r.block_id=b.id AND r.session_id=? AND r.athlete_id=b.athlete_id)) ORDER BY b.id`).all(athlete,s.id,s.id);
    return {sessions};
  });
};
