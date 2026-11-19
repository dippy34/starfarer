/**
 * Galaxy rendering.
 *
 * One ray-marched volumetric shader draws every resolved galaxy. It evaluates
 * the same structural model as the star-field generator (exponential disc,
 * logarithmic spiral arms, bar, bulge, ring) plus dust lanes, star-forming
 * knots and an active nucleus, so the glow and the individual stars agree.
 *
 *   hero      — the galaxy the camera is inside or very close to: marched into
 *               a low-resolution target and upsampled (its light is smooth, so
 *               a quarter of the pixels is plenty — and it is by far the most
 *               expensive thing on screen)
 *   impostors — other nearby galaxies: the same shader with few steps on a
 *               small camera-facing quad each
 */
import * as THREE from 'three';
import { galaxyDensity } from '../universe/galaxy';
import type { GalaxyModel } from '../universe/types';
import { NOISE_GLSL } from './noiseTexture';
import type { QualityTier } from './qualityTiers';

const FRAG = /* glsl */ `
${NOISE_GLSL}
uniform vec2 uRes;            // resolution of the target being rendered
uniform vec2 uTanFov;
uniform mat3 uViewToLocal;    // view-space direction → galaxy-local direction
uniform vec3 uCamLocal;       // camera in galaxy-local kpc
uniform vec4 uShape;          // hR, hz, radius, clumpiness
uniform vec4 uBulge;          // core radius, flattening, amplitude, fraction
uniform vec4 uArms;           // arm count, cot(pitch), phase, contrast
uniform vec4 uExtra;          // bar length, ring radius, dust, activity
uniform vec3 uColorOld;
uniform vec3 uColorYoung;
uniform vec3 uNoiseOffset;
uniform float uSteps;
uniform float uGain;
uniform float uOpacity;
uniform float uCompress;
uniform float uJet;           // strength of the relativistic jets along the spin axis (0 = none)

// Interleaved gradient noise (Jimenez 2014): a ray-start jitter whose error is spread evenly over
// neighbouring pixels, so it averages out when the low-resolution result is filtered up — unlike white noise,
// which shows as blotchy grain.
float hash12(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec3 rd = normalize(uViewToLocal * vec3(ndc * uTanFov, -1.0));
  vec3 ro = uCamLocal;
  float hR = uShape.x, hz = uShape.y, radius = uShape.z;
  bool spheroid = uBulge.w >= 0.999;
  // Bounding ellipsoid: squash z so that it becomes a sphere of the galaxy's radius.
  float H = uJet > 0.0 ? radius : spheroid ? radius * uBulge.y : max(hz * 7.0, uBulge.x * uBulge.y * 3.0);
  vec3 sc = vec3(1.0, 1.0, radius / H);
  vec3 o = ro * sc, d = rd * sc;
  float a = dot(d, d), b = dot(o, d), c = dot(o, o) - radius * radius;
  float disc = b * b - a * c;
  if (disc <= 0.0) discard;
  float sq = sqrt(disc);
  float t0 = max((-b - sq) / a, 0.0);
  float t1 = (-b + sq) / a;
  if (t1 <= t0) discard;

  bool inside = t0 <= 0.0;
  int steps = int(uSteps);
  float jitter = hash12(gl_FragCoord.xy);
  vec3 col = vec3(0.0);
  float trans = 1.0;
  float tPrev = t0;
  float r0 = max(max(uExtra.x, hR * 0.35), 1e-3);
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    // Inside the galaxy, sample densely near the camera (nearby dust and arms matter most).
    float f = (float(i) + jitter) / uSteps;
    float t = inside ? t0 + (t1 - t0) * f * f : t0 + (t1 - t0) * f;
    float dt = t - tPrev;
    tPrev = t;
    vec3 p = ro + rd * t;
    float R = length(p.xy);
    float az = abs(p.z);
    float emOld = 0.0, emYoung = 0.0, dust = 0.0;
    if (!spheroid) {
      float disk = exp(-R / hR - az / hz);
      float edge = clamp((R - radius * 0.82) / (radius * 0.18), 0.0, 1.0);
      disk *= 1.0 - edge * edge * (3.0 - 2.0 * edge);
      float thin = exp(-az / (hz * 0.35));
      vec3 np = p / hR * 0.11 + uNoiseOffset;
      float n = texture(uNoise, np).r * 0.6 + texture(uNoise, np * 3.7).r * 0.4;
      float mask = 0.0;
      float lane = 0.0;
      if (uExtra.y > 0.0) {
        // Ring galaxy: a bright star-forming ring around a faint disc.
        float w = hR * 0.45;
        float ring = exp(-(R - uExtra.y) * (R - uExtra.y) / (w * w)) * exp(-az / hz);
        disk = disk * 0.25 + ring * 0.5;
        mask = ring * 1.6;
        lane = ring * 0.5;
      } else if (uArms.x > 0.5 && R > uExtra.x * 0.8) {
        float ang = uArms.z + log(max(R, r0 * 0.25) / r0) * uArms.y;
        float th = atan(p.y, p.x);
        float cs = 0.5 + 0.5 * cos(uArms.x * (th - ang));
        mask = cs * cs * cs * cs;
        // Dust hugs the inner (concave) edge of each arm.
        float cd = 0.5 + 0.5 * cos(uArms.x * (th - ang) + 0.7);
        lane = cd * cd * cd;
      } else if (uExtra.x > 0.0) {
        // The bar.
        float ca = cos(uArms.z), sa = sin(uArms.z);
        float along = p.x * ca + p.y * sa, across = -p.x * sa + p.y * ca;
        float bar = exp(-across * across / (0.09 * uExtra.x * uExtra.x) - along * along / (uExtra.x * uExtra.x));
        emOld += disk * bar * 1.6;
        lane = bar * 0.5;
      } else {
        lane = 0.35;
      }
      float clump = uShape.w > 0.3 ? max(0.08, 1.0 + uShape.w * 2.2 * (n * 2.0 - 1.0)) : 1.0;
      emOld += disk * (1.0 - 0.45 * uArms.w) * mix(1.0, clump, 0.4);
      // Young stars: confined to the arms and the thin plane, in patchy associations.
      float knots = smoothstep(0.52, 0.8, n);
      emYoung = disk * thin * uArms.w * mask * (0.8 + 2.6 * knots) * clump * (uArms.x > 0.5 || uExtra.y > 0.0 ? 2.4 : 1.0);
      if (uArms.x < 0.5 && uExtra.y <= 0.0) emYoung += disk * thin * uShape.w * knots * 2.5;
      dust = uExtra.z * disk * thin * (0.25 + lane * 1.6) * (0.35 + 1.5 * n * n) * 2.2;
    }
    // Bulge / spheroid: flattened Plummer-like core.
    float q = uBulge.y;
    float m2 = (dot(p.xy, p.xy) + p.z * p.z / (q * q)) / (uBulge.x * uBulge.x);
    float core = uBulge.z / ((1.0 + m2) * (1.0 + m2) * sqrt(1.0 + m2));
    emOld += core;
    vec3 em = uColorOld * emOld + uColorYoung * emYoung;
    // Star-forming regions glow pink (H-alpha).
    em += vec3(1.0, 0.35, 0.45) * emYoung * 0.18;
    float absorb = exp(-dust * dt);
    // Emission integrated over the step with absorption (analytic for constant coefficients).
    col += trans * em * dt * (dust * dt > 1e-5 ? (1.0 - absorb) / (dust * dt) : 1.0);
    trans *= absorb;
    if (trans < 0.02) break;
  }
  col *= uGain;
  // Small, searingly bright things are added in closed form — a march this coarse would step right
  // over them. Each is a Gaussian whose line integral is known exactly, widened to at least a pixel
  // (with its flux conserved) so that it shrinks to a steady point instead of twinkling.
  float pixel = 2.0 * uTanFov.y / uRes.y;   // radians per pixel
  if (uExtra.w > 0.0) {
    // Active nucleus: the accretion disc outshining the galaxy from a region far too small to resolve.
    float tc = -dot(ro, rd);
    if (tc > 0.0) {
      float s = hR * 0.03, se = max(s, 0.8 * pixel * tc);
      float b2 = max(dot(ro, ro) - tc * tc, 0.0);
      col += vec3(0.75, 0.85, 1.0) * (uExtra.w * 36.0 * exp(-b2 / (se * se)) * (s * s) / (se * se) * mix(1.0, trans, 0.4));
    }
  }
  if (uJet > 0.0) {
    // Relativistic jets: two thin, gently flaring, knotty beams along the spin axis.
    float A = max(dot(rd.xy, rd.xy), 1e-4);
    float ta = -dot(ro.xy, rd.xy) / A;      // where the ray passes closest to the axis
    if (ta > 0.0) {
      float zj = abs(ro.z + ta * rd.z);
      float rho2 = max(dot(ro.xy, ro.xy) - ta * ta * A, 0.0);
      float w = radius * 0.008 + zj * 0.035, we = max(w, 0.7 * pixel * ta);
      float along = smoothstep(0.0, radius * 0.02, zj) * exp(-zj / (radius * 0.3)) * (1.0 - smoothstep(radius * 0.6, radius * 0.95, zj));
      float n = texture(uNoise, vec3(zj / radius * 3.1, 0.37, 0.81) + uNoiseOffset).r;
      float knots = 0.3 + 2.2 * n * n;
      col += vec3(0.55, 0.78, 1.0) * (uJet * 2.2 * along * knots * exp(-rho2 / (we * we)) * (w / we) * min(inversesqrt(A), 3.0));
    }
  }
  col *= uOpacity;
  // From inside a galaxy its light surrounds the camera: compress the brightest parts (as an eye
  // or a camera exposing for it would) so the bulge is a glow around you, not a white-out.
  col /= 1.0 + dot(col, vec3(0.3333)) * uCompress;
  gl_FragColor = vec4(col, (1.0 - trans) * uOpacity);
}`;

const QUAD_VERT = /* glsl */ `
uniform vec3 uCenterView;   // galaxy centre in view space, brought to a distance of QUAD_DISTANCE units
uniform float uRadiusM;     // bounding radius at that distance
void main() {
  // Camera-facing quad that covers the bounding sphere (with margin for perspective). Galaxies are
  // up to 10^26 m away and this layer has no depth test, so the quad is drawn at a fixed, comfortable
  // distance along the same line of sight (which leaves its projection unchanged). The scaling is done
  // on the CPU: in a shader, metres at these distances overflow 32-bit floats as soon as they are squared.
  gl_Position = projectionMatrix * vec4(uCenterView + vec3(position.xy * uRadiusM * 1.3, 0.0), 1.0);
}`;

/** Distance (scene units) at which impostor quads are drawn. */
const QUAD_DISTANCE = 1000;

const FULL_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BLIT_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uRes;
void main() {
  gl_FragColor = texture2D(uTex, gl_FragCoord.xy / uRes);
}`;

const KPC = 3.085677581491367e19;

function makeUniforms(noise: THREE.Data3DTexture): Record<string, THREE.IUniform> {
  return {
    uNoise: { value: noise }, uRes: { value: new THREE.Vector2(2, 2) }, uTanFov: { value: new THREE.Vector2(1, 1) }, uViewToLocal: { value: new THREE.Matrix3() },
    uCamLocal: { value: new THREE.Vector3() }, uShape: { value: new THREE.Vector4() }, uBulge: { value: new THREE.Vector4() }, uArms: { value: new THREE.Vector4() },
    uExtra: { value: new THREE.Vector4() }, uColorOld: { value: new THREE.Color() }, uColorYoung: { value: new THREE.Color() }, uNoiseOffset: { value: new THREE.Vector3() },
    uSteps: { value: 16 }, uGain: { value: 1 }, uOpacity: { value: 1 }, uCompress: { value: 0 }, uJet: { value: 0 }, uCenterView: { value: new THREE.Vector3() }, uRadiusM: { value: 1 },
  };
}

/**
 * Surface-brightness normalisation: makes a face-on galaxy's centre land at a pleasant HDR level
 * whatever its size — a little brighter for giants and distinctly fainter for dwarfs, whose stars
 * really are spread thinner (central surface brightness falls by roughly 0.3 mag per magnitude of
 * luminosity; a dwarf spheroidal is a ghost next to a spiral).
 */
function gainFor(g: GalaxyModel): number {
  const dwarf = Math.min(1.3, Math.max(0.12, Math.pow(10, -0.12 * (g.absMag + 20.5))));
  // Irregulars have no bulge to speak of: their light is the disc itself, so that is what gets exposed for.
  if (g.type === 'irregular') return (0.9 * dwarf) / Math.max(2 * g.hz, 1e-6);
  const column = g.bulgeFrac >= 1 ? galaxyDensity(g, 0, 0, 0, 2) * g.bulgeR * 2.2 : 2 * g.hz + galaxyDensity(g, 0, 0, 0, 2) * g.bulgeR * 0.9;
  return (1.35 * dwarf) / Math.max(column, 1e-6);
}

function setModelUniforms(u: Record<string, THREE.IUniform>, g: GalaxyModel): void {
  const bulgeAmp =
    g.bulgeFrac >= 1 ? 1.15 : (g.bulgeFrac / (1 - g.bulgeFrac)) * ((4 * Math.PI * g.hR * g.hR * g.hz) / ((4 / 3) * Math.PI * g.bulgeR ** 3 * g.bulgeQ)) * 1.25;
  (u.uShape!.value as THREE.Vector4).set(g.hR, g.hz, g.radius, g.clumpiness);
  // (An irregular's few-percent "bulge" is drawn as a modest central knot, not a blazing nucleus.)
  (u.uBulge!.value as THREE.Vector4).set(g.bulgeR, g.bulgeQ, g.bulgeFrac > 0 ? bulgeAmp * (g.type === 'irregular' ? 0.3 : 1) : 0, g.bulgeFrac);
  (u.uArms!.value as THREE.Vector4).set(g.arms, 1 / Math.tan(Math.max(g.pitch, 0.05)), g.armPhase, g.armContrast);
  (u.uExtra!.value as THREE.Vector4).set(g.barLength, g.ringR, g.dust, g.activity);
  (u.uColorOld!.value as THREE.Color).setRGB(g.colorOld[0], g.colorOld[1], g.colorOld[2]);
  (u.uColorYoung!.value as THREE.Color).setRGB(g.colorYoung[0], g.colorYoung[1], g.colorYoung[2]);
  (u.uNoiseOffset!.value as THREE.Vector3).set(((g.seed >>> 0) % 997) / 997, ((g.seed >>> 8) % 991) / 991, ((g.seed >>> 16) % 983) / 983);
  u.uGain!.value = gainFor(g);
  u.uJet!.value = g.jet ? 0.55 + 0.45 * g.activity : 0;
}

const tmpM = new THREE.Matrix4();
const tmpM3 = new THREE.Matrix3();
const tmpB = new THREE.Matrix3();

/** Per-frame view of one galaxy: where its centre is relative to the camera (metres, world axes). */
export interface GalaxyView {
  model: GalaxyModel;
  /** Centre minus camera, metres. */
  rel: THREE.Vector3;
  /** 0…1 fade (cross-fade with the point sprite / between impostor and hero). */
  opacity: number;
}

function setViewUniforms(u: Record<string, THREE.IUniform>, view: GalaxyView, camera: THREE.PerspectiveCamera, resW: number, resH: number): void {
  const g = view.model;
  const b = g.basis;
  // Rows of the basis are the galaxy's local axes in world coordinates: local = B · world.
  tmpB.set(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8]);
  tmpM3.setFromMatrix4(tmpM.makeRotationFromQuaternion(camera.quaternion));
  (u.uViewToLocal!.value as THREE.Matrix3).multiplyMatrices(tmpB, tmpM3);
  // Camera in galaxy-local kpc = B · (−rel) / kpc.
  const cam = u.uCamLocal!.value as THREE.Vector3;
  cam.set(-view.rel.x / KPC, -view.rel.y / KPC, -view.rel.z / KPC).applyMatrix3(tmpB);
  const tanY = Math.tan((camera.fov * Math.PI) / 360);
  (u.uTanFov!.value as THREE.Vector2).set(tanY * camera.aspect, tanY);
  (u.uRes!.value as THREE.Vector2).set(resW, resH);
  u.uOpacity!.value = view.opacity;
}

export class GalaxyRenderer {
  private readonly heroTarget: THREE.WebGLRenderTarget;
  private readonly heroMaterial: THREE.ShaderMaterial;
  private readonly heroScene = new THREE.Scene();
  private readonly heroCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly blit: THREE.Mesh;
  private readonly blitMaterial: THREE.ShaderMaterial;
  private readonly quadGeo = new THREE.PlaneGeometry(2, 2);
  private readonly pool: Array<{ mesh: THREE.Mesh; material: THREE.ShaderMaterial; modelId: string }> = [];
  private readonly group = new THREE.Group();
  private heroId = '';
  private heroActive = false;

  constructor(private readonly renderer: THREE.WebGLRenderer, scene: THREE.Scene, private readonly noise: THREE.Data3DTexture, hdr: boolean) {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.heroTarget = new THREE.WebGLRenderTarget(2, 2, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.heroMaterial = new THREE.ShaderMaterial({ vertexShader: FULL_VERT, fragmentShader: FRAG, uniforms: makeUniforms(noise), depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false });
    const heroMesh = new THREE.Mesh(tri, this.heroMaterial);
    heroMesh.frustumCulled = false;
    this.heroScene.add(heroMesh);

    this.blitMaterial = new THREE.ShaderMaterial({
      vertexShader: FULL_VERT, fragmentShader: BLIT_FRAG, uniforms: { uTex: { value: this.heroTarget.texture }, uRes: { value: new THREE.Vector2(2, 2) } },
      depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.blit = new THREE.Mesh(tri, this.blitMaterial);
    this.blit.frustumCulled = false;
    this.blit.renderOrder = 12;
    this.blit.visible = false;
    this.group.add(this.blit);
    this.group.renderOrder = 10;
    scene.add(this.group);
  }

  private impostor(i: number): { mesh: THREE.Mesh; material: THREE.ShaderMaterial; modelId: string } {
    while (this.pool.length <= i) {
      const material = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT, fragmentShader: FRAG, uniforms: makeUniforms(this.noise), depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const mesh = new THREE.Mesh(this.quadGeo, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      mesh.visible = false;
      this.group.add(mesh);
      this.pool.push({ mesh, material, modelId: '' });
    }
    return this.pool[i]!;
  }

  /**
   * Draw this frame's galaxies. `hero` (if any) is ray-marched at reduced resolution;
   * `impostors` are drawn as small quads. Call before the engine renders the scene.
   */
  update(hero: GalaxyView | null, impostors: GalaxyView[], camera: THREE.PerspectiveCamera, sceneW: number, sceneH: number, tier: QualityTier): void {
    // How deep inside the hero galaxy the camera is (1 = well inside, 0 = outside). In there the view is
    // exposed for the galaxy's own glow, and its neighbours in the sky are seen through the same eyes.
    const inside = hero ? 1 - Math.min(1, Math.max(0, (hero.rel.length() / (hero.model.radius * KPC) - 0.7) / 0.7)) : 0;

    // ---- Impostors
    const tmp = new THREE.Vector3();
    for (let i = 0; i < Math.max(impostors.length, this.pool.length); i++) {
      const view = impostors[i];
      if (!view) {
        if (this.pool[i]) this.pool[i]!.mesh.visible = false;
        continue;
      }
      const slot = this.impostor(i);
      const u = slot.material.uniforms;
      if (slot.modelId !== view.model.id) {
        setModelUniforms(u, view.model);
        slot.modelId = view.model.id;
      }
      setViewUniforms(u, view, camera, sceneW, sceneH);
      // Centre in view space: rotate the world-axis offset by the inverse camera rotation.
      tmp.copy(view.rel).applyQuaternion(camera.quaternion.clone().invert());
      const toQuad = QUAD_DISTANCE / Math.max(tmp.length(), 1);
      (u.uCenterView!.value as THREE.Vector3).copy(tmp).multiplyScalar(toQuad);
      u.uRadiusM!.value = view.model.radius * KPC * toQuad;
      u.uSteps!.value = Math.max(8, Math.round(tier.galaxySteps * 0.5));
      u.uCompress!.value = 1.5 * inside;
      slot.mesh.visible = tmp.z < view.model.radius * KPC; // skip galaxies entirely behind the camera
    }

    // ---- Hero
    this.heroActive = hero !== null;
    this.blit.visible = this.heroActive;
    if (!hero) return;
    const scale = tier.name === 'low' ? 0.3 : tier.name === 'medium' ? 0.42 : 0.55;
    const w = Math.max(2, Math.round(sceneW * scale));
    const h = Math.max(2, Math.round(sceneH * scale));
    if (this.heroTarget.width !== w || this.heroTarget.height !== h) this.heroTarget.setSize(w, h);
    const u = this.heroMaterial.uniforms;
    if (this.heroId !== hero.model.id) {
      setModelUniforms(u, hero.model);
      this.heroId = hero.model.id;
    }
    setViewUniforms(u, hero, camera, w, h);
    u.uSteps!.value = tier.galaxySteps;
    // Inside the galaxy, expose for where we are: the eye adapts to the blaze of a galactic nucleus
    // just as it does to the faint band seen from the outskirts.
    const g = hero.model;
    const cam = u.uCamLocal!.value as THREE.Vector3;
    const ambient = gainFor(g) * galaxyDensity(g, cam.x, cam.y, cam.z, 2) * 2; // ≈ surface brightness of the surrounding glow
    const exposure = Math.min(2.5, 0.2 / Math.max(ambient, 1e-6));
    u.uGain!.value = gainFor(g) * (1 + (exposure - 1) * inside);
    u.uCompress!.value = 1.5 * inside;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.heroTarget);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.heroScene, this.heroCamera);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setRenderTarget(prev);
    (this.blitMaterial.uniforms.uRes!.value as THREE.Vector2).set(sceneW, sceneH);
  }

  dispose(): void {
    this.heroTarget.dispose();
    this.heroMaterial.dispose();
    this.blitMaterial.dispose();
    this.quadGeo.dispose();
    for (const p of this.pool) p.material.dispose();
    this.group.removeFromParent();
  }
}
