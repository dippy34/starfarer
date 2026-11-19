/**
 * Planet terrain: a deterministic height + biome function on the sphere, and
 * the builder that turns one cube-sphere quadtree patch into mesh data
 * (run in the data worker).
 *
 * LOD continuity: a patch at quadtree level L includes one more noise octave
 * than its parent. Each vertex also carries the position it would have on the
 * parent's surface, so the vertex shader can morph between the two with
 * distance (CDLOD-style) — detail fades in instead of popping, and patch
 * borders at different levels line up.
 */
import type { RGB } from '../core/color';
import { hashCombine, hashInts, mix32 } from '../core/hash';
import { Noise3 } from '../core/noise';
import type { PlanetType, SurfaceProps } from './types';

/** Everything the terrain function needs to know about a body (plain data, sent to the worker). */
export interface TerrainParams {
  radius: number;
  type: PlanetType;
  surface: SurfaceProps;
  /** Mean surface temperature, K. */
  tSurface: number;
}

export interface TerrainPatchRequest {
  params: TerrainParams;
  /** Cube face 0…5 (+x, −x, +y, −y, +z, −z). */
  face: number;
  level: number;
  /** Patch coordinates within the face at this level (0 … 2^level − 1). */
  x: number;
  y: number;
  /** Vertices per edge (2^n + 1). */
  res: number;
}

export interface TerrainPatchData {
  /** Patch origin (planet-fixed frame, metres) that vertex positions are relative to. */
  origin: [number, number, number];
  /** Vertex positions relative to `origin` (grid res×res, then 4×res skirt vertices). */
  positions: Float32Array;
  /** Offset from each vertex to its position on the parent level's surface. */
  morph: Float32Array;
  /** Normals at this level and at the parent level (x, y, z, pad as signed bytes). */
  normals: Int8Array;
  normalsCoarse: Int8Array;
  /** r, g, b ground colour + water depth (0 = land, 1–255 = sea, deeper is larger). */
  colors: Uint8Array;
  /** Lowest / highest elevation in the patch (metres above the reference sphere). */
  minHeight: number;
  maxHeight: number;
  /** Radius of a sphere around `origin` containing the whole patch. */
  boundRadius: number;
}

// ----------------------------------------------------------------- cube sphere

const FACE_AXES: Array<[[number, number, number], [number, number, number], [number, number, number]]> = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, -1, 0], [0, 0, 1]],
  [[0, 1, 0], [-1, 0, 0], [0, 0, 1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
  [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];

/**
 * Unit direction for face coordinates (u, v) ∈ [−1, 1]². The tangent warp
 * keeps cells nearly equal-area across the face.
 */
export function cubeToSphere(face: number, u: number, v: number, out: [number, number, number]): [number, number, number] {
  const [n, a, b] = FACE_AXES[face]!;
  const tu = Math.tan(u * 0.7853981633974483);
  const tv = Math.tan(v * 0.7853981633974483);
  const x = n[0] + a[0] * tu + b[0] * tv;
  const y = n[1] + a[1] * tu + b[1] * tv;
  const z = n[2] + a[2] * tu + b[2] * tv;
  const l = Math.sqrt(x * x + y * y + z * z);
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
  return out;
}

// -------------------------------------------------------------- height function

/** Approximate inverse of the standard normal CDF (Acklam's rational approximation, central region is enough here). */
function invNorm(p: number): number {
  const q = Math.min(0.999, Math.max(0.001, p)) - 0.5;
  const r = q * q;
  return (q * (((((-39.69683028665376 * r + 220.9460984245205) * r - 275.9285104469687) * r + 138.357751867269) * r - 30.66479806614716) * r + 2.506628277459239)) /
    (((((-54.47609879822406 * r + 161.5858368580409) * r - 155.6989798598866) * r + 66.80131188771972) * r - 13.28068155288572) * r + 1);
}

export class TerrainFunction {
  private readonly n1: Noise3;
  private readonly n2: Noise3;
  private readonly n3: Noise3;
  private readonly seaThreshold: number;
  private readonly roughGain: number;
  private readonly ridge: number;
  private readonly craterSeed: number;
  readonly baseFreq: number;
  /** Half of the total relief: heights lie roughly in ±amp. */
  readonly amp: number;

  constructor(readonly p: TerrainParams) {
    const s = p.surface;
    this.n1 = new Noise3(s.seed);
    this.n2 = new Noise3(hashCombine(s.seed, 0x7e11));
    this.n3 = new Noise3(hashCombine(s.seed, 0x3c0f));
    this.craterSeed = hashCombine(s.seed, 0xc4a7e4);
    this.baseFreq = s.continentScale;
    this.amp = s.relief / 2;
    // The continent field is roughly normal with σ ≈ 0.27; pick the level that floods the requested fraction.
    this.seaThreshold = s.oceanLevel > 0 ? 0.27 * invNorm(s.oceanLevel) : -10;
    this.roughGain = p.type === 'ice' ? 0.42 : p.type === 'desert' ? 0.47 : 0.5;
    this.ridge = p.type === 'ice' ? 0.15 : p.type === 'rocky' ? 0.35 : p.type === 'lava' ? 0.7 : 0.6;
  }

  /** Highest useful octave for a given angular sample spacing (radians). */
  octavesFor(spacing: number): number {
    return Math.max(1, Math.min(20, Math.floor(Math.log2(Math.PI / (this.baseFreq * spacing)))));
  }

  /**
   * Elevation in metres at unit direction (x, y, z), summing `octaves` layers.
   * Returns [height with all octaves, height without the last octave] in `out`.
   */
  height(x: number, y: number, z: number, octaves: number, out: [number, number]): void {
    const f0 = this.baseFreq;
    // Continents: low-frequency fBm, shifted so the requested share is below sea level.
    let cont = 0;
    let amp = 1;
    let freq = f0;
    let norm = 0;
    const contOct = Math.min(octaves, 5);
    for (let i = 0; i < contOct; i++) {
      cont += amp * this.n1.noise(x * freq + i * 9.1, y * freq + i * 4.7, z * freq + i * 2.3);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    cont = cont / norm - this.seaThreshold;
    const land = cont > 0 ? 1 : 0;
    // Shelf profile: gentle coasts, flat abyssal plains.
    let h = cont > 0 ? Math.pow(cont, 0.85) * 0.55 : -Math.pow(-cont, 0.7) * 0.7;

    // Mountain belts: ridged noise, only where a slowly varying mask allows (and mostly on land).
    const mask = Math.max(0, this.n2.noise(x * f0 * 1.3 + 5.5, y * f0 * 1.3 + 1.5, z * f0 * 1.3 + 8.5) * 1.6 + 0.25);
    let detail = 0;
    let last = 0;
    amp = 0.5;
    freq = f0 * 4;
    let prev = 1;
    for (let i = 2; i < octaves; i++) {
      const n = this.n3.noise(x * freq + i * 3.3, y * freq + i * 7.7, z * freq + i * 5.1);
      // Blend between smooth fBm and sharp ridges; ridges inherit weight from the octave above ("multifractal").
      const r = 1 - Math.abs(n);
      const term = amp * ((1 - this.ridge) * n * 0.6 + this.ridge * mask * (r * r - 0.45) * prev);
      prev = Math.min(1, r * 1.3);
      last = term;
      detail += term;
      amp *= this.roughGain;
      freq *= 2;
    }
    const landWeight = land ? 0.35 + 0.65 * Math.min(1, cont * 5) : 0.25;
    const hi = h + detail * landWeight;
    const lo = h + (detail - last) * landWeight;
    h = hi;
    const crater = this.p.surface.craters > 0.02 ? this.craters(x, y, z, octaves) : 0;
    out[0] = (h + crater) * this.amp;
    out[1] = (lo + crater) * this.amp;
  }

  /** Impact craters: several size classes of bowl-with-rim profiles scattered on a jittered grid. */
  private craters(x: number, y: number, z: number, octaves: number): number {
    const density = this.p.surface.craters;
    let sum = 0;
    let freq = 3;
    let depth = 0.32;
    const classes = Math.min(6, Math.max(1, Math.floor(octaves / 2)));
    for (let c = 0; c < classes; c++) {
      const px = x * freq;
      const py = y * freq;
      const pz = z * freq;
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      const iz = Math.floor(pz);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const h = hashInts(this.craterSeed, c, ix + dx, iy + dy, iz + dz);
            if ((h & 0xff) / 255 > density * 0.85) continue;
            const cx = ix + dx + ((h >>> 8) & 0xff) / 255;
            const cy = iy + dy + ((h >>> 16) & 0xff) / 255;
            const cz = iz + dz + ((h >>> 24) & 0xff) / 255;
            const rad = 0.18 + 0.3 * ((mix32(h) & 0xff) / 255);
            const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2) / rad;
            if (d >= 1.6) continue;
            // Bowl inside, raised rim at d = 1, ejecta blanket fading to 1.6.
            sum += d < 1 ? depth * (d * d * 1.25 - 1) * rad : depth * 0.25 * rad * (1 - (d - 1) / 0.6) ** 2;
          }
        }
      }
      freq *= 2.3;
      depth *= 0.62;
    }
    return sum;
  }

  /** Ground colour + water depth byte for a point, from elevation, latitude and slope. */
  color(x: number, y: number, z: number, elev: number, slope: number, out: Uint8Array, at: number): void {
    const s = this.p.surface;
    const pal = s.palette;
    const type = this.p.type;
    // Normalised elevation 0…1 over the land range.
    const t = Math.max(0, Math.min(1, elev / (this.amp * 0.9)));
    const sinLat = Math.abs(z);
    const moisture = 0.5 + 0.5 * this.n2.noise(x * 3.1 + 40, y * 3.1 + 40, z * 3.1 + 40);
    let c: RGB;
    if (t < 0.25) c = mix(pal[0], pal[1], t / 0.25);
    else if (t < 0.6) c = mix(pal[1], pal[2], (t - 0.25) / 0.35);
    else c = mix(pal[2], pal[3], (t - 0.6) / 0.4);
    if (type === 'ocean') {
      // Dry interiors and hot low latitudes lose their vegetation tint; steep slopes show bare rock.
      const dry = Math.max(0, Math.min(1, (0.42 - moisture) * 3 + (0.35 - sinLat) * (1 - s.vegetation)));
      c = mix(c, [0.62, 0.52, 0.34], dry * 0.8 * (1 - t));
      c = mix(c, pal[2], Math.min(1, slope * 2.2));
    } else if (type !== 'gasgiant' && type !== 'icegiant') {
      c = mix(c, pal[0], Math.min(0.6, slope * 1.5));
      // Large-scale albedo patches (maria, dust regions).
      c = mix(c, pal[0], Math.max(0, moisture - 0.55) * 0.9);
    }
    // Ice: polar caps that creep further on high ground.
    if (s.iceCap > 0 && s.iceCap < 1) {
      const edge = 1 - s.iceCap + 0.06 * (moisture - 0.5) - t * 0.25;
      const ice = Math.max(0, Math.min(1, (sinLat - edge) / 0.04));
      c = mix(c, [0.93, 0.95, 0.98], ice);
    }
    const depth = elev < 0 && s.oceanLevel > 0 ? Math.max(1, Math.min(255, Math.round((-elev / (this.amp * 0.7)) * 254) + 1)) : 0;
    // Stored gamma-encoded (square root) so dark surfaces keep their precision in 8 bits.
    out[at] = Math.max(0, Math.min(255, Math.round(Math.sqrt(Math.max(0, c[0])) * 255)));
    out[at + 1] = Math.max(0, Math.min(255, Math.round(Math.sqrt(Math.max(0, c[1])) * 255)));
    out[at + 2] = Math.max(0, Math.min(255, Math.round(Math.sqrt(Math.max(0, c[2])) * 255)));
    out[at + 3] = depth;
  }
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const functionCache = new Map<number, TerrainFunction>();

/** Terrain function for a body (cached per surface seed). */
export function terrainFor(params: TerrainParams): TerrainFunction {
  let f = functionCache.get(params.surface.seed);
  if (!f || f.p.radius !== params.radius) {
    if (functionCache.size > 8) functionCache.clear();
    f = new TerrainFunction(params);
    functionCache.set(params.surface.seed, f);
  }
  return f;
}

/** Surface elevation (metres, sea clamped to 0) under a unit direction — used for altitude and collision. */
export function surfaceElevation(params: TerrainParams, x: number, y: number, z: number, octaves = 12): number {
  const out: [number, number] = [0, 0];
  terrainFor(params).height(x, y, z, octaves, out);
  return params.surface.oceanLevel > 0 ? Math.max(0, out[0]) : out[0];
}

// ----------------------------------------------------------------- patch builder

/** Build mesh data for one quadtree patch. */
export function buildTerrainPatch(req: TerrainPatchRequest): TerrainPatchData {
  const { params, face, level, res } = req;
  const fn = terrainFor(params);
  const R = params.radius;
  const hasSea = params.surface.oceanLevel > 0;
  const cells = res - 1;
  const size = 2 / 2 ** level; // patch extent in face coordinates
  const u0 = -1 + req.x * size;
  const v0 = -1 + req.y * size;
  const spacing = (Math.PI / 2 / 2 ** level) / cells;
  const octaves = fn.octavesFor(spacing);

  // Sample a grid with a one-cell border so normals are seamless across patches.
  const g = res + 2;
  const fine = new Float64Array(g * g);
  const coarse = new Float64Array(g * g);
  const dirs = new Float64Array(g * g * 3);
  const d: [number, number, number] = [0, 0, 0];
  const h: [number, number] = [0, 0];
  let minH = Infinity;
  let maxH = -Infinity;
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      cubeToSphere(face, u0 + ((i - 1) / cells) * size, v0 + ((j - 1) / cells) * size, d);
      fn.height(d[0], d[1], d[2], octaves, h);
      const k = j * g + i;
      const f = hasSea ? Math.max(0, h[0]) : h[0];
      fine[k] = f;
      coarse[k] = hasSea ? Math.max(0, h[1]) : h[1];
      dirs[k * 3] = d[0];
      dirs[k * 3 + 1] = d[1];
      dirs[k * 3 + 2] = d[2];
      if (i > 0 && j > 0 && i <= res && j <= res) {
        if (f < minH) minH = f;
        if (f > maxH) maxH = f;
      }
    }
  }

  cubeToSphere(face, u0 + size / 2, v0 + size / 2, d);
  const origin: [number, number, number] = [d[0] * R, d[1] * R, d[2] * R];
  const nVert = res * res + 4 * res;
  const positions = new Float32Array(nVert * 3);
  const morph = new Float32Array(nVert * 3);
  const normals = new Int8Array(nVert * 4);
  const normalsCoarse = new Int8Array(nVert * 4);
  const colors = new Uint8Array(nVert * 4);
  const raw = new Uint8Array(4);

  // World-space position of grid sample (i, j) (grid indices include the border) for a given height field.
  const px = new Float64Array(3);
  const pos = (field: Float64Array, i: number, j: number): void => {
    const k = j * g + i;
    const r = R + field[k]!;
    px[0] = dirs[k * 3]! * r;
    px[1] = dirs[k * 3 + 1]! * r;
    px[2] = dirs[k * 3 + 2]! * r;
  };
  const a = new Float64Array(3);
  const b = new Float64Array(3);
  const normalAt = (field: Float64Array, i: number, j: number, step: number, out: Int8Array, at: number): number => {
    // Central differences `step` samples apart (clamped to the bordered grid).
    pos(field, Math.min(g - 1, i + step), j);
    a.set(px);
    pos(field, Math.max(0, i - step), j);
    a[0]! -= px[0]!;
    a[1]! -= px[1]!;
    a[2]! -= px[2]!;
    pos(field, i, Math.min(g - 1, j + step));
    b.set(px);
    pos(field, i, Math.max(0, j - step));
    b[0]! -= px[0]!;
    b[1]! -= px[1]!;
    b[2]! -= px[2]!;
    let nx = a[1]! * b[2]! - a[2]! * b[1]!;
    let ny = a[2]! * b[0]! - a[0]! * b[2]!;
    let nz = a[0]! * b[1]! - a[1]! * b[0]!;
    const k = (j * g + i) * 3;
    // Keep the normal on the outward side whatever the face's handedness.
    if (nx * dirs[k]! + ny * dirs[k + 1]! + nz * dirs[k + 2]! < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    out[at] = Math.round((nx / l) * 127);
    out[at + 1] = Math.round((ny / l) * 127);
    out[at + 2] = Math.round((nz / l) * 127);
    // Slope = 1 − cos(angle to vertical).
    return 1 - (nx * dirs[k]! + ny * dirs[k + 1]! + nz * dirs[k + 2]!) / l;
  };

  let bound = 0;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const v = j * res + i;
      const gi = i + 1;
      const gj = j + 1;
      pos(fine, gi, gj);
      const x = px[0]! - origin[0];
      const y = px[1]! - origin[1];
      const z = px[2]! - origin[2];
      positions[v * 3] = x;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z;
      bound = Math.max(bound, Math.sqrt(x * x + y * y + z * z));

      // Parent-level position: even vertices exist on the parent grid; odd ones lie on its edges / cell centres.
      const oi = i & 1;
      const oj = j & 1;
      let mx = 0;
      let my = 0;
      let mz = 0;
      let count = 0;
      const acc = (di: number, dj: number): void => {
        pos(coarse, gi + di, gj + dj);
        mx += px[0]!;
        my += px[1]!;
        mz += px[2]!;
        count++;
      };
      if (!oi && !oj) acc(0, 0);
      else if (oi && !oj) {
        acc(-1, 0);
        acc(1, 0);
      } else if (!oi && oj) {
        acc(0, -1);
        acc(0, 1);
      } else {
        // Cell centre: on the parent's triangle diagonal (see terrainIndices), not the 4-corner average.
        acc(1, -1);
        acc(-1, 1);
      }
      morph[v * 3] = mx / count - origin[0] - x;
      morph[v * 3 + 1] = my / count - origin[1] - y;
      morph[v * 3 + 2] = mz / count - origin[2] - z;

      const slope = normalAt(fine, gi, gj, 1, normals, v * 4);
      // Parent normals: differences two samples apart on the coarse field, taken at the nearest even vertex.
      normalAt(coarse, gi - oi, gj - oj, 2, normalsCoarse, v * 4);
      const k = gj * g + gi;
      const h0: [number, number] = [0, 0];
      fn.height(dirs[k * 3]!, dirs[k * 3 + 1]!, dirs[k * 3 + 2]!, Math.min(octaves, 6), h0);
      // Water depth uses the smooth large-scale height so the sea floor shading is stable across LODs.
      fn.color(dirs[k * 3]!, dirs[k * 3 + 1]!, dirs[k * 3 + 2]!, hasSea && fine[k]! <= 0 ? Math.min(h0[0], -1) : fine[k]!, slope, raw, 0);
      colors.set(raw, v * 4);
    }
  }

  // Skirt: duplicate the border vertices, pushed toward the planet centre, to hide hairline gaps between LODs.
  const skirtDrop = Math.max((maxH - minH) * 0.1, R * size * 0.012);
  let s = res * res;
  const addSkirt = (i: number, j: number): void => {
    const v = j * res + i;
    const k = ((j + 1) * g + (i + 1)) * 3;
    for (let c = 0; c < 3; c++) {
      positions[s * 3 + c] = positions[v * 3 + c]! - dirs[k + c]! * skirtDrop;
      morph[s * 3 + c] = morph[v * 3 + c]!;
    }
    for (let c = 0; c < 4; c++) {
      normals[s * 4 + c] = normals[v * 4 + c]!;
      normalsCoarse[s * 4 + c] = normalsCoarse[v * 4 + c]!;
      colors[s * 4 + c] = colors[v * 4 + c]!;
    }
    s++;
  };
  for (let i = 0; i < res; i++) addSkirt(i, 0);
  for (let i = 0; i < res; i++) addSkirt(i, res - 1);
  for (let j = 0; j < res; j++) addSkirt(0, j);
  for (let j = 0; j < res; j++) addSkirt(res - 1, j);

  return { origin, positions, morph, normals, normalsCoarse, colors, minHeight: minH, maxHeight: maxH, boundRadius: bound + skirtDrop };
}

/** Triangle indices shared by every patch of a given resolution (grid + four skirt strips). */
export function terrainIndices(res: number): Uint16Array {
  const cells = res - 1;
  const idx: number[] = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * res + i;
      idx.push(a, a + 1, a + res, a + 1, a + res + 1, a + res);
    }
  }
  const base = res * res;
  // Each skirt strip joins an edge of the grid to its lowered copy; both windings are emitted so it is visible from either side.
  const strip = (edge: (k: number) => number, skirt: number): void => {
    for (let k = 0; k < cells; k++) {
      const a = edge(k);
      const b = edge(k + 1);
      const c = skirt + k;
      const d = skirt + k + 1;
      idx.push(a, b, c, b, d, c, a, c, b, b, c, d);
    }
  };
  strip((k) => k, base);
  strip((k) => (res - 1) * res + k, base + res);
  strip((k) => k * res, base + 2 * res);
  strip((k) => k * res + res - 1, base + 3 * res);
  return Uint16Array.from(idx);
}
