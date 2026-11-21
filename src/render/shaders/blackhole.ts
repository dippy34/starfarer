import { JET_GLSL } from './jet';
import { PSF_ON_PIXEL } from './psf';
import { FIX_LOGDEPTH, OUTPUT_FRAGMENT, PROJECT_PARS } from './xr';

/**
 * Black hole: gravitational lensing of everything behind it plus a thin accretion disk,
 * traced per pixel in the Schwarzschild metric. Units: Schwarzschild radius rs = 1.
 *
 * A photon moves in the plane spanned by its position and direction; with u = 1/r its orbit
 * obeys d²u/dφ² = −u + 1.5 u² (Binet equation with the GR term). Rays are traced backwards
 * from the eye with RK4 in φ until they escape (u → 0, the direction there is the asymptote)
 * or fall in (u ≥ 1). The background is the scene as seen from the eye without the hole (cube
 * maps refreshed a face per frame: BlackHoleLayer), looked up in the escape direction. Rays that stay far
 * from the hole (impact parameter and eye distance > 30 rs) use the weak-field deflection
 * 2/b + 15π/(16 b²), scaled by the fraction still ahead of the eye.
 *
 * The disk plane is crossed where n·(cos φ e1 + sin φ e2) = 0, i.e. every π from a known
 * angle, so crossings are found exactly. Emission: Novikov–Thorne/Shakura–Sunyaev temperature
 * profile with a zero-torque inner edge at the ISCO (3 rs); gas on circular orbits seen by a
 * static observer moves at β = sqrt(rs / (2 (r − rs))); the observed temperature is g·T with
 * g = sqrt(1 − rs/r) / (γ (1 − β cos θ)) (gravitational redshift and Doppler shift), and a
 * blackbody at temperature T stays a blackbody at g·T, so beaming comes out of the Planck
 * lookup by itself.
 *
 * A sight line is one sample of the disk, and a disk's light spans decades within a few rs: where
 * a pixel is wider than that, what one sample finds says nothing of what the pixel holds (a far
 * hole flickered between a speck and a ball of light as the eye moved). So where the frame's
 * pixels do not resolve the disk's middle, it is traced on its own at a finer scale (the
 * miniature: MINI_FRAG, a window round the hole) and that picture is brought down to the frame's
 * pixels (MINI_SHOW), while the frame's own samples of the middle are dropped (uMiniW).
 *
 * The same goes for what is seen past the hole there. Beside the shadow the whole sky is squeezed
 * into a ring a fraction of a pixel wide, and one sample finds all of a pixel lit by a star's
 * second picture, or none of it: at A0620-00, whose companion stands a quarter of the sky away,
 * a pixel on the hole was a hundred times white through a twelfth of the way in. The miniature
 * holds the surroundings as seen past the hole as well, wherever it shows a picture.
 */
export const BH_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PROJECT_PARS}
uniform float uClipScale;
varying vec3 vRay;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // The sight line through each pixel, from the eye to the sphere. A supermassive hole's region is
  // light years wide: in metres its clip coordinates are ~1e17, whose products overflow 32-bit
  // floats in the rasteriser, and what it interpolates across each triangle comes out wrong (the
  // sky behind showed as a mosaic of the sphere's facets). One factor for the whole mesh changes
  // neither the projection nor the perspective interpolation.
  vRay = (wp.xyz - cameraPosition) * uClipScale;
  gl_Position = projectView(viewMatrix * wp);
  #include <logdepthbuf_vertex>
${FIX_LOGDEPTH}
  gl_Position *= uClipScale;
}`;

/** The disk and the tracing of one sight line, shared by the frame's pass and the miniature's. */
const BH_TRACE = /* glsl */ `
uniform sampler2D uLut;      // blackbody: rgb chromaticity (luminance 1), a = log10(Y / Y_sun)
uniform vec3 uO;             // eye (rig origin) relative to the hole, in rs
uniform vec3 uN;             // disk normal (unit)
uniform vec3 uE1;            // disk plane basis (texture angle)
uniform vec3 uE2;
uniform float uRin;          // disk inner / outer radius (rs); uRout = 0: no disk
uniform float uRout;
uniform float uTmax;         // peak disk temperature (K)
uniform float uSunDisk;      // radiance of the Sun's disk (engine units)
uniform float uExposure;     // the scene's exposure
uniform vec2 uMiddle;        // the disk's middle: its radius (rs) and the exposure it is drawn with at the most
uniform float uTime;
uniform int uMaxSteps;
uniform float uStepK;
uniform float uDiskSeed;     // per-hole look of the gas
uniform float uSpiral;       // strength of spiral arms (tidal spiral shocks in binaries)
uniform float uArms;
uniform float uStreakFreq;
uniform float uAngFreq;
uniform float uWarp;

const float LUT_LOG_MIN = 2.5;
const float LUT_LOG_SPAN = 5.5;

vec3 planck(float T) {
  float x = clamp((log2(max(T, 1.0)) * 0.30103 - LUT_LOG_MIN) / LUT_LOG_SPAN, 0.0, 1.0);
  vec4 t = texture2D(uLut, vec2(x * (255.0 / 256.0) + 0.5 / 256.0, 0.5));
  return t.rgb * exp2(t.a * 3.3219281);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Streaky gas: noise on (angle on a circle, log r), stretched along the orbit, advected with a
// slowed-down Keplerian angular speed. Two layers cross-fade so the shear never winds up.
float streaks(float lr, float ang, float seed) {
  float n = 0.0, amp = 0.6, fr = 1.0;
  // warp the radius a little so streaks wander instead of forming perfect circles
  lr += uWarp * 0.12 * (vnoise(vec3(cos(ang) * 1.3, sin(ang) * 1.3, lr * 2.0 + seed + uDiskSeed)) - 0.5);
  for (int o = 0; o < 3; o++) {
    vec3 q = vec3(cos(ang) * uAngFreq * fr, sin(ang) * uAngFreq * fr, lr * uStreakFreq * fr + seed + uDiskSeed);
    n += amp * vnoise(q);
    amp *= 0.5; fr *= 2.3;
  }
  return n;
}
float diskTexture(float r, float ang) {
  float lr = log(r);
  float w = 1.4 * pow(uRin / r, 1.5);           // rad/s, inner edge fastest
  float P = 14.0;
  float p1 = fract(uTime / P), p2 = fract(uTime / P + 0.5);
  float n1 = streaks(lr, ang - w * p1 * P, 0.0);
  float n2 = streaks(lr, ang - w * p2 * P, 37.0);
  float n = n1 * (1.0 - abs(2.0 * p1 - 1.0)) + n2 * (1.0 - abs(2.0 * p2 - 1.0));
  float t = smoothstep(0.15, 0.95, n);
  // logarithmic spiral arms (pitch ~15 degrees), turning slowly
  float sp = 0.5 + 0.5 * cos(uArms * (ang - lr / 0.27 - uTime * 0.05 + uDiskSeed));
  return t * mix(1.0, 0.35 + 1.3 * sp * sp, uSpiral);
}

// Light from the disk where the traced ray crosses it at P (rs) moving along k (eye -> scene).
vec4 diskHit(vec3 P, vec3 k, float r) {
  if (r < uRin * 0.8 || r > uRout) return vec4(0.0);
  float x = r / uRin;
  float prof = x > 1.0 ? pow(x, -0.75) * pow(1.0 - inversesqrt(x), 0.25) / 0.48795 : 0.0;
  float T = uTmax * prof;
  vec3 vdir = normalize(cross(uN, P));
  float beta = min(sqrt(0.5 / max(r - 1.0, 0.5)), 0.995);
  float gam = inversesqrt(1.0 - beta * beta);
  float g = sqrt(max(1.0 - 1.0 / r, 1e-4)) / (gam * (1.0 - beta * dot(vdir, -k)));
  float ang = atan(dot(P, uE2), dot(P, uE1));
  float tex = diskTexture(r, ang);
  float edge = smoothstep(uRin * 0.95, uRin * 1.25, r) * (1.0 - smoothstep(uRout * 0.45, uRout, r));
  // dense near the hole, thinning outwards so the lensed sky shows through the outer disk
  float tau = 7.0 * pow(x, -0.85) * (0.2 + 1.3 * tex);
  float a = (1.0 - exp(-tau)) * edge;
  vec3 L = planck(T * g) * (0.6 + 0.8 * tex);
  L = max(mix(vec3(dot(L, vec3(0.2126, 0.7152, 0.0722))), L, 1.3), 0.0);  // a little more saturated, like the stars
  // The middle has an exposure of its own (BlackHoleView.middle), which lets go outwards as
  // r^3/4, the way the light of the hottest of disks falls off: where the scene's exposure
  // would burn the middle out, the disk is drawn level from there outwards and never brighter
  // away from the hole than towards it, until it is as the scene has it.
  float exposure = min(uExposure, uMiddle.y * pow(max(r / uMiddle.x, 1.0), 0.75));
  return vec4(L * (uSunDisk * exposure), a);
}

void composite(inout vec3 acc, inout float tr, vec4 e) {
  acc += tr * e.a * e.rgb;
  tr *= 1.0 - e.a;
}

// One sight line from the eye at O (rs from the hole) along d: the disk's light on it (acc), how
// much of what is behind comes through (tr, and esc: 0 if the line ends in the hole), and where
// it looks once it has left the hole behind (dirOut).
void trace(vec3 O, vec3 d, out vec3 acc, out float tr, out float esc, out vec3 dirOut) {
  float r0 = max(length(O), 1.0001);
  acc = vec3(0.0);
  tr = 1.0;
  esc = 1.0;
  dirOut = d;
  bool hasDisk = uRout > 0.0;

  vec3 Lv = cross(O, d);
  float b = length(Lv);
  if (r0 > 30.0 && b > 30.0) {
    // weak field: straight line to the closest approach Q, deflected there towards the hole
    float tc = -dot(O, d);
    vec3 Q = O + d * tc;
    float cosPsi = -dot(O, d) / r0;
    float frac = 0.5 * (1.0 + cosPsi);
    float alpha = frac * (2.0 / b + 2.9452431 / (b * b));
    vec3 toward = -Q / max(length(Q), 1e-6);
    dirOut = normalize(cos(alpha) * d + sin(alpha) * toward);
    if (hasDisk) {
      float dn = dot(d, uN);
      vec3 start = O;
      if (tc > 0.0 && abs(dn) > 1e-6) {
        float t = -dot(O, uN) / dn;
        if (t > 0.0 && t < tc) { vec3 P = O + d * t; composite(acc, tr, diskHit(P, d, length(P))); }
      }
      if (tc > 0.0) start = Q;
      float dn2 = dot(dirOut, uN);
      if (abs(dn2) > 1e-6) {
        float t = -dot(start, uN) / dn2;
        if (t > 0.0) { vec3 P = start + dirOut * t; composite(acc, tr, diskHit(P, dirOut, length(P))); }
      }
    }
    return;
  }
  // strong field: integrate the photon orbit in its plane
  vec3 e1 = O / r0;
  vec3 tv = d - dot(d, e1) * e1;
  float tl = length(tv);
  vec3 e2 = tl > 1e-6 ? tv / tl : normalize(cross(e1, abs(e1.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
  float u = 1.0 / r0;
  float du = -u * dot(d, e1) / max(tl, 1e-6);
  float A = dot(uN, e1), B = dot(uN, e2);
  float phiC = 1e9;
  if (hasDisk && abs(A) + abs(B) > 1e-6) {
    phiC = mod(atan(-A, B), PI);
    if (phiC < 1e-5) phiC += PI;
  }
  float phi = 0.0;
  bool done = false;
  esc = 0.0;
  for (int i = 0; i < 400; i++) {
    if (i >= uMaxSteps || tr < 0.01) break;
    // far out the orbit is nearly a sinusoid in phi, which RK4 follows closely in long steps
    float h = uStepK * mix(0.3, 0.035, smoothstep(0.02, 0.45, u));
    // RK4 on (u, du/dphi)
    float k1u = du,                   k1v = -u + 1.5 * u * u;
    float uu = u + 0.5 * h * k1u;
    float k2u = du + 0.5 * h * k1v,  k2v = -uu + 1.5 * uu * uu;
    uu = u + 0.5 * h * k2u;
    float k3u = du + 0.5 * h * k2v,  k3v = -uu + 1.5 * uu * uu;
    uu = u + h * k3u;
    float k4u = du + h * k3v,         k4v = -uu + 1.5 * uu * uu;
    float u1 = u + h / 6.0 * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
    float du1 = du + h / 6.0 * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);
    if (phiC < phi + h) {
      float s = (phiC - phi) / h;
      float s2 = s * s, s3 = s2 * s;
      float uc = (2.0 * s3 - 3.0 * s2 + 1.0) * u + (s3 - 2.0 * s2 + s) * h * du + (-2.0 * s3 + 3.0 * s2) * u1 + (s3 - s2) * h * du1;
      if (uc > 0.0 && uc < 1.0) {
        float duc = mix(du, du1, s);
        vec3 rh = cos(phiC) * e1 + sin(phiC) * e2;
        vec3 ph = -sin(phiC) * e1 + cos(phiC) * e2;
        vec3 k = normalize(rh * (-duc / uc) * inversesqrt(max(1.0 - uc, 1e-4)) + ph);
        composite(acc, tr, diskHit(rh / uc, k, 1.0 / uc));
      }
      phiC += PI;
    }
    if (u1 <= 0.0) {
      float phiOut = phi + h * u / (u - u1);
      dirOut = cos(phiOut) * e1 + sin(phiOut) * e2;
      esc = 1.0;
      done = true;
      break;
    }
    if (u1 >= 1.0) { done = true; break; }
    u = u1; du = du1; phi += h;
  }
  if (!done && u < 0.08) {
    // out of steps far from the hole: finish along the flat-space solution u = u cos + du sin
    float phiOut = phi + atan(u, -du);
    dirOut = cos(phiOut) * e1 + sin(phiOut) * e2;
    esc = 1.0;
  }
}

// Light too strong for the frame's numbers (half floats) is brought down as a whole: cut off colour
// by colour, an orange glow went yellow and then white as it grew.
vec3 withinRange(vec3 c) {
  return c * min(1.0, 6.0e4 / max(max(c.r, c.g), max(c.b, 1e-6)));
}
`;

/**
 * The miniature's window is round, and fades over its last quarter (`q`: a place in it, (0, 0) at
 * the hole and 1 at its edge): the frame's own samples take over there, and what the two share
 * out between them is all of the disk's light, once.
 */
const MINI_SHARE = /* glsl */ `
float miniShare(vec2 q) {
  return 1.0 - smoothstep(0.75, 1.0, length(q));
}
`;

export const BH_FRAG = /* glsl */ `
precision highp float;
#include <common>
#include <logdepthbuf_pars_fragment>
uniform samplerCube uEnv;     // the scene around the eye without the hole
uniform samplerCube uGlow;    // and the glowing volumes around it (a galaxy's light, nearby nebulae)
uniform float uRs;           // metres per rs
uniform vec2 uMiniW;         // how much the miniature shows instead, in its window (0..1): of the disk's light, of what is seen past the hole
uniform vec3 uMiniX;         // the miniature's window: its axes, each divided by the tangent of its half-width
uniform vec3 uMiniY;
varying vec3 vRay;
${BH_TRACE}
${MINI_SHARE}
${JET_GLSL}
void main() {
  vec3 d = normalize(vRay);
  vec3 O = uO + cameraPosition / uRs;
  vec3 acc, dirOut;
  float tr, esc;
  trace(O, d, acc, tr, esc, dirOut);
  // (where this sight line falls in the window, and how much of it is the miniature's there: the hole is at its middle)
  float ahead = dot(d, -normalize(O));
  vec2 own = 1.0 - uMiniW * (ahead > 0.0 ? miniShare(vec2(dot(d, uMiniX), dot(d, uMiniY)) / ahead) : 0.0);
  vec3 bg = textureCube(uEnv, dirOut).rgb + textureCube(uGlow, dirOut).rgb;
  // The hole's jets are its own: where they stand, this side of the hole and the far one, not part
  // of the surroundings it bends. (Their light goes straight here: it bends only in the few rs
  // where a jet is thinnest.)
  float slant = dot(d, uN);
  float tDisk = abs(slant) > 1e-6 ? -dot(O, uN) / slant : -1.0;
  vec3 jets = jetGlow(O, d, uN, tDisk > 0.0 ? tDisk : 1e30, tr, -dot(O, d), esc);
  gl_FragColor = vec4(withinRange(acc * own.x + tr * esc * bg * own.y + jets), 1.0);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;

/**
 * The miniature: the window round the hole, a pixel of its own to each sight line. The lines are
 * traced from no farther off than a thousand times the window's half-width (uO, uSide, uUp: from
 * there they are parallel to a thousandth, and the picture is the same from any farther). From
 * five million radii, 32-bit numbers place a sight line beside the hole to half a radius at
 * best: the far glint of M87* doubled at 8,800 light years and was gone by 40,000. `vTrue` is the
 * line from where the eye is, for what is seen past the hole.
 */
export const MINI_VERT = /* glsl */ `
uniform vec3 uAxis;   // from the eye to the hole (unit)
uniform vec3 uSide;   // the window's axes, as long as the tangent of its half-width from where it is traced
uniform vec3 uUp;
uniform float uNear;  // how far off it is traced from, over how far off the eye is (1 or less)
varying vec3 vRay;
varying vec3 vTrue;
varying vec2 vPlace;
void main() {
  vPlace = position.xy;
  vec3 across = position.x * uSide + position.y * uUp;
  vRay = uAxis + across;
  vTrue = uAxis + across * uNear;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * The disk's light, and as much of what is seen past the hole as is the miniature's to show
 * (uBehind), in the frame's own measure: each of the miniature's pixels holds the light it adds
 * to a pixel of the frame (uShare: how much of a frame's pixel one of them takes), so the numbers
 * stay small however far off the hole is.
 */
export const MINI_FRAG = /* glsl */ `
precision highp float;
#include <common>
uniform samplerCube uEnv;    // the scene around the eye without the hole, and the glowing volumes around it
uniform samplerCube uGlow;
uniform float uBehind;       // how much of what is seen past the hole the miniature holds (0..1: the frame's own samples have the rest)
uniform float uShare;
varying vec3 vRay;
varying vec3 vTrue;
varying vec2 vPlace;
${BH_TRACE}
${MINI_SHARE}
void main() {
  vec3 d = normalize(vRay);
  vec3 acc, dirOut;
  float tr, esc;
  trace(uO, d, acc, tr, esc, dirOut);
  // (the hole turns the line as it does from wherever it is traced: the same turn of the line from the eye's own place)
  vec3 past = dirOut + normalize(vTrue) - d;
  vec3 bg = textureCube(uEnv, past).rgb + textureCube(uGlow, past).rgb;
  gl_FragColor = vec4(withinRange((acc + uBehind * tr * esc * bg) * (uShare * miniShare(vPlace))), 1.0);
}`;

/** The miniature shown: a square facing the eye at the hole's place in the frame. */
export const MINI_SHOW_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PROJECT_PARS}
uniform float uClipScale;
uniform float uReach;   // the square's half-width, in window half-widths
varying vec2 vPlace;
void main() {
  vPlace = position.xy * uReach;
  gl_Position = projectView(modelViewMatrix * vec4(position.xy, 0.0, 1.0));
  #include <logdepthbuf_vertex>
${FIX_LOGDEPTH}
  gl_Position *= uClipScale;
}`;

/**
 * The miniature brought down to the frame's pixels. Where the window is some pixels wide, each
 * pixel takes the mean of the miniature over its own area (its mip level of that width). Where
 * the whole window is no more than a pixel or two, its light is that of a point: all of it, laid
 * down as a point half a pixel wide is (summed over each pixel's area, like a star: it keeps its
 * brightness as it drifts across the pixels).
 */
export const MINI_SHOW_FRAG = /* glsl */ `
precision highp float;
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uMini;
uniform float uMiniW;     // how much of the middle is the miniature's to show
uniform float uSize;      // the miniature's width (its own pixels)
uniform float uPixels;    // the window's half-width in the frame's pixels
uniform float uShare;     // how much of a frame's pixel one of the miniature's takes
uniform float uPoint;     // 1: the window is a point in the frame; 0: a picture
varying vec2 vPlace;
${PSF_ON_PIXEL}
void main() {
  float level = log2(max(uSize / (2.0 * uPixels), 1.0));
  vec3 picture = max(abs(vPlace.x), abs(vPlace.y)) < 1.0 ? textureLod(uMini, 0.5 + 0.5 * vPlace, level).rgb / uShare : vec3(0.0);
  // all of its light (the mean of the smallest mip level, times the pixels it stands for)
  vec3 whole = textureLod(uMini, vec2(0.5), 16.0).rgb * uSize * uSize;
  vec2 px = vPlace * uPixels;
  vec3 point = whole * psfOnPixel(px.x, 0.5) * psfOnPixel(px.y, 0.5);
  gl_FragColor = vec4(uMiniW * mix(picture, point, uPoint), 1.0);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;
