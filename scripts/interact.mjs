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

// 5c. Walking, star names stand only over the sky: none over the ground, at the bottom of a valley (the Apollo 17
// site, in the Taurus-Littrow valley, 2.6 km under the Moon's mean radius), of a canyon (Valles Marineris, kilometres
// under Mars's datum), and none hidden above the real horizon on a summit (Everest, where the land falls away).
// Each star's line of sight is followed out over the ground the app has (its heights where it draws them): one
// still blocked when raised by 0.3 degrees must have no name, and one still clear when lowered by 0.3 degrees
// must keep its name if it would have one with nothing in the way.
// (the sky of 1 October 2026, 20:00 UTC, with time standing still: the earlier checks ran the clock fast)
const jdWalk = await page.evaluate(() => { const a = window.app; a.clock.rate = 1; a.clock.paused = true; return a.clock.jdTdb; });
for (const place of ['Apollo 17 landing site', 'Valles Marineris', 'Mount Everest']) {
  await page.evaluate((jd) => { window.app.clock.jdTdb = jd; }, 2461315.3341340744);
  await page.evaluate((name) => window.app.walk.walkAt(window.app.landmarks.find((l) => l.name === name)), place);
  await page.waitForFunction(() => window.app.walk.state === 'walk', null, { timeout: 600000 }).catch(() => undefined);
  { const f = await page.evaluate(() => window.app.frameCount); await page.waitForFunction((x) => window.app.frameCount >= x, f + 20, { timeout: 600000 }); }
  await page.waitForFunction(() => window.app.debugState().pendingTiles === 0, null, { timeout: 300000 }).catch(() => undefined);
  { const f = await page.evaluate(() => window.app.frameCount); await page.waitForFunction((x) => window.app.frameCount >= x, f + 5, { timeout: 600000 }); }
  const r = await page.evaluate(() => {
    const a = window.app, T = a.terrain, c = T.current, e = c.orient.elements;
    const rel = a.rig.upos.sub(c.upos, a.rig.vel.clone());
    const bf = (v) => [e[0] * v.x + e[1] * v.y + e[2] * v.z, e[4] * v.x + e[5] * v.y + e[6] * v.z, e[8] * v.x + e[9] * v.y + e[10] * v.z];
    const eye = bf(rel), D = Math.hypot(...eye), up = rel.clone().normalize();
    const R = T.owner.radius, reach = Math.sqrt(2 * R * (D - R + 10000));
    const n = a.rig.vel.clone();
    // is the line of sight along world direction `d` blocked by the ground within reach?
    const blocked = (d) => {
      const db = bf(d);
      for (let i = 0; i < 400; i++) {
        const t = 2 * (reach / 2) ** (i / 399);
        const p = [eye[0] + db[0] * t, eye[1] + db[1] * t, eye[2] + db[2] * t], r = Math.hypot(...p);
        n.set(p[0] / r, p[1] / r, p[2] / r);
        let g = T.groundRadius(n);
        const lvl = T.waterLevel(n);
        if (lvl !== null) g = Math.max(g, T.owner.radius + lvl);
        if (r < g) return true;
      }
      return false;
    };
    const tilt = (d, deg) => d.clone().addScaledVector(up, Math.tan((deg * Math.PI) / 180)).normalize();
    const named = (list) => list.filter((x) => x.cls === 'star');
    const shown = named(a.labelCandidates());
    const keep = a.occluded;
    a.occluded = () => false;
    const all = named(a.labelCandidates());
    a.occluded = keep;
    const el = (x) => +((Math.asin(x.rel.clone().normalize().dot(up)) * 180) / Math.PI).toFixed(2);
    const has = new Set(shown.map((x) => x.text));
    const under = all.filter((x) => blocked(tilt(x.rel.clone().normalize(), 0.3)));
    // (and not behind another world in the sky: the Earth over the Moon)
    const others = a.occluders.filter((o) => !o.exact);
    const behindWorld = (x) => others.some((o) => o.dist < x.rel.length() && x.rel.angleTo(o.rel) < 1.1 * Math.asin(Math.min(1, o.radius / o.dist)));
    const over = all.filter((x) => !behindWorld(x) && !blocked(tilt(x.rel.clone().normalize(), -0.3)));
    // just over a ridge: clear, above the eye's level, and behind the ground if 6 degrees lower
    // (from the Apollo 17 site, over the massifs round the valley)
    const ridge = over.filter((x) => el(x) > 0 && blocked(tilt(x.rel.clone().normalize(), -6)));
    return {
      world: T.owner.name, below: Math.round(D - R), named: all.length, behindWorlds: all.filter(behindWorld).length, under: under.length, overEyeLevel: over.filter((x) => el(x) < 0).length,
      ridge: ridge.map((x) => `${x.text} ${el(x)}°${has.has(x.text) ? '' : ' (unnamed)'}`),
      wrong: under.filter((x) => has.has(x.text)).map((x) => `${x.text} ${el(x)}°`), lost: over.filter((x) => !has.has(x.text)).map((x) => `${x.text} ${el(x)}°`),
    };
  });
  // (at the Apollo 17 site there are names both under its ground and just over its ridges to be tried)
  const ok = r.wrong.length === 0 && r.lost.length === 0 && (place !== 'Apollo 17 landing site' || (r.under > 0 && r.ridge.length > 0));
  check(`walking at ${place}: no star's name over the ground, none lost over the sky (just over a ridge either)`, ok, JSON.stringify(r));
}
await page.evaluate((jd) => { const a = window.app; a.walk.exit(true); a.clock.jdTdb = jd; a.clock.paused = false; }, jdWalk);

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
