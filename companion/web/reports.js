/* Progress reports: coach builds a period report, writes the summary, publishes a shareable, printable page. */
(function(){'use strict';window.LabPlugins=window.LabPlugins||[];window.LabPlugins.push(function(ctx){
 const L=window.Lab,h=L.h,api=L.api,root=()=>document.getElementById('app'),T=window.LabTags;
 const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const fmt=v=>new Date((v.length===10?v+'T12:00:00':v)).toLocaleDateString(undefined,{month:'short',day:'numeric'});
 function presets(){const t=new Date();const m0=new Date(t.getFullYear(),t.getMonth(),1),pm0=new Date(t.getFullYear(),t.getMonth()-1,1),pm1=new Date(t.getFullYear(),t.getMonth(),0),d30=new Date(t);d30.setDate(t.getDate()-29);const d90=new Date(t);d90.setDate(t.getDate()-89);
  return [['This month',iso(m0),iso(t)],['Last month',iso(pm0),iso(pm1)],['Last 30 days',iso(d30),iso(t)],['Last 90 days',iso(d90),iso(t)]];}
 function dots(n){let s='<span class="sk-dots" aria-hidden="true">';for(let i=1;i<=5;i++)s+='<i class="'+(i<=n?'on':'')+'"></i>';return s+'</span>';}

 /* The report body, shared by preview and the public page. */
 function body(d,opts){
  const o=opts||{};const s=d.summary;
  const tile=(n,l)=>'<div class="rp-tile"><b>'+n+'</b><span>'+l+'</span></div>';
  const reads=['height','time','balance'].map(r=>{const x=d.reads[r];if(!x||!x.count)return '';const pct=((x.avg-1)/4*100).toFixed(0);return '<div class="lab-read '+r+'"><div class="lab-read-top"><b>'+h(x.label)+'</b><span>'+x.avg.toFixed(1)+'<small> / 5</small>'+(x.delta?'<em class="'+(x.delta>0?'up':'down')+'">'+(x.delta>0?' ▲':' ▼')+Math.abs(x.delta).toFixed(1)+'</em>':'')+'</span></div><div class="lab-meter"><i style="width:'+pct+'%"></i></div></div>';}).join('');
  return '<header class="rp-head"><p class="eyebrow">THE LAB · Progress report</p><h1>'+h(d.athlete.name)+'</h1><p class="rp-period">'+h(d.period.label)+(d.coach?' · Coach '+h(d.coach):'')+'</p></header>'+
   (o.summary!==undefined?o.summary:(d.summary_text?'<section class="rp-summary"><p>'+h(d.summary_text).replace(/\n/g,'<br>')+'</p></section>':''))+
   (d.highlights.length?'<ul class="rp-highlights">'+d.highlights.map(x=>'<li>'+h(x)+'</li>').join('')+'</ul>':'')+
   '<section class="rp-tiles">'+tile(s.sessions,'coached sessions')+tile(s.improved,'skills moved up')+tile(s.goals_completed,'goals completed')+tile(s.assessments,'assessments')+'</section>'+
   (reads?'<section class="rp-section"><h2>The LAB lens</h2><p class="rp-sub">Average rating per read across the skills that depend on it. Height is the ball, Time is the tempo, Balance is the body.</p><div class="lab-reads-grid">'+reads+'</div></section>':'')+
   (d.skills.length?'<section class="rp-section"><h2>Skills</h2><table class="rp-skills"><thead><tr><th>Skill</th><th>Start</th><th>Now</th><th>Change</th></tr></thead><tbody>'+d.skills.map(k=>'<tr><td><span class="rp-skill">'+h(k.name)+'</span>'+T.pills(k.reads,{short:true})+(k.comments.length?'<p class="rp-comment">'+h(k.comments[k.comments.length-1].text)+'</p>':'')+'</td><td>'+(k.start!=null?k.start:'Not set')+'</td><td><b>'+k.end+'</b> <span class="muted small">'+h(k.end_label)+'</span><br>'+dots(k.end)+'</td><td class="'+(k.delta>0?'up':k.delta<0?'down':'')+'">'+(k.delta>0?'▲ +'+k.delta:k.delta<0?'▼ '+k.delta:'Not set')+'</td></tr>').join('')+'</tbody></table></section>':'')+
   ((d.goals.completed.length||d.goals.open.length)?'<section class="rp-section"><h2>Goals</h2>'+(d.goals.completed.length?'<p class="rp-sub">Completed this period</p><ul class="rp-goals done">'+d.goals.completed.map(g=>'<li><b>'+h(g.title)+'</b>'+(g.attribute_name?' <span class="muted">· '+h(g.attribute_name)+'</span>':'')+'</li>').join('')+'</ul>':'')+(d.goals.open.length?'<p class="rp-sub">Working on</p><ul class="rp-goals">'+d.goals.open.map(g=>'<li><b>'+h(g.title)+'</b>'+(g.attribute_name?' <span class="muted">· '+h(g.attribute_name)+'</span>':'')+' <span class="tag">'+(g.status==='in_progress'?'In progress':'Not started')+'</span></li>').join('')+'</ul>':'')+'</section>':'')+
   (d.coach_notes.length?'<section class="rp-section"><h2>From your coach</h2><div class="rp-notes">'+d.coach_notes.slice(-6).map(n=>'<blockquote><p>'+h(n.body)+'</p><footer>'+h(n.author)+' · '+h(fmt(n.at))+(n.tags&&!T.empty(n.tags)?' '+T.pills(n.tags):'')+'</footer></blockquote>').join('')+'</div></section>':'')+
   (d.sessions.length?'<section class="rp-section"><h2>Sessions</h2><ul class="rp-sessions">'+d.sessions.map(x=>'<li><span>'+h(fmt(x.at))+'</span>'+h(x.title)+'</li>').join('')+'</ul></section>':'')+
   '<footer class="rp-foot"><p>Ratings: '+d.scale.map(x=>x.value+' '+h(x.label)).join(' · ')+'</p><p>THE LAB · Transcending Performance'+(d.published_at?' · Published '+h(fmt(d.published_at)):'')+'</p></footer>';
 }

 ctx.routes.push([/^\/coach\/(\d+)\/report$/,'reportBuilder','home'],[/^\/report\/([A-Za-z0-9_-]+)$/,'reportPublic','',true],[/^\/reports$/,'myReports','home']);

 ctx.views.reportBuilder=async function(id,query){
  if(!ctx.has('coach'))return ctx.forbidden('Only coaches can publish reports.');
  const host=document.createElement('div');host.className='journey rp-page';root().replaceChildren(host);host.innerHTML='<p class="muted small" role="status">Building…</p>';
  const P=presets();let from=(query&&query.from)||P[2][1],to=(query&&query.to)||P[2][2];
  const [d,list]=await Promise.all([api.request('GET','/api/athletes/'+id+'/report?from='+from+'&to='+to),api.request('GET','/api/athletes/'+id+'/reports')]);if(!host.isConnected)return;T.setVocab(d.vocab);
  const first=d.athlete.name.split(' ')[0];
  const draft=[d.summary.sessions?first+' trained with us '+d.summary.sessions+' time'+(d.summary.sessions===1?'':'s')+' this period.':'',d.summary.improved?d.summary.improved+' skill'+(d.summary.improved===1?'':'s')+' moved up'+(d.skills.filter(k=>k.delta>0).length?' ('+d.skills.filter(k=>k.delta>0).map(k=>k.name).join(', ')+').':'.'):'',d.goals.completed.length?'Completed: '+d.goals.completed.map(g=>g.title).join('; ')+'.':'',d.goals.open.length?'Next: '+d.goals.open[0].title+'.':''].filter(Boolean).join(' ');
  host.innerHTML='<a class="back" href="#/coach/'+id+'">← '+h(d.athlete.name)+'</a>'+ctx.head('Progress report',first+'’s report','Pick the period, write the summary in your words, publish. The athlete gets a link they can keep and share.')+
   '<section class="card form"><div class="row">'+P.map(([l,f,t])=>'<a class="chip" aria-pressed="'+(f===from&&t===to)+'" href="#/coach/'+id+'/report?from='+f+'&to='+t+'">'+l+'</a>').join('')+'</div><form id="rangef" class="row"><label class="small muted">From <input type="date" id="rpFrom" value="'+from+'"></label><label class="small muted">To <input type="date" id="rpTo" value="'+to+'"></label><button class="btn sm" type="submit">Update</button></form>'+
   '<div class="field"><label class="flabel" for="rpTitle">Title</label><input id="rpTitle" type="text" maxlength="120" value="Progress report · '+h(new Date(to+'T12:00:00').toLocaleDateString(undefined,{month:'long',year:'numeric'}))+'"></div><div class="field"><label class="flabel" for="rpSummary">Coach summary <span class="hint">in your words; shown at the top</span></label><textarea id="rpSummary" maxlength="4000" rows="5">'+h(draft)+'</textarea></div><div class="row"><button class="btn primary" type="button" id="rpPublish">Publish & get link</button><span class="small muted">Publishing freezes the numbers as they are now.</span></div></section>'+
   '<section class="stack"><p class="section-title">Preview</p><article class="card rp-paper" id="rpPreview">'+body(Object.assign({},d,{coach:ctx.me().user.name}),{summary:'<section class="rp-summary"><p id="rpSummaryPreview">'+h(draft).replace(/\n/g,'<br>')+'</p></section>'})+'</article></section>'+
   (list.reports.length?'<section class="stack"><p class="section-title">Published reports</p><div class="list">'+list.reports.map(x=>'<div class="li"><span class="main-col"><span class="t small">'+h(x.title)+(x.revoked?' <span class="tag">Revoked</span>':'')+'</span><span class="d">'+h(fmt(x.period_from))+' – '+h(fmt(x.period_to))+' · published '+h(fmt(x.published_at))+'</span></span><span class="side row"><a class="btn sm" href="#/report/'+h(x.token)+'">Open</a><button class="btn sm ghost" type="button" data-copy="'+h(x.url)+'">Copy link</button>'+(x.revoked?'':'<button class="btn sm ghost" type="button" data-revoke="'+h(x.token)+'">Revoke</button>')+'</span></div>').join('')+'</div></section>':'');
  host.querySelector('#rangef').onsubmit=e=>{e.preventDefault();location.hash='#/coach/'+id+'/report?from='+host.querySelector('#rpFrom').value+'&to='+host.querySelector('#rpTo').value;};
  const ta=host.querySelector('#rpSummary');ta.addEventListener('input',()=>{host.querySelector('#rpSummaryPreview').innerHTML=h(ta.value).replace(/\n/g,'<br>');});
  host.querySelector('#rpPublish').onclick=async()=>{const b=host.querySelector('#rpPublish');b.disabled=true;b.textContent='Publishing…';try{const r=await api.request('POST','/api/athletes/'+id+'/reports',{from,to,title:host.querySelector('#rpTitle').value.trim(),summary:ta.value.trim()});try{await navigator.clipboard.writeText(r.url);L.toast('Published. Link copied.');}catch{L.toast('Published.');}location.hash='#/report/'+r.token;}catch(e){b.disabled=false;b.textContent='Publish & get link';L.toast(e.message);}};
  host.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);L.toast('Link copied');}catch{L.toast(b.dataset.copy);}});
  host.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=()=>L.armed(b,'Again to revoke',async()=>{try{await api.request('PUT','/api/reports/'+b.dataset.revoke,{revoked:true});L.toast('Link revoked');ctx.route();}catch(e){L.toast(e.message);}}));
 };

 ctx.views.reportPublic=async function(token){
  const host=document.createElement('div');host.className='journey rp-page rp-public';root().replaceChildren(host);host.innerHTML='<p class="muted small" role="status">Loading report…</p>';
  let d;try{d=await api.request('GET','/api/reports/'+token);}catch(e){host.innerHTML=ctx.head('Progress report','This report isn’t available','The link may have been revoked. Ask your coach for a fresh one.')+'<a class="btn" href="#/">Home</a>';return;}
  if(!host.isConnected)return;T.setVocab(d.vocab);
  const me=ctx.me();
  host.innerHTML='<div class="row rp-bar no-print">'+(me?'<a class="back" href="#/">← Home</a>':'<a class="back" href="#/join">← THE LAB</a>')+'<span style="flex:1"></span><button class="btn sm" type="button" id="rpPrint">Print / save PDF</button><button class="btn sm ghost" type="button" id="rpShare">Share link</button></div>'+
   '<article class="card rp-paper">'+body(d)+'</article>'+
   (!me?'<section class="card join-what no-print"><h2>Train with THE LAB</h2><p>Reports like this come with coaching. Read Field Notes free, or see sessions and packs.</p><div class="row"><a class="btn primary" href="#/join">Learn more</a><a class="btn ghost" href="#/learn">Field Notes</a></div></section>':'');
  host.querySelector('#rpPrint').onclick=()=>window.print();
  host.querySelector('#rpShare').onclick=async()=>{const url=location.href;try{if(navigator.share)await navigator.share({title:d.title,url});else{await navigator.clipboard.writeText(url);L.toast('Link copied');}}catch{}};
  document.title=d.title+' · THE LAB';
 };

 ctx.views.myReports=async function(){
  const host=document.createElement('div');host.className='journey rp-page';root().replaceChildren(host);
  const d=await api.request('GET','/api/me/reports');if(!host.isConnected)return;
  host.innerHTML='<a class="back" href="#/skills">← My Progress</a>'+ctx.head('THE LAB','Your reports','Each report is a snapshot of a period: sessions, skills, goals and your coach’s summary.')+(d.reports.length?'<div class="list">'+d.reports.map(x=>'<a class="li" href="#/report/'+h(x.token)+'"><span class="main-col"><span class="t">'+h(x.title)+'</span><span class="d">'+h(fmt(x.period_from))+' – '+h(fmt(x.period_to))+(x.coach?' · '+h(x.coach):'')+'</span></span></a>').join('')+'</div>':'<div class="list"><p class="empty">No reports yet. Your coach publishes one at the end of a training block.</p></div>');
 };

 /* entry points */
 const origCoachAthlete=ctx.views.coachAthlete;
 if(origCoachAthlete)ctx.views.coachAthlete=async function(id,...rest){const hash=location.hash;await origCoachAthlete(id,...rest);if(location.hash!==hash)return;const nav=root().querySelector('.row');const a=document.createElement('a');a.className='btn ghost';a.href='#/coach/'+id+'/report';a.textContent='Report';if(nav)nav.appendChild(a);};
 const origMySkills=ctx.views.mySkills;
 if(origMySkills)ctx.views.mySkills=async function(...a){const hash=location.hash;await origMySkills(...a);if(location.hash!==hash)return;try{const d=await api.request('GET','/api/me/reports');if(location.hash!==hash||!d.reports.length)return;const sec=document.createElement('section');sec.className='stack';sec.innerHTML='<p class="section-title">Reports<a href="#/reports">All</a></p><div class="list">'+d.reports.slice(0,2).map(x=>'<a class="li" href="#/report/'+h(x.token)+'"><span class="main-col"><span class="t">'+h(x.title)+'</span><span class="d">'+h(fmt(x.period_from))+' – '+h(fmt(x.period_to))+'</span></span></a>').join('')+'</div>';const legend=root().querySelector('.sk-legend');if(legend)legend.insertAdjacentElement('beforebegin',sec);else root().firstChild.appendChild(sec);}catch{}};
 const origAthleteSkills=ctx.views.athleteSkills;
 if(origAthleteSkills)ctx.views.athleteSkills=async function(id,...a){const hash=location.hash;await origAthleteSkills(id,...a);if(location.hash!==hash)return;const row=root().querySelector('.head-row .row');if(row){const b=document.createElement('a');b.className='btn ghost';b.href='#/coach/'+id+'/report';b.textContent='Report';row.appendChild(b);}};
});})();
