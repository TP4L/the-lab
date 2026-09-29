/* Player experience. Uses existing access-controlled records and upload APIs. */
(function () {
  'use strict';
  window.LabPlugins = window.LabPlugins || [];
  window.LabPlugins.push(function (ctx) {
    const L = window.Lab, h = L.h, api = L.api;
    const root = () => document.getElementById('app');
    const date = value => { const d = new Date(value); return value && !isNaN(d) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date to be confirmed'; };
    const link = (url, label, cls = '') => '<a class="btn ' + cls + '" href="' + h(url) + '">' + h(label) + '</a>';
    const empty = (title, body, action = '') => '<div class="journey-empty"><span class="journey-mark" aria-hidden="true">↗</span><h3>' + h(title) + '</h3><p>' + h(body) + '</p>' + action + '</div>';
    const tabs = active => '<nav class="journey-tabs" aria-label="Your development">' + [['overview', 'Overview'], ['sessions', 'Sessions'], ['videos', 'Videos'], ['notes', 'Notes'], ['feedback', 'Ask & reflect']].map(([key, label]) => '<a href="' + (key === 'overview' ? '#/' : '#/journey/' + key) + '"' + (active === key ? ' aria-current="page"' : '') + '>' + label + '</a>').join('') + '</nav>';
    const heading = (title, body, action = '') => '<div class="journey-heading"><div><p class="eyebrow">Your player space</p><h1>' + h(title) + '</h1><p>' + h(body) + '</p></div>' + action + '</div>';
    function mount(html) { const host = document.createElement('div'); host.className = 'journey'; host.innerHTML = html; root().replaceChildren(host); return host; }
    async function profile() { const me = await api.get('/api/me'); ctx.setMe(me); return me.athlete_id ? api.get('/api/athletes/' + me.athlete_id) : null; }
    function noteCard(n) {
      return '<article class="journey-note"><div class="journey-meta"><span class="tag">' + (n.kind === 'coach' ? 'Coach note' : /^Question\n/.test(n.body) ? 'Question' : /^Feedback\n/.test(n.body) ? 'Feedback' : 'Reflection') + '</span><time>' + h(date(n.created_at)) + '</time></div><p class="journey-copy">' + h(n.body) + '</p>' + (n.media_id ? mediaCard({ id: n.media_id, mime: n.media_mime || 'image/jpeg', created_at: n.created_at }, 'Attached to this note') : '') + '<p class="small muted">' + h(n.author || 'Your coach') + '</p></article>';
    }
    function mediaCard(m, title) {
      const video = m.mime.startsWith('video/');
      return '<figure class="journey-media">' + (video ? '<video controls playsinline preload="none" aria-label="' + h(title || 'Training video') + '" src="/api/media/' + h(m.id) + '"></video>' : '<img loading="lazy" alt="' + h(title || 'Training photo') + '" src="/api/media/' + h(m.id) + '">') + '<figcaption><span class="tag">' + (video ? 'Video' : 'Photo') + '</span><b>' + h(title || (video ? 'Training video' : 'Training photo')) + '</b><span>' + h(date(m.created_at)) + '</span></figcaption></figure>';
    }
    function sessions(rows) {
      return rows.length ? '<div class="journey-timeline">' + rows.map(s => '<a class="journey-session" href="#/train/' + h(s.id || s.session_id) + '"><span class="journey-session-dot" aria-hidden="true"></span><div><p class="journey-meta">' + h(date(s.started_at)) + ' <span class="tag' + (s.status === 'live' ? ' call' : '') + '">' + (s.status === 'live' ? 'Live now' : 'Session recap') + '</span></p><h3>' + h(s.title) + '</h3><p>' + (s.items ? h(s.items.map(i => i.name).join(' · ')) : 'Open your training details and results') + '</p></div><span aria-hidden="true">↗</span></a>').join('') + '</div>' : empty('Your story starts on court.', 'Recorded sessions will appear here with the details you can revisit.', link('#/train', 'Open training'));
    }
    ctx.views.home = async function () {
      const hash = location.hash;
      const d = await api.get('/api/home');
      if (location.hash !== hash) return;
      const me = ctx.me(), first = me.user.name.split(' ')[0];
      const upcoming = d.events.filter(e => e.status === 'live' || new Date(e.starts_at) >= new Date());
      const next = upcoming.find(e => e.status === 'live') || upcoming[0];
      let staff = '';
      if (ctx.has('coach')) staff += link('#/coach', 'Coach workspace') + link('#/coach/desk', 'Events desk') + link('#/train/new', 'Start session');
      if (ctx.has('contributor', 'editor')) staff += link('#/studio', 'Publishing studio');
      if (ctx.has('admin')) staff += link('#/admin', 'Admin');
      mount(ctx.offlineNote(d));
      const host = root().firstChild;
      host.innerHTML += heading('Keep building, ' + first + '.', 'Your next step. Your work so far. All in one place.', link('#/journey/feedback', '+ Ask your coach', 'primary')) + tabs('overview') +
        '<section class="journey-hero"><div><p class="eyebrow">' + (next && next.status === 'live' ? 'Happening now' : 'Up next') + '</p><h2>' + h(next ? next.title : 'Make your next session count.') + '</h2><p>' + h(next ? ctx.fmtEventTime(next) + ' · ' + (next.location || 'Location to be confirmed') : 'Bring a question. Revisit a coaching note. Step on court with a clear intention.') + '</p><div class="row">' + (next ? link('#/play/events/' + next.id, 'View event →', 'primary') + '<span class="journey-status">' + h(next.state === 'waitlist' ? 'On the waitlist' : next.state === 'interested' ? 'Interest submitted' : 'Registered') + '</span>' : link('#/play/events', 'Explore events →', 'primary')) + '</div></div><div class="journey-court" aria-hidden="true"><i></i><span>THE LAB<br><b>BUILD YOUR GAME.</b></span></div></section>' +
        (d.to_confirm ? '<div class="banner"><span>' + d.to_confirm + ' match scores to review</span>' + link('#/play', 'Review scores') + '</div>' : '') +
        '<div class="journey-shortcuts">' + [['sessions', '01', 'Your sessions', 'Revisit the work'], ['videos', '02', 'Video room', 'Watch. Notice. Improve.'], ['notes', '03', 'Coaching notes', 'Keep the cues close'], ['feedback', '04', 'Ask & reflect', 'Keep the conversation going']].map(([key, n, title, sub]) => '<a href="#/journey/' + key + '"><span class="eyebrow">' + n + ' <span aria-hidden="true">↗</span></span><h3>' + title + '</h3><p>' + sub + '</p></a>').join('') + '</div>' +
        '<div class="journey-columns"><section class="stack"><div class="journey-section"><h2>Recently on court</h2><a href="#/journey/sessions">All sessions ↗</a></div>' + sessions(d.sessions.slice(0, 3)) + '</section><aside class="journey-focus"><p class="eyebrow">Your training intention</p><h2>' + h(d.athlete && d.athlete.focus || 'One clear focus changes the session.') + '</h2><p>' + h(d.athlete && d.athlete.goals || 'Review your plan, then choose what to pay attention to next time you play.') + '</p>' + link('#/profile', 'My development →') + link('#/website', 'Connected website coaching') + '</aside></div>' +
        '<section class="stack"><div class="journey-section"><h2>From your coach</h2><a href="#/journey/notes">All notes ↗</a></div><div class="journey-notes">' + (d.shared_notes.length ? d.shared_notes.slice(0, 2).map(n => noteCard(Object.assign({kind:'coach'}, n))).join('') : empty('The conversation belongs here.', 'Your shared coaching notes will appear as your coach adds them.', link('#/journey/feedback', 'Start with a question'))) + '</div></section>' +
        '<section class="stack"><div class="journey-section"><h2>On the horizon</h2><a href="#/play/events">Browse events ↗</a></div>' + (upcoming.length ? '<div class="list">' + upcoming.map(e => ctx.eventRow(Object.assign({}, e, {my_state:e.state}))).join('') + '</div>' : empty('Room for what’s next.', 'Browse open events to find your next opportunity to play.')) + '</section>' +
        '<section id="journey-assignments" class="stack"></section>' +
        (staff ? '<details class="more journey-staff"><summary>Staff workspace</summary><div class="row">' + staff + '</div></details>' : '');
      if (me.athlete_id) api.get('/api/me/assignments').then(items => {
        if (!host.isConnected) return;
        const open = items.filter(a => a.status === 'open');
        if (open.length) host.querySelector('#journey-assignments').innerHTML = '<div class="journey-section"><h2>Your next practice</h2><a href="#/train">View assignments ↗</a></div><div class="journey-notes">' + open.slice(0, 4).map(a => '<article class="journey-note"><p class="eyebrow">' + h(a.due_on ? 'Due ' + date(a.due_on + 'T12:00:00') : 'Assigned to you') + '</p><h3>' + h(a.title) + '</h3><p>' + h(a.note || 'Open training to review this assignment.') + '</p>' + link('#/train', 'Review practice →') + '</article>').join('') + '</div>';
      }, () => {});
    };
    const originalProfile = ctx.views.profile;
    ctx.views.profile = async function () {
      await originalProfile();
      if (!location.hash.startsWith('#/profile')) return;
      const welcome = document.createElement('div');
      welcome.className = 'journey';
      welcome.innerHTML = '<div class="journey-section"><h2>Your player space</h2>' + link('#/', 'Open my dashboard →', 'primary') + '</div>' + tabs('');
      root().prepend(welcome);
    };
    ctx.routes.push([/^\/journey\/(sessions|videos|notes|feedback)$/, 'journey', 'home']);
    ctx.views.journey = async function (section) {
      const hash = location.hash;
      const p = await profile();
      if (location.hash !== hash) return;
      const titles = { sessions: ['The work, remembered.', 'Return to a session. Find the detail that moves you forward.'], videos: ['See your game differently.', 'Your training videos and photos, ready when you are.'], notes: ['The cues that stay with you.', 'Coaching notes, questions, and reflections from your app profile.'], feedback: ['Good questions build better players.', 'Bring your coach into what you’re noticing.'] };
      const host = mount(heading(titles[section][0], titles[section][1], section === 'videos' ? link('#/journey/feedback?type=video', '+ Upload a clip', 'primary') : '') + tabs(section) + ctx.offlineNote(p));
      if (!p) { host.innerHTML += empty('Let’s connect your player profile.', 'Your sessions, media, and notes belong to your athlete profile.', link('#/profile', 'Set up my profile', 'primary')); return; }
      if (section === 'sessions') {
        host.innerHTML += '<div class="journey-section"><h2>Session timeline</h2>' + link('#/train', 'All training') + '</div><label class="flabel" for="journey-search">Find a session</label><input id="journey-search" type="search" placeholder="Search by session or drill"><div id="journey-results"></div>';
        const results = host.querySelector('#journey-results');
        const paint = term => { const matches = p.results.filter(s => (s.title + ' ' + s.items.map(i => i.name).join(' ')).toLowerCase().includes(term)); results.innerHTML = matches.length || !term ? sessions(matches) : empty('No matching sessions.', 'Try a different title or drill.'); };
        paint(''); host.querySelector('input').oninput = e => paint(e.target.value.toLowerCase().trim());
      } else if (section === 'videos') {
        host.innerHTML += '<div class="journey-section"><h2>Your video room</h2><label class="small">Show <select id="media-filter"><option value="all">All media</option><option value="video/">Videos</option><option value="image/">Photos</option></select></label></div><div id="journey-gallery"></div>';
        const paint = kind => { const media = p.media.filter(m => m.id !== p.athlete.photo_media_id && (kind === 'all' || m.mime.startsWith(kind))); host.querySelector('#journey-gallery').innerHTML = media.length ? '<div class="journey-gallery">' + media.map(m => { const note = p.notes.find(n => n.media_id === m.id); return mediaCard(m, note ? note.body.replace(/^(Question|Feedback|Reflection|Video review)\n/, '').slice(0, 100) : ''); }).join('') + '</div>' : empty('Your next breakthrough might be on video.', 'Upload a clip with a question so your coach knows what to look for.', link('#/journey/feedback?type=video', 'Upload your first clip', 'primary')); };
        paint('all'); host.querySelector('select').onchange = e => paint(e.target.value);
      } else if (section === 'notes') {
        host.innerHTML += '<div class="journey-section"><h2>Your conversation</h2><label class="small">Show <select id="notes-filter"><option value="all">All notes</option><option value="coach">From coach</option><option value="reflection">From you</option></select></label></div><p class="small muted">Looking for your connected website notes? <a href="#/website">Open website coaching →</a></p><div id="journey-notes"></div>';
        const paint = kind => { const notes = p.notes.filter(n => kind === 'all' || n.kind === kind); host.querySelector('#journey-notes').innerHTML = notes.length ? '<div class="journey-notes">' + notes.map(noteCard).join('') + '</div>' : empty('Make space for the conversation.', 'Questions, reflections, and shared coaching notes appear here.', link('#/journey/feedback', 'Add a question')); };
        paint('all'); host.querySelector('select').onchange = e => paint(e.target.value);
      } else composer(host, p);
    };
    function composer(host, p) {
      host.innerHTML += '<div class="journey-columns"><form class="card form journey-compose"><label class="flabel" for="message-type">What would you like to share?</label><select id="message-type"><option>Question</option><option>Feedback</option><option>Reflection</option><option>Video review</option></select><label class="flabel" for="message-session">Related session (optional)</label><select id="message-session"><option value="">General / upcoming training</option>' + p.results.map(s => '<option value="' + h(s.session_id) + '">' + h(s.title) + ' · ' + h(date(s.started_at)) + '</option>').join('') + '</select><label class="flabel" for="message-body">What are you noticing?</label><textarea id="message-body" required maxlength="4900" rows="6" placeholder="What happened? What would you like help with?"></textarea><label class="journey-upload" for="message-file"><b>Attach a video or photo</b><span>Choose a file · up to 200 MB</span><input id="message-file" type="file" accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp,image/gif,image/heic"></label><p class="small muted" id="file-description"></p><progress id="message-progress" max="100" value="0" hidden aria-label="Upload progress"></progress><p class="small muted">Saved to your app profile and visible to your app coaching team. <a href="#/website">Send a website coaching reflection instead →</a></p><button class="btn primary" type="submit">Save to my coaching notes ↗</button><p id="message-status" role="status" aria-live="polite"></p></form><aside class="journey-focus"><p class="eyebrow">A useful reflection</p><h2>Notice it.<br>Name it.<br>Build on it.</h2><p>What worked today?</p><p>Where did you feel rushed or unsure?</p><p>What would you like to try next?</p><p class="small">For video, include a timestamp and one specific question.</p></aside></div>';
      const form = host.querySelector('form'), type = host.querySelector('#message-type'), body = host.querySelector('#message-body'), file = host.querySelector('#message-file'), status = host.querySelector('#message-status'), progress = host.querySelector('progress');
      if (location.hash.includes('type=video')) type.value = 'Video review';
      let uploaded = null, uploadId = L.uuid(), clientId = L.uuid(), pending = null;
      file.onchange = () => { uploaded = null; uploadId = L.uuid(); host.querySelector('#file-description').textContent = file.files[0] ? file.files[0].name + ' · ' + (file.files[0].size / 1048576).toFixed(1) + ' MB' : ''; };
      form.onsubmit = async e => {
        e.preventDefault();
        const f = file.files[0];
        if (!body.value.trim()) { body.reportValidity(); return; }
        if (f && f.size > 200 * 1024 * 1024) { status.textContent = 'Choose a file smaller than 200 MB. Your message is still here.'; return; }
        const controls = Array.from(form.querySelectorAll('button,input,select,textarea'));
        controls.forEach(c => c.disabled = true);
        try {
          if (f && !uploaded) { progress.hidden = false; status.textContent = 'Uploading your attachment…'; uploaded = await api.upload(f, 'athlete_id=' + p.athlete.id + '&visibility=shared', x => progress.value = Math.round(x * 100), uploadId); }
          pending = pending || { body: type.value + '\n' + body.value.trim(), client_id: clientId, session_id: host.querySelector('#message-session').value || undefined, media_id: uploaded ? uploaded.id : undefined };
          status.textContent = 'Saving your note…';
          await api.request('POST', '/api/athletes/' + p.athlete.id + '/notes', pending);
          form.reset(); uploaded = null; pending = null; uploadId = L.uuid(); clientId = L.uuid(); progress.hidden = true; host.querySelector('#file-description').textContent = '';
          status.innerHTML = 'Saved to your coaching notes. <a href="#/journey/notes">View your note →</a>';
        } catch (err) { status.textContent = (err.message || 'Could not save.') + ' Your message is still here. Retry to finish saving the same note.'; }
        finally { controls.forEach(c => c.disabled = false); if (pending) { controls.filter(c => c.tagName !== 'BUTTON').forEach(c => c.disabled = true); } }
      };
    }
  });
})();
