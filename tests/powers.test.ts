import { describe, expect, it } from 'vitest';
import { dayWords, listed, MASS_DECADES, massFactor, massSlider, massTheory, massWords, orbitOf, rateWords, reachWords, shapeWords, the, timesWords } from '../src/app/Powers';
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
    expect(rateWords(1)).toBe('real time');
    expect(rateWords(600)).toBe('10 minutes a second');
    expect(rateWords(3 * DAY)).toBe('3 days a second');
    expect(rateWords(DAY)).toBe('1 day a second');
    expect(rateWords(-1200 * 365.25 * DAY)).toBe('1,200 years a second');
  });
});
