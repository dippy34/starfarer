// Stars up close (src/render/shaders/star.ts, StarLook.ts, StarCorona.ts), on a phone in
// headless Chromium. A star's face is drawn the way the space observatories show the Sun's:
// glowing plasma, mottled and threaded all over, white-hot active regions, a glow hugging the limb.
// Measured from the frames the app draws:
//   - the Sun wears the map of the real one; from where its whole disk is in view it is orange
//     (not a pale plate, not pink, not burnt out), textured in every part of the disk, as bright
//     at the limb as in the middle
//   - turned to one of its active regions: a white-hot patch on the orange
//   - a red glow hugs the limb and fades outwards; over a turn of the star prominences rise over it
//   - the surface seethes (it changes from second to second, the disk staying as bright), its
//     detail comes in gradually on the way in, and it turns at its full rate from afar and is
//     slowed from close by, where the eye would not follow it
//   - every kind of star has a face of its own: a red supergiant's deep red and coarse, a hot
//     star's blue and nearly smooth
// Usage: node scripts/stars.mjs [baseUrl] [outDir]
import { collectErrors, launchBrowser } from './lib/browser.mjs';
import { phoneContext } from './lib/touch.mjs';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'screenshots';
fs.mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const errors = [];
const ctx = await phoneContext(browser);

/**
 * Open the app looking at `target` from `dist` of its radii, and let the eye settle. The app's
 * own loop is stopped then: from here on its frames are stepped by hand, a tenth of a second of
 * its time each, so every run sees the same however fast the machine draws.
 */
async function open(target, dist) {
  const page = await ctx.newPage();
  collectErrors(page, errors);
  await page.goto(`${base}?menu=0&target=${encodeURIComponent(target)}&dist=${dist}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.app && window.app.frameCount > 30 && !document.getElementById('boot'), null, { timeout: 600000 });
  await page.evaluate(() => {
    const a = window.app;
    a.renderer.gl.setAnimationLoop(null);
    a.hud.setHidden(true); a.labels.enabled = false; a.orbits.enabled = false;
  });
  await settle(page, 25);
  return page;
}
/**
 * `n` frames of the app. (Each at least 105 ms after the one before it began, App.lastTime: App.frame
 * clamps its step to 0.1 s, so every frame is a tenth of a second of its time, as before, without a
 * further 105 ms after whatever came between.)
 */
const settle = (page, n) => page.evaluate(async (n) => {
  for (let i = 0; i < n; i++) { await new Promise((res) => setTimeout(res, Math.max(0, 105 - (performance.now() - (window.app.lastTime ?? performance.now()))))); window.app.frame(); }
}, n);

/**
 * The frame as drawn, measured: where the star's disk is (by its light), its colours, how
 * textured it is, what there is round it. Brightness is the display's (0 to 255).
 */
const measure = (page) => page.evaluate(() => {
  const a = window.app;
  a.frame();
  const gl = a.renderer.gl.domElement;
  const c = window.__star ?? (window.__star = document.createElement('canvas'));
  if (c.width !== gl.width || c.height !== gl.height) { c.width = gl.width; c.height = gl.height; }
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(gl, 0, 0);
  const W = c.width, H = c.height, d = g.getImageData(0, 0, W, H).data;
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2];
  // the disk: what is at least half as bright as the bright parts of the frame
  const sorted = Float32Array.from(L).sort();
  const bright = sorted[Math.floor(0.97 * (W * H - 1))];
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (L[y * W + x] > 0.5 * bright) { n++; sx += x; sy += y; }
  const cx = sx / n, cy = sy / n, R = Math.sqrt(n / Math.PI);
  // sums over a square in one step
  const S = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += L[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; } }
  const box = (x, y, h) => {
    const x0 = Math.max(0, x - h), x1 = Math.min(W, x + h + 1), y0 = Math.max(0, y - h), y1 = Math.min(H, y + h + 1);
    return (S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
  };
  // within the disk: its colours, and how it differs from place to place at the scale of a few
  // pixels (fine) and of a tenth of the radius (coarse), in each quarter of the disk
  const inside = [];
  const fine = [0, 0, 0, 0], count = [0, 0, 0, 0];
  let coarse = 0, mean = 0, burnt = 0, m = 0;
  const wide = Math.max(4, Math.round(R * 0.1));
  for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(H, cy + R); y++) for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(W, cx + R); x++) {
    const r = Math.hypot(x - cx, y - cy) / R;
    if (r > 0.8) continue;
    const i = y * W + x;
    inside.push(i);
    const near = box(x, y, 3), far = box(x, y, wide);
    const q = (x > cx ? 1 : 0) + (y > cy ? 2 : 0);
    fine[q] += (L[i] - near) ** 2; count[q]++;
    coarse += (near - far) ** 2;
    mean += L[i]; m++;
    if (Math.min(d[4 * i], d[4 * i + 1], d[4 * i + 2]) > 245) burnt++;
  }
  mean /= m;
  inside.sort((p, q) => L[p] - L[q]);
  const at = (f) => { const i = inside[Math.floor(f * (inside.length - 1))]; return [d[4 * i], d[4 * i + 1], d[4 * i + 2]]; };
  // rings round the centre: mean colour at a radius (in disk radii; null where the ring is out of the frame)
  const ring = (r) => {
    const s = [0, 0, 0]; let k = 0;
    for (let j = 0; j < 180; j++) {
      const x = Math.round(cx + r * R * Math.cos(j / 28.65)), y = Math.round(cy + r * R * Math.sin(j / 28.65));
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x; s[0] += d[4 * i]; s[1] += d[4 * i + 1]; s[2] += d[4 * i + 2]; k++;
    }
    return k > 90 ? s.map((v) => Math.round(v / k)) : null;
  };
  const lumOf = (p) => p && 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  // how much of the pattern has changed place since the frame measured before (as a share of the
  // disk's brightness): the middle of the disk, pixel by pixel
  let change = null;
  const prev = window.__starBefore;
  if (prev && prev.length === L.length) {
    let sum = 0, k = 0;
    for (let y = Math.floor(cy - 0.6 * R); y < cy + 0.6 * R; y += 2) for (let x = Math.floor(cx - 0.6 * R); x < cx + 0.6 * R; x += 2) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      sum += Math.abs(L[y * W + x] - prev[y * W + x]); k++;
    }
    change = sum / k / mean;
  }
  window.__starBefore = L;
  const state = a.debugState();
  return {
    cx, cy, R, mean, burnt: burnt / m, change,
    dark: at(0.05), median: at(0.5), light: at(0.95), brightest: at(0.998),
    fine: fine.map((v, q) => Math.sqrt(v / Math.max(count[q], 1)) / mean), coarse: Math.sqrt(coarse / m) / mean,
    middle: lumOf(ring(0.2)), limb: lumOf(ring(0.93)),
    halo: [1.03, 1.08, 1.14, 1.3].map(ring),
    lightExposure: state.lightExposure,
  };
});
const rgb = (p) => `(${p.join(', ')})`;
// ---------------------------------------------------------------------------------------- the Sun
{
  const page = await open('Sun', 4);
  // turn the view to one of the Sun's active regions (its first spot, where it is now)
  // (BodiesLayer.sunLooks: each sun's look, and how far its surface has turned)
  await page.evaluate(() => {
    const a = window.app, sun = a.system.sun, star = a.bodies.sunLooks.get(sun), look = star.look, sp = look.spots[0];
    const s = Math.sin(sp.lat), c = Math.cos(sp.lat);
    const lon = sp.lon + look.rotRate * (1 - look.shear * s * s) * star.turned;
    const v = [c * Math.cos(lon), c * Math.sin(lon), s], e = sun.orientation.elements;
    const dir = [0, 1, 2].map((i) => e[i] * v[0] + e[4 + i] * v[1] + e[8 + i] * v[2]);
    // (placeNear: the eye stands at (cos az cos el, sin az, cos az sin el) from the Sun)
    a.placeNear(sun, 4 * sun.radius, (Math.asin(dir[1]) * 180) / Math.PI, (Math.atan2(dir[2], dir[0]) * 180) / Math.PI);
  });
  await settle(page, 30);
  const s = await measure(page);
  await page.screenshot({ path: path.join(outDir, 'stars-sun.png') });
  const mapped = await page.evaluate(() => window.app.bodies.meshes.get(window.app.system.sun).material.uniforms.uHasMap.value);
  check('the Sun wears its own face: the map of the real one', mapped === 1);
  const [r, g, b] = s.median;
  check('the Sun is a ball of orange plasma: not a pale plate, not pink, not burnt out', r > 170 && g > 45 && g < 0.52 * r && b < 0.35 * g && s.burnt < 0.03,
    `median ${rgb(s.median)}, dark ${rgb(s.dark)}, light ${rgb(s.light)}; ${(s.burnt * 100).toFixed(2)} % burnt out`);
  check('what is darker on it is deeper red, what is brighter yellower', s.dark[1] / s.dark[0] < g / r && s.light[1] / s.light[0] > g / r,
    `green to red: dark ${(s.dark[1] / s.dark[0]).toFixed(2)}, median ${(g / r).toFixed(2)}, light ${(s.light[1] / s.light[0]).toFixed(2)}`);
  check('it is textured in every part of the disk', Math.min(...s.fine) > 0.07, `fine contrast by quarter: ${s.fine.map((v) => v.toFixed(3)).join(', ')}`);
  check('it has a white-hot active region where the view was turned to one', Math.min(...s.brightest) > 150 && 0.2126 * s.brightest[0] + 0.7152 * s.brightest[1] + 0.0722 * s.brightest[2] > 1.6 * s.mean,
    `brightest ${rgb(s.brightest)} on a disk of mean brightness ${s.mean.toFixed(0)}`);
  check('its limb is as bright as its middle (no dark rim)', s.limb > 0.75 * s.middle && s.limb < 1.35 * s.middle, `middle ${s.middle.toFixed(0)}, at 0.93 of the radius ${s.limb.toFixed(0)}`);
  const halo = s.halo.map((p) => p[0]);
  check('a red glow hugs the limb and fades outwards', halo[0] > 120 && halo[0] > halo[1] && halo[1] > halo[2] && halo[2] > halo[3] && halo[3] < 0.35 * halo[0] && s.halo[1][0] > 3 * s.halo[1][1],
    `at 1.03, 1.08, 1.14 and 1.3 radii: ${s.halo.map(rgb).join(' ')}`);
  const level = s.lightExposure * (1.495978707e11 / 6.957e8) ** 2;
  check('its face is shown at the level its colours are designed for', level > 0.5 && level < 0.6, `mean level ${level.toFixed(2)}`);

  // --- it seethes (its turning stopped meanwhile: what changes is the seething alone)
  const rate = await page.evaluate(() => { const look = window.app.bodies.sunLooks.get(window.app.system.sun).look, r = look.rotRate; look.rotRate = 0; return r; });
  await settle(page, 2);
  const before = await measure(page);
  const next = await measure(page);
  await settle(page, 50);
  const after = await measure(page);

  // --- coming closer, its detail comes in gradually: the middle of the frame at each step,
  // how bright it is and how much it varies at the scale of a few pixels
  const closer = await page.evaluate(async () => {
    const a = window.app, sun = a.system.sun, gl = a.renderer.gl.domElement, S = 240, out = [];
    const c = Object.assign(document.createElement('canvas'), { width: S, height: S });
    const g = c.getContext('2d', { willReadFrequently: true });
    for (let k = 0; k <= 16; k++) {
      a.placeNear(sun, 4 * (1.5 / 4) ** (k / 16) * sun.radius, 0, 0);
      for (let i = 0; i < 2; i++) { await new Promise((res) => setTimeout(res, Math.max(0, 105 - (performance.now() - (window.app.lastTime ?? performance.now()))))); a.frame(); }
      // (the view holds what it is aimed at a little above the middle of an upright screen)
      g.drawImage(gl, (gl.width - S) / 2, 0.42 * gl.height - S / 2, S, S, 0, 0, S, S);
      const d = g.getImageData(0, 0, S, S).data, L = new Float32Array(S * S);
      let mean = 0, fine = 0, n = 0;
      for (let i = 0; i < S * S; i++) { L[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]; mean += L[i] / (S * S); }
      for (let y = 3; y < S - 3; y++) for (let x = 3; x < S - 3; x++) {
        let box = 0;
        for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) box += L[(y + j) * S + x + i];
        fine += (L[y * S + x] - box / 49) ** 2; n++;
      }
      out.push({ mean, fine: Math.sqrt(fine / n) / mean });
    }
    a.placeNear(sun, 4 * sun.radius, 0, 0);
    return out;
  });
  await settle(page, 5);
  const step = (of) => closer.slice(1).map((m, i) => Math.max(m[of] / closer[i][of], closer[i][of] / m[of]));
  check('coming closer, its detail comes in gradually: nothing pops in, nothing drops out', Math.max(...step('fine')) < 1.3 && Math.max(...step('mean')) < 1.07 && Math.min(...closer.map((m) => m.fine)) > 0.02,
    `from 4 radii to 1.5 in 16 steps: fine contrast ${Math.min(...closer.map((m) => m.fine)).toFixed(3)} to ${Math.max(...closer.map((m) => m.fine)).toFixed(3)}, at most x${Math.max(...step('fine')).toFixed(2)} in a step; brightness at most x${Math.max(...step('mean')).toFixed(3)}`);
  await page.evaluate((r) => { window.app.bodies.sunLooks.get(window.app.system.sun).look.rotRate = r; }, rate);
  check('the surface seethes: after a few seconds it has changed, far more than from one frame to the next, and the disk is as bright as it was',
    after.change > 0.008 && after.change > 2.5 * next.change && Math.abs(after.mean - before.mean) < 0.03 * before.mean,
    `${(after.change * 100).toFixed(1)} % of the brightness changed place (${(next.change * 100).toFixed(2)} % in one frame); the mean went from ${before.mean.toFixed(1)} to ${after.mean.toFixed(1)}`);

  // --- prominences rise over the limb as it turns
  const proms = await page.evaluate(() => {
    const a = window.app, b = a.bodies, star = b.sunLooks.get(a.system.sun), look = star.look;
    const u = b.sunCorona.mesh.material.uniforms;
    const was = star.turned, seen = [];
    for (let i = 0; i < 48; i++) {
      star.turned = was + (i / 48) * ((2 * Math.PI) / look.rotRate);
      a.frame();
      seen.push(u.uPromCount.value);
    }
    star.turned = was;
    a.frame();
    return { seen, slots: u.uPromFeet.value.length, all: look.proms.length };
  });
  check('over a turn of the Sun prominences rise over its limb and set again', Math.max(...proms.seen) >= 1 && Math.min(...proms.seen) < Math.max(...proms.seen) && Math.max(...proms.seen) <= proms.slots,
    `of its ${proms.all}, between ${Math.min(...proms.seen)} and ${Math.max(...proms.seen)} stand over the limb at a time`);

  // --- it turns at its full rate from here, and is slowed from close by
  const turning = (page) => page.evaluate(async () => {
    const a = window.app, b = a.bodies, star = b.sunLooks.get(a.system.sun);
    const t0 = b.time, s0 = star.turned;
    for (let i = 0; i < 10; i++) { await new Promise((res) => setTimeout(res, Math.max(0, 105 - (performance.now() - (window.app.lastTime ?? performance.now()))))); a.frame(); }
    return (star.turned - s0) / (b.time - t0);
  });
  const far = await turning(page);
  await page.evaluate(() => { const a = window.app, sun = a.system.sun; a.placeNear(sun, 1.15 * sun.radius, 35, 15); });
  await settle(page, 30);
  const near = await turning(page);
  const close = await measure(page);
  await page.screenshot({ path: path.join(outDir, 'stars-sun-close.png') });
  check('from where the whole disk is in view the Sun turns at its full rate; from close by it is slowed', Math.abs(far - 1) < 0.02 && near < 0.3 && near > 0,
    `share of the full rate: ${far.toFixed(2)} from 4 radii, ${near.toFixed(3)} from 1.15`);
  check('from close by its face fills the view, still orange and textured', close.median[0] > 170 && close.median[1] < 0.52 * close.median[0] && Math.min(...close.fine) > 0.025 && close.burnt < 0.03,
    `median ${rgb(close.median)}, fine contrast ${close.fine.map((v) => v.toFixed(3)).join(', ')}`);
  await page.close();
}

// ----------------------------------------------------------------- a sun too small to show a face
{
  // from among the planets (2.8 AU: its disk is a pixel or two wide) the Sun is a glare of white
  // light, as bright as it is: not a dot at the top of its face's colours
  const page = await open('Sun', 600);
  const far = await page.evaluate(() => {
    const a = window.app;
    a.frame();
    const gl = a.renderer.gl.domElement, c = Object.assign(document.createElement('canvas'), { width: gl.width, height: gl.height });
    const g = c.getContext('2d');
    g.drawImage(gl, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let white = 0, lit = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.min(d[i], d[i + 1], d[i + 2]) > 235) white++;
      if (Math.min(d[i], d[i + 1], d[i + 2]) > 60) lit++;
    }
    return { white: white / (d.length / 4), lit: lit / (d.length / 4), px: a.bodies.views.get(a.system.sun).pixelRadius };
  });
  await page.screenshot({ path: path.join(outDir, 'stars-sun-far.png') });
  check('from among the planets the Sun, a pixel or two wide, is a glare of white light and not a dot', far.white > 0.001 && far.lit > 0.01,
    `its disk ${far.px.toFixed(1)} px in radius; burnt out white over ${(far.white * 100).toFixed(2)} % of the frame, lit over ${(far.lit * 100).toFixed(1)} %`);
  await page.close();
}

// ------------------------------------------------------------------------------- other kinds of star
const faces = {};
for (const [name, dist] of [['Betelgeuse', 4], ['Proxima Centauri', 4], ['Sirius', 4]]) {
  const page = await open(name, dist);
  faces[name] = await measure(page);
  await page.screenshot({ path: path.join(outDir, `stars-${name.split(' ')[0].toLowerCase()}.png`) });
  await page.close();
}
{
  const b = faces.Betelgeuse, p = faces['Proxima Centauri'], s = faces.Sirius;
  check('Betelgeuse is deep red, in cells far larger than the texture on them', b.median[0] > 150 && b.median[1] < 0.42 * b.median[0] && b.coarse > 1.2 * Math.max(...b.fine) && b.burnt < 0.03,
    `median ${rgb(b.median)}; contrast: coarse ${b.coarse.toFixed(3)}, fine ${b.fine.map((v) => v.toFixed(3)).join(', ')}`);
  check('Proxima Centauri is a red star with a face of its own', p.median[0] > 150 && p.median[1] < 0.45 * p.median[0] && Math.min(...p.fine) > 0.025 && p.burnt < 0.05,
    `median ${rgb(p.median)}, fine contrast ${p.fine.map((v) => v.toFixed(3)).join(', ')}`);
  check('Sirius is blue-white and nearly smooth: a face all the same, not a plate', s.median[2] > s.median[0] + 20 && Math.max(...s.fine) < 0.6 * Math.min(...p.fine) && Math.min(...s.fine) > 0.004 && s.burnt < 0.03,
    `median ${rgb(s.median)}, fine contrast ${s.fine.map((v) => v.toFixed(4)).join(', ')}`);
}

console.log(errors.length ? `console errors:\n${errors.slice(0, 10).join('\n')}` : 'no console errors');
check('no console errors', errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
