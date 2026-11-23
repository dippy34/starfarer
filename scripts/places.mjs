// Special places in headless Chromium: inside Saturn's rings (3D ice particles from the measured
// optical depth). Usage: node scripts/places.mjs [baseUrl] [outDir]
import { collectErrors, launchBrowser } from './lib/browser.mjs';
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
const frames = async (n) => { const f = await page.evaluate(() => window.app.frameCount); await page.waitForFunction((x) => window.app.frameCount > x, f + n, { timeout: 120000 }); };
/**
 * Load another view. A page left while star regions are still on their way has those downloads
 * cut off, and the catalogue reports each as an error ("Failed to fetch": seen whenever the
 * machine was busy enough for them to be late): they are let in first.
 */
const go = async (query) => {
  await page.waitForFunction(() => !window.app?.debugState || window.app.debugState().pendingTiles === 0, null, { timeout: 180000 }).catch(() => undefined);
  await page.goto(`${base}?${query}`, { waitUntil: 'load', timeout: 180000 });
};

await go('time=2026-10-01T20:00:00Z&paused=1&target=Saturn&dist=4');
await page.waitForFunction(() => window.app && window.app.renderer && window.app.frameCount > 10, null, { timeout: 120000 });

// 0. the tour (T) lists places that all resolve
let st0 = await page.evaluate(() => {
  const a = window.app;
  const items = a.tourItems();
  const bad = items.filter((i) => !i.id.startsWith('tour:') && !a.resolveSearchId(i.id)).map((i) => i.label);
  return { n: items.length, bad };
});
check('the tour offers places that resolve', st0.n >= 10 && st0.bad.length === 0, JSON.stringify(st0));

// 1. search finds the rings as a destination
let st = await page.evaluate(() => window.app.searchItems('rings').map((r) => r.label));
check('search offers Saturn\'s rings', st.includes("Saturn's rings"), JSON.stringify(st.slice(0, 5)));

// 2. inside the B ring: particles around the explorer, Saturn in view
await page.evaluate(() => {
  const a = window.app;
  const spot = a.findByName("Saturn's rings");
  a.select(spot);
  a.rig.upos.copy(spot.upos);
  const sat = a.findByName('Saturn');
  const toSat = sat.upos.sub(a.rig.upos).normalize();
  const pole = toSat.constructor ? new toSat.constructor().setFromMatrixColumn(sat.orientation, 2).normalize() : null;
  // look towards Saturn, tipped a little out of the ring plane
  a.rig.lookAt(toSat.clone().addScaledVector(pole, 0.06).normalize(), pole);
});
await frames(12);
st = await page.evaluate(() => {
  const rp = window.app.bodies.ringParticles;
  return { visible: rp?.mesh.visible ?? false, count: rp?.mesh.count ?? 0, anchor: window.app.rig.anchor?.name ?? null };
});
check('ice particles surround the explorer in the B ring', st.visible && st.count > 300, JSON.stringify(st));
await page.screenshot({ path: path.join(outDir, 'p1-saturn-rings.png') });

// 3. looking along the ring plane, away from Saturn
await page.evaluate(() => {
  const a = window.app;
  const sat = a.findByName('Saturn');
  const out = a.rig.upos.sub(sat.upos).normalize();
  const pole = new out.constructor().setFromMatrixColumn(sat.orientation, 2).normalize();
  const along = pole.clone().cross(out).normalize();
  a.rig.lookAt(along.addScaledVector(pole, -0.04).normalize(), pole);
});
await frames(6);
await page.screenshot({ path: path.join(outDir, 'p2-ring-plane.png') });

// 4. far above the rings: no particles drawn
await page.evaluate(() => {
  const a = window.app;
  const sat = a.findByName('Saturn');
  const pole = new (a.rig.upos.sub(sat.upos).constructor)().setFromMatrixColumn(sat.orientation, 2).normalize();
  a.rig.upos.addVec(pole, 50e3);
});
await frames(4);
st = await page.evaluate(() => window.app.bodies.ringParticles?.mesh.visible ?? false);
check('particles are only drawn inside the ring layer', st === false);

// 4b. Saturn from 6 radii, 20 degrees above its sunlit rings: where the rings pass in front of the
// limb, the planet's air (drawn after them) leaves them as they are. It used to dim them there: a
// thin dark arc across the rings (on the build of before, 1.5 % of these pixels lost a tenth or
// more of their light, the worst 71 %; now 0.1 %, the worst 12 %).
{
  await page.evaluate(() => {
    const a = window.app, S = a.findByName('Saturn');
    const V = S.upos.sub(S.upos).constructor;
    const p = new V().setFromMatrixColumn(S.orientation, 2).normalize();
    const s = a.system.sun.upos.sub(S.upos).normalize();
    if (s.dot(p) < 0) p.negate();
    const flat = s.clone().addScaledVector(p, -s.dot(p)).normalize();
    const D = Math.PI / 180;
    const d = flat.applyAxisAngle(p, 60 * D).multiplyScalar(Math.cos(20 * D)).addScaledVector(p, Math.sin(20 * D)).normalize();
    a.select(S);
    a.rig.upos.copy(S.upos).addVec(d, S.radius * 6);
    a.rig.lookAt(d.clone().negate(), p);
    a.rig.target = S; a.rig.setAnchor(S);
  });
  await frames(8);
  // the pixels whose sight line meets the dense B ring and then passes through the air beside the limb
  const pts = await page.evaluate(() => {
    const a = window.app, S = a.findByName('Saturn');
    const A = S.radii[0], C = S.radii[2];
    const R = S.orientation.clone().transpose();
    const o = a.rig.upos.sub(S.upos).applyMatrix4(R);
    const c = a.project(S.upos.sub(a.rig.upos));
    const out = [];
    for (let k = 0; k < 720; k++) {
      const th = (k / 720) * 2 * Math.PI;
      for (let r = 20; r < 400; r += 0.25) {
        const x = c.x + r * Math.cos(th), y = c.y + r * Math.sin(th);
        const dir = a.rig.ray(x, y).applyMatrix4(R).normalize();
        const os = o.clone(); os.z *= A / C; const ds = dir.clone(); ds.z *= A / C; ds.normalize();
        const tc = -os.dot(ds), miss = Math.sqrt(Math.max(0, os.lengthSq() - tc * tc));
        if (miss < A || miss > A + 540e3) continue;
        const tr = -o.z / dir.z, hit = o.clone().addScaledVector(dir, tr), rr = Math.hypot(hit.x, hit.y);
        if (tr > 0 && tr < tc && rr > 94000e3 && rr < 115000e3) out.push([x, y]);
      }
    }
    return out;
  });
  const light = () => page.evaluate((pts) => pts.map(([x, y]) => { const v = window.app.renderer.lightAt(x, y, 0); return v[0] + v[1] + v[2]; }), pts);
  const withAir = await light();
  await page.evaluate(() => { window.app.atmospheres.group.visible = false; });
  await frames(3);
  const without = await light();
  await page.evaluate(() => { window.app.atmospheres.group.visible = true; });
  const ratio = withAir.map((v, i) => v / Math.max(without[i], 1e-9)).sort((x, y) => x - y);
  const dimmed = ratio.filter((v) => v < 0.9).length / Math.max(ratio.length, 1);
  check('Saturn\'s air does not darken its rings in front of the limb', ratio.length > 100 && dimmed < 0.005 && ratio[0] > 0.6, JSON.stringify({ n: ratio.length, dimmed: +dimmed.toFixed(4), least: +ratio[0]?.toFixed(3) }));
  await page.screenshot({ path: path.join(outDir, 'p2b-saturn-limb.png') });
}

// 4c. Titan from 3 radii is the orange of its haze (its measured spectrum), not the grey
// near-infrared mosaic of its ground, which showed in patches with seams between them
{
  await page.evaluate(() => { const a = window.app, t = a.findByName('Titan'); a.select(t); a.placeNear(t, t.radius * 3, 40, 10); });
  await frames(8);
  const st = await page.evaluate(() => {
    const a = window.app, t = a.findByName('Titan');
    const p = a.project(t.upos.sub(a.rig.upos));
    const v = a.renderer.lightAt(p.x, p.y, 4);
    const rgb = [0, 0, 0];
    for (let i = 0; i < v.length; i++) rgb[i % 3] += v[i] / (v.length / 3);
    return { map: a.bodies.meshes.get(t).material.uniforms.uHasMap.value, rgb: rgb.map((x) => +x.toPrecision(3)) };
  });
  const [r, g, b] = st.rgb;
  check('Titan is the orange of its haze, without the map of its ground', st.map === 0 && r > 1.15 * g && g > 1.15 * b, JSON.stringify(st));
  await page.screenshot({ path: path.join(outDir, 'p2c-titan.png') });
}

// 5. a comet near the Sun: coma and tails (the brightest active one in the catalogue right now)
st = await page.evaluate(() => {
  const a = window.app;
  const sun = a.system.sun.upos;
  let best = null;
  for (const c of a.small.cometObjects) {
    if (c.row[8] === null || !['P', 'C', 'I'].includes(c.row[1])) continue;
    const r = c.upos.sub(sun).length() / 1.495978707e11;
    const m = c.row[8] + (c.row[9] ?? 10) * Math.log10(Math.max(r, 0.1));   // total magnitude 1 AU from the observer
    if (r < 3 && (!best || m < best.m)) best = { c, m, r };
  }
  if (!best) return null;
  a.select(best.c);
  // 2 million km from the nucleus, to the side of the tail
  const axis = best.c.upos.sub(sun).normalize();
  const side = new axis.constructor(0, 0, 1).cross(axis).normalize();
  a.rig.upos.copy(best.c.upos).addVec(side, 2e9).addVec(axis, 1e9);
  a.rig.lookAt(best.c.upos.sub(a.rig.upos).normalize().addScaledVector(axis, 0.3).normalize());
  return { name: best.c.name, r: best.r };
});
console.log('comet', JSON.stringify(st));
await frames(20);
if (st) {
  const t = await page.evaluate(() => window.app.cometTails.group.children.filter((m) => m.visible).length);
  check('an active comet has a coma and tails', t > 0, `${t} drawn`);
  await page.screenshot({ path: path.join(outDir, 'p3-comet.png') });
  // up close: the nucleus with jets on its sunlit side
  await page.evaluate(() => {
    const a = window.app;
    const c = a.selection;
    const sun = a.system.sun.upos.sub(c.upos).normalize();
    const side = new sun.constructor(0, 0, 1).cross(sun).normalize();
    const dir = sun.clone().multiplyScalar(0.5).addScaledVector(side, 0.85).normalize();
    a.rig.upos.copy(c.upos).addVec(dir, 60e3);
    a.rig.lookAt(dir.clone().negate());
  });
  await frames(12);
  const n = await page.evaluate(() => ({ nucleus: window.app.cometTails.nucleus.visible, r: window.app.cometTails.nucleusView?.radius ?? 0 }));
  check('up close the comet has a nucleus', n.nucleus && n.r > 0, JSON.stringify(n));
  await page.screenshot({ path: path.join(outDir, 'p3b-comet-nucleus.png'), timeout: 180000 });
}

// 6. eclipses: the total lunar eclipse of 2026-03-03 (greatest 11:33 UTC): the Moon inside Earth's shadow
await go('time=2026-03-03T11:33:00Z&paused=1&target=Moon&dist=4');
await page.waitForFunction(() => window.app && window.app.renderer && window.app.frameCount > 10, null, { timeout: 120000 });
await frames(20);
st = await page.evaluate(() => {
  const a = window.app;
  const moon = a.findByName('Moon');
  const m = a.bodies.meshes.get(moon).material.uniforms;
  return { occluders: m.uOccN.value, red: m.uOccRed.value.x };
});
check('the Moon is in Earth\'s shadow on 2026-03-03', st.occluders >= 1 && st.red === 1, JSON.stringify(st));
await page.screenshot({ path: path.join(outDir, 'p4-lunar-eclipse.png') });

// 7. a shadow of a Galilean moon on Jupiter (searched for in the next two days)
await go('time=2026-10-01T00:00:00Z&paused=1&target=Jupiter&dist=3');
await page.waitForFunction(() => window.app && window.app.renderer && window.app.frameCount > 10, null, { timeout: 120000 });
st = await page.evaluate(() => {
  const a = window.app;
  const jup = a.findByName('Jupiter');
  const moons = ['Io', 'Europa', 'Ganymede', 'Callisto'].map((n) => a.findByName(n));
  const jd0 = a.clock.jdTdb;
  for (let k = 0; k < 2 * 96; k++) {
    const jd = jd0 + k / 96;
    a.system.update(jd);
    const sun = a.system.sun.upos.sub(jup.upos);
    const dS = sun.length();
    sun.divideScalar(dS);
    for (const m of moons) {
      const v = m.upos.sub(jup.upos);
      const along = v.dot(sun);
      const perp = Math.sqrt(v.lengthSq() - along * along);
      if (along > 0 && perp < jup.radius * 0.7) { a.system.update(jd0); a.clock.jdTdb = jd; return { moon: m.name, hours: k / 4 }; }
    }
  }
  a.system.update(jd0);
  return null;
});
console.log('transit', JSON.stringify(st));
if (st) {
  await frames(3);
  await page.evaluate(() => {
    // view Jupiter from close to the Sun's direction, so the shadow is on the visible face
    const a = window.app;
    const jup = a.findByName('Jupiter');
    const sun = a.system.sun.upos.sub(jup.upos).normalize();
    a.select(jup);
    a.rig.upos.copy(jup.upos).addVec(sun, jup.radius * 3.2);
    a.rig.lookAt(sun.clone().negate());
  });
  await frames(15);
  const j = await page.evaluate(() => { const a = window.app; return a.bodies.meshes.get(a.findByName('Jupiter')).material.uniforms.uOccN.value; });
  check(`${st.moon}'s shadow falls on Jupiter`, j >= 1, `occluders ${j}`);
  await page.screenshot({ path: path.join(outDir, 'p5-jupiter-shadow.png') });
}

// 8. landmarks: Valles Marineris and the Apollo 11 site, seen from where "go to" arrives
for (const [id, name, body] of [['p6-valles-marineris', 'Valles Marineris', 'Mars'], ['p7-apollo-11', 'Apollo 11 landing site', 'Moon']]) {
  await go(`time=2026-10-01T12:00:00Z&paused=1&target=${body}&dist=3`);
  await page.waitForFunction(() => window.app && window.app.renderer && window.app.frameCount > 10, null, { timeout: 120000 });
  await page.evaluate(() => { window.app.terrain.budgetMs = 60; });
  // the hour when the Sun stands about 30 degrees over the place (the clock is paused)
  await page.evaluate((n) => {
    const a = window.app;
    const l = a.findByName(n);
    const jd0 = a.clock.jdTdb;
    let best = jd0, err = Infinity;
    for (let h = 0; h < 26; h += 0.25) {
      a.system.update(jd0 + h / 24);
      const el = Math.asin(a.system.sun.upos.sub(l.world.upos).normalize().dot(l.up())) * 57.3;
      if (Math.abs(el - 30) < err) { err = Math.abs(el - 30); best = jd0 + h / 24; }
    }
    a.system.update(jd0);
    a.clock.jdTdb = best;
  }, name);
  await frames(3);
  const found = await page.evaluate((n) => {
    const a = window.app;
    const l = a.findByName(n);
    if (!l) return null;
    a.select(l);
    const sun = a.system.sun.upos.sub(l.world.upos).normalize();
    const dir = l.approachDir(sun);
    a.rig.upos.copy(l.upos).addVec(dir, l.def.view);
    a.rig.lookAt(dir.clone().negate(), l.up());
    return { name: l.name, sunUp: sun.dot(l.up()) };
  }, name);
  console.log('landmark', JSON.stringify(found));
  await page.waitForFunction((b) => window.app.terrain.owner?.name === b, body, { timeout: 120000 }).catch(() => undefined);
  await frames(8);
  const lt = await page.evaluate(() => window.app.terrain.owner?.name ?? null);
  check(`${name}: found and shown on real terrain`, !!found && lt === body, JSON.stringify({ found, terrain: lt }));
  await page.screenshot({ path: path.join(outDir, `${id}.png`), timeout: 180000 });
}
st = await page.evaluate(() => window.app.searchItems('mars').filter((r) => r.id.startsWith('lm:')).map((r) => r.label));
check('search lists places on Mars', st.length >= 3, JSON.stringify(st));

// 9. inside the Orion Nebula: a volume replaces the billboards; far away, only the billboards
await page.evaluate(() => {
  const a = window.app;
  const o = a.findByName('Orion Nebula');
  a.select(o);
  const d = o.upos.sub(a.rig.upos).normalize();
  a.rig.upos.copy(o.upos).addVec(d, -o.radius * 0.6);
  a.rig.lookAt(d);
});
await frames(15);
const volume = () => page.evaluate(() => window.app.deepSky.group.children.find((m) => m.material?.name === 'nebula-volume')?.visible ?? false);
st = await volume();
check('inside the Orion Nebula the cloud is a volume', st);
await page.screenshot({ path: path.join(outDir, 'p8-inside-orion.png'), timeout: 180000 });
await page.evaluate(() => {
  const a = window.app;
  const o = a.findByName('Orion Nebula');
  const d = o.upos.sub(a.rig.upos).normalize();
  a.rig.upos.copy(o.upos).addVec(d, -o.radius * 2.2);
  a.rig.lookAt(d);
});
await frames(10);
await page.screenshot({ path: path.join(outDir, 'p9-orion-approach.png'), timeout: 180000 });
await page.evaluate(() => {
  const a = window.app;
  const o = a.findByName('Orion Nebula');
  const d = o.upos.sub(a.rig.upos).normalize();
  a.rig.upos.copy(o.upos).addVec(d, -o.radius * 1000);
});
await frames(5);
// under a few pixels across the volume hands over to a glow that keeps the nebula's light
st = await volume();
const farGlow = await page.evaluate(() => window.app.deepSky.group.children.some((m) => m.material?.name === 'nebula-far' && m.visible));
check('far from the nebula, the volume gives way to its glow', !st && farGlow, `volume ${st}, glow ${farGlow}`);

// 10. the map budget (render/Bodies.ts): a tour of five worlds keeps the full maps of three at the most,
// a world left behind is drawn with its small map, and Mars, come back to, is sharp again (its full map)
{
  const big = () => page.evaluate(() => {
    const bl = window.app.bodies, out = new Set();
    for (const m of bl.meshes.values()) for (const f of ['uMap', 'uNight', 'uClouds', 'uRelief']) { const t = m.material.uniforms[f]?.value; if (t?.image?.width >= 2048) out.add(m.name); }
    return [...out];
  });
  const visit = async (name) => {
    await page.evaluate((n) => { const a = window.app; const o = a.findByName(n); a.select(o); a.goTo(o); }, name);
    await page.waitForFunction(() => !window.app.rig.autopilot, null, { timeout: 600000 });
    await page.waitForFunction((n) => { const a = window.app; const b = a.system.bodies.find((x) => x.name === n); return ['full', 'hi'].includes(a.bodies.mapTier?.(b)); }, name, { timeout: 180000 }).catch(() => undefined);
  };
  const tier = (n) => page.evaluate((n) => { const a = window.app; return a.bodies.mapTier?.(a.system.bodies.find((x) => x.name === n)) ?? 'none'; }, n);
  const resident = [];
  for (const w of ['Mars', 'Jupiter', 'Io', 'Saturn', 'Titan']) { await visit(w); resident.push(await big()); }
  // (the release waits FULL_RELEASE_S: ten seconds of the page's clock)
  await page.waitForTimeout(12000);
  const marsAway = await tier('Mars');
  const most = Math.max(...resident.map((r) => r.length));
  await visit('Mars');
  const marsBack = await tier('Mars');
  check('the map budget: no more than three worlds\' full maps at once, a world left behind on its small map, sharp again on coming back',
    most <= 3 && marsAway === 'small' && ['full', 'hi'].includes(marsBack), JSON.stringify({ resident, marsAway, marsBack }));
}

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
