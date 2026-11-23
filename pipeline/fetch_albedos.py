"""What the temperature of a world is worked out from, as NASA's NSSDCA planetary fact sheets list it
(https://nssdc.gsfc.nasa.gov/planetary/factsheet/): its Bond albedo (the share of all the sunlight
falling on it that it sends back, which is what heats it or not: not the geometric albedo of the
catalogue's `albedo` field, which is how bright it looks face on), the sunlight it gets at its mean
distance from the Sun, and the black-body temperature the sheet works out from the two. For the
worlds whose air is thick enough to warm their ground (a surface pressure of a millibar or more:
Venus, the Earth and Mars), the ground's measured mean temperature and the pressure there. Charon's
Bond albedo is on Pluto's sheet. A world whose sheet lists no Bond albedo has none here: nothing is
estimated.

Output: public/data/solar/albedos.json
"""
from __future__ import annotations

import html
import re

import requests

from common import OUT, UA, write_json

FACT = "https://nssdc.gsfc.nasa.gov/planetary/factsheet/{}fact.html"
# (NAIF ids, as public/data/solar/system.json has them)
SHEETS = {"mercury": 199, "venus": 299, "earth": 399, "moon": 301, "mars": 499, "jupiter": 599,
          "saturn": 699, "uranus": 799, "neptune": 899, "pluto": 999}
CHARON = 901
# air that warms the ground: a measured surface pressure of at least this (bar)
THICK_AIR = 1e-3


def text_of(page: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", page)))


def first(pattern: str, text: str) -> float | None:
    """The first number after `pattern` (the sheets set the world's own value before the Earth's and the ratio)."""
    m = re.search(pattern + r"\s*([-\d.,]+)", text)
    return float(m.group(1).replace(",", "")) if m else None


def main() -> None:
    out = {}
    for sheet, naif in SHEETS.items():
        url = FACT.format(sheet)
        t = text_of(requests.get(url, headers=UA, timeout=60).text)
        rec = {
            "name": sheet.capitalize(),
            "bondAlbedo": first(r"Bond albedo", t),
            "irradiance": first(r"Solar irradiance \(W/m 2 \)", t),
            "blackBodyK": first(r"Black-body temperature \(K\)", t),
            "source": url,
        }
        sp = re.search(r"Surface pressure: ([\d.]+) (bars|mb)", t)
        bar = float(sp.group(1)) / (1000.0 if sp.group(2) == "mb" else 1.0) if sp else None
        if bar is not None and bar >= THICK_AIR:
            rec["surfaceBar"] = bar
            rec["surfaceK"] = first(r"Average temperature: ~?", t)
        out[str(naif)] = {k: v for k, v in rec.items() if v is not None}
        if sheet == "pluto":
            charon = t[t.index("Charon (P1)"):]
            out[str(CHARON)] = {"name": "Charon", "bondAlbedo": first(r"Bond Albedo", charon), "source": url}
        print(f"  {sheet}: {out[str(naif)]}")
    print(f"  charon: {out[str(CHARON)]}")
    write_json(OUT / "solar" / "albedos.json", {
        "source": "NASA NSSDCA Planetary Fact Sheets, https://nssdc.gsfc.nasa.gov/planetary/factsheet/",
        "bodies": out,
    }, compact=False)


if __name__ == "__main__":
    main()
