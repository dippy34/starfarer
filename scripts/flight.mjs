// Real-physics ship flight in headless Chromium: orbit HUD and predicted path, a burn that changes
// the orbit, on-rails time warp, the autopilot's refusal deep in a well, a crash and respawn, a landing, a stellar black hole's
// tides and a supermassive one's horizon; the reactionless drive near light speed (never at it) and
// the autopilot to another star; on a phone, boarding, the drive's setting and Go there by touch. Usage: node scripts/flight.mjs [baseUrl] [outDir]
import { collectErrors, launchBrowser } from './lib/browser.mjs';
import { fingers, phoneContext } from './lib/touch.mjs';
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
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const frames = async (n) => { const f = await page.evaluate(() => window.app.frameCount); await page.waitForFunction((x) => window.app.frameCount > x, f + n, { timeout: 240000 }); };
const shot = (name) => page.screenshot({ path: path.join(outDir, name), timeout: 180000 });
const state = () => page.evaluate(() => {
  const f = window.app.game.flight, r = f.readout;
  return {
    on: f.on, frame: r.frame, alt: r.altitude, ap: r.ap, pe: r.pe, e: r.conic?.e ?? null, v: r.orbitSpeed, rails: r.rails, limited: r.limited,
    pts: f.predictor.count, events: f.predictor.events.map((e) => e.kind), tidal: r.tidal, dil: r.dilation, warning: r.warning,
    ending: f.ending?.title ?? null, landed: r.landed, fuel: r.fuel, g: r.gForce, sas: r.sas, throttle: r.throttle,
  };
});
const waitFor = (fn, arg, timeout = 240000) => page.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);

// 1. boarding in low Earth orbit: physics on, a circular orbit, the predicted path and its apsides
await page.goto(`${base}?time=2026-10-01T20:00:00Z&target=Earth&dist=1.0628&az=40&el=5&ship=cockpit&menu=0`, { waitUntil: 'load' });
await page.waitForFunction(() => window.app && window.app.renderer && window.app.frameCount > 10, null, { timeout: 120000 });
await waitFor(() => window.app.game.flight.predictor.count > 50 && window.app.game.flight.predictor.done);
let st = await state();
check('in the ship, physics flight is on, orbiting Earth', st.on && st.frame === 'Earth', JSON.stringify({ frame: st.frame, alt: st.alt }));
check('boarding drops into a circular orbit at ~400 km', st.e !== null && st.e < 0.01 && Math.abs(st.alt - 400e3) < 30e3, `e=${st.e?.toFixed(4)} alt=${(st.alt / 1e3).toFixed(0)} km v=${st.v.toFixed(0)}`);
check('the predicted path is drawn with its apsides', st.pts > 50 && st.events.includes('ap') && st.events.includes('pe'), `${st.pts} pts ${st.events.join(',')}`);
await frames(5);
await shot('f1-orbit-hud.png');
const hudText = await page.evaluate(() => document.querySelector('.fl-panel')?.textContent ?? '');
check('the desktop HUD shows the orbit', /apoapsis/.test(hudText) && /periapsis/.test(hudText) && /ship clock/.test(hudText), hudText.slice(0, 80).replace(/\s+/g, ' '));

// 2. chase view with the orbit line
await page.keyboard.press('KeyV');
await frames(8);
await shot('f2-chase-orbit.png');
await page.keyboard.press('KeyV'); // chase -> off
await frames(2);
await page.keyboard.press('KeyV'); // off -> cockpit (boards again where we are)
await frames(4);

// 3. the autopilot will not fly from low orbit with the drive at its first setting (1 g: gravity
// there is more than half of it, too little to spare to steer)
await page.evaluate(() => { const a = window.app; a.select(a.findByName('Moon')); });
await frames(2);
await page.keyboard.press('KeyJ');
await frames(3);
st = await page.evaluate(() => ({ ap: !!window.app.game.flight.autopilot || window.app.rig.autopilot, lock: window.app.game.flight.autopilotRefusal() }));
check('the autopilot refuses in low orbit: the drive at 1 g is too weak there', !st.ap && st.lock.startsWith('The drive at 1 g'), st.lock);

// 4. a prograde burn raises the apoapsis (SAS holds prograde)
const before = await state();
await page.evaluate(() => { window.app.game.flight.sas = 'prograde'; });
await waitFor(() => { const f = window.app.game.flight; const s = f.ship; const D = f.core.frame; const v = s.vel.clone().sub(D.vel).normalize(); const fwd = s.quat.clone(); const n = new v.constructor(0, 0, -1).applyQuaternion(fwd); return n.dot(v) > 0.995; }, null, 120000);
await page.keyboard.down('KeyZ');
await frames(2);
await page.keyboard.up('KeyZ');
await waitFor(() => window.app.game.flight.readout.ap > 900e3, null, 120000);
const burning = await state();
await shot('f3-burn.png');
// X cuts the engine (held until a frame has seen it: software rendering is slow)
await page.keyboard.down('KeyX');
await waitFor(() => window.app.game.flight.ship.throttle === 0, null, 120000);
await page.keyboard.up('KeyX');
const after = await state();
check('a prograde burn raises the apoapsis and burns propellant', after.ap > before.ap + 400e3 && after.fuel < before.fuel, `Ap ${(before.ap / 1e3).toFixed(0)} -> ${(after.ap / 1e3).toFixed(0)} km, fuel ${(before.fuel * 100).toFixed(1)} -> ${(after.fuel * 100).toFixed(1)} %`);
check('the burn is felt (g-force), X cuts the engine', burning.g > 1 && burning.g < 2 && after.throttle === 0, `g ${burning.g.toFixed(2)} while burning`);

// 5. time warp: x1000 coasting goes on rails
await page.evaluate(() => { const a = window.app; a.clock.rate = 1000; });
await waitFor(() => window.app.game.flight.rails);
st = await state();
check('time warp x1000 coasts on rails', st.rails, JSON.stringify({ rails: st.rails, alt: Math.round(st.alt / 1e3) }));
await page.evaluate(() => { window.app.flightClock(); });

// 6. crash: dropped 3 km over the Moon with no orbital speed
await page.evaluate(() => { const a = window.app; const m = a.findByName('Moon'); a.placeNear(m, m.radius + 3000, 10, 10); a.clock.rate = 10; });
await frames(3);
st = await state();
check('teleported over the Moon, falling', st.frame === 'Moon' && st.alt < 4000, JSON.stringify({ frame: st.frame, alt: st.alt }));
const crashed = await waitFor(() => window.app.game.flight.ending !== null, null, 240000);
st = await state();
check('hitting the Moon fast is a crash', crashed && st.ending === 'CRASHED', String(st.ending));
await page.waitForTimeout(500);
await shot('f4-crash.png');
const respawned = await waitFor(() => window.app.game.flight.ending === null, null, 120000);
st = await state();
check('after the crash: respawn in a safe orbit', respawned && st.frame === 'Moon' && st.pe > 50e3, `pe ${(st.pe / 1e3).toFixed(0)} km`);

// 7. landing: let go 12 m over the Moon (lands at ~6 m/s)
await page.evaluate(() => { const a = window.app; a.flightClock(); const m = a.findByName('Moon'); a.placeNear(m, m.radius + 5000, 200, 30); a.clock.paused = true; });
await waitFor(() => window.app.terrain.owner === window.app.findByName('Moon') && !!window.app.terrain.below(window.app.rig.upos));
// (time held while the terrain streams in: at a few frames a second the ship would otherwise fall the 5 km)
await page.evaluate(() => { window.app.game.flight.hoverOverGround(12); window.app.clock.paused = false; });
const landed = await waitFor(() => !!window.app.game.flight.readout.landed || window.app.game.flight.ending !== null, null, 240000);
st = await state();
check('a gentle drop is a landing', landed && st.landed === 'Moon' && !st.ending, JSON.stringify({ landed: st.landed, ending: st.ending }));
await shot('f5-landed.png');

// 8. a stellar black hole: tides near the limit, then torn apart inside it
await page.evaluate(() => { const a = window.app; const h = a.findByName('Cygnus X-1'); a.select(h); a.placeNear(h, 6.5e6, 20, 8); });
await waitFor(() => window.app.game.flight.readout.frame === 'Cygnus X-1');
await waitFor(() => window.app.game.flight.predictor.count > 50);
await frames(10);
st = await state();
check('orbiting Cygnus X-1: tides felt, path predicted', st.frame === 'Cygnus X-1' && st.tidal > 9.8 && st.pts > 50, JSON.stringify({ tidal: (st.tidal / 9.80665).toFixed(1), alt: st.alt, pts: st.pts, dil: st.dil }));
await shot('f6-stellar-bh.png');
await page.evaluate(() => { const a = window.app; const f = a.game.flight; const D = f.core.frame; const rel = f.ship.upos.sub(D.upos); f.core.setCircularOrbit(D, 2.0e6, rel, new rel.constructor(0, 0, 1)); a.rig.upos.copy(f.ship.upos); });
const torn = await waitFor(() => window.app.game.flight.ending !== null, null, 60000);
st = await state();
check('too close to a stellar black hole: torn apart before the horizon', torn && st.ending === 'TORN APART', String(st.ending));
await page.waitForTimeout(400);
await shot('f7-spaghetti.png');
await waitFor(() => window.app.game.flight.ending === null, null, 120000);

// 9. Sgr A*: survive to the horizon (tides are gentle), clocks slow, then no return
await page.evaluate(() => { const a = window.app; const h = a.findByName('Sagittarius A*'); a.select(h); a.placeNear(h, h.radius * 3, 30, 10); });
await waitFor(() => window.app.game.flight.readout.frame === 'Sagittarius A*');
await page.evaluate(() => { const a = window.app; const f = a.game.flight; const D = f.core.frame; f.ship.vel.copy(D.vel); a.rig.upos.copy(f.ship.upos); a.clock.rate = 60; });
await frames(6);
st = await state();
check('near Sgr A*: time dilation shown, tides survivable', st.dil < 0.9 && st.tidal < 9.8 * 5, JSON.stringify({ dil: st.dil, tidal: st.tidal }));
await shot('f8-sgra.png');
const fell = await waitFor(() => window.app.game.flight.ending !== null, null, 240000);
st = await state();
check('falling into Sgr A*: the horizon ends the flight ("no return")', fell && st.ending === 'NO RETURN', String(st.ending));
await page.waitForTimeout(2500);
await shot('f9-horizon.png');

// 10. demo shots: re-entry glow (low, fast, in Earth's air) and a close pass by a stellar black hole
await page.evaluate(() => { const a = window.app; a.clock.rate = 1; const e = a.findByName('Earth'); a.select(e); a.placeNear(e, e.radius + 400e3, 60, 5); });
await waitFor(() => window.app.game.flight.readout.frame === 'Earth');
await page.evaluate(() => { const a = window.app; const f = a.game.flight; const D = f.core.frame; const rel = f.ship.upos.sub(D.upos); f.core.setCircularOrbit(D, D.radius + 72e3, rel, new rel.constructor(0, 0, 1)); a.rig.upos.copy(f.ship.upos); f.sas = 'retrograde'; });
const glowing = await waitFor(() => window.app.game.flight.ship.heatFlux > 3e5, null, 120000);
st = await state();
check('demo: re-entry heats the hull (plasma glow)', glowing, `${(await page.evaluate(() => window.app.game.flight.ship.heatFlux / 1e6)).toFixed(2)} MW/m², ${st.warning}`);
await shot('f10-reentry.png');
await page.evaluate(() => { const a = window.app; const h = a.findByName('Cygnus X-1'); a.select(h); a.placeNear(h, 2e7, 20, 8); });
await waitFor(() => window.app.game.flight.readout.frame === 'Cygnus X-1');
await page.evaluate(() => { const a = window.app; const f = a.game.flight; const D = f.core.frame; const rel = f.ship.upos.sub(D.upos); const rl = Math.cbrt((2 * D.gm * 22) / (100 * 9.80665)); f.core.setCircularOrbit(D, rl * 1.1, rel, new rel.constructor(0, 0, 1)); a.rig.upos.copy(f.ship.upos); });
await waitFor(() => window.app.game.flight.predictor.count > 50 && window.app.game.flight.readout.warnLevel === 2, null, 120000);
st = await state();
check('demo: close pass by Cygnus X-1 with the tidal warning', /TIDAL/.test(st.warning) && !st.ending, `${st.warning}`);
await shot('f11-bh-pass.png');

// 11. the reactionless drive: as fast as you like, never light's speed. A tenth of a light year out,
// 1,000 g (I, then = nine times) prograde at 10,000x: the Lorentz factor passes 100, the speed reads
// with its nines, and the universe's clock runs ahead of the ship's
await page.evaluate(() => { const a = window.app; a.flightClock(); a.select(null); a.rig.upos.copy(a.system.sun.upos).addXYZ(9.0e14, 2.5e14, 1.5e14); });
await waitFor(() => window.app.game.flight.readout.frame === 'Sun' && !window.app.game.flight.ending);
await page.keyboard.press('KeyI');
for (let i = 0; i < 9; i++) await page.keyboard.press('Equal');
await page.evaluate(() => { const f = window.app.game.flight; f.sas = 'prograde'; });
await frames(3);
const clocks0 = await page.evaluate(() => { const r = window.app.game.flight.readout; return { ship: r.shipTime, univ: r.universeTime, g: r.driveG, drive: r.drive }; });
await page.keyboard.down('KeyZ');
await frames(2);
await page.keyboard.up('KeyZ');
await page.evaluate(() => { window.app.clock.rate = 1e4; });
const fast = await waitFor(() => window.app.game.flight.readout.gamma > 100, null, 300000);
await page.keyboard.down('KeyX');
await waitFor(() => window.app.game.flight.ship.throttle === 0, null, 60000);
await page.keyboard.up('KeyX');
await page.evaluate(() => { window.app.clock.rate = 1; });
await frames(3);
st = await page.evaluate(() => {
  const f = window.app.game.flight, r = f.readout;
  return { gamma: r.gamma, v: f.ship.vel.length(), w: r.properSpeed, ship: r.shipTime, univ: r.universeTime, hud: document.querySelector('.fl-panel')?.textContent.replace(/\s+/g, ' ') ?? '' };
});
check('the reactionless drive at 1,000 g: γ past 100, the speed below c', fast && clocks0.drive === 'reactionless' && clocks0.g === 1000 && st.gamma > 100 && st.v < 299792458 && st.w > 100 * 299792458, JSON.stringify({ gamma: st.gamma, v: st.v, drive: clocks0.drive, g: clocks0.g }));
const dShip = st.ship - clocks0.ship, dUniv = st.univ - clocks0.univ;
check('time dilation: the universe\'s clock ran ahead of the ship\'s', dUniv > 20 * dShip, `ship +${(dShip / 3600).toFixed(1)} h, universe +${(dUniv / 3.15576e7).toFixed(2)} yr`);
check('the instruments read the speed with its nines and the Lorentz factor', /speed\s*0\.999 9/.test(st.hud) && /Lorentz factor\s*\d/.test(st.hud) && /ahead\s*half the sky in/.test(st.hud), (st.hud.match(/speed\s*[^a-z]*c/) ?? [''])[0] + ' · ' + (st.hud.match(/Lorentz factor\s*[^ a-z]+/) ?? [''])[0]);
await shot('f12-relativistic.png');
// the same panel on an upright phone: within the screen
await page.setViewportSize({ width: 390, height: 844 });
await frames(6);
st = await page.evaluate(() => { const r = document.querySelector('.fl-panel').getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom }; });
check('on a phone the instruments fit the screen', st.left >= 0 && st.right <= 390 && st.bottom < 844, JSON.stringify(st));
await shot('f13-phone.png');
await page.setViewportSize({ width: 1280, height: 720 });

// 12. the autopilot to another star, never faster than light: Rigil Kentaurus, 4.4 light years,
// flip-and-burn at 50 g (and 100,000x: about three months aboard, four and a half years in the
// universe); between any two looks the ship covers less than light would in the universe's time
// between them, and it arrives at the star
await page.evaluate(() => { const a = window.app; const e = a.findByName('Earth'); a.select(e); a.placeNear(e, e.radius * 40, 30, 10); a.clock.rate = 1; });
await waitFor(() => window.app.game.flight.readout.frame === 'Earth');
await page.evaluate(() => { const a = window.app; a.select(a.findByName('Rigil Kentaurus')); a.game.flight.ship.driveAccel = 50 * 9.80665; a.clock.rate = 1e5; });
await page.keyboard.press('KeyJ');
await frames(3);
const look = () => page.evaluate(() => { const a = window.app, f = a.game.flight, t = a.findByName('Rigil Kentaurus'); return { d: t.upos.sub(f.ship.upos).length(), jd: a.clock.jdTdb, ap: !!f.autopilot, rig: a.rig.autopilot, r: t.radius, hud: document.querySelector('.fl-panel')?.textContent.replace(/\s+/g, ' ') ?? '' }; });
let prev = await look(), fastest = 0;
const toGo = /to go \(flip-and-burn\)/.test(prev.hud) && /aboard/.test(prev.hud) && /universe/.test(prev.hud);
const engaged = prev.ap && !prev.rig;
const t0 = Date.now();
while (Date.now() - t0 < 900000) {
  await page.waitForTimeout(3000);
  const cur = await look();
  const dt = (cur.jd - prev.jd) * 86400;
  if (dt > 0) fastest = Math.max(fastest, (prev.d - cur.d) / dt / 299792458);
  prev = cur;
  if (!cur.ap) break;
}
check('J: the autopilot flies to Rigil Kentaurus, the time to go in both clocks', engaged && toGo, prev.hud.match(/to go[^]*?universe/)?.[0] ?? '');
check('never faster than light on the way', fastest > 0.5 && fastest < 1, `fastest closing speed ${fastest.toFixed(6)} c`);
check('arrives at the star', !prev.ap && prev.d < prev.r * 12, JSON.stringify({ d: prev.d, radius: prev.r, ap: prev.ap }));
await shot('f14-alpha-cen.png');

// 13. on a phone, by touch alone: More, Spaceship boards the ship; the tabs stay (where to go, time,
// the way out); + raises the drive's setting; Go there on a selected world starts the autopilot
{
  const ctx = await phoneContext(browser);
  const phone = await ctx.newPage();
  collectErrors(phone, errors);
  await phone.goto(`${base}?target=Earth`, { waitUntil: 'load' });
  await phone.waitForFunction(() => window.app && window.app.frameCount > 10, null, { timeout: 600000 });
  const f = await fingers(phone);
  const at = (sel) => phone.evaluate((q) => { const b = document.querySelector(q).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  if (await phone.evaluate(() => !document.querySelector('.hud-coach').hidden)) await f.tap(await at('.hud-coach [data-coach]'));
  await f.tap(await at('.hud-tabs [data-tab="more"]'));
  await f.frames(2);
  await f.tap(await at('.switch[data-act="ship"]'));
  await f.frames(4);
  st = await phone.evaluate(() => ({ mode: window.app.game.mode, on: window.app.game.flight.on, tabs: getComputedStyle(document.querySelector('.hud-tabs')).display !== 'none', g: window.app.game.flight.ship.driveAccel / 9.80665 }));
  const boarded = st.mode === 'cockpit' && st.on && st.tabs;
  await f.tap(await at('.fl-touch [data-step="up"]'));
  await f.frames(2);
  const g2 = await phone.evaluate(() => ({ g: window.app.game.flight.ship.driveAccel / 9.80665, shown: document.querySelector('.fl-touch span').textContent }));
  check('on a phone: Spaceship (More) boards, the tabs stay, + raises the drive', boarded && Math.abs(g2.g - 2) < 1e-9 && g2.shown === '2 g', JSON.stringify({ ...st, after: g2 }));
  await phone.evaluate(() => { const a = window.app; a.select(a.findByName('Moon')); });
  await f.frames(4);
  await f.tap(await at('[data-act="go"]'));
  await f.frames(3);
  st = await phone.evaluate(() => { const ap = window.app.game.flight.autopilot; return { target: ap?.target.name ?? null, rig: window.app.rig.autopilot }; });
  check('on a phone: Go there starts the ship\'s autopilot', st.target === 'Moon' && !st.rig, JSON.stringify(st));
  await phone.screenshot({ path: path.join(outDir, 'f15-phone-autopilot.png'), timeout: 180000 });
  await ctx.close();
}

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} flight checks passed`);
process.exit(failed ? 1 : 0);
