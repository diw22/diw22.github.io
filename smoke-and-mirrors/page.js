(() => {
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const desktop = matchMedia("(min-width: 701px)");
  const reveals = [...document.querySelectorAll("[data-reveal]")];
  const drift = [...document.querySelectorAll("[data-drift]")];
  let observer, frame = 0;

  function reveal(element) {
    element.classList.add("is-revealing");
    element.classList.remove("is-pending");
    observer?.unobserve(element);
  }
  function configure() {
    observer?.disconnect();
    reveals.forEach(element => element.classList.remove("is-pending", "is-revealing"));
    if (motion.matches || !("IntersectionObserver" in window)) return;
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) reveal(entry.target); });
    }, { threshold: 0.08 });
    reveals.forEach(element => {
      if (element.getBoundingClientRect().top > innerHeight) {
        element.classList.add("is-pending");
        observer.observe(element);
      }
    });
  }
  function updateDrift() {
    frame = 0;
    const enabled = !motion.matches && desktop.matches;
    drift.forEach(element => {
      const bounds = element.getBoundingClientRect();
      const offset = enabled ? Math.max(-14, Math.min(14, (innerHeight / 2 - bounds.top - bounds.height / 2) * .025)) : 0;
      element.style.setProperty("--drift", `${offset.toFixed(2)}px`);
    });
  }
  function queueDrift() { if (!frame) frame = requestAnimationFrame(updateDrift); }
  // Native scrolling stays untouched; only two visible image surfaces move a few pixels.
  window.addEventListener("scroll", queueDrift, { passive: true });
  window.addEventListener("resize", queueDrift, { passive: true });
  window.addEventListener("pageshow", () => { configure(); queueDrift(); });
  motion.addEventListener("change", () => { configure(); queueDrift(); });
  desktop.addEventListener("change", queueDrift);
  document.addEventListener("focusin", event => {
    const pending = event.target.closest("[data-reveal].is-pending");
    if (pending) reveal(pending);
  });
  configure();
  queueDrift();
})();
