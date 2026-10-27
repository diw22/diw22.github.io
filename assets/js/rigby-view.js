import * as THREE from 'three';
import { loadRobot } from '../../rigby/urdf.js';

export async function createRigbyView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, .01, 200);
  camera.up.set(0, 0, 1);
  const ambient = new THREE.HemisphereLight(0xf0f8ff, 0x637e99, 2.4); ambient.position.set(0, 0, 1); scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff9eb, 3.3); key.position.set(3, -4, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xe6f0ff, 2); fill.position.set(-2, 2, 3); scene.add(fill);
  const spin = new THREE.Group(); scene.add(spin);
  const robot = await loadRobot(new URL('rigby/urdf/rigby.urdf', document.baseURI), new URL('rigby/', document.baseURI));
  spin.add(robot.root);
  const box = new THREE.Box3().setFromObject(robot.root), centre = box.getCenter(new THREE.Vector3());
  robot.root.position.sub(new THREE.Vector3(centre.x, centre.y, centre.z));
  const size = box.getSize(new THREE.Vector3()), radius = size.length() / 2;
  const dir = new THREE.Vector3(1.7, -2.4, .7).normalize();
  let w = 1, h = 1;
  return {
    resize(nw, nh) { w = nw; h = nh; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
    draw(yawDeg, tiltDeg) {
      spin.rotation.z = THREE.MathUtils.degToRad(yawDeg);
      const d = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.02;
      const v = dir.clone(); v.z += THREE.MathUtils.degToRad(tiltDeg) * .8; v.normalize();
      camera.position.copy(v.multiplyScalar(d)); camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    }
  };
}
