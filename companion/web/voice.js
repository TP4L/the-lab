/* Experimental voice scoring. parse() turns one heard phrase into a scoring
   command; listen() wraps the browser's speech recognition. Nothing is scored
   from speech without a visible confirmation that can be undone. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LabVoice = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MAKE = ['make', 'made', 'makes', 'good', 'in', 'yes', 'hit', 'point'];
  var MISS = ['miss', 'missed', 'misses', 'out', 'net', 'no', 'long', 'wide'];
  var UNDO = ['undo', 'cancel', 'scratch that', 'take it back', 'oops'];
  var NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, 'twenty one': 21 };

  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function hasWord(text, w) { return (' ' + text + ' ').indexOf(' ' + w + ' ') >= 0; }

  /* names: the athletes or sides that can be scored, in order.
     Returns { action: 'make'|'miss'|'point'|'undo', index } or null. */
  function parse(heard, names, opts) {
    opts = opts || {};
    var t = norm(heard);
    if (!t) return null;
    for (var i = 0; i < UNDO.length; i++) if (hasWord(t, UNDO[i])) return { action: 'undo' };
    // Which person/side: full name, first name, or position ("player two", "side 2", "blue").
    var idx = -1, best = 0;
    (names || []).forEach(function (n, k) {
      var full = norm(n), first = full.split(' ')[0];
      if (full && hasWord(t, full) && full.length > best) { idx = k; best = full.length; }
      else if (first && first.length > 1 && hasWord(t, first) && first.length > best) { idx = k; best = first.length; }
    });
    if (idx < 0) {
      var m = /(?:player|side|team|court)\s+(\d|one|two|three|four)/.exec(t);
      if (m) { var n = isNaN(m[1]) ? NUM[m[1]] : Number(m[1]); if (n >= 1 && n <= (names || []).length) idx = n - 1; }
    }
    if (idx < 0 && (names || []).length === 1) idx = 0;
    if (opts.mode === 'points') {
      return idx >= 0 ? { action: 'point', index: idx } : null;
    }
    var make = MAKE.some(function (w) { return hasWord(t, w); });
    var miss = MISS.some(function (w) { return hasWord(t, w); });
    if (make === miss || idx < 0) return null; // ambiguous or nobody named: ignore rather than guess
    return { action: make ? 'make' : 'miss', index: idx };
  }

  function supported() { return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition); }

  /* Continuous listening. onPhrase(text) for each final result; restarts after
     the browser's silence timeout until stop() is called. */
  function listen(onPhrase, onState) {
    var R = window.SpeechRecognition || window.webkitSpeechRecognition;
    var rec = new R(), stopped = false;
    rec.continuous = true; rec.interimResults = false; rec.lang = navigator.language || 'en-US';
    rec.onresult = function (e) {
      for (var i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onPhrase(e.results[i][0].transcript);
    };
    rec.onerror = function (e) { if (onState) onState('error', e.error); if (e.error === 'not-allowed' || e.error === 'service-not-allowed') stopped = true; };
    rec.onend = function () { if (!stopped) { try { rec.start(); } catch (x) {} } else if (onState) onState('stopped'); };
    try { rec.start(); if (onState) onState('listening'); } catch (x) { if (onState) onState('error', x.message); }
    return { stop: function () { stopped = true; try { rec.stop(); } catch (x) {} } };
  }

  return { parse: parse, supported: supported, listen: listen };
});
