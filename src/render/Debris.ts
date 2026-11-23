import {
  BufferAttribute, BufferGeometry, ClampToEdgeWrapping, CustomBlending, DataTexture, DoubleSide, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh,
  LinearFilter, Line, Matrix4, Mesh, OneFactor, OneMinusSrcAlphaFactor, Quaternion, RGBAFormat, ShaderMaterial, Vector3,
} from 'three';
import type { UPos } from '../core/upos';
import { PROFILE, piecesAt, type Spread, type Swarm } from '../sim/Swarm';
import type { Body } from '../universe/Body';
import { makeRing } from './Bodies';
import { rockGeometry } from './Rocks';
import { RING_FRAG, RING_VERT } from './shaders/rings';
import { FIX_LOGDEPTH, GLOBALS, OUTPUT_FRAGMENT, PROJECT_PARS } from './shaders/xr';

const PIECE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PROJECT_PARS}
attribute vec4 aShade;   // its colour (linear, times how much light its rock sends back), and how much of its light a piece drawn larger than it is keeps
varying vec3 vN;
varying vec3 vPosView;
varying vec4 vShade;
void main() {
  vShade = aShade;
  mat3 m3 = mat3(modelMatrix) * mat3(instanceMatrix);
  vN = normalize(m3 * normal);
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vPosView = wp.xyz;
  gl_Position = projectView(viewMatrix * wp);
  #include <logdepthbuf_vertex>
${FIX_LOGDEPTH}
}`;

/** A piece of bare rock in sunlight: between Lommel-Seeliger (regolith) and Lambert, as the rocks on airless ground (src/render/Rocks.ts). */
const PIECE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunDir;
uniform float uSunIrr;
uniform float uExposure;
varying vec3 vN;
varying vec3 vPosView;
varying vec4 vShade;
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(-vPosView);
  float mu0 = dot(n, uSunDir), mu = max(dot(n, V), 0.0);
  float ls = mu0 > 0.0 ? 2.0 * mu0 / (mu0 + mu + 1e-4) : 0.0;
  float light = mix(ls * 0.5, max(mu0, 0.0), 0.55) * 1.25;
  vec3 rad = vShade.rgb * light * (uSunIrr / 3.14159265) * vShade.w;
  gl_FragColor = vec4(min(rad * uExposure, vec3(6.0e4)), 1.0);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;

const WARN_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PROJECT_PARS}
attribute float aAlong;
varying float vAlong;
void main() {
  vAlong = aAlong;
  gl_Position = projectView(modelViewMatrix * vec4(position, 1.0));
  #include <logdepthbuf_vertex>
${FIX_LOGDEPTH}
}`;
const WARN_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
varying float vAlong;
void main() {
  if (fract(vAlong * 48.0) > 0.55) discard;
  gl_FragColor = vec4(uColor, 0.95);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;

/** a piece is drawn at least this many CSS px across in radius, keeping its light (dimmer as it is drawn larger than it is) */
const LEAST_PX = 0.9;
/** the ring shows as the pieces wrap round: from this many whole turns of difference between the fastest and the slowest... */
const RING_FROM = 0.75;
/** ...fully from this many */
const RING_FULL = 2.5;
/** where the profile is fullest, the ring lets this much of the light behind it through, seen square on (a depiction: dense) */
const RING_DEEPEST = 0.92;
/** at most this many swarms drawn */
const MOST = 8;
/** the warning's circle: this many points round */
const WARN_POINTS = 160;

interface Drawn {
  sw: Swarm;
  pieces: InstancedMesh;
  ring: Mesh;
  tex: DataTexture;
  out: Float64Array;
  shown: Uint8Array;
  turn: Quaternion[];
}

/**
 * The pieces of worlds torn apart (src/sim/Swarm.ts; src/app/LivePhysics.ts keeps them), drawn
 * with the rock shapes of the ground's rocks (src/render/Rocks.ts), lit by the sun of the body they
 * go round; and, as they wrap round it, the ring they make, drawn with Saturn's rings' shader as a
 * ring of one colour whose profile is the share of the pieces' time at each distance. A piece too
 * small to see is drawn a pixel or so across with the light it has (so a far stream is a line of
 * faint dots). And the warning's circle: the Roche limit of a world being moved round what holds
 * sway there (src/app/App.ts).
 */
export class DebrisLayer {
  readonly group = new Group();
  private drawn = new Map<number, Drawn>();
  private geo = rockGeometry(7, 1);
  private warnLine: Line;
  private warnMat: ShaderMaterial;
  private rel = new Vector3();
  private sunRel = new Vector3();
  private m4 = new Matrix4();
  private v = new Vector3();
  private s = new Vector3();

  constructor(private exposure: { value: number }) {
    this.group.name = 'debris';
    const pts = new Float32Array(3 * (WARN_POINTS + 1)), along = new Float32Array(WARN_POINTS + 1);
    for (let k = 0; k <= WARN_POINTS; k++) {
      const a = (k / WARN_POINTS) * 2 * Math.PI;
      pts[3 * k] = Math.cos(a); pts[3 * k + 1] = Math.sin(a); pts[3 * k + 2] = 0;
      along[k] = k / WARN_POINTS;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pts, 3));
    g.setAttribute('aAlong', new BufferAttribute(along, 1));
    this.warnMat = new ShaderMaterial({
      name: 'roche-warning', vertexShader: WARN_VERT, fragmentShader: WARN_FRAG,
      uniforms: { uColor: { value: new Vector3(1, 0.42, 0.25) }, uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK },
      transparent: true, depthWrite: false, depthTest: true,
    });
    this.warnLine = new Line(g, this.warnMat);
    this.warnLine.name = 'roche-warning';
    this.warnLine.frustumCulled = false;
    this.warnLine.matrixAutoUpdate = false;
    this.warnLine.renderOrder = 6;
    this.warnLine.visible = false;
    this.group.add(this.warnLine);
  }

  /** One of each mesh to compile the shaders with before any is wanted. */
  warmupObjects(): (Mesh | Line)[] {
    const d = this.make({ id: -1 } as Swarm);
    return [d.pieces, d.ring, this.warnLine];
  }

  /** The meshes of a swarm (made the first time it is drawn). */
  private make(sw: Swarm): Drawn {
    const n = Math.max(1, sw.count || 1);
    const pieces = new InstancedMesh(this.geo, new ShaderMaterial({
      name: 'debris-pieces', vertexShader: PIECE_VERT, fragmentShader: PIECE_FRAG,
      uniforms: { uSunDir: { value: new Vector3(1, 0, 0) }, uSunIrr: { value: Math.PI }, uExposure: this.exposure, uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK },
    }), n);
    pieces.geometry = this.geo.clone();
    pieces.geometry.setAttribute('aShade', new InstancedBufferAttribute(new Float32Array(4 * n), 4).setUsage(DynamicDrawUsage));
    pieces.instanceMatrix.setUsage(DynamicDrawUsage);
    pieces.frustumCulled = false;
    pieces.count = 0;
    pieces.renderOrder = 1;
    const data = new Uint8Array(4 * PROFILE);
    const tex = new DataTexture(data, PROFILE, 1, RGBAFormat);
    tex.minFilter = LinearFilter; tex.magFilter = LinearFilter; tex.wrapS = ClampToEdgeWrapping; tex.wrapT = ClampToEdgeWrapping;
    tex.needsUpdate = true;
    const ring = new Mesh(makeRing(1, 2, 256), new ShaderMaterial({
      name: 'debris-ring', vertexShader: RING_VERT, fragmentShader: RING_FRAG,
      uniforms: {
        uRingTex: { value: tex }, uRingRadii: { value: new Vector3(1, 2, 0) }, uColor: { value: new Vector3(0.5, 0.5, 0.5) }, uSunDirBF: { value: new Vector3() },
        uViewDirBF: { value: new Vector3() }, uSunIrr: { value: Math.PI }, uExposure: this.exposure, uPlanetRadius: { value: 1 }, uPolar: { value: 1 },
        uCamBF: { value: new Vector3() }, uReqKm: { value: 1 }, uShine: { value: 0.02 }, uPlain: { value: 1 }, uFade: { value: 0 },
        uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK,
      },
      transparent: true, depthWrite: false, side: DoubleSide, blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
    }));
    ring.matrixAutoUpdate = false;
    ring.frustumCulled = false;
    ring.renderOrder = 2;
    ring.visible = false;
    pieces.visible = false;
    // each piece turned its own way (the same way every time it is drawn)
    const turn: Quaternion[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k * 2.399963) % (2 * Math.PI), b = ((k * 0.618034) % 1) * 2 - 1;
      turn.push(new Quaternion().setFromAxisAngle(new Vector3(Math.cos(a) * Math.sqrt(1 - b * b), Math.sin(a) * Math.sqrt(1 - b * b), b).normalize(), (k * 1.7) % (2 * Math.PI)));
    }
    return { sw, pieces, ring, tex, out: new Float64Array(3 * n), shown: new Uint8Array(n), turn };
  }

  /** The ring's opacity profile into its texture (once a swarm: its profile never changes). */
  private profile(d: Drawn, sp: Spread): void {
    const data = d.tex.image.data as Uint8Array;
    for (let b = 0; b < PROFILE; b++) {
      const a = Math.round(255 * RING_DEEPEST * sp.profile[b]);
      data[4 * b] = a; data[4 * b + 1] = a; data[4 * b + 2] = a; data[4 * b + 3] = 255;
    }
    d.tex.needsUpdate = true;
  }

  /**
   * Each frame: the swarms `list` (LivePhysics.swarmsNow) at the simulation's time `time` (s), for
   * the eye at `cam`; `cssAngle`: radians a CSS pixel; `sunOf`: the sun lighting what a body goes
   * round (null: none) and its light at a distance (sunIrradiance at 1 AU-like units, as the bodies
   * have it: src/render/Bodies.ts).
   */
  update(cam: UPos, list: readonly { sw: Swarm; sp: Spread; host: Body }[], time: number, cssAngle: number, sunOf: (b: Body) => { sun: Body; irr: number } | null): void {
    const seen = new Set<number>();
    for (const { sw, sp, host } of list.slice(-MOST)) {
      seen.add(sw.id);
      let d = this.drawn.get(sw.id);
      if (!d || d.sw !== sw) {
        if (d) this.forget(d);
        d = this.make(sw);
        this.profile(d, sp);
        this.drawn.set(sw.id, d);
        this.group.add(d.ring, d.pieces);
      }
      const hostRel = host.upos.sub(cam, this.rel);
      const lit = sunOf(host), sunDir = lit ? lit.sun.upos.sub(cam, this.sunRel).sub(hostRel).normalize() : this.sunRel.set(1, 0, 0);
      const irr = lit ? lit.irr : 0;
      // the pieces, where their orbits have them now
      const n = sw.count;
      piecesAt(sw, sp, time, d.out, d.shown);
      const shade = d.pieces.geometry.getAttribute('aShade') as InstancedBufferAttribute, sh = shade.array as Float32Array;
      const cr = sw.color[0] * sw.albedo, cg = sw.color[1] * sw.albedo, cb = sw.color[2] * sw.albedo;
      let m = 0;
      for (let k = 0; k < n; k++) {
        if (!d.shown[k]) continue;
        const x = hostRel.x + d.out[3 * k], y = hostRel.y + d.out[3 * k + 1], z = hostRel.z + d.out[3 * k + 2];
        const dist = Math.hypot(x, y, z), least = LEAST_PX * cssAngle * dist, size = Math.max(sp.piece, least);
        this.m4.compose(this.v.set(x, y, z), d.turn[k], this.s.set(size, size, size));
        d.pieces.setMatrixAt(m, this.m4);
        const keep = (sp.piece / size) ** 2;
        sh[4 * m] = cr; sh[4 * m + 1] = cg; sh[4 * m + 2] = cb; sh[4 * m + 3] = keep;
        m++;
      }
      d.pieces.count = m;
      d.pieces.visible = m > 0;
      d.pieces.instanceMatrix.needsUpdate = true;
      shade.needsUpdate = true;
      const pu = (d.pieces.material as ShaderMaterial).uniforms;
      (pu.uSunDir.value as Vector3).copy(sunDir);
      pu.uSunIrr.value = irr;
      // the ring, as the pieces wrap round: in the frame of their orbits' pole, centred on the host, in its radii
      const wraps = sp.shear * Math.max(0, time - sw.t0) / (2 * Math.PI);
      const fade = Math.max(0, Math.min(1, (wraps - RING_FROM) / (RING_FULL - RING_FROM)));
      d.ring.visible = fade > 0 && sp.outer > sp.inner && sp.inner > 0;
      if (d.ring.visible) {
        const R = sw.hostRadius, z = this.v.set(sp.pole[0], sp.pole[1], sp.pole[2]);
        // (x: any direction square to the pole)
        const xa = Math.abs(z.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
        const x = xa.sub(z.clone().multiplyScalar(xa.dot(z))).normalize(), y = z.clone().cross(x);
        this.m4.makeBasis(x, y, z).scale(this.s.set(R, R, R)).setPosition(hostRel);
        d.ring.matrix.copy(this.m4);
        d.ring.matrixWorldNeedsUpdate = true;
        const u = (d.ring.material as ShaderMaterial).uniforms;
        (u.uRingRadii.value as Vector3).set(sp.inner / R, sp.outer / R, 0);
        u.uFade.value = fade;
        u.uSunIrr.value = irr;
        u.uColor.value.set(sw.color[0] * sw.albedo / 0.5, sw.color[1] * sw.albedo / 0.5, sw.color[2] * sw.albedo / 0.5);
        // (the sun and the eye in the ring's frame: the eye in the host's radii)
        (u.uSunDirBF.value as Vector3).set(sunDir.dot(x), sunDir.dot(y), sunDir.dot(z));
        const eye = this.s.copy(hostRel).negate();
        (u.uCamBF.value as Vector3).set(eye.dot(x) / R, eye.dot(y) / R, eye.dot(z) / R);
        (u.uViewDirBF.value as Vector3).copy(u.uCamBF.value as Vector3).normalize();
        u.uReqKm.value = R / 1e3;
      }
    }
    for (const [id, d] of this.drawn) if (!seen.has(id)) { this.forget(d); this.drawn.delete(id); }
  }

  /** How many pieces are drawn now, of every swarm (for the checks). */
  get count(): number {
    let n = 0;
    for (const d of this.drawn.values()) n += d.pieces.visible ? d.pieces.count : 0;
    return n;
  }

  /** Where the pieces are drawn now, from the eye (m): for the checks. */
  positions(): Vector3[] {
    const out: Vector3[] = [], m = new Matrix4(), p = new Vector3();
    for (const d of this.drawn.values()) {
      if (!d.pieces.visible) continue;
      for (let k = 0; k < d.pieces.count; k++) { d.pieces.getMatrixAt(k, m); out.push(p.setFromMatrixPosition(m).clone()); }
    }
    return out;
  }

  /** The ring drawn now for the swarm numbered `id`: how far it has formed (0 to 1), or null if none. */
  ringOf(id: number): number | null {
    const d = this.drawn.get(id);
    return d && d.ring.visible ? ((d.ring.material as ShaderMaterial).uniforms.uFade.value as number) : null;
  }

  private forget(d: Drawn): void {
    this.group.remove(d.ring, d.pieces);
    d.pieces.geometry.dispose();
    (d.pieces.material as ShaderMaterial).dispose();
    d.ring.geometry.dispose();
    (d.ring.material as ShaderMaterial).dispose();
    d.tex.dispose();
  }

  /**
   * The warning: the Roche limit (`radius`, m) of a world being moved, round `at` (the body that
   * holds sway there, from the eye: m), in the plane whose pole is `pole`; red where the world is
   * inside it (`inside`), amber where it is near. Null: none.
   */
  warn(at: Vector3 | null, radius = 0, pole: Vector3 | null = null, inside = false): void {
    this.warnLine.visible = !!at && radius > 0 && !!pole;
    if (!at || !pole || !this.warnLine.visible) return;
    const z = pole.clone().normalize(), xa = Math.abs(z.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const x = xa.sub(z.clone().multiplyScalar(xa.dot(z))).normalize(), y = z.clone().cross(x);
    this.warnLine.matrix.makeBasis(x, y, z).scale(new Vector3(radius, radius, radius)).setPosition(at);
    this.warnLine.matrixWorldNeedsUpdate = true;
    if (inside) (this.warnMat.uniforms.uColor.value as Vector3).set(1, 0.28, 0.22);
    else (this.warnMat.uniforms.uColor.value as Vector3).set(1, 0.68, 0.3);
  }

  /** Is the warning drawn, and how large (m)? (For the checks.) */
  get warning(): { radius: number; inside: boolean } | null {
    if (!this.warnLine.visible) return null;
    const e = this.warnLine.matrix.elements, c = this.warnMat.uniforms.uColor.value as Vector3;
    return { radius: Math.hypot(e[0], e[1], e[2]), inside: c.y < 0.5 };
  }
}
