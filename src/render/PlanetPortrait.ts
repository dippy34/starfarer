import {
  type BufferGeometry, Color, HalfFloatType, Matrix3, Matrix4, Mesh, NoBlending, OrthographicCamera, PerspectiveCamera, PlaneGeometry,
  RingGeometry, Scene, ShaderMaterial, UnsignedByteType, Vector3, type WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { generatedLook, lightRing, lookUniforms, RING_SPAN, ringMaterial, type LookSpec } from './PlanetLook';
import { BODY_VERT } from './shaders/body';
import { EXO_FRAG } from './shaders/planet';
import { TONE_GLSL } from './shaders/tone';

/**
 * A picture of a world with a generated look (a made world's, on its card while it is made: src/ui/Hud.ts):
 * drawn with the very shaders that draw it in space (src/render/PlanetLook.ts), in a studio of its own. Lit
 * from the upper left and a little from in front, so that most of what faces the eye is in daylight; seen
 * from a little above its equator, so that a ring opens out; at the exposure the eye settles on when the
 * world fills the view (App.updateExposure: 0.45 over the radiance of its lit ground), and tone-mapped as the
 * screen is (the composite's curve, then sRGB). Read back as pixels for the card, with an alpha of how much
 * of each pixel it covers: drawn only when the look changes, a few small passes, nothing in a frame.
 */
export interface Portrait {
  width: number;
  height: number;
  /** RGBA, not premultiplied, the bottom row first (as the GPU reads them back) */
  pixels: Uint8Array;
}

/** how far the eye is, in the world's radii (far enough that the perspective is that of a photograph) */
const EYE_RADII = 12;
/** how far the north pole leans towards the eye (rad): a ring is seen a little from above */
const TILT = 0.45;
/** the turn of the world about its axis (rad): any; the same for every picture, so that only the look changes */
const SPIN = 2.1;
/** where its sun is: the upper left, a little in front (from the world, in the eye's frame) */
const SUN = new Vector3(-0.62, 0.42, 0.66).normalize();
/** what the eye's exposure aims for on the lit ground of a world that fills the view (App.updateExposure) */
const KEY = 0.45;
/** room left round the world and its ring, as a share of the picture */
const MARGIN = 1.06;

const TONE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const TONE_FRAG = /* glsl */ `
uniform sampler2D tSrc;
varying vec2 vUv;
${TONE_GLSL}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec4 s = texture2D(tSrc, vUv);
  float a = clamp(s.a, 0.0, 1.0);
  // (the edges are a share of the world over nothing: its own colour is the colour over the share)
  vec3 c = a > 0.0 ? toSRGB(spTone(min(s.rgb / a, vec3(6.0e4)))) : vec3(0.0);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), a);
}`;

export class PlanetPortrait {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(20, 2, 1, 2);
  private readonly flat = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly toneMat = new ShaderMaterial({ vertexShader: TONE_VERT, fragmentShader: TONE_FRAG, uniforms: { tSrc: { value: null } }, depthTest: false, depthWrite: false, blending: NoBlending });
  private readonly toneScene = new Scene();
  private hdr: WebGLRenderTarget | null = null;
  private ldr: WebGLRenderTarget | null = null;
  private ringGeo: RingGeometry | null = null;

  constructor(private readonly gl: WebGLRenderer, private readonly sphere: BufferGeometry) {
    const quad = new Mesh(new PlaneGeometry(2, 2), this.toneMat);
    quad.frustumCulled = false;
    this.toneScene.add(quad);
  }

  /** The picture of the world `spec` describes, `width` by `height` device pixels. */
  draw(spec: LookSpec, width: number, height: number): Portrait {
    const gl = this.gl, look = generatedLook(spec), R = spec.radius, D = EYE_RADII * R;
    this.targets(width, height);
    // the world: its orientation (body-fixed Z its pole), at the eye's distance straight ahead
    const turn = new Matrix4().makeRotationX(TILT - Math.PI / 2).multiply(new Matrix4().makeRotationZ(SPIN));
    const rot3 = new Matrix3().setFromMatrix4(turn), at = new Vector3(0, 0, -D);
    const place = turn.clone().scale(new Vector3(R, R, R)).setPosition(at);
    // the eye's exposure, and nothing shared with the frame on the screen: no pull-in, depth as it is, every octave
    const u = lookUniforms(spec, look, { value: KEY / Math.min(1, 1.5 * look.albedo) });
    u.uPullIn = { value: 0 };
    u.uDepthK = { value: 1 };
    u.uLite = { value: 0 };
    (u.uSunDir.value as Vector3).copy(SUN);
    u.uSunIrr.value = Math.PI;
    (u.uBodyToWorld.value as Matrix3).copy(rot3);
    u.uCamAlt.value = D - R;
    u.uRadius.value = R;
    u.uRelief.value = Math.min(20e3, R * 0.002) / R;
    const mat = new ShaderMaterial({ name: 'portrait', vertexShader: BODY_VERT, fragmentShader: EXO_FRAG, uniforms: u });
    const world = new Mesh(this.sphere, mat);
    world.matrixAutoUpdate = false;
    world.matrix.copy(place);
    world.matrixWorldNeedsUpdate = true;
    world.frustumCulled = false;
    world.renderOrder = 1;
    this.scene.add(world);
    let ring: Mesh | null = null;
    if (spec.rings) {
      this.ringGeo ??= new RingGeometry(RING_SPAN[0], RING_SPAN[1], 256, 1);
      const rm = ringMaterial(spec, look, 'portrait-ring');
      rm.uniforms.uPullIn = { value: 0 };
      rm.uniforms.uDepthK = { value: 1 };
      ring = new Mesh(this.ringGeo, rm);
      ring.matrixAutoUpdate = false;
      ring.matrix.copy(place);
      ring.matrixWorldNeedsUpdate = true;
      ring.frustumCulled = false;
      ring.renderOrder = 3;
      const inv = rot3.clone().transpose();
      lightRing(ring, u.uExposure.value as number, SUN.clone().applyMatrix3(inv), new Vector3(0, 0, D / R).applyMatrix3(inv));
      this.scene.add(ring);
    }
    // the frame: the world (and its ring as far as its ringlets reach, seen from TILT above its plane) with a little room round it
    const reach = spec.rings ? Math.min(RING_SPAN[1], look.pal.uRingOut as number) : 1;
    const halfW = reach * R * MARGIN;
    const halfH = Math.max(R, reach * R * Math.sin(TILT)) * MARGIN;
    const aspect = width / height;
    this.camera.aspect = aspect;
    this.camera.fov = (2 * Math.atan(Math.max(halfH, halfW / aspect) / (D - R)) * 180) / Math.PI;
    this.camera.near = D - RING_SPAN[1] * R * 1.1;
    this.camera.far = D + RING_SPAN[1] * R * 1.1;
    this.camera.updateProjectionMatrix();
    // drawn into targets of its own, the frame on the screen untouched
    const was = { target: gl.getRenderTarget(), xr: gl.xr.enabled, clear: gl.getClearColor(new Color()), alpha: gl.getClearAlpha(), auto: gl.autoClear };
    gl.xr.enabled = false;
    gl.autoClear = false;
    gl.setClearColor(0x000000, 0);
    gl.setRenderTarget(this.hdr);
    gl.clear(true, true, true);
    gl.render(this.scene, this.camera);
    this.toneMat.uniforms.tSrc.value = this.hdr!.texture;
    gl.setRenderTarget(this.ldr);
    gl.clear(true, false, false);
    gl.render(this.toneScene, this.flat);
    const pixels = new Uint8Array(width * height * 4);
    gl.readRenderTargetPixels(this.ldr!, 0, 0, width, height, pixels);
    gl.setRenderTarget(was.target);
    gl.setClearColor(was.clear, was.alpha);
    gl.autoClear = was.auto;
    gl.xr.enabled = was.xr;
    // (each picture its own materials: let go at once, the program they share stays)
    this.scene.remove(world);
    mat.dispose();
    if (ring) {
      this.scene.remove(ring);
      (ring.material as ShaderMaterial).dispose();
    }
    return { width, height, pixels };
  }

  /** The GPU memory of the pictures let go (until the next). */
  release(): void {
    this.hdr?.dispose();
    this.ldr?.dispose();
    this.hdr = this.ldr = null;
  }

  private targets(width: number, height: number): void {
    if (this.hdr && this.hdr.width === width && this.hdr.height === height) return;
    this.release();
    this.hdr = new WebGLRenderTarget(width, height, { type: HalfFloatType, samples: 4, depthBuffer: true });
    this.ldr = new WebGLRenderTarget(width, height, { type: UnsignedByteType, depthBuffer: false });
  }
}
