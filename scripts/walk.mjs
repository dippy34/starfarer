// Walking mode in headless Chromium: on the Moon (Apollo 17) and Mars (Gale Crater) on the desktop,
// gas giants refused, then the same in an emulated Meta Quest 3 (IWER) with the thumbsticks.
// On a phone, by touch: the Walk button over ground, the stick, looking by drag, Jump and Fly.
// Usage: node scripts/walk.mjs [baseUrl] [outDir] [desktop|vr|sea|touch|all]
import { collectErrors, launchBrowser } from './lib/browser.mjs';
import { fingers, phoneContext } from './lib/touch.mjs';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'screenshots';
const which = process.argv[4] ?? 'all';
fs.mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const errors = [];

async function openPage(vr) {
  const page = await browser.newPage({ viewport: vr ? { width: 960, height: 540 } : { width: 800, height: 450 } });
  collectErrors(page, errors);
  if (vr) {
    await page.addInitScript({ path: 'node_modules/iwer/build/iwer.min.js' });
    await page.addInitScript(() => {
      const d = new IWER.XRDevice(IWER.metaQuest3);
      d.stereoEnabled = true;
      d.installRuntime({ forceInstall: true, polyfillLayers: true });
      window.__xrDevice = d;
    });
  }
  await page.goto(`${base}?time=2026-10-01T20:00:00Z&paused=1&target=Moon&dist=3`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.app && window.app.renderer && window.app.frameCount > 10, null, { timeout: 600000 });
  await page.evaluate(() => { window.app.terrain.budgetMs = 60; window.app.terrain.budgetVrMs = 60; });
  return page;
}

const framesOn = (page) => async (n) => {
  const f = await page.evaluate(() => window.app.frameCount);
  await page.waitForFunction((x) => window.app.frameCount > x, f + n, { timeout: 180000 });
};

/** Record the walker's state on every frame for `n` frames (in the page). */
const sample = (page, n) => page.evaluate((k) => new Promise((res) => {
  const out = [];
  let last = window.app.frameCount;
  const t = setInterval(() => {
    const a = window.app;
    if (a.frameCount === last) return;
    last = a.frameCount;
    out.push(a.walk.debug());
    if (out.length >= k) { clearInterval(t); res(out); }
  }, 2);
}), n);

/**
 * Stand above a landmark with the Sun `sunEl` degrees up there (the paused clock is stepped to
 * that hour), about 20 m above the ground once it has been built.
 */
async function goToSite(page, landmark, sunEl) {
  const frames = framesOn(page);
  await page.evaluate(({ landmark, sunEl }) => {
    const a = window.app;
    const lm = a.landmarks.find((l) => l.name === landmark);
    const b = lm.world;
    const jd0 = a.clock.jdTdb;
    let best = jd0, bestErr = Infinity;
    for (let h = 0; h < 24 * 30; h += 1) {
      a.system.update(jd0 + h / 24);
      const s = a.system.sun.upos.sub(b.upos).normalize();
      const err = Math.abs((Math.asin(lm.up().dot(s)) * 180) / Math.PI - sunEl);
      if (err < bestErr) { bestErr = err; best = jd0 + h / 24; }
    }
    a.system.update(jd0);
    a.clock.jdTdb = best;
    a.select(lm);
  }, { landmark, sunEl });
  await frames(3);
  const place = (h) => page.evaluate(({ landmark, h }) => {
    const a = window.app;
    const lm = a.landmarks.find((l) => l.name === landmark);
    const up = lm.up();
    a.rig.setAnchor(lm.world);
    a.rig.upos.copy(lm.upos).addVec(up, h);
    // look along the ground, away from the Sun
    const sun = a.system.sun.upos.sub(lm.world.upos).normalize();
    const hor = sun.clone().negate().addScaledVector(up, sun.dot(up)).normalize();
    a.rig.lookAt(hor, up);
  }, { landmark, h });
  await place(400);
  await page.waitForFunction((n) => window.app.terrain.owner?.name === n && window.app.terrain.hScale > 0.99, landmark.includes('Apollo') ? 'Moon' : 'Mars', { timeout: 180000 });
  await frames(4);
  // 20 m above the ground actually there
  await page.evaluate(() => {
    const a = window.app;
    const bl = a.terrain.below(a.rig.upos);
    a.rig.upos.addVec(a.rig.upos.sub(bl.centre).normalize(), bl.ground + 20 - bl.dist);
  });
  await frames(6);
}

const stats = (xs) => ({ min: Math.min(...xs), max: Math.max(...xs), mean: xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length) });

async function desktopSite(page, id, landmark, world, gExpect) {
  const frames = framesOn(page);
  await goToSite(page, landmark, 25);
  await page.keyboard.press('KeyB');
  await page.waitForFunction(() => window.app.walk.state === 'walk', null, { timeout: 180000 });
  await frames(4);
  let st = await page.evaluate(() => window.app.walk.debug());
  check(`${id}: B lands and starts walking on ${world}`, st.state === 'walk' && st.world === world, JSON.stringify({ state: st.state, world: st.world }));
  check(`${id}: gravity on ${world} is ${gExpect} m/s²`, Math.abs(st.gravity - gExpect) < 0.03, st.gravity.toFixed(3));
  const hud = await page.evaluate(() => document.querySelector('.walk-hud')?.textContent ?? '');
  check(`${id}: HUD says walking on ${world} with its gravity`, hud.includes(`Walking on ${world === 'Moon' ? 'the Moon' : world}`) && hud.includes(gExpect.toFixed(1)), hud.slice(0, 80));
  await page.screenshot({ timeout: 400000, path: path.join(outDir, `${id}-standing.png`) });

  // walk forward
  const p0 = st.pos;
  await page.keyboard.down('KeyW');
  const walk = await sample(page, 30);
  await page.keyboard.up('KeyW');
  await page.screenshot({ timeout: 400000, path: path.join(outDir, `${id}-walking.png`) });
  const eyes = walk.filter((s) => s.onGround).map((s) => s.eyeH);
  const es = stats(eyes);
  st = walk[walk.length - 1];
  const moved = Math.hypot(st.pos[0] - p0[0], st.pos[1] - p0[1], st.pos[2] - p0[2]);
  check(`${id}: W walks forward`, moved > 1.5 && Math.max(...walk.map((s) => s.speed)) > 1.2 && Math.max(...walk.map((s) => s.speed)) < 1.6, `moved ${moved.toFixed(2)} m, top speed ${Math.max(...walk.map((s) => s.speed)).toFixed(2)} m/s`);
  check(`${id}: eye height stays 1.7 ± 0.1 m while walking`, eyes.length > 20 && es.min > 1.6 && es.max < 1.8, JSON.stringify(es));
  check(`${id}: no NaN, view upright`, walk.every((s) => s.finite) && walk.every((s) => Math.abs(s.roll) < 1e-3), `max roll ${Math.max(...walk.map((s) => Math.abs(s.roll))).toExponential(1)}`);

  // run (Shift): faster; on the Moon and Mars running is bounding
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  const run = await sample(page, 40);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const top = Math.max(...run.map((s) => s.speed));
  check(`${id}: Shift runs (2.5-4 m/s)${gExpect < 5 ? ' in low-gravity bounds' : ''}`, top > 2.5 && top < 4 && (gExpect > 5 || run.some((s) => !s.onGround)), `top ${top.toFixed(2)} m/s, airborne frames ${run.filter((s) => !s.onGround).length}`);
  await page.waitForFunction(() => window.app.walk.body.onGround && window.app.walk.body.groundSpeed < 0.1, null, { timeout: 600000 });

  // jump and land
    // hold Space until the walker leaves the ground (a press can fall between frames at 2 fps)
  await page.keyboard.down('Space');
  await page.waitForFunction(() => !window.app.walk.body.onGround, null, { timeout: 900000 });
  await page.keyboard.up('Space');
  const jump = [];
  for (let i = 0; i < 40 && !(jump.length > 3 && jump[jump.length - 1].onGround); i++) jump.push(...await sample(page, 5));
  const air = jump.filter((s) => !s.onGround);
  const apex = Math.max(...jump.map((s) => s.apex));
  const tAir = Math.max(...air.map((s) => s.airTime), 0);
  const v = 2.5, hExp = (v * v) / (2 * gExpect), tExp = (2 * v) / gExpect;
  check(`${id}: Space jumps ${hExp.toFixed(2)} m high for ${tExp.toFixed(1)} s`, Math.abs(apex - hExp) < 0.1 * hExp + 0.05 && Math.abs(tAir - tExp) < 0.15 + 0.08 * tExp, `apex ${apex.toFixed(2)} m, ${tAir.toFixed(2)} s in the air`);
  st = jump[jump.length - 1];
  check(`${id}: lands back on the ground`, st.onGround && Math.abs(st.feetH) < 0.05 && jump.every((s) => s.finite), JSON.stringify({ onGround: st.onGround, feetH: st.feetH }));
  check(`${id}: paused time still lets you walk (not paused by Space)`, await page.evaluate(() => window.app.clock.paused), '');
  await frames(10);
  await page.screenshot({ timeout: 400000, path: path.join(outDir, `${id}-landed.png`) });

  // a boulder in the way: walk straight at one taller than 0.8 m from 2 m away; it stops you
  const setup = await page.evaluate(() => {
    const a = window.app, w = a.walk, b = w.body;
    if (!a.rocks.group.visible) return null;
    const big = a.rocks.rocksNear(b.pos, 60, 0.4)
      .filter((k) => k.radius > 0.6 && k.centre.length() + k.radius - w.ground(k.centre.clone().normalize()) > 0.8)
      .sort((p, q) => p.centre.distanceTo(b.pos) - q.centre.distanceTo(b.pos))[0];
    if (!big) return null;
    const up = big.centre.clone().normalize();
    const side = new up.constructor(0, 0, 1).cross(up).normalize();
    b.placeOn(big.centre.clone().addScaledVector(side, big.radius + 2).normalize(), w.ground);
    w.visR = b.radius;
    w.fwd.copy(side).negate();
    w.pitch = 0;
    window.__boulder = big;
    return { radius: big.radius, height: big.centre.length() + big.radius - w.ground(up) };
  });
  if (setup) {
    await page.keyboard.down('KeyW');
    const into = await sample(page, 40);
    await page.keyboard.up('KeyW');
    const geo = await page.evaluate(() => {
      const a = window.app, w = a.walk, b = w.body, k = window.__boulder;
      const up = k.centre.clone().normalize();
      const rel = b.pos.clone().sub(k.centre);
      return { dist: rel.addScaledVector(up, -rel.dot(up)).length(), aboveTerrain: b.radius - w.ground(b.pos.clone().normalize()) };
    });
    const blocked = into.some((s) => s.blocked);
    check(`${id}: a ${setup.height.toFixed(1)} m boulder stops you instead of letting you walk through or onto it`,
      blocked && geo.dist > setup.radius * 0.6 && geo.aboveTerrain < 0.5 && into.every((s) => s.finite), JSON.stringify({ ...setup, ...geo, blocked }));
  } else {
    console.log(`${id}: no boulder taller than 0.8 m within 60 m (rocks check skipped)`);
  }
}

async function seaCheck(page) {
  const frames = framesOn(page);
  let st;
  // the sea's edge on Earth (Nazaré, Portugal): walking west goes into the sea and swims, swimming back walks out onto the beach,
  // and B over the open sea comes down into it, swimming
  await page.evaluate(() => {
    const a = window.app, e = a.findByName('Earth');
    a.select(e);
    // (the camera stays on what it is on, the toggle's rule since 28 Nov 2026: here, the Earth)
    a.rig.target = e;
    const la = (39.6015 * Math.PI) / 180, lo = (-9.0735 * Math.PI) / 180;
    const nBF = e.upos.sub(a.rig.upos).set(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
    const up = nBF.clone().transformDirection(e.orientation);
    a.rig.setAnchor(e);
    a.rig.upos.copy(e.upos).addVec(up, e.radius + 400);
    const west = nBF.clone().set(Math.sin(lo), -Math.cos(lo), 0).transformDirection(e.orientation);
    a.rig.lookAt(west, up);
  });
  await page.waitForFunction(() => window.app.terrain.owner?.name === 'Earth' && window.app.terrain.hScale > 0.99, null, { timeout: 900000 });
  await frames(6);
  // find the shoreline west of here: march from 1 km inland to 4 km offshore (step metres), the first open water
  const findShore = (range, step) => page.evaluate(([range, step]) => {
    const a = window.app, t = a.terrain, e = a.findByName('Earth');
    const bl = t.below(a.rig.upos);
    const lo = (-9.0735 * Math.PI) / 180;
    const west = bl.dir.clone().set(Math.sin(lo), -Math.cos(lo), 0);
    west.addScaledVector(bl.dir, -west.dot(bl.dir)).normalize();
    const axis = bl.dir.clone().cross(west).normalize();
    const at = (m) => bl.dir.clone().applyAxisAngle(axis, m / e.radius).normalize();
    let dry = null;
    for (let m = range[0]; m < range[1]; m += step) {
      if (t.isSea(at(m))) { if (dry !== null) return { found: true, m }; } else dry = m;
    }
    return { found: false };
  }, [range, step]);
  /** put the eye `h` metres above the ground `m` metres west of here (negative: east), looking west */
  const placeWest = (m, h) => page.evaluate(([m, h]) => {
    const a = window.app, t = a.terrain, e = a.findByName('Earth');
    const bl = t.below(a.rig.upos);
    const lo = (-9.0735 * Math.PI) / 180;
    const west = bl.dir.clone().set(Math.sin(lo), -Math.cos(lo), 0);
    west.addScaledVector(bl.dir, -west.dot(bl.dir)).normalize();
    const n = bl.dir.clone().applyAxisAngle(bl.dir.clone().cross(west).normalize(), m / e.radius).normalize();
    a.rig.upos.copy(e.upos).addVec(n.clone().transformDirection(e.orientation), t.groundRadius(n) + h);
    a.rig.lookAt(west.clone().transformDirection(e.orientation), n.clone().transformDirection(e.orientation));
  }, [m, h]);
  await frames(20); // the coast sharpens as finer elevation tiles arrive (it moves by kilometres at first)
  let shore = await findShore([-3000, 4000], 5);
  if (shore.found) {
    // go there, let the ground there sharpen, and find the water's edge again, to the metre
    await placeWest(shore.m - 20, 1.7);
    await frames(16);
    shore = await findShore([-300, 300], 1);
  }
  if (!shore.found) {
    check('w7: found the shoreline at Nazaré', false, JSON.stringify(shore));
  } else {
    // stand 4 m inland of it, facing the sea, and walk west
    await placeWest(shore.m - 4, 1.7);
    await frames(4);
    await page.keyboard.press('KeyB');
    await page.waitForFunction(() => window.app.walk.state === 'walk' || window.app.walk.said.includes('water'), null, { timeout: 600000 });
    const began = await page.evaluate(() => ({ state: window.app.walk.state, said: window.app.walk.said }));
    if (began.state !== 'walk') { check('w7: walking starts 4 m inland of the shoreline', false, JSON.stringify(began)); return; }
    await page.keyboard.down('KeyW');
    const toSea = await sample(page, 40);
    await page.keyboard.up('KeyW');
    const wet = () => page.evaluate(() => { const a = window.app, w = a.walk, d = w.debug(); return { sea: a.terrain.isSea(w.body.pos.clone().normalize()), state: w.state, swim: d.swim, onGround: d.onGround, eyeH: d.eyeH, said: w.said }; });
    st = await wet();
    const p0 = toSea[0].pos, p1 = toSea[toSea.length - 1].pos;
    const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    // (the sea is swum in since 28 Nov 2026, the owner: "I should be able to actually swim around in the ocean"; the
    // shoreline was a wall, and the open sea refused)
    check('w7: walking into the Atlantic you swim: in the sea, floating, the eye just over the water', st.sea && st.swim && st.state === 'walk' && st.eyeH > 0.15 && st.eyeH < 0.5 && moved > 2,
      JSON.stringify({ ...st, moved: +moved.toFixed(2) }));
    await page.screenshot({ timeout: 400000, path: path.join(outDir, 'w7-swimming.png') });
    // back to the shore: out of the water onto the beach, standing
    await page.keyboard.down('KeyS');
    await page.waitForFunction(() => !window.app.walk.body.swim, null, { timeout: 300000 }).catch(() => undefined);
    await page.keyboard.up('KeyS');
    await frames(6);
    st = await wet();
    check('w7: swimming back to the shore you walk out onto the beach, standing', !st.sea && !st.swim && st.onGround && st.state === 'walk' && Math.abs(st.eyeH - 1.7) < 0.2, JSON.stringify(st));
    await page.keyboard.press('KeyB');
    // hover 30 m over the sea a little offshore and ask to walk: down into the water, swimming
    await placeWest(60, 30);
    await frames(4);
    await page.keyboard.press('KeyB');
    await page.waitForFunction(() => window.app.walk.state === 'walk' || window.app.walk.state === 'off', null, { timeout: 300000 }).catch(() => undefined);
    await frames(4);
    st = await wet();
    check('w7: B over the open sea comes down into the water, swimming', st.state === 'walk' && st.swim && st.sea, JSON.stringify(st));
  }
}

// walking on a phone, by touch alone: over the Apollo 17 site the Walk button lands and walks; the
// stick under the left thumb walks (all the way: faster), a finger dragged on the view turns the
// view with it, Jump leaves the ground, Fly takes off again
if (which === 'all' || which === 'touch') {
  const ctx = await phoneContext(browser);
  const page = await ctx.newPage();
  collectErrors(page, errors);
  await page.goto(`${base}?time=2026-10-01T20:00:00Z&paused=1&target=Moon&dist=3&menu=0`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.app && window.app.renderer && window.app.frameCount > 10, null, { timeout: 600000 });
  await page.evaluate(() => { window.app.terrain.budgetMs = 60; });
  const f = await fingers(page);
  const at = (sel) => page.evaluate((q) => { const b = document.querySelector(q).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; }, sel);
  if (await page.evaluate(() => !document.querySelector('.hud-coach').hidden)) await f.tap(await at('.hud-coach [data-coach]'));
  await goToSite(page, 'Apollo 17 landing site', 25);
  const offered = await page.waitForFunction(() => { const b = document.querySelector('.walk-fab'); return b && !b.hidden && b.getBoundingClientRect().width > 0; }, null, { timeout: 180000 }).then(() => true).catch(() => false);
  await f.tap(await at('.walk-fab'));
  const walking = await page.waitForFunction(() => window.app.walk.state === 'walk', null, { timeout: 180000 }).then(() => true).catch(() => false);
  await f.frames(4);
  let st = await page.evaluate(() => ({ pad: !document.querySelector('.walk-pad').hidden, tabs: getComputedStyle(document.querySelector('.hud-tabs')).display, hud: document.querySelector('.walk-hud').textContent }));
  check('t1: over the ground a Walk button lands and walks; the stick, Jump and Fly come up', offered && walking && st.pad && st.tabs === 'none' && /stick walks/.test(st.hud), JSON.stringify({ offered, walking, ...st }));
  await page.screenshot({ timeout: 400000, path: path.join(outDir, 't1-touch-standing.png') });
  // the stick pushed forward (up), held: the walker walks
  const stick = await at('.walk-stick');
  const p0 = (await page.evaluate(() => window.app.walk.debug())).pos;
  await f.press({ x: stick.x, y: stick.y });
  await f.slide({ x: stick.x, y: stick.y - stick.w * 0.3 });
  const walk = await sample(page, 30);
  await page.screenshot({ timeout: 400000, path: path.join(outDir, 't2-touch-walking.png') });
  await f.lift();
  const p1 = walk[walk.length - 1].pos;
  const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]), top = Math.max(...walk.map((s) => s.speed));
  check('t2: the stick pushed part way walks the walker forward', moved > 1 && top > 0.5 && top < 1.6, `moved ${moved.toFixed(2)} m, top speed ${top.toFixed(2)} m/s`);
  // looking: a finger dragged to the right across the view turns it to the left
  const look = () => page.evaluate(() => { const q = window.app.rig.quat; return [-(2 * (q.x * q.z + q.w * q.y)), -(2 * (q.y * q.z - q.w * q.x)), -(1 - 2 * (q.x * q.x + q.y * q.y))]; });
  const right0 = await page.evaluate(() => { const q = window.app.rig.quat; return [-(1 - 2 * (q.y * q.y + q.z * q.z)), -(2 * (q.x * q.y + q.w * q.z)), -(2 * (q.x * q.z - q.w * q.y))]; });
  const l0 = await look();
  await f.drag({ x: 140, y: 420 }, { x: 260, y: 420 }, { steps: 10, rest: 0.3 });
  await f.frames(3);
  const l1 = await look();
  const turned = Math.acos(Math.min(1, l0[0] * l1[0] + l0[1] * l1[1] + l0[2] * l1[2])) * 57.2958;
  const leftward = (l1[0] - l0[0]) * right0[0] + (l1[1] - l0[1]) * right0[1] + (l1[2] - l0[2]) * right0[2];
  check('t3: a finger dragged right turns the view left (the sky goes with it)', turned > 5 && leftward > 0, `turned ${turned.toFixed(1)}°`);
  // Jump: off the ground, and down again
  await f.tap(await at('.walk-jump'));
  const jump = await sample(page, 25);
  check('t4: Jump leaves the ground', jump.some((s) => !s.onGround && s.vUp > 0.3), `highest vUp ${Math.max(...jump.map((s) => s.vUp)).toFixed(2)} m/s`);
  // Fly: back to free flight, the interface back
  await f.tap(await at('.walk-fly'));
  await f.frames(3);
  st = await page.evaluate(() => ({ state: window.app.walk.state, pad: !document.querySelector('.walk-pad').hidden, tabs: getComputedStyle(document.querySelector('.hud-tabs')).display }));
  // the pad on ten phone sizes, upright and on its side: the stick, Jump and Fly on the screen, apart,
  // and clear of the chips and the walker's line (walking again first)
  await page.evaluate(() => window.app.walk.start());
  await page.waitForFunction(() => window.app.walk.state === 'walk', null, { timeout: 180000 });
  const sizes = [[390, 844], [390, 664], [375, 667], [360, 640], [430, 932], [844, 390], [844, 280], [667, 375], [932, 430], [740, 360]];
  const padBad = [], offCentre = [];
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await f.frames(3);
    await page.waitForTimeout(400);
    const got = await page.evaluate(() => {
      const box = (e, what) => { const r = e.getBoundingClientRect(); return { what, l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; };
      const parts = [box(document.querySelector('.walk-stick'), 'stick'), box(document.querySelector('.walk-jump'), 'Jump'), box(document.querySelector('.walk-fly'), 'Fly'),
        ...[...document.querySelectorAll('#hud .hud-top .chip')].map((e) => box(e, 'chip')), box(document.querySelector('.walk-hud'), 'walker line')];
      return { parts, W: innerWidth, H: innerHeight, cx: window.app.view.cx, cy: window.app.view.cy };
    });
    // (on foot the view stays as it is: its optical centre is the middle on every size, on its side too)
    if (got.cx !== 0 || got.cy !== 0) offCentre.push({ size: `${w}x${h}`, cx: got.cx, cy: got.cy });
    const meet = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    const hits = [];
    got.parts.forEach((a, i) => got.parts.slice(i + 1).forEach((b) => { if (a.w > 0 && b.w > 0 && meet(a, b)) hits.push(`${a.what}/${b.what}`); }));
    const off = got.parts.filter((p) => p.w > 0 && (p.l < -0.5 || p.t < -0.5 || p.r > got.W + 0.5 || p.b > got.H + 0.5)).map((p) => `${p.what} off screen`);
    const missing = got.parts.filter((p) => ['stick', 'Jump', 'Fly'].includes(p.what) && !(p.w >= 44)).map((p) => `${p.what} too small`);
    if (hits.length || off.length || missing.length) padBad.push({ size: `${w}x${h}`, hits, off, missing });
  }
  check('t6: on ten phone sizes the stick, Jump and Fly are on the screen, a thumb\'s size, apart, clear of the chips and the walker\'s line', padBad.length === 0, JSON.stringify(padBad).slice(0, 500));
  check('t6b: on foot the view\'s optical centre is the middle of the screen on ten phone sizes, sideways too (the horizon does not move with the interface)', offCentre.length === 0, JSON.stringify(offCentre));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.app.walk.exit(true));
  await f.frames(2);
  check('t5: Fly takes off again: free flight, the tabs back', st.state === 'off' && !st.pad && st.tabs !== 'none', JSON.stringify(st));
  await ctx.close();
}

if (which === 'sea') {
  const page = await openPage(false);
  await seaCheck(page);
  await page.close();
}

if (which !== 'vr' && which !== 'sea') {
  const page = await openPage(false);
  const frames = framesOn(page);
  await desktopSite(page, 'w1-apollo17', 'Apollo 17 landing site', 'Moon', 1.62);

  // leaving: B returns to free flight, which flies again
  await page.keyboard.press('KeyB');
  await frames(3);
  let st = await page.evaluate(() => ({ state: window.app.walk.state, hud: getComputedStyle(document.querySelector('.walk-hud')).display }));
  check('w2: B again returns to free flight', st.state === 'off' && st.hud === 'none', JSON.stringify(st));
  const before = await page.evaluate(() => window.app.rig.upos.toVector3().toArray());
  await page.keyboard.down('KeyR');
  await frames(10);
  await page.keyboard.up('KeyR');
  const after = await page.evaluate(() => window.app.rig.upos.toVector3().toArray());
  check('w2: free flight works after walking', Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]) > 1, '');

  await desktopSite(page, 'w3-gale', 'Gale Crater (Curiosity)', 'Mars', 3.73);
  await page.keyboard.press('KeyB');

  // no walking on a gas giant: the reason is shown
  await page.evaluate(() => { const a = window.app; const j = a.findByName('Jupiter'); a.select(j); a.placeNear(j, j.radius * 1.5, 30, 10); });
  await frames(4);
  await page.keyboard.press('KeyB');
  await frames(2);
  st = await page.evaluate(() => ({ state: window.app.walk.state, said: window.app.walk.said }));
  check('w4: no walking on Jupiter, with the reason', st.state === 'off' && /no solid surface/.test(st.said), st.said);

  // the ship: walking takes you out of it
  await page.evaluate(() => window.app.game.setMode('cockpit'));
  await goToSite(page, 'Apollo 17 landing site', 25);
  await page.keyboard.press('KeyB');
  await page.waitForFunction(() => window.app.walk.state === 'walk', null, { timeout: 180000 });
  st = await page.evaluate(() => ({ game: window.app.game.mode, walk: window.app.walk.state }));
  check('w5: walking from the ship steps out of it', st.game === 'off' && st.walk === 'walk', JSON.stringify(st));
  await page.keyboard.press('KeyV');
  await frames(3);
  st = await page.evaluate(() => ({ game: window.app.game.mode, walk: window.app.walk.state }));
  check('w5: V (ship) stops walking and boards the ship', st.game === 'cockpit' && st.walk === 'off', JSON.stringify(st));
  await page.evaluate(() => window.app.game.setMode('off'));

  // a planet of another star: 3 km up, B flies down and walks; gravity from its mass and radius
  await page.evaluate(() => { const a = window.app; const p = a.findByName('Proxima Cen b'); a.select(p); a.placeNear(p, p.radius * 4, 30, 20); });
  await frames(10);
  await page.evaluate(() => {
    const a = window.app;
    const p = a.selection;
    const star = p.system.host.upos.sub(p.upos).normalize();
    const side = star.clone().set(0, 0, 1).cross(star).normalize();
    const el = (25 * Math.PI) / 180;
    const up = star.clone().multiplyScalar(Math.sin(el)).addScaledVector(side, Math.cos(el)).normalize();
    a.rig.setAnchor(p);
    a.rig.upos.copy(p.upos).addVec(up, p.radius + 3000);
    a.rig.lookAt(side.clone().cross(up).normalize(), up);
  });
  await page.waitForFunction(() => window.app.terrain.owner === window.app.selection && window.app.terrain.hScale > 0.99, null, { timeout: 300000 });
  await page.keyboard.press('KeyB');
  await frames(2);
  const desc = await page.evaluate(() => window.app.walk.state);
  await page.waitForFunction(() => window.app.walk.state === 'walk', null, { timeout: 400000 });
  st = await page.evaluate(() => {
    const a = window.app; const p = a.selection; const d = a.walk.debug();
    const r = a.walk.body.pos.length();
    return { ...d, expect: (6.6743e-11 * p.spec.massKg) / (r * r), name: p.name };
  });
  check('w6: from 3 km up, B flies down to the ground of a generated planet and walks', desc === 'descend' && st.state === 'walk' && st.world === st.name && Math.abs(st.eyeH - 1.7) < 0.15, JSON.stringify({ desc, state: st.state, eyeH: st.eyeH }));
  check('w6: its gravity comes from its mass and radius', Math.abs(st.gravity - st.expect) < 1e-6 && st.gravity > 1, `${st.gravity.toFixed(2)} m/s²`);
  await page.keyboard.down('KeyW');
  await sample(page, 12);
  await page.keyboard.up('KeyW');
  await page.screenshot({ timeout: 400000, path: path.join(outDir, 'w6-exoplanet-walking.png') });
  await page.keyboard.press('KeyB');

  await seaCheck(page);
  await page.close();
}

if (which !== 'desktop' && which !== 'sea') {
  const page = await openPage(true);
  const frames = framesOn(page);
  await page.waitForSelector('#vr-button', { state: 'visible', timeout: 10000 });
  await page.click('#vr-button');
  await page.waitForFunction(() => window.app.vr.active && window.app.renderer.presenting, null, { timeout: 30000 });
  await page.waitForFunction(() => window.app.vr.menu.isOpen, null, { timeout: 600000 });
  await page.evaluate(() => window.app.vr.toggleMenu());
  await goToSite(page, 'Apollo 17 landing site', 25);
  // the wrist panel's WALK button
  await page.evaluate(() => {
    const w = window.app.vr.wrist; w.dirty = true; w.update();
    w.regions.find((r) => r.id === 'w:walk').onClick();
  });
  await page.waitForFunction(() => window.app.walk.state === 'walk', null, { timeout: 180000 });
  await frames(4);
  let st = await page.evaluate(() => window.app.walk.debug());
  check('v1: VR wrist WALK button lands and walks on the Moon', st.state === 'walk' && st.world === 'Moon', '');
  // eye height above the ground = the dolly's height + the headset's own height above the floor.
  // A headset reporting no floor height (the emulator, a seated 3-DoF device) is lifted to a
  // standing eye; one with floor-level tracking stands the dolly on the ground and keeps its height.
  const eyeTotal = () => page.evaluate(() => {
    const a = window.app;
    const cam = a.renderer.camera;
    return { dolly: a.walk.debug().eyeH, headY: cam.position.y };
  });
  let e = await eyeTotal();
  check('v1: eye is 1.7 m above the ground (headset height 0: lifted to standing)', Math.abs(e.dolly + e.headY - 1.7) < 0.1, JSON.stringify(e));
  // the emulator's reference space puts the floor at the headset's own default height, so raise
  // the device to make it report a real height above the floor
  const y0 = await page.evaluate(() => window.__xrDevice.position.y);
  await page.evaluate((y) => { window.__xrDevice.position.y = y + 1.62; }, y0);
  await frames(4);
  e = await eyeTotal();
  check('v1: a headset with floor tracking stands the dolly on the ground and keeps its own height', Math.abs(e.dolly) < 0.1 && Math.abs(e.headY - 1.62) < 0.1, JSON.stringify(e));
  await page.evaluate((y) => { window.__xrDevice.position.y = y; }, y0);
  await frames(3);
  await page.screenshot({ timeout: 400000, path: path.join(outDir, 'v1-vr-standing.png') });

  // left stick forward: walks where the head looks; vignette comes on
  const p0 = st.pos;
  await page.evaluate(() => window.__xrDevice.controllers.left.updateAxes('thumbstick', 0, -1));
  const walk = await sample(page, 30);
  const vig = await page.evaluate(() => window.app.vr.vig.tunnel.value);
  await page.evaluate(() => window.__xrDevice.controllers.left.updateAxes('thumbstick', 0, 0));
  st = walk[walk.length - 1];
  const moved = Math.hypot(st.pos[0] - p0[0], st.pos[1] - p0[1], st.pos[2] - p0[2]);
  check('v2: left stick walks', moved > 1 && walk.every((s) => s.finite), `moved ${moved.toFixed(2)} m`);
  check('v2: eye height stays 1.7 ± 0.1 m while walking', walk.filter((s) => s.onGround).every((s) => Math.abs(s.eyeH - 1.7) < 0.1), JSON.stringify(stats(walk.map((s) => s.eyeH))));
  check('v2: comfort vignette while moving', vig > 0.1, vig.toFixed(2));
  await page.screenshot({ timeout: 400000, path: path.join(outDir, 'v2-vr-walking.png') });

  // snap turn (right stick)
  const q0 = await page.evaluate(() => window.app.rig.quat.toArray());
  await page.evaluate(() => window.__xrDevice.controllers.right.updateAxes('thumbstick', 1, 0));
  await frames(4);
  await page.evaluate(() => window.__xrDevice.controllers.right.updateAxes('thumbstick', 0, 0));
  await frames(3);
  const q1 = await page.evaluate(() => window.app.rig.quat.toArray());
  const dot = Math.abs(q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3]);
  const ang = (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
  st = await page.evaluate(() => window.app.walk.debug());
  check('v3: right stick snap-turns 30° and stays upright', Math.abs(ang - 30) < 2 && Math.abs(st.roll) < 1e-3, `${ang.toFixed(1)}°`);

  // A jumps
  await page.waitForFunction(() => window.app.walk.body.onGround && window.app.walk.body.groundSpeed < 0.1, null, { timeout: 600000 });
  await page.evaluate(() => window.__xrDevice.controllers.right.updateButtonValue('a-button', 1));
  await frames(2);
  await page.evaluate(() => window.__xrDevice.controllers.right.updateButtonValue('a-button', 0));
  const jump = [];
  for (let i = 0; i < 40 && !(jump.length > 3 && jump[jump.length - 1].onGround); i++) jump.push(...await sample(page, 5));
  const apex = Math.max(...jump.map((s) => s.apex));
  check('v4: A jumps (1.9 m on the Moon) and lands', apex > 1.7 && apex < 2.1 && jump[jump.length - 1].onGround, `apex ${apex.toFixed(2)} m`);
  const sel = await page.evaluate(() => window.app.vr.travelling);
  check('v4: A does not fly away while walking', !sel, '');

  // the menu still opens (Y) and its Walk button leaves walking
  await page.evaluate(() => window.__xrDevice.controllers.left.updateButtonValue('y-button', 1));
  await frames(3);
  await page.evaluate(() => window.__xrDevice.controllers.left.updateButtonValue('y-button', 0));
  await frames(3);
  st = await page.evaluate(() => ({ menu: window.app.vr.menu.isOpen }));
  check('v5: Y opens the menu while walking', st.menu, '');
  await page.screenshot({ timeout: 400000, path: path.join(outDir, 'v5-vr-menu-walking.png') });
  await page.evaluate(() => { const p = window.app.vr.menu.panel; p.dirty = true; p.update(); p.regions.find((r) => r.id === 'walk').onClick(); });
  await frames(3);
  st = await page.evaluate(() => window.app.walk.state);
  check('v5: menu Fly button returns to free flight', st === 'off', st);

  // Places tab with "Walk there": choosing Apollo 11 travels there, lands and walks
  await page.evaluate(() => {
    const a = window.app, m = a.vr.menu, p = m.panel;
    if (!m.isOpen) a.vr.toggleMenu();
    const click = (id) => { p.dirty = true; p.update(); const r = p.regions.find((x) => x.id === id); if (!r) throw new Error(`no region ${id}`); r.onClick(); };
    click('tab:places');
    click('places:Moon');
    click('places:walk');
    click('go:place:Apollo 11 landing site');
  });
  // the headset's travel ends straight above the site (the blink hides the move), then down
  await page.waitForFunction(() => window.app.walk.state === 'descend', null, { timeout: 900000 });
  const top = await page.evaluate(() => {
    const a = window.app, lm = a.landmarks.find((l) => l.name === 'Apollo 11 landing site');
    const up = a.rig.upos.sub(lm.world.upos).normalize();
    return { fromSite: up.angleTo(lm.up()) * lm.world.radius, height: a.rig.upos.sub(lm.world.upos).length() - lm.world.radius };
  });
  check('v6: the travel arrives straight above the site', top.fromSite < 200, JSON.stringify(top));
  await page.waitForFunction(() => window.app.walk.state === 'walk', null, { timeout: 900000 });
  st = await page.evaluate(() => {
    const a = window.app, w = a.walk, d = w.debug();
    const lm = a.landmarks.find((l) => l.name === 'Apollo 11 landing site');
    // along the ground from the site (the place's elevation in the list is only approximate)
    const up = a.rig.upos.sub(lm.world.upos).normalize();
    return { world: d.world, eyeH: d.eyeH, fromSite: up.angleTo(lm.up()) * lm.world.radius };
  });
  check('v6: Places → Walk there → Apollo 11 travels there, lands at the site and walks', st.world === 'Moon' && st.fromSite < 50 && Math.abs(st.eyeH - 1.7) < 0.15, JSON.stringify(st));
  await page.screenshot({ timeout: 400000, path: path.join(outDir, 'v6-vr-apollo11.png') });
  await page.close();
}

console.log(errors.length ? `console errors:\n${errors.slice(0, 10).join('\n')}` : 'no console errors');
check('no console errors', errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
