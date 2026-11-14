'use strict';
const { randomUUID, randomBytes } = require('node:crypto');
const { HttpError, str, int, num, oneOf, isoTime, uuid } = require('../http');
const { tx, now } = require('../db');
const { limiter } = require('../auth');
const DAY = 86400000;

module.exports = function discovery(r, ctx) {
  const {db,auth,config,notifier} = ctx;
  const ownerEmail = (config.discoveryOwnerEmail || config.adminEmail || '').trim().toLowerCase();
  const owner = u => !!u && u.roles.includes('admin') && u.email.toLowerCase() === ownerEmail;
  const requireOwner = u => { auth.require(u); if (!owner(u)) throw new HttpError(403,'Only the owner can manage Discovery.'); };
  const settings = () => db.prepare('SELECT * FROM discovery_settings WHERE id=1').get();
  // Passes run on an active-service clock. Pauses freeze every pass, including purchases settling during a pause.
  const clock = (s=settings()) => (s.enabled ? Date.now() : s.paused_at) - s.paused_ms;
  const pass = (id,s=settings()) => db.prepare('SELECT MAX(ends_clock) until FROM discovery_passes WHERE user_id=? AND revoked=0 AND ends_clock>?').get(id,clock(s)).until;
  const access = u => { auth.require(u); if (owner(u)) return; const s=settings(); if(!s.enabled) throw new HttpError(503,'Discovery is paused. Your remaining access time is protected.'); if(!pass(u.id,s)) throw new HttpError(402,'A Discovery pass is required.'); };
  const profile = id => db.prepare('SELECT user_id,display_name,bio,visible FROM discovery_profiles WHERE user_id=?').get(id);
  const participating = u => { access(u); const p=profile(u.id); if(!p?.visible) throw new HttpError(403,'Set up your Discovery profile and opt in first.'); return p; };
  const blocked = (a,b) => !!db.prepare('SELECT 1 FROM discovery_blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)').get(a,b,b,a);
  const audit = (u,action,detail) => db.prepare('INSERT INTO discovery_audit(actor,action,detail,created_at) VALUES(?,?,?,?)').run(u.id,action,JSON.stringify(detail),now());
  const writeLimit=limiter(40,60000), searchLimit=limiter(10,60000);
  const limit = u => { if(!writeLimit(u.id)) throw new HttpError(429,'Please wait a moment before trying again.'); };
  const notify = (ids,title,body,id) => notifier.notify(ids,'discovery',title,body,'#/discovery/session/'+id);
  const listing = id => { const x=db.prepare('SELECT * FROM discovery_listings WHERE id=?').get(id); if(!x) throw new HttpError(404,'Session not found.'); return x; };
  const live = x => x.status==='open' && x.ends_at>now();
  const hostAvailable = x => profile(x.host_id)?.visible && (pass(x.host_id) || db.prepare('SELECT 1 FROM users WHERE id=? AND lower(email)=?').get(x.host_id,ownerEmail));
  function visible(u,x) { access(u); if(owner(u)||x.host_id===u.id)return; const req=db.prepare('SELECT state FROM discovery_requests WHERE listing_id=? AND user_id=?').get(x.id,u.id); if(blocked(u.id,x.host_id)||!hostAvailable(x)||(x.status!=='open'&&req?.state!=='accepted')) throw new HttpError(404,'Session is not available.'); }
  const count = id => db.prepare("SELECT COUNT(*) n FROM discovery_requests WHERE listing_id=? AND state='accepted'").get(id).n;
  const ids = id => db.prepare("SELECT user_id FROM discovery_requests WHERE listing_id=? AND state IN ('accepted','pending')").all(id).map(x=>x.user_id);
  function serialize(x,u) {
    const p=profile(x.host_id), accepted=count(x.id), mine=db.prepare('SELECT state FROM discovery_requests WHERE listing_id=? AND user_id=?').get(x.id,u.id);
    return {...x,host_name:p?.display_name||'Member',host_bio:p?.bio||'',accepted,remaining:Math.max(0,x.spots-accepted),mine:x.host_id===u.id,my_state:mine?.state||null,expired:x.ends_at<=now()};
  }
  const stripe = ctx.stripeClient || (config.stripeKey ? new (require('stripe'))(config.stripeKey,{apiVersion:'2026-10-28.endive'}) : null);
  const billingReady=!!(stripe&&config.stripeWebhookSecret&&config.publicUrl.startsWith('https://'));
  function state(u) {
    const s=settings(), end=u&&pass(u.id,s);
    return {owner:owner(u),enabled:!!s.enabled,active:owner(u)||!!end,remaining_days:end?Math.max(0,(end-clock(s))/DAY):0,
      expires_at:end&&s.enabled?new Date(Date.now()+end-clock(s)).toISOString():null,amount:s.amount,days:s.days,
      checkout_enabled:!!(s.enabled&&s.sales_enabled&&s.amount&&billingReady),profile:u?profile(u.id)||null:null};
  }
  r.get('/api/discovery',({user})=>{auth.require(user);return state(user);});
  r.put('/api/discovery/profile',({user,body})=>{
    auth.require(user);limit(user);
    if(typeof body.visible!=='boolean')throw new HttpError(400,'Choose whether to join Discovery.');
    if(body.visible)access(user);
    const name=str(body.display_name,'Display name',{required:true,max:60}),bio=str(body.bio,'About you',{max:300});
    const cancelled=[];
    tx(db,()=>{
      db.prepare('INSERT INTO discovery_profiles(user_id,display_name,bio,visible,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,bio=excluded.bio,visible=excluded.visible,updated_at=excluded.updated_at').run(user.id,name,bio,+body.visible,now());
      if(!body.visible){for(const x of db.prepare("SELECT id FROM discovery_listings WHERE host_id=? AND status IN ('open','paused') AND ends_at>?").all(user.id,now()))cancelled.push({id:x.id,users:ids(x.id)});db.prepare("UPDATE discovery_listings SET status='cancelled',version=version+1 WHERE host_id=? AND status IN ('open','paused')").run(user.id);db.prepare("UPDATE discovery_requests SET state='withdrawn',updated_at=? WHERE user_id=? AND state IN ('pending','accepted')").run(now(),user.id);}
    });
    cancelled.forEach(x=>notify(x.users,'Session canceled','The host has left Discovery.',x.id));
    return state(user);
  });
  r.get('/api/discovery/listings',({user,query})=>{
    access(user);const s=settings();
    const kind=query.get('kind');if(kind)oneOf(kind,['drill','play','either'],'Activity');
    const level=query.has('level')?num(query.get('level'),'Level',{min:2,max:7}):null;
    const scope=query.get('scope')||'nearby';oneOf(scope,['nearby','mine'],'View');
    const lat=query.has('lat')?num(query.get('lat'),'Latitude',{min:-85,max:85}):29.7604;
    const lng=query.has('lng')?num(query.get('lng'),'Longitude',{min:-180,max:180}):-95.3698;
    const radius=query.has('radius')?num(query.get('radius'),'Distance',{min:1,max:7000}):25;
    const end=query.has('before')?isoTime(query.get('before'),'Date',{allowEmpty:false}):null;
    let rows=db.prepare(`SELECT l.* FROM discovery_listings l JOIN discovery_profiles p ON p.user_id=l.host_id
      WHERE ${scope==='mine'?"(l.host_id=? OR EXISTS (SELECT 1 FROM discovery_requests q WHERE q.listing_id=l.id AND q.user_id=? AND q.state IN ('pending','accepted')))":"l.status='open' AND l.ends_at>? AND p.visible=1"} ORDER BY l.starts_at DESC LIMIT 1000`).all(...(scope==='mine'?[user.id,user.id]:[now()]));
    rows=rows.filter(x=>(scope==='mine'||hostAvailable(x))&&!blocked(user.id,x.host_id)&&(!kind||x.kind===kind||x.kind==='either')&&(level===null||x.level_min===null||level>=x.level_min&&level<=x.level_max)&&(!end||x.starts_at<end));
    const rad=x=>x*Math.PI/180;
    rows=rows.map(x=>{const a=Math.sin(rad(x.lat-lat)/2)**2+Math.cos(rad(lat))*Math.cos(rad(x.lat))*Math.sin(rad(x.lng-lng)/2)**2;return {...serialize(x,user),distance_miles:Math.round(3958.8*2*Math.asin(Math.min(1,Math.sqrt(a)))*10)/10};});
    if(scope!=='mine')rows=rows.filter(x=>x.distance_miles<=radius).sort((a,b)=>a.distance_miles-b.distance_miles||a.starts_at.localeCompare(b.starts_at));
    return {items:rows.slice(0,200),truncated:rows.length>200,enabled:!!s.enabled};
  });
  function listingFields(body) {
    const kind=oneOf(body.kind,['drill','play','either'],'Activity'),place=str(body.place,'Neighborhood or public court',{required:true,max:160});
    const location_type=oneOf(body.location_type,['area','court'],'Location type');
    if(body.public_location!==true)throw new HttpError(400,'Confirm this is a neighborhood or public court, not a home address.');
    const digits=location_type==='area'?2:5;
    const lat=Number(num(body.lat,'Latitude',{min:18,max:72}).toFixed(digits)),lng=Number(num(body.lng,'Longitude',{min:-180,max:-65}).toFixed(digits));
    const starts_at=isoTime(body.starts_at,'Start time',{allowEmpty:false}),ends_at=isoTime(body.ends_at,'End time',{allowEmpty:false});
    if(new Date(starts_at)<Date.now()-5*60000||new Date(starts_at)>Date.now()+180*DAY||new Date(ends_at)<=Date.now()||new Date(ends_at)-new Date(starts_at)<15*60000||new Date(ends_at)-new Date(starts_at)>12*3600000)throw new HttpError(400,'Choose a future session between 15 minutes and 12 hours, within 180 days.');
    const timezone=str(body.timezone,'Time zone',{required:true,max:60});try{new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format();}catch{throw new HttpError(400,'Choose a valid time zone.');}
    const level_min=body.level_min===''||body.level_min==null?null:num(body.level_min,'Minimum level',{min:2,max:7});
    const level_max=level_min===null?null:num(body.level_max,'Maximum level',{min:level_min,max:7});
    return {kind,place,location_type,lat,lng,starts_at,ends_at,timezone,level_min,level_max,spots:int(body.spots,'Open spots',{min:1,max:16,required:true}),focus:str(body.focus,'Practice focus',{max:1000})};
  }
  r.post('/api/discovery/listings',({user,body})=>{
    participating(user);limit(user);const id=uuid(body.id,'Listing ID'),f=listingFields(body);
    const old=db.prepare('SELECT * FROM discovery_listings WHERE id=?').get(id);if(old){if(old.host_id!==user.id)throw new HttpError(409,'Listing ID is already in use.');return serialize(old,user);}
    if(db.prepare("SELECT COUNT(*) n FROM discovery_listings WHERE host_id=? AND status IN ('open','paused') AND ends_at>?").get(user.id,now()).n>=10)throw new HttpError(400,'You can have up to 10 upcoming listings.');
    db.prepare(`INSERT INTO discovery_listings(id,host_id,${Object.keys(f).join(',')},created_at) VALUES(${Array(Object.keys(f).length+3).fill('?').join(',')})`).run(id,user.id,...Object.values(f),now());
    return serialize(listing(id),user);
  });
  r.get('/api/discovery/listings/:id',({user,params})=>{
    const x=listing(params.id);visible(user,x);const out=serialize(x,user);
    const host=x.host_id===user.id;
    out.requests=host?db.prepare('SELECT q.user_id,q.state,q.message,q.updated_at,p.display_name FROM discovery_requests q LEFT JOIN discovery_profiles p ON p.user_id=q.user_id WHERE q.listing_id=? ORDER BY q.updated_at').all(x.id):[];
    out.can_chat=live(x)&&(host||out.my_state==='accepted');
    out.messages=out.can_chat?db.prepare('SELECT m.id,m.user_id,m.body,m.created_at,p.display_name FROM discovery_messages m LEFT JOIN discovery_profiles p ON p.user_id=m.user_id WHERE m.listing_id=? ORDER BY m.created_at DESC LIMIT 100').all(x.id).filter(m=>!m.user_id||!blocked(user.id,m.user_id)).reverse():[];
    return out;
  });
  r.put('/api/discovery/listings/:id',({user,params,body})=>{
    auth.require(user);limit(user);const x=listing(params.id);if(x.host_id!==user.id)throw new HttpError(403,'Only the host can change this session.');
    if(x.status==='removed')throw new HttpError(403,'This session was removed by the owner.');
    if(int(body.version,'Version',{required:true})!==x.version)throw new HttpError(409,'This session changed. Refresh before saving.');
    const status=oneOf(body.status,['open','paused','cancelled'],'Status');if(status!=='cancelled')participating(user);
    if(x.status==='cancelled'&&status!=='cancelled')throw new HttpError(400,'Create a new session after canceling.');
    if(body.edit){const f=listingFields(body);if(f.spots<count(x.id))throw new HttpError(400,'Open spots cannot be fewer than accepted players.');db.prepare(`UPDATE discovery_listings SET ${Object.keys(f).map(k=>k+'=?').join(',')},status=?,version=version+1 WHERE id=?`).run(...Object.values(f),status,x.id);}else db.prepare('UPDATE discovery_listings SET status=?,version=version+1 WHERE id=?').run(status,x.id);
    if(status!==x.status||body.edit)notify(ids(x.id),status==='cancelled'?'Session canceled':'Session updated',status==='cancelled'?'The host canceled this session.':'Check the latest session details.',x.id);
    return serialize(listing(x.id),user);
  });
  r.post('/api/discovery/listings/:id/request',({user,params,body})=>{
    const p=participating(user);limit(user);const x=listing(params.id);visible(user,x);
    if(x.host_id===user.id||!live(x))throw new HttpError(400,'You cannot request this session.');
    const old=db.prepare('SELECT state FROM discovery_requests WHERE listing_id=? AND user_id=?').get(x.id,user.id);
    if(old&&['pending','accepted'].includes(old.state))return {state:old.state};
    if(count(x.id)>=x.spots)throw new HttpError(409,'This session is full.');
    const message=str(body.message,'Message',{max:500});
    db.prepare("INSERT INTO discovery_requests(listing_id,user_id,state,message,updated_at) VALUES(?,?,'pending',?,?) ON CONFLICT(listing_id,user_id) DO UPDATE SET state='pending',message=excluded.message,updated_at=excluded.updated_at").run(x.id,user.id,message,now());
    notify([x.host_id],'New Discovery request',p.display_name+' requested a spot.',x.id);return {state:'pending'};
  });
  r.put('/api/discovery/listings/:id/requests/:user',({user,params,body})=>{
    auth.require(user);limit(user);const x=listing(params.id),target=int(params.user,'Member',{min:1,required:true});
    const state=oneOf(body.state,['accepted','declined','withdrawn'],'Response');
    if(state==='withdrawn'){if(target!==user.id)throw new HttpError(403,'You can only withdraw your own request.');}
    else {participating(user);if(x.host_id!==user.id)throw new HttpError(403,'Only the host can respond.');if(!live(x))throw new HttpError(400,'This session has ended or is closed.');}
    const changed=tx(db,()=>{
      const q=db.prepare('SELECT state FROM discovery_requests WHERE listing_id=? AND user_id=?').get(x.id,target);if(!q)throw new HttpError(404,'Request not found.');if(q.state===state)return false;
      if(state==='accepted'){if(q.state!=='pending')throw new HttpError(400,'Only pending requests can be accepted.');if(blocked(user.id,target)||!profile(target)?.visible||!pass(target)&&!db.prepare('SELECT 1 FROM users WHERE id=? AND lower(email)=?').get(target,ownerEmail))throw new HttpError(400,'This member is no longer available.');if(count(x.id)>=x.spots)throw new HttpError(409,'The last spot has already been filled.');}
      db.prepare('UPDATE discovery_requests SET state=?,updated_at=? WHERE listing_id=? AND user_id=?').run(state,now(),x.id,target);return true;
    });
    if(changed)notify([state==='withdrawn'?x.host_id:target],state==='accepted'?'Your spot is confirmed':state==='declined'?'Discovery request updated':'Player withdrew',state==='accepted'?'Open your session to coordinate with the host.':state==='declined'?'The host could not include you in this session.':'A player withdrew from this session.',x.id);
    return {state};
  });
  r.post('/api/discovery/listings/:id/messages',({user,params,body})=>{
    participating(user);limit(user);const x=listing(params.id);visible(user,x);
    if(!live(x)||x.host_id!==user.id&&!db.prepare("SELECT 1 FROM discovery_requests WHERE listing_id=? AND user_id=? AND state='accepted'").get(x.id,user.id))throw new HttpError(403,'Only the host and accepted players can use this session conversation.');
    const id=uuid(body.id,'Message ID'),message=str(body.body,'Message',{required:true,max:1500});
    const old=db.prepare('SELECT * FROM discovery_messages WHERE id=?').get(id);if(old){if(old.user_id!==user.id||old.listing_id!==x.id||old.body!==message)throw new HttpError(409,'Message ID is already in use.');return {id};}
    db.prepare('INSERT INTO discovery_messages(id,listing_id,user_id,body,created_at) VALUES(?,?,?,?,?)').run(id,x.id,user.id,message,now());
    const targets=[x.host_id,...db.prepare("SELECT user_id FROM discovery_requests WHERE listing_id=? AND state='accepted'").all(x.id).map(q=>q.user_id)].filter(id=>id!==user.id&&!blocked(id,user.id));
    notify(targets,'New session message','Open Discovery to read your session conversation.',x.id);return {id};
  });
  r.post('/api/discovery/listings/:id/report',({user,params,body})=>{
    access(user);limit(user);const x=listing(params.id);visible(user,x);const reason=str(body.reason,'Reason',{required:true,max:1000});
    const old=db.prepare("SELECT id FROM discovery_reports WHERE listing_id=? AND reporter=? AND status='open'").get(x.id,user.id);if(old)return old;
    const id=randomUUID();db.prepare('INSERT INTO discovery_reports(id,listing_id,reporter,reason,created_at) VALUES(?,?,?,?,?)').run(id,x.id,user.id,reason,now());const ownerUser=db.prepare('SELECT id FROM users WHERE lower(email)=?').get(ownerEmail);if(ownerUser)notifier.notify([ownerUser.id],'discovery','Discovery report received','A listing needs your review.','#/discovery/owner');return {id};
  });
  r.get('/api/discovery/blocks',({user})=>{auth.require(user);return db.prepare('SELECT b.blocked user_id,p.display_name FROM discovery_blocks b LEFT JOIN discovery_profiles p ON p.user_id=b.blocked WHERE b.blocker=?').all(user.id);});
  r.post('/api/discovery/blocks',({user,body})=>{
    auth.require(user);limit(user);const id=int(body.user_id,'Member',{min:1,required:true});if(id===user.id||!profile(id))throw new HttpError(400,'Choose another Discovery member.');
    tx(db,()=>{db.prepare('INSERT OR IGNORE INTO discovery_blocks(blocker,blocked) VALUES(?,?)').run(user.id,id);db.prepare("UPDATE discovery_requests SET state='withdrawn',updated_at=? WHERE (user_id=? AND listing_id IN (SELECT id FROM discovery_listings WHERE host_id=?)) OR (user_id=? AND listing_id IN (SELECT id FROM discovery_listings WHERE host_id=?))").run(now(),user.id,id,id,user.id);});return {blocked:true};
  });
  r.del('/api/discovery/blocks/:id',({user,params})=>{auth.require(user);db.prepare('DELETE FROM discovery_blocks WHERE blocker=? AND blocked=?').run(user.id,int(params.id,'Member',{min:1}));return {blocked:false};});

  let lastGeocode=0;
  r.get('/api/discovery/places',async({user,query})=>{
    access(user);const q=str(query.get('q'),'Search',{required:true,max:120}).toLowerCase();
    if(q.length<3)throw new HttpError(400,'Enter a city, neighborhood or public court.');
    const cached=db.prepare('SELECT result FROM discovery_geocache WHERE query=? AND created_at>?').get(q,Date.now()-30*DAY);if(cached)return JSON.parse(cached.result);
    if(!searchLimit(user.id)||Date.now()-lastGeocode<1100)throw new HttpError(429,'Please wait a moment and search again.');lastGeocode=Date.now();
    const url=new URL(config.discoveryGeocoder);url.search=new URLSearchParams({q,format:'jsonv2',countrycodes:'us',limit:'5'}).toString();
    let results;
    try{const res=await config.fetchImpl(url,{headers:{'User-Agent':'THE-LAB-Discovery/1.0 ('+config.publicUrl+')','Accept':'application/json'},signal:AbortSignal.timeout(7000),redirect:'error'});if(!res.ok)throw Error();const raw=await res.json();if(!Array.isArray(raw))throw Error();results=raw.slice(0,5).filter(x=>Number.isFinite(Number(x.lat))&&Number.isFinite(Number(x.lon))).map(x=>({name:String(x.display_name).slice(0,250),lat:Number(x.lat),lng:Number(x.lon)}));}catch{throw new HttpError(503,'Location search is unavailable. You can still choose a pin on the map.');}
    db.prepare('DELETE FROM discovery_geocache WHERE created_at<?').run(Date.now()-30*DAY);
    db.prepare('INSERT OR REPLACE INTO discovery_geocache(query,result,created_at) VALUES(?,?,?)').run(q,JSON.stringify(results),Date.now());return results;
  });
  r.get('/api/discovery/map',({user})=>{access(user);return {tiles:config.discoveryTileUrl,attribution:config.discoveryTileAttribution};});

  r.get('/api/discovery/owner',({user})=>{
    requireOwner(user);const s=settings();return {settings:s,billing_ready:billingReady,
      members:db.prepare('SELECT u.id,u.name,u.email,p.visible,p.display_name FROM users u LEFT JOIN discovery_profiles p ON p.user_id=u.id ORDER BY u.name LIMIT 500').all().map(u=>({...u,remaining_days:Math.max(0,((pass(u.id,s)||clock(s))-clock(s))/DAY)})),
      reports:db.prepare("SELECT r.*,l.place,l.focus,p.display_name FROM discovery_reports r JOIN discovery_listings l ON l.id=r.listing_id LEFT JOIN discovery_profiles p ON p.user_id=r.reporter WHERE r.status='open' ORDER BY r.created_at DESC LIMIT 100").all(),
      stats:{listings:db.prepare("SELECT COUNT(*) n FROM discovery_listings WHERE status='open' AND ends_at>?").get(now()).n,participants:db.prepare('SELECT COUNT(*) n FROM discovery_profiles WHERE visible=1').get().n,paid_passes:db.prepare("SELECT COUNT(*) n FROM discovery_passes WHERE source='stripe' AND revoked=0").get().n,confirmed:db.prepare("SELECT COUNT(*) n FROM discovery_requests WHERE state='accepted'").get().n}};
  });
  r.put('/api/discovery/owner',async({user,body})=>{
    requireOwner(user);const s=settings();if(body.version!==s.version)throw new HttpError(409,'Discovery settings changed. Refresh and try again.');
    if(typeof body.enabled!=='boolean'||typeof body.sales_enabled!=='boolean')throw new HttpError(400,'Choose availability and purchase settings.');
    const amount=body.amount===null||body.amount===''?null:int(body.amount,'Price in cents',{min:50,max:100000,required:true}),days=int(body.days,'Access days',{min:1,max:365,required:true});
    if(body.sales_enabled&&(!billingReady||!amount||!body.enabled))throw new HttpError(400,'Set a price, connect billing, and enable Discovery before opening purchases.');
    tx(db,()=>{const t=Date.now(),paused_ms=s.paused_ms+(!s.enabled&&body.enabled?t-s.paused_at:0),paused_at=s.enabled&&!body.enabled?t:s.paused_at;db.prepare('UPDATE discovery_settings SET enabled=?,paused_at=?,paused_ms=?,amount=?,days=?,sales_enabled=?,version=version+1 WHERE id=1').run(+body.enabled,paused_at,paused_ms,amount,days,body.enabled?+body.sales_enabled:0);audit(user,'settings',{enabled:body.enabled,amount,days,sales_enabled:body.enabled&&body.sales_enabled});});
    // Close already-created checkouts when pausing. A payment already settling still receives its full frozen pass.
    let pending_checkouts=0;
    if(!body.enabled||!body.sales_enabled){for(const order of db.prepare("SELECT id,session_id FROM discovery_orders WHERE status='pending' AND session_id IS NOT NULL").all()){try{await stripe.checkout.sessions.expire(order.session_id);db.prepare("UPDATE discovery_orders SET status='expired' WHERE id=? AND status='pending'").run(order.id);}catch{pending_checkouts++;}}}
    return {...state(user),pending_checkouts};
  });
  r.post('/api/discovery/owner/access',({user,body})=>{
    requireOwner(user);const target=int(body.user_id,'Member',{min:1,required:true});if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(target))throw new HttpError(404,'Member not found.');
    const days=int(body.days,'Days',{min:0,max:365,required:true});tx(db,()=>{if(!days)db.prepare('UPDATE discovery_passes SET revoked=1 WHERE user_id=?').run(target);else{const start=Math.max(clock(),pass(target)||0);db.prepare('INSERT INTO discovery_passes(id,user_id,starts_clock,ends_clock,source,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),target,start,start+days*DAY,'complimentary',now());}audit(user,'access',{user_id:target,days});});return {saved:true};
  });
  r.put('/api/discovery/owner/reports/:id',({user,params,body})=>{
    requireOwner(user);const report=db.prepare('SELECT * FROM discovery_reports WHERE id=?').get(params.id);if(!report)throw new HttpError(404,'Report not found.');const action=oneOf(body.action,['dismiss','remove'],'Action');
    tx(db,()=>{db.prepare('UPDATE discovery_reports SET status=? WHERE id=?').run(action,report.id);if(action==='remove')db.prepare("UPDATE discovery_listings SET status='removed',version=version+1 WHERE id=?").run(report.listing_id);audit(user,'report',{id:report.id,action});});
    if(action==='remove')notify([listing(report.listing_id).host_id,...ids(report.listing_id)],'Session removed','The owner removed this Discovery session.',report.listing_id);return {saved:true};
  });

  const checkouts=new Map();
  r.post('/api/discovery/checkout',async({user})=>{
    auth.require(user);limit(user);const s=settings();if(!state(user).checkout_enabled)throw new HttpError(503,'Discovery purchases are not open yet.');
    if(owner(user)||pass(user.id))throw new HttpError(409,'Your Discovery access is already active.');
    if(checkouts.has(user.id))return checkouts.get(user.id);
    const create=async()=>{
      const pending=db.prepare("SELECT * FROM discovery_orders WHERE user_id=? AND status='pending' AND checkout_url IS NOT NULL AND created_at>? ORDER BY created_at DESC LIMIT 1").get(user.id,new Date(Date.now()-25*60000).toISOString());
      if(pending&&pending.amount===s.amount&&pending.days===s.days)return {url:pending.checkout_url};
      const id=randomUUID();db.prepare('INSERT INTO discovery_orders(id,user_id,amount,days,created_at) VALUES(?,?,?,?,?)').run(id,user.id,s.amount,s.days,now());
      try{
        const session=await stripe.checkout.sessions.create({mode:'payment',customer_email:user.email,client_reference_id:'discovery:'+id,
          line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:s.amount,product_data:{name:'THE LAB Discovery',description:s.days+' days of access. No automatic renewal. Access time pauses when Discovery is unavailable.'}}}],
          success_url:config.publicUrl+'/#/discovery?checkout=success',cancel_url:config.publicUrl+'/#/discovery?checkout=cancelled',
          expires_at:Math.floor(Date.now()/1000)+1800,integration_identifier:'the_lab_discovery_'+Array.from(randomBytes(8),b=>String.fromCharCode(97+b%26)).join('')},{idempotencyKey:'discovery-order-'+id});
        db.prepare('UPDATE discovery_orders SET session_id=?,checkout_url=? WHERE id=?').run(session.id,session.url,id);
        if(!state(user).checkout_enabled){try{await stripe.checkout.sessions.expire(session.id);}catch{}throw new HttpError(409,'Discovery purchases were paused. No access time will be lost if payment is already processing.');}
        return {url:session.url};
      }catch(e){db.prepare("UPDATE discovery_orders SET status='failed' WHERE id=? AND session_id IS NULL").run(id);if(e instanceof HttpError)throw e;throw new HttpError(503,'Checkout could not open. Please try again.');}
    };
    const p=create();checkouts.set(user.id,p);try{return await p;}finally{checkouts.delete(user.id);}
  });
  ctx.discovery={async webhook(event){
    const o=event.data.object||{};
    if(event.type.startsWith('checkout.session.')){
      const order=db.prepare('SELECT * FROM discovery_orders WHERE session_id=?').get(o.id||'');
      if(!order){if(String(o.client_reference_id||'').startsWith('discovery:'))throw new HttpError(503,'Checkout is still being recorded. Retry this event.');return false;}
      if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&o.payment_status==='paid'){
        if(o.amount_total!==order.amount||o.currency!=='usd'||o.mode!=='payment')throw new HttpError(400,'Discovery payment does not match the order.');
        if(!order.fulfilled_at&&order.status!=='revoked'&&order.user_id)tx(db,()=>{const start=Math.max(clock(),pass(order.user_id)||0),id=randomUUID();db.prepare('INSERT INTO discovery_passes(id,user_id,starts_clock,ends_clock,source,created_at) VALUES(?,?,?,?,?,?)').run(id,order.user_id,start,start+order.days*DAY,'stripe',now());db.prepare("UPDATE discovery_orders SET status='paid',payment_intent=?,fulfilled_at=?,pass_id=? WHERE id=?").run(typeof o.payment_intent==='string'?o.payment_intent:o.payment_intent?.id||null,now(),id,order.id);});
      }else if(['checkout.session.async_payment_failed','checkout.session.expired'].includes(event.type))db.prepare("UPDATE discovery_orders SET status=? WHERE id=? AND fulfilled_at IS NULL AND status<>'revoked'").run(event.type.endsWith('expired')?'expired':'failed',order.id);
      return true;
    }
    if(['charge.refunded','charge.dispute.created','radar.early_fraud_warning.created'].includes(event.type)){
      let intent=typeof o.payment_intent==='string'?o.payment_intent:o.payment_intent?.id;
      if(!intent&&o.charge&&stripe){const ch=await stripe.charges.retrieve(typeof o.charge==='string'?o.charge:o.charge.id);intent=typeof ch.payment_intent==='string'?ch.payment_intent:ch.payment_intent?.id;}
      if(!intent)return false;
      let order=db.prepare('SELECT * FROM discovery_orders WHERE payment_intent=?').get(intent);
      if(!order&&stripe){const sessions=await stripe.checkout.sessions.list({payment_intent:intent,limit:10});for(const session of sessions.data||[]){order=db.prepare('SELECT * FROM discovery_orders WHERE session_id=?').get(session.id);if(order)break;}}
      if(!order)return false;
      if(event.type==='charge.refunded'&&!o.refunded)return true; // Partial refunds keep the pass; full refunds revoke it.
      tx(db,()=>{db.prepare("UPDATE discovery_orders SET status='revoked',payment_intent=? WHERE id=?").run(intent,order.id);if(order.pass_id){const p=db.prepare('SELECT * FROM discovery_passes WHERE id=?').get(order.pass_id);if(p&&!p.revoked){const remaining=Math.max(0,p.ends_clock-Math.max(clock(),p.starts_clock));db.prepare('UPDATE discovery_passes SET revoked=1 WHERE id=?').run(p.id);if(remaining)db.prepare('UPDATE discovery_passes SET starts_clock=starts_clock-?,ends_clock=ends_clock-? WHERE user_id=? AND revoked=0 AND starts_clock>=?').run(remaining,remaining,p.user_id,p.ends_clock);}}});return true;
    }
    return false;
  }};
};
