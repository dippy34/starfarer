# The light of a black hole seen from afar

Notes of the round that followed the owner's third report on the lighting, with a screen recording
from an iPhone (Chrome on iOS, three pixels to the CSS pixel, the live site at c9981f2): "Look at
this video, break it up in frame by frame if you need to, and see what's wrong with it. Because, I
mean, clearly you didn't fix it." The summary is in HANDOFF.md (clean-up pass, part 6); this is the
long form: what the recording shows, what caused it, what was changed and why, what the checks
measure, and what is still not right.

## What the recording shows

Six and a half seconds at M87* (the header reads "M87* · N light years away"), the fingers
pinching in and out between 28.3 and 1.42 light years.

* The glow round the hole swells and shrinks with no relation to what the fingers do. At 17.1
  light years it is a white ball some 70 px across; from 16.0 down to 13.9 an orange dot; going out
  again it is still the dot at 15.8 and a white ball in the very next frame, at 17.4; at 19.2 it is
  a white ball in one frame and the dot in the next, without the eye having moved.
* Its colour goes from orange to a greenish white and back.
* It never looks like anything: no disk, no shadow, a ball of light; and the jets are one grey
  pole of even brightness, wider below, running off the screen.

Played again here at a phone's size (headless Chromium, software WebGL, 390 x 694 CSS px, at one
and at three pixels to the CSS pixel), the build of before does the same: the radius of the glow
(of a disc with as many pixels above half white) is 29 px at 28.3 light years, 57 by 22.9, then
57.6, 46.6, 54.3 in three frames running (18.3, 18.6, 19.0 light years), and from 53 to 23 px
between 7.84 and 7.46.

## What caused it

Each of these was measured on that build before anything was changed.

1. **One sight line to a pixel.** The shader traces one ray through the middle of each pixel, and
   the bright ring of M87*'s disk (eight Schwarzschild radii, a sixtieth of a light year) is a
   third of a pixel wide from 28 light years. A disk's light spans decades within a few radii, so
   the pixel on the hole held whatever its one ray happened to meet. Read out of the frame before
   the tone curve, with the eye held still at each place, the light of the hole (before exposure)
   was 979, 1,858, 4,022, 2,695, 5,928 at 28.3, 27.0, 24.5, 22.8 and 21.7 light years: it went up
   and down as the eye came steadily nearer. In the frame that was 13,000 to 60,000 times the
   display's white in three to five pixels, and the bloom turns such a pixel into a ball whose
   size follows the number.
2. **Colours cut off one by one.** The frame holds half floats, and the passes cut each colour off
   at 60,000 by itself. The disk's orange (1 : 0.46 : 0.09) went yellow and then white
   (1 : 0.95 : 0.92) as the number grew past that: the "greenish white" of the recording.
3. **An exposure that made a ball of it, and trailed behind.** Part 4 had given the unresolved
   middle of a far-off disk the light of a patch `FILL` (1.5 % of the frame) wide: on a phone, as
   much light as a white patch 64 px across, in one point. That is a ball a third of the frame
   wide by design. And it was the scene's exposure, which adapts (it opens over 0.6 s and shuts in
   0.12 s): after every move the ball swelled or shrank as the eye caught up. Going away at a
   pinch's pace the hole's light was up to 96 times off what it had been at the same place coming.
4. **Not drawn at all from far off.** A hole was drawn only where its bending of the sky reaches
   a pixel and a half: M87* from within some 1,300 light years on a phone. Beyond that its disk
   was not there; coming in, it appeared.
5. **The jets** were a tube's surface, shaded by the angle its wall makes with the eye, a different
   thing from a glow seen through; brightened on the side towards the Sun (fifty million light
   years off, in M87's case) instead of the side towards the eye; and part of the surroundings the
   hole bends, so they were in the environment maps, drawn again a face a frame.

## What was changed

* **The middle of a disk has an exposure of its own, which is a matter of where the eye is and of
  nothing else** (`Exposure.ts`: `diskMiddle`, `middleLimit`; `App.updateExposure` sets
  `BlackHoleView.middle` each frame; `shaders/blackhole.ts`: `uMiddle` in `diskHit`). The middle
  is what a glint covers round the centre (a patch `GLINT_AREA`, 24 CSS px squared, wide) and the
  bright ring at the least. Close by, the hottest ring is shown as the glowing surface it is, at
  `DISK_KEY` (0.8 of white). Once that would leave the middle with less light than a glint holds
  (`GLINT_LEVEL` 6.3 times white over that patch: 151 px of white in all), it is given a glint's
  light instead, at any distance, until the eye wide open has no more to give; from there it fades
  as a star does. So the light only ever falls as the eye moves off, with no step, and it is the
  same coming and going. The limit lets go outwards as r^3/4, the way the hottest disk's light
  falls off: nothing is drawn brighter farther out than nearer in. The scene's exposure still
  holds the rest of the disk, as before; where it is the lower of the two it holds the middle too.
* **What the frame's pixels do not resolve is traced on its own, finer** (`BlackHoleLayer.ts`:
  `miniatures`; `shaders/blackhole.ts`: `MINI_*`). A window round the hole (three radii of the
  middle, or as much of the disk as shows at all, and a fifth to spare) is traced into a picture of
  256 x 256, the miniature, with the same tracing as the frame's (`BH_TRACE`, shared). It is
  brought down to the frame's pixels by its mip levels (each pixel the mean of the miniature over
  its own area), and where the whole window is a pixel or two it is laid down as a point is, summed
  over each pixel's area like a star (`PSF_ON_PIXEL`, shared with the stars). The frame's own
  samples of that window are dropped by as much as the miniature shows (`uMiniW`, `miniShare`:
  the two share out the disk's light once). It takes over as the window shrinks under 64 of the
  frame's pixels in half-width and wholly at 32, so there is no moment at which the picture
  switches.
* **What is seen past the hole is in the miniature too**, wherever it shows a picture (`uBehind`;
  the frame's samples of it are dropped by as much, `uMiniW.y`). Found at the end of the round,
  at the phone's density: beside the shadow the whole sky is squeezed into a ring a fraction of a
  pixel wide, and one sample finds all of a pixel lit by a star's second picture, or none. At
  A0620-00 one pixel on the hole was lit 39 to 98 times white between 8,400 and 7,750 radii (a
  fifth more light in the glint for a twelfth of the way in; with the eye moving a quarter nearer
  a frame, 2.7 times the light for one frame). It went when the surroundings were taken out of
  the frame's samples there, so it was their light; by its brightness, the companion's, a quarter
  of the sky away from the hole (a star's small disc is as bright in the frame as it is since
  part 5, where a point is capped at three times white). In the miniature that picture has the
  light it has: the glint's light through that stretch is level within a hundredth.
* **A hole too far off to bend the sky is still a point of light** (`BlackHoleLayer.far`): its
  miniature alone, down to the light of the faintest star shown. M87* is a point at the heart of
  its galaxy from outside it: with a glint's light out to 70,000 light years, where the eye wide
  open has no more to give, and fading as a star does from there.
* **A miniature is traced from no farther off than a thousand half-widths of its window**
  (`EYE_REACHES`; `uNear`). From there the sight lines are parallel to a thousandth and the
  picture is the same from any farther; and from much farther, 32-bit numbers no longer tell the
  lines apart (from five million radii a line's place beside the hole is known to half a radius
  at best). Found at the end of the round, with the eye given time to settle at each place: the
  far glint of M87* was right out to 6,000 light years, twice too bright at 8,800 and gone by
  40,000. Now its light is level within 6 % from 1,200 light years to 71,000. What is seen past
  the hole is looked up along the line from the eye's own place, turned as the hole turns the
  traced one.
* **Light too strong for the frame's numbers is brought down as a whole** (`withinRange`): the hue
  holds.
* **The jets are a glow along the sight line** (`shaders/jet.ts`, `Jets.ts`): every pixel of the
  tube that holds a pair of jets sums the glow along its own line, so a jet has a bright spine and
  soft edges from any side, and from inside. Where a hole is drawn with its bending of light, that
  pass draws its jets itself, in front of the hole and behind it (through the disk, and not through
  the hole); the jets are no longer in the environment maps.

## What is physical, and what is stylised

Physical: the tracing (Schwarzschild; see the head of `shaders/blackhole.ts`); the colour of the
disk's light (a blackbody at each radius, shifted by the gas's speed and the hole's gravity); that
an unresolved disk is a point with all of its light in it, the same light as the picture it grows
into; a jet's shape (a parabola 1.5 z^0.58 out to 100,000 radii, as measured for M87, then a
narrow cone), its being brightest along the spine, and the beaming (gas coming towards the eye
brighter by 1 / (1 - beta cos)^(2 + alpha), gas going away fainter: from the side both jets show
alike, from near the axis only the one coming on).

Stylised, and to be said so: **how bright the glint is.** A real point of light is four times
brighter from half as far; a display cannot follow that over six decades, so from where the disk
stops being a surface to where the eye is wide open, the glint is held at one light (as the
brightest stars are held at three times white). The disks of the supermassive holes themselves are
illustrative (a thin disk at 5,200 K for M87* and 6,200 K for the others: the real flows are dim
and not thin). Of the jets: how bright they are (a level for the display), the speed of their gas
(0.7 of light's: M87's real speed would leave nothing of the far jet from most places), how slowly
they fade outwards, and the knots and threads, which are generated and drift far faster than gas.

## What the checks measure

`scripts/exposure.mjs` gained approaches (`APPROACHES`): M87*, Sagittarius A*, the quasar 3C 273,
Cygnus X-1 and A0620-00 are come up to from far off (a hundred light years for M87*) to six radii
and gone away from again, a frame at a time, 16 % nearer each frame on the way in and 45 % farther
on the way out. The turning scenes had no approach in them, which is how this got through twice.

* The hole's light is read from the frame as it is before the bloom and the tone curve
  (`Renderer.lightAt`, there for this): the screen shows a glint and a ball a thousand times too
  bright alike, as white. It is summed within 8 CSS px of the hole, over what is behind (the
  middle value round the square's edge).
* Checked while the hole is small (the bright part of its disk well inside that square): from afar
  it is a point with a tight glare (no more than 500 px of the screen within 60 px lifted clear of
  what is behind, no more than 60 white); coming nearer its light never leaps (under x1.65 a frame)
  and never falls back (to under x0.70 of what it had been); going away fast it is what it was at
  each place coming (within x1.57); and its colour holds (blue to red within a quarter). The
  limits stand between what the fixed build does (a step of x1.20 at the most, a fall to x0.78,
  x1.21 off going away, all three at Cygnus X-1: a disk's light sways a little with the eye's
  distance, as its middle takes in fewer of its arms and streaks) and what the build of before
  did (steps of x7 to x25 at four of the five, falls to a half and to a quarter, x53 to x137 off
  going away).
* M87* is looked at first from round its galaxy (40,000, 8,000 and 1,600 light years), where it
  is a point alone, the eye given time at each place: its glint has the light it has from a
  hundred light years, within x1.3 (133, 136, 138 and 137; with its sight lines traced from
  where the eye is: 6, 271, 136, 135).
* A hole with a star for a companion is come up to from where the star stands to one side. From the
  side the catalogue's link arrives on, Cygnus X-1 has its supergiant right behind the hole: the
  light round the hole is then the star's, and against its face the disk's glint is rightly lost.
* On the build of before, these fail for every hole (21 of the 26; a far-off hole was dark there,
  which passes "a point, not a ball"): M87*'s light leapt x25 in a frame, fell to x0.53, was x96
  off going away, its blue-to-red went from 0 to 1.64, and from round its galaxy it was not there.

Unit tests: `tests/exposure.test.ts` (the middle: what it covers, the surface close by, a glint's
light whatever the distance, frame or pixel density, no step from the surface to the glint to
nothing over eleven decades, the same wherever in the frame the hole is) and
`tests/blackholes.test.ts` (which holes are drawn bending the sky, which as a far point, never
dropping out between the two; the disk's brightness; the jets' shape).

## Things to know before touching this again

* `shownAt` (how bright the disk is drawn) counts a strongly coloured light by its strongest
  colour and a streak of gas at its brightest. So the glint of an orange disk measures about 150
  in luminance and that of Cygnus X-1's blue-white one about 50: the rule is the same.
* The miniature's own light is steady to a third of a percent as the eye moves (one sight line to
  each of its pixels is enough for the sum; nine made the brightest pixel smoother and the sum no
  steadier, and were taken out again).
* Where no miniature is shown (the hole large in the frame, or without a disk) what the hole
  bends round itself still comes from the environment maps one sample to a pixel: a star's second
  picture beside the shadow comes and goes a pixel at a time as the eye moves.
* The app's clock runs in real time under the suite: the gas of a disk turns between two frames.
  Holding the eye still, the light of A0620-00 from 3,000 radii stays within 1.5 % over six
  seconds.

## What was looked at, at the phone's size and density

Headless Chromium, software WebGL, 390 x 694 CSS px at three pixels to the CSS pixel, the app's
clock in hand.

* **The recording played again** on the fixed build: M87* at the distances the recording's header
  shows in each of its 66 frames, three frames of the app to each. The glow is a steady point
  with a tight glare from 28.3 light years down to 10, and from there grows into the disk with its
  dark middle by 1.4; measured as the recording was (the radius of a disc with as many pixels
  above half white, the names on the screen counted in both), it is 9 to 10 px all the way from
  28 light years to 10 in both directions and 19 px at 1.42, where the recording goes between 11
  and 43 px with no relation to the distance. The hole's own light in the frame holds within a
  tenth of 150 (px of white) from 28 light years to 2.7 and rises smoothly from there (211 at
  1.42); its blue-to-red stays between 0.51 and 0.57.
* Finely stepped with the gas held still (126 steps from 28 light years to 1.2), M87*'s light is a
  smooth curve between 128 and 148 down to 2.8 light years: nothing in it switches.
* Holding the eye still, the light does not flicker: Cygnus X-1 from a million radii stays within
  one percent over thirty frames, A0620-00 from 3,000 radii within 1.5 % over six seconds.
* Sagittarius A*, Cygnus X-1 (from where its star stands to one side), A0620-00 and the quasar,
  from far off to their horizons: a point, then the disk and the shadow growing out of it, with no
  frame in which the picture switches. GRS 1915+105 was looked at the same way while the fix was
  being made.

## Seen and left

* **The glint does not brighten as the eye comes nearer** until the disk is a surface: stylised, as
  said above.
* **Where the scene's exposure is the lower, it holds the middle too.** With the supergiant of
  Cygnus X-1 filling the frame behind the hole, the eye is set for the star and the disk's glint
  is lost against its face (rightly: it is nothing beside that star). And going away far faster
  than a pinch does (a flight), the eye opens over its 0.6 s behind the glint's limit, and the
  glint is dimmer for a second.
* **The rest of a hot disk still follows the eye.** Beyond its middle, Cygnus X-1's disk is drawn
  with the scene's exposure: going away fast it is dimmer than it was at the same place coming,
  and eases up over about a second.
* **A star behind a hole lags while the eye moves.** Inside the region a hole is drawn in, what is
  behind comes from the environment maps, which are redrawn a face a frame while the eye moves.
  With a bright star there (Cygnus X-1 from the side the catalogue's link arrives on) a fast pinch
  shows its limb notched where the region's edge crosses it, until the eye rests. Older than this
  part. Two ways out: redraw the face the hole is seen against every other frame; or let the
  hole's pass leave the frame as it is where the bending is under a pixel, and draw the maps only
  where it is not.
* **A star's second picture beside the shadow comes and goes** a pixel at a time as the eye
  moves, where no miniature is shown: at a hole large in the frame, and at one without a disk
  (Gaia BH1 to 3).
* From hundreds of light years M87's jets are a hairline across the frame; the knots drift along
  them far faster than any gas.
* Not tried on a real phone, nor in a headset (the headset traces the miniature too; the `vr`
  suite is all that has seen it).
