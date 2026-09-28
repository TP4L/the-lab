/* Browser run of a fixed-partner event with a knockout bracket.
   BASE=http://localhost:8787/ OUT=/tmp/lab-e2e node test/e2e/teams-journeys.js */
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.env.OUT || require('os').tmpdir(), B = process.env.BASE || 'http://localhost:8787/';
fs.mkdirSync(OUT + '/e2e', { recursive: true });
const log = (...a) => console.log(...a);
(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const errs = [];
  async function user(name, email, profile) {
    const c = await browser.newContext({ viewport: { width: 400, height: 860 } });
    const p = await c.newPage();
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_CERT|status of 40[349]/.test(m.text())) errs.push(name + ': ' + m.text()); });
    await p.goto(B + '#/signup'); await p.waitForTimeout(250);
    await p.fill('#nm', name); await p.fill('#em', email); await p.fill('#pw', 'correct horse battery'); await p.click('button[type=submit]'); await p.waitForTimeout(500);
    if (profile) { await p.click('#own button[type=submit]'); await p.waitForTimeout(400); }
    const me = await p.evaluate(async () => (await (await fetch('/api/me')).json()));
    return { c, p, pid: me.athlete_id ? 'LAB-' + String(me.athlete_id).padStart(5, '0') : null };
  }
  const go = async (u, hash, ms = 700) => { await u.p.goto(B + hash); await u.p.waitForTimeout(ms); };
  const org = await user('Brett Owner', 'owner@lab.test', false);
  await go(org, '#/play/events/new');
  await org.p.fill('#t', 'Saturday Cup'); await org.p.selectOption('#pm', 'fixed'); await org.p.fill('#courts', '2');
  await org.p.click('#ef button[type=submit]'); await org.p.waitForTimeout(700);
  const eid = await org.p.evaluate(() => location.hash.split('/').pop());
  const ps = [];
  for (let i = 0; i < 6; i++) ps.push(await user(['Ari', 'Bea', 'Cal', 'Dee', 'Eli', 'Fay'][i] + ' Test', `t${i}@lab.test`, true));
  await go(ps[0], '#/play/events/' + eid);
  await ps[0].p.fill('#partner', ps[1].pid); await ps[0].p.click('[data-reg=register]'); await ps[0].p.waitForTimeout(600);
  for (const u of ps.slice(2)) { await go(u, '#/play/events/' + eid, 500); await u.p.click('[data-reg=register]'); await u.p.waitForTimeout(400); }
  await go(org, '#/play/events/' + eid);
  await org.p.click('#etabs [data-v=teams]'); await org.p.waitForTimeout(400);
  log('teams before auto:', await org.p.$$eval('#tab .li .t', x => x.map(y => y.textContent)));
  await org.p.click('#autotm'); await org.p.waitForTimeout(700);
  log('teams after auto:', await org.p.$$eval('#tab .li .t', x => x.map(y => y.textContent)));
  await org.p.click('#etabs [data-v=bracket]'); await org.p.waitForTimeout(400);
  await org.p.selectOption('#bseed', 'order'); await org.p.click('#mkbr'); await org.p.waitForTimeout(900);
  log('bracket columns:', await org.p.$$eval('.bcol .section-title', x => x.map(y => y.textContent)), '| slots:', await org.p.$$eval('.bslot', x => x.map(y => y.textContent.replace(/\s+/g, ' ').trim())));
  await org.p.screenshot({ path: OUT + '/e2e/bracket-start.png', fullPage: true });
  // Score the semifinal from the bracket, then the final.
  for (let round = 0; round < 2; round++) {
    await org.p.click('a.bslot >> nth=' + (round === 0 ? 0 : -1)); await org.p.waitForTimeout(600);
    await org.p.click('#edit'); await org.p.fill('#sf [data-g="0"][data-t="0"]', '11'); await org.p.fill('#sf [data-g="0"][data-t="1"]', String(5 + round));
    await org.p.click('#sf button[type=submit]'); await org.p.waitForTimeout(700);
    await go(org, '#/play/events/' + eid); await org.p.click('#etabs [data-v=bracket]'); await org.p.waitForTimeout(500);
    log('after round', round, ':', await org.p.$$eval('.bslot', x => x.map(y => y.textContent.replace(/\s+/g, ' ').trim())));
  }
  log('champion:', (await org.p.textContent('.focus-card').catch(() => 'none')).replace(/\s+/g, ' '));
  await org.p.screenshot({ path: OUT + '/e2e/bracket-final.png', fullPage: true });
  await go(ps[1], '#/notifications');
  log('partner notifications:', await ps[1].p.$$eval('.notif .t', x => x.map(y => y.textContent)));
  log('errors:', errs);
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
