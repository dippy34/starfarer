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
uniform float uFloor;       // minimum visibility for objects beyond the limit ("survey dots")
uniform float uMaxDist;     // distance (units) at which this chunk's points have fully faded (0 = no limit)
uniform float uPx;          // base sprite size in pixels
uniform float uFade;        // chunk fade-in/out
uniform float uHide;        // index of a point replaced by a full model (or -1)
uniform float uGlowSize;    // world radius (units) of glow particles
uniform float uFocal;       // pixels per radian
uniform float uGain;
uniform float uResolve;     // pixel size at which galaxies hand over to impostor sprites
varying vec3 vColor;
varying float vStyle;
varying float vSpike;
void main() {
  vec3 rel = (position - uCamHi) - uCamLo;
  float d = max(length(rel), 1e-12);
  vec4 mv = viewMatrix * vec4(rel * uUnit, 1.0);
  gl_Position = projectionMatrix * mv;
  float style = floor(aColor.a * 255.0 + 0.5);
  vStyle = style;
  float range = uMaxDist > 0.0 ? 1.0 - smoothstep(uMaxDist * 0.72, uMaxDist, d) : 1.0;
  float size;
  float inten;
  if (style > 4.5) {
    // Glow particle: a soft blob of fixed world size carrying the unresolved light of the cosmic web.
    size = clamp(uGlowSize / d * uFocal, 1.5, 72.0);
    // Fade when the camera is inside the blob so it never fills the screen.
    float inside = smoothstep(uGlowSize * 1.2, uGlowSize * 5.0, d);
    inten = 0.55 * range * inside * (30.0 / (size * size + 26.0));
  } else {
    // Apparent magnitude m = M + 5 log10(d / 10 pc); e = flux relative to the limit.
    float m = aMag + 2.17147241 * log(d / uTenPc);
    float fade = clamp((uMagLimit - m) / 0.8, 0.0, 1.0);
    float e = pow(10.0, 0.4 * clamp(uMagLimit - m, -8.0, 30.0)) * fade;
    e = max(e, uFloor) * range;
    float soft = style > 2.5 && style < 3.5 ? 1.25 : 1.0;   // galaxies are slightly fuzzy
    size = uPx * soft * min(0.95 + 0.58 * pow(e, 0.27), 34.0);
    inten = min(e * 0.55, 14.0) / soft;
    if (style > 3.5) inten *= 1.6;                           // quasars: piercing points
    if (style > 2.5 && uResolve > 0.0) {
      // A galaxy big enough to be drawn as a resolved sprite fades out of the point cloud.
      float kpc = 14.0 * pow(10.0, -0.133 * (aMag + 21.0));
      float px = kpc * 1e-3 / d * uFocal;
      inten *= 1.0 - smoothstep(uResolve * 0.6, uResolve * 1.6, px);
    }
  }
  vSpike = smoothstep(7.0, 16.0, size / uPx);
  vColor = aColor.rgb * inten * uFade * uGain;
  if (float(gl_VertexID) == uHide || inten * uFade <= 0.0005) {
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
    a = (1.0 - r2);
    a *= a;
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

interface Chunk {
  key: string;
  anchor: UPos;
  data: PointChunkData;
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  fade: number;
  removing: boolean;
  hidden: number;
  group: number;
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

/** Options for one chunk of points. */
export interface ChunkOptions {
  /** World radius (units) of glow particles in this chunk. */
  glowSize?: number;
  /** Brightness group (index into `PointLayer.groups`); catalogue and procedural points fade independently. */
  group?: number;
  /** Distance (units) beyond which the chunk's points fade out, for cells generated only out to a radius. */
  maxDist?: number;
}

export class PointLayer {
  /**
   * Brightness groups. `magLimit` is the faintest apparent magnitude drawn (animate it for
   * smooth LOD transitions); `floor` gives objects beyond the limit a minimum visibility.
   */
  readonly groups: Array<{ magLimit: number; floor: number }> = [{ magLimit: 7, floor: 0 }, { magLimit: 7, floor: 0 }, { magLimit: 7, floor: 0 }];
  /** Overall brightness multiplier (used to dim the star field next to a bright star or under a day sky). */
  gain = 1;
  /** Pixel size at which galaxy points fade in favour of resolved sprites (0 = never). */
  resolvePx = 0;
  private readonly chunks = new Map<string, Chunk>();
  private readonly base: THREE.ShaderMaterial;
  private readonly group = new THREE.Group();
  private readonly tmp = { x: 0, y: 0, z: 0 };
  private readonly frustum = new THREE.Frustum();
  private readonly mat = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  pointCount = 0;
  visibleChunks = 0;

  constructor(scene: THREE.Scene, private readonly opts: PointLayerOptions) {
    this.base = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, toneMapped: false,
      uniforms: {
        uCamHi: { value: new THREE.Vector3() }, uCamLo: { value: new THREE.Vector3() }, uUnit: { value: opts.unit }, uTenPc: { value: (10 * PC) / opts.unit },
        uMagLimit: { value: 7 }, uFloor: { value: 0 }, uMaxDist: { value: 0 }, uPx: { value: 1.5 }, uFade: { value: 0 }, uHide: { value: -1 }, uGlowSize: { value: 1 },
        uFocal: { value: 1000 }, uGain: { value: 1 }, uResolve: { value: 0 },
      },
    });
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

  /** Add a chunk of points anchored at `anchor`. */
  addChunk(key: string, anchor: UPos, data: PointChunkData, options: ChunkOptions = {}): void {
    const existing = this.chunks.get(key);
    if (existing) {
      existing.removing = false;
      return;
    }
    if (data.count === 0) return;
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
    this.chunks.set(key, { key, anchor, data, points, material, fade: 0, removing: false, hidden: -1, group: options.group ?? 0, cam: [0, 0, 0], visible: true });
    this.pointCount += data.count;
  }

  /** Fade a chunk out and free its GPU resources. */
  removeChunk(key: string, immediate = false): void {
    const c = this.chunks.get(key);
    if (!c) return;
    if (immediate) this.destroy(c);
    else c.removing = true;
  }

  private destroy(c: Chunk): void {
    this.group.remove(c.points);
    c.points.geometry.dispose();
    c.material.dispose();
    this.chunks.delete(c.key);
    this.pointCount -= c.data.count;
  }

  /** Hide one point of a chunk (its object is being drawn as a full model instead). Pass −1 to show all. */
  setHidden(key: string, index: number): void {
    const c = this.chunks.get(key);
    if (c) c.hidden = index;
  }

  /** Visit every live chunk: its key, anchor, data and the camera position relative to the anchor (layer units). */
  forEachChunk(visit: (key: string, anchor: UPos, data: PointChunkData, cam: readonly [number, number, number]) => void): void {
    for (const c of this.chunks.values()) if (!c.removing) visit(c.key, c.anchor, c.data, c.cam);
  }

  keys(): IterableIterator<string> {
    return this.chunks.keys();
  }

  /** Per-frame update: camera-relative offsets, fades, manual frustum culling. */
  update(camPos: UPos, camera: THREE.PerspectiveCamera, dt: number, pxScale: number, focal: number): void {
    const unit = this.opts.unit;
    this.mat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.mat);
    let visible = 0;
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
      c.points.visible = c.visible;
      if (!c.visible) continue;
      visible++;
      const u = c.material.uniforms;
      const hx = Math.fround(cx);
      const hy = Math.fround(cy);
      const hz = Math.fround(cz);
      (u.uCamHi!.value as THREE.Vector3).set(hx, hy, hz);
      (u.uCamLo!.value as THREE.Vector3).set(cx - hx, cy - hy, cz - hz);
      const g = this.groups[c.group]!;
      u.uMagLimit!.value = g.magLimit;
      u.uFloor!.value = g.floor;
      u.uResolve!.value = this.resolvePx;
      u.uPx!.value = pxScale;
      u.uFade!.value = c.fade * c.fade * (3 - 2 * c.fade);
      u.uHide!.value = c.hidden;
      u.uFocal!.value = focal;
      u.uGain!.value = this.gain;
    }
    this.visibleChunks = visible;
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
        const dist = Math.sqrt(x * x + y * y + z * z);
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
    this.base.dispose();
    this.group.removeFromParent();
  }
}
