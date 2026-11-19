/**
 * High-precision universe coordinates.
 *
 * A single 64-bit float cannot span the observable universe (~4.4e26 m) while
 * resolving millimetres on a planet surface (that would need ~100 bits).
 * A `UPos` therefore stores a position as
 *
 *     sector index (exact integers held in doubles)  +  local offset in metres
 *
 * with a sector edge of 2^40 m (≈ 7.35 AU). Sector indices reach ~4e14 for the
 * edge of the universe — far below 2^53, so they stay exact — and the local
 * offset keeps ~0.1 mm precision everywhere.
 *
 * The renderer never sends absolute coordinates to the GPU. It subtracts the
 * camera's UPos on the CPU (`uposSub`, exact to float64 *relative* precision)
 * and renders everything camera-relative ("floating origin"), which removes
 * jitter at every scale.
 *
 * Frame: origin at the Solar System barycentre, axes aligned with ICRS
 * (x → RA 0h, z → north celestial pole), distances comoving.
 */
import type { V3 } from './math';

/** Sector edge length in metres (a power of two so scaling by it is exact). */
export const SECTOR = 2 ** 40;
const HALF = SECTOR / 2;

export interface UPos {
  /** Integer sector coordinates. */
  sx: number;
  sy: number;
  sz: number;
  /** Offset inside the sector, metres, kept within ±SECTOR/2. */
  x: number;
  y: number;
  z: number;
}

export const uposZero = (): UPos => ({ sx: 0, sy: 0, sz: 0, x: 0, y: 0, z: 0 });
export const uposClone = (p: UPos): UPos => ({ sx: p.sx, sy: p.sy, sz: p.sz, x: p.x, y: p.y, z: p.z });

export function uposCopy(out: UPos, p: UPos): UPos {
  out.sx = p.sx;
  out.sy = p.sy;
  out.sz = p.sz;
  out.x = p.x;
  out.y = p.y;
  out.z = p.z;
  return out;
}

/** Re-wrap local offsets into ±SECTOR/2, carrying whole sectors into the indices. */
export function uposNormalize(p: UPos): UPos {
  if (p.x >= HALF || p.x < -HALF) {
    const k = Math.round(p.x / SECTOR);
    p.sx += k;
    p.x -= k * SECTOR;
  }
  if (p.y >= HALF || p.y < -HALF) {
    const k = Math.round(p.y / SECTOR);
    p.sy += k;
    p.y -= k * SECTOR;
  }
  if (p.z >= HALF || p.z < -HALF) {
    const k = Math.round(p.z / SECTOR);
    p.sz += k;
    p.z -= k * SECTOR;
  }
  return p;
}

/** Build a UPos from metres relative to the origin (precision limited by the doubles passed in). */
export function uposFromMeters(x: number, y: number, z: number): UPos {
  return uposAddInPlace(uposZero(), x, y, z);
}

/**
 * p += (dx, dy, dz), in place. The delta is split into whole sectors plus a
 * remainder *before* touching the local offset, so adding a huge delta never
 * destroys the fine local precision. (The split is exact: SECTOR is a power of two.)
 */
export function uposAddInPlace(p: UPos, dx: number, dy: number, dz: number): UPos {
  const kx = Math.round(dx / SECTOR);
  const ky = Math.round(dy / SECTOR);
  const kz = Math.round(dz / SECTOR);
  p.sx += kx;
  p.sy += ky;
  p.sz += kz;
  p.x += dx - kx * SECTOR;
  p.y += dy - ky * SECTOR;
  p.z += dz - kz * SECTOR;
  return uposNormalize(p);
}

/** Returns p + d as a new UPos. */
export function uposAdd(p: UPos, d: V3): UPos {
  return uposAddInPlace(uposClone(p), d.x, d.y, d.z);
}

/** a − b as a plain metre vector. Exact to float64 relative precision of the result. */
export function uposSub(a: UPos, b: UPos, out?: V3): V3 {
  const o = out ?? { x: 0, y: 0, z: 0 };
  o.x = (a.sx - b.sx) * SECTOR + (a.x - b.x);
  o.y = (a.sy - b.sy) * SECTOR + (a.y - b.y);
  o.z = (a.sz - b.sz) * SECTOR + (a.z - b.z);
  return o;
}

export function uposDistance(a: UPos, b: UPos): number {
  const dx = (a.sx - b.sx) * SECTOR + (a.x - b.x);
  const dy = (a.sy - b.sy) * SECTOR + (a.y - b.y);
  const dz = (a.sz - b.sz) * SECTOR + (a.z - b.z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Lossy conversion to metres from the origin (fine for cell lookups, not for rendering). */
export function uposToMeters(p: UPos, out?: V3): V3 {
  const o = out ?? { x: 0, y: 0, z: 0 };
  o.x = p.sx * SECTOR + p.x;
  o.y = p.sy * SECTOR + p.y;
  o.z = p.sz * SECTOR + p.z;
  return o;
}

export function uposEquals(a: UPos, b: UPos): boolean {
  return a.sx === b.sx && a.sy === b.sy && a.sz === b.sz && a.x === b.x && a.y === b.y && a.z === b.z;
}

/**
 * Interpolate between two positions without losing precision at either end:
 * the first half of the journey is computed relative to the start, the second
 * half relative to the destination, so both departure and arrival are exact
 * even across billions of light-years.
 */
export function uposLerp(a: UPos, b: UPos, t: number): UPos {
  const d = uposSub(b, a);
  if (t < 0.5) return uposAddInPlace(uposClone(a), d.x * t, d.y * t, d.z * t);
  const u = t - 1;
  return uposAddInPlace(uposClone(b), d.x * u, d.y * u, d.z * u);
}

const b36 = (n: number): string => (n < 0 ? '-' : '') + Math.abs(n).toString(36);
const fromB36 = (s: string): number => {
  const neg = s.startsWith('-');
  const v = parseInt(neg ? s.slice(1) : s, 36);
  return neg ? -v : v;
};

/**
 * Compact, exact-to-the-millimetre text form used in share links and bookmarks:
 * six base-36 integers (3 sector indices, 3 local offsets in mm) joined by '.'.
 */
export function uposEncode(p: UPos): string {
  return [p.sx, p.sy, p.sz, Math.round(p.x * 1000), Math.round(p.y * 1000), Math.round(p.z * 1000)].map(b36).join('.');
}

export function uposDecode(s: string): UPos | null {
  const parts = s.split('.');
  if (parts.length !== 6) return null;
  const n = parts.map(fromB36);
  if (n.some((v) => !Number.isFinite(v))) return null;
  return uposNormalize({ sx: n[0]!, sy: n[1]!, sz: n[2]!, x: n[3]! / 1000, y: n[4]! / 1000, z: n[5]! / 1000 });
}
