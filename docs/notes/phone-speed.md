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
