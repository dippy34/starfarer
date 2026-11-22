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
//             it (shares of its size), to: { fx, fy }, dur: a drag there over dur s }]: real touch
//             events at those times
//   waitLoad  give streamed star tiles up to 2 s to arrive before each frame (long camera moves)

/** CSS viewport: a small phone held upright. At device scale 3 the canvas is 1080x1920. */
export const VIEW = { width: 360, height: 640 };

export const SHOTS = [
  {
    // cold open: the Sun's limb, its corona and prominences standing on it; a push in and a turn
    id: 'sun',
    url: '?menu=0&earthref=0&target=Sun&dist=2&paused=1&time=2026-11-21T12:00:00Z',
    date: { at: '2026-11-21T12:00:00Z', rate: 0 },
    seconds: 5,
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
  {
    // Titan in the orange of its haze, Saturn behind it with its rings open, the Milky Way beyond
    // (Titan nearly full, 18 June 2017); a slow push in
    id: 'titan',
    url: '?menu=0&earthref=0&target=Titan&dist=10&paused=1&time=2017-06-18T00:00:00Z',
    date: { at: '2017-06-18T00:00:00Z', rate: 0 },
    seconds: 2,
    preroll: 1,
    pose: (T, a, s) => {
      const S = T.body('Saturn'), Ti = T.body('Titan');
      const u = Ti.upos.sub(S.upos, T.V()).normalize();
      const p = T.pole(S);
      const side = u.clone().cross(p).normalize();
      const dir = u.clone().multiplyScalar(Math.cos(14 * T.DEG)).addScaledVector(side, Math.sin(14 * T.DEG)).addScaledVector(p, 0.3).normalize();
      a.rig.upos.copy(Ti.upos).addVec(dir, Ti.radius * T.lerp(10, 8.6, T.ease(s / 2)));
      const toS = S.upos.sub(a.rig.upos, T.V()).normalize(), toT = Ti.upos.sub(a.rig.upos, T.V()).normalize();
      a.rig.lookAt(toS.clone().lerp(toT, 0.55).normalize(), p);
      a.rig.target = Ti;
      a.rig.setAnchor(Ti);
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
  {
    // Cygnus X-1: its disk, and the blue supergiant it draws gas from
    id: 'cygnus',
    url: '?menu=0&earthref=0&target=Cygnus%20X-1&dist=95&paused=1&time=2026-11-21T12:00:00Z',
    date: { at: '2026-11-21T12:00:00Z', rate: 1 },
    seconds: 1.7,
    preroll: 1,
    pose: (T, a, s) => {
      const h = T.body('Cygnus X-1'), n = h.diskNormal.clone();
      const sun = T.sunward(h);
      const flat = sun.clone().addScaledVector(n, -sun.dot(n)).normalize().applyAxisAngle(n, (40 + s * 6) * T.DEG);
      const dir = flat.multiplyScalar(Math.cos(15 * T.DEG)).addScaledVector(n, Math.sin(15 * T.DEG)).normalize();
      a.rig.upos.copy(h.upos).addVec(dir, h.radius * T.logLerp(95, 40, T.ease(Math.max(0, s) / 1.7)));
      a.rig.lookAt(dir.clone().negate(), n);
      a.rig.target = h;
      a.rig.setAnchor(null);
      a.rig.fov = 50;
    },
  },
  // god mode, filmed on the owner's phone's screen (an iPhone's 390 x 844), full frame
  {
    // the Sun's card: Add, then "A second sun". Filmed from 42 AU over Neptune's side of the
    // planets' plane: Add makes it 0.55 of the way to the eye, in that plane (23 AU out), and the
    // app says what follows ("Neptune goes round Sun 2 now"); then the watch takes the camera out
    id: 'sun2',
    ui: true,
    frame: 'full',
    view: { width: 390, height: 844 },
    url: '?menu=0&earthref=0&target=Sun&dist=9000&paused=1&time=2026-11-21T12:00:00Z',
    date: { at: '2026-11-21T12:00:00Z', rate: 0, free: true },
    seconds: 4,
    preroll: 1,
    taps: [{ at: 0.5, sel: '[data-power="add"]' }, { at: 1.3, sel: '[data-act="add-sun"]' }],
    setup: (T, a) => {
      const S = a.system.sun, N = T.body('Neptune');
      a.select(S);
      const ecl = T.V(0, -0.3978, 0.9175);
      const n = N.upos.sub(S.upos, T.V()).normalize();
      const flat = n.clone().addScaledVector(ecl, -n.dot(ecl)).normalize().applyAxisAngle(ecl, -25 * T.DEG);
      const dir = ecl.clone().multiplyScalar(Math.sin(50 * T.DEG)).addScaledVector(flat, Math.cos(50 * T.DEG)).normalize();
      a.rig.upos.copy(S.upos).addVec(dir, 42 * T.AU);
      a.rig.lookAt(dir.clone().negate(), ecl);
      a.rig.target = S;
      a.rig.setAnchor(null);
    },
    pose: (T, a) => { if (a.physics.live) a.physics.live.sim.now = () => 0; },
  },
  {
    // what a second sun does, from over the planets (as v2's live gravity shot): the worlds
    // simulated from the first frame, each leaving its trail (orbit lines off, trails on). At 1 s
    // the Sun's Add makes a second sun (App.add, as the card's button does; the watch is off, as
    // More's "Show me what happens" allows, and the camera is the shot's): from 14 AU, 78 degrees
    // over the plane and leaning away from Jupiter, it is made about 7.7 AU out on the side away
    // from Jupiter. The camera keeps the two suns' middle in the middle, the pair upright in the
    // frame. Half density, scaled up (two-pixel trails); the stepping held to the full step.
    id: 'sunlive',
    scale: 1.5,
    url: '?menu=0&earthref=0&target=Sun&dist=3000&paused=1&time=2026-11-21T12:00:00Z',
    date: { at: '2026-11-21T12:00:00Z', rate: 2.6e7, from: 0 },
    seconds: 5.5,
    preroll: 1,
    setup: (T, a) => {
      a.showMe = false;
      a.orbits.enabled = true;
      const up = a.orbits.update.bind(a.orbits);
      a.orbits.update = (...x) => { up(...x); for (const o of a.orbits.objs.values()) o.line.visible = false; };
    },
    pose: (T, a, s) => {
      const S = a.system.sun;
      const ecl = T.V(0, -0.3978, 0.9175);
      T.ref ??= T.body('Jupiter').upos.sub(S.upos, T.V()).normalize();
      const flat = T.ref.clone().addScaledVector(ecl, -T.ref.dot(ecl)).normalize();
      const dir = ecl.clone().multiplyScalar(Math.sin(78 * T.DEG)).addScaledVector(flat, -Math.cos(78 * T.DEG)).normalize();
      const D = 14 * T.AU * (1 + 0.025 * Math.max(0, s));
      // the middle: halfway to where the new sun will be, then halfway between the two suns
      const guess = S.upos.clone().addVec(flat, -0.55 * 14.2 * T.AU / 2);
      const c = T.sun2 && T.sun2.valid ? S.upos.clone().addVec(T.sun2.upos.sub(S.upos, T.V()), 0.5) : guess;
      const w = T.ease((s - 1) / 1.2);
      const mid = guess.sub(guess, T.V()).lerp(c.sub(guess, T.V()), w);
      a.rig.upos.copy(guess).addVec(mid, 1).addVec(dir, D);
      a.rig.lookAt(dir.clone().negate(), flat.clone().negate());
      a.rig.target = S;
      a.rig.setAnchor(null);
      a.rig.fov = 50;
      if (s >= 0 && !a.physics.on) a.physics.setMass(S, S.gm, a.clock.jdTdb);
      if (s >= 1 && !T.did) { T.did = true; T.sun2 = a.add('sun', S); a.select(null); }
      if (a.physics.live) a.physics.live.sim.now = () => 0;
    },
  },
  {
    // Jupiter's card: Mass, a thumb slides it to twenty times (the slider's 1.30 of 3, as log10),
    // rests there a moment, lifts, and the watch: the camera eases out, time at its pace, the chip; the inner moons fall
    // in one by one, told as they do. Only the start and the moment Europa hits are kept.
    id: 'europa',
    ui: true,
    frame: 'full',
    view: { width: 390, height: 844 },
    url: '?menu=0&earthref=0&target=Jupiter&dist=30&paused=1&time=2026-10-01T23:00:00Z',
    date: { at: '2026-10-01T23:00:00Z', rate: 0, free: true },
    seconds: 13.2,
    keep: [[0, 3.9], [9.5, 13.2]],
    preroll: 1,
    taps: [{ at: 0.5, sel: '[data-power="mass"]' }, { at: 1.3, sel: '.card .slider', to: { fx: 0.698 }, dur: 0.5, hold: 0.4 }],
    setup: (T, a) => {
      a.select(T.body('Jupiter'));
      T.extra = (a) => { const J = a.findByName('Jupiter'); return { times: +(J.gm / a.physics.realGm(J)).toFixed(2) }; };
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
