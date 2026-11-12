(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const simulation = new MarketSimulation();
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const WINDOW = 160;          // price chart samples (0.5 s each), as kept by the simulation
  const TICKS_PER_STEP = 14;   // the walkthrough moves on every 7 simulated seconds
  const TRAIL = 320;           // most points in the session-long P&L line
  const MINUS = "−";
  const money = (value) => `${value < -.005 ? MINUS : "+"}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const signed = (value, digits) => {
    const size = Math.abs(value).toFixed(digits);
    return Number(size) ? `${value < 0 ? MINUS : "+"}${size}` : size;
  };
  const clock = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  const path = (values, x, y) => values.map((value, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(value).toFixed(1)}`).join("");

  const app = $(".app"), about = $("#about-dialog");
  const state = { option: "call", step: 0, locked: false, ticks: 0, speed: 1, paused: motion.matches, theme: document.documentElement.dataset.theme === "light" ? "light" : "dark" };
  // The P&L line covers the whole session: every `stride` ticks, halving its resolution whenever it fills up.
  let trail = [simulation.pnl], stride = 1, timer = 0, rippleId = 0, pnlLength = 0;

  const depthColumns = Array.from({ length: 8 }, (_, i) => {
    const column = document.createElement("div");
    column.className = "depth-column";
    column.innerHTML = `<span class="depth-area"><span class="depth-bar ${i < 4 ? "bid" : "ask"}"></span></span><span class="depth-price"></span>`;
    $(".panel-depth").append(column);
    return { column, bar: column.firstChild.firstChild, price: column.lastChild };
  });
  const tradeBars = Array.from({ length: 32 }, () => $(".panel-trades").appendChild(document.createElement("span")));

  // Our quote joins the book at its price; each side's four best levels, far to near for bids, near to far for asks.
  function depth(instrument) {
    const sides = ["bids", "asks"].map((side) => {
      const ask = side === "asks", quote = instrument.quote;
      const ours = { price: ask ? quote.ask : quote.bid, size: ask ? quote.askSize : quote.bidSize, ours: true };
      const levels = instrument.book[side].map((level) => ({ ...level, ours: false }));
      if (ours.size > 0) {
        const same = levels.find((level) => Math.abs(level.price - ours.price) < 1e-6);
        if (same) Object.assign(same, { size: same.size + ours.size, ours: true }); else levels.push(ours);
      }
      return levels.sort((a, b) => ask ? a.price - b.price : b.price - a.price).slice(0, 4);
    });
    return [...sides[0].reverse(), ...sides[1]];
  }

  // The P&L figure shrinks to fit its column as it grows.
  function fitPnl() {
    const box = $(".pnl-value"), text = $("#pnl");
    text.style.fontSize = "";
    const width = text.getBoundingClientRect().width, room = box.clientWidth;
    if (width > room) text.style.fontSize = `${Math.floor(parseFloat(getComputedStyle(text).fontSize) * room / width)}px`;
  }

  function renderPnl() {
    const pnl = simulation.pnl, text = money(pnl);
    $("#pnl").textContent = text;
    $(".pnl-value").classList.toggle("is-down", pnl < -.005);
    if (text.length !== pnlLength) { pnlLength = text.length; fitPnl(); }
    const values = [...trail], at = values.map((_, i) => i * stride);
    if (at.at(-1) !== state.ticks) { values.push(pnl); at.push(state.ticks); }
    const last = values.length - 1;
    let lo = Math.min(0, ...values), hi = Math.max(.5, ...values);
    const pad = (hi - lo) * .15; lo -= pad; hi += pad;
    const x = (i) => at[i] / Math.max(1, state.ticks) * 1000, y = (value) => 300 - (value - lo) / (hi - lo) * 300;
    const line = path(values, x, y);
    $("#spark-line").setAttribute("d", line);
    $("#spark-area").setAttribute("d", `${line}L${x(last).toFixed(1)} ${y(0).toFixed(1)}L0 ${y(0).toFixed(1)}Z`);
    $("#spark-zero").setAttribute("d", `M0 ${y(0).toFixed(1)}H1000`);
    Object.assign($("#spark-dot").style, { left: `${x(last) / 10}%`, top: `${y(pnl) / 3}%` });
  }

  function renderChart(instrument) {
    const points = simulation.history, last = points.length - 1, kind = state.option;
    const fair = points.map((point) => point[kind].fair), bids = points.map((point) => point[kind].bid), asks = points.map((point) => point[kind].ask);
    let lo = Math.min(...bids, ...fair), hi = Math.max(...asks, ...fair);
    const pad = Math.max(.05, (hi - lo) * .2); lo -= pad; hi += pad;
    const x = (i) => i / (WINDOW - 1) * 1000, y = (value) => (1 - (value - lo) / (hi - lo)) * 300;
    const bidLine = path(bids, x, y);
    $("#bid-line").setAttribute("d", bidLine);
    $("#ask-line").setAttribute("d", path(asks, x, y));
    $("#fair-line").setAttribute("d", path(fair, x, y));
    $("#band").setAttribute("d", `${bidLine}${asks.map((_, i) => last - i).map((i) => `L${x(i).toFixed(1)} ${y(asks[i]).toFixed(1)}`).join("")}Z`);
    $("#now-line").style.left = `${x(last) / 10}%`;
    const left = (i) => `${x(i) / 10}%`, top = (fill) => `${y(fill.price) / 3}%`;
    $("#dots").innerHTML = points.flatMap((point, i) => point[kind].fills.map((fill) => `<span class="dot ${fill.side}" style="left:${left(i)};top:${top(fill)}"></span>`)).join("");
    // The newest trade on screen rings out once, then its ring follows it along the chart.
    const ripple = $("#ripple");
    let newest = null;
    for (let i = last; i >= 0 && !newest; i--) if (points[i][kind].fills.length) newest = { fill: points[i][kind].fills.at(-1), i };
    ripple.hidden = !newest;
    if (newest) {
      if (newest.fill.id !== rippleId) {
        rippleId = newest.fill.id;
        ripple.className = `ripple ${newest.fill.side}`;
        ripple.style.animation = "none"; void ripple.offsetWidth; ripple.style.animation = "";
      }
      Object.assign(ripple.style, { left: left(newest.i), top: top(newest.fill) });
    }
    const pill = (id, value, text) => { const el = $(id); el.textContent = text; el.style.top = `${y(value) / 3}%`; };
    pill("#pill-fair", fair[last], `$${fair[last].toFixed(2)}`);
    pill("#pill-ask", asks[last], asks[last].toFixed(2));
    pill("#pill-bid", bids[last], bids[last].toFixed(2));
    $$(".time-axis span").forEach((label, i) => { label.textContent = clock(points[0].time + i / 3 * (WINDOW - 1) * .5); });
    $("#chart").setAttribute("aria-label", `${clock(simulation.time)} into the session. NVDA ${kind}: fair value $${instrument.fair.toFixed(2)}, our bid $${bids[last].toFixed(2)}, our ask $${asks[last].toFixed(2)}. Dots mark our trades.`);
  }

  function renderPanel(instrument) {
    const kind = state.option;
    $$("[data-panel]").forEach((panel) => { panel.hidden = Number(panel.dataset.panel) !== state.step; });
    const change = instrument.fair - simulation.history[0][kind].fair;
    $("#panel-fair").textContent = `$${instrument.fair.toFixed(2)}`;
    $("#panel-fair-change").textContent = `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(2)}`;
    $("#panel-fair-change").classList.toggle("is-down", change < 0);
    const levels = depth(instrument), most = Math.max(...levels.map((level) => level.size));
    depthColumns.forEach(({ column, bar, price }, i) => {
      const level = levels[i];
      column.hidden = !level;
      if (!level) return;
      bar.style.height = `${level.size / most * 100}%`;
      bar.classList.toggle("ours", level.ours);
      price.textContent = level.price.toFixed(2);
    });
    const trades = simulation.tape.slice(0, tradeBars.length).reverse();
    tradeBars.forEach((bar, i) => {
      const trade = trades[i];
      bar.hidden = !trade;
      if (!trade) return;
      bar.className = `trade-bar ${trade.side}${trade.kind === kind ? "" : " other"}`;
      bar.style.height = `${trade.size / 12 * 100}%`;
    });
    $(".trades-empty").hidden = trades.length > 0;
    let exposure = 0;
    for (const item of simulation.instruments) {
      const bar = $(`#bar-${item.kind}`);
      bar.style.left = `${item.position < 0 ? 50 + item.position / 2 : 50}%`;
      bar.style.width = `${Math.abs(item.position) / 2}%`;
      bar.classList.toggle("short", item.position < 0);
      $(`#position-${item.kind}`).textContent = signed(item.position, 0);
      exposure += Math.abs(item.position);
    }
    const risk = Math.round(exposure / 200 * 100);
    $("#ring").setAttribute("stroke-dasharray", `${(risk / 100 * 251.3).toFixed(1)} 251.3`);
    $("#risk").textContent = `${risk}%`;
  }

  function renderSteps(instrument) {
    app.dataset.step = state.step;
    const values = [`$${instrument.fair.toFixed(2)}`, `$${(instrument.quote.ask - instrument.quote.bid).toFixed(2)}`,
      simulation.tradeCount.toLocaleString("en-US"), signed(simulation.delta, 1)];
    $$(".step").forEach((button, i) => {
      if (i === state.step) button.setAttribute("aria-current", "step"); else button.removeAttribute("aria-current");
      button.querySelector(".step-value").textContent = values[i];
    });
    // One bar per step: earlier steps full, the current one filling until the walkthrough moves on.
    const progress = state.locked ? 1 : state.ticks % TICKS_PER_STEP / TICKS_PER_STEP;
    $$(".step-track > span").forEach((segment, i) => {
      segment.classList.toggle("is-done", i < state.step);
      segment.firstChild.style.width = `${i < state.step ? 100 : i === state.step ? progress * 100 : 0}%`;
    });
  }

  function render() {
    const instrument = simulation.instruments.find((item) => item.kind === state.option);
    renderPnl(); renderChart(instrument); renderPanel(instrument); renderSteps(instrument);
  }

  const running = () => !state.paused && !about.open && !document.hidden;

  function schedule() {
    clearTimeout(timer);
    $("#play").textContent = state.paused ? "Play" : "Pause";
    $("#play").setAttribute("aria-label", state.paused ? "Play simulation" : "Pause simulation");
    if (running()) timer = setTimeout(tick, 500 / state.speed);
  }

  function tick() {
    if (!running()) return;
    simulation.step();
    state.ticks++;
    if (state.ticks % stride === 0) {
      trail.push(simulation.pnl);
      if (trail.length > TRAIL) { trail = trail.filter((_, i) => i % 2 === 0); stride *= 2; }
    }
    if (!state.locked && state.ticks % TICKS_PER_STEP === 0) state.step = (state.step + 1) % 4;
    render();
    if (simulation.time % 10 === 0) $("#announcer").textContent = `${simulation.tradeCount} trades. Simulated P&L ${money(simulation.pnl)}. Portfolio delta ${signed(simulation.delta, 1)}.`;
    schedule();
  }

  function applyTheme() {
    const dark = state.theme === "dark";
    document.documentElement.dataset.theme = state.theme;
    $("#theme").textContent = dark ? "Light" : "Dark";
    $("#theme").setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} theme`);
    $('meta[name="theme-color"]').content = dark ? "#101820" : "#eff3f6";
  }

  $$(".step").forEach((button, i) => button.addEventListener("click", () => {
    state.step = i; state.locked = true;
    render();
  }));
  $$("[data-option]").forEach((button) => button.addEventListener("click", () => {
    state.option = button.dataset.option;
    $$("[data-option]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    rippleId = 0;
    render();
  }));
  $("#play").addEventListener("click", () => { state.paused = !state.paused; schedule(); });
  $$("[data-speed]").forEach((button) => button.addEventListener("click", () => {
    state.speed = Number(button.dataset.speed);
    $$("[data-speed]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    document.documentElement.style.setProperty("--tick", `${500 / state.speed}ms`);
    schedule();
  }));
  $("#theme").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("mm-theme", state.theme); } catch { /* The choice just won't be remembered. */ }
    applyTheme();
  });
  $("#about-open").addEventListener("click", () => { about.showModal(); schedule(); });
  $("#about-close").addEventListener("click", () => about.close());
  about.addEventListener("close", schedule);
  about.addEventListener("click", (event) => {
    if (event.target !== about) return;
    const rect = about.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) about.close();
  });
  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("pagehide", () => clearTimeout(timer));
  window.addEventListener("pageshow", schedule);
  motion.addEventListener("change", () => { if (motion.matches) { state.paused = true; schedule(); } });
  new ResizeObserver(fitPnl).observe($(".pnl-value"));
  document.fonts.ready.then(fitPnl);
  applyTheme(); render(); schedule();
})();
