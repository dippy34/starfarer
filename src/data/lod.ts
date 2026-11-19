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
    return { index, path, level: path.length, ...nodeCube(ds.rootHalf, path), count: ds.nodes.count[index]!, mag: ds.nodes.mag[index]!, bytes: ds.nodes.bytes[index]!, parent: -1, children: [] };
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
}

export interface LodSelection {
  /** Selected node indices, brightest-first. */
  nodes: number[];
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

export function selectNodes(nodes: LodNode[], x: number, y: number, z: number, opts: LodOptions): LodSelection {
  const out: number[] = [];
  if (nodes.length === 0) return { nodes: out, points: 0, cutoffMag: opts.magLimit };
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

  // The root is always taken: it holds the most luminous objects of the whole catalogue.
  push(-Infinity, 0);
  let points = 0;
  let cutoff = opts.magLimit;
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
  return { nodes: out, points, cutoffMag: cutoff };
}
