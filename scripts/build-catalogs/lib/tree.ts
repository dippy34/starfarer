/**
 * Brightness-ordered LOD octree: which object goes into which tile.
 *
 * Objects are inserted from brightest to faintest. Each node keeps the first
 * `capacity` objects that reach it and passes the rest down to its children,
 * so the root holds the brightest objects of the whole catalogue and every
 * child holds only fainter ones than its parent. The runtime can then load
 * "what could be seen from here" without ever touching distant faint data.
 *
 * "Brightest" is intrinsic luminosity for the deep galaxy and quasar surveys
 * (seen from anywhere in the universe) and apparent brightness from the Sun
 * (`orderKey`) for stars and for the bright / nearby galaxies: those are the
 * objects of our own sky, so ordering by it makes that sky complete to a
 * uniform magnitude at every level of detail — and puts every showpiece
 * (Andromeda, the Magellanic Clouds, the Messier galaxies) in the root tile.
 *
 * Pure (no file access), so the unit tests can build trees too.
 */
import type { DatasetKind } from '../../../src/data/format/schema';
import type { ColumnArray, ColumnSpec } from '../../../src/data/format/tileFormat';

export interface DatasetInput {
  id: string;
  kind: DatasetKind;
  title: string;
  /** Metres per position unit. */
  unit: number;
  rootHalf: number;
  /** Centre of the root cube relative to the Sun (see `DatasetManifest.center`); default the Sun. */
  center?: [number, number, number];
  capacity: number;
  count: number;
  /** Positions relative to the Sun, in units. */
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** Intrinsic (absolute) brightness, smaller = brighter. Also the insertion order unless `orderKey` is given. */
  lodMag: Float32Array;
  /** Insertion order key (smaller first), when it should differ from `lodMag` — e.g. apparent magnitude from the Sun. */
  orderKey?: Float32Array;
  /**
   * Position units per 10 parsecs. When given, each node also records the brightest apparent magnitude
   * of its objects as seen from the Sun and their median distance from it (see `NodeTable.app`).
   */
  tenPc?: number;
  /**
   * Fold sparse branches into their parent tile (which may then hold up to twice `capacity`):
   * a subtree with no more than `capacity` objects in all, and any leaf with less than an eighth
   * of it. Saves thousands of near-empty files, requests and draw calls in the deep surveys.
   */
  mergeSparse?: boolean;
  columns: ColumnSpec[];
  /** Quantised column values for all objects (global arrays indexed by object). */
  data: Record<string, ColumnArray>;
  /** Names-table id per object, or −1. */
  nameId: Int32Array;
  /** Optional 64-bit catalogue ids (written to `.id` sidecars). */
  ids?: BigUint64Array;
}

export interface TreeNode {
  rows: number[];
  /** Brightest absolute magnitude and brightest apparent magnitude from the Sun. */
  brightest: number;
  app: number;
}

const MAX_DEPTH = 24;

export function buildOctree(input: DatasetInput): Map<string, TreeNode> {
  const { count, x, y, z, lodMag, rootHalf, capacity } = input;
  const key = input.orderKey ?? lodMag;
  const tenPc = input.tenPc ?? 0;
  const c0 = input.center ?? [0, 0, 0];
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  // Brightest first; ties broken by index so the build is fully deterministic.
  order.sort((a, b) => key[a]! - key[b]! || a - b);

  const nodes = new Map<string, TreeNode>();
  let outside = 0;
  for (let k = 0; k < count; k++) {
    const i = order[k]!;
    const px = x[i]!;
    const py = y[i]!;
    const pz = z[i]!;
    if (Math.abs(px - c0[0]) > rootHalf || Math.abs(py - c0[1]) > rootHalf || Math.abs(pz - c0[2]) > rootHalf || !Number.isFinite(px + py + pz)) {
      outside++;
      continue;
    }
    let path = '';
    let cx = c0[0];
    let cy = c0[1];
    let cz = c0[2];
    let half = rootHalf;
    for (let depth = 0; ; depth++) {
      let node = nodes.get(path);
      if (!node) {
        node = { rows: [], brightest: Infinity, app: Infinity };
        nodes.set(path, node);
      }
      if (node.rows.length < capacity || depth >= MAX_DEPTH) {
        node.rows.push(i);
        node.brightest = Math.min(node.brightest, lodMag[i]!);
        if (tenPc > 0) {
          const d = Math.max(Math.sqrt(px * px + py * py + pz * pz), 1e-9);
          node.app = Math.min(node.app, lodMag[i]! + 5 * Math.log10(d / tenPc));
        }
        break;
      }
      half /= 2;
      let oct = 0;
      if (px >= cx) {
        oct |= 1;
        cx += half;
      } else cx -= half;
      if (py >= cy) {
        oct |= 2;
        cy += half;
      } else cy -= half;
      if (pz >= cz) {
        oct |= 4;
        cz += half;
      } else cz -= half;
      path += oct;
    }
  }
  if (outside > 0) console.warn(`  ! ${input.id}: ${outside} objects fell outside the root cube and were dropped`);
  if (input.mergeSparse) mergeSparse(nodes, capacity);
  return nodes;
}

/**
 * Fold sparse branches into their parents (see `DatasetInput.mergeSparse`). A parent only ever
 * receives objects fainter than its own, so "children are fainter than their parent" still holds,
 * and no tile grows beyond twice the capacity.
 */
function mergeSparse(nodes: Map<string, TreeNode>, capacity: number): void {
  const fold = (path: string): void => {
    const node = nodes.get(path)!;
    const parent = nodes.get(path.slice(0, -1))!;
    for (const r of node.rows) parent.rows.push(r);
    parent.brightest = Math.min(parent.brightest, node.brightest);
    parent.app = Math.min(parent.app, node.app);
    nodes.delete(path);
  };
  const deepestFirst = (): string[] => [...nodes.keys()].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));

  // 1. Whole subtrees: everything below a node, if that is at most one tile's worth.
  const below = new Map<string, number>();
  for (const path of deepestFirst()) {
    if (path.length === 0) continue;
    const parent = path.slice(0, -1);
    below.set(parent, (below.get(parent) ?? 0) + nodes.get(path)!.rows.length + (below.get(path) ?? 0));
  }
  // (Deepest first: by the time a node is folded, its own descendants have been folded into it.)
  for (const path of deepestFirst()) if (path.length > 0 && below.get(path.slice(0, -1))! <= capacity) fold(path);

  // 2. Leftover crumbs: tiny leaves next to well-filled siblings.
  const hasChildren = new Set<string>();
  for (const path of nodes.keys()) if (path.length > 0) hasChildren.add(path.slice(0, -1));
  for (const path of deepestFirst()) {
    if (path.length === 0 || hasChildren.has(path)) continue;
    const node = nodes.get(path)!;
    if (node.rows.length < capacity / 8 && nodes.get(path.slice(0, -1))!.rows.length + node.rows.length <= 2 * capacity) fold(path);
  }
}
