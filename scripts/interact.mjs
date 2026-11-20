// Drives the running app in headless Chromium and checks interactive behaviour.
// Usage: node scripts/interact.mjs [baseUrl] [outDir]
import { collectErrors, launchBrowser } from './lib/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'screenshots';
fs.mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
collectErrors(page, errors);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

await page.goto(`${base}?time=2026-10-01T20:00:00Z`, { waitUntil: 'load' });
await page.waitForFunction(() => window.app && window.app.frameCount > 10, null, { timeout: 60000 });

// 1. Autopilot to Mars
await page.evaluate(() => { const a = window.app; const m = a.system.bodies.find((b) => b.name === 'Mars'); a.select(m); a.goTo(m); });
await page.waitForFunction(() => !window.app.rig.autopilot, null, { timeout: 60000 });
await page.waitForTimeout(1500);
let st = await page.evaluate(() => {
  const a = window.app; const m = a.system.bodies.find((b) => b.name === 'Mars');
  return { anchor: a.rig.anchor?.name, dist: m.upos.sub(a.rig.upos).length() / m.radius };
});
check('goto Mars arrives and co-moves', st.anchor === 'Mars' && st.dist > 2.5 && st.dist < 5, JSON.stringify(st));
await page.screenshot({ path: path.join(outDir, 'i1-goto-mars.png') });

// 1b. The mouse on Mars: right-drag turns round it holding its surface, the wheel zooms at the pointer, left-drag looks
{
  const probe = () => page.evaluate(() => {
    const a = window.app; const m = a.system.bodies.find((b) => b.name === 'Mars');
    const rel = a.rig.upos.sub(m.upos);
    return { rel: rel.toArray(), dist: rel.length() / m.radius, fwd: a.rig.forward().toArray(), mars: a.project(m.upos.sub(a.rig.upos)) };
  });
  const frames = async (n) => { const f = await page.evaluate(() => window.app.frameCount); await page.waitForFunction((x) => window.app.frameCount >= x, f + n, { timeout: 60000 }); };
  const angle = (u, v) => Math.acos(Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v))));
  const held = await page.evaluate(() => {
    const a = window.app, t = a.rig.target; const cam = a.rig.upos.sub(t.upos); const dir = a.rig.ray(600, 380);
    const b = cam.dot(dir); return cam.addScaledVector(dir, -b - Math.sqrt(b * b - (cam.lengthSq() - t.radius * t.radius))).toArray();
  });
  const p0 = await probe();
  await page.mouse.move(600, 380);
  await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 8; i++) { await page.mouse.move(600 + 10 * i, 380 - 6 * i); await frames(1); }
  await page.mouse.up({ button: 'right' });
  await frames(1);
  const p1 = await probe();
  const drawn = await page.evaluate((h) => { const a = window.app, t = a.rig.target; const v = a.rig.upos.sub(t.upos).negate(); v.x += h[0]; v.y += h[1]; v.z += h[2]; return a.project(v); }, held);
  check('right-drag turns round Mars with its surface under the pointer', Math.abs(p1.dist - p0.dist) < 1e-9 && angle(p0.rel, p1.rel) > 0.05 && Math.hypot(drawn.x - 680, drawn.y - 332) < 1.5 && Math.hypot(p1.mars.x - p0.mars.x, p1.mars.y - p0.mars.y) < 0.01, JSON.stringify({ drawn, turned: angle(p0.rel, p1.rel) }));
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -300);
  await frames(2);
  const p2 = await probe();
  await page.mouse.wheel(0, 300);
  await frames(2);
  const p3 = await probe();
  check('the wheel zooms in and back out', p2.dist < p1.dist * 0.8 && Math.abs(p3.dist - p1.dist) < 1e-6, JSON.stringify([p1.dist, p2.dist, p3.dist]));
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) { await page.mouse.move(640 + 12 * i, 360 + 5 * i); await frames(1); }
  await page.mouse.up();
  await frames(1);
  const p4 = await probe();
  check('left-drag looks around without moving', Math.hypot(p4.rel[0] - p3.rel[0], p4.rel[1] - p3.rel[1], p4.rel[2] - p3.rel[2]) < 1e-3 && angle(p3.fwd, p4.fwd) > 0.05, `turned ${angle(p3.fwd, p4.fwd).toFixed(3)} rad`);
  await page.evaluate(() => { const a = window.app; a.center(a.rig.target); });
}

// 2. Time acceleration: one day per second for ~2 s; the camera must stay with Mars
const before = await page.evaluate(() => ({ jd: window.app.clock.jdTdb }));
await page.evaluate(() => { window.app.clock.paused = false; window.app.clock.rate = 86400; });
await page.waitForTimeout(2000);
st = await page.evaluate(() => {
  const a = window.app; a.clock.rate = 1; const m = a.system.bodies.find((b) => b.name === 'Mars');
  return { jd: a.clock.jdTdb, dist: m.upos.sub(a.rig.upos).length() / m.radius };
});
check('time acceleration advances the clock', st.jd - before.jd > 1, `Δ=${(st.jd - before.jd).toFixed(2)} d`);
check('camera co-moves with Mars under acceleration', st.dist > 2.5 && st.dist < 5, `dist=${st.dist.toFixed(2)} R`);

// 3. Free flight with W
const p0 = await page.evaluate(() => window.app.rig.upos.toVector3().toArray());
await page.mouse.move(640, 360);
await page.keyboard.down('KeyW');
await page.waitForTimeout(800);
await page.keyboard.up('KeyW');
const p1 = await page.evaluate(() => window.app.rig.upos.toVector3().toArray());
const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
check('W key flies forward', moved > 1e3, `moved ${(moved / 1e3).toFixed(0)} km`);

// 4. Click picking: click Jupiter's projected position
await page.evaluate(() => { const a = window.app; const e = a.system.bodies.find((b) => b.name === 'Earth'); a.placeNear(e, e.radius * 4, 180, 0); a.select(null); });
await page.waitForTimeout(500);
const jp = await page.evaluate(() => {
  const a = window.app; const j = a.system.bodies.find((b) => b.name === 'Jupiter');
  a.center(j);
  return null;
});
void jp;
const fc = await page.evaluate(() => window.app.frameCount);
await page.waitForFunction((f) => window.app.frameCount > f + 5, fc, { timeout: 60000 });
const scr = await page.evaluate(() => {
  const a = window.app; const j = a.system.bodies.find((b) => b.name === 'Jupiter');
  return a.project(j.upos.sub(a.rig.upos));
});
if (scr) {
  await page.mouse.click(scr.x, scr.y);
  const f2 = await page.evaluate(() => window.app.frameCount);
  await page.waitForFunction((f) => window.app.frameCount > f + 2, f2, { timeout: 60000 });
}
const sel = await page.evaluate(() => window.app.selection?.name);
check('click selects Jupiter', sel === 'Jupiter', `selected=${sel} at ${JSON.stringify(scr)}`);

// 5. Search and go to a star
await page.keyboard.press('Enter');
await page.keyboard.type('Sirius');
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.waitForFunction(() => !window.app.rig.autopilot && window.app.selection?.name === 'Sirius', null, { timeout: 60000 });
await page.waitForFunction(() => window.app.debugState().pendingTiles === 0, null, { timeout: 60000 });
await page.waitForTimeout(2500);
st = await page.evaluate(() => ({ near: window.app.near.stars.map((s) => s.name), sel: window.app.selection?.name }));
check('search + goto Sirius; Sirius drawn by the near-star renderer', st.near.includes('Sirius'), JSON.stringify(st));
await page.screenshot({ path: path.join(outDir, 'i2-sirius.png') });

// 5b. Beside the space station (400 km up, where the camera would otherwise start to turn with the Earth): it stays beside it
await page.evaluate(() => { const a = window.app; const s = a.findByName('ISS'); a.select(s); a.goTo(s); });
await page.waitForFunction(() => !window.app.rig.autopilot, null, { timeout: 120000 });
await page.waitForTimeout(1000);
const iss = () => page.evaluate(() => { const a = window.app; const s = a.findByName('ISS'); return { d: s.upos.sub(a.rig.upos).length(), anchor: a.rig.anchor?.name, alt: a.rig.altitude }; });
const i0 = await iss();
await page.waitForTimeout(3000);
const i1 = await iss();
check('beside the space station the camera stays beside it', /International/.test(i1.anchor ?? '') && Math.abs(i1.d - i0.d) < 0.5 && i0.d < 2000, JSON.stringify([i0, i1]));

// 6. Frame timing (JS work only)
const timing = await page.evaluate(async () => {
  const a = window.app; const t = [];
  for (let i = 0; i < 30; i++) { const s = performance.now(); a.frame(); t.push(performance.now() - s); await new Promise((r) => setTimeout(r, 0)); }
  t.sort((x, y) => x - y); return { median: t[15], p90: t[27] };
});
console.log('frame() incl. SwiftShader GPU emulation: median', timing.median.toFixed(1), 'ms, p90', timing.p90.toFixed(1), 'ms');

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
