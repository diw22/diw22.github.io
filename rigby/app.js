import * as THREE from 'three';
import { OrbitControls } from '../assets/vendor/three/OrbitControls.js';
import { loadRobot } from './urdf.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#environment');
const panel = $('#pose-panel');
const restore = $('#controls-restore');
const compact = matchMedia('(max-width: 760px), (max-height: 500px)');
let robot, renderer, scene, camera, orbit, stage;
let renderFrame = 0, animationFrame = 0, playing = false, topView = false;
let controls = [];
const values = {};
const degrees = value => THREE.MathUtils.radToDeg(value);
const radians = value => THREE.MathUtils.degToRad(value);
const groups = {
  left: [
    ...Array.from({ length: 7 }, (_, i) => ({ id: `left_arm_rev_motor_0${i + 1}`, label: `Joint ${i + 1}` })),
    { id: 'left_arm_rev_motor_08', label: 'Gripper', unit: '%' }
  ],
  right: [
    { id: 'Rotation', label: 'Base rotation' },
    { id: 'Pitch', label: 'Shoulder pitch' },
    { id: 'Elbow', label: 'Elbow pitch' },
    { id: 'Wrist_Pitch', label: 'Wrist pitch' },
    { id: 'Wrist_Roll', label: 'Wrist roll' },
    { id: 'right_arm_rev_motor_08', label: 'Gripper', unit: '%' }
  ],
  base: [
    { id: 'root_x_axis_joint', label: 'Forward / back', unit: 'm', min: -.5, max: .5 },
    { id: 'root_y_axis_joint', label: 'Side to side', unit: 'm', min: -.5, max: .5 },
    { id: 'root_z_rotation_joint', label: 'Rotation' }
  ]
};

function toast(message) {
  clearTimeout(toast.timer);
  $('#toast').textContent = message;
  $('#toast').classList.add('is-visible');
  toast.timer = setTimeout(() => $('#toast').classList.remove('is-visible'), 2500);
}

function setControlsVisible(visible) {
  const transferFocus = visible ? document.activeElement === restore : panel.contains(document.activeElement);
  document.body.classList.toggle('controls-hidden', !visible);
  const focusTarget = visible ? panel : restore;
  focusTarget.inert = false;
  focusTarget.setAttribute('aria-hidden', 'false');
  if (transferFocus) (visible ? $('#controls-toggle') : restore).focus({ preventScroll: true });
  panel.inert = !visible;
  panel.setAttribute('aria-hidden', String(!visible));
  $('#controls-toggle').setAttribute('aria-expanded', String(visible));
  restore.inert = visible;
  restore.setAttribute('aria-hidden', String(visible));
  restore.setAttribute('aria-expanded', String(visible));
}

$('#controls-toggle').addEventListener('click', () => setControlsVisible(false));
restore.addEventListener('click', () => setControlsVisible(true));
$('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  setControlsVisible(true);
  panel.focus({ preventScroll: true });
});
setControlsVisible(true);
requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('controls-ready')));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !panel.inert && !document.fullscreenElement) {
    setControlsVisible(false);
    restore.focus({ preventScroll: true });
  }
});

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  const previous = tabs.find(item => item.getAttribute('aria-selected') === 'true');
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
  }
  $('.joint-panels').scrollTop = 0;
  if (previous !== tab && (previous.id === 'tab-base' || tab.id === 'tab-base')) resetCamera();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
    if (event.key === 'ArrowLeft') next = tabs[(index + tabs.length - 1) % tabs.length];
    if (event.key === 'Home') next = tabs[0];
    if (event.key === 'End') next = tabs.at(-1);
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    next.focus();
  });
});

function requestRender() {
  if (renderFrame || !renderer) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    renderer.render(scene, camera);
  });
}

function applyPose() {
  // Keep the camera and ground fixed so base translation is visible.
  robot.pose(values);
  requestRender();
}

function format(control, value) {
  return `${value.toFixed(control.unit === 'm' ? 2 : control.unit === '%' ? 0 : 1)}${control.unit}`;
}

function displayValue(control) {
  const value = values[control.id];
  if (control.unit === '%') return (value - control.joint.lower) / (control.joint.upper - control.joint.lower) * 100;
  return control.unit === 'm' ? value : degrees(value);
}

function setValue(control, value) {
  values[control.id] = control.unit === '%' ? THREE.MathUtils.lerp(control.joint.lower, control.joint.upper, value / 100)
    : control.unit === 'm' ? value : radians(value);
}

function updateControls() {
  for (const control of controls) {
    const value = displayValue(control);
    control.input.value = value;
    control.output.textContent = format(control, value);
    control.input.setAttribute('aria-valuetext', format(control, value));
  }
}

function buildControls() {
  for (const [group, definitions] of Object.entries(groups)) {
    const container = $(`#joints-${group}`);
    definitions.forEach((definition, index) => {
      const joint = robot.joints.get(definition.id);
      if (!joint || joint.mimic) throw new Error(`Missing control joint: ${definition.id}`);
      const unit = definition.unit || '°';
      // Limit the playground's travel without changing the supplied URDF.
      const min = unit === '%' ? 0 : unit === 'm' ? Math.max(joint.lower, definition.min ?? joint.lower) : joint.type === 'continuous' ? -180 : degrees(joint.lower);
      const max = unit === '%' ? 100 : unit === 'm' ? Math.min(joint.upper, definition.max ?? joint.upper) : joint.type === 'continuous' ? 180 : degrees(joint.upper);
      const control = { ...definition, unit, joint, group, min, max };
      values[control.id] = THREE.MathUtils.clamp(0, joint.lower, joint.upper);
      const row = document.createElement('div');
      row.className = 'joint-control';
      row.innerHTML = `<div class="joint-heading"><label for="${control.id}"><span class="joint-index">${unit === '%' ? 'G' : `J${index + 1}`}</span>${control.label}</label><output for="${control.id}"></output></div>
        <input id="${control.id}" type="range" min="${min}" max="${max}" step="any" value="0">
        <div class="range-labels"><span>${unit === '%' ? 'Closed' : format(control, min)}</span><span>${unit === '%' ? 'Open' : format(control, max)}</span></div>`;
      container.append(row);
      control.input = row.querySelector('input');
      control.output = row.querySelector('output');
      control.input.addEventListener('input', () => {
        stopPlaying();
        setValue(control, Number(control.input.value));
        applyPose();
        updateControls();
      });
      controls.push(control);
    });
  }
  updateControls();
}

function resetCamera() {
  if (!robot) return;
  const bounds = new THREE.Box3().setFromObject(robot.root);
  if ($('#tab-base').getAttribute('aria-selected') === 'true') {
    // Frame the whole travel area once; moving the sliders keeps this view fixed.
    const base = robot.links.get('base_link').getWorldPosition(new THREE.Vector3());
    bounds.translate(new THREE.Vector3(-base.x, -base.y, 0));
    const travelX = controls.find(control => control.id === 'root_x_axis_joint');
    const travelY = controls.find(control => control.id === 'root_y_axis_joint');
    bounds.min.x += travelX.min;
    bounds.max.x += travelX.max;
    bounds.min.y += travelY.min;
    bounds.max.y += travelY.max;
  }
  const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
  const vertical = radians(camera.fov);
  const { width, height } = canvas.getBoundingClientRect();
  // Reserve the drawer's space at both endpoints so sliding it never changes zoom.
  const panelGap = parseFloat(getComputedStyle($('.playground-stage')).getPropertyValue('--panel-gap'));
  const reservedWidth = compact.matches ? 0 : panel.getBoundingClientRect().width + panelGap;
  const tanVertical = Math.tan(vertical / 2) * Math.max(.45, (height - 48) / height);
  const tanHorizontal = Math.tan(vertical / 2) * camera.aspect * Math.max(.2, (width - reservedWidth - 40) / width);
  const centre = bounds.getCenter(new THREE.Vector3());
  const direction = (topView ? new THREE.Vector3(0, -.001, 1) : new THREE.Vector3(1.7, -2.4, 1.4)).normalize();
  const right = camera.up.clone().cross(direction).normalize();
  const up = direction.clone().cross(right).normalize();
  // Fit the actual projected box, so the tall robot stays readable on phones.
  let distance = 0;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const point = new THREE.Vector3(x, y, z).sub(centre);
    distance = Math.max(distance, Math.abs(point.dot(right)) / tanHorizontal + point.dot(direction), Math.abs(point.dot(up)) / tanVertical + point.dot(direction));
  }
  distance *= 1.08;
  orbit.target.copy(centre);
  camera.position.copy(orbit.target).addScaledVector(direction, distance);
  orbit.minDistance = radius * .5;
  orbit.maxDistance = distance * 4;
  orbit.update();
  requestRender();
}

$('#reset-camera').addEventListener('click', () => {
  topView = false;
  $('#camera-mode').setAttribute('aria-pressed', 'false');
  resetCamera();
});
$('#camera-mode').addEventListener('click', () => {
  topView = !topView;
  $('#camera-mode').setAttribute('aria-pressed', String(topView));
  resetCamera();
});
$('#fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { toast('Fullscreen is unavailable in this browser.'); }
});
document.addEventListener('fullscreenchange', () => {
  $('#fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
});
$('#retry').addEventListener('click', () => location.reload());

function stopPlaying() {
  playing = false;
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  $('#animate').textContent = 'Play';
  $('#animate').setAttribute('aria-pressed', 'false');
}

$('#animate').addEventListener('click', () => {
  if (playing) { stopPlaying(); return; }
  const start = performance.now();
  const initial = { ...values };
  playing = true;
  $('#animate').textContent = 'Pause';
  $('#animate').setAttribute('aria-pressed', 'true');
  function animate(time) {
    if (!playing) return;
    const seconds = (time - start) / 1000;
    const t = Math.min(1, seconds / 2);
    const blend = t * t * t * (10 + t * (-15 + 6 * t));
    controls.forEach((control, i) => {
      if (control.group === 'base') return;
      const joint = control.joint;
      const centre = THREE.MathUtils.clamp(0, joint.lower + (joint.upper - joint.lower) * .25, joint.upper - (joint.upper - joint.lower) * .25);
      const amplitude = (joint.upper - joint.lower) * (control.unit === '%' ? .45 : .16);
      const target = (control.unit === '%' ? (joint.lower + joint.upper) / 2 : centre) + amplitude * Math.sin(seconds * .5 + i * .6);
      values[control.id] = THREE.MathUtils.clamp(THREE.MathUtils.lerp(initial[control.id], target, blend), joint.lower, joint.upper);
    });
    applyPose();
    updateControls();
    animationFrame = requestAnimationFrame(animate);
  }
  animationFrame = requestAnimationFrame(animate);
});

$('#reset-joints').addEventListener('click', () => {
  stopPlaying();
  for (const control of controls) values[control.id] = THREE.MathUtils.clamp(0, control.joint.lower, control.joint.upper);
  applyPose();
  updateControls();
  toast('Pose reset.');
});

$('#copy-pose').addEventListener('click', async () => {
  const text = JSON.stringify({
    model: 'rigby', source: 'urdf/rigby.urdf',
    units: { revolute: 'radians', continuous: 'radians', prismatic: 'metres' },
    joints: Object.fromEntries([...robot.joints].filter(([, joint]) => joint.type !== 'fixed').map(([id, joint]) => [id, joint.value]))
  }, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    toast('Pose copied.');
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    document.body.append(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    $('#copy-pose').focus();
    toast(copied ? 'Pose copied.' : 'Could not copy this pose.');
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlaying(); });
window.addEventListener('pagehide', stopPlaying);

async function init() {
  let loading = true;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.setClearColor(0, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, .01, 200);
    camera.up.set(0, 0, 1);
    camera.position.set(2, -3, 2);
    orbit = new OrbitControls(camera, canvas);
    orbit.maxPolarAngle = Math.PI * .49;
    orbit.listenToKeyEvents(canvas);
    orbit.addEventListener('change', requestRender);
    orbit.addEventListener('start', () => {
      topView = false;
      $('#camera-mode').setAttribute('aria-pressed', 'false');
    });
    canvas.addEventListener('keydown', event => {
      if (event.key === 'Home') { event.preventDefault(); resetCamera(); }
      if (['+', '=', '-'].includes(event.key)) {
        event.preventDefault();
        const offset = camera.position.clone().sub(orbit.target);
        const distance = THREE.MathUtils.clamp(offset.length() * (event.key === '-' ? 1.12 : .88), orbit.minDistance, orbit.maxDistance);
        camera.position.copy(orbit.target).add(offset.setLength(distance));
        orbit.update();
      }
    });
    stage = new THREE.Group();
    scene.add(stage);
    const ambient = new THREE.HemisphereLight(0xf0f8ff, 0x637e99, 2.4);
    ambient.position.set(0, 0, 1);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xfff9eb, 3.3);
    key.position.set(3, -4, 5);
    key.target.position.set(0, 0, .5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: .1, far: 10 });
    key.shadow.normalBias = .002;
    stage.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xe6f0ff, 2);
    fill.position.set(-2, 2, 3);
    stage.add(fill, fill.target);

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (robot) resetCamera();
      requestRender();
    };
    new ResizeObserver(resize).observe(canvas);
    resize();
    robot = await loadRobot(new URL('urdf/rigby.urdf?v=20260930-9', import.meta.url), new URL('./', import.meta.url), (loaded, total) => {
      if (loading) $('#load-detail').textContent = `Loading parts · ${loaded} / ${total}`;
    });
    loading = false;
    scene.add(robot.root);
    const floorZ = new THREE.Box3().setFromObject(robot.root).min.z;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.ShadowMaterial({ opacity: .1 }));
    ground.position.z = floorZ - .003;
    ground.receiveShadow = true;
    stage.add(ground);
    buildControls();
    applyPose();
    resetCamera();
    $('#load-status').hidden = true;
    for (const button of document.querySelectorAll('.panel-actions button')) button.disabled = false;
    // Expose the rendered model for inspection, matching the aquaBOT playground.
    window.robotView = {
      joints: Object.fromEntries(robot.joints),
      inspect() {
        robot.root.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(robot.root);
        return {
          meshCount: robot.meshCount, linkCount: robot.links.size, jointCount: robot.joints.size,
          applied: Object.fromEntries([...robot.joints].map(([id, joint]) => [id, joint.value])),
          world: Object.fromEntries([...robot.links].map(([id, link]) => [id, link.getWorldPosition(new THREE.Vector3()).toArray()])),
          bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
          triangles: renderer.info.render.triangles
        };
      }
    };
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      stopPlaying();
      $('#load-status').hidden = false;
      $('#load-title').textContent = 'The 3D view was interrupted';
      $('#load-detail').textContent = 'Reload the playground to continue.';
      $('#retry').hidden = false;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      $('#load-status').hidden = true;
      requestRender();
    });
  } catch (error) {
    loading = false;
    console.error(error);
    $('#load-title').textContent = 'RIGBY couldn’t load';
    $('#load-detail').textContent = renderer ? 'Check your connection and try again.' : 'Enable WebGL in your browser, then try again.';
    $('#retry').hidden = false;
    for (const input of panel.querySelectorAll('input')) input.disabled = true;
  }
}

init();
