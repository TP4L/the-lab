/* Fast session capture and its follow-ups: Review skills and Set next practice.
   Capture is a private coaching record. Observations describe a player in that session only. */
(function(){'use strict';window.LabPlugins=window.LabPlugins||[];window.LabPlugins.push(function(ctx){
 const L=window.Lab,h=L.h,api=L.api,Store=L.Store,root=()=>document.getElementById('app'),T=window.LabTags;
 const uid=()=>(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random());
 const day=v=>v?new Date(v.length===10?v+'T12:00:00':v).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}):'';
 const SETTING_LABEL={lesson:'Lesson',drill:'Drill',conditioned_play:'Conditioned play',match:'Match'};
 let dirtyGuard=null;
 function guard(isDirty,msg){
  if(dirtyGuard)window.removeEventListener('beforeunload',dirtyGuard);
  dirtyGuard=e=>{if(isDirty()){e.preventDefault();e.returnValue=msg;}};window.addEventListener('beforeunload',dirtyGuard);
  const onHash=()=>{window.removeEventListener('beforeunload',dirtyGuard);dirtyGuard=null;window.removeEventListener('hashchange',onHash);};
  window.addEventListener('hashchange',onHash);
 }

 /* ---------- tag chips: suggested, recent, custom ---------- */
 function tagBox(id,label,selected,pools){
  const sel=new Set(selected||[]);const seen=new Set();const chips=[];
  const push=(t,cls)=>{const k=t.toLowerCase();if(seen.has(k))return;seen.add(k);chips.push('<button type="button" class="chip tagchip'+(cls?' '+cls:'')+'" data-tag="'+h(t)+'" aria-pressed="'+sel.has(t)+'">'+h(t)+'</button>');};
  (selected||[]).forEach(t=>push(t,'picked'));(pools.recent||[]).slice(0,6).forEach(t=>push(t,'recent'));(pools.suggested||[]).slice(0,pools.compact?6:14).forEach(t=>push(t,''));
  const more=[];const pushMore=t=>{const k=t.toLowerCase();if(seen.has(k))return;seen.add(k);more.push('<button type="button" class="chip tagchip" data-tag="'+h(t)+'" aria-pressed="false">'+h(t)+'</button>');};(pools.suggested||[]).forEach(pushMore);(pools.recent||[]).forEach(pushMore);
  return '<div class="tagbox" id="'+h(id)+'"><div class="tagbox-head"><span class="lab-g-label">'+h(label)+'</span><span class="small muted tagbox-count"></span></div><div class="chips tagbox-chips">'+chips.join('')+(more.length?'<details class="tagbox-more"><summary class="chip">More tags</summary><div class="chips">'+more.join('')+'</div></details>':'')+'</div><div class="row tagbox-add"><input type="text" maxlength="40" placeholder="Add a tag" aria-label="Add a tag"><button type="button" class="btn sm">Add</button></div></div>';
 }
 function bindTagBox(el,onChange){
  const chipsEl=el.querySelector('.tagbox-chips'),count=el.querySelector('.tagbox-count');
  const refresh=()=>{const n=readTags(el).length;count.textContent=n?n+' selected':'';if(onChange)onChange(readTags(el));};
  chipsEl.addEventListener('click',e=>{const b=e.target.closest('.tagchip');if(!b)return;b.setAttribute('aria-pressed',String(b.getAttribute('aria-pressed')!=='true'));refresh();});
  const input=el.querySelector('input'),add=()=>{const t=input.value.trim().replace(/\s+/g,' ').slice(0,40);if(!t)return;const ex=[...chipsEl.querySelectorAll('.tagchip')].find(x=>x.dataset.tag.toLowerCase()===t.toLowerCase());if(ex)ex.setAttribute('aria-pressed','true');else chipsEl.insertAdjacentHTML('afterbegin','<button type="button" class="chip tagchip picked" data-tag="'+h(t)+'" aria-pressed="true">'+h(t)+'</button>');input.value='';refresh();};
  el.querySelector('.tagbox-add .btn').onclick=add;input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();add();}});
  refresh();
 }
 const readTags=el=>[...el.querySelectorAll('.tagchip[aria-pressed="true"]')].map(b=>b.dataset.tag);

 /* ---------- capture form (new or edit) ---------- */
 ctx.routes.push([/^\/coach\/capture$/,'captures','home'],[/^\/coach\/capture\/new$/,'captureNew','home'],[/^\/coach\/capture\/([0-9a-f-]{36})$/,'captureEdit','home'],[/^\/coach\/(\d+)\/practice\/new$/,'practiceNew','home'],[/^\/coach\/practices\/(\d+)$/,'practiceDraft','home'],[/^\/coach\/(\d+)\/practices$/,'athletePractices','home']);
 ctx.views.captureNew=(_,query)=>captureForm(null,query||{});
 ctx.views.captureEdit=id=>captureForm(id,{});
 async function captureForm(id,query){
  if(!ctx.has('coach'))return ctx.forbidden('Only coaches can capture sessions.');
  const host=document.createElement('div');host.className='journey cap-page';root().replaceChildren(host);host.innerHTML='<p class="muted small" role="status">Loading…</p>';
  const [meta,existing]=await Promise.all([api.request('GET','/api/captures/meta'),id?api.request('GET','/api/captures/'+id):null]);if(!host.isConnected)return;
  const draftKey='capture-draft:'+ctx.me().user.id+':'+(id||'new');
  const saved=Store.get(draftKey,null);
  const base=existing||{format:query.format||'private_lesson',occurred_on:meta.today,name:'',sport:'pickleball',duration_min:null,focus_tags:[],notes:'',players:[],version:0};
  if(query.athlete&&!existing){const a=meta.roster.find(x=>String(x.id)===String(query.athlete));if(a)base.players=[{athlete_id:a.id,name:a.name,linked:true,attributes:[],observation:''}];}
  const state=saved&&(!existing||saved.version===existing.version)?Object.assign({},base,saved,{players:saved.players||base.players}):base;
  state.client_key=state.client_key||uid();
  const rosterOpts=meta.roster.map(a=>'<option value="'+a.id+'">'+h(a.name)+'</option>').join('');
  const player=(p,i)=>'<fieldset class="cap-player" data-i="'+i+'"><legend><span class="cap-player-name">'+h(p.name||p.guest_name||'Player')+'</span>'+(p.athlete_id?'<span class="tag ok">Roster</span>':'<span class="tag">Name only</span>')+'<button type="button" class="th-act cap-remove" aria-label="Remove player">Remove</button></legend>'+tagBox('ptags-'+i,'Attributes in this session',p.attributes,{recent:meta.recent.player,suggested:[...meta.frequent.player,...meta.suggested.player],compact:true})+'<input type="text" class="cap-obs" maxlength="2000" placeholder="One line about this player today (optional)" value="'+h(p.observation||'')+'"></fieldset>';
  host.innerHTML='<a class="back" href="'+(id?'#/coach/capture':'#/coach/today')+'">← '+(id?'Capture history':'Coach today')+'</a>'+ctx.head('Capture',id?'Edit capture':'Capture session','Format, date, who was there, a few tags. Notes can wait.')+
   '<form class="card form cap-form" id="capf" novalidate>'+
   '<div class="field"><span class="flabel">Format</span><div class="seg-btns cap-formats">'+Object.entries(meta.formats).map(([k,v])=>'<button type="button" data-format="'+k+'" aria-pressed="'+(state.format===k)+'">'+h(v)+'</button>').join('')+'</div></div>'+
   '<div class="form-grid"><div class="field"><label class="flabel" for="capDate">Date</label><input id="capDate" type="date" value="'+h(state.occurred_on)+'" max="'+meta.today+'"></div><div class="field"><label class="flabel" for="capName">Session name <span class="hint">optional</span></label><input id="capName" type="text" maxlength="120" value="'+h(state.name||'')+'" placeholder="Saturday clinic"></div></div>'+
   '<details class="more"'+(state.sport!=='pickleball'||state.duration_min?' open':'')+'><summary>Sport and duration</summary><div class="form-grid"><div class="field"><label class="flabel" for="capSport">Sport</label><select id="capSport">'+meta.sports.map(x=>'<option value="'+x+'"'+(state.sport===x?' selected':'')+'>'+x[0].toUpperCase()+x.slice(1)+'</option>').join('')+'</select></div><div class="field"><label class="flabel" for="capDur">Duration (minutes)</label><input id="capDur" type="number" inputmode="numeric" min="5" max="600" value="'+(state.duration_min||'')+'"></div></div></details>'+
   '<div class="field">'+tagBox('ftags','Session focus',state.focus_tags,{recent:meta.recent.focus,suggested:[...meta.frequent.focus,...meta.suggested.focus]})+'</div>'+
   '<div class="field cap-players-field"><div class="head-row"><span class="flabel">Players</span><span class="small muted" id="capCount"></span></div><div class="row cap-addrow"><select id="capRoster" aria-label="Add from roster"><option value="">Add from roster…</option>'+rosterOpts+'</select><input id="capGuest" type="text" maxlength="80" placeholder="Or a name for today" aria-label="Add by name"><button type="button" class="btn sm" id="capAddGuest">Add</button></div><div id="capPlayers" class="cap-players">'+state.players.map(player).join('')+'</div><p class="small muted">Attributes describe the player in this session only. They never change the athlete profile.</p></div>'+
   '<details class="more"'+(state.notes?' open':'')+'><summary>Session notes</summary><div class="field"><textarea id="capNotes" rows="4" maxlength="5000" placeholder="Optional. You can come back and add these later.">'+h(state.notes||'')+'</textarea></div></details>'+
   '<div class="row cap-save"><button class="btn primary" type="submit">'+(id?'Save changes':'Save capture')+'</button><span class="small muted" id="capState"></span></div></form>';
  const f=host.querySelector('#capf');let dirty=!!saved;
  const read=()=>({client_key:state.client_key,version:state.version,format:f.querySelector('.cap-formats [aria-pressed="true"]').dataset.format,occurred_on:f.querySelector('#capDate').value,name:f.querySelector('#capName').value.trim(),sport:f.querySelector('#capSport').value,duration_min:f.querySelector('#capDur').value?Number(f.querySelector('#capDur').value):null,focus_tags:readTags(f.querySelector('#ftags')),notes:f.querySelector('#capNotes').value,
   players:[...f.querySelectorAll('.cap-player')].map((el,i)=>{const p=state.players[Number(el.dataset.i)]||{};const out={attributes:readTags(el.querySelector('.tagbox')),observation:el.querySelector('.cap-obs').value.trim(),name:p.name||p.guest_name||'',guest_name:p.guest_name||'',linked:!!p.athlete_id};if(p.id)out.id=p.id;if(p.athlete_id)out.athlete_id=p.athlete_id;return out;})});
  const persist=()=>{dirty=true;const v=read();Store.set(draftKey,Object.assign(v,{players:v.players.map((p,i)=>Object.assign({},state.players[i]||{},p))}));host.querySelector('#capState').textContent='Draft kept on this device';};
  const renderPlayers=()=>{host.querySelector('#capPlayers').innerHTML=state.players.map(player).join('');host.querySelectorAll('.cap-player .tagbox').forEach(el=>bindTagBox(el,persist));host.querySelectorAll('.cap-remove').forEach(b=>b.onclick=()=>{state.players.splice(Number(b.closest('.cap-player').dataset.i),1);renderPlayers();persist();});host.querySelector('#capCount').textContent=state.players.length?state.players.length+' player'+(state.players.length===1?'':'s'):'No players yet. You can save and add them later.';};
  renderPlayers();bindTagBox(host.querySelector('#ftags'),persist);
  f.querySelectorAll('.cap-formats button').forEach(b=>b.onclick=()=>{f.querySelectorAll('.cap-formats button').forEach(x=>x.setAttribute('aria-pressed','false'));b.setAttribute('aria-pressed','true');persist();});
  f.addEventListener('input',persist);
  host.querySelector('#capRoster').onchange=e=>{const idv=Number(e.target.value);if(!idv)return;const a=meta.roster.find(x=>x.id===idv);if(a&&!state.players.some(p=>p.athlete_id===idv)){const cur=read().players;state.players=cur.map((p,i)=>Object.assign({},state.players[i],p));state.players.push({athlete_id:a.id,name:a.name,linked:true,attributes:[],observation:''});renderPlayers();persist();}e.target.value='';};
  host.querySelector('#capAddGuest').onclick=()=>{const inp=host.querySelector('#capGuest'),name=inp.value.trim();if(!name)return;const cur=read().players;state.players=cur.map((p,i)=>Object.assign({},state.players[i],p));state.players.push({guest_name:name,name,linked:false,attributes:[],observation:''});inp.value='';renderPlayers();persist();};
  guard(()=>dirty,'You have an unsaved capture.');
  f.onsubmit=async e=>{
   e.preventDefault();const btn=f.querySelector('button[type=submit]');btn.disabled=true;host.querySelector('#capState').textContent='Saving…';
   const payload=read();
   try{
    const r=id?await api.request('PUT','/api/captures/'+id,payload):await api.request('POST','/api/captures',payload);
    Store.del(draftKey);dirty=false;L.toast('Capture saved');location.hash='#/coach/capture/'+r.id+'/next';
   }catch(err){btn.disabled=false;host.querySelector('#capState').textContent='Not saved. Your entries are kept here.';L.formError(f,err.status===409?err.message+' Your edits are kept on this device.':err.status===0?'Offline. Your entries are kept on this device; try again when you have signal.':err.message);}
  };
 }

 /* ---------- after save: next steps per athlete ---------- */
 ctx.routes.push([/^\/coach\/capture\/([0-9a-f-]{36})\/next$/,'captureNext','home']);
 ctx.views.captureNext=async function(id){
  if(!ctx.has('coach'))return ctx.forbidden('Only coaches can see captures.');
  const host=document.createElement('div');host.className='journey cap-page';root().replaceChildren(host);host.innerHTML='<p class="muted small" role="status">Loading…</p>';
  const [c,meta]=await Promise.all([api.request('GET','/api/captures/'+id),api.request('GET','/api/captures/meta')]);if(!host.isConnected)return;
  const rosterOpts=meta.roster.map(a=>'<option value="'+a.id+'">'+h(a.name)+'</option>').join('');
  host.innerHTML='<a class="back" href="#/coach/today">← Coach today</a>'+ctx.head('Saved',c.name||c.format_label,h(day(c.occurred_on))+(c.duration_min?' · '+c.duration_min+' min':'')+(c.focus_tags.length?' · '+c.focus_tags.join(', '):''))+
   '<div class="row"><a class="btn" href="#/coach/capture/'+c.id+'">Add notes or edit</a><a class="btn ghost" href="#/coach/capture/new">Capture another</a></div>'+
   '<section class="stack"><p class="section-title">Next step for each player</p>'+(c.players.length?'<div class="list">'+c.players.map(p=>'<div class="li cap-next" data-pid="'+p.id+'"><span class="main-col"><span class="t">'+h(p.name)+'</span><span class="d">'+(p.attributes.length?p.attributes.map(a=>'<span class="lab-pill">'+h(a)+'</span>').join(' '):'<span class="muted">No attributes</span>')+(p.observation?'<br>'+h(p.observation):'')+'</span>'+
     (p.linked?'<span class="row cap-next-actions"><a class="btn sm primary" href="#/coach/'+p.athlete_id+'/skills/rate?date='+c.occurred_on+'&setting='+c.default_setting+'&capture='+c.id+'">Review skills</a><a class="btn sm" href="#/coach/'+p.athlete_id+'/practice/new?capture='+c.id+'">Set next practice</a><a class="th-act" href="#/coach/'+p.athlete_id+'">Record</a></span>':'<span class="row cap-next-actions"><select class="cap-link" aria-label="Connect to athlete"><option value="">Connect to an athlete record…</option>'+rosterOpts+'</select><span class="small muted">Follow-ups need a connected athlete.</span></span>')+'</span></div>').join('')+'</div>':'<div class="list"><p class="empty">No players yet. <a href="#/coach/capture/'+c.id+'">Add them</a> when you have a minute.</p></div>')+'</section>';
  host.querySelectorAll('.cap-link').forEach(sel=>sel.onchange=async()=>{const aid=Number(sel.value);if(!aid)return;sel.disabled=true;try{await api.request('POST','/api/captures/'+id+'/players/'+sel.closest('.cap-next').dataset.pid+'/link',{athlete_id:aid});L.toast('Connected');ctx.route();}catch(e){sel.disabled=false;L.toast(e.message);}});
 };

 /* ---------- history ---------- */
 ctx.views.captures=async function(_,query){
  if(!ctx.has('coach'))return ctx.forbidden('Only coaches can see captures.');
  const host=document.createElement('div');host.className='journey cap-page';root().replaceChildren(host);host.innerHTML='<p class="muted small" role="status">Loading…</p>';
  const q=query||{};const qs=new URLSearchParams();for(const k of ['q','format','athlete'])if(q[k])qs.set(k,q[k]);
  const [d,meta]=await Promise.all([api.request('GET','/api/captures?'+qs.toString()),api.request('GET','/api/captures/meta')]);if(!host.isConnected)return;
  const link=(k,v)=>{const p=new URLSearchParams(qs);if(v)p.set(k,v);else p.delete(k);return '#/coach/capture?'+p.toString();};
  host.innerHTML='<a class="back" href="#/coach/today">← Coach today</a><div class="head-row">'+ctx.head('Capture','Session history','Every session you captured, searchable by player, format and tag.')+'<a class="btn primary" href="#/coach/capture/new">Capture session</a></div>'+
   '<form class="card form cap-filters" id="capsearch"><div class="row"><input type="search" id="capQ" placeholder="Search players, tags, notes" value="'+h(q.q||'')+'" style="flex:1;min-width:180px"><select id="capAth" aria-label="Athlete"><option value="">All athletes</option>'+meta.roster.map(a=>'<option value="'+a.id+'"'+(String(q.athlete)===String(a.id)?' selected':'')+'>'+h(a.name)+'</option>').join('')+'</select><button class="btn sm" type="submit">Search</button></div><div class="row">'+'<a class="chip" aria-pressed="'+(!q.format)+'" href="'+link('format','')+'">All formats</a>'+Object.entries(meta.formats).map(([k,v])=>'<a class="chip" aria-pressed="'+(q.format===k)+'" href="'+link('format',k)+'">'+h(v)+'</a>').join('')+'</div></form>'+
   (d.captures.length?'<div class="list">'+d.captures.map(c=>'<a class="li" href="#/coach/capture/'+c.id+'/next"><span class="main-col"><span class="t">'+h(c.name||c.format_label)+(c.name?' <span class="muted small">· '+h(c.format_label)+'</span>':'')+'</span><span class="d">'+h(day(c.occurred_on))+' · '+c.players.length+' player'+(c.players.length===1?'':'s')+(c.unlinked?' · '+c.unlinked+' to connect':'')+(c.has_notes?' · notes':'')+'</span>'+(c.focus_tags.length?'<span class="d">'+c.focus_tags.map(t=>'<span class="lab-pill">'+h(t)+'</span>').join(' ')+'</span>':'')+'<span class="d">'+c.players.map(p=>h(p.name)).join(', ')+'</span></span></a>').join('')+'</div>':'<div class="list"><p class="empty">Nothing matches. <a href="#/coach/capture/new">Capture a session</a>.</p></div>');
  host.querySelector('#capsearch').onsubmit=e=>{e.preventDefault();const p=new URLSearchParams(qs);const qv=host.querySelector('#capQ').value.trim(),av=host.querySelector('#capAth').value;qv?p.set('q',qv):p.delete('q');av?p.set('athlete',av):p.delete('athlete');location.hash='#/coach/capture?'+p.toString();};
 };

 /* ---------- Set next practice (draft) ---------- */
 ctx.views.practiceNew=async function(id,query){
  if(!ctx.has('coach'))return ctx.forbidden('Only coaches can write practices.');
  const host=document.createElement('div');host.className='journey cap-page';root().replaceChildren(host);host.innerHTML='<p class="muted small" role="status">Loading…</p>';
  const q=query||{};
  const [athlete,cap,blocks]=await Promise.all([api.request('GET','/api/athletes/'+id),q.capture?api.request('GET','/api/captures/'+q.capture).catch(()=>null):null,api.request('GET','/api/athletes/'+id+'/development-blocks')]);if(!host.isConnected)return;
  const a=athlete.athlete||athlete;const me=cap?cap.players.find(p=>String(p.athlete_id)===String(id)):null;
  const contextLines=[];if(cap){contextLines.push((cap.name||cap.format_label)+' · '+day(cap.occurred_on));if(cap.focus_tags.length)contextLines.push('Session focus: '+cap.focus_tags.join(', '));if(me&&me.attributes.length)contextLines.push(a.name.split(' ')[0]+': '+me.attributes.join(', '));if(me&&me.observation)contextLines.push('Observation: '+me.observation);}
  const draftKey='practice-new:'+ctx.me().user.id+':'+id+':'+(q.capture||'none');const saved=Store.get(draftKey,{});
  const open=blocks.filter(b=>!b.draft&&b.status!=='mastered');
  host.innerHTML='<a class="back" href="'+(q.capture?'#/coach/capture/'+q.capture+'/next':'#/coach/'+id)+'">← '+(q.capture?'Capture':h(a.name))+'</a>'+ctx.head('Practice',a.name.split(' ')[0]+'’s next practice','Private draft first. Nothing reaches '+h(a.name.split(' ')[0])+' until you approve and share it.')+
   (contextLines.length?'<aside class="card cap-context"><p class="eyebrow">Private coaching context</p><ul>'+contextLines.map(x=>'<li>'+h(x)+'</li>').join('')+'</ul><p class="small muted">Visible to coaches only. It is not copied into the practice.</p></aside>':'')+
   (open.length?'<p class="small muted">'+h(a.name.split(' ')[0])+' already has '+open.length+' open practice'+(open.length===1?'':'s')+'. A new one does not hide them.</p>':'')+
   '<form class="card form prac-form" id="pracf" novalidate>'+
   '<div class="field"><label class="flabel" for="prFocus">Focus <span class="hint">what we are working on</span></label><input id="prFocus" type="text" maxlength="120" required value="'+h(saved.title||(me&&me.attributes[0]?'':''))+'" placeholder="Earlier contact on the third ball"></div>'+
   '<div class="field"><label class="flabel" for="prReason">Reason <span class="hint">why it matters</span></label><textarea id="prReason" rows="2" maxlength="2000" placeholder="Late contact is why the drops pop up.">'+h(saved.reason||'')+'</textarea></div>'+
   '<div class="field"><label class="flabel" for="prPractice">Practice <span class="hint">what to do</span></label><textarea id="prPractice" rows="3" maxlength="1000" required placeholder="Shadow 20 third balls with contact in front of the hip.">'+h(saved.constraint_text||'')+'</textarea></div>'+
   '<div class="field"><label class="flabel" for="prCheck">Next check <span class="hint">what to notice, test or bring back</span></label><textarea id="prCheck" rows="2" maxlength="1000" placeholder="Count how many you catch in front of the hip.">'+h(saved.success_evidence||'')+'</textarea></div>'+
   '<div class="form-grid"><div class="field"><label class="flabel" for="prDue">Review date <span class="hint">optional</span></label><input id="prDue" type="date" value="'+h(saved.due_on||'')+'"></div><div class="field"><label class="flabel" for="prRes">Resource <span class="hint">link or video, optional</span></label><input id="prRes" type="url" maxlength="500" placeholder="https://" value="'+h(saved.resource_url||'')+'"></div></div>'+
   '<div class="field"><span class="flabel">Read this trains</span>'+T.picker('prPick',{reads:saved.reads||[]},['reads'])+'</div>'+
   '<div class="row"><button class="btn primary" type="submit">Save draft</button><button class="btn" type="button" id="prShare">Save and share now</button><span class="small muted" id="prState"></span></div></form>';
  const f=host.querySelector('#pracf');T.bind(host.querySelector('#prPick'));let dirty=Object.keys(saved).length>0;
  const read=()=>({title:f.querySelector('#prFocus').value.trim(),reason:f.querySelector('#prReason').value.trim(),constraint_text:f.querySelector('#prPractice').value.trim(),success_evidence:f.querySelector('#prCheck').value.trim(),due_on:f.querySelector('#prDue').value||undefined,resource_url:f.querySelector('#prRes').value.trim(),reads:T.read(host.querySelector('#prPick')).reads||[]});
  f.addEventListener('input',()=>{dirty=true;Store.set(draftKey,read());host.querySelector('#prState').textContent='Draft kept on this device';});
  guard(()=>dirty,'You have an unsaved practice draft.');
  const key=saved.client_key||uid();Store.set(draftKey,Object.assign(read(),{client_key:key}));
  async function save(share){
   const v=read();if(!v.title||!v.constraint_text)return L.formError(f,'Give the practice a focus and say what to do.');
   f.querySelectorAll('button').forEach(b=>b.disabled=true);host.querySelector('#prState').textContent='Saving…';
   try{
    const b=await api.request('POST','/api/athletes/'+id+'/development-blocks',{draft:true,client_key:key,title:v.title,reason:v.reason,constraint_text:v.constraint_text,success_evidence:v.success_evidence,due_on:v.due_on,resource_url:v.resource_url,read_targets:v.reads,coach_context:contextLines.join('\n'),capture_id:q.capture||undefined,review_required:true});
    if(share){await api.request('POST','/api/development-blocks/'+b.id+'/approve',{});L.toast('Shared with '+a.name.split(' ')[0]);}else L.toast('Draft saved');
    Store.del(draftKey);dirty=false;location.hash='#/coach/practices/'+b.id;
   }catch(err){f.querySelectorAll('button').forEach(b=>b.disabled=false);host.querySelector('#prState').textContent='Not saved. Your wording is kept here.';L.formError(f,err.message);}
  }
  f.onsubmit=e=>{e.preventDefault();save(false);};host.querySelector('#prShare').onclick=()=>save(true);
 };

 /* ---------- draft / practice management (coach) ---------- */
 ctx.views.practiceDraft=async function(id){
  if(!ctx.has('coach'))return ctx.forbidden('Only coaches can manage practices.');
  const host=document.createElement('div');host.className='journey cap-page';root().replaceChildren(host);host.innerHTML='<p class="muted small" role="status">Loading…</p>';
  const b=await api.request('GET','/api/development-blocks/'+id);if(!host.isConnected)return;
  const first=(b.athlete_name||'').split(' ')[0];
  host.innerHTML='<a class="back" href="#/coach/'+b.athlete_id+'">← Athlete</a>'+ctx.head(b.draft?'Draft · not shared':'Shared '+(b.shared_at?day(b.shared_at):''),b.title,b.draft?'Only coaches can see this. Approve to share it with the athlete.':'The athlete can open this practice and record an update.')+
   (b.coach_context?'<aside class="card cap-context"><p class="eyebrow">Private coaching context</p><p style="white-space:pre-line">'+h(b.coach_context)+'</p></aside>':'')+
   '<form class="card form prac-form" id="pedit" novalidate><div class="field"><label class="flabel" for="peFocus">Focus</label><input id="peFocus" type="text" maxlength="120" required value="'+h(b.title)+'"></div><div class="field"><label class="flabel" for="peReason">Reason</label><textarea id="peReason" rows="2" maxlength="2000">'+h(b.reason||'')+'</textarea></div><div class="field"><label class="flabel" for="pePractice">Practice</label><textarea id="pePractice" rows="3" maxlength="1000" required>'+h(b.constraint_text||'')+'</textarea></div><div class="field"><label class="flabel" for="peCheck">Next check</label><textarea id="peCheck" rows="2" maxlength="1000">'+h(b.success_evidence||'')+'</textarea></div><div class="form-grid"><div class="field"><label class="flabel" for="peDue">Review date</label><input id="peDue" type="date" value="'+h(b.due_on||'')+'"></div><div class="field"><label class="flabel" for="peRes">Resource</label><input id="peRes" type="url" maxlength="500" value="'+h(b.resource_url||'')+'"></div></div>'+
   '<div class="row"><button class="btn" type="submit">Save wording</button>'+(b.draft?'<button class="btn primary" type="button" id="peApprove">Approve and share</button>':'<a class="btn primary" href="#/development/'+b.id+'">Open as the athlete sees it</a>')+'<span class="small muted" id="peState"></span></div></form>'+
   (!b.draft&&(b.athlete_reflection||b.attempts&&b.attempts.length)?'<section class="card stack-sm"><p class="section-title">Athlete update</p><p>'+h(b.athlete_reflection||'')+'</p><a class="btn sm" href="#/development/'+b.id+'">Review and choose the next step</a></section>':'');
  const f=host.querySelector('#pedit');let expected=b.updated_at;
  f.onsubmit=async e=>{e.preventDefault();host.querySelector('#peState').textContent='Saving…';try{const r=await api.request('PUT','/api/development-blocks/'+b.id+'/practice',{expected_updated_at:expected,title:f.querySelector('#peFocus').value.trim(),reason:f.querySelector('#peReason').value.trim(),constraint_text:f.querySelector('#pePractice').value.trim(),success_evidence:f.querySelector('#peCheck').value.trim(),due_on:f.querySelector('#peDue').value||'',resource_url:f.querySelector('#peRes').value.trim()});expected=r.updated_at;host.querySelector('#peState').textContent='Saved';}catch(err){host.querySelector('#peState').textContent='';L.formError(f,err.message);}};
  const ap=host.querySelector('#peApprove');if(ap)ap.onclick=async()=>{ap.disabled=true;try{await api.request('POST','/api/development-blocks/'+b.id+'/approve',{expected_updated_at:expected});L.toast('Shared with '+first);ctx.route();}catch(err){ap.disabled=false;L.toast(err.message);}};
 };
 ctx.views.athletePractices=async function(id){
  if(!ctx.has('coach'))return ctx.forbidden('Only coaches can see this.');
  const host=document.createElement('div');host.className='journey cap-page';root().replaceChildren(host);
  const [athlete,blocks]=await Promise.all([api.request('GET','/api/athletes/'+id),api.request('GET','/api/athletes/'+id+'/development-blocks')]);if(!host.isConnected)return;
  const a=athlete.athlete||athlete;const drafts=blocks.filter(b=>b.draft),open=blocks.filter(b=>!b.draft&&b.status!=='mastered'),done=blocks.filter(b=>!b.draft&&b.status==='mastered');
  const row=b=>'<a class="li" href="'+(b.draft?'#/coach/practices/'+b.id:'#/development/'+b.id)+'"><span class="main-col"><span class="t">'+h(b.title)+'</span><span class="d">'+(b.draft?'Draft, not shared':h((window.LabCourt&&window.LabCourt.statusLabel?window.LabCourt.statusLabel(b.status):b.status).replace(/_/g,' ')))+(b.due_on?' · review '+h(day(b.due_on)):'')+(b.shared_at?' · shared '+h(day(b.shared_at)):'')+'</span></span></a>';
  host.innerHTML='<a class="back" href="#/coach/'+id+'">← '+h(a.name)+'</a><div class="head-row">'+ctx.head('Practices',a.name,'Every plan, newest first. Older plans stay here.')+'<a class="btn primary" href="#/coach/'+id+'/practice/new">New practice</a></div>'+
   (drafts.length?'<section class="stack"><p class="section-title">Drafts</p><div class="list">'+drafts.map(row).join('')+'</div></section>':'')+
   '<section class="stack"><p class="section-title">Open</p>'+(open.length?'<div class="list">'+open.map(row).join('')+'</div>':'<div class="list"><p class="empty">No open practice.</p></div>')+'</section>'+
   (done.length?'<details class="sk-done"><summary>'+done.length+' completed</summary><div class="list">'+done.map(row).join('')+'</div></details>':'');
 };

 /* ---------- athlete-facing: practice summary card on the block page ---------- */
 const origDev=ctx.views.development;
 if(origDev)ctx.views.development=async function(id,...rest){const hash=location.hash;await origDev(id,...rest);if(location.hash!==hash)return;try{const b=await api.request('GET','/api/development-blocks/'+id);if(location.hash!==hash)return;const coach=ctx.has('coach');const card=document.createElement('section');card.className='card prac-card';card.innerHTML=(coach&&b.draft?'<div class="banner"><span><b>Draft.</b> The athlete cannot see this yet.</span><a class="btn sm primary" href="#/coach/practices/'+b.id+'">Review and share</a></div>':'')+'<p class="eyebrow">The practice</p><dl class="prac-dl"><div><dt>Focus</dt><dd>'+h(b.title)+'</dd></div>'+(b.reason?'<div><dt>Reason</dt><dd>'+h(b.reason)+'</dd></div>':'')+(b.constraint_text?'<div><dt>Practice</dt><dd>'+h(b.constraint_text)+'</dd></div>':'')+(b.success_evidence?'<div><dt>Next check</dt><dd>'+h(b.success_evidence)+'</dd></div>':'')+(b.due_on?'<div><dt>Review date</dt><dd>'+h(day(b.due_on))+'</dd></div>':'')+(b.resource_url?'<div><dt>Resource</dt><dd><a href="'+h(b.resource_url)+'" target="_blank" rel="noopener">Open resource</a></dd></div>':'')+'</dl>'+(coach&&!b.draft?'<a class="th-act" href="#/coach/practices/'+b.id+'">Edit wording</a>':'');const hero=root().querySelector('.dev-hero');if(hero)hero.insertAdjacentElement('afterend',card);}catch{}};

 /* ---------- entry points ---------- */
 const origCoachAthlete=ctx.views.coachAthlete;
 if(origCoachAthlete)ctx.views.coachAthlete=async function(id,...rest){const hash=location.hash;await origCoachAthlete(id,...rest);if(location.hash!==hash)return;const nav=root().querySelector('.row');if(nav){const a=document.createElement('a');a.className='btn';a.href='#/coach/capture/new?athlete='+id;a.textContent='Capture session';nav.appendChild(a);const p=document.createElement('a');p.className='btn ghost';p.href='#/coach/'+id+'/practices';p.textContent='Practices';nav.appendChild(p);}
  try{const c=await api.request('GET','/api/athletes/'+id+'/captures');if(location.hash!==hash||!c.captures.length)return;const sec=document.createElement('details');sec.className='sk-done';sec.innerHTML='<summary>'+c.captures.length+' captured session'+(c.captures.length===1?'':'s')+'</summary><div class="list">'+c.captures.slice(0,20).map(x=>'<a class="li" href="#/coach/capture/'+x.id+'/next"><span class="main-col"><span class="t small">'+h(x.name||x.format_label)+'</span><span class="d">'+h(day(x.occurred_on))+(x.attributes.length?' · '+x.attributes.map(h).join(', '):'')+(x.observation?'<br>'+h(x.observation):'')+'</span></span></a>').join('')+'</div>';root().appendChild(sec);}catch{}};
});})();
