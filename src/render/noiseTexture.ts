/**
 * A seamlessly tiling 3D noise texture shared by every procedural shader
 * (galaxies, nebulae, star surfaces, gas giants, clouds, terrain detail).
 * One trilinear fetch replaces ~100 ALU instructions of analytic noise, which
 * is what makes fractal shaders affordable on phone GPUs.
 *
 * Channels (each tiles with period 1 in texture space):
 *   R  gradient noise, 8 cells across       (base for fBm: sample at rising frequencies)
 *   G  gradient noise, 16 cells, other seed (decorrelated second field: warps, masks)
 *   B  cellular (Worley F1) noise, 6 cells  (granulation, clumps, craters)
 *   A  3-octave fBm, 4 cells                (cheap billowy detail in a single fetch)
 */
import * as THREE from 'three';
import { Noise3 } from '../core/noise';
import { hashInts } from '../core/hash';

export const NOISE_SIZE = 64;

export function createNoiseTexture(): THREE.Data3DTexture {
  const N = NOISE_SIZE;
  const data = new Uint8Array(N * N * N * 4);
  const a = new Noise3(0x1001);
  const b = new Noise3(0x2002);
  const c = new Noise3(0x3003);
  const CELLS = 6;
  // Feature points for the cellular channel, one per cell, wrapped at the texture edge.
  const feature = (ix: number, iy: number, iz: number, axis: number): number => {
    const w = (v: number): number => ((v % CELLS) + CELLS) % CELLS;
    return (hashInts(0x77, w(ix), w(iy), w(iz), axis) & 0xffff) / 65536;
  };
  let o = 0;
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = x / N;
        const v = y / N;
        const w = z / N;
        const r = a.noisePeriodic(u * 8, v * 8, w * 8, 8);
        const g = b.noisePeriodic(u * 16, v * 16, w * 16, 16);
        const f = (c.noisePeriodic(u * 4, v * 4, w * 4, 4) + 0.5 * c.noisePeriodic(u * 8 + 3.7, v * 8 + 1.3, w * 8 + 5.1, 8) + 0.25 * c.noisePeriodic(u * 16 + 9.2, v * 16 + 4.4, w * 16 + 7.9, 16)) / 1.75;
        // Worley F1.
        const px = u * CELLS;
        const py = v * CELLS;
        const pz = w * CELLS;
        const ix = Math.floor(px);
        const iy = Math.floor(py);
        const iz = Math.floor(pz);
        let best = 9;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const fx = ix + dx + feature(ix + dx, iy + dy, iz + dz, 0) - px;
              const fy = iy + dy + feature(ix + dx, iy + dy, iz + dz, 1) - py;
              const fz = iz + dz + feature(ix + dx, iy + dy, iz + dz, 2) - pz;
              const d = fx * fx + fy * fy + fz * fz;
              if (d < best) best = d;
            }
          }
        }
        // Gradient noise spans roughly ±0.7; remap to 0…1 with a little headroom.
        data[o++] = Math.max(0, Math.min(255, Math.round((r * 0.7 + 0.5) * 255)));
        data[o++] = Math.max(0, Math.min(255, Math.round((g * 0.7 + 0.5) * 255)));
        data[o++] = Math.max(0, Math.min(255, Math.round(Math.min(1, Math.sqrt(best)) * 255)));
        data[o++] = Math.max(0, Math.min(255, Math.round((f * 0.75 + 0.5) * 255)));
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  // No mipmaps: shaders choose their octaves from the pixel footprint themselves, and implicit LOD
  // selection for 3D textures inside loops/branches is unreliable across mobile drivers.
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** GLSL helpers for sampling the shared noise texture. Include after declaring nothing else — it declares the sampler. */
export const NOISE_GLSL = /* glsl */ `
uniform highp sampler3D uNoise;
// Smooth noise, 0..1. One unit of p = 8 noise cells.
float n3(vec3 p) { return texture(uNoise, p).r; }
float n3b(vec3 p) { return texture(uNoise, p).g; }
// Cellular (Worley F1) distance, 0 at feature points.
float cell3(vec3 p) { return texture(uNoise, p).b; }
// 3-octave billow in one fetch, 0..1.
float billow3(vec3 p) { return texture(uNoise, p).a; }
// Fractal sum of 'oct' fetches, roughly -1..1.
float fbm3(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * (texture(uNoise, p).r * 2.0 - 1.0);
    n += a;
    p = p * 2.03 + vec3(0.131, 0.417, 0.273);
    a *= 0.5;
  }
  return s / n;
}
// Ridged fractal, 0..1 (filaments, cracks).
float ridge3(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    float v = 1.0 - abs(texture(uNoise, p).r * 2.0 - 1.0) * 1.6;
    s += a * v * v;
    n += a;
    p = p * 2.07 + vec3(0.211, 0.097, 0.353);
    a *= 0.5;
  }
  return s / n;
}
`;
