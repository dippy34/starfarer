import type { UPos } from '../core/upos';
import { G } from '../sim/physics';
import type { SimSystem } from '../sim/SystemSim';
import { Body, type SpaceObject } from './Body';
import type { ExoPlanet, LiveDraw, PlanetarySystem, StarMassSource } from './Planets';
import type { BodyJson, Family } from './SolarSystem';
import type { CatalogStar } from './Stars';

/**
 * Another star's planetary system as live physics takes it (src/app/LivePhysics.ts, through the
 * `SimSystem` of src/sim/SystemSim.ts): its star and its planets as bodies, each standing for the
 * object the app draws and the explorer selects (the CatalogStar, an ExoPlanet). Real systems are
 * the NASA Exoplanet Archive's, as the app ships them; generated ones the app's own (Planets.ts),
 * and they say so.
 *
 * Masses are the data's and nothing else: a planet's is the archive's (where the archive gives
 * none, the estimate from its radius, which it marks), or the generator's; the star's is as
 * `PlanetarySystem.hostMass` says (the archive's, Kepler's third law from a measured orbit, or the
 * generator's). A star whose mass is not known at all cannot be simulated (`simulable`).
 *
 * Where everything is, before live physics and after Back to reality: on the rails the app draws
 * (`update`), the star at its catalogue place and each planet on the Kepler orbit of its period
 * about it. Live physics starts from that (capture), so turning it on moves nothing: each planet's
 * place and velocity about its star are the rail's, to the last bit. Only the frame is chosen: the
 * one in which the system's centre of mass is at rest (the rails' velocities less the centre of
 * mass's), so that the star swings about that centre as its planets pull it, and does not drift
 * away from where the catalogue has it. Positions are metres from the star's catalogue place at
 * the moment live physics began (`origin`).
 *
 * While live physics runs it (`PlanetarySystem.live`, set by the app), the star and its planets are
 * drawn where the simulation has them (`place`), the orbit line of each is the orbit it is on now
 * (`orbit`), and a body taken away is not drawn (`gone`). `detach` puts them back on their rails.
 */

/** the bodies' numbers in the simulation: far from any of the Solar System's (NAIF's, and the made worlds' from 900,000,001) */
export const SIM_HOST_ID = 800_000_000;

/** A body of another star's system as live physics knows it: standing for what the app draws (`shows`). */
export class SimBody extends Body {
  constructor(id: number, name: string, kind: 'star' | 'planet', readonly shows: ExoPlanet | CatalogStar, readonly system: PlanetarySystem) {
    super(id, name, kind);
    (this as { key: string }).key = `sim:${shows.key}`;
  }
}

/** How a body's mass is known, for the card: measured; estimated (the archive's mark); from a planet's orbit (a star the archive gives no mass for); generated; or not at all. */
export type MassKnown = 'measured' | 'estimated' | 'orbits' | 'generated' | 'unknown';

export class PlanetarySim implements SimSystem, LiveDraw {
  readonly bodies: SimBody[] = [];
  readonly byId = new Map<number, Body>();
  readonly sun: SimBody;
  readonly origin: UPos;
  private readonly home = new Map<Body, Body | null>();
  private readonly away = new Set<Body>();
  private readonly of = new Map<SpaceObject, SimBody>();
  private readonly known = new Map<Body, MassKnown>();

  constructor(readonly system: PlanetarySystem) {
    const host = system.host;
    this.origin = host.upos.clone();
    const star = (this.sun = new SimBody(SIM_HOST_ID, host.name, 'star', host, system));
    star.gm = star.systemGm = G * system.hostMass.kg;
    star.radius = host.radius;
    star.radii = [host.radius, host.radius, host.radius];
    star.radiusEstimated = !host.measured && !host.shape;
    star.teff = host.teff;
    star.absMag = host.absMag;
    this.join(star, null, starKnown(system.hostMass.from));
    system.planets.forEach((p, k) => {
      const s = p.spec, b = new SimBody(SIM_HOST_ID + 1 + k, s.name, 'planet', p, system);
      b.gm = b.systemGm = G * s.massKg;
      b.radius = s.radiusM;
      b.radii = [s.radiusM, s.radiusM, s.radiusM];
      // (measured only in a transit, as src/app/powersFor.ts sizeOf has it)
      b.radiusEstimated = !s.real || s.est.includes('radius') || s.method !== 'Transit';
      b.albedo = s.albedo;
      this.join(b, star, !s.real ? 'generated' : s.est.includes('mass') ? 'estimated' : 'measured');
    });
  }

  private join(b: SimBody, parent: SimBody | null, known: MassKnown): void {
    this.bodies.push(b);
    this.byId.set(b.id, b);
    this.of.set(b.shows, b);
    this.home.set(b, parent);
    this.known.set(b, known);
    if (parent) { b.parent = parent; parent.children.push(b); }
  }

  /** Can this system be simulated: is its star's mass known? */
  get simulable(): boolean {
    return this.sun.gm > 0;
  }

  /** The body that stands for `o` (the system's star, or one of its planets), or null. */
  bodyOf(o: SpaceObject | null): SimBody | null {
    return o ? this.of.get(o) ?? null : null;
  }

  /** How a body's catalogued mass is known (its mark on the card). */
  massKnown(b: Body): MassKnown {
    return this.known.get(b) ?? 'measured';
  }

  // ------------------------------------------------------------------ the rails (SimSystem)

  /**
   * Every body on its rail at `jd` (TDB): the star at its catalogue place, each planet on the Kepler
   * orbit of its period about it (PlanetarySystem.state), each velocity less the centre of mass's
   * (see above). While live physics has not begun, the origin follows the star's catalogue place
   * (it is made exact when the star's catalogue tile comes in).
   */
  update(jd: number): void {
    if (!this.system.live) this.origin.copy(this.system.host.upos);
    const star = this.sun;
    star.pos.set(0, 0, 0);
    star.vel.set(0, 0, 0);
    let gm = 0, mx = 0, my = 0, mz = 0;
    for (const b of this.bodies) {
      if (b !== star) this.system.state((b.shows as ExoPlanet).spec, jd, b.pos, b.vel);
      if (this.away.has(b)) continue;
      gm += b.gm;
      mx += b.gm * b.vel.x; my += b.gm * b.vel.y; mz += b.gm * b.vel.z;
    }
    const k = gm > 0 ? 1 / gm : 0;
    for (const b of this.bodies) {
      b.vel.set(b.vel.x - k * mx, b.vel.y - k * my, b.vel.z - k * mz);
      b.upos.copy(this.origin).addVec(b.pos);
    }
  }

  homeOf(b: Body): Body | null {
    return this.home.get(b) ?? null;
  }

  adopt(b: Body, parent: Body | null): void {
    if (b.parent === parent) return;
    if (b.parent) b.parent.children.splice(b.parent.children.indexOf(b), 1);
    b.parent = parent;
    parent?.children.push(b);
  }

  setGone(b: Body, gone: boolean): void {
    if (gone) this.away.add(b);
    else this.away.delete(b);
    b.valid = !gone;
  }

  isGone(b: Body): boolean {
    return this.away.has(b);
  }

  familyOf(b: Body): Family {
    return { b, parent: b.parent, children: [...b.children], gone: this.away.has(b) };
  }

  restoreFamilies(families: Iterable<Family>): void {
    for (const b of this.bodies) { b.parent = null; b.children.length = 0; }
    for (const b of this.away) b.valid = true;
    this.away.clear();
    for (const f of families) {
      f.b.parent = f.parent;
      f.b.children.push(...f.children);
      if (f.gone) { this.away.add(f.b); f.b.valid = false; }
    }
  }

  settle(): void {
    for (const b of this.away) b.valid = true;
    this.away.clear();
    for (const b of this.bodies) b.children.length = 0;
    for (const b of this.bodies) {
      const p = this.homeOf(b);
      b.parent = p;
      p?.children.push(b);
    }
  }

  /** Nothing can be made here yet (the app's Add works round the Sun only): see src/app/powersFor.ts. */
  add(_bj: BodyJson): Body {
    throw new Error('Add works only round the Sun, so far');
  }

  /** (nothing is ever made here: nothing to bring back) */
  bringBack(_b: Body): void {}

  /** (the catalogue's bodies stay: only a made one is ever taken out, and none is made here) */
  remove(_b: Body): void {}

  /** (a planet's face is drawn by the planet layer from its spin and its star: nothing to keep here) */
  updateOrientation(_b: Body, _jd: number): void {}

  ephemerisKind(_b: Body): string {
    return 'kepler';
  }

  // ------------------------------------------------------------------ drawn (LiveDraw)

  /** Live physics runs this system: it is drawn where the simulation has it. */
  attach(): void {
    this.system.live = this;
  }

  /** Back on the rails: the star at its catalogue place, each planet with its catalogued size, on its orbit at `jd`. */
  detach(jd: number): void {
    if (this.system.live !== this) return;
    this.system.live = null;
    this.system.host.upos.copy(this.origin);
    for (const p of this.system.planets) p.radius = p.spec.radiusM;
    this.system.update(jd);
  }

  place(): void {
    const host = this.system.host, star = this.sun;
    host.upos.copy(this.origin).addVec(star.pos);
    for (const b of this.bodies) {
      if (b === star) continue;
      const p = b.shows as ExoPlanet;
      p.rel.copy(b.pos).sub(star.pos);
      p.upos.copy(host.upos).addVec(p.rel);
      p.radius = b.radius;
    }
  }

  gone(o: SpaceObject): boolean {
    const b = this.of.get(o);
    return !!b && this.away.has(b);
  }

  /**
   * The orbit a planet is on now about what it goes round (its star, or another planet that has
   * taken it), from where it is and how it moves: the two-body ellipse (e = (v × h)/μ − r/|r|,
   * 1/a = 2/|r| − v²/μ), as points from the star's place. False for one going round nothing, or on an
   * open path.
   */
  orbit(p: ExoPlanet, out: Float32Array, count: number): boolean {
    const b = this.of.get(p), q = b?.parent;
    if (!b || !q || this.away.has(b)) return false;
    const mu = q.gm + b.gm;
    if (!(mu > 0)) return false;
    const rx = b.pos.x - q.pos.x, ry = b.pos.y - q.pos.y, rz = b.pos.z - q.pos.z;
    const vx = b.vel.x - q.vel.x, vy = b.vel.y - q.vel.y, vz = b.vel.z - q.vel.z;
    const r = Math.hypot(rx, ry, rz), v2 = vx * vx + vy * vy + vz * vz;
    const inv = 2 / r - v2 / mu;
    if (!(inv > 0)) return false;
    const a = 1 / inv;
    const hx = ry * vz - rz * vy, hy = rz * vx - rx * vz, hz = rx * vy - ry * vx, h = Math.hypot(hx, hy, hz);
    if (!(h > 0)) return false;
    let ex = (vy * hz - vz * hy) / mu - rx / r, ey = (vz * hx - vx * hz) / mu - ry / r, ez = (vx * hy - vy * hx) / mu - rz / r;
    const e = Math.hypot(ex, ey, ez);
    if (e >= 1) return false;
    // (the line of periapsis; a circle has none: from where it is now)
    if (e > 1e-12) { ex /= e; ey /= e; ez /= e; } else { ex = rx / r; ey = ry / r; ez = rz / r; }
    // (the other axis of the plane: h × P)
    const qx = (hy * ez - hz * ey) / h, qy = (hz * ex - hx * ez) / h, qz = (hx * ey - hy * ex) / h;
    const bAxis = a * Math.sqrt(1 - e * e);
    const s = this.sun, cx = q.pos.x - s.pos.x, cy = q.pos.y - s.pos.y, cz = q.pos.z - s.pos.z;
    for (let i = 0; i < count; i++) {
      const E = (2 * Math.PI * i) / (count - 1), x = a * (Math.cos(E) - e), y = bAxis * Math.sin(E);
      out[3 * i] = cx + x * ex + y * qx;
      out[3 * i + 1] = cy + x * ey + y * qy;
      out[3 * i + 2] = cz + x * ez + y * qz;
    }
    return true;
  }
}

/** a star's mass as its card marks it, from what it is known from */
function starKnown(from: StarMassSource): MassKnown {
  return from;
}
