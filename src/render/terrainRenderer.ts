/**
 * Cube-sphere quadtree terrain for solid planets and moons.
 *
 * The same quadtree draws a world at every distance: six coarse patches when
 * it is a small disc, hundreds of metre-scale patches when you stand on it.
 * Patches are meshed in the data worker from the deterministic terrain
 * function; a patch is only split once all four children are ready, vertices
 * morph between levels with distance, and skirts cover what is left — so
 * detail arrives continuously, without holes or popping.
 */
import * as THREE from 'three';
import { JobCancelled, type JobHandle, type WorkerPool } from '../data/workerPool';
import { type TerrainParams, type TerrainPatchData, cubeToSphere, terrainIndices } from '../universe/terrain';
import { ATMO_GLSL, LIGHT_GLSL } from './bodyShaders';
import { NOISE_GLSL } from './noiseTexture';
import type { QualityTier } from './qualityTiers';

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aMorph;
attribute vec3 aNormalCoarse;
attribute vec4 aColor;
uniform mat3 uBodyRot;
uniform vec2 uMorph;        // distance range over which this patch morphs toward its parent's shape
uniform vec3 uPatchOrigin;  // patch origin relative to the planet centre, body-fixed frame
varying vec4 vColor;
varying vec3 vNormalW;
varying vec3 vRel;
varying vec3 vBody;         // position relative to the planet centre, world axes
varying vec3 vPatch;        // patch-local position (small numbers: safe for fine noise coordinates)
void main() {
  vec4 w0 = modelMatrix * vec4(position, 1.0);
  float m = clamp((length(w0.xyz) - uMorph.x) / max(uMorph.y - uMorph.x, 1e-3), 0.0, 1.0);
  vec3 pos = position + aMorph * m;
  vPatch = pos;
  vColor = aColor;
  vNormalW = uBodyRot * normalize(mix(normal, aNormalCoarse, m));
  vBody = uBodyRot * (uPatchOrigin + pos);
  vec4 world = modelMatrix * vec4(pos, 1.0);
  vRel = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
${LIGHT_GLSL}
${ATMO_GLSL}
uniform float uHasAtmo;
uniform vec3 uOceanColor;
uniform vec3 uEmission;       // lava glow colour (zero if none)
uniform float uIsLava;
uniform float uTime;
uniform float uPixelAngle;    // radians per pixel
uniform vec3 uDetailOff[6];   // per-patch noise offsets for six consecutive detail octaves
uniform float uDetailBase;    // log2 wavelength (metres) of the first of those octaves
uniform float uDetailStrength;
uniform float uSamples;
varying vec4 vColor;
varying vec3 vNormalW;
varying vec3 vRel;
varying vec3 vBody;
varying vec3 vPatch;

// Detail noise at world wavelength 2^(base + i), seamless across patches (offsets carry the patch origin).
vec2 detail(int i) {
  float lambda = exp2(uDetailBase + float(i));
  // A = three-octave billow (irregular, hides the noise lattice), G = finer gradient noise.
  vec4 t = texture(uNoise, vPatch / (lambda * 8.0) + uDetailOff[i]);
  return vec2(t.a, t.g) - 0.5;
}

void main() {
  #include <logdepthbuf_fragment>
  float dist = length(vRel);
  vec3 v = -vRel / dist;
  vec3 up = normalize(vBody);
  vec3 n = normalize(vNormalW);
  vec3 albedo = vColor.rgb * vColor.rgb;          // vertex colours are stored gamma-encoded
  float water = step(0.5 / 255.0, vColor.a);

  // Distance-adaptive detail: pick the two octaves whose wavelength is a few pixels here and blend between them.
  float jf = clamp(log2(max(dist * uPixelAngle * 24.0, 1e-3)) - uDetailBase, 0.0, 4.99);
  int j0 = int(floor(jf));
  float fr = jf - float(j0);
  vec2 d0 = detail(j0), d1 = detail(j0 + 1);
  vec2 dd = mix(d0, d1, fr);
  vec2 dCoarse = detail(min(j0 + 2, 5));
  // Tangent frame from the local vertical.
  vec3 t1 = normalize(cross(up, vec3(0.31, 0.57, 0.76)));
  vec3 t2 = cross(up, t1);

  vec3 col;
  float spec = 0.0;
  vec3 emit = vec3(0.0);
  if (water > 0.5) {
    float depth = vColor.a;
    if (uIsLava > 0.5) {
      // Molten rock: glowing cracks in a dark crust that slowly creeps.
      float crust = smoothstep(-0.1, 0.25, dd.x + dCoarse.y * 1.5 + 0.12 * sin(uTime * 0.2 + dCoarse.x * 20.0));
      col = mix(vec3(0.02), vec3(0.06, 0.04, 0.035), crust);
      emit = uEmission * (1.0 - crust * 0.93) * (0.6 + 2.2 * depth);
      n = normalize(up + (t1 * dd.x + t2 * dd.y) * 0.25);
    } else {
      // Sea: colour deepens with depth; small ripples roughen the reflection.
      col = mix(uOceanColor * 2.6 + vec3(0.0, 0.05, 0.05), uOceanColor, smoothstep(0.0, 0.35, depth));
      vec2 ripple = (detail(j0).yx + d1) * (0.5 + 0.5 * sin(uTime * 0.7 + dCoarse.x * 40.0));
      n = normalize(up + (t1 * ripple.x + t2 * ripple.y) * 0.1);
      spec = 1.0;
    }
  } else {
    // Land: break up the vertex colours with fine albedo variation and a bumpy normal.
    col = albedo * (1.0 + (dd.x * 0.3 + dCoarse.x * 0.22) * uDetailStrength);
    n = normalize(n + (t1 * (dd.x + dCoarse.x * 0.6) + t2 * (dd.y + dCoarse.y * 0.6)) * 0.55 * uDetailStrength);
  }

  vec3 lit = vec3(0.0);
  vec3 specCol = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    vec3 ld = normalize(uLightPos[i] - vBody);
    float ndl = max(dot(n, ld), 0.0);
    // The smooth sphere decides day vs night so that mountains past the terminator fade naturally.
    float day = smoothstep(-0.06, 0.12, dot(up, ld));
    float vis = sunVisibility(vBody, i) * ringShadow(vBody, i) * day;
    vec3 sun = uLightColor[i];
    if (uHasAtmo > 0.5) {
      // Sunlight reddens as it grazes through the atmosphere.
      float od = chapman(length(vBody), dot(up, ld));
      sun *= exp(-(uBetaR + uBetaM) * min(od, 1e7));
    }
    lit += sun * ndl * vis;
    if (spec > 0.0) {
      vec3 hv = normalize(ld + v);
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
      specCol += sun * vis * (pow(max(dot(n, hv), 0.0), 320.0) * 9.0 + fres * 0.08);
    }
  }
  // Skylight on the day side, faint starlight everywhere.
  vec3 ambient = vec3(0.004);
  if (uHasAtmo > 0.5) ambient += (uBetaR / max(max(uBetaR.r, uBetaR.g), uBetaR.b)) * 0.14 * smoothstep(-0.1, 0.3, dot(up, uSunDir[0])) * length(uSunColor[0]) * 0.5;
  vec3 colOut = col * (lit + ambient) + specCol + emit;

  if (uHasAtmo > 0.5) {
    // Aerial perspective: the air between the camera and the ground scatters light in and dims what is behind it.
    vec4 s = scatter(-v, dist, int(uSamples), 0.5);
    colOut = colOut * (1.0 - s.a) + s.rgb;
  }
  gl_FragColor = vec4(colOut, 1.0);
}`;

interface Node {
  face: number;
  level: number;
  x: number;
  y: number;
  /** Centre direction (body-fixed) and angular radius of the patch. */
  dir: [number, number, number];
  angRadius: number;
  state: 'empty' | 'loading' | 'ready';
  job: JobHandle<TerrainPatchData> | null;
  mesh: THREE.Mesh | null;
  data: TerrainPatchData | null;
  children: Node[] | null;
  lastUsed: number;
}

/** Shared uniforms the system renderer fills in for every lit body (lights, shadows, rings, atmosphere). */
export type SharedUniforms = Record<string, THREE.IUniform>;

const tmpV = new THREE.Vector3();
const tmpDir: [number, number, number] = [0, 0, 0];

export class TerrainBody {
  readonly group = new THREE.Group();
  /** Uniforms shared by all patches (lights, atmosphere…); the owner updates their values each frame. */
  readonly uniforms: SharedUniforms;
  patchCount = 0;
  private readonly roots: Node[] = [];
  private readonly base: THREE.ShaderMaterial;
  private index: THREE.BufferAttribute;
  private res: number;
  private frame = 0;
  private readonly maxLevel: number;
  private readonly visible: Node[] = [];
  private disposed = false;

  constructor(private readonly params: TerrainParams, private readonly pool: WorkerPool, noise: THREE.Data3DTexture, shared: SharedUniforms, tier: QualityTier) {
    this.res = tier.terrainPatchRes;
    this.index = new THREE.BufferAttribute(terrainIndices(this.res), 1);
    this.uniforms = {
      ...shared,
      uNoise: { value: noise }, uBodyRot: { value: new THREE.Matrix3() }, uMorph: { value: new THREE.Vector2(1e30, 2e30) }, uPatchOrigin: { value: new THREE.Vector3() },
      uOceanColor: { value: new THREE.Color().setRGB(...params.surface.oceanColor) }, uEmission: { value: new THREE.Color().setRGB(...params.surface.emissionColor).multiplyScalar(params.surface.emission * 6) },
      uIsLava: { value: params.type === 'lava' ? 1 : 0 }, uTime: { value: 0 }, uPixelAngle: { value: 0.001 },
      uDetailOff: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) }, uDetailBase: { value: 0 }, uDetailStrength: { value: params.type === 'ice' ? 0.55 : 1 }, uSamples: { value: tier.atmosphereSteps },
    };
    this.base = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, toneMapped: false });
    for (let face = 0; face < 6; face++) this.roots.push(this.makeNode(face, 0, 0, 0));
    // Cell size of ~1 m at the deepest level.
    this.maxLevel = Math.max(2, Math.min(20, Math.ceil(Math.log2(((Math.PI / 2) * params.radius) / (this.res - 1)))));
  }

  private makeNode(face: number, level: number, x: number, y: number): Node {
    const size = 2 / 2 ** level;
    cubeToSphere(face, -1 + (x + 0.5) * size, -1 + (y + 0.5) * size, tmpDir);
    return { face, level, x, y, dir: [tmpDir[0], tmpDir[1], tmpDir[2]], angRadius: ((Math.PI / 2) / 2 ** level) * 0.75, state: 'empty', job: null, mesh: null, data: null, children: null, lastUsed: 0 };
  }

  private request(node: Node, priority: number): void {
    if (node.state !== 'empty' || this.disposed) return;
    node.state = 'loading';
    node.job = this.pool.run('terrain', { params: this.params, face: node.face, level: node.level, x: node.x, y: node.y, res: this.res }, { priority });
    node.job.promise
      .then((data) => {
        node.job = null;
        if (this.disposed || node.state !== 'loading') return;
        node.data = data;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
        geo.setAttribute('aMorph', new THREE.BufferAttribute(data.morph, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 4, true));
        geo.setAttribute('aNormalCoarse', new THREE.BufferAttribute(data.normalsCoarse, 4, true));
        geo.setAttribute('aColor', new THREE.BufferAttribute(data.colors, 4, true));
        geo.setIndex(this.index);
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), data.boundRadius);
        const material = this.base.clone();
        // Share the lighting uniforms by reference; keep per-patch ones private.
        for (const key of Object.keys(this.uniforms)) {
          if (key !== 'uMorph' && key !== 'uPatchOrigin' && key !== 'uDetailOff' && key !== 'uDetailBase') material.uniforms[key] = this.uniforms[key]!;
        }
        (material.uniforms.uPatchOrigin!.value as THREE.Vector3).set(data.origin[0], data.origin[1], data.origin[2]);
        const mesh = new THREE.Mesh(geo, material);
        mesh.visible = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        node.mesh = mesh;
        node.state = 'ready';
        this.patchCount++;
      })
      .catch((err) => {
        node.job = null;
        if (node.state === 'loading') node.state = 'empty';
        if (!(err instanceof JobCancelled)) console.warn('Starfarer: terrain patch failed', err);
      });
  }

  private release(node: Node): void {
    node.job?.cancel();
    node.job = null;
    if (node.mesh) {
      this.group.remove(node.mesh);
      node.mesh.geometry.dispose();
      (node.mesh.material as THREE.Material).dispose();
      node.mesh = null;
      this.patchCount--;
    }
    node.data = null;
    node.state = 'empty';
    if (node.children) {
      for (const c of node.children) this.release(c);
      node.children = null;
    }
  }

  /**
   * Select and position patches for this frame.
   * @param camLocal   camera position in the body-fixed frame (metres from the centre)
   * @param centerRel  body centre relative to the camera (world axes)
   * @param rot        body-fixed → world rotation
   * @param focal      pixels per radian
   */
  update(camLocal: THREE.Vector3, centerRel: THREE.Vector3, rot: THREE.Quaternion, rotM: THREE.Matrix3, focal: number, tier: QualityTier, time: number): void {
    this.frame++;
    const R = this.params.radius;
    const camDist = camLocal.length();
    const alt = Math.max(camDist - R, 1);
    // Patches further round the limb than the horizon (plus a margin for mountains) cannot be seen.
    const horizon = Math.acos(Math.min(1, R / camDist)) + Math.acos(Math.min(1, R / (R + this.params.surface.relief * 0.6 + 1)));
    const cx = camLocal.x / camDist;
    const cy = camLocal.y / camDist;
    const cz = camLocal.z / camDist;
    const splitK = focal / ((this.res - 1) * tier.terrainSplitPx);
    this.visible.length = 0;
    const budget = tier.terrainMaxPatches;

    const visit = (node: Node): void => {
      node.lastUsed = this.frame;
      const cosA = Math.max(-1, Math.min(1, node.dir[0] * cx + node.dir[1] * cy + node.dir[2] * cz));
      const ang = Math.acos(cosA);
      if (node.level > 0 && ang - node.angRadius > horizon) return;
      if (node.state === 'empty') this.request(node, 2 + node.level * 0.3);
      if (node.state !== 'ready') return;
      // Distance from the camera to the nearest part of the patch (great-circle distance + altitude).
      const arc = Math.max(0, ang - node.angRadius * 0.9) * R;
      const dist = Math.sqrt(arc * arc + alt * alt);
      const size = ((Math.PI / 2) * R) / 2 ** node.level;
      const wantSplit = node.level < this.maxLevel && dist < size * splitK && this.visible.length < budget;
      if (wantSplit) {
        if (!node.children) {
          const l = node.level + 1;
          node.children = [this.makeNode(node.face, l, node.x * 2, node.y * 2), this.makeNode(node.face, l, node.x * 2 + 1, node.y * 2), this.makeNode(node.face, l, node.x * 2, node.y * 2 + 1), this.makeNode(node.face, l, node.x * 2 + 1, node.y * 2 + 1)];
        }
        let ready = true;
        for (const c of node.children) {
          if (c.state === 'empty') this.request(c, 2 + c.level * 0.3 + dist / (size * splitK));
          if (c.state !== 'ready') ready = false;
          c.lastUsed = this.frame;
        }
        if (ready) {
          for (const c of node.children) visit(c);
          return;
        }
      }
      this.visible.push(node);
    };
    for (const root of this.roots) visit(root);

    // Hide everything, then show and place this frame's selection.
    for (const child of this.group.children) child.visible = false;
    const pixelAngle = 1 / focal;
    for (const node of this.visible) {
      const mesh = node.mesh!;
      const data = node.data!;
      // Patch origin in world axes relative to the camera: centre + R·origin (float64 until the last moment).
      tmpV.set(data.origin[0], data.origin[1], data.origin[2]).applyQuaternion(rot);
      mesh.position.set(centerRel.x + tmpV.x, centerRel.y + tmpV.y, centerRel.z + tmpV.z);
      mesh.quaternion.copy(rot);
      mesh.updateMatrix();
      mesh.matrixWorld.copy(mesh.matrix);
      mesh.visible = true;
      const u = (mesh.material as THREE.ShaderMaterial).uniforms;
      // Morph toward the parent's shape near the distance at which the parent would take over.
      const parentSize = ((Math.PI / 2) * R) / 2 ** Math.max(0, node.level - 1);
      const takeover = parentSize * splitK;
      (u.uMorph!.value as THREE.Vector2).set(node.level === 0 ? 1e30 : takeover * 0.62, node.level === 0 ? 2e30 : takeover * 0.92);
      // Detail octaves for this patch: start two octaves below the pixel footprint at its nearest point.
      const near = Math.max(mesh.position.length() - data.boundRadius, alt * 0.5, 0.5);
      const base = Math.floor(Math.log2(Math.max(near * pixelAngle * 24, 1e-3)));
      u.uDetailBase!.value = base;
      const offs = u.uDetailOff!.value as THREE.Vector3[];
      for (let i = 0; i < 6; i++) {
        const period = 2 ** (base + i) * 8;
        // fract(origin / period) in float64 keeps fine noise aligned across patches without float32 loss.
        offs[i]!.set(frac(data.origin[0] / period), frac(data.origin[1] / period), frac(data.origin[2] / period));
      }
    }
    (this.uniforms.uBodyRot!.value as THREE.Matrix3).copy(rotM);
    this.uniforms.uPixelAngle!.value = pixelAngle;
    this.uniforms.uTime!.value = time;
    this.uniforms.uSamples!.value = Math.max(2, Math.round(tier.atmosphereSteps * 0.6));

    // Free subtrees that have not been needed for a while.
    if (this.frame % 30 === 0) {
      const prune = (node: Node): void => {
        if (!node.children) return;
        if (node.children.every((c) => this.frame - c.lastUsed > 240)) {
          for (const c of node.children) this.release(c);
          node.children = null;
        } else for (const c of node.children) prune(c);
      };
      for (const root of this.roots) prune(root);
    }
    if (tier.terrainPatchRes !== this.res) this.rebuild(tier.terrainPatchRes);
  }

  /** Quality tier changed the patch resolution: drop everything and let it regenerate. */
  private rebuild(res: number): void {
    for (const root of this.roots) this.release(root);
    this.res = res;
    this.index = new THREE.BufferAttribute(terrainIndices(res), 1);
  }

  dispose(): void {
    this.disposed = true;
    for (const root of this.roots) this.release(root);
    this.base.dispose();
    this.group.removeFromParent();
  }
}

function frac(x: number): number {
  return x - Math.floor(x);
}
