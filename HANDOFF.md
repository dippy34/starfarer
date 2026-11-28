# Handoff: where the project stands

Developers' site: https://dippy34.github.io/starfarer/ (GitHub Pages serving the `gh-pages` branch) ·
Deploy: automatic on every push to the live branch, `claude/friendly-hypatia-up418z`
(`.github/workflows/deploy-pages.yml`: `npm run check`, then `dist/` is published to `gh-pages`).
Play testers' site: https://starfarer.pages.dev, changed only at a release, when `main` moves too
("Hosting", below).

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

## Design

The owner, November 2026: "the UI is taking up most of the screen", "way too nerdy: you should be able
to understand what it is if you took 1 year of high school", and the crash screen "looks like AI a
lot". "Make it simple" starts here (Part 0): an identity of its own, written down, proved on two screens.

**The idea: a spacecraft's displays.** Real flight decks (the Space Shuttle's and Orion's glass
cockpits, the station's laptops, a mission-control console) are built to be read in a second by
someone busy and under stress. So they are calm, flat and exact: dark panels, words and numbers in
one bright ink, a small label over each number, a hairline between parts, and colour kept for what it
means. Starfarer borrows that, not the sci-fi version of it. The view of space is the star of the
screen; the interface stands at its edges, as small as it can be, and folds away when not needed.

**What that rules out** (the generic AI look): glassy blurred cards, neon accents and glows, emoji,
everything centred, every corner rounded, gradients for decoration, and big dramatic words
("CRASHED" spaced across the screen). An event says what happened, with its number, and what to do.

**Plain words.** A ninth-grader reads the first layer of everything: km, km/h, °C, "times as wide as
Earth", "your weight there", "light takes 8 minutes to reach you". Never AU, parsecs, kelvin,
magnitudes, albedo or m/s on the first layer. The science stays, every value exactly as measured, one
tap further in ("More science"). Plain numbers are worked from the same data, never rounded into
something else, and keep its "(estimated)" or "(uncertain)".

**The tokens** (`:root` in `src/ui/styles.css`, prefixed `--sf-`; every new or redone screen uses
them, older rules keep their own values until their screen is redone):

| | tokens | why |
|---|---|---|
| colour | `--sf-ink` (values), `--sf-ink-2` (labels), `--sf-ink-3` (units, scale); `--sf-panel` (0.94 opaque, no blur), `--sf-panel-2` (a well or key), `--sf-rule` (hairline) | readable over the Sun's glare and a white crash flash alike; flat, as a display is |
| meaning | `--sf-accent` (can be pressed), `--sf-nominal` green, `--sf-caution` amber, `--sf-warning` red, `--sf-live` orange (what you changed) | one meaning per colour, as on a flight deck's caution and warning panel; red only when something went wrong |
| type | `--sf-font` (the phone's own face: SF on an iPhone; Inter on the test runners), `--sf-mono`; `--sf-t-legend` 11 px capitals spaced 0.08em, `-small` 13, `-body` 15, `-title` 17, `-readout` 22, `-display` 28 | system fonts: nothing to download or license; numbers always `tabular-nums` so they do not jitter; the legend over a number is the instrument's label |
| space | `--sf-s1`..`--sf-s6`: 4, 8, 12, 16, 24, 32 px; `--sf-touch` 44 px | one step; a finger gets 44 px |
| corners | `--sf-r-key` 6 px, `--sf-r-panel` 10 px | squared like a panel of keys; round only for what is round (a planet's picture) |
| elevation | none: `--sf-edge-line`, a hairline | a display is not a floating card |
| motion | `--sf-quick` 120 ms, `--sf-move` 200 ms, `--sf-ease`; off under reduced motion | only to show where a thing came from; nothing blinks |

**Layout.** Left-aligned, read down the left edge. A label above its number. On a phone the bars sit
at the bottom under the thumb; a panel opens upward from its bar. Upright, on its side and at a desk
the same parts in the same order.

**The two screens done (Part 0).**

- *The object card* (`src/ui/Hud.ts` renderCard, styles "the card of what is selected",
  `src/app/plainWords.ts`). Folded by default to a bar of 60 to 75 px: the name, one plain line
  ("Earth's moon · 384,400 km away", "Blue-white star · 8.60 light years away"; on a narrow phone it takes
  a second line rather than lose its end), Go there, close. A tap on
  the name (or its chevron, `[data-details]`) opens the rest above it: Look at and Share, the powers,
  its temperature, a few plain facts (How far, Its light takes, Size, Your weight there, Spins once
  in; for a star Size and Brightness against the Sun and its surface in °C), and More science
  (`[data-science]`): every row and worked line exactly as before. A new selection folds it again.
  Kept as "Go there", not "Fly there": the ship's own button already says "Fly there in your ship",
  and two buttons with one name would be the confusion we are removing. The suites open it with
  `openCard` (`scripts/lib/browser.mjs`); their `press` helpers do so for the card's buttons. The room
  kept for it when framing a subject upright (`CARD_ROOM` in Hud.ts) is still that of the opened card,
  225 px, so that the subject does not jump when the card opens (with 72 px, the folded bar's, the
  checks of live and share that put a finger on a world beside the opened card failed: it was under it).
  Making the framing follow the card as it opens is for the next pass over the view's centre.
- *The end of a flight* (`src/game/FlightHud.ts` setEnd, `endReport` in `src/game/Flight.ts`). An
  event display, as a caution and warning panel: a red edge and legend ("Crashed"), one sentence
  ("You hit the Moon at 355 km/h."), the readouts (Your speed in red, Safe landing "under 43 km/h"),
  a scale from 0 with the safe part green and the speed as a red bar, the one thing to do next, and a
  countdown ("Back in orbit around the Moon in 4 s"). The numbers are the event's speed and the ship's
  `crashSpeed` (12 m/s: 43.2 km/h, said as "under 43"). Burning up, being torn apart and the horizon
  use the same panel in their own words. While it shows, the blinking banner and the (inert) ship
  controls step aside. `ending.title` ("CRASHED" ...) stays as the event's code for the checks and VR.

Checks that hold the design to its promises: touch "the card is a slim bar ..." (at most 9 % of an
upright phone's height and 80 px, upright, on its side and at a desktop size), "one tap on it opens
the rest ...", "More science unfolds every fact as measured"; live "Jupiter's card offers its powers
one tap away"; share "Share is ... one tap on it away"; flight "the crash screen says, in km/h, how
fast the ship hit and how slow a safe landing is, as the physics has them ...".

**Next screens, in order** (Part 2 onwards, each with the tokens, plain words first, science a tap away):
1. the ship's instruments on a phone (the glance panel, the drive chip, the lever, assist and RCS
   chips: today most of the top half of the screen, in m/s, km up and g);
2. the bottom tab bar and the round buttons (Search, Explore, Time, More; "Drag: orbit", "Fly there
   in your ship"): fewer, smaller, one row;
3. the top chips (where you are, the time) and the Time sheet;
4. Explore and Search lists (their lines in the plain words of the card);
5. the warnings and toasts in flight ("IMPACT IN 12 s — SLOW DOWN") and the touchdown message;
6. More (settings, help) and the coach card;
7. live physics: the mark at the top, the powers' panels, the impact card and the watch chip;
8. the title screen and loading screen (`src/ui/start.css`, index.html).

## Hosting: the play testers' site and the developers' site (26 Nov 2026)

Two copies of the app, so that play testers have one that does not change under them (the owner:
"pushing to test branches instead of pushing to main all the time"; "Let's deploy it to cloudflare").

- *Play testers' site:* https://starfarer.pages.dev, on the owner's Cloudflare account (Pages
  project `starfarer`, a classic Pages project with the production branch named `main`: a label
  there, not this repository's `main`). It changes only on a release, which Claude makes with the
  account's login saved in the cloud environment (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
  used only for this): from a commit that is live and whose browser suites passed,
  `npm run check` (types, unit tests, the build), then
  `WRANGLER_SEND_METRICS=false npx --yes wrangler@4 pages deploy dist --project-name starfarer
  --branch main --commit-hash <sha> --commit-message "<what is in it>" --commit-dirty=false`,
  and `rm -rf dist`. Only changed files are uploaded (the first, 13,097 files, took 38 s). Never
  `--force` again: the project exists (wrangler 4.168 sends `pages project create` to Workers unless
  forced, which it was once). The account's other projects are the owner's own: leave them be.
  The release then moves `main` to the released commit, `git push origin <sha>:main`, which is
  always a fast-forward (below).
- *Developers' site:* https://dev.starfarer.pages.dev since 27 Nov 2026 (the owner: "you can host
  it on dev site on cloudflare"; GitHub Pages' 1 GB was near): a preview branch, `dev`, of the same
  Pages project, deployed by Claude after every push to this branch that passed its suites, exactly
  as a release but with `--branch dev` (the owner agreed that every update uses the Cloudflare login,
  not only releases): `npm run check`, then `WRANGLER_SEND_METRICS=false npx --yes wrangler@4 pages
  deploy dist --project-name starfarer --branch dev --commit-hash <sha> --commit-message "<what>"
  --commit-dirty=false`, and `rm -rf dist`. The testers' site (`main`) is not touched by it. The old
  copy, https://dippy34.github.io/starfarer, still follows this branch by itself (`deploy-pages.yml`)
  while it fits GitHub's 1 GB. Both are the newest work; testers are not given them.
- *Play testers' feedback* (the owner, 27 Nov): testers report to the owner directly; no feedback
  button in the app.
- *Branches* (the owner, 27 Nov 2026: "there's another branch that receives all the updates and
  only when approved all the changes go to main"): every update lands on this branch,
  `claude/friendly-hypatia-up418z`, and the developers' site follows it. `main` holds only what
  the owner approved: it moves only on a release ("release" is the owner's approval), to the
  released commit, so `main` is always exactly what the play testers have. Never a commit made on
  `main` itself and never a force push: the branch's history runs through every release. A push
  to `main` builds nothing (`deploy-pages.yml` follows this branch only, so an approved version
  never replaces the newest on the developers' site). Until the first release after 27 Nov, `main`
  still holds only the repository's first commit (the release of 936d146 came before this).

Releases so far: 936d146 (the first play-test version, 26 Nov 2026).

## Progress page

`public/mc-a76557970f/` (the site's `/starfarer/mc-a76557970f/`: linked from nowhere and kept from search engines, so
that play testers see only the app, the owner, 26 Nov 2026) (also on the testers' site, at the same path) is the owner's live view of the work: what is
running (the cheap team's tasks, test runs, deploys), what just finished, what went live, the
TASKS.md board, and pictures of the latest updates. It reads GitHub's public API in the reader's
browser, so it needs no updating. The pictures are on the site: after putting a visible change
live, or reviewing a cheap-team run that has pictures, add them with
`python3 -I scripts/progress-shots.py --kind live|team|tests --title "..." --text "..." --link https://...
--caption "Before" a.png --caption "After" b.png` and commit `public/mc-a76557970f/shots/` (the newest 12
updates are kept, as JPEGs at most 960 px wide, to keep the site under GitHub Pages' 1 GB).

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
  refused aboard. Flying by hand by touch: one finger drags the sky and the ship turns with it
  (`Flight.controls`, `touchRot`: the finger's angular speed as a rate command, up to what the
  wheels do; let go and SAS holds the attitude); a twist rolls, a pinch zooms; a throttle lever at
  the right edge (under the instruments upright, in the corner on its side); **Stop**
  (`Flight.stop`, `Autopilot.brake`): turn round and brake to rest in the nearest world's frame,
  then hold there against its pull, or let go where nothing pulls. Any control takes over.
  Layout: upright the card spans the top and the lever stands under it at the right; on a wide
  view (on its side, a tablet) the card takes the room right of the interface's panels (which are
  a little narrower in the ship) and the lever lies along the foot of that room. Whatever the
  size, `FlightHud.fit` measures and, where something of the ship's would still meet a chip, the
  tab bar or the open panel (the browser's bars can take a quarter of a phone on its side), drops
  the card's lower lines, then the drive row, and upright shortens the lever or hides it. Every
  piece is 90 % opaque and blurs what is behind it (a sky label read through the drive's setting),
  and no name of the sky is placed under any part of the interface over the view (`Hud.covers`,
  the chips, tabs, open card or sheet and whatever is marked `data-cover`, handed to
  `layoutLabels` as `keepOut`). A view switch (Chase / Cockpit) stands with the lever and Stop.
  The steering assist and the side thrusters by touch (the keys Y and A D R F Shift+W/S): two chips
  (`.fl-chips`: *assist*, naming the mode, and *RCS*) stand down the left side upright, from just under
  the instruments, and along the right above the lever on its side. The assist chip opens a list of
  the ten modes (`Flight.setSas`: choosing one is the pilot's hand, so the autopilot lets go; the two
  target modes need a selection and say so); the RCS chip opens a pad of six buttons (left, up, right,
  back, down, forward) held to thrust (`Flight.touchRcs`: 6 kN on 40 t, 0.15 m/s²), shown only while
  flying by hand (the autopilot or Stop at the controls puts it away and the chip says Auto).
  `FlightHud.fit` counts them: where the pad would meet the instruments they give up lines, and with
  the list or the pad open on a short screen they step aside (`fl-tightest`); every piece is
  `data-cover`, so `Hud.clearPart` and the labels count them (flight.mjs 18 and 18b: ten phone sizes
  in three states, a clear part of 112 x 96 left for the target's brackets).
- *Not done*: the view at speed (aberration, Doppler, the headlight effect): drawn as at rest; a
  precise specification is in the notes (the star shaders were other agents' work in progress).
  With the live N-body physics coming, the notes list what the ship reads live and what assumes
  two-body orbits (the prediction line, the rails).
- Tests: `tests/relativity.test.ts`, `tests/autopilot.test.ts`, `tests/flight.test.ts`;
  `scripts/flight.mjs` (34 checks), `scripts/game.mjs` (21).

- **Free flight by touch** (`src/app/FreeFly.ts`): the explorer's own flight, the keys W A S D R F with
  Shift for ten times, without a keyboard. More has a **Fly freely** switch (touch only); while it is
  on, a stick stands under the left thumb (over the tab bar upright, beside the tabs on its side), Up
  and Down and Done under the right, and one finger dragged on the view looks around (it sets the
  "one finger looks around" drag, and puts back what it was). The stick feeds `CameraRig.ext.move`
  (the headset's input too): a direction in the camera's axes up to length 1, which the rig smooths
  and scales by the height above the nearest surface (0.8 of it a second at full push, as W does);
  pushed to the rim it is ×10 (Shift), and the middle 8 % is dead. Tap, double-tap, pinch, two-finger
  look and twist are as they were; the card and the round buttons stand aside while it is on (the
  controls own the foot of the screen) and a sheet (Search, Explore, Time, More) puts the stick away
  while it is open. Not in the ship nor on foot: starting either puts it away, and the switch is
  refused there. Checks: `scripts/touch.mjs` section 15 (the switch; the stick forward, left, back; Up
  and Down; ×10 at the rim; speed in proportion to the height; one finger looks, standing still; tap,
  pinch and double-tap; a sheet; the ship; Done) upright and on its side, and the controls on the ten
  phone sizes.

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
  the bodies to the ephemeris again at the moment the first change was made, with the rate of time
  it had then (until god mode's part 1, below: at the date reached, if the ephemeris covers it).
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

## The ship's looks (an art pass)

The owner, with a screenshot from an iPhone held sideways in orbit of the Earth: "The spaceship
looks horrible." What it showed: the cockpit was greybox (flat grey slabs for the windscreen's
pillars and a beam across the top, a grey desk with three tilted screens, coloured hexagons for
lamps), eating a third of the view; the names of stars stood on the beam ("Pollux", "Elnath"); the
orbit's "Ap" marker was large over the Earth and the target's brackets large round the target. The
chase view's ship was primitives: grey cylinders with flat white caps, thin wings edged in orange.
(The orbit lines were in fact hidden by the frame, on the phone as here: what crossed it were the
overlays drawn with no depth test, the names, the tags and the brackets.)

- *The ship* (`src/game/shipDesign.ts`, built by `shipGeometry.ts`, painted by `stencil.ts`): an
  original surveyor of the near future, 17.4 m long, 15.7 across its radiators, nose to -z. A crew
  cabin shaped as a lifting body (it lands on worlds): white plates with their seams, a dark tiled
  heat shield underneath, a wraparound canopy of dark glass (glossy: what it mirrors is its look)
  with two pillars and a bow, its name on the flanks; a waist with the reactionless drive's emitter
  band; two radiators swept back like wings (a fusion torch must reject its heat), a dark coat
  framed by light-painted booms and joints (whatever light they catch, the star's or a world's,
  draws their outline against black space), its registration on them, the navigation lights on their
  tips (red to port, green to starboard), a strobe on the engine and a red beacon underneath; the
  fusion torch: the reactor's housing in a band of gold foil and a bell of brushed metal held by two
  field coils, dark inside, the throat glowing deep in it. 12,231 triangles in one draw call, the
  lamps' halos in one, the plume in one (the shadow map one more). Traffic ships wear the same model
  in their own paint, without the markings or the shadow map, culled when out of view. Made up: the
  name STARFARER and the registration SF-07; no agency's marks, no film's ship.
- *The drive shows* (`ShipModel.setDrive`, fed by `ShipArt` from `Flight`): the torch, a plume (a
  bright core leaving the bell, fading within metres: a fusion exhaust is all but invisible), the
  radiators glowing a dull red from their roots while it burns (they take seconds to heat and longer
  to cool), the bell's inside orange with its heat after a burn; the reactionless drive, no exhaust
  (it has none to show), its band glowing a pale blue with a slow shimmer.
- *Materials and light* (`shipShader.ts`, `ShipLight.ts`): physically based (GGX, Smith, Schlick),
  every vertex carrying its finish (base colour, roughness, metalness, a pattern drawn in metres
  along the surface: painted plates with seams, brushed metal, tiles, the radiators' heat pipes,
  foil, dark anodising, lamps), one tileable noise texture built from typed arrays. Lit by the star
  the app lights everything with (display-referred as before: a white plate square to the Sun at 1
  AU is shown at `KEY`, 1.4; half that by Saturn), dimmed by the share of its disc a world covers
  (in the Earth's shadow the ship is dark but for its own lamps), and by the world nearby: its
  sunlit face lights the side turned to it by its albedo and phase, in its colour (Earthshine,
  Saturn's warm light), and is mirrored in what shines. No ambient term. The lamps light the hull
  round them; the ship casts shadows on itself from the star (`shipShadow.ts`: a 1024 x 1024 map of
  the hull seen from the star, redrawn each frame of the chase view, kept by MIN blending so it is
  the same in either depth mode; four taps).
- *The cockpit* (`Cockpit.ts`): a slim frame round a large canopy, dark (a dielectric black whose
  rounded edges catch the star: backlit it is a dark rod with a bright rim), placed so that space
  fills the view (`cockpitDesign.ts`): the windscreen's pillars 55 degrees out all the way up (a
  phone held sideways sees them at its edges, an upright one and a desk's wide view not at all), the
  bow 28 degrees up (an upright phone sees it as a thin line just under its instruments; one held
  sideways along its top), the spine starting high overhead, the sill 34 degrees down. On a touch
  screen the dashboard is only its top, low in the view (the numbers are the interface's card); at a
  desk and in a headset a console under the windscreen carries the three live screens (bezelled,
  restyled as dark glass), a thin light line under its lip and a few lamps. The glass shows only
  what glass shows: a sharp glint of the star where it mirrors it, a faint sheen, and, looking
  towards the star, the dust and smudges it lights and a soft haze.
- *No clutter.* What covers the view (the frame's members and the dashboard in the cockpit, the ship
  in the chase view) is a mask of shapes on the screen (`render/ViewMask.ts`, set each frame by
  `ShipArt`): a name whose object is behind it goes, and a name whose text would lie across it moves
  to the other side of its point or goes (`layoutLabels`, its `mask` argument). The head-up brackets
  (`HudMarkers.ts`) and the orbit's tags (`FlightViz.ts`) are depth-tested and set beyond the frame
  and the ship (4 m and 300 m out), so the frame and the ship hide them as they hide the sky; and
  they are sized in CSS pixels: brackets 34 px square (96 px with the distance under them), a tag
  104 px wide with its name about 11 px high. The tags were sized in the frame's own pixels (150 of
  them), so when the quality governor drew the frame at a lower resolution they grew: on the owner's
  phone the "Ap" was about 13 CSS px high where it was meant to be 6.
- *The chase view* (`ShipModel.frameChase`): the camera looks down on the ship by about 20 degrees
  (the view's own slant and the ship's nose 12 degrees up from it), so the radiators' tops, the
  registration and the canopy show; upright the ship is centred under the middle, its radiators
  about 70 % of the width, clear of the instruments above and the card below; sideways a third of
  the width and to the right of the middle, over the shoulder (the selection card covers the middle
  of a sideways phone, and the middle stays clear for what is ahead). Turning, the ship leads the
  camera a little and banks into the turn (`ShipArt`: the rig's turn rate, smoothed).
- *On a phone the ship opens in the chase view* (`App.act('ship')`; a desk still opens the cockpit,
  V switches): it is what this pass is for (the ship, its lamps, which drive is on, the plume) and
  shows only from outside, and a phone's cockpit view is nearly all open space anyway: the
  interface's card carries the instruments, and upright the frame is a line under them. A touch
  button to switch between the two views is the phone-flying work's (Hud/FlightHud).
- Checks: `tests/shipart.test.ts` (8: the geometry's winding and soundness, the triangle budget, the
  frame's share of a phone's view, the mask, names in the ship, the light's arithmetic, the chase
  framing); `scripts/ship.mjs` (25 checks, upright and sideways on a phone: the frame slim, no name
  over the frame or the ship and a name turned behind the frame hidden, the markers' sizes in CSS px
  also at a lower resolution, overlays never drawn over the frame or the ship (to the pixel, measured
  without the bloom, whose glow falls over everything), the ship on the screen and not under the
  interface, lit, the drives, draw calls and triangles).
- Frame time on the owner's screen (390 x 844 CSS px at 3, software WebGL here; the scene, the
  best of seven renders, the two builds in turn, in orbit of Earth and of Saturn). This machine's
  load moved the same "ship off" view by up to 13 % between the builds' turns, so the comparison
  is coarse: the chase view the same within that (Earth upright 881 -> 878 ms, sideways 794 ->
  871); the cockpit view 10 to 30 % more (Earth upright 798 -> 936 ms), as the old cockpit hid a
  third of the view and the new one shows it. Drawn with and without in one page (where the load
  cancels), the new frame and dashboard cost 6 % of the scene (53 ms of 900) and the glass nothing
  to speak of: it spans the whole view, so its shader works only where it shows something (its
  mirror images of the star and of the world, and round the star); worked out everywhere it took
  a fifth of the cockpit's drawing time. Draw calls fell (cockpit view 172 -> 154, chase 158 ->
  142); triangles rose by 6,000 in the cockpit view and 11,500 in the chase view.
- Seen and left: the stations (`Station.ts`) keep the old flat `litMaterial`; next to the ship they
  now look plainer than it. In a headset the names are 3D sprites the frame does not mask (the mask
  is for the names laid over a screen). Whether a radiator reads in shade depends on what lights it:
  its light-painted edges and the world's light show its outline, but a panel turned from every
  light is dark, as it would be. The cockpit's screens are the desk's and the headset's only; a
  phone has the interface's card, and its view switch (chase and cockpit) is the phone-flying
  work's.

## Live physics round other stars (exolive worker, live 26 Nov 2026)

Step 4's first part of the works-everywhere plan (`docs/notes/works-everywhere.md`): Mass, Move,
Throw, Remove, Watch, Replay, Undo and Back to reality work in another star's planetary system,
real (the NASA Exoplanet Archive's) or generated, one system at a time. Size works on a planet
measured in transit; Add stays round the Sun, with its reason.

- *How.* `src/universe/PlanetarySim.ts` turns one `PlanetarySystem` into the bodies the existing
  live physics runs (`SimSystem`): its star and planets, each a `SimBody` standing for what the
  app draws (`shows`). Live physics starts from the rails the app draws, places and velocities to
  the bit, in the frame where the system's centre of mass is at rest; positions are metres from
  the star's catalogue place (`origin`). `App.physics` is the live physics in use: the Solar
  System's (`App.solar`) or the one other system's (`App.exoSim`). A system has the turn while it
  is live, or while the Undo of its Back to reality is still offered (`App.holds`): selecting a
  world of another system then shows its powers off, with the reason, and throws nothing away.
- *Masses are the data's only.* A planet's is the archive's (marked "(estimated)" where the
  archive estimated it); a star's is the archive's, else Kepler's third law from a planet whose
  orbit's size and period were both measured ("(from its planets)"); a generated system's says so.
  Where none is known (5 systems), or a measured orbit disagrees with the star's mass by more than
  a fifth less or a quarter more (291 of 4,743, Kepler-186 among them: `hostMassOf`, `disagree`),
  the system's powers are off with a plain reason: live physics from such numbers would fling a
  planet off the orbit drawn.
- *Not yet.* Links and saves of a changed system of another star (Share and Save say the changes
  are not in them); Add round other stars (the zone constants are scaled for small stars in
  `WhatIf.ts`, unused so far); binaries; black holes. The archive's masses of planets found by
  radial velocity are minimum masses (M sin i) and are shown unmarked: the pipeline does not carry
  `pl_bmassprov` yet.
- *Checks.* `tests/exolive.test.ts` (capture to the bit, energy, Undo and Back to reality exact,
  the star's mass), `tests/powersFor.test.ts`, `scripts/live.mjs` block `exo` (TRAPPIST-1 e on a
  phone and a desk), `scripts/everywhere.mjs` (TRAPPIST-1, Proxima Cen b, 51 Peg b, Gl 9848 b).
  The full browser run before it went live: 45759682654.

## God mode, wave 1 (godmode worker)

The owner, after the powers went live: "Genuinely god mode and ship suck rn". The research behind
this wave (what SpaceEngine lets you change, and what Starfarer should build; read before wave 2)
found that live physics already does what SpaceEngine cannot (everything pulls, things collide,
Back to reality undoes it), and that it feels flat because nothing shows the consequences: they
take months of simulated time, time stays at whatever rate it was, the camera stays put. Wave 1
ships in four parts, each live before the next: (1) watch it happen, with Replay, and Undo; (2)
throw, and add by placing and throwing; (3) impacts you can see, and the future drawn; (4) live
temperature, and size as well as mass.

### Part 1: watch it happen, Replay, Undo (done)

- *Watch it happen* (`src/app/Watch.ts`, the arithmetic in `src/app/Powers.ts`). When a change
  ends (the finger lifts off the mass slider or off a dragged world, Add or Remove is tapped, Keeps
  its speed / Goes in a circle is chosen), time stays as the explorer had it, and the chip where the
  flight's chip goes offers the watch: "See what it does" with Watch (the owner, 27 Nov 2026: a
  change "speeds everything up, and then ends after a random amount of time"; task/watch-button).
  Watch goes back to the moment just after the change and runs time at a pace at which what follows
  can be seen, the camera easing to a frame that holds the worlds the change matters to; the chip
  says "Watching: 26.3 minutes a second" with Stop. It has no end of its own: Stop, Escape, another
  change or the rate of time taken in hand end it; then "Watched: 6.4 hours" with Replay (offered
  for 30 s). Stop puts the explorer's rate of time back as it was (stopped, if it was); a finger on
  the view (or the wheel) takes the camera back at once and time keeps the watch's pace; any of
  Faster, Slower, Pause, Reverse, Now during a watch makes the watch's pace the explorer's (its step
  the one at or below it) and goes on from there. A switch in More ("Show me what happens", off to
  begin with) starts the watch by itself after each change, remembered on the device through
  `src/platform/storage.ts` (the first module of `src/platform`: the browser's storage is reached
  from there in new code). Time slows near a hit only while a watch runs or that switch is on.
  - *Which worlds a change matters to* (`Powers.affected`): those whose acceleration it changes by a
    hundredth or more, weighed at one moment (a mass changed by Δm pulls GΔm/r² harder; a world taken
    away no longer pulls; one made pulls; one moved pulls from its new place, it and what goes round it
    weighed where they were and where they are). Decision (the code over the research): only the
    worlds heavy enough to matter to what is seen count (`LivePhysics.weighty`: stars, planets,
    dwarf planets, moons from Mimas up, what was made). Counting every simulated body, Metis (35
    minutes round a Jupiter twenty times heavier) set a pace at which nothing else moved.
  - *The pace* (`Powers.watchRate`, `watchPlan`): the quickest period among those worlds goes round
    once in 8 seconds (the Moon's month: 3.4 days a second), no slower than a minute a second, no
    faster than 10 years a second on a touch screen (a phone's stepping has not been measured) or 100
    at a desk; if the stepping falls behind (less than 3/4 of the time asked for, 12 frames running)
    the watch goes 0.6 times as fast (not half: live physics takes a change of the rate by two as a
    new rate). A world's period is its orbit about the frame's centre where it is bound to it, else
    the orbit it is on about what it goes round, else the one it had before the change (a moon thrown
    off keeps the pace of its month).
  - *The frame* (`watchPlan`, `frameRadius`, `viewFrame`, `frameDistance`): 1.5 times as far as the
    farthest of the worlds whose period is at most 20 times the quickest, each as far as the far end
    of its orbit about the centre, or, on an open path, where it is plus how far it goes in the watch.
    Decision (found by the tests): a world bound to something other than the centre sets the pace
    but is not what the frame is fitted to (when the Sun is taken away Iapetus, 79 days round Saturn,
    made a frame of 14 AU round where the Sun was; now 2.8 AU, the inner planets leaving). The centre:
    the world made heavier or lighter, the one something was added to, what holds sway where a world
    was put, and where a world taken away would have gone on to (a point: nothing to turn round, the
    camera's target is let go). The distance is the radius over the tangent of the smaller half-angle
    of the part of the view the interface leaves clear (`Hud.freeArea`: below the chips and the mark,
    above the card and the tab bar, or right of the panel on a wide screen), and the camera turns so
    the centre stands in the middle of that part (`Glide`: in the logarithm of the distance along the
    line it was on, over 1.2 to 3 seconds; a horizontal aim the rest of the app does not have yet). The
    card's open Mass, Add or Details panel folds away when it would leave less than 40 % of an upright
    view's height, or would not fit beside a wide one with the chip above it (a phone on its side, where
    the slider's panel was already cut off at the foot of the screen) (`Hud.makeRoom`; one tap opens it
    again; Move keeps its panel). On a phone, upright or on its side, the mark of live physics drops its
    sign so that its words, Undo and Back to reality fit on one line.
    Nothing is to be seen going round after Ceres is taken away, or the Moon: no watch then.
  - *Replay* restores the moment just after the change (a checkpoint, below) and watches again. It
    is the same event to the last bit when the stepping keeps up (`tests/livephysics.test.ts`); on a
    machine falling behind, live physics carries more on rails as the frame's work allows, and a
    replay can differ from the first run by what that changes (metres).
- *Undo, many steps* (`src/app/History.ts`; `LivePhysics.checkpoint`/`restore`). Undo at the top
  beside Back to reality, and in the Time sheet; Ctrl+Z at a desk. Each tap goes back to just
  before the last change, the date and the rate of time included, and says what it undid ("Undone:
  changing Jupiter's mass"); twenty steps, no redo; the first change undone is the real Solar System
  again, at the date before it (the present, if the clock was following it). One checkpoint per
  gesture, never per frame (`Gesture`: from the finger down to the finger up; arrow keys with less
  than 600 ms between them are one change). A checkpoint is the simulation itself (`NBody.snapshot`),
  what its bodies stand for (`Live.carried`, copied: `release` changes it in place), every body's
  mass, size, family and presence (`SolarSystem.familyOf`/`restoreFamilies`), the catalogue values
  of what was changed, what was made, the log, and how the stepping was keeping up (so that what is
  on rails is chosen as before). What was made now belongs to `LivePhysics.made` (App.made reads it):
  a restore takes out what was made since (the scene is told: `LiveScene.dropped`) and brings back
  what was made before and taken out since (`SolarSystem.bringBack`, in its place at the end of the
  list). Tested to the last bit after a mass change, a move, an Add, a Remove (the Sun) and a
  collision (Mars and the two small moons that rode on it come back); two changes and two undos are
  a system never touched, the same as the return to reality.
- *Back to reality, by mistake* (a tester meant to tap Faster in the Time sheet and hit Back to
  reality: the sheet grew when live physics came on, and the buttons moved up under the finger).
  The Time sheet's buttons of time are now its last row, where they always are, live physics or
  not; what live physics shows sits above them, with Undo and Back to reality at its top (they end
  more than 60 px above the buttons of time). And Back to reality is a change like the others: for
  20 seconds the mark at the top says "Back to reality · the real Solar System again" with Undo,
  which brings the changed world back as it was; then what it undid is let go.
- *The Time sheet, simpler* (27 Nov 2026, the fix list's #4; the cheap team's task/time-panel, on
  Claude Sonnet, reviewed here): its row of time keeps four buttons (Reverse, Slower, Pause, Faster);
  "Now" left it. The one way back is the big "Back to now" (`.time-today`, the act `now`:
  `App.realTime`), shown whenever the clock is not at the present moment at real time (a day or more
  away, any other rate, backwards, or paused), never in live physics. The line under the clock says
  the speed in words (`clockSpeedWords` in `Powers.ts`: "Real time", "1 minute a second", "2 days a
  second, backwards"); the top chip is as it was.
- *Back to reality and the date* (decided): it returns to the moment the first change was made, the
  date and the rate of time with it (stopped if it was; following the present again if it was:
  "Back to reality, and to the present"). Before, it kept the date the simulation had reached (or
  went to the start where the ephemeris did not reach) and the rate as it was. Everything after the
  first change belongs to the changed world, the time the watches ran on included; and a rate only
  live physics offers (a thousand years a second) would carry the real planets past the end of the
  ephemeris within a second.
- Checked (headless Chromium, software WebGL, against production builds served by `vite preview`,
  on a machine shared with other agents' suites): the type check; the unit tests (new:
  `tests/history.test.ts`, `tests/watch.test.ts`, the watch's arithmetic in `tests/powers.test.ts`,
  and in `tests/livephysics.test.ts` the checkpoints restored to the last bit, two undos equal to a
  system never touched, Back to reality undone, a replay that goes the same way twice; the speed
  measurements failed once with three suites running beside them and passed run alone); `live`
  (the first block new: the watch, its frame upright, sideways and at a desk, Stop, the end,
  Replay, a finger taking the camera back, Undo a step at a time, Back to reality undone and its
  date, the Time sheet's buttons standing still, the switch in More; the other blocks run with the
  switch off, as they time a power's physics by the clock), `whatif` (likewise off), `game`,
  `touch`, `interact`, `flight`: see the commit for the counts. The new checks were run against
  the build before this part: they fail (no chip, no frame, no Replay; and there, with live
  physics on, the Time sheet's Faster stood 253 px higher, and Back to reality left the date
  three days on). `LIVE_ONLY=watch` runs the new block alone.
- Not done here: a watch in the headset (the rate changes there, the camera does not move); the
  camera does not follow the place a world taken away would have gone (it is a point the eye is
  turned to, and the camera then rides with whatever it is near); Replay after a watch under heavy
  load can differ from the first run by metres (above); undoing a change does not undo the camera.

### Part 2: throw, and add by placing and throwing (done)

- *Throw* (`src/app/Mover.ts`; the arithmetic in `src/app/Powers.ts`, pure and tested). Move has a
  third choice beside Keeps its speed and Goes in a circle: Throw. The world stays where it is and
  the finger draws the throw.
  - The slingshot: pulled back from the world, an arrow points the other way from it
    (`Hud.setAim`, an SVG over the view), 110 px for each speed of a circle (`AIM_PER_CIRCLE`), marked
    "circle" at 110 px and "escape" at 156 px, the one the throw is exactly lit. The world is given
    the throw at once, time waiting, so the orbit line and the card ("Now round Earth: nearly a circle
    (0), ...", "Now on an open path past Earth: it passes at 369,335 km, then leaves.") show where
    it will go before it is let go; let go, it goes. Brought back within 16 px of where the finger
    took hold, or taken away by the browser (`pointercancel`), nothing was thrown: `App.cancelChange`
    puts back the state before the gesture exactly, and nothing is kept for Undo.
  - The flick: a finger that set off no more than 300 ms before it lifted, going at 250 px a second
    or more as it lifted (measured over its last 90 ms, from the event times: `fingerVelocity`), throws
    the world the way it went, as fast as it went: 1,200 px a second is the speed of a circle
    (`FLICK_PER_CIRCLE`), 1,700 escape, three speeds of a circle at most. Decision: one gesture does
    both, told apart by time (`flickOf`): a pull that has gone on longer than 300 ms is an aim,
    however fast the finger lifts (a slingshot let go while still pulling goes the way its arrow
    pointed; a check covers it), a quick one is a flick. A slingshot snapped back and let go within
    0.3 s is taken for a flick and goes the other way, slowly (Undo).
  - Speeds are in speeds of a circle about what holds sway where the world is (`LivePhysics.swayAt`):
    f √(μ/r). Snapped to exactly 1 and √2 within 3 % (`snapThrow`); and the way snapped square to the
    line from what holds sway within 3° (`squareThrow`; decided: without it the circle mark could not
    make a circle, a finger cannot hold a degree). In the plane the world is dragged in (`dragPlane`,
    fixed for the gesture). Exactly the speed of escape is open (`orbitOf` takes an energy within
    10⁻¹² of μ/r of nothing as open; rounding put it on either side).
  - A throw is a change like the others (one per gesture, "Undone: throwing the Moon") and watched.
    The world moved is now always among the worlds a change is watched for (`planChange`): thrown from
    where it is, its pull and the pull on it are as they were, so `affected` found nothing to watch.
  - The flick's numbers are reasoned (a quick flick on a phone is 1,500 to 3,000 px a second), not
    tried by a hand on an iPhone: `FLICK_PER_CIRCLE`, `FLICK_SLOWEST`, `FLICK_LONGEST` are the knobs.
    The browser checks give their events explicit times 16 ms apart (fingers and, new, the mouse:
    `mouseHand` in `scripts/live.mjs`), so a flick is as fast whatever the machine's speed; a
    synthetic finger lifts where its last move was, which the window counts as a short rest.
- *Add, by placing and throwing* (`App.add`, `Mover.place`, `App.placed`, `App.setMadeMass`). Add
  makes the world where it did (between you and what it is given to), selects it, and leaves it to
  be put in place: time waits, Move is on, and the card has its mass, Done and its mass slider, and
  says "Drag it to where you want it: let go and it goes round in a circle there, or flick it to
  throw it. Time waits until Done." A drag puts it where the finger goes, on a circle there; let go
  while still going (250 px a second or more over the last 90 ms; no 300 ms limit here: a drag ends
  in the flick) it is thrown the way the finger went, and a new mass then leaves it thrown. Done ends
  its making, watched. Anything else that ends it (another world chosen, another panel opened,
  Escape, Undo, Back to reality) ends it unwatched; time then runs as it did before the Add, unless
  the explorer set it meanwhile. Making, placing and mass are one change ("Undone: making Earth 2").
  Where the new world is not in the part of the view the interface leaves clear (upright on a phone
  it often starts under the card), the camera eases out to frame what it was given to and its orbit
  (`App.frameOn`, the watch's framing; otherwise it stays). In the ship, walking or in the headset it
  is left where it starts, as before.
- *What is made: its mass, and the size that follows* (`src/app/WhatIf.ts`: `MADE_MASS`, `madeSize`,
  `madeWords`, `madeWorking`). The slider runs in the logarithm, per kind, from a small moon to two
  suns across the four: a moon 10⁻⁶ to 10 Moons; like the Earth 0.05 to 10 Earths; like Jupiter
  10 Earths to 0.08 Suns; a sun 0.08 to 2 Suns; it snaps to the mass Add made within 0.03 powers of
  ten. The size follows from the mass by the rule for what it is (the research's rules; one bridge
  decided here):
  - a moon: a ball of rock (3,000 kg/m³), or of ice and rock (1,500) beyond the frost line, as before;
  - like the Earth: rock at the Earth's mean density (5,514 kg/m³, NASA's fact sheet), R = R⊕ (M /
    M⊕)^⅓: 5 Earths are 1.71 R⊕;
  - like Jupiter, from 0.3 Jupiters and as a brown dwarf from 13: about Jupiter's size (its
    volumetric mean, 69,911 km: `R_JUPITER`, equal to the mean of the catalogue's radii);
  - between 10 Earths and 0.3 Jupiters, where a world's size depends on how much gas it has gathered:
    decided, the straight line in the logarithm between the two rules (from the rock of 10 Earths,
    2.15 R⊕, to Jupiter's size), said so in its working (Neptune's 17 Earths come out 3.2 R⊕; it
    measures 3.9);
  - a sun: a star of the main sequence (`mainSequence`): its radius, temperature (its colour, drawn
    afresh) and light. Its absolute magnitude is the Sun's moved by its light: light of every colour
    is counted as visible, so a red dwarf (0.08 Suns: 0.13 R☉, 2,570 K, 7·10⁻⁴ of the Sun's light) is
    drawn brighter than it would look; said in the code. Part 4's heat uses the light itself.
  The original's mass gives the original's size; a copy keeps the shape and face of what it copies,
  scaled. Its details say how its size was worked out (`Worked`: "Its size (made by you)", the
  formula, the numbers, the rule). Afterwards the Mass power changes a made world's pull only, as
  any world's (its "real mass" is the one it was made with); Part 4 brings Size.
  `LivePhysics.resize` gives a made world its new mass and size in the simulation (collisions use it).
- *Make anything, step 1: worlds of every kind, each with a look of its own* (27 Nov 2026; the fix
  list's #21, built by the cheap team on Claude Sonnet, reviewed here). A star's Add offers, after
  the four, seven made worlds (`WORLD_KINDS` in `src/app/WhatIf.ts`: a rocky, ocean, desert, lava or
  icy world, a gas giant, an ice giant), with no original and no map: each is drawn with the look the
  made-up planets of other stars have, varied by a seed. That look now lives in one place,
  `src/render/PlanetLook.ts` (`paletteFor`, `generatedLook`, `lookUniforms`, moved out of
  ExoPlanetLayer.ts, which draws exactly as before; `madeLook` is a made world's: a fixed typical
  temperature per kind, `MADE_TEMPERATURE`, so a type and seed always look the same). `BodiesLayer`
  draws a body whose `madeAs` has a `seed` with that material (`generated-look`, no landing
  terrain). The seed is kept in `madeAs.seed`; "New look", under the mass slider while it is put in
  place, picks another. A link or save keeps it (`SceneWorld.ts`: the seven kinds appended to
  `KINDS`, the seed a number after the "icy" byte; old links read as before); the simulation does not
  carry it, so `App.sceneView` puts it on the records from the bodies before writing. Sizes: the
  rocky four and the ice giant follow a published mass-radius relation (Chen & Kipping 2017, ApJ 834,
  17: R ∝ M^0.279 for rocky worlds, M^0.589 above 2.04 Earths; `TERRAN_SLOPE`, `NEPTUNIAN_SLOPE` in
  WhatIf.ts), taken through the Earth's own size (their constant, 1.008 ± 0.046 R⊕, has it within):
  Mars and Venus within 2 %, Uranus within 3 %, Neptune within 11 %. Decided: a copy of the Earth
  keeps the Earth's density, as a copy; the gas giant keeps Jupiter's size (the relation's giants
  are hot, puffed-up ones: Jupiter's mass would come out 1.25 Jupiters); the icy world stays a ball
  of ice and rock (the relation has no such class). docs/notes/ideas.md, "Sizes of made worlds". The card's small picture is still the generic one.
  *Rings* (added the same night, by Claude): "Add rings" beside New look gives any of them a ring, and
  "Remove rings" takes it away. It is the ring of the made-up planets of other stars (its shader,
  `ringMaterial` and `lightRing`, moved with the look into `PlanetLook.ts`; ExoPlanetLayer draws as
  before): from 1.15 to 3 radii, its ringlets from the look's own numbers (so the rest of the look is
  the same with it or without), icy when the kind's temperature is below 150 K, dark and dusty
  otherwise. `BodiesLayer` keeps it in `lookedRings`, in the world's equator plane (its
  `orientation`'s XY plane, as Saturn's), lit and shadowed by the planet, and `ringOuter` counts it
  (the night-side exposure). It is `madeAs.rings`; a link or save keeps it in the byte that says
  "icy" (2: with rings; a world of a generated look is never an icy moon, so 0 or 2, and anything
  else is refused).
  *Colour* (the same night): a Colour slider under them turns all the look's colours round the colour
  wheel (`turnHue` in `PlanetLook.ts`: a rotation about the grey axis, so greys stay grey and the sum
  of red, green and blue is kept; `LookSpec.hue`, a share of a turn; the rest of the look, its albedo
  for the eye included, is unchanged). While it moves, `BodiesLayer.recolour` sets the material's
  colours in place (a new material at every step would be built again). It is `madeAs.hue`, kept in
  256 steps (`HUE_STEPS`): 4 in that same byte, and the step a byte after the seed (none when 0).
  *A name of your own* (the same night; the cheap team's task/name-it on Claude Sonnet, reviewed here):
  while any made world is put in place, a Name field (16 px text, so an iPhone does not zoom in on
  it) gives it a name, taken when the field is left or Enter pressed (`App.renameMade`,
  `SceneWorld.takeName`): trimmed, plain (`plainName`) and no other thing's name in any letter case
  (`findByName` finds nothing else by it), else a line under the field says why and the name stays.
  So no made world can take a catalogue name ("Saturn" would have met the code that finds Saturn's
  rings by name). `Body.name` is now writable for this (`Body.rename`); no catalogue body is renamed.
  Keys typed in the field stop there (Space is not "pause"). A save or a link keeps it as
  `MadeRecord.name`; the first log line keeps the name it was made with.
  *A picture of it while it is made* (27 Nov 2026, evening; the owner's word that the card covered
  half the screen): framed with its orbit, a new world is a dot, so the card shows it beside New look,
  rings and Colour, 128 x 96 CSS px (`PORTRAIT_CSS` in `Hud.ts`). `src/render/PlanetPortrait.ts`
  draws it with the very shaders of its look (`BODY_VERT`, `EXO_FRAG`, and the ring's) in a studio of
  its own: 12 radii away, its pole leant 0.45 rad towards the eye, lit from the upper left a little
  from in front, framed to its ringlets' outer edge (`uRingOut`), at the exposure the eye settles on
  when a world fills the view (0.45 over the radiance of its lit ground) and tone-mapped as the
  composite does (`spTone`, then sRGB), with an alpha of its cover. Into its own targets (a half-float
  one with 4 samples, then 8-bit), read back, and drawn into the card's canvas by `Hud.showPortrait`
  (rows bottom first). Only when its look changes (`App.portraitOf`: its type, seed, rings, colour
  and the picture's size in device pixels, three to a CSS pixel at the most), never as its mass
  slides; its targets are let go at Done. Its materials are made and let go each time: the program
  is the one the world in space already compiled. While a world is made the card also hides Look at
  and Share (class `making`), and the hint is one sentence shorter: the card's whole panel is in sight
  without scrolling on an iPhone (it scrolled by 56 px before), and the camera eases out less far.
- *The chips at the top in plain words* (27 Nov 2026, evening; the fix list's #4, "make it simple"):
  the place chip says how far in kilometres, millions or billions of them, then light years
  (`plainDistance`, never AU), and how fast the camera moves in km/h, km/s or against light's speed
  (`plainSpeedWords`; in the ship its own `plainSpeed`). The clock says how fast time runs in the Time
  sheet's words, short ("3 hours a second", "◀ 2 days a second": `clockChipWords` through
  `App.rateText`, which the ship's and the headset's panels and the live mark's "only ..." use too).
- *The live-physics lines in plain words* (28 Nov 2026; the cheap team's task/plain-physics on Claude
  Sonnet, reviewed here): the Move panel, the details' "Its orbit", the toasts of Add and of a near pass
  say distances as the chips do (`farWords` is `plainDistance` now: never AU) and a period in words
  (`periodWords`: hours under two days, days under two years, then years; "once round in 486 days",
  not "· 486 d"). `addedWords` is the toast of Add. The science rows keep their units.
- *Create, in the tab bar* (27 Nov 2026, evening; the sandbox's "one Create button from anywhere"):
  a fifth tab between Explore and Time (`data-tab="create"`, the Add icon). It is no sheet of its own:
  `App.create` chooses what can take something new, the world the camera is at or the first of the
  worlds it goes round that can (a planet takes a moon, a star worlds of every kind and a second sun),
  anywhere else the Sun, selects it, and `Hud.openAdd` opens its card at Add once the card is of it
  (or, where nothing can be added now, with the reason). Browser checks: `LIVE_ONLY=create` of
  `scripts/live.mjs` (at the Moon: the Earth's Add; at the Sun; at Sirius: the Sun's). On a phone on
  its side with little height (the flight suite's 844 x 280 with bars), five tabs a thumb high do not
  fit the column beside the card: `Hud.fitTabs` hides Create there (measured when the view's size
  changes; each card keeps its Add).
- *God mode on a comet, step 1: take it away* (27 Nov 2026, evening; the cheap team's task/comet-powers
  on Claude Sonnet, reviewed here): a comet's card offers Remove (Mass, Size, Move and Add off, each
  with a reason: `comet` in `powersFor.ts`). `App.removeComet` starts live physics as any change does
  (the change is made on the Sun, which does not change, so no watch is planned) and puts the comet in
  `LivePhysics.away`: kept in checkpoints (Undo, Replay), emptied by Back to reality.
  `SmallBodiesLayer.hide(away)` draws it at magnitude 99 (no point, so `CometTails` draws no coma,
  tail or nucleus, and it is neither picked nor labelled), and search, `findByName` and the brightest
  comet's tour skip it. It has no mass: nothing else moves differently. Not yet: moving or throwing a
  comet (a `Body` stand-in of no mass from its elements, as `SimBody` is for other stars' planets) and
  keeping a comet taken away in a save or a link (said in what live physics leaves out). Browser
  checks: `LIVE_ONLY=comet` of `scripts/live.mjs`.
  *Steps 2 and 3, move it, throw it, keep it* (28 Nov 2026; the same task's second try, reviewed here):
  Move works on a comet. `powerBody` gives it a stand-in, `CometBody` (`src/app/CometBody.ts`, a `Body`
  of no mass, id `COMET_FIRST_ID` 600,000,000 plus its catalogue number, not one of the system's bodies),
  kept on the comet's own path (`onPath`: `cometState` in `src/astro/comet.ts`, the worker's own sums)
  until the simulation takes it on (`LivePhysics.carry`, gm 0: pulled, pulling nothing). From then on
  `LivePhysics.carried` maps the comet to it, and each frame `SmallBodiesLayer.carry` puts its point
  and brightness where the simulation has it, and gives `CometTails` the way it goes
  (`Comet.carriedVelocity`). A carried comet that hits something is gone with a line in the log (no
  impact card: with no mass the hit's energy is 0). Undo, Replay and Back to reality bring it back to
  its recorded path. A save and a link keep the comets carried and taken away as an optional part at the
  end, under the form byte `WORLD_FORMAT_COMETS` 2, written only when a comet was changed (links of form
  1 read as ever); `checkWorld` refuses a comet not in the catalogue, listed twice, both carried and
  away, or carried and not simulated. While the Sun is changed every comet is hidden, a carried one too.
- *The camera rides with what a watch frames* (found in this part's pictures): the watch of a Moon
  thrown on a circle is framed round the Earth from about 4.4 million km, beyond the Earth's reach
  (its sphere of influence, some 0.9 million km). There the camera rode with the Sun
  (`App.chooseAnchor` picks by reach), and at 3 days a second the Earth left the frame within
  seconds. Now the world a watch is framed round, or a new world is being put in place round, is what
  the camera rides with while the watch lasts (its Replay offer included) or the placing does
  (`App.framed`). Part 1's Jupiter never showed it: its frame is well inside Jupiter's reach.
- *The round buttons and a tall card* (found merging the phone's new player pass, e1e9491): with a
  card's details open on an upright phone the round buttons rose to the top, over the clock chip and,
  in live physics, over Back to reality (live's tap on it was blocked). The phone's C2 (ce1fa02) has
  the same rule this part first made (the dock ends below the chips, or the mark of live physics, and
  a tall panel gives way) and steps the buttons aside while details are read: it is the one kept.
- *The mark at the top* (the coordinator, from Part 1's pictures): its second line said how fast the
  stepping kept up ("getting 23 minutes a second"), cut off on a phone, and the watch's chip said
  the pace anyway. Now: "since 1 Oct 2026"; outside a watch, when the stepping cannot keep up, "only
  23 min/s" (the clock chip's way of writing rates); the Time sheet keeps the full sentence. During a
  watch the chip says the pace, and the watch slows itself when the stepping falls behind.
- Checked: the type check; the unit tests (new: the throw's arithmetic in `tests/powers.test.ts`,
  the slingshot, the flick, an aim let go while still moving and placing in `tests/mover.test.ts`,
  a world thrown from where it is watched in `tests/watch.test.ts`, the sizes and the slider in
  `tests/whatif.test.ts`); `live` with two new blocks, `throw` (Throw offered, the slingshot's
  arrow and its marks, the card and the orbit line while aiming, let go on a circle and watched,
  the Earth and the Moon still in the frame days into the watch,
  Undo, a flick past escape) and `place` (an Earth added and waiting in sight, 5 Earths at 1.71
  times its size, dragged and left on a circle, Done watched, one Undo, a red dwarf), on a phone
  and at a desk, and the mark's words in the watch block; `whatif` (its Add check measures from
  the eye as Add was tapped: the camera may now ease out after it), `interact`, `touch`, `game`,
  `flight`. The full `live` suite found one regression on the way (after Add, Mass needed two
  taps: a tap on another panel ends a world's moving, and the card was drawn from the state before
  it; `Hud.endMove`). The new checks fail on Part 1's build, and the frame's on the build just
  before the camera rode with what it frames.
- Not done here: the flick's speeds tuned by a hand on an iPhone; the slingshot and placing in the
  headset; a made sun's light afterwards with the Mass power (it keeps the light it was made with);
  the arrow may run under the card (the finger's pull can go anywhere on the screen: it is the
  world's throw that is drawn; Part 3 stops it at the card's edge).

### Part 3: impacts you can see, and the future drawn (done)

- *Impacts you can see* (`src/app/Impacts.ts`; the arithmetic in `src/app/Powers.ts`: `contactTimes`,
  `soonestContact`, `impactWords`; `bindingEnergy` in `src/sim/physics.ts`; `src/render/Flash.ts`).
  - Each frame, while live physics runs forwards and changes are shown (More: Show me what
    happens), the first hit ahead is looked for among the worlds that matter to what is seen
    (`LivePhysics.weighty`, as the watch has them: stars, planets, dwarf planets, moons from Mimas
    up, what was made; never a moonlet), on the two-body orbit of each pair about each other, as
    far ahead as the frame's time reaches. Pairs that cannot come that near so soon, at the most
    speed falling together could give them, are passed over unworked. The times are worked in
    closed form from the energy's sign (an ellipse, a parabola by Barker's equation, a hyperbola;
    straight falls among them, where `sim/Kepler.timeToRadius` gives none), checked against the
    orbit stepped by Runge-Kutta in `tests/powers.test.ts`.
  - Each hit ahead is judged once (`SlowMotion`), as the two come within 8 times their radii added
    (`ZONE`). If the rest of their fall would take less than 3 seconds on the screen at the rate
    time runs, the frame that reaches that distance stops there, and time then runs at the rate at
    which the rest takes 3 seconds (`SHOW`), never slower than real time. The watch's chip says
    "Slowed: 1.5 hours a second", the clock chip the rate. A fall that takes 3 s or more anyway is
    left alone: slowing it again as the two came nearer would never let them meet. Once they have
    met, time stays slow 1.2 s, then doubles every quarter second back to the rate asked for; a
    pair that passes after all gives it back at once. One governor (`App.slowing`): it gives the
    frame a share of the rate asked for, so the watch's rate, Stop and the explorer's rate are
    untouched. Decided against the research (which slowed by the time to contact at the closing
    speed): with a judgement per frame the slowing never ends (each frame takes a third of what is
    left), and only the last of the fall needs it.
  - The camera frames the two (`App.frameHit`, the watch's framing), round the heavier, unless both
    are already in the part of the view the interface leaves clear and 40 px or more apart. Not in
    the ship, on foot or in the headset.
  - A flash where they met (`FlashLayer`): on the world they became, a white core in an orange glow
    that swells and fades in 1.6 s, at least 90 CSS px across, drawn over what stands in front of it
    at a brightness of its own: a depiction (said so in what the simulation leaves out), never
    counted by the eye's metering (`Exposure` never sees it); none if the hit was more than a second
    of screen time ago (at high rates a frame is long).
  - A card above the world's card (`Hud.impact`), until it is closed, another hit takes its place,
    or the change is undone or another begins: "Mars hit Earth at 9.4 km/s", "Energy 2.5×10³¹ J: as
    much as the Sun gives off in 18.4 hours. 5.2 times the energy that holds Mars together." and,
    smaller, "Prediction, by a rule of thumb (the energy against what holds each together): Mars
    would break apart, Earth would not. Breaking apart is not simulated yet: the two become one."
    The energy is ½μv² (the simulation's `heat`); what holds the lighter together is its binding
    energy as a ball of even density, 3GM²/5R (the Earth's 2.24×10³² J; a real world is denser at
    the centre, the Earth held about a tenth more tightly: said in what the simulation leaves out).
    `LivePhysics.takeHits` gives the two as they were before they met. The toast no longer says the
    same hit (the log keeps it); a moonlet's fall is still told in the toast alone. The card takes
    room: an open panel of the world's card folds away where there is not room for both
    (`Hud.makeRoom`), and where there still is not (a phone on its side with a watch's chip up) it
    shows its first line, with More. Where it leaves less of the view clear while the camera is in a
    watch's or a hit's frame, the frame is fitted again to what is left (`App.frameAsked`, let go
    when a finger takes the camera). The toast now stands in front of the panels (a phone on its
    side has them reach up to it; taps go through it).
  - Decided: the hits ahead are foreseen rather than the simulation wound back after one. Near the
    end of a fall the two-body orbit is what happens (from a day and a half out at 13 km/s the
    Sun's tide moves the Earth and Mars a few hundred kilometres against each other), so time is
    slowed for a hit at rates up to some 100 days a second; faster, a hit no frame foresaw shows its
    card, and its flash if it is under a second old, without slowing. A graze foreseen as a miss
    likewise.
- *The future, drawn* (`src/app/Foresight.ts`, `src/render/Futures.ts`). While a finger holds a
  world, aims a throw or is on the mass slider, or a world added waits to be put in place, the
  simulation is run ahead on a copy of itself (`NBody.restore(live.sim.snapshot())`), every pull
  counted: a dashed orange path from the world, drawn from what it goes round (as the trails are),
  and, at the path's end and on the card under the orbit, what ends it: "With every pull counted,
  it hits Earth in 1.6 days", "in 3.2 days it is the Sun's: from then on it goes round the Sun"
  (Part 4's words), "leaves the Sun for good"; or "goes on like this for 78.3 days at least". It looks up to three
  of the world's turns or a hundred years ahead and stops at the first hit, leaving, or change of
  what it goes round (the copy's own events). What goes round faster than a quarter of the world's
  turn is carried on rails, as live physics carries it while the change is watched (a watch runs at
  an eighth of the quickest turn a second; rails below two seconds of that): when nothing else
  changes, the path is the one time will then take, bit for bit (`tests/foresight.test.ts`; and
  the Moon put on a circle at twice its distance goes round the Sun in live physics within a day
  of when the look ahead said). It grows with the time the waiting stepping does not use (3 to 12 ms
  a frame; 2 ms while time runs) and starts again from a change at most five times a second (each
  start copies the simulation). It never touches the scene's bodies, nor what live physics tells.
  The words at the path's end are left out where they would fall under the interface (the round
  buttons often): the card says them anyway.
- *Open paths drawn* (the coordinator, from Part 2's picture at the mark of escape: no line).
  `Orbits` drew closed orbits only. A body on an open path is now drawn from where it is outwards,
  to four times as far out as it is (or as its nearest point): a parabola at exactly the speed of
  escape, a hyperbola beyond, from q and the true anomaly (r = q (1 + e) / (1 + e cos ν): a parabola
  has no semi-major axis; `openPath` in `src/astro/kepler.ts`). Open or closed is the card's rule
  (`isOpen`, moved there from Powers: since Part 4 an energy within 10⁻⁶ of μ/d of nothing is open), so the line
  and the card agree; closed orbits are drawn by the same code as before. A world of the
  simulation bound to nothing (thrown out of the Solar System) is drawn on its open path past the
  Sun, and the card says "Now on an open path past the Sun: it passes at 1 AU, then leaves." (it
  had no line, and "Now it goes round nothing."). Found doing it: the Moon thrown at 1.6 times the
  speed of a circle is free of the Earth at once and goes round the Sun (the simulation's own
  pairing; Part 2's flick showed it), so its line is its orbit round the Sun, closed; the hyperbola
  is a world leaving the Sun's (the Earth thrown at 1.6: e = 1.56, checked in the browser).
- *Words* (the coordinator): the orbit on the card reads "a circle 369,335 km out · 25.7 d" where its
  two ends come out the same, else "a slightly stretched circle, 365,709 to 382,840 km · 26.21 d"
  (the unit once where both ends have it: `orbitWords`); no number in brackets. The details keep
  the number and say what it means: "How stretched: 0.023 (0 is a circle, 1 and more an open
  path)". A path whose nearest point is inside what it goes round: "Now on a path into Earth: it
  hits it." The lightest star reads "0.08 Suns (83.8 Jupiters)" (`starMassWords`; the Mass power
  says a star's mass so too).
- *The slingshot's arrow* is drawn only in the part of the view the interface leaves clear
  (`Hud.setAim`: a clip to `freeArea`): pulled towards the card, it stops at its edge instead of
  running on under it.
- Checked: the type check; the unit tests (new: `tests/impacts.test.ts`, the slowing; `tests/foresight.test.ts`,
  the look ahead against live physics, bit for bit and in what it says; in `tests/powers.test.ts` the contact
  times against the orbit stepped, the first hit ahead, the card's words, the orbit's words; open paths and the
  open rule in `tests/astro.test.ts`; `bindingEnergy`; a world thrown out of the Solar System in
  `tests/mover.test.ts`; the hit's record in `tests/livephysics.test.ts`; the light star in
  `tests/whatif.test.ts`); `live` with two new blocks, `open` (the Earth aimed at 1.6: its hyperbola past the
  Sun, the card, "leaves the Sun for good", let go where taken) and `hit` (Mars aimed at the Earth: the path
  into it and when; let go: slowed with the chip saying so, the hit some 3.5 s on, the frame, the flash
  measured on the screen, the card all in sight and the toast not saying it again, Undo), and in `throw` the
  path ahead on a circle and at escape, the arrow stopping at the card, the parabola at escape drawn and read
  off the screen; the wording checks of the moon, jupiter and made blocks; the red dwarf's mass words.
  `whatif`, `interact`, `touch`, `game`, `flight`. The new checks fail on Part 2's build (02cc087), but for
  "the camera frames the two", which the throw's own watch already did there. Merged with the landscape
  work (the view centred on the part the interface leaves clear on a phone on its side): what this part
  draws (the path ahead, the flash, the open paths) is drawn by the camera, and what it places on the
  screen (the arrow, the words at the path's end, the frame of a hit) goes through `App.project` and
  `frameOn`; `live`'s `side` block reads the path ahead and the orbit line off the screen of a phone on
  its side, with the centre moved. (Once, at a desk, live's search gave the asteroid Io for the moon,
  which share the name; the block passed run again.)
  Found by the full `live` suite and put right: the moonlets of a Jupiter made twenty times heavier slowed
  its watch at once and took its frame (hits are now those of the worlds the watch counts); on a phone on its
  side the card of a hit left the world's card cut off under the screen's edge (it folds to its first line
  there, with More); the toast stood behind the panels where they reach up to it (in front now: taps go
  through it).
- Not done here: the path ahead of a world while time runs on the mass slider is drawn from a
  moment ago (it starts again five times a second, and Jupiter's own path is not what changes
  most); the look ahead of the Moon at escape ends where the Sun takes it, three days on (the event
  ends it, as asked), so its path lies under the slingshot's arrow; breaking apart; a world's own
  heat and glow after a hit; the impact in the headset (its flash shows there, the card does not).

### Part 4: its temperature, live; size as well as mass (done)

First, three things the coordinator found in Part 3's pictures, each with a check:
- *What ends the path ahead, in words* (`aheadWords` in `src/app/Powers.ts`). "With every pull counted,
  it goes round the Sun in 3.2 days" read as a year of 3.2 days. A world taken over by another now
  reads "With every pull counted, in 3.2 days it is the Sun's: from then on it goes round the Sun.",
  and at the path's end "in 3.2 days it is the Sun's" (so too a world captured: "in 2031 it is
  Jupiter's"; "taken by" is gone, and with it "it taken by", which the card would have said). "It
  hits Earth in 1.6 days" and "leaves the Sun for good" stay.
- *The words at the path's end stand clear of the slingshot* (`src/ui/aimShape.ts`; `avoid` and
  `strokeMeets` in `src/render/Labels.ts`). The arrow's parts are worked out in one place for the
  drawing (`Hud.setAim`) and for the names kept off it: its line as wide as its head, the marks and
  their words, and the ring round the world being moved (48 px across). The words at the path's end
  try each corner of the end, then places nudged off them 6 px at a time (outwards, up or down,
  along), nearest first, wholly on the screen, never under the interface (the round buttons
  included, as before); where nothing will do they go (the card says them). Other names are laid
  out as before.
- *At the mark of escape, open* (`OPEN_EDGE` and `isOpen` in `src/astro/kepler.ts`, one rule for the
  card and the line). Mars thrown with its moons at the exact mark of escape came out e = 1 − 2.4×10⁻⁹
  and the card showed an enormous closed orbit: the throw sets the centre of Mars and its moons at
  the speed of escape (its e − 1 is 10⁻¹⁵), and Mars swings about that centre by some 3×10⁻⁵ m/s as
  Phobos goes round. An orbit now counts as open when its energy is within 10⁻⁶ of μ/d of nothing:
  a speed within half a millionth of the speed of escape; bound, its far end would be over a million
  times as far out as it is. Chosen over snapping the speed after the moons are released, which
  would hold for an instant (the swing changes e by ± 2.4×10⁻⁹ every 7.7 hours), and over a
  tolerance on e itself, which would call a world falling straight in open (its e is 1 whatever its
  energy). The time to a hit keeps its own, finer switch to Barker's parabola (10⁻¹²).

*Its temperature, live* (`temperatureOf` in `src/app/Worked.ts`; `sunlight`, `sunlitTemp`,
`boilingPoint`, `waterState` in `src/sim/physics.ts`; the data `public/data/solar/albedos.json`,
fetched by `pipeline/fetch_albedos.py` from NASA's fact sheets, on `Body.climate`).
- On the card of a planet, the Moon, Pluto or Charon, under its buttons, a line short enough for a
  phone (46 letters at most); in its details the working, and what water does there. In the real
  Solar System as the sheets have it: "15 °C, as measured. Without its air: −18 °C." (Venus "464 °C, as
  measured. Without its air: −47 °C.", its water boiling; Mars −59 °C and −63 °C, its water ice; the
  Moon "Temperature without air: −3 °C"; a giant "From sunlight alone: −163 °C", with a note that it
  gives off heat of its own, which this leaves out). In live physics, where it is now, in the colour
  of live physics, worked afresh with every update of the card (a tenth of a second): "Earth here:
  112 °C. The oceans would boil." The card's room on an upright phone (`CARD_ROOM`, what the subject is
  lifted above) counts the line: 225 px, from 196 (`touch`'s check that the Earth is in the middle of
  the room the interface leaves; a card without the line has its subject some 14 px above that
  middle). On a phone on its side, where a watch's chip (and a hit's card) leave the card too little
  room even with its panel folded, the line folds too until another world is chosen (`Hud.makeRoom`;
  live's watch block, "the card is whole beside it", found it). The temperature without air
  is T = ((1 − A) S / 4σ)^¼, its heat spread all round it, S the sunlight: the sheet's at its mean
  distance in the real Solar System; Σ L / 4πd² from every sun where it is now in live physics (a
  sun's light 4πR²σT⁴ from its size and temperature: the Sun's 3.828×10²⁶ W; a made sun's its main
  sequence's). For Venus, the Earth and Mars, whose air is thick enough to warm their ground (a
  millibar or more), the warming their air gives as measured (the ground's mean against the sheet's
  sunlight alone: 32.88 K for the Earth, 510 K for Venus, 4.2 K for Mars) is kept as it is wherever the
  world goes: how its air would change is not worked out (said in the working, as a simplification).
  What water does there: below the 0.006 bar of its triple point never liquid, ice below 0 °C, boiling
  where Clausius and Clapeyron put it for the measured pressure (about 570 K under Venus's 92 bar; on
  Mars it boils as soon as it melts). With no sun at all: "Earth here: no sun to warm it."
- Data, real only: the Bond albedo (the share of all the sunlight it sends back: not the catalogue's
  `albedo`, JPL's geometric albedo), the sunlight at the mean distance and the black-body temperature
  of each sheet; Charon's Bond albedo is on Pluto's sheet, and its sunlight its planet's. A world with
  no Bond albedo on a sheet has no line: nothing is estimated (Titan, measured air and all, has none
  there, so none here). A world the explorer made has none either: a copy of the Earth has no air or
  clouds, which set the Earth's albedo. The sheets' own black-body temperatures are reproduced within
  0.2 K (`tests/physics.test.ts`), but for two: the Earth's 254.0 K and Pluto's 37.5 K follow from
  albedos of about 0.306 and 0.49, older than the 0.294 and 0.72 the same sheets give; from those, the
  formula's own 255.1 K and 32.2 K are used.
- Decided against the research: a file of its own (`albedos.json`, loaded with `system.json` by
  `SolarSystem.load`) rather than a field of `system.json`, which only a whole run of
  `build_solar_system.py` writes (SBDB and all: it would have changed data this part has nothing to do
  with). In the real Solar System the line is the sheets' (their mean), in live physics it is where
  the world is now: Earth "here" on 1 October 2026 (1.001 AU) says 15 °C, at perihelion 17 °C.

*Size, as well as mass* (`LivePhysics.setSize`, `realRadius`, `resized`; `sizeFactor`, `sizeSlider`,
`sameDensity`, `radiusWords` in `src/app/Powers.ts`; the Size power in `src/ui/Hud.ts`).
- **Size**, a power of its own beside Mass (five in a row on a phone, 64 px each): the radius in words
  ("19,113 km", "3 times its real size"), Real size, a slider from a tenth to ten times the real radius
  (a thousand times the volume either way, as the mass), and between its ends **Same density**: on, the
  size follows the mass at the density it really has, R = R₀ (M / M₀)^⅓ (and moving the size moves the
  mass, the cube of it; the Mass panel says "Its size follows: the same density"); turned on, the size
  is made to follow the mass at once, as one change. Each slider gesture is one change, to undo and to
  watch, as the mass's. For worlds of a known mass and a measured size; not for stars (a made sun's
  size follows its mass; the Sun keeps its look). First built under the mass slider, in the same panel:
  with the theory's words a phone had some 60 px of view left above the card, `freeArea` gave the
  whole view instead (under 120 px it does), and `makeRoom` was fooled into leaving the panel open
  through a watch (live's watch block, the finger taking the camera back, found it); `makeRoom` now
  measures the clear part as it is (`freeBox`).
- The two numbers agree (the coordinator: it said "19,020 km, 3 times its real size", where three times
  the Earth's radius is 19,113 km: the slider's step nearest three times was 2.985 times). Chosen: both.
  The slider snaps to a whole or half factor, or one over a whole one (1.5, 2, 2.5 ... 10; 1/2, 1/3 ...
  1/10), within 0.006 of a power of ten (1.4 %; its steps are 1.2 % apart, so the step nearest each
  lands on it); and a factor it has not snapped to, or one Same density gives, is said to three figures
  ("2.95 times", "2.00 times", "0.794 of its real size"), the radius to the kilometre beside it within
  what those figures say (`sizeFactor`, `sizeTimesWords`; `tests/powers.test.ts` walks every step of the
  slider; live's size block asks for "19,113 km" and "3 times its real size", three times exactly).
- The radius goes to the simulation (`NBody.setMass(id, gm, radius)`), so a bigger world is easier to
  hit (`tests/livephysics.test.ts`: the Moon sent past the Earth two of its radii from its centre
  misses it, and hits it made three times as large); what rides on it is let go, so that a moon it
  has grown round is not carried on through it. Its gravity at the ground, the speed of escape and
  its density follow in its details; its face is drawn larger or smaller; its air keeps its measured
  depth over its new ground (`Atmospheres` reads the radii every frame); Saturn's rings keep their
  measured size; and there is no ground to land on over a world whose size has been changed (its
  elevation is measured for its real size: `App` leaves its terrain candidate out, so Walk is not
  offered). All said in what the simulation leaves out, with the simplification of Same density (a
  real giant planet stops growing above about a Jupiter's mass, squeezed by its own weight).
- Undo, Replay and Back to reality keep sizes as they keep masses (the checkpoint had them); a
  checkpoint now also keeps each star's temperature and brightness.

*A made sun's light follows its mass* (the coordinator: it kept its light when its mass was changed
later with Mass). Its size, colour and light now follow its mass by the same main-sequence rules as
when it was made (`App.shine`, shared with the making), whatever Mass gives it later, within the
masses a sun can be made with (0.08 to 2 Suns: below, it would not shine as a star; the slider stops
there). Its "size (made by you)" in the details is worked from the mass it has; another made world's
from the mass it was made with, while it still has that size.

- Checked: the type check; the unit tests (new: in `tests/powers.test.ts` the words at the path's end and
  the size slider; `tests/labelsclear.test.ts`, strokes kept clear and the words at the end of Part 3's
  picture set off the arrow; `tests/astro.test.ts`, the open rule; `tests/mover.test.ts`, Mars thrown at
  escape either way, open; `tests/physics.test.ts`, NASA's black-body temperatures, the Earth's and Pluto's,
  two suns, water; `tests/worked.test.ts`, the lines and their working in the real Solar System and in live
  physics, and the worlds that have one; `tests/livephysics.test.ts`, a world made larger is hit, its size
  through Undo and Back to reality). `live` with two new blocks, `warm` (the Earth's line as measured; dragged
  two thirds of the way to the Sun, the line read at each step against what its distance gives, past 100 °C
  the oceans boil; Undo) and `size` (the size beside the mass; three times: drawn so, its mass the same; its
  gravity and escape speed; no ground to land on low over it, where the real Earth has it; Same density; Undo),
  in `throw` the words at the path's end and where they stand, in `place` a made red dwarf given ten times its
  mass with Mass. On the build pushed (merged with free flight by touch and the ship's assist): `live` 184 (on a
  phone 92/92 in one run; at a desk 91/92, the frame's work at a thousand years a second over its share on a
  loaded machine, its block 8/8 run alone), `touch` 99/99, `flight` 26/26 and 66/66; on Part 4's build before that
  merge `whatif` 35/35, `interact` 20/20, `game` 21/21. The new checks fail on Part 3's build (072e4f0): the words
  at the path's end and where they stand (on the Moon's ring there), the temperature's line and its steps, Size,
  the made sun's mass; the new unit tests on its sources.
- Found by the full `live` suite on a loaded machine and put right (Part 3's look for a hit): with frames long, the
  look ahead reaches hours, and two moons of Saturn hundreds of thousands of kilometres apart were judged on their
  two-body orbit about each other, nearly a straight line, which ran through both: a "hit" that slowed the Moon's
  watch and took its frame to Tethys or Rhea. A pair is now looked at only within the reach of either's pull (its
  Hill sphere about what it goes round; the Sun's everywhere) or their zone (`Meeting.reach` in
  `soonestContact`): the Earth's reaches 1.5 million km, Rhea's 5,800 km. Live's jupiter block reads Ganymede's details
  rather than Io's: with Jupiter twice as heavy the great moons' orbits cross, and which hits which goes as the stepping
  does on the machine; at a desk Io had sometimes been taken in by then, and the search gave the asteroid Io and its card
  (Part 3's flake). Ganymede, the heaviest, takes in any it meets. (`find` can now ask for what a row says under the
  name, and `LIVE_KINDS=desk` runs the desk alone.)
- Not done here: a world's temperature over its year on an eccentric orbit (the line is where it is now),
  its day and night sides and its latitudes, a giant's own heat, how air would change with the warmth;
  a temperature for Titan or any world whose Bond albedo NASA's sheets do not give; the size of a star;
  a made sun below 0.08 Suns (the slider stops there); landing on a world whose size has changed.
- Known trade-off, found by the test-health pass (ship.mjs, 0fce693): the card grew by a row of buttons (Size) and a
  line of temperature, so on a phone on its side with a world's card open the part of the view the interface leaves
  clear is the strip over the card, about 228 x 159 px (it was about 190 high), and the chase ship, framed in that part,
  is about 100 px wide (it was about 130). Decided by the coordinator to stay as it is for now. ship.mjs measures the
  ship's own pixels with the card put away (the card on, n fell from 131 to 90 against a floor of 100); that the ship is
  on the screen and under nothing is still measured with the card on.

## Save & share (share worker)

The owner wants the app to grow, and a link that opens someone's exact scene is how players will
show friends ("look, I threw the Moon out of orbit"). Two parts, each tested and live before the
next: links to the real universe and the Share button; then a changed universe (live physics),
saves on this device and the link's preview.

### Part 1: links to the real universe, and Share (done)

- *The link* (`src/app/SceneLink.ts`). After the `#` of the app's address, readable on purpose:

      #v=1&o=Moon&oi=301&a=Earth&ai=399&c=-27592462.15,-25771836.13,5974591.841
         &q=0.6376606,-0.204707,-0.2634449,0.6943204&t=2026-10-02T05:23:58.102Z&r=3600&p=1

  `v` the form's version; `o` what is selected and `oi` its number (a body of the Solar System:
  its NAIF id, which tells the moon Io from the asteroid Io); `a`/`ai` what the camera is at and
  moves with, left out when it is what is selected, `a=-` in open space; `c` the camera from it
  (m; from the barycentre in open space), 10 significant figures (a millimetre at the Earth from
  the Moon); `q` which way it looks (a quaternion, 7 decimals: a hundredth of a pixel on a phone),
  *without* the tilt an upright phone gives the camera to put the world above the card
  (`rig.aim`), so a phone's link opens at a desk looking the same way and the other way round;
  `f` the field of view where it is not 50; `t` the date, UTC to the millisecond; `r` the rate of
  time; `p=1` paused; `w` (Part 2) the changed universe. About 210 characters.
- Decided: the fragment (`#`), not the query. The browser never sends it to the server, so a long
  link (Part 2's) is never refused by GitHub Pages (it answers 414 to long request lines) and
  nobody's scene is in a server log; a second link opened into a tab that is already open changes
  only the fragment, so the page reloads itself for it (`onFragmentChange`). The old query form
  (`?time ?rate ?paused ?fov ?target ?dist ?az ?el ?campc ?look`, the tests' and the trailer's) is
  untouched and still read first; a fragment overrides it. Once opened the fragment is taken off
  the address bar (a reload starts the app as usual; saves, Part 2, are for keeping).
- Decided: a link that fails any check is not opened at all (no half scene): the app opens as
  usual and a note says why in plain words ("This link could not be opened: it was made by a
  newer version of the app (form 7). Here is Starfarer as usual."). What a link names but this
  app cannot find is said ("\"Planet Nine\" could not be found here."), and the rest is opened.
  `decodeLink` never throws: every number is finite and in range (the camera within the
  observable universe, the rotation a rotation, the field of view 0.1-170°, the rate at most a
  thousand years a second), names at most 80 characters without control characters, a key given
  twice refused, the whole at most 64 KB; unknown keys are passed over (for a later form). A name
  from a link is only ever shown as text (the note is `textContent`).
- *Opening* (`App.openFragment`, from `App.create` after `applyUrl`): the date, the rate (the steps
  of Faster and Slower carry on from the one at or below it), the pause, what the camera is at
  (a body by its number, else anything by name, else the catalogue of real objects for up to
  8 s), the camera's place and look, the selection, and a note over the panels: "A shared view:
  the Moon, 2 October 2026, 05:23 UTC, time paused." The title screen is skipped
  (`StartMenu.wanted(search, fragment)`). It never switches on live physics. Found doing it: the
  camera's anchor had to be let go before the date changed (`setAnchor` keeps the anchor's last
  place, and the camera was carried 0.8 AU with the Earth's move to the link's date).
- *Share* (`App.share`, `src/platform/share.ts`). On the card of what is selected (a share icon
  beside its Close) and at the top of More ("Share this view", under How to move, which the
  flight suite keeps first), with a mouse as with a finger. On a
  phone (a touch screen, or a finger used) the system's share sheet (`navigator.share`, title
  "Starfarer", text "Moon, 2 October 2026, in Starfarer", the link); at a desk, or where there is
  no sheet, the link is copied (`navigator.clipboard`, else the older `execCommand('copy')`, else a
  box to copy it from) and the toast says "Link copied". Closing the sheet says nothing.
  Every browser API is in `src/platform/share.ts` (the address, history, the share sheet, the
  clipboard, the prompt, and Part 2's compression streams).
- Checked: `tests/scenelink.test.ts` (the form as written; 2,000 random views of every kind round
  trip; 24 kinds of bad link turned away in plain words; a name with markup comes back as text;
  20,000 random and mutated links never throw and never give a number that is not finite) and a
  new browser suite, `scripts/share.mjs` (`share` in `FULL` of `scripts/affected.mjs`; a full set
  is now 19 jobs): on a phone upright, on its side and at a desk, the Moon selected with the camera
  at the Earth turned off its default, an hour a second, paused; Share from the card (from More on
  its side); the link opened in a fresh browser: no title screen, the same selection and anchor,
  the camera to a millionth of its distance and its look to 0.001°, the date to the millisecond,
  the rate and the pause, no live physics, the note, the address cleaned; time running at a day a
  second (the link holds the moment it was shared); a phone's link opened at a desk; a damaged
  link, a newer one, something that is not a link, one naming what is not here.
  On GitHub's runners, the full set at 95884a2 (run 45206153137): share 45/45, start 34, touch 99,
  whatif 35, stars 18, places 16, vr 32, terrain 15, game 21, verify (35 scenes), exposure 79,
  walk 32 + 52 + 14; flight-phone failed "How to move first in More" (Share had been put first:
  it is now second, 68982f7). The other failures there are the commit before's too, run on it
  (runs 45211759470, 45216536036, 45230593811): ship's two sideways checks, flight's arrival at
  the star and gentle drop, live's month of the Moon left on a circle (2.70 against about 2.8,
  both kinds there), interact (fixed upstream since, 1c71b73), and flight-phone's "names looked
  at" floor (50, needs more than 50: 50 on the commit before too). `--old df8abcf`: share fails
  (run 45206153424).

### Part 2: a changed universe, saves on this device, the link's preview (done)

- *What a link holds of a changed universe* (`w=`, `src/app/SceneWorld.ts`; `LivePhysics.world` and
  `adoptWorld`). Everything by number, never by reference: the simulation settled at that moment
  (`NBody.bodies`: each simulated body's number, G×mass, radius, bulge and pole, whether it was told
  leaving, what it was last told to go round, place and velocity, as float64, to the last bit;
  the step's settings), the moons each simulated planet stands for, the worlds made (kind, name,
  what for, mass and size as made, a sun's colour and light), the bodies taken away, the masses and
  sizes that are not the catalogue's, the date the real universe was left (Back to reality goes
  there, at real time) and the last 12 lines of the log. What rides on the simulation (light
  moons, the belt) follows from the catalogue at the date, as it does on the sender's device.
- Decided: the internal snapshot (`NBody.snapshot`, which Undo and the look ahead use) is not what
  a link carries. It is the whole working state, hierarchy and indices included: 19 KB for 38
  bodies, and a stranger's link could hand it indices that loop or point outside its arrays. A
  link carries the bodies alone, and the plan of the steps is made again from them, as after any
  change (`NBody.fromBodies`, which checks every list's length, every number's range, that no
  number is used twice and that what a body goes round is there).
- Decided: *sharing starts the sender's simulation again from what the link holds*
  (`LivePhysics.rebase`, in `App.sceneView`; a save does the same). A settled simulation that goes
  on keeps its old hierarchy and step; one made from the link plans afresh. Started again from the
  same bodies, the two run the same numbers: on the same browser engine the scene goes on bit for
  bit as on the sender's (`tests/sceneworld.test.ts`; `share.mjs` compares every simulated body to
  the bit). It disturbs nothing the sender sees (a change does the same each time).
- *"The same on their device"*, honestly. Arithmetic and `Math.sqrt` are exact in every browser
  (IEEE 754); `Math.sin/cos/pow/cbrt/hypot/log2` are not specified to the last bit, and Safari's
  JavaScriptCore and Chrome's V8 can differ there. The simulation uses `hypot`, `cbrt`, `pow` and
  `log2` in choosing its step and hierarchy, the ephemeris of the moons on mean elements uses
  `sin`/`cos`, and the look ahead's words round numbers. So: the link's numbers arrive exactly
  (float64, not decimal); the card's prediction on another engine starts from the same bits; and
  a difference in the last bit of a step's length or a moon's place grows with the run. For what
  the card says ("it hits Earth in 1.6 days", "in 2031 it is Jupiter's") that is far below the
  rounding of the words; over thousands of simulated years in a crowded system the details drift
  apart, as two runs of a chaotic system do. One more, found by the unit test: run frame by frame,
  what live physics carries on rails depends on each device's frame time (`LivePhysics.follow`),
  so even on one engine two devices running at different speeds differ a little over a long run
  (Mars still hits the Earth, told in the same words, the Earth within 1 km after 30 days). Not
  done: a fixed rails schedule for shared scenes, which would make long runs agree too.
- *Size, measured* (`tests/sceneworld.test.ts`, "measured"; the link with a 210-character view):

  | scene | bodies | bytes | deflated | link |
  |---|---|---|---|---|
  | the Moon thrown | 38 | 2,429 | 2,265 | 3,413 |
  | Earth 2 added | 39 | 2,482 | 2,314 | 3,484 |
  | Mars sent at the Earth | 38 | 2,366 | 2,204 | 3,329 |
  | 50 years after Jupiter ×10 (every moon of Jupiter simulated) | 142 | 8,367 | 6,995 | 11,330 |

  What decided it: doubles of positions and velocities do not compress (deflate saves 7 % on a
  typical scene, 16 % on the big one; storing the doubles byte plane by byte plane, which is kept,
  is what gets deflate even that far: 3 % more than in place). The masses and radii that are the
  catalogue's are not written (both ends have the same catalogue, the same bits): 2,997 → 2,429
  bytes on the first scene, a fifth. Decided against compression: CompressionStream is async, and
  an await between the tap and `navigator.share` risks Safari refusing the share sheet (it needs
  the tap's activation); it also needs Safari 16.4 to open a link at all, and brings a
  decompression bomb to guard against. Without it a link is at most 4/3 of 48 KB of bytes
  (`LINK_MOST`), read in one linear pass. Decided against rounding the doubles: it would change the
  sender's scene (by millimetres) and save at most a third. base64url (no padding): safe in a link
  as it is. What fits: a typical changed scene, 3.3-3.5 KB, goes whole through iMessage,
  WhatsApp, Signal, Telegram (4,096 characters a message), Slack and e-mail; not Discord's 2,000
  without Nitro. The 50-year scene (11 KB) goes through iMessage, WhatsApp, Slack and e-mail, not
  Telegram. No shortener or paste site (the site is static, and nothing leaves the device).
- *Checked on the way in* (a link is written by a stranger): every count capped before anything
  is made for it (1,024 bodies, 64 families of 256, 24 made, 12 lines of 400 characters, names of
  40), every double finite and in range (G×mass up to 10⁴ Suns, sizes up to 70 AU, places within
  10⁵ light years, speeds under light's, dates within 10⁸ years), names of made worlds plain text
  (letters, digits, spaces, `' ’ . -`), lines of the log without control characters or `<>`,
  nothing left over. Then against the catalogue (`adoptWorld`), before anything is changed: every
  number names a body there or a world made in the link, made for what it can be made for (a moon
  for a planet, the rest for a star), a moon carried only by its own planet, a made world either
  simulated or taken away, the date of the view and of the simulation within a second. Any
  failure: nothing changes, and the note says why. Names are shown as text everywhere they go
  (the HUD uses `textContent` or escapes; the ship's read-out, which put a landed-on world's name
  into its markup, now escapes it).
- *Opening one* (`App.openScene`): the ephemeris of both dates fetched first, the universe made
  again, then the view as in Part 1 (what it names is found after the made worlds exist), and the
  note: "A shared scene: Mars, 1 October 2026, 20:00 UTC, time paused. Changed with live physics
  since 1 October 2026." No Undo history comes with it; Back to reality goes to where the changes
  began.
- *Saves on this device* (`src/app/Saves.ts`; More, a section of its own, "Saved scenes", after
  Camera and before the help: "Save this scene" and the list under it, newest first, at most 20.
  Put at the top first, it pushed the switches the touch suite taps out of the sheet's sight). A save is the link's fragment, kept under its own key with
  an index of names and dates ("Jupiter, 1 Oct 2026, changed" / "Saved 23 Nov 2026, 15:40 UTC ·
  live physics"), so it opens exactly as its link would; opened, the changed universe there is let
  go first (as Back to reality, unwatched and not undoable). Delete asks once ("Delete?"). Full
  storage: "Not saved: this browser's storage for the app is full. Deleting a saved scene makes
  room"; storage that keeps nothing (an older Safari's private browsing, storage off): "Not saved:
  this browser keeps nothing for the app (private browsing?). Share the link instead." Today's
  Safari private browsing keeps saves until its tab closes: nothing to detect, and nothing lost
  that the explorer did not choose to lose. `keep`/`forget` in `src/platform/storage.ts`.
- *The link's preview* (index.html). Open Graph and X's card: title "Starfarer: the real
  universe, to scale", a description, `og:url`, `og:image` (1200×630, `public/og-image.png`) with
  its size, type and alt text, `twitter:card` summary_large_image. The picture is the app's own
  view, captured from it by `scripts/og-image.mjs` (Saturn in June 2017, its rings open, in photo
  mode with the orbit lines off), not drawn or generated. og:image and og:url must be absolute:
  `%SITE_URL%` in index.html is put in by `vite.config.ts` (`SITE_URL`, default
  https://dippy34.github.io/starfarer/; if the hosting moves, change it there or build with
  `SITE_URL=` set). A preview is fetched without the fragment, so every shared scene shows this
  one picture (a picture per scene needs a server).
- Checked: `tests/sceneworld.test.ts` (the sizes above; round trips of seven kinds of change, the
  Moon thrown, Earth 2, Mars into the Earth and a month on, fifty years after Jupiter ×10, a second
  sun, a moon made with Saturn resized and Venus taken away, each made again in a fresh universe
  bit for bit; the prediction the same and the hit the same after a month; wrong worlds change
  nothing; 3,000 damaged worlds throw nothing but WorldError, and the 773 that are adopted run a
  day with every number finite), `tests/saves.test.ts`; `scripts/share.mjs` grows to 74 checks
  (74/74 here and on the runners, run 45255662928): a changed universe shared and opened on each
  kind of screen (the Mars-at-the-Earth card reads "With every pull counted, it hits Earth in 18.2
  hours." on both), saves, full and private storage, a name with markup. On the Part 1 build
  (`--old 611a4bf`, run 45237032342) the new checks fail (11 failed, then the run stops). The full
  set at d6968ac (run 45237032111): what failed there that does not on the build before was the
  touch suite's switches and photo mode (Saved scenes at the top of More pushed them out of
  sight: moved) and the desk's prediction on a runner (the wait now waits for the card's words,
  up to 15 minutes, not for the look ahead's own flag); then touch 99/99, game 21/21, stars, vr
  and share passed (runs 45249249213, 45255662928). Failing as on the build before: ship's two
  sideways checks, flight's arrival at the star, live's month of the Moon.
- Left for later: the ship and walking (a link opens the scene in explore mode: a link made in
  the ship or on foot puts the camera where it was, not the ship or the walker); a link's own
  preview picture; the long-run agreement above; compression in a later form of `w` if links must
  get shorter (the byte planes are ready for it).

### A scene that cannot be opened leaves the changed one as it was (done)

The coordinator, from Part 2's leftovers: a save opened in a changed universe let that universe go
before the save was checked against the catalogue, so a damaged one lost the scene the explorer
was in; and a link opened into a tab already open reloaded the page, which lost it whatever the
link held. Now:
- `LivePhysics.checkWorld` checks all that `adoptWorld` relies on (every number against the
  catalogue, the families, what was made for what, the simulation itself), against the catalogue
  alone (what was made or changed here is left out of the reckoning) and without changing
  anything. `App.openScene` decodes the link, reads the changed universe, checks it, fetches the
  ephemeris, and only then lets the universe here go; a failure leaves the scene as it was, with
  the note ("This saved scene could not be opened: its simulation has a body that is not here.
  Here is Starfarer as it was.").
- A link opened into a tab that is open (only the '#' changes) is opened in place, through the
  same path, no longer by a reload. No other path replaces a changed universe (Back to reality
  and Undo are the explorer's own).
- Checked: `tests/sceneworld.test.ts` (in a changed universe, three kinds of damaged world are
  refused and the simulation, the worlds made, the log and the Moon's look ahead are as before; a
  sound one, and one numbered as the worlds made here, are accepted); `share.mjs` (+2 checks a
  kind, phone and desk: a damaged save opened in a changed universe, and the same as a link come
  in while the app is open; the changed universe to the bit and Europa's prediction the same):
  passing on the runners (run 45270442532); on f99d31e the first of them fails and the run stops
  (run 45270442251), and the unit test cannot run there (no `checkWorld`).

## Ground and level of detail (the test-health pass)

What the ship's ground is, how much it moves as the terrain is refined, and the decision taken (the coordinator's: build A,
keep B for later, C not needed with A).

- **What the ship's ground follows.** `Flight.frameEnv` sets `core.groundR` each frame from `app.terrain.below(ship.upos).ground`
  = `PlanetTerrain.groundRadius(dir)`: the drawn tile mesh itself (the triangle of the finest loaded leaf under the direction,
  `tileGroundRadius`, geomorph factor included), built by the workers from the full elevation pyramid; and where no tile data
  exists yet, a main-thread fallback, `baseRadius + ground.height(dir, 100)`. `ShipPhysics.contact` compares the ship's radius
  with that constant `groundR`: below it is a contact, over 12 m/s a crash. It is not the elevation data at full resolution
  (the main thread's `ground.height`, at any spacing, is up to ~200 m from the mesh, so following it would float the ship
  over or sink it into what is drawn).
- **The numbers** (probe, local build of the same code: the app's places and seeded random directions, descended through
  20 km, 5 km, 1 km, 200 m, 50 m, 12 m over one spot, each stage waited until the terrain's job count was 0 and the ground
  steady for 8 frames; "first" is the ground in the first frame at that altitude, "settled" after the streaming):
  - arriving without the terrain there (a teleport, or anything faster than the streaming), first to settled: Moon, 13 sites:
    20 km up to +1,208 m and -348 m (random sites), median ~40 m; 5 km median 5 m, worst -64 m (Copernicus); 1 km <= 1.5 m;
    200 m and below <= 0.3 m. Earth, seven rugged places (Everest, Grand Canyon, Kilimanjaro, Matterhorn, Mauna Kea, Fuji,
    Denali): 20 km 64 to 3,987 m; 5 km 80 to 346 m; 1 km 6 to 46 m; 200 m 3 to 8 m; 50 m <= 0.6 m; 12 m none. Flat places
    (ocean, plain): 0 to 30 m.
  - from one settled stage to the next (a gradual descent with everything loaded): Moon <= 1.5 m below 1 km; Earth: Matterhorn
    +473 m (20 to 5 km) then +109 m (5 to 1 km), Denali +78 m at 1 km, Fuji +38, Mauna Kea -64, Kilimanjaro +26; at 200 m
    <= 14 m; at 50 m <= 1 m.
  - the fallback against the finest settled mesh at the same place: Moon -93 to +193 m, Earth -182 to +178 m.
  - Found by the gentle-drop flake of flight.mjs and game.mjs (the ground under a ship hovering 12 m up moved by +14 to +33 m
    and by -65 and -184 m while it fell on a runner: a fall of over 45 m is over the crash speed, 25.2 and 15.8 m/s).
- **Decision: A, the ship rides with the refinement** (`src/game/GroundRide.ts`, `PlanetTerrain.watch` / `takeRefinement`,
  `Flight.rideGround` / `watchGround`). `Flight.after` sets `terrain.watch` to the body-fixed direction under the ship (its own
  column: the camera is the ship's position, the chase camera's offset is only drawn); `PlanetTerrain` sums what the ground at
  that direction gains or loses across its own `update` (tiles chosen, morphing in, replaced, the first tile replacing the
  coarse fallback) and across each worker message that brings tiles in (`receive`), and never what it gains by the watcher having
  moved; `Flight.before` takes the sum and, for an airborne ship (not landed) within 3 km of the ground, moves it along the
  vertical by as much (at most 1,000 m a frame), its velocity untouched: its height above the ground and speed are what they
  were, so a level of detail is neither a fall nor a crash. A ship the explorer moved (a script, a search pick) is not carried
  for that frame. Landed ships already follow the ground (`place`). Unit tests: tests/groundride.test.ts; flight.mjs section 7b
  (the ground the terrain reports made to rise 800 m over a ship 600 m up falling at 20 m/s, then to sink 800 m, then 300 m,
  each inside the terrain's update: it keeps its height and speed and does not crash; on the build before it crashes at the
  first and jumps 651 m and 147 m at the others).
- **Kept for later, if a slow phone still shows a visible step on arrival: B**, building ahead and not only under the ship:
  want the column at the altitude the ship will have in a few seconds along its velocity (`chainLevel`, PlanetTerrain ~529) and
  give the column under the ship's velocity line the reserved job slot. Fewer refinements, none removed; it does not help a
  teleport. **C** (call a contact a crash only when the column has no job pending) is not needed while A is in.

## Next

0. (27 Nov 2026, after the night's work; the owner's fix list is the order) Waiting on the owner: the
   "release" (the owner's word for: copy the developers' site to the testers'). Answered on 27 Nov:
   the iPhone 13's benchmark (`docs/notes/phone-speed.md`), the developers' site on Cloudflare (yes,
   done), no feedback button (testers report to the owner). Ready to build: God mode on comets, then a black hole of
   your own (#9, `docs/notes/ideas.md`), and the sandbox's next steps (one Create button from
   anywhere; size set by hand). The top chips in plain words (#4) are the rest of "make it simple".
   Investigate first: the offline suite's two-tab step failed in 3 of 8 runs since the Time panel and in
   none before it (docs/notes/testing.md, "offline").
1. Quest performance pass on a real headset (cockpit, planet/galaxy/nebula shaders, tile atlas size,
   black hole steps).
2. Terrain: stream sharper elevation tiles everywhere (the full LOLA/MOLA/ETOPO resolution; today
   only the landmark patches have it), a real cloud layer for Earth; OpenNGC for more deep-sky objects, a sharper galaxy
   impostor from outside.
3. Unity port planning (the data pipeline outputs are engine-agnostic JSON/JPEG).
4. Gravity for real, the owner's plan after step 1 (above): things that break and hit, black holes
   that pull and eat, stars that live and die, deep time, the rest of God mode, a story mode; and
   for step 1 itself the stepping in a Web Worker and the powers in the headset.

## The offline copy (task/offline)

Nothing is installed until a person taps Download in More (`src/platform/offline.ts`, `src/ui/OfflinePanel.ts`, `public/sw.js`). A stopped download keeps its staging cache and Download carries on. **Kill switch:** if `sw.js` ever misbehaves, deploy `public/sw-off.js` under the name `sw.js` (the same folder): browsers fetch `sw.js` afresh, and this worker deletes every `starfarer-offline-*` cache and unregisters itself.

## Checks before every deploy

`npm run typecheck`, `npm test`, then `npm run build` and, with `npx vite preview --port 4173`
running (a build, not the dev server: an edit reloads the page under a running suite), each of
`node scripts/<name>.mjs http://127.0.0.1:4173/ out`:
`start` (the loading screen and the title screen; 34 checks), `touch` (a phone, real multi-touch;
51), `interact` (mouse and keys; 17), `verify` (35 scenes), `exposure` (looking away from bright
things and back, coming up to five black holes and going away again, out of the galaxy, and to Cygnus X-1 slowly; 79), `stars` (the faces
of stars, measured from the frames; 18),
`whatif` (the worked-out facts, a moon made and taken away; 35), `live` (live physics and the
powers, each through the interface on a phone and at a desk, watching a change, Replay and
Undo, upright and sideways, throwing a world and putting a new one in place, a world thrown out of
the Solar System, the Earth dragged sunwards and warming, a world's size, Mars thrown at the Earth, the
path ahead on a phone on its side; 184:
`LIVE_ONLY=watch,jupiter,sun,moon,made,throw,open,warm,size,hit,side,place` picks blocks),
`vr` (IWER Quest 3 emulator; 32), `game` (21), `walk` (45), `places` (rings, comets, eclipses; 16),
`terrain` (15), `flight` (34), `ship` (the ship's looks on a phone; 25), `share` (a scene shared and opened again, on a phone upright and on its side and at a desk: HANDOFF "Save & share"). At most three at a
time on four cores (more
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
   - Seen and left: star radii were estimated without a bolometric correction, so red dwarfs came
     out several times too small (since corrected: `universe/StarRadii.ts`, below); the
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
   - *Playtest round (22 Nov 2026, three new players; the triage in the coordinator's notes)*:
     - *Star radii* (B1): Proxima showed 0.022 solar radii (measured 0.145) and Betelgeuse 270
       (measured 764). The radius came from the visual magnitude alone, and a cool star puts
       most of its light outside the visual band. Now: the bolometric correction of Torres (2010)
       (`universe/StarRadii.ts`: `estimateStarRadius`, its inverse `absMagForRadius` used where a
       magnitude is made from a radius), held at its 3,300 K value below that, and measured radii
       for seven stars, with Proxima's measured temperature (3,042 K; the catalogue's 3,383 K
       comes from a colour that saturates). The card says which ("measured: <source>" or
       "estimated"). `tests/starradii.test.ts`. Not changed: the generated planets' star
       luminosity (`Planets.ts`, its own rough correction) and the V-band luminosity used for
       a real planet's equilibrium temperature where the archive gives none (`Systems.build`).
     - *"Once round the Sun"* (B2): the Earth's said 364.8 days and Pluto's 246.9 years. It was
       worked out from where the body is and how it moves now (the vis-viva equation), which
       swings with every tug: the Moon pulls the Earth to and fro at 12 m/s, half a day of year.
       In the real Solar System it is now the catalogue's mean period (`SolarSystem.meanPeriod`:
       a planet's from JPL's mean elements for the major planets, the Earth's from the Earth-Moon
       barycentre's; a moon's from its JPL mean elements; a small body's by Kepler's third law on
       its catalogued orbit; Pluto, which those elements leave out, from NASA's fact sheet,
       90,560 d), stated with its source; in live physics, or where nothing is catalogued, the
       vis-viva value, its working saying "as it moves now". `tests/worked.test.ts`; `scripts/whatif.mjs` (its year check, now the
       catalogued 365.256 d).
     - *"star · 0.00 light years" on a star's card close by* (B3), while the place chip said
       "5.066 million km": the card wrote a star's (and a galaxy's, a nebula's) distance in light
       years whatever it was. It now uses the chip's words (`distanceText`: km, AU, then light
       years), measured to the star's surface like a world's (`destinations.ts`).
     - *Search* (B4, E6): "proxima" listed the star twice, as the catalogue's star and as the
       host of its planets in the exoplanet archive; a host that is a named star is now listed
       once, as that star, saying "star with 2 known planets" (`Systems.search`,
       `Systems.knownPlanets`). "black" listed fourteen obscure X-ray binaries: every black hole
       matched the word alike, and the ties kept the catalogue's order. The curated holes now
       rank in the order of the Explore list (`HOLES`: Sagittarius A*, M87*, Cygnus X-1, ...),
       and the tour has those three beside Gaia BH1. `scripts/interact.mjs` (15 checks).
     - *Hard-edged darker squares on the Moon's ground* (C1; two players, four places, from
       kilometres up down to 30 m). The rocks' shadow map covers a square round the explorer (two
       cascades, ±13 and ±100 m; ±10 and ±60 on a phone); its contact shading (`rockAoAt`) says -1
       for a point outside both, and `rockShadow` passed that on: the ground shader brightens by
       `1 - 0.4 * ao`, so everything beyond the map was 40 % too bright and the map's square
       looked dark. The contact term is now never below 0 (`Materials.ts`). The ground beyond is
       as bright as within. `scripts/terrain.mjs` checks that the rocks only darken the ground
       (15 checks).
     - *"Earth, to scale" read as a hole in Jupiter, not as the Earth* (C4). It was drawn as a
       plain blue-grey ball (`ScaleCues`, one colour for oceans and clouds). It now wears the
       Earth's own day map and cloud map, the same textures the Earth itself is drawn with
       (`BodiesLayer.surfaceMap`), with the clouds as the Earth's light path draws them; the
       blue-grey stays until those have loaded. No blue air over it: a Rayleigh tint was tried,
       but it was code of its own, not the Earth's, so it was left out; the oceans are as dark as
       the map makes them. "It doesn't follow a dragged Jupiter" was not seen: with Jupiter moved
       by three of its radii (live physics), the camera, which follows it, kept it in the same
       place on screen and the Earth stayed on it. `scripts/interact.mjs` (16 checks).
     - *The small ones* (D1 to D5):
       - The keyboard's shortcuts did nothing once the Mass slider had been clicked: the slider
         stopped every key on its way to the app, not only its own. Now only the keys that move
         a slider (arrows, Home, End, Page Up and Down) are its own (`Hud`, `SLIDER_KEYS`).
       - A body's Details opened where the last body's had been scrolled to (the Moon's with its
         Distance out of sight): the list keeps its scroll while hidden. It opens at its top for
         each new selection (`Hud.renderCard`).
       - Numbers: a result from a thousand to a billion is written whole with its thousands
         marked ("57,200 km", "1,471,000 km", where the card had "57200 km" and "1.471e6 km";
         `physics.shown`, used by the results, the workings keep `num`), and a world's three radii
         as its mean radius ("6,378.1 × 6,378.1 × 6,356.8"; whole km above 10,000 km).
       - The news of bodies set free (the Sun made as light as Jupiter): "Jupiter is flying free"
         was told five times and "The Sun is flying free" three, as the family gathered small bodies
         on its way, and "So is 2 smaller bodies". Each body is told once (again only after it goes
         round something again), the verb agrees with the count, and up to five worlds are named
         before "others". The first news names six worlds, not eight planets: those already moving
         away; the inner planets, moving inwards at that moment, are told 67 days later, as they
         turn outward (`LivePhysics.hear`). `tests/freednews.test.ts`.
       - "Save a picture" closes the sheet and says, for 4 s, "Picture saved to your downloads"
         with the file's name (before, the sheet stayed open over the view and a 2.2 s "Screenshot
         saved" was easily missed).
       `tests/numbers.test.ts`; `scripts/interact.mjs` (17 checks); `scripts/touch.mjs` (51).
     - *The Milky Way's glow on the way out (1 to 15 kpc) changed in steps every six frames, and
       now and then went to a white wash* (trailer v3's frame scan). Two causes. Each new map of
       the glow was shown at once (a step of about ten levels on the frame where it came in,
       against two or three between). And a sight line through the bulge's very middle could sum
       past the largest number the map's half floats hold (65,504): that texel was infinity, the
       sky's mapping of it NaN, and the bloom spread it over the whole frame until the next map
       (the maps from 3.2 and 7.8 kpc on the way out, among others). The ray march's light is now
       held below that (`shaders/galaxy.ts`), the sky takes a texel that is not a finite number for
       no light at all, so none can reach the bloom (`Sky.ts`), and it shows the last two maps blended, going
       over from one to the next in the six frames the next takes to draw (`GalaxyGlow.prev`,
       `blend`; `Sky.updateWith`). A third cube map for it: 17 MB of the GPU's memory more (4 MB
       in a headset); one more cube lookup a sky pixel. Not changed: the glow is soft from 2 to 6
       kpc out, where the cube map (512 px faces, a fifth of a degree a texel, three CSS pixels on
       a phone) is all there is of it; farther out the galaxy is drawn per pixel. Finer faces
       would cost four times the drawing and the memory. `tests/galaxyglow.test.ts`;
       `scripts/exposure.mjs` (scene `glow-out`; 78 checks).
     - *Walking on the Moon, star names stood on the ground* (Polaris and Scheat on the ground and
       Alderamin on the horizon, at the Apollo 17 site, on a sideways phone). Not the mean sphere:
       the ground's occluder already had the radius of the ground under the walker. Its test let a
       world's limb off by a quarter of a percent of its radius (`radius² × 0.995`, so that names
       just over a limb stay), which on the Moon is 4.3 km: names down to some 4 degrees under the
       horizon stood. And the valley's walls, the massifs round Taurus-Littrow, hid nothing: the
       sphere through the ground under the walker is flat country. Low over the landing terrain
       (under 2 km), a name is now hidden where the ground really stands along its bearing
       (`PlanetTerrain.horizonAt`: the ground followed out 48 steps from 2 m to past where the
       horizon would be over ground 10 km lower, the water where there is water; kept by bearing,
       a degree wide, until the walker has moved 5 m), with a tenth of a degree of leeway, and no
       limb allowance for the ground (`App.occluded`). From a summit the land falls away, and the
       names over it stay. `scripts/interact.mjs`: walking at the Apollo 17 site, in Valles
       Marineris and on Everest, each star's line of sight followed over the ground: no name over
       the ground, none lost over the sky, and at the Apollo 17 site names just over the massifs.
     - *Cygnus X-1: the frame darkened in a few frames on the way in* (the trailer's
       frame-to-frame scan: at about 105 horizon radii; here at about 120, on a phone's screen,
       25 degrees above the disk: 16 % darker in one frame, 60 % in four). The eye "settles" on
       the bright thing that covers most of the frame (`settle` in `App.updateExposure`), by its
       weight (a smoothstep of its cover). That was an interpolation in the logarithm, from the
       exposure with nothing there to the thing's key: for a disk a thousand million times
       brighter than the dark the last few hundredths of the weight moved the eye by e-folds, all
       at once as the disk's middle grew past a twelfth of the frame. Now the eye follows the
       frame's mean light, the thing's share of it and the dark's (`Exposure.settleOn`): the same
       at both ends, smooth between. Only for a black hole's disk: for a star's face (Cygnus X-1's
       supergiant coming into the frame's edge on the far approach) the mean light took the eye
       over at a hundredth of the frame, and the hole's light leapt 3.6 times in a frame; there the
       eye still goes over in the logarithm. `scripts/exposure.mjs` comes up to Cygnus X-1 slowly, 1.5 %
       a frame from 160 radii to 80 ("cygnus-slow"): x1.18 in a frame before, x1.02 now.
       The other report, a step in the glow behind the hole across the vertical line through it
       (seen from beside the star, 5,000 to 66,000 radii), was not reproduced on this build: read
       before the tone curve along whole rows, the background there is a smooth, steep gradient
       (the star's light, two and a half times across 90 px); the jet's line lies on it and makes
       it look like a step. With the jets switched off the rows are smooth.
     - *Distances from poor parallaxes* (#44): far off, a parallax is a fraction of a
       milliarcsecond, about its error, and the distance from it is a guess; the catalogue's card
       stated it, and the luminosity and size worked out from it, as fact (the Garnet Star, mu Cep,
       8,402 pc from a Gaia parallax of 0.119 ± 0.264 mas: it is about a tenth as far, and was
       shown at absolute magnitude -10.4). Each AT-HYG star is now graded by the
       parallax its distance came from (AT-HYG's `dist_src`; Gaia DR3, or DR2, numbers from the
       Gaia archive): good (the parallax at least five times its error) 2,507,264; poor 20,860;
       Hipparcos only, beyond 500 pc, 84; not graded 4,330 (Hipparcos within 500 pc, Gliese, the
       rest, and 220 the build could not match). No distance is changed. A poor one's card says
       "distance uncertain (parallax x ± y mas)", its absolute magnitude, luminosity and estimated
       radius "uncertain: from its distance", and its subtitle "(uncertain)"
       (`CatalogStar.distanceGrade`, `StarCatalog.distanceGrade`). The grades are Gaia's numbers,
       so they are kept apart under Gaia's licence in `public/data/stars-quality/` (a file a node,
       2 bits a star and 4 bytes a poor star: 0.72 MB), fetched when a star is chosen, and not used
       with `?gaia=0`. Not done: the Hipparcos stars' own parallax errors (VizieR, I/311, refuses
       this machine, as SIMBAD does); and, a separate decision since it would move stars, Bailer-
       Jones's geometric distances (Gaia archive, `external.gaiaedr3_distance`) as a better
       estimate for the poor ones. `tests/distancegrade.test.ts`; `scripts/interact.mjs`.
     - *A budget for the worlds' maps* (after the memory soak): every world visited kept all its
       full maps on the GPU for good (each 4,096 x 2,048 colour, relief or night map some 43 MB
       with its mip levels), so memory grew with the number of worlds seen, not with time: on a
       phone (390 x 844 at 3x) a tour of twelve worlds took the GPU process from 866 to 1,458 MB,
       with 21 big maps resident at the end. Now each map has a small copy, 1,024 x 512
       (`pipeline/build_small_maps.py`, 30 maps, 4.07 MB), which a world keeps for good and is
       drawn with from afar; its full maps are loaded once it is 128 px in radius on screen (half
       the small map's width then spans the disc), the small ones shown meanwhile, and let go
       10 s after it last was; and never more than 3 worlds' full maps at once, the one wanted
       longest ago going first (`Bodies.wantFull`, `releaseFull`, `FULL_*`). The same tour now:
       the GPU process 613 to 768 MB, at most 4 big maps resident (the Earth's day, night, clouds
       and relief); the full map drawn 0.7 to 3.1 s after arrival (the Earth's, with its four
       maps, 8.9 s), and the first world sharp again on coming back (1.0 s). `scripts/places.mjs`
       checks the cap, the small map left behind and the full one on return. The 8k tier
       (`hi`) works as before. Not changed, measured for a decision: the render targets at a
       phone's pixel ratio 3 are some 111 MB (the HDR target 1,170 x 2,532, half floats, 2
       samples: 90 MB; bloom 8 MB; the volume pass 13 MB), at pixel ratio 2 some 79 MB (the HDR
       target 780 x 1,688 with 4 samples, 70 MB; bloom 3 MB; volume 6 MB). Decided: pixel ratio
       3 stays for now (the 32 MB saved is not worth the sharpness); to be looked at again only if
       phones still lose the tab.
       A flight's destination keeps its full maps on the way (`Bodies.keepWanted`, from
       `App.frame` for the camera's flight and the ship's autopilot): they were wanted at takeoff
       only, so a flight of more than 10 s let them go before it came, and on a phone the Earth
       was drawn close up with its small copies while its four maps came again: from the Moon,
       22.9 s of the approach and 7.9 s after arrival; from Mars 9.9 s. Now they come in some 10 s
       into the flight and stay: sharp on arrival, no time on the small copies, both ways.
       `scripts/places.mjs` 10b flies Mars to the Earth and checks it.
     - *The stars out at night in a valley* (interact's "walking at Apollo 17" failing on GitHub's
       runners, the same numbers every run): at night at the Apollo 17 site, 2.6 km under the
       Moon's mean radius, with the view turned to where the Sun is (7.9 degrees under the
       horizon), the stars went out: a magnitude limit of -16 against 7.2 facing away. A world in
       front of a sun is a ball of its mean radius (`Exposure.hidden`), and from an eye inside
       that ball it was counted as hiding nothing, so the Sun was in sight through the ground;
       which way the walker faced came from the checks before, towards the Sun on the runners.
       From inside the ball the world now hides everything under the eye's level, as it does from
       its surface. The same counts a world's night side as dark from a valley
       (`App.updateExposure`'s `night`). `tests/exposure.test.ts`; `scripts/interact.mjs` turns
       the walker to the Sun's bearing and away.
     - *Temperatures of hot and reddened stars* (#49): a catalogue star's temperature was from its
       B-V alone (Ballesteros 2012), which hardly changes above about 10,000 K and is reddened by
       dust: Alnitak (O9.5 Ib) 13,561 K, Mintaka 13,011, Naos 15,515, Spica 14,492, Cygnus X-1's
       star (B0 Ib, behind a magnitude of reddening) 5,501 K. Now (`pipeline/build_star_teff.py`)
       an O or B star takes its spectral type's temperature from a published scale, the card
       naming it: Pecaut & Mamajek 2013 (Mamajek's online table) for dwarfs and stars with no
       class, Martins, Schaerer & Hillier 2005 for O giants (II taken as III) and supergiants,
       Crowther, Lennon & Walborn 2006 for supergiants from O9.7 to B3, and the dwarfs' scale,
       said so, for the classes those leave out (B giants, B supergiants after B3: Rigel). A type
       is checked against the colour (the colour's own type on Mamajek's sequence): more than a
       class bluer than its type cannot be dust, and is flagged and not used (Bunda); more than a
       class redder is dust for an O or B star unless it is over 1.5 mag brighter than its type
       allows (Almach, carrying its companion's B8V: flagged), and for an A-M dwarf if its
       brightness fits its type dimmed by that dust (R_V 3.1); an A-M giant's colour is kept and
       its type said to be redder ("dust, or a wrong type": the Garnet Star's G5 Ib); a composite
       spectrum's type off its colour is flagged (Dubhe). A reddened star's E(B-V) is on its card
       and its radius is worked out from its brightness before the dust. The drawn colour follows
       (the tiles' temperature byte; 26,535 stars changed). Gaia DR3's ESP-HS temperatures are
       used, with Gaia's data only (`public/data/stars-teff-gaia/`, CC BY-NC, off with `?gaia=0`,
       patched into a node's tile as it loads), for 97,094 stars ESP-HS is sure are O or B
       (`flags_esphs` second digit 1 or 2) with no type of their own or one their colour does not
       bear out; against the spectral-type temperatures of 19,569 others: median ratio 1.002, 85 %
       within 20 %. Sources decided with the coordinator: O and B giants and supergiants from the
       two papers' TeX sources on arXiv (option 1; the raw files deleted); no new source for A-M
       giants and supergiants for now (possible later: Alonso et al. 1999 for FGK giants,
       Schmidt-Kaler 1982, Landolt-Börnstein VI/2b); Gaia's teff_esphs as a cross-check and for the
       reddened hot stars it measured. Not used: GSP-Phot's temperatures (Cygnus X-1's star has
       32,499 K there but no ESP-HS value). The late M dwarfs' colour still saturates (about
       3,170 K at the least); Proxima's measured temperature stands. `tests/startemp.test.ts`;
       `scripts/interact.mjs` (Alnitak, Spica, Cygnus X-1's star, Almach, the Garnet Star).
7. **Touch for the rest** (carried over from part 2): free flight (a thumb-stick), landing and
   walking, missions and the benchmark as screens of the app. Done: the ship on a phone (its
   instruments at a glance with the full read-out a tap away, the Time chip and sheet telling its
   own warp, and flying it by hand: drag to steer, a throttle lever, Stop; see "The relativistic
   ship"). Not on touch yet in the ship: the SAS's modes (prograde and the rest), the RCS.
   From the first playtests (Part C1): a ship button over the card ("Your ship", or "Fly there in
   your ship" with something selected: boards, sets the reactionless drive as strong as the trip
   needs, `Flight.driveFor`, and starts the autopilot); More starts with How to move, the Missions
   (folded list with the count) and the Start menu (`App.openMenu`, set by main.ts); Back to today
   in the Time sheet when the date is a day or more off (in the ship the ship goes with the world
   it was near: `Flight.carryToNow`); a flight to a place on a surface runs in real time (said so);
   leaving the ship brings time back to real time; the drag button says what dragging does now;
   the ship's read-out in plainer words ("there in 12 d for you · 2.28 million yr outside"; why a
   torch trip takes 130,000 years and what to do); time aboard held back is said once, with why,
   and the chip says "held"; messages show under the instruments; the orbit's tags are drawn at
   the names' size across the view and, like the target's brackets, never under the interface.
   The cockpit, the ship and their art: the ship-look work (HANDOFF "The ship's looks").
   Part C2: walking on touch (`Walk.ts`: a Land and walk button over walkable ground, then a stick
   under the left thumb, look by drag, Jump and Fly; the Apollo 17 walk on the tour on touch too);
   night at a place on arrival (`Daylight.ts`: the Sun's height and the next sunrise from the
   world's spin and its drift round its sun; a notice with Skip to sunrise, which moves the clock
   to the Sun 6° up; not in live physics nor in the ship) and the tour's places arrived at in
   daylight (`App.toDaylight`). Free flight on touch followed (see "Free flight by touch" below). Upright, the dock stops
   below the chips (and the live mark), the round buttons step aside while a card's details are
   read, and flight.mjs checks the explorer's parts never lie on each other on ten phone sizes.
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
