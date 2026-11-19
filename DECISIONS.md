# Decisions

You asked me not to ask questions, so every judgment call is written down here:
what I decided, why, and what it costs. Sections are ordered roughly from
"things you would notice" to "things only a maintainer cares about".

---

## 1. Scope and product decisions

| Decision | Why |
| --- | --- |
| **Working title kept: "Starfarer".** | Used in the UI, manifest and package name; one string to change in `index.html`, `public/manifest.webmanifest`, `src/ui/shell.ts` and `package.json`. |
| **Explore is the only playable mode. Play is a registered, disabled entry ("Coming soon").** | `src/modes/registry.ts` is a small state machine (`idle → entering → active → exiting`). A mode is one `modes.register({...})` call plus a class with `enter / update / exit`; the start screen builds its cards from the registry, so adding a mode needs no restructuring. `src/modes/play/index.ts` is the only intentional placeholder in the codebase. |
| **"Show data" is a setting (off by default), not a mode.** | Off: the info card shows name, type, one friendly sentence and the distance. On: the same card gains the real numbers (mass, radius, gravity, temperature, orbital period, spectral class, redshift, catalogue id, …), the time-dilation readout near black holes, and each value that is an estimate rather than a measurement is tagged "est.". |
| **After "Fly there" the camera orbits the target** (drag circles around it, pinch changes distance) **until you touch the throttle or press ✕ on the chip.** | Casual players lose a planet instantly in free flight. Orbit-focus keeps it centred; the camera is also carried along by the body, so a planet does not drift away at 30 km/s while you look at it. |
| **The universe is drawn "as it is now" (a comoving snapshot), not as light reaches us.** | A galaxy at redshift 2 is placed at its comoving distance (Planck 2018 flat ΛCDM, `src/core/cosmology.ts`) and looks like a present-day galaxy when you arrive. Drawing look-back-time evolution would make "fly there" meaningless. Redshift and look-back time are still shown in Show data. |
| **Radius of the playable universe: 14 260 Mpc comoving** (≈ 46.5 billion light-years). Nothing is generated beyond it. |  The particle horizon for the adopted cosmology. |
| **Time control: pause, 1×, 1 hour/s, 1 day/s, 30 days/s.** | "Fast" and "very fast" were not specified; these make a day/night cycle, a moon orbit and a planetary year each watchable. |
| **Sound is synthesised, not sampled.** | No audio assets to licence or download. `AudioEngine` (in `src/platform/types.ts`) is the simple sound-manager interface that was asked for: ambient scene, warp, black-hole rumble (low, rising with proximity), one-shot effects. The Web Audio implementation can be replaced by a native one. |

---

## 2. Real data: what is in, what is not, and what I refused to invent

**Rule followed throughout: no catalogue value is fabricated.** Where a source
lacks a value the object is either left out (and counted in
`public/data/BUILD_REPORT.json`) or the value is shown as unknown. Where a
*derived* value is displayed (a star's radius from its brightness and colour)
it is labelled "est.".

### 2.1 What the build produced (last run)

| Dataset | Objects | Source |
| --- | ---: | --- |
| Stars | 2 256 935 | Gaia DR3 (G < 11.5 complete) + Gaia Catalogue of Nearby Stars (all 331 k within 100 pc) + Hipparcos (bright stars Gaia lacks) + exoplanet hosts |
| Galaxies (nearby, with shapes) | 46 237 | 2MRS + Updated Nearby Galaxy Catalog + OpenNGC |
| Galaxies (SDSS spectroscopic) | 2 604 181 | SDSS DR17 SpecPhoto, class GALAXY |
| Quasars | 750 402 | SDSS DR16Q |
| Exoplanets | 6 161 (4 564 host stars) | NASA Exoplanet Archive, composite parameters |
| Deep-sky objects | 7 071 | OpenNGC non-galaxies, Harris globulars, Hunt & Reffert clusters, PN distances, ATNF pulsars, a small curated list |
| **Total** | **5 670 987** | 67.7 MB on disk; 3.0 MB fetched before the Start button enables |

Targets were ≥ 1 M (aim 2 M+), ≥ 1 M stars, ≥ 300 k galaxies, ~750 k quasars,
< 10 MB initial, < 100 MB total: all met.

### 2.2 Source-by-source decisions

- **Gaia DR3 is fetched from the ESA archive in ~90 magnitude slices.**
  Anonymous TAP jobs are killed after 60 s and results are silently capped at
  50 000 rows unless `MAXREC` is raised. The downloader sizes slices with the
  star-count law N(<G) ∝ 10^0.43G, bisects any slice that still times out, and
  finally checks the row total against the archive's own `COUNT(*)`
  (`gaia/COMPLETE.json`). A partial download fails the build rather than
  shipping a sky with holes.
- **Magnitude limit G < 11.5** (≈ 1.9 M stars) rather than the full 1.8 billion:
  it is the deepest limit that keeps the star tiles near 35 MB with ids. Fainter
  stars are procedural (see 3.2).
- **Distances are computed in the build, not joined from Bailer-Jones et al.**
  The join does not finish within the anonymous time limit. Instead:
  parallax zero-point +0.017 mas; if parallax S/N ≥ 5 the distance is 1/ϖ;
  otherwise the mode of the exponentially-decreasing-space-density posterior
  (Bailer-Jones 2015, L = 1.35 kpc), and the star is flagged "distance is a
  prior-based estimate" (25 459 stars). 15 609 Gaia stars without a parallax
  are dropped (they cannot be placed in 3-D) — except Hipparcos stars, which
  fall back to the Hipparcos parallax (1 387 rescued).
- **VizieR is read through the CfA mirror** (`vizier.cfa.harvard.edu`) because
  the Strasbourg host was not reachable from the build sandbox. Same data;
  override with `VIZIER_HOST=vizier.cds.unistra.fr`.
- **HyperLEDA is not used** (I did not attempt a bulk download from it).
  The procedural fill has to know *which* galaxies a catalogue would have
  contained, or the two overlap and leave seams. 2MRS (K < 11.75 over the whole
  sky outside the Galactic plane) and the SDSS main sample (r < 17.77 inside a
  footprint) have clean selection functions; HyperLEDA is a compilation of
  many surveys and has none. Galaxies therefore come from 2MRS (43 533 with
  redshifts), the Updated Nearby Galaxy Catalog (redshift-independent
  distances for 868 neighbours, which matter because nearby redshifts are
  dominated by peculiar motion), OpenNGC (names, sizes, Hubble types for the
  NGC/IC/Messier galaxies) and SDSS. The 300 k target is exceeded nine times
  over. The natural next catalogue is 6dFGS, which has a clean K limit over the
  southern sky.
- **SDSS galaxies are DR17, quasars DR16Q**, as requested for quasars; DR17 is
  the final SDSS-IV spectroscopic release for galaxies.
- **Galaxy distances are Hubble-flow distances** from the redshift corrected to
  the Local Group frame (Karachentsev & Makarov 1996), except where UNGC gives
  a measured distance. No peculiar-velocity model and no K-corrections are
  applied; "fingers of God" are therefore visible in clusters, exactly as in
  the published survey cone plots.
- **SDSS rows with impossible luminosities are dropped.** 1 920 SpecPhoto rows
  pair a galaxy spectrum (z ≈ 0.5–0.8) with photometry of r ≈ 10–13: an
  implied absolute magnitude of −25 to −34, i.e. a bright star or a blend on
  the fibre, not a galaxy a thousand times more luminous than any known. Left
  in, they were "the most luminous galaxies in the universe": first in every
  level of detail, visible from everywhere, and modelled as monsters half a
  megaparsec across. The cut is M_r < −24.5 with no K-correction (brightest
  cluster galaxies reach about −24); the count is in `BUILD_REPORT.json`.
  This is the only cleaning of that kind. The quasar catalogue is used as
  published.
- **A quasar's host is not sized from the quasar's light.** A catalogued
  quasar's magnitude is its nucleus, which can outshine the galaxy a
  hundredfold. The point you see from afar uses the catalogued brightness; the
  galaxy you find on arrival is an ordinary massive host (seeded between
  M_r = −21.8 and −23.2) with a blazing core, and the 2MASS "extent" of a
  quasar (the glare of the nucleus) is ignored.
- **3C 273 is one object.** It is in 2MRS as an extended 2MASS source; the
  curated file attaches its quasar nature, its jet and its black-hole mass
  (GRAVITY Collaboration 2018) to that entry instead of adding a second object
  at a slightly different distance.
- **Real stars: a catalogued spectral type outranks colour.** Where Hipparcos
  or the exoplanet archive give a spectral type, temperature and luminosity
  class come from it. Gaia colours of very bright, saturated or reddened stars
  can be badly off (from colour alone the O9.7 supergiant that feeds Cygnus X-1
  came out as a cool giant). Mass and radius stay estimates, labelled "est.".
- **Searching "Cygnus X-1" or "Gaia BH3" takes you to the black hole**, not to
  the visible star it orbits; the star is in the same system, one tap away.
- **Exoplanets: only real planets orbit real hosts.** A catalogued system gets
  exactly its catalogued planets — no invented siblings, moons or rings — and
  orbital elements the archive does not give (often inclination or the node)
  are filled from the system seed and tagged "est.". 309 planets whose host has
  no usable distance are left out. Planet *appearance* (colours, clouds) is
  procedural from mass, radius and equilibrium temperature, since nobody has
  seen these worlds.
- **Real stars without known planets get procedural planets**, clearly marked
  "Imagined" on the card while the star itself says "Real".
- **Deep-sky objects need a distance to exist in a 3-D universe.** 796 OpenNGC
  non-galaxies, 61 pulsars and 273 OpenNGC galaxies without one are left out
  rather than placed at a guess. Cluster distances come from Harris (globulars)
  and Hunt & Reffert 2023 (their own reliability cut: CST ≥ 5 and CMD class
  ≥ 0.5; 3 163 candidates rejected by it).
- **A small hand-curated file** (`scripts/build-catalogs/curated/notable.json`)
  holds literature values the catalogues above do not carry, each with its
  reference in the file: distances of famous nebulae, Sgr A* and M87*, a few
  stellar-mass black holes (Cygnus X-1, V404 Cyg, A0620-00, GRO J1655-40, Gaia
  BH1–BH3), supernova remnants, 3C 273. These are published measurements typed
  in by hand, not generated numbers.
- **Cluster member stars and nebula shapes are procedural.** The catalogues
  give a cluster's position, distance, size and age, not its members; the
  rendered stars and the gas of a nebula are generated from those real
  parameters and the object's id.
- **Solar System:** orbits are mean elements fitted to JPL Horizons osculating
  elements sampled over 2020–2040 (a single osculating snapshot drifts by
  degrees within years; the fit gives Earth a 365.2564-day year and the Moon a
  27.3217-day month). Masses, radii, rotation, tilts and ring sizes are
  hand-entered from NASA fact sheets. **Surfaces are high-quality procedural
  versions, not NASA textures**: an equirectangular Earth at the resolution the
  terrain reaches would be hundreds of megabytes, and a low-resolution texture
  would break the seamless descent to the ground. Earth therefore has
  plausible, *not real*, continents. This is the largest fidelity gap in the
  project and the first thing I would revisit (tiled NASA Blue Marble / LOLA /
  MOLA data streamed like the catalogue tiles).
- **Constellations:** IAU names plus the stick figures of Stellarium's "modern"
  sky culture; lines are drawn between the real Hipparcos stars.
  **Licensing note:** that figure list ships with Stellarium under
  GPL-2.0-or-later. Which stars a constellation joins is arguably a fact, not
  a creative work, but if you plan a closed-source store release, replace
  `constellations.bin` with your own figure list (88 short lists of HIP
  numbers; the builder is `buildConstellations` in
  `scripts/build-catalogs/steps/misc.ts`). Likewise the deep-sky and galaxy
  files contain OpenNGC data and inherit CC BY-SA 4.0 (attribution +
  share-alike for those data files).
- **Galaxies show what was measured.** Named galaxies carry their catalogued
  heliocentric radial velocity, Hubble type and — for the nearest ones — how
  their distance was measured (Cepheids, tip of the red-giant branch, …).
  Nearby galaxies are *placed* by those measured distances, so their stored
  "redshift" is only that distance re-expressed; the card shows a redshift
  only beyond z = 0.003, where it really is the measurement.

### 2.3 Stable ids

Every object has a stable id shown in Show data and accepted by search.

- Catalogue stars: `star:<ra>-<dec>-<dist>` from the quantised position (what
  the tile actually stores). The Gaia DR3 `source_id` / HIP number lives in a
  per-tile sidecar (`.id`, 12.8 MB in total) fetched only when a star is
  selected — storing it inline would have doubled the first-launch download.
- Catalogue galaxies and quasars: their IAU position designation
  (`sdss:J122906.69+020308.5`), which is exactly how SDSS and 2MASS name them.
  Positions are stored *truncated* the way the designations are, so the
  official name is regenerated from the coordinates with no id storage at all.
- Procedural galaxies: `g:<level>:<ix>:<iy>:<iz>:<n>`; procedural stars:
  `<galaxy id>/s<level>.<ix>.<iy>.<iz>.<n>`; bodies: `<system id>/p3`, `…/p3/m1`.

---

## 3. The procedural universe

### 3.1 Determinism

- One universe seed (`UNIVERSE_SEED` in `src/core/hash.ts`). Everything
  procedural is a pure function of that seed and integer coordinates — nothing
  procedural is stored, cached to disk or dependent on the order of visits.
- Generators use `src/core/dmath.ts` (log, exp, pow, sin, cos, atan2 built from
  + − × ÷ and sqrt only). `Math.sin` and friends are allowed to differ in the
  last bit between JavaScript engines; a last-bit difference in a density test
  can add or remove a star and shift every id after it. With `dmath` the same
  coordinates give bit-identical results on every device.
- A snapshot test pins a sample of the universe so that an accidental change to
  a generator fails CI.

### 3.2 Real overrides procedural, without seams

- **Stars.** In the Milky Way the generator skips any star that would have been
  in the catalogue (apparent G < 11.5 from the Sun, or within the 100 pc
  volume-complete sphere). Real and procedural stars therefore tile the galaxy
  with no gap and no double counting; a unit test checks it.
- **Galaxies.** A procedural galaxy that 2MRS (K < 11.75, |b| > 8°) or the SDSS
  main sample (r < 17.77, inside the footprint mask) would have catalogued is
  not generated. Within ~240 Mpc the procedural density field is blended with
  the real 2MRS density field (`lss.bin`), so faint procedural galaxies gather
  around the real clusters and walls. Outside the SDSS footprint and beyond the
  survey depths the procedural field carries on with the same statistics.
- **The Milky Way itself** is a hand-set model (Sun 8.277 kpc from the centre,
  four arms of 12.8° pitch, a 4.5 kpc bar, Sgr A* 4.297 × 10⁶ M☉) so that the
  real stars sit in a matching procedural galaxy.

### 3.3 Statistical choices

- **Cosmic web:** a ridged-noise field whose zero-sets form sheets, filaments
  and knots, with galaxies shared ≈ 8 % voids / 20 % walls / 45 % filaments /
  27 % knots (after Cautun et al. 2014, shifted toward dense phases because
  galaxies cluster more than mass). The field has unit mean at every level of
  detail (tested), so counts follow the luminosity function below.
- **Galaxy luminosity function:** Schechter, r band, φ* = 0.005 Mpc⁻³,
  M* = −21.2, α = −1.25, generated from M = −24 to −12.
- **Stellar luminosity function:** Jahreiß & Wielen / GCNS, 24 one-magnitude
  levels from M = −8.5 to +15.5.
- **Stellar properties** come from absolute G magnitude and temperature through
  the Gaia bolometric correction (Andrae et al. 2018), Stefan–Boltzmann and a
  piecewise mass–luminosity relation. The same function serves real and
  procedural stars.
- **Planets:** mass–radius relation after Chen & Kipping (2017); equilibrium
  temperature from stellar luminosity; habitable zone 0.95–1.68 AU × √L (the
  Sun's conservative zone of Kopparapu et al. 2013, scaled by luminosity); types (rocky, desert, ocean, ice, lava,
  gas giant, ice giant) from mass, temperature and volatile budget.
- **Multiplicity** rises with stellar mass (26 % for red dwarfs to 75 % for
  O/B stars); close pairs get circumbinary planets, wide pairs planets around
  the primary, 18 % of binaries a distant third star.

### 3.4 Deliberate exaggerations (for spectacle or visibility)

- **Cosmic-web glow.** Besides individual galaxies, soft "glow" particles carry
  the unresolved light of the web on three nested scales (cells of 32, 64 and
  128 Mpc), each drawn in its own shell of distances and tinted by local
  density (violet-blue outskirts, warm bright knots). Physically this light is
  far too faint to see; it is there so the web reads as a web. Beyond a few
  hundred megaparsecs a sight line crosses so many structures that the glow
  would be a featureless haze, so only the real surveys remain visible there,
  as faint "survey dots".
- **Compact objects are easier to find than in reality.** Isolated neutron
  stars and black holes are given a faint glow and a signature tint in the star
  field, and about 0.5 % of faint stars are compact objects (the real fraction
  is similar, but they would be invisible).
- **Pulsar beams sweep slowly.** A 30 Hz pulsar rendered at its true rate is a
  flicker (and a photosensitivity hazard); beams turn at a watchable rate and
  the true period is in Show data.
- **Every black hole has an accretion disk** (faint for quiet ones such as
  Sgr A*, blazing for X-ray binaries and quasars) so there is something to be
  lensed. The lensing itself is a real Schwarzschild geodesic integration per
  pixel — not a screen-space warp — with Doppler beaming and gravitational
  redshift of the disk; spin (Kerr) is not modelled.
- **Time dilation readout** is the static-observer Schwarzschild factor
  1/√(1 − r_s/r); it does not change how fast the simulation runs.
- **Exposure adapts.** Star brightness is anchored to real magnitudes (a
  sixth-magnitude star always looks the same; higher quality tiers add fainter
  stars rather than brightening everything), but the sky dims when a nearby
  sun is in the frame or under a day sky, and inside a galaxy the exposure of
  its diffuse glow follows the local star density — the eye would adapt to the
  blaze of a galactic nucleus just as it does to the faint Milky Way.
- **Quasars with no catalogued magnitude** are drawn at a nominal i = 20.5 so
  they remain visible as points; the card shows no magnitude for them.
- **Jets of active galaxies are drawn at galaxy scale.** M87, Centaurus A,
  Perseus A and 3C 273 (flagged in the curated file) and the seeded active
  galaxies get twin, knotty jets about 0.6 galaxy radii long. M87's optical
  jet is really 1.5 kpc, a twentieth of that; the radio structures are tens
  of kiloparsecs long, but no eye would see them.
- **Galaxies have a surface brightness; only stars dazzle.** Once a galaxy's
  disc is wider than a pixel its dot stops brightening and grows instead, so
  Andromeda in our sky is a soft smudge rather than a searchlight. Dwarfs are
  drawn fainter per unit area than giants (about 0.3 mag per magnitude of
  luminosity, as observed), and Magellanic irregulars are clumpy discs rather
  than spheroids. Inside a galaxy, other galaxies are exposed for eyes adapted
  to its stars (2.5 mag less sensitive than out in intergalactic space).
- **Nebulae light up as you approach.** From a dozen radii away a nebula is
  drawn at a seventh of its close-up brightness, rising to the full
  "long-exposure" view within 3.5 radii. Without this the Vela supernova
  remnant (8° across, invisible to the eye) was a white disc in the home sky.

---

## 4. Engine

### 4.1 Coordinates and precision

- Positions are `UPos`: three integer sector indices (sector = 2⁴⁰ m) plus a
  float64 offset in metres. Sub-millimetre precision is kept to the edge of
  the observable universe (unit-tested at 4.4 × 10²⁶ m).
- World axes are ICRS, origin at the Sun.
- Rendering is camera-relative: the three.js camera never leaves the origin.
  Point clouds pass the camera position as a high + low float pair and subtract
  on the GPU; meshes are positioned by float64 subtraction on the CPU.
- **Metres are never squared on the GPU.** 32-bit floats end at 3.4 × 10³⁸ —
  the square of 600 parsecs in metres — and a plain GLSL `length()` of a
  camera-relative position quietly returns infinity beyond that. (This made
  every galaxy sprite collapse to zero size until a screenshot of the home
  sky showed no Magellanic Clouds.) Distant things are handled in their
  layer's own unit (parsecs, kiloparsecs, megaparsecs) or scaled on the CPU,
  and the shared clip-space helper uses an overflow-safe length.
- Logarithmic depth buffer for everything that is depth-tested (planets,
  moons, rings, terrain); stars, galaxies and nebulae are drawn in a separate
  background scene with no depth test, so there is nothing to z-fight.
- Travel speed scales with the distance to the nearest object (star, galaxy
  edge, nebula, planet surface), so the throttle feels the same at 2 m altitude
  and between superclusters.

### 4.2 Budgets and adaptive quality

| Tier | Points on GPU | Draw calls | Max pixel ratio |
| --- | ---: | ---: | ---: |
| low | 90 000 | 140 | 1.25 |
| medium | 220 000 | 240 | 1.75 |
| high | 520 000 | 420 | 2 |

Full table (shader steps, terrain patches, bloom levels …) in
`src/render/qualityTiers.ts`.

- "Auto" measures frame time; it first trades render resolution inside a tier
  (down to 50–70 %), then changes tier.
- **Point budgets are enforced, not hoped for.** Catalogue tiles are selected
  brightest-first up to their share of the budget. Procedural stars and the
  cosmic web each run a small feedback loop on the number of points actually
  on the GPU (lowering the magnitude limit / the web's reach when over).
- **Idle allowances are lent out.** Out between the galaxies no stars are
  drawn, so the procedural stars' points and half of the catalogue stars' go
  to the cosmic web, and the other half to the real galaxies around the
  camera (see 4.8). The total stays within the tier's budget.
- **Draw calls.** Catalogue tiles cost one call each (frustum-culled).
  Procedural cells are packed into one buffer per level-of-detail level
  ("batches", `src/render/pointLayer.ts`), re-packed around the camera whenever
  it has drifted a fraction of the level's visibility radius; that caps the
  procedural star field and cosmic web at 46 draw calls regardless of how many
  cells are loaded, and sends only currently visible points to the GPU.
- **No pop-in:** every point fades by apparent magnitude at the LOD limit and
  by distance at the edge of its cell range; new cells fade in; terrain patches
  morph between levels (CDLOD-style) and have skirts.

### 4.3 Compression: DEFLATE, not Brotli

Tiles are zlib streams decoded by `fflate` in a Web Worker. Brotli would be
somewhat smaller but has no synchronous JS decoder of acceptable size, and relying
on HTTP `Content-Encoding: br` would require server configuration — the build
output must work from any static host and inside a Capacitor bundle. Column
byte-planes + delta-coded right ascension recover most of the difference
(stars: 10 bytes each on disk from 14 raw).

### 4.4 Black-hole lensing as a post-process

The lensing pass runs only while a black hole is on screen and covers more than
a couple of pixels; integration steps scale with the tier (24 / 40 / 64). Far
from the hole a closed-form weak-field deflection replaces the integration.

### 4.5 Atmospheres and terrain (approximations)

- Single scattering with an analytic (Chapman) optical depth toward the sun.
  Samples along the view ray are bunched where the air is densest and each
  segment is integrated analytically, so 4–8 samples give a noise-free sky.
  There is no multiple scattering (a constant factor stands in for the skylight
  it would add) and no volumetric cloud shadows. Terrain and the cloud deck get
  matching aerial perspective, so sky and horizon agree during descent. The
  scale height is inflated to at least 0.22 % of the radius so that a thin
  atmosphere is still a visible rim from orbit.
- Clouds are one shell of animated fractal cover, not volumes.
- Terrain is a cube-sphere quadtree built in workers, down to ~1 m cells.
  Elevation is noise-based (continents, ridged mountains, crater fields with
  realistic depth-to-diameter ratios); colour follows height, latitude and
  climate; steep slopes show bare rock. No erosion simulation, no vegetation,
  no water rendering beyond a specular sea surface.
- **"Land"** flies to a spot where the sun stands about 35° high, levels out
  along the horizon and settles a few hundred metres above the ground; you can
  fly lower by hand (the camera is kept 2 m above the terrain).
- Eclipse shadows: up to four occluding spheres per body with penumbrae; ring
  shadows on the planet and planet shadows on rings are analytic.

### 4.6 Platform boundary (how "no browser-only APIs outside src/platform" was read)

The DOM, canvas, WebGL, pointer/keyboard events and Web Workers are the app's
presentation substrate — they are identical inside a Capacitor WebView — and
are used directly by `src/ui`, `src/render`, `src/input` and the label layer.
Everything that *differs* between a browser tab and a native shell goes through
the interfaces in `src/platform/types.ts`: key-value storage, blob cache,
share / clipboard / save-file, haptics, audio, wake lock, URL hash, service
worker, connectivity, visibility, device info. An ESLint rule
(`eslint.config.js`) rejects `localStorage`, `indexedDB`, `AudioContext`,
`navigator.share`, `navigator.vibrate`, `history`, `location`, etc. anywhere
else. Swapping to Capacitor is `setPlatform({...})` before boot.

### 4.7 Offline

The service worker precaches the app shell. Data tiles are cached by the app
itself in IndexedDB, keyed by the catalogue build stamp (a new data build
purges the old one), capped at 128 MB with least-recently-used eviction, and
falling back to a 24 MB in-memory cache when IndexedDB is unavailable (private
browsing). Everything you have flown through works offline; places you have
never visited show their procedural content and whatever tiles are cached,
with an "Offline" badge in the location box.

The shell cache is matched by URL only (`ignoreVary`). Many static hosts —
Vite's own preview server among them — answer with `Vary: Origin`, and a
module script's request then does not match the copy the worker fetched for
itself: the page came up blank offline until the production build was
actually relaunched with the network off.

### 4.8 Which catalogue tiles get loaded

Tiles hold disjoint objects, so any set of them is a valid picture; the only
question is which matter most from where the camera is. Two orderings are
used, decided when the tiles are built.

**Our own sky is ordered by apparent brightness.** Stars, and the bright /
nearby galaxies (2MRS + UNGC + OpenNGC), are tiled by *apparent magnitude as
seen from the Sun*, and each tile records the brightest object it holds and
the median distance of its objects. Near the Sun this gives an exact rule —
load tiles brightest-first — and, for stars, a sky complete to the same
magnitude in every direction: about G = 7.5 / 8.5 / 9.3 on the low / medium /
high tiers (the shader fades at the brightest star left out). Further away
the same numbers give an estimate rather than a guarantee, and small tiles
around the camera are added for faint neighbours that look bright up close.
For galaxies it means the root tile is simply "the thousand brightest
galaxies of the sky": Andromeda, the Magellanic Clouds and every Messier
galaxy are loaded on every tier, wherever the camera is. (They were first
ordered by luminosity, like the deep surveys. The showpieces then sat in deep
tiles that were never selected, and flying to Andromeda without the search
box found empty space.)

**The deep surveys are ordered by luminosity.** SDSS galaxies and quasars are
seen from everywhere, mostly from afar. Whole tree levels are loaded first —
each is an even sample of the survey's most luminous members, drawn as faint
"survey dots" from intergalactic space — and the rest of the budget goes to
the tiles around the camera, ranked by how bright their brightest member
could look from there (distance to the tile's cube, floored at 0.4 of the
mean spacing of its objects). That selects the chain of nested tiles the
camera is in, then their neighbours: 300 Mpc from home inside the SDSS
volume, the medium tier holds about 600 real galaxies within 30 Mpc of the
camera. Completeness around the camera is limited by the budget, not
guaranteed: real galaxies beyond the loaded neighbourhood that would be
bright enough to draw are missing until approached, because the procedural
generator never stands in for a catalogued galaxy.

**Tile shape.** Galaxy tiles hold 1 024 objects — the chain around the camera
costs (tree depth × tile size) points, so small tiles are what make a real
neighbourhood affordable. Branches holding less than one tile's worth are
folded into their parent, which may then hold up to 2 048. The root cube of
each galaxy tree is shifted by a third of its half-size on every axis: a
Sun-centred tree puts the Sun on a corner shared by eight cells at every
level, so our own neighbourhood would cost eight tiles per level instead of
one; with the shift the Sun is a third of a cell from the nearest wall at
every level (unit-tested).

Real and procedural stars share one point allowance: near the Sun, where the
catalogue is the whole sky, all of it goes to catalogue stars; inside another
galaxy all of it goes to procedural ones.

---

## 5. Verification, and what could not be verified

- `npm run check` = typecheck (app + scripts), lint, unit tests, production
  build. All pass.
- The app was exercised end-to-end in headless Chromium driven by Playwright.
  **The sandbox has no GPU**: WebGL ran on SwiftShader (software) at well under
  1 fps. Functionality, layout and the look of each scale were checked from
  screenshots, but **real-device frame rates could not be measured** — the
  60 fps target rests on the budgets above, not on a measurement. The first
  thing to do on a phone is turn on the performance HUD (Settings) and watch
  the tier the auto controller settles on.
- The production build (`npm run preview`) was relaunched offline (boots from
  the service worker and IndexedDB, keeps flying on procedural content, picks
  the tiles back up when the network returns) and survived a forced WebGL
  context loss and restore.
- Touch gestures were exercised through synthesised pointer events, not on a
  physical touchscreen.
- What the screenshots covered: start screen and tutorial; HUD in portrait and
  landscape; the home sky (constellations, labels, the Magellanic Clouds and
  Andromeda as real galaxies); Earth, Moon and Mars from orbit and from the
  ground; Jupiter, Saturn and Enceladus; Sirius, Betelgeuse; the Orion Nebula,
  the Crab pulsar, Cygnus X-1 and Sagittarius A* (lensing); the Milky Way from
  outside; the Large Magellanic Cloud, Andromeda from outside and from its
  core (procedural stars, a procedural star system); M87, Centaurus A and
  3C 273 with their jets; the Virgo cluster; the cosmic web from inside and
  outside the SDSS volume; search, coordinates, bookmarks, share links, photo
  mode, settings.

---

## 6. Housekeeping

- Raw downloads live in `scripts/build-catalogs/.raw/` (git-ignored, ~0.7 GB).
  It contains a few truncated files from early Gaia attempts
  (`gaia/bright_*.csv`) that the pipeline no longer reads; the sandbox would
  not let me delete them. They are harmless and can be removed by hand.
- **Hosting.** GitHub Pages is fed from a `gh-pages` branch that a workflow
  rebuilds on every push, rather than through GitHub's artifact-based Pages
  deployment: the latter only accepts deployments from the default branch
  unless the environment's rules are edited by hand, and this work was
  delivered on a feature branch. The branch holds a single commit that is
  replaced each time, and a `.nojekyll` file so the 8 700 data tiles are
  served as they are. Switching Pages on is a repository setting that only
  the owner can change (README, "Put it online").
- The built catalogue (`public/data/`, 68 MB in ~8 700 files) **is committed**
  so the app runs straight after `npm install` without a 10-minute download
  from the archives. Remove it from git and build in CI if the repository size
  matters more to you.
