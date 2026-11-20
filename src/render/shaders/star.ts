import { BLOOM_VEIL_GLSL } from './bloom';
import { FIX_LOGDEPTH, OUTPUT_FRAGMENT, PROJECT_PARS } from './xr';
import { FACE_KEY, FACE_TOP, PROM_SLOTS, SPOT_SLOTS } from '../StarLook';

/** Uniforms of a star's surface (StarLook.ts: starLookUniforms, applyStarLook). */
export const STAR_LOOK_UNIFORMS = /* glsl */ `
uniform float uSeed;
uniform vec3 uFaceK;       // how each colour of the face answers to its brightness (StarLook.faceResponse)
uniform vec3 uFaceP;
uniform float uTexFreq;    // the scale of the texture that stands out (threads across a radius), and
uniform float uTexAmp;     // its contrast
uniform float uMottle;     // unevenness of the whole face
uniform float uActive;     // how bright the active regions are
uniform float uLimb;       // the limb against the middle: brighter (> 0) or darker (< 0)
uniform float uGravDark;
uniform vec3 uAxis;        // the spin axis, in the mesh's own frame
uniform float uFlares;
uniform float uFlat;       // polar flattening of the drawn ellipsoid (fast rotators)
uniform float uSpin;       // how far the surface has turned (rad, within a turn)
uniform vec2 uBoil;        // where the surface is in its two cycles of seething (0..1 each)
uniform vec4 uSpotList[${SPOT_SLOTS}];   // each active region's spots: where one is now (unit, the mesh's frame), its angular radius
uniform int uSpotCount;
`;

/**
 * GLSL shared by the star's face and what stands round it: the face's colours.
 *
 * A face is designed in the display's own colours: fire(I) is what the screen shows where the
 * face is I times as bright as its mean (0.92 at the most: white-hot). The frame's tone curve
 * comes after (shaders/tone.ts), so the light that is written is the light the curve brings to
 * that colour: untone() is the curve's brightness response the other way round.
 */
export const STAR_FACE_GLSL = /* glsl */ `
float untone(float yt) {
  yt = min(yt, 0.985);
  float a = 1.0 - 0.983729 * yt, b = 0.0245786 - 0.432951 * yt, c = -(0.000090537 + 0.238081 * yt);
  return (-b + sqrt(b * b - 4.0 * a * c)) / (2.0 * a);
}
vec3 fire(float I, vec3 k, vec3 p) { return ${FACE_TOP.toFixed(2)} * (1.0 - exp(-k * pow(vec3(max(I, 0.0)), p))); }
// The light to write for the face's colour at brightness I, the exposure being level times the
// designed one. (A face shown brighter is shown hotter, further up its own colours: orange, then
// yellow, then white. Its light simply multiplied, the tone curve turns an orange pink.)
vec3 faceLight(float I, vec3 k, vec3 p, float level) {
  vec3 d = fire(I * level, k, p);
  float y = max(dot(d, vec3(0.2126, 0.7152, 0.0722)), 1e-5);
  return d * (untone(y) / y);
}
`;

/**
 * A star's face, the way the space observatories show the Sun's (StarLook.ts chooses the numbers
 * for each kind of star):
 *
 *  - the plasma: bright threads winding between darker ground, at every scale from the whole disk
 *    down to what the pixels show (octave on octave, each fading in as the eye comes near enough
 *    to resolve it, so there is something to see from any distance), the scale that stands out
 *    being the star's own; all of it seething in place;
 *  - what is darker is deeper in the star's colour, what is brighter paler, the brightest
 *    white-hot (fire): on the Sun red, orange, yellow, white;
 *  - the Sun wears its own face: a map of the real one in the light those pictures are taken in
 *    (uMap; pipeline/build_sun_map.py) gives the pattern, active regions and all, in place of the
 *    drawn one, which keeps the poles, everything finer than the map shows, and the seething;
 *  - active regions where the star's spots are, in its two belts, each going round at its own
 *    latitude's rate (StarLook.spotAt): bright threaded ground, a white-hot core over each spot;
 *  - a cool star's limb is a little brighter than its face (its glowing skin, seen edge on), a
 *    hot star's darker (its photosphere); fast rotators are darker round the equator; and active
 *    red dwarfs flare.
 */
export const STAR_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uRadiance;    // mean disk radiance (photometric units)
uniform float uExposure;
uniform float uTime;
uniform mat3 uBodyToWorld;
uniform float uLite;        // headset tier: fewer octaves
uniform float uPixelSA;     // solid angle of a CSS pixel of the pass being drawn, and
uniform float uDpr;         // how many of its own pixels one takes
uniform float uRadiusM;     // the star's radius (m)
${STAR_LOOK_UNIFORMS}
uniform sampler2D uMap;     // the star's own face where there is a map of it (the Sun's): its brightness
uniform float uHasMap;      // over the median, stored as sqrt(p / 4) (pipeline/build_sun_map.py)
varying vec3 vNormalBF;
varying vec3 vPosView;
varying vec2 vUv;
// the finest threads drawn take this many of the screen's own pixels (finer ones would only flicker)
const float GRAIN = 7.0;
// a map shows what is this fine (waves across a radius) and coarser: 4096 pixels round the star,
// soft over five or so of them
const float MAP_FINE = 140.0;
// the map's brightness to this power is the face's (the map is a picture scaled to show
// everything at once, flatter than the face is designed; set against the observatories' own
// pictures of the disk: its darks, its middle and its brights come out as theirs)
const float MAP_CONTRAST = 1.4;
// how much of the drawn pattern's ground shows on a map, as its seething
const float MAP_SEETHE = 0.4;
// the level (over the designed one) at which a face is white-hot all over
const float WHITE_HOT = 6.0;
// a turn between one octave and the next: no two lie the same way
const mat3 TURN = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
float h3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
// arithmetic hash (no sin: sin of large arguments loses all precision and the pattern lines up on a grid)
vec3 h33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float n3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// three noises at once (a displacement), for the price of little more than one
vec3 n33(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h33(i), h33(i + vec3(1,0,0)), f.x), mix(h33(i + vec3(0,1,0)), h33(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h33(i + vec3(0,0,1)), h33(i + vec3(1,0,1)), f.x), mix(h33(i + vec3(0,1,1)), h33(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { return 0.55 * n3(p) + 0.3 * n3(p * 2.1 + 7.0) + 0.15 * n3(p * 4.3 + 13.0); }
vec3 rotateAbout(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
${STAR_FACE_GLSL}
${BLOOM_VEIL_GLSL}

void main() {
  // the surface normal of the drawn (flattened) ellipsoid: with the sphere's own normal the limb of
  // a fast rotator came out dark on one side (that normal faces away along part of the outline)
  vec3 nE = normalize(vNormalBF + uAxis * dot(vNormalBF, uAxis) * (1.0 / max(1.0 - uFlat, 0.3) - 1.0));
  vec3 nW = normalize(uBodyToWorld * nE);
  vec3 V = normalize(-vPosView);
  float mu = clamp(dot(nW, V), 0.0, 1.0);
  vec3 nB = normalize(vNormalBF);
  float lat = dot(nB, uAxis);
  // the pattern goes round with the star, all of a piece (the active regions carry the difference
  // between the latitudes: a pattern sheared by it would wind itself up into streaks within minutes)
  vec3 q = rotateAbout(nB, uAxis, -uSpin);
  // (the seed moves the pattern: added to its own coordinates, where it costs no precision)
  vec3 off = fract(uSeed * vec3(0.01371, 0.02713, 0.04127)) * 8.0;
  // how many CSS pixels a radius of the star takes at this distance, seen face on; and how many
  // of the screen's own, seen as edge on as this place is (by the root of it: the texture is
  // drawn up to the limb, flattened against it, which is what makes the disk a ball)
  float pxPerRad = uRadiusM / max(length(vPosView) * sqrt(uPixelSA), 1e-30);
  float px = pxPerRad * uDpr * sqrt(max(mu, 0.02));
  // How much of this place is the star's own map. (None towards the poles: no spacecraft has
  // looked down on the Sun's, the map is smeared there, and the drawn pattern takes over.)
  float mapped = uHasMap * (1.0 - smoothstep(0.74, 0.88, abs(lat)));

  // --- the plasma: mottled ground, and short threads of light curling over it, octave on octave
  // from an eighth of the scale that stands out down to what the pixels show
  // (nothing runs straight: the whole pattern is bent, by about one of its own threads' spacing)
  vec3 w = q + (1.6 / uTexFreq) * (n33(q * (0.3 * uTexFreq) + off) - 0.5) + (0.5 / uTexFreq) * (n33(q * (1.1 * uTexFreq) + off.zxy) - 0.5);
  float f = uTexFreq * 0.125;
  vec3 p = w * f + off;
  float ground = 0.0, threads = 0.0, under = 0.0;
  for (int k = 0; k < 15; k++) {
    float vis = smoothstep(0.5 * GRAIN, GRAIN, px / f);
    if (vis <= 0.0 || (uLite > 0.5 && k > 6)) break;
    // each octave swings round its own place to its own beat: the surface seethes, and drifts nowhere
    float kf = float(k);
    float ph = 6.2831853 * ((mod(kf, 2.0) < 0.5 ? uBoil.x : uBoil.y) * (1.0 + mod(kf, 3.0)) + 0.37 * kf);
    vec3 v = n33(p + 0.45 * vec3(cos(ph), sin(ph), cos(ph + 2.1)));
    float a = f < uTexFreq ? pow(f / uTexFreq, 1.6) : pow(uTexFreq / f, 0.55);
    // (on a map only what is finer than the map shows is drawn; of the rest, the ground alone
    // is kept aside: by it the map's own picture seethes)
    float finer = mix(1.0, smoothstep(0.5 * MAP_FINE, MAP_FINE, f), mapped);
    under += a * vis * (1.0 - finer) * (2.0 * v.z - 1.0);
    a *= finer;
    ground += a * vis * (2.0 * v.z - 1.0);
    // a thread of light where one pattern crosses its middle, cut short where another is low:
    // curls and dashes, not a net of rings
    float g = 2.0 * v.x - 1.0;
    threads += a * vis * (exp(-16.0 * g * g) * smoothstep(0.42, 0.62, v.y) - 0.2);
    p = TURN * p * 2.0 + 7.3;
    f *= 2.0;
  }
  // the face as a whole is uneven too: brighter and darker over tenths of the radius
  float I = 1.0 + uMottle * 2.0 * (fbm3(q * 1.7 + off) + 0.5 * n3(q * 4.3 + off.yzx) - 0.75);
  float fine = max(1.0 + uTexAmp * (0.5 * ground + 1.25 * threads), 0.12);
  I *= fine;
  if (uHasMap > 0.0) {
    // The map goes round with the star, as the drawn pattern does. Its brightness becomes the
    // face's (steeper at the top: the core of an active region is white-hot), the fine threads
    // are drawn over it, and it seethes: a map is one moment, so the drawn pattern's ground
    // brightens and dims it from place to place as it swings.
    float m = texture2D(uMap, vec2(vUv.x - uSpin / 6.2831853, vUv.y)).r;
    float bright = 4.0 * m * m;
    float own = pow(bright, MAP_CONTRAST + 0.4 * smoothstep(1.4, 2.6, bright));
    I = mix(I, own * fine * (1.0 + MAP_SEETHE * uTexAmp * under), mapped);
  }

  // --- active regions: bright threaded ground round the star's spots, a white-hot core over each
  // (a map shows the star's own)
  for (int k = 0; k < ${SPOT_SLOTS}; k++) {
    if (k >= uSpotCount || mapped >= 1.0) break;
    vec4 s = uSpotList[k];
    float c = dot(nB, s.xyz);
    float chord2 = 2.0 - 2.0 * c;                       // (the chord: the angle, near enough)
    if (chord2 > 44.0 * s.w * s.w) continue;
    float r0 = sqrt(max(chord2, 0.0)) / s.w;            // how far from its middle, in its own radii
    vec3 away = normalize(nB - s.xyz * c + 1e-6);       // and which way
    float rag = n3(nB * (1.1 / s.w) + s.xyz * 7.0);
    float fibre = 1.0 - abs(2.0 * n3(away * 4.0 + nB * (1.7 / s.w) + s.xyz * 13.0) - 1.0);
    // (a small spot's bright ground reaches six of its radii, a vast one's not three: no star is all active region)
    float reach = clamp(1.05 / sqrt(s.w), 2.6, 6.0);
    float around = 1.0 - smoothstep(0.3, reach, r0 * (0.55 + 0.9 * rag));
    float core = exp(-1.3 * r0 * r0 / (0.45 + rag));
    // (the ground round a spot is the face's own texture, brighter; a spot's core is white-hot)
    I += (1.0 - mapped) * uActive * (around * sqrt(around) * (0.7 + 1.9 * fibre * fibre + 1.6 * max(threads, 0.0)) + (1.5 + 0.5 * reach) * core);
  }

  // --- the limb, and a fast rotator's dark equator
  float edge = 1.0 - mu;
  I *= uLimb > 0.0 ? 1.0 + uLimb * edge * edge * edge : 1.0 + uLimb * edge;
  I *= 1.0 - uGravDark * (1.0 - lat * lat);
  // flares on active red dwarfs: a patch that flashes white and fades
  if (uFlares > 0.0) {
    float epoch = floor(uTime / 23.0);
    if (h3(vec3(epoch, uSeed, 3.0)) < uFlares * 2.0) {
      vec3 fp = normalize(h33(vec3(epoch, uSeed, 7.0)) * 2.0 - 1.0);
      float age = fract(uTime / 23.0) * 23.0;
      I += 9.0 * exp(-age / 3.0) * smoothstep(0.0, 0.5, age) * exp(-pow(length(nB - fp) / 0.08, 2.0));
    }
  }
  float level = uRadiance * uExposure / ${FACE_KEY.toFixed(3)};
  vec3 light = faceLight(I, uFaceK, uFaceP, level);
  // The frame's bloom will lay a veil of the face's own light over it: that much of the face's
  // mean is left out here, and the frame shows the face as it is designed. (Left in, the veil
  // lifted a large orange disk half-way up the tone curve's shoulder: salmon pink, and flatter.)
  if (uBloom > 0.0) {
    float diskPx = pxPerRad * uDpr;
    vec2 veil = bloomVeil(diskPx, diskPx * (1.0 - sqrt(1.0 - mu * mu)));
    light = max(light - veil.x / (1.0 + veil.y) * faceLight(1.0, uFaceK, uFaceP, level), 0.0);
  }
  // Far above the level at which a face is white-hot all over, its light is as bright as it is.
  // (A disk too small to hold the exposure, seen with the eye open for the dark: a sun from among
  // its planets, the companion star beside a black hole. Its colours' top is the display's white,
  // and a pixel or two of that is a faint dot: the frame's bloom makes the star's glare of the
  // light beyond it.)
  light *= max(1.0, level / WHITE_HOT);
  gl_FragColor = vec4(min(light, vec3(6.0e4)), 1.0);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;

/**
 * What stands round a star's disk (StarCorona.ts): its corona, its chromosphere and its
 * prominences, on a quad facing the eye.
 */
export const CORONA_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PROJECT_PARS}
uniform float uCopy;      // the quad is on a copy of the star this many times nearer the eye (StarCorona), and
uniform float uRadiusM;   // the star's radius (m)
varying vec2 vXY;
varying vec3 vToFrag;     // from the eye to this point of the quad, and to the star's centre (view space)
varying vec3 vToStar;
void main() {
  vXY = position.xy;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vToFrag = mv.xyz;
  vToStar = modelViewMatrix[3].xyz;
  gl_Position = projectView(mv);
  // In depth the glow lies just behind the star: the star's face hides what of it is behind
  // (to the pixel: no gap at the limb, and no light laid over it), and so does whatever passes in
  // front of the star.
  float depth = -vToStar.z / uCopy + uRadiusM;
  vec4 behind = projectionMatrix * vec4(0.0, 0.0, -depth, 1.0);
  gl_Position.z = behind.z / behind.w * gl_Position.w;
  gTrueDepth = depth;
  #include <logdepthbuf_vertex>
${FIX_LOGDEPTH}
}`;

/**
 *  - the corona: a glow hugging the limb, and reaching out of it streamers with fine rays in
 *    them. They are laid out by the star's axis as it is seen: a quiet star's stand over its
 *    equator and leave its poles to short, fine plumes (the Sun's at the low of its cycle); an
 *    active star has them all round. A hot star's wind and a supergiant's envelope are nearly even.
 *  - the chromosphere: a thin red skin on the limb, ragged with spicules;
 *  - the prominences (StarLook.proms), each where it stands as seen from here (StarCorona works
 *    that out every frame: they go round with the star, rise over the limb and set behind it): a
 *    loop is strands of light along an arch between its two feet, a curtain threads hanging
 *    under one, slowly raining down.
 */
export const CORONA_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;       // the glow's colour (luminance 1)
uniform float uIntensity;  // display value of the glow at the limb
uniform float uQuad;       // quad half-size in star radii
uniform float uCorona;
uniform float uRays;       // how much of the corona is streamers and rays (0: an even glow)
uniform float uChromo;     // how bright the glowing skin at the limb is (0: the star has none), and
uniform float uProm;       // the star's prominence activity
uniform vec3 uFaceK;       // the face's colours (StarLook.faceResponse), and
uniform vec3 uFaceP;
uniform float uLevel;      // how the exposure stands to the one they are designed for
uniform float uSeed;
uniform float uTime;
uniform vec2 uAxis2;       // the star's spin axis as it lies on the quad (unit), and
uniform float uAxisSee;    // how much of it is across the line of sight (0: the star is seen pole on)
uniform float uMinor;      // the disk's half-width along it (a flattened star's disk is an ellipse)
uniform float uSinLimb;    // sine of the disk's angular radius: where the sight lines graze the sphere
uniform float uLimbPx;     // the disk's radius on the screen (CSS px)
uniform vec4 uPromFeet[${PROM_SLOTS}];   // each prominence as seen: its two feet, and
uniform vec4 uPromTop[${PROM_SLOTS}];    // its top (on the quad, in units of the limb's radius); 1 for a curtain, 0 for a loop; a number of its own
uniform int uPromCount;
varying vec2 vXY;
varying vec3 vToFrag;
varying vec3 vToStar;
${STAR_FACE_GLSL}
float h2(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.y); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 p = vXY * uQuad;                   // in star radii
  // Distance from the centre in units of the disk's edge: by the angle between this sight line
  // and the one to the star's centre, so that 1 is where the sphere's outline is, wherever in the
  // frame the star stands. A flattened star's outline is an ellipse: narrower along its axis.
  float cosA = dot(normalize(vToFrag), normalize(vToStar));
  float apart = sqrt(max(1.0 - cosA * cosA, 0.0)) / uSinLimb;
  float r = apart * length(vec2(dot(p, vec2(-uAxis2.y, uAxis2.x)), dot(p, uAxis2) / uMinor)) / max(length(p), 1e-6);
  // (The star hides the glow behind it. The glow is far fainter than the limb it rises from:
  // a star's limb is its darkest part, and a glow that outshines it rims the star with light.)
  float h = max(r - 1.0, 0.0);            // height over the limb, in radii
  vec2 ring = normalize(vXY + 1e-9);      // (noise on the circle: periodic in angle)
  // the same by the star's own axis as seen: x along its equator, y along its axis
  vec2 ra = vec2(dot(ring, vec2(uAxis2.y, -uAxis2.x)), dot(ring, uAxis2));
  float pole = abs(ra.y) * uAxisSee;      // 1 over a pole
  float outside = smoothstep(0.9, 0.98, r);

  // --- the corona. Streamers: in some directions the glow reaches far out, in others it hugs
  // the limb; fine rays within them; all of it slowly changing.
  float belt = mix(1.0 - smoothstep(0.35, 0.85, pole), 1.0, smoothstep(0.2, 0.7, uProm));
  float broad = n2(ra * 1.7 + uSeed + vec2(0.0, uTime * 0.004));
  float rays = 0.5 * n2(ra * 6.0 + uSeed * 1.7 + vec2(uTime * 0.008, 0.0)) + 0.3 * n2(ra * 17.0 + uSeed * 0.3 + h * 0.8)
    + 0.2 * n2(ra * 43.0 + uSeed * 0.7 + h * 0.5);
  float reach = (0.25 + 1.5 * broad * broad) * (0.3 + 0.7 * belt);
  float streamer = (0.3 + 0.7 * rays) * exp(-h / reach) / (1.0 + 5.0 * h * h);
  float plumes = (1.0 - belt) * pow(n2(ra * 61.0 + uSeed), 2.0) * exp(-h * 3.5);
  float even = 0.5 * exp(-h * 2.2) / (1.0 + 5.0 * h * h);
  float glow = uCorona * (0.6 * exp(-h * 10.0) + 0.4 * mix(even, streamer + plumes, uRays));
  glow *= (1.0 - smoothstep(0.7, 1.0, length(vXY))) * outside;

  // --- the glowing skin of a cool star, seen edge on: a halo of the face's own darker light
  // hugging the limb, a twenty-fifth of the radius deep, ragged with spicules (where the disk is
  // large enough to show them)
  float sp = mix(0.5, 0.6 * n2(ra * 90.0 + uSeed) + 0.4 * n2(ra * 230.0 + uSeed * 2.0 + uTime * 0.07), smoothstep(60.0, 220.0, uLimbPx));
  float deep = 0.6 + 0.9 * n2(ra * 9.0 + uSeed * 1.3 + vec2(0.0, uTime * 0.01));      // (deeper here, shallower there)
  float skin = uChromo * 0.9 * exp(-h / (0.04 * deep * (0.55 + 0.9 * sp))) * outside;
  float red = 0.0;

  // --- the prominences
  vec2 here = r * ring;                   // this place on the quad, in units of the limb's radius
  for (int k = 0; k < ${PROM_SLOTS}; k++) {
    if (k >= uPromCount) break;
    vec4 feet = uPromFeet[k], top = uPromTop[k];
    vec2 m = 0.5 * (feet.xy + feet.zw), u = 0.5 * (feet.zw - feet.xy), v = top.xy - m;
    vec2 d = here - m;
    float size = length(u) + length(v);
    if (dot(d, d) > 2.6 * size * size) continue;
    // where in the arch: al along its feet (-1 to 1), be up to its top (0 to 1); ell is 1 on the arch
    float det = u.x * v.y - u.y * v.x;
    float al = (d.x * v.y - d.y * v.x) / det;
    float be = (u.x * d.y - u.y * d.x) / det;
    float ell = length(vec2(al, be));
    float up = smoothstep(-0.12, 0.08, be);
    float num = top.w * 57.0 + uSeed;
    float detail = smoothstep(4.0, 14.0, size * uLimbPx);       // (too small on the screen for its threads)
    if (top.z > 0.5) {
      // a curtain: threads hanging down, slowly raining
      float threads = 0.65 * n2(vec2(al * 11.0 + num, be * 2.2 + uTime * 0.03)) + 0.35 * n2(vec2(al * 29.0 + num, be * 5.0 + uTime * 0.05));
      threads = mix(0.5, threads, detail);
      float body = 1.0 - smoothstep(0.7, 1.05, ell + 0.3 * (threads - 0.5));
      red += up * body * (0.2 + 1.3 * threads * threads) * (0.45 + 0.55 * be);
    } else {
      // a loop: three strands of light along the arch, one inside the other, light running
      // along them (too small on the screen for strands, one soft arch)
      float ang = atan(be, al);
      float wob = 0.05 * (n2(vec2(ang * 2.3 + num, 3.0)) - 0.5);
      float inner = clamp(floor((1.0 - ell + wob) / 0.16 + 0.5), 0.0, 2.0);
      float off = (1.0 - ell + wob) - 0.16 * inner;
      float strands = exp(-pow(off / 0.04, 2.0)) * (1.0 - 0.3 * inner) * (0.45 + 0.9 * n2(vec2(ang * 4.0 + num + 7.0 * inner, uTime * 0.06)));
      float soft = exp(-pow((ell - 0.9) / 0.22, 2.0)) * 0.6;
      red += up * mix(soft, strands, detail);
    }
  }
  red *= outside;
  // (The gas of a prominence glows in the face's own colours, like the skin it stands in: its
  // body a little deeper than the face's mean, its brightest threads paler. The two together are
  // one brightness of those colours: their lights added up, the tone curve turned a prominence
  // against the skin pale pink.)
  vec3 c = uColor * glow * uIntensity + faceLight(skin + 0.9 * min(red, 1.6), uFaceK, uFaceP, uLevel);
  gl_FragColor = vec4(c, 1.0);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;
