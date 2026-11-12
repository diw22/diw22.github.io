import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { loadScene, loadManifest, loadTake } from '../stage.js';
import { Mixer } from '../audio.js';
import { Scene } from './Scene.jsx';
import { Timeline } from './Timeline.jsx';
import { Panel } from './Panel.jsx';
import { world } from './world.js';
import { ArrowBack, ArrowOut } from './icons.jsx';

const base = new URL('./', document.baseURI);
const PARTS = [['rims', 'Rims'], ['claps', 'Claps'], ['shakers', 'Shakers']];
const KEYS = { 1: 'rims', 2: 'claps', 3: 'shakers' };
const VIEWS = [['front', 'Front'], ['hands', 'Hands'], ['head', 'Its eyes']];
const VIDEOS = {
  claps: ['kraftwerk-claps', 'Claps on a held-out take: me playing, then the three-part model in simulation on its own.'],
  rims: ['kraftwerk-rims-student', 'Rims on a held-out take: me playing, then the 1.8M-parameter distilled student on its own.'],
  shakers: ['kraftwerk-shakers', 'Shakers on a held-out take: me playing, then the three-part model fading them with knob 4.']
};

// Quality levels from assets/js/perf.js: slower computers get fewer pixels, then no shadows, then no antialiasing
// (which can only be set as the canvas is made, so dropping to that level rebuilds it once).
const perf = window.SitePerf || { level: 0, onChange() { return () => {}; }, hold() {} };
const DPR = [[1, 2], 1, .75, .6];
// No WebGL at all (graphics acceleration switched off): the robot can't run, so say so rather than load it.
const noGraphics = perf.webgl === false;

export function App() {
  const [quality, setQuality] = useState(perf.level);
  useEffect(() => perf.onChange(setQuality), []);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [part, setPart] = useState('rims');
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [view, setView] = useState('front');
  const [panel, setPanel] = useState(false);
  const panelButton = useRef(), dialog = useRef(), video = useRef();

  useEffect(() => {
    if (noGraphics) return;
    let compiled;
    // Loading, and the first frames while shaders compile, stutter; that mustn't count as a slow computer.
    perf.hold(new Promise((done) => { compiled = done; }));
    (async () => {
      const [scene, manifest] = await Promise.all([loadScene(base), loadManifest(base)]);
      const parts = Object.keys(manifest.parts);
      const takes = await Promise.all(parts.map((p) => loadTake(base, manifest, p)));
      Object.assign(world, { manifest, mixer: new Mixer(manifest, base), takes: Object.fromEntries(parts.map((p, i) => [p, takes[i]])) });
      world.take = world.takes.rims;
      setData(scene);
      setTimeout(compiled, 2500);
    })().catch((e) => { compiled(); console.error(e); setError('The robot could not load. Try reloading the page.'); });
  }, []);

  // Sound may only start inside a click or key press, so mixer.start() runs before anything is awaited.
  const play = useCallback((name, from) => {
    const take = world.takes[name];
    if (from === undefined) from = world.position >= take.duration_s - .05 ? 0 : world.position;
    world.mixer.start();
    Object.assign(world, { take, position: from, playing: true });
    world.mixer.position = from;
    setPlaying(true);
    setWaiting(true);
    world.mixer.play(take, from).then(() => {
      setWaiting(false);
      if (!world.playing) world.mixer.pause();
    }, (e) => {
      console.error(e);
      setWaiting(false);
      world.playing = false;
      setPlaying(false);
      setError('The music could not load. Try reloading the page.');
    });
  }, []);

  const pause = useCallback(() => {
    if (world.mixer?.playing) world.mixer.pause();
    if (world.mixer) world.position = world.mixer.position;
    world.playing = false;
    setPlaying(false);
  }, []);

  useEffect(() => { world.onEnded = () => setPlaying(false); }, []);

  // Choosing a part plays it straight away, from the top.
  const choose = useCallback((name) => {
    if (!world.mixer) return;
    if (name === part) { if (!world.playing) play(name); return; }
    pause();
    world.position = 0;
    world.take = world.takes[name];
    setPart(name);
    play(name, 0);
  }, [part, play, pause]);

  const toggle = useCallback(() => { if (world.playing) pause(); else play(part); }, [part, play, pause]);

  const seek = useCallback((t, phase) => {
    if (phase === 'start') { world.resume = world.playing; if (world.playing) pause(); }
    world.position = t;
    if (world.mixer) world.mixer.position = t;
    if ((phase === 'end' && world.resume) || (phase === 'key' && world.playing)) { world.resume = false; play(part, t); }
  }, [part, play, pause]);

  useEffect(() => {
    const key = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !world.mixer || document.querySelector('dialog[open]')) return;
      const onControl = event.target.closest?.('button, a, input, summary, [role="slider"]');
      if (event.key === ' ' && !onControl) { event.preventDefault(); toggle(); }
      else if (KEYS[event.key]) choose(KEYS[event.key]);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [toggle, choose]);

  const closePanel = useCallback(() => { setPanel(false); panelButton.current?.focus({ preventScroll: true }); }, []);

  // The film grows out of the link that opened it.
  const watch = (event) => {
    if (world.playing) pause();
    const [name, caption] = VIDEOS[part], d = dialog.current;
    video.current.poster = `../assets/img/projects/kraftwerk/${name}-poster.jpg`;
    video.current.src = `../assets/video/${name}.mp4`;
    d.querySelector('figcaption').textContent = caption;
    d.showModal();
    const from = event.currentTarget.getBoundingClientRect(), box = d.getBoundingClientRect();
    d.style.transformOrigin = `${from.left + from.width / 2 - box.left}px ${from.top + from.height / 2 - box.top}px`;
    d.classList.remove('is-opening');
    void d.offsetWidth;
    d.classList.add('is-opening');
    video.current.play().catch(() => {});
  };
  const closeVideo = () => dialog.current.close();
  useEffect(() => {
    const d = dialog.current, v = video.current;
    const closed = () => { v.pause(); v.removeAttribute('src'); v.load(); };
    d.addEventListener('close', closed);
    return () => d.removeEventListener('close', closed);
  }, []);

  const take = data && world.takes[part];

  return (
    <div className={`app${panel ? ' has-panel' : ''}${data ? ' is-ready' : ''}`}>
      <div className="stage">
        {data && (
          <Canvas key={quality < 3 ? 'smooth' : 'light'} shadows={quality < 2 ? 'percentage' : false} dpr={DPR[quality]} gl={{ antialias: quality < 3, alpha: true }}
            camera={{ up: [0, 0, 1], fov: 32, near: .02, far: 40, position: [1, 1.2, 1.4] }}
            aria-label="A Unitree G1 humanoid at a desk with an eight-pad controller. Drag to look around; click a pad to choose a part.">
            <Scene data={data} view={view} onView={setView} onPick={choose} part={part} />
          </Canvas>
        )}
        {!data && (
          <p className="status" role="status">
            {noGraphics
              ? <span>3D graphics are switched off in this browser, so the robot can’t run here. Turn on graphics acceleration and reload, or <a href="../#project/kraftwerk-bot/story">read about the project</a>.</span>
              : <span>{error || 'Loading the robot'}</span>}
          </p>
        )}
        {data && error && <p className="status" role="alert">{error}</p>}
      </div>

      <header className="bar">
        <a className="back" href="../#work/kraftwerk-bot" aria-label="All projects"><ArrowBack /> <span className="back-label" aria-hidden="true">All projects</span></a>
        <h1 className="title">Kraftwerk Bot</h1>
        <nav className="links" aria-label="Project">
          <button ref={panelButton} type="button" aria-expanded={panel} aria-controls="panel" onClick={() => (panel ? closePanel() : setPanel(true))}><span className="full-label">How it works</span><span className="short-label" aria-hidden="true">Info</span></button>
          <a href="https://github.com/diw22/DWinters_Humanoid" target="_blank" rel="noopener noreferrer">Code <ArrowOut /></a>
        </nav>
      </header>

      {take && (
        <section className="controls" aria-label="Play">
          <p className="hint" id="hint">Take a part out and the robot plays it</p>
          <div className="row">
            <div className="parts" role="radiogroup" aria-labelledby="hint">
              {PARTS.map(([name, label]) => (
                <button key={name} type="button" role="radio" aria-checked={part === name} onClick={() => choose(name)}>{label}</button>
              ))}
            </div>
            <button type="button" className={`play${waiting ? ' is-waiting' : ''}`} onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
              <svg viewBox="0 0 24 24" aria-hidden="true">{playing ? <path d="M7.5 5.5h3v13h-3zM13.5 5.5h3v13h-3z" /> : <path d="M8.5 5.5v13l10-6.5z" />}</svg>
            </button>
          </div>
          <Timeline key={part} take={take} onSeek={seek} bar={world.manifest.bar_s} />
        </section>
      )}

      {data && (
        <nav className="views" aria-label="Camera">
          {VIEWS.map(([name, label]) => (
            <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>{label}</button>
          ))}
        </nav>
      )}

      <Panel open={panel && Boolean(data)} onClose={closePanel} onWatch={watch} />

      <dialog ref={dialog} className="film" aria-label="The trained model playing" onClick={(event) => { if (event.target === dialog.current) closeVideo(); }}>
        <figure>
          <video ref={video} controls playsInline preload="none" />
          <figcaption />
        </figure>
        <button type="button" className="close" onClick={closeVideo} aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </dialog>
    </div>
  );
}
