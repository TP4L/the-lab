'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {start}=require('./helpers');

test('the offline shell serves local fonts with a compatible content security policy',async t=>{
 const s=await start();t.after(s.close);const anon=s.client();
 const html=await anon.get('/');assert.match(html.headers.get('content-security-policy'),/font-src 'self'/);
 const sw=(await anon.get('/sw.js')).body.toString();
 for(const font of ['manrope','anton','archivo-black']){
  const asset=await anon.get('/fonts/'+font+'.woff');assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/font\/woff/);
  assert.equal(asset.body.subarray(0,4).toString(),'wOFF');assert.ok(sw.includes('/fonts/'+font+'.woff'));
 }
});

test('member dashboard only lists their own published, upcoming invitations without private planning data',async t=>{
 const s=await start();t.after(s.close);
 const coach=s.client();await coach.signup('Coach','owner@lab.test');
 const make=async(name,email)=>{const a=(await coach.post('/api/athletes',{name,claim_email:email})).body;const c=s.client();await c.signup(name,email);await c.post('/api/claim',{code:a.claim_code});return {c,id:a.athlete.id};};
 const one=await make('One','one@lab.test'),two=await make('Two','two@lab.test');
 const future=new Date(Date.now()+864e5).toISOString(),past=new Date(Date.now()-864e5).toISOString();
 const create=async(title,aid,starts_at=future,publish=true)=>{
  const r=await coach.post('/api/plans',{title,starts_at,location:'Court 2',coaches:'Brett',handoff:'PRIVATE COACH HANDOFF',players:[{athlete_id:aid},{name:'Other private guest',email:'guest@lab.test',phone:'555-0100'}]});
  assert.equal(r.status,201);if(publish)assert.equal((await coach.post('/api/plans/'+r.body.id+'/invite')).status,200);return r.body;
 };
 const own=await create('Own lesson',one.id);
 await create('Other lesson',two.id);await create('Draft lesson',one.id,future,false);await create('Ended lesson',one.id,past);
 const declined=await create('Declined lesson',one.id);
 const link=declined.players.find(p=>p.athlete_id===one.id).link;
 assert.equal((await one.c.post('/api/i/'+link.split('/').pop()+'/rsvp',{rsvp:'out'})).status,200);
 const result=await one.c.get('/api/me/lessons');assert.equal(result.status,200);assert.equal(result.body.length,1);
 assert.equal(result.body[0].title,'Own lesson');assert.equal(result.body[0].location,'Court 2');assert.match(result.body[0].link,/^#\/i\//);
 for(const secret of ['PRIVATE COACH','guest@lab.test','555-0100','Other private guest',own.players[1].token])if(secret)assert.ok(!JSON.stringify(result.body).includes(secret));
 assert.equal((await two.c.get('/api/me/lessons')).body[0].title,'Other lesson');
 const noProfile=s.client();await noProfile.signup('Unlinked','unlinked@lab.test');assert.deepEqual((await noProfile.get('/api/me/lessons')).body,[]);
 assert.equal((await s.client().get('/api/me/lessons')).status,401);
});
