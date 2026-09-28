/* THE LAB app: views and routing. Depends on lib.js (Lab) and engine.js (LabEngine). */
(function () {
  'use strict';
  var L = window.Lab, E = window.LabEngine;
  var h = L.h, $ = L.$, $$ = L.$$, api = L.api, Store = L.Store;
  var app = $('#app');
  var ME = Store.get('me', null); // { user, athlete_id }

  var LANES = { quick_read: 'Quick Read', the_work: 'The Work', field_study: 'Field Study' };
  var MEASURES = { reps: 'Make / miss', score: 'Score', time: 'Time', feel: 'Feel 1–5' };
  var HANDS = { right: 'Right', left: 'Left' };
  var SIDES = { left: 'Left side', right: 'Right side', either: 'Either side' };

  function has() {
    if (!ME) return false;
    var roles = ME.user.roles;
    if (roles.indexOf('admin') >= 0) return true;
    for (var i = 0; i < arguments.length; i++) if (roles.indexOf(arguments[i]) >= 0) return true;
    return false;
  }
  function setMe(m) { ME = m; if (m) Store.set('me', m); else Store.del('me'); }
  function initials(name) { return String(name || '?').split(/\s+/).map(function (p) { return p[0]; }).join('').slice(0, 2).toUpperCase(); }
  function avatar(a, cls) {
    return '<span class="avatar' + (cls ? ' ' + cls : '') + '">' + (a && a.photo_media_id ? '<img alt="" src="/api/media/' + h(a.photo_media_id) + '">' : h(initials(a && a.name))) + '</span>';
  }
  function playerId(id) { return 'LAB-' + ('00000' + id).slice(-5); }
  function offlineNote(d) { return d && d._offline ? '<p class="offline-note">Offline · showing what this device saved ' + h(L.when(new Date(d._offline).toISOString())) + '</p>' : ''; }
  function head(eyebrow, title, sub, side) {
    return '<div class="head-row"><div class="head">' + (eyebrow ? '<p class="eyebrow">' + h(eyebrow) + '</p>' : '') + '<h1>' + h(title) + '</h1>' + (sub ? '<p>' + h(sub) + '</p>' : '') + '</div>' + (side || '') + '</div>';
  }
  function needsNet(what) { return '<div class="coming"><p class="eyebrow">Needs a connection</p><p>' + h(what) + ' isn’t available offline. Anything you’ve recorded is saved on this device and will sync when you’re back online.</p></div>'; }

  /* ================= sync pill ================= */
  L.on('status', function (s) { var el = $('#sync'); el.className = 'sync ' + s.cls; el.textContent = s.text; });
  $('#sync').addEventListener('click', function () { location.hash = '#/sync'; });
  L.on('signedout', function () { if (ME) { setMe(null); if (!isPublic()) location.hash = '#/signin'; } });

  /* A session "complete" that raced another device: status is safe to reapply on the latest version. */
  L.on('synced', function (d) {
    var e = d.entry;
    if (d.error && d.error.status === 409 && e.method === 'PUT' && /\/api\/training\/sessions\//.test(e.path) && d.error.data.current) {
      var body = Object.assign({}, e.body, { version: d.error.data.current.version });
      delete body.items;
      L.queue({ method: 'PUT', path: e.path, body: body, label: e.label });
      var f = Store.get('failed', []); f.pop(); Store.set('failed', f);
    }
    if (!d.error && e.method === 'PUT' && /\/api\/training\/sessions\//.test(e.path) && d.result) {
      var local = Store.get('session:' + d.result.id);
      if (local) { local.version = d.result.version; Store.set('session:' + d.result.id, local); }
    }
  });

  /* ================= auth views ================= */
  var views = {};

  views.signin = function (_, query) {
    app.innerHTML = '<div class="auth-wrap"><p class="brandmark">THE <span>LAB</span></p><p class="muted">Know what to work on, do the work, record what happened, know what comes next.</p>' +
      (query && query.error ? '<p class="flag" role="alert"><b>Couldn\u2019t sign in.</b> ' + h(query.error) + '</p>' : '') +
      '<a class="btn google" href="/api/auth/google/start" id="gbtn" hidden>Continue with Google</a>' +
      '<form class="card form" id="f" novalidate><p class="section-title">Sign in</p>' +
      '<div class="field"><label class="flabel" for="em">Email</label><input type="email" id="em" autocomplete="email" required></div>' +
      '<div class="field"><label class="flabel" for="pw">Password</label><input type="password" id="pw" autocomplete="current-password" required></div>' +
      '<div class="row"><button class="btn primary" type="submit">Sign in</button><a class="link-btn" href="#/forgot">Forgot password?</a></div></form>' +
      '<p class="small">New to THE LAB? <a href="#/signup">Create an account</a>. If your coach gave you a claim code, create your account first, then add the code on your Profile.</p>' +
      '<p class="small"><a href="#/learn">Read Field Notes without signing in →</a></p></div>';
    $('#f').addEventListener('submit', function (e) {
      e.preventDefault();
      api.request('POST', '/api/auth/login', { email: $('#em').value, password: $('#pw').value })
        .then(function (m) { setMe(m); location.hash = '#/'; }, function (err) { L.formError($('#f'), err.status === 0 ? 'You’re offline. Sign in needs a connection.' : err.message); });
    });
    if (META.google) $('#gbtn').hidden = false;
    $('#em').focus();
  };

  views.signup = function () {
    app.innerHTML = '<div class="auth-wrap"><p class="brandmark">THE <span>LAB</span></p>' +
      '<form class="card form" id="f" novalidate><p class="section-title">Create your account</p>' +
      '<div class="field"><label class="flabel" for="nm">Full name</label><input type="text" id="nm" autocomplete="name" maxlength="80" required></div>' +
      '<div class="field"><label class="flabel" for="em">Email</label><input type="email" id="em" autocomplete="email" required><p class="small muted">Use the email your coach has, so your profile and history connect.</p></div>' +
      '<div class="field"><label class="flabel" for="pw">Password <span class="hint">10+ characters</span></label><input type="password" id="pw" autocomplete="new-password" minlength="10" required></div>' +
      '<div class="row"><button class="btn primary" type="submit">Create account</button></div></form>' +
      '<p class="small">Already have an account? <a href="#/signin">Sign in</a>.</p></div>';
    $('#f').addEventListener('submit', function (e) {
      e.preventDefault();
      api.request('POST', '/api/auth/signup', { name: $('#nm').value, email: $('#em').value, password: $('#pw').value })
        .then(function (m) { setMe(m); L.toast('Welcome to THE LAB'); location.hash = '#/profile'; }, function (err) { L.formError($('#f'), err.message); });
    });
  };

  views.forgot = function () {
    app.innerHTML = '<div class="auth-wrap"><a class="back" href="#/signin">← Sign in</a>' + head('Account recovery', 'Reset your password', 'We’ll send a reset link to your email. It works for one hour.') +
      '<form class="card form" id="f" novalidate><div class="field"><label class="flabel" for="em">Email</label><input type="email" id="em" autocomplete="email" required></div>' +
      '<div class="row"><button class="btn primary" type="submit">Send reset link</button></div></form>' +
      '<p class="small muted">No email? Your club admin can issue a reset link from the Admin screen.</p></div>';
    $('#f').addEventListener('submit', function (e) {
      e.preventDefault();
      api.request('POST', '/api/auth/reset/request', { email: $('#em').value }).then(function () {
        $('#f').innerHTML = '<p>If an account uses that email, a reset link is on its way. Check your inbox and spam folder.</p>';
      }, function (err) { L.formError($('#f'), err.message); });
    });
  };

  views.reset = function (token) {
    app.innerHTML = '<div class="auth-wrap">' + head('Account recovery', 'Choose a new password') +
      '<form class="card form" id="f" novalidate><div class="field"><label class="flabel" for="pw">New password <span class="hint">10+ characters</span></label><input type="password" id="pw" autocomplete="new-password" required></div>' +
      '<div class="row"><button class="btn primary" type="submit">Save password</button></div></form></div>';
    $('#f').addEventListener('submit', function (e) {
      e.preventDefault();
      api.request('POST', '/api/auth/reset/confirm', { token: token, password: $('#pw').value })
        .then(function (m) { setMe(m); L.toast('Password saved. You’re signed in.'); location.hash = '#/'; }, function (err) { L.formError($('#f'), err.message); });
    });
  };

  /* ================= home ================= */
  views.home = function () {
    return api.get('/api/home').then(function (d) {
      var a = d.athlete, live = d.sessions.filter(function (s) { return s.status === 'live'; })[0];
      var hour = new Date().getHours();
      var hi = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      var staffTiles = '';
      if (has('coach')) staffTiles += '<a href="#/coach"><b>Coach Workspace</b><span>' + d.coach.athletes + ' athletes · ' + d.coach.live + ' live session' + (d.coach.live === 1 ? '' : 's') + '</span></a>';
      if (has('contributor', 'editor')) staffTiles += '<a href="#/studio"><b>Publishing Studio</b><span>' + d.studio.drafts + ' draft' + (d.studio.drafts === 1 ? '' : 's') + (has('editor') ? ' · ' + d.studio.in_review + ' to review' : '') + '</span></a>';
      if (has('admin')) staffTiles += '<a href="#/admin"><b>Admin</b><span>People and permissions</span></a>';

      app.innerHTML = offlineNote(d) +
        '<div class="head"><p class="eyebrow">' + h(hi) + '</p><h1>' + h(ME.user.name.split(' ')[0]) + '</h1></div>' +
        (staffTiles ? '<div class="staff">' + staffTiles + '</div>' : '') +
        (d.to_confirm ? '<div class="banner"><span>' + d.to_confirm + ' match score' + (d.to_confirm > 1 ? 's need' : ' needs') + ' your confirmation.</span><a class="btn sm primary" href="#/play">Review</a></div>' : '') +
        (a ? '<div class="focus-card"><p class="eyebrow">Current focus</p><p class="big">' + h(a.focus || 'No focus set yet') + '</p>' + (a.goals ? '<p class="small" style="opacity:.8">Goal: ' + h(a.goals) + '</p>' : '') + '</div>'
          : '<div class="banner"><span>Connect your athlete profile to see your focus, notes and results.</span><a class="btn sm primary" href="#/profile">Set up profile</a></div>') +
        '<div class="stack"><p class="section-title">Quick actions</p><div class="quick">' +
        (has('coach') ? '<a href="#/train/new">Start a session</a><a href="#/train/new?quick=1">Make / miss counter</a>' : '') +
        (a ? '<a href="#/profile#reflect">Add a reflection</a>' : '') +
        (has('contributor', 'editor') ? '<a href="#/studio/new">Write a post</a>' : '') +
        '<a href="#/play/match/new">Record a match</a><a href="#/learn">Field Notes</a></div></div>' +
        '<div class="grid-2">' +
        '<div class="stack"><p class="section-title">' + (live ? 'Live now' : 'Recent sessions') + '</p>' + (d.sessions.length ? '<div class="list">' + d.sessions.map(function (s) {
          return '<a class="li" href="#/train/' + h(s.id) + (s.status === 'live' && has('coach') ? '/live' : '') + '"><span class="main-col"><span class="t">' + h(s.title) + '</span><span class="d">' + h(L.when(s.started_at)) + '</span></span><span class="side"><span class="tag' + (s.status === 'live' ? ' call' : '') + '">' + (s.status === 'live' ? 'Live' : 'Done') + '</span></span></a>';
        }).join('') + '</div>' : '<div class="list"><p class="empty">No sessions yet.' + (has('coach') ? ' <a href="#/train/new">Start one</a>.' : ' They’ll appear here after your coach records one.') + '</p></div>') + '</div>' +
        '<div class="stack"><p class="section-title">From your coach</p>' + (d.shared_notes.length ? '<div class="list">' + d.shared_notes.map(function (n) {
          return '<div class="note"><p class="body">' + h(n.body) + '</p><p class="meta"><span class="vis shared">Shared with you</span><span>' + h(n.author || 'Coach') + '</span><span>' + h(L.when(n.created_at)) + '</span></p></div>';
        }).join('') + '</div>' : '<div class="list"><p class="empty">Nothing shared yet.</p></div>') + '</div>' +
        '</div>' +
        '<div class="stack"><p class="section-title">Upcoming events</p>' + ((d.events.length || d.open_events.length) ? '<div class="list">' +
          d.events.map(function (e) { return eventRow({ id: e.id, title: e.title, starts_at: e.starts_at, location: e.location, status: e.status, my_state: e.state }); }).join('') +
          d.open_events.filter(function (o) { return !d.events.some(function (e) { return e.id === o.id; }); }).map(function (e) { return eventRow(Object.assign({ status: 'published' }, e)); }).join('') + '</div>'
          : '<div class="list"><p class="empty">No upcoming events. <a href="#/play/events">Browse events</a>.</p></div>') + '</div>' +
        '<div class="stack" id="assignedHome"></div><div class="stack" id="learning"></div>' +
        '<div class="stack"><p class="section-title">New in Field Notes</p>' + postList(d.posts) + '</div>';
      if (ME.athlete_id) api.get('/api/me/assignments').then(function (as) {
        var open = as.filter(function (a) { return a.status === 'open'; });
        if (open.length && $('#assignedHome')) { $('#assignedHome').innerHTML = '<p class="section-title">Assigned to you</p>' + assignmentList(open, false); bindAssignments($('#assignedHome')); }
      }, function () {});
      api.get('/api/me/learning').then(function (lr) {
        var going = lr.courses.filter(function (c) { return c.completed < c.lessons; });
        if (going.length && $('#learning')) $('#learning').innerHTML = '<p class="section-title">Continue learning</p><div class="course-grid">' + going.slice(0, 2).map(courseCard).join('') + '</div>';
      }, function () {});
    });
  };

  function postList(posts) {
    if (!posts.length) return '<div class="list"><p class="empty">Nothing published yet.</p></div>';
    return '<div class="list">' + posts.map(function (p) {
      return '<a class="post-card" href="#/learn/' + h(p.slug) + '"><div><p class="lane">' + h(p.lane_name || LANES[p.lane]) + '</p><p class="t">' + h(p.title) + '</p>' + (p.summary ? '<p class="d">' + h(p.summary) + '</p>' : '') + '</div>' +
        '<div class="thumb">' + (p.thumbnail_media_id ? '<img alt="" loading="lazy" src="/api/media/' + h(p.thumbnail_media_id) + '">' : '') + '</div></a>';
    }).join('') + '</div>';
  }

  /* ================= TRAIN ================= */
  function summarize(items, athleteIds, events) {
    var undone = {}; events.forEach(function (e) { if (e.kind === 'undo' && e.undoes) undone[e.undoes] = true; });
    var cells = {};
    items.forEach(function (it) { athleteIds.forEach(function (aid) { cells[it.idx + ':' + aid] = { item_idx: it.idx, athlete_id: aid, makes: 0, misses: 0, values: [] }; }); });
    events.slice().sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; }).forEach(function (e) {
      if (e.kind === 'undo' || undone[e.id]) return;
      var c = cells[e.item_idx + ':' + e.athlete_id]; if (!c) return;
      if (e.kind === 'make') c.makes++; else if (e.kind === 'miss') c.misses++; else if (e.kind === 'value') c.values.push(e.value);
    });
    Object.keys(cells).forEach(function (k) {
      var c = cells[k], v = c.values; c.attempts = c.makes + c.misses;
      c.pct = c.attempts ? Math.round(c.makes / c.attempts * 100) : null;
      c.last = v.length ? v[v.length - 1] : null; c.best = v.length ? Math.max.apply(null, v) : null;
      c.avg = v.length ? Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length * 10) / 10 : null;
    });
    return cells;
  }
  function cellText(it, c) {
    if (!c) return '—';
    if (it.measure === 'reps') return c.attempts ? c.makes + '/' + c.attempts + ' (' + c.pct + '%)' : '—';
    if (!c.values.length) return '—';
    if (it.measure === 'time') return fmtTime(c.best) + ' best';
    if (it.measure === 'feel') return c.last + '/5';
    return c.best + ' best · ' + c.values.length + ' entr' + (c.values.length === 1 ? 'y' : 'ies');
  }
  function fmtTime(s) { s = Math.round(s * 10) / 10; var m = Math.floor(s / 60); return (m ? m + ':' + ('0' + (s % 60).toFixed(1)).slice(-4) : s.toFixed(1) + 's'); }

  function localSessions() {
    return Store.keys('session:').map(function (k) { return Store.get(k); }).filter(Boolean);
  }

  views.train = function () {
    var coach = has('coach');
    return api.get('/api/training/sessions').then(null, function (err) { if (err.status === 0) return []; throw err; }).then(function (rows) {
      var byId = {}; rows.forEach(function (r) { byId[r.id] = r; });
      localSessions().forEach(function (s) { if (!byId[s.id]) rows.unshift({ id: s.id, title: s.title, status: s.status, started_at: s.started_at, athlete_names: s.athletes.map(function (a) { return a.name; }).join(', '), local: true }); });
      var live = rows.filter(function (r) { return r.status === 'live'; });
      var done = rows.filter(function (r) { return r.status !== 'live'; });
      function row(s) {
        var href = '#/train/' + h(s.id) + (s.status === 'live' && coach ? '/live' : '');
        return '<a class="li" href="' + href + '"><span class="main-col"><span class="t">' + h(s.title) + '</span><span class="d">' + h(s.athlete_names || '') + ' · ' + h(L.when(s.started_at)) + '</span></span><span class="side">' +
          (s.local ? '<span class="status local">On device</span>' : '') + '<span class="tag' + (s.status === 'live' ? ' call' : '') + '">' + (s.status === 'live' ? 'Live' : 'Done') + '</span></span></a>';
      }
      app.innerHTML = offlineNote(rows) +
        head('Train', coach ? 'Sessions' : 'Your training', coach ? 'Run a session courtside. Scores save on this device first and sync when there’s signal.' : 'Every session your coach records against you.',
          '<div class="row">' + (coach ? '<a class="btn ghost" href="#/coach/templates">Templates</a>' : '') + '<a class="btn" href="#/train/scoreboard">Scoreboard</a>' + (coach ? '<a class="btn" href="#/train/new?quick=1">Counter</a><a class="btn primary" href="#/train/new">New session</a>' : '') + '</div>') +
        (boards().length ? '<div class="stack"><p class="section-title">Scoreboards on this device</p><div class="list">' + boards().slice(0, 5).map(function (bd) {
          return '<a class="li" href="#/train/scoreboard/' + h(bd.id) + '"><span class="main-col"><span class="t small">' + h(bd.name) + '</span><span class="d mono">' + (bd.done ? 'Final' : 'Game ' + (bd.games.length + 1) + ' \u00b7 ' + bd.cur.scores.join('\u2013')) + '</span></span><span class="side">' + h(L.when(new Date(bd.updated).toISOString())) + '</span></a>';
        }).join('') + '</div></div>' : '') +
        '<div class="stack" id="assigned"></div>' +
        (live.length ? '<div class="stack"><p class="section-title">Live</p><div class="list">' + live.map(row).join('') + '</div></div>' : '') +
        '<div class="stack"><p class="section-title">History</p>' + (done.length ? '<div class="list">' + done.map(row).join('') + '</div>' : '<div class="list"><p class="empty">No completed sessions yet.</p></div>') + '</div>';
      if (ME.athlete_id) api.get('/api/me/assignments').then(function (as) {
        if (!as.length || !$('#assigned')) return;
        $('#assigned').innerHTML = '<p class="section-title">Assigned to you</p>' + assignmentList(as, false);
        bindAssignments($('#assigned'));
      }, function () {});
    });
  };
  function assignmentList(as, coachView, athleteId) {
    return '<div class="list">' + as.map(function (a) {
      return '<div class="li"><span class="who"><span class="lesson-dot' + (a.status === 'done' ? ' done' : '') + '" aria-hidden="true">' + (a.status === 'done' ? '✓' : '') + '</span><span class="main-col"><span class="t small">' + h(a.title) + '</span><span class="d">' +
        (a.due_on ? 'Due ' + h(new Date(a.due_on + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + ' · ' : '') + (a.template_items ? a.template_items.length + ' drills' : '') + (a.coach ? ' · ' + h(a.coach) : '') + (a.note ? ' · ' + h(a.note) : '') + '</span></span></span>' +
        '<span class="side row">' + (a.session_id ? '<a class="btn sm ghost" href="#/train/' + h(a.session_id) + '">Session</a>' : '') +
        (coachView && a.status === 'open' ? '<a class="btn sm primary" href="#/train/new?athlete=' + athleteId + '&assignment=' + a.id + '">Run now</a>' : '') +
        '<button class="btn sm ghost" type="button" data-asg="' + a.id + '" data-to="' + (a.status === 'done' ? 'open' : 'done') + '">' + (a.status === 'done' ? 'Reopen' : 'Mark done') + '</button>' +
        (coachView ? '<button class="btn sm ghost" type="button" data-asgdel="' + a.id + '" aria-label="Remove assignment">✕</button>' : '') + '</span></div>';
    }).join('') + '</div>';
  }
  function bindAssignments(root) {
    $$('[data-asg]', root).forEach(function (b) { b.addEventListener('click', function () {
      api.request('PUT', '/api/assignments/' + b.getAttribute('data-asg'), { status: b.getAttribute('data-to') }).then(route, function (err) { L.toast(err.message); });
    }); });
    $$('[data-asgdel]', root).forEach(function (b) { L.armed(b, 'Remove?', function () { api.request('DELETE', '/api/assignments/' + b.getAttribute('data-asgdel')).then(route); }); });
  }

  /* ---------- templates (coaches) ---------- */
  views.templates = function () {
    if (!has('coach')) return forbidden('Templates are for coaches.');
    return api.get('/api/templates').then(function (ts) {
      app.innerHTML = '<a class="back" href="#/coach">← Coach Workspace</a>' + head('Coach Workspace', 'Session templates', 'Reusable sets of drills. Start a session from one, or assign one to an athlete.', '<a class="btn primary" href="#/coach/templates/new">New template</a>') +
        (ts.length ? '<div class="list">' + ts.map(function (t) { return '<a class="li" href="#/coach/templates/' + t.id + '"><span class="main-col"><span class="t">' + h(t.name) + '</span><span class="d">' + t.items.map(function (i) { return h(i.name); }).join(' · ') + '</span></span><span class="side">' + h(t.author || '') + '</span></a>'; }).join('') + '</div>' : '<div class="list"><p class="empty">No templates yet.</p></div>');
    });
  };
  views.templateEdit = function (id) {
    if (!has('coach')) return forbidden('Templates are for coaches.');
    return (id === 'new' ? Promise.resolve({ name: '', items: TEMPLATE_4.map(function (x) { return Object.assign({}, x); }) }) : api.get('/api/templates/' + id)).then(function (t) {
      var items = t.items.map(function (x) { return Object.assign({}, x); });
      app.innerHTML = '<a class="back" href="#/coach/templates">← Templates</a>' + head('Template', id === 'new' ? 'New template' : t.name, '', id !== 'new' ? '<button class="btn danger" type="button" id="del">Delete</button>' : '') +
        '<form class="form" id="tf" novalidate><div class="field"><label class="flabel" for="n">Name</label><input type="text" id="n" maxlength="120" value="' + h(t.name) + '" placeholder="Kitchen day"></div>' +
        '<div class="field"><span class="flabel">Drills <span class="hint">1–10</span></span><div class="list" id="items"></div><div class="row"><button class="btn ghost" type="button" id="add-item">Add drill</button></div></div>' +
        '<div class="row"><button class="btn primary" type="submit">Save template</button></div></form>';
      function paint() {
        $('#items').innerHTML = items.map(function (it, i) {
          return '<div class="item-edit"><input type="text" aria-label="Drill ' + (i + 1) + ' name" data-k="name" data-i="' + i + '" value="' + h(it.name) + '" placeholder="Drill or situation">' +
            '<select aria-label="Measured by" data-k="measure" data-i="' + i + '">' + Object.keys(MEASURES).map(function (m) { return '<option value="' + m + '"' + (m === it.measure ? ' selected' : '') + '>' + MEASURES[m] + '</option>'; }).join('') + '</select>' +
            '<span class="ctl row"><button class="btn sm ghost" type="button" data-rm="' + i + '" aria-label="Remove drill"' + (items.length < 2 ? ' disabled' : '') + '>✕</button></span>' +
            '<div class="more-f"><input type="text" aria-label="Target" data-k="target" data-i="' + i + '" value="' + h(it.target || '') + '" placeholder="Target"><input type="text" aria-label="Instructions" data-k="instructions" data-i="' + i + '" value="' + h(it.instructions || '') + '" placeholder="Instructions (optional)"></div></div>';
        }).join('');
        $('#add-item').disabled = items.length >= 10;
      }
      ['input', 'change'].forEach(function (ev) { $('#items').addEventListener(ev, function (e) { var i = e.target.getAttribute('data-i'); if (i !== null) items[+i][e.target.getAttribute('data-k')] = e.target.value; }); });
      $('#items').addEventListener('click', function (e) { var b = e.target.closest('[data-rm]'); if (b) { items.splice(+b.getAttribute('data-rm'), 1); paint(); } });
      $('#add-item').addEventListener('click', function () { if (items.length < 10) { items.push({ name: '', measure: 'reps', target: '' }); paint(); } });
      paint();
      $('#tf').addEventListener('submit', function (e) {
        e.preventDefault();
        api.request(id === 'new' ? 'POST' : 'PUT', '/api/templates' + (id === 'new' ? '' : '/' + id), { name: $('#n').value, items: items }).then(function () { L.toast('Template saved'); location.hash = '#/coach/templates'; }, function (err) { L.formError($('#tf'), err.message); });
      });
      if ($('#del')) L.armed($('#del'), 'Tap again to delete', function () { api.request('DELETE', '/api/templates/' + id).then(function () { location.hash = '#/coach/templates'; }, function (err) { L.toast(err.message); }); });
    });
  };


  var TEMPLATE_4 = [
    { name: 'Third-shot drops to the kitchen', measure: 'reps', target: '7 of 10' },
    { name: 'Resets from the transition zone', measure: 'reps', target: '6 of 10' },
    { name: 'Cross-court dink rally', measure: 'score', target: '20 in a row' },
    { name: 'Session feel', measure: 'feel', target: '' }
  ];

  views.trainNew = function (_, query) {
    if (!has('coach')) return forbidden('Only coaches can run sessions.');
    var quick = query.quick === '1';
    var tplReq = api.get('/api/templates').then(null, function () { return []; });
    var asgReq = query.assignment && query.athlete ? api.get('/api/athletes/' + query.athlete + '/assignments').then(null, function () { return []; }) : Promise.resolve([]);
    return Promise.all([api.get('/api/athletes'), tplReq, asgReq]).then(function (res) {
      var roster = res[0], templates = res[1];
      var assignment = res[2].filter(function (a) { return String(a.id) === String(query.assignment); })[0] || null;
      var items = quick ? [{ name: 'Make / miss', measure: 'reps', target: '' }] : TEMPLATE_4.map(function (x) { return Object.assign({}, x); });
      if (assignment && assignment.template_items) items = assignment.template_items.map(function (x) { return Object.assign({}, x); });
      var preset = query.athlete ? [Number(query.athlete)] : [];
      app.innerHTML = '<a class="back" href="#/train">← Train</a>' +
        head('Scoreboard Studio', quick ? 'Make / miss counter' : 'New session', quick ? 'Pick who’s hitting. One big counter each.' : 'Pick up to 8 athletes and 1–10 drills or situations. Four athletes get one large square each.') +
        offlineNote(roster) +
        (assignment ? '<div class="banner"><span>Running assigned training: <b>' + h(assignment.title) + '</b>' + (assignment.note ? '. ' + h(assignment.note) : '') + '</span></div>' : '') +
        '<form class="form" id="f" novalidate>' +
        (!quick && templates.length ? '<div class="field"><label class="flabel" for="tpl">Start from a template</label><select id="tpl"><option value="">Default drills</option>' + templates.map(function (t) { return '<option value="' + t.id + '">' + h(t.name) + ' (' + t.items.length + ')</option>'; }).join('') + '</select></div>' : '') +
        '<div class="field"><label class="flabel" for="t">Title</label><input type="text" id="t" maxlength="120" value="' + h(assignment ? assignment.title : quick ? 'Counter · ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Session · ' + new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })) + '"></div>' +
        '<div class="field"><span class="flabel">Athletes <span class="hint" id="cnt"></span></span>' +
        (roster.length ? '<input type="search" id="q" placeholder="Search athletes" aria-label="Search athletes"><div class="pick" id="pick">' + roster.map(function (a) {
          return '<label data-name="' + h(a.name.toLowerCase()) + '"><input type="checkbox" value="' + a.id + '"' + (preset.indexOf(a.id) >= 0 ? ' checked' : '') + '> ' + h(a.name) + '</label>';
        }).join('') + '</div>' : '<p class="empty">No athletes yet. <a href="#/coach/new">Add one in Coach Workspace</a>.</p>') + '</div>' +
        '<div class="field"><span class="flabel">Drills and situations <span class="hint">1–10</span></span><div class="list" id="items"></div>' +
        '<div class="row"><button class="btn ghost" type="button" id="add-item">Add drill</button></div></div>' +
        '<div class="row"><button class="btn primary" type="submit">Start session</button></div></form>';

      function paintItems() {
        $('#items').innerHTML = items.map(function (it, i) {
          return '<div class="item-edit"><input type="text" aria-label="Drill ' + (i + 1) + ' name" data-k="name" data-i="' + i + '" value="' + h(it.name) + '" placeholder="Drill or situation">' +
            '<select aria-label="Measured by" data-k="measure" data-i="' + i + '">' + Object.keys(MEASURES).map(function (m) { return '<option value="' + m + '"' + (m === it.measure ? ' selected' : '') + '>' + MEASURES[m] + '</option>'; }).join('') + '</select>' +
            '<span class="ctl row"><button class="btn sm ghost" type="button" data-rm="' + i + '" aria-label="Remove drill"' + (items.length < 2 ? ' disabled' : '') + '>✕</button></span>' +
            '<div class="more-f"><input type="text" aria-label="Target" data-k="target" data-i="' + i + '" value="' + h(it.target) + '" placeholder="Target, e.g. 7 of 10"><input type="text" aria-label="Instructions" data-k="instructions" data-i="' + i + '" value="' + h(it.instructions || '') + '" placeholder="Instructions (optional)"></div></div>';
        }).join('');
        $('#add-item').disabled = items.length >= 10;
      }
      function count() {
        var n = $$('#pick input:checked').length;
        if ($('#cnt')) $('#cnt').textContent = n + ' selected' + (n > 8 ? ' · max 8' : '');
      }
      $('#items').addEventListener('input', function (e) { var i = e.target.getAttribute('data-i'); if (i !== null) items[+i][e.target.getAttribute('data-k')] = e.target.value; });
      $('#items').addEventListener('change', function (e) { var i = e.target.getAttribute('data-i'); if (i !== null) items[+i][e.target.getAttribute('data-k')] = e.target.value; });
      $('#items').addEventListener('click', function (e) { var b = e.target.closest('[data-rm]'); if (b) { items.splice(+b.getAttribute('data-rm'), 1); paintItems(); } });
      $('#add-item').addEventListener('click', function () { if (items.length < 10) { items.push({ name: '', measure: 'reps', target: '' }); paintItems(); } });
      if ($('#pick')) $('#pick').addEventListener('change', count);
      if ($('#q')) $('#q').addEventListener('input', function () { var q = this.value.toLowerCase(); $$('#pick label').forEach(function (l) { l.hidden = l.getAttribute('data-name').indexOf(q) < 0; }); });
      paintItems(); count();
      if ($('#tpl')) $('#tpl').addEventListener('change', function () {
        var v = this.value;
        var t = templates.filter(function (x) { return String(x.id) === v; })[0];
        items = (t ? t.items : TEMPLATE_4).map(function (x) { return Object.assign({}, x); });
        if (t) $('#t').value = t.name;
        paintItems();
      });

      $('#f').addEventListener('submit', function (e) {
        e.preventDefault();
        var ids = $$('#pick input:checked').map(function (i) { return Number(i.value); });
        var clean = items.map(function (it) { return { name: it.name.trim(), measure: it.measure, target: (it.target || '').trim(), instructions: (it.instructions || '').trim() }; });
        if (!ids.length) return L.formError($('#f'), 'Pick at least one athlete.');
        if (ids.length > 8) return L.formError($('#f'), 'Pick up to 8 athletes.');
        if (clean.some(function (it) { return !it.name; })) return L.formError($('#f'), 'Give every drill a name.');
        var id = L.uuid(), started = new Date().toISOString();
        var byId = {}; roster.forEach(function (a) { byId[a.id] = a; });
        var local = {
          id: id, title: $('#t').value.trim() || 'Session', status: 'live', version: 1, started_at: started,
          items: clean.map(function (it, i) { return Object.assign({ idx: i }, it); }),
          athletes: ids.map(function (aid, i) { return { id: aid, name: byId[aid].name, slot: i + 1 }; }),
          events: []
        };
        Store.set('session:' + id, local);
        L.queue({ method: 'POST', path: '/api/training/sessions', body: { id: id, title: local.title, athletes: ids, items: clean, started_at: started, assignment_id: assignment && ids.indexOf(assignment.athlete_id) >= 0 ? assignment.id : undefined }, label: 'Start “' + local.title + '”' });
        location.hash = '#/train/' + id + '/live';
      });
    });
  };

  /* Merge the device copy with the server copy. Events are a union by ID. */
  function syncSession(id) {
    var local = Store.get('session:' + id);
    return api.get('/api/training/sessions/' + id).then(function (srv) {
      var seen = {}, events = [];
      srv.events.concat(local ? local.events : []).forEach(function (e) { if (!seen[e.id]) { seen[e.id] = 1; events.push(e); } });
      var merged = { id: srv.id, title: srv.title, status: srv.status, version: srv.version, started_at: srv.started_at, items: srv.items, athletes: srv.athletes, events: events, coach_id: srv.coach_id, notes: srv.notes || [], matches: srv.matches || [] };
      if (local && local.status === 'complete' && srv.status === 'live') merged.status = 'complete';
      Store.set('session:' + id, merged);
      return merged;
    }, function (err) {
      if ((err.status === 0 || err.status === 404) && local) return local; // not synced yet, or offline
      throw err;
    });
  }

  views.live = function (id) {
    if (!has('coach')) { location.hash = '#/train/' + id; return; }
    return syncSession(id).then(function (s) {
      if (s.status === 'complete') { location.hash = '#/train/' + id; return; }
      var cur = Store.get('live-item:' + id, 0);
      if (cur >= s.items.length) cur = 0;
      var wake = null;
      try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (w) { wake = w; }, function () {}); } catch (e) {}
      window.addEventListener('hashchange', function rel() { try { wake && wake.release(); } catch (e) {} window.removeEventListener('hashchange', rel); });

      app.innerHTML = '<div class="live">' +
        '<div class="live-head"><a class="back" href="#/train">← Train</a><span class="small muted mono" id="saved"></span></div>' +
        '<h1 style="font-size:22px">' + h(s.title) + '</h1>' +
        '<div class="drill-tabs" role="tablist" id="tabs"></div>' +
        '<p class="drill-info" id="info"></p>' +
        '<div id="board"></div>' +
        voiceBar() +
        '<div class="live-bar"><button class="btn" type="button" id="undo">Undo last</button><button class="btn primary" type="button" id="finish">Finish session</button></div></div>';

      function save() { Store.set('session:' + id, s); $('#saved').textContent = 'Saved on device · ' + s.events.length + ' taps'; }
      function tabs() {
        $('#tabs').innerHTML = s.items.map(function (it, i) { return '<button type="button" role="tab" aria-pressed="' + (i === cur) + '" data-i="' + i + '">' + (i + 1) + '. ' + h(it.name) + '</button>'; }).join('');
        var it = s.items[cur];
        $('#info').innerHTML = '<b>' + h(MEASURES[it.measure]) + '</b>' + (it.target ? ' · Target ' + h(it.target) : '') + (it.instructions ? ' · ' + h(it.instructions) : '');
      }
      function board() {
        var it = s.items[cur], cells = summarize(s.items, s.athletes.map(function (a) { return a.id; }), s.events);
        var n = s.athletes.length;
        $('#board').innerHTML = '<div class="pads n' + n + '">' + s.athletes.map(function (a) {
          var c = cells[cur + ':' + a.id];
          var top = '<div class="who"><span class="nm">' + h(a.name) + '</span><span class="pct">' + (it.measure === 'reps' && c.attempts ? c.pct + '%' : '') + '</span></div>';
          if (it.measure === 'reps') {
            return '<div class="pad" data-a="' + a.id + '">' + top +
              '<button type="button" class="make" data-kind="make" data-a="' + a.id + '" aria-label="Make for ' + h(a.name) + ', ' + c.makes + ' so far"><span class="num">' + c.makes + '</span><span class="lbl">Make</span></button>' +
              '<button type="button" class="miss" data-kind="miss" data-a="' + a.id + '" aria-label="Miss for ' + h(a.name) + ', ' + c.misses + ' so far"><span class="num">' + c.misses + '</span><span class="lbl">Miss</span></button></div>';
          }
          if (it.measure === 'feel') {
            return '<div class="pad" data-a="' + a.id + '">' + top + '<div class="valpad"><p class="big">' + (c.last == null ? '—' : c.last) + '</p><div class="feel">' +
              [1, 2, 3, 4, 5].map(function (v) { return '<button type="button" data-val="' + v + '" data-a="' + a.id + '" aria-pressed="' + (c.last === v) + '" aria-label="Feel ' + v + ' for ' + h(a.name) + '">' + v + '</button>'; }).join('') + '</div></div><span></span></div>';
          }
          if (it.measure === 'time') {
            return '<div class="pad" data-a="' + a.id + '">' + top + '<div class="valpad"><p class="big" data-clock="' + a.id + '">' + (c.last == null ? '0.0s' : fmtTime(c.last)) + '</p>' +
              '<div class="row"><button class="btn primary" type="button" data-timer="' + a.id + '">Start</button></div><p class="small muted" style="text-align:center">Best ' + (c.best == null ? '—' : fmtTime(c.best)) + ' · ' + c.values.length + ' runs</p></div><span></span></div>';
          }
          return '<div class="pad" data-a="' + a.id + '">' + top + '<div class="valpad"><p class="big">' + (c.last == null ? '—' : c.last) + '</p>' +
            '<div class="row"><input type="number" inputmode="numeric" aria-label="Score for ' + h(a.name) + '" data-in="' + a.id + '" style="max-width:110px"><button class="btn primary" type="button" data-rec="' + a.id + '">Record</button></div>' +
            '<p class="small muted" style="text-align:center">Best ' + (c.best == null ? '—' : c.best) + ' · ' + c.values.length + ' entries</p></div><span></span></div>';
        }).join('') + '</div>';
      }
      function record(aid, kind, value) {
        var ev = { id: L.uuid(), item_idx: cur, athlete_id: aid, kind: kind, at: new Date().toISOString() };
        if (kind === 'value') ev.value = value;
        s.events.push(ev); save();
        L.queue({ type: 'events', session: id, event: ev });
        try { navigator.vibrate && navigator.vibrate(12); } catch (e) {}
        board();
        var pad = $('.pad[data-a="' + aid + '"]'); if (pad) { pad.classList.add('flash'); }
        var a = s.athletes.filter(function (x) { return x.id === aid; })[0];
        L.toast((kind === 'value' ? String(value) : kind === 'make' ? 'Make' : 'Miss') + ' · ' + a.name, { label: 'Undo', run: function () { undo(ev); } });
      }
      function undo(target) {
        if (!target) {
          var undone = {}; s.events.forEach(function (e) { if (e.kind === 'undo') undone[e.undoes] = 1; });
          for (var i = s.events.length - 1; i >= 0; i--) { var e = s.events[i]; if (e.kind !== 'undo' && !undone[e.id] && e.item_idx === cur) { target = e; break; } }
        }
        if (!target) { L.toast('Nothing to undo on this drill.'); return; }
        var ev = { id: L.uuid(), item_idx: target.item_idx, athlete_id: target.athlete_id, kind: 'undo', undoes: target.id, at: new Date().toISOString() };
        s.events.push(ev); save();
        L.queue({ type: 'events', session: id, event: ev });
        board(); L.toast('Undone');
      }

      var timers = {};
      $('#board').addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var aid = Number(b.getAttribute('data-a') || b.getAttribute('data-rec') || b.getAttribute('data-timer'));
        if (b.getAttribute('data-kind')) return record(aid, b.getAttribute('data-kind'));
        if (b.getAttribute('data-val')) return record(aid, 'value', Number(b.getAttribute('data-val')));
        if (b.getAttribute('data-rec')) {
          var inp = $('[data-in="' + aid + '"]'); var v = Number(inp.value);
          if (inp.value === '' || !isFinite(v)) { L.toast('Enter a score first.'); inp.focus(); return; }
          return record(aid, 'value', v);
        }
        if (b.getAttribute('data-timer')) {
          var t = timers[aid];
          if (!t) {
            timers[aid] = { start: performance.now(), tick: setInterval(function () { var c = $('[data-clock="' + aid + '"]'); if (c) c.textContent = fmtTime((performance.now() - timers[aid].start) / 1000); }, 100) };
            b.textContent = 'Stop';
          } else {
            clearInterval(t.tick); delete timers[aid];
            record(aid, 'value', Math.round((performance.now() - t.start) / 100) / 10);
          }
        }
      });
      $('#tabs').addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        cur = +b.getAttribute('data-i'); Store.set('live-item:' + id, cur); tabs(); board();
      });
      $('#undo').addEventListener('click', function () { undo(); });
      L.armed($('#finish'), 'Tap again to finish', function () {
        s.status = 'complete'; save();
        L.queue({ method: 'PUT', path: '/api/training/sessions/' + id, body: { version: s.version, status: 'complete' }, label: 'Finish “' + s.title + '”' });
        location.hash = '#/train/' + id;
      });
      tabs(); board(); save();
      bindVoice(s.athletes.map(function (a) { return a.name; }), 'counts', function (cmd) {
        if (cmd.action === 'undo') return undo();
        if (s.items[cur].measure !== 'reps') { L.toast('Voice scores make/miss drills. Enter this drill by hand.'); return; }
        record(s.athletes[cmd.index].id, cmd.action);
      });
      window.addEventListener('hashchange', function offv() { stopVoice(); window.removeEventListener('hashchange', offv); });
    });
  };

  views.session = function (id) {
    return syncSession(id).then(function (s) {
      var coach = has('coach') && (!s.coach_id || s.coach_id === ME.user.id || has('admin'));
      var cells = summarize(s.items, s.athletes.map(function (a) { return a.id; }), s.events);
      app.innerHTML = '<a class="back" href="#/train">← Train</a>' +
        head(s.status === 'live' ? 'Live session' : 'Session summary', s.title, L.when(s.started_at) + ' · ' + s.athletes.length + ' athlete' + (s.athletes.length === 1 ? '' : 's'),
          coach && s.status === 'live' ? '<a class="btn primary" href="#/train/' + h(id) + '/live">Resume counting</a>' : '') +
        '<div class="table-wrap card" style="padding:0"><table class="summary-table"><thead><tr><th>Drill</th>' + s.athletes.map(function (a) { return '<th>' + h(a.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        s.items.map(function (it) {
          return '<tr><td><b>' + h(it.name) + '</b><br><span class="small muted">' + h(MEASURES[it.measure]) + (it.target ? ' · target ' + h(it.target) : '') + '</span></td>' +
            s.athletes.map(function (a) { return '<td class="n">' + h(cellText(it, cells[it.idx + ':' + a.id])) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' +
        (s.items.some(function (it) { return it.measure === 'reps'; }) ? '<div class="tiles">' + s.athletes.map(function (a) {
          var m = 0, t = 0; s.items.forEach(function (it) { if (it.measure === 'reps') { var c = cells[it.idx + ':' + a.id]; m += c.makes; t += c.attempts; } });
          return '<div class="tile"><span class="l">' + h(a.name) + '</span><span class="n">' + (t ? Math.round(m / t * 100) + '%' : '—') + '</span><span class="s">' + m + ' of ' + t + ' makes</span></div>';
        }).join('') + '</div>' : '') +
        '<div class="stack"><p class="section-title">Games from this session</p>' + ((s.matches || []).length ? '<div class="list">' + s.matches.map(function (m) {
          var names = function (t) { return m.players.filter(function (p) { return p.team === t; }).map(function (p) { return h(p.name); }).join(' & '); };
          return '<a class="li" href="#/play/match/' + h(m.id) + '"><span class="main-col"><span class="t small">' + names(1) + ' <span class="muted">vs</span> ' + names(2) + '</span><span class="d mono">' + h(m.games.map(function (g) { return g.join('–'); }).join(', ')) + '</span></span></a>';
        }).join('') + '</div>' : '<div class="list"><p class="empty">No games recorded from this session.</p></div>') +
        '<div class="row"><a class="btn ghost" href="#/play/match/new?session=' + h(id) + '">Record a game</a></div></div>' +
        '<div class="stack"><p class="section-title">Session notes</p>' + ((s.notes || []).length ? '<div class="list">' + s.notes.map(function (n) {
          return '<div class="note ' + (n.visibility === 'private' ? 'private' : '') + '"><p class="body">' + h(n.body) + '</p><p class="meta">' + (n.kind === 'reflection' ? '<span class="vis reflection">Reflection</span>' : n.visibility === 'private' ? '<span class="vis private">Private · coaches only</span>' : '<span class="vis shared">Shared</span>') + '<span>' + h(n.athlete_name) + '</span><span>' + h(n.author || '') + '</span></p></div>';
        }).join('') + '</div>' : '<div class="list"><p class="empty">No notes on this session yet.</p></div>') +
        (coach ? '<form class="card form" id="snf" novalidate><div class="form-grid"><div class="field"><label class="flabel" for="sna">Athlete</label><select id="sna">' + s.athletes.map(function (a) { return '<option value="' + a.id + '">' + h(a.name) + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label class="flabel" for="snv">Who can see it</label><select id="snv"><option value="private">Private · coaches only</option><option value="shared">Shared with athlete</option></select></div></div>' +
          '<div class="field"><label class="flabel" for="snb">Note</label><textarea id="snb" maxlength="5000"></textarea></div><div class="row"><button class="btn primary" type="submit">Add note</button></div></form>' : '') + '</div>';
      if ($('#snf')) $('#snf').addEventListener('submit', function (e) {
        e.preventDefault();
        var text = $('#snb').value.trim(); if (!text) return L.formError($('#snf'), 'Write the note first.');
        var aid = $('#sna').value;
        L.queue({ method: 'POST', path: '/api/athletes/' + aid + '/notes', body: { body: text, visibility: $('#snv').value, session_id: id, client_id: L.uuid() }, kind: 'coach', label: 'Session note' });
        L.toast(L.isOnline() ? 'Note saved' : 'Saved on this device. It’ll sync when you’re online.');
        setTimeout(route, 400);
      });
    });
  };


  /* ================= LEARN ================= */
  var learnLane = '', learnTab = 'notes';
  function progressBar(done, total) { var pc = total ? Math.round(done / total * 100) : 0; return '<div class="progress" role="progressbar" aria-valuenow="' + pc + '" aria-valuemin="0" aria-valuemax="100" aria-label="' + done + ' of ' + total + ' lessons done"><i style="width:' + pc + '%"></i></div>'; }
  function courseCard(c) {
    return '<a class="course-card" href="#/learn/course/' + h(c.slug) + '"><div class="cover">' + (c.cover_media_id ? '<img alt="" loading="lazy" src="/api/media/' + h(c.cover_media_id) + '">' : '<span>' + h(initials(c.title)) + '</span>') + '</div>' +
      '<div class="body"><p class="lane">' + (c.status === 'draft' ? 'Draft · ' : '') + h(c.access_label) + (c.unlocked ? '' : ' · Locked') + '</p><p class="t">' + h(c.title) + '</p>' +
      '<p class="d">' + c.lessons + ' lesson' + (c.lessons === 1 ? '' : 's') + (c.minutes ? ' · ' + c.minutes + ' min' : '') + (c.completed ? ' · ' + c.completed + ' done' : '') + '</p>' +
      (c.completed ? progressBar(c.completed, c.lessons) : '') + '</div></a>';
  }
  views.learn = function () {
    var tabs = '<div class="chips" id="ltabs">' + [['notes', 'Field Notes'], ['courses', 'Courses'], ['saved', 'Saved']].filter(function (t) { return ME || t[0] !== 'saved'; }).map(function (t) { return '<button class="chip" type="button" data-v="' + t[0] + '" aria-pressed="' + (learnTab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>';
    var body;
    if (learnTab === 'courses') {
      body = api.get('/api/courses').then(function (cs) {
        return offlineNote(cs) + (cs.length ? '<div class="course-grid">' + cs.map(courseCard).join('') + '</div>' : '<div class="list"><p class="empty">No courses published yet.</p></div>');
      });
    } else if (learnTab === 'saved') {
      body = api.get('/api/me/saved').then(function (ps) { return offlineNote(ps) + (ps.length ? postList(ps.map(function (p) { return Object.assign({ lane_name: LANES[p.lane] }, p); })) : '<div class="list"><p class="empty">Nothing saved yet. Tap Save on any Field Note to keep it here.</p></div>'); });
    } else {
      body = api.get('/api/posts' + (learnLane ? '?lane=' + learnLane : '')).then(function (posts) {
        return offlineNote(posts) + '<div class="chips" id="lanes"><button class="chip" type="button" data-v="" aria-pressed="' + (!learnLane) + '">All</button>' + Object.keys(LANES).map(function (k) { return '<button class="chip" type="button" data-v="' + k + '" aria-pressed="' + (learnLane === k) + '">' + LANES[k] + '</button>'; }).join('') + '</div>' + postList(posts);
      });
    }
    return body.then(function (html) {
      app.innerHTML = head('Learn', learnTab === 'courses' ? 'Courses' : learnTab === 'saved' ? 'Saved' : 'Field Notes', learnTab === 'notes' ? 'Quick Reads, The Work and Field Studies from THE LAB.' : '', ME ? '' : '<a class="btn primary" href="#/signin">Sign in</a>') +
        tabs + html + '<div class="stack"><p class="section-title">Tools</p><div class="quick"><a href="#/learn/engine">Decision engine</a></div></div>';
      $('#ltabs').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (c) { learnTab = c.getAttribute('data-v'); route(); } });
      if ($('#lanes')) $('#lanes').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (c) { learnLane = c.getAttribute('data-v'); route(); } });
    });
  };

  views.post = function (slug) {
    return api.get('/api/posts/' + slug).then(function (p) {
      app.innerHTML = '<a class="back" href="#/learn">← Field Notes</a>' + offlineNote(p) + '<article class="article">' + articleHTML(p) + '</article>' +
        (ME ? '<div class="row"><button class="btn" type="button" id="save" aria-pressed="false">Save</button></div>' : '');
      if (!ME) return;
      var saved = false;
      function paint() { $('#save').textContent = saved ? 'Saved ✓' : 'Save'; $('#save').setAttribute('aria-pressed', String(saved)); }
      api.get('/api/me/saved').then(function (list) { saved = list.some(function (x) { return x.id === p.id; }); paint(); }, function () {});
      $('#save').addEventListener('click', function () {
        api.request(saved ? 'DELETE' : 'PUT', '/api/me/saved/' + p.id).then(function () { saved = !saved; paint(); L.toast(saved ? 'Saved to Learn → Saved' : 'Removed from Saved'); }, function (err) { L.toast(err.status === 0 ? 'Saving needs a connection.' : err.message); });
      });
    });
  };
  /* Renders rich text; media placed in the body aren't repeated in the gallery. */
  function articleHTML(p) {
    var map = {}; (p.media || []).forEach(function (m) { map[m.id] = m.mime; });
    var r = window.LabMarkdown.render(p.body, { media: map, withUsed: true });
    var rest = (p.media || []).filter(function (m) { return m.id !== p.thumbnail_media_id && r.used.indexOf(m.id) < 0; });
    return '<p class="lane">' + h(p.lane_name || LANES[p.lane]) + '</p><h1>' + h(p.title) + '</h1>' +
      (p.summary ? '<p class="dek">' + h(p.summary) + '</p>' : '') +
      '<p class="small muted mono">' + h(p.author_credit || '') + (p.published_at ? ' · ' + h(new Date(p.published_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })) : '') + '</p>' +
      (p.thumbnail_media_id ? '<img class="hero" alt="" src="/api/media/' + h(p.thumbnail_media_id) + '">' : '') +
      '<div class="prose">' + r.html + '</div>' +
      (rest.length ? '<div class="media-grid">' + rest.map(mediaFigure).join('') + '</div>' : '') +
      (p.tags && p.tags.length ? '<div class="chips">' + p.tags.map(function (t) { return '<span class="tag">' + h(t) + '</span>'; }).join('') + '</div>' : '');
  }
  function mediaFigure(m) {
    return '<figure>' + (m.mime.indexOf('video/') === 0 ? '<video controls playsinline preload="metadata" src="/api/media/' + h(m.id) + '"></video>' : '<img alt="" loading="lazy" src="/api/media/' + h(m.id) + '">') +
      (m.visibility && m.visibility !== 'public' ? '<span class="vis ' + h(m.visibility) + '">' + (m.visibility === 'private' ? 'Coach only' : 'Shared') + '</span>' : '') + '</figure>';
  }

  views.learnCourses = function () { learnTab = 'courses'; return views.learn(); };
  views.course = function (slug) {
    return api.get('/api/courses/' + slug).then(function (c) {
      var next = null;
      c.modules.forEach(function (m) { m.lessons.forEach(function (l) { if (!next && l.open && !l.done) next = l; }); });
      app.innerHTML = '<a class="back" href="#/learn">← Learn</a>' + offlineNote(c) +
        (c.cover_media_id ? '<img class="hero" alt="" src="/api/media/' + h(c.cover_media_id) + '">' : '') +
        head(c.access_label + (c.status === 'draft' ? ' · Draft' : ''), c.title, c.summary, has('editor') ? '<a class="btn ghost" href="#/studio/course/' + c.id + '">Edit course</a>' : '') +
        '<div class="stack-sm"><p class="small mono">' + c.completed + ' of ' + c.lessons + ' lessons done' + (c.minutes ? ' · ' + c.minutes + ' min total' : '') + '</p>' + progressBar(c.completed, c.lessons) + '</div>' +
        (c.locked_reason ? '<div class="banner"><span>' + h(c.locked_reason) + ' Lessons marked Preview are open to everyone. To get access, speak to your coach or THE LAB team.</span>' + (ME ? '' : '<a class="btn sm primary" href="#/signin">Sign in</a>') + '</div>' : '') +
        (next ? '<div class="row"><a class="btn primary" href="#/learn/course/' + h(c.slug) + '/' + next.id + '">' + (c.completed ? 'Continue: ' : 'Start: ') + h(next.title) + '</a></div>' : '') +
        c.modules.map(function (m) {
          return '<div class="stack"><p class="section-title">' + h(m.title || 'Lessons') + '</p><div class="list">' + m.lessons.map(function (l) {
            var icon = l.done ? '<span class="lesson-dot done" aria-label="Done">✓</span>' : l.open ? '<span class="lesson-dot" aria-hidden="true"></span>' : '<span class="lesson-dot locked" aria-label="Locked">•</span>';
            var inner = '<span class="who">' + icon + '<span class="main-col"><span class="t small">' + h(l.title) + '</span><span class="d mono">' + (l.minutes ? l.minutes + ' min' : '') + (l.preview && !c.unlocked ? (l.minutes ? ' · ' : '') + 'Preview' : '') + (!l.open ? 'Locked' : '') + '</span></span></span>';
            return l.open ? '<a class="li" href="#/learn/course/' + h(c.slug) + '/' + l.id + '">' + inner + '</a>' : '<div class="li is-locked">' + inner + '</div>';
          }).join('') + '</div></div>';
        }).join('');
    });
  };

  views.lesson = function (slug, query, id) {
    return api.get('/api/courses/' + slug + '/lessons/' + id).then(function (l) {
      var video = l.video_media_id ? '<video class="lesson-video" controls playsinline preload="metadata" src="/api/media/' + h(l.video_media_id) + '"></video>' : '';
      app.innerHTML = '<a class="back" href="#/learn/course/' + h(slug) + '">← ' + h(l.course.title) + '</a>' + offlineNote(l) +
        '<article class="article"><p class="lane">' + h(l.module || l.course.title) + (l.minutes ? ' · ' + l.minutes + ' min' : '') + '</p><h1>' + h(l.title) + '</h1>' + video +
        '<div class="prose">' + l.body_html + '</div></article>' +
        '<div class="live-bar">' + (l.prev ? '<a class="btn ghost" href="#/learn/course/' + h(slug) + '/' + l.prev.id + '">← Previous</a>' : '') +
        (ME ? '<button class="btn ' + (l.done ? '' : 'primary') + '" type="button" id="done">' + (l.done ? 'Completed ✓' : 'Mark complete') + '</button>' : '') +
        (l.next ? '<a class="btn" href="#/learn/course/' + h(slug) + '/' + l.next.id + '">Next →</a>' : '') + '</div>';
      if ($('#done')) $('#done').addEventListener('click', function () {
        api.request(l.done ? 'DELETE' : 'POST', '/api/lessons/' + l.id + '/complete', l.done ? undefined : {}).then(function () {
          if (!l.done && l.next) { L.toast('Lesson complete'); location.hash = '#/learn/course/' + slug + '/' + l.next.id; } else route();
        }, function (err) { L.toast(err.status === 0 ? 'Progress needs a connection.' : err.message); });
      });
    }, function (err) {
      if (err.status === 403 && err.data.locked) {
        app.innerHTML = '<a class="back" href="#/learn/course/' + h(slug) + '">← Course</a>' + head('Locked', 'This lesson is locked', err.message + ' Speak to your coach or THE LAB team about access.') + (ME ? '' : '<div class="row"><a class="btn primary" href="#/signin">Sign in</a></div>');
        return;
      }
      throw err;
    });
  };

  /* ---------- studio: courses ---------- */
  views.studioCourses = function () {
    if (!has('editor')) return forbidden('Courses are managed by editors.');
    return api.get('/api/courses').then(function (cs) {
      app.innerHTML = '<a class="back" href="#/studio">← Studio</a>' + head('Publishing Studio', 'Courses', 'Build courses from lessons. Choose who can open them: everyone, members, or a cohort.', '<button class="btn primary" type="button" id="newc">New course</button>') +
        (cs.length ? '<div class="list">' + cs.map(function (c) {
          return '<a class="li" href="#/studio/course/' + c.id + '"><span class="main-col"><span class="t">' + h(c.title) + '</span><span class="d">' + c.lessons + ' lessons · ' + h(c.access_label) + '</span></span><span class="side"><span class="status ' + (c.status === 'published' ? 'published' : 'draft') + '">' + (c.status === 'published' ? 'Published' : 'Draft') + '</span></span></a>';
        }).join('') + '</div>' : '<div class="list"><p class="empty">No courses yet.</p></div>') +
        '<div class="row"><a class="btn ghost" href="#/cohorts">Manage cohorts</a></div>';
      $('#newc').addEventListener('click', function () {
        api.request('POST', '/api/studio/courses', { title: 'Untitled course' }).then(function (c) { location.hash = '#/studio/course/' + c.id; }, function (err) { L.toast(err.message); });
      });
    });
  };

  views.courseEdit = function (id) {
    if (!has('editor')) return forbidden('Courses are managed by editors.');
    return api.get('/api/studio/courses/' + id).then(function (c) {
      app.innerHTML = '<a class="back" href="#/studio/courses">← Courses</a>' +
        head('Course', c.title, '', '<div class="row">' + (c.status === 'published' ? '<a class="btn ghost" href="#/learn/course/' + h(c.slug) + '">View</a>' : '') + '<button class="btn danger" type="button" id="delc">Delete</button></div>') +
        '<div class="grid-2"><form class="card form" id="cf" novalidate>' +
        '<div class="field"><label class="flabel" for="ct">Title</label><input type="text" id="ct" maxlength="160" value="' + h(c.title) + '"></div>' +
        '<div class="field"><label class="flabel" for="cs">Summary</label><textarea id="cs" maxlength="1000">' + h(c.summary) + '</textarea></div>' +
        '<div class="form-grid"><div class="field"><label class="flabel" for="ca">Who can open it</label><select id="ca">' + [['public', 'Everyone signed in'], ['members', 'Members (and cohorts)'], ['cohort', 'Cohort only']].map(function (o) { return '<option value="' + o[0] + '"' + (c.access === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label class="flabel" for="cst">Status</label><select id="cst"><option value="draft"' + (c.status === 'draft' ? ' selected' : '') + '>Draft</option><option value="published"' + (c.status === 'published' ? ' selected' : '') + '>Published</option></select></div></div>' +
        '<div class="field"><label class="flabel" for="ccov">Cover image</label>' + (c.cover_media_id ? '<img class="hero" alt="" src="/api/media/' + h(c.cover_media_id) + '" style="max-height:160px">' : '') + '<input type="file" id="ccov" accept="image/*"><div class="progress" id="covp" hidden><i></i></div></div>' +
        '<div class="row"><button class="btn primary" type="submit">Save course</button></div></form>' +
        '<div class="stack"><p class="section-title">Lessons · ' + c.lessons.length + '</p>' +
        (c.lessons.length ? '<div class="list">' + c.lessons.map(function (l, i) {
          return '<div class="li"><a class="main-col" href="#/studio/lesson/' + l.id + '" style="text-decoration:none"><span class="d mono">' + h(l.module || 'No module') + '</span><span class="t small">' + (i + 1) + '. ' + h(l.title) + '</span><span class="d">' + (l.preview ? 'Preview · ' : '') + (l.video_media_id ? 'Video · ' : '') + (l.minutes ? l.minutes + ' min' : '') + '</span></a>' +
            '<span class="side row"><button class="btn sm ghost" type="button" data-mv="' + i + '" data-d="-1"' + (i ? '' : ' disabled') + ' aria-label="Move up">↑</button><button class="btn sm ghost" type="button" data-mv="' + i + '" data-d="1"' + (i < c.lessons.length - 1 ? '' : ' disabled') + ' aria-label="Move down">↓</button></span></div>';
        }).join('') + '</div>' : '<div class="list"><p class="empty">No lessons yet.</p></div>') +
        '<form class="card form" id="lf" novalidate><div class="form-grid"><div class="field"><label class="flabel" for="lt">New lesson</label><input type="text" id="lt" maxlength="160" placeholder="Lesson title"></div>' +
        '<div class="field"><label class="flabel" for="lm">Module</label><input type="text" id="lm" maxlength="120" value="' + h(c.lessons.length ? c.lessons[c.lessons.length - 1].module : '') + '" placeholder="e.g. Foundations"></div></div>' +
        '<div class="row"><button class="btn" type="submit">Add lesson</button></div></form></div></div>';
      $('#cf').addEventListener('submit', function (e) {
        e.preventDefault();
        api.request('PUT', '/api/studio/courses/' + c.id, { title: $('#ct').value, summary: $('#cs').value, access: $('#ca').value, status: $('#cst').value })
          .then(function () { L.toast('Course saved'); route(); }, function (err) { L.formError($('#cf'), err.message); });
      });
      $('#ccov').addEventListener('change', function () {
        var f = this.files[0]; if (!f) return; var pb = $('#covp'); pb.hidden = false;
        api.upload(f, 'course_id=' + c.id, function (x) { $('i', pb).style.width = Math.round(x * 100) + '%'; })
          .then(function (m) { return api.request('PUT', '/api/studio/courses/' + c.id, { cover_media_id: m.id }); })
          .then(function () { L.toast('Cover updated'); route(); }, function (err) { pb.hidden = true; L.toast(err.message); });
      });
      $('#lf').addEventListener('submit', function (e) {
        e.preventDefault();
        if (!$('#lt').value.trim()) return L.formError($('#lf'), 'Give the lesson a title.');
        api.request('POST', '/api/studio/courses/' + c.id + '/lessons', { title: $('#lt').value, module: $('#lm').value }).then(function (l) { location.hash = '#/studio/lesson/' + l.id; }, function (err) { L.formError($('#lf'), err.message); });
      });
      $$('[data-mv]').forEach(function (b) { b.addEventListener('click', function () {
        var i = +b.getAttribute('data-mv'), j = i + Number(b.getAttribute('data-d'));
        var ls = c.lessons.slice(); var t = ls[i]; ls[i] = ls[j]; ls[j] = t;
        Promise.all(ls.map(function (l, k) { return l.position === k ? null : api.request('PUT', '/api/studio/lessons/' + l.id, { position: k }); })).then(route, function (err) { L.toast(err.message); });
      }); });
      L.armed($('#delc'), 'Tap again to delete the course', function () { api.request('DELETE', '/api/studio/courses/' + c.id).then(function () { location.hash = '#/studio/courses'; }); });
    });
  };

  views.lessonEdit = function (id) {
    if (!has('editor')) return forbidden('Courses are managed by editors.');
    return api.get('/api/studio/lessons/' + id).then(function (l) {
      var key = 'lesson:' + l.id, saved = Store.get(key);
      var f = saved && saved.base === l.updated_at ? saved.fields : { title: l.title, module: l.module, minutes: l.minutes || '', preview: l.preview, body: l.body };
      app.innerHTML = '<a class="back" href="#/studio/course/' + l.course.id + '">← ' + h(l.course.title) + '</a>' +
        (saved && saved.base === l.updated_at && JSON.stringify(saved.fields) !== JSON.stringify({ title: l.title, module: l.module, minutes: l.minutes || '', preview: l.preview, body: l.body }) ? '<div class="banner"><span>Restored unsaved changes from this device.</span></div>' : '') +
        '<form class="form" id="lef" novalidate><input class="editor-title" type="text" id="t" maxlength="160" aria-label="Lesson title" value="' + h(f.title) + '">' +
        '<div class="form-grid"><div class="field"><label class="flabel" for="m">Module</label><input type="text" id="m" maxlength="120" value="' + h(f.module) + '"></div>' +
        '<div class="field"><label class="flabel" for="mi">Minutes</label><input type="number" id="mi" min="1" max="600" value="' + h(f.minutes) + '"></div>' +
        '<label class="tog" for="pv"><input type="checkbox" id="pv"' + (f.preview ? ' checked' : '') + '><div><b>Free preview</b><span>Open to everyone, even without access.</span></div></label></div>' +
        '<div class="field"><label class="flabel" for="b">Lesson <span class="hint">' + RICH_HINT + '</span></label><textarea class="editor-body" id="b" maxlength="60000">' + h(f.body) + '</textarea></div>' +
        '<div class="stack"><p class="section-title">Video and images</p><input type="file" id="up" accept="video/*,image/*" aria-label="Upload lesson video or image"><div class="progress" id="upp" hidden><i></i></div>' +
        (l.media.length ? '<div class="media-grid">' + l.media.map(function (m) {
          return '<figure>' + (m.mime.indexOf('video/') === 0 ? '<video muted playsinline preload="metadata" src="/api/media/' + h(m.id) + '"></video>' : '<img alt="" src="/api/media/' + h(m.id) + '">') +
            (m.id === l.video_media_id ? '<span class="vis shared">Lesson video</span>' : m.mime.indexOf('video/') === 0 ? '<button class="btn sm" style="position:absolute;left:6px;top:6px" type="button" data-vid="' + h(m.id) + '">Use as lesson video</button>' : '') +
            '<button class="btn sm" style="position:absolute;left:6px;bottom:6px" type="button" data-ins="' + h(m.id) + '">Insert in text</button></figure>';
        }).join('') + '</div>' : '') + '</div>' +
        '<div class="live-bar"><button class="btn primary" type="submit">Save lesson</button><button class="btn ghost" type="button" id="prev">Preview</button><button class="btn danger" type="button" id="del">Delete</button></div></form><div id="pvbox"></div>';
      function read() { f = { title: $('#t').value, module: $('#m').value, minutes: $('#mi').value, preview: $('#pv').checked, body: $('#b').value }; Store.set(key, { base: l.updated_at, fields: f }); }
      $('#lef').addEventListener('input', read);
      $('#lef').addEventListener('change', read);
      $('#lef').addEventListener('submit', function (e) {
        e.preventDefault(); read();
        api.request('PUT', '/api/studio/lessons/' + l.id, { title: f.title, module: f.module, minutes: f.minutes || null, preview: f.preview, body: f.body })
          .then(function () { Store.del(key); L.toast('Lesson saved'); route(); }, function (err) { L.formError($('#lef'), err.status === 0 ? 'Offline. Your text is kept on this device.' : err.message); });
      });
      $('#prev').addEventListener('click', function () { read(); var map = {}; l.media.forEach(function (m) { map[m.id] = m.mime; }); $('#pvbox').innerHTML = '<article class="article card"><h1>' + h(f.title) + '</h1><div class="prose">' + window.LabMarkdown.render(f.body, { media: map }) + '</div></article>'; $('#pvbox').scrollIntoView({ behavior: 'smooth' }); });
      $('#up').addEventListener('change', function () {
        var file = this.files[0]; if (!file) return; var pb = $('#upp'); pb.hidden = false;
        api.upload(file, 'lesson_id=' + l.id, function (x) { $('i', pb).style.width = Math.round(x * 100) + '%'; }).then(function (m) {
          return m.mime.indexOf('video/') === 0 && !l.video_media_id ? api.request('PUT', '/api/studio/lessons/' + l.id, { video_media_id: m.id }) : null;
        }).then(function () { L.toast('Uploaded'); route(); }, function (err) { pb.hidden = true; L.toast(err.message); });
      });
      $$('[data-vid]').forEach(function (b) { b.addEventListener('click', function () { api.request('PUT', '/api/studio/lessons/' + l.id, { video_media_id: b.getAttribute('data-vid') }).then(route, function (err) { L.toast(err.message); }); }); });
      $$('[data-ins]').forEach(function (b) { b.addEventListener('click', function () { insertAtCursor($('#b'), '\n\n![](media:' + b.getAttribute('data-ins') + ')\n\n'); read(); L.toast('Inserted. Save to keep it.'); }); });
      L.armed($('#del'), 'Tap again to delete', function () { api.request('DELETE', '/api/studio/lessons/' + l.id).then(function () { Store.del(key); location.hash = '#/studio/course/' + l.course.id; }); });
    });
  };
  var RICH_HINT = '## heading · **bold** · _italic_ · - list · &gt; quote · [link](https://…)';
  function insertAtCursor(ta, text) {
    var s = ta.selectionStart || ta.value.length, e = ta.selectionEnd || s;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + text.length; ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ---------- cohorts (coaches and editors) ---------- */
  views.cohorts = function () {
    if (!has('coach', 'editor')) return forbidden('Cohorts are managed by coaches and editors.');
    return Promise.all([api.get('/api/cohorts'), api.get('/api/courses')]).then(function (r) {
      var cs = r[0], courses = r[1];
      app.innerHTML = head('Learn', 'Cohorts', 'A cohort is a group of people who share access to a course.') +
        (cs.length ? '<div class="list">' + cs.map(function (c) { return '<a class="li" href="#/cohorts/' + c.id + '"><span class="main-col"><span class="t">' + h(c.title) + '</span><span class="d">' + h(c.course_title || 'No course') + '</span></span><span class="side">' + c.members + ' people</span></a>'; }).join('') + '</div>' : '<div class="list"><p class="empty">No cohorts yet.</p></div>') +
        '<form class="card form" id="nf" novalidate><p class="section-title">New cohort</p><div class="form-grid"><div class="field"><label class="flabel" for="t">Name</label><input type="text" id="t" maxlength="120" placeholder="Fall 4.0 group"></div>' +
        '<div class="field"><label class="flabel" for="c">Course</label><select id="c"><option value="">None</option>' + courses.map(function (c) { return '<option value="' + c.id + '">' + h(c.title) + '</option>'; }).join('') + '</select></div></div>' +
        '<div class="row"><button class="btn primary" type="submit">Create cohort</button></div></form>';
      $('#nf').addEventListener('submit', function (e) {
        e.preventDefault();
        api.request('POST', '/api/cohorts', { title: $('#t').value, course_id: $('#c').value || null }).then(function (c) { location.hash = '#/cohorts/' + c.id; }, function (err) { L.formError($('#nf'), err.message); });
      });
    });
  };
  views.cohort = function (id) {
    if (!has('coach', 'editor')) return forbidden('Cohorts are managed by coaches and editors.');
    return api.get('/api/cohorts/' + id).then(function (c) {
      app.innerHTML = '<a class="back" href="#/cohorts">← Cohorts</a>' + head('Cohort', c.title, c.course_title ? 'Course: ' + c.course_title : 'No course linked', '<button class="btn danger" type="button" id="del">Delete</button>') +
        '<form class="card form" id="af" novalidate><div class="field"><label class="flabel" for="em">Add people by email <span class="hint">one per line or comma separated</span></label><textarea id="em" placeholder="riley@example.com"></textarea></div><div class="row"><button class="btn primary" type="submit">Add</button></div></form>' +
        '<div class="stack"><p class="section-title">Members · ' + c.members.length + '</p>' + (c.members.length ? '<div class="list">' + c.members.map(function (m) { return '<div class="li"><span class="main-col"><span class="t small">' + h(m.name) + '</span><span class="d">' + h(m.email) + '</span></span><button class="btn sm ghost" type="button" data-rm="' + m.id + '">Remove</button></div>'; }).join('') + '</div>' : '<div class="list"><p class="empty">No one yet.</p></div>') + '</div>';
      $('#af').addEventListener('submit', function (e) {
        e.preventDefault();
        var emails = $('#em').value.split(/[\s,;]+/).map(function (x) { return x.trim(); }).filter(Boolean);
        api.request('POST', '/api/cohorts/' + c.id + '/members', { emails: emails }).then(function (r) {
          L.toast(r.added + ' added' + (r.missing.length ? '. No account yet: ' + r.missing.join(', ') : ''));
          route();
        }, function (err) { L.formError($('#af'), err.message); });
      });
      $$('[data-rm]').forEach(function (b) { L.armed(b, 'Confirm', function () { api.request('DELETE', '/api/cohorts/' + c.id + '/members/' + b.getAttribute('data-rm')).then(route); }); });
      L.armed($('#del'), 'Tap again to delete', function () { api.request('DELETE', '/api/cohorts/' + c.id).then(function () { location.hash = '#/cohorts'; }); });
    });
  };

  /* The decision engine, kept as a tool. */
  views.engine = function () {
    var s = { h: 3, t: 2, b: 3, o: 'to', cert: 'low', state: 'N', need: 2, scr: false, debt: false, cover: false, drift: false };
    function seg(key, opts) { return '<div class="seg-btns" data-k="' + key + '">' + opts.map(function (o) { return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (String(s[key]) === String(o[0])) + '">' + o[1] + '</button>'; }).join('') + '</div>'; }
    function render() {
      var out = E.run(s), c = E.BY[out.call];
      app.innerHTML = '<a class="back" href="#/learn">← Learn</a>' + head('Decision engine', 'Set the read. Get one call.', 'Shot possibility = Height × Time × Balance.') +
        '<div class="grid-2"><div class="card"><ol class="four">' +
        '<li><span class="n">1</span><div><span class="k">Read</span><span class="v">' + h(out.read) + '</span></div></li>' +
        '<li><span class="n">2</span><div><span class="k">State + Need</span><span class="v">' + h(out.state) + '</span></div></li>' +
        '<li><span class="n">3</span><div><span class="k">Action</span><span class="act">' + h(c.name) + (c.seq ? '<span class="seq">' + h(c.seq) + '</span>' : '') + '</span></div></li>' +
        '<li><span class="n">4</span><div><span class="k">Why</span><span class="v">' + h(out.why) + '</span></div></li></ol>' +
        out.flags.map(function (f) { return '<p class="flag"><b>' + h(f.title) + '.</b> ' + h(f.text) + '</p>'; }).join('') + '</div>' +
        '<div class="stack" id="ctl">' +
        ['h', 't', 'b'].map(function (k) { return '<div class="field"><span class="flabel">' + { h: 'Height', t: 'Time', b: 'Balance' }[k] + '</span>' + seg(k, [[0, 'Zero'], [1, 'Low'], [2, 'Mod'], [3, 'High']]) + '</div>'; }).join('') +
        '<div class="field"><span class="flabel">Certainty</span>' + seg('cert', [['low', 'Low'], ['mod', 'Moderate'], ['high', 'High']]) + '</div>' +
        '<div class="field"><span class="flabel">State</span>' + seg('state', [['D', 'Defensive'], ['N', 'Neutral'], ['O', 'Offensive']]) + '</div>' +
        '<div class="field"><span class="flabel">Need</span>' + seg('need', E.RUNGS.slice(0, 3).map(function (r, i) { return [i, r]; })) + seg('need', E.RUNGS.slice(3).map(function (r, i) { return [i + 3, r]; })) + '</div>' +
        '<div class="field"><span class="flabel">Conditions</span>' + seg('scr', [[false, 'Structured'], [true, 'Scramble']]) + seg('debt', [[false, 'Debt paid'], [true, 'Debt unpaid']]) + seg('cover', [[false, 'No cover'], [true, 'Cover ready']]) + '</div>' +
        '</div></div>';
      $('#ctl').addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var k = b.parentNode.getAttribute('data-k'), v = b.getAttribute('data-v');
        s[k] = v === 'true' ? true : v === 'false' ? false : isNaN(v) ? v : Number(v);
        render();
      });
    }
    render();
  };

  /* ================= PROFILE ================= */
  views.profile = function () {
    return api.get('/api/me').then(function (m) {
      setMe(m);
      if (!m.athlete_id) return profileSetup();
      return api.get('/api/athletes/' + m.athlete_id).then(function (p) { profileView(p, m); });
    });
  };

  function profileSetup() {
    app.innerHTML = head('Profile', 'Set up your athlete profile') +
      '<div class="grid-2"><form class="card form" id="claim" novalidate><p class="section-title">My coach made a profile for me</p>' +
      '<p class="small muted">Enter the claim code your coach gave you. Your sessions, notes and results stay on that one profile.</p>' +
      '<div class="field"><label class="flabel" for="code">Claim code</label><input type="text" id="code" autocomplete="one-time-code" placeholder="ABCD-2345" maxlength="12" style="font-family:var(--mono);letter-spacing:.1em;text-transform:uppercase"></div>' +
      '<div class="row"><button class="btn primary" type="submit">Claim profile</button></div></form>' +
      '<form class="card form" id="own" novalidate><p class="section-title">I don’t have a coach yet</p>' +
      '<p class="small muted">Start your own profile. If a coach adds you later, they can connect to it instead of making a second one.</p>' +
      '<div class="form-grid"><div class="field"><label class="flabel" for="hand">Playing hand</label><select id="hand"><option value="">Choose</option>' + opts(HANDS) + '</select></div>' +
      '<div class="field"><label class="flabel" for="side">Preferred side</label><select id="side"><option value="">Choose</option>' + opts(SIDES) + '</select></div></div>' +
      '<div class="row"><button class="btn" type="submit">Start my profile</button></div></form></div>' + settingsHTML();
    $('#claim').addEventListener('submit', function (e) {
      e.preventDefault();
      api.request('POST', '/api/claim', { code: $('#code').value }).then(function () { L.toast('Profile claimed'); route(); }, function (err) { L.formError($('#claim'), err.status === 0 ? 'Claiming needs a connection.' : err.message); });
    });
    $('#own').addEventListener('submit', function (e) {
      e.preventDefault();
      api.request('POST', '/api/me/athlete', { hand: $('#hand').value, side: $('#side').value }).then(function () { route(); }, function (err) { L.formError($('#own'), err.message); });
    });
    bindSettings();
  }
  function opts(map, sel) { return Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + map[k] + '</option>'; }).join(''); }

  function notesHTML(notes, canSeePrivate) {
    if (!notes.length) return '<div class="list"><p class="empty">No notes yet.</p></div>';
    return '<div class="list">' + notes.map(function (n) {
      var tag = n.kind === 'reflection' ? '<span class="vis reflection">Athlete reflection</span>' : n.visibility === 'private' ? '<span class="vis private">Private · coaches only</span>' : '<span class="vis shared">Shared with athlete</span>';
      return '<div class="note ' + (n.visibility === 'private' ? 'private' : '') + '"><p class="body">' + h(n.body) + '</p>' +
        (n.media_id ? '<div class="media-grid" style="max-width:260px">' + mediaFigure({ id: n.media_id, mime: n.media_mime || 'image/jpeg' }) + '</div>' : '') +
        '<p class="meta">' + (canSeePrivate || n.kind === 'reflection' ? tag : '') + '<span>' + h(n.author || '') + '</span><span>' + h(L.when(n.created_at)) + '</span>' + (n._pending ? '<span class="status local">On device</span>' : '') + '</p></div>';
    }).join('') + '</div>';
  }
  function resultsHTML(results) {
    if (!results.length) return '<div class="list"><p class="empty">No session results yet.</p></div>';
    return '<div class="list">' + results.map(function (r) {
      return '<a class="li" href="#/train/' + h(r.session_id) + '"><span class="main-col"><span class="t">' + h(r.title) + '</span><span class="d">' + r.items.map(function (it) { return h(it.name) + ': ' + h(cellText(it, it)); }).join(' · ') + '</span></span><span class="side"><span>' + h(L.when(r.started_at)) + '</span></span></a>';
    }).join('') + '</div>';
  }

  function pendingNotes(aid) {
    return L.outbox().filter(function (q) { return q.method === 'POST' && q.path === '/api/athletes/' + aid + '/notes'; })
      .map(function (q) { return { body: q.body.body, visibility: q.body.visibility || 'shared', kind: q.kind || 'reflection', author: ME.user.name, created_at: new Date(q.at).toISOString(), _pending: true }; });
  }

  function profileView(p, m) {
    var a = p.athlete;
    var notes = pendingNotes(a.id).concat(p.notes);
    var coachNotes = notes.filter(function (n) { return n.kind === 'coach'; });
    var reflections = notes.filter(function (n) { return n.kind === 'reflection'; });
    app.innerHTML = offlineNote(p) +
      '<div class="pcard">' + avatar(a) + '<div><p class="pid">' + playerId(a.id) + '</p><h1>' + h(a.name) + '</h1><p class="facts">' +
      '<span>Hand <b>' + h(HANDS[a.hand] || '—') + '</b></span><span>Side <b>' + h(SIDES[a.side] || '—') + '</b></span><span>Rating <b>' + h(a.rating || '—') + '</b></span></p></div></div>' +
      '<details class="more" id="qrbox"><summary>Check-in QR \u00b7 ' + playerId(a.id) + '</summary><div class="qr-wrap" id="qr"><p class="small muted">Loading\u2026</p></div></details>' +
      '<div class="row"><a class="btn ghost" href="#/play">Match history</a><a class="btn ghost" href="#/play/leaderboard">Leaderboard</a></div>' +
      '<div class="grid-2">' +
      '<div class="stack"><p class="section-title">Development</p>' +
      '<div class="focus-card"><p class="eyebrow">Current focus · set by your coach</p><p class="big">' + h(a.focus || 'Not set yet') + '</p></div>' +
      (a.plan ? '<div class="card"><p class="section-title">Development plan</p><div class="small">' + L.paras(a.plan) + '</div></div>' : '') +
      '<form class="card form" id="me-f" novalidate><p class="section-title">About me</p>' +
      '<div class="field"><label class="flabel" for="goals">Goals</label><textarea id="goals" maxlength="2000">' + h(a.goals) + '</textarea></div>' +
      '<div class="form-grid"><div class="field"><label class="flabel" for="hand">Playing hand</label><select id="hand"><option value="">—</option>' + opts(HANDS, a.hand) + '</select></div>' +
      '<div class="field"><label class="flabel" for="side">Preferred side</label><select id="side"><option value="">—</option>' + opts(SIDES, a.side) + '</select></div>' +
      '<div class="field"><label class="flabel" for="rating">Rating</label><input type="text" id="rating" maxlength="20" value="' + h(a.rating) + '" placeholder="e.g. 4.0"></div></div>' +
      '<div class="row"><button class="btn" type="submit">Save</button></div></form>' +
      '<div class="field"><span class="flabel">Profile photo</span><input type="file" id="photo" accept="image/*"><div class="upload-row" id="photo-prog" hidden><div class="progress"><i></i></div></div></div>' +
      '</div>' +
      '<div class="stack"><p class="section-title">Notes from your coach</p>' + notesHTML(coachNotes, false) +
      '<p class="section-title" id="reflect">My reflections</p>' +
      '<form class="card form" id="rf" novalidate><div class="field"><label class="flabel" for="rtext">How did it go?</label><textarea id="rtext" maxlength="5000" placeholder="What felt good, what broke down, what to try next."></textarea><p class="small muted">Your coach can see your reflections.</p></div>' +
      '<div class="row"><button class="btn primary" type="submit">Save reflection</button></div></form>' + notesHTML(reflections, true) +
      (p.media.length ? '<p class="section-title">Photos and video</p><div class="media-grid">' + p.media.map(mediaFigure).join('') + '</div>' : '') +
      '<p class="section-title">Session results</p>' + resultsHTML(p.results) +
      '</div></div>' + settingsHTML();

    $('#me-f').addEventListener('submit', function (e) {
      e.preventDefault();
      api.request('PUT', '/api/athletes/' + a.id, { goals: $('#goals').value, hand: $('#hand').value, side: $('#side').value, rating: $('#rating').value })
        .then(function () { L.toast('Saved'); }, function (err) { L.formError($('#me-f'), err.status === 0 ? 'Profile edits need a connection.' : err.message); });
    });
    $('#rf').addEventListener('submit', function (e) {
      e.preventDefault();
      var text = $('#rtext').value.trim(); if (!text) return;
      L.queue({ method: 'POST', path: '/api/athletes/' + a.id + '/notes', body: { body: text, client_id: L.uuid() }, kind: 'reflection', label: 'Reflection' });
      L.toast(L.isOnline() ? 'Reflection saved' : 'Saved on this device. It’ll sync when you’re online.');
      setTimeout(route, 300);
    });
    $('#photo').addEventListener('change', function () {
      var f = this.files[0]; if (!f) return;
      var prog = $('#photo-prog'); prog.hidden = false;
      api.upload(f, 'athlete_id=' + a.id, function (x) { $('i', prog).style.width = Math.round(x * 100) + '%'; })
        .then(function (m) { return api.request('PUT', '/api/athletes/' + a.id + '/photo', { media_id: m.id }); })
        .then(function () { L.toast('Photo updated'); route(); }, function (err) { prog.hidden = true; L.toast(err.message); });
    });
    bindSettings();
    $('#qrbox').addEventListener('toggle', function once() {
      $('#qrbox').removeEventListener('toggle', once);
      api.get('/api/me/checkin').then(function (c) {
        $('#qr').innerHTML = '<div class="qr">' + window.LabQR.svg(c.qr, { label: 'Check-in QR for ' + a.name }) + '</div><p class="small">Show this at check-in. Can\u2019t scan? Give the organizer <b class="mono">' + h(c.player_id) + '</b> or code <b class="mono">' + h(c.code) + '</b>.</p>';
      }, function (err) { $('#qr').innerHTML = '<p class="small muted">' + h(err.status === 0 ? 'Open this once with a connection to save your QR on this device.' : err.message) + '</p>'; });
    });
    if (location.hash.indexOf('#reflect') > 0) setTimeout(function () { $('#rtext').focus(); }, 50);
  }

  function settingsHTML() {
    var staff = [];
    if (has('coach')) staff.push('<a href="#/coach"><b>Coach Workspace</b><span>Athletes, notes, sessions</span></a>');
    if (has('contributor', 'editor')) staff.push('<a href="#/studio"><b>Publishing Studio</b><span>Write and publish</span></a>');
    if (has('admin')) staff.push('<a href="#/admin"><b>Admin</b><span>People and permissions</span></a>');
    return (staff.length ? '<div class="stack"><p class="section-title">Staff</p><div class="staff">' + staff.join('') + '</div></div>' : '') +
      '<div class="stack"><p class="section-title">Account</p><div class="card stack">' +
      '<p><b>' + h(ME.user.name) + '</b> · <span class="muted">' + h(ME.user.email) + '</span></p>' +
      '<p class="small muted">Roles: ' + h(ME.user.roles.join(', ')) + '</p>' +
      '<p class="small" id="memline"></p>' +
      '<details class="more"><summary>' + (ME.has_password === false ? 'Set a password' : 'Change password') + '</summary><form class="form" id="pwf" novalidate>' +
      (ME.has_password === false ? '<p class="small muted">You sign in with Google. A password lets you sign in with your email too.</p>' : '<div class="field"><label class="flabel" for="cur">Current password</label><input type="password" id="cur" autocomplete="current-password"></div>') +
      '<div class="field"><label class="flabel" for="npw">New password</label><input type="password" id="npw" autocomplete="new-password"></div>' +
      '<div class="row"><button class="btn" type="submit">Change password</button></div></form></details>' +
      '<details class="more" id="prefs"><summary>Notifications and privacy</summary><div id="prefbox" class="stack-sm"><p class="small muted">Loading\u2026</p></div></details>' +
      '<details class="more"><summary>Privacy</summary><div class="small stack-sm"><p>Your coach sees your profile, results, reflections and shared media. Other athletes never see your profile or results.</p><p>Coaches can keep private notes about you. Those are for coaching staff only. Notes marked “Shared” are the ones written for you.</p><p>Published Field Notes are public. Nothing else in THE LAB is.</p></div></details>' +
      '<details class="more"><summary>Delete account</summary><form class="form" id="delf" novalidate><p class="small">This deletes your login, your reflections and the photos and video you uploaded. If a coach created your profile, they keep the session results they recorded, no longer linked to you. This can’t be undone.</p>' +
      (ME.has_password === false ? '<div class="field"><label class="flabel" for="dpw">Type DELETE to confirm</label><input type="text" id="dpw" autocomplete="off"></div>' : '<div class="field"><label class="flabel" for="dpw">Password</label><input type="password" id="dpw" autocomplete="current-password"></div>') +
      '<div class="row"><button class="btn danger" type="button" id="delbtn">Delete my account</button></div></form></details>' +
      '<div class="row"><button class="btn" type="button" id="signout">Sign out</button></div></div></div>';
  }
  /* Phone notifications (Web Push). iPhone needs the app added to the Home Screen first. */
  function pushControls() {
    var box = $('#pushbox'); if (!box) return;
    if (!META.push) { box.innerHTML = '<p class="small muted">Phone notifications aren\u2019t switched on for THE LAB yet. Everything still shows in the bell.</p>'; return; }
    var ios = /iPhone|iPad/.test(navigator.userAgent), standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      box.innerHTML = '<p class="small muted">' + (ios && !standalone ? 'On iPhone, add THE LAB to your Home Screen (Share \u2192 Add to Home Screen), open it from there, then turn on phone notifications here.' : 'This browser can\u2019t show phone notifications.') + '</p>'; return;
    }
    navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription().then(function (sub) { return { reg: reg, sub: sub }; }); }).then(function (x) {
      var on = !!x.sub && Notification.permission === 'granted';
      box.innerHTML = '<label class="tog" for="pushon"><input type="checkbox" id="pushon"' + (on ? ' checked' : '') + '><div><b>Phone notifications on this device</b><span>' + (Notification.permission === 'denied' ? 'Blocked in your browser settings. Allow notifications for this site to turn them on.' : 'Courts, reminders, coach feedback and the rest, even when THE LAB is closed.') + '</span></div></label>' + (on ? '<button class="btn sm ghost" type="button" id="pushtest">Send a test</button>' : '');
      $('#pushon').addEventListener('change', function () {
        var cb = this;
        if (cb.checked) {
          Notification.requestPermission().then(function (perm) {
            if (perm !== 'granted') throw new Error('Notifications weren\u2019t allowed.');
            return api.get('/api/push/key');
          }).then(function (k) {
            var raw = atob(k.publicKey.replace(/-/g, '+').replace(/_/g, '/')), key = new Uint8Array(raw.length);
            for (var i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
            return x.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
          }).then(function (sub) { return api.request('POST', '/api/push/subscribe', sub.toJSON()); })
            .then(function () { L.toast('Phone notifications on'); pushControls(); }, function (err) { cb.checked = false; L.toast(err.message || 'Couldn\u2019t turn on notifications.'); });
        } else if (x.sub) {
          var ep = x.sub.endpoint;
          x.sub.unsubscribe().then(function () { return api.request('POST', '/api/push/unsubscribe', { endpoint: ep }); }).then(function () { L.toast('Phone notifications off'); pushControls(); }, function () { pushControls(); });
        }
      });
      if ($('#pushtest')) $('#pushtest').addEventListener('click', function () { api.request('POST', '/api/push/test', {}).then(function () { L.toast('Test sent'); }, function (err) { L.toast(err.message); }); });
    }, function () { box.innerHTML = '<p class="small muted">Phone notifications need the app to finish installing. Reopen THE LAB and try again.</p>'; });
  }
  function bindSettings() {
    api.get('/api/me/learning').then(function (d) {
      var el = $('#memline'); if (!el) return;
      var m = d.membership;
      el.innerHTML = (m && m.active ? '<span class="tag ok">Member</span> ' + h(m.plan) + (m.expires_at ? ' \u00b7 until ' + h(new Date(m.expires_at).toLocaleDateString()) : '') : '<span class="tag">Not a member</span>') +
        (d.cohorts.length ? ' \u00b7 Cohorts: ' + d.cohorts.map(function (c) { return h(c.title); }).join(', ') : '');
    }, function () {});
    $('#prefs').addEventListener('toggle', function once() {
      $('#prefs').removeEventListener('toggle', once);
      api.get('/api/me/prefs').then(function (d) {
        $('#prefbox').innerHTML = '<div id="pushbox"></div><p class="small muted">Choose what you\u2019re told about. These apply to the bell and to phone notifications.</p>' + Object.keys(d.labels).map(function (k) {
          return '<label class="tog" for="pf-' + k + '"><input type="checkbox" id="pf-' + k + '" data-pref="' + k + '"' + (d.prefs[k] ? ' checked' : '') + '><div><b>' + h(d.labels[k]) + '</b></div></label>';
        }).join('');
        $('#prefbox').addEventListener('change', function (e) {
          var k = e.target.getAttribute('data-pref'); if (!k) return;
          var body = {}; body[k] = e.target.checked;
          api.request('PUT', '/api/me/prefs', body).then(function () { L.toast('Saved'); }, function (err) { e.target.checked = !e.target.checked; L.toast(err.message); });
        });
      }, function (err) { $('#prefbox').innerHTML = '<p class="small muted">' + h(err.status === 0 ? 'Settings need a connection.' : err.message) + '</p>'; });
    });
    $('#prefs').addEventListener('toggle', function oncePush() { $('#prefs').removeEventListener('toggle', oncePush); setTimeout(pushControls, 50); });
    if (location.hash.indexOf('#prefs') > 0) { $('#prefs').open = true; setTimeout(function () { $('#prefs').scrollIntoView(); }, 50); }
    $('#signout').addEventListener('click', function () {
      var pending = L.outbox().length;
      function go() { api.request('POST', '/api/auth/logout').then(null, function () {}).then(function () { setMe(null); location.hash = '#/signin'; }); }
      if (pending) { L.toast(pending + ' change' + (pending > 1 ? 's' : '') + ' still waiting to sync. Sign out anyway?', { label: 'Sign out', run: go }); } else go();
    });
    $('#pwf').addEventListener('submit', function (e) {
      e.preventDefault();
      api.request('POST', '/api/me/password', { current: $('#cur') ? $('#cur').value : undefined, password: $('#npw').value }).then(function () { L.toast('Password saved. Other devices were signed out.'); if (ME.has_password === false) { ME.has_password = true; setMe(ME); } $('#pwf').reset(); }, function (err) { L.formError($('#pwf'), err.message); });
    });
    L.armed($('#delbtn'), 'Tap again to delete forever', function () {
      api.request('POST', '/api/me/delete', ME.has_password === false ? { confirm: $('#dpw').value.trim() } : { password: $('#dpw').value }).then(function () {
        Store.keys('').forEach(Store.del); setMe(null); location.hash = '#/signin'; L.toast('Your account was deleted.');
      }, function (err) { L.formError($('#delf'), err.message); });
    });
  }

  /* ================= COACH WORKSPACE ================= */
  views.coach = function () {
    if (!has('coach')) return forbidden('Coach Workspace is for coaches.');
    return api.get('/api/athletes').then(function (list) {
      app.innerHTML = offlineNote(list) + head('Coach Workspace', 'Athletes', list.length + ' on your roster', '<div class="row"><a class="btn ghost" href="#/coach/templates">Templates</a><a class="btn ghost" href="#/cohorts">Cohorts</a><a class="btn primary" href="#/coach/new">New athlete</a></div>') +
        '<input type="search" id="q" placeholder="Search athletes" aria-label="Search athletes">' +
        '<div class="list" id="roster">' + (list.length ? list.map(function (a) {
          return '<a class="li" href="#/coach/' + a.id + '" data-name="' + h(a.name.toLowerCase()) + '"><span class="who">' + avatar(a, 'sm') + '<span class="main-col"><span class="t">' + h(a.name) + '</span><span class="d">' + h(a.focus || 'No focus set') + '</span></span></span>' +
            '<span class="side">' + (a.claimed ? '<span class="tag ok">Claimed</span>' : '<span class="tag">Not claimed</span>') + (a.last_session ? '<span>' + h(L.when(a.last_session)) + '</span>' : '') + '</span></a>';
        }).join('') : '<p class="empty">No athletes yet. Create a profile and give the athlete the claim code.</p>') + '</div>';
      $('#q').addEventListener('input', function () { var q = this.value.toLowerCase(); $$('#roster .li').forEach(function (l) { l.hidden = l.getAttribute('data-name').indexOf(q) < 0; }); });
    });
  };

  views.coachNew = function () {
    if (!has('coach')) return forbidden('Coach Workspace is for coaches.');
    app.innerHTML = '<a class="back" href="#/coach">← Athletes</a>' + head('Coach Workspace', 'New athlete profile', 'You’ll get a claim code. The athlete enters it after creating their account, and this profile becomes theirs with its history intact.') +
      '<form class="card form" id="f" novalidate>' +
      '<div class="field"><label class="flabel" for="nm">Name</label><input type="text" id="nm" maxlength="80"></div>' +
      '<div class="field"><label class="flabel" for="em">Athlete’s email <span class="hint">optional, locks the claim to this email</span></label><input type="email" id="em"></div>' +
      '<div class="form-grid"><div class="field"><label class="flabel" for="hand">Playing hand</label><select id="hand"><option value="">—</option>' + opts(HANDS) + '</select></div>' +
      '<div class="field"><label class="flabel" for="side">Preferred side</label><select id="side"><option value="">—</option>' + opts(SIDES) + '</select></div>' +
      '<div class="field"><label class="flabel" for="rating">Rating</label><input type="text" id="rating" maxlength="20"></div></div>' +
      '<div class="field"><label class="flabel" for="focus">Current focus</label><input type="text" id="focus" maxlength="500" placeholder="e.g. Third-shot drop depth"></div>' +
      '<div class="row"><button class="btn primary" type="submit">Create profile</button></div></form>';
    $('#f').addEventListener('submit', function (e) {
      e.preventDefault();
      api.request('POST', '/api/athletes', { name: $('#nm').value, claim_email: $('#em').value, hand: $('#hand').value, side: $('#side').value, rating: $('#rating').value, focus: $('#focus').value })
        .then(function (r) { pendingCode = { athlete: r.athlete, code: r.claim_code }; location.hash = '#/coach/' + r.athlete.id + '/code'; }, function (err) { L.formError($('#f'), err.status === 0 ? 'Creating a profile needs a connection.' : err.message); });
    });
  };
  /* The code lives only in memory: reloading this screen doesn't reveal it again. */
  var pendingCode = null;
  views.coachCode = function (id) {
    var pc = pendingCode; pendingCode = null;
    if (!pc || String(pc.athlete.id) !== String(id)) { location.replace('#/coach/' + id); return; }
    showCode(pc.athlete, pc.code);
  };
  function showCode(a, code) {
    app.innerHTML = '<a class="back" href="#/coach/' + a.id + '">← ' + h(a.name) + '</a>' + head('Claim code', 'Give this to ' + a.name.split(' ')[0]) +
      '<div class="card stack"><p class="code-box">' + h(code) + '</p>' +
      '<p class="small">They create an account' + (a.claim_email ? ' with <b>' + h(a.claim_email) + '</b>' : '') + ', open Profile, and enter this code. It works once. It won’t be shown again; you can issue a new one from their profile.</p>' +
      '<div class="row"><button class="btn primary" type="button" id="cp">Copy code</button><a class="btn" href="#/coach/' + a.id + '">Open profile</a></div></div>';
    $('#cp').addEventListener('click', function () { L.copy(code); });
  }

  views.coachAthlete = function (id) {
    if (!has('coach')) return forbidden('Coach Workspace is for coaches.');
    return api.get('/api/athletes/' + id).then(function (p) {
      var a = p.athlete;
      var notes = pendingNotes(a.id).concat(p.notes);
      app.innerHTML = '<a class="back" href="#/coach">← Athletes</a>' + offlineNote(p) +
        '<div class="pcard">' + avatar(a) + '<div><p class="pid">' + playerId(a.id) + (a.claimed ? ' · claimed' : ' · not claimed yet') + '</p><h1>' + h(a.name) + '</h1><p class="facts">' +
        '<span>Hand <b>' + h(HANDS[a.hand] || '—') + '</b></span><span>Side <b>' + h(SIDES[a.side] || '—') + '</b></span><span>Rating <b>' + h(a.rating || '—') + '</b></span></p></div></div>' +
        '<div class="row"><a class="btn primary" href="#/train/new?athlete=' + a.id + '">Start session</a><a class="btn" href="#/train/new?quick=1&athlete=' + a.id + '">Counter</a>' +
        (!a.claimed ? '<button class="btn ghost" type="button" id="newcode">New claim code</button>' : '') + '</div>' +
        '<div class="grid-2"><div class="stack">' +
        '<form class="card form" id="nf" novalidate><p class="section-title">Add a note</p>' +
        '<div class="field"><label class="flabel" for="nbody">Note</label><textarea id="nbody" maxlength="5000"></textarea></div>' +
        '<div class="field"><span class="flabel">Who can see it</span><div class="seg-btns" id="vis"><button type="button" data-v="private" aria-pressed="true">Private · coaches only</button><button type="button" data-v="shared" aria-pressed="false">Shared with athlete</button></div></div>' +
        '<div class="field"><label class="flabel" for="nfile">Photo or video <span class="hint">optional</span></label><input type="file" id="nfile" accept="image/*,video/*"><div class="upload-row" id="nprog" hidden><div class="progress"><i></i></div><span class="small muted" id="nprog-t"></span></div></div>' +
        '<div class="row"><button class="btn primary" type="submit">Save note</button></div></form>' +
        '<form class="card form" id="af" novalidate><p class="section-title">Assign training</p><div class="form-grid">' +
        '<div class="field"><label class="flabel" for="atpl">Template</label><select id="atpl"><option value="">No template</option></select></div>' +
        '<div class="field"><label class="flabel" for="atitle">Title</label><input type="text" id="atitle" maxlength="120" placeholder="Defaults to the template name"></div>' +
        '<div class="field"><label class="flabel" for="adue">Due</label><input type="date" id="adue"></div></div>' +
        '<div class="field"><label class="flabel" for="anote">Note</label><input type="text" id="anote" maxlength="2000" placeholder="What to focus on"></div>' +
        '<div class="row"><button class="btn" type="submit">Assign</button></div></form>' +
        '<div class="stack" id="asglist"></div>' +
        '<p class="section-title">Notes and reflections</p>' + notesHTML(notes, true) +
        '</div><div class="stack">' +
        '<form class="card form" id="pf" novalidate><p class="section-title">Development</p>' +
        '<div class="field"><label class="flabel" for="focus">Current focus</label><input type="text" id="focus" maxlength="500" value="' + h(a.focus) + '"></div>' +
        '<div class="field"><label class="flabel" for="plan">Development plan</label><textarea id="plan" maxlength="4000">' + h(a.plan) + '</textarea></div>' +
        '<div class="field"><label class="flabel" for="goals">Athlete goals</label><textarea id="goals" maxlength="2000">' + h(a.goals) + '</textarea></div>' +
        '<div class="form-grid"><div class="field"><label class="flabel" for="hand">Hand</label><select id="hand"><option value="">—</option>' + opts(HANDS, a.hand) + '</select></div>' +
        '<div class="field"><label class="flabel" for="side">Side</label><select id="side"><option value="">—</option>' + opts(SIDES, a.side) + '</select></div>' +
        '<div class="field"><label class="flabel" for="rating">Rating</label><input type="text" id="rating" maxlength="20" value="' + h(a.rating) + '"></div></div>' +
        '<div class="row"><button class="btn" type="submit">Save</button></div></form>' +
        (p.media.length ? '<p class="section-title">Media</p><div class="media-grid">' + p.media.map(mediaFigure).join('') + '</div>' : '') +
        '<p class="section-title">Session results</p>' + resultsHTML(p.results) +
        '<p class="small muted">Coaches: ' + h(p.coaches.map(function (c) { return c.name; }).join(', ')) + '</p>' +
        '</div></div>';

      api.get('/api/templates').then(function (ts) { $('#atpl').innerHTML += ts.map(function (t) { return '<option value="' + t.id + '">' + h(t.name) + '</option>'; }).join(''); }, function () {});
      api.get('/api/athletes/' + a.id + '/assignments').then(function (as) {
        if (!as.length) return;
        $('#asglist').innerHTML = '<p class="section-title">Assigned training</p>' + assignmentList(as, true, a.id);
        bindAssignments($('#asglist'));
      }, function () {});
      $('#af').addEventListener('submit', function (e) {
        e.preventDefault();
        api.request('POST', '/api/athletes/' + a.id + '/assignments', { template_id: $('#atpl').value || undefined, title: $('#atitle').value, due_on: $('#adue').value || undefined, note: $('#anote').value })
          .then(function () { L.toast('Assigned. ' + a.name.split(' ')[0] + ' was notified.'); route(); }, function (err) { L.formError($('#af'), err.status === 0 ? 'Assigning needs a connection.' : err.message); });
      });
      var vis = 'private';
      $('#vis').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; vis = b.getAttribute('data-v'); $$('#vis button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); });
      var pendingUpload = null;
      $('#nf').addEventListener('submit', function (e) {
        e.preventDefault();
        var text = $('#nbody').value.trim(); if (!text) return L.formError($('#nf'), 'Write the note first.');
        var file = $('#nfile').files[0];
        function saveNote(mediaId) {
          L.queue({ method: 'POST', path: '/api/athletes/' + a.id + '/notes', body: { body: text, visibility: vis, client_id: L.uuid(), media_id: mediaId || undefined }, kind: 'coach', label: 'Note for ' + a.name });
          L.toast(L.isOnline() ? 'Note saved' : 'Saved on this device. It’ll sync when you’re online.');
          setTimeout(route, 300);
        }
        if (!file) return saveNote();
        if (!L.isOnline()) {
          return L.queueUpload(file, 'athlete_id=' + a.id + '&visibility=' + vis, file.name + ' for ' + a.name).then(saveNote, function () { L.formError($('#nf'), 'This browser can\u2019t store the file offline. Remove it to save the note, or try again with a connection.'); });
        }
        pendingUpload = pendingUpload || L.uuid();
        var prog = $('#nprog'); prog.hidden = false;
        $('#nprog-t').textContent = 'Uploading ' + file.name;
        api.upload(file, 'athlete_id=' + a.id + '&visibility=' + vis, function (x) { $('i', prog).style.width = Math.round(x * 100) + '%'; $('#nprog-t').textContent = Math.round(x * 100) + '% of ' + file.name; }, pendingUpload)
          .then(function (m) { saveNote(m.id); }, function (err) { $('#nprog-t').textContent = err.message + ' Tap Save note to retry.'; });
      });
      $('#pf').addEventListener('submit', function (e) {
        e.preventDefault();
        api.request('PUT', '/api/athletes/' + a.id, { focus: $('#focus').value, plan: $('#plan').value, goals: $('#goals').value, hand: $('#hand').value, side: $('#side').value, rating: $('#rating').value })
          .then(function () { L.toast('Saved'); }, function (err) { L.formError($('#pf'), err.message); });
      });
      if ($('#newcode')) $('#newcode').addEventListener('click', function () {
        api.request('POST', '/api/athletes/' + a.id + '/claim-code', {}).then(function (r) { pendingCode = { athlete: a, code: r.claim_code }; location.hash = '#/coach/' + a.id + '/code'; }, function (err) { L.toast(err.message); });
      });
    });
  };

  /* ================= PUBLISHING STUDIO ================= */
  var STATUS_LABEL = { draft: 'Draft', in_review: 'In review', scheduled: 'Scheduled', published: 'Published', local: 'On device' };
  function localDrafts() {
    return Store.keys('draft:local-').map(function (k) { var d = Store.get(k); return d && Object.assign({ id: k.slice(6), status: 'local' }, d.fields, { updated_at: new Date(d.savedAt).toISOString() }); }).filter(Boolean);
  }

  views.studio = function () {
    if (!has('contributor', 'editor')) return forbidden('The Publishing Studio is for contributors and editors.');
    return api.get('/api/studio/posts').then(null, function (err) { if (err.status === 0) return []; throw err; }).then(function (posts) {
      posts = localDrafts().concat(posts);
      var groups = ['local', 'in_review', 'draft', 'scheduled', 'published'];
      app.innerHTML = offlineNote(posts) + head('Publishing Studio', has('editor') ? 'All posts' : 'Your posts', 'Quick Read, The Work and Field Study. Drafts save on this device as you type.', '<div class="row">' + (has('editor') ? '<a class="btn" href="#/studio/courses">Courses</a>' : '') + '<a class="btn primary" href="#/studio/new">New post</a></div>') +
        groups.map(function (g) {
          var list = posts.filter(function (p) { return p.status === g; });
          if (!list.length) return '';
          return '<div class="stack"><p class="section-title">' + STATUS_LABEL[g] + ' · ' + list.length + '</p><div class="list">' + list.map(function (p) {
            return '<a class="li" href="#/studio/' + h(p.id) + '"><span class="main-col"><span class="lane">' + h(LANES[p.lane] || '') + '</span><span class="t">' + h(p.title || 'Untitled') + '</span><span class="d">' + h(p.author_name || ME.user.name) + ' · ' + h(L.when(p.status === 'scheduled' ? p.publish_at : p.updated_at)) + (p.review_note && p.status === 'draft' ? ' · Editor note: ' + h(p.review_note) : '') + '</span></span><span class="side"><span class="status ' + p.status + '">' + STATUS_LABEL[p.status] + '</span></span></a>';
          }).join('') + '</div></div>';
        }).join('') + (posts.length ? '' : '<div class="list"><p class="empty">No posts yet.</p></div>');
    });
  };

  views.studioEdit = function (id) {
    if (!has('contributor', 'editor')) return forbidden('The Publishing Studio is for contributors and editors.');
    if (id === 'new') { location.replace('#/studio/local-' + L.uuid()); return; }
    var isLocal = id.indexOf('local-') === 0;
    var key = 'draft:' + id;
    var load = isLocal ? Promise.resolve(null) : api.get('/api/studio/posts/' + id);
    return load.then(function (srv) {
      var saved = Store.get(key);
      var p = srv || { id: id, lane: 'quick_read', title: '', summary: '', body: '', tags: [], author_credit: ME.user.name, status: 'local', version: 0, media: [] };
      var f = { lane: p.lane, title: p.title, summary: p.summary, body: p.body, tags: (p.tags || []).join(', '), author_credit: p.author_credit, thumbnail_media_id: p.thumbnail_media_id || null };
      var banner = '';
      if (saved && srv && JSON.stringify(saved.fields) !== JSON.stringify(f)) {
        banner = saved.baseVersion === srv.version
          ? '<div class="banner" id="restore"><span>Unsaved changes from ' + h(L.when(new Date(saved.savedAt).toISOString())) + ' are on this device.</span><span class="row"><button class="btn sm primary" type="button" data-r="keep">Restore them</button><button class="btn sm ghost" type="button" data-r="drop">Discard</button></span></div>'
          : '<div class="banner" id="restore"><span>This device has edits made to an older version (someone changed the post since). Restoring puts your text over the latest version.</span><span class="row"><button class="btn sm primary" type="button" data-r="keep">Use my text</button><button class="btn sm ghost" type="button" data-r="drop">Keep latest</button></span></div>';
      } else if (saved && isLocal) { f = saved.fields; }
      var editor = has('editor');
      var liveNoEdit = !editor && (p.status === 'published' || p.status === 'scheduled');
      var dirty = false, preview = false;

      function actions() {
        var b = [];
        if (!liveNoEdit) b.push('<button class="btn" type="button" id="save">' + (isLocal ? 'Save draft' : 'Save') + '</button>');
        if (!isLocal && p.status === 'draft') b.push('<button class="btn primary" type="button" id="submit">Submit for review</button>');
        if (!isLocal && editor && ['draft', 'in_review', 'scheduled'].indexOf(p.status) >= 0) b.push('<button class="btn primary" type="button" id="publish">Publish now</button>');
        if (!isLocal && editor && p.status === 'in_review') b.push('<button class="btn ghost" type="button" id="return">Return to author</button>');
        if (!isLocal && editor && (p.status === 'published' || p.status === 'scheduled')) b.push('<button class="btn ghost" type="button" id="unpub">Unpublish</button>');
        b.push('<button class="btn ghost" type="button" id="prev">' + (preview ? 'Edit' : 'Preview') + '</button>');
        if (isLocal || p.status !== 'published' || editor) b.push('<button class="btn danger" type="button" id="del">Delete</button>');
        return b.join('');
      }

      function render() {
        app.innerHTML = '<a class="back" href="#/studio">← Studio</a>' + banner +
          '<div class="head-row"><div class="row"><span class="status ' + p.status + '">' + STATUS_LABEL[p.status] + '</span>' + (p.status === 'scheduled' ? '<span class="small mono">for ' + h(L.when(p.publish_at)) + '</span>' : '') + (p.status === 'published' ? '<a class="small" href="#/learn/' + h(p.slug) + '">View live →</a>' : '') + '</div><span class="small muted mono" id="savestate"></span></div>' +
          (p.review_note && p.status === 'draft' ? '<p class="flag"><b>Editor note.</b> ' + h(p.review_note) + '</p>' : '') +
          (liveNoEdit ? '<p class="flag"><b>This post is live.</b> Ask an editor to change it.</p>' : '') +
          (preview ? '<article class="article card">' + articleHTML(Object.assign({}, p, f, { tags: tagList(f.tags), lane_name: LANES[f.lane], published_at: p.published_at }), p.media.filter(function (m) { return m.id !== f.thumbnail_media_id; })) + '</article>' :
          '<form class="form" id="ef" novalidate>' +
          '<div class="field"><span class="flabel">Lane</span><div class="seg-btns" id="lane">' + Object.keys(LANES).map(function (k) { return '<button type="button" data-v="' + k + '" aria-pressed="' + (f.lane === k) + '"' + (liveNoEdit ? ' disabled' : '') + '>' + LANES[k] + '</button>'; }).join('') + '</div></div>' +
          '<input class="editor-title" type="text" id="title" placeholder="Title" maxlength="160" aria-label="Title" value="' + h(f.title) + '"' + (liveNoEdit ? ' disabled' : '') + '>' +
          '<div class="field"><label class="flabel" for="summary">Caption / summary</label><input type="text" id="summary" maxlength="400" value="' + h(f.summary) + '"' + (liveNoEdit ? ' disabled' : '') + '></div>' +
          '<div class="field"><label class="flabel" for="body">Body <span class="hint">' + RICH_HINT + '</span></label><textarea class="editor-body" id="body" maxlength="60000"' + (liveNoEdit ? ' disabled' : '') + '>' + h(f.body) + '</textarea></div>' +
          '<div class="form-grid"><div class="field"><label class="flabel" for="tags">Tags <span class="hint">comma separated</span></label><input type="text" id="tags" value="' + h(f.tags) + '"' + (liveNoEdit ? ' disabled' : '') + '></div>' +
          '<div class="field"><label class="flabel" for="credit">Author credit</label><input type="text" id="credit" maxlength="120" value="' + h(f.author_credit) + '"' + (liveNoEdit ? ' disabled' : '') + '></div></div>' +
          '<div class="stack"><p class="section-title">Photos and video</p>' +
          (isLocal ? '<p class="small muted">Save once with a connection to start adding photos and video.</p>' :
            '<div class="field"><label class="flabel" for="up">Add a photo or short video</label><input type="file" id="up" accept="image/*,video/*" multiple' + (liveNoEdit ? ' disabled' : '') + '></div><div id="uploads" class="stack-sm"></div>' +
            (p.media.length ? '<div class="media-grid">' + p.media.map(function (m) {
              return '<figure>' + (m.mime.indexOf('video/') === 0 ? '<video muted playsinline preload="metadata" src="/api/media/' + h(m.id) + '"></video>' : '<img alt="" src="/api/media/' + h(m.id) + '">') +
                (m.id === f.thumbnail_media_id ? '<span class="vis shared">Thumbnail</span>' : m.mime.indexOf('image/') === 0 && !liveNoEdit ? '<button class="btn sm" style="position:absolute;left:6px;bottom:6px" type="button" data-thumb="' + h(m.id) + '">Use as thumbnail</button>' : '') +
                (!liveNoEdit ? '<button class="btn sm" style="position:absolute;right:6px;top:6px" type="button" data-ins="' + h(m.id) + '">Insert</button>' : '') + '</figure>';
            }).join('') + '</div>' : '')) +
          '</div>' +
          (editor && !isLocal ? '<details class="more"><summary>Schedule</summary><div class="form-grid"><div class="field"><label class="flabel" for="when">Publish at</label><input type="datetime-local" id="when"></div></div><div class="row"><button class="btn" type="button" id="sched">Schedule</button></div></details>' +
            (p.status === 'in_review' ? '<details class="more"><summary>Note for the author</summary><textarea id="rnote" maxlength="1000" placeholder="What to change before this goes live"></textarea></details>' : '') : '') +
          '</form>') +
          '<div class="live-bar" style="flex-wrap:wrap">' + actions() + '</div>' +
          (!isLocal ? '<details class="more"><summary>History</summary><div id="revs" class="list"><p class="empty">Loading…</p></div></details>' : '');
        bind();
        stateText();
      }
      function tagList(s) { return String(s || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean); }
      function read() {
        if (preview || !$('#title')) return;
        f.title = $('#title').value; f.summary = $('#summary').value; f.body = $('#body').value; f.tags = $('#tags').value; f.author_credit = $('#credit').value;
      }
      var lt;
      function local() {
        dirty = true;
        clearTimeout(lt); lt = setTimeout(function () { Store.set(key, { fields: f, baseVersion: p.version, savedAt: Date.now() }); stateText(); }, 300);
      }
      function stateText() { var el = $('#savestate'); if (el) el.textContent = dirty ? (isLocal ? 'Saved on device' : 'Unsaved changes · kept on device') : (isLocal ? 'On this device only' : 'Saved · v' + p.version); }
      function payload() { return { lane: f.lane, title: f.title, summary: f.summary, body: f.body, tags: tagList(f.tags), author_credit: f.author_credit, thumbnail_media_id: f.thumbnail_media_id }; }

      function save() {
        read();
        if (!f.title.trim()) { L.toast('Add a title first.'); return Promise.reject(new Error('title')); }
        if (!L.isOnline()) { Store.set(key, { fields: f, baseVersion: p.version, savedAt: Date.now() }); L.toast('Offline. Saved on this device.'); return Promise.reject(new Error('offline')); }
        var req = isLocal
          ? api.request('POST', '/api/studio/posts', payload())
          : api.request('PUT', '/api/studio/posts/' + p.id, Object.assign({ version: p.version }, payload()));
        return req.then(function (np) {
          Store.del(key); dirty = false;
          if (isLocal) { location.replace('#/studio/' + np.id); L.toast('Draft saved'); return np; }
          p = np; L.toast('Saved'); render(); return np;
        }, function (err) {
          if (err.status === 409 && err.data.current) {
            Store.set(key, { fields: f, baseVersion: p.version, savedAt: Date.now() });
            L.toast('Someone else changed this post. Your text is kept on this device.');
            route();
          } else if (err.status === 0) { Store.set(key, { fields: f, baseVersion: p.version, savedAt: Date.now() }); L.toast('Offline. Saved on this device.'); }
          else L.toast(err.message);
          throw err;
        });
      }
      function act(path, body, msg) {
        var go = function () { return api.request('POST', '/api/studio/posts/' + p.id + '/' + path, body || {}).then(function (np) { p = np; L.toast(msg); render(); }, function (err) { L.toast(err.message); }); };
        if (dirty && !liveNoEdit) return save().then(go, function () {});
        return go();
      }

      function bind() {
        if ($('#ef')) {
          $('#ef').addEventListener('input', function () { read(); local(); });
          $('#lane').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; f.lane = b.getAttribute('data-v'); $$('#lane button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); local(); });
        }
        if ($('#restore')) $('#restore').addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return;
          if (b.getAttribute('data-r') === 'keep') { f = saved.fields; dirty = true; } else Store.del(key);
          banner = ''; render();
        });
        if ($('#save')) $('#save').addEventListener('click', function () { save().then(null, function () {}); });
        if ($('#submit')) $('#submit').addEventListener('click', function () { act('submit', null, 'Submitted for review'); });
        if ($('#publish')) L.armed($('#publish'), 'Tap again to publish', function () { act('publish', {}, 'Published to the app and website'); });
        if ($('#return')) $('#return').addEventListener('click', function () { act('return', { note: $('#rnote') ? $('#rnote').value : '' }, 'Returned to the author'); });
        if ($('#unpub')) L.armed($('#unpub'), 'Tap again to unpublish', function () { act('unpublish', null, 'Unpublished'); });
        if ($('#sched')) $('#sched').addEventListener('click', function () {
          var v = $('#when').value; if (!v) return L.toast('Pick a date and time.');
          var at = new Date(v); if (at <= new Date()) return L.toast('Pick a time in the future.');
          act('publish', { publish_at: at.toISOString() }, 'Scheduled');
        });
        $('#prev').addEventListener('click', function () { read(); preview = !preview; render(); });
        if ($('#del')) L.armed($('#del'), 'Tap again to delete', function () {
          Store.del(key);
          if (isLocal) { location.hash = '#/studio'; return; }
          api.request('DELETE', '/api/studio/posts/' + p.id).then(function () { L.toast('Deleted'); location.hash = '#/studio'; }, function (err) { L.toast(err.message); });
        });
        $$('[data-ins]').forEach(function (b) { b.addEventListener('click', function () { insertAtCursor($('#body'), '\n\n![](media:' + b.getAttribute('data-ins') + ')\n\n'); read(); local(); L.toast('Placed in the text'); }); });
        $$('[data-thumb]').forEach(function (b) { b.addEventListener('click', function () { f.thumbnail_media_id = b.getAttribute('data-thumb'); local(); save().then(null, function () {}); }); });
        if ($('#up')) $('#up').addEventListener('change', function () { Array.prototype.forEach.call(this.files, uploadOne); this.value = ''; });
        var revs = $('#revs');
        if (revs) revs.parentNode.addEventListener('toggle', function once() {
          revs.parentNode.removeEventListener('toggle', once);
          api.get('/api/studio/posts/' + p.id + '/revisions').then(function (rs) {
            revs.innerHTML = rs.length ? rs.map(function (r) { return '<div class="li"><span class="d">v' + r.version + ' · ' + h(STATUS_LABEL[r.status] || r.status) + ' · ' + h(r.editor || '') + '</span><span class="side">' + h(L.when(r.created_at)) + '</span></div>'; }).join('') : '<p class="empty">No earlier versions.</p>';
          }, function () { revs.innerHTML = '<p class="empty">History needs a connection.</p>'; });
        });
      }
      function uploadOne(file) {
        var uid = L.uuid();
        var row = document.createElement('div'); row.className = 'upload-row';
        row.innerHTML = '<span class="small">' + h(file.name) + ' · <span class="pc">0%</span></span><div class="progress"><i></i></div>';
        $('#uploads').appendChild(row);
        function go() {
          if (!L.isOnline()) {
            L.queueUpload(file, 'post_id=' + p.id, file.name + ' for \u201c' + (f.title || 'post') + '\u201d').then(function () {
              $('.pc', row).textContent = 'Saved on this device. It uploads when you\u2019re back online.';
            }, function () { $('.pc', row).textContent = 'Offline, and this browser can\u2019t hold the file. Try again with a connection.'; });
            return;
          }
          api.upload(file, 'post_id=' + p.id, function (x) { $('i', row).style.width = Math.round(x * 100) + '%'; $('.pc', row).textContent = Math.round(x * 100) + '%'; }, uid)
            .then(function (m) {
              p.media.push(m);
              if (!f.thumbnail_media_id && m.mime.indexOf('image/') === 0) { f.thumbnail_media_id = m.id; local(); }
              row.remove(); read(); render();
            }, function (err) {
              $('.pc', row).innerHTML = h(err.message) + ' <button class="link-btn" type="button">Retry</button>';
              $('button', row).onclick = go;
            });
        }
        go();
      }
      window.addEventListener('beforeunload', function () { if (dirty) Store.set(key, { fields: f, baseVersion: p.version, savedAt: Date.now() }); });
      render();
      if (isLocal && !saved) $('#title').focus();
    });
  };

  /* ================= ADMIN ================= */
  views.admin = function () {
    if (!has('admin')) return forbidden('Admin is for administrators.');
    var ROLES = ['coach', 'contributor', 'editor', 'admin'];
    return api.get('/api/admin/users').then(function (users) {
      app.innerHTML = head('Admin', 'People and permissions', 'Everyone starts as an athlete. Grant staff roles and membership here.', '<a class="btn ghost" href="#/cohorts">Cohorts</a>') +
        '<input type="search" id="q" placeholder="Search people" aria-label="Search people">' +
        '<div class="list" id="ul">' + users.map(function (u) {
          return '<div class="li" data-name="' + h((u.name + ' ' + u.email).toLowerCase()) + '"><span class="main-col"><span class="t">' + h(u.name) + '</span><span class="d">' + h(u.email) + (u.athlete_id ? ' · ' + playerId(u.athlete_id) : '') + '</span>' +
            '<span class="checks" data-u="' + u.id + '">' + ROLES.map(function (r) { return '<label><input type="checkbox" value="' + r + '"' + (u.roles.indexOf(r) >= 0 ? ' checked' : '') + (u.id === ME.user.id && r === 'admin' ? ' disabled' : '') + '> ' + r + '</label>'; }).join('') + '</span></span>' +
            '<span class="side"><select class="msel" data-m="' + u.id + '" aria-label="Membership for ' + h(u.name) + '"><option value="none"' + (!u.membership ? ' selected' : '') + '>No membership</option><option value="active"' + (u.membership && u.membership.active ? ' selected' : '') + '>Member</option><option value="cancelled"' + (u.membership && !u.membership.active ? ' selected' : '') + '>Lapsed</option></select><button class="btn sm ghost" type="button" data-reset="' + u.id + '">Reset link</button></span></div>';
        }).join('') + '</div><div id="linkbox"></div>' +
        '<div class="stack"><p class="section-title">System</p><div class="card stack" id="sys"><p class="small muted">Loading\u2026</p></div></div>';
      Promise.all([api.get('/api/admin/status'), api.get('/api/admin/backups')]).then(function (r) {
        var st = r[0], bk = r[1];
        var line = function (ok, label, off) { return '<p class="small"><span class="tag ' + (ok ? 'ok' : 'demo') + '">' + (ok ? 'On' : 'Off') + '</span> ' + h(label) + (ok ? '' : ' \u00b7 <span class="muted">' + h(off) + '</span>') + '</p>'; };
        $('#sys').innerHTML = line(st.email, 'Email (password resets)', 'set RESEND_API_KEY and MAIL_FROM in Render') +
          line(st.push, 'Phone push notifications', 'set VAPID keys in Render') +
          line(st.google, 'Sign in with Google', 'set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Render') +
          line(st.backups, 'Nightly backups (last 7 kept on the server disk)', 'no disk configured') +
          (bk.length ? '<div class="list">' + bk.map(function (b) { return '<div class="li"><span class="t small">' + h(b.date) + '</span><span class="side"><a class="btn sm ghost" href="/api/admin/backups/' + h(b.date) + '" download>Download</a><span>' + Math.round(b.size / 1024) + ' KB</span></span></div>'; }).join('') + '</div><p class="small muted">Download one now and then and keep it somewhere else, so a copy exists off the server.</p>' : '<p class="small muted">The first backup runs within a minute of the server starting, then nightly.</p>');
      }, function () { $('#sys').innerHTML = '<p class="small muted">System status needs a connection.</p>'; });
      $('#q').addEventListener('input', function () { var q = this.value.toLowerCase(); $$('#ul .li').forEach(function (l) { l.hidden = l.getAttribute('data-name').indexOf(q) < 0; }); });
      $('#ul').addEventListener('change', function (e) {
        if (e.target.matches('.msel')) {
          api.request('PUT', '/api/admin/users/' + e.target.getAttribute('data-m') + '/membership', { status: e.target.value }).then(function () { L.toast('Membership updated'); }, function (err) { L.toast(err.message); });
          return;
        }
        var box = e.target.closest('.checks'); if (!box) return;
        var roles = ['athlete'].concat($$('input:checked', box).map(function (i) { return i.value; }));
        if (box.getAttribute('data-u') === String(ME.user.id)) roles.push('admin');
        api.request('PUT', '/api/admin/users/' + box.getAttribute('data-u') + '/roles', { roles: roles }).then(function () { L.toast('Roles saved'); }, function (err) { L.toast(err.message); route(); });
      });
      $('#ul').addEventListener('click', function (e) {
        var b = e.target.closest('[data-reset]'); if (!b) return;
        api.request('POST', '/api/admin/users/' + b.getAttribute('data-reset') + '/reset-link', {}).then(function (r) {
          $('#linkbox').innerHTML = '<div class="card stack"><p class="section-title">Password reset link · works once, for 60 minutes</p><p class="mono small" style="word-break:break-all;user-select:all">' + h(r.link) + '</p><div class="row"><button class="btn" type="button" id="cpl">Copy link</button></div></div>';
          $('#cpl').addEventListener('click', function () { L.copy(r.link); });
          $('#linkbox').scrollIntoView({ behavior: 'smooth' });
        }, function (err) { L.toast(err.message); });
      });
    });
  };

  /* ================= CUSTOM SCOREBOARDS ================= */
  /* Runs entirely on the device: works offline, autosaves every tap, resumes
     after closing. Two-sided boards can be recorded as a match afterwards. */
  var SIDE_COLORS = ['#1F6FEB', '#C2410C', '#15803D', '#7E22CE'];
  var NAMED_COLORS = { red: '#DC2626', blue: '#1F6FEB', green: '#15803D', orange: '#C2410C', purple: '#7E22CE', yellow: '#CA8A04', pink: '#DB2777', teal: '#0F766E', black: '#111827', gray: '#6B7280', grey: '#6B7280' };
  function sideColor(name, i) { var w = String(name || '').toLowerCase().split(/\s+/).filter(function (x) { return NAMED_COLORS[x]; })[0]; return w ? NAMED_COLORS[w] : SIDE_COLORS[i]; }
  function boards() { return Store.keys('board:').map(function (k) { return Store.get(k); }).filter(Boolean).sort(function (a, b) { return b.updated - a.updated; }); }

  views.boardNew = function () {
    var st = { sides: ['Blue', 'Orange'], to: 11, winBy: 2, bestOf: 1, minutes: 0 };
    function paint() {
      app.innerHTML = '<a class="back" href="#/train">← Train</a>' + head('Scoreboard Studio', 'Custom scoreboard', 'Any game, any rules. Saves on this device as you score.') +
        '<form class="form" id="bf" novalidate>' +
        '<div class="field"><label class="flabel" for="bn">Name</label><input type="text" id="bn" maxlength="80" placeholder="e.g. Skinny singles to 7"></div>' +
        '<div class="field"><span class="flabel">Sides <span class="hint">2–4</span></span><div class="stack-sm" id="sides">' + st.sides.map(function (n, i) {
          return '<div class="row"><span class="swatch" style="background:' + sideColor(n, i) + '" aria-hidden="true"></span><input type="text" data-side="' + i + '" value="' + h(n) + '" maxlength="40" aria-label="Side ' + (i + 1) + ' name" style="flex:1;min-width:0">' + (st.sides.length > 2 ? '<button class="btn sm ghost" type="button" data-rmside="' + i + '" aria-label="Remove side">✕</button>' : '') + '</div>';
        }).join('') + '</div>' + (st.sides.length < 4 ? '<div class="row"><button class="btn ghost sm" type="button" id="addside">Add side</button></div>' : '') + '</div>' +
        '<div class="form-grid"><div class="field"><label class="flabel" for="to">Game to</label><input type="number" id="to" min="1" max="99" value="' + st.to + '"></div>' +
        '<div class="field"><span class="flabel">Win by</span><div class="seg-btns" data-k="winBy"><button type="button" data-v="1" aria-pressed="' + (st.winBy === 1) + '">1</button><button type="button" data-v="2" aria-pressed="' + (st.winBy === 2) + '">2</button></div></div>' +
        '<div class="field"><span class="flabel">Best of</span><div class="seg-btns" data-k="bestOf">' + [1, 3, 5, 7].map(function (v) { return '<button type="button" data-v="' + v + '" aria-pressed="' + (st.bestOf === v) + '">' + v + '</button>'; }).join('') + '</div></div>' +
        '<div class="field"><label class="flabel" for="mins">Time limit <span class="hint">minutes per game, 0 = none</span></label><input type="number" id="mins" min="0" max="120" value="' + st.minutes + '"></div></div>' +
        '<div class="row"><button class="btn primary" type="submit">Start scoring</button></div></form>';
      $$('#sides [data-side]').forEach(function (inp) { inp.addEventListener('input', function () { st.sides[+inp.getAttribute('data-side')] = inp.value; }); });
      $$('[data-rmside]').forEach(function (b) { b.addEventListener('click', function () { keep(); st.sides.splice(+b.getAttribute('data-rmside'), 1); paint(); }); });
      if ($('#addside')) $('#addside').addEventListener('click', function () { keep(); st.sides.push(['Green', 'Purple'][st.sides.length - 2]); paint(); });
      $$('.seg-btns').forEach(function (box) { box.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; keep(); st[box.getAttribute('data-k')] = Number(b.getAttribute('data-v')); paint(); }); });
      $('#bf').addEventListener('submit', function (e) {
        e.preventDefault(); keep();
        if (st.sides.some(function (n) { return !n.trim(); })) return L.formError($('#bf'), 'Name every side.');
        var id = L.uuid();
        var b = { id: id, name: $('#bn').value.trim() || st.sides.join(' vs '), sides: st.sides.map(function (n) { return n.trim(); }), rules: { to: st.to, winBy: st.winBy, bestOf: st.bestOf, minutes: st.minutes },
          games: [], cur: { scores: st.sides.map(function () { return 0; }), hist: [], golden: false }, timer: { left: st.minutes * 60000, running: false, at: 0 }, done: false, updated: Date.now() };
        Store.set('board:' + id, b);
        location.hash = '#/train/scoreboard/' + id;
      });
      function keep() {
        st.to = Math.max(1, Math.min(99, parseInt($('#to').value, 10) || 11));
        st.minutes = Math.max(0, Math.min(120, parseInt($('#mins').value, 10) || 0));
      }
    }
    paint();
  };

  views.board = function (id) {
    var b = Store.get('board:' + id);
    if (!b) { app.innerHTML = head('Scoreboard', 'Not found on this device', 'Scoreboards live on the device they were started on.') + '<div class="row"><a class="btn" href="#/train">Back to Train</a></div>'; return; }
    var tick = null, voice = null;
    function save() { b.updated = Date.now(); Store.set('board:' + id, b); }
    function wins(i) { return b.games.filter(function (g) { return g.winner === i; }).length; }
    function need() { return Math.floor(b.rules.bestOf / 2) + 1; }
    function timeLeft() { return b.timer.running ? Math.max(0, b.timer.left - (Date.now() - b.timer.at)) : b.timer.left; }
    function leader() {
      var s = b.cur.scores, top = Math.max.apply(null, s);
      var at = s.map(function (v, i) { return v === top ? i : -1; }).filter(function (i) { return i >= 0; });
      return at.length === 1 ? at[0] : -1;
    }
    function checkGame(byTime) {
      var s = b.cur.scores, i = leader();
      if (i < 0) { if (byTime) { b.cur.golden = true; L.toast('Time. Scores level: next point wins.'); } return; }
      var others = s.filter(function (_, k) { return k !== i; }), lead = s[i] - Math.max.apply(null, others);
      var won = b.cur.golden || byTime || (s[i] >= b.rules.to && lead >= b.rules.winBy);
      if (!won) return;
      stopTimer();
      b.games.push({ scores: s.slice(), winner: i, by: byTime ? 'time' : b.cur.golden ? 'golden' : 'score' });
      if (wins(i) >= need()) { b.done = true; L.toast(b.sides[i] + ' wins the match'); }
      else { L.toast('Game to ' + b.sides[i] + ' ' + s.join('–')); b.cur = { scores: b.sides.map(function () { return 0; }), hist: [], golden: false }; b.timer.left = b.rules.minutes * 60000; }
      save();
    }
    function point(i, v) {
      if (b.done) return;
      b.cur.scores[i] = Math.max(0, b.cur.scores[i] + v);
      b.cur.hist.push({ i: i, v: v });
      try { navigator.vibrate && navigator.vibrate(10); } catch (e) {}
      save(); checkGame(false); paint();
    }
    function undo() {
      if (b.cur.hist.length) { var last = b.cur.hist.pop(); b.cur.scores[last.i] -= last.v; save(); paint(); L.toast('Undone'); return; }
      if (b.games.length) {
        // Reopen the last game: accidental game-point tap.
        var g = b.games.pop(); b.done = false;
        b.cur = { scores: g.scores.slice(), hist: [], golden: false };
        var li = g.winner; b.cur.scores[li] = Math.max(0, b.cur.scores[li] - 1);
        save(); paint(); L.toast('Reopened game ' + (b.games.length + 1)); return;
      }
      L.toast('Nothing to undo.');
    }
    function startTimer() { if (!b.rules.minutes || b.timer.running || b.done) return; b.timer.running = true; b.timer.at = Date.now(); save(); runTick(); }
    function stopTimer() { if (!b.timer.running) return; b.timer.left = timeLeft(); b.timer.running = false; save(); }
    function runTick() {
      clearInterval(tick);
      tick = setInterval(function () {
        if (!document.body.contains($('#clock'))) { clearInterval(tick); return; }
        var left = timeLeft();
        $('#clock').textContent = fmtClock(left);
        if (left <= 0 && b.timer.running) { b.timer.running = false; b.timer.left = 0; save(); checkGame(true); paint(); try { navigator.vibrate && navigator.vibrate([80, 60, 80]); } catch (e) {} }
      }, 250);
    }
    function fmtClock(ms) { var s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
    function paint() {
      var n = b.sides.length;
      app.innerHTML = '<div class="live"><div class="live-head"><a class="back" href="#/train">← Train</a><span class="small muted mono">Saved on device</span></div>' +
        '<div class="head-row"><h1 style="font-size:20px">' + h(b.name) + '</h1><span class="small mono">To ' + b.rules.to + ', win by ' + b.rules.winBy + (b.rules.bestOf > 1 ? ', best of ' + b.rules.bestOf : '') + '</span></div>' +
        '<div class="row"><span class="small mono">Game ' + (b.games.length + (b.done ? 0 : 1)) + ' · ' + b.sides.map(function (s, i) { return h(s) + ' ' + wins(i); }).join(' · ') + '</span>' +
        (b.rules.minutes ? '<span class="clock" id="clock">' + fmtClock(timeLeft()) + '</span><button class="btn sm" type="button" id="tgl">' + (b.timer.running ? 'Pause' : 'Start clock') + '</button>' : '') +
        (b.cur.golden ? '<span class="tag call">Next point wins</span>' : '') + '</div>' +
        (b.done ? '<div class="focus-card"><p class="eyebrow">Final</p><p class="big">' + h(b.sides[b.games[b.games.length - 1].winner]) + ' wins</p><p class="small" style="opacity:.8">' + b.games.map(function (g) { return g.scores.join('–'); }).join(', ') + '</p></div>' : '') +
        '<div class="board n' + n + '">' + b.sides.map(function (s, i) {
          return '<div class="side" style="--c:' + sideColor(s, i) + '"><button type="button" class="plus" data-p="' + i + '" aria-label="Point to ' + h(s) + ', ' + b.cur.scores[i] + ' now"' + (b.done ? ' disabled' : '') + '><span class="nm">' + h(s) + '</span><span class="num">' + b.cur.scores[i] + '</span><span class="lbl">Tap for a point</span></button>' +
            '<button type="button" class="minus" data-m="' + i + '" aria-label="Take a point from ' + h(s) + '"' + (b.done ? ' disabled' : '') + '>− 1</button></div>';
        }).join('') + '</div>' +
        (b.games.length ? '<p class="small mono">Games: ' + b.games.map(function (g, k) { return (k + 1) + ') ' + g.scores.join('–') + (g.by === 'time' ? ' (time)' : g.by === 'golden' ? ' (next point)' : ''); }).join(' · ') + '</p>' : '') +
        voiceBar('board') +
        '<div class="live-bar"><button class="btn" type="button" id="undo">Undo</button>' +
        (b.done && n === 2 ? '<button class="btn primary" type="button" id="rec">Record as match</button>' : '') +
        (b.done ? '<button class="btn" type="button" id="again">Rematch</button>' : '<button class="btn ghost" type="button" id="end">End</button>') + '</div></div>';
      $$('[data-p]').forEach(function (x) { x.addEventListener('click', function () { point(+x.getAttribute('data-p'), 1); }); });
      $$('[data-m]').forEach(function (x) { x.addEventListener('click', function () { point(+x.getAttribute('data-m'), -1); }); });
      $('#undo').addEventListener('click', undo);
      if ($('#tgl')) $('#tgl').addEventListener('click', function () { if (b.timer.running) stopTimer(); else startTimer(); paint(); });
      if ($('#end')) L.armed($('#end'), 'Tap again to end', function () { stopTimer(); Store.del('board:' + id); location.hash = '#/train'; });
      if ($('#again')) $('#again').addEventListener('click', function () { b.games = []; b.done = false; b.cur = { scores: b.sides.map(function () { return 0; }), hist: [], golden: false }; b.timer = { left: b.rules.minutes * 60000, running: false, at: 0 }; save(); paint(); });
      if ($('#rec')) $('#rec').addEventListener('click', function () {
        Store.set('match-prefill', { games: b.games.map(function (g) { return g.scores; }), best_of: [1, 3, 5].indexOf(b.rules.bestOf) >= 0 ? b.rules.bestOf : 5, game_to: b.rules.to, win_by: b.rules.winBy, names: b.sides });
        location.hash = '#/play/match/new';
      });
      bindVoice(b.sides, 'points', function (cmd) { if (cmd.action === 'undo') undo(); else point(cmd.index, 1); });
      if (b.timer.running) runTick();
    }
    window.addEventListener('hashchange', function off() { clearInterval(tick); stopVoice(); window.removeEventListener('hashchange', off); });
    paint();
  };

  /* ---------- shared voice controls ---------- */
  var voiceOn = false, voiceHandle = null, voiceCb = null, voiceNames = [], voiceMode = 'counts';
  function voiceBar() {
    if (!window.LabVoice || !window.LabVoice.supported()) return '<p class="small muted">Voice scoring (experimental) isn’t available in this browser.</p>';
    return '<div class="voice"><button class="btn sm' + (voiceOn ? ' primary' : '') + '" type="button" id="vbtn" aria-pressed="' + voiceOn + '">' + (voiceOn ? 'Voice on' : 'Voice (experimental)') + '</button><span class="small muted" id="vheard">' + (voiceOn ? 'Listening… say a name and “make” or “miss”, or “undo”.' : 'Every spoken score shows here with Undo. Not yet tested with earbuds or music.') + '</span></div>';
  }
  function bindVoice(names, mode, cb) {
    voiceNames = names; voiceMode = mode; voiceCb = cb;
    var btn = $('#vbtn'); if (!btn) return;
    if (voiceOn) $('#vheard').textContent = mode === 'points' ? 'Listening… say a side’s name, or “undo”.' : 'Listening… say a name and “make” or “miss”, or “undo”.';
    btn.addEventListener('click', function () { if (voiceOn) stopVoice(); else startVoice(); route(); });
  }
  function startVoice() {
    voiceOn = true;
    voiceHandle = window.LabVoice.listen(function (text) {
      var cmd = window.LabVoice.parse(text, voiceNames, { mode: voiceMode });
      var el = $('#vheard');
      if (el) el.textContent = 'Heard “' + text.trim() + '”' + (cmd ? '' : ' · not understood, nothing scored');
      if (cmd && voiceCb) voiceCb(cmd);
    }, function (state, err) {
      if (state === 'error' && (err === 'not-allowed' || err === 'service-not-allowed')) { voiceOn = false; L.toast('Microphone permission was refused.'); route(); }
    });
  }
  function stopVoice() { voiceOn = false; if (voiceHandle) { voiceHandle.stop(); voiceHandle = null; } }

  /* ================= PLAY ================= */
  var MATCH_KIND = { casual: 'Casual', training: 'Training', competition: 'Competition' };
  var STATUS_CLASS = { scheduled: 'draft', recorded: 'in_review', confirmed: 'published', verified: 'published', disputed: 'scheduled' };
  function statusPill(m) { return '<span class="status ' + STATUS_CLASS[m.status] + '">' + h(m.status_label || m.status) + '</span>'; }
  function teamNames(m, t) {
    return m.players.filter(function (p) { return p.team === t; }).map(function (p) { return h(p.name) + (p.side ? ' <span class="small muted">(' + p.side[0].toUpperCase() + ')</span>' : ''); }).join(' & ');
  }
  function scoreLine(m) { return m.games.length ? m.games.map(function (g) { return g[0] + '–' + g[1]; }).join(', ') : 'No score yet'; }
  function matchRow(m) {
    var res = m.result ? '<span class="result ' + (m.result === 'W' ? 'w' : 'l') + '">' + m.result + '</span>' : '';
    return '<a class="li" href="#/play/match/' + h(m.id) + '"><span class="who">' + res + '<span class="main-col"><span class="t small">' + teamNames(m, 1) + ' <span class="muted">vs</span> ' + teamNames(m, 2) + '</span><span class="d mono">' + h(scoreLine(m)) + ' · ' + h(L.when(m.played_at)) + '</span></span></span><span class="side">' + statusPill(m) + '</span></a>';
  }
  function fmtEventTime(e) { return new Date(e.starts_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }

  views.play = function () {
    return Promise.all([
      api.get('/api/matches').then(null, function (e) { if (e.status === 0) return []; throw e; }),
      api.get('/api/events').then(null, function (e) { if (e.status === 0) return []; throw e; })
    ]).then(function (res) {
      var matches = res[0], events = res[1];
      var pending = localMatches();
      var confirm = matches.filter(function (m) { return m.you && m.you.can_confirm && m.status === 'recorded'; });
      var mine = events.filter(function (e) { return e.my_state && e.my_state !== 'withdrawn' && e.status !== 'complete' && e.status !== 'cancelled'; });
      var open = events.filter(function (e) { return (!e.my_state || e.my_state === 'withdrawn') && (e.status === 'published' || e.status === 'live'); });
      var wins = matches.filter(function (m) { return m.result === 'W'; }).length;
      app.innerHTML = offlineNote(matches) +
        head('Play', 'Matches and events', matches.length ? wins + '–' + (matches.length - wins) + ' in recorded matches' : 'Record a match, or join an event.',
          '<div class="row"><a class="btn" href="#/play/leaderboard">Leaderboard</a><a class="btn primary" href="#/play/match/new">Record match</a></div>') +
        (confirm.length ? '<div class="stack"><p class="section-title">Needs your confirmation · ' + confirm.length + '</p><div class="list">' + confirm.map(matchRow).join('') + '</div></div>' : '') +
        '<div class="grid-2"><div class="stack"><p class="section-title">Your events</p>' + (mine.length ? '<div class="list">' + mine.map(eventRow).join('') + '</div>' : '<div class="list"><p class="empty">You haven’t joined an event.</p></div>') +
        '<p class="section-title">Open events</p>' + (open.length ? '<div class="list">' + open.map(eventRow).join('') + '</div>' : '<div class="list"><p class="empty">No open events right now.</p></div>') +
        (has('coach') ? '<div class="row"><a class="btn" href="#/play/events/new">New event</a><a class="btn ghost" href="#/play/events">All events</a></div>' : '<div class="row"><a class="btn ghost" href="#/play/events">All events</a></div>') + '</div>' +
        '<div class="stack"><p class="section-title">Your matches</p>' +
        (pending.length ? '<div class="list">' + pending.map(function (m) { return '<div class="li"><span class="main-col"><span class="t small">' + h(m.label) + '</span><span class="d mono">' + h(m.score) + '</span></span><span class="side"><span class="status local">On device</span></span></div>'; }).join('') + '</div>' : '') +
        (matches.length ? '<div class="list">' + matches.slice(0, 20).map(matchRow).join('') + '</div>' : '<div class="list"><p class="empty">No matches yet.</p></div>') + '</div></div>';
    });
  };
  function eventRow(e) {
    var st = e.my_state === 'registered' ? '<span class="tag ok">Registered</span>' : e.my_state === 'waitlist' ? '<span class="tag demo">Waitlist</span>' : e.my_state === 'interested' ? '<span class="tag">Interested</span>' : '';
    return '<a class="li" href="#/play/events/' + e.id + '"><span class="main-col"><span class="t">' + h(e.title) + '</span><span class="d">' + h(fmtEventTime(e)) + (e.location ? ' · ' + h(e.location) : '') + '</span></span><span class="side">' + (e.status === 'live' ? '<span class="tag call">Live</span>' : e.status === 'draft' ? '<span class="tag">Draft</span>' : '') + st + '</span></a>';
  }
  function localMatches() {
    return L.outbox().filter(function (q) { return q.path === '/api/matches' && q.method === 'POST'; }).map(function (q) {
      return { label: q.label, score: q.body.games.map(function (g) { return g.join('–'); }).join(', ') };
    });
  }

  /* Record a match. Offline-safe: the device picks the ID. */
  views.matchNew = function (_, query) {
    return api.get('/api/me').then(function (m) {
      setMe(m);
      if (!m.athlete_id && !has('coach')) { app.innerHTML = head('Record match', 'Set up your profile first', 'Matches attach to your athlete profile.') + '<div class="row"><a class="btn primary" href="#/profile">Go to Profile</a></div>'; return; }
      return (has('coach') ? api.get('/api/athletes').then(null, function () { return []; }) : Promise.resolve([])).then(function (roster) {
        var st = { kind: 'casual', game_to: 11, win_by: 2, best_of: 1, doubles: true };
        var myName = ME.user.name;
        function playerField(team, slot, def) {
          var id = 'p' + team + slot;
          var mine = def === 'me';
          return '<div class="field pfield" data-team="' + team + '" data-slot="' + slot + '"' + (slot === 2 && !st.doubles ? ' hidden' : '') + '>' +
            '<label class="flabel" for="' + id + '">' + (mine ? 'You' : 'Player') + '</label>' +
            (mine ? '<input type="text" id="' + id + '" value="' + h(myName) + '" disabled data-me="1">' :
              '<input type="text" id="' + id + '" list="roster" placeholder="Player ID (LAB-00012) or guest name" autocomplete="off">') +
            '<div class="seg-btns sm" data-side="' + id + '"><button type="button" data-v="" aria-pressed="true">Side?</button><button type="button" data-v="left" aria-pressed="false">Left</button><button type="button" data-v="right" aria-pressed="false">Right</button></div></div>';
        }
        app.innerHTML = '<a class="back" href="' + (query.session ? '#/train/' + h(query.session) : '#/play') + '">\u2190 ' + (query.session ? 'Session' : 'Play') + '</a>' + head('Play', 'Record a match', query.session ? 'This game will be linked to the training session.' : 'Your opponents get a request to confirm the score.') +
          (roster.length ? '<datalist id="roster">' + roster.map(function (a) { return '<option value="LAB-' + ('00000' + a.id).slice(-5) + '">' + h(a.name) + '</option>'; }).join('') + '</datalist>' : '<datalist id="roster"></datalist>') +
          '<form class="form" id="mf" novalidate>' +
          '<div class="form-grid"><div class="field"><span class="flabel">Type</span><div class="seg-btns" data-k="kind">' + Object.keys(MATCH_KIND).map(function (k) { return '<button type="button" data-v="' + k + '" aria-pressed="' + (st.kind === k) + '">' + MATCH_KIND[k] + '</button>'; }).join('') + '</div></div>' +
          '<div class="field"><span class="flabel">Format</span><div class="seg-btns" data-k="doubles"><button type="button" data-v="true" aria-pressed="true">Doubles</button><button type="button" data-v="false" aria-pressed="false">Singles</button></div></div></div>' +
          '<div class="form-grid"><div class="field"><span class="flabel">Games to</span><div class="seg-btns" data-k="game_to">' + [11, 15, 21].map(function (v) { return '<button type="button" data-v="' + v + '" aria-pressed="' + (st.game_to === v) + '">' + v + '</button>'; }).join('') + '</div></div>' +
          '<div class="field"><span class="flabel">Win by</span><div class="seg-btns" data-k="win_by"><button type="button" data-v="2" aria-pressed="true">2</button><button type="button" data-v="1" aria-pressed="false">1</button></div></div>' +
          '<div class="field"><span class="flabel">Best of</span><div class="seg-btns" data-k="best_of">' + [1, 3, 5].map(function (v) { return '<button type="button" data-v="' + v + '" aria-pressed="' + (st.best_of === v) + '">' + v + '</button>'; }).join('') + '</div></div></div>' +
          '<div class="grid-2"><div class="card stack"><p class="section-title">Team 1</p>' + (m.athlete_id ? playerField(1, 1, 'me') : playerField(1, 1)) + playerField(1, 2) + '</div>' +
          '<div class="card stack"><p class="section-title">Team 2</p>' + playerField(2, 1) + playerField(2, 2) + '</div></div>' +
          '<div class="stack"><p class="section-title">Score</p><div id="games"></div></div>' +
          '<div class="form-grid"><div class="field"><label class="flabel" for="when">Played</label><input type="datetime-local" id="when"></div>' +
          '<div class="field"><label class="flabel" for="note">Note</label><input type="text" id="note" maxlength="500" placeholder="Optional"></div></div>' +
          '<div id="dupbox"></div><div class="row"><button class="btn primary" type="submit">Save match</button></div></form>';
        var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); $('#when').value = d.toISOString().slice(0, 16);
        function paintGames() {
          var prev = $$('#games input').map(function (i) { return i.value; });
          $('#games').innerHTML = Array.apply(null, { length: st.best_of }).map(function (_, i) {
            return '<div class="game-row"><span class="mono small">Game ' + (i + 1) + '</span><input type="number" inputmode="numeric" min="0" max="99" aria-label="Game ' + (i + 1) + ' team 1" data-g="' + i + '" data-t="0"><span class="muted">–</span><input type="number" inputmode="numeric" min="0" max="99" aria-label="Game ' + (i + 1) + ' team 2" data-g="' + i + '" data-t="1"></div>';
          }).join('');
          $$('#games input').forEach(function (inp, i) { if (prev[i] !== undefined) inp.value = prev[i]; });
        }
        paintGames();
        $('#mf').addEventListener('click', function (e) {
          var b = e.target.closest('.seg-btns button'); if (!b) return;
          var box = b.parentNode, k = box.getAttribute('data-k');
          $$('button', box).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
          if (!k) return;
          var v = b.getAttribute('data-v');
          st[k] = v === 'true' ? true : v === 'false' ? false : isNaN(v) ? v : Number(v);
          if (k === 'doubles') $$('.pfield[data-slot="2"]').forEach(function (f) { f.hidden = !st.doubles; });
          if (k === 'best_of') paintGames();
        });
        var pre = Store.get('match-prefill');
        if (pre) {
          Store.del('match-prefill');
          ['best_of', 'game_to', 'win_by'].forEach(function (k) { var box = $('[data-k="' + k + '"]'); var btn = box && $('button[data-v="' + pre[k] + '"]', box); if (btn) btn.click(); });
          $('[data-k="doubles"] button[data-v="false"]').click();
          pre.games.forEach(function (g, i) { var a = $('[data-g="' + i + '"][data-t="0"]'), bb = $('[data-g="' + i + '"][data-t="1"]'); if (a && bb) { a.value = g[0]; bb.value = g[1]; } });
          if ($('#p11') && !$('#p11').getAttribute('data-me')) $('#p11').value = pre.names[0];
          $('#p21').value = pre.names[1];
          L.toast('Scores filled in from the scoreboard. Swap names for player IDs to link LAB members.');
        }
        var confirmDup = false;
        $('#mf').addEventListener('submit', function (e) {
          e.preventDefault();
          var teams = [[], []], err = null;
          $$('.pfield').forEach(function (f) {
            if (f.hidden) return;
            var t = +f.getAttribute('data-team') - 1, inp = $('input', f);
            var side = $('[aria-pressed="true"]', $('.seg-btns', f)).getAttribute('data-v');
            if (inp.getAttribute('data-me')) { teams[t].push({ athlete_id: ME.athlete_id, side: side }); return; }
            var v = inp.value.trim();
            if (!v) { err = 'Fill in every player. Use a player ID for LAB members, or a name for guests.'; return; }
            teams[t].push(/^LAB-?\d+$/i.test(v) ? { player_id: v.toUpperCase(), side: side } : { guest_name: v, side: side });
          });
          if (err) return L.formError($('#mf'), err);
          var games = [];
          for (var g = 0; g < st.best_of; g++) {
            var a = $('[data-g="' + g + '"][data-t="0"]').value, b = $('[data-g="' + g + '"][data-t="1"]').value;
            if (a === '' && b === '') continue;
            if (a === '' || b === '') return L.formError($('#mf'), 'Game ' + (g + 1) + ' needs both scores.');
            games.push([Number(a), Number(b)]);
          }
          if (!games.length) return L.formError($('#mf'), 'Enter the score.');
          var body = { id: L.uuid(), session_id: query.session || undefined, kind: query.session ? 'training' : st.kind, game_to: st.game_to, win_by: st.win_by, best_of: st.best_of, teams: teams, games: games, note: $('#note').value, played_at: new Date($('#when').value).toISOString() };
          if (confirmDup) body.confirm_duplicate = true;
          var label = teams.map(function (t) { return t.map(function (p) { return p.player_id || p.guest_name || myName.split(' ')[0]; }).join(' & '); }).join(' vs ');
          if (!L.isOnline()) {
            L.queue({ method: 'POST', path: '/api/matches', body: body, label: label });
            L.toast('Saved on this device. It’ll sync when you’re online.'); location.hash = '#/play'; return;
          }
          api.request('POST', '/api/matches', body).then(function (r) { L.toast('Match saved'); location.hash = '#/play/match/' + r.id; }, function (err) {
            if (err.status === 409 && err.data.duplicate_of) {
              confirmDup = true;
              $('#dupbox').innerHTML = '<div class="banner"><span>' + h(err.message) + '</span><span class="row"><a class="btn sm" href="#/play/match/' + h(err.data.duplicate_of) + '">View it</a><button class="btn sm primary" type="submit">Save anyway</button></span></div>';
            } else if (err.status === 0) {
              L.queue({ method: 'POST', path: '/api/matches', body: body, label: label });
              L.toast('Saved on this device. It’ll sync when you’re online.'); location.hash = '#/play';
            } else L.formError($('#mf'), err.message);
          });
        });
      });
    });
  };

  function scoreForm(m, withReason) {
    var n = Math.max(m.games.length || 1, 1);
    return '<form class="card form" id="sf" novalidate><p class="section-title">' + (m.status === 'scheduled' ? 'Enter score' : 'Correct score') + '</p>' +
      '<p class="small muted">Team 1: ' + teamNames(m, 1) + ' · Team 2: ' + teamNames(m, 2) + '</p><div id="sgames">' +
      Array.apply(null, { length: Math.max(n, m.best_of) }).map(function (_, i) {
        var g = m.games[i] || ['', ''];
        return '<div class="game-row"><span class="mono small">Game ' + (i + 1) + '</span><input type="number" inputmode="numeric" min="0" max="99" aria-label="Game ' + (i + 1) + ' team 1" data-g="' + i + '" data-t="0" value="' + g[0] + '"><span class="muted">–</span><input type="number" inputmode="numeric" min="0" max="99" aria-label="Game ' + (i + 1) + ' team 2" data-g="' + i + '" data-t="1" value="' + g[1] + '"></div>';
      }).join('') + '</div>' +
      (withReason ? '<div class="field"><label class="flabel" for="reason">What changed</label><input type="text" id="reason" maxlength="300" placeholder="e.g. Game 2 score was flipped"></div>' : '') +
      '<div class="row"><button class="btn primary" type="submit">Save score</button><button class="btn ghost" type="button" id="scancel">Cancel</button></div></form>';
  }
  function readScore(form) {
    var out = [];
    $$('[data-t="0"]', form).forEach(function (a) {
      var b = $('[data-g="' + a.getAttribute('data-g') + '"][data-t="1"]', form);
      if (a.value !== '' && b.value !== '') out.push([Number(a.value), Number(b.value)]);
    });
    return out;
  }
  /* Body for PUT /api/matches/:id, keeping players as they are. */
  function correctionBody(m, games, reason) {
    var teams = [1, 2].map(function (t) {
      return m.players.filter(function (p) { return p.team === t; }).map(function (p) {
        return p.guest ? { guest_name: p.name, side: p.side } : { player_id: p.player_id, side: p.side };
      });
    });
    return { version: m.version, kind: m.kind, game_to: m.game_to, win_by: m.win_by, best_of: m.best_of, played_at: m.played_at, note: m.note, teams: teams, games: games, reason: reason };
  }

  views.match = function (id) {
    return api.get('/api/matches/' + id).then(function (m) {
      var you = m.you || {};
      var won = function (t) { return m.winner === t ? ' won' : ''; };
      app.innerHTML = '<a class="back" href="' + (m.event_id ? '#/play/events/' + m.event_id : '#/play') + '">← ' + (m.event_id ? 'Event' : 'Play') + '</a>' + offlineNote(m) +
        '<div class="head-row"><div class="head"><p class="eyebrow">' + h(MATCH_KIND[m.kind]) + (m.court ? ' · Court ' + m.court : '') + ' · to ' + m.game_to + ', win by ' + m.win_by + (m.best_of > 1 ? ', best of ' + m.best_of : '') + '</p><h1>' + h(scoreLine(m)) + '</h1><p>' + h(L.when(m.played_at)) + '</p></div>' + statusPill(m) + '</div>' +
        '<div class="scoreboard"><div class="team' + won(1) + '"><p class="eyebrow">Team 1' + (m.winner === 1 ? ' · Won' : '') + '</p><p class="names">' + teamNames(m, 1) + '</p></div>' +
        '<div class="games">' + m.games.map(function (g) { return '<span><b' + (g[0] > g[1] ? ' class="w"' : '') + '>' + g[0] + '</b><b' + (g[1] > g[0] ? ' class="w"' : '') + '>' + g[1] + '</b></span>'; }).join('') + '</div>' +
        '<div class="team' + won(2) + '"><p class="eyebrow">Team 2' + (m.winner === 2 ? ' · Won' : '') + '</p><p class="names">' + teamNames(m, 2) + '</p></div></div>' +
        '<p class="small muted">' + ({ scheduled: 'Waiting for a score.', recorded: 'Self-recorded. An opponent can confirm it.', confirmed: 'Confirmed by an opponent.', verified: 'Verified by an organizer or coach.', disputed: 'Disputed. The person who recorded it, or an organizer, can correct it.' })[m.status] + '</p>' +
        (m.note ? '<p class="flag"><b>Note.</b> ' + h(m.note) + '</p>' : '') +
        '<div class="row">' +
        (you.can_confirm && m.status !== 'confirmed' ? '<button class="btn primary" type="button" id="confirm">Confirm score</button><button class="btn" type="button" id="dispute">Dispute</button>' : '') +
        (you.can_verify && m.status !== 'verified' ? '<button class="btn primary" type="button" id="verify">Verify</button>' : '') +
        (you.can_edit ? '<button class="btn ghost" type="button" id="edit">' + (m.status === 'scheduled' ? 'Enter score' : 'Correct score') + '</button>' : '') + '</div>' +
        '<div id="slot"></div>' +
        '<div class="stack"><p class="section-title">History</p><div class="list">' + m.log.map(function (l) {
          return '<div class="li"><span class="main-col"><span class="t small">' + h({ recorded: 'Recorded', scored: 'Score entered', corrected: 'Corrected', confirmed: 'Confirmed', disputed: 'Disputed', verified: 'Verified' }[l.action] || l.action) + ' by ' + h(l.by || 'someone') + '</span>' + (l.note ? '<span class="d">' + h(l.note) + '</span>' : '') + '</span><span class="side">' + h(L.when(l.created_at)) + '</span></div>';
        }).join('') + '</div></div>';
      function act(path, body, msg) { return api.request('POST', '/api/matches/' + m.id + '/' + path, body || {}).then(function () { L.toast(msg); route(); }, function (err) { L.toast(err.message); }); }
      if ($('#confirm')) $('#confirm').addEventListener('click', function () { act('confirm', null, 'Score confirmed'); });
      if ($('#verify')) $('#verify').addEventListener('click', function () { act('verify', null, 'Verified'); });
      if ($('#dispute')) $('#dispute').addEventListener('click', function () {
        $('#slot').innerHTML = '<form class="card form" id="df" novalidate><div class="field"><label class="flabel" for="dn">What’s wrong with the score?</label><input type="text" id="dn" maxlength="300"></div><div class="row"><button class="btn primary" type="submit">Send dispute</button></div></form>';
        $('#dn').focus();
        $('#df').addEventListener('submit', function (e) { e.preventDefault(); act('dispute', { note: $('#dn').value }, 'Dispute sent'); });
      });
      if ($('#edit')) $('#edit').addEventListener('click', function () {
        $('#slot').innerHTML = scoreForm(m, m.status !== 'scheduled');
        $('#scancel').addEventListener('click', function () { $('#slot').innerHTML = ''; });
        $('#sf').addEventListener('submit', function (e) {
          e.preventDefault();
          var games = readScore($('#sf')), reason = $('#reason') ? $('#reason').value : '';
          var body = m.event_id ? { version: m.version, games: games, reason: reason } : correctionBody(m, games, reason);
          api.request('PUT', '/api/matches/' + m.id, body).then(function () { L.toast('Score saved'); route(); }, function (err) { L.formError($('#sf'), err.message); });
        });
      });
    });
  };

  /* ---------- events ---------- */
  views.events = function () {
    return api.get('/api/events').then(function (list) {
      var up = list.filter(function (e) { return e.status !== 'complete' && e.status !== 'cancelled'; });
      var past = list.filter(function (e) { return e.status === 'complete' || e.status === 'cancelled'; });
      app.innerHTML = '<a class="back" href="#/play">← Play</a>' + offlineNote(list) + head('Play', 'Events', '', has('coach') ? '<a class="btn primary" href="#/play/events/new">New event</a>' : '') +
        '<div class="stack"><p class="section-title">Upcoming and live</p>' + (up.length ? '<div class="list">' + up.map(eventRow).join('') + '</div>' : '<div class="list"><p class="empty">No upcoming events.</p></div>') + '</div>' +
        (past.length ? '<div class="stack"><p class="section-title">Past</p><div class="list">' + past.map(eventRow).join('') + '</div></div>' : '');
    });
  };

  views.eventForm = function (id) {
    if (!has('coach')) return forbidden('Only coaches and organizers can create events.');
    return (id ? api.get('/api/events/' + id) : Promise.resolve({ title: '', description: '', location: '', starts_at: new Date(Date.now() + 864e5).toISOString(), courts: 2, capacity: null, format: 'round_robin', game_to: 11, status: 'published' })).then(function (e) {
      var local = function (iso) { if (!iso) return ''; var d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
      app.innerHTML = '<a class="back" href="' + (id ? '#/play/events/' + id : '#/play/events') + '">← ' + (id ? 'Event' : 'Events') + '</a>' + head('Organizer', id ? 'Edit event' : 'New event') +
        '<form class="card form" id="ef" novalidate>' +
        '<div class="field"><label class="flabel" for="t">Title</label><input type="text" id="t" maxlength="120" value="' + h(e.title) + '" placeholder="Thursday Round Robin"></div>' +
        '<div class="form-grid"><div class="field"><label class="flabel" for="st">Starts</label><input type="datetime-local" id="st" value="' + local(e.starts_at) + '"></div>' +
        '<div class="field"><label class="flabel" for="loc">Location</label><input type="text" id="loc" maxlength="200" value="' + h(e.location) + '"></div></div>' +
        '<div class="field"><label class="flabel" for="pm">Partners</label><select id="pm"><option value="rotating"' + (e.partner_mode !== 'fixed' ? ' selected' : '') + '>Rotating partners (mixer)</option><option value="fixed"' + (e.partner_mode === 'fixed' ? ' selected' : '') + '>Fixed partners (teams, brackets)</option></select></div>' +
        '<div class="form-grid"><div class="field"><label class="flabel" for="fmt">Format</label><select id="fmt">' + [['round_robin', 'Round robin'], ['open_play', 'Open play'], ['clinic', 'Clinic']].map(function (o) { return '<option value="' + o[0] + '"' + (e.format === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label class="flabel" for="courts">Courts</label><input type="number" id="courts" min="1" max="40" value="' + e.courts + '"></div>' +
        '<div class="field"><label class="flabel" for="cap">Capacity</label><input type="number" id="cap" min="2" max="500" value="' + (e.capacity || '') + '" placeholder="No limit"></div>' +
        '<div class="field"><label class="flabel" for="gto">Games to</label><input type="number" id="gto" min="5" max="30" value="' + e.game_to + '"></div></div>' +
        '<div class="field"><label class="flabel" for="desc">Details</label><textarea id="desc" maxlength="4000">' + h(e.description) + '</textarea></div>' +
        '<div class="field"><label class="flabel" for="status">Visibility</label><select id="status">' + [['draft', 'Draft (only you)'], ['published', 'Published (open for sign-ups)'], ['live', 'Live'], ['complete', 'Complete'], ['cancelled', 'Cancelled']].map(function (o) { return '<option value="' + o[0] + '"' + (e.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
        '<div class="row"><button class="btn primary" type="submit">Save event</button></div></form>';
      $('#ef').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var body = { title: $('#t').value, starts_at: $('#st').value ? new Date($('#st').value).toISOString() : '', location: $('#loc').value, format: $('#fmt').value, partner_mode: $('#pm').value, courts: $('#courts').value, capacity: $('#cap').value || null, game_to: $('#gto').value, description: $('#desc').value, status: $('#status').value };
        api.request(id ? 'PUT' : 'POST', '/api/events' + (id ? '/' + id : ''), body).then(function (r) { L.toast('Event saved'); location.hash = '#/play/events/' + r.id; }, function (err) { L.formError($('#ef'), err.status === 0 ? 'Saving an event needs a connection.' : err.message); });
      });
    });
  };

  var eventTab = {};
  views.event = function (id) {
    return api.get('/api/events/' + id).then(function (e) {
      var tab = eventTab[id] || (e.status === 'live' ? 'courts' : 'info');
      var round = e.rounds[e.rounds.length - 1];
      var mine = ME.athlete_id;
      function tabs() {
        var list = [['info', 'Info'], ['courts', 'Courts']];
        if (e.partner_mode === 'fixed') list.push(['teams', 'Teams']);
        if (e.bracket || (e.organizer && e.partner_mode === 'fixed')) list.push(['bracket', 'Bracket']);
        list.push(['standings', 'Standings'], ['people', e.organizer ? 'Check-in' : 'Players']);
        return '<div class="chips" id="etabs">' + list.map(function (t) { return '<button class="chip" type="button" data-v="' + t[0] + '" aria-pressed="' + (tab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>';
      }
      function myCourt() {
        if (!round || !mine) return '';
        var mm = round.matches.filter(function (m) { return m.players.some(function (p) { return p.athlete_id === mine; }); })[0];
        if (mm) {
          var me = mm.players.filter(function (p) { return p.athlete_id === mine; })[0];
          var partner = mm.players.filter(function (p) { return p.team === me.team && p.athlete_id !== mine; })[0];
          var opp = mm.players.filter(function (p) { return p.team !== me.team; }).map(function (p) { return p.name; }).join(' & ');
          return '<div class="focus-card"><p class="eyebrow">Round ' + round.number + ' · you’re on</p><p class="big">Court ' + mm.court + ' · ' + (me.side === 'left' ? 'Left' : 'Right') + ' side</p><p class="small" style="opacity:.8">With ' + h(partner ? partner.name : '') + ' vs ' + h(opp) + '</p></div>';
        }
        if (round.sitting_out.some(function (p) { return p.athlete_id === mine; })) return '<div class="focus-card"><p class="eyebrow">Round ' + round.number + '</p><p class="big">You’re sitting out. You’re up next round.</p></div>';
        return '';
      }
      function courts() {
        if (!e.rounds.length) return '<div class="list"><p class="empty">No rounds yet.' + (e.organizer ? ' Check players in, then start round 1.' : ' The organizer will post courts here.') + '</p></div>';
        return e.rounds.slice().reverse().map(function (rd, ri) {
          var scored = rd.matches.filter(function (m) { return m.status !== 'scheduled'; }).length;
          return '<div class="stack"><p class="section-title">Round ' + rd.number + ' · ' + scored + ' of ' + rd.matches.length + ' scored' + (rd.status === 'done' ? ' · done' : '') + '</p>' +
            '<div class="courts">' + rd.matches.map(function (m) {
              return '<a class="court-card' + (m.players.some(function (p) { return p.athlete_id === mine; }) ? ' mine' : '') + '" href="#/play/match/' + h(m.id) + '"><p class="eyebrow">Court ' + m.court + '</p>' +
                [1, 2].map(function (t) { return '<p class="tm' + (m.winner === t ? ' w' : '') + '">' + m.players.filter(function (p) { return p.team === t; }).map(function (p) { return '<span>' + h(p.name) + ' <i>' + (p.side === 'left' ? 'L' : 'R') + '</i></span>'; }).join('') + '</p>'; }).join('<p class="vs">vs</p>') +
                '<p class="sc">' + (m.status === 'scheduled' ? '<span class="check">○ Score needed</span>' : '<span class="check done">✓ ' + h(scoreLine(m)) + '</span>') + '</p></a>';
            }).join('') + '</div>' +
            (rd.sitting_out.length ? '<p class="small muted">Sitting out: ' + rd.sitting_out.map(function (p) { return h(p.name); }).join(', ') + '</p>' : '') + '</div>';
        }).join('');
      }
      function standings() {
        if (e.partner_mode === 'fixed' && e.team_standings.length) {
          var mineTeam = e.teams.filter(function (t) { return t.p1 === mine || t.p2 === mine; })[0];
          return '<div class="table-wrap card" style="padding:0"><table class="summary-table"><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>+/\u2212</th></tr></thead><tbody>' +
            e.team_standings.map(function (s, i) { return '<tr' + (mineTeam && s.team_id === mineTeam.id ? ' class="me"' : '') + '><td class="n">' + (i + 1) + '</td><td>' + h(s.label) + '</td><td class="n">' + s.wins + '</td><td class="n">' + s.losses + '</td><td class="n">' + (s.diff > 0 ? '+' : '') + s.diff + '</td></tr>'; }).join('') + '</tbody></table></div>';
        }
        if (!e.standings.length) return '<div class="list"><p class="empty">Standings appear after the first scores.</p></div>';
        return '<div class="table-wrap card" style="padding:0"><table class="summary-table"><thead><tr><th>#</th><th>Player</th><th>W</th><th>L</th><th>+/−</th></tr></thead><tbody>' +
          e.standings.map(function (s, i) { return '<tr' + (s.athlete_id === mine ? ' class="me"' : '') + '><td class="n">' + (i + 1) + '</td><td>' + h(s.name) + '</td><td class="n">' + s.wins + '</td><td class="n">' + s.losses + '</td><td class="n">' + (s.diff > 0 ? '+' : '') + s.diff + '</td></tr>'; }).join('') + '</tbody></table></div>';
      }
      function teamsTab() {
        var paired = {}; e.teams.forEach(function (t) { paired[t.p1] = paired[t.p2] = 1; });
        var free = e.people.filter(function (p) { return p.state === 'registered' && !paired[p.athlete_id]; });
        return (e.teams.length ? '<div class="list">' + e.teams.map(function (t) {
          return '<div class="li"><span class="main-col"><span class="t small">' + h(t.label) + '</span><span class="d">' + h(t.p1_name) + ' & ' + h(t.p2_name) + '</span></span>' + (e.organizer ? '<button class="btn sm ghost" type="button" data-deltm="' + t.id + '">Split</button>' : '') + '</div>';
        }).join('') + '</div>' : '<div class="list"><p class="empty">No teams yet.</p></div>') +
          (e.organizer ? '<div class="card stack"><p class="section-title">Make a team</p>' + (free.length >= 2 ?
            '<div class="form-grid"><div class="field"><label class="flabel" for="tp1">Player</label><select id="tp1">' + free.map(function (p) { return '<option value="' + p.athlete_id + '">' + h(p.name) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label class="flabel" for="tp2">Partner</label><select id="tp2">' + free.map(function (p, i) { return '<option value="' + p.athlete_id + '"' + (i === 1 ? ' selected' : '') + '>' + h(p.name) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label class="flabel" for="tnm">Team name <span class="hint">optional</span></label><input type="text" id="tnm" maxlength="60"></div></div>' +
            '<div class="row"><button class="btn primary" type="button" id="mktm">Make team</button><button class="btn ghost" type="button" id="autotm">Pair everyone left (' + free.length + ')</button></div>'
            : '<p class="small muted">' + (free.length ? '1 player has no partner yet.' : 'Everyone registered is on a team.') + '</p>') + '</div>' : '');
      }
      function bracketTab() {
        var b = e.bracket;
        var build = e.organizer ? '<div class="card stack"><p class="section-title">' + (b ? 'Rebuild bracket' : 'Create a knockout bracket') + '</p><div class="form-grid">' +
          '<div class="field"><label class="flabel" for="bseed">Seeding</label><select id="bseed"><option value="standings">By standings</option><option value="order">In team order</option></select></div>' +
          '<div class="field"><label class="flabel" for="bsize">Teams in bracket</label><input type="number" id="bsize" min="2" max="64" value="' + e.teams.length + '"></div></div>' +
          '<div class="row"><button class="btn ' + (b ? 'danger' : 'primary') + '" type="button" id="mkbr">' + (b ? 'Rebuild bracket' : 'Create bracket') + '</button></div><p class="small muted">Top seeds get byes when the number of teams isn\u2019t a power of two. Winners move on as scores come in.</p></div>' : '';
        if (!b) return (e.organizer ? '' : '<div class="list"><p class="empty">No bracket yet.</p></div>') + build;
        return (b.champion ? '<div class="focus-card"><p class="eyebrow">Champions</p><p class="big">' + h(b.champion) + '</p></div>' : '') +
          '<div class="bracket">' + b.rounds.map(function (rd) {
            return '<div class="bcol"><p class="section-title">' + h(rd.name) + '</p>' + rd.slots.map(function (x) {
              var line = function (tm, isA) {
                if (!tm) return '<p class="bt tbd">' + (rd.round === 0 ? 'Bye' : 'TBD') + '</p>';
                var won = x.winner_team && x.winner_team === tm.id;
                var sc = x.match && x.match.games.length ? x.match.games.map(function (g) { return isA ? g[0] : g[1]; }).join(' ') : '';
                return '<p class="bt' + (won ? ' won' : '') + '"><span>' + h(tm.label) + '</span><b>' + sc + '</b></p>';
              };
              var inner = line(x.team_a, true) + line(x.team_b, false);
              return x.match ? '<a class="bslot" href="#/play/match/' + h(x.match.id) + '">' + inner + '</a>' : '<div class="bslot">' + inner + '</div>';
            }).join('') + '</div>';
          }).join('') + '</div>' + build;
      }
      function peopleTab() {
        if (!e.organizer) return '<div class="list">' + (e.people.length ? e.people.map(function (p) { return '<div class="li"><span class="t small">' + h(p.name) + '</span></div>'; }).join('') : '<p class="empty">No one registered yet.</p>') + '</div>';
        var active = e.people.filter(function (p) { return p.state === 'registered'; });
        return '<div class="card stack"><p class="section-title">Check players in</p>' +
          '<div class="row"><button class="btn primary" type="button" id="scan">Scan player QR</button></div><div id="scanbox"></div>' +
          '<form class="row" id="codef" novalidate><input type="text" id="code" placeholder="Player ID or check-in code" aria-label="Player ID or check-in code" style="flex:1;min-width:0"><button class="btn" type="submit">Check in</button></form></div>' +
          '<p class="small muted">' + e.counts.checked_in + ' checked in · ' + e.counts.registered + ' registered' + (e.counts.waitlist ? ' · ' + e.counts.waitlist + ' waitlist' : '') + '. Only checked-in, playing players get courts. Late arrivals join the next round; set early departures to “Left”.</p>' +
          '<div class="list">' + e.people.map(function (p) {
            return '<div class="li"><span class="main-col"><span class="t small">' + h(p.name) + '</span><span class="d mono">' + h(p.player_id || '') + ' · ' + h(p.state) + '</span></span><span class="side row">' +
              (p.state === 'registered' && !p.checked_in ? '<button class="btn sm primary" type="button" data-in="' + p.athlete_id + '">Check in</button>' : '') +
              (p.checked_in ? '<button class="btn sm ' + (p.active ? 'ghost' : '') + '" type="button" data-active="' + p.athlete_id + '" data-to="' + (p.active ? 0 : 1) + '">' + (p.active ? 'Playing · set Left' : 'Left · set Playing') + '</button>' : '') +
              (p.state === 'waitlist' ? '<button class="btn sm" type="button" data-promote="' + p.athlete_id + '">Move in</button>' : '') + '</span></div>';
          }).join('') + '</div>';
      }
      function info() {
        return '<div class="card stack"><p class="small mono">' + h(fmtEventTime(e)) + (e.location ? ' · ' + h(e.location) : '') + '</p>' +
          (e.description ? '<div class="small">' + L.paras(e.description) + '</div>' : '') +
          '<p class="small muted">' + h({ round_robin: 'Round robin', open_play: 'Open play', clinic: 'Clinic' }[e.format]) + ' · ' + e.courts + ' courts · games to ' + e.game_to + (e.capacity ? ' · ' + e.counts.registered + ' of ' + e.capacity + ' spots' : ' · ' + e.counts.registered + ' registered') + (e.organizer_name ? ' · Organizer ' + h(e.organizer_name) : '') + '</p>' +
          (ME.athlete_id && ['published', 'live'].indexOf(e.status) >= 0 ? '<div class="row">' +
            (e.partner_mode === 'fixed' && (!e.me || e.me.state === 'withdrawn' || e.me.state === 'interested') ? '<input type="text" id="partner" placeholder="Partner\u2019s player ID (optional)" aria-label="Partner\u2019s player ID" style="flex:1;min-width:160px">' : '') +
            (!e.me || e.me.state === 'withdrawn' || e.me.state === 'interested' ? '<button class="btn primary" type="button" data-reg="register">' + (e.capacity && e.counts.registered >= e.capacity ? 'Join waitlist' : 'Register') + '</button>' : '') +
            (!e.me || e.me.state === 'withdrawn' ? '<button class="btn" type="button" data-reg="interest">Interested</button>' : '') +
            (e.me && e.me.state !== 'withdrawn' ? '<button class="btn ghost" type="button" data-reg="withdraw">Withdraw</button>' : '') + '</div>' : '') +
          (e.me && e.me.state !== 'withdrawn' ? '<p class="small">You’re <b>' + h(e.me.state) + '</b>' + (e.me.checked_in ? ', checked in.' : '. Show the QR on your Profile at check-in.') + '</p>' : '') +
          (!ME.athlete_id ? '<p class="small muted">Set up your athlete profile to register.</p>' : '') + '</div>';
      }
      app.innerHTML = '<a class="back" href="#/play">← Play</a>' + offlineNote(e) +
        head(e.status === 'live' ? 'Live event' : e.status === 'draft' ? 'Draft event' : 'Event', e.title, '', e.organizer ? '<div class="row"><a class="btn ghost" href="#/play/events/' + e.id + '/edit">Edit</a>' + (e.status !== 'complete' ? '<button class="btn primary" type="button" id="next">Start round ' + (e.rounds.length + 1) + '</button>' : '') + '</div>' : '') +
        myCourt() + tabs() + '<div id="tab">' + ({ info: info, courts: courts, teams: teamsTab, bracket: bracketTab, standings: standings, people: peopleTab }[tab] || info)() + '</div>';

      $('#etabs').addEventListener('click', function (ev) { var c = ev.target.closest('.chip'); if (c) { eventTab[id] = c.getAttribute('data-v'); route(); } });
      $$('[data-reg]').forEach(function (b) { b.addEventListener('click', function () {
        var body = b.getAttribute('data-reg') === 'register' && $('#partner') && $('#partner').value.trim() ? { partner_player_id: $('#partner').value.trim() } : {};
        api.request('POST', '/api/events/' + e.id + '/' + b.getAttribute('data-reg'), body).then(function (r) { L.toast(r.me && r.me.state === 'waitlist' ? 'Event is full. You’re on the waitlist.' : 'Updated'); route(); }, function (err) { L.toast(err.message); });
      }); });
      if ($('#mktm')) $('#mktm').addEventListener('click', function () {
        api.request('POST', '/api/events/' + e.id + '/teams', { p1: Number($('#tp1').value), p2: Number($('#tp2').value), name: $('#tnm').value }).then(function () { L.toast('Team made'); route(); }, function (err) { L.toast(err.message); });
      });
      if ($('#autotm')) $('#autotm').addEventListener('click', function () { api.request('POST', '/api/events/' + e.id + '/teams/auto', {}).then(function () { L.toast('Teams paired'); route(); }, function (err) { L.toast(err.message); }); });
      $$('[data-deltm]').forEach(function (b) { L.armed(b, 'Split?', function () { api.request('DELETE', '/api/events/' + e.id + '/teams/' + b.getAttribute('data-deltm')).then(route, function (err) { L.toast(err.message); }); }); });
      if ($('#mkbr')) {
        var mk = function (force) {
          api.request('POST', '/api/events/' + e.id + '/bracket', { seeding: $('#bseed').value, size: Number($('#bsize').value) || undefined, force: force || undefined })
            .then(function () { eventTab[id] = 'bracket'; L.toast('Bracket ready. Teams were notified.'); route(); }, function (err) {
              if (err.status === 409) L.toast(err.message, { label: 'Rebuild', run: function () { mk(true); } }); else L.toast(err.message);
            });
        };
        if (e.bracket) L.armed($('#mkbr'), 'Tap again to rebuild', function () { mk(false); }); else $('#mkbr').addEventListener('click', function () { mk(false); });
      }
      if ($('#next')) $('#next').addEventListener('click', function () {
        var go = function (force) { api.request('POST', '/api/events/' + e.id + '/rounds', force ? { force: true } : {}).then(function () { eventTab[id] = 'courts'; L.toast('Courts posted. Players were notified.'); route(); }, function (err) {
          if (err.status === 409) L.toast(err.message, { label: 'Start anyway', run: function () { go(true); } }); else L.toast(err.message);
        }); };
        go(false);
      });
      function checkin(body) {
        return api.request('POST', '/api/events/' + e.id + '/checkin', body).then(function (r) { L.toast('Checked in: ' + r.checked_in.name); route(); }, function (err) { L.toast(err.message); });
      }
      if ($('#codef')) $('#codef').addEventListener('submit', function (ev) { ev.preventDefault(); var v = $('#code').value.trim(); if (v) checkin({ code: v }); });
      $$('[data-in]').forEach(function (b) { b.addEventListener('click', function () { checkin({ athlete_id: Number(b.getAttribute('data-in')) }); }); });
      $$('[data-active]').forEach(function (b) { b.addEventListener('click', function () {
        api.request('PUT', '/api/events/' + e.id + '/people/' + b.getAttribute('data-active'), { active: b.getAttribute('data-to') === '1' }).then(function () { route(); }, function (err) { L.toast(err.message); });
      }); });
      $$('[data-promote]').forEach(function (b) { b.addEventListener('click', function () {
        api.request('PUT', '/api/events/' + e.id + '/people/' + b.getAttribute('data-promote'), { state: 'registered' }).then(function () { route(); }, function (err) { L.toast(err.message); });
      }); });
      if ($('#scan')) $('#scan').addEventListener('click', function () { startScanner($('#scanbox'), function (text) { checkin({ code: text }); }); });
      // Live scores: refresh while this screen is open.
      if (e.status === 'live') {
        var t = setInterval(function () { if (location.hash === '#/play/events/' + id && document.visibilityState === 'visible' && !$('#scanbox video') && !document.activeElement.matches('input')) route(); else if (location.hash !== '#/play/events/' + id) clearInterval(t); }, 20000);
        window.addEventListener('hashchange', function stop() { clearInterval(t); window.removeEventListener('hashchange', stop); });
      }
    });
  };

  /* Camera QR scanning where the browser supports BarcodeDetector (Chrome on
     Android). Elsewhere, the code box underneath does the same job. */
  function startScanner(box, onCode) {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices) {
      box.innerHTML = '<p class="small muted">This browser can’t scan QR codes. Type the player ID or the code under their QR instead.</p>';
      $('#code') && $('#code').focus(); return;
    }
    box.innerHTML = '<video playsinline muted style="width:100%;max-height:320px;border-radius:4px;background:#000"></video><div class="row"><button class="btn ghost" type="button" id="scanstop">Stop</button></div>';
    var video = $('video', box), stream = null, stopped = false, det = new window.BarcodeDetector({ formats: ['qr_code'] });
    function stop() { stopped = true; if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); box.innerHTML = ''; }
    $('#scanstop').addEventListener('click', stop);
    window.addEventListener('hashchange', stop, { once: true });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (s) {
      stream = s; video.srcObject = s; return video.play();
    }).then(function tick() {
      if (stopped) return;
      det.detect(video).then(function (codes) {
        var hit = codes.filter(function (c) { return /^THELAB:/i.test(c.rawValue); })[0];
        if (hit) { try { navigator.vibrate && navigator.vibrate(40); } catch (e) {} stop(); onCode(hit.rawValue); } else setTimeout(tick, 250);
      }, function () { setTimeout(tick, 500); });
    }).catch(function () { box.innerHTML = '<p class="small muted">Camera unavailable. Type the player ID or code instead.</p>'; });
  }

  views.leaderboard = function () {
    return api.get('/api/leaderboard').then(function (rows) {
      var mine = ME.athlete_id;
      app.innerHTML = '<a class="back" href="#/play">← Play</a>' + offlineNote(rows) + head('Play', 'Leaderboard', 'Last 90 days. Only opponent-confirmed and organizer-verified results count. You can hide yourself in Profile → Notifications and privacy.') +
        (rows.length ? '<div class="table-wrap card" style="padding:0"><table class="summary-table"><thead><tr><th>#</th><th>Player</th><th>W</th><th>L</th><th>Win %</th></tr></thead><tbody>' +
          rows.map(function (r, i) { return '<tr' + (r.athlete_id === mine ? ' class="me"' : '') + '><td class="n">' + (i + 1) + '</td><td>' + h(r.name) + ' <span class="small muted mono">' + h(r.player_id) + '</span></td><td class="n">' + r.wins + '</td><td class="n">' + r.losses + '</td><td class="n">' + r.pct + '%</td></tr>'; }).join('') +
          '</tbody></table></div>' : '<div class="list"><p class="empty">No confirmed results yet.</p></div>');
    });
  };

  /* ---------- notifications ---------- */
  views.notifications = function () {
    return api.get('/api/notifications').then(function (d) {
      app.innerHTML = offlineNote(d) + head('Notifications', d.unread ? d.unread + ' new' : 'You’re caught up', '', d.unread ? '<button class="btn ghost" type="button" id="all">Mark all read</button>' : '') +
        (d.items.length ? '<div class="list">' + d.items.map(function (n) {
          return '<a class="li notif' + (n.read_at ? '' : ' unread') + '" href="' + h(n.link || '#/') + '" data-id="' + n.id + '"><span class="main-col"><span class="t small">' + h(n.title) + '</span>' + (n.body ? '<span class="d">' + h(n.body) + '</span>' : '') + '</span><span class="side">' + h(L.when(n.created_at)) + '</span></a>';
        }).join('') + '</div>' : '<div class="list"><p class="empty">Nothing yet. Court assignments, coach feedback, match confirmations and new Field Notes show up here.</p></div>') +
        '<p class="small"><a href="#/profile#prefs">Choose which notifications you get →</a></p>';
      if ($('#all')) $('#all').addEventListener('click', function () { api.request('POST', '/api/notifications/read', {}).then(function () { pollBell(); route(); }); });
      $$('.notif').forEach(function (a) { a.addEventListener('click', function () { api.request('POST', '/api/notifications/read', { id: Number(a.getAttribute('data-id')) }).then(pollBell, function () {}); }); });
    });
  };
  var lastPoll = 0;
  function pollBell(throttled) {
    if (!ME || !L.isOnline()) return;
    if (throttled === true && Date.now() - lastPoll < 10000) return;
    lastPoll = Date.now();
    api.request('GET', '/api/notifications').then(function (d) {
      var b = $('#bell'); if (!b) return;
      b.hidden = false; b.setAttribute('data-n', d.unread ? String(d.unread) : '');
      b.setAttribute('aria-label', d.unread ? d.unread + ' unread notifications' : 'Notifications');
    }, function () {});
  }
  setInterval(pollBell, 60000);
  window.addEventListener('focus', pollBell);

  /* ================= sync screen ================= */
  views.sync = function () {
    var q = L.outbox(), failed = Store.get('failed', []), s = L.status();
    app.innerHTML = head('Sync', s.text, L.isOnline() ? 'Changes go to THE LAB as soon as they’re made.' : 'You’re offline. Scores, notes and drafts are saved on this device and will sync automatically.') +
      '<div class="stack"><p class="section-title">Waiting to sync · ' + q.length + '</p>' + (q.length ? '<div class="list">' + summarizeQueue(q).map(function (x) { return '<div class="li"><span class="d">' + h(x) + '</span></div>'; }).join('') + '</div>' : '<div class="list"><p class="empty">Everything is synced.</p></div>') + '</div>' +
      '<div class="row"><button class="btn primary" type="button" id="now">Sync now</button></div>' +
      (failed.length ? '<div class="stack"><p class="section-title">Couldn’t be saved · ' + failed.length + '</p><div class="list">' + failed.slice().reverse().map(function (f) { return '<div class="li"><span class="main-col"><span class="t">' + h(f.label) + '</span><span class="d">' + h(f.error) + '</span></span><span class="side">' + h(L.when(new Date(f.at).toISOString())) + '</span></div>'; }).join('') + '</div><div class="row"><button class="btn ghost" type="button" id="clr">Clear this list</button></div></div>' : '') +
      '<div class="coming"><p class="eyebrow">Needs a connection</p><ul><li>Signing in, creating accounts, claiming a profile</li><li>Creating athlete profiles and issuing claim codes</li><li>Uploading photos and video</li><li>Submitting, publishing and scheduling posts</li></ul><p class="small muted">Scorekeeping, counters, notes, reflections and post drafts all work offline.</p></div>';
    $('#now').addEventListener('click', function () { L.flush().then(function () { setTimeout(route, 400); }); });
    if ($('#clr')) $('#clr').addEventListener('click', function () { Store.set('failed', []); L.status(); route(); });
  };
  function summarizeQueue(q) {
    var out = [], taps = {};
    q.forEach(function (x) {
      if (x.type === 'events') { taps[x.session] = (taps[x.session] || 0) + 1; return; }
      out.push(x.label || (x.method + ' ' + x.path));
    });
    Object.keys(taps).forEach(function (sid) { var s = Store.get('session:' + sid); out.push(taps[sid] + ' score' + (taps[sid] > 1 ? 's' : '') + ' in “' + (s ? s.title : 'session') + '”'); });
    return out;
  }

  function forbidden(msg) {
    app.innerHTML = head('No access', 'This area is for staff', msg + ' If you think you should have access, ask an admin.') + '<div class="row"><a class="btn" href="#/">Go home</a></div>';
  }

  /* ================= router ================= */
  var ROUTES = [
    [/^\/signin$/, 'signin', '', true], [/^\/signup$/, 'signup', '', true], [/^\/forgot$/, 'forgot', '', true], [/^\/reset\/([\w-]+)$/, 'reset', '', true],
    [/^\/?$/, 'home', 'home'],
    [/^\/train$/, 'train', 'train'], [/^\/train\/new$/, 'trainNew', 'train'],
    [/^\/train\/scoreboard$/, 'boardNew', 'train'], [/^\/train\/scoreboard\/([0-9a-f-]{36})$/, 'board', 'train'],
    [/^\/train\/([0-9a-f-]{36})\/live$/, 'live', 'train'], [/^\/train\/([0-9a-f-]{36})$/, 'session', 'train'],
    [/^\/play$/, 'play', 'play'], [/^\/play\/match\/new$/, 'matchNew', 'play'], [/^\/play\/match\/([0-9a-f-]{36})$/, 'match', 'play'],
    [/^\/play\/events$/, 'events', 'play'], [/^\/play\/events\/new$/, 'eventForm', 'play'], [/^\/play\/events\/(\d+)$/, 'event', 'play'], [/^\/play\/events\/(\d+)\/edit$/, 'eventForm', 'play'],
    [/^\/play\/leaderboard$/, 'leaderboard', 'play'], [/^\/notifications$/, 'notifications', ''],
    [/^\/learn$/, 'learn', 'learn', true], [/^\/learn\/courses$/, 'learnCourses', 'learn', true], [/^\/learn\/course\/([\w-]+)$/, 'course', 'learn', true], [/^\/learn\/course\/([\w-]+)\/(\d+)$/, 'lesson', 'learn', true], [/^\/learn\/engine$/, 'engine', 'learn', true], [/^\/learn\/([\w-]+)$/, 'post', 'learn', true],
    [/^\/profile$/, 'profile', 'profile'],
    [/^\/coach$/, 'coach', 'home'], [/^\/coach\/new$/, 'coachNew', 'home'], [/^\/coach\/templates$/, 'templates', 'home'], [/^\/coach\/templates\/(new|\d+)$/, 'templateEdit', 'home'], [/^\/coach\/(\d+)$/, 'coachAthlete', 'home'], [/^\/coach\/(\d+)\/code$/, 'coachCode', 'home'],
    [/^\/studio\/courses$/, 'studioCourses', 'home'], [/^\/studio\/course\/(\d+)$/, 'courseEdit', 'home'], [/^\/studio\/lesson\/(\d+)$/, 'lessonEdit', 'home'],
    [/^\/cohorts$/, 'cohorts', 'learn'], [/^\/cohorts\/(\d+)$/, 'cohort', 'learn'],
    [/^\/studio$/, 'studio', 'home'], [/^\/studio\/([\w-]+)$/, 'studioEdit', 'home'],
    [/^\/admin$/, 'admin', 'home'], [/^\/sync$/, 'sync', '']
  ];
  function parse() {
    var raw = (location.hash || '#/').slice(1);
    var hashAt = raw.indexOf('#'); if (hashAt >= 0) raw = raw.slice(0, hashAt);
    var qi = raw.indexOf('?'), path = qi >= 0 ? raw.slice(0, qi) : raw, query = {};
    if (qi >= 0) raw.slice(qi + 1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) query[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
    for (var i = 0; i < ROUTES.length; i++) { var m = ROUTES[i][0].exec(path); if (m) return { r: ROUTES[i], m: m, query: query }; }
    return null;
  }
  function isPublic() { var p = parse(); return p && p.r[3]; }

  function route() {
    var p = parse();
    if (!p) { location.hash = '#/'; return; }
    if (!p.r[3] && !ME) { location.hash = '#/signin'; return; }
    $('#nav').hidden = !ME;
    $('#bell').hidden = !ME;
    if (ME) pollBell(true);
    $$('.nav a').forEach(function (a) { if (a.getAttribute('data-nav') === p.r[2]) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    app.innerHTML = '<p class="muted small" role="status">Loading…</p>';
    window.scrollTo(0, 0);
    Promise.resolve().then(function () { return views[p.r[1]](p.m[1], p.query, p.m[2]); }).catch(function (err) {
      if (err.status === 401) return;
      var offline = err.status === 0;
      app.innerHTML = head(offline ? 'Offline' : err.status === 404 ? 'Not found' : err.status === 403 ? 'No access' : 'Something went wrong',
        offline ? 'This screen hasn’t been saved on this device yet' : err.status === 404 ? 'That doesn’t exist, or it isn’t shared with you' : 'Couldn’t load this screen',
        offline ? 'Open it once with a connection and it will be available offline next time.' : err.message) +
        '<div class="row"><button class="btn" type="button" id="retry">Try again</button><a class="btn ghost" href="#/">Go home</a></div>';
      $('#retry').addEventListener('click', route);
    }).then(function () { if (document.activeElement === document.body) app.focus({ preventScroll: true }); });
  }
  window.addEventListener('hashchange', route);
  L.on('synced', function (d) { if (!d.error && d.entry.method === 'POST' && /\/notes$/.test(d.entry.path || '') && L.outbox().length === 0) { var p = parse(); if (p && (p.r[1] === 'profile' || p.r[1] === 'coachAthlete')) route(); } });

  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });

  // Confirm the session is still valid, then render.
  var META = Store.get('meta', {});
  api.request('GET', '/api/meta').then(function (m) { META = m; Store.set('meta', m); if ($('#gbtn') && m.google) $('#gbtn').hidden = false; }, function () {});
  if (ME) api.request('GET', '/api/me').then(function (m) { setMe(m); }, function (err) { if (err.status === 401) setMe(null); }).then(function () { route(); pollBell(); });
  else route();
  L.status(); L.flush();
})();
