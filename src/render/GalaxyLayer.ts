import {
  BackSide, CubeCamera, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, Matrix3, Mesh, type PerspectiveCamera, Scene,
  ShaderMaterial, SphereGeometry, Vector3, WebGLCubeRenderTarget, type WebGLRenderer,
} from 'three';
import { DUST_NORM, GALAXY } from '../universe/Galaxy';
import { GLOW_VERT, glowFrag } from './shaders/galaxy';

/** Light closer than this (pc) is drawn as individual stars, not as glow. */
export const GLOW_NEAR = 300;

/**
 * Which faces of the glow's cube map to draw this frame, and whether the map is whole after them:
 * the first `maxFaces` of those not yet done.
 */
export function nextFaces(done: readonly boolean[], maxFaces: number): { faces: number[]; whole: boolean } {
  const faces: number[] = [];
  for (let f = 0; f < 6 && faces.length < maxFaces; f++) if (!done[f]) faces.push(f);
  return { faces, whole: faces.length + done.filter(Boolean).length === 6 };
}

/**
 * The Milky Way's unresolved starlight from the explorer's position: the galaxy model ray-marched
 * into a cube map (shaders/galaxy.ts) and shown by the sky layer. From outside the galaxy the same
 * map shows the whole spiral.
 *
 * When the eye has moved far enough to change it, the map is drawn again a face a frame (six faces
 * at once would be six times a frame's work in one frame) into a third cube map, all six faces
 * from one place: the maps shown are always whole, each of one place. (Drawn into the map in use,
 * faces from places far apart met in hard seams across the sky while the app's own flight carried
 * the eye thousands of parsecs a frame.) The sky shows the last two maps blended, `blend` of the
 * way from `prev` to `target`, the blend going on over the frames the next one takes to draw:
 * shown one after the other, each new map was a step in the glow's brightness every six frames.
 */
export class GalaxyGlow {
  /** the newest whole map, from one place (`cam`) */
  target: WebGLCubeRenderTarget;
  /** the one before it, and how far the sky has gone from it to `target` (0 to 1) */
  prev: WebGLCubeRenderTarget;
  blend = 1;
  /** the map being drawn, the faces of it done, and the place (galactocentric pc) it is drawn from */
  private back: WebGLCubeRenderTarget;
  private backDone: boolean[] = [false, false, false, false, false, false];
  private backPos: Vector3 | null = null;
  private shown = false;
  private scene = new Scene();
  private cubeCam: CubeCamera;
  private mat: ShaderMaterial;
  private seed = 0;
  /** headset quality: smaller map, fewer samples */
  vr = false;
  /** the places the newest map and the one before were drawn from (galactocentric pc) */
  readonly cam = new Vector3();
  readonly prevCam = new Vector3();

  constructor() {
    this.target = make(512);
    this.prev = make(512);
    this.back = make(512);
    this.cubeCam = new CubeCamera(0.1, 10, this.back);
    this.mat = new ShaderMaterial({
      name: 'galaxy-glow', vertexShader: GLOW_VERT, fragmentShader: glowFrag(DUST_NORM),
      uniforms: {
        uCam: { value: new Vector3() }, uToGal: { value: new Matrix3().copy(GALAXY.toGalM) },
        uNear: { value: GLOW_NEAR }, uSteps: { value: 128 }, uSeed: { value: 0 },
      },
      side: BackSide, depthTest: false, depthWrite: false,
    });
    const m = new Mesh(new SphereGeometry(1, 32, 16), this.mat);
    m.frustumCulled = false;
    this.scene.add(m);
  }

  /** true once a whole map has been drawn */
  get ready(): boolean {
    return this.shown;
  }

  /** Compile the ray-marching shader ahead of its first use. */
  compile(gl: WebGLRenderer): void {
    // with the cube target bound, as in update(): the program depends on the output target
    // (colour space, tone mapping), and compiling for the canvas left a compile mid-flight
    const prevTarget = gl.getRenderTarget();
    const xrWas = gl.xr.enabled;
    gl.xr.enabled = false;
    gl.setRenderTarget(this.back, 0);
    void gl.compileAsync(this.scene, this.cubeCam.children[0] as PerspectiveCamera).catch(() => undefined);
    gl.xr.enabled = xrWas;
    gl.setRenderTarget(prevTarget);
  }

  /** distance (pc) beyond which moving the eye visibly changes the glow */
  private threshold(p: Vector3): number {
    const outside = Math.max(0, Math.abs(p.z) - 4000, Math.hypot(p.x, p.y) - 22000);
    return 0.004 * Math.max(GLOW_NEAR, outside);
  }

  /**
   * Go on drawing the map for the eye at galactocentric `camGal` (pc), up to `maxFaces` faces this
   * frame: a map begun is finished from the place it was begun at, then shown; a new one is begun
   * once the eye is far enough from the place of the map shown.
   */
  update(gl: WebGLRenderer, camGal: Vector3, maxFaces = 1): void {
    const size = this.vr ? 256 : 512;
    if (this.target.width !== size) {
      for (const t of [this.target, this.prev, this.back]) t.dispose();
      this.target = make(size);
      this.prev = make(size);
      this.back = make(size);
      this.cubeCam.renderTarget = this.back;
      this.shown = false;
      this.backPos = null;
    }
    // (a step a frame: the blend is done as the next map, a face a frame, is whole)
    this.blend = Math.min(1, this.blend + 1 / 6);
    if (!this.backPos) {
      if (this.shown && this.cam.distanceTo(camGal) <= this.threshold(camGal)) return;
      this.backPos = camGal.clone();
      this.backDone.fill(false);
      this.seed = (this.seed + 1) % 64; // (one jitter for the whole map)
    }
    const { faces, whole } = nextFaces(this.backDone, maxFaces);
    if (this.cubeCam.coordinateSystem !== gl.coordinateSystem) {
      this.cubeCam.coordinateSystem = gl.coordinateSystem;
      this.cubeCam.updateCoordinateSystem();
    }
    this.cubeCam.updateMatrixWorld(true);
    const u = this.mat.uniforms;
    (u.uCam.value as Vector3).copy(this.backPos);
    u.uSteps.value = this.vr ? 80 : 128;
    u.uSeed.value = this.seed;
    const prevTarget = gl.getRenderTarget();
    const prevFace = gl.getActiveCubeFace();
    const prevMip = gl.getActiveMipmapLevel();
    const xrWas = gl.xr.enabled;
    gl.xr.enabled = false;
    for (const f of faces) {
      // (the mip levels are made once, with the last face)
      this.back.texture.generateMipmaps = whole && f === faces[faces.length - 1];
      gl.setRenderTarget(this.back, f);
      gl.render(this.scene, this.cubeCam.children[f] as PerspectiveCamera);
      this.backDone[f] = true;
    }
    gl.xr.enabled = xrWas;
    gl.setRenderTarget(prevTarget, prevFace, prevMip);
    if (whole) {
      // show it, the sky going over to it from the one shown till now (from the start, the first),
      // and draw the next one into the map before that
      if (this.shown) [this.prev, this.target, this.back] = [this.target, this.back, this.prev];
      else [this.target, this.back] = [this.back, this.target];
      this.blend = this.shown ? 0 : 1;
      this.cubeCam.renderTarget = this.back;
      this.prevCam.copy(this.shown ? this.cam : this.backPos);
      this.cam.copy(this.backPos);
      this.backPos = null;
      this.shown = true;
    }
  }
}

function make(size: number): WebGLCubeRenderTarget {
  return new WebGLCubeRenderTarget(size, {
    type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, depthBuffer: false,
  });
}
