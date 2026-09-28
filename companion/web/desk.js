/* Events desk: live events (hosting, courts, formats, check-in), public
   sign-up / spectator / player pages, Pending Interest and Team Planner.
   Plugs into app.js through window.LabPlugins. */
(function () {
  'use strict';
  window.LabPlugins = window.LabPlugins || [];
  window.LabPlugins.push(function (C) {
    var L = window.Lab, h = L.h, $ = L.$, $$ = L.$$, api = L.api, Store = L.Store, views = C.views, app = $('#app');
    var head = C.head, has = C.has;
    function ME() { return C.me(); }
    function META() { return C.meta() || {}; }

    var MODE_HELP = {
      rotate: 'Partners rotate every round. Whoever has played least goes first; repeat partners and opponents are avoided.',
      race: 'Partners rotate and points add up. The first player to reach the target wins.',
      premapped: 'Every round is planned before play starts. Rounds still to come are rebuilt if people arrive late or leave.',
      unlucky: 'Partners rotate, and each team starts every game on 0, 3 or 6 points, drawn at random.',
      rivalry: 'Partners rotate, but you keep meeting the same opponents.',
      fixed: 'Set doubles teams play a rolling round robin. Add a knockout bracket at the end if you like.',
      draft3: 'Teams of three. Each matchup is three doubles games, so everyone partners both teammates once.',
      fallout: 'Set doubles teams in a knockout bracket, single or double elimination (up to 8 teams for double).'
    };
    var MODES = { rotate: 'Round Robin', race: 'Race to ( )', premapped: 'Pre-Mapped Doubles', unlucky: 'Unlucky', rivalry: 'Rivalry', fixed: 'Fixed Partners', draft3: '3v3 Team Draft', fallout: 'Fallout' };
    var ROUND_END = { all: 'Every court finishes', timer: 'Timer ends', first: 'First court finishes, all courts stop' };
    var TEAM_MODES = ['fixed', 'fallout', 'draft3'];
    var INTEREST_KINDS = { training: 'Training group', event: 'Event', league: 'League', clinic: 'Clinic', open_play: 'Open play' };

    /* ---------- small helpers ---------- */
    function local(iso) { if (!iso) return ''; var d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
    function fromLocal(v) { return v ? new Date(v).toISOString() : ''; }
    function fmtWhen(iso) { return iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Date to be set'; }
    function fmtTimeOnly(iso) { return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
    function abs(hashLink) { return location.origin + '/' + hashLink; }
    function first(name) { return String(name || '').split(' ')[0]; }
    function download(name, text, type) {
      var blob = new Blob([text], { type: type || 'text/plain' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
    function csv(rows) { return rows.map(function (r) { return r.map(function (c) { c = c == null ? '' : String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n'); }
    function slug(s) { return String(s || 'lab').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'lab'; }
    function ics(ev) {
      var stamp = function (iso) { return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
      var esc = function (s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, '\\$&'); };
      var end = ev.ends_at || new Date(new Date(ev.starts_at).getTime() + 2 * 3600e3).toISOString();
      return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//THE LAB//Events//EN', 'BEGIN:VEVENT', 'UID:' + ev.uid + '@thelab', 'DTSTAMP:' + stamp(new Date().toISOString()),
        'DTSTART:' + stamp(ev.starts_at), 'DTEND:' + stamp(end), 'SUMMARY:' + esc(ev.title), ev.location ? 'LOCATION:' + esc(ev.location) : '', ev.description ? 'DESCRIPTION:' + esc(ev.description) : '',
        'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
    }
    function calendarButton(id) { return '<button class="btn ghost" type="button" id="' + (id || 'cal') + '">Add to calendar</button>'; }
    function bindCalendar(ev, id) { var b = $('#' + (id || 'cal')); if (b) b.addEventListener('click', function () { download(slug(ev.title) + '.ics', ics(ev), 'text/calendar'); }); }
    function qrSVG(text, label) { return window.LabQR ? '<div class="qr">' + window.LabQR.svg(text, { label: label }) + '</div>' : ''; }
    /* A link someone else will open: copy, text, email, QR. */
    function shareBox(id, title, hashLink, note, subject) {
      var url = abs(hashLink);
      return '<div class="card stack share" id="' + id + '"><p class="section-title">' + h(title) + '</p>' + (note ? '<p class="small muted">' + h(note) + '</p>' : '') +
        '<input type="text" readonly value="' + h(url) + '" aria-label="' + h(title) + '" class="mono small">' +
        '<div class="row"><button class="btn sm primary" type="button" data-copy="' + h(url) + '">Copy link</button>' +
        '<a class="btn sm ghost" href="sms:?&body=' + encodeURIComponent((subject ? subject + ' ' : '') + url) + '">Text</a>' +
        '<a class="btn sm ghost" href="mailto:?subject=' + encodeURIComponent(subject || title) + '&body=' + encodeURIComponent(url) + '">Email</a>' +
        '<button class="btn sm ghost" type="button" data-qr="' + id + '">QR code</button></div><div class="qr-slot" hidden>' + qrSVG(url, 'QR code for ' + title) + '</div></div>';
    }
    function bindShare(root) {
      $$('[data-copy]', root).forEach(function (b) { b.addEventListener('click', function () { L.copy(b.getAttribute('data-copy')); }); });
      $$('[data-qr]', root).forEach(function (b) { b.addEventListener('click', function () { var s = $('.qr-slot', $('#' + b.getAttribute('data-qr'))); s.hidden = !s.hidden; }); });
      $$('input[readonly]', root).forEach(function (i) { i.addEventListener('focus', function () { i.select(); }); });
    }
    function segButtons(key, map, sel) { return '<div class="seg-btns" data-k="' + key + '">' + Object.keys(map).map(function (k) { return '<button type="button" data-v="' + k + '" aria-pressed="' + (k === sel) + '">' + h(map[k]) + '</button>'; }).join('') + '</div>'; }
    function bindSeg(root, fn) {
      $$('.seg-btns[data-k] button', root).forEach(function (b) { b.addEventListener('click', function () {
        $$('button', b.parentNode).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        if (fn) fn(b.parentNode.getAttribute('data-k'), b.getAttribute('data-v'));
      }); });
    }
    function segValue(root, key) { var b = $('.seg-btns[data-k="' + key + '"] [aria-pressed="true"]', root); return b ? b.getAttribute('data-v') : null; }

    /* A short tone when your court changes, if you turned it on. */
    var audio = null;
    function chime() {
      if (!Store.get('chime', false)) return;
      try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        [0, 0.18].forEach(function (t, i) {
          var o = audio.createOscillator(), g = audio.createGain();
          o.frequency.value = i ? 988 : 784; o.connect(g); g.connect(audio.destination);
          g.gain.setValueAtTime(0.0001, audio.currentTime + t); g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.16);
          o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.18);
        });
      } catch (e) {}
      try { navigator.vibrate && navigator.vibrate([60, 40, 60]); } catch (e) {}
    }
    function chimeToggle() {
      return '<label class="tog" for="chime"><input type="checkbox" id="chime"' + (Store.get('chime', false) ? ' checked' : '') + '><div><b>Sound on court changes</b><span>Plays a tone while this page is open. Keep your phone unmuted.</span></div></label>';
    }
    function bindChime() { var c = $('#chime'); if (c) c.addEventListener('change', function () { Store.set('chime', c.checked); if (c.checked) chime(); }); }

    /* Keep a live screen fresh without jumping: re-render only when the data
       changed, keep the scroll position, and pause while someone is typing. */
    var poll = null;
    function livePoll(hash, ms, fetchFn, onData) {
      if (poll) clearInterval(poll);
      var last = null;
      poll = setInterval(function () {
        if (location.hash !== hash) { clearInterval(poll); poll = null; return; }
        if (document.visibilityState !== 'visible' || !L.isOnline()) return;
        var ae = document.activeElement;
        if (ae && ae.matches && ae.matches('input, textarea, select') || $('#scanbox video') || $('#preview .card')) return;
        fetchFn().then(function (d) {
          var sig = JSON.stringify(d);
          if (last === null) { last = sig; return; }
          if (sig === last) return;
          last = sig;
          var y = window.scrollY;
          onData(d);
          window.scrollTo(0, y);
        }, function () {});
      }, ms);
    }
    function timerHTML(rd) {
      if (!rd || rd.status !== 'live') return '';
      if (rd.stopped) return '<p class="timer over">Play stopped. Enter scores as they stand.</p>';
      if (!rd.ends_at) return '';
      return '<p class="timer" data-ends="' + h(rd.ends_at) + '" role="timer" aria-live="off"></p>';
    }
    var tick = null;
    function runTimers() {
      if (tick) clearInterval(tick);
      var paint = function () {
        var els = $$('.timer[data-ends]');
        if (!els.length) { clearInterval(tick); tick = null; return; }
        els.forEach(function (el) {
          var left = Math.round((new Date(el.getAttribute('data-ends')) - Date.now()) / 1000);
          el.classList.toggle('over', left <= 0);
          el.textContent = left > 0 ? 'Time left ' + Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2) : 'Time’s up. Enter scores as they stand.';
        });
      };
      paint(); tick = setInterval(paint, 1000);
    }

    /* ---------- shared event rendering ---------- */
    function myAssignment(e, aid) {
      if (!aid || !e.rounds.length) return null;
      var rd = e.rounds[e.rounds.length - 1];
      var ms = rd.matches.filter(function (m) { return m.players.some(function (p) { return p.athlete_id === aid; }); });
      if (ms.length) {
        var m = ms.filter(function (x) { return x.status === 'scheduled'; })[0] || ms[0];
        var me = m.players.filter(function (p) { return p.athlete_id === aid; })[0];
        return { round: rd, match: m, matches: ms, me: me, partner: m.players.filter(function (p) { return p.team === me.team && p.athlete_id !== aid; }), opp: m.players.filter(function (p) { return p.team !== me.team; }) };
      }
      if (rd.sitting_out.some(function (p) { return p.athlete_id === aid; })) return { round: rd, resting: true };
      return null;
    }
    function assignmentCard(e, aid, ackId) {
      var a = myAssignment(e, aid);
      if (!a) return e.status === 'live' || e.status === 'published' ? '<div class="focus-card"><p class="eyebrow">' + (e.rounds.length ? 'Round ' + e.rounds.length : 'Waiting') + '</p><p class="big">' + (e.rounds.length ? 'You’re not in this round.' : 'Courts appear here when the host starts round 1.') + '</p></div>' : '';
      if (a.resting) return '<div class="focus-card"><p class="eyebrow">Round ' + a.round.number + '</p><p class="big">You’re resting this round. You’re up next.</p></div>';
      var m = a.match, start = m.start1 || m.start2 ? [m.start1, m.start2] : null, mine = a.me.team;
      var acked = m.acks.indexOf(aid) >= 0;
      return '<div class="focus-card assign"><p class="eyebrow">Round ' + a.round.number + (m.note ? ' · ' + h(m.note) : '') + ' · you’re on</p>' +
        '<p class="big">Court ' + m.court + ' · ' + (a.me.side === 'left' ? 'Left' : 'Right') + ' side</p>' +
        '<p class="small" style="opacity:.85">' + (a.partner.length ? 'With ' + h(a.partner.map(function (p) { return p.name; }).join(' & ')) + ' ' : '') + 'vs ' + h(a.opp.map(function (p) { return p.name; }).join(' & ')) + '</p>' +
        (start ? '<p class="small" style="opacity:.85">Your team starts on ' + start[mine - 1] + ', they start on ' + start[2 - mine] + '.</p>' : '') +
        (a.matches.length > 1 ? '<p class="small" style="opacity:.85">' + a.matches.length + ' games on this court this round.</p>' : '') +
        (m.status === 'scheduled' ? (acked ? '<p class="small ack-ok">✓ Got it</p>' : '<div class="row"><button class="btn sm light" type="button" id="' + (ackId || 'ack') + '" data-m="' + h(m.id) + '">Got it, heading there</button></div>') : '<p class="small">Score in: ' + h(m.games.map(function (g) { return g[mine - 1] + '–' + g[2 - mine]; }).join(', ')) + ' (your team first)</p>') + '</div>';
    }
    function numberOf(e, aid) { var p = (e.people || []).filter(function (x) { return x.athlete_id === aid; })[0]; return p && p.number ? '#' + p.number + ' ' : ''; }
    function courtCard(e, m, o) {
      var mine = o.mine && m.players.some(function (p) { return p.athlete_id === o.mine; });
      var start = m.start1 || m.start2;
      var inner = '<p class="eyebrow">Court ' + m.court + (m.note ? ' · ' + h(m.note) : '') + (start ? ' · starts ' + m.start1 + '–' + m.start2 : '') + '</p>' +
        [1, 2].map(function (t) {
          return '<p class="tm' + (m.winner === t ? ' w' : '') + '">' + m.players.filter(function (p) { return p.team === t; }).map(function (p) {
            return '<span>' + (o.org ? '<b class="ackmark" title="' + (m.acks.indexOf(p.athlete_id) >= 0 ? 'Acknowledged' : 'Not acknowledged yet') + '">' + (m.acks.indexOf(p.athlete_id) >= 0 ? '✓' : '·') + '</b> ' : '') + h(numberOf(e, p.athlete_id)) + h(p.name) + ' <i>' + (p.side === 'left' ? 'L' : 'R') + '</i></span>';
          }).join('') + '</p>';
        }).join('<p class="vs">vs</p>') +
        '<p class="sc">' + (m.status === 'scheduled' ? '<span class="check">○ Score needed</span>' : '<span class="check done">✓ ' + h(C.scoreLine(m)) + '</span> ' + C.statusPill(m)) + '</p>';
      var act = o.org && (m.status === 'recorded' || m.status === 'disputed') ? '<button class="btn sm" type="button" data-verify="' + h(m.id) + '">Confirm</button>' : '';
      return o.link ? '<div class="court-wrap' + (mine ? ' mine' : '') + '"><a class="court-card' + (mine ? ' mine' : '') + '" href="#/play/match/' + h(m.id) + '">' + inner + '</a>' + act + '</div>' : '<div class="court-card' + (mine ? ' mine' : '') + '">' + inner + '</div>';
    }
    function courtsHTML(e, o) {
      if (!e.rounds.length) return '<div class="list"><p class="empty">No rounds yet.' + (o.org ? ' Check players in, then preview round 1.' : ' Courts appear here when the host starts round 1.') + '</p></div>';
      return e.rounds.slice().reverse().map(function (rd, i) {
        var scored = rd.matches.filter(function (m) { return m.status !== 'scheduled'; }).length;
        return '<div class="stack"><p class="section-title">Round ' + rd.number + ' · ' + scored + ' of ' + rd.matches.length + ' scored' + (rd.status === 'done' ? ' · done' : rd.stopped ? ' · <span class="tag call">Stopped</span>' : '') + '</p>' +
          (i === 0 ? timerHTML(rd) : '') +
          '<div class="courts">' + rd.matches.map(function (m) { return courtCard(e, m, o); }).join('') + '</div>' +
          (rd.sitting_out.length ? '<p class="small muted">Resting: ' + rd.sitting_out.map(function (p) { return h(numberOf(e, p.athlete_id) + p.name); }).join(', ') + '</p>' : '') + '</div>';
      }).join('');
    }
    function standingsHTML(e, mine) {
      if (TEAM_MODES.indexOf(e.mode) >= 0 && e.team_standings.length) {
        var mt = e.teams.filter(function (t) { return [t.p1, t.p2, t.p3].indexOf(mine) >= 0; })[0];
        return '<div class="table-wrap card" style="padding:0" tabindex="0" role="region" aria-label="Table, scrolls sideways"><table class="summary-table"><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th>' + (e.mode === 'draft3' ? '<th>Games</th>' : '') + '<th>+/−</th></tr></thead><tbody>' +
          e.team_standings.map(function (s, i) { return '<tr' + (mt && s.team_id === mt.id ? ' class="me"' : '') + '><td class="n">' + (i + 1) + '</td><td>' + h(s.label) + '</td><td class="n">' + s.wins + '</td><td class="n">' + s.losses + '</td>' + (e.mode === 'draft3' ? '<td class="n">' + s.games_won + '</td>' : '') + '<td class="n">' + (s.diff > 0 ? '+' : '') + s.diff + '</td></tr>'; }).join('') + '</tbody></table></div>';
      }
      if (!e.standings.length) return '<div class="list"><p class="empty">Standings appear after the first scores.</p></div>';
      var draws = e.standings.some(function (s) { return s.draws; });
      var race = e.race;
      return (race ? '<div class="card stack-sm"><p class="small"><b>' + (race.finished ? h(race.leader.name) + ' wins' : 'First to ' + race.target) + '</b>' + (race.leader && !race.finished ? ' · ' + h(race.leader.name) + ' leads with ' + race.leader.points : '') + '</p><div class="progress" role="progressbar" aria-label="Race leader progress" aria-valuemin="0" aria-valuemax="' + race.target + '" aria-valuenow="' + (race.leader ? race.leader.points : 0) + '"><i style="width:' + Math.min(100, Math.round((race.leader ? race.leader.points : 0) / race.target * 100)) + '%"></i></div></div>' : '') +
        '<div class="table-wrap card" style="padding:0" tabindex="0" role="region" aria-label="Table, scrolls sideways"><table class="summary-table"><thead><tr><th>#</th><th>Player</th>' + (race ? '<th>Points</th>' : '') + '<th>W</th><th>L</th>' + (draws ? '<th>D</th>' : '') + '<th>+/−</th></tr></thead><tbody>' +
        e.standings.map(function (s, i) { return '<tr' + (s.athlete_id === mine ? ' class="me"' : '') + '><td class="n">' + (i + 1) + '</td><td>' + h(numberOf(e, s.athlete_id) + s.name) + '</td>' + (race ? '<td class="n"><b>' + s.points_for + '</b></td>' : '') + '<td class="n">' + s.wins + '</td><td class="n">' + s.losses + '</td>' + (draws ? '<td class="n">' + s.draws + '</td>' : '') + '<td class="n">' + (s.diff > 0 ? '+' : '') + s.diff + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    function bracketHTML(e, linkMatches) {
      var b = e.bracket;
      if (!b) return '<div class="list"><p class="empty">No bracket yet.</p></div>';
      var col = function (rd) {
        return '<div class="bcol"><p class="section-title">' + h(rd.name) + '</p>' + rd.slots.map(function (x) {
          if (x.not_needed) return '<div class="bslot"><p class="bt tbd">Not needed: the unbeaten team won</p></div>';
          var line = function (tm, isA) {
            if (!tm) return '<p class="bt tbd">' + (x.bye ? 'Bye' : 'TBD') + '</p>';
            var won = x.winner_team && x.winner_team === tm.id;
            var sc = x.match && x.match.games.length && x.match.status !== 'scheduled' ? x.match.games.map(function (g) { return isA ? g[0] : g[1]; }).join(' ') : '';
            return '<p class="bt' + (won ? ' won' : '') + '"><span>' + h(tm.label) + '</span><b>' + sc + '</b></p>';
          };
          var inner = line(x.team_a, true) + line(x.team_b, false);
          return x.match && linkMatches ? '<a class="bslot" href="#/play/match/' + h(x.match.id) + '">' + inner + '</a>' : '<div class="bslot">' + inner + '</div>';
        }).join('') + '</div>';
      };
      var section = function (title, rounds) { return rounds && rounds.length ? (title ? '<p class="section-title">' + title + '</p>' : '') + '<div class="bracket" tabindex="0" role="region" aria-label="' + h(title || 'Bracket') + ', scrolls sideways">' + rounds.map(col).join('') + '</div>' : ''; };
      return (b.champion ? '<div class="focus-card"><p class="eyebrow">Champions</p><p class="big">' + h(b.champion) + '</p></div>' : '') +
        (b.elimination === 'double' ? section('Winners side', b.rounds) + section('Losers side', b.losers) + section('Grand final', b.finals) : section('', b.rounds));
    }
    function formatLine(e) {
      var bits = [e.mode_label || MODES[e.mode], e.scoring === 'rally' ? 'rally scoring to ' + e.game_to : 'games to ' + e.game_to, e.courts + ' court' + (e.courts === 1 ? '' : 's')];
      if (e.mode === 'race') bits.push('first to ' + e.race_target + ' points');
      if (e.mode === 'fallout') bits.push(e.elimination === 'double' ? 'double elimination' : 'single elimination');
      if (e.mode !== 'fallout') { if (e.round_end !== 'all') bits.push(ROUND_END[e.round_end].toLowerCase()); if (e.round_minutes) bits.push(e.round_minutes + '-minute rounds'); if (e.round_limit) bits.push(e.round_limit + ' rounds'); }
      return bits.join(' · ');
    }
    function csvFor(e, which) {
      if (which === 'standings') {
        if (TEAM_MODES.indexOf(e.mode) >= 0 && e.team_standings.length) return csv([['Rank', 'Team', 'Wins', 'Losses', 'Games won', 'Point diff']].concat(e.team_standings.map(function (s, i) { return [i + 1, s.label, s.wins, s.losses, s.games_won, s.diff]; })));
        return csv([['Rank', 'Player', 'Played', 'Wins', 'Losses', 'Draws', 'Points for', 'Points against', 'Diff']].concat(e.standings.map(function (s, i) { return [i + 1, s.name, s.played, s.wins, s.losses, s.draws, s.points_for, s.points_against, s.diff]; })));
      }
      if (which === 'matches') {
        var rows = [['Round', 'Court', 'Team 1', 'Team 2', 'Score', 'Status']];
        e.rounds.forEach(function (rd) { rd.matches.forEach(function (m) { rows.push([rd.number, m.court, m.players.filter(function (p) { return p.team === 1; }).map(function (p) { return p.name; }).join(' & '), m.players.filter(function (p) { return p.team === 2; }).map(function (p) { return p.name; }).join(' & '), m.games.map(function (g) { return g.join('-'); }).join(' '), m.status_label]); }); });
        if (e.bracket) ['rounds', 'losers', 'finals'].forEach(function (k) { (e.bracket[k] || []).forEach(function (rd) { rd.slots.forEach(function (x) { if (x.match) rows.push([rd.name, x.match.court || '', x.team_a ? x.team_a.label : '', x.team_b ? x.team_b.label : '', x.match.games.map(function (g) { return g.join('-'); }).join(' '), x.match.status]); }); }); });
        return csv(rows);
      }
      return csv([['Number', 'Name', 'Status', 'Checked in', 'Email', 'Phone', 'Player link']].concat(e.people.map(function (p) { return [p.number, p.name, p.state, p.checked_in ? 'yes' : 'no', p.email || '', p.phone || '', p.link ? abs(p.link) : '']; })));
    }
    function bindCsv(e) { $$('[data-csv]').forEach(function (b) { b.addEventListener('click', function () { download(slug(e.title) + '-' + b.getAttribute('data-csv') + '.csv', csvFor(e, b.getAttribute('data-csv')), 'text/csv'); }); }); }
    function verifyButtons() {
      $$('[data-verify]').forEach(function (b) { b.addEventListener('click', function () { api.request('POST', '/api/matches/' + b.getAttribute('data-verify') + '/verify', {}).then(function () { L.toast('Score confirmed'); C.route(); }, function (err) { L.toast(err.message); }); }); });
    }

    /* ================= events list and form ================= */
    views.events = function () {
      return api.get('/api/events').then(function (list) {
        var up = list.filter(function (e) { return e.status !== 'complete' && e.status !== 'cancelled'; });
        var past = list.filter(function (e) { return e.status === 'complete' || e.status === 'cancelled'; });
        app.innerHTML = '<a class="back" href="#/play">← Play</a>' + C.offlineNote(list) + head('Play', 'Events', '', has('coach') ? '<div class="row"><a class="btn ghost" href="#/coach/desk">Events desk</a><a class="btn primary" href="#/play/events/new">New event</a></div>' : '') +
          '<div class="stack"><p class="section-title">Upcoming and live</p>' + (up.length ? '<div class="list">' + up.map(C.eventRow).join('') + '</div>' : '<div class="list"><p class="empty">No upcoming events.</p></div>') + '</div>' +
          (past.length ? '<div class="stack"><p class="section-title">Past</p><div class="list">' + past.map(C.eventRow).join('') + '</div></div>' : '');
      });
    };

    views.eventForm = function (id) {
      if (!has('coach')) return C.forbidden('Only coaches and organizers can create events.');
      return (id ? api.get('/api/events/' + id) : Promise.resolve({ title: '', description: '', location: '', starts_at: new Date(Date.now() + 864e5).toISOString(), courts: 2, capacity: null, format: 'round_robin', mode: 'rotate', scoring: 'traditional', game_to: 11, round_end: 'all', round_minutes: null, round_limit: null, race_target: 50, elimination: 'single', registration_open: true, show_roster: true, status: 'published' })).then(function (e) {
        var locked = id && (e.rounds.length || e.bracket);
        app.innerHTML = '<a class="back" href="' + (id ? '#/play/events/' + id : '#/play/events') + '">← ' + (id ? 'Event' : 'Events') + '</a>' + head('Organizer', id ? 'Edit event' : 'New event') +
          '<form class="card form" id="ef" novalidate>' +
          '<div class="field"><label class="flabel" for="t">Title</label><input type="text" id="t" maxlength="120" value="' + h(e.title) + '" placeholder="Thursday Mixer"></div>' +
          '<div class="form-grid"><div class="field"><label class="flabel" for="st">Starts</label><input type="datetime-local" id="st" value="' + local(e.starts_at) + '"></div>' +
          '<div class="field"><label class="flabel" for="en">Ends <span class="hint">optional</span></label><input type="datetime-local" id="en" value="' + local(e.ends_at) + '"></div>' +
          '<div class="field"><label class="flabel" for="loc">Location</label><input type="text" id="loc" maxlength="200" value="' + h(e.location) + '"></div></div>' +
          '<div class="field"><label class="flabel" for="mode">Format</label><select id="mode"' + (locked ? ' disabled' : '') + '>' + Object.keys(MODES).map(function (k) { return '<option value="' + k + '"' + (e.mode === k ? ' selected' : '') + '>' + MODES[k] + '</option>'; }).join('') + '</select><p class="small muted" id="modehelp"></p>' + (locked ? '<p class="small muted">The format is locked once play has started.</p>' : '') + '</div>' +
          '<div class="form-grid"><div class="field"><label class="flabel" for="courts">Courts</label><input type="number" id="courts" min="1" max="40" value="' + e.courts + '"></div>' +
          '<div class="field"><label class="flabel" for="cap">Player capacity</label><input type="number" id="cap" min="2" max="500" value="' + (e.capacity || '') + '" placeholder="No limit"></div>' +
          '<div class="field"><label class="flabel" for="scoring">Scoring</label><select id="scoring"><option value="traditional"' + (e.scoring !== 'rally' ? ' selected' : '') + '>Traditional</option><option value="rally"' + (e.scoring === 'rally' ? ' selected' : '') + '>Rally scoring</option></select></div>' +
          '<div class="field"><label class="flabel" for="gto">Games to</label><input type="number" id="gto" min="5" max="30" value="' + e.game_to + '"></div></div>' +
          '<div class="form-grid" id="roundopts"><div class="field"><label class="flabel" for="rend">Round ends when</label><select id="rend">' + Object.keys(ROUND_END).map(function (k) { return '<option value="' + k + '"' + (e.round_end === k ? ' selected' : '') + '>' + ROUND_END[k] + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label class="flabel" for="rmin">Round length (minutes)</label><input type="number" id="rmin" min="1" max="60" value="' + (e.round_minutes || '') + '" placeholder="No timer"></div>' +
          '<div class="field"><label class="flabel" for="rlim">Round limit</label><input type="number" id="rlim" min="2" max="24" value="' + (e.round_limit || '') + '" placeholder="No limit"></div></div>' +
          '<div class="field" id="racef"><label class="flabel" for="race">Race target (points)</label><input type="number" id="race" min="11" max="200" value="' + (e.race_target || 50) + '"></div>' +
          '<div class="field" id="elimf"><label class="flabel" for="elim">Elimination</label><select id="elim"><option value="single"' + (e.elimination !== 'double' ? ' selected' : '') + '>Single elimination</option><option value="double"' + (e.elimination === 'double' ? ' selected' : '') + '>Double elimination (up to 8 teams)</option></select></div>' +
          '<div class="field"><label class="flabel" for="desc">Details</label><textarea id="desc" maxlength="4000" placeholder="What to bring, prices, parking. Prices here are information only; this doesn’t take payment.">' + h(e.description) + '</textarea></div>' +
          '<div class="toggles"><label class="tog" for="ropen"><input type="checkbox" id="ropen"' + (e.registration_open ? ' checked' : '') + '><div><b>Registration open</b><span>Players can sign up with the event link.</span></div></label>' +
          '<label class="tog" for="roster"><input type="checkbox" id="roster"' + (e.show_roster ? ' checked' : '') + '><div><b>Show who’s coming</b><span>Players see the names of everyone registered.</span></div></label></div>' +
          '<div class="field"><label class="flabel" for="status">Visibility</label><select id="status">' + [['draft', 'Draft (only you)'], ['published', 'Published (open for sign-ups)'], ['live', 'Live'], ['complete', 'Complete'], ['cancelled', 'Cancelled']].map(function (o) { return '<option value="' + o[0] + '"' + (e.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
          '<div class="row"><button class="btn primary" type="submit">Save event</button></div></form>';
        function paint() {
          var m = $('#mode').value;
          $('#modehelp').textContent = MODE_HELP[m];
          $('#racef').hidden = m !== 'race';
          $('#elimf').hidden = m !== 'fallout';
          $('#roundopts').hidden = m === 'fallout';
        }
        $('#mode').addEventListener('change', paint);
        $('#scoring').addEventListener('change', function () { $('#gto').value = this.value === 'rally' ? 21 : 11; });
        paint();
        $('#ef').addEventListener('submit', function (ev) {
          ev.preventDefault();
          var body = { title: $('#t').value, starts_at: fromLocal($('#st').value), ends_at: fromLocal($('#en').value) || null, location: $('#loc').value, courts: $('#courts').value, capacity: $('#cap').value || null,
            scoring: $('#scoring').value, game_to: $('#gto').value, round_end: $('#rend').value, round_minutes: $('#rmin').value || null, round_limit: $('#rlim').value || null,
            race_target: $('#race').value || null, elimination: $('#elim').value, description: $('#desc').value, registration_open: $('#ropen').checked, show_roster: $('#roster').checked, status: $('#status').value };
          if (!locked) body.mode = $('#mode').value;
          if (body.mode === 'fallout' || e.mode === 'fallout') body.round_end = 'all';
          api.request(id ? 'PUT' : 'POST', '/api/events' + (id ? '/' + id : ''), body).then(function (r) { L.toast('Event saved'); location.hash = '#/play/events/' + r.id; }, function (err) { L.formError($('#ef'), err.status === 0 ? 'Saving an event needs a connection.' : err.message); });
        });
      });
    };

    /* ================= the event screen (members and host) ================= */
    var eventTab = {};
    var lastSeen = {};
    views.event = function (id) {
      var hash = '#/play/events/' + id;
      return api.get('/api/events/' + id).then(function (e) {
        render(e);
        if (e.status === 'live' || e.status === 'published') livePoll(hash, e.status === 'live' ? 3000 : 15000, function () { return api.request('GET', '/api/events/' + id); }, render);
      });
      function render(e) {
        var me = ME(), mine = me && me.athlete_id;
        var org = e.organizer;
        var round = e.rounds[e.rounds.length - 1];
        var liveRound = round && round.status === 'live' ? round : null;
        // Court change for this player: tone and buzz.
        var a = myAssignment(e, mine), sig = a ? (a.round.number + ':' + (a.match ? a.match.id : 'rest')) : '';
        if (lastSeen[id] !== undefined && sig && sig !== lastSeen[id]) chime();
        lastSeen[id] = sig;
        var tab = eventTab[id] || (e.status === 'live' ? (e.mode === 'fallout' ? 'bracket' : 'courts') : 'info');
        var tabs = [['info', 'Info']];
        if (e.mode !== 'fallout') tabs.push(['courts', 'Courts']);
        if (TEAM_MODES.indexOf(e.mode) >= 0) tabs.push(['teams', 'Teams']);
        if (e.mode === 'fixed' || e.mode === 'fallout') tabs.push(['bracket', 'Bracket']);
        tabs.push(['standings', 'Standings'], ['people', org ? 'Check-in' : 'Players']);
        if (org && e.mode === 'premapped') tabs.push(['schedule', 'Schedule']);
        if (org) tabs.push(['share', 'Share']);
        if (!tabs.some(function (t) { return t[0] === tab; })) tab = 'info';
        var body = { info: info, courts: courts, teams: teamsTab, bracket: bracketTab, standings: standingsTab, people: peopleTab, schedule: scheduleTab, share: shareTab }[tab]();
        var hostBtns = org ? '<div class="row"><a class="btn ghost" href="#/play/events/' + e.id + '/edit">Edit</a>' +
          (e.mode !== 'fallout' && ['published', 'live', 'draft'].indexOf(e.status) >= 0 ? '<button class="btn primary" type="button" id="next">Preview round ' + (e.rounds.length + 1) + '</button>' : '') +
          (liveRound && !liveRound.stopped ? '<button class="btn danger" type="button" id="stop">Stop all courts</button>' : '') +
          (e.status === 'live' ? '<button class="btn ghost" type="button" id="finish">Finish event</button>' : '') + '</div>' : '';
        app.innerHTML = '<a class="back" href="#/play">← Play</a>' + C.offlineNote(e) +
          head((e.status === 'live' ? 'Live · ' : e.status === 'draft' ? 'Draft · ' : e.status === 'complete' ? 'Final · ' : '') + (e.mode_label || MODES[e.mode]), e.title, fmtWhen(e.starts_at) + (e.location ? ' · ' + e.location : ''), hostBtns) +
          (org && e.undo ? '<div class="banner"><span>Last change: ' + h(e.undo.label) + '.</span><button class="btn sm" type="button" id="undo">Undo</button></div>' : '') +
          '<div id="preview"></div>' +
          (!org && e.me && e.me.state === 'registered' && e.status !== 'complete' ? assignmentCard(e, mine) + selfButtons(e) : '') +
          (org && liveRound && tab !== 'courts' ? timerHTML(liveRound) : '') +
          '<div class="chips" id="etabs">' + tabs.map(function (t) { return '<button class="chip" type="button" data-v="' + t[0] + '" aria-pressed="' + (tab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>' +
          '<div id="tab" class="stack">' + body + '</div>';
        bind(e);
        runTimers();

        function selfButtons(ev) {
          return '<div class="row">' + (ev.me.on_break ? '<button class="btn" type="button" data-self="back">I’m back</button>' : '<button class="btn ghost" type="button" data-self="break">Take a break</button>') +
            '<button class="btn ghost" type="button" data-self="leave">Leave event</button></div>' + chimeToggle();
        }
        function info() {
          var reg = me && me.athlete_id && ['published', 'live'].indexOf(e.status) >= 0;
          var closed = !e.registration_open && !org;
          return '<div class="card stack"><p class="small mono">' + h(fmtWhen(e.starts_at)) + (e.location ? ' · ' + h(e.location) : '') + '</p>' +
            (e.description ? '<div class="small">' + L.paras(e.description) + '</div>' : '') +
            '<p class="small muted">' + h(formatLine(e)) + '</p><p class="small muted">' + h(MODE_HELP[e.mode] || '') + '</p>' +
            '<p class="small">' + (e.capacity ? e.counts.registered + ' of ' + e.capacity + ' spots taken' : e.counts.registered + ' registered') + (e.counts.waitlist ? ' · ' + e.counts.waitlist + ' on the waitlist' : '') + (e.organizer_name ? ' · Host ' + h(e.organizer_name) : '') + '</p>' +
            (reg && !closed ? '<div class="row">' +
              (e.partner_mode === 'fixed' && (!e.me || e.me.state === 'withdrawn' || e.me.state === 'interested') ? '<input type="text" id="partner" placeholder="Partner’s player ID (optional)" aria-label="Partner’s player ID" style="flex:1;min-width:160px">' : '') +
              (!e.me || e.me.state === 'withdrawn' || e.me.state === 'interested' ? '<button class="btn primary" type="button" data-reg="register">' + (e.capacity && e.counts.registered >= e.capacity ? 'Join waitlist' : 'Register') + '</button>' : '') +
              (!e.me || e.me.state === 'withdrawn' ? '<button class="btn" type="button" data-reg="interest">Interested</button>' : '') +
              (e.me && e.me.state !== 'withdrawn' ? '<button class="btn ghost" type="button" data-reg="withdraw">Withdraw</button>' : '') + '</div>' : '') +
            (closed && (!e.me || e.me.state === 'withdrawn') ? '<p class="small muted">Registration is closed.</p>' : '') +
            (e.me && e.me.state !== 'withdrawn' ? '<p class="small">You’re <b>' + h(e.me.state) + '</b>' + (e.me.number ? ' as player #' + e.me.number : '') + (e.me.checked_in ? ', checked in.' : '. Show the QR on your Profile at check-in.') + '</p>' : '') +
            (!me || !me.athlete_id ? '<p class="small muted">Set up your athlete profile to register.</p>' : '') +
            '<div class="row">' + calendarButton() + '</div></div>';
        }
        function courts() { return courtsHTML(e, { mine: mine, org: org, link: true }) + (e.rounds.length ? '<div class="row"><button class="btn sm ghost" type="button" data-csv="matches">Download results (CSV)</button></div>' : ''); }
        function standingsTab() { return standingsHTML(e, mine) + '<div class="row"><button class="btn sm ghost" type="button" data-csv="standings">Download standings (CSV)</button></div>'; }
        function teamsTab() {
          var size = e.mode === 'draft3' ? 3 : 2;
          var inTeam = {}; e.teams.forEach(function (t) { [t.p1, t.p2, t.p3].forEach(function (x) { if (x) inTeam[x] = 1; }); });
          var free = e.people.filter(function (p) { return p.state === 'registered' && !inTeam[p.athlete_id]; });
          var started = e.rounds.length || e.bracket;
          var sel = function (n, i) { return '<div class="field"><label class="flabel" for="tp' + n + '">Player ' + n + '</label><select id="tp' + n + '">' + free.map(function (p, j) { return '<option value="' + p.athlete_id + '"' + (j === i ? ' selected' : '') + '>' + h((p.number ? '#' + p.number + ' ' : '') + p.name) + '</option>'; }).join('') + '</select></div>'; };
          return (e.teams.length ? '<div class="list">' + e.teams.map(function (t) {
            return '<div class="li"><span class="main-col"><span class="t small">' + h(t.label) + '</span><span class="d">' + h([t.p1_name, t.p2_name, t.p3_name].filter(Boolean).join(', ')) + '</span></span>' + (org && !started ? '<button class="btn sm ghost" type="button" data-deltm="' + t.id + '">Split</button>' : '') + '</div>';
          }).join('') + '</div>' : '<div class="list"><p class="empty">No teams yet.</p></div>') +
            (started && TEAM_MODES.indexOf(e.mode) >= 0 && e.mode !== 'fixed' ? '<p class="small muted">Teams are locked now that play has started.</p>' : '') +
            (org ? '<div class="card stack"><p class="section-title">Make a team</p>' + (free.length >= size ?
              '<div class="form-grid">' + Array.apply(null, { length: size }).map(function (_, i) { return sel(i + 1, i); }).join('') +
              '<div class="field"><label class="flabel" for="tnm">Team name <span class="hint">optional</span></label><input type="text" id="tnm" maxlength="60"></div></div>' +
              '<div class="row"><button class="btn primary" type="button" id="mktm">Make team</button><button class="btn ghost" type="button" id="autotm">' + (size === 3 ? 'Snake draft everyone left (' + free.length + ')' : 'Pair everyone left (' + free.length + ')') + '</button></div>' +
              (size === 3 ? '<p class="small muted">The snake draft spreads players by rating so every team gets a mix of levels.</p>' : '')
              : '<p class="small muted">' + (free.length ? free.length + ' player' + (free.length === 1 ? '' : 's') + ' without a team. Teams need ' + size + '.' : 'Everyone registered is on a team.') + '</p>') + '</div>' : '');
        }
        function bracketTab() {
          var b = e.bracket;
          var build = org ? '<div class="card stack"><p class="section-title">' + (b ? 'Rebuild bracket' : 'Create the bracket') + '</p><div class="form-grid">' +
            '<div class="field"><label class="flabel" for="bseed">Seeding</label><select id="bseed"><option value="standings">By standings</option><option value="order">In team order</option></select></div>' +
            '<div class="field"><label class="flabel" for="bsize">Teams in bracket</label><input type="number" id="bsize" min="2" max="' + (e.elimination === 'double' ? 8 : 64) + '" value="' + Math.min(e.teams.length, e.elimination === 'double' ? 8 : 64) + '"></div></div>' +
            '<div class="row"><button class="btn ' + (b ? 'danger' : 'primary') + '" type="button" id="mkbr">' + (b ? 'Rebuild bracket' : 'Create bracket') + '</button></div><p class="small muted">' + (e.elimination === 'double' ? 'Double elimination: a team is out after two losses. If the team from the losers side wins the grand final, a deciding game is played.' : 'Top seeds get byes when the number of teams isn’t a power of two.') + ' Winners move on as scores come in.</p></div>' : '';
          return (b ? bracketHTML(e, true) : (org ? '' : '<div class="list"><p class="empty">No bracket yet.</p></div>')) + build;
        }
        function peopleTab() {
          if (!org) return '<div class="list">' + (e.people.length ? e.people.map(function (p) { return '<div class="li"><span class="t small">' + h((p.number ? '#' + p.number + ' ' : '') + p.name) + '</span></div>'; }).join('') : '<p class="empty">' + (e.show_roster ? 'No one registered yet.' : 'The host keeps the player list private.') + '</p>') + '</div>';
          var alertTag = function (p) { return p.alerts === 'on' ? '<span class="tag ok">Alerts on</span>' : p.alerts === 'failed' ? '<span class="tag call">Alerts failing</span>' : '<span class="tag">No alerts</span>'; };
          return '<div class="card stack"><p class="section-title">Check players in</p>' +
            '<div class="row"><button class="btn primary" type="button" id="scan">Scan player QR</button></div><div id="scanbox"></div>' +
            '<form class="row" id="codef" novalidate><input type="text" id="code" placeholder="Player ID or check-in code" aria-label="Player ID or check-in code" style="flex:1;min-width:0"><button class="btn" type="submit">Check in</button></form></div>' +
            '<details class="card"><summary class="section-title">Add a walk-in</summary><form class="stack" id="walkf" novalidate><div class="form-grid">' +
            '<div class="field"><label class="flabel" for="wn">Name</label><input type="text" id="wn" maxlength="60"></div>' +
            '<div class="field"><label class="flabel" for="we">Email <span class="hint">optional</span></label><input type="email" id="we" maxlength="200"></div>' +
            '<div class="field"><label class="flabel" for="wp">Phone <span class="hint">optional</span></label><input type="tel" id="wp" maxlength="30"></div></div>' +
            '<div class="row"><button class="btn primary" type="submit">Add and check in</button></div><p class="small muted">No account needed. They get a player number and their own player link.</p></form></details>' +
            '<p class="small muted">' + e.counts.checked_in + ' checked in · ' + e.counts.registered + ' registered' + (e.counts.waitlist ? ' · ' + e.counts.waitlist + ' waitlist' : '') + '. Only checked-in players who are playing and not on a break get courts. Changes apply from the next round.</p>' +
            '<div class="list">' + (e.people.length ? e.people.map(function (p) {
              return '<div class="li person"><span class="main-col"><span class="t small">' + h((p.number ? '#' + p.number + ' ' : '') + p.name) + '</span><span class="d">' +
                [p.state === 'registered' ? (p.checked_in ? (p.on_break ? 'On a break' : p.active ? 'Playing' : 'Not playing') : 'Registered') : p.state === 'waitlist' ? 'Waitlist' : p.state, p.guest ? 'no account' : p.player_id, p.email, p.phone].filter(Boolean).map(h).join(' · ') + '</span>' +
                '<span class="row">' + alertTag(p) + (p.link ? '<button class="btn sm ghost" type="button" data-copy="' + h(abs(p.link)) + '">Copy player link</button>' : '') + '</span></span><span class="side row">' +
                (p.state === 'registered' && !p.checked_in ? '<button class="btn sm primary" type="button" data-in="' + p.athlete_id + '">Check in</button>' : '') +
                (p.state === 'registered' && p.checked_in ? (p.on_break ? '<button class="btn sm" type="button" data-pp="' + p.athlete_id + '" data-body=\'{"on_break":false}\'>Back from break</button>' : '<button class="btn sm ghost" type="button" data-pp="' + p.athlete_id + '" data-body=\'{"on_break":true}\'>Break</button>') +
                  '<button class="btn sm ghost" type="button" data-pp="' + p.athlete_id + '" data-body=\'{"active":' + (p.active ? 'false' : 'true') + '}\'>' + (p.active ? 'Not playing' : 'Playing') + '</button>' : '') +
                (p.state === 'waitlist' ? '<button class="btn sm" type="button" data-pp="' + p.athlete_id + '" data-body=\'{"state":"registered"}\'>Move in</button>' : '') +
                '<button class="btn sm danger" type="button" data-rm="' + p.athlete_id + '">Remove</button></span></div>';
            }).join('') : '<p class="empty">No one yet. Share the sign-up link from the Share tab, or add walk-ins.</p>') + '</div>' +
            '<div class="row"><button class="btn sm ghost" type="button" data-csv="roster">Download roster (CSV)</button></div>';
        }
        function scheduleTab() {
          var s = e.schedule;
          return '<div class="card stack"><p class="small muted">' + h(MODE_HELP.premapped) + '</p><div class="row"><button class="btn primary" type="button" id="mksched">' + (s && s.length ? 'Rebuild schedule' : 'Build schedule') + '</button></div></div>' +
            (s && s.length ? s.map(function (rd) {
              return '<div class="stack-sm"><p class="section-title">Round ' + rd.number + '</p><div class="list">' + rd.courts.map(function (c, i) { return '<div class="li"><span class="t small">Court ' + (i + 1) + ': ' + h(c[0]) + ' vs ' + h(c[1]) + '</span></div>'; }).join('') + '</div>' + (rd.sitting.length ? '<p class="small muted">Resting: ' + h(rd.sitting.join(', ')) + '</p>' : '') + '</div>';
            }).join('') : '<div class="list"><p class="empty">No schedule yet. Build it from the players signed up; it’s rebuilt automatically if attendance changes.</p></div>');
        }
        function shareTab() {
          return shareBox('sharelink', 'Player sign-up link', e.links.share, 'Players register with this link, no account needed. Anyone with it can see the event and who’s coming (if shown).', e.title) +
            shareBox('watchlink', 'Spectator link', e.links.watch, 'View only: live courts, standings and results. Spectators can’t register or change scores.', e.title + ' (live)') +
            '<div class="card stack"><p class="section-title">Links and registration</p><div class="row"><button class="btn sm danger" type="button" id="rshare">New sign-up link</button><button class="btn sm danger" type="button" id="rwatch">New spectator link</button></div>' +
            '<p class="small muted">A new link stops the old one working. Players already registered keep their own player links.</p>' +
            '<div class="toggles"><label class="tog" for="sopen"><input type="checkbox" id="sopen"' + (e.registration_open ? ' checked' : '') + '><div><b>Registration open</b><span>New players can sign up.</span></div></label>' +
            '<label class="tog" for="sroster"><input type="checkbox" id="sroster"' + (e.show_roster ? ' checked' : '') + '><div><b>Show who’s coming</b><span>Players see everyone registered.</span></div></label></div></div>' +
            '<div class="card stack"><p class="section-title">Repeat weekly</p><div class="row"><label class="sr-only" for="weeks">Weeks</label><select id="weeks">' + [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return '<option value="' + n + '">' + n + ' week' + (n > 1 ? 's' : '') + '</option>'; }).join('') + '</select><button class="btn" type="button" id="dup">Make weekly drafts</button></div>' +
            '<p class="small muted">Copies the format, courts and settings into drafts a week apart. Players and results don’t carry over.</p></div>' +
            '<div class="card stack"><p class="section-title">Downloads</p><div class="row">' + calendarButton('cal2') + '<button class="btn sm ghost" type="button" data-csv="roster">Roster CSV</button><button class="btn sm ghost" type="button" data-csv="matches">Results CSV</button><button class="btn sm ghost" type="button" data-csv="standings">Standings CSV</button></div></div>';
        }
      }
      function bind(e) {
        $('#etabs').addEventListener('click', function (ev) { var c = ev.target.closest('.chip'); if (c) { eventTab[id] = c.getAttribute('data-v'); C.route(); } });
        bindShare(app); bindCsv(e); bindChime(); verifyButtons();
        bindCalendar({ uid: 'event-' + e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, location: e.location, description: e.description });
        bindCalendar({ uid: 'event-' + e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, location: e.location, description: e.description }, 'cal2');
        var put = function (body, msg) { return api.request('PUT', '/api/events/' + e.id, body).then(function () { if (msg) L.toast(msg); C.route(); }, function (err) { L.toast(err.message); }); };
        $$('[data-reg]').forEach(function (b) { b.addEventListener('click', function () {
          var body = b.getAttribute('data-reg') === 'register' && $('#partner') && $('#partner').value.trim() ? { partner_player_id: $('#partner').value.trim() } : {};
          api.request('POST', '/api/events/' + e.id + '/' + b.getAttribute('data-reg'), body).then(function (r) { L.toast(r.me && r.me.state === 'waitlist' ? 'Event is full. You’re on the waitlist.' : 'Updated'); C.route(); }, function (err) { L.toast(err.message); });
        }); });
        $$('[data-self]').forEach(function (b) {
          var go = function () { api.request('POST', '/api/events/' + e.id + '/me', { action: b.getAttribute('data-self') }).then(function () { L.toast({ break: 'Enjoy the break. You’ll sit out until you’re back.', back: 'Welcome back. You’re in the next round.', leave: 'You’ve left the event.' }[b.getAttribute('data-self')]); C.route(); }, function (err) { L.toast(err.message); }); };
          if (b.getAttribute('data-self') === 'leave') L.armed(b, 'Tap again to leave', go); else b.addEventListener('click', go);
        });
        if ($('#ack')) $('#ack').addEventListener('click', function () { api.request('POST', '/api/matches/' + this.getAttribute('data-m') + '/ack', {}).then(C.route, function (err) { L.toast(err.message); }); });
        if ($('#undo')) $('#undo').addEventListener('click', function () { api.request('POST', '/api/events/' + e.id + '/attendance/undo', {}).then(function () { L.toast('Undone'); C.route(); }, function (err) { L.toast(err.message); }); });
        if ($('#stop')) L.armed($('#stop'), 'Tap again to stop every court', function () { api.request('POST', '/api/events/' + e.id + '/stop', {}).then(function () { L.toast('Courts stopped. Players enter the score as it stands.'); C.route(); }, function (err) { L.toast(err.message); }); });
        if ($('#finish')) L.armed($('#finish'), 'Tap again to finish', function () { put({ status: 'complete' }, 'Event finished. Final standings are saved.'); });
        if ($('#next')) $('#next').addEventListener('click', function () { preview(e, null); });
        // Teams
        if ($('#mktm')) $('#mktm').addEventListener('click', function () {
          api.request('POST', '/api/events/' + e.id + '/teams', { p1: Number($('#tp1').value), p2: Number($('#tp2').value), p3: $('#tp3') ? Number($('#tp3').value) : undefined, name: $('#tnm').value }).then(function () { L.toast('Team made'); C.route(); }, function (err) { L.toast(err.message); });
        });
        if ($('#autotm')) $('#autotm').addEventListener('click', function () { api.request('POST', '/api/events/' + e.id + '/teams/auto', {}).then(function () { L.toast('Teams made'); C.route(); }, function (err) { L.toast(err.message); }); });
        $$('[data-deltm]').forEach(function (b) { L.armed(b, 'Split?', function () { api.request('DELETE', '/api/events/' + e.id + '/teams/' + b.getAttribute('data-deltm')).then(C.route, function (err) { L.toast(err.message); }); }); });
        if ($('#mkbr')) {
          var mk = function (force) {
            api.request('POST', '/api/events/' + e.id + '/bracket', { seeding: $('#bseed').value, size: Number($('#bsize').value) || undefined, force: force || undefined })
              .then(function () { eventTab[id] = 'bracket'; L.toast('Bracket ready. Teams were notified.'); C.route(); }, function (err) {
                if (err.status === 409) L.toast(err.message, { label: 'Rebuild', run: function () { mk(true); } }); else L.toast(err.message);
              });
          };
          if (e.bracket) L.armed($('#mkbr'), 'Tap again to rebuild', function () { mk(false); }); else $('#mkbr').addEventListener('click', function () { mk(false); });
        }
        if ($('#mksched')) $('#mksched').addEventListener('click', function () { api.request('POST', '/api/events/' + e.id + '/schedule', {}).then(function () { L.toast('Schedule built'); C.route(); }, function (err) { L.toast(err.message); }); });
        // Check-in and roster
        var checkin = function (body) { return api.request('POST', '/api/events/' + e.id + '/checkin', body).then(function (r) { L.toast('Checked in: ' + r.checked_in.name); C.route(); }, function (err) { L.toast(err.message); }); };
        if ($('#codef')) $('#codef').addEventListener('submit', function (ev) { ev.preventDefault(); var v = $('#code').value.trim(); if (v) checkin({ code: v }); });
        $$('[data-in]').forEach(function (b) { b.addEventListener('click', function () { checkin({ athlete_id: Number(b.getAttribute('data-in')) }); }); });
        $$('[data-pp]').forEach(function (b) { b.addEventListener('click', function () {
          api.request('PUT', '/api/events/' + e.id + '/people/' + b.getAttribute('data-pp'), JSON.parse(b.getAttribute('data-body'))).then(function () { C.route(); }, function (err) { L.toast(err.message); });
        }); });
        $$('[data-rm]').forEach(function (b) { L.armed(b, 'Remove?', function () { api.request('PUT', '/api/events/' + e.id + '/people/' + b.getAttribute('data-rm'), { state: 'withdrawn' }).then(function () { L.toast('Removed. Undo is at the top.'); C.route(); }, function (err) { L.toast(err.message); }); }); });
        if ($('#scan')) $('#scan').addEventListener('click', function () { C.startScanner($('#scanbox'), function (text) { checkin({ code: text }); }); });
        if ($('#walkf')) $('#walkf').addEventListener('submit', function (ev) {
          ev.preventDefault();
          api.request('POST', '/api/events/' + e.id + '/walkin', { name: $('#wn').value, email: $('#we').value, phone: $('#wp').value }).then(function (r) { L.toast(r.added.name + ' added and checked in'); C.route(); }, function (err) { L.formError($('#walkf'), err.message); });
        });
        // Share tab
        if ($('#rshare')) L.armed($('#rshare'), 'Tap again: old link stops', function () { api.request('POST', '/api/events/' + e.id + '/links', { reset: 'share' }).then(function () { L.toast('New sign-up link made'); C.route(); }); });
        if ($('#rwatch')) L.armed($('#rwatch'), 'Tap again: old link stops', function () { api.request('POST', '/api/events/' + e.id + '/links', { reset: 'watch' }).then(function () { L.toast('New spectator link made'); C.route(); }); });
        if ($('#sopen')) $('#sopen').addEventListener('change', function () { put({ registration_open: this.checked }, this.checked ? 'Registration open' : 'Registration closed'); });
        if ($('#sroster')) $('#sroster').addEventListener('change', function () { put({ show_roster: this.checked }); });
        if ($('#dup')) $('#dup').addEventListener('click', function () {
          api.request('POST', '/api/events/' + e.id + '/duplicate', { weeks: Number($('#weeks').value) }).then(function (list) { L.toast(list.length + ' weekly draft' + (list.length > 1 ? 's' : '') + ' made'); location.hash = '#/play/events/' + list[0].id; }, function (err) { L.toast(err.message); });
        });
      }
      /* Preview the next round; start exactly what was shown. */
      function preview(e, seed) {
        var box = $('#preview');
        box.innerHTML = '<p class="small muted" role="status">Planning round ' + (e.rounds.length + 1) + '…</p>';
        api.request('GET', '/api/events/' + e.id + '/rounds/preview' + (seed ? '?seed=' + seed : '')).then(function (pv) {
          var open = e.rounds.filter(function (r) { return r.status === 'live'; })[0];
          box.innerHTML = '<div class="card stack preview"><p class="section-title">Round ' + pv.number + ' preview</p>' +
            (pv.rebuilt ? '<p class="flag">Attendance changed, so the rounds still to come were rebuilt around who’s here.</p>' : '') +
            (open ? '<p class="flag">Round ' + open.number + ' still has courts without scores. Starting now closes it.</p>' : '') +
            '<div class="courts">' + pv.courts.map(function (c) {
              return '<div class="court-card"><p class="eyebrow">Court ' + c.court + (c.games > 1 ? ' · ' + c.games + ' games' : '') + (c.start && (c.start[0] || c.start[1]) ? ' · starts ' + c.start[0] + '–' + c.start[1] : '') + '</p>' +
                c.teams.map(function (t) { return '<p class="tm">' + (t.label ? '<b>' + h(t.label) + '</b>' : '') + t.players.map(function (p) { return '<span>' + h(numberOf(e, p.athlete_id) + p.name) + (p.side ? ' <i>' + (p.side === 'left' ? 'L' : 'R') + '</i>' : '') + '</span>'; }).join('') + '</p>'; }).join('<p class="vs">vs</p>') + '</div>';
            }).join('') + '</div>' +
            (pv.sitting.length ? '<p class="small muted">Resting: ' + pv.sitting.map(function (p) { return h(numberOf(e, p.athlete_id) + p.name); }).join(', ') + '</p>' : '') +
            '<div class="row"><button class="btn primary" type="button" id="go">Start round ' + pv.number + '</button>' + (e.mode === 'premapped' && !pv.rebuilt ? '' : '<button class="btn" type="button" id="reshuffle">Shuffle again</button>') + '<button class="btn ghost" type="button" id="cancelpv">Cancel</button></div></div>';
          $('#go').addEventListener('click', function () {
            api.request('POST', '/api/events/' + e.id + '/rounds', { seed: pv.seed, force: !!open }).then(function () { eventTab[id] = 'courts'; L.toast('Round ' + pv.number + ' is on. Players were notified.'); C.route(); }, function (err) { L.toast(err.message); });
          });
          if ($('#reshuffle')) $('#reshuffle').addEventListener('click', function () { preview(e, Math.floor(Math.random() * 1e9)); });
          $('#cancelpv').addEventListener('click', function () { box.innerHTML = ''; });
          box.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }, function (err) { box.innerHTML = '<p class="flag" role="alert">' + h(err.message) + '</p>'; });
      }
    };

    /* ================= public pages ================= */
    function guestKey(eventId) { return 'guest:' + eventId; }

    /* Sign-up link: anyone can register, no account needed. */
    views.shareEvent = function (token) {
      return api.request('GET', '/api/public/events/' + token).then(function (e) {
        var saved = Store.get(guestKey(e.id));
        var me = ME();
        app.innerHTML = head('You’re invited', e.title, fmtWhen(e.starts_at) + (e.location ? ' · ' + e.location : '')) +
          (saved ? '<div class="banner"><span>You’re signed up on this device as player #' + h(saved.number) + '.</span><a class="btn sm primary" href="#/g/' + h(saved.token) + '">Open your player page</a></div>' : '') +
          '<div class="card stack">' + (e.description ? '<div class="small">' + L.paras(e.description) + '</div>' : '') +
          '<p class="small muted">' + h(formatLine(e)) + '</p><p class="small">' + (e.capacity ? e.counts.registered + ' of ' + e.capacity + ' spots taken' : e.counts.registered + ' signed up') + (e.counts.waitlist ? ' · ' + e.counts.waitlist + ' waiting' : '') + '</p><div class="row">' + calendarButton() + '</div></div>' +
          (e.status === 'cancelled' ? '<p class="flag">This event was cancelled.</p>' : e.status === 'complete' ? '<p class="flag">This event has finished.</p>' :
            !e.registration.open ? '<p class="flag">Registration is closed. Ask the host if you’d like to play.</p>' :
            e.me && e.me.state !== 'withdrawn' ? '<div class="banner"><span>You’re ' + h(e.me.state) + ' with your account.</span><a class="btn sm primary" href="#/play/events/' + e.id + '">Open event</a></div>' :
            e.signed_in && e.has_profile ? '<div class="card stack"><p class="section-title">Sign up</p><div class="row"><button class="btn primary" type="button" id="acct">' + (e.registration.full ? 'Join the waitlist' : 'Sign up with my account') + '</button></div></div>' :
            '<form class="card form" id="regf" novalidate><p class="section-title">' + (e.registration.full ? 'Join the waitlist' : 'Sign up') + '</p>' +
            '<div class="form-grid"><div class="field"><label class="flabel" for="rn">Your name</label><input type="text" id="rn" maxlength="60" autocomplete="name"></div>' +
            '<div class="field"><label class="flabel" for="re">Email</label><input type="email" id="re" maxlength="200" autocomplete="email"></div>' +
            '<div class="field"><label class="flabel" for="rp">Phone <span class="hint">optional</span></label><input type="tel" id="rp" maxlength="30" autocomplete="tel"></div></div>' +
            '<p class="small muted">No account needed. You’ll get a player number and your own player page with your court, partner and scores. The host sees your email and phone; other players see only your name.</p>' +
            '<div class="row"><button class="btn primary" type="submit">' + (e.registration.full ? 'Join waitlist' : 'Sign up') + '</button>' + (me ? '' : '<a class="btn ghost" href="#/signin">I have an account</a>') + '</div></form>') +
          (e.people.length ? '<div class="stack"><p class="section-title">Who’s coming · ' + e.people.length + '</p><div class="list">' + e.people.map(function (p) { return '<div class="li"><span class="t small">' + h((p.number ? '#' + p.number + ' ' : '') + p.name) + '</span></div>'; }).join('') + '</div></div>' : '') +
          (e.rounds.length ? '<div class="stack"><p class="section-title">Courts</p>' + courtsHTML(e, {}) + '</div><div class="stack"><p class="section-title">Standings</p>' + standingsHTML(e) + '</div>' : '') +
          (e.bracket ? '<div class="stack"><p class="section-title">Bracket</p>' + bracketHTML(e, false) + '</div>' : '');
        bindCalendar({ uid: 'event-' + e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, location: e.location, description: e.description });
        if ($('#acct')) $('#acct').addEventListener('click', function () { api.request('POST', '/api/public/events/' + token + '/register', {}).then(function (r) { L.toast(r.state === 'waitlist' ? 'You’re on the waitlist' : 'You’re in'); location.hash = '#/play/events/' + r.event_id; }, function (err) { L.toast(err.message); }); });
        if ($('#regf')) $('#regf').addEventListener('submit', function (ev) {
          ev.preventDefault();
          api.request('POST', '/api/public/events/' + token + '/register', { name: $('#rn').value, email: $('#re').value, phone: $('#rp').value }).then(function (r) {
            if (r.account) { location.hash = '#/play/events/' + r.event_id; return; }
            Store.set(guestKey(e.id), { token: r.token, number: r.number });
            Store.set('guest-links', (Store.get('guest-links', []).filter(function (x) { return x.token !== r.token; })).concat([{ token: r.token, title: e.title, starts_at: e.starts_at }]));
            L.toast(r.state === 'waitlist' ? 'You’re on the waitlist as #' + r.number : 'You’re in as player #' + r.number);
            location.hash = '#/g/' + r.token;
          }, function (err) { L.formError($('#regf'), err.message); });
        });
        if (e.status === 'live') livePoll('#/e/' + token, 8000, function () { return api.request('GET', '/api/public/events/' + token); }, function () { C.route(); });
      });
    };

    /* Spectator link: view only. */
    views.watchEvent = function (token) {
      var hash = '#/watch/' + token;
      return api.request('GET', '/api/watch/' + token).then(function (e) {
        var draw = function (ev) {
          var round = ev.rounds[ev.rounds.length - 1];
          app.innerHTML = head(ev.status === 'live' ? 'Live now' : ev.status === 'complete' ? 'Final results' : 'Spectator view', ev.title, fmtWhen(ev.starts_at) + (ev.location ? ' · ' + ev.location : '')) +
            '<p class="small muted">' + h(formatLine(ev)) + '</p>' +
            (ev.bracket && ev.bracket.champion ? '' : ev.race && ev.race.finished ? '<div class="focus-card"><p class="eyebrow">Winner</p><p class="big">' + h(ev.race.leader.name) + '</p></div>' : '') +
            (ev.bracket ? '<div class="stack"><p class="section-title">Bracket</p>' + bracketHTML(ev, false) + '</div>' : '') +
            (ev.mode !== 'fallout' ? '<div class="stack"><p class="section-title">Standings</p>' + standingsHTML(ev) + '</div>' : '') +
            (ev.rounds.length ? '<div class="stack"><p class="section-title">Courts</p>' + courtsHTML(ev, {}) + '</div>' : (ev.bracket ? '' : '<div class="list"><p class="empty">Play hasn’t started yet.</p></div>')) +
            '<div class="row"><button class="btn sm ghost" type="button" data-csv="standings">Standings (CSV)</button><button class="btn sm ghost" type="button" data-csv="matches">Results (CSV)</button></div>';
          bindCsv(ev); runTimers();
          void round;
        };
        draw(e);
        if (e.status === 'live' || e.status === 'published') livePoll(hash, 5000, function () { return api.request('GET', '/api/watch/' + token); }, draw);
      });
    };

    /* Player page for someone who signed up with a link. */
    views.guest = function (token) {
      var hash = '#/g/' + token;
      var gTab = 'courts';
      return api.get('/api/g/' + token).then(function (e) {
        Store.set(guestKey(e.id), { token: token, number: e.guest.number });
        draw(e);
        if (['live', 'published'].indexOf(e.status) >= 0) livePoll(hash, e.status === 'live' ? 3000 : 20000, function () { return api.request('GET', '/api/g/' + token); }, draw);
      });
      function draw(e) {
        var aid = e.me ? e.me.athlete_id : null;
        var a = myAssignment(e, aid), sig = a ? (a.round.number + ':' + (a.match ? a.match.id : 'rest')) : '';
        if (lastSeen[hash] !== undefined && sig && sig !== lastSeen[hash]) chime();
        lastSeen[hash] = sig;
        var me = ME();
        var st = e.me ? e.me.state : 'withdrawn';
        var m = a && a.match;
        var canScore = m && ['scheduled', 'recorded', 'disputed'].indexOf(m.status) >= 0;
        var stopped = a && a.round && a.round.stopped;
        var tabs = [];
        if (e.mode !== 'fallout') tabs.push(['courts', 'Courts']);
        if (e.bracket) tabs.push(['bracket', 'Bracket']);
        tabs.push(['standings', 'Standings'], ['mine', 'My games']);
        if (!tabs.some(function (t) { return t[0] === gTab; })) gTab = tabs[0][0];
        var myGames = [];
        e.rounds.forEach(function (rd) { rd.matches.forEach(function (x) { if (x.players.some(function (p) { return p.athlete_id === aid; })) myGames.push({ rd: rd, m: x }); }); });
        var rests = e.rounds.filter(function (rd) { return rd.sitting_out.some(function (p) { return p.athlete_id === aid; }); }).map(function (rd) { return rd.number; });
        app.innerHTML = head('Player #' + (e.guest.number || '') + ' · ' + e.guest.name, e.title, fmtWhen(e.starts_at) + (e.location ? ' · ' + e.location : '')) + C.offlineNote(e) +
          (st === 'waitlist' ? '<div class="banner"><span>You’re on the waitlist. We’ll move you in if a spot opens; this page updates.</span></div>' : '') +
          (st === 'withdrawn' ? '<p class="flag">You’ve left this event. Ask the host if you want back in.</p>' : '') +
          (e.status === 'cancelled' ? '<p class="flag">This event was cancelled.</p>' : '') +
          (st === 'registered' && e.me && !e.me.checked_in && e.status !== 'complete' ? '<div class="card stack"><p class="section-title">Check in when you arrive</p><div class="qr-wrap">' + qrSVG(e.guest.qr, 'Your check-in QR') + '<p class="small">Show this to the host. Can’t scan? Tell them you’re player <b class="mono">#' + h(e.guest.number) + '</b>.</p></div></div>' : '') +
          (st === 'registered' && e.status !== 'complete' ? assignmentCard(e, aid, 'gack') : '') +
          (canScore && st === 'registered' ? scoreBox(m, a, stopped) : '') +
          (st === 'registered' && e.status !== 'complete' && e.status !== 'cancelled' ? '<div class="row">' + (e.me.on_break ? '<button class="btn" type="button" data-gs="back">I’m back</button>' : '<button class="btn ghost" type="button" data-gs="break">Take a break</button>') + '<button class="btn ghost" type="button" data-gs="leave">Leave event</button></div>' : '') +
          '<div class="chips" id="gtabs">' + tabs.map(function (t) { return '<button class="chip" type="button" data-v="' + t[0] + '" aria-pressed="' + (gTab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>' +
          '<div class="stack">' + ({
            courts: function () { return courtsHTML(e, { mine: aid }); },
            bracket: function () { return bracketHTML(e, false); },
            standings: function () { return standingsHTML(e, aid); },
            mine: function () {
              return (myGames.length ? '<div class="list">' + myGames.map(function (x) {
                var t = x.m.players.filter(function (p) { return p.athlete_id === aid; })[0].team;
                var res = x.m.status === 'scheduled' ? '' : x.m.winner === t ? '<span class="result w">W</span>' : x.m.winner ? '<span class="result l">L</span>' : '<span class="result">D</span>';
                return '<div class="li"><span class="who">' + res + '<span class="main-col"><span class="t small">Round ' + x.rd.number + ' · Court ' + x.m.court + '</span><span class="d">' + C.teamNames(x.m, 1) + ' vs ' + C.teamNames(x.m, 2) + ' · ' + h(C.scoreLine(x.m)) + '</span></span></span><span class="side">' + C.statusPill(x.m) + '</span></div>';
              }).join('') + '</div>' : '<div class="list"><p class="empty">No games yet.</p></div>') + (rests.length ? '<p class="small muted">Rest rounds: ' + rests.join(', ') + '</p>' : '');
            }
          }[gTab])() + '</div>' +
          '<div class="card stack"><p class="section-title">Alerts</p><div id="gpush"></div>' + chimeToggle() + '</div>' +
          '<div class="card stack"><p class="section-title">Keep this page</p><p class="small muted">This link is your player page. Bookmark it or add THE LAB to your Home Screen.</p><div class="row"><button class="btn sm" type="button" data-copy="' + h(abs('#/g/' + token)) + '">Copy my link</button>' + calendarButton() + '</div>' +
          (e.guest.linked ? '<p class="small">Linked to a THE LAB account.</p>' : me ? '<div class="row"><button class="btn sm primary" type="button" id="linkme">Add to my account (' + h(me.user.name) + ')</button></div>' : '<p class="small muted">Have an account, or want one? <a href="#/signup">Create an account</a>, then paste this link under Play → “Signed up with a link”. Your results move over.</p>') + '</div>';
        bindShare(app); bindChime(); runTimers();
        bindCalendar({ uid: 'event-' + e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, location: e.location, description: e.description });
        $('#gtabs').addEventListener('click', function (ev) { var c = ev.target.closest('.chip'); if (c) { gTab = c.getAttribute('data-v'); draw(e); } });
        if ($('#gack')) $('#gack').addEventListener('click', function () { api.request('POST', '/api/g/' + token + '/ack', { match_id: this.getAttribute('data-m') }).then(function () { return api.request('GET', '/api/g/' + token); }).then(draw, function (err) { L.toast(err.message); }); });
        $$('[data-gs]').forEach(function (b) {
          var go = function () { api.request('POST', '/api/g/' + token + '/status', { action: b.getAttribute('data-gs') }).then(function (d) { L.toast({ break: 'You’ll sit out until you tap I’m back.', back: 'Welcome back. You’re in the next round.', leave: 'You’ve left the event.' }[b.getAttribute('data-gs')]); draw(d); }, function (err) { L.toast(err.message); }); };
          if (b.getAttribute('data-gs') === 'leave') L.armed(b, 'Tap again to leave', go); else b.addEventListener('click', go);
        });
        if ($('#gsf')) $('#gsf').addEventListener('submit', function (ev) {
          ev.preventDefault();
          var a0 = $('#gs0').value, b0 = $('#gs1').value;
          if (a0 === '' || b0 === '') return L.formError($('#gsf'), 'Enter both scores.');
          var mine = a.me.team, games = [mine === 1 ? [Number(a0), Number(b0)] : [Number(b0), Number(a0)]];
          api.request('POST', '/api/g/' + token + '/score', { match_id: m.id, version: m.version, games: games }).then(function (d) { L.toast('Score sent. The host will confirm it.'); draw(d); }, function (err) { L.formError($('#gsf'), err.message); });
        });
        if ($('#linkme')) $('#linkme').addEventListener('click', function () { api.request('POST', '/api/me/link-guest', { token: token }).then(function (r) { L.toast('Added to your account'); location.hash = '#/play/events/' + r.event_id; }, function (err) { L.toast(err.message); }); });
        guestPush(token);
      }
      function scoreBox(m, a, stopped) {
        var mine = a.me.team, g = m.games[0] || null;
        var us = g ? g[mine - 1] : '', them = g ? g[2 - mine] : '';
        return '<form class="card form" id="gsf" novalidate><p class="section-title">' + (m.status === 'scheduled' ? 'Enter your score' : 'Your score · ' + h(m.status_label)) + '</p>' +
          (stopped ? '<p class="small">Play was stopped. Enter the score as it stands; a tie is fine.</p>' : '') +
          (m.start1 || m.start2 ? '<p class="small muted">Your team started on ' + (mine === 1 ? m.start1 : m.start2) + ', they started on ' + (mine === 1 ? m.start2 : m.start1) + '. Enter the final score, head start included.</p>' : '') +
          '<div class="score-entry"><label class="field"><span class="flabel">Your team</span><input type="number" inputmode="numeric" min="0" max="250" id="gs0" value="' + us + '"></label><span class="dash" aria-hidden="true">–</span><label class="field"><span class="flabel">Them</span><input type="number" inputmode="numeric" min="0" max="250" id="gs1" value="' + them + '"></label></div>' +
          '<div class="row"><button class="btn primary" type="submit">' + (m.status === 'scheduled' ? 'Send score' : 'Correct score') + '</button></div><p class="small muted">The host confirms every score.</p></form>';
      }
    };
    /* Court alerts on a phone for a player without an account. */
    function guestPush(token) {
      var box = $('#gpush'); if (!box) return;
      if (!META().push) { box.innerHTML = '<p class="small muted">Keep this page open to see court changes as they happen.</p>'; return; }
      var ios = /iPhone|iPad/.test(navigator.userAgent), standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        box.innerHTML = '<p class="small muted">' + (ios && !standalone ? 'On iPhone, add this page to your Home Screen (Share → Add to Home Screen) and open it from there to get court alerts.' : 'This browser can’t show phone alerts. Keep this page open instead.') + '</p>'; return;
      }
      navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription().then(function (sub) { return { reg: reg, sub: sub }; }); }).then(function (x) {
        var on = !!x.sub && Notification.permission === 'granted' && Store.get('gpush:' + token, false);
        box.innerHTML = '<label class="tog" for="gpon"><input type="checkbox" id="gpon"' + (on ? ' checked' : '') + '><div><b>Court alerts on this phone</b><span>' + (Notification.permission === 'denied' ? 'Blocked in your browser settings.' : 'Your court, partner and score reminders, even with this page closed.') + '</span></div></label>';
        $('#gpon').addEventListener('change', function () {
          var cb = this;
          if (cb.checked) {
            Notification.requestPermission().then(function (perm) {
              if (perm !== 'granted') throw new Error('Notifications weren’t allowed.');
              return x.sub || api.request('GET', '/api/push/key').then(function (k) {
                var raw = atob(k.publicKey.replace(/-/g, '+').replace(/_/g, '/')), key = new Uint8Array(raw.length);
                for (var i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
                return x.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
              });
            }).then(function (sub) { return api.request('POST', '/api/g/' + token + '/push', Object.assign(sub.toJSON(), { test: true })); })
              .then(function () { Store.set('gpush:' + token, true); L.toast('Court alerts on. A test alert is on its way.'); }, function (err) { cb.checked = false; L.toast(err.message || 'Couldn’t turn on alerts.'); });
          } else if (x.sub) {
            Store.set('gpush:' + token, false);
            api.request('POST', '/api/g/' + token + '/push/off', { endpoint: x.sub.endpoint }).then(function () { L.toast('Court alerts off'); });
          }
        });
      }, function () { box.innerHTML = '<p class="small muted">Alerts need the app to finish installing. Reload and try again.</p>'; });
    }

    /* ================= Events desk hub ================= */
    views.desk = function () {
      if (!has('coach')) return C.forbidden('The Events desk is for coaches and organizers.');
      return Promise.all([api.get('/api/interest'), api.get('/api/plans'), api.get('/api/events')]).then(function (res) {
        var checks = res[0], plans = res[1], events = res[2];
        var me = ME();
        var openChecks = checks.filter(function (c) { return c.status === 'open'; });
        var upPlans = plans.filter(function (p) { return p.status !== 'done' && p.status !== 'cancelled'; });
        var myEvents = events.filter(function (e) { return e.organizer_id === me.user.id && e.status !== 'complete' && e.status !== 'cancelled'; });
        app.innerHTML = '<a class="back" href="#/">← Home</a>' + head('Coach Workspace', 'Events desk', 'Test an idea, plan the session, run the games.') +
          '<div class="desk-steps">' +
          '<a href="#/coach/interest"><b>1 · Pending Interest</b><span>Find out who wants to play before you pick a date.</span><em>' + openChecks.length + ' open</em></a>' +
          '<a href="#/coach/plans"><b>2 · Team Planner</b><span>Coached sessions: invitations, courts, drills, recaps.</span><em>' + upPlans.length + ' upcoming</em></a>' +
          '<a href="#/play/events"><b>3 · Events</b><span>Registration, check-in, rotations, scores, standings.</span><em>' + myEvents.length + ' coming up</em></a></div>' +
          '<div class="row"><a class="btn" href="#/coach/interest/new">New interest check</a><a class="btn" href="#/coach/plans/new">New plan</a><a class="btn primary" href="#/play/events/new">New event</a></div>' +
          '<div class="grid-2"><div class="stack"><p class="section-title">Interest checks</p>' + (openChecks.length ? '<div class="list">' + openChecks.slice(0, 5).map(interestRow).join('') + '</div>' : '<div class="list"><p class="empty">None open.</p></div>') + '</div>' +
          '<div class="stack"><p class="section-title">Upcoming plans</p>' + (upPlans.length ? '<div class="list">' + upPlans.slice(0, 5).map(planRow).join('') + '</div>' : '<div class="list"><p class="empty">No plans yet.</p></div>') + '</div></div>' +
          '<div class="stack"><p class="section-title">Your events</p>' + (myEvents.length ? '<div class="list">' + myEvents.map(C.eventRow).join('') + '</div>' : '<div class="list"><p class="empty">No upcoming events.</p></div>') + '</div>';
      });
    };

    /* ================= Pending Interest ================= */
    function progressBar(have, need, label) { var pc = need ? Math.min(100, Math.round(have / need * 100)) : 0; return '<div class="progress" role="progressbar" aria-label="' + h(label) + '" aria-valuemin="0" aria-valuemax="' + need + '" aria-valuenow="' + have + '"><i style="width:' + pc + '%"></i></div>'; }
    function interestRow(c) {
      return '<a class="li" href="#/coach/interest/' + c.id + '"><span class="main-col"><span class="t">' + h(c.title) + '</span><span class="d">' + h(c.kind_label) + ' · ' + c.counts.interested + ' interested' + (c.counts.maybe ? ', ' + c.counts.maybe + ' maybe' : '') + (c.min_people ? ' · need ' + c.min_people : '') + '</span>' +
        (c.min_people ? progressBar(c.counts.interested, c.min_people, c.title + ' progress') : '') + '</span><span class="side">' + (c.status === 'open' ? (c.progress.reached ? '<span class="tag ok">Minimum reached</span>' : '<span class="tag">Open</span>') : c.status === 'scheduled' ? '<span class="tag ok">Scheduled</span>' : '<span class="tag">Closed</span>') + '</span></a>';
    }
    views.interestList = function () {
      if (!has('coach')) return C.forbidden('Pending Interest is for coaches and organizers.');
      return api.get('/api/interest').then(function (list) {
        app.innerHTML = '<a class="back" href="#/coach/desk">← Events desk</a>' + C.offlineNote(list) + head('Events desk', 'Pending Interest', 'Share a link, see who’s in, then set the date.', '<a class="btn primary" href="#/coach/interest/new">New interest check</a>') +
          (list.length ? '<div class="list">' + list.map(interestRow).join('') + '</div>' : '<div class="list"><p class="empty">No interest checks yet. Start one for a training group, clinic, league or open play.</p></div>');
      });
    };
    views.interestEdit = function (id) {
      if (!has('coach')) return C.forbidden('Pending Interest is for coaches and organizers.');
      var isNew = id === 'new';
      return (isNew ? Promise.resolve({ title: '', kind: 'training', description: '', skill_level: '', location: '', timing: '', min_people: null, max_people: null, options: [] }) : api.get('/api/interest/' + id)).then(function (c) {
        var opts = c.options.map(function (o) { return { id: o.id, label: o.label, starts_at: o.starts_at }; });
        app.innerHTML = '<a class="back" href="' + (isNew ? '#/coach/interest' : '#/coach/interest/' + id) + '">← ' + (isNew ? 'Pending Interest' : 'Interest check') + '</a>' + head('Pending Interest', isNew ? 'New interest check' : 'Edit interest check') +
          '<form class="card form" id="icf" novalidate>' +
          '<div class="field"><label class="flabel" for="ct">Name</label><input type="text" id="ct" maxlength="120" value="' + h(c.title) + '" placeholder="Tuesday 3.5 training group"></div>' +
          '<div class="form-grid"><div class="field"><label class="flabel" for="ck">Type</label><select id="ck">' + Object.keys(INTEREST_KINDS).map(function (k) { return '<option value="' + k + '"' + (c.kind === k ? ' selected' : '') + '>' + INTEREST_KINDS[k] + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label class="flabel" for="cs">Skill level</label><input type="text" id="cs" maxlength="60" value="' + h(c.skill_level) + '" placeholder="3.0–3.5"></div>' +
          '<div class="field"><label class="flabel" for="cl">Possible location</label><input type="text" id="cl" maxlength="200" value="' + h(c.location) + '"></div></div>' +
          '<div class="form-grid"><div class="field"><label class="flabel" for="cmin">Minimum to run</label><input type="number" id="cmin" min="1" max="500" value="' + (c.min_people || '') + '"></div>' +
          '<div class="field"><label class="flabel" for="cmax">Maximum</label><input type="number" id="cmax" min="1" max="500" value="' + (c.max_people || '') + '" placeholder="No limit"></div>' +
          '<div class="field"><label class="flabel" for="ctime">Proposed timing</label><input type="text" id="ctime" maxlength="300" value="' + h(c.timing) + '" placeholder="Weeknights in March, 90 minutes"></div></div>' +
          '<div class="field"><label class="flabel" for="cd">Description</label><textarea id="cd" maxlength="4000">' + h(c.description) + '</textarea></div>' +
          '<div class="stack-sm"><p class="flabel">Day and time options <span class="hint">players pick all that work</span></p><div id="optlist" class="stack-sm"></div><div class="row"><button class="btn sm ghost" type="button" id="addopt">Add an option</button></div></div>' +
          '<div class="row"><button class="btn primary" type="submit">Save</button></div></form>';
        function paintOpts() {
          $('#optlist').innerHTML = opts.map(function (o, i) {
            return '<div class="opt-row"><input type="text" maxlength="120" value="' + h(o.label) + '" data-i="' + i + '" data-f="label" aria-label="Option ' + (i + 1) + '" placeholder="e.g. Tuesdays 6–7:30pm"><input type="datetime-local" value="' + local(o.starts_at) + '" data-i="' + i + '" data-f="starts_at" aria-label="Option ' + (i + 1) + ' date (optional)"><button class="btn sm ghost" type="button" data-del="' + i + '" aria-label="Remove option ' + (i + 1) + '">✕</button></div>';
          }).join('') || '<p class="small muted">No options yet. Add a few day and time choices, or leave it open.</p>';
          $$('#optlist input').forEach(function (inp) { inp.addEventListener('input', function () { var o = opts[+inp.getAttribute('data-i')]; if (inp.getAttribute('data-f') === 'label') o.label = inp.value; else o.starts_at = fromLocal(inp.value) || null; }); });
          $$('#optlist [data-del]').forEach(function (b) { b.addEventListener('click', function () { opts.splice(+b.getAttribute('data-del'), 1); paintOpts(); }); });
        }
        paintOpts();
        $('#addopt').addEventListener('click', function () { if (opts.length >= 12) return L.toast('Up to 12 options.'); opts.push({ label: '', starts_at: null }); paintOpts(); $$('#optlist input[data-f="label"]').pop().focus(); });
        $('#icf').addEventListener('submit', function (ev) {
          ev.preventDefault();
          var body = { title: $('#ct').value, kind: $('#ck').value, skill_level: $('#cs').value, location: $('#cl').value, min_people: $('#cmin').value || null, max_people: $('#cmax').value || null, timing: $('#ctime').value, description: $('#cd').value, options: opts.filter(function (o) { return o.label.trim(); }) };
          api.request(isNew ? 'POST' : 'PUT', '/api/interest' + (isNew ? '' : '/' + id), body).then(function (r) { L.toast('Saved'); location.hash = '#/coach/interest/' + r.id; }, function (err) { L.formError($('#icf'), err.message); });
        });
      });
    };
    views.interest = function (id) {
      if (!has('coach')) return C.forbidden('Pending Interest is for coaches and organizers.');
      return api.get('/api/interest/' + id).then(function (c) {
        var optName = {}; c.options.forEach(function (o) { optName[o.id] = o.label; });
        app.innerHTML = '<a class="back" href="#/coach/interest">← Pending Interest</a>' + C.offlineNote(c) +
          head(c.kind_label + (c.skill_level ? ' · ' + c.skill_level : ''), c.title, [c.location, c.timing].filter(Boolean).join(' · '), '<div class="row"><a class="btn ghost" href="#/coach/interest/' + c.id + '/edit">Edit</a>' + (c.status === 'scheduled' ? (c.plan_id ? '<a class="btn primary" href="#/coach/plans/' + c.plan_id + '">Open the plan</a>' : '') : '<button class="btn" type="button" id="toggle">' + (c.status === 'open' ? 'Close responses' : 'Reopen') + '</button>') + '</div>') +
          '<div class="card stack"><p class="section-title">Progress</p><p class="big-num">' + c.counts.interested + (c.min_people ? ' <span>of ' + c.min_people + ' needed</span>' : ' <span>interested</span>') + '</p>' +
          (c.min_people ? progressBar(c.counts.interested, c.min_people, 'Interested out of the minimum') : '') +
          '<p class="small muted">' + c.counts.maybe + ' maybe · ' + c.counts.waitlist + ' waitlist' + (c.max_people ? ' · capacity ' + c.max_people : '') + (c.progress.reached ? ' · <b>Minimum reached</b>' : '') + '</p></div>' +
          (c.status !== 'scheduled' ? shareBox('ilink', 'Response link', c.link, 'Players answer interested or maybe, pick the times that work, and leave a note. They don’t see each other’s names.', c.title) : '') +
          (c.options.length ? '<div class="stack"><p class="section-title">Times that work</p><div class="table-wrap card" style="padding:0" tabindex="0" role="region" aria-label="Table, scrolls sideways"><table class="summary-table"><thead><tr><th>Option</th><th>Interested</th><th>Maybe</th></tr></thead><tbody>' +
            c.options.map(function (o) { return '<tr><td>' + h(o.label) + (o.starts_at ? '<br><span class="small muted">' + h(fmtWhen(o.starts_at)) + '</span>' : '') + '</td><td class="n">' + o.interested + '</td><td class="n">' + o.maybe + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '') +
          (c.status !== 'scheduled' ? '<form class="card form" id="schf" novalidate><p class="section-title">Set the date</p><p class="small muted">Turns this into a Team Planner session. Everyone interested becomes an invitee with their own link.</p>' +
            '<div class="form-grid"><div class="field"><label class="flabel" for="sst">Starts</label><input type="datetime-local" id="sst" value="' + local((c.options.filter(function (o) { return o.starts_at; }).sort(function (a, b) { return b.interested - a.interested; })[0] || {}).starts_at) + '"></div>' +
            '<div class="field"><label class="flabel" for="sen">Ends <span class="hint">optional</span></label><input type="datetime-local" id="sen"></div>' +
            '<div class="field"><label class="flabel" for="sloc">Location</label><input type="text" id="sloc" maxlength="200" value="' + h(c.location) + '"></div></div>' +
            '<label class="tog" for="smaybe"><input type="checkbox" id="smaybe"><div><b>Invite the maybes too</b><span>' + c.counts.maybe + ' people said maybe.</span></div></label>' +
            '<div class="row"><button class="btn primary" type="submit">Create the plan</button></div></form>' : '') +
          '<div class="stack"><p class="section-title">Responses · ' + c.responses.length + '</p>' + (c.responses.length ? '<div class="list">' + c.responses.map(function (r) {
            return '<div class="li"><span class="main-col"><span class="t small">' + h(r.name) + ' <span class="tag' + (r.status === 'interested' ? ' ok' : r.status === 'waitlist' ? ' demo' : '') + '">' + h(r.status) + '</span></span>' +
              '<span class="d">' + [r.email, r.phone].filter(Boolean).map(h).join(' · ') + '</span>' + (r.option_ids.length ? '<span class="d">Can do: ' + r.option_ids.map(function (x) { return h(optName[x] || ''); }).filter(Boolean).join(', ') + '</span>' : '') + (r.notes ? '<span class="d">“' + h(r.notes) + '”</span>' : '') + '</span>' +
              '<span class="side"><button class="btn sm ghost" type="button" data-delr="' + r.id + '">Remove</button></span></div>';
          }).join('') + '</div>' : '<div class="list"><p class="empty">No responses yet. Share the link.</p></div>') +
          '<div class="row"><button class="btn sm ghost" type="button" id="icsv">Export responses (CSV)</button><button class="btn sm danger" type="button" id="idel">Delete interest check</button></div></div>';
        bindShare(app);
        if ($('#toggle')) $('#toggle').addEventListener('click', function () { api.request('POST', '/api/interest/' + c.id + '/status', { status: c.status === 'open' ? 'closed' : 'open' }).then(function () { L.toast(c.status === 'open' ? 'Responses closed' : 'Reopened'); C.route(); }, function (err) { L.toast(err.message); }); });
        $$('[data-delr]').forEach(function (b) { L.armed(b, 'Remove?', function () { api.request('DELETE', '/api/interest/' + c.id + '/responses/' + b.getAttribute('data-delr')).then(C.route, function (err) { L.toast(err.message); }); }); });
        $('#icsv').addEventListener('click', function () {
          download(slug(c.title) + '-responses.csv', csv([['Name', 'Email', 'Phone', 'Status', 'Times that work', 'Notes', 'Responded']].concat(c.responses.map(function (r) { return [r.name, r.email, r.phone, r.status, r.option_ids.map(function (x) { return optName[x]; }).join('; '), r.notes, r.created_at]; }))), 'text/csv');
        });
        L.armed($('#idel'), 'Tap again to delete', function () { api.request('DELETE', '/api/interest/' + c.id).then(function () { L.toast('Deleted'); location.hash = '#/coach/interest'; }); });
        if ($('#schf')) $('#schf').addEventListener('submit', function (ev) {
          ev.preventDefault();
          api.request('POST', '/api/interest/' + c.id + '/schedule', { starts_at: fromLocal($('#sst').value), ends_at: fromLocal($('#sen').value) || null, location: $('#sloc').value, include_maybe: $('#smaybe').checked, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
            .then(function (r) { L.toast('Plan created. Review it, then send the invitations.'); location.hash = '#/coach/plans/' + r.plan_id; }, function (err) { L.formError($('#schf'), err.message); });
        });
      });
    };
    /* The page players open from the interest link. */
    views.interestPublic = function (token) {
      var edit = Store.get('interest:' + token, null);
      return api.request('GET', '/api/public/interest/' + token + (edit ? '?edit=' + encodeURIComponent(edit) : '')).then(function (c) {
        var mine = c.mine;
        app.innerHTML = head(c.kind_label + (c.skill_level ? ' · ' + c.skill_level : ''), c.title, [c.location, c.timing].filter(Boolean).join(' · ')) +
          '<div class="card stack">' + (c.description ? '<div class="small">' + L.paras(c.description) + '</div>' : '') +
          '<p class="small">' + c.counts.interested + ' interested so far' + (c.min_people ? ' · needs ' + c.min_people + ' to run' : '') + (c.spots_left !== null ? ' · ' + (c.spots_left ? c.spots_left + ' spots left' : 'full, new answers join the waitlist') : '') + '</p>' +
          (c.min_people ? progressBar(c.counts.interested, c.min_people, 'Interested out of the minimum') : '') + '</div>' +
          (mine ? '<div class="banner"><span>You answered <b>' + h(mine.status) + '</b>. Change it below.</span></div>' : '') +
          (!c.open ? '<p class="flag">' + (c.status === 'scheduled' ? 'This one is happening. The organizer is sending invitations.' : 'Responses are closed.') + '</p>' :
            '<form class="card form" id="irf" novalidate><p class="section-title">' + (mine ? 'Update your answer' : 'Count me in') + '</p>' +
            '<div class="form-grid"><div class="field"><label class="flabel" for="in">Name</label><input type="text" id="in" maxlength="60" autocomplete="name" value="' + h(mine ? mine.name : '') + '"></div>' +
            '<div class="field"><label class="flabel" for="ie">Email</label><input type="email" id="ie" maxlength="200" autocomplete="email" value="' + h(mine ? mine.email : '') + '"' + (mine ? ' readonly' : '') + '></div>' +
            '<div class="field"><label class="flabel" for="ip">Phone <span class="hint">optional</span></label><input type="tel" id="ip" maxlength="30" autocomplete="tel" value="' + h(mine ? mine.phone : '') + '"></div></div>' +
            '<div class="field"><span class="flabel">Are you in?</span>' + segButtons('st', { interested: 'Interested', maybe: 'Maybe' }, mine && mine.status === 'maybe' ? 'maybe' : 'interested') + '</div>' +
            (c.options.length ? '<fieldset class="field"><legend class="flabel">Times that work for you</legend><div class="toggles opt-checks">' + c.options.map(function (o) { return '<label class="tog" for="o' + o.id + '"><input type="checkbox" id="o' + o.id + '" value="' + o.id + '"' + (mine && mine.option_ids.indexOf(o.id) >= 0 ? ' checked' : '') + '><div><b>' + h(o.label) + '</b>' + (o.starts_at ? '<span>' + h(fmtWhen(o.starts_at)) + '</span>' : '') + '</div></label>'; }).join('') + '</div></fieldset>' : '') +
            '<div class="field"><label class="flabel" for="inote">Note <span class="hint">optional</span></label><textarea id="inote" maxlength="1000">' + h(mine ? mine.notes : '') + '</textarea></div>' +
            '<p class="small muted">The organizer sees your name, email, phone and answers. Other players don’t.</p>' +
            '<div class="row"><button class="btn primary" type="submit">' + (mine ? 'Update' : 'Send') + '</button></div></form>');
        bindSeg(app);
        if ($('#irf')) $('#irf').addEventListener('submit', function (ev) {
          ev.preventDefault();
          var body = { name: $('#in').value, email: $('#ie').value, phone: $('#ip').value, status: segValue(app, 'st'), option_ids: $$('.opt-checks input:checked').map(function (x) { return Number(x.value); }), notes: $('#inote').value, edit_token: edit || undefined };
          api.request('POST', '/api/public/interest/' + token + '/respond', body).then(function (r) {
            Store.set('interest:' + token, r.edit_token);
            L.toast(r.status === 'waitlist' ? 'It’s full, so you’re on the waitlist' : 'Thanks. The organizer will be in touch.');
            C.route();
          }, function (err) { L.formError($('#irf'), err.message); });
        });
      });
    };

    /* ================= Team Planner ================= */
    var RSVP = { invited: 'Invited', in: 'In', out: 'Out', maybe: 'Maybe', waitlist: 'Waitlist' };
    function rsvpTag(r) { return '<span class="tag' + (r === 'in' ? ' ok' : r === 'waitlist' ? ' demo' : r === 'out' ? ' call' : '') + '">' + RSVP[r] + '</span>'; }
    function planRow(p) {
      return '<a class="li" href="#/coach/plans/' + p.id + '"><span class="main-col"><span class="t">' + h(p.title) + '</span><span class="d">' + h(fmtWhen(p.starts_at)) + (p.location ? ' · ' + h(p.location) : '') + ' · ' + p.counts.in + ' in' + (p.capacity ? ' of ' + p.capacity : '') + (p.counts.maybe ? ', ' + p.counts.maybe + ' maybe' : '') + (p.counts.waitlist ? ', ' + p.counts.waitlist + ' waiting' : '') + '</span></span><span class="side"><span class="tag' + (p.status === 'published' ? ' ok' : p.status === 'cancelled' ? ' call' : '') + '">' + h(p.status) + '</span></span></a>';
    }
    views.plans = function () {
      if (!has('coach')) return C.forbidden('Team Planner is for coaches.');
      return api.get('/api/plans').then(function (list) {
        var up = list.filter(function (p) { return p.status === 'draft' || p.status === 'published'; }), past = list.filter(function (p) { return p.status === 'done' || p.status === 'cancelled'; });
        app.innerHTML = '<a class="back" href="#/coach/desk">← Events desk</a>' + C.offlineNote(list) + head('Events desk', 'Team Planner', 'Coached sessions, small groups, clinics and training days.', '<a class="btn primary" href="#/coach/plans/new">New plan</a>') +
          '<div class="stack"><p class="section-title">Upcoming</p>' + (up.length ? '<div class="list">' + up.map(planRow).join('') + '</div>' : '<div class="list"><p class="empty">No plans yet.</p></div>') + '</div>' +
          (past.length ? '<div class="stack"><p class="section-title">Past</p><div class="list">' + past.map(planRow).join('') + '</div></div>' : '');
      });
    };
    views.planEdit = function (id) {
      if (!has('coach')) return C.forbidden('Team Planner is for coaches.');
      var isNew = id === 'new';
      return Promise.all([isNew ? Promise.resolve({ title: '', starts_at: null, ends_at: null, location: '', sport: 'Pickleball', coaches: ME().user.name, message: '', agenda: '', handoff: '', capacity: null, status: 'draft', blocks: [], version: 0 }) : api.get('/api/plans/' + id), api.get('/api/plan-library').then(null, function () { return []; })]).then(function (res) {
        var p = res[0], lib = res[1];
        var drills = lib.filter(function (x) { return x.kind === 'drill'; });
        var blocks = p.blocks.map(function (b) { return { start_time: b.start_time, end_time: b.end_time, court: b.court, lead: b.lead, drill: b.drill, instructions: b.instructions }; });
        app.innerHTML = '<a class="back" href="' + (isNew ? '#/coach/plans' : '#/coach/plans/' + id) + '">← ' + (isNew ? 'Team Planner' : 'Plan') + '</a>' + head('Team Planner', isNew ? 'New plan' : 'Edit plan') +
          '<form class="card form" id="pf" novalidate>' +
          '<div class="field"><label class="flabel" for="pt">Title</label><input type="text" id="pt" maxlength="120" value="' + h(p.title) + '" placeholder="Saturday small-group session"></div>' +
          '<div class="form-grid"><div class="field"><label class="flabel" for="pst">Starts</label><input type="datetime-local" id="pst" value="' + local(p.starts_at) + '"></div>' +
          '<div class="field"><label class="flabel" for="pen">Ends</label><input type="datetime-local" id="pen" value="' + local(p.ends_at) + '"></div>' +
          '<div class="field"><label class="flabel" for="ploc">Location</label><input type="text" id="ploc" maxlength="200" value="' + h(p.location) + '"></div></div>' +
          '<div class="form-grid"><div class="field"><label class="flabel" for="psp">Sport</label><input type="text" id="psp" maxlength="40" value="' + h(p.sport) + '"></div>' +
          '<div class="field"><label class="flabel" for="pco">Coaches</label><input type="text" id="pco" maxlength="200" value="' + h(p.coaches) + '"></div>' +
          '<div class="field"><label class="flabel" for="pcap">Capacity</label><input type="number" id="pcap" min="1" max="100" value="' + (p.capacity || '') + '" placeholder="No limit"></div>' +
          '<div class="field"><label class="flabel" for="pstat">Status</label><select id="pstat">' + [['draft', 'Draft (links don’t open yet)'], ['published', 'Published'], ['done', 'Done'], ['cancelled', 'Cancelled']].map(function (o) { return '<option value="' + o[0] + '"' + (p.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div></div>' +
          '<div class="field"><label class="flabel" for="pmsg">Message to players</label><textarea id="pmsg" maxlength="4000" placeholder="What to bring, what we’re working on.">' + h(p.message) + '</textarea></div>' +
          '<div class="field"><label class="flabel" for="pag">Agenda</label><textarea id="pag" maxlength="4000">' + h(p.agenda) + '</textarea></div>' +
          '<div class="stack-sm"><p class="flabel">Court blocks <span class="hint">up to 30</span></p><div id="blocks" class="stack-sm"></div><div class="row"><button class="btn sm ghost" type="button" id="addb">Add a block</button>' +
          (drills.length ? '<label class="sr-only" for="drillpick">Insert a saved drill</label><select id="drillpick"><option value="">Insert a saved drill…</option>' + drills.map(function (d) { return '<option value="' + d.id + '">' + h(d.name) + '</option>'; }).join('') + '</select>' : '') + '</div></div>' +
          '<div class="field private"><label class="flabel" for="pho">Private coaching handoff <span class="hint">only coaches see this</span></label><textarea id="pho" maxlength="4000" placeholder="Notes for the other coach: who needs what.">' + h(p.handoff) + '</textarea></div>' +
          '<div class="row"><button class="btn primary" type="submit">Save plan</button></div></form>';
        function paintBlocks() {
          $('#blocks').innerHTML = blocks.map(function (b, i) {
            return '<div class="block-row card"><div class="form-grid">' +
              '<div class="field"><label class="flabel" for="bs' + i + '">From</label><input type="time" id="bs' + i + '" data-i="' + i + '" data-f="start_time" value="' + h(b.start_time) + '"></div>' +
              '<div class="field"><label class="flabel" for="be' + i + '">To</label><input type="time" id="be' + i + '" data-i="' + i + '" data-f="end_time" value="' + h(b.end_time) + '"></div>' +
              '<div class="field"><label class="flabel" for="bc' + i + '">Court</label><input type="text" id="bc' + i + '" maxlength="40" data-i="' + i + '" data-f="court" value="' + h(b.court) + '"></div>' +
              '<div class="field"><label class="flabel" for="bl' + i + '">Lead</label><input type="text" id="bl' + i + '" maxlength="60" data-i="' + i + '" data-f="lead" value="' + h(b.lead) + '"></div></div>' +
              '<div class="field"><label class="flabel" for="bd' + i + '">Drill</label><input type="text" id="bd' + i + '" maxlength="120" data-i="' + i + '" data-f="drill" value="' + h(b.drill) + '"></div>' +
              '<div class="field"><label class="flabel" for="bi' + i + '">Instructions</label><textarea id="bi' + i + '" maxlength="2000" data-i="' + i + '" data-f="instructions">' + h(b.instructions) + '</textarea></div>' +
              '<div class="row"><button class="btn sm ghost" type="button" data-up="' + i + '"' + (i === 0 ? ' disabled' : '') + '>Move up</button><button class="btn sm ghost" type="button" data-save="' + i + '">Save drill</button><button class="btn sm danger" type="button" data-delb="' + i + '">Remove</button></div></div>';
          }).join('') || '<p class="small muted">No blocks yet. Add a block for each court and time slot.</p>';
          $$('#blocks [data-f]').forEach(function (inp) { inp.addEventListener('input', function () { blocks[+inp.getAttribute('data-i')][inp.getAttribute('data-f')] = inp.value; }); });
          $$('#blocks [data-delb]').forEach(function (b) { b.addEventListener('click', function () { blocks.splice(+b.getAttribute('data-delb'), 1); paintBlocks(); }); });
          $$('#blocks [data-up]').forEach(function (b) { b.addEventListener('click', function () { var i = +b.getAttribute('data-up'); var x = blocks.splice(i, 1)[0]; blocks.splice(i - 1, 0, x); paintBlocks(); }); });
          $$('#blocks [data-save]').forEach(function (b) { b.addEventListener('click', function () {
            var x = blocks[+b.getAttribute('data-save')];
            if (!x.drill) return L.toast('Name the drill first.');
            api.request('POST', '/api/plan-library', { kind: 'drill', name: x.drill, data: { drill: x.drill, instructions: x.instructions } }).then(function () { L.toast('Drill saved for reuse'); }, function (err) { L.toast(err.message); });
          }); });
        }
        paintBlocks();
        $('#addb').addEventListener('click', function () { if (blocks.length >= 30) return L.toast('Up to 30 blocks.'); var last = blocks[blocks.length - 1]; blocks.push({ start_time: last ? last.end_time : '', end_time: '', court: '', lead: '', drill: '', instructions: '' }); paintBlocks(); });
        if ($('#drillpick')) $('#drillpick').addEventListener('change', function () {
          var d = drills.filter(function (x) { return String(x.id) === $('#drillpick').value; })[0]; if (!d) return;
          if (blocks.length >= 30) return L.toast('Up to 30 blocks.');
          blocks.push({ start_time: '', end_time: '', court: '', lead: '', drill: d.data.drill, instructions: d.data.instructions }); paintBlocks(); $('#drillpick').value = '';
        });
        $('#pf').addEventListener('submit', function (ev) {
          ev.preventDefault();
          var body = { title: $('#pt').value, starts_at: fromLocal($('#pst').value) || null, ends_at: fromLocal($('#pen').value) || null, location: $('#ploc').value, sport: $('#psp').value, coaches: $('#pco').value, capacity: $('#pcap').value || null, status: $('#pstat').value,
            message: $('#pmsg').value, agenda: $('#pag').value, handoff: $('#pho').value, blocks: blocks, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
          if (!isNew) body.version = p.version;
          api.request(isNew ? 'POST' : 'PUT', '/api/plans' + (isNew ? '' : '/' + id), body).then(function (r) { L.toast('Plan saved'); location.hash = '#/coach/plans/' + r.id; }, function (err) {
            if (err.status === 409) L.formError($('#pf'), err.message + ' Open the plan again to see the changes.'); else L.formError($('#pf'), err.message);
          });
        });
      });
    };
    var openRecap = {};
    views.plan = function (id) {
      if (!has('coach')) return C.forbidden('Team Planner is for coaches.');
      return Promise.all([api.get('/api/plans/' + id), api.get('/api/plan-library').then(null, function () { return []; }), api.get('/api/athletes').then(null, function () { return []; })]).then(function (res) {
        var p = res[0], groups = res[1].filter(function (x) { return x.kind === 'group'; }), roster = res[2];
        var n = p.counts;
        app.innerHTML = '<a class="back" href="#/coach/plans">← Team Planner</a>' + C.offlineNote(p) +
          head('Team Planner · ' + p.status, p.title, fmtWhen(p.starts_at) + (p.ends_at ? '–' + fmtTimeOnly(p.ends_at) : '') + (p.location ? ' · ' + p.location : ''), '<div class="row"><a class="btn ghost" href="#/coach/plans/' + p.id + '/edit">Edit</a><button class="btn primary" type="button" id="invite">' + (p.status === 'draft' ? 'Publish and invite' : 'Send invitations') + '</button></div>') +
          '<div class="tiles"><div class="tile"><b class="big-num">' + n.in + (p.capacity ? '<span>/' + p.capacity + '</span>' : '') + '</b><span class="small">In</span></div><div class="tile"><b class="big-num">' + n.maybe + '</b><span class="small">Maybe</span></div><div class="tile"><b class="big-num">' + n.out + '</b><span class="small">Out</span></div><div class="tile"><b class="big-num">' + n.waitlist + '</b><span class="small">Waitlist</span></div><div class="tile"><b class="big-num">' + n.invited + '</b><span class="small">No answer</span></div></div>' +
          '<div class="grid-2"><div class="card stack"><p class="section-title">Session</p>' +
          (p.coaches ? '<p class="small">Coaches: ' + h(p.coaches) + '</p>' : '') + (p.message ? '<div class="small">' + L.paras(p.message) + '</div>' : '') + (p.agenda ? '<p class="small"><b>Agenda.</b> ' + h(p.agenda) + '</p>' : '') +
          (p.handoff ? '<div class="note private-note"><p class="body">' + h(p.handoff) + '</p><p class="meta"><span class="vis">Private handoff · coaches only</span></p></div>' : '') + '</div>' +
          '<div class="card stack"><p class="section-title">Court blocks</p>' + blocksTable(p.blocks, null) + '</div></div>' +
          '<div class="stack"><p class="section-title">Players · ' + p.players.length + '</p>' + (p.players.length ? '<div class="list">' + p.players.map(function (x) {
            var rec = x.recap_observation || x.recap_cue || x.recap_next;
            return '<div class="li person"><span class="main-col"><span class="t small">' + h(x.name) + ' ' + rsvpTag(x.rsvp) + (x.court ? ' <span class="tag">Court ' + h(x.court) + '</span>' : '') + (x.recap_published_at ? ' <span class="tag ok">Recap shared</span>' : rec ? ' <span class="tag">Recap draft</span>' : '') + '</span>' +
              '<span class="d">' + [x.email, x.phone, x.athlete_id ? 'LAB athlete' : ''].filter(Boolean).map(h).join(' · ') + '</span>' +
              '<span class="row"><button class="btn sm ghost" type="button" data-copy="' + h(abs(x.link)) + '">Copy invite link</button>' +
              '<a class="btn sm ghost" href="sms:' + h(x.phone || '') + '?&body=' + encodeURIComponent(p.title + ': ' + abs(x.link)) + '">Text</a>' +
              (x.email ? '<a class="btn sm ghost" href="mailto:' + h(x.email) + '?subject=' + encodeURIComponent('You’re invited: ' + p.title) + '&body=' + encodeURIComponent(abs(x.link)) + '">Email</a>' : '') +
              '<button class="btn sm ghost" type="button" data-rec="' + x.id + '">Recap</button></span>' +
              (openRecap[x.id] ? recapForm(x) : '') + '</span>' +
              '<span class="side stack-sm"><label class="sr-only" for="rs' + x.id + '">Answer for ' + h(x.name) + '</label><select id="rs' + x.id + '" data-rsvp="' + x.id + '">' + Object.keys(RSVP).map(function (k) { return '<option value="' + k + '"' + (x.rsvp === k ? ' selected' : '') + '>' + RSVP[k] + '</option>'; }).join('') + '</select>' +
              '<label class="sr-only" for="ct' + x.id + '">Court for ' + h(x.name) + '</label><input type="text" id="ct' + x.id + '" data-court="' + x.id + '" value="' + h(x.court) + '" placeholder="Court" maxlength="40" class="court-in">' +
              '<button class="btn sm danger" type="button" data-delp="' + x.id + '">Remove</button></span></div>';
          }).join('') + '</div>' : '<div class="list"><p class="empty">No players yet.</p></div>') + '</div>' +
          '<form class="card form" id="addf" novalidate><p class="section-title">Add players</p>' +
          (roster.length ? '<div class="field"><label class="flabel" for="fromroster">From your athletes</label><select id="fromroster"><option value="">Choose an athlete…</option>' + roster.map(function (a) { return '<option value="' + a.id + '">' + h(a.name) + '</option>'; }).join('') + '</select></div>' : '') +
          '<div class="form-grid"><div class="field"><label class="flabel" for="an">Name</label><input type="text" id="an" maxlength="60"></div><div class="field"><label class="flabel" for="ae">Email</label><input type="email" id="ae" maxlength="200"></div><div class="field"><label class="flabel" for="ap">Phone</label><input type="tel" id="ap" maxlength="30"></div></div>' +
          '<div class="row"><button class="btn primary" type="submit">Add player</button>' +
          (groups.length ? '<label class="sr-only" for="grp">Add a saved group</label><select id="grp"><option value="">Add a saved group…</option>' + groups.map(function (g) { return '<option value="' + g.id + '">' + h(g.name) + ' (' + g.data.length + ')</option>'; }).join('') + '</select>' : '') +
          (p.players.length ? '<button class="btn ghost" type="button" id="savegrp">Save these players as a group</button>' : '') + '</div><p class="small muted">Up to 100 players. Each gets their own invitation link to answer In, Out or Maybe.</p></form>' +
          '<div class="card stack"><p class="section-title">Run it live</p>' + (p.event_id && p.event_live ? '<p class="small">This plan has a live event.</p><div class="row"><a class="btn primary" href="#/play/events/' + p.event_id + '">Open the event</a></div>' :
            '<p class="small muted">Turn this plan into a live event for games: everyone who said In is registered, and players without an account get a player link.</p><div class="row"><label class="sr-only" for="evmode">Format</label><select id="evmode">' + Object.keys(MODES).map(function (k) { return '<option value="' + k + '">' + MODES[k] + '</option>'; }).join('') + '</select><button class="btn" type="button" id="mkev">Create live event</button></div>') + '</div>' +
          '<div class="row"><button class="btn sm ghost" type="button" id="pcsv">Export players (CSV)</button><button class="btn sm danger" type="button" id="pdel">Delete plan</button></div>';
        bindShare(app);
        $('#invite').addEventListener('click', function () {
          api.request('POST', '/api/plans/' + p.id + '/invite', {}).then(function (r) {
            L.toast(r.mail ? r.sent + ' invitation' + (r.sent === 1 ? '' : 's') + ' emailed. Copy links for anyone without email.' : 'Published. Email isn’t set up, so copy or text each player’s link.');
            C.route();
          }, function (err) { L.toast(err.message); });
        });
        var putPlayer = function (pid, body, msg) { return api.request('PUT', '/api/plans/' + p.id + '/players/' + pid, body).then(function () { if (msg) L.toast(msg); C.route(); }, function (err) { L.toast(err.message); }); };
        $$('[data-rsvp]').forEach(function (s) { s.addEventListener('change', function () { putPlayer(s.getAttribute('data-rsvp'), { rsvp: s.value }, 'Updated'); }); });
        $$('[data-court]').forEach(function (s) { s.addEventListener('change', function () { putPlayer(s.getAttribute('data-court'), { court: s.value }, 'Court saved'); }); });
        $$('[data-delp]').forEach(function (b) { L.armed(b, 'Remove?', function () { api.request('DELETE', '/api/plans/' + p.id + '/players/' + b.getAttribute('data-delp')).then(C.route, function (err) { L.toast(err.message); }); }); });
        $$('[data-rec]').forEach(function (b) { b.addEventListener('click', function () { var k = b.getAttribute('data-rec'); openRecap[k] = !openRecap[k]; C.route(); }); });
        $$('.recap-form').forEach(function (f) {
          var pid = f.getAttribute('data-pid');
          var vals = function () { return { recap_observation: $('[data-r="o"]', f).value, recap_cue: $('[data-r="c"]', f).value, recap_next: $('[data-r="n"]', f).value }; };
          f.addEventListener('submit', function (ev) { ev.preventDefault(); putPlayer(pid, vals(), 'Recap saved'); });
          $$('[data-pub]', f).forEach(function (b) { b.addEventListener('click', function () {
            var pub = b.getAttribute('data-pub') === '1';
            api.request('PUT', '/api/plans/' + p.id + '/players/' + pid, vals()).then(function () { return api.request('POST', '/api/plans/' + p.id + '/players/' + pid + '/recap', { publish: pub }); })
              .then(function () { L.toast(pub ? 'Recap shared with the player' : 'Recap hidden'); C.route(); }, function (err) { L.toast(err.message); });
          }); });
        });
        if ($('#fromroster')) $('#fromroster').addEventListener('change', function () { var a = roster.filter(function (x) { return String(x.id) === $('#fromroster').value; })[0]; if (a) $('#an').value = a.name; });
        $('#addf').addEventListener('submit', function (ev) {
          ev.preventDefault();
          var pl = $('#fromroster') && $('#fromroster').value ? { athlete_id: Number($('#fromroster').value), name: $('#an').value, email: $('#ae').value, phone: $('#ap').value } : { name: $('#an').value, email: $('#ae').value, phone: $('#ap').value };
          api.request('POST', '/api/plans/' + p.id + '/players', { players: [pl] }).then(function () { L.toast('Added'); C.route(); }, function (err) { L.formError($('#addf'), err.message); });
        });
        if ($('#grp')) $('#grp').addEventListener('change', function () {
          var g = groups.filter(function (x) { return String(x.id) === $('#grp').value; })[0]; if (!g) return;
          api.request('POST', '/api/plans/' + p.id + '/players', { players: g.data }).then(function () { L.toast(g.data.length + ' added from ' + g.name); C.route(); }, function (err) { L.toast(err.message); });
        });
        if ($('#savegrp')) $('#savegrp').addEventListener('click', function () {
          var name = window.prompt('Name this group', p.title + ' group'); if (!name) return;
          api.request('POST', '/api/plan-library', { kind: 'group', name: name, data: p.players.map(function (x) { return { name: x.name, email: x.email, phone: x.phone, athlete_id: x.athlete_id || undefined }; }) }).then(function () { L.toast('Group saved'); }, function (err) { L.toast(err.message); });
        });
        if ($('#mkev')) $('#mkev').addEventListener('click', function () {
          api.request('POST', '/api/plans/' + p.id + '/event', { mode: $('#evmode').value }).then(function (r) { L.toast('Live event created. Everyone who said In is registered.'); location.hash = '#/play/events/' + r.event_id; }, function (err) { L.toast(err.message); });
        });
        $('#pcsv').addEventListener('click', function () {
          download(slug(p.title) + '-players.csv', csv([['Name', 'Email', 'Phone', 'Answer', 'Court', 'Invite link', 'Observation', 'Cue', 'Next task']].concat(p.players.map(function (x) { return [x.name, x.email, x.phone, RSVP[x.rsvp], x.court, abs(x.link), x.recap_observation, x.recap_cue, x.recap_next]; }))), 'text/csv');
        });
        L.armed($('#pdel'), 'Tap again to delete', function () { api.request('DELETE', '/api/plans/' + p.id).then(function () { L.toast('Plan deleted'); location.hash = '#/coach/plans'; }); });
      });
      function recapForm(x) {
        return '<form class="recap-form stack-sm" data-pid="' + x.id + '" novalidate>' +
          '<div class="field"><label class="flabel" for="ro' + x.id + '">One observation</label><textarea id="ro' + x.id + '" data-r="o" maxlength="1000">' + h(x.recap_observation) + '</textarea></div>' +
          '<div class="field"><label class="flabel" for="rc' + x.id + '">One cue</label><input type="text" id="rc' + x.id + '" data-r="c" maxlength="1000" value="' + h(x.recap_cue) + '"></div>' +
          '<div class="field"><label class="flabel" for="rn' + x.id + '">One next task</label><input type="text" id="rn' + x.id + '" data-r="n" maxlength="1000" value="' + h(x.recap_next) + '"></div>' +
          '<div class="row"><button class="btn sm" type="submit">Save draft</button>' + (x.recap_published_at ? '<button class="btn sm ghost" type="button" data-pub="0">Hide from player</button>' : '<button class="btn sm primary" type="button" data-pub="1">Share with player</button>') + '</div></form>';
      }
    };
    function blocksTable(bs, myCourt) {
      if (!bs.length) return '<p class="small muted">No court blocks.</p>';
      return '<div class="table-wrap" tabindex="0" role="region" aria-label="Courts and drills table"><table class="summary-table"><thead><tr><th>Time</th><th>Court</th><th>Lead</th><th>Drill</th></tr></thead><tbody>' + bs.map(function (b) {
        var mine = myCourt && b.court && String(b.court).toLowerCase() === String(myCourt).toLowerCase();
        return '<tr' + (mine ? ' class="me"' : '') + '><td class="n">' + h(b.start_time) + (b.end_time ? '–' + h(b.end_time) : '') + '</td><td>' + h(b.court) + '</td><td>' + h(b.lead) + '</td><td>' + h(b.drill) + (b.instructions ? '<br><span class="small muted">' + h(b.instructions) + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    }
    /* The page a player opens from their invitation link. */
    views.invite = function (token) {
      return api.get('/api/i/' + token).then(function (d) {
        var p = d.plan, me = d.me;
        var closed = p.status === 'done' || p.status === 'cancelled';
        app.innerHTML = head('Invitation for ' + me.name, p.title, fmtWhen(p.starts_at) + (p.ends_at ? '–' + fmtTimeOnly(p.ends_at) : '') + (p.location ? ' · ' + p.location : '')) + C.offlineNote(d) +
          (p.status === 'cancelled' ? '<p class="flag">This session was cancelled.</p>' : '') +
          (me.recap ? '<div class="focus-card"><p class="eyebrow">Your recap</p>' + (me.recap.observation ? '<p class="small" style="opacity:.85"><b>Observation.</b> ' + h(me.recap.observation) + '</p>' : '') + (me.recap.cue ? '<p class="big">' + h(me.recap.cue) + '</p>' : '') + (me.recap.next ? '<p class="small" style="opacity:.85"><b>Next.</b> ' + h(me.recap.next) + '</p>' : '') + '</div>' : '') +
          '<div class="card stack"><p class="section-title">Are you in?</p>' +
          (me.rsvp === 'waitlist' ? '<p class="small">It’s full. You’re on the waitlist and move in automatically if a spot opens.</p>' : me.rsvp !== 'invited' ? '<p class="small">Your answer: <b>' + RSVP[me.rsvp] + '</b>' + (me.court ? ' · Court ' + h(me.court) : '') + '</p>' : '') +
          (closed ? '' : '<div class="seg-btns rsvp" data-k="rsvp">' + ['in', 'maybe', 'out'].map(function (k) { return '<button type="button" data-v="' + k + '" aria-pressed="' + (me.rsvp === k || (k === 'in' && me.rsvp === 'waitlist')) + '">' + RSVP[k] + '</button>'; }).join('') + '</div>') +
          '<p class="small muted">' + p.counts.in + ' in' + (p.capacity ? ' of ' + p.capacity : '') + (p.spots_left === 0 ? ' · full' : p.spots_left ? ' · ' + p.spots_left + ' spots left' : '') + '</p></div>' +
          '<div class="card stack"><p class="section-title">The session</p>' + (p.coaches ? '<p class="small">Coaches: ' + h(p.coaches) + '</p>' : '') + (p.message ? '<div class="small">' + L.paras(p.message) + '</div>' : '') + (p.agenda ? '<p class="small"><b>Agenda.</b> ' + h(p.agenda) + '</p>' : '') +
          (p.timezone ? '<p class="small muted">Times shown in your time zone. Organizer’s time zone: ' + h(p.timezone) + '.</p>' : '') + '<div class="row">' + calendarButton() + '</div></div>' +
          (p.blocks.length ? '<div class="card stack"><p class="section-title">Courts and drills</p>' + blocksTable(p.blocks, me.court) + '</div>' : '');
        bindCalendar({ uid: 'plan-' + token.slice(0, 12), title: p.title, starts_at: p.starts_at, ends_at: p.ends_at, location: p.location, description: p.message });
        bindSeg(app, function (k, v) {
          api.request('POST', '/api/i/' + token + '/rsvp', { rsvp: v }).then(function (r) { L.toast(r.me.rsvp === 'waitlist' ? 'It’s full: you’re on the waitlist' : 'Thanks, you’re ' + RSVP[r.me.rsvp].toLowerCase()); C.route(); }, function (err) { L.toast(err.message); C.route(); });
        });
      });
    };

    /* ---------- routes ---------- */
    C.routes.push(
      [/^\/e\/([a-f0-9]{32})$/, 'shareEvent', '', true], [/^\/watch\/([a-f0-9]{32})$/, 'watchEvent', '', true], [/^\/g\/([a-f0-9]{32})$/, 'guest', '', true],
      [/^\/interest\/([a-f0-9]{32})$/, 'interestPublic', '', true], [/^\/i\/([a-f0-9]{32})$/, 'invite', '', true],
      [/^\/coach\/desk$/, 'desk', 'home'], [/^\/coach\/interest$/, 'interestList', 'home'], [/^\/coach\/interest\/(new)$/, 'interestEdit', 'home'], [/^\/coach\/interest\/(\d+)\/edit$/, 'interestEdit', 'home'], [/^\/coach\/interest\/(\d+)$/, 'interest', 'home'],
      [/^\/coach\/plans$/, 'plans', 'home'], [/^\/coach\/plans\/(new)$/, 'planEdit', 'home'], [/^\/coach\/plans\/(\d+)\/edit$/, 'planEdit', 'home'], [/^\/coach\/plans\/(\d+)$/, 'plan', 'home']
    );
  });
})();
