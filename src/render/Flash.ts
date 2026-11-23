import { AdditiveBlending, Mesh, PlaneGeometry, type Quaternion, ShaderMaterial, Vector3 } from 'three';
import type { UPos } from '../core/upos';
import type { Body } from '../universe/Body';
import { FIX_LOGDEPTH, GLOBALS, OUTPUT_FRAGMENT, PROJECT_PARS } from './shaders/xr';

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PROJECT_PARS}
varying vec2 vXY;
void main() {
  vXY = position.xy;
  gl_Position = projectView(modelViewMatrix * vec4(position, 1.0));
  #include <logdepthbuf_vertex>
${FIX_LOGDEPTH}
}`;
// a white core in an orange glow, both fading with uLevel; the glow reaches the quad's edge at nothing
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uLevel;
varying vec2 vXY;
void main() {
  float r = length(vXY);
  if (r >= 1.0) discard;
  float core = exp(-r * r * 18.0);
  float glow = pow(1.0 - r, 1.6);
  gl_FragColor = vec4((vec3(4.0) * core + vec3(2.2, 1.0, 0.4) * glow) * uLevel, 1.0);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;

/** how long a flash lasts (s on the screen) */
export const FLASH_SECONDS = 1.6;
/** its rise (s), and its size against the world it is on: from this many of its radii, swelling to twice that */
const RISE = 0.08, SIZE = 1.5;
/** however far away, at least this many pixels across (CSS px) */
const LEAST_PX = 90;

/**
 * A flash where two worlds met (live physics), on the world they became: a white core in an orange
 * glow that swells and fades in a second and a half. A depiction: its brightness is not worked out
 * (an impact's light depends on much that is not simulated), it is drawn over whatever is in front
 * of it, and the eye does not adapt to it (src/app/Exposure.ts never counts it).
 */
export class FlashLayer {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private on: Body | null = null;
  private age = Infinity;
  private rel = new Vector3();
  private size = new Vector3();

  constructor() {
    this.mat = new ShaderMaterial({
      name: 'impact-flash', vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uLevel: { value: 0 }, uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK },
      transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.mat);
    this.mesh.name = 'impact-flash';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
  }

  /** A flash on `b`, from now. */
  start(b: Body): void {
    this.on = b;
    this.age = 0;
  }

  /** Over (Undo, the way back to reality). */
  clear(): void {
    this.on = null;
    this.age = Infinity;
  }

  /** Is one showing? */
  get showing(): boolean {
    return this.mesh.visible;
  }

  /** Each frame: `dt` s on, for the eye at `cam` looking as `viewQuat` turns it, `pixelAngle` rad a CSS pixel. */
  update(cam: UPos, viewQuat: Quaternion, pixelAngle: number, dt: number): void {
    const b = this.on;
    this.age += dt;
    this.mesh.visible = !!b && b.valid && this.age < FLASH_SECONDS;
    if (!this.mesh.visible || !b) return;
    const t = this.age / FLASH_SECONDS;
    this.mat.uniforms.uLevel.value = Math.min(1, this.age / RISE) * (1 - t) * (1 - t);
    const rel = b.upos.sub(cam, this.rel);
    const s = Math.max(SIZE * b.radius * (1 + t), (LEAST_PX / 2) * pixelAngle * rel.length());
    this.mesh.matrix.compose(rel, viewQuat, this.size.set(s, s, s));
    this.mesh.matrixWorldNeedsUpdate = true;
  }
}
