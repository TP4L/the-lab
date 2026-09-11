/* The scoreboard API: validation, the organizer PIN, and what happens when
   three courts report at the same instant. */
import { loadFunction } from './harness.mjs';

const { handler, blobs } = await loadFunction();
const { __reset, __raw } = blobs;

const URL_ = 'https://x.test/api/event';
const get = (v) => handler(new Request(URL_ + (v == null ? '' : '?v=' + v), { method: 'GET' }), {});
const post = (body) =>
  handler(new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), {});

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) console.log('ok   ' + name);
  else { fails++; console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
};
const body = async (r) => ({ status: r.status, ...(await r.json()) });

__reset();

// ── empty event ──
let r = await body(await get());
check('empty event reads clean', [r.status, r.v, r.pinSet, r.state], [200, 0, false, { meta: {}, players: {}, games: {} }]);

// ── check-in ──
r = await body(await post({ op: 'claim', num: 7, name: 'Ruth', device: 'phoneA' }));
check('claim succeeds', [r.status, r.state.players['7'].name, r.state.players['7'].device], [200, 'Ruth', 'phoneA']);
check('version advanced', r.v, 1);

r = await body(await post({ op: 'claim', num: 7, name: 'Imposter', device: 'phoneB' }));
check('a taken number is refused', [r.status, r.error], [409, 'taken']);

r = await body(await post({ op: 'claim', num: 7, name: 'Ruth O', device: 'phoneA' }));
check('same phone may re-claim its own number', [r.status, r.state.players['7'].name], [200, 'Ruth O']);

r = await body(await post({ op: 'claim', num: 9, name: 'Ruth O', device: 'phoneA' }));
check('switching number releases the old one', [r.status, '7' in r.state.players, r.state.players['9'].num], [200, false, 9]);

// ── polling is cheap when nothing changed ──
const v = r.v;
r = await body(await get(v));
check('unchanged poll returns no state', [r.status, r.unchanged, r.state], [200, true, undefined]);
r = await body(await get(v - 1));
check('stale poll returns full state', [r.status, !!r.state], [200, true]);

// ── reporting a game ──
r = await body(await post({ op: 'putGame', game: { s1: [9, 2], s2: [3, 4], p1: 11, p2: 8 } }));
const gid = Object.keys(r.state.games)[0];
check('game stored', [r.status, r.state.games[gid].p1, r.state.games[gid].s1], [200, 11, [9, 2]]);
check('walk-ups get a board row', [2, 3, 4].every((n) => n in r.state.players), true);

r = await body(await post({ op: 'putGame', game: { s1: [1], s2: [1], p1: 5, p2: 5 } }));
check('same player on both sides refused', [r.status, r.error], [400, 'same-player']);
r = await body(await post({ op: 'putGame', game: { s1: [], s2: [2], p1: 5, p2: 5 } }));
check('empty side refused', [r.status, r.error], [400, 'needs-players']);
r = await body(await post({ op: 'putGame', game: { s1: [1], s2: [2], p1: 0, p2: 0 } }));
check('0-0 refused', [r.status, r.error], [400, 'needs-points']);

// ── hostile input ──
r = await body(await post({ op: 'putGame', game: { s1: [1, 2, 3, 4, 5], s2: [6], p1: 9999, p2: -40, court: 99 } }));
const g2 = r.state.games[Object.keys(r.state.games).find((k) => r.state.games[k].p1 === 99)];
check('sides capped at two, points and court clamped', [g2.s1, g2.p1, g2.p2, g2.court], [[1, 2], 99, 0, 12]);

r = await body(await post({ op: 'claim', num: 999, device: 'phoneZ' }));
check('out-of-range number refused', [r.status, r.error], [400, 'bad-input']);

r = await body(await post({ op: 'putGame', game: { s1: [999, 4], s2: [5], p1: 11, p2: 2 } }));
const g3 = r.state.games[Object.keys(r.state.games).sort((a, b) => r.state.games[b].at - r.state.games[a].at)[0]];
check('an out-of-range number is dropped from a side, not clamped', g3.s1, [4]);

r = await body(await post({ op: 'claim', num: 5, name: 'x'.repeat(90), device: 'phoneC' }));
check('long name truncated', r.state.players['5'].name.length, 18);

r = await body(await post({ op: 'setMeta', patch: { link: 'javascript:alert(1)', target: 9999, name: 'Friday' } }));
check('non-http link rejected, target clamped', [r.state.meta.link, r.state.meta.target, r.state.meta.name], ['', 500, 'Friday']);

r = await body(await post({ op: 'setMeta', patch: { link: 'https://lab-race-to-50.netlify.app/' } }));
check('https link kept', r.state.meta.link, 'https://lab-race-to-50.netlify.app/');

r = await body(await post({ op: 'nonsense' }));
check('unknown op refused', [r.status, r.error], [400, 'unknown-op']);

// ── undo ──
r = await body(await post({ op: 'dropGame', id: gid }));
check('undo removes the game', gid in r.state.games, false);

// ── organizer PIN ──
r = await body(await post({ op: 'setPin', pin: '2468', current: '2468' }));
check('first PIN can be set openly', [r.status, r.pinSet], [200, true]);
check('PIN is never sent to clients', JSON.stringify(r).includes('2468'), false);

r = await body(await post({ op: 'setMeta', patch: { name: 'Hijack' }, pin: 'wrong' }));
check('settings need the PIN', [r.status, r.error], [403, 'pin']);
r = await body(await post({ op: 'reset', pin: 'wrong' }));
check('reset needs the PIN', [r.status, r.error], [403, 'pin']);
r = await body(await post({ op: 'putGame', game: { s1: [1], s2: [2], p1: 11, p2: 3 } }));
check('scoring stays open to players', r.status, 200);

r = await body(await post({ op: 'setMeta', patch: { name: 'Friday Night' }, pin: '2468' }));
check('correct PIN lets settings through', [r.status, r.state.meta.name], [200, 'Friday Night']);

r = await body(await post({ op: 'reset', pin: '2468' }));
check('reset clears players and games', [Object.keys(r.state.players).length, Object.keys(r.state.games).length], [0, 0]);
check('reset keeps the settings', r.state.meta.name, 'Friday Night');
check('reset keeps the PIN', r.pinSet, true);

// ── concurrency: three courts reporting at the same instant ──
__reset();
await post({ op: 'setMeta', patch: { name: 'Concurrency' } });
const before = (await body(await get())).v;
const results = await Promise.all([
  post({ op: 'putGame', game: { s1: [1], s2: [2], p1: 11, p2: 4 } }),
  post({ op: 'putGame', game: { s1: [3], s2: [4], p1: 9, p2: 11 } }),
  post({ op: 'putGame', game: { s1: [5], s2: [6], p1: 7, p2: 11 } }),
  post({ op: 'claim', num: 8, device: 'phoneD' }),
]);
check('every concurrent write returned 200', results.map((x) => x.status), [200, 200, 200, 200]);
const final = __raw();
check('no game was lost to a race', Object.keys(final.games).length, 3);
check('the claim survived too', final.players['8'].device, 'phoneD');
check('version advanced once per write', final.v - before, 4);

console.log(fails ? `\n${fails} FAILED` : '\nall backend checks passed');
process.exit(fails ? 1 : 0);
