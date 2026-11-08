/* LAB tag helpers shared by skills, thread and goals: render the vocabulary as pills, and a compact picker. */
(function(){'use strict';
 const h=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const FALLBACK={reads:['height','time','balance'],states:['defensive','neutral','offensive'],needs:['survive','recover','stabilize','build','pressure','finish'],errors:['see','read','state','need','solve','organize','execution'],calls:['respect-the-x','triangle','own-space','go-stay-go','hip-pocket-over','cover-cover-sit','oh-slide-go'],
  labels:{reads:{height:'Height',time:'Time',balance:'Balance'},states:{defensive:'Defensive',neutral:'Neutral',offensive:'Offensive'},needs:{survive:'Survive',recover:'Recover',stabilize:'Stabilize',build:'Build',pressure:'Pressure',finish:'Finish'},errors:{see:'See',read:'Read',state:'State',need:'Need',solve:'Solve',organize:'Organize',execution:'Execution'},calls:{'respect-the-x':'Respect the X',triangle:'The Triangle','own-space':'Own space not lines','go-stay-go':'Go Stay Go','hip-pocket-over':'Hip Pocket Over','cover-cover-sit':'Cover Cover Sit','oh-slide-go':'Oh Slide Go'}},levels:13};
 let V=FALLBACK;
 const setVocab=v=>{if(v&&v.labels)V=v;return V;};
 const label=(group,key)=>(V.labels[group]&&V.labels[group][key])||key;
 /* Pills for a tag object {reads,state,need,error,call} or a reads array. */
 function pills(tags,opts){
  const o=opts||{};const t=Array.isArray(tags)?{reads:tags}:(tags||{});const out=[];
  for(const r of (t.reads||[]))out.push('<span class="lab-pill read '+r+'" title="Read: '+h(label('reads',r))+'">'+(o.short?label('reads',r)[0]:h(label('reads',r)))+'</span>');
  if(t.state)out.push('<span class="lab-pill state" title="State">'+h(label('states',t.state))+'</span>');
  if(t.need)out.push('<span class="lab-pill need" title="Need">'+h(label('needs',t.need))+'</span>');
  if(t.error)out.push('<span class="lab-pill error" title="Error layer">'+h(label('errors',t.error))+' error</span>');
  if(t.call)out.push('<span class="lab-pill call" title="Call">'+h(label('calls',t.call))+'</span>');
  if(o.level&&(o.level.min||o.level.max))out.push('<span class="lab-pill level" title="LAB level band">L'+(o.level.min||1)+(o.level.max&&o.level.max!==(o.level.min||1)?'–'+o.level.max:'')+'</span>');
  return out.length?'<span class="lab-pills">'+out.join('')+'</span>':'';
 }
 /* Picker: reads as toggles; state/need/error as single-select chips. `groups` limits what is shown. */
 function picker(id,value,groups){
  const v=value||{},g=groups||['reads','state','need','error'];
  const chips=(group,list,sel,multi)=>list.map(k=>'<button type="button" class="chip lab-chip" data-group="'+group+'" data-k="'+k+'" aria-pressed="'+(multi?(sel||[]).includes(k):sel===k)+'">'+h(label(group==='reads'?'reads':group+'s',k))+'</button>').join('');
  return '<div class="lab-picker" id="'+h(id)+'">'+(g.includes('reads')?'<div class="lab-group"><span class="lab-g-label">Read</span><div class="chips">'+chips('reads',V.reads,v.reads,true)+'</div></div>':'')+(g.includes('state')?'<div class="lab-group"><span class="lab-g-label">State</span><div class="chips">'+chips('state',V.states,v.state,false)+'</div></div>':'')+(g.includes('need')?'<div class="lab-group"><span class="lab-g-label">Need</span><div class="chips">'+chips('need',V.needs,v.need,false)+'</div></div>':'')+(g.includes('error')?'<div class="lab-group"><span class="lab-g-label">Error layer</span><div class="chips">'+chips('error',V.errors,v.error,false)+'</div></div>':'')+(g.includes('call')?'<div class="lab-group"><span class="lab-g-label">Call</span><div class="chips">'+chips('call',V.calls,v.call,false)+'</div></div>':'')+'</div>';
 }
 function bind(el,onChange){
  el.querySelectorAll('.lab-chip').forEach(b=>b.onclick=()=>{const multi=b.dataset.group==='reads';const on=b.getAttribute('aria-pressed')==='true';if(!multi)el.querySelectorAll('.lab-chip[data-group="'+b.dataset.group+'"]').forEach(x=>x.setAttribute('aria-pressed','false'));b.setAttribute('aria-pressed',String(!on));if(onChange)onChange(read(el));});
 }
 function read(el){
  const out={};const reads=[...el.querySelectorAll('.lab-chip[data-group="reads"][aria-pressed="true"]')].map(b=>b.dataset.k);if(reads.length)out.reads=reads;
  for(const g of ['state','need','error','call']){const b=el.querySelector('.lab-chip[data-group="'+g+'"][aria-pressed="true"]');if(b)out[g]=b.dataset.k;}
  return out;
 }
 const empty=t=>!t||Object.keys(t).length===0;
 window.LabTags={setVocab,vocab:()=>V,label,pills,picker,bind,read,empty};
})();
