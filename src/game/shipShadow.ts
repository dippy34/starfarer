import {
  Color, CustomBlending, DoubleSide, HalfFloatType, Matrix4, type Mesh, MinEquation, NearestFilter, OneFactor,
  OrthographicCamera, RGBAFormat, ShaderMaterial, Vector3, type WebGLRenderer, WebGLRenderTarget,
} from 'three';

/**
 * The ship's shadows from its star: the radiators across the hull, the hull on the radiators, the
 * nozzle's coils on the bell. A small map of the ship alone, seen from the star (an orthographic
 * view round its bounding sphere), redrawn each frame the ship is in view: one more draw of its
 * hull. Each texel holds how far along the star's light the nearest surface is (0..1 of the
 * view's depth), kept by MIN blending: no depth buffer, so the same in either depth mode the app
 * runs in (reversed-Z or logarithmic). The hull's shader reads it (`uShadow*`) with a few taps.
 */
export const SHADOW = {
  uShadowMap: { value: null as WebGLRenderTarget['texture'] | null },
  /** world (camera-relative) to the star's view */
  uShadowView: { value: new Matrix4() },
  /** half the view's width (m), its depth (m) */
  uShadowSize: { value: new Vector3(10, 60, 0) },
  /** 1 while the map is valid for what is drawn */
  uShadowOn: { value: 0 },
};

const DEPTH_VERT = /* glsl */ `
varying float vDepth;
uniform float uFar;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = clamp(-mv.z / uFar, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const DEPTH_FRAG = /* glsl */ `
varying float vDepth;
void main() { gl_FragColor = vec4(vDepth, 0.0, 0.0, 1.0); }`;

/** GLSL: the lit share of a point of the hull (1 in light, 0 in shadow), from the map. */
export const SHADOW_GLSL = /* glsl */ `
uniform sampler2D uShadowMap;
uniform mat4 uShadowView;
uniform vec3 uShadowSize;
uniform float uShadowOn;
float shipShadow(vec3 pos, vec3 N, vec3 L) {
  if (uShadowOn < 0.5) return 1.0;
  // (a little off the surface along its normal, more where the light grazes: no acne)
  vec3 p = pos + N * (0.03 + 0.05 * (1.0 - max(dot(N, L), 0.0)));
  vec4 v = uShadowView * vec4(p, 1.0);
  vec2 uv = v.xy / (2.0 * uShadowSize.x) + 0.5;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return 1.0;
  float d = -v.z / uShadowSize.y - 0.03 / uShadowSize.y;
  // four taps a texel and a half apart: a soft edge, as the star's disc would give at this size
  float t = 1.5 / 1024.0, lit = 0.0;
  lit += step(d, texture2D(uShadowMap, uv + vec2(-t, -t)).r);
  lit += step(d, texture2D(uShadowMap, uv + vec2(t, -t)).r);
  lit += step(d, texture2D(uShadowMap, uv + vec2(-t, t)).r);
  lit += step(d, texture2D(uShadowMap, uv + vec2(t, t)).r);
  return lit * 0.25;
}
`;

export class ShipShadow {
  private target = new WebGLRenderTarget(1024, 1024, {
    type: HalfFloatType, format: RGBAFormat, depthBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false,
  });
  private cam = new OrthographicCamera(-10, 10, 10, -10, 0.1, 60);
  private mat = new ShaderMaterial({
    name: 'ship-shadow',
    vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG,
    uniforms: { uFar: { value: 60 } },
    side: DoubleSide, depthTest: false, depthWrite: false,
    blending: CustomBlending, blendEquation: MinEquation, blendSrc: OneFactor, blendDst: OneFactor,
  });
  private centre = new Vector3();
  private eye = new Vector3();
  private clear = new Color();

  /**
   * Draw the map of `mesh` (in the scene as it stands) lit along `toStar` (unit, world); `radius`:
   * of a sphere round it (m, world units).
   */
  render(gl: WebGLRenderer, mesh: Mesh, toStar: Vector3, radius: number): void {
    mesh.updateMatrixWorld(true);
    const geo = mesh.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    this.centre.copy(geo.boundingSphere!.center).applyMatrix4(mesh.matrixWorld);
    const r = radius, far = 6 * r;
    this.eye.copy(this.centre).addScaledVector(toStar, 3 * r);
    const c = this.cam;
    c.left = -r; c.right = r; c.top = r; c.bottom = -r;
    c.near = 0.01; c.far = far;
    c.position.copy(this.eye);
    // (any up that is not along the light)
    c.up.set(0, 1, 0);
    if (Math.abs(toStar.y) > 0.9) c.up.set(1, 0, 0);
    c.lookAt(this.centre);
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
    this.mat.uniforms.uFar.value = far;
    const was = gl.getRenderTarget(), material = mesh.material;
    const clear = gl.getClearColor(this.clear), alpha = gl.getClearAlpha();
    gl.setRenderTarget(this.target);
    gl.setClearColor(0xffffff, 1);
    gl.clear(true, false, false);
    mesh.material = this.mat;
    try {
      gl.render(mesh, c);
    } finally {
      mesh.material = material;
      gl.setRenderTarget(was);
      gl.setClearColor(clear, alpha);
    }
    SHADOW.uShadowMap.value = this.target.texture;
    SHADOW.uShadowView.value.copy(c.matrixWorldInverse);
    SHADOW.uShadowSize.value.set(r, far, 0);
    SHADOW.uShadowOn.value = 1;
  }

  off(): void {
    SHADOW.uShadowOn.value = 0;
  }
}
