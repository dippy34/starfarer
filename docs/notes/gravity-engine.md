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

Always (the engine's `LEFT_OUT`):

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
  than a hundred-thousandth of it may cross.

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

From `tests/systemsim.test.ts`, starting from the app's bodies on 2026-10-20:

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
sim.setMass(id, gm, radius?); sim.setState(id, pos, vel); sim.remove(id);
for (const e of sim.takeEvents()) { /* collision, encounter, unbound, escape, orbit */ }
sim.report();                                     // what is approximated now
sim.energy(); sim.momentum(); sim.angularMomentum();
sim.railsBelow = seconds; sim.fit(rate, msPerSecond); sim.steps = 16; sim.edge = metres;
const copy = NBody.restore(sim.snapshot());
```

Events: `collision` (survivor, absorbed, speed, heat, distance), `encounter` (two bodies or
families passing on an open orbit: distance and speed at the closest), `unbound` (a family no
longer bound to the rest), `escape` (an unbound family past `edge`), `orbit` (a body goes round
another now: a capture, a moon lost to its star).

```ts
const live = capture(system, jd);        // a simulation of the app's bodies at a date
live.sim.advance(dt, budgetMs);
system.update(liveDate(live));           // each body's own motion at the date reached...
apply(live, system);                     // ...moved to where the simulation has it
release(live, system, body);             // simulate a body that so far rode along
```

The app does not use the engine yet: wiring it in, with the first powers (change a mass, remove,
move, add), is the next part, and this note will say how it was done.
