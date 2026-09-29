/* Browser run of the Play journeys against a live server on a fresh database.
   Start the server with ADMIN_EMAIL=owner@lab.test, then:
   BASE=http://localhost:8787/ OUT=/tmp/lab-e2e node test/e2e/play-journeys.js */
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.env.OUT || require('os').tmpdir(), B = process.env.BASE || 'http://localhost:8787/';
fs.mkdirSync(OUT + '/e2e', { recursive: true });
const log = (...a) => console.log(...a);
(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const errs = [];
  async function user(name, email, profile = true) {
    const c = await browser.newContext({ viewport: { width: 400, height: 860 } });
    const p = await c.newPage();
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_CERT|ERR_INTERNET_DISCONNECTED|status of 409|status of 404/.test(m.text())) errs.push(name + ': ' + m.text()); });
    await p.goto(B + '#/signup'); await p.waitForTimeout(250);
    await p.fill('#nm', name); await p.fill('#em', email); await p.fill('#pw', 'correct horse battery'); await p.click('button[type=submit]'); await p.waitForTimeout(500);
    if (profile && email !== 'owner@lab.test') { await p.selectOption('#hand', 'right'); await p.click('#own button[type=submit]'); await p.waitForTimeout(500); }
    const me = await p.evaluate(async () => (await (await fetch('/api/me')).json()));
    return { c, p, aid: me.athlete_id, pid: me.athlete_id ? 'LAB-' + String(me.athlete_id).padStart(5, '0') : null };
  }
  const go = async (u, hash, ms = 600) => { if (u.p.url() === B + hash) await u.p.reload(); else await u.p.goto(B + hash); await u.p.waitForTimeout(ms); };
  const shot = (u, n) => u.p.screenshot({ path: `${OUT}/e2e/${n}.png`, fullPage: true });

  const owner = await user('Brett Owner', 'owner@lab.test');
  const A = await user('Avery Stone', 'avery@lab.test');
  const Bp = await user('Blake Kim', 'blake@lab.test');
  const more = [];
  for (const [n, e] of [['Casey Diaz', 'casey@lab.test'], ['Drew Park', 'drew@lab.test'], ['Emery Fox', 'emery@lab.test'], ['Finley Ross', 'finley@lab.test']]) more.push(await user(n, e));

  // ---- Journey 3: record, correct, see updated history ----
  await go(A, '#/play/match/new');
  await A.p.click('[data-k=doubles] button[data-v=false]');
  await A.p.click('[data-k=best_of] button[data-v="3"]');
  await A.p.fill('#p21', Bp.pid);
  await A.p.fill('[data-g="0"][data-t="0"]', '11'); await A.p.fill('[data-g="0"][data-t="1"]', '7');
  await A.p.fill('[data-g="1"][data-t="0"]', '9'); await A.p.fill('[data-g="1"][data-t="1"]', '11');
  await A.p.fill('[data-g="2"][data-t="0"]', '11'); await A.p.fill('[data-g="2"][data-t="1"]', '5');
  await A.p.click('#mf button[type=submit]'); await A.p.waitForTimeout(800);
  const mid = await A.p.evaluate(() => location.hash.split('/').pop());
  log('recorded match', mid.slice(0, 8), '| score', await A.p.textContent('h1'), '| status', await A.p.textContent('.status'));
  // Same match again -> duplicate warning
  await go(A, '#/play/match/new');
  await A.p.click('[data-k=doubles] button[data-v=false]'); await A.p.click('[data-k=best_of] button[data-v="3"]');
  await A.p.fill('#p21', Bp.pid);
  for (const [g, a, b] of [[0, 11, 7], [1, 9, 11], [2, 11, 5]]) { await A.p.fill(`[data-g="${g}"][data-t="0"]`, String(a)); await A.p.fill(`[data-g="${g}"][data-t="1"]`, String(b)); }
  await A.p.click('#mf button[type=submit]'); await A.p.waitForTimeout(700);
  log('duplicate warning:', (await A.p.textContent('#dupbox')).slice(0, 60));
  // Correct game 2
  await go(A, '#/play/match/' + mid);
  await A.p.click('#edit');
  await A.p.fill('#sf [data-g="1"][data-t="0"]', '11'); await A.p.fill('#sf [data-g="1"][data-t="1"]', '9');
  await A.p.fill('#sf [data-g="2"][data-t="0"]', ''); await A.p.fill('#sf [data-g="2"][data-t="1"]', '');
  await A.p.fill('#reason', 'Game 2 was flipped; we only played two');
  await A.p.click('#sf button[type=submit]'); await A.p.waitForTimeout(700);
  log('after correction:', await A.p.textContent('h1'), '| history:', await A.p.$$eval('.list .li .t', x => x.map(y => y.textContent)));
  // Blake: bell shows notifications, confirms
  await go(Bp, '#/');
  log('blake bell count:', await Bp.p.getAttribute('#bell', 'data-n'), '| home banner:', (await Bp.p.textContent('.banner').catch(() => '')).slice(0, 50));
  await go(Bp, '#/play/match/' + mid);
  await Bp.p.click('#confirm'); await Bp.p.waitForTimeout(600);
  log('blake confirmed ->', await Bp.p.textContent('.status'));
  await go(A, '#/play');
  log('avery history:', await A.p.$$eval('.li', x => x.map(y => y.textContent.replace(/\s+/g, ' ').trim()).filter(t => /Avery/.test(t))));
  await shot(A, 'play-hub');
  await go(A, '#/play/match/' + mid); await shot(A, 'match');

  // Offline match recording
  await go(A, '#/play/match/new');
  await A.c.setOffline(true);
  await A.p.click('[data-k=doubles] button[data-v=false]');
  await A.p.fill('#p21', 'Guest Gary');
  await A.p.fill('[data-g="0"][data-t="0"]', '11'); await A.p.fill('[data-g="0"][data-t="1"]', '3');
  await A.p.evaluate(() => window.dispatchEvent(new Event('offline')));
  await A.p.click('#mf button[type=submit]'); await A.p.waitForTimeout(700);
  log('offline save ->', await A.p.evaluate(() => location.hash), '| pill', await A.p.textContent('#sync'), '| on device:', await A.p.$$eval('.status.local', x => x.length));
  await A.c.setOffline(false); await A.p.evaluate(() => window.dispatchEvent(new Event('online'))); await A.p.waitForTimeout(1500);
  log('after reconnect pill:', await A.p.textContent('#sync'));

  // ---- Event: create, register, check in (code + tap), rounds, scores, standings ----
  await go(owner, '#/play/events/new');
  await owner.p.fill('#t', 'Thursday Round Robin'); await owner.p.fill('#loc', 'Court 1-2, Riverside');
  await owner.p.uncheck('.court-pick input[value="2"]');
  await owner.p.click('#ef button[type=submit]'); await owner.p.waitForTimeout(700);
  const eid = await owner.p.evaluate(() => location.hash.split('/').pop());
  log('event', eid, await owner.p.textContent('h1'));
  for (const u of [A, Bp, ...more]) { await go(u, '#/play/events/' + eid, 500); await u.p.click('[data-reg=register]'); await u.p.waitForTimeout(400); }
  // Avery opens the QR; organizer types the code under it
  await go(A, '#/profile'); await A.p.click('#qrbox summary'); await A.p.waitForTimeout(600);
  const qrOk = await A.p.$('#qr svg path');
  const code = await A.p.$$eval('#qr b.mono', x => x[1].textContent);
  log('QR rendered:', !!qrOk, '| code', code);
  await shot(A, 'profile-qr');
  await go(owner, '#/play/events/' + eid);
  await owner.p.click('#etabs [data-v=people]'); await owner.p.waitForTimeout(500);
  await owner.p.click('#scan'); await owner.p.waitForTimeout(300);
  log('scanner fallback:', (await owner.p.textContent('#scanbox')).slice(0, 50));
  await owner.p.fill('#code', code); await owner.p.click('#codef button'); await owner.p.waitForTimeout(700);
  for (let i = 0; i < 4; i++) { await owner.p.click('[data-in]'); await owner.p.waitForTimeout(600); }
  log('checked in:', (await owner.p.textContent('#tab > p.small.muted')).split('.')[0]);
  await shot(owner, 'checkin');
  await owner.p.click('#next'); await owner.p.waitForTimeout(900);
  await owner.p.click('#go'); await owner.p.waitForTimeout(900);
  const r1 = await owner.p.$$eval('.court-card', x => x.length);
  log('round 1 courts:', r1, '| sitting:', (await owner.p.textContent('#tab')).match(/Resting: [^.]*/)?.[0]);
  await shot(owner, 'courts');
  // A player on court sees their assignment
  const onCourt = [A, Bp, ...more];
  let playerOn = null;
  for (const u of onCourt) { await go(u, '#/play/events/' + eid, 500); const t = await u.p.textContent('.focus-card').catch(() => ''); if (/Court 1/.test(t)) { playerOn = u; log('player sees:', t.replace(/\s+/g, ' ').slice(0, 90)); break; } }
  await shot(playerOn, 'my-court');
  // Player enters score from match page
  await playerOn.p.click('.court-card.mine'); await playerOn.p.waitForTimeout(600);
  await playerOn.p.click('#edit');
  await playerOn.p.fill('#sf [data-g="0"][data-t="0"]', '11'); await playerOn.p.fill('#sf [data-g="0"][data-t="1"]', '8');
  await playerOn.p.click('#sf button[type=submit]'); await playerOn.p.waitForTimeout(700);
  log('event score entered ->', await playerOn.p.textContent('.status'));
  // Early departure + next round
  await go(owner, '#/play/events/' + eid);
  await owner.p.click('#etabs [data-v=people]'); await owner.p.waitForTimeout(400);
  await owner.p.click('[data-pp][data-body*="active"]'); await owner.p.waitForTimeout(500);
  await owner.p.click('#next'); await owner.p.waitForTimeout(900);
  await owner.p.click('#go'); await owner.p.waitForTimeout(900);
  log('round 2 posted, rounds:', await owner.p.$$eval('#tab .section-title', x => x.map(y => y.textContent)));
  await owner.p.click('#etabs [data-v=standings]'); await owner.p.waitForTimeout(400);
  log('standings rows:', await owner.p.$$eval('.summary-table tbody tr', x => x.length));
  await go(playerOn, '#/notifications');
  log('notifications:', await playerOn.p.$$eval('.notif .t', x => x.map(y => y.textContent)));
  await shot(playerOn, 'notifications');
  await go(A, '#/play/leaderboard');
  log('leaderboard:', await A.p.$$eval('.summary-table tbody tr', x => x.map(y => y.textContent.replace(/\s+/g, ' ').trim())));
  await go(A, '#/'); await shot(A, 'home');
  log('errors:', errs);
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
