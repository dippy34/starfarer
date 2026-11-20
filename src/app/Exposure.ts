import { type Quaternion, Vector3 } from 'three';

/**
 * How the eye of the explorer adapts: what counts as "in view", and how fast the exposure follows.
 *
 * The exposure is held down by the bright things in the frame (a sunlit world, a star's disc, an
 * accretion disk). What matters is how much of each is in the frame — not whether its centre is:
 * a disk whose centre has left the frame can still fill it. So everything here is measured from
 * the edge of what shines to the edge of the frame, and nothing switches: a limit holds while any
 * of the source is in view, and lets go gradually as the source moves a margin beyond the edge.
 * Worlds and stars are balls (seen); an accretion disk is flat, and wide enough to be flown
 * into (diskSeen, diskLimit).
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

/** cells across the frame and its margin, each way, that a disk is looked for in */
const CELLS = 26;
const cellRadius = new Float64Array(CELLS * CELLS), cellApproach = new Float64Array(CELLS * CELLS);
const cellShare = new Float64Array(CELLS * CELLS), cellDepth = new Float64Array(CELLS * CELLS);
const cellRadiance = new Float64Array(CELLS * CELLS), cellOrder = new Uint16Array(CELLS * CELLS);
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
 */
export function diskSeen(rel: Vector3, normal: Vector3, inner: number, outer: number, frame: Frame, inverse: Quaternion): DiskSeen {
  const out: DiskSeen = { count: 0, radius: cellRadius, approach: cellApproach, share: cellShare, depth: cellDepth, coverage: 0, presence: 0, nearest: Infinity };
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
  out.coverage = Math.min(1, out.coverage);
  out.count = count;
  return out;
}

/** a part of a disk taking this share of the frame (a few cells) holds the exposure in full; a smaller part less */
export const FILL = 0.015;

/**
 * The limit a disk puts on the exposure (log; Infinity for none). A disk has no one brightness:
 * it is far brighter inside than out, more than any exposure can show at once; a cool one fades
 * outwards by orders of magnitude within the frame; and the side whose gas comes towards the eye
 * outshines the other. So the eye is held by the brightest part of it there is enough of to
 * see: no part that takes FILL of the frame is shown brighter than `level`; a smaller part may
 * be, the more the smaller it is (the far-off core is a glint). `radiance`: of the disk as it is
 * drawn at a radius, with its gas moving as `approach` says (DiskSeen); `open`: the exposure with
 * nothing in view.
 */
export function diskLimit(disk: DiskSeen, radiance: (radius: number, approach: number) => number, level: number, open: number): number {
  const n = disk.count;
  for (let i = 0; i < n; i++) {
    cellRadiance[i] = radiance(disk.radius[i], disk.approach[i]);
    cellOrder[i] = i;
  }
  const order = cellOrder.subarray(0, n).sort((x, y) => cellRadiance[y] - cellRadiance[x]);
  let limit = Infinity, coverage = 0, presence = 0;
  for (let j = 0; j < n; j++) {
    const i = order[j], L = cellRadiance[i];
    if (!(L > 0)) break;
    // the disk at least as bright as here: how much of the frame it takes, and whether it is in it
    coverage += disk.share[i];
    presence = Math.max(presence, disk.depth[i]);
    const enough = smooth(coverage / FILL);
    if (enough <= 0) continue;
    limit = Math.min(limit, released(Math.log(level / (L * enough)), open, presence));
    // (the rest is dimmer, and no more in view than this)
    if (enough >= 1 && presence >= 1) break;
  }
  return limit;
}

/** the exposure opens up in the dark over about this long (s), and shuts down for something bright over this */
export const TAU_OPEN = 0.6;
export const TAU_SHUT = 0.12;
/** a bright thing coming into view is never shown more than e^DAZZLE times too bright (a third), even for a frame */
export const DAZZLE = 0.3;

/**
 * One step of the eye's adaptation, in log exposure. Slow to open up (stars come out over a
 * moment), quick to shut down, and never more than a little too bright: without that a sun
 * swinging into view whites out the frame until the exposure has caught up.
 */
export function adapt(current: number, target: number, dt: number): number {
  if (!Number.isFinite(current)) return target;
  if (target < current) {
    const from = Math.min(current, target + DAZZLE);
    return from + (target - from) * (1 - Math.exp(-dt / TAU_SHUT));
  }
  return current + (target - current) * (1 - Math.exp(-dt / TAU_OPEN));
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
