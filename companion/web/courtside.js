/* Courtside views connect the team planner, individual scorecards and week-by-week practices. */
(function () {
  'use strict';
  const L=window.Lab, h=L.h, api=L.api;
  const date=(s,withTime=false)=>s ? new Date(s.length===10?s+'T12:00:00':s).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',...(withTime?{hour:'numeric',minute:'2-digit'}:{})}) : 'Unscheduled';
  const link=(href,label,primary=false)=>`<a class="btn ${primary?'primary':'ghost'}" href="${h(href)}">${h(label)}</a>`;
  const hero=(label,title,description,actions='')=>`<header class="court-hero"><div><p class="court-kicker">${h(label)}</p><h1>${h(title)}</h1>${description?`<p>${h(description)}</p>`:''}${actions?`<div class="row">${actions}</div>`:''}</div><span class="court-art" aria-hidden="true"><i></i></span></header>`;
  const focus=(groups)=>groups?.length?`<p class="court-focus"><b>Shared focus</b> ${groups.map(([term,names])=>h(term)+' · '+h(names.join(' + '))).join(' / ')}</p>`:'';
  const resume=s=>link('#/train/'+s.id+(s.status==='complete'?'':'/live'),s.status==='complete'?'Open recap':'Resume scoring',true);
  async function nextLesson(host) {
    if(!host)return;
    try {
      const {live,lesson}=await api.request('GET','/api/coach/next-lesson');
      if(!host.isConnected)return;
      if(live)host.innerHTML=hero('On court now',live.title,'Your scorecard is open.',resume(live));
      else if(lesson){
        const {plan,players,blocks,shared}=lesson;
        host.innerHTML=hero('Next lesson',plan.title,[date(plan.starts_at,true),plan.location,players.length+' on roster',blocks.length+' drills'].filter(Boolean).join(' · '),link('#/coach/lesson/'+plan.id,'Prepare lesson',true)+link('#/coach/plans','Team planner'))+focus(shared.slice(0,2));
      }else host.innerHTML=hero('Coach today','Your next lesson','Choose the players, set the drills and bring the plan onto court.',link('#/coach/plans/new','Plan a lesson',true)+link('#/train/new','Start a session'));
    }catch(e){host.innerHTML='<div class="card"><b>Next lesson unavailable</b><p>'+h(e.message)+'</p>'+link('#/coach/plans','Open planner')+'</div>';}
  }
  function scoreFields(prefix='',caption='Drill score'){
    return `<fieldset class="court-score"><legend>${h(caption)} <small>optional</small></legend><label>Successful<input type="number" inputmode="numeric" name="${prefix}makes" min="0" max="10000"></label><label>Attempts<input type="number" inputmode="numeric" name="${prefix}attempts" min="1" max="10000"></label></fieldset>`;
  }
  function scoreData(form){
    return Object.fromEntries(['makes','attempts','game_makes','game_attempts'].filter(k=>form.elements[k] && form.elements[k].value!=='').map(k=>[k,Number(form.elements[k].value)]));
  }
  function scores(a){return a?[a.attempts!=null?'Drill '+a.makes+'/'+a.attempts:'',a.game_attempts!=null?'Game '+a.game_makes+'/'+a.game_attempts:''].filter(Boolean).join(' · '):'';}
  function matchPanel(b,coach){
    return `<section class="card stack"><h2>After open play</h2>${(b.observations||[]).map(o=>`<article class="court-observation"><small>${h(date(o.at))}${o.attempts!=null?' · '+o.makes+'/'+o.attempts+' in play':''}</small><p>${h(o.body)}</p></article>`).join('')}${coach?'':`<form class="form" id="matchNote"><label>Where did this show up in a game?<textarea name="body" maxlength="1000" required placeholder="What ball did you see, and what did you do?"></textarea></label>${scoreFields('','Game score')}<button class="btn" type="submit">Share with coach</button><p role="status"></p></form>`}</section>`;
  }
  function bindMatch(b,refresh){const f=document.getElementById('matchNote');if(!f)return;const key=L.uuid();f.onsubmit=async e=>{e.preventDefault();const button=f.querySelector('button');button.disabled=true;try{await api.request('POST','/api/development-blocks/'+b.id+'/observations',{body:f.elements.body.value,client_key:key,...scoreData(f)});L.toast('Game observation shared');refresh();}catch(err){f.querySelector('[role=status]').textContent=err.message;button.disabled=false;}};}
  window.LabCourt={nextLesson,scoreFields,scoreData,scores,matchPanel,bindMatch};
  const preset={
    title:'Own the transition',goal:'Get from lower transition to the kitchen with your partner while keeping the next ball playable.',
    steps:[
      {title:'Read the bounce',practice:'Start in lower transition. Call the bounce before contact and reset crosscourt.',target:'Land 7 of 10 resets in the kitchen.',setup:'Same feeder, starting cone and crosscourt target.',minutes:12},
      {title:'Pitch & Catch',practice:'Reset, wait for a playable reply, then take the 45° entry with your partner.',target:'Earn a balanced entry on 6 of 10 feeds.',setup:'Partner feeds ten balls from the kitchen line.',minutes:15},
      {title:'Hold the middle',practice:'Play 2 up / 2 back. Call middle priority before either partner crosses.',target:'Make the agreed middle decision on 8 of 10 balls.',setup:'Start each point from lower transition.',minutes:15},
      {title:'Take it into a game',practice:'Play two games. Track each chance to reset and advance together.',target:'Count successful entries over total chances, then explain one decision.',setup:'Live games with a partner. Record who fed or played.',minutes:20}
    ]
  };
  const blank=()=>({title:'',practice:'',target:'',setup:'',minutes:12});
  const statuses={assigned:'Ready to practice',in_progress:'In progress',ready_retest:'Retest',evidence_submitted:'With your coach',coach_review:'Coach review',mastered:'Complete'};
  (window.LabPlugins=window.LabPlugins||[]).push(function(ctx){
    ctx.routes.push([/^\/coach\/lesson\/(\d+)$/,'courtLesson','home'],[/^\/coach\/programs$/,'courtPrograms','home'],[/^\/programs$/,'athletePrograms','train'],[/^\/companion-link$/,'courtEntry','home']);
    function mount(){const host=document.createElement('section');host.className='court-page';document.getElementById('app').replaceChildren(host);return host;}
    const back=(url,label)=>`<a class="back" href="${url}">← ${label}</a>`;
    ctx.views.courtEntry=()=>{
      const host=mount(),url=location.origin+'/';
      host.innerHTML=back('#/','Today')+hero('Member access','Open THE LAB Companion','Scan with a phone camera or copy the address to your NFC tag.')+`<section class="card court-qr">${window.LabQR.svg(url)}<a href="${h(url)}">${h(url)}</a><button id="copyEntry" class="btn">Copy link</button><p role="status"></p></section>`;
      host.querySelector('#copyEntry').onclick=async()=>{try{await navigator.clipboard.writeText(url);L.toast('Link copied');}catch{host.querySelector('[role=status]').textContent='Press and hold the address to copy it.';}};
    };
    ctx.views.courtLesson=async id=>{
      const host=mount(),{plan,session,blocks,players,shared}=await api.request('GET','/api/plans/'+id+'/lesson');
      if(!host.isConnected)return;
      const eligible=players.filter(p=>p.eligible&&!['out','waitlist'].includes(p.rsvp)), eligibleIds=[...new Set(eligible.map(p=>p.id))];
      const closed=['done','cancelled'].includes(plan.status);
      host.innerHTML=back('#/coach/today','Coach today')+hero('Lesson brief',plan.title,[date(plan.starts_at,true),plan.location].filter(Boolean).join(' · '),session?resume(session):link('#/coach/plans/'+id,'Open planner'))+focus(shared)+
        `<form class="form" id="lessonStart"><div class="court-columns"><section class="card"><h2>On court</h2><p class="small">Select up to eight athletes to score.</p>${players.map((p,i)=>`<label class="court-select"><input type="checkbox" name="athlete" value="${p.id||''}" ${eligible.includes(p)&&eligible.find(x=>x.id===p.id)===p?(eligibleIds.indexOf(p.id)<8 && (!p.arrival || p.arrival==='Checked in')?'checked':''):'disabled'}><span><b>${h(p.name)}</b><small>${h([!p.eligible?'Unlinked guest':p.rsvp,p.arrival,p.court,p.cue,p.previous&&('Last practice · '+p.previous),p.result].filter(Boolean).join(' · '))}</small></span></label>`).join('')||'<p>Add players in the planner.</p>'}</section><section class="card"><h2>Drill order</h2><p class="small">Select up to ten drills to bring onto court.</p>${blocks.map((b,i)=>`<label class="court-select"><input type="checkbox" name="drill" value="${b.id}" ${i<10?'checked':''}><span><b>${i+1}. ${h(b.drill||b.instructions?.slice(0,120)||'Lesson block')}</b><small>${h(b.instructions)}</small></span></label>`).join('')||'<p>Add a drill to the plan first.</p>'}</section></div><div class="row">${!session&&!closed&&eligibleIds.length&&blocks.length?'<button class="btn primary" type="submit">Start courtside scoring</button>':''}${link('#/coach/plans/'+id+'/edit','Edit lesson')}</div><p role="status"></p></form>`;
      const form=host.querySelector('form'),key=L.uuid();
      form.onsubmit=async e=>{e.preventDefault();const submit=form.querySelector('[type=submit]');if(!submit)return;
        const data=new FormData(form),athletes=data.getAll('athlete').map(Number),drills=data.getAll('drill').map(Number);
        if(!athletes.length||athletes.length>8||!drills.length||drills.length>10){form.querySelector('[role=status]').textContent='Choose 1–8 athletes and 1–10 drills.';return;}
        submit.disabled=true;try{const s=await api.request('POST','/api/training/sessions',{id:key,source_plan_id:plan.id,plan_version:plan.version,athletes,blocks:drills});location.hash='#/train/'+s.id+(s.status==='complete'?'':'/live');}catch(err){submit.disabled=false;form.querySelector('[role=status]').textContent=err.message;}
      };
    };
    ctx.views.athletePrograms=async()=>{
      const host=mount(),programs=await api.get('/api/me/programs');if(!host.isConnected)return;
      host.innerHTML=back('#/','Today')+hero('Player field guide','My program',programs.length?'Your current practice, coach feedback and upcoming weeks.':'Your coach can assign a weekly plan here.',link('#/train','Training & individual practices'))+
      programs.map(p=>`<section class="card court-plan"><h2>${h(p.title)}</h2><p>${h(p.goal)}</p><ol class="court-weeks">${p.steps.map((step,i)=>{const b=p.blocks.find(b=>b.program_step===i);return `<li class="${b?'available':'upcoming'}"><div><small>Week ${i+1} · ${h(b?(statuses[b.status]||b.status):'Upcoming')}</small><h3>${h(step.title)}</h3><p>${h(step.practice)}</p>${b?.coach_feedback?`<blockquote>${h(b.coach_feedback)}</blockquote>`:''}${b?link('#/development/'+b.id,b.status==='mastered'?'See results':'Open practice'):''}</div></li>`;}).join('')}</ol></section>`).join('');
    };
    ctx.views.courtPrograms=async()=>{
      const host=mount(),[programs,roster]=await Promise.all([api.request('GET','/api/coach/programs'),api.get('/api/athletes')]);if(!host.isConnected)return;
      const key='program-draft:'+ctx.me().user.id, localDay=new Date().toLocaleDateString('en-CA');
      let draft=L.Store.get(key)||{title:'',goal:'',start_day:localDay,steps:[blank()],athletes:[],client_key:L.uuid()};
      const field=(name,label,value,kind='text',limit=120,required=true)=>`<label>${label}${kind==='textarea'?`<textarea name="${name}" maxlength="${limit}" ${required?'required':''}>${h(value||'')}</textarea>`:`<input type="${kind}" name="${name}" value="${h(value??'')}" ${kind==='number'?'min="1" max="480"':'maxlength="'+limit+'"'} ${required?'required':''}>`}</label>`;
      function draw(){
        host.innerHTML=back('#/coach/today','Coach today')+hero('Program studio','Build a program','Give the group a shared goal. Review and advance each athlete individually.')+
          `<form id="programBuilder" class="form"><section class="card stack"><div class="court-heading"><h2>Program outline</h2><small>${draft.steps.length} week${draft.steps.length===1?'':'s'}</small></div><label>Start from<select id="usePlan"><option value="">Choose an outline</option><option value="preset">THE LAB · Own the transition</option><option value="blank">Blank outline</option>${programs.map(p=>`<option value="${p.id}">Reuse · ${h(p.title)}</option>`).join('')}</select></label>${field('title','Program name',draft.title)}${field('goal','What should change in play?',draft.goal,'textarea',1000)}${field('start_day','First week starts',draft.start_day,'date')}</section>
            <div class="court-week-editor">${draft.steps.map((s,i)=>`<fieldset class="card court-week" data-week="${i}"><legend>Week ${i+1}</legend>${field('title','Focus',s.title)}${field('practice','Practice and cue',s.practice,'textarea',1000)}${field('target','How to score it',s.target,'text',1000)}<div class="court-columns">${field('setup','Test setup',s.setup,'text',600,false)}${field('minutes','Minutes',s.minutes,'number',3,false)}</div>${draft.steps.length>1?`<button class="btn ghost" type="button" data-remove="${i}">Remove week ${i+1}</button>`:''}</fieldset>`).join('')}</div>
            ${draft.steps.length<16?'<button class="btn" id="addWeek" type="button">Add a week</button>':''}<section class="card"><h2>Assign to athletes</h2><div class="court-roster">${roster.map(a=>`<label class="court-select"><input type="checkbox" name="player" value="${a.id}" ${draft.athletes.includes(a.id)?'checked':''}><span>${h(a.name)}</span></label>`).join('')||link('#/coach/new','Add an athlete')}</div><div id="groupFocus"></div></section><div class="row"><button class="btn primary" type="submit">Assign program</button><span class="small" role="status"></span></div></form>`+
          (programs.length?'<section class="card"><h2>Assigned programs</h2>'+programs.map(p=>`<details class="court-history"><summary>${h(p.title)} · ${p.steps.length} weeks</summary>${p.blocks.filter(b=>!p.blocks.some(x=>x.athlete_id===b.athlete_id&&x.program_step>b.program_step)).map(b=>`<p><a href="#/development/${b.id}">${h(b.name)} · Week ${b.program_step+1}</a> · ${h(statuses[b.status]||b.status)}</p>`).join('')}</details>`).join('')+'</section>':'');
        const f=host.querySelector('#programBuilder'),input=(el,name)=>el.querySelector('[name="'+name+'"]').value;
        function stash(){draft.title=input(f,'title');draft.goal=input(f,'goal');draft.start_day=input(f,'start_day');
          draft.steps=[...f.querySelectorAll('[data-week]')].map(el=>Object.fromEntries(['title','practice','target','setup','minutes'].map(k=>[k,input(el,k)])));
          draft.athletes=[...f.querySelectorAll('[name=player]:checked')].map(el=>+el.value);L.Store.set(key,draft);
          f.querySelector('#groupFocus').innerHTML=focus(window.LabNeeds.shared(roster.filter(a=>draft.athletes.includes(a.id))));}
        f.oninput=stash;stash();
        f.querySelector('#usePlan').onchange=e=>{const val=e.target.value;if(!val)return;const source=val==='preset'?preset:val==='blank'?{title:'',goal:'',steps:[blank()]}:programs.find(p=>String(p.id)===val);if(source){Object.assign(draft,{title:source.title,goal:source.goal,steps:source.steps.map(s=>({...s}))});draw();}};
        if(f.querySelector('#addWeek'))f.querySelector('#addWeek').onclick=()=>{draft.steps.push(blank());draw();host.querySelector('[data-week="'+(draft.steps.length-1)+'"] input').focus();};
        f.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{draft.steps.splice(+b.dataset.remove,1);draw();});
        f.onsubmit=async e=>{e.preventDefault();stash();const but=f.querySelector('[type=submit]'),msg=f.querySelector('[role=status]');if(!draft.athletes.length){msg.textContent='Choose at least one athlete.';return;}but.disabled=true;try{await api.request('POST','/api/coach/programs',draft);L.Store.del(key);L.toast('Program assigned. Week one is ready.');await ctx.views.courtPrograms();}catch(err){msg.textContent=err.message;but.disabled=false;}};
      }
      draw();
    };
  });
})();
