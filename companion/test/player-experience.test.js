'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { start } = require('./helpers');

// Small DOM harness exercises view rendering and upload/retry handlers against
// the real authenticated app API. Visual layout remains a browser QA concern.
function harness(api, me) {
  const elements = new Map();
  const make = key => { if (!elements.has(key)) elements.set(key, { value: '', files: [], innerHTML: '', textContent: '', disabled: false, tagName: key === 'button' ? 'BUTTON' : 'INPUT', reset() {}, reportValidity() {} }); return elements.get(key); };
  const root = { replaceChildren(host) { if (this.firstChild) this.firstChild.isConnected = false; this.firstChild = host; } };
  const document = { getElementById: () => root, createElement: () => ({ innerHTML: '', isConnected: true, querySelector: make }) };
  const form = make('form');
  form.querySelectorAll = () => ['#message-type','#message-body','#message-file','#message-session','button'].map(make);
  form.reset = () => { make('#message-body').value = ''; make('#message-file').files = []; };
  const location = { hash: '#/' };
  const window = { LabPlugins: [], Lab: { h: x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])), api, uuid: () => crypto.randomUUID() } };
  const ctx = { views: {}, routes: [], me: () => me, setMe: m => me = m, has: () => false, offlineNote: () => '', eventRow: e => e.title };
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/journey.js'), 'utf8'), { window, document, location });
  window.LabPlugins[0](ctx);
  return { ctx, root, make, location };
}
test('player dashboard, filters and attachment retry preserve one note and one upload', async t => {
  const s = await start(); t.after(s.close);
  const client = s.client(); await client.signup('Player <script>', 'player@lab.test');
  await client.post('/api/me/athlete', {hand:'right'});
  const me = (await client.get('/api/me')).body;
  let uploadCalls = 0, loseResponse = true;
  const api = {
    async get(path) { const r = await client.get(path); assert.equal(r.status,200); return r.body; },
    async request(method,path,body) { const r = await client.call(method,path,body); assert.ok(r.status < 300); if (loseResponse) { loseResponse = false; throw Error('Connection lost after saving'); } return r.body; },
    async upload(file, query, progress, id) { uploadCalls++; const r = await client.post('/api/media?' + query, file.data, {'Content-Type':'image/png','X-Upload-Id':id}); assert.equal(r.status,201); progress(1); return r.body; }
  };
  const h = harness(api,me);
  await h.ctx.views.home(); assert.match(h.root.firstChild.innerHTML, /Up next/); assert.match(h.root.firstChild.innerHTML,/Video room/);
  for (const section of ['sessions','videos','notes']) { h.location.hash = '#/journey/'+section; await h.ctx.views.journey(section); assert.match(h.root.firstChild.innerHTML,/journey-tabs/); }
  h.location.hash = '#/journey/feedback'; await h.ctx.views.journey('feedback');
  h.make('#message-type').value = 'Question'; h.make('#message-body').value = 'How can I improve this reset?';
  h.make('#message-file').files = [{ name:'reset.png', size:8, data:Buffer.from([137,80,78,71,13,10,26,10]) }];
  await h.make('form').onsubmit({preventDefault(){}});
  assert.match(h.make('#message-status').textContent,/Retry/); assert.equal(h.make('#message-body').value,'How can I improve this reset?');
  await h.make('form').onsubmit({preventDefault(){}});
  assert.equal(uploadCalls,1); assert.match(h.make('#message-status').innerHTML,/Saved/);
  const p = (await client.get('/api/athletes/'+me.athlete_id)).body;
  assert.equal(p.notes.length,1); assert.equal(p.media.length,1); assert.equal(p.notes[0].media_id,p.media[0].id); assert.match(p.notes[0].body,/^Question\n/);
  const other = s.client(); await other.signup('Other','other@lab.test');
  assert.equal((await other.get('/api/media/'+p.media[0].id)).status,404);
});
