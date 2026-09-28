/* Browser run of coaching: template, assignment, run it, session notes, a game
   from the session. Fresh server with ADMIN_EMAIL=owner@lab.test:
   BASE=http://localhost:8787/ OUT=/tmp/lab-e2e node test/e2e/coaching-journeys.js */
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.env.OUT || require('os').tmpdir(), B = process.env.BASE || 'http://localhost:8787/';
fs.mkdirSync(OUT + '/e2e', { recursive: true });
const log = (...a) => console.log(...a);
(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const errs = [];
  async function user(name, email) {
    const c = await browser.newContext({ viewport: { width: 400, height: 860 } });
    const p = await c.newPage();
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_CERT|status of 40[34]/.test(m.text())) errs.push(name + ': ' + m.text()); });
    await p.goto(B + '#/signup'); await p.waitForTimeout(250);
    await p.fill('#nm', name); await p.fill('#em', email); await p.fill('#pw', 'correct horse battery'); await p.click('button[type=submit]'); await p.waitForTimeout(500);
    return { c, p };
  }
  const go = async (u, hash, ms = 700) => { await u.p.goto(B + hash); await u.p.waitForTimeout(ms); };
  const shot = (u, n) => u.p.screenshot({ path: `${OUT}/e2e/${n}.png`, fullPage: true });
  const coach = await user('Brett Owner', 'owner@lab.test');

  await go(coach, '#/coach/new');
  await coach.p.fill('#nm', 'Ash Lee'); await coach.p.click('button[type=submit]'); await coach.p.waitForTimeout(600);
  const code = (await coach.p.textContent('.code-box')).trim();
  const aid = await coach.p.evaluate(() => location.hash.split('/')[2]);
  await go(coach, '#/coach/templates/new');
  await coach.p.fill('#n', 'Kitchen day');
  await coach.p.click('#tf button[type=submit]'); await coach.p.waitForTimeout(600);
  log('templates:', await coach.p.$$eval('.li .t', x => x.map(y => y.textContent)));

  const A = await user('Ash Lee', 'ash@lab.test');
  await go(A, '#/profile'); await A.p.fill('#code', code); await A.p.click('#claim button[type=submit]'); await A.p.waitForTimeout(700);

  await go(coach, '#/coach/' + aid, 900);
  await coach.p.selectOption('#atpl', { label: 'Kitchen day' }); await coach.p.fill('#anote', 'Depth over pace');
  await coach.p.click('#af button[type=submit]'); await coach.p.waitForTimeout(900);
  log('coach sees assignment:', (await coach.p.textContent('#asglist')).replace(/\s+/g, ' ').slice(0, 80));
  await go(A, '#/', 900);
  log('athlete home assigned:', (await A.p.textContent('#assignedHome')).replace(/\s+/g, ' ').slice(0, 80));
  await go(coach, '#/coach/' + aid, 900);
  await coach.p.click('#asglist a:text-is("Run now")'); await coach.p.waitForTimeout(900);
  log('builder banner:', (await coach.p.textContent('.banner')).slice(0, 50), '| title:', await coach.p.inputValue('#t'), '| drills:', await coach.p.$$eval('.item-edit', x => x.length), '| preselected:', await coach.p.$$eval('#pick input:checked', x => x.length));
  await coach.p.click('#f button[type=submit]'); await coach.p.waitForTimeout(1000);
  await coach.p.click('.pad .make'); await coach.p.click('.pad .make'); await coach.p.click('.pad .miss');
  await coach.p.click('#finish'); await coach.p.click('#finish'); await coach.p.waitForTimeout(1500);
  const sid = await coach.p.evaluate(() => location.hash.split('/')[2]);
  await coach.p.fill('#snb', 'Great depth on drops today.'); await coach.p.selectOption('#snv', 'shared');
  await coach.p.click('#snf button[type=submit]'); await coach.p.waitForTimeout(900);
  await coach.p.click('a:text-is("Record a game")'); await coach.p.waitForTimeout(800);
  await coach.p.click('[data-k=doubles] button[data-v=false]');
  await coach.p.fill('#p11', 'LAB-' + String(aid).padStart(5, '0')); await coach.p.fill('#p21', 'Guest Gary');
  await coach.p.fill('[data-g="0"][data-t="0"]', '11'); await coach.p.fill('[data-g="0"][data-t="1"]', '6');
  await coach.p.click('#mf button[type=submit]'); await coach.p.waitForTimeout(900);
  log('game status:', await coach.p.textContent('.status'));
  await go(coach, '#/train/' + sid, 900);
  log('session games:', await coach.p.$$eval('.stack .li .d.mono', x => x.map(y => y.textContent)), '| notes:', await coach.p.$$eval('.note .body', x => x.length));
  await shot(coach, 'session-summary');
  await go(A, '#/train/' + sid, 900);
  log('athlete sees notes:', await A.p.$$eval('.note .body', x => x.map(y => y.textContent)), '| games:', await A.p.$$eval('a[href^="#/play/match/"]', x => x.length));
  await go(A, '#/train', 900);
  log('athlete assignment now:', (await A.p.textContent('#assigned')).replace(/\s+/g, ' ').slice(0, 60));
  log('errors:', errs);
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
