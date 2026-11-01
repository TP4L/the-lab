/* THE LAB · Graphics Studio — app controller */
(function () {
  const L = window.LAB;
  const $ = (id) => document.getElementById(id);
  const KEY = 'lab-graphics-v1';

  const THEMES = {
    green: {
      name: 'Lab Green', bg: '#0f3b3a', bg2: '#0a2e2d', panel: 'rgba(255,255,255,0.045)', line: 'rgba(255,255,255,0.22)',
      text: '#ffffff', muted: 'rgba(226,244,238,0.72)', accent: '#86ecbf', move: '#ffd43b', opp: '#2f6fd6', your: '#3c9a4c', head: 'heavy',
      cell: 'rgba(255,255,255,0.93)', cellInk: '#0f2b2a', tableBg: 'rgba(255,255,255,0.06)', tableStripe: 'rgba(255,255,255,0.045)',
      tableLine: 'rgba(255,255,255,0.14)', tableInk: '#ffffff', tableHead: '#ffffff',
    },
    night: {
      name: 'Night Court', bg: '#0c1526', bg2: '#060a13', panel: 'rgba(90,150,255,0.06)', line: 'rgba(100,165,255,0.36)',
      text: '#ffffff', muted: '#a9b8cf', accent: '#4fb0ff', move: '#ffd43b', opp: '#2a64d4', your: '#3a9447', head: 'cond', texture: true,
      cell: '#e9edf3', cellInk: '#0b1322', tableBg: '#eef2f7', tableStripe: '#e1e7ef', tableLine: '#c5cfdc', tableInk: '#0b1322', tableHead: '#0b1322',
    },
    blackout: {
      name: 'Blackout', bg: '#141414', bg2: '#050505', panel: 'rgba(255,255,255,0.04)', line: 'rgba(255,255,255,0.2)',
      text: '#ffffff', muted: '#a3a3a3', accent: '#d7ff3e', move: '#ffd43b', opp: '#2a64d4', your: '#3a9447', head: 'heavy',
      cell: '#f2f2f2', cellInk: '#111111', tableBg: 'rgba(255,255,255,0.05)', tableStripe: 'rgba(255,255,255,0.04)',
      tableLine: 'rgba(255,255,255,0.14)', tableInk: '#ffffff', tableHead: '#ffffff',
    },
    chalk: {
      name: 'Chalk (print-friendly)', bg: '#f7f4ee', bg2: '#ebe6db', panel: 'rgba(0,0,0,0.03)', line: 'rgba(0,0,0,0.18)',
      text: '#11161c', muted: '#525b65', accent: '#13805a', move: '#e0a800', opp: '#2a64d4', your: '#3a9447', head: 'heavy',
      cell: '#11161c', cellInk: '#ffffff', tableBg: '#ffffff', tableStripe: '#f3f0ea', tableLine: '#d8d3c8', tableInk: '#11161c', tableHead: '#11161c',
    },
  };

  const presetById = (id) => L.PRESETS.find((p) => p.id === id);
  const firstPresetFor = (t) => L.PRESETS.find((p) => p.template === t);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function freshState() {
    const p = L.PRESETS[0];
    const data = {};
    for (const k of Object.keys(L.templates)) {
      const fp = firstPresetFor(k);
      data[k] = fp ? clone(fp.data) : {};
    }
    return { v: 1, preset: p.id, template: p.template, size: p.size, theme: p.theme, accent: '', head: '', brand: 'THE LAB', logo: null, data };
  }

  let state;
  try {
    state = Object.assign(freshState(), JSON.parse(localStorage.getItem(KEY) || 'null') || {});
  } catch (e) {
    state = freshState();
  }
  if (!L.templates[state.template]) state = freshState();

  let logoImg = null;
  function loadLogo() {
    logoImg = null;
    $('logoClear').hidden = !state.logo;
    if (!state.logo) return;
    const img = new Image();
    img.onload = () => { logoImg = img; schedule(); };
    img.src = state.logo;
  }

  function theme(s = state) {
    const base = THEMES[s.theme] || THEMES.green;
    const th = { ...base };
    if (s.accent) th.accent = s.accent;
    const head = s.head || base.head;
    th.HF = head === 'cond' ? L.F.cond : L.F.heavy;
    th.HW = head === 'cond' ? 700 : 400;
    return th;
  }

  /* ---------- UI build ---------- */
  function fillSelect(sel, items, value) {
    sel.replaceChildren(...items.map(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; }));
    if (value != null) sel.value = value;
  }

  function buildStatic() {
    fillSelect($('preset'), [['', '— keep my current content —'], ...L.PRESETS.map((p) => [p.id, p.name])], '');
    fillSelect($('template'), Object.entries(L.templates).map(([k, t]) => [k, t.name]), state.template);
    fillSelect($('theme'), Object.entries(THEMES).map(([k, t]) => [k, t.name]), state.theme);
    $('head').value = state.head || '';
    $('brand').value = state.brand;
    $('accent').value = state.accent || theme().accent;
  }

  function buildSizes() {
    const t = L.templates[state.template];
    if (!t.sizes.includes(state.size)) state.size = t.sizes[0];
    fillSelect($('size'), t.sizes.map((k) => [k, L.SIZES[k].label]), state.size);
  }

  function buildFields() {
    const t = L.templates[state.template];
    $('blurb').textContent = t.blurb || '';
    const d = (state.data[state.template] = state.data[state.template] || {});
    const wrap = $('fields');
    wrap.replaceChildren();
    let anyDiagram = false;
    t.fields.forEach((f) => {
      const id = 'f_' + f.k;
      const lab = document.createElement('label');
      lab.htmlFor = id;
      let input;
      if (f.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = f.rows || 3;
        input.value = d[f.k] ?? '';
      } else if (f.type === 'select') {
        input = document.createElement('select');
        fillSelect(input, f.options, d[f.k] ?? f.options[0][0]);
      } else if (f.type === 'checkbox') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = d[f.k] !== false;
      } else {
        input = document.createElement('input');
        input.value = d[f.k] ?? '';
      }
      input.id = id;
      if (f.type === 'checkbox') {
        lab.append(input, document.createTextNode(f.label));
        wrap.append(lab);
      } else {
        lab.textContent = f.label;
        wrap.append(lab, input);
      }
      if (f.help) {
        const h = document.createElement('span');
        h.className = 'help';
        h.textContent = f.help;
        wrap.append(h);
      }
      let err;
      if (f.diagram) {
        anyDiagram = true;
        err = document.createElement('p');
        err.className = 'err';
        wrap.append(err);
        const tip = document.createElement('span');
        tip.className = 'help';
        tip.textContent = 'See "How to draw on the court" below.';
        wrap.append(tip);
      }
      const update = () => {
        d[f.k] = f.type === 'checkbox' ? input.checked : input.value;
        if (err) {
          const p = L.parseDiagram(input.value);
          err.textContent = p.errors.length ? "Couldn't read:\n" + p.errors.slice(0, 4).join('\n') : '';
        }
        schedule();
      };
      input.addEventListener(f.type === 'select' || f.type === 'checkbox' ? 'change' : 'input', update);
      if (err) update();
    });
    $('dslHelp').hidden = !anyDiagram;
    const acts = $('actions');
    acts.replaceChildren();
    (t.actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'secondary';
      b.textContent = a.label;
      b.onclick = () => {
        state.data[state.template] = a.run(state.data[state.template]);
        buildFields();
        schedule();
        status('Rows filled — edit any line to make it yours.');
      };
      acts.append(b);
    });
  }

  /* ---------- render ---------- */
  function draw(canvas, scale) {
    const t = L.templates[state.template];
    const sz = L.SIZES[state.size];
    canvas.width = Math.round(sz.w * scale);
    canvas.height = Math.round(sz.h * scale);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, sz.w, sz.h);
    t.render(ctx, sz.w, sz.h, state.data[state.template] || {}, theme(), { brand: state.brand, logo: logoImg });
  }

  let raf = 0, saveT = 0;
  function schedule() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      try {
        draw($('out'), 1);
      } catch (e) {
        console.error(e);
        status('Something went wrong drawing this layout: ' + e.message);
      }
    });
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
    }, 400);
  }

  function status(msg) {
    $('status').textContent = msg;
  }

  function fileName(ext) {
    const d = state.data[state.template] || {};
    const base = (d.name || d.title || L.templates[state.template].name).toString().split('\n').join(' ');
    return ('the-lab-' + base).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '.' + ext;
  }

  function exportBlob() {
    return new Promise((resolve) => {
      const c = document.createElement('canvas');
      draw(c, Number($('scale').value) || 2);
      c.toBlob(resolve, 'image/png');
    });
  }

  /* Inside a claude.ai artifact, downloads go through the host's save prompt. */
  let hostDownloads = null;
  const inHost = !!(window.claude && window.claude.use);
  if (inHost) window.claude.use('downloads').then((d) => { hostDownloads = d; }).catch(() => {});

  async function downloadBlob(blob, name) {
    if (hostDownloads) {
      try {
        await hostDownloads.save({ filename: name, data: blob });
        return true;
      } catch (e) {
        if (e && e.code === 'declined') return false;
        if (e && e.code === 'rate_limited') { status('A save prompt is already open.'); return false; }
      }
    }
    if (inHost && !hostDownloads) { status('Downloads are not available in this view.'); return false; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ---------- events ---------- */
  $('preset').onchange = (e) => {
    const p = presetById(e.target.value);
    if (!p) return;
    state.preset = p.id;
    state.template = p.template;
    state.size = p.size;
    state.theme = p.theme;
    state.accent = '';
    state.data[p.template] = clone(p.data);
    buildStatic();
    buildSizes();
    buildFields();
    schedule();
    status(`Loaded "${p.name}". Edit anything on the left.`);
  };
  $('template').onchange = (e) => {
    state.template = e.target.value;
    if (!state.data[state.template]) {
      const fp = firstPresetFor(state.template);
      state.data[state.template] = fp ? clone(fp.data) : {};
    }
    $('preset').value = '';
    buildSizes();
    buildFields();
    schedule();
  };
  $('size').onchange = (e) => { state.size = e.target.value; schedule(); };
  $('theme').onchange = (e) => { state.theme = e.target.value; if (!state.accent) $('accent').value = theme().accent; schedule(); };
  $('head').onchange = (e) => { state.head = e.target.value; schedule(); };
  $('accent').oninput = (e) => { state.accent = e.target.value; schedule(); };
  $('accentReset').onclick = () => { state.accent = ''; $('accent').value = theme().accent; schedule(); };
  $('brand').oninput = (e) => { state.brand = e.target.value; schedule(); };
  $('logo').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { state.logo = r.result; loadLogo(); schedule(); };
    r.readAsDataURL(f);
  };
  $('logoClear').onclick = () => { state.logo = null; $('logo').value = ''; loadLogo(); schedule(); };

  $('download').onclick = async () => {
    status('Rendering…');
    const blob = await exportBlob();
    if (!blob) return status('Could not create the image in this browser.');
    if (await downloadBlob(blob, fileName('png'))) status('Saved ' + fileName('png'));
  };
  if (!inHost && navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })) {
    $('share').hidden = false;
    $('share').onclick = async () => {
      const blob = await exportBlob();
      try {
        await navigator.share({ files: [new File([blob], fileName('png'), { type: 'image/png' })], title: 'THE LAB' });
      } catch (e) { /* cancelled */ }
    };
  }
  $('save').onclick = async () => {
    const blob = new Blob([JSON.stringify({ ...state, savedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    if (await downloadBlob(blob, fileName('json'))) status('Project saved. Open it later with "Open project".');
  };
  $('open').onclick = () => $('openFile').click();
  $('openFile').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then((txt) => {
      try {
        const s = JSON.parse(txt);
        if (!s || !s.data || !L.templates[s.template]) throw new Error('not a Graphics Studio project');
        state = Object.assign(freshState(), s);
        buildStatic();
        buildSizes();
        buildFields();
        loadLogo();
        schedule();
        status('Project opened.');
      } catch (err) {
        status('That file could not be opened: ' + err.message);
      }
      e.target.value = '';
    });
  };
  $('reset').onclick = () => {
    const p = presetById(state.preset) && presetById(state.preset).template === state.template ? presetById(state.preset) : firstPresetFor(state.template);
    if (!p) return;
    const btn = $('reset');
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = 'Click again to reset';
      status(`This replaces your ${L.templates[state.template].name} content with "${p.name}".`);
      setTimeout(() => { delete btn.dataset.armed; btn.textContent = 'Reset to preset'; }, 4000);
      return;
    }
    delete btn.dataset.armed;
    btn.textContent = 'Reset to preset';
    state.data[state.template] = clone(p.data);
    buildFields();
    schedule();
    status('Reset.');
  };

  /* ---------- boot ---------- */
  buildStatic();
  buildSizes();
  buildFields();
  loadLogo();
  schedule();
  const fontsReady = Promise.all([
    '400 40px "Archivo Black"', '500 40px "Archivo"', '600 40px "Archivo"', '700 40px "Archivo"', '700 40px "Oswald"',
  ].map((f) => document.fonts.load(f).catch(() => null)));
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 3000))]).then(schedule);
  if (document.fonts) document.fonts.addEventListener('loadingdone', schedule);
  window.LAB.state = () => state;
  L.THEMES = THEMES;
  /* Render any document (used by the studio for thumbnails and exports). */
  L.renderDoc = (canvas, doc, scale = 1) => {
    const t = L.templates[doc.template];
    const sz = L.SIZES[doc.size && t.sizes.includes(doc.size) ? doc.size : t.sizes[0]];
    canvas.width = Math.round(sz.w * scale);
    canvas.height = Math.round(sz.h * scale);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    t.render(ctx, sz.w, sz.h, doc.data || {}, theme({ theme: doc.theme || state.theme, accent: doc.accent || '', head: doc.head || '' }), { brand: state.brand, logo: logoImg });
    return canvas;
  };
  L.openDoc = (doc) => {
    state.template = doc.template;
    if (doc.size) state.size = doc.size;
    if (doc.theme) state.theme = doc.theme;
    state.accent = doc.accent || '';
    state.head = doc.head || '';
    state.data[doc.template] = clone(doc.data || {});
    state.docId = doc.id || null;
    state.docTitle = doc.title || '';
    $('preset').value = '';
    buildStatic();
    buildSizes();
    buildFields();
    schedule();
  };
  L.currentDoc = () => ({
    id: state.docId || null, title: state.docTitle || '', template: state.template, size: state.size,
    theme: state.theme, accent: state.accent, head: state.head, data: clone(state.data[state.template] || {}),
  });
  L.exportDoc = async (doc, scale) => {
    const c = L.renderDoc(document.createElement('canvas'), doc, scale || Number($('scale').value) || 2);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const d = doc.data || {};
    const base = (doc.title || d.name || d.title || doc.template).toString().split('\n').join(' ');
    const name = ('the-lab-' + base).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '.png';
    return (await downloadBlob(blob, name)) ? name : null;
  };
  L.status = status;
  L.themeFor = (s) => theme({ theme: s.theme || state.theme, accent: s.accent || '', head: s.head || '' });
  L.globals = () => ({ brand: state.brand, logo: logoImg });
  L.saveBlob = downloadBlob;
  window.LAB.loadPreset = (id) => { $('preset').value = id; $('preset').onchange({ target: $('preset') }); };
})();
