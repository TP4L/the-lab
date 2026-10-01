'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {start,staff,uid}=require('./helpers');
test('timeline scopes both history and media, paginates without duplicates and reports a broken website connection',async t=>{
 let fail=false,remoteBodies=[];
 const s=await start({fetchImpl:async(url,o)=>{remoteBodies.push(JSON.parse(o.body));if(fail)throw Error('offline');return Response.json({items:[{id:'website:note:1',source:'website',kind:'note',at:'2026-01-01',title:'Website note',body:'Shared website cue'}],next:null,checkedAt:new Date().toISOString()});}});t.after(s.close);
 const {coach,coach2}=await staff(s),p=s.client();await p.signup('Player','player@lab.test');
 const made=(await coach.post('/api/athletes',{name:'Player'})).body,aid=made.athlete.id;
 await p.post('/api/claim',{code:made.claim_code});
 const self=s.app.db.prepare('SELECT user_id FROM athletes WHERE id=?').get(aid).user_id;
 const coachId=s.app.db.prepare("SELECT id FROM users WHERE email='coach@lab.test'").get().id;
 const stmt=s.app.db.prepare('INSERT INTO notes(athlete_id,author_id,kind,visibility,body,created_at) VALUES(?,?,?,?,?,?)');
 for(let i=0;i<70;i++)stmt.run(aid,coachId,'coach','shared','Shared note '+i,'2026-09-29T12:00:00.000Z');
 stmt.run(aid,coachId,'coach','private','NEVER EXPOSE PRIVATE','2026-09-30');
 await p.post('/api/me/pre-session-checkins',{working:'Resets',not_working:'Rushing',focus:'Transition choices'});
 s.app.db.prepare("INSERT INTO notifications(user_id,kind,title,body,link) VALUES(?,?,?,?,?)").run(self,'training','Plan ready','Open your next session','#/train');
 assert.equal((await coach2.get('/api/timeline?athlete='+aid)).status,404);
 assert.equal((await s.client().get('/api/timeline')).status,401);
 let one=(await p.get('/api/timeline')).body;assert.equal(one.sources.app.items.length,60);assert.equal(one.sources.website.status,'unlinked');assert(!JSON.stringify(one).includes('NEVER EXPOSE'));
 assert(one.sources.app.items.some(x=>x.kind==='checkin'));assert(one.sources.app.items.some(x=>x.kind==='communication'));
 const coachView=(await coach.get('/api/timeline?athlete='+aid)).body;assert(JSON.stringify(coachView).includes('NEVER EXPOSE'));assert(coachView.sources.app.items.some(x=>x.private&&x.status==='Coach only'));
 const two=(await p.get('/api/timeline?source=app&appBefore='+encodeURIComponent(one.sources.app.next))).body.sources.app;assert.equal(two.items.length,12);assert.equal(new Set([...one.sources.app.items,...two.items].map(x=>x.id)).size,72);
 assert.equal((await p.get('/api/timeline?appBefore=garbage')).status,400);
 s.app.db.prepare('INSERT INTO website_connections(user_id,athlete_id,athlete_name,token,connected_at) VALUES(?,?,?,?,?)').run(self,uid(),'Player','a'.repeat(64),new Date().toISOString());
 one=(await p.get('/api/timeline')).body;assert.equal(one.sources.website.status,'ok');assert.equal(one.sources.website.items[0].body,'Shared website cue');assert(!JSON.stringify(one).includes('a'.repeat(64)));assert.equal(remoteBodies.at(-1).action,'timeline');
 fail=true;one=(await p.get('/api/timeline')).body;assert.equal(one.sources.app.status,'ok');assert.equal(one.sources.website.status,'error');assert.equal(one.sources.app.items.length,60);
 assert.equal((await coach2.get('/api/timeline/media?athlete='+aid+'&kind=note&id='+uid())).status,404);
 assert.equal((await p.get('/api/timeline?website='+uid())).status,403);
});

test('timeline UI accepts router arguments, filters and preserves source errors',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),els=new Map(),requests=[];
 function el(k){if(!els.has(k))els.set(k,{value:k==='#history-filter'?'all':'',innerHTML:'',textContent:'',disabled:false});return els.get(k);}
 const root={replaceChildren(h){this.host=h;}},document={getElementById:()=>root,createElement:()=>({isConnected:true,innerHTML:'',querySelector:el,querySelectorAll:()=>[]})};
 const entries=[{id:'app:note:1',source:'app',kind:'note',at:'2026-01-01',title:'Coach cue',body:'<script>bad</script>',status:''},{id:'app:media:2',source:'app',kind:'media',at:'2026-01-02',title:'Clip',media:{id:'clip',mime:'video/mp4'}}];
 const window={LabPlugins:[],Lab:{h:x=>String(x??'').replace(/</g,'&lt;').replace(/"/g,'&quot;'),api:{request:async(m,q)=>{requests.push(q);return {athlete:{name:'Player'},sources:{app:{status:'ok',items:entries,next:null,checkedAt:new Date().toISOString()},website:{status:'error',message:'Reconnect website',items:[],next:null}}};}}}};
 const ctx={routes:[],views:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../web/timeline.js'),'utf8'),{window,document,location:{hash:'#/timeline/website/abc'},URLSearchParams,Intl,Date,Map,Set});window.LabPlugins[0](ctx);
 await ctx.views.playerTimeline('website',{},'abc');assert(requests[0].includes('website=abc'));
 assert.match(el('#history-status').innerHTML,/Reconnect website/);assert.match(el('#history-content').innerHTML,/video controls playsinline preload="none"/);assert(!el('#history-content').innerHTML.includes('<script>'));
 el('#history-filter').value='note';el('#history-filter').onchange();assert.match(el('#history-content').innerHTML,/Coach cue/);assert(!el('#history-content').innerHTML.includes('video controls'));
 el('#history-search').value='nothing matches';el('#history-search').oninput();assert.match(el('#history-content').innerHTML,/No entries/);
});
