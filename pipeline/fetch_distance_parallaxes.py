"""Parallaxes and their errors from the ESA Gaia Archive for AT-HYG's stars, by their Gaia DR3 ids.

python3 -I pipeline/fetch_distance_parallaxes.py <athyg_40.csv.gz> <out dir>   (the raw files in a directory of their own)

For every star the app ships (AT-HYG rows kept as pipeline/build_stars.py keeps them) whose distance
comes from Gaia (dist_src G_R3 or G_R2) the Gaia DR3 source_id is uploaded, in chunks, to the
archive's TAP service and joined with gaiadr3.gaia_source (parallax, parallax_error); for the
distances from Gaia DR2, the DR2 parallax and its error are fetched too, through the archive's
DR3-DR2 neighbourhood table. Results: <out>/gaia_dr3_plx_<k>.csv, <out>/gaia_dr2_plx.csv.
"""
from __future__ import annotations

import csv
import gzip
import io
import sys
import time
from pathlib import Path

import requests

TAP = "https://gea.esac.esa.int/tap-server/tap"
UA = {"User-Agent": "starfarer-pipeline (distance quality)"}
CHUNK = 200_000
# (the archive returns 50,000 rows unless asked for more)
MAXREC = 250_000


def ids_votable(ids: list[str]) -> bytes:
    rows = "".join(f"<TR><TD>{i}</TD></TR>" for i in ids)
    return ('<?xml version="1.0"?><VOTABLE version="1.3" xmlns="http://www.ivoa.net/xml/VOTable/v1.3"><RESOURCE><TABLE>'
            '<FIELD name="source_id" datatype="long"/><DATA><TABLEDATA>' + rows + "</TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>").encode()


def run_job(query: str, upload: bytes, dest: Path, expect: int, tries: int = 5) -> None:
    for attempt in range(tries):
        try:
            r = requests.post(f"{TAP}/async", headers=UA, allow_redirects=False, timeout=600,
                              data={"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "PHASE": "RUN",
                                    "QUERY": query, "UPLOAD": "ids,param:ids", "MAXREC": str(MAXREC)},
                              files={"ids": ("ids.xml", upload, "application/x-votable+xml")})
            job = r.headers.get("Location")
            if not job:
                raise RuntimeError(f"no job location: {r.status_code} {r.text[:300]}")
            print("  job", job, flush=True)
            while True:
                phase = requests.get(f"{job}/phase", headers=UA, timeout=60).text.strip()
                if phase in ("COMPLETED", "ERROR", "ABORTED"):
                    break
                time.sleep(10)
            if phase != "COMPLETED":
                raise RuntimeError(f"job {phase}: {requests.get(f'{job}/error', headers=UA, timeout=60).text[:300]}")
            with requests.get(f"{job}/results/result", headers=UA, timeout=1800, stream=True) as res:
                res.raise_for_status()
                tmp = dest.with_suffix(".part")
                with open(tmp, "wb") as f:
                    for chunk in res.iter_content(1 << 20):
                        f.write(chunk)
                rows = sum(1 for _ in open(tmp)) - 1
                if rows >= MAXREC or rows < expect * 0.99:
                    raise RuntimeError(f"{rows} rows for {expect} ids")
                tmp.replace(dest)
            print(f"  {rows} rows", flush=True)
            return
        except Exception as e:  # noqa: BLE001
            print(f"  attempt {attempt + 1}: {e}", flush=True)
            time.sleep(30 * (attempt + 1))
    raise RuntimeError(f"gave up: {dest.name}")


def main() -> None:
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    dr3, dr2 = [], []
    with gzip.open(src, "rt") as f:
        for row in csv.DictReader(f):
            if not row["dist"] or not row["absmag"] or row["id"] == "1" or float(row["dist"]) > 20000 or not row["gaia"]:
                continue
            if row["dist_src"] == "G_R3":
                dr3.append(row["gaia"])
            elif row["dist_src"] == "G_R2":
                dr2.append(row["gaia"])
    print(f"{len(dr3)} Gaia DR3 distances, {len(dr2)} Gaia DR2 distances", flush=True)
    for k in range(0, len(dr3), CHUNK):
        dest = out / f"gaia_dr3_plx_{k // CHUNK}.csv"
        if dest.exists():
            continue
        print(f"DR3 chunk {k // CHUNK}: {len(dr3[k:k + CHUNK])} ids", flush=True)
        run_job("SELECT g.source_id, g.parallax, g.parallax_error FROM gaiadr3.gaia_source AS g "
                "JOIN TAP_UPLOAD.ids AS u ON g.source_id = u.source_id", ids_votable(dr3[k:k + CHUNK]), dest, len(dr3[k:k + CHUNK]))
    dest = out / "gaia_dr2_plx.csv"
    if dr2 and not dest.exists():
        print(f"DR2: {len(dr2)} ids", flush=True)
        run_job("SELECT n.dr3_source_id AS source_id, d.parallax, d.parallax_error, n.angular_distance "
                "FROM gaiadr3.dr2_neighbourhood AS n JOIN TAP_UPLOAD.ids AS u ON n.dr3_source_id = u.source_id "
                "JOIN gaiadr2.gaia_source AS d ON d.source_id = n.dr2_source_id", ids_votable(dr2), dest, int(len(dr2) * 0.5))
    print("done", flush=True)


if __name__ == "__main__":
    main()
