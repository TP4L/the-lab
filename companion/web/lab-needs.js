(function(root){
  'use strict';
  const terms={
    'Transition reset':['reset in transition','reset from transition','lower transition reset','transition resets'],
    'Bounce read':['read the bounce','bounce reads','bounce recognition'],
    'Middle priority':['middle ball priority','middle coverage'],
    'Third-shot drop':['third shot drop','3rd shot drop','third shot drops'],
    'Fourth-ball decision':['4th ball decision','fourth ball decision'],
    'Dink placement':['dink targets','dink placement'],
    'Counter':['counters','counterattack'], 'Speed-up selection':['speed up selection','speedup selection'],
    'Footwork':['foot work'], 'Outer Post':['outer-post']
  };
  const key=x=>String(x||'').toLowerCase().replace(/[-_]/g,' ').trim().replace(/\s+/g,' ');
  const aliases=new Map();
  for(const [name,variants] of Object.entries(terms)) for(const v of [name,...variants]) aliases.set(key(v),name);
  const canonical=x=>aliases.get(key(x))||key(x);
  function shared(athletes) {
    const groups=new Map();
    for(const a of athletes) for(const need of new Set((a.training_needs||[]).map(canonical).filter(Boolean))) {
      if(!groups.has(need))groups.set(need,[]);
      groups.get(need).push(a.name);
    }
    return [...groups].filter(([,names])=>names.length>1).sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0]));
  }
  const api={terms:Object.keys(terms),canonical,shared};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.LabNeeds=api;
})(typeof window==='undefined'?this:window);
