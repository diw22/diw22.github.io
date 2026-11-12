import { useEffect, useRef } from 'react';
import { knobVolume } from '../audio.js';
import { world } from './world.js';

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// One line for the take: the robot's hits as ticks (or its shaker level as a trace), how far it has got, and a
// handle to drag. The bar and the handle move every frame without re-rendering.
export function Timeline({ take, onSeek, bar }) {
  const track = useRef(), fill = useRef(), handle = useRef();
  const duration = take.duration_s;

  useEffect(() => {
    let frame, shown = -1;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const p = Math.min(1, world.time() / duration);
      fill.current.style.transform = `scaleX(${p})`;
      handle.current.style.left = `${p * 100}%`;
      const s = Math.floor(world.time());
      if (s !== shown) {
        shown = s;
        track.current.setAttribute('aria-valuenow', String(s));
        track.current.setAttribute('aria-valuetext', `${fmt(s)} of ${fmt(duration)}`);
      }
    };
    loop();
    return () => cancelAnimationFrame(frame);
  }, [duration]);

  const seekTo = (event) => {
    const r = track.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)) * duration;
  };
  const down = (event) => {
    track.current.setPointerCapture(event.pointerId);
    onSeek(seekTo(event), 'start');
  };
  const move = (event) => { if (track.current.hasPointerCapture(event.pointerId)) onSeek(seekTo(event), 'drag'); };
  const up = (event) => { if (track.current.hasPointerCapture(event.pointerId)) onSeek(seekTo(event), 'end'); };
  const key = (event) => {
    const t = world.time(), to = { ArrowLeft: t - bar, ArrowRight: t + bar, Home: 0, End: duration }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    onSeek(Math.min(duration, Math.max(0, to)), 'key');
  };

  const volume = take.part === 'shakers' ? (() => {
    const points = [];
    for (let f = 0; f < take.frames; f += 6) {
      const v = knobVolume(world.manifest, take.joints[f * take.channels + 28] * take.scale);
      points.push(`${(f / take.fps / duration * 1000).toFixed(1)},${(11 - v * 9).toFixed(2)}`);
    }
    return points.join(' ');
  })() : null;

  return (
    <div ref={track} className="timeline" role="slider" tabIndex={0} aria-label="Position in the take"
      aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={0}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
      <span className="timeline-line" />
      <span ref={fill} className="timeline-fill" />
      <svg className="timeline-marks" viewBox="0 0 1000 12" preserveAspectRatio="none" aria-hidden="true">
        {volume
          ? <polyline points={volume} vectorEffect="non-scaling-stroke" />
          : take.hits.map((h) => { const x = (h / duration * 1000).toFixed(1); return <line key={h} x1={x} x2={x} y1="2" y2="10" vectorEffect="non-scaling-stroke" />; })}
      </svg>
      <span ref={handle} className="timeline-handle" />
    </div>
  );
}
