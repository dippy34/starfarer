import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { temperatureOf, workedOut, type Worked } from '../src/app/Worked';
import { GM_SUN, SUN_RADIUS, SUN_TEFF } from '../src/core/units';
import { Body, type Climate } from '../src/universe/Body';
import { BlackHole } from '../src/universe/BlackHoles';
import type { AlbedosJson } from '../src/universe/SolarSystem';

const AU = 149_597_870_700;
const find = (rows: Worked[], label: string) => rows.find((r) => r.label.startsWith(label));
const num = (w: Worked | undefined) => Number(w!.text.split(' ')[0]);

function sun(): Body {
  const s = new Body(10, 'Sun', 'star');
  s.gm = GM_SUN;
  s.radii = [SUN_RADIUS, SUN_RADIUS, SUN_RADIUS];
  s.radius = SUN_RADIUS;
  s.teff = SUN_TEFF;
  return s;
}

/** the Earth on a circular orbit a year long */
function earth(parent: Body): Body {
  const e = new Body(399, 'Earth', 'planet');
  e.gm = 3.986004418e14;
  e.radii = [6378137, 6378137, 6356752];
  e.radius = Math.cbrt(e.radii[0] * e.radii[1] * e.radii[2]);
  e.parent = parent;
  e.pos.set(AU, 0, 0);
  e.vel.set(0, Math.sqrt(GM_SUN / AU), 0);
  e.meta = { rotPeriodHours: 23.9345 };
  return e;
}

describe('what is worked out for a world', () => {
  const s = sun(), e = earth(s);
  const rows = workedOut(e);

  it("the Earth's gravity, escape velocity and density, each with its working", () => {
    expect(num(find(rows, 'Surface gravity'))).toBeCloseTo(9.82, 1);
    expect(num(find(rows, 'Escape velocity'))).toBeCloseTo(11.19, 1);
    expect(num(find(rows, 'Mean density'))).toBeCloseTo(5.51, 1);
    const g = find(rows, 'Surface gravity')!;
    expect(g.math.startsWith('g = GM / R² = ')).toBe(true);
    expect(g.math.endsWith(`= ${g.text}`)).toBe(true);
  });

  it('its year, from where it is and how fast it moves', () => {
    const year = find(rows, 'Once round the Sun')!;
    expect(year.text).toMatch(/^365\.\d d$/);
    expect(num(find(rows, 'Speed of a circular orbit here'))).toBeCloseTo(29.78, 1);
    // the Hill sphere of the Earth: about a million and a half kilometres
    expect(find(rows, 'Reach of its gravity')!.text).toMatch(/^0\.0100\d? AU$|^1\.49\de6 km$|^0\.01 AU$/);
  });

  it('on an eccentric orbit the year is that of the whole orbit, not of where it is now', () => {
    // at perihelion of an orbit with a = 1 AU, e = 0.5
    const c = earth(s);
    c.pos.set(0.5 * AU, 0, 0);
    c.vel.set(0, Math.sqrt((GM_SUN + c.gm) * (2 / (0.5 * AU) - 1 / AU)), 0);
    expect(find(workedOut(c), 'Once round the Sun')!.text).toMatch(/^365\.\d d$/);
  });

  it("the speed of the equator from the day's length", () => {
    expect(num(find(rows, 'Speed of its equator'))).toBeCloseTo(465.1, 0);
  });

  it('the Sun: its luminosity from its size and temperature, and where water could be liquid', () => {
    const r = workedOut(s);
    expect(num(find(r, 'Luminosity'))).toBeCloseTo(1, 2);
    expect(num(find(r, 'Habitable zone from'))).toBeCloseTo(0.953, 2);
    expect(num(find(r, 'Habitable zone to'))).toBeCloseTo(1.374, 2);
    expect(num(find(r, 'Surface gravity'))).toBeCloseTo(274, 0);
    expect(find(r, 'Once round')).toBeUndefined();
  });

  it('leaves out what it has no numbers for', () => {
    // a small moon with no measured mass, and a size that is only an estimate
    const m = new Body(5000, 'S/2000 X 1', 'moon');
    m.radii = [2000, 2000, 2000];
    m.radius = 2000;
    m.radiusEstimated = true;
    m.parent = e;
    m.pos.copy(e.pos).x += 4e8;
    m.vel.copy(e.vel).y += Math.sqrt(e.gm / 4e8);
    const r = workedOut(m).map((w) => w.label);
    expect(r).toEqual(['Once round Earth', 'Speed of a circular orbit here']);
    // and a world that is not on a closed orbit has no year
    m.vel.y += 5000;
    expect(workedOut(m).map((w) => w.label)).toEqual([]);
  });
});

describe('what is worked out for a black hole', () => {
  it('its horizon, the photon sphere and the innermost stable orbit, from its mass alone', () => {
    const bh = new BlackHole(0, { name: 'Test', aliases: [], kind: 'stellar', raDeg: 0, decDeg: 0, distPc: 1000, massSun: 10, ref: 'test' } as never);
    const r = workedOut(bh);
    expect(find(r, 'Event horizon')!.text).toBe('29.53 km');
    expect(find(r, 'Light can circle at')!.text).toBe('44.3 km');
    expect(find(r, 'Innermost stable orbit')!.text).toBe('88.6 km');
    expect(find(r, 'Hawking temperature')!.math).toContain('ħc³');
  });
});

describe('how long an orbit takes: the catalogue, or as it moves now', () => {
  const s = sun(), e = earth(s);
  // JPL's mean elements for the major planets, as shipped (the Earth's is the Earth-Moon barycentre's)
  const system = JSON.parse(readFileSync(new URL('../public/data/solar/system.json', import.meta.url), 'utf8'));
  const n = system.approxElements.EMB.rate[3] as number;
  const catalogue = { meanPeriod: (b: Body) => (b === e ? { days: (360 / n) * 36525, source: "JPL's mean elements for the major planets", how: `360° / ${n}°/century` } : null) };

  it('in the real Solar System, the mean sidereal period as catalogued, and it says so', () => {
    const year = find(workedOut(e, catalogue), 'Once round the Sun')!;
    expect(year.text).toBe('365.256 d');
    expect(year.math).toContain('the mean period');
  });

  it('where nothing is catalogued (or in live physics), as it moves now, and it says so', () => {
    // pulled 12 m/s off its circle by the Moon, as the Earth is: the year as it moves now is half a day off
    const tugged = earth(s);
    tugged.vel.y += 12;
    const year = find(workedOut(tugged, null), 'Once round the Sun')!;
    expect(Math.abs(Number(year.text.split(' ')[0]) - 365.25)).toBeGreaterThan(0.3);
    expect(year.math.startsWith('As it moves now')).toBe(true);
  });
});

describe('the temperature of a world', () => {
  // (as the pipeline fetched it from NASA's fact sheets: pipeline/fetch_albedos.py)
  const sheets = JSON.parse(readFileSync(new URL('../public/data/solar/albedos.json', import.meta.url), 'utf8')) as AlbedosJson;
  const climate = (id: number): Climate => {
    const a = sheets.bodies[String(id)];
    return { bond: a.bondAlbedo!, irradiance: a.irradiance ?? null, air: a.surfaceK ? { tempK: a.surfaceK, bar: a.surfaceBar! } : null, source: a.source };
  };
  const EARTH = { name: 'Earth', giant: false, oceans: true }, L = 3.828e26;

  it('in the real Solar System, as the fact sheet has it: without air from the sunlight at its mean distance, with its air as measured, and what water does', () => {
    const t = temperatureOf(EARTH, climate(399), { listed: 1361.0 });
    expect(t.line).toBe('15 °C, as measured. Without its air: −18 °C.');
    expect(t.worked.map((w) => [w.label, w.text])).toEqual([['Temperature without air', '−18 °C'], ['With its air', '15 °C'], ['Water there', 'liquid']]);
    expect(t.worked[0].math).toContain('255.1 K');
    expect(t.worked[1].math).toContain('its air warms it by 32.88 K');
    const venus = temperatureOf({ name: 'Venus', giant: false, oceans: false }, climate(299), { listed: 2601.3 }), mars = temperatureOf({ name: 'Mars', giant: false, oceans: false }, climate(499), { listed: 586.2 });
    expect(venus.line).toBe('464 °C, as measured. Without its air: −47 °C.');
    expect(mars.line).toBe('−59 °C, as measured. Without its air: −63 °C.');
    // (what water does there, in the working: under Venus's 92 bar it boils, on Mars it is ice)
    expect([venus, mars].map((w) => w.worked[2].text)).toEqual(['boils', 'ice']);
    // (a line a phone has room for: 46 letters at most)
    for (const w of [t, venus, mars]) expect(w.line.length).toBeLessThanOrEqual(46);
    expect(temperatureOf({ name: 'Moon', giant: false, oceans: false }, climate(301), { listed: 1361.0 }).line).toBe('Temperature without air: −3 °C');
    expect(temperatureOf({ name: 'Jupiter', giant: true, oceans: false }, climate(599), { listed: 50.26 }).line).toBe('From sunlight alone: −163 °C');
  });

  it('in live physics, where it is now under every sun, the warming of its air kept as measured: the Earth at half its distance boils its oceans', () => {
    const here = (d: number, more: { name: string; lumW: number; dM: number }[] = []) => temperatureOf(EARTH, climate(399), { suns: [{ name: 'Sun', lumW: L, dM: d }, ...more] });
    // (at its mean distance as the sheet has it, to the degree)
    expect(here(AU).line).toBe('Earth here: 15 °C. The oceans stay liquid.');
    // (half as far: four times the sunlight, its temperature without air √2 times, 360.8 K, and 32.9 K more from its air)
    const near = here(AU / 2);
    expect(near.line).toBe('Earth here: 121 °C. The oceans would boil.');
    expect(near.worked[1].math).toContain('kept as it is wherever it goes');
    expect(here(3 * AU).line).toBe('Earth here: −93 °C. The oceans would freeze.');
    // a second Sun as far again: twice the sunlight
    const two = here(AU, [{ name: 'Sun 2', lumW: L, dM: AU }]);
    expect(two.line).toBe('Earth here: 63 °C. The oceans stay liquid.');
    expect(two.worked[0].math).toContain('the Sun and Sun 2');
    expect(temperatureOf({ name: 'Moon', giant: false, oceans: false }, climate(301), { suns: [{ name: 'Sun', lumW: L, dM: AU }] }).line).toBe('The Moon here: −3 °C');
    expect(temperatureOf(EARTH, climate(399), { suns: [] }).line).toBe('Earth here: no sun to warm it.');
  });

  it('is had only by the worlds whose fact sheet measures a Bond albedo: nothing is estimated for any other', () => {
    expect(Object.values(sheets.bodies).map((b) => b.name).sort()).toEqual(['Charon', 'Earth', 'Jupiter', 'Mars', 'Mercury', 'Moon', 'Neptune', 'Pluto', 'Saturn', 'Uranus', 'Venus']);
    for (const b of Object.values(sheets.bodies)) expect(b.bondAlbedo).toBeGreaterThan(0);
  });
});
