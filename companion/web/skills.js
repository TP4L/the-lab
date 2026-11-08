/* Skill progress: coach-rated attributes (1-5) over time, goals, and the athlete's "My Progress" view. */
(function(){'use strict';window.LabPlugins=window.LabPlugins||[];window.LabPlugins.push(function(ctx){
 const L=window.Lab,h=L.h,api=L.api,root=()=>document.getElementById('app');
 const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
 const day=v=>v?new Date(v.length===10?v+'T12:00:00':v).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
 const GOAL={not_started:'Not started',in_progress:'In progress',completed:'Completed'};
 const uid=()=>(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random());
 const T=window.LabTags;

 /* ---------- shared pieces ---------- */
 function readsStrip(d){
  if(!d.reads)return '';T.setVocab(d.vocab);
  const any=Object.values(d.reads).some(r=>r.count);if(!any)return '';
  return '<section class="card lab-reads"><div class="head-row"><div><p class="eyebrow">The LAB lens</p><h2>How your reads are holding up</h2></div><a class="small" href="#/learn/engine">What this means</a></div><div class="lab-reads-grid">'+['height','time','balance'].map(r=>{const x=d.reads[r];const pct=x.avg?((x.avg-1)/4*100):0;return '<div class="lab-read '+r+'"><div class="lab-read-top"><b>'+h(x.label)+'</b><span>'+(x.avg?x.avg.toFixed(1):'—')+'<small> / 5</small></span></div><div class="lab-meter"><i style="width:'+pct.toFixed(0)+'%"></i></div><p class="small muted">'+(x.count?x.count+' skill'+(x.count===1?'':'s')+(x.trend>0?' · <span class="up">▲ trending up</span>':x.trend<0?' · <span class="down">▼ slipping</span>':''):'Not assessed yet')+'</p></div>';}).join('')+'</div><p class="small muted">Every skill maps to the read it depends on. Height is the ball, Time is the tempo, Balance is the body. When a read is weak, the decisions built on it fail first.</p></section>';
 }
 function dots(n){let s='<span class="sk-dots" aria-hidden="true">';for(let i=1;i<=5;i++)s+='<i class="'+(i<=n?'on':'')+'"></i>';return s+'</span>';}
 function delta(s){
  if(!s.latest)return '<span class="sk-meta">Not assessed yet</span>';
  if(s.delta==null)return '<span class="sk-meta">First rating '+h(day(s.latest.rated_on))+'</span>';
  if(s.delta===0)return '<span class="sk-meta">No change · '+h(day(s.latest.rated_on))+'</span>';
  return '<span class="sk-meta '+(s.delta>0?'up':'down')+'"><b>'+(s.delta>0?'▲ +':'▼ ')+s.delta+'</b> '+h(day(s.latest.rated_on))+'</span>';
 }
 function chart(history){
  const pts=[...history].reverse();if(pts.length<2)return '<p class="sk-note">One rating so far. The chart appears after the next assessment.</p>';
  const W=560,H=210,px=40,py=16,x=i=>px+(W-px-12)*(pts.length===1?0:i/(pts.length-1)),y=v=>py+(H-py-30)*(1-(v-1)/4);
  let grid='';for(let v=1;v<=5;v++)grid+='<line x1="'+px+'" x2="'+(W-12)+'" y1="'+y(v)+'" y2="'+y(v)+'" class="g"/><text x="'+(px-10)+'" y="'+(y(v)+4)+'" class="t" text-anchor="end">'+v+'</text>';
  const d=pts.map((p,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(p.rating).toFixed(1)).join(' ');
  const c=pts.map((p,i)=>'<circle cx="'+x(i).toFixed(1)+'" cy="'+y(p.rating).toFixed(1)+'" r="5.5"><title>'+h(day(p.rated_on))+': '+p.rating+' '+h(p.label)+'</title></circle>').join('');
  return '<svg class="sk-chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Rating over time">'+grid+'<path d="'+d+'" class="l"/>'+c+'<text x="'+px+'" y="'+(H-6)+'" class="t">'+h(day(pts[0].rated_on))+'</text><text x="'+(W-12)+'" y="'+(H-6)+'" class="t" text-anchor="end">'+h(day(pts[pts.length-1].rated_on))+'</text></svg>';
 }
 function historyTable(s,coach){
  return '<table class="sk-history"><thead><tr><th>Date</th><th>Rating</th><th>Comment</th>'+(coach?'<th></th>':'')+'</tr></thead><tbody>'+s.history.map(r=>'<tr><td>'+h(day(r.rated_on))+'</td><td><b>'+r.rating+'</b> '+h(r.label)+'</td><td>'+(r.comment?h(r.comment):'<span class="muted">—</span>')+'</td>'+(coach?'<td><button class="btn sm ghost" type="button" data-del-rating="'+r.id+'" aria-label="Remove this rating">✕</button></td>':'')+'</tr>').join('')+'</tbody></table>';
 }
 function skillRow(s,open,coach){
  return '<details class="sk-row'+(s.archived?' is-archived':'')+'"'+(open?' open':'')+' data-skill="'+s.id+'"><summary><span class="sk-name">'+h(s.name)+(s.archived?' <span class="tag">Retired</span>':'')+' '+T.pills(s.reads,{short:true})+'</span>'+(s.latest?dots(s.latest.rating)+'<span class="sk-score"><b>'+s.latest.rating+'</b> '+h(s.latest.label)+'</span>':'<span class="sk-score muted">—</span>')+'<span class="sk-sub">'+delta(s)+'</span></summary><div class="sk-body">'+(s.description?'<p class="sk-desc">'+h(s.description)+'</p>':'')+(s.latest?chart(s.history)+historyTable(s,coach):'<p class="sk-note">Your coach hasn’t rated this yet.</p>')+'</div></details>';
 }
 function goalCard(g,coach){
  return '<article class="sk-goal is-'+g.status+'" data-goal="'+g.id+'"><div class="row"><span class="sk-status">'+h(GOAL[g.status])+'</span>'+(g.target_on?'<span class="sk-meta">Target '+h(day(g.target_on))+'</span>':'')+(g.completed_at?'<span class="sk-meta">Done '+h(day(g.completed_at))+'</span>':'')+'</div><h3>'+h(g.title)+'</h3>'+(g.note?'<p class="sk-desc">'+h(g.note)+'</p>':'')+'<div class="row">'+(g.attribute_name?'<span class="chip sk-chip">'+h(g.attribute_name)+'</span>':'')+T.pills(g.reads)+'</div>'+
   '<div class="row sk-goal-actions">'+(coach?(g.status!=='completed'?'<button class="btn sm primary" data-goal-status="completed">Mark completed</button>':'<button class="btn sm ghost" data-goal-status="in_progress">Reopen</button>')+(g.status==='not_started'?'<button class="btn sm" data-goal-status="in_progress">Start</button>':'')+'<button class="btn sm ghost" data-goal-del aria-label="Remove goal">Remove</button>':(g.status==='not_started'?'<button class="btn sm" data-goal-status="in_progress">I’m working on this</button>':''))+'</div></article>';
 }
 function scaleLegend(scale){return '<details class="sk-legend"><summary>What the 1–5 ratings mean</summary><ol>'+scale.map(s=>'<li>'+dots(s.value)+'<div><b>'+s.value+' · '+h(s.label)+'</b><p>'+h(s.meaning)+'</p></div></li>').join('')+'</ol></details>';}

 /* ---------- My Progress (athlete, or coach reading an athlete) ---------- */
 ctx.routes.push([/^\/skills$/,'mySkills','home'],[/^\/skills\/(\d+)$/,'athleteSkills','home'],[/^\/coach\/(\d+)\/skills\/rate$/,'rateSkills','home'],[/^\/coach\/attributes$/,'skillAttributes','home']);
 ctx.views.mySkills=()=>render('/api/me/skills',null);
 ctx.views.athleteSkills=id=>render('/api/athletes/'+id+'/skills',id);
 async function render(url,athleteId){
  const host=document.createElement('div');host.className='journey sk-page';root().replaceChildren(host);
  host.innerHTML='<p class="muted small" role="status">Loading progress…</p>';
  let d;try{d=await api.request('GET',url);}catch(e){
   if(e.status===404&&!athleteId){host.innerHTML=ctx.head('My Progress','Connect your athlete profile','Your coach’s ratings and goals show up here once your profile is linked.')+'<a class="btn primary" href="#/profile">Open profile</a>';return;}
   throw e;}
  if(!host.isConnected)return;
  const coach=d.viewer==='coach',open=d.goals.filter(g=>g.status!=='completed'),done=d.goals.filter(g=>g.status==='completed');
  const sum=d.summary;
  host.innerHTML=(coach?'<a class="back" href="#/coach/'+d.athlete.id+'">← '+h(d.athlete.name)+'</a>':'')+
   '<div class="head-row">'+ctx.head(coach?'Skill progress':'THE LAB',coach?d.athlete.name:'My Progress',coach?'Ratings, comments and goals you have set with '+h(d.athlete.name.split(' ')[0])+'.':'Your coach rates your skills from time to time and sets goals with you. Here’s how you’re growing.')+(coach?'<div class="row"><a class="btn primary" href="#/coach/'+d.athlete.id+'/skills/rate">Rate skills</a><a class="btn" href="#/coach/attributes">Attributes</a></div>':'')+'</div>'+
   '<div class="tiles sk-tiles"><div class="tile"><span class="n">'+sum.assessed+'</span><span class="l">skills assessed</span></div><div class="tile'+(sum.improved_last?' up':'')+'"><span class="n">'+sum.improved_last+'</span><span class="l">improved last time</span></div><div class="tile"><span class="n">'+sum.goals_completed+'</span><span class="l">goal'+(sum.goals_completed===1?'':'s')+' completed</span></div></div>'+
   readsStrip(d)+
   '<section class="stack"><p class="section-title">Goals'+(coach?'<a href="#/coach/'+d.athlete.id+'/skills/rate#goals">Add a goal</a>':'')+'</p>'+(open.length?'<div class="sk-goals">'+open.map(g=>goalCard(g,coach)).join('')+'</div>':'<div class="list"><p class="empty">'+(coach?'No open goals. Set one from Rate skills.':'No goals yet. Your coach will set one with you.')+'</p></div>')+(done.length?'<details class="sk-done"><summary>'+done.length+' completed goal'+(done.length===1?'':'s')+'</summary><div class="sk-goals">'+done.map(g=>goalCard(g,coach)).join('')+'</div></details>':'')+'</section>'+
   '<section class="stack"><p class="section-title">Skills'+(sum.last_rated_on?'<span>Last rated '+h(day(sum.last_rated_on))+'</span>':'')+'</p><div class="list sk-list">'+d.skills.filter(s=>s.latest).map((s,i)=>skillRow(s,i===0,coach)).join('')+'</div>'+(sum.unassessed?'<p class="small muted">'+sum.unassessed+' more skill'+(sum.unassessed===1?'':'s')+' not assessed yet.'+(coach?' <a href="#/coach/'+d.athlete.id+'/skills/rate">Rate them</a>.':'')+'</p>':'')+'</section>'+scaleLegend(d.scale);
  host.querySelectorAll('[data-goal-status]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api.request('PUT','/api/skill-goals/'+b.closest('[data-goal]').dataset.goal,{status:b.dataset.goalStatus});L.toast('Goal updated');ctx.route();}catch(e){b.disabled=false;L.toast(e.message);}});
  host.querySelectorAll('[data-goal-del]').forEach(b=>b.onclick=()=>L.armed(b,'Tap again to remove',async()=>{try{await api.request('DELETE','/api/skill-goals/'+b.closest('[data-goal]').dataset.goal);L.toast('Goal removed');ctx.route();}catch(e){L.toast(e.message);}}));
  host.querySelectorAll('[data-del-rating]').forEach(b=>b.onclick=()=>L.armed(b,'Again to remove',async()=>{try{await api.request('DELETE','/api/skill-ratings/'+b.dataset.delRating);L.toast('Rating removed');ctx.route();}catch(e){L.toast(e.message);}}));
 }

 /* ---------- Rate skills (coach) ---------- */
 ctx.views.rateSkills=async function(id){
  if(!ctx.has('coach'))return ctx.forbidden('Only coaches can rate skills.');
  const host=document.createElement('div');host.className='journey sk-page';root().replaceChildren(host);host.innerHTML='<p class="muted small" role="status">Loading…</p>';
  const d=await api.request('GET','/api/athletes/'+id+'/skills');if(!host.isConnected)return;
  const active=d.skills.filter(s=>!s.archived);
  host.innerHTML='<a class="back" href="#/skills/'+id+'">← '+h(d.athlete.name)+'’s progress</a>'+ctx.head('Rate skills',d.athlete.name,'Rate what you saw today. Skip anything you didn’t see; only rated skills are saved. Comments are shared with the athlete.')+
   '<form class="card form sk-rate" id="ratef" novalidate><div class="field"><label class="flabel" for="ratedOn">Assessment date</label><input type="date" id="ratedOn" value="'+today()+'" max="'+today()+'"></div>'+
   '<div class="sk-rate-list">'+active.map(s=>'<fieldset class="sk-rate-row" data-attr="'+s.id+'"><legend><span class="sk-name">'+h(s.name)+' '+T.pills(s.reads,{short:true})+'</span>'+(s.latest?'<span class="sk-meta">Last '+s.latest.rating+' '+h(s.latest.label)+' · '+h(day(s.latest.rated_on))+'</span>':'<span class="sk-meta">Not rated yet</span>')+'</legend><div class="sk-scale" role="radiogroup" aria-label="'+h(s.name)+' rating">'+d.scale.map(v=>'<button type="button" data-v="'+v.value+'" aria-pressed="false"><b>'+v.value+'</b><span>'+h(v.label)+'</span></button>').join('')+'</div><input type="text" class="sk-comment" placeholder="Comment for the athlete (optional)" maxlength="600" hidden></fieldset>').join('')+'</div>'+
   '<div class="row sk-rate-bar"><button class="btn primary" type="submit" disabled>Save ratings</button><span class="small muted" id="rateCount">Nothing selected</span></div></form>'+
   '<section class="card form" id="goals"><h2>Set a goal</h2><p class="small muted">A goal is a concrete thing to achieve, usually tied to one skill. The athlete sees it at the top of My Progress.</p><form id="goalf" novalidate><div class="field"><label class="flabel" for="gtitle">Goal</label><input type="text" id="gtitle" maxlength="160" required placeholder="Win a dink rally against a 4.0 player"></div><div class="form-grid"><div class="field"><label class="flabel" for="gattr">Skill</label><select id="gattr"><option value="">Not tied to a skill</option>'+active.map(s=>'<option value="'+s.id+'">'+h(s.name)+'</option>').join('')+'</select></div><div class="field"><label class="flabel" for="gdate">Target date <span class="hint">optional</span></label><input type="date" id="gdate"></div></div><div class="field"><label class="flabel" for="gnote">Note <span class="hint">optional</span></label><textarea id="gnote" maxlength="1000" placeholder="How you’ll know it’s done"></textarea></div><div class="field"><span class="flabel">Read this goal trains <span class="hint">defaults to the skill’s reads</span></span>'+T.picker('gpick',{},['reads'])+'</div><div class="row"><button class="btn primary" type="submit">Add goal</button></div></form>'+
   (d.goals.length?'<div class="stack"><p class="section-title">Current goals</p><div class="sk-goals">'+d.goals.filter(g=>g.status!=='completed').map(g=>goalCard(g,true)).join('')+'</div></div>':'')+'</section>'+
   '<p class="small muted">Need a different skill on this list? <a href="#/coach/attributes">Manage attributes</a>.</p>';
  const form=host.querySelector('#ratef'),count=host.querySelector('#rateCount'),save=form.querySelector('button[type=submit]');
  function chosen(){return [...form.querySelectorAll('.sk-rate-row')].map(r=>({row:r,v:r.querySelector('[aria-pressed="true"]')})).filter(x=>x.v);}
  function refresh(){const n=chosen().length;save.disabled=!n;count.textContent=n?n+' skill'+(n===1?'':'s')+' selected':'Nothing selected';}
  form.querySelectorAll('.sk-scale button').forEach(b=>b.onclick=()=>{const row=b.closest('.sk-rate-row'),was=b.getAttribute('aria-pressed')==='true';row.querySelectorAll('.sk-scale button').forEach(x=>x.setAttribute('aria-pressed','false'));if(!was)b.setAttribute('aria-pressed','true');row.querySelector('.sk-comment').hidden=was;if(!was)row.querySelector('.sk-comment').focus({preventScroll:true});refresh();});
  const key=uid();
  form.onsubmit=async e=>{e.preventDefault();const picks=chosen();if(!picks.length)return;save.disabled=true;save.textContent='Saving…';
   try{const r=await api.request('POST','/api/athletes/'+id+'/skill-ratings',{rated_on:form.querySelector('#ratedOn').value,client_id:key,ratings:picks.map(p=>({attribute_id:Number(p.row.dataset.attr),rating:Number(p.v.dataset.v),comment:p.row.querySelector('.sk-comment').value.trim()}))});
    L.toast(r.duplicate?'Already saved':'Saved '+r.saved+' rating'+(r.saved===1?'':'s')+(r.improved?' · '+r.improved+' moved up':''));location.hash='#/skills/'+id;}
   catch(err){save.disabled=false;save.textContent='Save ratings';L.formError(form,err.message);}};
  const gf=host.querySelector('#goalf');T.setVocab(d.vocab);T.bind(host.querySelector('#gpick'));
  gf.onsubmit=async e=>{e.preventDefault();const b=gf.querySelector('button[type=submit]');b.disabled=true;const picked=T.read(host.querySelector('#gpick')).reads;
   try{await api.request('POST','/api/athletes/'+id+'/skill-goals',{title:gf.querySelector('#gtitle').value.trim(),attribute_id:gf.querySelector('#gattr').value?Number(gf.querySelector('#gattr').value):undefined,target_on:gf.querySelector('#gdate').value||'',note:gf.querySelector('#gnote').value.trim(),...(picked?{reads:picked}:{})});L.toast('Goal added');ctx.route();}
   catch(err){b.disabled=false;L.formError(gf,err.message);}};
  host.querySelectorAll('[data-goal-status]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api.request('PUT','/api/skill-goals/'+b.closest('[data-goal]').dataset.goal,{status:b.dataset.goalStatus});L.toast('Goal updated');ctx.route();}catch(e){b.disabled=false;L.toast(e.message);}});
  host.querySelectorAll('[data-goal-del]').forEach(b=>b.onclick=()=>L.armed(b,'Tap again to remove',async()=>{try{await api.request('DELETE','/api/skill-goals/'+b.closest('[data-goal]').dataset.goal);L.toast('Goal removed');ctx.route();}catch(e){L.toast(e.message);}}));
 };

 /* ---------- Attributes (coach) ---------- */
 ctx.views.skillAttributes=async function(){
  if(!ctx.has('coach'))return ctx.forbidden('Only coaches can manage skill attributes.');
  const host=document.createElement('div');host.className='journey sk-page';root().replaceChildren(host);host.innerHTML='<p class="muted small" role="status">Loading…</p>';
  const d=await api.request('GET','/api/skill-attributes?all=1');if(!host.isConnected)return;T.setVocab(d.vocab);
  const live=d.attributes.filter(a=>!a.archived_at),retired=d.attributes.filter(a=>a.archived_at);
  const row=a=>'<form class="sk-attr" data-attr="'+a.id+'"><div class="form-grid"><div class="field"><label class="flabel">Name</label><input type="text" name="name" value="'+h(a.name)+'" maxlength="80" required></div><div class="field"><label class="flabel">Category</label><input type="text" name="category" value="'+h(a.category)+'" maxlength="60" list="sk-cats"></div></div><div class="field"><label class="flabel">What a coach is looking at</label><input type="text" name="description" value="'+h(a.description)+'" maxlength="400"></div><div class="form-grid sk-lab"><div class="field"><span class="flabel">Reads it depends on</span>'+T.picker('pick-'+a.id,{reads:a.reads||[]},['reads'])+'</div><div class="field"><span class="flabel">LAB level band <span class="hint">1–13</span></span><div class="row"><input type="number" name="level_min" min="1" max="13" value="'+(a.level_min||'')+'" placeholder="from" style="width:84px"><span class="muted">to</span><input type="number" name="level_max" min="1" max="13" value="'+(a.level_max||'')+'" placeholder="to" style="width:84px"></div></div></div><div class="row"><button class="btn sm" type="submit">Save</button>'+(a.archived_at?'<button class="btn sm ghost" type="button" data-archive="0">Restore</button>':'<button class="btn sm ghost" type="button" data-archive="1">Retire</button>')+'<span class="small muted" role="status"></span></div></form>';
  host.innerHTML='<a class="back" href="#/coach/today">← Coach today</a>'+ctx.head('Skill attributes','What you rate','These are the skills every athlete is rated on, 1–5. Add what matters to your program; retire what doesn’t. Retiring keeps past ratings visible.')+
   '<datalist id="sk-cats">'+[...new Set(d.attributes.map(a=>a.category).filter(Boolean))].map(c=>'<option value="'+h(c)+'">').join('')+'</datalist>'+
   '<form class="card form" id="newattr" novalidate><h2>Add an attribute</h2><div class="form-grid"><div class="field"><label class="flabel" for="naName">Name</label><input type="text" id="naName" maxlength="80" required placeholder="Erne timing"></div><div class="field"><label class="flabel" for="naCat">Category</label><input type="text" id="naCat" maxlength="60" list="sk-cats" placeholder="Kitchen line"></div></div><div class="field"><label class="flabel" for="naDesc">What a coach is looking at <span class="hint">optional</span></label><input type="text" id="naDesc" maxlength="400"></div><div class="field"><span class="flabel">Reads it depends on</span>'+T.picker('pick-new',{},['reads'])+'</div><div class="row"><button class="btn primary" type="submit">Add attribute</button></div></form>'+
   '<section class="stack"><p class="section-title">Active · '+live.length+'</p><div class="list sk-attrs">'+live.map(row).join('')+'</div></section>'+
   (retired.length?'<details class="sk-done"><summary>'+retired.length+' retired</summary><div class="list sk-attrs">'+retired.map(row).join('')+'</div></details>':'');
  host.querySelectorAll('.lab-picker').forEach(p=>T.bind(p));
  host.querySelector('#newattr').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button[type=submit]');b.disabled=true;try{await api.request('POST','/api/skill-attributes',{name:f.querySelector('#naName').value.trim(),category:f.querySelector('#naCat').value.trim(),description:f.querySelector('#naDesc').value.trim(),reads:T.read(host.querySelector('#pick-new')).reads||[]});L.toast('Attribute added');ctx.route();}catch(err){b.disabled=false;L.formError(f,err.message);}};
  host.querySelectorAll('.sk-attr').forEach(f=>{
   f.onsubmit=async e=>{e.preventDefault();const st=f.querySelector('[role=status]');st.textContent='Saving…';try{await api.request('PUT','/api/skill-attributes/'+f.dataset.attr,{name:f.elements.name.value.trim(),category:f.elements.category.value.trim(),description:f.elements.description.value.trim(),reads:T.read(f.querySelector('.lab-picker')).reads||[],level_min:f.elements.level_min.value||null,level_max:f.elements.level_max.value||null});st.textContent='Saved';}catch(err){st.textContent=err.message;}};
   f.querySelector('[data-archive]').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{await api.request('PUT','/api/skill-attributes/'+f.dataset.attr,{archived:b.dataset.archive==='1'});L.toast(b.dataset.archive==='1'?'Attribute retired':'Attribute restored');ctx.route();}catch(err){b.disabled=false;L.toast(err.message);}};
  });
 };

 /* ---------- entry points ---------- */
 const origCoachAthlete=ctx.views.coachAthlete;
 if(origCoachAthlete)ctx.views.coachAthlete=async function(id,...rest){const hash=location.hash;await origCoachAthlete(id,...rest);if(location.hash!==hash)return;const nav=document.createElement('div');nav.className='row';nav.innerHTML='<a class="btn" href="#/skills/'+h(id)+'">Skill progress</a><a class="btn ghost" href="#/coach/'+h(id)+'/skills/rate">Rate skills</a>';root().prepend(nav);};
});})();
