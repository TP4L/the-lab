/* A shared first step for Google, email links and password signup. */
(function () {
  'use strict';
  window.LabPlugins = window.LabPlugins || [];
  window.LabPlugins.push(function (ctx) {
    const L = window.Lab, h = L.h, api = L.api;
    ctx.routes.push([/^\/welcome$/, 'welcome', 'profile']);
    ctx.views.welcome = async function () {
      const d = await api.request('GET', '/api/me/welcome');
      if (location.hash !== '#/welcome') return;
      const host = document.createElement('div'); host.className = 'auth-wrap welcome-wrap';
      host.innerHTML = ctx.head('Welcome to THE LAB', 'Let’s make this yours.', 'A little context helps your coach give you a useful next step.') +
        '<ol class="signup-steps" aria-label="Getting started"><li>1 · Account ✓</li><li aria-current="step">2 · Your game</li><li>3 · Dashboard</li></ol>' +
        '<p class="small muted">Signed in as ' + h(d.email) + '. <a href="#/profile">Account settings</a></p>' +
        '<form class="card form" id="welcome-form"><label class="flabel" for="welcome-name">What should we call you?</label><input id="welcome-name" autocomplete="name" maxlength="80" required value="' + h(d.name) + '">' +
        '<label class="flabel" for="welcome-sport">Your sport or activity <span class="hint">optional</span></label><input id="welcome-sport" maxlength="80" placeholder="Pickleball, tennis, strength training…" value="' + h(d.sport) + '">' +
        '<label class="flabel" for="welcome-goals">What would you like to work on? <span class="hint">optional</span></label><textarea id="welcome-goals" rows="3" maxlength="2000" placeholder="Tell us what you want to feel more confident doing.">' + h(d.goals) + '</textarea><p class="small muted">Your coach can see these answers when reviewing your account.</p>' +
        (d.athlete_id ? '<section class="welcome-connected"><h2>Your coaching profile is connected.</h2><p>Your existing sessions and coaching notes stay with that profile.</p></section>' :
          '<fieldset class="welcome-options"><legend>Have you trained with THE LAB before?</legend>' +
          '<label><input type="radio" name="connection" value="new" required> <span><b>I’m new here</b><small>Start a new player profile.</small></span></label>' +
          '<label><input type="radio" name="connection" value="claim" required> <span><b>I have a claim code</b><small>Connect the profile my coach made.</small></span></label>' +
          '<label><input type="radio" name="connection" value="later" required> <span><b>Connect my coaching history later</b><small>I already train with THE LAB, need help connecting, or want to explore first.</small></span></label></fieldset>' +
          '<div id="welcome-claim" hidden><label class="flabel" for="welcome-code">Claim code from your coach</label><input id="welcome-code" autocomplete="off" maxlength="12" placeholder="ABCD-2345" disabled><p class="small muted">This connects your existing profile, including its sessions and shared notes.</p></div>') +
        '<button class="btn primary" type="submit">Open my dashboard</button><p id="welcome-status" role="status" aria-live="polite"></p></form>' +
        '<p class="small muted">Your free account is ready. You can update your profile and notification preferences at any time.</p>';
      document.getElementById('app').replaceChildren(host);
      const form = host.querySelector('form'), status = host.querySelector('#welcome-status');
      form.onchange = () => {
        const choice = form.querySelector('input[name="connection"]:checked');
        const code = host.querySelector('#welcome-code');
        if (code) { const show = choice && choice.value === 'claim'; host.querySelector('#welcome-claim').hidden = !show; code.disabled = !show; code.required = !!show; }
      };
      form.onsubmit = async e => {
        e.preventDefault();
        const button = form.querySelector('button'); if (button.disabled) return;
        const connection = d.athlete_id ? 'existing' : form.querySelector('input[name="connection"]:checked')?.value;
        if (!connection) { status.textContent = 'Choose how to set up your coaching profile.'; return; }
        button.disabled = true; button.textContent = 'Saving your profile…'; status.textContent = '';
        try {
          await api.request('POST', '/api/me/welcome', { name: host.querySelector('#welcome-name').value, sport: host.querySelector('#welcome-sport').value,
            goals: host.querySelector('#welcome-goals').value, connection, code: host.querySelector('#welcome-code')?.value || '' });
          const me = await api.request('GET', '/api/me'); ctx.setMe(me); location.hash = '#/';
        } catch (err) { status.textContent = err.message; button.disabled = false; button.textContent = 'Open my dashboard'; }
      };
    };
  });
})();
