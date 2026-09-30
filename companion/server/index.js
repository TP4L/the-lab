'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { HttpError, STATUS, createRouter, readJson, send, serveStatic } = require('./http.js');
const { open } = require('./db.js');
const { createAuth } = require('./auth.js');
const { LANES } = require('./api/publishing.js');

const WEB_ROOT = path.join(__dirname, '..', 'web');

function createApp(opts = {}) {
  const db = opts.db || open(opts.file);
  const mediaDir = opts.mediaDir || path.join(path.dirname(opts.file && opts.file !== ':memory:' ? opts.file : path.join(__dirname, '..', 'data', 'x')), 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  const config = {
    adminEmail: opts.adminEmail || '',
    demo: !!opts.demo,
    googleClientId: opts.googleClientId || '',
    googleClientSecret: opts.googleClientSecret || '',
    googleEnabled: !!(opts.googleClientId && opts.googleClientSecret),
    fetchImpl: opts.fetchImpl || globalThis.fetch,
    trustProxy: !!opts.trustProxy,
    secureCookies: !!opts.secureCookies,
    publicUrl: (opts.publicUrl || '').replace(/\/$/, ''),
    stripeKey: opts.stripeKey || '',
    stripeWebhookSecret: opts.stripeWebhookSecret || '',
    stripePriceEssentials: opts.stripePriceEssentials || '',
    stripeIntegrationIdentifier: opts.stripeIntegrationIdentifier || 'the_lab_essentials',
    mediaDir,
    backupDir: opts.backupDir === undefined ? (opts.file && opts.file !== ':memory:' ? path.join(path.dirname(opts.file), 'backups') : null) : opts.backupDir,
    removeFiles: files => files.forEach(f => fs.rm(path.join(mediaDir, f), { force: true }, () => {}))
  };
  const mailer = opts.mailer || require('./mail.js').createMailer({ apiKey: opts.resendKey, from: opts.mailFrom });
  config.mailEnabled = mailer.enabled;
  // Reset links go by email when a provider is configured; tests can capture them.
  config.onResetLink = opts.onResetLink || ((email, link) => mailer.sendSoon({
    to: email, subject: 'Reset your THE LAB password',
    text: `Someone asked to reset the password for your THE LAB account.\n\nChoose a new password here (the link works once, for one hour):\n${link}\n\nIf this wasn't you, ignore this email.`,
    html: `<p>Someone asked to reset the password for your THE LAB account.</p><p><a href="${link}">Choose a new password</a>. The link works once, for one hour.</p><p>If this wasn't you, ignore this email.</p>`
  }));
  const auth = createAuth(db, { secureCookies: !!opts.secureCookies });
  const r = createRouter();
  const push = opts.push || require('./push.js').createPush(db, { publicKey: opts.vapidPublic, privateKey: opts.vapidPrivate, subject: opts.vapidSubject, fetchImpl: opts.fetchImpl });
  config.pushEnabled = push.enabled;
  const notifier = require('./api/notify.js').createNotifier(db, push);
  const ctx = { db, auth, config, notifier, mailer, push, stripeClient: opts.stripeClient };
  ctx.jobsFirst = key => Number(db.prepare('INSERT OR IGNORE INTO job_log (key) VALUES (?)').run(key).changes) === 1;
  const jobs = require('./jobs.js').createJobs(ctx);
  if (opts.jobs !== false) jobs.start();

  r.get('/api/health', () => ({ ok: true }));
  const { MODES } = require('./formats.js');
  const { SCORING, ROUND_END } = require('./api/play.js');
  const { KINDS } = require('./api/planning.js');
  r.get('/api/meta', () => ({ lanes: LANES, version: 4, google: !!config.googleEnabled, push: !!config.pushEnabled, email: !!config.mailEnabled, demo: !!config.demo, modes: MODES, scoring: SCORING, round_end: ROUND_END, interest_kinds: KINDS }));

  require('./api/account.js')(r, ctx);
  require('./api/site-bridge.js')(r, ctx);
  require('./api/site-signin.js')(r, ctx);
  require('./api/workspace.js')(r, ctx);
  require('./api/training.js')(r, ctx);
  require('./api/progress.js')(r, ctx);
  require('./api/athletes.js')(r, ctx);
  require('./api/timeline.js')(r, ctx);
  require('./api/publishing.js')(r, ctx);
  require('./api/play.js')(r, ctx);
  require('./api/learn.js')(r, ctx);
  require('./api/billing.js')(r, ctx);
  require('./api/coaching.js')(r, ctx);
  require('./api/development.js')(r, ctx);
  require('./api/planning.js')(r, ctx);
  require('./demo.js').routes(r, ctx);
  require('./api/notify.js').routes(r, ctx);

  /* Admin: list and download nightly backups (for an off-site copy). */
  r.get('/api/admin/backups', ({ user }) => {
    auth.require(user, 'admin');
    if (!config.backupDir || !fs.existsSync(config.backupDir)) return [];
    return fs.readdirSync(config.backupDir).filter(f => /^lab-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse()
      .map(f => ({ date: f.slice(4, 14), size: fs.statSync(path.join(config.backupDir, f)).size }));
  });
  r.get('/api/admin/backups/:date', ({ user, params, res }) => {
    auth.require(user, 'admin');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date) || !config.backupDir) throw new HttpError(404, 'Backup not found.');
    const file = path.join(config.backupDir, `lab-${params.date}.db`);
    if (!fs.existsSync(file)) throw new HttpError(404, 'Backup not found.');
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="lab-${params.date}.db"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
  r.get('/api/admin/status', ({ user }) => {
    auth.require(user, 'admin');
    return { email: config.mailEnabled, backups: !!config.backupDir, push: !!config.pushEnabled, google: !!config.googleEnabled };
  });

  /* Home tab: one round trip for the signed-in user's day. */
  r.get('/api/home', ({ user }) => {
    auth.require(user);
    const athleteId = auth.ownAthleteId(user);
    const athlete = athleteId ? db.prepare('SELECT id, name, focus, goals, plan FROM athletes WHERE id = ?').get(athleteId) : null;
    const sessions = db.prepare(`SELECT s.id, s.title, s.status, s.started_at FROM training_sessions s
      WHERE s.coach_id = ? OR EXISTS (SELECT 1 FROM training_athletes ta WHERE ta.session_id = s.id AND ta.athlete_id = ?)
      ORDER BY s.started_at DESC LIMIT 5`).all(user.id, athleteId || -1);
    const sharedNotes = athleteId ? db.prepare(`SELECT n.id, n.body, n.created_at, u.name AS author FROM notes n LEFT JOIN users u ON u.id = n.author_id
      WHERE n.athlete_id = ? AND n.visibility = 'shared' AND n.kind = 'coach' ORDER BY n.created_at DESC LIMIT 3`).all(athleteId) : [];
    const t = new Date().toISOString();
    const posts = db.prepare(`SELECT id, lane, title, slug, summary, thumbnail_media_id FROM posts
      WHERE status = 'published' OR (status = 'scheduled' AND publish_at <= ?) ORDER BY COALESCE(published_at, publish_at) DESC LIMIT 4`).all(t)
      .map(p => ({ ...p, lane_name: LANES[p.lane] }));
    const events = db.prepare(`SELECT e.id, e.title, e.starts_at, e.location, e.status, ep.state, ep.checked_in_at FROM events e
      JOIN event_people ep ON ep.event_id = e.id WHERE ep.athlete_id = ? AND ep.state IN ('registered','waitlist','interested')
      AND e.status IN ('published','live') ORDER BY e.starts_at LIMIT 5`).all(athleteId || -1);
    const open = db.prepare(`SELECT id, title, starts_at, location FROM events WHERE status = 'published' AND starts_at >= ? ORDER BY starts_at LIMIT 3`).all(t);
    const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(user.id).n;
    const toConfirm = athleteId ? db.prepare(`SELECT COUNT(*) AS n FROM matches m JOIN match_players mp ON mp.match_id = m.id
      WHERE mp.athlete_id = ? AND m.status = 'recorded' AND m.recorded_by != ?`).get(athleteId, user.id).n : 0;
    const out = { athlete, sessions, shared_notes: sharedNotes, posts, events, open_events: open, unread, to_confirm: toConfirm };
    if (auth.has(user, 'coach')) {
      out.coach = {
        athletes: user.roles.includes('admin') ? db.prepare('SELECT COUNT(*) AS n FROM athletes').get().n
          : db.prepare('SELECT COUNT(*) AS n FROM coach_athletes WHERE coach_id = ?').get(user.id).n,
        live: db.prepare("SELECT COUNT(*) AS n FROM training_sessions WHERE coach_id = ? AND status = 'live'").get(user.id).n
      };
    }
    if (auth.has(user, 'contributor', 'editor')) {
      out.studio = {
        drafts: db.prepare("SELECT COUNT(*) AS n FROM posts WHERE author_id = ? AND status = 'draft'").get(user.id).n,
        in_review: auth.has(user, 'editor') ? db.prepare("SELECT COUNT(*) AS n FROM posts WHERE status = 'in_review'").get().n : 0
      };
    }
    return out;
  });

  /* Cookie-authenticated writes must come from our own pages. SameSite=Lax already
     blocks cross-site form posts; this also rejects a foreign Origin outright. */
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  }

  async function handle(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, { error: 'Bad URL.' }); }
    const { pathname } = url;
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' });
      let assetPath;
      try { assetPath = path.posix.normalize(decodeURIComponent(pathname)); } catch { return send(res, 400, {error:'Bad path.'}); }
      if (assetPath === '/padel' || assetPath.startsWith('/padel/')) return send(res, 404, { error: 'This page is no longer hosted here.' });
      return serveStatic(WEB_ROOT, req, res, pathname);
    }
    try {
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      const hit = r.match(method, pathname);
      if (!hit.route) throw new HttpError(hit.pathHit ? 405 : 404, hit.pathHit ? 'Method not allowed.' : 'Not found.');
      const write = method !== 'GET';
      if (write && !sameOrigin(req)) throw new HttpError(403, 'Cross-site request blocked.');
      if (write && !hit.route.raw && req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined) {
        const ct = String(req.headers['content-type'] || '');
        if (!ct.startsWith('application/json')) throw new HttpError(415, 'Send JSON with Content-Type: application/json.');
      }
      const user = auth.currentUser(req);
      const body = write && !hit.route.raw ? await readJson(req) : {};
      const out = await hit.route.handler({ params: hit.params, body, query: url.searchParams, req, res, user });
      if (res.headersSent) return;
      return out && out[STATUS] ? send(res, out[STATUS], out.body) : send(res, 200, out);
    } catch (e) {
      if (res.headersSent) { res.destroy(); return; }
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.extra || {}) });
      console.error(e);
      return send(res, 500, { error: 'Something went wrong on the server.' });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  server.on('close', () => jobs.stop());
  return { server, db, config, jobs };
}

module.exports = { createApp };

if (require.main === module) {
  const port = Number(process.env.PORT) || 8787;
  // Demo mode: sample data in memory, fresh on every start, nothing sent out.
  const demo = process.env.DEMO_MODE === '1';
  const file = demo ? ':memory:' : process.env.LAB_DB || path.join(__dirname, '..', 'data', 'lab.db');
  if (!demo) fs.mkdirSync(path.dirname(file), { recursive: true });
  const { server } = createApp({
    file, demo,
    backupDir: demo ? null : undefined,
    mediaDir: demo ? fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'lab-demo-')) : process.env.LAB_MEDIA_DIR,
    adminEmail: demo ? require('./demo.js').DEMO_USERS.host.email : process.env.ADMIN_EMAIL || '',
    publicUrl: process.env.PUBLIC_URL || `http://localhost:${port}`,
    secureCookies: process.env.SECURE_COOKIES === '1',
    resendKey: demo ? '' : process.env.RESEND_API_KEY || '',
    mailFrom: process.env.MAIL_FROM || '',
    vapidPublic: demo ? '' : process.env.VAPID_PUBLIC_KEY || '',
    vapidPrivate: process.env.VAPID_PRIVATE_KEY || '',
    vapidSubject: process.env.VAPID_SUBJECT || '',
    googleClientId: demo ? '' : process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    stripeKey: demo ? '' : process.env.STRIPE_RESTRICTED_KEY || process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: demo ? '' : process.env.STRIPE_WEBHOOK_SECRET || '',
    stripePriceEssentials: demo ? '' : process.env.STRIPE_PRICE_ESSENTIALS || '',
    stripeIntegrationIdentifier: process.env.STRIPE_INTEGRATION_IDENTIFIER || 'the_lab_essentials',
    trustProxy: process.env.TRUST_PROXY === '1'
  });
  server.listen(port, () => {
    console.log(`THE LAB running at http://localhost:${port}${demo ? ' (demo)' : ''}`);
    if (!demo) return;
    require('./demo.js').seedDemo(`http://127.0.0.1:${port}`).then(() => console.log('Demo data ready.'), e => console.error('Demo seeding failed:', e));
    // Start fresh once a day; the host restarts the service.
    setTimeout(() => process.exit(0), 24 * 3600e3).unref();
  });
}
