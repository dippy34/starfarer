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

## Sizes of made worlds from a published mass-radius relation (done 27 Nov 2026, the fix list's #13)

Today a made world's size follows its mass by rules decided here (`madeSize` in `src/app/WhatIf.ts`:
the Earth's density for rock, then a straight line in the logarithm up to Jupiter's size), and an ice
giant of Uranus's 14.5 Earths comes out 2.8 Earth radii where Uranus measures 4.0. A published
relation would do better: Chen & Kipping 2017, "Probabilistic Forecasting of the Masses and Radii of
Other Worlds", ApJ 834, 17 (arXiv 1603.08614), Table 1, read from the paper itself:
log10(R/R⊕) = C + S·log10(M/M⊕) in pieces, each piece meeting the next at the break (their eq. 5-6),
with 10^C = 1.008 (+0.046/-0.045) R⊕ for the first; slopes S = 0.2790 (+0.0092/-0.0094) for Terran
worlds, 0.589 (+0.044/-0.031) Neptunian, -0.044 (+0.017/-0.019) Jovian, 0.881 (+0.025/-0.024)
stellar; breaks at 2.04 (+0.66/-0.59) M⊕, 0.414 (+0.057/-0.065) MJ and 0.0800 (+0.0081/-0.0072) M☉;
scatter in radius 4.03 %, 14.6 %, 7.37 % and 4.43 % (their medians; Table 1 prints the second and
third breaks' symbols with M⊕ by mistake, its unit column and §4.4-4.5 say MJ and M☉).

Checked here against the planets (NASA's fact sheet radii): Earth +0.8 %, Venus +0.2 %, Mars +1.6 %,
Uranus -1.8 %, Neptune +11.5 % (inside its 14.6 %), but Saturn +29 % and Jupiter +26 %: the giants it
was fitted on are mostly hot and puffed up. So, by kind:
- the rocky kinds (rocky, ocean, desert, lava; a planet like the Earth): the Terran piece, 1.008 R⊕ ×
  (M/M⊕)^0.2790, also above 2.04 M⊕, because the kind says rock (5 Earths: 1.58 R⊕, where today's rule
  says 1.71 and the relation by mass alone, which would take it for a small Neptune, 2.09);
- an ice giant: the Terran piece to 2.04 M⊕, then the Neptunian one (Uranus's mass: 3.91 R⊕);
- a gas giant: keep Jupiter's size from 0.3 Jupiters (the relation's own Jovian piece gives 1.25 of
  Jupiter's radius at Jupiter's mass);
- an icy world: keep the ball of ice and rock (the paper has no class for it).
The card's working (`madeWorking`) names the paper and the piece used. Built so (`TERRAN_SLOPE`,
`NEPTUNIAN_SLOPE` in `src/app/WhatIf.ts`), through the Earth's own size rather than their 1.008 (it
lies within their constant's range), so that a rocky world of the Earth's mass is the Earth's size;
with that, Uranus's mass gives 3.87 R⊕ (it measures 3.98) and Neptune's 4.28 (3.87).

## God mode on more things: comets and black holes (the fix list's #9; planned 27 Nov 2026)

Today the card says why not: comets and belt asteroids "stay on their recorded paths", and "live
physics does not take black holes yet" (`src/app/powersFor.ts`). A plan, smallest first:

1. *Comets in live physics.* (*27 Nov, evening:* Remove works on a comet, with Undo and Back to reality;
   moving and throwing one, and keeping it in saves and links, are still to do: TASKS.md task/comet-powers.)
   A comet (`Comet` in `src/render/SmallBodies.ts`, drawn from its orbital
   elements) joins the simulation when it is changed: its place and speed from its elements at that
   date, as a body of no mass (it is pulled, it pulls nothing). Then Move, Throw and Remove work on it
   as on a moon, and its tail follows the Sun from where it is. Mass only where one was measured (a
   handful, from spacecraft); none is made up.
2. *A black hole of your own.* Add round the Sun offers "A black hole" (from 1 to 20 Suns' mass):
   it pulls everything in live physics, and it is drawn with the black hole renderer (its shadow,
   and the bent sky round it). The renderer (`src/render/BlackHoleLayer.ts`) takes the catalogue's
   holes when the app starts; it would take made ones too.
3. *The catalogue's black holes:* Mass changes the size of the shadow and of the disk (both grow
   with the mass); nothing near them is simulated, so that is all a change does there.

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
   *Done 27 Nov 2026 (night):* round a star, Add makes seven worlds of your own (rocky, ocean,
   desert, lava, icy, gas giant, ice giant), each drawn with a generated look of its own; while one is
   put in place: its mass, New look, Add rings, and a Colour slider; saves and links keep all of it
   (HANDOFF.md, "Make anything, step 1"). *Being built:* a name of your own (TASKS.md task/name-it).
   *Still to do:* one Create button from anywhere; a star or a black hole of your own; size set by hand;
   placing with a tap. *Seen on the live site (27 Nov, a phone 390 wide):* while a world is put in
   place, the card holds its mass, Name, New look and Add rings, Colour and three lines of help, and
   covers half the view: the help could fold away once read, or the look's controls share a row.
   *Done the same evening:* a picture of the world, drawn with its own shaders, beside New look, rings
   and Colour (framed with its orbit it is a dot, so that is where its look is seen); Look at and
   Share hide while it is made; the help is a sentence shorter. The card's panel no longer scrolls on
   an iPhone; it is still about 59 % of a 390 x 844 screen (HANDOFF "A picture of it while it is made").
   When a copy keeps its size rule, a copy of the Earth at the Earth's mass must stay the Earth's size.
2. *Change anything.* Every world, real or made, gets one sheet of all its numbers to change (mass,
   size, spin, look, temperature, rings, its orbit), with "As it really is" to put it back.
3. *An empty universe.* "New universe" on the title screen: empty space, stars far off, nothing else;
   build a system from nothing, save it and share it (the saves and links there are). This is where the
   owner's "multiple universes" (above) begins: "My universes", each with its own name.
4. *Wilder physics* (later): breaking and hitting (God mode wave 2: Roche rings, fragments), and dials
   for the laws themselves (gravity's strength, time's direction).

Presets stay, as starting points.
