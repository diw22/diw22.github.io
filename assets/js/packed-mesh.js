import * as THREE from 'three';

// Meshes packed by assets/models/*/build.py: per mesh, int16 positions within its bounds, int8 normals and uint16
// triangle indices, all in one binary described by a JSON file.
export async function loadPacked(jsonUrl, binUrl) {
  const fetchOk = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`model ${r.status}`); return r; });
  const [desc, blob] = await Promise.all([fetchOk(jsonUrl).then((r) => r.json()), fetchOk(binUrl).then((r) => r.arrayBuffer())]);
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
