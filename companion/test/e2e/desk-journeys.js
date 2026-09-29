/* Browser run of the Events desk: Pending Interest -> Team Planner -> live
   event, then a guest-link event with courts, scores, stop and spectators,
   and a double-elimination Fallout bracket.
   BASE=http://localhost:8787/ OUT=/tmp/lab-e2e node test/e2e/desk-journeys.js
   (the server needs ADMIN_EMAIL=owner@lab.test) */
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.env.OUT || require('os').tmpdir(), B = process.env.BASE || 'http://localhost:8787/';
fs.mkdirSync(OUT + '/e2e', { recursive: true });
const log = (...a) => console.log(...a);
const shot = (u, name) => u.p.screenshot({ path: `${OUT}/e2e/${name}.png`, fullPage: true });
(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const errs = [];
  async function visitor(name) {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await c.newPage();
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_CERT|status of 40[349]|ERR_NAME|net::/.test(m.text())) errs.push(name + ': ' + m.text()); });
    return { c, p };
  }
  const go = async (u, hash, ms = 700) => {
    if (u.p.url() === B + hash) await u.p.reload(); else await u.p.goto(B + hash);
    await u.p.waitForTimeout(ms);
  };
  const hashOf = url => url.slice(url.indexOf('#'));

  // Host: the admin account (coach powers included).
  const host = await visitor('host');
  await go(host, '#/signup');
  await host.p.fill('#nm', 'Brett Host'); await host.p.fill('#em', 'owner@lab.test'); await host.p.fill('#pw', 'correct horse battery');
  await host.p.click('button[type=submit]'); await host.p.waitForTimeout(700);
  await go(host, '#/coach/desk');
  log('desk steps:', await host.p.$$eval('.desk-steps b', x => x.map(y => y.textContent)));
  await shot(host, 'desk');

  /* ---------- 1. Pending Interest ---------- */
  await go(host, '#/coach/interest/new');
  await host.p.fill('#ct', 'Tuesday 3.5 group'); await host.p.fill('#cs', '3.0–3.5'); await host.p.fill('#cl', 'Court 4');
  await host.p.fill('#cmin', '3'); await host.p.fill('#cmax', '4');
  await host.p.click('#addopt'); await host.p.fill('#optlist input[data-f=label] >> nth=0', 'Tue 6pm');
  await host.p.click('#addopt'); await host.p.fill('#optlist input[data-f=label] >> nth=1', 'Thu 7pm');
  await host.p.click('#icf button[type=submit]'); await host.p.waitForTimeout(700);
  const interestLink = hashOf(await host.p.inputValue('#ilink input'));
  log('interest link:', interestLink.slice(0, 14) + '…');
  for (const [i, name] of ['Sam Lee', 'Jo Park', 'Max Wu', 'Kai Ng'].entries()) {
    const v = await visitor('resp' + i);
    await go(v, interestLink);
    await v.p.fill('#in', name); await v.p.fill('#ie', `r${i}@x.test`);
    if (i === 1) await v.p.click('[data-k=st] [data-v=maybe]');
    await v.p.check('.opt-checks input >> nth=0');
    await v.p.fill('#inote', i === 0 ? 'Evenings only' : '');
    await v.p.click('#irf button[type=submit]'); await v.p.waitForTimeout(600);
    if (i === 0) { log('respondent sees:', (await v.p.textContent('.banner')).replace(/\s+/g, ' ').trim()); await shot(v, 'interest-public'); }
    await v.c.close();
  }
  await go(host, '#/coach/interest');
  await go(host, await host.p.getAttribute('.list a.li', 'href'));
  log('interest progress:', (await host.p.textContent('.big-num')).replace(/\s+/g, ' '), '| responses:', await host.p.$$eval('.list .li .t', x => x.map(y => y.textContent.replace(/\s+/g, ' ').trim())));
  await shot(host, 'interest-host');
  await host.p.fill('#sst', '2030-03-05T18:00'); await host.p.click('#schf button[type=submit]'); await host.p.waitForTimeout(900);
  log('after set date:', await host.p.evaluate(() => location.hash));

  /* ---------- 2. Team Planner ---------- */
  const planHash = await host.p.evaluate(() => location.hash);
  await go(host, planHash + '/edit');
  await host.p.fill('#pcap', '3'); await host.p.fill('#pmsg', 'Bring water. We work on the kitchen line.');
  await host.p.fill('#pho', 'Sam: paddle drops after the dink.');
  await host.p.click('#addb'); await host.p.fill('#bs0', '18:00'); await host.p.fill('#be0', '18:30'); await host.p.fill('#bc0', '1'); await host.p.fill('#bl0', 'Brett'); await host.p.fill('#bd0', 'Dink ladder');
  await host.p.click('#addb'); await host.p.fill('#be1', '19:00'); await host.p.fill('#bc1', '2'); await host.p.fill('#bl1', 'Austin'); await host.p.fill('#bd1', 'Third shot drops');
  await host.p.click('#pf button[type=submit]'); await host.p.waitForTimeout(800);
  await host.p.fill('#an', 'Walk Up'); await host.p.click('#addf button[type=submit]'); await host.p.waitForTimeout(700);
  await host.p.click('#invite'); await host.p.waitForTimeout(800);
  const invites = await host.p.$$eval('.li.person', x => x.map(li => ({ name: li.querySelector('.t').textContent.trim().split(' ')[0], link: li.querySelector('[data-copy]').getAttribute('data-copy') })));
  log('invitees:', invites.map(i => i.name));
  await shot(host, 'plan-host');
  const answers = {};
  for (const inv of invites) {
    const v = await visitor('inv-' + inv.name);
    await go(v, hashOf(inv.link));
    const want = inv.name === 'Jo' ? 'maybe' : 'in';
    await v.p.click(`[data-k=rsvp] [data-v=${want}]`); await v.p.waitForTimeout(600);
    answers[inv.name] = (await v.p.textContent('.card .small')).trim();
    if (inv.name === 'Sam') { await shot(v, 'invite-player'); log('invite page mentions handoff?', (await v.p.content()).includes('paddle drops')); }
    await v.c.close();
  }
  log('answers:', answers);
  await go(host, planHash);
  log('plan tiles:', await host.p.$$eval('.tile', x => x.map(y => y.textContent.replace(/\s+/g, ' ').trim())));
  // Recap for Sam, shared.
  await host.p.click('.li.person >> nth=0 >> [data-rec]'); await host.p.waitForTimeout(500);
  await host.p.fill('.recap-form [data-r=o]', 'Paddle drops after the dink.'); await host.p.fill('.recap-form [data-r=c]', 'Paddle up, ready.'); await host.p.fill('.recap-form [data-r=n]', '50 cross-court dinks.');
  await host.p.click('.recap-form [data-pub="1"]'); await host.p.waitForTimeout(800);
  const sam = await visitor('sam-recap');
  await go(sam, hashOf(invites[0].link));
  log('Sam recap:', (await sam.p.textContent('.focus-card')).replace(/\s+/g, ' ').trim());
  await sam.c.close();
  await go(host, planHash);
  await host.p.selectOption('#evmode', 'rotate'); await host.p.click('#mkev'); await host.p.waitForTimeout(900);
  log('plan -> event:', await host.p.evaluate(() => location.hash), '| registered:', await host.p.textContent('#tab .small:has-text("registered")').catch(() => '?'));

  /* ---------- 3. Guest-link event: Unlucky, first finish stops the round ---------- */
  await go(host, '#/play/events/new');
  await host.p.fill('#t', 'Thursday Unlucky Mixer'); await host.p.selectOption('#mode', 'unlucky');
  await host.p.selectOption('#rend', 'first'); await host.p.fill('#rmin', '12'); await host.p.fill('#rlim', '4');
  log('mode help:', await host.p.textContent('#modehelp'));
  await host.p.click('#ef button[type=submit]'); await host.p.waitForTimeout(800);
  const eventHash = await host.p.evaluate(() => location.hash);
  await host.p.click('#etabs [data-v=share]'); await host.p.waitForTimeout(400);
  const shareLink = hashOf(await host.p.inputValue('#sharelink input'));
  const watchLink = hashOf(await host.p.inputValue('#watchlink input'));
  await shot(host, 'event-share');
  const guests = [];
  for (let i = 0; i < 7; i++) {
    const v = await visitor('guest' + i);
    await go(v, shareLink);
    if (i === 0) await shot(v, 'event-signup');
    await v.p.fill('#rn', ['Ana', 'Ben', 'Cy', 'Dee', 'Eve', 'Flo', 'Gus'][i] + ' Guest'); await v.p.fill('#re', `g${i}@x.test`);
    await v.p.click('#regf button[type=submit]'); await v.p.waitForTimeout(700);
    guests.push(v);
  }
  log('guest 0 lands on:', (await guests[0].p.evaluate(() => location.hash)).slice(0, 5), '| heading:', await guests[0].p.textContent('.head .eyebrow'));
  await shot(guests[0], 'guest-before');
  await go(host, eventHash);
  await host.p.click('#etabs [data-v=people]'); await host.p.waitForTimeout(400);
  await host.p.click('details:has(#walkf) summary'); await host.p.fill('#wn', 'Hal Walkin'); await host.p.click('#walkf button[type=submit]'); await host.p.waitForTimeout(700);
  for (let i = 0; i < 7; i++) { const b = await host.p.$('[data-in]'); if (!b) break; await b.click(); await host.p.waitForTimeout(450); }
  log('check-in line:', (await host.p.textContent('#tab > p.small')).slice(0, 40));
  await shot(host, 'event-checkin');
  await host.p.click('#next'); await host.p.waitForTimeout(800);
  log('preview courts:', await host.p.$$eval('#preview .court-card .eyebrow', x => x.map(y => y.textContent)));
  await shot(host, 'event-preview');
  await host.p.click('#go'); await host.p.waitForTimeout(900);
  log('timer:', await host.p.textContent('.timer').catch(() => 'none'));
  await shot(host, 'event-courts');
  // Guest on court: sees assignment, acknowledges, enters a score. First finish stops the round.
  let onCourt = null;
  for (const g of guests) {
    await g.p.reload(); await g.p.waitForTimeout(600);
    if (await g.p.$('#gack')) { onCourt = g; break; }
  }
  log('guest assignment:', (await onCourt.p.textContent('.focus-card.assign')).replace(/\s+/g, ' ').trim());
  await onCourt.p.click('#gack'); await onCourt.p.waitForTimeout(600);
  const start = await onCourt.p.inputValue('#gs0').catch(() => '');
  await onCourt.p.fill('#gs0', '11'); await onCourt.p.fill('#gs1', '9'); await onCourt.p.click('#gsf button[type=submit]'); await onCourt.p.waitForTimeout(700);
  log('guest after score:', (await onCourt.p.textContent('#gsf .section-title').catch(() => 'no form')).trim(), '| start value was', JSON.stringify(start));
  await shot(onCourt, 'guest-on-court');
  await go(host, eventHash, 900);
  log('round header:', await host.p.$$eval('#tab .section-title', x => x.map(y => y.textContent)));
  const confirmBtn = await host.p.$('[data-verify]');
  if (confirmBtn) { await confirmBtn.click(); await host.p.waitForTimeout(700); }
  log('court statuses:', await host.p.$$eval('.court-card .sc', x => x.map(y => y.textContent.trim())));
  // Spectator view.
  const fan = await visitor('fan');
  await go(fan, watchLink, 900);
  log('spectator sections:', await fan.p.$$eval('.section-title', x => x.map(y => y.textContent)));
  await shot(fan, 'spectator');
  // A resting guest takes a break, the host undoes it.
  const rest = guests.find(g => g !== onCourt);
  await rest.p.reload(); await rest.p.waitForTimeout(600);
  await rest.p.click('[data-gs=break]'); await rest.p.waitForTimeout(600);
  await go(host, eventHash);
  log('undo banner:', await host.p.textContent('.banner').catch(() => 'none'));

  /* ---------- 4. Fallout, double elimination ---------- */
  await go(host, '#/play/events/new');
  await host.p.fill('#t', 'Fallout Friday'); await host.p.selectOption('#mode', 'fallout'); await host.p.selectOption('#elim', 'double');
  await host.p.click('#ef button[type=submit]'); await host.p.waitForTimeout(800);
  const fHash = await host.p.evaluate(() => location.hash);
  const fShare = await host.p.evaluate(async (id) => (await (await fetch('/api/events/' + id)).json()).links.share, fHash.split('/').pop());
  const anon = await visitor('anon');
  await go(anon, '#/');
  await anon.p.evaluate(async (tok) => { for (let i = 0; i < 8; i++) await fetch('/api/public/events/' + tok + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'F' + i + ' Team', email: 'f' + i + '@x.test' }) }); }, fShare.split('/').pop());
  await go(host, fHash);
  await host.p.click('#etabs [data-v=teams]'); await host.p.waitForTimeout(400);
  await host.p.click('#autotm'); await host.p.waitForTimeout(700);
  await host.p.click('#etabs [data-v=bracket]'); await host.p.waitForTimeout(400);
  await host.p.selectOption('#bseed', 'order'); await host.p.click('#mkbr'); await host.p.waitForTimeout(900);
  log('fallout sections:', await host.p.$$eval('#tab > p.section-title', x => x.map(y => y.textContent)), '| columns:', await host.p.$$eval('.bcol .section-title', x => x.map(y => y.textContent)));
  await shot(host, 'fallout-bracket');

  log('errors:', errs);
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
