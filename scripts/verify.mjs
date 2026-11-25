// Headless verification: loads scenarios in Chromium, waits for streaming to
// settle, saves screenshots and fails on console/page errors, and on wrong
// picks (real mouse clicks in the two galaxy scenarios).
// Usage: node scripts/verify.mjs [baseUrl] [outDir] [scenarioName...]
import { collectErrors, launchBrowser } from './lib/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'screenshots';
const only = new Set(process.argv.slice(4));
fs.mkdirSync(outDir, { recursive: true });

const T = '2026-10-01T20:00:00Z';
export const scenarios = [
  { name: '01-earth', query: `time=${T}&paused=1` },
  { name: '02-moon', query: `time=${T}&paused=1&target=Moon&dist=3.2&az=20` },
  { name: '03-saturn', query: `time=${T}&paused=1&target=Saturn&dist=6&az=40&el=20` },
  { name: '04-jupiter-system', query: `time=${T}&paused=1&target=Jupiter&dist=150&az=10&el=8` },
  { name: '05-inner-system', query: `time=${T}&paused=1&target=Sun&dist=600&az=0&el=60` },
  { name: '06-outer-system', query: `time=${T}&paused=1&target=Sun&dist=12000&az=0&el=45` },
  { name: '07-sky-from-earth-orion', query: `time=${T}&paused=1&target=Earth&dist=1.6&az=180&el=0&look=Betelgeuse&fov=70` },
  { name: '08-alpha-centauri', query: `time=${T}&paused=1&target=Rigil Kentaurus&dist=40` },
  { name: '09-neighborhood', query: `time=${T}&paused=1&campc=0,0,40&fov=70` },
  { name: '10-galaxy-scale', query: `time=${T}&paused=1&campc=0,0,4000&fov=70` },
  { name: '11-asteroid-belt', query: `time=${T}&paused=1&target=Sun&dist=1100&az=0&el=55&fov=60` },
  { name: '12-pluto-charon', query: `time=${T}&paused=1&target=Pluto&dist=12&az=60&el=10` },
  { name: '13-cygnus-x1', query: `time=${T}&paused=1&target=Cygnus X-1&dist=30` },
  { name: '14-sagittarius-a', query: `time=${T}&paused=1&target=Sagittarius A*&dist=20` },
  { name: '15-gaia-bh1', query: `time=${T}&paused=1&target=Gaia BH1&dist=25&fov=60` },
  { name: '16-cygnus-x1-far', query: `time=${T}&paused=1&target=Cygnus X-1&dist=3000` },
  { name: '17-galactic-core-in-plane', query: `time=${T}&paused=1&campc=603,-2659,22&look=Sagittarius A*&fov=80` },
  { name: '18-milky-way-from-outside', query: `time=${T}&paused=1&campc=-35159,-15148,14226&look=Sagittarius A*&fov=60`,
    picks: [{ target: 'Milky Way', at: 'centre' }] },
  { name: '19-proxima-b', query: `time=${T}&paused=1&target=Proxima Cen b&dist=3.5&az=40&el=10` },
  { name: '20-trappist-1e', query: `time=${T}&paused=1&target=TRAPPIST-1 e&dist=3.5&az=30&el=10` },
  { name: '21-hot-jupiter-51-peg-b', query: `time=${T}&paused=1&target=51 Peg b&dist=4&az=50&el=15` },
  { name: '22-generated-planet-altair-f', query: `time=${T}&paused=1&target=Altair f&dist=3.5&az=40&el=10` },
  { name: '23-generated-giant-procyon-c', query: `time=${T}&paused=1&target=Procyon c&dist=5&az=30&el=20` },
  { name: '24-iss', query: `time=${T}&paused=1&target=ISS&dist=2.2&az=200&el=25` },
  { name: '25-jwst', query: `time=${T}&paused=1&target=JWST&dist=2.6&az=120&el=20` },
  { name: '26-voyager-1', query: `time=${T}&paused=1&target=Voyager 1&dist=4&az=150&el=15` },
  { name: '27-andromeda', query: `time=${T}&paused=1&target=Andromeda Galaxy&dist=2.4&fov=60`,
    picks: [{ target: 'Andromeda Galaxy', at: 'centre' }, { target: 'Andromeda Galaxy', at: 'disc' }, { target: 'Andromeda Galaxy', at: 'M32' }] },
  { name: '28-whirlpool', query: `time=${T}&paused=1&target=Whirlpool Galaxy&dist=2.4&fov=60` },
  { name: '29-local-group', query: `time=${T}&paused=1&campc=-900000,600000,700000&look=Andromeda Galaxy&fov=70` },
  { name: '30-cockpit-earth', query: `time=${T}&paused=1&target=Earth&dist=1.8&az=60&el=10&ship=cockpit&fov=70` },
  { name: '31-chase-saturn', query: `time=${T}&paused=1&target=Saturn&dist=5&az=40&el=15&ship=chase&fov=60` },
  { name: '32-orion-nebula', query: `time=${T}&paused=1&target=Orion Nebula&dist=2.6&fov=60` },
  { name: '33-ring-nebula', query: `time=${T}&paused=1&target=Ring Nebula&dist=2.6&fov=60` },
  { name: '34-omega-centauri', query: `time=${T}&paused=1&target=Omega Centauri&dist=2.6&fov=60` },
  { name: '35-crab-nebula', query: `time=${T}&paused=1&target=Crab Nebula&dist=2.6&fov=60` },
];

const browser = await launchBrowser();
let failed = false;
for (const sc of scenarios) {
  if (only.size && !only.has(sc.name)) continue;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  collectErrors(page, errors);
  // keep the whole message of a shader failure (it carries the GLSL log)
  page.on('console', (m) => {
    if (m.type() === 'error' && /Shader Error|VALIDATE_STATUS/.test(m.text())) fs.writeFileSync(path.join(outDir, `${sc.name}-shader-error.txt`), m.text());
  });
  const t0 = Date.now();
  await page.goto(`${base}?${sc.query}`, { waitUntil: 'load' });
  try {
    // (the explorer is there once the loading screen is through: the downloads, then the first view)
    await page.waitForFunction(() => window.app || window.appError, null, { timeout: 240000 });
    const appError = await page.evaluate(() => window.appError);
    if (appError) throw new Error(appError);
    // let tiles stream and exposure settle
    await page.waitForFunction(() => window.app.frameCount > 20 && window.app.debugState().pendingTiles === 0, null, { timeout: 240000 });
    await page.waitForTimeout(2500);
  } catch (e) {
    errors.push(`scenario error: ${e.message}`);
  }
  // (declared picks, when the scenario has them: a real mouse click where the app itself projects the
  // point — not only a pickAt call — then three rendered frames later the selection must name the
  // object. A point that cannot be resolved fails its own check with details and does not throw away
  // the later ones; these fail the run apart from the console errors above.)
  for (const tap of sc.picks ?? []) {
    const point = await page.evaluate((tap) => {
      const a = window.app;
      if (!a) return null;
      const css = (p) => (p ? { x: p.x, y: p.y } : null);
      const target = a.findByName(tap.target);
      if (tap.at === 'centre') return css(target && a.project(target.upos.sub(a.rig.upos)));
      if (tap.at === 'disc') {
        const v = target && a.galaxies.views.find((x) => x.galaxy === target);
        const p = v && a.project(v.rel), r = v && v.pixelRadius / a.view.pixelRatio;
        return p && r ? { x: p.x, y: p.y - 0.85 * r, r } : null;
      }
      if (tap.at === 'M32') {
        const v = a.galaxies.views.find((x) => x.galaxy.name === 'M32');
        return v ? css(a.project(v.rel)) : null;
      }
      return null;
    }, tap).catch((e) => ({ error: String(e?.message ?? e) }));
    let selected, error = point?.error;
    if (point && !error) {
      try {
        await page.mouse.click(point.x, point.y);
        // (a frame at most a second and slower still on a software GL runner: a bound, not a measure)
        const before = await page.evaluate(() => window.app.frameCount);
        await page.waitForFunction((n) => window.app.frameCount >= n + 3, before, { timeout: 600000 });
        selected = await page.evaluate(() => window.app.selection?.name ?? null);
      } catch (e) {
        error = String(e?.message ?? e);
      }
    }
    const ok = !error && selected === tap.target;
    failed = failed || !ok;
    console.log(`${ok ? 'PASS' : 'FAIL'} pick ${sc.name} ${tap.at} → ${tap.target}: selected ${JSON.stringify(selected ?? null)} at ${JSON.stringify(point ?? null)}${error ? ` (${error})` : ''}`);
  }
  const state = await page.evaluate(() => (window.app ? window.app.debugState() : null)).catch(() => null);
  const file = path.join(outDir, `${sc.name}.png`);
  // (software GL can take several seconds per frame in volume-heavy scenes; same limit as the other scripts)
  await page.screenshot({ path: file, timeout: 180000 });
  const ms = Date.now() - t0;
  console.log(`${sc.name}: ${ms} ms`, JSON.stringify(state));
  if (errors.length) {
    failed = true;
    console.log(`  ERRORS:\n   ${errors.slice(0, 10).join('\n   ')}`);
  }
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
