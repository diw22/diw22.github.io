// Shared click feedback for portfolio navigation and project controls.
(() => {
  const audioRoot = new URL("../audio/", document.currentScript.src);
  const files = {
    home: "humordome-soft-ui-pop-light-minimal-click-451232.mp3",
    button: "kauasilbershlachparodes-chutter-click-494024.mp3",
    project: "soundshelfstudio-ui-click-deep-512211.mp3"
  };
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  let context;
  try { context = new AudioContext(); } catch { return; }
  const buffers = {};
  const ready = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, (async () => {
    try {
      const response = await fetch(new URL(file, audioRoot));
      if (!response.ok) return;
      buffers[name] = await context.decodeAudioData(await response.arrayBuffer());
    } catch { /* Controls still work if audio is unavailable. */ }
  })()]));
  let active, version = 0;

  async function play(name) {
    const request = ++version;
    const pressedAt = performance.now();
    try {
      // Resume inside the user gesture, including keyboard and touch activation.
      const resumed = context.resume().then(() => true, () => false);
      await ready[name];
      if (request !== version || !buffers[name] || document.hidden || performance.now() - pressedAt > 500) return false;
      const now = context.currentTime;
      if (active) {
        active.gain.gain.cancelScheduledValues(now);
        active.gain.gain.setTargetAtTime(0, now, 0.008);
        active.source.stop(now + 0.04);
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffers[name];
      gain.gain.value = 0.5;
      source.connect(gain).connect(context.destination);
      const sound = { source, gain };
      active = sound;
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        if (active === sound) active = null;
      };
      source.start();
      return await resumed;
    } catch { return false; /* Playback restrictions must never prevent navigation. */ }
  }

  // Wake the audio device on press, before the subsequent click navigates away.
  const controls = 'a[href], button, summary, [role="button"], input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"]';
  function controlFor(event) {
    const control = event.target instanceof Element && event.target.closest(controls);
    return control && !control.matches(":disabled") && !control.closest('[inert], [aria-disabled="true"]') ? control : null;
  }
  function unlock(event) {
    if (event.isTrusted && controlFor(event) && context.state !== "running") context.resume().catch(() => {});
  }
  document.addEventListener("pointerdown", (event) => { if (event.button === 0) unlock(event); }, { capture: true, passive: true });
  document.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") unlock(event); }, { capture: true });

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let navigationVersion = 0;
  document.addEventListener("click", (event) => {
    if (!event.isTrusted || event.button !== 0) return;
    const control = controlFor(event);
    if (!control) return;
    const navigation = ++navigationVersion;
    // Capture the source page before routing updates the body classes.
    const sound = document.body.classList.contains("is-home") ? "home"
      : control.matches(".card-entry, .next-project-link") ? "project" : "button";
    const playback = play(sound);
    if (sound !== "project" || !control.matches("a[href]") || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || control.hasAttribute("download") || (control.target && control.target !== "_self")) return;
    const destination = new URL(control.href, location.href);
    if (destination.origin !== location.origin || (destination.pathname === location.pathname && destination.search === location.search)) return;
    // aeroBot opens a new document. Give the click's audible attack time to play
    // before that document destroys this AudioContext; never wait on failed audio.
    event.preventDefault();
    Promise.race([playback.then((started) => started ? delay(270) : undefined), delay(650)]).then(() => {
      if (navigation === navigationVersion) location.assign(destination.href);
    });
  }, { capture: true });
})();
