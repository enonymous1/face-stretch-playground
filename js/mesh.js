// Triangle-mesh warp for the "pull parts" play mode.
//
// This file is pure: no DOM, no canvas creation, no network. The
// only canvas touch is drawWarped(), which takes a context the
// caller owns, so the math (triangulation, affine, falloff) is
// unit-testable without a browser (see tests/mesh.test.js).
//
// Pipeline, in order:
//   landmarks (pixels, from detectors.js)
//     -> buildWarpMesh(): landmarks + 8 fixed anchors (corners and
//        edge midpoints, so the mesh covers the whole crop and the
//        background near the edges stays put) -> Delaunay triangles
//     -> deformPoints(): grab one point, move nearby points with a
//        smooth falloff, anchors never move
//     -> drawWarped(): for each triangle, clip to the deformed
//        triangle and draw the source triangle into it via an
//        affine transform (rest -> deformed). See drawWarped's
//        comment: canvas drawImage pushes source pixels forward
//        through the transform, so the forward direction is the
//        only one that lands the texture on the deformed triangle.
//        The inverse (deformed -> rest) is the sampling direction
//        for a per-pixel shader, not for drawImage — using it here
//        made pulls appear to go in the opposite direction.
//
// Why Delaunay, not a grid: a grid warp does not know where the
// nose ends and the cheek begins, so a "nose pull" would smear a
// rectangular patch. Delaunay over the landmarks makes triangles
// follow the face structure, so a pull deforms the feature, not a
// grid cell. The cost is paid once per play session (triangulation
// on entering play), not per frame — per frame is only the
// triangle redraw, which reuses the same triangles.

/**
 * @typedef {{x: number, y: number}} Point
 * @typedef {[number, number, number]} Triangle - Indices into a points array.
 */

/**
 * Remove exact/near-duplicate points, keeping the first occurrence.
 * Duplicate landmarks (e.g. iris points a fraction of a pixel apart)
 * create zero-area triangles that break triangulation, so they are
 * collapsed here, with a map back to original indices for handles.
 * @param {Point[]} points
 * @param {number} [epsilon=0.5] - Points closer than this (px) collapse.
 * @returns {{points: Point[], map: number[]}} map[originalIndex] = dedupedIndex.
 */
function dedupePoints(points, epsilon) {
  const eps = epsilon === undefined ? 0.5 : epsilon;
  const kept = [];
  const map = [];
  points.forEach((p, i) => {
    let found = -1;
    for (let j = 0; j < kept.length; j++) {
      if (Math.hypot(kept[j].x - p.x, kept[j].y - p.y) < eps) { found = j; break; }
    }
    if (found === -1) { kept.push({ x: p.x, y: p.y }); map.push(kept.length - 1); }
    else map.push(found);
  });
  return { points: kept, map };
}

/**
 * Signed area * 2 of a triangle (positive = counterclockwise).
 * @param {Point} a
 * @param {Point} b
 * @param {Point} c
 * @returns {number}
 */
function triangleArea2(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * True when point p lies strictly inside the circumcircle of triangle
 * (a, b, c). Points exactly on the circle are not inside — for a
 * square, either diagonal is a valid Delaunay triangulation, and
 * treating on-circle as inside would flip diagonals endlessly.
 * @param {Point} a
 * @param {Point} b
 * @param {Point} c
 * @param {Point} p
 * @returns {boolean}
 */
function circumcircleContains(a, b, c, p) {
  const ax = a.x - p.x, ay = a.y - p.y;
  const bx = b.x - p.x, by = b.y - p.y;
  const cx = c.x - p.x, cy = c.y - p.y;
  const det = (ax * ax + ay * ay) * (bx * cy - cx * by)
    - (bx * bx + by * by) * (ax * cy - cx * ay)
    + (cx * cx + cy * cy) * (ax * by - bx * ay);
  const orient = triangleArea2(a, b, c);
  if (orient < 0) return det < -1e-9;
  return det > 1e-9;
}

/**
 * Delaunay triangulation by Bowyer-Watson.
 * @param {Point[]} points - Must already be deduplicated.
 * @returns {Triangle[]} Triangles as point indices. Degenerate
 *   (zero-area) triangles are dropped — they draw nothing.
 */
function triangulateDelaunay(points) {
  const n = points.length;
  if (n < 3) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  points.forEach((p) => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  });
  const dx = maxX - minX || 1, dy = maxY - minY || 1;
  const dmax = Math.max(dx, dy);
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  const all = points.concat([
    { x: midX - 20 * dmax, y: midY - dmax },
    { x: midX, y: midY + 20 * dmax },
    { x: midX + 20 * dmax, y: midY - dmax },
  ]);
  const s0 = n, s1 = n + 1, s2 = n + 2;
  /** @type {Triangle[]} */
  let triangles = [[s0, s1, s2]];
  for (let pi = 0; pi < n; pi++) {
    const p = all[pi];
    const bad = [];
    const edgeCount = new Map();
    triangles.forEach((tri, ti) => {
      if (circumcircleContains(all[tri[0]], all[tri[1]], all[tri[2]], p)) {
        bad.push(ti);
        [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]].forEach(([a, b]) => {
          const key = a < b ? `${a},${b}` : `${b},${a}`;
          edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
        });
      }
    });
    const badSet = new Set(bad);
    triangles = triangles.filter((_, ti) => !badSet.has(ti));
    edgeCount.forEach((count, key) => {
      if (count !== 1) return; // Interior edges appear twice; boundary edges once.
      const [a, b] = key.split(',').map(Number);
      triangles.push([a, b, pi]);
    });
  }
  return triangles.filter((tri) => {
    if (tri.includes(s0) || tri.includes(s1) || tri.includes(s2)) return false;
    return Math.abs(triangleArea2(all[tri[0]], all[tri[1]], all[tri[2]])) > 0.01;
  });
}

/**
 * Affine transform mapping a destination triangle to a source triangle,
 * in canvas setTransform() convention: x' = a*x + c*y + e,
 * y' = b*x + d*y + f. Applying it to a destination point must yield
 * the corresponding source point (asserted in tests/mesh.test.js).
 * @param {Point[]} dstTri - 3 deformed points.
 * @param {Point[]} srcTri - 3 rest points.
 * @returns {{a:number,b:number,c:number,d:number,e:number,f:number}|null} Null for degenerate triangles.
 */
function computeAffineTransform(dstTri, srcTri) {
  // Solve M = Src * inv(Dst) for 3x3 homogeneous matrices.
  const D = [
    [dstTri[0].x, dstTri[1].x, dstTri[2].x],
    [dstTri[0].y, dstTri[1].y, dstTri[2].y],
    [1, 1, 1],
  ];
  const S = [
    [srcTri[0].x, srcTri[1].x, srcTri[2].x],
    [srcTri[0].y, srcTri[1].y, srcTri[2].y],
    [1, 1, 1],
  ];
  const det = D[0][0] * (D[1][1] * D[2][2] - D[1][2] * D[2][1])
    - D[0][1] * (D[1][0] * D[2][2] - D[1][2] * D[2][0])
    + D[0][2] * (D[1][0] * D[2][1] - D[1][1] * D[2][0]);
  if (Math.abs(det) < 1e-9) return null;
  // Inverse via adjugate (transpose of cofactors) / determinant.
  // Remaining row/column indices must stay in order — a modulo
  // wrap (c+1, c+2) swaps them for the middle index and flips the
  // minor's sign, which is exactly the bug the affine test caught.
  const inv = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const rows = [0, 1, 2].filter((v) => v !== r);
      const cols = [0, 1, 2].filter((v) => v !== c);
      const minor = D[rows[0]][cols[0]] * D[rows[1]][cols[1]] - D[rows[0]][cols[1]] * D[rows[1]][cols[0]];
      const cofactor = ((r + c) % 2 === 0 ? minor : -minor);
      inv[c][r] = cofactor / det;
    }
  }
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      M[r][c] = S[r][0] * inv[0][c] + S[r][1] * inv[1][c] + S[r][2] * inv[2][c];
    }
  }
  return { a: M[0][0], b: M[1][0], c: M[0][1], d: M[1][1], e: M[0][2], f: M[1][2] };
}

/**
 * Apply a canvas affine transform object to a point (for tests).
 * @param {{a:number,b:number,c:number,d:number,e:number,f:number}} m
 * @param {Point} p
 * @returns {Point}
 */
function applyAffine(m, p) {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/**
 * Deform points by dragging one grab point.
 * Weight is (1 - t^2)^2 where t = distance / radius: 1 at the grab
 * point, 0 at and beyond the radius, with zero slope at both ends,
 * so the pull is smooth at the center and seamless at the edge.
 * Anchors (fixed indices) never move, however close the grab is.
 * @param {Point[]} restPoints
 * @param {number} grabIndex
 * @param {number} dx - Drag in pixels.
 * @param {number} dy - Drag in pixels.
 * @param {number} radius - Pull radius in pixels.
 * @param {Set<number>} [fixedIndices] - Indices that stay at rest.
 * @returns {Point[]} New array; restPoints is not mutated.
 */
function deformPoints(restPoints, grabIndex, dx, dy, radius, fixedIndices) {
  const grab = restPoints[grabIndex];
  if (!grab || radius <= 0) return restPoints.map((p) => ({ ...p }));
  return restPoints.map((p, i) => {
    if (fixedIndices && fixedIndices.has(i)) return { ...p };
    const dist = Math.hypot(p.x - grab.x, p.y - grab.y);
    if (dist >= radius) return { ...p };
    const t = dist / radius;
    const w = (1 - t * t) * (1 - t * t);
    return { x: p.x + dx * w, y: p.y + dy * w };
  });
}

/**
 * @param {Point[]} points
 * @returns {number} Horizontal span, for sizing the pull radius.
 */
function faceWidth(points) {
  if (!points.length) return 0;
  let minX = Infinity, maxX = -Infinity;
  points.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); });
  return maxX - minX;
}

/**
 * Cheek handles, derived geometrically instead of by landmark index:
 * the leftmost and rightmost landmarks of the face. Index-based
 * cheek numbers vary between Face Mesh references, but "leftmost
 * point" does not — and a cheek handle off by a few pixels still
 * pulls the cheek, because the falloff radius is wide.
 * @param {Point[]} points
 * @returns {{left: number, right: number}} Indices into points.
 */
function cheekIndices(points) {
  let left = 0, right = 0;
  points.forEach((p, i) => {
    if (p.x < points[left].x) left = i;
    if (p.x > points[right].x) right = i;
  });
  return { left, right };
}

/**
 * Named handles, by canonical MediaPipe Face Mesh index. These
 * indices are consistent across the cheat sheets checked for this
 * feature (nose 4, chin 152, mouth 61/291, eye outers 33/263); a
 * handle a few pixels off still works, because grabbing uses the
 * nearest landmark and the falloff radius is wide. Cheeks are
 * geometric (see cheekIndices), not indexed.
 */
const FACE_HANDLES = [
  { label: 'Nose', landmarkIndex: 4 },
  { label: 'Chin', landmarkIndex: 152 },
  { label: 'Left eye', landmarkIndex: 33 },
  { label: 'Right eye', landmarkIndex: 263 },
  { label: 'Mouth left', landmarkIndex: 61 },
  { label: 'Mouth right', landmarkIndex: 291 },
];

/**
 * Build the warp mesh for a face crop.
 * @param {Point[]} landmarkPoints - Pixel landmarks in crop coordinates.
 * @param {number} width - Crop width in pixels.
 * @param {number} height - Crop height in pixels.
 * @returns {{points: Point[], triangles: Triangle[], anchorIndices: Set<number>, landmarkMap: number[]}|null}
 *   Null when there are too few landmarks to triangulate.
 */
function buildWarpMesh(landmarkPoints, width, height) {
  if (!landmarkPoints || landmarkPoints.length < 10 || !width || !height) return null;
  const { points: deduped, map } = dedupePoints(landmarkPoints);
  const anchorStart = deduped.length;
  const points = deduped.concat([
    { x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height },
    { x: width / 2, y: 0 }, { x: width / 2, y: height }, { x: 0, y: height / 2 }, { x: width, y: height / 2 },
  ]);
  const anchorIndices = new Set();
  for (let i = anchorStart; i < points.length; i++) anchorIndices.add(i);
  const triangles = triangulateDelaunay(points);
  if (triangles.length < 10) return null;
  return { points, triangles, anchorIndices, landmarkMap: map };
}

/**
 * Draw a warped source canvas into a context, triangle by triangle.
 * The caller clears the context first. Each triangle is clipped to
 * its deformed shape, then the source is drawn through the affine
 * transform that maps rest -> deformed.
 *
 * Why forward, not inverse: drawImage places the source image at
 * its own (rest) coordinates, then the current transform moves
 * those coordinates to the destination. A rest->deformed transform
 * therefore lands the rest triangle exactly on the deformed
 * triangle. The deformed->rest transform is what a per-pixel
 * sampler would use (destination pixel -> source pixel), but
 * canvas is not a sampler: feeding it the inverse transform moves
 * the texture the opposite way from the deformed mesh, which is
 * exactly the "pull goes backwards" bug. The clip is defined in
 * identity space (deformed triangle), so changing the transform
 * after clip() does not move the clip — the drawn, transformed
 * triangle is clipped to the deformed triangle in device space.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} sourceCanvas
 * @param {Point[]} restPoints
 * @param {Point[]} deformedPoints
 * @param {Triangle[]} triangles
 */
function drawWarped(ctx, sourceCanvas, restPoints, deformedPoints, triangles) {
  triangles.forEach((tri) => {
    const dst = [deformedPoints[tri[0]], deformedPoints[tri[1]], deformedPoints[tri[2]]];
    const src = [restPoints[tri[0]], restPoints[tri[1]], restPoints[tri[2]]];
    if (!dst[0] || !dst[1] || !dst[2] || !src[0] || !src[1] || !src[2]) return;
    if (Math.abs(triangleArea2(dst[0], dst[1], dst[2])) < 0.01) return;
    const m = computeAffineTransform(src, dst);
    if (!m) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(dst[0].x, dst[0].y);
    ctx.lineTo(dst[1].x, dst[1].y);
    ctx.lineTo(dst[2].x, dst[2].y);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.restore();
  });
}

/**
 * Nearest point to (x, y), excluding any indices in exclude.
 * @param {Point[]} points
 * @param {number} x
 * @param {number} y
 * @param {Set<number>} [exclude]
 * @returns {number} Index, or -1 when empty.
 */
function findNearestPoint(points, x, y, exclude) {
  let best = -1, bestDist = Infinity;
  points.forEach((p, i) => {
    if (exclude && exclude.has(i)) return;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

/**
 * easeOutBack, for the spring-back animation: interpolation goes
 * 0 -> 1 with a slight overshoot past 1 before settling, which is
 * what makes a released pull feel springy instead of linear.
 * @param {number} t - Progress in [0, 1].
 * @returns {number}
 */
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    dedupePoints, triangleArea2, circumcircleContains, triangulateDelaunay,
    computeAffineTransform, applyAffine, deformPoints, faceWidth, cheekIndices,
    FACE_HANDLES, buildWarpMesh, drawWarped, findNearestPoint, easeOutBack,
  };
}
