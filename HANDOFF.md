# Handoff: where the project stands

Live: https://dippy34.github.io/starfarer/ (GitHub Pages serving the `gh-pages` branch) ·
Deploy: automatic on every push to `main` (`.github/workflows/deploy-pages.yml`: `npm run check`,
then `dist/` is published to `gh-pages`).

Starfarer was imported from Space Explorer (dippy34/nextjs-boilerplate at 4f97371) without its God
mode (`src/god/`: the universe editor, N-body sandbox and console), which is not included yet. The
sections below describe the engine as imported; "Clean-up pass" at the end tracks what has been
gone through since.

## Goal (from the owner)

A SpaceEngine-like explorer that is **native to VR** (Meta Quest), eventually published on the
Meta Horizon Store (likely as a Unity app built on a Mac; the web version stays as a demo). The owner
wants it to feel like SpaceEngine: visit "everything", black holes, beautiful stars and planets,
smooth travel. Real data wherever it exists (downloaded by `pipeline/`, credited in `CREDITS.md`),
procedural generation for the rest. Never use SpaceEngine's own files.

## Done

* Engine: Three.js + TypeScript + Vite, double-double positions, floating origin, log/reversed-Z depth,
  HDR, JPL DE442S ephemeris, 459 moons, small bodies, 2.75 M real stars (AT-HYG, Gaia DR3 100 pc).
* VR (WebXR): in-headset menu (Planets, Moons, Small worlds, Stars, Search keyboard, Settings), laser
  pointing, hover/haptics, info cards, wrist panel, hands. Renders into the XR render target.
  Depth in the headset: logarithmic by default (it writes the fragment depth, so the GPU cannot
  reject hidden fragments early); `?xrdepth=reversed` tries reversed-Z instead (needs
  EXT_clip_control, else log depth; the console says which): `Renderer.reverseXrProjections`
  rebuilds the runtime's eye projections as reversed-Z each frame (three has no reversed-Z path for
  XR cameras), and the far-geometry pull-in is off in that mode. For an A/B on the device.
* Adaptive quality (`src/render/Quality.ts`): a governor in Renderer.render steps `QUALITY.level`
  (0 full .. 3) down when frames miss the budget (60 Hz desktop, the session's rate in a headset)
  and back up after a clean run (with back-off). Desktop: internal render resolution 1/0.85/0.72/0.6
  (the composite upscales; view.pixelRatio reports render pixels per CSS pixel). Headset: the
  volume pass and the terrain's split threshold coarsen. Off under automation (navigator.webdriver)
  unless ?governor=1; ?governor=0 turns it off. Other layers may read QUALITY.level.
* Volume pass (`Renderer.ts`, `VOLUMES`): ray-marched volumes are drawn at reduced resolution
  (desktop 0.75, headset 0.5) into their own target, then added to the frame by a full-screen quad
  in the scene at the far plane with the volumes' old draw order (after everything opaque, sky
  included; whatever opaque is in front still covers it, also in a headset). A layer joins by putting
  its meshes on `VOLUMES.layer` only and adding them to `VOLUMES.meshes`; DeepSkyLayer's nebulae
  do. Inside a nebula (SwiftShader, 800x450) frames went from 5.7-8.3 s to 3.1-3.5 s at half
  resolution; in the emulated headset the cost of being inside Orion fell from 2.7 s to 1.0 s.
* Visuals: NASA SVS Milky Way, atmospheres, relief maps (LOLA/MOLA/MESSENGER/ETOPO), 8k maps (desktop
  only), Hubble OPAL giants, spectral colours.
* Earlier: autopilot uses a two-stretch log-distance Hermite curve (`src/app/CameraRig.ts`,
  test `tests/rig.test.ts`); destination textures are prefetched and every shader is compiled up front
  (`App.warmUp`, `BodiesLayer.prefetch`), no 8k maps in VR (upload stalls); VR travel = blink, re-aim,
  open eyes, one continuous flight. New star look (`src/render/shaders/psf.ts`): coloured core,
  halo/spikes sized by brightness above the limit, saturation `uSat`.

* Black holes (done, live): `pipeline/build_blackholes.py` -> `public/data/blackholes.json` (23 real
  holes), `src/universe/BlackHoles.ts`, renderer `src/render/BlackHoleLayer.ts` + `shaders/blackhole.ts`
  (per-pixel Schwarzschild tracing over an environment cube captured at the eye, thin disks with
  Doppler/gravitational shifts). Note: three.js maps AlwaysDepth to NeverDepth with a reversed-Z
  buffer — the layer asks for NeverDepth there on purpose.
* Milky Way (done): `src/universe/Galaxy.ts` (parametric model, CPU reference `glowColumn`),
  `src/render/GalaxyLayer.ts` + `shaders/galaxy.ts` (glow ray-marched into a cube, one face per frame
  while moving, into a second cube shown once it is whole), `Sky.updateWith` cross-fades the NASA map to it 120-700 pc from the Sun (calibration
  constants in `SkyLayer`). Procedural stars: `src/universe/ProceduralStars.ts` (bands x cells,
  deterministic, no catalogue duplicates), generated in `src/workers/stars.worker.ts`, drawn by
  `src/render/ProceduralStarLayer.ts`. "Milky Way" destination: `src/universe/MilkyWay.ts`.

* Overnight session (2026-10-03), all live:
  - Unique looks: per-star surfaces (`src/render/StarLook.ts`, `StarCorona.ts`), per-hole disks and
    jets (`Jets.ts`), procedural surfaces/lumpy shapes for map-less bodies, 4K moon maps.
    The corona quad is drawn on a scaled-down copy 1e4 km from the eye (a 1e12 m quad around a giant
    was garbled) and starts at the disk's elliptical outline; big star disks are exposed below white
    (`starCap` in App.ts). Catalogue stars move from the name list's rounded position to
    the octree's when their tile loads; `App.getStar` carries a parked explorer along.
  - GPU crash fix: point sprites of very distant stars overflowed the clipper (`POINT_CLIP` in
    `shaders/xr.ts` rescales point clip coordinates; meshes at Mpc use a per-object `uClipScale`).
  - Exoplanets: `src/app/Systems.ts` (archive <-> catalogue matching, claims), `src/universe/Planets.ts`
    (generator + Kepler systems), `src/render/ExoPlanetLayer.ts`, `shaders/planet.ts`.
  - Close-up tiles: `pipeline/build_tiles.py` -> `public/data/tiles/` (16k pyramids, 15 bodies),
    runtime `src/render/TileDetail.ts` (detail atlas around the view, bound by `BodiesLayer.updateDetail`).
  - Spacecraft (`pipeline/build_spacecraft.py`, `src/universe/Spacecraft.ts`, `src/render/SpacecraftLayer.ts`),
    galaxies (`build_galaxies.py`, `src/universe/Galaxies.ts`, `src/render/GalaxiesLayer.ts`), nebulae and
    clusters (`build_deepsky.py`, `src/universe/DeepSky.ts`, `src/render/DeepSkyLayer.ts`).
  - Game mode (`src/game/`): `Game.ts` (modes, warp, docking, landing, light), `Cockpit.ts`, `ShipModel.ts`
    (display-referred `litMaterial`), `WarpFx.ts`, `Traffic.ts` + `Station.ts`, `Missions.ts`, `Audio.ts`
    (Web Audio synthesis). CameraRig got `inertia`, `braking`, `thrust`, `stop()`, `gotoRemaining`.
  - VR quality tier: `LITE.uLite` (1 while presenting) trims the heavy procedural shaders.
  - Planet terrain (replaces the old single landing patch): `src/render/PlanetTerrain.ts` — a
    quadtree on the 6 faces of an equi-angular cube on every solid world within 2 radii
    (`PlanetTerrain.reach`), tiles of 32x32 cells (`universe/TerrainTiles.ts`: heights with a border
    for continuous normals, skirts, the parent's shape for geomorphing, relief shadows), split by
    screen-space error (`pixPerCell`), horizon-culled, about `drawCap` drawn, built in Web Workers
    (`workers/terrainTiles.worker.ts`, `inFlight` jobs a frame; the tile holding the explorer comes
    with its whole column down to the detail wanted, `chain`). The worker rebuilds the same height
    function from plain data (`universe/TerrainHeights.ts`: `TerrainSource`/`ExoGround` state) and
    samples the elevation pyramids (`TerrainSource.elevSample`, below). Tiles morph in from their
    parent's shape and a rebuilt drawn tile morphs from its old shape, so `below()`/`groundRadius()`
    (the drawn triangles, exactly) never jump. The world's sphere is cut away entirely (`uHoleCos`
    -2) while the terrain covers it; the surface shader reads the close-up weight per vertex
    (`tileFragment`: `uHScale` -> `vHScale`, fading out with distance), so far tiles shade like the
    globe, and drops the sphere's `discard` (a discard anywhere turns off early depth rejection).
    Skirts (`skirtMasks`: one of 16 shared index buffers per tile) hang only on edges bordering a
    tile of another level, on both sides, and on cube-face borders; their depth is a few times
    the tile's step from its parent's shape along the edges (deep skirts cost fill rate, which a
    software rasteriser pays in full). Tunables (desktop / headset): `pixPerCell` 18/24,
    `drawCap` 96/72 (a soft target: `lodScale` raises the split threshold evenly while the count
    is over it; a hard stop at 1.5x — a hard cap tested during the depth-first walk let the deep
    column under a walker starve the far field), `inFlight` 8/4, `budgetMs`/`budgetVrMs` 4/2 (main-thread builds only when
    workers are unavailable), `maxTiles` 420/200. Shader warm-up: `App.warmUp` compiles inside
    `Renderer.withSceneTarget` — three builds one program per output target, and the scene is
    drawn into the HDR target, so compiling against the canvas left every program to compile again
    on first use (the terrain's on arrival at a planet). `TerrainPatch.ts` is now an alias kept for importers. Heights: `pipeline/build_terrain.py`
    -> `public/data/terrain/` (coarse global maps), `src/universe/Terrain.ts` (map or pyramid +
    generated hills and craters below their resolution). Shot script: `scripts/shots/terrain-lod.mjs`.
    `App.keepAboveGround` and `computeAltitude` use `TerrainPatch.groundRadius`. Shadows: `aSun`
    is the Sun's clearance over the relief in penumbra widths (ray-marched per vertex, signed),
    and the shaders light a pixel by `clamp(0.5 + vSun, 0, 1)`. Earth: the map's `"sea": 0` makes
    lower ground flat water and limits generated hills to land (more on high ground); the data
    stores everything at or below 0 m as -200 m, so `Terrain.DEPRESSIONS` (circles) gives dry
    basins a dry floor (Death Valley -80 m, Qattara, ...) and lakes below sea level their own
    surface (Caspian -28 m, ...). Sea query for walking: `PlanetTerrain.isSea(nBF)` (the drawn
    ground lies flat at the local water level) and `waterLevel(nBF)` (m, or null where no water;
    generated ocean and Earth-like planets: 0); the painted
    clouds fade out on descent (`uCloudVis`, set in `Bodies`) while `render/CloudLayer.ts` (a
    sphere 7 km up, same map + generated billows) fades in, clearing again below 12-30 km. Draw order: atmosphere shell (19.8),
    terrain (19.9, transparent pass but opaque), terrain haze (19.95: `ATMO_HAZE_FRAG` on the
    terrain geometry, marching to the real ground), then cockpit/HUD (20+). Earth and Mars get a
    skylight term in BODY_FRAG (`uAtmo`); ground without craters (Earth) gets `bnAt` rock/soil
    detail on the split lattices. Landmarks may set `elev` (viewpoint elevation, degrees): Earth's
    mountains are seen from a few degrees above, across the sunlight.
  - Cockpit HUD (`src/game/HudMarkers.ts`): target bracket, flight-path marker, boresight.
  - Generated planets: `src/universe/ExoTerrain.ts` (CPU copy of EXO_FRAG `terrain()` so ground matches
    colours), Earth-like atmosphere shells for temperate/ocean types (`Atmospheres.updateExo`).
  - Saturn's rings up close: `src/render/RingParticles.ts` (instanced ice, density from the ring
    opacity texture, inertial ring frame from `universe/RingSpot.ts`, which is also the search target).
  - Comets: `src/render/CometTails.ts` (coma/ion/dust quad per active comet, sky display gain; nucleus
    mesh + jets for the nearest one within 30,000 km, fed to the exposure as `nucleusView`).
  - Landmarks: `src/universe/Landmarks.ts` (places with coordinates; search ids `lm:`; VR Places tab).
    Sharper regional heights around them: `pipeline/build_terrain_patches.py` -> `terrain/patches/`,
    loaded by `TerrainSource.nearPatches` (via `Ground.prepare`), blended in `TerrainSource.height`.
  - Tour (T, `App.tourItems` / `prepareTour`: time jumps for the eclipse and the next Jupiter shadow),
    photo mode (U).
  - Eclipses: `BodiesLayer.updateEclipses` picks up to 4 occluders per body; `sunVisible()` in
    `shaders/body.ts` (disc-overlap penumbra, red glow in Earth's shadow); `sunlit` feeds the exposure.
  - Walking: `App.keepAboveGround` keeps eye height within 4 m of the ground unless climbing.
  - Nebula volumes: `DeepSkyLayer` (VOL_FRAG ray-marches the nearest nebula from 8 radii in, replacing
    the billboards). Emission nebulae are a cavity around a young cluster: ridged filaments on the
    walls, teal near the stars, red beyond, dust pillars/lanes; 40 jittered steps (16 in VR).
  - Galaxy clouds: `GalaxiesLayer` turns the nearest galaxy into a 3D cloud from 40 radii in (`fillCloud`:
    disc, arms, bar, bulge, single stars; sprites of fixed size in space, so surface brightness holds
    at any distance and flux is kept below a pixel; distances in the shader are in galaxy radii, as
    metres squared overflow 32-bit floats); the disc picture fades out as the cloud fades in.
  - Galaxy volumes (`GalaxiesLayer`, VOL_FRAG): every galaxy is a box in its catalogued frame, ray-marched
    per pixel (old disc, young clumpy arms with H II knots, bulge, bar; a thinner dust layer that
    absorbs, more in blue); the step follows the height above the mid-plane so thin discs resolve at
    any angle; ellipticals are Sérsic spheroids normalised to the old picture's light (`sersicNorm`).
    The nearest galaxy's cloud sprites are dimmed by the dust in front of them (`dustTau`, exact
    through the dust layer's vertical profile).
  - Generated planet surfaces (`shaders/planet.ts`): warped continents, ridged mountain belts, relief
    shading from finite differences of `terrain()`, octaves down to the pixel (`detail`), climate
    biomes, cyclone clouds with shadows, sheared giant bands. `terrain()` is mirrored in
    `universe/ExoTerrain.ts` (`exoTerrain`); sea level = the quantile of the planet's land fraction
    (`exoQuantile`).
  - Ground materials (`render/Materials.ts`): Poly Haven CC0 scans in two texture arrays (colour ÷ mean,
    normal + height); `groundDetail` in the terrain shaders blends flat/steep/snow materials at three
    scales by slope and height, as detail around the world's own colour. `render/Rocks.ts` scatters
    rocks per body-fixed cell on the drawn ground (`TerrainPatch.groundRadius`).
  - Display curve (`shaders/tone.ts`): the ACES fit applied to luminance only, so hues and
    saturation survive (per-channel ACES bleached mid-tones: Saturn came out off-white); highlights
    above ~60% of white blend towards white. Same curve in the headset via `CustomToneMapping`.
  - Comet tails (`CometTails`, TAIL_FRAG): a box in the comet's frame (x away from the Sun, y in the
    orbit plane behind the motion from the orbital elements, z the orbit normal), in coma radii;
    1/b coma integrated analytically, ion tube with plasma rays and curved, striated dust fan
    ray-marched with steps that shrink near the tube's axis and the fan's plane.
  - Saturn's rings: `shaders/rings.ts` (per-ring particle colour, ringlets below the profile's
    resolution, backscattering phase function with opposition surge, penumbra, Saturnshine). Within
    3 km of the plane `RingParticles.slab` draws the whole ring as a medium (Gaussian layer, σ 4.5 m,
    measured optical depth, sunlight dimmed by the layer, self-gravity wakes) on a sphere around the
    eye; the ice chunks are shaded and fogged by the same layer (`LAYER_GLSL`).
  - Star surfaces: `shaders/star.ts` (arithmetic hash: `sin` of large arguments lined the pattern
    up on a grid); the corona glow fades close to a star (`StarCorona`). The face itself has been
    redrawn since (clean-up pass, part 5).
  - Milky Way from outside: `MilkyWayVolume` ray-marches the galaxy model per pixel (with H II knots,
    OB associations, dust lanes on the arms' inner edges, feathers) and takes over from the glow cube
    a few kpc outside the disc.
  - Point sources fade in over the last ~1.3 mag above the cut-off (`psf.ts`).
  - Shot scripts for visual review: `scripts/shots/{comet,rings,solar}.mjs`.
  - Spacecraft models (`SpacecraftLayer.parts`): ISS (Sun-tracking arrays), Hubble, JWST, Voyager,
    New Horizons built from parts, baked per finish (`bake`); HULL_FRAG adds cells/foil/quilting/truss
    lattice from the part-local position (`aLoc`).
  - Tests: `scripts/terrain.mjs` (landing terrain, the Tycho / Olympus Mons / Everest patches and the
    atmosphere over terrain, 14 checks),
    `scripts/places.mjs` (rings, comet, lunar eclipse, Jupiter moon shadow, landmarks, inside the
    Orion Nebula).

## Global elevation pyramids (elevation worker)

`pipeline/build_elevation.py` (sources and resumable downloads in `pipeline/elevation_sources.py`,
raw files and int16 work grids in `data-raw/elevation/`, ~25 GB while building) ->
`public/data/elevation/<body>/<level>/<face>-<s>-<bx>-<by>.pak` (small spatial packs: the tiles of a
4x4 block of siblings, or 2x2 where 4x4 would pass 1.5 MB, one face at levels 0-1; 977 packs instead
of 6,617 PNGs) + `manifest.json` (each level's `packs`: tiles in file order with byte lengths), and
`index.json`. Elevation.ts reads a tile with an HTTP range request (GitHub Pages answers 206); a host
that ignores ranges (Cloudflare Pages, `python3 -m http.server`: 200 with the whole file) gets the
whole pack once and every tile in it is kept, and from then on whole packs are fetched directly
(concurrent first requests for one pack share one download). The build writes loose PNGs, then
`pack()` packs them (`python3 build_elevation.py pack` re-packs).
Runtime: `src/universe/Elevation.ts` (no DOM, Web-Worker safe), tests `tests/elevation.test.ts`
(fixture `tests/fixtures/elevation_points.json` is written by the build).

* Cube: faces 0..5 = +X,-X,+Y,-Y,+Z,-Z of the body-fixed frame (+X = 0 deg E, +Z = north); image
  right/down axes +X:(+Y,-Z) -X:(-Y,-Z) +Y:(-X,-Z) -Y:(+X,-Z) +Z:(+Y,+X) -Z:(+Y,-X); equi-angular
  (`normalize(N + tan((2u-1)pi/4) U + tan((2v-1)pi/4) V)`). Level L: 2^L x 2^L tiles a face, 256
  intervals a tile, 257 vertex-registered samples + a 1-sample apron = 259 x 259 16-bit greyscale
  PNG; height = manifest `offset` + `step` (1 m) x value.
* Bodies, MB, finest level: Moon 115 MB (all to 1.3 km, half to 666 m, landmarks 333 m), Mars 105
  (all to 2.6 km, most to 1.3 km, 650/325 m at the volcanoes, canyons and landing sites), Earth 80
  (sea floor to 9.8 km; land to 4.9 km, mountains to 1.2 km/611 m, landmarks 305 m), Mercury 25
  (1.9 km), Ceres 7.6, Vesta 7.0: 340 MB in all. Deep tiles are chosen greedily by the RMS detail
  they add over the parent x 2^(-level/2) under a per-body byte budget (`BODIES` in the script).
* API: `Elevation.configure({ base, maxBytes })` (absolute base inside a worker), `load(body)`,
  `levels(body)`, `request(body, face, level, x, y)`, `prefetch(body, dir, metresPerSample, ring)`,
  `sample(body, dirBF, metresPerSample)` (sync bicubic, metres above the reference, null when
  nothing loaded covers the point; blends adjacent levels; `lastMetresPerSample`/`lastLevel` say
  what it used), `maxLevelAt(body, dir)`, `exists`, `loaded`, `version(body)`; helpers
  `faceToDir`, `dirToFace`, `tileOf`, `decodePng16` (own PNG decoder over `DecompressionStream`,
  so heights stay exact 16-bit). LRU cache, 24 MB default, levels 0-1 never evicted.
* Regional levels (`pipeline/elevation_hires.py`, run by the build or `python3 build_elevation.py
  hires [earth|moon]`): Earth L8/L9 (153/76 m, 1551 tiles, 90 MB) from Copernicus DEM GLO-90 over the
  Alps, Everest Himalaya, Aconcagua, Grand Canyon, Kilimanjaro, Mauna Kea, Fuji, Denali; Moon L6/L7
  (167/83 m, 881 tiles, 45 MB) from SLDEM2015 in 10 x 10 degree boxes around the Apollo 11/15/17
  sites, Chang'e 4, Tycho, Copernicus. These levels list their tiles (`list`: flat face, x, y) instead
  of a bitmap. Elevation total now ~475 MB; the whole site ~910 MB (keep it under ~950).
* Reference surface for consumers: heights are metres above the body's ellipsoid (`radii`), exactly
  like the older `terrain/*.png` maps (Moon: the 1737.4 km sphere). `referenceRadius` is the mean
  radius for `metresPerSample` only. The tile worker (`workers/terrainTiles.worker.ts`) uses them so.
* Checked in the app (vite preview, software GL): flying to Everest, the Matterhorn and Apollo 17
  requests levels 8-9 (Earth) and 6-7 (Moon) and the ground under Everest is at +8.5 km, Apollo 17 at
  -2.6 km. Each tile worker fetches and decodes its own copy (~90 tiles, ~12 MB per worker per descent).
* Memory: each `ElevationStore` caps decoded tiles at 24 MB by default (about 180 tiles, 2x a
  descent's working set; tested in `tests/elevation.test.ts`). With 3-4 tile workers that is at
  most ~100 MB on Quest. A cache shared between workers would need SharedArrayBuffer (cross-origin
  isolation, not available on GitHub Pages); routing all `sample` calls through one worker is the
  alternative if memory gets tight.
* Regenerate: `cd pipeline && python3 build_elevation.py [body ...]` (downloads ~14 GB once, plus
  ~0.6 GB of Copernicus tiles and SLDEM rows by range requests).
* Mercury's older `public/data/terrain/mercury.png` was twice too tall: `terrain.json` now applies
  the GeoTIFF's 0.5 m scale (and `build_terrain.py` bakes it in on a rebuild); the pyramids were
  always right. Mars/Earth heights are relative to the
  areoid/geoid but the engine adds them to the ellipsoid (as before: the difference is a smooth,
  very long-wavelength undulation, kilometre-scale on Mars, ~100 m on Earth). Earth land below sea level (Dead Sea, Caspian) is stored as ocean in the fine levels.

## The catalogue of real objects (catalog worker)

`pipeline/build_catalog.py` (downloads: `pipeline/catalog_sources.py`, raw in `data-raw/catalog/`;
the ATNF `psrcat` program is compiled there to get pulsar distances) -> `public/data/catalog/`
(20 MB): `manifest.json`, `rec/<category>/<k>.tsv` (4,000 records a file), `idx/<k>.txt` (the search
index: 356,000 names sorted by normalised key, 8,000 a file; 102 files in all; the manifest has each file's first
key). 199,996 objects: stars 112,879 (Hipparcos/Gliese, HD/HR/HIP/Gl/Bayer/Flamsteed names), galaxies
62,301 (Cosmicflows-4 + OpenNGC + UNGC), clusters 7,186, TESS planet hosts 6,266, pulsars 4,319, nebulae
2,336 (PNe, SNRs, WISE H II), white dwarfs 2,132 (50 pc), quasars 1,908 (with SMBH masses; incl. 3C 273, OJ 287, TON 618), X-ray
binaries 419, brown dwarfs 250. Sources and licences: CREDITS.md.

* Runtime: `src/universe/CatalogSearch.ts` (no DOM: `normKey` mirrors the pipeline's `norm`; a query
  loads 1-3 index files, ~60 kB; records load per file) and `src/universe/Catalog.ts` (results with
  their records preloaded so picking is synchronous, `resolve('cat:<c>:<row>')`, `featured(code,
  page)` for browsing, `onUpdate` when async results land). Objects become the engine's own kinds:
  `CatalogStar` subclasses (stars, white/brown dwarfs, planet hosts, neutron-star X-ray binaries),
  `BlackHole` (black-hole X-ray binaries with a Roche-lobe companion; quasars as supermassive holes),
  `Galaxy`, `DeepSkyObject` (clusters, nebulae); pulsars are 12 km stars at ~500,000 K. Catalogue
  stars the star tiles lack join the near-star list when close (`Catalog.nearStars`). If the app already has the
  object (curated galaxies/nebulae/holes, named stars) that one is used (`App.catalogExisting`).
* Hooks (all marked `[catalog]`): `App.objCatalog`, created in `App.create` with callbacks that push
  black holes into `app.blackHoles` and call the new `GalaxiesLayer.add(g)` /
  `DeepSkyLayer.add(o, psf, lut, vr)` (appended methods; they set objects up like the constructors);
  `App.searchItems` merges catalogue results (exact designation matches rank first);
  `App.resolveSearchId` handles `cat:` ids; `Hud.refreshSearch` is public so late results show; the VR
  Search tab shows a category browser (6 per page) when nothing is typed.
* Not yet: catalogue objects are not labelled in the sky or pickable by pointing until selected
  (search/browse only); TESS hosts get the engine's generated planets besides their candidates'
  info row; picking many galaxies adds one volume mesh each (never removed).
* Regenerate: `cd pipeline && python3 build_catalog.py` (downloads ~260 MB once).

## The relativistic ship (ship worker)

The owner: "some sort of ship that follows like the laws of physics ... can travel as fast as you
want to, but still not faster than the speed of light". Before, the ship's "warp drive" was the
explorer's camera autopilot carrying it (Earth to Rigil Kentaurus in 28 s: 4.9 million times the
speed of light) and the "boosted" drive hit a wall at 0.995 c. Now (details, decisions and the
measurements in `docs/notes/relativistic-ship.md`):
- *Mechanics, real.* `src/sim/Relativity.ts`: the state is the proper velocity w = γv, exact at
  any Lorentz factor (tested to 10²⁹); the drive's push is solved in closed form (hyperbolic
  motion, sideways velocity included); speeds compose by Lorentz boosts. Gravity is Newton's
  potential (Paczyński–Wiita at black holes) in special relativity: γc² + Φ and r × w conserved,
  the old symplectic steps with w for v, the old integrator again at everyday speeds (its outputs
  reproduced to centimetres). Not general relativity: a fast path bends less than Einstein's. A
  substep's chord is tested against the ground and the horizon (a fast ship crossed small worlds
  between substeps).
- *The drive, invented and said so.* The "reactionless drive" (`ShipState.drive`): its proper
  acceleration from 0.001 g to 1,000,000 g (=/-; on a phone − and + over the instruments), no
  propellant, not felt aboard; no real engine does without reaction mass. The fusion torch stays.
- *Clocks.* Time warp is the ship's clock's rate; the universe's runs by the coordinate time that
  takes (at γ = 10⁶ a day aboard is 2,700 years: the date runs on, the planets move).
- *The autopilot* (`src/game/Autopilot.ts`; J, Go there, the headset's Fly to): flip-and-burn on
  the reactionless drive at the pilot's setting, arriving at rest (in orbit if the target pulls);
  round any world in its way along the tangent to 1.3 of its radii; refuses in air and where
  gravity is more than half the drive's push (the Elite-style mass lock is gone); lets go of a
  target that is taken away. Nothing in the ship travels faster than light; the explorer's free
  camera, a map, still jumps.
- *Instruments* (`FlightHud.ts`, the cockpit's screens): speed as a fraction of light's with its
  nines, the Lorentz factor, what speed does to the view ahead, the time to go aboard and in the
  universe, both clocks; distances in light years.
- *On a phone*: More → Spaceship boards; in the ship the tabs stay (Search, Go there, Time). The
  instruments are a card under the clock (`FlightHud.ts`, `glance`): the speed with its nines and
  the Lorentz factor (or the height while slow), what the ship is doing, the target and the time to
  it in both clocks; under it the drive (its name switches torch / reactionless, − and + its
  setting). A tap on the card opens the full read-out as a sheet of the interface (`Hud.ts`,
  'flight'; with a mouse it stays the panel at the right). The dashboard's three screens are dark on
  a touch screen (the headset and the desk keep them). The Time chip and sheet tell the ship's own
  warp as measured from its clock (`Flight.timeReport`, `readout.pace`), the universe's rate with
  it, and why it is not what was asked (the autopilot, the computing per frame, the ×100,000 top);
  Faster and Slower step it ×1 … ×100,000; Now goes back to ×1 without moving the date; Reverse is
  refused aboard. Flying by hand by touch is part 7 below.
- *Not done*: the view at speed (aberration, Doppler, the headlight effect): drawn as at rest; a
  precise specification is in the notes (the star shaders were other agents' work in progress).
  With the live N-body physics coming, the notes list what the ship reads live and what assumes
  two-body orbits (the prediction line, the rails).
- Tests: `tests/relativity.test.ts`, `tests/autopilot.test.ts`, `tests/flight.test.ts`;
  `scripts/flight.mjs` (34 checks), `scripts/game.mjs` (21).

## Gravity for real: live physics and the first powers (physics worker)

The owner: "it feels like you can't really interact with any of the planets or stars or black
holes ... all you do is click on them, look at them", and the plan agreed with them: the real
universe stays real until you touch it; the moment you change something, that system switches to
live physics, with a "Back to reality" button; one part at a time. This is step 1 of that plan
("Gravity for real"): everything in the Solar System pulls on everything else, time can be asked
to run up to a thousand years a second (it runs as fast as the stepping allows), things collide
and merge, and the first powers: Mass, Move, Add, Remove. The engine and every decision behind
it: `docs/notes/gravity-engine.md`.

- *The powers* (the selected world's card, under its three buttons: no mode, nothing hidden in the
  details). **Mass**: a slider from a thousandth to a thousand times its real mass, read as "2
  Jupiters", "0.5 Suns", with what theory predicts of such a body labelled as a prediction; the
  orbits answer while the thumb is down. **Move**: a finger on the world drags it, in the plane of
  its orbit (across the view when the eye is in that plane); time waits while it is held; left
  where it is with the velocity it had, or on a circle round whatever holds sway there. **Add**: a
  moon for a planet or a dwarf planet; for a star a planet like the Earth, one like Jupiter, or a
  second sun: on a circle, between that world and the eye; made bodies are bodies like any other
  (named, listed, found, moved, made heavier, removed) and say they were made. **Remove**: any
  world, the Sun included. (`src/app/Powers.ts`, `Mover.ts`, `WhatIf.ts`; `src/ui/Hud.ts` draws
  them and asks the app.)
- *Live physics* (`src/app/LivePhysics.ts`). Nothing runs until a power is used. The first change
  starts a simulation (`src/sim/NBody.ts` through `src/sim/SystemSim.ts`) from where every body is
  at that date: the Sun, the planets, Pluto, Ceres, the seven weighed asteroids and the twenty
  moons heavy enough to matter; a lighter moon, or a world nobody has weighed, rides on its
  catalogued path until its planet or it is touched, then is simulated too. From then on the
  simulation keeps the time (a quarter of each frame is its budget; a rate it cannot keep shows
  as what it is getting), the bodies are put where it has them, `Body.parent` is what each goes
  round now (`SolarSystem.homeOf` keeps the catalogue's), and what it tells of is put into words
  (a collision, a world thrown out, a capture) and kept in a log in the Time sheet. A mark at the
  top says physics is live; one tap shows the log, a second what the simulation leaves out.
  "Back to reality" puts every mass, body and parent back, takes away what was made, and gives
  the bodies to the ephemeris again at the date reached (1849 to 2150), else at the date it began.
- *A system with no sun, or two.* `SolarSystem.suns`, `sunAt` (the brightest at a place) and each
  drawn body's `BodyView.sun`: the light on a world, its shadows, its air and the exposure follow
  its own sun, or none (then the eye adapts to the Earth's cities). One corona and one glare, for
  the sun that looks largest. A world is lit by one sun at a time.
- *Drawn*: orbit lines from where each simulated body is and how it moves about what it goes
  round now; a fading trail behind each of where it has been (`src/render/Trails.ts`).
- *How fast* (measured in `tests/livephysics.test.ts` on a shared 2.1 GHz core, a quarter of a
  60 Hz frame for the stepping): a day, a month, a year a second in full; with every planet
  there about two thirds of a hundred years a second and 90 to 130 years a second when a
  thousand is asked (Mercury's 88 days set the step); all of a thousand with the Sun gone.
  Families of moons go on rails by stages as the rate asks (the Time sheet says which).
  Thousands of years a second with the planets there needs the stepping off the main thread
  (the engine is written for a Web Worker; the app does not use one). A phone was not measured.
- *Left out, and said so in the app* (`LEFT_OUT` in NBody.ts, `ALSO_LEFT_OUT` in LivePhysics.ts):
  tides and spin, relativity but for a black hole's pull, what a collision throws off (two bodies
  become one), the shapes of worlds but for the six planets' bulges; a world keeps its size and
  look whatever its mass; the belt's 75,000 asteroids and the comets keep their real paths and
  are left out once the Sun is changed; the real spacecraft are left out; a made copy of the
  Earth, Jupiter or the Sun has its size, mass, spin and face but no air, clouds, rings or lights.
- *Two suns of one mass* go round each other. The engine has the lighter side of a pair go round
  the heavier, so which of the two it says goes round the other depends on what else is near
  each when the second is made (towards Mercury, the new one takes Mercury and Venus and the Sun
  is the one that goes round); the app says "go round each other" either way, in the news and in
  both suns' details. A second sun arrives moving, on a circle round the Sun, and nothing else is
  touched: the pair drifts off and what cannot follow is left behind, told as flying free.
- *Not done*: the powers in the headset's menus; time at thousands of years a second with every
  planet there (the stepping has to move to a Web Worker); a line of the path ahead for a world
  that goes round nothing (it has its trail and the card's words); landing on a made world was
  not tried; the ship's lamp and hull heating still take the Sun to be there
  (`src/game/Game.ts updateLight`, `Flight.ts frameEnv`), and its predicted path and its rails
  assume two-body orbits (`docs/notes/relativistic-ship.md`); the pairing of the ship's clock
  with the simulation has no check of its own. Steps 2 to 7 of the plan (breaking and hitting,
  black holes, stars living and dying, deep time, the rest of God mode, story mode) are
  untouched.
- Tests: `tests/nbody.test.ts`, `keplerdrift.test.ts`, `systemsim.test.ts`, `livephysics.test.ts`,
  `powers.test.ts`, `mover.test.ts`, `whatif.test.ts`; `scripts/live.mjs` (`npm run verify:live`:
  every power through the interface, on a phone with fingers and at a desk) and `scripts/whatif.mjs`.

## Next

1. Quest performance pass on a real headset (cockpit, planet/galaxy/nebula shaders, tile atlas size,
   black hole steps).
2. Terrain: stream sharper elevation tiles everywhere (the full LOLA/MOLA/ETOPO resolution; today
   only the landmark patches have it), a real cloud layer for Earth; OpenNGC for more deep-sky objects, a sharper galaxy
   impostor from outside.
3. Unity port planning (the data pipeline outputs are engine-agnostic JSON/JPEG).
4. Gravity for real, the owner's plan after step 1 (above): things that break and hit, black holes
   that pull and eat, stars that live and die, deep time, the rest of God mode, a story mode; and
   for step 1 itself the stepping in a Web Worker and the powers in the headset.

## Checks before every deploy

`npm run typecheck`, `npm test`, then `npm run build` and, with `npx vite preview --port 4173`
running (a build, not the dev server: an edit reloads the page under a running suite), each of
`node scripts/<name>.mjs http://127.0.0.1:4173/ out`:
`start` (the loading screen and the title screen; 34 checks), `touch` (a phone, real multi-touch;
49), `interact` (mouse and keys; 14), `verify` (35 scenes), `exposure` (looking away from bright
things and back, and coming up to five black holes and going away again; 77), `stars` (the faces
of stars, measured from the frames; 18),
`whatif` (the worked-out facts, a moon made and taken away; 35), `live` (live physics and the
powers, each through the interface on a phone and at a desk; 75),
`vr` (IWER Quest 3 emulator; 32), `game` (21), `walk` (45), `places` (rings, comets, eclipses; 16),
`terrain` (14), `flight` (34). At most three at a time on four cores (more
starves the software renderer: screenshots and clicks time out). On a machine with a real GPU
these run far faster than in the cloud container (software rendering, a few frames a second).
Every script starts its browser through `scripts/lib/browser.mjs`; set `CHROMIUM_PATH` to use an
installed Chromium when Playwright's own download is not available.

## Licences to keep in mind

Gaia DR3 supplement (`public/data/stars-gaia/`) is CC BY-NC: drop it for a paid store app. AT-HYG
tiles are CC BY-SA 4.0; OPAL maps CC BY 4.0; NASA/USGS/NOAA public domain (the Sun's map among
them: NASA SVS). See `CREDITS.md`.

## Clean-up pass (ground up, one part at a time)

Each part is gone through file by file: bugs fixed, tests added, and the unit tests and browser
suites run again before the next part starts. Nothing is rewritten for its own sake; the engine
above is validated against JPL Horizons and stays as it is unless something is wrong.

1. **Foundation (`src/core`, `src/astro`): done.**
   - `UPos`: the double-double sums no longer allocate (they return through two module variables);
     results are bit-for-bit the same (`tests/astro.test.ts`).
   - `Ephemeris`: a chunk that failed to download was requested again every frame; it is now retried
     after a pause that doubles up to a minute and reported once (`tests/ephemeris.test.ts`).
   - `formatDistance`: plain numbers ("21,660 km", "10.490 million km") instead of "2.166×10^4 km",
     independent of the browser locale (`tests/units.test.ts`).
   - Black-hole scale row: stellar holes read "the horizon is 125 km across; Earth is 102 times
     wider" instead of "0 Earths would fit inside the horizon".
2. **The interface, as a phone app, and the basics under the finger: done** (the owner asked for
   this next: "revamp the whole UI so it's like a mobile app", basics first, then work up).
   - *Touch* (`src/app/Gestures.ts`, pure and unit-tested; `src/app/Input.ts` feeds it pointer
     events): one finger drags (and glides on after a flick), taps and double-taps; two fingers
     either drag together or pinch-and-twist, decided once per gesture from their first pixels (a
     pinch never tilts, a two-finger drag never zooms); a finger left down after the other lifts
     does nothing. The page itself never scrolls or zooms (`touch-action`, viewport, fixed body).
   - *What the camera is at is not what is selected.* `rig.target` (orbit and zoom centre) is the
     last destination: `goTo`/`placeNear` set it, `select()` no longer does. Tapping the Moon from
     Earth shows its card; the camera keeps turning round Earth until "Go there". Before, the first
     drag after a tap swung the camera round the far object. Stopping a flight (`cancelGoto`)
     leaves no target: open space, where a drag looks and a pinch moves along the view.
   - *Pointers hold the world* (`CameraRig.orbitBy/zoomBy/lookBy`, `tests/pointer.test.ts`): a
     drag that starts on the target's surface carries that point with the pointer (exact, by ray
     and sphere; off the surface it turns at a steady rate capped by what the ground below would
     do; towards the horizon a pixel carries at most 30 times what it does straight down). Zoom
     (pinch, wheel, double tap) multiplies the height above the surface, so it eases down to eye
     height on the landing terrain, and keeps what is under the fingers or the pointer under them.
     Looking round within a radius of a world turns about its vertical: level horizon, no flip over
     the zenith. The mouse got the same (right-drag grab, wheel towards the pointer). The app
     tells the rig each frame what the target offers (`App.describeSurroundings`: surface radius
     under the camera, closest approach, local vertical).
   - *Upright screens* (`verticalFov`, `rig.framing`, `rig.aim`): `fov` is the vertical field of a
     wide view; upright it opens to at most 1.5 times (50° → 70° on a phone), and arrivals stand
     back so the object fills the same share of the narrow side (Earth at 4.9 radii instead of
     3.4). The foot of an upright screen is under the tab bar and the card, so the camera holds
     what it is aimed at above the middle (`Hud.subjectLift` → `rig.aim`, used by `lookAt` and the
     autopilot's turn): the subject sits in the room the interface leaves. Orientation only: no
     lens shift, so `project()`/`ray()` and the shaders are untouched.
   - *Near the ground the camera turns with the world* (`App.carryWithGround`, `rig.carry`): fully
     below 2 % of the radius above the ground, not at all above 20 %. Before, a camera brought
     down to the surface stayed fixed against the stars while the ground slid away under it
     (4.6 m/s on the Moon, 465 m/s at Earth's equator); from afar a planet is still seen to turn.
     Walking and the ship keep their own frames; a flight under way is flown about the centre.
   - A double tap (or double click) on the world the camera is at comes six times closer to the
     tapped spot (`rig.zoomToward`); on anything else it flies there. After a zoom out the camera
     counts as climbing for 1.5 s (`rig.rising`), or standing height would pull it back down.
   - *Interface* (`src/ui/Hud.ts`, `styles.css`, `icons.ts`): top chips (place, clock), a tab bar
     (Search, Explore, Time, More) and one panel above it: the card of the selection (Go there /
     Look at / Details) or the open sheet. Wide screens put the tab bar at the left edge and the
     panel beside it. The Hud only draws and reports: `App.act(name)` does what a button or its
     key asks (`HudHost`). Texts are updated in place, never rebuilt. Lists of places come from
     `src/app/destinations.ts` (shared with the headset's menu), pictured from the thumbnail sheet.
     Names on the sky are tappable (`Labels.at`); a finger reaches 22 px, a pointer 9, and a faint
     star needs a closer tap. First run on a touch device explains the gestures once.
   - *Phones are lean* (`src/core/device.ts`): a touch-first device gets the headset's content
     budgets (fewer procedural stars and galaxy particles, smaller tile cache and ground
     materials, no 8k maps); shaders stay at full quality, the governor scales resolution.
     Decided without a phone at hand: memory is what closes a tab. `?lean=0/1` overrides.
   - *Installable*: `public/manifest.webmanifest`, icons, `viewport-fit=cover`; added to a home
     screen it opens without the browser around it. (The name also lives in `index.html` and the
     manifest; `src/core/product.ts` covers the code.)
   - Verification: `scripts/touch.mjs` (real multi-touch through the DevTools protocol, upright and
     sideways; `scripts/lib/touch.mjs`) and the mouse checks added to `scripts/interact.mjs`, next
     to the unit tests above. Run for this part (headless Chromium, software WebGL): 301 unit
     tests; touch 49/49, start 24/24, interact 11/11, the 35 scenes of verify, vr 32/32, game
     20/20, walk 45/45, places 14/14, terrain 14/14, flight 19/19 (bench not run). Three suites at
     once on four cores made start and walk time out once each; one at a time they pass.
     Not yet tried on a real phone: the gestures and the layout are checked in an emulated one,
     the frame rate and the memory are not.
   - Fixed on the way (found by running every suite against the commit before): in the headset a
     trigger or a pinch away from the destination during a flight now stops it. `scripts/vr.mjs`
     had the check ("pinching empty sky stops the flight") and it failed before this part too:
     `VR.onSelect` ignored everything while travelling, and the sky is never empty (the ray
     "straight up" picks the star HR 8702 within its 1.5°). Tried only in the emulated headset:
     worth a minute in a real one (a second pinch too soon after the one that starts a flight
     would now stop it).
   - Not done here, next in this order: **free flight on touch** (a thumb-stick; with it, manual
     flight hands the target over to whatever the camera is near), **landing and walking on touch**
     (a "land here" button; the walk mode's look and move), then the ship, missions and the
     benchmark as screens of the app. Smaller: a sheet is not yet draggable to a taller size; on
     the ground a one-finger drag on the sky does nothing (two fingers look, or the Orbit/Look
     button); with a tall sheet open the subject is behind it (the aim allows for the card only), and on a
     phone held sideways the card covers a corner of it (no sideways aim yet); a
     link with `?target=` and no `dist` places the camera at 4 radii whatever the screen's shape
     (a little tight on an upright phone: `App.applyUrl` could use `rig.framing` as `goTo` does).
3. **The eye, the start and the stars: done** (the owner, after part 2: "when you look at any
   planet and then look away from it, especially like stars and black holes, it will create this
   giant burst of light"; "an actual loading screen ... shows you the real loading"; "the stars
   don't look very good", "better models for stars"). The video the owner meant to send had not
   arrived: the star work was judged on frames taken here at a phone's size and density.
   - *The eye* (`src/app/Exposure.ts`, pure; `tests/exposure.test.ts`). What was wrong: a bright
     thing held the exposure down only while its **centre** was on the screen (plus 40 px), the
     adaptation was as quick to open as to shut, and the Sun's glare stayed at full strength
     beside the frame. So a black-hole disk whose centre left the frame whited out the whole
     screen, Saturn's rings flared once the globe was out, and turning back to the Sun flashed.
     Now everything is measured from the edge of what shines to the edge of the frame (`seen`:
     coverage, share shown, and `presence`, which falls to nothing only a margin beyond the
     edge); a limit lets go in proportion to presence (`released`); the eye opens over 0.6 s and
     shuts in 0.12 s, and is never more than e^0.3 too bright even for one frame (`adapt`). The
     Sun's glare is multiplied by its presence. Rings count with their planet
     (`BodiesLayer.ringOuter`; `Body.rings` was a dead field).
   - *Accretion disks* are not balls: from inside a disk's own radius (Cygnus X-1's reaches
     94,000 Schwarzschild radii, the arrival view is 40 from the hole) it lies all round the eye.
     Close to the hole the disk is still measured as a ball (lensing wraps its picture round the
     hole; the tuned arrival views are unchanged). Beyond that, `diskSeen` follows the frame's
     sight lines to the disk's plane: 26 x 26 cells over the frame and its margin, each counting
     for the part of it the disk takes (the rim is one smooth edge, `G = a - |q|`, so nothing
     switches as the view turns), reading the radius at its hottest corner but never less than
     the cell's own footprint on the plane (from far off one cell holds the whole core).
     `diskLimit` then holds the exposure by the brightest part there is enough of (1.5 % of the
     frame in full, less for less). How bright a part is drawn comes from
     `BlackHoleLayer.shownAt`: the shader's own arithmetic (temperature profile, the Doppler and
     gravitational shift of the gas moving towards or away from the eye, a bright streak, the
     thinning outer disk), and counted by its strongest colour, not its luminance, where the two
     differ (a deep red glow shown as bright as a white one came out pink).
   - *The tone curve* brought a colour channel in only where it reached the display's top: a
     corner in the curve, which a red star's face showed as a pale disc inside an orange ring. It
     now starts at 80 % and has no corner (`shaders/tone.ts`).
   - `scripts/exposure.mjs`: eight scenes (the Sun far and near, Sirius, the Earth twice, Saturn,
     Cygnus X-1, Sagittarius A*). The app's loop is stopped and frames are stepped by hand, a
     tenth of a second each, so every run is the same; each frame is metered (how much is burnt
     out, white or a single colour driven to the top; how bright; the exposure; the glare). The
     view turns 120 degrees away, waits, and turns back twice as fast. On the commit before, the
     Sun, Cygnus X-1 and Sagittarius A* fail it (97.9 %, 100 % and 26 % of the frame burnt out).
   - *The start* (`src/app/Loading.ts`, pure, `tests/loading.test.ts`; `src/ui/Splash.ts`; the
     markup and styles are in `index.html`, so the screen is up before any script). `App.create`
     starts every download at once (they waited on WebXR detection, and four of them on each
     other) and tells a `LoadProgress` when each is in and what it brought: the counts are read
     from the data ("8 planets, 459 moons", "6,333 planets of 4,743 stars"), the bytes from the
     browser's own resource timings. The bar is the share of the stages done, by weight; it never
     runs ahead and never goes back. Then `App.firstView`: with the frames already drawing behind
     the screen, it waits for the Milky Way's map, the maps of the world in view, the shaders,
     and 65 % of the star regions the sky needs (they arrive brightest first), each for 12 s at
     most. The quality governor starts afresh after that (its window was full of the loading's
     slow frames). The title screen is made when all of it is through and no longer has a
     loading state; `window.app` is set at that moment too (the scripts wait for it; the page's
     own element is `#stage` now: as `#app` it was `window.app` from the first byte, and truthy).
     The title screen shows the live view as it is, dimmed: it used to blur it by 5 px and drift
     a tile of drawn points over it (very likely the "stars don't look very good" of the
     beginning: the real sky smeared, under a fake one; the blur was also a full-screen filter
     over the canvas every frame). A piece the
     explorer cannot do without that fails names itself on the screen, with "Try again"; one it
     can do without says "not available". Put off until the explorer is on the screen: the
     ground materials (24 files, 7.4 MB, were fetched first thing) and the lists' thumbnails.
   - *Star points* (`shaders/psf.ts`). They were Gaussians 0.6 CSS px wide and up, read at
     pixel centres, on a canvas of at most 2 pixels per CSS pixel: a phone of 3 stretches that
     canvas one and a half times, so every star was a soft blob and the dither showed as a faint
     mesh. Now: the canvas has the screen's own density up to 3.2 million pixels
     (`core/device.ts canvasRatio`; 2 samples a pixel instead of 4 above 2.4 million; the
     governor's steps reach down to the same 1.2 render pixels per CSS pixel, `renderScale`); a
     star's light is summed over each pixel's area, so the narrowest star is half a pixel wide
     and does not flicker as it drifts; a faint star is as bright as its light makes it at that
     size, a brighter one goes white-hot (to 3 times white) and a little wider, and the stars of
     the constellation figures get a glow that carries their brightness and colour. The light of
     a faint star is what it was (`uPointLight`); the headset keeps its wider cores. The final
     dither no longer uses a sine hash: where a GPU's sine of a large number is coarse (the
     software renderer here, and many phones) it came out as a regular one-level mesh in the
     dark, not as noise (`Renderer.ts`, interleaved gradient noise).
   - *A star up close* (`shaders/star.ts`, `StarLook.ts`, `StarCorona.ts`). It was a flat, pale
     disc with a bright rim: the face was shown at 0.9 to 1.8 of white, where the tone curve
     flattens everything, and the glow layer started inside the limb and outshone it. A face
     large in the view was brought under the display's white, with a steeper limb darkening and
     a restless pattern standing in for the granules (the owner found that face unconvincing:
     it was redrawn in part 5, and nothing of it is left). What stands from here: the glow is
     written at the star's own depth, so the face hides what is behind it to the pixel (measured
     in its quad's plane it left a dark sliver on one side of any star off the middle of the
     frame), and it stays under the limb's brightness. A small cool star is a red dwarf, not a
     white dwarf, whatever its estimated radius (Proxima comes out at 0.022 solar radii; see
     below). The Sun's glare fades with the share of the frame its disk takes, not with pixels.
     A dead copy of the star shader in `shaders/body.ts` is gone.
   - Verification: see "Checks before every deploy" for the commands. Run for this part (headless
     Chromium, software WebGL, against a production build): 350 unit tests;
     the 35 scenes of verify, start 34/34, touch 49/49, interact 11/11, exposure 48/48, vr 32/32,
     game 20/20, walk 45/45, places 14/14, terrain 14/14, flight 19/19 (bench not run). The same
     suites passed on a build of the first two things alone, before the stars were touched. The
     README's pictures are from this run.
   - Not tried on a real phone, and worth watching there: the frame rate at the screen's own
     density (the governor should bring the scene's resolution down within seconds if it is too
     much; `?governor=0` and the perf HUD show what it does) and the memory. If stars soften on
     weaker phones whenever the governor steps down, the answer is to draw the points in their
     own pass at the canvas's resolution after the composite (occluded by one read of the scene's
     depth per star); it was left out here as too large a change to the renderer for one part.
   - Seen and left: star radii are estimated without a bolometric correction, so red dwarfs come
     out several times too small (the info card says "estimated"; the README lists it); the
     bloom adds about 40 % of a large bright area's own level over it (a veil that lowers
     contrast on a planet filling the view); the Sun's glare from 10 to 30 radii greys the whole
     frame; the bodies' shader still has a sine hash (`shaders/body.ts` h33, for the generated
     craters): on a GPU with a coarse sine its cells may line up, as the star shader's did.
4. **The glow, the view from a world, and the first of "what if": done** (the owner, with four
   screenshots from an iPhone at M87* and inside M60: "The lighting is still weird. Not when you
   look away now, but like with bright things like black holes and stuff when you zoom out. And
   when you're like looking from the point of view of planets. Also start adding in small things
   to incorporate God mode ... incorporated into the app, not like a separate thing that you
   click for God mode"). Each of the three was reproduced here before it was touched.
   - *Stripes and dots at a black hole* (the screenshots: hatching in polygons, a dotted mesh).
     The renderer adds the glowing volumes (a galaxy's light, nebulae) to the frame through a
     full-screen quad that lives in the scene (`Renderer.volQuad`). The black holes' environment
     capture drew the scene, quad included: every face of its cube map got the main view's
     picture of the glow pasted over it, read far outside the texture (its edge pixels smeared
     into stripes, its per-pixel jitter magnified into dots), and the volumes themselves, which
     are on a layer of their own, were never in it. Now the capture hides the quad and draws the
     volumes into a second, smaller cube map (`BlackHoleLayer.glow`, 512 px faces; soft light
     needs no more), which the lensing shader adds to the first. The volumes draw there with
     their samples mid-step and their noise at that map's detail (`VOLUMES.jitter`,
     `VOLUMES.pixelAngle`: one uniform each for every volume shader, and one `volJitter()`:
     the four shaders had three different hashes). The map is redrawn whole when the glow's
     brightness changes (`glowLevel`), so its faces never differ. Inside a lensing region the
     main volume pass is skipped (`VOLUMES.covered`: the hole draws the whole frame and the
     pass was drawn only to be painted over; on a phone that region reaches 23 light years from
     M87*).
   - *The jet as a zig-zag* (found on the way, older). The lensing sphere of a supermassive
     hole is light years wide; in metres its clip coordinates are ~1e17, whose products
     overflow 32-bit floats in the rasteriser, and what it interpolated across each triangle
     (the sight line) was wrong: the sky behind showed as a mosaic of the sphere's facets, and
     the hole's own disk was displaced. One factor for the whole mesh (`uClipScale`, as the
     jets and the galaxy volumes already had) and the sight line passed in units of the sphere.
   - *The white-out from a few light years* (the screenshots: a white blob over the frame).
     `diskSeen` counts a cell of the frame as no hotter than a patch its own size on the disk,
     so from far off the cell that holds M87*'s whole glowing middle (25 of its 600 radii) read
     as the cool outer disk: nothing held the exposure, and a core ten thousand times too
     bright bloomed over everything. Between 300 radii and 917 the exposure jumped 50,000
     times. Now what the cells cannot resolve is one entry of its own (`DiskSeen.core`), counted
     by its light (`diskMean`: summed ring by ring, over the gas coming and going), and the
     rule is one for all sizes: the brightest FILL of the frame is shown at `level` on average,
     and a part smaller than that counts by its light as if spread over FILL. A far-off disk is
     a glint with a modest halo; nothing lets go as it shrinks (`tests/exposure.test.ts`: no
     step over four decades of distance). The tuned close views are unchanged (they are held by
     the ball rule, as before).
   - *The pale fog inside a galaxy* (the M60 screenshot; the heart of M87). Two causes. The
     march could not take steps shorter than the ray's length over their number, so a
     spheroid's cusp (a quarter of a central sight line's light comes from the innermost
     hundredth of the effective radius) got one sample drawn from a tenfold range: dots that no
     jitter averages. The spheroid's steps are now a fraction of the distance from the centre
     all the way in, counted beforehand (an inverse hyperbolic sine) and kept for it; the disc's
     steps share the rest. And the galaxies' brightness was metered by the view alone, to a
     mid-grey: inside one, where its light is all round, that is fog in every direction. Now the
     light all round (the mean of the logarithm over fourteen directions) is shown at `VEIL`
     (0.04) at most, whichever way the eye looks; from outside, where part of the sky is dark,
     the view decides as before. The metering's own estimate saw nothing of a disc from inside
     its plane: `layerColumn` follows the disc's layers along the ray from wherever the eye is
     (`tests/galaxylight.test.ts`). The volume pass is added through a tent over its 3 x 3
     neighbours instead of one tap.
   - *From a world's point of view* (turning the view round at the Earth, in a planet's shadow,
     on its night side). Four things. (1) A sun in the frame took the worlds beside it down with
     it: with the Sun a few pixels wide anywhere in view the planet being looked at was black,
     and from the night side the screen was black but for a dot. A sun's own face, corona and
     glare now have an exposure of their own (`Bodies.lightExposure`, the other stars' discs
     too); the worlds keep theirs; the stars still go out while a sun is in view. (2) A sun
     behind a world held the exposure all the same, and its glare shone through the planet:
     `Exposure.hidden` (the share of its disc that a nearer ball covers) scales its hold and its
     glare; in a planet's shadow the stars are out. From there none of the planet's sunlit face
     is in sight, and its hold loosens by `NIGHT` (15) so the lights of its night side show.
     (3) After a sun left the frame the sky stayed black for two seconds (twenty e-folds at
     0.6 s each): the stars now come back with their own time constant (`TAU_STARS`, 0.25 s).
     (4) An eclipse was measured at the body's centre alone: when Io crossed in front of the
     middle of Jupiter, Jupiter counted as gone dark, the exposure opened and its sunlit side
     flooded the frame white (caught here by chance, at the hour it happened). It is the share
     of the body's sunlit face in the shadow now (`core/discs.ts shadowShare`: a moon's shadow
     on its planet is a dot, a planet's on its moon is all of it). (5) A lit disc holds the
     surfaces' exposure from the size at which it is drawn (0.6 px for a body or a spacecraft,
     0.8 for a planet of another star), not from 1.5 px: in between, a moon's disc was drawn
     with the eye open for the dark, ten thousand times too bright, and bloomed into a ball of
     light (from Jupiter, one of its moons like a second sun). With the worlds no longer held
     down by a sun in the frame this showed at once beside Alpha Centauri: the scene-by-scene
     comparison with the last run caught it (`verify` scene 08).
   - *What if: the first of it* (the original's God mode, folded in: no mode, no switch; each
     power has its button where it belongs). (a) A world's details now show what follows from
     its facts by the textbook, each line opening to its working: the formula, the numbers put
     in, the result (`src/sim/physics.ts`, the original's `god/physics.ts` with its tests;
     `src/app/Worked.ts` chooses the lines: gravity, escape velocity, density, the orbit's
     period from where the body is and how it moves, the Hill sphere, the equator's speed; a
     star's luminosity and habitable zone; a black hole's horizon, photon sphere, innermost
     orbit and Hawking temperature). Nothing is looked up: a line whose ingredients are not
     measured is left out. (b) A planet's details offer it a moon (`src/app/WhatIf.ts`,
     `SolarSystem.add/place/remove`, `App.addMoon/unmake`): sized to its planet, rock inside
     the frost line and ice beyond, on a circular orbit in the plane of the equator between the
     planet and the eye (never inside the Roche limit), with the period Kepler's third law gives
     it. It is a body like any other from then on (drawn, named, listed among the planet's
     moons, flown to, pulling on a ship, casting its shadow), says "made by you" in its facts,
     and can be taken away again. `scripts/whatif.mjs` checks all of it on a phone and at a
     desk. Not yet: keeping what was made across a reload; choosing its size or orbit; anything
     else of the original's editor (changing a world, making planets and stars, N-body
     gravity). Next powers are to go the same way: one button, where it belongs, with its
     physics shown.
   - Verification (headless Chromium, software WebGL, against a production build): 388 unit
     tests; the 35 scenes of verify (28 of them the same picture, to the pixel, as in the run for
     part 3; the other seven differ in what moves: a disk's gas, clouds, the ship's
     instruments), exposure 51/51, whatif 29/29, start 34/34, touch 49/49, interact 11/11, vr
     32/32, game 20/20, walk 45/45, places 14/14, terrain 14/14, flight 19/19 (bench not run).
     With three suites at once, start and touch each failed one check once (the bar's last ticks
     not seen; a pinch that did not lift off); each passes on its own, as before.
     Not tried on a real phone: the owner's four screenshots were reproduced in the emulated one
     and are gone there.
   - Seen and left: the stars inside a giant elliptical do not show near its centre (the heart
     of M87: 145,000 are generated, the nearest cell 27 kpc away): the cells of the brightest
     bands are sized for the Milky Way and hold up to 12,000 stars each, so a dozen of them fill
     the pool before any cell near the eye is asked for (`ProceduralStarLayer.update`,
     `GalaxyInterior`); M60's heart does show them. The view from the centre of a galaxy is
     kept dark (`VEIL`): the real one would be a blaze. Pluto's sunlit side is near white (every
     world's mean is shown at 0.45, and Pluto's map has more contrast than most). A made moon can
     be flown to and come down to (tried to 7 km: its ground is the generated one, and from there
     shows faint steps across its slopes; whether other worlds without measured heights do the
     same was not looked at); walking on one was not tried. The remaining sine hashes (`Jets.ts` h1,
     `Materials.ts` mhash2, `shaders/rings.ts`, `shaders/planet.ts`, `shaders/body.ts` hash1 and
     h33) are as they were.
5. **A star's face: done** (the owner: "Work on the stars because they don't exactly look
   realistic and they barely have any texture, if at all"; looked at on an iPhone, in Chrome, at
   three pixels to the CSS pixel).
   - *What was tried first, and thrown out.* A pale yellow-white disc with a dark limb, a mosaic
     of granule cells and dark sunspots: what a telescope with a white-light filter shows. The
     owner: "that looks nothing like a star", with a page of pictures of the Sun attached, the
     space observatories' (SDO at 304 Å and its like): a deep orange disc, mottled and wormy all
     over, white-hot active regions, as bright at the limb as in the middle, a red glow hugging
     the limb, prominences. That is what a star looks like to people, and a star's face is drawn
     after those pictures now: stylised, and said so in the README's list of what is. Nothing of
     the first attempt is left in the code. The owner's next words: "What about try downloading
     it from external services?" (below: the Sun's own face).
   - *The colours are designed on the display* (`StarLook.ts`: `faceColor`, `fire`, `untone`,
     `faceLight`; `shaders/star.ts`: `STAR_FACE_GLSL`). `fire(face, I)` is the colour the screen
     shows where a face is `I` times as bright as its mean: darker is deeper in the star's own
     colour, brighter paler, the brightest white-hot (on the Sun red, orange, yellow, white). The
     shader writes the light that the tone curve brings to that colour (`untone`, the curve the
     other way round). Measured on the owner's picture: the disc's median sRGB (226, 95, 5), its
     darks (197, 51, 2), its brights (228, 157, 66), white cores. Three things turn such a face
     pink or pale, and each did:
     1. *A brighter exposure* must climb the face's colours (`faceLight` takes the level and
        evaluates `fire(I * level)`: orange, yellow, white), not multiply its light: the tone
        curve brings a strong colour whose red is at the top back in by adding white.
     2. *The bloom.* Over a bright area far wider than its blur the composite's bloom adds every
        level's share of the area's own light, 42 % in all, and the face went up the tone curve's
        shoulder: salmon (251, 139, 91) where (225, 95, 10) was designed, and flatter. It showed
        only in the app (a scratch page that drew stars with the app's shaders, used to work the
        look out, had no bloom: judge in the app). `STAR_FRAG` now leaves out of what it writes
        what the bloom will lay over it (`shaders/bloom.ts`: `bloomVeil`, by the disc's radius
        on the screen and how far inside its edge the place is, per level of the chain;
        `tests/bloom.test.ts` runs the chain's own arithmetic on a disc and compares).
        `BLOOM.uBloom` is set by the renderer every frame, and is 0 in a headset, which has no
        bloom pass. Anything else designed in the display's colours has to make the same
        allowance.
     3. *Lights added up.* A prominence drawn over the limb's red skin as a second light came
        out pale pink: the two are one brightness of the face's colours (`CORONA_FRAG`).
   - *How bright a face is shown* (`App.ts`: `starCap`). A disc large enough to show its face (60
     CSS px in radius) is at the level its colours are designed for (`FACE_KEY`), whether it
     fills the view or stands in a dark sky (with dark sky round it it was up to half as bright
     again: yellow, where the pictures are orange); a smaller one is brighter, and so hotter, up
     to 1.8 for a Sun a few pixels wide.
   - *The Sun's own face* (the owner's idea, tried and taken). NASA's Scientific Visualization
     Studio has "STEREO+SDO: Around the Sun for 81 Days" (SVS 3851, public domain): 611 maps of
     the whole Sun at 304 Å, 4096 x 2048, each from the three spacecraft that saw all of it at
     once in 2011. `pipeline/build_sun_map.py` makes `textures/sun.jpg` (1.1 MB) of three of
     them and lists it in the textures' manifest (`maps.sun`: the credit, and the eight brightest
     patches as `regions`). What had to be dealt with:
     - one frame is smeared along the longitude where two spacecraft's views meet (a quarter of
       the sphere, worst on the far side). The maps are in Carrington longitude and the seams
       move over the surface, so the map takes each longitude from the frame in which it is
       sharpest (frames 200, 255, 309: a quarter and a half turn of the Sun apart); the smear
       is measured as detail along the longitude over detail across it (0.24 at a seam, 0.81 at
       the worst place of the map made). A synoptic map: real throughout, not one instant.
     - the frames are pictures in the instrument's colour table, red at its top nearly
       everywhere: the map stores the pattern only (green plus half the blue, over the median,
       as a square root), and the app draws it in the face's own colours, to the power 1.4 (1.8
       at the top), which brings its darks, middle and brights to the owner's picture's
       (measured in the app: median (224, 91, 18), darks (179, 40, 12), brights (242, 168, 76)).
     - towards the poles every frame is smeared (no spacecraft has looked down on them): beyond
       48 degrees of latitude the generated pattern fades in, and has the poles from 62.
     - in the shader (`STAR_FRAG`: `uMap`, `uHasMap`, the body material's own): the map turns
       with the star (`uSpin` shifts it); the generated octaves coarser than the map shows are
       not drawn over it, the finer ones are, so there is detail at any distance; and it
       seethes, since a map is one moment: the generated ground it replaces brightens and dims
       it from place to place. (Swinging the map's own coordinates about was tried first: it
       curls the real texture into marble.)
     - `starLook('sun', ..., regions)` makes the map's active regions the Sun's spots
       (`mapSpots`), so the loops of its prominences stand on the regions the map shows; and a
       mapped star turns all of a piece (`shear` 0), or they would drift off them.
     - it is asked for when the Sun's disc passes 24 px or the Sun becomes a destination
       (`Bodies.requestFace`), not at the start: from the Earth the Sun is a few pixels wide.
       Until it is there, and if it fails to load, the face is the generated one, its active
       regions in the same places.
     - why it stayed: side by side with the owner's picture at a phone's size, the mapped Sun is
       the one that looks like it; the generated face reads as drawn. It is the Sun of spring
       2011, not of the date shown (said in the README).
     - hosts: everything came from svs.gsfc.nasa.gov, which the container's proxy lets through
       (as it does sdo.gsfc.nasa.gov, stereo-ssc.nascom.nasa.gov and soho.nascom.nasa.gov, not
       needed in the end). Two others looked at for a map could not be reached from here, by
       faults of the connection and not the proxy's refusal, and were left alone:
       solarsystemscope.com (an artist's Sun texture; an HTTP/2 protocol error) and
       jsoc.stanford.edu (SDO's own synoptic maps; a TLS version the client does not speak).
   - *The generated face* (every other star; the Sun's poles and what is finer than its map).
     Mottled ground and short threads of light, octave on octave from an eighth of the scale
     that stands out (a star's own: fine on a dwarf, a handful of cells across a supergiant)
     down to what the pixels show, each octave fading in as the eye comes near enough to resolve
     it (nothing flickers or pops while zooming) and swinging round its own place (the surface
     seethes and drifts nowhere). Active regions where the star's spots are; prominences
     anchored to them (`StarLook.proms`; `StarCorona.seenAt` works out every frame where each
     stands as seen), so they ride round with the star and rise over the limb. The turning is
     shown at its full, sped-up rate from afar and slowed from close by, where the surface
     would race past (`turnShare`: 6 CSS px a second at the most). The red skin at the limb is
     set on the picture's limb profile (in the app, red at 1.03, 1.08, 1.14 radii: 187, 133,
     88; the picture falls off faster, the corona's glow and the bloom being added here).
   - *Blocks on a supergiant* (found on the way). A supergiant seen from a few of its radii has
     clip coordinates near 1e12, and the software rasteriser lost the interpolation inside each
     triangle to them: the face came out in flat blocks. `BODY_VERT` scales the clip
     coordinates by `uClipScale` (the same factor for every vertex changes nothing that is
     drawn); every material that uses `BODY_VERT` must define it (Bodies, NearStars and
     ExoPlanetLayer do).
   - *A white ball in front of the Sun* (found on the way; there since part 4 gave suns an
     exposure of their own). "Earth for scale" was drawn at the surfaces' exposure, which is
     wide open while a sun covers little of the frame: from about 7 to 13 radii on a phone the
     lit sliver round Earth's silhouette blazed and bloomed over the Sun's face. Against a star it
     takes the star's exposure now (`ScaleCues`, `Awe`).
   - `scripts/stars.mjs`, on a phone: the Sun wears its map and is orange (not pale, not pink,
     not burnt out), deeper red where darker and yellower where brighter, textured in every
     quarter of the disc, with a white-hot region where the view is turned to one, its limb as
     bright as its middle, a red glow round it that fades outwards, shown at the designed
     level; it seethes (its turning stopped, the frames stepped by hand: far more has changed
     after five seconds than from one frame to the next); on the way in from 4 radii to 1.5
     its detail comes in gradually (the fine contrast of the frame's middle changes by an eighth
     in a step at the most: an octave switched on would double it); prominences rise and set
     over a turn; the turning is slowed from close by, where the face is still orange and
     textured; from among the planets, a pixel wide, the Sun is a glare of white light and not
     a dot; Betelgeuse is deep red in cells far larger than its texture, Proxima red with a
     face of its own, Sirius blue-white and nearly smooth but not a plate. Each threshold was
     set from the values the run prints, with a margin, and against what it is to rule out
     (the pale ball of part 3, the pink of the bloom, the dot).
   - *The light of a disc too small to hold the exposure* (found by comparing the scenes of
     `verify` with the last deployed run's). A star's colours top out at the display's white, so
     a disc a pixel or two wide, seen with the eye open for the dark, was a faint dot: the Sun
     from among the planets had lost its glare, and the companion of Gaia BH1 was gone from the
     lensed sky. Far above the level at which a face is white-hot all over, its light is as
     bright as it is again (`WHITE_HOT` in `STAR_FRAG`), and the bloom makes the glare of it:
     the inner system from 2.8 AU is the picture it was, to the pixel.
   - *Errors when a page is left* (found by the round). `places` failed "no console errors"
     twice running with "TypeError: Failed to fetch" out of the star catalogue. A page left
     while star regions are still on their way has those downloads cut off, and
     `StarCatalog.pump` reports each as an error; on a busy machine they are late (other
     sessions were running suites on the same four cores). The suite lets them arrive before
     it loads its next view (`go`). That the catalogue calls a download cut off by leaving the
     page an error belongs to part 8.
   - Verification (headless Chromium, software WebGL, against a production build): the stars went
     live first, at the owner's word ("Push the new stars"), on the type check, the unit tests, the
     build and the stars suite against the dev server; the round was then run on that very build.
     407 unit tests; the 35 scenes of verify (21 of them the same picture, to the pixel, as in the
     run for part 4; three more, of galaxies, differ in a few hundred pixels of a galaxy's glow, as
     two runs of this one build do; four show a star's face and differ in it: Rigil Kentaurus a
     small hot disc with a red skin, the companion of Cygnus X-1, twice, the deep blue of its kind
     where it was pale, the companion of Gaia BH1 by a shade; the rest differ in what moves: a
     disk's gas, clouds, the ship's instruments), stars 18/18, exposure 51/51, whatif 29/29, start
     34/34, touch 49/49, interact 11/11, vr 32/32, game 20/20, walk 45/45, places 14/14, terrain
     14/14, flight 19/19 (bench not run). With three suites at once, and other sessions' besides,
     start and touch each failed one check once (the bar's last ticks not seen; a pinch that did not
     lift off), as in part 4; each passes on its own. (With the machine at a load of nine, one unit
     test of the exposure, three seconds of arithmetic, ran past its five second limit; alone it
     passes.) Looked at besides, in the app at a phone's size: the Sun from 1.2 to 60 radii at one,
     two and three pixels to the CSS pixel, Betelgeuse, Arcturus, Proxima, Barnard's Star, Sirius,
     Vega, Rigel and Sirius B; and the live site after the deploy. Not tried on a real phone, nor in
     a headset.
   - Seen and left: the limb's raggedness (spicules) hardly shows. From very close (1.2 radii)
     the Sun's map is magnified eight times: soft blotches under the fine generated threads. A
     small disc's glare rims the red skin with pinkish white. The map takes the generated
     face's place the moment it arrives (no fade). Hot stars are nearly smooth by design (a
     faint mottling). (Whether a hot star was flattened used to be drawn by lot, and Sirius, a
     slow rotator, came out 17 % flattened. Since then a star is flattened only as it has been
     measured to be: the seven of `src/universe/StarShapes.ts`, with their radii, tilt and the
     angle of their pole on the sky from the interferometry papers; every other star is round,
     its spin being in no catalogue the app has. `tests/starshapes.test.ts`.) The
     headset draws the same faces without the allowance for bloom (it has none), with fewer
     octaves (`uLite`): not looked at in a headset, nor in the emulated one beyond the `vr`
     suite.
6. **A black hole from afar: done** (the owner, with a screen recording from the iPhone, at M87*,
   pinching in and out between 28 and 1.4 light years: "Look at this video, break it up in frame
   by frame if you need to, and see what's wrong with it. Because, I mean, clearly you didn't fix
   it."). In the recording the glow round the hole is a white ball 70 px across in one frame and
   an orange dot in the next, whatever the fingers do; it goes from orange to a greenish white and
   back; and it is never anything but a ball of light with a grey pole through it. Played again
   here on that build, at the phone's size, it does the same. The long form, with every
   measurement and what to know before touching this again: `docs/notes/black-hole-lighting.md`.
   - *What was wrong.* (1) The shader traces one sight line through the middle of each pixel, and
     the bright ring of M87*'s disk is a third of a pixel wide from 28 light years: the pixel on
     the hole held whatever its one line met (979, 1,858, 4,022, 2,695, 5,928 in the frame's
     measure as the eye came steadily nearer): 13,000 to 60,000 times white in a few pixels, of
     which the bloom makes a ball. (2) The passes cut each colour off at 60,000 by itself, so the
     disk's orange went white as the number grew. (3) Part 4 had given the unresolved middle of a
     far-off disk the light of a patch `FILL` wide (a white patch 64 px across, in one point) by
     the scene's exposure, which adapts: after every move the ball swelled or shrank behind it
     (going away at a pinch's pace the hole's light was up to 96 times off what it had been at
     the same place coming). (4) Farther off than its bending of the sky reaches a pixel and a
     half (some 1,300 light years for M87*) a hole was not drawn at all.
   - *The middle of a disk has an exposure of its own, which is a matter of where the eye is and
     of nothing else* (`Exposure.ts`: `diskMiddle`, `middleLimit`; `BlackHoleView.middle`, set by
     `App.updateExposure`; `uMiddle` in `shaders/blackhole.ts`). The middle is what a glint covers
     round the centre, and the bright ring at the least. Close by, the hottest ring is shown as
     the glowing surface it is (`DISK_KEY`); once that would leave the middle with less light than
     a glint holds (`GLINT_LEVEL` times white over `GLINT_AREA`: a brilliant point with a tight
     glare), it has a glint's light, from any distance, until the eye wide open has no more to
     give; then it fades as a star does. Its light only ever falls as the eye moves off, with no
     step, and is the same coming and going. The limit lets go outwards as r^3/4, as the light of
     the hottest disk falls off: nothing is drawn brighter farther out than nearer in. The scene's
     exposure holds the rest of the disk as before (part 4's rules stand).
   - *What the frame's pixels do not resolve is traced on its own, finer* (`BlackHoleLayer`:
     `miniatures`; `MINI_*` in `shaders/blackhole.ts`). A window round the hole is traced into a
     picture of 256 x 256 with the same tracing as the frame's (`BH_TRACE`), and brought down to
     the frame's pixels: by its mip levels where the window is some pixels wide, as a point
     summed over each pixel's area where it is one or two (`PSF_ON_PIXEL`, the stars' own). The
     frame's samples of the window are dropped by as much as the miniature shows, so the two
     share the disk's light out once; it takes over gradually as the window shrinks from 64 of
     the frame's pixels in half-width to 32. What is seen past the hole is in the miniature too,
     wherever it shows a picture (`uBehind`): beside the shadow the sky is squeezed into less
     than a pixel, and one sample found all of a pixel lit by a star's second picture or none
     (at A0620-00 one pixel on the hole was up to 98 times white for a twelfth of the way in,
     by its companion a quarter of the sky off: a fifth more light in the glint, and with the
     eye moving fast 2.7 times the light for a frame). A hole too far off to bend the sky is drawn
     by its miniature alone (`BlackHoleLayer.far`), down to the light of the faintest star shown;
     and a miniature is traced from no farther off than a thousand half-widths of its window
     (`EYE_REACHES`: from farther the picture is the same and 32-bit numbers no longer tell the
     sight lines apart: M87*'s far glint was twice too bright at 8,800 light years and gone by
     40,000, where it is now level from 1,200 to 71,000 and fades as a star does beyond). Light
     too strong for the frame's numbers is brought down as a whole (`withinRange`): the hue
     holds.
   - *The jets are a glow along the sight line* (`shaders/jet.ts`, `Jets.ts`). They were the
     surface of a tube, shaded by the angle its wall makes with the eye, brighter on the side
     towards the Sun (fifty million light years off) than on the other, and part of the
     surroundings the hole bends. Now every pixel of the tube that holds a pair sums the glow
     along its own line: a bright spine, threads and knots, soft edges, from any side and from
     inside. The gas coming towards the eye is the brighter (from the side both jets show alike);
     where a hole is drawn with its bending of light, that pass draws the jets itself, in front of
     the hole and behind it. Physical: the shape (the parabola measured for M87, then a narrow
     cone), the spine, the beaming. Stylised: how bright, the speed of the gas (0.7 of light's:
     M87's own would leave nothing of the far jet from most places), how slowly it fades
     outwards, the knots.
   - *How bright the glint is, is stylised* and should be said: a real point is four times
     brighter from half as far, which no display follows over six decades; from where the disk
     stops being a surface to where the eye is wide open, it is held at one light (as the
     brightest stars are held at three times white).
   - `scripts/exposure.mjs` comes up to five holes and goes away again (`APPROACHES`: M87* from a
     hundred light years to six radii, Sagittarius A*, the quasar 3C 273, Cygnus X-1, A0620-00),
     16 % nearer a frame and 45 % farther on the way out. The hole's light is read from the frame
     as it is before the bloom and the tone curve (`Renderer.lightAt`: the screen shows a glint
     and a ball a thousand times too bright alike, as white). While the hole is small: a point
     with a tight glare from afar, no leap from one frame to the next, no falling back on the way
     in, the same going away as coming, one colour; and M87* from round its galaxy (40,000,
     8,000 and 1,600 light years), a point alone, has the light it has from a hundred light
     years. A hole with a companion star is come up to from where the star stands to one side:
     from the side the catalogue's link arrives on, Cygnus X-1's supergiant is right behind the
     hole, and the light round the hole is the star's. The turning scenes of part 3 had no
     approach in them, which is how this got through twice. Unit tests: `tests/exposure.test.ts`
     (the middle), `tests/blackholes.test.ts` (which holes are drawn bending the sky, which as a
     far point, the disk's brightness, the jets' shape).
   - Verification (headless Chromium, software WebGL, against production builds, the suites one
     at a time: other sessions were running theirs on the same four cores). The whole round, on
     the tree as merged with the branch as it stood before the ship's and the live physics'
     commits: 466 unit tests (the exposure's have a minute each where a test is given five
     seconds: the longest, three seconds of arithmetic, ran out of time on the loaded machine in
     the round before); exposure 77/77 (the 51 of part 5 and 26 for the approaches; on the build
     of before the approaches fail 21 of their 26: a far-off hole was dark there, which passes
     "a point, not a ball"); stars 18/18, start 34/34, interact 11/11, whatif 29/29, places
     14/14, vr 32/32, touch 49/49 (48 at first, with other sessions' suites running: the pinch
     that did not lift off, as in parts 4 and 5), game 20/20, walk 45/45, terrain 14/14, flight
     19/19 (game and flight as those two suites then were). The 35 scenes of verify: 21 the
     same picture, to the pixel, as in the run for part 5; the other 14 were taken on the
     branch's tip without this work as well and differ from that run there too, by as much (a
     star's face, a planet's clouds, a galaxy's glow, a disk's gas and the ship's instruments
     move from one run to the next, and Cygnus X-1's companion is round since the stars' last
     commit); against that tip this work changes the three scenes with a disk and no other:
     Cygnus X-1's jets, near and far, a soft glow where a pale pole was, and at Sagittarius A*
     the gas has moved. The branch then moved a third time (the relativistic ship, its dust at
     speed, live physics); on the tree as merged with that: the type check, 526 unit tests,
     stars 18/18 and exposure 77/77 again, and no other suite. (It moved once more as this went
     out, by the trailer: nothing the app runs, and the build is the same bundle.)
     Looked at besides, at the phone's size and three pixels to the CSS pixel: the recording
     played again on the fixed build beside its own frames (a steady point with a tight glare
     from 28 light years to 10, growing into the disk by 1.4; the glow 9 to 19 px wide where the
     recording goes between 11 and 43), M87* on down to its horizon, Sagittarius A*, Cygnus X-1
     and A0620-00 from far off down to theirs. Not tried on a real phone, nor in a headset.
   - Seen and left: the glint does not brighten as the eye comes nearer until the disk is a
     surface (stylised, as above). Where the scene's exposure is the lower it holds the middle
     too: with Cygnus X-1's supergiant filling the frame behind the hole the disk's glint is
     lost against the star (rightly), and after going away far faster than a pinch does the
     glint is dim for a second while the eye opens. The rest of a hot disk, beyond its middle,
     still follows the eye: going away fast, Cygnus X-1's is dimmer than at the same place
     coming, for about a second. A bright star behind a hole comes from the environment maps
     inside the hole's region, a face a frame while the eye moves: in a fast pinch its limb is
     notched at the region's edge until the eye rests (older than this part; the notes say two
     ways out). Where no miniature is shown (a hole large in the frame, or one without a disk)
     a star's second picture beside the shadow still comes and goes a pixel at a time as the eye
     moves. From hundreds of
     light years M87's jets are a hairline across the frame. (The sine hash of `Jets.ts` listed
     under part 4 went with the old jets.)
   - *Visual faults, one at a time* (reported by other agents or seen in the trailer; each
     reproduced at a phone's size first, fixed at its cause, checked and live before the next):
     - *Earth for scale read as a glitch*: a small disc on the Sun or on Jupiter that said nothing
       (a dark dot on the Sun, a grey ball on Jupiter). It now has its name beside it, "Earth, to
       scale" (`App.labelCandidates`, before every other name), and it is drawn only while names
       are (`Awe.update`: not with the names off, nor in photo mode). Chosen over hiding it until
       Details is open: the comparison is the point of it, and a name is how everything else on
       the sky explains itself. It is lit by the star of the world it stands against: beside a
       planet of another star it was lit by the Sun, light years off, and was the "flat black
       disc on 51 Peg b's cloud deck" once listed below. `scripts/interact.mjs` checks the name
       and its going with the names (12 checks now).
     - *Saturn's limb through its rings*: a thin dark arc across the rings where they pass in
       front of the planet's edge (the trailer's shot of 15 June 2017). The air shell is drawn
       after the rings (it dims what is behind it) and the rings write no depth, so it dimmed
       them too. The shell of a ringed world now knows its rings (`AtmospheresLayer.rings`, from
       `BodiesLayer.ringsOf`; `RINGS` in `shaders/atmosphere.ts`): where a sight line meets the
       ring plane before the air, the air's light and its dimming are cut by what the ring lets
       through. `scripts/places.mjs` measures the rings in front of the limb with the air and
       without (15 checks now): on the build of before 1.5 % of those pixels lost a tenth of their
       light or more, the worst 71 % (at a phone's density 9 %, the worst 95 %); now 0.1 %, the
       worst 12 % (0.6 % and 19 %).
     - *"M87" and "M87\*" stood on each other and on the hole*: the galaxy and the hole at its
       heart are at one point, and each name was set up and to the right of it by its own size,
       so the two stood in a stack; and a hole's name was set by its shadow alone, which from
       afar is a speck inside the glowing middle of its disk. Now one point has one name, the
       first by priority (`layoutLabels` in `render/Labels.ts`, pure, `ONE_POINT` 3 px; Earth
       for scale, set over its giant on purpose, is exempt: `over`), and a hole's name clears the
       bright inner disk or a glint (`App.labelCandidates`, `HOLE_GLINT_PX`). Close by, where
       the disk fills the view, the name stands on it as a planet's does on its disc.
       `tests/labels.test.ts`; `scripts/interact.mjs` at M87* from 1,000 radii.
     - *"Unnamed star" on the card of a star with a number* (the owner's screenshot: the card
       said "Unnamed star · 263 light years" while the ship's marker and instruments said
       "HIP 12941 · 263.1 ly"). A catalogue star without a proper name gets its number (HIP, HD,
       TYC, Gaia DR3) from its region's list of numbers, which is downloaded when the first of
       its stars is chosen (`CatalogStar.resolve`); the card wrote the name once, when the
       choice was made (`Hud.renderCard`), so it kept the placeholder while everything that
       reads the name each frame showed the number. The card's title follows the name now; the
       placeholder while the number is on its way is "Star", and "Unnamed star" is kept for a
       star that has none; a failed download is tried again the next time the star is chosen.
       `scripts/interact.mjs` chooses such a star before its number is in (14 checks now).
     - *Titan up close was a grey patchwork with seams and none of its orange haze.* It was meant
       to be drawn in the colour of its measured spectrum (the haze top, Karkoschka 1998; see
       CREDITS) without a map, and `App.create` set `titan.texture = null` for that; but a body
       with no texture takes the map of its own name (`BodiesLayer.textureKey`), and Titan's is
       the Cassini near-infrared mosaic of its ground (grey, in patches from different flybys).
       `Body.noMap` now says "no map" outright. Titan is the even orange it is in visible light,
       its limb hazed by its air shell, as its card's picture always showed it. The mosaic
       (`textures/titan.jpg`, 1.4 MB) is no longer downloaded by the app; the pipeline still
       makes it. `scripts/places.mjs` checks the colour and that no map is bound (16 checks).
     - *A hard seam across the Milky Way's glow during the flight to it* (Search "Milky Way", Go
       there). The glow's cube map was redrawn a face a frame, in the map being shown, each face
       from where the eye was that frame; the app's flight crosses thousands of parsecs a frame,
       so faces from places far apart met along their edges. The map is now drawn into a second
       cube, all six faces from one place, and the two are swapped once it is whole
       (`GalaxyGlow.update`): the map shown is always of one place, at most eleven frames behind
       a fast flight. One more cube of the same size (half floats, 512 px faces: some 17 MB of
       the GPU's memory; 4 MB in a headset). `tests/galaxyglow.test.ts` runs the updates against a
       stand-in renderer and fails on the code of before (a map of two places).
7. **Touch for the rest** (carried over from part 2): free flight (a thumb-stick), landing and
   walking, then flying the ship by hand (boarding, the drive's setting and its autopilot are on
   touch already), missions and the benchmark as screens of the app.
8. **Data streaming** (star tiles, map uploads, elevation, catalogue). Known from a run in
   which the server went away mid-flight: a star tile that fails to download, or arrives truncated,
   throws an uncaught error; whether it is ever retried needs checking.
9. Solar System model and body rendering (`universe/SolarSystem.ts`, `render/Bodies.ts`).
10. App core: `app/App.ts` is 2,400 lines doing exposure, picking, labels, navigation, loading and
   the frame loop; to be split into modules behind the same behaviour (the eye's arithmetic, the
   loading's state, the worked-out facts and the what-if powers are out already: `Exposure.ts`,
   `Loading.ts`, `Worked.ts`, `WhatIf.ts`).
11. Stars and sky (the rest). 12. Deep space (galaxies, nebulae, black holes, exoplanets).
   13. Terrain, landing, walking. 14. Game mode. 15. VR.

To look at when their part comes (seen in the scenario screenshots): Pluto's lit side washes out to
white from 12 radii; the Sun's glare hides the
labels of the inner planets from 2.8 AU. The details card prints masses as "5.9722e+24 kg"; the
headset's travel still flies to distances tuned for its own field of view (`VR.arrivalDistance`)
and its grip-stick orbit now turns round the place the camera is at, not round a far selection.
