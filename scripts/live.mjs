// Live physics and the powers (src/app/LivePhysics.ts, src/app/Powers.ts, src/sim/NBody.ts), on a
// phone with fingers and at a desk with a mouse, in headless Chromium. Every power is used through
// the interface: the buttons on a world's card, the mass slider, the Time sheet, the search.
//   - a world's card offers its powers where they are seen at once; nothing is live until one is used
//   - Jupiter made about twice as heavy with the slider: the orbits answer while the finger is
//     still down, and its moons go round in the time Kepler's law gives for the new mass
//   - a moon that then falls into Jupiter is made one with it, and that is told; the selection
//     and the camera go to Jupiter
//   - what the simulation leaves out is two taps away; time runs backwards too
//   - "Back to reality" puts every body exactly where the ephemeris has it
//   - the Sun taken away: a month later every planet has gone straight on at its orbital speed,
//     the Earth's day side is dark, and its name is still on the sky
//   - a thousand years a second holds a steady frame
// Usage: node scripts/live.mjs [baseUrl] [outDir]
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

async function open(kind, query) {
  const ctx = kind === 'phone' ? await phoneContext(browser) : await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  collectErrors(page, errors);
  await page.goto(`${base}?menu=0&time=${START}&paused=1&${query}`, { waitUntil: 'load' });
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

/** How bright a world's disc is drawn (the display's 0 to 255: its mean, and what a twentieth of it exceeds), over the middle of the disc. */
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
  return { mean: lum.reduce((s, x) => s + x, 0) / lum.length, top: lum[Math.floor(0.95 * lum.length)], px: lum.length };
}, name);

for (const kind of ['phone', 'desk']) {
  const on = (name) => `${kind}: ${name}`;

  // ------------------------------------------------------------------ Jupiter, made heavier
  {
    const { ctx, page, touch } = await open(kind, 'target=Jupiter&dist=40');
    const lay = await page.evaluate(() => {
      const box = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { t: r.top, b: r.bottom, h: r.height, w: r.width }; };
      return { mass: box('#hud .card [data-power="mass"]'), remove: box('#hud .card [data-act="remove"]'), tabs: box('#hud .hud-tabs'), facts: document.querySelector('#hud .card .facts').hidden, H: innerHeight, W: innerWidth };
    });
    check(on("Jupiter's card offers its powers where they are seen at once: Mass and Remove, a thumb high, the details shut"),
      lay.facts && lay.mass.h >= 44 && lay.remove.h >= 44 && lay.mass.w > 80 && lay.mass.b <= lay.H && (kind === 'desk' || lay.mass.b < lay.tabs.t),
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
      return { on: a.physics.on, bodies: a.system.bodies.length, fresh: fresh.bodies.length, off, other, metis: a.findByName('Metis').valid, toast: document.querySelector('#hud .hud-toast').textContent, mark: !document.querySelector('#hud .live-mark').hidden, de: a.system.usingDE };
    });
    check(on('"Back to reality": every body exactly where the ephemeris has it, as the catalogue has it, and the mark is gone'),
      !real.on && !real.mark && real.bodies === real.fresh && real.off === 0 && real.other === 0 && real.metis && real.toast === 'Back to reality' && real.de,
      `${real.bodies} bodies, ${real.off} out of place, ${real.other} otherwise changed; "${real.toast}"`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ the Sun, taken away
  {
    const { ctx, page } = await open(kind, 'target=Earth&dist=6');
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
    check(on("the Earth's day side is dark, and its name is still on the sky"), day.mean > 40 && night.mean < 5 && night.mean < day.mean / 20 && names.includes('Earth'),
      `the disc's mean ${day.mean.toFixed(1)} -> ${night.mean.toFixed(2)} of 255 (${night.px} px; the brightest twentieth above ${night.top.toFixed(1)})`);
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
    check(on('"Back to reality" from beyond the years the ephemeris knows returns to the day it began, and says why; the Sun and the belt are back'),
      !back.on && back.suns === 1 && back.sun && back.belt && back.earth === 'Sun' && back.date === '1 October 2026' && /^Back to reality, on 1 October 2026: where the real planets are is only known from 1849 to 2150$/.test(back.toast),
      `"${back.toast}"; ${back.date}`);
    await ctx.close();
  }
}

console.log(errors.length ? `console errors:\n${errors.slice(0, 10).join('\n')}` : 'no console errors');
check('no console errors', errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
