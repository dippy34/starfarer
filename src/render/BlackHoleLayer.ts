import {
  AlwaysDepth, BackSide, NeverDepth, ClampToEdgeWrapping, CubeCamera, DataTexture, DataUtils, FrontSide, Group, HalfFloatType,
  LessEqualDepth, LinearFilter, LinearMipmapLinearFilter, Mesh, NoBlending, type Object3D, type PerspectiveCamera,
  RGBAFormat, type Scene, ShaderMaterial, SphereGeometry, Vector3, WebGLCubeRenderTarget, type WebGLRenderer,
} from 'three';
import { blackbodySurface } from '../astro/photometry';
import { AU, SUN_RADIUS } from '../core/units';
import type { UPos } from '../core/upos';
import type { BlackHole } from '../universe/BlackHoles';
import { QUALITY } from './Quality';
import { VOLUMES } from './Renderer';
import { BH_FRAG, BH_VERT } from './shaders/blackhole';
import { GLOBALS } from './shaders/xr';

/** Radiance of the Sun's disk in the engine's units (white Lambertian at 1 AU = 1). */
const SUN_DISK = (AU / SUN_RADIUS) ** 2;
/** where a thin disk is hottest, in inner radii: the maximum of x^-3/4 (1 - x^-1/2)^1/4 */
const DISK_PEAK = 49 / 36;
/** how far the strongest colour of a glow may exceed its luminance before it counts as brighter for the exposure */
const COLOUR_ROOM = 1.7;
const LUT_LOG_MIN = 2.5;
const LUT_LOG_SPAN = 5.5;
const MAX_ACTIVE = 2;
/** radius (m) of the camera-centred sphere used when the eye is inside a lensing region */
const INSIDE_SPHERE = 1e7;
/** while the eye holds still, a cube face is refreshed every this many frames (exposure changes, slow motions) */
const IDLE_FRAMES = 6;
const ALL_FACES = [0, 1, 2, 3, 4, 5];

export interface BlackHoleView {
  bh: BlackHole;
  rel: Vector3;
  dist: number;
  /** radius (m) of the region drawn with lensing */
  region: number;
  /** eye inside that region (drawn full screen) */
  inside: boolean;
  /** angular radius of the shadow and of the bright inner disk, in pixels */
  shadowPx: number;
  innerDiskPx: number;
  /** typical radiance of the inner disk (engine units, before exposure); 0 without a disk */
  diskRadiance: number;
}

/**
 * Draws black holes: each nearby hole gets a sphere around the region it visibly distorts (or
 * a full-screen sphere when the eye is inside that region) whose shader traces light past it
 * (shaders/blackhole.ts). The undistorted scene behind it comes from two cube maps captured at
 * the eye with the holes hidden, one face per frame: the scene itself (stars, bodies), and in a
 * smaller one the glowing volumes around the eye (a galaxy's light, nebulae, the Milky Way),
 * which the renderer draws in a pass of their own (Renderer: VOLUMES) and which are soft.
 */
export class BlackHoleLayer {
  readonly group = new Group();
  views: BlackHoleView[] = [];
  /** headset quality: fewer integration steps and a smaller environment map */
  vr = false;
  private meshes: Mesh[] = [];
  private geo = new SphereGeometry(1, 64, 32);
  private env: WebGLCubeRenderTarget;
  private cubeCam: CubeCamera;
  /** the volumes around the eye, and whether the map holds any at the moment */
  private glow: WebGLCubeRenderTarget;
  private glowCam: CubeCamera;
  private glowing = false;
  /**
   * How bright the volumes are being drawn (the galaxies', the nebulae's, the Milky Way's factors:
   * the app sets it each frame). The eye's adaptation changes them with no move of the eye; the
   * volumes' map then is redrawn whole, so its faces never differ from one another or from the
   * view beside the hole.
   */
  glowLevel: number[] = [];
  private glowDrawn: number[] = [];
  private lut: DataTexture;
  private face = 0;
  private fullCapture = true;
  private relY = new Map<number, [number, number]>();
  /** the eye at the previous update, and frames since a cube face was last refreshed */
  private lastCam: UPos | null = null;
  private moved = true;
  private idle = 0;
  private lastCompanion = new Map<BlackHole, UPos>();

  /**
   * `reversedDepth`: three maps depth functions for a reversed-Z buffer (Always <-> Never too),
   * so "always pass" has to be requested as Never there.
   */
  constructor(readonly holes: BlackHole[], private exposure: { value: number }, private reversedDepth = false) {
    this.group.name = 'black-holes';
    this.lut = makeLut();
    this.env = makeEnv(1024);
    this.cubeCam = new CubeCamera(1e3, 1e30, this.env);
    this.glow = makeGlow(512);
    this.glowCam = new CubeCamera(1e3, 1e30, this.glow);
    this.glowCam.layers.set(VOLUMES.layer);
  }

  private material(): ShaderMaterial {
    return new ShaderMaterial({
      name: 'black-hole', vertexShader: BH_VERT, fragmentShader: BH_FRAG,
      uniforms: {
        uEnv: { value: this.env.texture }, uGlow: { value: this.glow.texture }, uLut: { value: this.lut },
        uO: { value: new Vector3() }, uRs: { value: 1 },
        uN: { value: new Vector3(0, 0, 1) }, uE1: { value: new Vector3(1, 0, 0) }, uE2: { value: new Vector3(0, 1, 0) },
        uRin: { value: 3 }, uRout: { value: 0 }, uTmax: { value: 1e4 }, uSunDisk: { value: SUN_DISK }, uExposure: this.exposure, uTime: { value: 0 },
        uMaxSteps: { value: 220 }, uStepK: { value: 1 },
        uDiskSeed: { value: 0 }, uSpiral: { value: 0 }, uArms: { value: 2 }, uStreakFreq: { value: 9 }, uAngFreq: { value: 2.2 }, uWarp: { value: 0.5 },
        uClipScale: { value: 1 }, uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK,
      },
      // drawn after the stars and point sources it replaces, before nearby sprites that may be in front
      transparent: true, blending: NoBlending, depthTest: true, depthWrite: true,
    });
  }

  private mesh(i: number): Mesh {
    while (this.meshes.length <= i) {
      const m = new Mesh(this.geo, this.material());
      m.matrixAutoUpdate = false;
      m.frustumCulled = false;
      m.renderOrder = 30;
      m.name = `black-hole-${this.meshes.length}`;
      this.group.add(m);
      this.meshes.push(m);
    }
    return this.meshes[i];
  }

  /**
   * Meshes to compile the shader with before it is first needed: seen from outside and from inside
   * the lensing region (the side is part of three's program, so each is its own program).
   */
  warmupObjects(): Mesh[] {
    const inside = this.mesh(1);
    const mat = inside.material as ShaderMaterial;
    if (mat.side !== BackSide) { mat.side = BackSide; mat.depthFunc = this.reversedDepth ? NeverDepth : AlwaysDepth; mat.needsUpdate = true; }
    return [this.mesh(0), inside];
  }

  /**
   * Radiance of a blackbody at T relative to the Sun's disk temperature (visual luminance). From a
   * table every 1/50 dex, read between its entries: a cool disk's glow rises twentyfold for
   * every tenth more of temperature, and must not do so in steps.
   */
  private relLuminance(T: number): number {
    const f = Math.log10(Math.max(T, 1)) * 50, k = Math.floor(f);
    const lo = this.blackbody(k), hi = this.blackbody(k + 1);
    return Math.exp(lo[0] + (hi[0] - lo[0]) * (f - k));
  }

  /**
   * The same, as hard as it drives the display: its luminance, or more for a strongly coloured
   * glow. The tone curve keeps the hue only while the strongest colour fits the display; beyond
   * that it bleaches (a deep red glow shown as bright as a white one comes out pink).
   */
  private relDrive(T: number): number {
    const f = Math.log10(Math.max(T, 1)) * 50, k = Math.floor(f);
    const lo = this.blackbody(k), hi = this.blackbody(k + 1);
    return Math.exp(lo[1] + (hi[1] - lo[1]) * (f - k));
  }

  /** [log luminance (relative to the Sun's disk), log drive] of a blackbody at 10^(k/50) K */
  private blackbody(k: number): [number, number] {
    let v = this.relY.get(k);
    if (v === undefined) {
      const { rgb, relY } = blackbodySurface(10 ** (k / 50));
      // the strongest colour of a light of luminance 1, drawn a little more saturated (as the shader does)
      const strongest = 1 + 1.3 * (Math.max(rgb[0], rgb[1], rgb[2]) - 1);
      const y = Math.log(Math.max(relY, 1e-300));
      v = [y, y + Math.log(Math.max(1, strongest / COLOUR_ROOM))];
      this.relY.set(k, v);
    }
    return v;
  }

  /**
   * Radiance (engine units, before exposure) of a hole's disk at radius `r` (m) from its centre:
   * the temperature profile the shader draws (shaders/blackhole.ts), brightest at 1.36 inner radii.
   * Inside that the peak is returned: the eye is set by the brightest part in view. 0 beyond the disk.
   */
  radianceAt(bh: BlackHole, r: number): number {
    if (!(bh.diskOuter > 0) || r > bh.diskOuter) return 0;
    const x = Math.max(r / bh.diskInner, DISK_PEAK);
    const profile = (x ** -0.75 * (1 - 1 / Math.sqrt(x)) ** 0.25) / 0.48795;
    return SUN_DISK * this.relLuminance(bh.diskTmax * profile);
  }

  /**
   * How bright the shader draws a hole's disk at radius `r` (m) where its gas moves as `approach`
   * says (the cosine of the angle from its orbit's direction to the eye): engine units, before
   * exposure. As shaders/blackhole.ts has it: the temperature there, shifted by the gas's speed
   * and the hole's gravity (the side coming towards the eye is hotter to look at, and a cool disk
   * many times brighter for it); a bright streak of the gas (1.4 times the mean); and how much
   * the disk there hides of what is behind it (its outer reaches are thin). A strongly coloured
   * glow counts for more than its luminance (relDrive).
   */
  shownAt(bh: BlackHole, r: number, approach: number): number {
    if (!(bh.diskOuter > 0) || r > bh.diskOuter) return 0;
    const x = Math.max(r / bh.diskInner, DISK_PEAK);
    const profile = (x ** -0.75 * (1 - 1 / Math.sqrt(x)) ** 0.25) / 0.48795;
    const rs = Math.max(r, bh.diskInner) / bh.radius;
    const beta = Math.min(Math.sqrt(0.5 / Math.max(rs - 1, 0.5)), 0.995);
    const shift = (Math.sqrt(Math.max(1 - 1 / rs, 1e-4)) * Math.sqrt(1 - beta * beta)) / (1 - beta * approach);
    const cover = 1 - Math.exp(-7 * x ** -0.85 * 1.5);
    const t = Math.min(1, Math.max(0, (r / bh.diskOuter - 0.45) / 0.55));
    const rim = 1 - t * t * (3 - 2 * t);
    return SUN_DISK * this.relDrive(bh.diskTmax * profile * shift) * 1.4 * cover * rim;
  }

  /** Choose the holes worth drawing from `cam` and set up their meshes. */
  update(cam: UPos, pixelAngle: number, time: number): void {
    this.moved = !this.lastCam || this.lastCam.sub(cam, new Vector3()).lengthSq() > 1;
    if (this.lastCam) this.lastCam.copy(cam); else this.lastCam = cam.clone();
    const cands: BlackHoleView[] = [];
    const rel = new Vector3();
    for (const bh of this.holes) {
      bh.upos.sub(cam, rel);
      const dist = rel.length();
      const rs = bh.radius;
      // beyond ~4/pixelAngle rs the bending (2 rs / b) is under half a pixel
      const regionRs = Math.max(Math.min(Math.max(4 / pixelAngle, 60), 4e5), (bh.diskOuter / rs) * 1.05);
      const region = regionRs * rs;
      const inside = dist < region * 1.05;
      const regionPx = inside ? Infinity : Math.asin(region / dist) / pixelAngle;
      if (regionPx < 1.5) continue;
      const ang = (r: number) => Math.asin(Math.min(1, r / Math.max(dist, r * 1.0001))) / pixelAngle;
      cands.push({
        bh, rel: rel.clone(), dist, region, inside,
        shadowPx: ang(2.6 * rs), innerDiskPx: bh.diskOuter > 0 ? ang(Math.min(20 * rs, bh.diskOuter)) : 0,
        diskRadiance: bh.diskOuter > 0 ? SUN_DISK * this.relLuminance(bh.diskTmax) : 0,
      });
    }
    cands.sort((a, b) => a.dist / a.bh.radius - b.dist / b.bh.radius);
    this.views = cands.slice(0, MAX_ACTIVE);
    // a companion star crossing the lensed sky (fast with time running quickly) needs fresh faces too
    for (const v of this.views) {
      const c = v.bh.companion;
      if (!c) continue;
      const last = this.lastCompanion.get(v.bh);
      if (!last) { this.lastCompanion.set(v.bh, c.upos.clone()); this.moved = true; continue; }
      const step = last.sub(c.upos, rel).length();
      if (step > 1e-3 * c.upos.sub(cam, rel).length()) this.moved = true;
      last.copy(c.upos);
    }
    for (const m of this.meshes) m.visible = false;
    this.views.forEach((v, i) => {
      const m = this.mesh(i);
      const mat = m.material as ShaderMaterial;
      const u = mat.uniforms;
      const bh = v.bh;
      const rs = bh.radius;
      const region = v.region;
      if (v.inside) {
        m.matrix.makeScale(INSIDE_SPHERE, INSIDE_SPHERE, INSIDE_SPHERE);
        u.uClipScale.value = 1 / INSIDE_SPHERE;
        if (mat.side !== BackSide) { mat.side = BackSide; mat.depthFunc = this.reversedDepth ? NeverDepth : AlwaysDepth; mat.needsUpdate = true; }
      } else {
        m.matrix.makeScale(region, region, region).setPosition(v.rel);
        u.uClipScale.value = 1 / (v.dist + region);
        if (mat.side !== FrontSide) { mat.side = FrontSide; mat.depthFunc = LessEqualDepth; mat.needsUpdate = true; }
      }
      m.matrixWorldNeedsUpdate = true;
      m.visible = true;
      (u.uO.value as Vector3).copy(v.rel).multiplyScalar(-1 / rs);
      u.uRs.value = rs;
      const n = bh.diskNormal;
      (u.uN.value as Vector3).copy(n);
      const e1 = new Vector3().crossVectors(n, Math.abs(n.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0)).normalize();
      (u.uE1.value as Vector3).copy(e1);
      (u.uE2.value as Vector3).crossVectors(n, e1);
      u.uRin.value = bh.diskInner / rs;
      u.uRout.value = bh.diskOuter / rs;
      u.uTmax.value = bh.diskTmax;
      const L = bh.diskLook;
      u.uDiskSeed.value = L.seed; u.uSpiral.value = L.spiral; u.uArms.value = L.arms;
      u.uStreakFreq.value = L.streakFreq; u.uAngFreq.value = L.angFreq; u.uWarp.value = L.warp;
      u.uTime.value = time;
      u.uMaxSteps.value = this.vr ? 90 : 220;
      u.uStepK.value = this.vr ? 1.5 : 1;
      u.uEnv.value = this.env.texture;
      u.uGlow.value = this.glow.texture;
    });
  }

  /**
   * Refresh the environment the holes lens: the scene from the eye without the holes, the
   * explorer's rig (controllers, panels) or `hide` (which has to include whatever is drawn for the
   * main camera alone: the renderer's volume pass). One face per call while the eye moves, one
   * every `IDLE_FRAMES` while it holds still (turning the head does not change a cube map); all
   * six when a hole first comes into view. `psf` is adjusted so point sprites are sized for the cube's pixels.
   */
  capture(gl: WebGLRenderer, scene: Scene, hide: Object3D[], psf: Record<string, { value: number }>): void {
    if (!this.views.length) {
      this.fullCapture = true;
      return;
    }
    // (headset: 512 px faces, 256 at the lower quality levels: the capture redraws the scene)
    const size = this.vr ? (QUALITY.level >= 2 ? 256 : 512) : 1024;
    if (this.env.width !== size) {
      this.env.dispose();
      this.env = makeEnv(size);
      this.cubeCam.renderTarget = this.env;
      this.glow.dispose();
      this.glow = makeGlow(size / 2);
      this.glowCam.renderTarget = this.glow;
      this.glowing = false;
      this.fullCapture = true;
    }
    for (const cam of [this.cubeCam, this.glowCam]) {
      if (cam.coordinateSystem !== gl.coordinateSystem) {
        cam.coordinateSystem = gl.coordinateSystem;
        cam.updateCoordinateSystem();
      }
      cam.updateMatrixWorld(true);
    }
    // (headset: every other frame even while moving; a face is 512 px there and the scene costs more)
    const due = this.fullCapture || ++this.idle >= (this.moved ? (this.vr ? 2 : 1) : IDLE_FRAMES);
    const stale = this.glowLevel.length !== this.glowDrawn.length
      || this.glowLevel.some((v, i) => Math.abs(v - this.glowDrawn[i]) > 0.02 * Math.max(Math.abs(v), Math.abs(this.glowDrawn[i]), 1e-9));
    if (!due && !stale) return;
    const faces = !due ? [] : this.fullCapture ? ALL_FACES : [this.face];
    if (due) {
      this.idle = 0;
      this.fullCapture = false;
      this.face = (this.face + 1) % 6;
    }

    const prevTarget = gl.getRenderTarget();
    const prevFace = gl.getActiveCubeFace();
    const prevMip = gl.getActiveMipmapLevel();
    const xrWas = gl.xr.enabled;
    const saved = { sa: psf.uPixelSA.value, dpr: psf.uDpr.value, sigma: psf.uMinSigma.value, pull: GLOBALS.uPullIn.value, dk: GLOBALS.uDepthK.value };
    const hidden = [this.group, ...hide];
    const vis = hidden.map((o) => o.visible);
    for (const o of hidden) o.visible = false;
    gl.xr.enabled = false;
    psf.uPixelSA.value = (2 / size) ** 2;
    psf.uDpr.value = 1;
    psf.uMinSigma.value = 0.5; // (half a pixel of the cube map's)
    GLOBALS.uPullIn.value = 0;
    GLOBALS.uDepthK.value = 1;
    for (const f of faces) {
      this.env.texture.generateMipmaps = f === faces[faces.length - 1];
      gl.setRenderTarget(this.env, f);
      gl.clear(true, true, true);
      gl.render(scene, this.cubeCam.children[f] as PerspectiveCamera);
    }
    this.captureGlow(gl, scene, stale ? ALL_FACES : faces);
    psf.uPixelSA.value = saved.sa;
    psf.uDpr.value = saved.dpr;
    psf.uMinSigma.value = saved.sigma;
    GLOBALS.uPullIn.value = saved.pull;
    GLOBALS.uDepthK.value = saved.dk;
    hidden.forEach((o, i) => { o.visible = vis[i]; });
    gl.xr.enabled = xrWas;
    gl.setRenderTarget(prevTarget, prevFace, prevMip);
  }

  /**
   * The volumes into their own map. Its pixels are not the screen's: the volumes take their
   * samples mid-step (a per-pixel jitter seen through the lens, magnified, would be grain) and
   * their noise at the detail a pixel of this map can hold.
   */
  private captureGlow(gl: WebGLRenderer, scene: Scene, faces: number[]): void {
    const any = VOLUMES.any();
    // nothing glows any more: every face is cleared at once (they are refreshed one at a time otherwise)
    if (!any) faces = this.glowing ? ALL_FACES : [];
    this.glowing = any;
    if (faces.length === 6 || !any) this.glowDrawn = this.glowLevel.slice();
    const saved = { jitter: VOLUMES.jitter.value, pixel: VOLUMES.pixelAngle.value };
    VOLUMES.jitter.value = 0;
    VOLUMES.pixelAngle.value = 2 / this.glow.width;
    for (const f of faces) {
      gl.setRenderTarget(this.glow, f);
      gl.clear(true, false, false);
      if (any) gl.render(scene, this.glowCam.children[f] as PerspectiveCamera);
    }
    VOLUMES.jitter.value = saved.jitter;
    VOLUMES.pixelAngle.value = saved.pixel;
  }
}

function makeEnv(size: number): WebGLCubeRenderTarget {
  return new WebGLCubeRenderTarget(size, {
    type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, depthBuffer: true,
  });
}

/** the volumes' map: soft light, so no mip levels and no depth */
function makeGlow(size: number): WebGLCubeRenderTarget {
  return new WebGLCubeRenderTarget(size, { type: HalfFloatType, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
}

/** Blackbody lookup over log10 T in [2.5, 8]: rgb with luminance 1, a = log10 of the luminance relative to 5772 K. */
function makeLut(): DataTexture {
  const n = 256;
  const data = new Uint16Array(n * 4);
  for (let i = 0; i < n; i++) {
    const T = 10 ** (LUT_LOG_MIN + (LUT_LOG_SPAN * i) / (n - 1));
    const { rgb, relY } = blackbodySurface(T);
    data[i * 4] = DataUtils.toHalfFloat(rgb[0]);
    data[i * 4 + 1] = DataUtils.toHalfFloat(rgb[1]);
    data[i * 4 + 2] = DataUtils.toHalfFloat(rgb[2]);
    data[i * 4 + 3] = DataUtils.toHalfFloat(Math.log10(Math.max(relY, 1e-30)));
  }
  const t = new DataTexture(data, n, 1, RGBAFormat, HalfFloatType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}
