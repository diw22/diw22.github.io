import * as THREE from 'three';
import { ARM_JOINTS, GRIPPER_JOINT, GRIP_CENTER, createCatchSolver } from './catch-kinematics.js';

const RADIUS = .018;
const GRAVITY = 3.2; // Slow the short fall enough to make the catch easy to follow.
const CATCH_HEIGHT = .96;
const DROP_X = .39;
const smooth = t => t * t * t * (10 + t * (-15 + 6 * t));

export function createBallGame({ robot, scene, camera, canvas, orbit, values, applyPose,
  updateControls, requestRender, floorZ, onToggle }) {
  const toggle = document.querySelector('#catch-toggle');
  const hud = document.querySelector('#catch-hud');
  const message = document.querySelector('#catch-message');
  const dropButton = document.querySelector('#drop-ball');
  const originalLabel = canvas.getAttribute('aria-label');
  const solver = createCatchSolver(robot);
  const base = robot.links.get('base_link');
  const hand = robot.links.get('right_arm_Gripper_Base_v1_1');
  const armNames = [...ARM_JOINTS, GRIPPER_JOINT];
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xffa62b, roughness: .35, metalness: .08 }));
  ball.castShadow = true;
  group.add(ball);
  const target = new THREE.Mesh(new THREE.RingGeometry(.026, .031, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .8, side: THREE.DoubleSide }));
  group.add(target);
  const guideGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const guide = new THREE.Line(guideGeometry,
    new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: .55, dashSize: .012, gapSize: .012 }));
  group.add(guide);
  const raycaster = new THREE.Raycaster(), plane = new THREE.Plane();
  const pointer = new THREE.Vector2(), hit = new THREE.Vector3();
  const normal = new THREE.Vector3(), baseRotation = new THREE.Quaternion();
  const localDrop = new THREE.Vector3(DROP_X, -.135, 1.24);
  const release = new THREE.Vector3(), catchPoint = new THREE.Vector3();
  const handPoint = new THREE.Vector3(), holdOffset = new THREE.Vector3();
  let state = 'off', frame = 0, lastTime = 0, elapsed = 0, duration = 0;
  let savedPose = {}, fromPose = {}, toPose = {}, restoreOrbit = true;
  let catchError = null, solveMs = 0, catches = 0, pointerDown = null;
  let missStart = 0, bounceSpeed = 0;

  function announce(text) { message.textContent = text; }
  function snapshot() { return Object.fromEntries(armNames.map(name => [name, values[name]])); }
  function blendPose(t) {
    const blend = smooth(THREE.MathUtils.clamp(t, 0, 1));
    for (const name of armNames) values[name] = THREE.MathUtils.lerp(fromPose[name], toPose[name], blend);
    applyPose();
  }
  function showGuide() {
    base.updateWorldMatrix(true, false);
    release.copy(localDrop);
    base.localToWorld(release);
    catchPoint.set(DROP_X, localDrop.y, CATCH_HEIGHT);
    base.localToWorld(catchPoint);
    ball.position.copy(release);
    target.position.copy(catchPoint);
    target.quaternion.copy(base.getWorldQuaternion(baseRotation));
    const points = guideGeometry.attributes.position;
    points.setXYZ(0, release.x, release.y, release.z);
    points.setXYZ(1, catchPoint.x, catchPoint.y, catchPoint.z);
    points.needsUpdate = true;
    guideGeometry.computeBoundingSphere();
    guide.computeLineDistances();
    requestRender();
  }
  function schedule() {
    if (!frame && state !== 'off' && !document.hidden) frame = requestAnimationFrame(tick);
  }
  function setState(next) {
    state = next;
    elapsed = 0;
    lastTime = 0;
    guide.visible = target.visible = next === 'aiming' || next === 'preparing';
    dropButton.disabled = !['aiming', 'holding', 'missed'].includes(next);
    dropButton.textContent = next === 'holding' || next === 'missed' ? 'Try again' : 'Drop ball';
    canvas.classList.toggle('catch-aiming', next === 'aiming');
  }
  function prepare() {
    // Reuse the current base transform, even if the cart was moved in pose mode.
    localDrop.set(DROP_X, -.135, 1.24);
    showGuide();
    const seed = { ...values, ...Object.fromEntries(ARM_JOINTS.map(name => [name, 0])) };
    const solution = solver.solve(catchPoint, seed);
    fromPose = snapshot();
    toPose = { ...solution.pose, [GRIPPER_JOINT]: 0 };
    duration = .65;
    catchError = null;
    setState('preparing');
    announce('Getting ready…');
    schedule();
  }
  function setEnabled(enabled) {
    if (enabled === (state !== 'off')) return;
    cancelAnimationFrame(frame);
    frame = 0;
    if (enabled) {
      savedPose = snapshot();
      restoreOrbit = orbit.enabled;
      orbit.enabled = false;
      group.visible = true;
      hud.hidden = false;
      toggle.textContent = 'Exit catch';
      toggle.setAttribute('aria-pressed', 'true');
      prepare();
      canvas.setAttribute('aria-label', 'Play catch with RIGBY. Move to aim, click or tap to drop. Enter or Space drops the ball. Escape exits.');
      onToggle(true);
    } else {
      setState('off');
      pointerDown = null;
      group.visible = false;
      hud.hidden = true;
      orbit.enabled = restoreOrbit;
      toggle.textContent = 'Catch a ball';
      toggle.setAttribute('aria-pressed', 'false');
      canvas.setAttribute('aria-label', originalLabel);
      Object.assign(values, savedPose);
      applyPose();
      updateControls();
      onToggle(false);
    }
  }
  function aim(clientX, clientY) {
    if (state !== 'aiming') return;
    const rect = canvas.getBoundingClientRect();
    pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    normal.set(1, 0, 0).applyQuaternion(base.getWorldQuaternion(baseRotation));
    hit.set(DROP_X, 0, 0);
    base.localToWorld(hit);
    plane.setFromNormalAndCoplanarPoint(normal, hit);
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(plane, hit)) return;
    base.worldToLocal(hit);
    localDrop.y = THREE.MathUtils.clamp(hit.y, -.23, -.04);
    localDrop.z = THREE.MathUtils.clamp(hit.z, 1.13, 1.35);
    showGuide();
  }
  function drop() {
    if (state === 'holding' || state === 'missed') { prepare(); return; }
    if (state !== 'aiming') return;
    showGuide();
    const start = performance.now();
    const solution = solver.solve(catchPoint, values);
    solveMs = performance.now() - start;
    if (solution.error > .008) {
      announce('A little closer to the hand — try another spot.');
      return;
    }
    fromPose = snapshot();
    toPose = { ...solution.pose, [GRIPPER_JOINT]: 0 };
    duration = Math.sqrt(2 * (release.z - catchPoint.z) / GRAVITY);
    setState('falling');
    announce('Here it comes…');
    schedule();
  }
  function tick(time) {
    frame = 0;
    if (state === 'off' || document.hidden) return;
    const dt = lastTime ? Math.min((time - lastTime) / 1000, .05) : 0;
    lastTime = time;
    elapsed += dt;
    let keepGoing = true;
    if (state === 'preparing') {
      blendPose(elapsed / duration);
      if (elapsed >= duration) {
        setState('aiming');
        announce('Move to aim · Click or tap to drop · Esc to exit');
        updateControls();
        keepGoing = false;
      }
    } else if (state === 'falling') {
      blendPose(elapsed / duration);
      const t = Math.min(elapsed, duration);
      ball.position.copy(release);
      ball.position.z -= .5 * GRAVITY * t * t;
      if (elapsed >= duration) {
        handPoint.copy(GRIP_CENTER);
        hand.localToWorld(handPoint);
        catchError = handPoint.distanceTo(ball.position);
        if (catchError < RADIUS * .65) {
          // Preserve the actual contact offset so there is no snap on attachment.
          holdOffset.copy(ball.position);
          hand.worldToLocal(holdOffset);
          fromPose = snapshot();
          // In this URDF zero opens the jaws; ~0.76 rad closes them around a 36 mm ball.
          toPose = { ...fromPose, [GRIPPER_JOINT]: .76 };
          duration = .22;
          setState('closing');
        } else {
          missStart = ball.position.z;
          bounceSpeed = -GRAVITY * duration;
          setState('bouncing');
          announce('Missed it!');
        }
      }
    } else if (state === 'closing') {
      blendPose(elapsed / duration);
      ball.position.copy(holdOffset);
      hand.localToWorld(ball.position);
      if (elapsed >= duration) {
        catches++;
        setState('holding');
        announce('Caught! Try another drop.');
        updateControls();
        keepGoing = false;
      }
    } else if (state === 'bouncing') {
      bounceSpeed -= GRAVITY * dt;
      missStart += bounceSpeed * dt;
      if (missStart <= floorZ + RADIUS) {
        missStart = floorZ + RADIUS;
        bounceSpeed = Math.abs(bounceSpeed) * .3;
        if (bounceSpeed < .18) {
          setState('missed');
          announce('Missed it — try another drop.');
          keepGoing = false;
        }
      }
      ball.position.z = missStart;
    } else keepGoing = false;
    requestRender();
    if (keepGoing) schedule();
  }

  toggle.disabled = false;
  toggle.addEventListener('click', () => setEnabled(state === 'off'));
  dropButton.addEventListener('click', drop);
  canvas.addEventListener('pointermove', event => {
    if (event.isPrimary) aim(event.clientX, event.clientY);
  });
  canvas.addEventListener('pointerdown', event => {
    if (state !== 'aiming' || !event.isPrimary || event.button !== 0) return;
    pointerDown = { id: event.pointerId, x: event.clientX, y: event.clientY };
    aim(event.clientX, event.clientY);
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup', event => {
    if (!pointerDown || pointerDown.id !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    pointerDown = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (distance < 8) { aim(event.clientX, event.clientY); drop(); }
  });
  canvas.addEventListener('pointercancel', () => { pointerDown = null; });
  canvas.addEventListener('keydown', event => {
    if (state === 'off' || ![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    drop();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state !== 'off') {
      setEnabled(false);
      toggle.focus({ preventScroll: true });
    }
  });
  // Leaving the tab cancels the trial and restores its initial pose; no background loop.
  document.addEventListener('visibilitychange', () => { if (document.hidden) setEnabled(false); });
  window.addEventListener('pagehide', () => setEnabled(false));

  return {
    stop: () => setEnabled(false),
    inspect: () => ({ state, catches, catchError, solveMs, scheduled: !!frame,
      ball: ball.getWorldPosition(new THREE.Vector3()).toArray(), target: catchPoint.toArray() })
  };
}
