/// <reference lib="webworker" />
/**
 * Data worker: all heavy CPU work happens here, off the render thread —
 * tile decompression/decoding, procedural star & galaxy cell generation and
 * terrain patch meshing.
 */
import { unzlibSync } from 'fflate';
import { blackbodyLinear } from '../../core/color';
import { GAL_FLAG_QUASAR, GAL_FLAG_RED, type GalaxySuppression, LssData, WEB_LEVELS, generateGalaxyCell } from '../../universe/cosmicWeb';
import { STAR_LEVEL_TABLE, generateStarCell } from '../../universe/starfield';
import { buildTerrainPatch } from '../../universe/terrain';
import { type PointChunkData, STYLE_COMPACT, STYLE_GALAXY, STYLE_GIANT, STYLE_GLOW, STYLE_QUASAR, STYLE_STAR, decodeCatalogTile } from '../decode';
import { decodeIds } from '../format/tileFormat';
import type { JobMap, JobType, WorkerRequest, WorkerResponse } from './protocol';

let suppression: GalaxySuppression | null = null;
const toByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

/** Collect the transferable buffers of a result so large arrays move instead of being copied. */
function transferables(value: unknown, out: Transferable[] = [], depth = 0): Transferable[] {
  if (depth > 3 || value === null || typeof value !== 'object') return out;
  if (ArrayBuffer.isView(value)) {
    const buf = value.buffer;
    if (buf instanceof ArrayBuffer && !out.includes(buf)) out.push(buf);
    return out;
  }
  for (const v of Object.values(value as Record<string, unknown>)) transferables(v, out, depth + 1);
  return out;
}

/** Tight copy: typed arrays produced with subarray() share an oversized buffer; trim before transfer. */
function compact<T extends Float32Array | Uint8Array | Uint16Array | Uint32Array>(a: T): T {
  return (a.byteOffset === 0 && a.byteLength === a.buffer.byteLength ? a : a.slice()) as T;
}

const handlers: { [K in JobType]: (p: JobMap[K]['in']) => JobMap[K]['out'] } = {
  tile: (p) => decodeCatalogTile(p.kind, p.specs, p.bytes, p.cx, p.cy, p.cz, p.half),
  ids: (p) => decodeIds(p.bytes),
  json: (p) => JSON.parse(new TextDecoder().decode(unzlibSync(p.bytes))) as unknown,
  setLss: (p) => {
    suppression = { lss: new LssData(unzlibSync(p.bytes)), twoMrsLimit: p.twoMrsLimit, avoidanceDeg: p.avoidanceDeg, sdssLimit: p.sdssLimit };
    return true;
  },
  starCell: (p) => {
    const cell = generateStarCell(p.galaxy, p.level, p.ix, p.iy, p.iz, p.suppress);
    const n = cell.count;
    const colors = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const type = cell.type[i]!;
      // Compact objects get signature tints so explorers can spot them: pulsars electric blue, black holes ember orange.
      const [r, g, b] = type === 5 || type === 6 ? [0.55, 0.75, 1] : type === 7 ? [1, 0.55, 0.25] : blackbodyLinear(cell.teff[i]!);
      colors[i * 4] = toByte(r);
      colors[i * 4 + 1] = toByte(g);
      colors[i * 4 + 2] = toByte(b);
      colors[i * 4 + 3] = type === 2 || type === 3 ? STYLE_GIANT : type >= 4 && type <= 7 ? STYLE_COMPACT : STYLE_STAR;
    }
    const out = { ...cell, pos: compact(cell.pos), absMag: compact(cell.absMag), teff: compact(cell.teff), type: compact(cell.type), index: compact(cell.index), seed: compact(cell.seed) };
    const chunk: PointChunkData = { count: n, positions: out.pos, absMag: out.absMag, colors, radius: STAR_LEVEL_TABLE[p.level]!.cell * 0.8661 };
    return { cell: out, chunk };
  },
  galaxyCell: (p) => {
    const cell = generateGalaxyCell(p.level, p.ix, p.iy, p.iz, p.real ? suppression : null);
    const n = cell.count;
    const glow = WEB_LEVELS[p.level]!.glow;
    const colors = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const f = cell.flags[i]!;
      const h = cell.seed[i]!;
      // Glow particles: warm in dense knots, cool in the outskirts (seeded variation). Galaxies: red sequence vs blue cloud.
      const red = glow ? 0.25 + ((h >>> 8) & 255) / 500 : f & GAL_FLAG_RED ? 0.85 : 0.15;
      const quasar = (f & GAL_FLAG_QUASAR) !== 0;
      colors[i * 4] = quasar ? 166 : toByte(0.78 + 0.22 * red);
      colors[i * 4 + 1] = quasar ? 200 : toByte(0.82 - 0.12 * red);
      colors[i * 4 + 2] = quasar ? 255 : toByte(1.0 - 0.52 * red);
      colors[i * 4 + 3] = glow ? STYLE_GLOW : quasar ? STYLE_QUASAR : STYLE_GALAXY;
    }
    const chunk: PointChunkData = { count: n, positions: cell.pos, absMag: cell.absMag, colors, radius: WEB_LEVELS[p.level]!.cell * 0.8661 };
    return { cell, chunk };
  },
  terrain: (p) => buildTerrainPatch(p),
};

self.onmessage = (ev: MessageEvent<WorkerRequest>): void => {
  const { id, type, payload } = ev.data;
  let response: WorkerResponse;
  let transfer: Transferable[] = [];
  try {
    const result = (handlers[type] as (p: unknown) => unknown)(payload);
    transfer = type === 'json' ? [] : transferables(result);
    response = { id, ok: true, result };
  } catch (err) {
    response = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(response, transfer);
};
