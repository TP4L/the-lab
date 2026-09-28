/* THE LAB client core: storage, API, offline outbox, sync status, helpers. */
(function () {
  'use strict';

  /* ---------- storage (never throws) ---------- */
  var Store = {
    get: function (k, d) { try { var v = localStorage.getItem('lab:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('lab:' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem('lab:' + k); } catch (e) {} },
    keys: function (prefix) {
      var out = [];
      try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf('lab:' + prefix) === 0) out.push(k.slice(4)); } } catch (e) {}
      return out;
    }
  };

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /* ---------- API ---------- */
  function ApiError(msg, status, data) { this.message = msg; this.status = status; this.data = data || {}; }
  ApiError.prototype = Object.create(Error.prototype);

  var CACHEABLE = /^\/api\/(me|home|posts|athletes|training\/sessions|studio\/posts|matches|events|leaderboard|notifications|g\/|i\/|plans|interest)/;

  function request(method, path, body) {
    var opts = { method: method, credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (res) {
      if (res.status === 204) return null;
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          if (res.status === 401) Lab.emit('signedout');
          throw new ApiError(data.error || 'Request failed (' + res.status + ').', res.status, data);
        }
        if (method === 'GET' && CACHEABLE.test(path)) Store.set('cache:' + path, { at: Date.now(), data: data });
        return data;
      });
    }, function () {
      setOnline(false);
      throw new ApiError('You’re offline.', 0);
    });
  }

  /* GET that falls back to the last copy seen on this device. */
  function get(path) {
    return request('GET', path).then(function (d) { setOnline(true); return d; }, function (err) {
      if (err.status === 0) {
        var c = Store.get('cache:' + path);
        if (c) { var d = c.data; try { Object.defineProperty(d, '_offline', { value: c.at }); } catch (e) {} return d; }
      }
      throw err;
    });
  }

  /* Upload with progress. Resolves with the media record. X-Upload-Id makes a retry safe. */
  function upload(file, query, onProgress, uploadId) {
    uploadId = uploadId || uuid();
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/media?' + query);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('X-Upload-Id', uploadId);
      xhr.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = function () {
        var data = {}; try { data = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new ApiError(data.error || 'Upload failed (' + xhr.status + ').', xhr.status));
      };
      xhr.onerror = function () { reject(new ApiError('Upload stopped. Check your connection and retry.', 0)); };
      xhr.send(file);
    });
  }

  /* ---------- blobs for offline uploads (IndexedDB) ---------- */
  var Blobs = (function () {
    var dbp = null;
    function db() {
      if (!dbp) dbp = new Promise(function (res, rej) {
        if (!window.indexedDB) return rej(new Error('No IndexedDB'));
        var r = indexedDB.open('lab-blobs', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('b'); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      });
      return dbp;
    }
    function op(mode, fn) { return db().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction('b', mode); var q = fn(t.objectStore('b')); t.oncomplete = function () { res(q && q.result); }; t.onerror = function () { rej(t.error); }; }); }); }
    return {
      put: function (k, v) { return op('readwrite', function (s) { return s.put(v, k); }); },
      get: function (k) { return op('readonly', function (s) { return s.get(k); }); },
      del: function (k) { return op('readwrite', function (s) { return s.delete(k); }); }
    };
  })();
  /* Queue a photo/video for upload. The upload ID becomes the media ID, so a
     note queued after it can already reference media_id = uploadId. */
  function queueUpload(file, query, label) {
    var uploadId = uuid();
    return Blobs.put(uploadId, file).then(function () {
      queue({ type: 'upload', uploadId: uploadId, query: query, mime: file.type, label: label || ('Upload ' + (file.name || '')) });
      return uploadId;
    });
  }

  /* ---------- outbox: writes made offline, replayed in order ---------- */
  /* Every queued write is idempotent on the server (device-made IDs), so a
     retry after a dropped reply never creates a duplicate. */
  var flushing = false;
  function outbox() { return Store.get('outbox', []); }
  function queue(entry) {
    var q = outbox();
    entry.qid = uuid(); entry.at = Date.now();
    q.push(entry);
    Store.set('outbox', q);
    status();
    flush();
  }
  function flush() {
    if (flushing) return Promise.resolve();
    var q = outbox();
    if (!q.length) { status(); return Promise.resolve(); }
    flushing = true; status();
    var head = q[0], batch = [head], req;
    if (head.type === 'upload') {
      req = Blobs.get(head.uploadId).then(function (blob) {
        if (!blob) throw new ApiError('The file is no longer on this device.', 410);
        return fetch('/api/media?' + head.query, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': head.mime || blob.type, 'X-Upload-Id': head.uploadId }, body: blob })
          .then(function (res) {
            if (res.ok) { Blobs.del(head.uploadId); return res.json(); }
            return res.json().catch(function () { return {}; }).then(function (d) { throw new ApiError(d.error || 'Upload failed.', res.status); });
          }, function () { setOnline(false); throw new ApiError('You\u2019re offline.', 0); });
      });
    } else if (head.type === 'events') {
      for (var i = 1; i < q.length && batch.length < 400; i++) {
        if (q[i].type === 'events' && q[i].session === head.session) batch.push(q[i]); else break;
      }
      req = request('POST', '/api/training/sessions/' + head.session + '/events', { events: batch.map(function (b) { return b.event; }) });
    } else {
      req = request(head.method, head.path, head.body);
    }
    return req.then(function (res) {
      setOnline(true);
      done(batch, null, res);
    }, function (err) {
      if (err.status === 0) { flushing = false; status(); return; }
      // Rejected by the server (validation, permission, conflict): keep a record, move on.
      var failed = Store.get('failed', []);
      failed.push({ label: head.label || head.path || 'Scores', error: err.message, at: Date.now() });
      Store.set('failed', failed.slice(-20));
      done(batch, err);
    });
    function done(items, err, res) {
      var ids = items.map(function (b) { return b.qid; });
      Store.set('outbox', outbox().filter(function (x) { return ids.indexOf(x.qid) < 0; }));
      flushing = false;
      Lab.emit('synced', { entry: head, error: err, result: res });
      flush();
    }
  }

  /* ---------- online state + sync pill ---------- */
  var online = navigator.onLine !== false;
  function setOnline(v) { if (online !== v) { online = v; status(); if (v) flush(); } }
  window.addEventListener('online', function () { setOnline(true); });
  window.addEventListener('offline', function () { setOnline(false); });
  setInterval(function () { if (outbox().length) flush(); }, 15000);

  function status() {
    var n = outbox().length, failed = Store.get('failed', []).length;
    var s = !online ? { cls: 'off', text: n ? 'Offline · ' + n + ' saved on device' : 'Offline' }
      : n ? { cls: 'busy', text: 'Syncing ' + n }
      : failed ? { cls: 'warn', text: failed + ' not saved' }
      : { cls: 'ok', text: 'Synced' };
    Lab.emit('status', s);
    return s;
  }

  /* ---------- tiny event bus ---------- */
  var handlers = {};
  function on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); }
  function emit(ev, data) { (handlers[ev] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } }); }

  /* ---------- DOM helpers ---------- */
  function h(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  var tt;
  function toast(msg, action) {
    var el = $('#toast');
    el.innerHTML = '<span>' + h(msg) + '</span>' + (action ? '<button type="button">' + h(action.label) + '</button>' : '');
    el.hidden = false;
    if (action) $('button', el).onclick = function () { el.hidden = true; action.run(); };
    clearTimeout(tt); tt = setTimeout(function () { el.hidden = true; }, action ? 4500 : 2400);
  }
  function when(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d)) return ts;
    var today = new Date(); var same = d.toDateString() === today.toDateString();
    return (same ? 'Today' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  /* Two-tap confirm for destructive buttons. */
  function armed(btn, label, fn) {
    btn.addEventListener('click', function () {
      if (btn.classList.contains('armed')) { fn(); return; }
      var orig = btn.textContent;
      btn.classList.add('armed'); btn.textContent = label || 'Tap again to confirm';
      setTimeout(function () { btn.classList.remove('armed'); btn.textContent = orig; }, 3500);
    });
  }
  function formError(form, msg) {
    var el = $('.err', form);
    if (!el) { el = document.createElement('p'); el.className = 'err'; el.setAttribute('role', 'alert'); form.appendChild(el); }
    el.textContent = msg;
  }
  function copy(text) {
    try { return navigator.clipboard.writeText(text).then(function () { toast('Copied'); }, function () { toast('Copy blocked. Select the text to copy it.'); }); }
    catch (e) { toast('Copy blocked. Select the text to copy it.'); }
  }
  /* Paragraphs from plain text. Never renders HTML from content. */
  function paras(text) {
    return String(text || '').split(/\n{2,}/).map(function (p) { return '<p>' + h(p).replace(/\n/g, '<br>') + '</p>'; }).join('');
  }

  window.Lab = {
    Store: Store, uuid: uuid, api: { get: get, request: request, upload: upload }, queue: queue, queueUpload: queueUpload, flush: flush, outbox: outbox, status: status,
    isOnline: function () { return online; }, on: on, emit: emit,
    h: h, $: $, $$: $$, toast: toast, when: when, armed: armed, formError: formError, copy: copy, paras: paras, ApiError: ApiError
  };
})();
