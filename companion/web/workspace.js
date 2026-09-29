/* Staff workspace: website records are read live and never cached on device. */
(function(){'use strict';window.LabPlugins=window.LabPlugins||[];window.LabPlugins.push(function(ctx){
 const L=window.Lab,h=L.h,root=()=>document.getElementById('app');
 const SITE='https://transcending-performance-lab.brettadamstp.chatgpt.site';
 const connect='<a class="btn primary" href="/api/site-bridge/signin/start?workspace=1">Connect staff access</a>';
 const canShow=()=>ctx.has('coach')||['brettadamstp@gmail.com','austinajie@gmail.com'].includes((ctx.me()?.user?.email||'').toLowerCase());
 async function request(body){const r=await fetch('/api/workspace',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Workspace unavailable. Please retry.');return d;}
 const date=v=>v?new Date(v).toLocaleDateString():'';
 const note=(n,privateNote)=>'<article class="journey-note"><p class="eyebrow">'+(privateNote?'Private · coaches only':'Shared with athlete')+' · '+h(date(n.created_at))+'</p><p class="journey-copy">'+h(n.body)+'</p></article>';
 function page(title,body){const host=document.createElement('div');host.className='journey';host.innerHTML=ctx.head('Coaching workspace',title,body);root().replaceChildren(host);return host;}
 function formSubmit(form,build,done){let pending=null;form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button[type=submit]'),status=form.querySelector('[role=status]');button.disabled=true;try{const body=build();pending=pending||body;if(JSON.stringify({...body,id:pending.id})!==JSON.stringify(pending)){status.textContent='A previous save was not confirmed. Refresh to check it before changing this request.';return;}await request(pending);pending=null;await done();}catch(e){status.textContent=e.message+' Your input is still here.';}finally{button.disabled=false;}};}
 function field(label,name,area=false,required=true,max=2000){return '<label class="flabel" for="ws-'+name+'">'+label+'</label><'+(area?'textarea':'input')+' id="ws-'+name+'" name="'+name+'" '+(required?'required ':'')+'maxlength="'+max+'"'+(area?'></textarea>':' type="text">');}
 ctx.routes.push([/^\/workspace$/,'workspace','home'],[/^\/workspace\/athlete\/([0-9a-f-]{36})$/,'workspaceAthlete','home']);
 const originalCoach=ctx.views.coach;
 ctx.routes.push([/^\/coach\/local$/,'localCoach','home']);
 ctx.views.localCoach=originalCoach;
 ctx.views.workspace=async function(){
  const host=page('Your workspace','Your existing athletes, notes and assignments.');
  host.innerHTML+='<div class="row">'+(ctx.has('coach')?'<a class="btn" href="#/coach/desk">Events desk</a><a class="btn" href="#/coach/templates">Session templates</a><a class="btn" href="#/coach/new">New app athlete</a>':'')+(ctx.has('editor','contributor')?'<a class="btn" href="#/studio">Publishing</a>':'')+'<a class="btn ghost" href="'+SITE+'/studio" target="_blank" rel="noopener">Full website workspace</a><button class="btn ghost" id="ws-refresh">Refresh athletes</button></div><p id="ws-loading" role="status">Loading your athlete rosters…</p><label class="flabel" for="ws-search">Find an athlete</label><input id="ws-search" type="search" placeholder="Search all connected athletes"><section class="stack" id="ws-roster"></section><section class="stack" id="ws-local"></section>';
  host.querySelector('#ws-refresh').onclick=()=>ctx.route();
  const results=await Promise.allSettled([request({action:'roster'}),ctx.has('coach')?L.api.request('GET','/api/athletes'):Promise.resolve([])]);
  if(!host.isConnected)return;
  host.querySelector('#ws-loading').remove();
  const website=results[0],local=results[1],slot=host.querySelector('#ws-roster');
  const siteAthletes=website.status==='fulfilled'?website.value.athletes:[];
  const localAthletes=local.status==='fulfilled'?local.value:[];
  if(website.status==='fulfilled'){
   const d=website.value;
   slot.innerHTML='<div class="journey-section"><h2>Existing website athletes · '+siteAthletes.length+'</h2><span class="tag">'+h(d.name)+'</span></div><p class="small muted">Your original website profiles and coaching history. Changes save to the same records.</p><div id="ws-players" class="journey-notes"></div><details class="more"><summary>Staff connection</summary><p>Connected as '+h(d.email)+'.</p>'+connect+' <button class="btn ghost" id="ws-disconnect">Disconnect staff access</button><p role="status" id="ws-connection-status"></p></details>';
   slot.querySelector('#ws-disconnect').onclick=async()=>{try{await request({action:'disconnect'});ctx.setMe(await L.api.request('GET','/api/me'));ctx.route();}catch(e){slot.querySelector('#ws-connection-status').textContent=e.message;}};
  }else{
   slot.innerHTML='<div class="card"><h2>Connect your existing website athletes</h2><p>Your website roster has not loaded. An empty app roster does not mean your website athletes are missing.</p><p role="status">'+h(website.reason.message)+'</p>'+connect+'<p class="small muted">Continue with Brett’s or Austin’s website account. Sign in to your existing app account first if prompted. You do not need to recreate athletes or claim a player profile.</p></div>';
  }
  const localSlot=host.querySelector('#ws-local');
  localSlot.innerHTML='<div class="journey-section"><h2>App training profiles · '+localAthletes.length+'</h2></div><p class="small muted">Profiles created in the app, with their app sessions and training assignments.</p><div id="ws-local-players" class="journey-notes"></div>';
  if(local.status==='rejected')localSlot.innerHTML='<div class="card"><h2>App roster unavailable</h2><p role="status">'+h(local.reason.message)+'</p></div>';
  const paint=term=>{
   const cards=(rows,source)=>rows.filter(a=>(a.name||'').toLowerCase().includes(term)).map(a=>'<a class="journey-note workspace-player" href="'+(source==='website'?'#/workspace/athlete/':'#/coach/')+h(a.id)+'"><div class="journey-section"><h3>'+h(a.name)+'</h3><span class="tag">'+(source==='website'?'Website':'App')+'</span></div><p class="small muted">'+h(a.focus||a.level||a.rating||'Player development')+'</p><span class="small">View notes · Assign training · Review</span></a>').join('');
   if(website.status==='fulfilled')slot.querySelector('#ws-players').innerHTML=cards(siteAthletes,'website')||'<p>'+(term?'No matching website athletes.':'No athlete records were returned by the website. Use Refresh athletes to check again.')+'</p>';
   if(local.status==='fulfilled')localSlot.querySelector('#ws-local-players').innerHTML=cards(localAthletes,'app')||'<p>'+(term?'No matching app profiles.':'No separate app training profiles. Your website athletes appear above once staff access is connected.')+'</p>';
  };paint('');host.querySelector('#ws-search').oninput=e=>paint(e.target.value.trim().toLowerCase());
 };
 // Every existing Coach Workspace link now opens the connected roster.
 ctx.views.coach=function(){return ctx.views.workspace();};
 ctx.views.workspaceAthlete=async function(id){
  const host=page('Athlete workspace','Loading the latest coaching record…');
  try{const d=await request({action:'athlete',id});if(!host.isConnected)return;
   const focuses=d.records.filter(r=>r.kind==='focus'),reflections=d.records.filter(r=>r.kind==='reflection');
   host.innerHTML='<a class="back" href="#/workspace">← Your workspace</a>'+ctx.head('Athlete coaching',d.athlete.name,'Website profile · changes save to this player’s existing history')+'<nav class="journey-tabs" aria-label="Athlete workspace sections">'+[['overview','Overview'],['assign','Assign training'],['notes','Notes'],['review','Reflections']].map(([key,label])=>'<button class="btn ghost" data-panel="'+key+'" aria-pressed="'+(key==='overview')+'">'+label+'</button>').join('')+'</nav><div id="ws-content"></div>';
   const content=host.querySelector('#ws-content');
   const render=section=>{
    host.querySelectorAll('[data-panel]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.panel===section?'true':'false'));
    if(section==='overview')content.innerHTML='<div class="journey-columns"><section class="stack"><h2>Training focuses</h2>'+(focuses.length?focuses.map(r=>'<article class="journey-note"><p class="eyebrow">'+h(r.data.status)+' · '+h(r.data.due||'No due date')+'</p><h3>'+h(r.data.title)+'</h3><p>'+h(r.data.practice)+'</p><p class="small muted">Retest: '+h(r.data.test)+'</p>'+(r.data.status==='approved'?'<form data-complete="'+h(r.id)+'"><label class="flabel">Outcome<textarea required maxlength="2000" name="outcome"></textarea></label><button type="submit" class="btn">Mark complete</button><p role="status"></p></form>':'')+'</article>').join(''):'<div class="card"><p>No training focus yet. Choose Assign training to set the next step.</p></div>')+'</section><aside class="stack"><div class="card"><h2>Player snapshot</h2>'+['goals','focus','notes','level','hand'].filter(k=>typeof d.athlete[k]==='string'&&d.athlete[k]).map(k=>'<div><p class="eyebrow">'+h(k)+'</p><p class="journey-copy">'+h(d.athlete[k])+'</p></div>').join('')+'</div><div class="card"><h2>Session plans</h2>'+(d.plans.length?d.plans.map(p=>'<p>'+h(p.title||p.name||'Session plan')+' · '+h(p.date||'')+'</p>').join(''):'<p>No linked session plans.</p>')+'<a href="'+SITE+'/athletes?id='+encodeURIComponent(id)+'" target="_blank" rel="noopener">Open full athlete record</a></div></aside></div>';
    if(section==='assign'){
     content.innerHTML='<form class="card form" id="ws-assign"><h2>Assign the next step</h2><p class="small muted">This publishes an approved focus to the player’s website profile and connected app coaching feed.</p>'+field('Focus title','title',false,true,150)+field('Why this matters','why',true)+field('What to practice','practice',true)+field('How to retest it','test',true)+'<label class="flabel" for="ws-due">Due date (optional)</label><input id="ws-due" name="due" type="date"><label class="flabel" for="ws-resource">Video or resource link (optional)</label><input id="ws-resource" name="resource" type="url" maxlength="2000" placeholder="https://…"><button class="btn primary" type="submit">Publish assignment to player</button><p role="status"></p></form>';
     const f=content.querySelector('form');formSubmit(f,()=>{const v=Object.fromEntries(new FormData(f));return {action:'assign',id:crypto.randomUUID(),data:{...v,athleteId:id,sourceNoteId:'',sourceSessionId:''}};},()=>{L.toast('Assignment published to the player’s coaching profile.');ctx.route();});
    }
    if(section==='notes'){
     content.innerHTML='<form class="card form" id="ws-note"><h2>Add a coaching note</h2><label class="flabel" for="ws-visibility">Who can see it?</label><select id="ws-visibility" name="visibility"><option value="private">Private · coaches only</option><option value="shared">Shared with athlete</option></select>'+field('Coaching note','body',true,true,5000)+'<button class="btn primary" type="submit">Save note</button><p role="status"></p></form><h2 class="workspace-subhead">Shared notes</h2><div class="journey-notes">'+(d.sharedNotes.length?d.sharedNotes.map(n=>note(n,false)).join(''):'<p>No shared notes yet.</p>')+'</div><h2 class="workspace-subhead">Private coaching notes</h2><div class="journey-notes">'+(d.privateNotes.length?d.privateNotes.map(n=>note(n,true)).join(''):'<p>No private notes yet.</p>')+'</div>';
     const f=content.querySelector('form');formSubmit(f,()=>({action:'note',id:crypto.randomUUID(),athleteId:id,...Object.fromEntries(new FormData(f))}),()=>{L.toast('Note saved.');ctx.route();});
    }
    if(section==='review')content.innerHTML='<div class="journey-notes">'+(reflections.length?reflections.map(r=>'<article class="journey-note"><p class="eyebrow">'+(r.data.reviewed?'Reviewed':'Needs review')+' · '+h(date(r.updated_at))+'</p><p><b>Worked:</b> '+h(r.data.worked)+'</p><p><b>Felt rushed:</b> '+h(r.data.rushed)+'</p><p><b>Try next:</b> '+h(r.data.retry)+'</p><form data-review="'+h(r.id)+'"><label class="flabel">Your feedback<textarea required name="feedback" maxlength="2000">'+h(r.data.feedback||'')+'</textarea></label><button class="btn primary" type="submit">Save feedback</button><p role="status"></p></form></article>').join(''):'<div class="card"><p>No player reflections to review yet.</p></div>')+'</div>';
    content.querySelectorAll('[data-complete],[data-review]').forEach(f=>{const review=!!f.dataset.review,r=d.records.find(r=>r.id===(f.dataset.review||f.dataset.complete));formSubmit(f,()=>({action:review?'review':'complete',id:r.id,revision:r.revision,...Object.fromEntries(new FormData(f))}),()=>{L.toast('Saved to the player’s coaching record.');ctx.route();});});
   };
   host.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>render(b.dataset.panel));render('overview');
  }catch(e){if(host.isConnected)host.innerHTML+='<p role="alert">'+h(e.message)+'</p><a class="btn" href="#/workspace">Back to workspace</a>';}
 };
 for(const key of ['home','profile']){const old=ctx.views[key];ctx.views[key]=async function(...args){await old(...args);if(!canShow()||!(location.hash==='#/'||location.hash===''||location.hash.startsWith('#/profile')))return;const entry=document.createElement('section');entry.className='workspace-entry';entry.innerHTML='<div><p class="eyebrow">Coach access</p><h2>Your workspace</h2><p>Athletes, notes, assignments and review.</p></div><a class="btn primary" href="#/workspace">Open workspace</a>';root().prepend(entry);};}
});})();
