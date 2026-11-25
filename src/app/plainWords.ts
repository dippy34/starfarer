/**
 * What the object card says first, in words a ninth-grader reads at a glance (HANDOFF.md "Design"):
 * the line under its name, and a few plain facts. Every number here is one the card's science
 * already has (its rows, as measured), put in units people know and against things they know: the
 * Earth, the Sun, their own weight, the speed of light. Nothing is rounded into something else;
 * where the science says a value is estimated or uncertain, the plain line says so too.
 */
import { Vector3 } from 'three';
import { C_LIGHT, LY, SUN_ABS_MAG, SUN_RADIUS } from '../core/units';
import { BlackHole } from '../universe/BlackHoles';
import { Body, type SpaceObject } from '../universe/Body';
import { ExoPlanet } from '../universe/Planets';
import { CatalogStar } from '../universe/Stars';
import type { App } from './App';
import { describe, distanceText, distanceTo, moonWords } from './destinations';
import { the } from './Powers';
import { wellStudied } from './Systems';

const EARTH_RADIUS = 6_371e3;
const G_EARTH = 9.80665;
const DAY = 86_400;
const YEAR = 365.25 * DAY;

/** A distance anyone reads: kilometres, millions or billions of them, then light years (never AU or parsecs). */
export function plainDistance(m: number): string {
  if (m >= 0.01 * LY) return distanceText(m);
  if (m < 1e3) return `${Math.round(m).toLocaleString('en-US')} m`;
  if (m < 1e9) return `${Math.round(m / 1e3).toLocaleString('en-US')} km`;
  if (m < 1e12) return `${sig(m / 1e9)} million km`;
  return `${sig(m / 1e12)} billion km`;
}

/** How long light takes over a distance, in the largest unit that reads well. */
export function lightTime(m: number): string {
  const s = m / C_LIGHT;
  if (s < 1) return 'under a second';
  if (s < 90) return `${s.toFixed(s < 10 ? 1 : 0)} seconds`;
  if (s < 90 * 60) return `${Math.round(s / 60)} minutes`;
  if (s < 2 * DAY) return `${sig(s / 3600)} hours`;
  if (s < YEAR) return `${Math.round(s / DAY)} days`;
  return `${distanceText(m).replace(/ light years?$/, '')} years`;
}

/** Kelvin as people know it, in degrees Celsius (a star's surface: to the hundred). */
export function celsiusWords(k: number): string {
  const c = k - 273.15;
  const r = Math.abs(c) >= 2000 ? Math.round(c / 100) * 100 : Math.round(c);
  return `${r < 0 ? '−' : ''}${Math.abs(r).toLocaleString('en-US')} °C`;
}

/** The line under the name on the card's bar: what it is, and how far, in plain words. */
export function plainLine(app: App, o: SpaceObject): string {
  const away = `${plainDistance(distanceTo(app, o))} away`;
  if (o instanceof CatalogStar) return `${starColour(o.teff)} star · ${away}${o.distanceUncertain ? ' (distance uncertain)' : ''}`;
  // (real or made up, said first: the owner could not tell a real planet of another star from the app's own)
  if (o instanceof ExoPlanet) return `${o.system.real ? 'Real planet' : 'Made-up planet'} of ${o.system.host.name} · ${plainDistance(o.system.host.upos.sub(app.rig.upos, new Vector3()).length())} away`;
  if (o instanceof Body) {
    const made = o.meta.made ? ', made by you' : '';
    if (o.kind === 'star') return `${o.name === 'Sun' ? 'Our star' : 'Star'}${made} · ${away}`;
    if (o.kind === 'moon') return `${capital(o.parent && o.parent.kind !== 'star' ? `${o.parent.name}'s moon` : moonWords(o))}${made} · ${away}`;
    const kind: Record<string, string> = { planet: 'Planet', dwarf: 'Dwarf planet', asteroid: 'Asteroid', tno: 'Icy world beyond Neptune', comet: 'Comet' };
    return `${kind[o.kind] ?? capital(o.kind)}${made} · ${away}`;
  }
  // (a black hole's line as the lists have it gave its distance in AU)
  if (o instanceof BlackHole) return `Black hole · ${blackHoleMass(o.massSun)} · ${away}`;
  // (galaxies, nebulae, spacecraft, places: their line as the lists have it)
  return capital(describe(app, o));
}

/** A few facts in plain words, the card's first read: [what, value]. */
export function plainFacts(app: App, o: SpaceObject): [string, string][] {
  const d = distanceTo(app, o);
  const rows: [string, string][] = [['How far', plainDistance(d)]];
  if (d > 1e6) rows.push(['Its light takes', `${lightTime(d)} to reach you`]);
  if (o instanceof CatalogStar) {
    const unsure = o.distanceUncertain ? ' (uncertain)' : '';
    const across = (o.shape?.rEq ?? o.radius) / SUN_RADIUS;
    const sure = o.shape || o.measured ? '' : unsure || ' (estimated)';
    rows.push(['Size', `${times(across)} as wide as the Sun${sure}`]);
    const lum = Math.pow(10, -0.4 * (o.absMag - SUN_ABS_MAG));
    rows.push(['Brightness', `${brightnessWords(lum)}${unsure}`]);
    rows.push(['Surface', `about ${celsiusWords(o.teff)}`]);
    // (as the card's numbers: a companion of a brighter star has no system of its own)
    const sys = app.isCompanion(o) ? null : app.systems.of(o);
    if (sys) rows.push(['Planets', sys.real ? `${sys.planets.length} found by astronomers` : `${sys.planets.length} made up by the app (not observed)`]);
    else if (!app.isCompanion(o) && wellStudied(o)) rows.push(['Planets', 'none found so far']);
    return rows;
  }
  if (o instanceof ExoPlanet) {
    const s = o.spec;
    rows.push(['Size', `${times(s.radiusM / EARTH_RADIUS)} as wide as Earth${s.est.includes('radius') ? ' (estimated)' : ''}`]);
    const yearDays = s.periodS / DAY;
    rows.push(['A year there', yearDays < 400 ? `${yearDays.toFixed(yearDays < 10 ? 1 : 0)} days` : `${(yearDays / 365.25).toFixed(1)} Earth years`]);
    rows.push(['Temperature', `about ${celsiusWords(s.teqK)}`]);
    if (!s.real) rows.push(['Note', 'made up from its star: not observed']);
    return rows;
  }
  if (o instanceof BlackHole) {
    rows.push(['Mass', blackHoleMass(o.massSun)]);
    return rows;
  }
  if (o instanceof Body && o.radius > 0) {
    const est = o.radiusEstimated ? ' (estimated)' : '';
    const km = Math.round((2 * o.radius) / 1e3).toLocaleString('en-US');
    const vsEarth = o.radius / EARTH_RADIUS;
    rows.push(['Size', `${km} km across${o.name === 'Earth' ? '' : vsEarth >= 0.995 ? `, ${times(vsEarth)} as wide as Earth` : `, ${percent(vsEarth)} of Earth's width`}${est}`]);
    if (o.gm > 0 && o.kind !== 'comet') {
      const w = o.gm / (o.radius * o.radius) / G_EARTH;
      if (o.name !== 'Earth') rows.push([o.isGasGiant || o.kind === 'star' ? 'Weight at the top' : 'Your weight there', w >= 0.995 ? `${times(w)} what it is on Earth` : `${percent(w)} of what it is on Earth`]);
    }
    const hours = Number(o.meta.rotPeriodHours ?? 0) || Number(o.meta.rotPeriodDays ?? 0) * 24;
    if (hours) rows.push(['Spins once in', hours < 48 ? `${sig(hours)} hours` : `${sig(hours / 24)} days`]);
    if (o.kind === 'star' && o.teff) rows.push(['Surface', `about ${celsiusWords(o.teff)}`]);
    if (o.parent && o.kind === 'moon') rows.push(['Goes round', the(o.parent.name)]);
  }
  return rows;
}

/** A star's colour, from its temperature (as the eye sees a star of it). */
function starColour(teff: number): string {
  return teff >= 10_000 ? 'Blue-white' : teff >= 7_500 ? 'White' : teff >= 6_000 ? 'Yellow-white' : teff >= 5_200 ? 'Yellow' : teff >= 3_700 ? 'Orange' : 'Red';
}

/**
 * A star's light against the Sun's: "23 times as bright", "80% as bright", "1,800 times fainter".
 * (A red dwarf such as TRAPPIST-1, 0.00055 of the Sun, read "0 times as bright" at two decimals.)
 * Two figures for the faint: a brightness from a magnitude is good to a few per cent at best.
 */
export function brightnessWords(lum: number): string {
  if (lum >= 0.95 && lum < 1.05) return 'about as bright as the Sun';
  if (lum >= 1) return `${times(lum)} as bright as the Sun`;
  if (lum >= 0.1) return `${percent(lum)} as bright as the Sun`;
  return `${Number((1 / lum).toPrecision(2)).toLocaleString('en-US')} times fainter than the Sun`;
}

/** a black hole's mass in Suns: "21.2 Suns", "4.3 million Suns" */
function blackHoleMass(m: number): string {
  return m >= 1e6 ? `${sig(m / 1e6)} million Suns` : `${sig(m)} Suns`;
}

/** "2.3 times", "120 times", "1,000 times" */
function times(x: number): string {
  return `${x >= 1000 ? Math.round(x).toLocaleString('en-US') : sig(x)} times`;
}

/** a share as a percentage people read: "17%", "0.6%", "0.003%" */
function percent(x: number): string {
  const p = x * 100;
  return `${p >= 10 ? Math.round(p) : Number(p.toPrecision(p >= 1 ? 2 : 1))}%`;
}

/** three significant figures, no exponent, thousands marked */
function sig(x: number): string {
  return Number(x.toPrecision(3)).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
