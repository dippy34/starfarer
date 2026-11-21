# The trailer

A 39-second vertical trailer for Starfarer, for people who have never seen it and are scrolling
on a phone. Every picture in it is the app itself, built from this repository and filmed frame by
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

`--only sun,earth` re-films some shots (each shot is its own folder, so one can be redone alone);
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
- 39 s (asked: 30 to 40). Opens on the Sun's limb with no text for 1.5 s: the star faces are the
  best-looking thing in the app and need no explaining.
- Text only between 12 % and 80 % of the height (social apps cover the rest). Inter Display, drawn
  with Pillow (it has full text shaping here), a soft shadow under it for legibility. The address
  sits in an outlined pill: it is the call to action.
- 80 beats a minute; cuts on bars and half bars (multiples of 45 frames), text on beats; the
  title lands on the score's hit.
- Every claim on screen is true of the app as built: real planet positions (the JPL ephemeris),
  time control, tap and "Go there", the pull-out filmed in one camera move, free and in the
  browser. No numbers on screen.
- Only what a phone user can reach today: places reached by search or a tap and "Go there",
  looking round them, time control. No landing, walking or ship.
- No black hole: the lighting fix had not landed on the branch when this was filmed.
- `earthref=0` on every link: the "Earth for scale" disc the app draws on big worlds reads as a
  glitch to someone who does not know what it is.
- Earth is half lit and small in the frame, and short: close up in daylight its cloud layer is
  flat grey patches, and its night lights are too faint to show (they are about 2 % of daylight,
  and the eye adapts to any sunlit sliver in view).
- Saturn is filmed on 15 June 2017 (rings wide open; in 2026 they are nearly edge-on to the Sun).
  Jupiter on 24 November 2026 from 01:45 UTC: Europa's shadow on the disc, Io's coming on (found
  with the app's own ephemeris).
- The interface shot flies from Earth to the Moon, not to Titan as first tried: Titan arrives as a
  grey patchwork with a visible seam.
- The pull-out has one cross-fade inside it, from the field of nearby stars to the moment the
  whole Milky Way is in view. Between about 1 and 15 kpc the galaxy's glow, looked at towards the
  centre, goes white and shows a hard seam while it is being rebuilt; the app's own flight to the
  Milky Way crosses that stretch in about a second (the seam shows there too).
- Tap rings on the interface shot: the one overlay on footage, marking real taps.
- The music is a placeholder: warm pad (chords every two bars), a bass note with overtones (so a
  phone speaker, which plays nothing below about 150 Hz, still carries it), a sparse FM bell
  motif, an arpeggio that grows from the middle, a rising noise into the title, one low hit, one
  convolution reverb (decaying noise). It swells about 12 dB from the first bar to the title,
  peaks at -1 dBFS and is never clipped.

## Add a shot

1. Try framings with a candidates file in the style of `shots.mjs` and
   `node trailer/capture.mjs --shots /tmp/cand.mjs --out /tmp/c --scale 1.5 --stills 2`, then
   `python3 trailer/sheet.py /tmp/c.png /tmp/c/*` and look.
2. Add the one you keep to `shots.mjs` (footage a little longer than it will be on screen: a
   dissolve out of it needs that much more).
3. Put it in `CUTS` in `timeline.py` on the grid (and a text card in `TEXT` if it needs one),
   capture it alone with `--only`, re-render the score if the length changed, and edit again.

## As made

Filmed from commit 8dff677 (the branch with the relativistic ship merged in; no black-hole
lighting fix yet), production build, quality level 0, lean (phone) content.

Measured on a shared four-core machine with software WebGL, the load around 4 to 6 (everything under `nice`):

| | draft 540x960 | full 1080x1920 |
|---|---|---|
| one stepped frame, Sun (no readback) | 0.22 s | 0.9 s |
| one kept frame incl. PNG readback | 0.2 to 1.9 s | 0.8 to 2.2 s (Orion Nebula 5.8 s, Andromeda 4.1 s) |
| boot and settle, per shot | 20 to 60 s (Orion 220 s) | 40 to 130 s (Orion 630 s) |
| whole capture (11 shots, 1,560 kept frames) | about 25 min | 70 min (pull-out alone 15 min) |
| edit (numpy compositing + x264 slow) | 1 min | 4 min |
| score | 9 s | 9 s |
