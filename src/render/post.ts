/**
 * Post-processing chain (custom, tuned for phone GPUs):
 *
 *   scene (HDR, log-depth) → [black-hole lensing] → bloom (dual-filter mip chain)
 *     → composite: warp streaks, chromatic aberration, lens flare, ACES tone map,
 *       colour grade, vignette, film grain, dither → screen
 *
 * Every pass is a single full-screen triangle. The lensing pass only runs
 * while a black hole is on screen.
 */
import * as THREE from 'three';
import { BlackHolePass, type BlackHoleView } from './blackHolePass';
import type { QualityTier } from './qualityTiers';

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Bloom downsample: 13-tap filter (Jimenez, "Next Generation Post Processing in Call of Duty"); the first pass also applies a soft threshold. */
const DOWN_FRAG = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
vec3 prefilter(vec3 c) {
  if (uThreshold <= 0.0) return c;
  float br = max(c.r, max(c.g, c.b));
  // Soft knee so bright stars bloom without a hard cut-off line; sunlit planets stay below it.
  const float knee = 0.35;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  return c * max(soft, br - uThreshold) / max(br, 1e-4);
}
void main() {
  vec2 t = uTexel;
  vec3 a = texture2D(uSrc, vUv + t * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture2D(uSrc, vUv + t * vec2(0.0, 2.0)).rgb;
  vec3 c = texture2D(uSrc, vUv + t * vec2(2.0, 2.0)).rgb;
  vec3 d = texture2D(uSrc, vUv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture2D(uSrc, vUv).rgb;
  vec3 f = texture2D(uSrc, vUv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture2D(uSrc, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture2D(uSrc, vUv + t * vec2(0.0, -2.0)).rgb;
  vec3 i = texture2D(uSrc, vUv + t * vec2(2.0, -2.0)).rgb;
  vec3 j = texture2D(uSrc, vUv + t * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture2D(uSrc, vUv + t * vec2(1.0, 1.0)).rgb;
  vec3 l = texture2D(uSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture2D(uSrc, vUv + t * vec2(1.0, -1.0)).rgb;
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  // Guard against NaN/Inf from the scene poisoning the whole mip chain.
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  col = min(max(col, vec3(0.0)), vec3(64.0));
  gl_FragColor = vec4(prefilter(col), 1.0);
}`;

/** Bloom upsample: 3×3 tent filter, blended additively onto the next larger mip. */
const UP_FRAG = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
void main() {
  vec2 t = uTexel;
  vec3 c = texture2D(uSrc, vUv).rgb * 4.0;
  c += (texture2D(uSrc, vUv + vec2(t.x, 0.0)).rgb + texture2D(uSrc, vUv - vec2(t.x, 0.0)).rgb + texture2D(uSrc, vUv + vec2(0.0, t.y)).rgb + texture2D(uSrc, vUv - vec2(0.0, t.y)).rgb) * 2.0;
  c += texture2D(uSrc, vUv + t).rgb + texture2D(uSrc, vUv - t).rgb + texture2D(uSrc, vUv + vec2(t.x, -t.y)).rgb + texture2D(uSrc, vUv + vec2(-t.x, t.y)).rgb;
  gl_FragColor = vec4(c * (uWeight / 16.0), 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uResolution;
uniform float uTime;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uWarp;        // 0..1 travel boost: radial star streaks
uniform float uChroma;      // chromatic aberration strength
uniform float uGrain;
uniform float uVignette;
uniform float uFade;        // 0 = normal, 1 = black
uniform float uFlash;       // additive white flash (arrival)
uniform vec3 uFlarePos;     // xy = uv of the brightest star, z = visibility 0..1
uniform vec3 uFlareColor;
uniform float uFancy;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 aces(vec3 x) {
  // Narkowicz ACES fit.
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 sampleScene(vec2 uv) {
  vec3 c = texture2D(uScene, uv).rgb;
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  return c + texture2D(uBloom, uv).rgb * uBloomStrength;
}

// Lens flare: a few soft ghosts mirrored through the screen centre plus a faint halo.
vec3 lensFlare(vec2 uv) {
  if (uFlarePos.z <= 0.001) return vec3(0.0);
  float aspect = uResolution.x / uResolution.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 s = (uFlarePos.xy - 0.5) * vec2(aspect, 1.0);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float k = -0.35 - float(i) * 0.38;
    float size = 0.035 + 0.03 * float(i);
    float d = length(c - s * k) / size;
    vec3 tint = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + float(i) * 0.21));
    col += tint * exp(-d * d * 2.0) * (0.05 / (1.0 + float(i) * 0.5));
  }
  // Halo ring around the mirrored source.
  float ring = abs(length(c + s * 0.9) - 0.42);
  col += vec3(0.6, 0.75, 1.0) * exp(-ring * ring * 900.0) * 0.03;
  // Anamorphic streak through the source.
  vec2 ds = c - s;
  col += vec3(0.5, 0.7, 1.0) * exp(-abs(ds.y) * 90.0) * exp(-abs(ds.x) * 2.2) * 0.12;
  return col * uFlareColor * uFlarePos.z;
}

void main() {
  vec2 uv = vUv;
  vec2 fromCentre = uv - 0.5;
  float r2 = dot(fromCentre, fromCentre);
  vec3 col;
  if (uWarp > 0.003) {
    // Radial streaks: accumulate samples toward the vanishing point; red/blue shift across the streak.
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    float len = uWarp * (0.05 + 0.5 * r2);
    float jitter = hash12(gl_FragCoord.xy + uTime) - 0.5;
    for (int i = 0; i < 8; i++) {
      float t = (float(i) + jitter) / 8.0;
      float w = 1.0 - t * 0.8;
      vec2 p = uv - fromCentre * len * t;
      vec3 s = sampleScene(p);
      acc += s * w * mix(vec3(1.0), vec3(0.65 + 0.7 * t, 0.9, 1.35 - 0.7 * t), uWarp);
      wsum += w;
    }
    col = acc / wsum * (1.0 + uWarp * 0.6);
  } else if (uChroma > 0.0005) {
    vec2 off = fromCentre * uChroma * (0.4 + 2.0 * r2);
    col.r = sampleScene(uv + off).r;
    col.g = sampleScene(uv).g;
    col.b = sampleScene(uv - off).b;
  } else {
    col = sampleScene(uv);
  }
  if (uFancy > 0.5) col += lensFlare(uv);

  col *= uExposure;
  // Grade in scene-referred space: cool shadows, warm highlights, a touch more saturation.
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, 1.12);
  col *= mix(vec3(0.94, 0.98, 1.08), vec3(1.05, 1.0, 0.95), smoothstep(0.0, 0.8, luma));
  col = aces(col);
  // Vignette.
  col *= 1.0 - uVignette * smoothstep(0.18, 0.75, r2 * 1.6);
  col = mix(col, vec3(0.0), uFade) + uFlash;
  // Linear → sRGB.
  col = mix(col * 12.92, 1.055 * pow(max(col, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), col));
  // Film grain (stronger in the mid-tones) + ordered-ish dither to kill banding in dark gradients.
  float n = hash12(gl_FragCoord.xy + fract(uTime) * 91.7);
  // (luma is measured before tone mapping and can be far above 1 on a star's disc: clamp it, or the grain
  // would grow with brightness and speckle everything that is over-exposed.)
  float mid = 1.0 - abs(clamp(luma, 0.0, 1.0) * 2.0 - 1.0);
  col += (n - 0.5) * (uGrain * (0.35 + 0.65 * mid) + 1.5 / 255.0);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

function fsMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, additive = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FS_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NoBlending, transparent: additive, toneMapped: false,
  });
}

export interface PostParams {
  exposure: number;
  warp: number;
  chroma: number;
  fade: number;
  flash: number;
  /** Lens flare source: uv + visibility, and its colour × intensity. */
  flare: { x: number; y: number; visibility: number; color: THREE.Color };
  blackHole: BlackHoleView | null;
}

export class PostFX {
  readonly params: PostParams = { exposure: 1, warp: 0, chroma: 0, fade: 0, flash: 0, flare: { x: 0.5, y: 0.5, visibility: 0, color: new THREE.Color(1, 1, 1) }, blackHole: null };
  /** HDR scene target the world renders into. */
  sceneRT: THREE.WebGLRenderTarget;
  private lensRT: THREE.WebGLRenderTarget | null = null;
  private mips: THREE.WebGLRenderTarget[] = [];
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly down: THREE.ShaderMaterial;
  private readonly up: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private readonly blackHole: BlackHolePass;
  private readonly hdrType: THREE.TextureDataType;
  private width = 2;
  private height = 2;
  private levels = 5;
  private time = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer, noise: THREE.Data3DTexture) {
    // Rendering to half-float targets needs an extension on WebGL2; fall back to 8-bit (clamped highlights) without it.
    const ext = renderer.extensions;
    this.hdrType = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.sceneRT = this.makeTarget(2, 2, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.down = fsMaterial(DOWN_FRAG, { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0 } });
    this.up = fsMaterial(UP_FRAG, { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } }, true);
    this.composite = fsMaterial(COMPOSITE_FRAG, {
      uScene: { value: null }, uBloom: { value: null }, uResolution: { value: new THREE.Vector2(2, 2) }, uTime: { value: 0 }, uExposure: { value: 1 },
      uBloomStrength: { value: 0.9 }, uWarp: { value: 0 }, uChroma: { value: 0 }, uGrain: { value: 0.014 }, uVignette: { value: 0.35 }, uFade: { value: 0 }, uFlash: { value: 0 },
      uFlarePos: { value: new THREE.Vector3(0.5, 0.5, 0) }, uFlareColor: { value: new THREE.Color(1, 1, 1) }, uFancy: { value: 1 },
    });
    this.blackHole = new BlackHolePass(noise);
    this.quad = new THREE.Mesh(geo, this.composite);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  get isHdr(): boolean {
    return this.hdrType === THREE.HalfFloatType;
  }

  private makeTarget(w: number, h: number, depth: boolean): THREE.WebGLRenderTarget {
    const rt = new THREE.WebGLRenderTarget(w, h, { type: this.hdrType, format: THREE.RGBAFormat, depthBuffer: depth, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    return rt;
  }

  /** (Re)allocate render targets for a drawing-buffer size and quality tier. */
  resize(width: number, height: number, tier: QualityTier): void {
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(2, Math.floor(height));
    if (w === this.width && h === this.height && tier.bloomLevels === this.levels && this.mips.length > 0) return;
    this.width = w;
    this.height = h;
    this.levels = tier.bloomLevels;
    this.sceneRT.setSize(w, h);
    this.lensRT?.setSize(w, h);
    for (const m of this.mips) m.dispose();
    this.mips = [];
    let mw = w;
    let mh = h;
    for (let i = 0; i < this.levels; i++) {
      mw = Math.max(2, mw >> 1);
      mh = Math.max(2, mh >> 1);
      this.mips.push(this.makeTarget(mw, mh, false));
    }
    (this.composite.uniforms.uResolution!.value as THREE.Vector2).set(w, h);
    this.composite.uniforms.uFancy!.value = tier.fancyPost ? 1 : 0;
    this.composite.uniforms.uGrain!.value = tier.fancyPost ? 0.014 : 0.0;
  }

  private pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  /** Run the chain on the already-rendered scene target and present to the canvas. */
  render(dt: number, camera: THREE.PerspectiveCamera, tier: QualityTier): void {
    this.time += dt;
    const p = this.params;
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    let source = this.sceneRT;

    if (p.blackHole) {
      if (!this.lensRT) this.lensRT = this.makeTarget(this.width, this.height, false);
      this.blackHole.update(p.blackHole, source.texture, camera, this.time, tier.blackHoleSteps);
      this.pass(this.blackHole.material, this.lensRT);
      source = this.lensRT;
    } else if (this.lensRT) {
      // Free the extra full-size target as soon as no black hole is in view.
      this.lensRT.dispose();
      this.lensRT = null;
    }

    // Bloom: downsample chain…
    let src = source;
    for (let i = 0; i < this.mips.length; i++) {
      const dst = this.mips[i]!;
      this.down.uniforms.uSrc!.value = src.texture;
      (this.down.uniforms.uTexel!.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
      this.down.uniforms.uThreshold!.value = i === 0 ? (this.isHdr ? 1.55 : 0.85) : 0;
      this.pass(this.down, dst);
      src = dst;
    }
    // …then upsample, accumulating each level into the one above it.
    for (let i = this.mips.length - 1; i > 0; i--) {
      const from = this.mips[i]!;
      this.up.uniforms.uSrc!.value = from.texture;
      (this.up.uniforms.uTexel!.value as THREE.Vector2).set(1 / from.width, 1 / from.height);
      this.up.uniforms.uWeight!.value = 0.85;
      this.pass(this.up, this.mips[i - 1]!);
    }

    const u = this.composite.uniforms;
    u.uScene!.value = source.texture;
    u.uBloom!.value = this.mips[0]!.texture;
    u.uTime!.value = this.time;
    u.uExposure!.value = p.exposure;
    u.uWarp!.value = p.warp;
    u.uChroma!.value = p.chroma;
    u.uFade!.value = p.fade;
    u.uFlash!.value = p.flash;
    (u.uFlarePos!.value as THREE.Vector3).set(p.flare.x, p.flare.y, p.flare.visibility);
    (u.uFlareColor!.value as THREE.Color).copy(p.flare.color);
    this.pass(this.composite, null);
    this.renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.sceneRT.dispose();
    this.lensRT?.dispose();
    for (const m of this.mips) m.dispose();
    this.down.dispose();
    this.up.dispose();
    this.composite.dispose();
    this.blackHole.dispose();
    this.quad.geometry.dispose();
  }
}
