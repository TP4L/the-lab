(function(){'use strict';window.LabPlugins=window.LabPlugins||[];window.LabPlugins.push(function(ctx){
 const L=window.Lab,h=L.h,api=L.api,root=()=>document.getElementById('app');
 const metrics=[['dash_15_seconds','15-yard dash','sec','lower',120],['dash_30_seconds','30-yard dash','sec','lower',120],['vertical_inches','Vertical jump','in','higher',100],['weight_lbs','Weight','lbs','none',1500],['height_inches','Height','in','none',120],['l_drill_seconds','L-drill','sec','lower',300]];
 const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
 const ws=async body=>{const r=await fetch('/api/workspace',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let d;try{d=await r.json();}catch{throw Error('Website unavailable. Retry shortly.');}if(!r.ok){const e=Error(d.error||'Connection unavailable.');e.status=r.status;throw e;}return d;};
 function mount(title,sub){root().innerHTML='<div class="journey">'+ctx.head('THE LAB',title,sub)+'<div class="row"><a class="btn" href="#/">My dashboard</a>'+(ctx.has('coach')?'<a class="btn" href="#/followups">Coach follow-ups</a><a class="btn" href="#/workspace">Athletes</a>':'')+'</div><div id="progress-content"></div></div>';return document.getElementById('progress-content');}
 function submit(form,build,send,done){let pending=null;form.onsubmit=async e=>{e.preventDefault();const controls=[...form.querySelectorAll('button,input,select,textarea')],status=form.querySelector('[role=status]');try{pending=pending||build();controls.forEach(x=>x.disabled=true);status.textContent='Saving…';await send(pending);pending=null;status.textContent='Saved.';await done();}catch(e){if(e.status>=400&&e.status<500)pending=null;status.textContent=e.message+' Your input is still here. Retry to confirm the same save.';}finally{controls.forEach(x=>x.disabled=!!pending&&x.tagName!=='BUTTON');}};}
 ctx.routes.push([/^\/progress$/,'myProgress','home'],[/^\/progress\/app\/(\d+)$/,'appProgress','home'],[/^\/progress\/website\/([0-9a-f-]{36})$/,'siteProgress','home'],[/^\/followups$/,'followups','home']);
 ctx.views.myProgress=async()=>{const me=await api.request('GET','/api/me');if(!me.athlete_id){const host=mount('Your progress','Connect an athlete profile to record measurements.');host.innerHTML='<a class="btn primary" href="#/profile">Open profile</a>';return;}return progress('app',me.athlete_id);};
 ctx.views.appProgress=id=>progress('app',id);ctx.views.siteProgress=id=>progress('website',id);
 async function progress(source,id){
  const host=mount('Your progress','Dated results, personal bests and the next retest.');host.innerHTML='<p role="status">Loading saved results…</p>';
  try{const d=await(source==='website'?ws({action:'progress',id}):api.request('GET','/api/athletes/'+id+'/progress'));if(!host.isConnected)return;
   const records=d.measurements||[],rows=records.slice().reverse();
   host.innerHTML='<h2>'+h(d.athlete.name)+'</h2><p class="small muted">Saved in '+h(d.source)+' · Checked '+h(new Date(d.checkedAt).toLocaleString())+'</p><div class="journey-notes">'+metrics.map(([key,label,unit,direction])=>{const values=rows.filter(r=>r.values[key]!=null).map(r=>r.values[key]);if(!values.length)return '<article class="journey-note"><h3>'+label+'</h3><p>Not tested yet</p></article>';const first=values[0],latest=values.at(-1),best=direction==='none'?null:Math[direction==='lower'?'min':'max'](...values);return '<article class="journey-note"><p class="eyebrow">'+label+'</p><h2>'+h(latest)+' '+unit+'</h2><p>Baseline '+h(first)+' '+unit+(best===null?'':' · Best '+h(best)+' '+unit)+'</p><p class="small">Change '+h((latest-first).toFixed(2))+' '+unit+'</p></article>';}).join('')+'</div>'+
   '<form class="card form" id="test-form"><h2>Record a test</h2><p class="small muted">Only fill in what was measured. Every save keeps a dated result.</p><div class="form-grid"><label>Test date<input type="date" name="date" required value="'+today()+'"></label><label>Sport<input name="sport" maxlength="80" value="'+h(d.athlete.sport||'')+'"></label>'+metrics.map(([k,l,u,,max])=>'<label>'+l+' ('+u+')<input name="'+k+'" type="number" inputmode="decimal" min="0.01" max="'+max+'" step="0.01"></label>').join('')+'<label>Retest on<input name="retestOn" type="date"></label></div><label>Test conditions / notes<textarea name="notes" maxlength="2000" placeholder="Timing method, surface, or anything to repeat next time"></textarea></label><button class="btn primary" type="submit">Save dated result</button><p role="status"></p></form>'+
   '<section class="stack"><h2>Measurement history</h2>'+history(records)+(d.localMeasurements?.length?'<details class="more"><summary>Earlier app measurements ('+d.localMeasurements.length+')</summary><p>Preserved app records from before this shared history. These have not been automatically merged.</p>'+history(d.localMeasurements)+'</details>':'')+'</section>';
   const form=host.querySelector('form');submit(form,()=>{const v=Object.fromEntries(new FormData(form)),values={sport:v.sport};metrics.forEach(([k])=>{if(v[k]!=='')values[k]=Number(v[k]);});return {id:L.uuid(),date:v.date,values,notes:v.notes,retestOn:v.retestOn};},data=>source==='website'?ws({action:'measurement',id,data}):api.request('POST','/api/athletes/'+id+'/progress',data),()=>ctx.route());
  }catch(e){host.innerHTML='<p role="alert">'+h(e.message)+'</p><button class="btn" id="progress-retry">Retry</button>';host.querySelector('button').onclick=()=>ctx.route();}
 }
 function history(records){return records.length?records.map(r=>'<article class="journey-note"><h3>'+h(r.date)+' · '+h(r.values.sport||'Test')+'</h3><p>'+metrics.filter(([k])=>r.values[k]!=null).map(([k,l,u])=>l+': '+h(r.values[k])+' '+u).join(' · ')+'</p><p class="journey-copy">'+h(r.notes||'')+'</p>'+(r.retestOn?'<p>Retest: '+h(r.retestOn)+(r.retestOn<today()?' · Due':'')+'</p>':'')+'</article>').join(''):'<p>No dated tests yet.</p>';}
 ctx.views.followups=async()=>{
  const host=mount('Coach follow-ups','Questions, overdue training and the next action for each athlete.');host.innerHTML='<p role="status">Loading your coaching queues…</p>';
  const result=await Promise.allSettled([api.request('GET','/api/coach/followups'),ws({action:'followups'})]);if(!host.isConnected)return;host.innerHTML='';
  result.forEach((r,i)=>{const source=i?'website':'app',section=document.createElement('section');section.className='stack';host.append(section);
   if(r.status==='rejected'){section.innerHTML='<div class="card"><h2>'+source+' connection</h2><p role="status">'+h(r.reason.message)+'</p>'+(i?'<a class="btn" href="/api/site-bridge/signin/start?workspace=1">Connect staff access</a>':'')+'</div>';return;}
   const d=r.value,open=d.tasks.filter(t=>t.status==='open');
   section.innerHTML='<h2>'+(i?'Website':'App')+' follow-ups</h2><p class="small muted">Checked '+h(new Date(d.checkedAt).toLocaleString())+'</p>'+
    (!i?(d.notes.map(n=>'<article class="journey-note"><p class="eyebrow">Needs review · '+h(n.name)+'</p><p class="journey-copy">'+h(n.body)+'</p>'+(n.media_id?'<a href="/api/media/'+h(n.media_id)+'" target="_blank" rel="noopener">Open attached photo / video</a>':'')+'<form data-note="'+n.id+'"><label>Your reply<textarea name="body" maxlength="5000" required></textarea></label><button class="btn primary" type="submit">Reply & mark reviewed</button><p role="status"></p></form></article>').join('')+d.assignments.map(a=>'<article class="journey-note"><p>Overdue · '+h(a.name)+' · '+h(a.due_on)+'</p><h3>'+h(a.title)+'</h3><a href="#/coach/'+a.athlete_id+'">Open athlete</a></article>').join('')):d.attention.map(a=>'<article class="journey-note"><h3>'+h(a.name)+'</h3><p>'+h(a.title)+'</p><a href="'+(a.kind==='training-review'?'https://transcending-performance-lab.brettadamstp.chatgpt.site/coach-review':'#/workspace/athlete/'+h(a.athleteId))+'">Review athlete</a></article>').join(''))+
    '<div class="journey-notes">'+open.map(t=>'<article class="journey-note"><h3>'+h(t.name)+' · '+h(t.title)+'</h3><p>'+h(t.due||'No due date')+' · '+h(i?(t.assignee||'Unassigned'):(d.coaches.find(c=>c.id===t.assignee)?.name||'Unassigned'))+'</p><button class="btn" data-done="'+h(t.id)+'">Mark done</button><p role="status"></p></article>').join('')+'</div>'+
    '<form class="card form" data-task><h3>Set a follow-up</h3><label>Athlete<select required name="athleteId"><option value="">Choose athlete</option>'+d.athletes.map(a=>'<option value="'+h(a.id)+'">'+h(a.name)+'</option>').join('')+'</select></label><label>Next action<input required name="title" maxlength="300" placeholder="Review video, publish recap, schedule retest…"></label><div class="form-grid"><label>Due date<input name="due" type="date"></label><label>Owner<select name="assignee"><option value="">Unassigned</option>'+(i?[{id:'brettadamstp@gmail.com',name:'Brett'},{id:'austinajie@gmail.com',name:'Austin'}]:d.coaches).map(c=>'<option value="'+h(c.id)+'">'+h(c.name)+'</option>').join('')+'</select></label></div><button class="btn" type="submit">Save follow-up</button><p role="status"></p></form>';
   section.querySelectorAll('[data-note]').forEach(f=>submit(f,()=>({client_id:L.uuid(),body:new FormData(f).get('body')}),b=>api.request('POST','/api/notes/'+f.dataset.note+'/reply',b),()=>ctx.route()));
   const send=b=>i?ws({action:'followup-save',data:b}):api.request('POST','/api/coach/followups',b);
   const f=section.querySelector('[data-task]');submit(f,()=>({...Object.fromEntries(new FormData(f)),id:L.uuid(),revision:0,status:'open'}),send,()=>ctx.route());
   section.querySelectorAll('[data-done]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await send({...open.find(t=>t.id===b.dataset.done),status:'done'});ctx.route();}catch(e){b.parentElement.querySelector('[role=status]').textContent=e.message;b.disabled=false;}});
  });
 };
 for(const [key,link]of [['coachAthlete',id=>'#/progress/app/'+id],['workspaceAthlete',id=>'#/progress/website/'+id],['profile',()=> '#/progress'],['workspace',()=> '#/followups']]){
  const old=ctx.views[key];ctx.views[key]=async function(...args){const hash=location.hash;await old(...args);if(location.hash!==hash)return;const nav=document.createElement('div');nav.className='row';nav.innerHTML='<a class="btn primary" href="'+link(args[0])+'">'+(key==='workspace'?'Coach follow-ups':'Measurements & progress')+'</a>';root().prepend(nav);};
 }
 ctx.views.journeyOverview=ctx.views.home;
 ctx.routes.push([/^\/journey\/overview$/,'journeyOverview','home']);
 ctx.views.home=async function(){
  const host=document.createElement('section');host.className='journey stack';root().replaceChildren(host);
  host.innerHTML=ctx.head('THE LAB','Today','Your next practice and how to score it.')+'<p role="status">Checking your program…</p>';
  const [blocks,assignments,site,measurements]=await Promise.allSettled([
   api.get('/api/me/development-blocks'),api.get('/api/me/assignments'),api.request('GET','/api/site-bridge/feed'),
   ctx.me()?.athlete_id ? api.get('/api/athletes/'+ctx.me().athlete_id+'/progress') : Promise.resolve(null)
  ]);
  if(!host.isConnected)return;
  const rows=blocks.value||[], rank={ready_retest:0,in_progress:1,assigned:2};
  const active=rows.filter(b=>b.status in rank).sort((a,b)=>rank[a.status]-rank[b.status]||(a.due_on||'9999').localeCompare(b.due_on||'9999'));
  const b=active[0],task=assignments.value?.find(a=>a.status==='open'),feed=site.value;
  const focus=feed?.records?.find(r=>r.kind==='focus'&&r.data.status==='approved')?.data;
  const training=feed?.assignments?.find(a=>a.status!=='resolved'),waiting=rows.find(b=>['evidence_submitted','coach_review'].includes(b.status));
  const retest=measurements.value?.measurements?.[0]?.retestOn;
  let item;
  if(b) item={label:b.status==='ready_retest'?'Retest':'Next practice',title:b.title,cue:b.retest_notes||b.constraint_text||b.problem,target:b.success_evidence,meta:[b.program_title && (b.program_title+' · Week '+(1+b.program_step)),b.practice_minutes&&b.practice_minutes+' min',b.due_on&&'Due '+b.due_on].filter(Boolean).join(' · '),action:'Open practice',href:'#/development/'+b.id};
  else if(task) item={label:'Assigned training',title:task.title,cue:task.note,action:'Open training',href:'#/train'};
  else if(focus) item={label:'Coach focus',title:focus.title,cue:focus.practice,target:focus.test,action:'Open assignment',href:'#/website'};
  else if(training) item={label:'Website training',title:training.title,cue:training.instructions,action:'Open training',href:'https://transcending-performance-lab.brettadamstp.chatgpt.site/members'};
  else if(waiting) item={label:'Coach review',title:waiting.title,cue:'Your result is with your coach.',action:'See your result',href:'#/development/'+waiting.id};
  else if(!ctx.me()?.athlete_id) item={label:'Get started',title:'Connect your athlete profile',action:'Open profile',href:'#/profile'};
  else item={label:'Next practice',title:'Check in with your coach',cue:'Tell your coach what happened the last time you played.',action:'Ask your coach',href:'#/journey/feedback'};
  host.innerHTML=ctx.head('THE LAB','Today','')+'<article class="journey-note today-focus"><p class="eyebrow">'+h(item.label)+'</p><h2>'+h(item.title)+'</h2>'+
   (item.cue?'<p>'+h(item.cue)+'</p>':'')+(b?.previous_feedback?'<p><b>From your coach</b><br>'+h(b.previous_feedback)+'</p>':'')+(item.target?'<p><b>How to score it</b><br>'+h(item.target)+'</p>':'')+(item.meta?'<p class="small">'+h(item.meta)+'</p>':'')+'<a class="btn primary" href="'+h(item.href)+'">'+h(item.action)+'</a></article>'+
   '<nav class="row" aria-label="Athlete sections"><a class="btn" href="#/programs">My program</a><a class="btn ghost" href="#/train">Training</a><a class="btn" href="#/progress">Progress</a><a class="btn ghost" href="#/journey/overview">Sessions &amp; tools</a></nav>'+
   (retest?'<p><a href="#/progress">Measurement retest · '+h(retest)+'</a></p>':'')+
   ([blocks,assignments].some(r=>r.status==='rejected')?'<p role="status">Some app assignments could not load. <button class="btn" id="practiceRetry">Retry</button></p>':'')+
   (site.status==='rejected'?'<p class="small"><a href="#/website">Check website coaching connection</a></p>':'');
  if(host.querySelector('#practiceRetry'))host.querySelector('#practiceRetry').onclick=()=>ctx.views.home();
 };
});})();
