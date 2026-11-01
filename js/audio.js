// The boing, isolated so app.js never touches AudioContext.
//
// Why a factory, not a bare function: the AudioContext must be
// created lazily (browsers block audio before a user gesture) and
// reused across pulls. A factory holding one context in a closure
// gives app.js a plain playBoing() with no lifecycle to manage.
// Sound is decoration by design: every failure is swallowed here,
// so a blocked AudioContext can never break play.

/**
 * @returns {(enabled: boolean) => void} playBoing(enabled) — a no-op
 *   when sound is toggled off, a short sine slide (320 Hz -> 70 Hz)
 *   when on.
 */
function createBoingPlayer() {
  /** @type {AudioContext|null} */
  let ctx = null;
  return function playBoing(enabled) {
    if (!enabled) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.22);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.26);
    } catch (err) {
      // Sound is decoration; never block play.
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createBoingPlayer };
}
