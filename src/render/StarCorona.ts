import { AdditiveBlending, Mesh, PlaneGeometry, Quaternion, ShaderMaterial, Vector2, Vector3, Vector4 } from 'three';
import { CORONA_FRAG, CORONA_VERT } from './shaders/star';
import { FACE_KEY, faceLight, faceResponse, PROM_SLOTS, spotAt, type StarLook } from './StarLook';
import { GLOBALS } from './shaders/xr';

/** Quad half-size, in star radii. */
const QUAD = 4;
/**
 * A star is drawn as if it were no farther than this (m): its corona's quad on a copy that near,
 * its own mesh with its clip coordinates scaled to it (BODY_VERT: uClipScale).
 */
export const STAR_NEAR = 1e7;
const geo = new PlaneGeometry(2, 2);

/**
 * It stays well under the brightness of the limb it rises from (GLOW of the disk's mean): a
 * star's limb is its darkest part, and a glow that outshines it rims the star with light. A
 * prominence is shown PROMINENCE times as bright as the face's own colours of its kind.
 */
const GLOW = 0.26;
const PROMINENCE = 1;
/** The narrowest a prominence seen edge on is drawn, as a share of its height. */
const EDGE_ON = 0.22;

/** A star as its corona needs it: where and how large, how it is turned, how it looks. */
export interface CoronaStar {
  /** from the eye to its centre (m) */
  rel: Vector3;
  radius: number;
  /** its own frame (z: the spin axis) in the world's */
  turn: Quaternion;
  look: StarLook;
}

/**
 * What stands round a resolved star: its corona (the glow at the limb, streamers), its
 * chromosphere and its prominences, on a camera-facing quad. Artistic in strength (a real corona
 * is a millionth of the disk's brightness), like the glow photographs show; its shape and
 * activity follow the star's look, and its prominences the star's turning.
 */
export class StarCorona {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;

  constructor() {
    this.mat = new ShaderMaterial({
      name: 'star-corona', vertexShader: CORONA_VERT, fragmentShader: CORONA_FRAG,
      uniforms: {
        uColor: { value: new Vector3(1, 1, 1) }, uPromColor: { value: new Vector3(1, 1, 1) }, uPromHot: { value: new Vector3(1, 1, 1) },
        uIntensity: { value: 1 }, uPromLevel: { value: 1 }, uQuad: { value: QUAD },
        uFaceK: { value: new Vector3() }, uFaceP: { value: new Vector3() }, uLevel: { value: 1 },
        uCorona: { value: 0.6 }, uRays: { value: 1 }, uChromo: { value: 0 }, uProm: { value: 0 }, uSeed: { value: 0 }, uTime: { value: 0 },
        uAxis2: { value: new Vector2(0, 1) }, uAxisSee: { value: 1 }, uMinor: { value: 1 }, uSinLimb: { value: 1 }, uLimbPx: { value: 100 },
        uCopy: { value: 1 }, uRadiusM: { value: 1 },
        uPromFeet: { value: Array.from({ length: PROM_SLOTS }, () => new Vector4()) },
        uPromTop: { value: Array.from({ length: PROM_SLOTS }, () => new Vector4()) }, uPromCount: { value: 0 },
        uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK,
      },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.visible = false;
  }

  /**
   * Place round `star`, facing `viewQuat`, a CSS pixel taking `pixelAngle` rad. `display`: the
   * disk's displayed (pre-tonemap) brightness, which the glow follows; `time` (s) moves what
   * changes by itself, `turned` (s at the star's full rate: StarLook.turnShare) what goes round
   * with the star.
   */
  update(star: CoronaStar, viewQuat: Quaternion, pixelAngle: number, display: number, time: number, turned: number): void {
    const { rel, radius, look } = star;
    const u = this.mat.uniforms;
    // the glow is of the face's own colour, a little deeper (its darker light); a prominence's
    // gas glows like the face where that is brighter, its brightest threads like an active region
    const glow = faceLight(look.face, 0.7), lum = 0.2126 * glow[0] + 0.7152 * glow[1] + 0.0722 * glow[2];
    (u.uColor.value as Vector3).set(glow[0] / lum, glow[1] / lum, glow[2] / lum);
    const answer = faceResponse(look.face);
    (u.uFaceK.value as Vector3).set(...answer.k);
    (u.uFaceP.value as Vector3).set(...answer.p);
    u.uLevel.value = Math.min(3, display / FACE_KEY);
    (u.uPromColor.value as Vector3).set(...faceLight(look.face, 1.5));
    (u.uPromHot.value as Vector3).set(...faceLight(look.face, 3.2));
    // a fixed display-level glow once the disk is bright enough to see (not dimmed by adaptation)
    // (close to a star the eye is adapted to the surface filling the view: the corona, a millionth
    // of its brightness, fades from sight)
    const near = Math.min(1, Math.max(0, (rel.length() / radius - 1.4) / 4.6));
    u.uIntensity.value = GLOW * Math.min(1.2, display) * (0.3 + 0.7 * near * near * (3 - 2 * near));
    u.uPromLevel.value = PROMINENCE * Math.min(1.5, display / FACE_KEY);
    u.uCorona.value = look.corona;
    u.uRays.value = look.rays;
    u.uProm.value = look.prominences;
    u.uChromo.value = look.chromosphere;
    u.uSeed.value = look.seed;
    u.uTime.value = time;
    // the spin axis seen in the quad's frame: the streamers are laid out by it, and a flattened
    // disk's outline is an ellipse along it
    const toView = inv.copy(viewQuat).invert();
    const ax = axis.set(0, 0, 1).applyQuaternion(star.turn).applyQuaternion(toView);
    const sin2 = ax.x * ax.x + ax.y * ax.y;
    (u.uAxis2.value as Vector2).set(ax.x, ax.y).normalize();
    if (sin2 < 1e-8) (u.uAxis2.value as Vector2).set(0, 1);
    u.uAxisSee.value = Math.sqrt(Math.min(1, sin2));
    u.uMinor.value = Math.sqrt(ax.z * ax.z + (1 - look.flattening) ** 2 * sin2);
    // Drawn on a scaled-down copy nearer the eye (same directions, same angular size): a quad
    // around a giant star is ~1e12 m across, and triangles that size come out garbled (seen in
    // software rasterisers: one triangle missing, the glow smeared into a slab). Its depth is
    // written as the star's own (CORONA_VERT), so the star's face hides the glow behind it.
    const k = Math.min(1, STAR_NEAR / Math.max(rel.length(), 1));
    u.uCopy.value = k;
    u.uRadiusM.value = radius;
    // up close the disk's visible edge (where the sight lines graze the sphere) lies outside the
    // radius in the quad's plane through the centre: size the quad so r = 1 is that edge
    const d = Math.max(rel.length(), radius * 1.0001);
    const sinLimb = radius / d;
    u.uSinLimb.value = sinLimb;
    u.uLimbPx.value = Math.asin(sinLimb) / pixelAngle;
    const limb = d / Math.sqrt(d * d - radius * radius);
    const s = radius * QUAD * k * Math.min(limb, 8);
    this.mesh.matrix.compose(rel.clone().multiplyScalar(k), viewQuat, new Vector3(s, s, s));
    this.mesh.matrixWorldNeedsUpdate = true;
    this.mesh.visible = display > 1e-4;

    // the prominences that reach over the limb as seen from here
    centre.copy(rel).applyQuaternion(toView);
    const feet = u.uPromFeet.value as Vector4[], tops = u.uPromTop.value as Vector4[];
    let n = 0;
    for (let i = 0; i < look.proms.length && n < PROM_SLOTS; i++) {
      const pr = look.proms[i];
      spotAt(look, pr.a, turned, a3).applyQuaternion(star.turn);
      spotAt(look, pr.b, turned, b3).applyQuaternion(star.turn);
      top3.copy(a3).add(b3).normalize().multiplyScalar(1 + pr.height);
      const reach = seenAt(top3, radius, sinLimb, toView, top2);
      if (reach < 0.99 || seenAt(a3, radius, sinLimb, toView, a2) < 0 || seenAt(b3, radius, sinLimb, toView, b2) < 0) continue;
      // seen edge on, its two feet fall on one another: it keeps some width across its height
      mid.copy(a2).add(b2).multiplyScalar(0.5);
      half.copy(b2).sub(a2).multiplyScalar(0.5);
      rise.copy(top2).sub(mid);
      const height = rise.length();
      if (height < 1e-5) continue;
      const across = (half.x * rise.y - half.y * rise.x) / height;       // the feet's half-width across the rise
      if (Math.abs(across) < EDGE_ON * height) {
        const more = (across < 0 ? -1 : 1) * EDGE_ON * height - across;
        half.x += (rise.y / height) * more;
        half.y -= (rise.x / height) * more;
      }
      feet[n].set(mid.x - half.x, mid.y - half.y, mid.x + half.x, mid.y + half.y);
      tops[n].set(top2.x, top2.y, pr.curtain ? 1 : 0, (i + 1) / (look.proms.length + 1));
      n++;
    }
    u.uPromCount.value = n;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}

const inv = new Quaternion();
const axis = new Vector3(), centre = new Vector3(), point = new Vector3();
const a3 = new Vector3(), b3 = new Vector3(), top3 = new Vector3();
const a2 = new Vector2(), b2 = new Vector2(), top2 = new Vector2(), mid = new Vector2(), half = new Vector2(), rise = new Vector2();

/**
 * Where a point of a star is seen on its corona's quad: `p` in star radii from its centre (the
 * world's axes), the centre at `centre` in view space. `out`: on the quad, in units of the limb's
 * radius (so 1 is the disk's edge, as CORONA_FRAG measures it). Returns its distance from the
 * disk's middle in those units, or -1 behind the eye.
 */
function seenAt(p: Vector3, radius: number, sinLimb: number, toView: Quaternion, out: Vector2): number {
  point.copy(p).applyQuaternion(toView).multiplyScalar(radius).add(centre);
  if (point.z > -1e-6 * radius) return -1;
  // the angle between the sight lines to it and to the centre, as the limb's own is measured
  const cos = point.dot(centre) / (point.length() * centre.length());
  const r = Math.sqrt(Math.max(1 - cos * cos, 0)) / sinLimb;
  // which way from the centre on the quad (its plane: through the centre, across the view)
  const k = centre.z / point.z;
  const dx = point.x * k - centre.x, dy = point.y * k - centre.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12 * radius) { out.set(0, 0); return r; }
  out.set((dx / len) * r, (dy / len) * r);
  return r;
}
