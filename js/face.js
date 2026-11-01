// Face-box helpers. All boxes are normalized: {x, y, width, height}
// as fractions (0..1) of the image, so the same box works for the
// displayed photo, the full-resolution crop, and the overlay.
// Detectors disagree on format, so normalizeBox() accepts the two
// shapes this app actually sees and nothing else.
//
// This file is pure: no DOM, no network, no canvas. That is deliberate
// — box editing is the most gesture-heavy logic in the app, and keeping
// it pure is what makes it unit-testable without a browser (see
// tests/face.test.js for move/resize/draw cases).

/**
 * @typedef {Object} Box - Normalized box, all values in [0, 1].
 * @property {number} x - Left edge, as a fraction of image width.
 * @property {number} y - Top edge, as a fraction of image height.
 * @property {number} width - Box width, as a fraction of image width.
 * @property {number} height - Box height, as a fraction of image height.
 */

/**
 * Read a config value when config.js was loaded, else a fallback.
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function faceConfigNumber(key, fallback) {
  try {
    if (typeof FACE_STRETCH_CONFIG !== 'undefined' && typeof FACE_STRETCH_CONFIG[key] === 'number') {
      return FACE_STRETCH_CONFIG[key];
    }
  } catch (err) {
    // Config is optional in tests; fall through to the fallback.
  }
  return fallback;
}

const MIN_BOX_SIZE = faceConfigNumber('minBoxSize', 0.05);

/**
 * Clamp a normalized box inside the image, keeping a minimum size
 * so a degenerate detection never produces an invisible crop.
 * @param {Box} box
 * @returns {Box} Clamped copy; the input is not mutated.
 */
function clampBox01(box) {
  const x = Math.min(1, Math.max(0, box.x));
  const y = Math.min(1, Math.max(0, box.y));
  const width = Math.min(1 - x, Math.max(MIN_BOX_SIZE, box.width));
  const height = Math.min(1 - y, Math.max(MIN_BOX_SIZE, box.height));
  return { x, y, width, height };
}

/**
 * Convert a detector's pixel box to a normalized box.
 * @param {Object|null} raw - Native DOMRect-like {x, y, width, height}
 *   or MediaPipe {originX, originY, width, height}, both in pixels.
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {Box|null} Normalized box, or null for a degenerate/missing box.
 */
function normalizeBox(raw, imageWidth, imageHeight) {
  if (!raw || !imageWidth || !imageHeight) return null;
  // Native FaceDetector: DOMRect-like {x, y, width, height} in pixels.
  // MediaPipe tasks-vision: {originX, originY, width, height} in pixels.
  let px = null;
  if (typeof raw.originX === 'number') {
    px = { x: raw.originX, y: raw.originY, width: raw.width, height: raw.height };
  } else if (typeof raw.x === 'number') {
    px = { x: raw.x, y: raw.y, width: raw.width, height: raw.height };
  }
  if (!px || !(px.width > 0) || !(px.height > 0)) return null;
  return clampBox01({
    x: px.x / imageWidth,
    y: px.y / imageHeight,
    width: px.width / imageWidth,
    height: px.height / imageHeight,
  });
}

/**
 * @param {Box} box
 * @returns {number} Normalized area; used only to rank faces.
 */
function boxArea(box) {
  return box.width * box.height;
}

/**
 * With several faces, the biggest box is almost always the subject
 * closest to the camera, so it is the default pick. The user can
 * still tap any other box to switch.
 * @param {Box[]} boxes
 * @returns {number} Index of the largest box, or -1 when empty.
 */
function pickLargestFace(boxes) {
  if (!boxes || boxes.length === 0) return -1;
  let best = 0;
  for (let i = 1; i < boxes.length; i++) {
    if (boxArea(boxes[i]) > boxArea(boxes[best])) best = i;
  }
  return best;
}

/**
 * Expand a box by `pad` (fraction of its own size per side) for the
 * play crop, so the stretch includes forehead/chin instead of a
 * tight detector rectangle. Still clamped inside the image.
 * @param {Box} box
 * @param {number} pad
 * @returns {Box}
 */
function expandBox(box, pad) {
  const padX = box.width * pad;
  const padY = box.height * pad;
  return clampBox01({
    x: box.x - padX,
    y: box.y - padY,
    width: box.width + padX * 2,
    height: box.height + padY * 2,
  });
}

/**
 * Normalized box -> pixel crop rect for a canvas draw.
 * @param {Box} box
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function boxToPixels(box, imageWidth, imageHeight) {
  return {
    x: Math.round(box.x * imageWidth),
    y: Math.round(box.y * imageHeight),
    width: Math.round(box.width * imageWidth),
    height: Math.round(box.height * imageHeight),
  };
}

// --- Pure box-editing gestures (previously inline in app.js) ---
//
// app.js owns pointer capture and DOM updates; these functions own
// only the math, so a drag can be tested as (startBox, dx, dy) ->
// newBox without a browser. All coordinates are normalized fractions
// of the photo stage, and all results are clamped by clampBox01.

/**
 * @typedef {Object} Gesture
 * @property {'move'|'resize'|'draw'} kind
 * @property {Box|null} startBox - Box at pointerdown (null for draw).
 * @property {number} startX - Pointer x at pointerdown, normalized.
 * @property {number} startY - Pointer y at pointerdown, normalized.
 */

/**
 * Move a box by a normalized drag, keeping its size.
 * @param {Box} startBox
 * @param {number} dx
 * @param {number} dy
 * @returns {Box}
 */
function moveBox(startBox, dx, dy) {
  return clampBox01({
    x: startBox.x + dx,
    y: startBox.y + dy,
    width: startBox.width,
    height: startBox.height,
  });
}

/**
 * Resize a box from its bottom-right corner by a normalized drag.
 * @param {Box} startBox
 * @param {number} dx
 * @param {number} dy
 * @returns {Box}
 */
function resizeBox(startBox, dx, dy) {
  return clampBox01({
    x: startBox.x,
    y: startBox.y,
    width: startBox.width + dx,
    height: startBox.height + dy,
  });
}

/**
 * Draw a new box from a drag start to the current pointer position.
 * @param {number} startX
 * @param {number} startY
 * @param {number} endX
 * @param {number} endY
 * @returns {Box}
 */
function drawBox(startX, startY, endX, endY) {
  return clampBox01({
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  });
}

/**
 * Apply one pointermove step of a gesture to a box.
 * @param {Gesture} gesture
 * @param {number} endX - Current pointer x, normalized.
 * @param {number} endY - Current pointer y, normalized.
 * @returns {Box}
 */
function applyGesture(gesture, endX, endY) {
  const dx = endX - gesture.startX;
  const dy = endY - gesture.startY;
  if (gesture.kind === 'move') return moveBox(gesture.startBox, dx, dy);
  if (gesture.kind === 'resize') return resizeBox(gesture.startBox, dx, dy);
  return drawBox(gesture.startX, gesture.startY, endX, endY);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    clampBox01, normalizeBox, boxArea, pickLargestFace, expandBox, boxToPixels,
    moveBox, resizeBox, drawBox, applyGesture, MIN_BOX_SIZE,
  };
}
