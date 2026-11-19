/**
 * Brightness-ordered LOD octree builder + tile writer.
 *
 * Objects are inserted from brightest to faintest. Each node keeps the first
 * `capacity` objects that reach it and passes the rest down to its children,
 * so the root holds the brightest objects of the whole catalogue and every
 * child holds only fainter ones than its parent. The runtime can then load
 * "what could be seen from here" without ever touching distant faint data.
 *
 * "Brightest" is intrinsic luminosity for galaxies and quasars (seen from
 * anywhere in the universe) and apparent brightness from the Sun for stars
 * (`orderKey`): star data only reaches a few kiloparsecs, so the Sun's sky is
 * the view that matters, and ordering by it makes that sky complete to a
 * uniform magnitude at every level of detail.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatasetKind, DatasetManifest } from '../../../src/data/format/schema';
import { idPath, tilePath } from '../../../src/data/format/schema';
import { type ColumnArray, type ColumnSpec, encodeIds, encodeTile } from '../../../src/data/format/tileFormat';
import { OUT_DIR } from './http';

export interface DatasetInput {
  id: string;
  kind: DatasetKind;
  title: string;
  /** Metres per position unit. */
  unit: number;
  rootHalf: number;
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
  columns: ColumnSpec[];
  /** Quantised column values for all objects (global arrays indexed by object). */
  data: Record<string, ColumnArray>;
  /** Names-table id per object, or −1. */
  nameId: Int32Array;
  /** Optional 64-bit catalogue ids (written to `.id` sidecars). */
  ids?: BigUint64Array;
}

interface Node {
  rows: number[];
  /** Brightest absolute magnitude and brightest apparent magnitude from the Sun. */
  brightest: number;
  app: number;
}

const MAX_DEPTH = 24;

export function buildOctree(input: DatasetInput): Map<string, Node> {
  const { count, x, y, z, lodMag, rootHalf, capacity } = input;
  const key = input.orderKey ?? lodMag;
  const tenPc = input.tenPc ?? 0;
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  // Brightest first; ties broken by index so the build is fully deterministic.
  order.sort((a, b) => key[a]! - key[b]! || a - b);

  const nodes = new Map<string, Node>();
  let outside = 0;
  for (let k = 0; k < count; k++) {
    const i = order[k]!;
    const px = x[i]!;
    const py = y[i]!;
    const pz = z[i]!;
    if (Math.abs(px) > rootHalf || Math.abs(py) > rootHalf || Math.abs(pz) > rootHalf || !Number.isFinite(px + py + pz)) {
      outside++;
      continue;
    }
    let path = '';
    let cx = 0;
    let cy = 0;
    let cz = 0;
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
  return nodes;
}

/** Build the octree, write every tile (and id sidecar) and return the dataset's manifest entry. */
export function writeDataset(input: DatasetInput): DatasetManifest {
  const nodes = buildOctree(input);
  const sortCol = input.columns.find((c) => c.delta);
  const sortData = sortCol ? input.data[sortCol.name]! : null;
  const paths = [...nodes.keys()].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  const table: DatasetManifest['nodes'] = { path: [], count: [], mag: [], bytes: [] };
  if (input.tenPc) {
    table.app = [];
    table.med = [];
  }
  let total = 0;
  let totalBytes = 0;
  let idBytes = 0;

  for (const path of paths) {
    const node = nodes.get(path)!;
    const rows = node.rows;
    // Row order inside a tile: ascending by the delta-coded column (RA), which is what makes it compress.
    if (sortData) rows.sort((a, b) => sortData[a]! - sortData[b]! || a - b);
    const n = rows.length;
    const cols: Record<string, ColumnArray> = {};
    for (const spec of input.columns) {
      const src = input.data[spec.name]!;
      const dst: ColumnArray = spec.type === 'u8' ? new Uint8Array(n) : spec.type === 'u16' ? new Uint16Array(n) : new Uint32Array(n);
      for (let r = 0; r < n; r++) dst[r] = src[rows[r]!]!;
      cols[spec.name] = dst;
    }
    const refRows: number[] = [];
    const refIds: number[] = [];
    for (let r = 0; r < n; r++) {
      const id = input.nameId[rows[r]!]!;
      if (id >= 0) {
        refRows.push(r);
        refIds.push(id);
      }
    }
    const bytes = encodeTile(input.columns, { count: n, columns: cols, refRows: Uint32Array.from(refRows), refIds: Uint32Array.from(refIds) });
    const file = join(OUT_DIR, tilePath(input.id, path));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    if (input.ids) {
      const ids = new BigUint64Array(n);
      for (let r = 0; r < n; r++) ids[r] = input.ids[rows[r]!]!;
      const enc = encodeIds(ids);
      writeFileSync(join(OUT_DIR, idPath(input.id, path)), enc);
      idBytes += enc.byteLength;
    }
    table.path.push(path);
    table.count.push(n);
    table.mag.push(Math.round(node.brightest * 100) / 100);
    if (table.app && table.med) {
      // Rounded toward "brighter", so the runtime's bound stays a true bound.
      table.app.push(Math.floor(node.app * 100) / 100);
      const dist = rows.map((r) => Math.hypot(input.x[r]!, input.y[r]!, input.z[r]!)).sort((a, b) => a - b);
      table.med.push(Number(dist[dist.length >> 1]!.toPrecision(4)));
    }
    table.bytes.push(bytes.byteLength);
    total += n;
    totalBytes += bytes.byteLength;
  }
  console.info(
    `  ✓ ${input.id}: ${total.toLocaleString('en-US')} objects in ${paths.length} tiles, ${(totalBytes / 1e6).toFixed(2)} MB` +
      (input.ids ? ` (+ ${(idBytes / 1e6).toFixed(2)} MB id sidecars)` : '') +
      `, ${(totalBytes / Math.max(1, total)).toFixed(2)} bytes/object`,
  );
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    unit: input.unit,
    rootHalf: input.rootHalf,
    capacity: input.capacity,
    count: total,
    hasIds: Boolean(input.ids),
    columns: input.columns,
    nodes: table,
  };
}
