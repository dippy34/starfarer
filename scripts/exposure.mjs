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
//
// Coming up to a black hole and going away again, as a pinch does (APPROACHES): turning the view
// was all the scenes above did, and a far-off hole whose glow swelled, shrank and changed colour
// as the eye moved got past them. From a hundred light years (for M87*) to the horizon's doorstep
// and back, a frame at a time, the light round the hole is measured:
//   - it is a point with a tight glare from afar, not a ball of light
//   - it is steady: no leap from one frame to the next, and no falling back as the eye comes nearer
//   - it is a matter of where the eye is: the same going away, fast, as it was coming
//   - its colour holds
//   - from far outside (M87* from round its galaxy), where it is a point alone, it has the same light
//
// The big look (scene 'big-look'): far worlds drawn larger than they are, in their real places. From open space Jupiter
// is a lit disc in its colours, not burnt out, and the eye's exposure is the same as with Real size on (a point there);
// from the Earth's neighbourhood the other planets are the points they are. The planets of other stars too: 51 Peg b
// from half an AU off its star is a lit disc, a point with Real size on.
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
// (A frame is a tenth of a second of the app's time: App.frame clamps its step to 0.1 s, so each
// frame is stepped at least 105 ms after the one before it began (App.lastTime). The measuring and
// the screenshots between frames take longer than that here, and are no longer followed by a
// further 105 ms of waiting; a frame that comes sooner still waits out the rest.)

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
    await new Promise((res) => setTimeout(res, Math.max(0, 105 - (performance.now() - (window.app.lastTime ?? performance.now())))));
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

/**
 * The holes come up to: from how far, and how near (in Schwarzschild radii), and how far out the
 * disk is bright (`bright`, radii: a cool disk's glow is its inner ring; Cygnus X-1's, at millions
 * of degrees inside, is still hotter than a star's face a thousand radii out). A hole with a star
 * for a companion is come up to from where the star stands to one side of it, 25 degrees above
 * the disk: with the star behind the hole, or in front of it, the light round the hole is the
 * star's. (Cygnus X-1's is a supergiant two fifths as wide as the two are apart: from farther off
 * than this its glare is over the hole from every side.) `outside`: places far beyond where the
 * hole bends the sky by a pixel, where its disk is a point of light and nothing else is drawn of
 * it (for M87*: 40,000, 8,000 and 1,600 light years, in and round its galaxy).
 */
const APPROACHES = [
  { id: 'approach-m87', label: 'M87*', target: 'M87*', outside: [2e7, 4e6, 8e5], far: 5e4, near: 6, bright: 16 },
  { id: 'approach-sgr-a', label: 'Sagittarius A*', target: 'Sagittarius A*', far: 5e4, near: 6, bright: 16 },
  { id: 'approach-quasar', label: 'the quasar 3C 273', target: '3C 273', far: 5e4, near: 6, bright: 16 },
  { id: 'approach-cygnus-x1', label: 'Cygnus X-1', target: 'Cygnus X-1', far: 2e6, near: 6, bright: 800 },
  { id: 'approach-a0620', label: 'A0620-00, a quiet disk', target: '3A 0620-003', far: 1e6, near: 6, bright: 16 },
];
/** (the height above the disk a hole with a companion is come up to from, degrees) */
const ABOVE = 25;
/** each frame comes this much nearer on the way in, and goes this much farther on the way out (a quick pinch) */
const IN = 0.84, OUT = 1.45;
/**
 * The hole's light is measured in the frame as it is before the glow and the tone curve
 * (Renderer.lightAt: the screen shows a glint and a ball a thousand times too bright alike, as
 * white), within NEAR CSS px of the hole each way; its glare on the screen, within WIDE.
 */
const NEAR = 8, WIDE = 60;

for (const hole of APPROACHES) {
  if (only.length && !only.includes(hole.id)) continue;
  const dir = path.join(outDir, `exposure-${hole.id}`);
  fs.mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  collectErrors(page, errors);
  await page.goto(`${base}?menu=0&time=2026-10-01T20:00:00Z&target=${encodeURIComponent(hole.target)}&dist=${hole.outside?.[0] ?? hole.far}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.app && window.app.frameCount > 30, null, { timeout: 600000 });
  // (a hole of the catalogue's is looked up before the view goes to it)
  await page.waitForFunction((name) => window.app.rig.target?.name === name, hole.target, { timeout: 180000 });
  await page.waitForFunction(() => window.app.debugState().pendingTiles === 0, null, { timeout: 180000 }).catch(() => undefined);
  await page.evaluate((above) => {
    const a = window.app, r = a.rig, t = r.target;
    a.renderer.gl.setAnimationLoop(null);
    a.hud.setHidden(true);
    a.labels.enabled = false;
    a.orbits.enabled = false;
    if (!t.companion) return;
    // the line the eye comes in on: across from where the star is, above the disk; the star to the left
    const up = t.diskNormal.clone().normalize();
    const line = up.clone().cross(t.companion.upos.sub(t.upos)).normalize().multiplyScalar(Math.cos(above)).addScaledVector(up, Math.sin(above));
    const dist = r.upos.sub(t.upos).length();
    r.upos.copy(t.upos).addVec(line, dist);
    r.lookAt(line.clone().negate(), up);
  }, (ABOVE * Math.PI) / 180);
  // one frame with the eye `dist` radii from the hole (on the line it is on), and the hole's light in it
  const frame = (dist) => page.evaluate(async ([dist, near, wide]) => {
    const a = window.app, r = a.rig, t = r.target;
    const from = r.upos.sub(t.upos);
    r.upos.copy(t.upos).addVec(from.normalize(), dist * t.radius);
    await new Promise((res) => setTimeout(res, Math.max(0, 105 - (performance.now() - (window.app.lastTime ?? performance.now())))));
    a.frame();
    const at = a.project(t.upos.sub(r.upos));
    // what is behind the hole: the middle value round the edge of a square, colour by colour
    const behind = (px, n, step) => {
      const edge = [[], [], []];
      for (let i = 0; i < n; i++) for (const j of [i, (n - 1) * n + i, i * n, i * n + n - 1]) for (let k = 0; k < 3; k++) edge[k].push(px[j * step + k]);
      return edge.map((e) => e.sort((p, q) => p - q)[e.length >> 1]);
    };
    const luminance = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    // its own light: what the frame holds round it, over what is behind it
    const held = a.renderer.lightAt(at.x, at.y, near);
    const under = behind(held, Math.sqrt(held.length / 3), 3);
    const light = [0, 0, 0];
    for (let i = 0; i < held.length; i += 3) for (let k = 0; k < 3; k++) light[k] += Math.max(0, held[i + k] - under[k]);
    // its glare on the screen: the pixels round it shown white, and those lifted clear of what is behind
    const w = r.viewport.width, h = r.viewport.height;
    const c = window.__meter ?? (window.__meter = Object.assign(document.createElement('canvas'), { width: w, height: h }));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(a.renderer.gl.domElement, 0, 0, w, h);
    const n = 2 * wide;
    const shown = Array.from(g.getImageData(Math.round(at.x) - wide, Math.round(at.y) - wide, n, n).data, (v) => (v <= 10 ? v / 3294.6 : ((v / 255 + 0.055) / 1.055) ** 2.4));
    const dark = luminance(behind(shown, n, 4));
    let white = 0, lifted = 0;
    for (let i = 0; i < shown.length; i += 4) {
      const y = luminance([shown[i], shown[i + 1], shown[i + 2]]);
      if (y >= 0.83) white++;
      if (y >= dark + 0.25) lifted++;
    }
    return { dist, light: luminance(light), blue: light[2] / Math.max(light[0], 1e-9), white, lifted, x: Math.log(a.debugState().exposure) };
  }, [dist, NEAR, WIDE]);
  const log = [];
  const rec = async (dist, phase) => {
    log.push({ i: log.length, phase, ...(await frame(dist)) });
    if (log.length % 4 === 1) await page.screenshot({ path: path.join(dir, `f${String(log.length - 1).padStart(3, '0')}.png`) });
  };
  // from far outside first, the eye given time at each place (it has the most to do at the first)
  const outside = [];
  for (const [k, d] of (hole.outside ?? []).entries()) {
    for (let i = 0; i < (k ? 10 : 24); i++) await frame(d);
    outside.push(await frame(d));
  }
  for (let i = 0; i < 25; i++) await frame(hole.far);       // settle on it
  let dist = hole.far;
  await rec(dist, 'in');
  while (dist > hole.near) { dist = Math.max(hole.near, dist * IN); await rec(dist, 'in'); }
  while (dist < hole.far) { dist = Math.min(hole.far, dist * OUT); await rec(dist, 'out'); }
  fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify(log));

  // --- what the frames must show while the hole is small in the frame: the bright part of its
  // disk well inside the square its light is measured in
  const pixel = (2 * Math.tan((35 * Math.PI) / 180)) / 844;
  const small = (f) => hole.bright / (f.dist * pixel) < 0.6 * NEAR;
  const coming = log.filter((f) => f.phase === 'in' && small(f)), going = log.filter((f) => f.phase === 'out' && small(f));
  const where = (f) => `${f.dist.toPrecision(3)} radii`;
  // from afar: a point with a tight glare
  const afar = coming.slice(0, 4);
  const widest = afar.reduce((m, f) => (f.lifted > m.lifted ? f : m), afar[0]);
  check(`${hole.label}: from afar it is a point with a tight glare, not a ball of light`, afar.every((f) => f.lifted <= 500 && f.white <= 60),
    `at most ${widest.lifted} px lifted clear of what is behind, ${Math.max(...afar.map((f) => f.white))} px white (at ${where(widest)})`);
  // no leap between frames, and no falling back on the way in (a disk's light sways with the eye's
  // distance, as its middle takes in fewer of its arms and streaks: by a quarter at the most, in
  // the runs so far; before, it leapt sevenfold and more and fell to a half and less)
  let leap = { by: 0, at: coming[0] }, fall = { by: 0, at: coming[0] }, most = coming[0].light;
  for (let i = 1; i < coming.length; i++) {
    const by = Math.abs(Math.log(coming[i].light / coming[i - 1].light));
    if (by > leap.by) leap = { by, at: coming[i] };
    most = Math.max(most, coming[i - 1].light);
    const back = Math.log(most / coming[i].light);
    if (back > fall.by) fall = { by: back, at: coming[i] };
  }
  check(`${hole.label}: coming nearer, its light never leaps from one frame to the next`, leap.by < 0.5, `largest step x${Math.exp(leap.by).toFixed(2)} at ${where(leap.at)}`);
  check(`${hole.label}: coming nearer, its light never falls back`, fall.by < 0.36, `at the least x${Math.exp(-fall.by).toFixed(2)} of what it had been, at ${where(fall.at)}`);
  // going away fast, it is what it was at each place on the way in
  let off = { by: 0, at: going[0] };
  for (const f of going) {
    const k = coming.findIndex((c) => c.dist <= f.dist);
    if (k < 1) continue;
    const a = coming[k - 1], b = coming[k];
    const was = Math.exp(Math.log(a.light) + ((Math.log(b.light) - Math.log(a.light)) * Math.log(f.dist / a.dist)) / Math.log(b.dist / a.dist));
    const by = Math.abs(Math.log(f.light / was));
    if (by > off.by) off = { by, at: f };
  }
  check(`${hole.label}: going away fast, its light is what it was at each place coming`, off.by < 0.45, `off by x${Math.exp(off.by).toFixed(2)} at most, at ${where(off.at)}`);
  // (by a quarter at the most: a blue disk's blue is four times its red, an orange one's half)
  const blues = [...coming, ...going].map((f) => f.blue);
  check(`${hole.label}: its colour holds`, Math.max(...blues) < 1.25 * Math.min(...blues), `blue to red of its light ${Math.min(...blues).toFixed(2)} to ${Math.max(...blues).toFixed(2)}`);
  // from far outside, a point alone, it has the light it has from where the approach begins (it
  // was twice that at 8,800 light years and gone by 40,000 while its sight lines were traced from
  // where the eye is: too far off for 32-bit numbers)
  if (outside.length) {
    const from = [...outside, log[0]];
    check(`${hole.label}: from far outside, a point alone, its glint has the light it has from nearer`, Math.max(...from.map((f) => f.light)) < 1.3 * Math.min(...from.map((f) => f.light)),
      from.map((f) => `${f.light.toFixed(0)} at ${where(f)}`).join(', '));
  }
  const lights = coming.map((f) => f.light);
  console.log(`  (${hole.label}: ${log.length} frames, ${coming.length} coming and ${going.length} going with the hole small; its light ${Math.min(...lights).toFixed(0)} to ${Math.max(...lights).toFixed(0)})`);
  await page.close();
}

// Out of the galaxy (scene "glow-out"): the eye carried from 1 to 15 kpc from the Sun, 5 % farther
// each frame (55 frames; the trailer's pull-out goes three times as fast), looking back at the
// galaxy's middle, out along the line the Milky Way is seen whole from. The glow's cube map is
// drawn again a face a frame, and each new map was shown at once: a step every six frames (in
// trailer v3's scan, 20 to 40 levels), and now and then a map with one sight line summed past
// what its half floats hold, which washed the whole frame white until the next. Shown blended
// from the last, the frame changes a little each frame: no frame by more than twice what the
// frames round it do (the two before and the two after, their middle value).
if (!only.length || only.includes('glow-out')) {
  const dir = path.join(outDir, 'exposure-glow-out');
  fs.mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  collectErrors(page, errors);
  await page.goto(`${base}?menu=0&time=2026-10-01T20:00:00Z&target=Sun&dist=40`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.app && window.app.frameCount > 30, null, { timeout: 600000 });
  await page.evaluate(() => {
    const a = window.app;
    a.renderer.gl.setAnimationLoop(null);
    a.hud.setHidden(true);
    a.labels.enabled = false;
    a.orbits.enabled = false;
    a.rig.target = null;
    a.rig.setAnchor(null);
  });
  const GROW = 1.05;
  // one frame with the eye `kpc` from the Sun, out along the line the galaxy is seen whole from;
  // the frame small (96 x 96), in display levels
  const frame = (kpc) => page.evaluate(async (kpc) => {
    const a = window.app, r = a.rig, S = a.system.sun, mw = a.milkyWay;
    const out = mw.viewDir();
    r.upos.copy(S.upos).addVec(out, kpc * 1e3 * 3.0857e16);
    r.lookAt(mw.upos.sub(r.upos).normalize(), out.clone().set(0, 0, 1));
    await new Promise((res) => setTimeout(res, 105));
    a.frame();
    const c = window.__meter ?? (window.__meter = Object.assign(document.createElement('canvas'), { width: 96, height: 96 }));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(a.renderer.gl.domElement, 0, 0, 96, 96);
    return Array.from(g.getImageData(0, 0, 96, 96).data.filter((_, i) => i % 4 !== 3));
  }, kpc);
  for (let i = 0; i < 30; i++) await frame(1);            // the glow drawn, the eye settled
  const seq = [];
  let prev = await frame(1);
  for (let kpc = 1; kpc < 15; kpc = Math.min(15, kpc * GROW)) {
    const now = await frame(kpc * GROW);
    // how much the frame changed: the mean of each pixel's change, in levels
    let sum = 0;
    for (let i = 0; i < now.length; i++) sum += Math.abs(now[i] - prev[i]);
    seq.push({ kpc: Math.min(15, kpc * GROW), change: sum / now.length });
    prev = now;
    if (seq.length % 6 === 1) await page.screenshot({ path: path.join(dir, `f${String(seq.length).padStart(3, '0')}.png`) });
  }
  fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify(seq));
  // each frame's change against the middle of its neighbours' (two before, two after)
  let worst = { by: 0, at: seq[0], round: 0 };
  for (let i = 0; i < seq.length; i++) {
    const near = [seq[i - 2], seq[i - 1], seq[i + 1], seq[i + 2]].filter(Boolean).map((s) => s.change).sort((p, q) => p - q);
    const round = (near[(near.length - 1) >> 1] + near[near.length >> 1]) / 2;
    const by = seq[i].change / Math.max(round, 1.5);
    if (by > worst.by) worst = { by, at: seq[i], round };
  }
  check('out of the galaxy, 1 to 15 kpc: its glow changes a little each frame, never in a step', worst.by <= 2,
    `at most x${worst.by.toFixed(2)} the change round it (${worst.at.change.toFixed(1)} levels against ${worst.round.toFixed(1)}, at ${worst.at.kpc.toFixed(1)} kpc); ${seq.map((s) => s.change.toFixed(1)).join(' ')}`);
  await page.close();
}

// Cygnus X-1 come up to slowly through some 120 of its radii (1.5 % nearer a frame, from 160 to
// 80), from where the star stands to one side, 25 degrees above the disk: the frame as shown never
// changes by more than 5 % from one frame to the next. As the disk's bright middle grew past a
// twelfth of the frame, the eye's settling on it went from the dark's exposure to its key in a few
// hundredths of its weight, and the frame went darker by 16 % in one frame and by 60 % in four.
if (!only.length || only.includes('cygnus-slow')) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  collectErrors(page, errors);
  await page.goto(`${base}?menu=0&time=2026-10-01T20:00:00Z&target=Cygnus%20X-1&dist=160`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.app && window.app.frameCount > 30, null, { timeout: 600000 });
  await page.waitForFunction(() => window.app.rig.target?.name === 'Cygnus X-1', null, { timeout: 180000 });
  await page.waitForFunction(() => window.app.debugState().pendingTiles === 0, null, { timeout: 180000 }).catch(() => undefined);
  await page.evaluate((above) => {
    const a = window.app, r = a.rig, t = r.target;
    a.renderer.gl.setAnimationLoop(null);
    a.hud.setHidden(true);
    a.labels.enabled = false;
    a.orbits.enabled = false;
    const up = t.diskNormal.clone().normalize();
    window.__line = up.clone().cross(t.companion.upos.sub(t.upos)).normalize().multiplyScalar(Math.cos(above)).addScaledVector(up, Math.sin(above));
    r.lookAt(window.__line.clone().negate(), up);
  }, (ABOVE * Math.PI) / 180);
  const shown = (dist) => page.evaluate(async (dist) => {
    const a = window.app, r = a.rig, t = r.target;
    r.upos.copy(t.upos).addVec(window.__line, dist * t.radius);
    await new Promise((res) => setTimeout(res, 105));
    a.frame();
    const c = window.__mean ?? (window.__mean = Object.assign(document.createElement('canvas'), { width: 96, height: 96 }));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(a.renderer.gl.domElement, 0, 0, 96, 96);
    const px = g.getImageData(0, 0, 96, 96).data;
    let s = 0;
    for (let i = 0; i < px.length; i += 4) s += px[i] + px[i + 1] + px[i + 2];
    return s / (96 * 96 * 3);
  }, dist);
  // (already on the way in when the measuring starts: the dust that streaks past a moving eye
  // comes in as it starts to move, and lightens the frame by a tenth)
  for (let i = 25; i > 0; i--) await shown(160 / 0.985 ** i);
  let last = await shown(160), worst = { by: 0, at: 160 };
  for (let d = 160 * 0.985; d >= 80; d *= 0.985) {
    const now = await shown(d);
    const by = Math.abs(Math.log(now / last));
    if (by > worst.by) worst = { by, at: d };
    last = now;
  }
  check('Cygnus X-1 come up to slowly: the frame never changes by more than 5 % from one frame to the next', worst.by < Math.log(1.05),
    `largest change x${Math.exp(worst.by).toFixed(3)} at ${worst.at.toFixed(0)} radii`);
  await page.close();
}

// ------------------------------------------------------------------------------- the big look
// Far worlds are drawn larger than they are, in their real places, lit as they are (src/render/Bodies.ts: bigScale; the
// owner's ask, 28 Nov 2026): from open space the planets are little lit discs, not points, each shown by its own light (not
// burnt out), and the eye's exposure for the rest is what it is without them. From a world's own neighbourhood the other
// planets are the points they are. "Real size" in More draws every world its size.
if (!only.length || only.includes('big-look')) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  collectErrors(page, errors);
  await page.goto(`${base}?menu=0&time=2026-10-01T20:00:00Z&target=Jupiter&dist=10`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.app && window.app.frameCount > 30 && !document.getElementById('boot'), null, { timeout: 600000 });
  await page.evaluate(() => { const a = window.app; a.renderer.gl.setAnimationLoop(null); a.hud.setHidden(true); a.labels.enabled = false; a.orbits.enabled = false; });
  const look = (big, near) => page.evaluate(async ([big, near]) => {
    const a = window.app, sun = a.system.sun, jupiter = a.findByName('Jupiter');
    a.bodies.bigLook = big;
    if (near) a.placeNear(a.findByName('Earth'), 30 * 6371e3, 35, 15);
    else a.placeNear(sun, 2500 * sun.radius, 30, 35);
    a.center(jupiter);
    for (let i = 0; i < 60; i++) { await new Promise((res) => setTimeout(res, 105)); a.frame(); }
    const v = a.bodies.views.get(jupiter), p = a.project(v.rel);
    const gl = a.renderer.gl.domElement, k = gl.width / innerWidth;
    const c = Object.assign(document.createElement('canvas'), { width: gl.width, height: gl.height });
    const g = c.getContext('2d');
    g.drawImage(gl, 0, 0);
    // (a box 41 CSS px wide round where Jupiter is)
    const x0 = Math.round((p.x - 20) * k), y0 = Math.round((p.y - 20) * k), n = Math.round(41 * k);
    const d = g.getImageData(x0, y0, n, n).data;
    let lit = 0, white = 0, r = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.max(d[i], d[i + 1], d[i + 2]) > 100) { lit++; r += d[i]; b += d[i + 2]; }
      if (Math.min(d[i], d[i + 1], d[i + 2]) > 250) white++;
    }
    const scales = Object.fromEntries(['Mars', 'Saturn', 'Earth'].map((name) => [name, a.bodies.views.get(a.findByName(name)).scale]));
    return { scale: v.scale, drawn: (v.pixelRadius * v.scale) / a.view.pixelRatio, lit: lit / (k * k), white: white / (k * k), red: r / Math.max(lit, 1), blue: b / Math.max(lit, 1), x: a.bodies.surfaceExposure.value, scales };
  }, [big, near]);
  const open = await look(true, false);
  await page.screenshot({ path: path.join(outDir, 'exposure-big-look.png') });
  const real = await look(false, false);
  await page.screenshot({ path: path.join(outDir, 'exposure-big-look-real-size.png') });
  const home = await look(true, true);
  console.log(JSON.stringify({ open, real, home }));
  check('the big look: from open space Jupiter is a lit disc 8 px in radius, in its colours, not burnt out',
    open.scale > 1 && Math.abs(open.drawn - 8) < 0.5 && open.lit > 100 && open.white <= 10 && open.red > open.blue && open.scales.Saturn > 1 && open.scales.Mars > 1,
    `drawn ${open.drawn.toFixed(1)} px (x${open.scale.toFixed(0)}): ${open.lit.toFixed(0)} px bright round it, ${open.white.toFixed(0)} white, red ${open.red.toFixed(0)} blue ${open.blue.toFixed(0)}`);
  check('the big look: Real size draws it as it is, a point; the eye\'s exposure is the same either way',
    real.scale === 1 && real.lit < open.lit / 4 && real.x / open.x > 0.8 && real.x / open.x < 1.25,
    `${real.lit.toFixed(0)} px bright round it; exposure x${(real.x / open.x).toFixed(2)} of the big look's`);
  check('the big look: from the Earth\'s neighbourhood the other planets are the points they are',
    home.scale === 1 && home.scales.Mars === 1 && home.scales.Saturn === 1, JSON.stringify(home.scales));
  // The planets of other stars too (src/render/ExoPlanetLayer.ts: bigScale): 51 Peg b from half an AU off its star.
  await page.goto(`${base}?menu=0&time=2026-10-01T20:00:00Z&target=51%20Peg%20b`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.app && window.app.frameCount > 30 && !document.getElementById('boot'), null, { timeout: 600000 });
  await page.evaluate(() => { const a = window.app; a.renderer.gl.setAnimationLoop(null); a.hud.setHidden(true); a.labels.enabled = false; a.orbits.enabled = false; });
  const exoLook = (big) => page.evaluate(async (big) => {
    const a = window.app, p = a.selection;
    a.bodies.bigLook = a.exo.bigLook = big;
    a.placeNear(p.system.host, 0.5 * 1.495978707e11, 30, 35);
    a.center(p);
    for (let i = 0; i < 60; i++) { await new Promise((res) => setTimeout(res, 105)); a.frame(); }
    const v = a.exo.views.find((e) => e.planet === p), at = a.project(v.rel);
    const gl = a.renderer.gl.domElement, k = gl.width / innerWidth;
    const c = Object.assign(document.createElement('canvas'), { width: gl.width, height: gl.height });
    const g = c.getContext('2d');
    g.drawImage(gl, 0, 0);
    const x0 = Math.round((at.x - 20) * k), y0 = Math.round((at.y - 20) * k), n = Math.round(41 * k);
    const d = g.getImageData(x0, y0, n, n).data;
    let lit = 0, white = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.max(d[i], d[i + 1], d[i + 2]) > 100) lit++;
      if (Math.min(d[i], d[i + 1], d[i + 2]) > 250) white++;
    }
    const least = 8 * Math.pow(p.radius / 71492e3, 0.25);
    return { name: p.name, scale: v.scale, drawn: (v.pixelRadius * v.scale) / a.view.pixelRatio, least, lit: lit / (k * k), white: white / (k * k), x: a.bodies.surfaceExposure.value };
  }, big);
  const exoBig = await exoLook(true);
  await page.screenshot({ path: path.join(outDir, 'exposure-big-look-51peg.png') });
  const exoReal = await exoLook(false);
  console.log(JSON.stringify({ exoBig, exoReal }));
  check('the big look: a planet of another star (51 Peg b) from half an AU off is a lit disc its least size, not burnt out; Real size a point',
    exoBig.name === '51 Peg b' && exoBig.scale > 1 && Math.abs(exoBig.drawn - exoBig.least) < 0.5 && exoBig.lit > 100 && exoBig.white <= 10
      && exoReal.scale === 1 && exoReal.lit < exoBig.lit / 4 && exoReal.x / exoBig.x > 0.8 && exoReal.x / exoBig.x < 1.25,
    `drawn ${exoBig.drawn.toFixed(1)} px (x${exoBig.scale.toFixed(0)}, least ${exoBig.least.toFixed(1)}): ${exoBig.lit.toFixed(0)} px bright, ${exoBig.white.toFixed(0)} white; real size ${exoReal.lit.toFixed(0)} px bright, exposure x${(exoReal.x / exoBig.x).toFixed(2)}`);
  await page.close();
}

console.log(errors.length ? `console errors:\n${errors.slice(0, 10).join('\n')}` : 'no console errors');
check('no console errors', errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
