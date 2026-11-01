// Face Stretch Playground: upload -> detect (or draw) a face -> stretch it.
//
// This file is the UI shell only. The testable logic lives elsewhere:
//   config.js    — every tunable number, in one place.
//   stretch.js   — drag -> scale math (shared with jpl-dev).
//   face.js      — normalized boxes + pure gesture math.
//   mesh.js      — Delaunay triangulation + affine warp + falloff (pure).
//   detectors.js — native / MediaPipe detection + landmarks behind one contract.
//   audio.js     — the boing, with its AudioContext lifecycle.
// What remains here is DOM wiring, pointer capture, and state — the
// parts that genuinely need a browser. Nothing in here is unit-tested;
// that is a known gap (see README, "Testing"), and the reason the
// pure helpers were extracted instead of tested through the DOM.
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
  const playBtn = $('play-btn');
  const nextFaceBtn = $('next-face-btn');
  const playFace = $('play-face');
  const playCanvas = $('play-canvas');
  const playWarpWrap = $('play-warp-wrap');
  const playHandles = $('play-handles');
  const landmarkStatus = $('landmark-status');
  const pullPartsBtn = $('pull-parts-btn');
  const wholeFaceBtn = $('whole-face-btn');
  const stretchReadout = $('stretch-readout');
  const stretchBest = $('stretch-best');
  const soundToggle = $('sound-toggle');
  const holdToggle = $('hold-toggle');
  const resetFaceBtn = $('reset-face-btn');
  const themeToggle = $('theme-toggle');
  const anchorModeSelect = $('anchor-mode');

  /** Read a config number with a fallback, so app.js still works if config.js is missing. */
  function cfg(key, fallback) {
    try {
      if (typeof FACE_STRETCH_CONFIG !== 'undefined' && typeof FACE_STRETCH_CONFIG[key] === 'number') {
        return FACE_STRETCH_CONFIG[key];
      }
    } catch (err) { /* config is optional */ }
    return fallback;
  }
  const MAX_WORKING_SIZE = cfg('maxWorkingSize', 1600);
  const CROP_PAD = cfg('cropPad', 0.2);
  const DRAW_DISCARD = cfg('drawDiscardThreshold', 0.02);
  const MOVE_THRESHOLD = cfg('moveThreshold', 0.005);
  const BOING_THRESHOLD = cfg('boingThreshold', 0.25);
  const JPEG_QUALITY = cfg('photoJpegQuality', 0.92);
  const PULL_RADIUS_FACTOR = cfg('landmarkPullRadiusFactor', 0.8);
  /** Read a config object (pull presets) with a fallback. */
  function cfgObj(key, fallback) {
    try {
      if (typeof FACE_STRETCH_CONFIG !== 'undefined' && FACE_STRETCH_CONFIG[key]) {
        return FACE_STRETCH_CONFIG[key];
      }
    } catch (err) { /* config is optional */ }
    return fallback;
  }
  const PULL_WIDE = cfgObj('pullWide', { scaleX: 1.7, scaleY: 0.85 });
  const PULL_TALL = cfgObj('pullTall', { scaleX: 0.85, scaleY: 1.7 });
  const PULL_SQUISH = cfgObj('pullSquish', { scaleX: 0.6, scaleY: 0.6 });

  const playBoing = createBoingPlayer();

  const state = {
    canvas: null, width: 0, height: 0,
    boxes: [], selected: 0, drawMode: false,
    photoUrl: null, playUrl: null,
    best: 0,
    /** Current whole-face scale, so a held drag starts from the held scale, not 1x1. */
    scaleX: 1, scaleY: 1,
    /** Bumped on every new photo; async detection checks it before applying results. */
    loadGeneration: 0,
    /** Bumped on every Play; async landmark detection checks it before applying warp. */
    playGeneration: 0,
    /** 'whole' | 'warp'. Whole is always available; warp only after landmarks succeed. */
    playMode: 'whole',
  };

  // Warp state, separate from the generic state above: it lives only
  // for one play session and is rebuilt on every Play.
  const warp = {
    sourceCanvas: null, mesh: null, deformed: null, handles: [],
    /** Points a drag starts from: rest normally, held deformed after a held pull. */
    basePoints: null,
    radius: 0, grabIndex: -1, dragging: false,
    startCanvasX: 0, startCanvasY: 0, lastDragPx: 0,
    rafPending: false, springRaf: 0, springTimeout: 0,
  };

  // ---------- theme ----------
  // Stored theme beats the system; no stored theme means the
  // prefers-color-scheme media query decides, and a system change
  // while the page is open follows automatically (CSS only). The
  // pre-boot script in index.html already applied a stored theme
  // before first paint; this section only keeps the button label
  // in sync and handles toggles. localStorage is best-effort:
  // file:// and private modes may refuse it, and the theme still
  // works for the session in that case.
  function storedTheme() {
    try { const t = localStorage.getItem('face-stretch-theme'); return (t === 'dark' || t === 'light') ? t : null; } catch (err) { return null; }
  }
  function systemTheme() {
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (err) { return 'light'; }
  }
  function effectiveTheme() { return storedTheme() || systemTheme(); }
  function updateThemeButton(theme) {
    if (!themeToggle) return;
    if (theme === 'dark') {
      themeToggle.textContent = '☀️ Light mode';
      themeToggle.setAttribute('aria-label', 'Switch to light mode');
    } else {
      themeToggle.textContent = '🌙 Dark mode';
      themeToggle.setAttribute('aria-label', 'Switch to dark mode');
    }
  }
  function applyThemeClass(theme) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
  }
  // Initial label only: if a theme is stored, the pre-boot script
  // already applied its class; if not, no class is added here, so
  // the media query stays in charge.
  updateThemeButton(effectiveTheme());
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!storedTheme()) updateThemeButton(systemTheme());
    });
  } catch (err) { /* matchMedia listener is optional */ }

  // ---------- anchor visibility ----------
  // Default is hover (faint), per the request: dots should not
  // cover the face by default, but must be findable on hover.
  // Persisted like the theme; a stored value wins over the HTML default.
  function applyAnchorMode(mode) {
    if (!['always', 'hover', 'hidden'].includes(mode)) mode = 'hover';
    if (playWarpWrap) playWarpWrap.dataset.anchorMode = mode;
    if (anchorModeSelect) anchorModeSelect.value = mode;
    try { localStorage.setItem('face-stretch-anchors', mode); } catch (err) { /* best-effort */ }
  }
  try {
    const storedAnchors = localStorage.getItem('face-stretch-anchors');
    if (storedAnchors) applyAnchorMode(storedAnchors);
  } catch (err) { /* best-effort */ }

  /**
   * Show exactly one of the three steps.
   * @param {'upload'|'pick'|'play'} section
   */
  function show(section) {
    uploadSection.hidden = section !== 'upload';
    pickSection.hidden = section !== 'pick';
    playSection.hidden = section !== 'play';
  }

  /** @param {import('./face.js').Box} box @returns {{left:number,top:number,width:number,height:number}} Percentages for CSS. */
  function pct(box) {
    return { left: box.x * 100, top: box.y * 100, width: box.width * 100, height: box.height * 100 };
  }

  /**
   * Pointer position as a fraction of the photo stage.
   * @param {PointerEvent} e
   * @param {DOMRect} [rect] - Cached stage rect; when omitted, measured fresh.
   *   During a drag the rect is cached on pointerdown: measuring on
   *   every move forces layout and, combined with a DOM rebuild, was
   *   the main pointermove cost in the original code.
   */
  function stageFraction(e, rect) {
    const r = rect || photoStage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  /**
   * Canvas -> object URL, rejecting when encoding fails (toBlob can
   * return null for an oversized or tainted canvas — previously this
   * threw an opaque error inside URL.createObjectURL).
   * @param {HTMLCanvasElement} canvas
   * @param {string} type
   * @param {number} [quality]
   * @returns {Promise<string>}
   */
  function canvasToObjectUrl(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('Could not encode the photo.'));
        else resolve(URL.createObjectURL(blob));
      }, type, quality);
    });
  }

  // ---------- photo loading ----------
  /**
   * Load a photo file into the working canvas and start detection.
   * The working copy is capped at MAX_WORKING_SIZE: detection is
   * faster, and the play face is only shown at 320px, so a larger
   * copy buys nothing. The full-resolution bitmap is closed as soon
   * as the downscaled copy exists — the original code kept it alive
   * for the life of the page, doubling peak memory on phone photos.
   * @param {File|null} file
   * @returns {Promise<void>}
   */
  async function loadPhoto(file) {
    // Reset the picker now, not after load: otherwise picking the
    // same file twice fires no `change` event and the second pick
    // silently does nothing (a real bug in the original code).
    fileInput.value = '';
    if (!file || !file.type.startsWith('image/')) {
      uploadError.textContent = 'That was not an image file. Try a JPG, PNG, or WebP photo.';
      uploadError.hidden = false;
      return;
    }
    uploadError.hidden = true;
    const generation = ++state.loadGeneration;
    try {
      let bitmap;
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (err) {
        // Older browsers reject the options object; retry plain.
        bitmap = await createImageBitmap(file);
      }
      // If the user dropped a second photo while the first was still
      // decoding, the first load must not overwrite the second.
      if (generation !== state.loadGeneration) { if (bitmap.close) bitmap.close(); return; }
      const scale = Math.min(1, MAX_WORKING_SIZE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (bitmap.close) bitmap.close();
      if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
      // JPEG, not PNG: photos have no alpha, and PNG blobs were
      // several times larger for no visual gain.
      state.photoUrl = await canvasToObjectUrl(canvas, 'image/jpeg', JPEG_QUALITY);
      state.canvas = canvas;
      state.width = canvas.width;
      state.height = canvas.height;
      state.boxes = [];
      state.selected = 0;
      setDrawMode(false);
      photoImg.src = state.photoUrl;
      show('pick');
      detectStatus.textContent = 'Looking for faces…';
      boxesEl.innerHTML = '';
      playBtn.disabled = true;
      await detectFaces(generation);
    } catch (err) {
      if (generation !== state.loadGeneration) return;
      uploadError.textContent = 'Could not read that photo. Try a different file, or a smaller one.';
      uploadError.hidden = false;
      show('upload');
    }
  }

  // ---------- detection ----------
  /**
   * Run detection and apply its result, unless a newer photo has
   * loaded since (see loadGeneration). Distinguishes three outcomes
   * the original code collapsed into one: faces found, no face found,
   * and detection itself failed — only the last two offer the manual
   * box, and only the last explains why.
   * @param {number} generation - The loadGeneration this detection belongs to.
   * @returns {Promise<void>}
   */
  async function detectFaces(generation) {
    const result = await detectFacesWithFallback(state.canvas, state.width, state.height);
    if (generation !== state.loadGeneration) return;
    state.boxes = result.boxes;
    if (result.error) {
      detectStatus.textContent = result.error + ' Draw a box around the face instead.';
      state.selected = 0;
      setDrawMode(true);
    } else if (result.boxes.length === 0) {
      detectStatus.textContent = 'No face found — draw a box around the face, or tap “Draw a box instead”. Detection is best-effort: profile shots, sunglasses, and small faces miss most often.';
      state.selected = 0;
      setDrawMode(true);
    } else {
      state.selected = pickLargestFace(result.boxes);
      detectStatus.textContent = result.boxes.length === 1
        ? 'Found 1 face.'
        : `Found ${result.boxes.length} faces — the largest is selected. Tap another box to switch.`;
      setDrawMode(false);
    }
    nextFaceBtn.hidden = result.boxes.length < 2;
    renderBoxes();
  }

  /** @param {boolean} on */
  function setDrawMode(on) {
    state.drawMode = on;
    $('draw-btn').setAttribute('aria-pressed', String(on));
    $('draw-btn').textContent = on ? 'Done drawing — drag the box to adjust' : 'Draw a box instead';
    pickHint.textContent = on
      ? 'Drag on the photo to draw a box around the face.'
      : 'Tap a box to select it. Drag the selected box to move it, or drag its bottom-right corner to resize it.';
  }

  // ---------- box overlay: select / move / resize / draw ----------
  /**
   * Rebuild the box overlay from state. Used when the box count or
   * selection changes. NOT used on pointermove — see updateBoxElements:
   * rebuilding the DOM on every move discarded focus, recreated the
   * resize handle mid-drag, and was the original code's main jank.
   */
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
    playBtn.disabled = state.boxes.length === 0;
  }

  /** Update box positions in place during a drag, without rebuilding nodes. Falls back to a rebuild if the node count drifted. */
  function updateBoxElements() {
    if (boxesEl.children.length !== state.boxes.length) { renderBoxes(); return; }
    state.boxes.forEach((box, i) => {
      const el = boxesEl.children[i];
      const p = pct(box);
      el.style.left = p.left + '%'; el.style.top = p.top + '%';
      el.style.width = p.width + '%'; el.style.height = p.height + '%';
      el.classList.toggle('is-selected', i === state.selected);
    });
  }

  /** @type {import('./face.js').Gesture & {index: number, rect: DOMRect, moved: boolean}|null} */
  let gesture = null;
  photoStage.addEventListener('pointerdown', (e) => {
    const rect = photoStage.getBoundingClientRect();
    const f = stageFraction(e, rect);
    if (e.target.closest('.resize-handle')) {
      gesture = { kind: 'resize', index: state.selected, startBox: { ...state.boxes[state.selected] }, startX: f.x, startY: f.y, rect, moved: false };
    } else if (e.target.closest('.face-box')) {
      const idx = Array.from(boxesEl.children).indexOf(e.target.closest('.face-box'));
      state.selected = idx;
      renderBoxes();
      gesture = { kind: 'move', index: idx, startBox: { ...state.boxes[idx] }, startX: f.x, startY: f.y, rect, moved: false };
    } else if (state.drawMode) {
      gesture = { kind: 'draw', index: 0, startBox: null, startX: f.x, startY: f.y, rect, moved: false };
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
    const f = stageFraction(e, gesture.rect);
    const dx = f.x - gesture.startX;
    const dy = f.y - gesture.startY;
    if (Math.abs(dx) + Math.abs(dy) > MOVE_THRESHOLD) gesture.moved = true;
    // Math lives in face.js (pure, tested); this handler only writes the result back.
    state.boxes[gesture.index] = applyGesture(gesture, f.x, f.y);
    updateBoxElements();
  });
  function endGesture() {
    if (!gesture) return;
    // A click without a drag is not a box: discard the 0.05 stub and
    // stay in draw mode, instead of letting the user "play" a speck.
    if (gesture.kind === 'draw' && !gesture.moved) {
      state.boxes = [];
      playBtn.disabled = true;
    } else if (gesture.kind === 'draw') {
      setDrawMode(false);
    }
    gesture = null;
    renderBoxes();
  }
  photoStage.addEventListener('pointerup', endGesture);
  photoStage.addEventListener('pointercancel', endGesture);

  // ---------- play stage ----------
  /**
   * Crop the selected face (with CROP_PAD margin, so forehead and chin
   * come along instead of a tight detector rectangle) and enter play.
   * Async because the crop is encoded as a blob URL — the original
   * used a base64 data URL, which is ~33% larger and, worse, made the
   * existing revokeObjectURL call a silent no-op.
   * @returns {Promise<void>}
   */
  async function startPlay() {
    if (state.boxes.length === 0) return;
    const generation = ++state.playGeneration;
    // Reset warp state: a stale mesh from a previous face must never
    // warp a new face, even if its landmark request lands late.
    warp.mesh = null; warp.deformed = null; warp.handles = []; warp.basePoints = null;
    warp.dragging = false; cancelAnimationFrame(warp.springRaf);
    const expanded = expandBox(state.boxes[state.selected], CROP_PAD);
    const px = boxToPixels(expanded, state.width, state.height);
    const crop = document.createElement('canvas');
    crop.width = px.width; crop.height = px.height;
    crop.getContext('2d').drawImage(state.canvas, px.x, px.y, px.width, px.height, 0, 0, px.width, px.height);
    if (state.playUrl) URL.revokeObjectURL(state.playUrl);
    state.playUrl = await canvasToObjectUrl(crop, 'image/jpeg', JPEG_QUALITY);
    playFace.src = state.playUrl;
    state.best = 0;
    state.scaleX = 1; state.scaleY = 1;
    setStretch(1, 1);
    stretchBest.textContent = 'Biggest stretch yet: 1.0×';
    setPlayMode('whole');
    pullPartsBtn.disabled = true;
    landmarkStatus.textContent = 'Finding face parts… (whole-face stretch works meanwhile)';
    show('play');
    playFace.focus({ preventScroll: true });
    // Landmarks are progressive enhancement, not a gate: the user
    // can already stretch the whole face while the model downloads.
    // If landmarks fail, whole-face mode simply stays the mode —
    // the same fallback principle as the manual box in step 2.
    try {
      const result = await detectFaceLandmarks(crop);
      if (generation !== state.playGeneration) return;
      if (result.error || result.points.length < 10) {
        landmarkStatus.textContent = (result.error || 'Face parts not found — whole-face stretch is still available.');
        return;
      }
      const mesh = buildWarpMesh(result.points, crop.width, crop.height);
      if (!mesh) {
        landmarkStatus.textContent = 'Face parts not found — whole-face stretch is still available.';
        return;
      }
      warp.sourceCanvas = crop;
      warp.mesh = mesh;
      warp.deformed = mesh.points.map((p) => ({ ...p }));
      warp.basePoints = mesh.points.map((p) => ({ ...p }));
      warp.radius = Math.max(20, faceWidth(result.points) * PULL_RADIUS_FACTOR);
      // Handles: named landmarks via the dedupe map, plus cheeks
      // geometrically (leftmost/rightmost landmark, mapped the same way).
      const cheeks = cheekIndices(result.points);
      const handleDefs = FACE_HANDLES.map((h) => ({
        label: h.label,
        meshIndex: mesh.landmarkMap[h.landmarkIndex],
      })).filter((h) => h.meshIndex !== undefined);
      handleDefs.push(
        { label: 'Left cheek', meshIndex: mesh.landmarkMap[cheeks.left] },
        { label: 'Right cheek', meshIndex: mesh.landmarkMap[cheeks.right] },
      );
      warp.handles = handleDefs.filter((h) => h.meshIndex !== undefined);
      pullPartsBtn.disabled = false;
      landmarkStatus.textContent = 'Face parts found — tap “Pull face parts”, or grab the nose, chin, eyes, mouth, or cheeks.';
      // Auto-switch to the mode the user just asked to build: they
      // are not mid-drag yet (play just opened), so switching now
      // is not an interruption. Whole-face stays one tap away.
      if (!dragging) setPlayMode('warp');
    } catch (err) {
      if (generation !== state.playGeneration) return;
      landmarkStatus.textContent = 'Face parts not found — whole-face stretch is still available.';
    }
  }

  // ---------- warp play mode ----------
  /**
   * Switch play modes. Display is toggled by style, not `hidden`
   * (see the index.html comment: .play-face's display:block would
   * override the hidden attribute). Focus follows the visible element.
   * @param {'whole'|'warp'} mode
   */
  function setPlayMode(mode) {
    if (mode === 'warp' && !warp.mesh) mode = 'whole';
    state.playMode = mode;
    playFace.style.display = mode === 'whole' ? '' : 'none';
    playWarpWrap.style.display = mode === 'warp' ? '' : 'none';
    pullPartsBtn.setAttribute('aria-pressed', String(mode === 'warp'));
    wholeFaceBtn.setAttribute('aria-pressed', String(mode === 'whole'));
    if (mode === 'warp') {
      playCanvas.width = warp.sourceCanvas.width;
      playCanvas.height = warp.sourceCanvas.height;
      renderHandles();
      renderWarp();
      playCanvas.focus({ preventScroll: true });
    } else {
      playFace.focus({ preventScroll: true });
    }
  }

  /** Pointer position in warp-canvas pixels (display size != canvas size). */
  function warpCanvasPoint(e) {
    const r = playCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (playCanvas.width / r.width),
      y: (e.clientY - r.top) * (playCanvas.height / r.height),
    };
  }

  /** Draw the current deformed mesh, throttled to one rAF per frame. */
  function scheduleRenderWarp() {
    if (warp.rafPending) return;
    warp.rafPending = true;
    requestAnimationFrame(() => {
      warp.rafPending = false;
      renderWarp();
    });
  }

  function renderWarp() {
    if (!warp.mesh) return;
    const ctx = playCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, playCanvas.width, playCanvas.height);
    drawWarped(ctx, warp.sourceCanvas, warp.mesh.points, warp.deformed, warp.mesh.triangles);
    renderHandles();
  }

  /** Position handle dots over the deformed points. Dots are visual
   * guides only (pointer-events:none in CSS): a drag always hits the
   * canvas, and the nearest landmark becomes the grab point. */
  function renderHandles() {
    playHandles.innerHTML = '';
    if (!warp.mesh || !warp.deformed) return;
    warp.handles.forEach((h) => {
      const p = warp.deformed[h.meshIndex];
      if (!p) return;
      const dot = document.createElement('span');
      dot.className = 'play-handle';
      dot.title = h.label;
      dot.style.left = (p.x / playCanvas.width * 100) + '%';
      dot.style.top = (p.y / playCanvas.height * 100) + '%';
      playHandles.appendChild(dot);
    });
  }

  /**
   * Spring the deformed mesh back to rest over ~350ms with an
   * overshoot ease, or instantly under prefers-reduced-motion.
   * @param {Point[]} fromDeformed - Deformed points at release.
   */
  function animateWarpSpringBack(fromDeformed) {
    cancelAnimationFrame(warp.springRaf);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      warp.deformed = warp.mesh.points.map((p) => ({ ...p }));
      warp.basePoints = warp.mesh.points.map((p) => ({ ...p }));
      renderWarp();
      return;
    }
    const start = performance.now();
    const duration = 350;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const f = easeOutBack(t);
      warp.deformed = warp.mesh.points.map((p, i) => ({
        x: fromDeformed[i].x + (p.x - fromDeformed[i].x) * f,
        y: fromDeformed[i].y + (p.y - fromDeformed[i].y) * f,
      }));
      renderWarp();
      if (t < 1) warp.springRaf = requestAnimationFrame(step);
      else {
        warp.deformed = warp.mesh.points.map((p) => ({ ...p }));
        warp.basePoints = warp.mesh.points.map((p) => ({ ...p }));
      }
    };
    warp.springRaf = requestAnimationFrame(step);
  }

  /** Pull one handle by (dx, dy) canvas pixels, then spring back — unless Hold is on, in which case it stays. */
  function warpPullAndSpring(grabIndex, dx, dy) {
    if (!warp.mesh) return;
    cancelAnimationFrame(warp.springRaf);
    clearTimeout(warp.springTimeout);
    const base = warp.basePoints || warp.mesh.points;
    warp.deformed = deformPoints(base, grabIndex, dx, dy, warp.radius, warp.mesh.anchorIndices);
    renderWarp();
    if (holdToggle.checked) {
      warp.basePoints = warp.deformed.map((p) => ({ ...p }));
    } else {
      warp.springTimeout = setTimeout(() => animateWarpSpringBack(warp.deformed), 220);
    }
    playBoing(soundToggle.checked);
  }

  playCanvas.tabIndex = 0;
  playCanvas.addEventListener('pointerdown', (e) => {
    if (!warp.mesh) return;
    cancelAnimationFrame(warp.springRaf);
    clearTimeout(warp.springTimeout);
    // Snapshot the current mesh as the drag base: rest normally,
    // held deformed after a held pull. Without this, every drag
    // would recompute from rest and wipe the held stretch.
    warp.basePoints = warp.deformed.map((p) => ({ ...p }));
    const p = warpCanvasPoint(e);
    // Nearest landmark is the grab — no need to hit a 14px dot
    // exactly, which would be fiddly on a phone. Anchors (corners)
    // are excluded: pulling a corner would drag the background.
    warp.grabIndex = findNearestPoint(warp.mesh.points, p.x, p.y, warp.mesh.anchorIndices);
    if (warp.grabIndex < 0) return;
    warp.dragging = true;
    playWarpWrap.classList.add('is-dragging');
    warp.startCanvasX = p.x; warp.startCanvasY = p.y; warp.lastDragPx = 0;
    try { playCanvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
  });
  playCanvas.addEventListener('pointermove', (e) => {
    if (!warp.dragging) return;
    const p = warpCanvasPoint(e);
    const dx = p.x - warp.startCanvasX, dy = p.y - warp.startCanvasY;
    warp.lastDragPx = Math.hypot(dx, dy);
    warp.deformed = deformPoints(warp.basePoints, warp.grabIndex, dx, dy, warp.radius, warp.mesh.anchorIndices);
    scheduleRenderWarp();
  });
  function endWarpDrag() {
    if (!warp.dragging) return;
    warp.dragging = false;
    playWarpWrap.classList.remove('is-dragging');
    if (holdToggle.checked) {
      // Hold is the point of this mode: the pull stays, and the
      // next drag starts from it (basePoints, snapshotted at
      // pointerdown). Reset face is the only way back to rest.
      warp.basePoints = warp.deformed.map((p) => ({ ...p }));
    } else {
      animateWarpSpringBack(warp.deformed);
    }
    if (warp.lastDragPx > 40) playBoing(soundToggle.checked);
  }
  playCanvas.addEventListener('pointerup', endWarpDrag);
  playCanvas.addEventListener('pointercancel', endWarpDrag);
  playCanvas.addEventListener('keydown', (e) => {
    // Keyboard pull in warp mode: arrow keys pull the nose handle.
    // Whole-face arrow pulls live on the img; this is the warp equivalent.
    if (!warp.mesh) return;
    const nose = warp.handles.find((h) => h.label === 'Nose');
    if (!nose) return;
    const step = warp.radius * 0.35;
    if (e.key === 'ArrowRight') { e.preventDefault(); warpPullAndSpring(nose.meshIndex, step, 0); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); warpPullAndSpring(nose.meshIndex, -step, 0); }
    if (e.key === 'ArrowDown') { e.preventDefault(); warpPullAndSpring(nose.meshIndex, 0, step); }
    if (e.key === 'ArrowUp') { e.preventDefault(); warpPullAndSpring(nose.meshIndex, 0, -step); }
  });

  /**
   * Apply a stretch and update the readout + best-stretch meter.
   * @param {number} sx
   * @param {number} sy
   */
  function setStretch(sx, sy) {
    state.scaleX = sx; state.scaleY = sy;
    playFace.style.transform = `scale(${sx}, ${sy})`;
    stretchReadout.textContent = `${sx.toFixed(1)}× × ${sy.toFixed(1)}×`;
    const amount = stretchAmount(sx, sy);
    if (amount > state.best) {
      state.best = amount;
      stretchBest.textContent = `Biggest stretch yet: ${(1 + state.best).toFixed(1)}×`;
    }
  }

  /**
   * Reset both play modes to rest: whole-face scale to 1x1, warp
   * mesh to its rest points, best-stretch meter cleared. This is
   * the "reset someway" for Hold mode — without it, a held stretch
   * would have no way back except a new photo.
   */
  function resetFace() {
    cancelAnimationFrame(warp.springRaf);
    clearTimeout(warp.springTimeout);
    warp.dragging = false; dragging = false;
    if (playWarpWrap) playWarpWrap.classList.remove('is-dragging');
    playFace.classList.remove('is-springing');
    state.best = 0;
    setStretch(1, 1);
    stretchBest.textContent = 'Biggest stretch yet: 1.0×';
    if (warp.mesh) {
      warp.deformed = warp.mesh.points.map((p) => ({ ...p }));
      warp.basePoints = warp.mesh.points.map((p) => ({ ...p }));
      if (state.playMode === 'warp') renderWarp();
    }
  }

  /**
   * Animate a button/keyboard pull, then spring back — unless Hold
   * is on, in which case the pull stays until Reset face.
   * The double requestAnimationFrame is not cargo-cult: removing the
   * spring class and setting the transform in the same frame lets
   * the browser batch them, so the transition never runs. Two frames
   * force a style recalc between the two states.
   * @param {number} sx
   * @param {number} sy
   */
  function animatePull(sx, sy) {
    playFace.classList.remove('is-springing');
    setStretch(sx, sy);
    if (holdToggle.checked) {
      playBoing(soundToggle.checked);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      playFace.classList.add('is-springing');
      setStretch(1, 1);
      playBoing(soundToggle.checked);
    }));
  }

  let dragging = false, startX = 0, startY = 0, lastAmount = 0, startScaleX = 1, startScaleY = 1;
  playFace.tabIndex = 0;
  playFace.addEventListener('pointerdown', (e) => {
    dragging = true; startX = e.clientX; startY = e.clientY; lastAmount = 0;
    startScaleX = state.scaleX; startScaleY = state.scaleY;
    playFace.classList.remove('is-springing');
    try { playFace.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
  });
  playFace.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const s = computeStretch(e.clientX - startX, e.clientY - startY);
    // Combine with the held scale, not 1x1: otherwise a second drag
    // would snap a held stretch back to near-rest on its first move.
    const combined = combineStretch({ scaleX: startScaleX, scaleY: startScaleY }, s);
    setStretch(combined.scaleX, combined.scaleY);
    lastAmount = stretchAmount(s.scaleX, s.scaleY);
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    if (!holdToggle.checked) {
      playFace.classList.add('is-springing');
      setStretch(1, 1);
    }
    if (lastAmount > BOING_THRESHOLD) playBoing(soundToggle.checked);
  }
  playFace.addEventListener('pointerup', endDrag);
  playFace.addEventListener('pointercancel', endDrag);
  playFace.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); animatePull(PULL_WIDE.scaleX, PULL_WIDE.scaleY); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); animatePull(PULL_TALL.scaleX, PULL_TALL.scaleY); }
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
  nextFaceBtn.addEventListener('click', () => {
    if (state.boxes.length === 0) return;
    state.selected = (state.selected + 1) % state.boxes.length;
    renderBoxes();
  });
  $('redetect-btn').addEventListener('click', () => void detectFaces(state.loadGeneration));
  playBtn.addEventListener('click', () => void startPlay());
  $('new-photo-btn').addEventListener('click', () => show('upload'));
  $('back-to-pick-btn').addEventListener('click', () => show('pick'));
  $('play-new-photo-btn').addEventListener('click', () => show('upload'));
  pullPartsBtn.addEventListener('click', () => setPlayMode('warp'));
  wholeFaceBtn.addEventListener('click', () => setPlayMode('whole'));
  resetFaceBtn.addEventListener('click', () => resetFace());
  themeToggle.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('face-stretch-theme', next); } catch (err) { /* best-effort */ }
    applyThemeClass(next);
    updateThemeButton(next);
  });
  anchorModeSelect.addEventListener('change', () => applyAnchorMode(anchorModeSelect.value));
  // Pull wide/tall/squish are whole-face presets: in warp mode they
  // switch back first, rather than doing a confusing half-warp.
  function wholePull(sx, sy) {
    if (state.playMode === 'warp') setPlayMode('whole');
    animatePull(sx, sy);
  }
  $('pull-wide-btn').addEventListener('click', () => wholePull(PULL_WIDE.scaleX, PULL_WIDE.scaleY));
  $('pull-tall-btn').addEventListener('click', () => wholePull(PULL_TALL.scaleX, PULL_TALL.scaleY));
  $('squish-btn').addEventListener('click', () => wholePull(PULL_SQUISH.scaleX, PULL_SQUISH.scaleY));
})();
