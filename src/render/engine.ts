/**
 * The rendering engine: owns the WebGL2 context, the frame loop, the two
 * render scenes, the post-processing chain and adaptive quality.
 *
 * Rendering is camera-relative ("floating origin"): the three.js camera never
 * leaves (0, 0, 0). Callers subtract the camera's high-precision universe
 * position on the CPU and hand the engine small relative coordinates, and a
 * logarithmic depth buffer covers everything from centimetres to gigaparsecs.
 *
 *   background scene — stars, galaxies, nebulae: drawn first, no depth
 *   foreground scene — bodies of the current system: depth-tested, drawn on top
 */
import * as THREE from 'three';
import { platform } from '../platform';
import type { QualitySetting } from '../state/appState';
import { createNoiseTexture } from './noiseTexture';
import { PostFX } from './post';
import { QualityController } from './quality';
import type { QualityTier } from './qualityTiers';

export interface FrameStats {
  drawCalls: number;
  triangles: number;
  points: number;
  frameMs: number;
  fps: number;
}

export class Engine {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly background = new THREE.Scene();
  readonly scene = new THREE.Scene();
  readonly noise: THREE.Data3DTexture;
  readonly post: PostFX;
  readonly quality = new QualityController();
  readonly stats: FrameStats = { drawCalls: 0, triangles: 0, points: 0, frameMs: 16.7, fps: 60 };
  /** Called every frame before rendering (dt in seconds, clamped). */
  onFrame: ((dt: number) => void) | null = null;
  /** Width / height of the scene render target in pixels (after render scaling). */
  renderWidth = 2;
  renderHeight = 2;

  private running = false;
  private rafId = 0;
  private lastTime = 0;
  private contextLost = false;
  private cssWidth = 0;
  private cssHeight = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private readonly resizeObserver: ResizeObserver;
  private readonly contextListeners = new Set<(lost: boolean) => void>();
  private readonly disposers: Array<() => void> = [];

  /** Throws a readable error if WebGL2 is unavailable. */
  constructor(private readonly container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sf-canvas';
    // touch-action: none lets us handle every gesture ourselves (no browser pan/zoom).
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none;';
    container.appendChild(this.canvas);

    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) {
      this.canvas.remove();
      throw new Error('WebGL 2 is not available on this device or browser.');
    }
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, context: gl, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // the composite pass does its own sRGB encode
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0x000000, 1);

    // The camera sits at the origin forever; near/far only bound the log depth range.
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.25, 1e27);
    this.camera.matrixAutoUpdate = true;
    this.background.matrixWorldAutoUpdate = true;

    this.noise = createNoiseTexture();
    this.post = new PostFX(this.renderer, this.noise);

    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    window.addEventListener('orientationchange', this.resize);
    this.disposers.push(
      platform.lifecycle.onVisibilityChange((visible) => {
        // Stop burning battery in the background; reset the clock so we do not simulate a giant time step on return.
        if (visible && this.running) this.schedule();
        else cancelAnimationFrame(this.rafId);
        this.lastTime = 0;
      }),
      this.quality.onTierChange(() => this.resize()),
    );
    this.resize();
  }

  get tier(): QualityTier {
    return this.quality.tier;
  }

  get isContextLost(): boolean {
    return this.contextLost;
  }

  /** Vertical field of view in radians. */
  get fovY(): number {
    return (this.camera.fov * Math.PI) / 180;
  }

  /** Pixels per radian at the centre of the scene render target (for screen-space size estimates). */
  get pixelsPerRadian(): number {
    return this.renderHeight / (2 * Math.tan(this.fovY / 2));
  }

  setQualitySetting(setting: QualitySetting): void {
    this.quality.setSetting(setting);
  }

  onContextChange(listener: (lost: boolean) => void): () => void {
    this.contextListeners.add(listener);
    return () => this.contextListeners.delete(listener);
  }

  private readonly onContextLost = (ev: Event): void => {
    ev.preventDefault(); // tells the browser we intend to restore
    this.contextLost = true;
    cancelAnimationFrame(this.rafId);
    for (const l of [...this.contextListeners]) l(true);
  };

  private readonly onContextRestored = (): void => {
    // three.js re-creates GPU resources lazily from the CPU-side copies we keep.
    this.contextLost = false;
    this.lastTime = 0;
    this.resize(true);
    for (const l of [...this.contextListeners]) l(false);
    if (this.running) this.schedule();
  };

  /** Match the drawing buffer to the container (also called on rotation and tier changes). */
  readonly resize = (force?: boolean | Event): void => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const tier = this.quality.tier;
    const dpr = Math.min(platform.device.pixelRatio, tier.maxPixelRatio);
    const bw = Math.max(2, Math.round(w * dpr));
    const bh = Math.max(2, Math.round(h * dpr));
    if (force === true || bw !== this.canvas.width || bh !== this.canvas.height || w !== this.cssWidth || h !== this.cssHeight) {
      this.cssWidth = w;
      this.cssHeight = h;
      this.renderer.setSize(bw, bh, false);
      this.camera.aspect = w / h;
      // Keep a comfortable horizontal view in portrait: widen the vertical FOV on tall screens.
      this.camera.fov = w >= h ? 60 : Math.min(88, (2 * Math.atan(Math.tan((60 * Math.PI) / 360) * Math.min(1.75, h / w)) * 180) / Math.PI);
      this.camera.updateProjectionMatrix();
    }
    this.renderWidth = Math.max(2, Math.round(bw * this.quality.renderScale));
    this.renderHeight = Math.max(2, Math.round(bh * this.quality.renderScale));
    this.post.resize(this.renderWidth, this.renderHeight, tier);
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = 0;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private schedule(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(this.loop);
  }

  private readonly loop = (now: number): void => {
    if (!this.running || this.contextLost) return;
    this.rafId = requestAnimationFrame(this.loop);
    const rawDt = this.lastTime === 0 ? 1 / 60 : (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (this.quality.frame(rawDt)) this.resize();
    this.fpsFrames++;
    this.fpsTime += rawDt;
    if (this.fpsTime >= 0.5) {
      this.stats.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    this.stats.frameMs = this.quality.frameMs;
    this.renderFrame(Math.min(rawDt, 0.1));
  };

  /** Simulate and draw one frame. */
  renderFrame(dt: number): void {
    this.onFrame?.(dt);
    const r = this.renderer;
    r.info.reset();
    this.camera.position.set(0, 0, 0);
    this.camera.updateMatrixWorld();
    r.setRenderTarget(this.post.sceneRT);
    r.clear(true, true, false);
    r.render(this.background, this.camera);
    r.clearDepth();
    r.render(this.scene, this.camera);
    this.post.render(dt, this.camera, this.quality.tier);
    this.stats.drawCalls = r.info.render.calls;
    this.stats.triangles = r.info.render.triangles;
    this.stats.points = r.info.render.points;
  }

  /**
   * Render a frame and grab it as a PNG. Must read the canvas in the same task
   * as the draw (the drawing buffer is not preserved between frames).
   */
  captureScreenshot(): Promise<Blob | null> {
    this.renderFrame(0);
    return new Promise((resolve) => this.canvas.toBlob((blob) => resolve(blob), 'image/png'));
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    window.removeEventListener('orientationchange', this.resize);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    for (const d of this.disposers) d();
    this.post.dispose();
    this.noise.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
