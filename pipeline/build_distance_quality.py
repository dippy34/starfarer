"""How far each catalogue star's distance can be trusted: public/data/stars-quality/n/<id>.q

Run (after build_stars.py; the raw files in a directory of their own, read with `python3 -I`):
    python3 -I pipeline/build_distance_quality.py <athyg_40.csv.gz> <gaia dir> [data dir]

The catalogue's distances are left as they are; this only says how good each one is. A star of the
AT-HYG catalogue (the stars the app ships in public/data/stars) has its distance from a parallax:
Gaia DR3's for nearly all of them, Gaia DR2's for some thousands, Hipparcos's for some hundreds
(AT-HYG's `dist_src`). Far off, a parallax is a fraction of a milliarcsecond, about the size of its
error, and the distance from it is no better than a guess. Each star is graded:
  1  good:     the parallax is at least 5 times its error (Gaia DR3, or DR2 where the distance is DR2's)
  2  poor:     less than 5 times its error; its parallax and error are kept for the card
  3  Hipparcos only, beyond 500 pc (no Gaia parallax behind the distance; its error not at hand here)
  0  not graded: the distance from Hipparcos within 500 pc, from the Gliese catalogue, or other
The Gaia numbers come from the ESA Gaia Archive (gaiadr3.gaia_source; for the DR2 distances
gaiadr2.gaia_source through gaiadr3.dr2_neighbourhood), fetched for these stars' source ids by
pipeline/fetch_distance_parallaxes.py into <gaia dir>.

Each node of the AT-HYG octree (public/data/stars) gets a file n/<id>.q in public/data/stars-quality,
fetched when one of its stars is chosen. It holds Gaia DR3 (and DR2) numbers, so it is kept beside the
AT-HYG tiles, not in them, under Gaia's licence, as public/data/stars-gaia is; without Gaia (`?gaia=0`)
the app does without it:
  * the grade of each star, 2 bits, four stars a byte in slot order (star s: byte s >> 2, bits 2 (s & 3))
  * then, for each poor star in slot order: int16 parallax and uint16 its error, in microarcseconds
    (little-endian; held to the int16 / uint16 range)
and its own index.json says so.
"""
from __future__ import annotations

import csv
import gzip
import json
import sys
from pathlib import Path

import numpy as np

GOOD, POOR, HIP_FAR, UNGRADED = 1, 2, 3, 0
GOOD_RATIO = 5.0


def load_athyg(path: Path):
    rows = []
    with gzip.open(path, "rt") as f:
        for row in csv.DictReader(f):
            # (the rows build_stars.py keeps)
            if not row["dist"] or not row["absmag"] or row["id"] == "1" or float(row["dist"]) > 20000:
                continue
            rows.append((row["id"], row["hip"], row["hd"], row["tyc"], row["gaia"], float(row["dist"]), row["dist_src"],
                         float(row["x0"]), float(row["y0"]), float(row["z0"])))
    return rows


def load_gaia(gdir: Path) -> tuple[dict[str, tuple[float, float]], dict[str, tuple[float, float]]]:
    dr3: dict[str, tuple[float, float]] = {}
    for p in sorted(gdir.glob("gaia_dr3_plx_*.csv")):
        with open(p) as f:
            for r in csv.DictReader(f):
                if r["parallax"] and r["parallax_error"]:
                    dr3[r["source_id"]] = (float(r["parallax"]), float(r["parallax_error"]))
    dr2: dict[str, tuple[float, float, float]] = {}
    p = gdir / "gaia_dr2_plx.csv"
    if p.exists():
        with open(p) as f:
            for r in csv.DictReader(f):
                if not r["parallax"] or not r["parallax_error"]:
                    continue
                # (the nearest DR2 source to the DR3 one, where the neighbourhood holds several)
                d = float(r["angular_distance"] or 0)
                if r["source_id"] not in dr2 or d < dr2[r["source_id"]][2]:
                    dr2[r["source_id"]] = (float(r["parallax"]), float(r["parallax_error"]), d)
    return dr3, {k: (v[0], v[1]) for k, v in dr2.items()}


def decode_positions(stars: Path, node: list, count: int, enc: str) -> np.ndarray:
    buf = (stars / "n" / f"{node[0]}.bin").read_bytes()
    cx, cy, cz, half = node[3], node[4], node[5], node[6]
    if enc == "u":
        a = np.frombuffer(buf, dtype="<u2").reshape(count, 4)
        return (a[:, :3] / 65535.0) * 2 * half + np.array([cx - half, cy - half, cz - half])
    a = np.frombuffer(buf, dtype="<f4").reshape(count, 4)
    return a[:, :3].astype(np.float64) + np.array([cx, cy, cz])


def main() -> None:
    athyg_path, gdir = Path(sys.argv[1]), Path(sys.argv[2])
    data = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).resolve().parent.parent / "public" / "data"
    stars, dest = data / "stars", data / "stars-quality"
    (dest / "n").mkdir(parents=True, exist_ok=True)
    for old in (dest / "n").glob("*.q"):
        old.unlink()
    rows = load_athyg(athyg_path)
    print(f"AT-HYG: {len(rows)} stars")
    dr3, dr2 = load_gaia(gdir)
    print(f"Gaia: {len(dr3)} DR3 parallaxes, {len(dr2)} DR2 parallaxes")
    by: dict[str, int] = {}
    for i, r in enumerate(rows):
        for key in (f"#{r[0]}", f"HIP {r[1]}" if r[1] else "", f"HD {r[2]}" if r[2] else "", f"TYC {r[3]}" if r[3] else "", f"G{r[4]}" if r[4] else ""):
            if key and key not in by:
                by[key] = i
    index = json.loads((stars / "index.json").read_text())
    named = json.loads((stars / "named.json").read_text())["stars"]
    extra = (stars / "extra_ids.txt").read_text().split("\n")
    n_named = index["idCode"]["notableCount"]
    layout = index["nodeLayout"]
    ic, ie = layout.index("count"), layout.index("enc")

    def row_of(code: int) -> int | None:
        kind, payload = code >> 30, code & 0x3FFFFFFF
        if kind == 1:
            return by.get(f"HIP {payload}")
        if kind == 2:
            return by.get(f"HD {payload}")
        if kind == 3:
            return by.get(f"TYC {payload >> 16}-{(payload >> 2) & 0x3FFF}-{(payload & 3) + 1}")
        if payload < n_named:
            for name in named[payload][0]:
                for pre, k in (("HIP ", "HIP "), ("HD ", "HD "), ("TYC ", "TYC "), ("Gaia DR3 ", "G")):
                    if name.startswith(pre) and (k + name[len(pre):]) in by:
                        return by[k + name[len(pre):]]
            return None
        s = extra[payload - n_named]
        return by.get(f"G{s}") if s.isdigit() else by.get(f"#{s.split(' ')[-1]}") if s.startswith("AT-HYG") else None

    counts = {GOOD: 0, POOR: 0, HIP_FAR: 0, UNGRADED: 0}
    unmatched = far = 0
    total_bytes = 0
    for node in index["nodes"]:
        nid, count = node[0], node[ic]
        if count == 0:
            continue
        codes = np.frombuffer((stars / "n" / f"{nid}.ids").read_bytes(), dtype="<u4")
        pos = decode_positions(stars, node, count, node[ie])
        grade = np.zeros(count, dtype=np.uint8)
        poor: list[tuple[int, int]] = []
        for s in range(count):
            i = row_of(int(codes[s]))
            if i is None:
                unmatched += 1
                continue
            r = rows[i]
            # (the same star: the catalogue's position, to the precision of the tiles)
            if np.linalg.norm(pos[s] - np.array(r[7:10])) > 1e-3 * max(r[5], 1.0) + 1e-3:
                far += 1
                continue
            src, d = r[6], r[5]
            plx = dr3.get(r[4]) if src == "G_R3" else dr2.get(r[4]) if src == "G_R2" else None
            if plx is not None:
                if plx[1] > 0 and plx[0] / plx[1] >= GOOD_RATIO:
                    grade[s] = GOOD
                else:
                    grade[s] = POOR
                    poor.append((int(np.clip(round(plx[0] * 1000), -32768, 32767)), int(np.clip(round(plx[1] * 1000), 0, 65535))))
            elif src == "H" and d > 500:
                grade[s] = HIP_FAR
        for g in counts:
            counts[g] += int((grade == g).sum())
        packed = np.zeros((count + 3) // 4, dtype=np.uint8)
        for k in range(4):
            part = grade[k::4]
            packed[: len(part)] |= part << (2 * k)
        extra_bytes = np.array(poor, dtype="<i2").reshape(-1, 2)
        if len(poor):
            extra_bytes = np.array([(p, e) for p, e in poor], dtype=[("p", "<i2"), ("e", "<u2")])
        data = packed.tobytes() + (extra_bytes.tobytes() if len(poor) else b"")
        (dest / "n" / f"{nid}.q").write_bytes(data)
        total_bytes += len(data)
    meta = {
        "license": "CC BY-NC 3.0 IGO (ESA/Gaia/DPAC)",
        "source": "parallaxes and their errors: ESA Gaia Archive, Gaia DR3 (gaiadr3.gaia_source), and DR2 where AT-HYG's distance is DR2's; distance sources: AT-HYG's dist_src",
        "for": "stars", "file": "q", "grades": ["not graded", "good", "poor", "Hipparcos only, beyond 500 pc"], "goodRatio": GOOD_RATIO,
        "layout": "2 bits a star in slot order (star s: byte s >> 2, bits 2 (s & 3)); then for each poor star in slot order int16 parallax, uint16 its error (microarcseconds, little-endian)",
        "counts": {"good": counts[GOOD], "poor": counts[POOR], "hipparcosFar": counts[HIP_FAR], "notGraded": counts[UNGRADED]},
    }
    (dest / "index.json").write_text(json.dumps(meta, separators=(",", ":"), allow_nan=False))
    print(f"graded: {counts[GOOD]} good, {counts[POOR]} poor, {counts[HIP_FAR]} Hipparcos only beyond 500 pc, {counts[UNGRADED]} not graded; "
          f"{unmatched} not matched to AT-HYG, {far} matched elsewhere; {total_bytes / 1e6:.2f} MB of .q files")


if __name__ == "__main__":
    main()
