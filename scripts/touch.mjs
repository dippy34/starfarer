// The app as a phone app, in headless Chromium with real multi-touch (scripts/lib/touch.mjs): the
// layout on an upright and a sideways phone, every gesture on the view, and the interface's flows
// (the card, search, places to go, time, settings, photo mode).
// Usage: node scripts/touch.mjs [baseUrl] [outDir]
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
const W = 390, H = 844;

/** Helpers that run in the page. */
const inPage = () => {
  const a = window.app;
  const V = a.rig.ray(0, 0).constructor;
  window.probe = {
    /** camera from the centre of `name`, in units of its radius, and the height above it in metres */
    from(name) {
      const o = a.findByName(name);
      const d = a.rig.upos.sub(o.upos, new V()).length();
      return { radii: d / o.radius, height: d - o.radius };
    },
    /** where `name` is drawn (CSS px) */
    at(name) {
      const o = a.findByName(name);
      return a.project(o.upos.sub(a.rig.upos, new V()));
    },
    /** the point of the target's surface under a point of the view, from its centre (or null) */
    surface(x, y) {
      const t = a.rig.target, r = a.rig.surface;
      const cam = a.rig.upos.sub(t.upos, new V());
      const dir = a.rig.ray(x, y);
      const b = cam.dot(dir), disc = b * b - (cam.lengthSq() - r * r);
      if (b >= 0 || disc < 0) return null;
      return cam.addScaledVector(dir, -b - Math.sqrt(disc)).toArray();
    },
    /** where a point given from the target's centre is drawn now */
    drawn(p) {
      const t = a.rig.target;
      return a.project(new V(...p).add(t.upos.sub(a.rig.upos, new V())));
    },
    state() {
      const hud = document.getElementById('hud');
      const txt = (s) => hud.querySelector(s)?.textContent ?? '';
      return {
        selection: a.selection?.name ?? null, target: a.rig.target?.name ?? null, flying: a.rig.autopilot,
        sheet: hud.dataset.sheet, place: txt('.place b'), placeDetail: txt('.place small'), card: txt('.card h2'),
        go: txt('.card [data-act="go"] span'), pill: !hud.querySelector('.hud-flight').hidden,
        paused: a.clock.paused, rate: a.clock.rate, labels: a.labels.enabled, orbits: a.orbits.enabled,
        forward: a.rig.forward().toArray(), touchDrag: a.rig.touchDrag,
        // (from the world the camera moves with: that world itself goes round the Sun at 30 km/s)
        cam: (a.rig.anchor ? a.rig.upos.sub(a.rig.anchor.upos, new V()) : a.rig.upos.toVector3()).toArray(),
      };
    },
    /** every control of the interface that can be seen: its box */
    controls() {
      const out = [];
      for (const b of document.querySelectorAll('#hud button, #hud input')) {
        const r = b.getBoundingClientRect();
        const s = getComputedStyle(b);
        if (r.width === 0 || s.visibility === 'hidden' || s.display === 'none') continue;
        out.push({ what: b.getAttribute('aria-label') || b.dataset.act || b.dataset.tab || b.dataset.cat || b.textContent.trim().slice(0, 20), x: r.left, y: r.top, w: r.width, h: r.height });
      }
      return out;
    },
  };
};

async function open(ctx, query) {
  const page = await ctx.newPage();
  collectErrors(page, errors);
  await page.goto(`${base}${query}`, { waitUntil: 'load' });
  return page;
}
const ready = async (page) => {
  await page.waitForFunction(() => window.app && window.app.frameCount > 10, null, { timeout: 600000 });
  await page.evaluate(inPage);
};
const state = (page) => page.evaluate(() => window.probe.state());
const settle = (page) => page.waitForFunction(() => !window.app.rig.autopilot && !window.app.input.gestures.gliding, null, { timeout: 600000 });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const centreOf = async (page, sel) => {
  const r = await page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  return r;
};

// ---------------------------------------------------------------- 1. from the title screen, upright
{
  const ctx = await phoneContext(browser);
  let page = await open(ctx, '');
  await page.waitForFunction(() => window.app?.frameCount > 3 && !!document.querySelector('#start-menu [data-id="sim"]') && !document.getElementById('boot'), null, { timeout: 600000 });
  await page.evaluate(inPage);
  const f = await fingers(page);
  await f.tap(await centreOf(page, '#start-menu [data-id="sim"]'));
  await page.waitForFunction(() => !document.getElementById('start-menu'), null, { timeout: 60000 });
  const coach = await page.evaluate(() => !document.querySelector('.hud-coach').hidden);
  check('first time on a phone: the gestures are explained', coach);
  await page.screenshot({ path: path.join(outDir, 'touch-1-coach.png'), timeout: 300000 });
  await f.tap(await centreOf(page, '.hud-coach [data-coach]'));
  check('"Start exploring" puts the explanation away', await page.evaluate(() => document.querySelector('.hud-coach').hidden));
  await f.frames(3);

  // layout
  const lay = await page.evaluate(() => {
    const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    return {
      scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight, window.innerWidth, window.innerHeight],
      place: box('.chip.place'), clock: box('.chip.clock'), tabs: box('.hud-tabs'), card: box('.sheet.card'),
      earth: window.probe.at('Earth'), radiusPx: Math.asin(1 / window.probe.from('Earth').radii) / window.app.rig.pixelAngle,
      fov: window.app.rig.fovY, touchClass: document.getElementById('hud').classList.contains('touch'),
    };
  });
  check('the page is exactly the screen (nothing to scroll)', lay.scroll[0] <= lay.scroll[2] && lay.scroll[1] <= lay.scroll[3], JSON.stringify(lay.scroll));
  check('the chips are at the top, inside the screen, side by side', lay.place.l >= 0 && lay.clock.r <= W && lay.place.r < lay.clock.l && lay.place.t < 30, JSON.stringify([lay.place, lay.clock]));
  check('the tab bar is at the bottom, the card just above it', lay.tabs.b <= H && lay.tabs.b > H - 20 && lay.card.b <= lay.tabs.t && lay.card.b > lay.tabs.t - 20, JSON.stringify([lay.tabs, lay.card]));
  check('upright, the view opens up (70 degrees) and the Earth fits across with room to spare', Math.abs(lay.fov - 70) < 0.5 && lay.radiusPx * 2 < W * 0.75 && lay.radiusPx * 2 > W * 0.45, `fov ${lay.fov.toFixed(1)}, disc ${(lay.radiusPx * 2).toFixed(0)} px of ${W}`);
  check('the Earth is clear of the chips and the card', lay.earth.y - lay.radiusPx > lay.place.b && lay.earth.y + lay.radiusPx < lay.card.t, JSON.stringify({ earth: lay.earth, r: lay.radiusPx, card: lay.card.t }));
  check('...in the middle of the room they leave', Math.abs(lay.earth.y - (lay.place.b + lay.card.t) / 2) < 6 && Math.abs(lay.earth.x - W / 2) < 1, `at y ${lay.earth.y.toFixed(0)}, room ${lay.place.b.toFixed(0)}..${lay.card.t.toFixed(0)}`);
  const small = (await page.evaluate(() => window.probe.controls())).filter((c) => c.w < 43.5 || c.h < 43.5);
  check('every control is big enough for a finger (44 px)', small.length === 0, JSON.stringify(small));
  check('the interface speaks of fingers', lay.touchClass);
  await page.screenshot({ path: path.join(outDir, 'touch-2-start.png'), timeout: 300000 });

  // a second visit does not explain again
  await page.close();
  page = await open(ctx, '');
  await page.waitForFunction(() => window.app?.frameCount > 3 && !!document.querySelector('#start-menu [data-id="sim"]') && !document.getElementById('boot'), null, { timeout: 600000 });
  await page.evaluate(() => document.querySelector('#start-menu [data-id="sim"]').click());
  await page.waitForFunction(() => !document.getElementById('start-menu'), null, { timeout: 60000 });
  check('the explanation is shown only once', await page.evaluate(() => document.querySelector('.hud-coach').hidden));
  await page.close();
  await ctx.close();
}

// ---------------------------------------------------------------- 2. gestures on the view
{
  const ctx = await phoneContext(browser);
  const page = await open(ctx, '?menu=0&time=2026-10-01T20:00:00Z');
  await ready(page);
  const f = await fingers(page);
  const mid = { x: W / 2, y: 330 };
  const earth0 = await page.evaluate(() => window.probe.at('Earth'));

  // one finger: the surface goes with it
  let from = { x: earth0.x - 30, y: earth0.y + 10 }, to = { x: earth0.x + 40, y: earth0.y - 35 };
  let held = await page.evaluate((p) => window.probe.surface(p.x, p.y), from);
  let before = await page.evaluate(() => window.probe.from('Earth'));
  await f.drag(from, to);
  let now = await page.evaluate((p) => ({ px: window.probe.drawn(p), from: window.probe.from('Earth'), earth: window.probe.at('Earth') }), held);
  // (the first pixels of a touch are its tap allowance: the drag starts just after them)
  check('one finger: the point of the Earth under it goes where it goes', Math.hypot(now.px.x - to.x, now.px.y - to.y) < 14, JSON.stringify(now.px));
  check('...round the Earth: same distance, the Earth stays where it was in the view', Math.abs(now.from.radii - before.radii) < 1e-9 && Math.hypot(now.earth.x - earth0.x, now.earth.y - earth0.y) < 0.01, JSON.stringify(now.from));

  // pinch
  await f.pinch(earth0, 120, 240);
  let after = await page.evaluate(() => window.probe.from('Earth'));
  check('spreading two fingers comes closer by their spread', after.height / before.height > 0.45 && after.height / before.height < 0.62, `height x${(after.height / before.height).toFixed(3)}`);
  await f.pinch(earth0, 240, 120);
  const back = await page.evaluate(() => window.probe.from('Earth'));
  check('pinching in goes back out', back.height / after.height > 1.6 && back.height / after.height < 2.2, `height x${(back.height / after.height).toFixed(3)}`);

  // pinch away from the middle: what is under the fingers stays under them
  const off = { x: earth0.x + 50, y: earth0.y - 40 };
  held = await page.evaluate((p) => window.probe.surface(p.x, p.y), off);
  await f.pinch(off, 100, 200);
  now = await page.evaluate((p) => window.probe.drawn(p), held);
  check('a pinch keeps what is between the fingers between them', Math.hypot(now.x - off.x, now.y - off.y) < 6, JSON.stringify(now));
  await f.pinch(off, 200, 100);

  // two fingers together: look
  let s0 = await state(page);
  await f.dragTwo({ x: mid.x, y: 300 }, { x: mid.x - 60, y: 400 });
  let s1 = await state(page);
  const turned = Math.acos(Math.min(1, s0.forward[0] * s1.forward[0] + s0.forward[1] * s1.forward[1] + s0.forward[2] * s1.forward[2]));
  check('two fingers together look around without moving', dist(s0.cam, s1.cam) < 1e-3 && turned > 0.05, `turned ${(turned * 57.3).toFixed(1)} deg`);
  await page.evaluate(() => window.app.act('home'));
  await f.frames(2);

  // twist: roll
  const upBefore = await page.evaluate(() => window.app.rig.up().toArray());
  await f.pinch(earth0, 180, 180, { turn: 0.8 });
  const upAfter = await page.evaluate(() => window.app.rig.up().toArray());
  const rolled = Math.acos(Math.min(1, upBefore[0] * upAfter[0] + upBefore[1] * upAfter[1] + upBefore[2] * upAfter[2]));
  check('a twist rolls the view (beyond its dead zone)', rolled > 0.4 && rolled < 0.7, `rolled ${(rolled * 57.3).toFixed(1)} deg`);

  // a flick glides on
  s0 = await state(page);
  await f.drag({ x: earth0.x - 60, y: earth0.y }, { x: earth0.x + 60, y: earth0.y }, { steps: 6, rest: 0 });
  const gliding = await page.evaluate(() => window.app.input.gestures.gliding);
  s1 = await state(page);
  await settle(page);
  const s2 = await state(page);
  check('a flick keeps the globe turning, then it comes to rest', gliding && dist(s1.cam, s2.cam) > 1e3 && dist(s0.cam, s1.cam) > 1e3, `glided ${(dist(s1.cam, s2.cam) / 1e3).toFixed(0)} km`);

  // taps: select, by the dot and by the name; the camera stays with the Earth
  await page.evaluate(() => { const a = window.app; a.act('home'); a.center(a.findByName('Moon')); });
  await f.frames(3);
  const moon = await page.evaluate(() => window.probe.at('Moon'));
  await f.tap({ x: moon.x + 6, y: moon.y + 5 });
  await f.frames(2);
  let st = await state(page);
  check('a tap selects (a finger off the dot still finds it)', st.selection === 'Moon' && st.card === 'Moon' && st.go === 'Go there', JSON.stringify([st.selection, st.card, st.go]));
  check('...and the camera stays with the Earth until told to go', st.target === 'Earth' && st.place === 'Earth');
  // (a spot with nothing within a finger's reach: the sky is full of stars)
  const empty = await page.evaluate(() => {
    for (let y = 120; y < 560; y += 20) for (let x = 30; x < 360; x += 20) if (!window.app.pickAt(x, y, true)) return { x, y };
    return null;
  });
  if (empty) await f.tap(empty);
  await f.frames(2);
  st = await state(page);
  const nothing = !!empty && st.selection === null;
  const label = await page.evaluate(() => { const l = [...document.querySelectorAll('#labels .label')].find((x) => x.textContent === 'Moon' && x.style.display !== 'none'); const r = l?.getBoundingClientRect(); return r ? { x: r.left + r.width * 0.7, y: r.top + r.height / 2 } : null; });
  if (label) await f.tap(label);
  await f.frames(2);
  st = await state(page);
  check('a tap on empty sky lets go, a tap on a name selects what it names', nothing && !!label && st.selection === 'Moon', JSON.stringify({ nothing, label, sel: st.selection }));
  await page.screenshot({ path: path.join(outDir, 'touch-3-selected.png'), timeout: 300000 });

  // double tap: fly there
  f.wait(1);
  await f.doubleTap({ x: moon.x, y: moon.y });
  await f.frames(2);
  st = await state(page);
  check('a double tap flies there (the flight is shown, with a way to stop)', st.flying && st.pill && st.target === 'Moon', JSON.stringify([st.flying, st.pill, st.target]));
  await page.screenshot({ path: path.join(outDir, 'touch-4-flying.png'), timeout: 300000 });
  await settle(page);
  await f.frames(2);
  st = await state(page);
  const atMoon = await page.evaluate(() => ({ from: window.probe.from('Moon'), r: Math.asin(1 / window.probe.from('Moon').radii) / window.app.rig.pixelAngle }));
  check('arrived: the Moon framed for the upright screen, "Recentre" on its card', !st.pill && st.go === 'Recentre' && atMoon.r * 2 < W * 0.75 && atMoon.r * 2 > W * 0.45, `disc ${(atMoon.r * 2).toFixed(0)} px`);

  // all the way down by pinching, then look up: a level horizon
  for (let i = 0; i < 16; i++) await f.pinch(mid, 60, 330, { steps: 6 });
  await f.frames(3);
  const low = await page.evaluate(() => ({ alt: window.app.rig.altitude, closest: window.app.rig.closest - window.app.rig.surface, place: document.querySelector('.place small').textContent }));
  check('pinching goes all the way down to the ground', low.alt < 3 && low.alt > 1, JSON.stringify(low));
  // the Moon turns: with hours passing in a moment, the same ground stays under the camera
  const standing = () => page.evaluate(() => { const a = window.app; return { dir: a.terrain.below(a.rig.upos).dir.toArray(), alt: a.rig.altitude }; });
  const g0 = await standing();
  await page.evaluate(() => { window.app.clock.rate = 3600; });
  await f.frames(5);
  await page.evaluate(() => { window.app.clock.rate = 1; });
  await f.frames(1);
  const g1 = await standing();
  const slid = Math.acos(Math.min(1, g0.dir[0] * g1.dir[0] + g0.dir[1] * g1.dir[1] + g0.dir[2] * g1.dir[2])) * 1.7374e6;
  check('standing on the Moon the camera turns with it: the ground stays put while hours pass', slid < 0.05 && g1.alt < 3, `slid ${slid.toFixed(3)} m`);
  for (let i = 0; i < 4; i++) await f.dragTwo({ x: mid.x, y: 250 }, { x: mid.x, y: 560 }, { steps: 4 });
  await f.dragTwo({ x: mid.x - 50, y: 400 }, { x: mid.x + 60, y: 380 }, { steps: 4 });
  const horizon = await page.evaluate(() => { const r = window.app.rig; return { tilt: Math.abs(r.right().dot(r.vertical)), elevation: Math.asin(r.forward().dot(r.vertical)), alt: r.altitude }; });
  check('on the ground two fingers tilt the view up to a level horizon', horizon.tilt < 1e-6 && horizon.elevation > -0.6 && horizon.alt < 3, JSON.stringify(horizon));
  await f.frames(4);
  await page.screenshot({ path: path.join(outDir, 'touch-5-ground.png'), timeout: 300000 });

  // and back up: a pinch the other way leaves the ground, and stays up
  await f.pinch(mid, 330, 60, { steps: 6 });
  await f.pinch(mid, 330, 60, { steps: 6 });
  const up1 = await page.evaluate(() => window.app.rig.altitude);
  f.wait(2);
  await page.waitForTimeout(2500);
  await f.frames(3);
  const up2 = await page.evaluate(() => window.app.rig.altitude);
  check('pinching the other way lifts off again, and the camera stays up', up1 > 8 && up2 > up1 * 0.98, `${up1.toFixed(1)} m, then ${up2.toFixed(1)} m`);

  // a double tap on the world the camera is at: closer to the tapped spot
  await page.evaluate(() => window.app.goTo(window.app.findByName('Moon')));
  await settle(page);
  await f.frames(2);
  const far = await page.evaluate(() => window.probe.from('Moon'));
  const spot = { x: mid.x + 30, y: 400 };
  held = await page.evaluate((p) => window.probe.surface(p.x, p.y), spot);
  f.wait(1);
  await f.doubleTap(spot);
  await page.waitForTimeout(1200);
  await f.frames(3);
  const near = await page.evaluate((p) => ({ from: window.probe.from('Moon'), px: window.probe.drawn(p), flying: window.app.rig.autopilot }), held);
  check('a double tap on the world you are at comes six times closer to that spot', !near.flying && Math.abs(far.height / near.from.height - 6) < 0.05 && Math.hypot(near.px.x - spot.x, near.px.y - spot.y) < 3, JSON.stringify({ ratio: far.height / near.from.height, px: near.px }));

  // one finger set to look
  await page.evaluate(() => window.app.goTo(window.app.findByName('Moon')));
  await settle(page);
  await f.tap(await centreOf(page, '.look-fab'));
  s0 = await state(page);
  await f.drag({ x: mid.x, y: 300 }, { x: mid.x + 70, y: 340 });
  s1 = await state(page);
  check('set to "Look", one finger looks around instead', s0.touchDrag === 'look' && dist(s0.cam, s1.cam) < 1e-3 && Math.abs(s0.forward[0] - s1.forward[0]) + Math.abs(s0.forward[1] - s1.forward[1]) > 0.02);
  await f.tap(await centreOf(page, '.look-fab'));
  await page.close();
  await ctx.close();
}

// ---------------------------------------------------------------- 3. the interface
{
  const ctx = await phoneContext(browser);
  const page = await open(ctx, '?menu=0&time=2026-10-01T20:00:00Z');
  await ready(page);
  const f = await fingers(page);
  const tapOn = async (sel) => { await f.tap(await centreOf(page, sel)); await f.frames(1); };

  // the card
  await tapOn('.card [data-details]');
  let facts = await page.evaluate(() => [...document.querySelectorAll('.card .facts dt')].map((d) => d.textContent));
  check('Details unfolds the facts of what is selected', facts.includes('Radius') && facts.includes('Distance') && facts.length > 5, facts.join(', '));
  await page.screenshot({ path: path.join(outDir, 'touch-6-details.png'), timeout: 300000 });
  // another body's facts open at their top, not where the last one's were scrolled to (playtest D2:
  // the Moon's opened scrolled down, its Distance out of sight)
  {
    const down = await page.evaluate(() => { const f = document.querySelector('.card .facts'); f.scrollTop = f.scrollHeight; return f.scrollTop; });
    await page.evaluate(() => window.app.select(window.app.findByName('Moon')));
    await f.frames(2);
    await tapOn('.card [data-details]');
    const top = await page.evaluate(() => ({ name: document.querySelector('.card h2').textContent, scroll: document.querySelector('.card .facts').scrollTop }));
    check("another body's facts open at their top", down > 50 && top.name === 'Moon' && top.scroll === 0, JSON.stringify({ down, ...top }));
  }
  await tapOn('.card [data-act="deselect"]');
  let st = await state(page);
  check('the card closes with its cross', st.selection === null && st.sheet === 'none');

  // places to go
  await tapOn('.hud-tabs [data-tab="explore"]');
  let rows = await page.evaluate(() => [...document.querySelectorAll('.explore .row b')].map((b) => b.textContent));
  st = await state(page);
  // (walking works by touch now: the tour offers the walk at Apollo 17 on a phone too)
  check('Explore opens the tour, with the walk on the Moon', st.sheet === 'explore' && rows.includes('Olympus Mons') && rows.includes('Walk on the Moon at Apollo 17'), rows.slice(0, 4).join(', '));
  await page.screenshot({ path: path.join(outDir, 'touch-7-explore.png'), timeout: 300000 });
  await tapOn('.cats [data-cat="solar"]');
  rows = await page.evaluate(() => [...document.querySelectorAll('.explore .row')].map((b) => ({ name: b.querySelector('b').textContent, photo: b.querySelector('.thumb').classList.contains('photo') })));
  check('the Solar System section lists the planets with their pictures', rows.some((r) => r.name === 'Mars' && r.photo) && rows.length >= 10, rows.map((r) => r.name).join(', '));
  const marsRow = await page.evaluate(() => { const b = [...document.querySelectorAll('.explore .row')].find((x) => x.querySelector('b').textContent === 'Mars'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await f.tap(marsRow);
  await f.frames(2);
  st = await state(page);
  check('choosing a place closes the sheet and flies there', st.sheet === 'card' && st.selection === 'Mars' && st.flying && st.pill, JSON.stringify([st.sheet, st.selection, st.flying]));
  await tapOn('.hud-flight [data-act="stop"]');
  st = await state(page);
  check('Stop ends the flight, in open space', !st.flying && st.target === null && !st.pill && /space|Near/.test(st.place), st.place);

  // search
  await tapOn('.hud-tabs [data-tab="search"]');
  const focused = await page.evaluate(() => document.activeElement === document.querySelector('.searchbox input'));
  await page.keyboard.type('sirius');
  await f.frames(1);
  rows = await page.evaluate(() => [...document.querySelectorAll('.explore .row b')].map((b) => b.textContent));
  const typing = await page.evaluate(() => { const r = document.querySelector('.sheet.explore').getBoundingClientRect(); return { top: r.top, cls: document.querySelector('.sheet.explore').classList.contains('typing') }; });
  check('Search is ready to type, at the top of the screen (clear of the keyboard)', focused && typing.cls && typing.top < 60, JSON.stringify(typing));
  check('typing finds it', rows[0] === 'Sirius', rows.slice(0, 3).join(', '));
  await page.screenshot({ path: path.join(outDir, 'touch-8-search.png'), timeout: 300000 });
  await tapOn('.explore .row');
  st = await state(page);
  check('a result is chosen with a tap', st.selection === 'Sirius' && st.flying && st.sheet === 'card', JSON.stringify([st.selection, st.flying, st.sheet]));
  await page.evaluate(() => window.app.rig.cancelGoto());

  // time
  await tapOn('.chip.clock');
  st = await state(page);
  const timeOpen = st.sheet === 'time';
  await tapOn('.transport [data-act="pause"]');
  const paused = (await state(page)).paused;
  await tapOn('.transport [data-act="pause"]');
  await tapOn('.transport [data-act="faster"]');
  await tapOn('.transport [data-act="faster"]');
  const fast = (await state(page)).rate;
  await tapOn('.transport [data-act="reverse"]');
  const rev = (await state(page)).rate;
  await f.frames(2);
  await page.screenshot({ path: path.join(outDir, 'touch-9-time.png'), timeout: 300000 });
  await tapOn('.transport [data-act="now"]');
  st = await state(page);
  const nowOk = await page.evaluate(() => Math.abs((window.app.clock.jdTdb - 2440587.5) * 86400e3 - Date.now()) < 120e3);
  check('the clock chip opens Time; pause, faster, reverse and now do what they say', timeOpen && paused && fast === 60 && rev === -60 && st.rate === 1 && !st.paused && nowOk, JSON.stringify({ timeOpen, paused, fast, rev, rate: st.rate, nowOk }));

  // a sheet is pulled down to close
  const grab = await centreOf(page, '.sheet.time .sheet-grab');
  await f.drag(grab, { x: grab.x, y: grab.y + 140 }, { steps: 5 });
  await f.frames(1);
  check('a sheet is pulled down by its handle to close it', (await state(page)).sheet !== 'time');

  // settings
  await tapOn('.hud-tabs [data-tab="more"]');
  await tapOn('.more [data-act="labels"]');
  await tapOn('.more [data-act="orbits"]');
  st = await state(page);
  const sw = await page.evaluate(() => [...document.querySelectorAll('.more .switch')].map((b) => `${b.dataset.act}:${b.getAttribute('aria-checked')}`).join(' '));
  check('the switches turn names and orbits off, and show it', !st.labels && !st.orbits && /labels:false/.test(sw) && /orbits:false/.test(sw), sw);
  await page.screenshot({ path: path.join(outDir, 'touch-10-more.png'), timeout: 300000 });
  await tapOn('.more [data-act="labels"]');
  await tapOn('.more [data-act="orbits"]');
  const photoRow = await page.evaluate(() => { const b = document.querySelector('.more [data-act="photo"]'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await f.tap(photoRow);
  await f.frames(2);
  const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('.hud-dock')).visibility === 'hidden' && getComputedStyle(document.querySelector('.hud-top')).visibility === 'hidden' && !window.app.labels.enabled);
  await f.tap({ x: W / 2, y: 300 });
  await f.frames(2);
  const shown = await page.evaluate(() => getComputedStyle(document.querySelector('.hud-dock')).visibility !== 'hidden' && window.app.labels.enabled && !window.app.photoMode);
  check('photo mode hides everything; a tap brings it back', hidden && shown, JSON.stringify({ hidden, shown }));
  // Save a picture: the picture is downloaded, the sheet gets out of the way, and it is said where the picture went,
  // still to be read three seconds on (playtest D5: "no feedback")
  {
    await tapOn('.hud-tabs [data-tab="more"]');
    const row = await page.evaluate(() => { const b = document.querySelector('.more [data-act="screenshot"]'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const download = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
    await f.tap(row);
    const file = (await download)?.suggestedFilename() ?? null;
    await page.waitForTimeout(3000);
    const after = await page.evaluate(() => { const t = document.querySelector('.hud-toast'); return { toast: t.classList.contains('show') ? t.textContent : null }; });
    st = await state(page);
    check('Save a picture downloads it, closes the sheet and says where it went', !!file && /\.png$/.test(file) && st.sheet !== 'more' && !!after.toast && after.toast.includes('downloads') && after.toast.includes(file), JSON.stringify({ file, sheet: st.sheet, ...after }));
    await page.screenshot({ path: path.join(outDir, 'touch-10b-saved.png'), timeout: 300000 });
  }
  await page.close();
  await ctx.close();
}

// ---------------------------------------------------------------- 4. sideways
{
  const ctx = await phoneContext(browser, { landscape: true });
  const page = await open(ctx, '?menu=0&time=2026-10-01T20:00:00Z');
  await ready(page);
  const f = await fingers(page);
  await page.evaluate(() => { const a = window.app; a.select(a.findByName('Mars')); a.goTo(a.selection); });
  await f.frames(2);
  const lay = await page.evaluate(() => {
    const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    return { tabs: box('.hud-tabs'), card: box('.sheet.card'), pill: box('.hud-flight'), place: box('.chip.place'), fab: box('.look-fab'), fov: window.app.rig.fovY, w: window.innerWidth, h: window.innerHeight };
  });
  const apart = (a, b) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
  check('sideways: the tab bar stands at the left edge, the card beside it', lay.tabs.l < 20 && lay.tabs.r < 100 && lay.card.l >= lay.tabs.r && lay.card.b <= lay.h && lay.card.r < lay.w * 0.6, JSON.stringify([lay.tabs, lay.card]));
  check('sideways: nothing overlaps (chips, tabs, card, flight, round button)', apart(lay.tabs, lay.place) && apart(lay.card, lay.place) && apart(lay.pill, lay.card) && apart(lay.pill, lay.place) && apart(lay.fab, lay.card), JSON.stringify(lay));
  check('sideways: the usual field of view', lay.fov === 50);
  const small = (await page.evaluate(() => window.probe.controls())).filter((c) => c.w < 43.5 || c.h < 43.5);
  check('sideways: every control is big enough for a finger', small.length === 0, JSON.stringify(small));
  await page.screenshot({ path: path.join(outDir, 'touch-11-sideways.png'), timeout: 300000 });
  await settle(page);
  await f.tap(await centreOf(page, '.hud-tabs [data-tab="explore"]'));
  await f.frames(2);
  const sheet = await page.evaluate(() => { const r = document.querySelector('.sheet.explore').getBoundingClientRect(); return { t: r.top, b: r.bottom, h: window.innerHeight, rows: document.querySelectorAll('.explore .row').length }; });
  check('sideways: a sheet fits the height and scrolls inside', sheet.t >= 0 && sheet.b <= sheet.h && sheet.rows > 5, JSON.stringify(sheet));
  await page.screenshot({ path: path.join(outDir, 'touch-12-sideways-explore.png'), timeout: 300000 });
  await page.close();
  await ctx.close();
}

// ---------------------------------------------------------------- 5. sideways: the view's optical centre
// On a phone on its side the view's optical centre (what is straight ahead, and where the camera holds
// what is selected) is the middle of the part of the screen the interface leaves clear (App's `centre`,
// Hud.clearPart; the camera's `setViewOffset`). Everything that works from a screen position has to
// agree with what is drawn: where a world is on the screen, the ray under a finger, a tap picking it, its
// name, the picture a screenshot saves, and a black hole's disk; and photo mode, which puts the
// interface away, brings the centre back to the middle.
{
  const ctx = await phoneContext(browser, { landscape: true, scale: 1 });
  const page = await open(ctx, '?menu=0&time=2026-10-01T20:00:00Z&target=Mars&dist=60');
  await ready(page);
  const f = await fingers(page);
  await page.evaluate(() => { document.querySelector('.hud-coach [data-coach]')?.click(); });
  await page.waitForFunction(() => Math.abs(window.app.view.cx) > 30 || Math.abs(window.app.view.cy) > 30, null, { timeout: 120000 });
  await f.frames(20);
  /** the mean light (0..255) of the screen's picture (the screenshot a player saves) in a square of `r` px about each point */
  const lum = (pts) => page.evaluate(async (pts) => {
    const img = new Image();
    img.src = window.app.renderer.screenshot();
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const k = img.width / window.innerWidth;
    return pts.map(([x, y, r]) => {
      const d = g.getImageData(Math.max(0, Math.round((x - r) * k)), Math.max(0, Math.round((y - r) * k)), Math.max(1, Math.round(2 * r * k)), Math.max(1, Math.round(2 * r * k))).data;
      let t = 0;
      for (let i = 0; i < d.length; i += 4) t += d[i] + d[i + 1] + d[i + 2];
      return t / (d.length / 4) / 3;
    });
  }, pts);
  const view = () => page.evaluate(() => {
    const a = window.app, mars = a.findByName('Mars'), rel = mars.upos.sub(a.rig.upos);
    const p = a.project(rel), covers = a.hud.covers();
    const part = a.hud.clearPart?.();
    const W = window.innerWidth, H = window.innerHeight;
    // the ray under the optical centre is straight ahead, and under Mars's pixel it is the way to Mars
    const ahead = a.rig.forward(), toMars = rel.clone().normalize();
    const r1 = a.rig.ray(W / 2 + a.view.cx, H / 2 + a.view.cy), r2 = p ? a.rig.ray(p.x, p.y) : null;
    // projecting what the ray under a pixel looks along comes back to the pixel
    const back = [[40, 30], [700, 60], [300, 300], [W - 5, H - 5]].map(([x, y]) => { const q = a.project(a.rig.ray(x, y).multiplyScalar(1e9)); return q ? Math.hypot(q.x - x, q.y - y) : 1e9; });
    return {
      W, H, cx: a.view.cx, cy: a.view.cy, p, under: p ? covers.filter((c) => p.x >= c.l && p.x <= c.r && p.y >= c.t && p.y <= c.b).length : -1,
      box: part && part.box, rig: { x: a.rig.centre.x, y: a.rig.centre.y },
      aheadErr: r1.angleTo(ahead), marsErr: r2 ? r2.angleTo(toMars) : 1, backErr: Math.max(...back),
      label: a.labels.shown.filter((s) => s.c?.key?.includes('499') || /Mars/.test(s.c?.name ?? '')).map((s) => ({ x: s.ox, y: s.oy })),
    };
  });
  let v = await view();
  check('sideways, a card open: the view\'s centre is off the middle, to the clear part (the camera\'s window, the rig\'s and the app\'s agree)',
    Math.hypot(v.cx, v.cy) > 40 && v.rig.x === v.cx && v.rig.y === v.cy && !!v.box, JSON.stringify(v));
  check('...Mars, selected and aimed at, is at the centre of that clear part: on the screen, under no part of the interface', !!v.p && v.p.x > 0 && v.p.x < v.W && v.p.y > 0 && v.p.y < v.H && v.under === 0
    && v.p.x > v.box.l && v.p.x < v.box.r && v.p.y > v.box.t && v.p.y < v.box.b, JSON.stringify({ p: v.p, box: v.box, under: v.under }));
  check('...the ray under the centre is straight ahead, the ray under Mars\'s pixel is the way to Mars, and the screen and the rays agree everywhere (under 0.05 px)',
    v.aheadErr < 1e-6 && v.marsErr < 1e-5 && v.backErr < 0.05, JSON.stringify({ a: v.aheadErr, m: v.marsErr, b: v.backErr }));
  // what is drawn: Mars's disc (7 px across) is lit where it is projected, and not where the screen's middle is
  const mid = [v.W / 2, v.H / 2, 3];
  let [onMars, atMiddle] = await lum([[v.p.x, v.p.y, 3], mid]);
  check('...and Mars is drawn there (the screenshot is lit at its pixel, dark at the middle of the screen)', onMars > 30 && onMars > 3 * atMiddle, JSON.stringify({ onMars, atMiddle }));
  check('...its name is laid by it', v.label.length > 0 && v.label.every((l) => Math.hypot(l.x - v.p.x, l.y - v.p.y) < 3), JSON.stringify({ label: v.label, p: v.p }));
  await page.screenshot({ path: path.join(outDir, 'touch-13-sideways-centre.png'), timeout: 300000 });
  // a tap on it picks it: another world selected, then a finger on Mars's pixel
  await page.evaluate(() => { const a = window.app; a.select(a.findByName('Jupiter')); });
  await f.frames(3);
  const before = await page.evaluate(() => window.app.selection?.name);
  await f.tap({ x: v.p.x, y: v.p.y });
  const after = await page.evaluate(() => window.app.selection?.name);
  check('a tap on Mars where it is drawn picks it', before === 'Jupiter' && after === 'Mars', JSON.stringify({ before, after }));
  // photo mode puts the interface away: the centre is the middle again, and Mars is there; a tap brings it all back
  await page.evaluate(() => window.app.act('photo'));
  await page.waitForFunction(() => Math.abs(window.app.view.cx) < 1 && Math.abs(window.app.view.cy) < 1, null, { timeout: 60000 });
  await f.frames(3);
  const photo = await view();
  [onMars, atMiddle] = await lum([[photo.p.x, photo.p.y, 3], [photo.W / 2 - 150, photo.H / 2 - 100, 3]]);
  check('photo mode: the centre is the middle of the screen, and Mars is drawn where it is projected', photo.cx === 0 && photo.cy === 0 && Math.abs(photo.p.x - photo.W / 2) < 2 && onMars > 30 && onMars > 3 * atMiddle, JSON.stringify({ photo: photo.p, onMars, atMiddle }));
  await page.evaluate(() => window.app.act('photo'));
  await page.waitForFunction(() => Math.abs(window.app.view.cx) > 30 || Math.abs(window.app.view.cy) > 30, null, { timeout: 60000 });
  const back = await page.evaluate(() => ({ cx: window.app.view.cx, cy: window.app.view.cy }));
  check('...and leaving photo mode eases the centre back to the clear part', Math.abs(back.cx - v.cx) < 3 && Math.abs(back.cy - v.cy) < 3 || Math.hypot(back.cx, back.cy) > 30, JSON.stringify({ back, was: [v.cx, v.cy] }));
  await page.close();

  // a black hole: its disk is drawn where it is projected
  const hole = await open(ctx, '?menu=0&time=2026-10-01T20:00:00Z&target=Cygnus%20X-1&dist=40');
  await ready(hole);
  await hole.evaluate(() => { document.querySelector('.hud-coach [data-coach]')?.click(); });
  await hole.waitForFunction(() => Math.abs(window.app.view.cx) > 30 || Math.abs(window.app.view.cy) > 30, null, { timeout: 120000 });
  const hf = await fingers(hole);
  await hf.frames(30);
  const h = await hole.evaluate(() => {
    const a = window.app, e = a.selection, p = a.project(e.upos.sub(a.rig.upos)), W = window.innerWidth, H = window.innerHeight;
    return { name: e?.name, p, W, H, cx: a.view.cx, cy: a.view.cy };
  });
  const lumH = await hole.evaluate(async (h) => {
    const img = new Image();
    img.src = window.app.renderer.screenshot();
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const k = img.width / window.innerWidth;
    // the brightest 4 px square within 60 px of the projected centre, against the same where the middle of the screen is
    const best = (x0, y0) => { let m = 0; for (let y = y0 - 60; y <= y0 + 60; y += 6) for (let x = x0 - 60; x <= x0 + 60; x += 6) { const d = g.getImageData(Math.round(Math.max(0, x) * k), Math.round(Math.max(0, y) * k), 4, 4).data; m = Math.max(m, (d[0] + d[1] + d[2]) / 3); } return m; };
    return { at: best(h.p.x, h.p.y), middle: best(h.W / 2 - 130, h.H / 2 + 100) };
  }, h);
  check('a black hole\'s disk is drawn where it is projected, with the centre off the middle', Math.hypot(h.cx, h.cy) > 40 && lumH.at > 40 && lumH.at > 2 * lumH.middle, JSON.stringify({ h, lumH }));
  await hole.screenshot({ path: path.join(outDir, 'touch-14-sideways-hole.png'), timeout: 300000 });
  await hole.close();
  await ctx.close();
}

console.log(errors.length ? `console errors:\n${errors.slice(0, 10).join('\n')}` : 'no console errors');
check('no console errors', errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
