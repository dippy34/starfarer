import {
  AdditiveBlending, AlwaysDepth, BackSide, NeverDepth, ClampToEdgeWrapping, CubeCamera, DataTexture, DataUtils, DoubleSide, FrontSide, Group, HalfFloatType,
  LessEqualDepth, LinearFilter, LinearMipmapLinearFilter, Mesh, NoBlending, type Object3D, OrthographicCamera, type PerspectiveCamera,
  PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, SphereGeometry, Vector2, Vector3, Vector4, WebGLCubeRenderTarget, type WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { blackbodySurface } from '../astro/photometry';
import { AU, SUN_RADIUS } from '../core/units';
import type { UPos } from '../core/upos';
import type { BlackHole } from '../universe/BlackHoles';
import { jetShape, type JetShape } from './Jets';
import { QUALITY } from './Quality';
import { VOLUMES } from './Renderer';
import { BH_FRAG, BH_VERT, MINI_FRAG, MINI_SHOW_FRAG, MINI_SHOW_VERT, MINI_VERT } from './shaders/blackhole';
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
/** the miniature of a disk's middle: its width (pixels of its own), and how many holes can have one at a time */
const MINI_SIZE = 256;
const MINIS = 2;
/**
 * The miniature takes over from the frame's own samples as its window shrinks in the frame: from
 * a half-width of MINI_FROM of the frame's pixels (it then has two pixels to each of the frame's,
 * each way), and wholly by MINI_WHOLLY (four).
 */
const MINI_FROM = MINI_SIZE / 4;
const MINI_WHOLLY = MINI_SIZE / 8;
/** a window of this half-width (the frame's pixels) or less is a point of light; from PICTURE_FROM on, a picture */
const POINT_BELOW = 2;
const PICTURE_FROM = 5;
/** the square a miniature is shown on is never smaller than this (half its width, the frame's pixels): room for a point's skirt */
const SHOW_LEAST = 4;
/** how bright a part of a disk has to be drawn (the display's white is 1) to count as showing at all */
const FAINT = 0.004;
/**
 * The miniature's window: this many radii of the disk's middle, or as much of the disk as shows
 * if that is less; and that much again to spare, plus three Schwarzschild radii, for what the
 * hole's gravity moves outwards in the picture.
 */
const WINDOW_MIDDLES = 3;
const WINDOW_SPARE = 1.2;
/** a miniature is traced from no farther off than this many half-widths of its window (shaders/blackhole.ts: MINI_VERT) */
const EYE_REACHES = 1000;
/** an exposure no scene reaches: a middle with this for its own is drawn like the rest of its disk */
const NO_LIMIT = 1e30;
/** (a hole without jets: no glow to them) */
const NO_JETS = new Vector4(0, 0, 0, 0);

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
  /**
   * The middle of its disk as the eye takes it (Exposure.diskMiddle): its radius (m), and the
   * exposure it is drawn with at the most. The app's to set, each frame (App.updateExposure).
   */
  middle: { radius: number; exposure: number };
}

/** A hole's miniature: the picture, and the square it is shown on. */
interface Miniature { target: WebGLRenderTarget; show: Mesh }

/**
 * Draws black holes: each nearby hole gets a sphere around the region it visibly distorts (or
 * a full-screen sphere when the eye is inside that region) whose shader traces light past it
 * (shaders/blackhole.ts). The undistorted scene behind it comes from two cube maps captured at
 * the eye with the holes hidden, one face per frame: the scene itself (stars, bodies), and in a
 * smaller one the glowing volumes around the eye (a galaxy's light, nebulae, the Milky Way),
 * which the renderer draws in a pass of their own (Renderer: VOLUMES) and which are soft.
 *
 * A disk's middle that the frame's pixels do not resolve is drawn from a miniature: the same
 * tracing, of a window round the hole alone, at a finer scale (`miniatures`). It is all that is
 * drawn of a hole too far off to bend the sky (`far`): a point of light, with the light of its disk.
 */
export class BlackHoleLayer {
  readonly group = new Group();
  /** the holes the explorer has made (src/app/App.ts: syncMadeHoles): drawn as the catalogue's are, wherever the simulation has them */
  readonly made: BlackHole[] = [];
  views: BlackHoleView[] = [];
  /** the holes too far off to bend the sky to speak of, whose disks still show as points of light */
  far: BlackHoleView[] = [];
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
  /** the miniatures, the pass that traces them, and what the last update was given */
  private minis: Miniature[] = [];
  private miniScene = new Scene();
  private miniCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private miniMat: ShaderMaterial;
  private square = new PlaneGeometry(2, 2);
  private pixelAngle = 1e-3;
  private time = 0;
  /** all the light of each hole's disk, as shownAt has it (radiance x m2) */
  private lights = new Map<BlackHole, number>();
  private jets = new Map<BlackHole, JetShape | null>();

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
    this.miniMat = new ShaderMaterial({
      name: 'black-hole-miniature', vertexShader: MINI_VERT, fragmentShader: MINI_FRAG,
      uniforms: {
        ...this.diskUniforms(), uEnv: { value: this.env.texture }, uGlow: { value: this.glow.texture }, uBehind: { value: 0 }, uShare: { value: 1 },
        uAxis: { value: new Vector3(0, 0, -1) }, uSide: { value: new Vector3(1, 0, 0) }, uUp: { value: new Vector3(0, 1, 0) }, uNear: { value: 1 },
      },
      depthTest: false, depthWrite: false, blending: NoBlending,
    });
    const quad = new Mesh(this.square, this.miniMat);
    quad.frustumCulled = false;
    this.miniScene.add(quad);
  }

  /** What the tracing needs to know of a hole and its disk: for the frame's pass and the miniature's alike. */
  private diskUniforms() {
    return {
      uLut: { value: this.lut }, uO: { value: new Vector3() },
      uN: { value: new Vector3(0, 0, 1) }, uE1: { value: new Vector3(1, 0, 0) }, uE2: { value: new Vector3(0, 1, 0) },
      uRin: { value: 3 }, uRout: { value: 0 }, uTmax: { value: 1e4 }, uSunDisk: { value: SUN_DISK }, uExposure: this.exposure,
      uMiddle: { value: new Vector2(1, 1) }, uTime: { value: 0 }, uMaxSteps: { value: 220 }, uStepK: { value: 1 },
      uDiskSeed: { value: 0 }, uSpiral: { value: 0 }, uArms: { value: 2 }, uStreakFreq: { value: 9 }, uAngFreq: { value: 2.2 }, uWarp: { value: 0.5 },
    };
  }

  private material(): ShaderMaterial {
    return new ShaderMaterial({
      name: 'black-hole', vertexShader: BH_VERT, fragmentShader: BH_FRAG,
      uniforms: {
        ...this.diskUniforms(), uEnv: { value: this.env.texture }, uGlow: { value: this.glow.texture }, uRs: { value: 1 },
        uMiniW: { value: new Vector2() }, uMiniX: { value: new Vector3(1, 0, 0) }, uMiniY: { value: new Vector3(0, 1, 0) },
        uJet: { value: NO_JETS }, uJetGlow: { value: NO_JETS }, uJetView: { value: new Vector2() },
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

  private mini(i: number): Miniature {
    while (this.minis.length <= i) {
      const target = new WebGLRenderTarget(MINI_SIZE, MINI_SIZE, {
        type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, depthBuffer: false,
      });
      const show = new Mesh(this.square, new ShaderMaterial({
        name: 'black-hole-miniature-shown', vertexShader: MINI_SHOW_VERT, fragmentShader: MINI_SHOW_FRAG,
        uniforms: {
          uMini: { value: target.texture }, uMiniW: { value: 0 }, uSize: { value: MINI_SIZE }, uPixels: { value: 1 }, uShare: { value: 1 },
          uPoint: { value: 0 }, uReach: { value: 1 }, uClipScale: { value: 1 }, uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK,
        },
        // added over the hole's own picture (which leaves the middle to it), and hidden by whatever is nearer
        transparent: true, blending: AdditiveBlending, depthTest: true, depthWrite: false, side: DoubleSide,
      }));
      show.matrixAutoUpdate = false;
      show.frustumCulled = false;
      show.renderOrder = 30.5;
      show.visible = false;
      show.name = `black-hole-miniature-${this.minis.length}`;
      this.group.add(show);
      this.minis.push({ target, show });
    }
    return this.minis[i];
  }

  /**
   * Meshes to compile the shaders with before they are first needed: a hole seen from outside and
   * from inside the lensing region (the side is part of three's program, so each is its own
   * program), and a miniature as it is shown.
   */
  warmupObjects(): Mesh[] {
    const inside = this.mesh(1);
    const mat = inside.material as ShaderMaterial;
    if (mat.side !== BackSide) { mat.side = BackSide; mat.depthFunc = this.reversedDepth ? NeverDepth : AlwaysDepth; mat.needsUpdate = true; }
    return [this.mesh(0), inside, this.mini(0).show];
  }

  /** Compile the miniature's tracing ahead of its first use. */
  compile(gl: WebGLRenderer): void {
    // (with its own target bound: the program depends on what it is drawn into)
    const prevTarget = gl.getRenderTarget();
    const xrWas = gl.xr.enabled;
    gl.xr.enabled = false;
    gl.setRenderTarget(this.mini(0).target);
    void gl.compileAsync(this.miniScene, this.miniCam).catch(() => undefined);
    gl.xr.enabled = xrWas;
    gl.setRenderTarget(prevTarget);
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

  /**
   * All the light of a hole's disk as shownAt has it, its gas at rest to the eye (radiance x m2:
   * over the eye's distance squared, what reaches the eye from it face on). Summed once, ring by
   * ring in the logarithm of the radius.
   */
  private light(bh: BlackHole): number {
    let sum = this.lights.get(bh);
    if (sum === undefined) {
      const rings = 64, k = Math.log(bh.diskOuter / bh.diskInner) / rings;
      sum = 0;
      for (let i = 0; i < rings; i++) {
        const r = bh.diskInner * Math.exp(k * (i + 0.5));
        sum += 2 * Math.PI * r * r * k * this.shownAt(bh, r, 0);
      }
      this.lights.set(bh, sum);
    }
    return sum;
  }

  /**
   * The mass of `bh` was changed (BlackHole.setFactor: its horizon, its disk's inner edge and a supermassive hole's disk follow): what
   * was worked out from the old ones, the light of its disk and the shape of its jets, is worked out again from the next frame.
   */
  massChanged(bh: BlackHole): void {
    this.lights.delete(bh);
    this.jets.delete(bh);
  }

  /**
   * Choose the holes worth drawing from `cam` and set up their meshes. `faintest`: the least
   * light from a far hole's disk (irradiance at the eye) that is worth a point in the frame.
   */
  update(cam: UPos, pixelAngle: number, time: number, faintest: number): void {
    this.pixelAngle = pixelAngle;
    this.time = time;
    this.moved = !this.lastCam || this.lastCam.sub(cam, new Vector3()).lengthSq() > 1;
    if (this.lastCam) this.lastCam.copy(cam); else this.lastCam = cam.clone();
    const cands: BlackHoleView[] = [], far: BlackHoleView[] = [];
    const rel = new Vector3();
    for (const bh of this.made.length ? [...this.holes, ...this.made] : this.holes) {
      bh.upos.sub(cam, rel);
      const dist = rel.length();
      const rs = bh.radius;
      // beyond ~4/pixelAngle rs the bending (2 rs / b) is under half a pixel
      const regionRs = Math.max(Math.min(Math.max(4 / pixelAngle, 60), 4e5), (bh.diskOuter / rs) * 1.05);
      const region = regionRs * rs;
      const inside = dist < region * 1.05;
      const regionPx = inside ? Infinity : Math.asin(region / dist) / pixelAngle;
      const bends = regionPx >= 1.5;
      if (!bends && !(bh.diskOuter > 0 && this.light(bh) >= faintest * dist * dist)) continue;
      const ang = (r: number) => Math.asin(Math.min(1, r / Math.max(dist, r * 1.0001))) / pixelAngle;
      (bends ? cands : far).push({
        bh, rel: rel.clone(), dist, region, inside,
        shadowPx: ang(2.6 * rs), innerDiskPx: bh.diskOuter > 0 ? ang(Math.min(20 * rs, bh.diskOuter)) : 0,
        diskRadiance: bh.diskOuter > 0 ? SUN_DISK * this.relLuminance(bh.diskTmax) : 0,
        middle: { radius: bh.diskInner, exposure: NO_LIMIT },
      });
    }
    cands.sort((a, b) => a.dist / a.bh.radius - b.dist / b.bh.radius);
    this.views = cands.slice(0, MAX_ACTIVE);
    // (of the far ones, those whose light is strongest here)
    far.sort((a, b) => this.light(b.bh) / (b.dist * b.dist) - this.light(a.bh) / (a.dist * a.dist));
    this.far = far.slice(0, MINIS);
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
      this.describe(u, v);
      u.uRs.value = v.bh.radius;
      u.uEnv.value = this.env.texture;
      u.uGlow.value = this.glow.texture;
      // (its jets are this pass's to draw: Jets.ts)
      let jet = this.jets.get(v.bh);
      if (jet === undefined) this.jets.set(v.bh, jet = jetShape(v.bh));
      u.uJet.value = jet?.shape ?? NO_JETS;
      u.uJetGlow.value = jet?.glow ?? NO_JETS;
      (u.uJetView.value as Vector2).set(time, pixelAngle);
    });
  }

  /** Tell a tracing material which hole it draws, and from where (diskUniforms). */
  private describe(u: ShaderMaterial['uniforms'], v: BlackHoleView): void {
    const bh = v.bh;
    (u.uO.value as Vector3).copy(v.rel).multiplyScalar(-1 / bh.radius);
    const n = bh.diskNormal;
    (u.uN.value as Vector3).copy(n);
    const e1 = new Vector3().crossVectors(n, Math.abs(n.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0)).normalize();
    (u.uE1.value as Vector3).copy(e1);
    (u.uE2.value as Vector3).crossVectors(n, e1);
    u.uRin.value = bh.diskInner / bh.radius;
    u.uRout.value = bh.diskOuter / bh.radius;
    u.uTmax.value = bh.diskTmax;
    const L = bh.diskLook;
    u.uDiskSeed.value = L.seed; u.uSpiral.value = L.spiral; u.uArms.value = L.arms;
    u.uStreakFreq.value = L.streakFreq; u.uAngFreq.value = L.angFreq; u.uWarp.value = L.warp;
    u.uTime.value = this.time;
    u.uMaxSteps.value = this.vr ? 90 : 220;
    u.uStepK.value = this.vr ? 1.5 : 1;
  }

  /**
   * How far out (m) a hole's disk shows at all, drawn as it is: with the scene's exposure, its
   * middle with its own, which lets go outwards as shaders/blackhole.ts has it. Its gas taken as
   * coming straight at the eye: that is the side seen farthest out.
   */
  private shownOut(v: BlackHoleView): number {
    const bh = v.bh, mid = v.middle;
    const drawn = (r: number) => Math.min(this.exposure.value, mid.exposure * Math.max(r / mid.radius, 1) ** 0.75) * this.shownAt(bh, r, 1);
    let lo = bh.diskInner * DISK_PEAK, hi = bh.diskOuter;
    if (drawn(hi) >= FAINT || drawn(lo) < FAINT) return drawn(lo) < FAINT ? lo : hi;
    for (let i = 0; i < 24; i++) {
      const r = Math.sqrt(lo * hi);
      if (drawn(r) >= FAINT) lo = r; else hi = r;
    }
    return hi;
  }

  /**
   * Trace the miniatures: one for each hole whose disk has a middle the frame's pixels do not
   * resolve, the nearer first, as many as there are to go round. To be called once the app has
   * set each view's `middle` and the surroundings are captured (`capture`: a miniature shows them
   * as seen past its hole), before the frame is drawn. The holes' own pictures are told what is
   * left to them of their middles.
   */
  miniatures(gl: WebGLRenderer): void {
    for (const m of this.minis) m.show.visible = false;
    let used = 0;
    const prevTarget = gl.getRenderTarget();
    const xrWas = gl.xr.enabled;
    gl.xr.enabled = false;
    const side = new Vector3(), up = new Vector3(), axis = new Vector3();
    [...this.views, ...this.far].forEach((v, i) => {
      const own = i < this.views.length ? (this.meshes[i].material as ShaderMaterial).uniforms : null;
      const rs = v.bh.radius;
      own?.uMiddle.value.set(v.middle.radius / rs, v.middle.exposure);
      own?.uMiniW.value.set(0, 0);
      if (!(v.bh.diskOuter > 0)) return;
      // the window, and how wide it is in the frame (half its width, in pixels)
      const reach = Math.min(WINDOW_MIDDLES * v.middle.radius, this.shownOut(v)) * WINDOW_SPARE + 3 * rs;
      const tangent = reach / v.dist;
      const pixels = tangent / this.pixelAngle;
      const weight = 1 - smoothstep(MINI_WHOLLY, MINI_FROM, pixels);
      if (weight <= 0 || used >= MINIS) return;
      const mini = this.mini(used++);
      // (its axes lie along and across the disk as seen: they do not turn as the eye looks round)
      axis.copy(v.rel).divideScalar(v.dist);
      side.crossVectors(v.bh.diskNormal, axis);
      if (side.lengthSq() < 1e-12) side.crossVectors(Math.abs(axis.z) < 0.9 ? up.set(0, 0, 1) : up.set(1, 0, 0), axis);
      side.normalize();
      up.crossVectors(axis, side);
      const u = this.miniMat.uniforms;
      this.describe(u, v);
      // (traced from nearer than the eye is, where that is too far off for the shader's numbers)
      const near = Math.min(1, (EYE_REACHES * reach) / v.dist);
      (u.uO.value as Vector3).multiplyScalar(near);
      u.uNear.value = near;
      u.uMiddle.value.set(v.middle.radius / rs, v.middle.exposure);
      const share = ((2 * pixels) / MINI_SIZE) ** 2;
      u.uShare.value = share;
      // What is seen past the hole is the miniature's to show as well, where it shows a picture.
      // A point has no room for it, and a far hole has no picture of its own to take it out of:
      // there the frame keeps it.
      const point = 1 - smoothstep(POINT_BELOW, PICTURE_FROM, pixels);
      const behind = own ? 1 - point : 0;
      u.uBehind.value = behind;
      u.uEnv.value = this.env.texture;
      u.uGlow.value = this.glow.texture;
      (u.uAxis.value as Vector3).copy(axis);
      (u.uSide.value as Vector3).copy(side).multiplyScalar(tangent / near);
      (u.uUp.value as Vector3).copy(up).multiplyScalar(tangent / near);
      gl.setRenderTarget(mini.target);
      gl.render(this.miniScene, this.miniCam);
      if (own) {
        own.uMiniW.value.set(weight, weight * behind);
        (own.uMiniX.value as Vector3).copy(side).divideScalar(tangent);
        (own.uMiniY.value as Vector3).copy(up).divideScalar(tangent);
      }
      // The square it is shown on: in front of the hole's own picture where there is one (that is
      // drawn on a sphere this side of the hole), at the hole's place otherwise.
      const depth = own ? (v.inside ? INSIDE_SPHERE : v.dist - v.region) * 0.99 : v.dist;
      const wide = Math.max(1, SHOW_LEAST / pixels);
      const half = depth * tangent * wide;
      mini.show.matrix.makeBasis(side.multiplyScalar(half), up.multiplyScalar(half), axis);
      mini.show.matrix.setPosition(axis.multiplyScalar(depth));
      mini.show.matrixWorldNeedsUpdate = true;
      mini.show.visible = true;
      const s = (mini.show.material as ShaderMaterial).uniforms;
      s.uMiniW.value = weight;
      s.uPixels.value = pixels;
      s.uShare.value = share;
      s.uPoint.value = point;
      s.uReach.value = wide;
      s.uClipScale.value = 1 / depth;
    });
    gl.xr.enabled = xrWas;
    gl.setRenderTarget(prevTarget);
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

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
