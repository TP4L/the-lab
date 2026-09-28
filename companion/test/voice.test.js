'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../web/voice.js');

test('voice commands: names, positions, make/miss words, undo, ambiguity', () => {
  const names = ['Riley Park', 'Sam Ortiz', 'Jo Lee', 'Max Chen'];
  assert.deepEqual(V.parse('Riley make', names), { action: 'make', index: 0 });
  assert.deepEqual(V.parse('sam missed', names), { action: 'miss', index: 1 });
  assert.deepEqual(V.parse('Jo Lee in', names), { action: 'make', index: 2 });
  assert.deepEqual(V.parse('player four out', names), { action: 'miss', index: 3 });
  assert.deepEqual(V.parse('undo that', names), { action: 'undo' });
  assert.equal(V.parse('make', names), null, 'nobody named in a group');
  assert.equal(V.parse('Riley make miss', names), null, 'contradictory');
  assert.equal(V.parse('what a rally', names), null);
  assert.equal(V.parse('', names), null);
  assert.deepEqual(V.parse('good', ['Solo']), { action: 'make', index: 0 }, 'single athlete needs no name');
  assert.deepEqual(V.parse('point blue', ['Red', 'Blue'], { mode: 'points' }), { action: 'point', index: 1 });
  assert.deepEqual(V.parse('side two', ['Red', 'Blue'], { mode: 'points' }), { action: 'point', index: 1 });
  assert.equal(V.parse('nice shot', ['Red', 'Blue'], { mode: 'points' }), null);
});
