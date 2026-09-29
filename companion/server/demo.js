'use strict';
/* Demo mode (DEMO_MODE=1): an in-memory copy of THE LAB filled with sample
   pickleball data, with one-tap sign-in as the host, a coach or a player.
   Everything goes through the public API, the same way the app does it, so
   the demo always matches real behaviour. Data resets when the server
   restarts, and the server restarts itself once a day. */
const crypto = require('node:crypto');

const DEMO_USERS = {
  host: { email: 'brett@demo.thelab', name: 'Brett (demo host)' },
  coach: { email: 'austin@demo.thelab', name: 'Austin (demo coach)' },
  player: { email: 'jordan@demo.thelab', name: 'Jordan Reyes' }
};

function routes(r, { db, auth, config }) {
  const { HttpError, oneOf } = require('./http.js');
  r.post('/api/demo/login', ({ body, res }) => {
    if (!config.demo) throw new HttpError(404, 'Not found.');
    const as = oneOf(body.as, Object.keys(DEMO_USERS), 'as');
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(DEMO_USERS[as].email);
    if (!u) throw new HttpError(503, 'The demo is still being set up. Try again in a few seconds.');
    const s = auth.startSession(u.id);
    res.setHeader('Set-Cookie', s.cookie);
    return { ok: true, as };
  });
}

function client(base) {
  let cookie = '';
  async function call(method, path, body) {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data && data.error}`);
    return data;
  }
  return { get: p => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b) => call('PUT', p, b) };
}

const at = (days, hour = 18, min = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, min, 0, 0); return d.toISOString(); };
const tok = link => link.split('/').pop();
const FIRST = ['Sam Ortiz', 'Maya Chen', 'Leo Brooks', 'Priya Nair', 'Dev Patel', 'Ava Kim', 'Noah Price', 'Zoe Hart', 'Eli Grant', 'Mia Lopez', 'Kai Turner', 'Ivy Walsh', 'Omar Haddad', 'Nina Park', 'Ben Cole', 'Tess Young', 'Raj Shah', 'Lila Fox', 'Cody Ross', 'June Bell', 'Owen Diaz', 'Ruby Lane', 'Theo Ward', 'Isla Reed'];

async function seedDemo(base) {
  const host = client(base), coach = client(base), player = client(base);
  const pw = crypto.randomBytes(18).toString('base64url');
  await host.post('/api/auth/signup', { name: DEMO_USERS.host.name, email: DEMO_USERS.host.email, password: pw });
  const austin = await coach.post('/api/auth/signup', { name: DEMO_USERS.coach.name, email: DEMO_USERS.coach.email, password: pw });
  await host.put(`/api/admin/users/${austin.user.id}/roles`, { roles: ['athlete', 'coach'] });
  await host.post('/api/me/athlete', {});

  /* ---------- roster, claiming, notes, training ---------- */
  const made = await host.post('/api/athletes', { name: 'Jordan Reyes', hand: 'right', side: 'left', rating: '3.5', claim_email: DEMO_USERS.player.email, focus: 'Third-shot drop depth', goals: '3.75 by spring', plan: 'Drops, then resets from the transition zone.' });
  await player.post('/api/auth/signup', { name: DEMO_USERS.player.name, email: DEMO_USERS.player.email, password: pw });
  await player.post('/api/claim', { code: made.claim_code });
  const jordan = made.athlete.id;
  const roster = [jordan];
  for (const [i, name] of FIRST.slice(0, 5).entries()) {
    const a = await host.post('/api/athletes', { name, rating: ['3.0', '3.5', '3.5', '4.0', '3.0'][i], side: i % 2 ? 'right' : 'left', focus: ['Kitchen line patience', 'Backhand dink', 'Serve depth', 'Speed-up defence', 'Footwork to the line'][i] });
    roster.push(a.athlete.id);
  }
  await host.post(`/api/athletes/${jordan}/notes`, { body: 'Drops are landing. Next: keep the paddle up after the drop so the reset is ready.', visibility: 'shared' });
  await host.post(`/api/athletes/${jordan}/notes`, { body: 'Tends to rush the kitchen after a short drop. Watch in games, not drills.', visibility: 'private' });
  await player.post(`/api/athletes/${jordan}/notes`, { body: 'Felt calmer at the line tonight. Dinks cross-court were solid.', visibility: 'shared' });
  const tpl = await host.post('/api/templates', { name: 'Kitchen line basics', items: [{ name: 'Cross-court dinks', measure: 'reps', target: 20 }, { name: 'Third-shot drops', measure: 'reps', target: 15 }, { name: 'Reset from transition', measure: 'feel' }] });
  await host.post(`/api/athletes/${jordan}/assignments`, { template_id: tpl.id, title: 'Kitchen line basics, twice this week', due_on: at(5).slice(0, 10), note: 'Twenty good dinks before moving on.' });
  const sid = crypto.randomUUID();
  await host.post('/api/training/sessions', { id: sid, title: 'Tuesday small group', athletes: roster.slice(0, 3), items: [{ name: 'Cross-court dinks', measure: 'reps', target: 20 }, { name: 'Third-shot drops', measure: 'reps', target: 15 }], started_at: at(-2, 18) });
  const evs = [];
  roster.slice(0, 3).forEach((aid, k) => { for (let i = 0; i < 24; i++) evs.push({ id: crypto.randomUUID(), item_idx: i % 2, athlete_id: aid, kind: (i + k) % 4 === 0 ? 'miss' : 'make', at: at(-2, 18, Math.min(59, i * 2)) }); });
  await host.post(`/api/training/sessions/${sid}/events`, { events: evs });
  const s = await host.get(`/api/training/sessions/${sid}`);
  await host.put(`/api/training/sessions/${sid}`, { version: s.version, status: 'complete' });

  /* ---------- matches and leaderboard ---------- */
  const pid = id => 'LAB-' + String(id).padStart(5, '0');
  for (const [i, g] of [[11, 7], [9, 11], [11, 5]].entries()) {
    const m = await player.post('/api/matches', { id: crypto.randomUUID(), kind: 'competition', game_to: 11, win_by: 2, best_of: 1, played_at: at(-6 + i, 19), teams: [[{ athlete_id: jordan }, { player_id: pid(roster[1]) }], [{ player_id: pid(roster[2 + i]) }, { player_id: pid(roster[3 + (i % 2)]) }]], games: [g] });
    await host.post(`/api/matches/${m.id}/verify`);
  }

  /* ---------- Field Notes and a course ---------- */
  const posts = [
    ['quick_read', 'Why the reset beats the drive', 'When you’re caught in transition, slow the ball down first.', 'You’re halfway to the kitchen and the ball is at your feet. Driving it feels brave. It usually isn’t.\n\nThe reset takes pace off, buys you a step, and puts the point back to neutral.\n\n- Soft hands, paddle out front\n- Aim for the kitchen, not the net tape\n- Take the step after the ball lands'],
    ['the_work', 'Twenty dinks, then play', 'A warm-up that transfers to games.', '## The drill\n\nTwenty cross-court dinks in a row before anyone speeds up. Miss, and the count starts again.\n\n## Why it works\n\nIt rewards patience, which is the skill most 3.5 players are missing in games.'],
    ['field_study', 'What we saw at Thursday Mixer', 'Notes from forty games of rotating doubles.', 'Most points were lost in the transition zone, not at the kitchen.\n\nTeams that reset first won the long rallies. Next month we drill it.']
  ];
  for (const [lane, title, summary, body] of posts) {
    const p = await host.post('/api/studio/posts', { lane, title, summary, body, tags: ['kitchen'], author_credit: 'Brett' });
    await host.post(`/api/studio/posts/${p.id}/publish`, {});
  }
  const course = await host.post('/api/studio/courses', { title: 'The Kitchen Line', summary: 'Three short lessons on patience at the net.', access: 'public' });
  for (const [i, [title, body]] of [['Ready position', 'Paddle up, weight forward, feet wide.'], ['Cross-court dinks', 'Longer path, more margin. Aim for the far corner of the kitchen.'], ['When to speed up', 'Only on a ball above the net that you can hit down.']].entries()) {
    await host.post(`/api/studio/courses/${course.id}/lessons`, { title, body, module: 'At the net', minutes: 4, preview: i === 0, position: i });
  }
  await host.put(`/api/studio/courses/${course.id}`, { status: 'published' });

  /* ---------- events ---------- */
  let names = FIRST.slice();
  const take = n => { const out = names.slice(0, n); names = names.slice(n).concat(out); return out; };
  // 1. A live Rivalry mixer on courts 4 and 5, round 2 in progress, timer ready.
  const riv = await host.post('/api/events', { title: 'Thursday Night Rivalry', starts_at: at(0, 18, 30), location: 'Riverside Courts', court_numbers: [4, 5], mode: 'rivalry', round_minutes: 12, description: 'Rotating partners, same rivals. Bring water.', capacity: 16, status: 'published' });
  await player.post(`/api/events/${riv.id}/register`);
  const anon = client(base);
  for (const [i, n] of take(8).entries()) await anon.post(`/api/public/events/${tok(riv.links.share)}/register`, { name: n, email: `guest${i}@demo.thelab` });
  let ev = await host.get(`/api/events/${riv.id}`);
  for (const p of ev.people) await host.post(`/api/events/${riv.id}/checkin`, { athlete_id: p.athlete_id });
  await host.post(`/api/events/${riv.id}/walkin`, { name: 'Walk-in Wes' });
  for (let rd = 1; rd <= 2; rd++) {
    // Draw until Jordan (the demo player) is on a court, so the player view has a match.
    for (let tries = 0; tries < 30; tries++) {
      const pv = await host.get(`/api/events/${riv.id}/rounds/preview`);
      if (pv.courts.some(c => c.teams.some(t => t.players.some(x => x.athlete_id === jordan)))) break;
    }
    ev = await host.post(`/api/events/${riv.id}/rounds`, { force: true });
    if (rd === 1) {
      const live = ev.rounds[ev.rounds.length - 1];
      for (const [k, m] of live.matches.entries()) {
        await host.put(`/api/matches/${m.id}`, { version: m.version, games: [k ? [8, 11] : [11, 6]] });
        const mm = await host.get(`/api/matches/${m.id}`);
        if (mm.status !== 'verified') await host.post(`/api/matches/${m.id}/verify`);
      }
    }
  }
  // 2. Fallout, double elimination, first round played.
  const fo = await host.post('/api/events', { title: 'Saturday Fallout', starts_at: at(0, 10), location: 'Main courts', court_numbers: [1, 2, 3], mode: 'fallout', elimination: 'double', status: 'published' });
  for (const n of take(12)) await host.post(`/api/events/${fo.id}/walkin`, { name: n });
  await host.post(`/api/events/${fo.id}/teams/auto`);
  await host.get(`/api/events/${fo.id}/bracket/preview?seeding=order`);
  ev = await host.post(`/api/events/${fo.id}/bracket`, {});
  for (const x of ev.bracket.rounds[0].slots.filter(y => y.match)) {
    const m = await host.get(`/api/matches/${x.match.id}`);
    await host.put(`/api/matches/${m.id}`, { version: m.version, games: [[11, 5 + x.pos]] });
  }
  // 3. Next week's Race to 50, open for sign-ups.
  const race = await host.post('/api/events', { title: 'Race to 50 Social', starts_at: at(7, 18), location: 'Riverside Courts', court_numbers: [1, 2], mode: 'race', race_target: 50, capacity: 12, description: 'Partners rotate; points add up. First to 50 wins.', status: 'published' });
  for (const [i, n] of take(7).entries()) await anon.post(`/api/public/events/${tok(race.links.share)}/register`, { name: n, email: `race${i}@demo.thelab` });
  // 4. 3v3 Team Draft, teams drafted, not started.
  const d3 = await host.post('/api/events', { title: '3v3 Team Draft Sunday', starts_at: at(3, 9), location: 'East courts', court_numbers: [1], mode: 'draft3', status: 'published' });
  for (const n of take(6)) await host.post(`/api/events/${d3.id}/walkin`, { name: n, checked_in: false });
  await host.post(`/api/events/${d3.id}/teams/auto`);

  /* ---------- Pending Interest and Team Planner ---------- */
  const ic = await host.post('/api/interest', { title: 'Tuesday 3.5 development group', kind: 'training', skill_level: '3.0–3.5', location: 'Riverside Courts', timing: 'Weeknights, 90 minutes', min_people: 6, max_people: 10, description: 'Six weeks on the transition zone.', options: [{ label: 'Tuesdays 6–7:30pm' }, { label: 'Thursdays 7–8:30pm' }] });
  const pub = await anon.get(`/api/public/interest/${tok(ic.link)}`);
  for (const [i, n] of take(5).entries()) await anon.post(`/api/public/interest/${tok(ic.link)}/respond`, { name: n, email: `int${i}@demo.thelab`, status: i === 3 ? 'maybe' : 'interested', option_ids: [pub.options[i % 2].id], notes: i === 0 ? 'Evenings only' : '' });
  const plan = await host.post('/api/plans', {
    title: 'Saturday small-group clinic', starts_at: at(2, 9), ends_at: at(2, 11), location: 'Main courts', coaches: 'Brett, Austin', capacity: 8, status: 'draft',
    message: 'Bring water and a second paddle if you have one.', agenda: 'Warm-up, kitchen line, transition resets, games.', handoff: 'Jordan: rushes the line after short drops. Sam: backhand dink grip.',
    blocks: [{ start_time: '09:00', end_time: '09:30', court: '1', lead: 'Brett', drill: 'Dink ladder', instructions: 'Cross-court only' }, { start_time: '09:30', end_time: '10:15', court: '2', lead: 'Austin', drill: 'Third-shot drops', instructions: 'Feed from the baseline' }, { start_time: '10:15', end_time: '11:00', court: '1', lead: 'Brett', drill: 'King of the court' }],
    players: [{ athlete_id: jordan, court: '1' }, ...take(5).map((n, i) => ({ name: n, email: `plan${i}@demo.thelab`, court: String(1 + (i % 2)) }))]
  });
  const inv = await host.post(`/api/plans/${plan.id}/invite`);
  for (const [i, x] of inv.plan.players.entries()) if (i < 5) await anon.post(`/api/i/${tok(x.link)}/rsvp`, { rsvp: i === 3 ? 'maybe' : 'in' });
  const jx = inv.plan.players.find(x => x.athlete_id === jordan);
  await host.put(`/api/plans/${plan.id}/players/${jx.id}`, { recap_observation: 'Paddle drops after the dink.', recap_cue: 'Paddle up, ready.', recap_next: '50 cross-court dinks, paddle up the whole time.' });
  await host.post(`/api/plans/${plan.id}/players/${jx.id}/recap`, { publish: true });
}

module.exports = { routes, seedDemo, DEMO_USERS };
