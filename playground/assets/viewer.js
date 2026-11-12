// The aquaBOT viewer: the robot built from its URDF and STL meshes, on a glass turntable, lit like a product shot.
// Rewritten from the original viewer.bundle.js (whose source wasn't kept) so it runs on the site's shared three.js
// instead of carrying its own copy. Behaviour is the same; shadows are three.js's standard PCF, as r187 has no
// separate "soft" mode. Used by playground/app.js (through window.AeroViewer) and the projects carousel.
import * as THREE from 'three';
import { STLLoader } from '../../assets/vendor/three/STLLoader.js';
import { RoomEnvironment } from '../../assets/vendor/three/RoomEnvironment.js';

const numbers = (value, fallback = '0 0 0') => (value || fallback).trim().split(/\s+/).map(Number);

// URDF origins: xyz, then roll-pitch-yaw about fixed axes.
function origin(object, element) {
  object.position.fromArray(numbers(element?.getAttribute('xyz')));
  const [roll, pitch, yaw] = numbers(element?.getAttribute('rpy'));
  object.quaternion.setFromEuler(new THREE.Euler(roll, pitch, yaw, 'ZYX'));
}

export function create(canvas, data) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, .005, 20);
  camera.up.set(0, 0, 1);
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, .035).texture;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe5fbff, 0x5b8294, .55));
  const key = new THREE.DirectionalLight(0xfffaf0, 1.8);
  key.position.set(.7, -.8, 1.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -.75, right: .75, top: .75, bottom: -.75, near: .01, far: 4 });
  key.shadow.bias = -15e-5;
  key.shadow.normalBias = .001;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8de8ff, .8);
  fill.position.set(-.7, .6, .8);
  scene.add(fill);

  // The turntable: a lacquered base, a pale top and two fine rings.
  const turntable = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.185, .19, .022, 128), new THREE.MeshPhysicalMaterial({ color: 0x4ed2e4, metalness: .35, roughness: .18, clearcoat: 1 }));
  base.rotation.x = Math.PI / 2;
  base.position.z = -.017;
  base.receiveShadow = true;
  turntable.add(base);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(.181, .181, .004, 128), new THREE.MeshPhysicalMaterial({ color: 0xd5faff, metalness: .12, roughness: .2, clearcoat: 1 }));
  top.rotation.x = Math.PI / 2;
  top.position.z = -.004;
  top.receiveShadow = true;
  turntable.add(top);
  for (const radius of [.175, .187]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, .0013, 10, 128), new THREE.MeshStandardMaterial({ color: 0xe9ffff, metalness: .5, roughness: .13 }));
    ring.position.z = -.003;
    turntable.add(ring);
  }
  scene.add(turntable);
  const axes = new THREE.AxesHelper(.085);
  axes.position.set(-.125, -.125, .002);
  scene.add(axes);

  const urdf = new DOMParser().parseFromString(data.urdf, 'application/xml');
  if (urdf.querySelector('parsererror')) throw Error('Invalid URDF XML');
  const links = {}, joints = {}, materials = {}, shells = [], loader = new STLLoader();
  for (const element of urdf.querySelectorAll('robot > material')) {
    const name = element.getAttribute('name');
    const rgba = numbers(element.querySelector('color')?.getAttribute('rgba'), '0.9 0.9 0.9 1');
    const look = data.appearance.materials[name] || {};
    const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setRGB(...rgba.slice(0, 3), THREE.SRGBColorSpace),
      roughness: look.roughness ?? .2, metalness: look.metalness ?? 0, clearcoat: 1, clearcoatRoughness: .07, envMapIntensity: .65,
      // The aqua shells are glass-like; their opacity slider changes this.
      transmission: name === 'aqua' ? .62 : 0, thickness: .002, ior: 1.45, attenuationDistance: .15, attenuationColor: new THREE.Color(0x94edee)
    });
    if (name === 'aqua') shells.push(material);
    materials[name] = material;
  }

  let meshCount = 0;
  for (const element of urdf.querySelectorAll('robot > link')) {
    const link = new THREE.Group();
    link.name = element.getAttribute('name');
    links[link.name] = link;
    for (const visual of element.querySelectorAll(':scope > visual')) {
      const meshElement = visual.querySelector('geometry > mesh');
      if (!meshElement) throw Error('Unsupported visual geometry');
      const file = meshElement.getAttribute('filename');
      if (!data.meshes[file]) throw Error('Missing mesh: ' + file);
      const binary = atob(data.meshes[file]), bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const geometry = loader.parse(bytes.buffer);
      geometry.computeBoundingBox();
      const mesh = new THREE.Mesh(geometry, materials[visual.querySelector('material').getAttribute('name')]);
      mesh.name = visual.getAttribute('name');
      origin(mesh, visual.querySelector('origin'));
      mesh.scale.fromArray(numbers(meshElement.getAttribute('scale'), '1 1 1'));
      mesh.castShadow = mesh.material.transmission === 0;
      mesh.receiveShadow = true;
      link.add(mesh);
      meshCount++;
    }
  }

  const children = new Set();
  for (const element of urdf.querySelectorAll('robot > joint')) {
    const frame = new THREE.Group();
    frame.name = element.getAttribute('name');
    origin(frame, element.querySelector('origin'));
    const parent = element.querySelector('parent').getAttribute('link'), child = element.querySelector('child').getAttribute('link');
    if (!links[parent] || !links[child]) throw Error('Missing joint link');
    links[parent].add(frame);
    frame.add(links[child]);
    children.add(child);
    const limit = element.querySelector('limit'), mimic = element.querySelector('mimic');
    joints[frame.name] = {
      frame, type: element.getAttribute('type'), child, parent,
      axis: new THREE.Vector3().fromArray(numbers(element.querySelector('axis')?.getAttribute('xyz'), '1 0 0')).normalize(),
      position: frame.position.clone(), quaternion: frame.quaternion.clone(),
      lower: Number(limit?.getAttribute('lower') || 0), upper: Number(limit?.getAttribute('upper') || 0), value: 0,
      mimic: mimic ? { joint: mimic.getAttribute('joint'), multiplier: Number(mimic.getAttribute('multiplier') || 1), offset: Number(mimic.getAttribute('offset') || 0) } : null
    };
  }
  const roots = Object.keys(links).filter((name) => !children.has(name));
  if (roots.length !== 1 || roots[0] !== 'base_link') throw Error('Invalid robot tree');
  const robot = links.base_link;
  scene.add(robot);

  const applied = {};
  function pose(values) {
    for (const [name, joint] of Object.entries(joints)) {
      if (joint.type === 'fixed') continue;
      const target = joint.mimic ? (values[joint.mimic.joint] ?? 0) * joint.mimic.multiplier + joint.mimic.offset : values[name] ?? 0;
      if (!Number.isFinite(target)) throw Error('Non-finite joint value');
      joint.value = Math.max(joint.lower, Math.min(joint.upper, target));
      applied[name] = joint.value;
      joint.frame.position.copy(joint.position);
      joint.frame.quaternion.copy(joint.quaternion);
      if (joint.type === 'revolute') joint.frame.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(joint.axis, joint.value));
      else if (joint.type === 'prismatic') joint.frame.position.add(joint.axis.clone().applyQuaternion(joint.quaternion).multiplyScalar(joint.value));
      else throw Error('Unsupported joint type: ' + joint.type);
    }
    scene.updateMatrixWorld(true);
  }

  let width = 1, height = 1;
  function resize(w, h) {
    width = w;
    height = h;
    renderer.setSize(w, h, false);
  }

  // view: { yaw, pitch, zoom, top }; panelOpen shifts the robot left of the controls; showAxes shows the axes.
  function draw(view, panelOpen, showAxes) {
    const pitch = view.top ? Math.PI / 2 - .001 : view.pitch;
    const distance = (width < 760 ? Math.max(1.08, 1.38 * (height / width) / (844 / 390)) : 1.08) / view.zoom;
    const target = new THREE.Vector3(.045, 0, .31), across = distance * Math.cos(pitch);
    camera.position.set(target.x + across * Math.cos(view.yaw), target.y + across * Math.sin(view.yaw), target.z + distance * Math.sin(pitch));
    camera.lookAt(target);
    camera.aspect = width / height;
    camera.setViewOffset(width, height, width > 760 && panelOpen ? 175 : 0, 0, width, height);
    camera.updateProjectionMatrix();
    axes.visible = showAxes;
    renderer.render(scene, camera);
  }

  // 0 = clear glass shells, 100 = opaque.
  function shellOpacity(percent) {
    const transmission = 1 - percent / 100;
    for (const material of shells) {
      if ((material.transmission === 0) !== (transmission === 0)) material.needsUpdate = true;
      material.transmission = transmission;
    }
  }

  function inspect() {
    scene.updateMatrixWorld(true);
    const world = Object.fromEntries(Object.entries(links).map(([name, link]) => [name, link.getWorldPosition(new THREE.Vector3()).toArray()]));
    const bounds = new THREE.Box3().setFromObject(robot);
    return {
      meshCount, linkCount: Object.keys(links).length, jointCount: Object.keys(joints).length, applied: { ...applied }, world,
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, transmission: shells[0]?.transmission, triangles: renderer.info.render.triangles
    };
  }

  pose({});
  return { joints, pose, resize, draw, shellOpacity, inspect };
}

// playground/app.js is a classic script and reads the viewer from here.
window.AeroViewer = { create };
