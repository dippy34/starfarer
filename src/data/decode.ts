/**
 * Tile decoding: compressed catalogue tile → render-ready point chunk.
 * Pure functions (run inside the data worker; also used directly by tests).
 */
import { DEG } from '../core/astro';
import { blackbodyLinear } from '../core/color';
import { comovingDistanceMpc, distanceModulus } from '../core/cosmology';
import { classifyByPhotometry, teffFromPhotometry } from '../universe/star';
import {
  GAL_BAND_MASK, GAL_FLAG_AGN, GAL_FLAG_STARBURST, GAL_MORPH_MASK, GAL_MORPH_SHIFT, Morph, STAR_FLAG_WD,
  dqGalColor, dqGalMag, dqNameDec, dqNameRa, dqQsoMag, dqRedshift, dqStarColor, dqStarDec, dqStarDist, dqStarMag, dqStarRa, galaxyLodMag,
  type DatasetKind,
} from './format/schema';
import { type ColumnSpec, type Columns, decodeTile } from './format/tileFormat';

/** Point styles understood by the point shader (stored in the 4th colour byte). */
export const STYLE_STAR = 0;
export const STYLE_GIANT = 1;
export const STYLE_COMPACT = 2;
export const STYLE_GALAXY = 3;
export const STYLE_QUASAR = 4;
export const STYLE_GLOW = 5;

/** A decoded chunk of points, ready for the GPU. All arrays are transferable. */
export interface PointChunkData {
  count: number;
  /** x, y, z offsets from the chunk anchor, in dataset units. */
  positions: Float32Array;
  /** Absolute magnitude per point (LOD magnitude for galaxies). */
  absMag: Float32Array;
  /** r, g, b (linear, 0–255) + style code. */
  colors: Uint8Array;
  /** Radius of the sphere around the anchor that contains every point. */
  radius: number;
}

/** A decoded catalogue tile: points plus the raw catalogue columns for detail lookups. */
export interface CatalogChunkData extends PointChunkData {
  columns: Columns;
  /** Rows that have names, and their names-table ids. */
  refRows: Uint32Array;
  refIds: Uint32Array;
}

const toByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

/** Sun-centred position (parsecs) of a star from its quantised codes — the canonical position of the object. */
export function starPosition(raCode: number, decCode: number, distCode: number): [number, number, number] {
  const d = dqStarDist(distCode);
  const ra = dqStarRa(raCode) * DEG;
  const dec = dqStarDec(decCode) * DEG;
  const c = Math.cos(dec);
  return [d * c * Math.cos(ra), d * c * Math.sin(ra), d * Math.sin(dec)];
}

/** Sun-centred comoving position (megaparsecs) of a galaxy / quasar from its quantised codes. */
export function galaxyPosition(raCode: number, decCode: number, zCode: number): [number, number, number] {
  const d = comovingDistanceMpc(dqRedshift(zCode));
  const ra = dqNameRa(raCode) * DEG;
  const dec = dqNameDec(decCode) * DEG;
  const c = Math.cos(dec);
  return [d * c * Math.cos(ra), d * c * Math.sin(ra), d * Math.sin(dec)];
}

/** Absolute G magnitude of a catalogue star from its codes. */
export function starAbsMag(magCode: number, distCode: number): number {
  return dqStarMag(magCode) - 5 * Math.log10(dqStarDist(distCode) / 10);
}

/** LOD (pseudo-r absolute) magnitude of a catalogue galaxy from its codes. */
export function galaxyAbsMag(magCode: number, flags: number, zCode: number): number {
  return galaxyLodMag(dqGalMag(magCode), flags & GAL_BAND_MASK, distanceModulus(dqRedshift(zCode)));
}

export function quasarAbsMag(magCode: number, zCode: number): number {
  return (dqQsoMag(magCode) ?? 20.5) - distanceModulus(dqRedshift(zCode));
}

/** Tint for a catalogue galaxy point from its colour index / morphology. */
export function galaxyTint(colorCode: number, flags: number): [number, number, number] {
  const color = dqGalColor(colorCode);
  const morph = (flags >> GAL_MORPH_SHIFT) & GAL_MORPH_MASK;
  const band = flags & GAL_BAND_MASK;
  let red = 0.5;
  if (morph === Morph.E || morph === Morph.S0 || morph === Morph.DwarfE) red = 0.9;
  else if (morph !== Morph.Unknown) red = 0.25;
  else if (color !== null) red = band === 0 ? Math.max(0, Math.min(1, (color - 0.35) / 0.55)) : Math.max(0, Math.min(1, (color - 0.85) / 0.35));
  if (flags & GAL_FLAG_STARBURST) red = Math.min(red, 0.15);
  // Red sequence = warm yellow-orange, blue cloud = pale blue-white.
  const r = 0.78 + 0.22 * red;
  const g = 0.82 - 0.12 * red;
  const b = 1.0 - 0.52 * red;
  return flags & GAL_FLAG_AGN ? [Math.min(1, r + 0.05), g, Math.min(1, b + 0.15)] : [r, g, b];
}

/** Decode one catalogue tile. `cx, cy, cz` is the node centre (dataset units, Sun-centred); `half` its half-size. */
export function decodeCatalogTile(kind: DatasetKind, specs: ColumnSpec[], compressed: Uint8Array, cx: number, cy: number, cz: number, half: number): CatalogChunkData {
  const raw = decodeTile(specs, compressed);
  const n = raw.count;
  const positions = new Float32Array(n * 3);
  const absMag = new Float32Array(n);
  const colors = new Uint8Array(n * 4);
  const col = raw.columns;
  const ra = col.ra!;
  const dec = col.dec!;

  if (kind === 'stars') {
    const dist = col.dist!;
    const mag = col.mag!;
    const colorCode = col.color!;
    const flags = col.flags!;
    for (let i = 0; i < n; i++) {
      const [x, y, z] = starPosition(ra[i]!, dec[i]!, dist[i]!);
      positions[i * 3] = x - cx;
      positions[i * 3 + 1] = y - cy;
      positions[i * 3 + 2] = z - cz;
      const m = starAbsMag(mag[i]!, dist[i]!);
      absMag[i] = m;
      const bpRp = dqStarColor(colorCode[i]!);
      const type = classifyByPhotometry(m, bpRp, (flags[i]! & STAR_FLAG_WD) !== 0);
      const [r, g, b] = blackbodyLinear(teffFromPhotometry(m, bpRp));
      colors[i * 4] = toByte(r);
      colors[i * 4 + 1] = toByte(g);
      colors[i * 4 + 2] = toByte(b);
      colors[i * 4 + 3] = type === 'giant' || type === 'supergiant' ? STYLE_GIANT : type === 'whitedwarf' ? STYLE_COMPACT : STYLE_STAR;
    }
  } else {
    const zc = col.z!;
    const mag = col.mag!;
    const quasar = kind === 'quasars';
    const colorCode = col.color;
    const flags = col.flags;
    for (let i = 0; i < n; i++) {
      const [x, y, z] = galaxyPosition(ra[i]!, dec[i]!, zc[i]!);
      positions[i * 3] = x - cx;
      positions[i * 3 + 1] = y - cy;
      positions[i * 3 + 2] = z - cz;
      if (quasar) {
        absMag[i] = quasarAbsMag(mag[i]!, zc[i]!);
        colors[i * 4] = 166;
        colors[i * 4 + 1] = 200;
        colors[i * 4 + 2] = 255;
        colors[i * 4 + 3] = STYLE_QUASAR;
      } else {
        const f = flags ? flags[i]! : 0;
        absMag[i] = galaxyAbsMag(mag[i]!, f, zc[i]!);
        const [r, g, b] = galaxyTint(colorCode ? colorCode[i]! : 255, f);
        colors[i * 4] = toByte(r);
        colors[i * 4 + 1] = toByte(g);
        colors[i * 4 + 2] = toByte(b);
        colors[i * 4 + 3] = STYLE_GALAXY;
      }
    }
  }
  // Points sit inside the node cube, so its half-diagonal bounds them.
  return { count: n, positions, absMag, colors, radius: half * Math.sqrt(3), columns: col, refRows: raw.refRows, refIds: raw.refIds };
}
