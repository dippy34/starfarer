import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, ShaderMaterial, Vector3 } from 'three';
import { FIX_LOGDEPTH, GLOBALS, OUTPUT_FRAGMENT, PROJECT_PARS } from '../render/shaders/xr';
import { buildShip, type GlowSpec, type ShipDesign } from './shipDesign';
import { glowMaterial, shipMaterial } from './shipShader';

/**
 * Display-referred lighting for things right next to the viewer (stations; once the cockpit and the
 * ship too, which now have their own physically based shader, `shipShader.ts`): lit by the local
 * star, but shown at a pleasant brightness whatever the eye's adaptation to the sky, as a camera
 * would expose a close-up.
 */
export const LIT_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PROJECT_PARS}
varying vec3 vN;
varying vec3 vPos;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectView(viewMatrix * wp);
  #include <logdepthbuf_vertex>
${FIX_LOGDEPTH}
}`;
export const LIT_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uSpec;
uniform float uEmit;        // self-lit fraction (screens, lamps)
uniform vec3 uSunDir;       // world direction to the local star
uniform float uSun;         // 0..1 strength of direct starlight (0 in deep space)
uniform vec3 uSunColor;
uniform float uFill;        // interior fill light
varying vec3 vN;
varying vec3 vPos;
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(-vPos);
  if (dot(n, V) < 0.0) n = -n;
  float mu0 = max(dot(n, uSunDir), 0.0);
  vec3 H = normalize(uSunDir + V);
  float spec = uSpec * pow(max(dot(n, H), 0.0), mix(10.0, 80.0, uSpec)) * 1.6;
  vec3 c = uColor * (uFill * (0.6 + 0.4 * max(dot(n, V), 0.0)) + uSun * mu0 * uSunColor * 1.4) + spec * uSun * uSunColor;
  c = mix(c, uColor * 1.6, uEmit);
  gl_FragColor = vec4(c, 1.0);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;

export const LIGHT = {
  uSunDir: { value: new Vector3(1, 0.4, 0.2).normalize() },
  uSun: { value: 1 },
  uSunColor: { value: new Vector3(1, 0.97, 0.92) },
};

const mats = new Map<string, ShaderMaterial>();
/** Shared lit material (one per colour/finish). */
export function litMaterial(color: [number, number, number], spec = 0.3, emit = 0, fill = 0.08): ShaderMaterial {
  const key = `${color.join(',')}|${spec}|${emit}|${fill}`;
  let m = mats.get(key);
  if (!m) {
    m = new ShaderMaterial({
      name: 'lit', vertexShader: LIT_VERT, fragmentShader: LIT_FRAG, side: DoubleSide,
      uniforms: { uColor: { value: new Vector3(...color) }, uSpec: { value: spec }, uEmit: { value: emit }, uFill: { value: fill },
        ...LIGHT, uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK },
    });
    mats.set(key, m);
  }
  return m;
}

export interface ShipLook {
  hull: [number, number, number];
  trim: [number, number, number];
  engine: [number, number, number];
  scale: number;
  /** the radiators' coating (default: a dark high-emissivity one) */
  radiator?: [number, number, number];
}
/** The player's ship: warm white plates, a deep red-orange trim, a fusion torch's blue-violet light. */
export const PLAYER_LOOK: ShipLook = { hull: [0.7, 0.7, 0.68], trim: [0.62, 0.16, 0.06], engine: [0.62, 0.7, 1.0], scale: 1 };

/** The drive the ship shows: the fusion torch (a plume, hot radiators) or the reactionless drive (its band glows, no exhaust). */
export type ShownDrive = 'torch' | 'reactionless';

let design: ShipDesign | null = null;
let hullGeo: BufferGeometry | null = null;
let lampGeo: BufferGeometry | null = null;
let plumeGeo: BufferGeometry | null = null;

/** Quads for glows: four corners each, every vertex carrying its quad's centre, size, colour and channel. */
function glowGeometry(glows: GlowSpec[], origin = new Vector3()): BufferGeometry {
  const n = glows.length;
  const centre = new Float32Array(n * 12), corner = new Float32Array(n * 8), glow = new Float32Array(n * 16), chan = new Float32Array(n * 8);
  const idx = new Uint16Array(n * 6);
  const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  glows.forEach((g, i) => {
    for (let k = 0; k < 4; k++) {
      const v = i * 4 + k;
      centre.set([g.at[0] - origin.x, g.at[1] - origin.y, g.at[2] - origin.z], v * 3);
      corner.set(cs[k], v * 2);
      glow.set([...g.color, g.size], v * 4);
      chan.set([g.channel, g.shape], v * 2);
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  const geo = new BufferGeometry();
  // (three wants a position: each quad's centre, though the shader places its corners itself)
  geo.setAttribute('position', new BufferAttribute(centre.slice(), 3));
  geo.setAttribute('aCentre', new BufferAttribute(centre, 3));
  geo.setAttribute('aCorner', new BufferAttribute(corner, 2));
  geo.setAttribute('aGlow', new BufferAttribute(glow, 4));
  geo.setAttribute('aChan', new BufferAttribute(chan, 2));
  geo.setIndex(new BufferAttribute(idx, 1));
  return geo;
}

function shared(): { d: ShipDesign; hull: BufferGeometry; lamps: BufferGeometry; plume: BufferGeometry } {
  if (!design) {
    design = buildShip();
    hullGeo = design.hull.geometry();
    lampGeo = glowGeometry(design.glows.filter((g) => g.channel !== 7));
    plumeGeo = glowGeometry(design.glows.filter((g) => g.channel === 7), design.throat);
  }
  return { d: design, hull: hullGeo!, lamps: lampGeo!, plume: plumeGeo! };
}

let phaseSeed = 0;
const _zero = new Vector3();

/**
 * A ship (17 m long, nose towards -z): the design of `shipDesign.ts` with its look's paint, lit by
 * the star and the world nearby (`ShipLight.ts`), its lamps lit (red to port, green to starboard,
 * a strobe, a beacon), the drive it is using shown: the torch's plume and radiators glowing with
 * the heat, or the reactionless drive's band.
 */
export class ShipModel {
  readonly group = new Group();
  /** the ship itself, inside `group` (the chase view frames it here) */
  readonly body = new Group();
  readonly hull: Mesh;
  private hullMat: ShaderMaterial;
  private lampMat: ShaderMaterial;
  private plumeMat: ShaderMaterial;
  private plume: Mesh;
  /** what the ship shows: drive, throttle 0..1, and the levels that follow them with some lag */
  private drive: ShownDrive = 'torch';
  private throttle = 0;
  private idle = 0.15;
  private heat = 0;
  private torch = 0;
  private field = 0;
  /** told what the drive does (the player's ship): `setThrust` no longer sets the throat's light */
  private driven = false;

  constructor(readonly look: ShipLook = PLAYER_LOOK) {
    const { d, hull, lamps, plume } = shared();
    // (the player's ship casts shadows on itself: `ShipArt` draws its map; traffic far off does not)
    const own = look === PLAYER_LOOK;
    this.hullMat = shipMaterial({ hull: look.hull, trim: look.trim, radiator: look.radiator, shadows: own, marks: own });
    this.hull = new Mesh(hull, this.hullMat);
    // (another ship is culled when out of view; the player's is in view whenever it is shown)
    this.hull.frustumCulled = !own;
    this.hull.name = 'ship-hull';
    this.lampMat = glowMaterial();
    const lampMesh = new Mesh(lamps, this.lampMat);
    lampMesh.frustumCulled = false;
    lampMesh.renderOrder = 12;
    this.plumeMat = glowMaterial(0);
    this.plume = new Mesh(plume, this.plumeMat);
    this.plume.frustumCulled = false;
    this.plume.renderOrder = 12;
    this.plume.position.copy(d.throat);
    this.body.add(this.hull, lampMesh, this.plume);
    this.group.add(this.body);
    this.group.scale.setScalar(look.scale);
    this.group.name = 'ship';
    // lamps on the hull: where they are, the light they cast nearby
    const u = this.hullMat.uniforms;
    (u.uLampPos.value as Vector3[]).forEach((p, i) => p.copy(d.lamps[i]));
    (u.uLampCol.value as Vector3[])[0].set(0.5, 0.02, 0.01);
    (u.uLampCol.value as Vector3[])[1].set(0.02, 0.45, 0.1);
    (u.uLampCol.value as Vector3[])[2].set(1.4, 1.4, 1.4);
    // two ships' strobes never flash together
    const phase = (phaseSeed++ * 0.618) % 1 * 1.6;
    u.uPhase.value = phase;
    this.lampMat.uniforms.uPhase.value = phase;
    this.setLevels();
  }

  /** Engine glow 0..1 (idle ~0.15): the throat's light only (traffic in orbit shows no burn). */
  setThrust(t: number): void {
    if (!this.driven) this.idle = Math.max(0, Math.min(1, t));
    this.setLevels();
  }

  /** What the drive is doing (the player's ship): the plume and the heat, or the band, follow it in `update`. */
  setDrive(drive: ShownDrive, throttle: number): void {
    this.driven = true;
    this.idle = 0.15;
    this.drive = drive;
    this.throttle = Math.max(0, Math.min(1, throttle));
  }

  /**
   * The levels follow the drive: the torch's light at once, the radiators' heat over seconds (and
   * slower to cool), the band's glow in a fraction of a second.
   */
  update(dt: number): void {
    const torch = this.drive === 'torch' ? this.throttle : 0;
    const field = this.drive === 'reactionless' ? this.throttle : 0;
    const k = (tau: number) => 1 - Math.exp(-dt / tau);
    this.torch += (torch - this.torch) * k(0.08);
    this.field += (field - this.field) * k(0.25);
    this.heat += (torch - this.heat) * k(torch > this.heat ? 5 : 14);
    this.setLevels();
  }

  /** What the ship covers (model space), coarsely: for the names' mask. */
  get cover(): ShipDesign['cover'] {
    return shared().d.cover;
  }

  /**
   * Frame the ship for the chase view: `aspect` and vertical field (degrees) of the view; the camera
   * is the group's parent's origin. `turn`: how fast the ship turns (rad/s about its own x, y and z,
   * smoothed): it leads the camera a little into the turn and banks with it. `clear`: when the
   * view's optical centre is the middle of the part of it the interface leaves clear (App's
   * `centre`), that part's width and height as shares of the view's: the ship is framed as in a view
   * of that size, at its centre.
   */
  frameChase(aspect: number, fovY: number, turn?: Vector3, clear?: { w: number; h: number }): void {
    const t = Math.tan((fovY * Math.PI) / 360) * (clear?.h ?? 1);
    aspect *= (clear?.w ?? 1) / (clear?.h ?? 1);
    const halfW = Math.atan(t * aspect);
    // how wide: the radiators' span takes 66 % of an upright screen's width, a third of a wide one's
    const wide = Math.min(1, Math.max(0, (aspect - 0.6) / 1.2));
    const share = 0.66 + (0.33 - 0.66) * wide;
    const { d } = shared();
    const D = (d.span / 2) / Math.tan(share * halfW);
    // where: a little under the middle, seen from above; on a wide screen to the right of the middle
    // (over the shoulder: the middle stays clear for what is ahead, the corner where the card is too)
    const below = Math.atan((0.17 + 0.17 * wide) * t);
    const side = Math.atan(0.4 * wide * Math.tan(halfW));
    const target = new Vector3(D * Math.tan(side), -D * Math.tan(below), -D);
    this.body.position.copy(target).sub(this.group.position).divideScalar(this.group.scale.x);
    // (the nose up by 12 degrees: with the view's own slant the camera looks down on it by about 20,
    // so the radiators' tops and the canopy show, while it stays clear of the interface; it points
    // above the middle, as a chase camera that trails above a ship sees it)
    const lim = (v: number, m: number) => Math.max(-m, Math.min(m, v));
    const w = turn ?? _zero;
    this.body.rotation.set(0.21 + lim(w.x * 0.18, 0.06), lim(w.y * 0.18, 0.08), lim(w.z * 0.2 + w.y * 0.35, 0.3));
  }

  private setLevels(): void {
    const ch = this.hullMat.uniforms.uCh.value as number[];
    const lamps = this.lampMat.uniforms.uCh.value as number[];
    // 0 cabin, 1 port, 2 starboard, 3 strobe, 4 field, 5 throat, 6 beacon, 7 plume
    const throat = Math.max(this.idle * 0.6, this.torch);
    const hull = [1, 6, 6, 9, this.field, 2.5 * throat, 5, 0];
    for (let i = 0; i < 8; i++) ch[i] = hull[i];
    const glow = [0, 1.6, 1.6, 2.6, this.field * 0.8, 1.4 * throat, 1.2, 0];
    for (let i = 0; i < 8; i++) lamps[i] = glow[i];
    this.hullMat.uniforms.uHeat.value = this.heat;
    const plume = this.plumeMat.uniforms.uCh.value as number[];
    plume[7] = this.torch * 0.55;
    // the plume reaches farther the harder the torch burns
    this.plume.scale.set(1, 1, 0.35 + 0.65 * this.torch);
    this.plume.visible = this.torch > 0.003;
  }
}
