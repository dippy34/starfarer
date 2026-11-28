import { Vector3 } from 'three';
import {
  boilingPoint, circularSpeed, density, type Derived, equatorSpeed, escapeVelocity, G, habitableZone, hawkingTemp, hillRadius, isco, L_SUN, luminosity,
  M_SUN, num, orbitalPeriod, photonSphere, schwarzschildRadius, sunlight, sunlitTemp, surfaceGravity, surfaceTemp, waterState, type WaterPhase,
} from '../sim/physics';
import { Body, type Climate, type SpaceObject } from '../universe/Body';
import { BlackHole } from '../universe/BlackHoles';
import { ExoPlanet } from '../universe/Planets';
import { the } from './Powers';
import { type Kind, madeSize, madeWorking } from './WhatIf';

/** One thing that follows from what is known about an object: what it comes to, and how. */
export interface Worked {
  label: string;
  /** the result: "9.82 m/s²" */
  text: string;
  /** the working: the formula = the numbers put in = the result */
  math: string;
}

const row = (label: string, d: Derived): Worked => ({ label, text: d.text, math: d.math });

/** Where the catalogue's own periods come from: the Solar System while it is the real one (null in live physics). */
export interface Catalogued {
  meanPeriod(b: Body): { days: number; source: string; how: string } | null;
}

/** A period as catalogued: stated with its source, not worked out from where the body is now. */
function cataloguedPeriod(label: string, p: { days: number; source: string; how: string }): Worked {
  const text = p.days < 2 * 365.25 ? `${Number(p.days.toPrecision(6))} d` : `${Number((p.days / 365.25).toPrecision(5))} yr`;
  return { label, text, math: `P = ${p.how === 'catalogued' ? '' : `${p.how} = `}${text}, the mean period (${p.source})` };
}

/**
 * What follows from an object's catalogued values by the textbook, each line with its working
 * (src/sim/physics.ts): for a world its gravity, its escape velocity, how long its orbit takes; for
 * a black hole its horizon. Nothing here is looked up or made up: a line whose ingredients are
 * not known (the mass of a small moon, the size of a planet nobody has measured) is left out.
 */
export function workedOut(obj: SpaceObject, catalogue: Catalogued | null = null): Worked[] {
  if (obj instanceof Body) return ofBody(obj, catalogue);
  if (obj instanceof BlackHole) return ofBlackHole(obj);
  if (obj instanceof ExoPlanet) return ofExoPlanet(obj);
  return [];
}

const rel = new Vector3(), vel = new Vector3(), h = new Vector3();

function ofBody(b: Body, catalogue: Catalogued | null): Worked[] {
  const out: Worked[] = [];
  const mass = b.gm > 0 ? b.gm / G : 0;
  const sized = b.radius > 0 && !b.radiusEstimated;
  // what the explorer made: how its size followed from its mass (a sun's from the mass it has, whatever it is given; another
  // world's from the mass it was made with, while it has about the size that gave it: Size changes it by 2 % at least)
  const as = b.meta.madeAs as { kind: Kind; kg: number; icy: boolean } | undefined;
  if (as) {
    const kg = as.kind === 'sun' || as.kind === 'hole' ? mass : as.kg;
    if (as.kind === 'sun' || as.kind === 'hole' || Math.abs(madeSize(as.kind, kg, as.icy).radius / b.radius - 1) < 0.005) out.push(madeWorking(as.kind, kg, as.icy));
  }
  if (b.kind === 'star') {
    if (sized && b.teff) {
      const lum = luminosity(b.radius, b.teff);
      out.push(row('Luminosity', lum));
      const hz = habitableZone(lum.value * L_SUN);
      out.push(row('Habitable zone from', hz.inner), row('Habitable zone to', hz.outer));
    }
  }
  if (mass > 0 && sized) {
    out.push(row('Surface gravity', surfaceGravity(mass, b.radius)));
    out.push(row('Escape velocity', escapeVelocity(mass, b.radius)));
    out.push(row('Mean density', density(mass, b.radii[0], b.radii[1], b.radii[2])));
  }
  // its orbit: in the real Solar System the catalogue's mean period; otherwise (in live physics, or
  // where none is catalogued) from where it is and how it moves now, the vis-viva equation giving
  // the size of the orbit. (That one swings with every tug: the Earth's by half a day a month, as
  // the Moon pulls it to and fro at 12 m/s.)
  const listed = catalogue?.meanPeriod(b) ?? null;
  const p = b.parent;
  const mu = p ? p.gm || p.systemGm : 0;
  if (p && mu > 0 && b.valid) {
    rel.copy(b.pos).sub(p.pos);
    vel.copy(b.vel).sub(p.vel);
    const r = rel.length(), k = mu + b.gm;
    const a = 1 / (2 / r - vel.lengthSq() / k);
    if (r > 0 && a > 0 && Number.isFinite(a)) {
      const primary = mu / G;
      const label = `Once round ${the(p.name)}`;
      if (listed) out.push(cataloguedPeriod(label, listed));
      else {
        const now = row(label, orbitalPeriod(a, primary, mass));
        out.push({ ...now, math: `As it moves now (the orbit it would keep if nothing else pulled on it): ${now.math}` });
      }
      out.push(row('Speed of a circular orbit here', circularSpeed(r, primary)));
      if (mass > 0) {
        const e = Math.sqrt(Math.max(0, 1 - h.crossVectors(rel, vel).lengthSq() / (k * a)));
        out.push(row('Reach of its gravity (Hill sphere)', hillRadius(a, e, mass, primary)));
      }
    }
  }
  const days = Number(b.meta.rotPeriodDays) || Number(b.meta.rotPeriodHours) / 24;
  if (sized && days) out.push(row('Speed of its equator', equatorSpeed(b.radii[0], days * 86400)));
  return out;
}

// ---------------------------------------------------------------- its temperature

/**
 * The sunlight on a world, for its temperature: as its fact sheet lists it at its mean distance from
 * the Sun (`listed`, W/m²: the real Solar System), or from each sun where it is now (`suns`: their
 * light, W, and how far each is, m).
 */
export type Sunlit = { listed: number } | { suns: readonly { name: string; lumW: number; dM: number }[] };

/** A temperature as a person reads it: "−18 °C", "15 °C". */
export function celsius(K: number): string {
  const c = Math.round(K - 273.15);
  return `${c < 0 ? '−' : ''}${Math.abs(c)} °C`;
}

/** What water would do where a world is now, in words: on the Earth its oceans; elsewhere water, were there any. */
function waterWords(phase: WaterPhase, oceans: boolean): string {
  if (phase === 'thin') return 'Its air is too thin for liquid water.';
  if (oceans) return phase === 'ice' ? 'The oceans would freeze.' : phase === 'liquid' ? 'The oceans stay liquid.' : 'The oceans would boil.';
  return phase === 'ice' ? 'Water would be ice.' : phase === 'liquid' ? 'Water would be liquid.' : 'Water would boil.';
}

/**
 * A world's temperature, where NASA's fact sheet measures its Bond albedo (`climate`): what
 * sunlight alone warms it to, its heat spread all round it, and for a world whose air warms its
 * ground (Venus, the Earth, Mars) the ground's temperature and what water does there. In the real
 * Solar System (`sun.listed`) as the sheet has it: the sunlight at its mean distance and the ground's
 * measured mean. In live physics (`sun.suns`) where it is now, under every sun, the warming its air
 * gives kept as measured: how its air would change is not worked out. A line for its card, short
 * enough for a phone's ("15 °C, as measured. Without its air: −18 °C."; "Earth here: 112 °C. The
 * oceans would boil."), and the rows of its working.
 */
export function temperatureOf(world: { name: string; giant: boolean; oceans: boolean }, climate: Climate, sun: Sunlit): { line: string; worked: Worked[] } {
  const live = 'suns' in sun, S = 'suns' in sun ? sunlight(sun.suns) : sun.listed;
  const here = `${capital(the(world.name))} here`;
  if (!(S > 0)) return { line: `${here}: no sun to warm it.`, worked: [] };
  const bare = sunlitTemp(S, climate.bond), T = bare.value, air = climate.air;
  const from = 'suns' in sun
    ? `S = Σ L / (4πd²) = ${sun.suns.map((s) => `${num(s.lumW)} W / (4π·(${num(s.dM)} m)²)`).join(' + ')} = ${num(S)} W/m², the sunlight where it is now (${sun.suns.map((s) => the(s.name)).join(' and ')}); `
    : `S = ${num(S)} W/m², the sunlight at its mean distance from the Sun (NASA's fact sheet); `;
  const spread = `A = ${num(climate.bond)}, its Bond albedo (NASA's fact sheet: the share of the sunlight it sends back); its heat spread all round it`;
  const worked: Worked[] = [{
    label: world.giant ? 'Temperature from sunlight alone' : 'Temperature without air',
    text: celsius(T),
    math: `${from}${bare.math} (${celsius(T)}): ${spread}${world.giant ? '. A giant planet gives off heat of its own besides (Uranus hardly any), which this leaves out' : ''}`,
  }];
  if (!air) {
    const line = live ? `${here}: ${celsius(T)}${world.giant ? ', from sunlight alone' : ''}` : `${world.giant ? 'From sunlight alone' : 'Temperature without air'}: ${celsius(T)}`;
    return { line, worked };
  }
  // the warming its air gives, as measured: the ground's mean against what the sheet's sunlight alone gives
  const listedT = 'listed' in sun ? T : null, warming = air.tempK - (listedT ?? sunlitTemp(climate.irradiance ?? S, climate.bond).value);
  const ground = live ? surfaceTemp(T, warming).value : air.tempK, phase = waterState(ground, air.bar);
  worked.push({
    label: 'With its air', text: celsius(ground),
    math: live
      ? `T = T without air + ΔT = ${num(T)} K + ${num(warming)} K = ${num(ground)} K (${celsius(ground)}): ΔT, the warming its air gives as measured (${num(air.tempK)} K on average, NASA's fact sheet), kept as it is wherever it goes; how its air would change is not worked out`
      : `${num(air.tempK)} K (${celsius(air.tempK)}) on average, as measured (NASA's fact sheet): its air warms it by ${num(warming)} K`,
  }, {
    label: 'Water there', text: phase === 'thin' ? 'never liquid' : phase === 'liquid' ? 'liquid' : phase === 'ice' ? 'ice' : 'boils',
    math: phase === 'thin'
      ? `Under ${num(air.bar)} bar of air, below the 0.006 bar of water's triple point, water cannot be liquid at any temperature`
      : `Under ${num(air.bar)} bar of air water melts at 0 °C and boils at ${celsius(boilingPoint(air.bar))} (Clausius and Clapeyron): at ${celsius(ground)} it ${phase === 'liquid' ? 'is liquid' : phase === 'ice' ? 'is ice' : 'boils'}`,
  });
  // (a line a phone has room for: what water does there is in the working, as measured)
  const line = live ? `${here}: ${celsius(ground)}. ${waterWords(phase, world.oceans)}` : `${celsius(ground)}, as measured. Without its air: ${celsius(T)}.`;
  return { line, worked };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function ofBlackHole(bh: BlackHole): Worked[] {
  const mass = bh.massSun * M_SUN;
  return [
    row('Event horizon', schwarzschildRadius(mass)),
    row('Light can circle at', photonSphere(mass)),
    row('Innermost stable orbit', isco(mass)),
    row('Hawking temperature', hawkingTemp(mass)),
  ];
}

function ofExoPlanet(p: ExoPlanet): Worked[] {
  const s = p.spec;
  // (only what was measured: a size or a mass that was estimated to draw the planet proves nothing)
  if (!s.real || s.est.includes('mass') || s.est.includes('massMin') || s.est.includes('radius') || !(s.massKg > 0) || !(s.radiusM > 0)) return [];
  return [
    row('Surface gravity', surfaceGravity(s.massKg, s.radiusM)),
    row('Escape velocity', escapeVelocity(s.massKg, s.radiusM)),
    row('Mean density', density(s.massKg, s.radiusM)),
  ];
}
