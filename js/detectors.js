// Face detection, isolated behind one function so app.js never
// learns which detector ran.
//
// Contract: detectFacesWithFallback(canvas, width, height) always
// resolves — it never throws — with:
//   { boxes, source, error }
//   boxes: normalized Box[] (possibly empty)
//   source: 'native' | 'mediapipe' | 'none'
//   error: null on success-or-no-face, otherwise a short user-facing
//     reason. The distinction matters: "no face in this photo" and
//     "the detector crashed / the model could not download" must not
//     look identical to the user, and the old code collapsed them.
//
// Order is deliberate, cheapest first:
//   1. Browser-native FaceDetector (Chrome/Edge, no download).
//   2. MediaPipe BlazeFace from CDN, GPU delegate first, CPU on
//      failure — GPU is not universal, and a GPU-only failure used
//      to kill detection outright.
//   3. Nothing: the caller falls back to the manual box, which is a
//      first-class path, not an error state.
//
// The MediaPipe fileset promise is cached at module level: without
// it, every "Detect again" click re-downloaded the WASM runtime.
// The photo itself is never sent anywhere; the CDN downloads are
// code + model only, and only on the fallback path.

/**
 * @typedef {Object} DetectionResult
 * @property {import('./face.js').Box[]} boxes
 * @property {'native'|'mediapipe'|'none'} source
 * @property {string|null} error
 */

let mediapipeFilesetPromise = null;

/**
 * @param {Object} vision - The dynamically imported tasks-vision module.
 * @returns {Promise<Object>} Fileset resolver, cached across calls.
 */
function getMediapipeFileset(vision) {
  if (!mediapipeFilesetPromise) {
    const version = (typeof FACE_STRETCH_CONFIG !== 'undefined' && FACE_STRETCH_CONFIG.mediapipeVersion)
      || '0.10.14';
    mediapipeFilesetPromise = vision.FilesetResolver.forVisionTasks(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/wasm`);
  }
  return mediapipeFilesetPromise;
}

/**
 * Run MediaPipe once with the given delegate, closing the detector
 * even when detection itself throws, so a failed attempt cannot leak
 * a GPU/CPU session into the retry.
 * @param {Object} fileset
 * @param {Object} vision
 * @param {HTMLCanvasElement} canvas
 * @param {number} width
 * @param {number} height
 * @param {'GPU'|'CPU'} delegate
 * @returns {Promise<import('./face.js').Box[]>}
 */
async function detectWithMediapipeDelegate(fileset, vision, canvas, width, height, delegate) {
  const modelUrl = (typeof FACE_STRETCH_CONFIG !== 'undefined' && FACE_STRETCH_CONFIG.mediapipeModelUrl)
    || 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
  const detector = await vision.FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelUrl, delegate },
    runningMode: 'IMAGE',
  });
  try {
    const result = detector.detect(canvas);
    return (result.detections || [])
      .map((d) => normalizeBox(d.boundingBox, width, height))
      .filter(Boolean);
  } finally {
    detector.close();
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} width
 * @param {number} height
 * @returns {Promise<DetectionResult>}
 */
async function detectFacesWithFallback(canvas, width, height) {
  if (typeof window !== 'undefined' && typeof window.FaceDetector !== 'undefined') {
    try {
      const detector = new window.FaceDetector({ fastMode: true });
      const faces = await detector.detect(canvas);
      const boxes = faces
        .map((f) => normalizeBox(f.boundingBox, width, height))
        .filter(Boolean);
      return { boxes, source: 'native', error: null };
    } catch (err) {
      // Native detection is best-effort; fall through to MediaPipe
      // rather than failing the whole step. If MediaPipe also fails,
      // its error is the one reported, since it is the last attempt.
    }
  }
  try {
    const version = (typeof FACE_STRETCH_CONFIG !== 'undefined' && FACE_STRETCH_CONFIG.mediapipeVersion)
      || '0.10.14';
    const vision = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/vision_bundle.mjs`);
    const fileset = await getMediapipeFileset(vision);
    let boxes;
    try {
      boxes = await detectWithMediapipeDelegate(fileset, vision, canvas, width, height, 'GPU');
    } catch (err) {
      boxes = await detectWithMediapipeDelegate(fileset, vision, canvas, width, height, 'CPU');
    }
    return { boxes, source: 'mediapipe', error: null };
  } catch (err) {
    // Both detectors failed (offline, CDN blocked, model rejected).
    // This is distinct from "no face found": the caller says so.
    return {
      boxes: [],
      source: 'none',
      error: 'Face detection could not run in this browser (offline, or the model download was blocked).',
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { detectFacesWithFallback };
}
