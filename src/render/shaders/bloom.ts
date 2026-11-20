/**
 * The frame's bloom, as a material that has to allow for it knows it (Renderer.ts draws it: the
 * frame halved BLOOM_LEVELS times over, each level blurred twice as wide as the one before, all
 * of them added to the frame at the same strength).
 *
 * Over a bright area far wider than its widest blur the bloom adds every level's share of the
 * area's own light: with 7 levels at 0.06, 42 % more than was drawn. What is designed in the
 * display's own colours (a star's face: shaders/star.ts) leaves that much out of what it writes.
 */
export const BLOOM_LEVELS = 7;

/** How wide the first level's blur is, as a Gaussian's sigma (pixels of the pass); measured on the chain itself (tests/bloom.test.ts). */
export const BLOOM_SIGMA = 2.46;

/**
 * What each level adds over a wide bright area, as a share of that area's light. The renderer
 * sets it every frame: 0 where there is no bloom pass (in a headset the materials tone-map
 * themselves).
 */
export const BLOOM = { uBloom: { value: 0 } };

/**
 * What the bloom lays over a place of an evenly bright disk, as a share of the disk's own light
 * (per unit of BLOOM.uBloom). `radius`: the disk's on the screen; `inside`: how far the place is
 * inside its edge (both in the pass's pixels). A level gathers all of the disk's light at the
 * middle of a disk far wider than its blur and half of it at that disk's edge; of a disk smaller
 * than its blur it gathers little, and the same all over it. The same arithmetic as the shader's
 * (BLOOM_VEIL_GLSL).
 */
export function bloomVeil(radius: number, inside: number): number {
  // (the share of a blur that falls on the near side of a straight edge this far off: the normal
  // distribution, by the logistic curve that follows it to a hundredth)
  const within = (d: number, sigma: number) => 1 / (1 + Math.exp((-1.7 * d) / sigma));
  let veil = 0;
  for (let k = 0, sigma = BLOOM_SIGMA; k < BLOOM_LEVELS; k++, sigma *= 2) {
    veil += ((1 - Math.exp((-0.5 * radius * radius) / (sigma * sigma))) * within(inside, sigma)) / within(radius, sigma);
  }
  return veil;
}

/** GLSL: `bloomVeil(radius, inside)`, as above times uBloom: x at the place, y deep inside the disk. */
export const BLOOM_VEIL_GLSL = /* glsl */ `
uniform float uBloom;
vec2 bloomVeil(float radius, float inside) {
  vec2 veil = vec2(0.0);
  float sigma = ${BLOOM_SIGMA.toFixed(2)};
  for (int k = 0; k < ${BLOOM_LEVELS}; k++) {
    float gathered = 1.0 - exp(-0.5 * radius * radius / (sigma * sigma));
    veil += gathered * vec2((1.0 + exp(-1.7 * radius / sigma)) / (1.0 + exp(-1.7 * inside / sigma)), 1.0);
    sigma *= 2.0;
  }
  return uBloom * veil;
}
`;
