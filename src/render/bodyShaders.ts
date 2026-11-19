/**
 * GLSL for the bodies of a star system: stars, gas/ice giants, rings,
 * atmospheres and clouds. Terrain has its own file.
 *
 * Conventions shared by all body shaders:
 *   - meshes are unit spheres scaled by the body radius and placed at the
 *     camera-relative position of the body; the camera is at the origin
 *   - `uBodyRot` rotates body-fixed directions (z = spin axis, x = prime
 *     meridian) into world axes
 *   - lights and shadow casters are given relative to the body centre
 */
import { NOISE_GLSL } from './noiseTexture';
import { CLIP_SAFE, CLIP_SAFE_BILLBOARD } from './glsl';

/** Vertex shader for sphere-based bodies. */
export const BODY_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform mat3 uBodyRot;
varying vec3 vLocal;     // unit direction in the body-fixed frame
varying vec3 vWorldN;    // sphere normal, world axes
varying vec3 vRel;       // fragment position relative to the camera, world axes
void main() {
  vLocal = position;
  vWorldN = uBodyRot * position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vRel = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>${CLIP_SAFE}
}`;

/**
 * Lighting helpers: up to two suns, soft shadows from up to four spheres
 * (eclipses), and the shadow of a ring system.
 */
export const LIGHT_GLSL = /* glsl */ `
uniform vec3 uLightPos[2];     // suns relative to the body centre (metres)
uniform vec3 uLightColor[2];   // linear colour × exposure-compensated intensity (zero = unused)
uniform float uLightRadius[2];
uniform vec4 uOccluder[4];     // xyz = centre relative to the body centre, w = radius (0 = unused)
uniform vec3 uRingNormal;      // world axes
uniform vec4 uRing;            // inner radius, outer radius, opacity, seed  (outer = 0 → no rings)

// Ring density at radius r. 'fw' is the pixel footprint in units of the ring width: ringlets finer
// than a pixel are averaged out instead of shimmering when the rings are seen from afar.
float ringProfile(float r, vec4 ring, float fw) {
  float x = (r - ring.x) / (ring.y - ring.x);
  if (x <= 0.0 || x >= 1.0) return 0.0;
  // Ringlets and gaps from stacked 1D noise; a couple of wide divisions.
  float s = ring.w;
  float w1 = 1.0 - smoothstep(0.3, 0.9, fw * 9.0 * 64.0);
  float w2 = 1.0 - smoothstep(0.3, 0.9, fw * 41.0 * 64.0);
  float n = texture(uNoise, vec3(x * 1.7 + s, s * 0.37, 0.5)).r * 0.55;
  n += mix(0.5, texture(uNoise, vec3(x * 9.0 + s, 0.21, s * 0.61)).r, w1) * 0.3;
  n += mix(0.5, texture(uNoise, vec3(x * 41.0, s, 0.77)).g, w2) * 0.15;
  float gaps = smoothstep(0.02, 0.05 + fw, abs(x - (0.35 + 0.3 * fract(s * 7.1)))) * smoothstep(0.008, 0.02 + fw, abs(x - (0.72 + 0.2 * fract(s * 3.3))));
  float edge = smoothstep(0.0, 0.04, x) * smoothstep(1.0, 0.96, x);
  return clamp((0.25 + 1.3 * n) * gaps * edge, 0.0, 1.0) * ring.z;
}

// Fraction of sun 'i' visible from point p (relative to the body centre), accounting for eclipsing spheres.
float sunVisibility(vec3 p, int i) {
  vec3 toSun = uLightPos[i] - p;
  float ds = length(toSun);
  vec3 sd = toSun / ds;
  float sunAng = uLightRadius[i] / ds;
  float vis = 1.0;
  for (int k = 0; k < 4; k++) {
    float rad = uOccluder[k].w;
    if (rad <= 0.0) continue;
    vec3 oc = uOccluder[k].xyz - p;
    float along = dot(oc, sd);
    if (along <= 0.0) continue;
    // Angular separation of sun and occluder centres vs. their angular radii → smooth penumbra.
    float sep = length(oc - sd * along) / along;
    float occAng = rad / along;
    float cover = 1.0 - smoothstep(occAng - sunAng, occAng + sunAng, sep);
    // An occluder smaller than the sun can only block part of it (annular eclipse).
    vis *= 1.0 - cover * min(1.0, (occAng * occAng) / max(sunAng * sunAng, 1e-12));
  }
  return vis;
}

// Light transmitted through the rings toward sun 'i' from point p.
float ringShadow(vec3 p, int i) {
  if (uRing.y <= 0.0) return 1.0;
  vec3 sd = normalize(uLightPos[i] - p);
  float denom = dot(sd, uRingNormal);
  if (abs(denom) < 1e-4) return 1.0;
  float t = -dot(p, uRingNormal) / denom;
  if (t <= 0.0) return 1.0;
  float r = length(p + sd * t);
  // The shadow is soft (the sun is not a point), so only the broad structure matters.
  return 1.0 - ringProfile(r, uRing, 0.004) * 0.85;
}
`;

/** Star photosphere: boiling granulation, drifting spots, limb darkening, all emissive HDR. */
export const STAR_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uSpots;      // 0..1 star-spot coverage
uniform float uCells;      // granulation scale (larger for giants)
uniform float uDetail;     // quality 0..1
varying vec3 vLocal;
varying vec3 vWorldN;
varying vec3 vRel;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vWorldN);
  vec3 v = normalize(-vRel);
  float mu = clamp(dot(n, v), 0.0, 1.0);
  vec3 p = normalize(vLocal);
  float t = uTime;
  // Granulation: convection cells that slowly churn (two cellular layers drifting through each other).
  // (Cells smaller than a pixel are averaged out, so a distant star is a calm disc, not a sparkle.)
  float fw = length(fwidth(p));
  float g1 = mix(0.45, cell3(p * uCells + vec3(0.0, t * 0.02, 0.0)), 1.0 - smoothstep(0.3, 0.9, fw * uCells * 64.0));
  float g2 = uDetail > 0.4 ? mix(0.45, cell3(p * uCells * 2.7 + vec3(t * 0.03, 0.0, 0.1)), 1.0 - smoothstep(0.3, 0.9, fw * uCells * 2.7 * 64.0)) : 0.45;
  float gran = 0.72 + 0.34 * g1 + 0.16 * g2;
  // Large-scale mottling and dark spot groups near active latitudes.
  float big = n3(p * 0.35 + vec3(0.0, 0.0, t * 0.004));
  float spotN = n3b(p * 0.55 + vec3(t * 0.003, 0.3, 0.0));
  float spot = smoothstep(1.0 - 0.32 * uSpots, 1.0 - 0.18 * uSpots, spotN) * uSpots;
  float lum = gran * (0.86 + 0.3 * big) * (1.0 - 0.75 * spot);
  // Limb darkening (stronger in blue): the edge of the disc is cooler and redder.
  vec3 limb = vec3(1.0) - vec3(0.5, 0.62, 0.74) * (1.0 - pow(mu, 0.55));
  // Hot bright faculae near the limb.
  float fac = (1.0 - mu) * smoothstep(0.6, 0.9, g1 * big * 1.6);
  vec3 col = uColor * lum * limb * uIntensity + uColor * fac * uIntensity * 0.5;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Camera-facing glow around a star: corona, streamers and (when far away) the star's glare with diffraction spikes. */
export const GLOW_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCenter;      // star centre relative to the camera (world axes)
uniform float uSize;       // quad half-size in metres
varying vec2 vP;
void main() {
  vP = position.xy;
  // Build the billboard in view space so it always faces the camera.
  vec4 c = viewMatrix * vec4(uCenter, 1.0);
  c.xy += position.xy * uSize;
  gl_Position = projectionMatrix * c;
  #include <logdepthbuf_vertex>${CLIP_SAFE_BILLBOARD}
}`;

export const GLOW_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform vec3 uColor;
uniform float uTime;
uniform float uDisc;       // star radius as a fraction of the quad half-size
uniform float uCorona;     // corona strength
uniform float uGlare;      // far-away glare strength (HDR)
uniform float uSeed;
varying vec2 vP;
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vP);
  if (r > 1.0) discard;
  float a = atan(vP.y, vP.x);
  vec3 col = vec3(0.0);
  if (uCorona > 0.0) {
    float x = max(r / max(uDisc, 1e-4) - 1.0, 0.0);       // height above the photosphere in star radii
    // Streamers: noise in angle that stretches outward and slowly evolves.
    float s = texture(uNoise, vec3(cos(a) * 0.35 + uSeed, sin(a) * 0.35, uTime * 0.01 + x * 0.05)).r;
    float s2 = texture(uNoise, vec3(cos(a) * 1.3, sin(a) * 1.3 + uSeed, uTime * 0.02 + x * 0.2)).g;
    float falloff = exp(-x * (2.2 - 1.2 * s)) + 0.35 * exp(-x * 0.7) * (0.4 + s2);
    // Prominences: bright arcs hugging the limb.
    float prom = smoothstep(0.72, 0.9, s2 * s) * exp(-x * 9.0) * 2.5;
    float edge = smoothstep(1.0, 0.75, r);
    col += uColor * (falloff * 0.6 + prom) * uCorona * edge * step(uDisc * 0.985, r);
  }
  if (uGlare > 0.0) {
    // Tight core, soft halo and four diffraction spikes — matches the point-sprite look of distant stars.
    float r2 = r * r;
    float g = exp(-r2 * 60.0) + 0.1 * exp(-r2 * 9.0);
    vec2 q = abs(vP);
    float spikes = exp(-q.y * 60.0) * exp(-q.x * 4.0) + exp(-q.x * 60.0) * exp(-q.y * 4.0);
    col += uColor * (g + spikes * 0.45) * uGlare * (1.0 - r2);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/** Gas and ice giants: banded jets, turbulence, long-lived storms, ring and moon shadows. */
export const GIANT_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
${LIGHT_GLSL}
uniform vec3 uPalette[4];
uniform vec4 uBands;        // band count, contrast, storm count, seed
uniform float uTime;
uniform float uDetail;
uniform float uRadius;
uniform vec3 uEmission;     // night-side glow of very hot giants
uniform vec3 uAtmoColor;
varying vec3 vLocal;
varying vec3 vWorldN;
varying vec3 vRel;

vec3 bandColor(float lat, vec3 p) {
  float seed = uBands.w;
  // Pixel footprint in latitude: detail finer than a pixel is averaged out, so a distant
  // giant shows clean bands instead of sparkling noise.
  float fw = fwidth(lat) + 1e-6;
  float lon = atan(p.y, p.x) / 6.2831853;   // one unit per turn: integer multiples wrap without a seam
  // Jet streams shear the turbulence east-west; latitude gets warped so bands waver.
  float flow = uTime * 0.004;
  float warp = (texture(uNoise, vec3(p.xy * 0.9, p.z * 0.9) + vec3(flow, 0.0, seed)).r - 0.5) * 0.09;
  float turb = uDetail > 0.3 ? (texture(uNoise, vec3(lon * 3.0 + flow * 6.0 * sign(sin(lat * uBands.x)), lat * 3.0, seed)).g - 0.5) * 0.05 : 0.0;
  float l = lat + warp + turb;
  float b = texture(uNoise, vec3(l * uBands.x * 0.045 + seed, seed * 0.73, 0.31)).r;
  float fine = 1.0 - smoothstep(0.3, 0.9, fw * uBands.x * 0.17 * 64.0);
  float b2 = mix(0.5, texture(uNoise, vec3(l * uBands.x * 0.17, 0.57, seed)).g, fine);
  float t = clamp(0.5 + (b - 0.5) * 2.2 * uBands.y + (b2 - 0.5) * 0.5 * uBands.y, 0.0, 1.0);
  vec3 c = mix(uPalette[0], uPalette[1], smoothstep(0.0, 0.55, t));
  c = mix(c, uPalette[2], smoothstep(0.5, 1.0, t));
  // Fine filaments along band edges.
  if (uDetail > 0.6) {
    float w = 1.0 - smoothstep(0.3, 0.9, fw * 14.0 * 64.0);
    c *= mix(1.0, 0.92 + 0.16 * texture(uNoise, vec3(lon * 9.0 + flow * 9.0, l * 14.0, seed)).r, w);
  }
  return c;
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vWorldN);
  vec3 v = normalize(-vRel);
  vec3 p = normalize(vLocal);
  float lat = asin(clamp(p.z, -1.0, 1.0));
  vec3 col = bandColor(lat, p);

  // Storms: ovals that swirl the cloud pattern around them (a Great Red Spot or two).
  int storms = int(uBands.z);
  for (int i = 0; i < 5; i++) {
    if (i >= storms) break;
    float fi = float(i) + uBands.w * 13.0;
    float slat = (fract(sin(fi * 12.9898) * 43758.5453) - 0.5) * 1.5;
    float slon = fract(sin(fi * 78.233) * 12543.123) * 6.2832 + uTime * 0.0015 * (1.0 + float(i));
    float size = 0.07 + 0.11 * fract(sin(fi * 3.17) * 911.7);
    vec3 c = vec3(cos(slat) * cos(slon), cos(slat) * sin(slon), sin(slat));
    vec3 d = p - c;
    // Stretch east-west.
    vec3 east = normalize(cross(vec3(0.0, 0.0, 1.0), c));
    float de = dot(d, east), dn = dot(d, cross(c, east));
    float rr = sqrt(de * de * 0.35 + dn * dn) / size;
    if (rr < 1.4) {
      float swirl = (1.0 - smoothstep(0.0, 1.4, rr)) * 2.5;
      float ang = atan(dn, de * 0.6) + swirl + uTime * 0.02;
      float spiral = 0.5 + 0.5 * sin(ang * 3.0 + rr * 9.0);
      vec3 sc = mix(uPalette[3], uPalette[2], spiral * 0.6);
      col = mix(col, sc, (1.0 - smoothstep(0.75, 1.3, rr)) * 0.9);
    }
  }
  // Polar haze.
  col = mix(col, mix(uPalette[0], uAtmoColor, 0.5), smoothstep(0.9, 1.45, abs(lat)) * 0.6);

  vec3 pw = n * uRadius;
  vec3 lit = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    vec3 ld = normalize(uLightPos[i] - pw);
    float ndl = dot(n, ld);
    // Thick atmospheres scatter light past the terminator.
    float day = smoothstep(-0.12, 0.35, ndl) * (0.25 + 0.75 * max(ndl, 0.0));
    lit += uLightColor[i] * day * sunVisibility(pw, i) * ringShadow(pw, i);
  }
  float mu = clamp(dot(n, v), 0.0, 1.0);
  col = col * lit * (0.55 + 0.45 * pow(mu, 0.4));
  // Hot giants glow on their own.
  col += uEmission * (0.5 + 0.8 * texture(uNoise, p * 0.8 + vec3(uTime * 0.01)).r);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Planetary rings: thousands of ringlets, lit from both sides, with the planet's shadow across them. */
export const RING_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vBody;   // position relative to the planet centre, world axes
varying vec3 vRel;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vRel = world.xyz;
  vBody = mat3(modelMatrix) * position;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>${CLIP_SAFE}
}`;

export const RING_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
${LIGHT_GLSL}
uniform vec3 uColor;
uniform float uPlanetRadius;
varying vec3 vBody;
varying vec3 vRel;
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vBody);
  float fr = fwidth(r);
  float dens = ringProfile(r, uRing, fr / max(uRing.y - uRing.x, 1.0));
  if (dens < 0.004) discard;
  vec3 v = normalize(-vRel);
  vec3 lit = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    vec3 ld = normalize(uLightPos[i] - vBody);
    // Planet shadow on the rings: does the ray toward the sun hit the planet sphere?
    float b = dot(vBody, ld);
    float c = dot(vBody, vBody) - uPlanetRadius * uPlanetRadius;
    float h = b * b - c;
    float shadow = (h > 0.0 && b < 0.0) ? 1.0 - smoothstep(0.0, uPlanetRadius * uPlanetRadius * 0.02, h) : 1.0;
    // Back-lit rings glow by forward scattering; the dense parts go dark instead.
    float side = dot(ld, uRingNormal) * dot(v, uRingNormal);
    float phase = side > 0.0 ? 1.0 : mix(1.4, 0.15, dens);
    float fwd = pow(max(dot(-ld, v), 0.0), 8.0) * 1.5 * (1.0 - dens);
    lit += uLightColor[i] * shadow * (0.35 + 0.65 * abs(dot(ld, uRingNormal))) * (phase + fwd) * sunVisibility(vBody, i);
  }
  float grain = mix(1.0, 0.9 + 0.2 * texture(uNoise, vec3(r / uPlanetRadius * 27.0, 0.3, uRing.w)).g, 1.0 - smoothstep(0.3, 0.9, fr / uPlanetRadius * 27.0 * 64.0));
  gl_FragColor = vec4(uColor * grain * lit * dens, dens);
}`;

/**
 * Atmosphere shell: single scattering with a few samples along the view ray.
 * Optical depth toward the sun is approximated analytically, so there is no
 * inner loop. Output is premultiplied: rgb = in-scattered light, a = 1 − transmittance.
 */
export const ATMO_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vRel;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vRel = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>${CLIP_SAFE}
}`;

export const ATMO_GLSL = /* glsl */ `
uniform vec3 uPlanetPos;     // planet centre relative to the camera (world axes)
uniform float uRadius;       // ground radius
uniform float uAtmoRadius;   // top of the atmosphere
uniform float uScaleHeight;
uniform vec3 uBetaR;         // Rayleigh scattering per metre at ground level
uniform vec3 uBetaM;         // Mie scattering per metre at ground level
uniform float uMieG;
uniform vec3 uSunDir[2];     // directions to the suns (world axes)
uniform vec3 uSunColor[2];

// Optical depth along direction 'd' from height h above the centre, per unit ground density (Chapman-like approximation).
float chapman(float h, float cosz) {
  float x = h / uScaleHeight;
  float c = sqrt(1.5707963 * x);
  float density = exp(-(h - uRadius) / uScaleHeight);
  if (cosz >= 0.0) return uScaleHeight * density * c / (c * cosz + 1.0);
  // Looking below the horizon: reflect about the tangent point.
  float sinz = sqrt(max(1.0 - cosz * cosz, 0.0));
  float h0 = h * sinz;
  if (h0 < uRadius) return 1e9;   // the planet is in the way
  float c0 = sqrt(1.5707963 * h0 / uScaleHeight);
  float d0 = exp(-(h0 - uRadius) / uScaleHeight);
  return uScaleHeight * (2.0 * d0 * c0 - density * c / (c * -cosz + 1.0));
}

// In-scattered light and transmittance along a ray from the camera (origin) in direction rd, up to distance tMax.
//
// The air is densest where the ray passes closest to the ground (at the camera when standing on the
// surface, at the tangent point when grazing the limb from space), so samples are bunched there with a
// quadratic warp; each segment is then integrated analytically (its own extinction included), which keeps
// colours right even with a handful of samples. No per-pixel jitter is needed, so the sky is free of noise.
vec4 scatter(vec3 rd, float tMax, int samples, float jitter) {
  vec3 oc = -uPlanetPos;                     // camera relative to the planet centre
  float b = dot(oc, rd);
  float c = dot(oc, oc) - uAtmoRadius * uAtmoRadius;
  float h = b * b - c;
  if (h <= 0.0) return vec4(0.0);
  float sq = sqrt(h);
  float t0 = max(-b - sq, 0.0);
  float t1 = min(-b + sq, tMax);
  if (t1 <= t0) return vec4(0.0);
  float len = t1 - t0;
  float tp = clamp(-b, t0, t1);              // closest approach to the planet centre along the ray
  float sA = -sqrt((tp - t0) / len);
  float sB = sqrt((t1 - tp) / len);
  float ds = (sB - sA) / float(samples);
  vec3 sigma = uBetaR + uBetaM * 1.1;
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float od = 0.0;
  for (int i = 0; i < 12; i++) {
    if (i >= samples) break;
    float sv = sA + (float(i) + jitter) * ds;
    float dt = 2.0 * abs(sv) * len * ds;      // dt/ds of t = tp + len · s|s|
    vec3 p = oc + rd * (tp + len * sv * abs(sv));
    float r = length(p);
    float dens = exp(-(max(r, uRadius) - uRadius) / uScaleHeight);
    // ∫ T ρ dτ over the segment, for light entering at its near end.
    vec3 seg = (1.0 - exp(-sigma * dens * dt)) / sigma;
    vec3 up = p / r;
    for (int s = 0; s < 2; s++) {
      float odSun = chapman(r, dot(up, uSunDir[s]));
      if (odSun > 1e8) continue;
      vec3 tr = exp(-sigma * (od + odSun));
      float mu = dot(rd, uSunDir[s]);
      float pr = 0.0596831 * (1.0 + mu * mu);
      float g = uMieG;
      float pm = 0.0795775 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
      sumR += tr * seg * pr * uSunColor[s];
      sumM += tr * seg * pm * uSunColor[s];
    }
    od += dens * dt;
  }
  // Single scattering only: the factor stands in for the multiply-scattered skylight that fills a real sky.
  vec3 inscatter = (sumR * uBetaR + sumM * uBetaM) * 16.0;
  vec3 trans = exp(-sigma * od);
  return vec4(inscatter, 1.0 - dot(trans, vec3(0.333)));
}
`;

export const ATMO_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMO_GLSL}
uniform float uSamples;
uniform vec4 uAurora;        // xyz = magnetic axis (world), w = strength
uniform float uTime;
${NOISE_GLSL}
varying vec3 vRel;
void main() {
  #include <logdepthbuf_fragment>
  vec3 rd = normalize(vRel);
  // Stop the ray at the ground sphere.
  vec3 oc = -uPlanetPos;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - uRadius * uRadius;
  float h = b * b - c;
  float tGround = (h > 0.0 && -b - sqrt(h) > 0.0) ? -b - sqrt(h) : 1e30;
  vec4 s = scatter(rd, tGround, int(uSamples), 0.5);
  vec3 col = s.rgb;
  if (uAurora.w > 0.0) {
    // Aurora: a glowing oval around each magnetic pole, on the night side, in a thin shell above the surface.
    float shell = uRadius + uScaleHeight * 12.0;
    float cc = dot(oc, oc) - shell * shell;
    float hh = b * b - cc;
    if (hh > 0.0) {
      float ta = -b - sqrt(hh);
      if (ta < 0.0) ta = -b + sqrt(hh);
      if (ta > 0.0 && ta < tGround) {
        vec3 p = normalize(oc + rd * ta);
        float colat = acos(clamp(abs(dot(p, uAurora.xyz)), 0.0, 1.0));
        float oval = exp(-pow((colat - 0.33) / 0.06, 2.0));
        vec3 e1 = normalize(cross(uAurora.xyz, vec3(0.3, 0.9, 0.31)));
        float lon = atan(dot(p, cross(uAurora.xyz, e1)), dot(p, e1));
        float curtains = texture(uNoise, vec3(lon * 0.9, uTime * 0.02, colat * 2.0)).r * texture(uNoise, vec3(lon * 4.3 + uTime * 0.05, 0.4, colat)).g;
        float night = smoothstep(0.15, -0.25, dot(p, uSunDir[0]));
        col += mix(vec3(0.1, 1.0, 0.45), vec3(0.6, 0.2, 1.0), smoothstep(0.3, 0.8, curtains * 3.0)) * oval * curtains * 5.0 * night * uAurora.w;
      }
    }
  }
  gl_FragColor = vec4(col, s.a);
}`;

/**
 * Cloud layer: a slightly larger sphere with drifting fractal cover, lit by the suns. Seen from
 * below it is part of the sky, so it gets the same aerial perspective as the terrain.
 */
export const CLOUD_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
${LIGHT_GLSL}
${ATMO_GLSL}
uniform float uHasAtmo;
uniform vec3 uColor;
uniform float uCover;
uniform float uTime;
uniform float uSeed;
uniform float uDetail;
uniform float uCloudRadius;   // radius of the cloud deck (uRadius is the ground)
varying vec3 vLocal;
varying vec3 vWorldN;
varying vec3 vRel;
void main() {
  #include <logdepthbuf_fragment>
  vec3 p = normalize(vLocal);
  float t = uTime * 0.0012;
  // Pixel footprint on the unit sphere: octaves finer than a pixel are faded out.
  float fw = length(fwidth(p));
  // Weather systems: large swirls (a domain warp) broken up by ever finer billows.
  vec3 q = p * 0.55 + vec3(uSeed, t, 0.0);
  vec3 swirl = vec3(texture(uNoise, q * 0.6 + vec3(0.0, 0.0, t)).r, texture(uNoise, q * 0.6 + vec3(5.2, 1.3, 0.0)).g, texture(uNoise, q * 0.6 + vec3(2.7, 8.1, t)).r) - 0.5;
  q += swirl * 0.5;
  float w = texture(uNoise, q).r * 0.5 + texture(uNoise, q * 2.3 + vec3(t * 1.7, 0.0, uSeed)).r * 0.26;
  float f3 = 1.0 - smoothstep(0.3, 0.9, fw * 0.55 * 5.1 * 64.0);
  float f4 = uDetail > 0.3 ? 1.0 - smoothstep(0.3, 0.9, fw * 0.55 * 11.7 * 64.0) : 0.0;
  float f5 = uDetail > 0.6 ? 1.0 - smoothstep(0.3, 0.9, fw * 0.55 * 27.0 * 64.0) : 0.0;
  w += mix(0.5, texture(uNoise, q * 5.1 + vec3(0.0, t * 3.0, 0.0)).g, f3) * 0.13;
  w += mix(0.5, texture(uNoise, q * 11.7 + vec3(t * 5.0, 0.3, 0.0)).a, f4) * 0.07;
  w += mix(0.5, texture(uNoise, q * 27.0 + vec3(0.7, t * 8.0, 0.0)).a, f5) * 0.04;
  float belts = 0.05 * cos(asin(clamp(p.z, -1.0, 1.0)) * 6.0);
  // The noise sum averages 0.5: shift the threshold so that roughly 'uCover' of the sky is cloudy.
  float th = 0.5 + (0.5 - uCover) * 0.55;
  float a = smoothstep(th, th + 0.16, w + belts);
  if (a < 0.01) discard;
  vec3 n = normalize(vWorldN);
  vec3 pw = n * uCloudRadius;
  float dist = length(vRel);
  vec3 v = -vRel / dist;
  // Seen from underneath, a cloud is lit through its own thickness: thick parts go grey.
  float below = step(dot(n, v), 0.0);
  float dense = smoothstep(th, th + 0.4, w + belts);
  vec3 lit = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    vec3 ld = normalize(uLightPos[i] - pw);
    float ndl = dot(n, ld);
    // Clouds catch light a little past the terminator and turn warm there.
    float day = smoothstep(-0.08, 0.25, ndl);
    vec3 tint = mix(vec3(1.0, 0.55, 0.35), vec3(1.0), smoothstep(0.0, 0.3, ndl));
    lit += uLightColor[i] * day * tint * sunVisibility(pw, i);
  }
  float shade = mix(0.78 + 0.22 * dense, 0.95 - 0.5 * dense, below);
  vec3 col = uColor * lit * shade;
  // From the ground, let the far deck thin out so the horizon shows sky rather than a white wall.
  float alpha = a * 0.96 * mix(1.0, 0.18, below * smoothstep(3.0e4, 4.0e5, dist));
  if (uHasAtmo > 0.5) {
    // The air between the eye and the cloud: distant cloud melts into the haze of the horizon.
    vec4 s = scatter(-v, dist, 4, 0.5);
    col = col * (1.0 - s.a) + s.rgb;
  }
  gl_FragColor = vec4(col * alpha, alpha);
}`;
