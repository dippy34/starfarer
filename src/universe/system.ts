/**
 * Planetary-system generator.
 *
 * Builds the bodies of a star system — stars (single, binary or triple),
 * planets, moons, rings and asteroid belts — as pure data with Kepler orbits.
 * Three sources feed the same model:
 *   - procedural stars  → everything is generated from the star's seed
 *   - real stars        → the star is real, its planets are procedural
 *   - exoplanet hosts   → the star and every confirmed planet are real;
 *                         only unmeasured quantities are filled in, and no
 *                         extra planets, moons or rings are invented
 */
import { orbitPosition, orbitalPeriod } from '../core/astro';
import { dacos, datan2, dcos, dexp, dlog, dpow, dsin } from '../core/dmath';
import { hashCombine } from '../core/hash';
import type { UPos } from '../core/hp';
import { type Mat3, type V3, basisFromZX, vNorm, vPerp } from '../core/math';
import { Rng } from '../core/rng';
import { AU, DAY, G, L_SUN, M_EARTH, M_SUN, R_EARTH, R_SUN } from '../core/units';
import { componentName, moonName, planetName } from './names';
import { type PlanetInput, makePlanet, radiusFromMass } from './planet';
import { mainSequenceTeff, makeStar } from './star';
import type { BeltProps, Body, PlanetBody, StarBody, StarProps, StarType, SystemModel } from './types';

/** Confirmed-planet record (subset of the Exoplanet Archive columns; see scripts/build-catalogs/steps/exoplanets.ts). */
export interface ExoPlanetData {
  name: string;
  letter: string;
  per?: number;
  a?: number;
  ecc?: number;
  inc?: number;
  w?: number;
  r?: number;
  m?: number;
  mProv?: string;
  teq?: number;
  insol?: number;
  method: string;
  year?: number;
  facility?: string;
}

export interface ExoHostData {
  name: string;
  key: [number, number, number];
  /** Host star photometry codes [mag, colour, flags]. */
  star: [number, number, number];
  teff?: number;
  rad?: number;
  mass?: number;
  lum?: number;
  spt?: string;
  age?: number;
  stars: number;
  cb: boolean;
  planets: ExoPlanetData[];
}

/** A curated real companion (e.g. the Cygnus X-1 black hole around HD 226868). */
export interface CompanionData {
  type: string;
  name: string;
  massSun: number;
  periodDays: number;
  semiMajorAxisAu: number;
}

export interface SystemInput {
  id: string;
  name: string;
  seed: number;
  origin: UPos;
  star: { absMag: number; teff: number; type: StarType; real: boolean; spectral?: string };
  /** Unit vector from the Sun to the system (orients real exoplanet orbits relative to our line of sight). */
  lineOfSight?: V3;
  exo?: ExoHostData;
  companion?: CompanionData;
  /** Measured properties of a real compact object (catalogued pulsar or black hole) that override the generated ones. */
  compact?: { massSun?: number; periodSec?: number; accretion?: number; jet?: boolean };
  /** Real object without known planets for which none should be invented (e.g. a galaxy's central black hole). */
  noPlanets?: boolean;
}

const TWO_PI = 2 * Math.PI;

function starBody(id: string, name: string, seed: number, star: StarProps, real: boolean): StarBody {
  return { kind: 'star', id, name, seed, parent: -1, orbit: null, mass: star.mass, radius: star.radius, axis: { x: 0, y: 0, z: 1 }, rotationPeriod: star.rotationPeriod, rotationPhase: 0, real, star };
}

function tiltedAxis(rng: Rng, maxTiltDeg: number): V3 {
  // Mostly modest obliquities, with an occasional world knocked on its side.
  const tilt = (rng.chance(0.06) ? rng.range(60, 178) : rng.range(0, maxTiltDeg)) * (Math.PI / 180);
  const phi = rng.range(0, TWO_PI);
  return { x: dsin(tilt) * dcos(phi), y: dsin(tilt) * dsin(phi), z: dcos(tilt) };
}

/** Orbit orientation (inclination, node) whose normal is `n` (system frame). */
function planeFromNormal(n: V3): { i: number; node: number } {
  return { i: dacos(Math.max(-1, Math.min(1, n.z))), node: datan2(n.x, -n.y) };
}

/** Mean planets per star by stellar temperature. */
function planetCountMean(star: StarProps): number {
  switch (star.type) {
    case 'main':
    case 'subgiant':
      return star.teff > 20000 ? 0.4 : star.teff > 10000 ? 1.5 : star.teff > 7500 ? 3.2 : star.teff > 3900 ? 5.2 : 4.3;
    case 'giant':
      return 2;
    case 'supergiant':
      return 0.5;
    case 'whitedwarf':
      return 0.5;
    case 'browndwarf':
      return 1.5;
    case 'pulsar':
    case 'neutron':
      return 0.15;
    default:
      return 0.1;
  }
}

function addMoons(bodies: Body[], planetIndex: number, starMass: number, lumSun: number, aStarAu: number, beyondSnow: boolean, sysSeed: number): void {
  const planet = bodies[planetIndex] as PlanetBody;
  const rng = new Rng(hashCombine(planet.seed, 0x6d00));
  const giant = planet.type === 'gasgiant' || planet.type === 'icegiant';
  const count = giant ? rng.int(planet.type === 'gasgiant' ? 2 : 1, planet.type === 'gasgiant' ? 6 : 4) : rng.weighted([0.58, 0.32, 0.1]);
  if (count === 0 || !planet.orbit) return;
  const hill = planet.orbit.a * dpow(planet.mass / (3 * starMass), 1 / 3);
  const outerLimit = hill * 0.33;
  let a = Math.max(planet.radius * (giant ? rng.range(3.2, 5.5) : rng.range(6, 30)), (planet.rings?.outer ?? 0) * 1.25);
  const normal = planet.axis;
  for (let m = 0; m < count; m++) {
    if (a > outerLimit) break;
    const mrng = new Rng(hashCombine(planet.seed, 0x6d01 + m));
    // Major moons of giants carry ~1e-4 of the planet's mass in total; rocky planets can keep relatively big moons.
    const mass = giant ? planet.mass * dexp(mrng.range(dlog(4e-6), dlog(2.2e-4))) : planet.mass * dexp(mrng.range(dlog(3e-4), dlog(1.5e-2)));
    const mEarth = mass / M_EARTH;
    // Tides can melt the innermost moon of a giant (Io); icy moons dominate beyond the snow line.
    const tidal = giant && m === 0 && mrng.chance(0.22);
    const input: PlanetInput = {
      id: `${planet.id}/m${m}`, name: moonName(planet.name, m), seed: hashCombine(planet.seed, 0x3000 + m), kind: 'moon', parent: planetIndex,
      mass, radius: radiusFromMass(mEarth) * R_EARTH * (beyondSnow ? 1.25 : 1), lumSun, aStarAu, beyondSnowLine: beyondSnow, inHz: planet.habitableZone,
      type: tidal ? 'lava' : undefined, real: false, allowRings: false,
    };
    const moon = makePlanet(input);
    const tilt = { x: normal.x + mrng.normal(0, 0.02), y: normal.y + mrng.normal(0, 0.02), z: normal.z + mrng.normal(0, 0.02) };
    const plane = planeFromNormal(vNorm(tilt));
    const period = orbitalPeriod(a, planet.mass + mass);
    moon.orbit = { a, e: mrng.range(0, 0.05), i: plane.i, node: plane.node, peri: mrng.range(0, TWO_PI), m0: mrng.range(0, TWO_PI), period };
    // Moons are tidally locked: one rotation per orbit, spin axis along the orbit normal.
    moon.axis = vNorm(tilt);
    moon.rotationPeriod = period;
    moon.rotationPhase = mrng.range(0, TWO_PI);
    bodies.push(moon);
    a *= mrng.range(1.45, 2.3);
  }
  void sysSeed;
}

/** Fill orbit-independent spin state of a planet. */
function spinPlanet(rng: Rng, p: PlanetBody, starMass: number): void {
  const giant = p.type === 'gasgiant' || p.type === 'icegiant';
  const aAu = p.orbit ? p.orbit.a / AU : 1;
  // Close-in planets are tidally locked to their star.
  const locked = aAu < 0.25 * dpow(starMass / M_SUN, 1 / 3) && !giant;
  if (locked && p.orbit) {
    const plane = { x: dsin(p.orbit.i) * dsin(p.orbit.node), y: -dsin(p.orbit.i) * dcos(p.orbit.node), z: dcos(p.orbit.i) };
    p.axis = plane;
    p.rotationPeriod = p.orbit.period;
    p.notes.tidallyLocked = 1;
  } else {
    p.axis = tiltedAxis(rng, 35);
    p.rotationPeriod = (giant ? rng.range(8, 20) : dexp(rng.range(dlog(7), dlog(70)))) * 3600 * (rng.chance(0.07) ? -1 : 1);
  }
  p.rotationPhase = rng.range(0, TWO_PI);
}

function addProceduralPlanets(sys: { bodies: Body[]; belts: BeltProps[] }, input: SystemInput, parent: number, hostMass: number, lumSun: number, innerLimit: number, outerLimit: number, sysName: string, hostId: string): void {
  const rng = new Rng(hashCombine(input.seed, 0xb0d1e5 + parent * 7));
  const host = sys.bodies[Math.max(0, parent)] as StarBody;
  const mean = planetCountMean(host.star);
  if (rng.chance(0.12) || mean <= 0) return;
  const count = Math.min(10, rng.poisson(mean));
  if (count === 0) return;
  const sqrtL = Math.sqrt(Math.max(lumSun, 1e-8));
  const snow = 2.7 * sqrtL * AU;
  const hzIn = 0.95 * sqrtL * AU;
  const hzOut = 1.68 * sqrtL * AU;
  let a = Math.max(innerLimit, host.radius * 3.5, 0.11 * sqrtL * AU * dexp(rng.range(dlog(0.4), dlog(2.6))), 0.012 * AU);
  const placed: number[] = [];
  let lastGiantSeen = false;
  for (let n = 0; n < count; n++) {
    if (a > outerLimit) break;
    const prng = new Rng(hashCombine(input.seed, 0x91a0 + parent * 31 + n));
    const beyond = a >= snow;
    const u = prng.next();
    let mEarth: number;
    if (beyond) {
      mEarth = u < 0.42 ? dexp(prng.range(dlog(60), dlog(1300))) : u < 0.78 ? dexp(prng.range(dlog(8), dlog(40))) : dexp(prng.range(dlog(0.004), dlog(2.5)));
    } else {
      // Inner systems: mostly small rocky worlds and super-Earths, the odd sub-Neptune or hot giant.
      mEarth = u < 0.05 ? dexp(prng.range(dlog(90), dlog(1500))) : u < 0.2 ? dexp(prng.range(dlog(4), dlog(22))) : dexp(prng.range(dlog(0.04), dlog(5)));
    }
    const id = `${hostId}/p${n}`;
    const planet = makePlanet({
      id, name: planetName(sysName, placed.length), seed: hashCombine(input.seed, 0x2000 + parent * 131 + n), kind: 'planet', parent,
      mass: mEarth * M_EARTH, radius: radiusFromMass(mEarth) * R_EARTH, lumSun, aStarAu: a / AU, beyondSnowLine: beyond, inHz: a >= hzIn && a <= hzOut, real: false, allowRings: true,
    });
    const inc = Math.abs(prng.normal(0, 0.03));
    planet.orbit = { a, e: Math.min(0.6, Math.abs(prng.normal(0, mEarth > 60 ? 0.12 : 0.05))), i: inc, node: prng.range(0, TWO_PI), peri: prng.range(0, TWO_PI), m0: prng.range(0, TWO_PI), period: orbitalPeriod(a, hostMass + planet.mass) };
    spinPlanet(prng, planet, hostMass);
    const index = sys.bodies.length;
    sys.bodies.push(planet);
    placed.push(index);
    addMoons(sys.bodies, index, hostMass, lumSun, a / AU, beyond, input.seed);

    // Asteroid belt in the gap just inside the first giant beyond the snow line.
    const isGiant = planet.type === 'gasgiant';
    if (isGiant && !lastGiantSeen && placed.length > 1 && beyond && prng.chance(0.7)) {
      const prev = sys.bodies[placed[placed.length - 2]!] as PlanetBody;
      const inner = prev.orbit!.a * 1.35;
      const outer = a * 0.72;
      if (outer > inner * 1.15) {
        sys.belts.push({ id: `${hostId}/belt${sys.belts.length}`, name: `${sysName} asteroid belt`, parent, inner, outer, thickness: 0.06, count: prng.int(1500, 4000), seed: prng.u32(), color: [0.5, 0.45, 0.4] });
      }
    }
    lastGiantSeen = lastGiantSeen || isGiant;
    a *= dexp(prng.range(dlog(1.42), dlog(2.35)));
  }
  // Outer debris disc (a Kuiper belt) beyond the last planet.
  if (placed.length >= 2 && rng.chance(0.55)) {
    const last = sys.bodies[placed[placed.length - 1]!] as PlanetBody;
    const inner = last.orbit!.a * 1.5;
    if (inner * 1.6 < outerLimit * 1.5) {
      sys.belts.push({ id: `${hostId}/belt${sys.belts.length}`, name: `${sysName} outer belt`, parent, inner, outer: inner * rng.range(1.5, 2.2), thickness: 0.12, count: rng.int(1500, 4000), seed: rng.u32(), color: [0.62, 0.66, 0.72] });
    }
  }
}

function addExoplanets(sys: { bodies: Body[] }, input: SystemInput, exo: ExoHostData, hostMass: number, lumSun: number): void {
  const rng = new Rng(hashCombine(input.seed, 0xe80));
  const node = rng.range(0, TWO_PI); // unmeasured for almost every system: one shared seeded value keeps the planets coplanar
  const sqrtL = Math.sqrt(Math.max(lumSun, 1e-8));
  exo.planets.forEach((pl, n) => {
    const prng = new Rng(hashCombine(input.seed, 0xe81 + n));
    const notes: Record<string, string | number> = { method: pl.method };
    if (pl.year) notes.year = pl.year;
    if (pl.facility) notes.facility = pl.facility;
    if (pl.mProv) notes.massKind = pl.mProv;
    // Orbit size: measured semi-major axis, else Kepler's third law from the period.
    let a = pl.a ? pl.a * AU : NaN;
    let period = pl.per ? pl.per * DAY : NaN;
    if (!(a > 0) && period > 0) {
      a = dpow((G * hostMass * period * period) / (4 * Math.PI * Math.PI), 1 / 3);
      notes.orbitEstimated = 1;
    }
    if (!(period > 0) && a > 0) period = orbitalPeriod(a, hostMass);
    if (!(a > 0)) {
      // Directly imaged / microlensing planets can lack both: place from insolation if given, else skip.
      if (pl.insol && pl.insol > 0) a = (sqrtL / Math.sqrt(pl.insol)) * AU;
      else return;
      period = orbitalPeriod(a, hostMass);
      notes.orbitEstimated = 1;
    }
    const aAu = a / AU;
    const planet = makePlanet({
      id: `${input.id}/p${n}`, name: pl.name, seed: hashCombine(input.seed, 0x2000 + n), kind: 'planet', parent: 0,
      mass: pl.m ? pl.m * M_EARTH : NaN, radius: pl.r ? pl.r * R_EARTH : NaN, lumSun, aStarAu: aAu, teq: pl.teq,
      beyondSnowLine: aAu > 2.7 * sqrtL, inHz: aAu >= 0.95 * sqrtL && aAu <= 1.68 * sqrtL, real: true, allowRings: false,
    });
    Object.assign(planet.notes, notes);
    if (pl.inc === undefined) planet.notes.inclinationEstimated = 1;
    const inc = ((pl.inc ?? prng.range(84, 90)) * Math.PI) / 180;
    planet.orbit = { a, e: Math.min(0.97, pl.ecc ?? 0), i: inc, node, peri: pl.w !== undefined ? (pl.w * Math.PI) / 180 : prng.range(0, TWO_PI), m0: prng.range(0, TWO_PI), period };
    spinPlanet(prng, planet, hostMass);
    planet.rings = null;
    sys.bodies.push(planet);
  });
}

/** Generate the full model of a star system. */
export function generateSystem(input: SystemInput): SystemModel {
  const rng = new Rng(hashCombine(input.seed, 0x5157));
  const exo = input.exo;
  const primary = makeStar(input.star.absMag, input.star.teff, input.star.type, input.seed, input.star.real);
  if (input.star.spectral) primary.spectral = input.star.spectral;
  if (input.compact) {
    const c = input.compact;
    if (c.massSun !== undefined) {
      primary.mass = c.massSun * M_SUN;
      if (primary.type === 'blackhole') primary.radius = primary.schwarzschildRadius = (2 * G * primary.mass) / (299_792_458 * 299_792_458);
    }
    if (c.periodSec !== undefined) primary.rotationPeriod = c.periodSec;
    if (c.accretion !== undefined) primary.accretion = c.accretion;
  }
  if (exo) {
    // Prefer measured stellar parameters from the Exoplanet Archive over photometric estimates.
    if (exo.teff) primary.teff = exo.teff;
    if (exo.rad) primary.radius = exo.rad * R_SUN;
    if (exo.mass) primary.mass = exo.mass * M_SUN;
    if (exo.lum !== undefined) primary.luminosity = dpow(10, exo.lum) * L_SUN;
    if (exo.spt) primary.spectral = exo.spt;
    if (exo.age) primary.ageGyr = exo.age;
  }
  const bodies: Body[] = [];
  const belts: BeltProps[] = [];
  const sys = { bodies, belts };
  const a0 = starBody(input.id, input.name, input.seed, primary, input.star.real);
  bodies.push(a0);

  // System frame: real exoplanet systems are oriented by our line of sight; everything else is seeded.
  let basis: Mat3;
  if (exo && input.lineOfSight) {
    const toSun = { x: -input.lineOfSight.x, y: -input.lineOfSight.y, z: -input.lineOfSight.z };
    basis = basisFromZX(toSun, { x: 0, y: 0, z: 1 });
  } else {
    const [zx, zy, zz] = rng.unitVector();
    basis = basisFromZX({ x: zx, y: zy, z: zz }, vPerp({ x: zx, y: zy, z: zz }));
  }
  a0.axis = tiltedAxis(rng, 12);
  a0.rotationPhase = rng.range(0, TWO_PI);

  const lumPrimary = primary.luminosity / L_SUN;
  let lumTotal = lumPrimary;
  let hostMass = primary.mass;
  let innerLimit = 0;
  let outerLimit = 60 * AU * Math.max(0.3, dpow(primary.mass / M_SUN, 0.6));
  let planetParent = 0;
  const compact = primary.type === 'blackhole' || primary.type === 'neutron' || primary.type === 'pulsar';

  // ---- Companion stars.
  if (input.companion) {
    // Curated real companion (a black hole orbiting the catalogued star).
    const c = input.companion;
    const mass = c.massSun * M_SUN;
    const props = makeStar(12, 0, 'blackhole', hashCombine(input.seed, 0xc0), false);
    props.mass = mass;
    props.radius = props.schwarzschildRadius = (2 * G * mass) / (299_792_458 * 299_792_458);
    props.accretion = 0.9;
    const sep = c.semiMajorAxisAu * AU;
    const period = c.periodDays * DAY;
    const node = rng.range(0, TWO_PI);
    const m0 = rng.range(0, TWO_PI);
    a0.orbit = { a: (sep * mass) / (mass + primary.mass), e: 0.02, i: 0.4, node, peri: 0, m0, period };
    const b = starBody(`${input.id}/B`, c.name, hashCombine(input.seed, 0xc0), props, true);
    b.orbit = { a: (sep * primary.mass) / (mass + primary.mass), e: 0.02, i: 0.4, node, peri: Math.PI, m0, period };
    bodies.push(b);
    outerLimit = 0; // no invented planets in this real system
  } else if (!input.star.real && !exo && !input.compact) {
    const mSun = primary.mass / M_SUN;
    const pBinary = compact ? 0.4 : primary.type === 'whitedwarf' ? 0.25 : mSun > 8 ? 0.75 : mSun > 1.3 ? 0.55 : mSun > 0.6 ? 0.44 : 0.26;
    if (rng.chance(pBinary)) {
      // Companion: a fainter star of the same age, picked by magnitude difference.
      const dMag = compact ? rng.range(-8, 2) : rng.range(0.2, 6) * rng.next() + 0.1;
      const compMag = compact ? rng.range(2, 9) : input.star.absMag + dMag;
      const compType: StarType = compact && rng.chance(0.3) ? 'giant' : 'main';
      const compTeff = compType === 'giant' ? rng.range(3800, 4900) : mainSequenceTeff(compMag);
      const comp = makeStar(compType === 'giant' ? rng.range(-0.5, 1.5) : compMag, compTeff, compType, hashCombine(input.seed, 0xb1), false);
      // Separation: log-normal around ~40 AU; compact accretors hug their donor.
      const sep = compact ? Math.max((primary.radius + comp.radius) * 3, rng.range(0.03, 0.5) * AU) : Math.max((primary.radius + comp.radius) * 2.5, dexp(rng.normal(dlog(40), 2.3)) * AU);
      const total = primary.mass + comp.mass;
      const period = orbitalPeriod(sep, total);
      const e = sep < 0.2 * AU ? rng.range(0, 0.05) : Math.min(0.85, Math.abs(rng.normal(0.3, 0.25)));
      const node = rng.range(0, TWO_PI);
      const peri = rng.range(0, TWO_PI);
      const m0 = rng.range(0, TWO_PI);
      const inc = rng.range(0, 0.2);
      a0.name = componentName(input.name, 0);
      a0.orbit = { a: (sep * comp.mass) / total, e, i: inc, node, peri, m0, period };
      const b = starBody(`${input.id}/B`, componentName(input.name, 1), hashCombine(input.seed, 0xb1), comp, false);
      b.orbit = { a: (sep * primary.mass) / total, e, i: inc, node, peri: peri + Math.PI, m0, period };
      b.axis = tiltedAxis(rng, 15);
      bodies.push(b);
      if (compact) primary.accretion = Math.max(primary.accretion, rng.range(0.6, 1));
      const apo = sep * (1 + e);
      if (sep < 3 * AU) {
        // Close pair: planets circle both stars (circumbinary).
        planetParent = -1;
        hostMass = total;
        lumTotal = lumPrimary + comp.luminosity / L_SUN;
        innerLimit = apo * 3.2;
      } else {
        // Wide pair: planets stay close to the primary.
        outerLimit = Math.min(outerLimit, (sep * (1 - e)) / 3.5);
      }
      // Occasionally a distant third star.
      if (rng.chance(0.18) && !compact) {
        const cMag = Math.max(input.star.absMag + rng.range(1, 7), 4);
        const c3 = makeStar(cMag, mainSequenceTeff(cMag), 'main', hashCombine(input.seed, 0xb2), false);
        const sep3 = Math.max(apo * rng.range(12, 60), outerLimit * 4);
        const c = starBody(`${input.id}/C`, componentName(input.name, 2), hashCombine(input.seed, 0xb2), c3, false);
        c.orbit = { a: sep3, e: rng.range(0, 0.5), i: rng.range(0, 0.8), node: rng.range(0, TWO_PI), peri: rng.range(0, TWO_PI), m0: rng.range(0, TWO_PI), period: orbitalPeriod(sep3, total + c3.mass) };
        bodies.push(c);
      }
    }
  }

  // ---- Planets.
  if (exo) addExoplanets(sys, input, exo, primary.mass, lumPrimary);
  else if (outerLimit > 0 && !input.noPlanets) addProceduralPlanets(sys, input, planetParent, hostMass, lumTotal, innerLimit, outerLimit, input.name, input.id);

  let extent = Math.max(primary.radius * 30, 0.5 * AU);
  for (const b of bodies) if (b.orbit && b.parent < 0) extent = Math.max(extent, b.orbit.a * (1 + b.orbit.e));
  for (const b of bodies) if (b.orbit && b.parent === 0) extent = Math.max(extent, b.orbit.a * (1 + b.orbit.e));
  for (const belt of belts) extent = Math.max(extent, belt.outer);
  const sqrtL = Math.sqrt(Math.max(lumTotal, 1e-8));
  return { id: input.id, name: input.name, seed: input.seed, origin: input.origin, basis, bodies, belts, extent, hzInner: 0.95 * sqrtL * AU, hzOuter: 1.68 * sqrtL * AU, real: input.star.real };
}

/**
 * Positions of all bodies at simulation time t (seconds since J2000), in
 * world-axis metres relative to the system origin. `out` has 3 entries per body.
 */
export function bodyPositions(sys: SystemModel, t: number, out: Float64Array): Float64Array {
  const b = sys.basis;
  const tmp = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < sys.bodies.length; i++) {
    const body = sys.bodies[i]!;
    let x = 0;
    let y = 0;
    let z = 0;
    if (body.orbit) {
      orbitPosition(body.orbit, t, tmp);
      x = b[0] * tmp.x + b[3] * tmp.y + b[6] * tmp.z;
      y = b[1] * tmp.x + b[4] * tmp.y + b[7] * tmp.z;
      z = b[2] * tmp.x + b[5] * tmp.y + b[8] * tmp.z;
    }
    if (body.parent >= 0) {
      // Parents always precede their children in the list.
      x += out[body.parent * 3]!;
      y += out[body.parent * 3 + 1]!;
      z += out[body.parent * 3 + 2]!;
    }
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}

/** Spin axis of a body in world axes. */
export function bodyAxisWorld(sys: SystemModel, body: Body): V3 {
  const b = sys.basis;
  const a = body.axis;
  return { x: b[0] * a.x + b[3] * a.y + b[6] * a.z, y: b[1] * a.x + b[4] * a.y + b[7] * a.z, z: b[2] * a.x + b[5] * a.y + b[8] * a.z };
}

/** Rotation angle (radians) of a body about its axis at time t. */
export function bodyRotation(body: Body, t: number): number {
  return body.rotationPhase + (TWO_PI * t) / body.rotationPeriod;
}

