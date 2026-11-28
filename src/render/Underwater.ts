import { Matrix4, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';

/**
 * Under the water, swimming (src/app/Walk.ts): the sea round the eye, drawn over the frame. The water glows with the
 * sunlight it scatters, brighter towards the surface and darker below and with depth; overhead the sky is seen through
 * Snell's window (a cone 48.6 degrees round the vertical, where light from above the surface is bent into the eye), ringed
 * by the bright surface that reflects the water below; the sun, if it is up, glares through it. No sea floor is drawn: the
 * open sea is far too deep to see the bottom of, and the water hides what is more than a few tens of metres off.
 *
 * Drawn into the frame before its tone curve (as radiance times the exposure), over everything, as a quad that fills the
 * view; its rays are the camera's own (its inverse projection: the optical centre's offset and the field of view as the
 * frame has them).
 */
const VERT = /* glsl */ `
uniform mat4 uInvProj;
varying vec3 vRay;
void main() {
  vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
  vRay = v.xyz / v.w;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uUp;       // the water's up, in the camera's frame
uniform vec3 uSun;      // towards the sun, in the camera's frame
uniform float uSunUp;   // the sine of the sun's height over the water (below 0: night)
uniform float uDepth;   // how deep the eye is (m)
uniform vec3 uWater;    // the water's colour (linear)
uniform float uLight;   // the sunlight's radiance at the world times the exposure
uniform float uTime;
varying vec3 vRay;
void main() {
  vec3 ray = normalize(vRay);
  float c = dot(ray, uUp);
  // daylight in the water: the sun's height (a little after sunset still), and less of it the deeper the eye
  float day = clamp(uSunUp * 4.0 + 0.15, 0.0, 1.0);
  float deep = exp(-uDepth / 18.0);
  // the water's glow: from the dark below to the bright under the surface
  vec3 glow = uWater * uLight * day * deep * (0.05 + 0.6 * smoothstep(-0.8, 0.95, c));
  // Snell's window (cos 48.6 deg = 0.661): inside it the sky shows through, tinted by the water
  float win = smoothstep(0.64, 0.69, c);
  // round it the surface is a mirror for the water below: a bright ring, shimmering with the ripples on it
  float ripple = 0.5 + 0.5 * sin(dot(ray, vec3(37.0, 11.0, 23.0)) + uTime * 2.3) * sin(dot(ray, vec3(-19.0, 7.0, 41.0)) - uTime * 1.7);
  float ring = exp(-pow((c - 0.661) / 0.03, 2.0));
  vec3 col = glow + uWater * uLight * day * deep * ring * (0.5 + 0.6 * ripple);
  // light shafts: brighter streaks hanging down from the surface, moving with the waves
  float shafts = pow(0.5 + 0.5 * sin(dot(ray, vec3(53.0, 0.0, 31.0)) * 0.6 + uTime * 0.8), 6.0) * smoothstep(-0.2, 0.6, c) * (1.0 - win);
  col += uWater * uLight * day * deep * shafts * 0.25;
  // the sun through the water, while it is up
  float s = max(dot(ray, uSun), 0.0);
  col += vec3(1.0, 0.96, 0.88) * uLight * deep * max(uSunUp, 0.0) * (pow(s, 80.0) * 3.0 + pow(s, 10.0) * 0.12);
  // (the sky seen through the window is the frame's own, behind: let it through, less of it the deeper the eye)
  float a = mix(0.985, 0.2 + 0.6 * (1.0 - deep), win);
  gl_FragColor = vec4(col, a);
}`;

export interface UnderwaterView {
  /** how deep the eye is (m) */
  depth: number;
  /** the water's up, in world axes (unit) */
  up: Vector3;
  /** towards the sun, in world axes (unit), or null: no sun */
  sun: Vector3 | null;
  /** the sun's irradiance at the world (pi at 1 AU from the Sun) */
  sunIrr: number;
}

export class Underwater {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;

  constructor() {
    this.mat = new ShaderMaterial({
      name: 'underwater',
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uInvProj: { value: new Matrix4() }, uUp: { value: new Vector3(0, 1, 0) }, uSun: { value: new Vector3(0, 1, 0) }, uSunUp: { value: 1 },
        uDepth: { value: 0 }, uWater: { value: new Vector3(0.05, 0.3, 0.34) }, uLight: { value: 1 }, uTime: { value: 0 },
      },
      transparent: true, depthTest: false, depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1e6;
    this.mesh.visible = false;
    this.mesh.name = 'underwater';
  }

  /** This frame: under the water as `view` says (null: not under it), seen by `camera`, at `exposure`, `time` (s). */
  update(view: UnderwaterView | null, camera: { projectionMatrixInverse: Matrix4; matrixWorldInverse: Matrix4 }, exposure: number, time: number): void {
    this.mesh.visible = !!view && view.depth > 0.02;
    if (!view || !this.mesh.visible) return;
    const u = this.mat.uniforms;
    (u.uInvProj.value as Matrix4).copy(camera.projectionMatrixInverse);
    const up = (u.uUp.value as Vector3).copy(view.up).transformDirection(camera.matrixWorldInverse);
    if (view.sun) {
      (u.uSun.value as Vector3).copy(view.sun).transformDirection(camera.matrixWorldInverse);
      u.uSunUp.value = view.sun.dot(view.up);
    } else {
      (u.uSun.value as Vector3).copy(up);
      u.uSunUp.value = -1;
    }
    u.uDepth.value = view.depth;
    // (scene light times the exposure; an eye adapted to the dark of a night sky through the window would see it burn white)
    u.uLight.value = Math.min(3, (view.sunIrr / Math.PI) * exposure);
    u.uTime.value = time;
  }
}
