/**
 * The real Solar System.
 *
 * Orbits: mean elements fitted to JPL Horizons (DE441) over 2020–2040 —
 * generated into data/solarElements.json by the catalog pipeline.
 * Physical data (radii, GM, rotation, pole directions): JPL SSD "Planetary
 * Physical Parameters" / "Planetary Satellite Physical Parameters" and the
 * IAU WGCCRE 2015 report. Surface looks are tuned by hand to resemble each body.
 */
import { DEG, OBLIQUITY, type OrbitElements, raDecToUnit } from '../core/astro';
import type { RGB } from '../core/color';
import { uposZero } from '../core/hp';
import type { Mat3, V3 } from '../core/math';
import { AU, DAY, G, L_SUN, M_SUN, R_SUN } from '../core/units';
import elementsJson from './data/solarElements.json';
import { makePlanet } from './planet';
import { makeStar } from './star';
import type { AtmosphereProps, BeltProps, Body, PlanetBody, PlanetType, RingProps, StarBody, SurfaceProps, SystemModel } from './types';

const ELEMENTS = (elementsJson as { bodies: Record<string, OrbitElements> }).bodies;

/** System frame = ecliptic of J2000. Rows are the ecliptic x, y, z axes expressed in ICRS. */
const ce = Math.cos(OBLIQUITY);
const se = Math.sin(OBLIQUITY);
export const ECLIPTIC_BASIS: Mat3 = [1, 0, 0, 0, ce, se, 0, -se, ce];

/** ICRS direction → ecliptic system frame. */
function icrsToEcliptic(v: V3): V3 {
  return { x: v.x, y: ce * v.y + se * v.z, z: -se * v.y + ce * v.z };
}

interface BodySpec {
  key: string;
  name: string;
  parent: string | null;
  type: PlanetType;
  /** Mean radius, km. */
  radius: number;
  /** GM, km³/s². */
  gm: number;
  /** Sidereal rotation period, days (negative = retrograde). 0 = synchronous with the orbit. */
  rotation: number;
  /** North pole right ascension / declination (ICRS, degrees). */
  pole: [number, number];
  /** Prime-meridian angle W at J2000 (degrees), IAU WGCCRE. */
  w0: number;
  albedo: number;
  /** Mean surface temperature, K. */
  temp: number;
  surface: Partial<SurfaceProps>;
  atmosphere?: Partial<AtmosphereProps> | null;
  rings?: Omit<RingProps, 'seed'>;
  aurora?: number;
  blurb: string;
}

const c = (r: number, g: number, b: number): RGB => [r, g, b];

const BODIES: BodySpec[] = [
  {
    key: 'mercury', name: 'Mercury', parent: null, type: 'rocky', radius: 2439.4, gm: 22031.868, rotation: 58.6462, pole: [281.0103, 61.4155], w0: 329.5988, albedo: 0.088, temp: 440,
    surface: { palette: [c(0.2, 0.19, 0.18), c(0.33, 0.31, 0.29), c(0.44, 0.42, 0.4), c(0.6, 0.58, 0.56)], craters: 1, relief: 9000, continentScale: 2.2 },
    atmosphere: null, blurb: 'The smallest planet and the closest to the Sun — a scorched, cratered ball of rock.',
  },
  {
    key: 'venus', name: 'Venus', parent: null, type: 'desert', radius: 6051.8, gm: 324858.592, rotation: -243.018, pole: [272.76, 67.16], w0: 160.2, albedo: 0.76, temp: 737,
    surface: { palette: [c(0.45, 0.3, 0.14), c(0.62, 0.42, 0.2), c(0.72, 0.52, 0.28), c(0.8, 0.65, 0.4)], clouds: 1, cloudColor: c(0.95, 0.87, 0.66), relief: 11000, craters: 0.05 },
    atmosphere: { pressure: 92, scaleHeight: 15900, rayleigh: c(1, 0.8, 0.45), density: 2.6, mie: 1.4, mieColor: c(1, 0.85, 0.6), composition: 'Carbon dioxide, nitrogen' },
    blurb: 'Earth’s scorching twin, hidden under thick clouds of sulfuric acid.',
  },
  {
    key: 'earth', name: 'Earth', parent: null, type: 'ocean', radius: 6371.0084, gm: 398600.435, rotation: 0.99726968, pole: [0, 90], w0: 190.147, albedo: 0.306, temp: 288,
    surface: {
      oceanLevel: 0.71, oceanColor: c(0.012, 0.055, 0.16), palette: [c(0.2, 0.3, 0.1), c(0.16, 0.27, 0.08), c(0.4, 0.34, 0.24), c(0.93, 0.94, 0.96)],
      iceCap: 0.16, clouds: 0.55, vegetation: 1, relief: 19800, continentScale: 1.7,
    },
    atmosphere: { pressure: 1.013, scaleHeight: 8500, rayleigh: c(0.2, 0.5, 1), density: 1, mie: 0.12, mieColor: c(1, 1, 1), composition: 'Nitrogen, oxygen' },
    aurora: 0.7, blurb: 'Home. The only world known to harbour life — so far.',
  },
  {
    key: 'mars', name: 'Mars', parent: null, type: 'desert', radius: 3389.5, gm: 42828.375, rotation: 1.02595676, pole: [317.681, 52.887], w0: 176.63, albedo: 0.25, temp: 210,
    surface: { palette: [c(0.3, 0.14, 0.08), c(0.55, 0.27, 0.14), c(0.68, 0.4, 0.24), c(0.82, 0.62, 0.48)], iceCap: 0.07, clouds: 0.04, cloudColor: c(0.95, 0.85, 0.75), relief: 29400, craters: 0.35, continentScale: 1.5 },
    atmosphere: { pressure: 0.0064, scaleHeight: 11100, rayleigh: c(0.85, 0.55, 0.35), density: 0.28, mie: 0.9, mieColor: c(0.95, 0.7, 0.5), composition: 'Carbon dioxide' },
    blurb: 'The Red Planet: a cold desert world with giant volcanoes, canyons and polar ice caps.',
  },
  {
    key: 'jupiter', name: 'Jupiter', parent: null, type: 'gasgiant', radius: 69911, gm: 126686531.9, rotation: 0.41354, pole: [268.057, 64.495], w0: 284.95, albedo: 0.503, temp: 165,
    surface: { palette: [c(0.56, 0.36, 0.22), c(0.8, 0.68, 0.5), c(0.93, 0.88, 0.78), c(0.72, 0.36, 0.22)], bands: 14, bandContrast: 0.9, storms: 4, relief: 0 },
    atmosphere: { pressure: 1, scaleHeight: 27000, rayleigh: c(0.6, 0.72, 1), density: 1, mie: 0.5, mieColor: c(1, 0.92, 0.8), composition: 'Hydrogen, helium' },
    rings: { inner: 92_000_000, outer: 129_000_000, color: c(0.5, 0.42, 0.36), opacity: 0.04 }, aurora: 1,
    blurb: 'The king of the planets — a gas giant so large that all the others would fit inside it.',
  },
  {
    key: 'saturn', name: 'Saturn', parent: null, type: 'gasgiant', radius: 58232, gm: 37931206.23, rotation: 0.44401, pole: [40.589, 83.537], w0: 38.9, albedo: 0.342, temp: 134,
    surface: { palette: [c(0.7, 0.58, 0.38), c(0.86, 0.76, 0.56), c(0.94, 0.88, 0.72), c(0.8, 0.66, 0.44)], bands: 12, bandContrast: 0.4, storms: 1, relief: 0 },
    atmosphere: { pressure: 1, scaleHeight: 59500, rayleigh: c(0.75, 0.78, 0.9), density: 1, mie: 0.6, mieColor: c(1, 0.92, 0.75), composition: 'Hydrogen, helium' },
    rings: { inner: 74_500_000, outer: 140_220_000, color: c(0.84, 0.77, 0.63), opacity: 0.92 }, aurora: 0.8,
    blurb: 'The ringed jewel of the Solar System, wrapped in billions of icy fragments.',
  },
  {
    key: 'uranus', name: 'Uranus', parent: null, type: 'icegiant', radius: 25362, gm: 5793951.256, rotation: -0.71833, pole: [257.311, -15.175], w0: 203.81, albedo: 0.3, temp: 76,
    surface: { palette: [c(0.4, 0.66, 0.72), c(0.58, 0.82, 0.86), c(0.72, 0.9, 0.92), c(0.85, 0.95, 0.96)], bands: 4, bandContrast: 0.1, storms: 0, relief: 0 },
    atmosphere: { pressure: 1, scaleHeight: 27700, rayleigh: c(0.4, 0.8, 1), density: 1, mie: 0.25, mieColor: c(0.9, 1, 1), composition: 'Hydrogen, helium, methane' },
    rings: { inner: 41_837_000, outer: 51_149_000, color: c(0.32, 0.32, 0.34), opacity: 0.25 }, aurora: 0.4,
    blurb: 'An ice giant tipped on its side, rolling around the Sun like a pale blue ball.',
  },
  {
    key: 'neptune', name: 'Neptune', parent: null, type: 'icegiant', radius: 24622, gm: 6835099.97, rotation: 0.67125, pole: [299.36, 43.46], w0: 249.978, albedo: 0.29, temp: 72,
    surface: { palette: [c(0.1, 0.2, 0.62), c(0.18, 0.34, 0.82), c(0.36, 0.52, 0.92), c(0.8, 0.86, 0.98)], bands: 6, bandContrast: 0.3, storms: 2, relief: 0 },
    atmosphere: { pressure: 1, scaleHeight: 19700, rayleigh: c(0.25, 0.5, 1), density: 1, mie: 0.25, mieColor: c(0.85, 0.9, 1), composition: 'Hydrogen, helium, methane' },
    rings: { inner: 41_900_000, outer: 62_932_000, color: c(0.3, 0.3, 0.32), opacity: 0.06 }, aurora: 0.4,
    blurb: 'The windiest world: a deep-blue ice giant at the dark edge of the planets.',
  },
  {
    key: 'pluto', name: 'Pluto', parent: null, type: 'ice', radius: 1188.3, gm: 869.6, rotation: -6.3872, pole: [132.993, -6.163], w0: 302.695, albedo: 0.52, temp: 44,
    surface: { palette: [c(0.3, 0.2, 0.15), c(0.6, 0.48, 0.38), c(0.82, 0.76, 0.68), c(0.95, 0.93, 0.9)], iceCap: 1, relief: 7000, craters: 0.3 },
    atmosphere: { pressure: 0.00001, scaleHeight: 50000, rayleigh: c(0.5, 0.65, 1), density: 0.12, mie: 0.3, mieColor: c(0.7, 0.8, 1), composition: 'Nitrogen, methane' },
    blurb: 'A dwarf planet with a heart of nitrogen ice, far out in the Kuiper belt.',
  },
  {
    key: 'ceres', name: 'Ceres', parent: null, type: 'rocky', radius: 469.7, gm: 62.63, rotation: 0.3781, pole: [291.418, 66.764], w0: 170.65, albedo: 0.09, temp: 168,
    surface: { palette: [c(0.14, 0.14, 0.14), c(0.24, 0.23, 0.22), c(0.33, 0.32, 0.31), c(0.75, 0.75, 0.78)], craters: 0.9, relief: 9000 },
    atmosphere: null, blurb: 'The largest object in the asteroid belt — a dwarf planet of rock and ice.',
  },
  {
    key: 'moon', name: 'Moon', parent: 'earth', type: 'rocky', radius: 1737.4, gm: 4902.8, rotation: 0, pole: [269.9949, 66.5392], w0: 38.32, albedo: 0.12, temp: 250,
    surface: { palette: [c(0.14, 0.14, 0.15), c(0.3, 0.3, 0.3), c(0.44, 0.43, 0.42), c(0.6, 0.6, 0.6)], craters: 1, relief: 16000, continentScale: 1.3 },
    atmosphere: null, blurb: 'Earth’s companion, and the only other world humans have walked on.',
  },
  { key: 'phobos', name: 'Phobos', parent: 'mars', type: 'rocky', radius: 11.08, gm: 0.0007087, rotation: 0, pole: [317.68, 52.9], w0: 35.06, albedo: 0.07, temp: 233, surface: { palette: [c(0.1, 0.09, 0.08), c(0.2, 0.18, 0.16), c(0.27, 0.25, 0.22), c(0.35, 0.32, 0.3)], craters: 1, relief: 3000 }, atmosphere: null, blurb: 'A tiny, potato-shaped moon slowly spiralling toward Mars.' },
  { key: 'deimos', name: 'Deimos', parent: 'mars', type: 'rocky', radius: 6.2, gm: 0.0000962, rotation: 0, pole: [316.65, 53.52], w0: 79.41, albedo: 0.068, temp: 233, surface: { palette: [c(0.12, 0.1, 0.09), c(0.22, 0.2, 0.17), c(0.3, 0.27, 0.24), c(0.38, 0.35, 0.32)], craters: 0.8, relief: 1500 }, atmosphere: null, blurb: 'The smaller, smoother of Mars’s two captured-asteroid moons.' },
  {
    key: 'io', name: 'Io', parent: 'jupiter', type: 'lava', radius: 1821.49, gm: 5959.916, rotation: 0, pole: [268.05, 64.5], w0: 200.39, albedo: 0.63, temp: 110,
    surface: { palette: [c(0.35, 0.3, 0.08), c(0.75, 0.68, 0.25), c(0.85, 0.75, 0.4), c(0.95, 0.92, 0.8)], oceanLevel: 0.06, oceanColor: c(1, 0.3, 0.03), emission: 0.6, emissionColor: c(1, 0.3, 0.04), relief: 9000, craters: 0 },
    atmosphere: null, blurb: 'The most volcanic place known: a sulfur-yellow moon torn by Jupiter’s tides.',
  },
  {
    key: 'europa', name: 'Europa', parent: 'jupiter', type: 'ice', radius: 1560.8, gm: 3202.712, rotation: 0, pole: [268.08, 64.51], w0: 36.022, albedo: 0.67, temp: 102,
    surface: { palette: [c(0.5, 0.32, 0.2), c(0.74, 0.66, 0.56), c(0.88, 0.86, 0.82), c(0.97, 0.97, 0.98)], iceCap: 1, relief: 800, craters: 0.02 },
    atmosphere: null, blurb: 'A smooth shell of cracked ice hiding a global salt-water ocean.',
  },
  {
    key: 'ganymede', name: 'Ganymede', parent: 'jupiter', type: 'ice', radius: 2631.2, gm: 9887.832, rotation: 0, pole: [268.2, 64.57], w0: 44.064, albedo: 0.43, temp: 110,
    surface: { palette: [c(0.2, 0.18, 0.16), c(0.4, 0.37, 0.33), c(0.6, 0.58, 0.55), c(0.85, 0.85, 0.86)], iceCap: 0.25, relief: 2500, craters: 0.6 },
    atmosphere: null, aurora: 0.2, blurb: 'The largest moon in the Solar System — bigger than Mercury.',
  },
  {
    key: 'callisto', name: 'Callisto', parent: 'jupiter', type: 'ice', radius: 2410.3, gm: 7179.283, rotation: 0, pole: [268.72, 64.83], w0: 259.51, albedo: 0.17, temp: 134,
    surface: { palette: [c(0.1, 0.09, 0.08), c(0.22, 0.2, 0.18), c(0.34, 0.32, 0.3), c(0.7, 0.7, 0.72)], iceCap: 0, relief: 2000, craters: 1 },
    atmosphere: null, blurb: 'An ancient, dark moon — the most heavily cratered surface known.',
  },
  { key: 'mimas', name: 'Mimas', parent: 'saturn', type: 'ice', radius: 198.2, gm: 2.503489, rotation: 0, pole: [40.66, 83.52], w0: 333.46, albedo: 0.96, temp: 64, surface: { palette: [c(0.5, 0.5, 0.5), c(0.72, 0.72, 0.72), c(0.84, 0.84, 0.84), c(0.95, 0.95, 0.95)], iceCap: 1, relief: 6000, craters: 1 }, atmosphere: null, blurb: 'A small icy moon with one enormous crater — the “Death Star” moon.' },
  { key: 'enceladus', name: 'Enceladus', parent: 'saturn', type: 'ice', radius: 252.1, gm: 7.210367, rotation: 0, pole: [40.66, 83.52], w0: 6.32, albedo: 1.0, temp: 75, surface: { palette: [c(0.7, 0.76, 0.82), c(0.86, 0.9, 0.93), c(0.94, 0.96, 0.98), c(1, 1, 1)], iceCap: 1, relief: 1500, craters: 0.15 }, atmosphere: null, blurb: 'A brilliant white moon that sprays geysers of water into space.' },
  { key: 'tethys', name: 'Tethys', parent: 'saturn', type: 'ice', radius: 531.1, gm: 41.21, rotation: 0, pole: [40.66, 83.52], w0: 8.95, albedo: 0.8, temp: 86, surface: { palette: [c(0.55, 0.55, 0.55), c(0.74, 0.74, 0.74), c(0.86, 0.86, 0.86), c(0.95, 0.95, 0.95)], iceCap: 1, relief: 5000, craters: 0.9 }, atmosphere: null, blurb: 'A ball of nearly pure water ice scarred by a vast canyon.' },
  { key: 'dione', name: 'Dione', parent: 'saturn', type: 'ice', radius: 561.4, gm: 73.116, rotation: 0, pole: [40.66, 83.52], w0: 357.6, albedo: 0.7, temp: 87, surface: { palette: [c(0.45, 0.45, 0.45), c(0.66, 0.66, 0.66), c(0.8, 0.8, 0.8), c(0.93, 0.93, 0.93)], iceCap: 1, relief: 3500, craters: 0.8 }, atmosphere: null, blurb: 'An icy moon streaked with bright cliffs of fractured ice.' },
  { key: 'rhea', name: 'Rhea', parent: 'saturn', type: 'ice', radius: 763.5, gm: 153.94, rotation: 0, pole: [40.38, 83.55], w0: 235.16, albedo: 0.65, temp: 76, surface: { palette: [c(0.45, 0.44, 0.43), c(0.64, 0.63, 0.62), c(0.78, 0.78, 0.77), c(0.92, 0.92, 0.92)], iceCap: 1, relief: 4000, craters: 1 }, atmosphere: null, blurb: 'Saturn’s second-largest moon: a heavily cratered world of ice.' },
  {
    key: 'titan', name: 'Titan', parent: 'saturn', type: 'ice', radius: 2574.76, gm: 8978.137, rotation: 0, pole: [39.4827, 83.4279], w0: 186.5855, albedo: 0.22, temp: 94,
    surface: { palette: [c(0.2, 0.13, 0.06), c(0.42, 0.3, 0.14), c(0.55, 0.42, 0.22), c(0.7, 0.6, 0.4)], oceanLevel: 0.12, oceanColor: c(0.05, 0.04, 0.02), iceCap: 0, clouds: 0.85, cloudColor: c(0.85, 0.6, 0.25), relief: 2000, craters: 0.02 },
    atmosphere: { pressure: 1.45, scaleHeight: 21000, rayleigh: c(0.95, 0.62, 0.25), density: 2.2, mie: 1.6, mieColor: c(0.95, 0.65, 0.3), composition: 'Nitrogen, methane' },
    blurb: 'The only moon with a thick atmosphere — and lakes of liquid methane.',
  },
  { key: 'iapetus', name: 'Iapetus', parent: 'saturn', type: 'ice', radius: 734.4, gm: 120.52, rotation: 0, pole: [318.16, 75.03], w0: 355.2, albedo: 0.3, temp: 110, surface: { palette: [c(0.07, 0.05, 0.04), c(0.3, 0.26, 0.22), c(0.7, 0.68, 0.64), c(0.92, 0.92, 0.9)], iceCap: 0.5, relief: 13000, craters: 0.9 }, atmosphere: null, blurb: 'The two-faced moon: one side bright as snow, the other dark as coal.' },
  { key: 'miranda', name: 'Miranda', parent: 'uranus', type: 'ice', radius: 235.8, gm: 4.3, rotation: 0, pole: [257.43, -15.08], w0: 30.7, albedo: 0.32, temp: 60, surface: { palette: [c(0.3, 0.3, 0.3), c(0.5, 0.5, 0.5), c(0.66, 0.66, 0.66), c(0.85, 0.85, 0.85)], iceCap: 1, relief: 20000, craters: 0.5 }, atmosphere: null, blurb: 'A patchwork moon with the tallest cliffs in the Solar System.' },
  { key: 'ariel', name: 'Ariel', parent: 'uranus', type: 'ice', radius: 578.9, gm: 83.43, rotation: 0, pole: [257.43, -15.1], w0: 156.22, albedo: 0.53, temp: 60, surface: { palette: [c(0.35, 0.35, 0.36), c(0.55, 0.55, 0.56), c(0.7, 0.7, 0.71), c(0.88, 0.88, 0.9)], iceCap: 1, relief: 5000, craters: 0.4 }, atmosphere: null, blurb: 'The brightest moon of Uranus, cut by long canyons.' },
  { key: 'umbriel', name: 'Umbriel', parent: 'uranus', type: 'ice', radius: 584.7, gm: 85.09, rotation: 0, pole: [257.43, -15.1], w0: 108.05, albedo: 0.26, temp: 75, surface: { palette: [c(0.12, 0.12, 0.13), c(0.24, 0.24, 0.25), c(0.34, 0.34, 0.35), c(0.6, 0.6, 0.62)], iceCap: 0, relief: 4000, craters: 1 }, atmosphere: null, blurb: 'The darkest of Uranus’s large moons, old and battered.' },
  { key: 'titania', name: 'Titania', parent: 'uranus', type: 'ice', radius: 788.9, gm: 226.9, rotation: 0, pole: [257.43, -15.1], w0: 77.74, albedo: 0.35, temp: 70, surface: { palette: [c(0.25, 0.24, 0.24), c(0.42, 0.41, 0.4), c(0.58, 0.57, 0.56), c(0.82, 0.82, 0.82)], iceCap: 0.5, relief: 5000, craters: 0.7 }, atmosphere: null, blurb: 'The largest moon of Uranus, a mix of rock and ice.' },
  { key: 'oberon', name: 'Oberon', parent: 'uranus', type: 'ice', radius: 761.4, gm: 205.3, rotation: 0, pole: [257.43, -15.1], w0: 6.77, albedo: 0.31, temp: 75, surface: { palette: [c(0.2, 0.18, 0.17), c(0.38, 0.35, 0.33), c(0.52, 0.5, 0.48), c(0.8, 0.8, 0.8)], iceCap: 0.3, relief: 6000, craters: 1 }, atmosphere: null, blurb: 'The outermost big moon of Uranus, dark and cratered.' },
  {
    key: 'triton', name: 'Triton', parent: 'neptune', type: 'ice', radius: 1352.6, gm: 1428.495, rotation: 0, pole: [299.36, 41.17], w0: 296.53, albedo: 0.76, temp: 38,
    surface: { palette: [c(0.5, 0.42, 0.4), c(0.74, 0.68, 0.66), c(0.86, 0.84, 0.84), c(0.96, 0.95, 0.96)], iceCap: 1, relief: 1500, craters: 0.05 },
    atmosphere: { pressure: 0.000014, scaleHeight: 14800, rayleigh: c(0.5, 0.65, 1), density: 0.08, mie: 0.1, mieColor: c(1, 1, 1), composition: 'Nitrogen' },
    blurb: 'A captured world orbiting backwards, with geysers of nitrogen.',
  },
  { key: 'charon', name: 'Charon', parent: 'pluto', type: 'ice', radius: 606, gm: 105.88, rotation: 0, pole: [132.993, -6.163], w0: 122.695, albedo: 0.38, temp: 53, surface: { palette: [c(0.3, 0.2, 0.18), c(0.45, 0.44, 0.44), c(0.6, 0.6, 0.6), c(0.8, 0.8, 0.8)], iceCap: 0.2, relief: 9000, craters: 0.6 }, atmosphere: null, blurb: 'Pluto’s giant moon — half its size, locked face to face with it.' },
];

/** One-line descriptions of Solar System bodies, by body id. */
export const SOL_BLURBS: Record<string, string> = { 'sol:sun': 'Our star: a middle-aged yellow dwarf that holds the whole Solar System together.' };

let cached: SystemModel | null = null;

/** Build (once) the model of the real Solar System. */
export function solarSystem(): SystemModel {
  if (cached) return cached;
  const sunProps = makeStar(4.67, 5772, 'main', 0x501, false);
  Object.assign(sunProps, { spectral: 'G2V', mass: M_SUN, radius: R_SUN, luminosity: L_SUN, teff: 5772, ageGyr: 4.57, rotationPeriod: 25.38 * DAY });
  const sun: StarBody = {
    kind: 'star', id: 'sol:sun', name: 'Sun', seed: 0x501, parent: -1, orbit: null, mass: M_SUN, radius: R_SUN,
    axis: icrsToEcliptic(raDecToUnit(286.13, 63.87)), rotationPeriod: 25.38 * DAY, rotationPhase: 84.176 * DEG, real: true, star: sunProps,
  };
  const bodies: Body[] = [sun];
  const indexOf = new Map<string, number>();
  for (const spec of BODIES) {
    const el = ELEMENTS[spec.key];
    if (!el) throw new Error(`No orbital elements for ${spec.key}`);
    const parent = spec.parent === null ? 0 : indexOf.get(spec.parent)!;
    const id = `sol:${spec.key}`;
    const helio = spec.parent === null ? el.a / AU : (ELEMENTS[spec.parent]?.a ?? AU) / AU;
    const p = makePlanet({
      id, name: spec.name, seed: 0x5000 + bodies.length, kind: spec.parent === null ? 'planet' : 'moon', parent,
      mass: (spec.gm * 1e9) / G, radius: spec.radius * 1000, lumSun: 1, aStarAu: helio, beyondSnowLine: helio > 2.7, inHz: spec.key === 'earth' || spec.key === 'moon', type: spec.type, real: true, allowRings: false,
    });
    p.orbit = { ...el };
    p.albedo = spec.albedo;
    p.tSurface = spec.temp;
    p.axis = icrsToEcliptic(raDecToUnit(spec.pole[0], spec.pole[1]));
    // Synchronous moons rotate once per orbit; the prime-meridian angle gives the phase at J2000.
    p.rotationPeriod = spec.rotation === 0 ? el.period * (el.i > Math.PI / 2 ? -1 : 1) : spec.rotation * DAY;
    p.rotationPhase = spec.w0 * DEG;
    p.surface = { ...p.surface, ...spec.surface, seed: p.surface.seed };
    if (spec.atmosphere === null) p.atmosphere = null;
    else if (spec.atmosphere) p.atmosphere = { ...(p.atmosphere ?? { pressure: 1, scaleHeight: 8000, rayleigh: [0.3, 0.5, 1], density: 1, mie: 0.1, mieColor: [1, 1, 1], composition: '' }), ...spec.atmosphere };
    p.rings = spec.rings ? { ...spec.rings, seed: 0x4100 + bodies.length } : null;
    p.aurora = spec.aurora ?? 0;
    p.habitableZone = spec.key === 'earth';
    p.notes = {};
    const s = p.surface;
    p.color = spec.type === 'ocean' ? [0.2, 0.32, 0.5] : [(s.palette[1][0] + s.palette[2][0]) / 2, (s.palette[1][1] + s.palette[2][1]) / 2, (s.palette[1][2] + s.palette[2][2]) / 2];
    SOL_BLURBS[id] = spec.blurb;
    indexOf.set(spec.key, bodies.length);
    bodies.push(p as PlanetBody);
  }
  const belts: BeltProps[] = [
    { id: 'sol:asteroid-belt', name: 'Asteroid belt', parent: 0, inner: 2.1 * AU, outer: 3.3 * AU, thickness: 0.09, count: 4000, seed: 0xa57, color: [0.5, 0.46, 0.42] },
    { id: 'sol:kuiper-belt', name: 'Kuiper belt', parent: 0, inner: 39 * AU, outer: 48 * AU, thickness: 0.13, count: 4000, seed: 0xc01, color: [0.6, 0.64, 0.7] },
  ];
  cached = { id: 'sol', name: 'Solar System', seed: 0x501, origin: uposZero(), basis: ECLIPTIC_BASIS, bodies, belts, extent: 50 * AU, hzInner: 0.95 * AU, hzOuter: 1.68 * AU, real: true };
  return cached;
}
