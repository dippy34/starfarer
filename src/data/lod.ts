/**
 * Magnitude-based level-of-detail selection for the catalog octrees.
 *
 * Every octree node knows the intrinsic brightness of its brightest object.
 * From the camera position we can therefore bound how bright anything in the
 * node could *appear*. Nodes are taken best-first in that order until the
 * point budget of the current quality tier is filled, so distant faint data
 * is never fetched or drawn, and the selection adapts smoothly as you fly.
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

/** Cube of an octree node from its octant path. */
export function nodeCube(rootHalf: number, path: string): { cx: number; cy: number; cz: number; half: number } {
  let cx = 0;
  let cy = 0;
  let cz = 0;
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
      index, path, level: path.length, ...nodeCube(ds.rootHalf, path), count: ds.nodes.count[index]!, mag: ds.nodes.mag[index]!, bytes: ds.nodes.bytes[index]!,
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
  /** Faintest apparent magnitude worth drawing. */
  magLimit: number;
  /** Dataset units per 10 parsecs (converts distance to a distance modulus). */
  tenPc: number;
  /**
   * Take whole octree levels first, as many as fit in the budget, before refining around the
   * camera. A complete level samples the catalogue evenly over its whole volume, which is what
   * a survey seen from afar needs (best-first alone over-samples whichever octants are nearest).
   */
  uniformFirst?: boolean;
}

export interface LodSelection {
  /** Selected node indices, brightest-first. */
  nodes: number[];
  /** How many of the leading entries of `nodes` belong to completely loaded levels (0 unless `uniformFirst`). */
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
 * Estimated apparent magnitude of the brightest object in a node, seen from (x, y, z).
 *
 * The distance used is the distance to the node's cube, but never less than a
 * fraction of the mean spacing between the node's own objects: a cube that
 * touches the camera does not mean one of its (sparse) objects does. This keeps
 * the many octants that meet at the Sun from all looking infinitely important.
 */
export function nodeApparentMag(n: LodNode, x: number, y: number, z: number, tenPc: number): number {
  const spacing = (2 * n.half) / Math.cbrt(Math.max(1, n.count));
  const d = Math.max(cubeDistance(n, x, y, z), 0.3 * spacing);
  return n.mag + 5 * Math.log10(d / tenPc);
}

/** Cubes this small (dataset units; ~0.5 kpc for stars) are filled by their objects, so local density means something. */
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
export function nodeBrightness(n: LodNode, x: number, y: number, z: number, tenPc: number): { sky: number; local: number } {
  const fromSun = Math.sqrt(x * x + y * y + z * z);
  let sky = n.app! + 5 * Math.log10(Math.max(Math.abs(1 - fromSun / n.med!), 0.7));
  const dc = cubeDistance(n, x, y, z);
  if (dc > 0) sky = Math.max(sky, n.mag + 5 * Math.log10(dc / tenPc));
  let local = Infinity;
  // (Only once the camera has moved a fair way toward the node's objects: at home, `sky` is the exact answer.)
  if (n.half <= LOCAL_HALF && fromSun > 0.25 * n.med!) {
    const spacing = (2 * n.half) / Math.cbrt(Math.max(1, n.count));
    local = n.mag + 5 * Math.log10(Math.max(dc, 0.4 * spacing) / tenPc);
  }
  return { sky, local };
}

/**
 * Selection for datasets ordered by apparent brightness (stars): tiles hold disjoint objects, so the
 * tree need not be walked top-down — the tiles that look brightest from here are simply taken until
 * the budget is spent. `cutoffMag` is the brightest `sky` value left out: drawing down to it shows a
 * sky that is complete to one magnitude in every direction (exactly so near the Sun).
 */
function selectByBrightness(nodes: LodNode[], x: number, y: number, z: number, opts: LodOptions): LodSelection {
  const keyed = nodes.map((n) => {
    const b = nodeBrightness(n, x, y, z, opts.tenPc);
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
  return { nodes: out, uniform: 0, points, cutoffMag: cutoff };
}

export function selectNodes(nodes: LodNode[], x: number, y: number, z: number, opts: LodOptions): LodSelection {
  const out: number[] = [];
  if (nodes.length === 0) return { nodes: out, uniform: 0, points: 0, cutoffMag: opts.magLimit };
  if (nodes[0]!.app !== undefined && nodes[0]!.med !== undefined) return selectByBrightness(nodes, x, y, z, opts);
  // Binary min-heap of [key, nodeIndex] pairs, ordered by apparent magnitude (smaller = brighter).
  const keys: number[] = [];
  const ids: number[] = [];
  const push = (key: number, id: number): void => {
    let i = keys.length;
    keys.push(key);
    ids.push(id);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      keys[i] = keys[p]!;
      ids[i] = ids[p]!;
      i = p;
    }
    keys[i] = key;
    ids[i] = id;
  };
  const pop = (): [number, number] => {
    const topKey = keys[0]!;
    const topId = ids[0]!;
    const key = keys.pop()!;
    const id = ids.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1]! < keys[c]!) c++;
        if (keys[c]! >= key) break;
        keys[i] = keys[c]!;
        ids[i] = ids[c]!;
        i = c;
      }
      keys[i] = key;
      ids[i] = id;
    }
    return [topKey, topId];
  };

  let points = 0;
  let cutoff = opts.magLimit;
  let uniform = 0;
  if (opts.uniformFirst) {
    // Whole levels, shallowest first, while they fit. Nodes are stored parents-before-children,
    // so a level is a contiguous run of equal path length… as long as the table is sorted by level.
    const taken = new Set<number>();
    for (let level = 0; ; level++) {
      const ids: number[] = [];
      let count = 0;
      for (const n of nodes) {
        if (n.level !== level) continue;
        ids.push(n.index);
        count += n.count;
      }
      if (ids.length === 0 || (level > 0 && points + count > opts.budget)) break;
      for (const id of ids) {
        out.push(id);
        taken.add(id);
      }
      points += count;
    }
    uniform = out.length;
    // Refinement continues best-first from the children of the last complete level.
    for (const id of out) for (const c of nodes[id]!.children) if (!taken.has(c)) push(nodeApparentMag(nodes[c]!, x, y, z, opts.tenPc), c);
  } else {
    // The root is always taken: it holds the most luminous objects of the whole catalogue.
    push(-Infinity, 0);
  }
  while (keys.length > 0) {
    const [key, id] = pop();
    if (key > opts.magLimit) break;
    const node = nodes[id]!;
    if (points > 0 && points + node.count > opts.budget) {
      // Budget exhausted: everything still queued is (estimated to be) fainter than `key`.
      cutoff = Math.min(cutoff, key);
      break;
    }
    out.push(id);
    points += node.count;
    for (const c of node.children) push(nodeApparentMag(nodes[c]!, x, y, z, opts.tenPc), c);
  }
  return { nodes: out, uniform, points, cutoffMag: cutoff };
}
