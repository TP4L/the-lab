'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff, uid } = require('./helpers.js');

/* An athlete account with its own profile. Returns { c, aid, pid }. */
async function player(s, name, email) {
  const c = s.client(); await c.signup(name, email);
  const aid = (await c.post('/api/me/athlete', {})).body.athlete.id;
  return { c, aid, pid: 'LAB-' + String(aid).padStart(5, '0') };
}

test('Journey 3: record a match, correct it, see the updated history', async (t) => {
  const s = await start(); t.after(s.close);
  const me = await player(s, 'Pat Me', 'pat@lab.test');
  const opp = await player(s, 'Opp One', 'opp@lab.test');

  const id = uid();
  const body = { id, kind: 'casual', game_to: 11, best_of: 3, teams: [[{ athlete_id: me.aid, side: 'right' }], [{ player_id: opp.pid }]], games: [[11, 7], [9, 11], [11, 4]] };
  const rec = await me.c.post('/api/matches', body);
  assert.equal(rec.status, 201);
  assert.equal(rec.body.status, 'recorded');
  assert.equal(rec.body.status_label, 'Self-recorded');
  assert.equal(rec.body.winner, 1);

  // Offline retry of the same match: no duplicate.
  assert.equal((await me.c.post('/api/matches', body)).status, 200);
  // Same players and scores under a new ID: flagged as a likely duplicate.
  const dup = await me.c.post('/api/matches', { ...body, id: uid() });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.duplicate_of, id);

  // Opponent was notified and can confirm; the recorder can't confirm their own.
  const n = (await opp.c.get('/api/notifications')).body;
  assert.equal(n.unread, 1);
  assert.equal(n.items[0].link, `#/play/match/${id}`);
  assert.equal((await me.c.post(`/api/matches/${id}/confirm`)).status, 403);

  // The recorder notices game 2 was really 11-9 their way: correct it (reason required).
  assert.equal((await me.c.put(`/api/matches/${id}`, { ...body, version: rec.body.version, games: [[11, 7], [11, 9]] })).status, 400);
  const fixed = await me.c.put(`/api/matches/${id}`, { ...body, version: rec.body.version, games: [[11, 7], [11, 9]], reason: 'Game 2 score was flipped' });
  assert.equal(fixed.status, 200);
  assert.deepEqual(fixed.body.games, [[11, 7], [11, 9]]);
  assert.deepEqual(fixed.body.log.map(l => l.action), ['recorded', 'corrected']);
  // Stale edit from another device is refused.
  assert.equal((await me.c.put(`/api/matches/${id}`, { ...body, version: rec.body.version, reason: 'x' })).status, 409);

  const conf = await opp.c.post(`/api/matches/${id}/confirm`);
  assert.equal(conf.body.status, 'confirmed');

  const hist = (await me.c.get('/api/matches')).body;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].result, 'W');
  assert.deepEqual(hist[0].games, [[11, 7], [11, 9]]);
  assert.equal(hist[0].status_label, 'Opponent-confirmed');
  const oppHist = (await opp.c.get('/api/matches')).body;
  assert.equal(oppHist[0].result, 'L');
});

test('match rules: validation, disputes, coach verification, access', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const a = await player(s, 'Ann A', 'a@lab.test');
  const b = await player(s, 'Ben B', 'b@lab.test');
  const outsider = await player(s, 'Out Sider', 'out@lab.test');
  const teams = [[{ athlete_id: a.aid }], [{ player_id: b.pid }]];

  assert.equal((await a.c.post('/api/matches', { id: uid(), teams, games: [[11, 11]] })).status, 400, 'tied game');
  assert.equal((await a.c.post('/api/matches', { id: uid(), teams, best_of: 3, games: [[11, 5], [5, 11]] })).status, 400, 'undecided');
  assert.equal((await a.c.post('/api/matches', { id: uid(), teams: [[{ athlete_id: a.aid }], [{ player_id: b.pid }, { guest_name: 'Guest' }]], games: [[11, 5]] })).status, 400, 'uneven teams');
  // Can't record a match you weren't in (unless you coach a player).
  assert.equal((await outsider.c.post('/api/matches', { id: uid(), teams: [[{ player_id: a.pid }], [{ player_id: b.pid }]], games: [[11, 5]] })).status, 403);
  // Can't reference someone else's athlete by internal ID.
  assert.equal((await a.c.post('/api/matches', { id: uid(), teams: [[{ athlete_id: a.aid }], [{ athlete_id: b.aid }]], games: [[11, 5]] })).status, 400);

  const id = uid();
  await a.c.post('/api/matches', { id, teams, games: [[11, 5]] });
  assert.equal((await outsider.c.get(`/api/matches/${id}`)).status, 404);
  const d = await b.c.post(`/api/matches/${id}/dispute`, { note: 'It was 11-9' });
  assert.equal(d.body.status, 'disputed');

  // A coach who coaches B (and wasn't playing) verifies.
  await coach.post(`/api/athletes/${b.aid}/coaches`, {}).catch(() => {});
  const owner = s.client(); await owner.post('/api/auth/login', { email: 'owner@lab.test', password: 'correct horse battery' });
  assert.equal((await coach.post(`/api/matches/${id}/verify`)).status, 404, 'unrelated coach can’t see it');
  const v = await owner.post(`/api/matches/${id}/verify`);
  assert.equal(v.body.status, 'verified');
  assert.equal(v.body.status_label, 'Organizer-verified');
  // Verified match can't be deleted by the recorder alone.
  assert.equal((await a.c.del(`/api/matches/${id}`)).status, 403);
});

test('events: register, waitlist, QR check-in, round robin with late and early players, standings', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach } = await staff(s);
  const ev = await coach.post('/api/events', { title: 'Thursday Round Robin', starts_at: new Date(Date.now() + 3600e3).toISOString(), courts: 2, capacity: 8, status: 'published' });
  assert.equal(ev.status, 201);
  const eid = ev.body.id;

  const ps = [];
  for (let i = 0; i < 10; i++) ps.push(await player(s, `Player ${String.fromCharCode(65 + i)}`, `p${i}@lab.test`));
  // Athletes without a profile can't register.
  const noProfile = s.client(); await noProfile.signup('No Profile', 'np@lab.test');
  assert.equal((await noProfile.post(`/api/events/${eid}/register`)).status, 400);

  for (const p of ps.slice(0, 9)) await p.c.post(`/api/events/${eid}/register`);
  let e = (await coach.get(`/api/events/${eid}`)).body;
  assert.deepEqual([e.counts.registered, e.counts.waitlist], [8, 1]);
  await ps[9].c.post(`/api/events/${eid}/interest`);
  // A withdrawal promotes the waitlist and notifies them.
  await ps[0].c.post(`/api/events/${eid}/withdraw`);
  e = (await ps[8].c.get(`/api/events/${eid}`)).body;
  assert.equal(e.me.state, 'registered');
  assert.ok((await ps[8].c.get('/api/notifications')).body.items.some(n => /You’re in/.test(n.title)));
  // Players see registered names, not the organizer tools.
  assert.equal(e.organizer, false);
  assert.ok(e.people.every(p => p.state === 'registered' && p.player_id === undefined));
  assert.equal((await ps[1].c.post(`/api/events/${eid}/checkin`, { code: ps[1].pid })).status, 404);

  // Check-in: QR payload, player ID and manual tap all work.
  const qr = (await ps[1].c.get('/api/me/checkin')).body;
  assert.match(qr.qr, /^THELAB:[A-Z0-9x]{10}$/i);
  assert.equal((await coach.post(`/api/events/${eid}/checkin`, { code: qr.qr })).body.checked_in.athlete_id, ps[1].aid);
  assert.equal((await coach.post(`/api/events/${eid}/checkin`, { code: 'THELAB:NOPE000000' })).status, 404);
  for (const p of ps.slice(2, 6)) await coach.post(`/api/events/${eid}/checkin`, { code: p.pid });
  assert.equal((await coach.post(`/api/events/${eid}/checkin`, { athlete_id: ps[6].aid })).status, 200);
  // 6 checked in, 2 courts: 1 court of 4, 2 sit out.
  const r1 = await coach.post(`/api/events/${eid}/rounds`, { seed: 7 });
  assert.equal(r1.status, 201);
  let round = r1.body.rounds[0];
  assert.equal(round.matches.length, 1);
  assert.equal(round.sitting_out.length, 2);
  const onCourt = round.matches.flatMap(m => m.players.map(p => p.athlete_id));
  assert.equal(new Set(onCourt).size, 4);
  assert.ok(round.matches[0].players.every(p => ['left', 'right'].includes(p.side)));
  // Players got court and up-next notifications.
  const sitter = ps.find(p => p.aid === round.sitting_out[0].athlete_id);
  assert.ok((await sitter.c.get('/api/notifications')).body.items.some(n => n.title === 'You’re up next'));
  const courtUser = ps.find(p => p.aid === onCourt[0]);
  assert.ok((await courtUser.c.get('/api/notifications')).body.items.some(n => /Court 1/.test(n.title)));

  // Next round can't start with scores missing, unless forced.
  assert.equal((await coach.post(`/api/events/${eid}/rounds`, {})).status, 409);
  // A player in the match enters the score; opponent can then confirm.
  const m1 = round.matches[0];
  const scorer = ps.find(p => p.aid === m1.players[0].athlete_id);
  const sc = await scorer.c.put(`/api/matches/${m1.id}`, { version: m1.version, games: [[11, 6]] });
  assert.equal(sc.status, 200);
  assert.equal(sc.body.status, 'recorded');
  e = (await coach.get(`/api/events/${eid}`)).body;
  assert.equal(e.rounds[0].status, 'done');

  // Late arrival (ps[7]) checks in; early departure (ps[2]) is set inactive.
  await coach.post(`/api/events/${eid}/checkin`, { code: ps[7].pid });
  await coach.put(`/api/events/${eid}/people/${ps[2].aid}`, { active: false });
  const r2 = (await coach.post(`/api/events/${eid}/rounds`, { seed: 3 })).body;
  round = r2.rounds[1];
  const r2players = round.matches.flatMap(m => m.players.map(p => p.athlete_id)).concat(round.sitting_out.map(x => x.athlete_id));
  assert.ok(!r2players.includes(ps[2].aid), 'departed player not scheduled');
  assert.ok(r2players.includes(ps[7].aid), 'late arrival scheduled');
  // Round 1 sitters play in round 2.
  const r2court = round.matches.flatMap(m => m.players.map(p => p.athlete_id));
  r1.body.rounds[0].sitting_out.filter(x => x.athlete_id !== ps[2].aid).forEach(x => assert.ok(r2court.includes(x.athlete_id), 'sat out last round, plays now'));

  // Organizer enters round 2 score: organizer-verified.
  const m2 = round.matches[0];
  const v = await coach.put(`/api/matches/${m2.id}`, { version: m2.version, games: [[8, 11]] });
  assert.equal(v.body.status, 'verified');

  const st = (await ps[1].c.get(`/api/events/${eid}`)).body.standings;
  assert.ok(st.length >= 6);
  assert.ok(st[0].wins >= st[st.length - 1].wins);
  assert.equal(st.reduce((a, x) => a + x.wins, 0), 4, 'two doubles matches, two winners each');
});

test('notifications: preferences, deep links, leaderboard opt-out', async (t) => {
  const s = await start(); t.after(s.close);
  const { coach, editor } = await staff(s);
  const made = (await coach.post('/api/athletes', { name: 'Fee Dback' })).body;
  const f = s.client(); await f.signup('Fee Dback', 'fee@lab.test'); await f.post('/api/claim', { code: made.claim_code });

  await coach.post(`/api/athletes/${made.athlete.id}/notes`, { body: 'Private', visibility: 'private' });
  await coach.post(`/api/athletes/${made.athlete.id}/notes`, { body: 'Great hands today', visibility: 'shared' });
  let n = (await f.get('/api/notifications')).body;
  assert.equal(n.items.length, 1, 'private notes never notify');
  assert.equal(n.items[0].kind, 'feedback');
  assert.equal(n.items[0].link, '#/profile');

  await f.put('/api/me/prefs', { feedback: false });
  await coach.post(`/api/athletes/${made.athlete.id}/notes`, { body: 'Another', visibility: 'shared' });
  assert.equal((await f.get('/api/notifications')).body.items.length, 1, 'opted out');
  assert.equal((await f.put('/api/me/prefs', { nonsense: true })).status, 400);

  await f.post('/api/notifications/read', {});
  assert.equal((await f.get('/api/notifications')).body.unread, 0);

  // Publishing notifies members about new posts.
  const p = (await editor.post('/api/studio/posts', { title: 'Dinks', lane: 'quick_read' })).body;
  await editor.post(`/api/studio/posts/${p.id}/publish`, {});
  const items = (await f.get('/api/notifications')).body.items;
  assert.equal(items[0].kind, 'content');
  assert.match(items[0].link, /^#\/learn\/dinks-/);

  // Leaderboard only lists confirmed results, and respects opt-out.
  const a = s.client(); await a.signup('Lee Der', 'lee@lab.test'); const aid = (await a.post('/api/me/athlete', {})).body.athlete.id;
  const b = s.client(); await b.signup('Bee Low', 'bee@lab.test'); const bid = (await b.post('/api/me/athlete', {})).body.athlete.id;
  const id = uid();
  await a.post('/api/matches', { id, teams: [[{ athlete_id: aid }], [{ player_id: 'LAB-' + bid }]], games: [[11, 3]] });
  assert.equal((await a.get('/api/leaderboard')).body.length, 0);
  await b.post(`/api/matches/${id}/confirm`);
  assert.deepEqual((await a.get('/api/leaderboard')).body.map(x => [x.name, x.wins]), [['Lee Der', 1], ['Bee Low', 0]]);
  await b.put('/api/me/prefs', { leaderboard: false });
  assert.deepEqual((await a.get('/api/leaderboard')).body.map(x => x.name), ['Lee Der']);
});
