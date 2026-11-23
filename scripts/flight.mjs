// Real-physics ship flight in headless Chromium: orbit HUD and predicted path, a burn that changes
// the orbit, on-rails time warp, the autopilot's refusal deep in a well, a crash and respawn, a landing, a stellar black hole's
// tides and a supermassive one's horizon; the reactionless drive near light speed (never at it) and
// the autopilot to another star; on a phone, boarding, the drive's setting and Go there by touch, the
// instruments at a glance and the full read-out, the Time chip's rate in the ship, and flying by hand
// (steering by a finger, the throttle lever, Stop), upright and on its side; Fly there in your ship from
// the ground in a planet's air (it climbs out under its own drive, then goes on); the steering assist's
// modes and the side thrusters by touch. Usage: node scripts/flight.mjs [baseUrl] [outDir]
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
  return [...document.querySelectorAll('.fl-glance, .fl-touch > *, .fl-lever, .fl-stop, .fl-view, .fl-chips button, .fl-rcs, .fl-modes')].map((e) => {
    const cs = getComputedStyle(e), m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
    return { what: `${e.tagName.toLowerCase()}.${e.className}`, alpha: Number(m?.[1].split(',')[3] ?? '1'), blur: /blur/.test(cs.backdropFilter || cs.webkitBackdropFilter || '') };
  });
}
const seeThrough = (list) => list.filter((p) => !(p.alpha >= 0.88 && p.blur));
const waitFor = (fn, arg, timeout = 240000) => page.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);

// (Parts, for running the suite in two halves at once on two machines: together they are the whole suite.)
// FLIGHT_ONLY=desk runs 1-12 (one page at a desk), FLIGHT_ONLY=phone 13-18 (each on a fresh phone); unset: both.
const part = process.env.FLIGHT_ONLY ?? '';
let st;
if (part !== 'phone') { // (FLIGHT_ONLY: desk, 1-12; not indented, to keep the change small)
// 1. boarding in low Earth orbit: physics on, a circular orbit, the predicted path and its apsides
await page.goto(`${base}?time=2026-10-01T20:00:00Z&target=Earth&dist=1.0628&az=40&el=5&ship=cockpit&menu=0`, { waitUntil: 'load' });
await page.waitForFunction(() => window.app && window.app.renderer && window.app.frameCount > 10, null, { timeout: 120000 });
await waitFor(() => window.app.game.flight.predictor.count > 50 && window.app.game.flight.predictor.done);
st = await state();
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
const look = () => page.evaluate(() => { const a = window.app, f = a.game.flight, t = a.findByName('Rigil Kentaurus'); return { d: t.upos.sub(f.ship.upos).length(), jd: a.clock.jdTdb, ap: !!f.autopilot, rig: a.rig.autopilot, r: t.radius, frames: a.frameCount, hud: document.querySelector('.fl-panel')?.textContent.replace(/\s+/g, ' ') ?? '' }; });
let prev = await look(), fastest = 0;
const toGo = /to go \(speed up, turn, brake\)/.test(prev.hud) && /aboard/.test(prev.hud) && /outside/.test(prev.hud);
const engaged = prev.ap && !prev.rig;
const t0 = Date.now();
// (The flight takes a number of frames, not of seconds: the autopilot turns the ship at the control step of 0.1 s a frame
// at x1 and its time warp is held to a twentieth of the time to go a frame, so it arrives after about 1,150 frames: 540 s
// here at 2 frames a second under load, and on GitHub's runners, at about one a second in deep space, a little over the
// loop's old 900 s of wall time, which ended it with the autopilot still braking: 7.3e9 m and 5.1e9 m short on two runs, 4.5e12 m
// on a slower runner. It waits for the arrival itself, for up to four times the frames it takes, and for an hour at most.)
const f0 = prev.frames;
while (Date.now() - t0 < 3600000 && prev.frames - f0 < 4600) {
  await page.waitForTimeout(3000);
  const cur = await look();
  const dt = (cur.jd - prev.jd) * 86400;
  if (dt > 0) fastest = Math.max(fastest, (prev.d - cur.d) / dt / 299792458);
  prev = cur;
  if (!cur.ap) break;
}
check('J: the autopilot flies to Rigil Kentaurus, the time to go in both clocks', engaged && toGo, prev.hud.match(/to go[^]*?outside/)?.[0] ?? '');
check('never faster than light on the way', fastest > 0.5 && fastest < 1, `fastest closing speed ${fastest.toFixed(6)} c`);
check('arrives at the star', !prev.ap && prev.d < prev.r * 12, JSON.stringify({ d: prev.d, radius: prev.r, ap: prev.ap }));
await shot('f14-alpha-cen.png');
} // (FLIGHT_ONLY: desk)

if (part !== 'desk') { // (FLIGHT_ONLY: phone, 13-18; not indented, to keep the change small)
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
  await phone.evaluate(() => document.querySelector('.switch[data-act="ship"]').scrollIntoView({ block: 'center' }));
  await phone.waitForTimeout(300);
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
  check('nothing of the instruments or the controls is see-through (as opaque as the card, and blurred)', pieces.length === 12 && seeThrough(pieces).length === 0, JSON.stringify(seeThrough(pieces).length ? seeThrough(pieces) : pieces.map((p) => p.what)));
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

  // Now, in the ship: back to today and real time, the ship carried along with the world it was near
  // (here the Sun, 0.1 light years off: the same distance from it after)
  const sunDist = () => phone.evaluate(() => window.app.game.flight.ship.upos.sub(window.app.system.sun.upos).length());
  const sun0 = await sunDist();
  await f.tap(await at('.transport [data-act="now"]'));
  await f.frames(3);
  st = await phone.evaluate(() => ({ rate: window.app.clock.rate, fromToday: window.app.clock.jdTdb - (Date.now() / 86400000 + 2440587.5), on: window.app.game.flight.on }));
  const sun1 = await sunDist();
  check('Now in the ship: back to today, real time, the ship carried with the Sun', st.rate === 1 && Math.abs(st.fromToday) < 0.01 && st.on && Math.abs(sun1 / sun0 - 1) < 1e-3, JSON.stringify({ ...st, sun0, sun1 }));
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
  // (what the switch says: the view, in a touch screen's words, under the instruments, not behind
  // them; recorded as it is shown, since a frame of the chase view can outlast the message here)
  await phone.evaluate(() => {
    const t = document.querySelector('.hud-toast');
    window.__said = null;
    const look = () => {
      if (window.__said || !t.classList.contains('show')) return;
      const r = t.getBoundingClientRect();
      const covered = [...document.querySelectorAll('.fl-glance, .fl-touch, .fl-stick, .fl-lever, .fl-stop, .fl-view')].map((e) => e.getBoundingClientRect()).some((o) => o.width > 0 && r.left < o.right && o.left < r.right && r.top < o.bottom && o.top < r.bottom);
      window.__said = { text: t.textContent, shown: true, covered };
    };
    new MutationObserver(look).observe(t, { attributes: true, childList: true, characterData: true, subtree: true });
  });
  await f.tap(viewAt);
  const said = await phone.evaluate(() => window.__said ?? { shown: false, text: document.querySelector('.hud-toast').textContent });
  await f.frames(4);
  const v1 = await phone.evaluate(() => ({ mode: window.app.game.mode, on: window.app.game.flight.on, label: document.querySelector('.fl-view b').textContent }));
  check('on a phone the view switch says only the view, in touch words, clear of the instruments', said.shown && /^(Chase|Cockpit) view$/.test(said.text) && !/W\/S|SAS|key/.test(said.text) && !said.covered, JSON.stringify(said));
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
  check('on its side too, no sky label can read through the instruments or the controls', side.length === 12 && seeThrough(side).length === 0, JSON.stringify(seeThrough(side)));
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
        const mine = [...document.querySelectorAll('.fl-glance, .fl-touch, .fl-stick, .fl-chips')].filter(shown).map((e) => ({ what: e.className.split(' ')[0], ...box(e) }));
        const theirs = [...document.querySelectorAll('#hud .hud-top .chip, #hud .hud-tabs, #hud .hud-slot > .on')].filter(shown).map((e) => ({ what: e.className.split(' ').slice(0, 2).join('.'), ...box(e) }));
        const x = document.querySelector('.sheet.card.on [data-act="deselect"]');
        let closeOk = true;
        if (x) { const b = x.getBoundingClientRect(); closeOk = !!document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('[data-act="deselect"]'); }
        // the names of the sky drawn now: none of them under any of it
        const names = [...document.querySelectorAll('#labels .label')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => ({ what: e.textContent, ...box(e) }));
        // the orbit's tags (drawn in the view): their boxes on the screen, as the app projects them
        const a = window.app, vz = a.game.viz;
        const tags = (vz.tags ?? []).filter((t) => t.mesh.visible).map((t) => { const p = a.project(t.mesh.position); return p ? { what: 'orbit tag', l: p.x - 52, r: p.x + 52, t: p.y - 19.5, b: p.y + 19.5 } : null; }).filter(Boolean);
        return { mine, theirs, names, tags, closeOk, W: innerWidth, H: innerHeight };
      });
      const meet = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      const hits = got.mine.flatMap((m) => got.theirs.filter((o) => meet(m, o)).map((o) => `${m.what}/${o.what}`));
      const off = got.mine.filter((m) => m.l < 0 || m.t < 0 || m.r > got.W + 0.5 || m.b > got.H + 0.5).map((m) => `${m.what} off screen`);
      const glance = got.mine.some((m) => m.what === 'fl-glance');
      const under = [...got.names, ...got.tags].filter((n) => [...got.mine, ...got.theirs].some((o) => meet(n, o))).map((n) => n.what);
      named += got.names.length;
      if (hits.length || off.length || !got.closeOk || !glance || under.length) bad.push({ size: `${w}x${h}${inset ? ` inset ${inset}` : ''}`, sheet, hits, off, close: got.closeOk, glance, under });
      if (sheet === 'card' && w === 844 && h === 280) await phone.screenshot({ path: path.join(outDir, 'f21-phone-side-bars.png'), timeout: 180000 });
    }
  }
  check('on every phone size, upright and on its side, bars or not, the ship\'s instruments and controls cover nothing of the interface (the card\'s close button stays free), and no name of the sky is under any of it', bad.length === 0 && named > 50, `${named} names looked at; ${JSON.stringify(bad).slice(0, 600)}`);
  await ctx.close();
}

// 15b. the explorer on the same ten sizes: with a card's details open and the night notice up,
// nothing of the interface lies on anything else of it (the round buttons, the notice, the card,
// the tab bar, the chips, the live mark), and all of it is on the screen
{
  const ctx = await phoneContext(browser);
  const phone = await ctx.newPage();
  collectErrors(phone, errors);
  await phone.goto(`${base}?time=2026-10-01T20:00:00Z&target=Earth&dist=4&az=40&el=5&menu=0`, { waitUntil: 'load' });
  await phone.waitForFunction(() => window.app && window.app.frameCount > 10, null, { timeout: 600000 });
  const f = await fingers(phone);
  if (await phone.evaluate(() => !document.querySelector('.hud-coach').hidden)) {
    await f.tap(await phone.evaluate(() => { const b = document.querySelector('.hud-coach [data-coach]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }));
  }
  await phone.evaluate(() => { const a = window.app; a.select(a.findByName('Moon')); a.hud.notice('Night at Mount Everest: sunrise in 9 h 23 min', 'sunrise', 'Skip to sunrise'); });
  await f.frames(4);
  await phone.evaluate(() => document.querySelector('.card [data-details]').click());
  const sizes = [[390, 844, 0], [390, 664, 0], [375, 667, 0], [360, 640, 0], [430, 932, 0], [844, 390, 0], [844, 280, 47], [667, 375, 0], [932, 430, 47], [740, 360, 0]];
  const bad = [];
  for (const [w, h, inset] of sizes) {
    await phone.setViewportSize({ width: w, height: h });
    await phone.evaluate((i) => { const r = document.documentElement.style; r.setProperty('--safe-l', `${i}px`); r.setProperty('--safe-r', `${i}px`); }, inset);
    await f.frames(3);
    await phone.waitForTimeout(400);
    const got = await phone.evaluate(() => {
      const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
      const box = (e, what) => { const r = e.getBoundingClientRect(); return { what, l: r.left, r: r.right, t: r.top, b: r.bottom }; };
      const q = (sel, what) => [...document.querySelectorAll(sel)].filter(shown).map((e) => box(e, what));
      return {
        parts: [...q('#hud .hud-fabs > .fab', 'round button'), ...q('#hud .hud-notice', 'notice'), ...q('#hud .hud-slot > .on', 'panel'), ...q('#hud .hud-tabs', 'tabs'), ...q('#hud .hud-top .chip', 'chip'), ...q('#hud .live-mark', 'live mark')],
        details: !document.querySelector('.card .facts').hidden, W: innerWidth, H: innerHeight,
      };
    });
    const meet = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    const hits = [];
    got.parts.forEach((a, i) => got.parts.slice(i + 1).forEach((b) => { if (meet(a, b)) hits.push(`${a.what}/${b.what}`); }));
    const off = got.parts.filter((p) => p.l < -0.5 || p.t < -0.5 || p.r > got.W + 0.5 || p.b > got.H + 0.5).map((p) => `${p.what} off screen`);
    if (hits.length || off.length || !got.details || !got.parts.some((p) => p.what === 'notice')) bad.push({ size: `${w}x${h}${inset ? ` inset ${inset}` : ''}`, hits, off, details: got.details });
    if (w === 390 && h === 664) await phone.screenshot({ path: path.join(outDir, 'f25-phone-details-notice.png'), timeout: 180000 });
  }
  check('the explorer on ten phone sizes, a card\'s details open and a notice up: no part of the interface lies on another, all on the screen', bad.length === 0, JSON.stringify(bad).slice(0, 600));
  await ctx.close();
}

// 15c. the explorer on the same ten sizes, a card open: the selected world's centre is in the clear
// part of the view (not under the card, a chip or a button), upright and on its side. (On its side the
// view's optical centre is the middle of what the interface leaves clear, App's `centre`: the world,
// aimed at, is held there; upright it is lifted above the card.)
{
  const ctx = await phoneContext(browser);
  const phone = await ctx.newPage();
  collectErrors(phone, errors);
  await phone.goto(`${base}?time=2026-10-01T20:00:00Z&target=Earth&dist=4&az=40&el=5&menu=0`, { waitUntil: 'load' });
  await phone.waitForFunction(() => window.app && window.app.frameCount > 10, null, { timeout: 600000 });
  const f = await fingers(phone);
  if (await phone.evaluate(() => !document.querySelector('.hud-coach').hidden)) {
    await f.tap(await phone.evaluate(() => { const b = document.querySelector('.hud-coach [data-coach]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }));
  }
  const sizes = [[390, 844, 0], [390, 664, 0], [375, 667, 0], [360, 640, 0], [430, 932, 0], [844, 390, 0], [844, 280, 47], [667, 375, 0], [932, 430, 47], [740, 360, 0]];
  const bad = [];
  let seen = 0;
  for (const [w, h, inset] of sizes) {
    await phone.setViewportSize({ width: w, height: h });
    await phone.evaluate((i) => { const r = document.documentElement.style; r.setProperty('--safe-l', `${i}px`); r.setProperty('--safe-r', `${i}px`); }, inset);
    await f.frames(3);
    // (Look at: the camera turns to the world, as after a tap on it, and the centre eases to the clear part)
    await phone.evaluate(() => { const a = window.app; a.select(a.findByName('Earth')); a.act('centre'); });
    await phone.waitForTimeout(600);
    await f.frames(40);
    const got = await phone.evaluate(() => {
      const a = window.app, p = a.project(a.findByName('Earth').upos.sub(a.rig.upos)), part = a.hud.clearPart ? a.hud.clearPart() : null;
      const covers = a.hud.covers().map((c) => ({ ...c }));
      const under = p ? covers.filter((c) => p.x >= c.l && p.x <= c.r && p.y >= c.t && p.y <= c.b).length : -1;
      const card = !!document.querySelector('.hud-slot > .on[data-sheet="card"]');
      return { p: p && { x: Math.round(p.x), y: Math.round(p.y) }, under, card, W: innerWidth, H: innerHeight, side: innerWidth > innerHeight, box: part && part.box, shifts: !!part?.shifts };
    });
    const onScreen = got.p && got.p.x > 0 && got.p.y > 0 && got.p.x < got.W && got.p.y < got.H;
    // (on its side it is in the clear part, whose middle the view is centred on)
    const inClear = !got.side || (got.box && got.p && got.p.x >= got.box.l && got.p.x <= got.box.r && got.p.y >= got.box.t && got.p.y <= got.box.b);
    seen++;
    if (!got.card || !onScreen || got.under !== 0 || !inClear) bad.push({ size: `${w}x${h}${inset ? ` inset ${inset}` : ''}`, ...got });
    if (w === 844 && h === 390) await phone.screenshot({ path: path.join(outDir, 'f26-explorer-side-card.png'), timeout: 180000 });
  }
  check('the explorer on ten phone sizes, a card open: the selected world\'s centre is on the screen, under no part of the interface, and on its side in the clear part of the view', bad.length === 0 && seen === 10, JSON.stringify(bad).slice(0, 900));
  await ctx.close();
}

// 16. a new player on a phone (from the playtests): the ship found from a selected place ("Fly
// there in your ship"), the missions, "How to move" and the start menu in More, back to today in the
// Time sheet, a flight to a place on the ground in real time, the drag button saying what it does,
// leaving the ship bringing time back to real time, and the read-out saying why a trip takes years
{
  const ctx = await phoneContext(browser);
  const phone = await ctx.newPage();
  collectErrors(phone, errors);
  await phone.goto(`${base}?target=Earth`, { waitUntil: 'load' });
  await phone.waitForFunction(() => window.app && window.app.frameCount > 10, null, { timeout: 600000 });
  const f = await fingers(phone);
  const at = (sel) => phone.evaluate((q) => { const b = document.querySelector(q).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  if (await phone.evaluate(() => !document.querySelector('.hud-coach').hidden)) await f.tap(await at('.hud-coach [data-coach]'));
  const shown = (q) => phone.evaluate((sel) => { const e = document.querySelector(sel); return !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden'; }, q);
  // the drag button says what one finger does now
  st = await phone.evaluate(() => document.querySelector('.look-fab span').textContent);
  check('the drag button says what dragging does now', st === 'Drag: orbit', st);
  // More: How to move at the top, the missions with their count, the start menu
  await f.tap(await at('.hud-tabs [data-tab="more"]'));
  await f.frames(2);
  const more = await phone.evaluate(() => ({ first: document.querySelector('.more .list').firstElementChild.textContent.trim(), missions: document.querySelector('.more .missions summary').textContent, items: document.querySelectorAll('.more .missions li').length }));
  await f.tap(await at('.more .missions summary'));
  await f.frames(2);
  const open = await phone.evaluate(() => document.querySelector('.more .missions').open);
  await f.tap(await at('.more [data-help]'));
  // (the list scrolls to the help smoothly, a frame at a time: until the help is in sight and the
  // list has stood still for two frames, rather than a fixed 800 ms, which at one frame a second
  // on a runner was over before the scroll began; what is checked below is unchanged)
  await phone.waitForFunction(() => {
    const t = document.querySelector('.more .help-title').getBoundingClientRect(), list = document.querySelector('.more .list'), l = list.getBoundingClientRect();
    const w = (window.__helpScroll ??= { top: -1, still: 0 });
    w.still = list.scrollTop === w.top ? w.still + 1 : 0;
    w.top = list.scrollTop;
    return t.top >= l.top - 1 && t.bottom <= l.bottom && w.still >= 2;
  }, null, { timeout: 60000, polling: 'raf' }).catch(() => undefined);
  const help = await phone.evaluate(() => { const t = document.querySelector('.more .help-title').getBoundingClientRect(), l = document.querySelector('.more .list').getBoundingClientRect(); return t.top >= l.top - 1 && t.bottom <= l.bottom; });
  check('More: How to move first (and it scrolls to the help), the missions with their count', /^How to move/.test(more.first) && /\d+ of \d+ done/.test(more.missions) && more.items >= 20 && open && help, JSON.stringify({ ...more, open, help }));
  await phone.evaluate(() => document.querySelector('.more [data-act="menu"]').scrollIntoView({ block: 'center' }));
  await phone.waitForTimeout(300);
  await f.tap(await at('.more [data-act="menu"]'));
  await f.frames(3);
  const menu = await phone.evaluate(() => !!document.querySelector('#start-menu') && !!window.startMenu?.isOpen);
  await f.tap(await at('#start-menu .sm-item[data-id="sim"]'));
  await phone.waitForFunction(() => !window.startMenu.isOpen, null, { timeout: 60000 });
  await f.frames(3);
  // (the first steps' card again, where this browser keeps nothing between pages)
  if (await phone.evaluate(() => !document.querySelector('.hud-coach').hidden)) await f.tap(await at('.hud-coach [data-coach]'));
  st = await phone.evaluate(() => ({ hud: !document.querySelector('#hud').classList.contains('ui-off') }));
  check('More: Start menu opens the title screen, and Simulator comes back', menu && st.hud, JSON.stringify({ menu, ...st }));

  // a flight to a place on the ground with time running fast: made in real time, so it does not run away
  await phone.evaluate(() => { const a = window.app; a.clock.rate = 86400; });
  await phone.evaluate(() => { const a = window.app; const lm = a.landmarks.find((l) => l.name === 'Mount Everest'); a.select(lm); a.goTo(lm); });
  await f.frames(2);
  st = await phone.evaluate(() => ({ rate: window.app.clock.rate, toast: document.querySelector('.hud-toast').textContent }));
  check('a flight to a place on the ground drops time to real time, and says so', st.rate === 1 && /Real time for the flight/.test(st.toast), JSON.stringify(st));
  await phone.evaluate(() => { const a = window.app; a.rig.cancelGoto(); a.select(null); });

  // night at a place on a surface: on arrival a notice says so, with the time to sunrise, and offers it
  const nightAt = (name) => phone.evaluate((n) => {
    const a = window.app, lm = a.landmarks.find((l) => l.name === n);
    const s = a.system.sun.upos.sub(lm.world.upos).normalize();
    return Math.asin(lm.up().dot(s)) * 180 / Math.PI;
  }, name);
  // (a time of night at Everest: hour by hour from now, the first with the Sun 20° down)
  await phone.evaluate(() => {
    const a = window.app, lm = a.landmarks.find((l) => l.name === 'Mount Everest');
    a.clock.rate = 1;
    for (let h = 0; h < 30; h++) {
      a.system.update(a.clock.jdTdb);
      const s = a.system.sun.upos.sub(lm.world.upos).normalize();
      if (Math.asin(lm.up().dot(s)) < -0.35) break;
      a.clock.jdTdb += 1 / 24;
    }
  });
  await f.frames(3);
  await phone.evaluate(() => { const a = window.app, lm = a.landmarks.find((l) => l.name === 'Mount Everest'); a.select(lm); a.goTo(lm); });
  const told = await phone.waitForFunction(() => { const n = document.querySelector('.hud-notice'); return n && !n.hidden; }, null, { timeout: 300000 }).then(() => true).catch(() => false);
  const notice = await phone.evaluate(() => ({ text: document.querySelector('.hud-notice span').textContent, act: document.querySelector('.hud-notice .notice-act').textContent }));
  const h0 = await nightAt('Mount Everest');
  await phone.screenshot({ path: path.join(outDir, 'f24-phone-night.png'), timeout: 180000 });
  await f.tap(await at('.hud-notice .notice-act'));
  await f.frames(4);
  const h1 = await nightAt('Mount Everest');
  check('night at a place: said on arrival with the time to sunrise; Skip to sunrise brings the morning', told && /^Night at Mount Everest: sunrise in \d/.test(notice.text) && notice.act === 'Skip to sunrise' && h0 < -5 && h1 > 4 && h1 < 9, JSON.stringify({ told, ...notice, before: h0.toFixed(1), after: h1.toFixed(1) }));
  // a tour place is arrived at in daylight
  await phone.evaluate(() => {
    const a = window.app, lm = a.landmarks.find((l) => l.name === 'Mount Everest');
    for (let h = 0; h < 30; h++) {
      a.system.update(a.clock.jdTdb);
      const s = a.system.sun.upos.sub(lm.world.upos).normalize();
      if (Math.asin(lm.up().dot(s)) < -0.35) break;
      a.clock.jdTdb += 1 / 24;
    }
  });
  await f.frames(2);
  const tourId = await phone.evaluate(() => window.app.tourItems().find((i) => i.label === 'Mount Everest').id);
  await phone.evaluate((id) => window.app.pickDestination(id, 'tour'), tourId);
  await f.frames(3);
  const h2 = await nightAt('Mount Everest');
  check('a tour place is arrived at in daylight (the clock on to its morning, said so)', h2 > 4, `the Sun ${h2.toFixed(1)}° up at Mount Everest`);
  // (back out to where the phone began, well above the Earth's air)
  await phone.evaluate(() => { const a = window.app; a.rig.cancelGoto(); a.select(null); a.hud.clearNotice(); const e = a.findByName('Earth'); a.placeNear(e, e.radius * 4, 40, 10); });
  await f.frames(3);

  // back to today: offered in the Time sheet when the date is far from it
  await phone.evaluate(() => { window.app.clock.jdTdb += 400 * 365.25; });
  await f.tap(await at('.hud-tabs [data-tab="time"]'));
  await f.frames(3);
  const offered = await shown('.time-today');
  await f.tap(await at('.time-today'));
  await f.frames(3);
  st = await phone.evaluate(() => ({ fromToday: window.app.clock.jdTdb - (Date.now() / 86400000 + 2440587.5), rate: window.app.clock.rate, gone: document.querySelector('.time-today').hidden }));
  check('Back to today: offered 400 years on, one tap brings the date back', offered && Math.abs(st.fromToday) < 0.01 && st.rate === 1 && st.gone, JSON.stringify({ offered, ...st }));
  await f.tap(await at('.hud-tabs [data-tab="time"]'));
  await f.frames(2);

  // the ship from a selected place: one button, it boards and flies there, the drive set for the trip
  await phone.evaluate(() => { const a = window.app; a.select(a.findByName('Moon')); });
  await f.frames(4);
  const label = await phone.evaluate(() => document.querySelector('.ship-fab span').textContent);
  await f.tap(await at('.ship-fab'));
  await f.frames(4);
  st = await phone.evaluate(() => { const g = window.app.game, fl = g.flight; return { mode: g.mode, target: fl.autopilot?.target.name ?? null, drive: fl.ship.drive, g: fl.ship.driveAccel / 9.80665, refusal: fl.autopilotRefusal(), fab: getComputedStyle(document.querySelector('.ship-fab')).display }; });
  check('"Fly there in your ship": one tap boards the ship and its autopilot flies there, the drive set strong enough', label === 'Fly there in your ship' && st.mode === 'chase' && st.target === 'Moon' && st.drive === 'reactionless' && !st.refusal && st.fab === 'none', JSON.stringify({ label, ...st }));
  await phone.screenshot({ path: path.join(outDir, 'f23-phone-ship-there.png'), timeout: 180000 });

  // the read-out says why a trip would take years, and what to do
  await phone.evaluate(() => { const a = window.app, fl = a.game.flight; fl.cancelAutopilot('test'); fl.ship.drive = 'torch'; a.select(a.findByName('Sirius')); });
  await f.frames(6);
  await phone.waitForTimeout(300);
  st = await phone.evaluate(() => document.querySelector('.fl-l4').textContent);
  check('the glance says why a trip on the torch takes years, and what to do', /torch's fuel can never get you there sooner/.test(st) && /reactionless drive/.test(st), st);

  // leaving the ship with time running fast brings it back to real time
  await phone.evaluate(() => { window.app.clock.rate = 1e5; });
  await f.frames(2);
  await f.tap(await at('.hud-tabs [data-tab="more"]'));
  await f.frames(2);
  await phone.evaluate(() => document.querySelector('.switch[data-act="ship"]').scrollIntoView({ block: 'center' }));
  await phone.waitForTimeout(300);
  await f.tap(await at('.switch[data-act="ship"]'));
  await f.frames(3);
  st = await phone.evaluate(() => ({ mode: window.app.game.mode, rate: window.app.clock.rate }));
  check('leaving the ship: time back to real time', st.mode === 'off' && st.rate === 1, JSON.stringify(st));
  await ctx.close();
}

// 17. "Fly there in your ship" from inside a planet's air (it was refused: "climb above 127 km first"):
// from the ground at Earth with the Moon selected, one tap boards the ship and its autopilot climbs
// out of the air on its own drive (hull kept cool, never faster than the drive can push it, nothing
// jumping), then carries on to the Moon. With the drive too weak to climb, the refusal comes with a
// button that sets a stronger drive and goes.
{
  const ctx = await phoneContext(browser);
  const phone = await ctx.newPage();
  collectErrors(phone, errors);
  await phone.goto(`${base}?target=Earth&menu=0`, { waitUntil: 'load' });
  await phone.waitForFunction(() => window.app && window.app.frameCount > 10, null, { timeout: 600000 });
  const f = await fingers(phone);
  const at = (sel) => phone.evaluate((q) => { const b = document.querySelector(q).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  const until = (fn, timeout) => phone.waitForFunction(fn, null, { timeout }).then(() => true).catch(() => false);
  if (await phone.evaluate(() => !document.querySelector('.hud-coach').hidden)) await f.tap(await at('.hud-coach [data-coach]'));
  // down at Earth (the explorer at its surface), the Moon selected
  await phone.evaluate(() => { const a = window.app, e = a.findByName('Earth'); a.placeNear(e, e.radius + 2000, 40, 10); a.select(a.findByName('Moon')); });
  await f.frames(6);
  const label = await phone.evaluate(() => document.querySelector('.ship-fab span').textContent);
  // (watched every frame from here: the ship's place against what its speed allows between two frames)
  await phone.evaluate(() => {
    const fl = window.app.game.flight, w = (window.__climb = { d0: window.app.selection.upos.sub(window.app.rig.upos).length(), jump: -1e9, temp: 0, over: -1e9, prev: null, t0: null, phases: new Set(), glance: '' });
    const tick = () => {
      const r = fl.readout, p = fl.ship.upos.clone();
      if (fl.autopilot) {
        w.phases.add(fl.autopilot.steering.phase);
        if (w.t0 === null) w.t0 = fl.ship.shipTime;
        if (w.prev) w.jump = Math.max(w.jump, p.sub(w.prev).length() - (fl.ship.vel.length() + 30) * Math.max(fl.simDt, 1e-3) * 1.5);
        // (against the ground: what the drive's push gives in the time aboard since the autopilot began, and a little)
        w.over = Math.max(w.over, r.surfSpeed - (fl.ship.driveAccel * (fl.ship.shipTime - w.t0) + 5));
        w.temp = Math.max(w.temp, r.hullTemp);
        if (/climbing/.test(r.apState) && !w.glance) w.glance = document.querySelector('.fl-glance').textContent.replace(/\s+/g, ' ');
        w.prev = fl.ship.upos.clone();
      } else w.prev = null;
      requestAnimationFrame(tick);
    };
    tick();
  });
  await phone.screenshot({ path: path.join(outDir, 'f25-phone-air-before.png'), timeout: 180000 });
  await f.tap(await at('.ship-fab'));
  await f.frames(4);
  st = await phone.evaluate(() => { const g = window.app.game, fl = g.flight; return { mode: g.mode, target: fl.autopilot?.target.name ?? null, refusal: fl.autopilotRefusal(), alt: fl.readout.altitude, toast: document.querySelector('.hud-toast').textContent }; });
  check('"Fly there in your ship" from the ground in Earth\'s air: the autopilot takes the trip, and says it climbs first', label === 'Fly there in your ship' && st.mode === 'chase' && st.target === 'Moon' && !st.refusal && /climbing out of Earth's air first/.test(st.toast), JSON.stringify({ label, ...st }));
  // (time quickened: the autopilot holds a frame to two seconds of flight in the air)
  await phone.evaluate(() => { window.app.clock.rate = 50; });
  const out = await until(() => { const fl = window.app.game.flight; return !!fl.ending || fl.readout.altitude > 127.5e3; }, 600000);
  const up = await phone.evaluate(() => { const w = window.__climb, fl = window.app.game.flight; return { alt: fl.readout.altitude, ending: fl.ending?.title ?? null, temp: w.temp, over: w.over, jump: w.jump, phases: [...w.phases], glance: w.glance, v: fl.readout.surfSpeed, ap: fl.autopilot?.target.name ?? null, t: fl.ship.shipTime - w.t0 }; });
  await phone.screenshot({ path: path.join(outDir, 'f26-phone-air-out.png'), timeout: 180000 });
  check('it climbs out of the air under its own drive: past 127 km, nothing burnt or crashed, the hull well under its limit', out && !up.ending && up.alt > 127.5e3 && up.temp < 2000 && up.phases.includes('climbing'), JSON.stringify({ alt: Math.round(up.alt), temp: Math.round(up.temp), ending: up.ending, phases: up.phases, secs: Math.round(up.t) }));
  check('and honestly: never faster than the drive can have pushed it, no jump between frames', up.phases.includes('climbing') && up.over < 0 && up.jump < 0, `faster than the drive by ${up.over.toFixed(1)} m/s (negative: not), jump ${up.jump.toFixed(1)} m beyond what its speed allows (negative: none), ${up.v.toFixed(0)} m/s at the top`);
  check('the instruments say so while it climbs', /Autopilot: climbing/.test(up.glance), up.glance);
  // on from the top of the air, towards the Moon: the autopilot goes on flying there (no longer
  // climbing, never refused), and the Moon comes closer than it was when the flight began
  await phone.evaluate(() => { window.app.clock.rate = 1000; });
  const near = await until(() => { const fl = window.app.game.flight; return !!fl.ending || !fl.autopilot || fl.autopilot.target.upos.sub(fl.ship.upos).length() < 0.8 * window.__climb.d0; }, 600000);
  st = await phone.evaluate(() => { const fl = window.app.game.flight; return { ap: fl.autopilot?.target.name ?? null, phase: fl.autopilot?.steering.phase ?? '', d: fl.autopilot ? fl.autopilot.target.upos.sub(fl.ship.upos).length() : NaN, ending: fl.ending?.title ?? null, d0: window.__climb.d0, climbed: window.__climb.phases.has('climbing') }; });
  check('then it carries on to the Moon: still flying there, no longer climbing, and the Moon comes closer', near && st.ap === 'Moon' && st.phase !== 'climbing' && st.d < 0.8 * st.d0 && !st.ending && st.climbed, JSON.stringify(st));
  await ctx.close();
}

// 17b. the drive too weak to climb (1 g, gravity at the ground nearly 10 m/s²): Go there says why and
// offers the next sensible thing in a button: a stronger drive, and go
{
  const ctx = await phoneContext(browser);
  const phone = await ctx.newPage();
  collectErrors(phone, errors);
  await phone.goto(`${base}?target=Earth&menu=0`, { waitUntil: 'load' });
  await phone.waitForFunction(() => window.app && window.app.frameCount > 10, null, { timeout: 600000 });
  const f = await fingers(phone);
  const at = (sel) => phone.evaluate((q) => { const b = document.querySelector(q).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  if (await phone.evaluate(() => !document.querySelector('.hud-coach').hidden)) await f.tap(await at('.hud-coach [data-coach]'));
  await phone.evaluate(() => { const a = window.app, e = a.findByName('Earth'); a.placeNear(e, e.radius + 2000, 40, 10); });
  await f.tap(await at('.hud-tabs [data-tab="more"]'));
  await f.frames(2);
  await phone.evaluate(() => document.querySelector('.switch[data-act="ship"]').scrollIntoView({ block: 'center' }));
  await phone.waitForTimeout(300);
  await f.tap(await at('.switch[data-act="ship"]'));
  await f.frames(4);
  await phone.evaluate(() => { const a = window.app; a.game.flight.ship.driveAccel = 9.80665; a.select(a.findByName('Moon')); });
  await f.frames(4);
  await f.tap(await at('[data-act="go"]'));
  await f.frames(3);
  st = await phone.evaluate(() => { const n = document.querySelector('.hud-notice'), b = n.querySelector('.notice-act'); return { shown: !n.hidden, text: n.querySelector('span').textContent, act: b.hidden ? '' : b.textContent, ap: !!window.app.game.flight.autopilot, g: window.app.game.flight.ship.driveAccel / 9.80665 }; });
  check('with the drive too weak to climb, Go there says so and offers a button that names the drive it would use (5 g, enough to climb), and go', st.shown && /too weak/.test(st.text) && /^Use 5 g, and go$/.test(st.act) && !st.ap && st.g === 1, JSON.stringify(st));
  await phone.screenshot({ path: path.join(outDir, 'f27-phone-air-weak.png'), timeout: 180000 });
  await f.tap(await at('.hud-notice .notice-act'));
  await f.frames(4);
  st = await phone.evaluate(() => { const fl = window.app.game.flight; return { ap: fl.autopilot?.target.name ?? null, g: fl.ship.driveAccel / 9.80665, refusal: fl.autopilotRefusal(), shown: !document.querySelector('.hud-notice').hidden }; });
  check('that button sets the stronger drive and the autopilot starts (the climb first)', st.ap === 'Moon' && st.g >= 5 && !st.refusal && !st.shown, JSON.stringify(st));
  await ctx.close();
}

// 18. the steering assist and the side thrusters by touch (on a keyboard: Y, and A D R F Shift+W S),
// upright and on its side: an assist chip that names the mode and opens a small list, a thrusters
// chip that opens a pad of six buttons held to thrust (only while flying by hand: the autopilot or
// Stop has the ship otherwise)
for (const landscape of [false, true]) {
  const ctx = await phoneContext(browser, { landscape });
  const phone = await ctx.newPage();
  collectErrors(phone, errors);
  const tag = landscape ? 'on its side' : 'upright';
  await phone.goto(`${base}?time=2026-10-01T20:00:00Z&target=Earth&dist=4&az=40&el=5&ship=chase&menu=0`, { waitUntil: 'load' });
  await phone.waitForFunction(() => window.app && window.app.frameCount > 10 && window.app.game.flight.on, null, { timeout: 600000 });
  const f = await fingers(phone);
  const at = (sel) => phone.evaluate((q) => { const b = document.querySelector(q).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  const until = (fn, arg, timeout = 120000) => phone.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);
  const shown = (q) => phone.evaluate((sel) => { const e = document.querySelector(sel); return !!e && !e.hidden && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none'; }, q);
  if (await phone.evaluate(() => !document.querySelector('.hud-coach').hidden)) await f.tap(await at('.hud-coach [data-coach]'));
  // (nothing selected to begin with)
  await phone.evaluate(() => window.app.select(null));
  await f.frames(4);
  // (an app without the chips fails here, once, rather than in every check after)
  if (!(await phone.evaluate(() => !!document.querySelector('.fl-assist') && !!document.querySelector('.fl-thrust')))) {
    check(`${tag}: an assist chip and a thrusters chip stand on the screen`, false, 'no such chips');
    await ctx.close();
    continue;
  }
  // the two chips: on the screen, big enough for a thumb, opaque, the mode named
  st = await phone.evaluate(() => {
    const box = (q) => { const b = document.querySelector(q).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
    const hit = (q) => { const b = document.querySelector(q).getBoundingClientRect(); return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest(q) !== null; };
    return { assist: box('.fl-assist'), thrust: box('.fl-thrust'), name: document.querySelector('.fl-assist').textContent.replace(/\s+/g, ' ').trim(), hitA: hit('.fl-assist'), hitT: hit('.fl-thrust'), W: innerWidth, H: innerHeight, items: document.querySelectorAll('.fl-modes [data-sas]').length };
  });
  const chipsOk = [st.assist, st.thrust].every((b) => b.w >= 44 && b.h >= 40 && b.l >= 0 && b.t >= 0 && b.r <= st.W && b.b <= st.H);
  check(`${tag}: an assist chip (naming the mode) and a thrusters chip stand on the screen, thumb-sized and uncovered`, chipsOk && st.hitA && st.hitT && /Hold/.test(st.name) && st.items === 10, JSON.stringify(st));
  const piecesOpaque = await phone.evaluate(opacity);
  check(`${tag}: the new pieces are as opaque as the rest (no sky label reads through them)`, seeThrough(piecesOpaque).length === 0 && piecesOpaque.some((p) => /fl-assist/.test(p.what)) && piecesOpaque.some((p) => /fl-modes/.test(p.what)), JSON.stringify(seeThrough(piecesOpaque)));
  // the list: opens at the chip with the ten modes and the one in use marked; a mode touched is set and the list shuts
  await f.tap(await at('.fl-assist'));
  await f.frames(3);
  st = await phone.evaluate(() => ({ open: !document.querySelector('.fl-modes').hidden, marked: document.querySelector('.fl-modes [aria-checked="true"] .lg')?.textContent ?? null, n: document.querySelectorAll('.fl-modes [data-sas]').length, expanded: document.querySelector('.fl-assist').getAttribute('aria-expanded') }));
  await phone.screenshot({ path: path.join(outDir, `f28-phone-assist-list-${landscape ? 'side' : 'up'}.png`), timeout: 180000 });
  check(`${tag}: the assist chip opens a list of the ten modes with the one in use marked`, st.open && st.n === 10 && st.marked === 'Hold' && st.expanded === 'true', JSON.stringify(st));
  // (nothing selected: the target modes say so and change nothing)
  await f.tap(await at('.fl-modes [data-sas="target"]'));
  await f.frames(2);
  st = await phone.evaluate(() => ({ sas: window.app.game.flight.sas, toast: document.querySelector('.hud-toast').textContent, open: !document.querySelector('.fl-modes').hidden }));
  check(`${tag}: "To target" with nothing selected changes nothing and says to select a destination`, st.sas === 'stability' && /Select a destination/.test(st.toast), JSON.stringify(st));
  await f.tap(await at('.fl-modes [data-sas="retrograde"]'));
  await f.frames(3);
  st = await phone.evaluate(() => ({ sas: window.app.game.flight.sas, chip: document.querySelector('.fl-assist').textContent.replace(/\s+/g, ' ').trim(), open: !document.querySelector('.fl-modes').hidden }));
  // (and the ship does what the mode says: the nose comes round onto retrograde)
  const turned = await until(() => { const fl = window.app.game.flight; const d = fl.sasDirection(); const n = new d.constructor(0, 0, -1).applyQuaternion(fl.ship.quat); return d.dot(n) > 0.98; }, null, 240000);
  check(`${tag}: choosing Retrograde sets it, names it on the chip, shuts the list, and the ship turns its nose retrograde`, st.sas === 'retrograde' && /Retro/.test(st.chip) && !st.open && turned, JSON.stringify({ ...st, turned }));
  // (a touch elsewhere puts an open list away)
  await f.tap(await at('.fl-assist'));
  await f.frames(2);
  await f.tap({ x: landscape ? 560 : 195, y: landscape ? 250 : 520 });
  await f.frames(2);
  check(`${tag}: a touch elsewhere puts the list away`, await phone.evaluate(() => document.querySelector('.fl-modes').hidden), '');
  // with a destination selected the target modes work
  await phone.evaluate(() => { const a = window.app; a.select(a.findByName('Moon')); });
  await f.frames(3);
  await f.tap(await at('.fl-assist'));
  await f.frames(2);
  await f.tap(await at('.fl-modes [data-sas="target"]'));
  await f.frames(2);
  st = await phone.evaluate(() => window.app.game.flight.sas);
  check(`${tag}: with a destination selected, "To target" sets that mode`, st === 'target', st);
  await f.tap(await at('.fl-assist'));
  await f.frames(2);
  await f.tap(await at('.fl-modes [data-sas="stability"]'));
  await f.frames(2);

  // the thrusters: closed to begin with; the chip opens a pad of six buttons; each held thrusts its way
  check(`${tag}: the thrusters' pad is shut until its chip is touched`, !(await shown('.fl-rcs')), '');
  await f.tap(await at('.fl-thrust'));
  await f.frames(3);
  st = await phone.evaluate(() => ({ open: !document.querySelector('.fl-rcs').hidden, n: document.querySelectorAll('.fl-rcs [data-rcs]').length, small: [...document.querySelectorAll('.fl-rcs [data-rcs]')].filter((b) => { const r = b.getBoundingClientRect(); return r.width < 40 || r.height < 40; }).length, pressed: document.querySelector('.fl-thrust').getAttribute('aria-pressed') }));
  await phone.screenshot({ path: path.join(outDir, `f29-phone-thrusters-${landscape ? 'side' : 'up'}.png`), timeout: 180000 });
  check(`${tag}: the thrusters chip opens a pad of six buttons, each thumb-sized`, st.open && st.n === 6 && st.small === 0 && st.pressed === 'true', JSON.stringify(st));
  const axes = { 'x-': [-1, 0, 0], 'x+': [1, 0, 0], 'y+': [0, 1, 0], 'y-': [0, -1, 0], 'z-': [0, 0, -1], 'z+': [0, 0, 1] };
  const got = {};
  for (const [k, want] of Object.entries(axes)) {
    await f.press(await at(`.fl-rcs [data-rcs="${k}"]`));
    await f.frames(3);
    got[k] = await phone.evaluate(() => { const fl = window.app.game.flight; return { rcs: fl.ship.rcs.toArray(), felt: fl.ship.properAccel.length() }; });
    await f.lift();
    await f.frames(2);
    got[`${k} lifted`] = await phone.evaluate(() => window.app.game.flight.ship.rcs.toArray());
  }
  const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  check(`${tag}: each pad button thrusts its own way (left, right, up, down, forward, back: the keys A D R F Shift+W Shift+S) while held, and lifting stops it`,
    Object.entries(axes).every(([k, w]) => same(got[k].rcs, w) && same(got[`${k} lifted`], [0, 0, 0])), JSON.stringify(got));
  // and the ship really is pushed: held to the right, the crew feels 0.15 m/s² (6 kN on 40 t) along the ship's right
  await f.press(await at('.fl-rcs [data-rcs="x+"]'));
  await f.frames(4);
  st = await phone.evaluate(() => { const fl = window.app.game.flight, r = new fl.ship.quat.constructor().copy(fl.ship.quat), right = new fl.ship.properAccel.constructor(1, 0, 0).applyQuaternion(r); return { along: fl.ship.properAccel.dot(right), total: fl.ship.properAccel.length() }; });
  await phone.screenshot({ path: path.join(outDir, `f30-phone-thrusters-held-${landscape ? 'side' : 'up'}.png`), timeout: 180000 });
  await f.lift();
  check(`${tag}: held, a button really pushes the ship (6 kN on its 40 t: 0.15 m/s² along its right)`, Math.abs(st.along - 0.15) < 0.03 && Math.abs(st.total - 0.15) < 0.05, JSON.stringify(st));
  // the autopilot flying takes the ship: the pad is put away and the chip with it, the assist chip says Auto;
  // a mode chosen then is the pilot's hand, and the autopilot lets go
  await phone.evaluate(() => { const a = window.app, fl = a.game.flight; a.select(a.findByName('Moon')); fl.driveFor(a.findByName('Moon')); fl.autopilotTo(a.findByName('Moon')); });
  await f.frames(8);
  st = await phone.evaluate(() => ({ ap: !!window.app.game.flight.autopilot, chip: document.querySelector('.fl-assist').textContent.replace(/\s+/g, ' ').trim(), thrust: !document.querySelector('.fl-thrust').hidden && document.querySelector('.fl-thrust').getBoundingClientRect().width > 0, pad: !document.querySelector('.fl-rcs').hidden && document.querySelector('.fl-rcs').getBoundingClientRect().width > 0 }));
  check(`${tag}: with the autopilot flying, the thrusters (chip and pad) are put away and the assist chip says Auto`, st.ap && /Auto/.test(st.chip) && !st.thrust && !st.pad, JSON.stringify(st));
  await f.tap(await at('.fl-assist'));
  await f.frames(2);
  await f.tap(await at('.fl-modes [data-sas="prograde"]'));
  await f.frames(3);
  st = await phone.evaluate(() => ({ ap: !!window.app.game.flight.autopilot, sas: window.app.game.flight.sas, thrust: getComputedStyle(document.querySelector('.fl-thrust')).display !== 'none' && !document.querySelector('.fl-thrust').hidden }));
  check(`${tag}: choosing a mode takes the controls from the autopilot, and the thrusters come back`, !st.ap && st.sas === 'prograde' && st.thrust, JSON.stringify(st));
  await ctx.close();
}

// 18b. the new controls on every phone size, upright and on its side, bars or not: with the chips
// alone, with the thrusters' pad open, and with the assist's list open, nothing of the ship's lies on
// anything of the interface or on another piece of the ship's, all of it is on the screen, no name of
// the sky is under it, and the interface still leaves a clear part of the view of at least 112 x 96
// (room for the target's brackets, App's `centre` and Hud.clearPart count every piece of it)
{
  const ctx = await phoneContext(browser);
  const phone = await ctx.newPage();
  collectErrors(phone, errors);
  await phone.goto(`${base}?time=2026-10-01T20:00:00Z&target=Earth&dist=4&az=40&el=5&ship=chase&menu=0`, { waitUntil: 'load' });
  await phone.waitForFunction(() => window.app && window.app.frameCount > 10 && window.app.game.flight.on, null, { timeout: 600000 });
  const f = await fingers(phone);
  if (await phone.evaluate(() => !document.querySelector('.hud-coach').hidden)) {
    await f.tap(await phone.evaluate(() => { const b = document.querySelector('.hud-coach [data-coach]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }));
  }
  await phone.evaluate(() => { const a = window.app; a.select(a.findByName('Sirius')); });
  const sizes = [[390, 844, 0], [390, 664, 0], [375, 667, 0], [360, 640, 0], [430, 932, 0], [844, 390, 0], [844, 280, 47], [667, 375, 0], [932, 430, 47], [740, 360, 0]];
  const bad = [];
  let looked = 0;
  for (const state of ['chips', 'pad', 'list']) {
    for (const [w, h, inset] of sizes) {
      await phone.setViewportSize({ width: w, height: h });
      await phone.evaluate(({ inset, state }) => {
        const r = document.documentElement.style;
        r.setProperty('--safe-l', `${inset}px`);
        r.setProperty('--safe-r', `${inset}px`);
        window.app.hud.closeSheet();
        const click = (q, want) => { const e = document.querySelector(q); if (e && e.getAttribute(want[0]) !== want[1]) e.click(); };
        click('.fl-thrust', ['aria-pressed', state === 'pad' ? 'true' : 'false']);
        click('.fl-assist', ['aria-expanded', state === 'list' ? 'true' : 'false']);
      }, { inset, state });
      await f.frames(3);
      await phone.waitForTimeout(400);
      await f.frames(2);
      const got = await phone.evaluate(() => {
        const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; };
        const shown = (e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden';
        const mine = [...document.querySelectorAll('.fl-glance, .fl-touch, .fl-lever, .fl-stop, .fl-view, .fl-chips, .fl-rcs, .fl-modes')].filter(shown).map((e) => ({ what: e.className.split(' ')[0], ...box(e) }));
        const theirs = [...document.querySelectorAll('#hud .hud-top .chip, #hud .hud-tabs, #hud .hud-slot > .on')].filter(shown).map((e) => ({ what: e.className.split(' ').slice(0, 2).join('.'), ...box(e) }));
        const names = [...document.querySelectorAll('#labels .label')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => ({ what: e.textContent, ...box(e) }));
        const part = window.app.hud.clearPart();
        return { mine, theirs, names, part: part && { w: part.box.r - part.box.l, h: part.box.b - part.box.t }, W: innerWidth, H: innerHeight };
      });
      const meet = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      const hits = got.mine.flatMap((m) => got.theirs.filter((o) => meet(m, o)).map((o) => `${m.what}/${o.what}`));
      const among = got.mine.flatMap((m, i) => got.mine.slice(i + 1).filter((o) => meet(m, o)).map((o) => `${m.what}/${o.what}`));
      const off = got.mine.filter((m) => m.l < 0 || m.t < 0 || m.r > got.W + 0.5 || m.b > got.H + 0.5).map((m) => `${m.what} off screen`);
      const under = got.names.filter((n) => [...got.mine, ...got.theirs].some((o) => meet(n, o))).map((n) => n.what);
      const wanted = { chips: ['fl-chips'], pad: ['fl-chips', 'fl-rcs'], list: ['fl-chips', 'fl-modes'] }[state];
      const missing = wanted.filter((k) => !got.mine.some((m) => m.what === k));
      looked += got.names.length;
      // (a clear part of 112 x 96 at least, where the brackets of the target have room)
      // (not with the list open: it is a menu for a moment, and says so by covering the view)
      const room = state === 'list' || (!!got.part && got.part.w >= 112 && got.part.h >= 96);
      if (hits.length || among.length || off.length || under.length || missing.length || !room) bad.push({ size: `${w}x${h}${inset ? ` inset ${inset}` : ''}`, state, hits, among, off, under, missing, clear: got.part });
      if (w === 844 && h === 280 && state === 'pad') await phone.screenshot({ path: path.join(outDir, 'f31-phone-side-bars-thrusters.png'), timeout: 180000 });
      if (w === 360 && h === 640 && state === 'pad') await phone.screenshot({ path: path.join(outDir, 'f32-phone-small-thrusters.png'), timeout: 180000 });
    }
  }
  check('on every phone size, upright and on its side: the chips, the thrusters\' pad and the assist\'s list, shown, lie on nothing of the interface or of the ship\'s own, are all on the screen, hide no name of the sky, and (the list aside, a menu for a moment) leave the view a clear part of 112 x 96 at least', bad.length === 0 && looked > 30, `${looked} names looked at; ${JSON.stringify(bad).slice(0, 900)}`);
  await ctx.close();
}

} // (FLIGHT_ONLY: phone)
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} flight checks passed`);
process.exit(failed ? 1 : 0);
