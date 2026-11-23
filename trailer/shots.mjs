// The trailer's shots as data. Each shot opens the app at a deep link (`url`), then its `pose`
// places the camera every frame from the shot's time `s` (seconds; negative during the pre-roll).
// `pose` and `setup` run inside the page with the helpers of capture.mjs (T) and the app (a):
// write them as arrow functions with no outside references.
//
//   id        folder name for the frames (timeline.py refers to it)
//   url       query string: where the app starts (it also loads the right content first).
//             earthref=0: no "Earth for scale" disc on the worlds (unexplained, it reads as a glitch)
//   date      { at: ISO date (UTC), rate: simulated seconds per real second, free: true: the app's
//             own clock from that date (a change's watch and the ship's flight set its rate) }
//   seconds   footage kept (the edit uses the first part; the rest is handle for a dissolve)
//   preroll   seconds stepped before the first kept frame (exposure, bloom, motion settle)
//   ui        true: the interface stays in the picture (whole-page screenshots, toasts and CSS
//             transitions on the shot's clock)
//   frame     for an interface shot: 'phone' (shown inside a drawn phone) or 'full' (the screen
//             itself fills the frame; a screen taller than 9:16 fills its height)
//   view, scale  that shot's own CSS viewport and density (an iPhone's: 390 x 844)
//   taps      [{ at: s, label: name in the sky | button: text | sel: CSS selector, fx, fy: where on
//             it (shares of its size), to: { fx, fy }, dur: a drag there over dur s, hold: the finger
//             rests there this long, live: true: the end is found afresh each frame and the finger keeps its height (a slider) }]: real touch events at those times. Or where a function of the
//             page finds it: pt: (T, a) => ({ x, y }) in CSS px (a world on the screen, a slider's
//             knob), toPt: the same for where a drag ends; run: (T, a) => ... does something then, no
//             finger
//   setup     may be async (the page runs on while it waits: a view found for room, say)
//   waitLoad  give streamed star tiles up to 2 s to arrive before each frame (long camera moves)

/** CSS viewport: a small phone held upright. At device scale 3 the canvas is 1080x1920. */
export const VIEW = { width: 360, height: 640 };

export const SHOTS = [
  {
    // cold open: the Sun's limb, its corona and prominences standing on it; a push in and a turn
    id: 'sun',
    url: '?menu=0&earthref=0&target=Sun&dist=2&paused=1&time=2026-11-21T12:00:00Z',
    date: { at: '2026-11-21T12:00:00Z', rate: 0 },
    seconds: 3,
    preroll: 1,
    pose: (T, a, s) => {
      const sun = T.body('Sun');
      T.place(sun, sun.radius * T.lerp(2.1, 1.75, T.ease(s / 5)), 30 + s * 1.5, 0);
      T.turn(0, 30, T.lerp(-4, 8, s / 5));
      a.rig.fov = 50;
    },
  },
  {
    // Saturn with the rings wide open (2017) and the planet's shadow across them; a slow turn
    id: 'saturn',
    url: '?menu=0&earthref=0&target=Saturn&dist=6&paused=1&time=2017-06-15T00:00:00Z',
    date: { at: '2017-06-15T00:00:00Z', rate: 0 },
    seconds: 3.5,
    preroll: 1,
    pose: (T, a, s) => {
      const S = T.body('Saturn');
      const p = T.pole(S);
      if (T.sunward(S).dot(p) < 0) p.negate(); // (above the sunlit face of the rings)
      const d = T.around(S, p, 58 + s * 2.5, 20);
      T.put(S, d, S.radius * T.lerp(6.4, 5.7, T.ease(s / 3.5)), d.clone().negate(), p);
      T.turn(0, 0, 30);
      a.rig.fov = 50;
    },
  },
  // a run of one-beat shots: what else is there. Each with a push in and a turn you can see.
  {
    id: 'orion',
    url: '?menu=0&earthref=0&target=Orion%20Nebula&dist=1.6&paused=1&time=2026-11-21T12:00:00Z',
    date: { at: '2026-11-21T12:00:00Z', rate: 0 },
    seconds: 2,
    preroll: 1,
    pose: (T, a, s) => { const o = T.body('Orion Nebula'); T.place(o, o.radius * T.lerp(1.75, 1.5, T.ease(s / 2)), 28 + s * 4, 10); a.rig.fov = 50; },
  },
  {
    id: 'andromeda',
    url: '?menu=0&earthref=0&target=Andromeda&dist=2.6&az=30&el=30&paused=1&time=2026-11-21T12:00:00Z',
    date: { at: '2026-11-21T12:00:00Z', rate: 0 },
    seconds: 2,
    preroll: 1,
    pose: (T, a, s) => { const o = T.body('Andromeda'); T.place(o, o.radius * T.lerp(2.7, 2.3, T.ease(s / 2)), 30 + s * 4, 30); a.rig.fov = 50; },
  },
  {
    // the ship from behind (the chase view, as a phone boards it): SF-07 on its radiators, its
    // nav lights, the reactionless drive's blue band lit, Jupiter ahead. The flight is the app's
    // own (its physics move the ship); the shot only turns the ship, a slow yaw, by its attitude.
    id: 'chase',
    url: '?menu=0&earthref=0&target=Jupiter&dist=5&az=50&el=10&paused=1&time=2026-11-24T01:45:00Z&ship=chase',
    date: { at: '2026-11-24T01:45:00Z', rate: 1, free: true },
    seconds: 3,
    preroll: 1,
    setup: (T, a) => { a.select(null); },
    pose: (T, a, s) => {
      const f = a.game.flight, B = T.body('Jupiter');
      a.game.viz.group.visible = false;
      f.ship.drive = 'reactionless';
      f.ship.throttle = 1;
      T.up ??= T.pole(B);
      a.rig.lookAt(B.upos.sub(a.rig.upos, T.V()).normalize(), T.up);
      f.ship.quat.copy(a.rig.quat).multiply(T.Q().setFromAxisAngle(T.V(0, 1, 0), (9 - 9 * T.ease(s / 3)) * T.DEG)).multiply(T.Q().setFromAxisAngle(T.V(1, 0, 0), -6 * T.DEG));
      f.ship.angVel.set(0, 0, 0);
    },
  },
  {
    // flying it by hand on a phone, the interface on, full frame (names and orbit lines off, as
    // More allows): a thumb slides the thrust lever to the top and the fusion torch lights, its
    // plume and its radiators heating; then a tap on the view switch, and the same from the cockpit
    id: 'ship',
    ui: true,
    frame: 'full',
    url: '?menu=0&earthref=0&target=Saturn&dist=8&az=35&el=12&paused=1&time=2017-06-15T00:00:00Z&ship=chase',
    date: { at: '2017-06-15T00:00:00Z', rate: 1, free: true },
    seconds: 5,
    preroll: 1,
    taps: [{ at: 0.5, sel: '.fl-lever', fy: 0.92, to: { fy: 0.06 }, dur: 0.6 }, { at: 2.9, sel: '.fl-view' }],
    setup: (T, a) => {
      a.select(null);
      a.labels.enabled = false;
      a.orbits.enabled = false;
      // (no toasts: the view switch's says the desk's keys, "W/S throttle...", under the instruments)
      const st = document.createElement('style');
      st.textContent = '.hud-toast{display:none!important}';
      document.head.append(st);
    },
    pose: (T, a, s) => {
      const f = a.game.flight, B = T.body('Saturn');
      a.game.viz.group.visible = false;
      T.up ??= T.pole(B);
      a.rig.lookAt(B.upos.sub(a.rig.upos, T.V()).normalize(), T.up);
      f.ship.quat.copy(a.rig.quat).multiply(T.Q().setFromAxisAngle(T.V(0, 1, 0), (7 - 7 * T.ease(s / 5)) * T.DEG)).multiply(T.Q().setFromAxisAngle(T.V(1, 0, 0), 3 * T.DEG));
      f.ship.angVel.set(0, 0, 0);
    },
  },
  {
    // M87*: from far off a steady point on its jet, growing into its disk as the camera comes in
    // from 6,000 to 20 times the horizon's radius, a little above the disk and turning round it
    id: 'm87',
    url: '?menu=0&earthref=0&target=M87*&dist=6000&paused=1&time=2026-11-21T12:00:00Z',
    date: { at: '2026-11-21T12:00:00Z', rate: 1 },
    seconds: 4.6,
    preroll: 1,
    pose: (T, a, s) => {
      const h = T.body('M87*'), n = h.diskNormal.clone();
      const sun = T.sunward(h);
      const flat = sun.clone().addScaledVector(n, -sun.dot(n)).normalize().applyAxisAngle(n, s * 6 * T.DEG);
      const dir = flat.multiplyScalar(Math.cos(8 * T.DEG)).addScaledVector(n, Math.sin(8 * T.DEG)).normalize();
      a.rig.upos.copy(h.upos).addVec(dir, h.radius * T.logLerp(6000, 20, T.ease(Math.max(0, s) / 4.6)));
      a.rig.lookAt(dir.clone().negate(), n);
      T.turn(0, -4 * T.ease(s / 4.6));
      a.rig.target = h;
      a.rig.setAnchor(null);
      a.rig.fov = 50;
    },
  },
  // god mode, filmed on the owner's phone's screen (an iPhone's 390 x 844), full frame: the app's own
  // interface, every touch a real touch event (the rings the edit draws are where they were)
  {
    // The Moon thrown like a slingshot: its card, Move, Throw; a finger on the Moon, pulled back to the
    // mark of escape (the arrow, the marks, the path ahead and the card's words are the app's); let go,
    // and it flies. The view is found for room (as the suite does): over the Earth, the Moon in the open
    // with room ahead of it for the arrow and behind it for the pull. Time is the app's from the release.
    id: 'throw',
    ui: true,
    frame: 'full',
    view: { width: 390, height: 844 },
    url: '?menu=0&earthref=0&target=Earth&dist=6&paused=1&time=2026-11-21T12:00:00Z',
    date: { at: '2026-11-21T12:00:00Z', rate: 0, free: true },
    seconds: 7,
    preroll: 1,
    taps: [
      { at: 0.4, sel: '#hud .card [data-act="move"]' },
      { at: 0.9, sel: '#hud .card [data-act="move-throw"]' },
      {
        // pulled back 152 px, the mark of escape being at 1.414 x 107 px, and held while the path ahead is run
        at: 1.5, dur: 0.8, hold: 1.0,
        pt: (T, a) => T.moonAt(),
        toPt: (T, a) => { const d = T.moonAt(), u = T.aheadDir; return { x: d.x - u.x * 152, y: d.y - u.y * 152 }; },
      },
    ],
    setup: async (T, a) => {
      T.s = 0; // (a toast in the setup's own frames is told at the shot's time 0)
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const earth = T.body('Earth'), moon = T.body('Moon'), V = moon.pos.constructor;
      a.select(moon);
      // (Move and Throw on for a moment, for the card's size then: the view is found with the room it leaves)
      a.mover.toggle(moon);
      a.mover.leave('throw');
      await wait(1500);
      const walls = [...document.querySelectorAll('#hud .sheet.card, #hud .hud-tabs, #hud .chip, #hud .live-mark, #hud .fab, #hud .hud-watch')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
      const open = (p) => !!p && p.x > 20 && p.x < innerWidth - 20 && p.y > 130 && p.y < innerHeight - 20 && walls.every((r) => p.x < r.left - 10 || p.x > r.right + 10 || p.y < r.top - 10 || p.y > r.bottom + 10);
      const seen = (p) => p.x > 8 && p.x < innerWidth - 8 && p.y > 8 && p.y < innerHeight - 8;
      // (first with the finger, at the end of its pull, clear of the interface's buttons; else without that)
      let found = null;
      for (const clearOfButtons of [true, false]) {
        for (const el of [75, 60, 45]) for (const dist of [60, 90, 120, 180, 260, 350]) for (let az = 0; az < 360; az += 15) {
          if (found) break;
          a.placeNear(earth, dist * earth.radius, az, el);
          a.frame();
          const r = moon.pos.clone().sub(earth.pos), ahead = r.clone().cross(moon.vel.clone().sub(earth.vel)).cross(r).normalize();
          const dot = a.project(moon.upos.sub(a.rig.upos, new V())), tip = a.project(moon.upos.sub(a.rig.upos, new V()).addScaledVector(ahead, 1e5));
          if (!dot || !tip) continue;
          const l = Math.hypot(tip.x - dot.x, tip.y - dot.y), ux = (tip.x - dot.x) / l, uy = (tip.y - dot.y) / l;
          const back = { x: dot.x - ux * 152, y: dot.y - uy * 152 };
          if ([0, 60, 120, 175].every((d) => open({ x: dot.x + ux * d, y: dot.y + uy * d })) && [60, 120, 175].every((d) => seen({ x: dot.x - ux * d, y: dot.y - uy * d }))
            && (!clearOfButtons || walls.every((r) => back.x < r.left - 25 || back.x > r.right + 25 || back.y < r.top - 25 || back.y > r.bottom + 25))) found = { el, dist, az, ux, uy, clearOfButtons };
        }
        if (found) break;
      }
      a.mover.stop();
      T.moonAt = () => a.project(a.bodies.views.get(moon).rel);
      T.aheadDir = { x: found?.ux ?? 1, y: found?.uy ?? 0 };
      T.extra = () => ({ view: found });
      await wait(800);
    },
    pose: (T, a, s) => {
      if (a.physics.live) a.physics.live.sim.now = () => 0;
      // (a toast of the first moments, "Discovered: Sun", is not this shot's)
      if (s < 1.6) a.hud.toastEl.classList.remove('show');
    },
  },
  {
    // A world made: on the Sun's card, Add, "A planet like Earth": Earth 2 appears, time waits. The camera
    // goes in to it for the mass (a slide to 5 Earths: its size is seen to grow, 1.71 times), back out for
    // the drag (half as far again from the Sun, the finger resting a moment before it lifts); then Done,
    // and the watch (the app's own). The move in and out is the shot's (the app's own camera, from where
    // it was, to near the world and back); the rest is the app's.
    id: 'place',
    ui: true,
    frame: 'full',
    view: { width: 390, height: 844 },
    url: '?menu=0&earthref=0&target=Sun&dist=473&el=40&paused=1&time=2026-11-21T12:00:00Z',
    date: { at: '2026-11-21T12:00:00Z', rate: 0, free: true },
    seconds: 9.5,
    keep: [[0, 9.2]],
    preroll: 1,
    taps: [
      { at: 0.3, sel: '#hud .card [data-power="add"]' },
      { at: 0.8, sel: '#hud .card [data-act="add-earth"]' },
      {
        // its mass to 5 Earths
        at: 2.9, dur: 0.8, hold: 0.3, live: true,
        pt: (T, a) => { const s = document.querySelector('#hud .card .placing .slider'), r = s.getBoundingClientRect(); return { x: r.x + 15 + Number(s.value) * (r.width - 30), y: r.y + r.height / 2 }; },
        toPt: (T, a) => { const s = document.querySelector('#hud .card .placing .slider'), r = s.getBoundingClientRect(); return { x: r.x + 15 + (Math.log(5 / 0.05) / Math.log(10 / 0.05)) * (r.width - 30), y: r.y + r.height / 2 }; },
      },
      {
        // dragged out half as far again, the finger resting before it lifts
        at: 5.0, dur: 0.8, hold: 0.25,
        pt: (T, a) => { const m = a.selection; return a.project(m.upos.sub(a.rig.upos, new m.pos.constructor())); },
        toPt: (T, a) => { const m = a.selection, sun = a.system.sun, V = m.pos.constructor, r = m.pos.clone().sub(sun.pos); return a.project(sun.upos.sub(a.rig.upos, new V()).add(r.multiplyScalar(1.3))); },
      },
      { at: 6.5, sel: '#hud .card .place-done' },
    ],
    setup: (T, a) => {
      a.select(a.system.sun);
      T.extra = (a) => { const m = a.made[a.made.length - 1]; return m ? { earths: +(m.gm / 6.6743e-11 / 5.9722e24).toFixed(2), ratio: +(m.radius / 6.371e6).toFixed(3), au: +(m.pos.distanceTo(a.system.sun.pos) / 1.495978707e11).toFixed(3) } : {}; };
    },
    pose: (T, a, s) => {
      if (a.physics.live) a.physics.live.sim.now = () => 0;
      const m = a.made[a.made.length - 1];
      if (!m || !m.valid || s < 1.9) return;
      const V = m.pos.constructor;
      // (where the camera was, when it has come to rest after the world was made; and near the world)
      if (!T.W) {
        const rel = a.rig.upos.sub(m.upos, new V());
        T.W = { dist: rel.length(), dir: rel.clone().normalize(), quat: a.rig.quat.clone() };
        a.placeNear(m, 17 * m.radius, 35, 15);
        const n = a.rig.upos.sub(m.upos, new V());
        T.N = { dist: n.length(), dir: n.clone().normalize(), quat: a.rig.quat.clone() };
        a.rig.upos.copy(m.upos).addVec(T.W.dir, T.W.dist);
        a.rig.quat.copy(T.W.quat);
      }
      const k = T.ease((s - 2.0) / 0.6) * (1 - T.ease((s - 4.4) / 0.6));
      if (k <= 0) return;
      a.glide = null;
      const d = Math.exp(Math.log(T.W.dist) + (Math.log(T.N.dist) - Math.log(T.W.dist)) * k);
      a.rig.upos.copy(m.upos).addVec(T.W.dir.clone().lerp(T.N.dir, k).normalize(), d);
      a.rig.quat.copy(T.W.quat).slerp(T.N.quat, k);
    },
  },
  {
    // Mars thrown at the Earth: Mars's card, Move, Throw; a finger on Mars pulled back from the Earth: the
    // card says "Now on a path into Earth: it hits it." and, with every pull counted, when; let go, and the
    // fall is watched; as the two near, time slows (the chip says how much), the flash, and the card of what
    // the hit was. Setup, as the suite's: Mars put 40 Earth radii from the Earth (no finger moves it there;
    // from where it really is a throw takes months to arrive), moving with the Earth and 10 m/s sunwards.
    id: 'hit',
    ui: true,
    frame: 'full',
    view: { width: 390, height: 844 },
    url: '?menu=0&earthref=0&target=Earth&dist=6&paused=1&time=2026-11-21T12:00:00Z',
    date: { at: '2026-11-21T12:00:00Z', rate: 0, free: true },
    seconds: 12.5,
    keep: [[0, 4.2], [6.2, 11.3]],
    preroll: 1,
    taps: [
      { at: 0.4, sel: '#hud .card [data-act="move"]' },
      { at: 0.9, sel: '#hud .card [data-act="move-throw"]' },
      {
        at: 1.5, dur: 0.8, hold: 1.0,
        pt: (T, a) => T.marsAt(),
        toPt: (T, a) => { const d = T.marsAt(), u = T.toEarth; return { x: d.x - u.x * 66, y: d.y - u.y * 66 }; },
      },
    ],
    setup: async (T, a) => {
      T.s = 0;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const earth = T.body('Earth'), mars = T.body('Mars'), sun = a.system.sun, V = mars.pos.constructor;
      const r = earth.pos.clone().sub(sun.pos), side = r.clone().cross(earth.vel.clone().sub(sun.vel)).cross(r).normalize();
      const sunward = r.clone().normalize().negate();
      a.physics.move(mars, earth.pos.clone().addScaledVector(side, 40 * earth.radius).toArray(), earth.vel.clone().addScaledVector(sunward, 10).toArray(), a.clock.jdTdb);
      a.tellNews(false);
      a.select(mars);
      a.mover.toggle(mars);
      a.mover.leave('throw');
      await wait(1500);
      const walls = [...document.querySelectorAll('#hud .sheet.card, #hud .hud-tabs, #hud .chip, #hud .live-mark, #hud .fab, #hud .hud-watch')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
      const clear = (p) => !!p && p.x > 20 && p.x < innerWidth - 20 && p.y > 130 && p.y < innerHeight - 20 && walls.every((r) => p.x < r.left - 10 || p.x > r.right + 10 || p.y < r.top - 10 || p.y > r.bottom + 10);
      let found = null;
      for (const el of [75, 60, 45]) for (const dist of [60, 80, 100, 130]) for (let az = 0; az < 360; az += 15) {
        if (found) break;
        a.placeNear(earth, dist * earth.radius, az, el);
        a.frame();
        const m = a.project(mars.upos.sub(a.rig.upos, new V())), e = a.project(earth.upos.sub(a.rig.upos, new V()));
        if (!m || !e) continue;
        const l = Math.hypot(e.x - m.x, e.y - m.y), ux = (e.x - m.x) / l, uy = (e.y - m.y) / l;
        const flat = a.mover.describe(mars).plane === 'It moves in the plane of its orbit.';
        if (flat && l > 80 && clear(m) && clear(e) && [40, 80].every((d) => clear({ x: m.x - ux * d, y: m.y - uy * d }))) found = { el, dist, az, ux, uy, l };
      }
      a.mover.stop();
      T.marsAt = () => a.project(a.bodies.views.get(mars).rel);
      T.toEarth = { x: found?.ux ?? 1, y: found?.uy ?? 0 };
      T.extra = () => ({ view: found });
      await wait(800);
      // (the toast of the setup's own move, "Mars goes round Earth now", is not the shot's)
      a.hud.toastEl.classList.remove('show');
    },
    pose: (T, a) => { if (a.physics.live) a.physics.live.sim.now = () => 0; },
  },
  {
    // one continuous pull-out: Earth, the Moon's orbit, the planets' orbits, the nearby stars,
    // the Milky Way from outside with the Magellanic Clouds (other galaxies); then a slow drift
    // under the title. Distance is exponential in time (an even pace in scale).
    id: 'pullout',
    url: '?menu=0&earthref=0&target=Earth&dist=3&paused=1&time=2026-11-21T23:00:00Z',
    date: { at: '2026-11-21T23:00:00Z', rate: 0 },
    seconds: 12.1,
    keep: [[0, 4.95], [5.9, 12.1]],
    preroll: 1,
    waitLoad: true,
    setup: (T, a) => { a.orbits.enabled = true; },
    pose: (T, a, s) => {
      const E = T.body('Earth'), S = a.system.sun, mw = a.milkyWay;
      const PULL = 7.3; // (the galaxy is seen whole about 6 s in: on the title's beat)
      const L0 = Math.log(E.radius * 4), L1 = Math.log(2.2e21);
      const D = Math.exp(L0 + (L1 - L0) * T.ease5(s / PULL)) * Math.exp(0.04 * Math.max(0, s - PULL));
      const L = Math.log(D);
      const sm = (x, a0, a1) => T.ease((x - a0) / (a1 - a0));
      // where the camera stands: above the ecliptic (the orbits open up), then above the galaxy
      const ecl = T.V(0, -0.3978, 0.9175);
      const sun = T.sunward(E);
      const flat = sun.clone().addScaledVector(ecl, -sun.dot(ecl)).normalize().applyAxisAngle(ecl, 25 * T.DEG);
      const d0 = ecl.clone().multiplyScalar(Math.sin(50 * T.DEG)).addScaledVector(flat, Math.cos(50 * T.DEG));
      const d1 = ecl.clone().multiplyScalar(Math.cos(35 * T.DEG)).addScaledVector(flat, Math.sin(35 * T.DEG));
      const b1 = sm(L, Math.log(3e8), Math.log(3e11)), b2 = sm(L, Math.log(3e17), Math.log(3e20));
      const dir = d0.clone().lerp(d1, b1).normalize().lerp(mw.viewDir(), b2).normalize();
      // where it stands is measured from Earth, then the Sun, and only far outside the disc from
      // the galaxy's centre (passing a few kiloparsecs over the bulge fills the frame with glare);
      // what it looks at moves on sooner, so the galaxy grows in the middle of the frame
      const sE = S.upos.sub(E.upos, T.V()), mS = mw.upos.sub(S.upos, T.V());
      const w1 = sm(L, Math.log(2e9), Math.log(2e11));
      const w2 = sm(L, Math.log(1e20), Math.log(1.5e21)), w2look = sm(L, Math.log(3e18), Math.log(6e19));
      a.rig.upos.copy(E.upos).addVec(sE, w1).addVec(mS, w2).addVec(dir, D);
      const look = mS.clone().multiplyScalar(w2look - w2).addScaledVector(dir, -D).normalize();
      const up = ecl.clone().lerp(T.V(0, 0, 1), b2).normalize();
      a.rig.lookAt(look, up);
      // at the end the galaxy settles lower in the frame, leaving room for the title
      T.turn(0, 8 * T.ease((s - PULL + 1.5) / 2.5));
      a.rig.target = E;
      a.rig.setAnchor(null);
      a.rig.fov = 50;
    },
  },
];
