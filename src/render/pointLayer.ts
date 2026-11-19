/**
 * GPU point-sprite layer for stars and galaxies (real catalogue tiles and
 * procedural cells alike).
 *
 * Precision: each chunk stores float32 offsets from its own anchor. The
 * camera's position relative to that anchor is computed in float64 on the CPU
 * and passed as a high + low float pair; the vertex shader evaluates
 * (position − camHigh) − camLow, which stays exact even when the camera is a
 * few metres from a star inside a tile that spans a hundred kiloparsecs.
 *
 * Brightness: apparent magnitude is computed per vertex from absolute
 * magnitude and distance, so points brighten as you approach and fade out
 * smoothly at the level-of-detail limit (no popping when chunks come and go).
 *
 * Draw calls: catalogue tiles are drawn one call per tile (frustum-culled).
 * Procedural cells are far more numerous, so cells of the same level are
 * packed into one *batch* — a single buffer rebuilt around the camera every
 * time it has drifted a fraction of the level's visibility radius. A batch
 * holds only the points that can currently be seen (cells are generated in
 * whole blocks, most of which lies beyond that radius), which keeps both the
 * draw-call count and the number of points sent to the GPU within budget.
 */
import * as THREE from 'three';
import { type UPos, uposSub } from '../core/hp';
import type { PointChunkData } from '../data/decode';

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aMag;
uniform vec3 uCamHi;
uniform vec3 uCamLo;
uniform float uUnit;        // metres per position unit
uniform float uTenPc;       // position units per 10 parsecs
uniform float uMagLimit;    // faintest visible apparent magnitude
uniform float uMagRef;      // apparent magnitude drawn at unit brightness
uniform float uFloor;       // minimum visibility for objects beyond the limit ("survey dots")
uniform float uMaxDist;     // distance (units) at which this chunk's points have fully faded (0 = no limit)
uniform float uPx;          // base sprite size in pixels
uniform float uFade;        // chunk fade-in/out
uniform float uHide;        // index of a point replaced by a full model (or -1)
uniform float uGlowSize;    // world radius (units) of glow particles
uniform float uFocal;       // pixels per radian
uniform float uGain;
uniform float uResolve;     // pixel size at which galaxies hand over to impostor sprites
#ifdef BATCHED
attribute float aBirth;     // layer time at which the point's cell arrived
uniform float uTime;
#endif
varying vec3 vColor;
varying float vStyle;
varying float vSpike;
void main() {
  float fadeIn = uFade;
#ifdef BATCHED
  float born = clamp((uTime - aBirth) * 2.2, 0.0, 1.0);
  fadeIn *= born * born * (3.0 - 2.0 * born);
#endif
  vec3 rel = (position - uCamHi) - uCamLo;
  float d = max(length(rel), 1e-12);
  // Only the direction matters for projection (this layer is not depth-tested), so project the point
  // at a fixed, comfortable distance: clip coordinates stay small however far the object is, which
  // keeps rasterisers (and their guard bands) well-behaved at 10^26 m.
  vec4 mv = viewMatrix * vec4(rel / d * 1000.0, 1.0);
  gl_Position = projectionMatrix * mv;
  float style = floor(aColor.a * 255.0 + 0.5);
  vStyle = style;
  float range = uMaxDist > 0.0 ? 1.0 - smoothstep(uMaxDist * 0.72, uMaxDist, d) : 1.0;
  float size;
  float inten;
  if (style > 4.5) {
    // Glow particle: a soft blob of fixed world size carrying the unresolved light of the cosmic web.
    // Each glow level is drawn only in the shell [½, 1] × uMaxDist; the next level (twice as coarse)
    // takes over beyond it. Brightness per pixel falls as the blob grows (constant flux), and is
    // defined by angle rather than pixels, so the web looks the same at every resolution.
    size = clamp(uGlowSize / d * uFocal, 1.0, 96.0);
    float t = d / uMaxDist;
    float shell = smoothstep(0.375, 0.5, t) * (1.0 - smoothstep(0.75, 1.0, t));
    inten = 0.2 * shell * t * t * uFloor;   // for the glow group, uFloor carries the web's overall visibility
  } else {
    // Apparent magnitude m = M + 5 log10(d / 10 pc).
    float m = aMag + 2.17147241 * log(d / uTenPc);
    // Brightness is anchored to a fixed reference magnitude, not to the LOD limit: a deeper limit
    // (higher quality tier) adds fainter specks instead of making every star brighter.
    float fade = clamp((uMagLimit - m) / 0.8, 0.0, 1.0);
    float e = pow(10.0, 0.4 * clamp(uMagRef - m, -8.0, 30.0)) * fade;
    e = max(e, uFloor) * range;
    float soft = style > 2.5 && style < 3.5 ? 1.25 : 1.0;   // galaxies are slightly fuzzy
    // Flux is compressed for display: bright objects get both brighter and (a little) larger.
    size = uPx * soft * min(0.72 + 0.5 * pow(e, 0.3), 30.0);
    // (Below the reference magnitude the fall-off is steeper: the faintest stars are a fine dust, not a snowstorm.)
    inten = min(0.5 * pow(e, e < 1.0 ? 0.9 : 0.62), 14.0) / soft;
    if (style > 3.5) inten *= 1.6;                           // quasars: piercing points
    if (style > 2.5 && uResolve > 0.0) {
      // A galaxy big enough to be drawn as a resolved sprite fades out of the point cloud.
      float kpc = 14.0 * pow(10.0, -0.133 * (aMag + 21.0));
      float px = kpc * 1e-3 / d * uFocal;
      inten *= 1.0 - smoothstep(uResolve * 0.6, uResolve * 1.6, px);
    }
  }
  vSpike = smoothstep(3.2, 6.5, size / uPx);
  vColor = aColor.rgb * inten * fadeIn * uGain;
  if (float(gl_VertexID) == uHide || inten * fadeIn <= 0.0005) {
    // Cull invisible points without paying for their fragments.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    size = 0.0;
  }
  gl_PointSize = size * 2.0;
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vStyle;
varying float vSpike;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float a;
  if (vStyle > 4.5) {
    // Soft, peaked falloff: overlapping dots melt into a continuous glow instead of reading as discs.
    a = exp(-r2 * 4.0) * (1.0 - r2);
  } else {
    // Tight core + faint halo; bright stars grow four diffraction spikes.
    a = exp(-r2 * 7.0) + 0.12 * exp(-r2 * 2.2) * (1.0 - r2);
    if (vSpike > 0.0) {
      vec2 q = abs(p);
      float spike = exp(-q.y * 46.0) * exp(-q.x * 3.2) + exp(-q.x * 46.0) * exp(-q.y * 3.2);
      a += spike * 0.5 * vSpike * (1.0 - r2);
    }
  }
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

interface Batch {
  id: string;
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  members: Set<Chunk>;
  /** Universe position the packed coordinates are relative to (the camera position at the last rebuild). */
  anchor: UPos;
  group: number;
  maxDist: number;
  builtMaxDist: number;
  /** Points are kept out to `trim` × maxDist; the batch is rebuilt after the camera drifts (trim − 1) × 0.8 × maxDist. */
  trim: number;
  dirty: boolean;
  /** Points currently in the GPU buffer. */
  count: number;
  capacity: number;
  position: Float32Array;
  color: Uint8Array;
  mag: Float32Array;
  birth: Float32Array;
}

interface Chunk {
  key: string;
  anchor: UPos;
  data: PointChunkData;
  /** Own draw call (catalogue tiles) — null for chunks that live in a batch. */
  points: THREE.Points | null;
  material: THREE.ShaderMaterial | null;
  batch: Batch | null;
  /** Layer time when the chunk arrived (drives the fade-in of batched points). */
  birth: number;
  fade: number;
  removing: boolean;
  hidden: number;
  group: number;
  maxDist: number;
  /** Camera position relative to the anchor in layer units (updated each frame). */
  cam: [number, number, number];
  visible: boolean;
}

export interface PickResult {
  key: string;
  index: number;
  /** Screen distance from the tap, in pixels of the scene render target. */
  pixels: number;
  /** Distance from the camera in metres. */
  distance: number;
  apparentMag: number;
}

export interface PointLayerOptions {
  /** Metres per position unit of the chunks in this layer. */
  unit: number;
  /** Draw order within the background scene. */
  renderOrder: number;
}

const PC = 3.085677581491367e16;
/** Apparent magnitude of a star drawn at unit brightness (the star layer's "exposure"; the naked-eye limit). */
export const STAR_MAG_REF = 6;
/** Upper bound on points re-packed per frame, so batch rebuilds never cause a visible hitch. */
const REBUILD_POINTS_PER_FRAME = 90_000;

/** Options for one chunk of points. */
export interface ChunkOptions {
  /** World radius (units) of glow particles in this chunk. */
  glowSize?: number;
  /** Brightness group (index into `PointLayer.groups`); catalogue and procedural points fade independently. */
  group?: number;
  /** Distance (units) beyond which the chunk's points fade out, for cells generated only out to a radius. */
  maxDist?: number;
  /** Pack this chunk into the named batch (one draw call per batch) instead of giving it its own draw call. */
  batch?: string;
}

/** Shared settings of a batch (all of its chunks belong to one level of one grid). */
export interface BatchOptions {
  group: number;
  glowSize: number;
  /** Visibility radius (units) of the batch's points. Must be > 0. */
  maxDist: number;
  /** How far beyond `maxDist` points are kept between rebuilds (1.25 = 25 % margin). */
  trim?: number;
}

export class PointLayer {
  /**
   * Brightness groups. `magLimit` is the faintest apparent magnitude drawn (animate it for
   * smooth LOD transitions); `magRef` is the magnitude drawn at unit brightness (the layer's
   * "exposure"); `floor` gives objects beyond the limit a minimum visibility.
   */
  readonly groups: Array<{ magLimit: number; magRef: number; floor: number }> = Array.from({ length: 4 }, () => ({ magLimit: 7, magRef: STAR_MAG_REF, floor: 0 }));
  /** Overall brightness multiplier (used to dim the star field next to a bright star or under a day sky). */
  gain = 1;
  /** Pixel size at which galaxy points fade in favour of resolved sprites (0 = never). */
  resolvePx = 0;
  private readonly chunks = new Map<string, Chunk>();
  private readonly batches = new Map<string, Batch>();
  private readonly base: THREE.ShaderMaterial;
  private readonly batchBase: THREE.ShaderMaterial;
  private readonly group = new THREE.Group();
  private readonly tmp = { x: 0, y: 0, z: 0 };
  private readonly frustum = new THREE.Frustum();
  private readonly mat = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private clock = 0;
  private ownPoints = 0;
  /** Points currently submitted to the GPU (tiles + packed batches). */
  pointCount = 0;
  /** Draw calls this layer issued last frame. */
  drawCalls = 0;

  constructor(scene: THREE.Scene, private readonly opts: PointLayerOptions) {
    this.base = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, toneMapped: false,
      uniforms: {
        uCamHi: { value: new THREE.Vector3() }, uCamLo: { value: new THREE.Vector3() }, uUnit: { value: opts.unit }, uTenPc: { value: (10 * PC) / opts.unit },
        uMagLimit: { value: 7 }, uMagRef: { value: 6 }, uFloor: { value: 0 }, uMaxDist: { value: 0 }, uPx: { value: 1.5 }, uFade: { value: 0 }, uHide: { value: -1 }, uGlowSize: { value: 1 },
        uFocal: { value: 1000 }, uGain: { value: 1 }, uResolve: { value: 0 }, uTime: { value: 0 },
      },
    });
    this.batchBase = this.base.clone();
    this.batchBase.defines = { BATCHED: '' };
    this.group.renderOrder = opts.renderOrder;
    scene.add(this.group);
  }

  has(key: string): boolean {
    const c = this.chunks.get(key);
    return c !== undefined && !c.removing;
  }

  get size(): number {
    return this.chunks.size;
  }

  getChunk(key: string): { anchor: UPos; data: PointChunkData } | undefined {
    return this.chunks.get(key);
  }

  /** Create or update a batch. Call whenever the level's visibility radius changes. */
  configureBatch(id: string, options: BatchOptions): void {
    let b = this.batches.get(id);
    if (!b) {
      const geo = new THREE.BufferGeometry();
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
      const material = this.batchBase.clone();
      const points = new THREE.Points(geo, material);
      points.frustumCulled = false;
      points.matrixAutoUpdate = false;
      points.renderOrder = this.opts.renderOrder;
      points.visible = false;
      this.group.add(points);
      b = {
        id, points, material, members: new Set(), anchor: { sx: 0, sy: 0, sz: 0, x: 0, y: 0, z: 0 }, group: options.group, maxDist: options.maxDist, builtMaxDist: options.maxDist,
        trim: options.trim ?? 1.25, dirty: false, count: 0, capacity: 0, position: new Float32Array(0), color: new Uint8Array(0), mag: new Float32Array(0), birth: new Float32Array(0),
      };
      this.batches.set(id, b);
    }
    b.group = options.group;
    b.maxDist = options.maxDist;
    b.trim = options.trim ?? 1.25;
    b.material.uniforms.uGlowSize!.value = options.glowSize;
    // A radius change of a few per cent is absorbed by the trim margin; more needs a repack.
    if (Math.abs(b.maxDist - b.builtMaxDist) > 0.03 * b.builtMaxDist) b.dirty = true;
  }

  /** Drop a batch that is no longer used (its chunks must have been removed already). */
  removeBatch(id: string): void {
    const b = this.batches.get(id);
    if (!b) return;
    for (const c of b.members) this.chunks.delete(c.key);
    this.group.remove(b.points);
    b.points.geometry.dispose();
    b.material.dispose();
    this.batches.delete(id);
  }

  /** Points of a batch currently on the GPU. */
  batchCount(id: string): number {
    return this.batches.get(id)?.count ?? 0;
  }

  /** Add a chunk of points anchored at `anchor`. */
  addChunk(key: string, anchor: UPos, data: PointChunkData, options: ChunkOptions = {}): void {
    const existing = this.chunks.get(key);
    if (existing) {
      existing.removing = false;
      return;
    }
    if (data.count === 0) return;
    const batch = options.batch ? this.batches.get(options.batch) ?? null : null;
    if (options.batch && !batch) throw new Error(`point batch "${options.batch}" was not configured`);
    if (batch) {
      const chunk: Chunk = { key, anchor, data, points: null, material: null, batch, birth: this.clock, fade: 1, removing: false, hidden: -1, group: batch.group, maxDist: batch.maxDist, cam: [0, 0, 0], visible: true };
      this.chunks.set(key, chunk);
      batch.members.add(chunk);
      batch.dirty = true;
      return;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(data.colors, 4, true));
    geo.setAttribute('aMag', new THREE.BufferAttribute(data.absMag, 1));
    // Culling is done by hand (positions are camera-relative in the shader, not via matrices).
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    const material = this.base.clone();
    material.uniforms.uGlowSize!.value = options.glowSize ?? 1;
    material.uniforms.uMaxDist!.value = options.maxDist ?? 0;
    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    points.matrixAutoUpdate = false;
    points.renderOrder = this.opts.renderOrder;
    this.group.add(points);
    this.chunks.set(key, { key, anchor, data, points, material, batch: null, birth: this.clock, fade: 0, removing: false, hidden: -1, group: options.group ?? 0, maxDist: options.maxDist ?? 0, cam: [0, 0, 0], visible: true });
    this.ownPoints += data.count;
  }

  /** Fade a chunk out and free its GPU resources. (Batched chunks leave at once: they are only dropped when out of sight.) */
  removeChunk(key: string, immediate = false): void {
    const c = this.chunks.get(key);
    if (!c) return;
    if (immediate || c.batch) this.destroy(c);
    else c.removing = true;
  }

  private destroy(c: Chunk): void {
    this.chunks.delete(c.key);
    if (c.batch) {
      c.batch.members.delete(c);
      c.batch.dirty = true;
      return;
    }
    this.group.remove(c.points!);
    c.points!.geometry.dispose();
    c.material!.dispose();
    this.ownPoints -= c.data.count;
  }

  /** Move a chunk with its own draw call to another brightness group. */
  setChunkGroup(key: string, group: number): void {
    const c = this.chunks.get(key);
    if (c && !c.batch) c.group = group;
  }

  /** Hide one point of a chunk (its object is being drawn as a full model instead). Pass −1 to show all. */
  setHidden(key: string, index: number): void {
    const c = this.chunks.get(key);
    if (!c || c.hidden === index) return;
    c.hidden = index;
    if (c.batch) c.batch.dirty = true;
  }

  /** Visit every live chunk: its key, anchor, data and the camera position relative to the anchor (layer units). */
  forEachChunk(visit: (key: string, anchor: UPos, data: PointChunkData, cam: readonly [number, number, number]) => void): void {
    for (const c of this.chunks.values()) if (!c.removing) visit(c.key, c.anchor, c.data, c.cam);
  }

  keys(): IterableIterator<string> {
    return this.chunks.keys();
  }

  /** Re-pack a batch around the camera: only points that can be seen before the next rebuild go to the GPU. */
  private rebuild(b: Batch, camPos: UPos): number {
    const unit = this.opts.unit;
    let total = 0;
    for (const c of b.members) total += c.data.count;
    if (total > b.capacity) {
      // Grow geometrically; new attributes replace the old GPU buffers.
      b.capacity = Math.max(1024, 2 ** Math.ceil(Math.log2(total)));
      b.position = new Float32Array(b.capacity * 3);
      b.color = new Uint8Array(b.capacity * 4);
      b.mag = new Float32Array(b.capacity);
      b.birth = new Float32Array(b.capacity);
      const geo = b.points.geometry;
      geo.dispose();
      const dyn = (a: THREE.BufferAttribute): THREE.BufferAttribute => a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', dyn(new THREE.BufferAttribute(b.position, 3)));
      geo.setAttribute('aColor', dyn(new THREE.BufferAttribute(b.color, 4, true)));
      geo.setAttribute('aMag', dyn(new THREE.BufferAttribute(b.mag, 1)));
      geo.setAttribute('aBirth', dyn(new THREE.BufferAttribute(b.birth, 1)));
    }
    b.anchor = { sx: camPos.sx, sy: camPos.sy, sz: camPos.sz, x: camPos.x, y: camPos.y, z: camPos.z };
    const reach = b.maxDist * b.trim;
    const reach2 = reach * reach;
    const { position, color, mag, birth } = b;
    let n = 0;
    for (const c of b.members) {
      c.maxDist = b.maxDist;
      c.group = b.group;
      // Chunk anchor relative to the new batch anchor, in units (float64).
      uposSub(c.anchor, camPos, this.tmp);
      const ox = this.tmp.x / unit;
      const oy = this.tmp.y / unit;
      const oz = this.tmp.z / unit;
      const far = Math.sqrt(ox * ox + oy * oy + oz * oz) - c.data.radius;
      if (far > reach) continue;
      const inside = Math.sqrt(ox * ox + oy * oy + oz * oz) + c.data.radius <= reach;
      const src = c.data.positions;
      const col = c.data.colors;
      const m = c.data.absMag;
      for (let i = 0, count = c.data.count; i < count; i++) {
        if (i === c.hidden) continue;
        const x = src[i * 3]! + ox;
        const y = src[i * 3 + 1]! + oy;
        const z = src[i * 3 + 2]! + oz;
        if (!inside && x * x + y * y + z * z > reach2) continue;
        position[n * 3] = x;
        position[n * 3 + 1] = y;
        position[n * 3 + 2] = z;
        color[n * 4] = col[i * 4]!;
        color[n * 4 + 1] = col[i * 4 + 1]!;
        color[n * 4 + 2] = col[i * 4 + 2]!;
        color[n * 4 + 3] = col[i * 4 + 3]!;
        mag[n] = m[i]!;
        birth[n] = c.birth;
        n++;
      }
    }
    b.count = n;
    b.builtMaxDist = b.maxDist;
    b.dirty = false;
    const geo = b.points.geometry;
    geo.setDrawRange(0, n);
    for (const name of ['position', 'aColor', 'aMag', 'aBirth']) {
      const attr = geo.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (!attr) continue;
      attr.clearUpdateRanges();
      if (n > 0) attr.addUpdateRange(0, n * attr.itemSize);
      attr.needsUpdate = true;
    }
    return total;
  }

  /** Per-frame update: camera-relative offsets, fades, manual frustum culling, batch upkeep. */
  update(camPos: UPos, camera: THREE.PerspectiveCamera, dt: number, pxScale: number, focal: number): void {
    const unit = this.opts.unit;
    this.clock += dt;
    this.mat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.mat);
    let draws = 0;
    for (const c of this.chunks.values()) {
      if (c.removing) {
        c.fade -= dt * 3.5;
        if (c.fade <= 0) {
          this.destroy(c);
          continue;
        }
      } else if (c.fade < 1) {
        c.fade = Math.min(1, c.fade + dt * 2.5);
      }
      // Camera relative to the chunk anchor, in units (float64).
      uposSub(camPos, c.anchor, this.tmp);
      const cx = this.tmp.x / unit;
      const cy = this.tmp.y / unit;
      const cz = this.tmp.z / unit;
      c.cam[0] = cx;
      c.cam[1] = cy;
      c.cam[2] = cz;
      // Cull against the view frustum (camera at the origin; chunk centre at −cam).
      this.sphere.center.set(-cx * unit, -cy * unit, -cz * unit);
      this.sphere.radius = c.data.radius * unit;
      c.visible = this.frustum.intersectsSphere(this.sphere);
      if (!c.points) continue; // drawn by its batch
      c.points.visible = c.visible;
      if (!c.visible) continue;
      draws++;
      const u = c.material!.uniforms;
      const hx = Math.fround(cx);
      const hy = Math.fround(cy);
      const hz = Math.fround(cz);
      (u.uCamHi!.value as THREE.Vector3).set(hx, hy, hz);
      (u.uCamLo!.value as THREE.Vector3).set(cx - hx, cy - hy, cz - hz);
      const g = this.groups[c.group]!;
      u.uMagLimit!.value = g.magLimit;
      u.uMagRef!.value = g.magRef;
      u.uFloor!.value = g.floor;
      u.uResolve!.value = this.resolvePx;
      u.uPx!.value = pxScale;
      u.uFade!.value = c.fade * c.fade * (3 - 2 * c.fade);
      u.uHide!.value = c.hidden;
      u.uFocal!.value = focal;
      u.uGain!.value = this.gain;
    }

    let packed = 0;
    let budget = REBUILD_POINTS_PER_FRAME;
    for (const b of this.batches.values()) {
      uposSub(camPos, b.anchor, this.tmp);
      let cx = this.tmp.x / unit;
      let cy = this.tmp.y / unit;
      let cz = this.tmp.z / unit;
      const drift = Math.sqrt(cx * cx + cy * cy + cz * cz);
      const stale = b.members.size > 0 && drift > (b.trim - 1) * 0.8 * b.builtMaxDist;
      if ((b.dirty || stale) && (budget > 0 || b.count === 0)) {
        budget -= this.rebuild(b, camPos);
        cx = cy = cz = 0;
      }
      packed += b.count;
      b.points.visible = b.count > 0;
      if (b.count === 0) continue;
      draws++;
      const u = b.material.uniforms;
      const hx = Math.fround(cx);
      const hy = Math.fround(cy);
      const hz = Math.fround(cz);
      (u.uCamHi!.value as THREE.Vector3).set(hx, hy, hz);
      (u.uCamLo!.value as THREE.Vector3).set(cx - hx, cy - hy, cz - hz);
      const g = this.groups[b.group]!;
      u.uMagLimit!.value = g.magLimit;
      u.uMagRef!.value = g.magRef;
      u.uFloor!.value = g.floor;
      u.uResolve!.value = this.resolvePx;
      u.uPx!.value = pxScale;
      u.uFade!.value = 1;
      u.uHide!.value = -1;
      u.uMaxDist!.value = b.maxDist;
      u.uFocal!.value = focal;
      u.uGain!.value = this.gain;
      u.uTime!.value = this.clock;
    }
    this.pointCount = this.ownPoints + packed;
    this.drawCalls = draws;
  }

  /**
   * Find the point nearest to a screen position.
   * @param ndcX,ndcY tap position in normalised device coordinates (−1…1)
   * @param maxPixels search radius in scene-target pixels
   */
  pick(camera: THREE.PerspectiveCamera, ndcX: number, ndcY: number, width: number, height: number, maxPixels: number): PickResult | null {
    const e = camera.matrixWorldInverse.elements;
    const tanY = Math.tan((camera.fov * Math.PI) / 360);
    const tanX = tanY * camera.aspect;
    const tenPc = (10 * PC) / this.opts.unit;
    let best: PickResult | null = null;
    let bestScore = Infinity;
    for (const c of this.chunks.values()) {
      if (!c.visible || c.removing) continue;
      const pos = c.data.positions;
      const mag = c.data.absMag;
      const style = c.data.colors;
      const [cx, cy, cz] = c.cam;
      const limit = this.groups[c.group]!.magLimit;
      const floor = this.groups[c.group]!.floor;
      // Points past the chunk's visibility radius are not drawn, so they cannot be tapped either.
      const reach2 = c.maxDist > 0 ? c.maxDist * c.maxDist : Infinity;
      for (let i = 0, n = c.data.count; i < n; i++) {
        if (style[i * 4 + 3] === 5 || i === c.hidden) continue; // glow particles are not selectable
        const x = pos[i * 3]! - cx;
        const y = pos[i * 3 + 1]! - cy;
        const z = pos[i * 3 + 2]! - cz;
        // View-space depth first (cheap reject of everything behind the camera).
        const vz = e[2]! * x + e[6]! * y + e[10]! * z;
        if (vz >= 0) continue;
        const vx = e[0]! * x + e[4]! * y + e[8]! * z;
        const vy = e[1]! * x + e[5]! * y + e[9]! * z;
        const px = ((vx / -vz / tanX - ndcX) * width) / 2;
        const py = ((vy / -vz / tanY - ndcY) * height) / 2;
        const d2 = px * px + py * py;
        if (d2 > maxPixels * maxPixels) continue;
        const r2 = x * x + y * y + z * z;
        if (r2 > reach2) continue;
        const dist = Math.sqrt(r2);
        const m = mag[i]! + 5 * Math.log10(Math.max(dist, 1e-12) / tenPc);
        if (m > limit + 0.3 && floor <= 0) continue;
        // Prefer close to the finger, then brighter.
        const score = Math.sqrt(d2) + Math.max(0, Math.min(m, limit) - (limit - 12)) * 1.3;
        if (score < bestScore) {
          bestScore = score;
          best = { key: c.key, index: i, pixels: Math.sqrt(d2), distance: dist * this.opts.unit, apparentMag: m };
        }
      }
    }
    return best;
  }

  /** Nearest point to the camera across all chunks (for travel-speed scaling). Returns distance in metres. */
  nearestDistance(maxUnits: number): number {
    let best = maxUnits * maxUnits;
    for (const c of this.chunks.values()) {
      if (c.removing) continue;
      const [cx, cy, cz] = c.cam;
      const d = Math.sqrt(cx * cx + cy * cy + cz * cz) - c.data.radius;
      if (d * d > best && d > 0) continue;
      const pos = c.data.positions;
      const style = c.data.colors;
      for (let i = 0, n = c.data.count; i < n; i++) {
        if (style[i * 4 + 3] === 5) continue;
        const x = pos[i * 3]! - cx;
        const y = pos[i * 3 + 1]! - cy;
        const z = pos[i * 3 + 2]! - cz;
        const d2 = x * x + y * y + z * z;
        if (d2 < best) best = d2;
      }
    }
    return Math.sqrt(best) * this.opts.unit;
  }

  dispose(): void {
    for (const c of [...this.chunks.values()]) this.destroy(c);
    for (const id of [...this.batches.keys()]) this.removeBatch(id);
    this.base.dispose();
    this.batchBase.dispose();
    this.group.removeFromParent();
  }
}
