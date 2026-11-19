/**
 * Level-of-detail selection for the catalog octrees.
 *
 * Every octree node knows how bright its brightest object is, so from the
 * camera position we can estimate how bright anything in the node could
 * *appear*. Tiles hold disjoint objects, which means any set of them is a valid
 * thing to draw: the selection simply takes the tiles that matter most from
 * where the camera is until the point budget of the quality tier is spent.
 * Distant faint data is never fetched, and the choice adapts smoothly in flight.
 *
 * Two orderings exist (decided when the tiles are built):
 *   - by apparent brightness in our own sky (stars, bright / nearby galaxies):
 *     near home the selection is exactly "the N brightest objects of the sky";
 *   - by luminosity (the deep galaxy and quasar surveys): whole tree levels give
 *     an even sample of the survey seen from afar, and the tiles around the
 *     camera add its real neighbours.
 *
 * Pure functions: used by the runtime streamer and by the build pipeline
 * (to measure the first-launch download).
 */
import type { DatasetManifest } from './format/schema';

export interface LodNode {
  index: number;
  path: string;
  level: number;
  /** Centre and half-size of the node's cube, in dataset units, relative to the Sun. */
  cx: number;
  cy: number;
  cz: number;
  half: number;
  count: number;
  /** Brightest LOD magnitude in the node. */
  mag: number;
  /** Brightest apparent magnitude seen from the Sun, and median distance from the Sun (datasets that record them). */
  app?: number;
  med?: number;
  bytes: number;
  parent: number;
  children: number[];
}

/** Cube of an octree node from its octant path (`center` = centre of the root cube, default the origin). */
export function nodeCube(rootHalf: number, path: string, center?: readonly [number, number, number]): { cx: number; cy: number; cz: number; half: number } {
  let cx = center?.[0] ?? 0;
  let cy = center?.[1] ?? 0;
  let cz = center?.[2] ?? 0;
  let half = rootHalf;
  for (let i = 0; i < path.length; i++) {
    const oct = path.charCodeAt(i) - 48;
    half /= 2;
    cx += oct & 1 ? half : -half;
    cy += oct & 2 ? half : -half;
    cz += oct & 4 ? half : -half;
  }
  return { cx, cy, cz, half };
}

/** Expand a manifest node table into linked nodes. */
export function buildNodeIndex(ds: DatasetManifest): LodNode[] {
  const byPath = new Map<string, number>();
  const nodes: LodNode[] = ds.nodes.path.map((path, index) => {
    byPath.set(path, index);
    return {
      index, path, level: path.length, ...nodeCube(ds.rootHalf, path, ds.center), count: ds.nodes.count[index]!, mag: ds.nodes.mag[index]!, bytes: ds.nodes.bytes[index]!,
      app: ds.nodes.app?.[index], med: ds.nodes.med?.[index], parent: -1, children: [],
    };
  });
  for (const n of nodes) {
    if (n.path.length === 0) continue;
    const p = byPath.get(n.path.slice(0, -1));
    if (p === undefined) throw new Error(`octree node ${ds.id}/${n.path} has no parent`);
    n.parent = p;
    nodes[p]!.children.push(n.index);
  }
  return nodes;
}

export interface LodOptions {
  /** Maximum number of points to select. */
  budget: number;
  /** Faintest apparent magnitude worth loading a tile for. */
  magLimit: number;
  /** Dataset units per 10 parsecs (converts distance to a distance modulus). */
  tenPc: number;
  /**
   * Luminosity-ordered datasets: points of the budget that the evenly sampled whole levels must
   * leave for the tiles around the camera (the camera's real neighbours matter more than a deeper
   * sample of the far field).
   */
  nearReserve?: number;
  /**
   * Apparent-brightness-ordered datasets: cubes with at most this half-size (dataset units) are
   * filled by their objects, so the local density says how close the nearest of them is likely to be.
   */
  localHalf?: number;
}

export interface LodSelection {
  /** Selected node indices, most important first. */
  nodes: number[];
  /**
   * How many of the leading entries of `nodes` sample the dataset evenly over its whole volume
   * (complete tree levels, or every tile of an apparent-brightness-ordered dataset). They can be
   * drawn as "survey dots" from afar without the choice of tiles showing.
   */
  uniform: number;
  points: number;
  /**
   * Apparent magnitude at which the selection stopped. Points fainter than
   * this are faded out by the shader, so nodes entering or leaving the
   * selection never pop.
   */
  cutoffMag: number;
}

/** Distance from a point to a cube (0 when inside). */
function cubeDistance(n: LodNode, x: number, y: number, z: number): number {
  const dx = Math.max(0, Math.abs(x - n.cx) - n.half);
  const dy = Math.max(0, Math.abs(y - n.cy) - n.half);
  const dz = Math.max(0, Math.abs(z - n.cz) - n.half);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Estimated apparent magnitude of the brightest-looking object in a node, seen from (x, y, z).
 *
 * The distance used is the distance to the node's cube, but never less than a
 * fraction of the mean spacing between the node's own objects: a cube that
 * contains the camera does not mean one of its (sparse) objects is right here.
 * Deep, densely filled tiles around the camera therefore outrank the big sparse
 * ones above them, exactly as their galaxies outshine the distant giants.
 */
export function nodeApparentMag(n: LodNode, x: number, y: number, z: number, tenPc: number): number {
  const spacing = (2 * n.half) / Math.cbrt(Math.max(1, n.count));
  const d = Math.max(cubeDistance(n, x, y, z), 0.4 * spacing);
  return n.mag + 5 * Math.log10(d / tenPc);
}

/** Default `LodOptions.localHalf` (~0.5 kpc for stars, whose unit is the parsec). */
const LOCAL_HALF = 512;

/**
 * How bright a node of an apparent-brightness-ordered dataset looks from (x, y, z) — as an
 * apparent magnitude (smaller = brighter).
 *
 * `sky`: what our own sky says. An object of apparent magnitude g at distance d from the Sun, seen
 * from a point D from the Sun, is at least |d − D| away, so it looks no brighter than
 * g + 5·log10|1 − D/d|. With the node's brightest g (`app`) and the typical d of its objects (`med`)
 * this is exact at the Sun and a fair estimate for the bulk of the node elsewhere — a little brighter
 * while the camera is among those objects, fainter once it has left them behind. (The few objects
 * that happen to lie right next to the camera are the business of `local`, not of this estimate,
 * which exists to keep the sky evenly deep.) It can never beat what the node's cube allows.
 *
 * `local`: close to the camera an intrinsically faint object can outshine everything, so small
 * cubes around the camera are also judged by "the nearest neighbour is a fraction of the mean
 * spacing away".
 */
export function nodeBrightness(n: LodNode, x: number, y: number, z: number, tenPc: number, localHalf = LOCAL_HALF): { sky: number; local: number } {
  const fromSun = Math.sqrt(x * x + y * y + z * z);
  let sky = n.app! + 5 * Math.log10(Math.max(Math.abs(1 - fromSun / n.med!), 0.7));
  const dc = cubeDistance(n, x, y, z);
  if (dc > 0) sky = Math.max(sky, n.mag + 5 * Math.log10(dc / tenPc));
  let local = Infinity;
  // (Only once the camera has moved a fair way toward the node's objects: at home, `sky` is the exact answer.)
  if (n.half <= localHalf && fromSun > 0.25 * n.med!) {
    const spacing = (2 * n.half) / Math.cbrt(Math.max(1, n.count));
    local = n.mag + 5 * Math.log10(Math.max(dc, 0.4 * spacing) / tenPc);
  }
  return { sky, local };
}

/**
 * Selection for datasets ordered by apparent brightness in our sky: the tiles that look brightest
 * from here are simply taken until the budget is spent. `cutoffMag` is the brightest `sky` value
 * left out: drawing down to it shows a sky that is complete to one magnitude in every direction
 * (exactly so near the Sun).
 */
function selectByBrightness(nodes: LodNode[], x: number, y: number, z: number, opts: LodOptions): LodSelection {
  const keyed = nodes.map((n) => {
    const b = nodeBrightness(n, x, y, z, opts.tenPc, opts.localHalf);
    return { id: n.index, count: n.count, key: Math.min(b.sky, b.local), sky: b.sky };
  });
  keyed.sort((a, b) => a.key - b.key || a.id - b.id);
  const out: number[] = [];
  let points = 0;
  let cutoff = opts.magLimit;
  let full = false;
  for (const k of keyed) {
    if (!full && k.key <= opts.magLimit && (points === 0 || points + k.count <= opts.budget)) {
      out.push(k.id);
      points += k.count;
    } else {
      full = true;
      cutoff = Math.min(cutoff, k.sky);
    }
  }
  return { nodes: out, uniform: out.length, points, cutoffMag: cutoff };
}

/** Scratch space for `selectLevelsAndNear` (keys by node index), grown on demand. */
let nearKeys = new Float64Array(0);

/**
 * Selection for datasets ordered by luminosity (the deep surveys).
 *
 * 1. Whole tree levels, shallowest first, while they fit: each complete level is an even sample
 *    of the whole survey (its most luminous members everywhere), which is what a survey seen from
 *    afar needs.
 * 2. Every other tile on its own merits: how bright its brightest member could look from the
 *    camera. The chain of ever smaller tiles around the camera comes first — the galaxies one
 *    would actually fly to next — then their neighbours, out to wherever the budget ends.
 */
function selectLevelsAndNear(nodes: LodNode[], x: number, y: number, z: number, opts: LodOptions): LodSelection {
  const out: number[] = [];
  let points = 0;
  // The node table is sorted by level, so a level is a contiguous run.
  const levelBudget = opts.budget - Math.min(opts.nearReserve ?? 0, opts.budget);
  let next = 0;
  while (next < nodes.length) {
    const level = nodes[next]!.level;
    let end = next;
    let count = 0;
    while (end < nodes.length && nodes[end]!.level === level) count += nodes[end++]!.count;
    // The root is always taken: it holds the most luminous objects of the whole catalogue.
    if (level > 0 && points + count > levelBudget) break;
    for (let i = next; i < end; i++) out.push(i);
    points += count;
    next = end;
  }
  const uniform = out.length;

  if (nearKeys.length < nodes.length) nearKeys = new Float64Array(nodes.length);
  const keys = nearKeys;
  const near: number[] = [];
  for (let i = next; i < nodes.length; i++) {
    const key = nodeApparentMag(nodes[i]!, x, y, z, opts.tenPc);
    if (key > opts.magLimit) continue;
    keys[i] = key;
    near.push(i);
  }
  near.sort((a, b) => keys[a]! - keys[b]! || a - b);
  let cutoff = opts.magLimit;
  for (const i of near) {
    const n = nodes[i]!;
    if (points + n.count > opts.budget) {
      // Budget exhausted: everything left is (estimated to be) fainter than this.
      cutoff = Math.min(cutoff, keys[i]!);
      break;
    }
    out.push(i);
    points += n.count;
  }
  return { nodes: out, uniform, points, cutoffMag: cutoff };
}

export function selectNodes(nodes: LodNode[], x: number, y: number, z: number, opts: LodOptions): LodSelection {
  if (nodes.length === 0) return { nodes: [], uniform: 0, points: 0, cutoffMag: opts.magLimit };
  if (nodes[0]!.app !== undefined && nodes[0]!.med !== undefined) return selectByBrightness(nodes, x, y, z, opts);
  return selectLevelsAndNear(nodes, x, y, z, opts);
}
