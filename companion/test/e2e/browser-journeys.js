const { chromium } = require('playwright');
/* Browser run of the acceptance journeys against a live server on a fresh database.
   Start the server with ADMIN_EMAIL=owner@lab.test, then:
   BASE=http://localhost:8787/ OUT=/tmp/lab-e2e node test/e2e/browser-journeys.js
   Needs Playwright and Chromium (CHROMIUM=/path/to/chrome to override). */
const fs0 = require('fs');
const SP = process.env.OUT || require('os').tmpdir(), B = process.env.BASE || 'http://localhost:8787/';
fs0.mkdirSync(SP + '/e2e', { recursive: true });
const log = (...a) => console.log(...a);
(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const errs = [];
  async function ctx() {
    const c = await browser.newContext({ viewport: { width: 400, height: 860 } });
    const p = await c.newPage();
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_CERT|Failed to load resource: net::ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push(m.text()); });
    return { c, p };
  }
  const wait = (p, ms = 350) => p.waitForTimeout(ms);
  const W = await ctx(); const p = W.p;

  // Owner signs up -> admin (all staff roles)
  await p.goto(B + '#/signup'); await wait(p);
  await p.fill('#nm', 'Brett Owner'); await p.fill('#em', 'owner@lab.test'); await p.fill('#pw', 'correct horse battery');
  await p.click('button[type=submit]'); await wait(p, 600);
  log('owner lands on', await p.evaluate(() => location.hash));

  // Coach creates Riley with claim email
  await p.goto(B + '#/coach/new'); await wait(p);
  await p.fill('#nm', 'Riley Park'); await p.fill('#em', 'riley@lab.test'); await p.selectOption('#hand', 'right'); await p.selectOption('#side', 'left'); await p.fill('#focus', 'Third-shot drop depth');
  await p.click('button[type=submit]'); await wait(p, 500);
  const code = (await p.textContent('.code-box')).trim();
  log('claim code', code);
  await p.click('a.btn:text-is("Open profile")'); await wait(p, 500);
  const rileyId = await p.evaluate(() => location.hash.split('/').pop());
  // shared note
  await p.fill('#nbody', 'Great reset footwork today. Keep the paddle up.');
  await p.click('#vis button[data-v=shared]'); await p.click('#nf button[type=submit]'); await wait(p, 700);
  // private note
  await p.fill('#nbody', 'Private: watch the left knee on lunges.');
  await p.click('#nf button[type=submit]'); await wait(p, 700);
  log('coach sees notes', await p.$$eval('.note .body', n => n.map(x => x.textContent)));
  await p.screenshot({ path: SP + '/e2e/coach-athlete.png', fullPage: true });

  // three more athletes
  for (const n of ['Sam Ortiz', 'Jo Lee', 'Max Chen']) {
    await p.goto(B + '#/coach/new'); await wait(p); await p.fill('#nm', n); await p.click('button[type=submit]'); await wait(p, 400);
  }

  // Start 4-player session (template has 4 drills)
  await p.goto(B + '#/train/new'); await wait(p, 500);
  for (const n of ['Riley Park', 'Sam Ortiz', 'Jo Lee', 'Max Chen']) await p.check(`#pick label:has-text("${n}") input`);
  await p.click('button[type=submit]'); await wait(p, 800);
  const sid = await p.evaluate(() => location.hash.split('/')[2]);
  log('session', sid, 'pads', await p.$$eval('.pad', x => x.length));
  const pad = n => `.pad:has(.nm:text-is("${n}"))`;
  await p.click(pad('Riley Park') + ' .make'); await p.click(pad('Riley Park') + ' .make'); await p.click(pad('Riley Park') + ' .miss');
  await p.click(pad('Sam Ortiz') + ' .make');
  await p.click(pad('Jo Lee') + ' .miss');
  // accidental tap on Max, then undo from toast
  await p.click(pad('Max Chen') + ' .make'); await p.click('#toast button'); await wait(p, 900);
  await p.screenshot({ path: SP + '/e2e/counter4.png' });

  // Go offline mid-session, keep scoring, then close and reopen the app offline
  await W.c.setOffline(true);
  await p.click(pad('Riley Park') + ' .make'); await p.click(pad('Sam Ortiz') + ' .make'); await p.click(pad('Max Chen') + ' .make');
  await wait(p, 300);
  log('pill offline:', await p.textContent('#sync'));
  await p.reload(); await wait(p, 1200);
  log('after offline reload hash', await p.evaluate(() => location.hash), '| Riley makes', await p.textContent(pad('Riley Park') + ' .make .num'), '| pill', await p.textContent('#sync'));
  // drill 3 is a score measure: record a value offline
  await p.click('#tabs button[data-i="2"]'); await wait(p);
  await p.fill('[data-in]:first-of-type', '14').catch(()=>{});
  const inputs = await p.$$('[data-in]'); await inputs[0].fill('14'); await p.click('[data-rec]'); await wait(p);
  await W.c.setOffline(false);
  await p.evaluate(() => window.dispatchEvent(new Event('online'))); await wait(p, 2500);
  log('pill after reconnect:', await p.textContent('#sync'));
  await p.click('#tabs button[data-i="0"]');
  await p.click('#finish'); await p.click('#finish'); await wait(p, 1500);
  await p.screenshot({ path: SP + '/e2e/summary.png', fullPage: true });
  const srv = await p.evaluate(async (sid) => (await (await fetch('/api/training/sessions/' + sid)).json()), sid);
  const cell = n => { const a = srv.athletes.find(x => x.name === n); return srv.summary.find(c => c.athlete_id === a.id && c.item_idx === 0); };
  log('server status', srv.status, '| events', srv.events.length,
    '| Riley', cell('Riley Park').makes + '/' + cell('Riley Park').attempts, '| Sam', cell('Sam Ortiz').makes, '| Jo miss', cell('Jo Lee').misses, '| Max', cell('Max Chen').makes,
    '| score item', JSON.stringify(srv.summary.filter(c => c.item_idx === 2 && c.values.length).map(c => c.values)));

  // Publishing: owner writes a draft, saves, publishes
  await p.goto(B + '#/studio/new'); await wait(p, 600);
  await p.click('#lane button[data-v=the_work]');
  await p.fill('#title', 'Why the reset wins the kitchen');
  await p.fill('#summary', 'Slow the ball down, then take the net.');
  await p.fill('#body', 'The reset is a decision, not a shot.\n\nTake pace off, land it in the kitchen, and move up.');
  await p.fill('#tags', 'reset, kitchen');
  await p.click('#save'); await wait(p, 900);
  log('post saved ->', await p.evaluate(() => location.hash), await p.textContent('.status'));
  // upload a thumbnail image
  const fs = require('fs'); const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(SP + '/e2e/t.png', png);
  await p.setInputFiles('#up', SP + '/e2e/t.png'); await wait(p, 1200);
  log('media on post', await p.$$eval('.media-grid figure', x => x.length), '| thumb label', await p.$$eval('.vis.shared', x => x.map(y => y.textContent)));
  await p.click('#save'); await wait(p, 700);
  await p.click('#publish'); await p.click('#publish'); await wait(p, 900);
  log('post status', await p.textContent('.status'));
  await p.screenshot({ path: SP + '/e2e/studio.png', fullPage: true });

  // Riley: new account, claim, sees shared note only
  const R = await ctx(); const r = R.p;
  await r.goto(B + '#/signup'); await wait(r);
  await r.fill('#nm', 'Riley Park'); await r.fill('#em', 'riley@lab.test'); await r.fill('#pw', 'riley password 1'); await r.click('button[type=submit]'); await wait(r, 700);
  await r.fill('#code', code.toLowerCase()); await r.click('#claim button[type=submit]'); await wait(r, 900);
  log('riley profile:', await r.textContent('.pcard h1'), '| focus:', await r.textContent('.focus-card .big'));
  log('riley sees notes:', await r.$$eval('.note .body', n => n.map(x => x.textContent)));
  log('riley results:', await r.$$eval('.li .d', n => n.map(x => x.textContent)).then(x => x.slice(-1)));
  await r.fill('#rtext', 'Felt rushed at the kitchen line.'); await r.click('#rf button[type=submit]'); await wait(r, 900);
  await r.screenshot({ path: SP + '/e2e/riley.png', fullPage: true });
  // Riley can't reach staff areas or private data
  await r.goto(B + '#/coach'); await wait(r, 500); log('riley /coach:', await r.textContent('h1'));
  await r.goto(B + '#/studio'); await wait(r, 500); log('riley /studio:', await r.textContent('h1'));
  const probe = await r.evaluate(async (id) => (await fetch('/api/athletes/' + (Number(id) + 1))).status, rileyId);
  log('riley probing another athlete:', probe);
  await r.goto(B + '#/'); await wait(r, 700);
  await r.screenshot({ path: SP + '/e2e/home-athlete.png', fullPage: true });

  // Anonymous website reader sees the published post
  const A = await ctx(); const a = A.p;
  await a.goto(B + '#/learn'); await wait(a, 700);
  log('public feed:', await a.$$eval('.post-card .t', x => x.map(y => y.textContent)));
  await a.click('.post-card'); await wait(a, 600);
  log('article paragraphs:', await a.$$eval('.prose p', x => x.length), '| hero img', !!(await a.$('img.hero')));
  await a.screenshot({ path: SP + '/e2e/article.png', fullPage: true });
  const w = await a.evaluate(() => document.documentElement.scrollWidth);
  log('anon scrollWidth', w);

  // Owner home at desktop width
  await p.setViewportSize({ width: 1200, height: 900 }); await p.goto(B + '#/'); await wait(p, 700);
  await p.screenshot({ path: SP + '/e2e/home-desktop.png' });
  log('errors:', errs);
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
