import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig, sunlitSide } from '../src/app/CameraRig';
import { emptyFrame, type Input } from '../src/app/Input';
import { UPos } from '../src/core/upos';
import type { SpaceObject } from '../src/universe/Body';

const idle = {
  keys: new Set<string>(),
  consume: emptyFrame,
} as unknown as Input;

function target(radius: number): SpaceObject {
  return { key: 't', name: 'T', kind: 'planet', radius, upos: new UPos(), parentObject: null, info: () => [] } as unknown as SpaceObject;
}

/** Fly from `d0` to `d1` (metres) and record the distance every 1/72 s. */
function fly(d0: number, d1: number, radius: number): number[] {
  const rig = new CameraRig();
  rig.upos.set(d0, 0, 0);
  rig.flyTo(target(radius), d1, undefined, false);
  const ds: number[] = [];
  for (let i = 0; i < 72 * 20 && rig.autopilot; i++) {
    rig.update(1 / 72, idle);
    ds.push(rig.upos.toVector3().length());
  }
  return ds;
}

describe('autopilot approach', () => {
  for (const [name, d0, R] of [['Earth to Saturn', 1.3e12, 5.8e7], ['Earth to Moon', 3.8e8, 1.74e6], ['across the Saturn system', 1.2e9, 2.5e6]] as const) {
    it(`${name}: monotone, no change of pace, time spent where the target is visible`, () => {
      const d1 = R * 2.5;
      const ds = fly(d0, d1, R);
      expect(ds[ds.length - 1]).toBeCloseTo(d1, -Math.floor(Math.log10(d1)) + 2);
      const L = ds.map(Math.log);
      const steps = L.slice(1).map((x, i) => x - L[i]);
      expect(Math.max(...steps)).toBeLessThanOrEqual(1e-12); // never moves away
      // pace changes smoothly: the zoom speed (log distance per frame) never jumps between
      // frames by more than 3 % of its peak (a cut or a second motion would)
      const peak = Math.max(...steps.map(Math.abs));
      let jerk = 0;
      for (let i = 1; i < steps.length; i++) jerk = Math.max(jerk, Math.abs(steps[i] - steps[i - 1]) / peak);
      expect(jerk).toBeLessThan(0.03);
      const dotFrames = ds.filter((d) => d > R * 300).length;
      expect(dotFrames / ds.length).toBeLessThan(0.45);
      expect(ds.length / 72).toBeLessThan(9);
    });
  }
});

describe('autopilot arrival direction', () => {
  it('swings round to the requested side during the visible approach, distance still monotone, target kept in view', () => {
    const rig = new CameraRig();
    const rs = 62e3;
    const t = target(rs);
    rig.upos.set(7e19, 0, 0);
    const arrive = new Vector3(0, Math.cos(0.17), Math.sin(0.17)); // 90 degrees away, just above a plane
    rig.flyTo(t, rs * 22, undefined, true, arrive);
    let prev = Infinity;
    let worstAim = 0;
    let swungAt = Infinity;
    for (let i = 0; i < 72 * 20 && rig.autopilot; i++) {
      rig.update(1 / 72, idle);
      const p = rig.upos.toVector3();
      const d = p.length();
      expect(d).toBeLessThanOrEqual(prev * (1 + 1e-12));
      prev = d;
      if (swungAt === Infinity && p.clone().normalize().angleTo(new Vector3(1, 0, 0)) > 0.01) swungAt = d;
      // once the initial turn is done (35 % of the trip), the camera keeps looking at the target
      if (rig.autopilot && rig.gotoProgress >= 0.36) worstAim = Math.max(worstAim, rig.forward().angleTo(p.clone().negate().normalize()));
    }
    const end = rig.upos.toVector3();
    expect(end.length()).toBeCloseTo(rs * 22, -3);
    expect(end.clone().normalize().angleTo(arrive)).toBeLessThan(1e-3);
    expect(swungAt).toBeLessThan(rs * 300 * Math.E ** 2 * 1.01); // only once the target is visible
    expect(worstAim).toBeLessThan(1e-3);
  });

  it('also swings when flying outwards (leaving the galaxy)', () => {
    const rig = new CameraRig();
    const R = 4.6e20;
    rig.upos.set(2.55e20, 0, 0); // the Sun, 8.3 kpc from the centre
    const arrive = new Vector3(-0.57, 0, 0.82);
    rig.flyTo(target(R), R * 2.6, undefined, true, arrive);
    let prev = 0;
    for (let i = 0; i < 72 * 20 && rig.autopilot; i++) {
      rig.update(1 / 72, idle);
      const d = rig.upos.toVector3().length();
      expect(d).toBeGreaterThanOrEqual(prev * (1 - 1e-12));
      prev = d;
    }
    const end = rig.upos.toVector3();
    expect(end.length()).toBeCloseTo(R * 2.6, -18);
    expect(end.normalize().angleTo(arrive)).toBeLessThan(1e-3);
  });
});

describe('the side a world is arrived at', () => {
  const sun = new Vector3(1.5e11, 0, 0);
  const lit = (from: Vector3) => {
    const side = sunlitSide(from, sun);
    return side ? (side.angleTo(sun) * 180) / Math.PI : null;
  };

  it('is the one the flight comes in from while that shows enough of its lit face', () => {
    expect(sunlitSide(new Vector3(1, 0, 0), sun)).toBeUndefined();          // from the sun's side: all of it lit
    expect(sunlitSide(new Vector3(0, 3e9, 1e9), sun)).toBeUndefined();      // from the side: half of it
    expect(sunlitSide(new Vector3(-1, 8, 0), sun)).toBeUndefined();         // a little behind: 97 degrees round
  });

  it('is round towards the sun, on the eye\'s own side, where the straight way in ends over its night', () => {
    // from 120 degrees round: to 60 degrees, three quarters of the disc lit, without crossing to the other side
    const from = new Vector3(-1, Math.sqrt(3), 0).multiplyScalar(4e9), side = sunlitSide(from, sun)!;
    expect(side.length()).toBeCloseTo(1, 12);
    expect(lit(from)).toBeCloseTo(60, 9);
    expect(side.y).toBeGreaterThan(0);
    expect(side.z).toBeCloseTo(0, 12);
    // out of the plane just the same
    expect(sunlitSide(new Vector3(-5, 0, -1), sun)!.z).toBeLessThan(0);
    // from straight behind it: any side, still 60 degrees from the sun
    expect(lit(new Vector3(-7e11, 0, 0))).toBeCloseTo(60, 9);
    expect(lit(new Vector3(0, 0, -2))).toBeNull();
  });
});

describe('a pinch near a world', () => {
  const R = 1.7374e6;
  /** a rig at `height` above a world of radius R (centre at the origin), on its +x side, looking along +y, level */
  const standing = (height: number) => {
    const rig = new CameraRig();
    rig.viewport.width = 390;
    rig.viewport.height = 844;
    rig.target = target(R);
    rig.surface = R;
    rig.closest = R + 1.6;
    rig.upos.set(R + height, 0, 0);
    rig.lookAt(new Vector3(0, 1, 0), new Vector3(1, 0, 0));
    return rig;
  };
  const pinched = (log: number, at: { x: number; y: number }) => ({ keys: new Set<string>(), consume: () => ({ ...emptyFrame(), pinch: log, pinchAt: at }) }) as unknown as Input;
  /** where the ray at `at` meets the world's sphere (null: it misses) */
  const under = (rig: CameraRig, at: { x: number; y: number }) => {
    const o = rig.upos.toVector3(), d = rig.ray(at.x, at.y);
    const b = o.dot(d), disc = b * b - (o.lengthSq() - R * R);
    return b < 0 && disc >= 0 ? o.addScaledVector(d, -b - Math.sqrt(disc)) : null;
  };

  it('standing on the ground, closing the fingers lifts off: up at least as far as sideways, even with what is under them out towards the horizon', () => {
    // (the touch suite's lift-off on the Moon: the fingers' middle a little below the horizon, the ground under it 13 m out;
    // holding that spot under the fingers took the camera 13 m along the ground for 1.6 m up, and up a slope never off it)
    const rig = standing(1.6), at = { x: 195, y: 500 };
    expect(under(rig, at)).not.toBeNull();
    const p0 = rig.upos.toVector3();
    rig.update(1 / 60, pinched(Math.log(2), at));
    const p1 = rig.upos.toVector3();
    const up = p1.length() - p0.length(), sideways = p0.angleTo(p1) * R;
    expect(up).toBeCloseTo(1.6, 6);
    expect(sideways).toBeLessThanOrEqual(up * 1.001);
  });

  it('coming down, what is under the fingers stays under them, as before', () => {
    const rig = standing(200), at = { x: 195, y: 520 };
    const held = under(rig, at)!;
    rig.update(1 / 60, pinched(-Math.log(2), at));
    expect(under(rig, at)!.distanceTo(held)).toBeLessThan(1e-3 * rig.upos.toVector3().distanceTo(held));
  });

  it('far out, closing the fingers on a point of the globe keeps it under them, as before', () => {
    const rig = new CameraRig();
    rig.viewport.width = 390;
    rig.viewport.height = 844;
    rig.target = target(R);
    rig.surface = R;
    rig.closest = R * 1.002;
    rig.upos.set(4 * R, 0, 0);
    rig.lookAt(new Vector3(-1, 0, 0), new Vector3(0, 0, 1));
    const at = { x: 250, y: 380 };
    const held = under(rig, at)!;
    rig.update(1 / 60, pinched(Math.log(1.3), at));
    expect(rig.upos.toVector3().length()).toBeGreaterThan(4 * R);
    expect(under(rig, at)!.distanceTo(held)).toBeLessThan(1e-6 * R);
  });
});
