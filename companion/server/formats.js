'use strict';
/* Event formats: pure scheduling logic, no database. play.js feeds it the
   players and match history and writes the results. */

const MODES = {
  rotate: 'Round Robin',
  race: 'Race to ( )',
  premapped: 'Pre-Mapped Doubles',
  unlucky: 'Unlucky',
  rivalry: 'Rivalry',
  fixed: 'Fixed Partners',
  draft3: '3v3 Team Draft',
  fallout: 'Fallout'
};
/* Modes that rotate partners every round, one round at a time. */
const ROTATING = ['rotate', 'race', 'unlucky', 'rivalry'];
const HEADSTARTS = [0, 3, 6];

/* Small seeded generator so a previewed round can be started exactly as shown. */
function rng(seed) {
  let st = seed >>> 0;
  return () => { st = (st * 1103515245 + 12345) % 2147483648; return st / 2147483648; };
}
function shuffle(list, rand) {
  const s = list.slice();
  for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; }
  return s;
}
const pairKey = (a, b) => (a < b ? a + ':' + b : b + ':' + a);

/* History of an event so far: who has partnered, faced, played and sat out. */
function emptyHistory() { return { partner: {}, opp: {}, played: {}, right: {}, sat: {} }; }
function addMatch(h, teams) {
  // teams: [[{athlete_id, side}], [...]]
  teams.forEach((t, ti) => t.forEach(p => {
    h.played[p.athlete_id] = (h.played[p.athlete_id] || 0) + 1;
    if (p.side === 'right') h.right[p.athlete_id] = (h.right[p.athlete_id] || 0) + 1;
    t.forEach(q => { if (p.athlete_id < q.athlete_id) h.partner[pairKey(p.athlete_id, q.athlete_id)] = (h.partner[pairKey(p.athlete_id, q.athlete_id)] || 0) + 1; });
    teams[1 - ti].forEach(q => { if (p.athlete_id < q.athlete_id) h.opp[pairKey(p.athlete_id, q.athlete_id)] = (h.opp[pairKey(p.athlete_id, q.athlete_id)] || 0) + 1; });
  }));
}
function addSitting(h, ids) { ids.forEach(id => { h.sat[id] = (h.sat[id] || 0) + 1; }); }

/* One doubles round from the players available now. Players with the fewest
   games go first, then those who sat out most. Groupings avoid repeat
   partners; opponents repeat as little as possible, or, for Rivalry, as
   much as possible. It aims for fairness; it can't promise a perfect
   schedule. */
function buildRound(pool, courts, h, rand, { rivalry = false } = {}) {
  const c = Math.min(courts, Math.floor(pool.length / 4));
  const order = pool.map(p => ({ p, r: rand() }))
    .sort((a, b) => (h.played[a.p.athlete_id] || 0) - (h.played[b.p.athlete_id] || 0) || (h.sat[b.p.athlete_id] || 0) - (h.sat[a.p.athlete_id] || 0) || a.r - b.r)
    .map(x => x.p);
  const playing = order.slice(0, c * 4), sitting = order.slice(c * 4);
  const pc = (a, b) => h.partner[pairKey(a, b)] || 0, oc = (a, b) => h.opp[pairKey(a, b)] || 0;
  const oppWeight = rivalry ? -3 : 2;
  const groupCost = g => {
    const splits = [[[g[0], g[1]], [g[2], g[3]]], [[g[0], g[2]], [g[1], g[3]]], [[g[0], g[3]], [g[1], g[2]]]];
    let best = null;
    splits.forEach(([t1, t2]) => {
      const cost = 10 * (pc(t1[0].athlete_id, t1[1].athlete_id) + pc(t2[0].athlete_id, t2[1].athlete_id)) +
        oppWeight * t1.reduce((s, a) => s + oc(a.athlete_id, t2[0].athlete_id) + oc(a.athlete_id, t2[1].athlete_id), 0);
      if (!best || cost < best.cost) best = { cost, teams: [t1, t2] };
    });
    return best;
  };
  let best = null;
  for (let trial = 0; trial < 400; trial++) {
    const s = shuffle(playing, rand);
    const groups = []; let cost = 0;
    for (let i = 0; i < s.length; i += 4) { const g = groupCost(s.slice(i, i + 4)); cost += g.cost; groups.push(g.teams); }
    if (!best || cost < best.cost) best = { cost, groups };
    if (cost === 0 && !rivalry) break;
  }
  const sides = team => {
    const [a, b] = team;
    const pref = p => p.preferred_side;
    if (pref(a) === 'left' && pref(b) !== 'left') return [[a, 'left'], [b, 'right']];
    if (pref(a) === 'right' && pref(b) !== 'right') return [[a, 'right'], [b, 'left']];
    if (pref(b) === 'left') return [[a, 'right'], [b, 'left']];
    if (pref(b) === 'right') return [[a, 'left'], [b, 'right']];
    return (h.right[a.athlete_id] || 0) <= (h.right[b.athlete_id] || 0) ? [[a, 'right'], [b, 'left']] : [[a, 'left'], [b, 'right']];
  };
  return { courts: (best ? best.groups : []).map(teams => teams.map(sides)), sitting };
}

/* Unlucky: each team starts a game on 0, 3 or 6. */
function headstarts(n, rand) {
  return Array.from({ length: n }, () => [HEADSTARTS[Math.floor(rand() * 3)], HEADSTARTS[Math.floor(rand() * 3)]]);
}

/* Pre-Mapped Doubles: every round planned before play starts, by building
   rounds one after another against a simulated history. */
function premap(pool, courts, rounds, h, rand) {
  const sim = JSON.parse(JSON.stringify(h));
  const out = [];
  for (let i = 0; i < rounds; i++) {
    const plan = buildRound(pool, courts, sim, rand);
    plan.courts.forEach(teams => addMatch(sim, teams.map(t => t.map(([p, side]) => ({ athlete_id: p.athlete_id, side })))));
    addSitting(sim, plan.sitting.map(p => p.athlete_id));
    out.push({ courts: plan.courts.map(teams => teams.map(t => t.map(([p, side]) => [p.athlete_id, side]))), sitting: plan.sitting.map(p => p.athlete_id) });
  }
  return out;
}

/* 3v3 Team Draft: two teams of three play three doubles games, each pair
   against the matching pair, so everyone partners both teammates once. */
function draftGames(a, b) {
  return [[[a[0], a[1]], [b[0], b[1]]], [[a[0], a[2]], [b[0], b[2]]], [[a[1], a[2]], [b[1], b[2]]]];
}
/* Snake draft for 3-player teams: strongest picks spread across teams. */
function snakeTeams(players, n) {
  const teams = Array.from({ length: n }, () => []);
  players.slice(0, n * 3).forEach((p, i) => {
    const round = Math.floor(i / n), pos = i % n;
    teams[round % 2 === 0 ? pos : n - 1 - pos].push(p);
  });
  return teams;
}

/* ---------- knockout brackets ---------- */
/* Seeding order so 1 and 2 can only meet in the final. */
function seedOrder(size) {
  let order = [1];
  while (order.length < size) { const n = order.length * 2 + 1; order = order.flatMap(s => [s, n - s]); }
  return order;
}
/* The games of a bracket. Each side of a game names its source:
   'seed:N', 'W:<code>' (winner of), 'L:<code>' (loser of), or 'X:<code>'
   (the grand-final reset, played only if the losers-side team won). */
function bracketGraph(teamCount, elimination) {
  let size = 2; while (size < teamCount) size *= 2;
  const k = Math.log2(size);
  const games = [];
  const add = (section, round, pos, a, b) => { const code = `${section}${round}-${pos}`; games.push({ code, section, round, pos, src_a: a, src_b: b }); return code; };
  const order = seedOrder(size);
  for (let p = 0; p < size / 2; p++) add('W', 0, p, 'seed:' + order[2 * p], 'seed:' + order[2 * p + 1]);
  for (let r = 1; r < k; r++) for (let p = 0; p < size / 2 ** (r + 1); p++) add('W', r, p, `W:W${r - 1}-${2 * p}`, `W:W${r - 1}-${2 * p + 1}`);
  if (elimination !== 'double') return { size, games };

  // Losers side: first-round losers play each other, then each winners-round
  // loser drops in against a losers-side winner (crossed to avoid rematches).
  let prev = [];
  let lr = 0;
  for (let p = 0; p < Math.floor(size / 4); p++) prev.push(add('L', lr, p, `L:W0-${2 * p}`, `L:W0-${2 * p + 1}`));
  if (prev.length) lr++;
  for (let j = 1; j < k; j++) {
    const drops = games.filter(g => g.section === 'W' && g.round === j).map(g => g.code);
    const next = [];
    for (let p = 0; p < prev.length; p++) next.push(add('L', lr, p, `W:${prev[p]}`, `L:${drops[drops.length - 1 - p]}`));
    lr++; prev = next;
    if (j < k - 1) {
      const minor = [];
      for (let p = 0; p < prev.length / 2; p++) minor.push(add('L', lr, p, `W:${prev[2 * p]}`, `W:${prev[2 * p + 1]}`));
      lr++; prev = minor;
    }
  }
  const lbChamp = prev.length ? `W:${prev[0]}` : 'L:W0-0';
  const f = add('F', 0, 0, `W:W${k - 1}-0`, lbChamp);
  add('F', 1, 0, `X:${f}`, `X:${f}`);
  return { size, games };
}
function bracketLabel(g, games, elimination) {
  const wRounds = Math.max(...games.filter(x => x.section === 'W').map(x => x.round)) + 1;
  if (g.section === 'W') {
    const left = wRounds - g.round;
    if (elimination === 'double') return left === 1 ? 'Winners final' : `Winners round ${g.round + 1}`;
    return left === 1 ? 'Final' : left === 2 ? 'Semifinals' : left === 3 ? 'Quarterfinals' : `Round of ${2 ** left}`;
  }
  if (g.section === 'L') {
    const lRounds = Math.max(...games.filter(x => x.section === 'L').map(x => x.round)) + 1;
    return g.round === lRounds - 1 ? 'Losers final' : `Losers round ${g.round + 1}`;
  }
  return g.round === 0 ? 'Grand final' : 'Grand final, deciding game';
}

module.exports = { MODES, ROTATING, HEADSTARTS, rng, shuffle, pairKey, emptyHistory, addMatch, addSitting, buildRound, headstarts, premap, draftGames, snakeTeams, seedOrder, bracketGraph, bracketLabel };
