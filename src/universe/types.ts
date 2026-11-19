/**
 * Shared vocabulary of the universe model. Everything here is plain data
 * produced by pure generator functions — no rendering types.
 */
import type { OrbitElements } from '../core/astro';
import type { RGB } from '../core/color';
import type { UPos } from '../core/hp';
import type { Mat3, V3 } from '../core/math';

// --------------------------------------------------------------------- galaxies

export type GalaxyType = 'spiral' | 'barred' | 'elliptical' | 'lenticular' | 'irregular' | 'dwarf' | 'ring';

/** Minimal description of a galaxy as it appears in a point cloud (real or procedural). */
export interface GalaxyStub {
  /** Stable id, e.g. "g:3:12:-4:7:5" (procedural) or "2masx:J00424433+4116074" (catalog). */
  id: string;
  /** Position relative to the chunk anchor, megaparsecs. */
  x: number;
  y: number;
  z: number;
  /** r-band-like absolute magnitude. */
  absMag: number;
  seed: number;
}

/** Real-catalogue hints that constrain a galaxy's procedural model. */
export interface GalaxyHints {
  name?: string;
  /** Morphology class code (see data/format/schema Morph), 0 = unknown. */
  morph?: number;
  /** Catalogued Hubble type (e.g. "SABc"), shown as is; a leading SB / SAB also gives the model its bar. */
  hubbleClass?: string;
  /** Colour index (g−r for SDSS, J−K for 2MRS) and which one it is. */
  color?: number | null;
  colorBand?: 'gr' | 'jk';
  /** Major-axis diameter in kiloparsecs. */
  diameterKpc?: number | null;
  /** Projected axis ratio b/a and position angle (degrees east of north) as seen from the Sun. */
  axisRatio?: number | null;
  positionAngle?: number | null;
  /** Unit vector from the Sun to the galaxy (needed to turn axis ratio / PA into a 3D orientation). */
  lineOfSight?: V3;
  agn?: boolean;
  starburst?: boolean;
  quasar?: boolean;
  /** Measured central black-hole mass (solar masses) and jet flag from curated notes. */
  smbhMassSun?: number;
  jet?: boolean;
  real: boolean;
}

/** Full procedural model of one galaxy. Lengths in kiloparsecs unless noted. */
export interface GalaxyModel {
  id: string;
  name: string;
  seed: number;
  type: GalaxyType;
  /** Human-readable Hubble-style class, e.g. "SBbc". */
  hubble: string;
  real: boolean;
  absMag: number;
  /** Approximate number of stars. */
  starCount: number;
  /** Stellar mass in solar masses. */
  massSun: number;
  /** Visible radius (≈ 4.5 disc scale lengths, or 3 effective radii). */
  radius: number;
  /** Disc exponential scale length and scale height. */
  hR: number;
  hz: number;
  /** Bulge / spheroid core radius, flattening and luminosity fraction. */
  bulgeR: number;
  bulgeQ: number;
  bulgeFrac: number;
  /** Spiral structure: number of arms, pitch angle (rad), phase (rad), contrast 0–1, bar half-length. */
  arms: number;
  pitch: number;
  armPhase: number;
  armContrast: number;
  barLength: number;
  /** Ring radius (ring galaxies) or 0. */
  ringR: number;
  /** Dust lane strength 0–1 and patchiness (irregulars) 0–1. */
  dust: number;
  clumpiness: number;
  /** Tidal distortion 0–1 (interacting systems) and companion offset in galaxy radii. */
  tidal: number;
  companion: { offset: V3; sizeRatio: number; seed: number } | null;
  /** Linear RGB colours of the old (bulge) and young (arm) stellar populations. */
  colorOld: RGB;
  colorYoung: RGB;
  /** Rotation from galaxy-local axes (z = disc normal) to world axes; rows are local x, y, z in world coords. */
  basis: Mat3;
  /** Central supermassive black hole. */
  smbhMassSun: number;
  /** Activity: 0 quiet … 1 quasar. */
  activity: number;
  jet: boolean;
  /** Stellar density normalisation: stars per cubic parsec, per unit of `densityAt`. */
  density0: number;
}

// ------------------------------------------------------------------------ stars

export type StarType = 'main' | 'subgiant' | 'giant' | 'supergiant' | 'whitedwarf' | 'neutron' | 'pulsar' | 'blackhole' | 'browndwarf';

/** A star as it appears in a point cloud. */
export interface StarStub {
  id: string;
  /** Position relative to the chunk anchor, parsecs. */
  x: number;
  y: number;
  z: number;
  /** Absolute G-band magnitude. */
  absMag: number;
  teff: number;
  type: StarType;
  seed: number;
}

export interface StarProps {
  type: StarType;
  /** Spectral class such as "G2V", "K3III", "DA", "Pulsar". */
  spectral: string;
  teff: number;
  /** SI units. */
  mass: number;
  radius: number;
  luminosity: number;
  absMag: number;
  /** Linear RGB tint. */
  color: RGB;
  ageGyr: number;
  /** Rotation period, seconds (pulsars: spin period). */
  rotationPeriod: number;
  /** Pulsar / neutron-star magnetic field (tesla) or 0. */
  magneticField: number;
  /** Black holes: Schwarzschild radius in metres (also stored in `radius`). */
  schwarzschildRadius: number;
  /** Accretion activity 0–1 for compact objects. */
  accretion: number;
  /** Which values are measured vs. inferred, for honest labelling in the data overlay. */
  estimated: boolean;
}

// ---------------------------------------------------------------------- planets

export type PlanetType = 'rocky' | 'desert' | 'ocean' | 'ice' | 'lava' | 'gasgiant' | 'icegiant';

export interface AtmosphereProps {
  /** Surface pressure in bars (gas giants: 1-bar level). */
  pressure: number;
  /** Scale height in metres. */
  scaleHeight: number;
  /** Rayleigh scattering colour (linear RGB, relative strengths) and overall density factor. */
  rayleigh: RGB;
  density: number;
  /** Mie (haze/dust) strength and tint. */
  mie: number;
  mieColor: RGB;
  /** Plain-language composition, e.g. "Nitrogen, oxygen". */
  composition: string;
}

export interface RingProps {
  /** Inner / outer radius in metres. */
  inner: number;
  outer: number;
  color: RGB;
  opacity: number;
  seed: number;
}

export interface SurfaceProps {
  /** Terrain relief: highest − lowest elevation in metres. */
  relief: number;
  /** Fraction of the surface below sea level (0 = no ocean). */
  oceanLevel: number;
  /** Liquid colour (water, methane, lava…). */
  oceanColor: RGB;
  /** Biome palette: low / mid / high / peak ground colours. */
  palette: [RGB, RGB, RGB, RGB];
  /** Polar ice cap extent 0–1 (fraction of latitude range). */
  iceCap: number;
  /** Cloud cover 0–1 and tint. */
  clouds: number;
  cloudColor: RGB;
  /** Vegetation strength 0–1 (tints temperate lowlands). */
  vegetation: number;
  /** Glowing lava / night-side emission 0–1. */
  emission: number;
  emissionColor: RGB;
  /** Gas giants: band count, band contrast, storm count. */
  bands: number;
  bandContrast: number;
  storms: number;
  /** Crater density 0–1 for airless bodies. */
  craters: number;
  /** Noise layout seed and continent frequency. */
  seed: number;
  continentScale: number;
  /** Optional real albedo / height maps (Solar System bodies). */
  textureKey?: string;
}

export interface BodyBase {
  id: string;
  name: string;
  seed: number;
  /** Index of the parent body in `SystemModel.bodies` (−1 = orbits the system barycentre / is the primary). */
  parent: number;
  /** Orbit around the parent, expressed in the system frame. Null for the primary at the barycentre. */
  orbit: OrbitElements | null;
  /** SI units. */
  mass: number;
  radius: number;
  /** Spin axis in the system frame, sidereal rotation period (s; negative = retrograde) and phase at J2000 (rad). */
  axis: V3;
  rotationPeriod: number;
  rotationPhase: number;
  /** True if catalogued (real star / Solar System body / confirmed exoplanet). */
  real: boolean;
}

export interface StarBody extends BodyBase {
  kind: 'star';
  star: StarProps;
}

export interface PlanetBody extends BodyBase {
  kind: 'planet' | 'moon';
  type: PlanetType;
  /** Equilibrium temperature and estimated mean surface temperature, kelvin. */
  teq: number;
  tSurface: number;
  /** Surface gravity m/s². */
  gravity: number;
  /** Bond albedo. */
  albedo: number;
  /** Mean day-side colour (linear RGB) used when the body is a few pixels across. */
  color: RGB;
  atmosphere: AtmosphereProps | null;
  rings: RingProps | null;
  surface: SurfaceProps;
  /** In the star's liquid-water habitable zone? */
  habitableZone: boolean;
  /** Aurora strength 0–1. */
  aurora: number;
  /** Extra facts for the info card (discovery method, year, what is estimated…). */
  notes: Record<string, string | number>;
}

export type Body = StarBody | PlanetBody;

export interface BeltProps {
  id: string;
  name: string;
  /** Index of the body the belt orbits. */
  parent: number;
  inner: number;
  outer: number;
  /** Vertical thickness as a fraction of radius. */
  thickness: number;
  count: number;
  seed: number;
  color: RGB;
}

export interface SystemModel {
  /** Stable id of the system = id of its primary star (or catalogue host). */
  id: string;
  name: string;
  seed: number;
  /** Barycentre position in the universe. */
  origin: UPos;
  /** Rotation from system-frame axes (z = orbital-plane normal) to world axes. */
  basis: Mat3;
  bodies: Body[];
  belts: BeltProps[];
  /** Radius that encloses the whole system (outermost orbit), metres. */
  extent: number;
  /** Habitable-zone inner / outer edge around the primary, metres. */
  hzInner: number;
  hzOuter: number;
  real: boolean;
}

/** Anything the player can select, bookmark or fly to. */
export type ObjectKind = 'galaxy' | 'quasar' | 'star' | 'planet' | 'moon' | 'nebula' | 'cluster' | 'pulsar' | 'blackhole' | 'belt' | 'structure';

export interface ObjectRef {
  id: string;
  kind: ObjectKind;
  name: string;
  /** Position (for moving bodies: the system origin; `bodyIndex` then identifies the body). */
  pos: UPos;
  /** Physical radius in metres, used for framing the camera on arrival. */
  radius: number;
  /** For bodies inside a star system. */
  systemId?: string;
  bodyIndex?: number;
  real: boolean;
}
