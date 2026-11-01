/* THE LAB · Graphics Studio — drawing engine
   Canvas helpers: text fitting, brand mark, court + zone grid, diagram language. */
(function () {
  const L = (window.LAB = window.LAB || {});

  L.F = {
    heavy: '"Archivo Black","Arial Black",Impact,sans-serif',
    cond: '"Oswald","Arial Narrow","Roboto Condensed",Impact,sans-serif',
    body: '"Archivo","Helvetica Neue",Arial,sans-serif',
  };
  L.font = (w, s, f) => `${w} ${Math.max(1, s).toFixed(2)}px ${f}`;

  /* ---------- colour ---------- */
  L.hex = (h) => {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  L.rgba = (h, a) => {
    if (!String(h).startsWith('#')) return h;
    const [r, g, b] = L.hex(h);
    return `rgba(${r},${g},${b},${a})`;
  };
  L.lum = (h) => {
    const [r, g, b] = L.hex(h).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  L.ink = (h) => (L.lum(h) > 0.4 ? '#0b0f14' : '#ffffff');

  /* ---------- text ---------- */
  L.width = (ctx, s, tr = 0) => {
    s = String(s);
    if (!tr) return ctx.measureText(s).width;
    let w = 0;
    for (const ch of s) w += ctx.measureText(ch).width + tr;
    return w - tr;
  };
  L.line = (ctx, s, x, y, o = {}) => {
    const { align = 'left', tr = 0 } = o;
    s = String(s);
    const w = L.width(ctx, s, tr);
    let sx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if (!tr) {
      ctx.fillText(s, sx, y);
      return w;
    }
    for (const ch of s) {
      ctx.fillText(ch, sx, y);
      sx += ctx.measureText(ch).width + tr;
    }
    return w;
  };
  L.wrap = (ctx, text, maxW, tr = 0) => {
    const out = [];
    for (const para of String(text == null ? '' : text).split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) {
        out.push('');
        continue;
      }
      let cur = words[0];
      for (let i = 1; i < words.length; i++) {
        const t = cur + ' ' + words[i];
        if (L.width(ctx, t, tr) <= maxW) cur = t;
        else {
          out.push(cur);
          cur = words[i];
        }
      }
      out.push(cur);
    }
    return out;
  };
  /* Largest size (<= max) at which a single line fits maxW. */
  L.fitLine = (ctx, text, maxW, max, fam, weight = 400, tr = 0) => {
    ctx.font = L.font(weight, max, fam);
    const w = L.width(ctx, text, tr * max);
    return w > maxW ? (max * maxW) / w : max;
  };
  /* Cap height ratio used to vertically centre caps inside a line box. */
  const CAP = 0.72;
  L.baseline = (top, lineH, size) => top + (lineH + size * CAP) / 2;

  /* A vertical text cursor. draw=false measures only. */
  class Flow {
    constructor(ctx, x, y, w, draw) {
      Object.assign(this, { ctx, x, y, w, draw, y0: y, overflow: false });
    }
    get h() {
      return this.y - this.y0;
    }
    gap(n) {
      this.y += n;
    }
    text(str, o = {}) {
      const {
        size = 20, weight = 400, fam = L.F.body, color = '#fff', lh = 1.25,
        align = 'left', tr = 0, indent = 0, italic = false, shadow = null,
      } = o;
      if (str == null || str === '') return 0;
      const c = this.ctx;
      c.font = (italic ? 'italic ' : '') + L.font(weight, size, fam);
      const w = this.w - indent;
      const trPx = tr * size;
      const lines = L.wrap(c, str, w, trPx);
      const lH = size * lh;
      for (const ln of lines) if (L.width(c, ln, trPx) > w + 0.5) this.overflow = true;
      if (this.draw) {
        c.save();
        c.fillStyle = color;
        if (shadow) Object.assign(c, shadow);
        lines.forEach((ln, i) => {
          const bl = L.baseline(this.y + i * lH, lH, size);
          const ax = align === 'center' ? this.x + indent + w / 2 : align === 'right' ? this.x + this.w : this.x + indent;
          L.line(c, ln, ax, bl, { align, tr: trPx });
        });
        c.restore();
      }
      const h = lines.length * lH;
      this.y += h;
      return h;
    }
    bullet(str, o = {}) {
      const size = o.size || 20;
      const lH = size * (o.lh || 1.25);
      const ind = size * (o.markerW || 1.45);
      const top = this.y;
      const h = this.text(str, { ...o, indent: ind });
      if (this.draw && h) L.marker(this.ctx, o.marker || 'dot', this.x + size * 0.55, top + lH / 2, size * 0.45, o.mcolor || o.color || '#fff', o.mtext);
      return h;
    }
  }
  L.Flow = Flow;

  /* Find the biggest base size s in [min,max] for which fn(flow, s) fits box. */
  L.fit = (ctx, box, max, min, fn) => {
    let s = max;
    const step = Math.max(0.25, (max - min) / 48);
    for (; s > min; s -= step) {
      const f = new Flow(ctx, box.x, box.y, box.w, false);
      fn(f, s);
      if (f.h <= box.h && !f.overflow) break;
    }
    s = Math.max(s, min);
    const m = new Flow(ctx, box.x, box.y, box.w, false);
    fn(m, s);
    const off = box.valign === 'middle' ? Math.max(0, (box.h - m.h) / 2) : box.valign === 'bottom' ? Math.max(0, box.h - m.h) : 0;
    const f = new Flow(ctx, box.x, box.y + off, box.w, true);
    fn(f, s);
    return { s, h: f.h, top: box.y + off };
  };

  /* ---------- shapes ---------- */
  L.rr = (ctx, x, y, w, h, r) => {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  L.marker = (ctx, kind, x, y, r, color, text) => {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (kind === 'dot') {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'ring') {
      ctx.lineWidth = r * 0.22;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'check' || kind === 'x') {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = L.ink(color.startsWith('#') ? color : '#000000');
      ctx.lineWidth = r * 0.26;
      ctx.beginPath();
      if (kind === 'check') {
        ctx.moveTo(x - r * 0.45, y + r * 0.02);
        ctx.lineTo(x - r * 0.1, y + r * 0.38);
        ctx.lineTo(x + r * 0.48, y - r * 0.36);
      } else {
        ctx.moveTo(x - r * 0.38, y - r * 0.38);
        ctx.lineTo(x + r * 0.38, y + r * 0.38);
        ctx.moveTo(x + r * 0.38, y - r * 0.38);
        ctx.lineTo(x - r * 0.38, y + r * 0.38);
      }
      ctx.stroke();
    } else if (kind === 'num') {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = L.ink(color.startsWith('#') ? color : '#000000');
      ctx.font = L.font(400, r * 1.15, L.F.heavy);
      L.line(ctx, String(text || ''), x, y + r * 0.42, { align: 'center' });
    } else if (kind === 'dash') {
      ctx.lineWidth = r * 0.3;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.6, y);
      ctx.lineTo(x + r * 0.6, y);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* Brand mark. Draws an uploaded logo if given, else the text with tracking.
     "THE LAB" gets the open-triangle A. Returns {w,h}. */
  L.brand = (ctx, x, y, size, th, text, logo, align = 'left') => {
    if (logo && logo.complete && logo.naturalWidth) {
      const h = size * 1.9;
      const w = (logo.naturalWidth / logo.naturalHeight) * h;
      const sx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      ctx.drawImage(logo, sx, y, w, h);
      return { w, h };
    }
    text = String(text || '').trim();
    if (!text) return { w: 0, h: 0 };
    ctx.save();
    ctx.font = L.font(600, size, L.F.body);
    ctx.fillStyle = th.text;
    const tr = size * 0.42;
    const bl = y + size * CAP;
    const isLab = /^THE LAB$/i.test(text);
    if (!isLab) {
      const t = text.toUpperCase();
      const w = L.width(ctx, t, tr);
      const sx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      L.line(ctx, t, sx, bl, { tr });
      ctx.restore();
      return { w, h: size * CAP };
    }
    const a = 'THE L';
    const tri = size * 0.74;
    const wa = L.width(ctx, a, tr);
    const wb = ctx.measureText('B').width;
    const total = wa + tr + tri + tr + wb;
    let sx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
    L.line(ctx, a, sx, bl, { tr });
    sx += wa + tr;
    ctx.strokeStyle = th.text;
    ctx.lineWidth = size * 0.12;
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    ctx.moveTo(sx + size * 0.04, bl);
    ctx.lineTo(sx + tri / 2, bl - size * CAP + size * 0.04);
    ctx.lineTo(sx + tri - size * 0.04, bl);
    ctx.stroke();
    sx += tri + tr;
    ctx.fillText('B', sx, bl);
    ctx.restore();
    return { w: total, h: size * CAP };
  };

  /* ---------- court geometry ----------
     u: 0 = left sideline → 1 = right sideline
     v: 0 = opponent baseline → 0.5 = net → 1 = your baseline
     Real proportions: 44 ft long, kitchen 7 ft, mid/deep split the remaining 15 ft. */
  const FT = 44;
  const ROWS = {
    O: [[0, 7.5], [7.5, 15], [15, 22]],
    Y: [[36.5, 44], [29, 36.5], [22, 29]],
  };
  L.ZONE_NAMES = ['Left Deep', 'Middle Deep', 'Right Deep', 'Left Mid', 'Middle Mid', 'Right Mid', 'Left Kitchen', 'Middle Kitchen', 'Right Kitchen'];
  L.zoneRect = (side, n) => {
    const col = (n - 1) % 3, r = Math.floor((n - 1) / 3);
    const [a, b] = ROWS[side][r];
    return { u0: col / 3, u1: (col + 1) / 3, v0: a / FT, v1: b / FT };
  };
  L.zoneCenter = (side, n) => {
    const z = L.zoneRect(side, n);
    return { u: (z.u0 + z.u1) / 2, v: (z.v0 + z.v1) / 2 };
  };

  /* Point language:
       O7  Y5        zone centre (O = opponent side, Y = your side)
       O7-8  Y5/6    seam between two zones
       Y7^           front edge of the zone (toward the net)
       Y1_           back edge of the zone (toward the baseline)
       0.25,0.8      raw court coordinates (u,v) */
  L.point = (spec, defSide = 'Y') => {
    spec = String(spec || '').trim();
    let m = spec.match(/^([OYoy])?(\d)(?:[\/\-+](\d))?([\^_])?$/);
    if (m) {
      const s = (m[1] || defSide).toUpperCase();
      const a = +m[2];
      if (a < 1 || a > 9) return null;
      const zones = [[s, a]];
      let c = L.zoneCenter(s, a);
      if (m[3] && +m[3] >= 1 && +m[3] <= 9) {
        const c2 = L.zoneCenter(s, +m[3]);
        c = { u: (c.u + c2.u) / 2, v: (c.v + c2.v) / 2 };
        zones.push([s, +m[3]]);
      }
      if (m[4]) {
        const z = L.zoneRect(s, a);
        const toNet = m[4] === '^';
        const front = s === 'O' ? z.v1 : z.v0;
        const back = s === 'O' ? z.v0 : z.v1;
        const edge = toNet ? front : back;
        c = { u: c.u, v: edge + (c.v - edge) * 0.25 };
      }
      return { ...c, zones };
    }
    m = spec.match(/^(-?[\d.]+)\s*,\s*(-?[\d.]+)$/);
    if (m) return { u: +m[1], v: +m[2], zones: [] };
    return null;
  };

  /* Perspective projector: maps (u,v) into a trapezoid inside x,y,w,h. */
  L.proj = (x, y, w, h, o = {}) => {
    const { persp = 0, v0 = 0, v1 = 1 } = o;
    const f = (u, v) => {
      const t = (v - v0) / (v1 - v0);
      const k = 1 - persp + persp * t;
      const ww = w * k;
      return { x: x + (w - ww) / 2 + u * ww, y: y + h * t, k };
    };
    f.box = { x, y, w, h, v0, v1, persp };
    return f;
  };

  const COLORS = {
    green: '#36c46a', red: '#ff4d4f', blue: '#3d7dff', yellow: '#ffd43b',
    orange: '#ff8a2a', purple: '#9b5cff', white: '#ffffff', teal: '#2fd3c4',
  };
  L.namedColor = (c, th) => {
    if (!c) return null;
    if (c === 'accent') return th.accent;
    if (c.startsWith('#')) return c;
    return COLORS[c.toLowerCase()] || null;
  };

  L.drawCourt = (ctx, P, th, o = {}) => {
    const { v0, v1, w } = P.box;
    const lines = o.lines || 'zones';
    const labels = o.labels || 'none';
    const lw = Math.max(1.5, w * 0.008);
    const sides = [];
    if (v0 < 0.5) sides.push('O');
    if (v1 > 0.5) sides.push('Y');
    const poly = (u0, a, u1, b) => {
      a = Math.max(a, v0);
      b = Math.min(b, v1);
      const p1 = P(u0, a), p2 = P(u1, a), p3 = P(u1, b), p4 = P(u0, b);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.closePath();
    };
    ctx.save();
    // surround shadow
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = w * 0.05;
    ctx.shadowOffsetY = w * 0.015;
    poly(-0.035, v0 - (v0 === 0 ? 0.012 : 0), 1.035, v1 + (v1 === 1 ? 0.012 : 0));
    ctx.fillStyle = L.rgba('#ffffff', 0.9);
    ctx.fill();
    ctx.restore();

    for (const s of sides) {
      const a = Math.max(s === 'O' ? 0 : 0.5, v0), b = Math.min(s === 'O' ? 0.5 : 1, v1);
      poly(0, a, 1, b);
      const g = ctx.createLinearGradient(0, P(0, a).y, 0, P(0, b).y);
      const base = s === 'O' ? th.opp : th.your;
      g.addColorStop(0, base);
      g.addColorStop(1, L.rgba(base, 0.86));
      ctx.fillStyle = g;
      ctx.fill();
    }
    for (const hl of o.highlights || []) {
      const z = L.zoneRect(hl.side, hl.n);
      if (z.v1 <= v0 || z.v0 >= v1) continue;
      ctx.save();
      poly(z.u0, z.v0, z.u1, z.v1);
      ctx.fillStyle = L.rgba(hl.color, 0.6);
      ctx.fill();
      ctx.clip();
      // diagonal hatch so a highlight reads even on a same-colour side
      const p0 = P(z.u0, z.v0), p1 = P(z.u1, z.v1);
      const span = Math.abs(p1.x - p0.x) + Math.abs(p1.y - p0.y) + w * 0.2;
      ctx.strokeStyle = 'rgba(255,255,255,0.32)';
      ctx.lineWidth = Math.max(1, lw * 0.6);
      for (let d = -span; d < span; d += w * 0.03) {
        ctx.beginPath();
        ctx.moveTo(p0.x + d - w * 0.1, p1.y + w * 0.1);
        ctx.lineTo(p0.x + d + span, p1.y - span);
        ctx.stroke();
      }
      ctx.restore();
      ctx.save();
      poly(z.u0, z.v0, z.u1, z.v1);
      ctx.strokeStyle = L.rgba(hl.color, 1);
      ctx.lineWidth = lw * 1.6;
      ctx.stroke();
      ctx.restore();
    }

    // lines
    ctx.strokeStyle = th.courtLine || '#f4f7fb';
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    const seg = (u0, a, u1, b) => {
      const p = P(u0, a), q = P(u1, b);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    };
    poly(0, v0, 1, v1);
    ctx.lineWidth = lw * 1.6;
    ctx.stroke();
    ctx.lineWidth = lw;
    for (const s of sides) {
      const [ra, rb] = s === 'O' ? [0, 22 / FT] : [22 / FT, 1];
      const a = Math.max(ra, v0), b = Math.min(rb, v1);
      const kitchen = s === 'O' ? 15 / FT : 29 / FT;
      if (kitchen > v0 && kitchen < v1) seg(0, kitchen, 1, kitchen);
      if (lines === 'zones') {
        seg(1 / 3, a, 1 / 3, b);
        seg(2 / 3, a, 2 / 3, b);
        const mid = s === 'O' ? 7.5 / FT : 36.5 / FT;
        if (mid > v0 && mid < v1) seg(0, mid, 1, mid);
      } else {
        const ka = s === 'O' ? a : kitchen, kb = s === 'O' ? kitchen : b;
        if (kb > ka) seg(0.5, ka, 0.5, kb);
      }
    }

    // labels
    if (labels !== 'none') {
      for (const s of sides) {
        for (let n = 1; n <= 9; n++) {
          const z = L.zoneRect(s, n);
          if (z.v1 <= v0 || z.v0 >= v1) continue;
          const c = P((z.u0 + z.u1) / 2, (z.v0 + z.v1) / 2);
          const zh = P(0.5, z.v1).y - P(0.5, z.v0).y;
          const zw = (P(1, (z.v0 + z.v1) / 2).x - P(0, (z.v0 + z.v1) / 2).x) / 3;
          const ns = Math.min(zh * 0.5, zw * 0.42);
          ctx.save();
          ctx.fillStyle = L.rgba('#ffffff', labels === 'faint' ? 0.22 : 0.97);
          ctx.shadowColor = 'rgba(0,0,0,0.35)';
          ctx.shadowBlur = ns * 0.15;
          ctx.shadowOffsetY = ns * 0.04;
          ctx.font = L.font(400, ns, L.F.heavy);
          const full = labels === 'full';
          const nameS = Math.min(ns * 0.24, L.fitLine(ctx, L.ZONE_NAMES[n - 1].toUpperCase(), zw * 0.9, ns * 0.24, L.F.body, 600, 0.08));
          const blockH = ns * CAP + (full ? nameS * 1.7 : 0);
          const top = c.y - blockH / 2;
          ctx.font = L.font(400, ns, L.F.heavy);
          L.line(ctx, String(n), c.x, top + ns * CAP, { align: 'center' });
          if (full) {
            ctx.font = L.font(600, nameS, L.F.body);
            L.line(ctx, L.ZONE_NAMES[n - 1].toUpperCase(), c.x, top + ns * CAP + nameS * 1.55, { align: 'center', tr: nameS * 0.08 });
          }
          ctx.restore();
        }
      }
    }

    // net
    if (v0 <= 0.5 && v1 >= 0.5 && o.net !== false) {
      const a = P(-0.04, 0.5), b = P(1.04, 0.5);
      const nh = Math.max(6, P.box.h * (v1 - v0 >= 0.9 ? 0.028 : 0.05));
      const top = a.y - nh * 0.75;
      ctx.save();
      ctx.fillStyle = 'rgba(8,14,24,0.88)';
      ctx.fillRect(a.x, top, b.x - a.x, nh);
      ctx.beginPath();
      ctx.rect(a.x, top, b.x - a.x, nh);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = Math.max(0.6, lw * 0.25);
      const step = Math.max(3, nh / 5);
      for (let xx = a.x; xx < b.x; xx += step) {
        ctx.beginPath();
        ctx.moveTo(xx, top);
        ctx.lineTo(xx, top + nh);
        ctx.stroke();
      }
      for (let yy = top; yy < top + nh; yy += step) {
        ctx.beginPath();
        ctx.moveTo(a.x, yy);
        ctx.lineTo(b.x, yy);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = '#e9eef5';
      ctx.fillRect(a.x, top - lw * 0.6, b.x - a.x, lw * 1.2);
      ctx.fillStyle = '#9aa6b5';
      ctx.fillRect(a.x - lw, top - lw, lw * 2, nh + lw * 1.5);
      ctx.fillRect(b.x - lw, top - lw, lw * 2, nh + lw * 1.5);
    }
  };

  L.chip = (ctx, x, y, r, label, o = {}) => {
    const fill = o.fill || '#2346d8';
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = r * 0.5;
    ctx.shadowOffsetY = r * 0.12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (o.ring !== false) {
      ctx.lineWidth = r * 0.14;
      ctx.strokeStyle = o.ring || '#ffffff';
      ctx.stroke();
    }
    label = String(label || '');
    if (label) {
      const s = r * (label.length > 2 ? 0.62 : label.length > 1 ? 0.8 : 1.0);
      ctx.font = L.font(400, s, L.F.heavy);
      ctx.fillStyle = o.text || L.ink(fill);
      L.line(ctx, label, x, y + s * 0.36, { align: 'center' });
    }
    ctx.restore();
  };

  const toward = (p, q, d) => {
    const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * d, y: p.y + (dy / len) * d };
  };
  L.arrow = (ctx, a, b, o = {}) => {
    const { color = '#fff', width = 4, dash = [3, 2.2], curve = 0, startPad = 0, endPad = 0, head = true } = o;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    if (len < startPad + endPad + 2) return;
    const nx = -dy / len, ny = dx / len;
    const c = { x: (a.x + b.x) / 2 + nx * curve * len, y: (a.y + b.y) / 2 + ny * curve * len };
    const s = toward(a, c, startPad);
    let e = toward(b, c, endPad);
    const hs = width * 3.4;
    const ang = Math.atan2(e.y - c.y, e.x - c.x);
    const tip = e;
    if (head) e = toward(e, c, hs * 0.7);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = width;
    if (dash) ctx.setLineDash(dash.map((d) => d * width));
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.quadraticCurveTo(c.x, c.y, e.x, e.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (head) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - hs * Math.cos(ang - 0.42), tip.y - hs * Math.sin(ang - 0.42));
      ctx.lineTo(tip.x - hs * Math.cos(ang + 0.42), tip.y - hs * Math.sin(ang + 0.42));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  };

  /* ---------- diagram language ----------
     P1 Y1              player chip (P* = your team, blue)
     D1 O3              opponent chip (D* = red)
     ball Y1 > O7 1     ball path, straight; optional step label at the end
     ball Y2 ~> O1      ball path, arced (lobs, drops)
     move Y1 > Y5/6 2   player movement (yellow)
     zone O7 O8         highlight zones (accent). hot O5 = red, cool O2 = blue
     chip X Y5 orange   any label, any colour
     note Y5 Hold here  small text label
     // comment */
  L.parseDiagram = (src) => {
    const out = { chips: [], arrows: [], zones: [], notes: [], errors: [] };
    String(src || '').split('\n').forEach((raw, i) => {
      const line = raw.replace(/\/\/.*$/, '').trim();
      if (!line) return;
      const t = line.split(/\s+/);
      const cmd = t[0].toLowerCase();
      const bad = () => out.errors.push(`Line ${i + 1}: "${raw.trim()}"`);
      if (cmd === 'ball' || cmd === 'move' || cmd === 'arrow') {
        const m = line.slice(t[0].length).trim().match(/^(\S+)\s*(~?>)\s*(\S+)(?:\s+(.+))?$/);
        if (!m) return bad();
        const a = L.point(m[1]), b = L.point(m[3]);
        if (!a || !b) return bad();
        out.arrows.push({ kind: cmd, a, b, curve: m[2] === '~>', label: (m[4] || '').trim() });
      } else if (cmd === 'zone' || cmd === 'target' || cmd === 'hot' || cmd === 'cool') {
        let color = cmd === 'hot' ? 'red' : cmd === 'cool' ? 'blue' : 'accent';
        t.slice(1).forEach((tok) => {
          if (L.namedColor(tok, { accent: '#000' }) && !L.point(tok)) {
            color = tok;
            return;
          }
          const p = L.point(tok, 'O');
          if (!p) return bad();
          p.zones.forEach(([s, n]) => out.zones.push({ side: s, n, color }));
        });
      } else if (cmd === 'chip') {
        const p = L.point(t[2]);
        if (!p) return bad();
        out.chips.push({ label: t[1], p, color: t[3] });
      } else if (cmd === 'note') {
        const p = L.point(t[1]);
        if (!p) return bad();
        out.notes.push({ p, text: t.slice(2).join(' ') });
      } else if (/^[A-Z]{1,3}\d{0,2}$/i.test(t[0]) && t[1] && L.point(t[1])) {
        out.chips.push({ label: t[0].toUpperCase(), p: L.point(t[1]), color: t[2] });
      } else bad();
    });
    return out;
  };

  /* Draw a court + diagram fitted into box. Returns projector. */
  L.diagram = (ctx, box, src, th, o = {}) => {
    const D = typeof src === 'object' && src && src.chips ? src : L.parseDiagram(src);
    const v0 = o.v0 ?? 0, v1 = o.v1 ?? 1;
    const persp = o.persp ?? 0.3;
    const span = v1 - v0;
    // visual aspect of the court (bottom width / height)
    const aspect = (o.aspect ?? 0.74) / span;
    let h = box.h, w = h * aspect;
    if (w > box.w) {
      w = box.w;
      h = w / aspect;
    }
    const x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2;
    const P = L.proj(x, y, w, h, { persp, v0, v1 });
    const highlights = [...(o.highlights || []), ...D.zones.map((z) => ({ ...z, color: L.namedColor(z.color, th) || th.accent }))];
    L.drawCourt(ctx, P, th, { lines: o.lines, labels: o.labels, highlights });
    const r = o.chipR || w * 0.065;
    const at = (p) => P(p.u, p.v);
    const chipAt = new Set(D.chips.map((c) => `${c.p.u.toFixed(3)},${c.p.v.toFixed(3)}`));
    for (const a of D.arrows) {
      const A = at(a.a), B = at(a.b);
      const startPad = chipAt.has(`${a.a.u.toFixed(3)},${a.a.v.toFixed(3)}`) ? r * 1.05 : 0;
      const endPad = a.label ? r * 0.85 : chipAt.has(`${a.b.u.toFixed(3)},${a.b.v.toFixed(3)}`) ? r * 1.1 : 0;
      const color = a.kind === 'move' ? th.move || '#ffd43b' : '#ffffff';
      L.arrow(ctx, A, B, { color, width: Math.max(2, w * 0.011), curve: a.curve ? -0.28 : 0, startPad, endPad, head: !a.label, dash: a.kind === 'move' ? [2.2, 1.8] : [3, 2] });
    }
    for (const c of D.chips) {
      const p = at(c.p);
      const first = c.label[0];
      const col = L.namedColor(c.color, th) || (first === 'D' ? '#e8383d' : first === 'P' ? '#2346d8' : th.accent);
      L.chip(ctx, p.x, p.y, r, c.label, { fill: col });
    }
    for (const a of D.arrows) {
      if (!a.label) continue;
      const p = at(a.b);
      const fill = a.kind === 'move' ? th.move || '#ffd43b' : '#1d3fae';
      L.chip(ctx, p.x, p.y, r * 0.82, a.label, { fill, ring: a.kind === 'move' ? '#3a2f00' : '#ffffff' });
    }
    for (const n of D.notes) {
      const p = at(n.p);
      ctx.save();
      const s = r * 0.62;
      ctx.font = L.font(700, s, L.F.body);
      const tw = L.width(ctx, n.text.toUpperCase(), s * 0.06);
      ctx.fillStyle = 'rgba(6,10,18,0.78)';
      L.rr(ctx, p.x - tw / 2 - s * 0.5, p.y - s * 0.8, tw + s, s * 1.6, s * 0.4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      L.line(ctx, n.text.toUpperCase(), p.x, p.y + s * 0.36, { align: 'center', tr: s * 0.06 });
      ctx.restore();
    }
    P.diagram = D;
    P.court = { x, y, w, h };
    return P;
  };
})();
