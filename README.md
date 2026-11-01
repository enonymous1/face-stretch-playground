# Face Stretch Playground

Upload a photo, find a face in it, and stretch it like the Mario 64
title screen — drag the face, let go, and it springs back.

No server, no upload, no account. Detection and cropping run entirely
in your browser, so your photo never leaves the page.

## Run it

Just open `index.html` in a browser. For the MediaPipe fallback path
(see below), serve it over HTTP instead, e.g.:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## How it works

1. **Pick a photo** — file picker, drag-and-drop, or paste.
   Phone photos are auto-oriented, and the working copy is capped at
   1600px on the long side (the play face is only shown at 320px).
2. **Pick the face** — detection runs in this order:
   1. The browser's built-in `FaceDetector` when present
      (Chrome/Edge: no download, no network).
   2. MediaPipe BlazeFace Short Range, loaded from CDN only if the
      built-in detector is missing.
   3. A manual box, which always works: tap *Draw a box instead* and
      drag on the photo. The largest detected face is selected by
      default; tap any other box to switch, drag the selected box to
      move it, or drag its bottom-right corner to resize it.
3. **Stretch it** — the selected face is cropped (with a 20% margin so
   forehead and chin come along) and shown on its own, Mario-style.
   Drag to stretch, release to spring back. Stretch math is reused
   from the jpl-dev avatar easter egg: 150px of drag is 1× of scale,
   clamped to 0.5×–2×, with an overshoot spring on release.
   `Pull wide` / `Pull tall` / `Squish` buttons and arrow keys do the
   same thing without a pointer, and the spring is skipped under
   `prefers-reduced-motion`. The boing is a tiny WebAudio synth —
   no audio files — and can be toggled off.

## Files

- `index.html` — the three steps: upload, pick, play.
- `styles.css` — layout plus the play-stage spring.
- `js/stretch.js` — `computeStretch`, shared with jpl-dev.
- `js/face.js` — normalized face boxes, largest-face pick, crop math.
- `js/app.js` — upload, detection, box editing, play interaction.
- `tests/*.test.js` — Node tests for the two pure modules:
  `node --test tests/stretch.test.js tests/face.test.js`

## Limitations, honestly

Face detection is best-effort, not a guarantee: front-facing faces in
good light detect best; profile shots, sunglasses, occluded faces,
and small/distant faces miss most often. That is why the manual box
is a first-class path, not an error state — a missed detection never
blocks play. MediaPipe is the fallback only; if you are offline and
your browser has no built-in detector, draw the box.

Inspired by the Super Mario 64 title-screen face. Not affiliated
with Nintendo.
