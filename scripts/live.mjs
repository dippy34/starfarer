// Live physics and the powers (src/app/LivePhysics.ts, src/app/Powers.ts, src/sim/NBody.ts), on a
// phone with fingers and at a desk with a mouse, in headless Chromium. Every power is used through
// the interface: the buttons on a world's card, the mass slider, the Time sheet, the search.
//   - a world's card offers its powers where they are seen at once; nothing is live until one is used
//   - Jupiter made about twice as heavy with the slider: the orbits answer while the finger is
//     still down, and its moons go round in the time Kepler's law gives for the new mass
//   - a moon that then falls into Jupiter is made one with it, and that is told; the selection
//     and the camera go to Jupiter
//   - what the simulation leaves out is two taps away; time runs backwards too
//   - "Back to reality" puts every body exactly where the ephemeris has it, at the moment the first change was made
//   - the Sun taken away: a month later every planet has gone straight on at its orbital speed,
//     the Earth's day side is dark, and its name is still on the sky
//   - a thousand years a second holds a steady frame
//   - the Moon dragged with a finger to twice its distance: time waits while it is held, it goes
//     where the finger goes in the plane of its orbit, and left on a circle there its month is
//     the one Kepler's law gives
//   - a second Jupiter made for the Sun: on the circle promised, between the Sun and the eye, a
//     body like any other (found by name, listed, with a mass to change), and a quarter of its
//     year later a quarter of the way round; a second sun, which shines and lights what is nearer
//     it; taken away again, and nothing of either left after "Back to reality"
//   - a change watched (the first block; the others leave "Show me what happens" off in More, its default, as they
//     time the physics by the clock): let go of the mass slider, time is as it was and the chip offers Watch; Watch
//     runs time at the pace of what follows, until Stop (thirty seconds on it is still on), and the camera
//     eases out until the worlds it matters to fit in what the interface leaves clear, upright and sideways; Stop
//     puts the rate of time back; with the switch on, a change starts its watch by itself; Replay; a finger on the view takes the camera back
//     - Undo, a change at a time, the date with it; "Back to reality" returns to the moment the first change was made
//     and is itself undone by Undo for a moment; the Time sheet's buttons do not move when live physics comes on
//   - the Moon thrown: the slingshot's marks, the orbit line at the speed of escape a parabola drawn from it, the path the
//     simulation run ahead takes and what ends it on the card; the Earth aimed out of the Solar System: a hyperbola
//   - Mars thrown at the Earth: time slows to show the last of the fall, the camera frames the two, a flash where they
//     meet, a card with what the hit was; Undo brings Mars back
//   - another star's planets (src/universe/PlanetarySim.ts), at TRAPPIST-1 e: its card offers Mass, Size, Move and Remove;
//     Mass makes it twice as heavy and live physics comes on round TRAPPIST-1 without moving it off its orbit; Undo gives
//     back its real mass, exactly on its orbit; a finger moves it a third further from its star; time runs on, and Back
//     to reality puts it on its orbit again, at the moment the first change was made
// Usage: node scripts/live.mjs [baseUrl] [outDir]   (LIVE_ONLY=watch,sun: those blocks alone; see `want`; LIVE_KINDS=desk: at a desk only)
import { atRest, collectErrors, launchBrowser, openCard } from './lib/browser.mjs';
import { fingers, phoneContext } from './lib/touch.mjs';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'screenshots';
fs.mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const errors = [];
const START = '2026-10-01T20:00:00Z';

const frames = (page, n) => page.evaluate((n) => new Promise((done) => { const f0 = window.app.frameCount; const t = setInterval(() => { if (window.app.frameCount >= f0 + n) { clearInterval(t); done(); } }, 30); }), n);
// (what is on the selection's card under its bar is a tap on the bar away: openCard)
const press = async (page, sel) => { if (/\.card \[data-(power|act="(move|remove|share|centre)")/.test(sel)) await openCard(page); const b = page.locator(sel).first(); await b.scrollIntoViewIfNeeded(); const force = (await b.getAttribute('aria-disabled')) === 'true'; await b.tap({ force }).catch(() => b.click({ force })); };
const text = (page, sel) => page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', sel);
const shown = (page, sel) => page.evaluate((sel) => { const el = document.querySelector(sel); return !!el && !el.hidden && !el.closest('[hidden]') && el.getBoundingClientRect().height > 0; }, sel);
const toast = (page) => text(page, '#hud .hud-toast');

async function open(kind, query, paused = true) {
  const ctx = kind === 'phone' ? await phoneContext(browser) : await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  collectErrors(page, errors);
  await page.goto(`${base}?menu=0&time=${START}&paused=${paused ? 1 : 0}&${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.app && window.app.frameCount > 30 && !document.getElementById('boot'), null, { timeout: 600000 });
  return { ctx, page, touch: kind === 'phone' ? await fingers(page) : null };
}

/** Find a place by name and choose it (it is selected, and the camera sets off for it). */
async function find(page, name, detail = null) {
  if (!(await shown(page, '#hud .sheet.explore.on'))) await press(page, '#hud .hud-tabs [data-tab="search"]');
  await page.locator('#hud .searchbox input').fill(name);
  // (a moon and an asteroid may share a name: `detail`, what the row says under the name, tells them apart; the first listed
  // is not always the moon: at a desk the search has given the asteroid Io for Jupiter's moon)
  let rows = page.locator('#hud .explore .list .row').filter({ has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) });
  if (detail) rows = rows.filter({ has: page.locator('small', { hasText: detail }) });
  const row = rows.first();
  await row.waitFor({ timeout: 20000 });
  await row.tap().catch(() => row.click());
  // (until its card is up: the interface takes a new selection in a tenth of a second later)
  await page.waitForFunction((n) => window.app.selection?.name === n && document.querySelector('#hud').dataset.sheet === 'card' && document.querySelector('#hud .card h2').textContent === n, name, { timeout: 20000 });
}

/** Ask for a rate of time with the Time sheet's buttons: `label` is what the clock chip then shows ("1 h/s"). */
async function rate(page, label) {
  if (!(await shown(page, '#hud .sheet.time.on'))) await press(page, '#hud .hud-tabs [data-tab="time"]');
  for (let i = 0; i < 16 && (await text(page, '#hud .chip.clock small')) !== label; i++) {
    await press(page, '#hud .transport [data-act="faster"]');
    await frames(page, 2);
  }
  const got = await text(page, '#hud .chip.clock small');
  await press(page, '#hud .sheet.time [data-close]');
  return got;
}

/** Time is stopped (the big button of the Time sheet). */
async function pause(page) {
  if (await page.evaluate(() => window.app.clock.paused)) return;
  if (!(await shown(page, '#hud .sheet.time.on'))) await press(page, '#hud .hud-tabs [data-tab="time"]');
  await press(page, '#hud .transport [data-act="pause"]');
  await press(page, '#hud .sheet.time [data-close]');
  await frames(page, 2);
}

/** Where on the slider's track a value is (the knob is 30 px wide and stays inside the track). */
async function sliderPoint(page, value) {
  const box = await page.locator('#hud .card [data-panel="mass"] .slider:not(.size-slider)').boundingBox();
  return { x: box.x + 15 + ((value + 3) / 6) * (box.width - 30), y: box.y + box.height / 2 };
}

/** The state of two bodies' orbit, and of the powers, as the app has them. */
const about = (page, moon, planet) => page.evaluate(([moon, planet]) => {
  const a = window.app, m = a.findByName(moon), p = a.findByName(planet);
  const o = a.physics.orbit(m);
  return { on: a.physics.on, factor: p.gm / a.physics.realGm(p), period: o?.period ?? 0, e: o?.e ?? 0, valid: m.valid, parent: m.parent?.name ?? null, jd: a.clock.jdTdb };
}, [moon, planet]);

/**
 * How long each of `moons` takes to go once round `planet`, timed on the app's own clock while it
 * runs: the angle each turns through about the planet is added up frame by frame until it is a
 * full turn (days; null for one that did not get round in `seconds`).
 */
const timeOrbits = (page, moons, planet, seconds) => page.evaluate(([moons, planet, seconds]) => new Promise((done) => {
  const a = window.app, p = a.findByName(planet);
  const state = moons.map((n) => ({ body: a.findByName(n), turned: 0, last: null, from: 0, period: null }));
  const t0 = performance.now();
  let frame = a.frameCount, lastJd = a.clock.jdTdb;
  const timer = setInterval(() => {
    if (a.frameCount === frame) return;
    frame = a.frameCount;
    const jd = a.clock.jdTdb;
    for (const s of state) {
      if (s.period !== null || !s.body.valid) continue;
      const d = s.body.pos.clone().sub(p.pos).normalize();
      if (s.last) {
        const step = Math.acos(Math.min(1, s.last.dot(d)));
        // (the moment the turn is complete, within the frame)
        if (s.turned + step >= 2 * Math.PI) s.period = lastJd + ((2 * Math.PI - s.turned) / step) * (jd - lastJd) - s.from;
        s.turned += step;
      } else s.from = jd;
      s.last = d;
    }
    lastJd = jd;
    if (state.every((s) => s.period !== null || !s.body.valid) || performance.now() - t0 > seconds * 1000) {
      clearInterval(timer);
      done(state.map((s) => s.period));
    }
  }, 20);
}), [moons, planet, seconds]);

/** How bright a world's disc is drawn (the display's 0 to 255: its mean, its median, and what a twentieth of it exceeds), over the middle of the disc. */
const discLight = (page, name) => page.evaluate((name) => {
  const a = window.app, b = a.findByName(name);
  a.frame();
  const gl = a.renderer.gl.domElement, v = a.bodies.views.get(b), at = a.project(v.rel);
  const k = gl.width / gl.clientWidth, r = Math.floor(0.7 * (v.pixelRadius / a.view.pixelRatio) * k), cx = Math.round(at.x * k), cy = Math.round(at.y * k);
  const c = Object.assign(document.createElement('canvas'), { width: 2 * r, height: 2 * r }), g = c.getContext('2d');
  g.drawImage(gl, cx - r, cy - r, 2 * r, 2 * r, 0, 0, 2 * r, 2 * r);
  const d = g.getImageData(0, 0, 2 * r, 2 * r).data, lum = [];
  for (let y = 0; y < 2 * r; y++) for (let x = 0; x < 2 * r; x++) {
    if ((x - r) ** 2 + (y - r) ** 2 > r * r) continue;
    const i = 4 * (y * 2 * r + x);
    lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
  }
  lum.sort((p, q) => p - q);
  return { mean: lum.reduce((s, x) => s + x, 0) / lum.length, median: lum[lum.length >> 1], top: lum[Math.floor(0.95 * lum.length)], px: lum.length };
}, name);

/**
 * A world's orbit line as drawn (src/render/Orbits.ts): whether it is, where its first point is on the screen against
 * where the world is, how far out on the screen it reaches, and its shape against what it goes round, `about`: the
 * stretch e of the conic its points lie on (their distance r from `about` and angle ν from where the world is, at the
 * nearest point of a throw square to the line from it: r (1 + e cos ν) = r₀ (1 + e), solved for e at each point), the
 * most any point is off it, and the colour on the screen at the first point of it 30 px clear of the line `aim` (the
 * slingshot's arrow, a unit vector on the screen from the world), and of the world.
 */
const drawnPath = (page, name, about, aim) => page.evaluate(([name, about, aim]) => {
  const a = window.app, b = a.findByName(name), c = a.findByName(about), V = b.pos.constructor, line = a.orbits.objs.get(b)?.line;
  if (!line?.visible) return { drawn: false };
  a.frame();
  const pos = line.geometry.attributes.position.array, n = line.geometry.drawRange.count;
  const at = b.upos.sub(a.rig.upos, new V()), focus = c.upos.sub(a.rig.upos, new V()), dot = a.project(at);
  const pts = Array.from({ length: n }, (_, k) => at.clone().add(new V(pos[3 * k], pos[3 * k + 1], pos[3 * k + 2])));
  const screen = pts.map((p) => a.project(p));
  const r0 = pts[0].clone().sub(focus), d0 = r0.length(), es = [];
  for (const p of pts.slice(1)) {
    const r = p.clone().sub(focus), d = r.length(), cos = r.dot(r0) / (d * d0);
    if (Math.abs(1 - cos) > 1e-3) es.push((d - d0) / (d0 - d * cos));
  }
  const e = es.reduce((s, x) => s + x, 0) / es.length;
  // (the colour of the line, read off the canvas where it is clear of the arrow, its marks and their words: its yellowest
  // pixel there, the line being thin)
  const gl = a.renderer.gl.domElement, k = gl.width / gl.clientWidth, cv = Object.assign(document.createElement('canvas'), { width: 9, height: 9 }), g = cv.getContext('2d');
  const clear = (p) => Math.abs((p.x - dot.x) * aim.uy - (p.y - dot.y) * aim.ux) >= 30 && Math.hypot(p.x - dot.x, p.y - dot.y) >= 30;
  const far = screen.find((p) => p && clear(p) && p.x > 10 && p.x < innerWidth - 10 && p.y > 10 && p.y < innerHeight - 10);
  let lit = null;
  if (far) {
    g.drawImage(gl, Math.round(far.x * k) - 4, Math.round(far.y * k) - 4, 9, 9, 0, 0, 9, 9);
    const d = g.getImageData(0, 0, 9, 9).data, yellow = (r, gr, b) => (r + gr) / 2 - b;
    let best = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) if (yellow(d[i], d[i + 1], d[i + 2]) > yellow(...best)) best = [d[i], d[i + 1], d[i + 2]];
    lit = best;
  }
  return {
    drawn: true, n, first: Math.hypot(screen[0].x - dot.x, screen[0].y - dot.y), reach: Math.max(...screen.filter(Boolean).map((p) => Math.hypot(p.x - dot.x, p.y - dot.y))),
    e, off: Math.max(...es.map((x) => Math.abs(x - e))), far, lit,
  };
}, [name, about, aim]);

/** How bright the screen is drawn round a world (the display's 0 to 255, the mean within `r` CSS px of it), a frame drawn first. */
const glowAt = (page, name, r) => page.evaluate(([name, r]) => {
  const a = window.app, b = a.findByName(name), V = b.pos.constructor;
  a.frame();
  const gl = a.renderer.gl.domElement, k = gl.width / gl.clientWidth, at = a.project(b.upos.sub(a.rig.upos, new V()));
  if (!at) return null;
  const R = Math.round(r * k), c = Object.assign(document.createElement('canvas'), { width: 2 * R, height: 2 * R }), g = c.getContext('2d');
  g.drawImage(gl, Math.round(at.x * k) - R, Math.round(at.y * k) - R, 2 * R, 2 * R, 0, 0, 2 * R, 2 * R);
  const d = g.getImageData(0, 0, 2 * R, 2 * R).data;
  let sum = 0, n = 0;
  for (let y = 0; y < 2 * R; y++) for (let x = 0; x < 2 * R; x++) {
    if ((x - R) ** 2 + (y - R) ** 2 > R * R) continue;
    const i = 4 * (y * 2 * R + x);
    sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    n++;
  }
  return { mean: sum / n, at };
}, [name, r]);

/** The watch of a change as the app has it, and as its chip shows it. */
const watching = (page) => page.evaluate(() => {
  // (written to report on a build without the watch too, rather than stop: what the checks were first run against)
  const a = window.app, chip = document.querySelector('#hud .hud-watch'), seen = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  return {
    state: a.watch?.state ?? 'none', rate: a.watch?.rate ?? 0, clock: a.clock.rate, paused: a.clock.paused, jd: a.clock.jdTdb, on: a.physics.on,
    chip: seen(chip), text: chip?.querySelector('.watch-text').textContent ?? '', start: seen(chip?.querySelector('.watch-start')), stop: seen(chip?.querySelector('.watch-stop')), glide: !!a.glide, replay: seen(chip?.querySelector('.watch-replay')),
  };
});

/** The change's watch is asked for: Watch is tapped on the chip that offers it, and the watch is waited for. */
async function watchIt(page) {
  await press(page, '#hud .hud-watch .watch-start');
  await until(page, () => window.app.watch.watching, null, 60);
}

/** Where a body is from the camera (m), where it is on the screen, and the part of the view the interface leaves clear. */
const framing = (page, name, centre) => page.evaluate(([name, centre]) => {
  const a = window.app, b = a.findByName(name), c = a.findByName(centre), V = b.pos.constructor;
  return { d: c.upos.sub(a.rig.upos, new V()).length(), at: a.project(b.upos.sub(a.rig.upos, new V())), centreAt: a.project(c.upos.sub(a.rig.upos, new V())), free: a.hud.freeArea?.() ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } };
}, [name, centre]);

/** The mass slider of the selected world in sight (its panel opened if it is folded). */
async function massPanel(page) {
  if (!(await shown(page, '#hud .card [data-panel="mass"] .slider:not(.size-slider)'))) await press(page, '#hud .card [data-power="mass"]');
  await frames(page, 2);
}

/** The knob of the mass slider dragged from where it is to `value` (the logarithm of the factor), and let go. */
async function slideMass(page, touch, value) {
  await massPanel(page);
  const now = Number(await page.locator('#hud .card [data-panel="mass"] .slider:not(.size-slider)').inputValue());
  const from = await sliderPoint(page, now), to = await sliderPoint(page, value);
  if (touch) {
    await touch.press(from);
    for (let i = 1; i <= 6; i++) await touch.slide({ x: from.x + ((to.x - from.x) * i) / 6, y: from.y });
    await touch.lift();
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
  }
  await frames(page, 2);
}

/** Wait until `test` holds in the page (checked a frame at a time), or `seconds` have gone. */
const until = (page, test, arg, seconds = 120) => page.waitForFunction(test, arg, { timeout: seconds * 1000, polling: 100 }).then(() => true, () => false);

/** What the mark of live physics says, and whether its words are whole (not cut off with an ellipsis). */
/**
 * Every message the toast shows from now on, in order (read with `heard`): one can follow another before a frame
 * is over, as the missions' "Discovered: the Sun" does when the camera comes to ride with the Sun.
 */
const listen = (page) => page.evaluate(() => {
  window.toastsHeard = [];
  if (window.toastWatch) return;
  const t = document.querySelector('#hud .hud-toast');
  window.toastWatch = new MutationObserver(() => window.toastsHeard.push(t.textContent));
  window.toastWatch.observe(t, { childList: true, characterData: true, subtree: true });
});
const heard = (page) => page.evaluate(() => window.toastsHeard ?? []);

/** Is a point (CSS px) inside a part of the view? */
const within = (p, r) => !!p && p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;

const markWords = (page) => page.evaluate(() => {
  const b = document.querySelector('#hud .live-what b'), s = document.querySelector('#hud .live-what small');
  return { b: b.textContent, small: s.textContent, whole: b.scrollWidth <= b.clientWidth + 1 && s.scrollWidth <= s.clientWidth + 1 };
});

/**
 * The mouse at a desk, its events given their times as the fingers' are (16 ms apart): a quick drag is
 * as quick whatever this machine's speed. Same calls as the fingers' press, slide, lift and drag.
 */
async function mouseHand(page) {
  const cdp = await page.context().newCDPSession(page);
  let clock = Date.now() / 1000, at = { x: 0, y: 0 };
  const send = (type, p, buttons) => { clock += 0.016; at = p; return cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: 1, timestamp: clock }); };
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const hand = {
    async press(p) { await send('mouseMoved', p, 0); await send('mousePressed', p, 1); await frames(page, 1); },
    async slide(p) { await send('mouseMoved', p, 1); await frames(page, 1); },
    async lift(rest = 0.3) { clock += rest; await send('mouseReleased', at, 0); await frames(page, 1); },
    async drag(a, b, { steps = 12, rest = 0.3 } = {}) {
      await hand.press(a);
      for (let i = 1; i <= steps; i++) await hand.slide(lerp(a, b, i / steps));
      await hand.lift(rest);
    },
  };
  return hand;
}

/** The finger, or the mouse with its events timed: press, slide, lift (after `rest` s still; 0: a flick) and drag. */
async function handOf(page, touch) {
  if (!touch) return mouseHand(page);
  return { press: (p) => touch.press(p), slide: (p) => touch.slide(p), lift: async (rest = 0.3) => { touch.wait(rest - 0.3); await touch.lift(); }, drag: (a, b, o) => touch.drag(a, b, o) };
}

/**
 * Changes not watched by themselves (More: "Show me what happens", off, as it is to begin with): for the blocks that
 * time the physics of a power by the clock, where a watch's pace would run past what they measure.
 */
async function quiet(page) {
  await press(page, '#hud .hud-tabs [data-tab="more"]');
  if ((await page.locator('#hud .switch[data-act="show-me"]').getAttribute('aria-checked')) === 'true') await press(page, '#hud .switch[data-act="show-me"]');
  await press(page, '#hud .sheet.more [data-close]');
  await frames(page, 2);
}

/** some blocks only, by name (LIVE_ONLY=watch,jupiter: watch, jupiter, sun, moon, made, throw, open, warm, size, hit, side, place, exo); the rest are left out */
const only = process.env.LIVE_ONLY ?? '';
const want = (name) => !only || only.split(',').includes(name);
/** on a phone and at a desk, or one of them (LIVE_KINDS=desk) */
const kinds = (process.env.LIVE_KINDS ?? 'phone,desk').split(',');

for (const kind of kinds) {
  const on = (name) => `${kind}: ${name}`;

  // ------------------------------------------------------------------ watching a change, Replay, Undo, and the way back
  if (want('watch')) {
    const { ctx, page, touch } = await open(kind, 'target=Jupiter&dist=40');
    const real = await page.evaluate(() => { const a = window.app, io = a.findByName('Io'); return { jd: a.clock.jdTdb, io: io.pos.toArray(), paused: a.clock.paused, rate: a.clock.rate }; });
    // the Time sheet's buttons where they are before anything is changed (once its opening slide has
    // ended: two frames after the tap it may be on its way, 5 px down once on a runner)
    await press(page, '#hud .hud-tabs [data-tab="time"]');
    await frames(page, 2);
    await atRest(page, '#hud .sheet.time');
    const faster = await page.evaluate(() => { const r = document.querySelector('#hud .transport [data-act="faster"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    await press(page, '#hud .sheet.time [data-close]');
    const before = await framing(page, 'Callisto', 'Jupiter');

    // Jupiter made twenty times heavier, and let go: time is as it was (stopped), and the chip offers the watch
    await slideMass(page, touch, Math.log10(20));
    await frames(page, 3);
    const offer = await watching(page);
    check(on('after a change time is as it was before (paused stays paused, the rate is kept), nothing is watched by itself, and the chip offers Watch beside Close'),
      offer.on && offer.state === 'offered' && offer.paused === real.paused && offer.clock === real.rate && !offer.glide && offer.chip && offer.start && !offer.stop && offer.text === 'See what it does',
      `${offer.state}, "${offer.text}", paused ${offer.paused} (before: ${real.paused}), rate ${offer.clock} (before: ${real.rate}), Watch ${offer.start}`);
    if (kind === 'phone') await page.screenshot({ path: path.join(outDir, `live-${kind}-watch-offered.png`) });
    // Watch: time at the pace of what follows, and a chip says so, with Stop
    await watchIt(page);
    const w0 = await watching(page);
    const factor = await page.evaluate(() => window.app.findByName('Jupiter').gm / window.app.physics.realGm(window.app.findByName('Jupiter')));
    check(on('tap Watch, time runs at the pace of what follows, and a chip says so, with Stop'),
      factor > 15 && factor < 27 && w0.state === 'watching' && w0.chip && w0.stop && !w0.paused && w0.clock === w0.rate && /^Watching: [\d.]+ (minutes|hours) a second$/.test(w0.text) && w0.rate > 60 && w0.rate < 3600 * 3,
      `${factor.toFixed(1)} times; "${w0.text}", the clock at ${(w0.clock / 60).toFixed(1)} min/s, paused before: ${real.paused}`);
    // (the pace is the chip's to tell: the mark at the top says since when, short enough for a phone, whether or not the
    // stepping keeps up)
    const words = await markWords(page);
    check(on('the mark at the top says since when live physics is on, in words a phone has room for; the pace is the chip\'s to tell'),
      words.b === 'Live physics' && words.small === 'since 1 Oct 2026' && words.whole, `"${words.b}" / "${words.small}", whole: ${words.whole}`);
    // the camera eases out until Jupiter's four great moons fit in what the interface leaves clear
    await until(page, () => !window.app.glide, null, 60);
    const fit = await framing(page, 'Callisto', 'Jupiter');
    const moons = await Promise.all(['Io', 'Europa', 'Ganymede', 'Callisto'].map((n) => framing(page, n, 'Jupiter')));
    const inside = (p, r) => !!p && p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;
    const mid = { x: (fit.free.left + fit.free.right) / 2, y: (fit.free.top + fit.free.bottom) / 2 };
    check(on('the camera eases out to frame the moons the change matters to, Jupiter in the middle of the part of the view the interface leaves clear'),
      fit.d > 1.5 * before.d && moons.every((m) => inside(m.at, fit.free)) && Math.hypot(fit.centreAt.x - mid.x, fit.centreAt.y - mid.y) < 8 && inside(fit.centreAt, fit.free),
      `from ${(before.d / 1e9).toFixed(2)} to ${(fit.d / 1e9).toFixed(2)} million km; Jupiter ${Math.hypot(fit.centreAt.x - mid.x, fit.centreAt.y - mid.y).toFixed(1)} px from the middle of the clear part (${fit.free.left.toFixed(0)}-${fit.free.right.toFixed(0)} x ${fit.free.top.toFixed(0)}-${fit.free.bottom.toFixed(0)}); the moons ${moons.map((m) => `(${m.at?.x.toFixed(0)}, ${m.at?.y.toFixed(0)})`).join(' ')}`);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-watch.png`) });

    // it has no end of its own: thirty seconds later it is still watching, at its pace, until Stop
    const t0 = await watching(page);
    await page.waitForTimeout(30000);
    const t1 = await watching(page);
    check(on('thirty seconds later the watch is still on, time still at its pace and the chip still saying "Watching"'),
      t1.state === 'watching' && t1.stop && !t1.replay && /^(Watching|Slowed): /.test(t1.text) && t1.jd > t0.jd && !t1.paused && (t1.clock === t1.rate || /^Slowed/.test(t1.text)),
      `${t1.state}, "${t1.text}", ${((t1.jd - t0.jd) * 24).toFixed(1)} h on in thirty seconds`);

    // Stop: the rate of time comes back as it was, and Replay is offered
    await press(page, '#hud .hud-watch .watch-stop');
    await frames(page, 2);
    const end = await watching(page);
    check(on('Stop ends the watch: time is as it was before (stopped), and the chip offers Replay'),
      end.state === 'ended' && end.paused === real.paused && end.clock === real.rate && end.chip && end.replay && !end.stop && /^Watched: [\d.]+ (hours|days|minutes)$/.test(end.text),
      `"${end.text}", paused ${end.paused}, rate ${end.clock}`);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-watched.png`) });
    // Replay: back to just after the change, watched again
    const after = await page.evaluate(() => window.app.replayFrom?.cp.jd ?? null);
    await press(page, '#hud .hud-watch .watch-replay');
    const again = await watching(page);
    check(on('Replay goes back to the moment just after the change and watches it again'),
      after !== null && again.state === 'watching' && again.jd - after < (again.rate * 5) / 86400 && again.jd >= after && again.chip && again.stop, `${((again.jd - after) * 24).toFixed(2)} h after the change, "${again.text}"`);
    // a finger on the view takes the camera back at once (the camera was easing to the frame again), and time keeps the watch's pace
    const easing = await page.evaluate(() => !!window.app.glide);
    if (touch) await touch.press({ x: mid.x - 60, y: mid.y });
    else { await page.mouse.move(mid.x - 60, mid.y); await page.mouse.down({ button: 'right' }); }
    const held = await page.evaluate(() => ({ glide: !!window.app.glide }));
    if (touch) { await touch.slide({ x: mid.x - 20, y: mid.y + 5 }); await touch.lift(); } else { await page.mouse.move(mid.x - 20, mid.y + 5, { steps: 3 }); await page.mouse.up({ button: 'right' }); }
    const kept = await watching(page);
    check(on('a finger on the view takes the camera back at once, and time keeps the watch\'s pace'), easing && !held.glide && kept.state === 'watching' && kept.clock === kept.rate && !kept.paused,
      `easing ${easing}, then ${held.glide ? 'still easing' : 'in the hand'}; ${kept.state} at ${(kept.clock / 60).toFixed(1)} min/s`);
    await press(page, '#hud .hud-watch .watch-stop');
    await frames(page, 1);

    // Undo, at the top, beside the way back: the first change undone is the real Solar System again, the date included
    const lay = await page.evaluate(() => [...document.querySelectorAll('#hud .live-mark button')].filter((b) => !b.hidden).map((b) => { const r = b.getBoundingClientRect(); return { label: b.textContent.trim(), h: r.height, in: r.left >= 0 && r.right <= innerWidth }; }));
    check(on('the mark of live physics has Undo beside Back to reality, each a thumb high and in sight'), lay.length === 3 && lay[1].label === 'Undo' && lay[2].label === 'Back to reality' && lay.every((b) => b.h >= 44 && b.in),
      lay.map((b) => `${b.label} ${b.h.toFixed(0)}`).join(', '));
    await press(page, '#hud .live-mark .live-undo');
    await frames(page, 2);
    await massPanel(page);
    const undone = await page.evaluate(() => { const a = window.app, io = a.findByName('Io'), j = a.findByName('Jupiter'); return { on: a.physics.on, factor: j.gm / a.physics.realGm(j), jd: a.clock.jdTdb, paused: a.clock.paused, io: io.pos.toArray(), toast: document.querySelector('#hud .hud-toast').textContent, mark: !document.querySelector('#hud .live-mark').hidden, read: document.querySelector('#hud [data-panel="mass"] .power-read b').textContent }; });
    check(on('Undo: Jupiter has its real mass, its moons are where the ephemeris has them, at the date before the change, and it says what was undone'),
      !undone.on && undone.factor === 1 && undone.jd === real.jd && undone.paused === real.paused && Math.hypot(...undone.io.map((x, k) => x - real.io[k])) < 1 && /^Undone: changing Jupiter's mass\. The real Solar System again$/.test(undone.toast) && !undone.mark && undone.read === '1 Jupiter',
      `"${undone.toast}"; Io ${Math.hypot(...undone.io.map((x, k) => x - real.io[k])).toFixed(3)} m from where it was`);

    // several steps: twenty times, then Callisto taken away; Undo brings Callisto back with Jupiter still heavy, Undo again the real one
    await slideMass(page, touch, Math.log10(20));
    await find(page, 'Callisto');
    await press(page, '#hud .hud-flight [data-act="stop"]').catch(() => undefined);
    await press(page, '#hud .card [data-act="remove"]');
    await frames(page, 2);
    const removed = await page.evaluate(() => window.app.findByName('Callisto').valid);
    await press(page, '#hud .live-mark .live-undo');
    await frames(page, 2);
    const step1 = await page.evaluate(() => { const a = window.app, j = a.findByName('Jupiter'); return { callisto: a.findByName('Callisto').valid, factor: j.gm / a.physics.realGm(j), on: a.physics.on, toast: document.querySelector('#hud .hud-toast').textContent }; });
    await press(page, '#hud .live-mark .live-undo');
    await frames(page, 2);
    const step2 = await page.evaluate(() => { const a = window.app, j = a.findByName('Jupiter'); return { factor: j.gm / a.physics.realGm(j), on: a.physics.on }; });
    check(on('Undo goes back a change at a time: Callisto comes back with Jupiter still heavy, then Jupiter is real again'),
      !removed && step1.callisto && step1.factor > 15 && step1.on && /^Undone: taking away Callisto$/.test(step1.toast) && step2.factor === 1 && !step2.on, `"${step1.toast}"`);

    // Back to reality, by mistake: undone at once; and it returns to the moment the change was made
    await find(page, 'Jupiter');
    await press(page, '#hud .hud-flight [data-act="stop"]').catch(() => undefined);
    await slideMass(page, touch, Math.log10(20));
    await watchIt(page);
    await until(page, () => window.app.clock.jdTdb > window.app.physics.live.jd0 + 0.05, null, 60);
    await press(page, '#hud .hud-watch .watch-stop');
    const changed = await page.evaluate(() => ({ jd: window.app.clock.jdTdb, jd0: window.app.physics.live.jd0 }));
    await press(page, '#hud .live-mark .live-back');
    await frames(page, 2);
    const back = await page.evaluate(() => { const a = window.app; return { on: a.physics.on, jd: a.clock.jdTdb, paused: a.clock.paused, rate: a.clock.rate, mark: !document.querySelector('#hud .live-mark').hidden, what: document.querySelector('#hud .live-what b').textContent, undo: !document.querySelector('#hud .live-mark .live-undo').hidden, way: !document.querySelector('#hud .live-mark .live-back').hidden, toast: document.querySelector('#hud .hud-toast').textContent }; });
    check(on('"Back to reality" returns to the date the change was made and the rate time had then, and offers Undo at the top'),
      !back.on && back.jd === changed.jd0 && back.paused === real.paused && back.rate === real.rate && back.mark && back.what === 'Back to reality' && back.undo && !back.way && /^Back to reality, on 1 October 2026$/.test(back.toast),
      `"${back.toast}"; ${((changed.jd - back.jd) * 24).toFixed(1)} h back; the mark: ${back.what}, Undo ${back.undo}`);
    // (at once: Undo is offered for twenty seconds, and a frame here can take one)
    await press(page, '#hud .live-mark .live-undo');
    await frames(page, 2);
    const restored = await page.evaluate(() => { const a = window.app, j = a.findByName('Jupiter'); return { on: a.physics.on, factor: j.gm / a.physics.realGm(j), jd: a.clock.jdTdb, toast: document.querySelector('#hud .hud-toast').textContent }; });
    check(on('Undo after "Back to reality" brings the changed world back as it was'), restored.on && restored.factor > 15 && restored.jd === changed.jd && /^Undone: Back to reality$/.test(restored.toast), `"${restored.toast}"`);

    // with live physics on, the Time sheet's buttons are where they were, and the way back is well away from them
    await press(page, '#hud .hud-tabs [data-tab="time"]');
    await frames(page, 2);
    await atRest(page, '#hud .sheet.time');
    const sheet = await page.evaluate(() => {
      const box = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom }; };
      return { faster: box('#hud .transport [data-act="faster"]'), back: box('#hud .live-ways [data-act="reality"]'), undo: box('#hud .live-ways [data-act="undo"]'), live: !document.querySelector('#hud .live-sheet').hidden };
    });
    check(on('the Time sheet\'s buttons do not move when live physics is on, and Undo and the way back stand well above them'),
      sheet.live && Math.abs(sheet.faster.x - faster.x) < 0.5 && Math.abs(sheet.faster.y - faster.y) < 0.5 && sheet.back.bottom < sheet.faster.y - 60 && sheet.undo.h >= 44 && sheet.back.h >= 44,
      `Faster at (${faster.x.toFixed(0)}, ${faster.y.toFixed(0)}) then (${sheet.faster.x.toFixed(0)}, ${sheet.faster.y.toFixed(0)}); the way back ends ${(sheet.faster.y - sheet.back.bottom).toFixed(0)} px above it`);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-time-sheet.png`) });
    await press(page, '#hud .sheet.time [data-close]');

    // the phone on its side: the panel stands at the left, and the frame is fitted to the part of the view right of it
    if (touch) {
      await page.setViewportSize({ width: 844, height: 390 });
      await frames(page, 6);
      await press(page, '#hud .live-mark .live-undo');
      await frames(page, 2);
      await find(page, 'Jupiter');
      await press(page, '#hud .hud-flight [data-act="stop"]').catch(() => undefined);
      await slideMass(page, touch, Math.log10(10));
      await watchIt(page);
      await until(page, () => window.app.watch.watching && !window.app.glide, null, 60);
      const side = await Promise.all(['Io', 'Europa', 'Ganymede', 'Callisto'].map((n) => framing(page, n, 'Jupiter')));
      const f = side[0].free, centre = { x: (f.left + f.right) / 2, y: (f.top + f.bottom) / 2 };
      // (and the card is whole beside it, the chip above it clear of the top's mark and of the news)
      const fits = await page.evaluate(() => {
        const card = document.querySelector('#hud .card'), chip = document.querySelector('#hud .hud-watch').getBoundingClientRect(), mark = document.querySelector('#hud .live-mark').getBoundingClientRect();
        return { whole: card.scrollHeight <= card.clientHeight + 1 && card.getBoundingClientRect().bottom <= innerHeight, chipTop: chip.top, markBottom: mark.bottom, words: document.querySelector('#hud .live-what b').scrollWidth <= document.querySelector('#hud .live-what b').clientWidth + 1 };
      });
      check(on('held sideways, the watch frames the moons right of the panel, Jupiter in the middle of what is clear; the card is whole beside it'),
        f.left > 300 && Math.hypot(side[0].centreAt.x - centre.x, side[0].centreAt.y - centre.y) < 8 && side.every((m) => inside(m.at, f)) && fits.whole && fits.chipTop > fits.markBottom + 40 && fits.words,
        `the clear part ${f.left.toFixed(0)}-${f.right.toFixed(0)} x ${f.top.toFixed(0)}-${f.bottom.toFixed(0)}; Jupiter ${Math.hypot(side[0].centreAt.x - centre.x, side[0].centreAt.y - centre.y).toFixed(1)} px from its middle; card whole ${fits.whole}, the chip ${(fits.chipTop - fits.markBottom).toFixed(0)} px below the mark, "Live physics" whole ${fits.words}`);
      await page.screenshot({ path: path.join(outDir, `live-${kind}-watch-sideways.png`) });
      await press(page, '#hud .hud-watch .watch-stop');
      await page.setViewportSize({ width: 390, height: 844 });
      await frames(page, 6);
    }

    // at a desk, Ctrl+Z undoes; and with "Show me what happens" on (it is off to begin with), a change starts its watch by itself
    if (!touch) {
      await page.keyboard.press('Control+z');
      await frames(page, 2);
      check(on('Ctrl+Z undoes the last change'), await page.evaluate(() => !window.app.physics.on && /^Undone: changing Jupiter's mass/.test(document.querySelector('#hud .hud-toast').textContent)));
    }
    await press(page, '#hud .hud-tabs [data-tab="more"]');
    const switchBefore = await page.locator('#hud .switch[data-act="show-me"]').getAttribute('aria-checked');
    await press(page, '#hud .switch[data-act="show-me"]');
    await frames(page, 2);
    const switchAfter = await page.locator('#hud .switch[data-act="show-me"]').getAttribute('aria-checked');
    const toldIt = await toast(page);
    await press(page, '#hud .sheet.more [data-close]');
    await find(page, 'Jupiter');
    await press(page, '#hud .hud-flight [data-act="stop"]').catch(() => undefined);
    await massPanel(page);
    await slideMass(page, touch, Math.log10(5));
    await until(page, () => window.app.watch.watching, null, 60);
    const byItself = await watching(page);
    check(on('"Show me what happens" is off to begin with; with it on in More, a change starts its watch by itself (and the toast says so)'),
      switchBefore === 'false' && switchAfter === 'true' && /watch starts by itself/.test(toldIt) && byItself.on && byItself.state === 'watching' && byItself.chip && byItself.stop && !byItself.paused && byItself.clock === byItself.rate && /^(Watching|Slowed): /.test(byItself.text),
      `switch ${switchBefore} then ${switchAfter}, "${toldIt}"; ${byItself.state}, "${byItself.text}"`);
    await press(page, '#hud .hud-watch .watch-stop');
    await ctx.close();
  }

  // ------------------------------------------------------------------ Jupiter, made heavier
  if (want('jupiter')) {
    const { ctx, page, touch } = await open(kind, 'target=Jupiter&dist=40');
    await quiet(page);
    // (folded, the card is a bar of no more than 80 px with no power on it; one tap on it and they are there)
    const folded = await page.evaluate(() => ({ h: document.querySelector('#hud .card').getBoundingClientRect().height, mass: document.querySelector('#hud .card [data-power="mass"]').getBoundingClientRect().height }));
    await openCard(page);
    const lay = await page.evaluate(() => {
      const box = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { t: r.top, b: r.bottom, h: r.height, w: r.width }; };
      return { mass: box('#hud .card [data-power="mass"]'), remove: box('#hud .card [data-act="remove"]'), tabs: box('#hud .hud-tabs'), facts: document.querySelector('#hud .card .facts').hidden, H: innerHeight, W: innerWidth };
    });
    check(on("Jupiter's card offers its powers one tap away: folded a slim bar; opened, Mass and Remove, a thumb high, in sight"),
      folded.h <= 80 && folded.mass === 0 && lay.mass.h >= 44 && lay.remove.h >= 44 && lay.mass.w >= 60 && lay.mass.b <= lay.H && (kind === 'desk' || lay.mass.b < lay.tabs.t),
      `folded ${folded.h.toFixed(0)} px; buttons ${lay.mass.w.toFixed(0)} x ${lay.mass.h.toFixed(0)} px, down to ${lay.mass.b.toFixed(0)} of ${lay.H}`);
    check(on('nothing is live until a power is used: no mark, no way back to offer'), !(await shown(page, '#hud .live-mark')) && !(await about(page, 'Io', 'Jupiter')).on);

    await press(page, '#hud .card [data-power="mass"]');
    await frames(page, 2);
    check(on('Mass opens a slider at its real mass, said in Jupiters'), (await shown(page, '#hud .card [data-panel="mass"] .slider:not(.size-slider)')) && (await text(page, '#hud [data-panel="mass"] .power-read b')) === '1 Jupiter' && (await text(page, '#hud [data-panel="mass"] .power-read small')) === 'its real mass',
      `${await text(page, '#hud [data-panel="mass"] .power-read b')} · ${await text(page, '#hud [data-panel="mass"] .power-read small')}`);
    const before = { io: await about(page, 'Io', 'Jupiter') };

    // the knob dragged from the middle to about twice the mass, and looked at before it is let go
    const from = await sliderPoint(page, 0), to = await sliderPoint(page, Math.log10(2));
    if (touch) {
      await touch.press(from);
      for (let i = 1; i <= 6; i++) await touch.slide({ x: from.x + ((to.x - from.x) * i) / 6, y: from.y });
    } else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 6 });
    }
    await frames(page, 3);
    const held = await about(page, 'Io', 'Jupiter');
    const read = await text(page, '#hud [data-panel="mass"] .power-read b');
    check(on('with the finger still down physics is live, Jupiter is about twice as heavy and says so, and Io is on a new orbit'),
      held.on && held.factor > 1.6 && held.factor < 2.5 && /^\d(\.\d)? Jupiters$/.test(read) && Math.abs(Number(read.split(' ')[0]) - held.factor) < 0.06 && held.e > 0.3 && before.io.e < 0.02 && (await shown(page, '#hud .live-mark')),
      `${held.factor.toFixed(2)} times, "${read}"; Io's orbit ${before.io.e.toFixed(3)} -> ${held.e.toFixed(2)} from a circle`);
    if (touch) await touch.lift(); else await page.mouse.up();
    await frames(page, 3);
    check(on('it is said that live physics is on, with the way back beside it'), /Live physics is on/.test(await toast(page)) && (await text(page, '#hud .live-what small')) === 'since 1 Oct 2026' && (await text(page, '#hud .live-back')) === 'Back to reality',
      `"${(await toast(page)).split('\n')[0]}" · ${await text(page, '#hud .live-what small')}`);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-mass.png`) });

    // Kepler's third law for the new mass, from where each moon is and how it moves: 1/a = 2/r - v²/GM, P = 2π √(a³/GM)
    const law = await page.evaluate(() => ['Io'].map((n) => {
      const a = window.app, m = a.findByName(n), p = a.findByName('Jupiter');
      const r = m.pos.distanceTo(p.pos), v2 = m.vel.distanceToSquared(p.vel), mu = p.gm + m.gm;
      const sma = 1 / (2 / r - v2 / mu);
      return (2 * Math.PI * Math.sqrt(sma ** 3 / mu)) / 86400;
    }));
    // (a moon that will not survive it is chosen first: Metis's new orbit dips into Jupiter)
    await find(page, 'Metis');
    await openCard(page);
    check(on('a moon is found by name and has a card of its own'), (await text(page, '#hud .card h2')) === 'Metis' && (await shown(page, '#hud .card [data-act="remove"]')));
    const asked = await rate(page, '1 h/s');
    // (Io: on these orbits Europa runs into Ganymede a day and a half on, before it has gone round twice)
    const timed = await timeOrbits(page, ['Io'], 'Jupiter', 240);
    await pause(page);
    const was = [before.io.period / 86400];
    check(on("Io goes round Jupiter in the time Kepler's law gives for the new mass, far less than before"),
      asked === '1 h/s' && timed.every((t, k) => t !== null && Math.abs(t / law[k] - 1) < 0.03 && t / was[k] < 0.55),
      timed.map((t, k) => `Io ${t?.toFixed(3)} d (the law: ${law[k].toFixed(3)}; it was ${was[k].toFixed(3)})`).join(', '));

    const after = await page.evaluate(() => {
      const a = window.app, metis = a.findByName('Metis'), j = a.findByName('Jupiter');
      return { gone: a.system.isGone(metis), valid: metis.valid, selection: a.selection?.name, target: a.rig.target?.name, card: document.querySelector('#hud .card h2').textContent, log: a.physics.status().log.map((e) => e.text), drawn: a.bodies.views.has(metis) };
    });
    const told = after.log.find((t) => t.startsWith('Metis hit Jupiter'));
    check(on('Metis fell into Jupiter: the two are one, it is told how fast, and the selection and the camera are with Jupiter'),
      after.gone && !after.valid && !after.drawn && /^Metis hit Jupiter at \d+(\.\d)? km\/s and is part of it now\.$/.test(told ?? '') && after.selection === 'Jupiter' && after.target === 'Jupiter' && after.card === 'Jupiter',
      `"${told}"; selected ${after.selection}, the camera at ${after.target}`);

    // what is simulated and what is left out: a tap on the mark, a tap on the line
    await press(page, '#hud .live-what');
    await frames(page, 2);
    const sheet = await page.evaluate(() => ({ about: document.querySelector('#hud .live-about').textContent, log: [...document.querySelectorAll('#hud .live-log p')].map((p) => p.textContent) }));
    await press(page, '#hud .live-left summary');
    const left = await page.evaluate(() => ({ open: document.querySelector('#hud .live-left').open, items: [...document.querySelectorAll('#hud .live-left li')].map((li) => li.textContent) }));
    check(on('a tap on the mark shows what has happened, a second what the simulation leaves out, in plain words'),
      /^Since 1 October 2026 everything here moves under its own gravity/.test(sheet.about) && sheet.log.some((l) => /Metis hit Jupiter/.test(l) && /October 2026/.test(l)) && left.open && left.items.length >= 5 && left.items.some((t) => /tides/.test(t)) && left.items.some((t) => /rails/.test(t)),
      `${sheet.log.length} events; ${left.items.length} things left out`);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-log.png`) });

    // backwards: the date runs back, what merged stays merged
    await press(page, '#hud .transport [data-act="reverse"]');
    const saidBack = await toast(page);
    const jdA = await page.evaluate(() => window.app.clock.jdTdb);
    await press(page, '#hud .transport [data-act="pause"]');
    await frames(page, 12);
    await press(page, '#hud .transport [data-act="pause"]');
    const jdB = await page.evaluate(() => ({ jd: window.app.clock.jdTdb, metis: window.app.findByName('Metis').valid }));
    await press(page, '#hud .transport [data-act="reverse"]');
    await press(page, '#hud .sheet.time [data-close]');
    check(on('time runs backwards too, and what has merged stays merged'), /Time reversed: what has merged stays merged/.test(saidBack) && jdB.jd < jdA - 1e-4 && !jdB.metis, `"${saidBack}"; ${((jdA - jdB.jd) * 24).toFixed(1)} h back`);

    // a simulated world's details: that it is simulated and since when, what it goes round, the orbit it is on now. (Ganymede's:
    // with Jupiter twice as heavy the great moons' orbits cross, and which of them hit which goes as the stepping does on the
    // machine; Ganymede, the heaviest, takes in any it meets. Io was asked for, and at a desk it had sometimes been taken in by
    // then: the search gave the asteroid Io, and its card.)
    await find(page, 'Ganymede', /Jupiter/);
    await press(page, '#hud .card [data-details]');
    await frames(page, 2);
    const facts = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#hud .card .facts dl div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent])));
    check(on("Ganymede's details say it is simulated and since when, what it goes round and the orbit it is on now"),
      // (its two ends in one unit, "371,296 to 695,409 km", or each in its own, "357,954 km to 1.072 million km")
      facts['Live physics'] === 'simulated since 1 October 2026' && facts['Goes round'] === 'Jupiter' && /^(an oval|a long oval), [\d,]+( km)? to [\d.,]+ (million )?km · [\d.]+ (d|h)$/.test(facts['Its orbit'] ?? '') && /^0\.\d\d \(0 is a circle, 1 and more an open path\)$/.test(facts['How stretched'] ?? ''),
      `${facts['Live physics']}; round ${facts['Goes round']}; ${facts['Its orbit']}; ${facts['How stretched']}`);

    // back to reality: every body exactly where a system that was never touched has it at that date
    await press(page, '#hud .live-back');
    await frames(page, 3);
    const real = await page.evaluate(async () => {
      const a = window.app, jd = a.clock.jdTdb;
      const fresh = await a.system.constructor.load(new URL('data', document.baseURI).href.replace(/\/$/, ''));
      await fresh.ephemeris.request(jd);
      fresh.update(jd);
      a.system.update(jd);
      let off = 0, other = 0;
      a.system.bodies.forEach((b, k) => {
        const f = fresh.bodies[k];
        if (b.pos.x !== f.pos.x || b.pos.y !== f.pos.y || b.pos.z !== f.pos.z || b.vel.x !== f.vel.x) off++;
        if (b.gm !== f.gm || b.radius !== f.radius || b.valid !== f.valid || b.parent?.id !== f.parent?.id || b.children.length !== f.children.length) other++;
      });
      return { on: a.physics.on, bodies: a.system.bodies.length, fresh: fresh.bodies.length, off, other, metis: a.findByName('Metis').valid, toast: document.querySelector('#hud .hud-toast').textContent, de: a.system.usingDE,
        mark: document.querySelector('#hud .live-mark').hidden ? 'none' : document.querySelector('#hud .live-what b').textContent, undo: !document.querySelector('#hud .live-mark .live-undo').hidden, way: !document.querySelector('#hud .live-mark .live-back').hidden };
    });
    check(on('"Back to reality": every body exactly where the ephemeris has it, as the catalogue has it, and the mark of live physics gives way to a moment\'s offer to undo it'),
      !real.on && real.mark === 'Back to reality' && real.undo && !real.way && real.bodies === real.fresh && real.off === 0 && real.other === 0 && real.metis && real.toast === 'Back to reality, on 1 October 2026' && real.de,
      `${real.bodies} bodies, ${real.off} out of place, ${real.other} otherwise changed; "${real.toast}"`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ the Sun, taken away
  if (want('sun')) {
    const { ctx, page } = await open(kind, 'target=Earth&dist=6');
    await quiet(page);
    await frames(page, 10);
    const day = await discLight(page, 'Earth');
    const start = await page.evaluate(() => window.app.system.bodies.filter((b) => b.kind === 'planet').map((b) => [b.name, ...b.pos.toArray(), ...b.vel.toArray()]));
    await find(page, 'Sun');
    await press(page, '#hud .hud-flight [data-act="stop"]');
    await press(page, '#hud .card [data-act="remove"]');
    await frames(page, 3);
    const gone = await page.evaluate(() => {
      const a = window.app;
      return { suns: a.system.suns.length, on: a.physics.on, selection: a.selection?.name ?? null, sheet: document.querySelector('#hud').dataset.sheet, toast: document.querySelector('#hud .hud-toast').textContent, belt: a.small.group.visible, sunDrawn: a.bodies.views.has(a.system.sun) };
    });
    check(on('the Sun is taken away with the button on its card: it is gone, its card with it, and what follows is told'),
      gone.suns === 0 && gone.on && gone.selection === null && gone.sheet === 'none' && !gone.sunDrawn && /The Sun is gone\./.test(gone.toast) && /are flying free: nothing holds them now\./.test(gone.toast),
      JSON.stringify(gone.toast));
    check(on('the asteroid belt and the comets, which cannot be simulated one by one, are left out with it'), !gone.belt);
    await press(page, '#hud .hud-tabs [data-tab="search"]');
    await page.locator('#hud .searchbox input').fill('Sun');
    await frames(page, 3);
    const offered = await page.evaluate(() => [...document.querySelectorAll('#hud .explore .list .row b')].map((b) => b.textContent));
    check(on('what is gone is no longer found by name'), !offered.includes('Sun'), offered.slice(0, 4).join(', '));

    // a month on: straight lines at the speed each had
    await find(page, 'Earth');
    await page.waitForFunction(() => !window.app.rig.autopilot, null, { timeout: 120000 });
    const asked = await rate(page, '1 d/s');
    await page.waitForFunction(() => window.app.clock.jdTdb >= window.app.physics.live.jd0 + 30, null, { timeout: 240000 });
    await pause(page);
    const flown = await page.evaluate((start) => {
      const a = window.app, t = (a.clock.jdTdb - a.physics.live.jd0) * 86400;
      return { days: t / 86400, planets: start.map(([name, x, y, z, u, v, w]) => {
        const b = a.findByName(name), went = Math.hypot(u, v, w) * t;
        return { name, off: Math.hypot(b.pos.x - x - u * t, b.pos.y - y - v * t, b.pos.z - z - w * t) / went, speed: b.vel.length() / Math.hypot(u, v, w), parent: b.parent?.name ?? null };
      }) };
    }, start);
    check(on('a month later every planet has gone straight on at its orbital speed, round nothing'),
      asked === '1 d/s' && flown.days >= 30 && flown.planets.every((p) => p.off < 1e-3 && Math.abs(p.speed - 1) < 1e-3 && p.parent === null),
      `${flown.days.toFixed(1)} days: off the straight line by at most ${(Math.max(...flown.planets.map((p) => p.off)) * 100).toFixed(3)} % of the way gone (${flown.planets.find((p) => p.off === Math.max(...flown.planets.map((q) => q.off))).name})`);
    const night = await discLight(page, 'Earth');
    const names = await page.evaluate(() => [...document.querySelectorAll('#labels .label')].filter((l) => l.style.display !== 'none').map((l) => l.textContent));
    // (dark but for its cities, to which the eye adapts: most of the disc is black, the lights are a few points in a hundred)
    check(on("the Earth's day side is dark, and its name is still on the sky"), day.mean > 40 && day.median > 20 && night.median < 2 && night.mean < day.mean / 5 && names.includes('Earth'),
      `the disc's mean ${day.mean.toFixed(1)} -> ${night.mean.toFixed(2)} of 255, its median ${day.median.toFixed(0)} -> ${night.median.toFixed(0)} (${night.px} px; the brightest twentieth above ${night.top.toFixed(1)})`);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-no-sun.png`) });

    // a thousand years a second: the frame holds, and the stepping keeps to its share of it. (How long the app's
    // own work on a frame takes, and the stepping in it: what the frame takes in all here is the software
    // renderer's time, which wanders with whatever else the machine is doing.)
    const pace = (n) => page.evaluate((n) => new Promise((done) => {
      const a = window.app, work = [], frame = a.frame.bind(a), follow = a.physics.follow.bind(a.physics);
      let most = 0;
      a.physics.follow = (clock, dt) => { const t = performance.now(); follow(clock, dt); most = Math.max(most, performance.now() - t); };
      a.frame = () => {
        const t = performance.now();
        frame();
        work.push(performance.now() - t);
        if (work.length < n) return;
        delete a.frame;
        delete a.physics.follow;
        work.sort((p, q) => p - q);
        done({ median: work[work.length >> 1], stepping: most, jd: a.clock.jdTdb });
      };
    }), n);
    const still = await pace(12);
    const top = await rate(page, '1000 yr/s');
    const fast = await pace(12);
    await pause(page);
    check(on('a thousand years a second can be asked for in live physics, and a frame stays a frame: the stepping keeps to its share'),
      top === '1000 yr/s' && fast.stepping < 16 && fast.median < still.median + 20 && (fast.jd - still.jd) / 365.25 > 50,
      `the app's work on a frame: ${still.median.toFixed(1)} ms with time stopped, ${fast.median.toFixed(1)} ms at ${top}, of which at most ${fast.stepping.toFixed(1)} ms of stepping; ${Math.round((fast.jd - still.jd) / 365.25)} years went by`);

    // back: beyond the years the ephemeris knows, to the day it began
    await press(page, '#hud .live-back');
    await frames(page, 3);
    const back = await page.evaluate(() => {
      const a = window.app;
      return { on: a.physics.on, suns: a.system.suns.length, sun: a.system.sun.valid, belt: a.small.group.visible, toast: document.querySelector('#hud .hud-toast').textContent, date: document.querySelector('#hud .time-date').textContent, rate: document.querySelector('#hud .chip.clock small').textContent, earth: a.findByName('Earth').parent?.name };
    });
    check(on('"Back to reality" from beyond the years the ephemeris knows returns to the day it began, as from anywhere; the Sun and the belt are back'),
      !back.on && back.suns === 1 && back.sun && back.belt && back.earth === 'Sun' && back.date === '1 October 2026' && /^Back to reality, on 1 October 2026$/.test(back.toast),
      `"${back.toast}"; ${back.date}`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ the Moon, moved
  if (want('moon')) {
    const { ctx, page, touch } = await open(kind, 'target=Earth&dist=6', false);
    await quiet(page);
    await find(page, 'Moon');
    await press(page, '#hud .hud-flight [data-act="stop"]');
    await openCard(page);
    const lay = await page.evaluate(() => {
      const r = document.querySelector('#hud .card [data-act="move"]').getBoundingClientRect();
      return { w: r.width, h: r.height, others: ['[data-power="mass"]', '[data-act="remove"]'].every((sel) => document.querySelector(`#hud .card ${sel}`).getBoundingClientRect().height >= 44) };
    });
    await press(page, '#hud .card [data-act="move"]');
    await frames(page, 3);
    // (setup, not a power: the eye is put high over the Earth, far enough back that the Moon and the place twice as
    // far out are both in the open, clear of the card, of the chips and of where the mark of live physics will be)
    const view = await page.evaluate(() => {
      const a = window.app, earth = a.findByName('Earth'), moon = a.findByName('Moon');
      const V = moon.pos.constructor;
      const walls = [...document.querySelectorAll('#hud .sheet.card, #hud .hud-tabs, #hud .chip, #hud .live-mark, #hud .fab')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
      const open = (p) => !!p && p.x > 36 && p.x < innerWidth - 36 && p.y > 170 && p.y < innerHeight - 36 && walls.every((r) => p.x < r.left - 36 || p.x > r.right + 36 || p.y < r.top - 36 || p.y > r.bottom + 36);
      for (const dist of [350, 500, 700]) for (let az = 0; az < 360; az += 30) {
        a.placeNear(earth, dist * earth.radius, az, 75);
        a.frame();
        const r = moon.pos.clone().sub(earth.pos);
        const from = a.project(moon.upos.sub(a.rig.upos, new V())), to = a.project(earth.upos.sub(a.rig.upos, new V()).add(r.clone().multiplyScalar(2)));
        if (open(from) && open(to)) return { from, to, r: r.length(), normal: r.clone().cross(moon.vel.clone().sub(earth.vel)).normalize().toArray(), vel: moon.vel.toArray(), period: a.physics.orbit(moon)?.period ?? 0 };
      }
      return null;
    });
    await frames(page, 3);
    const ring = await page.evaluate(() => { const r = document.querySelector('#hud .move-handle').getBoundingClientRect(); return { shown: !document.querySelector('#hud .move-handle').hidden, x: r.left + r.width / 2, y: r.top + r.height / 2, plane: document.querySelector('#hud .move-plane').textContent }; });
    check(on("the Moon's card offers Move beside Mass and Remove, a thumb high; on, a ring marks the Moon and the card says how it moves"),
      !!view && lay.h >= 44 && lay.w > 60 && lay.others && ring.shown && Math.hypot(ring.x - view.from.x, ring.y - view.from.y) < 3 && ring.plane === 'It moves in the plane of its orbit.' && !(await about(page, 'Moon', 'Earth')).on,
      `the button ${lay.w.toFixed(0)} x ${lay.h.toFixed(0)} px; the ring ${view ? Math.hypot(ring.x - view.from.x, ring.y - view.from.y).toFixed(1) : '?'} px from the Moon; "${ring.plane}"`);

    // a finger on the Moon, dragged to twice its distance from the Earth, and looked at before it lifts
    const eye = () => page.evaluate(() => [...window.app.view.quat.toArray(), window.app.clock.paused]);
    const before = await eye();
    if (touch) {
      await touch.press(view.from);
      for (let i = 1; i <= 10; i++) await touch.slide({ x: view.from.x + ((view.to.x - view.from.x) * i) / 10, y: view.from.y + ((view.to.y - view.from.y) * i) / 10 });
    } else {
      await page.mouse.move(view.from.x, view.from.y);
      await page.mouse.down();
      await page.mouse.move(view.to.x, view.to.y, { steps: 10 });
    }
    await frames(page, 3);
    const held = await page.evaluate((view) => {
      const a = window.app, earth = a.findByName('Earth'), moon = a.findByName('Moon');
      const r = moon.pos.clone().sub(earth.pos), ring = document.querySelector('#hud .move-handle').getBoundingClientRect();
      return {
        on: a.physics.on, paused: a.clock.paused, quat: a.view.quat.toArray(), far: r.length() / view.r, out: Math.abs(r.normalize().dot({ x: view.normal[0], y: view.normal[1], z: view.normal[2] })),
        speed: Math.hypot(moon.vel.x - view.vel[0], moon.vel.y - view.vel[1], moon.vel.z - view.vel[2]), ring: Math.hypot(ring.left + ring.width / 2 - view.to.x, ring.top + ring.height / 2 - view.to.y),
        now: document.querySelector('#hud .power-now').textContent, line: !!a.orbits.objs.get(moon)?.line.visible,
      };
    }, view);
    check(on('a finger on the Moon takes hold of it: time waits, the view does not turn, and physics is live once it has been moved'),
      before[4] === false && held.paused && held.on && before.slice(0, 4).every((q, i) => Math.abs(q - held.quat[i]) < 1e-9));
    // (its velocity: as it was a few seconds before, when the view was set up; in those seconds the Earth's pull turns it by centimetres a second)
    check(on('it goes where the finger goes, in the plane of its orbit: to twice its distance from the Earth, keeping the speed it had'),
      Math.abs(held.far - 2) < 0.06 && held.out < 1e-6 && held.speed < 0.1 && held.ring < 3,
      `${held.far.toFixed(3)} times as far, ${held.out.toExponential(1)} out of the plane, its velocity changed by ${held.speed.toExponential(1)} m/s, the ring ${held.ring.toFixed(1)} px from the finger`);
    // (twice as far out with the speed of its old orbit it is about at the speed of escape: on a long oval round the
    // Earth still, or let go of and on an orbit of its own round the Sun, as the date has it)
    check(on('while it is held the card says what orbit it would be on from there, and the line of that orbit is drawn'),
      /^Now round (Earth|the Sun): (a circle .+ out|(nearly a circle|a slightly stretched circle|an oval|a long oval), .+ to .+) · [\d,.]+ (d|h)\.$/.test(held.now) && held.line, `"${held.now}"`);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-move.png`) });
    if (touch) await touch.lift(); else await page.mouse.up();
    await frames(page, 3);
    const let_ = await eye();

    // left on a circle there: the month Kepler's law gives it
    await press(page, '#hud .card [data-act="move-circle"]');
    await frames(page, 3);
    const circle = await page.evaluate((view) => {
      const a = window.app, earth = a.findByName('Earth'), moon = a.findByName('Moon'), o = a.physics.orbit(moon);
      const r = moon.pos.distanceTo(earth.pos);
      return { e: o.e, period: o.period, law: 2 * Math.PI * Math.sqrt(r ** 3 / (earth.gm + moon.gm)), was: view.period, parent: moon.parent?.name, now: document.querySelector('#hud .power-now').textContent, jd: a.clock.jdTdb, dir: moon.pos.clone().sub(earth.pos).normalize().toArray() };
    }, view);
    check(on('lifted, time runs on; asked to go in a circle there, the Moon is on one round the Earth, and its month is the one Kepler\'s law gives: about 2.8 of the old'),
      let_[4] === false && circle.e < 1e-3 && circle.parent === 'Earth' && Math.abs(circle.period / circle.law - 1) < 1e-6 && circle.period / circle.was > 2.4 && circle.period / circle.was < 3.2 && /^Now round Earth: a circle [\d,]+ km out · [\d.]+ d\.$/.test(circle.now),
      `${(circle.period / 86400).toFixed(1)} d (it was ${(circle.was / 86400).toFixed(1)} d: ${(circle.period / circle.was).toFixed(2)} times); "${circle.now}"`);
    // ...and so it goes, at first: about a tenth of that month on, as far round as Kepler has it. (Not for long. Half
    // way to the edge of the Earth's reach the Sun pulls hard: within three weeks the Moon is 4 % ahead, within ten
    // it has swung between half and one and a half times that distance, and after four months it is the Sun's.)
    const asked = await rate(page, '6 h/s');
    await page.waitForFunction((to) => window.app.clock.jdTdb >= to, circle.jd + circle.period / 864000, { timeout: 240000 });
    await pause(page);
    const went = await page.evaluate((circle) => {
      const a = window.app, earth = a.findByName('Earth'), moon = a.findByName('Moon'), d = moon.pos.clone().sub(earth.pos).normalize();
      const days = a.clock.jdTdb - circle.jd;
      return { days, turned: Math.acos(d.x * circle.dir[0] + d.y * circle.dir[1] + d.z * circle.dir[2]) / (2 * Math.PI * (days * 86400 / circle.period)), parent: moon.parent?.name };
    }, circle);
    check(on('about a tenth of that month later it is as far round the Earth as Kepler has it go'), asked === '6 h/s' && went.days < 0.2 * circle.period / 86400 && Math.abs(went.turned - 1) < 0.03 && went.parent === 'Earth',
      `${went.days.toFixed(1)} days on: ${(went.turned * 100).toFixed(1)} % of the way Kepler has it go`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ a second Jupiter, and a second sun
  if (want('made')) {
    // (the eye 2.2 AU from the Sun, 40 degrees up: 473 of the Sun's radii)
    const { ctx, page } = await open(kind, 'target=Sun&dist=473&el=40');
    await quiet(page);
    await openCard(page);
    const lay = await page.evaluate(() => [...document.querySelectorAll('#hud .card .card-powers .power')].filter((b) => !b.hidden).map((b) => { const r = b.getBoundingClientRect(); return { label: b.textContent, w: r.width, h: r.height, in: r.left >= 0 && r.right <= innerWidth, disabled: b.getAttribute('aria-disabled') === 'true' }; }));
    check(on("the Sun's card shows all five powers, with only Size dimmed, each a thumb high and all in sight"),
      lay.map((b) => b.label).join() === 'Mass,Size,Move,Add,Remove' && lay.every((b) => b.h >= 44 && b.w >= 60 && b.in && b.disabled === (b.label === 'Size')), lay.map((b) => `${b.label} ${b.w.toFixed(0)} x ${b.h.toFixed(0)}${b.disabled ? ' dimmed' : ''}`).join(', '));
    await press(page, '#hud .card [data-power="size"]');
    const sizeReason = await page.evaluate(() => { const el = document.querySelector('#hud .card .power-reason'); return { text: el.textContent.trim(), shown: !el.hidden && el.getBoundingClientRect().height > 0 }; });
    check(on("the Sun's Size says why it cannot work when tapped"), sizeReason.shown && sizeReason.text.length > 0 && sizeReason.text.length <= 60, sizeReason.text);
    await press(page, '#hud .card [data-power="add"]');
    await frames(page, 2);
    const offers = await page.evaluate(() => [...document.querySelectorAll('#hud .card [data-panel="add"] .row')].filter((r) => !r.hidden && r.getBoundingClientRect().height >= 44).map((r) => r.querySelector('b').textContent));
    // (the first three rows as they were, then the made worlds of a generated look: each a thumb high)
    check(on('what can be added to a star: a planet like Earth, one like Jupiter, a second sun, and the seven worlds of a generated look'),
      offers.join() === 'A planet like Earth,A planet like Jupiter,A second sun,A rocky world,An ocean world,A desert world,A lava world,An icy world,A gas giant,An ice giant', offers.join(', '));
    await page.screenshot({ path: path.join(outDir, `live-${kind}-add.png`) });
    const eye = await page.evaluate(() => { const a = window.app; return a.rig.upos.sub(a.system.sun.upos, new (a.system.sun.pos.constructor)()).toArray(); });
    await press(page, '#hud .card [data-act="add-jupiter"]');
    await frames(page, 4);
    const made = await page.evaluate((eye) => {
      const a = window.app, m = a.selection, sun = a.system.sun, real = a.findByName('Jupiter'), earth = a.findByName('Earth');
      const r = m.pos.clone().sub(sun.pos), v = m.vel.clone().sub(sun.vel), E = { x: eye[0], y: eye[1], z: eye[2] };
      const north = earth.pos.clone().sub(sun.pos).cross(earth.vel.clone().sub(sun.vel)).normalize();
      const o = a.physics.orbit(m);
      return {
        name: m.name, card: document.querySelector('#hud .card h2').textContent, kind: m.kind, on: a.physics.on, simulated: a.physics.simulated(m), made: a.made.length, parent: m.parent?.name,
        gm: m.gm / real.gm, radius: m.radius / real.radius, far: r.length() / Math.hypot(...eye), au: r.length() / 1.495978707e11, side: r.clone().normalize().dot(E) / Math.hypot(...eye),
        tilt: Math.abs(r.clone().normalize().dot(north)), speed: v.length() / Math.sqrt((sun.gm + m.gm) / r.length()), way: r.clone().cross(v).normalize().dot(north), e: o.e, period: o.period,
        toast: document.querySelector('#hud .hud-toast').textContent, powers: [...document.querySelectorAll('#hud .card .card-powers .power')].filter((b) => !b.hidden).map((b) => b.textContent).join(),
        drawn: a.bodies.views.has(m), jd: a.clock.jdTdb, dir: r.clone().normalize().toArray(), pole: r.clone().cross(v).normalize().toArray(),
      };
    }, eye);
    check(on('a tap makes a second Jupiter: a planet of the system with Jupiter\'s mass and size, simulated, selected, and physics is live'),
      made.name === 'Jupiter 2' && made.card === 'Jupiter 2' && made.kind === 'planet' && made.on && made.simulated && made.made === 1 && made.parent === 'Sun' && made.gm === 1 && made.radius === 1 && made.drawn && /Live physics is on/.test(made.toast),
      `${made.name}, ${made.gm} of Jupiter's mass, round ${made.parent}`);
    check(on('it is on the orbit promised: a circle round the Sun in the plane of the planets, the way they go, 0.55 of the way to the eye, and that is said'),
      Math.abs(made.far - 0.55) < 1e-6 && made.side > 0.7 && made.tilt < 0.03 && Math.abs(made.speed - 1) < 1e-6 && made.way > 0.999 && made.e < 1e-6 && new RegExp(`Jupiter 2 is new: ${Number(made.au.toPrecision(3))} AU from the Sun, once round in [\\d.]+ (d|yr)\\.`).test(made.toast),
      `${made.au.toFixed(3)} AU out (${made.far.toFixed(6)} of the eye's distance), ${(Math.asin(made.tilt) * 57.3).toFixed(2)} deg from the Earth's plane, ${made.speed.toFixed(6)} of the circular speed; "${made.toast.split('\n').pop()}"`);
    check(on('it can be changed like any world: its card has Mass, Size, Move, Add and Remove'), made.powers === 'Mass,Size,Move,Add,Remove', made.powers);
    await press(page, '#hud .card [data-power="mass"]');
    await frames(page, 2);
    const mass = await text(page, '#hud [data-panel="mass"] .power-read b');
    await press(page, '#hud .card [data-details]');
    await frames(page, 2);
    const facts = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#hud .card .facts dl div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent])));
    check(on('its mass reads 1 Jupiter, and its details say it was made, is simulated, and what it goes round'),
      mass === '1 Jupiter' && facts.Type === 'Planet (made by you)' && facts['Live physics'] === 'simulated since 1 October 2026' && facts['Goes round'] === 'the Sun' && /^(a circle [\d.]+ AU out|nearly a circle, [\d.]+ to [\d.]+ AU) · /.test(facts['Its orbit'] ?? ''),
      `${mass}; ${facts.Type}; ${facts['Live physics']}; round ${facts['Goes round']}; ${facts['Its orbit']}`);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-jupiter2.png`) });
    await press(page, '#hud .hud-tabs [data-tab="explore"]');
    await press(page, '#hud .explore [data-cat="solar"]');
    await frames(page, 2);
    const listed = await page.evaluate(() => [...document.querySelectorAll('#hud .explore .list .row b')].map((b) => b.textContent));
    await find(page, 'Jupiter 2');
    await press(page, '#hud .hud-flight [data-act="stop"]');
    check(on('it is listed with the Solar System and found by name'), listed.includes('Jupiter 2') && listed.includes('Jupiter') && (await text(page, '#hud .card h2')) === 'Jupiter 2', listed.slice(-3).join(', '));

    // A quarter of its year later, a quarter of the way round: looked at in the frame in which the date passes a
    // quarter of its year (not after time has been stopped with the Time sheet's button, which on a loaded machine
    // can come many seconds, and months of its year, later), as the angle it has turned through about the pole of
    // its orbit, all the way round (the angle between two directions cannot tell 220 degrees from 140).
    const asked = await rate(page, '7.0 d/s');
    const went = await (await page.waitForFunction((made) => {
      const a = window.app;
      if (a.clock.jdTdb < made.jd + made.period / 86400 / 4) return null;
      const m = a.findByName('Jupiter 2'), sun = a.system.sun, r = m.pos.clone().sub(sun.pos), d = r.clone().normalize();
      const [x, y, z] = made.dir, [px, py, pz] = made.pole;
      const cos = d.x * x + d.y * y + d.z * z, sin = px * (y * d.z - z * d.y) + py * (z * d.x - x * d.z) + pz * (x * d.y - y * d.x);
      // (Kepler's angle for the time gone by, and the one measured, with as many whole turns as bring it nearest)
      const year = ((a.clock.jdTdb - made.jd) * 86400) / made.period, kepler = 2 * Math.PI * year;
      const angle = (Math.atan2(sin, cos) + 2 * Math.PI) % (2 * Math.PI), turned = angle + 2 * Math.PI * Math.round((kepler - angle) / (2 * Math.PI));
      return { turned: turned / kepler, year, far: r.length() / 1.495978707e11 / made.au, parent: m.parent?.name };
    }, made, { timeout: 240000 })).jsonValue();
    await pause(page);
    check(on('a quarter of its year later it is a quarter of the way round the Sun, at the distance it was put at'),
      asked === '7.0 d/s' && Math.abs(went.turned - 1) < 0.03 && Math.abs(went.far - 1) < 0.03 && went.parent === 'Sun',
      `${(went.year * 100).toFixed(1)} % of its year on: ${(went.turned * 100).toFixed(1)} % of the way Kepler has it go, at ${went.far.toFixed(3)} of its distance`);

    // a second sun
    await find(page, 'Sun');
    await press(page, '#hud .hud-flight [data-act="stop"]');
    await press(page, '#hud .card [data-power="add"]');
    await press(page, '#hud .card [data-act="add-sun"]');
    await frames(page, 6);
    const two = await page.evaluate(() => {
      const a = window.app, sun = a.system.sun, twin = a.selection;
      const lit = (b) => a.system.suns.reduce((best, s) => (1 / b.pos.distanceToSquared(s.pos) > 1 / b.pos.distanceToSquared(best.pos) ? s : best));
      const worlds = a.system.bodies.filter((b) => b.valid && b.kind === 'planet');
      let ring = false;
      for (const b of a.system.bodies) { let n = 0; for (let p = b.parent; p; p = p.parent) if (++n > 20) { ring = true; break; } }
      return {
        name: twin.name, kind: twin.kind, suns: a.system.suns.map((s) => s.name).join(), far: twin.pos.distanceTo(sun.pos) / 1.495978707e11, parents: [twin.parent?.name ?? null, sun.parent?.name ?? null], ring,
        light: worlds.every((b) => (a.bodies.views.get(b)?.sun ?? null) === lit(b)), byTwin: worlds.filter((b) => lit(b) === twin).map((b) => b.name),
        shines: (a.bodies.views.get(twin)?.irradiance ?? 0) > 0, toast: document.querySelector('#hud .hud-toast').textContent, type: twin.info()[0][1],
        told: a.physics.log.map((e) => e.text), rows: [a.physics.rows(twin), a.physics.rows(sun)].map((r) => r.find((x) => x[0] === 'Goes round')?.[1] ?? null),
      };
    });
    // Two suns of one mass go round each other. The simulation has the lighter side of the pair go round the heavier,
    // so which of the two it says goes round the other is decided by what else is near each at that moment (where
    // Mercury and Venus are): either will do, if there is no ring, and if the Sun is the one, that is told.
    const pair = (two.parents[0] === 'Sun' && two.parents[1] === null) || (two.parents[0] === null && two.parents[1] === 'Sun 2' && two.told.includes('The Sun and Sun 2 go round each other now.'));
    check(on('a second sun is made the same way: a star of the system that shines; the two go round each other, with no ring in what goes round what'),
      two.name === 'Sun 2' && two.kind === 'star' && two.suns === 'Sun,Sun 2' && two.far >= 0.3 - 1e-9 && pair && !two.ring && two.rows[0] === 'each other, with the Sun' && two.rows[1] === 'each other, with Sun 2'
        && two.shines && two.type === 'Star (made by you)' && /^(Sun 2 is new: .+ AU from the Sun, once round in .+\.)$/m.test(two.toast),
      `${two.name} at ${two.far.toFixed(2)} AU, ${two.parents[0] ? 'going round the Sun' : 'the Sun going round it'}; "${two.toast.split('\n').find((l) => /is new/.test(l))}"; goes round: ${two.rows.join(' / ')}`);
    check(on('each world is lit by the sun that is brighter in its sky'), two.light, `by the new one: ${two.byTwin.join(', ') || 'none yet'}`);
    await frames(page, 6);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-two-suns.png`) });

    // taken away again, and back to reality
    await find(page, 'Jupiter 2');
    await press(page, '#hud .hud-flight [data-act="stop"]');
    await press(page, '#hud .card [data-act="remove"]');
    await frames(page, 3);
    const gone = await page.evaluate(() => { const a = window.app, m = a.made[0]; return { gone: a.system.isGone(m), drawn: a.bodies.views.has(m), found: a.searchItems('Jupiter 2').length, toast: document.querySelector('#hud .hud-toast').textContent }; });
    check(on('what was made is removed like any world'), gone.gone && !gone.drawn && gone.found === 0 && /Jupiter 2 is gone\./.test(gone.toast), `"${gone.toast.split('\n')[0]}"`);
    await press(page, '#hud .live-back');
    await frames(page, 3);
    const real = await page.evaluate(async () => {
      const a = window.app, jd = a.clock.jdTdb;
      const fresh = await a.system.constructor.load(new URL('data', document.baseURI).href.replace(/\/$/, ''));
      await fresh.ephemeris.request(jd);
      fresh.update(jd);
      a.system.update(jd);
      let off = 0;
      a.system.bodies.forEach((b, k) => { const f = fresh.bodies[k]; if (!f || b.id !== f.id || b.pos.x !== f.pos.x || b.pos.y !== f.pos.y || b.pos.z !== f.pos.z || b.parent?.id !== f.parent?.id || b.children.length !== f.children.length) off++; });
      return { on: a.physics.on, bodies: a.system.bodies.length, fresh: fresh.bodies.length, off, made: a.made.length, suns: a.system.suns.map((s) => s.name).join(), found: a.searchItems('Sun 2').length };
    });
    check(on('"Back to reality": nothing of what was made is left, and every body is where the ephemeris has it'),
      !real.on && real.bodies === real.fresh && real.off === 0 && real.made === 0 && real.suns === 'Sun' && real.found === 0, `${real.bodies} bodies, ${real.off} out of place, the suns: ${real.suns}`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ a made world of a generated look: no map, a seed, New look, kept in a save
  if (want('made')) {
    const { ctx, page, touch } = await open(kind, 'target=Sun&dist=473&el=40');
    const hand = await handOf(page, touch);
    await quiet(page);
    await press(page, '#hud .card [data-power="add"]');
    await press(page, '#hud .card [data-act="add-giant"]');
    await page.waitForFunction(() => window.app.selection?.name === 'New gas giant', null, { timeout: 20000 });
    await until(page, () => !window.app.glide, null, 60);
    // (setup, not a power: the eye near it, so that it is drawn as a disk)
    await page.evaluate(() => { const a = window.app, b = a.selection; a.placeNear(b, 6 * b.radius * a.rig.framing, 35, 12); });
    await frames(page, 6);
    /** what the world is drawn with now: its material, the look's type and seed, whether it has a map, and what it is made as */
    const looks = () => page.evaluate(() => {
      const a = window.app, m = a.selection, mesh = a.bodies.meshes.get(m), u = mesh?.material.uniforms;
      const V = m.pos.constructor, at = a.project(m.upos.sub(a.rig.upos, new V()));
      return {
        name: m.name, material: mesh?.material.name ?? null, type: u?.uType?.value ?? null, seed: u?.uSeed?.value ?? null, map: !!u?.uMap, mapOf: m.texture, madeAs: { ...m.meta.madeAs },
        c1: u?.uC1 ? u.uC1.value.toArray().map((x) => Number(x.toFixed(4))).join() : '', at: at && { x: at.x, y: at.y },
        newLook: !document.querySelector('#hud .card .new-look').hidden, newLookH: document.querySelector('#hud .card .new-look').getBoundingClientRect().height,
      };
    });
    /** a picture of the world's disk (a small square round its middle), as bytes */
    const disk = async (at) => page.screenshot({ clip: { x: Math.max(0, at.x - 24), y: Math.max(0, at.y - 24), width: 48, height: 48 } });
    const g0 = await looks();
    check(on('"A gas giant" round the Sun makes a world with no map of its own, drawn with the generated look of its type (giant) and a seed, not a map'),
      g0.name === 'New gas giant' && g0.material === 'generated-look' && g0.type === 8 && g0.seed === g0.madeAs.seed % 97 && !g0.map && !g0.mapOf && g0.madeAs.kind === 'giant' && Number.isInteger(g0.madeAs.seed),
      `${g0.name}: material ${g0.material}, type ${g0.type}, seed ${g0.madeAs.seed}, map ${g0.map}`);
    check(on('while it is put in place the card offers "New look", a thumb high'), g0.newLook && g0.newLookH >= 44, `${g0.newLookH} px`);
    const before = g0.at ? await disk(g0.at) : null;
    await press(page, '#hud .card [data-act="new-look"]');
    await frames(page, 6);
    const g1 = await looks();
    const after = g1.at ? await disk(g1.at) : null;
    check(on('"New look" gives it another seed and another look: the seed differs, its colours differ, it is drawn afresh, and it is still the same world'),
      g1.name === g0.name && g1.madeAs.seed !== g0.madeAs.seed && g1.material === 'generated-look' && g1.seed === g1.madeAs.seed % 97 && g1.c1 !== g0.c1 && !!before && !!after && Buffer.compare(before, after) !== 0,
      `seed ${g0.madeAs.seed} -> ${g1.madeAs.seed}; colour ${g0.c1} -> ${g1.c1}`);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-made-giant.png`) });
    // rings: "Add rings" gives it a ring round its equator, at its size; "Remove rings" takes it away; the rest of its look stays
    const ringed = () => page.evaluate(() => {
      const a = window.app, m = a.selection, ring = a.bodies.group.children.find((o) => o.name === `${m.name} rings`);
      const btn = document.querySelector('#hud .card .made-rings');
      return {
        rings: !!m.meta.madeAs.rings, ring: ring?.material.name ?? null, shown: !!ring?.visible, scale: ring ? ring.matrix.getMaxScaleOnAxis() / m.radius : 0,
        words: btn.hidden ? null : btn.textContent, pressed: btn.getAttribute('aria-pressed'), h: btn.getBoundingClientRect().height, seed: m.meta.madeAs.seed,
      };
    });
    const r0 = await ringed();
    check(on('while it is put in place the card offers "Add rings", a thumb high, and it has none yet'), !r0.rings && !r0.ring && r0.words === 'Add rings' && r0.pressed === 'false' && r0.h >= 44, JSON.stringify(r0));
    await press(page, '#hud .card [data-act="rings"]');
    await frames(page, 6);
    const r1 = await ringed();
    check(on('"Add rings" gives it a ring, drawn round it at its size, with the same look, and the button then offers "Remove rings"'),
      r1.rings && r1.ring === 'generated-ring' && r1.shown && Math.abs(r1.scale - 1) < 1e-6 && r1.words === 'Remove rings' && r1.pressed === 'true' && r1.seed === g1.madeAs.seed, JSON.stringify(r1));
    await page.screenshot({ path: path.join(outDir, `live-${kind}-made-rings.png`) });
    await press(page, '#hud .card [data-act="rings"]');
    await frames(page, 4);
    const r2 = await ringed();
    check(on('"Remove rings" takes the ring away'), !r2.rings && !r2.ring && r2.words === 'Add rings', JSON.stringify(r2));
    await press(page, '#hud .card [data-act="rings"]');
    await frames(page, 4);
    // its colour: the Colour slider, dragged half way along, turns all its colours half round the colour wheel; the rest stays
    const hueBox = await page.locator('#hud .card .placing .hue-slider').boundingBox();
    const hueAt = (s) => ({ x: hueBox.x + 15 + s * (hueBox.width - 30), y: hueBox.y + hueBox.height / 2 });
    const h0 = await looks();
    const beforeHue = h0.at ? await disk(h0.at) : null;
    const thumb = () => page.evaluate(() => document.querySelector('#hud .card .thumb').getAttribute('style'));
    const thumb0 = await thumb();
    await hand.press(hueAt(0));
    for (let i = 1; i <= 6; i++) await hand.slide(hueAt((0.5 * i) / 6));
    await hand.lift();
    await frames(page, 4);
    const h1 = await looks();
    const afterHue = h1.at ? await disk(h1.at) : null;
    const hueRead = await page.evaluate(() => { const row = document.querySelector('#hud .card .hue-row'); return { hue: window.app.selection.meta.madeAs.hue ?? 0, row: !row.hidden, h: row.getBoundingClientRect().height }; });
    const thumb1 = await thumb();
    check(on('its Colour slider, a thumb high, dragged half way along turns its colours half round the colour wheel: other colours on it and on the card\'s picture, the same world, seed and rings'),
      hueRead.row && hueRead.h >= 44 && Math.abs(hueRead.hue - 0.5) < 0.05 && h1.c1 !== h0.c1 && h1.name === h0.name && h1.madeAs.seed === h0.madeAs.seed && h1.madeAs.rings === true
        && h1.material === 'generated-look' && !!beforeHue && !!afterHue && Buffer.compare(beforeHue, afterHue) !== 0 && !!thumb0 && thumb1 !== thumb0,
      JSON.stringify({ ...hueRead, c1: [h0.c1, h1.c1], picture: [thumb0, thumb1] }));
    await page.screenshot({ path: path.join(outDir, `live-${kind}-made-colour.png`) });
    await press(page, '#hud .card [data-act="place-done"]');
    await frames(page, 3);
    // a save of the scene, opened again: the same world, with the same type and seed, drawn the same way
    await page.evaluate(() => window.app.saveScene());
    const id = await page.evaluate(() => JSON.parse(localStorage.getItem('starfarer-saves'))[0].id);
    await page.evaluate((id) => window.app.openSave(id), id);
    await until(page, () => window.app.made.length === 1 && window.app.physics.on, null, 60);
    await page.evaluate(() => { const a = window.app, b = a.made[0]; a.select(b); a.placeNear(b, 6 * b.radius * a.rig.framing, 35, 12); });
    await frames(page, 6);
    const g2 = await looks();
    check(on('a save of the scene, opened again, brings the world back with the same type, seed and colours, drawn with the same generated look'),
      g2.name === 'New gas giant' && g2.madeAs.kind === 'giant' && g2.madeAs.seed === h1.madeAs.seed && g2.madeAs.hue === h1.madeAs.hue && g2.material === 'generated-look' && g2.seed === h1.seed && g2.c1 === h1.c1 && !g2.map,
      `${g2.name}: ${g2.madeAs.kind}, seed ${g2.madeAs.seed}, colour turn ${g2.madeAs.hue} (saved: ${h1.madeAs.seed}, ${h1.madeAs.hue}); colour ${g2.c1} (saved: ${h1.c1})`);
    const r3 = await page.evaluate(() => { const a = window.app, m = a.made[0], ring = a.bodies.group.children.find((o) => o.name === `${m.name} rings`); return { rings: !!m.meta.madeAs.rings, ring: ring?.material.name ?? null, shown: !!ring?.visible }; });
    check(on('...and with its rings'), r3.rings && r3.ring === 'generated-ring' && r3.shown, JSON.stringify(r3));
    check(on('it is a made world like the others: Mass, Size, Move, Add and Remove'),
      await page.evaluate(() => [...document.querySelectorAll('#hud .card .card-powers .power')].filter((b) => !b.hidden).map((b) => b.textContent).join()) === 'Mass,Size,Move,Add,Remove');

    // ---------------------------------------------------------------- naming a world of your own (the name field of the placing panel)
    await find(page, 'Sun');
    await press(page, '#hud .hud-flight [data-act="stop"]');
    await press(page, '#hud .card [data-power="add"]');
    await press(page, '#hud .card [data-act="add-ocean"]');
    await page.waitForFunction(() => window.app.selection?.meta?.made && window.app.selection.name !== 'New gas giant', null, { timeout: 20000 });
    await until(page, () => !window.app.glide, null, 60);
    const own = await page.evaluate(() => window.app.selection.name);
    await page.evaluate(() => { const a = window.app, b = a.selection; a.placeNear(b, 6 * b.radius * a.rig.framing, 35, 12); });
    await frames(page, 6);
    const nameState = () => page.evaluate(() => {
      const f = document.querySelector('#hud .card .name-field'), says = document.querySelector('#hud .card .name-says'), lab = document.querySelector('#hud .card .name-row span');
      const r = f?.getBoundingClientRect();
      const a = window.app;
      return {
        offered: !!f && !f.closest('[hidden]') && r.height > 0, h: r?.height ?? 0, value: f?.value ?? null, label: lab?.textContent ?? null, title: document.querySelector('#hud .card h2').textContent,
        body: a.selection?.name, says: says && !says.hidden ? says.textContent : '', paused: a.clock.paused, jd: a.clock.jdTdb, focus: document.activeElement === f,
      };
    });
    const n0 = await nameState();
    check(on('while a world of your own is put in place, the card offers its name in a field labelled "Name", a thumb high, filled with the name it has'),
      n0.offered && n0.h >= 44 && n0.label === 'Name' && n0.value === own && n0.title === own, JSON.stringify(n0));
    const field = page.locator('#hud .card .name-field');
    const typeName = async (text) => { await field.scrollIntoViewIfNeeded(); await field.click(); await page.keyboard.press('Control+a'); await page.keyboard.type(text); };
    // a Space typed in the field is a space, not "pause" or "start time"
    await typeName('Big Blue');
    await page.keyboard.press('Space');
    await page.keyboard.press('Backspace');
    await frames(page, 3);
    const n1 = await nameState();
    check(on('a Space typed in the name field does not pause or start time (time still waits where it was), and it is not taken before it is left'),
      n1.focus && n1.value === 'Big Blue' && n1.paused && n1.jd === n0.jd && n1.title === own && n1.body === own, JSON.stringify(n1));
    await page.screenshot({ path: path.join(outDir, `live-${kind}-name-typed.png`) });
    await page.keyboard.press('Enter');
    await frames(page, 4);
    const n2 = await nameState();
    check(on('"Big Blue" typed and Enter pressed: the card\'s title says Big Blue, the field is let go of, and no line complains'),
      n2.title === 'Big Blue' && n2.body === 'Big Blue' && n2.value === 'Big Blue' && !n2.focus && n2.says === '', JSON.stringify(n2));
    // refused: a catalogue name in any letter case, a star's, another made world's, and what is not plain; the name stays, with a line saying why
    for (const [typed, why] of [['earth', 'That name is taken'], ['Sirius', 'That name is taken'], ['new gas giant', 'That name is taken'], ['Big <b>', 'Letters, digits and spaces only, 40 at most'], ['x'.repeat(41), 'Letters, digits and spaces only, 40 at most']]) {
      await typeName(typed);
      await page.keyboard.press('Enter');
      await frames(page, 3);
      const n = await nameState();
      check(on(`"${typed.length > 20 ? typed.slice(0, 8) + '...' : typed}" is refused with its line, and the name stays Big Blue`), n.says === why && n.title === 'Big Blue' && n.body === 'Big Blue', JSON.stringify(n));
    }
    await page.screenshot({ path: path.join(outDir, `live-${kind}-name-refused.png`) });
    // (its own name, in another letter case, is allowed; and the new name is kept when the field is left by a tap elsewhere)
    await typeName('  Big blue  ');
    await page.locator('#hud .card .placing .power-read b').click();
    await frames(page, 3);
    const n3 = await nameState();
    check(on('its own name in another letter case, with spaces at either end, is taken when the field is left (trimmed), and the line goes'), n3.title === 'Big blue' && n3.says === '', JSON.stringify(n3));
    await typeName('Big Blue');
    await page.keyboard.press('Enter');
    await frames(page, 3);
    await press(page, '#hud .card [data-act="place-done"]');
    await frames(page, 3);
    // (the card put away, so that the world and its label are in sight)
    await press(page, '#hud .card [data-act="deselect"]');
    await frames(page, 3);
    // (setup, not a power: the eye near it, with the world in the part of the view the interface leaves clear, so that its name can stand by it)
    await page.evaluate(() => {
      const a = window.app, b = a.made.find((m) => m.name === 'Big Blue'), V = b.pos.constructor, free = a.hud.freeArea();
      for (const dist of [6, 12, 25, 60]) for (let az = 0; az < 360; az += 30) {
        a.placeNear(b, dist * b.radius * a.rig.framing, az, 25);
        a.frame();
        const p = a.project(b.upos.sub(a.rig.upos, new V()));
        if (p && p.x > free.left + 60 && p.x < free.right - 60 && p.y > free.top + 20 && p.y < free.bottom - 20) return;
      }
    });
    await frames(page, 6);
    const named = await page.evaluate(() => {
      const a = window.app, b = a.made.find((m) => m.name === 'Big Blue'), V = b.pos.constructor, at = a.project(b.upos.sub(a.rig.upos, new V()));
      return { labels: [...document.querySelectorAll('#labels .label')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.textContent), search: a.searchItems('Big Blue').map((r) => r.label), found: a.findByName('big blue') === b, at: !!at };
    });
    check(on('the new name is its label in the view (the card put away), and a search finds it by it'), named.labels.includes('Big Blue') && named.search.includes('Big Blue') && named.found, JSON.stringify(named));
    await page.screenshot({ path: path.join(outDir, `live-${kind}-name-label.png`) });
    // a save of the scene, opened again, brings the name back
    await page.evaluate(() => window.app.saveScene());
    const id2 = await page.evaluate(() => JSON.parse(localStorage.getItem('starfarer-saves'))[0].id);
    await page.evaluate((id) => window.app.openSave(id), id2);
    await until(page, () => window.app.made.length === 2 && window.app.physics.on, null, 60);
    const back = await page.evaluate(() => ({ names: window.app.made.map((m) => m.name).join(), search: window.app.searchItems('Big Blue').map((r) => r.label).join() }));
    check(on('a save of the scene, opened again, brings back Big Blue (and the other world as it was)'), back.names === 'New gas giant,Big Blue' && /Big Blue/.test(back.search), JSON.stringify(back));
    await ctx.close();
  }

  // ------------------------------------------------------------------ the Moon thrown: the slingshot, and a flick
  if (want('throw')) {
    const { ctx, page, touch } = await open(kind, 'target=Earth&dist=6');
    const hand = await handOf(page, touch);
    await find(page, 'Moon');
    await press(page, '#hud .hud-flight [data-act="stop"]');
    await press(page, '#hud .card [data-act="move"]');
    await press(page, '#hud .card [data-act="move-throw"]');
    await frames(page, 2);
    const offer = await page.evaluate(() => {
      const card = document.querySelector('#hud .card').getBoundingClientRect();
      const seg = [...document.querySelectorAll('#hud .card .seg button')].map((b) => { const r = b.getBoundingClientRect(); return { label: b.textContent, h: r.height, w: r.width, in: r.left >= card.left && r.right <= card.right, on: b.getAttribute('aria-pressed') === 'true' }; });
      const hint = [...document.querySelectorAll('#hud .card .hint-throw > span')].find((s) => getComputedStyle(s).display !== 'none')?.textContent ?? '';
      return { seg, hint, shown: !document.querySelector('#hud .card .hint-throw').hidden && document.querySelector('#hud .card .hint-move').hidden };
    });
    check(on('Move offers a third choice, Throw, beside Keeps its speed and Goes in a circle, each a thumb high and in the card; chosen, the card says how'),
      offer.seg.map((b) => b.label).join() === 'Keeps its speed,Goes in a circle,Throw' && offer.seg.every((b) => b.h >= 44 && b.in) && offer.seg[2].on && offer.shown && /like a slingshot, or flick it\.$/.test(offer.hint),
      `${offer.seg.map((b) => `${b.label} ${b.w.toFixed(0)} x ${b.h.toFixed(0)}`).join(', ')}; "${offer.hint}"`);
    // (setup, not a power: the eye high over the Earth, with room ahead of the Moon, square to the line from the Earth
    // the way it goes round, for an arrow in the open, and room on the screen behind it for the finger's pull)
    const setView = () => page.evaluate(() => {
      const a = window.app, earth = a.findByName('Earth'), moon = a.findByName('Moon'), V = moon.pos.constructor;
      const walls = [...document.querySelectorAll('#hud .sheet.card, #hud .hud-tabs, #hud .chip, #hud .live-mark, #hud .fab, #hud .hud-watch')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
      const open = (p) => !!p && p.x > 20 && p.x < innerWidth - 20 && p.y > 130 && p.y < innerHeight - 20 && walls.every((r) => p.x < r.left - 10 || p.x > r.right + 10 || p.y < r.top - 10 || p.y > r.bottom + 10);
      const seen = (p) => p.x > 8 && p.x < innerWidth - 8 && p.y > 8 && p.y < innerHeight - 8;
      for (const el of [75, 60]) for (const dist of [90, 120, 180, 260, 350]) for (let az = 0; az < 360; az += 15) {
        a.placeNear(earth, dist * earth.radius, az, el);
        a.frame();
        const r = moon.pos.clone().sub(earth.pos), ahead = r.clone().cross(moon.vel.clone().sub(earth.vel)).cross(r).normalize();
        const dot = a.project(moon.upos.sub(a.rig.upos, new V())), tip = a.project(moon.upos.sub(a.rig.upos, new V()).addScaledVector(ahead, 1e5));
        if (!dot || !tip) continue;
        const l = Math.hypot(tip.x - dot.x, tip.y - dot.y), ux = (tip.x - dot.x) / l, uy = (tip.y - dot.y) / l;
        if ([0, 60, 120, 175].every((d) => open({ x: dot.x + ux * d, y: dot.y + uy * d })) && [60, 120, 175].every((d) => seen({ x: dot.x - ux * d, y: dot.y - uy * d }))) {
          return { dot, ux, uy, ahead: ahead.toArray(), r: r.length(), pos: moon.pos.toArray(), vel: moon.vel.toArray(), jd: a.clock.jdTdb };
        }
      }
      return null;
    });
    let view = await setView();
    await frames(page, 3);
    const along = (d) => ({ x: view.dot.x - view.ux * d, y: view.dot.y - view.uy * d });
    const aimed = () => page.evaluate(() => {
      const a = window.app, svg = document.querySelector('#hud .aim'), moon = a.findByName('Moon'), o = a.physics.orbit(moon);
      return {
        shown: !svg.hasAttribute('hidden') && svg.getBoundingClientRect().width > 0, lit: [...svg.querySelectorAll('.aim-mark.on')].map((g) => g.dataset.mark).join(), labels: [...svg.querySelectorAll('text')].map((t) => t.textContent).join(),
        aim: a.mover.aim(), paused: a.clock.paused, now: document.querySelector('#hud .power-now').textContent, e: o?.e ?? -1, parent: moon.parent?.name, line: !!a.orbits.objs.get(moon)?.line.visible,
      };
    });

    // the slingshot: a finger on the Moon pulled back, a little short of the mark of a circle
    const clock0 = await page.evaluate(() => ({ paused: window.app.clock.paused, rate: window.app.clock.rate }));
    await hand.press(view.dot);
    for (let i = 1; i <= 8; i++) await hand.slide(along((107 * i) / 8));
    await frames(page, 2);
    const circle = await aimed();
    check(on('pulled back from the Moon, an arrow points the other way from it, marked where it would go round in a circle and where it would escape; time waits'),
      !!view && circle.shown && circle.labels === 'circle,escape' && circle.paused && !!circle.aim && Math.abs(circle.aim.ux * view.ux + circle.aim.uy * view.uy - 1) < 1e-3,
      `the arrow ${circle.aim ? `(${circle.aim.ux.toFixed(3)}, ${circle.aim.uy.toFixed(3)})` : 'none'}, the way ahead (${view?.ux.toFixed(3)}, ${view?.uy.toFixed(3)})`);
    check(on('near the mark of a circle it is the speed of a circle: the mark lights, and the card and the orbit line show a circle round the Earth before it is let go'),
      circle.lit === 'circle' && circle.aim?.length === 110 && circle.e < 1e-6 && circle.parent === 'Earth' && circle.line && /^Now round Earth: a circle [\d,]+ km out · [\d.]+ d\.$/.test(circle.now), `"${circle.now}", e ${circle.e.toExponential(1)}`);
    // the simulation run ahead, every pull counted: a dashed path from the Moon, and on the card how long it goes on so
    await until(page, () => !window.app.ahead || window.app.ahead.done, null, 60);
    await frames(page, 2);
    const onCircle = await page.evaluate(() => {
      const a = window.app, moon = a.findByName('Moon'), V = moon.pos.constructor, line = a.futures?.group.children[0], at = moon.upos.sub(a.rig.upos, new V());
      const ahead = document.querySelector('#hud .card .power-ahead')?.textContent ?? '';
      if (!line) return { drawn: false, n: 0, from: Infinity, ahead };
      const m = line.matrix.elements;
      return { drawn: line.visible, n: line.geometry.drawRange.count, from: Math.hypot(m[12] - at.x, m[13] - at.y, m[14] - at.z) / at.length(), ahead };
    });
    check(on('while it is aimed, the simulation is run ahead: a dashed path from the Moon, and the card says it goes on like that, every pull counted, for three of its months at least'),
      onCircle.drawn && onCircle.n > 50 && onCircle.from < 1e-9 && /^With every pull counted, it goes on like this for (7\d|8\d)(\.\d)? days at least\.$/.test(onCircle.ahead), `${onCircle.n} places; "${onCircle.ahead}"`);
    // (the arrow is drawn in the part of the view the interface leaves clear: pulled towards the card, it stops at its edge)
    const clip = await page.evaluate(() => {
      const v = (/inset\(([^)]*)\)/.exec(document.querySelector('#hud .aim').style.clipPath)?.[1] ?? '').split(' ').filter(Boolean).map(parseFloat);
      const t = v[0], r = v[1] ?? t, b = v[2] ?? t, l = v[3] ?? r, card = document.querySelector('#hud .sheet.card').getBoundingClientRect();
      return { box: v.length ? { left: l, top: t, right: innerWidth - r, bottom: innerHeight - b } : null, card: { left: card.left, top: card.top, right: card.right, bottom: card.bottom } };
    });
    check(on('the arrow is drawn only where the view is clear of the interface: it stops at the edge of the card rather than running on under it'),
      !!clip.box && (clip.box.bottom <= clip.card.top || clip.box.left >= clip.card.right),
      clip.box ? `drawn in ${clip.box.left.toFixed(0)}-${clip.box.right.toFixed(0)} x ${clip.box.top.toFixed(0)}-${clip.box.bottom.toFixed(0)}; the card at ${clip.card.left.toFixed(0)}-${clip.card.right.toFixed(0)} x ${clip.card.top.toFixed(0)}-${clip.card.bottom.toFixed(0)}` : 'drawn everywhere');
    await page.screenshot({ path: path.join(outDir, `live-${kind}-aim.png`) });
    for (let i = 1; i <= 4; i++) await hand.slide(along(107 + (53 * i) / 4));
    await frames(page, 2);
    const escape = await aimed();
    check(on('pulled on to the mark of escape it is the speed of escape: the card says it will not come back'),
      escape.lit === 'escape' && Math.abs(escape.aim?.length - 110 * Math.SQRT2) < 1e-9 && /^Now on an open path past Earth: it passes at .+, then leaves\.$/.test(escape.now), `"${escape.now}"`);
    // its orbit line at the speed of escape: a parabola about the Earth (r (1 + cos ν) the same all along), drawn from the
    // Moon outwards, through where it is on the screen (before, an open path was left out: no line at all)
    const parabola = await drawnPath(page, 'Moon', 'Earth', { ux: view.ux, uy: view.uy });
    // (the line of a world selected is yellow: (1, 0.9, 0.35); the path ahead is orange)
    check(on('at the mark of escape its orbit line is drawn: a parabola about the Earth from the Moon outwards, starting where the Moon is on the screen, and there on the screen'),
      parabola.drawn && parabola.first < 1 && parabola.reach > 200 && Math.abs(parabola.e - 1) < 1e-4 && parabola.off < 1e-4 && !!parabola.lit && parabola.lit[0] > 120 && parabola.lit[1] > 0.8 * parabola.lit[0] && parabola.lit[2] < parabola.lit[0] - 60,
      parabola.drawn ? `${parabola.n} points from ${parabola.first.toFixed(2)} px off the Moon out to ${parabola.reach.toFixed(0)} px; e ${parabola.e.toFixed(6)} (all within ${parabola.off.toExponential(1)}); lit (${parabola.lit}) at (${parabola.far?.x.toFixed(0)}, ${parabola.far?.y.toFixed(0)})` : 'no line');
    await until(page, () => !window.app.ahead || window.app.ahead.done, null, 60);
    await frames(page, 2);
    const leaving = await page.evaluate(() => {
      // (the words where the path ends, and what they must stand clear of: the ring round the Moon, the arrow as drawn, its marks and
      // their words, the round buttons)
      const label = [...document.querySelectorAll('#labels .label.future')].find((el) => el.style.display !== 'none');
      const r = label?.getBoundingClientRect(), box = r && { l: r.left, t: r.top, r: r.right, b: r.bottom };
      const svg = document.querySelector('#hud .aim');
      const seg = (el) => ['x1', 'y1', 'x2', 'y2'].map((k) => +el.getAttribute(k));
      const lines = [seg(svg.querySelector('.aim-guide')), ...[...svg.querySelectorAll('.aim-mark line')].map(seg)];
      const rects = [svg.querySelector('.aim-head'), ...svg.querySelectorAll('.aim-mark text')].map((el) => el.getBoundingClientRect());
      const fabs = [...document.querySelectorAll('#hud .hud-fabs button')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect());
      const handle = document.querySelector('#hud .move-handle'), h = !handle.hidden && handle.getBoundingClientRect();
      const ring = h && { x: (h.left + h.right) / 2, y: (h.top + h.bottom) / 2, r: h.width / 2 };
      const meets = (q, pad) => !!box && q.left < box.r + pad && q.right > box.l - pad && q.top < box.b + pad && q.bottom > box.t - pad;
      // (the line drawn 4 px wide: a point of it within 3 px of the words is on them)
      const onLine = !!box && lines.some(([x1, y1, x2, y2]) => {
        const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
        for (let k = 0; k <= n; k++) {
          const x = x1 + ((x2 - x1) * k) / Math.max(1, n), y = y1 + ((y2 - y1) * k) / Math.max(1, n);
          if (x > box.l - 3 && x < box.r + 3 && y > box.t - 3 && y < box.b + 3) return true;
        }
        return false;
      });
      return {
        ahead: document.querySelector('#hud .card .power-ahead')?.textContent ?? '', end: window.app.ahead?.end, there: label?.textContent ?? null, box,
        arrow: !svg.hasAttribute('hidden'), ring: !!ring, onLine, onParts: rects.some((q) => meets(q, 1)), onButtons: fabs.some((q) => meets(q, 0)),
        onRing: !!box && !!ring && Math.hypot(Math.max(box.l - ring.x, 0, ring.x - box.r), Math.max(box.t - ring.y, 0, ring.y - box.b)) < ring.r,
      };
    });
    // ("it goes round the Sun in 3.2 days" read as a year of 3.2 days)
    check(on('run ahead, every pull counted, the Moon thrown at escape is the Sun\'s within days (the edge of the Earth\'s reach), and the card says when, and that it goes round the Sun from then on'),
      leaving.end?.kind === 'round' && /^With every pull counted, in \d(\.\d)? days it is the Sun's: from then on it goes round the Sun\.$/.test(leaving.ahead) && /^in \d(\.\d)? days it is the Sun's$/.test(leaving.there ?? ''),
      `"${leaving.ahead}"; where the path ends: "${leaving.there}"`);
    check(on('the words where the path ends stand clear of the ring round the Moon, the arrow, its marks and their words, and of the round buttons'),
      leaving.arrow && leaving.ring && !!leaving.box && !leaving.onRing && !leaving.onLine && !leaving.onParts && !leaving.onButtons,
      leaving.box ? `the words at ${leaving.box.l.toFixed(0)}-${leaving.box.r.toFixed(0)} x ${leaving.box.t.toFixed(0)}-${leaving.box.b.toFixed(0)}; on the ring ${leaving.onRing}, on the arrow's line ${leaving.onLine}, on its head or marks ${leaving.onParts}, on a round button ${leaving.onButtons}` : 'no words where the path ends');
    await page.screenshot({ path: path.join(outDir, `live-${kind}-escape.png`) });
    // back to the circle, and let go (the orbit read the moment the throw ends: then time runs, and within a day the
    // Sun's pull has stretched the circle by a hundredth, as it does the Moon's own orbit)
    for (let i = 1; i <= 4; i++) await hand.slide(along(160 - (52 * i) / 4));
    await page.evaluate((view) => {
      const a = window.app, end = a.endChange;
      a.endChange = (...args) => {
        a.endChange = end;
        const earth = a.findByName('Earth'), moon = a.findByName('Moon'), o = a.physics.orbit(moon);
        window.atThrow = { e: o?.e ?? -1, parent: moon.parent?.name, r: moon.pos.distanceTo(earth.pos) / view.r };
        return end.apply(a, args);
      };
    }, view);
    await hand.lift();
    await frames(page, 2);
    const thrown = await page.evaluate(() => {
      const a = window.app;
      return { ...window.atThrow, watch: a.watch.state, chip: document.querySelector('#hud .watch-text').textContent, paused: a.clock.paused, rate: a.clock.rate, arrow: !document.querySelector('#hud .aim').hasAttribute('hidden') };
    });
    check(on('let go, the Moon goes round the Earth in a circle from where it was, time is as it was and the throw is offered to watch'),
      thrown.e < 1e-6 && thrown.parent === 'Earth' && Math.abs(thrown.r - 1) < 1e-6 && thrown.watch === 'offered' && thrown.chip === 'See what it does' && thrown.paused === clock0.paused && thrown.rate === clock0.rate && !thrown.arrow,
      `e ${thrown.e?.toExponential(1)} round ${thrown.parent}, ${thrown.r?.toFixed(7)} of its distance; "${thrown.chip}", ${thrown.watch}, paused ${thrown.paused} (before: ${clock0.paused}), the arrow ${thrown.arrow ? "still drawn" : "gone"}`);
    await watchIt(page);
    const thrownWatched = await watching(page);
    check(on('tap Watch, and the throw is watched: time runs at the pace of what follows'),
      thrownWatched.state === 'watching' && /^Watching: [\d.]+ days a second$/.test(thrownWatched.text) && !thrownWatched.paused && thrownWatched.clock === thrownWatched.rate, `"${thrownWatched.text}", paused ${thrownWatched.paused}`);
    // days on, the frame still holds the Earth and the Moon: the camera rides with the Earth, which it frames from beyond
    // the Earth's reach (riding with the Sun there, it would see the Earth leave the frame at days a second)
    await until(page, () => !window.app.glide, null, 60);
    const jd0 = await page.evaluate(() => window.app.clock.jdTdb);
    await until(page, (jd0) => window.app.clock.jdTdb > jd0 + 2 || window.app.watch.state !== 'watching', jd0, 120);
    const kept = await page.evaluate((jd0) => {
      const a = window.app, earth = a.findByName('Earth'), V = earth.pos.constructor, at = (b) => a.project(b.upos.sub(a.rig.upos, new V()));
      return { earth: at(earth), moon: at(a.findByName('Moon')), free: a.hud.freeArea(), days: a.clock.jdTdb - jd0, anchor: a.rig.anchor?.name ?? null, watch: a.watch.state, log: a.physics.status()?.log.slice(0, 2).map((e) => e.text) ?? [] };
    }, jd0);
    check(on('days into the watch the frame still holds the Earth and the Moon: the camera rides with the Earth'),
      kept.watch === 'watching' && kept.days > 2 && within(kept.earth, kept.free) && within(kept.moon, kept.free) && kept.anchor === 'Earth',
      `${kept.days.toFixed(1)} days on; the Earth at ${kept.earth ? `(${kept.earth.x.toFixed(0)}, ${kept.earth.y.toFixed(0)})` : 'nowhere'}, the Moon at ${kept.moon ? `(${kept.moon.x.toFixed(0)}, ${kept.moon.y.toFixed(0)})` : 'nowhere'} in ${kept.free.left.toFixed(0)}-${kept.free.right.toFixed(0)} x ${kept.free.top.toFixed(0)}-${kept.free.bottom.toFixed(0)}; riding with ${kept.anchor}${kept.anchor === 'Earth' ? '' : `; the log: ${kept.log.join(' / ')}`}`);
    const words = await markWords(page);
    check(on('while the throw is watched the mark at the top says since when, its words whole'), words.small === 'since 1 Oct 2026' && words.whole, `"${words.small}", whole: ${words.whole}`);
    // (Undo ends the watch)
    await listen(page);
    await press(page, '#hud .live-mark .live-undo');
    await frames(page, 2);
    const back = await page.evaluate((view) => {
      const a = window.app, moon = a.findByName('Moon');
      return { on: a.physics.on, jd: a.clock.jdTdb, off: Math.hypot(moon.pos.x - view.pos[0], moon.pos.y - view.pos[1], moon.pos.z - view.pos[2]), dv: Math.hypot(moon.vel.x - view.vel[0], moon.vel.y - view.vel[1], moon.vel.z - view.vel[2]) };
    }, view);
    const said = await heard(page);
    check(on('Undo puts the Moon back where it was and as it was moving, at the date it was thrown, and says so'),
      !back.on && back.jd === view.jd && back.off === 0 && back.dv === 0 && said.includes('Undone: throwing the Moon. The real Solar System again'), `"${said.join('" then "')}"; ${back.off} m, ${back.dv} m/s off`);

    // a flick: changes not watched now, so that what the throw did is still there to be read (and Move on again: Undo
    // ended it)
    await quiet(page);
    await press(page, '#hud .card [data-act="move"]');
    await press(page, '#hud .card [data-act="move-throw"]');
    view = await setView();
    await frames(page, 3);
    await hand.drag(view.dot, { x: view.dot.x + view.ux * 120, y: view.dot.y + view.uy * 120 }, { steps: 3, rest: 0 });
    await frames(page, 2);
    const flicked = await page.evaluate((view) => {
      const a = window.app, earth = a.findByName('Earth'), moon = a.findByName('Moon');
      const rel = moon.vel.clone().sub(earth.vel), r = moon.pos.distanceTo(earth.pos), mu = earth.gm + moon.gm;
      return {
        f: rel.length() / Math.sqrt(mu / r), ahead: rel.normalize().dot({ x: view.ahead[0], y: view.ahead[1], z: view.ahead[2] }), now: document.querySelector('#hud .power-now').textContent,
        paused: a.clock.paused, on: a.physics.on, told: a.physics.log.map((e) => e.text), toast: document.querySelector('#hud .hud-toast').textContent,
      };
    }, view);
    // (120 px in 64 ms: 1,875 px a second, 1.56 speeds of a circle, past escape's 1.41: free of the Earth at once, and
    // the simulation has it go round the Sun)
    check(on('a quick flick ahead throws the Moon the way the finger went, as fast as the finger was going: past escape, it leaves the Earth for the Sun, and that is said'),
      flicked.on && Math.abs(flicked.f - 1875 / 1200) < 0.01 && flicked.ahead > 0.9999 && flicked.paused && /^Now round the Sun: /.test(flicked.now)
        && flicked.told.includes('The Moon goes round the Sun now, no longer round Earth.') && /The Moon goes round the Sun now, no longer round Earth\./.test(flicked.toast),
      `${flicked.f.toFixed(3)} speeds of a circle, ${(Math.acos(Math.min(1, flicked.ahead)) * 57.3).toFixed(2)} deg off ahead; "${flicked.now}"; "${flicked.toast.split('\n').join(' / ')}"`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ the Earth thrown out of the Solar System: its open path drawn
  if (want('open')) {
    const { ctx, page, touch } = await open(kind, 'target=Earth&dist=6');
    const hand = await handOf(page, touch);
    await find(page, 'Earth');
    // (the camera is there already: the flight to it is over at once)
    await until(page, () => !window.app.rig.autopilot, null, 60);
    await press(page, '#hud .card [data-act="move"]');
    await press(page, '#hud .card [data-act="move-throw"]');
    await frames(page, 2);
    // (setup, not a power: the eye above the Earth, with room ahead of it, square to the line from the Sun the way it goes
    // round, for the arrow, and room behind it for the pull)
    const view = await page.evaluate(() => {
      const a = window.app, sun = a.findByName('Sun'), earth = a.findByName('Earth'), V = earth.pos.constructor;
      const walls = [...document.querySelectorAll('#hud .sheet.card, #hud .hud-tabs, #hud .chip, #hud .live-mark, #hud .fab, #hud .hud-watch')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
      const clear = (p) => !!p && p.x > 20 && p.x < innerWidth - 20 && p.y > 130 && p.y < innerHeight - 20 && walls.every((r) => p.x < r.left - 10 || p.x > r.right + 10 || p.y < r.top - 10 || p.y > r.bottom + 10);
      const seen = (p) => p.x > 8 && p.x < innerWidth - 8 && p.y > 8 && p.y < innerHeight - 8;
      for (const el of [75, 60]) for (const dist of [120, 180, 260, 350]) for (let az = 0; az < 360; az += 15) {
        a.placeNear(earth, dist * earth.radius, az, el);
        a.frame();
        const r = earth.pos.clone().sub(sun.pos), ahead = r.clone().cross(earth.vel.clone().sub(sun.vel)).cross(r).normalize();
        const dot = a.project(earth.upos.sub(a.rig.upos, new V())), tip = a.project(earth.upos.sub(a.rig.upos, new V()).addScaledVector(ahead, 1e5));
        if (!dot || !tip) continue;
        const l = Math.hypot(tip.x - dot.x, tip.y - dot.y), ux = (tip.x - dot.x) / l, uy = (tip.y - dot.y) / l;
        if ([0, 60, 120, 200].every((d) => clear({ x: dot.x + ux * d, y: dot.y + uy * d })) && [60, 120, 176].every((d) => seen({ x: dot.x - ux * d, y: dot.y - uy * d }))) {
          return { dot, ux, uy, pos: earth.pos.toArray(), vel: earth.vel.toArray() };
        }
      }
      return null;
    });
    await frames(page, 3);
    const along = (d) => ({ x: view.dot.x - view.ux * d, y: view.dot.y - view.uy * d });
    // pulled back 1.6 times as far as the mark of a circle: 1.6 times the speed of a circle round the Sun, past escape (1.41)
    await hand.press(view.dot);
    for (let i = 1; i <= 8; i++) await hand.slide(along((176 * i) / 8));
    await frames(page, 3);
    const out = await drawnPath(page, 'Earth', 'Sun', { ux: view.ux, uy: view.uy });
    const card = await page.evaluate(() => ({ now: document.querySelector('#hud .power-now').textContent, parent: window.app.findByName('Earth').parent?.name ?? null }));
    check(on('the Earth aimed at 1.6 times the speed of a circle round the Sun would leave it: the card says so, and its orbit line is drawn, a hyperbola about the Sun from the Earth outwards, starting where it is on the screen'),
      !!view && card.parent === null && /^Now on an open path past the Sun: it passes at 1 AU, then leaves\.$/.test(card.now) && out.drawn && out.first < 1 && out.reach > 100 && Math.abs(out.e - 1.56) < 0.01 && out.off < 1e-3,
      out.drawn ? `"${card.now}"; ${out.n} points from ${out.first.toFixed(2)} px off the Earth out to ${out.reach.toFixed(0)} px; e ${out.e.toFixed(4)} (all within ${out.off.toExponential(1)})` : `"${card.now}"; no line`);
    await until(page, () => !window.app.ahead || window.app.ahead.done, null, 60);
    await frames(page, 2);
    const ahead = await text(page, '#hud .card .power-ahead');
    check(on('run ahead, every pull counted, it leaves the Sun for good, and the card says so'), ahead === 'With every pull counted, it leaves the Sun for good.', `"${ahead}"`);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-open.png`) });
    // let go where it was taken hold of: nothing was thrown
    for (let i = 1; i <= 8; i++) await hand.slide(along(176 * (1 - i / 8)));
    await hand.lift();
    await frames(page, 2);
    const back = await page.evaluate((view) => {
      const a = window.app, e = a.findByName('Earth');
      return { off: Math.hypot(e.pos.x - view.pos[0], e.pos.y - view.pos[1], e.pos.z - view.pos[2]), dv: Math.hypot(e.vel.x - view.vel[0], e.vel.y - view.vel[1], e.vel.z - view.vel[2]), parent: e.parent?.name };
    }, view);
    check(on('let go where it was taken hold of, nothing is thrown: the Earth goes round the Sun as it did'), back.off === 0 && back.dv === 0 && back.parent === 'Sun', `${back.off} m, ${back.dv} m/s off; round ${back.parent}`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ the Earth dragged sunwards: its temperature, live
  if (want('warm')) {
    const { ctx, page, touch } = await open(kind, 'target=Earth&dist=6');
    const hand = await handOf(page, touch);
    await find(page, 'Earth');
    await until(page, () => !window.app.rig.autopilot, null, 60);
    // (the line is on the card opened: one tap on its bar)
    await openCard(page);
    const [real, lines] = await page.evaluate(() => {
      const el = document.querySelector('#hud .card .card-warmth');
      return el ? [el.textContent, Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))] : ['', 0];
    });
    check(on('on the Earth\'s card its temperature, as NASA\'s fact sheet has it: with its air, as measured, and without it, in a line'),
      real === '15 °C, as measured. Without its air: −18 °C.' && lines === 1, `"${real}", ${lines} line(s)`);
    await press(page, '#hud .card [data-act="move"]');
    await frames(page, 2);
    // (setup, not a power: the eye high over the Sun, the Earth and the Sun both in the clear part of the view and well apart, and
    // the plane of the Earth's orbit seen from well out of it: a finger moves it in that plane, which has the Sun in it)
    const view = await page.evaluate(() => {
      const a = window.app, sun = a.findByName('Sun'), earth = a.findByName('Earth'), V = earth.pos.constructor, AU = 1.495978707e11;
      const walls = [...document.querySelectorAll('#hud .sheet.card, #hud .hud-tabs, #hud .chip, #hud .live-mark, #hud .fab, #hud .hud-watch')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
      const clear = (p) => !!p && p.x > 20 && p.x < innerWidth - 20 && p.y > 130 && p.y < innerHeight - 20 && walls.every((r) => p.x < r.left - 10 || p.x > r.right + 10 || p.y < r.top - 10 || p.y > r.bottom + 10);
      for (const el of [75, 60]) for (const dist of [3, 4, 5, 6, 8]) for (let az = 0; az < 360; az += 15) {
        a.placeNear(sun, dist * AU, az, el);
        a.frame();
        const e = a.project(earth.upos.sub(a.rig.upos, new V())), s = a.project(sun.upos.sub(a.rig.upos, new V()));
        if (!e || !s) continue;
        const flat = a.mover.describe(earth).plane === 'It moves in the plane of its orbit.';
        if (flat && clear(e) && clear(s) && Math.hypot(e.x - s.x, e.y - s.y) > 120) return { e, s, d: earth.pos.distanceTo(sun.pos) };
      }
      return null;
    });
    await frames(page, 3);
    // dragged two thirds of the way to the Sun, a step at a time: the line read at each, and what the Earth's distance then gives
    await hand.press(view.e);
    const steps = [];
    for (let i = 1; i <= 8; i++) {
      await hand.slide({ x: view.e.x + ((view.s.x - view.e.x) * 0.66 * i) / 8, y: view.e.y + ((view.s.y - view.e.y) * 0.66 * i) / 8 });
      await frames(page, 2);
      await page.evaluate(() => new Promise((done) => setTimeout(done, 150)));
      steps.push(await page.evaluate(() => {
        const a = window.app, sun = a.findByName('Sun'), earth = a.findByName('Earth');
        // (what the fact sheet's numbers give where it is: ((1 − A) L / 16πσd²)^¼, and the warming its air gives as measured)
        const d = earth.pos.distanceTo(sun.pos), SIGMA = 5.670374419e-8, A = 0.294, bare = ((1 - A) * 3.828e26 / (16 * Math.PI * SIGMA * d * d)) ** 0.25;
        const warming = 288 - ((1 - A) * 1361 / (4 * SIGMA)) ** 0.25;
        const line = document.querySelector('#hud .card .card-warmth');
        return { line: line?.textContent ?? '', live: !!line?.classList.contains('live'), au: d / 1.495978707e11, want: Math.round(bare + warming - 273.15) };
      }));
    }
    const said = steps.map((s) => /^Earth here: (−?\d+) °C\. (.*)$/.exec(s.line));
    const degrees = said.map((m) => (m ? Number(m[1].replace('−', '-')) : NaN));
    check(on('dragged towards the Sun, its card says how warm it is where it is now, step by step, as the sunlight there and the warming its air gives make it'),
      !!view && steps.every((s, i) => s.live && !!said[i] && Math.abs(degrees[i] - s.want) <= 1) && degrees.every((t, i) => i === 0 || t > degrees[i - 1]),
      steps.map((s, i) => `${s.au.toFixed(2)} AU: ${degrees[i]} °C (${s.want})`).join(', '));
    const last = steps[steps.length - 1];
    check(on('past 100 °C the card says the oceans would boil'),
      degrees[degrees.length - 1] > 100 && /The oceans would boil\.$/.test(last.line) && steps.filter((s, i) => degrees[i] < 100).every((s) => !/boil/.test(s.line)), `"${last.line}"`);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-warm.png`) });
    await hand.lift();
    await frames(page, 2);
    await press(page, '#hud .live-mark .live-undo');
    await frames(page, 3);
    const after = await text(page, '#hud .card .card-warmth');
    check(on('Undo: the real Earth again, and its temperature as measured'), after === real, `"${after}"`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ the Earth's size beside its mass
  if (want('size')) {
    const { ctx, page, touch } = await open(kind, 'target=Earth&dist=6');
    const hand = await handOf(page, touch);
    await find(page, 'Earth');
    await until(page, () => !window.app.rig.autopilot, null, 60);
    // (low over the real Earth there is ground to land on; then the eye some forty of its radii out)
    const low = () => page.evaluate(async () => {
      const a = window.app, e = a.findByName('Earth');
      a.placeNear(e, e.radius + 20e3, 0, 30);
      for (let i = 0; i < 10; i++) { a.frame(); await new Promise((r) => requestAnimationFrame(r)); }
      const seen = { owner: a.terrain.owner?.name ?? null, walk: a.walk.canStartHere() };
      a.placeNear(e, 40 * 6.371e6, 0, 30);
      a.frame();
      return seen;
    });
    const real = await low();
    // (its size, a power of its own beside Mass)
    await openCard(page);
    const power = await page.evaluate(() => { const b = document.querySelector('#hud .card [data-power="size"]'), m = document.querySelector('#hud .card [data-power="mass"]'); return b && !b.hidden ? { h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width, beside: b.previousElementSibling === m } : null; });
    if (power) await press(page, '#hud .card [data-power="size"]');
    await frames(page, 2);
    const sized = () => page.evaluate(() => {
      const a = window.app, e = a.findByName('Earth'), part = document.querySelector('#hud .card [data-panel="size"]'), link = part?.querySelector('.size-link');
      const mass = document.querySelector('#hud .card [data-panel="mass"]');
      return {
        shown: !!part && !part.hidden && !part.closest('[hidden]'), words: part?.querySelector('.power-read b').textContent, times: part?.querySelector('.power-read small').textContent,
        slider: part?.querySelector('.size-slider').getBoundingClientRect().height ?? 0, link: link?.getAttribute('aria-pressed'), linkH: link?.getBoundingClientRect().height ?? 0,
        mass: mass && !mass.hidden ? mass.querySelector('.power-read small').textContent : null, says: mass && !mass.hidden ? mass.querySelector('.mass-says')?.textContent : null,
        R: e.radius, gm: e.gm, px: a.bodies.views.get(e)?.pixelRadius ?? 0, on: a.physics.on,
      };
    });
    const z0 = await sized();
    check(on('Size, a power of its own beside Mass: the Earth\'s radius, its real size, a slider and Same density, off, each a thumb high'),
      !!power && power.beside && power.h >= 44 && power.w >= 44 && z0.shown && z0.words === '6,371 km' && z0.times === 'its real size' && z0.slider >= 44 && z0.link === 'false' && z0.linkH >= 44,
      `the power ${power ? `${power.w.toFixed(0)} x ${power.h.toFixed(0)}, beside Mass ${power.beside}` : 'none'}; "${z0.words}", "${z0.times}"; the slider ${z0.slider} px, Same density ${z0.link} (${z0.linkH} px)`);
    if (!z0.shown) {
      for (const what of ['the size slider to three times: the Earth is three times as large, and drawn so, its mass the same, and the card says so', 'what follows from the size follows it: the ground pulls 1/k² as hard, the speed of escape is 1/√k',
        'low over it no ground to land on is laid out, as it is over the real Earth: its ground is measured for its real size', 'Same density on: its size follows its mass, at once and as the mass is changed, the cube root of it, and the card says so',
        'Undo, once a change: the real Earth again, its size and its mass']) check(on(what), false, 'no Size');
      await ctx.close();
    }
    if (z0.shown) {
      // the knob of the size slider to three times the real size (log10 3 of the one power of ten it runs either way)
      const sizePoint = async (v) => { const box = await page.locator('#hud .card .size-slider').boundingBox(); return { x: box.x + 15 + ((v + 1) / 2) * (box.width - 30), y: box.y + box.height / 2 }; };
      const from = await sizePoint(0), to = await sizePoint(Math.log10(3));
      await hand.press(from);
      for (let i = 1; i <= 6; i++) await hand.slide({ x: from.x + ((to.x - from.x) * i) / 6, y: from.y });
      await hand.lift();
      await frames(page, 3);
      const z1 = await sized();
      const k = z1.R / z0.R;
      // (the slider's step nearest three times is 2.985 times: it means three times exactly, and the card's two numbers agree)
      check(on('the size slider to three times: the Earth is three times as large, and drawn so, its mass the same, and the card says so'),
        Math.abs(k - 3) < 1e-9 && z1.gm === z0.gm && z1.on && Math.abs(z1.px / z0.px / k - 1) < 0.02 && z1.words === '19,113 km' && z1.times === '3 times its real size',
        `${k.toFixed(3)} times the radius, drawn ${(z1.px / z0.px).toFixed(3)} times as large; "${z1.words}", "${z1.times}"; ${(z1.gm / z0.gm).toFixed(6)} of its mass`);
      // what follows from its size: its ground pulls a ninth as hard, its escape speed is a third less... (the details)
      await press(page, '#hud .card [data-details]');
      await frames(page, 2);
      const worked = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#hud .card .worked-rows details')].map((d) => [d.querySelector('summary span').textContent, d.querySelector('summary b').textContent])));
      const g = parseFloat(worked['Surface gravity']), esc = parseFloat(worked['Escape velocity']);
      check(on('what follows from the size follows it: the ground pulls 1/k² as hard, the speed of escape is 1/√k'),
        Math.abs(g - 9.82 / (k * k)) < 0.02 && Math.abs(esc - 11.19 / Math.sqrt(k)) < 0.05, `surface gravity "${worked['Surface gravity']}", escape velocity "${worked['Escape velocity']}"`);
      // no landing on a world whose size has changed: low over it, no ground is laid out for it
      const ground = await low();
      check(on('low over it no ground to land on is laid out, as it is over the real Earth: its ground is measured for its real size'),
        real.owner === 'Earth' && ground.owner === null && !ground.walk, `over the real Earth: ${real.owner}; over the one three times as large: ${ground.owner}, walk ${ground.walk}`);
      // Same density: its size follows its mass, as dense as it really is (its mass being its real one: its real size again); then
      // eight times the mass, with Mass, twice the size
      await press(page, '#hud .card [data-details]');
      await press(page, '#hud .card [data-power="size"]');
      await frames(page, 2);
      await press(page, '#hud .card .size-link');
      await frames(page, 3);
      const z2 = await sized();
      await slideMass(page, touch, Math.log10(8));
      // (the change is watched, and on an upright phone the panel folds away for the frame: opened again to read it)
      await massPanel(page);
      const z3 = await sized();
      check(on('Same density on: its size follows its mass, at once and as the mass is changed, the cube root of it, and the card says so'),
        z2.link === 'true' && Math.abs(z2.R / z0.R - 1) < 1e-9 && z2.gm === z0.gm && Math.abs(Math.cbrt(z3.gm / z0.gm) - z3.R / z0.R) < 1e-9 && Math.abs(z3.R / z0.R - 2) < 0.05
          && /^(7\.9|8|8\.1) times its real mass$/.test(z3.mass) && z3.says === 'Its size follows: the same density',
        `linked: ${(z2.R / z0.R).toFixed(6)} of its radius; then ${(z3.gm / z0.gm).toFixed(3)} times the mass, ${(z3.R / z0.R).toFixed(4)} times the radius; "${z3.mass}", "${z3.says}"`);
      // and Undo, three times: the real Earth, its size and its mass
      for (let i = 0; i < 3; i++) {
        await press(page, '#hud .live-mark .live-undo');
        await frames(page, 2);
      }
      await frames(page, 2);
      const z4 = await sized();
      check(on('Undo, once a change: the real Earth again, its size and its mass'), z4.R === z0.R && z4.gm === z0.gm && !z4.on, `${(z4.R / z0.R).toFixed(6)} of its radius, ${(z4.gm / z0.gm).toFixed(6)} of its mass, live ${z4.on}`);
      await page.screenshot({ path: path.join(outDir, `live-${kind}-size.png`) });
      await ctx.close();
    }
  }

  // ------------------------------------------------------------------ Mars thrown at the Earth: time slowed to see it, the frame, the flash, the card
  if (want('hit')) {
    const { ctx, page, touch } = await open(kind, 'target=Earth&dist=6');
    const hand = await handOf(page, touch);
    // (setup, not a power: Mars put 40 Earth radii from the Earth, beside it square to the line from the Sun, moving with it,
    // and 10 m/s sunwards: the plane of its orbit about the Earth, which a finger moves it in, has the Earth in it, so an
    // arrow pointed at the Earth on the screen points at it in space, whichever way the eye looks)
    await page.evaluate(() => {
      const a = window.app, earth = a.findByName('Earth'), mars = a.findByName('Mars'), sun = a.findByName('Sun');
      const r = earth.pos.clone().sub(sun.pos), side = r.clone().cross(earth.vel.clone().sub(sun.vel)).cross(r).normalize();
      const sunward = r.clone().normalize().negate();
      a.physics.move(mars, earth.pos.clone().addScaledVector(side, 40 * earth.radius).toArray(), earth.vel.clone().addScaledVector(sunward, 10).toArray(), a.clock.jdTdb);
      a.tellNews(false);
    });
    await find(page, 'Mars');
    await press(page, '#hud .hud-flight [data-act="stop"]');
    await press(page, '#hud .card [data-act="move"]');
    await press(page, '#hud .card [data-act="move-throw"]');
    await frames(page, 2);
    // (setup: the eye over the two, Mars with room behind it, away from the Earth, for the pull)
    const view = await page.evaluate(() => {
      const a = window.app, earth = a.findByName('Earth'), mars = a.findByName('Mars'), V = mars.pos.constructor;
      const walls = [...document.querySelectorAll('#hud .sheet.card, #hud .hud-tabs, #hud .chip, #hud .live-mark, #hud .fab, #hud .hud-watch')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
      const clear = (p) => !!p && p.x > 20 && p.x < innerWidth - 20 && p.y > 130 && p.y < innerHeight - 20 && walls.every((r) => p.x < r.left - 10 || p.x > r.right + 10 || p.y < r.top - 10 || p.y > r.bottom + 10);
      for (const el of [75, 60, 45]) for (const dist of [60, 80, 100, 130]) for (let az = 0; az < 360; az += 15) {
        a.placeNear(earth, dist * earth.radius, az, el);
        a.frame();
        const m = a.project(mars.upos.sub(a.rig.upos, new V())), e = a.project(earth.upos.sub(a.rig.upos, new V()));
        if (!m || !e) continue;
        const l = Math.hypot(e.x - m.x, e.y - m.y), ux = (e.x - m.x) / l, uy = (e.y - m.y) / l;
        // (and the plane of Mars's orbit about the Earth seen from well out of it: a finger moves it in that plane, which
        // has the Earth in it; seen edge on it would be moved across the view, in a plane the Earth is not in)
        const flat = a.mover.describe(mars).plane === 'It moves in the plane of its orbit.';
        if (flat && l > 80 && clear(m) && clear(e) && [40, 80].every((d) => clear({ x: m.x - ux * d, y: m.y - uy * d }))) return { m, ux, uy };
      }
      return null;
    });
    await frames(page, 3);
    // (Mars as it is before it is taken hold of: the throw is given it at once, while the finger aims)
    const before = await page.evaluate(() => { const a = window.app, m = a.findByName('Mars'); return { pos: m.pos.toArray(), vel: m.vel.toArray(), gm: m.gm, jd: a.clock.jdTdb }; });
    // the slingshot pulled back from Mars, away from the Earth: the arrow points at the Earth
    await hand.press(view.m);
    for (let i = 1; i <= 8; i++) await hand.slide({ x: view.m.x - (view.ux * 66 * i) / 8, y: view.m.y - (view.uy * 66 * i) / 8 });
    await until(page, () => !window.app.ahead || window.app.ahead.done, null, 60);
    await frames(page, 2);
    const aim = await page.evaluate(() => ({ now: document.querySelector('#hud .power-now').textContent, ahead: document.querySelector('#hud .card .power-ahead')?.textContent ?? '' }));
    check(on('Mars aimed at the Earth: the card says its path goes into the Earth, and, run ahead with every pull counted, that it hits it, and when'),
      !!view && aim.now === 'Now on a path into Earth: it hits it.' && /^With every pull counted, it hits Earth in [\d.]+ (hours|days)\.$/.test(aim.ahead), `"${aim.now}" "${aim.ahead}"`);
    // let go, and Watch tapped: watched, it falls at the Earth
    await listen(page);
    await hand.lift();
    await frames(page, 2);
    await watchIt(page);
    await until(page, () => window.app.slow?.phase === 'coming', null, 120);
    const slowed = await page.evaluate(() => {
      const a = window.app, V = a.findByName('Earth').pos.constructor, at = (n) => a.project(a.findByName(n).upos.sub(a.rig.upos, new V()));
      return { t: performance.now(), phase: a.slow?.phase, cap: a.slow?.cap, rate: a.clock.rate, watch: a.watch.state, chip: document.querySelector('#hud .watch-text').textContent, framed: a.framed?.name ?? null, earth: at('Earth'), mars: at('Mars'), free: a.hud.freeArea() };
    });
    const dim = await glowAt(page, 'Earth', 30);
    await until(page, () => window.app.flash?.showing, null, 60);
    const bright = await glowAt(page, 'Earth', 30);
    const hit = await page.evaluate(() => {
      const a = window.app, box = document.querySelector('#hud .hud-impact');
      return { t: performance.now(), mars: a.findByName('Mars').valid, free: a.hud.freeArea(), card: !box || box.hidden ? null : { head: box.querySelector('b').textContent, body: box.querySelector('span').textContent, small: box.querySelector('small').textContent, close: box.querySelector('[data-impact-close]').getBoundingClientRect().height, whole: getComputedStyle(box.querySelector('span')).display !== 'none' && getComputedStyle(box.querySelector('small')).display !== 'none' } };
    });
    check(on('let go and Watch tapped, Mars falls at the Earth, watched; as the two come near, time slows, and the chip says how slow, so that the last of the fall takes about three seconds'),
      slowed.phase === 'coming' && slowed.watch === 'watching' && slowed.cap < slowed.rate && /^Slowed: [\d.]+ (minutes|hours) a second$/.test(slowed.chip) && hit.t - slowed.t > 2500 && !hit.mars,
      `"${slowed.chip}" (the watch at ${(slowed.rate / 3600).toFixed(1)} h/s); the hit ${((hit.t - slowed.t) / 1000).toFixed(1)} s later`);
    check(on('the camera frames the two, round the Earth, in the part of the view the interface leaves clear'),
      (slowed.framed === 'Earth' || (within(slowed.earth, slowed.free) && within(slowed.mars, slowed.free))) && within(bright?.at, hit.free),
      `framed round ${slowed.framed}; at the hit the Earth at (${bright?.at.x.toFixed(0)}, ${bright?.at.y.toFixed(0)}) in ${hit.free.left.toFixed(0)}-${hit.free.right.toFixed(0)} x ${hit.free.top.toFixed(0)}-${hit.free.bottom.toFixed(0)}`);
    check(on('where they meet a flash shows: the screen round the Earth many times as bright'), !!dim && !!bright && bright.mean > 3 * dim.mean + 20, `${dim?.mean.toFixed(1)} before, ${bright?.mean.toFixed(1)} at the flash (of 255)`);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-hit.png`) });
    const said = await heard(page);
    check(on('a card says what the hit was, all of it in sight: how fast, the energy against the Sun\'s light and what holds Mars together, a labelled prediction, and that breaking apart is not simulated yet; the toast does not say it again'),
      !!hit.card && /^Mars hit Earth at \d+(\.\d)? km\/s$/.test(hit.card.head) && /^Energy \d(\.\d)?×10³¹ J: as much as the Sun gives off in [\d.]+ (hours|days)\. [\d.]+ times the energy that holds Mars together\.$/.test(hit.card.body)
        && /^Prediction, by a rule of thumb \(the energy against what holds each together\): Mars would break apart, Earth would not\. Breaking apart is not simulated yet: the two become one\.$/.test(hit.card.small) && hit.card.close >= 44 && hit.card.whole && !said.some((t) => /Mars hit Earth/.test(t)),
      hit.card ? `"${hit.card.head}" / "${hit.card.body}" / "${hit.card.small}"; toasts: "${said.join('" then "')}"` : 'no card');
    // Undo: Mars as it was before the throw
    await listen(page);
    await press(page, '#hud .live-mark .live-undo');
    await frames(page, 2);
    const undone = await page.evaluate((before) => {
      const a = window.app, m = a.findByName('Mars');
      return { valid: m.valid, gone: a.system.isGone(m), off: Math.hypot(m.pos.x - before.pos[0], m.pos.y - before.pos[1], m.pos.z - before.pos[2]), dv: Math.hypot(m.vel.x - before.vel[0], m.vel.y - before.vel[1], m.vel.z - before.vel[2]), gm: m.gm, jd: a.clock.jdTdb, card: !!document.querySelector('#hud .hud-impact:not([hidden])'), flash: !!a.flash?.showing };
    }, before);
    const told = await heard(page);
    check(on('Undo brings Mars back, where it was and as it was moving before it was thrown, at that date; the card goes'),
      undone.valid && !undone.gone && undone.off === 0 && undone.dv === 0 && undone.gm === before.gm && undone.jd === before.jd && !undone.card && !undone.flash && told.includes('Undone: throwing Mars'),
      `"${told.join('" then "')}"; ${undone.off} m, ${undone.dv} m/s off`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ a phone on its side: the path ahead and the orbit line where the world is
  if (want('side') && kind === 'phone') {
    const { ctx, page, touch } = await open(kind, 'target=Earth&dist=6');
    await page.setViewportSize({ width: 844, height: 390 });
    await frames(page, 6);
    const hand = await handOf(page, touch);
    await find(page, 'Moon');
    await page.locator('#hud .hud-flight [data-act="stop"]').first().tap({ timeout: 3000 }).catch(() => undefined);
    await press(page, '#hud .card [data-act="move"]');
    await press(page, '#hud .card [data-act="move-throw"]');
    // (the optical centre eases to the middle of the part of the view the card leaves clear, in some 0.3 s)
    await frames(page, 30);
    // (setup, not a power: the eye over the Earth, the Moon in the clear part with room ahead of it for the arrow and the
    // path, and behind it for the pull)
    const view = await page.evaluate(() => {
      const a = window.app, earth = a.findByName('Earth'), moon = a.findByName('Moon'), V = moon.pos.constructor, free = a.hud.freeArea();
      const clear = (p) => !!p && p.x > free.left + 10 && p.x < free.right - 10 && p.y > free.top + 10 && p.y < free.bottom - 10;
      const seen = (p) => p.x > 8 && p.x < innerWidth - 8 && p.y > 8 && p.y < innerHeight - 8;
      for (const el of [75, 60]) for (const dist of [120, 180, 260]) for (let az = 0; az < 360; az += 15) {
        a.placeNear(earth, dist * earth.radius, az, el);
        a.frame();
        const r = moon.pos.clone().sub(earth.pos), ahead = r.clone().cross(moon.vel.clone().sub(earth.vel)).cross(r).normalize();
        const dot = a.project(moon.upos.sub(a.rig.upos, new V())), tip = a.project(moon.upos.sub(a.rig.upos, new V()).addScaledVector(ahead, 1e5));
        if (!dot || !tip) continue;
        const l = Math.hypot(tip.x - dot.x, tip.y - dot.y), ux = (tip.x - dot.x) / l, uy = (tip.y - dot.y) / l;
        if ([0, 40, 80, 120].every((d) => clear({ x: dot.x + ux * d, y: dot.y + uy * d })) && [60, 110].every((d) => seen({ x: dot.x - ux * d, y: dot.y - uy * d }))) return { dot, ux, uy, centre: { ...a.rig.centre } };
      }
      return null;
    });
    await frames(page, 3);
    const along = (d) => ({ x: view.dot.x - view.ux * d, y: view.dot.y - view.uy * d });
    await hand.press(view.dot);
    for (let i = 1; i <= 8; i++) await hand.slide(along((107 * i) / 8));
    await until(page, () => window.app.ahead.done, null, 60);
    await frames(page, 2);
    // the path ahead as drawn: its first place on the Moon, and the line lit on the canvas where App.project puts its places
    const drawn = await page.evaluate((aim) => {
      const a = window.app, moon = a.findByName('Moon'), V = moon.pos.constructor, line = a.futures.group.children[0];
      a.frame();
      const at = moon.upos.sub(a.rig.upos, new V()), dot = a.project(at), m = line.matrix.elements, base = new V(m[12], m[13], m[14]);
      const pos = line.geometry.attributes.position.array, n = line.geometry.drawRange.count;
      const screen = Array.from({ length: n }, (_, k) => a.project(base.clone().add(new V(pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]))));
      const gl = a.renderer.gl.domElement, s = gl.width / gl.clientWidth, cv = Object.assign(document.createElement('canvas'), { width: 7, height: 7 }), g = cv.getContext('2d');
      const lit = (p) => {
        g.clearRect(0, 0, 7, 7);
        g.drawImage(gl, Math.round(p.x * s) - 3, Math.round(p.y * s) - 3, 7, 7, 0, 0, 7, 7);
        const d = g.getImageData(0, 0, 7, 7).data;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 140 && d[i] > d[i + 1] + 25 && d[i + 1] > d[i + 2] + 15) return true;
        return false;
      };
      // (places clear of the arrow's line, its marks and their words, and of the Moon's own disc and ring)
      const free = a.hud.freeArea();
      const away = screen.filter((p) => p && Math.abs((p.x - dot.x) * aim.uy - (p.y - dot.y) * aim.ux) > 30 && Math.hypot(p.x - dot.x, p.y - dot.y) > 40 && p.x > free.left && p.x < free.right && p.y > free.top && p.y < free.bottom);
      const tried = away.filter((_, k) => k % Math.max(1, Math.floor(away.length / 12)) === 0).slice(0, 12);
      return { drawn: line.visible, first: Math.hypot(screen[0].x - dot.x, screen[0].y - dot.y), tried: tried.length, lit: tried.filter(lit).length, centre: { ...a.rig.centre } };
    }, { ux: view.ux, uy: view.uy });
    const orbit = await drawnPath(page, 'Moon', 'Earth', { ux: view.ux, uy: view.uy });
    check(on('held on its side, the view centred on the part the card leaves clear: the path ahead starts on the Moon where it is on the screen, and is drawn where its places are said to be; so is the orbit line'),
      !!view && Math.abs(drawn.centre.x) > 50 && drawn.drawn && drawn.first < 1 && drawn.tried >= 6 && drawn.lit >= drawn.tried / 3 && orbit.drawn && orbit.first < 1 && !!orbit.lit && orbit.lit[0] > 120 && orbit.lit[1] > 0.8 * orbit.lit[0],
      `the centre ${drawn.centre.x.toFixed(0)}, ${drawn.centre.y.toFixed(0)} px off the middle; the path from ${drawn.first.toFixed(2)} px off the Moon, lit at ${drawn.lit} of ${drawn.tried} places tried; the orbit line from ${orbit.first?.toFixed(2)} px, lit (${orbit.lit})`);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-side-ahead.png`) });
    for (let i = 1; i <= 8; i++) await hand.slide(along(107 * (1 - i / 8)));
    await hand.lift();
    await ctx.close();
  }

  // ------------------------------------------------------------------ a world made, put in place, its mass set; Done
  if (want('place')) {
    const { ctx, page, touch } = await open(kind, 'target=Sun&dist=473&el=40');
    const hand = await handOf(page, touch);
    const clock0 = await page.evaluate(() => ({ paused: window.app.clock.paused, rate: window.app.clock.rate }));
    await press(page, '#hud .card [data-power="add"]');
    await press(page, '#hud .card [data-act="add-earth"]');
    await until(page, () => !window.app.glide, null, 60);
    await frames(page, 2);
    const placing = () => page.evaluate(() => {
      const a = window.app, m = a.selection, V = m.pos.constructor, sun = a.system.sun, panel = document.querySelector('#hud .card .placing'), done = panel.querySelector('.place-done').getBoundingClientRect();
      return {
        name: m.name, placing: a.mover.placing && a.mover.body === m, paused: a.clock.paused, at: a.project(m.upos.sub(a.rig.upos, new V())), free: a.hud.freeArea(),
        read: panel.querySelector('b').textContent, what: panel.querySelector('small').textContent, panel: !panel.hidden && !panel.closest('[hidden]'), done: done.height, slider: panel.querySelector('.slider').getBoundingClientRect().height,
        hint: document.querySelector('#hud .hint-place').textContent, seg: !document.querySelector('#hud .card .seg').hidden, ratio: m.radius / 6.371e6, earths: m.gm / 6.6743e-11 / 5.9722e24,
        e: a.physics.orbit(m)?.e ?? -1, d: m.pos.distanceTo(sun.pos), jd: a.clock.jdTdb, history: !document.querySelector('#hud .live-mark .live-undo').hidden,
      };
    });
    const p0 = await placing();
    const inRect = (p, r) => !!p && p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;
    check(on('a planet like Earth is made and waits to be put in place: time waits; the card has its mass, Done and a slider, and says how; the new world is in sight, clear of the card'),
      p0.name === 'Earth 2' && p0.placing && p0.paused && inRect(p0.at, p0.free) && p0.panel && p0.read === '1 Earth' && p0.what === "Rock, the Earth's size" && p0.done >= 44 && p0.slider >= 44 && !p0.seg
        && p0.hint === 'Drag it to where you want it: let go and it goes round in a circle there, or flick it to throw it. Time waits until Done.',
      `at (${p0.at?.x.toFixed(0)}, ${p0.at?.y.toFixed(0)}) in ${p0.free.left.toFixed(0)}-${p0.free.right.toFixed(0)} x ${p0.free.top.toFixed(0)}-${p0.free.bottom.toFixed(0)}; "${p0.read}", "${p0.what}"`);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-placing.png`) });
    // its mass: the knob to 5 Earths
    const box = await page.locator('#hud .card .placing .slider').boundingBox();
    const knob = (s) => ({ x: box.x + 15 + s * (box.width - 30), y: box.y + box.height / 2 });
    const from = knob(Number(await page.locator('#hud .card .placing .slider').inputValue())), to = knob(Math.log(5 / 0.05) / Math.log(10 / 0.05));
    await hand.press(from);
    for (let i = 1; i <= 6; i++) await hand.slide({ x: from.x + ((to.x - from.x) * i) / 6, y: from.y });
    await hand.lift();
    await frames(page, 2);
    const p1 = await placing();
    check(on('its mass set to 5 Earths, it is a rock of the Earth\'s density, 1.71 times the Earth\'s size, still on its circle, and the card says so'),
      /^(4\.9|5|5\.1) Earths$/.test(p1.read) && /^Rock, 1\.7\d times the Earth's size$/.test(p1.what) && Math.abs(p1.earths - 5) < 0.15 && Math.abs(p1.ratio - Math.cbrt(p1.earths)) < 1e-4 && p1.e < 1e-6 && p1.paused && p1.placing,
      `"${p1.read}", "${p1.what}"; ${p1.earths.toFixed(3)} Earths, ${p1.ratio.toFixed(4)} of its radius`);
    // dragged out to 1.3 times as far from the Sun, the finger resting before it lifts
    const out = await page.evaluate(() => {
      const a = window.app, m = a.selection, sun = a.system.sun, V = m.pos.constructor, r = m.pos.clone().sub(sun.pos);
      return { from: a.project(m.upos.sub(a.rig.upos, new V())), to: a.project(sun.upos.sub(a.rig.upos, new V()).add(r.multiplyScalar(1.3))) };
    });
    await hand.drag(out.from, out.to, { steps: 10, rest: 0.3 });
    await frames(page, 2);
    const p2 = await placing();
    check(on('dragged out half as far again and let go: on a circle round the Sun there; time still waits, for Done'),
      Math.abs(p2.d / p0.d - 1.3) < 0.06 && p2.e < 1e-6 && p2.paused && p2.placing && p2.jd === p0.jd, `${(p2.d / p0.d).toFixed(3)} of its distance, e ${p2.e.toExponential(1)}`);
    await press(page, '#hud .card .place-done');
    await frames(page, 2);
    const p3 = await watching(page);
    const left = await page.evaluate(() => {
      const a = window.app, pair = a.slow?.pair;
      return { placing: a.mover.placing, panel: !document.querySelector('#hud .card [data-panel="move"]').hidden, slowed: pair && `${a.slow.phase} for ${pair.map((b) => b.name).join(' and ')}, ${(pair[0].pos.distanceTo(pair[1].pos) / 1e3).toFixed(0)} km apart` };
    });
    check(on('Done: time is as it was before the world was made, and the chip offers to watch what follows'), p3.state === 'offered' && p3.paused === clock0.paused && p3.clock === clock0.rate && p3.chip && p3.start && p3.text === 'See what it does' && !left.placing && !left.panel, `"${p3.text}", ${p3.state}, paused ${p3.paused} (before: ${clock0.paused})${left.slowed ? `; slowed ${left.slowed}` : ''}`);
    await watchIt(page);
    const p3w = await watching(page);
    check(on('tap Watch: time runs, and what follows is watched'), p3w.state === 'watching' && !p3w.paused && p3w.clock === p3w.rate && /^Watching: [\d.]+ (days|hours) a second$/.test(p3w.text), `"${p3w.text}"`);
    // (Undo ends the watch)
    await listen(page);
    await press(page, '#hud .live-mark .live-undo');
    await frames(page, 2);
    const p4 = await page.evaluate(() => { const a = window.app; return { on: a.physics.on, made: a.made.length, found: a.searchItems('Earth 2').length, jd: a.clock.jdTdb }; });
    const said = await heard(page);
    check(on('one Undo takes the new world away, its mass and its place with it: the real Solar System, at the date it was made, and says so'),
      !p4.on && p4.made === 0 && p4.found === 0 && p4.jd === p0.jd && said.includes('Undone: making Earth 2. The real Solar System again'), `"${said.join('" then "')}"`);
    // a second sun, made as light as a star can be: a red dwarf, its size, warmth and light the main sequence's
    await find(page, 'Sun');
    await press(page, '#hud .hud-flight [data-act="stop"]');
    await press(page, '#hud .card [data-power="add"]');
    await press(page, '#hud .card [data-act="add-sun"]');
    await until(page, () => !window.app.glide, null, 60);
    const sbox = await page.locator('#hud .card .placing .slider').boundingBox();
    const sfrom = { x: sbox.x + 15 + Number(await page.locator('#hud .card .placing .slider').inputValue()) * (sbox.width - 30), y: sbox.y + sbox.height / 2 };
    await hand.drag(sfrom, { x: sbox.x + 2, y: sfrom.y }, { steps: 6 });
    await frames(page, 3);
    const dwarf = await page.evaluate(() => {
      const a = window.app, s = a.selection;
      return { name: s.name, read: document.querySelector('#hud .card .placing b').textContent, what: document.querySelector('#hud .card .placing small').textContent, teff: s.teff, absMag: s.absMag, suns: s.gm / a.system.sun.gm, radius: s.radius / 695.7e6, drawn: a.bodies.views.has(s), lit: a.system.brightness(s) };
    });
    check(on('a second sun made as light as a star can be is a red dwarf: smaller, cooler and fainter, as the main sequence has it, and the card says so'),
      dwarf.name === 'Sun 2' && Math.abs(dwarf.suns - 0.08) < 1e-3 && dwarf.teff > 2400 && dwarf.teff < 2700 && Math.abs(dwarf.radius - 0.08 ** 0.8) < 2e-3 && dwarf.lit < 1e-3 && dwarf.drawn
        && /^A star, 0\.13 times the Sun's size, 2,5\d0 K$/.test(dwarf.what) && dwarf.read === '0.08 Suns (83.8 Jupiters)',
      `"${dwarf.read}", "${dwarf.what}"; ${dwarf.teff.toFixed(0)} K, ${dwarf.radius.toFixed(3)} of the Sun's radius, ${dwarf.lit.toExponential(2)} of its light`);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-red-dwarf.png`) });
    // Done, and its mass given later with Mass: ten times, 0.8 Suns. A sun's size, colour and light follow its mass, as when it was made
    await press(page, '#hud .card .place-done');
    await frames(page, 2);
    await slideMass(page, touch, 1);
    const heavier = await page.evaluate(() => {
      const a = window.app, s = a.findByName('Sun 2');
      return { suns: s.gm / a.system.sun.gm, teff: s.teff, radius: s.radius / 695.7e6, absMag: s.absMag, sunMag: 4.831 };
    });
    // (the main sequence at 0.8 Suns: L = M⁴, R = M^0.8, T = T☉ (L / R²)^¼; a made sun's magnitude is the Sun's, 4.831 in
    // src/core/units.ts, brighter or fainter by its light)
    const m = heavier.suns, L = m ** 4, R = m ** 0.8, T = 5772 * (L / (R * R)) ** 0.25;
    check(on('a sun made, its mass changed later with Mass: its size, colour and light follow, as the main sequence has them'),
      Math.abs(m - 0.8) < 0.02 && Math.abs(heavier.radius / R - 1) < 1e-3 && Math.abs(heavier.teff / T - 1) < 1e-3 && Math.abs(heavier.absMag - (heavier.sunMag - 2.5 * Math.log10(L))) < 1e-3,
      `${m.toFixed(3)} Suns: ${heavier.radius.toFixed(4)} of the Sun's radius (${R.toFixed(4)}), ${heavier.teff.toFixed(0)} K (${T.toFixed(0)}), magnitude ${heavier.absMag.toFixed(3)} (${(heavier.sunMag - 2.5 * Math.log10(L)).toFixed(3)})`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ another star's planets: TRAPPIST-1 e (src/universe/PlanetarySim.ts)
  if (want('exo')) {
    const { ctx, page, touch } = await open(kind, 'target=Earth&dist=6');
    // (each step is checked whatever became of the one before: a step that cannot be taken is a failed check, not the end of the suite)
    const step = async (name, fn) => { try { await fn(); } catch (e) { check(on(name), false, String(e).split('\n')[0]); } };
    const hand = await handOf(page, touch);
    await quiet(page);
    await find(page, 'TRAPPIST-1 e');
    await press(page, '#hud .hud-flight [data-act="stop"]');
    // The state of the planet: where it is about its star against where its rail (the archive's orbit) has it at the
    // clock's date, how far from its star, its mass as the powers have it, and live physics.
    const exo = () => page.evaluate(() => {
      // (`powerBody` is the body the powers act on for it: src/app/App.ts; an app without it has none)
      const a = window.app, e = a.findByName('TRAPPIST-1 e'), sys = e.system, b = a.powerBody?.(e, false), V = e.rel.constructor;
      const rail = sys.position(e.spec, a.clock.jdTdb, new V());
      return {
        on: a.physics.on, live: !!sys.live, jd: a.clock.jdTdb, paused: a.clock.paused, off: e.rel.distanceTo(rail), r: e.rel.length(), rail: rail.length(),
        factor: b ? b.gm / a.physics.realGm(b) : 0, radius: e.radius === e.spec.radiusM, star: sys.host.upos.sub(a.powerBody?.(sys.host, false)?.upos ?? sys.host.upos, new V()).length(),
        mark: document.querySelector('#hud .live-mark').hidden ? '' : document.querySelector('#hud .live-what small').textContent, toast: document.querySelector('#hud .hud-toast').textContent,
      };
    });
    // (setup, not a power: the eye high over the plane of TRAPPIST-1's planets, far enough back that e and the place a third
    // further from the star are both in the open, clear of the card, the chips and where the mark of live physics will be)
    await openCard(page);
    const view = await page.evaluate(() => {
      const a = window.app, e = a.findByName('TRAPPIST-1 e'), star = e.system.host, V = e.rel.constructor;
      const walls = [...document.querySelectorAll('#hud .sheet.card, #hud .hud-tabs, #hud .chip, #hud .live-mark, #hud .fab')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
      const open = (p) => !!p && p.x > 36 && p.x < innerWidth - 36 && p.y > 170 && p.y < innerHeight - 36 && walls.every((r) => p.x < r.left - 36 || p.x > r.right + 36 || p.y < r.top - 36 || p.y > r.bottom + 36);
      for (const k of [2.5, 3.5, 5]) for (let az = 0; az < 360; az += 30) {
        a.placeNear(star, k * e.spec.aM, az, 70);
        a.frame();
        const from = a.project(e.upos.sub(a.rig.upos, new V())), to = a.project(star.upos.sub(a.rig.upos, new V()).add(e.rel.clone().multiplyScalar(4 / 3)));
        if (open(from) && open(to)) return { from, to };
      }
      return null;
    });
    await frames(page, 3);
    await page.screenshot({ path: path.join(outDir, `live-${kind}-exo-before.png`) });
    const s0 = await exo();

    await step("TRAPPIST-1 e's card offers Mass, Size, Move and Remove (Add says why not); nothing is live yet", async () => {
      const states = await page.evaluate(() => Object.fromEntries(['[data-power="mass"]', '[data-power="size"]', '[data-act="move"]', '[data-power="add"]', '[data-act="remove"]']
        .map((sel) => [sel.replace(/\[data-(power|act)="|"\]/g, ''), document.querySelector(`#hud .card ${sel}`).getAttribute('aria-disabled') !== 'true'])));
      check(on("TRAPPIST-1 e's card offers Mass, Size, Move and Remove (Add says why not); nothing is live yet"),
        states.mass && states.size && states.move && !states.add && states.remove && !s0.on && s0.off === 0 && !!view, JSON.stringify({ ...states, view: !!view }));
    });

    // Mass: twice as heavy with the slider. The planet does not move for it: it starts from its rail
    await step('Mass: TRAPPIST-1 e twice as heavy; live physics comes on round TRAPPIST-1, and the planet stays on its orbit', async () => {
      await listen(page);
      await slideMass(page, touch, Math.log10(2));
      const s = await exo(), said = await heard(page), read = await text(page, '#hud .card [data-panel="mass"] .power-read b');
      await page.screenshot({ path: path.join(outDir, `live-${kind}-exo-mass.png`) });
      check(on('Mass: TRAPPIST-1 e twice as heavy; live physics comes on round TRAPPIST-1, and the planet stays on its orbit'),
        s.on && s.live && Math.abs(s.factor - 2) < 0.1 && s.jd === s0.jd && s.off < 1 && /TRAPPIST-1/.test(s.mark) && said.some((t) => /Live physics is on round TRAPPIST-1/.test(t)),
        `×${s.factor.toFixed(3)} ("${read}"), ${s.off.toExponential(2)} m off its rail, the mark "${s.mark}"; "${said.join('" then "')}"`);
    });

    await step("Undo: TRAPPIST-1 e's real mass again, exactly on its orbit, and live physics off", async () => {
      await listen(page);
      await press(page, '#hud .live-mark .live-undo');
      await frames(page, 3);
      const s = await exo(), said = await heard(page);
      check(on("Undo: TRAPPIST-1 e's real mass again, exactly on its orbit, and live physics off"),
        !s.on && !s.live && s.factor === 1 && s.off === 0 && s.jd === s0.jd && said.some((t) => t.startsWith("Undone: changing TRAPPIST-1 e's mass. TRAPPIST-1 and its planets are real again")),
        `×${s.factor}, ${s.off} m off its rail, live ${s.on}; "${said.join('" then "')}"`);
    });

    // Move: a finger takes the planet a third further out from its star, in the plane of its orbit
    await step('Move: a finger takes TRAPPIST-1 e a third further from its star; time waits while it is held, and live physics is on', async () => {
      await press(page, '#hud .card [data-act="move"]');
      await frames(page, 3);
      if (!view) throw new Error('no view of TRAPPIST-1 e with room to move it');
      await hand.press(view.from);
      for (let i = 1; i <= 10; i++) await hand.slide({ x: view.from.x + ((view.to.x - view.from.x) * i) / 10, y: view.from.y + ((view.to.y - view.from.y) * i) / 10 });
      await frames(page, 3);
      const held = await exo();
      await hand.lift();
      await frames(page, 3);
      const s = await exo();
      check(on('Move: a finger takes TRAPPIST-1 e a third further from its star; time waits while it is held, and live physics is on'),
        held.on && held.paused && s.on && Math.abs(s.r / s0.r - 4 / 3) < 0.08 && s.off > 0.2 * s0.r,
        `${(s.r / s0.r).toFixed(3)} times as far from its star, ${(s.off / s0.r).toFixed(3)} of its orbit off its rail; held: paused ${held.paused}, live ${held.on}`);
    });

    // time on two days (its orbit takes six), then Back to reality: the rail again, at the moment the first change was made
    await step('Back to reality: TRAPPIST-1 e on its rail again, at the moment the first change was made; live physics off', async () => {
      const moved = await exo();
      if (!moved.on) throw new Error('nothing is live to go back from');
      await rate(page, '1 d/s');
      if (await page.evaluate(() => window.app.clock.paused)) {
        await press(page, '#hud .hud-tabs [data-tab="time"]');
        await press(page, '#hud .transport [data-act="pause"]');
        await press(page, '#hud .sheet.time [data-close]');
      }
      const ran = await until(page, (jd) => window.app.clock.jdTdb > jd + 2, moved.jd, 600);
      await pause(page);
      const later = await exo();
      await listen(page);
      await press(page, '#hud .live-mark .live-back');
      await frames(page, 3);
      const s = await exo(), said = await heard(page);
      await page.screenshot({ path: path.join(outDir, `live-${kind}-exo-reality.png`) });
      check(on('Back to reality: TRAPPIST-1 e on its rail again, at the moment the first change was made; live physics off'),
        ran && later.off > 0.1 * s0.r && !s.on && !s.live && s.off === 0 && s.jd === s0.jd && s.radius && s.star === 0 && said.some((t) => t.startsWith('Back to reality')),
        `ran on ${(later.jd - moved.jd).toFixed(2)} days, then ${(later.off / s0.r).toFixed(3)} of its orbit off its rail; back: ${s.off} m off, ${((s.jd - s0.jd) * 86400).toFixed(3)} s from the first change; "${said.join('" then "')}"`);
    });
    await ctx.close();
  }
}

console.log(errors.length ? `console errors:\n${errors.slice(0, 10).join('\n')}` : 'no console errors');
check('no console errors', errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
