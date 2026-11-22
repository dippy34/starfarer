# The gravity engine

`src/sim/NBody.ts` steps a system of bodies in which each pulls on every other;
`src/sim/KeplerDrift.ts` is the exact two-body motion it is built on; `src/sim/SystemSim.ts`
starts it from the app's bodies at a date and puts the bodies where it has taken them. This note
says how it works and why, what it leaves out, what was measured, and how to use it. The tests
are the proof: `tests/nbody.test.ts` (19, made-up systems), `tests/keplerdrift.test.ts` (4) and
`tests/systemsim.test.ts` (12, the real Solar System from the repo's own catalogue and
ephemeris). Every number below is one a test prints or checks; run
`npx vitest run tests/systemsim.test.ts` to see them again.

## The scheme, and why

A planetary system is orbits inside orbits: a moon's month inside its planet's year inside
thousands of years. Stepping every body with one small step in plain coordinates would spend
nearly all of its work, and nearly all of its error, on re-deriving ellipses that are known
exactly. So the engine never approximates an orbit, only what disturbs it.

* **A hierarchy of pairs.** The bodies with a mass are arranged in a tree: a moon and its planet
  are a pair, that pair and the next moon out are a pair, a planet's whole family and the Sun's
  inner worlds, and so on up to the one pair that is the whole system (generalised Jacobi
  coordinates). The system's energy is then exactly one two-body orbit per pair, each cluster
  moving as a point at its centre of mass, plus a remainder: everything the pairs do not account
  for.
* **A step** is the exact two-body motion of every pair (`keplerDrift`: universal variables, one
  formulation for ellipses, parabolas and hyperbolas, Newton's method kept inside a bracket) and
  a kick by the remainder. This is the mapping of Wisdom and Holman (1991) on the hierarchy of
  Beust (2003), with the third-order corrector of Wisdom, Holman and Touma (1996) applied where
  a run of equal steps begins and ends and wherever the state is read out. It is symplectic and
  reversible. Its error is the remainder times the step to the fourth power plus the remainder
  squared times the step squared, so a quiet system costs 16 steps per turn of its fastest
  stepped orbit (`steps`) and keeps its energy to parts in 10¹² for thousands of years.
* **The hierarchy is found, not given.** Clusters are joined by the measure of Laplace's sphere
  of influence, r⁵ / (G(m₁ + m₂))², whatever the bodies are: nothing is tied to the Solar
  System. It is looked at again every 256 steps, whenever two bodies come near, and whenever a
  pair grows looser than the pair holding it, and it changes only for a pairing that is better
  by a clear margin (`STICK`), so it does not flicker. A close encounter becomes one exact
  hyperbola, a capture one exact ellipse.
* **The step** follows the pace of the quickest stepped orbit (at its periapsis; for
  eccentricities over 0.5 and open orbits it follows the body in and out), shortens when two
  bodies are about to touch, and shortens in an encounter as the remainders begin to change fast
  (`VARY`), from well before the bodies are close: energy crosses a change of hierarchy without
  a jump.
* **Bodies without a mass** (a small moon, an asteroid nobody has weighed) are pulled and do not
  pull. Each goes round the cluster whose sphere of influence it is in, on steps of its own: the
  common step times a power of two, as long as its orbit allows.
* **Rails**, when asked for (`railsBelow`, or `fit` for a rate of time): a family whose orbits
  are all shorter than the limit, that is small inside its Hill sphere and that nothing is near,
  moves as one mass, and its members keep their two-body orbits inside it. It comes off the
  rails by itself when something approaches. The default is 0: everything pulls on everything.
  A body can ask that what goes round it is never carried (`stepped`: a star); the bodies without
  a mass have a limit of their own (`lightRailsBelow`); and which members may cross each other's
  orbits on rails is a share of the family's mass (`railsCross`: a hundred-thousandth unless set).
* **Reading out.** Between steps, `read()` gives the state at exactly the time asked for: each
  pair along its orbit from the true state half a step before, plus the departure from that
  orbit that the true state half a step after shows, as a cubic in time. Nothing jumps from one
  frame to the next, and reading disturbs nothing.
* **Time.** `advance(dt, budgetMs)` moves on by `dt`, or by as much of it as fits in the budget
  (at least one step), and returns what it moved: a caller that adds up what comes back never
  loses or repeats time, and where the bodies are at a time does not depend on how the way there
  was cut up. `dt` may be negative.

Everything is plain numbers and typed arrays in SI units, nothing is allocated per step, and
`snapshot()` / `NBody.restore()` copy the whole of it: it can run in a Web Worker and be saved.

## What is approximate

Always (the engine's `LEFT_OUT` says these in plain words, for the app to show as they are):

* Bodies are points, but for the equatorial bulge (J₂) of the planets given one (Earth, Mars,
  Jupiter, Saturn, Uranus, Neptune: the values and their sources are in `SystemSim.ts`). A
  bulge's pole is held fixed. Nothing has tides or spin.
* Relativity only as the pull of Paczyński and Wiita (1980) for a body given a Schwarzschild
  radius (a black hole). The Sun's pull is Newton's: Mercury's perihelion turns 43″ a century
  slower than it does.
* A body without a mass is stepped on its own, without the corrector: it wobbles about its true
  path by its disturbance times (2π / steps)².
* Bodies that touch are made one at once, keeping their mass, momentum and volume (a black hole
  its horizon for its mass). Nothing breaks up; the heat of the impact is told in the event and
  not kept.
* On rails, nothing pulls between the members of a family, and the orbits of members lighter
  than a hundred-thousandth of it (or than `railsCross`) may cross: they pass each other untouched.

Now (`report()`): the step in use and what sets it (an orbit, an encounter, bodies about to
touch), the body whose orbit is the quickest stepped, the families on rails, the bodies whose
step follows them in and out, and how many bodies have no mass.

From the app's bodies (`SystemSim.ts`): a body left out of the simulation rides on the nearest
simulated body it goes round, keeping its own motion from the ephemeris; a planet whose moons
are left out stands for its family (their mass, their centre of mass). Velocities are the rate at
which the app moves each body: the ephemeris's own derivatives for the Sun, the planets and the
Moon, and for a moon on mean elements the rate at which its place changes (its catalogued
Kepler velocity is not that: Io's is 0.4 % too fast).

## What was measured

From `tests/systemsim.test.ts`, starting from the app's bodies on 2026-09-17:

| | |
|---|---|
| The Sun and the planets over 3,000 years | energy kept to 2.0 × 10⁻¹², angular momentum to 7.8 × 10⁻⁹ (what the planets' bulges would trade with their spins, which are not simulated) |
| The same with the Moon, a thousand years there and back | every body within 72 m of where it started |
| The Moon's month and the Earth's year over 50 years | 27.322540 d and 365.23378 d, against the ephemeris's 27.322552 d and 365.23383 d |
| Where they are | after 10 years the Moon is 164 km from its place about the Earth, the Earth 1,357 km from its own; after 50 years 747 km and 6,769 km |
| Io's period | 1.770014 d, against the 1.769129 d at which the app's ephemeris moves it; with Jupiter a point, 1.772504 d |
| A second Jupiter at 1.6 AU, a thousand years | Mars's eccentricity reaches 0.63 (0.094 without); Mars is captured and passed many times; energy kept to 1.3 × 10⁻⁹ |

The differences from the ephemeris are as much as the ephemeris can judge: the app keeps its
polynomials' terms in 32-bit floats, and velocities taken from them are good to about one part in
ten million. Io's 0.05 % is the catalogue's own: its mean elements put Io at 421,800 km, where
Kepler's law with Jupiter's bulge gives 1.76940 d.

From `tests/nbody.test.ts`: two bodies keep their period and shape over a thousand turns (to
10⁻¹⁰); a hyperbolic pass turns by the textbook's angle; a run cut into arbitrary pieces, a run
on a budget and a run restored from a snapshot land on the same bits as a run straight there; a
fly-by and a capture cross changes of hierarchy with the energy kept to 1.5 × 10⁻⁷; a head-on
collision conserves momentum to rounding and accounts for all of its energy; a body without
mass stays within 2 × 10⁻³ AU of one of almost none over a century beside a Jupiter; the pull of
Paczyński and Wiita keeps a circular orbit at 6 Schwarzschild radii turning at its own rate.

## Speed

`tests/systemsim.test.ts` ("speed") times frames of 8 ms of stepping, each followed by a
read-out, back to back. On the machine this was written on (a 2.1 GHz Xeon core, Node 22, shared
with other work, so the figures wander by a factor of two):

| Simulated | Step | Years of simulation per second of stepping |
|---|---|---|
| The Sun and the planets (9 bodies) | 3.1 d | 1,500 to 1,700 |
| With the 11 large moons (21 bodies) | 0.095 d | 12 to 20 |
| The same, orbits under 100 days on rails | 3.1 d | 1,000 to 2,200 |
| Everything in the catalogue (771 bodies) | 0.016 d | 0.09 (a month) |
| The same, orbits under 2 years on rails | 0.9 to 1.3 d | 6 to 17 |

An app that gives the stepping 4 ms of a 16.7 ms frame gets a quarter of these per second of
real time. A phone has not been measured: the arithmetic is double-precision loops over typed
arrays, which a current phone's JavaScript engine runs at about this machine's speed per core.
On that assumption a phone steps the Sun and the planets at a few hundred years a second with
every pull in, and needs moons on rails beyond a few years a second.

## Using it

```ts
const sim = new NBody();
const id = sim.add({ gm, radius, pos, vel });   // id?, rs? (black hole), zonal? (J₂ bulge)
sim.advance(dt, budgetMs);                        // returns the seconds moved; dt of either sign
sim.read();                                       // sim.pos, sim.vel at sim.time (order of sim.ids)
sim.primaries;                                    // the body each goes round now (-1: nothing)
sim.setMass(id, gm, radius?); sim.setState(id, pos, vel); sim.remove(id);
for (const e of sim.takeEvents()) { /* collision, encounter, unbound, escape, orbit */ }
sim.report();                                     // what is approximated now
sim.energy(); sim.momentum(); sim.angularMomentum();
sim.railsBelow = seconds; sim.lightRailsBelow = seconds; sim.railsCross = share;
sim.fit(rate, msPerSecond); sim.steps = 16; sim.edge = metres;
const copy = NBody.restore(sim.snapshot());
```

Events: `collision` (survivor, absorbed, and the speed, the heat and the distance between centres
as the two touched: worked out from the pair's energy, wherever in its step the simulation made
them one, which can be half as far apart again, or deeper; a black hole's are as the two were
when made one, its pull so near not being Newton's), `encounter` (two bodies or
families passing on an open orbit: distance and speed at the closest), `unbound` (a family no
longer bound to the rest), `escape` (an unbound family past `edge`), `orbit` (a body goes round
another now: a capture, a moon lost to its star).

```ts
const live = capture(system, jd);        // a simulation of the app's bodies at a date
live.sim.advance(dt, budgetMs);
system.update(liveDate(live));           // each body's own motion at the date reached...
apply(live, system);                     // ...moved to where the simulation has it
release(live, system, bodies);           // simulate bodies that so far rode along
riders(live, system, body);              // the bodies that ride on one
```

## In the app: live physics

`src/app/LivePhysics.ts` is the engine's place in the app (the owner's rule: the real Solar System
stays real until you touch it; then it is simulated, and one button goes back to reality).
Nothing of it runs until a power is used: a user who never touches one has the ephemeris, the same
pictures and the same frame as before.

* **The first change** (a mass, a body moved, made or taken away) starts a simulation from where
  every body is at that date and how it moves (`capture`). Simulated from the start: the Sun, the planets, Pluto,
  Ceres and the seven asteroids that have been weighed, and the twenty moons with GM of 1 km³/s²
  or more (Mimas and up): 38 bodies. Every other body rides on what it goes round in the
  catalogue, on its catalogued path, until that body or it is changed or taken away; then it is
  simulated too (`release`), one of unknown mass as a body that is pulled and does not pull. Why
  not every moon with a known mass from the start: the catalogue's places for the smallest are not
  a state their orbits can keep. Stepped from there, Saturn's Helene, which shares Dione's orbit,
  ran into Dione within twenty years of a change to Jupiter.
* **Move** (`src/app/Mover.ts`). The card's Move turns it on for the selected world. A pointer
  that comes down on the world takes hold of it (`Input.grab`: that pointer neither turns the view
  nor taps until it lifts), and the world is put where the sight line under the finger meets the
  plane of its orbit through what it goes round (`Powers.dragPlane`; where the eye is within
  about 11° of that plane, or the world goes round nothing, the plane that faces the eye). The
  clock is stopped while it is held. `LivePhysics.move` puts it there, and what goes round it
  with it. Where it is left it has the velocity it had when taken hold of, or, asked, that of a
  circle round whatever holds sway at that place (`swayAt`: the body a small one put there would
  go round, by the measure the simulation pairs bodies with), turning the way it was going. It
  is never left nearer another world than 1.05 times their radii together. What the simulation
  makes of the obvious try: the Moon on a circle at twice its distance has Kepler's month for
  that distance (72.7 days) and keeps to it for a fortnight; half way to the edge of the Earth's
  reach the Sun pulls hard, in ten weeks the Moon swings between half and one and a half times
  that distance, and after four months it goes round the Sun.
  Or it is thrown (Move's Throw): it stays where it is and is given a velocity against what holds
  sway there of f √(μ/r), f from the length of a slingshot's arrow (110 px for each speed of a
  circle) or from a flick's speed (1,200 px a second), snapped to exactly 1 and √2, the way snapped
  square to the line from what holds sway within 3°, at most f = 3 (`Powers.snapThrow`,
  `squareThrow`, `throwVelocity`; `LivePhysics.move` with its place unchanged). The Moon flicked at
  1.56 speeds of a circle is free of the Earth at once: the simulation has it go round the Sun, on
  an orbit like the Earth's, and says so.
* **Add** (`src/app/WhatIf.ts`, `LivePhysics.make`). A planet or a dwarf planet can be given a
  moon; a star a planet like the Earth, one like Jupiter, or a second sun. A plan says what the
  new body is, as the catalogue would describe one, and where it starts: on a circle, 0.55 of the
  way from what it is given to towards the eye (a moon no nearer than 3 radii or 1.1 Roche limits
  and no farther than 60 radii; a planet from 0.1 to 60 AU out, a sun from 0.3), a moon in the
  plane of its planet's equator the way the planet turns, a planet or a sun in the plane the
  planets move in, the way they go. `make` starts live physics if this is the first change, adds
  the body to the system (`SolarSystem.add`; its ephemeris is `placed`: no path of its own) and to
  the simulation at that place. Nothing else is touched at that moment, so a second sun arrives
  with a momentum of its own, and the pair, with all that is bound to it, drifts against the old
  centre from then on; what is too slow to follow is left behind, and told as flying free (a
  second sun made 0.3 AU from the Sun towards where Mars was on 17 September 2026 leaves Saturn,
  Neptune and two others behind at once). A copy has the size, mass, spin and face of the
  catalogue's body (whatever has been done to the original since), and its nature where the code
  knows a world by its name (`Body.nature`: a copy of a gas giant is one); not its air, clouds,
  rings, lights or measured ground. While it is put in place its mass can be set (`App.setMadeMass`,
  `LivePhysics.resize`: mass and size in the simulation), and its size follows from it by the rule
  for its kind (`WhatIf.madeSize`: rock and ice for a moon, the Earth's density, Jupiter's size
  from 0.3 Jupiters, a bridge between the two in the logarithm, a star of the main sequence).
  What was made stays in `App.made` until the return to reality
  (what was removed again too: gone like any removed world), at most 24. Two bodies of exactly one
  mass are possible now. The lighter side of a pair goes round the heavier, and of two sides of
  exactly one mass the second goes round the first (`NBody.primaries`), so that `Body.parent`
  never runs in a ring. Which of two suns of one mass is said to go round the other is therefore
  decided by what else is near each: made towards Mercury, the new one has Mercury and Venus on
  its side and the Sun is the one that goes round. Either way it is told that the two go round
  each other, not that one goes round the other (`hear`: a body at least as heavy as what it is
  said to go round), and each one's details say so (`rows`).
* **Each frame**: `follow` takes the simulation to the clock's date, or as near as a quarter of
  the frame allows (between 3 and 12 ms), and sets the clock to where it got: in live physics the
  simulation keeps the time, and a rate that cannot be kept shows as "getting…". Then
  `SolarSystem.update` (the bodies left out need their own motion, and everything its rotation),
  then `place`: the bodies where the simulation has them (`apply`), `Body.parent` set to what
  each goes round now (`NBody.primaries`; the catalogue's parent stays in `SolarSystem.homeOf`,
  and the ephemeris is worked out from that), a moon's face turned to it. A world's details, and
  the lines worked out in them, are about what it goes round now, with that body's mass as it is.
* **What is carried on rails** follows the rate of time, in stages, each tried only when the one
  before cannot keep up for 40 frames: families whose every orbit would go round in under 2
  seconds on the screen; then under 20 seconds; then also families whose moons have been thrown
  onto crossing orbits, each passing the others untouched (`railsCross`). What goes round a star
  is always stepped (`BodyInit.stepped`): what the planets do to one another over thousands of
  turns is what a long run is for. The Time sheet says what is on rails at the moment.
* **What happens is told** (`hear`): a collision (the absorbed body leaves the scene with whatever
  rode on it; the survivor has the mass and the volume of both; the camera and the selection go to
  it), a world set free or gone for good, a change of what a world goes round. Worlds by name,
  asteroids only counted. Each is logged for the moment it happened. On the screen three lines
  at most (`App.tellNews`): after the explorer's own act its line first ("Sun 2 is new", "Ceres
  is gone"), then what follows from it, the weightiest first; the rest is in the log.
* **Back to reality** puts back every mass, size and parent, takes away what was made, and gives
  the bodies to the ephemeris again at the moment the first change was made (the app puts the rate
  of time back as it was then). `tests/livephysics.test.ts` compares every body with a system that
  was never touched: the same to the last bit.
* **Undo and Replay** (`checkpoint`, `restore`): a checkpoint is the simulation itself
  (`NBody.snapshot`), what its bodies stand for (`Live.carried`, copied: `release` changes it in
  place), every body's mass, size, family and presence, what was made, the log, and how the
  stepping was keeping up. Restored, everything carries on from there exactly as it did: tested to
  the last bit after a mass changed, a world moved, made, taken away, and a collision. Exactly,
  that is, while the stepping keeps up: what is carried on rails follows the frame's share of work,
  and a run that falls behind carries more (so a Replay on a loaded machine can differ from the
  first run by metres). One checkpoint per gesture, never per frame (`src/app/History.ts`).
* **Light.** A system may have no sun, or more than one: `SolarSystem.suns` and `sunAt` (the one
  brightest at a place), and each body's `BodyView.sun`. A world is lit by one sun at a time;
  each sun has a face of its own, and the one corona and the one glare there are go to the sun
  that looks largest (`Bodies.chief`). With none: no sunlight on anything, no
  glare, no shadows, no air glow; the Earth's cities are what is left to see of it, and the eye
  adapts to them (`Bodies.ownLight`: held at about the radiance of its lit lands from afar, a
  three-hundredth of what its night side is exposed for in sunlight, so the continents show by
  their lights and the cities' cores burn out); a planet's name stays on the sky so it can be
  found. Not followed yet: the ship's own lamp and the heat on
  its hull still take a Sun to be there (`src/game/Game.ts updateLight`, `Flight.ts frameEnv`).

Also left out, and said so in the app's list (`ALSO_LEFT_OUT`): a world keeps its size and look
whatever its mass; the belt's 75,000 small asteroids and the comets, which are drawn from their
orbits and cannot be stepped one by one, are left out once the Sun is changed or gone (a second
sun, or a second Jupiter in the belt, leaves them on their real paths); the real spacecraft are
left out as soon as physics is live; a made copy is plain; with two suns a world is lit by one.

Not done, for whoever comes next: the powers in the headset's menus (`src/vr/`); a line of the
path ahead for a world that goes round nothing (it has its trail, and the card says so); the
stepping in a Web Worker; the ship's prediction line and its rails, which assume two-body orbits
(`docs/notes/relativistic-ship.md`), and a check of the ship flown while physics is live; landing
on a made world (its ground is made up, and was not tried).

What it manages (`tests/livephysics.test.ts`, "speed": frames of a sixtieth of a second, a
quarter of each for the stepping, on the machine above; a phone has not been measured):

| The change | a day, a month, a year a second | 100 years a second | 1,000 asked |
|---|---|---|---|
| Ceres taken away (every planet there) | all of it, under 0.5 ms a frame | about two thirds of it | about 90 years a second |
| Jupiter twice as heavy | all of it | nearly all of it | about 130 |
| The Sun taken away | all of it | all of it | all of it |

With the Sun and its planets there, Mercury's 88 days set the step (3 days), and a quarter of one
core is good for about a hundred years a second. Thousands would take the stepping off the main
thread (the engine is written for a Web Worker; the app does not use one yet) or coarser steps.
