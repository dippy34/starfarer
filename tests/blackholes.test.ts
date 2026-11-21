import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { BlackHoleLayer } from '../src/render/BlackHoleLayer';
import { jetShape } from '../src/render/Jets';
import { UPos } from '../src/core/upos';
import { BlackHole } from '../src/universe/BlackHoles';

const data = JSON.parse(readFileSync(new URL('../public/data/blackholes.json', import.meta.url), 'utf8')) as { blackholes: ConstructorParameters<typeof BlackHole>[1][] };
const holes = data.blackholes.map((d, i) => new BlackHole(i, d));
const named = (name: string) => holes.find((h) => h.name === name)!;
/** a phone's pixel (rad): 70 degrees over 844 of them */
const pixel = (2 * Math.tan((35 * Math.PI) / 180)) / 844;
/** the eye `dist` from a hole, off along its disk's plane and a little above it */
const eyeAt = (bh: BlackHole, dist: number): UPos => {
  const along = new Vector3().crossVectors(bh.diskNormal, new Vector3(0.3, 0.5, 0.8)).normalize();
  return bh.upos.clone().addVec(along.multiplyScalar(0.97).addScaledVector(bh.diskNormal, 0.24).normalize(), dist);
};

describe('which black holes are drawn, and how', () => {
  const m87 = named('M87*');
  const layer = new BlackHoleLayer(holes, { value: 1 });
  /** how M87* is drawn from `dist` radii: bending the sky, as a far point of light, or not at all */
  const drawn = (dist: number, faintest: number) => {
    layer.update(eyeAt(m87, dist * m87.radius), pixel, 0, faintest);
    return layer.views.some((v) => v.bh === m87) ? 'bends' : layer.far.some((v) => v.bh === m87) ? 'far' : 'none';
  };

  it('a hole near enough to bend the sky by a pixel is drawn doing so', () => {
    expect(drawn(40, 1e-12)).toBe('bends');
    expect(drawn(1e4, 1e-12)).toBe('bends');
  });

  it('farther off its disk is still a point of light, down to the faintest worth a pixel, and then nothing', () => {
    // (the bending is under a pixel from 4 / pixel^2 radii on, about 2.3 million here)
    expect(drawn(1e7, 1e-12)).toBe('far');
    expect(drawn(1e9, 1e-12)).toBe('far');
    expect(drawn(1e13, 1e-12)).toBe('none');
    // it goes out where its light falls below the faintest: four times fainter, twice as far
    const lastSeen = (faintest: number) => {
      let lo = 1e7, hi = 1e14;
      for (let i = 0; i < 60; i++) { const mid = Math.sqrt(lo * hi); if (drawn(mid, faintest) === 'far') lo = mid; else hi = mid; }
      return lo;
    };
    expect(lastSeen(1e-12) / lastSeen(4e-12)).toBeCloseTo(2, 3);
  });

  it('never drops out between the two: from every distance it is one or the other until its light is gone', () => {
    let was = drawn(10, 1e-12);
    for (let dist = 10; dist < 1e13; dist *= 1.07) {
      const now = drawn(dist, 1e-12);
      if (was === 'none') expect(now).toBe('none');
      if (was === 'far') expect(now).not.toBe('bends');
      was = now;
    }
    expect(was).toBe('none');
  });

  it('a hole without a disk is no point of light', () => {
    const dark = named('Gaia BH1');
    layer.update(eyeAt(dark, 1e9 * dark.radius), pixel, 0, 1e-30);
    expect(layer.far.some((v) => v.bh === dark)).toBe(false);
    expect(layer.views.some((v) => v.bh === dark)).toBe(false);
  });

  it('the middle of a disk is drawn like the rest of it until the app says otherwise', () => {
    layer.update(eyeAt(m87, 300 * m87.radius), pixel, 0, 1e-12);
    const v = layer.views.find((x) => x.bh === m87)!;
    expect(v.middle.exposure).toBeGreaterThan(1e20);
  });
});

describe('how bright a disk is drawn', () => {
  const layer = new BlackHoleLayer(holes, { value: 1 });

  it('is brightest at its hottest ring and gone beyond its edge', () => {
    for (const bh of holes.filter((h) => h.diskOuter > 0)) {
      const peak = bh.diskInner * (49 / 36);
      expect(layer.shownAt(bh, peak, 0)).toBeGreaterThan(layer.shownAt(bh, 3 * peak, 0));
      expect(layer.shownAt(bh, bh.diskOuter * 1.01, 0)).toBe(0);
      expect(layer.radianceAt(bh, peak)).toBeGreaterThan(0);
    }
  });

  it('the gas coming towards the eye outshines the gas going away', () => {
    for (const bh of holes.filter((h) => h.diskOuter > 0)) {
      const r = 2 * bh.diskInner;
      expect(layer.shownAt(bh, r, 0.9)).toBeGreaterThan(layer.shownAt(bh, r, 0));
      expect(layer.shownAt(bh, r, 0)).toBeGreaterThan(layer.shownAt(bh, r, -0.9));
    }
  });
});

describe('the jets of the holes that have them', () => {
  it('M87* has them a kiloparsec and a half long; a microquasar short ones; a quiet hole none', () => {
    const m87 = jetShape(named('M87*'))!;
    expect(m87.length / 3.0857e16).toBeCloseTo(1500, 0);
    expect(m87.shape.x).toBeCloseTo(m87.length / named('M87*').radius, 6);
    expect(jetShape(named('Cygnus X-1'))!.length / 3.0857e16).toBeCloseTo(0.05, 3);
    expect(jetShape(named('Sagittarius A*'))).toBeNull();
    expect(jetShape(named('Gaia BH1'))).toBeNull();
  });

  it('widen as a parabola and then as a cone, with no step where the one turns into the other', () => {
    for (const name of ['M87*', 'Cygnus X-1', 'GRS 1915+105']) {
      const { shape } = jetShape(named(name))!;
      const radius = (z: number) => (z < shape.y ? 1.5 * z ** 0.58 : shape.z + (z - shape.y) * shape.w);
      expect(radius(shape.y * (1 - 1e-9)) / radius(shape.y)).toBeCloseTo(1, 6);
      // narrow all the way: at its tip no wider than a twentieth of its length
      expect(radius(shape.x) / shape.x).toBeLessThan(0.05);
      expect(shape.y).toBeLessThanOrEqual(shape.x);
    }
  });

  it('M87\'s are the brighter, and blue-white', () => {
    const m87 = jetShape(named('M87*'))!.glow, cyg = jetShape(named('Cygnus X-1'))!.glow;
    expect(m87.z).toBeGreaterThan(m87.x);
    expect(m87.x + m87.y + m87.z).toBeGreaterThan(2 * (cyg.x + cyg.y + cyg.z));
  });
});
