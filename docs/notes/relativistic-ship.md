# The relativistic ship

The owner asked for "some sort of ship that follows like the laws of physics ... can travel as fast
as you want to, but still not faster than the speed of light". These notes record what the ship
could do before, what was decided and why, what is real and what is invented, how it was checked,
and what is left (with a specification for the view at speed).

## What there was (measured before anything changed)

All with the code as it stood at `dcd5d89` (the unit measurements with `FlightCore` directly, the
warp in the deployed build in headless Chromium).

* **The realistic drive** (the 40 t "fusion torch": 520 kN, Isp 3,200 s): 1.33 g, propellant gone
  after 1,380 s of full throttle, Δv 25.06 km/s. Enough for orbits, the Moon, Mars on a long
  transfer; not for another star (Alpha Centauri at 25 km/s: 52,000 years).
* **The "boosted" drive** (25 times the thrust, endless propellant, "inertial dampers"): 33 g, and
  a relativistic correction that divided the thrust by γ³ along the motion (right, as a force) but
  only above 10,000 km/s, then a hard wall: the speed was clamped to **0.995 c** every substep.
  Thrusting for a year at 33 g: 0.942 c after 30 days, 0.995 c after 365 and for ever after
  (γ = 10.0, the ship's clock at 0.0999 of the universe's). The instruments showed the felt
  acceleration falling to 1.25 g at 0.94 c and 0.03 g at the wall, though the drive was pushing
  at 33 g all along (they showed the coordinate acceleration, not the proper one).
* **The "warp drive"** (J) was the explorer's camera autopilot carrying the ship: a log-distance
  curve that crosses any distance in a few seconds. Measured: Earth to Rigil Kentaurus, 4.395 light
  years, in 28.3 s of universe time: **4.9 million times the speed of light**. While it flew, the
  universe's clock ran at the normal rate and the ship's clock with it. "Mass lock" (no warp where
  gravity passes 0.5 m/s²) was Elite's fiction.
* **Time warp** multiplied the universe's clock by the rate, divided by the ship's clock rate
  (`dilation`) but never by more than 50.
* **How far one could get, honestly**: the Moon and the planets with the torch (slowly), and with
  the boosted drive, at 0.995 c, Alpha Centauri in 4.4 years of universe time and 5.3 months
  aboard. Any farther only by the warp, faster than light.

## What was decided

1. **The motion is special relativity, exactly.** The integrated state is the proper velocity
   w = γv (m/s), which keeps every digit at any Lorentz factor (at γ = 10⁹, 1 - v/c = 5·10⁻¹⁹: v
   itself rounds to c in a double). `src/sim/Relativity.ts`:
   - `driveFlow`: the motion under a constant proper acceleration in a fixed direction (of the
     ship's rest frame, its axes the world's carried over by a pure boost), solved in closed form
     for any starting velocity, sideways included (q/(γ + 1) is conserved; γ, the velocity, the
     position and the coordinate time are elementary functions of a parameter φ that grows
     uniformly with proper time; given a coordinate step, φ comes from two contracting fixed-point
     rounds and bracketed Newton steps). Exact for the textbook cases (v = c tanh(aτ/c),
     x = (c²/a)(cosh(aτ/c) - 1), t = (c/a) sinh(aτ/c)) to 10⁻¹⁴, from γ = 1 + 10⁻¹⁶ to 10²⁹;
     one long step equals a thousand short ones to 10⁻¹²; a step backwards undoes it.
   - `driveTime`: the coordinate time in which a given proper time passes (the same solution).
   - `boostProper`: velocities compose by a Lorentz boost of the four-velocity, so no sum of
     speeds reaches c (the ship's velocity in the universe from its velocity relative to the body
     it flies about, and back).
   - `flipAndBurn`: accelerate, turn, brake, from any starting speed along the line, with the
     overshoot case.
2. **Gravity is Newton's potential (Paczyński–Wiita at black holes, as before) in special
   relativity**: the energy γc² + Φ and the angular momentum r × w are conserved (Sommerfeld's
   special-relativistic Kepler problem). In the integrator that is the old kick with w for v
   (dw/dt = g) and a drift at w/γ: a separable Hamiltonian, so the Yoshida steps stay symplectic
   and, slow, are the old integrator to v²/c². Considered and rejected: (a) "time-only curved"
   free fall (dw/dt = γg, which keeps every circular orbit Newton's and bends light by Newton's
   angle): with the pseudo-potential, which diverges at the horizon, γ grew as exp(rs/(r - rs))
   and overflowed before the horizon; (b) a mix keeping Newton's path curvature with
   special-relativistic energy: it conserves no angular momentum. What the choice leaves out is
   general relativity proper: a fast path bends less than Einstein says (light, not at all), and
   with the pseudo-potential (tuned for Newtonian motion) the innermost stable orbit of a black
   hole is at 3.6 rs instead of 3 rs. The periapsis advance is within 10 % of Schwarzschild's
   from 6 to 10 rs (Newtonian motion in the pseudo-potential, as before: 30 % short), 17 % over at
   5 rs, far over at 4 rs (near the shifted innermost orbit). Circular orbits are set at the
   speed this dynamics needs (w²/γ = ra).
3. **The engines are in the drift**, solved exactly; gravity and drag are in the kicks. With the
   engines off the drift is the old straight line. The proper time aboard is summed from the
   drifts (exact under the engines) and multiplied by gravity's clock rate (the hole's
   Schwarzschild factor, the weak field's √(1 + 2Φ/c²)) as before.
4. **The frame of the dominant body counts as inertial for the ship** (bodies move at ≤ 10⁻⁴ c;
   their clocks agree with the universe's to 10⁻⁸). The relative state is integrated there as
   before, and composed with the body's motion by a boost.
5. **The top drive: the reactionless drive** (`ShipState.drive = 'reactionless'`). The pilot
   chooses its proper acceleration from 0.001 g to 1,000,000 g in 1-2-5 steps (= and -), the
   throttle scales it, it needs no propellant. Named for what is invented: no real engine does
   without reaction mass (momentum would not be conserved), and its field pushes every particle
   aboard alike, so the crew feels none of it (the felt g shows only the torch, RCS, air and
   ground). Everything it does to the motion is real relativity. It stops pushing faster at
   γ = 10¹² (`SHIP_SPEC.gammaMax`, an invented limit with a real reason: at γ = 10¹² every atom
   in the way strikes at 10²¹ eV, past the most energetic cosmic ray ever recorded); braking still
   works there. The integrator itself has no limit (tested to γ ≈ 10²⁹). Within a substep the drive
   may raise γ at most e-fold, so the limit is held to that factor. The torch is unchanged (it
   stays the default); the old "boosted" mode is gone (the reactionless drive at 33 g is what it
   was, without the wall and without the dampers' fiction on the instruments).
6. **Clocks.** Time warp is the ship's clock's rate: a frame advances the pilot's clock by
   (real seconds) × (rate), and the universe's by exactly the coordinate time that takes under the
   engines as set (`FlightCore.universeTimeFor`), divided by gravity's clock rate. The 50x cap is
   gone: at γ = 10⁹ a second aboard is 32 years of the universe's, the date runs on and the
   planets move. Outside the ship nothing changed: `Flight.before` was already the only place the
   ship mode sets the app's clock step (`App.frame`), and that is still so. Physics warp keeps its
   substep budget; "on rails" (Newton's two bodies) is refused above 300 km/s.
7. **Nothing in the ship travels faster than light.** The warp drive is gone (and its streaks,
   `WarpFx`, and its sound). J, the explorer's Go there, a double tap, a digit key, the headset's
   Fly to and its A button all start the ship's **autopilot** while in the ship
   (`Flight.autopilotTo`; `App.goTo` and `VR.travelTo` hand over in one line each). Boarding stops
   any explorer flight under way. Map jumps (a search pick that places the explorer, a tour stop,
   the test scripts' `placeNear`) still move the ship as before: they are the map, not the ship.
8. **The autopilot** flies flip-and-burn on the reactionless drive at the pilot's setting:
   steered towards the proper velocity from which braking at 0.8 of the drive stops the ship at the
   arrival point (w = c√(x(2 + x)), x = ad/c², the relativistic stopping distance), with the
   curve's own deceleration as feed-forward, the difference in gravity between ship and target
   held off, and a gentle last stretch (the distance falls by e every 20 s) finished on the RCS.
   The arrival point is on the ship's side of the target, at a distance clear of air, heat and
   tides, moving with it, on a circular orbit if it pulls. The flip comes of itself where the ship
   meets the braking curve. The drive pushes along the nose, so it pushes as the nose comes onto
   the aim; while the ship turns, time runs at 1x, and the warp is held to a twentieth of the time
   to go per frame (so the arrival is resolved) and to a tenth of the rapidity the drive can add
   per frame (at γ = 10¹⁰ one frame's push would otherwise change the speed's distance from c many
   times over before the steering could answer). The guidance itself is pure and unit-tested
   (`src/game/Autopilot.ts`: `placeSlot`, `steer`, `autopilotRate`; `tests/autopilot.test.ts` flies
   it with `FlightCore` from 12 Earth radii into orbit about the moving Moon, to Alpha Centauri at
   1 g in 3.85 years aboard and 6.2 in the universe, between the 1 g and 0.8 g textbook values,
   and 2.5 million light years at 10⁶ g in an hour aboard). Any control input takes the controls back.
9. **Worlds in the way** (added when the work was taken over; see "Taken over" below). The
   straight path can run through a world: in the browser suite the autopilot, flying from an orbit
   about the Moon to a station on its far side, flew into the Moon at 66 km/s. Each frame it now
   asks `inTheWay` (`Autopilot.ts`) whether the line from the ship to the target passes within 1.1
   radii of any gravitating world (other than the target), or the ship's own motion carried on as
   far would (fast, a turn is a wide curve: in the browser the line to the station low over the
   Moon was clear while the ship, at 40 km/s, dived into the Moon on its way round to it), and if
   so flies instead towards the
   point where the tangent from the ship touches the sphere of 1.3 radii about that world, carried
   out to the ship's distance (at least 2.2 radii; from inside 1.3 radii, straight up). That is the
   shortest way round a sphere; the chord to the point misses the sphere whatever the geometry,
   and since the point is worked out again each frame from where the worlds are then, a world
   that moves (or is moved) is gone round where it is. With that, the **mass lock is gone** (the
   Elite fiction "no autopilot where gravity passes 0.5 m/s²", whose only reason was the straight
   line). In its place, two refusals with physical reasons (`Flight.autopilotRefusal`): in a
   world's air (it would cross it at many km/s), and where gravity is more than half the drive's
   acceleration at its setting (too little left to steer: "set it to 5 g or more"). The second
   matters on a phone: the explorer's first view of the Earth is at 3.4 radii (0.85 m/s²), where
   the old lock refused and a phone has no throttle to climb out with.
10. **Hitting a world at speed.** The integrator's substeps are sized by the orbital time scale,
   not by the speed, so a fast ship could cross a world between two substeps and come out the
   other side (measured: from 10 radii of a small moon at γ = 100, one 0.01 s frame carried it
   through and 2,000 km out the other side, with no event). `FlightCore.contact` now also tests the chord of
   each substep against the ground sphere (and the horizon) and stops the ship where the chord
   enters. The chord of an orbiting substep sags r·η²/8 below the arc (η = 2π/1000: 31 m at the
   Earth), so no orbit is mistaken for a crash; the analytic rails step is not tested this way
   (its chord could cross a world it goes round). Only the frame body is tested, as before: at
   relativistic speed a ship flown by hand straight through a world that is not its frame body
   still passes through it (the autopilot goes round).
11. **A target that goes.** Bodies can be taken away (today a moon the explorer made; soon, with
   the live N-body physics, anything, the Sun included). The autopilot lets go ("X is gone:
   autopilot off") when its target, or a station's world, is no longer valid.
12. **On a phone** (the owner's only device; the ship was keyboard-only before, HANDOFF "Touch for
   the rest"). The More sheet has a **Spaceship** switch (board, leave). In the ship, on a touch
   screen, the tabs stay (they hide for a mouse, which has the keys): Search and Explore choose a
   destination, **Go there** starts the autopilot, the Time sheet's Faster and Slower are the
   ship's time warp. Over the instruments a strip **Reactionless drive − 1 g +** steps the drive's
   setting (1, 2, 5 from 0.001 g to a million g). The search and settings sheets hide the
   instruments while open. Not on touch yet: flying by hand (throttle, attitude, RCS, SAS), the
   chase view, the drive switch (the autopilot switches to the reactionless drive itself).

13. **The sky turned white on the way to Andromeda** (found after the first publication, on the
   owner's own trip: 1,000 g, 100,000x). Not the ship's physics, nor the exposure (it stayed
   1,054,216 throughout): the explorer's dust cue (`ScaleCues`), whose specks are drawn in a box
   the size of the distance the eye covers in 3 s of real time. In the ship near light speed at
   that warp the eye covers hundreds of light years a second; past a box of a few 10¹⁸ m the dust's
   vertex arithmetic, in the GPU's 32-bit floats, broke down and the sky came out white with dark
   blots (32 % of the phone's pixels near white at 350, 860 and 2,100 light years; with `dust=0`,
   0.5 %, as with the box drawn smaller). The box is now drawn at most 10¹⁵ m across, its streaks
   scaled with it: a box scaled about the eye makes the same picture, and the specks still cross
   it in 3 s. Measured on the same trip: 0.5 % near white (the instruments' text), the ordinary
   dark sky with its stars.

## What the pilot reads

The flight panel (desk; on a phone the same panel spans the width, smaller): the drive (TORCH, or
REACTIONLESS and its setting), altitude, vertical speed, speed (a fraction of light's with as many
nines as it takes, from the proper speed: `fmtLight`, e.g. 0.999 999 999 999 999 999 5 c), the
Lorentz factor (1 + 3.3×10⁻¹⁰ in low orbit; 2.42×10⁹), past a tenth of light's what that does to
the view ahead (half the sky crowds into θ with tan θ = 1/(γβ); light ahead is e^η times bluer),
the orbit, throttle, propellant or the drive's setting (and "at its limit"), the felt g, SAS, the
target with its distance and the time to it **aboard and in the universe** (flip-and-burn at the
drive's setting, or coasting at the present speed), the autopilot (ready / in the air / drive too
weak here / what it is doing, or "round" the world it is going round), time warp, the ship's clock (with its rate against the universe's), the universe's.
The cockpit's screens (desk and headset) show the same in short: when fast, speed, γ and the time
to go replace the orbit lines.

## With live physics (the N-body worlds being built alongside)

What the ship reads of the worlds, and what would break if they are moved by a simulation:

* **Read live every frame** (as `GravityField` does): `Flight.collectSources` takes every valid
  body's `gm`, `radius`, `upos`, `vel` and orientation from `app.system.bodies` each frame; the
  autopilot's detours (`inTheWay`) and its target's velocity (`trackTarget`: `Body.vel`; a
  station: its world's `vel` plus its own) likewise. Nothing in the ship asks the ephemeris.
* **Taken from the hierarchy**: a source's `parent` and sphere of influence come from
  `Body.parent` and `Body.soiRadius()`, which choose the frame the ship is integrated in. If the
  simulation changes what a body goes round (a capture, the Sun removed), `Body.parent` must change
  with it, or the ship is integrated about the wrong body (still correct physics, as every source
  pulls, but the instruments' orbit is about the wrong body).
* **Bodies that go**: an invalid body (`valid = false`, as `SolarSystem.remove` leaves it) drops
  out of the sources the next frame; the frame is chosen again from what is left; the autopilot
  lets go of a target that went. A ship orbiting a body that is removed is no longer pulled by it
  (not tried in the browser with the ship in orbit about it).
* **Assumed, and wrong under live physics**: the trajectory prediction (`Predict.ts`) moves the
  bodies ahead on two-body orbits about their parents from their present states; and the "on
  rails" time warp (above 1,000x, slow and coasting) is the exact two-body motion about the frame
  body alone. Both stay good approximations while the worlds keep their orbits; after a big change
  (the Sun gone, a planet doubled) the line ahead and the rails are wrong until the bodies settle.
* **Time**: in the ship the clock step is the ship's (`Flight.before` returns it, `App.frame` moves
  the worlds by it): at most 100,000x of the ship's clock, more of the universe's when the ship's
  runs slow. A rate of thousands of years a second set for the explorer is not the ship's; boarding
  starts its clock at 1x (`App.flightClock`). The simulation must advance by the step Flight
  returns, whatever its size (at γ = 10⁹, one frame of the ship's is decades of the universe's).

## Taken over

The work was taken over mid-way (the first agent was stopped by an interruption unrelated to it).
Kept as it was: the mechanics (`Relativity.ts`, the integrator in `ShipPhysics.ts`), the drive, the
clocks, the instruments, the autopilot's guidance and their tests; all checked again. Added: the
way round worlds (9; the first agent had found the cause and begun a simpler version, a point
"halfway round" whose chord could still clip the world from a low orbit: replaced by the tangent),
the refusals in place of the mass lock (9), the chord test for crashes at speed (10), the target
that goes (11), the phone (12), distances in light years past 0.05 of one (the instruments printed
Andromeda as "156,116,097,093 AU").

## Checks

* `tests/relativity.test.ts` (new, 24): the closed forms; the voyage to Alpha Centauri at 1 g
  (3.58 years aboard, 6.0 on Earth, by the formula and flown by `FlightCore` in daily frames:
  arrives at rest within 10⁻¹² of the distance, its clock within 10⁻¹² of the formula); velocity
  composition (rapidities add along a line, never c, a boost back undoes it); the low-speed limit
  against the old integrator's own outputs (recorded from `dcd5d89`: a low orbit, a torch burn,
  an escape, drag: positions within 2 cm, 1 cm, 2·10⁻⁷ of the path, 1 mm; the differences are
  v²/c² and the boost with the Earth's 28 km/s); no NaN and the speed below c while the drive
  burns at 10⁶ g to γ > 10⁹; the clocks (τ = (c/a) asinh(at/c), frames sized by `universeTimeFor`
  advance the ship's clock by exactly what was asked, the twins out and back at 1 g); an orbit at
  0.4 c keeps γc² + Φ and r × w; periapsis advance against Schwarzschild; a sideways burn at
  γ = 10⁹ past a star.
* `tests/flight.test.ts`: every test passes unchanged but one, "an orbit at 4 rs is stable and its
  periapsis precesses strongly", whose measurement had to change: it read the periapsis advance
  modulo a full turn, and the advance at 4 rs is now 6.4 rad (Schwarzschild's is 6.28 rad), one
  turn and 0.1, which the modulo read as 0.1. It now counts the turns; the old code passes the
  changed test too (advance 4.6 rad). New: "a fast ship cannot pass through a world within one
  substep, nor past a horizon" (fails before the chord test: the ship ends 2,000 km beyond the
  moon's centre with no event).
* `tests/autopilot.test.ts` (new, 7): the flights above; "goes round a world in the way of the
  straight path" (without `inTheWay` the same flight crashes into the world; with it the ship
  gets there, never inside 1.3 radii); from a high orbit of the Moon to a station 400 km up on its
  far side, at 100 g; the detour point's geometry (from far, from close, from below 1.3 radii, a
  path that is clear while the ship's motion is not, a dive whose lowest point lies beyond the
  target, the target never in its own way); the warp it allows.
* Browser (`scripts/flight.mjs`, `scripts/game.mjs`): what was the warp drive's is the autopilot's
  (J engages it, not the explorer's travel; it arrives in orbit about the Moon, slower than light;
  to Rigil Kentaurus at 50 g, never closing faster than light, arriving at the star); the drive at
  1,000 g past γ = 100 and below c; time dilation (the universe's clock ahead of the ship's); the
  instruments' nines; the panel within an upright phone's screen; the refusal deep in a well (was
  the mass lock); the docking computer taking over from the autopilot; the autopilot letting go of
  a moon that is taken away; on a phone by touch, Spaceship boarding with the tabs staying, + on
  the drive, and Go there starting the autopilot. Counts at the end of this work: flight 28/28,
  game 21/21; vr 32/32, walk 45/45, interact 11/11, touch 49/49, start 33/34 (a timing check of
  the loading screen under load), verify's 35 scenes as before but for the ship's instruments.

## Not done here, and the specification for it: what the pilot sees at speed

The view is not yet relativistic: the stars, the Milky Way and the bodies are drawn where they
are in the universe's frame. The star points are drawn by `src/render/StarField.ts` (and
`ProceduralStarLayer.ts`, `NearStars.ts`, the galaxies' and the sky's own shaders), where other
work is in progress, so it was left for the round that owns them. What it needs, precisely:

* **Inputs**, one shared uniform object (like `GLOBALS` in `shaders/xr.ts`), set every frame by
  the game: `uBoostDir` (unit, world axes: the ship's velocity relative to the stars' frame;
  `Flight` has it as `core.relW` direction, or `ship.properVelocity()` for the barycentric
  frame) and `uBoostX` = γβ = |w|/c (from the proper velocity, never from v; 0 outside the ship).
  With γ = √(1 + x²) and γ - 1 = x²/(γ + 1), nothing cancels at any speed.
* **Aberration** (every point and every vertex, in the vertex shader, on the direction from the
  eye, per eye in a headset): a source in direction n (stars' frame, towards the source) with
  μ = n·b̂ appears in the ship's frame along n' ∝ n + ((γ - 1)μ + x) b̂, normalised
  (cos θ' = (μ + β)/(1 + βμ)). Half the sky lies within tan θ = 1/x of the direction of motion.
  Meshes spanning large angles bend (fine for small triangles; a sky sphere needs the inverse in
  its fragment shader: n ∝ n' + ((γ - 1)μ' - x) b̂ for the texture lookup).
* **Doppler** factor of each source: D = γ + xμ for μ ≥ 0 and (1 + x²(1 - μ²))/(γ - xμ) for μ < 0
  (the same value, without cancellation behind). A blackbody of temperature T is seen as a
  blackbody at D·T: the colour comes from the LUT at D·T.
* **Brightness** (the headlight effect): for a source at rest and a moving observer, the photon
  rate and each photon's energy rise by D, so the bolometric flux is D² times; the star looks
  like a blackbody of D·T whose solid angle is D² smaller. In a band (the app works in V and a
  colour): irradiance × B_V(D·T) / (D² B_V(T)), B the Planck function at the band's effective
  wavelength; for the whole visible light, the LUT's luminance at D·T over that at T, over D².
  Ahead, stars brighten and turn blue, then fade out of the visible into the ultraviolet as D·T
  passes ~30,000 K; behind they redden and fade.
* **The cosmic microwave background** becomes visible ahead from D ≈ 1,000 (2.725 K × D in the
  visible): a uniform 2.725 K blackbody seen at D·2.725 K with intensity σ(DT)⁴/π per steradian,
  a small bright disc ahead, then a hard-ultraviolet one. Worth drawing: it is the real view at
  extreme speed.
* **CPU side**: picking, the labels and the exposure's metering read the same transform
  (`Labels.at`, `App.pickAt`, the HUD markers), or the names drift off their stars.
* **Cost**: about twenty flops a vertex; the gate is x > 10⁻³ (300 km/s, aberration ~3′; the
  Earth's own orbital aberration, 20″, is not drawn by the explorer either).
* **Checks to add**: the star suite and every suite that draws stars, unchanged with x = 0; at
  γ = 10 the stars' density ahead rises by D² where it should.

Also left: flying the ship by hand on a phone (part 7 of the clean-up: a thumb-stick, the
throttle, SAS; boarding, the drive's setting and the autopilot are on touch now); the instruments
were checked in an emulated phone only (Chromium at 390×844, three pixels to the CSS pixel), not on
an iPhone; the panel covers the upper half of a phone's screen in the ship (a smaller layout, or a
way to fold it, would help); the prediction line ignores the engines (as before); a world that is
not the frame body is not tested for a crash at speed (see 10); at a galaxy the autopilot stops 3.5
of its radii out (the instruments say how far short of it).
