/**
 * Planet & moon generator: physical properties → type, atmosphere, surface
 * look, rings. Used for procedural worlds, for confirmed exoplanets (where
 * measured values are passed in and only the unknowns are filled) and as the
 * base for Solar System bodies.
 */
import type { RGB } from '../core/color';
import { dexp, dlog, dpow } from '../core/dmath';
import { Rng } from '../core/rng';
import { G, G_EARTH, M_EARTH, R_EARTH } from '../core/units';
import type { AtmosphereProps, PlanetBody, PlanetType, RingProps, SurfaceProps } from './types';

/** Mass (Earth masses) → radius (Earth radii): Chen & Kipping (2017) broken power law. */
export function radiusFromMass(mEarth: number): number {
  if (mEarth < 2.04) return 1.008 * dpow(mEarth, 0.279);
  if (mEarth < 132) return 0.808 * dpow(mEarth, 0.589);
  return 17.74 * dpow(mEarth, -0.044);
}

/** Inverse of `radiusFromMass` on its monotonic branches (gas giants return a nominal Jupiter-like mass). */
export function massFromRadius(rEarth: number): number {
  if (rEarth < 1.23) return dpow(rEarth / 1.008, 1 / 0.279);
  if (rEarth < 14.3) return dpow(rEarth / 0.808, 1 / 0.589);
  return 318;
}

/** Equilibrium temperature (K) at `aAu` from a star of `lumSun`, for Bond albedo `albedo`. */
export function equilibriumTemperature(lumSun: number, aAu: number, albedo: number): number {
  return (278.5 * dpow(Math.max(lumSun, 1e-9), 0.25) * dpow(Math.max(0, 1 - albedo), 0.25)) / Math.sqrt(Math.max(aAu, 1e-6));
}

const rgb = (r: number, g: number, b: number): RGB => [r, g, b];
const mixRgb = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const jitter = (rng: Rng, c: RGB, amount: number): RGB => [
  Math.max(0, c[0] * (1 + rng.range(-amount, amount))),
  Math.max(0, c[1] * (1 + rng.range(-amount, amount))),
  Math.max(0, c[2] * (1 + rng.range(-amount, amount))),
];

/** Decide the planet type from bulk properties. `beyondSnowLine` and `inHz` come from the system layout. */
export function classifyPlanet(rng: Rng, mEarth: number, rEarth: number, teq: number, beyondSnowLine: boolean, inHz: boolean): PlanetType {
  if (rEarth > 6 || mEarth > 60) return 'gasgiant';
  if (rEarth > 2.2 || mEarth > 9) return 'icegiant';
  if (teq > 900) return 'lava';
  if (beyondSnowLine || teq < 170) return mEarth < 0.02 && rng.chance(0.5) ? 'rocky' : 'ice';
  if (inHz && mEarth > 0.25) return rng.chance(0.55) ? 'ocean' : 'desert';
  if (mEarth < 0.15) return 'rocky';
  if (teq > 330) return rng.chance(0.65) ? 'desert' : 'rocky';
  return rng.chance(0.4) ? 'desert' : rng.chance(0.5) ? 'ice' : 'rocky';
}

function makeAtmosphere(rng: Rng, type: PlanetType, mEarth: number, gravity: number, teq: number): AtmosphereProps | null {
  let pressure: number;
  let composition: string;
  let rayleigh: RGB;
  let mie = 0.15;
  let mieColor: RGB = rgb(1, 1, 1);
  let mu = 29;
  switch (type) {
    case 'gasgiant':
      pressure = 1;
      mu = 2.3;
      composition = 'Hydrogen, helium';
      rayleigh = rgb(0.55, 0.7, 1);
      mie = 0.5;
      mieColor = rgb(1, 0.92, 0.8);
      break;
    case 'icegiant':
      pressure = 1;
      mu = 2.6;
      composition = 'Hydrogen, helium, methane';
      rayleigh = rgb(0.3, 0.65, 1);
      mie = 0.3;
      break;
    case 'ocean':
      pressure = dexp(rng.range(dlog(0.4), dlog(4)));
      composition = rng.chance(0.6) ? 'Nitrogen, oxygen' : 'Nitrogen, carbon dioxide';
      rayleigh = jitter(rng, rgb(0.23, 0.52, 1), 0.15);
      break;
    case 'desert':
      if (mEarth < 0.08) return null;
      pressure = dexp(rng.range(dlog(0.006), dlog(teq > 500 ? 90 : 2)));
      composition = 'Carbon dioxide, nitrogen';
      rayleigh = pressure > 20 ? rgb(1, 0.75, 0.4) : jitter(rng, rgb(0.9, 0.6, 0.38), 0.2);
      mie = pressure > 20 ? 1.2 : 0.5;
      mieColor = rgb(1, 0.8, 0.55);
      mu = 44;
      break;
    case 'ice':
      if (mEarth < 0.02 || rng.chance(0.45)) return null;
      pressure = dexp(rng.range(dlog(0.001), dlog(1.6)));
      composition = teq < 100 ? 'Nitrogen, methane' : 'Nitrogen';
      rayleigh = teq < 100 ? rgb(0.95, 0.65, 0.35) : rgb(0.45, 0.65, 1);
      mie = teq < 100 ? 0.9 : 0.2;
      mieColor = rgb(1, 0.75, 0.45);
      mu = 28;
      break;
    case 'lava':
      if (mEarth < 0.3 || rng.chance(0.4)) return null;
      pressure = dexp(rng.range(dlog(0.05), dlog(30)));
      composition = 'Sulfur dioxide, vaporised rock';
      rayleigh = rgb(1, 0.5, 0.25);
      mie = 0.9;
      mieColor = rgb(1, 0.6, 0.3);
      mu = 55;
      break;
    default:
      return null; // rocky: airless
  }
  // Scale height H = k·T / (μ·m_H·g).
  const t = Math.max(40, teq);
  const scaleHeight = (1.380649e-23 * t) / (mu * 1.6735575e-27 * gravity);
  return { pressure, scaleHeight, rayleigh, density: Math.min(3, 0.35 + 0.65 * dpow(pressure, 0.4)), mie, mieColor, composition };
}

function makeSurface(rng: Rng, type: PlanetType, gravity: number, teq: number, tSurface: number, hasAir: boolean): SurfaceProps {
  const seed = rng.u32();
  const base: SurfaceProps = {
    relief: Math.min(30_000, (9000 * G_EARTH) / Math.max(gravity, 0.3)) * rng.range(0.6, 1.5),
    oceanLevel: 0, oceanColor: rgb(0.02, 0.08, 0.2), palette: [rgb(0.3, 0.28, 0.26), rgb(0.42, 0.4, 0.37), rgb(0.52, 0.5, 0.47), rgb(0.7, 0.69, 0.67)],
    iceCap: 0, clouds: 0, cloudColor: rgb(1, 1, 1), vegetation: 0, emission: 0, emissionColor: rgb(1, 0.3, 0.05),
    bands: 0, bandContrast: 0, storms: 0, craters: 0, seed, continentScale: rng.range(1.2, 2.6),
  };
  switch (type) {
    case 'rocky': {
      const tone = jitter(rng, rng.chance(0.5) ? rgb(0.36, 0.34, 0.33) : rgb(0.42, 0.33, 0.27), 0.18);
      base.palette = [mixRgb(tone, rgb(0.1, 0.1, 0.1), 0.45), tone, mixRgb(tone, rgb(0.8, 0.78, 0.75), 0.3), mixRgb(tone, rgb(0.9, 0.9, 0.9), 0.55)];
      base.craters = rng.range(0.5, 1);
      break;
    }
    case 'desert': {
      const sand = jitter(rng, rng.pick([rgb(0.62, 0.36, 0.2), rgb(0.72, 0.52, 0.3), rgb(0.55, 0.3, 0.22), rgb(0.66, 0.6, 0.42)]), 0.15);
      base.palette = [mixRgb(sand, rgb(0.2, 0.1, 0.06), 0.5), sand, mixRgb(sand, rgb(0.85, 0.7, 0.5), 0.4), mixRgb(sand, rgb(0.95, 0.9, 0.85), 0.6)];
      base.iceCap = tSurface < 290 ? rng.range(0.03, 0.14) : 0;
      base.clouds = hasAir ? rng.range(0, 0.25) : 0;
      base.cloudColor = rgb(0.95, 0.85, 0.7);
      base.craters = hasAir ? rng.range(0, 0.3) : rng.range(0.4, 0.9);
      break;
    }
    case 'ocean': {
      base.oceanLevel = rng.range(0.45, 0.9);
      base.oceanColor = jitter(rng, rgb(0.015, 0.07, 0.19), 0.3);
      const life = rng.chance(0.45);
      base.vegetation = life ? rng.range(0.4, 1) : 0;
      const land = jitter(rng, rgb(0.46, 0.38, 0.26), 0.2);
      const green = jitter(rng, rng.chance(0.85) ? rgb(0.1, 0.3, 0.07) : rgb(0.35, 0.1, 0.3), 0.25);
      base.palette = [mixRgb(rgb(0.7, 0.62, 0.42), green, base.vegetation * 0.5), mixRgb(land, green, base.vegetation), mixRgb(land, rgb(0.4, 0.38, 0.36), 0.6), rgb(0.93, 0.94, 0.96)];
      base.iceCap = Math.max(0, Math.min(0.6, (300 - tSurface) / 90 + rng.range(-0.05, 0.1)));
      base.clouds = rng.range(0.3, 0.75);
      base.relief *= 0.8;
      break;
    }
    case 'ice': {
      const ice = jitter(rng, rng.pick([rgb(0.78, 0.84, 0.9), rgb(0.7, 0.72, 0.8), rgb(0.82, 0.76, 0.68), rgb(0.6, 0.72, 0.78)]), 0.08);
      base.palette = [mixRgb(ice, rgb(0.35, 0.3, 0.28), 0.5), mixRgb(ice, rgb(0.5, 0.56, 0.66), 0.35), ice, rgb(0.96, 0.97, 1)];
      base.iceCap = 1;
      base.clouds = hasAir ? rng.range(0, 0.35) : 0;
      base.craters = hasAir ? 0.1 : rng.range(0.15, 0.6);
      base.relief *= 0.5;
      break;
    }
    case 'lava': {
      const rock = jitter(rng, rgb(0.09, 0.075, 0.07), 0.25);
      base.palette = [rgb(0.03, 0.025, 0.025), rock, mixRgb(rock, rgb(0.3, 0.25, 0.22), 0.5), rgb(0.35, 0.3, 0.28)];
      base.oceanLevel = rng.range(0.12, 0.5);
      base.oceanColor = rgb(1, 0.32, 0.04);
      base.emission = Math.min(1, 0.5 + (teq - 900) / 1500 + rng.range(0, 0.3));
      base.emissionColor = teq > 1800 ? rgb(1, 0.6, 0.2) : rgb(1, 0.28, 0.04);
      base.clouds = hasAir ? rng.range(0, 0.3) : 0;
      base.cloudColor = rgb(0.35, 0.28, 0.25);
      break;
    }
    case 'gasgiant': {
      // Sudarsky classes: cold ammonia-cloud giants are banded tan/cream, warm water-cloud giants white-blue, hot ones dark blue/violet.
      const hot = teq > 900;
      const warm = teq > 250 && !hot;
      const a = hot ? rgb(0.08, 0.1, 0.22) : warm ? rgb(0.75, 0.82, 0.92) : jitter(rng, rng.pick([rgb(0.78, 0.62, 0.42), rgb(0.82, 0.74, 0.55), rgb(0.7, 0.5, 0.38)]), 0.12);
      const b = hot ? rgb(0.2, 0.14, 0.3) : warm ? rgb(0.5, 0.62, 0.8) : jitter(rng, rng.pick([rgb(0.5, 0.3, 0.2), rgb(0.62, 0.42, 0.26), rgb(0.42, 0.32, 0.3)]), 0.15);
      base.palette = [b, a, mixRgb(a, rgb(1, 1, 1), 0.35), mixRgb(b, rgb(0.9, 0.5, 0.3), 0.5)];
      base.bands = rng.int(6, 16);
      base.bandContrast = rng.range(0.45, 1);
      base.storms = rng.int(1, 5);
      base.relief = 0;
      base.emission = hot ? Math.min(0.6, (teq - 900) / 2500) : 0;
      base.emissionColor = rgb(1, 0.35, 0.1);
      break;
    }
    case 'icegiant': {
      const a = jitter(rng, teq > 500 ? rgb(0.45, 0.5, 0.7) : rng.pick([rgb(0.35, 0.62, 0.78), rgb(0.2, 0.36, 0.8), rgb(0.5, 0.78, 0.8), rgb(0.3, 0.55, 0.62)]), 0.1);
      base.palette = [mixRgb(a, rgb(0.05, 0.1, 0.25), 0.4), a, mixRgb(a, rgb(1, 1, 1), 0.3), mixRgb(a, rgb(1, 1, 1), 0.6)];
      base.bands = rng.int(3, 8);
      base.bandContrast = rng.range(0.1, 0.4);
      base.storms = rng.int(0, 2);
      base.relief = 0;
      break;
    }
  }
  return base;
}

function meanColor(type: PlanetType, s: SurfaceProps): RGB {
  if (type === 'ocean') return mixRgb(mixRgb(s.palette[1], s.oceanColor, s.oceanLevel), s.cloudColor, s.clouds * 0.55);
  if (type === 'lava') return mixRgb(s.palette[1], [0.5, 0.15, 0.03], 0.35);
  return mixRgb(mixRgb(s.palette[0], s.palette[1], 0.6), s.cloudColor, s.clouds * 0.4);
}

export function makeRings(rng: Rng, radius: number, type: PlanetType): RingProps {
  const icy = type !== 'rocky' && type !== 'desert' && type !== 'lava';
  const inner = radius * rng.range(1.22, 1.6);
  return {
    inner, outer: Math.max(inner * 1.25, radius * rng.range(1.9, 2.5)),
    color: icy ? jitter(rng, rgb(0.82, 0.76, 0.66), 0.12) : jitter(rng, rgb(0.45, 0.38, 0.32), 0.15),
    opacity: rng.range(0.35, 0.95), seed: rng.u32(),
  };
}

export interface PlanetInput {
  id: string;
  name: string;
  seed: number;
  kind: 'planet' | 'moon';
  parent: number;
  /** Mass (kg) and radius (m). Pass NaN for unknown values of a real planet; they are filled from the other. */
  mass: number;
  radius: number;
  /** Luminosity of the star(s) in solar units and distance from them in AU (for temperature). */
  lumSun: number;
  aStarAu: number;
  /** Measured equilibrium temperature, if any. */
  teq?: number;
  beyondSnowLine: boolean;
  inHz: boolean;
  /** Force a type (Solar System bodies, tidally heated moons). */
  type?: PlanetType;
  real: boolean;
  allowRings: boolean;
}

/** Build a planet or moon body (orbit, axis and rotation are filled in by the system generator). */
export function makePlanet(input: PlanetInput): PlanetBody {
  const rng = new Rng(input.seed ^ 0x91a4e7);
  const notes: Record<string, string | number> = {};
  let mEarth = input.mass / M_EARTH;
  let rEarth = input.radius / R_EARTH;
  if (!(mEarth > 0) && rEarth > 0) {
    mEarth = massFromRadius(rEarth);
    notes.massEstimated = 1;
  }
  if (!(rEarth > 0) && mEarth > 0) {
    rEarth = radiusFromMass(mEarth);
    notes.radiusEstimated = 1;
  }
  const mass = mEarth * M_EARTH;
  const radius = rEarth * R_EARTH;
  const gravity = (G * mass) / (radius * radius);

  // First pass with a neutral albedo to classify, then refine with the type's albedo.
  const teq0 = input.teq ?? equilibriumTemperature(input.lumSun, input.aStarAu, 0.3);
  const type = input.type ?? classifyPlanet(rng, mEarth, rEarth, teq0, input.beyondSnowLine, input.inHz);
  const albedo = type === 'ice' ? rng.range(0.5, 0.75) : type === 'ocean' ? rng.range(0.25, 0.38) : type === 'gasgiant' || type === 'icegiant' ? rng.range(0.3, 0.52) : type === 'lava' ? rng.range(0.05, 0.15) : rng.range(0.1, 0.3);
  const teq = input.teq ?? equilibriumTemperature(input.lumSun, input.aStarAu, albedo);
  const atmosphere = makeAtmosphere(rng, type, mEarth, gravity, teq);
  // Greenhouse warming grows with surface pressure (Earth ≈ +33 K at 1 bar; Venus ≈ +500 K at 92 bar).
  const greenhouse = atmosphere && type !== 'gasgiant' && type !== 'icegiant' ? 33 * dpow(atmosphere.pressure, 0.6) * (type === 'desert' || type === 'lava' ? 1.2 : 1) : 0;
  const tSurface = teq + Math.min(greenhouse, 600);
  const surface = makeSurface(rng, type, gravity, teq, tSurface, atmosphere !== null);
  const rings = input.allowRings && rng.chance(type === 'gasgiant' ? 0.55 : type === 'icegiant' ? 0.35 : 0.015) ? makeRings(rng, radius, type) : null;
  const magnetic = type === 'gasgiant' || type === 'icegiant' ? 1 : mEarth > 0.4 ? rng.range(0, 1) : 0;
  const aurora = atmosphere ? Math.min(1, magnetic * rng.range(0.3, 1.2)) : 0;

  return {
    kind: input.kind, id: input.id, name: input.name, seed: input.seed, parent: input.parent, orbit: null,
    mass, radius, axis: { x: 0, y: 0, z: 1 }, rotationPeriod: 86400, rotationPhase: 0, real: input.real,
    type, teq, tSurface, gravity, albedo, color: meanColor(type, surface), atmosphere, rings, surface,
    habitableZone: input.inHz, aurora, notes,
  };
}

const TYPE_LABEL: Record<PlanetType, string> = { rocky: 'Rocky world', desert: 'Desert world', ocean: 'Ocean world', ice: 'Ice world', lava: 'Lava world', gasgiant: 'Gas giant', icegiant: 'Ice giant' };
export const planetTypeLabel = (t: PlanetType): string => TYPE_LABEL[t];

/** Friendly one-line description. */
export function describePlanet(p: PlanetBody): string {
  const moon = p.kind === 'moon';
  switch (p.type) {
    case 'gasgiant':
      return p.teq > 900 ? 'A scorching “hot Jupiter” skimming its star.' : `A giant ball of hydrogen and helium${p.rings ? ', circled by bright rings' : ''} with storms larger than worlds.`;
    case 'icegiant':
      return p.teq > 500 ? 'A warm Neptune-like world wrapped in thick haze.' : 'A cold blue giant of gas, ice and endless wind.';
    case 'ocean':
      return p.surface.vegetation > 0 ? 'A temperate world of seas and continents — with hints of something growing.' : 'A temperate world with liquid oceans and drifting clouds.';
    case 'desert':
      return p.atmosphere && p.atmosphere.pressure > 20 ? 'A furnace world smothered by a crushing, cloudy atmosphere.' : 'A dry, dusty world of dunes, canyons and thin air.';
    case 'ice':
      return moon ? 'A frozen moon, its icy shell cracked and scarred.' : 'A frozen world locked in ice far from its star’s warmth.';
    case 'lava':
      return moon ? 'A tortured volcanic moon, squeezed by tides until it glows.' : 'A molten world whose surface glows with rivers of lava.';
    default:
      return moon ? 'A small, airless, cratered moon.' : 'A barren, airless ball of rock covered in craters.';
  }
}
