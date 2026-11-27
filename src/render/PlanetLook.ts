import { DoubleSide, Matrix3, type Mesh, ShaderMaterial, Vector3 } from 'three';
import { exoCraterSeed, exoQuantile, exoQuantiles, ROCKY_TYPES } from '../universe/ExoTerrain';
import { hashKey, type PlanetType, rng } from '../universe/Planets';
import { MATERIALS } from './Materials';
import { RING_GLSL } from './shaders/planet';
import { FIX_LOGDEPTH, GLOBALS, LITE, OUTPUT_FRAGMENT, PROJECT_PARS } from './shaders/xr';

/**
 * The generated look of a world: the palette and surface parameters of the made-up planets of other
 * stars (src/render/ExoPlanetLayer.ts), and of the worlds the explorer makes (src/render/Bodies.ts,
 * src/app/WhatIf.ts), both built here, from the world's type and its seed, so that the same type
 * and seed give the same world wherever it is drawn.
 */

/** What a look is made of: the world's type, its seed (any whole number), and the few facts the look is varied by. */
export interface LookSpec {
  /** a name for the seed's random draws: the same key, the same look */
  key: string;
  /** the name the crater field is seeded by */
  name: string;
  type: PlanetType;
  /** equilibrium temperature (K), by which some types choose what they are made of */
  teqK: number;
  seed: number;
  /** mean radius (m) */
  radius: number;
  rings: boolean;
  /** a turn of all its colours round the colour wheel (a share of a whole turn, 0 to 1): a made world's own choice; none for the others */
  hue?: number;
}

/** A look: the shader's uniform values that depend on the world alone, the disk's mean albedo, the type's number and the seed the shader gets. */
export interface Look { pal: Record<string, number | V3>; albedo: number; typeId: number; seed: number }

export const TYPE_ID: Record<PlanetType, number> = { lava: 0, hot: 1, desert: 2, terran: 3, ocean: 4, ice: 5, subneptune: 6, icegiant: 7, giant: 8, hotgiant: 9 };
export type V3 = [number, number, number];

const lum = (c: V3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * A planet's palette and surface parameters, varied by its seed within its type and chosen by its
 * temperature where that changes what it is made of. Colours are linear albedos (what fraction of
 * the starlight the surface reflects), so `albedo` (the disk's mean, for the eye's adaptation)
 * follows from them: lava and hot Jupiters are dark, ice worlds and water-cloud giants bright.
 */
function paletteFor(p: LookSpec): Record<string, number | V3> {
  const t = p.type;
  const T = p.teqK;
  const r = rng(hashKey(p.key + '/look'));
  const jit = (c: V3, k = 0.14): V3 => { const m = 1 + k * (r() - 0.5); return [c[0] * m * (1 + 0.5 * k * (r() - 0.5)), c[1] * m * (1 + 0.5 * k * (r() - 0.5)), c[2] * m * (1 + 0.5 * k * (r() - 0.5))]; };
  const pick = <T,>(a: T[]): T => a[Math.floor(r() * a.length)];
  const base = {
    uSeaLevel: 0, uIceLat: 1.2, uClouds: 0, uAtmo: 0, uBands: 10, uTurb: 0.6, uStorms: 0, uGlow: 0, uCraters: 0,
    uSea: [0.02, 0.06, 0.15] as V3, uAtmoColor: [0.4, 0.6, 1.0] as V3, uC4: [0.5, 0.5, 0.5] as V3,
  };
  const giantLook = (pal: V3[], o: Record<string, number | V3>) => {
    const [c1, c2, c3, c4] = pal.map((c) => jit(c));
    return { ...base, uC1: c1, uC2: c2, uC3: c3, uC4: c4, albedo: 0.5 * (lum(c1) + lum(c2)), ...o };
  };
  switch (t) {
    case 'lava': {
      const c1 = jit([0.035, 0.03, 0.03]);
      return { ...base, uC1: c1, uC2: jit([0.08, 0.065, 0.055]), uC3: [0.12, 0.1, 0.09], uC4: [0.2, 0.18, 0.15], uGlow: Math.min(1.6, Math.max(0.4, (T - 700) / 700)) * (0.8 + 0.4 * r()), albedo: 0.06 };
    }
    case 'hot': {
      const pal = pick<V3[]>([
        [[0.07, 0.065, 0.06], [0.12, 0.11, 0.1], [0.16, 0.15, 0.14]],      // grey, Mercury-like
        [[0.08, 0.06, 0.045], [0.15, 0.12, 0.09], [0.2, 0.17, 0.13]],     // brown
        [[0.09, 0.05, 0.035], [0.17, 0.1, 0.07], [0.22, 0.15, 0.11]],     // iron-red
      ]).map((c) => jit(c));
      return { ...base, uC1: pal[0], uC2: pal[1], uC3: pal[2], uC4: [0.26, 0.25, 0.24], uCraters: 0.6 + 0.4 * r(), uAtmo: r() < 0.2 ? 0.4 : 0, uAtmoColor: [1, 0.8, 0.5], albedo: 0.5 * (lum(pal[0]) + lum(pal[1])) };
    }
    case 'desert': {
      const pal = pick<V3[]>([
        [[0.1, 0.06, 0.04], [0.33, 0.18, 0.09], [0.25, 0.17, 0.12]],     // rust (Mars-like)
        [[0.18, 0.14, 0.1], [0.45, 0.36, 0.24], [0.35, 0.3, 0.24]],      // pale sand
        [[0.15, 0.11, 0.05], [0.42, 0.3, 0.13], [0.3, 0.24, 0.16]],      // ochre
        [[0.1, 0.09, 0.08], [0.28, 0.24, 0.2], [0.22, 0.2, 0.18]],       // grey-brown
      ]).map((c) => jit(c));
      return {
        ...base, uC1: pal[0], uC2: pal[1], uC3: pal[2], uC4: jit([0.5, 0.47, 0.42]), uCraters: 0.3 + 0.5 * r(),
        uAtmo: 0.35, uAtmoColor: [1, 0.78, 0.6], uIceLat: T < 250 ? 0.8 + 0.12 * r() : 1.2, albedo: 0.65 * lum(pal[1]) + 0.35 * lum(pal[0]),
      };
    }
    case 'terran': case 'ocean': {
      // vegetation of other worlds needn't be green, but it stays dark (it absorbs starlight)
      const veg = jit(pick<V3>([
        [0.035, 0.06, 0.025], [0.035, 0.06, 0.025], [0.03, 0.055, 0.025], [0.045, 0.065, 0.03],   // green
        [0.055, 0.06, 0.03], [0.025, 0.05, 0.04],                                                   // olive, teal
        [0.06, 0.032, 0.025], [0.05, 0.032, 0.045], [0.07, 0.06, 0.025],                            // red, purple, ochre
      ]));
      const soil = jit(pick<V3>([[0.42, 0.31, 0.18], [0.36, 0.3, 0.22], [0.45, 0.26, 0.14], [0.4, 0.36, 0.28]]));
      const clouds = t === 'ocean' ? 0.55 + 0.35 * r() : 0.4 + 0.4 * r();
      return {
        ...base, uC1: veg, uC2: soil, uC3: jit([0.17, 0.15, 0.13]), uC4: [0.6, 0.6, 0.6], uSea: jit(pick<V3>([[0.006, 0.018, 0.045], [0.007, 0.022, 0.04], [0.005, 0.015, 0.05]]), 0.3),
        uClouds: clouds, uAtmo: 0.9, uAtmoColor: [0.35, 0.55, 1.0], albedo: 0.07 + 0.3 * clouds,
      };
    }
    case 'ice': {
      const [pal, craters] = pick<[V3[], number]>([
        [[[0.42, 0.3, 0.2], [0.75, 0.72, 0.66], [0.85, 0.85, 0.85], [0.9, 0.92, 0.95]], 0.1],     // Europa-like
        [[[0.6, 0.66, 0.72], [0.88, 0.9, 0.92], [0.95, 0.96, 0.97], [0.95, 0.97, 1]], 0.3],     // fresh ice
        [[[0.12, 0.1, 0.09], [0.35, 0.32, 0.3], [0.55, 0.55, 0.55], [0.7, 0.72, 0.75]], 1],      // old, dirty, cratered
        [[[0.22, 0.11, 0.06], [0.7, 0.62, 0.52], [0.8, 0.78, 0.75], [0.9, 0.88, 0.85]], 0.3],    // tholins
      ]);
      const c = pal.map((x) => jit(x));
      return { ...base, uC1: c[0], uC2: c[1], uC3: c[2], uC4: c[3], uCraters: craters * (0.6 + 0.6 * r()), uAtmo: r() < 0.3 ? 0.3 : 0, uAtmoColor: [0.6, 0.7, 1], albedo: 0.7 * lum(c[1]) + 0.3 * lum(c[0]) };
    }
    case 'subneptune': {
      const pal = T < 250 ? [[0.42, 0.6, 0.68], [0.5, 0.68, 0.74], [0.7, 0.82, 0.86], [0.45, 0.6, 0.7]]
        : T < 600 ? pick<V3[]>([[[0.5, 0.55, 0.62], [0.62, 0.66, 0.7], [0.8, 0.82, 0.85], [0.55, 0.58, 0.62]], [[0.4, 0.5, 0.6], [0.52, 0.6, 0.68], [0.75, 0.8, 0.84], [0.5, 0.55, 0.6]]])
        : pick<V3[]>([[[0.45, 0.36, 0.26], [0.58, 0.48, 0.36], [0.72, 0.64, 0.52], [0.55, 0.4, 0.28]], [[0.36, 0.4, 0.34], [0.48, 0.52, 0.45], [0.66, 0.68, 0.62], [0.45, 0.45, 0.38]]]);
      return giantLook(pal as V3[], { uBands: 4 + 5 * r(), uTurb: 0.15 + 0.15 * r(), uStorms: Math.floor(3 * r()), uAtmo: 0.5, uAtmoColor: [0.6, 0.8, 1.0] });
    }
    case 'icegiant': {
      const pal = T < 120 ? pick<V3[]>([
        [[0.1, 0.22, 0.5], [0.16, 0.32, 0.62], [0.7, 0.8, 0.9], [0.12, 0.25, 0.55]],      // Neptune-like
        [[0.36, 0.56, 0.62], [0.42, 0.64, 0.68], [0.6, 0.78, 0.8], [0.4, 0.6, 0.65]],     // Uranus-like
      ]) : T < 500 ? [[0.25, 0.4, 0.48], [0.32, 0.48, 0.55], [0.65, 0.75, 0.8], [0.3, 0.42, 0.5]]
        : [[0.3, 0.28, 0.27], [0.4, 0.38, 0.36], [0.6, 0.58, 0.55], [0.35, 0.3, 0.28]];   // too warm for methane
      return giantLook(pal as V3[], { uBands: 4 + 4 * r(), uTurb: 0.3 + 0.25 * r(), uStorms: 1 + Math.floor(3 * r()), uAtmo: 0.4, uAtmoColor: [0.5, 0.7, 1.0] });
    }
    case 'giant': {
      // ammonia clouds when cold (Jupiter, Saturn), water clouds when temperate (bright white),
      // cloudless and blue when warmer still
      const JUPITER: V3[] = [[0.36, 0.24, 0.15], [0.66, 0.6, 0.5], [0.8, 0.77, 0.7], [0.6, 0.3, 0.17]];
      const SATURN: V3[] = [[0.5, 0.4, 0.26], [0.66, 0.57, 0.4], [0.75, 0.68, 0.52], [0.62, 0.48, 0.3]];
      const RUDDY: V3[] = [[0.42, 0.3, 0.24], [0.6, 0.5, 0.42], [0.75, 0.7, 0.62], [0.55, 0.28, 0.2]];
      const pal = T < 150 ? pick([JUPITER, JUPITER, SATURN, RUDDY])
        : T < 350 ? [[0.6, 0.6, 0.6], [0.78, 0.78, 0.76], [0.88, 0.88, 0.87], [0.7, 0.65, 0.6]]
        : [[0.12, 0.18, 0.35], [0.18, 0.26, 0.45], [0.35, 0.42, 0.6], [0.2, 0.2, 0.35]];
      const saturn = pal === SATURN;
      return giantLook(pal as V3[], {
        uBands: saturn ? 12 + 6 * r() : 7 + 5 * r(), uTurb: saturn ? 0.25 + 0.15 * r() : T < 150 ? 0.6 + 0.5 * r() : 0.3 + 0.3 * r(),
        uStorms: saturn ? 1 + Math.floor(2 * r()) : 3 + Math.floor(6 * r()), uAtmo: 0.25, uAtmoColor: [0.9, 0.85, 0.8],
      });
    }
    case 'hotgiant': {
      const pal = T > 1800 ? [[0.2, 0.17, 0.15], [0.32, 0.28, 0.24], [0.45, 0.4, 0.35], [0.3, 0.18, 0.12]]   // silicate clouds
        : pick<V3[]>([[[0.03, 0.03, 0.045], [0.06, 0.055, 0.075], [0.12, 0.11, 0.13], [0.1, 0.05, 0.04]], [[0.02, 0.04, 0.09], [0.035, 0.06, 0.13], [0.08, 0.11, 0.2], [0.05, 0.06, 0.12]]]);
      return giantLook(pal as V3[], { uBands: 5 + 5 * r(), uTurb: 0.6 + 0.4 * r(), uStorms: Math.floor(3 * r()), uGlow: Math.min(1.5, Math.max(0.2, (T - 900) / 800)), uAtmo: 0.04, uAtmoColor: [0.6, 0.5, 0.9] });
    }
  }
}

/**
 * The temperature (K) a made world's look is varied by, a typical one for its kind: the generated look chooses some of what a
 * world is made of by it (a lava world's glow, a giant's clouds), and it must come out the same
 * wherever the world is drawn again, so it is not the world's own warmth, which moves with it.
 */
const MADE_TEMPERATURE: Partial<Record<PlanetType, number>> = { terran: 288, ocean: 288, desert: 300, lava: 1500, ice: 80, giant: 120, icegiant: 60 };

/**
 * The generated look of a made world of `kind` with `seed` and mean radius `radius` (m): what it is drawn from (its kind is its
 * type), with a ring if `rings` (the ring does not change the rest of the look: its numbers are drawn either way).
 */
export function madeLook(kind: PlanetType, seed: number, radius: number, rings = false, hue = 0): LookSpec {
  const key = `made/${kind}/${seed}`;
  return { key, name: key, type: kind, teqK: MADE_TEMPERATURE[kind] ?? 288, seed, radius, rings, hue };
}

/**
 * A colour turned `turn` of a whole turn round the colour wheel: rotated about the grey axis
 * (equal red, green and blue), so greys stay grey and a colour keeps about its brightness; none
 * below zero.
 */
export function turnHue(c: V3, turn: number): V3 {
  const a = 2 * Math.PI * turn, cos = Math.cos(a), s = Math.sin(a) / Math.sqrt(3), k = (1 - cos) / 3;
  const d = cos + k, p = k - s, q = k + s;
  return [Math.max(0, d * c[0] + p * c[1] + q * c[2]), Math.max(0, q * c[0] + d * c[1] + p * c[2]), Math.max(0, p * c[0] + q * c[1] + d * c[2])];
}

/** The look of the world `spec` describes (its palette, seas and climate, ring); deterministic in the spec. */
export function generatedLook(spec: LookSpec): Look {
  const pal = paletteFor(spec);
  // (a made world's colours turned as its maker chose: every colour of the palette, the rest of the look as it was)
  if (spec.hue) for (const [k, v] of Object.entries(pal)) if (Array.isArray(v)) pal[k] = turnHue(v, spec.hue);
  const seed = spec.seed % 97;
  // climate and seas: the sea covers the planet's own fraction of the surface
  const rc = rng(hashKey(spec.key + '/climate'));
  const t = spec.type;
  if (t === 'terran' || t === 'ocean') pal.uSeaLevel = exoQuantile(seed, t === 'ocean' ? 0.85 + 0.11 * rc() : 0.4 + 0.35 * rc());
  const [q10, q50, q90] = ROCKY_TYPES.has(TYPE_ID[t]) ? exoQuantiles(seed, [0.1, 0.5, 0.9]) : [0.3, 0.4, 0.5];
  pal.uHMid = q50;
  pal.uHSpan = Math.max(0.02, q90 - q10);
  pal.uTeq = spec.teqK;
  pal.uDry = t === 'ocean' ? 0.1 * rc() : t === 'terran' ? 0.1 + 0.5 * rc() : 1;
  pal.uRelief = Math.min(20e3, spec.radius * 0.002) / spec.radius;
  pal.uRadius = spec.radius;
  pal.uRing = spec.rings ? 1 : 0;
  pal.uRingSeed = spec.seed % 13;
  pal.uRingIn = 1.2 + 0.4 * rc();
  pal.uRingOut = Math.min(2.95, pal.uRingIn + 0.7 + 0.9 * rc());
  const albedo = Number(pal.albedo);
  delete pal.albedo;
  return { pal, albedo, typeId: TYPE_ID[t], seed };
}

/**
 * The uniforms of the material that draws a generated look (EXO_FRAG, over BODY_VERT): the look's
 * own, and the ones the layer sets every frame (the star's direction, colour and light, the turn,
 * the time), at their starting values. `exposure` is the layer's.
 */
export function lookUniforms(spec: LookSpec, look: Look, exposure: { value: number }): Record<string, { value: unknown }> {
  const u: Record<string, { value: unknown }> = {
    uType: { value: look.typeId }, uSeed: { value: look.seed }, uLumpy: { value: 0 }, uClipScale: { value: 1 },
    uSunDir: { value: new Vector3(1, 0, 0) }, uSunColor: { value: new Vector3(1, 1, 1) }, uSunIrr: { value: Math.PI },
    uExposure: exposure, uTime: { value: 0 }, uBodyToWorld: { value: new Matrix3() },
    uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK, uLite: LITE.uLite, uCSeed: { value: exoCraterSeed(spec.name) },
    uTerrain: { value: 0 }, uHScale: { value: 0 }, uCamAlt: { value: 1e9 }, uHoleDir: { value: new Vector3(0, 0, 1) }, uHoleCos: { value: 2 },
    uTerrCube: { value: null }, uBaked: { value: 0 },
    ...MATERIALS, uTanE: { value: new Vector3(1, 0, 0) }, uTanN: { value: new Vector3(0, 1, 0) },
  };
  for (const [k, v] of Object.entries(look.pal)) u[k] = { value: Array.isArray(v) ? new Vector3(...v) : v };
  return u;
}

// The ring of a generated look (`LookSpec.rings`): a flat ring from 1.15 to 3 radii of its planet
// (a RingGeometry in its XY plane, the planet's equator), its own ringlets from the look's
// uRingIn, uRingOut and uRingSeed, lit by the star and shadowed by the planet; drawn by
// ExoPlanetLayer for the made-up planets of other stars and by BodiesLayer for made worlds.
const RING_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PROJECT_PARS}
varying vec2 vXY;
void main() {
  vXY = position.xy;
  gl_Position = projectView(modelViewMatrix * vec4(position, 1.0));
  #include <logdepthbuf_vertex>
${FIX_LOGDEPTH}
}`;
const RING_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uSeed;
uniform float uIn;
uniform float uOut;
uniform float uLight;   // reflected radiance x exposure for a white ring particle
uniform vec3 uSunL;     // star direction in the ring frame
uniform vec3 uCamL;     // camera position in the ring frame (planet radii)
varying vec2 vXY;
${RING_GLSL}
void main() {
  float r = length(vXY);
  float fw = fwidth(r) / (uOut - uIn);
  float dens = ringDensity(r, uSeed, uIn, uOut, fw);
  if (dens <= 0.0) discard;
  float t = (r - uIn) / (uOut - uIn);
  // colour: a little redder and darker inwards, ringlets of slightly different tint
  vec3 col = uColor * mix(vec3(0.82, 0.76, 0.7), vec3(1.0), smoothstep(0.0, 0.6, t)) * (0.85 + 0.3 * ringNoise(t * 57.0, uSeed + 21.0));
  // the planet's shadow (sphere of radius 1 between this point and the star)
  vec3 P = vec3(vXY, 0.0);
  float b = dot(P, uSunL);
  float sh = b < 0.0 ? smoothstep(0.97, 1.03, sqrt(max(dot(P, P) - b * b, 0.0))) : 1.0;
  // lit face, or light diffusing through to the unlit face
  float lit = sign(uSunL.z) == sign(uCamL.z) ? 1.0 : 0.25 * (1.0 - dens);
  float mu0 = abs(uSunL.z);
  float tau = dens * 1.8;
  float refl = (1.0 - exp(-tau / max(mu0, 0.05))) * lit;
  gl_FragColor = vec4(col * uLight * refl * sh, dens * 0.92);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;

/** A ring's inner and outer radius (in its planet's radii) as drawn: the look's ringlets lie within. */
export const RING_SPAN = [1.15, 3.0] as const;

/** The colour of the ring of the look `look` of `spec`: icy when cold (tinted by the planet's own), dark and dusty otherwise. */
export function ringColor(spec: LookSpec, look: Look): V3 {
  const c3 = look.pal.uC3 as V3;
  return spec.teqK < 150 ? [0.62 + 0.15 * c3[0], 0.57 + 0.15 * c3[1], 0.5 + 0.15 * c3[2]] : [0.22, 0.2, 0.19];
}

/** The material of the ring of the look `look` of `spec` (ringColor). */
export function ringMaterial(spec: LookSpec, look: Look, name: string): ShaderMaterial {
  const pal = look.pal, c = ringColor(spec, look);
  return new ShaderMaterial({
    name, vertexShader: RING_VERT, fragmentShader: RING_FRAG,
    uniforms: { uColor: { value: new Vector3(...c) }, uSeed: { value: pal.uRingSeed }, uIn: { value: pal.uRingIn }, uOut: { value: pal.uRingOut },
      uLight: { value: 1 }, uSunL: { value: new Vector3(0, 0, 1) }, uCamL: { value: new Vector3(0, 0, 1) },
      uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK },
    transparent: true, depthWrite: false, side: DoubleSide,
  });
}

/**
 * Light a ring for this frame: `light` is the reflected radiance of a white particle times the
 * exposure; `sun` the direction to its star and `cam` where the eye is (in its planet's radii), both
 * in the ring's own frame (its plane the XY plane).
 */
export function lightRing(ring: Mesh, light: number, sun: Vector3, cam: Vector3): void {
  const u = (ring.material as ShaderMaterial).uniforms;
  u.uLight.value = light;
  (u.uSunL.value as Vector3).copy(sun);
  (u.uCamL.value as Vector3).copy(cam);
}
