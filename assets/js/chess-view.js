import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';

// ChessBot on the projects stage: an OpenManipulator-X (ROBOTIS's model, assets/models/openmanipulator-x) playing the
// team's recorded game, Scholar's Mate in the Qf3 line, square by square from their board layout and move routine:
// approach, grasp, lift, carry, place, release, lift. The captured pawn is dropped beside the robot as their code
// did, the black king topples at mate, and the board resets.

const MODEL = 'assets/models/openmanipulator-x/';
const GAME = [['e2', 'e4'], ['e7', 'e5'], ['d1', 'f3'], ['b8', 'c6'], ['f1', 'c4'], ['f8', 'c5'], ['f7', null], ['f3', 'f7']];
const BACK_RANK = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
const HEIGHT = { pawn: .026, rook: .03, knight: .034, bishop: .036, queen: .042, king: .046 };
const GRIP = { pawn: .0062, rook: .0068, knight: .0062, bishop: .006, queen: .0064, king: .0066 };
// The fingers only ever open a little past the piece they're after (1.5 mm a side), like the real gripper, so they
// fit between the neighbouring pieces on 19 mm squares.
const BOARD_TOP = .006, LIFT = .045, PALM = .0089, CLEARANCE = .0015;
// The team's coordinates (main.py): board corners (7.6, 21.2) and (-7.6, 6) cm, the robot at the origin facing +y.
// In the URDF the robot faces +x with its yaw axis 12 mm forward of the base origin.
const square = (name) => {
  const file = name.charCodeAt(0) - 97, rank = +name[1] - 1;
  return new THREE.Vector3(.012 + (21.2 - (rank + .5) * 1.9) / 100, -(7.6 - (file + .5) * 1.9) / 100, BOARD_TOP);
};
const DROP = new THREE.Vector3(.012, -.1, 0);   // their (10, 0): beside the robot, off the board
const HOME = new THREE.Vector3(.12, 0, .12);
const ease = (t) => t * t * (3 - 2 * t);

// Closed form for the arm with the tool pointing straight down (build.py checks it against the URDF chain).
function solve(tip, q) {
  const r = Math.hypot(tip.x - .012, tip.y), wz = tip.z + .126 - .0595;
  const la = Math.hypot(.024, .128), lb = .124, d = Math.hypot(r, wz);
  const pa = Math.atan2(wz, r) + Math.acos(Math.max(-1, Math.min(1, (la * la + d * d - lb * lb) / (2 * la * d))));
  const pb = Math.atan2(wz - la * Math.sin(pa), r - la * Math.cos(pa));
  q.joint1 = Math.atan2(tip.y, tip.x - .012);
  q.joint2 = Math.atan2(.128, .024) - pa;
  q.joint3 = -pb - q.joint2;
  q.joint4 = Math.PI / 2 + pb;
  return q;
}

async function loadModel(base) {
  const [desc, blob] = await Promise.all([
    fetch(new URL(MODEL + 'omx.json', base)).then((r) => { if (!r.ok) throw new Error('model'); return r.json(); }),
    fetch(new URL(MODEL + 'omx.bin', base)).then((r) => { if (!r.ok) throw new Error('model'); return r.arrayBuffer(); })
  ]);
  const geometries = desc.meshes.map((m) => {
    const n = m.vertices, packed = new Int16Array(blob, m.offset, n * 3), positions = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) positions[i] = m.min[i % 3] + (packed[i] + 32768) / 65535 * (m.max[i % 3] - m.min[i % 3]);
    let at = m.offset + n * 9;
    at += at % 2;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(blob, m.offset + n * 6, n * 3), 3, true));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(blob, at, m.faces * 3), 1));
    return g;
  });
  return { desc, geometries };
}

// The team's printed fingers (report-005.png) in place of ROBOTIS's palms: a mounting plate on each slider and a
// tapered fin with a small lip at its tip. In a palm's frame x runs to the fingertip and the inner face sits where
// the stock palm's does (y = -12.1 mm on the left), so the gripper's open and closed values are unchanged.
function prism(x0, x1, [in0, out0, w0], [in1, out1, w1], mirror) {
  const s = mirror ? -1 : 1, v = [];
  const corners = [[x0, in0, -w0], [x0, out0, -w0], [x0, out0, w0], [x0, in0, w0], [x1, in1, -w1], [x1, out1, -w1], [x1, out1, w1], [x1, in1, w1]];
  const faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  for (const [a, b, c, d] of faces) for (const i of [a, b, c, a, c, d]) v.push(corners[i][0], corners[i][1] * s, corners[i][2]);
  if (mirror) for (let i = 0; i < v.length; i += 9) for (let k = 0; k < 3; k++) [v[i + 3 + k], v[i + 6 + k]] = [v[i + 6 + k], v[i + 3 + k]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
function finger(material, mirror) {
  const group = new THREE.Group(), y = -.0121;
  for (const g of [
    prism(-.003, 0, [-.012, .016, .014], [-.012, .016, .014], mirror),          // mounting plate
    prism(0, .056, [y, y + .006, .005], [y, y + .003, .0035], mirror),         // tapered fin, slim enough to pass neighbours
    prism(.056, .062, [y - .0012, y + .003, .0035], [y - .0012, y + .003, .0035], mirror)   // lip
  ]) {
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function buildRobot({ desc, geometries }, materials) {
  const links = new Map(desc.links.map((l) => [l.name, new THREE.Group()]));
  links.get('gripper_left_link').add(finger(materials.gripper, false));
  links.get('gripper_right_link').add(finger(materials.gripper, true));
  for (const link of desc.links) {
    for (const v of link.visuals) {
      const mesh = new THREE.Mesh(geometries[v.mesh], materials.robot);
      mesh.position.fromArray(v.xyz);
      mesh.quaternion.setFromEuler(new THREE.Euler(...v.rpy, 'ZYX'));
      mesh.castShadow = mesh.receiveShadow = true;
      links.get(link.name).add(mesh);
    }
  }
  const joints = new Map();
  for (const j of desc.joints) {
    const frame = new THREE.Group();
    frame.position.fromArray(j.xyz);
    frame.quaternion.setFromEuler(new THREE.Euler(...j.rpy, 'ZYX'));
    links.get(j.parent).add(frame);
    frame.add(links.get(j.child));
    joints.set(j.name, { ...j, frame, rest: frame.quaternion.clone(), at: frame.position.clone(), axisV: new THREE.Vector3(...j.axis) });
  }
  const spin = new THREE.Quaternion();
  return {
    root: links.get('world'),
    pose(q) {
      for (const j of joints.values()) {
        const value = j.mimic ? (q[j.mimic.joint] || 0) * j.mimic.multiplier : q[j.name] || 0;
        if (j.type === 'revolute') j.frame.quaternion.copy(j.rest).multiply(spin.setFromAxisAngle(j.axisV, value));
        else if (j.type === 'prismatic') j.frame.position.copy(j.at).addScaledVector(j.axisV, value);
      }
    }
  };
}

// Turned pieces, Staunton proportions for a 19 mm square. Profiles are (radius, height) from the base up.
function lathe(points) {
  const g = new THREE.LatheGeometry(points.map(([r, z]) => new THREE.Vector2(r, z)), 40);
  return g.rotateX(Math.PI / 2);
}
function arc(cx, cz, r, from, to, n = 8) {
  return Array.from({ length: n + 1 }, (_, i) => { const a = from + (to - from) * i / n; return [cx + r * Math.cos(a), cz + r * Math.sin(a)]; });
}
function base(r, top) {
  return [[0, 0], [r, 0], [r, .0016], [r - .0008, .0026], [r - .0012, .0031], [r - .0022, .0042], [top, .0062]];
}
function pieceGeometries() {
  const pawn = lathe([...base(.0072, .0042), [.0031, .0125], [.0027, .0156], [.0046, .0164], [.0046, .0173], [.0025, .018],
    ...arc(0, .0214, .0044, -Math.PI / 2 + .55, Math.PI / 2)]);
  const rook = lathe([...base(.0076, .0052), [.0043, .021], [.0042, .0236], [.0058, .0245], [.0058, .03], [.0043, .03], [.0043, .0284], [0, .0284]]);
  const bishop = lathe([...base(.0074, .0044), [.0026, .0205], [.0049, .0214], [.0049, .0223], [.0024, .0229],
    ...arc(0, .0283, .0046, -Math.PI / 2 + .45, Math.PI / 2 - .5, 10), [.0012, .0328], ...arc(0, .0344, .0016, -Math.PI / 2 + .3, Math.PI / 2, 6)]);
  const queen = lathe([...base(.0078, .0046), [.0028, .0255], [.0052, .0264], [.0052, .0273], [.0027, .028], [.0032, .031],
    [.0059, .0362], [.0054, .0372], [.0038, .0378], ...arc(0, .0388, .0022, -Math.PI / 2 + .6, Math.PI / 2, 6)]);
  const king = lathe([...base(.008, .0048), [.003, .0265], [.0054, .0275], [.0054, .0284], [.0029, .029], [.0034, .0322],
    [.0056, .0372], [.0052, .0382], [0, .0382]]);
  const cross = [new THREE.BoxGeometry(.0018, .0018, .0072).translate(0, 0, .0418), new THREE.BoxGeometry(.0018, .0056, .0018).translate(0, 0, .0425)];
  const knightBase = lathe([...base(.0074, .005), [.0056, .0102], [0, .0102]]);
  // The head is a side profile pushed out to the piece's width: forward is +x, up is +z.
  const s = new THREE.Shape();
  [[-.0056, .0096], [.0052, .0096], [.0058, .0158], [.0066, .0198], [.0084, .0248], [.0091, .0278], [.0076, .0303], [.0038, .031],
    [.0014, .0342], [-.0006, .0314], [-.0042, .0298], [-.0058, .0236], [-.0062, .0156]].forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  const head = new THREE.ExtrudeGeometry(s, { depth: .0062, bevelEnabled: true, bevelThickness: .0009, bevelSize: .0007, bevelSegments: 2, curveSegments: 4 })
    .rotateX(Math.PI / 2).translate(0, .0031, 0);
  return { pawn: [pawn], rook: [rook], bishop: [bishop], queen: [queen], king: [king, ...cross], knight: [knightBase, head] };
}

// A folding travel board: walnut frame, maple and walnut squares with a little grain, a hinge line between the halves.
function buildBoard() {
  const size = 512, data = new Uint8Array(size * size * 4), light = [222, 188, 138], dark = [128, 80, 46];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const iu = Math.floor(x / 64), iv = Math.floor(y / 64), file = iv, rank = 7 - iu, isDark = (file + rank) % 2 === 0;
    const along = isDark ? x : y, across = isDark ? y : x;
    const grain = .93 + .05 * Math.sin(across * .9 + Math.sin(along * .045 + iu * 7 + iv * 3) * 2.4) + .02 * Math.sin(across * 3.1 + along * .2);
    const c = isDark ? dark : light, i = (y * size + x) * 4;
    data[i] = c[0] * grain; data[i + 1] = c[1] * grain; data[i + 2] = c[2] * grain; data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  const centre = square('d4').add(square('e5')).multiplyScalar(.5), group = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(.176, .176, BOARD_TOP), new THREE.MeshStandardMaterial({ color: 0x4a2c19, roughness: .5 }));
  frame.position.set(centre.x, centre.y, BOARD_TOP / 2);
  const play = new THREE.Mesh(new THREE.PlaneGeometry(.152, .152), new THREE.MeshPhysicalMaterial({ map: tex, roughness: .42, clearcoat: .35, clearcoatRoughness: .35 }));
  play.position.set(centre.x, centre.y, BOARD_TOP + .0002);
  const hinge = new THREE.Mesh(new THREE.BoxGeometry(.0007, .176, .0004), new THREE.MeshBasicMaterial({ color: 0x24150c }));
  hinge.position.set(centre.x, centre.y, BOARD_TOP + .0004);
  for (const m of [frame, play]) m.receiveShadow = true;
  frame.castShadow = true;
  group.add(frame, play, hinge);
  return group;
}

// The game as timed waypoints for the gripper tip, with what happens to the pieces along the way.
function timeline(pieces) {
  const at = new Map(pieces.map((p) => [p.home, p]));
  const firstOpen = GRIP[at.get(GAME[0][0]).type] - PALM + CLEARANCE;
  const keys = [{ t: 0, tip: HOME.clone(), grip: firstOpen }], events = [];
  let t = 0, open = firstOpen;
  const go = (tip, grip, kind = 'travel') => {
    const last = keys[keys.length - 1], d = last.tip.distanceTo(tip);
    t += kind === 'travel' ? .28 + d / .3 : kind === 'grip' ? .24 : .26 + d / .22;
    keys.push({ t, tip: tip.clone(), grip });
  };
  for (const [from, to] of GAME) {
    const piece = at.get(from), z = BOARD_TOP + Math.max(.022, HEIGHT[piece.type] * .6), closed = GRIP[piece.type] - PALM;
    const p = square(from).setZ(z), up = p.clone().setZ(z + LIFT);
    open = closed + CLEARANCE;
    go(up, open); go(p, open, 'vertical'); go(p, closed, 'grip');
    events.push({ t, piece, kind: 'pick', offset: z - BOARD_TOP });
    go(up, closed, 'vertical');
    if (to) {
      const q = square(to).setZ(z), qUp = q.clone().setZ(z + LIFT);
      go(qUp, closed); go(q, closed, 'vertical');
      events.push({ t, piece, kind: 'place', square: to });
      go(q, open, 'grip'); go(qUp, open, 'vertical');
      at.delete(from); at.set(to, piece);
    } else {
      go(DROP.clone().setZ(z + LIFT), closed);
      events.push({ t, piece, kind: 'drop' });
      go(DROP.clone().setZ(z + LIFT), open, 'grip');
      at.delete(from);
    }
  }
  go(HOME, open);
  const mate = t + .2;
  events.push({ t: mate, piece: at.get('e8'), kind: 'topple' });
  return { keys, events, mate, end: mate + 3.4, reset: mate + 4.4 };
}

export async function createChessView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0, 0);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, .04).texture;
  scene.environmentIntensity = .55;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8580, .7));
  const key = new THREE.DirectionalLight(0xfff6ea, 2.2);
  key.position.set(.45, -.4, .75);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1536, 1536);
  Object.assign(key.shadow.camera, { left: -.3, right: .3, top: .3, bottom: -.3, near: .1, far: 2 });
  key.shadow.normalBias = .004;
  key.shadow.radius = 3;
  const fill = new THREE.DirectionalLight(0xdfe8ff, .7);
  fill.position.set(-.3, .5, .4);
  scene.add(key, key.target, fill);

  const model = await loadModel(document.baseURI);
  const materials = {
    robot: new THREE.MeshStandardMaterial({ color: 0x161618, roughness: .42, metalness: .2 }),
    gripper: new THREE.MeshStandardMaterial({ color: 0xf0661f, roughness: .5 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xeceae6, roughness: .72 }),
    light: new THREE.MeshPhysicalMaterial({ color: 0xe8c896, roughness: .4, clearcoat: .6, clearcoatRoughness: .3 }),
    dark: new THREE.MeshPhysicalMaterial({ color: 0x4a2216, roughness: .34, clearcoat: .65, clearcoatRoughness: .28 })
  };
  const robot = buildRobot(model, materials);
  const plate = new THREE.Mesh(model.geometries[model.desc.plate], materials.plate);
  plate.receiveShadow = true;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.ShadowMaterial({ opacity: .16 }));
  ground.position.set(.13, 0, -.0081);
  ground.receiveShadow = true;

  const shapes = pieceGeometries(), pieces = [];
  const place = (type, home, white) => {
    const group = new THREE.Group();
    for (const g of shapes[type]) {
      const m = new THREE.Mesh(g, white ? materials.light : materials.dark);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
    if (type === 'knight') group.rotation.z = white ? Math.PI : 0;   // knights face the other side
    pieces.push({ type, home, white, group, turn: group.rotation.z });
  };
  BACK_RANK.forEach((type, f) => {
    const file = 'abcdefgh'[f];
    place(type, `${file}1`, true); place('pawn', `${file}2`, true);
    place('pawn', `${file}7`, false); place(type, `${file}8`, false);
  });
  const world = new THREE.Group(), pivot = new THREE.Group(), spin = new THREE.Group();
  world.add(robot.root, plate, ground, buildBoard(), ...pieces.map((p) => p.group));
  pivot.add(world);
  spin.add(pivot);
  scene.add(spin);
  pivot.position.set(-.13, 0, -.07);

  const plan = timeline(pieces);
  const q = {}, tip = new THREE.Vector3(), camera = new THREE.PerspectiveCamera(30, 1, .01, 10);
  camera.up.set(0, 0, 1);
  const dir = new THREE.Vector3(.95, -.62, .62).normalize(), radius = .27;
  let clock = performance.now();

  function arm(t) {
    const k = plan.keys;
    let i = 1;
    while (i < k.length - 1 && k[i].t < t) i++;
    const a = k[i - 1], b = k[i], s = ease(Math.min(1, Math.max(0, (t - a.t) / Math.max(1e-6, b.t - a.t))));
    tip.lerpVectors(a.tip, b.tip, s);
    q.gripper_left_joint = a.grip + (b.grip - a.grip) * s;
    solve(tip, q);
    robot.pose(q);
  }

  function board(t) {
    const squareOf = new Map(pieces.map((p) => [p, p.home]));
    const held = new Map(), dropped = new Map();
    let toppled = 0;
    for (const e of plan.events) {
      if (e.t > t) break;
      if (e.kind === 'pick') held.set(e.piece, e.offset);
      else if (e.kind === 'place') { held.delete(e.piece); squareOf.set(e.piece, e.square); }
      else if (e.kind === 'drop') { held.delete(e.piece); squareOf.delete(e.piece); dropped.set(e.piece, t - e.t); }
      else if (e.kind === 'topple') toppled = Math.min(1, (t - e.t) / .9);
    }
    // Between mate and the loop, everything shrinks away and pops back one piece at a time.
    const out = t > plan.end ? Math.min(1, (t - plan.end) / .35) : 0;
    for (const [n, p] of pieces.entries()) {
      const g = p.group;
      g.rotation.set(0, 0, p.turn);
      if (held.has(p)) g.position.copy(tip).setZ(tip.z - held.get(p));
      else if (dropped.has(p)) {
        // Falls from the gripper to the plate and rolls onto its side.
        const f = Math.min(1, dropped.get(p) / .45), from = DROP.clone().setZ(BOARD_TOP + LIFT);
        g.position.set(DROP.x, DROP.y, from.z * (1 - f * f) + .0068 * f * f);
        g.rotation.set(0, -Math.PI / 2 * ease(f), p.turn);
      } else g.position.copy(square(squareOf.get(p)));
      if (p.type === 'king' && !p.white && toppled) {
        // Tips over about the rim of its base, away from the queen on f7.
        const a = ease(toppled) * 1.48, pivotPoint = square('e8').add(new THREE.Vector3(-.008, 0, 0));
        const rel = g.position.clone().sub(pivotPoint).applyAxisAngle(new THREE.Vector3(0, 1, 0), -a);
        g.position.copy(pivotPoint).add(rel);
        g.rotation.set(0, -a, p.turn);
      }
      const back = t < .9 ? ease(Math.min(1, Math.max(0, (t - n * .012) / .5))) : 1;
      g.scale.setScalar(Math.max(.0001, t > plan.end ? 1 - ease(out) : back));
    }
  }

  return {
    resize(w, h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
    replay() { clock = performance.now(); },
    draw(yawDeg, tiltDeg) {
      const t = ((performance.now() - clock) / 1000) % plan.reset;
      arm(t);
      board(t);
      spin.rotation.z = THREE.MathUtils.degToRad(yawDeg);
      const v = dir.clone();
      v.z += THREE.MathUtils.degToRad(tiltDeg) * .8;
      camera.position.copy(v.normalize().multiplyScalar(radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))));
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    }
  };
}
