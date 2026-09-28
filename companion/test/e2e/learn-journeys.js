/* Browser run of Learn: build a course, lock/unlock by membership, progress,
   saved posts and rich text. Fresh server with ADMIN_EMAIL=owner@lab.test:
   BASE=http://localhost:8787/ OUT=/tmp/lab-e2e node test/e2e/learn-journeys.js */
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
  const go = async (u, hash, ms = 600) => { await u.p.goto(B + hash); await u.p.waitForTimeout(ms); };
  const shot = (u, n) => u.p.screenshot({ path: `${OUT}/e2e/${n}.png`, fullPage: true });
  const owner = await user('Brett Owner', 'owner@lab.test');
  const L = await user('Lee Learner', 'lee@lab.test');

  // Build a course
  await go(owner, '#/studio/courses');
  await owner.p.click('#newc'); await owner.p.waitForTimeout(700);
  await owner.p.fill('#ct', 'Reset Fundamentals'); await owner.p.fill('#cs', 'Take pace off and win the kitchen.');
  await owner.p.selectOption('#ca', 'members');
  await owner.p.click('#cf button[type=submit]'); await owner.p.waitForTimeout(600);
  const courseUrl = await owner.p.evaluate(() => location.hash);
  for (const [t, m] of [['Why reset', 'Foundations'], ['Footwork', 'Foundations'], ['Live drill', 'Application']]) {
    await owner.p.fill('#lt', t); await owner.p.fill('#lm', m); await owner.p.click('#lf button[type=submit]'); await owner.p.waitForTimeout(600);
    await owner.p.fill('#b', `## ${t}\n\nTake **pace** off the ball.\n\n- Soft hands\n- Low paddle\n\n> Reset, then move up.`);
    if (t === 'Why reset') await owner.p.check('#pv');
    await owner.p.fill('#mi', '6');
    await owner.p.click('#lef button[type=submit]'); await owner.p.waitForTimeout(600);
    await go(owner, courseUrl);
  }
  await owner.p.selectOption('#cst', 'published'); await owner.p.click('#cf button[type=submit]'); await owner.p.waitForTimeout(600);
  log('course lessons in editor:', await owner.p.$$eval('.list .li .t', x => x.map(y => y.textContent)));
  await shot(owner, 'course-editor');

  // Learner: locked, preview opens
  await go(L, '#/learn'); await L.p.click('#ltabs [data-v=courses]'); await L.p.waitForTimeout(500);
  log('course card:', (await L.p.textContent('.course-card')).replace(/\s+/g, ' '));
  await L.p.click('.course-card'); await L.p.waitForTimeout(600);
  log('banner:', (await L.p.textContent('.banner')).slice(0, 60), '| open lessons:', await L.p.$$eval('a.li', x => x.length), '| locked:', await L.p.$$eval('.li.is-locked', x => x.length));
  await shot(L, 'course-locked');
  await L.p.click('a.btn.primary'); await L.p.waitForTimeout(600);
  log('preview lesson h2:', await L.p.textContent('.prose h2'), '| list items:', await L.p.$$eval('.prose li', x => x.length), '| quote:', !!(await L.p.$('.prose blockquote')));
  await shot(L, 'lesson');

  // Admin grants membership
  await go(owner, '#/admin', 800);
  const row = owner.p.locator('#ul .li', { hasText: 'lee@lab.test' });
  await row.locator('.msel').selectOption('active'); await owner.p.waitForTimeout(600);
  await go(L, '#/learn/courses'); await L.p.click('.course-card'); await L.p.waitForTimeout(600);
  log('after membership, banner?', !!(await L.p.$('.banner')), '| open lessons:', await L.p.$$eval('a.li', x => x.length));
  await L.p.click('a.li >> nth=0'); await L.p.waitForTimeout(500);
  await L.p.click('#done'); await L.p.waitForTimeout(700);
  log('after complete, now on:', await L.p.textContent('h1'));
  await L.p.click('#done'); await L.p.waitForTimeout(700);
  await go(L, '#/'); await L.p.waitForTimeout(500);
  log('home continue learning:', (await L.p.textContent('#learning').catch(() => '')).replace(/\s+/g, ' ').slice(0, 80));

  // Post with inline image + save
  await go(owner, '#/studio/new');
  await owner.p.fill('#title', 'Dink patterns'); await owner.p.fill('#body', '## Pattern one\n\nCross-court first.');
  await owner.p.click('#save'); await owner.p.waitForTimeout(900);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(OUT + '/e2e/i.png', png);
  await owner.p.setInputFiles('#up', OUT + '/e2e/i.png'); await owner.p.waitForTimeout(1200);
  await owner.p.click('[data-thumb], .media-grid figure'); await owner.p.waitForTimeout(200);
  await owner.p.click('[data-ins]'); await owner.p.waitForTimeout(200);
  await owner.p.click('#save'); await owner.p.waitForTimeout(700);
  await owner.p.click('#publish'); await owner.p.click('#publish'); await owner.p.waitForTimeout(800);
  log('post status:', await owner.p.textContent('.status'));
  await go(L, '#/learn'); await L.p.click('#ltabs [data-v=notes]'); await L.p.waitForTimeout(500);
  await L.p.click('.post-card'); await L.p.waitForTimeout(700);
  log('article h2:', await L.p.textContent('.prose h2'), '| inline figure:', await L.p.$$eval('.prose figure img', x => x.length));
  await L.p.click('#save'); await L.p.waitForTimeout(500);
  await go(L, '#/learn'); await L.p.click('#ltabs [data-v=saved]'); await L.p.waitForTimeout(500);
  log('saved tab:', await L.p.$$eval('.post-card .t', x => x.map(y => y.textContent)));
  await go(owner, '#/admin', 900);
  log('admin system:', (await owner.p.textContent('#sys')).replace(/\s+/g, ' ').slice(0, 160));
  log('errors:', errs);
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
