"""Temperature scales by spectral type, from their published tables: pipeline/teff_scales.json

python3 -I pipeline/build_teff_scales.py <mamajek txt> <martins 2386.tex> <crowther astro-ph.tex>
    (the downloads in directories of their own; read only as text)

  * dwarfs (V, and IV): E. Mamajek's online table "A Modern Mean Dwarf Stellar Color and Effective
    Temperature Sequence" (Pecaut & Mamajek 2013, ApJS 208, 9), the version given in its header;
    https://www.pas.rochester.edu/~emamajek/EEM_dwarf_UBVIJHK_colors_Teff.txt (O3 V to M9.5 V kept:
    Teff, M_V, B-V)
  * O giants (III) and supergiants (I): Martins, Schaerer & Hillier 2005 (A&A 436, 1049), their
    observational temperature scale, tables 4-6 (luminosity classes V, III, I: Teff, M_V); from the
    paper's source files, arXiv astro-ph/0503346
  * early B supergiants (O9.5 to B3, Ia and Iab): Crowther, Lennon & Walborn 2006 (A&A 446, 279),
    the mean temperature of their table comparing temperature scales (labelled "bstars" in the
    source; its last column: their galactic, line-blanketed scale, the hypergiants left out); from
    the paper's source files, arXiv astro-ph/0509436

The values are copied as they stand; nothing is fitted. Subtypes between two of a table's are taken
between them when the stars are graded (pipeline/build_star_teff.py), not here.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent / "teff_scales.json"


def mamajek(path: Path) -> tuple[str, list[dict]]:
    text = path.read_text()
    version = re.search(r"#\s*Version\s+([0-9.]+)", text).group(1)
    rows = []
    lines = text.split("\n")
    head = next(i for i, l in enumerate(lines) if l.startswith("#SpT"))
    cols = lines[head][1:].split()
    for line in lines[head + 1:]:
        if line.startswith("#"):
            break
        f = line.split()
        if not f:
            continue
        m = re.fullmatch(r"([OBAFGKM])(\d+(?:\.\d+)?)V", f[0])
        if not m:
            continue
        v = dict(zip(cols, f))
        num = lambda k: float(v[k]) if re.fullmatch(r"-?\d+(\.\d+)?", v.get(k, "")) else None  # noqa: E731
        rows.append({"type": f[0], "letter": m.group(1), "sub": float(m.group(2)), "teff": num("Teff"), "mv": num("Mv"), "bv": num("B-V")})
    return version, rows


def martins(path: Path) -> dict[str, list[dict]]:
    text = path.read_text()
    out = {}
    for label, cls in (("tab_V_obs", "V"), ("tab_III_obs", "III"), ("tab_I_obs", "I")):
        block = text[text.index("\\label{" + label + "}"):]
        block = block[: block.index("\\end{tabular}")]
        rows = []
        for line in block.split("\n"):
            f = [x.strip() for x in line.split("&")]
            if len(f) > 4 and re.fullmatch(r"\d+(\.\d+)?", f[0]):
                rows.append({"type": f"O{f[0]} {cls}", "letter": "O", "sub": float(f[0]), "teff": float(f[1]), "mv": float(f[3])})
        out[cls] = rows
    return out


def crowther(path: Path) -> list[dict]:
    text = path.read_text()
    block = text[text.index("\\label{bstars}"):]
    block = block[: block.index("\\end{tabular}")]
    rows = []
    # (a row ends at "\\"; one of them runs over two lines)
    for line in block.replace("\n", " ").split("\\\\"):
        m = re.search(r"([OB])(\d+(?:\.\d+)?)\\,Ia\s*&", line)
        if not m:
            continue
        last = line.split("&")[-1].strip()
        rows.append({"type": f"{m.group(1)}{m.group(2)} Ia", "letter": m.group(1), "sub": float(m.group(2)), "teff": float(last) * 1000})
    return rows


def main() -> None:
    mm, mt, cw = (Path(p) for p in sys.argv[1:4])
    version, dwarfs = mamajek(mm)
    scales = {
        "dwarfs": {"source": f"Pecaut & Mamajek 2013 (ApJS 208, 9), E. Mamajek's online table, version {version}", "short": "Pecaut & Mamajek 2013", "rows": dwarfs},
        "oGiants": {"source": "Martins, Schaerer & Hillier 2005 (A&A 436, 1049), observational scale, table 5 (luminosity class III)", "short": "Martins et al. 2005", "rows": martins(mt)["III"]},
        "oSupergiants": {"source": "Martins, Schaerer & Hillier 2005 (A&A 436, 1049), observational scale, table 6 (luminosity class I)", "short": "Martins et al. 2005", "rows": martins(mt)["I"]},
        "bSupergiants": {"source": "Crowther, Lennon & Walborn 2006 (A&A 446, 279), their temperature scale of galactic early B Ia and Iab supergiants (the table labelled bstars), its mean column", "short": "Crowther et al. 2006", "rows": crowther(cw)},
    }
    OUT.write_text(json.dumps(scales, indent=1) + "\n")
    for k, v in scales.items():
        print(k, len(v["rows"]), v["rows"][0]["type"], "...", v["rows"][-1]["type"])


if __name__ == "__main__":
    main()
