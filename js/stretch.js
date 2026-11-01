// Stretch math, carried over from jpl-dev's avatar easter egg
// (static/avatar-easter-egg.js) so the toy feels identical:
// dragging right/down stretches that axis; each 150px of drag is
// 1x of scale, clamped to half-to-double size. Releasing springs
// back to 1x1; the spring itself lives in CSS (styles.css).
//
// The numbers live in config.js when it is loaded first (the browser
// case); the fallbacks below are identical, so Node tests that
// require this file alone still exercise the real values.

/**
 * Read a config value when config.js was loaded, else a fallback.
 * `typeof` on an undeclared global is safe; a direct read would throw.
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function configNumber(key, fallback) {
  try {
    if (typeof FACE_STRETCH_CONFIG !== 'undefined' && typeof FACE_STRETCH_CONFIG[key] === 'number') {
      return FACE_STRETCH_CONFIG[key];
    }
  } catch (err) {
    // Config is optional in tests; fall through to the fallback.
  }
  return fallback;
}

const STRETCH_PX_PER_UNIT = configNumber('stretchPxPerUnit', 150);
const STRETCH_MIN = configNumber('stretchMin', 0.5);
const STRETCH_MAX = configNumber('stretchMax', 2);

/**
 * Clamp a scale to the playable range.
 * @param {number} value - Raw scale.
 * @returns {number} Scale clamped to [STRETCH_MIN, STRETCH_MAX].
 */
function clampStretch(value) {
  return Math.min(STRETCH_MAX, Math.max(STRETCH_MIN, value));
}

/**
 * Convert a pointer drag into per-axis scales.
 * @param {number} dx - Horizontal drag in CSS pixels (right is positive).
 * @param {number} dy - Vertical drag in CSS pixels (down is positive).
 * @returns {{scaleX: number, scaleY: number}} Clamped scales.
 */
function computeStretch(dx, dy) {
  return {
    scaleX: clampStretch(1 + dx / STRETCH_PX_PER_UNIT),
    scaleY: clampStretch(1 + dy / STRETCH_PX_PER_UNIT),
  };
}

/**
 * Largest deviation from 1x1 across both axes, for the stretch meter.
 * @param {number} scaleX
 * @param {number} scaleY
 * @returns {number} 0 at rest, up to 1 at either clamp.
 */
function stretchAmount(scaleX, scaleY) {
  return Math.max(Math.abs(scaleX - 1), Math.abs(scaleY - 1));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { clampStretch, computeStretch, stretchAmount, STRETCH_PX_PER_UNIT, STRETCH_MIN, STRETCH_MAX };
}
