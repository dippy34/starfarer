/**
 * Galaxy models: turn a seed + luminosity (and optional real-catalogue hints)
 * into a full structural description, and evaluate the stellar density that
 * both the star-field generator (CPU) and the volumetric shader (GPU, same
 * formulas) are built on.
 *
 * Pure and deterministic: uses only seeded RNG and the arithmetic-only dmath.
 */
import { blackbodyLinear, type RGB } from '../core/color';
import { datan2, dcos, dexp, dlog, dpow, dsin } from '../core/dmath';
import { hashCombine, hashToUnit } from '../core/hash';
import { type Mat3, type V3, basisFromZX, vCross, vDot, vNorm, vScale, vAdd, vPerp } from '../core/math';
import { Noise3 } from '../core/noise';
import { Rng } from '../core/rng';
import { Morph } from '../data/format/schema';
import type { GalaxyHints, GalaxyModel, GalaxyType } from './types';
import { galaxyName } from './names';

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function pickType(rng: Rng, absMag: number, hints: GalaxyHints): GalaxyType {
  switch (hints.morph ?? Morph.Unknown) {
    case Morph.E:
      return 'elliptical';
    case Morph.S0:
      return 'lenticular';
    case Morph.Sa:
    case Morph.Sb:
    case Morph.Sc:
    case Morph.Sd:
    {
      // The bar is in the catalogued class when there is one (SB…, SAB…); otherwise seeded.
      const seeded = rng.chance(0.45);
      const known = hints.hubbleClass ? /^SA?B/.test(hints.hubbleClass) : null;
      return (known ?? seeded) ? 'barred' : 'spiral';
    }
    case Morph.Irr:
    case Morph.Peculiar:
    case Morph.DwarfIrr: // Magellanic irregulars (the Clouds, NGC 6822…): small, but gas-rich clumpy discs, not spheroids
      return 'irregular';
    case Morph.DwarfE:
      return 'dwarf';
    default:
      break;
  }
  // Real colour separates the red sequence from the blue cloud.
  let red = 0.5;
  if (hints.color !== undefined && hints.color !== null) {
    red = hints.colorBand === 'jk' ? (hints.color > 1.0 ? 0.6 : 0.4) : hints.color > 0.72 ? 0.9 : hints.color > 0.6 ? 0.5 : 0.08;
  }
  const u = rng.next();
  if (absMag < -22.5) return u < 0.25 + 0.6 * red ? 'elliptical' : u < 0.4 + 0.55 * red ? 'lenticular' : rng.chance(0.5) ? 'barred' : 'spiral';
  if (absMag < -19.5) {
    if (u < 0.34 * red * 2) return rng.chance(0.6) ? 'elliptical' : 'lenticular';
    if (u > 0.97) return 'ring';
    if (u > 0.9) return 'irregular';
    return rng.chance(0.5) ? 'barred' : 'spiral';
  }
  if (absMag < -17) {
    if (u < 0.3 * red * 2) return rng.chance(0.5) ? 'dwarf' : 'lenticular';
    if (u > 0.7) return 'irregular';
    return rng.chance(0.4) ? 'barred' : 'spiral';
  }
  return u < 0.25 + 0.5 * red ? 'dwarf' : 'irregular';
}

/** Orientation of a disc from its projected axis ratio and position angle as seen from the Sun. */
function basisFromSkyShape(rng: Rng, los: V3, q: number, paDeg: number | null | undefined, intrinsicQ: number): Mat3 {
  const cos2 = Math.max(0, (q * q - intrinsicQ * intrinsicQ) / (1 - intrinsicQ * intrinsicQ));
  const cosI = Math.sqrt(Math.min(1, cos2));
  const sinI = Math.sqrt(1 - cosI * cosI);
  // Sky-plane axes at the galaxy: north and east.
  let north = vAdd({ x: 0, y: 0, z: 1 }, vScale(los, -los.z));
  north = vDot(north, north) < 1e-12 ? vPerp(los) : vNorm(north);
  const eastRaw = vCross({ x: 0, y: 0, z: 1 }, los);
  const east = vDot(eastRaw, eastRaw) < 1e-12 ? vCross(los, north) : vNorm(eastRaw);
  const pa = ((paDeg ?? rng.range(0, 180)) * Math.PI) / 180;
  const major = vAdd(vScale(north, dcos(pa)), vScale(east, dsin(pa)));
  const minor = vCross(los, major);
  // Which side is tilted toward us is not observable from the axis ratio: seeded choice.
  const sign = rng.chance(0.5) ? 1 : -1;
  const normal = vNorm(vAdd(vScale(los, -cosI), vScale(minor, sign * sinI)));
  return basisFromZX(normal, major);
}

function randomBasis(rng: Rng): Mat3 {
  const [zx, zy, zz] = rng.unitVector();
  const [hx, hy, hz] = rng.unitVector();
  return basisFromZX({ x: zx, y: zy, z: zz }, { x: hx, y: hy, z: hz });
}

/** Build the full model of a galaxy. `seed` must come from the galaxy's stable id or cell hash. */
export function makeGalaxy(id: string, seed: number, totalMag: number, hints: GalaxyHints = { real: false }): GalaxyModel {
  const rng = new Rng(hashCombine(seed, 0x6a1a));
  // A catalogued quasar's brightness is its nucleus, which can outshine the galaxy around it a
  // hundredfold. The host is modelled as what quasar hosts are — a massive but ordinary galaxy —
  // and everything structural below (size, mass, star count) follows the host, not the beacon.
  const absMag = hints.real && hints.quasar ? Math.max(totalMag, -23.2 + 1.4 * hashToUnit(hashCombine(seed, 0x4057))) : totalMag;
  const type = pickType(rng, absMag, hints);
  const isDisc = type === 'spiral' || type === 'barred' || type === 'lenticular' || type === 'ring' || type === 'irregular';

  // Size–luminosity relations (disc scale length / effective radius in kpc) with log-normal scatter.
  const scatter = dexp(rng.normal(0, 0.3));
  let hR: number;
  let radius: number;
  if (type === 'elliptical') {
    const re = 4.2 * dpow(10, -0.22 * (absMag + 21.5)) * scatter;
    hR = re;
    radius = re * 4.5;
  } else if (type === 'dwarf') {
    hR = Math.max(0.12, 0.9 * dpow(10, -0.12 * (absMag + 16)) * scatter);
    radius = hR * 3.5;
  } else {
    hR = Math.max(0.25, 3.0 * dpow(10, -0.133 * (absMag + 21)) * scatter);
    radius = hR * 4.6;
  }
  // (A quasar's catalogued "extent" is the glare of its nucleus, not the size of its host.)
  if (hints.diameterKpc && hints.diameterKpc > 0.2 && !(hints.real && hints.quasar)) {
    radius = Math.min(150, (hints.diameterKpc / 2) * 1.15);
    hR = radius / (type === 'elliptical' ? 4.5 : type === 'dwarf' ? 3.5 : 4.6);
  }

  const bulgeFrac =
    type === 'elliptical' || type === 'dwarf' ? 1 : type === 'lenticular' ? rng.range(0.35, 0.6) : type === 'irregular' ? rng.range(0, 0.05) : type === 'ring' ? rng.range(0.15, 0.3) : rng.range(0.05, 0.35);
  const flatten = type === 'elliptical' ? rng.range(0.45, 1) : type === 'dwarf' ? rng.range(0.5, 1) : rng.range(0.55, 0.8);
  const arms = type === 'spiral' || type === 'barred' ? (rng.chance(0.62) ? 2 : rng.chance(0.6) ? 4 : 3) : 0;
  // Bulge-dominated spirals are tightly wound (Sa), disc-dominated ones open (Sc/Sd).
  const pitch = arms ? (10 + (0.35 - bulgeFrac) * 45 + rng.range(-3, 5)) * (Math.PI / 180) : 0;

  let basis: Mat3;
  if (hints.lineOfSight && hints.axisRatio !== undefined && hints.axisRatio !== null) {
    basis = basisFromSkyShape(rng, hints.lineOfSight, Math.max(0.1, Math.min(1, hints.axisRatio)), hints.positionAngle, isDisc ? 0.2 : 0.99);
  } else {
    basis = randomBasis(rng);
  }

  // Stellar populations: old = warm yellow, young = blue-white; red-sequence galaxies have no young blue arms.
  const quenched = type === 'elliptical' || type === 'lenticular' || type === 'dwarf' || (hints.colorBand === 'gr' && (hints.color ?? 0) > 0.75);
  const colorOld = blackbodyLinear(rng.range(4200, 5000), 1.35);
  const blue = blackbodyLinear(rng.range(8500, 13000), 1.3);
  const colorYoung = quenched ? mix(colorOld, blue, 0.12) : hints.starburst ? blue : mix(colorOld, blue, rng.range(0.7, 1));

  // Stellar mass and star count from luminosity (r-band M/L ≈ 1.2 blue … 3 red).
  const lum = dpow(10, -0.4 * (absMag - 4.65));
  const massSun = lum * (quenched ? 3 : 1.4);
  const starCount = massSun / 0.45;

  // Central black hole: follows the bulge mass with scatter, unless measured.
  const interacting = !hints.real && absMag < -18.5 && type !== 'dwarf' && rng.chance(0.07);
  let activity = 0;
  const roll = rng.next();
  if (absMag < -19.5) activity = roll < 0.004 ? rng.range(0.8, 1) : roll < 0.07 ? rng.range(0.25, 0.6) : roll < 0.3 ? rng.range(0.02, 0.15) : 0;
  if (hints.agn) activity = Math.max(activity, rng.range(0.3, 0.6));
  if (hints.quasar) activity = rng.range(0.85, 1);
  const smbhMassSun = hints.smbhMassSun ?? Math.max(1e4, 2e-3 * Math.max(bulgeFrac, 0.02) * massSun * dexp(rng.normal(0, 0.7)) * (hints.quasar ? 8 : 1));
  const jet = hints.jet ?? (activity > 0.5 ? rng.chance(0.6) : activity > 0.2 ? rng.chance(0.15) : false);

  const hz = isDisc ? hR * (type === 'irregular' ? rng.range(0.18, 0.3) : rng.range(0.08, 0.14)) : hR * flatten;
  const bulgeR = bulgeFrac >= 1 ? hR * 0.55 : hR * rng.range(0.14, 0.26);
  const discStars = starCount * (1 - bulgeFrac);
  // density0 [stars / pc³] such that the exponential disc integrates to its star count (kpc³ → 1e9 pc³).
  const density0 = bulgeFrac >= 1 ? starCount / ((4 / 3) * Math.PI * bulgeR * bulgeR * bulgeR * flatten * 1e9) : discStars / (4 * Math.PI * hR * hR * hz * 1e9);

  const sub = arms ? (bulgeFrac > 0.25 ? 'a' : bulgeFrac > 0.14 ? 'b' : bulgeFrac > 0.07 ? 'c' : 'd') : '';
  const hubble =
    hints.hubbleClass ? hints.hubbleClass : type === 'elliptical' ? `E${Math.round((1 - flatten) * 10)}` : type === 'lenticular' ? 'S0' : type === 'barred' ? `SB${sub}` : type === 'spiral' ? `S${sub}` : type === 'irregular' ? 'Irr' : type === 'ring' ? 'Ring' : absMag > -13 ? 'dSph' : 'dE';

  let companion: GalaxyModel['companion'] = null;
  if (interacting) {
    const [cx, cy, cz] = rng.unitVector();
    companion = { offset: { x: cx * rng.range(1.1, 2.2), y: cy * rng.range(1.1, 2.2), z: cz * 0.5 }, sizeRatio: rng.range(0.3, 0.8), seed: rng.u32() };
  }

  return {
    id, seed, type, hubble, real: hints.real, absMag: totalMag, starCount, massSun, radius, hR, hz, bulgeR, bulgeQ: flatten, bulgeFrac,
    name: hints.name ?? galaxyName(seed),
    arms, pitch, armPhase: rng.range(0, 2 * Math.PI), armContrast: arms ? (quenched ? rng.range(0.15, 0.35) : rng.range(0.55, 0.95)) : 0,
    barLength: type === 'barred' ? hR * rng.range(0.6, 1.3) : 0,
    ringR: type === 'ring' ? hR * rng.range(2.2, 3.2) : 0,
    dust: type === 'elliptical' || type === 'dwarf' ? 0 : type === 'lenticular' ? rng.range(0.05, 0.25) : rng.range(0.45, 0.95),
    clumpiness: type === 'irregular' ? rng.range(0.6, 1) : hints.starburst ? 0.5 : rng.range(0.1, 0.35),
    tidal: interacting ? rng.range(0.4, 1) : 0,
    companion, colorOld, colorYoung, basis, smbhMassSun, activity, jet, density0,
  };
}

/** Stellar population classes used by the star-field generator. */
export const POP_YOUNG = 0;
export const POP_MID = 1;
export const POP_OLD = 2;
const POP_HZ = [0.25, 0.7, 1.15];
const POP_ARM = [1.0, 0.5, 0.18];
const POP_BULGE = [0.03, 0.5, 1.25];

const noiseCache = new Map<number, Noise3>();
function clumpNoise(seed: number): Noise3 {
  let n = noiseCache.get(seed);
  if (!n) {
    if (noiseCache.size > 24) noiseCache.clear();
    n = new Noise3(hashCombine(seed, 0xc1a3));
    noiseCache.set(seed, n);
  }
  return n;
}

/**
 * Azimuth (radians) of spiral arm #0 at galactocentric radius R (kpc).
 * Logarithmic spiral: R = R₀·exp((θ − θ₀)·tan(pitch)).
 */
export function armAngle(g: GalaxyModel, R: number): number {
  const r0 = Math.max(g.barLength, g.hR * 0.35, 1e-3);
  const p = Math.max(g.pitch, 0.05);
  return g.armPhase + (dlog(Math.max(R, r0 * 0.25) / r0) * dcos(p)) / dsin(p);
}

/**
 * Relative stellar density at galaxy-local coordinates (kpc; z along the disc
 * normal) for one population class. Multiply by `density0` × the population's
 * share of the luminosity function to get stars per cubic parsec.
 */
export function galaxyDensity(g: GalaxyModel, x: number, y: number, z: number, pop: number): number {
  const R = Math.sqrt(x * x + y * y);
  const az = Math.abs(z);
  let rho = 0;

  if (g.bulgeFrac < 1) {
    const hz = g.hz * POP_HZ[pop]!;
    let disc = dexp(-R / g.hR - az / hz) * (g.hz / hz);
    // Smooth outer truncation and a central hole for ring galaxies.
    const edge = (R - g.radius * 0.82) / (g.radius * 0.18);
    if (edge > 0) disc *= edge >= 1 ? 0 : 1 - edge * edge * (3 - 2 * edge);
    if (g.ringR > 0) {
      const w = g.hR * 0.45;
      const ring = dexp(-((R - g.ringR) * (R - g.ringR)) / (w * w)) * dexp(-az / hz) * 0.5;
      disc = disc * 0.25 + ring;
    }
    if (disc > 0) {
      let mod = 1;
      if (g.arms > 0 && R > g.barLength * 0.8) {
        const theta = datan2(y, x);
        const c = 0.5 + 0.5 * dcos(g.arms * (theta - armAngle(g, R)));
        const mask = c * c * c * c;
        mod = Math.max(0.12, 1 + g.armContrast * POP_ARM[pop]! * (2.6 * mask - 0.75));
      } else if (g.barLength > 0) {
        // The bar: an elongated overdensity along the arm phase direction.
        const ca = dcos(g.armPhase);
        const sa = dsin(g.armPhase);
        const along = x * ca + y * sa;
        const across = -x * sa + y * ca;
        const b = dexp(-(across * across) / (0.09 * g.barLength * g.barLength) - (along * along) / (g.barLength * g.barLength));
        mod = 1 + 1.6 * b * POP_BULGE[pop]!;
      }
      if (g.clumpiness > 0.3) {
        const n = clumpNoise(g.seed).fbm((x / g.hR) * 1.7, (y / g.hR) * 1.7, (z / g.hR) * 1.7, 3);
        mod *= Math.max(0.08, 1 + g.clumpiness * (pop === POP_OLD ? 0.8 : 2.2) * n);
      }
      rho += disc * mod;
    }
  }

  if (g.bulgeFrac > 0) {
    const q = g.bulgeQ;
    const m2 = (x * x + y * y + (z * z) / (q * q)) / (g.bulgeR * g.bulgeR);
    const core = 1 / ((1 + m2) * (1 + m2) * Math.sqrt(1 + m2));
    if (g.bulgeFrac >= 1) {
      rho += core * (pop === POP_YOUNG ? 0.05 : pop === POP_MID ? 0.6 : 1.15);
    } else {
      // Amplitude that gives the bulge its share of the stars relative to the disc normalisation.
      const amp = (g.bulgeFrac / (1 - g.bulgeFrac)) * ((4 * Math.PI * g.hR * g.hR * g.hz) / ((4 / 3) * Math.PI * g.bulgeR * g.bulgeR * g.bulgeR * q));
      rho += amp * core * POP_BULGE[pop]!;
    }
  }
  return rho;
}

/** Upper bound of `galaxyDensity` over an axis-aligned box (for rejection sampling). */
export function galaxyDensityBound(g: GalaxyModel, cx: number, cy: number, cz: number, half: number, pop: number): number {
  // Closest point of the box to the galactic centre and to the mid-plane.
  const nx = Math.max(0, Math.abs(cx) - half);
  const ny = Math.max(0, Math.abs(cy) - half);
  const nz = Math.max(0, Math.abs(cz) - half);
  const Rmin = Math.sqrt(nx * nx + ny * ny);
  let bound = 0;
  if (g.bulgeFrac < 1) {
    const hz = g.hz * POP_HZ[pop]!;
    const Rmax = Math.sqrt((Math.abs(cx) + half) ** 2 + (Math.abs(cy) + half) ** 2);
    if (Rmin < g.radius) {
      let disc = dexp(-Rmin / g.hR - nz / hz) * (g.hz / hz);
      if (g.ringR > 0) disc = disc * 0.25 + (g.ringR >= Rmin - g.hR && g.ringR <= Rmax + g.hR ? 0.5 : 0.02) * dexp(-nz / hz);
      let mod = 1 + g.armContrast * POP_ARM[pop]! * 1.85;
      if (g.barLength > 0 && Rmin < g.barLength * 1.2) mod = Math.max(mod, 1 + 1.6 * POP_BULGE[pop]!);
      if (g.clumpiness > 0.3) mod *= 1 + g.clumpiness * (pop === POP_OLD ? 0.8 : 2.2);
      bound += disc * mod;
    }
  }
  if (g.bulgeFrac > 0) {
    const q = g.bulgeQ;
    const m2 = (nx * nx + ny * ny + (nz * nz) / (q * q)) / (g.bulgeR * g.bulgeR);
    const core = 1 / ((1 + m2) * (1 + m2) * Math.sqrt(1 + m2));
    bound +=
      g.bulgeFrac >= 1
        ? core * 1.15
        : (g.bulgeFrac / (1 - g.bulgeFrac)) * ((4 * Math.PI * g.hR * g.hR * g.hz) / ((4 / 3) * Math.PI * g.bulgeR * g.bulgeR * g.bulgeR * q)) * core * POP_BULGE[pop]!;
  }
  return bound;
}

/** Galaxy-local (kpc) → world direction/offset using the model's orientation. */
export function galaxyToWorld(g: GalaxyModel, x: number, y: number, z: number): V3 {
  const b = g.basis;
  return { x: b[0] * x + b[3] * y + b[6] * z, y: b[1] * x + b[4] * y + b[7] * z, z: b[2] * x + b[5] * y + b[8] * z };
}

/** World offset → galaxy-local coordinates. */
export function worldToGalaxy(g: GalaxyModel, v: V3): V3 {
  const b = g.basis;
  return { x: vDot({ x: b[0], y: b[1], z: b[2] }, v), y: vDot({ x: b[3], y: b[4], z: b[5] }, v), z: vDot({ x: b[6], y: b[7], z: b[8] }, v) };
}
