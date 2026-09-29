/* Browser run of the host controls: Preview event, paused timer, start /
   stop / add a minute, chosen courts, late joining, fairness, bracket preview.
   BASE=http://localhost:8787/ OUT=/tmp/lab-e2e node test/e2e/controls-journeys.js
   (the server needs ADMIN_EMAIL=owner@lab.test) */
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.env.OUT || require('os').tmpdir(), B = process.env.BASE || 'http://localhost:8787/';
fs.mkdirSync(OUT + '/e2e', { recursive: true });
const log = (...a) => console.log(...a);
(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const errs = [];
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage();
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|status of 40[349]|net::/.test(m.text())) errs.push(m.text()); });
  const go = async (hash, ms = 700) => { if (p.url() === B + hash) await p.reload(); else await p.goto(B + hash); await p.waitForTimeout(ms); };
  const shot = n => p.screenshot({ path: `${OUT}/e2e/${n}.png`, fullPage: true });
  await go('#/signup');
  await p.fill('#nm', 'Brett Host'); await p.fill('#em', 'owner@lab.test'); await p.fill('#pw', 'correct horse battery'); await p.click('button[type=submit]'); await p.waitForTimeout(700);

  await go('#/play/events/new');
  await p.fill('#t', 'Lesson Mixer'); await p.selectOption('#mode', 'rivalry');
  for (const n of [1, 2]) await p.uncheck(`.court-pick input[value="${n}"]`);
  for (const n of [4, 5]) await p.check(`.court-pick input[value="${n}"]`);
  await p.fill('#rmin', '5');
  await p.click('#ef button[type=submit]'); await p.waitForTimeout(800);
  const hash = await p.evaluate(() => location.hash), id = hash.split('/').pop();
  const share = await p.evaluate(async id => (await (await fetch('/api/events/' + id)).json()).links.share.split('/').pop(), id);
  await p.evaluate(async tok => { for (let i = 0; i < 9; i++) await fetch('/api/public/events/' + tok + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'P' + i + ' Player', email: 'p' + i + '@x.test' }) }); }, share);
  await p.evaluate(async id => { const e = await (await fetch('/api/events/' + id)).json(); for (const x of e.people) await fetch('/api/events/' + id + '/people/' + x.athlete_id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checked_in: true }) }); }, id);
  await go(hash);
  log('header button:', await p.textContent('#next'));
  await p.click('#next'); await p.waitForTimeout(800);
  log('preview courts:', await p.$$eval('#preview .court-card .eyebrow', x => x.map(y => y.textContent)), '| note:', (await p.textContent('#preview')).includes('opening matchups'));
  await shot('ctl-preview');
  // Roster change makes it stale: a break from the host.
  await p.evaluate(async id => { const e = await (await fetch('/api/events/' + id)).json(); await fetch('/api/events/' + id + '/people/' + e.people[0].athlete_id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on_break: true }) }); }, id);
  await p.click('#go'); await p.waitForTimeout(900);
  log('after stale start, preview shown again:', !!(await p.$('#preview .card')));
  await p.click('#go'); await p.waitForTimeout(900);
  log('timer:', await p.textContent('.timer'));
  await p.click('[data-timer=start]'); await p.waitForTimeout(1600);
  log('running:', await p.textContent('.timer'));
  await p.click('[data-timer=stop]'); await p.waitForTimeout(700);
  await p.click('[data-adj=add]'); await p.waitForTimeout(700);
  log('paused +1:', await p.textContent('.timer'));
  await shot('ctl-courts');
  await p.check('.court-pick input[value="6"]'); await p.click('#savecourts'); await p.waitForTimeout(700);
  log('stale banner:', await p.textContent('.banner').catch(() => 'none'));
  await p.click('#latejoin'); await p.waitForTimeout(600);
  log('late joining:', await p.textContent('.host-ctl .row p.small').catch(() => ''));
  await p.click('#etabs [data-v=fairness]'); await p.waitForTimeout(500);
  log('fairness rows:', await p.$$eval('.summary-table tbody tr', x => x.length));
  await shot('ctl-fairness');

  await go('#/play/events/new');
  await p.fill('#t', 'Fallout Night'); await p.selectOption('#mode', 'fallout'); await p.selectOption('#elim', 'double');
  await p.click('#ef button[type=submit]'); await p.waitForTimeout(800);
  const fh = await p.evaluate(() => location.hash), fid = fh.split('/').pop();
  const fs2 = await p.evaluate(async id => (await (await fetch('/api/events/' + id)).json()).links.share.split('/').pop(), fid);
  await p.evaluate(async tok => { for (let i = 0; i < 10; i++) await fetch('/api/public/events/' + tok + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'F' + i + ' Team', email: 'f' + i + '@x.test' }) }); }, fs2);
  await p.evaluate(async id => fetch('/api/events/' + id + '/teams/auto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), fid);
  await go(fh);
  await p.click('#next'); await p.waitForTimeout(900);
  log('bracket preview:', await p.$$eval('#preview .bcol .section-title', x => x.map(y => y.textContent)), '| byes:', await p.$$eval('#preview .bt.tbd', x => x.filter(y => y.textContent === 'Bye').length));
  await shot('ctl-bracket-preview');
  await p.click('#gob'); await p.waitForTimeout(900);
  log('started, tab:', await p.textContent('#etabs [aria-pressed=true]'));
  log('errors:', errs);
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
