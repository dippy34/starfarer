// Real-physics ship flight in headless Chromium: orbit HUD and predicted path, a burn that changes
// the orbit, on-rails time warp, the autopilot's refusal deep in a well, a crash and respawn, a landing, a stellar black hole's
// tides and a supermassive one's horizon; the reactionless drive near light speed (never at it) and
// the autopilot to another star; on a phone, boarding, the drive's setting and Go there by touch, the
// instruments at a glance and the full read-out, the Time chip's rate in the ship, and flying by hand
// (steering by a finger, the throttle lever, Stop), upright and on its side. Usage: node scripts/flight.mjs [baseUrl] [outDir]
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
/**
 * (in the page) every piece of the ship's instruments and controls over the view on a touch screen:
 * how opaque its background is and whether it blurs what is behind it. A sky label under a piece
 * that is less than either reads through it (it did, under the drive's setting, on a phone on its side).
 */
function opacity() {
  return [...document.querySelectorAll('.fl-glance, .fl-touch > *, .fl-lever, .fl-stop, .fl-view')].map((e) => {
    const cs = getComputedStyle(e), m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
    return { what: `${e.tagName.toLowerCase()}.${e.className}`, alpha: Number(m?.[1].split(',')[3] ?? '1'), blur: /blur/.test(cs.backdropFilter || cs.webkitBackdropFilter || '') };
  });
}
const seeThrough = (list) => list.filter((p) => !(p.alpha >= 0.88 && p.blur));
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
  // (a phone opens the ship in the chase view)
  const boarded = st.mode === 'chase' && st.on && st.tabs;
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

  // the instruments at a glance: under the clock, in the top quarter of the screen, opaque (no sky
  // label reads through them), the speed and its target as the full read-out has them
  st = await phone.evaluate(() => {
    // (the instruments: the card and the drive under it; the lever below them is the controls')
    const top = { top: document.querySelector('.fl-glance').getBoundingClientRect().top, ...(({ bottom, left, right }) => ({ bottom, left, right }))(document.querySelector('.fl-touch').getBoundingClientRect()) }, chip = document.querySelector('.chip.clock').getBoundingClientRect();
    const g = document.querySelector('.fl-glance'), bg = getComputedStyle(g).backgroundColor;
    const alpha = Number((bg.match(/rgba?\(([^)]+)\)/)?.[1].split(',')[3] ?? '1'));
    return { top: top.top, bottom: top.bottom, left: top.left, right: top.right, chip: chip.bottom, alpha, desk: getComputedStyle(document.querySelector('.fl-desk')).display, speed: g.querySelector('.fl-l1 b').textContent, text: [...g.children].map((e) => e.textContent.trim()).filter(Boolean).join(' | ') };
  });
  check('on a phone the instruments are a card under the clock, in the top quarter, opaque', st.top >= st.chip && st.bottom <= 0.25 * 844 && st.left >= 0 && st.right <= 390 && st.alpha >= 0.85 && st.desk === 'none', JSON.stringify(st));
  const pieces = await phone.evaluate(opacity);
  check('nothing of the instruments or the controls is see-through (as opaque as the card, and blurred)', pieces.length === 8 && seeThrough(pieces).length === 0, JSON.stringify(seeThrough(pieces).length ? seeThrough(pieces) : pieces.map((p) => p.what)));
  check('at a glance: the speed, what the autopilot does, the target', /^\d[\d., ]* (m\/s|km\/s|c)$/.test(st.speed) && !/^1\.0+ c/.test(st.speed) && /Autopilot: /.test(st.text) && /Moon · /.test(st.text), st.text);
  // the full read-out is a tap away, as a sheet; a tap on the card again folds it
  await f.tap(await at('.fl-glance'));
  await f.frames(4);
  st = await phone.evaluate(() => ({ open: document.querySelector('#hud').dataset.sheet, text: document.querySelector('.flight-body').textContent.replace(/\s+/g, ' '), h: document.querySelector('.sheet.flight').getBoundingClientRect().top }));
  const readoutOk = st.open === 'flight' && /Lorentz factor/.test(st.text) && /ship clock/.test(st.text) && /universe clock/.test(st.text) && /time warp/.test(st.text);
  await phone.screenshot({ path: path.join(outDir, 'f16-phone-readout.png'), timeout: 180000 });
  await f.tap(await at('.fl-glance'));
  await f.frames(2);
  const folded = await phone.evaluate(() => document.querySelector('#hud').dataset.sheet !== 'flight');
  check('one tap opens the full read-out (both clocks, the Lorentz factor), another folds it', readoutOk && folded, `${st.open} ${st.text.slice(0, 90)}`);

  // the Time chip tells the ship's warp: Faster steps it by tens to x100,000 and no further; the chip
  // says the rate the ship's clock runs at, measured here from its own clock
  await phone.evaluate(() => { const a = window.app, fl = a.game.flight; fl.cancelAutopilot('test'); a.select(null); a.rig.upos.copy(a.system.sun.upos).addXYZ(9.0e14, 2.5e14, 1.5e14); });
  await phone.waitForFunction(() => window.app.game.flight.readout.frame === 'Sun', null, { timeout: 240000 });
  await f.tap(await at('.hud-tabs [data-tab="time"]'));
  await f.frames(2);
  const steps = [];
  for (let i = 0; i < 6; i++) {
    await f.tap(await at('.transport [data-act="faster"]'));
    steps.push(await phone.evaluate(() => window.app.clock.rate));
  }
  const m0 = await phone.evaluate(() => ({ ship: window.app.game.flight.ship.shipTime, t: performance.now() }));
  await phone.waitForTimeout(4000);
  await f.frames(3);
  st = await phone.evaluate((m) => {
    const fl = window.app.game.flight;
    return { measured: (fl.ship.shipTime - m.ship) / ((performance.now() - m.t) / 1000), pace: fl.readout.pace, chip: document.querySelector('.chip.clock small').textContent, sheet: document.querySelector('.time-rate').textContent, rows: document.querySelector('.ship-time').textContent.replace(/\s+/g, ' ') };
  }, m0);
  const shown = Number((st.chip.match(/×([\d,.]+) aboard/)?.[1] ?? 'NaN').replace(/,/g, ''));
  check('Faster steps the ship\'s warp x10, x100 ... x100,000, and stops there', JSON.stringify(steps) === JSON.stringify([10, 100, 1000, 10000, 100000, 100000]), JSON.stringify(steps));
  check('the Time chip says the warp the ship\'s clock runs at', st.chip === st.sheet && shown > 0 && Math.abs(shown / st.measured - 1) < 0.25 && /Aboard\s*×/.test(st.rows) && /In the universe/.test(st.rows), JSON.stringify({ chip: st.chip, measured: Math.round(st.measured), rows: st.rows.slice(0, 120) }));
  await phone.screenshot({ path: path.join(outDir, 'f17-phone-time.png'), timeout: 180000 });

  // Now, in the ship: back to real time, the date kept (the worlds would jump from under it)
  const jdNow0 = await phone.evaluate(() => window.app.clock.jdTdb);
  await f.tap(await at('.transport [data-act="now"]'));
  await f.frames(2);
  st = await phone.evaluate((jd0) => ({ rate: window.app.clock.rate, dDays: window.app.clock.jdTdb - jd0 }), jdNow0);
  check('Now in the ship: real time aboard, the date kept', st.rate === 1 && Math.abs(st.dDays) < 50, JSON.stringify(st));
  await f.tap(await at('.hud-tabs [data-tab="time"]')); // (closes the sheet: the lever shows again)
  await f.frames(2);

  // flying by hand. The drive: its name is a switch (the torch, or the reactionless drive)
  // (+ chose the reactionless drive above: a tap on its name gives the torch, another brings it back)
  const driveNow = () => phone.evaluate(() => ({ drive: window.app.game.flight.ship.drive, label: document.querySelector('.fl-which').textContent }));
  const d0 = await driveNow();
  await f.tap(await at('.fl-which'));
  await f.frames(3);
  const d1 = await driveNow();
  await f.tap(await at('.fl-which'));
  await f.frames(3);
  st = await driveNow();
  check('on a phone: the drive\'s name switches the torch and the reactionless drive', d0.drive === 'reactionless' && d1.drive === 'torch' && /^Fusion torch/.test(d1.label) && st.drive === 'reactionless' && /^Reactionless/.test(st.label), JSON.stringify({ d0, d1, d2: st }));

  // steering: a finger dragged to the right across the sky turns the ship to the left (the sky goes
  // with the finger), then the ship holds its new attitude
  // (the nose is the ship's -z axis, its left its -x axis, from the attitude quaternion)
  const nose = () => phone.evaluate(() => { const e = window.app.game.flight.ship.quat; const x = 2 * (e.x * e.z + e.w * e.y), y = 2 * (e.y * e.z - e.w * e.x), z = 1 - 2 * (e.x * e.x + e.y * e.y); const lx = 1 - 2 * (e.y * e.y + e.z * e.z), ly = 2 * (e.x * e.y + e.w * e.z), lz = 2 * (e.x * e.z - e.w * e.y); return { n: [-x, -y, -z], left: [-lx, -ly, -lz] }; });
  const n0 = await nose();
  await f.drag({ x: 110, y: 520 }, { x: 250, y: 520 }, { steps: 12, rest: 0.3 });
  await f.frames(30);
  const n1 = await nose();
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const turned = Math.acos(Math.min(1, dot(n0.n, n1.n))) * 57.2958;
  const leftward = dot([n1.n[0] - n0.n[0], n1.n[1] - n0.n[1], n1.n[2] - n0.n[2]], n0.left);
  st = await phone.evaluate(() => window.app.game.flight.ship.angVel.length());
  check('on a phone: dragging the sky to the right turns the ship to the left, then it holds still', turned > 3 && leftward > 0 && st < 0.02, `turned ${turned.toFixed(1)}°, spin left ${st.toFixed(4)} rad/s`);

  // a burn: the lever pushed to the top is full thrust, and stays so when the finger lifts
  const lever = await phone.evaluate(() => { const b = document.querySelector('.fl-lever').getBoundingClientRect(); return { x: b.left + b.width / 2, top: b.top + 6, bottom: b.bottom - 6 }; });
  const w0 = await phone.evaluate(() => window.app.game.flight.readout.properSpeed);
  await f.drag({ x: lever.x, y: lever.bottom }, { x: lever.x, y: lever.top }, { steps: 8, rest: 0.1 });
  await f.frames(15);
  st = await phone.evaluate(() => ({ throttle: window.app.game.flight.ship.throttle, w: window.app.game.flight.readout.properSpeed, shown: document.querySelector('.fl-lever b').textContent, state: document.querySelector('.fl-l2').textContent }));
  check('on a phone: the lever at the top is full thrust, and the ship speeds up', st.throttle === 1 && st.w > w0 + 5 && st.shown === '100%' && /^Thrust 100 %/.test(st.state), JSON.stringify({ w0, ...st }));
  await phone.screenshot({ path: path.join(outDir, 'f19-phone-burn.png'), timeout: 180000 });
  await f.drag({ x: lever.x, y: lever.top }, { x: lever.x, y: lever.bottom }, { steps: 8, rest: 0.1 });
  await f.frames(3);
  const cut = await phone.evaluate(() => window.app.game.flight.ship.throttle);

  // Stop: the ship turns round, brakes on the drive and comes to rest beside the Sun (out here
  // nothing pulls to speak of: it lets go, at rest)
  const w1 = await phone.evaluate(() => window.app.game.flight.readout.properSpeed);
  await f.tap(await at('.fl-stop'));
  await f.frames(3);
  const began = await phone.evaluate(() => ({ on: !!window.app.game.flight.stopping, pressed: document.querySelector('.fl-stop').getAttribute('aria-pressed'), state: document.querySelector('.fl-l2').textContent }));
  await phone.screenshot({ path: path.join(outDir, 'f20-phone-stopping.png'), timeout: 180000 });
  const stopped = await phone.waitForFunction(() => !window.app.game.flight.stopping, null, { timeout: 600000 }).then(() => true).catch(() => false);
  st = await phone.evaluate(() => ({ w: window.app.game.flight.readout.properSpeed, throttle: window.app.game.flight.ship.throttle, frame: window.app.game.flight.readout.frame }));
  // the view: a switch between the chase view (where a phone boards) and the cockpit, both ways, a thumb's size
  const viewAt = await at('.fl-view');
  const vsize = await phone.evaluate(() => { const b = document.querySelector('.fl-view').getBoundingClientRect(); return { w: b.width, h: b.height, label: document.querySelector('.fl-view b').textContent, mode: window.app.game.mode }; });
  const other = (m) => (m === 'chase' ? 'cockpit' : 'chase'), named = (m) => (m === 'chase' ? 'Chase' : 'Cockpit');
  await f.tap(viewAt);
  await f.frames(4);
  const v1 = await phone.evaluate(() => ({ mode: window.app.game.mode, on: window.app.game.flight.on, label: document.querySelector('.fl-view b').textContent }));
  await phone.screenshot({ path: path.join(outDir, 'f22-phone-view.png'), timeout: 180000 });
  await f.tap(await at('.fl-view'));
  await f.frames(4);
  const v2 = await phone.evaluate(() => ({ mode: window.app.game.mode, on: window.app.game.flight.on }));
  check('on a phone: the view switch goes between the chase view and the cockpit, both ways, the flight going on', vsize.w >= 44 && vsize.h >= 44 && vsize.label === named(other(vsize.mode)) && v1.mode === other(vsize.mode) && v1.on && v1.label === named(vsize.mode) && v2.mode === vsize.mode && v2.on, JSON.stringify({ vsize, v1, v2 }));
  check('on a phone: the lever at its foot cuts the thrust; Stop brakes the ship to rest', cut === 0 && began.on && began.pressed === 'true' && /^Stop: /.test(began.state) && stopped && st.w < 0.5 && st.throttle === 0 && w1 > 5, JSON.stringify({ cut, w1, began, after: st }));
  await ctx.close();
}

// 14. a phone on its side: the instruments at the right under the clock, the full read-out opens
// at the left beside the tabs, neither covering the other
{
  const ctx = await phoneContext(browser, { landscape: true });
  const phone = await ctx.newPage();
  collectErrors(phone, errors);
  await phone.goto(`${base}?time=2026-10-01T20:00:00Z&target=Earth&dist=1.0628&az=40&el=5&ship=cockpit&menu=0`, { waitUntil: 'load' });
  await phone.waitForFunction(() => window.app && window.app.frameCount > 10 && window.app.game.flight.on, null, { timeout: 600000 });
  const f = await fingers(phone);
  const at = (sel) => phone.evaluate((q) => { const b = document.querySelector(q).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  if (await phone.evaluate(() => !document.querySelector('.hud-coach').hidden)) await f.tap(await at('.hud-coach [data-coach]'));
  await f.frames(4);
  await f.tap(await at('.fl-glance'));
  await f.frames(4);
  st = await phone.evaluate(() => {
    const r = (q) => { const b = document.querySelector(q).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    return { top: r('.fl-top'), chip: r('.chip.clock'), sheet: r('.sheet.flight'), tabs: r('.hud-tabs'), stick: r('.fl-stick'), open: document.querySelector('#hud').dataset.sheet };
  });
  const apart = (a, b) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
  check('on its side: the instruments under the clock, the read-out beside the tabs, apart', st.open === 'flight' && st.top.t >= st.chip.b && st.top.r <= 844 && st.top.b <= 0.6 * 390 && apart(st.top, st.sheet) && apart(st.top, st.tabs), JSON.stringify(st));
  const side = await phone.evaluate(opacity);
  check('on its side too, no sky label can read through the instruments or the controls', side.length === 8 && seeThrough(side).length === 0, JSON.stringify(seeThrough(side)));
  check('on its side: the lever and Stop along the foot at the right, under the thumb, clear of the instruments and the read-out', st.stick.r <= 844 && st.stick.b <= 390 && st.stick.r >= 844 - 60 && st.stick.b >= 390 - 60 && apart(st.stick, st.top) && apart(st.stick, st.sheet), JSON.stringify(st.stick));
  await phone.screenshot({ path: path.join(outDir, 'f18-phone-side.png'), timeout: 180000 });
  await ctx.close();
}

// 15. every phone size, upright and on its side, with the browser's bars taking some of it (the
// owner's iPhone on its side: 844 x 280 left of them, 47 px of notch either side): with a star's
// card open, and with the Time sheet, nothing of the ship's covers the chips, the tab bar or the
// open panel, all of it is on the screen, and the card's close button is uncovered
{
  const ctx = await phoneContext(browser);
  const phone = await ctx.newPage();
  collectErrors(phone, errors);
  await phone.goto(`${base}?time=2026-10-01T20:00:00Z&target=Earth&dist=4&az=40&el=5&ship=cockpit&menu=0`, { waitUntil: 'load' });
  await phone.waitForFunction(() => window.app && window.app.frameCount > 10 && window.app.game.flight.on, null, { timeout: 600000 });
  const f = await fingers(phone);
  if (await phone.evaluate(() => !document.querySelector('.hud-coach').hidden)) {
    await f.tap(await phone.evaluate(() => { const b = document.querySelector('.hud-coach [data-coach]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }));
  }
  await phone.evaluate(() => { const a = window.app; a.select(a.findByName('Sirius')); });
  const sizes = [[390, 844, 0], [390, 664, 0], [375, 667, 0], [360, 640, 0], [430, 932, 0], [844, 390, 0], [844, 280, 47], [667, 375, 0], [932, 430, 47], [740, 360, 0]];
  const bad = [];
  let named = 0;
  for (const sheet of ['card', 'time']) {
    for (const [w, h, inset] of sizes) {
      await phone.setViewportSize({ width: w, height: h });
      await phone.evaluate(({ inset, sheet }) => {
        const r = document.documentElement.style;
        r.setProperty('--safe-l', `${inset}px`);
        r.setProperty('--safe-r', `${inset}px`);
        if (sheet === 'time') window.app.hud.openSheet('time'); else window.app.hud.closeSheet();
      }, { inset, sheet });
      await f.frames(3);
      await phone.waitForTimeout(400);
      await f.frames(2);
      const got = await phone.evaluate(() => {
        const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; };
        const shown = (e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden';
        const mine = [...document.querySelectorAll('.fl-glance, .fl-touch, .fl-stick')].filter(shown).map((e) => ({ what: e.className.split(' ')[0], ...box(e) }));
        const theirs = [...document.querySelectorAll('#hud .hud-top .chip, #hud .hud-tabs, #hud .hud-slot > .on')].filter(shown).map((e) => ({ what: e.className.split(' ').slice(0, 2).join('.'), ...box(e) }));
        const x = document.querySelector('.sheet.card.on [data-act="deselect"]');
        let closeOk = true;
        if (x) { const b = x.getBoundingClientRect(); closeOk = !!document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('[data-act="deselect"]'); }
        // the names of the sky drawn now: none of them under any of it
        const names = [...document.querySelectorAll('#labels .label')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => ({ what: e.textContent, ...box(e) }));
        return { mine, theirs, names, closeOk, W: innerWidth, H: innerHeight };
      });
      const meet = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      const hits = got.mine.flatMap((m) => got.theirs.filter((o) => meet(m, o)).map((o) => `${m.what}/${o.what}`));
      const off = got.mine.filter((m) => m.l < 0 || m.t < 0 || m.r > got.W + 0.5 || m.b > got.H + 0.5).map((m) => `${m.what} off screen`);
      const glance = got.mine.some((m) => m.what === 'fl-glance');
      const under = got.names.filter((n) => [...got.mine, ...got.theirs].some((o) => meet(n, o))).map((n) => n.what);
      named += got.names.length;
      if (hits.length || off.length || !got.closeOk || !glance || under.length) bad.push({ size: `${w}x${h}${inset ? ` inset ${inset}` : ''}`, sheet, hits, off, close: got.closeOk, glance, under });
      if (sheet === 'card' && w === 844 && h === 280) await phone.screenshot({ path: path.join(outDir, 'f21-phone-side-bars.png'), timeout: 180000 });
    }
  }
  check('on every phone size, upright and on its side, bars or not, the ship\'s instruments and controls cover nothing of the interface (the card\'s close button stays free), and no name of the sky is under any of it', bad.length === 0 && named > 50, `${named} names looked at; ${JSON.stringify(bad).slice(0, 600)}`);
  await ctx.close();
}

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} flight checks passed`);
process.exit(failed ? 1 : 0);
