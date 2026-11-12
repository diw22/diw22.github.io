import * as THREE from 'three';
import { useEffect, useRef } from 'react';
import { studioEnvironment } from '../stage.js';
import { world } from './world.js';

const RESULTS = [
  ['Claps', 'Three-part', '24 / 35', '91%', '42 ms'],
  ['Rims', 'Three-part', '1 / 40', '–', '–'],
  ['Rims', 'Rims-only', '31 / 40', '99%', '18 ms'],
  ['Rims', 'Distilled student', '40 / 40', '99.8%', '14 ms'],
  ['Shakers', 'Three-part', '23 / 30', 'Volume error 0.16 (mine: 0.02)', '']
];

// The head camera at the policy's own 224 × 224, on its own small renderer, redrawn every 0.2 s like the policy.
function useSees(canvas, open) {
  useEffect(() => {
    if (!open || !world.scene) return;
    let sees = canvas.current.__sees;
    if (!sees) {
      const renderer = new THREE.WebGLRenderer({ canvas: canvas.current, antialias: true });
      renderer.setPixelRatio(1);
      renderer.setSize(224, 224, false);
      renderer.setClearColor(0x141014);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      // Each WebGL context needs its own reflections; the main one's can't be shared.
      sees = canvas.current.__sees = { renderer, environment: studioEnvironment(renderer) };
    }
    const head = world.stage.cameras.policy;
    const draw = () => {
      head.aspect = 1;
      head.updateProjectionMatrix();
      const main = world.scene.environment;
      world.scene.environment = sees.environment;
      sees.renderer.render(world.scene, head);
      world.scene.environment = main;
    };
    draw();
    world.onTick = draw;
    return () => { if (world.onTick === draw) world.onTick = null; };
  }, [canvas, open]);
}

// What the backing sounds like over the last 4 s, scrolling, from the bus without the robot's part.
function useHears(canvas, open) {
  useEffect(() => {
    if (!open) return;
    const c = canvas.current, ctx = c.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
    ctx.fillStyle = '#141014';
    ctx.fillRect(0, 0, c.width, c.height);
    // Warm greys, not red: on this page red only ever means the robot's own part.
    const stops = [[0, [20, 16, 20]], [.45, [74, 66, 64]], [.75, [176, 164, 152]], [1, [246, 238, 226]]];
    const palette = Array.from({ length: 256 }, (_, i) => {
      const v = i / 255, k = Math.max(1, stops.findIndex((s) => s[0] >= v)), [a, b] = [stops[k - 1], stops[k]];
      const f = (v - a[0]) / (b[0] - a[0]);
      return `rgb(${a[1].map((x, j) => Math.round(x + (b[1][j] - x) * f)).join(',')})`;
    });
    let frame, last = 0, data;
    const loop = (now) => {
      frame = requestAnimationFrame(loop);
      const an = world.mixer?.analyser;
      if (!an || !world.playing) { last = 0; return; }
      if (!last) { last = now; return; }
      const step = Math.floor((now - last) / 4000 * c.width);
      if (step < 1) return;
      last += step / c.width * 4000;
      data ||= new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(data);
      ctx.drawImage(c, -step, 0);
      const rate = world.mixer.ctx.sampleRate, lo = Math.log(40), hi = Math.log(12000);
      for (let y = 0; y < c.height; y++) {
        const f = Math.exp(lo + (1 - (y + .5) / c.height) * (hi - lo));
        ctx.fillStyle = palette[data[Math.min(data.length - 1, Math.round(f / (rate / 2) * data.length))]];
        ctx.fillRect(c.width - step, y, step, 1);
      }
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [canvas, open]);
}

export function Panel({ open, onClose, onWatch }) {
  const sees = useRef(), hears = useRef(), heading = useRef();
  useSees(sees, open);
  useHears(hears, open);
  useEffect(() => { if (open) heading.current.focus({ preventScroll: true }); }, [open]);

  return (
    <aside id="panel" className={`panel${open ? ' is-open' : ''}`} aria-labelledby="panel-title" inert={!open}
      onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <div className="panel-head">
        <h2 id="panel-title" ref={heading} tabIndex={-1}>How it works</h2>
        <button type="button" className="close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <p>The robot hears the song with one part taken out. Nothing tells it which part, so it has to work that out from the music and then play it in time.</p>
      <figure>
        <canvas ref={sees} className="sees" width="224" height="224" />
        <figcaption>What it sees: its head camera, 224 by 224 pixels</figcaption>
      </figure>
      <figure>
        <canvas ref={hears} className="hears" />
        <figcaption>What it hears: the last four seconds, without its own part</figcaption>
      </figure>
      <p>Every 0.2 s a 7B vision-language-action model, OpenVLA-OFT with MERT for the audio, takes these with the same fixed prompt and predicts the next 0.4 s of joint targets.</p>
      <p>On this page you're watching demonstrations from test takes the model never trained on: my playing, turned into robot motion and simulated in MuJoCo. <button type="button" className="inline" onClick={onWatch}>Watch the trained model play</button></p>
      <details>
        <summary>Results on held-out takes</summary>
        <table>
          <thead><tr><th scope="col">Part</th><th scope="col">Model</th><th scope="col">Right part</th><th scope="col">Beats hit</th><th scope="col">Timing</th></tr></thead>
          <tbody>{RESULTS.map((row) => (
            <tr key={row[1] + row[0]}>
              <td>{row[0]}</td><td>{row[1]}</td><td className="num">{row[2]}</td>
              {row[4] === '' ? <td colSpan={2}>{row[3]}</td> : <><td className="num">{row[3]}</td><td className="num">{row[4]}</td></>}
            </tr>
          ))}</tbody>
        </table>
      </details>
      <p className="panel-links">
        <a href="../#project/kraftwerk-bot/story">Full write-up</a>
        <a href="https://github.com/diw22/DWinters_Humanoid" target="_blank" rel="noopener noreferrer">Code ↗</a>
        <a href="https://huggingface.co/datasets/diw22/DWinters_Humanoid-data" target="_blank" rel="noopener noreferrer">Dataset ↗</a>
      </p>
      <p className="credits">Music, recordings and data are mine (CC BY 4.0). The Unitree G1 model is from MuJoCo Menagerie under Unitree's BSD licence (<a href="data/LICENSE-G1.txt">notice</a>). Keys: space plays, 1 to 3 choose a part.</p>
    </aside>
  );
}
