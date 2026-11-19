/**
 * Small GLSL snippets shared by the depth-tested shaders.
 */

/**
 * Put right after `#include <logdepthbuf_vertex>` in a vertex shader.
 *
 * Bodies are drawn where they are, up to 10^13 m from the camera, with a far plane at 10^27 m. Two
 * things then go wrong in clip space on some rasterisers, although the image is mathematically fine:
 *
 *   - float32 rounds z/w to exactly 1 for anything more than a few thousand kilometres away — right
 *     on the far clipping plane. Depth comes from the logarithmic value written per fragment, so the
 *     projected z is not needed: it is pinned to the middle of the clip volume.
 *   - clipping triangles whose coordinates are of order 10^12 loses precision. Multiplying all four
 *     components by one positive number per object does not change the projection, so everything is
 *     scaled by the inverse distance of the object's origin (its model matrix translation; the camera
 *     sits at the world origin).
 *
 * The distance is computed overflow-safe: a plain length() squares its argument, and 32-bit floats
 * run out at 3.4·10^38 — the square of a mere 600 parsecs in metres.
 */
const safeScale = (v: string): string => /* glsl */ `
  {
    vec3 o_ = ${v};
    float m_ = max(max(abs(o_.x), abs(o_.y)), max(abs(o_.z), 1.0));
    gl_Position *= 1.0 / max(m_ * length(o_ / m_), 1.0);
  }`;

export const CLIP_SAFE = /* glsl */ `
  #ifdef USE_LOGDEPTHBUF
    gl_Position.z = 0.0;
  #endif${safeScale('modelMatrix[3].xyz')}`;

/** Same, for billboards placed by a `uCenter` uniform instead of a model matrix. */
export const CLIP_SAFE_BILLBOARD = /* glsl */ `
  #ifdef USE_LOGDEPTHBUF
    gl_Position.z = 0.0;
  #endif${safeScale('uCenter')}`;
