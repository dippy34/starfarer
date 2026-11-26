# Works everywhere: audit and plan (25 Nov 2026)

The owner asked for "general outer space ... consistent code ... God mode to work everywhere ...
general reliability across everything". This is the audit of where the app stands, and the plan.
It was measured on the build of `claude/friendly-hypatia-up418z` at 4107797, with headless
Chromium and software GL at 390x844 touch (about 3 to 5 fps, so timings are slow; no real phone or
GPU was used).

## Headline

- The physics core is already general: `src/sim/NBody.ts` says "two suns, a black hole and its
  companion are all the same to it". The layer around it is not.
- Powers are offered only when the selection is a Solar System `Body`. The gate is `App.ts`
  `if (sel instanceof Body && sel.valid)`, Add is `canAdd(Body)`, and the card hides the whole
  powers row (`Hud.ts`, `powers.hidden = !sel.mass && !sel.removable`) with no explanation.
- In a sweep of 22 places there were no console errors, "Go there" arrived everywhere, and every
  Solar System power worked with Undo. No power was offered anywhere outside the Solar System.
- Live physics is one global Solar System switch: its mark stays on after flying to another star.

## Support matrix

"S" means seen working in the sweep; "C" means read in the code but not driven.

Updated 25 Nov 2026 for step 4's first part (live physics for the planets of other stars,
`src/universe/PlanetarySim.ts`): "L" means checked in `scripts/live.mjs` block `exo` and
`scripts/everywhere.mjs`; "U" in unit tests (`tests/exolive.test.ts`). "Other star" there means a
star with planets (real or generated) and its own powers; a star without planets still has none.

| Power | Solar System body | Sun | real exoplanet | generated planet | other star | black hole | comet / belt asteroid | galaxy / nebula |
|---|---|---|---|---|---|---|---|---|
| Move | yes (S) | yes (S) | yes (L) | yes (L) | its star: yes (L) | no | no | no |
| Throw | yes (C) | yes (C) | yes (C) | yes (C) | its star: yes (C) | no | no | no |
| Mass | yes (S) | yes (S) | yes (L, U) | yes, marked generated (L) | its star: yes, marked as known (L) | no | no | no |
| Size | yes where the radius is measured (S) | no, by design | measured in transit only (L) | no: generated | no, by design | no | no | no |
| Add | a moon for planets and dwarfs only (S) | yes (S) | no, "round the Sun only" | no | no | no | no | no |
| Remove | yes (S) | yes (S) | yes (U) | yes (C) | its star: yes (C) | no | no | no |
| Undo, Back to reality | yes (S) | yes (S) | yes (L, U) | yes (U) | yes (C) | n/a | n/a | n/a |
| Watch, Replay, Impacts, future path | yes (S/C) | yes (C) | yes (seen in the owner's pictures; C) | yes (C) | yes (C) | no | no | no |
| Live temperature | bodies with a measured Bond albedo (C) | n/a | no | no | no | no | no | no |
| Share the view | yes (S) | yes (S) | yes (fixed, share.mjs) | yes (fixed, share.mjs) | yes (S) | yes (S) | yes (S) | yes (S) |
| Share a changed universe | yes (C) | yes (C) | no | no | no | no | no | no |

Why each "no": exoplanets (`ExoPlanet`) are not `Body` objects and move on Kepler rails with no
simulation state; other stars (`CatalogStar`) have no mass field; black holes have a real mass but
nothing builds a simulation with one, because `capture()` takes a `SolarSystem`
(`LivePhysics.ts`); comets and belt asteroids are not bodies; galaxies and nebulae have no mass
data at all.

## Defects found

1. **A shared link to a planet of another star reopened far away**, looking at empty sky: TRAPPIST-1
   e reopened 75x too far, 51 Peg b 15x, a generated planet 3,700x. Fixed. Cause, measured: the
   planet was found (and its system brought to a date) before `App.openScene` set the clock to the
   link's date, and a system is brought to the date only while it is in view, so the camera was
   put at the planet's place at the date of the page that opened the link. The first frame then
   moved the planet to the link's date, and `chooseAnchor` let the camera go (the planet had no
   view yet, so the camera was not "in its Hill sphere"), leaving it where the planet had been.
   Now `openScene` brings the system of the planet the link names (selected or at) to the link's
   date before the camera is set from it, and `chooseAnchor` keeps a planet the camera already
   rides with while it is within its Hill sphere. One path for every planetary system, real or
   generated. Checked in `scripts/share.mjs` (block `exo`).
2. **Search misses names people type:** "Alpha Centauri", "Alpha Cen", "Tau Ceti", "Eta Carinae",
   "HIP 9520", and generated planets such as "Vega b". "Sol" finds Solaris, not the Sun, and "ISS"
   finds Meissa and Larissa, not the space station.
3. **Picking:** the Milky Way can't be tapped at its centre, and tapping Andromeda's centre selects
   M32.
4. **Speed:** nebula and galaxy views ran 4 to 7 times slower than a star view (software GL only;
   to be measured on a phone).

## Special cases a general design replaces

- 56 `instanceof Body` uses (App.ts 25, Flight.ts 10, Walk.ts 5, Missions.ts 4, others).
- Share links and saved worlds key things by NAIF number (`SceneLink.ts`, `SceneWorld.ts`).
- One Sun assumed: `system.sun` in `Mover.ts`, `App.ts` (lighting, ambient colour, craft and comet
  tails), the ship's lamp.
- Solar System constants in `WhatIf.ts`: frost line 3 AU, nearest planet 0.1 AU, nearest sun
  0.3 AU, farthest 60 AU. These are wrong around a red dwarf such as TRAPPIST-1, whose planets sit
  at 0.01 to 0.06 AU.
- Looks chosen by name (`Body.ts` `isAirless`, `isGasGiant`; `oceans: name === 'Earth'`), which
  misbehave on any world with another name.
- `Powers.ts` is good news: pure arithmetic with no Solar System types, reusable as it is.

## Plan

Principle: one object model, one set of powers, physics fitted to each kind of object, and a
plain sentence where a power can't apply.

| Step | What | Who |
|---|---|---|
| 0 | A permanent "everywhere" browser test: a fixed table of places across space, the same checks at each (TASKS.md `task/everywhere-sweep`) | cheap model; Claude reviews the expectations |
| 1 | Quick fixes: the exoplanet share link (Claude); search names (TASKS.md `task/search-names`); galaxy picking (TASKS.md `task/galaxy-picking`) | mixed |
| 2 | One capability table, `powersFor(obj)`: the same buttons on every kind of object, disabled with a one-line reason instead of hidden (after the design lead's card lands) | cheap model; Claude reviews the wording |
| 3 | A shared object model for exoplanets and stars; string keys instead of NAIF numbers in links and saves (a v2 format that still opens v1 links) | Claude |
| 4 | Live physics for any planetary system (`SimSource`: the Solar System, Kepler systems from the archive, black holes) | Claude, the hardest part |
| 5 | Stars as touchable things; temperature from every sun | Claude, cheap model for card text |
| 6 | Black holes and their companions | Claude |
| 7 | Comets and belt asteroids as massless bodies | Claude designs, cheap model wires |
| 8 | Galaxies and nebulae: a clear message first; real masses only through the data pipeline | Claude |
| 9 | Replace name-based looks with data fields | cheap model with tests |

Real data only throughout: the exoplanet archive has masses with an "estimated" marker; galaxies
and nebulae have no masses, so no Mass power for them until sourced data exists.
