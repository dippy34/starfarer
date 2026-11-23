# The trailer

A 54-second vertical trailer for Starfarer (version 4), for people who have never seen it and
are scrolling on a phone. Every picture in it is the app itself, built from this repository and
filmed frame by frame in a headless browser; the edit adds only cuts, cross-fades, fades, text, the
blurred sides of the phone-screen shots and a ring where a finger touches the screen. The music is
an original piece synthesised here with numpy: a placeholder, easy to replace.

Nothing here is part of the app, and no video, frames or audio are kept in git.

| File | What it does |
|---|---|
| `shots.mjs` | the shots as data: where the app opens, the date, how the camera moves each frame |
| `capture.mjs` | films the shots from a production build, one exact frame at a time |
| `timeline.py` | the cut: tempo, which shot when, the text cards |
| `edit.py` | puts frames, text and music together into the H.264 file |
| `score.py` | synthesises the music on the cut's grid |
| `sheet.py` | contact sheets of shot folders or of a finished video (one frame a second) |

## Render it again

```bash
npm ci && npm run build
npx vite preview --port 4178 --strictPort &          # capture from a production build, never the dev server
                                                     # (--base http://127.0.0.1:PORT/ for another port)
export CHROMIUM_PATH=/opt/pw-browsers/chromium       # where the container keeps Chromium
OUT=/tmp/trailer                                     # frames: about 3 GB at full size
nice -n 10 node trailer/capture.mjs --out $OUT/frames --scale 3      # 1080x1920 (--scale 1.5: 540x960 draft)
nice -n 10 python3 trailer/score.py $OUT/score.wav
nice -n 10 python3 trailer/edit.py $OUT/frames $OUT/score.wav $OUT/starfarer-trailer.mp4 --size 1080x1920
python3 trailer/sheet.py $OUT/contact.png --video $OUT/starfarer-trailer.mp4
```

`--only sun,saturn` re-films some shots (each shot is its own folder, so one can be redone alone);
`--stills 3` films only three frames of each (with the full pre-roll) for trying out a framing.
`--shots other.mjs` takes another shot list (candidates; a path from the repository's root or an absolute one). Another size: capture at another
`--scale` on the same 360x640 viewport and pass the matching `--size` to the edit; a different
shape (say 1:1 or 16:9) needs `VIEW` changed in `shots.mjs` and the framings looked at again.

## How the capture works

Software WebGL draws a frame every second or two, so filming in real time is useless. An init
script replaces the page's `requestAnimationFrame` and `performance.now`: the app boots on the real
clock (its loading waits and the start menu need it), then the capture takes the clock and steps
it by exactly 1/30 s per frame, running the app's frame and reading the canvas in the same task
(`toDataURL`), so each picture is exactly that frame. Inside a frame the virtual clock still runs
with the real one but at most 25 ms, so the code that budgets its work by the clock (texture
uploads, the galaxy cloud's fill, terrain) gets its usual few milliseconds and never loops on a
frozen clock, and the clock never runs backwards.

Each shot opens the app at its own deep link (so the right maps load first), hides the interface,
the names, the orbit lines and toasts, sets the date as a function of the shot's own time (not of
how many frames loading took), waits until loading has settled (no star tiles or generated stars
pending, the GPU's texture count still for six steps), and steps a second of pre-roll that is not
kept, so the eye's adaptation, bloom and the stars' motion are under way at the first frame. The
camera is placed by the shot's `pose` inside the app's frame, right after the bodies have moved
(a hook on the rig's `followAnchor`), relative to the body filmed: a camera tied to a planet never
lags it, however fast the date runs. The pull-out moves exponentially in distance.

The interface shots are filmed with whole-page screenshots: the ship on the 360x640 viewport (it
fills the 9:16 frame), god mode on an iPhone's (390x844 CSS px: the frame's height, its sides a
dark blurred copy of the screen). Their taps are real touch events sent through the DevTools
protocol to a name in the sky or an element found by its text or a CSS selector; a drag (the
thrust lever, the mass slider) is a finger put down, moved a step each frame and lifted. Where
each touch was goes into the shot's `info.json`, from which the edit draws the rings. On these
shots the interface runs on the shot's clock too: its CSS transitions are paused and stepped
1/30 s a frame, and a toast stays up for its seconds of the shot's time (the app ends it with a
real-time timer, which would end it between two frames). Every toast the app shows, in any shot,
is noted with its time in `info.json`, so what the trailer says can be checked against what the
app said.

God mode's three moments (v4) are touched the way the suites touch the app (scripts/live.mjs: the
`throw`, `place` and `hit` blocks), so a tap can also land where a function of the page finds it:
`pt` (a world on the screen, a slider's knob) and `toPt` (where a drag ends), found at that moment;
`live: true` finds the end of a drag afresh each frame and keeps the finger's height (a slider moves
down the page as the card round it changes, and a finger follows it); `run` does something with no
finger. A shot's `setup` may be async (the page runs on while it waits). A finger on a world is put
down on the world's dot on the screen, and the slingshot is pulled back from it by 152 px (the mark
of escape, 1.414 x 107 px) with the finger resting a moment before it lifts, so that the app's
flick (a quick finger) does not take it. The throw and the hit shots find their view as the suite
does: the eye is put over the Earth where the world has room ahead of it for the arrow and behind
it for the pull, clear of the card (a setup, not a power). The simulation's own stepping is held to
its full step (`sim.now`), and its run ahead (the dashed path) grows on the shot's clock.

A shot with `date.free` leaves the clock to the app: the ship's flight (it runs time itself) and a
change's watch (it sets the rate of time and moves the camera after a change) are the app's own,
from the shot's date. A shot's `keep` saves only some stretches of a long run (all of it is run).

Quality: the app's quality governor is off in automated browsers (`navigator.webdriver`), so every
frame is at level 0 (render scale 1, checked in each shot's `info.json`). The canvas is 1080x1920
at scale 3 (the app allows a phone its density of 3 up to 3.2 million pixels). The browser is a
touch phone to the app (`isMobile`, `hasTouch`), so it gets what a phone gets: the lighter
("lean") set of content, without the 8k maps a desktop loads.

## Decisions

- Vertical 9:16, 1080x1920, 30 fps, H.264 high profile, yuv420p, BT.709, AAC 48 kHz stereo,
  `+faststart`: plays on an iPhone and in social apps. Draft at 540x960 from the same CSS
  viewport (scale 1.5), so the layout does not change between draft and final.
- 54 s (asked: under 60, to fit Shorts, Reels and TikTok). Opens on the Sun's limb with its first
  words at 0.3 s ("The real universe."): the star faces are the best-looking thing in the app, and
  the first two seconds are not spent on a title.
- The order: the places (the Sun, Saturn, the Orion Nebula, Andromeda), the ship (from behind,
  then flown on a phone), a black hole, god mode (the Moon thrown, a world added, Mars thrown at
  the Earth), the pull-out and the title.
- Text only between 12 % and 80 % of the height (social apps cover the rest). Inter Display, drawn
  with Pillow (it has full text shaping here), a soft shadow under it for legibility. Over a
  phone's screen the line sits on a dark plate in the sky the interface leaves clear. The address
  sits in an outlined pill: it is the call to action.
- 80 beats a minute; cuts and text on beats (0.75 s: 22.5 frames, so a cut lands on the nearer
  frame); the title lands on the score's hit.
- Every claim on screen is true of the app as built (checked against README.md, HANDOFF.md and
  the code): real planet positions (the JPL ephemeris), real data and real physics (the catalogues
  the app is built on; live physics, "from now on everything here pulls on everything else", the
  app's own words), the ship and its controls on a phone, a black hole with its disk, the Moon
  thrown with the slingshot (Mover.ts) and where it goes (the card's and the toast's words),
  Add's "A planet like Earth" (App.add) with its mass slid to 5 Earths ("Rock, 1.71 times the
  Earth's size", read from the app: 5.00 Earths, 1.709 of its radius), Mars thrown at the Earth
  (Foresight.ts, Impacts.ts, Powers.impactWords: the card says "Mars hit Earth at 9.4 km/s", the
  energy as hours of the Sun's light and that Mars would break apart, and that breaking apart is
  not simulated yet), the watch and its chip, free and in the browser. Every number on a card is
  one the app showed; the words the trailer adds are only "Throw the Moon.", "Add a world." and
  "Throw Mars at the Earth.", which say what the finger is doing.
- Only what a phone user can reach today, filmed as a phone gets it (touch, the lean content).
  The Mars shot has one setup a finger did not make (as the suite's): Mars is put 40 Earth radii
  from the Earth, moving with it, so that the fall takes about two days of the app's time. From
  where Mars really is a throw takes months to arrive, and aiming it at a moving Earth from
  there is a puzzle, not a moment. It is why the app's "Live physics" bar is already up in that
  shot, and the toast of that move ("Mars goes round Earth now") is hidden.
- The interface is shown where it is the point: the ship flown by hand (the thrust lever, the
  view switch) and god mode (the card, Add, the mass slider, the watch's chip, the app's toasts).
  The ship's shot fills the 9:16 frame (the 360x640 viewport); god mode is filmed on an iPhone's
  (390x844), whose text at the frame's full height is about the size it is on the phone; its sides
  are a dark blurred copy of the screen. Names and orbit lines are off in the ship's shot (as More
  allows), and its toasts hidden: switching to the cockpit shows the desk's key help ("W/S throttle,
  arrows or drag to turn...") on a phone too, under the instruments (an app fault, reported).
- The ship: from behind at Jupiter on 24 November 2026 (the chase view, as a phone boards it), the
  reactionless drive's band lit; then over Saturn (15 June 2017, rings open) on a phone's screen:
  a thumb slides the thrust lever to the top, the fusion torch lights (its plume, the radiators
  heating), then a tap on the view switch and the same from the cockpit. The flight is the app's;
  the shot turns the ship by its attitude only (a slow yaw), so the ship leads into the turn.
- `earthref=0` on every link (the "Earth for scale" disc is drawn only with the names now, and
  the names are off, so it changes nothing; kept for older builds).
- No close-up of Earth: in daylight its cloud layer is flat grey patches, its deserts orange and
  its night lights too faint to show. Earth is seen only at the start of the pull-out, at an hour
  when the Pacific faces the camera (23:00 UTC) and not Africa or Australia, from 4 radii.
- Saturn is filmed on 15 June 2017 (rings wide open; in 2026 they are nearly edge-on to the Sun).
- A black hole: M87* from 6,000 to 20 horizon radii, a little above its disk (from far off a
  steady point on its jet, growing into the disk). Cygnus X-1 is out (v4's room), and Sagittarius A*
  stays out (the frame is a flat beige of the galactic centre's stars).
- The Moon thrown (Earth's date 21 November 2026, 12:00 UTC): the Moon's card on a phone's screen
  (390x844), Move, Throw (the card says "Pull back from it and let go, like a slingshot, or flick
  it."), a finger on the Moon pulled back to the mark of escape (the arrow, the "circle" and
  "escape" marks, the dashed path ahead that the app runs with every pull counted, and the card's
  "Now on an open path past Earth: it passes at 374,687 km, then leaves."), let go: the watch
  (3.4 days a second) and the app's toast "The Moon goes round the Sun now, no longer round
  Earth.". The eye is over the Earth, 260 Earth radii out, 75 degrees up.
- A world added (21 November 2026): the Sun's card, Add, "A planet like Earth": "Earth 2" appears
  1.21 AU out and time waits (the app's toast says so). The camera goes in to it (the shot's own
  move, 17 radii out, from where the app had it and back) so that the mass slid up to 5 Earths
  shows as it is: the card "5 Earths, Rock, 1.71 times the Earth's size" and the world grown by
  that much. Then the finger drags it out half as far again (1.57 AU), Done, and the watch
  (90.1 days a second) goes round the planets with Earth 2 among them. The footage goes on to
  the watch's chaos (a 5-Earth planet at 1.57 AU is a heavy neighbour for Mars and Jupiter, and
  the app slows time for the hits it finds): the cut ends before it.
- Mars thrown at the Earth: Mars's card, Move, Throw, a finger on Mars pulled back from the Earth
  66 px so that the arrow points at it: "Now on a path into Earth: it hits it." and, with every
  pull counted, "it hits Earth in 1.6 days"; let go, and the watch (20.1 hours a second); as the
  two near, time slows ("Slowed: 1.5 hours a second", for the last of the fall to take about
  three seconds), the flash (a depiction: the app says its brightness is not worked out), and the
  hit's card: "Mars hit Earth at 9.4 km/s", "Energy 2.5x10^31 J: as much as the Sun gives off in
  18.4 hours. 5.2 times the energy that holds Mars together." and the prediction, labelled. The
  cut crosses the dull middle of the fall with a dissolve (the date says so).
- The pull-out has one cross-fade inside it, from the field of nearby stars to the moment the
  whole Milky Way is in view. The seam the galaxy's glow showed while being redrawn is gone
  (f073b73), but between about 1 and 15 kpc, close by and from inside, the glow is still a soft
  low-resolution beige wash with no stars (seen on stills of this build), so the cut still steps
  over that second.
- Not in it: Achernar and Altair (they look odd), TRAPPIST-1 e (its generated surface glows), the
  Moon's ground (dark hard-edged patches near the landing sites), Earth's day side.
- Dropped from v3 for v4's room, weakest first: Titan (a beat and a half of a moon, with
  Saturn's shot already carrying the rings, and the Orion Nebula and Andromeda in the same run of
  places), Cygnus X-1 (a beat and a half, too short for the eye to find the
  star), the second sun twice (on the phone's screen, then from over the
  planets, filmed at half density: Add is now shown with "A planet like Earth", the world itself
  in view), Jupiter twenty times heavier (nine seconds of interface for one idea, the mass slider,
  which "Add a world" now shows with the planet itself growing). Their definitions are in
  the git history (version 3's shots.mjs).
- Rings where a finger touches the screen (a tap: a ring that grows and fades; a drag: a ring
  that follows the finger): the one overlay on footage, marking real touches.
- The music is a placeholder: warm pad (chords every two bars or so), a bass note with overtones
  (so a phone speaker, which plays nothing below about 150 Hz, still carries it), a sparse FM bell
  motif (one high note as the Moon is let go, another when Done is tapped), an arpeggio that grows
  from the ship on, the fusion torch's roar while it burns on screen (a band of fluttering noise),
  a rush of noise that climbs as the Moon is let go, a low tone that falls while time slows for
  Mars's last fall and a low boom on the flash, a rising noise into the title, one low hit, one
  convolution reverb (decaying noise). It swells about 8 dB from the
  first bar to the title, peaks at -1 dBFS and is never clipped.

## Add a shot

1. Try framings with a candidates file in the style of `shots.mjs` and
   `node trailer/capture.mjs --shots /tmp/cand.mjs --out /tmp/c --scale 1.5 --stills 2`, then
   `python3 trailer/sheet.py /tmp/c.png /tmp/c/*` and look.
2. Add the one you keep to `shots.mjs` (footage a little longer than it will be on screen: a
   dissolve out of it needs that much more).
3. Put it in `CUTS` in `timeline.py` on the grid (and a text card in `TEXT` if it needs one),
   capture it alone with `--only`, re-render the score if the length changed, and edit again.

## As made

Version 4 was filmed from commit 35fc045 (god mode with Throw, Add's planet, impacts you can see and
the future drawn; the Milky Way's glow, Cygnus X-1's exposure and the ship's mask fixed since v3),
production build, quality level 0, lean (phone) content. Every shot was filmed afresh; nothing is
kept from version 3's frames.

Changed from version 3: Titan, Cygnus X-1, both second-sun shots and Jupiter twenty times
heavier are out; the Moon thrown, a world added and Mars thrown at the Earth
are in (all on a phone's screen, whole-page screenshots with a ring where a finger touches). The
opening text is at 0.3 s, the tagline says "Real data. Real physics.", the score is re-timed to
the cut (beats, not bars, and new sounds for the throw, Done and the hit), and the title lands at
49.5 s as before, in a trailer of 54 s.

Measured on a shared four-core machine with software WebGL, other suites running beside it (the
capture under `nice -n 10`):

| | full size |
|---|---|
| a phone-screen frame (1170x2532 screenshot) | 1.5 to 1.6 s |
| boot and settle, per shot | 20 to 145 s |
| the three god-mode shots (all frames kept: about 220, 280 and 290) | 8 to 11 min each |
| edit (numpy compositing + x264 slow) | about 8 min |
| score | 15 s |

Version 3 (49.5 s) is in the git history, as are its shots; its notes follow.

Version 3 was filmed from commit 96ff6fc (the new ship and its controls on a phone, Add with a
second sun, god mode's watch, Replay and Undo, Titan's haze, the Milky Way's glow without its
seam), production build, quality level 0, lean (phone) content. Every shot was filmed afresh;
nothing is kept from version 2's frames.

Changed from version 2: Jupiter, Mars, the comet and the interface shot (tap the Moon, Go there)
are out; Titan, the ship (two shots), the second sun (two shots) and Jupiter twenty times heavier
are in; live gravity with Jupiter a thousand times heavier (a stand-in while Add had not landed)
is replaced by the second sun.

Measured on a shared four-core machine with software WebGL and three test suites running beside
it (the capture under `nice -n 19`):

| | full size |
|---|---|
| one kept frame incl. PNG readback | 0.8 to 2.5 s (Orion Nebula 5.8 s, Andromeda 4.4 s) |
| a phone-screen frame (1170x2532 screenshot) | 1.4 to 2.5 s |
| boot and settle, per shot | 40 to 200 s (one boot took 10 min under load) |
| the pull-out (363 frames) | 16 min |
| all thirteen shots | about 1 h 40 min |
| edit (numpy compositing + x264 slow) | 6 min |
| score | 10 s |
