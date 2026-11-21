/**
 * Shared GLSL for unresolved light sources (stars, distant planets, asteroids).
 *
 * Photometric units: radiance 1.0 = white Lambertian surface lit face-on by
 * the Sun at 1 AU, so solar irradiance at 1 AU = PI and a source of apparent
 * V magnitude m has irradiance PI * 10^(-0.4 (m + 26.74)).
 * A point source is drawn as a small sprite whose integrated (pre-exposed)
 * value equals exposure * irradiance / pixelSolidAngle, so a planet fading
 * from a disk into a dot keeps the same total brightness.
 *
 * Display mapping: the eye's response to point sources is far from linear;
 * like SpaceEngine/Celestia we compress point energies with a power law
 * (uPointGamma, ~0.55) around energy 1. Culling still uses the physical value,
 * so the limiting magnitude is unaffected.
 */
export const PSF_UNIFORMS = /* glsl */ `
uniform float uExposure;
uniform float uPixelSA;
uniform float uMinEnergy;
uniform float uMaxRadius;
uniform float uGlare;
uniform float uPointGamma;
uniform float uPointGain;
uniform float uDpr;
uniform float uMaxEnergy;
uniform float uSat;
uniform float uHalo;   // halo/spike strength (1 for stars; small bodies use less)
uniform float uMinSigma; // width of the narrowest core (CSS px): half a pixel of the screen; wider in the headset
uniform float uPointLight; // a core's light per unit of energy (display value x CSS px^2)
`;

/*
 * Appearance of a point source. `energy` E is the displayed energy (physical, pre-exposed
 * irradiance per pixel compressed by a perceptual power law); `g` = log2(raw / threshold) is how
 * many factors of two the source is above the visibility limit. Modelled on how stars look in a
 * good wide-field photograph (and to the eye): every star is a sharp point; a brighter one is a
 * bigger point, and only the few brightest get a soft glow and, the very brightest, faint
 * diffraction spikes.
 *  - core: the star's light (uPointLight * E, and up to 2.5 times that for the bright ones) in
 *    a Gaussian. A faint star's is as narrow as the screen can show, half a pixel, and only as
 *    bright as its light makes it; a brighter one's middle goes white, then white-hot (up to
 *    PSF_HOT times white, which the tone curve bleaches of its colour), and it grows wider, but
 *    stays a point: the brightest are a few pixels across, not disks. The light is summed over
 *    each pixel's area (as a sensor collects it), not read at the pixel's middle: so a star a
 *    pixel wide is one, and it keeps its brightness as it drifts across the pixels (read at
 *    their middles such stars flicker, and look soft once made wide enough not to);
 *  - halo: a soft coloured glow round the brighter ones, from ~4 factors of two above the limit
 *    (the stars of the constellations' figures), wider and stronger with g: it, more than the
 *    core's size, says how bright a star is, and carries its colour;
 *  - spikes: four thin spikes from ~10 factors of two (uGlare scales them).
 * Values are display-referred (~0..1.3), so hue survives the tone curve; uSat sets the colour
 * saturation (1 = blackbody chromaticity).
 */
const PSF_CORE = /* glsl */ `
// the widest core (CSS px), and how many times white its middle may be
const float PSF_MAX_SIGMA = 1.2;
const float PSF_HOT = 3.0;
// x: the core's width (CSS px), y: the value at its middle; g: factors of two above the limit
vec2 psfCore(float energy, float g) {
  float light = uPointLight * energy * (1.0 + 1.5 * smoothstep(3.0, 10.0, g));
  float top = 1.0 + (PSF_HOT - 1.0) * smoothstep(5.0, 12.0, g);
  float sigma = clamp(sqrt(light / (6.2831853 * top)), uMinSigma, PSF_MAX_SIGMA);
  return vec2(sigma, min(light / (6.2831853 * sigma * sigma), top));
}
// the glow round a bright one: x its radius (CSS px), y its strength
vec2 psfHalo(float g) {
  return vec2(1.2 + 0.5 * max(g - 4.5, 0.0), 0.36 * smoothstep(4.0, 12.0, g));
}
`;

export const PSF_VERTEX = /* glsl */ `
${PSF_CORE}
float magToIrradiance(float m) { return 3.14159265 * exp2(-1.3287712 * (clamp(m, -60.0, 60.0) + 26.74)); }
// Returns sprite radius in CSS pixels (0 => cull). uPixelSA is the solid angle of one CSS pixel;
// callers set gl_PointSize = 2 * radius * uDpr so sprites keep their size on HiDPI screens.
float psfSetup(float irradiance, out float energy) {
  float raw = uExposure * irradiance / uPixelSA;
  if (!(raw >= uMinEnergy)) { energy = 0.0; return 0.0; }
  energy = min(uPointGain * pow(raw, uPointGamma), uMaxEnergy);
  float g = max(0.0, log2(raw / uMinEnergy));
  float rh = psfHalo(g).x;
  float halo = g > 4.0 ? rh * 3.0 * uHalo : 0.0;
  float spikes = g > 10.0 ? 5.0 * rh * uGlare * uHalo : 0.0;
  // (the core's tails, and never less than the pixels a point half a pixel wide falls on)
  float core = max(psfCore(energy, g).x * 3.4 + 0.5, 1.5 / uDpr);
  return min(uMaxRadius, max(core, max(halo, spikes)));
}
`;

/** A point's light summed over a pixel's area (shared with whatever else is drawn as a point). */
export const PSF_ON_PIXEL = /* glsl */ `
// erf (Winitzki's approximation, within 2e-4), and with it the share of a Gaussian of width s,
// centred x from a pixel's middle, that falls on that pixel (all in the screen's pixels)
float psfErf(float x) {
  float x2 = x * x;
  return sign(x) * sqrt(1.0 - exp(-x2 * (1.2732395 + 0.147 * x2) / (1.0 + 0.147 * x2)));
}
float psfOnPixel(float x, float s) {
  float k = 0.70710678 / s;
  return 0.5 * (psfErf((x + 0.5) * k) - psfErf((x - 0.5) * k));
}
`;

export const PSF_FRAGMENT = /* glsl */ `
${PSF_CORE}
${PSF_ON_PIXEL}
vec3 psfShade(vec2 pointCoord, float radius, float energy, vec3 color) {
  vec2 p = (pointCoord - 0.5) * 2.0 * radius;   // CSS pixels from centre
  float r2 = dot(p, p);
  float raw = pow(max(energy, 1e-6) / uPointGain, 1.0 / uPointGamma);
  float g = max(0.0, log2(raw / uMinEnergy));
  // the core: summed over the pixel where it is narrow, read off where it is wide (the same there)
  vec2 cw = psfCore(energy, g);
  float sigma = cw.x, sp = sigma * uDpr;
  float core = sp > 1.6
    ? cw.y * exp(-r2 / (2.0 * sigma * sigma))
    : cw.y * 6.2831853 * sp * sp * psfOnPixel(p.x * uDpr, sp) * psfOnPixel(p.y * uDpr, sp);
  float halo = 0.0, spikes = 0.0;
  if (g > 4.0) {
    vec2 hw = psfHalo(g);
    float rh = hw.x;
    halo = uHalo * hw.y * min(1.0, energy) / pow(1.0 + r2 / (rh * rh), 1.5);
    if (g > 10.0 && uGlare > 0.0) {
      float L = 5.0 * rh;
      vec2 a = abs(p);
      float s1 = exp(-a.y * 2.2) * (1.0 - smoothstep(0.0, L, a.x)) / (1.0 + 5.0 * a.x / L);
      float s2 = exp(-a.x * 2.2) * (1.0 - smoothstep(0.0, L, a.y)) / (1.0 + 5.0 * a.y / L);
      spikes = (s1 + s2) * 0.22 * smoothstep(10.0, 14.0, g) * uGlare * uHalo;
    }
  }
  float edge = 1.0 - smoothstep(0.8, 1.0, sqrt(r2) / radius);
  // the faintest stars drawn fade in over the last ~0.4 magnitudes above the cut-off instead of all
  // showing as equal specks (which read as a photograph's grain); the eye barely sees stars near
  // its limit, and their combined light is in the sky's glow already
  float lum = (core + halo + spikes) * edge * smoothstep(0.0, 0.55, g);
  // faint stars show little colour (the eye's colour vision fades with brightness); bright ones
  // their full (gently boosted) blackbody colour
  // (strongly coloured stars, blue OB stars above all, keep most of it: crowded fields of faint
  // blue points are what star-forming regions and galaxies seen from inside look like)
  float Yc = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float chroma = length(color - vec3(Yc)) / max(Yc, 1e-3);
  float sat = mix(mix(0.6, 0.95, smoothstep(0.15, 0.5, chroma)), uSat, smoothstep(2.0, 7.0, g));
  vec3 c = max(mix(vec3(Yc), color, sat), 0.0);
  return c * lum;
}
`;
