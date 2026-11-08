'use strict';
/* The LAB vocabulary, shared by every module that tags something. */
const { HttpError } = require('./http');
const READS = ['height', 'time', 'balance'];
const STATES = ['defensive', 'neutral', 'offensive'];
const NEEDS = ['survive', 'recover', 'stabilize', 'build', 'pressure', 'finish'];
const ERRORS = ['see', 'read', 'state', 'need', 'solve', 'organize', 'execution'];
const CALLS = ['respect-the-x', 'triangle', 'own-space', 'go-stay-go', 'hip-pocket-over', 'cover-cover-sit', 'oh-slide-go'];
const LABELS = {
  reads: { height: 'Height', time: 'Time', balance: 'Balance' },
  states: { defensive: 'Defensive', neutral: 'Neutral', offensive: 'Offensive' },
  needs: { survive: 'Survive', recover: 'Recover', stabilize: 'Stabilize', build: 'Build', pressure: 'Pressure', finish: 'Finish' },
  errors: { see: 'See', read: 'Read', state: 'State', need: 'Need', solve: 'Solve', organize: 'Organize', execution: 'Execution' },
  calls: { 'respect-the-x': 'Respect the X', triangle: 'The Triangle', 'own-space': 'Own space not lines', 'go-stay-go': 'Go Stay Go', 'hip-pocket-over': 'Hip Pocket Over', 'cover-cover-sit': 'Cover Cover Sit', 'oh-slide-go': 'Oh Slide Go' }
};
const LEVELS = 13;
function reads(v, field = 'reads') {
  if (v === undefined || v === null || v === '') return [];
  if (!Array.isArray(v)) throw new HttpError(400, field + ' must be a list.');
  const out = [...new Set(v.map(x => String(x).toLowerCase()))];
  for (const x of out) if (!READS.includes(x)) throw new HttpError(400, field + ' must be height, time or balance.');
  return READS.filter(r => out.includes(r));
}
function one(v, list, field) {
  if (v === undefined || v === null || v === '') return '';
  const x = String(v).toLowerCase();
  if (!list.includes(x)) throw new HttpError(400, field + ' must be one of: ' + list.join(', ') + '.');
  return x;
}
/* Tags on a note or similar: { reads:[], state, need, error, call }. Empty values are dropped. */
function tags(v) {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'tags must be an object.');
  const out = {};
  const r = reads(v.reads); if (r.length) out.reads = r;
  const s = one(v.state, STATES, 'state'); if (s) out.state = s;
  const n = one(v.need, NEEDS, 'need'); if (n) out.need = n;
  const e = one(v.error, ERRORS, 'error'); if (e) out.error = e;
  const c = one(v.call, CALLS, 'call'); if (c) out.call = c;
  return out;
}
function level(v, field) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > LEVELS) throw new HttpError(400, field + ' must be a level from 1 to ' + LEVELS + '.');
  return n;
}
const parse = (s, fallback) => { try { return JSON.parse(s || ''); } catch { return fallback; } };
module.exports = { READS, STATES, NEEDS, ERRORS, CALLS, LABELS, LEVELS, reads, tags, level, one, parse, vocab: () => ({ reads: READS, states: STATES, needs: NEEDS, errors: ERRORS, calls: CALLS, labels: LABELS, levels: LEVELS }) };
