import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig, verticalFov } from '../src/app/CameraRig';
import { emptyFrame, type Input, type InputFrame } from '../src/app/Input';
import { UPos } from '../src/core/upos';
import type { SpaceObject } from '../src/universe/Body';

const R = 6.371e6;

function target(radius = R): SpaceObject {
  return { key: 't', name: 'T', kind: 'planet', radius, upos: new UPos(), parentObject: null, info: () => [] } as unknown as SpaceObject;
}

/** One frame of the rig with the given pointer input. */
function step(rig: CameraRig, f: Partial<InputFrame> = {}, keys: string[] = [], dt = 1 / 60): void {
  const frame = { ...emptyFrame(), ...f };
  rig.update(dt, { keys: new Set(keys), consume: () => frame } as unknown as Input);
}

/** A rig `dist` from the centre of a solid target, looking at it, in a view of the given size. */
function at(dist: number, width = 1280, height = 720): CameraRig {
  const rig = new CameraRig();
  rig.viewport.width = width;
  rig.viewport.height = height;
  rig.upos.set(dist, 0, 0);
  rig.lookAt(new Vector3(-1, 0, 0), new Vector3(0, 0, 1));
  rig.target = target();
  rig.surface = R;
  rig.closest = R * 1.002;
  return rig;
}

/** Where a camera-relative direction appears in the rig's view (CSS px). */
function onScreen(rig: CameraRig, dir: Vector3): { x: number; y: number } {
  const v = dir.clone().applyQuaternion(rig.quat.clone().invert());
  const t = Math.tan((rig.fovY * Math.PI) / 360);
  const { width, height } = rig.viewport;
  return { x: ((v.x / -v.z / (t * (width / height))) * 0.5 + 0.5) * width, y: ((-v.y / -v.z / t) * 0.5 + 0.5) * height };
}

/** The point of the target's surface seen at a point of the view (from the target's centre), or null. */
function surfaceAt(rig: CameraRig, x: number, y: number, radius = R): Vector3 | null {
  const cam = rig.upos.toVector3();
  const dir = rig.ray(x, y);
  const b = cam.dot(dir);
  const disc = b * b - (cam.lengthSq() - radius * radius);
  if (b >= 0 || disc < 0) return null;
  return cam.addScaledVector(dir, -b - Math.sqrt(disc));
}

/** Drag a pointer from (x0, y0) to (x1, y1) in `n` frames through the channel `via`. */
function drag(rig: CameraRig, via: 'touch' | 'orbit', x0: number, y0: number, x1: number, y1: number, n = 10): void {
  for (let i = 1; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
    step(rig, { [via]: { dx: (x1 - x0) / n, dy: (y1 - y0) / n, x, y } });
  }
}

describe('the view for the screen shape', () => {
  it('a wide view keeps its field of view; an upright phone opens up to 70 degrees', () => {
    expect(verticalFov(50, 16 / 9)).toBe(50);
    expect(verticalFov(50, 1)).toBe(50);
    expect(verticalFov(50, 390 / 844)).toBeCloseTo(69.95, 1);
    // an upright tablet (3:4) sees 50 degrees across
    const fy = verticalFov(50, 3 / 4);
    expect((2 * Math.atan(Math.tan((fy * Math.PI) / 360) * 0.75) * 180) / Math.PI).toBeCloseTo(50, 9);
  });

  it('an upright view stands back so that what it frames fits its width as it fits the height of a wide view', () => {
    const wide = at(3 * R), phone = at(3 * R, 390, 844);
    expect(wide.framing).toBe(1);
    expect(phone.framing).toBeCloseTo(1.441, 2);
    // a planet at 3.5 radii fills 2 * 3.5^-1 / (2 tan 25°) = 61 % of a wide view's height...
    const share = (rig: CameraRig, d: number) => {
      const half = Math.tan(Math.asin(R / d));
      const t = Math.tan((rig.fovY * Math.PI) / 360);
      return half / (t * Math.min(1, rig.viewport.width / rig.viewport.height));
    };
    // ...and at 3.5 x framing the same share of a phone's width
    expect(share(phone, 3.5 * R * phone.framing)).toBeCloseTo(share(wide, 3.5 * R), 1);
    expect(share(phone, 3.5 * R * phone.framing)).toBeLessThan(0.7);
  });

  it('ray() is the direction seen at a point of the view', () => {
    const rig = at(3 * R, 390, 844);
    expect(rig.ray(195, 422).angleTo(rig.forward())).toBeLessThan(1e-12);
    const p = onScreen(rig, rig.ray(40, 700));
    expect(p.x).toBeCloseTo(40, 6);
    expect(p.y).toBeCloseTo(700, 6);
    // top to bottom spans the vertical field of view
    expect((rig.ray(195, 0).angleTo(rig.ray(195, 844)) * 180) / Math.PI).toBeCloseTo(rig.fovY, 6);
  });
});

describe('aiming above the middle (the room an upright interface leaves)', () => {
  it('holds the subject that far up the view: when placed, on arrival, and while it is turned and zoomed', () => {
    const rig = at(4 * R, 390, 844);
    rig.aim = 0.12;
    const where = () => onScreen(rig, rig.upos.toVector3().negate());
    const lift = (Math.tan(0.12) / Math.tan((rig.fovY * Math.PI) / 360)) * 422;
    rig.lookAt(new Vector3(-1, 0, 0), new Vector3(0, 0, 1));
    expect(where().x).toBeCloseTo(195, 6);
    expect(where().y).toBeCloseTo(422 - lift, 6);
    expect(lift).toBeGreaterThan(60);
    // turned by a finger, zoomed by a pinch: it stays there
    drag(rig, 'touch', 180, 330, 240, 300);
    for (let i = 0; i < 10; i++) step(rig, { pinch: -0.05 });
    expect(where().y).toBeCloseTo(422 - lift, 4);
    expect(where().x).toBeCloseTo(195, 4);
    // and a flight ends with it there
    rig.upos.set(60 * R, 5 * R, 0);
    rig.flyTo(target(), 4 * R);
    for (let i = 0; i < 60 * 20 && rig.autopilot; i++) step(rig);
    expect(rig.upos.toVector3().length() / R).toBeCloseTo(4, 6);
    expect(where().y).toBeCloseTo(422 - lift, 3);
    expect(where().x).toBeCloseTo(195, 3);
  });
});

describe('one finger on a world', () => {
  for (const [name, w, h] of [['wide', 1280, 720], ['phone', 390, 844]] as const) {
    it(`${name}: the point of the surface under the finger goes where the finger goes`, () => {
      const rig = at(4 * R, w, h);
      const x0 = w / 2 - 30, y0 = h / 2 + 20, x1 = w / 2 + 45, y1 = h / 2 - 50;
      const held = surfaceAt(rig, x0, y0)!;
      drag(rig, 'touch', x0, y0, x1, y1);
      const p = onScreen(rig, held.clone().sub(rig.upos.toVector3()));
      expect(p.x).toBeCloseTo(x1, 3);
      expect(p.y).toBeCloseTo(y1, 3);
      // the camera went round the world: same distance, still looking at its centre
      expect(rig.upos.toVector3().length() / R).toBeCloseTo(4, 9);
      expect(rig.forward().angleTo(rig.upos.toVector3().negate())).toBeLessThan(1e-9);
    });
  }

  it('the mouse (right button) takes hold of it the same way', () => {
    const rig = at(4 * R);
    const held = surfaceAt(rig, 600, 380)!;
    drag(rig, 'orbit', 600, 380, 700, 330);
    const p = onScreen(rig, held.clone().sub(rig.upos.toVector3()));
    expect(p.x).toBeCloseTo(700, 3);
    expect(p.y).toBeCloseTo(330, 3);
  });

  it('close to the ground it slides under the finger, by millimetres, and the height is kept', () => {
    const rig = at(R + 100, 390, 844); // 100 m up, looking straight down
    const x0 = 195, y0 = 422, x1 = 255, y1 = 500;
    const held = surfaceAt(rig, x0, y0)!;
    const before = rig.upos.toVector3();
    drag(rig, 'touch', x0, y0, x1, y1);
    const p = onScreen(rig, held.clone().sub(rig.upos.toVector3()));
    expect(p.x).toBeCloseTo(x1, 2);
    expect(p.y).toBeCloseTo(y1, 2);
    const moved = rig.upos.toVector3().sub(before).length();
    // about the finger's travel times what a pixel spans on the ground (100 m x pixel angle)
    expect(moved).toBeGreaterThan(100 * rig.pixelAngle * Math.hypot(60, 78) * 0.95);
    expect(moved).toBeLessThan(100 * rig.pixelAngle * Math.hypot(60, 78) * 1.2);
    expect(rig.upos.toVector3().length() - R).toBeCloseTo(100, 4);
  });

  it('towards the horizon the ground never races: a pixel carries at most 30 times what it does straight below', () => {
    const rig = at(R + 100, 390, 844);
    // tilt up until the horizon is in view (two fingers), then take hold of the ground just below it
    rig.vertical.set(1, 0, 0);
    rig.verticalWeight = 1;
    for (let i = 0; i < 40; i++) step(rig, { pan: { dx: 0, dy: 20 } });
    const horizon = Math.acos(R / (R + 100)); // dip of the horizon below the horizontal (rad)
    const el = Math.asin(rig.forward().dot(rig.vertical));
    const y = 422 + (el + horizon) / rig.pixelAngle + 2; // two pixels under the horizon line
    expect(surfaceAt(rig, 195, y)).not.toBeNull();
    const before = rig.upos.toVector3();
    step(rig, { touch: { dx: 0, dy: 10, x: 195, y: y + 10 } });
    const moved = rig.upos.toVector3().sub(before).length();
    expect(moved).toBeGreaterThan(100 * rig.pixelAngle * 10 * 5);        // far ground: much more than straight below
    expect(moved).toBeLessThanOrEqual(100 * rig.pixelAngle * 10 * 30 * 1.001);
  });

  it('off the disc the camera turns at a steady rate, slower when the world is close', () => {
    const far = at(40 * R);
    const d0 = far.upos.toVector3();
    drag(far, 'touch', 100, 100, 200, 100); // empty sky beside a small disc
    expect(far.upos.toVector3().angleTo(d0)).toBeCloseTo(100 * 0.005, 6);
    expect(far.upos.toVector3().length() / R).toBeCloseTo(40, 9);
    const near = at(1.5 * R);
    near.lookAt(new Vector3(0, 1, 0), new Vector3(0, 0, 1)); // looking away: no ground under the finger
    const n0 = near.upos.toVector3();
    drag(near, 'touch', 600, 300, 700, 300);
    // as the ground straight below would follow: pixel angle x height / radius, per pixel
    expect(near.upos.toVector3().angleTo(n0)).toBeCloseTo(100 * near.pixelAngle * 0.5, 6);
  });

  it('with nothing solid to hold (a nebula) it turns about the centre at the steady rate', () => {
    const rig = at(4 * R);
    rig.surface = 0;
    const d0 = rig.upos.toVector3();
    drag(rig, 'touch', 640, 360, 740, 360);
    expect(rig.upos.toVector3().angleTo(d0)).toBeCloseTo(0.5, 6);
    expect(rig.forward().angleTo(rig.upos.toVector3().negate())).toBeLessThan(1e-9);
  });

  it('set to look, or with no target, the finger turns the view in place: the sky goes where it goes', () => {
    for (const setup of [(r: CameraRig) => { r.touchDrag = 'look'; }, (r: CameraRig) => { r.target = null; }]) {
      const rig = at(4 * R, 390, 844);
      setup(rig);
      const before = rig.upos.toVector3();
      const star = rig.ray(195, 422);
      drag(rig, 'touch', 195, 422, 235, 392);
      expect(rig.upos.toVector3().distanceTo(before)).toBe(0);
      const p = onScreen(rig, star);
      expect(p.x).toBeCloseTo(235, 0);
      expect(p.y).toBeCloseTo(392, 0);
    }
  });
});

describe('pinch and wheel', () => {
  it('change the height above the surface by the factor of the pinch', () => {
    const rig = at(3 * R, 390, 844);
    step(rig, { pinch: Math.log(1 / 2) }); // fingers spread to twice as far apart: half as high
    expect(rig.upos.toVector3().length() / R).toBeCloseTo(2, 9);
    step(rig, { pinch: Math.log(4) });
    expect(rig.upos.toVector3().length() / R).toBeCloseTo(5, 9);
    step(rig, { wheel: 1 }); // a wheel tick: 18 %
    expect((rig.upos.toVector3().length() - R) / (4 * R)).toBeCloseTo(1.18, 9);
  });

  it('eases all the way down to the closest approach, and no further', () => {
    const rig = at(3 * R, 390, 844);
    rig.closest = R + 1.6; // the ground: eye height
    const heights: number[] = [];
    for (let i = 0; i < 400; i++) { step(rig, { pinch: -0.08 }); heights.push(rig.upos.toVector3().length() - R); }
    expect(heights[heights.length - 1]).toBeCloseTo(1.6, 6);
    // every step takes off the same share of the height that is left: no rush at the end
    for (let i = 1; i < heights.length; i++) {
      if (heights[i] > 1.61) expect(heights[i] / heights[i - 1]).toBeCloseTo(Math.exp(-0.08), 6);
    }
  });

  it('a camera already closer than zooming goes is not pushed out, and can still zoom out', () => {
    const rig = at(R + 500, 390, 844);
    rig.closest = R * 1.002; // 12.7 km: the camera flew lower than that
    step(rig, { pinch: -0.3 });
    expect(rig.upos.toVector3().length() - R).toBeCloseTo(500, 6);
    step(rig, { pinch: 0.3 });
    expect(rig.upos.toVector3().length() - R).toBeCloseTo(500 * Math.exp(0.3), 6);
  });

  it('zooming out counts as climbing away for a moment (the app then lets the eye leave the ground)', () => {
    const rig = at(R + 1.6, 390, 844);
    rig.closest = R + 1.6;
    step(rig, { pinch: -0.2 });
    expect(rig.rising).toBe(0); // (closer: not climbing)
    step(rig, { pinch: 0.05 });
    expect(rig.rising).toBeCloseTo(1.5, 6);
    for (let i = 0; i < 60; i++) step(rig);
    expect(rig.rising).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 60; i++) step(rig);
    expect(rig.rising).toBe(0);
  });

  it('zooming out stops at the edge of the map and stays finite', () => {
    const rig = at(3 * R);
    for (let i = 0; i < 400; i++) step(rig, { pinch: 2 });
    const d = rig.upos.toVector3().length();
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeCloseTo(5e26, -20);
  });

  it('what is under the fingers stays under them while the world grows', () => {
    const rig = at(4 * R, 390, 844);
    const at0 = { x: 235, y: 380 };
    const held = surfaceAt(rig, at0.x, at0.y)!;
    for (let i = 0; i < 20; i++) step(rig, { pinch: -0.05, pinchAt: at0 });
    expect((rig.upos.toVector3().length() - R) / (3 * R)).toBeCloseTo(Math.exp(-1), 9);
    const p = onScreen(rig, held.clone().sub(rig.upos.toVector3()));
    expect(p.x).toBeCloseTo(at0.x, 3);
    expect(p.y).toBeCloseTo(at0.y, 3);
    // (the world's centre has not moved in the view: it turned under the fingers)
    expect(rig.forward().angleTo(rig.upos.toVector3().negate())).toBeLessThan(1e-9);
  });

  it('with no target a pinch moves along the view by a share of the height, and the wheel sets the flying speed', () => {
    const rig = at(3 * R);
    rig.target = null;
    rig.altitude = 2 * R;
    const fwd = rig.forward();
    step(rig, { pinch: Math.log(1 / 2) });
    expect(rig.upos.toVector3().sub(new Vector3(3 * R, 0, 0)).dot(fwd) / R).toBeCloseTo(1, 9);
    const speed = rig.speedFactor;
    step(rig, { wheel: -1 });
    expect(rig.speedFactor).toBeCloseTo(speed * 1.5, 9);
  });
});

describe('a double tap on the world the camera is at', () => {
  it('comes closer over a moment, at an even pace, holding the tapped place where it is', () => {
    const rig = at(4 * R, 390, 844);
    const tap = { x: 150, y: 470 };
    const held = surfaceAt(rig, tap.x, tap.y)!;
    rig.zoomToward(tap, -Math.log(6));
    const heights: number[] = [3 * R];
    for (let i = 0; i < 60; i++) { step(rig); heights.push(rig.upos.toVector3().length() - R); }
    expect(heights[heights.length - 1] / (3 * R)).toBeCloseTo(1 / 6, 6);
    // done in under half a second, and nothing after
    expect(heights[28] / (3 * R)).toBeCloseTo(1 / 6, 6);
    // each frame takes the same share of the height: an even pace
    const ratios = heights.slice(1, 26).map((h, i) => h / heights[i]);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(1e-9);
    const p = onScreen(rig, held.clone().sub(rig.upos.toVector3()));
    expect(p.x).toBeCloseTo(tap.x, 3);
    expect(p.y).toBeCloseTo(tap.y, 3);
  });

  it('gives way to the hand: a pinch takes over', () => {
    const rig = at(4 * R, 390, 844);
    rig.zoomToward({ x: 195, y: 422 }, -Math.log(6));
    step(rig);
    step(rig, { pinch: 0.1 });
    const h = rig.upos.toVector3().length();
    for (let i = 0; i < 30; i++) step(rig);
    expect(rig.upos.toVector3().length()).toBe(h);
  });
});

describe('two fingers', () => {
  it('a two-finger drag looks around in place, even while one finger orbits', () => {
    const rig = at(4 * R, 390, 844);
    const before = rig.upos.toVector3();
    const star = rig.ray(195, 422);
    for (let i = 0; i < 10; i++) step(rig, { pan: { dx: -3, dy: 5 } });
    expect(rig.upos.toVector3().distanceTo(before)).toBe(0);
    const p = onScreen(rig, star);
    expect(p.x).toBeCloseTo(195 - 30, 0);
    expect(p.y).toBeCloseTo(422 + 50, 0);
  });

  it('a twist turns the view with the fingers', () => {
    const rig = at(4 * R, 390, 844);
    const star = rig.ray(295, 422); // to the right of the centre
    step(rig, { twist: 0.3 });
    const p = onScreen(rig, star);
    // clockwise on the screen (y down): from 3 o'clock towards 6 o'clock
    expect(Math.atan2(p.y - 422, p.x - 195)).toBeCloseTo(0.3, 6);
    expect(rig.forward().angleTo(new Vector3(-1, 0, 0))).toBeLessThan(1e-12);
  });
});

describe('looking around near the ground', () => {
  it('keeps the horizon level and stops short of straight up and straight down', () => {
    const rig = at(R + 2, 390, 844);
    rig.vertical.set(1, 0, 0);
    rig.verticalWeight = 1;
    const level = () => Math.abs(rig.right().dot(rig.vertical));
    // from straight down: up to the horizon, round, further up, round again
    for (let i = 0; i < 30; i++) step(rig, { pan: { dx: 0, dy: 15 } });
    for (let i = 0; i < 30; i++) step(rig, { pan: { dx: 17, dy: 0 } });
    for (let i = 0; i < 30; i++) step(rig, { pan: { dx: -9, dy: 11 } });
    expect(level()).toBeLessThan(1e-9);
    for (let i = 0; i < 200; i++) step(rig, { pan: { dx: 3, dy: 40 } });
    const el = Math.asin(rig.forward().dot(rig.vertical));
    expect(el).toBeGreaterThan(1.5);
    expect(el).toBeLessThanOrEqual(1.55 + 1e-9);
    expect(level()).toBeLessThan(1e-9);
    for (let i = 0; i < 400; i++) step(rig, { pan: { dx: 0, dy: -40 } });
    expect(Math.asin(rig.forward().dot(rig.vertical))).toBeGreaterThanOrEqual(-1.55 - 1e-9);
    expect(rig.upos.toVector3().length() - R).toBeCloseTo(2, 9);
  });

  it('in open space the view turns about its own axes, as before', () => {
    const rig = at(4 * R);
    const q = rig.quat.clone();
    step(rig, { look: { dx: 40, dy: -25 } });
    const rate = 0.0025;
    const want = q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -40 * rate)).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 25 * rate));
    expect(rig.quat.angleTo(want)).toBeLessThan(1e-12);
  });
});

describe('carried by a world that turns', () => {
  it('the camera goes round its centre with it: the same ground stays in the same place in the view', () => {
    const rig = at(R + 1.6, 390, 844);
    const ground = surfaceAt(rig, 230, 470)!;
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 7.292e-5 * 3600); // an hour of Earth's spin
    rig.carry(new UPos(), turn);
    ground.applyQuaternion(turn); // (the ground went round too)
    const p = onScreen(rig, ground.clone().sub(rig.upos.toVector3()));
    expect(p.x).toBeCloseTo(230, 6);
    expect(p.y).toBeCloseTo(470, 6);
    expect(rig.upos.toVector3().length() - R).toBeCloseTo(1.6, 6);
    expect(rig.upos.toVector3().angleTo(new Vector3(1, 0, 0))).toBeCloseTo(7.292e-5 * 3600, 9);
  });
});

describe('during a flight', () => {
  it('a finger looks around instead of orbiting, and stopping leaves the camera in open space', () => {
    const rig = at(40 * R);
    rig.flyTo(target(), 3 * R);
    step(rig);
    const d0 = rig.upos.toVector3().length();
    step(rig, { touch: { dx: 30, dy: 0, x: 400, y: 300 } });
    expect(rig.autopilot).toBe(true);
    expect(rig.upos.toVector3().length()).toBeLessThan(d0); // still on its way in
    expect(rig.forward().angleTo(rig.upos.toVector3().negate())).toBeGreaterThan(0.01); // and the view has turned
    rig.cancelGoto();
    expect(rig.autopilot).toBe(false);
    expect(rig.target).toBeNull();
  });
});
