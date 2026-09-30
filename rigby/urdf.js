import * as THREE from 'three';
import { STLLoader } from '../assets/vendor/three/STLLoader.js';

const vector = (value, fallback = '0 0 0') => (value || fallback).trim().split(/\s+/).map(Number);

function origin(object, element) {
  object.position.fromArray(vector(element?.getAttribute('xyz')));
  object.quaternion.setFromEuler(new THREE.Euler(...vector(element?.getAttribute('rpy')), 'ZYX'));
}

// Read the supplied visual geometry and kinematic tree without altering the URDF.
export async function loadRobot(url, meshBase, progress = () => {}) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the robot (${response.status}).`);
  const document = new DOMParser().parseFromString(await response.text(), 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('The robot description is invalid.');
  const robot = document.documentElement;
  const links = new Map();
  const joints = new Map();
  const materials = new Map();
  const geometries = new Map();
  const loader = new STLLoader();
  const visuals = [...robot.querySelectorAll('link > visual')];
  let loaded = 0;

  function material(element) {
    const name = element?.getAttribute('name');
    const color = element?.querySelector('color');
    if (!color && materials.has(name)) return materials.get(name);
    const rgba = vector(color?.getAttribute('rgba'), '.7 .7 .68 1');
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(...rgba.slice(0, 3), THREE.SRGBColorSpace),
      roughness: .56, metalness: .12, opacity: rgba[3], transparent: rgba[3] < 1
    });
  }

  for (const element of robot.querySelectorAll(':scope > material')) {
    materials.set(element.getAttribute('name'), material(element));
  }

  for (const element of robot.querySelectorAll(':scope > link')) {
    const group = new THREE.Group();
    group.name = element.getAttribute('name');
    if (links.has(group.name)) throw new Error(`Duplicate link: ${group.name}`);
    links.set(group.name, group);
  }

  await Promise.all(visuals.map(async visual => {
    const mesh = visual.querySelector('geometry > mesh');
    const box = visual.querySelector('geometry > box');
    let geometry;
    if (mesh) {
      const filename = mesh.getAttribute('filename');
      const meshURL = new URL(filename, meshBase).href;
      if (!geometries.has(meshURL)) geometries.set(meshURL, loader.loadAsync(meshURL));
      geometry = await geometries.get(meshURL);
    } else if (box) {
      geometry = new THREE.BoxGeometry(...vector(box.getAttribute('size')));
    } else throw new Error('Unsupported visual geometry.');
    const object = new THREE.Mesh(geometry, material(visual.querySelector('material')));
    object.name = visual.getAttribute('name') || visual.parentElement.getAttribute('name');
    origin(object, visual.querySelector('origin'));
    if (mesh) object.scale.fromArray(vector(mesh.getAttribute('scale'), '1 1 1'));
    object.castShadow = true;
    object.receiveShadow = true;
    links.get(visual.parentElement.getAttribute('name')).add(object);
    progress(++loaded, visuals.length);
  }));

  const children = new Set();
  for (const element of robot.querySelectorAll(':scope > joint')) {
    const name = element.getAttribute('name');
    const parent = element.querySelector('parent').getAttribute('link');
    const child = element.querySelector('child').getAttribute('link');
    if (!links.has(parent) || !links.has(child) || children.has(child)) throw new Error('Invalid robot hierarchy.');
    const frame = new THREE.Group();
    frame.name = name;
    origin(frame, element.querySelector('origin'));
    links.get(parent).add(frame);
    frame.add(links.get(child));
    children.add(child);
    const limit = element.querySelector('limit');
    const mimic = element.querySelector('mimic');
    const type = element.getAttribute('type');
    joints.set(name, {
      name, type, parent, child, frame, value: 0,
      axis: new THREE.Vector3().fromArray(vector(element.querySelector('axis')?.getAttribute('xyz'), '1 0 0')).normalize(),
      position: frame.position.clone(), quaternion: frame.quaternion.clone(),
      lower: type === 'continuous' ? -Infinity : Number(limit?.getAttribute('lower') || 0),
      upper: type === 'continuous' ? Infinity : Number(limit?.getAttribute('upper') || 0),
      mimic: mimic ? {
        joint: mimic.getAttribute('joint'),
        multiplier: Number(mimic.getAttribute('multiplier') ?? 1),
        offset: Number(mimic.getAttribute('offset') ?? 0)
      } : null
    });
  }
  const roots = [...links.keys()].filter(name => !children.has(name));
  if (roots.length !== 1) throw new Error('The robot must have one root link.');
  const root = links.get(roots[0]);
  const reachable = new Set();
  root.traverse(object => { if (links.get(object.name) === object) reachable.add(object.name); });
  if (reachable.size !== links.size) throw new Error('The robot contains disconnected links.');

  function pose(values = {}) {
    const resolved = new Map();
    const resolving = new Set();
    function resolve(joint) {
      if (resolved.has(joint.name)) return resolved.get(joint.name);
      if (resolving.has(joint.name)) throw new Error('Cyclic mimic joint.');
      resolving.add(joint.name);
      let value = values[joint.name] ?? 0;
      if (joint.mimic) {
        const source = joints.get(joint.mimic.joint);
        if (!source) throw new Error('Missing mimic joint.');
        value = resolve(source) * joint.mimic.multiplier + joint.mimic.offset;
      }
      if (!Number.isFinite(value)) throw new Error('Invalid joint position.');
      value = THREE.MathUtils.clamp(value, joint.lower, joint.upper);
      resolved.set(joint.name, value);
      resolving.delete(joint.name);
      return value;
    }
    for (const joint of joints.values()) {
      if (joint.type === 'fixed') continue;
      joint.value = resolve(joint);
      joint.frame.position.copy(joint.position);
      joint.frame.quaternion.copy(joint.quaternion);
      if (joint.type === 'revolute' || joint.type === 'continuous') {
        joint.frame.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(joint.axis, joint.value));
      } else if (joint.type === 'prismatic') {
        joint.frame.position.add(joint.axis.clone().applyQuaternion(joint.quaternion).multiplyScalar(joint.value));
      } else throw new Error(`Unsupported joint type: ${joint.type}`);
    }
    root.updateMatrixWorld(true);
  }

  pose();
  return { root, links, joints, pose, meshCount: visuals.length };
}
