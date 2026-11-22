import { Vector3 } from 'three';
import {
  circularSpeed, density, type Derived, equatorSpeed, escapeVelocity, G, habitableZone, hawkingTemp, hillRadius, isco, L_SUN, luminosity,
  M_SUN, orbitalPeriod, photonSphere, schwarzschildRadius, surfaceGravity,
} from '../sim/physics';
import { Body, type SpaceObject } from '../universe/Body';
import { BlackHole } from '../universe/BlackHoles';
import { ExoPlanet } from '../universe/Planets';
import { the } from './Powers';

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
  if (!s.real || s.est.includes('mass') || s.est.includes('radius') || !(s.massKg > 0) || !(s.radiusM > 0)) return [];
  return [
    row('Surface gravity', surfaceGravity(s.massKg, s.radiusM)),
    row('Escape velocity', escapeVelocity(s.massKg, s.radiusM)),
    row('Mean density', density(s.massKg, s.radiusM)),
  ];
}
