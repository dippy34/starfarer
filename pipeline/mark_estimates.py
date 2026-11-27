"""Mark which planets' masses and sizes the NASA Exoplanet Archive worked out, not measured.

public/data/exoplanets.json (build_exoplanets.py) takes each planet's mass and radius from the
archive's Planetary Systems Composite Parameters table (`pscomppars`). Where a value was never
measured, the archive fills it in itself, and says so, but build_exoplanets.py did not read that:
  * `pl_bmassprov` is "M-R relationship" when the mass was worked out from the size with a
    mass-radius relation, "Msini" when only the least mass is known (from the star's wobble alone,
    the orbit's tilt unknown), "Mass" or "Msin(i)/sin(i)" when the mass itself is known;
  * `pl_rade_reflink` is "Calculated Value" (refstr=CALCULATED_VALUE) when the radius was worked
    out, from the mass.
This adds those to each planet's "est" list ("mass", "massMin", "radius") and changes nothing else:
no value, no planet added or removed (a full rebuild with build_exoplanets.py, which now reads the
same columns, would also bring in the archive's newer planets and values).

Usage: python3 pipeline/mark_estimates.py
"""
from __future__ import annotations

import csv
import io
import json
import urllib.parse

from common import OUT, RAW, download

TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query={}&format=csv"


def provenance() -> dict[str, tuple[str, bool]]:
    """pl_name -> (pl_bmassprov, radius calculated)"""
    q = "select pl_name,pl_bmassprov,pl_rade_reflink from pscomppars"
    path = download(TAP.format(urllib.parse.quote(q)), RAW / "exoplanets" / "provenance.csv", min_size=100_000)
    out: dict[str, tuple[str, bool]] = {}
    for r in csv.DictReader(io.StringIO(path.read_text())):
        out[r["pl_name"].strip()] = ((r["pl_bmassprov"] or "").strip(), "CALCULATED_VALUE" in (r["pl_rade_reflink"] or ""))
    return out


def marks(prov: str, radius_calculated: bool) -> list[str]:
    """the flags the archive's own provenance gives a planet"""
    out: list[str] = []
    if prov == "M-R relationship":
        out.append("mass")
    elif prov == "Msini":
        out.append("massMin")
    if radius_calculated:
        out.append("radius")
    return out


def main() -> None:
    path = OUT / "exoplanets.json"
    data = json.loads(path.read_text())
    prov = provenance()
    counts = {"mass": 0, "massMin": 0, "radius": 0, "missing": 0}
    for s in data["systems"]:
        for p in s["planets"] or []:
            found = prov.get(p["name"])
            if found is None:
                counts["missing"] += 1
                continue
            for flag in marks(*found):
                if flag not in p["est"]:
                    p["est"].append(flag)
                    counts[flag] += 1
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"), allow_nan=False)
    print(f"  newly marked: {counts['mass']} masses worked out from the size, {counts['massMin']} least masses, "
          f"{counts['radius']} sizes worked out; {counts['missing']} planets not in the archive's table today")


if __name__ == "__main__":
    main()
