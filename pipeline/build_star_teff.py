"""Star temperatures where the colour cannot tell them: from the spectral type, or from Gaia's spectra.

python3 -I pipeline/build_star_teff.py <athyg_40.csv.gz> <hyg_v44.csv.gz> <gaia dir> [data dir]
    (after build_stars.py; the raw files in directories of their own, read with `python3 -I`;
    <gaia dir> from pipeline/fetch_star_teff_gaia.py; the scales from pipeline/teff_scales.json,
    made by pipeline/build_teff_scales.py)

build_stars.py gives every AT-HYG star a temperature from its B-V colour (Ballesteros 2012). The
colour hardly changes above about 10,000 K, so the O and B stars all come out at 10,000 to 15,000 K
(Alnitak, O9.5 Ib, at 13,561 K), and dust between us and a star reddens it (Cygnus X-1's star,
B0 Ib behind about a magnitude of reddening, at 5,501 K). This step:

  * reads each star's spectral type (AT-HYG's `spect`): its letter, subtype and luminosity class;
  * for an O or B star takes the temperature of its type from a published scale
    (pipeline/teff_scales.json): Pecaut & Mamajek 2013 for dwarfs (V, IV, and no class given);
    Martins, Schaerer & Hillier 2005 for O giants (III; II taken as III) and supergiants (I);
    Crowther, Lennon & Walborn 2006 for supergiants from O9.7 to B3; the dwarf scale for the classes
    and subtypes those do not cover (B giants, B supergiants later than B3), and says so.
    Between two subtypes of a scale, the temperature between theirs (in proportion);
  * checks the type against the colour: the colour's own type is the dwarf type of that B-V
    (Pecaut & Mamajek). Within a class (10 subtypes) they agree. A type of a composite spectrum
    ("A1 V + K1 III", "F7V comp") more than a class off is flagged and not used (the colour is the
    pair's). A type more than a class later than the colour cannot be the dust's doing: flagged,
    not used. One more than a class earlier is reddening or a wrong type:
      - an O or B star is taken as reddened (its type used, the excess E(B-V) kept) unless it is
        brighter than its type's M_V allows by more than 1.5 magnitudes (dust only dims): then its
        type is flagged and not used. (Not the other way: the catalogue's distances to far O and B
        stars are often too long, and their colour would be the worse guess by far.)
      - an A to M dwarf (V or IV) is taken as reddened, on the dwarf scale, where its brightness
        fits its type's M_V dimmed by that dust (A_V = R_V E(B-V), R_V = 3.1: Cardelli, Clayton &
        Mathis 1989) within 1.5 magnitudes; otherwise its type is flagged and not used;
      - an A to M giant or supergiant (or one with no class) keeps its colour (no scale for them
        here), and is said to be redder than its type: dust, or a wrong type;
    An A to M star whose type agrees keeps its colour's temperature;
  * where a star's B-V is missing, build_stars.py gave it the median of its spectral class; it is
    marked so;
  * Gaia DR3's ESP-HS temperatures (Gaia's analysis of hot stars, which fits the dust's extinction
    as well) are used where ESP-HS is sure the star is O or B (the second digit of flags_esphs 1
    or 2: the next most likely class at 0.2 at most) and the star has no type of its own, or one
    its colour does not bear out: in their own files, under Gaia's licence, not used with
    ?gaia=0. For the O and B stars that have a type used, Gaia's temperature is only compared.

Writes:
  * the temperature byte of each changed star in public/data/stars/n/<id>.bin (only that byte),
    and its exact value in public/data/stars/named.json;
  * public/data/stars/t/<id>.t, for each node: where each star's temperature comes from, a record
    per star that is not "from its colour" (in slot order): uint16 slot, uint8 code, uint8 E(B-V)
    in hundredths (code: bits 0-2 the source, 0 colour, 1 the median colour of its class, 2 the
    dwarf scale, 3 Martins et al. 2005, 4 Crowther et al. 2006; bit 3 its type flagged and not
    used; bit 4 reddened (the type used, E(B-V) given); bit 5 the dwarf scale for a giant or
    supergiant, for want of one for its class; bit 6 redder than its type, the colour kept; bit 7
    a composite spectrum); and public/data/stars/teff.json (sources, layout, counts);
  * public/data/stars-teff-gaia/n/<id>.g for the nodes with any: uint16 slot, uint16 Teff (K) per
    star, and its index.json (licence, the nodes that have a file).
"""
from __future__ import annotations

import csv
import gzip
import json
import math
import re
import sys
from pathlib import Path

import numpy as np

TEFF_MIN, TEFF_MAX = 1000.0, 50000.0
LETTERS = "OBAFGKM"
COLOUR, CLASS_COLOUR, DWARFS, MARTINS, CROWTHER = 0, 1, 2, 3, 4
FLAGGED, REDDENED, DWARF_FOR_GIANT, REDDER, COMPOSITE = 8, 16, 32, 64, 128
# a class: 10 subtypes; how far (mag) a star's brightness may be from its type's, dimmed by the dust its
# colour asks for, for its type to be taken (the spread of M_V within a subtype and of the distances)
CLASS_SPAN, FIT = 10.0, 1.5
# the dust's extinction in V for a reddening E(B-V): R_V = 3.1, the diffuse interstellar medium's mean
# (Cardelli, Clayton & Mathis 1989, ApJ 345, 245)
R_V = 3.1
SCALES = Path(__file__).resolve().parent / "teff_scales.json"


def bv_to_teff(bv):
    """Ballesteros (2012), EPL 97, 34008 (as build_stars.py)."""
    x = np.clip(bv, -0.4, 2.0)
    return 4600.0 * (1.0 / (0.92 * x + 1.7) + 1.0 / (0.92 * x + 0.62))


def teff_code(t: float) -> int:
    """The tiles' temperature byte (as build_stars.py writes it)."""
    return int(np.clip(np.round((math.log(t) - math.log(TEFF_MIN)) / (math.log(TEFF_MAX) - math.log(TEFF_MIN)) * 255), 0, 255))


# (a class may run on into a qualifier, "IAF": Of; not into a longer class)
LUM = re.compile(r"(IAB|IA0|IA\+|IA|IB|III|II|IV|VI|V|I)(?![IVAB])")


def parse_type(spect: str):
    """(letter, subtype, class) of a catalogue type, class one of 'V', 'III', 'II', 'I' or None; None if not read."""
    s = spect.strip()
    m = re.match(r"([OBAFGKM])(\d+(?:\.\d+)?)", s)
    if not m:
        return None
    rest = s[m.end():].upper()
    # (a second star's type after "+" is not this one's class)
    rest = rest.split("+")[0]
    lm = LUM.search(rest)
    cls = None
    if lm:
        c = lm.group(1)
        cls = "I" if c.startswith("I") and c not in ("III", "II", "IV") else "V" if c in ("IV", "V", "VI") else c
    return m.group(1), float(m.group(2)), cls


def tnum(letter: str, sub: float) -> float:
    return LETTERS.index(letter) * 10 + sub


class Scale:
    def __init__(self, rows):
        rows = [r for r in rows if r["teff"]]
        self.t = np.array([tnum(r["letter"], r["sub"]) for r in rows])
        self.teff = np.array([r["teff"] for r in rows])
        self.mv = np.array([r["mv"] if r.get("mv") is not None else np.nan for r in rows])
        self.bv = np.array([r["bv"] if r.get("bv") is not None else np.nan for r in rows])

    def covers(self, t: float) -> bool:
        return self.t[0] <= t <= self.t[-1]

    def at(self, t: float, what: str) -> float:
        v = getattr(self, what)
        ok = np.isfinite(v)
        return float(np.interp(t, self.t[ok], v[ok])) if self.t[ok][0] <= t <= self.t[ok][-1] else math.nan


def load_rows(athyg: Path, hyg: Path):
    """AT-HYG's rows as build_stars.py keeps them, with its V and B-V (HYG's where it has them) and the B-V fill."""
    h = {}
    with gzip.open(hyg, "rt") as f:
        for row in csv.DictReader(f):
            h[row["id"]] = (row["mag"], row["ci"])
    rows = []
    with gzip.open(athyg, "rt") as f:
        for row in csv.DictReader(f):
            if not row["dist"] or not row["absmag"] or row["id"] == "1" or float(row["dist"]) > 20000:
                continue
            absmag, ci = row["absmag"], row["ci"]
            hh = h.get(row["hyg"])
            if hh:
                if hh[0]:
                    absmag = str(float(hh[0]) - 5 * math.log10(float(row["dist"])) + 5)
                if hh[1]:
                    ci = hh[1]
            rows.append({"id": row["id"], "hip": row["hip"], "hd": row["hd"], "tyc": row["tyc"], "gaia": row["gaia"],
                         "dist": float(row["dist"]), "x": float(row["x0"]), "y": float(row["y0"]), "z": float(row["z0"]),
                         "absmag": float(absmag), "ci": float(ci) if ci else math.nan, "spect": row["spect"]})
    ci = np.array([r["ci"] for r in rows])
    missing = ~np.isfinite(ci)
    cls = np.array([r["spect"][:1] if r["spect"] else "" for r in rows])
    for letter in LETTERS:
        sel = cls == letter
        if np.any(sel & np.isfinite(ci)):
            ci[sel & ~np.isfinite(ci)] = np.nanmedian(ci[sel & np.isfinite(ci)])
    ci[~np.isfinite(ci)] = np.nanmedian(ci)
    return rows, ci, missing


def decide(r, bv: float, bv_missing: bool, sc: dict) -> tuple[float, int, float, str]:
    """(Teff, code, E(B-V), why) for one star."""
    t_col = float(bv_to_teff(bv))
    base = CLASS_COLOUR if bv_missing else COLOUR
    p = parse_type(r["spect"]) if r["spect"] else None
    if not p:
        return t_col, base, 0.0, "no type"
    letter, sub, cls = p
    t = tnum(letter, sub)
    dw = sc["dwarfs"]
    # (a composite spectrum, "A1 V + K1 III" or "F7V comp": the colour is the pair's)
    composite = "+" in r["spect"] or "COMP" in r["spect"].upper()
    # the colour's own type, on the dwarf sequence
    ok = np.isfinite(dw.bv)
    t_of_colour = float(np.interp(bv, dw.bv[ok], dw.t[ok])) if not bv_missing else math.nan
    diff = t_of_colour - t  # > 0: redder than the type

    def fits(mvscale, e: float):
        """does its brightness fit its type's, dimmed by the dust its colour asks for? (None: no M_V to tell)"""
        mv = mvscale.at(t, "mv") if mvscale is not None else math.nan
        return None if not math.isfinite(mv) else abs(r["absmag"] - (mv + R_V * e)) <= FIT

    if letter not in "OB":
        if bv_missing or abs(diff) <= CLASS_SPAN:
            return t_col, base, 0.0, "A-M"
        if composite:
            return t_col, base | FLAGGED | COMPOSITE, 0.0, "A-M composite off its colour"
        if diff < -CLASS_SPAN:
            return t_col, base | FLAGGED, 0.0, "A-M colour earlier than type"
        # redder than its type: dust, or a wrong type. A dwarf (class V or IV) whose brightness fits
        # its type dimmed by that dust is taken as reddened, on the dwarf scale; one that does not is
        # flagged. A giant's or supergiant's colour is kept (no scale for them here), and said to be
        # redder than its type.
        if cls == "V" and dw.covers(t):
            e = max(bv - dw.at(t, "bv"), 0.0)
            if fits(dw, e):
                return dw.at(t, "teff"), DWARFS | REDDENED, e, "A-M dwarf reddened"
            return t_col, base | FLAGGED, 0.0, "A-M dwarf brightness does not fit"
        return t_col, base | REDDER, 0.0, "A-M redder than type"
    # O and B: the scale for its class
    if letter == "O" and cls in ("III", "II") and sc["oGiants"].covers(t):
        scale, src, mvscale = sc["oGiants"], MARTINS, sc["oGiants"]
    elif cls == "I" and sc["bSupergiants"].covers(t) and t > sc["oSupergiants"].t[-1]:
        scale, src, mvscale = sc["bSupergiants"], CROWTHER, None
    elif letter == "O" and cls == "I" and sc["oSupergiants"].covers(t):
        scale, src, mvscale = sc["oSupergiants"], MARTINS, sc["oSupergiants"]
    elif dw.covers(t):
        scale, src, mvscale = dw, DWARFS, dw if cls in (None, "V") else None
    else:
        return t_col, base, 0.0, "O/B type off the scales"
    extra = DWARF_FOR_GIANT if src == DWARFS and cls not in (None, "V") else 0
    t_type = scale.at(t, "teff")
    if bv_missing:
        return t_type, src | extra, 0.0, "type (no colour)"
    if abs(diff) > CLASS_SPAN and composite:
        return t_col, base | FLAGGED | COMPOSITE, 0.0, "composite off its colour"
    if diff < -CLASS_SPAN:
        return t_col, base | FLAGGED, 0.0, "colour earlier than type"
    if diff > CLASS_SPAN:
        # (dust only dims: brighter than its type allows is not reddening. Not the other way: the
        # catalogue's distances to far O and B stars are often too long, and their colour would be
        # far worse a guess than their type)
        e = max(bv - dw.at(t, "bv"), 0.0)
        mv = mvscale.at(t, "mv") if mvscale is not None else math.nan
        if math.isfinite(mv) and r["absmag"] < mv - FIT:
            return t_col, base | FLAGGED, 0.0, "too bright for its type"
        return t_type, src | extra | REDDENED, e, "reddened"
    return t_type, src | extra, 0.0, "type"


def main() -> None:
    athyg, hyg, gdir = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    data = Path(sys.argv[4]) if len(sys.argv) > 4 else Path(__file__).resolve().parent.parent / "public" / "data"
    stars, gdest = data / "stars", data / "stars-teff-gaia"
    scales = json.loads(SCALES.read_text())
    sc = {k: Scale(v["rows"]) for k, v in scales.items()}
    rows, bv, missing = load_rows(athyg, hyg)
    print(f"AT-HYG: {len(rows)} stars, {int(missing.sum())} without B-V")
    # Gaia ESP-HS
    esphs: dict[str, tuple[float, str, str]] = {}
    for p in sorted(gdir.glob("gaia_esphs_*.csv")):
        with open(p) as f:
            for g in csv.DictReader(f):
                if g["teff_esphs"]:
                    esphs[g["source_id"]] = (float(g["teff_esphs"]), g["spectraltype_esphs"], g["flags_esphs"])
    print(f"Gaia ESP-HS: {len(esphs)} temperatures")

    by: dict[str, int] = {}
    for i, r in enumerate(rows):
        for key in (f"#{r['id']}", f"HIP {r['hip']}" if r["hip"] else "", f"HD {r['hd']}" if r["hd"] else "", f"TYC {r['tyc']}" if r["tyc"] else "", f"G{r['gaia']}" if r["gaia"] else ""):
            if key and key not in by:
                by[key] = i
    index = json.loads((stars / "index.json").read_text())
    named_doc = json.loads((stars / "named.json").read_text())
    named = named_doc["stars"]
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

    named_at = {(int(s[7]), int(s[8])): k for k, s in enumerate(named)}
    (stars / "t").mkdir(exist_ok=True)
    for old in (stars / "t").glob("*.t"):
        old.unlink()
    (gdest / "n").mkdir(parents=True, exist_ok=True)
    for old in (gdest / "n").glob("*.g"):
        old.unlink()
    stats: dict[str, int] = {}
    same_byte = diff_byte = unmatched = far = changed = 0
    gaia_nodes, gaia_count, cross = [], 0, []
    t_bytes = g_bytes = 0
    report = {}
    for node in index["nodes"]:
        nid, count, enc = node[0], node[ic], node[ie]
        if count == 0:
            continue
        codes = np.frombuffer((stars / "n" / f"{nid}.ids").read_bytes(), dtype="<u4")
        binp = stars / "n" / f"{nid}.bin"
        buf = bytearray(binp.read_bytes())
        stride, off = (8, 7) if enc == "u" else (16, 13)
        cx, cy, cz, half = node[3], node[4], node[5], node[6]
        if enc == "u":
            q = np.frombuffer(bytes(buf), dtype="<u2").reshape(count, 4)[:, :3]
            pos = (q / 65535.0) * 2 * half + np.array([cx - half, cy - half, cz - half])
        else:
            pos = np.frombuffer(bytes(buf), dtype="<f4").reshape(count, 4)[:, :3].astype(np.float64) + np.array([cx, cy, cz])
        recs, grecs = [], []
        for s in range(count):
            i = row_of(int(codes[s]))
            if i is None:
                unmatched += 1
                continue
            r = rows[i]
            if np.linalg.norm(pos[s] - np.array([r["x"], r["y"], r["z"]])) > 1e-3 * max(r["dist"], 1.0) + 1e-3:
                far += 1
                continue
            # (the colour temperature as build_stars.py wrote it: the check that this is the same star and the same colour)
            if buf[s * stride + off] == teff_code(float(bv_to_teff(bv[i]))):
                same_byte += 1
            else:
                diff_byte += 1
            teff, code, ebv, why = decide(r, float(bv[i]), bool(missing[i]), sc)
            stats[why] = stats.get(why, 0) + 1
            gid = r["gaia"]
            g = esphs.get(gid) if gid else None
            if g and (code & 7) in (DWARFS, MARTINS, CROWTHER) and not code & FLAGGED:
                cross.append((teff, g[0]))
            # (ESP-HS sure of its class: O or B, the next most likely at 0.2 at most, flags_esphs's second
            # digit 1 or 2; and the star with no type of its own, or one its colour does not bear out)
            if (g and (code & 7) in (COLOUR, CLASS_COLOUR) and g[1] in ("O", "B") and len(g[2]) == 2 and g[2][1] in "12"
                    and (why == "no type" or code & (FLAGGED | REDDER))):
                grecs.append((s, int(round(min(g[0], 65535)))))
            if (code & 7) not in (COLOUR, CLASS_COLOUR):
                b = teff_code(teff)
                if buf[s * stride + off] != b:
                    buf[s * stride + off] = b
                    changed += 1
            k = named_at.get((nid, s))
            if k is not None:
                named[k][5] = int(round(teff))
                report[named[k][0][0]] = (r["spect"], round(float(bv_to_teff(bv[i]))), int(round(teff)), code, round(ebv, 2), why, g[0] if g else None)
            if code != COLOUR:
                recs.append((s, code, int(np.clip(round(ebv * 100), 0, 255))))
        binp.write_bytes(bytes(buf))
        data_t = np.array(recs, dtype=[("s", "<u2"), ("c", "u1"), ("e", "u1")]).tobytes() if recs else b""
        (stars / "t" / f"{nid}.t").write_bytes(data_t)
        t_bytes += len(data_t)
        if grecs:
            data_g = np.array(grecs, dtype=[("s", "<u2"), ("t", "<u2")]).tobytes()
            (gdest / "n" / f"{nid}.g").write_bytes(data_g)
            g_bytes += len(data_g)
            gaia_nodes.append(nid)
            gaia_count += len(grecs)
    (stars / "named.json").write_text(json.dumps(named_doc, separators=(",", ":"), allow_nan=False))
    srcs = ["its colour (B-V)", "the median colour of its spectral class (its B-V not known)"] + [scales[k]["source"] for k in ("dwarfs", "oGiants", "bSupergiants")]
    (stars / "teff.json").write_text(json.dumps({
        "for": "stars", "file": "t", "license": "CC BY-SA 4.0 (from AT-HYG's types and colours) with the published scales cited",
        "sources": srcs, "oSupergiants": scales["oSupergiants"]["source"],
        "layout": "records in slot order for the stars whose temperature is not from their colour or that are flagged: uint16 slot, uint8 code, uint8 E(B-V) in hundredths (little-endian)",
        "code": {"bits0to2": ["colour", "class colour", "Pecaut & Mamajek 2013", "Martins et al. 2005", "Crowther et al. 2006"], "8": "type flagged, not used", "16": "reddened (type used)", "32": "dwarf scale for a giant or supergiant", "64": "redder than its type: dust or a wrong type", "128": "composite spectrum"},
        "counts": stats,
    }, indent=1, ensure_ascii=False) + "\n")
    (gdest / "index.json").write_text(json.dumps({
        "license": "CC BY-NC 3.0 IGO (ESA/Gaia/DPAC)",
        "source": "Gaia DR3 astrophysical_parameters, teff_esphs (ESP-HS), from the ESA Gaia Archive, for the AT-HYG stars ESP-HS classes as O or B whose temperature is not from a spectral type",
        "for": "stars", "file": "g", "layout": "records in slot order: uint16 slot, uint16 Teff (K), little-endian", "nodes": gaia_nodes, "count": gaia_count,
    }, separators=(",", ":")))
    print(f"colour byte as shipped: {same_byte}, different: {diff_byte}; unmatched {unmatched}, matched elsewhere {far}")
    print(f"decisions: {stats}")
    print(f"temperature bytes changed: {changed}; .t files {t_bytes / 1e6:.2f} MB; Gaia: {gaia_count} stars in {len(gaia_nodes)} nodes, {g_bytes / 1e6:.2f} MB")
    if cross:
        a = np.array(cross)
        rr = a[:, 1] / a[:, 0]
        print(f"cross-check, type against Gaia ESP-HS: {len(a)} stars, median ratio {np.median(rr):.3f}, within 20 %: {np.mean(np.abs(rr - 1) < 0.2):.3f}")
    for n in ("Alnitak", "Mintaka", "Alnilam", "Naos", "Spica", "Rigel", "Bellatrix", "Saiph", "Cygnus X-1", "Garnet Star", "Bunda", "Almach", "Dubhe", "Deneb", "Betelgeuse", "Vega", "Sirius"):
        if n in report:
            print(" ", n, report[n])
    json.dump(report, open(Path(gdir).parent / "named_report.json", "w"), ensure_ascii=False, indent=0)


if __name__ == "__main__":
    main()
