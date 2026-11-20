import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { adapt, DAZZLE, diskLimit, diskMean, diskSeen, FILL, hidden, MARGIN, released, seen, TAU_OPEN, TAU_SHUT, TAU_STARS, type Frame } from '../src/app/Exposure';

const deg = Math.PI / 180;
const wide: Frame = { quat: new Quaternion(), fovY: 50, aspect: 16 / 9 };
const phone: Frame = { quat: new Quaternion(), fovY: 70, aspect: 390 / 844 };

/** A sphere of angular radius `size` (deg), `right` and `up` degrees from the middle of the frame. */
function look(frame: Frame, size: number, right: number, up = 0) {
  const dir = new Vector3(0, 0, -1).applyAxisAngle(new Vector3(0, 1, 0), -right * deg).applyAxisAngle(new Vector3(1, 0, 0), up * deg);
  const dist = 1e9;
  return seen(dir.multiplyScalar(dist), dist * Math.sin(size * deg), frame, new Vector3(), frame.quat.clone().invert());
}

describe('how much of a bright thing is in the frame', () => {
  it('a disc in the middle is all there; the frame it covers is its area', () => {
    const s = look(wide, 5, 0);
    expect(s.shown).toBe(1);
    expect(s.presence).toBe(1);
    // 5 degrees of radius in a 79 x 50 degree frame
    expect(s.coverage).toBeCloseTo((Math.PI * 25) / (79.3 * 50), 2);
  });

  it('leaving sideways, it is there as long as any of it is in the frame, and goes gradually beyond', () => {
    const half = Math.atan(Math.tan(25 * deg) * (16 / 9)) / deg; // 39.7: half the frame across
    expect(look(wide, 5, half - 6).shown).toBe(1);                 // all in
    expect(look(wide, 5, half).shown).toBeCloseTo(0.5, 6);          // centre on the edge: half of it
    expect(look(wide, 5, half).presence).toBe(1);
    expect(look(wide, 5, half + 4.9).presence).toBe(1);             // a sliver left: still there
    expect(look(wide, 5, half + 4.9).shown).toBeGreaterThan(0);
    expect(look(wide, 5, half + 5.1).shown).toBe(0);
    const margin = MARGIN * 25;                                      // of the frame's smaller half-size
    const fading = look(wide, 5, half + 5 + margin / 2).presence;
    expect(fading).toBeGreaterThan(0.2);
    expect(fading).toBeLessThan(0.8);
    expect(look(wide, 5, half + 5 + margin).presence).toBeCloseTo(0, 9);
    expect(look(wide, 5, 170).presence).toBe(0);                   // behind the eye
  });

  it('nothing jumps on the way out: presence, share shown and coverage all change a little per degree', () => {
    for (const [frame, size] of [[wide, 7], [phone, 7], [phone, 30], [wide, 60]] as const) {
      let prev = look(frame, size, 0);
      for (let a = 0.25; a <= 179; a += 0.25) {
        const s = look(frame, size, a);
        expect(Math.abs(s.presence - prev.presence)).toBeLessThan(0.08);
        expect(Math.abs(s.shown - prev.shown)).toBeLessThan(0.08);
        expect(Math.abs(s.coverage - prev.coverage)).toBeLessThan(0.03);
        prev = s;
      }
      expect(prev.presence).toBe(0);
    }
  });

  it('an upright frame is narrow across and tall up and down: the edge is where the frame ends that way', () => {
    // 20 degrees to the side is outside a phone's frame (18 across), 20 degrees up is well inside (35)
    expect(look(phone, 1, 20).shown).toBe(0);
    expect(look(phone, 1, 0, 20).shown).toBe(1);
    expect(look(phone, 1, 0, 37).shown).toBe(0);
    expect(look(wide, 1, 37).shown).toBe(1);
  });

  it('a disk whose centre is far out of frame is still there while its rim reaches in (a black hole seen close)', () => {
    // centre 60 degrees to the side, the disk 50 degrees in radius: it fills a good part of the frame
    const s = look(phone, 50, 60);
    expect(s.presence).toBe(1);
    expect(s.coverage).toBeGreaterThan(0.15);
    // and a world filling the view from the ground: looking along the horizon it covers half the frame
    const ground = look(wide, 89.9, 0, -90);
    expect(ground.coverage).toBeCloseTo(0.5, 2);
    expect(look(wide, 89.9, 0, -120).coverage).toBeLessThan(0.02); // looking 30 degrees above it
    expect(look(wide, 89.9, 0, -60).coverage).toBe(1);              // and 30 degrees below: all ground
  });
});

describe('the eye adapting', () => {
  it('opens up slowly and shuts quickly', () => {
    const up = adapt(0, 10, 0.1), down = adapt(10, 9.8, 0.1);
    expect(up).toBeCloseTo(10 * (1 - Math.exp(-0.1 / TAU_OPEN)), 9);
    expect(10 - down).toBeCloseTo(0.2 * (1 - Math.exp(-0.1 / TAU_SHUT)), 9);
    expect(TAU_OPEN / TAU_SHUT).toBeGreaterThan(3);
  });

  it('is never more than a little too bright when something bright comes into view', () => {
    // a sun swings into a dark-adapted view: 23 e-folds too bright
    const first = adapt(13, -10, 1 / 60);
    expect(first - -10).toBeLessThanOrEqual(DAZZLE);
    let x = first;
    for (let i = 0; i < 30; i++) x = adapt(x, -10, 1 / 60);
    expect(x).toBeCloseTo(-10, 1); // settled within half a second
  });

  it('opening up, stars come out over a moment: no jump', () => {
    let x = -10, t = 0, steps: number[] = [];
    while (x < 12 && t < 20) { const n = adapt(x, 13, 1 / 60); steps.push(n - x); x = n; t += 1 / 60; }
    expect(t).toBeGreaterThan(1.2);  // from a sun's exposure to nearly dark-adapted takes over a second
    expect(t).toBeLessThan(4);
    expect(Math.max(...steps)).toBeLessThan(0.7); // never doubling within a frame
  });

  it('starts from the target when it has no history', () => {
    expect(adapt(NaN, 3, 0.016)).toBe(3);
    expect(adapt(Infinity, 3, 0.016)).toBe(3);
  });
});

describe('a sun behind a world', () => {
  const AU = 1.496e11, SUN = 6.957e8, EARTH = 6.371e6;
  // the eye in the Earth's shadow, three radii behind it, `off` radii off the line from the Sun
  const behind = (off: number) => hidden(new Vector3(0, 0, -AU), SUN, new Vector3(off * EARTH, 0, -3 * EARTH), EARTH);

  it('is hidden: all of it on the line, none of it once the eye is out of the shadow', () => {
    expect(behind(0)).toBe(1);
    expect(behind(0.5)).toBe(1);
    expect(behind(1.2)).toBe(0);
    expect(behind(5)).toBe(0);
  });

  it('comes out from behind the limb gradually, with no step', () => {
    let prev = behind(0.9);
    for (let off = 0.9; off <= 1.1; off += 0.0005) {
      const h = behind(off);
      expect(h).toBeLessThanOrEqual(prev + 1e-12);
      expect(prev - h).toBeLessThan(0.05);
      prev = h;
    }
    expect(prev).toBe(0);
  });

  it('is not hidden by what is beyond it, nor by a moon too small to cover it', () => {
    // the Earth on the far side of the Sun
    expect(hidden(new Vector3(0, 0, -AU), SUN, new Vector3(0, 0, -2 * AU), EARTH)).toBe(0);
    // Phobos from Mars's distance in front of the Sun: a few thousandths of its disc (a transit)
    const h = hidden(new Vector3(0, 0, -1.52 * AU), SUN, new Vector3(0, 0, -9.4e6), 11e3);
    expect(h).toBeGreaterThan(0.01);
    expect(h).toBeLessThan(0.2);
  });

  it('the stars come back sooner than the rest opens up', () => {
    expect(TAU_STARS).toBeLessThan(TAU_OPEN);
    // from a sun's exposure to the dark's, some twenty e-folds: within three of it in half a second
    let x = -10;
    for (let t = 0; t < 0.5; t += 1 / 60) x = adapt(x, 12, 1 / 60, TAU_STARS);
    expect(12 - x).toBeLessThan(3.2);
    // (and shutting is as quick as ever, whatever the opening)
    expect(adapt(12, -10, 1 / 60, TAU_STARS)).toBe(adapt(12, -10, 1 / 60));
  });
});

describe('a limit on the exposure, released as its source leaves', () => {
  it('holds in full while the source is in view and lets go smoothly', () => {
    expect(released(-8, 13, 1)).toBe(-8);
    expect(released(-8, 13, 0)).toBe(13);
    expect(released(-8, 13, 0.5)).toBeCloseTo(2.5, 9);
    // a limit above the dark exposure limits nothing
    expect(released(20, 13, 1)).toBe(Infinity);
  });
});

/**
 * A disk of radius `outer` lying level, and an eye `height` over its plane, `out` from its centre:
 * facing `yaw` degrees round from the centre (0: towards it, 180: away) and `pitch` degrees up.
 */
function overDisk(frame: Frame, outer: number, out: number, height: number, yaw: number, pitch = 0, inner = outer / 1e4) {
  const quat = new Quaternion().setFromEuler(new Euler(pitch * deg, yaw * deg, 0, 'YXZ'));
  const d = diskSeen(new Vector3(0, -height, -out), new Vector3(0, 1, 0), inner, outer, { ...frame, quat }, quat.clone().invert());
  return { disk: d, count: d.count, coverage: d.coverage, presence: d.presence, nearest: d.nearest };
}

describe('how much of a flat disk is in the frame', () => {
  it('face on and small, it covers its own area', () => {
    // 6 degrees of radius, seen from straight above its centre, looking down at it
    const h = 1e9, r = h * Math.tan(6 * deg);
    const s = overDisk(wide, r, 0, h, 0, -90);
    const frameArea = 4 * Math.tan(25 * deg) * (16 / 9) * Math.tan(25 * deg);
    expect(s.coverage).toBeGreaterThan(((Math.PI * Math.tan(6 * deg) ** 2) / frameArea) * 0.9);
    expect(s.coverage).toBeLessThan(((Math.PI * Math.tan(6 * deg) ** 2) / frameArea) * 1.1);
    expect(s.presence).toBe(1);
  });

  it('from within its radius it is in view whichever way the eye faces: the frame below its horizon', () => {
    for (const frame of [wide, phone]) {
      for (let yaw = 0; yaw < 360; yaw += 15) {
        const s = overDisk(frame, 1e9, 4e5, 7e4, yaw);
        expect(s.presence).toBe(1);
        // the lower half of the frame, and some of the margin below and beside it
        expect(s.coverage).toBeGreaterThan(0.49);
        expect(s.coverage).toBeLessThan(0.75);
      }
    }
  });

  it('its hottest part in view is the middle when that is in the frame, and the disk under the eye looking away', () => {
    const towards = overDisk(phone, 1e9, 4e5, 7e4, 0, -10);
    expect(towards.nearest).toBe(1e5); // its inner edge
    const away = overDisk(phone, 1e9, 4e5, 7e4, 180);
    // the bottom of the frame and its margin look 41 degrees down: 7e4 / tan(41) beyond the eye
    expect(away.nearest).toBeGreaterThan(4e5);
    expect(away.nearest).toBeLessThan(4e5 + (7e4 / Math.tan(41.3 * deg)) * 1.25);
  });

  it('looking up from it, it leaves gradually, and is gone a margin beyond the edge', () => {
    for (const frame of [wide, phone]) {
      const half = frame.fovY / 2, margin = MARGIN * Math.min(half, Math.atan(Math.tan(half * deg) * frame.aspect) / deg);
      let prev = overDisk(frame, 1e9, 4e5, 7e4, 180, 0);
      for (let pitch = 0.25; pitch <= 90; pitch += 0.25) {
        const s = overDisk(frame, 1e9, 4e5, 7e4, 180, pitch);
        expect(Math.abs(s.coverage - prev.coverage)).toBeLessThan(0.02);
        expect(Math.abs(s.presence - prev.presence)).toBeLessThan(0.12);
        if (pitch < half - 1) expect(s.presence).toBeGreaterThan(0.99);
        if (pitch > half + margin + 0.5) expect(s.count).toBe(0);
        prev = s;
      }
    }
  });

  it('tells which way its gas moves: towards the eye on one side of the middle, away on the other', () => {
    // The gas turns round the normal (up): seen from the south, the west side comes towards the eye.
    // A narrow frame aimed at one spot of the disk sees that spot in every cell.
    const narrow: Frame = { quat: new Quaternion(), fovY: 1, aspect: 1 };
    const eye = new Vector3(0, 5e8, 5e8);
    for (const [spot, expected] of [[new Vector3(-5e8, 0, 0), 1], [new Vector3(5e8, 0, 0), -1], [new Vector3(0, 0, -5e8), 0]] as const) {
      const quat = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye, spot, new Vector3(0, 1, 0)));
      const d = diskSeen(eye.clone().negate(), new Vector3(0, 1, 0), 1e5, 1e9, { ...narrow, quat }, quat.clone().invert());
      expect(d.count).toBe(26 * 26);
      // the cosine between the gas's motion there (along z, turning round y) and the way to the eye
      const toEye = eye.clone().sub(spot).normalize();
      const motion = new Vector3(0, 1, 0).cross(spot).normalize();
      for (let i = 0; i < d.count; i += 97) {
        expect(d.approach[i]).toBeCloseTo(motion.dot(toEye), 1);
        expect(Math.sign(Math.round(d.approach[i] * 4)) + 0).toBe(expected);
        expect(d.radius[i]).toBeGreaterThan(4.7e8);
        expect(d.radius[i]).toBeLessThan(5.3e8);
      }
      // and seen from under the disk the same gas moves the same way
      const under = new Vector3(eye.x, -eye.y, eye.z);
      const q2 = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(under, spot, new Vector3(0, 1, 0)));
      const d2 = diskSeen(under.clone().negate(), new Vector3(0, 1, 0), 1e5, 1e9, { ...narrow, quat: q2 }, q2.clone().invert());
      expect(d2.approach[0]).toBeCloseTo(motion.dot(under.clone().sub(spot).normalize()), 1);
    }
  });

  it('nothing jumps as the eye turns round, at any height over it', () => {
    for (const [out, height] of [[4e5, 7e4], [4e5, 4e3], [3e8, 2e8], [2.5e9, 4e8]]) {
      let prev = overDisk(phone, 1e9, out, height, 0, -8);
      for (let yaw = 0.25; yaw <= 360; yaw += 0.25) {
        const s = overDisk(phone, 1e9, out, height, yaw, -8);
        expect(Math.abs(s.coverage - prev.coverage)).toBeLessThan(0.02);
        expect(Math.abs(s.presence - prev.presence)).toBeLessThan(0.12);
        prev = s;
      }
    }
  });

  it('a far-off disk smaller than a cell is a steady speck: it does not flicker as it crosses the frame', () => {
    // 0.3 degrees of radius, crossing the frame as the eye turns
    const h = 1e9, r = h * Math.tan(0.3 * deg);
    let low = Infinity, high = 0;
    for (let yaw = -10; yaw <= 10; yaw += 0.05) {
      const quat = new Quaternion().setFromEuler(new Euler(-90 * deg, 0, yaw * deg, 'YXZ'));
      const c = diskSeen(new Vector3(0, -h, 0), new Vector3(0, 1, 0), r / 100, r, { ...wide, quat }, quat.clone().invert()).coverage;
      low = Math.min(low, c);
      high = Math.max(high, c);
    }
    expect(high).toBeLessThan(0.002);
    expect(low).toBeGreaterThan(0);
  });
});

describe('the limit a disk puts on the exposure', () => {
  // a disk a thousand million times a sunlit world's brightness inside, fading outwards
  const inner = 1e5, outer = 1e9;
  const radiance = (r: number) => 1e9 * (Math.max(r, inner) / inner) ** -0.75;
  const open = 10;
  const limit = (frame: Frame, out: number, height: number, yaw: number, pitch = 0) => diskLimit(overDisk(frame, outer, out, height, yaw, pitch, inner).disk, radiance, 0.9, open);

  it('holds the exposure for the part of the disk in view: looking away from its middle too', () => {
    for (const frame of [wide, phone]) {
      for (let yaw = 0; yaw < 360; yaw += 15) {
        const s = overDisk(frame, outer, 4e5, 7e4, yaw, 0, inner);
        const hottest = Math.log(0.9 / radiance(s.nearest));
        const l = diskLimit(s.disk, radiance, 0.9, open);
        // never brighter than its hottest part allows by much, and far below the open exposure
        expect(l).toBeGreaterThanOrEqual(hottest);
        expect(l).toBeLessThan(hottest + 2.5);
        expect(l).toBeLessThan(open - 15);
      }
    }
  });

  it('lets go once the disk is out of the frame', () => {
    expect(limit(phone, 4e5, 7e4, 180, 60)).toBe(Infinity);
    expect(limit(wide, 4e5, 7e4, 0, 80)).toBe(Infinity);
  });

  it('lets go gradually on the way out, and takes hold gradually on the way in', () => {
    // some 28 e-folds lie between the disk's exposure and the open one, and the margin is 6 degrees:
    // steep, but with no step in it however finely the turn is cut
    let prev = limit(phone, 4e5, 7e4, 180, 0);
    let steepest = 0;
    for (let pitch = 0.02; pitch <= 60; pitch += 0.02) {
      const l = Math.min(open, limit(phone, 4e5, 7e4, 180, pitch));
      steepest = Math.max(steepest, Math.abs(l - prev));
      prev = l;
    }
    expect(prev).toBe(open);
    expect(steepest).toBeLessThan(0.5);
  });

  it('is steady as the eye turns round within the disk', () => {
    for (const [out, height] of [[4e5, 7e4], [4e5, 4e3], [3e8, 5e7], [3e8, 2e8]]) {
      let prev = limit(phone, out, height, 0, -8);
      for (let yaw = 0.25; yaw <= 360; yaw += 0.25) {
        const l = limit(phone, out, height, yaw, -8);
        expect(Math.abs(l - prev)).toBeLessThan(0.05);
        prev = l;
      }
    }
  });

  it('near its rim and from outside it, the disk comes and goes as the eye turns: without a step', () => {
    for (const [out, height] of [[9e8, 1.5e8], [2.5e9, 4e8]]) {
      let prev = Math.min(open, limit(phone, out, height, 0, -8));
      let low = prev, high = prev;
      for (let yaw = 0.02; yaw <= 360; yaw += 0.02) {
        const l = Math.min(open, limit(phone, out, height, yaw, -8));
        expect(Math.abs(l - prev)).toBeLessThan(0.5);
        low = Math.min(low, l);
        high = Math.max(high, l);
        prev = l;
      }
      expect(high).toBe(open);       // looking away from it
      expect(low).toBeLessThan(-5);  // looking at it
    }
  });

  it('seen from far across the disk, the core is one cell among hundreds: it does not set the exposure, wherever a sight line lands', () => {
    // from 0.9 of the way out, 10 degrees up, the middle held at every position within a cell
    let low = Infinity, high = -Infinity;
    for (let yaw = -4; yaw <= 4; yaw += 0.05) {
      for (const pitch of [-10, -9.2, -8.4]) {
        const l = limit(phone, 9e8, 1.6e8, yaw, pitch);
        low = Math.min(low, l);
        high = Math.max(high, l);
      }
    }
    expect(high - low).toBeLessThan(0.5);
    // and the exposure is the wide disk's, far from the core's
    expect(low).toBeGreaterThan(Math.log(0.9 / radiance(inner)) + 3);
  });
});

describe('the bright middle of a disk too far off to resolve', () => {
  // a cool disk (a supermassive hole's): all its glow within a few inner radii, a thousand
  // million times too bright there, and nothing to speak of in the two hundred radii beyond
  const inner = 3, outer = 600;
  const glow = (r: number) => 1e9 * Math.exp(-(Math.max(r, inner) - inner) / 2);
  const open = 12, level = 0.9;
  // looking straight at its centre from 30 degrees above its plane
  const from = (frame: Frame, dist: number) => overDisk(frame, outer, dist * Math.cos(30 * deg), dist * Math.sin(30 * deg), 0, -30, inner);
  /** the light of the whole disk as a share of the frame's (radiance x the share of the frame it takes) */
  const light = (frame: Frame, dist: number) => {
    let sum = 0;
    for (let r = inner; r < inner + 60; r += 0.01) sum += glow(r + 0.005) * 2 * Math.PI * (r + 0.005) * 0.01;
    const ty = Math.tan((frame.fovY * deg) / 2);
    return (sum * Math.sin(30 * deg)) / (dist * dist) / (4 * ty * ty * frame.aspect);
  };

  it('is one entry of its own once the cells cannot tell its inner edge, and none before', () => {
    expect(from(phone, 40).disk.core).toBe(-1);
    const far = from(phone, 5000).disk;
    expect(far.core).toBeGreaterThanOrEqual(0);
    // it stands for what one cell takes in around the centre: more than the glowing part, here
    expect(far.radius[far.core]).toBeGreaterThan(inner + 20);
    expect(far.radius[far.core]).toBeLessThanOrEqual(outer);
    // and adds nothing to the frame the disk covers: an ellipse 600 across at 5000, seen from 30 degrees up
    const ty = Math.tan(35 * deg);
    expect(far.coverage / ((Math.PI * 0.12 ** 2 * 0.5) / (4 * ty * ty * phone.aspect))).toBeCloseTo(1, 0.9);
  });

  it('holds the exposure by its light: a glint, with no more light in it than a bright patch FILL wide', () => {
    for (const frame of [phone, wide]) {
      for (const dist of [1500, 5000, 20000, 80000]) {
        const shown = Math.exp(diskLimit(from(frame, dist).disk, glow, level, open)) * light(frame, dist);
        // (the frame's cells are a measure, not an image: within a third)
        expect(shown).toBeGreaterThan(0.66 * level * FILL);
        expect(shown).toBeLessThan(1.5 * level * FILL);
      }
    }
  });

  it('never lets go as the disk shrinks into the distance: the exposure opens as its light fades, with no step', () => {
    let prev = diskLimit(from(phone, 30).disk, glow, level, open);
    for (let dist = 30 * 1.01; dist < 3e5; dist *= 1.01) {
      const l = diskLimit(from(phone, dist).disk, glow, level, open);
      // (its light falls as the square of the distance: 2 % a step)
      expect(l - prev).toBeLessThan(0.12);
      expect(l - prev).toBeGreaterThan(-0.12);
      prev = l;
    }
  });

  it('the mean over a disk inside a radius, ring by ring', () => {
    // an even glow: its mean over the circle is the share of the circle that glows (within a fifth of a percent)
    expect(diskMean(() => 5, 3, 30, 0.5) / (5 * (1 - 0.01))).toBeCloseTo(1, 2);
    // falling off as the square of the radius: 2 ln(R / inner) / R^2
    expect(diskMean((r) => r ** -2, 3, 30, 0)).toBeCloseTo((2 * Math.log(10)) / 900, 12);
    // a gentler fall: within half a percent
    expect(diskMean((r) => r ** -0.75, 3, 300, 0) / ((2 / 300 ** 2) * ((300 ** 1.25 - 3 ** 1.25) / 1.25))).toBeCloseTo(1, 2);
    // the side whose gas comes towards the eye outshines the other: the mean is of all the way round
    expect(diskMean((_r, approach) => 1 + approach, 3, 30, 0.6)).toBeCloseTo(0.99, 2);
    expect(diskMean((_r, approach) => (approach > 0 ? 10 : 0), 3, 30, 0.6)).toBeCloseTo(2.5 * 0.99, 2);
    // nothing inside the inner edge
    expect(diskMean(() => 5, 3, 2, 0)).toBe(0);
  });
});
