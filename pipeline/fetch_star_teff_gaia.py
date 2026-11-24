"""Gaia DR3's temperatures of hot stars (ESP-HS) for AT-HYG's stars, by their Gaia DR3 ids.

python3 -I pipeline/fetch_star_teff_gaia.py <athyg_40.csv.gz> <out dir>   (the raw files in a directory of their own)

For every star the app ships (AT-HYG rows kept as pipeline/build_stars.py keeps them) that has a Gaia
DR3 source_id, the id is uploaded, in chunks, to the ESA Gaia Archive's TAP service and joined with
gaiadr3.astrophysical_parameters, keeping the stars ESP-HS (Gaia's analysis of hot stars, which fits
the dust's extinction along with the temperature) gave a temperature: teff_esphs, its uncertainty,
spectraltype_esphs and flags_esphs. Results: <out>/gaia_esphs_<k>.csv.
"""
from __future__ import annotations

import csv
import gzip
import importlib.util
import sys
from pathlib import Path

# (the archive job runner of the parallax fetch: same service, same checks)
_spec = importlib.util.spec_from_file_location("fetch_distance_parallaxes", Path(__file__).resolve().parent / "fetch_distance_parallaxes.py")
_fdp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fdp)

CHUNK = 200_000


def main() -> None:
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    ids = []
    with gzip.open(src, "rt") as f:
        for row in csv.DictReader(f):
            if not row["dist"] or not row["absmag"] or row["id"] == "1" or float(row["dist"]) > 20000 or not row["gaia"]:
                continue
            ids.append(row["gaia"])
    print(f"{len(ids)} AT-HYG stars with a Gaia DR3 id", flush=True)
    for k in range(0, len(ids), CHUNK):
        dest = out / f"gaia_esphs_{k // CHUNK}.csv"
        if dest.exists():
            continue
        part = ids[k:k + CHUNK]
        print(f"chunk {k // CHUNK}: {len(part)} ids", flush=True)
        # (only the stars with an ESP-HS temperature come back: no count to expect, only the cap)
        _fdp.run_job("SELECT a.source_id, a.teff_esphs, a.teff_esphs_uncertainty, a.spectraltype_esphs, a.flags_esphs "
                     "FROM gaiadr3.astrophysical_parameters AS a JOIN TAP_UPLOAD.ids AS u ON a.source_id = u.source_id "
                     "WHERE a.teff_esphs IS NOT NULL", _fdp.ids_votable(part), dest, 0)
    print("done", flush=True)


if __name__ == "__main__":
    main()
