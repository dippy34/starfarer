/**
 * Deterministic 3D gradient ("improved Perlin") noise for CPU-side generators:
 * terrain heights, the cosmic-web density field, nebula placement.
 * Only + − × and table lookups are used, so results are identical everywhere.
 */
import { Rng } from './rng';

const GRAD = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 1, 1, 0, 0, -1, 1, -1, 1, 0, 0, -1, -1,
]);

export class Noise3 {
  private readonly perm = new Uint8Array(512);

  constructor(seed: number) {
    const rng = new Rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
  }

  /** Gradient noise in roughly [−1, 1]. */
  noise(x: number, y: number, z: number): number {
    const p = this.perm;
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const fz = Math.floor(z);
    const X = fx & 255;
    const Y = fy & 255;
    const Z = fz & 255;
    x -= fx;
    y -= fy;
    z -= fz;
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const w = z * z * z * (z * (z * 6 - 15) + 10);
    const A = p[X]! + Y;
    const AA = p[A]! + Z;
    const AB = p[A + 1]! + Z;
    const B = p[X + 1]! + Y;
    const BA = p[B]! + Z;
    const BB = p[B + 1]! + Z;
    const g = (h: number, dx: number, dy: number, dz: number): number => {
      const i = (h & 15) * 3;
      return GRAD[i]! * dx + GRAD[i + 1]! * dy + GRAD[i + 2]! * dz;
    };
    const x1 = x - 1;
    const y1 = y - 1;
    const z1 = z - 1;
    const n000 = g(p[AA]!, x, y, z);
    const n100 = g(p[BA]!, x1, y, z);
    const n010 = g(p[AB]!, x, y1, z);
    const n110 = g(p[BB]!, x1, y1, z);
    const n001 = g(p[AA + 1]!, x, y, z1);
    const n101 = g(p[BA + 1]!, x1, y, z1);
    const n011 = g(p[AB + 1]!, x, y1, z1);
    const n111 = g(p[BB + 1]!, x1, y1, z1);
    const nx00 = n000 + u * (n100 - n000);
    const nx10 = n010 + u * (n110 - n010);
    const nx01 = n001 + u * (n101 - n001);
    const nx11 = n011 + u * (n111 - n011);
    const nxy0 = nx00 + v * (nx10 - nx00);
    const nxy1 = nx01 + v * (nx11 - nx01);
    return nxy0 + w * (nxy1 - nxy0);
  }

  /**
   * Gradient noise that repeats exactly every `period` lattice cells on each
   * axis (period ≤ 256) — used to bake seamlessly tiling 3D noise textures.
   */
  noisePeriodic(x: number, y: number, z: number, period: number): number {
    const p = this.perm;
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const fz = Math.floor(z);
    const wrap = (v: number): number => ((v % period) + period) % period;
    const X0 = wrap(fx);
    const Y0 = wrap(fy);
    const Z0 = wrap(fz);
    const X1 = wrap(fx + 1);
    const Y1 = wrap(fy + 1);
    const Z1 = wrap(fz + 1);
    x -= fx;
    y -= fy;
    z -= fz;
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const w = z * z * z * (z * (z * 6 - 15) + 10);
    const h = (xi: number, yi: number, zi: number): number => p[p[p[xi]! + yi]! + zi]!;
    const g = (hash: number, dx: number, dy: number, dz: number): number => {
      const i = (hash & 15) * 3;
      return GRAD[i]! * dx + GRAD[i + 1]! * dy + GRAD[i + 2]! * dz;
    };
    const x1 = x - 1;
    const y1 = y - 1;
    const z1 = z - 1;
    const n000 = g(h(X0, Y0, Z0), x, y, z);
    const n100 = g(h(X1, Y0, Z0), x1, y, z);
    const n010 = g(h(X0, Y1, Z0), x, y1, z);
    const n110 = g(h(X1, Y1, Z0), x1, y1, z);
    const n001 = g(h(X0, Y0, Z1), x, y, z1);
    const n101 = g(h(X1, Y0, Z1), x1, y, z1);
    const n011 = g(h(X0, Y1, Z1), x, y1, z1);
    const n111 = g(h(X1, Y1, Z1), x1, y1, z1);
    const nx00 = n000 + u * (n100 - n000);
    const nx10 = n010 + u * (n110 - n010);
    const nx01 = n001 + u * (n101 - n001);
    const nx11 = n011 + u * (n111 - n011);
    return nx00 + v * (nx10 - nx00) + w * (nx01 + v * (nx11 - nx01) - (nx00 + v * (nx10 - nx00)));
  }

  /** Fractal Brownian motion: sum of `octaves` noise layers. Output roughly [−1, 1]. */
  fbm(x: number, y: number, z: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      // Offset each octave so lattice artefacts never line up.
      sum += amp * this.noise(x * freq + i * 17.13, y * freq + i * 31.71, z * freq + i * 7.37);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal: sharp crests (mountain ranges, filaments). Output [0, 1]. */
  ridged(x: number, y: number, z: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    let prev = 1;
    for (let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(this.noise(x * freq + i * 13.7, y * freq + i * 5.3, z * freq + i * 23.9));
      n *= n;
      sum += n * amp * prev;
      norm += amp;
      prev = n;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
