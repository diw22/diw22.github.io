/* A stippled reflection gathers, then disperses as the reader passes it.
   This is a separate drawing in the page's whitespace, never an image filter. */
(() => {
  const host = document.querySelector('.point-study');
  const canvas = host?.querySelector('canvas');
  const context = canvas?.getContext('2d');
  if (!context) return;

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const colours = ['#633946', '#956b79', '#8d8b91', '#9c9277'];
  let seed = 92;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  // Stable positions preserve the drawing across resizes and return navigation.
  const points = Array.from({ length: 2200 }, () => {
    const angle = random() * Math.PI * 2;
    const radius = random() < .22 ? .94 + random() * .06 : Math.sqrt(random());
    const height = random();
    const horizontal = Math.cos(angle) * radius;
    const vertical = Math.sin(angle) * radius;
    return {
      x: .5 + horizontal * .21 + vertical * .026 + (random() - .5) * .012,
      y: .5 + vertical * .36 + (random() - .5) * .012,
      smokeX: .5 + Math.sin(height * 7.5) * .19 + (random() - .5) * .34,
      smokeY: .08 + height * .84,
      size: .45 + random() * 1.05,
      opacity: (.2 + random() * .4) * (.7 + horizontal * .3),
      colour: colours[random() < .5 ? (horizontal > 0 ? 0 : 2) : Math.floor(random() * colours.length)]
    };
  });
  let width = 0, height = 0, frame = 0, visible = false;
  let current = .5, target = .5, lastTime = 0;

  function progress() {
    if (motion.matches) return .08;
    const bounds = host.getBoundingClientRect();
    const passage = (innerHeight - bounds.top) / (innerHeight + bounds.height);
    // A quiet oval resolves near the centre of the viewport, then becomes smoke.
    return Math.min(1, Math.abs(passage - .48) * 2.7);
  }
  function draw() {
    context.clearRect(0, 0, width, height);
    const blend = current * current * (3 - 2 * current);
    const count = width < 400 ? 1400 : points.length;
    for (let i = 0; i < count; i++) {
      const point = points[i];
      const x = point.x + (point.smokeX - point.x) * blend;
      const y = point.y + (point.smokeY - point.y) * blend;
      context.globalAlpha = point.opacity * (1 - blend * .3);
      context.fillStyle = point.colour;
      context.beginPath();
      context.arc(x * width, y * height, point.size * Math.min(1, width / 400), 0, Math.PI * 2);
      context.fill();
    }
  }
  function tick(time) {
    frame = 0;
    const delta = Math.min(64, time - (lastTime || time - 16));
    lastTime = time;
    current += (target - current) * (1 - Math.exp(-delta / 180));
    if (Math.abs(target - current) < .001) current = target;
    draw();
    if (visible && !document.hidden && current !== target) frame = requestAnimationFrame(tick);
  }
  function update() {
    if (!visible || document.hidden) return;
    target = progress();
    if (motion.matches) {
      cancelAnimationFrame(frame);
      frame = 0;
      current = target;
      draw();
    } else if (!frame) {
      lastTime = 0;
      frame = requestAnimationFrame(tick);
    }
  }
  function resize() {
    const bounds = host.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    current = target = progress();
    draw();
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      if (visible) update();
      else { cancelAnimationFrame(frame); frame = 0; }
    }, { rootMargin: '60px' }).observe(host);
  } else visible = true;
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(host);
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('pageshow', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
    else update();
  });
  motion.addEventListener('change', update);
  resize();
})();
