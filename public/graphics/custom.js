/* THE LAB · Custom Lab — a free-form board you arrange by hand.
   Drag players, balls, arrows, text, panels and courts; paint zones; save to the library. */
(function () {
  const L = window.LAB;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const KEY = 'lab-custom-board-v1';
  const uid = () => 'o' + Math.random().toString(36).slice(2, 9);

  const COLORS = { blue: '#2346d8', red: '#e8383d', yellow: '#ffd43b', green: '#2fa84f', orange: '#ff8a2a', purple: '#8b4fd8', white: '#ffffff', black: '#111418' };

  /* ---------------- model ---------------- */
  let board, sel = null, tool = 'select', paintColor = '#36c46a';
  const undo = [], redo = [];

  const resolveColor = (c, th) => (!c ? th.text : c === 'text' ? th.text : c === 'muted' ? th.muted : c === 'accent' ? th.accent : c === 'panel' ? th.panel : c === 'line' ? th.line : c);
  const size = () => L.SIZES[board.size] || L.SIZES.letterL;

  function courtProj(o) {
    const v = o.view === 'opp' ? [0, 0.5] : o.view === 'yours' ? [0.5, 1] : [0, 1];
    return L.proj(o.x, o.y, o.w, o.h, { persp: +o.persp || 0, v0: v[0], v1: v[1] });
  }
  function onCourt(o, spec) {
    const p = L.point(spec);
    if (!p) return { x: o.x + o.w / 2, y: o.y + o.h / 2 };
    const q = courtProj(o)(p.u, p.v);
    return { x: q.x, y: q.y };
  }

  /* ---------------- starters ---------------- */
  function base(title, sizeKey) {
    return { v: 1, title: title || 'Untitled board', size: sizeKey || 'letterL', theme: 'night', accent: '', objects: [] };
  }
  function addText(b, x, y, w, text, o = {}) {
    const t = { id: uid(), type: 'text', x, y, w, text, size: 28, font: 'body', weight: 500, color: 'text', align: 'left', upper: false, italic: false, tracking: 0, ...o };
    b.objects.push(t);
    return t;
  }
  function addCourt(b, x, y, w, h, o = {}) {
    const c = { id: uid(), type: 'court', x, y, w, h, view: 'full', persp: 0.26, lines: 'zones', labels: 'faint', zones: {}, ...o };
    b.objects.push(c);
    return c;
  }
  function addChip(b, pt, label, fill, r) {
    const c = { id: uid(), type: 'chip', x: pt.x, y: pt.y, r: r || 26, label, fill };
    b.objects.push(c);
    return c;
  }
  function addArrow(b, a, z, kind, o = {}) {
    const ar = { id: uid(), type: 'arrow', x1: a.x, y1: a.y, x2: z.x, y2: z.y, bend: 0, kind: kind || 'ball', width: 5, label: '', ...o };
    b.objects.push(ar);
    return ar;
  }
  const STARTERS = {
    board: { name: 'Play board (court + 4 players)', make() {
      const b = base('New play', 'letterL');
      const { w: W, h: H } = L.SIZES[b.size];
      b.objects.push({ id: uid(), type: 'brand', x: 50, y: 50, size: 24 });
      addText(b, 50, 100, W * 0.5, 'PLAY NAME', { size: 76, font: 'head', upper: true });
      addText(b, 50, 190, W * 0.5, 'One line on what this play does.', { size: 26, color: 'accent', weight: 600 });
      const c = addCourt(b, 90, 270, 560, H - 330);
      addChip(b, onCourt(c, 'Y1'), 'P1', COLORS.blue);
      addChip(b, onCourt(c, 'Y3'), 'P2', COLORS.blue);
      addChip(b, onCourt(c, 'O1'), 'D1', COLORS.red);
      addChip(b, onCourt(c, 'O3'), 'D2', COLORS.red);
      b.objects.push({ id: uid(), type: 'box', x: 760, y: 270, w: W - 810, h: H - 330, title: 'Steps', num: '1', fill: 'panel', stroke: 'line', radius: 12 });
      addText(b, 790, 350, W - 870, '1. Step one\n2. Step two\n3. Step three', { size: 30, weight: 500 });
      return b;
    } },
    drill: { name: 'Half-court drill', make() {
      const b = base('New drill', 'letterP');
      const { w: W, h: H } = L.SIZES[b.size];
      b.objects.push({ id: uid(), type: 'brand', x: 50, y: 50, size: 24 });
      addText(b, 50, 100, W - 100, 'DRILL NAME', { size: 84, font: 'head', upper: true });
      addText(b, 50, 200, W - 100, 'Goal of the drill in one line.', { size: 28, color: 'accent', weight: 600 });
      const c = addCourt(b, 140, 290, W - 280, 620, { view: 'yours', persp: 0.12 });
      addChip(b, onCourt(c, 'Y8^'), 'P1', COLORS.blue);
      addChip(b, onCourt(c, 'Y2'), 'C', COLORS.orange);
      b.objects.push({ id: uid(), type: 'box', x: 50, y: 960, w: W - 100, h: H - 1010, title: 'How it runs', num: '1', fill: 'panel', stroke: 'line', radius: 12 });
      addText(b, 80, 1040, W - 160, 'Reps · rotation · what counts as a win.', { size: 30 });
      return b;
    } },
    poster: { name: 'Poster (headline + points)', make() {
      const b = base('New poster', 'story');
      const { w: W } = L.SIZES[b.size];
      b.theme = 'green';
      b.objects.push({ id: uid(), type: 'brand', x: 66, y: 70, size: 32 });
      addText(b, 66, 170, W - 132, 'BIG\nHEADLINE.', { size: 170, font: 'head', upper: true });
      addText(b, 66, 560, W - 132, 'One line that sets it up.', { size: 40, color: 'accent' });
      ['ONE', 'TWO', 'THREE'].forEach((t, i) => {
        addText(b, 66, 720 + i * 260, 200, String(i + 1).padStart(2, '0'), { size: 140, font: 'head', color: 'accent' });
        addText(b, 320, 740 + i * 260, W - 386, t, { size: 62, font: 'head', upper: true });
        addText(b, 320, 830 + i * 260, W - 386, 'Your cue goes here.', { size: 38 });
      });
      return b;
    } },
    blank: { name: 'Blank page', make() {
      const b = base('Blank board', 'letterL');
      b.objects.push({ id: uid(), type: 'brand', x: 50, y: 50, size: 24 });
      return b;
    } },
  };

  /* Turn a generated/edited document into a board you can rearrange. */
  function fromDoc(doc) {
    const t = L.templates[doc.template];
    const dField = t && t.fields.find((f) => f.diagram && String(doc.data[f.k] || '').trim());
    if (dField) {
      const b = base(doc.title, 'letterL');
      b.theme = doc.theme || 'night';
      const { w: W, h: H } = L.SIZES[b.size];
      b.objects.push({ id: uid(), type: 'brand', x: 50, y: 50, size: 24 });
      addText(b, 50, 100, W - 100, String(doc.data.name || doc.data.title || doc.title).toUpperCase(), { size: 72, font: 'head', upper: true });
      const sub = doc.data.tagline || doc.data.style || doc.data.subtitle || '';
      if (sub) addText(b, 50, 186, W * 0.6, sub, { size: 24, color: 'accent', weight: 700, upper: true, tracking: 0.12 });
      const c = addCourt(b, 90, 250, 580, H - 300);
      const D = L.parseDiagram(doc.data[dField.k]);
      D.zones.forEach((z) => (c.zones[z.side + z.n] = L.namedColor(z.color, L.themeFor(b)) || '#36c46a'));
      const P = courtProj(c);
      const at = (p) => P(p.u, p.v);
      D.arrows.forEach((a) => addArrow(b, at(a.a), at(a.b), a.kind === 'move' ? 'move' : 'ball', { bend: a.curve ? -0.56 : 0, label: a.label }));
      D.chips.forEach((ch) => addChip(b, at(ch.p), ch.label, L.namedColor(ch.color, L.themeFor(b)) || (ch.label[0] === 'D' ? COLORS.red : COLORS.blue)));
      D.notes.forEach((n) => addText(b, at(n.p).x - 60, at(n.p).y - 12, 140, n.text, { size: 18, weight: 700, upper: true, align: 'center' }));
      const listKey = ['sequence', 'when', 'focus', 'items', 'trigger'].find((k) => String(doc.data[k] || '').trim());
      if (listKey) {
        const f = t.fields.find((x) => x.k === listKey);
        b.objects.push({ id: uid(), type: 'box', x: 760, y: 250, w: W - 810, h: H - 300, title: f ? f.label.replace(/^\d+ · /, '').split('—')[0].trim() : 'Notes', num: '1', fill: 'panel', stroke: 'line', radius: 12 });
        const text = L.lines(doc.data[listKey]).map((l, i) => `${i + 1}. ${l.split('|').map((s) => s.trim()).filter(Boolean).join(' — ')}`).join('\n');
        addText(b, 790, 330, W - 870, text, { size: 26 });
      }
      return b;
    }
    // no court drawing: put the whole page in as a picture you can draw on
    const b = base(doc.title, doc.size || (t && t.sizes[0]) || 'letterP');
    b.theme = doc.theme || 'night';
    const { w: W, h: H } = L.SIZES[b.size] || L.SIZES.letterP;
    const c = L.renderDoc(document.createElement('canvas'), doc, 1);
    b.objects.push({ id: uid(), type: 'image', x: 0, y: 0, w: W, h: H, src: shrinkCanvas(c, 1400), locked: true });
    return b;
  }

  /* ---------------- images ---------------- */
  const imgCache = new Map();
  function img(src) {
    let i = imgCache.get(src);
    if (!i) {
      i = new Image();
      i.onload = () => draw();
      i.src = src;
      imgCache.set(src, i);
    }
    return i;
  }
  function shrinkCanvas(c, max) {
    const k = Math.min(1, max / Math.max(c.width, c.height));
    const o = document.createElement('canvas');
    o.width = Math.round(c.width * k);
    o.height = Math.round(c.height * k);
    o.getContext('2d').drawImage(c, 0, 0, o.width, o.height);
    const png = o.toDataURL('image/png');
    return png.length < 180000 ? png : o.toDataURL('image/jpeg', 0.82);
  }

  /* ---------------- rendering ---------------- */
  const measured = new Map(); // id -> text height

  function fontFor(o, th) {
    if (o.font === 'head') return [th.HF, th.HW];
    if (o.font === 'heavy') return [L.F.heavy, 400];
    if (o.font === 'cond') return [L.F.cond, 700];
    return [L.F.body, o.weight || 500];
  }

  function drawObject(ctx, o, th, g) {
    if (o.hidden) return;
    switch (o.type) {
      case 'court': {
        const hl = Object.entries(o.zones || {}).map(([k, color]) => ({ side: k[0], n: +k.slice(1), color }));
        L.drawCourt(ctx, courtProj(o), th, { lines: o.lines, labels: o.labels, highlights: hl });
        break;
      }
      case 'chip':
        L.chip(ctx, o.x, o.y, o.r, o.label, { fill: o.fill, text: o.text || undefined });
        break;
      case 'arrow': {
        const color = o.color || (o.kind === 'move' ? th.move || '#ffd43b' : '#ffffff');
        const dash = o.kind === 'solid' ? null : o.kind === 'move' ? [2.2, 1.8] : [3, 2];
        L.arrow(ctx, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }, { color, width: o.width || 5, dash, curve: (o.bend || 0) * 0.5, head: !o.label, endPad: o.label ? 22 : 0 });
        if (o.label) L.chip(ctx, o.x2, o.y2, 22, o.label, { fill: o.kind === 'move' ? th.move || '#ffd43b' : '#1d3fae', ring: o.kind === 'move' ? '#3a2f00' : '#ffffff' });
        break;
      }
      case 'text': {
        const [fam, w] = fontFor(o, th);
        const f = new L.Flow(ctx, o.x, o.y, o.w, true);
        f.text(o.upper ? String(o.text).toUpperCase() : o.text, { size: o.size, fam, weight: w, color: resolveColor(o.color, th), align: o.align, tr: o.tracking || 0, italic: o.italic, lh: o.lh || (o.font === 'body' ? 1.28 : 1.0) });
        measured.set(o.id, Math.max(f.h, o.size));
        break;
      }
      case 'box': {
        ctx.save();
        L.rr(ctx, o.x, o.y, o.w, o.h, o.radius ?? 12);
        ctx.fillStyle = resolveColor(o.fill || 'panel', th);
        ctx.fill();
        if (o.stroke !== 'none') {
          ctx.strokeStyle = resolveColor(o.stroke || 'line', th);
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.restore();
        if (o.title) {
          const ts = 30;
          let tx = o.x + 20;
          if (o.num) {
            L.marker(ctx, 'num', tx + ts * 0.64, o.y + 20 + ts * 0.55, ts * 0.64, th.accent, String(o.num));
            tx += ts * 1.7;
          }
          ctx.font = L.font(th.HW, ts, th.HF);
          ctx.fillStyle = th.text;
          L.line(ctx, String(o.title).toUpperCase(), tx, o.y + 20 + ts * 0.82);
        }
        break;
      }
      case 'image': {
        const i = img(o.src);
        if (i.complete && i.naturalWidth) ctx.drawImage(i, o.x, o.y, o.w, o.h);
        break;
      }
      case 'brand': {
        const r = L.brand(ctx, o.x, o.y, o.size || 24, th, g.brand, g.logo);
        o._w = r.w; o._h = Math.max(r.h, o.size);
        break;
      }
    }
  }

  function renderBoard(canvas, b, scale = 1, overlay = false) {
    const sz = L.SIZES[b.size] || L.SIZES.letterL;
    canvas.width = Math.round(sz.w * scale);
    canvas.height = Math.round(sz.h * scale);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const th = L.themeFor(b);
    L.bg(ctx, sz.w, sz.h, th);
    const g = L.globals();
    for (const o of b.objects) drawObject(ctx, o, th, g);
    if (overlay) drawSelection(ctx, sz);
    return canvas;
  }

  /* ---------------- geometry / hit testing ---------------- */
  function bbox(o) {
    switch (o.type) {
      case 'chip': return { x: o.x - o.r, y: o.y - o.r, w: o.r * 2, h: o.r * 2 };
      case 'text': return { x: o.x, y: o.y, w: o.w, h: measured.get(o.id) || o.size };
      case 'brand': return { x: o.x, y: o.y, w: o._w || 200, h: o._h || o.size };
      case 'arrow': {
        const xs = [o.x1, o.x2], ys = [o.y1, o.y2];
        return { x: Math.min(...xs), y: Math.min(...ys), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
      }
      default: return { x: o.x, y: o.y, w: o.w, h: o.h };
    }
  }
  function ctrl(o) {
    const dx = o.x2 - o.x1, dy = o.y2 - o.y1, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const k = (o.bend || 0) * 0.5 * len;
    return { x: (o.x1 + o.x2) / 2 + nx * k, y: (o.y1 + o.y2) / 2 + ny * k, nx, ny, len };
  }
  function curveMid(o) {
    const c = ctrl(o);
    return { x: 0.25 * o.x1 + 0.5 * c.x + 0.25 * o.x2, y: 0.25 * o.y1 + 0.5 * c.y + 0.25 * o.y2 };
  }
  function hitArrow(o, p, tol) {
    const c = ctrl(o);
    let prev = { x: o.x1, y: o.y1 };
    for (let i = 1; i <= 24; i++) {
      const t = i / 24, mt = 1 - t;
      const q = { x: mt * mt * o.x1 + 2 * mt * t * c.x + t * t * o.x2, y: mt * mt * o.y1 + 2 * mt * t * c.y + t * t * o.y2 };
      if (segDist(p, prev, q) <= tol) return true;
      prev = q;
    }
    return false;
  }
  function segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  function hit(p) {
    const tol = 12 * viewScale();
    for (let i = board.objects.length - 1; i >= 0; i--) {
      const o = board.objects[i];
      if (o.locked || o.hidden) continue;
      if (o.type === 'chip') { if (Math.hypot(p.x - o.x, p.y - o.y) <= o.r + 4) return o; continue; }
      if (o.type === 'arrow') { if (hitArrow(o, p, tol)) return o; continue; }
      const b = bbox(o);
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return o;
    }
    return null;
  }
  function handles(o) {
    if (!o) return [];
    if (o.type === 'arrow') { const m = curveMid(o); return [{ k: 'p1', x: o.x1, y: o.y1 }, { k: 'p2', x: o.x2, y: o.y2 }, { k: 'bend', x: m.x, y: m.y }]; }
    if (o.type === 'chip') return [{ k: 'r', x: o.x + o.r, y: o.y }];
    if (o.type === 'text') { const b = bbox(o); return [{ k: 'e', x: b.x + b.w, y: b.y + b.h / 2 }, { k: 'wl', x: b.x, y: b.y + b.h / 2 }]; }
    if (o.type === 'brand') { const b = bbox(o); return [{ k: 'bs', x: b.x + b.w, y: b.y + b.h }]; }
    const b = bbox(o);
    return [{ k: 'nw', x: b.x, y: b.y }, { k: 'ne', x: b.x + b.w, y: b.y }, { k: 'sw', x: b.x, y: b.y + b.h }, { k: 'se', x: b.x + b.w, y: b.y + b.h }];
  }
  function zoneAt(p) {
    for (let i = board.objects.length - 1; i >= 0; i--) {
      const o = board.objects[i];
      if (o.type !== 'court' || o.hidden) continue;
      const P = courtProj(o), bx = P.box;
      const t = (p.y - o.y) / o.h;
      if (t < 0 || t > 1) continue;
      const v = bx.v0 + t * (bx.v1 - bx.v0);
      const k = 1 - bx.persp + bx.persp * t, ww = o.w * k;
      const u = (p.x - (o.x + (o.w - ww) / 2)) / ww;
      if (u < 0 || u > 1) continue;
      for (const side of ['O', 'Y']) for (let n = 1; n <= 9; n++) {
        const z = L.zoneRect(side, n);
        if (u >= z.u0 && u <= z.u1 && v >= z.v0 && v <= z.v1) return { court: o, key: side + n };
      }
    }
    return null;
  }
  /* Snap points: zone centres, net-side and baseline-side spots of every court. */
  function snap(p, skip) {
    if (!$('cSnap').checked) return p;
    let best = null, bd = 18 * viewScale();
    for (const o of board.objects) {
      if (o.type !== 'court' || o.hidden) continue;
      const P = courtProj(o);
      for (const side of ['O', 'Y']) for (let n = 1; n <= 9; n++) for (const suf of ['', '^', '_']) {
        const q = L.point(side + n + suf);
        if (q.v < P.box.v0 || q.v > P.box.v1) continue;
        const s = P(q.u, q.v);
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d < bd) { bd = d; best = { x: s.x, y: s.y }; }
      }
    }
    if (!best) for (const o of board.objects) {
      if (o.type !== 'chip' || o === skip || o.hidden) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < bd) { bd = d; best = { x: o.x, y: o.y }; }
    }
    return best || p;
  }

  /* ---------------- canvas interaction ---------------- */
  const cv = $('cv');
  let drag = null;
  function viewScale() { const r = cv.getBoundingClientRect(); return r.width ? size().w / r.width : 1; }
  function pt(e) {
    const r = cv.getBoundingClientRect();
    const s = size();
    return { x: (e.clientX - r.left) * (s.w / r.width), y: (e.clientY - r.top) * (s.h / r.height) };
  }
  function drawSelection(ctx) {
    const o = sel && board.objects.find((x) => x.id === sel);
    if (!o) return;
    const vs = viewScale();
    ctx.save();
    ctx.strokeStyle = '#75dbcc';
    ctx.lineWidth = 2 * vs;
    ctx.setLineDash([6 * vs, 4 * vs]);
    if (o.type === 'chip') { ctx.beginPath(); ctx.arc(o.x, o.y, o.r + 6 * vs, 0, Math.PI * 2); ctx.stroke(); }
    else if (o.type !== 'arrow') { const b = bbox(o); ctx.strokeRect(b.x - 4 * vs, b.y - 4 * vs, b.w + 8 * vs, b.h + 8 * vs); }
    ctx.setLineDash([]);
    for (const h of handles(o)) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, 8 * vs, 0, Math.PI * 2);
      ctx.fillStyle = h.k === 'bend' ? '#ffd43b' : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#0b4f46';
      ctx.lineWidth = 2.5 * vs;
      ctx.stroke();
    }
    ctx.restore();
  }

  let raf = 0;
  function draw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => renderBoard(cv, board, 1, true));
  }

  cv.addEventListener('pointerdown', (e) => {
    const p = pt(e);
    cv.setPointerCapture(e.pointerId);
    if (tool === 'paint') {
      const z = zoneAt(p);
      if (z) {
        commitBefore();
        if (z.court.zones[z.key] === paintColor) delete z.court.zones[z.key]; else z.court.zones[z.key] = paintColor;
        changed();
      }
      return;
    }
    if (tool === 'ball' || tool === 'move' || tool === 'solid') {
      commitBefore();
      const s = snap(p);
      const ar = addArrow(board, s, s, tool);
      sel = ar.id;
      drag = { kind: 'p2', o: ar, start: p, created: true };
      return;
    }
    const cur = sel && board.objects.find((x) => x.id === sel);
    const vs = viewScale();
    const h = handles(cur).find((h) => Math.hypot(h.x - p.x, h.y - p.y) <= 14 * vs);
    if (h) {
      commitBefore();
      drag = { kind: h.k, o: cur, start: p, orig: clone(cur) };
      return;
    }
    const o = hit(p);
    sel = o ? o.id : null;
    if (o) {
      commitBefore();
      drag = { kind: 'move', o, start: p, orig: clone(o) };
    }
    inspect();
    draw();
  });
  cv.addEventListener('pointermove', (e) => {
    const p = pt(e);
    if (!drag) {
      cv.style.cursor = tool === 'paint' ? (zoneAt(p) ? 'cell' : 'default') : tool !== 'select' ? 'crosshair' : hit(p) ? 'move' : 'default';
      return;
    }
    const o = drag.o, d = { x: p.x - drag.start.x, y: p.y - drag.start.y }, g = drag.orig;
    switch (drag.kind) {
      case 'move':
        if (o.type === 'arrow') { o.x1 = g.x1 + d.x; o.y1 = g.y1 + d.y; o.x2 = g.x2 + d.x; o.y2 = g.y2 + d.y; }
        else if (o.type === 'chip') { const s = snap({ x: g.x + d.x, y: g.y + d.y }, o); o.x = s.x; o.y = s.y; }
        else { o.x = g.x + d.x; o.y = g.y + d.y; }
        break;
      case 'p1': { const s = snap(p); o.x1 = s.x; o.y1 = s.y; break; }
      case 'p2': { const s = snap(p); o.x2 = s.x; o.y2 = s.y; break; }
      case 'bend': {
        const c = ctrl(o), mx = (o.x1 + o.x2) / 2, my = (o.y1 + o.y2) / 2;
        const off = (p.x - mx) * c.nx + (p.y - my) * c.ny;
        o.bend = Math.max(-1.6, Math.min(1.6, (4 * off) / c.len));
        if (Math.abs(o.bend) < 0.06) o.bend = 0;
        break;
      }
      case 'r': o.r = Math.max(10, Math.min(120, Math.hypot(p.x - o.x, p.y - o.y))); break;
      case 'e': o.w = Math.max(60, g.w + d.x); break;
      case 'wl': o.x = Math.min(g.x + d.x, g.x + g.w - 60); o.w = g.w - (o.x - g.x); break;
      case 'bs': o.size = Math.max(8, g.size * (1 + d.x / Math.max(80, g._w || 200))); break;
      default: { // corner resize
        let { x, y, w, h } = g;
        if (drag.kind.includes('e')) w = Math.max(40, g.w + d.x);
        if (drag.kind.includes('s')) h = Math.max(40, g.h + d.y);
        if (drag.kind.includes('w')) { w = Math.max(40, g.w - d.x); x = g.x + g.w - w; }
        if (drag.kind.includes('n')) { h = Math.max(40, g.h - d.y); y = g.y + g.h - h; }
        if (e.shiftKey && (o.type === 'image' || o.type === 'court')) { const r = g.w / g.h; if (w / h > r) w = h * r; else h = w / r; }
        Object.assign(o, { x, y, w, h });
      }
    }
    draw();
  });
  cv.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.created) {
      const o = drag.o;
      if (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 12) { o.x2 = o.x1 + 160; o.y2 = o.y1 - 120; }
      setTool('select');
    }
    drag = null;
    changed();
  });
  cv.addEventListener('dblclick', () => { const t = document.querySelector('#insp textarea, #insp input'); if (t) t.focus(); });

  /* ---------------- undo / save ---------------- */
  let pendingBefore = null;
  function commitBefore() { pendingBefore = JSON.stringify(board); }
  let saveT = 0;
  function changed() {
    if (pendingBefore && pendingBefore !== JSON.stringify(board)) { undo.push(pendingBefore); if (undo.length > 120) undo.shift(); redo.length = 0; }
    pendingBefore = null;
    inspect();
    layers();
    draw();
    persist();
  }
  function persist() {
    clearTimeout(saveT);
    saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify({ board, docId: board._docId || null })); } catch (e) { /* full */ } }, 400);
  }
  function edit(fn) { commitBefore(); fn(); changed(); }
  function doUndo() { if (!undo.length) return; redo.push(JSON.stringify(board)); board = JSON.parse(undo.pop()); afterLoad(); }
  function doRedo() { if (!redo.length) return; undo.push(JSON.stringify(board)); board = JSON.parse(redo.pop()); afterLoad(); }
  function afterLoad() {
    if (sel && !board.objects.find((o) => o.id === sel)) sel = null;
    syncBoardFields();
    inspect();
    layers();
    draw();
    persist();
  }

  /* ---------------- toolbar ---------------- */
  function setTool(t) {
    tool = t;
    document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    $('paintBar').hidden = t !== 'paint';
    status(t === 'paint' ? 'Tap zones on any court to paint them. Tap again to clear.' : t === 'ball' || t === 'move' || t === 'solid' ? 'Drag on the board from start to finish.' : '');
  }
  document.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => setTool(tool === b.dataset.tool && b.dataset.tool !== 'select' ? 'select' : b.dataset.tool)));
  document.querySelectorAll('.swatch').forEach((s) => (s.onclick = () => { paintColor = s.dataset.c; document.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-pressed', String(x === s))); }));

  function centre() { const s = size(); return { x: s.w / 2, y: s.h / 2 }; }
  function nextLabel(prefix) {
    let n = 1;
    while (board.objects.some((o) => o.type === 'chip' && o.label === prefix + n)) n++;
    return prefix + n;
  }
  const ADD = {
    P: () => addChip(board, jitter(), nextLabel('P'), COLORS.blue),
    D: () => addChip(board, jitter(), nextLabel('D'), COLORS.red),
    num: () => { let n = 1; while (board.objects.some((o) => o.type === 'chip' && o.label === String(n))) n++; return addChip(board, jitter(), String(n), '#1d3fae', 22); },
    coach: () => addChip(board, jitter(), 'C', COLORS.orange),
    text: () => addText(board, centre().x - 200, centre().y, 400, 'Your text', { size: 32 }),
    heading: () => addText(board, 60, 120, size().w - 120, 'HEADLINE', { size: 80, font: 'head', upper: true }),
    box: () => { const c = centre(); const b = { id: uid(), type: 'box', x: c.x - 220, y: c.y - 150, w: 440, h: 300, title: 'Panel', num: '', fill: 'panel', stroke: 'line', radius: 12 }; board.objects.push(b); return b; },
    court: () => { const s = size(); const h = s.h * 0.7; return addCourt(board, s.w / 2 - h * 0.37, s.h * 0.15, h * 0.74, h); },
    brand: () => { const b = { id: uid(), type: 'brand', x: 60, y: 60, size: 24 }; board.objects.push(b); return b; },
  };
  let jit = 0;
  function jitter() { const c = centre(); jit = (jit + 1) % 6; return { x: c.x + jit * 30 - 75, y: c.y + jit * 18 - 45 }; }
  document.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => {
    commitBefore();
    const o = ADD[b.dataset.add]();
    sel = o.id;
    setTool('select');
    changed();
  }));
  $('cImage').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const i = new Image();
      i.onload = () => {
        const c = document.createElement('canvas');
        c.width = i.naturalWidth; c.height = i.naturalHeight;
        c.getContext('2d').drawImage(i, 0, 0);
        const src = shrinkCanvas(c, 1000);
        const s = size(), w = Math.min(s.w * 0.5, i.naturalWidth), h = w * i.naturalHeight / i.naturalWidth;
        edit(() => { const o = { id: uid(), type: 'image', x: (s.w - w) / 2, y: (s.h - h) / 2, w, h, src }; board.objects.push(o); sel = o.id; });
      };
      i.src = r.result;
    };
    r.readAsDataURL(f);
    e.target.value = '';
  };
  $('cUndo').onclick = doUndo;
  $('cRedo').onclick = doRedo;

  document.addEventListener('keydown', (e) => {
    if ($('viewCustom').hidden) return;
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); doRedo(); return; }
    if (typing) return;
    const o = sel && board.objects.find((x) => x.id === sel);
    if (!o) { if (e.key === 'Escape') setTool('select'); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
    else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, dy = e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0;
      edit(() => { if (o.type === 'arrow') { o.x1 += dx; o.x2 += dx; o.y1 += dy; o.y2 += dy; } else { o.x += dx; o.y += dy; } });
    } else if (e.key === 'Escape') { sel = null; inspect(); draw(); }
  });
  function removeSel() { edit(() => { board.objects = board.objects.filter((x) => x.id !== sel); sel = null; }); }
  function duplicate() {
    const o = board.objects.find((x) => x.id === sel);
    if (!o) return;
    edit(() => {
      const c = { ...clone(o), id: uid(), locked: false };
      if (c.type === 'arrow') { c.x1 += 24; c.x2 += 24; c.y1 += 24; c.y2 += 24; } else { c.x += 24; c.y += 24; }
      board.objects.push(c);
      sel = c.id;
    });
  }
  function reorder(dir) {
    edit(() => {
      const i = board.objects.findIndex((x) => x.id === sel);
      const j = dir === 'top' ? board.objects.length - 1 : dir === 'bottom' ? 0 : i + dir;
      if (i < 0 || j < 0 || j >= board.objects.length) return;
      const [o] = board.objects.splice(i, 1);
      board.objects.splice(j, 0, o);
    });
  }

  /* ---------------- inspector ---------------- */
  const NAMES = { court: 'Court', chip: 'Player / marker', arrow: 'Arrow', text: 'Text', box: 'Panel', image: 'Image', brand: 'Brand mark' };
  function field(label, input) { const w = el('label', 'f'); w.append(el('span', null, label), input); return w; }
  function inp(o, k, type = 'text', opts = {}) {
    const i = el(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') i.type = type;
    if (opts.min != null) i.min = opts.min;
    if (opts.max != null) i.max = opts.max;
    if (opts.step != null) i.step = opts.step;
    if (type === 'checkbox') i.checked = !!o[k]; else i.value = o[k] ?? '';
    if (type === 'textarea') i.rows = opts.rows || 4;
    let started = false;
    i.addEventListener('input', () => {
      if (!started) { commitBefore(); started = true; }
      o[k] = type === 'checkbox' ? i.checked : type === 'number' || type === 'range' ? Number(i.value) : i.value;
      layers();
      draw();
    });
    i.addEventListener('change', () => { started = false; changed(); });
    return i;
  }
  function sel_(o, k, options) {
    const s = el('select');
    options.forEach(([v, t]) => { const op = el('option', null, t); op.value = v; s.append(op); });
    s.value = o[k] ?? options[0][0];
    s.onchange = () => edit(() => { o[k] = s.value; });
    return s;
  }
  function colorPick(o, k, tokens) {
    const wrap = el('div', 'cpick');
    const cur = o[k] ?? '';
    const isTok = tokens.some(([v]) => v === cur);
    const s = el('select');
    [...tokens, ['custom', 'Custom…']].forEach(([v, t]) => { const op = el('option', null, t); op.value = v; s.append(op); });
    s.value = isTok ? cur : 'custom';
    const c = el('input');
    c.type = 'color';
    c.value = /^#[0-9a-f]{6}$/i.test(o[k]) ? o[k] : '#ffffff';
    c.hidden = isTok;
    s.onchange = () => { c.hidden = s.value !== 'custom'; edit(() => { o[k] = s.value === 'custom' ? c.value : s.value; }); };
    c.oninput = () => { o[k] = c.value; draw(); };
    c.onchange = () => edit(() => { o[k] = c.value; });
    wrap.append(s, c);
    return wrap;
  }
  const CHIP_COLORS = Object.entries(COLORS).map(([k, v]) => [v, k[0].toUpperCase() + k.slice(1)]);
  const TEXT_COLORS = [['text', 'Theme text'], ['muted', 'Theme muted'], ['accent', 'Theme accent']];

  function inspect() {
    const box = $('insp');
    box.replaceChildren();
    const o = sel && board.objects.find((x) => x.id === sel);
    $('inspTitle').textContent = o ? NAMES[o.type] : 'Nothing selected';
    if (!o) { box.append(el('p', 'note', 'Tap anything on the board to move or change it. Use the toolbar to add players, arrows, text, panels or another court.')); return; }
    const add = (...n) => box.append(...n);
    if (o.type === 'chip') {
      add(field('Label', inp(o, 'label')), field('Colour', colorPick(o, 'fill', CHIP_COLORS)), field('Size', inp(o, 'r', 'range', { min: 10, max: 90 })));
    } else if (o.type === 'arrow') {
      add(field('Type', sel_(o, 'kind', [['ball', 'Ball path (white dashes)'], ['move', 'Player movement (yellow)'], ['solid', 'Solid line']])),
        field('Curve', inp(o, 'bend', 'range', { min: -1.6, max: 1.6, step: 0.02 })),
        field('Thickness', inp(o, 'width', 'range', { min: 2, max: 16 })),
        field('Step label at the end', inp(o, 'label')),
        field('Colour', colorPick(o, 'color', [['', 'Automatic'], ...CHIP_COLORS])));
      add(el('p', 'note', 'Drag the white dots to move the ends, the yellow dot to bend it.'));
    } else if (o.type === 'text') {
      add(field('Text', inp(o, 'text', 'textarea', { rows: 4 })),
        field('Font', sel_(o, 'font', [['body', 'Body'], ['head', 'Theme headline'], ['heavy', 'Heavy'], ['cond', 'Condensed']])),
        field('Size', inp(o, 'size', 'range', { min: 8, max: 240 })),
        field('Colour', colorPick(o, 'color', TEXT_COLORS)),
        field('Align', sel_(o, 'align', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']])),
        field('Letter spacing', inp(o, 'tracking', 'range', { min: 0, max: 0.5, step: 0.01 })));
      const r = el('div', 'checks');
      r.append(field('ALL CAPS', inp(o, 'upper', 'checkbox')), field('Italic', inp(o, 'italic', 'checkbox')));
      if (o.font === 'body') r.append(field('Bold', (() => { const c = el('input'); c.type = 'checkbox'; c.checked = (o.weight || 500) >= 700; c.onchange = () => edit(() => { o.weight = c.checked ? 700 : 500; }); return c; })()));
      add(r);
    } else if (o.type === 'box') {
      add(field('Title (optional)', inp(o, 'title')), field('Number badge', inp(o, 'num')),
        field('Fill', colorPick(o, 'fill', [['panel', 'Theme panel'], ['accent', 'Theme accent'], ['transparent', 'None']])),
        field('Border', colorPick(o, 'stroke', [['line', 'Theme line'], ['accent', 'Theme accent'], ['none', 'None']])),
        field('Rounded corners', inp(o, 'radius', 'range', { min: 0, max: 60 })));
    } else if (o.type === 'court') {
      add(field('Show', sel_(o, 'view', [['full', 'Full court'], ['yours', 'Your half'], ['opp', 'Opponent half']])),
        field('Angle', inp(o, 'persp', 'range', { min: 0, max: 0.6, step: 0.01 })),
        field('Lines', sel_(o, 'lines', [['zones', '9-zone grid'], ['simple', 'Real court lines']])),
        field('Zone labels', sel_(o, 'labels', [['faint', 'Faint numbers'], ['num', 'Numbers'], ['full', 'Number + name'], ['none', 'None']])));
      const b = el('button', 'secondary small', 'Clear painted zones');
      b.type = 'button';
      b.onclick = () => edit(() => { o.zones = {}; });
      add(b, el('p', 'note', 'Use the 🎨 Paint zones tool to colour zones. Hold Shift while resizing to keep the shape.'));
    } else if (o.type === 'brand') {
      add(field('Size', inp(o, 'size', 'range', { min: 8, max: 120 })), el('p', 'note', 'Brand text and logo come from the Editor tab settings.'));
    } else if (o.type === 'image') {
      add(el('p', 'note', 'Drag the corners to resize. Hold Shift to keep the shape.'));
    }
    const row = el('div', 'row');
    const b = (t, fn, cls) => { const x = el('button', cls || 'secondary small', t); x.type = 'button'; x.onclick = fn; row.append(x); };
    b('Duplicate', duplicate);
    b('Forward', () => reorder(1));
    b('Back', () => reorder(-1));
    b(o.locked ? 'Unlock' : 'Lock', () => edit(() => { o.locked = !o.locked; if (o.locked) sel = null; }));
    b('Delete', removeSel, 'secondary small danger');
    add(row);
  }

  function describe(o) {
    if (o.type === 'chip') return 'Player ' + o.label;
    if (o.type === 'text') return '“' + String(o.text).split('\n')[0].slice(0, 26) + '”';
    if (o.type === 'arrow') return (o.kind === 'move' ? 'Movement' : o.kind === 'solid' ? 'Line' : 'Ball path') + (o.label ? ' ' + o.label : '');
    if (o.type === 'box') return 'Panel' + (o.title ? ' · ' + o.title : '');
    return NAMES[o.type];
  }
  function layers() {
    const ol = $('layers');
    ol.replaceChildren(...board.objects.slice().reverse().map((o) => {
      const li = el('li', o.id === sel ? 'on' : '');
      const name = el('button', 'lname', describe(o));
      name.type = 'button';
      name.onclick = () => { sel = o.id; if (o.locked) edit(() => { o.locked = false; }); inspect(); layers(); draw(); };
      const eye = el('button', 'licon', o.hidden ? '◌' : '●');
      eye.type = 'button';
      eye.title = o.hidden ? 'Show' : 'Hide';
      eye.onclick = () => edit(() => { o.hidden = !o.hidden; });
      const lock = el('button', 'licon', o.locked ? '🔒' : '·');
      lock.type = 'button';
      lock.title = o.locked ? 'Unlock' : 'Lock in place';
      lock.onclick = () => edit(() => { o.locked = !o.locked; if (o.locked && sel === o.id) sel = null; });
      li.append(eye, lock, name);
      return li;
    }));
  }

  /* ---------------- board settings ---------------- */
  function fill(s, items) { s.replaceChildren(...items.map(([v, t]) => { const o = el('option', null, t); o.value = v; return o; })); }
  fill($('cSize'), Object.entries(L.SIZES).map(([k, v]) => [k, v.label]));
  fill($('cTheme'), Object.entries(L.THEMES).map(([k, v]) => [k, v.name]));
  fill($('cStarter'), Object.entries(STARTERS).map(([k, v]) => [k, v.name]));
  function syncBoardFields() {
    $('cTitle').value = board.title || '';
    $('cSize').value = board.size;
    $('cTheme').value = board.theme;
    $('cAccent').value = board.accent || L.themeFor(board).accent;
  }
  $('cTitle').oninput = () => { board.title = $('cTitle').value; changed(); };
  $('cSize').onchange = () => edit(() => { board.size = $('cSize').value; });
  $('cTheme').onchange = () => edit(() => { board.theme = $('cTheme').value; if (!board.accent) $('cAccent').value = L.themeFor(board).accent; });
  $('cAccent').oninput = () => { board.accent = $('cAccent').value; draw(); };
  $('cAccent').onchange = () => changed();
  $('cAccentReset').onclick = () => edit(() => { board.accent = ''; $('cAccent').value = L.themeFor(board).accent; });
  $('cNew').onclick = () => {
    const b = $('cNew');
    if (board.objects.length > 1 && !b.dataset.armed) {
      b.dataset.armed = '1';
      b.textContent = 'Replace this board?';
      setTimeout(() => { delete b.dataset.armed; b.textContent = 'Start new'; }, 3500);
      return;
    }
    delete b.dataset.armed;
    b.textContent = 'Start new';
    load(STARTERS[$('cStarter').value].make(), true);
    status('New board. Save it to your library when you like it.');
  };

  function status(m) { $('cStatus').textContent = m || ''; }

  $('cPng').onclick = async () => {
    const c = renderBoard(document.createElement('canvas'), board, Number($('cScale').value) || 2, false);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const name = ('the-lab-' + (board.title || 'board')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '.png';
    if (await L.saveBlob(blob, name)) status('Saved ' + name);
  };
  $('cSave').onclick = async () => {
    if (!L.library) return status('Library not ready yet.');
    const clean = clone(board);
    delete clean._docId;
    clean.objects.forEach((o) => { delete o._w; delete o._h; });
    const doc = { id: board._docId || null, kind: 'custom', template: 'custom', title: board.title || 'Untitled board', board: clean };
    if (JSON.stringify(doc).length > 250000) return status('This board is too big to save — usually large pictures. Remove or shrink an image and try again.');
    try {
      board._docId = await L.library.save(doc);
      status('Saved to your library.');
      changed();
    } catch (e) {
      status(e && e.code === 'quota_exceeded' ? 'Your library is full — delete some documents first.' : 'Could not save (' + ((e && e.code) || 'error') + ').');
    }
  };

  /* ---------------- load / public API ---------------- */
  function load(b, fresh) {
    board = b;
    sel = null;
    if (fresh) { undo.length = 0; redo.length = 0; }
    afterLoad();
    changed();
  }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    board = saved && saved.board && Array.isArray(saved.board.objects) ? saved.board : STARTERS.board.make();
  } catch (e) {
    board = STARTERS.board.make();
  }
  setTool('select');
  afterLoad();

  L.custom = {
    renderBoard,
    open(doc) { const b = clone(doc.board); b._docId = doc.id; load(b, true); status(`Editing "${doc.title}".`); },
    fromDoc(doc) { load(fromDoc(doc), true); status('Everything is movable now. Save it to keep this version.'); },
    onShow() { draw(); },
  };
})();
