/**
 * Volumetric nebulae: glowing, layered gas with dark dust silhouettes,
 * ray-marched through the shared 3D noise texture into a low-resolution
 * target and composited behind the stars (the same trick as the hero galaxy).
 *
 * One shader covers five looks:
 *   0 emission    — billowing pink/teal star-forming clouds with dust lanes
 *   1 reflection  — wispy blue dust lit by nearby stars
 *   2 planetary   — a bright shell around a white-hot central star
 *   3 remnant     — a thin shell of tangled filaments (supernova shock)
 *   4 dark        — an opaque dust cloud that only blocks light
 */
import * as THREE from 'three';
import { NOISE_GLSL } from './noiseTexture';
import type { QualityTier } from './qualityTiers';

const FRAG = /* glsl */ `
${NOISE_GLSL}
uniform vec2 uRes;
uniform vec2 uTanFov;
uniform mat3 uViewToWorld;
uniform vec3 uCam;        // camera relative to the nebula centre, in nebula radii
uniform float uType;
uniform vec3 uSeed;
uniform float uSteps;
uniform float uOpacity;
uniform float uTime;

// Interleaved gradient noise (Jimenez 2014): a ray-start jitter whose error is spread evenly over
// neighbouring pixels, so it averages out when the low-resolution result is filtered up — unlike white noise,
// which shows as blotchy grain.
float hash12(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec3 rd = normalize(uViewToWorld * vec3(ndc * uTanFov, -1.0));
  vec3 ro = uCam;
  const float RAD = 1.3;
  float b = dot(ro, rd), c = dot(ro, ro) - RAD * RAD;
  float h = b * b - c;
  if (h <= 0.0) discard;
  float sq = sqrt(h);
  float t0 = max(-b - sq, 0.0), t1 = -b + sq;
  if (t1 <= t0) discard;
  int steps = int(uSteps);
  float dt = (t1 - t0) / uSteps;
  float t = t0 + dt * hash12(gl_FragCoord.xy);
  vec3 col = vec3(0.0);
  float trans = 1.0;
  vec3 axis = normalize(uSeed - 0.5);
  for (int i = 0; i < 48; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    t += dt;
    float r = length(p);
    vec3 q = p * 0.33 + uSeed;
    float n = texture(uNoise, q).r * 0.5 + texture(uNoise, q * 2.6 + 0.37).r * 0.32 + texture(uNoise, q * 6.5).a * 0.18;
    float n2 = texture(uNoise, q * 1.3 + vec3(0.5, 0.21, 0.83)).g;
    vec3 em = vec3(0.0);
    float dust = 0.0;
    if (uType < 0.5) {
      // Emission: thick clouds, pink hydrogen glow with teal oxygen cores, cut by dust lanes.
      float fall = 1.0 - smoothstep(0.45, 1.2, r);
      float dens = smoothstep(0.4, 0.72, n) * fall;
      vec3 gas = mix(vec3(1.0, 0.22, 0.34), vec3(0.25, 0.85, 0.8), smoothstep(0.35, 0.75, n2) * (1.0 - smoothstep(0.2, 0.8, r)));
      em = gas * dens * 2.6 + vec3(0.55, 0.7, 1.0) * exp(-r * r * 18.0) * 0.8;
      dust = smoothstep(0.5, 0.74, texture(uNoise, q * 1.9 + 0.61).g) * fall * 5.5;
    } else if (uType < 1.5) {
      // Reflection: thin blue wisps.
      float fall = 1.0 - smoothstep(0.3, 1.15, r);
      float wisp = 1.0 - abs(n * 2.0 - 1.0) * 1.7;
      em = vec3(0.3, 0.5, 1.0) * max(wisp, 0.0) * max(wisp, 0.0) * fall * 1.8;
      dust = smoothstep(0.55, 0.8, n2) * fall * 2.0;
    } else if (uType < 2.5) {
      // Planetary: bright shell, fainter bipolar lobes, searing central star.
      float lobe = 1.0 + 0.55 * abs(dot(p / max(r, 1e-4), axis));
      float shell = exp(-pow((r * lobe - 0.72) / 0.13, 2.0)) * (0.45 + 1.1 * n);
      float inner = (1.0 - smoothstep(0.0, 0.7, r)) * 0.22;
      em = mix(vec3(0.2, 1.0, 0.75), vec3(1.0, 0.28, 0.2), smoothstep(0.55, 0.95, r * lobe)) * shell * 3.2 + vec3(0.25, 0.7, 1.0) * inner + vec3(0.8, 0.9, 1.0) * exp(-r * r * 2500.0) * 60.0;
    } else if (uType < 3.5) {
      // Supernova remnant: filaments tangled along a thin shock shell, faint hot interior.
      float shell = exp(-pow((r - 0.86) / 0.075, 2.0));
      float fil = pow(max(1.0 - abs(n * 2.0 - 1.0) * 2.2, 0.0), 3.0) + pow(max(1.0 - abs(n2 * 2.0 - 1.0) * 2.6, 0.0), 4.0);
      float fill = (1.0 - smoothstep(0.1, 0.85, r)) * fil * 0.55;
      em = mix(vec3(1.0, 0.3, 0.2), vec3(0.3, 0.9, 1.0), n2) * (shell * fil * 6.0 + fill) + vec3(0.5, 0.6, 1.0) * (1.0 - smoothstep(0.0, 0.8, r)) * 0.05;
    } else {
      // Dark nebula: just dust.
      float fall = 1.0 - smoothstep(0.35, 1.1, r);
      dust = smoothstep(0.38, 0.62, n) * fall * 9.0;
      em = vec3(0.012, 0.008, 0.006) * dust;
    }
    float absorb = exp(-dust * dt);
    col += trans * em * dt;
    trans *= absorb;
    if (trans < 0.03) break;
  }
  gl_FragColor = vec4(col * uOpacity, (1.0 - trans) * uOpacity);
}`;

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

export interface NebulaView {
  /** 0 emission, 1 reflection, 2 planetary, 3 remnant, 4 dark. */
  type: number;
  /** Centre relative to the camera, metres (world axes). */
  rel: THREE.Vector3;
  radius: number;
  seed: number;
  opacity: number;
}

const tmpM = new THREE.Matrix4();

export class NebulaRenderer {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly blit: THREE.Mesh;
  private time = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer, scene: THREE.Scene, noise: THREE.Data3DTexture, hdr: boolean) {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.target = new THREE.WebGLRenderTarget(2, 2, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.material = new THREE.ShaderMaterial({
      vertexShader: FULL_VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
      uniforms: {
        uNoise: { value: noise }, uRes: { value: new THREE.Vector2(2, 2) }, uTanFov: { value: new THREE.Vector2(1, 1) }, uViewToWorld: { value: new THREE.Matrix3() }, uCam: { value: new THREE.Vector3() },
        uType: { value: 0 }, uSeed: { value: new THREE.Vector3() }, uSteps: { value: 20 }, uOpacity: { value: 1 }, uTime: { value: 0 },
      },
    });
    const mesh = new THREE.Mesh(tri, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.blit = new THREE.Mesh(tri, new THREE.ShaderMaterial({
      vertexShader: FULL_VERT, fragmentShader: BLIT_FRAG, uniforms: { uTex: { value: this.target.texture }, uRes: { value: new THREE.Vector2(2, 2) } }, depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    this.blit.frustumCulled = false;
    this.blit.renderOrder = 16; // after the galaxy glow, before the stars (so embedded stars shine through)
    this.blit.visible = false;
    scene.add(this.blit);
  }

  /** Render the nebula for this frame (or hide it when `view` is null). Call before the engine draws the scene. */
  update(view: NebulaView | null, camera: THREE.PerspectiveCamera, sceneW: number, sceneH: number, tier: QualityTier, dt: number): void {
    this.blit.visible = view !== null;
    if (!view) return;
    this.time += dt;
    const scale = tier.name === 'low' ? 0.33 : tier.name === 'medium' ? 0.45 : 0.6;
    const w = Math.max(2, Math.round(sceneW * scale));
    const h = Math.max(2, Math.round(sceneH * scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    const u = this.material.uniforms;
    (u.uRes!.value as THREE.Vector2).set(w, h);
    const tanY = Math.tan((camera.fov * Math.PI) / 360);
    (u.uTanFov!.value as THREE.Vector2).set(tanY * camera.aspect, tanY);
    (u.uViewToWorld!.value as THREE.Matrix3).setFromMatrix4(tmpM.makeRotationFromQuaternion(camera.quaternion));
    (u.uCam!.value as THREE.Vector3).copy(view.rel).multiplyScalar(-1 / view.radius);
    u.uType!.value = view.type;
    (u.uSeed!.value as THREE.Vector3).set((view.seed % 997) / 997, ((view.seed >>> 9) % 991) / 991, ((view.seed >>> 18) % 983) / 983);
    u.uSteps!.value = tier.nebulaSteps;
    u.uOpacity!.value = view.opacity;
    u.uTime!.value = this.time;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setRenderTarget(prev);
    ((this.blit.material as THREE.ShaderMaterial).uniforms.uRes!.value as THREE.Vector2).set(sceneW, sceneH);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    (this.blit.material as THREE.Material).dispose();
    this.blit.removeFromParent();
  }
}
