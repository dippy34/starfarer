# Starfarer

*(working title)*

A mobile-first, browser-based explorer of the whole observable universe.
Start in orbit around Earth, pinch out past the planets, the 2.2 million real
stars of the solar neighbourhood, the Milky Way, 2.6 million real galaxies and
750 thousand real quasars — and keep going into a procedural universe that
fills in everything the surveys never reached. Or go the other way: pick a
star, find its planets, and fly down to the ground.

- **Explore mode** is complete. **Play mode** is registered in the mode
  switcher as "Coming soon"; nothing else of it exists yet.
- TypeScript + Vite + three.js (WebGL2), Web Workers for all decoding and
  generation, no backend. The build output is static files, ready to be served
  from anywhere or wrapped with Capacitor.
- Every judgment call made while building this is recorded in
  [`DECISIONS.md`](./DECISIONS.md).

---

## Run it

Requires Node 20 or newer.

```bash
npm install
npm run dev        # http://localhost:5173 (also listening on your LAN address)
```

The catalogue data (`public/data/`, 67 MB) is committed, so there is nothing to
download first.

```bash
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ locally, as a static host would
npm run check      # typecheck, lint, unit tests and production build in one go
```

`dist/` is a plain static site with relative URLs: copy it to any static host
or point Capacitor's `webDir` at it.

### Try it on a phone over your local network

1. Put the phone and the computer on the same Wi-Fi.
2. `npm run dev` — Vite prints a `Network:` address such as
   `http://192.168.1.23:5173`. Open that on the phone.
3. For the real thing (service worker, offline cache, "Add to Home Screen"),
   browsers require HTTPS on anything but `localhost`. Either
   - Android: `adb reverse tcp:4173 tcp:4173`, run `npm run build && npm run preview`
     and open `http://localhost:4173` on the phone, or
   - tunnel the preview server through any HTTPS tunnel
     (`cloudflared tunnel --url http://localhost:4173`, `ngrok http 4173`, …).
4. Turn on **Settings → Performance HUD** to see frames per second, draw
   calls, point count and the quality tier the adaptive controller chose.

---

## Controls

| | Touch | Mouse / keyboard |
| --- | --- | --- |
| Look around (or circle the thing you flew to) | drag with one finger | drag |
| Move toward / away from what you are looking at | pinch | scroll wheel |
| Fly | throttle slider on the right (double-tap it to stop) | `W` `S` / `↑` `↓` (hold `Shift` to boost), `A` `D` strafe, `R` `F` up / down |
| Roll | twist with two fingers | right-drag, `Q` `E` |
| Select something | tap it | click it |
| Fly to it | double-tap, or **Fly there** on its card | double-click, `G` |
| Land on it | **Land** on its card | `L` |
| Stop | double-tap the throttle | `Space` |
| Search | 🔍 | `/` |
| Time | ⏸ 1× ▶▶ ▶▶▶ ⏩ buttons | `[` and `]` |
| Photo mode | 📷 | `P` |
| Back out (close card, stop orbiting, leave photo mode) | ✕ | `Esc` |

Speed scales with the distance to the nearest object, so the same throttle
setting crawls over a landscape and crosses superclusters.

**Search** understands names (*Saturn*, *Betelgeuse*, *M 31*, *TRAPPIST-1 e*,
*Sgr A\**), catalogue ids (*HIP 32349*), sky coordinates with an optional
distance (`10h 08m 22s +11° 58′ 79 ly`, `RA 187.7 Dec 12.39 16.5 Mpc`), the
stable ids shown in Show data, and any other word, which is used as a seed and
always leads to the same procedural galaxy.

**Share** copies a link whose `#…` fragment holds the camera's exact position,
orientation and the simulation time; opening it restores the view.
**Bookmarks** and **recents** are stored on the device.

**Settings:** Show data (real numbers on the info card: distance, temperature,
mass, radius, gravity, orbital period, spectral class, redshift, catalogue id;
time dilation near black holes), quality (auto / low / medium / high), sound,
haptics, labels, constellation lines, orbit lines, performance HUD.

---

## What is real and what is imagined

Every info card carries a **Real** or **Imagined** badge.

| Real (from catalogues, at their measured positions) | Imagined (procedural, deterministic) |
| --- | --- |
| 2 256 935 stars: all of Gaia DR3 brighter than G = 11.5, every known star within 100 pc, Hipparcos for the brightest | stars fainter than the catalogue limit, and all stars of other galaxies |
| 2 650 418 galaxies (2MRS, Updated Nearby Galaxy Catalog, OpenNGC, SDSS DR17) and 750 402 SDSS DR16Q quasars | galaxies the surveys did not reach, the cosmic web between them, and how every galaxy looks up close |
| 6 161 confirmed exoplanets around 4 564 stars: orbits, masses, radii | what those planets look like; planets of stars with no known planets |
| 7 071 nebulae, clusters, pulsars and black holes with measured distances | the gas of nebulae and the member stars of clusters |
| The Solar System's orbits, sizes, masses, spins and rings | its surfaces (procedural; see DECISIONS.md) |
| 88 constellations | — |

The same coordinates always produce the same result on every device: procedural
content is a pure function of one universe seed and integer coordinates, and
nothing procedural is ever stored.

---

## Rebuilding the catalogues

```bash
npm run build:catalogs                       # download everything (≈ 0.7 GB raw, 30–60 min) and build
npm run build:catalogs -- --skip-download    # rebuild public/data from the raw files already on disk (≈ 8 min)
npm run build:catalogs -- --download-only
```

Environment variables: `VIZIER_HOST` (default `vizier.cfa.harvard.edu`; the
Strasbourg original is `vizier.cds.unistra.fr`), `GAIA_G_LIMIT` (default 11.5).

The pipeline (`scripts/build-catalogs/`) downloads from the official archives
into `scripts/build-catalogs/.raw/` (git-ignored), cleans and cross-matches the
catalogues, quantises them and writes:

```
public/data/
  manifest.json          datasets, octree node tables, file sizes, catalogue limits
  stars/ galaxies/ sdss/ quasars/
      r<octants>.bin     one tile: ≤ 4096 stars or ≤ 2048 galaxies, columnar, delta-coded, DEFLATE
      r<octants>.id      (stars) Gaia DR3 / Hipparcos ids, fetched only when a star is selected
  names/n0.bin …         searchable names; n0 (the famous ones) is part of the first download
  exoplanets.bin  dso.bin  constellations.bin  notable.json
  lss.bin                real large-scale-structure density + survey footprint (for procedural fill)
  BUILD_REPORT.json      every count, every object dropped and why
```

Downloads are resumable and verified: the Gaia step, for example, compares its
row total with the archive's own count and fails rather than ship a partial
sky. If a source is unreachable the build stops with the failing URL; nothing
is ever substituted or invented.

Last build: 5 670 987 objects, 67.7 MB in total, 3.0 MB fetched before the
Start button enables.

---

## Architecture

```
src/
  core/       maths with no dependencies: hashing, seeded PRNG, deterministic transcendentals,
              high-precision universe positions, units, astronomy, cosmology, colour, noise
  universe/   pure generators (no rendering, no DOM): cosmic web, galaxies, star fields, stars,
              planetary systems, planets, terrain, the Solar System, the Milky Way model
  data/       tile format + schemas (shared with the build pipeline), LOD selection,
              catalogue loader, tile streamer, names/search table, worker pool, the data worker
  render/     three.js: engine + adaptive quality, point layers, galaxy volumes, nebulae,
              star / planet / ring / atmosphere / cloud shaders, quadtree terrain,
              black-hole lensing pass, HDR post-processing
  input/      pointer / wheel / keyboard → look, pinch, twist, tap, double-tap
  platform/   interfaces for storage, blob cache, share, haptics, audio, links, lifecycle,
              device — with web implementations (swap them with setPlatform() for Capacitor)
  state/      observable app state; persisted settings, bookmarks, recents
  ui/         start screen, HUD, info card, panels (plain DOM + CSS, safe-area aware)
  modes/      mode registry + state machine
    explore/  the Explore mode: world management, camera, search, links, labels
    play/     registered as "Coming soon" — nothing else
scripts/build-catalogs/   the reproducible catalogue pipeline
tests/        unit tests (vitest)
```

Some things worth knowing before changing anything:

- **Positions** are `UPos`: integer sector indices (2⁴⁰ m each) plus a float64
  offset, exact to well under a millimetre across 10²⁶ m. The three.js camera
  never leaves the origin; everything is rendered relative to it.
- **Everything heavy runs in workers** (`src/data/worker/dataWorker.ts`): tile
  decompression, star and galaxy cell generation, terrain meshing.
- **Level of detail.** Catalogue tiles form brightness-ordered octrees. Our own
  sky (stars, bright and nearby galaxies) is ordered by apparent brightness,
  so the showpieces are always loaded; the deep surveys are ordered by
  luminosity, evenly sampled from afar and refined around the camera. The
  streamer loads what matters from where the camera is within the tier's
  point budget and evicts the rest (`src/data/lod.ts`, DECISIONS.md §4.8).
  Procedural content lives in level-of-detail cells keyed by integer
  coordinates. Terrain is a cube-sphere quadtree.
- **Budgets** for points, draw calls and shader work per quality tier are in
  `src/render/qualityTiers.ts`; `src/render/quality.ts` moves between tiers
  from measured frame time.
- **Adding a mode:** create `src/modes/<name>/index.ts`, call
  `modes.register({ id, title, tagline, icon, available: true, order, create })`
  and import the file from `src/main.ts`. The start screen picks it up.
- **Platform services** are only reached through `platform.*`; an ESLint rule
  enforces it.

---

## Tests

```bash
npm test
```

60 unit tests cover determinism (same coordinates → same galaxies, stars,
systems and terrain; a pinned snapshot guards against accidental generator
changes), physical sanity of generated stars, planets, systems and galaxies,
the real Solar System, coordinate precision at the edge of the universe, tile
and id round trips, quantisation bounds, regeneration of IAU designations,
the catalogue octree builder, level-of-detail selection, spectral-type
parsing, share links, coordinate parsing and number formatting.

---

## Data sources, licences and attribution

Starfarer redistributes derived, quantised subsets of the following. Please
keep these acknowledgements with any copy of `public/data/`.

| Data | Source | Terms |
| --- | --- | --- |
| Stars: positions, parallaxes, magnitudes, colours | **Gaia DR3** and the **Gaia Catalogue of Nearby Stars** (ESA/Gaia/DPAC), via the ESA Gaia Archive | Free to use with the acknowledgement below |
| Bright stars | **Hipparcos** main catalogue (ESA 1997) and the new reduction (van Leeuwen 2007), via VizieR | ESA; free with acknowledgement |
| Star names | **IAU Working Group on Star Names** catalogue; Bayer / Flamsteed designations from the HD–DM–GC–HR–HIP–Bayer–Flamsteed cross index (Kostjuk 2002, VizieR IV/27A) | Public |
| Constellation figures (which stars are joined) | **Stellarium** "modern" sky culture | Distributed with Stellarium (GPL-2.0-or-later); see the licensing note in DECISIONS.md |
| Galaxies | **2MASS Redshift Survey** (Huchra et al. 2012, ApJS 199, 26); **Updated Nearby Galaxy Catalog** (Karachentsev et al. 2013, AJ 145, 101) | Published catalogues via VizieR |
| Galaxies and quasars | **Sloan Digital Sky Survey** DR17 (SpecPhoto) and the **DR16 quasar catalogue** (Lyke et al. 2020, ApJS 250, 8) | SDSS data are public; acknowledgement below |
| NGC / IC / Messier objects | **OpenNGC** (Mattia Verga) | **CC BY-SA 4.0** |
| Exoplanets | **NASA Exoplanet Archive**, Planetary Systems Composite Parameters | Public; acknowledgement below |
| Globular clusters | Harris (1996, 2010 edition) | Published catalogue via VizieR |
| Open clusters | Hunt & Reffert (2023, A&A 673, A114) | Published catalogue via VizieR |
| Planetary nebula distances | González-Santamaría et al. (2021, A&A 656, A51) | Published catalogue via VizieR |
| Pulsars | **ATNF Pulsar Catalogue** (Manchester et al. 2005, AJ 129, 1993), via VizieR | Free with citation |
| Solar System orbits | **JPL Horizons** (NASA/JPL) | Public domain |
| A few famous objects (black-hole masses, nebula distances, …) | Individual papers, cited per entry in `scripts/build-catalogs/curated/notable.json` | — |

Required acknowledgements:

> This work has made use of data from the European Space Agency (ESA) mission
> *Gaia* (https://www.cosmos.esa.int/gaia), processed by the *Gaia* Data
> Processing and Analysis Consortium (DPAC,
> https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC
> has been provided by national institutions, in particular the institutions
> participating in the *Gaia* Multilateral Agreement.

> Funding for the Sloan Digital Sky Survey IV has been provided by the Alfred
> P. Sloan Foundation, the U.S. Department of Energy Office of Science, and the
> Participating Institutions. SDSS acknowledges support and resources from the
> Center for High-Performance Computing at the University of Utah. The SDSS web
> site is www.sdss.org.

> This research has made use of the NASA Exoplanet Archive, which is operated
> by the California Institute of Technology, under contract with the National
> Aeronautics and Space Administration under the Exoplanet Exploration Program.

> This research has made use of the VizieR catalogue access tool, CDS,
> Strasbourg, France (DOI: 10.26093/cds/vizier), and of data products from the
> Two Micron All Sky Survey, a joint project of the University of Massachusetts
> and IPAC/Caltech, funded by NASA and the NSF.

> NGC/IC/Messier data © OpenNGC contributors, licensed CC BY-SA 4.0
> (https://github.com/mattiaverga/OpenNGC). The derived deep-sky and galaxy
> files in `public/data/` that include OpenNGC content are shared under the
> same licence.

The same credits are shown in the app under **Settings → About**.

Code dependencies: three.js (MIT), fflate (MIT).
