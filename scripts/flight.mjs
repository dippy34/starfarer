// PROBE (not a suite): flight.mjs sections 1, 6 and 7 repeated, logging the ground under a ship dropped 12 m over the Moon.
import { collectErrors, launchBrowser } from './lib/browser.mjs';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'screenshots';
fs.mkdirSync(outDir, { recursive: true });
if (process.env.FLIGHT_ONLY === 'phone') { console.log('probe: nothing in the phone part'); process.exit(0); }
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
const waitFor = (fn, arg, timeout = 240000) => page.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);
await page.goto(`${base}?time=2026-10-01T20:00:00Z&target=Earth&dist=1.0628&az=40&el=5&ship=cockpit&menu=0`, { waitUntil: 'load' });
await page.waitForFunction(() => window.app && window.app.renderer && window.app.frameCount > 10, null, { timeout: 120000 });
await waitFor(() => window.app.game.flight.predictor.count > 50 && window.app.game.flight.predictor.done);
await page.evaluate(() => {
  const a = window.app, f = a.game.flight, prev = f.onEvent;
  window.__ev = [];
  f.onEvent = (ev) => {
    const m = a.findByName('Moon'), rl = f.core.rel.length(), b = a.terrain.below(a.rig.upos);
    window.__ev.push({ kind: ev.kind, speed: ev.speed, frame: a.frameCount, rl: rl - m.radius, groundR: f.core.groundR - m.radius, terrainGround: b ? b.ground - m.radius : null, owner: a.terrain.owner?.name ?? null, vel: f.core.relVel.length() });
    return prev?.call(f, ev);
  };
});
const probe = () => page.evaluate(() => {
  const a = window.app, f = a.game.flight, r = f.readout, t = a.terrain, m = a.findByName('Moon');
  const b = t.below(a.rig.upos);
  return { f: a.frameCount, alt: +r.altitude.toFixed(1), groundR: +(f.core.groundR - m.radius).toFixed(1), terr: b ? +(b.ground - m.radius).toFixed(1) : null, owner: t.owner?.name ?? null, frame: f.core.frame?.name ?? null, vy: +(r.vertical ?? 0).toFixed?.(2), landed: r.landed || '', end: f.ending?.title ?? '', pend: a.tiles?.pending?.size, paused: a.clock.paused, rate: a.clock.rate };
});
const T0 = Date.now();
const say = (...m) => console.log(((Date.now() - T0) / 1000).toFixed(1), ...m);
for (let k = 0; k < Number(process.env.PROBE_RUNS ?? 6); k++) {
  say('=== run', k);
  // 6. crash
  await page.evaluate(() => { const a = window.app; const m = a.findByName('Moon'); a.placeNear(m, m.radius + 3000, 10, 10); a.clock.rate = 10; });
  const crashed = await waitFor(() => window.app.game.flight.ending !== null);
  await page.waitForTimeout(500);
  const respawned = await waitFor(() => window.app.game.flight.ending === null, null, 120000);
  const st = await page.evaluate(() => { const r = window.app.game.flight.readout; return { pe: r.pe, ap: r.ap, frame: r.frame }; });
  say('crash', crashed, 'respawn', respawned, JSON.stringify(st));
  // 7. landing, as flight.mjs does it
  await page.evaluate(() => { window.__ev.length = 0; const a = window.app; a.flightClock(); const m = a.findByName('Moon'); a.placeNear(m, m.radius + 5000, 200, 30); a.clock.paused = true; });
  await waitFor(() => window.app.terrain.owner === window.app.findByName('Moon') && !!window.app.terrain.below(window.app.rig.upos));
  say('terrain ready', JSON.stringify(await probe()));
  await page.evaluate(() => { window.app.game.flight.hoverOverGround(12); window.app.clock.paused = false; });
  say('hovered', JSON.stringify(await probe()));
  const stop = Date.now() + 90000;
  let done = false, n = 0;
  while (!done && Date.now() < stop) {
    await page.waitForTimeout(200);
    const p = await probe();
    if (n++ < 60 || p.landed || p.end) say('fall', JSON.stringify(p));
    done = !!p.landed || !!p.end;
  }
  const fin = await page.evaluate(() => ({ events: window.__ev, text: window.app.game.flight.ending?.text ?? null, landed: window.app.game.flight.readout.landed }));
  say('RESULT', JSON.stringify(fin));
  if (fin.landed) await page.screenshot({ path: `${outDir}/probe-${k}-landed.png` }); else await page.screenshot({ path: `${outDir}/probe-${k}-crash.png` });
  // back to the safe orbit for the next round
  await page.evaluate(() => { const a = window.app; a.flightClock(); a.clock.paused = false; a.game.flight.ending = null; const e = a.findByName('Earth'); a.placeNear(e, e.radius + 400e3, 40, 5); });
  await waitFor(() => window.app.game.flight.readout.frame === 'Earth');
  await page.waitForTimeout(1000);
}
console.log('probe done');
await browser.close();
