// A curved stage backdrop wrapped behind the robot: cloth-like folds that drift slowly and lift with the kick.
// The displacement and colouring are ported from ShaderGradient's plane shader (github.com/ruucm/shadergradient,
// MIT, © ruucm): Perlin noise pushes the surface along its normal, and the colour mixes across the stage and with
// the displacement. Here it's an object in the scene, lit by the scene's own lights, not a page background.
import * as THREE from 'three';

// Classic Perlin 3D noise, Stefan Gustavson (MIT), as used by ShaderGradient.
const noise = /* glsl */`
vec3 kbMod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 kbMod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 kbPermute(vec4 x) { return kbMod289(((x * 34.0) + 1.0) * x); }
vec4 kbTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec3 kbFade(vec3 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
float kbNoise(vec3 P) {
  vec3 Pi0 = floor(P), Pi1 = Pi0 + vec3(1.0);
  Pi0 = kbMod289(Pi0); Pi1 = kbMod289(Pi1);
  vec3 Pf0 = fract(P), Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x), iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz, iz1 = Pi1.zzzz;
  vec4 ixy = kbPermute(kbPermute(ix) + iy), ixy0 = kbPermute(ixy + iz0), ixy1 = kbPermute(ixy + iz1);
  vec4 gx0 = ixy0 * (1.0 / 7.0), gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0), sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5); gy0 -= sz0 * (step(0.0, gy0) - 0.5);
  vec4 gx1 = ixy1 * (1.0 / 7.0), gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1), sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5); gy1 -= sz1 * (step(0.0, gy1) - 0.5);
  vec3 g000 = vec3(gx0.x, gy0.x, gz0.x), g100 = vec3(gx0.y, gy0.y, gz0.y), g010 = vec3(gx0.z, gy0.z, gz0.z), g110 = vec3(gx0.w, gy0.w, gz0.w);
  vec3 g001 = vec3(gx1.x, gy1.x, gz1.x), g101 = vec3(gx1.y, gy1.y, gz1.y), g011 = vec3(gx1.z, gy1.z, gz1.z), g111 = vec3(gx1.w, gy1.w, gz1.w);
  vec4 norm0 = kbTaylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
  vec4 norm1 = kbTaylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
  float n000 = dot(g000, Pf0), n100 = dot(g100, vec3(Pf1.x, Pf0.yz)), n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z)), n001 = dot(g001, vec3(Pf0.xy, Pf1.z)), n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz)), n111 = dot(g111, Pf1);
  vec3 fade_xyz = kbFade(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  return 2.2 * mix(n_yz.x, n_yz.y, fade_xyz.x);
}
float kbField(vec3 p, float density, float time) { return 0.75 * kbNoise(p * density + vec3(0.0, time, 0.0)); }`;

export function createBackdrop() {
  const uniforms = {
    uTime: { value: 0 },
    uDensity: { value: 1.15 },
    uStrength: { value: .2 },
    uPulse: { value: 0 },
    uColor1: { value: new THREE.Color('#2b0c10') },
    uColor2: { value: new THREE.Color('#120d12') },
    uColor3: { value: new THREE.Color('#8f2418') }
  };
  // Seen from inside, so its back faces are the ones drawn (three.js flips their normals for lighting).
  const material = new THREE.MeshStandardMaterial({ roughness: .92, metalness: 0, side: THREE.BackSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // Pushed along the surface normal; the lighting normal follows the noise's slope across and up the surface,
    // so the folds catch the light like cloth.
    shader.vertexShader = `uniform float uTime, uDensity, uStrength, uPulse;\nvarying float vKbAcross, vKbLift;\n${noise}\n${shader.vertexShader}`
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float kbS = uStrength + uPulse * 0.12, kbE = 0.03;
        vec3 kbN = normalize(normal), kbU = vec3(0.0, 1.0, 0.0), kbT = normalize(cross(kbU, kbN));
        float kbD = kbField(position, uDensity, uTime);
        float kbDT = kbField(position + kbT * kbE, uDensity, uTime) - kbD;
        float kbDU = kbField(position + kbU * kbE, uDensity, uTime) - kbD;
        objectNormal = normalize(kbN - kbT * (kbDT / kbE * kbS) - kbU * (kbDU / kbE * kbS));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed += kbN * kbD * kbS;
        vKbAcross = position.x;
        vKbLift = kbD * kbS;`);
    shader.fragmentShader = `uniform vec3 uColor1, uColor2, uColor3;\nuniform float uPulse;\nvarying float vKbAcross, vKbLift;\n${shader.fragmentShader}`
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        float kbRidge = smoothstep(0.02, 0.3, vKbLift);
        vec3 kbBase = mix(mix(uColor1, uColor2, smoothstep(-3.0, 3.0, vKbAcross)), uColor3, kbRidge * (0.3 + uPulse * 0.7));
        vec4 diffuseColor = vec4(kbBase, opacity);`);
  };
  material.customProgramCacheKey = () => 'kraftwerk-backdrop';
  // A cylinder wall 3 m out from the robot, open towards the front of the stage. Its axis is turned upright.
  const geometry = new THREE.CylinderGeometry(3.1, 3.1, 4.2, 220, 90, true, -1.95, 3.9);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(.15, -.1, 1.8);
  let time = 0, pulse = 0;
  return {
    mesh,
    update(dt, energy, still) {
      pulse += (energy - pulse) * Math.min(1, dt * 9);
      if (!still) time += dt * (.05 + pulse * .22);
      uniforms.uTime.value = time;
      uniforms.uPulse.value = pulse;
    }
  };
}
