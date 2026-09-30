// Run with: node --test market-making/simulation.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./simulation.js');

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('option prices obey put-call parity and delta parity', () => {
  const simulation = new MarketSimulation();
  const [call, put] = simulation.instruments;
  close(call.fair - put.fair, simulation.underlyingFair - 100 * Math.exp(-.03 * 7 / 365));
  close(call.delta - put.delta, 1);
});

test('partial closes, position flips and mark-to-model P&L reconcile with cash', () => {
  const simulation = new MarketSimulation();
  const call = simulation.instruments[0];
  const fill = (side, quantity, price) => {
    call.quote = { bidSize: 200, askSize: 200 };
    simulation.fill(call, side, quantity, price);
  };
  fill('buy', 10, 20);
  fill('buy', 10, 22);
  close(call.averageCost, 21);
  fill('sell', 5, 23);
  close(simulation.realized, 10);
  close(call.position, 15);
  fill('sell', 20, 19);
  close(call.position, -5);
  close(call.averageCost, 19);
  close(simulation.realized, -20);
  call.fair = 18;
  simulation.mark();
  close(simulation.unrealized, 5);
  close(simulation.pnl, -15);
  close(simulation.pnl, simulation.realized + simulation.unrealized);
  fill('buy', 5, 18);
  simulation.mark();
  close(call.position, 0);
  close(call.averageCost, 0);
  close(simulation.cash, -15);
  close(simulation.pnl, -15);
});

test('fills cannot exceed either the posted size or the position limit', () => {
  const simulation = new MarketSimulation();
  const call = simulation.instruments[0];
  call.quote.bidSize = 4;
  simulation.fill(call, 'buy', 12, 20);
  assert.equal(call.position, 4);
  assert.equal(call.quote.bidSize, 0);
  call.quote.bidSize = 200;
  simulation.fill(call, 'buy', 200, 20);
  assert.equal(call.position, 100);
  call.quote.askSize = 300;
  simulation.fill(call, 'sell', 300, 20);
  assert.equal(call.position, -100);
});

test('positive portfolio delta reduces call buying and increases put buying', () => {
  const simulation = new MarketSimulation();
  for (const instrument of simulation.instruments) {
    instrument.fair = 20;
    instrument.book = { bids: [{ price: 19.98, size: 50 }], asks: [{ price: 20.02, size: 50 }] };
  }
  simulation.delta = 80;
  simulation.requote();
  const [call, put] = simulation.instruments;
  assert.ok(call.quote.bidSize < call.quote.askSize);
  assert.ok(put.quote.bidSize > put.quote.askSize);
  close(call.quote.bid, 19.99);
  close(call.quote.ask, 20.01);
});

test('quotes at either delta tolerance only allow exposure-reducing directions', () => {
  const simulation = new MarketSimulation();
  const [call, put] = simulation.instruments;
  simulation.delta = 10;
  simulation.requote();
  assert.equal(call.quote.bidSize, 0);
  assert.equal(put.quote.askSize, 0);
  assert.ok(call.quote.askSize > 0);
  assert.ok(put.quote.bidSize > 0);

  simulation.delta = -10;
  simulation.requote();
  assert.equal(call.quote.askSize, 0);
  assert.equal(put.quote.bidSize, 0);
  assert.ok(call.quote.bidSize > 0);
  assert.ok(put.quote.askSize > 0);
});

test('delta stays close to neutral on average across synthetic sessions', () => {
  for (const regime of ['calm', 'volatile']) {
    for (const seed of [2842024, 1, 901, 11, 123]) {
      const simulation = new MarketSimulation(seed);
      simulation.setRegime(regime);
      let absoluteDelta = 0;
      let signedDelta = 0;
      for (let tick = 0; tick < 2400; tick++) {
        simulation.step();
        absoluteDelta += Math.abs(simulation.delta);
        signedDelta += simulation.delta;
      }
      const session = `${regime}, seed ${seed}`;
      assert.ok(absoluteDelta / 2400 < 12, `${session}: excessive average exposure`);
      assert.ok(Math.abs(signedDelta / 2400) < 5, `${session}: persistent directional bias`);
    }
  }
});

test('changing delta tolerance updates resting quotes without restarting the session', () => {
  const simulation = new MarketSimulation();
  for (let tick = 0; tick < 100; tick++) simulation.step();
  simulation.setDeltaTolerance(100);
  simulation.delta = 25;
  simulation.requote();
  const [call, put] = simulation.instruments;
  assert.ok(call.quote.bidSize > 0);
  assert.ok(put.quote.askSize > 0);
  const snapshot = () => JSON.stringify({
    time: simulation.time, cash: simulation.cash, pnl: simulation.pnl,
    realized: simulation.realized, delta: simulation.delta,
    positions: simulation.instruments.map(instrument => instrument.position),
    history: simulation.history, tape: simulation.tape, randomState: simulation.randomState
  });
  const before = snapshot();
  simulation.setDeltaTolerance(25);
  assert.equal(simulation.deltaTolerance, 25);
  assert.equal(call.quote.bidSize, 0);
  assert.equal(put.quote.askSize, 0);
  assert.ok(call.quote.askSize > 0);
  assert.ok(put.quote.bidSize > 0);
  assert.equal(snapshot(), before);
});

test('delta tolerance rejects invalid values and stays within its supported range', () => {
  const simulation = new MarketSimulation();
  for (const value of [NaN, Infinity, -Infinity, undefined, null, '25']) {
    simulation.setDeltaTolerance(value);
    assert.equal(simulation.deltaTolerance, 10);
  }
  simulation.setDeltaTolerance(0);
  assert.equal(simulation.deltaTolerance, 5);
  simulation.setDeltaTolerance(200);
  assert.equal(simulation.deltaTolerance, 100);
});

test('reset preserves the chosen tolerance and reproduces the session', () => {
  const simulation = new MarketSimulation(123);
  simulation.setDeltaTolerance(100);
  for (let tick = 0; tick < 100; tick++) simulation.step();
  const first = JSON.stringify(simulation.history);
  simulation.reset();
  assert.equal(simulation.deltaTolerance, 100);
  assert.equal(simulation.pnl, 0);
  for (let tick = 0; tick < 100; tick++) simulation.step();
  assert.equal(JSON.stringify(simulation.history), first);
});

test('long sessions conserve accounting, respect risk limits and bound history', () => {
  for (const seed of [1, 2842024, 901]) {
    const simulation = new MarketSimulation(seed);
    for (let tick = 0; tick < 6000; tick++) {
      simulation.setRegime(['calm', 'volatile', 'calm'][Math.floor(tick / 2000)]);
      simulation.step();
      close(simulation.pnl, simulation.realized + simulation.unrealized);
      assert.ok(Number.isFinite(simulation.delta));
      for (const instrument of simulation.instruments) {
        assert.ok(Math.abs(instrument.position) <= 100);
        assert.ok(instrument.quote.bidSize >= 0 && instrument.quote.bidSize <= 100 - instrument.position);
        assert.ok(instrument.quote.askSize >= 0 && instrument.quote.askSize <= 100 + instrument.position);
        assert.ok(instrument.quote.bid < instrument.quote.ask || (!instrument.quote.bidSize && !instrument.quote.askSize));
      }
    }
    assert.ok(simulation.tradeCount > 100);
    assert.equal(simulation.history.length, 181);
    assert.equal(simulation.tape.length, 30);
  }
});

test('reset returns to zero and reproduces the same synthetic session', () => {
  const simulation = new MarketSimulation(123);
  for (let tick = 0; tick < 100; tick++) simulation.step();
  const first = JSON.stringify(simulation.history);
  simulation.reset();
  assert.equal(simulation.time, 0);
  assert.equal(simulation.pnl, 0);
  assert.equal(simulation.tradeCount, 0);
  assert.equal(simulation.cash, 0);
  assert.equal(simulation.tape.length, 0);
  assert.equal(simulation.regime, 'calm');
  for (let tick = 0; tick < 100; tick++) simulation.step();
  assert.equal(JSON.stringify(simulation.history), first);
});

test('market conditions change price movement and losses are possible', () => {
  const calm = new MarketSimulation(11), volatile = new MarketSimulation(11);
  volatile.setRegime('volatile');
  let calmMovement = 0, volatileMovement = 0, lossSeen = false;
  for (let tick = 0; tick < 1000; tick++) {
    const priorCalm = calm.spot, priorVolatile = volatile.spot;
    calm.step(); volatile.step();
    calmMovement += Math.abs(calm.spot - priorCalm);
    volatileMovement += Math.abs(volatile.spot - priorVolatile);
    lossSeen ||= volatile.pnl < 0;
  }
  assert.ok(volatileMovement > calmMovement * 2);
  assert.ok(lossSeen);
});
