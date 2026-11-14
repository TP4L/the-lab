/* THE LAB responsive workspace. Every dashboard action opens a real app record. */
(function () {
  'use strict';
  const paths = {
    home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
    people:'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3M18 14a4 4 0 0 1 4 4v3M13 3a4 4 0 0 1 0 8M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    calendar:'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    practice:'M9 3h6v4H9zM7 5H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M7 14l3 3 7-7',
    review:'M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM10 8l6 4-6 4Z',
    profile:'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    arrow:'M4 12h16m-7-7 7 7-7 7',
    chevron:'m14 6-6 6 6 6',
    bell:'M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10M10 22h4',
    search:'M17 17l5 5M19 10a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    menu:'M3 6h18M3 12h18M3 18h18',
    close:'m5 5 14 14M19 5 5 19',
    book:'M12 5C8 2 4 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-3-1-7-2-10 1Zm0 0v15',
    progress:'M3 3v18h18M6 15l4-5 4 3 6-8',
    message:'M21 11a9 9 0 0 1-9 9 10 10 0 0 1-4-1l-6 3 2-6a9 9 0 1 1 17-5Z',
    settings:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM9 2h6l1 4 4 1 2 5-3 3v5l-5 2-3-3H6l-4-4 2-4V6l5-1Z',
    add:'M12 4v16M4 12h16',
    refresh:'M21 8V3l-3 3A9 9 0 1 0 21 16M21 8h-5',
    play:'m7 4 14 8-14 8Z',
    check:'m5 12 4 4 10-10',
    activity:'M2 12h5l3-9 4 18 3-9h5'
  };
  const icon = (name, cls='') => '<svg class="lab-icon '+cls+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[name]||paths.arrow)+'"/></svg>';
  (window.LabPlugins=window.LabPlugins||[]).push(function (ctx) {
    const L=window.Lab, h=L.h, api=L.api;
    const root=()=>document.getElementById('app');
    const staff=()=>ctx.has('coach');
    const first=()=>String(ctx.me()?.user?.name||'there').trim().split(/\s+/)[0];
    const initials=n=>String(n||'?').trim().split(/\s+/).map(p=>p[0]).slice(0,2).join('').toUpperCase();
    const clean=n=>String(n||'').replace(/^(Question|Feedback|Reflection|Video review)\n/,'');
    const short=(s,n=140)=>String(s||'').length>n?String(s).slice(0,n-1)+'…':String(s||'');
    const date=(value,time=false,zone)=>{
      if(!value)return 'Date to be confirmed';
      const d=new Date(value.length===10?value+'T12:00:00':value); if(isNaN(d))return 'Date to be confirmed';
      const options={month:'short',day:'numeric',...(time?{hour:'numeric',minute:'2-digit'}:{}),...(zone?{timeZone:zone,timeZoneName:time?'short':undefined}:{})};
      try{return d.toLocaleString(undefined,options);}catch{return d.toLocaleString(undefined,{month:'short',day:'numeric',...(time?{hour:'numeric',minute:'2-digit'}:{})});}
    };
    const action=(url,label,cls='',symbol='arrow')=>'<a class="lab-action '+cls+'" href="'+h(url)+'"><span>'+h(label)+'</span>'+icon(symbol)+'</a>';
    const title=(headline,sub='',actions='')=>'<header class="lab-page-heading"><div><p class="lab-greeting">'+h((new Date().getHours()<12?'Morning, ':new Date().getHours()<18?'Hello, ':'Evening, ')+first()+'.')+'</p><h1>'+h(headline)+'</h1>'+(sub?'<p class="lab-page-copy">'+h(sub)+'</p>':'')+'</div>'+actions+'</header>';
    function mount(html='') {const host=document.createElement('div');host.className='lab-workspace';host.innerHTML=html||'<p class="lab-loading" role="status">Opening your workspace…</p>';root().replaceChildren(host);return host;}
    const empty=(heading,copy,url,label)=>'<div class="lab-empty"><h3>'+h(heading)+'</h3><p>'+h(copy)+'</p>'+(url?action(url,label):'')+'</div>';
    const row=(url,heading,copy='',symbol='arrow')=>'<a class="lab-record" href="'+h(url)+'"><div><strong>'+h(heading)+'</strong>'+(copy?'<span>'+h(copy)+'</span>':'')+'</div>'+icon(symbol)+'</a>';
    const card=(color,label,heading,copy,url,button,extra='',symbol='arrow')=>'<article class="lab-color-card '+color+'"><p class="lab-kicker">'+h(label)+'</p><h2>'+h(heading)+'</h2>'+(copy?'<p class="lab-card-copy">'+h(copy)+'</p>':'')+extra+action(url,button,color==='yellow'?'solid':'circle',symbol)+'</article>';
    function notice(host,results) {
      const failed=results.filter(r=>r.status==='rejected'&&r.reason?.status!==401);
      const offline=results.some(r=>r.status==='fulfilled'&&r.value?._offline);
      if(!failed.length&&!offline)return;
      const node=document.createElement('div');node.className='lab-load-notice';node.setAttribute('role','status');
      node.innerHTML='<span>'+ (offline?'You’re offline. Showing the records saved on this device.':'Some records could not load. The available records are shown below.')+'</span><button class="btn ghost" type="button">Retry</button>';
      node.querySelector('button').onclick=()=>ctx.route();host.prepend(node);
    }
    const take=(result,fallback=[])=>result.status==='fulfilled'?result.value:fallback;

    /* Shared desktop sidebar and accessible mobile drawer. */
    const aside=document.createElement('aside');aside.className='lab-sidebar';aside.id='lab-sidebar';aside.hidden=true;aside.setAttribute('aria-label','Workspace navigation');
    document.body.insertBefore(aside,document.querySelector('.top'));
    const scrim=document.createElement('button');scrim.className='lab-scrim';scrim.hidden=true;scrim.setAttribute('aria-label','Close navigation');document.body.append(scrim);
    let drawerTrigger=null;
    const backgroundInert=value=>document.querySelectorAll('.top,#app,#nav').forEach(el=>el.inert=value);
    function closeDrawer(){backgroundInert(false);document.body.classList.remove('lab-drawer-open');scrim.hidden=true;document.getElementById('lab-menu')?.setAttribute('aria-expanded','false');if(drawerTrigger?.isConnected)drawerTrigger.focus();drawerTrigger=null;}
    scrim.onclick=closeDrawer;
    document.addEventListener('keydown',e=>{
      if(!document.body.classList.contains('lab-drawer-open'))return;
      if(e.key==='Escape'){e.preventDefault();closeDrawer();}
      if(e.key==='Tab'){
        const all=[...aside.querySelectorAll('a[href],button,input')].filter(x=>!x.hidden&&x.getClientRects().length);
        if(e.shiftKey&&document.activeElement===all[0]){e.preventDefault();all.at(-1)?.focus();}
        else if(!e.shiftKey&&document.activeElement===all.at(-1)){e.preventDefault();all[0]?.focus();}
      }
    });
    matchMedia('(min-width:1000px)').addEventListener('change',closeDrawer);
    const memberNav=[['home','Home','#/','home'],['practice','Practice plan','#/train','practice'],['sessions','Sessions','#/journey/sessions','calendar'],['reviews','Video & feedback','#/reviews','review'],['progress','Progress','#/progress','progress']];
    const coachNav=[['home','Today','#/coach/today','home'],['athletes','Athletes','#/workspace','people'],['sessions','Lesson planner','#/coach/plans','calendar'],['practice','Programs','#/coach/programs','practice'],['reviews','Review queue','#/coach/queue?filter=review','review']];
    const resources=()=>[['library','Library','#/library','book'],['play','Play & events','#/play','activity'],...(staff()?[['tools','Coaching tools','#/more','settings']]:[]),...(ctx.has('contributor','editor')?[['studio','Publishing','#/studio','book']]:[]),...(ctx.has('admin')?[['members','New members','#/admin/members','people'],['admin','Administration','#/admin','settings']]:[])];
    function section(p){
      const name=p.r[1],path=(location.hash||'#/').split('?')[0];
      if(['home','coachToday'].includes(name))return 'home';
      if(path.startsWith('#/admin/members'))return 'members';
      if(name==='coachQueue'||name==='labReviews'||/^#\/journey\/(videos|notes|feedback)/.test(path)||name==='followups')return 'reviews';
      if(/Progress$/.test(name)||path.startsWith('#/progress')||path==='#/timeline')return 'progress';
      if(path.startsWith('#/coach/plans')||path.startsWith('#/coach/lesson')||path.startsWith('#/i/')||path==='#/journey/sessions'||name==='session'||name==='live')return 'sessions';
      if(path.startsWith('#/workspace')||/^coach(New|Athlete|Code)?$/.test(name))return 'athletes';
      if(path.startsWith('#/train')||path.startsWith('#/development')||path==='#/programs'||path==='#/coach/programs')return 'practice';
      if(path.startsWith('#/learn')||name==='labLibrary')return 'library';
      if(name==='labMore')return 'tools';
      return p.r[2]||name;
    }
    ctx.renderShell=function(p){
      closeDrawer();const me=ctx.me(),logged=!!me,key=section(p);
      document.body.classList.toggle('lab-signed-in',logged);
      document.body.classList.toggle('lab-auth-page',!logged||p.r[1]==='welcome');
      document.body.classList.toggle('lab-compact-sidebar',!!L.Store.get('sidebar-compact',false));
      document.body.dataset.view=p.r[1];document.body.dataset.section=key;aside.hidden=!logged;
      const top=document.querySelector('.top-inner'),right=document.querySelector('.top-right');
      let menu=document.getElementById('lab-menu');
      if(!menu){menu=document.createElement('button');menu.id='lab-menu';menu.className='lab-icon-button lab-menu';menu.type='button';menu.innerHTML=icon('menu');menu.setAttribute('aria-label','Open navigation');menu.setAttribute('aria-controls','lab-sidebar');top.prepend(menu);}
      menu.hidden=!logged;menu.setAttribute('aria-expanded','false');
      menu.onclick=()=>{drawerTrigger=menu;document.body.classList.add('lab-drawer-open');scrim.hidden=false;backgroundInert(true);menu.setAttribute('aria-expanded','true');aside.querySelector('button')?.focus();};
      let account=document.getElementById('lab-account');
      if(!account){account=document.createElement('a');account.id='lab-account';account.className='lab-account';account.href='#/profile';right.append(account);}
      account.hidden=!logged;account.textContent=initials(me?.user?.name);account.setAttribute('aria-label','Your profile');
      const bell=document.getElementById('bell');bell.innerHTML=icon('bell');
      if(!logged)return;
      const navLink=([id,label,url,symbol])=>'<a href="'+url+'" class="lab-side-link" data-section="'+id+'" title="'+h(label)+'"'+(id===key?' aria-current="page"':'')+'>'+icon(symbol)+'<span class="lab-nav-label">'+h(label)+'</span></a>';
      aside.innerHTML='<div class="lab-side-brand"><a class="lab-wordmark" href="#/" aria-label="THE LAB home">THE LAB</a><button class="lab-icon-button" id="lab-collapse" aria-label="Collapse sidebar" type="button">'+icon('chevron')+'</button></div>'+
        '<form class="lab-side-search" role="search"><label class="sr-only" for="lab-search">Search your LAB</label>'+icon('search')+'<input id="lab-search" name="q" type="search" placeholder="Search your LAB" required><button type="submit" aria-label="Search">'+icon('arrow')+'</button></form>'+
        '<a class="lab-search-shortcut lab-icon-button" href="#/search" aria-label="Search your LAB">'+icon('search')+'</a>'+
        '<nav aria-label="Your workspace"><p class="lab-nav-group">'+(staff()?'COACH WORKSPACE':'YOUR TRAINING')+'</p>'+(staff()?coachNav:memberNav).map(navLink).join('')+'<p class="lab-nav-group">RESOURCES</p>'+resources().map(navLink).join('')+'</nav>'+
        '<div class="lab-side-bottom">'+navLink(['profile','Profile & settings','#/profile','profile'])+navLink(['more','All sections','#/more','menu'])+'</div>';
      aside.querySelector('form').onsubmit=e=>{e.preventDefault();location.hash='#/search?q='+encodeURIComponent(new FormData(e.currentTarget).get('q'));};
      const collapse=aside.querySelector('#lab-collapse');
      const labelCollapse=()=>{const mobile=matchMedia('(max-width: 999px)').matches;collapse.setAttribute('aria-label',mobile?'Close navigation':document.body.classList.contains('lab-compact-sidebar')?'Expand sidebar':'Collapse sidebar');};labelCollapse();
      collapse.onclick=()=>{if(matchMedia('(max-width: 999px)').matches)closeDrawer();else {const value=!L.Store.get('sidebar-compact',false);L.Store.set('sidebar-compact',value);document.body.classList.toggle('lab-compact-sidebar',value);labelCollapse();}};
      const bottom=staff()?[coachNav[0],coachNav[1],coachNav[2],coachNav[4]]:[memberNav[0],memberNav[1],memberNav[3],['profile','Profile','#/profile','profile']];
      document.querySelector('#nav .nav-inner').innerHTML=bottom.map(([id,label,url,symbol])=>'<a href="'+url+'" data-nav="'+(id===key?p.r[2]:'lab-'+id)+'"'+(id===key?' aria-current="page"':'')+'>'+icon(symbol)+'<span>'+h(({sessions:'Sessions',reviews:staff()?'Review':'Reviews',practice:'Practice',home:staff()?'Today':'Home'})[id]||label)+'</span></a>').join('');
    };

    const queue=ctx.views.coachToday;
    ctx.views.coachQueue=queue;
    ctx.routes.push([/^\/coach\/queue$/,'coachQueue','home'],[/^\/library$/,'labLibrary','learn'],[/^\/reviews$/,'labReviews','home'],[/^\/search$/,'labSearch','home'],[/^\/more$/,'labMore','profile']);

    function lessonCard(lessons,home) {
      const live=home.sessions?.find(s=>s.status==='live');
      if(live)return card('yellow','On court now',live.title,'Your session is in progress.','#/train/'+live.id,'Open session');
      const events=(home.events||[]).filter(e=>e.status==='live'||Date.parse(e.starts_at)>=Date.now()).map(e=>({...e,link:'#/play/events/'+e.id,event:true}));
      const next=[...lessons,...events].sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at))[0];
      if(next){
        const status=next.rsvp==='in'?'Confirmed':next.rsvp==='waitlist'||next.state==='waitlist'?'On the waitlist':next.rsvp==='invited'?'Reply to your invitation':next.rsvp==='maybe'?'RSVP: Maybe':next.state==='interested'?'Interest submitted':'';
        return card('yellow',next.event?'Next event':'Next lesson',date(next.starts_at,true,next.timezone),next.title,next.link,next.rsvp==='invited'?'View invitation':next.event?'View event':'View lesson',
          '<p class="lab-card-detail">'+h([next.coaches||next.coach,next.location,status].filter(Boolean).join(' · '))+'</p>');
      }
      return card('yellow','Your next session','Make it count.','No upcoming lesson is scheduled yet.',ctx.me().athlete_id?'#/check-in':'#/welcome',ctx.me().athlete_id?'Send a check-in':'Connect your profile','<p class="lab-card-detail">'+(ctx.me().athlete_id?'Tell your coach what you want to work on.':'Bring your coaching history into your dashboard.')+'</p>');
    }
    async function memberHome(){
      const host=mount(),me=ctx.me();
      const results=await Promise.allSettled([api.get('/api/home'),api.get('/api/me/lessons'),api.get('/api/me/development-blocks'),api.get('/api/me/assignments'),me.athlete_id?api.get('/api/athletes/'+me.athlete_id):Promise.resolve(null)]);
      if(!host.isConnected)return;
      if(results[0].status==='rejected')throw results[0].reason;
      const home=results[0].value,lessons=take(results[1]),blocks=take(results[2]),assignments=take(results[3]),profile=take(results[4],null);
      const rank={ready_retest:0,in_progress:1,assigned:2};
      const active=blocks.filter(b=>b.status in rank).sort((a,b)=>rank[a.status]-rank[b.status]||(a.due_on||'9999').localeCompare(b.due_on||'9999'));
      const block=active[0]||blocks.find(b=>['evidence_submitted','coach_review'].includes(b.status));
      const task=assignments.find(a=>a.status==='open');
      const coach=profile?.coaches?.[0]?.name;
      const feedback=profile?.notes?.find(n=>n.kind==='coach');
      const reflection=profile?.notes?.find(n=>n.kind==='reflection'&&!n.reviewed_at);
      const practiceTitle=block?.title||task?.title||home.athlete?.focus||(!me.athlete_id?'Connect your profile':'Find your next focus');
      const practiceCopy=block?(['evidence_submitted','coach_review'].includes(block.status)?'Your result is with your coach.':block.retest_notes||block.constraint_text||block.problem):task?.note||home.athlete?.goals||'Build a useful next step with your coach.';
      const practiceUrl=block?'#/development/'+block.id:task?'#/train':me.athlete_id?'#/journey/feedback':'#/welcome';
      const feedbackTitle=feedback?(feedback.reply_to?(feedback.author||'Your coach').split(' ')[0]+' replied':'A note from '+(feedback.author||'your coach').split(' ')[0]):reflection?'With your coach':'Your video room';
      const feedbackCopy=feedback?short(clean(feedback.body),90):reflection?'Your question or clip is awaiting review.':'Upload a clip and ask one clear question.';
      const message=action(me.athlete_id?'#/journey/feedback':'#/welcome',coach?'Message '+coach.split(' ')[0]:'Message your coach','outline','message');
      host.innerHTML=title('YOUR GAME.','Your lessons, practice and feedback in one place.',message)+
        '<div class="lab-dashboard-grid"><div class="lab-lesson">'+lessonCard(lessons,home)+'</div>'+
        '<div class="lab-focus">'+card('mint','Practice focus',practiceTitle,short(practiceCopy,100),practiceUrl,block?'View practice':task?'Open training':me.athlete_id?'Ask your coach':'Connect profile')+'</div>'+
        '<div class="lab-feedback">'+card('orange',feedback?'Coach feedback':'Video & feedback',feedbackTitle,feedbackCopy,feedback||reflection?'#/reviews':me.athlete_id?'#/journey/feedback?type=video':'#/welcome',feedback?'Read feedback':reflection?'View conversation':'Upload a clip','','review')+'</div>'+
        '<section class="lab-week lab-panel cream"><div class="lab-panel-heading"><h2>THIS WEEK</h2>'+icon('practice')+'</div><div id="lab-tasks"></div>'+action('#/train','Open practice plan')+'</section>'+
        '<section class="lab-journal lab-panel"><div class="lab-panel-heading"><h2>SESSION JOURNAL</h2><a href="#/journey/sessions">View all '+icon('arrow')+'</a></div>'+
        ((home.sessions||[]).slice(0,2).map(s=>row('#/train/'+s.id,s.title,date(s.started_at)+' · '+(s.status==='live'?'Live session':'Session recap'))).join('')||empty('Your work belongs here.','Recorded sessions will appear here after you train.'))+
        (feedback?row('#/reviews','From '+(feedback.author||'your coach'),short(clean(feedback.body),90),'review'):'')+row(me.athlete_id?'#/journey/feedback':'#/welcome','Your reflection','Add a note or question for your coach.','message')+'</section>'+
        '<section class="lab-resource-strip">'+icon('book')+'<div><h2>YOUR LIBRARY</h2><p>Practice guides, courses and session notes</p></div>'+action('#/library','Browse resources','outline')+'</section></div>'+
        (home.to_confirm?'<div class="lab-load-notice"><span>'+home.to_confirm+' match scores need your confirmation.</span>'+action('#/play','Review scores')+'</div>':'')+
        '<div class="lab-footer-links"><a href="#/progress">Measurements & progress</a><a href="#/timeline">Full coaching history</a><a href="#/programs">My programs</a><a href="#/play/events">Explore events</a></div>';
      const tasks=host.querySelector('#lab-tasks');
      const blockIds=new Map(blocks.flatMap(b=>[b.assignment_id,b.retest_assignment_id].filter(Boolean).map(id=>[id,b])));
      const list=assignments.filter(a=>a.status==='open'||(a.completed_at&&Date.now()-Date.parse(a.completed_at)<7*86400000)).slice(0,4);
      tasks.innerHTML=list.length?list.map(a=>blockIds.has(a.id)?row('#/development/'+blockIds.get(a.id).id,a.title,a.status==='done'?'Complete':'Open practice to share your result','practice'):
        '<label class="lab-task"><input type="checkbox" data-task="'+a.id+'" '+(a.status==='done'?'checked':'')+'><span>'+h(a.title)+(a.due_on?'<small>Due '+h(date(a.due_on))+'</small>':'')+'</span></label>').join(''):
        (block?row(practiceUrl,practiceTitle,'Your current coaching focus','practice'):empty('A clear next step.','Your assigned practices will appear here.',me.athlete_id?'#/check-in':'#/welcome',me.athlete_id?'Tell your coach your focus':'Finish your profile'));
      const taskStatus=document.createElement('p');taskStatus.className='lab-task-status';taskStatus.setAttribute('role','status');tasks.append(taskStatus);
      tasks.querySelectorAll('[data-task]').forEach(box=>box.onchange=async()=>{const checked=box.checked;box.disabled=true;taskStatus.textContent='Saving…';try{await api.request('PUT','/api/assignments/'+box.dataset.task,{status:checked?'done':'open'});taskStatus.textContent=checked?'Practice marked complete.':'Practice reopened.';}catch(e){box.checked=!checked;taskStatus.textContent=e.message+' Please try again.';}finally{box.disabled=false;}});
      notice(host,results);
    }

    function workLink(item){
      if(item.kind==='review')return '#/coach/queue?filter=review';
      if(item.kind==='development')return '#/development/'+item.recordId;
      if(item.kind==='session')return '#/train/'+item.recordId;
      if(item.kind==='event')return '#/play/events/'+item.recordId;
      if(item.kind==='retest')return '#/progress/app/'+item.athleteId;
      if(item.kind==='task')return '#/followups';
      return '#/coach/'+item.athleteId;
    }
    ctx.views.coachToday=async function(_,query={}) {
      if(!staff())return ctx.forbidden('Coaching tools require a coach account.');
      if(query.filter)return queue(_,query);
      const host=mount();
      const results=await Promise.allSettled([api.request('GET','/api/coach/next-lesson'),api.request('GET','/api/coach/dashboard'),ctx.has('admin')?api.request('GET','/api/admin/members'):Promise.resolve(null),api.request('GET','/api/plans')]);
      if(!host.isConnected)return;
      const next=take(results[0],{}),dashboard=take(results[1],null),members=take(results[2],null),plans=take(results[3]);
      let lesson;
      if(next.live)lesson=card('yellow','On court now',next.live.title,'Your scorecard is open.','#/train/'+next.live.id+'/live','Resume session');
      else if(next.lesson){const {plan,players,blocks}=next.lesson;lesson=card('yellow',plan.status==='draft'?'Draft lesson':'Next lesson',date(plan.starts_at,true),plan.title,'#/coach/lesson/'+plan.id,'Open lesson','<p class="lab-card-detail">'+h([players.length+' on roster',blocks.length+' drills',plan.location].filter(Boolean).join(' · '))+'</p>');}
      else lesson=card('yellow',results[0].status==='rejected'?'Lesson planner':'Your next lesson',results[0].status==='rejected'?'Check your planner':'Make room for the work.',results[0].status==='rejected'?'The next lesson could not load.':'Choose your athletes, set the focus and plan the session.','#/coach/plans/new','Plan a lesson');
      const reviews=(dashboard?.items||[]).filter(x=>x.priority==='review');
      const newMember=members?.items?.find(x=>x.email_state&&!x.reviewed_at);
      const reviewTitle=reviews.length?reviews.length+' waiting for review':dashboard?'You’re caught up':'Review your queue';
      const ordered=(dashboard?.items||[]).filter(x=>x.priority!=='later').sort((a,b)=>({overdue:0,review:1,today:2,soon:3,open:4}[a.priority]??5)-({overdue:0,review:1,today:2,soon:3,open:4}[b.priority]??5));
      const upcoming=plans.filter(p=>p.status!=='done'&&p.status!=='cancelled'&&Date.parse(p.starts_at)>=Date.now()&&p.id!==next.lesson?.plan?.id).slice().sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at)).slice(0,3);
      host.innerHTML=title('YOUR DAY.','The next lesson, the next welcome, the next useful step.',action('#/train/new','Start a session','outline','add'))+
        '<div class="lab-dashboard-grid"><div class="lab-lesson">'+lesson+'</div><div class="lab-focus">'+
        (ctx.has('admin')?card('mint','New members',newMember?.name||(members?'Everyone welcomed':'Member welcome'),members?(members.unreviewed?members.unreviewed+' new member'+(members.unreviewed===1?'':'s')+' to welcome.':'Recent signups are ready to view.'):'Open your member queue to check new signups.',newMember?'#/admin/members/'+newMember.id:'#/admin/members',newMember?'View profile':'View members'):
          card('mint','Your athletes',dashboard?dashboard.athletes.length+' in your roster':'Your coaching roster','Open a profile, capture a cue or set the next practice.','#/workspace','Open athletes'))+'</div><div class="lab-feedback">'+
        card('orange','Coaching reviews',reviewTitle,reviews[0]?reviews[0].name+' · '+reviews[0].title:dashboard?'No app feedback is waiting. Open the full queue for connected records.':'Check questions, practice results and clips.','#/coach/queue?filter=review','Open reviews','','review')+'</div>'+
        '<section class="lab-week lab-panel cream"><div class="lab-panel-heading"><h2>NEXT ACTIONS</h2>'+icon('practice')+'</div>'+(ordered.slice(0,4).map(i=>row(workLink(i),i.name||i.title,short(i.title+(i.priority==='overdue'?' · Overdue':''),90))).join('')||empty(dashboard?'A little breathing room.':'Your queue is available.','Plan a lesson or check your full coaching queue.'))+action('#/coach/queue','Full action queue')+'</section>'+
        '<section class="lab-journal lab-panel"><div class="lab-panel-heading"><h2>COMING UP</h2><a href="#/coach/plans">Planner '+icon('arrow')+'</a></div>'+(upcoming.map(p=>row('#/coach/lesson/'+p.id,p.title,date(p.starts_at,true)+(p.status==='draft'?' · Draft':''))).join('')||empty('Your next sessions.','Scheduled lesson plans appear here.'))+
        row('#/followups','Follow-ups','Keep your next action for each athlete.','message')+row('#/coach/queue?filter=website','Earlier coaching records','Review work from the connected website.','book')+'</section>'+
        '<section class="lab-resource-strip">'+icon('people')+'<div><h2>YOUR COACHING WORKSPACE</h2><p>Athlete profiles, programs, events and quick capture</p></div>'+action('#/more','All coaching tools','outline')+'</section></div>'+
        '<div class="lab-footer-links"><a href="#/coach/development/new">Assign a practice</a><a href="#/coach/programs">Build a program</a><a href="#/companion-link">Member QR code</a><button class="lab-text-button" id="lab-refresh">Refresh dashboard</button></div>';
      host.querySelector('#lab-refresh').onclick=()=>ctx.route();notice(host,results);
    };
    ctx.views.home=()=>staff()?ctx.views.coachToday():memberHome();

    ctx.views.labReviews=async()=>{
      if(staff())return queue(undefined,{filter:'review'});
      const host=mount(),id=ctx.me()?.athlete_id;
      host.innerHTML=title('YOUR FEEDBACK.','Clips, questions and the coaching conversation.',action(id?'#/journey/feedback?type=video':'#/welcome','Upload a clip','outline','add'));
      if(!id){host.innerHTML+=empty('Connect your coaching profile.','Your videos and feedback belong to your player profile.','#/welcome','Connect profile');return;}
      const p=await api.get('/api/athletes/'+id);if(!host.isConnected)return;
      const media=new Map(p.media.map(m=>[m.id,m]));
      const notes=p.notes;
      host.innerHTML+='<div class="lab-filter-links">'+action('#/journey/notes','All coaching notes','outline','message')+action('#/journey/videos','Your video room','outline','review')+'</div><div class="lab-review-grid">'+(notes.length?notes.map(n=>{
        const m=media.get(n.media_id),mime=n.media_mime||m?.mime||'';
        return '<article class="lab-panel lab-review-note" data-author-kind="'+(n.kind==='coach'?'coach':'member')+'"><div class="lab-panel-heading"><p class="lab-kicker">'+h(n.kind==='coach'?'From '+(n.author||'your coach'):n.reviewed_at?'Reviewed':'Awaiting review')+'</p><time>'+h(date(n.created_at))+'</time></div><p class="lab-note-body">'+h(clean(n.body))+'</p>'+
          (n.media_id&&mime.startsWith('video/')?'<video controls playsinline preload="metadata" aria-label="Training clip" src="/api/media/'+h(n.media_id)+'"></video>':n.media_id&&mime.startsWith('image/')?'<img loading="lazy" alt="Shared coaching attachment" src="/api/media/'+h(n.media_id)+'">':'')+
          action('#/journey/feedback','Ask a follow-up','outline','message')+'</article>';
      }).join(''):empty('Start with one useful question.','Upload a clip and tell your coach what to look for.','#/journey/feedback?type=video','Upload your first clip'))+'</div>';
    };

    ctx.views.labLibrary=async()=>{
      const host=mount(),results=await Promise.allSettled([api.get('/api/courses'),api.get('/api/posts')]);if(!host.isConnected)return;
      const courses=take(results[0]),raw=take(results[1]),posts=Array.isArray(raw)?raw:raw.posts||[];
      host.innerHTML=title('YOUR LIBRARY.','Keep the useful things close. Courses, field notes and your own coaching history.')+
        '<form class="lab-page-search" role="search"><label for="library-search">Find a resource</label><div>'+icon('search')+'<input type="search" id="library-search" placeholder="Search courses and field notes"></div></form>'+
        '<div class="lab-filter-links" role="group" aria-label="Resource type"><button class="btn" data-kind="all" aria-pressed="true">All resources</button><button class="btn ghost" data-kind="course" aria-pressed="false">Courses</button><button class="btn ghost" data-kind="post" aria-pressed="false">Field notes</button></div><div id="library-results" class="lab-library-grid"></div>'+
        '<section class="lab-panel lab-personal-library"><h2>YOUR COACHING RECORDS</h2>'+row('#/journey/videos','Your videos & photos','Media shared on your athlete profile.','review')+row('#/timeline','Session history','Your sessions, notes and connected coaching records.','calendar')+row('#/website','Earlier website records','Open your connected coaching history.','book')+'</section>';
      let kind='all';const items=[...courses.map(c=>({...c,kind:'course',href:'#/learn/course/'+c.slug})),...posts.map(p=>({...p,kind:'post',href:'#/learn/'+p.slug}))];
      const paint=()=>{const query=host.querySelector('#library-search').value.toLowerCase().trim(),rows=items.filter(i=>(kind==='all'||i.kind===kind)&&[i.title,i.summary,i.description].join(' ').toLowerCase().includes(query));
        host.querySelector('#library-results').innerHTML=rows.map(i=>'<article class="lab-panel" data-resource-kind="'+i.kind+'"><p class="lab-kicker">'+h(i.kind==='course'?'Course'+(i.access==='members'?' · Member access':''):'Field note')+'</p><h2>'+h(i.title)+'</h2><p>'+h(short(i.summary||i.description||'',160))+'</p>'+action(i.href,'Open '+(i.kind==='course'?'course':'field note'))+'</article>').join('')||empty(items.length?'No matching resources.':'Your library is growing.',items.length?'Try another search or resource type.':'Published courses and field notes will appear here.');};
      host.querySelector('form').onsubmit=e=>e.preventDefault();host.querySelector('input').oninput=paint;
      host.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{kind=b.dataset.kind;host.querySelectorAll('[data-kind]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));paint();});paint();notice(host,results);
    };
    ctx.views.labMore=()=>{
      const host=mount();
      const groups=[['YOUR LAB',[...(staff()?coachNav:memberNav),...resources(),['profile','Profile & settings','#/profile','profile'],['notifications','Notifications','#/notifications','bell'],['sync','Offline & sync','#/sync','refresh']]],
        ...(staff()?[['ON COURT',[['start','Start a session','#/train/new','add'],['quick','Quick make / miss','#/train/new?quick=1','activity'],['assign','Assign a practice','#/coach/development/new','practice'],['desk','Events desk','#/coach/desk','calendar'],['checks','Pre-session check-ins','#/coach/checkins','message'],['follow','Coach follow-ups','#/followups','message'],['entry','Member QR & NFC link','#/companion-link','people'],['health','Roster connections','#/coach/connections','people']]]]:[]),
        ['COACHING HISTORY',[['journal','Session journal','#/journey/sessions','calendar'],['notes','Coaching notes','#/journey/notes','message'],['history','Connected timeline','#/timeline','progress'],['website','Earlier website records','#/website','book'],...(ctx.me()?.user?.workspace?[['workspace','Connected staff workspace','#/workspace','people']]:[])]]];
      host.innerHTML=title('YOUR WORKSPACE.','Everything you need, with a clear place for it.')+'<div class="lab-library-grid">'+groups.map(([name,links])=>'<section class="lab-panel"><h2>'+name+'</h2>'+links.filter(x=>x[2]!=='#/more').map(([,label,url,symbol])=>row(url,label,'',symbol)).join('')+'</section>').join('')+'</div>';
    };
    ctx.views.labSearch=async(_,query={})=>{
      const host=mount(),isCoach=staff();
      host.innerHTML=title('FIND YOUR NEXT STEP.','Search your recent sessions, practices, lessons and learning resources.')+'<form class="lab-page-search" role="search"><label for="workspace-search">Search your LAB</label><div>'+icon('search')+'<input id="workspace-search" type="search" value="'+h(query.q||'')+'" placeholder="A name, practice, session or course"><button class="btn" type="submit">Search</button></div></form><p id="search-count" role="status">Loading records…</p><div id="search-results" class="lab-panel"></div>';
      const requests=[api.get('/api/home'),api.get('/api/courses'),api.get('/api/me/development-blocks'),isCoach?api.request('GET','/api/athletes'):Promise.resolve([]),isCoach?api.request('GET','/api/plans'):api.get('/api/me/lessons'),api.get('/api/training/sessions'),api.get('/api/posts?limit=100')];
      const results=await Promise.allSettled(requests);if(!host.isConnected)return;
      const home=take(results[0],{});
      const items=[...take(results[5]).map(x=>({title:x.title,copy:'Session · '+date(x.started_at),href:'#/train/'+x.id})),...take(results[6]).map(x=>({title:x.title,copy:'Field note · '+(x.summary||''),href:'#/learn/'+x.slug})),...take(results[1]).map(x=>({title:x.title,copy:'Course · '+(x.summary||''),href:'#/learn/course/'+x.slug})),...take(results[2]).map(x=>({title:x.title,copy:'Practice · '+(x.problem||''),href:'#/development/'+x.id})),...take(results[3]).map(x=>({title:x.name,copy:'Athlete · '+(x.focus||''),href:'#/coach/'+x.id})),...take(results[4]).map(x=>({title:x.title,copy:'Lesson · '+date(x.starts_at,true),href:isCoach?'#/coach/lesson/'+x.id:x.link}))];
      const paint=()=>{const term=host.querySelector('input').value.trim().toLowerCase(),rows=items.filter(i=>!term||[i.title,i.copy].join(' ').toLowerCase().includes(term));host.querySelector('#search-count').textContent=(rows.length>60?'Showing 60 of '+rows.length:rows.length)+' matching records';host.querySelector('#search-results').innerHTML=rows.slice(0,60).map(i=>row(i.href,i.title,short(i.copy,180))).join('')||empty('No matching records.','Try a different name or phrase.');};
      host.querySelector('input').oninput=paint;host.querySelector('form').onsubmit=e=>{e.preventDefault();paint();};paint();notice(host,results);
    };
  });
})();
