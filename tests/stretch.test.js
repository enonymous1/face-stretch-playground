const test = require('node:test');
const assert = require('node:assert/strict');
const { clampStretch, computeStretch, stretchAmount, combineStretch } = require('../js/stretch.js');

// Same expectations as jpl-dev's tests/js for computeStretch.
test('no drag is 1x1', () => {
  assert.deepEqual(computeStretch(0, 0), { scaleX: 1, scaleY: 1 });
});
test('150px drag is +1x on that axis only', () => {
  assert.deepEqual(computeStretch(150, 0), { scaleX: 2, scaleY: 1 });
  assert.deepEqual(computeStretch(0, 75), { scaleX: 1, scaleY: 1.5 });
});
test('negative drag shrinks, clamped at 0.5x', () => {
  assert.deepEqual(computeStretch(-75, -1000), { scaleX: 0.5, scaleY: 0.5 });
});
test('large drag clamps at 2x', () => {
  assert.deepEqual(computeStretch(1000, 1000), { scaleX: 2, scaleY: 2 });
});
test('clampStretch bounds', () => {
  assert.equal(clampStretch(0.4), 0.5);
  assert.equal(clampStretch(2.4), 2);
  assert.equal(clampStretch(1.3), 1.3);
});
test('stretchAmount is the largest deviation', () => {
  assert.equal(stretchAmount(1.7, 0.9), 0.7);
  assert.equal(stretchAmount(1, 1), 0);
});
test('combineStretch multiplies a held scale by a new drag, clamped', () => {
  // Held 1.5x + a 1.5x drag is 2.25x, clamped to 2x — not 1.5x again.
  assert.deepEqual(
    combineStretch({ scaleX: 1.5, scaleY: 1 }, { scaleX: 1.5, scaleY: 1 }),
    { scaleX: 2, scaleY: 1 },
  );
  // Held 1x1 is a no-op, so the first drag behaves exactly as before.
  assert.deepEqual(
    combineStretch({ scaleX: 1, scaleY: 1 }, { scaleX: 1.5, scaleY: 0.8 }),
    { scaleX: 1.5, scaleY: 0.8 },
  );
  // Shrinking from a held scale clamps at the floor, not below it.
  assert.deepEqual(
    combineStretch({ scaleX: 0.6, scaleY: 0.6 }, { scaleX: 0.6, scaleY: 0.6 }),
    { scaleX: 0.5, scaleY: 0.5 },
  );
});
