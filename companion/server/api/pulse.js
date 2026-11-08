'use strict';
/* Business pulse: the weekly read on the coaching business for the coach who
   runs it. Active and lapsing clients, revenue, credits outstanding, event
   fill, assessment cadence, and a "reach out" list built from the data. */
const { now } = require('../db');

module.exports = function (r, ctx) {
  const { db, auth } = ctx;
  const money = c => '$' + (c / 100).toFixed(c % 100 ? 2 : 0);
  const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();
  const weekStart = (offset) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - offset * 7); return d.toISOString(); };

  r.get('/api/coach/pulse', ({ user }) => {
    auth.require(user, 'coach');
    const mine = db.prepare('SELECT id, name, user_id, created_at FROM athletes ORDER BY name').all().filter(a => auth.coachesAthlete(user, a.id));
    const ids = new Set(mine.map(a => a.id));
    if (!ids.size) return { empty: true, athletes: 0 };
    const t30 = daysAgo(30), t90 = daysAgo(90), t60 = daysAgo(60), t45 = daysAgo(45), t21 = daysAgo(21), n = now();

    // Last activity per athlete across sessions, notes, ratings, redeemed credits, check-ins.
    const last = new Map();
    const bump = (aid, at) => { if (!ids.has(aid) || !at) return; if (!last.has(aid) || last.get(aid) < at) last.set(aid, at); };
    db.prepare("SELECT ta.athlete_id, MAX(s.started_at) AS at FROM training_sessions s JOIN training_athletes ta ON ta.session_id=s.id GROUP BY ta.athlete_id").all().forEach(x => bump(x.athlete_id, x.at));
    db.prepare('SELECT athlete_id, MAX(created_at) AS at FROM notes GROUP BY athlete_id').all().forEach(x => bump(x.athlete_id, x.at));
    db.prepare('SELECT athlete_id, MAX(created_at) AS at FROM skill_ratings GROUP BY athlete_id').all().forEach(x => bump(x.athlete_id, x.at));
    db.prepare("SELECT athlete_id, MAX(created_at) AS at FROM credit_ledger WHERE ref_type='session' GROUP BY athlete_id").all().forEach(x => bump(x.athlete_id, x.at));
    db.prepare('SELECT athlete_id, MAX(created_at) AS at FROM pre_session_checkins GROUP BY athlete_id').all().forEach(x => bump(x.athlete_id, x.at));
    db.prepare("SELECT athlete_id, MAX(created_at) AS at FROM event_people WHERE state IN ('registered','waitlist') GROUP BY athlete_id").all().forEach(x => bump(x.athlete_id, x.at));

    const active = mine.filter(a => (last.get(a.id) || '') >= t30);
    const lapsing = mine.filter(a => { const l = last.get(a.id) || ''; return l && l < t30 && l >= t90; });
    const dormant = mine.filter(a => { const l = last.get(a.id) || ''; return !l || l < t90; });
    const newClients = mine.filter(a => a.created_at >= t30);

    // Revenue: this 30 days vs previous 30; weekly series for 8 weeks.
    const paid = db.prepare("SELECT o.athlete_id, o.amount_cents, o.paid_at, o.source FROM orders o WHERE o.status='paid' AND o.paid_at >= ?").all(daysAgo(70)).filter(o => !o.athlete_id || ids.has(o.athlete_id) || auth.has(user, 'admin'));
    const rev30 = paid.filter(o => o.paid_at >= t30).reduce((s, o) => s + o.amount_cents, 0);
    const revPrev = paid.filter(o => o.paid_at < t30 && o.paid_at >= t60).reduce((s, o) => s + o.amount_cents, 0);
    const weeks = [];
    for (let w = 7; w >= 0; w--) {
      const from = weekStart(w), to = weekStart(w - 1);
      const sess = db.prepare("SELECT COUNT(DISTINCT s.id) AS n FROM training_sessions s JOIN training_athletes ta ON ta.session_id=s.id WHERE s.started_at >= ? AND s.started_at < ?").get(from, to).n;
      const rev = paid.filter(o => o.paid_at >= from && o.paid_at < to).reduce((s, o) => s + o.amount_cents, 0);
      const credits = db.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE ref_type='session' AND created_at >= ? AND created_at < ?").get(from, to).n;
      weeks.push({ from: from.slice(0, 10), sessions: sess, revenue_cents: rev, credits_used: credits });
    }

    // Credits: outstanding liability, expiring soon, athletes out of credits who trained recently.
    const balances = db.prepare('SELECT athlete_id, SUM(delta) AS n FROM credit_ledger WHERE expires_at IS NULL OR expires_at > ? OR delta < 0 GROUP BY athlete_id').all(n).filter(x => ids.has(x.athlete_id));
    const outstanding = balances.reduce((s, x) => s + Math.max(0, x.n), 0);
    const expiring = db.prepare('SELECT athlete_id, SUM(delta) AS n, MIN(expires_at) AS e FROM credit_ledger WHERE delta > 0 AND expires_at > ? AND expires_at <= ? GROUP BY athlete_id').all(n, daysAgo(-30)).filter(x => ids.has(x.athlete_id));
    const balanceOf = new Map(balances.map(x => [x.athlete_id, Math.max(0, x.n)]));
    const everBought = new Set(db.prepare("SELECT DISTINCT athlete_id FROM credit_ledger WHERE ref_type='purchase'").all().map(x => x.athlete_id));
    const outOfCredits = active.filter(a => everBought.has(a.id) && !(balanceOf.get(a.id) > 0));

    // Memberships
    const members = db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE status='active' AND (expires_at IS NULL OR expires_at > ?)").get(n).n;

    // Events: upcoming fill
    const events = db.prepare("SELECT e.id, e.title, e.starts_at, e.capacity, e.status, (SELECT COUNT(*) FROM event_people p WHERE p.event_id=e.id AND p.state='registered') AS registered, (SELECT COUNT(*) FROM event_people p WHERE p.event_id=e.id AND p.state='waitlist') AS waitlist FROM events e WHERE e.status IN ('published','live') AND e.starts_at >= ? ORDER BY e.starts_at LIMIT 8").all(daysAgo(1))
      .map(e => ({ id: e.id, title: e.title, starts_at: e.starts_at, capacity: e.capacity, registered: e.registered, waitlist: e.waitlist, fill: e.capacity ? Math.round(e.registered / e.capacity * 100) : null, status: e.status }));

    // Assessment cadence
    const lastRated = new Map(db.prepare('SELECT athlete_id, MAX(rated_on) AS d FROM skill_ratings GROUP BY athlete_id').all().map(x => [x.athlete_id, x.d]));
    const dueAssessment = active.filter(a => { const d = lastRated.get(a.id); return !d || d < t45.slice(0, 10); });

    // Review queue size
    const unreviewed = db.prepare("SELECT athlete_id, COUNT(*) AS c FROM notes WHERE kind='reflection' AND reviewed_at IS NULL GROUP BY athlete_id").all().filter(x => ids.has(x.athlete_id));

    // Reach out: one list, reasons attached, ordered by urgency.
    const reach = [];
    const add = (a, reason, weight, link) => { const cur = reach.find(x => x.id === a.id); if (cur) { cur.reasons.push(reason); cur.weight += weight; } else reach.push({ id: a.id, name: a.name, reasons: [reason], weight, link: link || '#/coach/' + a.id + '/thread', last: last.get(a.id) || '' }); };
    for (const a of outOfCredits) add(a, 'Out of credits and still training', 5, '#/coach/' + a.id + '/credits');
    for (const x of unreviewed) { const a = mine.find(m => m.id === x.athlete_id); if (a) add(a, x.c + ' message' + (x.c === 1 ? '' : 's') + ' waiting', 4); }
    for (const a of lapsing) add(a, 'No activity in ' + Math.round((Date.now() - new Date(last.get(a.id)).getTime()) / 86400000) + ' days', 3);
    for (const x of expiring) { const a = mine.find(m => m.id === x.athlete_id); if (a) add(a, x.n + ' credit' + (x.n === 1 ? '' : 's') + ' expiring ' + x.e.slice(0, 10), 3, '#/coach/' + a.id + '/credits'); }
    for (const a of dueAssessment) add(a, lastRated.get(a.id) ? 'Last assessed ' + lastRated.get(a.id) : 'Never assessed', 2, '#/coach/' + a.id + '/skills/rate');
    for (const a of newClients) add(a, 'New this month', 1);
    reach.sort((x, y) => y.weight - x.weight || String(x.last).localeCompare(String(y.last)));

    return {
      checked_at: n,
      clients: { total: mine.length, active: active.length, lapsing: lapsing.length, dormant: dormant.length, new_30d: newClients.length, members },
      revenue: { last_30_cents: rev30, last_30: money(rev30), prev_30_cents: revPrev, prev_30: money(revPrev), change_pct: revPrev ? Math.round((rev30 - revPrev) / revPrev * 100) : null, by_source: Object.entries(paid.filter(o => o.paid_at >= t30).reduce((m, o) => { m[o.source] = (m[o.source] || 0) + o.amount_cents; return m; }, {})).map(([k, v]) => ({ source: k, amount: money(v), cents: v })) },
      credits: { outstanding, expiring_30d: expiring.reduce((s, x) => s + x.n, 0), athletes_out: outOfCredits.length },
      sessions: { this_week: weeks[weeks.length - 1].sessions, last_week: weeks[weeks.length - 2].sessions, last_30: db.prepare("SELECT COUNT(*) AS n FROM training_sessions WHERE started_at >= ?").get(t30).n },
      assessments: { due: dueAssessment.length, last_30: db.prepare('SELECT COUNT(DISTINCT athlete_id || rated_on) AS n FROM skill_ratings WHERE created_at >= ?').get(t30).n },
      weeks, events, reach: reach.slice(0, 12)
    };
  });
};
