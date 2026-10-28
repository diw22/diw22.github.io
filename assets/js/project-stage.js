(() => {
// `solid` projects show their title as plain text with their live view behind it rather than in front.
const PROJECTS = [
  { slug: "playground", href: "playground/", title: "aquaBOT", label: "Interactive playground", sub: "An interactive 3D playground for a custom 6-DOF robot arm.", img: "assets/img/projects/playground.png", wash: "#c7eeec", light: "#f7ffff", shade: "#8ad4df", paper: "#f5f1e7", green: "#174f75", ink: "#0f2f45" },
  { slug: "rigby", href: "rigby/", title: "RIGBY", label: "Assistive robotics", sub: "Low-cost mobile bimanual platform for assistive manipulation learned from demonstration.", img: "assets/img/photos/Rigby_Render_Front.png", cut: true, wash: "#c5e5fa", light: "#f6fbff", shade: "#80b8e0", paper: "#e8f1f7", green: "#164d78", ink: "#0d2a42" },
  { slug: "tflbot", href: "#project/tflbot", title: "TFLBot", label: "Human-centred robotics", sub: "Assistive guidance robot for underground transport networks.", img: "assets/img/projects/tflbot/pepperbot.png", cut: true, wash: "#e6e0d4", light: "#f7f3eb", shade: "#d8d2c4", paper: "#eee9df", green: "#254d3c", ink: "#20211e" },
  { slug: "chessbot", href: "#project/chessbot", title: "ChessBot", label: "Robotic manipulation", sub: "Analytical kinematics, workspace calibration, and trajectory control for a 4-DOF manipulator.", img: "assets/img/projects/project7.jpeg", wash: "#eeeeee", light: "#ffffff", shade: "#d8d8d8", paper: "#efefef", green: "#292929", ink: "#222222" },
  { slug: "market-making-algorithm", href: "market-making/", title: "Market Making", label: "Quantitative trading", sub: "Delta-aware trading strategy ranked 3rd in an Imperial Optiver competition.", img: "assets/img/projects/Options.png", solid: true, wash: "#e3e8eb", light: "#fafaf6", shade: "#c1cdd6", paper: "#f0f1eb", green: "#394e60", ink: "#1f2c38" },
  { slug: "smoke-and-mirrors", href: "", title: "Work in progress", label: "Visual study", sub: "A draft study of light, reflection and perception.", img: "assets/img/projects/smoke-and-mirrors/mirror-768.webp", wash: "#5d293a", light: "#8d626a", shade: "#341522", paper: "#391d28", green: "#f3e8df", ink: "#f3e8df" }
];
const script = (src) => new Promise((onload, onerror) => document.head.append(Object.assign(document.createElement("script"), { src, onload, onerror })));
const module = (path) => import(new URL(path, document.baseURI).href);
// Projects with a live view; the others spin their image. All load once the projects view is first opened.
const ADAPTERS = {
  playground: async (canvas) => {
    // About 8 MB, so never fetched before it is needed.
    await Promise.all([window.AeroViewer || script("playground/assets/viewer.bundle.js"), window.AERO_ROBOT_DATA || script("playground/assets/robot-data.js")]);
    const v = window.AeroViewer.create(canvas, window.AERO_ROBOT_DATA);
    return { resize: (w, h) => v.resize(w, h), draw: (yaw, tilt) => v.draw({ yaw: -.7 + yaw * Math.PI / 180, pitch: Math.max(.04, .22 + tilt * Math.PI / 180), zoom: .8, top: false }, false, false) };
  },
  rigby: async (canvas) => (await module("assets/js/rigby-view.js")).createRigbyView(canvas),
  "market-making-algorithm": async (canvas) => (await module("assets/js/vol-surface.js")).createVolSurface(canvas)
};
const imgCache = {};
const loadImg = (src) => imgCache[src] ||= new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const rnd = (a, b) => a + Math.random() * (b - a);

class ProjectStage extends HTMLElement {
  connectedCallback() {
    if (this._init) return; this._init = true;
    this.idx = 0; this.mouse = { x: -9999, y: -9999, down: false };
    this.rot = 0; this.vel = 0; this.x = 0; this.y = 0; this.turn = 0; this.lean = 0; this.slide = null; this.hold = true; this.tiltX = 0; this.tiltY = 0;
    this.parts = []; this.dying = []; this.solids = []; this.v3 = {};
    Object.assign(this.style, { display: "block", overflow: "hidden", userSelect: "none", touchAction: "none" });
    this.bg = this.mk("div", {}); this.bg.className = "stage-bg";
    this.mk("div", { position: "absolute", inset: "0", opacity: ".045", pointerEvents: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Cpath fill='%23000' filter='url(%23n)' opacity='.5' d='M0 0h180v180H0z'/%3E%3C/svg%3E\")" });
    const solid = new Set(PROJECTS.filter((p) => p.solid).map((p) => p.slug));
    const slot = (slug) => { this.v3[slug] = { canvas: this.mk("canvas", { position: "absolute", left: "0", width: "100%", opacity: "0", transition: "opacity 300ms ease", pointerEvents: "none" }), view: null }; };
    for (const slug in ADAPTERS) if (solid.has(slug)) slot(slug);
    this.canvas = this.mk("canvas", { position: "absolute", inset: "0", width: "100%", height: "100%" });
    this.ctx = this.canvas.getContext("2d");
    const persp = this.mk("div", { position: "absolute", inset: "0", perspective: "1400px", pointerEvents: "none" });
    // Two images trade places: `ghost` keeps the outgoing project's image while the next one slides in.
    [this.obj, this.ghost] = [0, 0].map(() => {
      const e = persp.appendChild(document.createElement("img")); e.draggable = false; e.alt = "";
      Object.assign(e.style, { position: "absolute", left: "50%", opacity: "0", transformStyle: "preserve-3d", willChange: "transform" }); return e;
    });
    for (const slug in ADAPTERS) if (!solid.has(slug)) slot(slug);
    this.meta = this.mk("div", {}); this.meta.className = "stage-meta";
    this.on();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this);
    const loop = (t) => { this.raf = requestAnimationFrame(loop); this.frame(t); };
    this.raf = requestAnimationFrame(loop);
  }
  disconnectedCallback() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this._init = false; }
  mk(tag, st) { const e = document.createElement(tag); Object.assign(e.style, st); this.appendChild(e); return e; }
  on() {
    const pos = (e) => { const r = this.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    this.addEventListener("pointermove", (e) => { const p = pos(e); if (this.mouse.down) { this.vel = (p.x - this.mouse.x) * .55; this.rot += this.vel; } this.mouse.x = p.x; this.mouse.y = p.y; });
    this.addEventListener("pointerleave", () => { this.mouse.x = this.mouse.y = -9999; this.mouse.down = false; });
    this.addEventListener("pointerdown", (e) => { const p = pos(e); this.downAt = p; this.mouse = { ...p, down: true }; this.burst(p); });
    this.addEventListener("pointerup", (e) => {
      const p = pos(e), href = PROJECTS[this.idx].href;
      // The caption title is a real link and navigates itself.
      if (href && this.downAt && !e.target.closest("a") && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) < 6) location.href = href;
      this.downAt = null; this.mouse.down = false;
    });
    let wheelLock = 0;
    this.addEventListener("wheel", (e) => { e.preventDefault(); const now = Date.now(); if (now - wheelLock < 900) return; const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; if (Math.abs(d) < 12) return; wheelLock = now; this.step(d > 0 ? 1 : -1); }, { passive: false });
  }
  resize() {
    const r = this.getBoundingClientRect(), entering = !this.w;
    // Hidden: frame() idles, and the project is cleared away so it can slide back in when the view returns.
    if (!r.width) { this.w = 0; this.hold = true; this.slide = null; for (const e of [this.obj, this.ghost, ...Object.values(this.v3).map((s) => s.canvas)]) e.style.opacity = "0"; return; }
    // Read now, while the page transition that revealed the view is still running.
    if (entering) this.rise = document.documentElement.dataset.routeTransition === "backward" ? -1 : 1;
    this.w = r.width; this.h = r.height; const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.w * dpr; this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.started) return this.show(this.idx, true, entering ? 1 : 0);
    this.started = true;
    PROJECTS.forEach((p) => loadImg(p.img));
    for (const slug in ADAPTERS) { const s = this.v3[slug]; s.ready = ADAPTERS[slug](s.canvas).then((v) => { s.view = v; v.resize(this.w || 1280, this.ch || 600); }).catch((e) => console.warn("3D load failed", slug, e)); }
    this.show(this.idx, true, 1);
  }
  select(slug) { const i = PROJECTS.findIndex((p) => p.slug === slug); if (i >= 0 && i !== this.idx) this.started ? this.show(i, false, i > this.idx ? 1 : -1) : this.idx = i; }
  step(d) { this.show((this.idx + d + PROJECTS.length) % PROJECTS.length, false, d); }
  layout() {
    // Title and robot are centred in the space between the page heading and the caption.
    const head = this.closest("section")?.querySelector(".section-heading");
    const top = head ? head.getBoundingClientRect().bottom - this.getBoundingClientRect().top : 0, bottom = this.meta.offsetTop - 12;
    this.band = Math.max(120, bottom - top); this.line = bottom - this.band / 2;
    // Live views fit a bounding sphere, so their canvas is taller than the robot it shows.
    const ch = Math.round(this.band * 1.2), ctop = Math.round(this.line - ch / 2);
    if (ch === this.ch && ctop === this.ctop && this.w === this.cw) return;
    this.ch = ch; this.ctop = ctop; this.cw = this.w;
    for (const k in this.v3) { const s = this.v3[k]; Object.assign(s.canvas.style, { top: ctop + "px", height: ch + "px" }); s.view && s.view.resize(this.w, ch); }
  }
  async show(i, instant, dir) {
    this.idx = i;
    const p = PROJECTS[i], img = await loadImg(p.img); if (!img || !this.w || this.idx !== i) return;
    for (const k of ["wash", "light", "shade", "paper"]) this.bg.style.setProperty(`--stage-${k}`, p[k]);
    const name = p.href ? `<a class="stage-name" href="${p.href}">${p.title}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg></a>` : `<span class="stage-name">${p.title}</span>`;
    // Linked projects swap the category label for a prompt on hover (or periodically on touch screens).
    const cta = p.href ? `<span class="stage-cta" aria-hidden="true">${matchMedia("(hover: hover)").matches ? "Click" : "Tap"} to learn more</span>` : "";
    this.meta.innerHTML = `<div class="stage-head">${name}<span class="stage-kicker${cta ? " has-cta" : ""}"><span class="stage-label">${p.label}</span>${cta}</span></div><p class="stage-sub">${p.sub}</p>`;
    this.layout();
    if (this.shown !== i) { this.shown = i; this.dispatchEvent(new CustomEvent("projectchange", { detail: { index: i, project: p }, bubbles: true })); }
    await document.fonts?.load("100px Sandana");
    if (this.idx !== i) return;
    this.ctx.font = "100px Sandana, Georgia, serif";
    this.buildTitle(p, Math.min(this.band * .7, (100 * this.w * .9) / this.ctx.measureText(p.title).width), instant);
    // A project with a live view waits for it, so its stand-in image never shows and then swaps out.
    await this.v3[p.slug]?.ready;
    if (this.idx !== i || !this.w) return;
    this.buildSlide(img, dir);
  }
  buildTitle(p, fs, instant) {
    const now = performance.now(), font = fs + "px Sandana, Georgia, serif";
    this.parts.forEach((q) => { q.dead = true; q.vx += rnd(-2, 2) + 1.5; q.vy += rnd(-3, -.5); }); this.dying.push(...this.parts); this.parts = [];
    this.solids.forEach((s) => { s.out ||= now; });
    // Centre the inked glyphs, not the em box, on the line.
    this.ctx.font = font; const m = this.ctx.measureText(p.title), base = this.line + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    if (p.solid) { this.solids.push({ text: p.title, font, base, color: p.ink, born: now }); return; }
    const W = Math.ceil(this.w), H = Math.ceil(this.h), c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d"); x.font = font; x.textAlign = "center"; x.fillStyle = "#000";
    x.fillText(p.title, W / 2, base);
    const d = x.getImageData(0, 0, W, H).data, step = 3, cx = W / 2, cy = this.line;
    for (let y = 0; y < H; y += step) for (let xx = 0; xx < W; xx += step) {
      if (d[(y * W + xx) * 4 + 3] < 128) continue;
      const ang = rnd(0, Math.PI * 2), rad = rnd(300, 900);
      this.parts.push({ tx: xx, ty: y, x: cx + Math.cos(ang) * rad * (instant ? .5 : 1), y: cy + Math.sin(ang) * rad * .6 - rnd(0, 150), vx: 0, vy: 0, s: step * rnd(.75, 1), c: p.ink, delay: now + rnd(0, 700) + Math.abs(xx - cx) * .9, a: 0 });
    }
  }
  burst(m) { this.parts.forEach((q) => { const dx = q.x - m.x, dy = q.y - m.y, dd = Math.hypot(dx, dy) || 1; if (dd < 220) { const f = (220 - dd) / 220 * 11; q.vx += dx / dd * f; q.vy += dy / dd * f; } }); }
  buildSlide(img, dir) {
    const p = PROJECTS[this.idx], s = Math.min(this.w * .42 / img.width, this.band * (p.cut ? .95 : .62) / img.height);
    const dw = Math.round(img.width * s), dh = Math.round(img.height * s), top = this.line, radius = p.cut ? "0" : Math.min(dw, dh) * .08 + "px";
    const set = () => {
      if (this.activeSlug !== p.slug) this.v3[p.slug]?.view?.replay?.();
      this.activeSlug = p.slug; this.obj.src = img.src;
      Object.assign(this.obj.style, { width: dw + "px", height: dh + "px", top: top + "px", marginLeft: -dw / 2 + "px", marginTop: -dh / 2 + "px", borderRadius: radius });
    };
    // A resize, or this project already on stage: refit in place and leave any slide running.
    if (!dir || (!this.hold && this.activeSlug === p.slug)) return set();
    // The first project after the view opens rises in with the page, with nothing to push off. Otherwise the
    // outgoing project keeps its pose and slides off from wherever it is, so rapid clicks stay smooth.
    const live = this.v3[this.activeSlug]?.view ? this.v3[this.activeSlug] : null;
    const out = this.hold ? null : { x0: this.x, yaw0: this.rot + this.turn, lean0: this.lean, live };
    if (out && !live) [this.obj, this.ghost] = [this.ghost, this.obj];
    this.slide = { dir, rise: this.hold ? this.rise : 0, start: performance.now(), out }; this.hold = false;
    set(); this.rot = 0; this.vel = 0;
  }
  frame(now) {
    if (!this.w) return;
    const ctx = this.ctx, m = this.mouse; ctx.clearRect(0, 0, this.w, this.h);
    for (const q of this.dying) { q.vx *= .985; q.vy = q.vy * .985 - .04; q.x += q.vx + Math.sin((q.y + now * .1) * .01) * .6; q.y += q.vy; q.a -= .012; if (q.a > 0) { ctx.globalAlpha = q.a; ctx.fillStyle = q.c; ctx.fillRect(q.x, q.y, q.s * .8, q.s * .8); } }
    this.dying = this.dying.filter((q) => q.a > 0);
    for (const q of this.parts) {
      if (now > q.delay) { q.vx += (q.tx - q.x) * .022; q.vy += (q.ty - q.y) * .022; q.a = Math.min(1, q.a + .03); }
      else { q.x += Math.sin(now * .001 + q.ty) * .4; q.y += Math.cos(now * .0012 + q.tx) * .4; q.a = Math.min(.35, q.a + .01); }
      const dx = q.x - m.x, dy = q.y - m.y, dd = dx * dx + dy * dy;
      if (dd < 4900) { const di = Math.sqrt(dd) || 1, fo = (70 - di) / 70 * 1.3; q.vx += dx / di * fo; q.vy += dy / di * fo; }
      q.vx *= .84; q.vy *= .84; q.x += q.vx; q.y += q.vy;
      ctx.globalAlpha = q.a; ctx.fillStyle = q.c; ctx.fillRect(q.x, q.y, q.s, q.s);
    }
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    // Solid titles ease in and out over roughly the time particle titles take to gather and scatter,
    // settling from slightly below and drifting up as they leave.
    this.solids = this.solids.filter((s) => {
      const t = Math.max(0, Math.min(1, s.out ? 1 - (now - s.out) / 1100 : (now - s.born - 250) / 1500)), a = t * t * (3 - 2 * t);
      if (a > 0) { ctx.globalAlpha = a; ctx.font = s.font; ctx.fillStyle = s.color; ctx.fillText(s.text, this.w / 2, s.base + (1 - a) * (s.out ? -14 : 14)); }
      return !s.out || a > 0; // a frame stamped just before `born` must not drop a new title
    });
    ctx.globalAlpha = 1;
    const over = m.x > -999;
    if (this.hold) return; // nothing shows until its slide begins
    // The arriving project swings round to face the front as it lands, so it reads as 3D.
    let out = null; this.x = this.y = this.turn = this.lean = 0;
    if (this.slide) {
      const { dir, rise } = this.slide, el = Math.max(0, now - this.slide.start);
      // A damped swing: a few degrees past square, then at rest with no snap.
      const t = Math.min(1, el / 1800), swing = (1 - t) ** 2 * Math.cos(t * Math.PI * 1.25);
      if (rise) {
        // Opening the view, it follows the page in, rising from below and tipping upright like a page turning
        // up (or dropping in from above when coming back), easing out to match the page transition.
        const k = Math.min(1, el / 1100); this.y = rise * this.h * (1 - k) ** 4; this.turn = 12 * swing; this.lean = rise * 20 * swing;
      } else {
        // Next slides in from the right and previous from the left, pushing the old project off the other side.
        const k = Math.min(1, el / 900), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        this.x = dir * this.w * (1 - e); this.turn = dir * 30 * swing; this.lean = 6 * swing;
        if ((out = this.slide.out)) Object.assign(out, { x: out.x0 + (-dir * this.w - out.x0) * e, yaw: out.yaw0 - dir * 30 * e, lean: out.lean0 + (6 - out.lean0) * e });
        if (k >= 1) this.slide.out = null;
      }
      if (t >= 1) this.slide = null;
    }
    if (!m.down) {
      this.rot += this.vel; this.vel *= .95;
      const n = Math.round(this.rot / 360) * 360; if (Math.abs(this.vel) < 2) this.rot += (n - this.rot) * .05;
    }
    // Eased so the model never snaps when the pointer leaves the stage, e.g. onto an arrow.
    this.tiltX += ((over ? (m.y / this.h - .5) * -14 : Math.sin(now * .0008) * 3) - this.tiltX) * .06;
    this.tiltY += ((over && !m.down ? (m.x / this.w - .5) * 18 : Math.sin(now * .0006) * 6) - this.tiltY) * .06;
    const bob = Math.sin(now * .0012) * 8, slot = this.v3[this.activeSlug], gone = out?.live, yaw = this.rot + this.turn;
    for (const k in this.v3) { const s = this.v3[k]; s.canvas.style.opacity = s.view && (s === slot || s === gone) ? "1" : "0"; }
    if (gone) { gone.view.draw(out.yaw + this.tiltY * 1.5, (this.tiltX + out.lean) * .6); gone.canvas.style.transform = `translate(${out.x}px, ${bob}px)`; }
    if (out && !gone) this.pose(this.ghost, out.x, bob, out.yaw, out.lean);
    this.ghost.style.opacity = out && !gone ? "1" : "0";
    if (slot && slot.view) {
      // No hover readout mid-slide: it is drawn on the stage canvas, which doesn't move with the view.
      slot.view.draw(yaw + this.tiltY * 1.5, (this.tiltX + this.lean) * .6, over && !m.down && !this.x && !this.y ? { x: m.x, y: m.y - this.ctop - bob } : null, { ctx, dy: this.ctop + bob });
      this.obj.style.opacity = "0"; slot.canvas.style.transform = `translate(${this.x}px, ${bob + this.y}px)`; return;
    }
    this.obj.style.opacity = "1";
    this.pose(this.obj, this.x, bob + this.y, yaw, this.lean);
  }
  pose(img, x, y, yaw, lean) {
    let r = yaw % 360; if (r < 0) r += 360;
    const back = r > 90 && r < 270;
    img.style.transform = `translate(${x}px, ${y}px) rotateX(${this.tiltX + lean}deg) rotateY(${yaw + this.tiltY}deg) ${back ? "scaleX(-1)" : ""}`;
    img.style.filter = `drop-shadow(0 30px 40px rgba(0,0,0,.28)) brightness(${back ? .82 : 1})`;
  }
}
if (!customElements.get("project-stage")) customElements.define("project-stage", ProjectStage);
})();
