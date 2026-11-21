# The trailer

A 45-second vertical trailer for Starfarer (version 2), for people who have never seen it and are
scrolling on a phone. Every picture in it is the app itself, built from this repository and filmed frame by
frame in a headless browser; the edit adds only cuts, cross-fades, fades, text, a phone around the
interface shot and a ring where that shot's finger taps. The music is an original piece
synthesised here with numpy: a placeholder, easy to replace.

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
export CHROMIUM_PATH=/opt/pw-browsers/chromium       # where the container keeps Chromium
OUT=/tmp/trailer                                     # frames: about 3 GB at full size
nice -n 10 node trailer/capture.mjs --out $OUT/frames --scale 3      # 1080x1920 (--scale 1.5: 540x960 draft)
nice -n 10 python3 trailer/score.py $OUT/score.wav
nice -n 10 python3 trailer/edit.py $OUT/frames $OUT/score.wav $OUT/starfarer-trailer.mp4 --size 1080x1920
python3 trailer/sheet.py $OUT/contact.png --video $OUT/starfarer-trailer.mp4
```

`--only sun,saturn` re-films some shots (each shot is its own folder, so one can be redone alone);
`--stills 3` films only three frames of each (with the full pre-roll) for trying out a framing.
`--shots other.mjs` takes another shot list (candidates). Another size: capture at another
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

The interface shot is filmed on an iPhone-sized viewport (390x844 CSS px) with whole-page
screenshots; its taps are real touch events sent through the DevTools protocol to a name in the
sky or a button found by its text, and their positions go into the shot's `info.json`, from
which the edit draws the tap rings. The flight is the app's own autopilot.

Quality: the app's quality governor is off in automated browsers (`navigator.webdriver`), so every
frame is at level 0 (render scale 1, checked in each shot's `info.json`). The canvas is 1080x1920
at scale 3 (the app allows a phone its density of 3 up to 3.2 million pixels). The browser is a
touch phone to the app (`isMobile`, `hasTouch`), so it gets what a phone gets: the lighter
("lean") set of content, without the 8k maps a desktop loads.

## Decisions

- Vertical 9:16, 1080x1920, 30 fps, H.264 high profile, yuv420p, BT.709, AAC 48 kHz stereo,
  `+faststart`: plays on an iPhone and in social apps. Draft at 540x960 from the same CSS
  viewport (scale 1.5), so the layout does not change between draft and final.
- 45 s (asked: 40 to 50). Opens on the Sun's limb with no text for 1.5 s: the star faces are the
  best-looking thing in the app and need no explaining.
- Text only between 12 % and 80 % of the height (social apps cover the rest). Inter Display, drawn
  with Pillow (it has full text shaping here), a soft shadow under it for legibility. The address
  sits in an outlined pill: it is the call to action.
- 80 beats a minute; cuts on bars and half bars (multiples of 45 frames), text on beats; the
  title lands on the score's hit.
- Every claim on screen is true of the app as built (checked against README.md and HANDOFF.md):
  real planet positions (the JPL ephemeris), time control, black holes with their disks, tap and
  "Go there", live gravity (a world's Mass, at the top of its slider, is a thousand times its
  real mass, and from the first change everything in the system pulls on everything else), the
  pull-out filmed in one camera move, free and in the browser.
- Only what a phone user can reach today: places reached by search or a tap and "Go there",
  looking round them, time control, the powers on a world's card. No landing, walking or ship
  (the ship's look is being redesigned; it joins in a later version).
- `earthref=0` on every link (the "Earth for scale" disc is drawn only with the names now, and
  the names are off, so it changes nothing; kept for older builds).
- No close-up of Earth: in daylight its cloud layer is flat grey patches, its deserts orange and
  its night lights too faint to show. Earth is seen only in the interface shot (small, in the
  phone) and at the start of the pull-out, both at an hour when the Pacific faces the camera
  (20:00 and 23:00 UTC) and not Africa or Australia; the pull-out starts at 4 radii, not 3.2.
- Saturn is filmed on 15 June 2017 (rings wide open; in 2026 they are nearly edge-on to the Sun).
  Jupiter on 24 November 2026 from 01:45 UTC: Europa's shadow on the disc, Io's coming on (found
  with the app's own ephemeris).
- Black holes: M87* from 6,000 to 20 horizon radii, a little above its disk (from far off a
  steady point on its jet, growing into the disk), then Cygnus X-1 with its blue supergiant. Not
  Sagittarius A* (the frame is a flat beige of the galactic centre's stars), and Cygnus X-1 is
  joined close in: farther out, as the camera comes in, the supergiant's limb shows a notch at
  the edge of the hole's region (a known fault, HANDOFF.md).
- Live gravity: the Solar System from over the ecliptic's pole, orbit lines off and the
  simulation's trails on (the orbit lines are drawn afresh from each world's motion and jump about
  once the system is wild). Jupiter at a thousand times its mass: the Add power (a second sun)
  had not landed when this was filmed. Filmed at half density (scale 1.5) and scaled up, so the
  one-pixel trails are two pixels wide on the 1080 frame. The capture holds still the clock the
  simulation budgets its steps by, so each frame's step is made in full whatever the machine's load.
- The interface shot flies from Earth to the Moon, not to Titan: Titan arrives as a grey
  patchwork with a visible seam. The Moon's card now shows the powers (Mass, Move, Remove).
- The pull-out has one cross-fade inside it, from the field of nearby stars to the moment the
  whole Milky Way is in view. Between about 1 and 15 kpc the galaxy's glow, looked at towards the
  centre, goes white and shows a hard seam while it is being rebuilt; the app's own flight to the
  Milky Way crosses that stretch in about a second (the seam shows there too).
- Not in it: Titan (grey patchwork, a seam, no haze), Achernar and Altair (they look odd),
  TRAPPIST-1 e (its generated surface glows).
- Tap rings on the interface shot: the one overlay on footage, marking real taps.
- The music is a placeholder: warm pad (chords every two bars, closer together from the
  interface shot on), a bass note with overtones (so a phone speaker, which plays nothing below
  about 150 Hz, still carries it), a sparse FM bell motif, an arpeggio that grows from the middle,
  a rising noise into the title, one low hit, one convolution reverb (decaying noise). It swells
  about 8 dB from the first bar to the title, peaks at -1 dBFS and is never clipped.

## Add a shot

1. Try framings with a candidates file in the style of `shots.mjs` and
   `node trailer/capture.mjs --shots /tmp/cand.mjs --out /tmp/c --scale 1.5 --stills 2`, then
   `python3 trailer/sheet.py /tmp/c.png /tmp/c/*` and look.
2. Add the one you keep to `shots.mjs` (footage a little longer than it will be on screen: a
   dissolve out of it needs that much more).
3. Put it in `CUTS` in `timeline.py` on the grid (and a text card in `TEXT` if it needs one),
   capture it alone with `--only`, re-render the score if the length changed, and edit again.

## As made

Version 2 was filmed from commit 2b86955 (the black hole's lighting fix, live gravity with Mass,
Remove and Move, Saturn's rings and Earth for scale fixed), production build, quality level 0,
lean (phone) content. Add (a second sun) had not landed by 23:00 UTC, so the live shot makes
Jupiter heavy instead; the ship is left out until its new look is live.

Re-filmed: Saturn (its rings no longer show the planet's edge through them), the Sun (its face
moves from one run to the next: about half its pixels differ from version 1's), the interface
shot (the Moon's card now has the powers; Earth turned to the Pacific), the pull-out (Earth
turned to the Pacific, starting at 4 radii), and the new shots: M87*, Cygnus X-1, live gravity.
Kept from version 1, each after a fresh still from this build matched its first frame: Jupiter,
Mars, the comet and the Orion Nebula to the pixel; the Andromeda Galaxy to within 2 levels in
99.9 % of the pixels (4 pixels of 2 million more than 16 levels off). Earth and the Moon's close
shots are left out.

Measured on a shared four-core machine with software WebGL and three test suites running beside
it (the capture under `nice -n 19`):

| | full 1080x1920 |
|---|---|
| one kept frame incl. PNG readback | 0.8 to 2.2 s (M87* 2.9 s, Orion Nebula 5.8 s, Andromeda 4.1 s) |
| boot and settle, per shot | 30 to 150 s |
| the pull-out (363 frames) | 15 min |
| live gravity at 540x960 (228 frames) | 3 min |
| edit (numpy compositing + x264 slow) | 6 min |
| score | 9 s |
