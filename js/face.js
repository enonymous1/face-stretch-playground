// Face-box helpers. All boxes are normalized: {x, y, width, height}
// as fractions (0..1) of the image, so the same box works for the
// displayed photo, the full-resolution crop, and the overlay.
// Detectors disagree on format, so normalizeBox() accepts the two
// shapes this app actually sees and nothing else.

// Clamp a normalized box inside the image, keeping a minimum size
// so a degenerate detection never produces an invisible crop.
function clampBox01(box) {
  const x = Math.min(1, Math.max(0, box.x));
  const y = Math.min(1, Math.max(0, box.y));
  const width = Math.min(1 - x, Math.max(0.05, box.width));
  const height = Math.min(1 - y, Math.max(0.05, box.height));
  return { x, y, width, height };
}

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

function boxArea(box) {
  return box.width * box.height;
}

// With several faces, the biggest box is almost always the subject
// closest to the camera, so it is the default pick. The user can
// still tap any other box to switch.
function pickLargestFace(boxes) {
  if (!boxes || boxes.length === 0) return -1;
  let best = 0;
  for (let i = 1; i < boxes.length; i++) {
    if (boxArea(boxes[i]) > boxArea(boxes[best])) best = i;
  }
  return best;
}

// Expand a box by `pad` (fraction of its own size per side) for the
// play crop, so the stretch includes forehead/chin instead of a
// tight detector rectangle. Still clamped inside the image.
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

// Normalized box -> pixel crop rect for a canvas draw.
function boxToPixels(box, imageWidth, imageHeight) {
  return {
    x: Math.round(box.x * imageWidth),
    y: Math.round(box.y * imageHeight),
    width: Math.round(box.width * imageWidth),
    height: Math.round(box.height * imageHeight),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { clampBox01, normalizeBox, boxArea, pickLargestFace, expandBox, boxToPixels };
}
