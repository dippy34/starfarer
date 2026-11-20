import { describe, expect, it } from 'vitest';
import { workedOut, type Worked } from '../src/app/Worked';
import { GM_SUN, SUN_RADIUS, SUN_TEFF } from '../src/core/units';
import { Body } from '../src/universe/Body';
import { BlackHole } from '../src/universe/BlackHoles';

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
