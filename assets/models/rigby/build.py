"""Packs RIGBY (rigby/urdf/rigby.urdf and rigby/meshes) for the projects carousel.

    python assets/models/rigby/build.py

The carousel only shows RIGBY at its default pose, turning, so it doesn't need the 38 MB of full-resolution parts the
RIGBY page loads. Each part is simplified with open3d's quadric decimation only as far as it stays within TOLERANCE of
the original surface (measured both ways on sampled points), given normals that keep sharp edges, and placed where
rigby/urdf.js puts it at the default pose. Writes, in the same format as assets/models/openmanipulator-x:

  rigby.json  meshes, materials, and one visual per URDF visual with its mesh, material and 3x4 transform
  rigby.bin   per mesh: int16 positions within the mesh's bounds, int8 normals, uint16 triangle indices
"""
import importlib.util
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import open3d as o3d

OUT = Path(__file__).resolve().parent
SITE = OUT.parents[2]
TOLERANCE = 0.0007  # metres; the whole robot spans ~600 px in the carousel, so well under a pixel
STEPS = (.004, .008, .015, .025, .04, .06, .09, .13, .2, .3, .45, .7)

spec = importlib.util.spec_from_file_location("omx_build", OUT.parent / "openmanipulator-x" / "build.py")
omx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(omx)


def vec(text, default="0 0 0"):
    return [float(x) for x in (text or default).split()]


def rpy_matrix(r, p, y):
    """THREE.Euler(r, p, y, 'ZYX'), as rigby/urdf.js reads a URDF origin: Rz(y) Ry(p) Rx(r)."""
    cr, sr, cp, sp, cy, sy = math.cos(r), math.sin(r), math.cos(p), math.sin(p), math.cos(y), math.sin(y)
    return np.array([[cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
                     [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
                     [-sp, cp * sr, cp * cr]])


def transform(element):
    m = np.eye(4)
    if element is not None:
        m[:3, :3] = rpy_matrix(*vec(element.get("rpy")))
        m[:3, 3] = vec(element.get("xyz"))
    return m


def axis_rotation(axis, angle):
    x, y, z = axis
    c, s = math.cos(angle), math.sin(angle)
    return np.array([[c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
                     [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
                     [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)]])


def default_pose(robot):
    """World transform of every link at urdf.js's pose(): each joint at 0 (or its mimic value), clamped to limits."""
    joints = {j.get("name"): j for j in robot.findall("joint")}
    values = {}

    def value(name):
        if name not in values:
            j = joints[name]
            mimic, limit = j.find("mimic"), j.find("limit")
            v = value(mimic.get("joint")) * float(mimic.get("multiplier", 1)) + float(mimic.get("offset", 0)) if mimic is not None else 0.0
            if j.get("type") != "continuous":
                v = min(max(v, float(limit.get("lower", 0)) if limit is not None else 0), float(limit.get("upper", 0)) if limit is not None else 0)
            values[name] = v
        return values[name]

    children = {j.find("child").get("link") for j in joints.values()}
    (root,) = [l.get("name") for l in robot.findall("link") if l.get("name") not in children]
    world = {root: np.eye(4)}
    pending = list(joints.values())
    while pending:
        for j in list(pending):
            parent = j.find("parent").get("link")
            if parent not in world:
                continue
            m = world[parent] @ transform(j.find("origin"))
            axis = np.array(vec(j.find("axis").get("xyz") if j.find("axis") is not None else None, "1 0 0"))
            axis /= np.linalg.norm(axis)
            if j.get("type") in ("revolute", "continuous"):
                m[:3, :3] = m[:3, :3] @ axis_rotation(axis, value(j.get("name")))
            elif j.get("type") == "prismatic":
                m[:3, 3] += m[:3, :3] @ axis * value(j.get("name"))
            world[j.find("child").get("link")] = m
            pending.remove(j)
    return world


def deviation(a, b, samples=40000):
    """95th-percentile and largest distance between the two surfaces, each sampled against the other."""
    worst = []
    for src, dst in ((a, b), (b, a)):
        scene = o3d.t.geometry.RaycastingScene()
        scene.add_triangles(o3d.t.geometry.TriangleMesh.from_legacy(dst))
        points = np.asarray(src.sample_points_uniformly(samples).points, dtype=np.float32)
        worst.append(scene.compute_distance(o3d.core.Tensor(points)).numpy())
    d = np.concatenate(worst)
    return float(np.percentile(d, 95)), float(d.max())


def simplify(path, scale):
    mesh = o3d.io.read_triangle_mesh(str(path))
    mesh.remove_duplicated_vertices()
    mesh.remove_degenerate_triangles()
    mesh.vertices = o3d.utility.Vector3dVector(np.asarray(mesh.vertices) * scale)
    full = len(mesh.triangles)
    for step in STEPS:
        target = max(64, int(full * step))
        if target >= full:
            break
        small = mesh.simplify_quadric_decimation(target_number_of_triangles=target)
        small.remove_degenerate_triangles()
        small.remove_unreferenced_vertices()
        p95, worst = deviation(mesh, small)
        if p95 < TOLERANCE and worst < 4 * TOLERANCE:
            return np.asarray(small.vertices), np.asarray(small.triangles), full, p95, worst
    return np.asarray(mesh.vertices), np.asarray(mesh.triangles), full, 0.0, 0.0


def main():
    robot = ET.parse(SITE / "rigby/urdf/rigby.urdf").getroot()
    colours = {m.get("name"): vec(m.find("color").get("rgba")) for m in robot.findall("material") if m.find("color") is not None}
    world = default_pose(robot)
    blob, meshes, materials, visuals = bytearray(), {}, [], []
    drawn = [0, 0]
    for link in robot.findall("link"):
        for visual in link.findall("visual"):
            mesh = visual.find("geometry/mesh")
            scale = vec(mesh.get("scale"), "1 1 1")
            key = (Path(mesh.get("filename")).name, tuple(scale))
            if key not in meshes:
                v, f, full, p95, worst = simplify(SITE / "rigby/meshes" / key[0], np.array(scale))
                p, n, i = omx.creased(v, f)
                meshes[key] = omx.pack(p, n, i, blob) | {"name": key[0]}
                meshes[key]["source"] = full
                print(f"{key[0]:40s} {full:7d} -> {len(f):6d} triangles  p95 {p95 * 1e3:.2f} mm  max {worst * 1e3:.2f} mm")
            record = meshes[key]
            drawn[0] += record["source"]
            drawn[1] += record["faces"]
            material = visual.find("material")
            name = material.get("name") if material is not None else None
            rgba = vec(material.find("color").get("rgba")) if material is not None and material.find("color") is not None else colours.get(name, [.7, .7, .68, 1])
            if rgba not in materials:
                materials.append(rgba)
            m = world[link.get("name")] @ transform(visual.find("origin"))
            visuals.append({"mesh": list(meshes).index(key), "material": materials.index(rgba),
                            "matrix": [round(float(x), 7) for x in m[:3].ravel()]})
    for record in meshes.values():
        del record["source"]
    (OUT / "rigby.bin").write_bytes(bytes(blob))
    (OUT / "rigby.json").write_text(json.dumps({"meshes": list(meshes.values()), "materials": materials, "visuals": visuals},
                                               separators=(",", ":")))
    print(f"drawn triangles {drawn[0]} -> {drawn[1]}; rigby.bin {len(blob) / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
