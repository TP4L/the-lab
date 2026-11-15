/* THE LAB / Performance — core.
   Owns: state, units, metrics, the session clock, the deterministic simulation,
   results + coach log, the stage (hero + minis), the timeline, and the shell cards.
   Surfaces and panels plug in through LABP.registerSurface / LABP.registerPanel. */
(function () {
  'use strict';
  var LABP = (window.LABP = window.LABP || {});
  var DATA = LABP.DATA;

  /* ================================================================ utils */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, u) { return a + (b - a) * u; }
  function ease(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
  function hash(str) {
    var x = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
    x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995); x ^= x >>> 15;
    return x >>> 0;
  }
  function rand(key) { return hash(String(key)) / 4294967296; }
  function randn(key) {
    var u = Math.max(rand(key + '|a'), 1e-9), v = rand(key + '|b');
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /* smooth 1-D value noise in 0..1; x is a continuous coordinate (e.g. seconds / period) */
  function noise(key, x) {
    var i = Math.floor(x), f = x - i;
    return lerp(rand(key + '|' + i), rand(key + '|' + (i + 1)), f * f * (3 - 2 * f));
  }
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]); }
    if (html != null) n.innerHTML = html;
    return n;
  }
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('labp:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('labp:' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del: function (k) { try { localStorage.removeItem('labp:' + k); } catch (e) { /* storage unavailable */ } }
  };
  var RM = false;
  try { RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* no matchMedia */ }

  LABP.util = { clamp: clamp, lerp: lerp, ease: ease, hash: hash, rand: rand, randn: randn, noise: noise, esc: esc, $: $, $$: $$, svg: svg, el: el, store: store };

  /* ================================================================ bus */
  var handlers = {};
  var bus = LABP.bus = {
    on: function (evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); return fn; },
    off: function (evt, fn) { var a = handlers[evt]; if (a) { var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
    emit: function (evt, data) {
      var a = handlers[evt]; if (!a) return;
      a.slice().forEach(function (fn) { try { fn(data); } catch (e) { console.error('[LABP] handler for "' + evt + '" failed', e); } });
    }
  };

  /* ================================================================ state */
  var LEN = 3600, DT = 2, START_T = 27 * 60 + 14;
  var ORDER = ['turf', 'weights', 'mat'];
  var state = LABP.state = {
    sessionId: 'hs', focus: 'turf',
    mode: 'live',        // live | replay | heat | plan
    follow: true,        // viewT tracks liveT
    playing: true,       // replay playback running
    rate: 1,             // sample-session speed
    liveT: START_T, viewT: START_T,
    selectedId: null, units: 'us', theme: 'auto',
    expanded: false, cycle: false, heatMetric: 'time', names: false, complete: false
  };
  var PERSIST = ['sessionId', 'focus', 'units', 'theme', 'heatMetric', 'names'];
  LABP.set = function (patch) {
    var keys = [];
    for (var k in patch) if (state[k] !== patch[k]) { state[k] = patch[k]; keys.push(k); }
    if (!keys.length) return;
    if (keys.some(function (k) { return PERSIST.indexOf(k) >= 0; })) {
      var p = {}; PERSIST.forEach(function (k) { p[k] = state[k]; }); store.set('prefs', p);
    }
    keys.forEach(function (k) { bus.emit('change:' + k, state[k]); });
    bus.emit('change', keys);
  };

  /* ================================================================ units */
  var YD_M = 0.9144, LB_KG = 0.45359237, IN_CM = 2.54, FT_M = 0.3048, YDPS_MPH = 3600 / 1760;
  function metric() { return state.units === 'metric'; }
  function num(v, d) { return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  var UNIT = {
    s: function (v, d) { return { v: num(v, d == null ? 2 : d), u: 's' }; },
    yd: function (v, d) { var x = metric() ? v * YD_M : v; return { v: num(x, d == null ? (Math.abs(x) < 100 ? 1 : 0) : d), u: metric() ? 'm' : 'yd' }; },
    ydps: function (v, d) { return metric() ? { v: num(v * YD_M, d == null ? 1 : d), u: 'm/s' } : { v: num(v * YDPS_MPH, d == null ? 1 : d), u: 'mph' }; },
    lb: function (v, d) { return metric() ? { v: num(Math.round(v * LB_KG * 2) / 2, d == null ? 1 : d), u: 'kg' } : { v: num(v, d == null ? 0 : d), u: 'lb' }; },
    'in': function (v, d) { return metric() ? { v: num(v * IN_CM, d == null ? 0 : d), u: 'cm' } : { v: num(v, d == null ? 1 : d), u: 'in' }; },
    ft: function (v, d) { return metric() ? { v: num(v * FT_M, d == null ? 1 : d), u: 'm' } : { v: num(v, d == null ? 1 : d), u: 'ft' }; },
    mps: function (v, d) { return { v: num(v, d == null ? 2 : d), u: 'm/s' }; },
    bpm: function (v) { return { v: num(v, 0), u: 'bpm' }; },
    pct: function (v, d) { return { v: num(v, d == null ? 0 : d), u: '%' }; },
    au: function (v) { return { v: num(v, 0), u: 'AU' }; },
    n: function (v, d) { return { v: num(v, d == null ? 0 : d), u: '' }; }
  };
  /* LABP.fmt('lb', 225) -> { v:'225', u:'lb', text:'225 lb' } and follows the US / metric toggle */
  LABP.fmt = function (unit, value, digits) {
    if (value == null || isNaN(value)) return { v: '–', u: '', text: '–' };
    var r = (UNIT[unit] || UNIT.n)(value, digits);
    r.text = r.u ? (r.u === '%' ? r.v + '%' : r.v + ' ' + r.u) : r.v;
    return r;
  };
  /* turn a number typed in the units on screen back into base units (yd, yd/s, lb, in, ft) */
  LABP.toBase = function (unit, v) {
    if (unit === 'ydps') return metric() ? v / YD_M : v / YDPS_MPH;
    if (!metric()) return v;
    return unit === 'yd' ? v / YD_M : unit === 'lb' ? v / LB_KG : unit === 'in' ? v / IN_CM : unit === 'ft' ? v / FT_M : v;
  };
  LABP.clock = function (s) {
    s = Math.max(0, Math.floor(s)); var m = Math.floor(s / 60), r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  };

  /* ================================================================ metrics */
  /* [worst, best] for an attribute score of 0 -> 1, by population */
  var RANGE = {
    t10: { kids: [2.75, 2.15], ms: [2.25, 1.85], hs: [1.98, 1.58], adult: [1.90, 1.52], exec: [2.45, 1.85] },
    t20: { kids: [4.70, 3.75], ms: [3.80, 3.10], hs: [3.30, 2.72], adult: [3.15, 2.62], exec: [4.20, 3.20] },
    t40: { kids: [8.60, 6.70], ms: [6.70, 5.40], hs: [5.65, 4.52], adult: [5.30, 4.40], exec: [7.40, 5.60] },
    fly10: { kids: [1.75, 1.35], ms: [1.38, 1.10], hs: [1.16, 0.95], adult: [1.08, 0.90], exec: [1.60, 1.20] },
    top: { kids: [5.6, 7.3], ms: [7.1, 9.0], hs: [8.6, 10.7], adult: [9.0, 11.0], exec: [6.1, 8.3] }, /* yd/s */
    agility: { kids: [6.60, 5.30], ms: [5.50, 4.70], hs: [4.95, 4.15], adult: [4.80, 4.05], exec: [6.20, 4.90] },
    vert: { kids: [8, 15], ms: [14, 22], hs: [19, 34], adult: [22, 36], exec: [10, 21] },
    broad: { kids: [42, 66], ms: [62, 88], hs: [84, 118], adult: [92, 124], exec: [52, 88] },
    mbthrow: { kids: [8, 16], ms: [14, 24], hs: [22, 40], adult: [26, 44], exec: [12, 26] },
    squat: { kids: [20, 45], ms: [75, 165], hs: [155, 405], adult: [205, 475], exec: [95, 285] },
    bench: { kids: [10, 25], ms: [55, 125], hs: [105, 275], adult: [135, 335], exec: [65, 225] },
    dead: { kids: [30, 65], ms: [105, 225], hs: [205, 475], adult: [255, 545], exec: [135, 365] }
  };
  function ranged(key, mix, sexF) {
    return function (a) {
      var R = RANGE[key][a.pop] || RANGE[key].hs, q = 0;
      for (var k in mix) q += a.attrs[k] * mix[k];
      q = clamp(q + 0.1 * (rand(a.id + '|' + key) - 0.5), 0, 1);
      var v = lerp(R[0], R[1], q);
      if (sexF && a.sex === 'F' && a.pop !== 'kids') v *= sexF;
      return v;
    };
  }
  var METRICS = LABP.METRICS = {};
  /* def: { label, unit (a LABP.fmt unit), better:'low'|'high', digits, round, source:'gates'|'gps'|'hr'|'bar'|'force'|'coach', base(athlete) } */
  LABP.defineMetric = function (key, def) {
    METRICS[key] = Object.assign({ key: key, label: key, unit: 'n', better: 'high', digits: null, round: 0, source: 'coach', base: null }, def);
    pbCache = {};
  };
  var pbCache = {};
  function roundMetric(m, v) {
    if (m.round) return Math.round(v / m.round) * m.round;
    var d = m.digits != null ? m.digits : (m.unit === 's' || m.unit === 'mps' ? 2 : 1);
    var p = Math.pow(10, d); return Math.round(v * p) / p;
  }
  /* the athlete's best coming into today */
  LABP.pb = function (a, key) {
    var m = METRICS[key]; if (!m || !m.base || !a) return null;
    var ck = a.id + '|' + key;
    if (pbCache[ck] == null) pbCache[ck] = roundMetric(m, m.base(a));
    return pbCache[ck];
  };
  /* one realistic rep: usually a little off the best, now and then a new best. Deterministic for a given seed. */
  LABP.rep = function (a, key, seed) {
    var m = METRICS[key], pb = LABP.pb(a, key); if (pb == null) return null;
    var k = seed + '|' + a.id + '|' + key, u = rand(k), g = Math.abs(randn(k + '|g'));
    var delta = u < 0.07 ? -(0.003 + 0.012 * rand(k + '|imp')) : 0.008 + 0.022 * g;
    return roundMetric(m, m.better === 'low' ? pb * (1 + delta) : pb * (1 - delta));
  };
  /* sample weekly bests leading up to today, oldest first; the last value is LABP.pb(a, key) */
  LABP.history = function (a, key, n) {
    n = n || 8; var m = METRICS[key], pb = LABP.pb(a, key), out = []; if (pb == null) return out;
    var rate = 0.005 + 0.009 * rand(a.id + '|hist|' + key);
    for (var i = 0; i < n; i++) {
      var back = n - 1 - i, d = back * rate + (back ? 0.01 * Math.abs(randn(a.id + '|hw|' + key + '|' + i)) : 0);
      out.push(roundMetric(m, m.better === 'low' ? pb * (1 + d) : pb * (1 - d)));
    }
    return out;
  };
  LABP.better = function (key, a, b) { var m = METRICS[key]; return m && m.better === 'low' ? a < b : a > b; };
  LABP.fmtMetric = function (key, value) { var m = METRICS[key]; return LABP.fmt(m ? m.unit : 'n', value, m && m.digits != null ? m.digits : undefined); };

  [
    ['t10', '10 yd', 's', 'low', 'gates', { spd: 0.7, pow: 0.3 }, 1.05],
    ['t20', '20 yd', 's', 'low', 'gates', { spd: 0.85, pow: 0.15 }, 1.06],
    ['t40', '40 yd', 's', 'low', 'gates', { spd: 1 }, 1.07],
    ['fly10', 'Flying 10', 's', 'low', 'gates', { spd: 1 }, 1.07],
    ['top', 'Top speed', 'ydps', 'high', 'gps', { spd: 1 }, 0.93],
    ['agility', '5-10-5', 's', 'low', 'gates', { spd: 0.5, skl: 0.5 }, 1.05],
    ['vert', 'Vertical', 'in', 'high', 'force', { pow: 1 }, 0.84],
    ['broad', 'Broad jump', 'in', 'high', 'coach', { pow: 0.85, str: 0.15 }, 0.88],
    ['mbthrow', 'Med-ball throw', 'ft', 'high', 'coach', { pow: 0.7, str: 0.3 }, 0.8]
  ].forEach(function (r) { LABP.defineMetric(r[0], { label: r[1], unit: r[2], better: r[3], source: r[4], base: ranged(r[0], r[5], r[6]) }); });
  [['squat', 'Squat', 0.7], ['bench', 'Bench', 0.62], ['dead', 'Trap-bar deadlift', 0.72]].forEach(function (r) {
    LABP.defineMetric(r[0], { label: r[1], unit: 'lb', better: 'high', round: 5, source: 'bar', base: ranged(r[0], { str: 0.85, pow: 0.15 }, r[2]) });
  });

  /* ================================================================ schedule */
  var SEGS = [
    { kind: 'prep', t0: 0, t1: 360, block: 0, label: 'Prep' },
    { kind: 'block', t0: 360, t1: 1320, block: 0, label: 'Block 1' },
    { kind: 'transit', t0: 1320, t1: 1440, block: 0, from: 0, to: 1, label: 'Rotate' },
    { kind: 'block', t0: 1440, t1: 2400, block: 1, label: 'Block 2' },
    { kind: 'transit', t0: 2400, t1: 2520, block: 1, from: 1, to: 2, label: 'Rotate' },
    { kind: 'block', t0: 2520, t1: 3480, block: 2, label: 'Block 3' },
    { kind: 'close', t0: 3480, t1: 3600, block: 2, label: 'Close' }
  ];
  function segAt(t) {
    t = clamp(t, 0, LEN - 0.001);
    for (var i = 0; i < SEGS.length; i++) if (t < SEGS[i].t1) return SEGS[i];
    return SEGS[SEGS.length - 1];
  }
  LABP.SCHED = { LEN: LEN, DT: DT, segs: SEGS, segAt: segAt, order: ORDER };

  /* ================================================================ session + membership */
  var S = null, byId = {}, moves = [], memCache = {};
  LABP.session = function () { return S; };
  LABP.athlete = function (id) { return byId[id] || null; };
  function memTable(t) {
    var n = 0; while (n < moves.length && moves[n].t <= t) n++;
    if (memCache[n]) return memCache[n];
    var podOf = {}, pods = {}, i;
    S.athletes.forEach(function (a) { podOf[a.id] = a.pod; });
    for (i = 0; i < n; i++) if (podOf[moves[i].athleteId]) podOf[moves[i].athleteId] = moves[i].toPod;
    S.pods.forEach(function (p) { pods[p.id] = []; });
    S.athletes.forEach(function (a) { (pods[podOf[a.id]] || (pods[podOf[a.id]] = [])).push(a); });
    return (memCache[n] = { podOf: podOf, pods: pods });
  }
  /* athletes in a pod at session time t, in slot order */
  LABP.members = function (podId, t) { return memTable(t).pods[podId] || []; };
  LABP.podOf = function (athleteId, t) { return memTable(t).podOf[athleteId]; };
  function podFor(sid, block) {
    for (var i = 0; i < S.pods.length; i++) if (S.rotation[S.pods[i].id][block] === sid) return S.pods[i].id;
    return S.pods[0].id;
  }
  LABP.podOnSurface = function (sid, t) { return phaseInfo(sid, t).podId; };
  LABP.surfaceOfPod = function (podId, t) {
    var seg = segAt(t), b = seg.block;
    if (seg.kind === 'transit' && t - seg.t0 >= (seg.t1 - seg.t0) / 2) b = seg.to;
    return S.rotation[podId][b];
  };
  LABP.surfaceOf = function (athleteId, t) { return LABP.surfaceOfPod(LABP.podOf(athleteId, t), t); };

  /* what a surface is running at time t */
  function phaseInfo(sid, t) {
    var seg = segAt(t), plan = S.plan[sid] || [], b = seg.block, x = t - seg.t0, dur = seg.t1 - seg.t0;
    if (seg.kind === 'prep' || seg.kind === 'close') {
      return {
        seg: seg, act: seg.kind, phase: { act: seg.kind, min: dur / 60, title: seg.kind === 'prep' ? 'Arrive & prep' : 'Close & debrief', note: '' },
        tIn: x, dur: dur, t0: seg.t0, t1: seg.t1, blockIndex: b, phaseIndex: seg.kind === 'prep' ? -1 : plan.length, podId: podFor(sid, b)
      };
    }
    if (seg.kind === 'transit') {
      var half = dur / 2, out = x < half, bb = out ? seg.from : seg.to;
      return {
        seg: seg, act: 'transit', dir: out ? 'out' : 'in', phase: { act: 'transit', min: 1, title: out ? 'Rotating out' : 'Rotating in', note: '' },
        tIn: out ? x : x - half, dur: half, t0: out ? seg.t0 : seg.t0 + half, t1: out ? seg.t0 + half : seg.t1,
        blockIndex: bb, phaseIndex: out ? plan.length : -1, podId: podFor(sid, bb)
      };
    }
    var acc = 0;
    for (var i = 0; i < plan.length; i++) {
      var d = plan[i].min * 60;
      if (x < acc + d || i === plan.length - 1) {
        return { seg: seg, act: plan[i].act, phase: plan[i], tIn: x - acc, dur: d, t0: seg.t0 + acc, t1: seg.t0 + acc + d, blockIndex: b, phaseIndex: i, podId: podFor(sid, b) };
      }
      acc += d;
    }
    return { seg: seg, act: 'open', phase: { act: 'open', min: dur / 60, title: 'Open floor', note: '' }, tIn: x, dur: dur, t0: seg.t0, t1: seg.t1, blockIndex: b, phaseIndex: 0, podId: podFor(sid, b) };
  }
  LABP.phaseAt = phaseInfo;

  /* ================================================================ surfaces */
  var SURF = LABP.surfaces = {};
  var SURF_DEFAULTS = {
    name: '', world: { w: 60, h: 30, unit: 'ft' }, heatCols: 36,
    activities: {}, cards: [], resultTypes: [], drawBase: null, overlay: null
  };
  /* See the build brief for the full contract. Later registrations for the same id replace earlier ones. */
  LABP.registerSurface = function (def) {
    SURF[def.id] = Object.assign({}, SURF_DEFAULTS, def);
    if (booted) { rebuild(); bus.emit('change', ['focus']); }
  };
  var PANELS = [];
  LABP.registerPanel = function (def) { PANELS.push(def); if (booted && def.init) safe(def.init, 'panel ' + def.id); };
  function safe(fn, what) { try { return fn(); } catch (e) { console.error('[LABP] ' + what + ' failed', e); } }

  /* generic "on the floor" behaviour for any activity a surface has not implemented */
  function mill(c) {
    var W = c.world.w, H = c.world.h, n = Math.max(1, c.n);
    var cols = Math.max(1, Math.ceil(Math.sqrt(n * W / H))), rows = Math.ceil(n / cols);
    var cx = ((c.slot % cols) + 0.5) / cols * W, cy = (Math.floor(c.slot / cols) + 0.5) / rows * H;
    var k = c.seed + '|mill|' + c.slot, r = Math.min(W / cols, H / rows) * 0.3;
    return {
      x: cx + (noise(k + 'x', c.t / 7) - 0.5) * 2 * r, y: cy + (noise(k + 'y', c.t / 7) - 0.5) * 2 * r,
      intensity: 0.2 + 0.22 * noise(k + 'i', c.t / 20), activity: c.act, label: (c.phase && c.phase.title) || 'On the floor'
    };
  }
  LABP.sim = { mill: mill };

  function slotState(surf, ph, t, slot, n, a) {
    if (ph.act === 'transit') return transitState(surf, ph, t, slot, n, a);
    var c = {
      t: t, tIn: ph.tIn, dur: ph.dur, u: ph.dur ? ph.tIn / ph.dur : 0, t0: ph.t0, t1: ph.t1,
      phase: ph.phase, act: ph.act, slot: slot, n: n, athlete: a, podId: ph.podId,
      blockIndex: ph.blockIndex, phaseIndex: ph.phaseIndex, session: S, surface: surf, world: surf.world,
      seed: S.id + '|' + surf.id + '|' + ph.blockIndex + '|' + ph.phaseIndex
    };
    var def = surf.activities[ph.act], st = null;
    if (def && def.slot) { try { st = def.slot(c); } catch (e) { if (!slotState.warned) { slotState.warned = true; console.error('[LABP] ' + surf.id + '.' + ph.act + '.slot failed', e); } } }
    if (!st) st = mill(c);
    var m = Math.max(surf.world.w, surf.world.h) * 0.03;
    st.x = clamp(+st.x || 0, -m, surf.world.w + m);
    st.y = clamp(+st.y || 0, -m, surf.world.h + m);
    st.intensity = clamp(st.intensity == null ? 0.3 : st.intensity, 0, 1);
    st.activity = st.activity || ph.act;
    if (st.label == null) st.label = (def && def.name) || (ph.phase && ph.phase.title) || '';
    return st;
  }
  function transitState(surf, ph, t, slot, n, a) {
    var seg = ph.seg, W = surf.world;
    var door = surf.door || { x: W.w / 2, y: W.h + Math.max(W.w, W.h) * 0.025 };
    var tt = ph.dir === 'out' ? seg.t0 - 0.05 : seg.t1 + 0.05;
    var anchor = slotState(surf, phaseInfo(surf.id, tt), tt, slot, n, a);
    var gap = Math.min(5, ph.dur / (n + 3));
    var u = ease((ph.tIn - slot * gap) / Math.max(1, ph.dur - n * gap));
    var dx = door.x + (slot - (n - 1) / 2) * W.w * 0.025;
    var from = ph.dir === 'out' ? anchor : { x: dx, y: door.y }, to = ph.dir === 'out' ? { x: dx, y: door.y } : anchor;
    return { x: lerp(from.x, to.x, u), y: lerp(from.y, to.y, u), intensity: 0.14, activity: 'transit', label: ph.dir === 'out' ? 'Rotating out' : 'Rotating in' };
  }

  /* everything on one surface at one moment */
  var frameCache = {};
  LABP.frame = function (sid, t) {
    var fc = frameCache[sid];
    if (fc && fc.t === t && fc.gen === gen) return fc.frame;
    var surf = SURF[sid], ph = phaseInfo(sid, t), mem = surf ? LABP.members(ph.podId, t) : [];
    var frame = {
      t: t, surfaceId: sid, surface: surf, ph: ph, phase: ph.phase, act: ph.act, tIn: ph.tIn, dur: ph.dur,
      podId: ph.podId, blockIndex: ph.blockIndex, phaseIndex: ph.phaseIndex, key: sid + '|' + ph.seg.t0 + '|' + ph.phaseIndex + '|' + ph.act + '|' + gen,
      members: mem.map(function (a, i) { return { athlete: a, slot: i, n: mem.length, st: slotState(surf, ph, t, i, mem.length, a) }; })
    };
    frameCache[sid] = { t: t, gen: gen, frame: frame };
    return frame;
  };
  /* where one athlete is and what they are doing at time t */
  LABP.stateOf = function (athleteId, t) {
    var mt = memTable(t), podId = mt.podOf[athleteId]; if (!podId) return null;
    var sid = LABP.surfaceOfPod(podId, t), mem = mt.pods[podId], slot = -1;
    for (var i = 0; i < mem.length; i++) if (mem[i].id === athleteId) { slot = i; break; }
    var surf = SURF[sid]; if (!surf || slot < 0) return null;
    var ph = phaseInfo(sid, t);
    return { surfaceId: sid, podId: podId, slot: slot, n: mem.length, ph: ph, st: slotState(surf, ph, t, slot, mem.length, byId[athleteId]) };
  };

  /* ================================================================ simulation build */
  var series = {}, EVENTS = [], gen = 0, booted = false;
  function rebuild() {
    gen++; memCache = {}; frameCache = {}; slotState.warned = false;
    moves = log.items.filter(function (e) { return e.type === 'move'; }).sort(function (a, b) { return a.t - b.t; });
    var N = Math.floor(LEN / DT) + 1; series = {};
    S.athletes.forEach(function (a) {
      series[a.id] = { hr: new Float32Array(N), x: new Float32Array(N), y: new Float32Array(N), surf: new Int8Array(N), inten: new Float32Array(N), spd: new Float32Array(N), load: new Float32Array(N), dist: new Float32Array(N), top: new Float32Array(N) };
    });
    for (var k = 0; k < N; k++) {
      var t = Math.min(k * DT, LEN - 0.001);
      for (var si = 0; si < ORDER.length; si++) {
        var surf = SURF[ORDER[si]]; if (!surf) continue;
        var ph = phaseInfo(surf.id, t), mem = LABP.members(ph.podId, t), toYd = surf.world.unit === 'yd' ? 1 : 1 / 3;
        for (var i = 0; i < mem.length; i++) {
          var st = slotState(surf, ph, t, i, mem.length, mem[i]), s = series[mem[i].id];
          s.x[k] = st.x; s.y[k] = st.y; s.surf[k] = si; s.inten[k] = st.intensity; s.spd[k] = (st.speed || 0) * toYd;
        }
      }
    }
    S.athletes.forEach(function (a) {
      var s = series[a.id], rest = a.ready.rhr + 14, hr = rest + 6, load = 0, dist = 0, top = 0;
      for (var k = 0; k < N; k++) {
        var hrr = clamp(0.05 + Math.pow(s.inten[k], 0.85) * (1.02 - 0.2 * a.attrs.end), 0, 1);
        var target = rest + hrr * (a.hrMax - rest), tau = target > hr ? 16 : 36;
        hr += (target - hr) * (1 - Math.exp(-DT / tau));
        s.hr[k] = hr + 3.2 * (noise(a.id + '|hrn', k / 4) - 0.5);
        var frac = clamp((s.hr[k] - a.ready.rhr) / (a.hrMax - a.ready.rhr), 0, 1);
        load += (DT / 60) * frac * 0.64 * Math.exp(1.92 * frac); s.load[k] = load;
        dist += s.spd[k] * DT; s.dist[k] = dist;
        if (s.spd[k] > top) top = s.spd[k]; s.top[k] = top;
      }
    });
    buildEvents();
    bus.emit('rebuild');
  }
  function buildEvents() {
    var evs = [];
    ORDER.forEach(function (sid) {
      var surf = SURF[sid]; if (!surf) return;
      SEGS.forEach(function (seg) {
        if (seg.kind === 'transit') return;
        var podId = podFor(sid, seg.block), plan = S.plan[sid] || [], phases = [], acc = seg.t0;
        if (seg.kind === 'block') plan.forEach(function (p, i) { phases.push({ phase: p, i: i, t0: acc, t1: acc + p.min * 60 }); acc += p.min * 60; });
        else phases.push({ phase: { act: seg.kind, title: seg.label }, i: seg.kind === 'prep' ? -1 : plan.length, t0: seg.t0, t1: seg.t1 });
        phases.forEach(function (p) {
          var def = surf.activities[p.phase.act]; if (!def || !def.events) return;
          var c = {
            t0: p.t0, t1: p.t1, dur: p.t1 - p.t0, phase: p.phase, act: p.phase.act, podId: podId, blockIndex: seg.block, phaseIndex: p.i,
            session: S, surface: surf, world: surf.world, seed: S.id + '|' + sid + '|' + seg.block + '|' + p.i,
            members: function (t) { return LABP.members(podId, t); },
            member: function (slot, t) { return LABP.members(podId, t)[slot] || null; }
          };
          var out = safe(function () { return def.events(c); }, sid + '.' + p.phase.act + '.events') || [];
          out.forEach(function (e) {
            if (e && e.t >= p.t0 - 0.001 && e.t <= p.t1 + 0.001) evs.push(Object.assign({ surface: sid, act: p.phase.act, blockIndex: seg.block, phaseIndex: p.i, source: 'sim' }, e));
          });
        });
      });
    });
    /* heart-rate spikes, read off the HR stream */
    S.athletes.forEach(function (a) {
      var s = series[a.id], last = -99;
      for (var k = 10; k < s.hr.length; k++) {
        if (s.hr[k] - s.hr[k - 10] >= 26 && s.hr[k] >= 0.86 * a.hrMax && k - last > 45) {
          last = k;
          evs.push({ t: k * DT, athleteId: a.id, surface: ORDER[s.surf[k]], kind: 'spike', label: 'HR spike', value: Math.round(s.hr[k]), unit: 'bpm', source: 'hr' });
        }
      }
    });
    simEvents = evs;
    mergeLog();
  }
  var simEvents = [];
  function mergeLog() {
    var evs = simEvents.slice();
    log.items.forEach(function (e) {
      if (e.type === 'tag') evs.push({ t: e.t, athleteId: e.athleteId, surface: e.surface, kind: 'tag', label: e.tag, source: 'coach', logId: e.id });
      else if (e.type === 'result') evs.push({ t: e.t, athleteId: e.athleteId, surface: e.surface, kind: 'result', metric: e.metric || null, label: e.label, value: e.value, unit: e.unit, source: 'coach', logId: e.id });
      else if (e.type === 'move') evs.push({ t: e.t, athleteId: e.athleteId, surface: e.surface, kind: 'move', label: 'Moved to ' + ((SURF[e.surface] || {}).name || e.surface), source: 'coach', logId: e.id });
      else if (e.type === 'note') evs.push({ t: e.t, athleteId: e.athleteId, surface: e.surface, kind: 'note', label: e.text, source: 'coach', logId: e.id });
    });
    evs.sort(function (a, b) { return a.t - b.t; });
    var best = {};
    evs.forEach(function (e, i) {
      e.id = i; delete e.pb;
      if (!e.metric || e.value == null || !e.athleteId || !METRICS[e.metric]) return;
      var k = e.athleteId + '|' + e.metric, cur = best[k];
      if (cur === undefined) cur = LABP.pb(byId[e.athleteId], e.metric);
      if (cur == null) { best[k] = e.value; return; }
      if (LABP.better(e.metric, e.value, cur)) { e.pb = true; e.prev = cur; best[k] = e.value; } else best[k] = cur;
    });
    EVENTS = evs;
    bus.emit('events');
  }

  /* heart rate, load and distance for one athlete at time t (interpolated from the stream) */
  LABP.vitals = function (athleteId, t) {
    var s = series[athleteId], a = byId[athleteId]; if (!s || !a) return null;
    var x = clamp(t, 0, LEN) / DT, k = Math.min(Math.floor(x), s.hr.length - 2), f = x - k;
    var hr = lerp(s.hr[k], s.hr[k + 1], f), pct = hr / a.hrMax;
    return {
      hr: Math.round(hr), pct: pct, zone: pct >= 0.9 ? 5 : pct >= 0.8 ? 4 : pct >= 0.7 ? 3 : pct >= 0.6 ? 2 : 1,
      load: lerp(s.load[k], s.load[k + 1], f), dist: lerp(s.dist[k], s.dist[k + 1], f), top: s.top[k],
      speed: s.spd[k], intensity: s.inten[k], surfaceId: ORDER[s.surf[k]], hrMax: a.hrMax
    };
  };
  /* raw streams for charts: { hr, load, dist, top, inten, spd, surf, x, y } sampled every LABP.SCHED.DT seconds */
  LABP.series = function (athleteId) { return series[athleteId] || null; };

  LABP.results = {
    all: function () { return EVENTS; },
    /* q: { upTo, from, surface, kind, metric, athleteId, act, pb, last } */
    list: function (q) {
      q = q || {}; var out = [], upTo = q.upTo == null ? Infinity : q.upTo;
      for (var i = 0; i < EVENTS.length; i++) {
        var e = EVENTS[i];
        if (e.t > upTo) break;
        if (q.from != null && e.t < q.from) continue;
        if (q.surface && e.surface !== q.surface) continue;
        if (q.kind && e.kind !== q.kind) continue;
        if (q.metric && e.metric !== q.metric) continue;
        if (q.act && e.act !== q.act) continue;
        if (q.athleteId && e.athleteId !== q.athleteId) continue;
        if (q.pb && !e.pb) continue;
        out.push(e);
      }
      return q.last ? out.slice(-q.last) : out;
    },
    /* leaderboard for a metric: best value per athlete, best first */
    best: function (metric, q) {
      var m = METRICS[metric], by = {};
      this.list(Object.assign({}, q, { metric: metric })).forEach(function (e) {
        if (e.value == null || !e.athleteId) return;
        var cur = by[e.athleteId];
        if (!cur || LABP.better(metric, e.value, cur.value)) by[e.athleteId] = e;
      });
      return Object.keys(by).map(function (k) { return by[k]; })
        .sort(function (a, b) { return m && m.better === 'low' ? a.value - b.value : b.value - a.value; })
        .map(function (e) { return { athlete: byId[e.athleteId], value: e.value, event: e, pb: !!e.pb }; });
    }
  };

  /* ================================================================ coach log */
  var log = LABP.log = {
    items: [],
    load: function () { this.items = store.get('log:' + S.id, []) || []; },
    save: function () { store.set('log:' + S.id, this.items); },
    /* e: { type:'tag'|'result'|'move'|'note', athleteId, surface, ... } — t defaults to the time on screen */
    add: function (e) {
      e = Object.assign({ id: 'l' + Date.now().toString(36) + (this.items.length % 1000), t: Math.round(state.viewT), wall: Date.now(), surface: state.focus }, e);
      this.items.push(e); this.save();
      if (e.type === 'move') rebuild(); else mergeLog();
      bus.emit('log', e);
      return e;
    },
    remove: function (id) {
      var i = -1; this.items.forEach(function (e, k) { if (e.id === id) i = k; });
      if (i < 0) return;
      var e = this.items.splice(i, 1)[0]; this.save();
      if (e.type === 'move') rebuild(); else mergeLog();
      bus.emit('log', null);
    },
    clear: function () { this.items = []; this.save(); rebuild(); bus.emit('log', null); },
    list: function (q) {
      q = q || {};
      return this.items.filter(function (e) { return (!q.athleteId || e.athleteId === q.athleteId) && (!q.type || e.type === q.type); })
        .sort(function (a, b) { return b.t - a.t || b.wall - a.wall; });
    }
  };
  /* move an athlete onto another surface from now on (they join the pod working there) */
  LABP.moveAthlete = function (athleteId, surfaceId) {
    var t = state.liveT, from = LABP.surfaceOf(athleteId, t);
    if (from === surfaceId || state.complete) return false;
    log.add({ type: 'move', t: Math.round(t * 10) / 10, athleteId: athleteId, toPod: LABP.podOnSurface(surfaceId, t), surface: surfaceId, from: from });
    return true;
  };

  /* ================================================================ stress bowl */
  var SESSION_COST = 0.16, REF_LOAD = 80;
  /* Coach planning estimate. sources[] are fractions of the bowl; session is what today has added so far. */
  LABP.bowl = function (athleteId, t) {
    var a = byId[athleteId]; if (!a) return null;
    var ov = store.get('bowl:' + S.id + ':' + athleteId, {}) || {}, fill = 0;
    var sources = DATA.bowlSources.map(function (s) {
      var v = ov[s.key] != null ? ov[s.key] : a.bowl[s.key]; fill += v;
      return { key: s.key, label: (a.minor && s.minorLabel) || s.label, value: v, edited: ov[s.key] != null };
    });
    var vit = LABP.vitals(athleteId, t == null ? state.viewT : t);
    var session = vit ? Math.min(0.3, SESSION_COST * vit.load / REF_LOAD) : 0;
    return { sources: sources, carried: fill, session: session, fill: fill + session, room: Math.max(0, 1 - fill - session), over: Math.max(0, fill + session - 1), plannedCost: SESSION_COST };
  };
  LABP.setBowl = function (athleteId, key, value) {
    var k = 'bowl:' + S.id + ':' + athleteId, ov = store.get(k, {}) || {};
    if (value == null) delete ov[key]; else ov[key] = clamp(Math.round(value * 100) / 100, 0, 0.6);
    store.set(k, ov); bus.emit('bowl', athleteId);
  };
  LABP.resetBowl = function (athleteId) { store.del('bowl:' + S.id + ':' + athleteId); bus.emit('bowl', athleteId); };

  /* ================================================================ actions */
  LABP.select = function (id) { LABP.set({ selectedId: id && byId[id] ? id : null }); };
  /* the athlete the side panels describe: the selection, or the first athlete on the focused surface */
  LABP.currentAthlete = function () {
    if (state.selectedId && byId[state.selectedId]) return byId[state.selectedId];
    var f = LABP.frame(state.focus, state.viewT);
    return f.members.length ? f.members[0].athlete : S.athletes[0];
  };
  LABP.setFocus = function (sid) {
    if (!SURF[sid] || sid === state.focus) return;
    var go = function () { LABP.set({ focus: sid }); };
    if (document.startViewTransition && !RM) document.startViewTransition(go); else go();
  };
  LABP.setMode = function (m) {
    if (m === 'live') { if (state.complete) return LABP.setMode('replay'); LABP.set({ mode: 'live', follow: true }); return; }
    if (m === 'replay') {
      if (state.follow) LABP.set({ mode: 'replay', follow: false, playing: true, viewT: Math.max(0, state.liveT - 45) });
      else LABP.set({ mode: 'replay' });
      return;
    }
    LABP.set({ mode: m });
  };
  LABP.seek = function (t, keepPlaying) {
    var patch = { viewT: clamp(t, 0, state.liveT), follow: false };
    if (state.mode === 'live') patch.mode = 'replay';
    if (!keepPlaying) patch.playing = false;
    LABP.set(patch);
  };
  LABP.goLive = function () {
    if (state.complete) return;
    LABP.set({ follow: true, viewT: state.liveT, mode: state.mode === 'replay' ? 'live' : state.mode });
  };
  LABP.setSession = function (id) {
    var s = DATA.sessions.filter(function (x) { return x.id === id; })[0]; if (!s) return;
    saveClock();
    loadSession(s);
    var p = {}; PERSIST.forEach(function (k) { p[k] = state[k]; }); store.set('prefs', p);
    bus.emit('session', s);
    bus.emit('change', ['sessionId', 'focus', 'mode', 'selectedId']);
  };
  LABP.restartSession = function () {
    if (S.status !== 'live') return;
    log.items = []; log.save();
    anchor(START_T); state.complete = false;
    rebuild();
    LABP.set({ mode: 'live', follow: true, playing: true, viewT: START_T });
    bus.emit('change', ['mode', 'liveT']);
  };

  /* ================================================================ clock */
  var anchorT = START_T, anchorWall = Date.now();
  function anchor(t) { anchorT = t; anchorWall = Date.now(); state.liveT = t; }
  function saveClock() { if (S && S.status === 'live') store.set('clock:' + S.id, { liveT: state.liveT, wall: Date.now() }); }
  function loadSession(s) {
    S = s; byId = {};
    S.athletes.forEach(function (a) { byId[a.id] = a; if (!a.hrMax) a.hrMax = Math.round(208 - 0.7 * a.age + 6 * (rand(a.id + '|hrmax') - 0.5)); });
    ORDER.forEach(function (sid) {
      var tot = (S.plan[sid] || []).reduce(function (x, p) { return x + p.min; }, 0);
      if (tot !== 16) console.warn('[LABP] plan for ' + sid + ' in session ' + S.id + ' totals ' + tot + ' min, expected 16');
    });
    log.load();
    state.selectedId = null; state.sessionId = s.id;
    if (S.status === 'complete') {
      anchor(LEN); state.complete = true; state.follow = false; state.playing = false; state.mode = 'replay'; state.viewT = 12 * 60;
    } else {
      var c = store.get('clock:' + S.id, null), t = START_T;
      if (c && Date.now() - c.wall < 6 * 3600 * 1000) t = c.liveT + (Date.now() - c.wall) / 1000;
      else { log.items = []; log.save(); }
      state.complete = t >= LEN; anchor(Math.min(t, LEN));
      if (state.complete) { state.follow = false; state.playing = false; state.mode = 'replay'; state.viewT = LEN; }
      else { state.follow = true; state.playing = true; state.mode = 'live'; state.viewT = state.liveT; }
    }
    if (booted) rebuild();
  }

  /* ================================================================ ui helpers */
  var ui = LABP.ui = {
    /* write innerHTML only when it changed, so 2 Hz refreshes do not thrash the DOM */
    setHTML: function (node, html) { if (node && node.__h !== html) { node.__h = html; node.innerHTML = html; } },
    val: function (unit, value, digits) { var f = LABP.fmt(unit, value, digits); return '<b>' + f.v + '</b>' + (f.u ? '<small>' + f.u + '</small>' : ''); },
    stat: function (label, unit, value, digits, extra) {
      return '<div class="stat"><span class="stat-l">' + esc(label) + '</span><span class="stat-v">' + ui.val(unit, value, digits) + '</span>' + (extra ? '<span class="stat-x">' + extra + '</span>' : '') + '</div>';
    },
    pod: function (podId) { return '<i class="pod-dot" data-pod="' + esc(podId) + '" title="Pod ' + esc(podId) + '"></i>'; },
    /* a name that selects the athlete when clicked */
    who: function (a, cls) { return '<button type="button" class="who ' + (cls || '') + '" data-athlete="' + a.id + '">' + esc(a.name) + '</button>'; },
    src: function (kind) {
      var L = { gates: 'Gates', gps: 'GPS', hr: 'HR', bar: 'Bar', force: 'Force', coach: 'Coach', sim: 'Sample' };
      return '<span class="src" data-src="' + esc(kind) + '">' + (L[kind] || esc(kind)) + '</span>';
    },
    meter: function (frac, cls) { return '<span class="meter ' + (cls || '') + '"><i style="width:' + (clamp(frac, 0, 1) * 100).toFixed(1) + '%"></i></span>'; },
    /* tiny trend line; values is an array of numbers */
    spark: function (values, w, h) {
      w = w || 96; h = h || 24; if (!values || values.length < 2) return '';
      var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values), r = hi - lo || 1;
      var pts = values.map(function (v, i) { return (i / (values.length - 1) * (w - 4) + 2).toFixed(1) + ',' + (h - 3 - (v - lo) / r * (h - 6)).toFixed(1); });
      var last = pts[pts.length - 1].split(',');
      return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true"><polyline points="' + pts.join(' ') + '"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.5"/></svg>';
    },
    empty: function (text) { return '<p class="empty">' + esc(text) + '</p>'; }
  };

  /* ================================================================ stage */
  var uid = 0;
  function Stage(host, opts) {
    var self = this;
    this.host = host; this.mini = !!(opts && opts.mini); this.sid = null; this.toks = {}; this.overKey = null; this.planKey = null; this.heatKey = null;
    host.classList.add('stage'); if (this.mini) host.classList.add('stage--mini');
    host.innerHTML = '';
    this.world = svg('svg', { 'class': 'stage-world', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true', focusable: 'false' }, host);
    this.id = 'st' + (++uid);
    this.defs = svg('defs', null, this.world);
    this.gBase = svg('g', { 'class': 'l-base' }, this.world);
    this.gHeatClip = svg('g', { 'class': 'l-heat' }, this.world);
    this.gHeat = svg('g', null, this.gHeatClip);
    this.gPlan = svg('g', { 'class': 'l-plan' }, this.world);
    this.gOver = svg('g', { 'class': 'l-over' }, this.world);
    this.gDots = svg('g', { 'class': 'l-dots' }, this.world);
    if (!this.mini) {
      this.screen = svg('svg', { 'class': 'stage-screen' }, host);
      this.gPlanLabels = svg('g', { 'class': 'l-planlabels' }, this.screen);
      this.gLinks = svg('g', { 'class': 'l-links' }, this.screen);
      this.gTrails = svg('g', { 'class': 'l-trails' }, this.screen);
      this.gToks = svg('g', { 'class': 'l-toks' }, this.screen);
      this.tip = el('div', { 'class': 'stage-tip', hidden: '' }); host.appendChild(this.tip);
      this.screen.addEventListener('click', function (e) { var g = e.target.closest && e.target.closest('.tok'); if (g) LABP.select(g.getAttribute('data-athlete') === state.selectedId ? null : g.getAttribute('data-athlete')); });
      this.screen.addEventListener('keydown', function (e) {
        var g = e.target.closest && e.target.closest('.tok');
        if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); LABP.select(g.getAttribute('data-athlete')); }
      });
      var hover = function (e) { var g = e.target.closest && e.target.closest('.tok'); self.hoverId = g ? g.getAttribute('data-athlete') : null; self.updateTip(); };
      this.screen.addEventListener('pointerover', hover);
      this.screen.addEventListener('focusin', hover);
      this.screen.addEventListener('pointerleave', function () { self.hoverId = null; self.updateTip(); });
      this.screen.addEventListener('focusout', function () { self.hoverId = null; self.updateTip(); });
    }
    if (window.ResizeObserver) new ResizeObserver(function () { self.measure(); }).observe(host);
  }
  Stage.prototype.setSurface = function (sid) {
    var surf = SURF[sid]; if (!surf) return;
    this.sid = sid; this.surf = surf;
    var W = surf.world; this.m = Math.max(W.w, W.h) * 0.045;
    this.world.setAttribute('viewBox', (-this.m) + ' ' + (-this.m) + ' ' + (W.w + 2 * this.m) + ' ' + (W.h + 2 * this.m));
    this.host.setAttribute('data-surface', sid);
    [this.gBase, this.gHeat, this.gPlan, this.gOver, this.gDots, this.defs].forEach(function (g) { while (g.firstChild) g.removeChild(g.firstChild); });
    var clip = svg('clipPath', { id: this.id + 'clip' }, this.defs); svg('rect', { x: 0, y: 0, width: W.w, height: W.h }, clip);
    var cw = W.w / surf.heatCols;
    var f = svg('filter', { id: this.id + 'blur', x: '-10%', y: '-10%', width: '120%', height: '120%' }, this.defs); svg('feGaussianBlur', { stdDeviation: (cw * 0.85).toFixed(3) }, f);
    this.gHeatClip.setAttribute('clip-path', 'url(#' + this.id + 'clip)');
    this.gHeat.setAttribute('filter', 'url(#' + this.id + 'blur)');
    var self = this;
    if (surf.drawBase) safe(function () { surf.drawBase(self.gBase, { mini: self.mini, world: W, stage: self }); }, sid + '.drawBase');
    else svg('rect', { 'class': 's-slab', x: 0, y: 0, width: W.w, height: W.h, rx: Math.max(W.w, W.h) * 0.01 }, this.gBase);
    this.overKey = this.planKey = this.heatKey = null; this.heatCells = null; this.dots = [];
    this.clearToks();
    this.measure();
  };
  Stage.prototype.clearToks = function () {
    if (this.mini) return;
    [this.gToks, this.gTrails, this.gLinks, this.gPlanLabels].forEach(function (g) { while (g.firstChild) g.removeChild(g.firstChild); });
    this.toks = {}; this.links = {};
  };
  Stage.prototype.measure = function () {
    if (!this.surf) return;
    var r = this.host.getBoundingClientRect(), W = this.surf.world;
    if (!r.width || !r.height) return;
    var vw = W.w + 2 * this.m, vh = W.h + 2 * this.m;
    this.W = r.width; this.H = r.height; this.s = Math.min(r.width / vw, r.height / vh);
    this.ox = (r.width - vw * this.s) / 2; this.oy = (r.height - vh * this.s) / 2;
    var R = clamp(r.width / 58, 9, 24);
    if (!this.mini) {
      this.screen.setAttribute('viewBox', '0 0 ' + r.width.toFixed(1) + ' ' + r.height.toFixed(1));
      if (Math.abs(R - (this.R || 0)) > 0.4) { this.R = R; this.clearToks(); }
      this.planKey = null;
    }
  };
  Stage.prototype.toPx = function (x, y) { return [this.ox + (x + this.m) * this.s, this.oy + (y + this.m) * this.s]; };
  Stage.prototype.makeTok = function (a) {
    var R = this.R || 12, g = svg('g', { 'class': 'tok', tabindex: '0', role: 'button', 'data-athlete': a.id, 'aria-label': a.name }, this.gToks);
    svg('circle', { 'class': 'tok-hit', r: Math.max(R * 1.6, 22) }, g);
    svg('circle', { 'class': 'tok-halo', r: R * 1.75 }, g);
    svg('circle', { 'class': 'tok-disc', r: R }, g);
    var arc = svg('circle', { 'class': 'tok-arc', r: R + 3.5, pathLength: '100', 'stroke-dasharray': '0 100', transform: 'rotate(-90)' }, g);
    var tx = svg('text', { 'class': 'tok-txt', 'font-size': (R * 0.86).toFixed(1), dy: '0.36em' }, g); tx.textContent = a.initials;
    var tag = svg('g', { 'class': 'tok-tag', transform: 'translate(0,' + (R + 15).toFixed(1) + ')' }, g);
    var bg = svg('rect', { 'class': 'tok-tag-bg', height: 16, y: -11, rx: 2 }, tag);
    var nm = svg('text', { 'class': 'tok-tag-txt' }, tag); nm.textContent = a.name;
    var w = a.name.length * 6.3 + 12; bg.setAttribute('width', w); bg.setAttribute('x', -w / 2);
    var trail = svg('polyline', { 'class': 'trail' }, this.gTrails);
    return (this.toks[a.id] = { g: g, arc: arc, trail: trail, a: a });
  };
  /* hero: tokens, trails, partner links */
  Stage.prototype.renderFloor = function (frame, slow) {
    var self = this, seen = {};
    frame.members.forEach(function (m) {
      var id = m.athlete.id; seen[id] = 1;
      var tk = self.toks[id] || self.makeTok(m.athlete), p = self.toPx(m.st.x, m.st.y);
      tk.g.setAttribute('transform', 'translate(' + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ')');
      tk.p = p; tk.st = m.st;
      if (slow) {
        var v = LABP.vitals(id, frame.t), sel = id === state.selectedId;
        tk.arc.setAttribute('stroke-dasharray', (clamp((v.pct - 0.4) / 0.6, 0.02, 1) * 100).toFixed(0) + ' 100');
        tk.g.setAttribute('class', 'tok' + (sel ? ' is-selected' : '') + (v.pct >= 0.9 ? ' is-hot' : '') + (state.names || sel ? ' show-name' : ''));
        tk.g.setAttribute('aria-label', m.athlete.name + ', ' + m.st.label + ', ' + v.hr + ' beats per minute');
        tk.g.setAttribute('aria-pressed', sel ? 'true' : 'false');
      }
      if (!RM && state.mode !== 'heat') {
        var pts = [];
        for (var i = 0; i <= 9; i++) {
          var tt = frame.t - i * 0.55; if (tt < 0) break;
          var so = i === 0 ? { surfaceId: frame.surfaceId, st: m.st } : LABP.stateOf(id, tt);
          if (!so || so.surfaceId !== frame.surfaceId) break;
          var q = self.toPx(so.st.x, so.st.y); pts.push(q[0].toFixed(1) + ',' + q[1].toFixed(1));
        }
        tk.trail.setAttribute('points', pts.join(' '));
      } else tk.trail.setAttribute('points', '');
    });
    Object.keys(this.toks).forEach(function (id) {
      if (!seen[id]) { var tk = self.toks[id]; tk.g.remove(); tk.trail.remove(); delete self.toks[id]; }
    });
    /* partner links (mat pairs, spotters) */
    var want = {};
    frame.members.forEach(function (m) {
      var p = m.st.partner; if (p == null || p <= m.slot || !frame.members[p]) return;
      var a = self.toks[m.athlete.id], b = self.toks[frame.members[p].athlete.id]; if (!a || !b) return;
      var k = m.slot + '-' + p; want[k] = 1;
      var ln = self.links[k] || (self.links[k] = svg('line', { 'class': 'link' }, self.gLinks));
      ln.setAttribute('x1', a.p[0]); ln.setAttribute('y1', a.p[1]); ln.setAttribute('x2', b.p[0]); ln.setAttribute('y2', b.p[1]);
    });
    Object.keys(this.links).forEach(function (k) { if (!want[k]) { self.links[k].remove(); delete self.links[k]; } });
    if (slow) this.updateTip();
  };
  Stage.prototype.updateTip = function () {
    var tk = this.hoverId && this.toks[this.hoverId];
    if (!tk || !tk.p) { this.tip.hidden = true; return; }
    var v = LABP.vitals(this.hoverId, state.viewT);
    ui.setHTML(this.tip, '<b>' + esc(tk.a.name) + '</b><span>' + esc(tk.st.label || '') + '</span><span class="tip-n">' + v.hr + ' bpm · ' + Math.round(v.pct * 100) + '% max</span>');
    this.tip.hidden = false;
    this.tip.style.left = clamp(tk.p[0], 70, this.W - 70) + 'px';
    this.tip.style.top = (tk.p[1] - (this.R || 12) - 10) + 'px';
  };
  /* minis: plain dots in world space */
  Stage.prototype.renderDots = function (frame) {
    var r = Math.max(this.surf.world.w, this.surf.world.h) * 0.022, i;
    for (i = this.dots.length; i < frame.members.length; i++) this.dots.push(svg('circle', { 'class': 'mdot', r: r.toFixed(3) }, this.gDots));
    for (i = 0; i < this.dots.length; i++) {
      var d = this.dots[i], m = frame.members[i];
      if (!m) { d.setAttribute('visibility', 'hidden'); continue; }
      d.setAttribute('visibility', 'visible'); d.setAttribute('cx', m.st.x.toFixed(2)); d.setAttribute('cy', m.st.y.toFixed(2));
      d.setAttribute('class', 'mdot' + (m.athlete.id === state.selectedId ? ' is-selected' : ''));
    }
  };
  /* activity overlay drawn by the surface (gates, bars, circles ...) */
  Stage.prototype.renderOverlay = function (frame) {
    var def = this.surf.activities[frame.act], fresh = false, self = this;
    if (this.overKey !== frame.key) { while (this.gOver.firstChild) this.gOver.removeChild(this.gOver.firstChild); this.overKey = frame.key; fresh = true; }
    frame.fresh = fresh;
    if (def && def.overlay) safe(function () { def.overlay(self.gOver, frame, self); }, this.sid + '.' + frame.act + '.overlay');
    else if (this.surf.overlay) safe(function () { self.surf.overlay(self.gOver, frame, self); }, this.sid + '.overlay');
  };
  Stage.prototype.renderHeat = function (t) {
    var surf = this.surf, W = surf.world, cols = surf.heatCols, cw = W.w / cols, rows = Math.max(1, Math.round(W.h / cw)), ch = W.h / rows;
    var key = Math.floor(t / DT) + '|' + state.heatMetric + '|' + gen; if (key === this.heatKey) return; this.heatKey = key;
    var grid = new Float32Array(cols * rows), si = ORDER.indexOf(this.sid), kmax = Math.floor(t / DT), i, k;
    S.athletes.forEach(function (a) {
      var s = series[a.id]; if (!s) return;
      for (k = 0; k <= kmax; k++) {
        if (s.surf[k] !== si) continue;
        var gx = clamp(Math.floor(s.x[k] / cw), 0, cols - 1), gy = clamp(Math.floor(s.y[k] / ch), 0, rows - 1);
        grid[gy * cols + gx] += state.heatMetric === 'intensity' ? Math.pow(s.hr[k] / a.hrMax, 3) : 1;
      }
    });
    var max = 0; for (i = 0; i < grid.length; i++) if (grid[i] > max) max = grid[i];
    if (!this.heatCells || this.heatCells.length !== grid.length) {
      while (this.gHeat.firstChild) this.gHeat.removeChild(this.gHeat.firstChild);
      this.heatCells = [];
      for (i = 0; i < grid.length; i++) this.heatCells.push(svg('rect', { 'class': 'heat-cell', x: ((i % cols) * cw).toFixed(3), y: (Math.floor(i / cols) * ch).toFixed(3), width: cw.toFixed(3), height: ch.toFixed(3) }, this.gHeat));
    }
    for (i = 0; i < grid.length; i++) this.heatCells[i].setAttribute('fill-opacity', max ? Math.pow(grid[i] / max, 0.55).toFixed(3) : '0');
  };
  /* plan: one zone per phase of the block menu */
  Stage.prototype.renderPlan = function (t) {
    var surf = this.surf, plan = S.plan[this.sid] || [], ph = phaseInfo(this.sid, t), self = this;
    var key = S.id + '|' + ph.phaseIndex + '|' + this.W + '|' + state.units; if (key === this.planKey) return; this.planKey = key;
    while (this.gPlan.firstChild) this.gPlan.removeChild(this.gPlan.firstChild);
    if (this.gPlanLabels) while (this.gPlanLabels.firstChild) this.gPlanLabels.removeChild(this.gPlanLabels.firstChild);
    plan.forEach(function (p, i) {
      var def = surf.activities[p.act] || {}, zones = typeof def.zones === 'function' ? safe(function () { return def.zones({ world: surf.world, session: S, phase: p, index: i, count: plan.length }); }, 'zones') : def.zones;
      if (!zones || !zones.length) { var w = surf.world.w / plan.length; zones = [{ x: i * w, y: 0, w: w, h: surf.world.h }]; }
      var now = ph.seg.kind === 'block' && ph.phaseIndex === i;
      zones.forEach(function (z, zi) {
        svg('rect', { 'class': 'plan-zone' + (now ? ' is-now' : ''), x: z.x, y: z.y, width: z.w, height: z.h, rx: Math.max(surf.world.w, surf.world.h) * 0.008 }, self.gPlan);
        if (!self.gPlanLabels || zi > 0) return;
        var p0 = self.toPx(z.x, z.y), g = svg('g', { 'class': 'plan-label' + (now ? ' is-now' : ''), transform: 'translate(' + (p0[0] + 8).toFixed(1) + ',' + (p0[1] + 8).toFixed(1) + ')' }, self.gPlanLabels);
        var title = (i + 1) + '  ' + p.title, sub = p.min + ' min';
        var w = Math.max(title.length * 6.6, 60) + 18;
        svg('rect', { 'class': 'plan-label-bg', width: w, height: 36, rx: 2 }, g);
        var t1 = svg('text', { 'class': 'plan-label-t', x: 9, y: 15 }, g); t1.textContent = title;
        var t2 = svg('text', { 'class': 'plan-label-s', x: 9, y: 29 }, g); t2.textContent = sub + (now ? ' · now' : '');
      });
    });
  };
  LABP.Stage = Stage;

  /* ================================================================ shell: hero, minis, timeline, cards */
  var hero, minis = [], dom = {};
  function surfLabel(sid, t) {
    var ph = phaseInfo(sid, t), n = LABP.members(ph.podId, t).length;
    var blk = ph.seg.kind === 'block' ? 'Block ' + (ph.blockIndex + 1) : ph.seg.label;
    return { blk: blk, title: ph.phase.title, pod: ph.podId, n: n, text: blk + ' · ' + ph.phase.title + ' · Pod ' + ph.podId };
  }
  function avgHr(sid, t) {
    var mem = LABP.frame(sid, t).members; if (!mem.length) return null;
    return Math.round(mem.reduce(function (x, m) { return x + LABP.vitals(m.athlete.id, t).hr; }, 0) / mem.length);
  }
  function buildShell() {
    dom.heroName = $('#heroName'); dom.heroPhase = $('#heroPhase'); dom.minis = $('#minis'); dom.dockNote = $('#dockNote');
    dom.tlTrack = $('#tlTrack'); dom.tlHead = $('#tlHead'); dom.tlRec = $('#tlRec'); dom.tlMarks = $('#tlMarks'); dom.tlSegs = $('#tlSegs');
    dom.tlTime = $('#tlTime'); dom.tlPlay = $('#tlPlay'); dom.tlLive = $('#tlLive'); dom.tlRate = $('#tlRate');
    hero = new Stage($('#stage'), { mini: false });

    /* delegated selection + focus */
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-athlete]') : null;
      if (t && !t.closest('.stage-screen')) { LABP.select(t.getAttribute('data-athlete')); return; }
      var f = e.target.closest ? e.target.closest('[data-focus]') : null;
      if (f) LABP.setFocus(f.getAttribute('data-focus'));
    });

    $$('button[data-mode]').forEach(function (b) { b.addEventListener('click', function () { LABP.setMode(b.getAttribute('data-mode')); }); });
    $$('button[data-units]').forEach(function (b) { b.addEventListener('click', function () { LABP.set({ units: b.getAttribute('data-units') }); }); });
    $$('button[data-heat]').forEach(function (b) { b.addEventListener('click', function () { LABP.set({ heatMetric: b.getAttribute('data-heat') }); }); });
    $('#btnNames').addEventListener('click', function () { LABP.set({ names: !state.names }); });
    $('#btnExpand').addEventListener('click', function () { LABP.set({ expanded: !state.expanded }); });
    $('#btnCycle').addEventListener('click', function () { LABP.set({ cycle: !state.cycle }); });
    $('#btnTheme').addEventListener('click', function () {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      LABP.set({ theme: dark ? 'light' : 'dark' });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.expanded) LABP.set({ expanded: false }); });

    var sel = $('#sessionSel');
    sel.innerHTML = DATA.sessions.map(function (s) { return '<option value="' + s.id + '">' + esc(s.when + ' · ' + s.name + (s.status === 'live' ? ' · live' : ' · complete')) + '</option>'; }).join('');
    sel.addEventListener('change', function () { LABP.setSession(sel.value); });

    /* timeline */
    dom.tlSegs.innerHTML = SEGS.map(function (g) {
      return '<span class="tl-seg tl-seg--' + g.kind + '" style="left:' + (g.t0 / LEN * 100) + '%;width:' + ((g.t1 - g.t0) / LEN * 100) + '%"><em>' + (g.kind === 'transit' ? '' : g.label) + '</em></span>';
    }).join('');
    var dragging = false;
    function tAt(e) { var r = dom.tlTrack.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * LEN; }
    dom.tlTrack.addEventListener('pointerdown', function (e) { dragging = true; try { dom.tlTrack.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } LABP.seek(tAt(e)); });
    dom.tlTrack.addEventListener('pointermove', function (e) { if (dragging) LABP.seek(tAt(e)); });
    var endDrag = function () { dragging = false; };
    dom.tlTrack.addEventListener('pointerup', endDrag); dom.tlTrack.addEventListener('pointercancel', endDrag);
    dom.tlTrack.addEventListener('keydown', function (e) {
      var step = { ArrowLeft: -5, ArrowRight: 5, ArrowDown: -5, ArrowUp: 5, PageDown: -60, PageUp: 60 }[e.key];
      if (step) { e.preventDefault(); LABP.seek(state.viewT + step); }
      else if (e.key === 'Home') { e.preventDefault(); LABP.seek(0); }
      else if (e.key === 'End') { e.preventDefault(); if (state.complete) LABP.seek(LEN); else LABP.goLive(); }
    });
    dom.tlPlay.addEventListener('click', function () {
      if (state.follow) { LABP.set({ follow: false, playing: false, mode: state.mode === 'live' ? 'replay' : state.mode }); return; }
      if (!state.playing && state.viewT >= state.liveT - 0.5 && state.complete) LABP.set({ viewT: 0 });
      LABP.set({ playing: !state.playing });
    });
    dom.tlLive.addEventListener('click', function () { LABP.goLive(); });
    dom.tlRate.addEventListener('change', function () { anchor(state.liveT); LABP.set({ rate: +dom.tlRate.value || 1 }); });
  }
  function applyFocus() {
    var surf = SURF[state.focus]; if (!surf) return;
    hero.setSurface(state.focus);
    var others = ORDER.filter(function (s) { return s !== state.focus && SURF[s]; });
    dom.minis.innerHTML = ''; minis = [];
    others.forEach(function (sid) {
      var b = el('button', { type: 'button', 'class': 'mini', 'data-focus': sid, 'aria-label': 'Focus ' + SURF[sid].name });
      var host = el('div'); b.appendChild(host);
      var cap = el('span', { 'class': 'mini-cap' }); b.appendChild(cap);
      dom.minis.appendChild(b);
      var st = new Stage(host, { mini: true }); st.setSurface(sid); st.cap = cap;
      minis.push(st);
    });
    dom.heroName.textContent = surf.name;
    document.documentElement.setAttribute('data-on', state.focus);
    slowTick(true);
  }
  function applyChrome() {
    var root = document.documentElement;
    if (state.theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', state.theme);
    root.setAttribute('data-view', state.mode);
    root.classList.toggle('is-expanded', !!state.expanded);
    root.classList.toggle('is-complete', !!state.complete);
    root.classList.toggle('is-following', !!state.follow);
    $$('button[data-mode]').forEach(function (b) {
      var on = b.getAttribute('data-mode') === state.mode; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (b.getAttribute('data-mode') === 'live') b.disabled = !!state.complete;
    });
    $$('button[data-units]').forEach(function (b) { var on = b.getAttribute('data-units') === state.units; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    $$('button[data-heat]').forEach(function (b) { var on = b.getAttribute('data-heat') === state.heatMetric; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    var bn = $('#btnNames'); bn.classList.toggle('is-on', state.names); bn.setAttribute('aria-pressed', state.names ? 'true' : 'false');
    var bc = $('#btnCycle'); bc.classList.toggle('is-on', state.cycle); bc.setAttribute('aria-pressed', state.cycle ? 'true' : 'false');
    var be = $('#btnExpand'); be.setAttribute('aria-pressed', state.expanded ? 'true' : 'false'); be.querySelector('span').textContent = state.expanded ? 'Close' : 'Expand';
    $('#sessionSel').value = state.sessionId;
    dom.tlRate.value = String(state.rate);
    dom.tlLive.hidden = !!state.complete;
    hero.host.setAttribute('data-view', state.mode);
    var paused = !state.follow && !state.playing;
    dom.tlPlay.setAttribute('aria-label', paused ? 'Play' : 'Pause'); dom.tlPlay.setAttribute('data-state', paused ? 'paused' : 'playing');
  }
  function renderMarks() {
    var evs = LABP.results.list({ surface: state.focus }).filter(function (e) { return e.pb || e.kind === 'tag' || e.kind === 'result' || (e.kind === 'spike' && e.athleteId === state.selectedId); });
    dom.tlMarks.innerHTML = evs.slice(0, 400).map(function (e) {
      return '<i class="tl-mark tl-mark--' + (e.pb ? 'pb' : e.kind) + '" style="left:' + (e.t / LEN * 100).toFixed(2) + '%"></i>';
    }).join('');
  }
  function renderSessionCard() {
    var t = state.viewT, seg = segAt(t), nextRot = null, i;
    for (i = 0; i < SEGS.length; i++) if (SEGS[i].kind === 'transit' && SEGS[i].t0 > t) { nextRot = SEGS[i].t0 - t; break; }
    var rows = S.pods.map(function (p) {
      var sid = LABP.surfaceOfPod(p.id, t), n = LABP.members(p.id, t).length, hr = avgHr(sid, t);
      return '<li><button type="button" class="podrow' + (sid === state.focus ? ' is-on' : '') + '" data-focus="' + sid + '">' + ui.pod(p.id) + '<span class="podrow-n">Pod ' + p.id + '</span><span class="podrow-s">' + esc((SURF[sid] || {}).name || sid) + '</span><span class="podrow-c">' + n + '</span><span class="podrow-h">' + (hr == null ? '–' : hr) + '<small>bpm</small></span></button></li>';
    }).join('');
    var status = state.complete ? 'Complete' : state.follow ? 'Live' : 'Replay';
    ui.setHTML($('#slot-session .card-body'),
      '<p class="eyebrow">Today · ' + esc(S.when) + ' · ' + esc(S.popLabel) + '</p>' +
      '<h2 class="sess-name">' + esc(S.name) + '</h2>' +
      '<div class="sess-clock"><span class="sess-t">' + LABP.clock(t) + '</span><span class="sess-of">/ 60:00</span><span class="chip chip--' + status.toLowerCase() + '">' + status + '</span></div>' +
      '<p class="sess-seg">' + esc(seg.kind === 'block' ? seg.label + ' of 3' : seg.kind === 'transit' ? 'Rotating between surfaces' : seg.kind === 'prep' ? 'Arrive & prep' : 'Close & debrief') +
      (nextRot != null ? ' · next rotation in ' + LABP.clock(nextRot) : '') + '</p>' +
      '<ul class="podrows" aria-label="Pods and surfaces">' + rows + '</ul>' +
      (state.complete && S.status === 'live' ? '<button type="button" class="btn" id="btnRestart">Restart sample session</button>' : ''));
    var rb = $('#btnRestart'); if (rb && !rb.__b) { rb.__b = 1; rb.addEventListener('click', LABP.restartSession); }
  }
  function renderPlanCard() {
    var sid = state.focus, plan = S.plan[sid] || [], ph = phaseInfo(sid, state.viewT);
    ui.setHTML($('#slot-plan .card-body'),
      '<ol class="planlist">' + plan.map(function (p, i) {
        var now = ph.seg.kind === 'block' && ph.phaseIndex === i;
        return '<li class="' + (now ? 'is-now' : '') + '"><span class="plan-n">' + (i + 1) + '</span><div><p class="plan-t">' + esc(p.title) + '<small>' + p.min + ' min</small></p><p class="plan-note">' + esc(p.note) + '</p>' +
          (now ? ui.meter(ph.tIn / ph.dur, 'meter--accent') : '') + '</div></li>';
      }).join('') + '</ol>' +
      '<p class="plan-foot">Every pod runs this menu when it rotates onto ' + esc(SURF[sid].name.toLowerCase()) + '. <a href="session-builder.html">Open Session Builder</a></p>');
    $('#slot-plan .card-title').textContent = 'Plan · ' + SURF[sid].name;
  }
  function renderSurfaceCards() {
    var surf = SURF[state.focus], frame = LABP.frame(state.focus, state.viewT);
    ['now', 'board'].forEach(function (slot, i) {
      var card = surf.cards[i], host = $('#slot-' + slot), hud = $('#hud-' + slot);
      var title = card ? (typeof card.title === 'function' ? card.title(frame) : card.title) : (i === 0 ? surf.name + ' now' : 'Recent results');
      [host, state.expanded ? hud : null].forEach(function (h) {
        if (!h) return;
        $('.card-title', h).textContent = title;
        var body = $('.card-body', h);
        if (card && card.render) safe(function () { card.render(body, frame); }, state.focus + ' card ' + slot);
        else if (i === 0) ui.setHTML(body, '<div class="stats">' + ui.stat('On the floor', 'n', frame.members.length) + ui.stat('Avg heart rate', 'bpm', avgHr(state.focus, state.viewT) || 0) + '</div><p class="note">' + esc(frame.phase.note || '') + '</p>');
        else {
          var evs = LABP.results.list({ surface: state.focus, upTo: state.viewT, last: 6 }).reverse();
          ui.setHTML(body, evs.length ? '<ul class="rows">' + evs.map(function (e) { var a = byId[e.athleteId]; return '<li class="row"><span class="row-t">' + LABP.clock(e.t) + '</span>' + (a ? ui.who(a) : '') + '<span class="row-v">' + esc(e.label || e.kind) + '</span></li>'; }).join('') + '</ul>' : ui.empty('Nothing recorded on this surface yet.'));
        }
      });
    });
  }
  /* twice a second: text, cards, minis captions, timeline */
  function slowTick(force) {
    if (!hero || !hero.surf) return;
    var t = state.viewT, L = surfLabel(state.focus, t);
    dom.heroPhase.textContent = L.text + ' · ' + L.n + ' on the floor';
    minis.forEach(function (m) {
      var l = surfLabel(m.sid, t), hr = avgHr(m.sid, t);
      ui.setHTML(m.cap, '<b>' + esc(SURF[m.sid].name) + '</b><span>' + esc(l.title) + '</span><span class="mini-meta">' + ui.pod(l.pod) + 'Pod ' + l.pod + ' · ' + (hr == null ? '–' : hr + ' bpm') + '</span>');
    });
    dom.tlTime.textContent = LABP.clock(t);
    dom.tlTrack.setAttribute('aria-valuenow', Math.round(t));
    dom.tlTrack.setAttribute('aria-valuetext', LABP.clock(t) + ' of 60:00');
    renderSessionCard(); renderPlanCard(); renderSurfaceCards();
    var note = state.mode === 'heat' ? 'Where the work happened, from the start to ' + LABP.clock(t) + '.'
      : state.mode === 'plan' ? 'Today’s plan laid out on the floor.'
        : 'Ring shows heart rate as a share of max. Red at 90% and above.';
    dom.dockNote.textContent = note;
    bus.emit('tick', { t: t, force: !!force });
  }
  /* re-render cards and panels now (e.g. after a module changes its own view state) */
  LABP.refresh = function () { lastFloorSlow = 0; slowTick(true); };
  var lastWall = 0, lastSlow = 0, lastMini = 0, lastSave = 0, lastCycle = 0, lastFloorSlow = 0, lastRM = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min(0.25, (now - lastWall) / 1000 || 0); lastWall = now;
    if (!state.complete) {
      state.liveT = Math.min(LEN, anchorT + (Date.now() - anchorWall) / 1000 * state.rate);
      if (state.liveT >= LEN) {
        state.complete = true; saveClock();
        LABP.set({ follow: false, playing: false, viewT: LEN, mode: state.mode === 'live' ? 'replay' : state.mode });
        bus.emit('change', ['complete']);
      }
    }
    if (state.follow) state.viewT = state.liveT;
    else if (state.playing) {
      state.viewT += dt * Math.max(1, state.rate);
      if (state.viewT >= state.liveT) { if (state.complete) { state.viewT = LEN; LABP.set({ playing: false }); } else LABP.goLive(); }
    }
    if (!hero || !hero.surf || !hero.W) return;
    var t = state.viewT, pct = t / LEN * 100;
    dom.tlHead.style.left = pct + '%';
    dom.tlRec.style.width = (state.liveT / LEN * 100) + '%';
    dom.tlMarks.style.clipPath = 'inset(0 ' + (100 - state.liveT / LEN * 100) + '% 0 0)';
    var frame = LABP.frame(state.focus, t), slow = now - lastFloorSlow > 240;
    if (!RM || now - lastRM > 450) {
      lastRM = now;
      if (slow) lastFloorSlow = now;
      if (state.mode === 'plan') hero.renderPlan(t);
      else {
        hero.renderFloor(frame, slow);
        if (state.mode === 'heat') hero.renderHeat(t); else hero.renderOverlay(frame);
      }
    }
    if (now - lastMini > 180) { lastMini = now; minis.forEach(function (m) { if (m.W) m.renderDots(LABP.frame(m.sid, t)); }); }
    if (now - lastSlow > 500) { lastSlow = now; slowTick(false); }
    if (now - lastSave > 5000) { lastSave = now; saveClock(); }
    if (state.cycle && state.expanded && now - lastCycle > 20000) { lastCycle = now; LABP.setFocus(ORDER[(ORDER.indexOf(state.focus) + 1) % ORDER.length]); }
  }

  /* ================================================================ boot */
  function boot() {
    var p = store.get('prefs', {}) || {};
    PERSIST.forEach(function (k) { if (p[k] != null) state[k] = p[k]; });
    if (!SURF[state.focus]) state.focus = ORDER.filter(function (s) { return SURF[s]; })[0];
    var s0 = DATA.sessions.filter(function (x) { return x.id === state.sessionId; })[0] || DATA.sessions[0];
    loadSession(s0);
    booted = true;
    rebuild();
    buildShell();
    applyChrome(); applyFocus(); renderMarks();
    bus.on('change', function (keys) {
      applyChrome();
      if (keys.indexOf('focus') >= 0 || keys.indexOf('sessionId') >= 0) { applyFocus(); renderMarks(); }
      if (keys.indexOf('selectedId') >= 0) renderMarks();
      if (keys.indexOf('names') >= 0 || keys.indexOf('mode') >= 0 || keys.indexOf('units') >= 0) { hero.planKey = null; hero.heatKey = null; }
      if (keys.indexOf('expanded') >= 0) { hero.measure(); setTimeout(function () { hero.measure(); }, 60); }
      lastFloorSlow = 0; slowTick(true);
    });
    bus.on('events', function () { renderMarks(); });
    bus.on('rebuild', function () { if (hero.surf) { hero.clearToks(); hero.overKey = hero.heatKey = hero.planKey = null; } });
    window.addEventListener('pagehide', saveClock);
    document.addEventListener('visibilitychange', function () { if (document.hidden) saveClock(); });
    PANELS.forEach(function (pn) { if (pn.init) safe(pn.init, 'panel ' + pn.id); });
    document.documentElement.classList.add('is-ready');
    slowTick(true);
    requestAnimationFrame(loop);
    bus.emit('ready');
  }
  /* deferred scripts run before DOMContentLoaded, so waiting for it lets every surface and panel register first */
  if (document.readyState === 'complete') setTimeout(boot, 0); else document.addEventListener('DOMContentLoaded', boot);
})();
