/**
 * Deterministic integer hashing.
 *
 * Everything procedural in Starfarer is derived from hashes of integer
 * coordinates and seeds — never from stored state — so the same place always
 * produces the same universe on every device, forever. These functions use
 * only 32-bit integer math (Math.imul, shifts, xors), which is specified
 * exactly by ECMAScript, so results are bit-identical across engines.
 */

/** The universe seed. Changing this constant would create a different universe. */
export const UNIVERSE_SEED = 0x5f3a_c0de;

/** MurmurHash3 finalizer: a fast, high-quality 32-bit bit mixer. */
export function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Combine a running hash with one more 32-bit value. */
export function hashCombine(h: number, v: number): number {
  // Murmur3-style block mix.
  let k = Math.imul(v | 0, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) >>> 0;
}

/** Hash any number of 32-bit integers into one 32-bit seed. */
export function hashInts(...values: number[]): number {
  let h = UNIVERSE_SEED;
  for (let i = 0; i < values.length; i++) h = hashCombine(h, values[i]!);
  return mix32(h ^ values.length);
}

/**
 * Hash of a (possibly huge) integer-valued double, e.g. a sector index up to
 * ±2^53. Splits the value into low and high 32-bit words first.
 */
export function hashBig(seed: number, value: number): number {
  const lo = value % 4294967296;
  const hi = Math.floor(value / 4294967296);
  return mix32(hashCombine(hashCombine(seed, lo | 0), hi | 0));
}

/** Hash for an octree cell (level + integer cell coordinates). */
export function hashCell(seed: number, level: number, x: number, y: number, z: number): number {
  return mix32(hashCombine(hashCombine(hashCombine(hashCombine(seed, level), x), y), z));
}

/** FNV-1a string hash → 32-bit unsigned. Used to seed generators from stable IDs. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}

/** Map a 32-bit hash to a float in [0, 1). */
export function hashToUnit(h: number): number {
  return (h >>> 0) / 4294967296;
}
