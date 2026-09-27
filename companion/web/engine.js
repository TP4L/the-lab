/* LAB decision engine. Shared by the browser (window.LabEngine) and the server (require). */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.LabEngine=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  /* ================= model ================= */
  var RUNGS=['Survive','Recover','Stabilize','Build','Pressure','Finish'];
  var STATES={D:'Defensive',N:'Neutral',O:'Offensive'};
  var LEVEL=['zero','low','moderate','high'];

  var CALLS=[
    {id:'x',name:'Respect the X',kind:'rev',state:'Def / Neutral',rung:'Stabilize +',layer:'Threat, Pattern Memory',
     text:'The anchor point that generates the danger stays in your accounting even when the ball is elsewhere. Failing to respect it shows up one beat later as a Scramble that came out of nowhere.'},
    {id:'tri',name:'The Triangle',seq:'speedup → counter → exit',kind:'com',state:'Offensive',rung:'Build / Pressure',layer:'Tempo, Initiative',
     text:'Three beats run as one unit. Speed up to force a reaction, counter the reaction, exit into the space it vacated. How you buy a missing factor. Illegal on Survive or Recover.'},
    {id:'own',name:'Own space not lines',kind:'rev',state:'Any',rung:'Any',layer:'Cost, Threat',
     text:'Occupy and hold area. Do not chase a line or defend where someone just was. Space is cheap to hold and expensive to chase.'},
    {id:'gsg',name:'Go Stay Go',kind:'rev',state:'Def / Neutral',rung:'Stabilize / Pressure',layer:'Tempo',
     text:'Approach, hold, re-approach. The Stay beat is information: it makes the opponent declare before you commit. The low-Certainty call.'},
    {id:'hpo',name:'Hip Pocket Over',kind:'com',state:'Defensive',rung:'Pressure',layer:'Initiative, Pressure',
     text:'Ride in the hip pocket, then take the over-top position. Takes a factor away by position, not effort. High Certainty only, debt paid first.'},
    {id:'ccs',name:'Cover Cover Sit',kind:'rev',state:'Defensive',rung:'Survive → Stabilize',layer:'Cost, Recovery Debt',
     text:'Two cover beats, then settle. Sit is the deliberate refusal to borrow. It stops a Scramble compounding.'},
    {id:'osg',name:'Oh Slide Go',kind:'com',state:'Def / Def-Scramble',rung:'Survive / Stabilize',layer:'Threat, Initiative',
     text:'Recognize, slide, commit. Creates Recovery Debt and hands someone else the Cover job, so it is only legal when that job can be filled.'}
  ];
  var BY={};CALLS.forEach(function(c){BY[c.id]=c;});

  var ERRORS=[
    {id:'see',name:'See',what:'Didn’t perceive it',fix:'Eyes, scan pattern, field width'},
    {id:'read',name:'Read',what:'Perceived, misjudged H/T/B',fix:'Reps against that specific look'},
    {id:'state',name:'State',what:'Misjudged who holds initiative',fix:'Slow the state call'},
    {id:'need',name:'Need',what:'Right read, wrong rung (usually rung-skipping)',fix:'Name the rung out loud'},
    {id:'solve',name:'Solve',what:'Right rung, wrong action',fix:'Vocabulary drilling'},
    {id:'org',name:'Organize',what:'Right action, jobs collided or Recover unfilled',fix:'Communication'},
    {id:'exec',name:'Execution',what:'Everything right, body failed',fix:'Physical, not decisional'}
  ];

  /* Legality of each call against the inputs. Returns {ok, why}. */
  function legality(id,s){
    var st=s.state,r=s.need,c=s.cert;
    var DN=st==='D'||st==='N';
    switch(id){
      case 'x':
        if(!DN) return no('Defensive or Neutral only.');
        if(r<2) return no('Needs Stabilize or higher; on '+RUNGS[r]+' the job is closer to the ball.');
        return yes('Threat call. Legal from Stabilize up.');
      case 'tri':
        if(st!=='O') return no('Offensive only. You need the initiative to speed up.');
        if(r!==3&&r!==4) return no('Build or Pressure only.'+(r<2?' The speedup borrows Balance you don’t have.':''));
        if(s.b<2) return no('The speedup beat spends Balance, and yours is '+LEVEL[s.b]+'.');
        if(c==='low') return no('Low Certainty caps commitment.');
        return yes('Buys the missing factor by forcing a reaction.');
      case 'own':
        return yes(s.scr?'Lowest-Cost way to stay connected while the map is stale.':'Legal from any state and rung.');
      case 'gsg':
        if(!DN) return no('Defensive or Neutral only.');
        if(r!==2&&r!==4) return no('Stabilize or Pressure only.');
        return yes('Reversible. The Stay beat buys information.');
      case 'hpo':
        if(st!=='D') return no('Defensive only.');
        if(r!==4) return no('Pressure only.');
        if(s.debt) return no('Debt has to be paid first.');
        if(c!=='high') return no('Committing call. Needs high Certainty.');
        return yes('Takes a factor by position, not effort.');
      case 'ccs':
        if(st!=='D') return no('Defensive only.');
        if(r>2) return no('Survive, Recover or Stabilize only.');
        return yes('Reversible. Refuses to borrow.');
      case 'osg':
        if(st!=='D') return no('Defensive only.');
        if(r!==0&&r!==2) return no('Survive or Stabilize only.');
        if(c==='low') return no('Committing call. Low Certainty makes it illegal.');
        if(s.debt) return no('A second commit on unpaid debt.');
        if(!s.cover) return no('Nobody can take the Cover job it hands off.');
        return yes('Real, immediate danger and Cover can be filled.');
    }
    function yes(w){return {ok:true,why:w};}
    function no(w){return {ok:false,why:w};}
  }

  /* One action. Ordered preference per state and rung, then filtered by legality. */
  function pick(s){
    var p=s.h*s.t*s.b, live=p>=8, pref;
    if(s.state==='O'){
      pref=['tri','own'];
    } else if(s.state==='N'){
      if(s.cert==='low') pref=['gsg','x','own'];
      else if(s.drift) pref=['x','gsg','own'];
      else if(s.need===2||s.need===4) pref=['gsg','x','own'];
      else pref=['x','gsg','own'];
    } else {
      switch(s.need){
        case 0: pref = live ? ['osg','ccs','own'] : ['ccs','own']; break;
        case 1: pref = s.scr ? ['own','ccs'] : ['ccs','own']; break;
        case 2:
          if(s.debt||s.scr) pref=['ccs','own'];
          else if(s.drift) pref=['x','gsg','ccs'];
          else if(live && s.cert==='high') pref=['osg','gsg','x','ccs'];
          else pref=['gsg','x','ccs'];
          break;
        case 4: pref=['hpo','gsg','x','own']; break;
        default: pref=['x','own'];
      }
    }
    for(var i=0;i<pref.length;i++){ if(legality(pref[i],s).ok) return pref[i]; }
    return 'own';
  }

  function whyLine(id,s){
    var mine=s.state==='O';
    var fac=lowestFactor(s);
    switch(id){
      case 'x': return s.drift
        ? 'My eyes are on the ball, but the shot comes from the X, so keeping it in my accounting costs nothing and ignoring it costs a Scramble.'
        : 'Nothing needs a commit right now, so the job is keeping the point that creates the shot in my accounting.';
      case 'tri': return fac+' is my zero and he won’t give it up standing still, so I make him move and take what he vacates.';
      case 'own': return s.debt||s.need===1
        ? 'I’m in Recovery Debt, so chasing a line costs legs I don’t have and holding the area costs nothing.'
        : (mine ? 'No call in the vocabulary buys a factor from here, so I hold my spacing and let the Reassess find the next one.'
                : 'Space is cheap to hold and expensive to chase, and chasing is what pulls the unit out of shape.');
      case 'gsg': return s.cert==='low'
        ? 'Low Certainty makes a commit illegal, so the Stay beat buys the information before I spend the cushion.'
        : 'Breaking tempo without adding pace makes him declare first, and it stays reversible if I read it wrong.';
      case 'hpo': return 'Certainty is high and the debt is paid, so I take '+fac+' by position instead of by effort.';
      case 'ccs': return s.debt
        ? 'I’ve already got one unpaid debt this possession; the Sit refuses to borrow a second and buys the unit its reset.'
        : 'The read isn’t clean enough to borrow on, so I cover twice and settle instead of committing.';
      case 'osg': return 'The danger is real and immediate and Cover can be filled, so someone has to leave their slot and it’s me.';
    }
  }

  function lowestFactor(s){
    var f=[['Height',s.h],['Time',s.t],['Balance',s.b]];
    f.sort(function(a,b){return a[1]-b[1];});
    return f[0][0];
  }

  function readLine(s){
    var who=s.state==='O'?'mine':'his';
    var hTxt=['zero, the ball is off-stick or the stick is taken','low, the release has to travel up first','moderate, stick is coming up','high, stick up and loaded'][s.h];
    var tTxt=['zero, pressure is on him','low, under a step of cushion','moderate, a step or two of cushion','high, no pressure applied'][s.t];
    var bTxt=['zero, still catching up to himself','low, weight isn’t over the base','moderate, mostly under himself','high, feet under him'][s.b];
    if(who==='mine'){
      hTxt=['zero, my hands are taken','low, the release has to travel up first','moderate, hands coming free','high, hands free and loaded'][s.h];
      tTxt=['zero, he’s on me','low, he’s tight','moderate, a step of separation','high, no pressure on me'][s.t];
      bTxt=['zero, I’m still catching up','low, weight isn’t over my base','moderate, mostly under myself','high, I’m under myself'][s.b];
    }
    var cTxt={low:'Certainty low, act reversibly.',mod:'Certainty moderate, no one has declared.',high:'Certainty high, he’s committed.'}[s.cert];
    var oTxt=s.o==='away'?' Orientation away, one turn from a shot.':' Orientation square.';
    return 'Height '+hTxt+'. Time '+tTxt+'. Balance '+bTxt+'.'+oTxt+' '+cTxt;
  }

  function flags(s){
    var out=[], p=s.h*s.t*s.b;
    if(s.debt && s.need>=3) out.push(['Rung check','Debt is unpaid and you’ve set '+RUNGS[s.need]+'. Debt is the usual reason a rung can’t be climbed. Is this really '+RUNGS[s.need]+', or Recover?']);
    if(s.state!=='O' && p===0) out.push(['Product is zero',lowestFactor(s)+' is already at zero. You don’t need all three; don’t spend on a factor he already lacks.']);
    if(s.state==='O' && p>0 && s.need<5 && Math.min(s.h,s.t,s.b)===3) out.push(['Rung check','All three factors are high. If the shot is there, you’re on Finish.']);
    if(s.state==='O' && s.need===5) out.push(['Finish','No call in the vocabulary is a Finish call. Convert.']);
    if(s.state==='O' && s.need<3) out.push(['Rung check','On '+RUNGS[s.need]+' with the ball, the job is getting legal again, not buying a factor.']);
    if(s.o==='away' && s.state!=='O') out.push(['Orientation','He’s facing away. The turn he needs is Time you can attack.']);
    return out;
  }

  function stateLine(s){return STATES[s.state]+(s.scr?' / Scramble':'')+'. Need: '+RUNGS[s.need]+'.';}

  /* Fill defaults and clamp so any stored or posted input is safe to run. */
  function normalize(i){
    i=i||{};
    function lvl(v,d){v=parseInt(v,10);return v>=0&&v<=3?v:d;}
    return {
      h:lvl(i.h,2),t:lvl(i.t,2),b:lvl(i.b,2),
      o:i.o==='away'?'away':'to',
      cert:['low','mod','high'].indexOf(i.cert)>=0?i.cert:'mod',
      state:STATES[i.state]?i.state:'D',
      scr:!!i.scr,
      need:(function(n){n=parseInt(n,10);return n>=0&&n<=5?n:2;})(i.need),
      debt:!!i.debt,cover:!!i.cover,drift:!!i.drift
    };
  }

  function run(input){
    var s=normalize(input), id=pick(s);
    return {
      call:id,
      read:readLine(s),
      state:stateLine(s),
      why:whyLine(id,s),
      flags:flags(s).map(function(f){return {title:f[0],text:f[1]};}),
      product:s.h*s.t*s.b,
      legal:CALLS.map(function(c){var L=legality(c.id,s);return {id:c.id,ok:L.ok,why:L.why};})
    };
  }

  var POSITIONS=['Attack','Midfield','Defense','LSM','Goalie','FOGO'];

  return {RUNGS:RUNGS,STATES:STATES,CALLS:CALLS,BY:BY,ERRORS:ERRORS,POSITIONS:POSITIONS,
          legality:legality,normalize:normalize,run:run};
});
