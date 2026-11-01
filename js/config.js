// Single source of truth for tunable values.
//
// Why a separate file, and why not ES modules yet: this project is
// deliberately build-free (open index.html, or serve it), so classic
// scripts loaded in order are the module system. config.js is loaded
// first; stretch.js / face.js read it when present and fall back to
// the same defaults when required alone in Node tests. When this
// grows past ~500 lines of app code, the honest next step is ES
// modules with an import map, not more globals — see README,
// "Future work". Bump a value here, never in a second place.

/**
 * @typedef {Object} FaceStretchConfig
 * @property {number} stretchPxPerUnit - Drag distance for 1x of scale.
 * @property {number} stretchMin - Minimum scale per axis.
 * @property {number} stretchMax - Maximum scale per axis.
 * @property {number} maxWorkingSize - Long-side cap for the working canvas.
 * @property {number} cropPad - Margin around the face crop, as a fraction of box size per side.
 * @property {number} minBoxSize - Smallest normalized box side, so a degenerate box never vanishes.
 * @property {number} drawDiscardThreshold - A draw shorter than this (normalized) is a click, not a box.
 * @property {number} moveThreshold - Smallest drag that counts as a move (filters pointer jitter).
 * @property {number} boingThreshold - Stretch amount that earns a boing on release.
 * @property {number} photoJpegQuality - JPEG quality for the displayed photo / face crop.
 * @property {string} mediapipeVersion - Pinned tasks-vision version; used for both the JS bundle and the WASM fileset, so they can never drift apart.
 * @property {string} mediapipeModelUrl - BlazeFace Short Range model, unchanged across tasks-vision patch versions.
 */

/** @type {FaceStretchConfig} */
const FACE_STRETCH_CONFIG = {
  stretchPxPerUnit: 150,
  stretchMin: 0.5,
  stretchMax: 2,
  maxWorkingSize: 1600,
  cropPad: 0.2,
  minBoxSize: 0.05,
  drawDiscardThreshold: 0.02,
  moveThreshold: 0.005,
  boingThreshold: 0.25,
  photoJpegQuality: 0.92,
  mediapipeVersion: '0.10.14',
  mediapipeModelUrl:
    'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
  // Face Landmarker model for the "pull parts" warp mode. Same
  // tasks-vision version as above, so WASM and model stay in sync.
  faceLandmarkerModelUrl:
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  // Warp pull radius, as a multiple of face width (landmark span).
  // 0.8 means a nose pull still moves the near cheek at ~half
  // strength, but the far side of the face barely moves — the
  // difference between a local pull and a whole-face stretch.
  landmarkPullRadiusFactor: 0.8,
  // Button/keyboard pull presets (scaleX, scaleY). Kept here, not in
  // app.js, so a preset change does not require hunting UI code.
  pullWide: { scaleX: 1.7, scaleY: 0.85 },
  pullTall: { scaleX: 0.85, scaleY: 1.7 },
  pullSquish: { scaleX: 0.6, scaleY: 0.6 },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FACE_STRETCH_CONFIG };
}
