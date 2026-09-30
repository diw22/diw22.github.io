/* Browser illustration of diw22/marketmakingalgo/algo.py.
   Synthetic books and fills; fixed tenor; no fees, queue model or live connection.
   The passive option quote prices and confidence/position/delta sizing follow
   place_bid_ask_spread. Clamps and crossed-quote suppression are demo safeguards. */
(() => {
  "use strict";
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const round = (value) => Math.round(value * 100) / 100;
  const floorTick = (value) => Math.floor((value + 1e-9) * 100) / 100;
  const ceilTick = (value) => Math.ceil((value - 1e-9) * 100) / 100;
  const LIMIT = 100;
  const TENOR = 7 / 365;
  const RATE = .03;
  const SIGMA = 3;

  function normalCDF(value) {
    const x = Math.abs(value), t = 1 / (1 + .2316419 * x);
    const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * t *
      (.31938153 + t * (-.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return value >= 0 ? 1 - tail : tail;
  }

  function optionValue(spot, kind) {
    const d1 = (Math.log(spot / 100) + (RATE + SIGMA * SIGMA / 2) * TENOR) / (SIGMA * Math.sqrt(TENOR));
    const d2 = d1 - SIGMA * Math.sqrt(TENOR);
    const discount = 100 * Math.exp(-RATE * TENOR);
    return kind === "call"
      ? { fair: spot * normalCDF(d1) - discount * normalCDF(d2), delta: normalCDF(d1) }
      : { fair: discount * normalCDF(-d2) - spot * normalCDF(-d1), delta: normalCDF(d1) - 1 };
  }

  function weighted(levels) {
    const volume = levels.reduce((sum, level) => sum + level.size, 0);
    return levels.reduce((sum, level) => sum + level.price * level.size, 0) / volume;
  }

  class MarketSimulation {
    constructor(seed = 2842024) { this.reset(seed); }

    reset(seed = this.seed) {
      this.seed = seed >>> 0;
      this.randomState = this.seed;
      this.time = 0;
      this.spot = 100;
      this.regime = "calm";
      this.cash = 0;
      this.realized = 0;
      this.pnl = 0;
      this.delta = 0;
      this.tradeCount = 0;
      this.volume = 0;
      this.tape = [];
      this.history = [];
      this.lastFills = [];
      this.instruments = ["call", "put"].map(kind => ({ kind, position: 0, averageCost: 0, fair: 0, delta: 0, book: {}, quote: null }));
      this.reprice();
      this.mark();
      this.requote();
      this.record();
    }

    random() {
      // Reproducible sessions make reset and numerical checks meaningful.
      let value = this.randomState = (this.randomState + 0x6D2B79F5) >>> 0;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    }

    noise() { return this.random() + this.random() + this.random() - 1.5; }

    setRegime(regime) {
      if (["calm", "volatile"].includes(regime)) this.regime = regime;
    }

    makeBook(mid, halfSpread, tick) {
      const side = (direction) => Array.from({ length: 5 }, (_, index) => ({
        price: Math.max(.01, round(mid + direction * (halfSpread + index * tick))),
        size: 12 + Math.floor(this.random() * 70)
      }));
      return { bids: side(-1), asks: side(1) };
    }

    reprice() {
      this.underlyingBook = this.makeBook(this.spot, .025, .02);
      this.underlyingFair = weighted([...this.underlyingBook.bids, ...this.underlyingBook.asks]);
      for (const instrument of this.instruments) {
        Object.assign(instrument, optionValue(this.underlyingFair, instrument.kind));
        const spread = this.regime === "volatile" ? .15 : .085;
        const marketMid = instrument.fair + this.noise() * (this.regime === "volatile" ? .10 : .035);
        instrument.book = this.makeBook(marketMid, spread, .04);
      }
    }

    requote() {
      for (const instrument of this.instruments) {
        const bestAsk = weighted(instrument.book.asks);
        const bestBid = weighted(instrument.book.bids);
        let desire = clamp((this.delta + 100) / 200, 0, 1);
        if (instrument.kind === "call") desire = 1 - desire;
        const askConfidence = clamp((bestAsk - instrument.fair) / instrument.fair * 500 * (1 - desire), 0, 1);
        const bidConfidence = clamp((instrument.fair - bestBid) / instrument.fair * 500 * desire, 0, 1);
        const ask = floorTick((bestAsk + instrument.fair) / 2);
        const bid = ceilTick((bestBid + instrument.fair) / 2);
        instrument.quote = {
          ask, bid,
          askSize: bid < ask ? Math.floor(askConfidence * (LIMIT + instrument.position)) : 0,
          bidSize: bid < ask ? Math.floor(bidConfidence * (LIMIT - instrument.position)) : 0
        };
      }
    }

    fill(instrument, side, requested, price) {
      const direction = side === "buy" ? 1 : -1;
      const available = side === "buy" ? instrument.quote.bidSize : instrument.quote.askSize;
      const size = Math.min(requested, available, LIMIT - direction * instrument.position);
      if (size <= 0) return;
      const previous = instrument.position, next = previous + direction * size;
      if (previous * direction < 0) {
        const closed = Math.min(Math.abs(previous), size);
        this.realized += closed * (price - instrument.averageCost) * Math.sign(previous);
        if (next === 0) instrument.averageCost = 0;
        else if (Math.sign(next) !== Math.sign(previous)) instrument.averageCost = price;
      } else {
        instrument.averageCost = (Math.abs(previous) * instrument.averageCost + size * price) / Math.abs(next);
      }
      instrument.position = next;
      this.cash -= direction * size * price;
      instrument.quote[side === "buy" ? "bidSize" : "askSize"] -= size;
      this.tradeCount++;
      this.volume += size;
      const trade = { id: this.tradeCount, time: this.time, kind: instrument.kind, side, size, price };
      this.lastFills.push(trade);
      this.tape.unshift(trade);
      this.tape.length = Math.min(this.tape.length, 30);
    }

    execute(instrument) {
      const quote = instrument.quote;
      if (!quote) return;
      // Independent incoming flow can hit either side. More competitive (or stale)
      // quotes fill more readily; larger quotes absorb more of an incoming order.
      for (const side of ["buy", "sell"]) {
        const buying = side === "buy", price = buying ? quote.bid : quote.ask;
        const edge = buying ? instrument.fair - price : price - instrument.fair;
        const probability = clamp(.18 * Math.exp(-edge / .18), .025, .68);
        if (this.random() < probability) this.fill(instrument, side, 1 + Math.floor(this.random() * 12), price);
      }
    }

    mark() {
      this.delta = this.instruments.reduce((sum, instrument) => sum + instrument.position * instrument.delta, 0);
      this.pnl = this.cash + this.instruments.reduce((sum, instrument) => sum + instrument.position * instrument.fair, 0);
      this.unrealized = this.instruments.reduce((sum, instrument) => sum + instrument.position * (instrument.fair - instrument.averageCost), 0);
    }

    record() {
      this.history.push({ time: this.time, pnl: this.pnl, delta: this.delta,
        ...Object.fromEntries(this.instruments.map(instrument => [instrument.kind, {
          fair: instrument.fair, bid: instrument.quote.bid, ask: instrument.quote.ask,
          fills: this.lastFills.filter(fill => fill.kind === instrument.kind)
        }]))
      });
      // Bound the work per frame and memory during long-running sessions.
      if (this.history.length > 181) this.history.shift();
    }

    step() {
      this.time = round(this.time + .5);
      this.lastFills = [];
      const volatility = this.regime === "volatile" ? .43 : .10;
      const drift = (100 - this.spot) * .002;
      this.spot = clamp(this.spot + this.noise() * volatility + drift, 60, 150);
      this.reprice();
      // Fills meet the last resting quotes, before the algorithm can reprice them.
      for (const instrument of this.instruments) this.execute(instrument);
      this.mark();
      this.requote();
      this.record();
      return this.lastFills;
    }
  }

  globalThis.MarketSimulation = MarketSimulation;
})();
