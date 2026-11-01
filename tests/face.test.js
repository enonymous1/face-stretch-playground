const test = require('node:test');
const assert = require('node:assert/strict');
const { clampBox01, normalizeBox, pickLargestFace, expandBox, boxToPixels } = require('../js/face.js');

test('normalizeBox handles native DOMRect pixels', () => {
  assert.deepEqual(normalizeBox({ x: 100, y: 50, width: 200, height: 200 }, 1000, 500),
    { x: 0.1, y: 0.1, width: 0.2, height: 0.4 });
});
test('normalizeBox handles MediaPipe originX/Y pixels', () => {
  assert.deepEqual(normalizeBox({ originX: 0, originY: 0, width: 500, height: 500 }, 1000, 1000),
    { x: 0, y: 0, width: 0.5, height: 0.5 });
});
test('normalizeBox rejects degenerate boxes', () => {
  assert.equal(normalizeBox({ x: 0, y: 0, width: 0, height: 10 }, 100, 100), null);
  assert.equal(normalizeBox(null, 100, 100), null);
});
test('pickLargestFace picks the biggest box, -1 when empty', () => {
  const boxes = [{ x: 0, y: 0, width: 0.1, height: 0.1 }, { x: 0, y: 0, width: 0.3, height: 0.3 }];
  assert.equal(pickLargestFace(boxes), 1);
  assert.equal(pickLargestFace([]), -1);
});
test('expandBox grows by pad per side and stays inside', () => {
  assert.deepEqual(expandBox({ x: 0, y: 0, width: 0.5, height: 0.5 }, 0.2),
    { x: 0, y: 0, width: 0.7, height: 0.7 });
});
test('boxToPixels converts normalized to crop rect', () => {
  assert.deepEqual(boxToPixels({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 800, 400),
    { x: 200, y: 100, width: 400, height: 200 });
});
test('clampBox01 keeps a minimum size and stays inside', () => {
  const b = clampBox01({ x: 0.95, y: 0.95, width: 0.5, height: 0.5 });
  assert.ok(b.x + b.width <= 1 && b.y + b.height <= 1);
  assert.ok(b.width >= 0.05 && b.height >= 0.05);
});
