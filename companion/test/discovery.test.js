'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {start,uid}=require('./helpers');
async function setup(opts={}){const s=await start(opts),owner=s.client(),a=s.client(),b=s.client(),c=s.client();const ou=(await owner.signup('Owner','owner@lab.test')).body.user;const au=(await a.signup('Alex','alex@lab.test')).body.user;const bu=(await b.signup('Bailey','bailey@lab.test')).body.user;const cu=(await c.signup('Casey','casey@lab.test')).body.user;return {...s,owner,a,b,c,ou,au,bu,cu};}
async function setting(s,extra={}){const d=(await s.owner.get('/api/discovery/owner')).body;return s.owner.put('/api/discovery/owner',{...d.settings,enabled:true,sales_enabled:false,...extra});}
async function join(s,client,user){await s.owner.post('/api/discovery/owner/access',{user_id:user.id,days:30});return client.put('/api/discovery/profile',{display_name:user.name,bio:'Practice together',visible:true});}
const fields=()=>({id:uid(),kind:'drill',place:'Houston Heights',location_type:'area',public_location:true,lat:29.80123456,lng:-95.40123456,starts_at:new Date(Date.now()+3600000).toISOString(),ends_at:new Date(Date.now()+7200000).toISOString(),timezone:'America/Chicago',level_min:3,level_max:4,spots:1,focus:'Resets and drops'});

test('Discovery is owner-only, off by default, private and independent from Essentials',async t=>{
 const s=await setup();t.after(s.close);
 assert.equal((await s.a.get('/api/discovery')).body.enabled,false);
 assert.equal((await s.a.get('/api/discovery/listings')).status,503);
 assert.equal((await s.client().get('/api/discovery/listings')).status,401);
 await s.owner.put('/api/admin/users/'+s.au.id+'/roles',{roles:['athlete','admin']});
 assert.equal((await s.a.get('/api/discovery/owner')).status,403,'another admin is not the owner');
 assert.equal((await s.a.put('/api/discovery/owner',{enabled:true})).status,403);
 assert.equal((await setting(s)).status,200);
 assert.equal((await s.a.get('/api/discovery/listings')).status,402);
 assert.equal((await s.a.post('/api/discovery/listings',fields())).status,402);
 assert.equal((await s.a.post('/api/discovery/checkout')).status,503,'unconfigured prices never create charges');
 assert.equal((await s.owner.get('/api/discovery/listings')).status,200,'owner previews without a pass');
 assert.equal((await s.owner.get('/api/discovery/owner')).body.stats.participants,0,'existing athletes never auto opt in');
});

test('listing requests, capacity, conversations, withdrawals and notifications',async t=>{
 const s=await setup();t.after(s.close);await setting(s);await join(s,s.a,s.au);await join(s,s.b,s.bu);await join(s,s.c,s.cu);
 const made=await s.a.post('/api/discovery/listings',fields());assert.equal(made.status,200,JSON.stringify(made.body));const x=made.body;
 assert.equal(x.lat,29.8);assert.equal(x.lng,-95.4,'exact neighborhood coordinate discarded');
 assert.equal((await s.b.get('/api/discovery/listings?kind=drill&level=3.5')).body.items.length,1);
 assert.equal((await s.b.get('/api/discovery/listings?level=5')).body.items.length,0);
 assert.equal((await s.b.get('/api/discovery/listings?lat=40&lng=-74&radius=5')).body.items.length,0);
 assert.equal((await s.b.post('/api/discovery/listings/'+x.id+'/messages',{id:uid(),body:'Private'})).status,403);
 assert.equal((await s.b.post('/api/discovery/listings/'+x.id+'/request',{message:'Hello'})).body.state,'pending');
 await s.c.post('/api/discovery/listings/'+x.id+'/request',{message:'Also interested'});
 assert.equal((await s.b.put('/api/discovery/listings/'+x.id+'/requests/'+s.bu.id,{state:'accepted'})).status,403);
 const outcomes=await Promise.all([s.a.put('/api/discovery/listings/'+x.id+'/requests/'+s.bu.id,{state:'accepted'}),s.a.put('/api/discovery/listings/'+x.id+'/requests/'+s.cu.id,{state:'accepted'})]);assert.deepEqual(outcomes.map(x=>x.status).sort(),[200,409]);
 const who=outcomes[0].status===200?s.b:s.c,other=who===s.b?s.c:s.b,member=who===s.b?s.bu:s.cu;
 const message={id:uid(),body:'Meet at the public court.'};assert.equal((await who.post('/api/discovery/listings/'+x.id+'/messages',message)).status,200);await who.post('/api/discovery/listings/'+x.id+'/messages',message);
 assert.equal((await s.a.get('/api/discovery/listings/'+x.id)).body.messages.length,1,'idempotent message');
 assert.equal((await other.get('/api/discovery/listings/'+x.id)).body.messages.length,0);
 const view=(await who.get('/api/discovery/listings/'+x.id)).body;assert.equal(view.requests.length,0);assert.equal(JSON.stringify(view).includes('@lab.test'),false);
 assert.ok((await who.get('/api/notifications')).body.items.some(n=>n.kind==='discovery'));
 assert.equal((await who.put('/api/discovery/listings/'+x.id+'/requests/'+member.id,{state:'withdrawn'})).status,200);
 assert.equal((await who.get('/api/discovery/listings/'+x.id)).body.can_chat,false);
 assert.equal((await s.a.put('/api/discovery/listings/'+x.id,{status:'cancelled',version:x.version})).status,200);
 assert.equal((await other.post('/api/discovery/listings/'+x.id+'/request',{})).status,404);
});

test('opt-out, expiry, bilateral blocking and owner reports protect access',async t=>{
 const s=await setup();t.after(s.close);await setting(s);await join(s,s.a,s.au);await join(s,s.b,s.bu);
 const x=(await s.a.post('/api/discovery/listings',fields())).body;
 const report=await s.b.post('/api/discovery/listings/'+x.id+'/report',{reason:'Wrong location'});assert.equal(report.status,200);
 assert.equal((await s.b.get('/api/discovery/owner')).status,403);
 await s.b.post('/api/discovery/blocks',{user_id:s.au.id});assert.equal((await s.b.get('/api/discovery/listings')).body.items.length,0);assert.equal((await s.b.get('/api/discovery/listings/'+x.id)).status,404);
 await s.b.del('/api/discovery/blocks/'+s.au.id);assert.equal((await s.b.get('/api/discovery/listings')).body.items.length,1);
 assert.equal((await s.owner.put('/api/discovery/owner/reports/'+report.body.id,{action:'remove'})).status,200);
 assert.equal((await s.a.put('/api/discovery/listings/'+x.id,{version:x.version+1,status:'open'})).status,403);
 const y=(await s.a.post('/api/discovery/listings',fields())).body;
 await s.a.put('/api/discovery/profile',{display_name:'Alex',bio:'',visible:false});
 assert.equal((await s.b.get('/api/discovery/listings')).body.items.length,0);
 assert.equal(s.app.db.prepare('SELECT status FROM discovery_listings WHERE id=?').get(y.id).status,'cancelled');
 await s.owner.post('/api/discovery/owner/access',{user_id:s.bu.id,days:0});assert.equal((await s.b.get('/api/discovery/listings/'+y.id)).status,402);
 assert.equal((await s.b.get('/api/discovery/blocks')).status,200,'privacy controls survive expiration');
});

test('pauses freeze pass time; stale changes and unavailable payment setup are rejected',async t=>{
 const s=await setup();t.after(s.close);await setting(s);await join(s,s.a,s.au);
 assert.equal((await setting(s,{sales_enabled:true,amount:500})).status,400);
 await setting(s,{enabled:false});const at=s.app.db.prepare('SELECT paused_at FROM discovery_settings').get().paused_at;
 const before=(await s.a.get('/api/discovery')).body.remaining_days;
 s.app.db.prepare('UPDATE discovery_settings SET paused_at=?,paused_ms=paused_ms-?').run(at-2*864e5,2*864e5);
 const after=(await s.a.get('/api/discovery')).body.remaining_days;assert.ok(Math.abs(before-after)<0.00001);
 assert.equal((await s.a.get('/api/discovery/listings')).status,503);await setting(s);
 assert.ok(Math.abs((await s.a.get('/api/discovery')).body.remaining_days-before)<0.00001);
 assert.equal((await s.owner.put('/api/discovery/owner',{version:1,enabled:false,sales_enabled:false,days:30})).status,409);
});

test('validated listings, editing, geocoding cache, no duplicate posting',async t=>{
 let calls=0;const s=await setup({fetchImpl:async()=>{calls++;return {ok:true,json:async()=>[{display_name:'Heights, Houston, Texas',lat:'29.8',lon:'-95.4'}]};}});t.after(s.close);await setting(s);await join(s,s.a,s.au);
 const f=fields();assert.equal((await s.a.post('/api/discovery/listings',{...f,public_location:false})).status,400);
 assert.equal((await s.a.post('/api/discovery/listings',{...f,ends_at:f.starts_at})).status,400);
 const x=(await s.a.post('/api/discovery/listings',f)).body;await s.a.post('/api/discovery/listings',f);assert.equal((await s.a.get('/api/discovery/listings')).body.items.length,1);
 assert.equal((await s.a.put('/api/discovery/listings/'+x.id,{...f,version:x.version,status:'open',edit:true,focus:'Updated'})).status,200);
 assert.equal((await s.a.put('/api/discovery/listings/'+x.id,{version:x.version,status:'paused'})).status,409);
 assert.equal((await s.a.get('/api/discovery/places?q=Houston')).body.length,1);assert.equal((await s.a.get('/api/discovery/places?q=Houston')).body.length,1);assert.equal(calls,1);
 assert.equal((await s.a.get('/api/discovery/places?q=Dallas')).status,429);
});

test('Discovery fulfillment is signed, exact, idempotent, and isolated from Essentials',async t=>{
 let creates=0,sessionArgs;const stripe={checkout:{sessions:{create:async d=>{creates++;sessionArgs=d;return {id:'cs_disc',url:'https://checkout.stripe.com/test'};},expire:async()=>({}),list:async()=>({data:[]})}},webhooks:{constructEvent:(raw,sig)=>{if(sig!=='valid')throw Error();return JSON.parse(raw);}}};
 const s=await setup({stripeClient:stripe,stripeWebhookSecret:'whsec_test',publicUrl:'https://lab.test'});t.after(s.close);await setting(s,{amount:500,days:30,sales_enabled:true});
 assert.equal((await s.a.get('/api/discovery')).body.active,false);
 const cs=await Promise.all([s.a.post('/api/discovery/checkout'),s.a.post('/api/discovery/checkout')]);assert.equal(cs[0].status,200);assert.equal(creates,1);assert.equal(sessionArgs.mode,'payment');assert.equal(sessionArgs.payment_method_types,undefined);assert.equal(sessionArgs.line_items[0].price_data.unit_amount,500);
 const pay={id:'evt1',type:'checkout.session.completed',data:{object:{id:'cs_disc',mode:'payment',currency:'usd',amount_total:500,payment_status:'unpaid',payment_intent:'pi_disc'}}};
 const send=(event,sig='valid')=>s.a.call('POST','/api/billing/webhook',JSON.stringify(event),{'Stripe-Signature':sig});
 assert.equal((await send(pay,'invalid')).status,400);assert.equal((await send(pay)).status,200);assert.equal((await s.a.get('/api/discovery')).body.active,false);
 pay.id='evt2';pay.type='checkout.session.async_payment_succeeded';pay.data.object.payment_status='paid';
 const deliveries=await Promise.all([send(pay),send(pay)]);assert.deepEqual(deliveries.map(x=>x.status),[200,200]);assert.equal((await s.a.get('/api/discovery')).body.active,true);assert.equal((await s.a.get('/api/membership')).body.active,false);
 const remaining=(await s.a.get('/api/discovery')).body.remaining_days;pay.id='evt3';pay.type='checkout.session.completed';await send(pay);assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM discovery_passes').get().n,1);assert.ok(remaining<=30&&remaining>29.99);
 await s.owner.post('/api/discovery/owner/access',{user_id:s.au.id,days:5});
 await send({id:'evt4',type:'charge.refunded',data:{object:{payment_intent:'pi_disc',refunded:true}}});assert.ok((await s.a.get('/api/discovery')).body.remaining_days<=5.001,'refund removes paid time without stretching a later complimentary pass');await s.owner.post('/api/discovery/owner/access',{user_id:s.au.id,days:0});
 pay.id='evt5';await send(pay);assert.equal((await s.a.get('/api/discovery')).body.active,false,'late success never undoes a refund');
});
