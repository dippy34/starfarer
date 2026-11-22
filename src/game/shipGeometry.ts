import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Vector2, Vector3 } from 'three';

/**
 * Procedural modelling for the ship and the cockpit: lofts, extrusions, lathes and sweeps written
 * straight into one set of vertex arrays per material pass (one draw call for a whole ship's hull).
 * Pure arithmetic, no DOM: the unit tests build the same meshes the app draws.
 *
 * Every vertex carries its surface's finish: a base colour, roughness, metalness, a surface pattern
 * (painted panels, brushed metal, tiles, radiator, foil, dark anodising, light emitter) and a group
 * (what a look or the drive's state may change: the hull's paint, the trim's, a light's channel).
 * `uv` is in metres along the surface, so a pattern keeps its size on every part.
 */

/** Surface patterns, drawn by the ship shader (shipShader.ts). */
export const PATTERN = { paint: 0, brushed: 1, tiles: 2, radiator: 3, foil: 4, dark: 5, emit: 6, glass: 7, plain: 8, bell: 9 } as const;
/**
 * Groups: 0 = as built; 1 = the hull's paint (a look's `hull` colour); 2 = trim paint (`trim`);
 * 3 = the radiators' coating (`radiator`); 4 and 5 = markings painted on the radiators and on the
 * hull (light on a dark coat, dark on a light one);
 * light channels 10 + n (n: 0 cabin, 1 port lamp, 2 starboard lamp, 3 strobe, 4 field emitters,
 * 5 engine throat and hot nozzle, 6 beacon).
 */
export const GROUP = { none: 0, hull: 1, trim: 2, radiator: 3, radiatorMark: 4, hullMark: 5, cabin: 10, port: 11, starboard: 12, strobe: 13, field: 14, throat: 15, beacon: 16 } as const;

export interface Finish {
  color: [number, number, number];
  rough: number;
  metal: number;
  pattern: number;
  group?: number;
}

const _p = new Vector3();
const _n = new Vector3();
const _nm = new Matrix3();

/** The points rounding corner `p` (between `a` before it and `b` after) by radius `r`: `segs` + 1 points, or `p` twice when sharp. */
function corner(out: Vector2[], a: Vector2, p: Vector2, b: Vector2, r: number, segs: number): void {
  const da = a.clone().sub(p).normalize(), db = b.clone().sub(p).normalize();
  const half = Math.acos(Math.max(-1, Math.min(1, da.dot(db)))) / 2;
  if (r <= 0 || half > Math.PI / 2 - 1e-3) {
    // a sharp corner (or a straight run): the point repeated, so the surface's normals do not round
    // over it (as many points as a rounded corner has: sections of one loft must match)
    for (let k = 0; k <= segs; k++) out.push(p.clone());
    return;
  }
  const t = Math.min(r / Math.tan(half), p.distanceTo(a) * 0.49, p.distanceTo(b) * 0.49);
  const p0 = p.clone().addScaledVector(da, t), p1 = p.clone().addScaledVector(db, t);
  // the arc's centre lies along the bisector
  const bis = da.clone().add(db).normalize();
  const rr = t * Math.tan(half);
  const c = p.clone().addScaledVector(bis, Math.hypot(t, rr));
  const a0 = Math.atan2(p0.y - c.y, p0.x - c.x), a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  for (let k = 0; k <= segs; k++) {
    const ang = a0 + (d * k) / segs;
    out.push(new Vector2(c.x + rr * Math.cos(ang), c.y + rr * Math.sin(ang)));
  }
}

/** A closed 2D outline: a polygon with each corner rounded by its own radius (0: sharp). */
export function roundedPolygon(corners: [number, number][], radii: number[] | number, segs = 3): Vector2[] {
  const out: Vector2[] = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const r = Array.isArray(radii) ? radii[i] : radii;
    corner(out, new Vector2(...corners[(i + n - 1) % n]), new Vector2(...corners[i]), new Vector2(...corners[(i + 1) % n]), r, segs);
  }
  return out;
}

/** An open 2D line through points, its inner corners rounded (`radii` per point; the ends stay put). */
export function roundedPolyline(points: [number, number][], radii: number[] | number, segs = 3): Vector2[] {
  const out: Vector2[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = new Vector2(...points[i]);
    if (i === 0 || i === n - 1) { out.push(p); continue; }
    const r = Array.isArray(radii) ? radii[i] : radii;
    corner(out, new Vector2(...points[i - 1]), p, new Vector2(...points[i + 1]), r, segs);
  }
  return out;
}

/** A circle (or a superellipse with `power` > 2) of `n` points, counter-clockwise from +x. */
export function ellipse(rx: number, ry: number, n: number, power = 2, phase = 0): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    out.push(new Vector2(rx * Math.sign(c) * Math.abs(c) ** (2 / power), ry * Math.sign(s) * Math.abs(s) ** (2 / power)));
  }
  return out;
}

export class MeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  readonly mat: number[] = [];
  readonly idx: number[] = [];
  /** transform applied to everything added (set with `at`) */
  private m = new Matrix4();

  get vertexCount(): number {
    return this.pos.length / 3;
  }
  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /** Place what follows with this transform (identity when omitted). */
  at(m?: Matrix4): this {
    this.m.copy(m ?? new Matrix4());
    _nm.getNormalMatrix(this.m);
    return this;
  }

  vertex(p: Vector3, n: Vector3, u: number, v: number, f: Finish): number {
    _p.copy(p).applyMatrix4(this.m);
    _n.copy(n).applyMatrix3(_nm).normalize();
    this.pos.push(_p.x, _p.y, _p.z);
    this.nrm.push(_n.x, _n.y, _n.z);
    this.uv.push(u, v);
    this.col.push(f.color[0], f.color[1], f.color[2]);
    this.mat.push(f.rough, f.metal, f.pattern, f.group ?? 0);
    return this.vertexCount - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /**
   * A surface through rings of points (each ring the same count, ordered the same way round), with
   * smooth normals from the grid itself; a point given twice in a row is a crease. `closed`: the
   * rings close on themselves. The faces turn along cross(along the rings, around them); `flip`
   * turns them the other way (rings counter-clockwise about +z, running towards +z, need it to face
   * outwards). Returns the first vertex index.
   */
  grid(rings: Vector3[][], f: Finish, closed = true, flip = false): number {
    const R = rings.length, N = rings[0].length;
    const first = this.vertexCount;
    // arc length along each ring (u) and along the rings (v), in metres
    const vAt: number[][] = [];
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let i = 0; i < R; i++) {
        if (i > 0) acc += rings[i][j].distanceTo(rings[i - 1][j]);
        (vAt[i] ??= [])[j] = acc;
      }
    }
    const tA = new Vector3(), tB = new Vector3(), nn = new Vector3();
    for (let i = 0; i < R; i++) {
      const ring = rings[i];
      let u = 0;
      for (let j = 0; j < N; j++) {
        if (j > 0) u += ring[j].distanceTo(ring[j - 1]);
        // around the ring: one-sided at a crease (a point repeated): the first copy takes the side
        // before it, the last the side after, any between both
        const p = ring[j];
        const at = (k: number) => (closed ? ring[((k % N) + N) % N] : ring[Math.max(0, Math.min(N - 1, k))]);
        const same = (q: Vector3) => q.distanceToSquared(p) < 1e-12;
        let kb = j - 1, kf = j + 1;
        while (kb > j - N && same(at(kb)) && (closed || kb > 0)) kb--;
        while (kf < j + N && same(at(kf)) && (closed || kf < N - 1)) kf++;
        const prev = at(kb), next = at(kf);
        const dupBefore = same(at(j - 1)) && (closed || j > 0), dupAfter = same(at(j + 1)) && (closed || j < N - 1);
        if (dupAfter && !dupBefore) tA.subVectors(p, prev);
        else if (dupBefore && !dupAfter) tA.subVectors(next, p);
        else tA.subVectors(next, prev);
        if (tA.lengthSq() < 1e-20) tA.subVectors(next, prev);
        // along the rings
        const a = rings[Math.max(0, i - 1)][j], b = rings[Math.min(R - 1, i + 1)][j];
        tB.subVectors(b, a);
        nn.crossVectors(tB, tA);
        if (nn.lengthSq() < 1e-20) nn.set(0, 0, i === 0 ? -1 : 1);
        nn.normalize();
        if (flip) nn.negate();
        this.vertex(p, nn, u, vAt[i][j], f);
      }
    }
    const segs = closed ? N : N - 1;
    for (let i = 0; i < R - 1; i++) {
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % N;
        const a = first + i * N + j, b = first + i * N + j1, c = first + (i + 1) * N + j1, d = first + (i + 1) * N + j;
        // (wound so that the face turns the way its vertices' normals do: cross(along, around))
        if (flip) { this.tri(a, b, c); this.tri(a, c, d); } else { this.tri(a, c, b); this.tri(a, d, c); }
      }
    }
    return first;
  }

  /** A flat cap over a ring (a fan from its centre), facing `normal`. */
  cap(ring: Vector3[], normal: Vector3, f: Finish): void {
    const c = new Vector3();
    for (const p of ring) c.add(p);
    c.divideScalar(ring.length);
    // in-plane axes for the uv
    const ax = new Vector3().subVectors(ring[0], c).normalize();
    const ay = new Vector3().crossVectors(normal, ax);
    const ci = this.vertex(c, normal, 0, 0, f);
    const base = this.vertexCount;
    for (const p of ring) {
      const d = new Vector3().subVectors(p, c);
      this.vertex(p, normal, d.dot(ax), d.dot(ay), f);
    }
    const N = ring.length;
    // winding: counter-clockwise seen from the side the normal points to
    const e1 = new Vector3().subVectors(ring[1 % N], c), e2 = new Vector3().subVectors(ring[2 % N], c);
    const ccw = new Vector3().crossVectors(e1, e2).dot(normal) >= 0;
    for (let j = 0; j < N; j++) {
      const a = base + j, b = base + ((j + 1) % N);
      if (ccw) this.tri(ci, a, b); else this.tri(ci, b, a);
    }
  }

  /**
   * A loft along z: each section a 2D outline (the same count) at its z, scaled and shifted.
   * `caps`: close the first and last sections flat.
   */
  loft(sections: { z: number; outline: Vector2[]; sx?: number; sy?: number; dx?: number; dy?: number }[], f: Finish, caps = false): number {
    const rings = sections.map((s) => s.outline.map((p) => new Vector3(p.x * (s.sx ?? 1) + (s.dx ?? 0), p.y * (s.sy ?? 1) + (s.dy ?? 0), s.z)));
    // (outlines are counter-clockwise seen from +z, and the rings run towards +z: flip so faces turn outwards)
    const first = this.grid(rings, f, true, sections[1].z > sections[0].z);
    if (caps) {
      const a = sections[0].z < sections[sections.length - 1].z;
      this.cap(rings[0], new Vector3(0, 0, a ? -1 : 1), f);
      this.cap(rings[rings.length - 1], new Vector3(0, 0, a ? 1 : -1), f);
    }
    return first;
  }

  /** A straight extrusion of an outline from z0 to z1, capped. */
  extrude(outline: Vector2[], z0: number, z1: number, f: Finish, caps = true): void {
    this.loft([{ z: z0, outline }, { z: z1, outline }], f, caps);
  }

  /** A box (centre, size) with rounded long edges (`bevel`, along z). */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, f: Finish, bevel = 0, m?: Matrix4): void {
    const hx = sx / 2, hy = sy / 2;
    const outline = bevel > 0
      ? roundedPolygon([[hx, -hy], [hx, hy], [-hx, hy], [-hx, -hy]], Math.min(bevel, hx * 0.9, hy * 0.9), 2)
      : roundedPolygon([[hx, -hy], [hx, hy], [-hx, hy], [-hx, -hy]], 0, 1);
    const t = new Matrix4().makeTranslation(cx, cy, cz);
    if (m) t.premultiply(m);
    this.at(t);
    this.extrude(outline, -sz / 2, sz / 2, f);
    this.at();
  }

  /**
   * A surface of revolution about z: `profile` points (radius, z), in order; `segs` around.
   * Smooth between profile points unless a point is given twice (a crease).
   */
  lathe(profile: [number, number][], segs: number, f: Finish, m?: Matrix4, phase = 0): void {
    const rings = profile.map(([r, z]) => {
      const ring: Vector3[] = [];
      for (let j = 0; j < segs; j++) {
        const a = phase + (j / segs) * Math.PI * 2;
        ring.push(new Vector3(r * Math.cos(a), r * Math.sin(a), z));
      }
      return ring;
    });
    this.at(m);
    // (rings ordered by increasing z turn their faces outwards with the flip; a profile that runs
    // backwards in z turns them inwards: the inside of a bell)
    this.grid(rings, f, true, true);
    this.at();
  }

  /** A torus about z (major radius R, tube radius r). */
  torus(R: number, r: number, segs: number, sides: number, f: Finish, m?: Matrix4): void {
    const rings: Vector3[][] = [];
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const rr = R + r * Math.cos(a), z = r * Math.sin(a);
      const ring: Vector3[] = [];
      for (let j = 0; j < segs; j++) {
        const b = (j / segs) * Math.PI * 2;
        ring.push(new Vector3(rr * Math.cos(b), rr * Math.sin(b), z));
      }
      rings.push(ring);
    }
    this.at(m);
    this.grid(rings, f, true, true);
    this.at();
  }

  /**
   * A profile swept along a path (parallel-transported frames; `up` fixes the first frame's
   * roll). The profile's x runs along the frame's side, y along its up. Ends capped if asked.
   */
  sweep(path: Vector3[], profile: Vector2[], f: Finish, up = new Vector3(0, 1, 0), caps = true, m?: Matrix4): void {
    const n = path.length;
    const T: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
      T.push(new Vector3().subVectors(b, a).normalize());
    }
    let U = up.clone().addScaledVector(T[0], -up.dot(T[0])).normalize();
    const rings: Vector3[][] = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        // transport the up vector from the last tangent to this one
        U = U.addScaledVector(T[i], -U.dot(T[i])).normalize();
      }
      const S = new Vector3().crossVectors(T[i], U).normalize();
      rings.push(profile.map((p) => path[i].clone().addScaledVector(S, p.x).addScaledVector(U, p.y)));
    }
    this.at(m);
    // (the profile's x is cross(tangent, up): its faces turn outwards unflipped)
    this.grid(rings, f, true, false);
    if (caps) {
      this.cap(rings[0], T[0].clone().negate(), f);
      this.cap(rings[n - 1], T[n - 1].clone(), f);
    }
    this.at();
  }

  /** A flat quad (corners in order), one-sided, facing by its winding. */
  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, f: Finish): void {
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(d, a)).normalize();
    const ux = new Vector3().subVectors(b, a), uy = new Vector3().subVectors(d, a);
    const lx = ux.length(), ly = uy.length();
    const i0 = this.vertex(a, n, 0, 0, f), i1 = this.vertex(b, n, lx, 0, f), i2 = this.vertex(c, n, lx, ly, f), i3 = this.vertex(d, n, 0, ly, f);
    this.tri(i0, i1, i2);
    this.tri(i0, i2, i3);
  }

  /** Everything added since vertex `from` again, mirrored in x (the other side of a ship). */
  mirrorX(from: number, fromIdx: number, swap?: (group: number) => number): void {
    const base = this.vertexCount;
    for (let v = from; v < base; v++) {
      this.pos.push(-this.pos[v * 3], this.pos[v * 3 + 1], this.pos[v * 3 + 2]);
      this.nrm.push(-this.nrm[v * 3], this.nrm[v * 3 + 1], this.nrm[v * 3 + 2]);
      this.uv.push(this.uv[v * 2], this.uv[v * 2 + 1]);
      this.col.push(this.col[v * 3], this.col[v * 3 + 1], this.col[v * 3 + 2]);
      const g = this.mat[v * 4 + 3];
      this.mat.push(this.mat[v * 4], this.mat[v * 4 + 1], this.mat[v * 4 + 2], swap ? swap(g) : g);
    }
    const end = this.idx.length;
    for (let i = fromIdx; i < end; i += 3) {
      // (a mirror turns the winding round)
      this.idx.push(this.idx[i] - from + base, this.idx[i + 2] - from + base, this.idx[i + 1] - from + base);
    }
  }

  /** Mark where a part starts, for `mirrorX`. */
  mark(): [number, number] {
    return [this.vertexCount, this.idx.length];
  }

  /** Centre and radius of a sphere around everything built. */
  bounds(): { centre: Vector3; radius: number; min: Vector3; max: Vector3 } {
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < this.pos.length; i += 3) {
      min.min(_p.set(this.pos[i], this.pos[i + 1], this.pos[i + 2]));
      max.max(_p);
    }
    const centre = min.clone().add(max).multiplyScalar(0.5);
    return { centre, radius: max.distanceTo(min) / 2, min, max };
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('aCol', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aMat', new BufferAttribute(new Float32Array(this.mat), 4));
    const n = this.vertexCount;
    g.setIndex(new BufferAttribute(n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** A smooth curve through points (centripetal Catmull-Rom), `per` samples between each pair. */
export function smoothPath(points: Vector3[], per: number): Vector3[] {
  const out: Vector3[] = [];
  const n = points.length;
  const P = (i: number) => points[Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t, t3 = t2 * t;
      out.push(new Vector3(
        0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
      ));
    }
  }
  out.push(points[n - 1].clone());
  return out;
}

/** A path from its left half (x < 0, in order towards the middle): the half, then its mirror back out (no point twice). */
export function mirrored(left: Vector3[]): Vector3[] {
  const right = left.slice(0, left[left.length - 1].x === 0 ? -1 : left.length).reverse().map((p) => new Vector3(-p.x, p.y, p.z));
  return [...left, ...right];
}

/** An outline turned counter-clockwise (what `sweep` and `loft` expect for outward faces). */
export function ccw(outline: Vector2[]): Vector2[] {
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area >= 0 ? outline : outline.slice().reverse();
}
