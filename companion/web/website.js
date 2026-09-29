/* Website data stays on the website; no private records enter offline storage. */
(function(){'use strict';window.LabPlugins=window.LabPlugins||[];window.LabPlugins.push(function(ctx){
 const root=()=>document.getElementById('app');
 const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function api(path,body){const r=await fetch('/api/site-bridge'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Please retry.');return d}
 ctx.routes.push([/^\/website$/,'website','profile']);
 async function render(host,embedded){
  const generation=(host.bridgeGeneration||0)+1;host.bridgeGeneration=generation;
  const active=()=>host.isConnected&&host.bridgeGeneration===generation;
  const get=id=>host.querySelector('#'+id);
  const root=()=>host;
  const s=await api('');if(!active())return;root().innerHTML=(embedded?'<h2>Your website coaching</h2>':ctx.head('Website connection','Your coaching, together'))+'<p>Approved website focus, shared notes and coach replies. Reflections below go to your website coach.</p><p id="bridge-message" role="status"></p>';
  const box=document.createElement('section');box.className='card stack';root().appendChild(box);
  if(!s.connected){box.innerHTML='<p>Sign in to your website account and create a connection code for your claimed athlete profile.</p><a class="btn" target="_blank" rel="noopener noreferrer" href="'+esc(s.website)+'/app-connection">Get website code</a><form id="bridge-connect"><label for="bridge-code">Connection code</label><textarea id="bridge-code" required maxlength="64" autocomplete="off"></textarea><p>This connects that website profile to the app account you are signed into now.</p><button class="btn primary">Connect</button></form>';get('bridge-connect').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{await api('/connect',{code:get('bridge-code').value.trim()});await render(host,embedded)}catch(x){get('bridge-message').textContent=x.message}finally{button.disabled=false}};return}
  box.innerHTML='<p>Connected: <strong>'+esc(s.athlete.athlete_name)+'</strong></p><div class="row"><button class="btn" id="bridge-refresh">Refresh coaching</button><button class="btn ghost" id="bridge-disconnect">Disconnect</button></div><p id="bridge-updated" role="status"></p><div id="bridge-feed"></div>';
  const form=document.createElement('form');form.className='card form';form.innerHTML='<h2>Reflect with your website coach</h2><label for="bridge-focus">Training focus (optional)</label><select id="bridge-focus"><option value="">General reflection</option></select>'+[['rushed','What felt rushed?'],['worked','What worked?'],['retry','What will you try next?']].map(([k,label])=>'<label for="bridge-'+k+'">'+label+'</label><textarea id="bridge-'+k+'" required maxlength="2000"></textarea>').join('')+'<button class="btn primary">Send to coach</button><p id="bridge-sent" role="status"></p>';root().appendChild(form);
  let pending=null;
  form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;const data={phase:'reflection',focusId:get('bridge-focus').value,sessionId:'',eventId:'',rushed:get('bridge-rushed').value.trim(),worked:get('bridge-worked').value.trim(),retry:get('bridge-retry').value.trim(),result:''};if(pending&&JSON.stringify(pending.data)!==JSON.stringify(data)){get('bridge-sent').textContent='An earlier send was not confirmed. Restore those fields and retry, or refresh coaching to check whether it arrived.';button.disabled=false;return}pending=pending||{id:crypto.randomUUID(),data};try{await api('/reflections',pending);pending=null;form.reset();get('bridge-sent').textContent='Saved on the website for your coach.';await refresh()}catch(x){get('bridge-sent').textContent=x.message+' Your text is still here.'}finally{button.disabled=false}};
  async function refresh(){try{const d=await api('/feed');if(!active()||!get('bridge-feed'))return;get('bridge-updated').textContent='Checked '+new Date(d.checkedAt).toLocaleTimeString()+(d.limited?' · Showing the latest 100 records.':'');const focuses=d.records.filter(r=>r.kind==='focus');const select=get('bridge-focus'),chosen=select.value;select.innerHTML='<option value="">General reflection</option>'+focuses.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.data.title)+'</option>').join('');select.value=chosen;
  get('bridge-feed').innerHTML='<h2>Training focus</h2>'+(focuses.length?focuses.map(r=>'<article class="card"><h3>'+esc(r.data.title)+'</h3><p>'+esc(r.data.why)+'</p><p>'+esc(r.data.practice)+'</p><p>Test: '+esc(r.data.test)+'</p></article>').join(''):'<p>No approved focus yet.</p>')+'<h2>Shared coaching notes</h2>'+(d.notes.length?d.notes.map(n=>'<article class="card"><p style="white-space:pre-wrap">'+esc(n.body)+'</p></article>').join(''):'<p>No shared website notes yet.</p>')+'<h2>Your reflections and coach replies</h2>'+d.records.filter(r=>r.kind==='reflection').map(r=>'<article class="card"><p>'+esc(r.data.worked)+'</p><p>Next: '+esc(r.data.retry)+'</p><p>'+esc(r.data.feedback||'Awaiting coach review')+'</p></article>').join('');}catch(x){if(!active()||!get('bridge-updated'))return;get('bridge-updated').textContent=x.message+' Previously displayed information may be out of date.'}}
  get('bridge-refresh').onclick=refresh;get('bridge-disconnect').onclick=async()=>{try{await api('/disconnect',{});await render(host,embedded)}catch(x){get('bridge-message').textContent=x.message}};
  await refresh();const timer=setInterval(()=>{if(!active()||!get('bridge-feed'))return clearInterval(timer);if(!document.hidden)refresh()},30000);
 }
 ctx.views.website=async function(){
  const host=document.createElement('div');root().replaceChildren(host);
  try{await render(host,false)}catch(e){if(host.isConnected)host.textContent='Website coaching unavailable: '+e.message}
 };
 const profile=ctx.views.profile;
 ctx.views.profile=async function(){
  await profile();
  if(!location.hash.startsWith('#/profile'))return;
  const host=document.createElement('section');host.className='stack';host.setAttribute('aria-label','Connected website coaching');
  const card=root().querySelector('.pcard');
  if(card)card.after(host);else root().prepend(host);
  host.innerHTML='<p role="status">Loading connected coaching…</p>';
  try{await render(host,true)}catch(e){if(host.isConnected)host.innerHTML='<p role="status">Website coaching is unavailable. Your app profile is still available.</p><a class="btn" href="#/website">Manage website connection</a>'}
 };
});})();
