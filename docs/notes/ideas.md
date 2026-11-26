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
