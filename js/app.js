// Face Stretch Playground: upload -> detect (or draw) a face -> stretch it.
// Detection order is deliberate: (1) the browser's built-in
// FaceDetector when present (Chrome/Edge, no download, no network),
// (2) MediaPipe BlazeFace Short Range via CDN, loaded only then,
// (3) manual box, which always works. The photo is never uploaded:
// detection and cropping both run on bitmaps held in this page.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const uploadSection = $('upload-section');
  const pickSection = $('pick-section');
  const playSection = $('play-section');
  const dropzone = $('dropzone');
  const fileInput = $('file-input');
  const uploadError = $('upload-error');
  const detectStatus = $('detect-status');
  const photoStage = $('photo-stage');
  const photoImg = $('photo-img');
  const boxesEl = $('boxes');
  const pickHint = $('pick-hint');
  const playFace = $('play-face');
  const stretchReadout = $('stretch-readout');
  const stretchBest = $('stretch-best');

  const state = {
    bitmap: null, canvas: null, width: 0, height: 0,
    boxes: [], selected: 0, drawMode: false,
    photoUrl: null, playUrl: null,
    best: 0, audio: null,
  };

  function show(section) {
    uploadSection.hidden = section !== 'upload';
    pickSection.hidden = section !== 'pick';
    playSection.hidden = section !== 'play';
  }
  function pct(box) {
    return { left: box.x * 100, top: box.y * 100, width: box.width * 100, height: box.height * 100 };
  }
  function stageFraction(e) {
    const r = photoStage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  // ---------- photo loading ----------
  async function loadPhoto(file) {
    if (!file || !file.type.startsWith('image/')) {
      uploadError.textContent = 'That was not an image file. Try a JPG, PNG, or WebP photo.';
      uploadError.hidden = false;
      return;
    }
    uploadError.hidden = true;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (err) {
      bitmap = await createImageBitmap(file);
    }
    // Cap the working size: detection is faster and the play face
    // is only shown at 320px, so a 1600px working copy loses nothing.
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    let canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
    state.photoUrl = await new Promise((res) => canvas.toBlob((b) => res(URL.createObjectURL(b)), 'image/png'));
    state.bitmap = bitmap;
    state.canvas = canvas;
    state.width = canvas.width;
    state.height = canvas.height;
    state.boxes = [];
    state.selected = 0;
    state.drawMode = false;
    $('draw-btn').setAttribute('aria-pressed', 'false');
    photoImg.src = state.photoUrl;
    show('pick');
    detectStatus.textContent = 'Looking for faces…';
    boxesEl.innerHTML = '';
    await detectFaces();
  }

  // ---------- detection ----------
  async function detectFaces() {
    let boxes = [];
    try {
      if (typeof window.FaceDetector !== 'undefined') {
        const detector = new window.FaceDetector({ fastMode: true });
        const faces = await detector.detect(state.canvas);
        boxes = faces.map((f) => normalizeBox(f.boundingBox, state.width, state.height)).filter(Boolean);
      } else {
        detectStatus.textContent = 'This browser has no built-in face detector — loading an on-device model (one-time download)…';
        const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
        const fileset = await vision.FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
        const detector = await vision.FaceDetector.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
            delegate: 'GPU',
          },
          runningMode: 'IMAGE',
        });
        const result = detector.detect(state.canvas);
        boxes = (result.detections || []).map((d) => normalizeBox(d.boundingBox, state.width, state.height)).filter(Boolean);
        detector.close();
      }
    } catch (err) {
      boxes = [];
    }
    state.boxes = boxes;
    if (boxes.length === 0) {
      detectStatus.textContent = 'No face found — draw a box around the face, or tap “Draw a box instead”. Detection is best-effort: profile shots, sunglasses, and small faces miss most often.';
      setDrawMode(true);
    } else {
      state.selected = pickLargestFace(boxes);
      detectStatus.textContent = boxes.length === 1
        ? 'Found 1 face.'
        : `Found ${boxes.length} faces — the largest is selected. Tap another box to switch.`;
      $('next-face-btn').hidden = boxes.length < 2;
      setDrawMode(false);
    }
    renderBoxes();
  }

  function setDrawMode(on) {
    state.drawMode = on;
    $('draw-btn').setAttribute('aria-pressed', String(on));
    $('draw-btn').textContent = on ? 'Done drawing — drag the box to adjust' : 'Draw a box instead';
    pickHint.textContent = on
      ? 'Drag on the photo to draw a box around the face.'
      : 'Tap a box to select it. Drag the selected box to move it, or drag its bottom-right corner to resize it.';
  }

  // ---------- box overlay: select / move / resize / draw ----------
  function renderBoxes() {
    boxesEl.innerHTML = '';
    state.boxes.forEach((box, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'face-box' + (i === state.selected ? ' is-selected' : '');
      el.setAttribute('aria-label', i === state.selected ? `Selected face ${i + 1}` : `Face ${i + 1}`);
      const p = pct(box);
      el.style.left = p.left + '%'; el.style.top = p.top + '%';
      el.style.width = p.width + '%'; el.style.height = p.height + '%';
      const label = document.createElement('span');
      label.className = 'face-label';
      label.textContent = i === state.selected ? 'Selected' : `Face ${i + 1}`;
      el.appendChild(label);
      if (i === state.selected) {
        const handle = document.createElement('span');
        handle.className = 'resize-handle';
        handle.setAttribute('aria-hidden', 'true');
        el.appendChild(handle);
      }
      boxesEl.appendChild(el);
    });
  }

  let gesture = null; // {kind, startBox, startX, startY, moved}
  photoStage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.resize-handle')) {
      const f = stageFraction(e);
      gesture = { kind: 'resize', startBox: { ...state.boxes[state.selected] }, startX: f.x, startY: f.y };
    } else if (e.target.closest('.face-box')) {
      const idx = Array.from(boxesEl.children).indexOf(e.target.closest('.face-box'));
      state.selected = idx;
      renderBoxes();
      const f = stageFraction(e);
      gesture = { kind: 'move', startBox: { ...state.boxes[idx] }, startX: f.x, startY: f.y, moved: false };
    } else if (state.drawMode) {
      const f = stageFraction(e);
      gesture = { kind: 'draw', startBox: null, startX: f.x, startY: f.y };
      state.boxes = [{ x: f.x, y: f.y, width: 0.05, height: 0.05 }];
      state.selected = 0;
      renderBoxes();
    } else {
      return;
    }
    try { photoStage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
  });
  photoStage.addEventListener('pointermove', (e) => {
    if (!gesture) return;
    const f = stageFraction(e);
    const dx = f.x - gesture.startX;
    const dy = f.y - gesture.startY;
    if (gesture.kind === 'move') {
      if (Math.abs(dx) + Math.abs(dy) > 0.005) gesture.moved = true;
      state.boxes[state.selected] = clampBox01({
        x: gesture.startBox.x + dx, y: gesture.startBox.y + dy,
        width: gesture.startBox.width, height: gesture.startBox.height,
      });
    } else if (gesture.kind === 'resize') {
      state.boxes[state.selected] = clampBox01({
        x: gesture.startBox.x, y: gesture.startBox.y,
        width: gesture.startBox.width + dx, height: gesture.startBox.height + dy,
      });
    } else if (gesture.kind === 'draw') {
      state.boxes[0] = clampBox01({
        x: Math.min(gesture.startX, f.x), y: Math.min(gesture.startY, f.y),
        width: Math.abs(dx), height: Math.abs(dy),
      });
    }
    renderBoxes();
  });
  function endGesture() {
    if (!gesture) return;
    if (gesture.kind === 'draw') setDrawMode(false);
    gesture = null;
    renderBoxes();
  }
  photoStage.addEventListener('pointerup', endGesture);
  photoStage.addEventListener('pointercancel', endGesture);

  // ---------- play stage ----------
  function startPlay() {
    if (state.boxes.length === 0) return;
    const expanded = expandBox(state.boxes[state.selected], 0.2);
    const px = boxToPixels(expanded, state.width, state.height);
    const crop = document.createElement('canvas');
    crop.width = px.width; crop.height = px.height;
    crop.getContext('2d').drawImage(state.canvas, px.x, px.y, px.width, px.height, 0, 0, px.width, px.height);
    if (state.playUrl) URL.revokeObjectURL(state.playUrl);
    state.playUrl = crop.toDataURL('image/png');
    playFace.src = state.playUrl;
    state.best = 0;
    setStretch(1, 1);
    stretchBest.textContent = 'Biggest stretch yet: 1.0×';
    show('play');
    playFace.focus({ preventScroll: true });
  }

  function setStretch(sx, sy) {
    playFace.style.transform = `scale(${sx}, ${sy})`;
    stretchReadout.textContent = `${sx.toFixed(1)}× × ${sy.toFixed(1)}×`;
    const amount = stretchAmount(sx, sy);
    if (amount > state.best) {
      state.best = amount;
      stretchBest.textContent = `Biggest stretch yet: ${(1 + state.best).toFixed(1)}×`;
    }
  }

  function playBoing() {
    if (!$('sound-toggle').checked) return;
    try {
      state.audio = state.audio || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = state.audio;
      if (ctx.state === 'suspended') void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.22);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.26);
    } catch (err) { /* sound is decoration; never block play */ }
  }

  function animatePull(sx, sy) {
    playFace.classList.remove('is-springing');
    setStretch(sx, sy);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      playFace.classList.add('is-springing');
      setStretch(1, 1);
      playBoing();
    }));
  }

  let dragging = false, startX = 0, startY = 0, lastAmount = 0;
  playFace.tabIndex = 0;
  playFace.addEventListener('pointerdown', (e) => {
    dragging = true; startX = e.clientX; startY = e.clientY; lastAmount = 0;
    playFace.classList.remove('is-springing');
    try { playFace.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
  });
  playFace.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const s = computeStretch(e.clientX - startX, e.clientY - startY);
    setStretch(s.scaleX, s.scaleY);
    lastAmount = stretchAmount(s.scaleX, s.scaleY);
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    playFace.classList.add('is-springing');
    setStretch(1, 1);
    if (lastAmount > 0.25) playBoing();
  }
  playFace.addEventListener('pointerup', endDrag);
  playFace.addEventListener('pointercancel', endDrag);
  playFace.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); animatePull(1.7, 0.85); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); animatePull(0.85, 1.7); }
  });

  // ---------- wiring ----------
  dropzone.addEventListener('click', (e) => { if (!e.target.closest('button')) fileInput.click(); });
  $('choose-btn').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault(); dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) void loadPhoto(e.dataTransfer.files[0]);
  });
  document.addEventListener('paste', (e) => {
    const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
    if (item) void loadPhoto(item.getAsFile());
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) void loadPhoto(fileInput.files[0]); });
  $('draw-btn').addEventListener('click', () => setDrawMode(!state.drawMode));
  $('next-face-btn').addEventListener('click', () => {
    state.selected = (state.selected + 1) % state.boxes.length;
    renderBoxes();
  });
  $('redetect-btn').addEventListener('click', () => void detectFaces());
  $('play-btn').addEventListener('click', startPlay);
  $('new-photo-btn').addEventListener('click', () => show('upload'));
  $('back-to-pick-btn').addEventListener('click', () => show('pick'));
  $('play-new-photo-btn').addEventListener('click', () => show('upload'));
  $('pull-wide-btn').addEventListener('click', () => animatePull(1.7, 0.85));
  $('pull-tall-btn').addEventListener('click', () => animatePull(0.85, 1.7));
  $('squish-btn').addEventListener('click', () => animatePull(0.6, 0.6));
})();
