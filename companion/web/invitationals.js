(function(){
  'use strict';
  const L=window.Lab,{h,api}=L;
  const origin='https://invitationals-court-club.brettadamstp.chatgpt.site';
  const groupText=n=>'Court group '+n;
  const next=s=>'#/train/'+s.session_id+(s.session_status==='complete'?'':'/live');
  const date=v=>new Date(v).toLocaleString('en-US',{timeZone:'America/Chicago',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' CT';
  function mount(){const n=document.createElement('section');n.className='court-page';document.getElementById('app').replaceChildren(n);return n;}
  const rootLink=id=>origin+'/?event='+encodeURIComponent(id);
  function nav(e){return `<a class="back" href="${h(e?rootLink(e):origin)}">← Invitationals</a>`;}
  const returnRoute=/^#\/(?:invitational\/[a-f0-9]{64}|invitational-recap\/[a-zA-Z0-9_-]{1,90}|admin\/members(?:\/[1-9][0-9]*)?)$/;
  const returnKey='lab-invitational-return';
  window.LabInviteReturn={
    save(hash){if(returnRoute.test(hash)){try{localStorage.setItem(returnKey,JSON.stringify({hash,at:Date.now()}));}catch{}}},
    take(){try{const saved=JSON.parse(localStorage.getItem(returnKey)||'null');localStorage.removeItem(returnKey);return saved && Date.now()-saved.at<20*60000&&returnRoute.test(saved.hash)?saved.hash:null;}catch{return null;}}
  };
  (window.LabPlugins=window.LabPlugins||[]).push(ctx=>{
    ctx.routes.push([/^\/invitational\/([a-f0-9]{64})$/,'invitationalLesson','home'],[/^\/invitational-recap\/([A-Za-z0-9_-]{1,90})$/,'invitationalRecap','train']);
    ctx.views.invitationalRecap=async id=>{
      const host=mount(),{sessions}=await api.request('GET','/api/me/invitationals/'+id);if(!host.isConnected)return;
      host.innerHTML=nav(id)+'<header class="court-hero"><div><p class="court-kicker">Invitationals · Athlete</p><h1>My event recap</h1></div><span class="court-art" aria-hidden="true"><i></i></span></header>'+
        (sessions.length?sessions.map(s=>`<section class="card stack"><h2>${h(s.title)}</h2><small>${h(date(s.completed_at))}</small><div class="row"><a class="btn primary" href="#/train/${h(s.id)}">My session scores</a>${s.practices.map(b=>`<a class="btn" href="#/development/${b.id}">${h(b.title)}</a>`).join('')}</div></section>`).join(''):
        '<section class="card"><h2>Your recap isn’t ready yet</h2><p>It appears here once your coach links your athlete profile and finishes your court session.</p><a href="#/profile">My athlete profile</a></section>');
    };
    ctx.views.invitationalLesson=async token=>{
      const host=mount(),path='/api/invitationals/open/'+token;
      let data,athletes;
      try{data=await api.request('GET',path);athletes=await api.request('GET','/api/athletes');}
      catch(err){if(host.isConnected)host.innerHTML=nav()+'<section class="card"><h2>Open your event</h2><p>'+h(err.message)+'</p><a class="btn" href="'+origin+'">Return to Invitationals</a></section>';return;}
      if(!host.isConnected)return;
      const {event,roster,groups}=data;
      const available=groups.find(g=>!g.other_coach&&g.session_status!=='complete');
      let current=available?.group_num||groups.find(g=>!g.other_coach)?.group_num||1;
      const highest=Math.max(1,...groups.map(g=>g.group_num));
      const count=Math.min(128,Math.max(Number(event.courts)||1,Math.ceil(roster.length/8),highest+(groups.length?1:0)));
      host.innerHTML=nav(event.id)+`<header class="court-hero"><div><p class="court-kicker">Invitationals · Lesson handoff</p><h1>${h(event.title)}</h1><p>${h([date(event.starts_at),event.location].filter(Boolean).join(' · '))}</p></div><span class="court-art" aria-hidden="true"><i></i></span></header>
      <section class="card"><label>Court group<select id="inviteGroup">${Array.from({length:count},(_,i)=>{const n=i+1,g=groups.find(x=>x.group_num===n);return `<option value="${n}" ${current===n?'selected':''}>${groupText(n)}${g?.other_coach?' · another coach':g?.session_id?(g.session_status==='complete'?' · completed':' · live'):g?' · planned':''}</option>`;}).join('')}</select></label><p class="small">Up to eight players per group. Reopen the event from Invitationals to bring in the latest check-ins.</p></section><div id="inviteEditor"></div>`;
      const slot=host.querySelector('#inviteEditor');
      function paint(){
        const group=groups.find(g=>g.group_num===current);
        if(group?.other_coach){slot.innerHTML='<div class="card">Another coach owns this group. Choose a different group above.</div>';return;}
        if(group?.session_id){slot.innerHTML=`<section class="card"><h2>${groupText(current)}</h2><p>${group.session_status==='complete'?'This group has finished.':'Scoring is in progress.'}</p><a class="btn primary" href="${h(next(group))}">${group.session_status==='complete'?'Open session recap':'Resume scoring'}</a></section>`;return;}
        if(group && ['done','cancelled'].includes(group.status)){slot.innerHTML='<div class="card">This lesson is closed.</div>';return;}
        const occupied=new Set(groups.filter(g=>g.group_num!==current).flatMap(g=>g.keys||[]));
        const court=p=>Number(String(p.court||'').match(/^(?:court\s*)?(\d+)$/i)?.[1]);
        const remaining=roster.filter(p=>!occupied.has(p.key));
        const matching=remaining.filter(p=>court(p)===current);
        const assignedOnly=remaining.some(p=>court(p));
        const slice=matching.length?matching.slice(0,8):assignedOnly?remaining.filter(p=>!court(p)).slice(0,8):remaining.slice(0,8);
        const chosen=new Set(group?group.keys:slice.map(x=>x.key));
        slot.innerHTML=`<form class="form" id="inviteConfirm"><section class="card stack"><h2>Confirm the roster</h2><p>Link each player to an athlete you coach. Companion remembers your choice for future events. Guests can attend and can be scored once linked.</p>
        ${roster.map(p=>`<div class="invite-player"><label class="court-select"><input type="checkbox" name="member" value="${p.key}" ${chosen.has(p.key)?'checked':''}><span><b>${h(p.name)}</b><small>${h([p.arrival,p.court,occupied.has(p.key)?'Also assigned to another group':''].filter(Boolean).join(' · '))}</small></span></label>
        <label class="invite-profile">Companion profile for ${h(p.name)}<select data-person="${p.key}">${p.athlete_id?`<option value="${p.athlete_id}">${h(athletes.find(x=>x.id===p.athlete_id)?.name||p.name)} · linked</option><option value="">Attend as guest this time</option>${athletes.filter(a=>a.id!==p.athlete_id).map(a=>`<option value="${a.id}">Change link to ${h(a.name)} · LAB-${a.id}</option>`).join('')}`:`<option value="">Attend as guest</option>${athletes.map(a=>`<option value="${a.id}">${h(a.name)} · LAB-${a.id}</option>`).join('')}<option value="new">Create athlete profile for ${h(p.name)}</option>`}</select></label></div>`).join('')||'<p>No confirmed players. Return to Invitationals to check the roster.</p>'}
        <span id="inviteCount" class="small" role="status"></span></section><section class="card"><h2>Lesson plan</h2>${event.plan?`<p class="invite-plan">${h(event.plan)}</p>`:group?'<p>Your saved Companion drills will be kept.</p>':'<label>First drill<input name="first_drill" required maxlength="120" placeholder="e.g. Pitch &amp; Catch"></label>'}</section>
        <div class="row"><button class="btn primary" type="submit">${group?'Update and open lesson':'Create court lesson'}</button>${group?`<a class="btn" href="#/coach/lesson/${group.plan_id}">Open saved lesson</a>`:''}</div><p role="alert"></p></form>`;
        const f=slot.querySelector('form'),boxes=[...f.querySelectorAll('[name=member]')],submit=f.querySelector('button[type=submit]');
        function update(){const count=boxes.filter(b=>b.checked).length;f.querySelector('#inviteCount').textContent=count+' of 8 selected';submit.disabled=count<1||count>8;for(const b of boxes)f.querySelector('[data-person="'+b.value+'"]').disabled=!b.checked;}
        f.onchange=update;update();
        f.onsubmit=async e=>{e.preventDefault();submit.disabled=true;const players=boxes.filter(b=>b.checked).map(b=>{const value=f.querySelector('[data-person="'+b.value+'"]').value;return {key:b.value,replace_link:roster.find(p=>p.key===b.value)?.athlete_id||null,athlete:value==='new'?'new':value?Number(value):null};});
          try{const result=await api.request('POST',path,{group:current,expected_version:group?.version||0,players,first_drill:f.elements.first_drill?.value||''});location.hash=result.session_id?next(result):'#/coach/lesson/'+result.plan_id;}
          catch(err){f.querySelector('[role=alert]').textContent=err.message;update();}};
      }
      host.querySelector('#inviteGroup').onchange=e=>{current=Number(e.target.value);paint();};paint();
    };
  });
})();
