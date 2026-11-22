import { describe, expect, it } from 'vitest';
import {
  affected, AIM_PER_CIRCLE, aimFactor, circularVelocity, dayWords, dragPlane, fingerVelocity, FLICK_PER_CIRCLE, FLICK_SLOWEST, flickFactor, flickOf,
  FRAME_MARGIN, frameDistance, frameRadius, listed, MASS_DECADES, massFactor, massSlider, massTheory, massWords, onPlane, orbitOf, rateWords,
  reachWords, shapeWords, snapThrow, spanWords, squareThrow, the, THROW_MOST, THROW_SQUARE, throwVelocity, timesWords, viewFrame, WATCH_SECONDS,
  WATCH_SLOWEST, watchPlan, watchRate,
} from '../src/app/Powers';
import { M_EARTH, M_JUPITER, M_SUN } from '../src/sim/physics';

const AU = 149_597_870_700, GM_SUN = 1.32712440018e20, DAY = 86_400;

describe('a mass on the slider', () => {
  it('runs from a thousandth to a thousand times the real mass, evenly in the logarithm', () => {
    expect(massFactor(-MASS_DECADES)).toBeCloseTo(1e-3, 15);
    expect(massFactor(MASS_DECADES)).toBeCloseTo(1e3, 9);
    expect(massFactor(1)).toBeCloseTo(10, 12);
    expect(massFactor(1.5) / massFactor(0.5)).toBeCloseTo(10, 9);
    // (and no further, wherever the slider is said to be)
    expect(massFactor(7)).toBeCloseTo(1e3, 9);
    expect(massFactor(-7)).toBeCloseTo(1e-3, 15);
  });

  it('means the real mass exactly in its middle, and a finger near the middle finds it', () => {
    expect(massFactor(0)).toBe(1);
    expect(massFactor(0.02)).toBe(1);
    expect(massFactor(-0.029)).toBe(1);
    expect(massFactor(0.05)).toBeGreaterThan(1.1);
  });

  it('is found again from its factor', () => {
    for (const f of [1e-3, 0.02, 0.5, 1, 2, 318, 1e3]) expect(massFactor(massSlider(f)) / f).toBeCloseTo(1, 9);
    expect(massSlider(1e9)).toBe(MASS_DECADES);
  });
});

describe('a mass in words', () => {
  it('is said in the worlds a person has a feel for', () => {
    expect(massWords(0.5 * M_SUN)).toBe('0.5 Suns');
    expect(massWords(M_SUN)).toBe('1 Sun');
    expect(massWords(1000 * M_SUN)).toBe('1,000 Suns');
    expect(massWords(1.3 * M_JUPITER)).toBe('1.3 Jupiters');
    expect(massWords(M_JUPITER)).toBe('1 Jupiter');
    expect(massWords(50 * M_JUPITER)).toBe('50 Jupiters');
    expect(massWords(12 * M_EARTH)).toBe('12 Earths');
    expect(massWords(M_EARTH)).toBe('1 Earth');
    // Saturn is 95 Earths, Mars a tenth of one, Mercury four and a half Moons
    expect(massWords(5.6834e26)).toBe('95.2 Earths');
    expect(massWords(6.4171e23)).toBe('0.11 Earths');
    expect(massWords(3.3011e23)).toBe('4.5 Moons');
    expect(massWords(7.346e22)).toBe('1 Moon');
    // Ceres, and Phobos
    expect(massWords(9.38e20)).toBe('0.013 Moons');
    expect(massWords(1.06e16)).toBe('1/6,900,000 of the Moon');
  });

  it('and so is a factor on the real mass', () => {
    expect(timesWords(1)).toBe('its real mass');
    expect(timesWords(12)).toBe('12 times its real mass');
    expect(timesWords(1.5)).toBe('1.5 times its real mass');
    expect(timesWords(1000)).toBe('1,000 times its real mass');
    expect(timesWords(0.5)).toBe('0.5 of its real mass');
    expect(timesWords(0.004)).toBe('1/250 of its real mass');
  });
});

describe('what the textbook says of a mass', () => {
  it('says nothing of a planet as planets go', () => {
    expect(massTheory(M_EARTH, false)).toBeNull();
    expect(massTheory(12 * M_JUPITER, false)).toBeNull();
  });

  it('a brown dwarf from about 13 Jupiters, a star from about 80', () => {
    expect(massTheory(13 * M_JUPITER, false)).toMatch(/13 Jupiters deuterium fuses.*brown dwarf/);
    expect(massTheory(79 * M_JUPITER, false)).toMatch(/brown dwarf/);
    expect(massTheory(80 * M_JUPITER, false)).toMatch(/80 Jupiters hydrogen fuses.*star/);
  });

  it('of a star: how bright one of that mass would be, and for how long; nothing of the Sun as it is', () => {
    expect(massTheory(M_SUN, true)).toBeNull();
    // L = M⁴ between 0.43 and 2 Suns: half a Sun shines at a sixteenth
    expect(massTheory(0.5 * M_SUN, true)).toMatch(/A star of 0\.5 Suns would shine 6\.3 % as bright as the Sun, cooler and redder .*, and last about 80 billion years\./);
    expect(massTheory(2 * M_SUN, true)).toMatch(/would shine 1[56](\.\d)? times as bright as the Sun, hotter and bluer/);
    expect(massTheory(0.05 * M_SUN, true)).toMatch(/would not shine as a star/);
  });
});

describe('the orbit a body is on', () => {
  const mu = GM_SUN;
  const year = 2 * Math.PI * Math.sqrt(AU ** 3 / mu);

  it('a circle: no stretch, as far as near, round in a year', () => {
    const o = orbitOf([AU, 0, 0], [0, Math.sqrt(mu / AU), 0], mu);
    expect(o.bound).toBe(true);
    // (the stretch comes out of a difference of nearly equal numbers: good to a part in ten million)
    expect(o.e).toBeLessThan(1e-7);
    expect(o.peri / AU).toBeCloseTo(1, 7);
    expect(o.apo / AU).toBeCloseTo(1, 7);
    expect(o.period / year).toBeCloseTo(1, 12);
    expect(shapeWords(o)).toBe('nearly a circle (0)');
    expect(reachWords(o)).toBe('1 AU to 1 AU · 365.3 d');
  });

  it('an oval: from the nearest point, in any plane', () => {
    // at 0.5 AU with the speed of an orbit that reaches 1.5 AU (e = 0.5, a = 1 AU)
    const v = Math.sqrt(mu * (2 / (0.5 * AU) - 1 / AU));
    const o = orbitOf([0, 0, 0.5 * AU], [v * 0.6, v * 0.8, 0], mu);
    expect(o.e).toBeCloseTo(0.5, 12);
    expect(o.peri / AU).toBeCloseTo(0.5, 12);
    expect(o.apo / AU).toBeCloseTo(1.5, 10);
    expect(o.period / year).toBeCloseTo(1, 10);
    expect(shapeWords(o)).toBe('an oval (0.50)');
  });

  it('faster than escape: open, and it does not come back', () => {
    const o = orbitOf([AU, 0, 0], [0, 1.5 * Math.sqrt((2 * mu) / AU), 0], mu);
    expect(o.bound).toBe(false);
    expect(o.e).toBeGreaterThan(1);
    expect(o.apo).toBe(Infinity);
    expect(o.period).toBe(Infinity);
    expect(o.peri / AU).toBeCloseTo(1, 9);
    expect(shapeWords(o)).toMatch(/^open \(3\.50\): it will not come back$/);
    expect(reachWords(o)).toBe('passes at 1 AU, then leaves');
  });

  it('a moon: kilometres and days', () => {
    const gm = 3.986004418e14 * (1 + 1 / 81.3), r = 384_400e3;
    const o = orbitOf([r, 0, 0], [0, Math.sqrt(gm / r), 0], gm);
    expect(reachWords(o)).toBe('384,400 km to 384,400 km · 27.28 d');
  });
});

describe('a body moved by a finger', () => {
  it('is dragged in the plane of its orbit, or across the view where the eye is in that plane', () => {
    // an orbit in the plane of x and y, turning anticlockwise seen from +z
    const r = [AU, 0, 0], v = [0, 30e3, 0];
    // looked down on: the orbit's own plane (its normal the way the orbit turns)
    expect(dragPlane(r, v, [0, 0, -1])).toEqual({ normal: [0, 0, 1], orbit: true });
    // from 30 degrees above it: still
    expect(dragPlane(r, v, [Math.cos(Math.PI / 6), 0, -Math.sin(Math.PI / 6)]).orbit).toBe(true);
    // from 5 degrees above it: a finger would throw the body across the system, so the plane facing the eye
    const low = [Math.cos(0.087), 0, -Math.sin(0.087)];
    expect(dragPlane(r, v, low)).toEqual({ normal: [-low[0], -0, -low[2]], orbit: false });
    // a body that goes round nothing, or stands still: across the view
    expect(dragPlane(null, null, [0, 0, -1])).toEqual({ normal: [-0, -0, 1], orbit: false });
    expect(dragPlane(r, [0, 0, 0], [0, 0, -1]).orbit).toBe(false);
  });

  it('goes where the finger points in that plane', () => {
    // the eye at the origin, a plane 10 units down the -z axis facing it: a sight line 45 degrees off the axis
    // meets it 10 units to the side
    const p = onPlane([Math.SQRT1_2, 0, -Math.SQRT1_2], [0, 0, -10], [0, 0, 1])!;
    expect(p[0]).toBeCloseTo(10, 12);
    expect(p[2]).toBeCloseTo(-10, 12);
    // a tilted plane through the same point: the point found is in it
    const n = [0.6, 0, 0.8], q = onPlane([0.1, 0.2, -0.97], [0, 0, -10], n)!;
    expect((q[0] - 0) * n[0] + q[1] * n[1] + (q[2] + 10) * n[2]).toBeCloseTo(0, 10);
    // along the plane, or with the plane behind the eye: nowhere
    expect(onPlane([1, 0, 0], [0, 0, -10], [0, 0, 1])).toBeNull();
    expect(onPlane([0, 0, 1], [0, 0, -10], [0, 0, 1])).toBeNull();
  });

  it('can be left on a circle: the speed and the direction that keep it at that distance', () => {
    const r = [0.6 * AU, 0.8 * AU, 0], v = circularVelocity(r, GM_SUN, [0, 0, 1]);
    expect(Math.hypot(...v)).toBeCloseTo(Math.sqrt(GM_SUN / AU), 6);
    expect(r[0] * v[0] + r[1] * v[1]).toBeCloseTo(0, 3);
    // anticlockwise about +z
    expect(r[0] * v[1] - r[1] * v[0]).toBeGreaterThan(0);
    const o = orbitOf(r, v, GM_SUN);
    expect(o.e).toBeLessThan(1e-7);
    expect(o.peri / AU).toBeCloseTo(1, 7);
    // the other way round about the opposite normal
    circularVelocity(r, GM_SUN, [0, 0, -1]).forEach((c, k) => expect(c).toBeCloseTo(-v[k], 9));
  });
});

describe('a world thrown', () => {
  it('is thrown at the speed of a circle or of escape exactly when near either, and no faster than three times a circle', () => {
    expect(snapThrow(0.975)).toBe(1);
    expect(snapThrow(1.025)).toBe(1);
    expect(snapThrow(0.96)).toBe(0.96);
    expect(snapThrow(1.38)).toBe(Math.SQRT2);
    expect(snapThrow(1.45)).toBe(Math.SQRT2);
    expect(snapThrow(1.5)).toBe(1.5);
    expect(snapThrow(7)).toBe(THROW_MOST);
    expect(snapThrow(-1)).toBe(0);
    // never slower for a harder throw
    let last = -1;
    for (let f = 0; f <= 4; f += 0.001) {
      const g = snapThrow(f);
      expect(g).toBeGreaterThanOrEqual(last);
      last = g;
    }
  });

  it('by a flick as fast as the finger went: under 250 px a second no flick; 1,200 a circle, 1,700 escape; by a slingshot as long as its arrow', () => {
    expect(flickFactor(240)).toBeNull();
    expect(flickFactor(FLICK_SLOWEST)).toBeCloseTo(FLICK_SLOWEST / FLICK_PER_CIRCLE, 12);
    expect(flickFactor(1200)).toBe(1);
    expect(flickFactor(1700)).toBe(Math.SQRT2);
    expect(flickFactor(2400)).toBe(2);
    expect(flickFactor(50_000)).toBe(THROW_MOST);
    expect(aimFactor(AIM_PER_CIRCLE)).toBe(1);
    expect(aimFactor(Math.SQRT2 * AIM_PER_CIRCLE + 2)).toBe(Math.SQRT2);
    expect(aimFactor(0.5 * AIM_PER_CIRCLE)).toBe(0.5);
    expect(aimFactor(1000)).toBe(THROW_MOST);
  });

  it('takes a finger\'s speed as it lifts over its last 90 ms: not from one late place, and nothing for a finger that rested', () => {
    // 1,000 px a second to the right, a place every 16 ms
    const steady = Array.from({ length: 12 }, (_, k) => ({ t: 16 * k, x: 16 * k, y: 0 }));
    const v = fingerVelocity(steady);
    expect(v.speed).toBeCloseTo(1000, 9);
    expect(v.dx).toBeCloseTo(1000, 9);
    expect(v.dy).toBeCloseTo(0, 9);
    // a last place that jumps 30 px does not decide it: it counts for what it moves in the window
    const late = [...steady, { t: 16 * 12, x: 16 * 11 + 30, y: 0 }];
    expect(fingerVelocity(late).speed).toBeLessThan(1400);
    // fast, then still for 120 ms before it lifts: not moving
    const rested = [...steady, { t: 16 * 11 + 120, x: 16 * 11, y: 0 }];
    expect(fingerVelocity(rested).speed).toBe(0);
    // a finger down for less than the window: from where it came down
    expect(fingerVelocity([{ t: 0, x: 0, y: 0 }, { t: 40, x: 0, y: -40 }]).dy).toBeCloseTo(-1000, 9);
    expect(fingerVelocity([{ t: 0, x: 5, y: 5 }]).speed).toBe(0);
  });

  it('is a flick if the finger set off less than 300 ms before it lifted, going fast; a pull held longer is an aim', () => {
    // 200 px in 120 ms, after resting on the world for half a second: a flick, the way it went
    const quick = [{ t: 0, x: 100, y: 100 }, { t: 500, x: 100, y: 100 }, ...Array.from({ length: 6 }, (_, k) => ({ t: 520 + 20 * k, x: 100 + 40 * (k + 1) * 0.6, y: 100 - 40 * (k + 1) * 0.8 }))];
    const f = flickOf(quick)!;
    expect(f).not.toBeNull();
    expect(f.dx).toBeCloseTo(0.6, 9);
    expect(f.dy).toBeCloseTo(-0.8, 9);
    expect(f.f).toBe(snapThrow(2000 / FLICK_PER_CIRCLE));
    // the same last 120 ms after 400 ms of pulling: an aim
    const pulled = [{ t: 0, x: 100, y: 100 }, ...Array.from({ length: 20 }, (_, k) => ({ t: 20 * (k + 1), x: 100 + 2 * (k + 1), y: 100 })), ...quick.slice(2).map((p) => ({ ...p, x: p.x + 40 }))];
    expect(flickOf(pulled)).toBeNull();
    // slow, or never off the world: no flick
    expect(flickOf([{ t: 0, x: 0, y: 0 }, { t: 100, x: 20, y: 0 }])).toBeNull();
    expect(flickOf([{ t: 0, x: 0, y: 0 }, { t: 30, x: 5, y: 5 }])).toBeNull();
    expect(flickOf([])).toBeNull();
  });

  it('at the speed of a circle, square to what holds sway, goes round in a circle; at the speed of escape any way, it does not come back', () => {
    const r = [0.6 * AU, 0.8 * AU, 0], n = [0, 0, 1], d = Math.hypot(...r);
    const square = [-r[1] / d, r[0] / d, 0];
    const c = orbitOf(r, throwVelocity(r, GM_SUN, square, 1), GM_SUN);
    expect(c.bound).toBe(true);
    expect(c.e).toBeLessThan(1e-9);
    expect(c.period / (365.25 * DAY)).toBeCloseTo(1.0, 2);
    for (const dir of [square, [r[0] / d, r[1] / d, 0], [0.6 * square[0] + 0.8 * r[0] / d, 0.6 * square[1] + 0.8 * r[1] / d, 0]]) {
      const o = orbitOf(r, throwVelocity(r, GM_SUN, dir, Math.SQRT2), GM_SUN);
      expect(o.bound).toBe(false);
      expect(reachWords(o)).toMatch(/then leaves$/);
    }
    // half a circle's speed, square: an oval with its far end where it was thrown
    const h = orbitOf(r, throwVelocity(r, GM_SUN, square, 0.5), GM_SUN);
    expect(h.apo / AU).toBeCloseTo(1, 9);
    expect(h.e).toBeCloseTo(0.75, 9);
    // within 3 degrees of square it is thrown square, the nearer way round; beyond, as aimed
    const askew = (deg: number, sign = 1) => {
      const a = (deg * Math.PI) / 180;
      return [sign * (Math.cos(a) * square[0] + Math.sin(a) * r[0] / d), sign * (Math.cos(a) * square[1] + Math.sin(a) * r[1] / d), 0];
    };
    squareThrow(askew(2.5), r, n).forEach((x, k) => expect(x).toBeCloseTo(square[k], 12));
    squareThrow(askew(2.5, -1), r, n).forEach((x, k) => expect(x).toBeCloseTo(-square[k], 12));
    squareThrow(askew(4), r, n).forEach((x, k) => expect(x).toBeCloseTo(askew(4)[k], 12));
    expect(THROW_SQUARE).toBeCloseTo((3 * Math.PI) / 180, 12);
  });
});

describe('saying things', () => {
  it('names as they stand in a sentence, alone and in a list', () => {
    expect(the('Sun')).toBe('the Sun');
    expect(the('Moon')).toBe('the Moon');
    expect(the('Jupiter')).toBe('Jupiter');
    expect(listed(['Mars'])).toBe('Mars');
    expect(listed(['Mars', 'Venus'])).toBe('Mars and Venus');
    expect(listed(['Mars', 'Venus', 'Earth'])).toBe('Mars, Venus and Earth');
    expect(listed(['Mars', 'Venus', 'Earth', 'Mercury', 'Pluto'])).toBe('Mars, Venus and 3 others');
  });

  it('a date as a day, a rate of time as what passes in a second', () => {
    // (the day in UTC: J2000 is noon on the first of January, and half a day on is the second)
    expect(dayWords(2451545.0)).toBe('1 January 2000');
    expect(dayWords(2451545.6)).toBe('2 January 2000');
    // (where there is little room, as in the mark of live physics on a phone)
    expect(dayWords(2461315.0, true)).toBe('1 Oct 2026');
    expect(rateWords(1)).toBe('real time');
    expect(rateWords(600)).toBe('10 minutes a second');
    expect(rateWords(3 * DAY)).toBe('3 days a second');
    expect(rateWords(DAY)).toBe('1 day a second');
    expect(rateWords(-1200 * 365.25 * DAY)).toBe('1,200 years a second');
  });

  it('a stretch of time in the unit a person counts it in', () => {
    expect(spanWords(51 * DAY)).toBe('51 days');
    expect(spanWords(6.6 * 3600)).toBe('6.6 hours');
    expect(spanWords(DAY)).toBe('1 day');
    expect(spanWords(150 * 365.25 * DAY)).toBe('150 years');
    expect(spanWords(90)).toBe('1.5 minutes');
  });
});

const YEAR = 365.25 * DAY;

describe('watching what a change does', () => {
  it('goes at the pace at which the quickest orbit goes round in eight seconds: the Moon\'s month at 3.4 days a second, Mercury\'s year at 11', () => {
    expect(watchRate([27.32 * DAY], 10 * YEAR)! / DAY).toBeCloseTo(3.4, 1);
    expect(watchRate([87.97 * DAY, 365.25 * DAY], 10 * YEAR)! / DAY).toBeCloseTo(11, 0);
    // (the quickest sets it, whatever else is there; what goes round nothing has no period to go by)
    expect(watchRate([Infinity, 365.25 * DAY, 27.32 * DAY], 10 * YEAR)).toBe(watchRate([27.32 * DAY], 10 * YEAR));
    expect(watchRate([Infinity], 10 * YEAR)).toBeNull();
    expect(watchRate([], 10 * YEAR)).toBeNull();
  });

  it('no faster than the stepping is allowed to go, and never slower than a minute a second', () => {
    // Neptune's 165 years would ask for 20 years a second: on a phone, ten
    expect(watchRate([164.8 * YEAR], 10 * YEAR)).toBe(10 * YEAR);
    expect(watchRate([164.8 * YEAR], 100 * YEAR)! / YEAR).toBeCloseTo(20.6, 1);
    // a made moon skimming its planet in two minutes: a minute a second
    expect(watchRate([120], 10 * YEAR)).toBe(WATCH_SLOWEST);
  });

  it('matters to the bodies whose acceleration it changes by a hundredth or more: a mass, a body taken away, made, or moved', () => {
    // a star, a planet 1 AU out with a moon 400,000 km beyond it, and a far planet at 30 AU
    const sun = { id: 1, gm: 1.327e20, pos: [0, 0, 0] }, earth = { id: 2, gm: 3.986e14, pos: [AU, 0, 0] };
    const moon = { id: 3, gm: 4.9e12, pos: [AU + 3.84e8, 0, 0] }, far = { id: 4, gm: 6.8e15, pos: [30 * AU, 0, 0] };
    const bodies = [sun, earth, moon, far];
    // the planet ten times heavier: its moon feels it, and so does the star, whose own small acceleration is mostly the
    // planet's pull; the far planet does not
    expect(affected(bodies, [sun, { ...earth, gm: 10 * earth.gm }, moon, far])).toEqual([1, 3]);
    // the star taken away: everything that went round it
    expect(affected(bodies, [earth, moon, far])).toEqual([2, 3, 4]);
    // a body made counts, and so does what it pulls: a second star beside the planet
    expect(affected(bodies, [...bodies, { id: 5, gm: 1.327e20, pos: [1.5 * AU, 0, 0] }])).toEqual([1, 2, 3, 4, 5]);
    // the moon moved to twice its distance: it feels the change, the planet by less than a hundredth
    expect(affected(bodies, [sun, earth, { ...moon, pos: [AU + 7.68e8, 0, 0] }, far])).toEqual([3]);
    // nothing changed: nothing
    expect(affected(bodies, bodies)).toEqual([]);
  });

  it('frames the worlds that go round within twenty times the quickest: a world 30 AU out does not shrink the inner ones to dots', () => {
    const inner = [{ period: 88 * DAY, reach: 0.47 * AU }, { period: 365 * DAY, reach: 1.02 * AU }, { period: 687 * DAY, reach: 1.67 * AU }];
    expect(frameRadius(inner) / AU).toBeCloseTo(FRAME_MARGIN * 1.67, 9);
    expect(frameRadius([...inner, { period: 164.8 * YEAR, reach: 30.3 * AU }]) / AU).toBeCloseTo(FRAME_MARGIN * 1.67, 9);
    expect(frameRadius([])).toBe(0);
  });

  it('plans a watch from the worlds a change matters to: their periods about the centre, else about what they go round, else before the change', () => {
    const mu = 1.267e17, centre = { gm: mu, pos: [0, 0, 0], vel: [0, 0, 0] };
    // a moon on a circle 1,000,000 km out about the centre: its period sets the pace, its distance the frame
    const r = 1e9, v = Math.sqrt(mu / r), P = 2 * Math.PI * Math.sqrt(r ** 3 / mu);
    const moon = { gm: 1e12, pos: [r, 0, 0], vel: [0, v, 0], period: P, was: P };
    const plan = watchPlan([moon], centre, 10 * YEAR)!;
    expect(plan.rate * 8 / P).toBeCloseTo(1, 3);
    expect(plan.radius / (FRAME_MARGIN * r)).toBeCloseTo(1, 3);
    // thrown off (twice the speed of escape): its month before the change is its pace, and the frame reaches as far as it goes in the watch
    const thrown = { ...moon, vel: [0, 2 * Math.SQRT2 * v, 0], period: Infinity };
    const out = watchPlan([thrown], centre, 10 * YEAR)!;
    expect(out.rate).toBeCloseTo(P / 8, 3);
    expect(out.radius / (FRAME_MARGIN * (r + 2 * Math.SQRT2 * v * out.rate * WATCH_SECONDS))).toBeCloseTo(1, 6);
    // a moon of another planet far off (as Iapetus is when the Sun is taken away): its month sets the pace with the
    // rest, but it goes where its planet goes, and is not what the frame is fitted to
    const elsewhere = { gm: 1e12, pos: [100 * r, 0, 0], vel: [0, 50 * v, 0], period: P / 4, was: P / 4 };
    const both = watchPlan([moon, elsewhere], centre, 10 * YEAR)!;
    expect(both.rate).toBeCloseTo(P / 32, 3);
    expect(both.radius / (FRAME_MARGIN * r)).toBeCloseTo(1, 3);
    // with nothing to frame round, only the pace; with nothing that has a pace, nothing
    expect(watchPlan([moon], null, 10 * YEAR)).toEqual({ rate: P / 8, radius: 0 });
    expect(watchPlan([{ ...thrown, was: Infinity }], centre, 10 * YEAR)).toBeNull();
  });

  it('fits the frame to what the interface leaves clear, upright and sideways', () => {
    // an upright phone, the whole view clear: 70 degrees tall, 35.9 across, the narrower side sets the distance
    const up = viewFrame({ left: 0, top: 0, right: 390, bottom: 844 }, 390, 844, 70);
    expect(up.dir).toEqual([0, 0, -1]);
    expect(up.halfY * 360 / Math.PI).toBeCloseTo(70, 6);
    expect(up.halfX * 360 / Math.PI).toBeCloseTo(35.86, 2);
    expect(frameDistance(1, up.halfX, up.halfY)).toBeCloseTo(1 / Math.tan(up.halfX), 9);
    expect(frameDistance(1, up.halfX, up.halfY)).toBeCloseTo(3.09, 2);
    // sideways: 50 degrees tall sets it
    const side = viewFrame({ left: 0, top: 0, right: 844, bottom: 390 }, 844, 390, 50);
    expect(frameDistance(1, side.halfX, side.halfY)).toBeCloseTo(1 / Math.tan((25 * Math.PI) / 180), 9);
    // upright with the chips at the top and the card at the foot: the middle of what is left is up the view, and the frame stands farther back
    const card = viewFrame({ left: 8, top: 130, right: 382, bottom: 520 }, 390, 844, 70);
    expect(card.dir[1]).toBeGreaterThan(0.1);
    expect(frameDistance(1, card.halfX, card.halfY)).toBeGreaterThan(frameDistance(1, up.halfX, up.halfY));
    // sideways with the panel at the left: the middle is to the right
    const panel = viewFrame({ left: 470, top: 64, right: 836, bottom: 382 }, 844, 390, 50);
    expect(panel.dir[0]).toBeGreaterThan(0.3);
    expect(Math.min(panel.halfX, panel.halfY)).toBeLessThan(Math.min(side.halfX, side.halfY));
  });
});
