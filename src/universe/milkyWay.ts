/**
 * The Milky Way: the one galaxy whose model is hand-set from measurements
 * rather than generated. It is "just another galaxy" to the rest of the
 * engine — a GalaxyModel with a known centre and orientation — which is what
 * lets real stars near the Sun blend into procedural stars everywhere else.
 *
 * Sources: distance to the Galactic Centre R₀ = 8277 pc (GRAVITY Collaboration
 * 2022); Sgr A* mass 4.297e6 M☉ (same); disc scale length ≈ 2.6–3 kpc and
 * four-arm barred spiral structure (Bland-Hawthorn & Gerhard 2016, Reid et al.
 * 2019); Sun ≈ 21 pc above the mid-plane (Bennett & Bovy 2019).
 */
import { GAL_TO_ICRS, raDecToUnit } from '../core/astro';
import { blackbodyLinear } from '../core/color';
import { type UPos, uposFromMeters } from '../core/hp';
import type { Mat3 } from '../core/math';
import { KPC, PC } from '../core/units';
import type { CatalogSuppression } from './starfield';
import type { GalaxyModel } from './types';

/** Distance from the Sun to the Galactic Centre, parsecs. */
export const R0_PC = 8277;
/** Sagittarius A* (ICRS). */
const SGR_A = raDecToUnit(266.41684, -29.00781);

/** Universe position of the Galactic Centre. */
export const MILKY_WAY_CENTER: UPos = uposFromMeters(SGR_A.x * R0_PC * PC, SGR_A.y * R0_PC * PC, SGR_A.z * R0_PC * PC);

/**
 * Galaxy-local axes in ICRS: x points from the Galactic Centre away from… the
 * Sun-to-centre direction (so the Sun sits at x ≈ −R₀), y along Galactic
 * rotation (l = 90°), z to the north Galactic pole.
 */
const BASIS: Mat3 = [
  GAL_TO_ICRS[0], GAL_TO_ICRS[3], GAL_TO_ICRS[6],
  GAL_TO_ICRS[1], GAL_TO_ICRS[4], GAL_TO_ICRS[7],
  GAL_TO_ICRS[2], GAL_TO_ICRS[5], GAL_TO_ICRS[8],
];

const HR = 2.9;
const HZ = 0.3;
const RADIUS = 17;
const BULGE_FRAC = 0.16;
const BULGE_R = 0.55;
const BULGE_Q = 0.6;
const STAR_COUNT = 1.2e11;
const PITCH = 12.8 * (Math.PI / 180);
const BAR = 4.5;
const ARMS = 4;

/** Sun position in galaxy-local parsecs: (−R₀ projected, 0, +z☉) from the Sgr A* direction. */
function sunLocalPc(): [number, number, number] {
  // Vector from the centre to the Sun in ICRS = −SgrA·R₀; express it in the galaxy-local basis.
  const v = { x: -SGR_A.x * R0_PC, y: -SGR_A.y * R0_PC, z: -SGR_A.z * R0_PC };
  return [
    BASIS[0] * v.x + BASIS[1] * v.y + BASIS[2] * v.z,
    BASIS[3] * v.x + BASIS[4] * v.y + BASIS[5] * v.z,
    BASIS[6] * v.x + BASIS[7] * v.y + BASIS[8] * v.z,
  ];
}

export const SUN_LOCAL_PC = sunLocalPc();

/**
 * Arm phase chosen so that, at the Sun's azimuth, an arm crosses at R = 7 kpc
 * (Sagittarius–Carina) and the next one out at ≈ 10 kpc (Perseus), leaving the
 * Sun in the inter-arm gap where it really is.
 */
function armPhase(): number {
  const sunAz = Math.atan2(SUN_LOCAL_PC[1], SUN_LOCAL_PC[0]);
  const r0 = BAR;
  // armAngle(R) = phase + ln(R / r0) / tan(pitch)  ⇒  phase = sunAz − ln(7 / r0) / tan(pitch)
  return sunAz - Math.log(7 / r0) / Math.tan(PITCH);
}

export const MILKY_WAY: GalaxyModel = {
  id: 'mw',
  name: 'Milky Way',
  seed: 0x4d57,
  type: 'barred',
  hubble: 'SBbc',
  real: true,
  absMag: -20.9,
  starCount: STAR_COUNT,
  massSun: 5.4e10,
  radius: RADIUS,
  hR: HR,
  hz: HZ,
  bulgeR: BULGE_R,
  bulgeQ: BULGE_Q,
  bulgeFrac: BULGE_FRAC,
  arms: ARMS,
  pitch: PITCH,
  armPhase: armPhase(),
  armContrast: 0.8,
  barLength: BAR,
  ringR: 0,
  dust: 0.85,
  clumpiness: 0.25,
  tidal: 0,
  companion: null,
  colorOld: blackbodyLinear(4600, 1.35),
  colorYoung: blackbodyLinear(11000, 1.3),
  basis: BASIS,
  smbhMassSun: 4.297e6,
  activity: 0.02,
  jet: false,
  density0: (STAR_COUNT * (1 - BULGE_FRAC)) / (4 * Math.PI * HR * HR * HZ * 1e9),
};

/** Catalogue completeness around the Sun, in the Milky Way's local frame (limits come from the data manifest). */
export function milkyWaySuppression(gLimit: number, nearRadiusPc: number): CatalogSuppression {
  return { sunX: SUN_LOCAL_PC[0], sunY: SUN_LOCAL_PC[1], sunZ: SUN_LOCAL_PC[2], gLimit, nearRadius: nearRadiusPc };
}

export const MILKY_WAY_RADIUS_M = RADIUS * KPC;
