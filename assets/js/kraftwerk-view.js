import * as THREE from 'three';
import { loadScene, loadManifest, loadTake, buildScene, studioEnvironment, studioLights, sampleTake, padLevels } from '../../kraftwerk-bot/stage.js';

// Kraftwerk Bot on the projects stage: the G1 at its controller, looping two bars of a rims demonstration.
export async function createKraftwerkView(canvas) {
  const base = new URL('kraftwerk-bot/', document.baseURI);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0, 0);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.environment = studioEnvironment(renderer);
  scene.environmentIntensity = .8;
  studioLights(scene, { mapSize: 1024 });

  const [data, manifest] = await Promise.all([loadScene(base), loadManifest(base)]);
  const take = await loadTake(base, manifest, 'rims');
  const stage = buildScene(data);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.1, 64), new THREE.ShadowMaterial({ opacity: .2 }));
  floor.position.set(.15, -.1, 0);
  floor.receiveShadow = true;
  const spin = new THREE.Group(), pivot = new THREE.Group();
  scene.add(spin);
  spin.add(pivot);
  pivot.add(stage.root, floor);
  // Framed on the playing: the robot's upper body, the desk top and the controller. The legs fade out below.
  const box = new THREE.Box3().setFromObject(stage.root);
  box.min.z = .42;
  const centre = box.getCenter(new THREE.Vector3());
  pivot.position.copy(centre).negate();
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  // The fade is a last pass that scales what's drawn (premultiplied colour and alpha alike) towards the bottom.
  // A CSS mask would make the browser read the canvas back to composite it.
  const fade = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    vertexShader: 'varying float v; void main() { v = position.y * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: 'varying float v; void main() { gl_FragColor = vec4(0., 0., 0., smoothstep(.12, .4, v)); }',
    depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.SrcAlphaFactor
  }));
  fade.frustumCulled = false;
  const overlay = new THREE.Scene(), flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  overlay.add(fade);
  renderer.autoClear = false;
  const camera = new THREE.PerspectiveCamera(30, 1, .02, 50);
  camera.up.set(0, 0, 1);
  const dir = new THREE.Vector3(.62, .9, .34).normalize();

  // Two bars from the first hit; the last quarter second blends into the loop's start so it never jumps.
  const start = take.hits[0] - .45, length = 2 * manifest.bar_s, blend = .3;
  const q = new Float32Array(data.desc.nq), next = new Float32Array(data.desc.nq), levels = {};
  let clock = performance.now();

  return {
    resize(w, h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
    replay() { clock = performance.now(); },
    draw(yawDeg, tiltDeg) {
      const u = ((performance.now() - clock) / 1000) % length, t = start + u;
      sampleTake(take, t, q, stage.knobIndex);
      if (u > length - blend) {
        const k = (u - (length - blend)) / blend, s = k * k * (3 - 2 * k);
        sampleTake(take, t - length, next, stage.knobIndex);
        for (let i = 0; i < q.length; i++) q[i] += (next[i] - q[i]) * s;
      }
      stage.pose(q);
      stage.glow(padLevels(take, t, levels));
      spin.rotation.z = THREE.MathUtils.degToRad(yawDeg);
      const d = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * .98;
      const v = dir.clone();
      v.z += THREE.MathUtils.degToRad(tiltDeg) * .8;
      camera.position.copy(v.normalize().multiplyScalar(d));
      camera.lookAt(0, 0, -.02);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.render(overlay, flat);
    }
  };
}
