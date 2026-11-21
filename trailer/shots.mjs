// The trailer's shots as data. Each shot opens the app at a deep link (`url`), then its `pose`
// places the camera every frame from the shot's time `s` (seconds; negative during the pre-roll).
// `pose` and `setup` run inside the page with the helpers of capture.mjs (T) and the app (a):
// write them as arrow functions with no outside references.
//
//   id        folder name for the frames (timeline.py refers to it)
//   url       query string: where the app starts (it also loads the right content first).
//             earthref=0: no "Earth for scale" disc on the worlds (unexplained, it reads as a glitch)
//   date      { at: ISO date (UTC), rate: simulated seconds per real second }
//   seconds   footage kept (the edit uses the first part; the rest is handle for a dissolve)
//   preroll   seconds stepped before the first kept frame (exposure, bloom, motion settle)
//   ui        true: the interface stays in the picture (whole-page screenshots), shown in a phone
//   view, scale  that shot's own CSS viewport and density (the interface shot: an iPhone's)
//   taps      [{ at: s, label: name in the sky | button: text }]: real touch events at those times
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
    // Earth half lit, the terminator across it, turning in a time-lapse (10 minutes a second);
    // smaller in the frame: its cloud layer is flat close up in daylight
    id: 'earth',
    url: '?menu=0&earthref=0&target=Earth&dist=3&paused=1&time=2026-11-21T14:00:00Z',
    date: { at: '2026-11-21T14:00:00Z', rate: 600 },
    seconds: 3.5,
    preroll: 1,
    pose: (T, a, s) => {
      const E = T.body('Earth');
      const p = T.pole(E);
      const d = T.around(E, p, 102 - s * 3, 20);
      T.put(E, d, E.radius * T.lerp(3.2, 2.85, T.ease(s / 3.5)), d.clone().negate(), p);
      T.turn(0, 4, 15);
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
    // Jupiter, 30 minutes a second: the bands turn, Europa's shadow crosses, Io's comes on
    // (a double shadow transit on 24 Nov 2026, found with the app's own ephemeris)
    id: 'jupiter',
    url: '?menu=0&earthref=0&target=Jupiter&dist=4&paused=1&time=2026-11-24T01:45:00Z',
    date: { at: '2026-11-24T01:45:00Z', rate: 1800 },
    seconds: 3.5,
    preroll: 1,
    pose: (T, a, s) => {
      const J = T.body('Jupiter');
      const p = T.pole(J);
      const d = T.around(J, p, 15, 3);
      T.put(J, d, J.radius * T.lerp(3.8, 3.3, T.ease(s / 3.5)), d.clone().negate(), p);
      a.rig.fov = 50;
    },
  },
  // a run of one-beat shots: what else is there. Each with a push in and a turn you can see.
  {
    id: 'mars',
    url: '?menu=0&earthref=0&target=Mars&dist=2.3&az=40&el=15&paused=1&time=2026-11-21T12:00:00Z',
    date: { at: '2026-11-21T12:00:00Z', rate: 0 },
    seconds: 2,
    preroll: 1,
    pose: (T, a, s) => { const o = T.body('Mars'); T.place(o, o.radius * T.lerp(2.4, 2.05, T.ease(s / 2)), 36 + s * 5, 15); a.rig.fov = 50; },
  },
  {
    id: 'moon',
    url: '?menu=0&earthref=0&target=Moon&dist=1.6&az=80&el=10&paused=1&time=2026-11-21T12:00:00Z',
    date: { at: '2026-11-21T12:00:00Z', rate: 0 },
    seconds: 2,
    preroll: 1,
    pose: (T, a, s) => { const o = T.body('Moon'); T.place(o, o.radius * T.lerp(1.65, 1.5, T.ease(s / 2)), 78 + s * 3, 10); a.rig.fov = 50; },
  },
  {
    // the brightest comet within 3 AU of the Sun on the date (as scripts/shots/comet.mjs picks it)
    id: 'comet',
    url: '?menu=0&earthref=0&target=Sun&dist=50&paused=1&time=2026-11-21T12:00:00Z',
    date: { at: '2026-11-21T12:00:00Z', rate: 0 },
    seconds: 2,
    preroll: 1,
    setup: (T, a) => {
      const sun = a.system.sun.upos;
      let best = null;
      for (const c of a.small.cometObjects) {
        if (c.row[8] === null || !['P', 'C', 'I'].includes(c.row[1])) continue;
        const r = c.upos.sub(sun).length() / T.AU;
        const m = c.row[8] + (c.row[9] ?? 10) * Math.log10(Math.max(r, 0.1));
        if (r < 3 && (!best || m < best.m)) best = { c, m };
      }
      T.comet = best.c;
      a.select(best.c); // (its tail is drawn in full for the selection)
    },
    pose: (T, a, s) => {
      const c = T.comet, anti = T.sunward(c).negate();
      const side = anti.clone().cross(T.V(0, 0, 1)).normalize();
      const D = 3e9 * T.lerp(1, 0.85, T.ease(s / 2));
      const look = anti.clone().multiplyScalar(D * 0.35).addScaledVector(side, -D).normalize();
      T.put(c, side, D, look, T.V(0, 0, 1));
      T.turn(-2 + s * 2, 0);
      a.rig.fov = 50;
    },
  },
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
    // the app in a hand: tap the Moon, its card comes up, Go there, the flight
    id: 'ui',
    ui: true,
    view: { width: 390, height: 844 },
    scale: 1.5,
    url: '?menu=0&earthref=0&target=Earth&dist=4&paused=1&time=2026-11-21T12:00:00Z',
    date: { at: '2026-11-21T12:00:00Z', rate: 0 },
    seconds: 6.5,
    preroll: 1,
    taps: [{ at: 0.6, label: 'Moon' }, { at: 1.4, button: 'Go there' }],
    setup: (T, a) => { a.select(null); },
    pose: (T, a, s) => {
      // a still camera until the flight takes it (the app's own autopilot from then on):
      // behind Earth from the Moon, the Moon hanging above Earth's limb
      if (s > 0.1 || a.rig.autopilot) return;
      const E = T.body('Earth'), M = T.body('Moon');
      const m = M.upos.sub(E.upos, T.V()).normalize();
      const side = m.clone().cross(T.V(0, 0, 1)).cross(m).normalize();
      const d = m.clone().negate().multiplyScalar(Math.cos(25 * T.DEG)).addScaledVector(side, Math.sin(25 * T.DEG));
      const D = E.radius * 3.5;
      const toMoon = M.upos.sub(E.upos, T.V()).addScaledVector(d, -D).normalize();
      T.put(E, d, D, toMoon, side);
      T.turn(0, -12);
    },
  },
  {
    // one continuous pull-out: Earth, the Moon's orbit, the planets' orbits, the nearby stars,
    // the Milky Way from outside with the Magellanic Clouds (other galaxies); then a slow drift
    // under the title. Distance is exponential in time (an even pace in scale).
    id: 'pullout',
    url: '?menu=0&earthref=0&target=Earth&dist=3&paused=1&time=2026-11-21T12:00:00Z',
    date: { at: '2026-11-21T12:00:00Z', rate: 0 },
    seconds: 13.5,
    preroll: 1,
    waitLoad: true,
    setup: (T, a) => { a.orbits.enabled = true; },
    pose: (T, a, s) => {
      const E = T.body('Earth'), S = a.system.sun, mw = a.milkyWay;
      const PULL = 7.3; // (the galaxy is seen whole about 6 s in: on the title's beat)
      const L0 = Math.log(E.radius * 3.2), L1 = Math.log(2.2e21);
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
