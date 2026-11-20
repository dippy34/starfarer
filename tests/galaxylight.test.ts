import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GalaxyModel, layerColumn, lookFor } from '../src/render/GalaxiesLayer';
import { noise3D } from '../src/render/Noise3D';
import { Galaxy } from '../src/universe/Galaxies';

/** the same by brute force: f(r) v(z) summed along the ray in a hundred thousand steps */
function brute(o: Vector3, d: Vector3, t0: number, t1: number, h: number, f: (r: number) => number): number {
  const n = 100000;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + ((i + 0.5) / n) * (t1 - t0);
    sum += f(Math.hypot(o.x + d.x * t, o.y + d.y * t)) * (Math.exp(-Math.abs(o.z + d.z * t) / h) / (2 * h));
  }
  return (sum * (t1 - t0)) / n;
}

describe('what a ray collects in a thin layer', () => {
  const even = () => 1;
  const h = 0.02;

  it('straight through, the whole of it; at a slant, as much more as the path is longer', () => {
    expect(layerColumn(new Vector3(0, 0, 1), new Vector3(0, 0, -1), 0, 2, h, even)).toBeCloseTo(1, 9);
    const d = new Vector3(Math.sin(1.2), 0, -Math.cos(1.2));
    expect(layerColumn(new Vector3(0, 0, 0.5), d, 0, 5, h, even)).toBeCloseTo(1 / Math.cos(1.2), 9);
  });

  it('from the middle of the layer, half of it; from above it looking up, none', () => {
    expect(layerColumn(new Vector3(0, 0, 0), new Vector3(0, 0, 1), 0, 2, h, even)).toBeCloseTo(0.5, 9);
    expect(layerColumn(new Vector3(0, 0, 0.5), new Vector3(0, 0, 1), 0, 2, h, even)).toBeLessThan(1e-9);
  });

  it('along the layer, its density at that height times the length of the path', () => {
    for (const z of [0, 0.01, 0.05]) {
      expect(layerColumn(new Vector3(0, 0, z), new Vector3(1, 0, 0), 0, 3, h, even)).toBeCloseTo((3 * Math.exp(-z / h)) / (2 * h), 9);
    }
  });

  it('nearly along it, nearly that: nothing jumps between looking along the layer and across it', () => {
    const along = layerColumn(new Vector3(0, 0, 0.01), new Vector3(1, 0, 0), 0, 0.3, h, even);
    let prev = along;
    for (let slope = 1e-9; slope < 1; slope *= 1.1) {
      const d = new Vector3(1, 0, slope).normalize();
      const c = layerColumn(new Vector3(0, 0, 0.01), d, 0, 0.3, h, even);
      // (across the layer the column goes as one over the slope: a tenth a step at most)
      expect(Math.abs(Math.log(c / prev))).toBeLessThan(0.1);
      prev = c;
    }
    expect(layerColumn(new Vector3(0, 0, 0.01), new Vector3(1, 0, 1e-9).normalize(), 0, 0.3, h, even)).toBeCloseTo(along, 6);
  });

  it('agrees with a sum by brute force where the light falls off outwards, from any angle and any place', () => {
    const f = (r: number) => Math.exp(-r / 0.2);
    for (const o of [new Vector3(0.3, 0, 0.004), new Vector3(0.05, 0.02, 0.3), new Vector3(1.1, 0, -0.01), new Vector3(0, 0, 0)]) {
      for (const d of [new Vector3(1, 0, 0), new Vector3(-1, 0.2, 0.02), new Vector3(0.3, 0.1, -1), new Vector3(-0.5, 0, 0.3), new Vector3(0, 1, 0.001)]) {
        d.normalize();
        const want = brute(o, d, 0, 1.5, h, f), got = layerColumn(o, d, 0, 1.5, h, f);
        if (want < 1e-6) expect(got).toBeLessThan(1e-5);
        else expect(Math.abs(Math.log(got / want))).toBeLessThan(0.12);
      }
    }
  });
});

describe("a galaxy's light along a ray, for the eye's adaptation", () => {
  const galaxies = (JSON.parse(readFileSync('public/data/galaxies.json', 'utf8')) as { galaxies: ConstructorParameters<typeof Galaxy>[0][] }).galaxies.map((g, i) => new Galaxy(g, i));
  const noise = noise3D().data;
  const model = (name: string) => {
    const g = galaxies.find((x) => x.name.includes(name))!;
    return new GalaxyModel(g, lookFor(g, galaxies), noise);
  };

  it('a spiral seen from inside its disc: light from all along the plane, as far as its dust lets it be seen', () => {
    const m = model('Andromeda');
    const o = new Vector3(0.3, 0, 0);
    const toDisc = (v: Vector3) => v.clone().applyMatrix3(m.rotT); // disc frame -> galaxy frame
    const eye = toDisc(o);
    const along = m.radiance(eye, toDisc(new Vector3(0, 1, 0)));
    const inward = m.radiance(eye, toDisc(new Vector3(-1, 0, 0)));
    const up = m.radiance(eye, toDisc(new Vector3(0, 0, 1)));
    expect(up).toBeGreaterThan(0);           // straight out of the plane: half the disc's thickness
    // along the plane the path is a hundred times longer, but the dust is in there with the stars:
    // about one optical depth of them is seen, which is not much more than the half disc above
    expect(along).toBeGreaterThan(up);
    expect(along).toBeLessThan(5 * up);
    expect(inward).toBeGreaterThan(along);   // towards the middle: more disc, and the bulge
    // (what the old estimate gave from inside the plane, looking along it: nothing at all)
  });

  it('nothing jumps as the eye rises through the plane, or as it looks from along it to across it', () => {
    const m = model('Andromeda');
    const toDisc = (v: Vector3) => v.clone().applyMatrix3(m.rotT);
    let prev = NaN;
    for (let z = -0.05; z <= 0.05; z += 0.0005) {
      const L = m.radiance(toDisc(new Vector3(0.3, 0, z)), toDisc(new Vector3(0, 1, 0)));
      if (!Number.isNaN(prev)) expect(Math.abs(Math.log(L / prev))).toBeLessThan(0.1);
      prev = L;
    }
    prev = NaN;
    for (let a = -1.5; a <= 1.5; a += 0.005) {
      const L = m.radiance(toDisc(new Vector3(0.3, 0, 0.002)), toDisc(new Vector3(0, Math.cos(a), Math.sin(a))));
      if (!Number.isNaN(prev)) expect(Math.abs(Math.log(L / prev))).toBeLessThan(0.25);
      prev = L;
    }
  });

  it('an elliptical from its heart: about the same light from every side', () => {
    const m = model('M87');
    const o = new Vector3(2e-4, 0, 0);
    const all = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(0.6, 0.6, 0.5).normalize()].map((d) => m.radiance(o, d));
    expect(Math.max(...all) / Math.min(...all)).toBeLessThan(1.25);
    // and from outside, nothing from the side away from it
    expect(m.radiance(new Vector3(3, 0, 0), new Vector3(1, 0, 0))).toBe(0);
    expect(m.radiance(new Vector3(3, 0, 0), new Vector3(-1, 0, 0))).toBeGreaterThan(1);
  });
});
