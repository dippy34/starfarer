import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CustomBlending, DoubleSide, DynamicDrawUsage, FrontSide, Group,
  LinearFilter, LinearMipmapLinearFilter, Matrix3, Matrix4, Mesh, NoColorSpace, OneFactor,
  OneMinusSrcAlphaFactor, PlaneGeometry, Points, Quaternion, RepeatWrapping, RingGeometry, ShaderMaterial, Texture, Vector4, type WebGLRenderer,
  TextureLoader, Vector3, ClampToEdgeWrapping,
} from 'three';
import { blackbodyRGB, lambertPhase, luminance, sunIrradianceAt } from '../astro/photometry';
import { shadowShare } from '../core/discs';
import { AU, SUN_RADIUS } from '../core/units';
import type { UPos } from '../core/upos';
import type { Body } from '../universe/Body';
import type { SolarSystem } from '../universe/SolarSystem';
import type { AtmosphereSpec } from './Atmospheres';
import type { TileDetail } from './TileDetail';
import { BLOOM } from './shaders/bloom';
import { BODY_FRAG, BODY_VERT, GLARE_FRAG, GLARE_VERT } from './shaders/body';
import { EXO_FRAG } from './shaders/planet';
import { generatedLook, lightRing, lookUniforms, madeLook, RING_SPAN, ringColor, ringMaterial } from './PlanetLook';
import { ExoGround, ROCKY_TYPES } from '../universe/ExoTerrain';
import type { PlanetType } from '../universe/Planets';
import { STAR_FRAG } from './shaders/star';
import { RING_FRAG, RING_VERT } from './shaders/rings';
import { STAR_NEAR, StarCorona } from './StarCorona';
import { RingParticles } from './RingParticles';
import { ringFrame } from '../universe/RingSpot';
import { PlanetTerrain } from './PlanetTerrain';
import type { TerrainCandidate } from './PlanetTerrain';
import { CloudLayer } from './CloudLayer';
import { TerrainSource } from '../universe/Terrain';
import { applyStarLook, hashString, starLook, starLookUniforms, turnShare, type MapRegion, type StarLook } from './StarLook';
import { PSF_FRAGMENT, PSF_UNIFORMS, PSF_VERTEX } from './shaders/psf';
import { MAT, MATERIALS } from './Materials';
import { FIX_LOGDEPTH, GLOBALS, LITE, OUTPUT_FRAGMENT, PROJECT_PARS, POINT_CLIP } from './shaders/xr';
import { loadMap } from './Uploads';

interface MapInfo {
  file: string; channels: string; lonLeft: number; credit: string; width: number; height: number;
  /** the Sun's map: its active regions (pipeline/build_sun_map.py) */
  regions?: MapRegion[];
  /** optional high-resolution tier, loaded only while the body fills a large part of the view */
  hi?: { file: string; width: number; height: number };
  /** a small copy (1,024 x 512), all of the map a world far off keeps (pipeline/build_small_maps.py) */
  small?: { file: string; width: number; height: number };
}
interface TextureManifest {
  maps: Record<string, MapInfo>;
}

/**
 * The big look (the owner's ask, 28 Nov 2026: "dramatically large, but the more accurate the better"). A world smaller
 * on the screen than its least size is drawn at that size, where it really is, lit as it is: a little disc with its own
 * look, not a point of light. Its least size (CSS px, in radius) grows gently with its real size, as its radius to the
 * quarter power: Jupiter BIG_PX, Earth 4.4, the Moon 3.2, Ceres 2.3, Mimas 1.9; a world too small to be round (BIG_LEAST_RADIUS) is
 * drawn as it is, a point of light from afar. It reaches at most
 * BIG_ROOM of the way to what it goes round, so that a moon is not drawn over its planet, nor a planet over its sun;
 * and it is drawn so out in space (from the ground or in a world's orbit the other planets are the points they are).
 * "Real size" in More turns it off (BodiesLayer.bigLook).
 */
const BIG_PX = 8;
const BIG_ROOM = 0.3;
/** worlds smaller than this (m, in radius) are drawn their real size: only round worlds are drawn larger (not the swarms of small moons and asteroids) */
const BIG_LEAST_RADIUS = 180e3;
/** the night side of a world drawn larger than it is: lit by this share of its sunlight from all round, dim, not a black hole in the sky */
const BIG_FILL = 0.06;
const JUPITER_RADIUS = 71492e3;
/** how much a world drawn `scale` times its size has left the eye's exposure to its own (App.updateExposure) */
export const bigShare = (scale: number): number => smoothstep(1, 1.5, scale);

/** pixel radius above which the high-resolution map is wanted, and below which it may be released */
const HI_WANT_PX = 260;
const HI_KEEP_PX = 140;
const HI_RELEASE_S = 20;
const RELIEF_WANT_PX = 40;
/**
 * The map budget. A world keeps only the small copies of its maps (1,024 px wide: some 3 MB on the
 * GPU, where a full 4,096 px map is some 43 MB with its mip levels) until it is FULL_WANT_PX in radius
 * on screen: from there half the small map's width spans the disc and would start to look soft. Its
 * full maps are then loaded, the small ones shown meanwhile; once it has not been that large for
 * FULL_RELEASE_S they are let go again. And never more than FULL_CAP worlds' full maps at once (the
 * world the explorer is at and the two nearest it was at or is coming to): the one wanted longest
 * ago goes first. Before, every world visited kept all its maps for good, and a long tour of many
 * worlds grew the GPU's memory by some 100 to 150 MB a world.
 */
const FULL_WANT_PX = 128;
const FULL_RELEASE_S = 10;
const FULL_CAP = 3;
/**
 * the radiance the eye settles on where a world is seen by its own lights alone (no sun): about
 * that of the Earth's lit lands as BODY_FRAG draws them from afar. With nothing else lit the eye
 * adapts to them: the continents show by their lights, and the cores of the cities (up to 0.02)
 * burn out, as in a long exposure from orbit
 */
const CITY_LIGHT = 1e-4;
/** pixel radius above which the Sun's own map is wanted (smaller, its disk shows none of it) */
const FACE_WANT_PX = 24;

/** Unit sphere in body-fixed coordinates with the texture seam at `lonLeftDeg`. */
export function makeSphere(lonLeftDeg: number, wSeg = 128, hSeg = 64): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const lon0 = (lonLeftDeg * Math.PI) / 180;
  for (let j = 0; j <= hSeg; j++) {
    const v = j / hSeg;
    const lat = Math.PI / 2 - v * Math.PI;
    for (let i = 0; i <= wSeg; i++) {
      const u = i / wSeg;
      const lon = lon0 + u * 2 * Math.PI;
      pos.push(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
      uv.push(u, 1 - v);
    }
  }
  for (let j = 0; j < hSeg; j++) {
    for (let i = 0; i < wSeg; i++) {
      const a = j * (wSeg + 1) + i, b = a + wSeg + 1;
      if (j !== 0) idx.push(a, b, a + 1);
      if (j !== hSeg - 1) idx.push(a + 1, b, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  return g;
}

function makeRing(inner: number, outer: number, seg = 256): BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pos.push(inner * Math.cos(a), inner * Math.sin(a), 0, outer * Math.cos(a), outer * Math.sin(a), 0);
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}

const SPRITE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PROJECT_PARS}
${PSF_UNIFORMS}
attribute float aIrr;     // irradiance at the observer (photometric units)
attribute vec3 aColor;
varying vec3 vColor;
varying float vEnergy;
varying float vRadius;
${PSF_VERTEX}
void main() {
  float energy;
  float radius = psfSetup(aIrr, energy);
  if (radius <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; return; }
  gl_Position = projectView(viewMatrix * vec4(position, 1.0));
  #include <logdepthbuf_vertex>
${FIX_LOGDEPTH}
${POINT_CLIP}
  gl_PointSize = 2.0 * radius * uDpr;
  vRadius = radius; vEnergy = energy; vColor = aColor;
}`;
const SPRITE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${PSF_UNIFORMS}
varying vec3 vColor; varying float vEnergy; varying float vRadius;
${PSF_FRAGMENT}
void main() {
  gl_FragColor = vec4(psfShade(gl_PointCoord, vRadius, vEnergy, vColor), 1.0);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;

/** Per-frame screen information about a body (used by labels, picking, exposure). */
export interface BodyView {
  body: Body;
  rel: Vector3;          // camera-relative position (m)
  dist: number;
  pixelRadius: number;
  irradiance: number;    // at the observer
  apparentMag: number;
  resolved: boolean;
  /** the sun that lights it (the brightest in its sky), or null: there is none, or it is one itself */
  sun: Body | null;
  /** how many times its size it is drawn (the big look: 1, as it is) */
  scale: number;
  /** drawn larger than it is, the most exposure it is shown with (App.updateExposure; Infinity: none of its own) */
  own: number;
}

export class BodiesLayer {
  readonly group = new Group();
  readonly views = new Map<Body, BodyView>();
  private meshes = new Map<Body, Mesh>();
  /** Earth's cloud layer for low flight (render/CloudLayer.ts) */
  clouds: CloudLayer | null = null;
  private rings = new Map<Body, Mesh>();
  private spheres = new Map<number, BufferGeometry>();
  private textures = new Map<string, Promise<{ tex: Texture; meanLum: number }>>();
  private loadedTex = new Map<string, { tex: Texture; meanLum: number }>();
  /** the small copies of the maps (kept), by map key */
  private smallTex = new Map<string, Promise<{ tex: Texture; meanLum: number }>>();
  private smallLoaded = new Map<string, Texture>();
  /** the worlds whose full maps are on the GPU or on their way, and when each was last wanted (s) */
  private fullWanted = new Map<Body, number>();
  private loader = new TextureLoader();
  private hiTex = new Map<string, { tex: Texture | null; lastWanted: number }>();
  private glare: Mesh | null = null;
  private sunCorona: StarCorona | null = null;
  /** each sun's surface look, and how long its surface has been turning at its full rate (s: StarLook.turnShare) */
  private sunLooks = new Map<Body, { look: StarLook; turned: number }>();
  private sunTurn = new Quaternion();
  /**
   * The sun whose corona and glare are drawn (there is one of each): the Sun, or, once the
   * explorer has made another or taken it away, whichever looks largest from the eye (the app
   * says which, each frame).
   */
  chief: Body | null;
  /** camera-facing glare around the Sun (VR only: the desktop path has a bloom pass) */
  glareOn = false;
  /** presenting to a headset (no bloom pass: the glare is all there is) */
  glareVr = false;
  /**
   * How much the Sun is in the frame, 1 to 0 (src/app/Exposure.ts `presence`). Glare is the Sun's
   * light scattered in the eye: with the Sun out of the frame it fades, where it used to stay as a
   * veil over a view the eye had already adapted to the dark for.
   */
  glarePresence = 1;
  /**
   * How much of the frame the Sun's disk takes, for the glare: 0 a small, far Sun (the glare in
   * full), 1 a disk large enough that the eye looks at its surface (no glare: its own corona and
   * the bloom glow round it). From the frame's shape, not from pixels: the same on every screen.
   */
  glareFill = 0;
  /** allow the 8k map tier (off in VR: uploading an 8k texture stalls a headset frame) */
  allowHi = true;
  /** uploads a texture to the GPU now (set by the app: renderer.initTexture) */
  uploader: (tex: Texture) => void = () => undefined;
  /** atmosphere parameters per body (for sunlight transmitted to the surface) */
  atmosphere: (b: Body) => AtmosphereSpec | null = () => null;
  private sprites: Points;
  private spritePos: Float32Array;
  private spriteIrr: Float32Array;
  private spriteCol: Float32Array;
  private sunColor: [number, number, number];
  private ringTex: Texture | null = null;
  private time = 0;
  readonly maxSprites: number;
  /** exposure for resolved surfaces (point sprites use the shared PSF exposure) */
  readonly surfaceExposure = { value: 1 };
  /** each world's own exposure: the surfaces', or, drawn larger than it is, no more than its own (`expose`) */
  private exposures = new Map<Body, { value: number }>();
  /** the big look on (far worlds drawn at a least size: BIG_PX); off, every world is drawn its real size */
  bigLook = true;
  /** render pixels to a CSS pixel (set by the app each frame) */
  pixelRatio = 1;
  /**
   * The exposure a sun's own face is drawn with (its corona and its glare too): the surfaces',
   * or less while a sun's disc is in view, which is held at the level a sun is shown at whatever
   * the worlds beside it need. Shared with the other stars' discs (NearStars).
   */
  readonly lightExposure = { value: 1 };
  /** the ice particles around the explorer inside Saturn's rings */
  ringParticles: RingParticles | null = null;
  private ringParticlesBody: Body | null = null;
  /** heights for the landing terrain of solid worlds */
  readonly terrainSource: TerrainSource;

  constructor(
    private system: SolarSystem,
    private manifest: TextureManifest,
    private texBase: string,
    private psf: Record<string, { value: number }>,
    private rings_: Record<string, { innerKm: number; outerKm: number; texture: string }>,
  ) {
    this.group.name = 'bodies';
    this.terrainSource = new TerrainSource(texBase.replace(/\/textures$/, ''));
    this.chief = system.sun;
    const sc = blackbodyRGB(system.sun.teff);
    const L = luminance(sc);
    this.sunColor = [sc[0] / L, sc[1] / L, sc[2] / L];
    this.maxSprites = system.bodies.length + 64;
    const geo = new BufferGeometry();
    this.spritePos = new Float32Array(this.maxSprites * 3);
    this.spriteIrr = new Float32Array(this.maxSprites);
    this.spriteCol = new Float32Array(this.maxSprites * 3);
    geo.setAttribute('position', new BufferAttribute(this.spritePos, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('aIrr', new BufferAttribute(this.spriteIrr, 1).setUsage(DynamicDrawUsage));
    geo.setAttribute('aColor', new BufferAttribute(this.spriteCol, 3).setUsage(DynamicDrawUsage));
    this.sprites = new Points(geo, new ShaderMaterial({
      vertexShader: SPRITE_VERT, fragmentShader: SPRITE_FRAG, uniforms: { ...psf },
      transparent: true, depthWrite: false, depthTest: true, blending: AdditiveBlending,
    }));
    this.sprites.frustumCulled = false;
    this.sprites.renderOrder = 10;
    this.group.add(this.sprites);
  }

  private sphere(lonLeft: number): BufferGeometry {
    let g = this.spheres.get(lonLeft);
    if (!g) {
      g = makeSphere(lonLeft);
      this.spheres.set(lonLeft, g);
    }
    return g;
  }

  private texture(key: string): Promise<{ tex: Texture; meanLum: number }> {
    let p = this.textures.get(key);
    if (!p) {
      const info = this.manifest.maps[key];
      const url = `${this.texBase}/${info ? info.file : key}`;
      // decoded off the main thread and uploaded in budgeted strips (Uploads.ts)
      p = loadMap(url, { lum: true, setup: (tex) => {
        tex.wrapS = RepeatWrapping;
        tex.wrapT = ClampToEdgeWrapping;
        tex.minFilter = LinearMipmapLinearFilter;
        tex.magFilter = LinearFilter;
        tex.anisotropy = 8;
        // We decode sRGB ourselves in the shader to keep full control over albedo scaling.
        tex.colorSpace = '';
      } }).then((v) => {
        this.loadedTex.set(key, v);
        return v;
      });
      this.textures.set(key, p);
    }
    return p;
  }

  /** A map's small copy (or the map itself where it has none), kept for good: what a world far off is drawn with. */
  private smallMap(key: string): Promise<{ tex: Texture; meanLum: number }> {
    const info = this.manifest.maps[key];
    if (!info?.small) return this.texture(key);
    let p = this.smallTex.get(key);
    if (!p) {
      const data = info.channels.startsWith('relief');
      p = loadMap(`${this.texBase}/${info.small.file}`, { lum: !data, setup: (tex) => {
        tex.wrapS = RepeatWrapping;
        tex.wrapT = ClampToEdgeWrapping;
        tex.minFilter = LinearMipmapLinearFilter;
        tex.magFilter = LinearFilter;
        tex.anisotropy = data ? 4 : 8;
        tex.colorSpace = data ? NoColorSpace : '';
      } }).then((v) => {
        this.smallLoaded.set(key, v.tex);
        return v;
      });
      this.smallTex.set(key, p);
    }
    return p;
  }

  /** The keys of a world's maps that the budget holds (its colour map, relief, and the Earth's night and clouds). */
  private fullKeys(b: Body): string[] {
    const out: string[] = [];
    const key = b.kind === 'star' ? null : this.textureKey(b);
    if (key && this.manifest.maps[key]?.small) out.push(key);
    const rk = this.reliefKey(b);
    if (rk && this.manifest.maps[rk]?.small) out.push(rk);
    if (b.name === 'Earth') for (const k of ['earth_night', 'earth_clouds']) if (this.manifest.maps[k]?.small) out.push(k);
    return out;
  }

  /** A world's full maps are wanted now: loaded if they are not. */
  private wantFull(b: Body, now: number): void {
    const was = this.fullWanted.has(b);
    this.fullWanted.set(b, now);
    if (was) return;
    for (const k of this.fullKeys(b)) {
      const relief = k === this.reliefKey(b);
      (relief ? this.reliefFull(k) : this.texture(k)).then(() => {
        // (let go of again before it came)
        if (!this.fullWanted.has(b)) this.releaseKey(k);
      }).catch((err) => console.warn('map failed', k, err));
    }
  }

  /**
   * A flight is on its way to this world: its full maps are wanted for as long as it is (counting
   * against FULL_CAP as any other world's). Wanted once at takeoff only, a flight of more than
   * FULL_RELEASE_S let them go before it arrived, and the world was drawn close up with its small
   * copies while they came again (the Earth's four maps: some 9 s).
   */
  keepWanted(b: Body): void {
    if (b.valid && b.kind !== 'star') this.wantFull(b, performance.now() / 1000);
  }

  /** A relief map, full size (data, not colour). */
  private reliefFull(rk: string): Promise<{ tex: Texture; meanLum: number }> {
    let p = this.textures.get(rk);
    if (!p) {
      p = this.loadData(rk).then((tex) => {
        const v = { tex, meanLum: 0 };
        this.loadedTex.set(rk, v);
        return v;
      });
      this.textures.set(rk, p);
    }
    return p;
  }

  /** A full map let go: whatever showed it shows the small copy, and it leaves the GPU. */
  private releaseKey(key: string): void {
    const v = this.loadedTex.get(key);
    this.textures.delete(key);
    this.loadedTex.delete(key);
    if (!v) return;
    const small = this.smallLoaded.get(key) ?? null;
    for (const m of this.meshes.values()) {
      const u = (m.material as ShaderMaterial).uniforms;
      for (const f of ['uMap', 'uNight', 'uClouds', 'uRelief']) if (u[f]?.value === v.tex) u[f].value = small;
    }
    if (this.clouds && key === 'earth_clouds' && small) this.clouds.setMap(small);
    const img = v.tex.image as ImageBitmap | undefined;
    v.tex.dispose();
    img?.close?.();
  }

  /** Let go of the full maps of the worlds not wanted for a while, and of all but FULL_CAP. */
  private releaseFull(now: number): void {
    const order = [...this.fullWanted].sort((p, q) => q[1] - p[1]);
    order.forEach(([b, at], k) => {
      if (k < FULL_CAP && now - at < FULL_RELEASE_S) return;
      this.fullWanted.delete(b);
      for (const key of this.fullKeys(b)) this.releaseKey(key);
    });
  }

  /** For tests and diagnostics: which of its colour map a world is drawn with now. */
  mapTier(b: Body): 'none' | 'small' | 'full' | 'hi' {
    const m = this.meshes.get(b);
    const key = this.textureKey(b);
    if (!m || !key) return 'none';
    const t = (m.material as ShaderMaterial).uniforms.uMap.value;
    if (!t) return 'none';
    if (t === this.hiTex.get(key)?.tex) return 'hi';
    if (t === this.loadedTex.get(key)?.tex) return 'full';
    return 'small';
  }

  /** For tests and diagnostics: the worlds whose full maps are kept. */
  get fullResident(): string[] {
    return [...this.fullWanted.keys()].map((b) => b.name);
  }

  /** map key for a body: its catalogue texture, or a map named after it (e.g. the OPAL giant-planet maps) */
  textureKey(b: Body): string | null {
    if (b.noMap) return null;
    if (b.texture) return b.texture;
    const k = b.name.toLowerCase();
    return this.manifest.maps[k] ? k : null;
  }

  private reliefKey(b: Body): string | null {
    const k = `${b.name.toLowerCase()}_relief`;
    return this.manifest.maps[k] ? k : null;
  }

  private loadData(key: string): Promise<Texture> {
    const info = this.manifest.maps[key];
    return loadMap(`${this.texBase}/${info.file}`, { setup: (tex) => {
      tex.colorSpace = NoColorSpace;
      tex.wrapS = RepeatWrapping;
      tex.wrapT = ClampToEdgeWrapping;
      tex.minFilter = LinearMipmapLinearFilter;
      tex.magFilter = LinearFilter;
      tex.anisotropy = 4;
    } }).then((v) => v.tex);
  }

  /** The high-resolution tier of `key` if loaded; starts loading it (decoded off the main thread). */
  private wantHi(key: string, now: number): Texture | null {
    const info = this.manifest.maps[key];
    if (!info?.hi) return null;
    let e = this.hiTex.get(key);
    if (!e) {
      e = { tex: null, lastWanted: now };
      this.hiTex.set(key, e);
      const entry = e;
      loadMap(`${this.texBase}/${info.hi.file}`, { setup: (tex) => {
        tex.colorSpace = '';
        tex.wrapS = RepeatWrapping;
        tex.wrapT = ClampToEdgeWrapping;
        tex.minFilter = LinearMipmapLinearFilter;
        tex.magFilter = LinearFilter;
        tex.anisotropy = 8;
      } }).then(({ tex }) => {
        if (this.hiTex.get(key) !== entry) { tex.dispose(); return; }
        entry.tex = tex;
      }).catch((err) => console.warn('high-resolution map failed', key, err));
    }
    e.lastWanted = now;
    return e.tex;
  }

  private releaseHi(now: number): void {
    for (const [key, e] of this.hiTex) {
      if (now - e.lastWanted < HI_RELEASE_S) continue;
      if (e.tex) {
        // (whatever showed it shows the map below it: no material keeps a texture that has left the GPU)
        const below = this.loadedTex.get(key)?.tex ?? this.smallLoaded.get(key) ?? null;
        for (const m of this.meshes.values()) {
          const u = (m.material as ShaderMaterial).uniforms;
          if (u.uMap?.value === e.tex) u.uMap.value = below;
        }
        const img = e.tex.image as ImageBitmap | undefined;
        e.tex.dispose();
        img?.close?.();
      }
      this.hiTex.delete(key);
    }
  }

  /**
   * Get a body ready before the camera arrives: create its materials and load and upload its
   * maps now, so nothing stalls a frame when it fills the view.
   */
  prefetch(b: Body): void {
    if (!b.valid) return;
    const mesh = this.meshes.get(b) ?? this.createMesh(b);
    mesh.visible = false;
    const key = this.textureKey(b);
    const tasks: Promise<unknown>[] = [];
    if (key && b.kind === 'star') this.requestFace(key, (mesh.material as ShaderMaterial).uniforms);
    // (the camera is on its way: the full maps, under the budget)
    else this.wantFull(b, performance.now() / 1000);
    // (each map is complete on the GPU when its promise resolves)
    for (const t of tasks) t.catch(() => undefined);
  }

  /** How strongly the Sun's glare is drawn now (0: not at all); for tests and diagnostics. */
  get glareLevel(): number {
    return this.glare?.visible ? ((this.glare.material as ShaderMaterial).uniforms.uIntensity.value as number) : 0;
  }

  /**
   * How bright a world's own lights are (radiance: 1 is a white surface in sunlight at 1 AU), for
   * the eye when no sun lights the world: the Earth's cities, shown as on its night side. 0 for a
   * world without lights of its own.
   */
  ownLight(b: Body): number {
    const m = this.meshes.get(b);
    return m && ((m.material as ShaderMaterial).uniforms.uHasNight?.value as number) > 0.5 ? CITY_LIGHT : 0;
  }

  /**
   * A body's rings, for what is drawn after them (its atmosphere shell): their opacity profile (null
   * until the rings are first drawn) and their inner and outer radius in equatorial radii. null if
   * it has none.
   */
  ringsOf(b: Body): { tex: Texture | null; inner: number; outer: number } | null {
    const ring = this.rings_[b.name.toLowerCase()];
    if (!ring) return null;
    const req = b.radii[0];
    return { tex: this.rings.has(b) ? this.ringTex : null, inner: (ring.innerKm * 1e3) / req, outer: (ring.outerKm * 1e3) / req };
  }

  /**
   * A body's colour map as its surface is drawn, the scale that brings the map's colours to the
   * body's albedo, and its cloud map if it has one; null until the map has loaded, or for one without a map. (Earth for scale wears
   * the Earth's: render/ScaleCues.ts.)
   */
  surfaceMap(b: Body): { tex: Texture; albedoScale: number; clouds: Texture | null } | null {
    const m = this.meshes.get(b);
    const u = m && (m.material as ShaderMaterial).uniforms;
    if (!u || !u.uHasMap || (u.uHasMap.value as number) < 0.5 || !u.uMap.value) return null;
    const clouds = (u.uHasClouds?.value as number) > 0.5 ? (u.uClouds.value as Texture) : null;
    return { tex: u.uMap.value as Texture, albedoScale: u.uAlbedoScale.value as number, clouds };
  }

  /** The outer radius of a body's rings (m); 0 if it has none. */
  ringOuter(b: Body): number {
    const made = this.lookedRings.get(b);
    if (made) return ((made.material as ShaderMaterial).uniforms.uOut.value as number) * b.radius;
    return (this.rings_[b.name.toLowerCase()]?.outerKm ?? 0) * 1e3;
  }

  /** Create one of every kind of body material (planet, rings, star, glare) for shader warm-up. */
  warmupObjects(): Mesh[] {
    const out: Mesh[] = [];
    const sat = this.system.bodies.find((b) => b.name === 'Saturn');
    const earth = this.system.bodies.find((b) => b.name === 'Earth');
    for (const b of [this.system.sun, sat, earth]) {
      if (!b) continue;
      const m = this.meshes.get(b) ?? this.createMesh(b);
      out.push(m);
      const r = this.rings.get(b);
      if (r) out.push(r);
    }
    if (this.glare) out.push(this.glare);
    if (this.sunCorona) out.push(this.sunCorona.mesh);
    if (this.ringParticles) out.push(this.ringParticles.mesh, this.ringParticles.slab);
    if (this.clouds) out.push(this.clouds.mesh);
    return out;
  }

  /** the worlds the explorer made with a generated look (src/app/WhatIf.ts): drawn from the look of their type and seed, with no map */
  private looked = new Set<Body>();
  /** the rings of those that have them (PlanetLook.ts: the made-up planets of other stars' rings) */
  private lookedRings = new Map<Body, Mesh>();
  private lookRingGeo: RingGeometry | null = null;

  /** The type, seed, rings and colour turn of the generated look a body wears (what it was made as), or null: it has a map, or a look of its own, as the catalogue's bodies do. */
  lookOf(b: Body): { type: PlanetType; seed: number; rings: boolean; hue: number } | null {
    const as = b.meta.madeAs as { kind: string; seed?: number; rings?: boolean; hue?: number } | undefined;
    return as && as.seed !== undefined ? { type: as.kind as PlanetType, seed: as.seed, rings: !!as.rings, hue: as.hue ?? 0 } : null;
  }

  /**
   * A made world's colours turned anew (its `madeAs.hue` changed: the Colour slider): its material's colours, and its
   * ring's, set in place, as the slider moves (a new material at every step would be built and compiled again).
   */
  recolour(b: Body): void {
    const mesh = this.meshes.get(b), wears = this.lookOf(b);
    if (!mesh || !wears || !this.looked.has(b)) return;
    const spec = madeLook(wears.type, wears.seed, b.radius, wears.rings, wears.hue), look = generatedLook(spec);
    const u = (mesh.material as ShaderMaterial).uniforms;
    for (const [k, v] of Object.entries(look.pal)) if (Array.isArray(v) && u[k]) (u[k].value as Vector3).set(v[0], v[1], v[2]);
    const ring = this.lookedRings.get(b);
    if (ring) (ring.material as ShaderMaterial).uniforms.uColor.value.set(...ringColor(spec, look));
  }

  /** The mesh of a world made with a generated look: the material of the made-up planets of other stars (src/render/ExoPlanetLayer.ts), from the same look (PlanetLook.ts), and its ring if it has one. */
  private createLooked(b: Body, type: PlanetType, seed: number, rings: boolean, hue: number): Mesh {
    const spec = madeLook(type, seed, b.radius, rings, hue), look = generatedLook(spec);
    const mat = new ShaderMaterial({ name: 'generated-look', vertexShader: BODY_VERT, fragmentShader: EXO_FRAG, uniforms: { ...lookUniforms(spec, look, this.exposureOf(b)), uFill: { value: 0 } } });
    const mesh = new Mesh(this.sphere(-180), mat);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.name = b.name;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    this.meshes.set(b, mesh);
    this.looked.add(b);
    if (rings) {
      this.lookRingGeo ??= new RingGeometry(RING_SPAN[0], RING_SPAN[1], 256, 1);
      const ring = new Mesh(this.lookRingGeo, ringMaterial(spec, look, 'generated-ring'));
      ring.matrixAutoUpdate = false;
      ring.frustumCulled = false;
      ring.name = `${b.name} rings`;
      ring.renderOrder = 3;
      this.group.add(ring);
      this.lookedRings.set(b, ring);
    }
    return mesh;
  }

  /** What a generated look needs of its sun and of where it is, each frame (the made-up planets of other stars have it set in ExoPlanetLayer.update). */
  private shineLooked(b: Body, u: Record<string, { value: unknown }>, view: BodyView, sunRel: Vector3 | null, sunLight: number, rot3: Matrix3): void {
    rot3.setFromMatrix4(b.orientation);
    (u.uBodyToWorld.value as Matrix3).copy(rot3);
    u.uTime.value = this.time;
    u.uCamAlt.value = view.dist - b.radius;
    // (its size follows its mass while it is made: the relief is a share of the radius)
    u.uRadius.value = b.radius;
    u.uRelief.value = Math.min(20e3, b.radius * 0.002) / b.radius;
    if (sunRel) {
      const toSun = new Vector3().copy(sunRel).sub(view.rel), rSun = toSun.length();
      (u.uSunDir.value as Vector3).copy(toSun).divideScalar(rSun);
      u.uSunIrr.value = sunIrradianceAt(rSun, sunLight);
    } else u.uSunIrr.value = 0;
    const ring = this.lookedRings.get(b);
    if (ring) {
      // in its equator's plane (the body's XY plane), lit and seen in that frame, in the planet's radii (as drawn)
      const r = b.radius * view.scale;
      ring.visible = true;
      ring.matrix.copy(b.orientation).scale(new Vector3(r, r, r)).setPosition(view.rel);
      ring.matrixWorldNeedsUpdate = true;
      const inv = rot3.clone().transpose();
      lightRing(ring, ((u.uSunIrr.value as number) / Math.PI) * this.exposureOf(b).value,
        new Vector3().copy(u.uSunDir.value as Vector3).applyMatrix3(inv), new Vector3().copy(view.rel).negate().divideScalar(r).applyMatrix3(inv));
    }
  }

  private createMesh(b: Body): Mesh {
    const wears = this.lookOf(b);
    if (wears) return this.createLooked(b, wears.type, wears.seed, wears.rings, wears.hue);
    const texKey = this.textureKey(b);
    const mapInfo = texKey ? this.manifest.maps[texKey] : undefined;
    const isStar = b.kind === 'star';
    // (a sun the explorer has made is the Sun over again, with a surface of its own)
    const look = isStar ? starLook(b.name.toLowerCase(), b.teff, 1, 4.83, mapInfo?.regions ?? true) : null;
    if (look) this.sunLooks.set(b, { look, turned: 0 });
    const mat = new ShaderMaterial({
      name: isStar ? 'sun-surface' : 'body',
      vertexShader: BODY_VERT,
      fragmentShader: isStar ? STAR_FRAG : BODY_FRAG,
      // Earth's cloud code is compiled into Earth's program only (BODY_FRAG: #ifdef CLOUDS)
      defines: !isStar && b.name === 'Earth' ? { CLOUDS: 1 } : {},
      uniforms: {
        uMap: { value: null }, uHasMap: { value: 0 }, uMapGray: { value: mapInfo?.channels === 'L' ? 1 : 0 },
        uNight: { value: null }, uHasNight: { value: 0 },
        uClouds: { value: null }, uHasClouds: { value: 0 }, uCloudShift: { value: 0 }, uCloudVis: { value: 1 },
        uColor: { value: new Vector3(...b.color) },
        uAlbedoScale: { value: 1 },
        uAirless: { value: b.isAirless ? 1 : 0 },
        uBands: { value: !texKey && (b.isGasGiant || b.name === 'Venus') ? 1 : 0 }, uGiant: { value: b.isGasGiant ? 1 : 0 },
        uRelief: { value: null }, uHasRelief: { value: 0 }, uWater: { value: 0 },
        uAtmo: { value: 0 }, uRp: { value: b.radii[0] }, uBetaR: { value: new Vector3() }, uHR: { value: 8000 },
        uBetaMe: { value: new Vector3() }, uHM: { value: 1200 },
        uSeed: { value: hashString(b.name) * 500 },
        uProc: { value: 0 }, uIcy: { value: 0 }, uTint: { value: new Vector3(1, 1, 1) }, uCraters: { value: 0 },
        uLumpy: { value: 0 }, uRadiusM: { value: b.radius }, uMapW: { value: 0 }, uClipScale: { value: 1 },
        uDetail: { value: null }, uDetailRect: { value: new Vector4(0, 0, 1, 1) }, uDetailOn: { value: 0 }, uLite: LITE.uLite,
        ...MATERIALS, uMatSel: { value: new Vector4(MAT.regolith, MAT.regolithPocked, MAT.cliff, MAT.snow) }, uMatMode: { value: 0 },
        uTanE: { value: new Vector3(1, 0, 0) }, uTanN: { value: new Vector3(0, 1, 0) },
        uTerrain: { value: 0 }, uHScale: { value: 0 }, uHoleDir: { value: new Vector3(0, 0, 1) }, uHoleCos: { value: 2 },
        uSunDir: { value: new Vector3(1, 0, 0) },
        uSunIrr: { value: Math.PI },
        uSunColor: { value: new Vector3(...this.sunColor) },
        uExposure: isStar ? this.lightExposure : this.exposureOf(b), uFill: { value: 0 },
        uBodyToWorld: { value: new Matrix3() },
        uBodyCenter: { value: new Vector3() },
        uOcc: { value: [new Vector4(), new Vector4(), new Vector4(), new Vector4()] }, uOccRed: { value: new Vector4() }, uOccN: { value: 0 },
        uSunRel: { value: new Vector3() }, uSunR: { value: SUN_RADIUS },
        uHasRings: { value: 0 }, uRingTex: { value: null }, uRingRadii: { value: new Vector3() },
        uRadiance: { value: 1 }, uTime: { value: 0 },
        ...(look ? { ...starLookUniforms(look), ...BLOOM, uPixelSA: this.psf.uPixelSA, uDpr: this.psf.uDpr } : {}),
        uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK,
      },
      side: FrontSide,
    });
    const mesh = new Mesh(this.sphere(mapInfo?.lonLeft ?? -180), mat);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.name = b.name;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    this.meshes.set(b, mesh);

    const u = mat.uniforms;
    if (isStar) {
      // Mean disk radiance: solar irradiance at 1 AU / solid angle of the solar disk at 1 AU.
      u.uRadiance.value = (AU / SUN_RADIUS) ** 2;
    } else {
      const geomAlbedo = b.meta.albedo as number | undefined;
      const known = geomAlbedo !== undefined;
      const lambertRho = Math.min(1, 1.5 * b.albedo);
      this.surfaceLook(b, u, texKey, mapInfo?.width ?? 0);
      if (texKey) {
        // (the small copy first, and its mean for the albedo: the full map comes when the world is near)
        this.smallMap(texKey).then(({ tex, meanLum }) => {
          if (!u.uMap.value) u.uMap.value = tex;
          u.uHasMap.value = 1;
          u.uAlbedoScale.value = known ? lambertRho / Math.max(meanLum, 1e-3) : 1;
        });
      } else {
        u.uAlbedoScale.value = lambertRho / Math.max(luminance(b.color), 1e-3);
      }
      if (b.name === 'Earth') {
        this.smallMap('earth_night').then(({ tex }) => { if (!u.uNight.value) u.uNight.value = tex; u.uHasNight.value = 1; });
        // (the layer exists before its map loads, so the shader warm-up compiles it)
        const clouds = new CloudLayer(null, this.surfaceExposure);
        this.clouds = clouds;
        this.group.add(clouds.mesh);
        this.smallMap('earth_clouds').then(({ tex }) => {
          if (!u.uClouds.value) { u.uClouds.value = tex; clouds.setMap(tex); }
          u.uHasClouds.value = 1;
        });
      }
      const ring = this.rings_[b.name.toLowerCase()];
      if (ring) this.createRings(b, ring, u);
      const atmo = this.atmosphere(b);
      if (atmo?.surfaceTransmittance) {
        u.uAtmo.value = 1;
        u.uBetaR.value.set(...atmo.betaR);
        u.uHR.value = atmo.HR;
        u.uBetaMe.value.set(...atmo.betaMe);
        u.uHM.value = atmo.HM;
      }
    }
    if (isStar && !this.sunCorona) {
      this.createGlare(b);
      this.sunCorona = new StarCorona();
      this.group.add(this.sunCorona.mesh);
    }
    return mesh;
  }

  /**
   * Every solid body gets its own look: bodies without a map a seeded procedural surface (crater
   * fields at three scales, two-tone terrain, bright fresh ejecta, cracks on ices) coloured by type,
   * small ones an irregular shape, and mapped bodies fine crater detail below the map's resolution.
   */
  private surfaceLook(b: Body, u: Record<string, { value: unknown }>, texKey: string | null, mapWidth: number): void {
    const h = (k: string) => hashString(b.name + k);
    // ground materials up close (render/Materials.ts)
    const sel = u.uMatSel.value as Vector4;
    if (b.nature === 'Earth') { sel.set(MAT.drySoil, MAT.forest, MAT.cliff, MAT.snow); u.uMatMode.value = 1; }
    else if (b.nature === 'Mars') { sel.set(MAT.drySoil, MAT.sand, MAT.cliff, MAT.snow); u.uMatMode.value = 2; }
    else if (b.nature === 'Venus' || b.nature === 'Io') { sel.set(MAT.rockGround, MAT.drySoil, MAT.cliff, MAT.snow); u.uMatMode.value = 0; }
    else if (b.albedo > 0.45 || (b.kind !== 'planet' && b.pos.length() > 4.5 * AU && b.meta.albedo === undefined)) { sel.set(MAT.snow, MAT.snow, MAT.cliff, MAT.snow); u.uMatMode.value = 3; }
    else { sel.set(MAT.regolith, MAT.regolithPocked, MAT.cliff, MAT.snow); u.uMatMode.value = 0; }
    const solid = !b.isGasGiant && b.kind !== 'star' && !['Venus', 'Earth', 'Titan'].includes(b.nature);
    if (!solid) return;
    const R = b.radius;
    u.uLumpy.value = (R < 20e3 ? 0.22 : R < 80e3 ? 0.14 : R < 200e3 ? 0.07 : 0) * (texKey ? 0.4 : 1) * (0.7 + 0.6 * h('l'));
    // geologically young surfaces have few craters
    const young = ['Io', 'Europa', 'Enceladus', 'Triton'].includes(b.name);
    // bright, frost-covered dwarf planets (Eris, Makemake) look smooth
    const frosty = (b.kind === 'tno' || b.kind === 'dwarf') && b.meta.albedo !== undefined && b.albedo > 0.6;
    u.uCraters.value = young ? 0.15 : frosty ? 0.2 : b.kind === 'tno' ? 0.55 : 0.85 + 0.15 * h('c');
    if (texKey) {
      u.uMapW.value = young ? 0 : mapWidth;
      return;
    }
    u.uProc.value = 1;
    // ice or rock: from the measured albedo when there is one, otherwise by distance from the Sun
    // (moons beyond Jupiter's orbit are icy)
    const measured = b.meta.albedo !== undefined;
    const outer = b.pos.length() > 4.5 * AU;
    const a = measured ? b.albedo : outer ? 0.6 : b.albedo;
    const icy = a > 0.45 ? 1 : a > 0.3 ? 0.5 : 0;
    u.uIcy.value = icy;
    // colour by kind of surface, with a per-body variation (the data has albedos, rarely colours)
    const vary = (c: [number, number, number], k: number): [number, number, number] =>
      [c[0] * (1 + k * (h('r') - 0.5)), c[1] * (1 + k * (h('g') - 0.5)), c[2] * (1 + k * (h('b') - 0.5))];
    const hasColour = b.color.some((v, i) => Math.abs(v - [0.6, 0.6, 0.6][i]) > 1e-3);
    let base: [number, number, number];
    let tint: [number, number, number];
    if (b.kind === 'tno') {
      // Kuiper-belt objects range from neutral grey to very red (tholins)
      const red = h('red');
      base = vary([1.0, 0.82 - 0.25 * red, 0.68 - 0.35 * red], 0.15);
      tint = [0.85 + 0.3 * h('t'), 0.75, 0.65];
    } else if (icy >= 1) {
      base = vary([0.93, 0.95, 0.98], 0.08);
      tint = [0.8, 0.86, 0.95];
    } else if (a < 0.1) {
      base = vary([0.42, 0.4, 0.38], 0.15); // carbonaceous
      tint = [0.75, 0.68, 0.6];
    } else {
      base = vary([0.85, 0.76, 0.66], 0.2); // stony
      tint = [0.9, 0.85, 0.8];
    }
    if (hasColour) base = [b.color[0], b.color[1], b.color[2]];
    (u.uColor.value as Vector3).set(...base);
    (u.uTint.value as Vector3).set(...tint);
    b.color = base;
  }

  private createGlare(b: Body): void {
    if (this.glare) return;
    const c = blackbodyRGB(b.teff);
    const L = luminance(c);
    const mat = new ShaderMaterial({
      vertexShader: GLARE_VERT, fragmentShader: GLARE_FRAG,
      uniforms: { uColor: { value: new Vector3(c[0] / L, c[1] / L, c[2] / L) }, uIntensity: { value: 1 }, uDiskFrac: { value: 0.1 },
        uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.glare = new Mesh(new PlaneGeometry(2, 2), mat);
    this.glare.matrixAutoUpdate = false;
    this.glare.frustumCulled = false;
    this.glare.renderOrder = 15;
    this.glare.visible = false;
    this.group.add(this.glare);
  }

  private createRings(b: Body, ring: { innerKm: number; outerKm: number; texture: string }, planetUniforms: Record<string, { value: unknown }>): void {
    const req = b.radii[0];
    const inner = (ring.innerKm * 1e3) / req, outer = (ring.outerKm * 1e3) / req;
    if (!this.ringTex) {
      this.ringTex = this.loader.load(`${this.texBase}/${ring.texture}`);
      this.ringTex.minFilter = LinearMipmapLinearFilter;
      this.ringTex.magFilter = LinearFilter;
      this.ringTex.wrapS = ClampToEdgeWrapping;
    }
    planetUniforms.uHasRings.value = 1;
    planetUniforms.uRingTex.value = this.ringTex;
    (planetUniforms.uRingRadii.value as Vector3).set(inner, outer, 0);
    const mat = new ShaderMaterial({
      vertexShader: RING_VERT, fragmentShader: RING_FRAG,
      uniforms: {
        uRingTex: { value: this.ringTex }, uRingRadii: { value: new Vector3(inner, outer, 0) },
        uColor: { value: new Vector3(...b.color) }, uSunDirBF: { value: new Vector3() }, uViewDirBF: { value: new Vector3() },
        uSunIrr: { value: Math.PI }, uExposure: this.exposureOf(b), uPlanetRadius: { value: 1 }, uPolar: { value: b.radii[2] / b.radii[0] },
        uCamBF: { value: new Vector3() }, uReqKm: { value: req / 1e3 }, uShine: { value: 0.02 },
        uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK,
      },
      transparent: true, depthWrite: false, side: DoubleSide,
      blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
    });
    const mesh = new Mesh(makeRing(inner, outer), mat);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.group.add(mesh);
    this.rings.set(b, mesh);
    if (!this.ringParticles) {
      this.ringParticles = new RingParticles(`${this.texBase}/${ring.texture}`, ring.innerKm * 1e3, ring.outerKm * 1e3, [0.75, 0.68, 0.58], this.surfaceExposure);
      this.ringParticlesBody = b;
      this.group.add(this.ringParticles.mesh, this.ringParticles.slab);
    }
  }

  /**
   * Update all body transforms for the camera at `cam`.
   * `pixelAngle`: radians per pixel; `exposure`: current pre-exposure.
   */
  update(cam: UPos, pixelAngle: number, dt: number, viewQuat?: Quaternion): void {
    this.time += dt;
    if (this.clouds) this.clouds.mesh.visible = false;   // shown again below while Earth is near
    const now = performance.now() / 1000;
    // each sun from the eye
    const suns = this.system.suns;
    for (let k = 0; k < suns.length; k++) suns[k].upos.sub(cam, this.sunRels[k] ??= new Vector3());
    const home = this.bigLook ? this.homeOf(cam) : null;
    let n = 0;
    const m4 = new Matrix4();
    const rot3 = new Matrix3();
    const tmp = new Vector3();
    for (const b of this.system.bodies) {
      if (!b.valid) {
        // (no position at this date)
        this.views.delete(b);
        const m = this.meshes.get(b);
        if (m) m.visible = false;
        const ring = this.rings.get(b) ?? this.lookedRings.get(b);
        if (ring) ring.visible = false;
        if (this.ringParticles && b === this.ringParticlesBody) this.ringParticles.update(null, b.orientation, b.radius, new Vector3(), 0);
        continue;
      }
      const view = this.views.get(b) ?? { body: b, rel: new Vector3(), dist: 0, pixelRadius: 0, irradiance: 0, apparentMag: 99, resolved: false, sun: null, scale: 1, own: Infinity };
      b.upos.sub(cam, view.rel);
      const dist = view.rel.length();
      view.dist = dist;
      const ang = b.radius / Math.max(dist, b.radius * 1.0001);
      view.pixelRadius = Math.asin(Math.min(1, ang)) / pixelAngle;
      // Irradiance at the observer: a sun's own light, or what a world reflects of its sun's (none in the dark)
      let irr = 0;
      let color: [number, number, number];
      const sun = b.kind === 'star' ? null : this.system.sunAt(b.pos);
      const sunRel = sun ? this.sunRels[suns.indexOf(sun)] : null;
      const sunLight = sun ? this.system.brightness(sun) : 0;
      view.sun = sun;
      if (b.kind === 'star') {
        irr = sunIrradianceAt(Math.max(dist, b.radius), this.system.brightness(b));
        color = this.sunColor;
      } else {
        if (sunRel) {
          const toSun = tmp.copy(sunRel).sub(view.rel);
          const rSun = toSun.length();
          const cosPhase = toSun.dot(view.rel) / (rSun * dist) * -1;
          const phase = Math.acos(Math.max(-1, Math.min(1, cosPhase)));
          irr = sunIrradianceAt(rSun, sunLight) * b.albedo * (b.radius / Math.max(dist, b.radius)) ** 2 * lambertPhase(phase);
        }
        color = b.color;
      }
      view.irradiance = irr;
      view.apparentMag = irr > 0 ? -26.74 - 2.5 * Math.log10(irr / Math.PI) : 99;
      view.scale = this.bigScale(b, view.pixelRadius, home);
      view.resolved = view.pixelRadius * view.scale > 0.6;
      this.views.set(b, view);
      // (a black hole of your own gives no light and is no ball: BlackHoleLayer draws its shadow and the sky bent round it)
      if ((b.meta.madeAs as { kind?: string } | undefined)?.kind === 'hole') {
        const m = this.meshes.get(b);
        if (m) m.visible = false;
        continue;
      }

      // Point sprite (fades out as the disk becomes resolved)
      const fade = 1 - smoothstep(0.6, 1.8, view.pixelRadius * view.scale);
      if (fade > 0 && n < this.maxSprites) {
        this.spritePos[n * 3] = view.rel.x; this.spritePos[n * 3 + 1] = view.rel.y; this.spritePos[n * 3 + 2] = view.rel.z;
        this.spriteIrr[n] = irr * fade;
        this.spriteCol[n * 3] = color[0]; this.spriteCol[n * 3 + 1] = color[1]; this.spriteCol[n * 3 + 2] = color[2];
        n++;
      }

      // Resolved mesh
      let mesh = this.meshes.get(b);
      if (view.resolved) {
        mesh = mesh ?? this.createMesh(b);
        mesh.visible = true;
        const k = view.scale;
        m4.copy(b.orientation).scale(tmp.set(b.radii[0] * k, b.radii[1] * k, b.radii[2] * k)).setPosition(view.rel);
        mesh.matrix.copy(m4);
        mesh.matrixWorldNeedsUpdate = true;
        const u = (mesh.material as ShaderMaterial).uniforms;
        if (u.uFill) u.uFill.value = BIG_FILL * bigShare(k);
        if (this.looked.has(b)) { this.shineLooked(b, u, view, sunRel, sunLight, rot3); continue; }
        this.updateMaps(b, u, view.pixelRadius, now);
        rot3.setFromMatrix4(b.orientation);
        u.uBodyToWorld.value.copy(rot3);
        u.uBodyCenter.value.copy(view.rel);
        u.uTime.value = this.time;
        const star = this.sunLooks.get(b);
        if (star) {
          u.uClipScale.value = Math.min(1, STAR_NEAR / Math.max(view.rel.length(), 1));
          star.turned += dt * turnShare(star.look, b.radius, view.rel.length(), Math.sqrt(this.psf.uPixelSA.value));
          applyStarLook(u, star.look, this.time, star.turned);
        }
        if (sunRel) {
          const toSun = tmp.copy(sunRel).sub(view.rel);
          const rSun = toSun.length();
          u.uSunDir.value.copy(toSun).divideScalar(rSun);
          u.uSunIrr.value = sunIrradianceAt(rSun, sunLight);
        } else if (b.kind !== 'star') u.uSunIrr.value = 0;
        // the cloud layer is painted on the surface: close up it would lie on the mountains, so it
        // fades out on descent, between 150 and 50 km up (no cloud layer to fly through yet)
        if (u.uHasClouds.value) {
          const t = Math.min(1, Math.max(0, (view.dist - b.radius - 50e3) / 100e3));
          u.uCloudVis.value = t * t * (3 - 2 * t);
          // ... and the cloud layer at cloud height takes over on the way down, clearing again below
          // 12-30 km so that mountains and canyons up close are not hidden under a blurry deck
          const camBF = view.rel.clone().negate().applyMatrix3(rot3.clone().transpose());
          const altE = camBF.length() - TerrainSource.baseRadius(b, camBF.normalize());   // above the ellipsoid
          const low = Math.min(1, Math.max(0, (altE - 12e3) / 18e3));
          this.clouds?.update(view.rel, b.orientation, b.radii[0], b.radii[2], u.uSunDir.value as Vector3, u.uSunIrr.value as number,
            u.uSunColor.value as Vector3, (1 - (u.uCloudVis.value as number)) * low * low * (3 - 2 * low), u.uCloudShift.value as number);
        }
        const ring = this.rings.get(b);
        if (ring) {
          ring.visible = true;
          ring.matrix.copy(b.orientation).scale(tmp.set(b.radii[0] * k, b.radii[0] * k, b.radii[0] * k)).setPosition(view.rel);
          ring.matrixWorldNeedsUpdate = true;
          const ru = (ring.material as ShaderMaterial).uniforms;
          const inv = rot3.clone().transpose();
          ru.uSunDirBF.value.copy(u.uSunDir.value).applyMatrix3(inv);
          ru.uViewDirBF.value.copy(view.rel).negate().normalize().applyMatrix3(inv);
          ru.uCamBF.value.copy(view.rel).negate().applyMatrix3(inv).divideScalar(b.radii[0] * k);
          ru.uSunIrr.value = u.uSunIrr.value;
        }
        if (this.ringParticles && b === this.ringParticlesBody) {
          this.ringParticles.update(view.rel, ringFrame(b.orientation), b.radius, u.uSunDir.value as Vector3, u.uSunIrr.value as number);
          // within reach of the ring layer the slab draws the whole ring (as a medium)
          if (ring && this.ringParticles.slabActive) ring.visible = false;
        }
      } else if (mesh) {
        mesh.visible = false;
        const ring = this.rings.get(b) ?? this.lookedRings.get(b);
        if (ring) ring.visible = false;
        if (this.ringParticles && b === this.ringParticlesBody) this.ringParticles.update(null, b.orientation, b.radius, new Vector3(), 0);
      }
      // Saturn's rings are much larger than the planet: keep them visible when they span pixels
      const ringMesh = this.rings.get(b);
      if (ringMesh && !view.resolved) ringMesh.visible = false;
    }
    this.updateEclipses();
    this.updateGlare(viewQuat);
    this.releaseHi(now);
    this.releaseFull(now);
    this.sprites.geometry.setDrawRange(0, n);
    (this.sprites.geometry.attributes.position as BufferAttribute).needsUpdate = true;
    (this.sprites.geometry.attributes.aIrr as BufferAttribute).needsUpdate = true;
    (this.sprites.geometry.attributes.aColor as BufferAttribute).needsUpdate = true;
  }

  /**
   * The list of bodies has changed (the explorer has made a moon, or taken one away:
   * src/app/WhatIf.ts): `gone` leaves the scene, and what can cast a shadow is listed afresh.
   */
  /**
   * The planet (or dwarf, or world made round a sun) whose reach the eye is in, and how far out of it the eye is: 0
   * well inside it (on its ground, in its orbit, among its moons), 1 at its edge. Null in open space.
   */
  private homeOf(cam: UPos): { planet: Body; out: number } | null {
    const rel = new Vector3();
    for (const b of this.system.bodies) {
      if (!b.valid || b.kind === 'star' || (b.parent && b.parent.kind !== 'star')) continue;
      const soi = b.soiRadius(), d = b.upos.sub(cam, rel).length();
      if (d < soi) return { planet: b, out: smoothstep(0.3, 1, d / soi) };
    }
    return null;
  }

  /**
   * How many times its size a world is drawn (the big look: BIG_PX). 1, as it is, unless it is smaller on the
   * screen than its least size. From inside a planet's reach only its own family is drawn so: the other planets come in
   * as the eye leaves the reach, and in open space all of them.
   */
  private bigScale(b: Body, pixelRadius: number, home: { planet: Body; out: number } | null): number {
    if (!this.bigLook || b.kind === 'star' || b.kind === 'comet' || b.radius < BIG_LEAST_RADIUS || (b.meta.madeAs as { kind?: string } | undefined)?.kind === 'hole') return 1;
    let least = BIG_PX * Math.pow(b.radius / JUPITER_RADIUS, 0.25) * this.pixelRatio;
    if (home && familyOf(b) !== home.planet) least *= home.out;
    if (pixelRadius >= least) return 1;
    const host = b.parent ?? this.system.sunAt(b.pos);
    const room = host && host !== b ? (BIG_ROOM * b.pos.distanceTo(host.pos)) / b.radius : Infinity;
    return Math.max(1, Math.min(least / Math.max(pixelRadius, 1e-12), room));
  }

  /** A world's own exposure uniform (its surface, its ring): the surfaces' to begin with. */
  private exposureOf(b: Body): { value: number } {
    let e = this.exposures.get(b);
    if (!e) this.exposures.set(b, (e = { value: this.surfaceExposure.value }));
    return e;
  }

  /**
   * Each world's exposure this frame, once the app has set the surfaces' (`surfaceExposure`) and each view's `own`:
   * the surfaces', and no more than its own while it is drawn larger than it is.
   */
  expose(): void {
    const x = this.surfaceExposure.value;
    for (const [b, e] of this.exposures) {
      const v = this.views.get(b);
      e.value = v && v.scale > 1 ? Math.min(x, v.own) : x;
    }
  }

  changed(gone?: Body): void {
    this.occluders = null;
    if (!gone) return;
    const m = this.meshes.get(gone);
    if (m) {
      this.group.remove(m);
      this.faceRequested.delete((m.material as ShaderMaterial).uniforms);
      (m.material as ShaderMaterial).dispose();
      this.meshes.delete(gone);
    }
    this.views.delete(gone);
    this.exposures.delete(gone);
    this.lookedGrounds.delete(gone);
    this.sunlit.delete(gone);
    this.sunLooks.delete(gone);
    this.looked.delete(gone);
    const ring = this.lookedRings.get(gone);
    if (ring) {
      this.group.remove(ring);
      (ring.material as ShaderMaterial).dispose();
      this.lookedRings.delete(gone);
    }
  }

  private occluders: Body[] | null = null;
  /** each sun's place from the eye this frame, in the order of `SolarSystem.suns` */
  private sunRels: Vector3[] = [];
  /**
   * How much of its sunlight each body's sunlit face gets this frame (eclipses), for the eye's
   * adaptation: all of it but the share in another body's shadow (core/discs.ts: shadowShare),
   * with the reddened light that reaches into a planet's shadow.
   */
  readonly sunlit = new Map<Body, number>();

  /** Does some body's shadow fall on `b` this frame? */
  eclipsed(b: Body): boolean {
    const m = this.meshes.get(b);
    return !!m && ((m.material as ShaderMaterial).uniforms.uOccN?.value as number) > 0;
  }
  /**
   * Eclipses: for each resolved body, up to four bodies that can stand between it and its sun
   * this frame (moons on their planet, the planet on its moons, moons on each other). In the dark
   * nothing casts a shadow.
   */
  private updateEclipses(): void {
    this.occluders ??= this.system.bodies.filter((o) => o.kind !== 'star' && o.radius > 50e3);
    const toSun = new Vector3(), v = new Vector3();
    const suns = this.system.suns;
    for (const view of this.views.values()) {
      const b = view.body;
      const mesh = this.meshes.get(b);
      if (!view.resolved || !mesh || b.kind === 'star') continue;
      const u = (mesh.material as ShaderMaterial).uniforms;
      if (!u.uOcc) continue;
      if (!view.sun) {
        this.sunlit.set(b, 1);
        u.uOccN.value = 0;
        continue;
      }
      const sunRel = this.sunRels[suns.indexOf(view.sun)];
      toSun.copy(sunRel).sub(view.rel);
      const dS = toSun.length();
      toSun.divideScalar(dS);
      const penumbra = SUN_RADIUS / dS;
      const occ = u.uOcc.value as Vector4[];
      const red = u.uOccRed.value as Vector4;
      let n = 0;
      let vis = 1, glow = 0;
      for (const o of this.occluders) {
        if (o === b || !o.valid) continue;
        const ov = this.views.get(o);
        if (!ov) continue;
        v.copy(ov.rel).sub(view.rel);                 // body -> occluder
        const along = v.dot(toSun);
        if (along <= 0 || along >= dS) continue;
        const perp = Math.sqrt(Math.max(0, v.lengthSq() - along * along));
        if (perp > o.radius + b.radius + along * penumbra * 1.05) continue;
        occ[n].set(ov.rel.x, ov.rel.y, ov.rel.z, o.radius);
        const reddens = this.atmosphere(o)?.surfaceTransmittance ? 1 : 0;
        red.setComponent(n, reddens);
        // for the eye's adaptation: the share of the body's sunlit face in this shadow
        const f = shadowShare(b.radius, o.radius, perp, along, penumbra);
        vis *= 1 - f;
        glow = Math.max(glow, f * reddens);
        if (++n === 4) break;
      }
      this.sunlit.set(b, Math.max(vis, glow * 0.004));
      u.uOccN.value = n;
      (u.uSunRel.value as Vector3).copy(sunRel);
    }
  }

  /** Can the body have landing terrain? Solid, round (not lumpy) and without a thick atmosphere. */
  private terrainOk(b: Body): boolean {
    if (b.kind === 'star' || b.isGasGiant || ['Venus', 'Titan'].includes(b.name) || b.radius < 150e3) return false;
    // (a world the explorer made: ground of its own look, generated as a planet of another star's is, if its type is solid)
    if (this.looked.has(b)) return this.lookedGround(b) !== null;
    const m = this.meshes.get(b);
    return !!m && ((m.material as ShaderMaterial).uniforms.uLumpy.value as number) === 0;
  }

  /** Whether `b` has ground to land and walk on (drawn as landing terrain when the eye comes down to it). */
  canLand(b: Body): boolean {
    return this.terrainOk(b);
  }

  /** a made world's ground, by what it was made as (made again when its look, or its size, changes) */
  private lookedGrounds = new Map<Body, { key: string; ground: ExoGround | null }>();

  /**
   * The ground of a world the explorer made with a generated look (src/render/PlanetLook.ts): the heights a planet of another
   * star of that look has (src/universe/ExoTerrain.ts, the shader's terrain function), its seas flat at their level. Null for a
   * look with no solid ground (a gas or ice giant).
   */
  private lookedGround(b: Body): ExoGround | null {
    const w = this.lookOf(b);
    if (!w) return null;
    const key = `${w.type}/${w.seed}/${b.radius}`;
    const had = this.lookedGrounds.get(b);
    if (had?.key === key) return had.ground;
    const look = generatedLook(madeLook(w.type, w.seed, b.radius, w.rings, w.hue)), pal = look.pal;
    const ground = ROCKY_TYPES.has(look.typeId)
      ? new ExoGround(b, look.typeId, look.seed, Number(pal.uSeaLevel ?? 0), Number(pal.uCraters ?? 0), Number(pal.uHMid), Number(pal.uHSpan)) : null;
    this.lookedGrounds.set(b, { key, ground });
    return ground;
  }

  /** The nearest solid world that could have landing terrain, if one is close. */
  terrainCandidate(): TerrainCandidate | null {
    let best: BodyView | null = null;
    let bestAlt = Infinity;
    for (const v of this.views.values()) {
      if (!v.resolved) continue;
      const alt = v.dist - v.body.radius;
      if (alt < bestAlt && alt < PlanetTerrain.reach(v.body) && this.terrainOk(v.body)) { bestAlt = alt; best = v; }
    }
    if (!best) return null;
    const b = best.body;
    const material = this.meshes.get(b)!.material as ShaderMaterial;
    const sunBF = (material.uniforms.uSunDir.value as Vector3).clone().applyMatrix3(new Matrix3().setFromMatrix4(b.orientation).transpose());
    const made = this.looked.has(b) ? this.lookedGround(b) : null;
    if (made) return { ground: made, material, upos: b.upos, rel: best.rel.clone(), orient: b.orientation, lonLeft: -180, sunBF, alt: bestAlt };
    this.terrainSource.craters.set(b, material.uniforms.uCraters.value as number);
    const key = this.textureKey(b);
    return { ground: this.terrainSource.ground(b), material, upos: b.upos, rel: best.rel.clone(), orient: b.orientation, lonLeft: key ? this.manifest.maps[key]?.lonLeft ?? -180 : -180, sunBF, alt: bestAlt };
  }

  private detailBody: Body | null = null;
  /**
   * Close-up tiles for the body that fills most of the view (if its map has a tile pyramid).
   * `viewDir`: world direction of the view's centre.
   */
  updateDetail(gl: WebGLRenderer, detail: TileDetail, pixelAngle: number, viewDir: Vector3): void {
    let best: BodyView | null = null;
    for (const v of this.views.values()) {
      if (!v.resolved || v.pixelRadius < 300) continue;
      const key = this.textureKey(v.body);
      if (!key || !detail.has(key)) continue;
      if (!best || v.pixelRadius > best.pixelRadius) best = v;
    }
    let on = false;
    if (best) {
      const b = best.body;
      const mesh = this.meshes.get(b);
      const u = mesh ? (mesh.material as ShaderMaterial).uniforms : null;
      const key = this.textureKey(b)!;
      if (u && u.uHasMap.value === 1) {
        const toBody = new Matrix3().copy(u.uBodyToWorld.value as Matrix3).transpose();
        const camBF = best.rel.clone().negate().applyMatrix3(toBody);
        const dirBF = viewDir.clone().applyMatrix3(toBody).normalize();
        on = detail.update(gl, key, u.uMap.value as Texture, b.radius, camBF, dirBF, pixelAngle, this.manifest.maps[key].lonLeft);
        if (on) {
          u.uDetail.value = detail.binding.texture;
          (u.uDetailRect.value as Vector4).copy(detail.binding.rect);
          u.uDetailOn.value = 1;
          if ((u.uMapW.value as number) > 0) u.uMapW.value = detail.binding.mapWidth;
        }
      }
    }
    const prev = this.detailBody;
    this.detailBody = on ? best!.body : null;
    if (prev && prev !== this.detailBody) {
      const m = this.meshes.get(prev);
      if (m) {
        const u = (m.material as ShaderMaterial).uniforms;
        u.uDetailOn.value = 0;
        const key = this.textureKey(prev);
        if (key && (u.uMapW.value as number) > 0) u.uMapW.value = this.hiTex.has(key) ? this.manifest.maps[key].hi?.width ?? this.manifest.maps[key].width : this.manifest.maps[key].width;
      }
    }
  }

  /** Swap in the high-resolution map and the relief map when the body is large on screen. */
  private updateMaps(b: Body, u: Record<string, { value: unknown }>, pixelRadius: number, now: number): void {
    const key = this.textureKey(b);
    if (b.kind === 'star') {
      if (key && pixelRadius > FACE_WANT_PX) this.requestFace(key, u);
      return;
    }
    if (pixelRadius > FULL_WANT_PX) this.wantFull(b, now);
    if (key) {
      const info = this.manifest.maps[key];
      const entry = this.hiTex.get(key);
      const want = info?.hi && this.allowHi && (pixelRadius > HI_WANT_PX || (entry !== undefined && pixelRadius > HI_KEEP_PX));
      const hi = want ? this.wantHi(key, now) : null;
      const full = this.loadedTex.get(key)?.tex ?? null;
      const tex = hi ?? full ?? this.smallLoaded.get(key) ?? null;
      if (tex && u.uMap.value !== tex) {
        u.uMap.value = tex;
        // close-up detail is scaled to the map in use
        if ((u.uMapW.value as number) > 0) u.uMapW.value = hi ? info.hi!.width : full ? info.width : info.small?.width ?? info.width;
      }
    }
    if (b.name === 'Earth') {
      for (const [k, f] of [['earth_night', 'uNight'], ['earth_clouds', 'uClouds']] as const) {
        const t = this.loadedTex.get(k)?.tex ?? this.smallLoaded.get(k) ?? null;
        if (t && u[f].value !== t) {
          u[f].value = t;
          if (f === 'uClouds') this.clouds?.setMap(t);
        }
      }
    }
    const rk = this.reliefKey(b);
    if (rk && pixelRadius > RELIEF_WANT_PX) {
      const full = this.loadedTex.get(rk)?.tex ?? null;
      if (!full && !this.manifest.maps[rk].small) this.reliefFull(rk);
      else if (!this.smallLoaded.has(rk)) void this.smallMap(rk).catch((err) => console.warn('relief map failed', rk, err));
      const t = full ?? this.smallLoaded.get(rk) ?? null;
      if (t && u.uRelief.value !== t) {
        u.uRelief.value = t;
        u.uHasRelief.value = 1;
        u.uWater.value = this.manifest.maps[rk].channels === 'relief+water' ? 1 : 0;
      }
    }
  }


  /** A sun's own face, once for each: drawn (STAR_FRAG) from when its map is on the GPU; without it the face is the generated one. */
  private requestFace(key: string, u: Record<string, { value: unknown }>): void {
    if (this.faceRequested.has(u)) return;
    this.faceRequested.add(u);
    this.texture(key).then(({ tex }) => {
      u.uMap.value = tex;
      u.uHasMap.value = 1;
    }).catch((err) => console.warn('the Sun\'s map failed', err));
  }
  private faceRequested = new Set<Record<string, { value: unknown }>>();

  /** VR: glare quad around the resolved Sun, facing the viewer; and the Sun's corona. (Of the suns, `chief`.) */
  private updateGlare(viewQuat?: Quaternion): void {
    const sun = this.chief, v = sun ? this.views.get(sun) : undefined, star = sun ? this.sunLooks.get(sun) : undefined;
    if (this.sunCorona) {
      if (sun && v && star && v.resolved && v.pixelRadius > 1.5 && viewQuat) {
        this.sunCorona.update({ rel: v.rel, radius: sun.radius, turn: this.sunTurn.setFromRotationMatrix(sun.orientation), look: star.look },
          viewQuat, Math.sqrt(this.psf.uPixelSA.value), this.lightExposure.value * (AU / SUN_RADIUS) ** 2, this.time, star.turned);
      } else this.sunCorona.hide();
    }
    const g = this.glare;
    if (!g) return;
    // (also while the Sun is only a few pixels across: that is when glare matters most; up close,
    // with the disk filling much of the view, the eye looks at the surface and the glare fades)
    const fill = v ? this.glareFill : 1;
    g.visible = this.glareOn && !!v && !!viewQuat && v.pixelRadius > 0.3 && fill < 0.999 && this.glarePresence > 0;
    if (!g.visible || !sun || !v || !viewQuat) return;
    const angR = Math.asin(Math.min(1, sun.radius / Math.max(v.dist, sun.radius * 1.0001)));
    const halfAng = Math.min(1.2, Math.max(angR * 14, (10 * Math.PI) / 180));
    const half = Math.tan(halfAng) * v.dist;
    const u = (g.material as ShaderMaterial).uniforms;
    // the disk's visible edge in the quad's plane (through the centre), as a fraction of the quad
    u.uDiskFrac.value = Math.min(0.9, Math.tan(angR) / Math.tan(halfAng));
    // the disk is shown at ~2.5 (eye adaptation caps it); scale the glare with it
    const diskDisplay = this.lightExposure.value * (AU / SUN_RADIUS) ** 2;
    // (a smaller, farther Sun scatters less light into the eye: weaker glare from the outer planets,
    // where its point image with its halo and spikes takes over)
    const far = Math.min(1, angR / (SUN_RADIUS / AU));
    u.uIntensity.value = (this.glareVr ? 0.9 : 0.8) * Math.min(1, diskDisplay / 2.5) * (1 - fill) * far * this.glarePresence;
    // drawn on a scaled-down copy 1e4 km from the eye (same directions and angular size): triangles
    // ~1e10 m across come out garbled in some rasterisers (as StarCorona does)
    const k = Math.min(1, 1e7 / Math.max(v.dist, 1));
    g.matrix.compose(v.rel.clone().multiplyScalar(k), viewQuat, new Vector3(half * k, half * k, half * k));
    g.matrixWorldNeedsUpdate = true;
  }
}

/** The planet (or dwarf, or world round a sun) a world belongs to: itself, or what its parents go round a sun. */
function familyOf(b: Body): Body {
  let f = b;
  while (f.parent && f.parent.kind !== 'star') f = f.parent;
  return f;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

