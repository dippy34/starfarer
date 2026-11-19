/**
 * Black-hole lensing — a full-screen post-process that only runs while a
 * black hole is in view.
 *
 * For every pixel the view ray is traced through Schwarzschild space-time.
 * Light paths obey  d²x/dλ² = −(3/2)·h²·r_s·x / r⁵  (h = |x × v|, conserved),
 * which reproduces the exact null geodesics of a non-rotating black hole with
 * a Newtonian-style integrator. While marching we:
 *   - stop at the horizon                      → the pure-black shadow
 *   - shade every crossing of the disc plane   → the disc, including its far
 *     side lifted above and below the hole and the thin photon ring
 *   - apply relativistic Doppler beaming and gravitational redshift
 *   - accumulate polar-jet emission
 * Rays that escape sample the already-rendered scene along their *bent*
 * direction, so background stars and galaxies are lensed for free.
 * Far from the hole a closed-form weak-field deflection is used instead, and
 * the step count comes from the quality tier, so the effect degrades gracefully.
 */
import * as THREE from 'three';
import { NOISE_GLSL } from './noiseTexture';

/** What the lensing pass needs to know about the black hole this frame (view space, metres). */
export interface BlackHoleView {
  /** Centre in view space. */
  center: THREE.Vector3;
  /** Schwarzschild radius. */
  rs: number;
  /** Disc normal / jet axis in view space (unit). */
  axis: THREE.Vector3;
  /** Disc inner / outer radius in units of rs (outer = 0 → no disc). */
  diskInner: number;
  diskOuter: number;
  /** Disc brightness multiplier and jet strength (0–1). */
  diskGain: number;
  jet: number;
}

const FRAG = /* glsl */ `
${NOISE_GLSL}
uniform sampler2D uScene;
uniform vec3 uCenter;     // black hole centre, view space, in units of rs
uniform vec3 uAxis;       // disc normal, view space
uniform vec2 uDisk;       // inner, outer radius (rs)
uniform float uDiskGain;
uniform float uJet;
uniform float uTime;
uniform vec2 uTanFov;     // tan(half fov) horizontally, vertically
uniform float uSteps;
varying vec2 vUv;

vec2 dirToUv(vec3 d) {
  // Directions pointing behind the camera are mirrored back into view: we only have the on-screen sky to sample.
  float z = max(abs(d.z), 0.05);
  return (d.xy / z) / uTanFov * 0.5 + 0.5;
}

vec3 background(vec3 d0, vec3 d1, float spread) {
  // Slightly different bending per colour channel = chromatic fringing that grows toward the hole.
  vec2 uvR = clamp(dirToUv(normalize(mix(d0, d1, 1.0 - spread))), 0.001, 0.999);
  vec2 uvG = clamp(dirToUv(d1), 0.001, 0.999);
  vec2 uvB = clamp(dirToUv(normalize(mix(d0, d1, 1.0 + spread))), 0.001, 0.999);
  return vec3(texture2D(uScene, uvR).r, texture2D(uScene, uvG).g, texture2D(uScene, uvB).b);
}

vec3 heat(float t) {
  // Blackbody-like ramp: ember red → orange → warm white → blue-white.
  vec3 c = mix(vec3(1.0, 0.16, 0.03), vec3(1.0, 0.5, 0.13), smoothstep(0.0, 0.35, t));
  c = mix(c, vec3(1.0, 0.86, 0.62), smoothstep(0.3, 0.7, t));
  c = mix(c, vec3(0.72, 0.84, 1.0), smoothstep(0.75, 1.5, t));
  return c;
}

vec4 diskColor(vec3 q, float rq, vec3 rayDir) {
  float x = (rq - uDisk.x) / (uDisk.y - uDisk.x);
  // Thin-disc temperature profile, peaking just outside the inner edge.
  float tp = pow(uDisk.x / rq, 0.75) * pow(max(1.0 - 0.94 * sqrt(uDisk.x / rq), 0.0), 0.25) * 2.05;
  // Orbital motion → Doppler factor; depth in the potential well → gravitational redshift.
  vec3 tang = normalize(cross(uAxis, q));
  float beta = min(0.7, sqrt(0.5 / rq));
  float dop = sqrt(1.0 - beta * beta) / (1.0 - beta * dot(tang, -rayDir));
  float shift = dop * sqrt(max(1.0 - 1.0 / rq, 0.03));
  // Streaky turbulence that shears with differential rotation; two cross-faded phases keep it from winding up forever.
  vec3 e1 = normalize(cross(uAxis, abs(uAxis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(uAxis, e1);
  float phi = atan(dot(q, e2), dot(q, e1));
  float omega = 5.0 * pow(rq, -1.5);
  float n = 0.0;
  for (int k = 0; k < 2; k++) {
    float ph = fract(uTime * 0.035 + float(k) * 0.5);
    float a = phi - omega * (uTime * 0.6 + (ph - 0.5) * 22.0);
    float w = 1.0 - abs(ph * 2.0 - 1.0);
    vec3 p = vec3(rq * 0.11 + float(k) * 0.37, cos(a) * 0.11, sin(a) * 0.11);
    n += w * (0.6 * texture(uNoise, p).r + 0.3 * texture(uNoise, p * vec3(3.1, 2.0, 2.0)).r + 0.15 * texture(uNoise, p * vec3(8.3, 4.0, 4.0)).g);
  }
  float dens = smoothstep(0.0, 0.06, x) * (1.0 - smoothstep(0.55, 1.0, x)) * (0.25 + 1.5 * n * n);
  float inten = uDiskGain * pow(tp, 2.0) * pow(shift, 3.6) * dens;
  return vec4(heat(tp * shift * 0.72) * inten, clamp(dens * 1.5, 0.0, 0.94));
}

void main() {
  vec3 rd = normalize(vec3((vUv * 2.0 - 1.0) * uTanFov, -1.0));
  vec3 ro = -uCenter;                    // camera position relative to the hole
  float tca = -dot(ro, rd);
  vec3 pc = ro + rd * tca;               // point of closest approach of the straight ray
  float b = length(pc);
  float camDist = length(ro);
  float far = max(uDisk.y * 1.2, 14.0);  // radius of the fully integrated region

  if (b >= far || (tca <= 0.0 && camDist >= far)) {
    // Weak field: closed-form deflection angle (first + second post-Newtonian order).
    vec3 col;
    if (tca > 0.0 && b < 900.0) {
      float alpha = 2.0 / b + 2.9452 / (b * b);
      // Rays that pass the hole after only a short path are bent less than rays from infinity.
      alpha *= clamp(tca / (b * 3.0), 0.0, 1.0);
      vec3 bent = normalize(rd - (pc / b) * alpha);
      col = background(rd, bent, 0.0);
    } else {
      col = texture2D(uScene, vUv).rgb;
    }
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // Strong field: integrate the photon path.
  vec3 pos = ro;
  if (camDist > far) pos = ro + rd * (tca - sqrt(far * far - b * b));
  vec3 vel = rd;
  vec3 hv = cross(pos, vel);
  float h2 = dot(hv, hv);
  float stepK = 2.3 * log(far / 1.2) / max(uSteps - 4.0, 8.0);
  vec3 col = vec3(0.0);
  float trans = 1.0;
  float rmin = 1e9;
  bool captured = false;
  int steps = int(uSteps);
  for (int i = 0; i < 96; i++) {
    if (i >= steps) break;
    float r2 = dot(pos, pos);
    float r = sqrt(r2);
    rmin = min(rmin, r);
    if (r < 1.0) { captured = true; break; }
    if (r > far * 1.01 && dot(pos, vel) > 0.0) break;
    float dt = max(r * stepK, 0.02);
    // Midpoint (RK2) step.
    vec3 acc = -1.5 * h2 * pos / (r2 * r2 * r);
    vec3 pm = pos + vel * (dt * 0.5);
    vec3 vm = vel + acc * (dt * 0.5);
    float rm2 = dot(pm, pm);
    vec3 am = -1.5 * h2 * pm / (rm2 * rm2 * sqrt(rm2));
    vec3 npos = pos + vm * dt;
    vec3 nvel = vel + am * dt;

    if (uDisk.y > 0.0) {
      float d0 = dot(pos, uAxis);
      float d1 = dot(npos, uAxis);
      if (d0 * d1 < 0.0) {
        float f = d0 / (d0 - d1);
        vec3 q = mix(pos, npos, f);
        float rq = length(q);
        if (rq > uDisk.x && rq < uDisk.y) {
          vec4 dc = diskColor(q, rq, normalize(mix(vel, nvel, f)));
          col += trans * dc.rgb;
          trans *= 1.0 - dc.a;
        }
      }
    }
    if (uJet > 0.0) {
      float hgt = dot(pm, uAxis);
      float ah = abs(hgt);
      float rad = length(pm - uAxis * hgt);
      float w = 0.3 + ah * 0.1;
      float dens = exp(-rad * rad / (w * w)) * exp(-ah / (far * 0.5)) * smoothstep(1.3, 3.5, ah);
      dens *= 0.5 + 1.1 * texture(uNoise, vec3(rad * 0.05, ah * 0.035 - uTime * 0.12, 0.37)).r;
      col += trans * vec3(0.5, 0.68, 1.0) * dens * uJet * dt * 0.5;
    }
    pos = npos;
    vel = nvel;
    if (trans < 0.02) break;
  }

  if (!captured) {
    vec3 dir = normalize(vel);
    // Light that skimmed the photon sphere is dimmed and reddened; fringes widen close to the hole.
    float skim = smoothstep(1.02, 2.2, rmin);
    vec3 bg = background(rd, dir, 0.03 * (1.0 - smoothstep(1.5, 8.0, rmin)));
    col += trans * bg * skim * mix(vec3(1.0, 0.5, 0.3), vec3(1.0), smoothstep(1.3, 3.5, rmin));
  }
  // Photon ring: light that circled the hole at b = (3√3/2)·rs, traced as a razor-thin bright line.
  if (uDisk.y > 0.0 && tca > 0.0) {
    float ring = exp(-pow((b - 2.598) / 0.035, 2.0));
    col += heat(1.1) * ring * uDiskGain * 0.55;
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export class BlackHolePass {
  readonly material: THREE.ShaderMaterial;

  constructor(noise: THREE.Data3DTexture) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
      uniforms: {
        uNoise: { value: noise }, uScene: { value: null }, uCenter: { value: new THREE.Vector3() }, uAxis: { value: new THREE.Vector3(0, 1, 0) },
        uDisk: { value: new THREE.Vector2(3, 12) }, uDiskGain: { value: 1 }, uJet: { value: 0 }, uTime: { value: 0 }, uTanFov: { value: new THREE.Vector2(1, 1) }, uSteps: { value: 40 },
      },
    });
  }

  update(view: BlackHoleView, scene: THREE.Texture, camera: THREE.PerspectiveCamera, time: number, steps: number): void {
    const u = this.material.uniforms;
    u.uScene!.value = scene;
    (u.uCenter!.value as THREE.Vector3).copy(view.center).multiplyScalar(1 / view.rs);
    (u.uAxis!.value as THREE.Vector3).copy(view.axis).normalize();
    (u.uDisk!.value as THREE.Vector2).set(view.diskInner, view.diskOuter);
    u.uDiskGain!.value = view.diskGain;
    u.uJet!.value = view.jet;
    u.uTime!.value = time % 3600;
    const tanY = Math.tan((camera.fov * Math.PI) / 360);
    (u.uTanFov!.value as THREE.Vector2).set(tanY * camera.aspect, tanY);
    u.uSteps!.value = steps;
  }

  dispose(): void {
    this.material.dispose();
  }
}
