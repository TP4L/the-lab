'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {start}=require('./helpers');
test('the retired padel board and API stay unavailable for every account role',async t=>{
 const s=await start();t.after(s.close);
 const anon=s.client(),member=s.client(),owner=s.client();
 await owner.signup('Owner','owner@lab.test');await member.signup('Member','member@lab.test');
 for(const client of [anon,member,owner]){
  for(const path of ['/padel','/padel/board.js','/padel%2fboard.js','/api/padel/entries'])assert.equal((await client.get(path)).status,404,path);
  assert.equal((await client.post('/api/padel/entries',{id:'retired',kind:'session',data:{}})).status,404);
 }
});
