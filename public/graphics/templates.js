/* THE LAB · Graphics Studio — templates
   Each template: { name, blurb, sizes, fields, actions?, render(ctx, W, H, data, theme, globals) } */
(function () {
  const L = window.LAB;
  const T = (L.templates = {});

  L.SIZES = {
    story: { label: 'Phone / story · 1080×1800', w: 1080, h: 1800 },
    portrait: { label: 'Instagram portrait · 1080×1350', w: 1080, h: 1350 },
    square: { label: 'Square · 1080×1080', w: 1080, h: 1080 },
    letterP: { label: 'Letter portrait (print) · 8.5×11', w: 1275, h: 1650 },
    letterL: { label: 'Letter landscape (print) · 11×8.5', w: 1650, h: 1275 },
    wide: { label: 'Slide 16:9 · 1920×1080', w: 1920, h: 1080 },
  };

  L.CODE_COLORS = {
    ECHO: '#9aa3ad', 'BLACK DOG': '#17181c', INDIGO: '#3b2db3', BLUE: '#1f6fe5', 'INDIGO BLUE': '#3550c8',
    VEGAS: '#f2c230', RAIL: '#f08a24', MAIN: '#8a8f98', RED: '#e23b3b', FIRE: '#f2552c', MOON: '#7b3fb5',
    HAMMER: '#8a5a33', FLIP: '#1fa3b5', ICE: '#7cc7f2', HOME: '#1f5b3a', GREEN: '#2fa84f',
    HOLD: '#2b2f36', AIR: '#2b2f36', SIT: '#2b2f36', MOVE: '#2b2f36', READ: '#2b2f36',
  };

  /* Court logic: from-zone → [first targets, first note, second targets, second note] */
  L.LOGIC = {
    1: ['7 / 7-8 / 8-9', 'Aim to the front windows. Keep it cross and contained. Use the seams.', '1 or 3', 'Go deep when needed. Change height or buy time.'],
    2: ['7 / 7-8 / 8-9', 'Look to the front windows. Read based on positioning.', 'Read / Context', 'Read their position, movement and balance before choosing.'],
    3: ['7 / 7-8 / 8-9', 'Aim to the front windows. Keep it cross and contained. Use the seams.', '1 or 3', 'Go deep when needed. Change height or buy time.'],
    4: ['8-9', 'Look to 8-9. Keep it cross and contained.', '3 (if open)', 'Use depth to 3 when it is open.'],
    5: ['7-8 / 8-9', 'Work the seams first. Keep it low and controlled. Set up your next ball.', '1 or 3', 'Use depth to reset, change rhythm, or move your opponents.'],
    6: ['7-8', 'Look to 7-8. Keep it cross and contained.', '1 (if open)', 'Use depth to 1 when it is open.'],
    7: ['8 / 9', 'Move it to 8 or 9. Stay low and patient.', 'Reset / Read', 'Reset if pressured. Read before speeding up.'],
    8: ['7 or 9', 'Move it to 7 or 9. Make them move.', 'Reset / Read', 'Reset if pressured. Read before speeding up.'],
    9: ['7 / 8', 'Move it to 7 or 8. Stay low and patient.', 'Reset / Read', 'Reset if pressured. Read before speeding up.'],
  };

  const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const cells = (s) => lines(s).map((l) => l.split('|').map((x) => x.trim()));
  L.lines = lines;
  L.cells = cells;
  const HF = (th, s) => L.font(th.HW, s, th.HF);
  const up = (s) => String(s || '').toUpperCase();

  L.bg = (ctx, W, H, th) => {
    const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
    g.addColorStop(0, th.bg);
    g.addColorStop(1, th.bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (th.texture) {
      ctx.save();
      ctx.strokeStyle = L.rgba(th.text.startsWith('#') ? th.text : '#ffffff', 0.025);
      ctx.lineWidth = 1;
      const st = Math.max(W, H) / 48;
      for (let x = 0; x < W; x += st) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += st) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.restore();
    }
  };

  const headShadow = (U) => ({ shadowColor: 'rgba(0,0,0,0.35)', shadowBlur: 10 * U, shadowOffsetY: 4 * U });

  /* Tracked small caps label */
  const label = (ctx, text, x, y, size, color, o = {}) => {
    ctx.font = L.font(o.weight || 600, size, o.fam || L.F.body);
    ctx.fillStyle = color;
    return L.line(ctx, up(text), x, y, { align: o.align || 'left', tr: size * (o.tr ?? 0.22) });
  };

  /* Panel with optional numbered header. Returns content box. */
  const panel = (ctx, x, y, w, h, th, U, o = {}) => {
    ctx.save();
    L.rr(ctx, x, y, w, h, 10 * U);
    ctx.fillStyle = o.fill || th.panel;
    ctx.fill();
    ctx.strokeStyle = th.line;
    ctx.lineWidth = 1.5 * U;
    ctx.stroke();
    ctx.restore();
    const pad = (o.pad ?? 16) * U;
    let top = y + pad;
    if (o.title) {
      const ts = (o.ts || 25) * U;
      let tx = x + pad;
      if (o.num != null && o.num !== '') {
        const r = ts * 0.64;
        L.marker(ctx, 'num', tx + r, top + ts * 0.55, r, th.accent, String(o.num));
        tx += r * 2 + ts * 0.45;
      }
      if (o.small) {
        label(ctx, o.title, tx, top + ts * 0.5, ts * 0.55, th.muted, { weight: 700 });
        top += ts * 0.75 + pad * 0.5;
      } else {
        const t = up(o.title);
        const tsz = L.fitLine(ctx, t, x + w - pad - tx, ts, th.HF, th.HW, 0.02);
        ctx.font = HF(th, tsz);
        ctx.fillStyle = th.text;
        L.line(ctx, t, tx, top + ts * 0.55 + tsz * 0.36, { tr: tsz * 0.02 });
        let hh = ts * 1.1;
        if (o.sub) {
          const ss = ts * 0.44;
          ctx.font = L.font(600, ss, L.F.body);
          const subS = Math.min(ss, L.fitLine(ctx, up(o.sub), x + w - pad - tx, ss, L.F.body, 600, 0.14));
          label(ctx, o.sub, tx, top + ts * 1.1 + subS * 0.9, subS, th.muted, { tr: 0.14 });
          hh += ss * 1.3;
        }
        top += hh + pad * 0.7;
      }
    }
    return { x: x + pad, y: top, w: w - 2 * pad, h: y + h - pad - top };
  };

  const bullets = (ctx, box, items, th, U, o = {}) => {
    if (!items.length) return;
    L.fit(ctx, { ...box, valign: o.valign || 'top' }, (o.max || 24) * U, (o.min || 8) * U, (f, s) => {
      items.forEach((it, i) => {
        if (i) f.gap(s * (o.gap ?? 0.5));
        f.bullet(it, { size: s, color: o.color || th.text, weight: o.weight || 500, marker: o.marker || 'dot', mcolor: o.mcolor || th.accent, lh: 1.22 });
      });
    });
  };

  /* Draw text with "(CODE)" words tinted by the code colour (single line). */
  const richLine = (ctx, text, x, y, color) => {
    const parts = String(text).split(/(\([A-Z][A-Z ]*\))/);
    let cx = x;
    for (const p of parts) {
      if (!p) continue;
      const m = p.match(/^\(([A-Z][A-Z ]*)\)$/);
      const col = m && L.CODE_COLORS[m[1]];
      ctx.fillStyle = col && L.lum(col) > 0.02 ? col : color;
      ctx.fillText(p, cx, y);
      cx += ctx.measureText(p).width;
    }
  };

  const table = (ctx, box, head, rows, th, U, o = {}) => {
    const all = head ? [head, ...rows] : rows;
    if (!all.length) return;
    const cols = Math.max(...all.map((r) => r.length));
    const wts = Array.from({ length: cols }, (_, c) => Math.max(6, ...all.map((r) => (r[c] || '').length)));
    const tot = wts.reduce((a, b) => a + b, 0);
    const colW = wts.map((w) => (w / tot) * box.w);
    const rowH = box.h / all.length;
    const pad = 8 * U;
    let s = Math.min(rowH * 0.42, (o.max || 20) * U);
    const fitsAt = (s) => all.every((r, ri) => r.every((cell, c) => {
      ctx.font = L.font(ri === 0 && head ? 700 : 500, ri === 0 && head ? s * 0.8 : s, L.F.body);
      const ls = L.wrap(ctx, cell, colW[c] - 2 * pad);
      return ls.length * s * 1.12 <= rowH * 0.9 && ls.every((l) => ctx.measureText(l).width <= colW[c] - 2 * pad);
    }));
    while (s > 7 * U && !fitsAt(s)) s -= 0.5 * U;
    ctx.save();
    L.rr(ctx, box.x, box.y, box.w, box.h, 8 * U);
    ctx.fillStyle = th.tableBg;
    ctx.fill();
    ctx.clip();
    all.forEach((r, ri) => {
      const y = box.y + ri * rowH;
      const isHead = head && ri === 0;
      if (isHead) {
        ctx.fillStyle = L.rgba(th.accent, 0.22);
        ctx.fillRect(box.x, y, box.w, rowH);
      } else if (ri % 2 === 0) {
        ctx.fillStyle = th.tableStripe;
        ctx.fillRect(box.x, y, box.w, rowH);
      }
      let x = box.x;
      r.forEach((cell, c) => {
        const size = isHead ? s * 0.8 : s;
        ctx.font = L.font(isHead || c === 0 ? 700 : 500, size, L.F.body);
        const ls = L.wrap(ctx, isHead ? up(cell) : cell, colW[c] - 2 * pad);
        const lh = size * 1.12;
        const t0 = y + (rowH - ls.length * lh) / 2;
        ls.forEach((l, i) => {
          const bl = L.baseline(t0 + i * lh, lh, size);
          if (isHead) {
            ctx.fillStyle = th.tableHead;
            L.line(ctx, l, x + pad, bl, { tr: size * 0.08 });
          } else richLine(ctx, l, x + pad, bl, th.tableInk);
        });
        x += colW[c];
      });
    });
    ctx.strokeStyle = th.tableLine;
    ctx.lineWidth = 1 * U;
    for (let i = 1; i < all.length; i++) {
      ctx.beginPath();
      ctx.moveTo(box.x, box.y + i * rowH);
      ctx.lineTo(box.x + box.w, box.y + i * rowH);
      ctx.stroke();
    }
    let x = box.x;
    colW.slice(0, -1).forEach((w) => {
      x += w;
      ctx.beginPath();
      ctx.moveTo(x, box.y);
      ctx.lineTo(x, box.y + box.h);
      ctx.stroke();
    });
    ctx.restore();
  };

  const footerBar = (ctx, W, y, m, th, U, left, center, right, g) => {
    ctx.save();
    ctx.strokeStyle = th.line;
    ctx.lineWidth = 1.5 * U;
    ctx.beginPath();
    ctx.moveTo(m, y);
    ctx.lineTo(W - m, y);
    ctx.stroke();
    ctx.restore();
    const s = 13 * U;
    const by = y + 22 * U;
    if (left) L.brand(ctx, m, by - s * 0.72, s * 1.2, th, g.brand, g.logo);
    if (center) label(ctx, center, W / 2, by + s * 0.2, s, th.muted, { align: 'center', tr: 0.3 });
    if (right) label(ctx, right, W - m, by + s * 0.2, s, th.muted, { align: 'right', tr: 0.2 });
  };

  const headBlock = (ctx, x, y, s, th, title, sub) => {
    ctx.font = HF(th, s);
    ctx.fillStyle = th.text;
    L.line(ctx, up(title), x, y + s * 0.72);
    if (sub) label(ctx, sub, x, y + s * 0.72 + s * 0.48, s * 0.28, th.muted, { tr: 0.32 });
  };

  /* ================= 1. Numbered list poster ================= */
  T.list = {
    name: 'Numbered list poster',
    blurb: 'Big headline, numbered tools or steps, one cue each. Like "The 5-Tool Player".',
    sizes: ['story', 'portrait', 'square', 'letterP'],
    fields: [
      { k: 'title', label: 'Headline', type: 'textarea', rows: 3, help: 'One line per row of the headline.' },
      { k: 'subtitle', label: 'Sub-headline', type: 'text' },
      { k: 'items', label: 'Items', type: 'textarea', rows: 8, help: 'One per line:  TITLE | white line | accent line  (the last two are optional).' },
      { k: 'footerLeft', label: 'Footer left', type: 'text' },
      { k: 'footerRight', label: 'Footer right', type: 'text' },
    ],
    render(ctx, W, H, d, th, g) {
      L.bg(ctx, W, H, th);
      const m = W * 0.062, U = W / 1000;
      let y = m * 1.1;
      const b = L.brand(ctx, m, y, W * 0.03, th, g.brand, g.logo);
      y += Math.max(b.h, W * 0.02) + W * 0.065;

      const tl = lines(d.title).map(up);
      if (tl.length) {
        ctx.font = HF(th, 100);
        const maxW = Math.max(...tl.map((l) => ctx.measureText(l).width));
        const lh = th.HW === 400 ? 0.9 : 0.98;
        const ts = Math.min(W * 0.2, (100 * (W - 2 * m)) / maxW, (H * 0.3) / (tl.length * lh));
        ctx.save();
        Object.assign(ctx, headShadow(U));
        ctx.font = HF(th, ts);
        ctx.fillStyle = th.text;
        tl.forEach((l, i) => L.line(ctx, l, m - ts * 0.03, y + i * ts * lh + ts * 0.73));
        ctx.restore();
        y += tl.length * ts * lh + ts * 0.18;
      }
      if (d.subtitle) {
        const f = new L.Flow(ctx, m, y, W - 2 * m, true);
        f.text(d.subtitle, { size: W * 0.037, weight: 500, color: th.accent, lh: 1.2, tr: 0.02 });
        y += f.h;
      }
      y += W * 0.055;

      const fs = W * 0.0175;
      const footY = H - m * 0.85;
      if (d.footerLeft) label(ctx, d.footerLeft.startsWith('*') ? d.footerLeft : d.footerLeft, m, footY, fs, th.text, { weight: 500, tr: 0.12 });
      if (d.footerRight) label(ctx, d.footerRight, W - m, footY, fs, th.text, { weight: 500, tr: 0.2, align: 'right' });

      const rows = cells(d.items);
      if (!rows.length) return;
      const top = y, bottom = footY - fs - W * 0.06;
      const rowH = (bottom - top) / rows.length;
      const ns = Math.min(rowH * 0.6, W * 0.13);
      ctx.font = HF(th, ns);
      const numW = ctx.measureText('00').width + W * 0.06;
      const cw = W - 2 * m - numW;
      const content = (f, s, r) => {
        f.text(up(r[0]), { size: s, fam: th.HF, weight: th.HW, color: th.text, lh: 1.05, shadow: f.draw ? headShadow(U) : null });
        if (r[1]) { f.gap(s * 0.16); f.text(r[1], { size: s * 0.6, weight: 500, color: th.text, lh: 1.28 }); }
        if (r[2]) { f.gap(s * 0.06); f.text(r[2], { size: s * 0.6, weight: 500, color: th.accent, lh: 1.28 }); }
      };
      let s = W * 0.062;
      const ok = (s) => rows.every((r) => {
        const f = new L.Flow(ctx, 0, 0, cw, false);
        content(f, s, r);
        return f.h <= rowH * 0.84 && !f.overflow;
      });
      while (s > W * 0.018 && !ok(s)) s -= W * 0.001;

      rows.forEach((r, i) => {
        const rt = top + i * rowH, cy = rt + rowH / 2;
        if (i) {
          ctx.fillStyle = th.line;
          ctx.fillRect(m, rt, W - 2 * m, Math.max(1, 1.6 * U));
        }
        ctx.save();
        Object.assign(ctx, headShadow(U));
        ctx.font = HF(th, ns);
        ctx.fillStyle = th.accent;
        L.line(ctx, String(i + 1).padStart(2, '0'), m - ns * 0.02, cy + (ns * 0.72) / 2);
        ctx.restore();
        const meas = new L.Flow(ctx, 0, 0, cw, false);
        content(meas, s, r);
        const f = new L.Flow(ctx, m + numW, cy - meas.h / 2, cw, true);
        content(f, s, r);
      });
    },
  };

  /* ================= 2. Court grid ================= */
  T.grid = {
    name: 'Court grid / zone map',
    blurb: 'The numbered 9-zone court. Highlight zones or draw a play on it.',
    sizes: ['letterL', 'letterP', 'portrait', 'story', 'square', 'wide'],
    fields: [
      { k: 'title', label: 'Title', type: 'text' },
      { k: 'subtitle', label: 'Sub-title', type: 'text' },
      { k: 'tagline', label: 'Corner tagline', type: 'textarea', rows: 3 },
      { k: 'labels', label: 'Zone labels', type: 'select', options: [['full', 'Number + name'], ['num', 'Numbers only'], ['none', 'None']] },
      { k: 'persp', label: 'Court angle', type: 'select', options: [['0.3', 'Angled'], ['0.15', 'Slight'], ['0', 'Flat (top-down)']] },
      { k: 'highlight', label: 'Highlight zones', type: 'text', help: 'e.g.  O7 O8 O9  (O = opponent side, Y = your side)' },
      { k: 'diagram', label: 'Draw on the court (optional)', type: 'textarea', rows: 4, diagram: true },
      { k: 'legend', label: 'Show zone legend', type: 'checkbox' },
      { k: 'legendTitle', label: 'Legend title', type: 'text' },
      { k: 'legendNote', label: 'Legend note', type: 'textarea', rows: 2 },
      { k: 'footer', label: 'Footer', type: 'text' },
    ],
    render(ctx, W, H, d, th, g) {
      L.bg(ctx, W, H, th);
      const S = Math.min(W, H), U = S / 1000, m = S * 0.05;
      const land = W / H > 1.15;
      let y = m;
      const b = L.brand(ctx, m, y, 24 * U, th, g.brand, g.logo);
      lines(d.tagline).forEach((l, i) => label(ctx, l, W - m, y + 15 * U * 0.72 + i * 15 * U * 1.5, 15 * U, th.muted, { align: 'right', tr: 0.18 }));
      y += Math.max(b.h, 24 * U) + 36 * U;
      const title = up(d.title);
      const ts = L.fitLine(ctx, title, W - 2 * m - (land ? W * 0.18 : 0), 78 * U, th.HF, th.HW);
      ctx.save();
      Object.assign(ctx, headShadow(U));
      ctx.font = HF(th, ts);
      ctx.fillStyle = th.text;
      L.line(ctx, title, m, y + ts * 0.72);
      ctx.restore();
      y += ts * 0.95;
      if (d.subtitle) {
        const ss = Math.min(17 * U, L.fitLine(ctx, up(d.subtitle), W - 2 * m, 17 * U, L.F.body, 600, 0.3));
        y += ss * 1.4;
        label(ctx, d.subtitle, m, y, ss, th.accent, { tr: 0.3 });
      }
      y += 30 * U;
      const fs = 15 * U;
      if (d.footer) {
        const f = Math.min(fs, L.fitLine(ctx, up(d.footer), W - 2 * m, fs, L.F.body, 600, 0.25));
        label(ctx, d.footer, W / 2, H - m * 0.8, f, th.muted, { align: 'center', tr: 0.25 });
      }
      const top = y, bot = H - m - fs * 2;
      const hl = String(d.highlight || '').split(/[\s,]+/).filter(Boolean).flatMap((t) => (L.point(t, 'O') || { zones: [] }).zones).map(([side, n]) => ({ side, n, color: th.accent }));
      const showLegend = d.legend !== false;
      const opt = { persp: parseFloat(d.persp ?? 0.3), labels: d.labels || 'full', lines: 'zones', highlights: hl };
      const legendBody = (f, s) => {
        f.text(up(d.legendTitle || 'Court zones'), { size: s * 1.35, fam: th.HF, weight: th.HW, color: th.text, lh: 1.1 });
        f.gap(s * 0.5);
        for (let n = 1; n <= 9; n++) f.text(`${n} = ${L.ZONE_NAMES[n - 1]}`, { size: s, weight: 500, color: th.text, lh: 1.45 });
        if (d.legendNote) {
          f.gap(s * 0.6);
          if (f.draw) { ctx.fillStyle = th.line; ctx.fillRect(f.x, f.y, f.w * 0.6, 1.5 * U); }
          f.gap(s * 0.7);
          f.text(up(d.legendNote), { size: s * 0.9, weight: 600, color: th.muted, lh: 1.4, tr: 0.14 });
        }
      };
      if (land) {
        const legW = showLegend ? W * 0.21 : 0;
        const sideW = W * 0.1;
        const box = { x: m + sideW, y: top, w: W - 2 * m - sideW - legW - (showLegend ? 30 * U : 0), h: bot - top };
        const P = L.diagram(ctx, box, d.diagram, th, opt);
        const lx = P.court.x - 18 * U;
        [['Opponent', 0.25], ['Your', 0.75]].forEach(([t, v]) => {
          const py = P(0, v).y;
          label(ctx, t, lx, py - 4 * U, 16 * U, th.muted, { align: 'right', tr: 0.16, weight: 700 });
          label(ctx, 'Side', lx, py + 18 * U, 16 * U, th.muted, { align: 'right', tr: 0.16, weight: 700 });
        });
        if (showLegend) {
          const lh = Math.min(bot - top, 560 * U);
          const lb = { x: W - m - legW, y: top + (bot - top - lh) / 2, w: legW, h: lh };
          const c = panel(ctx, lb.x, lb.y, lb.w, lb.h, th, U, { pad: 22 });
          L.fit(ctx, { ...c, valign: 'middle' }, 24 * U, 9 * U, legendBody);
        }
      } else {
        const legH = showLegend ? (bot - top) * 0.2 : 0;
        const ls = 15 * U;
        const box = { x: m, y: top + ls * 1.8, w: W - 2 * m, h: bot - top - legH - (showLegend ? 24 * U : 0) - ls * 3.6 };
        const P = L.diagram(ctx, box, d.diagram, th, opt);
        label(ctx, 'Opponent side', W / 2, P.court.y - ls * 0.9, ls, th.muted, { align: 'center', tr: 0.2, weight: 700 });
        label(ctx, 'Your side', W / 2, P.court.y + P.court.h + ls * 1.9, ls, th.muted, { align: 'center', tr: 0.2, weight: 700 });
        if (showLegend) {
          const c = panel(ctx, m, bot - legH, W - 2 * m, legH, th, U, { pad: 18 });
          const colW = c.w / 4;
          L.fit(ctx, { x: c.x, y: c.y, w: colW - 10 * U, h: c.h, valign: 'middle' }, 30 * U, 8 * U, (f, s) => {
            f.text(up(d.legendTitle || 'Court zones'), { size: s, fam: th.HF, weight: th.HW, color: th.text, lh: 1.1 });
            if (d.legendNote) { f.gap(s * 0.4); f.text(up(d.legendNote), { size: s * 0.45, weight: 600, color: th.muted, lh: 1.4, tr: 0.12 }); }
          });
          const fitS = (() => {
            let s = 22 * U;
            ctx.font = L.font(500, s, L.F.body);
            while (s > 7 * U && (L.width(ctx, '8 = Middle Kitchen') > colW - 12 * U || s * 1.45 * 3 > c.h)) { s -= 0.5 * U; ctx.font = L.font(500, s, L.F.body); }
            return s;
          })();
          for (let col = 0; col < 3; col++) {
            const f = new L.Flow(ctx, c.x + colW * (col + 1), c.y + (c.h - fitS * 1.45 * 3) / 2, colW, true);
            for (let k = 1; k <= 3; k++) { const n = col * 3 + k; f.text(`${n} = ${L.ZONE_NAMES[n - 1]}`, { size: fitS, weight: 500, color: th.text, lh: 1.45 }); }
          }
        }
      }
    },
  };

  /* ================= 3. Pattern card ================= */
  T.pattern = {
    name: 'Pattern playbook card',
    blurb: 'A full technical page for one named play: trigger, diagram, sequence, branches, cues.',
    sizes: ['letterP', 'story', 'portrait'],
    fields: [
      { k: 'edition', label: 'Header', type: 'text', help: 'e.g. PLAYBOOK | TECHNICAL EDITION' },
      { k: 'motto', label: 'Header right', type: 'textarea', rows: 2 },
      { k: 'number', label: 'Pattern number', type: 'text' },
      { k: 'name', label: 'Pattern name', type: 'text' },
      { k: 'tagline', label: 'Tagline', type: 'text' },
      { k: 'quote', label: 'Quote', type: 'text' },
      { k: 'meta', label: 'Profile', type: 'textarea', rows: 5, help: 'KEY: value per line (Family, Type, Tempo…)' },
      { k: 'trigger', label: '1 · Trigger — what do you see?', type: 'textarea', rows: 5 },
      { k: 'diagram', label: '2 · The play — court diagram', type: 'textarea', rows: 8, diagram: true },
      { k: 'sequence', label: '3 · Sequence', type: 'textarea', rows: 4, help: 'One step per line:  STEP NAME | description' },
      { k: 'expected', label: '4 · Expected ball', type: 'textarea', rows: 4 },
      { k: 'body', label: '5 · Body position', type: 'textarea', rows: 5 },
      { k: 'branch', label: '6 · Branch / adjust', type: 'textarea', rows: 6, help: 'If this happens | Then… | Next play.  Codes in brackets get their colour, e.g. Attack (RED)' },
      { k: 'partner', label: '7 · Partner responsibilities', type: 'textarea', rows: 2, help: 'P1 | what P1 does   (one line per player)' },
      { k: 'cues', label: 'Coaching cues', type: 'textarea', rows: 5 },
      { k: 'mistakes', label: 'Common mistakes', type: 'textarea', rows: 5 },
      { k: 'takeaway', label: 'Key takeaway', type: 'textarea', rows: 2 },
      { k: 'footer', label: 'Footer', type: 'text' },
    ],
    render(ctx, W, H, d, th, g) {
      L.bg(ctx, W, H, th);
      const U = Math.min(W / 1275, H / 1650) * (W / H > 0.7 ? 1 : 1.04);
      const m = 34 * U, gap = 12 * U;
      const wts = [0.065, 0.105, 0.315, 0.2, 0.1, 0.15, 0.04];
      const avail = H - 2 * m - gap * (wts.length - 1);
      const tot = wts.reduce((a, b) => a + b, 0);
      const hs = wts.map((w) => (w / tot) * avail);
      const ys = [];
      hs.reduce((y, h) => { ys.push(y); return y + h + gap; }, m);
      const X = m, FW = W - 2 * m;
      const cols = (fr) => {
        const n = fr.length, w = FW - gap * (n - 1);
        let x = X;
        return fr.map((f) => { const r = { x, w: w * f }; x += w * f + gap; return r; });
      };

      // header
      {
        const y = ys[0], h = hs[0];
        const bs = Math.min(26 * U, h * 0.3);
        const b = L.brand(ctx, X, y + (h - bs * 0.72) / 2 - bs * 0.1, bs, th, g.brand, g.logo);
        const dx = X + b.w + 26 * U;
        ctx.fillStyle = th.line;
        ctx.fillRect(dx, y + h * 0.12, 1.5 * U, h * 0.76);
        const [ed1, ed2] = String(d.edition || '').split('|').map((s) => s.trim());
        const es = Math.min(h * 0.5, L.fitLine(ctx, up(ed1), FW * 0.4, h * 0.5, th.HF, th.HW));
        headBlock(ctx, dx + 24 * U, y + h * 0.12, es, th, ed1 || '', ed2);
        lines(d.motto).forEach((l, i) => label(ctx, l, W - m, y + h * 0.4 + i * 18 * U, 14 * U, th.muted, { align: 'right', tr: 0.2 }));
        ctx.fillStyle = th.line;
        ctx.fillRect(X, y + h + gap / 2, FW, 1.5 * U);
      }
      // title row
      {
        const y = ys[1], h = hs[1];
        const [c1, c2, c3] = cols([0.52, 0.24, 0.24]);
        label(ctx, `Pattern ${d.number || ''}`, c1.x, y + h * 0.16, h * 0.12, th.accent, { tr: 0.22, weight: 700 });
        const name = up(d.name);
        const ns = L.fitLine(ctx, name, c1.w, h * 0.62, th.HF, th.HW);
        ctx.save();
        Object.assign(ctx, headShadow(U));
        ctx.font = HF(th, ns);
        ctx.fillStyle = th.text;
        L.line(ctx, name, c1.x - ns * 0.02, y + h * 0.24 + ns * 0.78);
        ctx.restore();
        if (d.tagline) {
          const tsz = Math.min(h * 0.1, L.fitLine(ctx, up(d.tagline), c1.w, h * 0.1, L.F.body, 600, 0.24));
          label(ctx, d.tagline, c1.x, y + h * 0.98, tsz, th.muted, { tr: 0.24 });
        }
        if (d.quote) {
          L.fit(ctx, { x: c2.x + 10 * U, y: y + h * 0.12, w: c2.w - 10 * U, h: h * 0.76, valign: 'middle' }, 30 * U, 10 * U, (f, s) => {
            f.text(`“${up(d.quote)}”`, { size: s, fam: th.HF, weight: th.HW, color: th.text, lh: 1.1, italic: true });
            f.gap(s * 0.3);
            if (f.draw) { ctx.fillStyle = th.accent; ctx.fillRect(f.x, f.y, f.w * 0.8, 2.5 * U); }
            f.gap(s * 0.35);
            f.text('— ' + up(g.brand || 'The Lab'), { size: s * 0.45, weight: 700, color: th.muted, tr: 0.15, align: 'right' });
          });
        }
        const meta = lines(d.meta).map((l) => { const i = l.indexOf(':'); return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; });
        if (meta.length) {
          const box = panel(ctx, c3.x, y + 4 * U, c3.w, h - 8 * U, th, U, { pad: 12 });
          const rh = box.h / meta.length;
          const s = Math.min(rh * 0.62, 15 * U);
          meta.forEach(([k, v], i) => {
            const by = L.baseline(box.y + i * rh, rh, s);
            label(ctx, k, box.x, by, s * 0.85, th.muted, { tr: 0.12, weight: 700 });
            ctx.font = L.font(700, s, L.F.body);
            const vs = Math.min(s, L.fitLine(ctx, up(v), box.w * 0.58, s, L.F.body, 700, 0.06));
            label(ctx, v, box.x + box.w, by, vs, th.text, { align: 'right', tr: 0.06, weight: 700 });
          });
        }
      }
      // row A
      {
        const y = ys[2], h = hs[2];
        const [a, b, c] = cols([0.24, 0.42, 0.34]);
        let box = panel(ctx, a.x, y, a.w, h, th, U, { num: 1, title: 'Trigger', sub: 'What do you see?' });
        bullets(ctx, box, lines(d.trigger), th, U, { marker: 'ring', max: 21, gap: 0.75 });
        box = panel(ctx, b.x, y, b.w, h, th, U, { num: 2, title: 'The play', sub: 'Ball path · player movement' });
        const legH = 22 * U;
        L.diagram(ctx, { x: box.x, y: box.y, w: box.w, h: box.h - legH - 6 * U }, d.diagram, th, { persp: 0.3, labels: 'faint', lines: 'zones' });
        const ly = box.y + box.h - legH * 0.3;
        const lsz = 11 * U;
        ctx.font = L.font(600, lsz, L.F.body);
        let lx = box.x;
        const legItem = (draw, text) => { draw(lx, ly - lsz * 0.35); lx += 30 * U; ctx.fillStyle = th.muted; lx += label(ctx, text, lx, ly, lsz, th.muted, { tr: 0.12 }) + 18 * U; };
        legItem((x, yy) => L.arrow(ctx, { x, y: yy }, { x: x + 24 * U, y: yy }, { width: 2 * U, dash: null }), 'Ball path');
        legItem((x, yy) => L.arrow(ctx, { x, y: yy }, { x: x + 24 * U, y: yy }, { width: 2 * U, color: th.move, dash: [2, 1.6] }), 'Player move');
        legItem((x, yy) => { ctx.fillStyle = L.rgba(th.accent, 0.8); ctx.fillRect(x + 4 * U, yy - 7 * U, 16 * U, 14 * U); }, 'Target zone');
        box = panel(ctx, c.x, y, c.w, h, th, U, { num: 3, title: 'Sequence', sub: 'Step by step' });
        const steps = cells(d.sequence);
        L.fit(ctx, box, 26 * U, 8 * U, (f, s) => {
          steps.forEach((st, i) => {
            if (i) {
              f.gap(s * 0.45);
              if (f.draw) { ctx.fillStyle = th.line; ctx.fillRect(f.x + s * 2, f.y, f.w - s * 2, 1 * U); }
              f.gap(s * 0.55);
            }
            const t0 = f.y;
            f.text(up(st[0]), { size: s, fam: th.HF, weight: th.HW, color: th.accent, lh: 1.1, indent: s * 2.1 });
            if (st[1]) { f.gap(s * 0.12); f.text(st[1], { size: s * 0.72, weight: 500, color: th.text, lh: 1.25, indent: s * 2.1 }); }
            if (f.draw) {
              ctx.save();
              const r = s * 0.72;
              ctx.beginPath();
              ctx.arc(f.x + r, t0 + s * 0.55, r, 0, Math.PI * 2);
              ctx.strokeStyle = th.accent;
              ctx.lineWidth = 2 * U;
              ctx.stroke();
              ctx.font = L.font(400, r * 1.05, L.F.heavy);
              ctx.fillStyle = th.text;
              L.line(ctx, String(i + 1), f.x + r, t0 + s * 0.55 + r * 0.38, { align: 'center' });
              ctx.restore();
            }
          });
        });
      }
      // row B
      {
        const y = ys[3], h = hs[3];
        const [a, b, c] = cols([0.27, 0.29, 0.44]);
        let box = panel(ctx, a.x, y, a.w, h, th, U, { num: 4, title: 'Expected ball', sub: 'What are you trying to get back?' });
        bullets(ctx, box, lines(d.expected), th, U, { max: 20, gap: 0.6 });
        box = panel(ctx, b.x, y, b.w, h, th, U, { num: 5, title: 'Body position', sub: 'Where does your body go?' });
        bullets(ctx, box, lines(d.body), th, U, { max: 18, gap: 0.45 });
        box = panel(ctx, c.x, y, c.w, h, th, U, { num: 6, title: 'Branch / adjust', sub: "What's next based on the read?" });
        const rows = cells(d.branch);
        if (rows.length) table(ctx, box, ['If this happens…', 'Then…', 'Next play'], rows, th, U, { max: 16 });
      }
      // row C: cues strip
      {
        const y = ys[4], h = hs[4];
        const box = panel(ctx, X, y, FW, h, th, U, { title: 'Coaching cues', small: true, ts: 22 });
        const cues = lines(d.cues);
        if (cues.length) {
          const cw = box.w / cues.length;
          const r = Math.min(box.h * 0.22, cw * 0.15);
          let s = 15 * U;
          const fits = (s) => cues.every((cu) => { ctx.font = L.font(700, s, L.F.body); const ls = L.wrap(ctx, up(cu), cw - 16 * U, s * 0.08); return ls.length * s * 1.2 + r * 2.6 <= box.h && ls.every((l) => L.width(ctx, l, s * 0.08) <= cw - 16 * U); });
          while (s > 7 * U && !fits(s)) s -= 0.5 * U;
          cues.forEach((cu, i) => {
            const cx = box.x + cw * i + cw / 2;
            if (i) { ctx.fillStyle = th.line; ctx.fillRect(box.x + cw * i, box.y, 1 * U, box.h); }
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, box.y + r * 1.1, r, 0, Math.PI * 2);
            ctx.strokeStyle = th.accent;
            ctx.lineWidth = 2.2 * U;
            ctx.stroke();
            ctx.font = L.font(400, r * 0.95, L.F.heavy);
            ctx.fillStyle = th.accent;
            L.line(ctx, String(i + 1), cx, box.y + r * 1.1 + r * 0.34, { align: 'center' });
            ctx.restore();
            const f = new L.Flow(ctx, box.x + cw * i + 8 * U, box.y + r * 2.5, cw - 16 * U, true);
            f.text(up(cu), { size: s, weight: 700, color: th.text, align: 'center', lh: 1.2, tr: 0.08 });
          });
        }
      }
      // row D
      {
        const y = ys[5], h = hs[5];
        const [a, b, c] = cols([0.36, 0.34, 0.3]);
        let box = panel(ctx, a.x, y, a.w, h, th, U, { num: 7, title: 'Partner responsibilities', ts: 22 });
        const ps = cells(d.partner);
        if (ps.length) {
          const pw = box.w / ps.length;
          ps.forEach((p, i) => {
            const r = Math.min(18 * U, box.h * 0.2);
            L.chip(ctx, box.x + pw * i + r, box.y + r, r, p[0], { fill: /^D/i.test(p[0]) ? '#e8383d' : '#2346d8' });
            L.fit(ctx, { x: box.x + pw * i, y: box.y + r * 2.4, w: pw - 12 * U, h: box.h - r * 2.4 }, 17 * U, 8 * U, (f, s) => f.text(p.slice(1).join(' '), { size: s, weight: 500, color: th.text, lh: 1.28 }));
          });
        }
        box = panel(ctx, b.x, y, b.w, h, th, U, { title: 'Common mistakes', small: true, ts: 22 });
        bullets(ctx, box, lines(d.mistakes), th, U, { marker: 'x', mcolor: '#e8383d', max: 17, gap: 0.3 });
        box = panel(ctx, c.x, y, c.w, h, th, U, { title: 'Key takeaway', small: true, ts: 22 });
        if (d.takeaway) {
          ctx.fillStyle = th.accent;
          ctx.fillRect(box.x, box.y, box.w * 0.7, 3 * U);
          L.fit(ctx, { x: box.x, y: box.y + 10 * U, w: box.w, h: box.h - 10 * U, valign: 'middle' }, 34 * U, 10 * U, (f, s) => f.text(up(d.takeaway), { size: s, fam: th.HF, weight: th.HW, color: th.text, lh: 1.1, italic: true }));
        }
      }
      footerBar(ctx, W, ys[6] + 4 * U, m, th, U, true, d.footer, '', g);
    },
  };

  /* ================= 4. Team shape ================= */
  T.shape = {
    name: 'Team shape sheet',
    blurb: 'Where both teams stand, when to use the shape, cues and drills.',
    sizes: ['letterL', 'letterP', 'story', 'wide'],
    fields: [
      { k: 'edition', label: 'Header', type: 'text', help: 'e.g. TEAM SHAPES | TECHNICAL EDITION' },
      { k: 'motto', label: 'Header right', type: 'textarea', rows: 3 },
      { k: 'number', label: 'Number', type: 'text' },
      { k: 'name', label: 'Shape name', type: 'text' },
      { k: 'style', label: 'Style line', type: 'text' },
      { k: 'diagram', label: 'Court positions', type: 'textarea', rows: 6, diagram: true },
      { k: 'lines', label: 'Court lines', type: 'select', options: [['simple', 'Real court lines'], ['zones', '9-zone grid']] },
      { k: 'headline', label: 'Headline box', type: 'textarea', rows: 3 },
      { k: 'when', label: 'When to use', type: 'textarea', rows: 5 },
      { k: 'focus', label: 'Key focus', type: 'textarea', rows: 4 },
      { k: 'cues', label: 'Common cues', type: 'textarea', rows: 4 },
      { k: 'creates', label: 'What it creates', type: 'textarea', rows: 3 },
      { k: 'watch', label: 'Things to watch', type: 'textarea', rows: 4 },
      { k: 'drills', label: 'Drills to train it', type: 'textarea', rows: 5 },
      { k: 'footer', label: 'Footer', type: 'text' },
    ],
    render(ctx, W, H, d, th, g) {
      L.bg(ctx, W, H, th);
      const U = Math.min(W, H) / 1275, m = 40 * U, gap = 14 * U;
      const land = W / H > 1.1;
      // header
      const hh = 78 * U;
      const b = L.brand(ctx, m, m + 8 * U, 26 * U, th, g.brand, g.logo);
      const dx = m + b.w + 26 * U;
      ctx.fillStyle = th.line;
      ctx.fillRect(dx, m, 1.5 * U, hh * 0.8);
      const [e1, e2] = String(d.edition || '').split('|').map((s) => s.trim());
      headBlock(ctx, dx + 24 * U, m, Math.min(44 * U, L.fitLine(ctx, up(e1), W * 0.4, 44 * U, th.HF, th.HW)), th, e1 || '', e2);
      lines(d.motto).forEach((l, i) => label(ctx, l, W - m, m + 12 * U + i * 18 * U, 14 * U, th.text, { align: 'right', tr: 0.2, weight: 700 }));
      // title
      let y = m + hh + 18 * U;
      const nb = 92 * U;
      ctx.save();
      L.rr(ctx, m, y, nb, nb, 8 * U);
      ctx.fillStyle = L.rgba(th.accent, 0.85);
      ctx.fill();
      ctx.font = HF(th, nb * 0.62);
      ctx.fillStyle = L.ink(th.accent);
      L.line(ctx, d.number || '', m + nb / 2, y + nb / 2 + nb * 0.22, { align: 'center' });
      ctx.restore();
      const tx = m + nb + 22 * U;
      const ns = L.fitLine(ctx, up(d.name), W - tx - m, 80 * U, th.HF, th.HW);
      ctx.save();
      Object.assign(ctx, headShadow(U));
      ctx.font = HF(th, ns);
      ctx.fillStyle = th.text;
      L.line(ctx, up(d.name), tx, y + ns * 0.74);
      ctx.restore();
      if (d.style) label(ctx, d.style, tx, y + nb - 6 * U, 20 * U, th.accent, { tr: 0.12, weight: 700 });
      y += nb + 22 * U;
      const footH = 46 * U;
      const bot = H - m - footH;
      const court = (box) => {
        const P = L.diagram(ctx, box, d.diagram, th, { persp: 0.26, lines: d.lines || 'simple', labels: 'none' });
        const lx = P.court.x - 14 * U;
        [['Opponent', 0.25], ['Your', 0.75]].forEach(([t, v]) => {
          const py = P(0, v).y;
          label(ctx, t, lx, py - 4 * U, 14 * U, th.muted, { align: 'right', tr: 0.16, weight: 700 });
          label(ctx, 'side', lx, py + 15 * U, 14 * U, th.muted, { align: 'right', tr: 0.16, weight: 700 });
        });
      };
      const headlineBox = (x, yy, w, h) => {
        const c = panel(ctx, x, yy, w, h, th, U, { pad: 20 });
        L.fit(ctx, { ...c, valign: 'middle' }, 46 * U, 10 * U, (f, s) => lines(d.headline).forEach((l) => f.text(up(l), { size: s, fam: th.HF, weight: th.HW, color: th.text, lh: 1.08 })));
      };
      const listPanel = (x, yy, w, h, title, items, marker) => {
        const c = panel(ctx, x, yy, w, h, th, U, { title, ts: 24 });
        bullets(ctx, c, lines(items), th, U, { marker, max: 22, gap: 0.45 });
      };
      if (land) {
        const lw = (W - 2 * m - gap) * 0.58, rw = W - 2 * m - gap - lw;
        const ch = (bot - y) * 0.66;
        court({ x: m + 90 * U, y, w: lw - 90 * U, h: ch });
        const bw = (lw - 2 * gap) / 3, by = y + ch + gap, bh = bot - by;
        listPanel(m, by, bw, bh, 'What it creates', d.creates, 'dot');
        listPanel(m + bw + gap, by, bw, bh, 'Things to watch', d.watch, 'dot');
        listPanel(m + 2 * (bw + gap), by, bw, bh, 'Drills to train it', d.drills, 'dot');
        const rx = m + lw + gap;
        const fr = [0.18, 0.3, 0.28, 0.24];
        const av = bot - y - gap * 3;
        let yy = y;
        const hs = fr.map((f) => f * av);
        headlineBox(rx, yy, rw, hs[0]); yy += hs[0] + gap;
        listPanel(rx, yy, rw, hs[1], 'When to use', d.when, 'check'); yy += hs[1] + gap;
        listPanel(rx, yy, rw, hs[2], 'Key focus', d.focus, 'check'); yy += hs[2] + gap;
        listPanel(rx, yy, rw, hs[3], 'Common cues', d.cues, 'check');
      } else {
        const ch = (bot - y) * 0.34;
        court({ x: m + 80 * U, y, w: W - 2 * m - 160 * U, h: ch });
        let yy = y + ch + gap;
        const hlH = (bot - yy) * 0.12;
        headlineBox(m, yy, W - 2 * m, hlH);
        yy += hlH + gap;
        const cw = (W - 2 * m - gap) / 2, rh = (bot - yy - 2 * gap) / 3;
        const grid = [['When to use', d.when, 'check'], ['Key focus', d.focus, 'check'], ['What it creates', d.creates, 'dot'], ['Things to watch', d.watch, 'dot'], ['Drills to train it', d.drills, 'dot'], ['Common cues', d.cues, 'check']];
        grid.forEach(([t, it, mk], i) => listPanel(m + (i % 2) * (cw + gap), yy + Math.floor(i / 2) * (rh + gap), cw, rh, t, it, mk));
      }
      footerBar(ctx, W, H - m - footH + 14 * U, m, th, U, true, d.footer, 'Play · Learn · Evolve', g);
    },
  };

  /* ================= 5. Pressure / escapes ================= */
  const parseTargets = (s) => String(s || '').split(/\/|,|\bor\b/i).map((x) => x.trim().match(/^(\d)(?:\s*-\s*(\d))?/)).filter(Boolean).map((m) => (m[2] ? [+m[1], +m[2]] : [+m[1]]));
  const escapeDiagram = (zone, targets, kind) => {
    const D = { chips: [], arrows: [], zones: [], notes: [] };
    const toks = parseTargets(targets);
    const zs = [...new Set(toks.flat())];
    const col = kind === 1 ? '#2fa84f' : '#d8343a';
    if (kind === 1) zs.forEach((n) => D.zones.push({ side: 'O', n, color: 'green' }));
    const src = L.point('O' + zone);
    const self = zs.includes(+zone);
    if (!self && src) D.chips.push({ label: String(zone), p: src, color: '#2346d8' });
    toks.forEach((t) => {
      const p = L.point('O' + t.join('-'));
      if (p && src && !(t.length === 1 && t[0] === +zone)) D.arrows.push({ kind: 'ball', a: src, b: p, curve: false, label: '' });
    });
    zs.forEach((n) => D.chips.push({ label: String(n), p: L.point('O' + n), color: col }));
    return D;
  };
  T.pressure = {
    name: 'Pressure / escapes',
    blurb: 'Stuck in a zone? First and second options, each with its own mini court.',
    sizes: ['letterL', 'letterP', 'story', 'portrait', 'wide'],
    fields: [
      { k: 'title', label: 'Title', type: 'text' },
      { k: 'subtitle', label: 'Sub-title', type: 'text' },
      { k: 'motto', label: 'Header right', type: 'textarea', rows: 3 },
      { k: 'zones', label: 'Quick fill: zones', type: 'text', help: 'Type zones like 1, 3, 5 and press "Fill rows from court logic".' },
      { k: 'rows', label: 'Rows', type: 'textarea', rows: 6, help: 'zone | first targets | first note | second targets | second note' },
      { k: 'tagline', label: 'Bottom tagline', type: 'textarea', rows: 2 },
      { k: 'reminders', label: 'Key reminders', type: 'textarea', rows: 5 },
    ],
    actions: [{
      label: 'Fill rows from court logic',
      run(d) {
        const zs = String(d.zones || '').split(/[\s,]+/).map(Number).filter((n) => n >= 1 && n <= 9);
        return { ...d, rows: zs.map((z) => [z, ...L.LOGIC[z]].join(' | ')).join('\n') };
      },
    }],
    render(ctx, W, H, d, th, g) {
      L.bg(ctx, W, H, th);
      const U = Math.min(W, H) / 1275, m = 40 * U, gap = 12 * U;
      const b = L.brand(ctx, m, m + 6 * U, 26 * U, th, g.brand, g.logo);
      const dx = m + b.w + 28 * U;
      ctx.fillStyle = th.line;
      ctx.fillRect(dx, m, 1.5 * U, 70 * U);
      const title = up(d.title);
      const ts = L.fitLine(ctx, title, W - dx - m - 220 * U, 64 * U, th.HF, th.HW);
      ctx.save();
      Object.assign(ctx, headShadow(U));
      ctx.font = HF(th, ts);
      let x = dx + 26 * U;
      for (const part of title.split(/(\/)/)) {
        ctx.fillStyle = part === '/' ? th.accent : th.text;
        ctx.fillText(part, x, m + ts * 0.74);
        x += ctx.measureText(part).width;
      }
      ctx.restore();
      if (d.subtitle) label(ctx, d.subtitle, dx + 26 * U, m + ts * 0.74 + 26 * U, 16 * U, th.muted, { tr: 0.3 });
      lines(d.motto).forEach((l, i) => label(ctx, l, W - m, m + 14 * U + i * 18 * U, 14 * U, th.muted, { align: 'right', tr: 0.2 }));

      let y = m + Math.max(ts * 0.74 + 40 * U, 80 * U) + 18 * U;
      const rows = cells(d.rows);
      const fr = [0.2, 0.4, 0.4];
      const cw = fr.map((f) => f * (W - 2 * m - 2 * gap));
      const cx = [m, m + cw[0] + gap, m + cw[0] + cw[1] + 2 * gap];
      const hdrH = 46 * U;
      [['Current zone', 'Where are you?'], ['First option', 'Preferred targets'], ['Second option', 'Alternate targets']].forEach(([a, s], i) => {
        const hs = Math.min(24 * U, L.fitLine(ctx, up(a), cw[i] - 20 * U, 24 * U, th.HF, th.HW));
        ctx.font = HF(th, hs);
        ctx.fillStyle = th.text;
        L.line(ctx, up(a), cx[i] + 10 * U, y + hs * 0.8);
        label(ctx, s, cx[i] + 10 * U, y + hs * 0.8 + 18 * U, 11 * U, th.muted, { tr: 0.24 });
      });
      y += hdrH + 8 * U;
      const land = W / H > 1.1;
      const bandH = (H - m - y) * (land ? 0.2 : 0.17);
      const rowsBot = H - m - bandH - gap;
      const n = Math.max(1, rows.length);
      const rh = (rowsBot - y - gap * (n - 1)) / n;
      rows.forEach((r, i) => {
        const ry = y + i * (rh + gap);
        const zone = parseInt(r[0], 10) || 0;
        // zone cell
        ctx.save();
        L.rr(ctx, cx[0], ry, cw[0], rh, 8 * U);
        ctx.fillStyle = th.cell;
        ctx.fill();
        ctx.restore();
        const bigS = Math.min(rh * 0.5, cw[0] * 0.42);
        ctx.font = HF(th, bigS);
        ctx.fillStyle = th.accent;
        L.line(ctx, String(zone || r[0]), cx[0] + cw[0] * 0.08, ry + rh / 2 + bigS * 0.36);
        const tx = cx[0] + cw[0] * 0.08 + ctx.measureText(String(zone || r[0])).width + 14 * U;
        L.fit(ctx, { x: tx, y: ry + 8 * U, w: cx[0] + cw[0] - tx - 10 * U, h: rh - 16 * U, valign: 'middle' }, 30 * U, 8 * U, (f, s) => {
          f.text(`STUCK ${zone || ''}`, { size: s, fam: th.HF, weight: th.HW, color: th.cellInk, lh: 1.05 });
          f.gap(s * 0.15);
          f.text(`(${up(L.ZONE_NAMES[zone - 1] || '')})`, { size: s * 0.42, weight: 700, color: L.rgba(th.cellInk, 0.65), tr: 0.14 });
        });
        // option cells
        [[1, r[1], r[2]], [2, r[3], r[4]]].forEach(([kind, tg, note], k) => {
          const ox = cx[k + 1], ow = cw[k + 1];
          ctx.save();
          L.rr(ctx, ox, ry, ow, rh, 8 * U);
          ctx.fillStyle = th.panel;
          ctx.fill();
          ctx.strokeStyle = th.line;
          ctx.lineWidth = 1.5 * U;
          ctx.stroke();
          ctx.restore();
          const pad = 12 * U;
          const mcW = Math.min(ow * 0.44, (rh - 2 * pad) * 1.45);
          L.diagram(ctx, { x: ox + pad, y: ry + pad, w: mcW, h: rh - 2 * pad }, escapeDiagram(zone, tg, kind), th, { v0: 0, v1: 0.5, persp: 0.1, aspect: 0.72, lines: 'zones', labels: 'none' });
          const tx2 = ox + pad + mcW + 16 * U, tw = ox + ow - pad - tx2;
          const badgeH = Math.min(22 * U, rh * 0.16);
          L.fit(ctx, { x: tx2, y: ry + pad, w: tw, h: rh - 2 * pad - badgeH - 8 * U, valign: 'middle' }, 34 * U, 8 * U, (f, s) => {
            f.text(tg || '', { size: s, fam: th.HF, weight: th.HW, color: th.text, lh: 1.05 });
            f.gap(s * 0.25);
            if (f.draw) { ctx.fillStyle = th.line; ctx.fillRect(f.x, f.y, f.w, 1.2 * U); }
            f.gap(s * 0.3);
            f.text(note || '', { size: s * 0.5, weight: 500, color: th.text, lh: 1.3 });
          });
          const by = ry + rh - pad - badgeH / 2;
          const col = kind === 1 ? '#36c46a' : '#ff4d4f';
          L.marker(ctx, kind === 1 ? 'check' : 'num', tx2 + badgeH * 0.5, by, badgeH * 0.5, col, '2');
          label(ctx, kind === 1 ? 'First option' : 'Second option', tx2 + badgeH * 1.3, by + badgeH * 0.25, badgeH * 0.62, col, { tr: 0.1, weight: 800 });
        });
      });
      // bottom band
      const by = H - m - bandH;
      const tw = (W - 2 * m) * 0.36;
      L.fit(ctx, { x: m, y: by, w: tw, h: bandH, valign: 'middle' }, 40 * U, 10 * U, (f, s) => {
        lines(d.tagline).forEach((l) => f.text(up(l), { size: s, fam: th.HF, weight: th.HW, color: th.text, lh: 1.12, italic: true }));
        f.gap(s * 0.25);
        if (f.draw) { ctx.fillStyle = th.accent; ctx.fillRect(f.x, f.y, f.w * 0.55, 4 * U); }
        f.gap(4 * U);
      });
      const rx = m + tw + gap;
      const c = panel(ctx, rx, by, W - m - rx, bandH, th, U, { title: 'Key reminders', small: true, ts: 22 });
      bullets(ctx, c, lines(d.reminders), th, U, { max: 17, gap: 0.2, valign: 'middle' });
    },
  };

  /* ================= 6. Codebook ================= */
  T.codebook = {
    name: 'Language / codebook',
    blurb: 'Code word, action and usage — each code gets its colour.',
    sizes: ['letterP', 'story', 'portrait', 'letterL'],
    fields: [
      { k: 'title', label: 'Title', type: 'text' },
      { k: 'subtitle', label: 'Sub-title', type: 'text' },
      { k: 'head', label: 'Column headings', type: 'text', help: 'CODE | ACTION | USAGE / NOTES' },
      { k: 'rows', label: 'Rows', type: 'textarea', rows: 12, help: 'CODE | ACTION | notes | #colour (optional — known LAB codes are coloured automatically)' },
      { k: 'footer', label: 'Footer', type: 'text' },
    ],
    render(ctx, W, H, d, th, g) {
      L.bg(ctx, W, H, th);
      const U = Math.min(W, H) / 1275, m = 48 * U;
      const b = L.brand(ctx, m, m, 26 * U, th, g.brand, g.logo);
      let y = m + b.h + 44 * U;
      const title = up(d.title);
      const ts = L.fitLine(ctx, title, W - 2 * m, 92 * U, th.HF, th.HW);
      ctx.save();
      Object.assign(ctx, headShadow(U));
      ctx.font = HF(th, ts);
      ctx.fillStyle = th.text;
      L.line(ctx, title, m, y + ts * 0.73);
      ctx.restore();
      y += ts * 0.95;
      if (d.subtitle) { y += 26 * U; label(ctx, d.subtitle, m, y, 20 * U, th.accent, { tr: 0.3, weight: 700 }); }
      y += 30 * U;
      const footH = 50 * U;
      const rows = cells(d.rows);
      const head = String(d.head || 'CODE | ACTION | USAGE / NOTES').split('|').map((s) => s.trim());
      const box = { x: m, y, w: W - 2 * m, h: H - m - footH - y };
      const n = rows.length + 1;
      const rh = box.h / n;
      const cwf = [0.25, 0.27, 0.48];
      const cw = cwf.map((f) => f * box.w);
      const pad = 14 * U;
      let s = Math.min(rh * 0.46, 28 * U);
      const fits = (s) => rows.every((r) => [0, 1, 2].every((c) => {
        ctx.font = c === 0 ? HF(th, s) : L.font(c === 1 ? 700 : 500, s * (c === 2 ? 0.92 : 1), L.F.body);
        return L.width(ctx, c === 2 ? r[c] || '' : up(r[c] || ''), c === 0 ? s * 0.04 : 0) <= cw[c] - 2 * pad;
      }));
      while (s > 7 * U && !fits(s)) s -= 0.5 * U;
      // header
      const hs = Math.min(s * 0.62, 16 * U);
      head.forEach((h, c) => label(ctx, h, box.x + cw.slice(0, c).reduce((a, b) => a + b, 0) + pad, box.y + rh / 2 + hs * 0.36, hs, th.muted, { tr: 0.24, weight: 700 }));
      ctx.fillStyle = th.accent;
      ctx.fillRect(box.x, box.y + rh - 2 * U, box.w, 2 * U);
      rows.forEach((r, i) => {
        const ry = box.y + rh * (i + 1);
        const code = up(r[0] || '');
        const col = (r[3] && r[3].startsWith('#') ? r[3] : null) || L.CODE_COLORS[code] || th.accent;
        const inset = Math.max(1.5 * U, rh * 0.06);
        ctx.save();
        L.rr(ctx, box.x, ry + inset, cw[0] - 8 * U, rh - 2 * inset, 5 * U);
        ctx.fillStyle = col;
        ctx.fill();
        if (L.lum(col) < 0.03) { ctx.strokeStyle = th.line; ctx.lineWidth = 1.2 * U; ctx.stroke(); }
        ctx.restore();
        const bl = L.baseline(ry, rh, s);
        ctx.font = HF(th, s);
        ctx.fillStyle = L.ink(col);
        L.line(ctx, code, box.x + pad, bl, { tr: s * 0.04 });
        ctx.font = L.font(700, s, L.F.body);
        ctx.fillStyle = th.text;
        L.line(ctx, up(r[1] || ''), box.x + cw[0] + pad, bl);
        ctx.font = L.font(500, s * 0.92, L.F.body);
        ctx.fillStyle = th.muted;
        L.line(ctx, r[2] || '', box.x + cw[0] + cw[1] + pad, L.baseline(ry, rh, s * 0.92));
        if (i < rows.length - 1) { ctx.fillStyle = th.line; ctx.fillRect(box.x + cw[0], ry + rh, box.w - cw[0], 1 * U); }
      });
      footerBar(ctx, W, H - m - footH + 16 * U, m, th, U, true, d.footer, '', g);
    },
  };
})();
