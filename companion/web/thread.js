/* The thread: one conversation per athlete. Coach notes, replies, athlete reflections and questions,
   check-ins, assessments, goals and sessions in one chronological place, with compose for both sides. */
(function(){'use strict';window.LabPlugins=window.LabPlugins||[];window.LabPlugins.push(function(ctx){
 const L=window.Lab,h=L.h,api=L.api,Store=L.Store,root=()=>document.getElementById('app');
 const uid=()=>(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random());
 const T=window.LabTags;
 const dayKey=v=>new Date(v).toDateString();
 const dayLabel=v=>{const d=new Date(v),t=new Date();const diff=Math.round((new Date(t.toDateString())-new Date(d.toDateString()))/86400000);return diff===0?'Today':diff===1?'Yesterday':d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:d.getFullYear()===t.getFullYear()?undefined:'numeric'});};
 const clock=v=>new Date(v).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
 const FILTERS=[['all','All'],['talk','Messages'],['checkin','Check-ins'],['rating','Assessments'],['system','Activity']];
 const TALK=new Set(['note','reply','reflection','question','video','plan']);
 function matches(i,f){if(f==='all')return true;if(f==='talk')return TALK.has(i.type);if(f==='checkin')return i.type==='checkin'||i.type==='plan';if(f==='rating')return i.type==='rating'||i.type==='goal'||i.type==='milestone';if(f==='system')return i.side==='system'||i.type==='block'||i.type==='session';return true;}
 const ICON={checkin:'Check-in',rating:'Assessment',goal:'Goal',milestone:'Milestone',session:'Session',block:'Development Block',purchase:'Purchase',plan:'Plan',video:'Video',question:'Question'};

 function bubble(i,viewer,coach){
  if(i.side==='system')return '<div class="th-sys"><a href="'+h(i.link||'#')+'"><span class="tag'+(i.type==='milestone'?' ok':'')+'">'+h(ICON[i.type]||i.type)+'</span><span>'+h(i.body)+'</span><time>'+h(clock(i.at))+'</time></a></div>';
  const mine=viewer==='coach'?i.side==='coach':i.side==='athlete';
  const cls='th-msg '+(mine?'me':'them')+(i.private?' private':'')+(i.type==='rating'||i.type==='goal'||i.type==='checkin'||i.type==='plan'||i.type==='block'?' card-ish':'');
  const head=(i.title?'<span class="th-title">'+h(i.title)+'</span>':'')+(i.private?'<span class="vis private">Private</span>':'')+(i.type==='question'?'<span class="tag">Question</span>':'');
  const media=i.media_id?'<a class="th-media" href="/api/media/'+h(i.media_id)+'" target="_blank" rel="noopener"><img alt="Attachment" loading="lazy" src="/api/media/'+h(i.media_id)+'"></a>':'';
  const actions=[];
  if(coach&&i.side==='athlete'&&i.note_id&&(i.type==='reflection'||i.type==='question'||i.type==='video'))actions.push('<button type="button" class="th-act" data-reply="'+i.note_id+'" data-quote="'+h(i.body.slice(0,80))+'">Reply</button>');
  if(i.link&&!i.media_id&&i.type!=='note'&&i.type!=='reply'&&i.type!=='reflection')actions.push('<a class="th-act" href="'+h(i.link)+'">Open</a>');
  return '<div class="'+cls+'" data-id="'+h(i.id)+'">'+(head?'<div class="th-head">'+head+'</div>':'')+'<div class="th-body">'+h(i.body)+'</div>'+(i.tags&&!T.empty(i.tags)?'<div class="th-tags">'+T.pills(i.tags)+'</div>':'')+media+'<div class="th-meta"><span>'+h(mine?'You':i.author)+'</span><time>'+h(clock(i.at))+'</time>'+(coach&&i.side==='athlete'&&i.note_id&&!i.reviewed?'<span class="th-new">New</span>':'')+actions.join('')+'</div></div>';
 }
 function paint(host,d,state){
  const list=host.querySelector('#th-list');const items=d.items.filter(i=>matches(i,state.filter)).slice().reverse();
  let out='',last='';
  for(const i of items){const k=dayKey(i.at);if(k!==last){out+='<div class="th-day"><span>'+h(dayLabel(i.at))+'</span></div>';last=k;}out+=bubble(i,d.viewer,d.viewer==='coach');}
  list.innerHTML=out||'<div class="journey-empty"><h3>'+(d.viewer==='coach'?'Nothing here yet.':'Start the conversation.')+'</h3><p>'+(d.viewer==='coach'?'Notes, replies, check-ins and assessments for '+h(d.athlete.name.split(' ')[0])+' will collect here.':'Ask a question, share what you noticed, or send a video. Your coach sees it here.')+'</p></div>';
  host.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.filter===state.filter));
  list.querySelectorAll('[data-reply]').forEach(b=>b.onclick=()=>{state.replyTo={id:Number(b.dataset.reply),quote:b.dataset.quote};host.querySelector('#th-replying').hidden=false;host.querySelector('#th-replying span').textContent='Replying to: '+b.dataset.quote;host.querySelector('#th-text').focus();});
  requestAnimationFrame(()=>{window.scrollTo(0,document.body.scrollHeight);});
 }

 ctx.routes.push([/^\/thread$/,'myThread','home'],[/^\/coach\/(\d+)\/thread$/,'athleteThread','home']);
 ctx.views.myThread=()=>render(null);
 ctx.views.athleteThread=id=>render(Number(id));
 async function render(athleteId){
  const host=document.createElement('div');host.className='journey th-page';root().replaceChildren(host);host.innerHTML='<p class="muted small" role="status">Loading…</p>';
  let d;try{d=await api.request('GET',athleteId?'/api/athletes/'+athleteId+'/thread':'/api/me/thread');}catch(e){if(e.status===404&&!athleteId){host.innerHTML=ctx.head('Thread','Connect your athlete profile','Your conversation with your coach lives here once your profile is linked.')+'<a class="btn primary" href="#/profile">Open profile</a>';return;}throw e;}
  if(!host.isConnected)return;
  const coach=d.viewer==='coach',id=d.athlete.id,state={filter:'all',replyTo:null};
  const first=d.athlete.name.split(' ')[0];
  host.innerHTML=(coach?'<a class="back" href="#/coach/'+id+'">← '+h(d.athlete.name)+'</a>':'')+
   '<div class="head-row th-headrow"><div class="head"><p class="eyebrow">'+(coach?'Thread':'Your coach')+'</p><h1>'+h(coach?first:'Thread')+'</h1></div>'+(coach&&d.unreviewed?'<button class="btn sm" type="button" id="th-seen">Mark '+d.unreviewed+' seen</button>':'')+'</div>'+
   '<div class="row th-filters">'+FILTERS.map(([k,l])=>'<button class="chip" type="button" data-filter="'+k+'" aria-pressed="'+(k==='all')+'">'+l+'</button>').join('')+'</div>'+
   '<div id="th-list" class="th-list" aria-live="polite"></div>'+
   '<form class="th-compose" id="th-form" novalidate><div id="th-replying" class="th-replying" hidden><span></span><button type="button" class="th-act" id="th-cancel">Cancel</button></div><div class="th-row"><textarea id="th-text" rows="1" maxlength="5000" placeholder="'+(coach?'Note to '+h(first)+'…':'Message your coach…')+'" aria-label="Message"></textarea><button class="btn primary th-send" type="submit" aria-label="Send">Send</button></div><details class="th-tagbox"><summary>Tag the read</summary>'+T.picker('th-pick',{},coach?['reads','state','need','error','call']:['reads','state'])+'</details>'+(coach?'<div class="row th-vis"><label class="th-toggle"><input type="checkbox" id="th-private"> <span>Private note (coach only)</span></label><span class="small muted" id="th-hint">Shared notes notify '+h(first)+'.</span></div>':'<p class="small muted">Your coach is notified. Add a pre-session check-in from <a href="#/check-in">here</a>.</p>')+'</form>';
  T.setVocab(d.vocab);T.bind(host.querySelector('#th-pick'),t=>{host.querySelector('.th-tagbox summary').innerHTML=T.empty(t)?'Tag the read':'Tagged: '+T.pills(t);});
  paint(host,d,state);
  host.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;paint(host,d,state);});
  const ta=host.querySelector('#th-text');ta.addEventListener('input',()=>{ta.style.height='auto';ta.style.height=Math.min(160,ta.scrollHeight)+'px';});
  ta.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();host.querySelector('#th-form').requestSubmit();}});
  host.querySelector('#th-cancel').onclick=()=>{state.replyTo=null;host.querySelector('#th-replying').hidden=true;};
  const priv=host.querySelector('#th-private');if(priv)priv.onchange=()=>{host.querySelector('#th-hint').textContent=priv.checked?'Only coaches see private notes.':'Shared notes notify '+first+'.';host.querySelector('#th-form').classList.toggle('is-private',priv.checked);};
  if(host.querySelector('#th-seen'))host.querySelector('#th-seen').onclick=async()=>{try{await api.request('POST','/api/athletes/'+id+'/thread/seen',{});L.toast('Marked seen');ctx.route();}catch(e){L.toast(e.message);}};
  host.querySelector('#th-form').onsubmit=async e=>{
   e.preventDefault();const text=ta.value.trim();if(!text)return;const send=host.querySelector('.th-send');send.disabled=true;
   try{
    const tags=T.read(host.querySelector('#th-pick'));
    if(state.replyTo)await api.request('POST','/api/notes/'+state.replyTo.id+'/reply',{body:text,client_id:uid(),tags});
    else await api.request('POST','/api/athletes/'+id+'/notes',{body:text,client_id:uid(),visibility:coach?(priv&&priv.checked?'private':'shared'):'shared',tags});
    host.querySelectorAll('#th-pick .lab-chip').forEach(b=>b.setAttribute('aria-pressed','false'));host.querySelector('.th-tagbox summary').textContent='Tag the read';host.querySelector('.th-tagbox').open=false;
    ta.value='';ta.style.height='auto';state.replyTo=null;host.querySelector('#th-replying').hidden=true;
    const fresh=await api.request('GET',athleteId?'/api/athletes/'+id+'/thread':'/api/me/thread');if(!host.isConnected)return;d.items=fresh.items;d.unreviewed=fresh.unreviewed;paint(host,d,state);
   }catch(err){L.toast(err.status===0?'Offline. Try again when you have signal.':err.message);}
   finally{send.disabled=false;}
  };
 }

 /* entry points */
 const origCoachAthlete=ctx.views.coachAthlete;
 if(origCoachAthlete)ctx.views.coachAthlete=async function(id,...rest){const hash=location.hash;await origCoachAthlete(id,...rest);if(location.hash!==hash)return;const nav=root().querySelector('.row');const a=document.createElement('a');a.className='btn primary';a.href='#/coach/'+id+'/thread';a.textContent='Thread';if(nav)nav.prepend(a);else{const row=document.createElement('div');row.className='row';row.appendChild(a);root().prepend(row);}};
});})();
