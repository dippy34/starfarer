import { describe, expect, it } from 'vitest';
import { Quaternion, type ShaderMaterial, type Vector2, Vector3, type Vector4 } from 'three';
import { StarCorona } from '../src/render/StarCorona';
import { PROM_SLOTS, starLook, type StarLook, type StarProm } from '../src/render/StarLook';

/**
 * The prominences round a star are drawn on a quad facing the eye, each where it is seen from
 * there: StarCorona works that out every frame. Tried here without a screen: the uniforms it
 * hands the shader, for prominences put where the answer is known.
 */
describe("a star's prominences, as seen", () => {
  const R = 6.957e8;
  const PIXEL = 0.00124;
  const identity = new Quaternion();
  // the star's own frame turned so that its spin axis stands upright in the view: its equator
  // then runs from the right limb (longitude 0) round the back
  const upright = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(0, 1, 0));
  const withProms = (proms: StarProm[], more: Partial<StarLook> = {}): StarLook => ({ ...starLook('sun', 5772, 1, 4.83, true), proms, ...more });
  const loop = (lat: number, lon: number, apart: number, height: number, alongSight = false): StarProm => alongSight
    ? { a: { lat, lon: lon - apart }, b: { lat, lon: lon + apart }, height, curtain: false }
    : { a: { lat: lat - apart, lon }, b: { lat: lat + apart, lon }, height, curtain: false };
  const seen = (look: StarLook, dist: number, turned = 0, turn = upright, view = identity) => {
    const corona = new StarCorona();
    const rel = new Vector3(0, 0, -dist * R).applyQuaternion(view);
    corona.update({ rel, radius: R, turn, look }, view, PIXEL, 1, 0, turned);
    const u = (corona.mesh.material as ShaderMaterial).uniforms;
    const n = u.uPromCount.value as number;
    return {
      n, u,
      feet: (u.uPromFeet.value as Vector4[]).slice(0, n),
      tops: (u.uPromTop.value as Vector4[]).slice(0, n),
    };
  };

  it('one standing on the limb is seen in profile: its feet on the disk\'s edge, its top its height above', () => {
    // from far away (the sight lines nearly parallel): on the right limb, feet above one another
    const s = seen(withProms([loop(0, 0, 0.03, 0.06)]), 400);
    expect(s.n).toBe(1);
    const [f] = s.feet, [t] = s.tops;
    expect(t.x).toBeCloseTo(1.06, 3);
    expect(t.y).toBeCloseTo(0, 6);
    expect(Math.hypot(f.x, f.y)).toBeCloseTo(1, 3);
    expect(Math.hypot(f.z, f.w)).toBeCloseTo(1, 3);
    // (latitude is up the axis, and the axis is up the view)
    expect(f.w - f.y).toBeCloseTo(2 * Math.sin(0.03), 3);
    expect(t.z).toBe(0);
  });

  it('one facing the eye is in front of the disk: not drawn; one behind the limb shows what reaches over it', () => {
    // longitude -90 degrees is the middle of the face, +90 the far side
    expect(seen(withProms([loop(0, -Math.PI / 2, 0.03, 0.06)]), 400).n).toBe(0);
    expect(seen(withProms([loop(0, Math.PI / 2, 0.03, 0.06)]), 400).n).toBe(0);
    // 15 degrees behind the limb, 6 % of the radius high: its top is at 1.06 cos 15 = 1.024
    const behind = seen(withProms([loop(0, (15 * Math.PI) / 180, 0.03, 0.06)]), 400);
    expect(behind.n).toBe(1);
    // (a little less: it is farther from the eye than the limb is)
    expect(behind.tops[0].x).toBeCloseTo(1.06 * Math.cos((15 * Math.PI) / 180), 2);
    expect(behind.tops[0].x).toBeLessThan(1.06 * Math.cos((15 * Math.PI) / 180));
    // its feet are behind the disk (inside its edge as seen): the star's face hides them
    expect(Math.hypot(behind.feet[0].x, behind.feet[0].y)).toBeLessThan(1);
    // 25 degrees behind, it does not reach over: 1.06 cos 25 = 0.96
    expect(seen(withProms([loop(0, (25 * Math.PI) / 180, 0.03, 0.06)]), 400).n).toBe(0);
  });

  it('as the star turns, a prominence rises over the limb, stands highest on it, and sets', () => {
    const look = withProms([loop(0, -0.6, 0.03, 0.08)], { shear: 0 });
    let last = 0, highest = 0, rose = false, set = false;
    for (let lon = -0.6; lon <= 0.6; lon += 0.02) {
      const s = seen(look, 400, (lon + 0.6) / look.rotRate);
      const r = s.n ? Math.hypot(s.tops[0].x, s.tops[0].y) : 0;
      if (r > 0 && last === 0) rose = true;
      if (r === 0 && last > 0) set = true;
      if (r > 0 && last > 0) expect(Math.abs(r - last)).toBeLessThan(0.02);     // no jumps on the way
      highest = Math.max(highest, r);
      last = r;
    }
    expect(rose).toBe(true);
    expect(set).toBe(true);
    expect(highest).toBeCloseTo(1.08, 2);
  });

  it('seen edge on, a loop keeps a width of its own', () => {
    // its feet one behind the other along the line of sight: they fall on one point of the limb
    const s = seen(withProms([loop(0, 0, 0.03, 0.06, true)]), 400);
    expect(s.n).toBe(1);
    const f = s.feet[0], t = s.tops[0];
    const height = Math.hypot(t.x - (f.x + f.z) / 2, t.y - (f.y + f.w) / 2);
    expect(Math.hypot(f.z - f.x, f.w - f.y) / 2).toBeGreaterThan(0.2 * height);
    // and the shader's arithmetic is not asked to divide by nothing: the arch has an area
    const ux = (f.z - f.x) / 2, uy = (f.w - f.y) / 2, vx = t.x - (f.x + f.z) / 2, vy = t.y - (f.y + f.w) / 2;
    expect(Math.abs(ux * vy - uy * vx)).toBeGreaterThan(0.1 * height * height);
  });

  it('from close by the edge of the disk is where the sight lines graze the sphere: a foot there is on it', () => {
    // from 1.2 radii the sphere's outline is the circle acos(1/1.2) = 33.6 degrees from the point below the eye
    const graze = Math.acos(1 / 1.2);
    // (longitude -90 degrees faces the eye: the outline is at -90 + 33.6)
    const s = seen(withProms([loop(0, -Math.PI / 2 + graze, 0.001, 0.05)]), 1.2);
    expect(s.n).toBe(1);
    const f = s.feet[0];
    expect(Math.hypot((f.x + f.z) / 2, (f.y + f.w) / 2)).toBeCloseTo(1, 3);
    expect(Math.hypot(s.tops[0].x, s.tops[0].y)).toBeGreaterThan(1.02);
    expect(s.u.uSinLimb.value).toBeCloseTo(1 / 1.2, 9);
  });

  it('it does not matter which way the eye is turned: the same star is the same on its quad', () => {
    const look = withProms([loop(0.2, 0.05, 0.03, 0.06), { a: { lat: -0.5, lon: -0.1 }, b: { lat: -0.45, lon: 0.15 }, height: 0.07, curtain: true }]);
    const a = seen(look, 5);
    // the eye rolled a quarter turn about its line of sight: the picture on the quad turns the other way
    const rolled = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    const b = seen(look, 5, 0, upright, rolled);
    expect(b.n).toBe(a.n);
    expect(a.n).toBe(2);
    for (let i = 0; i < a.n; i++) {
      expect(b.tops[i].x).toBeCloseTo(a.tops[i].y, 6);
      expect(b.tops[i].y).toBeCloseTo(-a.tops[i].x, 6);
      expect(b.tops[i].z).toBe(a.tops[i].z);
    }
    expect(a.tops[1].z).toBe(1);
    // the eye looking another way altogether, the star still straight ahead of it
    const away = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 2.1);
    const c = seen(look, 5, 0, upright.clone().premultiply(away), away);
    for (let i = 0; i < a.n; i++) {
      expect(c.tops[i].x).toBeCloseTo(a.tops[i].x, 6);
      expect(c.tops[i].y).toBeCloseTo(a.tops[i].y, 6);
    }
  });

  it('the corona is laid out by the star\'s axis as it is seen', () => {
    const look = withProms([]);
    const up = seen(look, 5).u;
    expect((up.uAxis2.value as Vector2).x).toBeCloseTo(0, 9);
    expect(Math.abs((up.uAxis2.value as Vector2).y)).toBeCloseTo(1, 9);
    expect(up.uAxisSee.value).toBeCloseTo(1, 9);
    // seen pole on, there is no direction to lay it out by
    const poleOn = seen(look, 5, 0, identity).u;
    expect(poleOn.uAxisSee.value).toBeCloseTo(0, 6);
    // tilted 30 degrees towards the eye: half of the axis is across the view
    const tilted = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 3).multiply(upright);
    expect(seen(look, 5, 0, tilted).u.uAxisSee.value).toBeCloseTo(0.5, 6);
    // the disk's size on the screen goes to the shader, for what is too fine to draw
    expect(up.uLimbPx.value).toBeCloseTo(Math.asin(1 / 5) / PIXEL, 6);
  });

  it('a star never has more prominences than the shader has room for, and each belongs to its kind', () => {
    for (const [key, t, r, m] of [['sun', 5772, 1, 4.83], ['proxima', 3050, 0.154, 15.6], ['ad leo', 3390, 0.39, 10.9], ['eps eri', 5080, 0.74, 6.19], ['arcturus', 4290, 25.4, -0.3]] as const) {
      const look = starLook(key, t, r, m, key === 'sun');
      expect(look.proms.length).toBeLessThanOrEqual(PROM_SLOTS);
      if (look.prominences > 0) expect(look.proms.length).toBeGreaterThan(0);
      for (const p of look.proms) {
        expect(p.height).toBeGreaterThan(0.01);
        expect(p.height).toBeLessThanOrEqual(0.35);
        expect(Math.abs(p.a.lat)).toBeLessThan(Math.PI / 2);
        expect(Math.abs(p.b.lat)).toBeLessThan(Math.PI / 2);
      }
      // a loop stands on a pair of spots: its feet are two of the star's spots
      for (const p of look.proms.filter((x) => !x.curtain)) {
        expect(look.spots.some((s) => s.lat === p.a.lat && s.lon === p.a.lon)).toBe(true);
        expect(look.spots.some((s) => s.lat === p.b.lat && s.lon === p.b.lon)).toBe(true);
      }
    }
    // no convection zone, no prominences: a hot star, a white dwarf; nor on a supergiant
    for (const [key, t, r, m] of [['vega', 9600, 2.4, 0.58], ['sirius b', 25000, 0.0084, 11.2], ['betelgeuse', 3600, 760, -5.8]] as const) {
      expect(starLook(key, t, r, m).proms.length).toBe(0);
    }
    // the Sun's are small: a few hundredths of its radius, a tenth at the most
    const sun = starLook('sun', 5772, 1, 4.83, true);
    expect(Math.max(...sun.proms.map((p) => p.height))).toBeLessThan(0.13);
    expect(sun.proms.some((p) => p.curtain)).toBe(true);
    expect(sun.proms.some((p) => !p.curtain)).toBe(true);
  });
});
