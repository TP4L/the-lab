/* THE LAB · Studio — AI lesson writer, variations and library.
   AI writing uses Claude through the claude.ai page (window.claude). The library uses the
   page's database there, and falls back to this browser's storage anywhere else. */
(function () {
  const L = window.LAB;
  const K = window.LAB_KNOWLEDGE || {};
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const host = window.claude && window.claude.use ? window.claude : null;
  let sample = null;
  let busy = null; // AbortController of the running generation

  /* ---------------- views ---------------- */
  const views = { create: $('viewCreate'), library: $('viewLibrary'), editor: $('viewEditor') };
  function show(v) {
    for (const [k, node] of Object.entries(views)) node.hidden = k !== v;
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    if (v === 'library') renderLibrary();
    window.scrollTo({ top: 0 });
  }
  document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => show(b.dataset.view)));

  /* ---------------- library store ---------------- */
  const LIB_KEY = 'lab-studio-library-v1';
  let libDocs = [];
  let dbRef = null;
  const local = {
    load() { try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); } catch (e) { return []; } },
    write(list) { try { localStorage.setItem(LIB_KEY, JSON.stringify(list)); return true; } catch (e) { return false; } },
  };
  const lib = {
    async save(doc) {
      const now = Date.now();
      const body = JSON.parse(JSON.stringify({ ...doc, updatedAt: now, createdAt: doc.createdAt || now }));
      delete body.id;
      if (dbRef) {
        const ref = doc.id ? dbRef.doc(doc.id) : dbRef.doc();
        await ref.set(body);
        return ref.id;
      }
      const list = local.load();
      const id = doc.id || 'd' + now.toString(36) + Math.random().toString(36).slice(2, 6);
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) list[i] = { ...body, id }; else list.unshift({ ...body, id });
      if (!local.write(list)) throw { code: 'quota_exceeded' };
      libDocs = list;
      renderLibrary();
      return id;
    },
    async remove(id) {
      if (dbRef) return dbRef.doc(id).delete();
      libDocs = local.load().filter((x) => x.id !== id);
      local.write(libDocs);
      renderLibrary();
    },
  };
  function startLibrary(db) {
    if (db) {
      dbRef = db.collection('library');
      $('libWhere').textContent = 'Saved to your studio — available wherever you open this link.';
      const timer = setTimeout(() => { $('libNote').textContent = "Can't reach your library yet — still trying."; }, 10000);
      dbRef.orderBy('updatedAt', 'desc').limit(1000).onSnapshot((snap) => {
        if (!snap.metadata.fromCache) { clearTimeout(timer); $('libNote').textContent = ''; }
        libDocs = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
        updateCount();
        if (!views.library.hidden) renderLibrary();
      }, (e) => {
        clearTimeout(timer);
        $('libNote').textContent = 'Your library is unavailable right now (' + e.code + ').';
      });
    } else {
      $('libWhere').textContent = 'Saved in this browser on this device.';
      libDocs = local.load();
      updateCount();
    }
  }
  function updateCount() {
    $('libCount').textContent = libDocs.length ? `(${libDocs.length})` : '';
  }

  /* ---------------- AI prompt ---------------- */
  const LEVELS = { '2.5-3.0': 'newer 2.5–3.0 players', '3.0-4.0': '3.0–4.0 developing players', '4.0+': '4.0+ advanced players', coaches: 'coaches running sessions' };

  function schemaText() {
    return Object.entries(L.templates).map(([k, t]) => {
      const fields = t.fields.map((f) => `  - "${f.k}" (${f.type === 'checkbox' ? 'true/false' : f.type === 'select' ? 'one of ' + f.options.map((o) => '"' + o[0] + '"').join(' | ') : 'string'}): ${f.label}${f.help ? ' — ' + f.help : ''}`).join('\n');
      return `### "${k}" — ${t.name}\n${t.blurb}\nSizes: ${t.sizes.join(', ')}\nFields:\n${fields}`;
    }).join('\n\n');
  }
  function examplesText() {
    const pick = ['five-tool', 'minor-adjustments', 'smother', 'two-up', 'escapes'];
    return L.PRESETS.filter((p) => pick.includes(p.id)).map((p) => JSON.stringify({ template: p.template, title: p.name, data: p.data })).join('\n');
  }
  function codebookText() {
    const p = L.PRESETS.find((x) => x.id === 'language');
    return p ? p.data.rows : '';
  }
  const DSL = `Court diagram language (fields marked "court"/"diagram"). One instruction per line:
P1 Y1            your-team player chip at your zone 1 (P1, P2 = your team, blue)
D1 O3            opponent chip at opponent zone 3 (D1, D2 = opponents, red)
ball Y1 > O7 1   ball path, straight, step label "1" at the end (label optional)
ball Y2 ~> O1    arced ball path (drops, lobs, dinks)
move Y1 > Y5 2   player movement (yellow), optional step label
zone O7 O8       highlight target zones   |  hot O5 = red highlight
note Y5 Hold     small text label on the court
Points: O = opponent side, Y = your side, then zone 1-9. O7-8 = seam between 7 and 8. Y7^ = front of zone (at the net / kitchen line). Y1_ = back of zone (baseline).
Zones per side: 1 Left Deep, 2 Middle Deep, 3 Right Deep, 4 Left Mid, 5 Middle Mid, 6 Right Mid, 7 Left Kitchen, 8 Middle Kitchen, 9 Right Kitchen. Use only these forms.`;

  function basePrompt() {
    return `You are the content designer for THE LAB, a pickleball player-development system. You write printable one-page teaching documents that THE LAB's software lays out automatically.

THE LAB VOICE
- Short, punchy, confident. Titles and headlines in UPPERCASE. Cues are 2–6 words, often in threes ("Reach. Recover. Stay available.").
- Teach one idea per document. Concrete court language: zone numbers, code words, who moves where.
- Use THE LAB's code words exactly as written and only with their meaning (e.g. INDIGO = drop, ICE = reset, HAMMER = counter, AIR = take out of the air, RED = speed up). Never invent new code words; describe anything else in plain words.
- Use the decision-engine vocabulary exactly where it genuinely fits (Height × Time × Balance, Defensive/Neutral/Offensive, Survive → Recover → Stabilize → Build → Pressure → Finish, and the named calls). Do not paraphrase the named calls.
- Be accurate pickleball. No filler, no emojis.

THE LAB CODE WORDS (CODE | ACTION | NOTES)
${codebookText()}

COURT LOGIC (from zone → first targets → second option)
${Object.entries(L.LOGIC).map(([z, r]) => `${z} (${L.ZONE_NAMES[z - 1]}): ${r[0]} → ${r[2]}`).join('\n')}

DECISION ENGINE
${K.engine || ''}

NAMED CALLS
${K.vocabulary || ''}

${DSL}

DOCUMENT TEMPLATES (use these keys exactly; every value is a plain string unless noted; use \\n inside a string for new lines; lines with | separate columns as the field describes)
${schemaText()}

LENGTH LIMITS so the page lays out well
- list: 3–6 items; headline 2–4 short lines.
- pattern: trigger 4–6, sequence 3–5 steps, expected 3–4, body 3–5, branch 4–6 rows, partner 2 lines, cues 3–5, mistakes 3–5, takeaway under 12 words.
- shape: each list 3–5 short lines.
- pressure: 1–4 rows; reminders 3–5.
- grid: legend on unless the court drawing needs the room.
- codebook: up to 22 rows.
- Keep each line under about 60 characters except notes and descriptions.

EXAMPLES OF FINISHED DOCUMENTS (match this quality and density)
${examplesText()}`;
  }

  const OUTPUT = `Reply with only JSON in this shape:
{"docs":[{"template":"pattern","title":"Short library title","tags":["kitchen","counter"],"data":{ ...every field key of that template... }}]}`;

  function formatRule(fmt, n) {
    if (fmt === 'pack') return 'Make ONE complete lesson pack: exactly one document of each template "list", "pattern", "shape", "pressure" and "grid" (the grid must use its court drawing to show the key play), all teaching the same lesson from different angles.';
    if (fmt === 'auto') return `Make ${n} document${n > 1 ? 's' : ''}. For each, choose the template that teaches it best; mix templates where it helps.`;
    return `Make ${n} document${n > 1 ? 's' : ''}, all using the "${fmt}" template.`;
  }

  /* ---------------- generation ---------------- */
  function cleanDoc(d, ctx) {
    if (!d || typeof d !== 'object' || !L.templates[d.template]) return null;
    const t = L.templates[d.template];
    const src = d.data && typeof d.data === 'object' ? d.data : {};
    const data = {};
    for (const f of t.fields) {
      let v = src[f.k];
      if (f.type === 'checkbox') data[f.k] = !(v === false || v === 'false');
      else if (v == null) data[f.k] = '';
      else if (Array.isArray(v)) data[f.k] = v.map((x) => (Array.isArray(x) ? x.join(' | ') : String(x))).join('\n');
      else data[f.k] = String(v);
      if (f.type === 'select' && !f.options.some((o) => o[0] === data[f.k])) data[f.k] = f.options[0][0];
    }
    const title = String(d.title || data.name || data.title || t.name).replace(/\n/g, ' ').slice(0, 120);
    return {
      template: d.template, title, lesson: ctx.lesson || '', tags: Array.isArray(d.tags) ? d.tags.slice(0, 8).map(String) : [],
      size: t.sizes[0], theme: ctx.theme, data,
    };
  }
  function diagramIssues(doc) {
    const t = L.templates[doc.template];
    return t.fields.filter((f) => f.diagram).reduce((n, f) => n + L.parseDiagram(doc.data[f.k]).errors.length, 0);
  }
  const ERR = {
    not_granted: 'Claude access was not allowed for this page. Reload and choose Allow to use AI writing.',
    sampling_disabled: 'AI writing is not available on this account.',
    rate_limited: 'Too many requests right now — wait a minute and try again.',
    session_expired: 'Your claude.ai session expired — sign in again.',
    refused: 'Claude declined that request. Try describing the lesson differently.',
    invalid_json: 'The answer came back in the wrong shape. Try again, or ask for fewer documents.',
    prompt_too_large: 'That request is too long. Shorten the notes.',
  };

  async function run(promptTail, ctx, statusEl, onDocs) {
    if (!sample) return;
    busy = new AbortController();
    setBusy(true);
    statusEl.textContent = 'Thinking…';
    try {
      const out = await sample.json(basePrompt() + '\n\n' + promptTail + '\n\n' + OUTPUT, {
        signal: busy.signal,
        cache: false,
        onText: ({ text }) => { statusEl.textContent = `Writing… ${text.length.toLocaleString()} characters`; },
      });
      const docs = (Array.isArray(out) ? out : out && out.docs || []).map((d) => cleanDoc(d, ctx)).filter(Boolean);
      if (!docs.length) throw { code: 'invalid_json' };
      onDocs(docs);
      statusEl.textContent = `Done — ${docs.length} new document${docs.length > 1 ? 's' : ''}. Edit, save, or make variations of any of them.`;
    } catch (e) {
      statusEl.textContent = e && e.code === 'cancelled' ? 'Stopped.' : ERR[e && e.code] || 'Something went wrong (' + ((e && e.code) || e) + '). Try again.';
      if (e && (e.code === 'not_granted' || e.code === 'sampling_disabled')) { sample = null; refreshAI(); }
    } finally {
      busy = null;
      setBusy(false);
    }
  }
  function setBusy(on) {
    document.querySelectorAll('[data-ai]').forEach((b) => (b.disabled = on || !sample));
    $('stop').hidden = !on;
  }

  $('generate').onclick = () => {
    const topic = $('topic').value.trim();
    if (!topic) { $('genStatus').textContent = 'Describe the lesson first.'; $('topic').focus(); return; }
    const fmt = $('fmt').value, n = Number($('count').value) || 3;
    const level = LEVELS[$('level').value] || '';
    const ctx = { lesson: topic, theme: $('genTheme').value };
    const tail = `THE LESSON: ${topic}
AUDIENCE: ${level}
${$('extra').value.trim() ? 'COACH NOTES: ' + $('extra').value.trim() + '\n' : ''}${formatRule(fmt, n)}
Every document must be meaningfully different — a different angle, play, zone, cue set or emphasis — not a rewording.${seenTitles()}`;
    run(tail, ctx, $('genStatus'), (docs) => addResults(docs));
  };
  $('stop').onclick = () => busy && busy.abort();
  function seenTitles() {
    const t = results.slice(0, 30).map((d) => d.title);
    return t.length ? '\nAlready made in this session (do something new): ' + t.join('; ') : '';
  }

  function makeVariations(doc, direction, statusEl, n = 3) {
    const tail = `Here is an existing THE LAB document:
${JSON.stringify({ template: doc.template, title: doc.title, data: doc.data })}

Make ${n} new variations of it, using the same template "${doc.template}". Keep it teaching the same lesson${doc.lesson ? ' ("' + doc.lesson + '")' : ''} but make each variation genuinely different: a different play, zone, starting position, cue words, or angle on the idea.${direction ? '\nDIRECTION FROM THE COACH: ' + direction : ''}`;
    show('create');
    run(tail, { lesson: doc.lesson || doc.title, theme: doc.theme }, statusEl || $('genStatus'), (docs) => addResults(docs));
  }

  /* ---------------- results ---------------- */
  const results = [];
  function addResults(docs) {
    results.unshift(...docs);
    const wrap = $('results');
    docs.slice().reverse().forEach((d) => wrap.prepend(card(d, 'result')));
  }

  function thumb(doc) {
    const c = el('canvas', 'thumb');
    try {
      const t = L.templates[doc.template];
      const sz = L.SIZES[t.sizes.includes(doc.size) ? doc.size : t.sizes[0]];
      L.renderDoc(c, doc, 420 / Math.max(sz.w, sz.h));
    } catch (e) { console.error(e); }
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', doc.title);
    return c;
  }

  function card(doc, mode) {
    const c = el('article', 'card');
    const t = L.templates[doc.template];
    c.append(thumb(doc));
    c.append(el('h3', null, doc.title));
    const meta = el('p', 'meta', t.name + (doc.lesson && doc.lesson !== doc.title ? ' · ' + doc.lesson : ''));
    c.append(meta);
    const issues = diagramIssues(doc);
    if (issues) c.append(el('p', 'warn', `${issues} court line${issues > 1 ? 's' : ''} couldn't be drawn — open it to fix.`));
    const row = el('div', 'row');
    const btn = (label, fn, cls) => { const b = el('button', cls || 'secondary small', label); b.type = 'button'; b.onclick = fn; row.append(b); return b; };
    btn('Edit', () => { L.openDoc(doc); show('editor'); L.status(`Editing "${doc.title}". Use "Save to library" when done.`); });
    if (mode === 'result') {
      const s = btn('Save', async () => {
        s.disabled = true;
        try { doc.id = await lib.save(doc); s.textContent = 'Saved ✓'; } catch (e) { s.disabled = false; s.textContent = 'Retry save'; $('genStatus').textContent = saveError(e); }
      }, 'small');
    }
    btn('PNG', async () => { const n = await L.exportDoc(doc); if (n) L.status('Saved ' + n); });
    if (mode === 'library') {
      btn('Duplicate', async () => { const copy = { ...JSON.parse(JSON.stringify(doc)), id: null, createdAt: null, title: doc.title + ' (copy)' }; await lib.save(copy).catch((e) => alertLib(saveError(e))); });
      const del = btn('Delete', async () => {
        if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Really delete?'; setTimeout(() => { delete del.dataset.armed; del.textContent = 'Delete'; }, 3500); return; }
        await lib.remove(doc.id).catch((e) => alertLib('Could not delete (' + e.code + ').'));
      }, 'secondary small danger');
    }
    c.append(row);
    // variations
    const vr = el('div', 'vary');
    const inp = el('input');
    inp.placeholder = 'Variation idea (optional)';
    inp.title = 'e.g. make it for a lefty, use AIR, simpler for 3.0s';
    inp.setAttribute('aria-label', 'Variation direction for ' + doc.title);
    const vb = el('button', 'small', 'Make 3 variations');
    vb.type = 'button';
    vb.dataset.ai = '1';
    vb.disabled = !sample || !!busy;
    vb.onclick = () => makeVariations(doc, inp.value.trim());
    vr.append(inp, vb);
    if (sample) c.append(vr);
    return c;
  }
  function saveError(e) {
    return e && e.code === 'quota_exceeded' ? 'Your library is full — delete some documents first.' : 'Could not save (' + ((e && e.code) || 'error') + ').';
  }
  function alertLib(msg) { $('libNote').textContent = msg; }

  /* ---------------- library view ---------------- */
  function renderLibrary() {
    updateCount();
    const q = $('libSearch').value.trim().toLowerCase();
    const tf = $('libTemplate').value;
    const list = libDocs.filter((d) => L.templates[d.template] && (!tf || d.template === tf) && (!q || [d.title, d.lesson, (d.tags || []).join(' '), JSON.stringify(d.data)].join(' ').toLowerCase().includes(q)));
    const wrap = $('libGrid');
    wrap.replaceChildren(...list.slice(0, 120).map((d) => card(d, 'library')));
    $('libEmpty').hidden = libDocs.length > 0;
    $('libMore').textContent = list.length > 120 ? `Showing 120 of ${list.length} — search to narrow it down.` : '';
  }
  $('libSearch').oninput = () => renderLibrary();
  $('libTemplate').onchange = () => renderLibrary();
  $('libTemplate').append(...Object.entries(L.templates).map(([k, t]) => { const o = el('option', null, t.name); o.value = k; return o; }));

  /* ---------------- editor: save to library ---------------- */
  $('saveLib').onclick = async () => {
    const doc = L.currentDoc();
    if (!doc.title) doc.title = String(doc.data.name || doc.data.title || L.templates[doc.template].name).split('\n').join(' ');
    const existing = doc.id && libDocs.find((d) => d.id === doc.id);
    if (existing) { doc.lesson = existing.lesson; doc.tags = existing.tags; doc.createdAt = existing.createdAt; }
    try {
      const id = await lib.save(doc);
      L.openDocId && L.openDocId(id);
      L.state().docId = id;
      L.state().docTitle = doc.title;
      L.status(existing ? 'Library copy updated.' : 'Saved to your library.');
    } catch (e) { L.status(saveError(e)); }
  };

  /* ---------------- setup ---------------- */
  $('fmt').append(...[['auto', 'Best fit (AI chooses)'], ['pack', 'Full lesson pack (one of each)'], ...Object.entries(L.templates).map(([k, t]) => [k, t.name])].map(([v, t]) => { const o = el('option', null, t); o.value = v; return o; }));
  $('fmt').onchange = () => { $('count').disabled = $('fmt').value === 'pack'; };
  $('genTheme').append(...Object.entries(L.THEMES).map(([k, t]) => { const o = el('option', null, t.name); o.value = k; return o; }));
  $('genTheme').value = 'night';
  document.querySelectorAll('.idea').forEach((b) => (b.onclick = () => { $('topic').value = b.textContent; $('topic').focus(); }));

  function refreshAI() {
    $('aiOff').hidden = !!sample;
    $('aiForm').hidden = !sample;
    setBusy(!!busy);
  }

  if (host) {
    host.use('sample').then((s) => { sample = s; refreshAI(); }).catch(() => refreshAI());
    host.use('db').then((d) => startLibrary(d)).catch(() => startLibrary(null));
  } else {
    refreshAI();
    startLibrary(null);
  }
  show(host ? 'create' : 'editor');
})();
