import { FIX_LOGDEPTH, OUTPUT_FRAGMENT, PROJECT_PARS } from './xr';

/** a jet starts this far from its hole (rs) */
export const JET_BASE = 3;

/**
 * The glow of a hole's two jets along a sight line: `jetGlow`, for whoever draws a sight line (the
 * jets' own meshes, JET_FRAG, and the black hole's pass, which draws the jets itself where it
 * draws the hole: shaders/blackhole.ts). Lengths in Schwarzschild radii, the hole at the origin.
 *
 * What is physical: the shape (a parabola 1.5 z^0.58 out to 1e5 rs, as measured for M87 by Asada &
 * Nakamura 2012, then a narrow cone); that the glow is strongest along the spine and falls off
 * outwards; and the beaming: gas coming towards the eye at a good part of the speed of light is
 * brighter by 1 / (1 - beta cos)^(2 + alpha), gas going away fainter, so from the side both jets
 * show alike and from near the axis only the one coming on (M87's other jet is not seen from Earth).
 * What is stylised: how bright it is (a level for the display, not a measured one); the speed
 * (JET_BETA: slower than M87's gas, which would leave nothing of the far jet from most places);
 * how fast it fades with distance (JET_FALL); the knots and the threads winding round the spine
 * (generated: no measured knot is put where it is), which drift outwards far faster than any gas.
 */
export const JET_GLSL = /* glsl */ `
uniform vec4 uJet;       // a jet's length, the height at which it turns from a parabola into a cone, its radius there, the cone's slope
uniform vec4 uJetGlow;   // its colour as bright as it is drawn from the side (rgb; none: no jets), and a seed for its look (a)
uniform vec2 uJetView;   // the time (s), and the angle of one pixel of the frame (rad)

const float JET_BASE = ${JET_BASE.toFixed(1)};
const float JET_BETA = 0.7;     // the gas's speed, of light's
const float JET_BOOST = 8.0;    // the most the beaming is drawn as (straight down a jet it would be thirty)
const float JET_FALL = 0.22;    // its glow falls as its height to this power
const int JET_STEPS = 14;

float jetHash(float n) {
  n = fract(n * 0.1031);
  n *= n + 33.33;
  n *= n + n;
  return fract(n);
}
float jetNoise(float x) {
  float i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(jetHash(i), jetHash(i + 1.0), f);
}
float jetRadius(float z) {
  return z < uJet.y ? 1.5 * pow(z, 0.58) : uJet.z + (z - uJet.y) * uJet.w;
}

// The jets' glow along the sight line from O (rs from the hole) towards d; \`axis\`: the way one of
// them goes. Beyond \`tDisk\` along the line they show only through the disk (\`through\` of it), and
// beyond \`tHole\` only if the line gets past the hole (\`past\`).
vec3 jetGlow(vec3 O, vec3 d, vec3 axis, float tDisk, float through, float tHole, float past) {
  if (uJetGlow.r + uJetGlow.g + uJetGlow.b <= 0.0) return vec3(0.0);
  float zO = dot(O, axis), zd = dot(d, axis);
  vec3 wO = O - axis * zO, wd = d - axis * zd;
  // (a line within three degrees of the axis is taken as three degrees off it: it would run
  // inside the jet for ever)
  float across = max(dot(wd, wd), 2.5e-3);
  // The line passes nearest the axis at tNear: its way through a jet lies about there, some
  // widths of the jet long. (The widths are those the jet has there, and as wide as a pixel is
  // there at the least: thinner, a jet would be drawn in dots.)
  float tNear = -dot(wO, wd) / across;
  float zNear = clamp(abs(zO + zd * tNear), JET_BASE, uJet.x);
  float reach = 1.6 * max(jetRadius(zNear), max(tNear, 0.0) * uJetView.y) / sqrt(across);
  vec3 e1 = normalize(cross(axis, abs(axis.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(axis, e1);
  float sum = 0.0;
  for (int i = 0; i < JET_STEPS; i++) {
    float t = tNear + reach * ((float(i) + 0.5) / float(JET_STEPS) * 2.0 - 1.0);
    if (t <= 0.0) continue;
    vec3 P = O + d * t;
    float zs = dot(P, axis), z = abs(zs);
    if (z < JET_BASE || z > uJet.x) continue;
    float R = jetRadius(z), wide = max(R, t * uJetView.y);
    vec3 w = P - axis * zs;
    float q2 = dot(w, w) / (wide * wide);
    if (q2 >= 1.0) continue;
    float side = sign(zs), lz = log(z), q = sqrt(q2);
    // gas going out along the axis: beamed towards the eye on the side that comes its way
    float boost = min(pow(1.0 - JET_BETA * (-side * zd), -2.7), JET_BOOST);
    float along = smoothstep(JET_BASE, 2.0 * JET_BASE, z) * exp(-JET_FALL * (lz - log(JET_BASE))) * (1.0 - smoothstep(0.6 * uJet.x, uJet.x, z));
    // a bright spine, threads of gas winding round it, and knots that lean with the winding:
    // brighter stretches of the whole jet, and here and there a bright one on the spine
    float wind = 2.0 * atan(dot(w, e2), dot(w, e1)) - 4.0 * lz + side * 2.0 + uJetGlow.a;
    float spine = exp(-q2 / 0.16) * (1.0 - q2) * (1.0 - q2);
    float threads = 1.0 + 0.8 * q * cos(wind);
    float drift = lz - uJetView.x * 0.004 + 0.1 * q * cos(0.5 * wind);
    float knots = 0.5 + pow(jetNoise(drift * 2.8 + side * 13.7 + uJetGlow.a), 2.0)
      + 2.4 * pow(jetNoise(drift * 5.3 + side * 7.1 + uJetGlow.a), 6.0) * exp(-q2 / 0.06);
    float seen = (t > tDisk ? through : 1.0) * (t > tHole ? past : 1.0);
    // (a jet thinner than a pixel is drawn a pixel wide and fainter by as much: the same light)
    sum += boost * along * knots * spine * threads * seen * R / (wide * wide);
  }
  return uJetGlow.rgb * (sum * 2.0 * reach / float(JET_STEPS));
}
`;

/** The tube that holds a pair of jets: its far wall is what is drawn, a sight line to each pixel. */
export const JET_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PROJECT_PARS}
attribute float aRadius;   // the tube's radius here (rs)
uniform float uClipScale;
uniform float uRs;         // metres per rs
uniform vec2 uJetView;
varying vec3 vRay;
void main() {
  // Where the jet is thinner than two pixels the tube is that wide all the same: it bounds what
  // is drawn, and the glow is no thinner than a pixel. (Lengths are measured scaled down by
  // uClipScale: in metres a kiloparsec squared is more than a 32-bit float holds, and the tube
  // was gone beyond 600 parsecs.)
  vec4 centre = modelMatrix * vec4(position - normal * aRadius, 1.0);
  vec3 toCentre = (centre.xyz - cameraPosition) * uClipScale;
  float thick = max(aRadius * uRs * uClipScale, 2.0 * uJetView.y * length(toCentre));
  vRay = toCentre + normalize(mat3(modelMatrix) * normal) * thick;
  vec4 wp = vec4(cameraPosition + vRay / uClipScale, 1.0);
  gl_Position = projectView(viewMatrix * wp);
  #include <logdepthbuf_vertex>
${FIX_LOGDEPTH}
  // clip coordinates of a kiloparsec jet overflow 32-bit floats in clipping: one factor per mesh
  gl_Position *= uClipScale;
}`;

export const JET_FRAG = /* glsl */ `
precision highp float;
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uO;      // the eye from the hole (rs)
uniform vec3 uAxis;   // the way one of the jets goes
uniform float uRs;
varying vec3 vRay;
${JET_GLSL}
void main() {
  gl_FragColor = vec4(jetGlow(uO + cameraPosition / uRs, normalize(vRay), uAxis, 1e30, 1.0, 1e30, 1.0), 1.0);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;
