// The ship's looks on a phone (src/game/ShipModel.ts, shipDesign.ts, Cockpit.ts, ShipArt.ts,
// ShipLight.ts, HudMarkers.ts, FlightViz.ts, render/ViewMask.ts), upright and sideways, measured
// from what the app draws:
//   - the cockpit's frame is drawn and slim: it covers a small share of the screen, the dashboard
//     only a band at the bottom
//   - no name on the sky lies over the frame or the ship, and a name whose object is turned behind
//     the frame goes with it
//   - the head-up brackets and the orbit's Ap/Pe tags have their size in CSS pixels, the same when
//     the frame is drawn at a lower resolution (the quality governor's steps)
//   - orbit lines, the predicted path and its tags never draw over the frame or the ship (the
//     frame drawn with and without them is the same inside the frame and the ship, to the pixel,
//     the bloom's glow aside)
//   - in the chase view the ship is on the screen, not under the interface's cards, and lit (brighter
//     than the sky round it)
//   - the drive shows: the torch's plume and hot radiators, the reactionless drive's band and no plume
//   - what the ship and the cockpit cost: draw calls and triangles
// Usage: node scripts/ship.mjs [baseUrl] [outDir]
import { collectErrors, launchBrowser } from './lib/browser.mjs';
import { phoneContext } from './lib/touch.mjs';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'screenshots';
fs.mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const errors = [];
const T = '2026-11-21T20:38:00Z';

/** `n` frames of the app, a tenth of a second each (the app's own loop is stopped). */
const step = (page, n) => page.evaluate(async (n) => {
  for (let i = 0; i < n; i++) { await new Promise((r) => setTimeout(r, 105)); window.app.frame(); }
}, n);

/** Helpers put in the page: projections, the mask, pixels. */
const HELPERS = () => {
  const a = window.app;
  window.shipTest = {
    /**
     * share of the screen the frame's members cover as drawn (their own width, not the names' margin
     * round them), and the dashboard: all under its edge, with the sill along that edge
     */
    coverage() {
      const m = a.game.art.mask, w = a.view.width, h = a.view.height;
      const q = a.renderer.rig.quaternion, cssPixel = a.view.pixelAngle * a.view.pixelRatio;
      const frame = [], sill = [];
      for (const mem of a.game.cockpit.members) {
        // (the sill: the member wholly below the eye, along the dashboard's edge)
        const low = mem.path.every((p) => p.y < -0.3);
        let prev = null;
        for (const p of mem.path) {
          const v = p.clone().applyQuaternion(q), s = a.project(v);
          const cur = s && { x: s.x, y: s.y, r: mem.half / v.length() / cssPixel };
          if (cur && prev) (low ? sill : frame).push({ ax: prev.x, ay: prev.y, bx: cur.x, by: cur.y, r: Math.max(prev.r, cur.r) });
          prev = cur;
        }
      }
      const inCaps = (list, x, y) => list.some((c) => {
        const dx = c.bx - c.ax, dy = c.by - c.ay, l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((x - c.ax) * dx + (y - c.ay) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const ex = c.ax + t * dx - x, ey = c.ay + t * dy - y;
        return ex * ex + ey * ey <= c.r * c.r;
      });
      const polys = { capsules: [], polys: m.polys, covers: m.covers };
      let caps = 0, dash = 0, n = 0;
      for (let y = 2; y < h; y += 4) {
        for (let x = 2; x < w; x += 4) {
          n++;
          if (inCaps(frame, x, y)) caps++;
          else if (polys.covers(x, y) || inCaps(sill, x, y)) dash++;
        }
      }
      return { caps: caps / n, polys: dash / n };
    },
    /** the names shown, and those of them over the mask */
    labels() {
      const m = a.game.art.mask;
      const shown = a.labels.shown.map((s) => ({ ...s }));
      const bad = shown.filter((s) => m.covers(s.ox, s.oy) || m.overlapsRect(s.x, s.y, s.w, s.h));
      return { shown: shown.length, bad: bad.length, mask: m.capsules.length + m.polys.length };
    },
    /** a mesh's width on the screen (CSS px): its local x from -0.5 to 0.5 at its middle */
    width(mesh) {
      mesh.updateMatrixWorld(true);
      const p0 = new mesh.position.constructor(-0.5, 0, 0).applyMatrix4(mesh.matrixWorld);
      const p1 = new mesh.position.constructor(0.5, 0, 0).applyMatrix4(mesh.matrixWorld);
      const s0 = a.project(p0), s1 = a.project(p1);
      return s0 && s1 ? Math.hypot(s1.x - s0.x, s1.y - s0.y) : NaN;
    },
    /** the canvas's pixels (RGBA, bottom row first) after drawing the scene again as it stands */
    pixels() {
      a.renderer.render();
      const gl = a.renderer.gl.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { w, h, px };
    },
    /** of the pixels well inside the mask (1.5 CSS px in from its edge), how many differ between two frames, and how much at most */
    diffInMask(f0, f1) {
      const m = a.game.art.mask, ratio = f0.w / a.view.width;
      let n = 0, diff = 0, worst = 0;
      for (let y = 0; y < f0.h; y += 2) {
        for (let x = 0; x < f0.w; x += 2) {
          const cx = x / ratio, cy = (f0.h - 1 - y) / ratio;
          let inside = false;
          for (const c of m.capsules) {
            const dx = c.bx - c.ax, dy = c.by - c.ay, l2 = dx * dx + dy * dy;
            let t = l2 > 0 ? ((cx - c.ax) * dx + (cy - c.ay) * dy) / l2 : 0;
            t = Math.max(0, Math.min(1, t));
            const ex = c.ax + t * dx - cx, ey = c.ay + t * dy - cy;
            if (ex * ex + ey * ey <= Math.max(0, c.r - 2.5) ** 2) { inside = true; break; }
          }
          if (!inside) {
            for (const p of m.polys) if (m.covers(cx, cy) && m.covers(cx, cy - 3) && m.covers(cx, cy + 3) && m.covers(cx - 3, cy) && m.covers(cx + 3, cy)) { inside = true; break; }
          }
          if (!inside) continue;
          n++;
          const i = (y * f0.w + x) * 4;
          const d = Math.max(Math.abs(f0.px[i] - f1.px[i]), Math.abs(f0.px[i + 1] - f1.px[i + 1]), Math.abs(f0.px[i + 2] - f1.px[i + 2]));
          if (d > 3) diff++;
          worst = Math.max(worst, d);
        }
      }
      return { n, diff, worst };
    },
  };
};

/**
 * Draw with the orbit lines, the predicted path, its tags and the head-up markers, and without: what
 * changes inside the mask. (Without the bloom: a bright marker beside the frame glows a few levels
 * over it, as a camera's glare falls over everything; what is drawn is compared.)
 */
const overlaysOverMask = (page) => page.evaluate(() => {
  const a = window.app, g = a.game, t = window.shipTest;
  const groups = [a.orbits.group, g.viz.group, g.hud.group, a.trails?.group].filter(Boolean);
  const was = groups.map((o) => o.visible);
  const bloom = a.renderer.bloomStrength;
  a.renderer.bloomStrength = 0;
  const f1 = t.pixels();
  groups.forEach((o) => { o.visible = false; });
  const f0 = t.pixels();
  groups.forEach((o, i) => { o.visible = was[i]; });
  a.renderer.bloomStrength = bloom;
  // (how much the overlays draw anywhere, to know the test saw some)
  let drawn = 0;
  for (let i = 0; i < f0.px.length; i += 16) if (Math.abs(f0.px[i] - f1.px[i]) + Math.abs(f0.px[i + 1] - f1.px[i + 1]) + Math.abs(f0.px[i + 2] - f1.px[i + 2]) > 12) drawn++;
  return { ...t.diffInMask(f0, f1), drawn };
});

for (const orient of ['up', 'side']) {
  const landscape = orient === 'side';
  const ctx = await phoneContext(browser, { landscape });
  const page = await ctx.newPage();
  collectErrors(page, errors);
  await page.goto(`${base}?menu=0&time=${T}&target=Earth&dist=4&az=50&el=12&ship=cockpit`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.app && window.app.frameCount > 20 && !document.getElementById('boot'), null, { timeout: 600000 });
  await page.evaluate(() => { window.app.renderer.gl.setAnimationLoop(null); });
  await page.evaluate(HELPERS);
  await step(page, 10);
  const tag = landscape ? 'sideways' : 'upright';

  // ---- the cockpit
  let st = await page.evaluate(() => ({ mode: window.app.game.mode, members: window.app.game.cockpit.members.length, cov: window.shipTest.coverage(), screens: window.app.game.cockpit.edge.length }));
  check(`${tag}: the cockpit's frame is drawn and slim (its members above the dashboard cover under ${landscape ? 4.5 : 2} % of the screen)`,
    st.mode === 'cockpit' && st.members >= 6 && st.cov.caps > 0.002 && st.cov.caps < (landscape ? 0.045 : 0.02), `members ${st.members}, frame ${(st.cov.caps * 100).toFixed(2)} %`);
  check(`${tag}: on a touch screen the dashboard (its edge and the sill along it) is a band at the bottom (under ${landscape ? 12 : 22} % of the screen)`,
    st.cov.polys < (landscape ? 0.12 : 0.22), `dashboard ${(st.cov.polys * 100).toFixed(2)} %`);
  await page.screenshot({ path: path.join(outDir, `ship-${orient}-cockpit.png`), timeout: 300000 });
  st = await page.evaluate(() => window.shipTest.labels());
  check(`${tag}: no name lies over the cockpit's frame`, st.shown > 3 && st.bad === 0 && st.mask > 0, JSON.stringify(st));
  // a name whose object is turned behind a member of the frame goes too
  st = await page.evaluate(async () => {
    const a = window.app, m = a.game.art.mask;
    // the longest member segment on the screen, its middle
    let best = null;
    for (const c of m.capsules) {
      const len = Math.hypot(c.bx - c.ax, c.by - c.ay);
      const mx = (c.ax + c.bx) / 2, my = (c.ay + c.by) / 2;
      if (mx < 20 || my < 20 || mx > a.view.width - 20 || my > a.view.height - 20) continue;
      if (!best || len > best.len) best = { len, x: mx, y: my };
    }
    const shown = a.labels.shown.filter((s) => s.ox > 30 && s.oy > 30 && s.ox < a.view.width - 30 && s.oy < a.view.height - 30);
    if (!best || !shown.length) return { skipped: true };
    const s = shown[0];
    const key = s.c.key;
    const cam = a.renderer.camera;
    const dir = (x, y) => {
      const v = new cam.position.constructor((x / a.view.width) * 2 - 1, -(y / a.view.height) * 2 + 1, 0.5).unproject(cam);
      return v.sub(cam.getWorldPosition(new cam.position.constructor())).normalize();
    };
    const d0 = dir(s.ox, s.oy), d1 = dir(best.x, best.y);
    const R = new a.rig.quat.constructor().setFromUnitVectors(d1, d0);
    a.game.flight.ship.quat.premultiply(R);
    a.rig.quat.premultiply(R);
    for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 105)); a.frame(); }
    const el = a.labels.nodes.get(key);
    const p = a.project(d0.clone().multiplyScalar(1e20));
    return { key, hidden: !el || el.style.display === 'none', at: p && { x: Math.round(p.x), y: Math.round(p.y) }, member: { x: Math.round(best.x), y: Math.round(best.y) }, covered: p ? m.covers(p.x, p.y) : null };
  });
  check(`${tag}: a name whose object is behind the frame is hidden with it`, !!st.skipped === false && st.hidden && st.covered === true, JSON.stringify(st));
  await page.screenshot({ path: path.join(outDir, `ship-${orient}-behind.png`), timeout: 300000 });
  // the marker sizes, and the same at a lower resolution of the frame
  // (the tag nearest the middle of the view: one far off to the side is drawn wider, 1 / cos of its
  // angle off the view's axis, as anything flat facing the eye is in a perspective; it counts back)
  const sizes = () => page.evaluate(() => {
    const a = window.app, g = a.game, t = window.shipTest;
    const axis = new g.hud.target.mesh.position.constructor(0, 0, -1).applyQuaternion(a.view.quat);
    let tag = null;
    for (const x of g.viz.tags) {
      if (!x.mesh.visible) continue;
      x.mesh.updateMatrixWorld(true);
      const c = x.mesh.position.clone(), p = a.project(c);
      if (!p || p.x < 0 || p.y < 0 || p.x > a.view.width || p.y > a.view.height) continue;
      const cos = c.normalize().dot(axis);
      if (!tag || cos > tag.cos) tag = { mesh: x.mesh, cos };
    }
    return {
      bracket: g.hud.target.mesh.visible ? t.width(g.hud.target.mesh) : null,
      tag: tag ? t.width(tag.mesh) * tag.cos : null,
      offAxis: tag ? +((Math.acos(Math.min(1, tag.cos)) * 180) / Math.PI).toFixed(1) : null,
      ratio: a.view.pixelRatio,
    };
  });
  // (looking back at Earth, the target, with its orbit's tags in view)
  await page.evaluate(() => {
    const a = window.app, e = a.findByName('Earth');
    const d = e.upos.sub(a.rig.upos).normalize();
    const fwd = new d.constructor(0, 0, -1).applyQuaternion(a.rig.quat);
    const R = new a.rig.quat.constructor().setFromUnitVectors(fwd, d);
    a.game.flight.ship.quat.premultiply(R);
    a.rig.quat.premultiply(R);
  });
  await step(page, 3);
  // (No bracket or tag is drawn under the interface, nor half off the screen: Game's updateHud and
  // FlightViz.clearOf, since e1e9491. On a phone on its side the card and the ship's instruments meet
  // at the middle of the view, where Earth now is, so there the sizes are measured in photo mode, the
  // interface put away as a player does with a tap, and the view as it was; upright the middle is clear.)
  const photo = await page.evaluate(() => {
    const a = window.app, W = a.view.width, H = a.view.height, b = { l: W / 2 - 48, r: W / 2 + 48, t: H / 2 - 36, b: H / 2 + 44 };
    const under = a.hud.covers().some((c) => b.l < c.r + 4 && b.r > c.l - 4 && b.t < c.b + 4 && b.b > c.t - 4);
    if (under) a.act('photo');
    return under;
  });
  if (photo) await step(page, 3);
  const s1 = await sizes();
  await page.evaluate(() => { const r = window.app.renderer; r.renderScale = 0.6; r.setSize(window.innerWidth, window.innerHeight, r.pixelRatio); });
  await step(page, 3);
  const s2 = await sizes();
  await page.evaluate(() => { const r = window.app.renderer; r.renderScale = 1; r.setSize(window.innerWidth, window.innerHeight, r.pixelRatio); });
  if (photo) await page.evaluate(() => window.app.act('photo'));
  await step(page, 2);
  check(`${tag}: the target's brackets are 96 CSS px wide, also at a lower resolution`, Math.abs(s1.bracket - 96) < 4 && Math.abs(s2.bracket - 96) < 4, JSON.stringify({ s1, s2, photo }));
  check(`${tag}: the orbit's tags are 104 CSS px wide (their names about 11 px), also at a lower resolution`, s1.tag !== null && Math.abs(s1.tag - 104) < 4 && Math.abs(s2.tag - 104) < 4, JSON.stringify({ s1, s2, photo }));
  // overlays never over the frame
  st = await overlaysOverMask(page);
  check(`${tag}: orbit lines, the path, its tags and the markers never draw over the frame`, st.n > 200 && st.diff === 0 && st.drawn > 20, JSON.stringify(st));

  // ---- the chase view
  await page.evaluate(() => window.app.game.setMode('chase'));
  await step(page, 8);
  await page.screenshot({ path: path.join(outDir, `ship-${orient}-chase.png`), timeout: 300000 });
  st = await page.evaluate(() => {
    const a = window.app, s = a.game.ship;
    s.group.updateMatrixWorld(true);
    const c = new s.body.position.constructor(0, 0, 0).applyMatrix4(s.body.matrixWorld);
    const p = a.project(c);
    const el = p && document.elementFromPoint(p.x, p.y);
    // what is there: the canvas (or a name's text on the sky), not a card or a button of the interface
    const free = !!el && (el.tagName === 'CANVAS' || el.closest('.labels, #labels, .label') !== null || el.id === 'stage');
    return { p: p && { x: Math.round(p.x), y: Math.round(p.y) }, at: el ? `${el.tagName}.${el.className}` : null, free, w: a.view.width, h: a.view.height, mask: a.game.art.mask.capsules.length + a.game.art.mask.polys.length };
  });
  check(`${tag}: in the chase view the ship is on the screen and not under the interface`, st.p && st.p.x > 0 && st.p.x < st.w && st.p.y > 0 && st.p.y < st.h && st.free && st.mask > 0, JSON.stringify(st));
  st = await page.evaluate(() => window.shipTest.labels());
  check(`${tag}: no name lies over the ship`, st.bad === 0 && st.mask > 0, JSON.stringify(st));
  st = await overlaysOverMask(page);
  check(`${tag}: orbit lines, the path and its tags never draw over the ship`, st.n > 100 && st.diff === 0, JSON.stringify(st));
  // lit: the ship's pixels against the sky round it, turned from Earth (here behind the ship) with
  // the Sun behind the camera's shoulder
  await page.evaluate(() => {
    const a = window.app;
    const s = a.findByName('Sun').upos.sub(a.rig.upos).normalize();
    const d = a.findByName('Earth').upos.sub(a.rig.upos).normalize();
    // (60 degrees from straight away from the Sun, towards away from Earth)
    const away = d.clone().addScaledVector(s, -d.dot(s)).negate().normalize();
    const f = s.clone().negate().multiplyScalar(Math.cos(Math.PI / 3)).addScaledVector(away, Math.sin(Math.PI / 3)).normalize();
    const fwd = new d.constructor(0, 0, -1).applyQuaternion(a.rig.quat);
    const R = new a.rig.quat.constructor().setFromUnitVectors(fwd, f);
    a.game.flight.ship.quat.premultiply(R);
    a.rig.quat.premultiply(R);
  });
  // (the turn's lean dies away)
  await step(page, 14);
  await page.screenshot({ path: path.join(outDir, `ship-${orient}-chase-lit.png`), timeout: 300000 });
  st = await page.evaluate(() => {
    const a = window.app, t = window.shipTest, m = a.game.art.mask;
    const f = t.pixels(), ratio = f.w / a.view.width;
    let inS = 0, nIn = 0, out = 0, nOut = 0;
    for (let y = 0; y < f.h; y += 3) {
      for (let x = 0; x < f.w; x += 3) {
        const i = (y * f.w + x) * 4;
        const l = 0.2126 * f.px[i] + 0.7152 * f.px[i + 1] + 0.0722 * f.px[i + 2];
        const cx = x / ratio, cy = (f.h - 1 - y) / ratio;
        if (m.covers(cx, cy, -2)) { inS += l; nIn++; } else if (m.covers(cx, cy, 30)) { out += l; nOut++; }
      }
    }
    return { ship: +(inS / Math.max(nIn, 1)).toFixed(1), around: +(out / Math.max(nOut, 1)).toFixed(1), n: nIn };
  });
  check(`${tag}: the ship is lit by the Sun (brighter than the sky round it)`, st.n > 100 && st.ship > 30 && st.ship > st.around * 2.5, JSON.stringify(st));

  if (!landscape) {
    // the drive shows: the torch's plume and its heat, then the reactionless drive's band and no plume
    st = await page.evaluate(async () => {
      const a = window.app, f = a.game.flight, s = a.game.ship;
      f.ship.drive = 'torch';
      f.ship.throttle = 1;
      for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 50)); a.frame(); }
      const torch = { plume: s.plume.visible, level: s.plumeMat.uniforms.uCh.value[7], heat: s.hullMat.uniforms.uHeat.value, band: s.hullMat.uniforms.uCh.value[4] };
      f.ship.drive = 'reactionless';
      for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 50)); a.frame(); }
      const field = { plume: s.plume.visible, band: s.hullMat.uniforms.uCh.value[4], glow: s.lampMat.uniforms.uCh.value[4] };
      f.ship.throttle = 0;
      for (let i = 0; i < 4; i++) a.frame();
      return { torch, field };
    });
    check('the torch shows its plume and heats the radiators; the reactionless drive its band and no plume',
      st.torch.plume && st.torch.level > 0.3 && st.torch.heat > 0.05 && st.torch.band < 0.01 && !st.field.plume && st.field.band > 0.5 && st.field.glow > 0.3, JSON.stringify(st));
    // what it costs: draw calls and triangles, the ship and the cockpit shown and hidden
    st = await page.evaluate(() => {
      const a = window.app, g = a.game, r = a.renderer.gl;
      const count = () => { r.info.reset(); a.renderer.render(); return { calls: r.info.render.calls, tris: r.info.render.triangles }; };
      r.info.autoReset = false;
      const chase = count();
      g.ship.group.visible = false;
      const none = count();
      g.ship.group.visible = true;
      g.setMode('cockpit');
      a.frame();
      const cockpit = count();
      g.cockpit.group.visible = false;
      const none2 = count();
      g.cockpit.group.visible = true;
      r.info.autoReset = true;
      return { ship: { calls: chase.calls - none.calls, tris: chase.tris - none.tris }, cockpit: { calls: cockpit.calls - none2.calls, tris: cockpit.tris - none2.tris } };
    });
    check('the ship and the cockpit are cheap to draw (a few draw calls, under 20,000 triangles each)',
      st.ship.calls <= 6 && st.ship.tris < 20000 && st.cockpit.calls <= 8 && st.cockpit.tris < 20000, JSON.stringify(st));
  }
  await ctx.close();
}

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
