/**
 * Binary tile container shared by the catalog build pipeline (encoder) and the
 * runtime tile worker (decoder).
 *
 * A tile is a small column store:
 *
 *   magic 'SFT1' | u32 rowCount | u32 refCount | columns… | name-ref columns…
 *
 * Each column is written as separate little-endian *byte planes* (all low
 * bytes, then all second bytes, …). Slowly-varying high bytes then form long
 * runs that DEFLATE squeezes to almost nothing. Columns flagged `delta` must
 * be sorted ascending and are stored as differences, which shrinks the
 * right-ascension column to ~1.5 bytes per object.
 *
 * The whole payload is DEFLATE-compressed (fflate) and decompressed in a Web
 * Worker, so tiles are plain static files that need no server configuration.
 */
import { unzlibSync, zlibSync } from 'fflate';

export type ColumnType = 'u8' | 'u16' | 'u24' | 'u32';

export interface ColumnSpec {
  name: string;
  type: ColumnType;
  /** Store as differences from the previous row (rows must be sorted ascending by this column). */
  delta?: boolean;
}

export type ColumnArray = Uint8Array | Uint16Array | Uint32Array;
export type Columns = Record<string, ColumnArray>;

/** A decoded tile: `rows` of catalogue columns plus sparse links into the names table. */
export interface RawTile {
  count: number;
  columns: Columns;
  /** Row indices that have an entry in the global names table… */
  refRows: Uint32Array;
  /** …and the matching names-table ids. */
  refIds: Uint32Array;
}

const MAGIC = 0x31544653; // 'SFT1' little-endian
const BYTES: Record<ColumnType, number> = { u8: 1, u16: 2, u24: 3, u32: 4 };
const REF_SPECS: ColumnSpec[] = [
  { name: 'row', type: 'u32', delta: true },
  { name: 'id', type: 'u32' },
];

function columnBytes(specs: ColumnSpec[], count: number): number {
  let n = 0;
  for (const s of specs) n += BYTES[s.type] * count;
  return n;
}

function writeColumns(out: Uint8Array, offset: number, specs: ColumnSpec[], cols: Columns, count: number): number {
  for (const spec of specs) {
    const src = cols[spec.name];
    if (!src || src.length < count) throw new Error(`tile column "${spec.name}" is missing or too short`);
    const nb = BYTES[spec.type];
    const mask = nb === 4 ? 0xffffffff : (1 << (nb * 8)) - 1;
    let prev = 0;
    for (let i = 0; i < count; i++) {
      const raw = src[i]!;
      if (raw > mask) throw new Error(`value ${raw} overflows ${spec.type} column "${spec.name}"`);
      let v = raw;
      if (spec.delta) {
        if (raw < prev) throw new Error(`delta column "${spec.name}" is not sorted at row ${i}`);
        v = raw - prev;
        prev = raw;
      }
      for (let b = 0; b < nb; b++) out[offset + b * count + i] = (v >>> (b * 8)) & 0xff;
    }
    offset += nb * count;
  }
  return offset;
}

function readColumns(src: Uint8Array, offset: number, specs: ColumnSpec[], count: number): { cols: Columns; offset: number } {
  const cols: Columns = {};
  for (const spec of specs) {
    const nb = BYTES[spec.type];
    const dst: ColumnArray = nb === 1 ? new Uint8Array(count) : nb === 2 ? new Uint16Array(count) : new Uint32Array(count);
    let prev = 0;
    for (let i = 0; i < count; i++) {
      let v = 0;
      for (let b = 0; b < nb; b++) v |= src[offset + b * count + i]! << (b * 8);
      v >>>= 0;
      if (spec.delta) {
        v = (v + prev) >>> 0;
        prev = v;
      }
      dst[i] = v;
    }
    cols[spec.name] = dst;
    offset += nb * count;
  }
  return { cols, offset };
}

/** Serialise a tile to its uncompressed byte layout. */
export function packTile(specs: ColumnSpec[], tile: RawTile): Uint8Array {
  const refCount = tile.refRows.length;
  const out = new Uint8Array(12 + columnBytes(specs, tile.count) + columnBytes(REF_SPECS, refCount));
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, tile.count, true);
  view.setUint32(8, refCount, true);
  const off = writeColumns(out, 12, specs, tile.columns, tile.count);
  writeColumns(out, off, REF_SPECS, { row: tile.refRows, id: tile.refIds }, refCount);
  return out;
}

/** Parse the uncompressed byte layout back into columns. */
export function unpackTile(specs: ColumnSpec[], bytes: Uint8Array): RawTile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || view.getUint32(0, true) !== MAGIC) throw new Error('not a Starfarer tile (bad magic)');
  const count = view.getUint32(4, true);
  const refCount = view.getUint32(8, true);
  const expected = 12 + columnBytes(specs, count) + columnBytes(REF_SPECS, refCount);
  if (bytes.byteLength !== expected) throw new Error(`tile size mismatch: got ${bytes.byteLength} bytes, expected ${expected}`);
  const main = readColumns(bytes, 12, specs, count);
  const refs = readColumns(bytes, main.offset, REF_SPECS, refCount);
  return { count, columns: main.cols, refRows: refs.cols.row as Uint32Array, refIds: refs.cols.id as Uint32Array };
}

/** Encode + compress a tile (build pipeline). */
export function encodeTile(specs: ColumnSpec[], tile: RawTile): Uint8Array {
  return zlibSync(packTile(specs, tile), { level: 9, mem: 12 });
}

/** Decompress + decode a tile (runtime worker). */
export function decodeTile(specs: ColumnSpec[], compressed: Uint8Array): RawTile {
  return unpackTile(specs, unzlibSync(compressed));
}

/**
 * ID sidecar: one unsigned 64-bit catalogue id per row (e.g. Gaia DR3
 * source_id), stored as eight byte planes and compressed. Fetched lazily, only
 * when an object from the tile is actually selected.
 */
export function encodeIds(ids: BigUint64Array): Uint8Array {
  const n = ids.length;
  const out = new Uint8Array(4 + n * 8);
  new DataView(out.buffer).setUint32(0, n, true);
  for (let i = 0; i < n; i++) {
    let v = ids[i]!;
    for (let b = 0; b < 8; b++) {
      out[4 + b * n + i] = Number(v & 0xffn);
      v >>= 8n;
    }
  }
  return zlibSync(out, { level: 9, mem: 12 });
}

export function decodeIds(compressed: Uint8Array): BigUint64Array {
  const bytes = unzlibSync(compressed);
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (bytes.byteLength !== 4 + n * 8) throw new Error('id sidecar size mismatch');
  const ids = new BigUint64Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0n;
    for (let b = 7; b >= 0; b--) v = (v << 8n) | BigInt(bytes[4 + b * n + i]!);
    ids[i] = v;
  }
  return ids;
}
