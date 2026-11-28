/**
 * Waves on a sea seen up close (the landing terrain's, swimming or walking by it: src/app/Walk.ts). Long-crested
 * swells and a chop, each a cosine moving at the speed deep water carries its wavelength (w = sqrt(g k)), given as
 * slopes along the ground's east and north (the material anchor's axes, so they stay put as the terrain is rebuilt);
 * each fades in only once the pixels resolve it, so a sea seen from higher up is as it was. The sea's normal is
 * tilted by them: the sunlight glitters on them, and the sky they reflect brightens the water towards the horizon.
 *
 * Needs MATERIAL_GLSL (uTanE, uTanN, uMatO) and uBodyToWorld.
 */
export const SEA_WAVES_GLSL = /* glsl */ `
vec2 seaWave(vec2 x, float t, vec2 d, float L, float a, float mpp) {
  float k = 6.2831853 / L;
  return d * (a * cos(k * dot(d, x) - sqrt(9.81 * k) * t) * smoothstep(0.6 * L, 0.15 * L, mpp));
}
// the sea's normal (world axes) at body-fixed offset pBF from the patch origin, at time t (s), mpp metres to a pixel
vec3 seaWaves(vec3 nW, vec3 pBF, float t, float mpp) {
  vec2 x = uMatO.xy + vec2(dot(pBF, uTanE), dot(pBF, uTanN));
  vec2 s = seaWave(x, t, vec2(0.8, 0.6), 23.0, 0.09, mpp)
         + seaWave(x, t, vec2(0.28, 0.96), 9.7, 0.08, mpp)
         + seaWave(x, t, vec2(-0.6, 0.8), 4.1, 0.07, mpp)
         + seaWave(x, t, vec2(0.97, -0.24), 1.9, 0.06, mpp)
         + seaWave(x, t, vec2(-0.86, -0.5), 0.83, 0.05, mpp);
  vec3 e = normalize(uBodyToWorld * uTanE), n = normalize(uBodyToWorld * uTanN);
  return normalize(nW - s.x * e - s.y * n);
}
`;
