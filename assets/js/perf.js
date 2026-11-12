/* Keeps the site smooth on slower computers. It starts from what the browser reports (3D drawn in software means a
   slow machine, so that goes straight to the lightest level), then watches the frame rate: when frames keep taking
   too long it steps down a level, and each page decides what a level means for it. Levels only go down, and the
   level carries over for the rest of the visit.

   0  full quality
   1  3D and canvases at no more than 1 pixel per CSS pixel, fewer title particles
   2  lower again, no shadows or decorative animation
   3  lightest: no live 3D views (pictures instead), plain titles

   ?perf=0..3 in the address previews a level on any machine (e.g. diw22.github.io/?perf=3#work) and keeps it for
   the rest of the visit in that tab; ?perf=0 goes back to normal.

   To see what it decided and why: the browser console logs each choice ("Graphics: …"), and SitePerf.level,
   SitePerf.reason, SitePerf.renderer and SitePerf.webgl can be typed into the console. */
(() => {
  "use strict";
  const KEY = "site-perf-level", MAX = 3, SLOW_MS = 34, WINDOW_MS = 2000;
  const root = document.documentElement;
  const stored = () => { try { return Number(sessionStorage.getItem(KEY)) || 0; } catch { return 0; } };
  const store = (value) => { try { sessionStorage.setItem(KEY, String(value)); } catch { /* not remembered */ } };

  // What the browser draws 3D with. No WebGL at all usually means graphics acceleration is switched off.
  function graphics() {
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      if (!gl) return { webgl: false, renderer: "none" };
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return { webgl: true, renderer, software: /swiftshader|software|llvmpipe|softpipe|basic render/i.test(renderer) };
    } catch { return { webgl: false, renderer: "none" }; }
  }

  const gpu = graphics(), forced = new URLSearchParams(location.search).get("perf");
  const preview = forced !== null && /^[0-3]$/.test(forced), earlier = stored();
  let level, reason;
  if (preview) { level = Number(forced); reason = `previewing level ${level} (?perf=${level})`; }
  else if (!gpu.webgl) { level = MAX; reason = "no 3D graphics in this browser (graphics acceleration is probably off)"; }
  else if (gpu.software) { level = MAX; reason = `3D is drawn in software (${gpu.renderer})`; }
  else if (earlier) { level = earlier; reason = "kept from earlier in this visit"; }
  else { level = 0; reason = `full quality on ${gpu.renderer}`; }
  // A previewed level holds for the rest of the visit in this tab; ?perf=0 goes back to normal.
  if (preview) store(level);
  root.dataset.perf = level;
  console.info(`Graphics: level ${level} of ${MAX}, ${reason}.`);
  const listeners = new Set();

  function lower(medianMs) {
    if (level >= MAX) return;
    level += 1;
    reason = `frames were taking ${Math.round(medianMs)} ms (about ${Math.round(1000 / medianMs)} per second)`;
    root.dataset.perf = level;
    store(level);
    console.info(`Graphics: stepped down to level ${level} of ${MAX}, ${reason}.`);
    listeners.forEach((listener) => listener(level));
  }

  // Frames are judged by the median gap over two-second windows, so a single long frame (a model arriving, say)
  // doesn't count. Nothing is judged while a page is still loading, nor for a moment after each step down.
  let quietUntil = performance.now() + 2500, holds = 0, running = false;
  function watch() {
    if (running || level >= MAX) return;
    running = true;
    let last = 0, start = 0, gaps = [];
    const tick = (now) => {
      if (level >= MAX) { running = false; return; }
      if (holds || now < quietUntil || document.hidden) { gaps = []; start = now; last = now; requestAnimationFrame(tick); return; }
      gaps.push(now - last);
      last = now;
      if (now - start >= WINDOW_MS && gaps.length >= 2) {
        gaps.sort((a, b) => a - b);
        const median = gaps[gaps.length >> 1];
        if (median > SLOW_MS) { lower(median); quietUntil = now + 2500; }
        gaps = []; start = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame((now) => { last = start = now; requestAnimationFrame(tick); });
  }

  window.SitePerf = {
    MAX,
    webgl: gpu.webgl,
    renderer: gpu.renderer,
    get level() { return level; },
    get reason() { return reason; },
    // Calls back with each new level, and starts the watching.
    onChange(listener) { listeners.add(listener); watch(); return () => listeners.delete(listener); },
    // Pauses judging until the promise settles (and a moment after), e.g. while models load.
    hold(promise) {
      holds += 1;
      Promise.resolve(promise).catch(() => {}).finally(() => { holds -= 1; quietUntil = Math.max(quietUntil, performance.now() + 1500); });
    }
  };
})();
