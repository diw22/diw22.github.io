// The song, rebuilt bar by bar from its loops exactly as training/audio_policy.backing() mixed each take, with the part
// the robot plays taken out. The robot's part is sounded from the demonstration itself: the pad's sample at every
// simulated fingertip contact, or the shakers loop at the volume the robot's knob turn gives.
const PARTS = ['claps', 'rims', 'shakers'];
const mod = (a, n) => ((a % n) + n) % n;

function barSource(part, bar, first) {
  if (part === 'chords6') return mod(bar - first, 9);
  return part === 'shakers' ? 1 + mod(bar, 8) : mod(bar, 13);
}

export function knobVolume(manifest, angle) {
  const { silent_below_deg: lo, full_at_deg: hi } = manifest.knob_volume;
  return Math.min(1, Math.max(0, (-angle * 180 / Math.PI - lo) / (hi - lo)));
}

export class Mixer {
  // Fetches the audio straight away; the AudioContext waits for start(), which must run inside a user gesture.
  constructor(manifest, base) {
    this.m = manifest;
    this.base = base;
    const get = async (file) => {
      const response = await fetch(new URL(file, base));
      if (!response.ok) throw new Error(`Could not load the music (${response.status}).`);
      return response.arrayBuffer();
    };
    this.bytes = Promise.all([get(manifest.sync.file), ...Object.values(manifest.loops).map((l) => get(l.file))]);
    this.bytes.catch(() => {});
    this.sources = new Set();
    this.extra = [];
    this.playing = false;
    this.position = 0;
    this.delay = 0;
    this.robotOn = true;
  }

  start() {
    if (this.ctx) return this.ctx.state === 'running' ? Promise.resolve() : this.ctx.resume();
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const manifest = this.m;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = manifest.master_gain;
    const limiter = c.createDynamicsCompressor();
    Object.entries({ threshold: -4, knee: 2, ratio: 12, attack: .002, release: .12 }).forEach(([k, v]) => { limiter[k].value = v; });
    this.backing = c.createGain();
    this.robot = c.createGain();
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = .2;
    this.backing.connect(this.analyser);
    this.backing.connect(this.master);
    this.robot.connect(this.master);
    this.master.connect(limiter).connect(c.destination);
    this.robot.gain.value = this.robotOn ? 1 : 0;
    this.gains = {};
    for (const [part, gain] of Object.entries(manifest.gain)) {
      this.gains[part] = c.createGain();
      this.gains[part].gain.value = gain;
      this.gains[part].connect(this.backing);
    }
    this.ready = this.load();
    this.ready.catch(() => {});
    return c.resume();
  }

  async load() {
    // Callback form: older Safari has no promise-returning decodeAudioData.
    const decode = (bytes) => new Promise((resolve, reject) => this.ctx.decodeAudioData(bytes, resolve, reject));
    const names = Object.keys(this.m.loops);
    const [sync, ...buffers] = await Promise.all((await this.bytes).map(decode));
    this.buffers = Object.fromEntries(names.map((n, i) => [n, buffers[i]]));
    // AAC decoders differ in whether they trim the encoder's priming samples. A click at a known sample measures it,
    // so the loops and the robot's hits keep the millisecond timing the page reports.
    const data = sync.getChannelData(0);
    let at = 0;
    for (let i = 1; i < data.length; i++) if (Math.abs(data[i]) > Math.abs(data[at])) at = i;
    const delay = at / sync.sampleRate - this.m.sync.click_sample / this.m.sync.rate;
    this.delay = delay > -.002 && delay < .2 ? Math.max(0, delay) : 0;
  }

  // Take time (s) of what is audible now.
  time() {
    if (!this.playing) return this.position;
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return Math.min(this.take.duration_s, Math.max(0, this.ctx.currentTime - latency - this.t0));
  }

  // Call start() from the click handler first: browsers only allow audio to begin inside a user gesture.
  async play(take, from = 0) {
    await this.start();
    await this.ready;
    this.stopSources();
    const c = this.ctx, bar = this.m.bar_s, when = c.currentTime + .08;
    this.take = take;
    this.t0 = when - from;
    this.playing = true;
    const backing = ['kick', 'chords6', ...PARTS.filter((p) => p !== take.part)];
    let shakers = null;
    if (take.part === 'shakers') {
      // The robot's knob sets the shakers' level: one gain curve at the demonstration's 60 Hz.
      shakers = c.createGain();
      const scale = take.scale, first = Math.min(take.frames - 2, Math.ceil(from * take.fps)), n = take.frames - first;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) curve[i] = knobVolume(this.m, take.joints[(first + i) * take.channels + 28] * scale);
      // A curve may not share its start with another event, so its first value is the node's initial gain.
      shakers.gain.value = curve[0];
      shakers.gain.setValueCurveAtTime(curve, this.t0 + first / take.fps, (n - 1) / take.fps);
      const level = c.createGain();
      level.gain.value = this.m.gain.shakers;
      shakers.connect(level).connect(this.robot);
      this.extra.push(shakers, level);
    }
    for (let k = 0; k < take.bars - 1; k++) {
      const start = k * bar, end = start + bar;
      if (end <= from) continue;
      const skip = Math.max(0, from - start), at = when + Math.max(0, start - from), b = take.first_bar + k;
      for (const part of backing) this.segment(part, b, take.first_bar, at, skip, this.gains[part]);
      if (shakers) this.segment('shakers', b, take.first_bar, at, skip, shakers);
    }
    if (take.part !== 'shakers') {
      const shot = this.m.shots[take.part], buffer = this.buffers[take.part], level = c.createGain();
      level.gain.value = this.m.gain[take.part];
      level.connect(this.robot);
      this.extra.push(level);
      for (const hit of take.hits) {
        if (hit < from) continue;
        const source = c.createBufferSource();
        source.buffer = buffer;
        source.connect(level);
        source.start(this.t0 + hit, this.delay + shot.sample / this.m.sync.rate, shot.length_s);
        this.sources.add(source);
      }
    }
  }

  segment(part, bar, first, at, skip, destination) {
    const buffer = this.buffers[part], offset = this.delay + barSource(part, bar, first) * this.m.bar_s + skip;
    if (offset >= buffer.duration) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    source.start(at, offset, Math.min(this.m.bar_s - skip, buffer.duration - offset));
    this.sources.add(source);
  }

  pause() {
    this.position = this.time();
    this.stopSources();
    this.playing = false;
  }

  stop() {
    this.stopSources();
    this.playing = false;
    this.position = 0;
  }

  stopSources() {
    for (const source of this.sources) { try { source.stop(); } catch { /* not started */ } source.disconnect(); }
    for (const node of this.extra) node.disconnect();
    this.sources.clear();
    this.extra = [];
  }

  setRobot(on) {
    this.robotOn = on;
    this.robot?.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, .015);
  }
}
