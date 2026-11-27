# Ideas for later

The owner's ideas that are not planned yet, in their words, with a first thought on where each
could start. An idea moves to `TASKS.md` (or a plan) once the owner wants it made.

## Multiple universes (26 Nov 2026)

The owner: "I also was thinking about the idea of creating multiple universes, but that's going to
be for later, even if I'm going to make it."

Where it could start: a saved scene already holds a whole changed universe (live physics, the
worlds made and taken away: `src/app/Saves.ts`, `src/app/SceneWorld.ts`). A "My universes" list
could grow from that: universes with names, each keeping its own changes, opened and switched
between; later perhaps ones with different laws (gravity's strength, the speed of light).

## Scenes like the film's black hole (26 Nov 2026)

The owner: "Would it be possible to create scenes equivalently to like the interstellar black hole
scene". The physics is in the app already: black holes are ray traced (`src/render/shaders/blackhole.ts`:
the lensed sky, the thin disk bent round the shadow, its Doppler beaming and redshift); Cygnus X-1
shows it (`scripts/verify.mjs` shot 13). Three pieces would make that kind of shot:

1. *Scenes, one tap away* (small): a list in Explore of views made like a share link (camera, time,
   what is selected), such as beside a black hole just above its disk's plane (the disk's far side
   arching over and under the shadow), inside Saturn's rings, Earthrise from the Moon.
2. *A black hole of one's own* (medium, god mode): Add a black hole, marked made-up, with a cooler,
   calmer disk of golden light. The catalogue's holes keep their measured disks (an X-ray binary's is
   millions of degrees, blue-white): no data is changed to look like a film.
3. *Spin* (hard, later): the film's hole spins near the limit, which flattens one side of the
   shadow; ours is a non-spinning (Schwarzschild) hole. Kerr geodesics in a phone's shader.

## God mode as a sandbox (27 Nov 2026)

The owner, after testing God mode on a phone: "God mode feels more like you're editing something or
adding some preset things instead of actually unlocking your full potential and like feeling like
you're adding whatever you want and creating infinite amount of different possibilities."

Today Add makes four kinds only (`src/app/WhatIf.ts`: a moon for a planet; a copy of the Earth, of
Jupiter or of the Sun for a star), each with a mass slider; the powers are mass, size, move (throw,
place), add and remove (`src/app/powersFor.ts`). Claude's plan, one step at a time, each tested before
it goes live (the watch button, task/watch-button, and the camera that rides with what it turns round
come first):

1. *Make anything.* One Create button, from anywhere, not only from a selected world's card: a rocky
   world, an icy world, a gas giant, a star or a black hole, then sliders over the whole range: mass
   (from a pebble to a monster black hole), size (following the mass by its rule until it is set by
   hand), its look (rock, desert, ocean, ice, lava, gas bands; a hue), a star's temperature (its colour
   from it), rings, a name. Placed with a tap, thrown by a drag (the slingshot there is), or put on a
   circle round anything. What is made keeps saying that it was made, as now; no catalogue data is
   ever changed to look like it.
2. *Change anything.* Every world, real or made, gets one sheet of all its numbers to change (mass,
   size, spin, look, temperature, rings, its orbit), with "As it really is" to put it back.
3. *An empty universe.* "New universe" on the title screen: empty space, stars far off, nothing else;
   build a system from nothing, save it and share it (the saves and links there are). This is where the
   owner's "multiple universes" (above) begins: "My universes", each with its own name.
4. *Wilder physics* (later): breaking and hitting (God mode wave 2: Roche rings, fragments), and dials
   for the laws themselves (gravity's strength, time's direction).

Presets stay, as starting points.
