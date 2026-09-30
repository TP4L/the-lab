'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {start}=require('./helpers');
test('padel board is private and persists validated session edits',async t=>{
 const s=await start({adminEmail:'owner@lab.test'});t.after(()=>s.close());
 const anon=s.client();assert.equal((await anon.get('/padel')).status,401);assert.equal((await anon.get('/padel%2fboard.js')).status,401);assert.equal((await anon.get('/api/padel/entries')).status,401);
 const other=s.client();await other.signup('Other','other@test.test');assert.equal((await other.get('/padel')).status,403);assert.equal((await other.get('/api/padel/entries')).status,403);
 const owner=s.client();await owner.signup('B.Adams','owner@lab.test');assert.equal((await owner.get('/padel')).status,200);
 const d={date:'2026-09-29',type:'Play',minutes:60,games:4,rpe:5,drill:10,focus:'Lob depth',note:'Better control',baseline:false};
 assert.equal((await owner.post('/api/padel/entries',{id:'test-session',kind:'session',data:d})).status,200);
 assert.equal((await owner.post('/api/padel/entries',{id:'test-session',kind:'session',data:{...d,minutes:90}})).status,200);
 const result=await owner.get('/api/padel/entries');assert.equal(result.body.length,1);assert.equal(result.body[0].data.minutes,90);
 assert.equal((await owner.post('/api/padel/entries',{id:'invalid',kind:'session',data:{...d,drill:100}})).status,400);
 assert.equal((await owner.post('/api/padel/entries',{id:'invalid',kind:'session',data:{...d,date:'2026-02-31'}})).status,400);
 assert.equal((await owner.post('/api/padel/entries',{id:'skills',kind:'skills',data:{Lob:'3'}})).status,200);
 assert.equal((await owner.post('/api/padel/entries',{id:'intentions',kind:'intentions',data:{weekly:'2',target:'14 of 20',intention:'Control'}})).status,200);
 assert.equal((await other.post('/api/padel/entries',{id:'test-session',kind:'session',data:d})).status,403);
 assert.equal((await owner.post('/api/padel/entries',{id:'test-session',kind:'session',data:d},{Origin:'https://evil.example'})).status,403);
});
