/**
 * Physical constants (SI) and friendly, human-readable formatters.
 * The whole simulation works in metres, kilograms, seconds and kelvin.
 */

export const C = 299_792_458; // speed of light, m/s
export const G = 6.6743e-11; // gravitational constant
export const AU = 1.495978707e11;
export const LY = 9.4607304725808e15;
export const PC = 3.0856775814913673e16;
export const KPC = PC * 1e3;
export const MPC = PC * 1e6;
export const GPC = PC * 1e9;
export const KM = 1000;

export const DAY = 86_400;
export const YEAR = 365.25 * DAY; // Julian year
export const J2000_UNIX = 946_727_935.816; // 2000-01-01T12:00:00 TT expressed as Unix seconds (UTC)

export const R_SUN = 6.957e8;
export const M_SUN = 1.98847e30;
export const L_SUN = 3.828e26;
export const T_SUN = 5772;
export const R_EARTH = 6.371e6;
export const M_EARTH = 5.9722e24;
export const R_JUP = 6.9911e7;
export const M_JUP = 1.89813e27;
export const G_EARTH = 9.80665;
export const SIGMA_SB = 5.670374419e-8;

/** Comoving radius of the observable universe (≈46.5 billion light-years). */
export const UNIVERSE_RADIUS = 14_260 * MPC;

function sig(x: number, digits = 3): string {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1000) return Math.round(x).toLocaleString('en-US');
  const s = x.toPrecision(digits);
  return s.includes('e') ? Number(s).toString() : s.replace(/\.?0+$/, '');
}

const BIG: Array<[number, string]> = [
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
];

function bigNumber(x: number): string {
  for (const [v, name] of BIG) if (Math.abs(x) >= v) return `${sig(x / v)} ${name}`;
  return sig(x);
}

/** Friendly distance: picks the most natural unit for the scale. */
export function formatDistance(m: number): string {
  const a = Math.abs(m);
  if (!Number.isFinite(a)) return '—';
  if (a < 1) return `${sig(a * 100)} cm`;
  if (a < 1000) return `${sig(a)} m`;
  if (a < 1e9) return `${sig(a / 1000)} km`;
  if (a < 0.03 * AU) return `${bigNumber(a / 1000)} km`;
  if (a < 0.05 * LY) return `${sig(a / AU)} AU`;
  if (a < 1e3 * LY) return `${sig(a / LY)} light-years`;
  if (a < 1e6 * LY) return `${sig(a / LY / 1e3)} thousand light-years`;
  if (a < 1e9 * LY) return `${sig(a / LY / 1e6)} million light-years`;
  return `${sig(a / LY / 1e9)} billion light-years`;
}

/** Compact scientific distance for the data overlay. */
export function formatDistanceSci(m: number): string {
  const a = Math.abs(m);
  if (!Number.isFinite(a)) return '—';
  if (a < 1e6) return `${sig(a / 1000, 4)} km`;
  if (a < 0.01 * AU) return `${sig(a / 1000, 4)} km`;
  if (a < 2000 * AU) return `${sig(a / AU, 4)} AU`;
  if (a < 1e3 * PC) return `${sig(a / PC, 4)} pc`;
  if (a < 1e6 * PC) return `${sig(a / KPC, 4)} kpc`;
  if (a < 1e9 * PC) return `${sig(a / MPC, 4)} Mpc`;
  return `${sig(a / GPC, 4)} Gpc`;
}

/** Friendly speed: everyday units when slow, multiples of light speed when fast. */
export function formatSpeed(mps: number): string {
  const a = Math.abs(mps);
  if (a < 0.5) return 'Stopped';
  if (a < 1000) return `${sig(a)} m/s`;
  if (a < 0.01 * C) return `${sig(a / 1000)} km/s`;
  if (a < 100 * C) return `${sig(a / C)}× light speed`;
  if (a < 1e6 * LY) return `${sig(a / LY)} light-years/s`;
  return `${bigNumber(a / LY)} light-years/s`;
}

export function formatDuration(sec: number): string {
  const a = Math.abs(sec);
  if (!Number.isFinite(a)) return '—';
  if (a < 1e-3) return `${sig(a * 1e6)} µs`;
  if (a < 1) return `${sig(a * 1e3)} ms`;
  if (a < 120) return `${sig(a)} s`;
  if (a < 7200) return `${sig(a / 60)} min`;
  if (a < 2 * DAY) return `${sig(a / 3600)} hours`;
  if (a < 2 * YEAR) return `${sig(a / DAY)} days`;
  if (a < 1e6 * YEAR) return `${sig(a / YEAR)} years`;
  return `${bigNumber(a / YEAR)} years`;
}

export function formatTemperature(k: number): string {
  if (!Number.isFinite(k)) return '—';
  return k < 1000 ? `${Math.round(k)} K (${Math.round(k - 273.15)} °C)` : `${Math.round(k).toLocaleString('en-US')} K`;
}

/** Mass relative to the most natural reference body. */
export function formatMass(kg: number): string {
  if (!Number.isFinite(kg) || kg <= 0) return '—';
  if (kg > 0.05 * M_SUN) return kg > 1e5 * M_SUN ? `${bigNumber(kg / M_SUN)} × Sun` : `${sig(kg / M_SUN)} × Sun`;
  if (kg > 30 * M_EARTH) return `${sig(kg / M_JUP)} × Jupiter`;
  if (kg > 1e-4 * M_EARTH) return `${sig(kg / M_EARTH)} × Earth`;
  return `${kg.toExponential(2)} kg`;
}

export function formatRadius(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '—';
  if (m > 0.05 * R_SUN && m < 1e4 * R_SUN) return `${sig(m / R_SUN)} × Sun`;
  if (m >= 1e4 * R_SUN) return formatDistance(m);
  if (m > 3 * R_EARTH) return `${sig(m / R_JUP)} × Jupiter`;
  if (m > 0.02 * R_EARTH) return `${sig(m / R_EARTH)} × Earth`;
  return `${sig(m / 1000)} km`;
}

export { sig as formatSig, bigNumber as formatBig };
