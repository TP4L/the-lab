/* Service worker: keeps the app shell on the device so THE LAB opens with no
   connection. API calls always go to the network; the app handles offline. */
const VERSION = 'lab-shell-v5';
const SHELL = ['/', '/index.html', '/styles.css', '/lib.js', '/engine.js', '/qr.js', '/markdown.js', '/app.js', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first so updates land; cached shell when offline.
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && SHELL.includes(url.pathname)) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
  );
});
