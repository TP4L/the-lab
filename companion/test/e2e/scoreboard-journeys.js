/* Browser run of the custom scoreboard: win-by-2, resume after reload, undo,
   a timed game, and recording the result as a match.
   BASE=http://localhost:8787/ OUT=/tmp/lab-e2e node test/e2e/scoreboard-journeys.js */
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
  p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_CERT/.test(m.text())) errs.push(m.text()); });
  await p.goto(B + '#/signup'); await p.waitForTimeout(250);
  await p.fill('#nm', 'Sky Player'); await p.fill('#em', 'sky@lab.test'); await p.fill('#pw', 'correct horse battery'); await p.click('button[type=submit]'); await p.waitForTimeout(500);
  await p.selectOption('#hand', 'right'); await p.click('#own button[type=submit]'); await p.waitForTimeout(500);
  const score = async () => (await p.$$eval('.board .num', x => x.map(y => y.textContent))).join('-');
  const tap = async (i, n = 1) => { for (let k = 0; k < n; k++) await p.click(`[data-p="${i}"]`); await p.waitForTimeout(150); };

  await p.goto(B + '#/train'); await p.waitForTimeout(500);
  await p.click('a:text-is("Scoreboard")'); await p.waitForTimeout(400);
  await p.fill('[data-side="0"]', 'Red'); await p.fill('[data-side="1"]', 'Blue');
  await p.fill('#to', '5'); await p.click('[data-k=bestOf] button[data-v="3"]'); await p.waitForTimeout(100);
  await p.click('#bf button[type=submit]'); await p.waitForTimeout(500);
  await tap(0, 5);
  log('after game 1:', await score(), '|', await p.textContent('.small.mono'));
  await tap(0, 4); await tap(1, 5);
  log('4-5, win by 2 needed:', await score());
  await tap(1, 1);
  log('game 2 to Blue:', await p.$$eval('p.small.mono', x => x.map(y => y.textContent).join(' | ')));
  await tap(0, 1); await p.click('#undo'); await p.waitForTimeout(150);
  log('after accidental tap + undo:', await score());
  await tap(0, 3);
  await p.reload(); await p.waitForTimeout(800);
  log('resumed after reload:', await score());
  await tap(0, 2);
  log('final:', (await p.textContent('.focus-card')).replace(/\s+/g, ' '));
  await p.screenshot({ path: OUT + '/e2e/scoreboard.png', fullPage: true });
  await p.click('#rec'); await p.waitForTimeout(800);
  log('match form prefilled:', await p.inputValue('#p21'), '| games:', await p.$$eval('#games input', x => x.map(y => y.value).join(',')));

  // Timed game: 1-minute limit, clock shortened on the device, tie -> next point wins.
  await p.goto(B + '#/train/scoreboard'); await p.waitForTimeout(400);
  await p.fill('#mins', '1'); await p.click('#bf button[type=submit]'); await p.waitForTimeout(500);
  const id = await p.evaluate(() => location.hash.split('/').pop());
  await tap(0, 2); await tap(1, 2);
  await p.evaluate((id) => { const k = 'lab:board:' + id; const b = JSON.parse(localStorage.getItem(k)); b.timer.left = 1200; localStorage.setItem(k, JSON.stringify(b)); }, id);
  await p.reload(); await p.waitForTimeout(600);
  await p.click('#tgl'); await p.waitForTimeout(2200);
  log('time up, level:', await score(), '| golden tag:', !!(await p.$('.tag.call')));
  await tap(1, 1);
  log('next point wins ->', (await p.textContent('.focus-card').catch(() => 'no final')).replace(/\s+/g, ' '), '| games:', await p.$$eval('p.small.mono', x => x.map(y => y.textContent).join(' | ')));
  log('voice control:', (await p.textContent('.voice, p.small.muted:has-text("Voice")').catch(() => 'none')).slice(0, 70));
  await p.goto(B + '#/train'); await p.waitForTimeout(500);
  log('boards on device:', await p.$$eval('a[href^="#/train/scoreboard/"] .t', x => x.length));
  log('errors:', errs);
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
