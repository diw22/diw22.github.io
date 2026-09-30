(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const simulation = new MarketSimulation();
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const money = (value) => `${value < -.005 ? "−" : "+"}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const number = (value, digits = 2) => value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const signed = (value, digits = 2) => `${value < 0 ? "−" : "+"}${number(Math.abs(value), digits)}`;
  const clock = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  const colors = { line: "#e4e6e0", muted: "#777c80", fair: "#555f68", pnl: "#446c94", bid: "#527a8f", ask: "#ab705e" };
  let selected = "call", speed = 1, paused = motion.matches, timer = 0, flashTimer = 0;
  const about = $("#about-dialog");
  const rows = {};
  const canvases = [$("#price-chart"), $("#pnl-chart")];

  for (const side of ["asks", "bids"]) {
    rows[side] = Array.from({ length: 6 }, () => {
      const row = document.createElement("div");
      row.className = "book-row";
      row.innerHTML = "<span></span><span></span><span></span>";
      $(`#${side}`).append(row);
      return row;
    });
  }

  function updateBook(instrument) {
    for (const side of ["asks", "bids"]) {
      const ask = side === "asks", quote = instrument.quote;
      const ours = { price: ask ? quote.ask : quote.bid, size: ask ? quote.askSize : quote.bidSize };
      const levels = instrument.book[side].map(level => ({ ...level, ours: 0 }));
      if (ours.size > 0) {
        const samePrice = levels.find(level => level.price === ours.price);
        if (samePrice) { samePrice.size += ours.size; samePrice.ours = ours.size; }
        else levels.push({ ...ours, ours: ours.size });
      }
      levels.sort((a, b) => b.price - a.price);
      // The two columns show their best available prices first.
      const maxSize = Math.max(...levels.map(level => level.size));
      const visibleLevels = ask ? levels.slice(-4).reverse() : levels.slice(0, 4);
      rows[side].forEach((row, index) => {
        const level = visibleLevels[index];
        row.hidden = !level;
        if (!level) return;
        row.classList.toggle("is-ours", Boolean(level.ours));
        row.style.setProperty("--depth", `${level.size / maxSize * 100}%`);
        row.children[0].textContent = number(level.price);
        row.children[1].textContent = level.size;
        row.children[2].textContent = level.ours || "—";
      });
    }
    const asks = [...instrument.book.asks.map(level => level.price), ...(instrument.quote.askSize ? [instrument.quote.ask] : [])];
    const bids = [...instrument.book.bids.map(level => level.price), ...(instrument.quote.bidSize ? [instrument.quote.bid] : [])];
    $("#book-spread").textContent = number(Math.min(...asks) - Math.max(...bids));
    $("#book-symbol").textContent = `NVDA ${selected === "call" ? "Call" : "Put"}`;
  }

  function updateTape() {
    const tape = $("#execution-tape");
    if (!simulation.tape.length) {
      tape.innerHTML = '<li class="tape-empty">Waiting for a fill…</li>';
      return;
    }
    tape.innerHTML = simulation.tape.slice(0, 12).map(trade => `<li class="tape-row" aria-label="${clock(trade.time)}: ${trade.side} ${trade.size} ${trade.kind} contracts at $${number(trade.price)}"><span>${clock(trade.time)}</span><span class="${trade.side}">${trade.side === "buy" ? "Buy" : "Sell"}</span><span>${trade.kind === "call" ? "Call" : "Put"}</span><span>${trade.size} @ ${number(trade.price)}</span></li>`).join("");
  }

  function showFill(trades) {
    const trade = trades.findLast(trade => trade.kind === selected);
    if (!trade || motion.matches) return;
    const flash = $("#fill-flash");
    flash.textContent = `${trade.side === "buy" ? "Bought" : "Sold"} ${trade.size} @ $${number(trade.price)}`;
    flash.className = `fill-flash ${trade.side === "sell" ? "sell" : ""}`;
    void flash.offsetWidth;
    flash.classList.add("show");
    const side = trade.side === "buy" ? "bids" : "asks";
    document.querySelectorAll(".book-row.filled").forEach(row => row.classList.remove("filled"));
    rows[side].find(row => row.classList.contains("is-ours"))?.classList.add("filled");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => document.querySelectorAll(".book-row.filled").forEach(row => row.classList.remove("filled")), 900);
  }

  function render() {
    const instrument = simulation.instruments.find(item => item.kind === selected);
    $("#total-pnl").textContent = money(simulation.pnl);
    $("#total-pnl").style.color = simulation.pnl < -.005 ? colors.ask : colors.pnl;
    $("#realized-pnl").textContent = money(simulation.realized);
    $("#unrealized-pnl").textContent = money(simulation.unrealized);
    $("#portfolio-delta").textContent = signed(simulation.delta);
    $("#delta-note").textContent = Math.abs(simulation.delta) < 5 ? "Neutral" : simulation.delta > 0 ? "Long" : "Short";
    $("#fill-count").textContent = simulation.tradeCount.toLocaleString("en-US");
    $("#volume-count").textContent = simulation.volume.toLocaleString("en-US");
    $("#session-time").textContent = clock(simulation.time);
    $("#fair-value").textContent = `$${number(instrument.fair)}`;
    for (const item of simulation.instruments) {
      $(`#${item.kind}-position`).textContent = signed(item.position, 0);
      const bar = $(`#${item.kind}-bar`);
      bar.style.width = `${Math.abs(item.position) / 2}%`;
      bar.style.left = `${item.position < 0 ? 50 + item.position / 2 : 50}%`;
      bar.style.background = item.position < 0 ? colors.ask : colors.bid;
    }
    updateBook(instrument);
    updateTape();
    drawCharts();
  }

  function prepare(canvas) {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return null;
    const scale = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
    }
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, width, height);
    context.font = '11px "Nunito Sans", Arial, sans-serif';
    return { context, width, height };
  }

  function drawChart(canvas, pnl = false) {
    const surface = prepare(canvas);
    if (!surface) return;
    const { context: ctx, width, height } = surface;
    const left = 2, right = width - 52, top = 12, bottom = height - 24;
    const history = simulation.history;
    const end = Math.max(10, simulation.time), start = Math.max(0, end - 90);
    const values = pnl ? history.map(point => point.pnl) : history.flatMap(point => [point[selected].bid, point[selected].ask, ...point[selected].fills.map(fill => fill.price)]);
    let min = Math.min(...values, ...(pnl ? [0] : [])), max = Math.max(...values, ...(pnl ? [0] : []));
    const range = Math.max(pnl ? 2 : .5, max - min);
    const center = (min + max) / 2;
    min = center - range * .7; max = center + range * .7;
    const x = (time) => left + (time - start) / (end - start) * (right - left);
    const y = (value) => bottom - (value - min) / (max - min) * (bottom - top);
    const gridCount = 2;
    ctx.lineWidth = 1;
    for (let index = 0; index <= gridCount; index++) {
      const value = min + (max - min) * index / gridCount, py = y(value);
      ctx.strokeStyle = colors.line;
      ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(right, py); ctx.stroke();
      ctx.fillStyle = colors.muted; ctx.textAlign = "left";
      ctx.fillText(number(value), right + 9, py + 3);
    }
    const timeTicks = right - left < 180 ? 1 : 3;
    for (let index = 0; index <= timeTicks; index++) {
      const time = start + index * (end - start) / timeTicks, px = x(time);
      ctx.fillStyle = colors.muted; ctx.textAlign = index === 0 ? "left" : index === timeTicks ? "right" : "center";
      ctx.fillText(clock(time), px, height - 6);
    }
    if (pnl) {
      const shade = ctx.createLinearGradient(0, top, 0, bottom);
      shade.addColorStop(0, "#446c9414"); shade.addColorStop(1, "#446c9400");
      ctx.beginPath(); ctx.moveTo(x(history[0].time), y(0));
      history.forEach(point => ctx.lineTo(x(point.time), y(point.pnl)));
      ctx.lineTo(x(history.at(-1).time), y(0)); ctx.closePath(); ctx.fillStyle = shade; ctx.fill();
      ctx.setLineDash([2, 5]); ctx.strokeStyle = "#c1c7c8";
      ctx.beginPath(); ctx.moveTo(left, y(0)); ctx.lineTo(right, y(0)); ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.beginPath();
      history.forEach((point, index) => index ? ctx.lineTo(x(point.time), y(point[selected].ask)) : ctx.moveTo(x(point.time), y(point[selected].ask)));
      [...history].reverse().forEach(point => ctx.lineTo(x(point.time), y(point[selected].bid)));
      ctx.closePath(); ctx.fillStyle = "#527a8f05"; ctx.fill();
    }
    const paths = pnl ? [{ key: "pnl", color: simulation.pnl < 0 ? colors.ask : colors.pnl }] : [
      { key: "ask", color: colors.ask }, { key: "bid", color: colors.bid }, { key: "fair", color: colors.fair }
    ];
    for (const path of paths) {
      ctx.strokeStyle = path.color; ctx.lineWidth = pnl ? 2 : 1;
      if (path.key === "fair") ctx.setLineDash([4, 4]);
      ctx.beginPath();
      history.forEach((point, index) => {
        const value = pnl ? point.pnl : point[selected][path.key];
        if (!index) ctx.moveTo(x(point.time), y(value)); else ctx.lineTo(x(point.time), y(value));
      });
      ctx.stroke(); ctx.setLineDash([]);
      const last = history.at(-1), value = pnl ? last.pnl : last[selected][path.key];
      ctx.beginPath(); ctx.arc(x(last.time), y(value), pnl ? 3 : 2.5, 0, Math.PI * 2); ctx.fillStyle = path.color; ctx.fill();
    }
    if (!pnl) {
      for (const point of history) for (const fill of point[selected].fills) {
        const px = x(point.time), py = y(fill.price);
        ctx.fillStyle = fill.side === "buy" ? colors.bid : colors.ask;
        ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill();
      }
      if (history.length < 8) {
        ctx.fillStyle = colors.muted; ctx.textAlign = "center";
        ctx.fillText("Waiting for prices…", (left + right) / 2, (top + bottom) / 2);
      }
    }
    canvas.setAttribute("aria-label", pnl
      ? `Simulated P&L: ${money(simulation.pnl)}. Chart covers the last 90 simulated seconds.`
      : `NVDA ${selected}. Fair value $${number(history.at(-1)[selected].fair)}. Bid $${number(history.at(-1)[selected].bid)}, ask $${number(history.at(-1)[selected].ask)}. Dots mark executions.`);
  }

  function drawCharts() { drawChart(canvases[0]); drawChart(canvases[1], true); }

  function syncPlayback() {
    clearTimeout(timer);
    const stopped = paused || about.open;
    document.body.classList.toggle("is-paused", stopped);
    $("#pause-label").textContent = paused ? "Play" : "Pause";
    $("#pause-icon").textContent = paused ? "▶" : "Ⅱ";
    $("#pause").setAttribute("aria-label", paused ? "Play simulation" : "Pause simulation");
    $("#session-status").textContent = stopped ? "Simulation paused" : "Simulated";
    if (!stopped && !document.hidden) timer = setTimeout(tick, 500 / speed);
  }

  function tick() {
    if (paused || document.hidden || about.open) return;
    const fills = simulation.step();
    render(); showFill(fills);
    if (simulation.time % 10 === 0) $("#announcer").textContent = `${simulation.tradeCount} fills. Simulated P&L ${money(simulation.pnl)}. Portfolio delta ${signed(simulation.delta)}.`;
    syncPlayback();
  }

  $("#pause").addEventListener("click", () => { paused = !paused; syncPlayback(); });
  $("#reset").addEventListener("click", () => {
    simulation.reset();
    document.querySelectorAll("[data-regime]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.regime === "calm")));
    $("#fill-flash").classList.remove("show");
    document.querySelectorAll(".book-row.filled").forEach(row => row.classList.remove("filled"));
    render(); syncPlayback(); $("#announcer").textContent = "Simulation reset. Cash, positions and P&L start at zero. Market is calm.";
  });
  $("#speed").addEventListener("click", () => {
    speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
    $("#speed").textContent = `${speed}×`;
    $("#speed").setAttribute("aria-label", `Simulation speed: ${speed} times`);
    syncPlayback();
  });
  document.querySelectorAll("[data-instrument]").forEach(button => button.addEventListener("click", () => {
    selected = button.dataset.instrument;
    document.querySelectorAll("[data-instrument]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    $("#fill-flash").classList.remove("show");
    render();
  }));
  document.querySelectorAll("[data-regime]").forEach(button => button.addEventListener("click", () => {
    simulation.setRegime(button.dataset.regime);
    document.querySelectorAll("[data-regime]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    $("#announcer").textContent = `${button.textContent} market selected. ${paused ? "Press Play to continue." : "The quoting engine will respond to the new conditions."}`;
  }));
  $("#about-open").addEventListener("click", () => { about.showModal(); syncPlayback(); });
  $("#about-close").addEventListener("click", () => about.close());
  about.addEventListener("close", syncPlayback);
  about.addEventListener("click", event => {
    if (event.target !== about) return;
    const rect = about.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) about.close();
  });
  document.addEventListener("visibilitychange", syncPlayback);
  window.addEventListener("pagehide", () => clearTimeout(timer));
  window.addEventListener("pageshow", syncPlayback);
  motion.addEventListener("change", () => { if (motion.matches) { paused = true; syncPlayback(); } });
  new ResizeObserver(() => {
    updateBook(simulation.instruments.find(item => item.kind === selected));
    drawCharts();
  }).observe($(".workspace"));
  document.fonts.ready.then(drawCharts);
  render(); syncPlayback();
})();
