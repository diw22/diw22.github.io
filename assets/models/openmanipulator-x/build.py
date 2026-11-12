"""Packs ROBOTIS's OpenManipulator-X (github.com/ROBOTIS-GIT/open_manipulator, Apache-2.0) for the ChessBot card.

    python assets/models/openmanipulator-x/build.py path/to/open_manipulator

Reads open_manipulator_description/urdf/open_manipulator_x/open_manipulator_x.urdf and its STL meshes (plus the
perforated base plate), decimates each mesh with open3d's quadric simplification, gives it normals that keep sharp
edges, and writes:

  omx.json  links, joints and visuals in metres
  omx.bin   per mesh: int16 positions within the mesh's bounds, int8 normals, uint16 triangle indices

It also checks the closed-form inverse kinematics used by assets/js/chess-view.js against the URDF's chain.
"""
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import open3d as o3d

OUT = Path(__file__).resolve().parent
TRIANGLES = {"link1": 5000, "link2": 2600, "link3": 5000, "link4": 4400, "link5": 4000,
             "plate": 7088}
CREASE = math.cos(math.radians(38))


def creased(vertices, faces):
    """Each corner takes the area-weighted normals of the faces round its vertex that bend less than the crease
    angle from its own face; corners are then merged wherever position and normal agree."""
    a, b, c = (vertices[faces[:, k]] for k in range(3))
    area_normals = np.cross(b - a, c - a)
    unit = area_normals / np.maximum(np.linalg.norm(area_normals, axis=1, keepdims=True), 1e-20)
    incident = [[] for _ in range(len(vertices))]
    for f, tri in enumerate(faces):
        for v in tri:
            incident[v].append(f)
    corners, index = {}, np.zeros(faces.shape, np.uint32)
    positions, normals = [], []
    for f, tri in enumerate(faces):
        for k, v in enumerate(tri):
            around = np.array(incident[v])
            near = around[unit[around] @ unit[f] > CREASE]
            n = area_normals[near].sum(0)
            n = n / max(np.linalg.norm(n), 1e-20)
            key = (int(v), *np.round(n * 127).astype(int))
            if key not in corners:
                corners[key] = len(positions)
                positions.append(vertices[v])
                normals.append(n)
            index[f, k] = corners[key]
    return np.array(positions), np.array(normals), index


def load(path, name):
    mesh = o3d.io.read_triangle_mesh(str(path))
    mesh.remove_duplicated_vertices()
    mesh.remove_degenerate_triangles()
    target = TRIANGLES[name]
    if len(mesh.triangles) > target:
        mesh = mesh.simplify_quadric_decimation(target_number_of_triangles=target)
        mesh.remove_degenerate_triangles()
        mesh.remove_unreferenced_vertices()
    return np.asarray(mesh.vertices) * 0.001, np.asarray(mesh.triangles)


def pack(positions, normals, index, blob):
    if len(positions) > 65535:
        raise ValueError("too many vertices for uint16 indices")
    lo, hi = positions.min(0), positions.max(0)
    q = np.round((positions - lo) / np.maximum(hi - lo, 1e-9) * 65535 - 32768).astype(np.int16)
    record = {"vertices": len(positions), "faces": len(index), "min": [round(float(x), 7) for x in lo],
              "max": [round(float(x), 7) for x in hi], "offset": len(blob)}
    blob += q.tobytes() + np.round(normals * 127).astype(np.int8).tobytes()
    blob += bytes(-len(blob) % 2)
    blob += index.astype(np.uint16).tobytes()
    blob += bytes(-len(blob) % 4)
    return record


def vec(text, default="0 0 0"):
    return [float(x) for x in (text or default).split()]


def check_ik(joints):
    """The card solves the arm in closed form with the tool pointing straight down. Compare with the URDF chain."""
    j = {x["name"]: x for x in joints}
    def rot(axis, q):
        x, y, z = axis
        c, s = math.cos(q), math.sin(q)
        return np.array([[c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
                         [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
                         [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)]])
    def fk(q):
        R, p = np.eye(3), np.zeros(3)
        for name, value in zip(("joint1", "joint2", "joint3", "joint4"), q):
            p = p + R @ np.array(j[name]["xyz"])
            R = R @ rot(j[name]["axis"], value)
        return p + R @ np.array([0.126, 0, 0]), R @ np.array([1.0, 0, 0])
    def ik(t):
        x, y, z = t
        q1 = math.atan2(y, x - 0.012)
        r, h = math.hypot(x - 0.012, y), z - 0.0595
        la, lb, a0 = math.hypot(0.024, 0.128), 0.124, math.atan2(0.128, 0.024)
        wr, wz = r, h + 0.126
        d = math.hypot(wr, wz)
        pa = math.atan2(wz, wr) + math.acos(max(-1, min(1, (la * la + d * d - lb * lb) / (2 * la * d))))
        pb = math.atan2(wz - la * math.sin(pa), wr - la * math.cos(pa))
        q2 = a0 - pa
        q3 = -pb - q2
        return q1, q2, q3, math.pi / 2 + pb
    # Every square of the team's board (main.py: corners (7.6, 21.2) and (-7.6, 6) cm, robot facing +y there), in
    # this frame: x = 0.012 + y/100, y = -x/100. Heights: a grasp and a lift above the 6 mm board.
    worst, out_of_reach = 0, []
    for rank in range(8):
        for file in range(8):
            tx, ty = 7.6 - (file + .5) * 1.9, 21.2 - (rank + .5) * 1.9
            for z in (.006 + .022, .006 + .022 + .045):
                t = np.array([.012 + ty / 100, -tx / 100, z])
                r, wz = math.hypot(t[0] - .012, t[1]), z + .126 - .0595
                if math.hypot(r, wz) > math.hypot(.024, .128) + .124:
                    out_of_reach.append(f"{'abcdefgh'[file]}{rank + 1}@{z * 100:.1f}cm")
                    continue
                tip, axis = fk(ik(t))
                worst = max(worst, float(np.linalg.norm(tip - t)), float(np.linalg.norm(axis - [0, 0, -1])))
    print(f"IK check on the board: worst error {worst:.2e}; out of reach with the tool vertical: {out_of_reach or 'none'}")
    if worst > 1e-9:
        raise SystemExit("inverse kinematics disagrees with the URDF")


def main():
    repo = Path(sys.argv[1])
    desc = repo / "open_manipulator_description"
    urdf = ET.parse(desc / "urdf/open_manipulator_x/open_manipulator_x.urdf").getroot()
    meshes_dir = desc / "meshes/open_manipulator_x"
    blob, meshes, links, joints = bytearray(), {}, [], []
    for link in urdf.findall("link"):
        visuals = []
        for visual in link.findall("visual"):
            mesh = visual.find("geometry/mesh")
            if mesh is None:
                continue
            name = Path(mesh.get("filename")).stem
            if "palm" in name:  # the team's own printed fingers replace these (assets/js/chess-view.js)
                continue
            if name not in meshes:
                v, f = load(meshes_dir / f"{name}.stl", name)
                p, n, i = creased(v, f)
                meshes[name] = pack(p, n, i, blob) | {"name": name}
                print(f"{name}: {len(f)} triangles, {len(p)} vertices")
            origin = visual.find("origin")
            visuals.append({"mesh": list(meshes).index(name), "xyz": vec(origin.get("xyz") if origin is not None else None),
                            "rpy": vec(origin.get("rpy") if origin is not None else None)})
        links.append({"name": link.get("name"), "visuals": visuals})
    for joint in urdf.findall("joint"):
        origin, limit, mimic = joint.find("origin"), joint.find("limit"), joint.find("mimic")
        joints.append({"name": joint.get("name"), "type": joint.get("type"),
                       "parent": joint.find("parent").get("link"), "child": joint.find("child").get("link"),
                       "xyz": vec(origin.get("xyz")), "rpy": vec(origin.get("rpy")),
                       "axis": vec(joint.find("axis").get("xyz") if joint.find("axis") is not None else None, "1 0 0"),
                       "limit": [float(limit.get("lower")), float(limit.get("upper"))] if limit is not None else None,
                       "mimic": {"joint": mimic.get("joint"), "multiplier": float(mimic.get("multiplier", 1))} if mimic is not None else None})
    v, f = load(meshes_dir / "plate.stl", "plate")
    p, n, i = creased(v, f)
    meshes["plate"] = pack(p, n, i, blob) | {"name": "plate"}
    check_ik(joints)
    (OUT / "omx.bin").write_bytes(bytes(blob))
    (OUT / "omx.json").write_text(json.dumps({"meshes": list(meshes.values()), "links": links, "joints": joints,
                                              "plate": list(meshes).index("plate")}, separators=(",", ":")))
    print(f"omx.bin {len(blob) / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
