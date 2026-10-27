// Implied-volatility surface drawn as a particle grid for the projects stage.
// Hovering a point reads out its strike, expiry and vol; the stage supplies rotation and
// a front layer (`front.ctx`, offset by `front.dy`) so the readout sits above the title.
const ease = (t) => 1 - Math.pow(1 - t, 3);
const INK = "#1f2c38", RED = "#e2231a", PAPER = "#f2f0eb", FONT = '"Nunito Sans", Arial, sans-serif';
const NK = 72, NT = 48, K0 = 70, K1 = 130, T0 = .05, T1 = 2;
const iv = (K, T) => {
  const m = Math.log(K / 100), st = Math.sqrt(T);
  const atm = .19 + .06 * Math.exp(-T * 3) - .025 * st + .03 * Math.exp(-((T - .9) ** 2) / .08);
  const skew = -.22 * m / (st + .25), smile = .9 * m * m / (T + .2), wing = 2.4 * m ** 4 / (T + .1);
  const event = .07 * Math.exp(-((T - .35) ** 2) / .004) * Math.exp(-(m * m) / .02);
  const ripple = .008 * Math.sin(m * 38 + T * 6) * Math.exp(-T);
  return atm + skew + smile + wing + event + ripple;
};
const GRID = []; let zMin = 1e9, zMax = 0;
for (let j = 0; j < NT; j++) for (let i = 0; i < NK; i++) { const K = K0 + (K1 - K0) * i / (NK - 1), T = T0 + (T1 - T0) * j / (NT - 1), V = iv(K, T); zMin = Math.min(zMin, V); zMax = Math.max(zMax, V); GRID.push({ K, T, V, i, j, sx: Math.random() * 2 - 1, sy: Math.random() * 2 - 1, sz: Math.random() * 2, d: Math.random() * .5 }); }

export function createVolSurface(canvas) {
  const ctx = canvas.getContext("2d");
  let w = 1, h = 1, t0 = performance.now();
  return {
    resize(nw, nh) { w = nw; h = nh; const d = Math.min(2, devicePixelRatio || 1); canvas.width = w * d; canvas.height = h * d; ctx.setTransform(d, 0, 0, d, 0, 0); },
    // Re-run the fly-in whenever the stage switches to this project.
    replay() { t0 = performance.now(); },
    draw(yawDeg, tiltDeg, mouse, front) {
      const now = performance.now(), el = (now - t0) / 1000, yaw = -.62 + yawDeg * Math.PI / 180, pitch = .5 + tiltDeg * Math.PI / 180;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h * .55, S = Math.min(w * .22, h * .4);
      const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const proj = (u, v, z) => { const x = u * cyw - v * syw, y = u * syw + v * cyw; const y2 = y * cp - z * sp, z2 = y * sp + z * cp; const f = 3.2 / (3.2 + y2 * .6); return [cx + x * S * f, cy - z2 * S * f, f, y2]; };
      const pts = GRID.map((p) => {
        const u = p.i / (NK - 1) * 2 - 1, v = p.j / (NT - 1) * 2 - 1, z = (p.V - zMin) / (zMax - zMin) * 1.05 - .35 + Math.sin(now * .0012 + p.i * .22 + p.j * .31) * .012;
        const k = ease(Math.max(0, Math.min(1, (el - .2 - p.d - (NT - p.j) * .025) / 1.1)));
        const [x, y, f, depth] = proj(p.sx * 2.2 + (u - p.sx * 2.2) * k, p.sy * 2.2 + (v - p.sy * 2.2) * k, p.sz + (z - p.sz) * k);
        return { p, x, y, f, depth, k };
      });
      let hi = null;
      if (mouse) { let best = 900; for (const q of pts) { const d = (q.x - mouse.x) ** 2 + (q.y - mouse.y) ** 2; if (d < best) { best = d; hi = q; } } }
      pts.sort((a, b) => b.depth - a.depth);
      for (const q of pts) {
        const lit = hi && (q.p.j === hi.p.j || q.p.i === hi.p.i);
        ctx.globalAlpha = Math.max(0, Math.min(1, lit ? 1 : q.k * (.3 + q.f * .55)));
        ctx.fillStyle = lit ? RED : INK;
        const r = (lit ? 2.4 : 1.6) * q.f; ctx.fillRect(q.x - r / 2, q.y - r / 2, r, r);
      }
      ctx.globalAlpha = 1;
      if (hi && front) {
        const f = front.ctx, { p } = hi, x = hi.x, y = hi.y + front.dy, lx = x + 18, ly = y - 62;
        f.fillStyle = RED; f.fillRect(x - 4, y - 4, 8, 8);
        f.fillStyle = INK; f.fillRect(lx, ly, 100, 58);
        f.font = `600 13px ${FONT}`; f.textBaseline = "top"; f.textAlign = "left"; f.fillStyle = PAPER;
        [`K   ${p.K.toFixed(0)}`, `T   ${p.T.toFixed(2)}y`, `σ   ${(p.V * 100).toFixed(1)}%`].forEach((t, n) => f.fillText(t, lx + 10, ly + 8 + n * 16));
      }
      ctx.fillStyle = INK; ctx.font = `600 12px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.globalAlpha = ease(Math.min(1, Math.max(0, el - 1.2)));
      const [ax, ay] = proj(0, -1.25, -.35), [tx, ty] = proj(1.25, 0, -.35), [zx, zy] = proj(-1.1, 1.1, .7);
      ctx.fillText("Strike K", ax, ay); ctx.fillText("Expiry T", tx, ty); ctx.fillText("Implied vol σ", zx, zy); ctx.globalAlpha = 1;
    }
  };
}
