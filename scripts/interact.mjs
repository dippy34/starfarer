// Drives the running app in headless Chromium and checks interactive behaviour.
// Usage: node scripts/interact.mjs [baseUrl] [outDir]
import { collectErrors, launchBrowser, openCard } from './lib/browser.mjs';
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
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

await page.goto(`${base}?time=2026-10-01T20:00:00Z`, { waitUntil: 'load' });
await page.waitForFunction(() => window.app && window.app.frameCount > 10, null, { timeout: 60000 });

// 1. Autopilot to Mars
await page.evaluate(() => { const a = window.app; const m = a.system.bodies.find((b) => b.name === 'Mars'); a.select(m); a.goTo(m); });
// (a flight is a number of frames, the camera's step being 0.1 s at most a frame: some 60 of them, a minute at a frame a second and
// more where it is slower, so the wait is a bound and not a measure)
await page.waitForFunction(() => !window.app.rig.autopilot, null, { timeout: 600000 });
await page.waitForTimeout(1500);
let st = await page.evaluate(() => {
  const a = window.app; const m = a.system.bodies.find((b) => b.name === 'Mars');
  return { anchor: a.rig.anchor?.name, dist: m.upos.sub(a.rig.upos).length() / m.radius };
});
check('goto Mars arrives and co-moves', st.anchor === 'Mars' && st.dist > 2.5 && st.dist < 5, JSON.stringify(st));
await page.screenshot({ path: path.join(outDir, 'i1-goto-mars.png') });

// 1b. The mouse on Mars: right-drag turns round it holding its surface, the wheel zooms at the pointer, left-drag looks
{
  const probe = () => page.evaluate(() => {
    const a = window.app; const m = a.system.bodies.find((b) => b.name === 'Mars');
    const rel = a.rig.upos.sub(m.upos);
    return { rel: rel.toArray(), dist: rel.length() / m.radius, fwd: a.rig.forward().toArray(), mars: a.project(m.upos.sub(a.rig.upos)) };
  });
  const frames = async (n) => { const f = await page.evaluate(() => window.app.frameCount); await page.waitForFunction((x) => window.app.frameCount >= x, f + n, { timeout: 60000 }); };
  const angle = (u, v) => Math.acos(Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v))));
  const held = await page.evaluate(() => {
    const a = window.app, t = a.rig.target; const cam = a.rig.upos.sub(t.upos); const dir = a.rig.ray(600, 380);
    const b = cam.dot(dir); return cam.addScaledVector(dir, -b - Math.sqrt(b * b - (cam.lengthSq() - t.radius * t.radius))).toArray();
  });
  const p0 = await probe();
  await page.mouse.move(600, 380);
  await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 8; i++) { await page.mouse.move(600 + 10 * i, 380 - 6 * i); await frames(1); }
  await page.mouse.up({ button: 'right' });
  await frames(1);
  const p1 = await probe();
  const drawn = await page.evaluate((h) => { const a = window.app, t = a.rig.target; const v = a.rig.upos.sub(t.upos).negate(); v.x += h[0]; v.y += h[1]; v.z += h[2]; return a.project(v); }, held);
  check('right-drag turns round Mars with its surface under the pointer', Math.abs(p1.dist - p0.dist) < 1e-9 && angle(p0.rel, p1.rel) > 0.05 && Math.hypot(drawn.x - 680, drawn.y - 332) < 1.5 && Math.hypot(p1.mars.x - p0.mars.x, p1.mars.y - p0.mars.y) < 0.01, JSON.stringify({ drawn, turned: angle(p0.rel, p1.rel) }));
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -300);
  await frames(2);
  const p2 = await probe();
  await page.mouse.wheel(0, 300);
  await frames(2);
  const p3 = await probe();
  check('the wheel zooms in and back out', p2.dist < p1.dist * 0.8 && Math.abs(p3.dist - p1.dist) < 1e-6, JSON.stringify([p1.dist, p2.dist, p3.dist]));
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) { await page.mouse.move(640 + 12 * i, 360 + 5 * i); await frames(1); }
  await page.mouse.up();
  await frames(1);
  const p4 = await probe();
  check('left-drag looks around without moving', Math.hypot(p4.rel[0] - p3.rel[0], p4.rel[1] - p3.rel[1], p4.rel[2] - p3.rel[2]) < 1e-3 && angle(p3.fwd, p4.fwd) > 0.05, `turned ${angle(p3.fwd, p4.fwd).toFixed(3)} rad`);
  await page.evaluate(() => { const a = window.app; a.center(a.rig.target); });
}

// 2. Time acceleration: one day per second for ~2 s; the camera must stay with Mars
const before = await page.evaluate(() => ({ jd: window.app.clock.jdTdb }));
await page.evaluate(() => { window.app.clock.paused = false; window.app.clock.rate = 86400; });
// (two days at a day a second: two seconds here. A frame is at most a second of the clock's, so on a runner at a frame a
// second two seconds of wall time were one frame, "Δ=1.00 d": the wait is for the two days, not for two seconds)
await page.waitForFunction((jd) => window.app.clock.jdTdb - jd >= 2, before.jd, { timeout: 600000 });
st = await page.evaluate(() => {
  const a = window.app; a.clock.rate = 1; const m = a.system.bodies.find((b) => b.name === 'Mars');
  return { jd: a.clock.jdTdb, dist: m.upos.sub(a.rig.upos).length() / m.radius };
});
check('time acceleration advances the clock', st.jd - before.jd > 1, `Δ=${(st.jd - before.jd).toFixed(2)} d`);
check('camera co-moves with Mars under acceleration', st.dist > 2.5 && st.dist < 5, `dist=${st.dist.toFixed(2)} R`);

// 2b. Zoomed out beyond the reach of Mars's own pull, Mars still what the camera turns round: the camera keeps riding with
// it. (It rode with the Sun out there: zoomed out to see a planet and the moons round it, time running fast, the owner saw
// them fly out of the view, 27 Nov 2026; at a day a second the Earth was 84 degrees off the view after 6 seconds.)
const far = await page.evaluate(() => {
  const a = window.app, m = a.findByName('Mars'), V = a.rig.ray(0, 0).constructor;
  const dir = new V(0.3, 1, 0.2).normalize(), reach = 3 * m.soiRadius();
  a.rig.target = m;
  a.rig.upos.copy(m.upos).addVec(dir, reach);
  a.rig.lookAt(dir.clone().negate(), new V(0, 0, 1));
  return { reach, jd: a.clock.jdTdb };
});
await page.evaluate(() => { window.app.clock.paused = false; window.app.clock.rate = 86400; });
await page.waitForFunction((jd) => window.app.clock.jdTdb - jd >= 2, far.jd, { timeout: 600000 });
const kept = await page.evaluate(() => {
  const a = window.app, m = a.findByName('Mars'), V = a.rig.ray(0, 0).constructor;
  a.clock.rate = 1;
  const rel = m.upos.sub(a.rig.upos, new V());
  return { anchor: a.rig.anchor?.name ?? null, off: Math.acos(Math.min(1, rel.clone().normalize().dot(a.rig.forward()))) * 180 / Math.PI, dist: rel.length() };
});
check('zoomed out beyond Mars\'s own pull, time running fast, the camera keeps riding with Mars', kept.anchor === 'Mars' && kept.off < 0.5 && Math.abs(kept.dist / far.reach - 1) < 0.01, JSON.stringify({ ...kept, reach: far.reach }));

// 3. Free flight with W
const p0 = await page.evaluate(() => window.app.rig.upos.toVector3().toArray());
await page.mouse.move(640, 360);
await page.keyboard.down('KeyW');
await page.waitForTimeout(800);
await page.keyboard.up('KeyW');
const p1 = await page.evaluate(() => window.app.rig.upos.toVector3().toArray());
const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
check('W key flies forward', moved > 1e3, `moved ${(moved / 1e3).toFixed(0)} km`);

// 4. Click picking: click Jupiter's projected position
await page.evaluate(() => { const a = window.app; const e = a.system.bodies.find((b) => b.name === 'Earth'); a.placeNear(e, e.radius * 4, 180, 0); a.select(null); });
await page.waitForTimeout(500);
const jp = await page.evaluate(() => {
  const a = window.app; const j = a.system.bodies.find((b) => b.name === 'Jupiter');
  a.center(j);
  return null;
});
void jp;
const fc = await page.evaluate(() => window.app.frameCount);
await page.waitForFunction((f) => window.app.frameCount > f + 5, fc, { timeout: 60000 });
const scr = await page.evaluate(() => {
  const a = window.app; const j = a.system.bodies.find((b) => b.name === 'Jupiter');
  return a.project(j.upos.sub(a.rig.upos));
});
if (scr) {
  await page.mouse.click(scr.x, scr.y);
  const f2 = await page.evaluate(() => window.app.frameCount);
  await page.waitForFunction((f) => window.app.frameCount > f + 2, f2, { timeout: 60000 });
}
const sel = await page.evaluate(() => window.app.selection?.name);
check('click selects Jupiter', sel === 'Jupiter', `selected=${sel} at ${JSON.stringify(scr)}`);

// 4b. Earth for scale, in front of Jupiter, is named beside it ("Earth, to scale"), and is not drawn without its name
{
  const frames = async (n) => { const f = await page.evaluate(() => window.app.frameCount); await page.waitForFunction((x) => window.app.frameCount >= x, f + n, { timeout: 60000 }); };
  await page.evaluate(() => { const a = window.app; const j = a.findByName('Jupiter'); a.select(j); a.placeNear(j, j.radius * 4, 30, 10); });
  await frames(4);
  const seen = () => page.evaluate(() => {
    const a = window.app, at = a.awe.cues.earthAt;
    const el = [...document.querySelectorAll('.label')].find((e) => e.textContent === 'Earth, to scale' && e.style.display !== 'none');
    const p = at ? a.project(at) : null, r = el?.getBoundingClientRect();
    return { drawn: !!at, named: !!el, gap: p && r ? Math.hypot(r.left - p.x, r.bottom - p.y) : null };
  });
  const on = await seen();
  await page.evaluate(() => window.app.act('labels'));
  await frames(3);
  const off = await seen();
  await page.evaluate(() => window.app.act('labels'));
  check('Earth for scale is named beside it, and hidden with the names', on.drawn && on.named && on.gap !== null && on.gap < 30 && !off.drawn && !off.named, JSON.stringify({ on, off }));
  // ... and wears the Earth's own map and clouds once they have loaded (it was a plain blue-grey
  // ball, which against Jupiter read as a hole, not as the Earth)
  const earthMaps = () => page.evaluate(() => {
    const a = window.app, e = a.system.bodies.find((b) => b.name === 'Earth' && b.kind === 'planet');
    const own = e && a.bodies.surfaceMap?.(e), u = a.awe.cues.earthMat.uniforms;
    return { loaded: !!own?.clouds, map: !!own && u.uMap?.value === own.tex && u.uHasMap?.value === 1, clouds: !!own?.clouds && u.uClouds?.value === own.clouds && u.uHasClouds?.value === 1 };
  });
  await page.waitForFunction(() => { const a = window.app, e = a.system.bodies.find((b) => b.name === 'Earth' && b.kind === 'planet'); return !!a.bodies.surfaceMap?.(e)?.clouds; }, null, { timeout: 120000 }).catch(() => undefined);
  await frames(2);
  const worn = await earthMaps();
  check("Earth for scale wears the Earth's own map and clouds", worn.loaded && worn.map && worn.clouds, JSON.stringify(worn));
}

// 4b2. With the mass slider holding the keyboard's focus the shortcuts still work (playtest D1: "]" eight
// times did nothing after the slider was clicked); only the slider's own keys (arrows, Home, End, Page) are its
{
  const frames = async (n) => { const f = await page.evaluate(() => window.app.frameCount); await page.waitForFunction((x) => window.app.frameCount >= x, f + n, { timeout: 60000 }); };
  await page.evaluate(() => { const a = window.app; a.select(a.findByName('Jupiter')); });
  await frames(2);
  await openCard(page);
  await page.click('.card [data-power="mass"]');
  await frames(2);
  const focused = await page.evaluate(() => { const s = document.querySelector('.card input.slider'); s.focus(); return document.activeElement === s; });
  const before = await page.evaluate(() => window.app.labels.enabled);
  await page.keyboard.press('KeyL');
  await frames(2);
  const after = await page.evaluate(() => window.app.labels.enabled);
  await page.keyboard.press('KeyL');
  await frames(1);
  check('with the mass slider focused the shortcuts still work', focused && before !== after, JSON.stringify({ focused, before, after }));
  await page.click('.card [data-power="mass"]');
  await frames(1);
}

// 4c. M87* from 1,000 of its radii (two light years): one name for the one point (the galaxy M87's
// name stood on the hole's), and that name clear of the glowing middle of its disk
{
  const frames = async (n) => { const f = await page.evaluate(() => window.app.frameCount); await page.waitForFunction((x) => window.app.frameCount >= x, f + n, { timeout: 120000 }); };
  await page.evaluate(() => { const a = window.app; const h = a.findByName('M87*'); a.select(h); a.placeNear(h, h.radius * 1000, 30, 10); });
  await frames(8);
  const st = await page.evaluate(() => {
    const a = window.app, h = a.findByName('M87*');
    const p = a.project(h.upos.sub(a.rig.upos));
    const v = a.holes.views.find((x) => x.bh === h);
    const disk = v ? v.innerDiskPx / a.view.pixelRatio : 0;
    const names = [...document.querySelectorAll('.label')].filter((e) => e.style.display !== 'none' && /^M87\*?$/.test(e.textContent)).map((e) => {
      const r = e.getBoundingClientRect();
      return { text: e.textContent, clear: Math.hypot(Math.max(r.left - p.x, 0), Math.max(p.y - r.bottom, 0)) };
    });
    return { names, disk };
  });
  check('at M87* one name stands for the hole, clear of its disk', st.names.length === 1 && st.names[0].text === 'M87*' && st.names[0].clear >= st.disk, JSON.stringify(st));
}

// 4d. A star with no proper name, chosen before its number has arrived (its region's numbers not
// yet downloaded): the card goes by its catalogue number once it comes, as the ship's instruments
// and the name on the sky do (it said "Unnamed star" for good)
{
  const st0 = await page.evaluate(() => {
    const a = window.app, cat = a.catalog;
    for (let i = 0; i < cat.nodes.length; i++) {
      const n = cat.nodes[i];
      if (n.state !== 'ready' || n.idsState !== 'none' || !n.count) continue;
      for (let slot = 0; slot < n.count; slot++) {
        if (a.named.byNodeSlot.has(`${i}:${slot}`)) continue;
        const s = a.getStar(cat, i, slot);
        a.select(s);
        window.__star = s;
        return { first: s.name };
      }
    }
    return null;
  });
  await page.waitForFunction(() => window.__star && window.__star.designations.length > 0, null, { timeout: 60000 }).catch(() => undefined);
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => ({ name: window.__star?.name, card: document.querySelector('.card h2')?.textContent }));
  check('a star goes by its catalogue number on its card', !!st0 && st.card === st.name && !/^(unnamed star|star)$/i.test(st.card ?? ''), JSON.stringify({ ...st0, ...st }));
}

// 4e. Search: "black" lists the black holes people know first; "proxima" lists Proxima once (it
// was there twice, as the star and as the host of its planets); the tour has the famous holes
{
  const st = await page.evaluate(async () => {
    const a = window.app;
    a.searchItems('black'); a.searchItems('proxima');
    await new Promise((r) => setTimeout(r, 3000)); // (the catalogue's results arrive later)
    const proxima = a.searchItems('proxima').map((r) => r.label);
    return { black: a.searchItems('black').slice(0, 3).map((r) => r.label), proxima, tour: a.tourItems().map((t) => t.label).filter((l) => /\*|Cygnus X-1/.test(l)) };
  });
  check('search ranks the famous black holes first, and lists Proxima once', st.black.join() === 'Sagittarius A*,M87*,Cygnus X-1'
    && st.proxima.filter((l) => /^Proxima Cen(tauri)?$/.test(l)).length === 1 && st.tour.join() === 'Sagittarius A*,M87*,Cygnus X-1', JSON.stringify(st));
}

// 4f. A star whose distance is a poor parallax's says so on its card: the Garnet Star (μ Cephei), 8,400 pc in
// the catalogue from a Gaia parallax of 0.119 ± 0.264 mas (it is about a tenth as far): its distance uncertain,
// with the numbers, and its luminosity and estimated size, worked out from that distance, not stated as fact;
// Deneb's (a good parallax) as before
{
  const card = (name) => page.evaluate(async (name) => {
    const a = window.app, s = a.findByName(name);
    a.select(s);
    for (let i = 0; i < 100 && (!s.distanceGrade || !s.teffSource); i++) await new Promise((r) => setTimeout(r, 100));
    // (the card drawn for this star before its details are opened: the first frame that draws a new selection
    // closes them, and closed they are not refreshed. On GitHub's runners the click came first, and the rows
    // read were the star's before.) A frame drawn by hand: the app's own loop may be held by an earlier check.
    for (let i = 0; i < 300 && document.querySelector('.card h2')?.textContent !== s.name; i++) {
      a.frame();
      await new Promise((r) => setTimeout(r, 100));
    }
    const det = document.querySelector('.card [data-details]');
    if (det.getAttribute('aria-expanded') !== 'true') det.click();
    // (the card as the app has drawn it for this star: its title, and its distance as the star itself states it;
    // on a slow machine the card is a frame or more behind the selection)
    const info = new Map(s.info());
    const want = info.get('Distance from Sun');
    const read = () => {
      const rows = {};
      const dts = [...document.querySelectorAll('.card .facts dt')], dds = [...document.querySelectorAll('.card .facts dd')];
      dts.forEach((dt, k) => { rows[dt.textContent] = dds[k]?.textContent ?? ''; });
      return rows;
    };
    let rows = read();
    for (let i = 0; i < 300 && (document.querySelector('.card h2')?.textContent !== s.name || rows['Distance from Sun'] !== want || rows.Temperature !== info.get('Temperature')); i++) {
      // (a frame drawn by hand: the app's own loop may be held by an earlier check)
      a.frame();
      await new Promise((r) => setTimeout(r, 100));
      rows = read();
    }
    const hudRows = Object.fromEntries(a.hud.state?.selection?.rows ?? []);
    return { grade: s.distanceGrade, title: document.querySelector('.card h2')?.textContent, selected: a.selection?.name, want, hud: hudRows['Distance from Sun'], detail: document.querySelector('.card .card-title p')?.textContent, rows };
  }, name);
  const garnet = await card('Garnet Star');
  const deneb = await card('Deneb');
  const g = garnet.rows;
  check("a star with a poor parallax: its card says its distance is uncertain, with the numbers, and what follows from it is not stated as fact",
    /distance uncertain \(parallax 0\.119 ± 0\.264 mas\)/.test(g['Distance from Sun'] ?? '') && /uncertain/.test(g['Luminosity (V)'] ?? '') && /uncertain/.test(g['Absolute mag (V)'] ?? '')
      && /uncertain/.test(g.Radius ?? '') && /uncertain/.test(g.Scale ?? '') && /uncertain/.test(garnet.detail ?? '')
      && !/uncertain/.test(`${deneb.rows['Distance from Sun']} ${deneb.rows['Luminosity (V)']} ${deneb.detail}`),
    JSON.stringify({ garnet: { grade: garnet.grade, title: garnet.title, selected: garnet.selected, want: garnet.want, hud: garnet.hud, detail: garnet.detail, distance: g['Distance from Sun'], luminosity: g['Luminosity (V)'], radius: g.Radius, scale: g.Scale }, deneb: { grade: deneb.grade, distance: deneb.rows['Distance from Sun'] } }));
  // 4g. Hot and reddened stars' temperatures: from their spectral type where the colour cannot tell (O and B
  // stars; dust), with the card saying which scale; a catalogue type its colour does not bear out flagged, not
  // trusted. (From their colour alone: Alnitak 13,561 K, Spica 14,492, Cygnus X-1's star 5,501.)
  const t = {};
  for (const [key, name] of [['alnitak', 'Alnitak'], ['spica', 'Spica'], ['cygx1', 'HIP 98298'], ['almach', 'Almach'], ['garnet', 'Garnet Star']]) {
    const c = await card(name);
    t[key] = { title: c.title, type: c.rows['Spectral type'], temperature: c.rows.Temperature, radius: c.rows.Radius };
  }
  check("hot and reddened stars: their temperature from their spectral type, the card naming the scale; a type its colour does not bear out flagged",
    /^30,463 K \(from its spectral type \(Martins et al\. 2005\)\)$/.test(t.alnitak.temperature ?? '')
      && /^26,000 K \(from its spectral type \(Pecaut & Mamajek 2013\)\)$/.test(t.spica.temperature ?? '')
      && /^27,500 K \(from its spectral type \(Crowther et al\. 2006\); its light is reddened by dust, E\(B−V\) 1\.03\)$/.test(t.cygx1.temperature ?? '')
      && /with the light the dust took/.test(t.cygx1.radius ?? '')
      && /not used$/.test(t.almach.type ?? '') && /from its colour\)$/.test(t.almach.temperature ?? '')
      && /redder: dust, or a wrong type/.test(t.garnet.type ?? ''),
    JSON.stringify(t));
  await page.evaluate(() => { const d = document.querySelector('.card [data-details]'); if (d?.getAttribute('aria-expanded') === 'true') d.click(); window.app.select(null); });
}

// 5c. Walking, star names stand only over the sky: none over the ground, at the bottom of a valley (the Apollo 17
// site, in the Taurus-Littrow valley, 2.6 km under the Moon's mean radius), of a canyon (Valles Marineris, kilometres
// under Mars's datum), and none hidden above the real horizon on a summit (Everest, where the land falls away).
// Each star's line of sight is followed out over the ground the app has (its heights where it draws them): one
// still blocked when raised by 0.3 degrees must have no name, and one still clear when lowered by 0.3 degrees
// must keep its name if it would have one with nothing in the way.
// (the sky of 1 October 2026, 20:00 UTC, with time standing still: the earlier checks ran the clock fast)
const jdWalk = await page.evaluate(() => { const a = window.app; a.clock.rate = 1; a.clock.paused = true; return a.clock.jdTdb; });
for (const place of ['Apollo 17 landing site', 'Valles Marineris', 'Mount Everest']) {
  await page.evaluate((jd) => { window.app.clock.jdTdb = jd; }, 2461315.3341340744);
  await page.evaluate((name) => window.app.walk.walkAt(window.app.landmarks.find((l) => l.name === name)), place);
  await page.waitForFunction(() => window.app.walk.state === 'walk', null, { timeout: 600000 }).catch(() => undefined);
  { const f = await page.evaluate(() => window.app.frameCount); await page.waitForFunction((x) => window.app.frameCount >= x, f + 20, { timeout: 600000 }); }
  await page.waitForFunction(() => window.app.debugState().pendingTiles === 0, null, { timeout: 300000 }).catch(() => undefined);
  { const f = await page.evaluate(() => window.app.frameCount); await page.waitForFunction((x) => window.app.frameCount >= x, f + 5, { timeout: 600000 }); }
  // the eye settled on the night (the faintest stars named are set by it): the magnitude limit no longer moving
  // from one ten frames to the next. (It runs before the space station's check, which times out now and then on
  // GitHub's runners and ends the run.)
  for (let k = 0, last = -99; k < 60; k++) {
    const f = await page.evaluate(() => window.app.frameCount);
    await page.waitForFunction((x) => window.app.frameCount >= x, f + 10, { timeout: 600000 });
    const m = await page.evaluate(() => window.app.lastMLim);
    if (Math.abs(m - last) < 0.05) break;
    last = m;
  }
  const r = await page.evaluate(() => {
    const a = window.app, T = a.terrain, c = T.current, e = c.orient.elements;
    const rel = a.rig.upos.sub(c.upos, a.rig.vel.clone());
    const bf = (v) => [e[0] * v.x + e[1] * v.y + e[2] * v.z, e[4] * v.x + e[5] * v.y + e[6] * v.z, e[8] * v.x + e[9] * v.y + e[10] * v.z];
    const eye = bf(rel), D = Math.hypot(...eye), up = rel.clone().normalize();
    const R = T.owner.radius, reach = Math.sqrt(2 * R * (D - R + 10000));
    const n = a.rig.vel.clone();
    // is the line of sight along world direction `d` blocked by the ground within reach?
    const blocked = (d) => {
      const db = bf(d);
      for (let i = 0; i < 400; i++) {
        const t = 2 * (reach / 2) ** (i / 399);
        const p = [eye[0] + db[0] * t, eye[1] + db[1] * t, eye[2] + db[2] * t], r = Math.hypot(...p);
        n.set(p[0] / r, p[1] / r, p[2] / r);
        let g = T.groundRadius(n);
        const lvl = T.waterLevel(n);
        if (lvl !== null) g = Math.max(g, T.owner.radius + lvl);
        if (r < g) return true;
      }
      return false;
    };
    const tilt = (d, deg) => d.clone().addScaledVector(up, Math.tan((deg * Math.PI) / 180)).normalize();
    const named = (list) => list.filter((x) => x.cls === 'star');
    const shown = named(a.labelCandidates());
    const keep = a.occluded;
    a.occluded = () => false;
    const all = named(a.labelCandidates());
    a.occluded = keep;
    const el = (x) => +((Math.asin(x.rel.clone().normalize().dot(up)) * 180) / Math.PI).toFixed(2);
    const has = new Set(shown.map((x) => x.text));
    const under = all.filter((x) => blocked(tilt(x.rel.clone().normalize(), 0.3)));
    // (and not behind another world in the sky: the Earth over the Moon)
    const others = a.occluders.filter((o) => !o.exact);
    const behindWorld = (x) => others.some((o) => o.dist < x.rel.length() && x.rel.angleTo(o.rel) < 1.1 * Math.asin(Math.min(1, o.radius / o.dist)));
    const over = all.filter((x) => !behindWorld(x) && !blocked(tilt(x.rel.clone().normalize(), -0.3)));
    // just over a ridge: clear, above the eye's level, and behind the ground if 6 degrees lower
    // (from the Apollo 17 site, over the massifs round the valley)
    const ridge = over.filter((x) => el(x) > 0 && blocked(tilt(x.rel.clone().normalize(), -6)));
    return {
      world: T.owner.name, below: Math.round(D - R), mLim: +a.lastMLim.toFixed(2), labels: a.labels.enabled, frame: a.frameCount, jd: a.clock.jdTdb, sunUp: +((Math.asin(a.system.sun.upos.sub(a.rig.upos, a.rig.vel.clone()).normalize().dot(up)) * 180) / Math.PI).toFixed(1), named: all.length, behindWorlds: all.filter(behindWorld).length, under: under.length, overEyeLevel: over.filter((x) => el(x) < 0).length,
      ridge: ridge.map((x) => `${x.text} ${el(x)}°${has.has(x.text) ? '' : ' (unnamed)'}`),
      wrong: under.filter((x) => has.has(x.text)).map((x) => `${x.text} ${el(x)}°`), lost: over.filter((x) => !has.has(x.text)).map((x) => `${x.text} ${el(x)}°`),
    };
  });
  // (at the Apollo 17 site there are names both under its ground and just over its ridges to be tried)
  const ok = r.wrong.length === 0 && r.lost.length === 0 && (place !== 'Apollo 17 landing site' || (r.under > 0 && r.ridge.length > 0));
  check(`walking at ${place}: no star's name over the ground, none lost over the sky (just over a ridge either)`, ok, JSON.stringify(r));
  // 5c2. At night in the valley, the view turned to where the Sun is, under the horizon: the stars stay out.
  // (The eye there is 2.6 km under the Moon's mean radius, and the Moon was counted as hiding nothing from inside
  // its mean ball: the Sun, 7.9 degrees under the horizon, was in sight and took the limit to -16. Which way the
  // walker happened to face came from the checks before: on GitHub's runners it was towards the Sun.)
  if (place === 'Apollo 17 landing site') {
    const face = async (away) => {
      await page.evaluate((away) => {
        const a = window.app, W = a.walk, RT = W.R.clone().transpose();
        const up = a.rig.upos.sub(W.centre, a.rig.vel.clone()).normalize().applyMatrix3(RT);
        const s = a.system.sun.upos.sub(a.rig.upos, a.rig.vel.clone()).normalize().applyMatrix3(RT);
        s.addScaledVector(up, -s.dot(up)).normalize();
        if (away) s.negate();
        W.fwd.copy(s); W.pitch = 0;
      }, away);
      const f = await page.evaluate(() => window.app.frameCount);
      // (90 frames of the night sky from the valley floor, the slowest view of the suite: 6 to 7 s a frame on GitHub's
      // runners on 25 Nov, so 600 s was too short four runs in a row, the suite ending there; the frames are the measure)
      await page.waitForFunction((x) => window.app.frameCount >= x, f + 90, { timeout: 1800000 });
      return page.evaluate(() => {
        const a = window.app, rel = a.system.sun.upos.sub(a.rig.upos, a.rig.vel.clone());
        const up = a.rig.upos.sub(a.walk.centre, a.rig.vel.clone()).normalize();
        return { mLim: +a.lastMLim.toFixed(2), sunUp: +((Math.asin(rel.clone().normalize().dot(up)) * 180) / Math.PI).toFixed(1), sunInSight: +a.inSight(rel, a.system.sun.radius).toFixed(3) };
      });
    };
    const away = await face(true), toward = await face(false);
    check('walking at night in the Apollo 17 valley, facing where the Sun is under the horizon: the stars stay out',
      toward.sunUp < -1 && toward.sunInSight === 0 && toward.mLim > away.mLim - 0.5, JSON.stringify({ away, toward }));
  }
}
await page.evaluate((jd) => { const a = window.app; a.walk.exit(true); a.clock.jdTdb = jd; a.clock.paused = false; }, jdWalk);
// Let the last walk's selection reach the card (and pointer lock end) before opening Search: a new selection closes
// the sheet, so a late card update would otherwise take away the input's focus after Enter.
// (waits that say what they saw in the check below rather than end the suite, as the one after the walks once did)
// (and the interface out of walking, whose mode hides the sheets: the card already named the walk's place, so a frame
// after the walk's exit, still walking, Enter's search opened hidden and its field took no focus: the run of f6f8084, "typing":false)
const settled = await page.waitForFunction(() => document.pointerLockElement === null && !window.app.walk.active
  && document.querySelector('#hud')?.dataset.mode !== 'walk'
  && document.querySelector('.card h2')?.textContent === window.app.selection?.name, null, { timeout: 600000 }).then(() => true, () => false);

// 5. Search and go to a star
// A control left focused by an earlier step would take Enter itself (a button activates); start the app shortcut from no control.
await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
await page.keyboard.press('Enter');
const typing = await page.waitForFunction(() => document.querySelector('.searchbox input') === document.activeElement, null, { timeout: 600000 }).then(() => true, () => false);
await page.keyboard.type('Sirius');
// The results appear at some frame, not at a fixed wall time: wait for the state, not a timeout.
const listed = await page.waitForFunction(() => document.querySelector('.explore .list [data-id] b')?.textContent === 'Sirius', null, { timeout: 600000 }).then(() => true, () => false);
await page.keyboard.press('Enter');
// (a wait that ends the suite, as a timeout here does, loses every check after it and says nothing of what it saw: this one is a
// failed check that says: on a runner (45262156702) it timed out here once, after the three walks, and the suite ended)
const arrived = await page.waitForFunction(() => !window.app.rig.autopilot && window.app.selection?.name === 'Sirius', null, { timeout: 600000 }).then(() => true, () => false);
await page.waitForFunction(() => window.app.debugState().pendingTiles === 0, null, { timeout: 60000 }).catch(() => undefined);
await page.waitForTimeout(2500);
st = await page.evaluate((arrived) => ({ arrived, autopilot: !!window.app.rig.autopilot, near: window.app.near.stars.map((s) => s.name), sel: window.app.selection?.name }), arrived);
Object.assign(st, { settled, typing, listed });  // (how far the search got, when it fails)
check('search + goto Sirius; Sirius drawn by the near-star renderer', st.near.includes('Sirius'), JSON.stringify(st));
await page.screenshot({ path: path.join(outDir, 'i2-sirius.png') });

// 5b. Beside the space station (400 km up, where the camera would otherwise start to turn with the Earth): it stays beside it
await page.evaluate(() => { const a = window.app; const s = a.findByName('ISS'); a.select(s); a.goTo(s); });
await page.waitForFunction(() => !window.app.rig.autopilot, null, { timeout: 600000 });
await page.waitForTimeout(1000);
const iss = () => page.evaluate(() => { const a = window.app; const s = a.findByName('ISS'); return { d: s.upos.sub(a.rig.upos).length(), anchor: a.rig.anchor?.name, alt: a.rig.altitude }; });
const i0 = await iss();
await page.waitForTimeout(3000);
const i1 = await iss();
check('beside the space station the camera stays beside it', /International/.test(i1.anchor ?? '') && Math.abs(i1.d - i0.d) < 0.5 && i0.d < 2000, JSON.stringify([i0, i1]));

// 6. Frame timing (JS work only)
const timing = await page.evaluate(async () => {
  const a = window.app; const t = [];
  for (let i = 0; i < 30; i++) { const s = performance.now(); a.frame(); t.push(performance.now() - s); await new Promise((r) => setTimeout(r, 0)); }
  t.sort((x, y) => x - y); return { median: t[15], p90: t[27] };
});
console.log('frame() incl. SwiftShader GPU emulation: median', timing.median.toFixed(1), 'ms, p90', timing.p90.toFixed(1), 'ms');

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
