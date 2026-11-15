(() => {
  'use strict';
  const { api, h, Store, uuid, toast } = window.Lab;
  const base = '/api/me/practices';
  const home = '#/train/practice';
  const dateLabel = date => new Date(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeLabel = date => new Date(date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const inputDate = (date = new Date()) => {
    const parsed = new Date(date);
    const d = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const dayKey = date => inputDate(date).slice(0, 10);
  const moveDate = (date, offset) => { const d = new Date(date); d.setDate(d.getDate() + offset); return d; };
  const minutes = plan => plan.drills.reduce((sum, drill) => sum + drill.minutes, 0);
  const path = row => home + '/' + row.id;
  const ratio = result => result.makes + result.misses ? result.makes + ' / ' + (result.makes + result.misses) : 'No reps scored';
  const starter = [
    { name: 'Lower-transition resets', attribute: 'Transition reset', minutes: 10, target: 'Land 7 of 10 resets in the kitchen.' },
    { name: 'Pitch & Catch', attribute: '45° entry', minutes: 15, target: 'Earn 6 balanced entries in 10 feeds.' },
    { name: 'Live play', attribute: 'Middle priority', minutes: 10, target: 'Call middle priority before either partner crosses.' }
  ];

  function mount() {
    const view = document.createElement('section');
    view.className = 'practice-page stack';
    document.getElementById('app').replaceChildren(view);
    return view;
  }
  function upgrade(feature) {
    return '<section class="card stack-sm"><h2>' + h(feature) + '</h2><p>Save routines, schedule a weekly plan and compare your next retest with past scores.</p><a class="btn" href="#/membership">Preview Full Access</a></section>';
  }
  function submit(form, action) {
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector('[type=submit]');
      const status = form.querySelector('[role=status]');
      button.disabled = true;
      status.textContent = '';
      try { await action(); } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    };
  }
  (window.LabPlugins = window.LabPlugins || []).push(ctx => {
    ctx.routes.push([/^\/train\/practice$/, 'practiceHome', 'train'],
      [/^\/train\/practice\/new$/, 'practiceNew', 'train'],
      [/^\/train\/practice\/([0-9a-f-]{36})$/, 'practiceOpen', 'train']);

    ctx.views.practiceHome = async () => {
      const view = mount();
      const data = await api.get(base);
      if (!view.isConnected) return;
      const scheduled = data.practices.filter(x => x.kind === 'practice' && !x.completed_at).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
      const history = data.practices.filter(x => x.completed_at).sort((a, b) => b.completed_at.localeCompare(a.completed_at));
      const routines = data.practices.filter(x => x.kind === 'routine');
      let selected = new Date();
      let week = moveDate(selected, -((selected.getDay() + 6) % 7));
      const cards = rows => rows.map(row => '<a class="practice-row card" href="' + path(row) + '"><small>' + h(row.completed_at ? dateLabel(row.completed_at) : timeLabel(row.scheduled_at)) + '</small><span><strong>' + h(row.title) + '</strong><small>' + (minutes(row) ? minutes(row) + ' min · ' + row.drills.length + ' drills' : 'Drills to be added') + '</small></span><span aria-hidden="true">↗</span></a>').join('');
      function paint() {
        const visible = Array.from({ length: 7 }, (_, i) => moveDate(week, i));
        const dates = new Set(visible.map(dayKey));
        const weekly = scheduled.filter(x => dates.has(dayKey(x.scheduled_at)));
        const today = scheduled.filter(x => dayKey(x.scheduled_at) === dayKey(selected));
        view.innerHTML = '<a class="back" href="#/train">← Train</a>' + ctx.head('Train', 'My practice', '', '<a class="btn primary" href="' + home + '/new?day=' + dayKey(selected) + '">Plan a practice</a>') +
          '<section class="practice-calendar"><div class="practice-spread"><h2>' + h(week.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })) + '</h2><div class="row"><button type="button" data-week="-7" aria-label="Previous week">‹</button><button type="button" data-week="7" aria-label="Next week">›</button></div></div>' +
          '<div class="practice-days">' + visible.map((d, i) => '<button type="button" data-day="' + i + '" aria-pressed="' + (dayKey(d) === dayKey(selected)) + '"><small>' + h(d.toLocaleDateString(undefined, { weekday: 'short' })) + '</small><b>' + d.getDate() + '</b><span aria-hidden="true">' + (weekly.some(x => dayKey(x.scheduled_at) === dayKey(d)) ? '•' : '&nbsp;') + '</span></button>').join('') +
          '</div><div class="practice-spread"><small>' + weekly.length + ' scheduled</small><small>' + weekly.reduce((sum, x) => sum + minutes(x), 0) + ' min planned</small></div></section>' +
          '<section class="stack-sm"><h2>' + h(dateLabel(selected)) + '</h2>' + (cards(today) || '<p class="muted">No practices scheduled for this day.</p>') + '</section>' +
          (scheduled.length ? '<details class="card"><summary>All scheduled practices</summary><div class="stack-sm">' + cards(scheduled) + '</div></details>' : '') +
          (routines.length ? '<section class="stack-sm"><h2>Saved routines</h2>' + routines.map(row => '<a class="practice-row card" href="' + path(row) + '"><strong>' + h(row.title) + '</strong><small>' + minutes(row) + ' min</small></a>').join('') + '</section>' : '') +
          '<section class="stack-sm"><h2>Practice history</h2>' + (cards(history) || '<p class="muted">Completed practices will appear here.</p>') + '</section>';
        view.querySelectorAll('[data-week]').forEach(button => button.onclick = () => {
          selected = moveDate(selected, Number(button.dataset.week));
          week = moveDate(week, Number(button.dataset.week));
          paint();
          view.querySelector('[data-week="' + button.dataset.week + '"]').focus();
        });
        view.querySelectorAll('[data-day]').forEach(button => button.onclick = () => {
          selected = visible[Number(button.dataset.day)];
          paint();
          view.querySelector('[aria-pressed=true]').focus();
        });
      }
      paint();
    };

    function edit(view, data, row, source, day) {
      const drills = (row?.drills || source?.drills || []).map(drill => ({ ...drill }));
      const id = row?.id || uuid();
      view.innerHTML = '<a class="back" href="' + home + '">← My practice</a>' + ctx.head('My practice', row ? 'Edit practice' : 'Plan a practice') +
        '<form class="card form"><label>Practice name<input name="title" required maxlength="120" value="' + h(row?.title || source?.title || '') + '"></label>' +
        '<label>Date and time<input required type="datetime-local" name="start" value="' + h(inputDate(row?.scheduled_at || (day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day + 'T18:00' : undefined))) + '"></label>' +
        '<details class="stack-sm"' + (drills.length ? ' open' : '') + '><summary>Drills and targets <span class="muted">· Add now or later</span></summary><div class="stack-sm" data-drills></div><button class="btn" type="button" data-add>Add drill</button>' +
        (data.full && !row ? ' <button class="btn" type="button" data-starter>Use Transition progression</button>' : '') + '</details>' +
        (data.full && !row ? '<label>Weekly plan<select name="repeat"><option value="1">One practice</option><option value="2">2 weekly practices</option><option value="4">4 weekly practices</option><option value="8">8 weekly practices</option></select></label>' : '') +
        '<button class="btn primary" type="submit">' + (row ? 'Save changes' : 'Schedule practice') + '</button><p role="status"></p></form>' +
        (!data.full && !row ? upgrade('Make it a weekly plan') : '');
      const form = view.querySelector('form');
      const fields = view.querySelector('[data-drills]');
      function paint() {
        fields.innerHTML = drills.map((d, i) => '<fieldset class="card stack-sm" data-drill="' + i + '"><legend>Drill ' + (i + 1) + '</legend>' +
          '<label>Drill<input required maxlength="120" data-field="name" value="' + h(d.name) + '"></label><label>Coaching attribute<input maxlength="120" data-field="attribute" value="' + h(d.attribute) + '"></label>' +
          '<label>Minutes<input required type="number" min="1" max="180" data-field="minutes" value="' + h(d.minutes) + '"></label><label>Target<input maxlength="250" data-field="target" value="' + h(d.target) + '"></label>' +
          '<div class="row"><button class="btn" type="button" data-move ' + (i ? '' : 'disabled') + '>Move up</button><button class="btn ghost" type="button" data-remove>Remove drill</button></div></fieldset>').join('');
        form.querySelector('[data-add]').disabled = drills.length >= 20;
      }
      fields.oninput = event => {
        const { field } = event.target.dataset;
        if (field) drills[Number(event.target.closest('fieldset').dataset.drill)][field] = event.target.value;
      };
      fields.onclick = event => {
        const button = event.target.closest('button');
        if (!button) return;
        const index = Number(button.closest('fieldset').dataset.drill);
        if (button.hasAttribute('data-move')) drills.splice(index - 1, 0, drills.splice(index, 1)[0]);
        else drills.splice(index, 1);
        paint();
      };
      form.querySelector('[data-add]').onclick = () => {
        drills.push({ name: '', attribute: '', minutes: 10, target: '' });
        paint();
        fields.querySelector('fieldset:last-child input').focus();
      };
      const preset = form.querySelector('[data-starter]');
      if (preset) preset.onclick = () => {
        if (drills.length <= 17) { drills.push(...starter.map(d => ({ ...d }))); paint(); }
        else toast('There is room for up to 20 drills.');
      };
      paint();
      submit(form, async () => {
        const start = new Date(form.elements.start.value);
        const repeat = Array.from({ length: Number(form.elements.repeat?.value || 1) - 1 }, (_, i) => moveDate(start, (i + 1) * 7).toISOString());
        const body = { id, title: form.elements.title.value, scheduled_at: start.toISOString(), drills: drills.map(d => ({ ...d, minutes: Number(d.minutes) })), repeat };
        if (row) body.version = row.version;
        const saved = await api.request(row ? 'PUT' : 'POST', row ? base + '/' + id : base, body);
        toast(repeat.length ? (repeat.length + 1) + ' practices scheduled' : 'Practice saved');
        if (row) await ctx.route(); else location.hash = path(saved);
      });
    }

    ctx.views.practiceNew = async (_, query) => {
      const view = mount();
      const data = await api.get(base);
      if (!view.isConnected) return;
      const source = data.practices.find(x => x.id === query.from);
      edit(view, data, null, data.full ? source : null, query.day);
    };

    ctx.views.practiceOpen = async id => {
      const view = mount();
      const data = await api.get(base);
      if (!view.isConnected) return;
      const row = data.practices.find(plan => plan.id === id);
      if (!row) { view.innerHTML = '<a class="back" href="' + home + '">← My practice</a><p>Practice not found.</p>'; return; }
      const key = 'personal-practice:' + ctx.me().user.id + ':' + id;
      const previous = row.completed_at && data.full ? data.practices.filter(x => x.completed_at && x.completed_at < row.completed_at).sort((a, b) => b.completed_at.localeCompare(a.completed_at)) : [];
      const compare = drill => {
        for (const attempt of previous) {
          const index = attempt.drills.findIndex(d => d.name.trim().toLowerCase() === drill.name.trim().toLowerCase() && d.attribute.trim().toLowerCase() === drill.attribute.trim().toLowerCase());
          if (index >= 0 && attempt.results[index].makes + attempt.results[index].misses) return 'Previous · ' + ratio(attempt.results[index]) + ' · ' + dateLabel(attempt.completed_at);
        }
        return '';
      };
      view.innerHTML = '<a class="back" href="' + home + '">← My practice</a>' + ctx.head('My practice', row.title, row.scheduled_at ? dateLabel(row.scheduled_at) + ' · ' + timeLabel(row.scheduled_at) + ' · ' + minutes(row) + ' min' : 'Saved routine') +
        '<section class="card stack-sm"><h2>' + (row.completed_at ? 'Results' : 'Drills') + '</h2>' +
        (row.drills.map((d, i) => '<article class="practice-drill"><strong>' + h(d.name) + '</strong><small>' + h([d.minutes + ' min', d.attribute, d.target].filter(Boolean).join(' · ')) + '</small>' +
          (row.completed_at ? '<b>' + h(ratio(row.results[i])) + '</b><small>' + h(compare(d)) + '</small>' : '') + '</article>').join('') || '<p>Add your drills when you’re ready.</p>') + '</section>' +
        '<div class="row">' + (!row.completed_at && row.kind === 'practice' ? '<button class="btn" data-edit>Edit practice</button>' +
          (row.drills.length ? '<button class="btn primary" data-start>' + (Store.get(key)?.version === row.version ? 'Resume practice' : 'Start practice') + '</button>' : '') : '') +
        (data.full && row.drills.length ? '<a class="btn" href="' + home + '/new?from=' + id + '">' + (row.completed_at ? 'Schedule a retest' : 'Use in a new practice') + '</a>' +
          (row.kind === 'practice' ? '<button class="btn" data-routine>Save as routine</button>' : '') : '') +
        (!row.completed_at ? '<button class="btn ghost" data-remove-plan>Remove ' + (row.kind === 'routine' ? 'routine' : 'practice') + '</button>' : '') +
        (row.completed_at && ctx.me().athlete_id ? '<button class="btn" data-share>Share with coach</button>' : '') +
        '</div><p role="status" data-status></p>' + (!data.full && row.completed_at ? upgrade('Compare your next retest') : '');
      const remove = view.querySelector('[data-remove-plan]');
      if (remove) window.Lab.armed(remove, 'Tap again to remove', async () => {
        try { await api.request('DELETE', base + '/' + id); Store.del(key); location.hash = home; }
        catch (error) { view.querySelector('[data-status]').textContent = error.message; }
      });
      const editButton = view.querySelector('[data-edit]');
      if (editButton) editButton.onclick = () => edit(view, data, row);
      const startButton = view.querySelector('[data-start]');
      if (startButton) startButton.onclick = () => run(view, row, key);
      const routineButton = view.querySelector('[data-routine]');
      if (routineButton) {
        const routineId = uuid();
        routineButton.onclick = async () => {
          routineButton.disabled = true;
          try {
            await api.request('POST', base, { id: routineId, kind: 'routine', title: row.title, drills: row.drills });
            view.querySelector('[data-status]').textContent = 'Routine saved.';
          } catch (error) { view.querySelector('[data-status]').textContent = error.message; routineButton.disabled = false; }
        };
      }
      const share = view.querySelector('[data-share]');
      if (share) share.onclick = async () => {
        share.disabled = true;
        try {
          await api.request('POST', base + '/' + id + '/share', {});
          view.querySelector('[data-status]').textContent = 'Results shared in your athlete notes.';
        } catch (error) { view.querySelector('[data-status]').textContent = error.message; share.disabled = false; }
      };
    };

    function run(view, row, key) {
      const saved = Store.get(key);
      const state = saved?.version === row.version ? saved : {
        version: row.version, drill: 0, remaining: row.drills[0].minutes * 60, deadline: null,
        results: row.drills.map(() => ({ makes: 0, misses: 0 })), last: null
      };
      const remaining = () => state.deadline ? Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)) : state.remaining;
      const save = () => Store.set(key, state);
      function paint() {
        const drill = row.drills[state.drill], score = state.results[state.drill];
        view.innerHTML = '<a class="back" href="' + path(row) + '">← Practice details</a><section class="practice-timer"><p>Drill ' + (state.drill + 1) + ' of ' + row.drills.length + '</p><div class="practice-track"><div><small>Time remaining</small><strong data-clock></strong></div></div><h1>' + h(drill.name) + '</h1></section>' +
          '<section class="card stack">' + ([drill.attribute, drill.target].some(Boolean) ? '<p>' + h([drill.attribute, drill.target].filter(Boolean).join(' · ')) + '</p>' : '') + '<div class="practice-score"><button class="btn" data-score="makes"><b>' + score.makes + '</b>Make</button><button class="btn" data-score="misses"><b>' + score.misses + '</b>Miss</button></div>' +
          '<div class="row"><button class="btn ghost" data-undo' + (state.last ? '' : ' disabled') + '>Undo</button><button class="btn" data-toggle>' + (state.deadline ? 'Pause timer' : 'Start timer') + '</button>' +
          (state.drill + 1 < row.drills.length ? '<button class="btn primary" data-next>Next drill</button>' : '<button class="btn primary" data-finish>Finish practice</button>') + '</div><p role="status"></p></section>';
        tick();
        view.querySelectorAll('[data-score]').forEach(button => button.onclick = () => {
          const metric = button.dataset.score;
          if (score[metric] >= 100000) return;
          score[metric]++;
          state.last = metric;
          save(); paint();
          view.querySelector('[data-score="' + metric + '"]').focus();
        });
        view.querySelector('[data-undo]').onclick = () => { score[state.last]--; state.last = null; save(); paint(); };
        view.querySelector('[data-toggle]').onclick = () => {
          if (state.deadline) { state.remaining = remaining(); state.deadline = null; }
          else state.deadline = Date.now() + (state.remaining || drill.minutes * 60) * 1000;
          save(); paint();
        };
        const next = view.querySelector('[data-next]');
        if (next) next.onclick = () => {
          state.drill++; state.deadline = null; state.last = null;
          state.remaining = row.drills[state.drill].minutes * 60;
          save(); paint();
        };
        const finish = view.querySelector('[data-finish]');
        if (finish) finish.onclick = async () => {
          finish.disabled = true;
          try {
            await api.request('POST', base + '/' + row.id + '/finish', { version: row.version, results: state.results });
            clearInterval(ticker);
            Store.del(key);
            toast('Practice saved to history');
            await ctx.route();
          } catch (error) { view.querySelector('[role=status]').textContent = error.message; finish.disabled = false; }
        };
      }
      function tick() {
        const seconds = remaining();
        view.querySelector('[data-clock]').textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        if (!seconds && state.deadline) { state.deadline = null; state.remaining = 0; save(); view.querySelector('[data-toggle]').textContent = 'Restart timer'; }
      }
      save(); paint();
      const ticker = setInterval(() => {
        if (!view.isConnected || !view.querySelector('[data-clock]')) clearInterval(ticker);
        else tick();
      }, 250);
    }
  });
})();