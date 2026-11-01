// Guards a classic-script footgun: app.js reads globals from
// config/stretch/face/detectors/audio, so index.html must load them
// in that order, and every referenced file must exist. If this test
// fails, the app fails in the browser with a ReferenceError, not a
// test failure — which is exactly why the check exists here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);

test('scripts load in dependency order', () => {
  assert.deepEqual(scripts, [
    'js/config.js',
    'js/stretch.js',
    'js/face.js',
    'js/mesh.js',
    'js/detectors.js',
    'js/audio.js',
    'js/app.js',
  ]);
});
test('every referenced script and stylesheet exists', () => {
  for (const src of scripts) assert.ok(fs.existsSync(path.join(root, src)), src);
  const css = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  for (const href of css) assert.ok(fs.existsSync(path.join(root, href)), href);
});
test('every id app.js looks up exists in index.html', () => {
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const ids = [...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 10, 'expected app.js to look up many ids');
  for (const id of new Set(ids)) assert.ok(html.includes(`id="${id}"`), id);
});
test('config values are sane and consistent', () => {
  const { FACE_STRETCH_CONFIG } = require('../js/config.js');
  assert.ok(FACE_STRETCH_CONFIG.stretchMin < 1 && FACE_STRETCH_CONFIG.stretchMax > 1);
  assert.ok(FACE_STRETCH_CONFIG.maxWorkingSize >= 800);
  assert.ok(FACE_STRETCH_CONFIG.cropPad >= 0 && FACE_STRETCH_CONFIG.cropPad < 1);
  assert.match(FACE_STRETCH_CONFIG.mediapipeVersion, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(FACE_STRETCH_CONFIG.pullWide).sort(), ['scaleX', 'scaleY']);
  assert.ok(FACE_STRETCH_CONFIG.faceLandmarkerModelUrl.includes('face_landmarker.task'));
  assert.ok(FACE_STRETCH_CONFIG.landmarkPullRadiusFactor > 0);
});
