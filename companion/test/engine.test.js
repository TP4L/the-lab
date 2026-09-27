'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../web/engine.js');

test('reproduces the four worked examples', () => {
  const cases = [
    [{ h: 3, t: 2, b: 3, cert: 'low', state: 'N', need: 2 }, 'gsg'],
    [{ h: 0, t: 3, b: 1, cert: 'mod', state: 'D', scr: true, need: 1, debt: true }, 'own'],
    [{ h: 1, t: 1, b: 3, cert: 'high', state: 'O', need: 3 }, 'tri'],
    [{ h: 1, t: 3, b: 3, cert: 'mod', state: 'D', scr: true, need: 2, debt: true, cover: true }, 'ccs']
  ];
  cases.forEach(([input, want], i) => assert.equal(E.run(input).call, want, 'example ' + (i + 1)));
});

test('the picked call is always legal', () => {
  for (const state of ['D', 'N', 'O']) for (let need = 0; need < 6; need++)
    for (const cert of ['low', 'mod', 'high']) for (const debt of [false, true]) for (const cover of [false, true]) {
      const out = E.run({ h: 3, t: 1, b: 2, state, need, cert, debt, cover });
      const own = out.legal.find(l => l.id === out.call);
      assert.ok(own.ok, `${out.call} illegal for ${state}/${need}/${cert}`);
    }
});

test('low certainty never gets a committing call', () => {
  for (const state of ['D', 'N', 'O']) for (let need = 0; need < 6; need++) {
    const out = E.run({ h: 3, t: 3, b: 3, state, need, cert: 'low', cover: true });
    assert.notEqual(E.BY[out.call].kind, 'com', `${out.call} on ${state}/${need}`);
  }
});

test('normalize clamps junk input', () => {
  const s = E.normalize({ h: 9, t: -1, b: 'x', state: 'Q', need: 99, cert: 'sure' });
  assert.deepEqual([s.h, s.t, s.b, s.state, s.need, s.cert], [2, 2, 2, 'D', 2, 'mod']);
});
