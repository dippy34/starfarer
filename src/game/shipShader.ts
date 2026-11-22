import {
  AdditiveBlending, DataTexture, FrontSide, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, ShaderMaterial,
  type Side, UnsignedByteType, Vector3,
} from 'three';
import { FIX_LOGDEPTH, GLOBALS, OUTPUT_FRAGMENT, PROJECT_PARS } from '../render/shaders/xr';
import { SHADOW, SHADOW_GLSL } from './shipShadow';

/**
 * The light the ship and the cockpit are lit by, set every frame by `ShipLight.ts`: the star the
 * app lights everything with (its direction, colour, strength, apparent size; dimmed when a world
 * eclipses it) and the world nearby, whose sunlit face lights the side turned to it (Earthshine:
 * real light, not an ambient term). Display-referred, as the ship always was: a white surface
 * square to the star at 1 AU is shown at `KEY` (a camera exposing for the close-up), whatever the
 * eye's adaptation to the sky.
 */
export const SHIP_LIGHT = {
  uSunDir: { value: new Vector3(1, 0.4, 0.2).normalize() },
  /** strength 0..1.3 (log of the star's irradiance), times the share of its disc not eclipsed */
  uSun: { value: 1 },
  uSunColor: { value: new Vector3(1, 0.97, 0.92) },
  /** the star's angular radius (rad): a highlight is never smaller than the star */
  uSunSize: { value: 0.00465 },
  uPlanetDir: { value: new Vector3(0, -1, 0) },
  /** sine of the world's angular radius (0: no world near enough to light anything) */
  uPlanetSin: { value: 0 },
  /** the radiance of the world's disc in the same display units (its colour, albedo and phase) */
  uPlanetLight: { value: new Vector3() },
  /** seconds, for the lights' patterns */
  uTime: { value: 0 },
};

/** A white surface square to the star at 1 AU is shown at this level (display-referred, as `litMaterial`). */
export const KEY = 1.4;

/**
 * A tileable noise texture (256 x 256 RGBA, from typed arrays: no canvas): R a soft fBm (grime,
 * panel tint), G brushed streaks (fine across, long along x), B sparse specks (pits, dust),
 * A large soft blotches (smudges on glass).
 */
export function noiseData(size = 256, seed = 7): Uint8Array {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const lattice = (n: number) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
  /** smooth value noise of cx by cy cells (at most 256 each) over the tile: tileable */
  const value = (lat: Float32Array, cx: number, cy: number, x: number, y: number) => {
    const fx = (x * cx) / size, fy = (y * cy) / size;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
    const at = (i: number, j: number) => lat[(j % cy) * 256 + (i % cx)];
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const L = [lattice(256), lattice(256), lattice(256), lattice(256), lattice(256)];
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const fbm = 0.5 * value(L[0], 8, 8, x, y) + 0.25 * value(L[1], 16, 16, x, y) + 0.15 * value(L[2], 32, 32, x, y) + 0.1 * value(L[3], 64, 64, x, y);
      // streaks: many rows across, few cells along: a long thin grain
      const streak = 0.6 * value(L[4], 2, 128, x, y) + 0.4 * value(L[1], 4, 256, x, y);
      out[i] = Math.round(255 * Math.min(1, Math.max(0, fbm)));
      out[i + 1] = Math.round(255 * Math.min(1, Math.max(0, streak)));
      out[i + 3] = Math.round(255 * Math.min(1, Math.max(0, 0.65 * value(L[2], 4, 4, x, y) + 0.35 * value(L[3], 8, 8, x, y))));
    }
  }
  // specks: a few hundred small soft dots
  for (let k = 0; k < 420; k++) {
    const cx = rnd() * size, cy = rnd() * size, r = 0.6 + rnd() * 1.4, a = 0.35 + rnd() * 0.65;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const px = ((Math.floor(cx) + dx) % size + size) % size, py = ((Math.floor(cy) + dy) % size + size) % size;
        const d = Math.hypot(Math.floor(cx) + dx + 0.5 - cx, Math.floor(cy) + dy + 0.5 - cy);
        const w = Math.max(0, 1 - d / r) * a;
        const i = (py * size + px) * 4 + 2;
        out[i] = Math.min(255, out[i] + Math.round(255 * w));
      }
    }
  }
  return out;
}

let noiseTex: DataTexture | null = null;
/** The shared noise texture (built once). */
export function shipNoise(): DataTexture {
  if (noiseTex) return noiseTex;
  const t = new DataTexture(noiseData(), 256, 256, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  noiseTex = t;
  return t;
}

/** GLSL: the BRDF and the lights (star, world), shared by the hull and the cockpit's glass. */
export const SHIP_LIGHT_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform float uSun;
uniform vec3 uSunColor;
uniform float uSunSize;
uniform vec3 uPlanetDir;
uniform float uPlanetSin;
uniform vec3 uPlanetLight;
uniform float uTime;
const float KEY = ${KEY.toFixed(3)};
float D_GGX(float NoH, float a) {
  float a2 = a * a;
  float f = (NoH * a2 - NoH) * NoH + 1.0;
  return a2 / (PI * f * f);
}
float V_Smith(float NoV, float NoL, float a) {
  float a2 = a * a;
  float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}
vec3 F_Schlick(vec3 F0, float VoH) {
  float f = pow(1.0 - VoH, 5.0);
  return F0 + (1.0 - F0) * f;
}
/** the star: diffuse and specular, its disc widening the highlight (energy kept) */
vec3 starLight(vec3 N, vec3 V, vec3 dif, vec3 F0, float a, float shadow) {
  vec3 L = uSunDir;
  float NoL = dot(N, L);
  if (NoL <= 0.0 || uSun <= 0.0) return vec3(0.0);
  float NoV = clamp(dot(N, V), 1e-3, 1.0);
  vec3 H = normalize(L + V);
  float NoH = clamp(dot(N, H), 0.0, 1.0), VoH = clamp(dot(V, H), 0.0, 1.0);
  float aw = clamp(a + 0.5 * uSunSize, 0.0, 1.0);
  float D = D_GGX(NoH, aw) * (a * a) / (aw * aw);
  vec3 F = F_Schlick(F0, VoH);
  vec3 E = uSunColor * (uSun * KEY * PI) * NoL * shadow;
  return (dif * (1.0 / PI) * (1.0 - F) + D * V_Smith(NoV, NoL, a) * F) * E;
}
/** a world's sunlit disc: its light on the side turned to it, and its picture in what shines */
vec3 planetLight(vec3 N, vec3 V, vec3 dif, vec3 F0, float a) {
  float s = uPlanetSin;
  if (s <= 0.0) return vec3(0.0);
  vec3 P = uPlanetDir;
  float NoP = dot(N, P);
  // irradiance of a disc of angular radius asin(s): pi L s^2 cos, softened over its horizon
  float w = NoP >= s ? NoP : NoP <= -s ? 0.0 : (NoP + s) * (NoP + s) / (4.0 * s);
  vec3 c = dif * uPlanetLight * (s * s * w);
  // specular: the disc's point nearest the mirror direction, the lobe widened by its size
  vec3 R = reflect(-V, N);
  float cs = sqrt(1.0 - s * s);
  float rp = dot(R, P);
  vec3 Lr = R;
  if (rp < cs) {
    vec3 side = R - P * rp;
    float sl = length(side);
    Lr = sl > 1e-5 ? normalize(P * cs + side / sl * s) : P;
  }
  float NoL = dot(N, Lr);
  if (NoL > 0.0) {
    float NoV = clamp(dot(N, V), 1e-3, 1.0);
    vec3 H = normalize(Lr + V);
    float aw = clamp(a + 0.5 * s, 0.0, 1.0);
    float D = D_GGX(clamp(dot(N, H), 0.0, 1.0), aw);
    vec3 F = F_Schlick(F0, clamp(dot(V, H), 0.0, 1.0));
    c += D * V_Smith(NoV, NoL, a) * F * NoL * uPlanetLight * (PI * s * s);
  }
  return c;
}
`;

/** GLSL: an integer hash (no sine: a coarse GPU sine lines the cells up). */
export const HASH_GLSL = /* glsl */ `
float hash12(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p)) + 65536);
  uint h = (q.x * 1597334673u) ^ (q.y * 3812015801u);
  h = (h ^ (h >> 16u)) * 2246822519u;
  h ^= h >> 13u;
  return float(h) * (1.0 / 4294967296.0);
}
`;

/**
 * GLSL: how a light channel blinks (`t` in seconds, the ship's own phase added): the strobe a
 * double flash, the beacon a slow red pulse, the others steady.
 */
export const LAMP_GLSL = /* glsl */ `
float lampPattern(int ch, float t) {
  if (ch == 3) { float p = mod(t, 1.6); return step(p, 0.06) + step(abs(p - 0.24), 0.03); }
  if (ch == 6) { float p = mod(t + 0.7, 1.9); return smoothstep(0.0, 0.1, p) * (1.0 - smoothstep(0.3, 0.75, p)); }
  return 1.0;
}
`;

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PROJECT_PARS}
attribute vec3 aCol;
attribute vec4 aMat;
varying vec3 vN;
varying vec3 vPos;
varying vec2 vUv;
varying vec3 vCol;
varying vec4 vMat;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  vUv = uv;
  vCol = aCol;
  vMat = aMat;
  gl_Position = projectView(viewMatrix * wp);
  #include <logdepthbuf_vertex>
${FIX_LOGDEPTH}
}`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SHIP_LIGHT_GLSL}
${HASH_GLSL}
${LAMP_GLSL}
${SHADOW_GLSL}
uniform mat4 modelMatrix;
uniform sampler2D uNoise;
/** this ship's offset in time, so that two ships' strobes do not flash together */
uniform float uPhase;
uniform vec3 uHull;
uniform vec3 uTrim;
uniform vec3 uRadiator;
/** 1: the markings are painted (the player's ship); 0: not (another ship) */
uniform float uMarks;
/** light channels: 0 cabin, 1 port, 2 starboard, 3 strobe, 4 field emitters, 5 throat, 6 beacon, 7 spare */
uniform float uCh[8];
/** how hot the radiators are (0 cold .. 1 a full burn's heat) */
uniform float uHeat;
/** local lamps (model space) and their light: port, starboard, strobe */
uniform vec3 uLampPos[3];
uniform vec3 uLampCol[3];
/** the canopy glass seen from outside: a faint light from the cabin */
uniform vec3 uCabin;
/** the drive emitters' colour */
uniform vec3 uField;
varying vec3 vN;
varying vec3 vPos;
varying vec2 vUv;
varying vec3 vCol;
varying vec4 vMat;

/** groove profile of seams every (sx, sy) metres, offset alternate rows by half (brickwork): height and its gradient */
vec3 seams(vec2 uv, vec2 size, float width, float stagger) {
  vec2 g = uv / size;
  float row = floor(g.y);
  g.x += stagger * 0.5 * mod(row, 2.0);
  vec2 f = fract(g) - 0.5;
  // distance (m) to the nearest seam line in each direction
  vec2 d = (0.5 - abs(f)) * size;
  vec2 sgn = sign(f);
  vec2 e = exp(-(d * d) / (width * width));
  // height -e (a groove): the deeper of the two; its gradient along u and v (the distance to a
  // seam falls as |f| grows: d(-e)/du = -2 d e sign(f) / w^2)
  float hx = e.x, hy = e.y;
  float h = max(hx, hy);
  float k = -2.0 / (width * width);
  vec2 grad = hx > hy ? vec2(k * d.x * e.x * sgn.x, 0.0) : vec2(0.0, k * d.y * e.y * sgn.y);
  return vec3(-h, grad);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(-vPos);
  if (!gl_FrontFacing) N = -N;
  vec3 base = vCol;
  float rough = vMat.x, metal = vMat.y;
  int pat = int(vMat.z + 0.5);
  int grp = int(vMat.w + 0.5);
  if (grp == 1) base *= uHull;
  else if (grp == 2) base = uTrim;
  else if (grp == 3) base *= uRadiator;
  else if (grp == 4 || grp == 5) {
    // markings (the player's ship's own; another ship is painted over them): light on a dark coat,
    // dark on a light one
    vec3 under = grp == 4 ? uRadiator : uHull;
    if (uMarks < 0.5) base = grp == 4 ? uRadiator : uHull;
    else base = dot(under, vec3(0.2126, 0.7152, 0.0722)) > 0.3 ? vec3(0.045, 0.047, 0.052) : vec3(0.78, 0.79, 0.8);
  }
  vec3 emit = vec3(0.0);
  // the surface's own axes, from the screen-space change of position and uv (no tangents stored)
  vec3 dp1 = dFdx(vPos), dp2 = dFdy(vPos);
  vec2 du1 = dFdx(vUv), du2 = dFdy(vUv);
  vec3 dp2p = cross(dp2, N), dp1p = cross(N, dp1);
  vec3 T = dp2p * du1.x + dp1p * du2.x;
  vec3 B = dp2p * du1.y + dp1p * du2.y;
  T = normalize(T - N * dot(N, T) + 1e-6);
  B = normalize(B - N * dot(N, B) + 1e-6);
  // a pixel's footprint on the surface (m): details finer than it fade out instead of shimmering
  float foot = max(length(du1) + length(du2), 1e-4);
  vec2 bump = vec2(0.0);
  float cover = 0.0;
  if (pat == 0) {
    // painted panels: grooves between plates, a tint of their own each, light grime
    vec2 size = vec2(1.35, 0.85);
    vec3 s = seams(vUv, size, 0.006, 1.0);
    float vis = clamp(0.012 / foot, 0.0, 1.0);
    cover = -s.x * vis;
    bump = s.yz * 0.0016 * vis;
    vec2 cell = floor(vUv / size + vec2(0.5 * mod(floor(vUv.y / size.y), 2.0), 0.0));
    float tint = hash12(cell + 17.0);
    float grime = texture2D(uNoise, vUv * 0.35).r;
    base *= (0.95 + 0.07 * tint) * (0.93 + 0.1 * grime);
    base *= 1.0 - 0.55 * cover;
    rough = clamp(rough + 0.25 * cover + 0.08 * (grime - 0.5), 0.05, 1.0);
  } else if (pat == 1) {
    // brushed metal: grain along u, the highlight drawn out across it
    float g = texture2D(uNoise, vec2(vUv.x * 0.06, vUv.y * 2.5)).g;
    base *= 0.92 + 0.16 * g;
    rough = clamp(rough + 0.12 * (g - 0.5), 0.05, 1.0);
  } else if (pat == 2) {
    // heat-shield tiles: dark ceramic squares with gaps, each a little different
    vec2 size = vec2(0.16);
    vec3 s = seams(vUv, size, 0.004, 0.0);
    float vis = clamp(0.008 / foot, 0.0, 1.0);
    cover = -s.x * vis;
    float t = hash12(floor(vUv / size) + 3.0);
    base *= (0.8 + 0.4 * t) * (1.0 - 0.6 * cover);
    bump = s.yz * 0.001 * vis;
  } else if (pat == 3) {
    // radiator: heat pipes running out along the span (v), side by side across the chord (u),
    // under a dark high-emissivity coat
    float pitch = 0.11;
    float f = fract(vUv.x / pitch) - 0.5;
    float rib = exp(-f * f / 0.02);
    float vis = clamp(0.02 / foot, 0.0, 1.0);
    bump = vec2(-f * rib * 0.35 * vis, 0.0);
    base *= 0.85 + 0.3 * rib * vis;
    rough = clamp(rough - 0.15 * rib * vis, 0.05, 1.0);
    // glowing when hot: hottest by the coolant manifold at the root, along the pipes
    float along = clamp(vUv.y / 6.7, 0.0, 1.0);
    float temp = uHeat * (1.0 - 0.8 * along) * (0.7 + 0.3 * rib);
    vec3 hot = mix(vec3(0.85, 0.06, 0.015), vec3(1.0, 0.36, 0.07), smoothstep(0.6, 1.0, temp));
    emit += hot * temp * temp * temp * 0.9;
  } else if (pat == 4) {
    // foil: crinkled multi-layer insulation
    vec4 n = texture2D(uNoise, vUv * 0.9);
    vec4 n2 = texture2D(uNoise, vUv * 2.3 + 0.37);
    bump = (vec2(n.r, n2.r) - 0.5) * 0.9;
    base *= 0.85 + 0.3 * n2.a;
  } else if (pat == 5) {
    // dark anodised metal or carbon: a fine sheen, nothing more
    float g = texture2D(uNoise, vUv * vec2(0.5, 3.0)).g;
    rough = clamp(rough + 0.08 * (g - 0.5), 0.05, 1.0);
  } else if (pat == 6) {
    // a light: its colour times its channel's level
    int ch = grp - 10;
    float lvl = 0.0;
    for (int i = 0; i < 8; i++) if (ch == i) lvl = uCh[i];
    lvl *= lampPattern(ch, uTime + uPhase);
    if (grp == 14) {
      // the drive's emitters: a slow travelling shimmer along them (time taken modulo 20 pi, where
      // both waves come round whole: small arguments, as a coarse GPU sine wants)
      float tt = mod(uTime, 62.831853);
      float wave = 0.75 + 0.25 * sin(vUv.y * 9.0 - tt * 3.2) * sin(vUv.x * 5.0 + tt * 1.7);
      lvl *= wave;
      emit += uField * lvl * 2.2;
      base = vec3(0.04);
    } else {
      emit += base * lvl;
      base = base * 0.15;
    }
  } else if (pat == 7) {
    // canopy glass from outside: near black and glossy, what it mirrors is its look (below); the
    // cabin's light is all but lost behind it
    emit += uCabin * uCh[0];
  } else if (pat == 9) {
    // the inside of the nozzle's bell: lit by the throat while the torch burns (brightest deep in,
    // v runs from the lip to the throat), then glowing with the heat it took, dull red to orange
    float deep = smoothstep(0.2, 2.7, vUv.y);
    emit += vec3(0.62, 0.7, 1.0) * uCh[5] * (0.08 + 0.5 * deep * deep);
    float hot = uHeat * (0.35 + 0.65 * deep);
    emit += mix(vec3(0.8, 0.07, 0.01), vec3(1.0, 0.38, 0.08), smoothstep(0.5, 1.0, hot)) * hot * hot * 1.2;
  }
  if (bump != vec2(0.0)) N = normalize(N - (bump.x * T + bump.y * B));
  float a = max(rough * rough, 0.0025);
  vec3 F0 = mix(vec3(0.04), base, metal);
  vec3 dif = base * (1.0 - metal);
  // glass: no diffuse to speak of, a faint warm tint in what it mirrors
  if (pat == 7) { F0 = vec3(0.05, 0.047, 0.04); dif = base; }
  vec3 c = starLight(N, V, dif, F0, a, shipShadow(vPos, normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0), uSunDir)) + planetLight(N, V, dif, F0, a);
  // the ship's own lamps on the hull nearby (port, starboard, strobe)
  for (int i = 0; i < 3; i++) {
    vec3 lc = uLampCol[i] * (i == 2 ? lampPattern(3, uTime + uPhase) : 1.0);
    if (lc.r + lc.g + lc.b <= 0.0) continue;
    vec3 lp = (modelMatrix * vec4(uLampPos[i], 1.0)).xyz;
    vec3 d = lp - vPos;
    float r2 = dot(d, d);
    vec3 L = d * inversesqrt(r2);
    float NoL = max(dot(N, L), 0.0);
    c += dif * lc * NoL / (1.0 + r2);
  }
  c += emit;
  gl_FragColor = vec4(c, 1.0);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;

/** One look of the hull material: paint colours, light channels, lamps. */
export function shipMaterial(opts: { hull?: [number, number, number]; trim?: [number, number, number]; radiator?: [number, number, number]; side?: Side; shadows?: boolean; marks?: boolean } = {}): ShaderMaterial {
  return new ShaderMaterial({
    name: 'ship-hull',
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: opts.side ?? FrontSide,
    uniforms: {
      ...SHIP_LIGHT,
      uNoise: { value: shipNoise() },
      uHull: { value: new Vector3(...(opts.hull ?? [1, 1, 1])) },
      uTrim: { value: new Vector3(...(opts.trim ?? [0.85, 0.32, 0.12])) },
      uRadiator: { value: new Vector3(...(opts.radiator ?? [0.07, 0.074, 0.08])) },
      uMarks: { value: opts.marks === false ? 0 : 1 },
      uCh: { value: [0.6, 0, 0, 0, 0, 0, 0, 0] },
      uPhase: { value: 0 },
      uHeat: { value: 0 },
      uLampPos: { value: [new Vector3(), new Vector3(), new Vector3()] },
      uLampCol: { value: [new Vector3(), new Vector3(), new Vector3()] },
      uCabin: { value: new Vector3(0.5, 0.7, 1.0).multiplyScalar(0.004) },
      uField: { value: new Vector3(0.55, 0.85, 1.0) },
      // (the player's ship reads its shadow map; any other ship, and the cockpit, are left unshadowed)
      uShadowMap: SHADOW.uShadowMap, uShadowView: SHADOW.uShadowView, uShadowSize: SHADOW.uShadowSize,
      uShadowOn: opts.shadows ? SHADOW.uShadowOn : { value: 0 },
      uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK,
    },
  });
}

/**
 * Glows that add light (the lamps' halos, the engine's plume, the drive's field): quads that face
 * the eye, each vertex carrying its own centre (`aCentre`, model space), corner (`aCorner`, -1..1),
 * size (m, with a floor in pixels so a far light is not lost), colour and channel.
 */
const GLOW_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PROJECT_PARS}
${LAMP_GLSL}
attribute vec3 aCentre;
attribute vec2 aCorner;
attribute vec4 aGlow;   // rgb colour, w size (m)
attribute vec2 aChan;   // x channel, y shape (0 round halo, 1 plume, 2 flare streak)
uniform float uCh[8];
uniform float uTime;
uniform float uPhase;
uniform float uPixel;   // radians per pixel of the view
uniform float uMinPx;   // smallest halo (pixels)
varying vec2 vC;
varying vec3 vCol;
varying float vShape;
void main() {
  int ch = int(aChan.x + 0.5);
  float lvl = 0.0;
  for (int i = 0; i < 8; i++) if (ch == i) lvl = uCh[i];
  lvl *= lampPattern(ch, uTime + uPhase);
  vec4 c = modelViewMatrix * vec4(aCentre, 1.0);
  float dist = max(-c.z, 1e-3);
  float size = max(aGlow.w * length(vec3(modelMatrix[0])), uMinPx * uPixel * dist);
  // (off: a quad of no size, never drawn)
  if (lvl <= 0.001) size = 0.0;
  c.xy += aCorner * size;
  vC = aCorner;
  vCol = aGlow.rgb * lvl;
  vShape = aChan.y;
  gl_Position = projectView(c);
  #include <logdepthbuf_vertex>
${FIX_LOGDEPTH}
}`;
const GLOW_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec2 vC;
varying vec3 vCol;
varying float vShape;
void main() {
  float r2 = dot(vC, vC);
  if (r2 >= 1.0) discard;
  float g;
  if (vShape < 0.5) g = exp(-r2 * 7.0) * 0.6 + exp(-r2 * 60.0) * 2.5;      // a lamp: bright core, soft halo
  else if (vShape < 1.5) g = exp(-r2 * 3.5) * 0.7 + exp(-r2 * 22.0) * 0.8; // a puff of the plume
  else g = exp(-vC.y * vC.y * 300.0) * exp(-abs(vC.x) * 3.0) * 0.6 + exp(-r2 * 40.0); // a flare's streak
  g *= 1.0 - r2;
  gl_FragColor = vec4(vCol * g, 1.0);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;

/** The view, for the glows: radians per pixel of the frame drawn (set every frame by `ShipArt`). */
export const GLOW_VIEW = { uPixel: { value: 1e-3 } };

/** `minPx`: the smallest a halo gets on the screen (pixels of the frame), so a far lamp still shows. */
export function glowMaterial(minPx = 3): ShaderMaterial {
  return new ShaderMaterial({
    name: 'ship-glow',
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    uniforms: {
      uCh: { value: [0, 0, 0, 0, 0, 0, 0, 0] }, uTime: SHIP_LIGHT.uTime, uPhase: { value: 0 }, uPixel: GLOW_VIEW.uPixel, uMinPx: { value: minPx },
      uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK,
    },
    transparent: true, depthWrite: false, depthTest: true, blending: AdditiveBlending,
  });
}

/**
 * The cockpit's canopy glass, from inside: nearly invisible, as good glass is. It shows only what
 * real glass shows: the star's glint where the glass mirrors it, a faint sheen at grazing angles,
 * and, looking towards the star, the dust and smudges it lights up and a soft haze round it.
 * Additive: it never darkens the view.
 */
const GLASS_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PROJECT_PARS}
uniform float uPlanetSin;
varying vec3 vN;
varying vec3 vPos;
varying vec2 vUv;
varying float vPlanetCut;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  vUv = uv;
  // (the cosine of the angle from the world out to which its mirror image shows: its disc and the
  // tail of its lobe; the same at every vertex)
  float sp = min(uPlanetSin, 1.0);
  vPlanetCut = sp > 0.0 ? cos(min(asin(sp) + 4.2 * min(0.02 + 0.5 * sp, 1.0), PI)) : 2.0;
  gl_Position = projectView(viewMatrix * wp);
  #include <logdepthbuf_vertex>
${FIX_LOGDEPTH}
}`;
const GLASS_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SHIP_LIGHT_GLSL}
uniform sampler2D uNoise;
uniform float uGlass;
varying vec3 vN;
varying vec3 vPos;
varying vec2 vUv;
varying float vPlanetCut;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(-vPos);
  if (dot(N, V) < 0.0) N = -N;
  vec3 F0 = vec3(0.04);
  vec3 R = reflect(-V, N);
  vec3 c = vec3(0.0);
  // (the glass spans the whole view but shows something in three places only: its mirror images of
  // the star and of the world, and round the star itself. Elsewhere nothing is worked out: each
  // test below cuts where its light has fallen under a thousandth of white: worked out everywhere,
  // it took a fifth of the cockpit's drawing time.)
  // the glass mirrors the star (when it shines in past the pilot) and the world, a little: a coated
  // canopy reflects a fifth of what bare glass does, and its glint is a sharp one
  float aw = 0.004 + 0.5 * uSunSize;
  if (dot(R, uSunDir) > 1.0 - 400.0 * aw * aw) c += 0.2 * starLight(N, V, vec3(0.0), F0, 0.004, 1.0);
  if (dot(R, uPlanetDir) > vPlanetCut) c += 0.2 * planetLight(N, V, vec3(0.0), F0, 0.02);
  // looking through it towards the star: dust and smudges catch the light, a haze round it (the
  // lookups inside the test: along its edge, where their level of detail is unsure, what they add
  // is nothing to see)
  float toward = dot(-V, uSunDir);
  if (toward > 0.3) {
    float smudge = texture2D(uNoise, vUv * 0.55).a;
    float dust = texture2D(uNoise, vUv * 2.1).b;
    float near = pow(toward, 24.0), wide = pow(toward, 5.0);
    float scatter = near * (0.25 + 0.75 * smudge) * 0.08 + wide * (0.008 + 0.025 * smudge) + dust * pow(toward, 9.0) * 0.25;
    c += uSunColor * (uSun * KEY) * scatter;
  }
  gl_FragColor = vec4(c * uGlass, 1.0);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;

export function glassMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'cockpit-glass',
    vertexShader: GLASS_VERT,
    fragmentShader: GLASS_FRAG,
    uniforms: { ...SHIP_LIGHT, uNoise: { value: shipNoise() }, uGlass: { value: 1 }, uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK },
    transparent: true, depthWrite: false, depthTest: true, blending: AdditiveBlending,
  });
}
