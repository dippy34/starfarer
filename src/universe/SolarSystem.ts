import { Matrix3, Matrix4, Vector3 } from 'three';
import { type ApproxElements, Ephemeris } from '../astro/ephemeris';
import { elementsFromMeanAnomaly, keplerState, type OrbitalElements, periodDays } from '../astro/kepler';
import { evaluateRotation, type NutPrecAngles, orientationMatrix, type Orientation, type RotationModel } from '../astro/rotation';
import { eclToEqu, OBLIQUITY_J2000, poleFrame } from '../core/frames';
import { setLeapSeconds } from '../core/time';
import { AU, DAY, GM_SUN, J2000_JD, SUN_ABS_MAG, SUN_TEFF } from '../core/units';
import { Body, type BodyType } from './Body';

interface SatOrbit {
  frame: 'ecliptic' | 'equatorial' | 'laplace';
  epochJd: number; a: number; e: number; w: number; M: number; i: number; node: number; P: number;
  Pw?: number; Pnode?: number; poleRa?: number; poleDec?: number; ephemeris?: string;
  /** mean-longitude calibration against JPL Horizons (pipeline/build_solar_system.py) */
  fit?: {
    dM: number; dn: number; dn2: number; nodeSign?: number; lambdaMode?: number; dNode?: number; di?: number; nodeRate?: number;
    libAmp?: number; libPeriod?: number; libPhase?: number; rmsDeg?: number; source?: string;
  };
}
interface KeplerEphem { kind: 'kepler'; frame: 'ecliptic'; center: number; epochJd: number; a: number; e: number; i: number; node: number; w: number; M: number }
interface SpkEphem { kind: 'spk'; chain: [number, number][]; barycenter?: number }
/** Piecewise osculating elements from JPL Horizons: [jd, q_km, e, i, node, peri, tp_jd, n_deg_day] (ICRF, planet-centred). */
interface OsculatingTable { rows: number[][]; rmsDeg: number; source: string }
interface SatEphem { kind: 'satellite'; orbit: SatOrbit; osculating?: OsculatingTable }

interface BodyJson {
  id: number; name: string; fullName?: string; type: BodyType; parent: number | null;
  ephem: SpkEphem | SatEphem | KeplerEphem;
  radii?: number[]; radiusSource?: string; gm?: number; systemGm?: number; rot?: RotationModel;
  albedo?: number; V10?: number; H?: number; texture?: string; color?: number[]; teff?: number; absMag?: number;
  spectralType?: string; rotPeriodDays?: number; rotPeriodHours?: number; orbitClass?: string;
  /** not from any catalogue: made by the explorer (src/app/WhatIf.ts) */
  made?: boolean;
}

export type { BodyJson };

export interface SystemJson {
  nutPrecAngles: NutPrecAngles;
  leapSeconds: [number, number, number, number][];
  approxElements: Record<string, ApproxElements>;
  bodies: BodyJson[];
}

const IDENTITY3 = new Matrix3();
const APPROX_NAME: Record<number, string> = { 199: 'Mercury', 299: 'Venus', 499: 'Mars', 599: 'Jupiter', 699: 'Saturn', 799: 'Uranus', 899: 'Neptune' };

/** Cheap deterministic hash in [0, 1). */
export function hash01(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export class SolarSystem {
  readonly bodies: Body[] = [];
  readonly byId = new Map<number, Body>();
  readonly sun: Body;
  /** true when the current positions come from DE442S (false: approximate elements) */
  usingDE = false;
  jd = J2000_JD;

  private ephemOf = new Map<Body, BodyJson['ephem']>();
  /**
   * What each body goes round in the catalogue, and each one's moons there. The ephemeris is
   * worked out from these, whatever `Body.parent` says a body goes round now (live physics may
   * have had it captured or set free: src/app/LivePhysics.ts).
   */
  private home = new Map<Body, Body | null>();
  private homeMoons = new Map<Body, Body[]>();
  /** bodies the explorer has taken away: not there, whatever the ephemeris says */
  private gone = new Set<Body>();
  /** the stars that shine in the system now */
  private lit: Body[] = [];
  private satFrames = new Map<Body, Matrix3>();
  private keplerEl = new Map<Body, OrbitalElements>();
  private angles: NutPrecAngles;
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private orient: Orientation = { ra: 0, dec: 0, w: 0 };
  /** per moon / minor body: last computed state relative to its parent (or the Sun), when, and how stale it may get */
  private rel = new Map<Body, { pos: Vector3; vel: Vector3; jd: number; limit: number }>();
  private frameNo = 0;
  private tmp3 = new Vector3();
  private tmp4 = new Vector3();
  private tmp5 = new Vector3();

  constructor(readonly data: SystemJson, readonly ephemeris: Ephemeris) {
    this.angles = data.nutPrecAngles;
    setLeapSeconds(data.leapSeconds);
    for (const bj of data.bodies) this.make(bj);
    for (const bj of data.bodies) this.link(bj);
    this.sun = this.byId.get(10)!;
    for (const b of this.bodies) this.prepare(b);
    this.listSuns();
  }

  /** A body from its description: size, mass, look. */
  private make(bj: BodyJson): Body {
    const b = new Body(bj.id, bj.name, bj.type);
    const r = (bj.radii ?? []).map((x) => x * 1e3);
    if (r.length === 3) {
      b.radii = [r[0], r[1], r[2]];
    } else {
      // No measured size in the sources: deterministic procedural estimate (flagged in the UI).
      const est = (1 + 3 * hash01(bj.id)) * 1e3;
      b.radii = [est, est, est];
      b.radiusEstimated = true;
    }
    b.radius = Math.cbrt(b.radii[0] * b.radii[1] * b.radii[2]);
    b.gm = (bj.gm ?? 0) * 1e9;
    b.systemGm = (bj.systemGm ?? bj.gm ?? 0) * 1e9;
    b.rotation = bj.rot ?? null;
    b.texture = bj.texture ?? null;
    if (bj.color) b.color = [bj.color[0], bj.color[1], bj.color[2]];
    if (bj.albedo !== undefined) b.albedo = bj.albedo;
    else if (bj.type === 'moon' || bj.type === 'asteroid' || bj.type === 'tno') b.albedo = 0.1 + 0.4 * hash01(bj.id + 7);
    if (bj.type === 'star') {
      b.teff = bj.teff ?? SUN_TEFF;
      b.absMag = bj.absMag ?? SUN_ABS_MAG;
    }
    b.meta = { ...bj, ephem: undefined };
    this.bodies.push(b);
    this.byId.set(bj.id, b);
    this.ephemOf.set(b, bj.ephem);
    return b;
  }

  /** Its place in the family: what it goes round. */
  private link(bj: BodyJson): void {
    const b = this.byId.get(bj.id)!;
    const p = bj.parent === null ? null : this.byId.get(bj.parent) ?? null;
    this.home.set(b, p);
    if (!p) return;
    b.parent = p;
    p.children.push(b);
    const moons = this.homeMoons.get(p);
    if (moons) moons.push(b);
    else this.homeMoons.set(p, [b]);
  }

  /** What a body goes round in the catalogue (see `home`). */
  homeOf(b: Body): Body | null {
    return this.home.get(b) ?? null;
  }

  /**
   * A body goes round another now, or round nothing (live physics: a capture, a moon lost to its
   * star, a planet set free). The ephemeris takes no notice; `settle` puts it back.
   */
  adopt(b: Body, parent: Body | null): void {
    if (b.parent === parent) return;
    if (b.parent) b.parent.children.splice(b.parent.children.indexOf(b), 1);
    b.parent = parent;
    parent?.children.push(b);
  }

  /**
   * Take a body away, or bring it back (live physics): one that is away is not drawn, named,
   * found or stood on, casts no shadow and gives no light.
   */
  setGone(b: Body, gone: boolean): void {
    if (gone) this.gone.add(b);
    else this.gone.delete(b);
    // (there again: `update` will say if the ephemeris has no place for it at the date)
    b.valid = !gone;
    this.listSuns();
  }

  isGone(b: Body): boolean {
    return this.gone.has(b);
  }

  /** Back to the catalogue: everything there again, each body going round what it does there, its moons in their order. */
  settle(): void {
    for (const b of this.gone) b.valid = true;
    this.gone.clear();
    for (const b of this.bodies) b.children.length = 0;
    for (const b of this.bodies) {
      const p = this.homeOf(b);
      b.parent = p;
      p?.children.push(b);
    }
    this.listSuns();
  }

  private listSuns(): void {
    this.lit = this.bodies.filter((b) => b.kind === 'star' && !this.gone.has(b));
  }

  /** The stars that shine in the system now: the Sun, unless it has been taken away, and any the explorer has made. */
  get suns(): readonly Body[] {
    return this.lit;
  }

  /**
   * The sun that lights a place (m, from the barycentre): the one brightest there, or null in a
   * system without one. (A world is lit by one sun at a time.)
   */
  sunAt(pos: Vector3): Body | null {
    const lit = this.lit;
    if (lit.length < 2) return lit[0] ?? null;
    let best = lit[0], most = 0;
    for (const s of lit) {
      const e = this.brightness(s) / Math.max(pos.distanceToSquared(s.pos), s.radius * s.radius);
      if (e > most) { most = e; best = s; }
    }
    return best;
  }

  /** A star's light as a multiple of the Sun's, from its absolute magnitude. */
  brightness(star: Body): number {
    return star === this.sun ? 1 : Math.pow(10, -0.4 * (star.absMag - this.sun.absMag));
  }

  /** The frame its orbit is given in, or its elements: worked out once. */
  private prepare(b: Body): void {
    const e = this.ephemOf.get(b)!;
    if (e.kind === 'satellite') {
      const o = e.orbit;
      let frame: Matrix3;
      if (o.frame === 'laplace' && o.poleRa !== undefined && o.poleDec !== undefined) frame = poleFrame(o.poleRa, o.poleDec);
      else if (o.frame === 'equatorial' && b.parent?.rotation) {
        const pr = b.parent.rotation;
        // Retrograde rotators (Uranus): satellite elements use the angular-momentum pole.
        frame = pr.pm[1] < 0 ? poleFrame((pr.ra[0] + 180) % 360, -pr.dec[0]) : poleFrame(pr.ra[0], pr.dec[0]);
      } else {
        // ecliptic J2000 -> ICRF
        const c = Math.cos(OBLIQUITY_J2000), s = Math.sin(OBLIQUITY_J2000);
        frame = new Matrix3().set(1, 0, 0, 0, c, -s, 0, s, c);
      }
      this.satFrames.set(b, frame);
    } else if (e.kind === 'kepler') {
      this.keplerEl.set(b, elementsFromMeanAnomaly(e.a * 1e3, e.e, e.i, e.node, e.w, e.M, e.epochJd, GM_SUN + b.gm));
    }
  }

  /**
   * A body that is not in the catalogue joins the system (a moon the explorer has made:
   * src/app/WhatIf.ts): described like the others, and from the next update on it moves, is
   * drawn, has an orbit line and pulls on a ship like any of them.
   */
  add(bj: BodyJson): Body {
    if (this.byId.has(bj.id)) throw new Error(`a body ${bj.id} is there already`);
    const b = this.make(bj);
    this.link(bj);
    this.prepare(b);
    this.listSuns();
    return b;
  }

  /**
   * Turn a satellite's orbit in its own plane so that at `jd` it stands in the direction `dir`
   * from its parent (ICRF), as nearly as the plane allows: for a moon that has just been made,
   * to be where its maker is looking.
   */
  place(b: Body, dir: Vector3, jd: number): void {
    const e = this.ephemOf.get(b), frame = this.satFrames.get(b);
    if (!e || e.kind !== 'satellite' || !frame) return;
    const m = frame.elements; // (columns: the plane's x and y axes in ICRF)
    const x = dir.x * m[0] + dir.y * m[1] + dir.z * m[2], y = dir.x * m[3] + dir.y * m[4] + dir.z * m[5];
    const o = e.orbit;
    o.M = (Math.atan2(y, x) * 180) / Math.PI - o.node - o.w;
    o.epochJd = jd;
    this.rel.delete(b);
  }

  /** Take a body out again (one that `add` put in: the catalogue's stay). */
  remove(b: Body): void {
    const i = this.bodies.indexOf(b);
    if (i < 0 || b.children.length) return;
    this.bodies.splice(i, 1);
    this.byId.delete(b.id);
    this.ephemOf.delete(b);
    this.satFrames.delete(b);
    this.keplerEl.delete(b);
    this.rel.delete(b);
    this.gone.delete(b);
    this.adopt(b, null);
    const moons = this.homeMoons.get(this.homeOf(b)!);
    if (moons) moons.splice(moons.indexOf(b), 1);
    this.home.delete(b);
    b.valid = false;
    this.listSuns();
  }

  static async load(baseUrl: string): Promise<SolarSystem> {
    const res = await fetch(`${baseUrl}/solar/system.json`);
    if (!res.ok) throw new Error(`system.json: HTTP ${res.status}`);
    const data = (await res.json()) as SystemJson;
    const eph = await Ephemeris.load(`${baseUrl}/ephem`, data.approxElements);
    return new SolarSystem(data, eph);
  }

  /** Osculating-ish elements of a satellite's mean orbit at `jd` (in its own plane frame), with secular precession. */
  satelliteElements(b: Body, jd: number): { el: OrbitalElements; frame: Matrix3 } | null {
    const e = this.ephemOf.get(b), parent = this.homeOf(b);
    if (!e || e.kind !== 'satellite' || !parent) return null;
    if (e.osculating) {
      // Nearest-epoch osculating elements (Horizons), propagated as a two-body orbit.
      const rows = e.osculating.rows;
      const t0 = rows[0][0], step = rows.length > 1 ? rows[1][0] - rows[0][0] : 1;
      const k = Math.max(0, Math.min(rows.length - 1, Math.round((jd - t0) / step)));
      const [, q, ecc, inc, node, peri, tp, n] = rows[k];
      const nRad = (n * Math.PI) / 180 / DAY;
      const a = (q * 1e3) / (1 - ecc);
      return { el: { q: q * 1e3, e: ecc, i: inc, node, peri, tp, mu: nRad * nRad * a * a * a }, frame: IDENTITY3 };
    }
    // Mean elements (JPL SSD) with secular precession, calibrated against Horizons
    // (pipeline/build_solar_system.py: satellite_position must stay identical to this).
    const o = e.orbit;
    const dt = jd - o.epochJd;
    const fit = o.fit;
    const retro = Math.cos((o.i * Math.PI) / 180) < 0 ? -1 : 1;
    let nodeRate = o.Pnode ? (-(fit?.nodeSign ?? 1) * retro * 360) / (o.Pnode * 365.25) : 0;
    if (fit?.nodeRate !== undefined) nodeRate = fit.nodeRate;
    const periRate = o.Pw ? 360 / (o.Pw * 365.25) : 0;
    const inc = o.i + (fit?.di ?? 0);
    const node = o.node + (fit?.dNode ?? 0) + nodeRate * dt;
    const w = o.w + periRate * dt;
    let M = o.M + (360 * dt) / o.P;
    if (fit) {
      if (fit.lambdaMode === 1) M -= (periRate + nodeRate) * dt;
      M += fit.dM + fit.dn * dt + fit.dn2 * dt * dt;
      if (fit.libAmp && fit.libPeriod) M += fit.libAmp * Math.sin((2 * Math.PI * dt) / fit.libPeriod + (fit.libPhase ?? 0));
    }
    const mu = (parent.gm || parent.systemGm) + b.gm;
    // Mean motion from the tabulated period (mu-consistent elements keep the period exact).
    const n = (2 * Math.PI) / (o.P * DAY);
    const a = o.a * 1e3;
    const el = elementsFromMeanAnomaly(a, o.e, inc, node, w, M, jd, n * n * a * a * a || mu);
    return { el, frame: this.satFrames.get(b)! };
  }


  heliocentricElements(b: Body): OrbitalElements | null {
    return this.keplerEl.get(b) ?? null;
  }

  ephemerisKind(b: Body): string {
    return this.ephemOf.get(b)?.kind ?? 'none';
  }

  /**
   * Update every body's position, velocity and orientation for TDB Julian date `jd`.
   *
   * With `focus` (the main loop: the bodies the camera is at, looking at or sees resolved), the
   * cost follows what is on screen: moons and minor bodies outside it keep their last orbital state
   * until it is more than 1° of orbit (or a day) old, and their orientation is refreshed a sixteenth
   * at a time. The focus bodies, their parents' and their own moons are exact every frame. Without
   * `focus` everything is computed (time jumps, tests).
   */
  update(jd: number, timeDirection = 0, focus?: ReadonlySet<Body>): void {
    const frame = this.frameNo++;
    this.jd = jd;
    const eph = this.ephemeris;
    eph.request(jd, timeDirection);
    const de = eph.isLoaded(jd);
    this.usingDE = de;
    const v = this.tmp, v2 = this.tmp2;

    // 1) Sun and planet (barycentre) positions
    for (const b of this.bodies) {
      const e = this.ephemOf.get(b);
      if (!e) continue;
      if (e.kind !== 'spk') continue;
      b.valid = true;
      if (de) {
        b.pos.set(0, 0, 0);
        b.vel.set(0, 0, 0);
        for (const [c, t] of e.chain) {
          eph.evaluate(c, t, jd, v, v2);
          b.pos.addScaledVector(v, 1e3);
          b.vel.addScaledVector(v2, 1e3 / DAY);
        }
      } else if (b.id === 10) {
        b.pos.set(0, 0, 0);
        b.vel.set(0, 0, 0);
      } else if (b.id === 999) {
        // Pluto outside DE coverage: no approximate elements published; keep last known position.
        b.valid = b.pos.lengthSq() > 0;
      } else {
        const name = b.id === 399 ? 'EMB' : APPROX_NAME[b.id];
        eph.approxHeliocentric(name, jd, b.pos);
        eph.approxHeliocentric(name, jd + 0.01, v);
        b.vel.copy(v).sub(b.pos).divideScalar(0.01 * DAY);
      }
    }

    // 2) Moons relative to their planet (mean elements); fall back for the Moon outside DE.
    const hot = (b: Body) => !focus || focus.has(b) || focus.has(this.homeOf(b)!);
    for (const b of this.bodies) {
      const e = this.ephemOf.get(b);
      if (!e) continue;
      if (e.kind !== 'satellite') continue;
      let r = this.rel.get(b);
      if (!r) {
        r = { pos: new Vector3(), vel: new Vector3(), jd: NaN, limit: 0 };
        this.rel.set(b, r);
      }
      if (b.id === 301 && de) {
        // DE442S: Moon relative to Earth = (EMB->Moon) - (EMB->Earth)
        eph.evaluate(3, 301, jd, r.pos, r.vel);
        eph.evaluate(3, 399, jd, v, v2);
        r.pos.sub(v).multiplyScalar(1e3);
        r.vel.sub(v2).multiplyScalar(1e3 / DAY);
        r.jd = jd;
      } else if (hot(b) || !(Math.abs(jd - r.jd) <= r.limit)) {
        const sat = this.satelliteElements(b, jd);
        if (!sat) { this.rel.delete(b); continue; }
        keplerState(sat.el, jd, r.pos, r.vel);
        r.pos.applyMatrix3(sat.frame);
        r.vel.applyMatrix3(sat.frame);
        r.jd = jd;
        r.limit = Math.min(1, periodDays(sat.el) / 360);
      }
      b.vel.copy(r.vel);
    }

    // 3) Planet body = barycentre - sum(m_i/M) r_i ; then moons absolute
    for (const p of this.bodies) {
      const e = this.ephemOf.get(p);
      if (!e) continue;
      if (e.kind !== 'spk' || !e.barycenter || !p.systemGm) continue;
      for (const m of this.homeMoons.get(p) ?? []) {
        const r = this.rel.get(m);
        if (!r || !(m.gm > 0)) continue;
        // (the velocity likewise, the moons' momentum about the barycentre: a planet moving with its
        // barycentre's velocity would drift against its own moons)
        p.pos.addScaledVector(r.pos, -m.gm / p.systemGm);
        p.vel.addScaledVector(r.vel, -m.gm / p.systemGm);
      }
    }
    if (!de) {
      // Earth from EMB using the mean-element Moon
      const earth = this.byId.get(399)!;
      const moon = this.byId.get(301)!;
      const r = this.rel.get(moon);
      if (r) {
        earth.pos.addScaledVector(r.pos, -moon.gm / (earth.gm + moon.gm));
        earth.vel.addScaledVector(r.vel, -moon.gm / (earth.gm + moon.gm));
      }
    }
    for (const b of this.bodies) {
      const e = this.ephemOf.get(b);
      if (!e || e.kind !== 'satellite') continue;
      const r = this.rel.get(b);
      if (!r) continue;
      const p = this.homeOf(b)!;
      b.pos.copy(p.pos).add(r.pos);
      b.vel.copy(r.vel).add(p.vel);
      b.valid = p.valid;
    }

    // 4) Minor bodies on heliocentric Kepler orbits
    for (const [b, el] of this.keplerEl) {
      let r = this.rel.get(b);
      if (!r) {
        r = { pos: new Vector3(), vel: new Vector3(), jd: NaN, limit: Math.min(1, periodDays(el) / 360) };
        this.rel.set(b, r);
      }
      if (hot(b) || !(Math.abs(jd - r.jd) <= r.limit)) {
        keplerState(el, jd, r.pos, r.vel);
        eclToEqu(r.pos);
        eclToEqu(r.vel);
        r.jd = jd;
      }
      b.pos.copy(this.sun.pos).add(r.pos);
      b.vel.copy(this.sun.vel).add(r.vel);
    }

    // 5) Absolute positions and orientation (outside the focus a sixteenth a frame: dots on screen)
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      b.upos.set(b.pos.x, b.pos.y, b.pos.z);
      if (!focus || b.kind === 'star' || b.kind === 'planet' || focus.has(b) || (i & 15) === (frame & 15)) this.updateOrientation(b, jd);
    }
    for (const b of this.gone) b.valid = false;
  }

  /**
   * A body's orientation at `jd` for where it is and how it moves now. (`update` works it out for
   * where the ephemeris has the body: one that has since been put elsewhere, and keeps a face
   * turned to what it goes round, is turned again with this.)
   */
  updateOrientation(b: Body, jd: number): void {
    if (b.rotation) {
      evaluateRotation(b.rotation, this.angles, jd, this.orient);
      orientationMatrix(this.orient, b.orientation);
      return;
    }
    const p = b.parent;
    const hours = (b.meta.rotPeriodHours as number | undefined) ?? null;
    if (b.kind === 'moon' && p) {
      // Synchronous rotation (tidal locking): prime meridian faces what it goes round, pole along the orbit normal.
      const r = this.tmp.copy(p.pos).sub(b.pos).normalize();
      const relVel = this.tmp2.copy(b.vel).sub(p.vel);
      const n = this.tmp3.crossVectors(r, relVel).normalize().negate();
      if (n.lengthSq() < 0.5) n.set(0, 0, 1);
      const y = this.tmp4.crossVectors(n, r).normalize();
      const x = this.tmp5.crossVectors(y, n);
      b.orientation.makeBasis(x, y, n);
      return;
    }
    // Uniform spin about the ecliptic pole with the catalogued period (or a procedural one).
    const periodDays = hours ? hours / 24 : 0.2 + 1.5 * hash01(b.id + 3);
    const w = (((jd - J2000_JD) / periodDays) * 360 + 360 * hash01(b.id)) % 360;
    orientationMatrix({ ra: 270, dec: 66.560708, w }, b.orientation);
  }

  /** Bodies whose position is meaningful right now. */
  *visibleBodies(): Iterable<Body> {
    for (const b of this.bodies) if (b.valid) yield b;
  }

  sunDistanceAU(b: Body): number {
    return b.pos.distanceTo(this.sun.pos) / AU;
  }

  /** Matrix4 helper used by renderers (body-fixed -> ICRF, with ellipsoid scale). */
  bodyMatrix(b: Body, out = new Matrix4()): Matrix4 {
    return out.copy(b.orientation).scale(new Vector3(b.radii[0], b.radii[1], b.radii[2]));
  }
}
