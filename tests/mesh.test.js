const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dedupePoints, triangulateDelaunay, computeAffineTransform, applyAffine,
  deformPoints, faceWidth, cheekIndices, buildWarpMesh, drawWarped,
  findNearestPoint, easeOutBack, circumcircleContains,
} = require('../js/mesh.js');

function close(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }
function assertPointClose(actual, expected) {
  assert.ok(close(actual.x, expected.x, 1e-6), `x ${actual.x} vs ${expected.x}`);
  assert.ok(close(actual.y, expected.y, 1e-6), `y ${actual.y} vs ${expected.y}`);
}

test('computeAffineTransform maps destination points to source points', () => {
  const dst = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
  const src = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 }];
  const m = computeAffineTransform(dst, src);
  assert.ok(m);
  dst.forEach((p, i) => assertPointClose(applyAffine(m, p), src[i]));
  // A translated + rotated case, not just a scale.
  const dst2 = [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 5, y: 15 }];
  const src2 = [{ x: 100, y: 50 }, { x: 110, y: 60 }, { x: 90, y: 60 }];
  const m2 = computeAffineTransform(dst2, src2);
  assert.ok(m2);
  dst2.forEach((p, i) => assertPointClose(applyAffine(m2, p), src2[i]));
});
test('computeAffineTransform returns null for a degenerate triangle', () => {
  const dst = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
  const src = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
  assert.equal(computeAffineTransform(dst, src), null);
});
test('triangulateDelaunay triangulates a square into 2 triangles', () => {
  const tris = triangulateDelaunay([
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
  ]);
  assert.equal(tris.length, 2);
  const covered = new Set(tris.flat());
  assert.equal(covered.size, 4);
});
test('triangulateDelaunay satisfies the Delaunay property on a small set', () => {
  const pts = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 },
  ];
  const tris = triangulateDelaunay(pts);
  assert.ok(tris.length >= 4);
  tris.forEach(([i, j, k]) => {
    pts.forEach((p, pi) => {
      if (pi === i || pi === j || pi === k) return;
      // On-circle is allowed (see circumcircleContains); strictly inside is not.
      assert.ok(!circumcircleContains(pts[i], pts[j], pts[k], p), `point ${pi} inside triangle ${i},${j},${k}`);
    });
  });
});
test('deformPoints: full strength at grab, zero at radius, anchors fixed', () => {
  const rest = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 200 }];
  const fixed = new Set([3]);
  const out = deformPoints(rest, 0, 10, 0, 100, fixed);
  assertPointClose(out[0], { x: 10, y: 0 });
  assertPointClose(out[2], { x: 100, y: 0 }); // At radius: no movement.
  assertPointClose(out[3], { x: 200, y: 200 }); // Anchor: never moves.
  // Half radius: weight (1 - 0.25)^2 = 0.5625.
  assert.ok(close(out[1].x, 50 + 10 * 0.5625, 1e-9));
  assert.deepEqual(rest[0], { x: 0, y: 0 }); // Input not mutated.
});
test('faceWidth and cheekIndices are geometric, not index-based', () => {
  const pts = [{ x: 10, y: 0 }, { x: 50, y: 0 }, { x: 90, y: 0 }];
  assert.equal(faceWidth(pts), 80);
  assert.deepEqual(cheekIndices(pts), { left: 0, right: 2 });
});
test('dedupePoints collapses near-duplicates and maps original indices', () => {
  const { points, map } = dedupePoints([{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 10, y: 10 }]);
  assert.equal(points.length, 2);
  assert.deepEqual(map, [0, 0, 1]);
});
test('buildWarpMesh includes anchors and triangulates a face-like set', () => {
  // A ring + center, like a coarse face: contour points around, interior points inside.
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push({ x: 100 + 60 * Math.cos(a), y: 100 + 80 * Math.sin(a) });
  }
  pts.push({ x: 100, y: 100 }, { x: 80, y: 80 }, { x: 120, y: 80 }, { x: 100, y: 130 });
  const mesh = buildWarpMesh(pts, 200, 200);
  assert.ok(mesh);
  assert.equal(mesh.points.length, pts.length + 8); // 8 anchors.
  assert.ok(mesh.triangles.length > 20);
  assert.ok(mesh.anchorIndices.has(pts.length)); // First anchor is a corner.
});
test('buildWarpMesh returns null for too few points', () => {
  assert.equal(buildWarpMesh([{ x: 0, y: 0 }], 100, 100), null);
  assert.equal(buildWarpMesh([], 100, 100), null);
});
test('drawWarped calls drawImage once per non-degenerate triangle with a correct transform', () => {
  const rest = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
  const deformed = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 }];
  const calls = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {},
    setTransform(a, b, c, d, e, f) { calls.push({ a, b, c, d, e, f }); },
    drawImage() { calls.push({ draw: true }); },
  };
  drawWarped(ctx, {}, rest, deformed, [[0, 1, 2]]);
  const transform = calls.find((c) => !c.draw);
  assert.ok(transform);
  // Regression test for the backwards-pull bug (2026-11-01): the
  // transform drawWarped hands to canvas must map rest -> deformed,
  // because drawImage pushes source pixels forward through it.
  // The old test asserted the inverse (deformed -> rest) and passed
  // while pulls visibly went the wrong way in the browser.
  assertPointClose(applyAffine(transform, rest[1]), deformed[1]);
  assertPointClose(applyAffine(transform, rest[2]), deformed[2]);
  assert.ok(calls.some((c) => c.draw));
});
test('findNearestPoint excludes anchors', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
  assert.equal(findNearestPoint(pts, 1, 1, new Set([0])), 1);
  assert.equal(findNearestPoint([], 0, 0), -1);
});
test('easeOutBack starts at 0, ends at 1, overshoots in between', () => {
  assert.ok(close(easeOutBack(0), 0));
  assert.ok(close(easeOutBack(1), 1));
  assert.ok(easeOutBack(0.7) > 1);
});
