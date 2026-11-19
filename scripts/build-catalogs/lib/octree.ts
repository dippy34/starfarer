/**
 * Tile writer for the brightness-ordered LOD octrees (see `tree.ts` for how objects are assigned to tiles).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatasetManifest } from '../../../src/data/format/schema';
import { idPath, tilePath } from '../../../src/data/format/schema';
import { type ColumnArray, encodeIds, encodeTile } from '../../../src/data/format/tileFormat';
import { OUT_DIR } from './http';
import { type DatasetInput, buildOctree } from './tree';

export type { DatasetInput } from './tree';

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
    ...(input.center ? { center: input.center } : {}),
    capacity: input.capacity,
    count: total,
    hasIds: Boolean(input.ids),
    columns: input.columns,
    nodes: table,
  };
}
