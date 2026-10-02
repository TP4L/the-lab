/* Staff-only daily operating view across app and connected website records. */
(function(){'use strict';
 window.LabPlugins=window.LabPlugins||[];
 window.LabPlugins.push(function(ctx){
  const L=window.Lab,h=L.h,api=L.api,root=()=>document.getElementById('app');
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const ws=async body=>{const r=await fetch('/api/workspace',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let d;try{d=await r.json();}catch{throw Error('Website connection could not be read.');}if(!r.ok){const e=Error(d.error||'Website workspace unavailable.');e.status=r.status;throw e;}return d;};
  const day=v=>v?new Date(v.length===10?v+'T12:00:00':v).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'No date';
  const rank={review:0,overdue:1,today:2,soon:3,open:4,later:5};
  const ownerName=(item,app,website)=>{
   if(!item.assignee)return 'Unassigned';
   if(item.source==='website')return item.assignee==='brettadamstp@gmail.com'?'Brett':item.assignee==='austinajie@gmail.com'?'Austin':item.assignee;
   return app.coaches.find(c=>String(c.id)===String(item.assignee))?.name||'Assigned coach';
  };
  function siteItems(d){
   const now=today(),through=d.window?.through||'9999-12-31',priority=due=>!due?'open':due<now?'overdue':due===now?'today':due<=through?'soon':'later';
   const attention=(d.attention||[]).map(x=>({id:'website:attention:'+x.id,recordId:x.id,athleteId:x.athleteId,name:x.name,title:x.title,detail:'',kind:x.kind==='training-review'||x.kind==='reflection'?'review':'assignment',priority:x.title.startsWith('Overdue')?'overdue':'review',source:'website'}));
   const upcoming=(d.upcoming||[]).map(x=>({id:'website:upcoming:'+x.kind+':'+x.id,recordId:x.id,athleteId:x.athleteId,name:x.name,title:x.title,detail:x.detail||'',due:x.due,kind:x.kind,priority:priority(x.due),source:'website'}));
   const tasks=(d.tasks||[]).filter(x=>x.status==='open').map(x=>({id:'website:task:'+x.id,recordId:x.id,athleteId:x.athleteId,name:x.name,title:x.title,detail:'Coach follow-up',due:x.due||'',kind:'task',priority:priority(x.due),assignee:x.assignee,revision:x.revision,task:x,source:'website'}));
   return [...attention,...upcoming,...tasks];
  }
  function href(item){
   if(item.source==='app'){
    if(item.kind==='event')return '#/play/events/'+item.recordId;
    if(item.kind==='session')return '#/train/'+item.recordId;
    if(item.kind==='development')return '#/development/'+item.recordId;
    return item.athleteId?'#/coach/'+item.athleteId:'#/coach/today';
   }
   if(item.kind==='review'&&String(item.title).startsWith('Review training response'))return 'https://transcending-performance-lab.brettadamstp.chatgpt.site/coach-review';
   return '#/workspace/athlete/'+item.athleteId;
  }
  ctx.routes.push([/^\/coach\/today$/,'coachToday','home']);
  ctx.views.coachToday=async function(){
   if(!ctx.has('coach')&&!ctx.me()?.user?.workspace){location.hash='#/';return;}
   const host=document.createElement('div');host.className='journey coach-today';root().replaceChildren(host);
   host.innerHTML='<header class="coach-command"><div><p class="eyebrow">COACH DASHBOARD</p><h1>Today in THE LAB</h1><p>Start with what needs attention, then give each athlete a clear next step.</p></div><button class="btn ghost coach-refresh" id="coach-refresh">Refresh</button></header>'+
    '<nav class="coach-actions" aria-label="Primary coach actions"><a href="#/workspace"><span>Roster</span><b>Athletes</b><small>Profiles, notes and history</small></a><a class="assign" href="#/coach/development/new"><span>Build</span><b>Assign development</b><small>Connect learning and training</small></a><a href="#/train/new"><span>Court</span><b>Start a session</b><small>Plan, score and save</small></a><a href="#/coach/desk"><span>Host</span><b>Events</b><small>Players, courts and brackets</small></a></nav>'+
    '<details class="coach-more-tools"><summary>More coaching tools</summary><div><a href="#/coach/development/library">Development Library</a><a href="#/coach/connections">Roster health</a><a href="#/followups">Follow-ups</a><a href="#/coach/checkins">Pre-session check-ins</a></div></details><div id="coach-load" role="status">Checking both coaching systems…</div>';
   const load=async()=>{
    host.querySelector('#coach-refresh').disabled=true;host.querySelector('#coach-load').textContent='Checking both coaching systems…';
    const results=await Promise.allSettled([api.request('GET','/api/coach/dashboard'),ws({action:'followups'})]);if(!host.isConnected)return;
    const app=results[0].status==='fulfilled'?results[0].value:null,site=results[1].status==='fulfilled'?results[1].value:null;
    if(!app){host.querySelector('#coach-load').innerHTML='<div class="card"><h2>App dashboard unavailable</h2><p>'+h(results[0].reason.message)+'</p><button class="btn" id="coach-retry">Retry</button></div>';host.querySelector('#coach-retry').onclick=load;host.querySelector('#coach-refresh').disabled=false;return;}
    const state={items:[...app.items,...(site?siteItems(site):[])],app,site,filter:'all',query:'',expanded:false};
    host.querySelector('#coach-load').outerHTML='<div id="coach-content"></div>';const content=host.querySelector('#coach-content');
    function counts(items){return {review:items.filter(x=>x.priority==='review').length,overdue:items.filter(x=>x.priority==='overdue').length,soon:items.filter(x=>['today','soon'].includes(x.priority)).length,unassigned:items.filter(x=>x.kind==='task'&&!x.assignee).length,athletes:new Set([...app.athletes.map(a=>'app:'+a.id),...(site?.athletes||[]).map(a=>'website:'+a.id)]).size};}
    function relevant(i){
     if(state.query&&!([i.name,i.title,i.detail].join(' ').toLowerCase().includes(state.query)))return false;
     if(state.filter==='all')return true;if(state.filter==='app'||state.filter==='website')return i.source===state.filter;
     if(state.filter==='unassigned')return i.kind==='task'&&!i.assignee;
     if(state.filter==='mine')return i.kind!=='task'||(i.source==='app'?String(i.assignee)===String(app.viewer.id):String(i.assignee).toLowerCase()===String(app.viewer.email).toLowerCase());
     return true;
    }
    function card(i){
     const urgent=['review','overdue','today'].includes(i.priority),label=i.priority==='review'?'Needs review':i.priority==='overdue'?'Overdue':i.priority==='today'?'Today':i.priority==='soon'?'Next 7 days':'Open';
     return '<article class="coach-work '+(urgent?'urgent':'')+'" data-item="'+h(i.id)+'"><div class="coach-work-top"><div><span class="coach-priority '+h(i.priority)+'">'+h(label)+'</span><span class="tag">'+h(i.source==='app'?'App':'Website')+'</span></div><time>'+h(i.due?day(i.due):day(i.at))+'</time></div><p class="eyebrow">'+h(i.name||'THE LAB')+'</p><h3>'+h(i.title)+'</h3>'+(i.detail?'<p class="journey-copy">'+h(i.detail)+'</p>':'')+(i.kind==='task'?'<p class="small muted">Owner: '+h(ownerName(i,app,site))+'</p>':'')+'<div class="row"><a class="btn" href="'+h(href(i))+'">'+(i.kind==='review'?'Review':'Open athlete')+'</a>'+(i.kind==='task'?'<button class="btn ghost" data-done="'+h(i.id)+'">Mark done</button>':'')+(i.source==='app'&&i.kind==='review'?'<button class="btn ghost" data-reply="'+h(i.id)+'">Reply here</button>':'')+'</div><div data-inline="'+h(i.id)+'"></div></article>';
    }
    function paint(){
     const all=state.items,metric=counts(all),shown=all.filter(relevant).sort((a,b)=>(rank[a.priority]??9)-(rank[b.priority]??9)||(a.due||a.at||'9999').localeCompare(b.due||b.at||'9999')||String(a.name).localeCompare(String(b.name)));
     const visible=state.expanded?shown:shown.slice(0,12);
     content.innerHTML='<section class="coach-pulse" aria-label="Today’s coaching pulse">'+[['review',metric.review,'Needs review'],['overdue',metric.overdue,'Overdue'],['soon',metric.soon,'Next 7 days'],['unassigned',metric.unassigned,'Unassigned'],['athletes',metric.athletes,'Athletes']].map(([key,value,label])=>'<button data-pulse="'+key+'" '+(key==='athletes'?'disabled':'')+'><strong>'+value+'</strong><span>'+label+'</span></button>').join('')+'</section>'+
      '<section class="coach-workspace-bar" aria-label="Find and filter coaching work"><input type="search" id="coach-search" value="'+h(state.query)+'" placeholder="Find an athlete or action" aria-label="Find an athlete or action"><div class="coach-filter-row">'+[['all','All'],['mine','Mine'],['unassigned','Unassigned'],['app','App'],['website','Website']].map(([key,label])=>'<button class="btn ghost" data-filter="'+key+'" aria-pressed="'+(state.filter===key)+'">'+label+'</button>').join('')+'</div></section>'+
      '<div class="coach-systems">'+(site?'<span><i aria-hidden="true"></i>App and website synced · '+h(new Date(Math.min(new Date(app.checkedAt),new Date(site.checkedAt))).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))+'</span>':'<span class="coach-warning">App loaded. Website needs attention: '+h(results[1].reason.message)+'</span>')+(site?'':'<a href="/api/site-bridge/signin/start?workspace=1">Reconnect website staff access</a>')+'</div>'+
      '<div class="journey-section coach-queue-head"><div><p class="eyebrow">ACTION QUEUE</p><h2>'+(shown.length?shown.length+' next actions':'You are caught up')+'</h2></div><a href="#/followups">Manage follow-ups</a></div><div class="coach-queue">'+(visible.length?visible.map(card).join(''):'<div class="journey-empty"><h3>No matching work.</h3><p>Change the filter or set a follow-up for the next athlete action.</p><a class="btn" href="#/followups">Set follow-up</a></div>')+'</div>'+(shown.length>12?'<button class="btn coach-more" id="coach-more">'+(state.expanded?'Show priority view':'Show all '+shown.length)+'</button>':'');
     content.querySelector('#coach-search').oninput=e=>{state.query=e.target.value.trim().toLowerCase();paint();};
     content.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;paint();});
     content.querySelectorAll('[data-pulse]').forEach(b=>b.onclick=()=>{const k=b.dataset.pulse;state.filter=k==='unassigned'?'unassigned':'all';state.query='';paint();if(k!=='unassigned'){const target=content.querySelector('.coach-work.'+(k==='review'||k==='overdue'?'urgent':''));target?.scrollIntoView({behavior:'smooth',block:'start'});}});
     content.querySelectorAll('[data-done]').forEach(b=>b.onclick=async()=>{const i=state.items.find(x=>x.id===b.dataset.done);b.disabled=true;try{await(i.source==='website'?ws({action:'followup-save',data:{...i.task,status:'done'}}):api.request('POST','/api/coach/followups',{...i.task,status:'done'}));state.items=state.items.filter(x=>x.id!==i.id);paint();L.toast('Follow-up completed.');}catch(e){b.disabled=false;L.toast(e.message);}});
     content.querySelectorAll('[data-reply]').forEach(b=>b.onclick=()=>{const i=state.items.find(x=>x.id===b.dataset.reply),slot=b.closest('.coach-work').querySelector('[data-inline]');slot.innerHTML='<form class="form coach-inline"><label>Your reply<textarea required maxlength="5000" name="body"></textarea></label><button class="btn primary" type="submit">Send feedback</button><p role="status"></p></form>';const f=slot.querySelector('form');f.onsubmit=async e=>{e.preventDefault();const status=f.querySelector('[role=status]'),button=f.querySelector('button');button.disabled=true;try{await api.request('POST','/api/notes/'+i.recordId+'/reply',{body:new FormData(f).get('body'),client_id:L.uuid()});state.items=state.items.filter(x=>x.id!==i.id);paint();L.toast('Feedback sent and review completed.');}catch(e){status.textContent=e.message+' Your reply is still here.';button.disabled=false;}};});
     if(content.querySelector('#coach-more'))content.querySelector('#coach-more').onclick=()=>{state.expanded=!state.expanded;paint();};
    }
    paint();host.querySelector('#coach-refresh').disabled=false;
   };
   host.querySelector('#coach-refresh').onclick=load;await load();
  };
  for(const key of ['home','workspace']){
   const old=ctx.views[key];if(!old)continue;ctx.views[key]=async function(...args){const hash=location.hash;await old(...args);if(location.hash!==hash||(!ctx.has('coach')&&!ctx.me()?.user?.workspace))return;const entry=document.createElement('section');entry.className='coach-today-entry';entry.innerHTML='<div><p class="eyebrow">Coach today</p><h2>What needs your attention?</h2><p>Reviews, due work and the next seven days across the app and website.</p></div><a class="btn primary" href="#/coach/today">Open coaching dashboard</a>';root().prepend(entry);};
  }
 });
})();
