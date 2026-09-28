/* Browser run: offline photo on a coach note (queued, uploads on reconnect),
   and the Google button. Start the server with ADMIN_EMAIL=owner@lab.test and
   GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET set to anything.
   BASE=http://localhost:8787/ OUT=/tmp/lab-e2e node test/e2e/devices-journeys.js */
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.env.OUT || require('os').tmpdir(), B = process.env.BASE || 'http://localhost:8787/';
fs.mkdirSync(OUT + '/e2e', { recursive: true });
const log = (...a) => console.log(...a);
(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const errs = [];
  const c = await browser.newContext({ viewport: { width: 400, height: 860 } });
  const p = await c.newPage();
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_CERT|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push(m.text()); });
  await p.goto(B + '#/signin'); await p.waitForTimeout(700);
  log('google button visible:', await p.isVisible('#gbtn'), '| href:', await p.getAttribute('#gbtn', 'href'));
  const redirect = await p.evaluate(async () => { const r = await fetch('/api/auth/google/start', { redirect: 'manual' }); return r.type; });
  log('start redirects (opaque):', redirect);
  await p.goto(B + '#/signup'); await p.waitForTimeout(300);
  await p.fill('#nm', 'Brett Owner'); await p.fill('#em', 'owner@lab.test'); await p.fill('#pw', 'correct horse battery'); await p.click('button[type=submit]'); await p.waitForTimeout(600);
  await p.goto(B + '#/coach/new'); await p.waitForTimeout(500);
  await p.fill('#nm', 'Pho Tow'); await p.click('button[type=submit]'); await p.waitForTimeout(600);
  await p.click('a.btn:text-is("Open profile")'); await p.waitForTimeout(700);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(OUT + '/e2e/court.png', png);
  await c.setOffline(true); await p.evaluate(() => window.dispatchEvent(new Event('offline')));
  await p.fill('#nbody', 'Footwork from today, offline.');
  await p.click('#vis button[data-v=shared]');
  await p.setInputFiles('#nfile', OUT + '/e2e/court.png');
  await p.click('#nf button[type=submit]'); await p.waitForTimeout(800);
  log('offline pill:', await p.textContent('#sync'));
  await c.setOffline(false); await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(2500);
  log('after reconnect pill:', await p.textContent('#sync'));
  await p.reload(); await p.waitForTimeout(900);
  log('note with photo:', await p.$$eval('.note', x => x.map(n => n.querySelector('.body').textContent + ' | img:' + !!n.querySelector('img'))));
  const imgOk = await p.evaluate(async () => { const img = document.querySelector('.note img'); if (!img) return 'no img'; const r = await fetch(img.src); return r.status + ' ' + r.headers.get('content-type'); });
  log('image loads:', imgOk);
  await p.goto(B + '#/profile#prefs'); await p.waitForTimeout(900);
  log('push box:', (await p.textContent('#pushbox').catch(() => '')).slice(0, 90));
  log('errors:', errs);
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
