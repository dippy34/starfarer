// Looking away from something bright, and back: the eye's adaptation must never flash.
//
// For the Sun near and far, a star, worlds near and far, a ringed planet and two black holes, the view turns away
// a frame at a time (the app's own loop is stopped and frames are stepped by hand, a tenth of a
// second each, so every run is the same) and every frame is measured: how much of it is burnt out,
// how bright it is, what the exposure and the Sun's glare are doing.
//   - nothing burns out while the bright thing is leaving the frame (a black hole's disk used to
//     white out the whole screen the moment its centre left)
//   - once it has gone, no glare is left as a veil over the dark sky
//   - the stars come out over a moment, not in one frame; and after a sun has left, within a second
//     (a sun's own face has an exposure of its own: the worlds beside it keep theirs)
//   - turning back, the frame does not flash white
// Usage: node scripts/exposure.mjs [baseUrl] [outDir] [scene...]   (frames are saved to outDir/<scene>)
import { collectErrors, launchBrowser } from './lib/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'screenshots';
const only = process.argv.slice(4);
const browser = await launchBrowser();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const errors = [];

/** what is looked at: where (query), and the radius (in its own radii) of all of it that shines */
const SCENES = [
  // (a far Sun is all glare; a near one's face has its own corona, and nearly none)
  { id: 'sun-far', label: 'the Sun from 40 radii', query: 'target=Sun&dist=40', extent: 1, glare: 'bright', light: true },
  { id: 'sun', label: 'the Sun from 8 radii', query: 'target=Sun&dist=8', extent: 1, glare: 'faint', light: true },
  { id: 'sirius', label: 'Sirius from 6 radii', query: 'target=Sirius&dist=6', extent: 1, light: true },
  { id: 'earth', label: 'the Earth', query: 'target=Earth&dist=4.9', extent: 1 },
  { id: 'earth-close', label: 'the Earth filling the view', query: 'target=Earth&dist=1.5', extent: 1 },
  { id: 'saturn', label: 'Saturn and its rings', query: 'target=Saturn&dist=4', extent: 2.35 },
  { id: 'cygnus-x1', label: 'the disk of Cygnus X-1', query: 'target=Cygnus%20X-1&dist=40', disk: true },
  { id: 'sgr-a', label: 'the disk of Sagittarius A*', query: 'target=Sagittarius%20A*&dist=60', disk: true },
];
const STEP = 3, TURN = 40, HOLD = 24, BACK = 6;

for (const scene of SCENES) {
  if (only.length && !only.includes(scene.id)) continue;
  const dir = path.join(outDir, `exposure-${scene.id}`);
  fs.mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  collectErrors(page, errors);
  await page.goto(`${base}?menu=0&time=2026-10-01T20:00:00Z&${scene.query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.app && window.app.frameCount > 30, null, { timeout: 600000 });
  await page.waitForFunction(() => window.app.debugState().pendingTiles === 0, null, { timeout: 180000 }).catch(() => undefined);
  // the app's own loop off: one frame per step from here on, a tenth of a second of its time each
  const geo = await page.evaluate(() => {
    const a = window.app;
    a.renderer.gl.setAnimationLoop(null);
    a.hud.setHidden(true);
    a.labels.enabled = false;
    a.orbits.enabled = false;
    const t = a.rig.target;
    const d = t.upos.sub(a.rig.upos).length();
    const half = Math.atan(Math.tan((a.rig.fovY * Math.PI) / 360) * (a.rig.viewport.width / a.rig.viewport.height));
    return { half: (half * 180) / Math.PI, dist: d, radius: t.radius, diskOuter: t.diskOuter ?? 0, dark: null };
  });
  const frame = (deg) => page.evaluate(async ([deg, light]) => {
    const a = window.app, r = a.rig;
    if (deg) r.quat.multiply(r.quat.clone().set(0, Math.sin((deg * Math.PI) / 360), 0, Math.cos((deg * Math.PI) / 360)));
    await new Promise((res) => setTimeout(res, 105));
    a.frame();
    // the frame as drawn, small: how bright, how much of it burnt out
    const c = window.__meter ?? (window.__meter = Object.assign(document.createElement('canvas'), { width: 96, height: 96 }));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(a.renderer.gl.domElement, 0, 0, 96, 96);
    const px = g.getImageData(0, 0, 96, 96).data;
    let sum = 0, burnt = 0;
    for (let i = 0; i < px.length; i += 4) {
      const y = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      sum += y;
      // (burnt out: white, or one colour driven to the top, as a red glow is before it goes white)
      if (y >= 245 || Math.max(px[i], px[i + 1], px[i + 2]) >= 252) burnt++;
    }
    const d = a.debugState();
    // (what is looked at is exposed by `x`: a sun's face by the light exposure, anything else by the surfaces')
    return { mean: sum / (96 * 96), burnt: burnt / (96 * 96), x: Math.log(light ? d.lightExposure : d.exposure), xs: Math.log(d.starExposure), glare: d.glare };
  }, [deg, !!scene.light]);
  const log = [];
  const rec = async (deg, yaw, phase) => {
    const m = await frame(deg);
    log.push({ i: log.length, yaw, phase, ...m });
    if (log.length % 2 === 1) await page.screenshot({ path: path.join(dir, `f${String(log.length - 1).padStart(3, '0')}.png`) });
  };
  for (let i = 0; i < 25; i++) await frame(0);            // settle on it
  let yaw = 0;
  await rec(0, yaw, 'at');
  for (let k = 0; k < TURN; k++) { yaw += STEP; await rec(STEP, yaw, 'away'); }
  for (let k = 0; k < HOLD; k++) await rec(0, yaw, 'dark');
  for (let k = 0; k < (TURN * STEP) / BACK; k++) { yaw -= BACK; await rec(-BACK, yaw, 'back'); }
  for (let k = 0; k < 10; k++) await rec(0, yaw, 'again');
  fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify(log));

  // --- what the frames must show
  const at = log[0], dark = log.filter((f) => f.phase === 'dark').pop(), again = log[log.length - 1];
  const size = scene.disk ? (Math.asin(Math.min(1, geo.diskOuter / geo.dist)) * 180) / Math.PI : (Math.asin(Math.min(1, (geo.radius * scene.extent) / geo.dist)) * 180) / Math.PI;
  const gone = geo.half + size;                             // yaw at which the last of it leaves the frame
  const away = log.filter((f) => f.phase === 'away' || f.phase === 'dark');
  const worst = (list, key) => list.reduce((m, f) => (f[key] > m[key] ? f : m), list[0]);
  const burn = worst(away, 'burnt');
  check(`${scene.label}: nothing burns out while it leaves the frame`, burn.burnt <= at.burnt + 0.02, `most burnt-out frame: ${(burn.burnt * 100).toFixed(1)} % at ${burn.yaw} deg (looking at it: ${(at.burnt * 100).toFixed(1)} %)`);
  // while any of it is in the frame the exposure holds (within a factor of e either way... a disk's rises as its hot middle leaves)
  if (!scene.disk) {
    const inFrame = away.filter((f) => f.yaw < gone - 1);
    const drift = Math.max(...inFrame.map((f) => f.x - at.x));
    check(`${scene.label}: the exposure holds while any of it is in the frame`, drift < 1.2, `rose by a factor ${Math.exp(drift).toFixed(2)} at most (it leaves at ${gone.toFixed(0)} deg)`);
  }
  // the eye opens up over a moment: from the frame it starts to rise to nine tenths of the way there
  const start = away.findIndex((f) => f.x > at.x + 0.5);
  if (start > 0 && dark.x - at.x > 3) {
    const end = away.findIndex((f, i) => i >= start && f.x >= at.x + 0.9 * (dark.x - at.x));
    check(`${scene.label}: the stars come out over a moment, not in a frame`, end - start >= 6, `${((end - start) / 10).toFixed(1)} s to open up ${(dark.x - at.x).toFixed(0)} e-folds`);
    const jump = Math.max(...away.slice(1).map((f, i) => f.x - away[i].x));
    check(`${scene.label}: the exposure never leaps`, jump < 4.2, `largest step in a frame: ${jump.toFixed(2)} e-folds`);
  }
  if (scene.light) {
    // a sun puts the stars out while it is in the frame; once it is a margin beyond the edge they are back within a second
    // (back: within a magnitude and a half of the sky in the dark; the last of it comes as the eye opens for the dark itself)
    const out = away.findIndex((f) => f.yaw > gone + 0.4 * geo.half);
    const back = away.findIndex((f, i) => i >= out && f.xs >= dark.xs - 1.5);
    check(`${scene.label}: the stars are out while it is in the frame, and back within a second of its leaving`,
      at.xs < dark.xs - 5 && out > 0 && back >= out && back - out <= 10, `${((back - out) / 10).toFixed(1)} s after it has left; ${(dark.xs - at.xs).toFixed(0)} e-folds dimmer with it in view`);
  }
  if (scene.glare) {
    const veil = away.filter((f) => f.yaw > gone + 0.4 * geo.half);
    check(`${scene.label}: no glare is left over the sky once it has gone`, veil.length > 5 && veil.every((f) => f.glare === 0), `glare ${Math.max(...veil.map((f) => f.glare)).toFixed(3)} at most beyond ${(gone + 0.4 * geo.half).toFixed(0)} deg`);
    const lit = log.filter((f) => f.phase === 'away' && f.yaw < geo.half * 0.5);
    if (scene.glare === 'bright') check(`${scene.label}: the glare is there while it is in view`, lit.every((f) => f.glare > 0.2), `glare ${Math.min(...lit.map((f) => f.glare)).toFixed(2)} at least`);
  }
  // turning back: no flash as it comes into the frame, and the same view as before at the end
  const back = log.filter((f) => f.phase === 'back' || f.phase === 'again');
  const flash = worst(back, 'burnt');
  // (how bright the dark-adapted sky itself gets on the way back, with the thing still well out of the frame: the Milky Way is not a flash)
  const sky = Math.max(dark.mean, ...back.filter((f) => f.yaw > gone + 0.4 * geo.half).map((f) => f.mean));
  check(`${scene.label}: turning back does not flash`, flash.burnt <= at.burnt + 0.03 && Math.max(...back.map((f) => f.mean)) <= Math.max(at.mean, sky) * 1.35 + 8,
    `most burnt-out frame ${(flash.burnt * 100).toFixed(1)} %, brightest frame ${Math.max(...back.map((f) => f.mean)).toFixed(0)} (looking at it ${at.mean.toFixed(0)}, the sky alone ${sky.toFixed(0)})`);
  check(`${scene.label}: looking at it again it looks as it did`, Math.abs(again.x - at.x) < 0.05 && Math.abs(again.mean - at.mean) < 0.06 * at.mean + 2, `exposure x${Math.exp(again.x - at.x).toFixed(3)}, brightness ${at.mean.toFixed(1)} -> ${again.mean.toFixed(1)}`);
  await page.close();
}

console.log(errors.length ? `console errors:\n${errors.slice(0, 10).join('\n')}` : 'no console errors');
check('no console errors', errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
