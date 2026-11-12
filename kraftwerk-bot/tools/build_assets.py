"""Builds the Kraftwerk Bot page's data from the project repository and its Hugging Face dataset.

    python kraftwerk-bot/tools/build_assets.py --repo path/to/DWinters_Humanoid --cache path/to/download/cache

Needs the project's requirements (MuJoCo 3.3, NumPy, SciPy) and ffmpeg on the PATH. Writes into kraftwerk-bot/:

  data/scene.json    the compiled MuJoCo scene: bodies, hinge joints, visible geoms, cameras
  data/meshes.bin    the G1's decimated visual meshes as MuJoCo compiled them (int16 positions, int8 normals, uint16 faces)
  data/takes.json    per part: the take, its bars, hits, beat grid, envelopes for the timeline and the model's results
  data/<part>.bin    60 Hz joint positions + knob 4 (int16, 1e-4 rad), then the 15 policy targets (int8, per-channel range)
  audio/*.m4a        the song's loops (mono AAC) and a click for measuring the browser's decoder delay
"""
import argparse
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

import numpy as np

DATA = "https://huggingface.co/datasets/diw22/DWinters_Humanoid-data/resolve/main"
MODELS = "https://huggingface.co/diw22/DWinters_Humanoid-models/resolve/main"
# Held-out test takes, one per part; all three use chord loop 6, which training never heard.
TAKES = {"claps": "claps_035", "rims": "rims_035", "shakers": "shakers_021"}
LOOPS = ("kick", "claps", "rims", "shakers", "chords6")
MODEL_RUNS = {"claps": ["three_part"], "rims": ["three_part", "rims_only", "rims_student"], "shakers": ["three_part"]}
RATE, BAR = 44100, 4 * 60 / 65
ENVELOPE_HZ = 20


def fetch(url, path):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print("download", url)
        urllib.request.urlretrieve(url, path)
    return path


def r(x, n=6):
    return [round(float(v), n) for v in np.ravel(x)]


def export_scene(m, mujoco, out):
    """Bodies in tree order (MuJoCo ids), hinge joints by qpos address, and every geom a viewer shows (groups 0-2)."""
    bodies = []
    for b in range(m.nbody):
        joint = None
        if m.body_jntnum[b]:
            j = m.body_jntadr[b]
            joint = {"name": m.joint(j).name, "q": int(m.jnt_qposadr[j]), "axis": r(m.jnt_axis[j]), "range": r(m.jnt_range[j], 4)}
        bodies.append({"name": m.body(b).name, "parent": int(m.body_parentid[b]), "pos": r(m.body_pos[b]),
                       "quat": r(m.body_quat[b]), "joint": joint})
    materials = {k: m.material(k).name for k in range(m.nmat)}
    types = {mujoco.mjtGeom.mjGEOM_BOX: "box", mujoco.mjtGeom.mjGEOM_CYLINDER: "cylinder", mujoco.mjtGeom.mjGEOM_MESH: "mesh"}
    geoms, meshes, blob = [], {}, bytearray()
    for g in range(m.ngeom):
        if m.geom_group[g] >= 3 or m.geom_rgba[g][3] == 0 or m.geom_type[g] not in types:
            continue
        geom = {"name": m.geom(g).name, "body": int(m.geom_bodyid[g]), "type": types[m.geom_type[g]],
                "size": r(m.geom_size[g]), "pos": r(m.geom_pos[g]), "quat": r(m.geom_quat[g]), "rgba": r(m.geom_rgba[g], 3)}
        if m.geom_matid[g] >= 0:
            geom["material"] = materials[m.geom_matid[g]]
        if geom["type"] == "mesh":
            k = int(m.geom_dataid[g])
            if k not in meshes:
                meshes[k] = mesh_record(m, k, blob)
            geom["mesh"] = list(meshes).index(k)
        geoms.append(geom)
    cameras = {m.camera(c).name: {"body": int(m.cam_bodyid[c]), "pos": r(m.cam_pos[c]), "quat": r(m.cam_quat[c]),
                                  "fovy": float(m.cam_fovy[c])} for c in range(m.ncam)}
    (out/"meshes.bin").write_bytes(bytes(blob))
    scene = {"bodies": bodies, "geoms": geoms, "meshes": list(meshes.values()), "cameras": cameras, "nq": int(m.nq)}
    (out/"scene.json").write_text(json.dumps(scene, separators=(",", ":")))
    print(f"scene: {len(bodies)} bodies, {len(geoms)} geoms, {len(meshes)} meshes, {len(blob)/1e3:.0f} kB of mesh data")


def mesh_record(m, k, blob):
    """One mesh in MuJoCo's compiled frame, with the normals MuJoCo computed (sharp edges kept), so each face corner is a
    (vertex, normal) pair; positions are int16 within the mesh's bounds."""
    v = m.mesh_vert[m.mesh_vertadr[k]:m.mesh_vertadr[k] + m.mesh_vertnum[k]]
    n = m.mesh_normal[m.mesh_normaladr[k]:m.mesh_normaladr[k] + m.mesh_normalnum[k]]
    f = m.mesh_face[m.mesh_faceadr[k]:m.mesh_faceadr[k] + m.mesh_facenum[k]]
    fn = m.mesh_facenormal[m.mesh_faceadr[k]:m.mesh_faceadr[k] + m.mesh_facenum[k]]
    pairs, index = {}, np.zeros(f.shape, np.uint16)
    for i in range(len(f)):
        for c in range(3):
            key = (int(f[i, c]), int(fn[i, c]))
            index[i, c] = pairs.setdefault(key, len(pairs))
    corners = np.array(list(pairs))
    if len(corners) > 65535:
        raise ValueError("mesh too large for uint16 indices")
    pos, nrm = v[corners[:, 0]], n[corners[:, 1]]
    lo, hi = pos.min(0), pos.max(0)
    q = np.round((pos - lo) / np.maximum(hi - lo, 1e-9) * 65535 - 32768).astype(np.int16)
    nq = np.round(nrm / np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9) * 127).astype(np.int8)
    record = {"name": m.mesh(k).name, "vertices": len(corners), "faces": len(f), "min": r(lo, 7), "max": r(hi, 7),
              "offset": len(blob)}
    blob += q.tobytes() + nq.tobytes()
    blob += bytes(-len(blob) % 2)
    blob += index.tobytes()
    blob += bytes(-len(blob) % 4)
    return record


def mono(path):
    from scipy.io import wavfile
    rate, audio = wavfile.read(path)
    assert rate == RATE
    audio = audio.astype(np.float32) / 32768
    return audio.mean(1) if audio.ndim == 2 else audio


def bar_source(part, b, first):
    """Which bar of a part's loop plays in project bar b (training/audio_policy.backing)."""
    if part == "chords6":
        return (b - first) % 9
    return 1 + b % 8 if part == "shakers" else b % 13


def take_track(loop, part, first, bars):
    """A part as the take hears it: bars-1 bars from project bar `first`, then a silent bar."""
    n = int(round(BAR * RATE))
    track = np.concatenate([loop[int(bar_source(part, b, first) * BAR * RATE):][:n] for b in range(first, first + bars - 1)])
    return np.r_[track, np.zeros(n, np.float32)]


def envelope(x, duration):
    hop = RATE // ENVELOPE_HZ
    x = np.r_[x, np.zeros(hop)]
    rms = np.sqrt(np.array([np.mean(x[i:i + hop] ** 2) for i in range(0, int(duration * RATE), hop)]))
    return rms


def onset(loop, near_s, window=.25):
    """The sample where a hit near `near_s` starts: 10% of its peak, 2 ms early."""
    lo, hi = int((near_s - window) * RATE), int((near_s + window) * RATE)
    seg = np.abs(loop[lo:hi])
    peak = int(np.argmax(seg))
    start = np.nonzero(seg[:peak + 1] > .1 * seg[peak])[0][0]
    return lo + int(start) - int(.002 * RATE)


def encode(wav_audio, path, bitrate="96k"):
    from scipy.io import wavfile
    tmp = path.with_suffix(".wav")
    wavfile.write(tmp, RATE, np.clip(wav_audio * 32767, -32768, 32767).astype(np.int16))
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(tmp), "-ac", "1", "-c:a", "aac", "-b:a", bitrate,
                    "-movflags", "+faststart", str(path)], check=True)
    tmp.unlink()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--repo", type=Path, required=True)
    p.add_argument("--cache", type=Path, required=True)
    p.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1])
    args = p.parse_args()
    sys.path.insert(0, str(args.repo))
    import mujoco
    from robot_sim.sim import scene_xml
    from robot_sim import g1
    kit = json.loads((args.repo/"configs/lpd8_g1.json").read_text())
    data, audio = args.out/"data", args.out/"audio"
    data.mkdir(parents=True, exist_ok=True)
    audio.mkdir(parents=True, exist_ok=True)

    m = mujoco.MjModel.from_xml_string(scene_xml(kit))
    export_scene(m, mujoco, data)

    loops = {name: mono(fetch(f"{DATA}/music/{name}.wav", args.cache/"music"/f"{name}.wav")) for name in LOOPS}
    gain = {"claps": 1.75, "rims": 1., "shakers": 3.4, "kick": 1., "chords6": 1.}  # training/audio_policy.PART_GAIN
    evaluations = {n: json.loads(fetch(f"{MODELS}/{n}/evaluation_test.json", args.cache/f"eval_{n}.json").read_text())
                   for n in ("three_part", "rims_only", "rims_student")}
    curve = kit["knob_volume"]
    manifest = {"bpm": 65, "bar_s": BAR, "fps": kit["control_hz"], "envelope_hz": ENVELOPE_HZ, "angle_scale": 1e-4,
                "knob_volume": {"silent_below_deg": curve["silent_below_deg"], "full_at_deg": curve["full_at_deg"]},
                "gain": gain, "loops": {}, "parts": {}}
    peaks = []
    for role, name in TAKES.items():
        human, robot = args.cache/"takes"/name, args.cache/"takes"/name
        episode = json.loads(fetch(f"{DATA}/human/{name}/episode.json", human/"episode.json").read_text())
        report = json.loads(fetch(f"{DATA}/robot/{name}/robot.json", robot/"robot.json").read_text())
        npz = np.load(fetch(f"{DATA}/robot/{name}/robot.npz", robot/"robot.npz"))
        first, bars, duration = episode["first_bar"], episode["bars"], float(episode["duration_s"])
        frames = len(npz["time"])
        joints = np.c_[npz["states"][:, :28], npz["knob_angles"][:, report["knobs"].index("knob_4")]]
        targets = g1.to_policy(npz["actions"], kit)
        lo, hi = targets.min(0), targets.max(0)
        t8 = np.round((targets - lo) / np.maximum(hi - lo, 1e-6) * 254 - 127).astype(np.int8)
        (data/f"{role}.bin").write_bytes(np.round(joints / 1e-4).astype(np.int16).tobytes() + t8.tobytes())

        tracks = {part: take_track(loops[part], part, first, bars) * gain[part] for part in LOOPS}
        hits = [round(h["time_s"], 4) for h in report["hits"]]
        expected = [round(e, 4) for e in episode.get("expected_hits_s", [])]
        if role == "shakers":
            angle = npz["knob_angles"][:, report["knobs"].index("knob_4")]
            volume = np.clip((-np.degrees(angle) - curve["silent_below_deg"]) / (curve["full_at_deg"] - curve["silent_below_deg"]), 0, 1)
            played = tracks["shakers"] * np.interp(np.arange(len(tracks["shakers"])) / RATE, npz["time"], volume)
        else:
            src = loops[role]
            shot = src[manifest_onset(manifest, role, src):][:int(.6 * RATE)] * gain[role]
            played = np.zeros_like(tracks[role])
            for h in hits:
                s = int(round(h * RATE))
                played[s:s + len(shot)] += shot[:len(played) - s]
        heard = sum(tracks[p] for p in LOOPS if p != role)
        peaks.append(float(np.abs(heard + played).max()))
        env = {p: envelope(tracks[p], duration) for p in LOOPS}
        env["robot"] = envelope(played, duration)
        runs = {}
        for model in MODEL_RUNS[role]:
            rollouts = [x for x in evaluations[model]["rollouts"] if x["episode"] == name and x["condition"] == "lead"]
            right = [x for x in rollouts if x["role_correct"]]
            mean = lambda k: round(float(np.mean([x[k] for x in right])), 3) if right and right[0].get(k) is not None else None
            runs[model] = {"runs": len(rollouts), "right": len(right), "played": [x["played"] for x in rollouts],
                           "hit_rate": mean("hit_rate") if role != "shakers" else None,
                           "beat_error_ms": mean("beat_error_ms") if role != "shakers" else None,
                           "volume_error": mean("volume_error") if role == "shakers" else None}
        knob = next((c for c in report["report"].get("knob_checks", []) if "volume_error_mean" in c), None)
        manifest["parts"][role] = {
            "take": name, "split": episode["split"], "chords": episode["chords"], "first_bar": first, "bars": bars,
            "duration_s": duration, "frames": frames, "file": f"data/{role}.bin",
            "targets_min": r(lo, 5), "targets_max": r(hi, 5),
            "hits": hits, "expected": expected, "hit_beats": episode.get("hit_beats", []),
            "demo": {"matched": report["report"]["matched"], "expected": report["report"]["expected"],
                     "timing_mae_ms": report["report"]["timing_mae_s"] and round(report["report"]["timing_mae_s"] * 1000, 1),
                     "volume_error": knob and round(knob["volume_error_mean"], 3)},
            "models": runs,
            "envelopes": {p: env[p] for p in env},
        }
    # One scale for every take's envelopes keeps the lanes comparable; 0-99 integers keep the JSON small.
    top = max(float(np.max(e)) for part in manifest["parts"].values() for e in part["envelopes"].values())
    for part in manifest["parts"].values():
        part["envelopes"] = {k: [int(v) for v in np.round(np.sqrt(e / top) * 99)] for k, e in part["envelopes"].items()}
    manifest["master_gain"] = round(.89 / max(peaks), 3)

    for name in LOOPS:
        encode(loops[name], audio/f"{name}.m4a")
        manifest["loops"][name] = {"file": f"audio/{name}.m4a", "samples": len(loops[name])}
    click = np.zeros(RATE // 2, np.float32)
    click[RATE // 4] = .9
    encode(click, audio/"sync.m4a", "128k")
    manifest["sync"] = {"file": "audio/sync.m4a", "click_sample": RATE // 4, "rate": RATE}
    (data/"takes.json").write_text(json.dumps(manifest, separators=(",", ":")))
    print("takes:", {k: (v["take"], v["frames"]) for k, v in manifest["parts"].items()}, "master gain", manifest["master_gain"])


def manifest_onset(manifest, role, loop):
    """A clean hit from the part's own loop, used as the pad's sound: the part's first hit in bar 1."""
    shots = manifest.setdefault("shots", {})
    if role not in shots:
        energy = np.abs(loop[int(BAR * RATE):int(2 * BAR * RATE)])
        first = int(BAR * RATE) + int(np.argmax(energy > .3 * energy.max()))
        shots[role] = {"sample": onset(loop, first / RATE), "length_s": .6}
    return shots[role]["sample"]


if __name__ == "__main__":
    main()
