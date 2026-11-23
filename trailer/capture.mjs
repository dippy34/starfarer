// Frame-by-frame capture of the trailer's shots from a production build of the app.
//
// Software WebGL draws a frame every few seconds, so nothing here runs in real time. The page's
// requestAnimationFrame and performance.now are replaced (an init script, before the app loads):
// the app boots on the real clock, then the capture takes the clock and turns it by hand, one
// exact 1/fps step per frame, and reads the canvas right after the app's frame has drawn it. The
// footage is perfectly smooth however long each frame takes.
//
// Usage:
//   node trailer/capture.mjs [--base http://127.0.0.1:4178/] [--out DIR] [--scale 3]
//                            [--only id,id] [--stills N] [--fps 30] [--shots file.mjs]
//   --scale   device pixel ratio on the 360x640 CSS viewport: 3 = 1080x1920, 1.5 = 540x960 draft
//   --stills  look-development: only N evenly spaced frames per shot (still with full pre-roll)
//
// Writes DIR/<shot id>/f0000.png ... and DIR/<shot id>/info.json (what the app reported).
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from '../scripts/lib/browser.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const base = arg('base', 'http://127.0.0.1:4178/');
const out = arg('out', 'trailer-frames');
const scale = Number(arg('scale', 3));
const fps = Number(arg('fps', 30));
const stills = Number(arg('stills', 0));
const only = arg('only', '')?.split(',').filter(Boolean);
// (another shot list, e.g. candidates being tried out)
const { SHOTS, VIEW } = await import(new URL(arg('shots', './shots.mjs'), `file://${process.cwd()}/trailer/`).href);
const LONG = 15 * 60_000; // a frame can take minutes on a loaded machine

/**
 * Runs in the page before anything else. While `__crank.on` is false everything is as usual;
 * once on, rAF callbacks wait in a queue until step(), and performance.now() reads the virtual
 * time. Inside a frame the virtual clock still moves on with the real one, but at most `cap` ms
 * (less than a step): code that budgets its work by the clock (texture uploads, the galaxy
 * cloud's fill, terrain) gets its usual few milliseconds, and the clock never runs backwards.
 */
function crankScript() {
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  const C = { on: false, t: 0, cap: 25, startReal: 0, queue: new Map(), id: 1e9, css: false };
  window.__crank = C;
  performance.now = () => (C.on ? C.t + Math.min(realNow() - C.startReal, C.cap) : realNow());
  window.requestAnimationFrame = (cb) => {
    if (!C.on) return realRaf(cb);
    const id = ++C.id;
    C.queue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => { if (!C.queue.delete(id)) realCancel(id); };
  C.start = () => { C.t = realNow(); C.startReal = realNow(); C.on = true; };
  /** advance the virtual clock by `ms` and run the frame callbacks that were waiting */
  C.step = (ms) => {
    C.t += ms;
    C.startReal = realNow();
    // (the interface's CSS transitions too, when it is in the picture: each runs on the virtual
    // clock, a step a frame, from the frame it began in; else they would end between two frames)
    if (C.css) for (const an of document.getAnimations()) { if (an.__v) an.currentTime += ms; }
    const q = [...C.queue.values()];
    C.queue.clear();
    for (const cb of q) cb(C.t);
    if (C.css) for (const an of document.getAnimations()) { if (!an.__v) { an.__v = true; an.pause(); an.currentTime = 0; } }
  };
}

/**
 * Helpers the shots' camera functions use in the page (window.__T). Positions are relative to a
 * body at the current date: the hook runs inside the app's frame right after the bodies have
 * moved, so a camera tied to a body never lags behind it.
 */
function helperScript() {
  const T = {};
  window.__T = T;
  T.app = () => window.app;
  T.V = (x = 0, y = 0, z = 0) => new (window.app.rig.upos.sub(window.app.rig.upos).constructor)(x, y, z);
  T.Q = () => window.app.rig.quat.clone().identity();
  T.body = (name) => {
    const o = window.app.findByName(name);
    if (!o) throw new Error(`no object named ${name}`);
    return o;
  };
  T.DEG = Math.PI / 180;
  T.AU = 1.495978707e11;
  T.PC = 3.0856775814913673e16;
  T.clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  T.lerp = (a, b, t) => a + (b - a) * t;
  /** smooth start and stop (cubic) */
  T.ease = (t) => { t = T.clamp(t); return t * t * (3 - 2 * t); };
  /** smoother (quintic): a gentler start for long moves */
  T.ease5 = (t) => { t = T.clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };
  /** from a to b in log space (big pull-outs: an even pace in scale) */
  T.logLerp = (a, b, t) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t);
  /** the rotation axis of a body (its orientation's third column) */
  T.pole = (b) => T.V().setFromMatrixColumn(b.orientation, 2).normalize();
  /** unit vector from `obj` towards the Sun */
  T.sunward = (obj) => { const v = window.app.system.sun.upos.sub(obj.upos, T.V()); return v.lengthSq() > 1 ? v.normalize() : T.V(1, 0, 0); };
  /**
   * Unit vector from `obj`: its sunward direction laid into the plane square to `axis`, turned
   * `az` degrees about `axis`, then raised `el` degrees towards it (a ringed planet: about its pole).
   */
  T.around = (obj, axis, az, el) => {
    const s = T.sunward(obj);
    const flat = s.clone().addScaledVector(axis, -s.dot(axis)).normalize();
    const d = flat.applyAxisAngle(axis, az * T.DEG);
    return d.multiplyScalar(Math.cos(el * T.DEG)).addScaledVector(axis, Math.sin(el * T.DEG)).normalize();
  };
  /** Camera at `dist` (m) from `obj`, `az`/`el` degrees from its sunward side (as App.placeNear), looking at it. */
  T.place = (obj, dist, az, el) => window.app.placeNear(obj, dist, az, el);
  /** Camera at `obj` + `dir` * `dist`, looking along `look` with `up` (world vectors). */
  T.put = (obj, dir, dist, look, up) => {
    const a = window.app;
    a.rig.upos.copy(obj.upos).addVec(dir.clone().normalize(), dist);
    a.rig.lookAt(look.clone().normalize(), up);
    a.rig.target = obj;
    a.rig.setAnchor(obj);
  };
  /** turn the view after placing it: yaw left (+), pitch up (+), roll (deg), about the view's own axes */
  T.turn = (yaw = 0, pitch = 0, roll = 0) => {
    const q = window.app.rig.quat, r = T.Q();
    if (yaw) q.multiply(r.setFromAxisAngle(T.V(0, 1, 0), yaw * T.DEG));
    if (pitch) q.multiply(r.setFromAxisAngle(T.V(1, 0, 0), pitch * T.DEG));
    if (roll) q.multiply(r.setFromAxisAngle(T.V(0, 0, 1), roll * T.DEG));
  };
  /** set the date (TDB Julian day) for this frame */
  T.jdOf = (iso) => {
    // UTC to TDB: TT = UTC + 69.184 s (leap seconds as of 2017); TDB - TT is under 2 ms
    return Date.parse(iso) / 86400000 + 2440587.5 + 69.184 / 86400;
  };
}

/** The app's state worth recording beside each shot. */
const STATE = () => {
  const a = window.app, s = a.debugState(), c = a.renderer.gl.domElement;
  return { canvas: [c.width, c.height], renderScale: a.renderer.renderScale, pixelRatio: a.renderer.pixelRatio, exposure: s.exposure, starExposure: s.starExposure, mLim: s.mLim, pendingTiles: s.pendingTiles, proceduralPending: s.proceduralPending, textures: a.renderer.gl.info.memory.textures, lean: a.lean, jd: s.jd, selection: s.selection, ...(window.__T.extra ? { extra: window.__T.extra(a) } : {}) };
};

async function settle(page, label) {
  // loading has settled when nothing is streaming and the GPU's texture count holds still
  let calm = 0, last = -1;
  for (let i = 0; i < 400 && calm < 6; i++) {
    const s = await page.evaluate((ms) => { window.__crank.step(ms); const a = window.app, d = a.debugState(); return { busy: d.pendingTiles + d.proceduralPending, tex: a.renderer.gl.info.memory.textures }; }, 1000 / fps);
    calm = s.busy === 0 && s.tex === last ? calm + 1 : 0;
    last = s.tex;
    await page.waitForTimeout(250);
  }
  if (calm < 6) console.log(`${label}: loading did not settle`);
}

/**
 * Toasts run on the virtual clock: one stays up for its seconds of the shot's time (the app times
 * it with a real-time timer, which would end it between two frames), and every toast is noted with
 * its time for info.json (a clean shot hides them, but what the app told is on record).
 */
const VIRTUAL_TOASTS = () => {
  const a = window.app, T = window.__T, h = a.hud;
  T.toasts = [];
  h.toast = (msg, seconds = 2.2) => {
    h.toastEl.textContent = msg;
    h.toastEl.classList.add('show');
    T.toastEnd = T.s + seconds;
    T.toasts.push({ s: +T.s.toFixed(3), msg });
  };
};

/**
 * Where a tap lands: the middle of a name in the sky (`label`) or of a visible button (`button`, or `sel`, a CSS selector),
 * `fx`, `fy` of the way across it; or `pt`, a function of the page (T, app) that gives {x, y} in CSS px (a world on the
 * screen, a slider's knob: found where it is at that moment).
 */
const TAP_AT = ({ label, button, sel, fx = 0.5, fy = 0.5, pt }) => {
  if (pt) return eval(`(${pt})`)(window.__T, window.app);
  const el = label
    ? [...document.querySelectorAll('#labels *')].find((e) => e.textContent === label)
    : sel ? [...document.querySelectorAll(sel)].find((b) => b.offsetParent !== null)
      : [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === button && b.offsetParent !== null);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width * fx, y: r.y + r.height * fy };
};
/** a tap's functions, as source the page can run (`pt`: where it lands; `toPt`: where a drag ends; `run`: something the page does then) */
const wire = (t) => ({ ...t, pt: t.pt?.toString(), toPt: t.toPt?.toString(), run: t.run?.toString() });

async function shoot(browser, shot) {
  // (an interface shot may use a phone's own viewport and its own density: it is shown inside a phone)
  const view = shot.view ?? VIEW;
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: shot.scale ?? scale, isMobile: true, hasTouch: true });
  await ctx.addInitScript(crankScript);
  await ctx.addInitScript(helperScript);
  const page = await ctx.newPage();
  page.setDefaultTimeout(LONG);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto(base + shot.url, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.app && window.app.frameCount > 20 && !document.getElementById('boot'), null, { timeout: LONG });
  // the interface: hidden for a clean shot (names, orbit lines, toasts too), else as the shot says
  await page.evaluate((clean) => {
    const a = window.app;
    if (clean) {
      a.hud.setHidden(true);
      a.labels.enabled = false;
      a.orbits.enabled = false;
      a.rig.aim = 0; // (the subject sits mid-frame when no card takes the foot of the screen)
    }
  }, shot.ui !== true);
  if (shot.ui !== true) await page.addStyleTag({ content: '.hud-toast{display:none!important}' });
  await page.evaluate(VIRTUAL_TOASTS);
  if (shot.setup) await page.evaluate(`(${shot.setup})(window.__T, window.app)`);
  // take the clock; from here the shot's own function places the camera and sets the date each frame
  await page.evaluate(({ pose, date, fps, ui }) => {
    const a = window.app, T = window.__T;
    T.pose = eval(`(${pose})`);
    T.s = 0;
    const jd0 = T.jdOf(date.at), rate = date.rate ?? 0;
    if (date.free) {
      // the app's own clock (a change's watch, the ship's flight set its rate): from the date, at its rate
      a.clock.jdTdb = jd0;
      a.clock.paused = !rate;
      if (rate) a.clock.rate = rate;
    } else {
      // the date is a function of the shot's time alone (not of how many frames loading took)
      a.clock.paused = false;
      a.clock.rate = rate || 1;
      a.clock.advance = () => { a.clock.jdTdb = jd0 + (rate * Math.max(T.s, date.from ?? -1e9)) / 86400; };
      a.clock.advance();
    }
    const follow = a.rig.followAnchor.bind(a.rig);
    a.rig.followAnchor = () => {
      follow();
      T.pose(T, a, T.s);
      if (T.toastEnd !== undefined && T.s >= T.toastEnd) { a.hud.toastEl.classList.remove('show'); T.toastEnd = undefined; }
    };
    T.pose(T, a, 0); // (the date and place for the first frame)
    window.__crank.start();
    window.__crank.css = ui;
    window.__fps = fps;
  }, { pose: shot.pose.toString(), date: shot.date, fps, ui: !!shot.ui });
  const setS = (s) => page.evaluate((s) => { window.__T.s = s; }, s);
  await setS(-shot.preroll);
  await settle(page, shot.id);
  const boot = (Date.now() - t0) / 1000;
  // pre-roll: frames not kept, so the eye's adaptation, bloom and the stars' motion are under way
  const n = Math.round(shot.seconds * fps);
  const pre = Math.round(shot.preroll * fps);
  for (let i = -pre; i < 0; i++) {
    await page.evaluate(({ s, ms }) => { window.__T.s = s; window.__crank.step(ms); }, { s: i / fps, ms: 1000 / fps });
  }
  const dir = `${out}/${shot.id}`;
  mkdirSync(dir, { recursive: true });
  // (stills: N evenly spaced frames; a shot's `keep`: only frames in those [from, to] s ranges are saved, all are run)
  const keep = stills ? new Set(Array.from({ length: stills }, (_, k) => Math.round((k * (n - 1)) / Math.max(stills - 1, 1))))
    : shot.keep ? new Set(Array.from({ length: n }, (_, i) => i).filter((i) => shot.keep.some(([a, b]) => i / fps >= a - 1e-9 && i / fps <= b + 1e-9))) : null;
  const states = [];
  const taps = [];
  const cdp = shot.taps ? await ctx.newCDPSession(page) : null;
  let touchClock = Date.now() / 1000;
  let drag = null;
  const t1 = Date.now();
  let kept = 0, keptTime = 0;
  for (let i = 0; i < n; i++) {
    const s = i / fps;
    // a finger on the glass (real touch events, as a phone sends them), between two frames
    for (const tap0 of (shot.taps ?? []).filter((t) => t.at >= s - 1e-9 && t.at < s + 1 / fps - 1e-9)) {
      const tap = wire(tap0);
      // (something the page does at this time, no finger: a name typed, a view set up)
      if (tap.run) { await page.evaluate(`(${tap.run})(window.__T, window.app)`); continue; }
      const p = await page.evaluate(TAP_AT, tap);
      if (!p) { console.log(`${shot.id}: nothing to tap for ${JSON.stringify(tap)}`); continue; }
      const point = [{ x: p.x, y: p.y, id: 0, radiusX: 9, radiusY: 9, force: 0.5 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point, timestamp: (touchClock += 0.5) });
      taps.push({ frame: i, x: p.x / view.width, y: p.y / view.height, what: tap.label ?? tap.button ?? tap.sel ?? 'point' });
      // a drag (tap.to: { fx, fy }, where the finger ends as shares of the element's size, over tap.dur s): the
      // finger stays down and moves a step each frame; else it lifts at once
      if (tap.to !== undefined || tap.toPt) drag = { tap, from: p, to: tap.toPt ? await page.evaluate(TAP_AT, { pt: tap.toPt }) : await page.evaluate(TAP_AT, { ...tap, ...tap.to }), i0: i, n: Math.max(1, Math.round(tap.dur * fps)), hold: Math.round((tap.hold ?? 0) * fps) };
      else await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: (touchClock += 0.06) });
    }
    if (drag && i > drag.i0) {
      // (then the finger rests there for tap.hold s before it lifts)
      const k = Math.min(1, (i - drag.i0) / drag.n), e = k * k * (3 - 2 * k), done = i - drag.i0 >= drag.n + drag.hold;
      // (tap.live: the end is found again each frame, and the finger keeps to its height: a slider moves on the page as
      // the card round it changes, and the finger follows it up or down as a real one would)
      if (drag.tap.live) drag.to = await page.evaluate(TAP_AT, { pt: drag.tap.toPt });
      const x = drag.from.x + (drag.to.x - drag.from.x) * e, y = drag.tap.live ? drag.to.y : drag.from.y + (drag.to.y - drag.from.y) * e;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 0, radiusX: 9, radiusY: 9, force: 0.5 }], timestamp: (touchClock += 0.033) });
      taps.push({ frame: i, x: x / view.width, y: y / view.height, what: 'drag', held: !done });
      if (done) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: (touchClock += 0.06) }); drag = null; }
    }
    const tk = Date.now();
    // content that streams in as the camera moves: let the requests made last frame arrive first
    // (only the catalogue's tiles: generated stars arrive in a frame, so waiting for them without one is waiting forever)
    if (shot.waitLoad) await page.waitForFunction(() => window.app.debugState().pendingTiles === 0, null, { timeout: 2000, polling: 100 }).catch(() => {});
    if (keep && !keep.has(i)) {
      await page.evaluate(({ s, ms }) => { window.__T.s = s; window.__crank.step(ms); }, { s, ms: 1000 / fps });
      continue;
    }
    if (shot.ui) {
      // the interface is in the picture: the page as composited
      await page.evaluate(({ s, ms }) => { window.__T.s = s; window.__crank.step(ms); }, { s, ms: 1000 / fps });
      await page.screenshot({ path: `${dir}/f${String(i).padStart(4, '0')}.png`, timeout: LONG });
    } else {
      const url = await page.evaluate(({ s, ms }) => {
        window.__T.s = s;
        window.__crank.step(ms);
        return window.app.renderer.gl.domElement.toDataURL('image/png');
      }, { s, ms: 1000 / fps });
      writeFileSync(`${dir}/f${String(i).padStart(4, '0')}.png`, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    }
    kept++;
    keptTime += Date.now() - tk;
    if (i % 15 === 0 || stills) {
      const st = await page.evaluate(STATE);
      states.push({ frame: i, ...st });
      console.log(`${shot.id} ${i + 1}/${n} ${(keptTime / 1000 / kept).toFixed(1)} s/frame ${JSON.stringify(st)}`);
    }
  }
  const perFrame = keptTime / 1000 / Math.max(kept, 1);
  const told = await page.evaluate(() => window.__T.toasts);
  const total = (Date.now() - t0) / 1000;
  writeFileSync(`${dir}/info.json`, JSON.stringify({ id: shot.id, url: shot.url, ui: !!shot.ui, frame: shot.frame ?? (shot.ui ? 'phone' : 'full'), toasts: told, view, scale: shot.scale ?? scale, fps, frames: n, boot, perFrame, total, taps, states, errors: errors.slice(0, 20) }, null, 1));
  console.log(`${shot.id}: boot+settle ${boot.toFixed(0)} s, ${perFrame.toFixed(2)} s per kept frame, ${total.toFixed(0)} s in all, ${errors.length} page errors`);
  await ctx.close();
}

const browser = await launchBrowser();
try {
  for (const shot of SHOTS.filter((s) => !only?.length || only.includes(s.id))) await shoot(browser, shot);
} finally {
  await browser.close();
}
