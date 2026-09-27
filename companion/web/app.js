/* LAB Sideline front end. Plain JS, hash routing, talks to /api. */
(function () {
  'use strict';
  var E = window.LabEngine;
  var app = document.getElementById('app');
  var META = { auth: false };
  var KEY_STORE = 'lab-sideline-coach-key';

  /* ================= helpers ================= */
  function h(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function callName(id) { return E.BY[id] ? E.BY[id].name : (id ? id : 'No call'); }
  function errorById(id) { return E.ERRORS.filter(function (e) { return e.id === id; })[0] || E.ERRORS[0]; }
  function pct(right, n) { return n ? Math.round(right / n * 100) + '%' : '—'; }
  function when(ts) {
    if (!ts) return '';
    var d = new Date(ts.replace(' ', 'T') + 'Z');
    if (isNaN(d)) return ts;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function fmtDate(d) {
    if (!d) return 'No date';
    var x = new Date(d + 'T12:00:00');
    return isNaN(x) ? d : x.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  var tt;
  function toast(msg) {
    var el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(tt); tt = setTimeout(function () { el.hidden = true; }, 2200);
  }

  function api(method, path, body) {
    var headers = { 'Accept': 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    var key = store(KEY_STORE);
    if (key) headers['Authorization'] = 'Bearer ' + key;
    return fetch(path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (res) {
        if (res.status === 204) return null;
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            if (res.status === 401) askKey();
            var err = new Error(data.error || ('Request failed (' + res.status + ').'));
            err.status = res.status; throw err;
          }
          return data;
        });
      }, function () { throw new Error('Can’t reach the server. Check that it’s running.'); });
  }

  /* Two-tap confirm for destructive buttons. */
  function armed(btn, label, fn) {
    btn.addEventListener('click', function () {
      if (btn.classList.contains('armed')) { fn(); return; }
      var orig = btn.textContent;
      btn.classList.add('armed'); btn.textContent = label || 'Tap again to delete';
      setTimeout(function () { btn.classList.remove('armed'); btn.textContent = orig; }, 3000);
    });
  }

  function formError(form, msg) {
    var el = $('.err', form);
    if (!el) { el = document.createElement('p'); el.className = 'err'; form.appendChild(el); }
    el.textContent = msg;
  }

  function positionChecks(name, selected) {
    selected = selected || [];
    return '<div class="checks">' + E.POSITIONS.map(function (p, i) {
      return '<label><input type="checkbox" name="' + name + '" value="' + h(p) + '"' + (selected.indexOf(p) >= 0 ? ' checked' : '') + '> ' + h(p) + '</label>';
    }).join('') + '</div>';
  }
  function readChecks(root, name) { return $$('input[name="' + name + '"]:checked', root).map(function (i) { return i.value; }); }

  function callOptions(selected, emptyLabel) {
    return '<option value="">' + h(emptyLabel || 'No call') + '</option>' + E.CALLS.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === selected ? ' selected' : '') + '>' + h(c.name) + '</option>';
    }).join('');
  }

  function errorBars(errors) {
    var max = Math.max.apply(null, E.ERRORS.map(function (e) { return errors[e.id] || 0; })) || 1;
    var top = E.ERRORS.reduce(function (a, e) { return (errors[e.id] || 0) > (errors[a] || 0) ? e.id : a; }, E.ERRORS[0].id);
    return '<div class="bars">' + E.ERRORS.map(function (e) {
      var n = errors[e.id] || 0;
      return '<div class="bar' + (e.id === top && n ? ' top' : '') + '"><span>' + h(e.name) + '</span><span class="track"><i style="width:' + (n / max * 100) + '%"></i></span><span class="c">' + n + '</span></div>';
    }).join('') + '</div>' + (errors[top]
      ? '<p class="flag"><b>Coach ' + h(errorById(top).name) + ' first.</b> ' + h(errorById(top).fix) + '.</p>'
      : '<p class="flag"><b>No errors logged yet.</b> Log reps from a player’s profile.</p>');
  }

  /* ================= engine panel ================= */
  function seg(name, opts, value, extra) {
    return '<div class="seg' + (extra || '') + '" data-seg="' + name + '">' + opts.map(function (o, i) {
      var id = name + '-' + i;
      return '<input type="radio" name="' + name + '" id="' + id + '" value="' + o[0] + '"' + (String(o[0]) === String(value) ? ' checked' : '') + '><label for="' + id + '">' + o[1] + '</label>';
    }).join('') + '</div>';
  }
  function panelHTML(p, s) {
    s = E.normalize(s);
    var lv = [[0, 'Zero'], [1, 'Low'], [2, 'Mod'], [3, 'High']];
    function tog(id, title, text, on) { return '<label class="tog" for="' + p + id + '"><input type="checkbox" id="' + p + id + '"' + (on ? ' checked' : '') + '><div><b>' + title + '</b><span>' + text + '</span></div></label>'; }
    return '' +
      '<div class="stack"><p class="section-title">Read · H × T × B</p><p class="small muted" data-persp></p>' +
      '<div class="field"><span class="flabel">Height <span class="hint">release point</span></span>' + seg(p + 'h', lv, s.h) + '</div>' +
      '<div class="field"><span class="flabel">Time <span class="hint">steps before pressure</span></span>' + seg(p + 't', lv, s.t) + '</div>' +
      '<div class="field"><span class="flabel">Balance <span class="hint">weight over base</span></span>' + seg(p + 'b', lv, s.b) + '</div>' +
      '<div class="field"><span class="flabel">Orientation <span class="hint">hips, eyes, stick</span></span>' + seg(p + 'o', [['to', 'To goal'], ['away', 'Away']], s.o) + '</div>' +
      '<div class="field"><span class="flabel">Certainty <span class="hint">how clean is the read</span></span>' + seg(p + 'c', [['low', 'Low'], ['mod', 'Moderate'], ['high', 'High']], s.cert) + '</div></div>' +
      '<div class="stack"><p class="section-title">State</p>' + seg(p + 's', [['D', 'Defensive'], ['N', 'Neutral'], ['O', 'Offensive']], s.state) +
      tog('scr', 'Scramble layer', 'Structure broken, assignments stale. Overlays the state.', s.scr) + '</div>' +
      '<div class="stack"><p class="section-title">Need · one rung at a time</p>' + seg(p + 'n', E.RUNGS.map(function (r, i) { return [i, r]; }), s.need, ' ladder') + '</div>' +
      '<div class="stack"><p class="section-title">Solve inputs</p><div class="toggles">' +
      tog('debt', 'Debt unpaid', 'Already committed this possession and not recovered.', s.debt) +
      tog('cover', 'Cover available', 'Someone can take the Cover job if I leave my slot.', s.cover) +
      tog('drift', 'Eyes drifting', 'Attention pulled to the ball, off the point that makes the shot.', s.drift) +
      '</div></div>';
  }
  function readPanel(root, p) {
    function r(n) { var el = $('input[name="' + p + n + '"]:checked', root); return el ? el.value : null; }
    function c(n) { var el = $('#' + p + n, root); return !!(el && el.checked); }
    return E.normalize({ h: r('h'), t: r('t'), b: r('b'), o: r('o'), cert: r('c'), state: r('s'), need: r('n'), scr: c('scr'), debt: c('debt'), cover: c('cover'), drift: c('drift') });
  }
  function bindPanel(root, p, onChange) {
    function go() {
      var s = readPanel(root, p);
      ['h', 't', 'b'].forEach(function (k) { var el = $('[data-seg="' + p + k + '"]', root); if (el) el.classList.toggle('is-zeroed', s[k] === 0); });
      var persp = $('[data-persp]', root);
      if (persp) persp.textContent = s.state === 'O' ? 'Offensive: these are your own factors. You are buying the one you’re short of.' : 'Defending: these are the ball carrier’s factors. You only need to zero the cheapest one.';
      onChange(s);
    }
    $$('input', root).forEach(function (i) { i.addEventListener('change', go); });
    go();
  }
  function outputHTML(out, opts) {
    opts = opts || {};
    var c = E.BY[out.call];
    return '<div class="card-head"><span class="eyebrow">' + h(opts.label || 'Output') + '</span><span class="product' + (out.product === 0 ? ' is-zero' : '') + '"><b>' + out.product + '</b>of 27</span></div>' +
      '<ol class="four">' +
      '<li><span class="n">1</span><div><span class="k">Read</span><span class="v">' + h(out.read) + '</span></div></li>' +
      '<li><span class="n">2</span><div><span class="k">State + Need</span><span class="v">' + h(out.state) + '</span></div></li>' +
      (opts.hideAction ? '' : '<li><span class="n">3</span><div><span class="k">Action</span><span class="act">' + h(c.name) + (c.seq ? '<span class="seq">' + h(c.seq) + '</span>' : '') + '</span></div></li>') +
      '<li><span class="n">4</span><div><span class="k">Why</span><span class="v">' + h(out.why) + '</span></div></li></ol>' +
      (out.flags.length ? '<div class="stack-sm">' + out.flags.map(function (f) { return '<p class="flag"><b>' + h(f.title) + '.</b> ' + h(f.text) + '</p>'; }).join('') + '</div>' : '') +
      (opts.noLegal ? '' : '<details class="more"><summary>Every call from here</summary><div class="legal">' + out.legal.map(function (l) {
        var k = E.BY[l.id], pick = l.id === out.call;
        var pill = pick ? '<span class="pill pick">Call</span>' : (l.ok ? '<span class="pill yes">Legal</span>' : '<span class="pill no">No</span>');
        return '<div class="lrow' + (l.ok ? '' : ' is-no') + '">' + pill + '<div><span class="cn">' + h(k.name) + '</span><span class="why">' + h(l.why) + '</span></div></div>';
      }).join('') + '</div></details>');
  }
  function outputText(out) {
    var c = E.BY[out.call];
    return '1. Read — ' + out.read + '\n2. State + Need — ' + out.state + '\n3. Action — ' + c.name + (c.seq ? ': ' + c.seq : '') + '\n4. Why — ' + out.why;
  }

  /* Hand-off between views (e.g. Call -> new situation). */
  var handoff = {};

  /* ================= views ================= */
  var views = {};

  views.home = function () {
    return api('GET', '/api/dashboard').then(function (d) {
      var topErr = E.ERRORS.reduce(function (a, e) { return (d.errors[e.id] || 0) > (d.errors[a] || 0) ? e.id : a; }, E.ERRORS[0].id);
      var hasDemo = d.roster.some(function (p) { return p.demo; });
      app.innerHTML =
        '<div class="head"><p class="eyebrow">Team</p><h1>Where the team is</h1><p>Film accuracy, the errors you’ve logged, and what to coach next.</p></div>' +
        (hasDemo ? '<p class="flag"><b>Demo roster loaded.</b> The players marked Demo are examples so the numbers aren’t empty. Clear them from the Players tab.</p>' : '') +
        '<div class="tiles">' +
        '<div class="tile"><span class="l">Players</span><span class="n">' + d.counts.players + '</span><span class="s">on the roster</span></div>' +
        '<div class="tile"><span class="l">Film accuracy</span><span class="n">' + pct(d.film.right, d.film.n) + '</span><span class="s">' + d.film.right + ' of ' + d.film.n + ' reps</span></div>' +
        '<div class="tile hot"><span class="l">Coach first</span><span class="n">' + (d.errors[topErr] ? h(errorById(topErr).name) : '—') + '</span><span class="s">' + (d.errors[topErr] ? h(errorById(topErr).fix) : 'no errors logged') + '</span></div>' +
        '<div class="tile"><span class="l">Library</span><span class="n">' + d.counts.situations + ' / ' + d.counts.drills + '</span><span class="s">situations / drills</span></div>' +
        '</div>' +
        '<div class="grid-2">' +
        '<div class="stack"><p class="section-title">Roster</p>' + (d.roster.length ? '<div class="list">' + d.roster.map(function (p) {
          return '<a class="li" href="#/players/' + p.id + '"><span class="who"><span class="jersey">' + h(p.number || '–') + '</span><span class="main-col"><span class="t">' + h(p.name) + '</span><span class="d">' + h(p.position || 'No position') + (p.demo ? ' · <span class="tag demo">Demo</span>' : '') + '</span></span></span>' +
            '<span class="side"><span>' + pct(p.right, p.seen) + ' film</span><span>' + p.reps + ' rep' + (p.reps === 1 ? '' : 's') + ' logged</span></span></a>';
        }).join('') + '</div>' : '<div class="list"><p class="empty">No players yet. <a href="#/players">Add your roster</a>.</p></div>') + '</div>' +
        '<div class="stack"><p class="section-title">Errors logged, whole team</p>' + errorBars(d.errors) + '</div>' +
        '<div class="stack"><p class="section-title">Most-missed film</p>' + (d.missed.length ? '<div class="list">' + d.missed.map(function (m) {
          return '<a class="li" href="#/film/' + m.id + '"><span class="main-col"><span class="t">' + h(m.title) + '</span></span><span class="side"><span>' + m.wrong + ' of ' + m.n + ' missed</span></span></a>';
        }).join('') + '</div>' : '<div class="list"><p class="empty">Nothing missed yet.</p></div>') + '</div>' +
        '<div class="stack"><p class="section-title">Next practice</p>' + (d.nextPlan
          ? '<div class="list"><a class="li" href="#/plans/' + d.nextPlan.id + '"><span class="main-col"><span class="t">' + h(d.nextPlan.title) + '</span><span class="d">' + h(fmtDate(d.nextPlan.date)) + '</span></span><span class="side">Open \u2192</span></a></div>'
          : '<div class="list"><p class="empty">No upcoming plan. <a href="#/plans/new">Build one</a>.</p></div>') +
        '<p class="section-title">Recent reps</p>' + (d.recent.length ? '<div class="list">' + d.recent.map(function (r) {
          return '<div class="li"><span class="main-col"><span class="d"><b>' + h(r.player || 'Team') + '</b> · ' + h(r.note || 'No note') + '</span></span><span class="side"><span class="tag call">' + h(errorById(r.error).name) + '</span></span></div>';
        }).join('') + '</div>' : '<div class="list"><p class="empty">No reps logged.</p></div>') + '</div>' +
        '</div>';
    });
  };

  views.call = function () {
    var saved = null; try { saved = JSON.parse(sessionStorage.getItem('lab-call') || 'null'); } catch (e) {}
    var start = saved || { h: 3, t: 2, b: 3, o: 'to', cert: 'low', state: 'N', need: 2 };
    app.innerHTML =
      '<div class="head"><p class="eyebrow">Run the pipeline</p><h1>Set the read. Get one call.</h1><p>Tap in what you saw. You get the four-part output and every call’s legality from here.</p></div>' +
      '<div class="grid-2"><div class="card" id="out"></div><div class="stack" id="panel">' + panelHTML('c-', start) + '</div></div>';
    var last;
    bindPanel($('#panel'), 'c-', function (s) {
      try { sessionStorage.setItem('lab-call', JSON.stringify(s)); } catch (e) {}
      last = { s: s, out: E.run(s) };
      $('#out').innerHTML = outputHTML(last.out) +
        '<div class="row"><button class="btn primary" type="button" id="copy">Copy output</button><button class="btn ghost" type="button" id="save-sit">Save as film situation</button></div>';
      $('#copy').addEventListener('click', function () {
        try { navigator.clipboard.writeText(outputText(last.out)).then(function () { toast('Copied'); }, function () { toast('Copy blocked by the browser.'); }); }
        catch (e) { toast('Copy blocked by the browser.'); }
      });
      $('#save-sit').addEventListener('click', function () { handoff.inputs = last.s; location.hash = '#/film/new'; });
    });
    return Promise.resolve();
  };

  /* ---------- players ---------- */
  function playerForm(p) {
    p = p || {};
    return '<form class="card form" id="pform" novalidate>' +
      '<div class="form-grid">' +
      '<div class="field"><label class="flabel" for="pf-name">Name</label><input type="text" id="pf-name" maxlength="80" required value="' + h(p.name) + '"></div>' +
      '<div class="field"><label class="flabel" for="pf-number">Number</label><input type="text" id="pf-number" maxlength="4" inputmode="numeric" value="' + h(p.number) + '"></div>' +
      '<div class="field"><label class="flabel" for="pf-pos">Position</label><select id="pf-pos"><option value="">None</option>' + E.POSITIONS.map(function (x) { return '<option' + (x === p.position ? ' selected' : '') + '>' + h(x) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label class="flabel" for="pf-level">Level</label><input type="text" id="pf-level" maxlength="40" placeholder="Varsity, JV, U15" value="' + h(p.level) + '"></div>' +
      '</div>' +
      '<div class="field"><label class="flabel" for="pf-notes">Notes</label><textarea id="pf-notes" maxlength="2000">' + h(p.notes) + '</textarea></div>' +
      '<div class="row"><button class="btn primary" type="submit">' + (p.id ? 'Save player' : 'Add player') + '</button><button class="btn ghost" type="button" id="pf-cancel">Cancel</button></div></form>';
  }
  function readPlayerForm() {
    return { name: $('#pf-name').value, number: $('#pf-number').value, position: $('#pf-pos').value, level: $('#pf-level').value, notes: $('#pf-notes').value };
  }

  views.players = function () {
    return api('GET', '/api/players').then(function (list) {
      var demo = list.filter(function (p) { return p.demo; }).length;
      app.innerHTML =
        '<div class="head-row"><div class="head"><p class="eyebrow">Roster</p><h1>Players</h1><p>Each profile tracks film accuracy and the errors logged against that player.</p></div>' +
        '<button class="btn primary" type="button" id="add">Add player</button></div>' +
        '<div id="form-slot"></div>' +
        (list.length ? '<div class="list">' + list.map(function (p) {
          return '<a class="li" href="#/players/' + p.id + '"><span class="who"><span class="jersey">' + h(p.number || '–') + '</span><span class="main-col"><span class="t">' + h(p.name) + '</span><span class="d">' + h([p.position, p.level].filter(Boolean).join(' · ') || 'No position') + '</span></span></span>' +
            '<span class="side">' + (p.demo ? '<span class="tag demo">Demo</span>' : '') + '</span></a>';
        }).join('') + '</div>' : '<div class="list"><p class="empty">No players yet. Add your roster to start tracking film and errors.</p></div>') +
        (demo ? '<div class="row"><button class="btn danger" type="button" id="clear-demo">Clear ' + demo + ' demo player' + (demo > 1 ? 's' : '') + '</button></div>' : '');
      $('#add').addEventListener('click', function () {
        $('#form-slot').innerHTML = playerForm();
        $('#pf-name').focus();
        $('#pf-cancel').addEventListener('click', function () { $('#form-slot').innerHTML = ''; });
        $('#pform').addEventListener('submit', function (e) {
          e.preventDefault();
          api('POST', '/api/players', readPlayerForm()).then(function (p) { toast('Player added'); location.hash = '#/players/' + p.id; }, function (err) { formError($('#pform'), err.message); });
        });
      });
      if (demo) armed($('#clear-demo'), 'Tap again to clear demo players', function () {
        api('DELETE', '/api/players/demo').then(function () { toast('Demo players cleared'); route(); }, function (err) { toast(err.message); });
      });
    });
  };

  views.player = function (id) {
    return api('GET', '/api/players/' + id).then(function (d) {
      var p = d.player;
      app.innerHTML =
        '<a class="back" href="#/players">← Players</a>' +
        '<div class="head-row"><div class="who"><span class="jersey lg">' + h(p.number || '–') + '</span><div class="head"><p class="eyebrow">' + h([p.position, p.level].filter(Boolean).join(' · ') || 'Player') + (p.demo ? ' · Demo' : '') + '</p><h1>' + h(p.name) + '</h1></div></div>' +
        '<div class="row"><a class="btn primary" href="#/film/session/' + p.id + '">Film session</a><button class="btn ghost" type="button" id="edit">Edit</button><button class="btn danger" type="button" id="del">Delete</button></div></div>' +
        (p.notes ? '<p class="muted">' + h(p.notes) + '</p>' : '') +
        '<div id="form-slot"></div>' +
        '<div class="tiles">' +
        '<div class="tile"><span class="l">Film accuracy</span><span class="n">' + pct(d.film.right, d.film.seen) + '</span><span class="s">' + d.film.right + ' of ' + d.film.seen + ' reps</span></div>' +
        '<div class="tile"><span class="l">Reps logged</span><span class="n">' + d.reps.length + '</span><span class="s">errors classified</span></div>' +
        '<div class="tile hot"><span class="l">Coach first</span><span class="n">' + (d.focus ? h(errorById(d.focus).name) : '—') + '</span><span class="s">' + (d.focus ? h(errorById(d.focus).fix) : 'nothing logged yet') + '</span></div>' +
        '</div>' +
        '<div class="grid-2">' +
        '<div class="stack"><p class="section-title">Log a rep</p>' +
        '<form class="card form" id="rform">' +
        '<div class="field"><label class="flabel" for="r-note">What happened</label><textarea id="r-note" maxlength="2000" placeholder="Slid early off the wing, ball swung behind me, their X popped for a layup."></textarea></div>' +
        '<div class="form-grid"><div class="field"><label class="flabel" for="r-call">Call made</label><select id="r-call">' + callOptions('', 'No call made') + '</select></div>' +
        '<div class="field"><label class="flabel" for="r-err">What broke</label><select id="r-err">' + E.ERRORS.map(function (e) { return '<option value="' + e.id + '">' + h(e.name) + ' · ' + h(e.what) + '</option>'; }).join('') + '</select></div></div>' +
        '<p class="small muted" id="r-fix"></p>' +
        '<div class="row"><button class="btn primary" type="submit">Save rep</button></div></form>' +
        '<p class="section-title">Error breakdown</p>' + errorBars(d.errors) + '</div>' +
        '<div class="stack"><p class="section-title">Film by call</p>' + (d.byCall.length ? '<div class="bars">' + d.byCall.map(function (b) {
          return '<div class="bar"><span>' + h(callName(b.call)) + '</span><span class="track"><i style="width:' + (b.right / b.n * 100) + '%"></i></span><span class="c">' + b.right + '/' + b.n + '</span></div>';
        }).join('') + '</div><p class="small muted">Right answers out of reps seen, grouped by the correct call.</p>' : '<div class="list"><p class="empty">No film yet. Run a film session.</p></div>') +
        '<p class="section-title">Reps</p><div class="list" id="reps">' + (d.reps.length ? d.reps.map(function (r) {
          return '<div class="li"><span class="main-col"><span class="d">' + h(r.note || 'No note') + '</span><span class="row"><span class="tag call">' + h(errorById(r.error).name) + ' error</span>' + (r.call ? '<span class="tag">' + h(callName(r.call)) + '</span>' : '') + '<span class="small muted mono">' + h(when(r.created_at)) + '</span></span></span>' +
            '<button class="btn sm ghost" type="button" data-del-rep="' + r.id + '">Delete</button></div>';
        }).join('') : '<p class="empty">No reps logged.</p>') + '</div>' +
        '<p class="section-title">Recent film</p>' + (d.attempts.length ? '<div class="list">' + d.attempts.map(function (a) {
          return '<a class="li" href="#/film/' + a.situation_id + '"><span class="main-col"><span class="t">' + h(a.title || 'Deleted situation') + '</span><span class="d">Picked ' + h(callName(a.guess)) + (a.correct ? '' : ' · answer ' + h(callName(a.answer))) + '</span></span><span class="side">' + (a.correct ? '<span class="tag ok">Right</span>' : '<span class="tag call">Missed</span>') + '</span></a>';
        }).join('') + '</div>' : '<div class="list"><p class="empty">No film yet.</p></div>') +
        '</div></div>';

      function fix() { var e = errorById($('#r-err').value); $('#r-fix').textContent = 'Fix: ' + e.fix + '.'; }
      $('#r-err').addEventListener('change', fix); fix();
      $('#rform').addEventListener('submit', function (e) {
        e.preventDefault();
        api('POST', '/api/reps', { player_id: p.id, note: $('#r-note').value, call: $('#r-call').value, error: $('#r-err').value })
          .then(function () { toast('Rep saved'); route(); }, function (err) { formError($('#rform'), err.message); });
      });
      $$('[data-del-rep]').forEach(function (b) {
        armed(b, 'Confirm', function () { api('DELETE', '/api/reps/' + b.getAttribute('data-del-rep')).then(function () { toast('Rep deleted'); route(); }, function (err) { toast(err.message); }); });
      });
      $('#edit').addEventListener('click', function () {
        $('#form-slot').innerHTML = playerForm(p);
        $('#pf-cancel').addEventListener('click', function () { $('#form-slot').innerHTML = ''; });
        $('#pform').addEventListener('submit', function (e) {
          e.preventDefault();
          api('PUT', '/api/players/' + p.id, readPlayerForm()).then(function () { toast('Player saved'); route(); }, function (err) { formError($('#pform'), err.message); });
        });
      });
      armed($('#del'), 'Tap again to delete', function () {
        api('DELETE', '/api/players/' + p.id).then(function () { toast('Player deleted'); location.hash = '#/players'; }, function (err) { toast(err.message); });
      });
    });
  };

  /* ---------- film ---------- */
  var filmCfg = { position: '', state: '' };

  views.film = function () {
    return Promise.all([api('GET', '/api/situations'), api('GET', '/api/players')]).then(function (res) {
      var sits = res[0], players = res[1];
      function filtered() {
        return sits.filter(function (s) {
          return (!filmCfg.position || s.positions.indexOf(filmCfg.position) >= 0) && (!filmCfg.state || s.inputs.state === filmCfg.state);
        });
      }
      app.innerHTML =
        '<div class="head-row"><div class="head"><p class="eyebrow">Film room</p><h1>Situations</h1><p>Run a film session for a player, or browse and add situations. The engine grades every answer.</p></div>' +
        '<a class="btn primary" href="#/film/new">New situation</a></div>' +
        '<div class="card"><p class="section-title">Start a film session</p>' +
        '<div class="form-grid"><div class="field"><label class="flabel" for="fs-player">Player</label><select id="fs-player"><option value="0">Nobody (don’t save results)</option>' +
        players.map(function (p) { return '<option value="' + p.id + '">' + h((p.number ? '#' + p.number + ' ' : '') + p.name) + '</option>'; }).join('') + '</select></div></div>' +
        '<div class="row"><button class="btn primary" type="button" id="fs-start">Start session</button><span class="small muted" id="fs-count"></span></div></div>' +
        '<div class="stack"><div class="chips" id="f-pos"><button class="chip" type="button" data-v="">All positions</button>' + E.POSITIONS.map(function (p) { return '<button class="chip" type="button" data-v="' + h(p) + '">' + h(p) + '</button>'; }).join('') + '</div>' +
        '<div class="chips" id="f-state"><button class="chip" type="button" data-v="">Any state</button>' + Object.keys(E.STATES).map(function (k) { return '<button class="chip" type="button" data-v="' + k + '">' + E.STATES[k] + '</button>'; }).join('') + '</div>' +
        '<div class="list" id="sit-list"></div></div>';

      function paint() {
        $$('#f-pos .chip').forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-v') === filmCfg.position ? 'true' : 'false'); });
        $$('#f-state .chip').forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-v') === filmCfg.state ? 'true' : 'false'); });
        var list = filtered();
        $('#fs-count').textContent = list.length + ' situation' + (list.length === 1 ? '' : 's') + ' match the filters below';
        $('#fs-start').disabled = !list.length;
        $('#sit-list').innerHTML = list.length ? list.map(function (s) {
          return '<a class="li" href="#/film/' + s.id + '"><span class="main-col"><span class="t">' + h(s.title) + '</span><span class="d">' + h(s.description) + '</span></span>' +
            '<span class="side"><span class="tag call">' + h(callName(s.answer)) + '</span><span>' + h(E.STATES[s.inputs.state]) + '</span></span></a>';
        }).join('') : '<p class="empty">No situations match. Clear a filter or add one.</p>';
      }
      $('#f-pos').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (c) { filmCfg.position = c.getAttribute('data-v'); paint(); } });
      $('#f-state').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (c) { filmCfg.state = c.getAttribute('data-v'); paint(); } });
      $('#fs-start').addEventListener('click', function () { location.hash = '#/film/session/' + $('#fs-player').value; });
      paint();
    });
  };

  views.filmSession = function (pid) {
    pid = +pid;
    return Promise.all([api('GET', '/api/situations'), pid ? api('GET', '/api/players/' + pid).then(function (d) { return d.player; }) : Promise.resolve(null)]).then(function (res) {
      var pool = res[0].filter(function (s) {
        return (!filmCfg.position || s.positions.indexOf(filmCfg.position) >= 0) && (!filmCfg.state || s.inputs.state === filmCfg.state);
      });
      var player = res[1];
      var order = shuffle(pool.slice()), i = -1, score = { right: 0, seen: 0, streak: 0 };
      app.innerHTML =
        '<a class="back" href="' + (player ? '#/players/' + player.id : '#/film') + '">← ' + (player ? h(player.name) : 'Film room') + '</a>' +
        '<div class="head"><p class="eyebrow">Film session' + (player ? ' · results save to ' + h(player.name) : ' · not saved') + '</p><h1>Make the call</h1></div>' +
        '<div class="score-strip"><span>Right <b id="s-right">0</b></span><span>Seen <b id="s-seen">0</b></span><span>Streak <b id="s-streak">0</b></span></div>' +
        '<div class="card" id="rep"></div>';
      if (!order.length) { $('#rep').innerHTML = '<p class="empty">No situations match the current filters.</p>'; return; }

      function next() {
        i++;
        if (i >= order.length) {
          $('#rep').innerHTML = '<p class="verdict-line">Session done: ' + score.right + ' of ' + score.seen + '.</p>' +
            '<div class="row">' + (player ? '<a class="btn primary" href="#/players/' + player.id + '">See profile</a>' : '') + '<button class="btn ghost" type="button" id="again">Run it again</button></div>';
          $('#again').addEventListener('click', function () { order = shuffle(pool.slice()); i = -1; next(); });
          return;
        }
        var s = order[i];
        $('#rep').innerHTML =
          '<p class="eyebrow">' + h(s.source) + ' · ' + (i + 1) + ' of ' + order.length + '</p>' +
          '<p class="sit">' + h(s.description) + '</p>' +
          '<div class="choices">' + E.CALLS.map(function (c) { return '<button type="button" class="choice" data-id="' + c.id + '">' + h(c.name) + '</button>'; }).join('') + '</div>' +
          '<div id="result" class="stack" hidden></div>' +
          '<div class="row"><button class="btn primary" type="button" id="next">' + (i + 1 < order.length ? 'Next rep' : 'Finish') + '</button><a class="btn ghost" href="#/film/' + s.id + '">Open situation</a></div>';
        var answered = false;
        $('#rep .choices').addEventListener('click', function (e) {
          var b = e.target.closest('.choice'); if (!b || answered) return;
          answered = true;
          var guess = b.getAttribute('data-id');
          $$('#rep .choice').forEach(function (x) { x.disabled = true; });
          api('POST', '/api/attempts', { situation_id: s.id, player_id: pid || undefined, guess: guess }).then(function (r) {
            score.seen++; if (r.correct) { score.right++; score.streak++; } else score.streak = 0;
            $('#s-right').textContent = score.right; $('#s-seen').textContent = score.seen; $('#s-streak').textContent = score.streak;
            $$('#rep .choice').forEach(function (x) {
              var id = x.getAttribute('data-id');
              x.classList.add(id === r.answer ? 'is-right' : (id === guess ? 'is-wrong' : 'is-dim'));
            });
            var note = r.correct ? '' : (r.guessLegal.ok
              ? '<p class="flag"><b>' + h(callName(guess)) + ' was legal</b> but not the one call. ' + h(r.guessLegal.why) + '</p>'
              : '<p class="flag"><b>' + h(callName(guess)) + ' was illegal here.</b> ' + h(r.guessLegal.why) + '</p>');
            var res = $('#result');
            res.innerHTML = '<p class="verdict-line ' + (r.correct ? 'good' : 'bad') + '">' + (r.correct ? 'Right call.' : 'The call is ' + h(callName(r.answer)) + '.') + '</p>' + note +
              outputHTML(r.output, { hideAction: true, noLegal: true, label: 'Engine read' });
            res.hidden = false;
          }, function (err) {
            answered = false; $$('#rep .choice').forEach(function (x) { x.disabled = false; }); toast(err.message);
          });
        });
        $('#next').addEventListener('click', next);
      }
      next();
    });
  };

  views.situation = function (id) {
    return api('GET', '/api/situations/' + id).then(function (s) {
      app.innerHTML =
        '<a class="back" href="#/film">← Film room</a>' +
        '<div class="head-row"><div class="head"><p class="eyebrow">' + h(s.source) + '</p><h1>' + h(s.title) + '</h1></div>' +
        '<div class="row"><a class="btn ghost" href="#/film/' + s.id + '/edit">Edit</a><button class="btn danger" type="button" id="del">Delete</button></div></div>' +
        '<p class="sit">' + h(s.description) + '</p>' +
        '<div class="chips">' + s.positions.map(function (p) { return '<span class="tag">' + h(p) + '</span>'; }).join('') + '</div>' +
        '<div class="card">' + outputHTML(s.output) + '</div>' +
        '<div class="row"><button class="btn ghost" type="button" id="to-call">Open in Call</button></div>';
      $('#to-call').addEventListener('click', function () {
        try { sessionStorage.setItem('lab-call', JSON.stringify(s.inputs)); } catch (e) {}
        location.hash = '#/call';
      });
      armed($('#del'), 'Tap again to delete', function () {
        api('DELETE', '/api/situations/' + s.id).then(function () { toast('Situation deleted'); location.hash = '#/film'; }, function (err) { toast(err.message); });
      });
    });
  };

  views.situationForm = function (id) {
    var load = id ? api('GET', '/api/situations/' + id) : Promise.resolve({ title: '', description: '', positions: [], inputs: handoff.inputs || {} });
    handoff.inputs = null;
    return load.then(function (s) {
      app.innerHTML =
        '<a class="back" href="' + (id ? '#/film/' + id : '#/film') + '">← ' + (id ? 'Situation' : 'Film room') + '</a>' +
        '<div class="head"><p class="eyebrow">' + (id ? 'Edit situation' : 'New situation') + '</p><h1>' + (id ? h(s.title) : 'Describe the rep') + '</h1><p>Write it the way a player would see it, then set the read. The answer comes from the engine.</p></div>' +
        '<form class="form" id="sform" novalidate><div class="grid-2"><div class="stack">' +
        '<div class="field"><label class="flabel" for="sf-title">Title</label><input type="text" id="sf-title" maxlength="120" value="' + h(s.title) + '"></div>' +
        '<div class="field"><label class="flabel" for="sf-desc">What the player sees</label><textarea id="sf-desc" maxlength="2000" style="min-height:120px">' + h(s.description) + '</textarea></div>' +
        '<div class="field"><span class="flabel">Positions</span>' + positionChecks('sf-pos', s.positions) + '</div>' +
        '<div class="card" id="preview"></div>' +
        '<div class="row"><button class="btn primary" type="submit">Save situation</button></div></div>' +
        '<div class="stack" id="panel">' + panelHTML('s-', s.inputs) + '</div></div></form>';
      bindPanel($('#panel'), 's-', function (inp) { $('#preview').innerHTML = outputHTML(E.run(inp), { label: 'Answer preview', noLegal: true }); });
      $('#sform').addEventListener('submit', function (e) {
        e.preventDefault();
        var body = { title: $('#sf-title').value, description: $('#sf-desc').value, positions: readChecks($('#sform'), 'sf-pos'), inputs: readPanel($('#panel'), 's-') };
        api(id ? 'PUT' : 'POST', '/api/situations' + (id ? '/' + id : ''), body)
          .then(function (r) { toast('Situation saved'); location.hash = '#/film/' + r.id; }, function (err) { formError($('#sform'), err.message); });
      });
    });
  };

  /* ---------- drills ---------- */
  var drillCfg = { call: '', position: '' };

  views.drills = function () {
    return api('GET', '/api/drills').then(function (all) {
      app.innerHTML =
        '<div class="head-row"><div class="head"><p class="eyebrow">Practice</p><h1>Drills</h1><p>On-field drills, each keyed to the call it trains. The starter set is a template; edit it to fit your program.</p></div>' +
        '<a class="btn primary" href="#/drills/new">New drill</a></div>' +
        '<div class="chips" id="d-call"><button class="chip" type="button" data-v="">All calls</button>' + E.CALLS.map(function (c) { return '<button class="chip" type="button" data-v="' + c.id + '">' + h(c.name) + '</button>'; }).join('') + '</div>' +
        '<div class="chips" id="d-pos"><button class="chip" type="button" data-v="">All positions</button>' + E.POSITIONS.map(function (p) { return '<button class="chip" type="button" data-v="' + h(p) + '">' + h(p) + '</button>'; }).join('') + '</div>' +
        '<div class="list" id="drill-list"></div>';
      function paint() {
        $$('#d-call .chip').forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-v') === drillCfg.call ? 'true' : 'false'); });
        $$('#d-pos .chip').forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-v') === drillCfg.position ? 'true' : 'false'); });
        var list = all.filter(function (d) { return (!drillCfg.call || d.call === drillCfg.call) && (!drillCfg.position || d.positions.indexOf(drillCfg.position) >= 0); });
        $('#drill-list').innerHTML = list.length ? list.map(function (d) {
          return '<a class="li" href="#/drills/' + d.id + '"><span class="main-col"><span class="t">' + h(d.name) + '</span><span class="d">' + h(d.players) + ' · ' + h(d.positions.join(', ') || 'All positions') + '</span></span>' +
            '<span class="side">' + (d.call ? '<span class="tag call">' + h(callName(d.call)) + '</span>' : '<span class="tag">Whole pipeline</span>') + '<span>' + d.minutes + ' min</span></span></a>';
        }).join('') : '<p class="empty">No drills match. Clear a filter or add one.</p>';
      }
      $('#d-call').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (c) { drillCfg.call = c.getAttribute('data-v'); paint(); } });
      $('#d-pos').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (c) { drillCfg.position = c.getAttribute('data-v'); paint(); } });
      paint();
    });
  };

  views.drill = function (id) {
    return Promise.all([api('GET', '/api/drills/' + id), api('GET', '/api/plans')]).then(function (res) {
      var d = res[0], plans = res[1], c = E.BY[d.call];
      app.innerHTML =
        '<a class="back" href="#/drills">← Drills</a>' +
        '<div class="head-row"><div class="head"><p class="eyebrow">' + (c ? 'Trains ' + h(c.name) : 'Trains the whole pipeline') + '</p><h1>' + h(d.name) + '</h1></div>' +
        '<div class="row"><a class="btn ghost" href="#/drills/' + d.id + '/edit">Edit</a><button class="btn danger" type="button" id="del">Delete</button></div></div>' +
        '<div class="meta-row"><span>Time <b>' + d.minutes + ' min</b></span><span>Players <b>' + h(d.players || '—') + '</b></span><span>Positions <b>' + h(d.positions.join(', ') || 'All') + '</b></span></div>' +
        '<div class="grid-2"><div class="card drill-body">' +
        (d.setup ? '<div><h3>Setup</h3><p>' + h(d.setup) + '</p></div>' : '') +
        (d.steps ? '<div><h3>Run it</h3><p>' + h(d.steps) + '</p></div>' : '') +
        (d.points ? '<div><h3>Coaching points</h3><p>' + h(d.points) + '</p></div>' : '') +
        '</div><div class="stack">' +
        (c ? '<div class="card"><p class="section-title">The call</p><p class="act">' + h(c.name) + (c.seq ? '<span class="seq">' + h(c.seq) + '</span>' : '') + '</p><p class="small muted">' + h(c.text) + '</p><p class="meta-row"><span>State <b>' + h(c.state) + '</b></span><span>Rung <b>' + h(c.rung) + '</b></span></p></div>' : '') +
        '<div class="card"><p class="section-title">Add to a practice plan</p>' + (plans.length
          ? '<div class="form-grid"><div class="field"><label class="flabel" for="to-plan">Plan</label><select id="to-plan">' + plans.map(function (p) { return '<option value="' + p.id + '">' + h(p.title) + '</option>'; }).join('') + '</select></div></div><div class="row"><button class="btn primary" type="button" id="add-plan">Add ' + d.minutes + ' min</button></div>'
          : '<p class="small muted">No plans yet. <a href="#/plans/new">Build one</a>.</p>') + '</div>' +
        '</div></div>';
      armed($('#del'), 'Tap again to delete', function () {
        api('DELETE', '/api/drills/' + d.id).then(function () { toast('Drill deleted'); location.hash = '#/drills'; }, function (err) { toast(err.message); });
      });
      if (plans.length) $('#add-plan').addEventListener('click', function () {
        var pid = $('#to-plan').value;
        api('GET', '/api/plans/' + pid).then(function (p) {
          var items = p.items.map(function (i) { return { drill_id: i.drill_id, minutes: i.minutes }; }).concat([{ drill_id: d.id, minutes: d.minutes }]);
          return api('PUT', '/api/plans/' + pid, { title: p.title, date: p.date, notes: p.notes, items: items });
        }).then(function (p) { toast('Added to ' + p.title); }, function (err) { toast(err.message); });
      });
    });
  };

  views.drillForm = function (id) {
    var load = id ? api('GET', '/api/drills/' + id) : Promise.resolve({ name: '', call: '', positions: [], players: '', minutes: 10, setup: '', steps: '', points: '' });
    return load.then(function (d) {
      app.innerHTML =
        '<a class="back" href="' + (id ? '#/drills/' + id : '#/drills') + '">← ' + (id ? 'Drill' : 'Drills') + '</a>' +
        '<div class="head"><p class="eyebrow">' + (id ? 'Edit drill' : 'New drill') + '</p><h1>' + (id ? h(d.name) : 'Write a drill') + '</h1></div>' +
        '<form class="card form" id="dform" novalidate>' +
        '<div class="field"><label class="flabel" for="df-name">Name</label><input type="text" id="df-name" maxlength="120" value="' + h(d.name) + '"></div>' +
        '<div class="form-grid">' +
        '<div class="field"><label class="flabel" for="df-call">Call it trains</label><select id="df-call">' + callOptions(d.call, 'Whole pipeline') + '</select></div>' +
        '<div class="field"><label class="flabel" for="df-min">Minutes</label><input type="number" id="df-min" min="1" max="120" value="' + h(d.minutes) + '"></div>' +
        '<div class="field"><label class="flabel" for="df-players">Players</label><input type="text" id="df-players" maxlength="80" placeholder="1v1, 4v3 shell" value="' + h(d.players) + '"></div>' +
        '</div>' +
        '<div class="field"><span class="flabel">Positions</span>' + positionChecks('df-pos', d.positions) + '</div>' +
        '<div class="field"><label class="flabel" for="df-setup">Setup</label><textarea id="df-setup" maxlength="2000">' + h(d.setup) + '</textarea></div>' +
        '<div class="field"><label class="flabel" for="df-steps">Run it</label><textarea id="df-steps" maxlength="4000" style="min-height:110px">' + h(d.steps) + '</textarea></div>' +
        '<div class="field"><label class="flabel" for="df-points">Coaching points</label><textarea id="df-points" maxlength="2000">' + h(d.points) + '</textarea></div>' +
        '<div class="row"><button class="btn primary" type="submit">Save drill</button></div></form>';
      $('#dform').addEventListener('submit', function (e) {
        e.preventDefault();
        var body = { name: $('#df-name').value, call: $('#df-call').value, minutes: $('#df-min').value, players: $('#df-players').value, positions: readChecks($('#dform'), 'df-pos'), setup: $('#df-setup').value, steps: $('#df-steps').value, points: $('#df-points').value };
        api(id ? 'PUT' : 'POST', '/api/drills' + (id ? '/' + id : ''), body)
          .then(function (r) { toast('Drill saved'); location.hash = '#/drills/' + r.id; }, function (err) { formError($('#dform'), err.message); });
      });
    });
  };

  /* ---------- plans ---------- */
  function clock(min) { return Math.floor(min / 60) + ':' + ('0' + (min % 60)).slice(-2); }

  views.plans = function () {
    return api('GET', '/api/plans').then(function (list) {
      app.innerHTML =
        '<div class="head-row"><div class="head"><p class="eyebrow">Practice</p><h1>Practice plans</h1><p>Put drills in order with minutes. The plan shows the running clock.</p></div>' +
        '<a class="btn primary" href="#/plans/new">New plan</a></div>' +
        (list.length ? '<div class="list">' + list.map(function (p) {
          return '<a class="li" href="#/plans/' + p.id + '"><span class="main-col"><span class="t">' + h(p.title) + '</span><span class="d">' + h(fmtDate(p.date)) + '</span></span><span class="side"><span>' + p.total + ' min</span><span>' + p.drills + ' drill' + (p.drills === 1 ? '' : 's') + '</span></span></a>';
        }).join('') + '</div>' : '<div class="list"><p class="empty">No plans yet.</p></div>');
    });
  };

  views.plan = function (id) {
    return api('GET', '/api/plans/' + id).then(function (p) {
      var t = 0;
      app.innerHTML =
        '<a class="back" href="#/plans">← Plans</a>' +
        '<div class="head-row"><div class="head"><p class="eyebrow">' + h(fmtDate(p.date)) + ' · ' + p.total + ' min</p><h1>' + h(p.title) + '</h1></div>' +
        '<div class="row"><a class="btn ghost" href="#/plans/' + p.id + '/edit">Edit</a><button class="btn danger" type="button" id="del">Delete</button></div></div>' +
        (p.notes ? '<p class="muted">' + h(p.notes) + '</p>' : '') +
        (p.items.length ? '<div class="list timeline">' + p.items.map(function (i) {
          var start = t; t += i.minutes;
          return '<div class="tl"><span class="clock">' + clock(start) + '</span><span class="main-col"><a class="nm" href="#/drills/' + i.drill_id + '">' + h(i.name) + '</a>' + (i.call ? '<span><span class="tag call">' + h(callName(i.call)) + '</span></span>' : '') + '</span><span class="mins">' + i.minutes + ' min</span></div>';
        }).join('') + '<div class="tl"><span class="clock">' + clock(t) + '</span><span class="main-col"><span class="nm">End</span></span><span class="mins"></span></div></div>'
          : '<div class="list"><p class="empty">No drills in this plan. Edit it to add some.</p></div>');
      armed($('#del'), 'Tap again to delete', function () {
        api('DELETE', '/api/plans/' + p.id).then(function () { toast('Plan deleted'); location.hash = '#/plans'; }, function (err) { toast(err.message); });
      });
    });
  };

  views.planForm = function (id) {
    return Promise.all([id ? api('GET', '/api/plans/' + id) : Promise.resolve({ title: '', date: '', notes: '', items: [] }), api('GET', '/api/drills')]).then(function (res) {
      var p = res[0], drills = res[1];
      var byId = {}; drills.forEach(function (d) { byId[d.id] = d; });
      var items = p.items.map(function (i) { return { drill_id: i.drill_id, minutes: i.minutes }; });
      app.innerHTML =
        '<a class="back" href="' + (id ? '#/plans/' + id : '#/plans') + '">← ' + (id ? 'Plan' : 'Plans') + '</a>' +
        '<div class="head"><p class="eyebrow">' + (id ? 'Edit plan' : 'New plan') + '</p><h1>' + (id ? h(p.title) : 'Build a practice') + '</h1></div>' +
        '<form class="form" id="plform" novalidate><div class="grid-2"><div class="card form">' +
        '<div class="field"><label class="flabel" for="pl-title">Title</label><input type="text" id="pl-title" maxlength="120" value="' + h(p.title) + '"></div>' +
        '<div class="field"><label class="flabel" for="pl-date">Date</label><input type="date" id="pl-date" value="' + h(p.date || '') + '"></div>' +
        '<div class="field"><label class="flabel" for="pl-notes">Notes</label><textarea id="pl-notes" maxlength="2000">' + h(p.notes) + '</textarea></div>' +
        '<div class="row"><button class="btn primary" type="submit">Save plan</button></div></div>' +
        '<div class="stack"><div class="head-row"><p class="section-title" style="flex:1">Drills</p><span class="mono small" id="pl-total"></span></div>' +
        '<div class="list" id="pl-items"></div>' +
        '<div class="form-grid"><div class="field"><label class="flabel" for="pl-add">Add a drill</label><select id="pl-add">' + drills.map(function (d) { return '<option value="' + d.id + '">' + h(d.name) + ' (' + d.minutes + ' min)</option>'; }).join('') + '</select></div></div>' +
        '<div class="row"><button class="btn" type="button" id="pl-add-btn"' + (drills.length ? '' : ' disabled') + '>Add drill</button></div></div></div></form>';

      function paint() {
        $('#pl-items').innerHTML = items.length ? items.map(function (it, i) {
          var d = byId[it.drill_id];
          return '<div class="tl-edit"><span class="nm small"><b>' + h(d ? d.name : 'Deleted drill') + '</b></span>' +
            '<input type="number" min="1" max="120" value="' + it.minutes + '" data-min="' + i + '" aria-label="Minutes for ' + h(d ? d.name : 'drill') + '">' +
            '<span class="ctl"><button class="btn sm ghost" type="button" data-up="' + i + '" aria-label="Move up"' + (i ? '' : ' disabled') + '>↑</button><button class="btn sm ghost" type="button" data-down="' + i + '" aria-label="Move down"' + (i < items.length - 1 ? '' : ' disabled') + '>↓</button><button class="btn sm ghost" type="button" data-rm="' + i + '" aria-label="Remove">✕</button></span></div>';
        }).join('') : '<p class="empty">No drills yet. Add one below.</p>';
        total();
      }
      function total() {
        var t = items.reduce(function (a, it) { return a + (+it.minutes || 0); }, 0);
        $('#pl-total').textContent = t + ' min total';
      }
      $('#pl-items').addEventListener('input', function (e) {
        var i = e.target.getAttribute('data-min'); if (i === null) return;
        items[+i].minutes = parseInt(e.target.value, 10) || 0; total();
      });
      $('#pl-items').addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var up = b.getAttribute('data-up'), down = b.getAttribute('data-down'), rm = b.getAttribute('data-rm'), t;
        if (up !== null) { up = +up; t = items[up - 1]; items[up - 1] = items[up]; items[up] = t; }
        else if (down !== null) { down = +down; t = items[down + 1]; items[down + 1] = items[down]; items[down] = t; }
        else if (rm !== null) items.splice(+rm, 1);
        paint();
      });
      $('#pl-add-btn').addEventListener('click', function () {
        var d = byId[$('#pl-add').value]; if (!d) return;
        items.push({ drill_id: d.id, minutes: d.minutes }); paint();
      });
      $('#plform').addEventListener('submit', function (e) {
        e.preventDefault();
        var body = { title: $('#pl-title').value, date: $('#pl-date').value || null, notes: $('#pl-notes').value, items: items };
        api(id ? 'PUT' : 'POST', '/api/plans' + (id ? '/' + id : ''), body)
          .then(function (r) { toast('Plan saved'); location.hash = '#/plans/' + r.id; }, function (err) { formError($('#plform'), err.message); });
      });
      paint();
    });
  };

  /* ================= router ================= */
  var ROUTES = [
    [/^\/?$/, 'home', 'home'],
    [/^\/call$/, 'call', 'call'],
    [/^\/players$/, 'players', 'players'],
    [/^\/players\/(\d+)$/, 'player', 'players'],
    [/^\/film$/, 'film', 'film'],
    [/^\/film\/new$/, 'situationForm', 'film'],
    [/^\/film\/session\/(\d+)$/, 'filmSession', 'film'],
    [/^\/film\/(\d+)$/, 'situation', 'film'],
    [/^\/film\/(\d+)\/edit$/, 'situationForm', 'film'],
    [/^\/drills$/, 'drills', 'drills'],
    [/^\/drills\/new$/, 'drillForm', 'drills'],
    [/^\/drills\/(\d+)$/, 'drill', 'drills'],
    [/^\/drills\/(\d+)\/edit$/, 'drillForm', 'drills'],
    [/^\/plans$/, 'plans', 'plans'],
    [/^\/plans\/new$/, 'planForm', 'plans'],
    [/^\/plans\/(\d+)$/, 'plan', 'plans'],
    [/^\/plans\/(\d+)\/edit$/, 'planForm', 'plans']
  ];

  function route() {
    var path = (location.hash || '#/').slice(1);
    var hit = null, m;
    for (var i = 0; i < ROUTES.length; i++) { m = ROUTES[i][0].exec(path); if (m) { hit = ROUTES[i]; break; } }
    if (!hit) { location.hash = '#/'; return; }
    $$('.nav a').forEach(function (a) { if (a.getAttribute('data-nav') === hit[2]) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    app.innerHTML = '<p class="muted small">Loading…</p>';
    window.scrollTo(0, 0);
    Promise.resolve(views[hit[1]](m[1])).catch(function (err) {
      app.innerHTML = '<div class="head"><p class="eyebrow">' + (err.status === 404 ? 'Not found' : 'Error') + '</p><h1>' + h(err.status === 404 ? 'That page doesn’t exist' : 'Couldn’t load this page') + '</h1><p>' + h(err.message) + '</p></div><div class="row"><a class="btn" href="#/">Go home</a></div>';
    });
  }

  /* ================= coach key ================= */
  function askKey() {
    if ($('#key-form')) return;
    var wrap = document.createElement('form');
    wrap.id = 'key-form'; wrap.className = 'card form';
    wrap.innerHTML = '<p class="section-title">Coach key</p><p class="small muted">Changes are locked on this server. Enter the coach key to add, edit or delete. It’s saved on this device only.</p>' +
      '<div class="field"><label class="flabel" for="key-in">Key</label><input type="password" id="key-in" autocomplete="current-password" value="' + h(store(KEY_STORE) || '') + '"></div>' +
      '<div class="row"><button class="btn primary" type="submit">Save key</button><button class="btn ghost" type="button" id="key-clear">Forget key</button><button class="btn ghost" type="button" id="key-close">Close</button></div>';
    app.insertBefore(wrap, app.firstChild);
    $('#key-in').focus();
    wrap.addEventListener('submit', function (e) { e.preventDefault(); store(KEY_STORE, $('#key-in').value.trim() || null); wrap.remove(); toast('Coach key saved. Try again.'); });
    $('#key-clear').addEventListener('click', function () { store(KEY_STORE, null); wrap.remove(); toast('Coach key forgotten'); });
    $('#key-close').addEventListener('click', function () { wrap.remove(); });
  }
  $('#key-btn').addEventListener('click', askKey);

  window.addEventListener('hashchange', route);
  api('GET', '/api/meta').then(function (m) { META = m; $('#key-btn').hidden = !m.auth; }, function () {}).then(route);
})();
