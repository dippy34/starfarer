/**
 * Seeded pseudo-random number generator (sfc32 — "Small Fast Counter").
 *
 * sfc32 passes PractRand/BigCrush, has a 2^128-ish period and uses only 32-bit
 * integer operations, so its output stream is bit-identical on every JS
 * engine. All procedural content draws from an Rng seeded by position hashes.
 */
import { dcos, dexp, dlog, dsin } from './dmath';
import { hashCombine, mix32 } from './hash';

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    // Expand the 32-bit seed into the 96-bit state with independent mixes.
    this.a = mix32(seed ^ 0x9e3779b9);
    this.b = mix32(hashCombine(seed, 0x243f6a88));
    this.c = mix32(hashCombine(seed, 0xb7e15162));
    this.d = 1;
    // Warm up so that similar seeds diverge immediately.
    for (let i = 0; i < 12; i++) this.u32();
  }

  /** Next raw 32-bit unsigned integer. */
  u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.u32() / 4294967296;
  }

  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Uniform integer in [lo, hi] (inclusive). */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal deviate (Box–Muller; uses two uniforms, no cached state). */
  gauss(): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return Math.sqrt(-2 * dlog(u)) * dcos(2 * Math.PI * v);
  }

  /** Normal deviate with given mean and standard deviation. */
  normal(mean: number, sd: number): number {
    return mean + sd * this.gauss();
  }

  /** Log-uniform float in [lo, hi). */
  logRange(lo: number, hi: number): number {
    return dexp(this.range(dlog(lo), dlog(hi)));
  }

  /** Poisson-distributed integer with mean `lambda`. */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 40) {
      // Normal approximation keeps this O(1) for large means.
      return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.gauss()));
    }
    const limit = dexp(-lambda);
    let k = 0;
    let p = this.next();
    while (p > limit) {
      k++;
      p *= this.next();
    }
    return k;
  }

  /** Pick one element uniformly. */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Pick an index according to (unnormalised) weights. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** Uniformly distributed unit vector. */
  unitVector(): [number, number, number] {
    const z = this.range(-1, 1);
    const phi = this.range(0, 2 * Math.PI);
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return [r * dcos(phi), r * dsin(phi), z];
  }

  /** Derive an independent child generator (e.g. one per planet of a system). */
  fork(salt: number): Rng {
    return new Rng(hashCombine(this.u32(), salt));
  }
}
