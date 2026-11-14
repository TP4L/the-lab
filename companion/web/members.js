/* Owner welcome queue. Member contact information is fetched online, never cached. */
(function () {
  'use strict';
  window.LabPlugins = window.LabPlugins || [];
  window.LabPlugins.push(function (ctx) {
    const L = window.Lab, api = L.api;
    const root = () => document.getElementById('app');
    const h = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const date = value => new Date(value).toLocaleString();
    const emailState = value => ({pending:'Email queued',sent:'Email sent',failed:'Email needs attention'}[value] || 'Earlier member');
    function page(title, copy) {
      const host = document.createElement('div'); host.className = 'journey';
      host.innerHTML = '<a class="back" href="#/coach/today">← Coaching dashboard</a>' + ctx.head('Member welcome', title, copy);
      root().replaceChildren(host); return host;
    }
    ctx.routes.push([/^\/admin\/members$/, 'members', 'home'], [/^\/admin\/members\/(\d+)$/, 'member', 'home']);
    ctx.views.members = async function () {
      if (!ctx.has('admin')) return ctx.forbidden('Member signups are for administrators.');
      const host = page('New members', 'Welcome them, review their profile and set a useful next step.');
      const d = await api.request('GET', '/api/admin/members'); if (!host.isConnected) return;
      host.innerHTML += '<section class="card stack"><h2>' + d.unreviewed + ' waiting for review</h2><p>' +
        (d.alerts.email_enabled ? 'New signup emails go to <strong>' + h(d.alerts.recipient) + '</strong>.' : 'Signup emails need attention. Contact the app owner to check email delivery.') + '</p><p class="small muted">' +
        (d.alerts.phone_enabled ? 'Phone alerts are enabled on a device for the owner.' : 'For phone alerts, open THE LAB on your phone and enable Phone notifications in Profile.') +
        ' Signup emails are sent individually, separately from your daily digest.</p>' +
        (d.alerts.failed ? '<p role="alert">' + d.alerts.failed + ' signup email(s) need delivery review. The member records are available below.</p>' : '') +
        '<div class="row"><a class="btn" href="#/profile#prefs">Notification settings</a><button class="btn ghost" id="members-refresh">Refresh</button></div></section>' +
        '<label class="flabel" for="member-search">Find a member</label><input id="member-search" type="search" placeholder="Name or email"><p class="small muted">Newest 100 accounts. <a href="#/admin">Search all people</a></p><div class="list" id="member-list"></div>';
      const paint = () => {
        const term = host.querySelector('#member-search').value.trim().toLowerCase();
        const rows = d.items.filter(u => (u.name + ' ' + u.email).toLowerCase().includes(term));
        host.querySelector('#member-list').innerHTML = rows.map(u => '<a class="li" href="#/admin/members/' + u.id + '"><span class="main-col"><span class="t">' + h(u.name) + '</span><span class="d">' + h(u.email) + ' · ' + h(date(u.created_at)) + '</span><span class="small muted">' + h(emailState(u.email_state)) + ' · ' + (u.athlete_id ? 'Profile ready' : 'Profile not set up') + '</span></span><span class="tag">' + (u.reviewed_at ? 'Reviewed' : u.email_state ? 'Needs welcome' : 'Open member') + '</span></a>').join('') || '<p>No matching members.</p>';
      };
      host.querySelector('#members-refresh').onclick = ctx.views.members;
      host.querySelector('#member-search').oninput = paint; paint();
    };
    ctx.views.member = async function (id) {
      if (!ctx.has('admin')) return ctx.forbidden('Member records are for administrators.');
      const host = page('Member record', 'Loading their account and coaching profile…');
      const d = await api.request('GET', '/api/admin/members/' + id); if (!host.isConnected) return;
      const u = d.member;
      host.innerHTML = '<a class="back" href="#/admin/members">← New members</a>' + ctx.head('Member welcome', u.name, 'Joined ' + date(u.created_at)) +
        '<section class="card stack"><p><b>Email</b> · ' + h(u.email) + '</p><div class="row"><a class="btn" href="mailto:' + h(encodeURIComponent(u.email)) + '?subject=Welcome%20to%20THE%20LAB">Write a welcome email</a>' +
        (d.signup ? '<button class="btn ghost" id="member-reviewed"' + (d.signup.reviewed_at ? ' disabled' : '') + '>' + (d.signup.reviewed_at ? 'Reviewed' : 'Mark reviewed') + '</button>' : '') + '</div><p role="status" id="member-status"></p></section>' +
        (d.welcome && d.welcome.completed_at ? '<section class="card stack"><h2>What they shared at signup</h2><p><b>Sport or activity</b> · ' + h(d.welcome.sport || 'Not specified') + '</p><p><b>What they want to work on</b></p><p class="journey-copy">' + h(d.welcome.goals || 'Not specified') + '</p>' + (d.welcome.connection === 'later' && !d.athlete ? '<p class="flag">They chose to connect their coaching history later. Check for an earlier record before creating a new one.</p>' : '') + '</section>' : '') +
        (d.athlete ? '<section class="card stack"><h2>Coaching dashboard</h2><p>' + h(d.athlete.focus || 'Set their first training focus, adjust their profile or add a shared welcome note.') + '</p><a class="btn primary" href="#/coach/' + d.athlete.id + '">Open athlete dashboard</a></section>' :
          '<section class="card stack"><h2>Set up their coaching profile</h2>' + (d.candidates.length ? '<p>An earlier profile uses this email. Open it and share its claim code with the member to keep their history together.</p>' + d.candidates.map(a => '<a class="btn" href="#/coach/' + a.id + '">Open ' + h(a.name) + '</a>').join('') : '<p>This member has an account but has not created or claimed a coaching profile.</p><p class="small muted">If they already trained with you, check your existing roster first. Create a new profile only when they need one.</p><div class="row"><a class="btn" href="#/workspace">Check existing roster</a><button class="btn primary" id="member-profile">Create new coaching profile</button></div>') + '</section>') +
        (d.signup ? '<p class="small muted">Owner alert: ' + h(emailState(d.signup.email_state)) + (d.signup.last_error ? ' · ' + h(d.signup.last_error) : '') + '</p>' : '');
      const reviewed = host.querySelector('#member-reviewed');
      if (reviewed) reviewed.onclick = async () => {
        reviewed.disabled = true;
        try { await api.request('POST','/api/admin/members/' + id + '/reviewed',{}); reviewed.textContent = 'Reviewed'; }
        catch (e) { reviewed.disabled = false; host.querySelector('#member-status').textContent = e.message; }
      };
      const create = host.querySelector('#member-profile');
      if (create) create.onclick = async () => {
        create.disabled = true;
        try { const result = await api.request('POST','/api/admin/members/' + id + '/profile',{}); location.hash = '#/coach/' + result.athlete_id; }
        catch (e) { create.disabled = false; host.querySelector('#member-status').textContent = e.message; }
      };
    };
  });
})();
