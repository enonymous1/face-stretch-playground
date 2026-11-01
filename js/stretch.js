// Stretch math, carried over from jpl-dev's avatar easter egg
// (static/avatar-easter-egg.js) so the toy feels identical:
// dragging right/down stretches that axis; each 150px of drag is
// 1x of scale, clamped to half-to-double size. Releasing springs
// back to 1x1; the spring itself lives in CSS (styles.css).
function clampStretch(value) {
  return Math.min(2, Math.max(0.5, value));
}

function computeStretch(dx, dy) {
  return {
    scaleX: clampStretch(1 + dx / 150),
    scaleY: clampStretch(1 + dy / 150),
  };
}

// Largest deviation from 1x1 across both axes, for the stretch meter.
function stretchAmount(scaleX, scaleY) {
  return Math.max(Math.abs(scaleX - 1), Math.abs(scaleY - 1));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { clampStretch, computeStretch, stretchAmount };
}
