import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '../../assets/vendor/three/OrbitControls.js';
import { buildScene, studioEnvironment, studioLights, floorDisc, sampleTake, padLevels, PADS } from '../stage.js';
import { createBackdrop } from './backdrop.js';
import { world, reducedMotion, musicEnergy } from './world.js';

// Where each preset looks, the direction it looks from, and how far.
const VIEWS = {
  front: { target: [.16, -.12, .97], from: [.56, .8, .3], distance: 1.62, fov: 32 },
  hands: { target: [.15, 0, .83], from: [.18, .72, .68], distance: .86, fov: 32 }
};
// The three controls a part is played on, on the controller itself.
const TARGETS = [['claps', 'pad_1'], ['rims', 'pad_5'], ['shakers', 'knob_4']];

export function viewPose(name, camera, stage) {
  if (name === 'head') {
    const head = stage.cameras.policy, position = head.getWorldPosition(new THREE.Vector3());
    const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
    return { position, target: position.clone().add(ahead), fov: head.fov };
  }
  // Portrait stages step back, but only part of the way: the arms may leave the frame before the robot gets small.
  const v = VIEWS[name], aspect = Math.max(.4, camera.aspect), k = aspect < 1.25 ? Math.pow(1.25 / aspect, .6) : 1;
  // and aim a little lower, which lifts the robot into the space above the controls.
  const target = new THREE.Vector3(...v.target);
  if (aspect < 1) target.z -= .2 * (1 - aspect);
  return { position: target.clone().addScaledVector(new THREE.Vector3(...v.from).normalize(), v.distance * k), target, fov: v.fov };
}

export function Scene({ data, view, onView, onPick, part }) {
  const { gl, scene, camera } = useThree();
  const stage = useMemo(() => buildScene(data), [data]);
  const backdrop = useMemo(() => createBackdrop(), []);
  const q = useMemo(() => new Float32Array(data.desc.nq), [data]);
  const levels = useRef({});
  const rig = useRef({ tween: null, view, touched: false, tick: -1 });

  useEffect(() => {
    world.stage = stage;
    world.scene = scene;
    scene.environment = studioEnvironment(gl);
    scene.environmentIntensity = .7;
    studioLights(scene);
    const floor = floorDisc();
    scene.add(floor, backdrop.mesh);
    gl.toneMappingExposure = 1.05;
    return () => scene.remove(floor, backdrop.mesh);
  }, [gl, scene, stage, backdrop]);

  // Orbiting is the three.js addon; taking the camera by hand drops the preset.
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement);
    // Azimuth is measured in the controls' y-up frame, where the front view sits near 2.5 rad: about 85° either
    // side of it, wrapping through π, keeps the camera in front of the backdrop.
    Object.assign(c, { enableDamping: true, dampingFactor: .08, minDistance: .3, maxDistance: 3.4, maxPolarAngle: Math.PI * .56, minAzimuthAngle: 1.05, maxAzimuthAngle: -2.27, rotateSpeed: .7 });
    return c;
  }, [camera, gl]);
  useEffect(() => {
    const start = () => { rig.current.touched = true; rig.current.tween = null; if (rig.current.view) onView(null); };
    controls.addEventListener('start', start);
    return () => { controls.removeEventListener('start', start); controls.dispose(); };
  }, [controls, onView]);

  // A new preset eases there from wherever the camera is; a drag interrupts it.
  useEffect(() => {
    rig.current.view = view;
    controls.enabled = view !== 'head';
    if (!view) return;
    const to = viewPose(view, camera, stage);
    if (reducedMotion.matches || !rig.current.ready) {
      camera.position.copy(to.position); controls.target.copy(to.target); camera.fov = to.fov; camera.updateProjectionMatrix();
      rig.current.ready = true;
      return;
    }
    rig.current.tween = { start: performance.now(), from: { position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov }, to };
  }, [view, camera, controls, stage]);

  const targets = useMemo(() => TARGETS.map(([name, id]) => {
    const knob = id.startsWith('knob');
    const position = knob ? stage.bodies.find((b) => b.name === id).position.clone() : stage.pads.get(id).centre.clone();
    return { name, position, size: knob ? [.028, .028, .03] : [.034, .034, .016] };
  }), [stage]);

  useFrame((state, dt) => {
    const take = world.take;
    if (!take) return;
    let t = world.time();
    if (world.playing && world.mixer?.playing && t >= take.duration_s - .01) {
      world.mixer.stop();
      world.playing = false;
      world.position = t = take.duration_s;
      world.onEnded?.();
    }
    sampleTake(take, t, q, stage.knobIndex);
    stage.pose(q);
    const glow = padLevels(take, t, levels.current);
    if (world.hover) {
      const id = TARGETS.find(([name]) => name === world.hover)[1];
      if (PADS[world.hover]) glow[id] = Math.max(glow[id] || 0, .35);
    }
    stage.glow(glow);
    world.energy = world.playing ? musicEnergy(t) : 0;
    backdrop.update(Math.min(dt, .1), world.energy, reducedMotion.matches);

    const r = rig.current, now = performance.now();
    if (r.tween) {
      const k = Math.min(1, (now - r.tween.start) / 900), e = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(r.tween.from.position, r.tween.to.position, e);
      controls.target.lerpVectors(r.tween.from.target, r.tween.to.target, e);
      camera.fov = r.tween.from.fov + (r.tween.to.fov - r.tween.from.fov) * e;
      camera.updateProjectionMatrix();
      if (k >= 1) r.tween = null;
    } else if (r.view === 'front' && !r.touched && !reducedMotion.matches) {
      // Until someone takes the camera, it drifts a few degrees side to side.
      const pose = viewPose('front', camera, stage), rel = pose.position.clone().sub(pose.target);
      rel.applyAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(now * .00016) * .09);
      camera.position.copy(pose.target).add(rel);
      controls.target.copy(pose.target);
    }
    if (r.view === 'head') camera.lookAt(controls.target);
    else controls.update();

    // The policy acts every 0.2 s; anything showing its inputs updates on the same beat.
    const tick = Math.floor(t / .2);
    if (tick !== r.tick) { r.tick = tick; world.onTick?.(t); }
  });

  const hover = (name) => (event) => {
    event.stopPropagation();
    world.hover = name;
    gl.domElement.style.cursor = name ? 'pointer' : '';
  };

  return (
    <>
      <primitive object={stage.root} />
      {targets.map((target) => (
        <mesh key={target.name} position={target.position}
          onClick={(event) => { if (event.delta > 6) return; event.stopPropagation(); onPick(target.name); }}
          onPointerOver={hover(target.name)} onPointerOut={hover(null)}>
          <boxGeometry args={target.size} />
          <meshBasicMaterial visible={false} />
        </mesh>
      ))}
    </>
  );
}
