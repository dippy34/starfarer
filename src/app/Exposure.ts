import { type Quaternion, Vector3 } from 'three';
import { discCovered } from '../core/discs';

/**
 * How the eye of the explorer adapts: what counts as "in view", and how fast the exposure follows.
 *
 * The exposure is held down by the bright things in the frame (a sunlit world, a star's disc, an
 * accretion disk). What matters is how much of each is in the frame — not whether its centre is:
 * a disk whose centre has left the frame can still fill it. So everything here is measured from
 * the edge of what shines to the edge of the frame, and nothing switches: a limit holds while any
 * of the source is in view, and lets go gradually as the source moves a margin beyond the edge.
 * Worlds and stars are balls (seen); an accretion disk is flat, and wide enough to be flown
 * into (diskSeen, diskLimit). Its middle, the brightest thing there is, has a limit of its own
 * that is no matter of adapting: a place in space has one answer (diskMiddle, middleLimit).
 *
 * Pure geometry and arithmetic (tests/exposure.test.ts); src/app/App.ts gathers the sources.
 */

/** The frame as the camera sees it. */
export interface Frame {
  /** world orientation of the view */
  quat: Quaternion;
  /** vertical field of view (degrees) and width over height */
  fovY: number;
  aspect: number;
}

export interface Seen {
  /** the share of the frame the source covers, 0..1 */
  coverage: number;
  /** the share of the source's disc that is inside the frame, 0..1 */
  shown: number;
  /** 1 while any of it is in the frame, falling to 0 as it moves a margin beyond the edge */
  presence: number;
  /** from the middle of the frame to the source's centre (rad) */
  angle: number;
  /** from the middle of the frame to its edge, towards the source (rad) */
  halfFrame: number;
  /** angular radius of the source (rad) */
  size: number;
}

/** a source keeps its hold on the exposure until it is this share of the frame's half-size beyond the edge */
export const MARGIN = 0.35;
/** discs wider than this are judged by how far their limb reaches into the frame, not by their area */
const BIG = 0.35;

/**
 * How much of a sphere is in the frame. `rel`: from the eye to its centre (world axes, m);
 * `radius`: of what shines (m). `scratch` is overwritten.
 */
export function seen(rel: Vector3, radius: number, frame: Frame, scratch: Vector3, inverse: Quaternion): Seen {
  const dist = rel.length();
  const size = Math.asin(Math.min(1, radius / Math.max(dist, 1e-30)));
  const c = scratch.copy(rel).applyQuaternion(inverse).divideScalar(Math.max(dist, 1e-30));
  const angle = Math.acos(Math.max(-1, Math.min(1, -c.z)));
  const ty = Math.tan((frame.fovY * Math.PI) / 360), tx = ty * frame.aspect;
  // the frame's edge in the direction of the source: its half-size along that direction (a source
  // in the very middle has no direction: there the frame's smaller half-size, blended in)
  const ux = Math.abs(c.x), uy = Math.abs(c.y), off = Math.hypot(ux, uy);
  const towards = off < 1e-12 ? Math.min(tx, ty) : Math.min(ux > 0 ? tx / ux : Infinity, uy > 0 ? ty / uy : Infinity) * off;
  const edge = Math.min(tx, ty) + (towards - Math.min(tx, ty)) * smooth(off / 0.08);
  const halfFrame = Math.atan(edge);
  // how far the disc reaches into the frame (negative: the gap between its edge and the frame's)
  const reach = size + halfFrame - angle;
  const shown = size > 0 ? smooth(reach / (2 * size)) : reach > 0 ? 1 : 0;
  // a small disc covers its own area; a big one covers the frame as far as its limb has come in
  const area = Math.min(1, (Math.PI * size * size) / (4 * Math.atan(tx) * Math.atan(ty))) * shown;
  const limb = clamp01(reach / (2 * halfFrame));
  const coverage = area + (limb - area) * smooth((size - BIG * 0.85) / (BIG * 0.6));
  const margin = MARGIN * Math.min(Math.atan(tx), Math.atan(ty));
  const presence = smooth(1 + reach / margin);
  return { coverage, shown, presence, angle, halfFrame, size };
}

/**
 * The share (0..1) of a shining ball's disc that another ball hides from the eye: none of it if
 * the other is beyond it. `rel`, `radius`: the ball that shines; `relOther`, `radiusOther`: what may
 * stand in front (from the eye, m). A sun behind a world holds no exposure and throws no glare.
 */
export function hidden(rel: Vector3, radius: number, relOther: Vector3, radiusOther: number): number {
  const d = rel.length(), dO = relOther.length();
  if (!(dO < d) || !(d > radius) || !(dO > radiusOther)) return 0;
  const sep = Math.acos(Math.max(-1, Math.min(1, rel.dot(relOther) / (d * dO))));
  return discCovered(Math.asin(radius / d), Math.asin(radiusOther / dO), sep);
}

/** cells across the frame and its margin, each way, that a disk is looked for in */
const CELLS = 26;
/** (and one entry more: the middle of the disk, where no cell resolves it) */
const ENTRIES = CELLS * CELLS + 1;
const cellRadius = new Float64Array(ENTRIES), cellApproach = new Float64Array(ENTRIES);
const cellShare = new Float64Array(ENTRIES), cellDepth = new Float64Array(ENTRIES);
const cellRadiance = new Float64Array(ENTRIES), cellOrder = new Uint16Array(ENTRIES);
const centre = new Vector3(), axis = new Vector3();

/**
 * A flat disk as the frame sees it, cell by cell (only the cells that see any of it). The arrays
 * are shared between calls: read them before the next one.
 */
export interface DiskSeen {
  /** how many cells see the disk */
  count: number;
  /** where each sees it: the radius (m) */
  radius: Float64Array;
  /** how the gas there moves as seen: the cosine of the angle from its orbit's direction to the eye (1: straight at it) */
  approach: Float64Array;
  /** the share of the frame each adds (a cell out in the margin less) */
  share: Float64Array;
  /** how far into the frame the disk comes in each: 1 in the frame, falling to 0 a margin beyond its edge */
  depth: Float64Array;
  /** together: the share of the frame that sees the disk (0..1), and whether any of it is in the frame (as `depth`) */
  coverage: number;
  presence: number;
  /** the smallest radius seen (m): Infinity if none */
  nearest: number;
  /**
   * The middle of the disk, where it is too small in the frame for the cells to resolve: an entry
   * of its own (its index; -1 if the cells resolve the disk down to its inner edge). Its `radius`
   * is that of the part it stands for, everything inside which is one cell's worth of the frame;
   * its `approach` the most its gas comes towards the eye, on the side that does (the other side
   * goes away as much).
   */
  core: number;
  /** the inner radius of the disk (m) */
  inner: number;
}

/**
 * How much of a flat disk (an accretion disk) is in the frame, and which parts of it. A disk is
 * not a ball: from within its own radius it lies all round the eye, and it is in view looking
 * away from its centre too. So the frame, with its margin, is cut into cells, and each cell's
 * sight line is followed to the disk's plane. `rel`: from the eye to the centre, `normal`: of the
 * plane, the way its gas turns round (world axes); `inner`, `outer`: its radii (m).
 *
 * Nothing switches as the view turns: a cell the disk's edge passes through counts for the part
 * of it the disk takes (from how far the edge is from the cell's middle), and the cells of the
 * margin count the less the farther out they are. Light bending is left out: it reshapes the
 * picture close to the hole, where the disk is measured as a ball instead (see App.updateExposure).
 *
 * A cell sees a patch of the disk, and counts as the radius of a patch its size at the least:
 * from far off one cell takes in the whole bright middle, and must not count as the very hottest
 * point because a sight line passes through that. What is inside that radius around the centre
 * is the `core`: one entry for all of it, which diskLimit counts by its light.
 */
export function diskSeen(rel: Vector3, normal: Vector3, inner: number, outer: number, frame: Frame, inverse: Quaternion): DiskSeen {
  const out: DiskSeen = { count: 0, radius: cellRadius, approach: cellApproach, share: cellShare, depth: cellDepth, coverage: 0, presence: 0, nearest: Infinity, core: -1, inner };
  if (!(outer > 0)) return out;
  // in the camera's axes and in units of the disk's radius: its centre c, and the plane's normal n
  // pointing from the eye's side to the plane, which is then h away
  const c = centre.copy(rel).applyQuaternion(inverse).divideScalar(outer);
  const n = axis.copy(normal).applyQuaternion(inverse);
  let h = c.dot(n), turn = 1;
  if (h < 0) { n.negate(); h = -h; turn = -1; }
  const ty = Math.tan((frame.fovY * Math.PI) / 360), tx = ty * frame.aspect;
  const ax = Math.atan(tx), ay = Math.atan(ty), margin = MARGIN * Math.min(ax, ay);
  const wx = Math.tan(Math.min(ax + margin, 1.4)), wy = Math.tan(Math.min(ay + margin, 1.4));
  const du = (2 * wx) / CELLS, dv = (2 * wy) / CELLS;
  const cell = (du * dv) / (4 * tx * ty); // a cell's share of the frame
  const least = inner / outer;
  let count = 0;
  for (let j = 0; j < CELLS; j++) {
    const v = ((2 * j + 1) / CELLS - 1) * wy;
    for (let i = 0; i < CELLS; i++) {
      const u = ((2 * i + 1) / CELLS - 1) * wx;
      // The sight line d = (u, v, -1) meets the plane at h/a along it, at q/a from the centre.
      // G = a - |q| is positive where that is on the disk, and negative off it and above the
      // plane's horizon alike: one smooth edge, the disk's rim.
      const a = n.x * u + n.y * v - n.z;
      const qx = h * u - a * c.x, qy = h * v - a * c.y, qz = -h - a * c.z;
      const q = Math.hypot(qx, qy, qz);
      const G = a - q;
      // how much G changes across the cell: the edge is G / that from the middle, in cells
      const qc = qx * c.x + qy * c.y + qz * c.z;
      const gu = q > 1e-300 ? n.x - (h * qx - n.x * qc) / q : n.x, gv = q > 1e-300 ? n.y - (h * qy - n.y * qc) / q : n.y;
      const across = du * Math.abs(gu) + dv * Math.abs(gv);
      const part = across > 0 ? clamp01(0.5 + G / across) : G > 0 ? 1 : 0;
      if (part <= 0) continue;
      // How far inside the frame's edge the cell's middle is (negative: out in the margin), for
      // what it adds to the cover; and how far in the disk has come in it. With the disk's edge
      // taken as straight across the cell, its inmost point there is a corner of the cell if the
      // disk lies on the cell's inner side, and where its edge leaves the cell if on the outer.
      const au = Math.abs(u), av = Math.abs(v);
      const window = smooth(1 + Math.min(ax - Math.atan(au), ay - Math.atan(av)) / margin);
      const inU = -Math.sign(u) * gu, inV = -Math.sign(v) * gv; // how G grows towards the frame's middle
      const fu = inU >= 0 ? 1 : clamp01(0.5 + (G + (Math.abs(gv) * dv) / 2) / (-inU * du));
      const fv = inV >= 0 ? 1 : clamp01(0.5 + (G + (Math.abs(gu) * du) / 2) / (-inV * dv));
      const outU = ax - Math.atan(au + du / 2), outV = ay - Math.atan(av + dv / 2);
      const reach = Math.min(outU + fu * (ax - Math.atan(Math.max(0, au - du / 2)) - outU), outV + fv * (ay - Math.atan(Math.max(0, av - dv / 2)) - outV));
      const depth = smooth(1 + reach / margin);
      if (depth <= 0) continue;
      // The radius the cell sees: the least of where the sight lines through the middle of the
      // disk's part of it and through its corners land (a cell cut by the disk's horizon sees the
      // far disk below that, not what its own middle points at), but no less than the radius of a
      // patch the cell's own size there (du dv h^2 / a^3: its footprint on the plane). From far
      // off, one cell takes in the whole core: it must not count as the core's very middle
      // because a sight line passes through that.
      let radius = 1, approach = 0;
      const g2 = gu * gu + gv * gv;
      const shift = part < 1 && g2 > 0 ? ((1 - part) * across) / (2 * g2) : 0;
      const us = u + gu * shift, vs = v + gv * shift;
      const as = n.x * us + n.y * vs - n.z;
      if (as > 0) {
        const sx = h * us - as * c.x, sy = h * vs - as * c.y, sz = -h - as * c.z;
        // (and the cell counts as its hottest corner: a cool disk's glow can change tenfold across one)
        let r2 = (sx * sx + sy * sy + sz * sz) / (as * as);
        for (let k = 0; k < 4; k++) {
          const cu = u + (k & 1 ? du : -du) / 2, cv = v + (k & 2 ? dv : -dv) / 2;
          const ac = n.x * cu + n.y * cv - n.z;
          if (ac <= 0) continue;
          const x = h * cu - ac * c.x, y = h * cv - ac * c.y, z = -h - ac * c.z;
          r2 = Math.min(r2, (x * x + y * y + z * z) / (ac * ac));
        }
        radius = Math.max(least, Math.min(1, Math.sqrt(r2 + (du * dv * h * h) / (Math.PI * as * as * as))));
        // the gas there orbits along normal x (its place from the centre); the eye is back along the sight line
        const ox = n.y * sz - n.z * sy, oy = n.z * sx - n.x * sz, oz = n.x * sy - n.y * sx;
        const o = Math.hypot(ox, oy, oz) * Math.hypot(us, vs, 1);
        if (o > 0) approach = (-turn * (ox * us + oy * vs - oz)) / o;
      }
      cellRadius[count] = outer * radius;
      cellApproach[count] = approach;
      cellShare[count] = part * window * cell;
      cellDepth[count] = depth;
      out.coverage += cellShare[count];
      out.presence = Math.max(out.presence, depth);
      out.nearest = Math.min(out.nearest, cellRadius[count]);
      count++;
    }
  }
  // The middle of the disk, as the sight line to its centre sees it: a patch one cell wide there
  // has the radius `spread`. If that reaches beyond the inner edge, the cells do not resolve what
  // is inside it (they count as that radius at the least, see above): it is one entry.
  const dc = Math.hypot(c.x, c.y, c.z);
  if (c.z < 0 && h > 0 && dc > 0) {
    const u = c.x / -c.z, v = c.y / -c.z;
    const a = n.x * u + n.y * v - n.z; // (= h / -c.z: the centre is on the plane)
    const spread = Math.sqrt((du * dv * h * h) / (Math.PI * a * a * a));
    if (spread > least) {
      const au = Math.abs(u), av = Math.abs(v);
      const inside = Math.min(ax - Math.atan(au), ay - Math.atan(av));
      const window = smooth(1 + inside / margin);
      if (window > 0) {
        cellRadius[count] = outer * Math.min(1, spread);
        // (the gas comes towards the eye at most by the sine of the angle between the sight line and the disk's axis)
        cellApproach[count] = Math.sqrt(Math.max(0, 1 - (h / dc) ** 2));
        // (one cell's worth of the frame, or the whole disk if that is smaller)
        // (it lies over cells already counted: no more of the frame is covered for it)
        cellShare[count] = cell * window * Math.min(1, 1 / (spread * spread));
        cellDepth[count] = window;
        out.core = count;
        count++;
      }
    }
  }
  out.coverage = Math.min(1, out.coverage);
  out.count = count;
  return out;
}

/** how many rings the unresolved middle of a disk is summed over */
const RINGS = 24;

/**
 * The mean radiance of a disk inside `radius`, which is how bright the patch of the frame it takes
 * is on the whole: its light summed ring by ring (rings evenly spaced in the logarithm of the
 * radius: a disk is far brighter inside than out), over what the gas of each ring looks like going
 * round (towards the eye on one side, away on the other, across in between).
 */
export function diskMean(radiance: (radius: number, approach: number) => number, inner: number, radius: number, approach: number): number {
  if (!(radius > inner)) return 0;
  const k = Math.log(radius / inner) / RINGS;
  let sum = 0;
  for (let i = 0; i < RINGS; i++) {
    const r = inner * Math.exp(k * (i + 0.5));
    sum += r * r * 0.25 * (radiance(r, approach) + 2 * radiance(r, 0) + radiance(r, -approach));
  }
  // (the integral of L 2 pi r dr over pi radius^2, with dr = r k)
  return (2 * k * sum) / (radius * radius);
}

/** the brightest part of a disk is judged over this share of the frame (a few cells) */
export const FILL = 0.015;

/**
 * The limit a disk puts on the exposure (log; Infinity for none). A disk has no one brightness:
 * it is far brighter inside than out, more than any exposure can show at once; a cool one fades
 * outwards by orders of magnitude within the frame; and the side whose gas comes towards the eye
 * outshines the other. So the eye is held by the brightest part of it: the brightest FILL of the
 * frame is shown at `level` on average. A part smaller than that counts by its light all the
 * same, as if spread over FILL: a far-off core is a glint, bright but with no more light in it
 * than that, whatever its size (its light is what blooms: left to itself a core two pixels wide
 * and ten thousand times too bright whites out the frame). `radiance`: of the disk as it is drawn
 * at a radius, with its gas moving as `approach` says (DiskSeen); `open`: the exposure with
 * nothing in view.
 */
export function diskLimit(disk: DiskSeen, radiance: (radius: number, approach: number) => number, level: number, open: number): number {
  const n = disk.count;
  for (let i = 0; i < n; i++) {
    cellRadiance[i] = i === disk.core ? diskMean(radiance, disk.inner, disk.radius[i], disk.approach[i]) : radiance(disk.radius[i], disk.approach[i]);
    cellOrder[i] = i;
  }
  const order = cellOrder.subarray(0, n).sort((x, y) => cellRadiance[y] - cellRadiance[x]);
  let limit = Infinity, coverage = 0, light = 0, presence = 0;
  for (let j = 0; j < n; j++) {
    const i = order[j], L = cellRadiance[i];
    if (!(L > 0)) break;
    // the disk at least as bright as here: how much of the frame it takes, the light in it, and whether it is in the frame
    coverage += disk.share[i];
    light += L * disk.share[i];
    presence = Math.max(presence, disk.depth[i]);
    limit = Math.min(limit, released(Math.log((level * Math.max(coverage, FILL)) / light), open, presence));
    // (the rest is dimmer, and no more in view than this)
    if (coverage >= FILL && presence >= 1) break;
  }
  return limit;
}

/**
 * A glint: the light a source too small to make out is shown with, that of a patch GLINT_AREA
 * wide (CSS pixels squared: five across) at GLINT_LEVEL times white. That is a brilliant point
 * with a tight glare round it. With more, the glare is a ball that hides whatever is near (the
 * far-off middle of M87*'s disk, given the light of a patch FILL wide, was one a third of a
 * phone's frame across).
 */
export const GLINT_AREA = 24;
export const GLINT_LEVEL = 6.3;
/** a disk seen edge on still shows this share of its face: its far side, which gravity lifts into view over the hole */
const EDGE_ON = 0.1;

/** The middle of a disk as the eye takes it (diskMiddle). */
export interface DiskMiddle {
  /** its radius on the disk (m) */
  radius: number;
  /** the most its gas comes towards the eye, on the side that does (as DiskSeen.approach) */
  approach: number;
  /** the solid angle it takes as seen (sr) */
  solidAngle: number;
  /** 1 while any of it is in the frame, falling to 0 as it moves a margin beyond the edge */
  presence: number;
}

/**
 * The middle of a disk: what a patch the size of a glint takes in round its centre, and its
 * bright ring (`ring`: its radius, m) at the least. From far off that is the whole disk; close
 * by, the part round the hole that outshines the rest. `rel`: from the eye to the centre;
 * `normal`: of the disk's plane; `pixel`: the solid angle of a CSS pixel (sr). `scratch` is
 * overwritten.
 */
export function diskMiddle(rel: Vector3, normal: Vector3, ring: number, frame: Frame, pixel: number, scratch: Vector3, inverse: Quaternion): DiskMiddle {
  const dist = Math.max(rel.length(), 1e-30);
  const sine = Math.abs(rel.dot(normal)) / dist;
  const face = Math.max(sine, EDGE_ON);
  // (the part of the disk's plane that fills a glint's solid angle from here, at this slant)
  const radius = Math.max(ring, dist * Math.sqrt((GLINT_AREA * pixel) / (Math.PI * face)));
  return {
    radius,
    approach: Math.sqrt(Math.max(0, 1 - sine * sine)),
    solidAngle: (Math.PI * radius * radius * face) / (dist * dist),
    presence: seen(rel, radius, frame, scratch, inverse).presence,
  };
}

/**
 * The most the middle of a disk is drawn with (log exposure; Infinity for no limit), whatever
 * else the eye is set for. As the glowing surface it is, its hottest ring (of radiance `ring`)
 * is shown at `level`. Once that would leave the middle with less light in all than a glint
 * holds, it is given a glint's light instead: as the disk shrinks into the distance it turns into
 * a brilliant point and stays one, until the eye wide open (`open`) has no more to give and it
 * fades as a star does. So the light of the middle only ever falls as the eye moves off, and is
 * what it is at any one place: this is no matter of adapting. `radiance` as for diskLimit;
 * `inner`: the disk's inner radius (m); `pixel`: the solid angle of a CSS pixel (sr).
 */
export function middleLimit(middle: DiskMiddle, radiance: (radius: number, approach: number) => number, inner: number, ring: number, level: number, pixel: number, open: number): number {
  const mean = diskMean(radiance, inner, middle.radius, middle.approach);
  if (!(mean > 0) || !(ring > 0)) return Infinity;
  const glint = Math.log((GLINT_LEVEL * GLINT_AREA * pixel) / (mean * middle.solidAngle));
  return released(Math.max(Math.log(level / ring), glint), open, middle.presence);
}

/** the exposure opens up in the dark over about this long (s), and shuts down for something bright over this */
export const TAU_OPEN = 0.6;
export const TAU_SHUT = 0.12;
/**
 * The stars come back sooner than that once a sun has left the frame: points of light cannot
 * flash, and with twenty e-folds to go a sky left black for two seconds looks broken.
 */
export const TAU_STARS = 0.25;
/** a bright thing coming into view is never shown more than e^DAZZLE times too bright (a third), even for a frame */
export const DAZZLE = 0.3;

/**
 * One step of the eye's adaptation, in log exposure. Slow to open up (stars come out over a
 * moment), quick to shut down, and never more than a little too bright: without that a sun
 * swinging into view whites out the frame until the exposure has caught up.
 */
export function adapt(current: number, target: number, dt: number, open = TAU_OPEN): number {
  if (!Number.isFinite(current)) return target;
  if (target < current) {
    const from = Math.min(current, target + DAZZLE);
    return from + (target - from) * (1 - Math.exp(-dt / TAU_SHUT));
  }
  return current + (target - current) * (1 - Math.exp(-dt / open));
}

/**
 * A limit on the exposure (log) as its source leaves the frame: in full while it is in view,
 * released towards `open` (the exposure with nothing there) as its presence falls to nothing.
 */
export function released(limit: number, open: number, presence: number): number {
  return limit >= open ? Infinity : open + (limit - open) * presence;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function smooth(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}
