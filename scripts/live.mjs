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
//   - a change watched (the first block; the others switch watching off in More, as they time the physics by the
//     clock): let go of the mass slider, time runs at the pace of what follows for fifteen seconds and the camera
//     eases out until the worlds it matters to fit in what the interface leaves clear, upright and sideways; Stop,
//     and the end of the watch, put the rate of time back; Replay; a finger on the view takes the camera back
//     - Undo, a change at a time, the date with it; "Back to reality" returns to the moment the first change was made
//     and is itself undone by Undo for a moment; the Time sheet's buttons do not move when live physics comes on
// Usage: node scripts/live.mjs [baseUrl] [outDir]   (LIVE_ONLY=watch,sun: those blocks alone; see `want`)
import { collectErrors, launchBrowser } from './lib/browser.mjs';
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
const press = async (page, sel) => { const b = page.locator(sel).first(); await b.scrollIntoViewIfNeeded(); await b.tap().catch(() => b.click()); };
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
async function find(page, name) {
  if (!(await shown(page, '#hud .sheet.explore.on'))) await press(page, '#hud .hud-tabs [data-tab="search"]');
  await page.locator('#hud .searchbox input').fill(name);
  // (a moon and an asteroid may share a name: the first listed is the moon)
  const row = page.locator('#hud .explore .list .row').filter({ has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) }).first();
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
  const box = await page.locator('#hud .card .slider').boundingBox();
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

/** The watch of a change as the app has it, and as its chip shows it. */
const watching = (page) => page.evaluate(() => {
  // (written to report on a build without the watch too, rather than stop: what the checks were first run against)
  const a = window.app, chip = document.querySelector('#hud .hud-watch'), seen = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  return {
    state: a.watch?.state ?? 'none', rate: a.watch?.rate ?? 0, clock: a.clock.rate, paused: a.clock.paused, jd: a.clock.jdTdb, on: a.physics.on,
    chip: seen(chip), text: chip?.querySelector('.watch-text').textContent ?? '', stop: seen(chip?.querySelector('.watch-stop')), replay: seen(chip?.querySelector('.watch-replay')),
  };
});

/** Where a body is from the camera (m), where it is on the screen, and the part of the view the interface leaves clear. */
const framing = (page, name, centre) => page.evaluate(([name, centre]) => {
  const a = window.app, b = a.findByName(name), c = a.findByName(centre), V = b.pos.constructor;
  return { d: c.upos.sub(a.rig.upos, new V()).length(), at: a.project(b.upos.sub(a.rig.upos, new V())), centreAt: a.project(c.upos.sub(a.rig.upos, new V())), free: a.hud.freeArea?.() ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } };
}, [name, centre]);

/** The mass slider of the selected world in sight (its panel opened if it is folded). */
async function massPanel(page) {
  if (!(await shown(page, '#hud .card .slider'))) await press(page, '#hud .card [data-power="mass"]');
  await frames(page, 2);
}

/** The knob of the mass slider dragged from where it is to `value` (the logarithm of the factor), and let go. */
async function slideMass(page, touch, value) {
  await massPanel(page);
  const now = Number(await page.locator('#hud .card .slider').inputValue());
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

/**
 * Changes not watched (More: "Show me what happens", off): for the blocks that time the physics of a power by
 * the clock, where fifteen seconds at a watch's pace would run past what they measure.
 */
async function quiet(page) {
  await press(page, '#hud .hud-tabs [data-tab="more"]');
  if ((await page.locator('#hud .switch[data-act="show-me"]').getAttribute('aria-checked')) === 'true') await press(page, '#hud .switch[data-act="show-me"]');
  await press(page, '#hud .sheet.more [data-close]');
  await frames(page, 2);
}

/** some blocks only, by name (LIVE_ONLY=watch,jupiter: watch, jupiter, sun, moon, made); the rest are left out */
const only = process.env.LIVE_ONLY ?? '';
const want = (name) => !only || only.split(',').includes(name);

for (const kind of ['phone', 'desk']) {
  const on = (name) => `${kind}: ${name}`;

  // ------------------------------------------------------------------ watching a change, Replay, Undo, and the way back
  if (want('watch')) {
    const { ctx, page, touch } = await open(kind, 'target=Jupiter&dist=40');
    const real = await page.evaluate(() => { const a = window.app, io = a.findByName('Io'); return { jd: a.clock.jdTdb, io: io.pos.toArray(), paused: a.clock.paused, rate: a.clock.rate }; });
    // the Time sheet's buttons where they are before anything is changed
    await press(page, '#hud .hud-tabs [data-tab="time"]');
    await frames(page, 2);
    const faster = await page.evaluate(() => { const r = document.querySelector('#hud .transport [data-act="faster"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    await press(page, '#hud .sheet.time [data-close]');
    const before = await framing(page, 'Callisto', 'Jupiter');

    // Jupiter made twenty times heavier, and let go
    await slideMass(page, touch, Math.log10(20));
    const w0 = await watching(page);
    const factor = await page.evaluate(() => window.app.findByName('Jupiter').gm / window.app.physics.realGm(window.app.findByName('Jupiter')));
    check(on('let go of the mass slider, time runs at the pace of what follows, and a chip says so, with Stop'),
      factor > 15 && factor < 27 && w0.state === 'watching' && w0.chip && w0.stop && !w0.paused && w0.clock === w0.rate && /^Watching: [\d.]+ (minutes|hours) a second$/.test(w0.text) && w0.rate > 60 && w0.rate < 3600 * 3,
      `${factor.toFixed(1)} times; "${w0.text}", the clock at ${(w0.clock / 60).toFixed(1)} min/s, paused before: ${real.paused}`);
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

    // the watch ends by itself (phone), or is stopped (desk): the rate of time comes back as it was, and Replay is offered
    let end;
    if (kind === 'phone') {
      await until(page, () => window.app.watch.state !== 'watching', null, 240);
      end = await watching(page);
    } else {
      await press(page, '#hud .hud-watch .watch-stop');
      await frames(page, 2);
      end = await watching(page);
    }
    check(on(`${kind === 'phone' ? 'after fifteen seconds the watch ends' : 'Stop ends the watch'}: time is as it was before (stopped), and the chip offers Replay`),
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
    const undone = await page.evaluate(() => { const a = window.app, io = a.findByName('Io'), j = a.findByName('Jupiter'); return { on: a.physics.on, factor: j.gm / a.physics.realGm(j), jd: a.clock.jdTdb, paused: a.clock.paused, io: io.pos.toArray(), toast: document.querySelector('#hud .hud-toast').textContent, mark: !document.querySelector('#hud .live-mark').hidden, read: document.querySelector('#hud .power-read b').textContent }; });
    check(on('Undo: Jupiter has its real mass, its moons are where the ephemeris has them, at the date before the change, and it says what was undone'),
      !undone.on && undone.factor === 1 && undone.jd === real.jd && undone.paused === real.paused && Math.hypot(...undone.io.map((x, k) => x - real.io[k])) < 1 && /^Undone: changing Jupiter's mass\. The real Solar System again$/.test(undone.toast) && !undone.mark && undone.read === '1 Jupiter',
      `"${undone.toast}"; Io ${Math.hypot(...undone.io.map((x, k) => x - real.io[k])).toFixed(3)} m from where it was`);

    // several steps: twenty times, then Callisto taken away; Undo brings Callisto back with Jupiter still heavy, Undo again the real one
    await slideMass(page, touch, Math.log10(20));
    await press(page, '#hud .hud-watch .watch-stop');
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

    // at a desk, Ctrl+Z undoes; and with "Show me what happens" off, a change is not watched
    if (!touch) {
      await page.keyboard.press('Control+z');
      await frames(page, 2);
      check(on('Ctrl+Z undoes the last change'), await page.evaluate(() => !window.app.physics.on && /^Undone: changing Jupiter's mass/.test(document.querySelector('#hud .hud-toast').textContent)));
    }
    await press(page, '#hud .hud-tabs [data-tab="more"]');
    await press(page, '#hud .switch[data-act="show-me"]');
    await press(page, '#hud .sheet.more [data-close]');
    await find(page, 'Jupiter');
    await press(page, '#hud .hud-flight [data-act="stop"]').catch(() => undefined);
    await massPanel(page);
    const quiet0 = await page.evaluate(() => ({ jd: window.app.clock.jdTdb, rate: window.app.clock.rate, paused: window.app.clock.paused }));
    await slideMass(page, touch, Math.log10(5));
    const quiet = await watching(page);
    check(on('with "Show me what happens" off in More, a change is made and nothing is watched'), quiet.on && quiet.state === 'idle' && !quiet.chip && quiet.paused === quiet0.paused && quiet.clock === quiet0.rate, `${quiet.state}, chip ${quiet.chip}`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ Jupiter, made heavier
  if (want('jupiter')) {
    const { ctx, page, touch } = await open(kind, 'target=Jupiter&dist=40');
    await quiet(page);
    const lay = await page.evaluate(() => {
      const box = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { t: r.top, b: r.bottom, h: r.height, w: r.width }; };
      return { mass: box('#hud .card [data-power="mass"]'), remove: box('#hud .card [data-act="remove"]'), tabs: box('#hud .hud-tabs'), facts: document.querySelector('#hud .card .facts').hidden, H: innerHeight, W: innerWidth };
    });
    check(on("Jupiter's card offers its powers where they are seen at once: Mass and Remove, a thumb high, the details shut"),
      lay.facts && lay.mass.h >= 44 && lay.remove.h >= 44 && lay.mass.w >= 60 && lay.mass.b <= lay.H && (kind === 'desk' || lay.mass.b < lay.tabs.t),
      `buttons ${lay.mass.w.toFixed(0)} x ${lay.mass.h.toFixed(0)} px, down to ${lay.mass.b.toFixed(0)} of ${lay.H}`);
    check(on('nothing is live until a power is used: no mark, no way back to offer'), !(await shown(page, '#hud .live-mark')) && !(await about(page, 'Io', 'Jupiter')).on);

    await press(page, '#hud .card [data-power="mass"]');
    await frames(page, 2);
    check(on('Mass opens a slider at its real mass, said in Jupiters'), (await shown(page, '#hud .card .slider')) && (await text(page, '#hud .power-read b')) === '1 Jupiter' && (await text(page, '#hud .power-read small')) === 'its real mass',
      `${await text(page, '#hud .power-read b')} · ${await text(page, '#hud .power-read small')}`);
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
    const read = await text(page, '#hud .power-read b');
    check(on('with the finger still down physics is live, Jupiter is about twice as heavy and says so, and Io is on a new orbit'),
      held.on && held.factor > 1.6 && held.factor < 2.5 && /^\d(\.\d)? Jupiters$/.test(read) && Math.abs(Number(read.split(' ')[0]) - held.factor) < 0.06 && held.e > 0.3 && before.io.e < 0.02 && (await shown(page, '#hud .live-mark')),
      `${held.factor.toFixed(2)} times, "${read}"; Io's orbit ${before.io.e.toFixed(3)} -> ${held.e.toFixed(2)} from a circle`);
    if (touch) await touch.lift(); else await page.mouse.up();
    await frames(page, 3);
    check(on('it is said that live physics is on, with the way back beside it'), /Live physics is on/.test(await toast(page)) && (await text(page, '#hud .live-what small')) === 'since 1 October 2026' && (await text(page, '#hud .live-back')) === 'Back to reality',
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

    // a simulated world's details: that it is simulated and since when, what it goes round, the orbit it is on now
    await find(page, 'Io');
    await press(page, '#hud .card [data-details]');
    await frames(page, 2);
    const facts = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#hud .card .facts dl div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent])));
    check(on("Io's details say it is simulated and since when, what it goes round and the orbit it is on now"),
      facts['Live physics'] === 'simulated since 1 October 2026' && facts['Goes round'] === 'Jupiter' && /^(an oval|a long oval) \(0\.\d\d\)$/.test(facts["Its orbit's shape"] ?? '') && / km to .* km · \d/.test(facts['Nearest to farthest · once round'] ?? ''),
      `${facts['Live physics']}; round ${facts['Goes round']}; ${facts["Its orbit's shape"]}; ${facts['Nearest to farthest · once round']}`);

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
      /^Now round (Earth|the Sun): .+ \(0(\.\d+)?\), .+ to .+ · .+\.$/.test(held.now) && held.line, `"${held.now}"`);
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
      let_[4] === false && circle.e < 1e-3 && circle.parent === 'Earth' && Math.abs(circle.period / circle.law - 1) < 1e-6 && circle.period / circle.was > 2.4 && circle.period / circle.was < 3.2 && /^Now round Earth: nearly a circle \(0\), /.test(circle.now),
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
    const lay = await page.evaluate(() => [...document.querySelectorAll('#hud .card .card-powers .power')].filter((b) => !b.hidden).map((b) => { const r = b.getBoundingClientRect(); return { label: b.textContent, w: r.width, h: r.height, in: r.left >= 0 && r.right <= innerWidth }; }));
    check(on("the Sun's card offers Add with the other powers, each a thumb high and all in sight"),
      lay.map((b) => b.label).join() === 'Mass,Move,Add,Remove' && lay.every((b) => b.h >= 44 && b.w >= 60 && b.in), lay.map((b) => `${b.label} ${b.w.toFixed(0)} x ${b.h.toFixed(0)}`).join(', '));
    await press(page, '#hud .card [data-power="add"]');
    await frames(page, 2);
    const offers = await page.evaluate(() => [...document.querySelectorAll('#hud .card [data-panel="add"] .row')].filter((r) => !r.hidden && r.getBoundingClientRect().height >= 44).map((r) => r.querySelector('b').textContent));
    check(on('what can be added to a star: a planet like Earth, one like Jupiter, a second sun'), offers.join() === 'A planet like Earth,A planet like Jupiter,A second sun', offers.join(', '));
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
    check(on('it can be changed like any world: its card has Mass, Move, Add and Remove'), made.powers === 'Mass,Move,Add,Remove', made.powers);
    await press(page, '#hud .card [data-power="mass"]');
    await frames(page, 2);
    const mass = await text(page, '#hud .power-read b');
    await press(page, '#hud .card [data-details]');
    await frames(page, 2);
    const facts = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#hud .card .facts dl div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent])));
    check(on('its mass reads 1 Jupiter, and its details say it was made, is simulated, and what it goes round'),
      mass === '1 Jupiter' && facts.Type === 'Planet (made by you)' && facts['Live physics'] === 'simulated since 1 October 2026' && facts['Goes round'] === 'the Sun' && /^nearly a circle/.test(facts["Its orbit's shape"] ?? ''),
      `${mass}; ${facts.Type}; ${facts['Live physics']}; round ${facts['Goes round']}; ${facts["Its orbit's shape"]}`);
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
}

console.log(errors.length ? `console errors:\n${errors.slice(0, 10).join('\n')}` : 'no console errors');
check('no console errors', errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
