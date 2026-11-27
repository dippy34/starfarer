# Phone speed (the fix list's #2: "slow on iPhone")

## 27 Nov 2026, night: where the main thread's time goes

Measured here (headless Chromium, a 390x844 phone viewport, the CPU slowed 4 times with
`Emulation.setCPUThrottlingRate`; the app's own per-layer laps, `PERF` in `src/perf/Perf.ts`, over 40
frames; the script was a scratch one, not kept). SwiftShader draws on the CPU, so the frame-to-frame
times (185-416 ms) say nothing of a phone; the laps of the app's own JavaScript do.

| scene | App.frame CPU (4x slowed) | biggest laps (ms) |
|---|---|---|
| Earth from orbit | 37.1 ms | render 9.1, overlay 6.8, cam 5.7, sim 5.4, orbits 2.7, stars 2.5, bodies 2.4 |
| the Solar System from afar | 36.6 ms | stars 8.3, overlay 6.6, render 6.3, cam 5.1, sim 4.7, orbits 2.4 |
| Saturn close | 41.5 ms | render 9.9, overlay 7.6, sim 6.4, orbits 4.9, cam 4.8, stars 2.7 |
| deep sky (Orion) | 28.1 ms | stars 5.5, sky 5.4, overlay 4.8, render 4.8, sim 2.3 |

So, unslowed, the JavaScript of a frame is some 7 to 10 ms on this machine's core, and a recent
iPhone's cores are about as fast: the JavaScript alone leaves room for 60 frames a second. "overlay"
is overstated here: `updateHud` runs every 0.1 s, so at these slow frames it ran every frame, on a
phone every third to sixth. What is left to suspect on an iPhone is its GPU: the canvas is drawn at
the screen's own 3 pixels to a CSS pixel (`canvasRatio`, `src/core/device.ts`: 1170x2532 on a 390x844
phone, under `CANVAS_PIXELS`), and the quality governor (`src/render/Quality.ts`) lowers the scene's
resolution when frames are slow.

Next: the owner's benchmark code from the phone itself (`https://starfarer.pages.dev/?bench=1`,
decoded with `node scripts/bench-decode.mjs <code>`): its frame times per scene say whether the
governor keeps up, and which scenes are slow.

## 27 Nov 2026: the owner's iPhone 13 (Chrome for iOS 158, iOS 27.2.1; the testers' site, 936d146)

`SB1z.jZJBaxsx…` decoded (`node scripts/bench-decode.mjs`): 60 Hz, canvas 1170x1998, no GPU timer.

| scene | median | fps | 1 % low | dropped | CPU (App.frame) | draw calls | triangles | level |
|---|---|---|---|---|---|---|---|---|
| Earth from orbit | 17.0 ms | 59 | 30.6 ms | 16/438 | 4 ms | 94 | 63k | 3 |
| Earth's surface | 17.0 | 59 | 29.4 | 6/453 | 3 | 89 | 63k | 3 |
| Saturn's rings | 35.0 | 29 | 54.3 | 268/222 | 7 | 138 | 389k | 3 |
| Jupiter | 17.0 | 59 | 33.4 | 6/460 | 3 | 133 | 96k | 3 |
| Orion nebula | 23.0 | 43 | 93.0 | 152/328 | 5 | 85 | 6k | 3 |
| Cygnus X-1 | 25.0 | 40 | 53.0 | 169/296 | 5 | 77 | 35k | 3 |
| Andromeda | 23.0 | 43 | 37.8 | 122/343 | 4 | 34 | 4k | 3 |
| the Milky Way | 37.0 | 27 | 47.0 | 248/223 | 8 | 50 | 4k | 3 |
| cockpit | 27.0 | 37 | 483.7 | 252/241 | 5 | 179 | 136k | 3 |

What it says:
- The main thread is never the limit (3 to 8 ms of 16.7): the GPU is, as above.
- The quality governor sat at its lowest level, 3, in every scene: the scene drawn at 0.4 of the
  canvas (1.2 pixels to a CSS pixel), so even the easy scenes were blurrier than they need be. It
  never stepped back up because a step up needs 5 s without a single late frame, and the easy
  scenes still had one every half second or so (16 in 438 frames).
- Even at that level, the heavy scenes miss 60 Hz: the Milky Way's volume (37 ms), Saturn's rings
  close up (35 ms, 389k triangles of ring particles), the cockpit (27 ms, and one 484 ms hitch,
  most likely a material compiled the first time it is drawn), Cygnus X-1's lensing (25 ms), the
  Orion nebula's and Andromeda's volumes (23 ms). These are costs per pixel of heavy shaders, and
  per triangle in the rings, not the canvas's size.

Next, in order: let the governor step up again when late frames are rare, not none (sharper where the
phone can afford it); cut the heavy scenes' work on a phone (fewer steps in the volumes, fewer ring
particles, the black hole's lensing cheaper); warm the cockpit's materials up with the rest. Then the
owner runs the benchmark again on the developers' site (https://dev.starfarer.pages.dev/?bench=1).
