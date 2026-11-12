// The MuJoCo scene the demonstrations were replayed in (tools/build_assets.py exports it), rebuilt in three.js.
// Shared by this page and the projects carousel (assets/js/kraftwerk-view.js). World axes are MuJoCo's: z up, metres.
import * as THREE from 'three';

const quat = ([w, x, y, z]) => new THREE.Quaternion(x, y, z, w);
const srgb = (rgba) => new THREE.Color().setRGB(rgba[0], rgba[1], rgba[2], THREE.SRGBColorSpace);
export const PADS = { claps: 'pad_1', rims: 'pad_5' };

async function get(url, json) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${new URL(url).pathname.split('/').pop()} (${response.status}).`);
  return json ? response.json() : response.arrayBuffer();
}

export const loadManifest = (base) => get(new URL('data/takes.json', base), true);

export async function loadScene(base) {
  const [desc, blob] = await Promise.all([get(new URL('data/scene.json', base), true), get(new URL('data/meshes.bin', base))]);
  return { desc, blob };
}

// 60 Hz joint positions (28 joints + knob 4, int16 at 1e-4 rad), then the 15 policy targets (int8 over each one's range).
export async function loadTake(base, manifest, part) {
  const info = manifest.parts[part], buffer = await get(new URL(info.file, base));
  const channels = 29;
  return {
    ...info, part, channels, fps: manifest.fps, scale: manifest.angle_scale,
    joints: new Int16Array(buffer, 0, info.frames * channels),
    targets: new Int8Array(buffer, info.frames * channels * 2, info.frames * 15)
  };
}

// Joint positions at take time t (s), linearly interpolated, into q (MuJoCo qpos order).
export function sampleTake(take, t, q, knobIndex) {
  const f = Math.min(Math.max(t * take.fps, 0), take.frames - 1), i = Math.floor(f), a = f - i;
  const j = Math.min(i + 1, take.frames - 1), c = take.channels, d = take.joints, s = take.scale;
  for (let k = 0; k < 28; k++) q[k] = (d[i * c + k] * (1 - a) + d[j * c + k] * a) * s;
  q[knobIndex] = (d[i * c + 28] * (1 - a) + d[j * c + 28] * a) * s;
  return q;
}

function meshGeometry(record, blob) {
  const n = record.vertices, packed = new Int16Array(blob, record.offset, n * 3);
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const k = i % 3;
    positions[i] = record.min[k] + (packed[i] + 32768) / 65535 * (record.max[k] - record.min[k]);
  }
  let indexOffset = record.offset + n * 9;
  indexOffset += indexOffset % 2;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(blob, record.offset + n * 6, n * 3), 3, true));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(blob, indexOffset, record.faces * 3), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

// A white radial falloff, built as data: uploading a 2D canvas would make the browser read it back from the GPU.
function radialTexture(stops, size = 128) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.min(1, Math.hypot(x + .5 - size / 2, y + .5 - size / 2) / (size / 2));
    const k = stops.findIndex(([at]) => at >= d), [a, b] = [stops[Math.max(0, k - 1)], stops[k]];
    const v = Math.round(255 * (b[0] === a[0] ? b[1] : a[1] + (b[1] - a[1]) * (d - a[0]) / (b[0] - a[0])));
    data.set([v, v, v, v], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const glowTexture = () => radialTexture([[0, 1], [.18, .75], [.5, .19], [1, 0]]);

// Soft studio reflections for the G1's shells: a dark room, a warm key softbox and a red strip behind.
export function studioEnvironment(renderer) {
  const env = new THREE.Scene(), basic = (color, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide });
  env.add(new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicMaterial({ color: 0x0d0b0d, side: THREE.BackSide })));
  const panel = (w, h, color, k, pos) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), basic(color, k)); m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m); };
  panel(4, 3, 0xfff1e2, 2.4, [3.5, 4, 4.5]);
  panel(6, 1.2, 0xffd9c8, .9, [-1, -5.5, 2]);
  panel(2, .8, 0xff4a36, .9, [4, -4, 1]);
  panel(7, 7, 0xf4eee8, .5, [0, 0, 5.8]);
  panel(3, 2, 0x9fb2ff, .4, [-5, 2, 1.5]);
  const pmrem = new THREE.PMREMGenerator(renderer), target = pmrem.fromScene(env, .04);
  pmrem.dispose();
  return target.texture;
}

// Warm key with soft shadows, a pale rim to separate the robot from the dark, and a little pad-red from the side.
export function studioLights(scene, { shadows = true, mapSize = 2048 } = {}) {
  const hemi = new THREE.HemisphereLight(0xfff4ea, 0x2a2024, .6);
  hemi.position.set(0, 0, 1);
  const key = new THREE.DirectionalLight(0xfff1e4, 2.5);
  key.position.set(1.3, 1.7, 2.7);
  key.target.position.set(.15, -.1, .9);
  if (shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(mapSize, mapSize);
    Object.assign(key.shadow.camera, { left: -1, right: 1, top: 1, bottom: -1, near: .5, far: 6 });
    key.shadow.normalBias = .02;
    key.shadow.radius = 3;
  }
  const rim = new THREE.DirectionalLight(0xffe4d6, 1.7);
  rim.position.set(-.8, -1.9, 1.9);
  const accent = new THREE.DirectionalLight(0xff4a36, .6);
  accent.position.set(1.8, -1.2, .9);
  const fill = new THREE.DirectionalLight(0xa8b8ff, .35);
  fill.position.set(-1.8, .9, 1.2);
  scene.add(hemi, key, key.target, rim, accent, fill);
  return { key };
}

// A floor that fades out at its edge, so the page background shows through around it.
export function floorDisc(radius = 2.4, color = 0x1a1618) {
  const floor = new THREE.Mesh(new THREE.CircleGeometry(radius, 96), new THREE.MeshStandardMaterial({
    color, roughness: .9, metalness: 0, transparent: true, alphaMap: radialTexture([[0, 1], [.35, .87], [1, 0]], 256), depthWrite: false
  }));
  floor.position.set(.15, -.1, 0);
  floor.receiveShadow = true;
  return floor;
}

export function buildScene(data, { shadows = true, table = true } = {}) {
  const { desc, blob } = data;
  const root = new THREE.Group();
  const bodies = desc.bodies.map((b, i) => (i ? new THREE.Group() : root));
  const joints = [];
  desc.bodies.forEach((b, i) => {
    const group = bodies[i];
    group.name = b.name;
    if (!i) return;
    group.position.fromArray(b.pos);
    group.quaternion.copy(quat(b.quat));
    bodies[b.parent].add(group);
    if (b.joint) joints.push({ ...b.joint, body: group, rest: group.quaternion.clone(), axis: new THREE.Vector3(...b.joint.axis) });
  });

  const materials = {
    black: new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: .42, metalness: .25 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: .36, metalness: .38 }),
    case: new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: .55, metalness: .1 }),
    endcap: new THREE.MeshStandardMaterial({ color: 0xa3121a, roughness: .4, metalness: .1 }),
    knob: new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: .38, metalness: .2 }),
    pointer: new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: .3, emissive: 0x222222 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x3b2a20, roughness: .62, metalness: 0 })
  };
  const geometries = new Map(), glow = glowTexture(), pads = new Map();
  const padFor = (id) => {
    if (!pads.has(id)) pads.set(id, { id, level: 0 });
    return pads.get(id);
  };

  for (const g of desc.geoms) {
    const parent = bodies[g.body];
    if (g.name === 'desk') {
      if (table) parent.add(makeTable(g, materials.wood, shadows));
      continue;
    }
    let geometry;
    if (g.type === 'mesh') {
      if (!geometries.has(g.mesh)) geometries.set(g.mesh, meshGeometry(desc.meshes[g.mesh], blob));
      geometry = geometries.get(g.mesh);
    } else if (g.type === 'box') geometry = new THREE.BoxGeometry(g.size[0] * 2, g.size[1] * 2, g.size[2] * 2);
    else geometry = new THREE.CylinderGeometry(g.size[0], g.size[0], g.size[1] * 2, 40).rotateX(Math.PI / 2);
    let material = materials[g.material];
    const pad = g.name.match(/^(rim|control)_(pad_\d)$/);
    if (pad) {
      const record = padFor(pad[2]);
      material = pad[1] === 'rim'
        ? new THREE.MeshStandardMaterial({ color: srgb(g.rgba), emissive: 0xff2a1a, emissiveIntensity: .35, roughness: .5 })
        : new THREE.MeshStandardMaterial({ color: 0x1a1b1e, emissive: 0xff3a24, emissiveIntensity: 0, roughness: .8 });
      record[pad[1]] = material;
    } else if (/^rim_/.test(g.name)) material = new THREE.MeshStandardMaterial({ color: srgb(g.rgba), roughness: .5 });
    else if (/^control_/.test(g.name)) material = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: .7 });
    else if (/endcap/.test(g.name)) material = materials.endcap;
    else if (/case/.test(g.name)) material = materials.case;
    else if (/^cap_knob/.test(g.name)) material = materials.knob;
    else if (!material) material = g.rgba[0] > .8 ? materials.pointer : materials.case;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.fromArray(g.pos);
    mesh.quaternion.copy(quat(g.quat));
    mesh.castShadow = shadows && g.type === 'mesh';
    mesh.receiveShadow = shadows;
    parent.add(mesh);
    if (pad && pad[1] === 'control') {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xff3a22, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
      sprite.position.set(g.pos[0], g.pos[1], g.pos[2] + .004);
      sprite.scale.setScalar(.11);
      sprite.renderOrder = 2;
      parent.add(sprite);
      Object.assign(padFor(pad[2]), { sprite, centre: new THREE.Vector3(...g.pos) });
    }
  }

  const flash = new THREE.PointLight(0xff3b24, 0, .28, 2);
  root.add(flash);
  const knobIndex = desc.bodies.find((b) => b.name === 'knob_4').joint.q;
  const cameras = {};
  for (const [name, c] of Object.entries(desc.cameras)) {
    const camera = new THREE.PerspectiveCamera(c.fovy, 1, .02, 20);
    camera.position.fromArray(c.pos);
    camera.quaternion.copy(quat(c.quat));
    bodies[c.body].add(camera);
    cameras[name] = camera;
  }
  const spin = new THREE.Quaternion();

  return {
    root, bodies, joints, pads, cameras, materials, knobIndex,
    pose(q) {
      for (const j of joints) j.body.quaternion.copy(j.rest).multiply(spin.setFromAxisAngle(j.axis, q[j.q] || 0));
    },
    // level 0..1 per pad; the brightest pad also gets the one flash light.
    glow(levels) {
      let best = null;
      for (const pad of pads.values()) {
        const v = levels[pad.id] || 0;
        pad.level = v;
        if (pad.rim) pad.rim.emissiveIntensity = .35 + v * 5;
        if (pad.control) pad.control.emissiveIntensity = v * 1.6;
        if (pad.sprite) { pad.sprite.material.opacity = Math.min(1, v * 1.1); pad.sprite.scale.setScalar(.08 + v * .07); }
        if (v > (best?.level || .02)) best = pad;
      }
      flash.intensity = best ? best.level * .12 : 0;
      if (best) flash.position.set(best.centre.x, best.centre.y, best.centre.z + .05);
    },
    restPose(take) {
      const q = new Float32Array(desc.nq);
      if (take) sampleTake(take, 0, q, knobIndex);
      return q;
    }
  };
}

// The simulator's desk is a solid block from the floor; drawn as a table with the same top and footprint.
function makeTable(g, material, shadows) {
  const [sx, sy, sz] = g.size, top = g.pos[2] + sz, group = new THREE.Group(), thickness = .035;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(sx * 2, sy * 2, thickness), material);
  slab.position.set(g.pos[0], g.pos[1], top - thickness / 2);
  group.add(slab);
  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x151417, roughness: .5, metalness: .4 });
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(.03, .03, top - thickness), legMaterial);
    leg.position.set(g.pos[0] + x * (sx - .04), g.pos[1] + y * (sy - .04), (top - thickness) / 2);
    group.add(leg);
  }
  group.traverse((o) => { if (o.isMesh) { o.castShadow = shadows; o.receiveShadow = shadows; } });
  return group;
}

// A pad's glow at take time t: a fast attack on each simulated contact, then an exponential tail.
export function padLevels(take, t, out = {}) {
  for (const k in out) out[k] = 0;
  const pad = PADS[take?.part];
  if (!pad) return out;
  let level = 0;
  for (const h of take.hits) {
    const dt = t - h;
    if (dt < 0) break;
    if (dt < .6) level = Math.max(level, Math.exp(-dt / .11));
  }
  out[pad] = level;
  return out;
}
