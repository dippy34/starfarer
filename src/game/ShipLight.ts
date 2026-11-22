import { Vector3 } from 'three';
import { blackbodyRGB, lambertPhase, luminance, magToIrradiance } from '../astro/photometry';
import { discCovered } from '../core/discs';
import { AU, PC } from '../core/units';
import type { App } from '../app/App';
import { KEY, SHIP_LIGHT } from './shipShader';

/**
 * The light on the ship and in the cockpit: the star the app lights everything with, and the
 * world nearby. Real light only: no ambient term. The star's strength is display-referred as it
 * always was (a white plate square to the Sun at 1 AU at `KEY`, half that by Saturn); a world that
 * covers the star dims it by the share of its disc covered (in a planet's shadow the ship is dark
 * but for its own lamps); the world's sunlit face lights the side turned to it by its albedo and
 * phase (Earthshine on the ship's shadowed side, Saturn's glow), its colour that of the world.
 */

/** How some worlds' light looks, whole (luminance 1): art direction for the planetshine, not catalogue data. */
const WORLD_TINT: Record<string, [number, number, number]> = {
  Earth: [0.68, 0.8, 1.15],
  Mars: [1.2, 0.86, 0.66],
  Venus: [1.08, 1.0, 0.86],
  Jupiter: [1.1, 0.98, 0.84],
  Moon: [1.03, 1.0, 0.96],
};

export interface Shine {
  /** sine of the world's angular radius (0: none) */
  sin: number;
  /** unit direction from the ship to the world's centre */
  dir: Vector3;
  /** radiance of its disc, display units (colour x albedo x phase x the star's strength x KEY) */
  radiance: Vector3;
  /** share of the star's disc the world leaves uncovered (1: none covered) */
  sunSeen: number;
}

/**
 * The world's light at the ship (pure: vectors from the ship, metres). `toWorld`/`radius`: the
 * world; `toSun`/`sunRadius`: its star; `albedo`, `tint` (luminance 1); `sun`: the star's strength.
 */
export function worldShine(toWorld: Vector3, radius: number, toSun: Vector3, sunRadius: number, albedo: number, tint: [number, number, number], sun: number): Shine {
  const d = toWorld.length();
  const sin = Math.min(0.999, radius / Math.max(d, radius));
  const dir = toWorld.clone().divideScalar(Math.max(d, 1e-9));
  // the phase: the angle at the world between its star and the ship
  const fromWorldToSun = toSun.clone().sub(toWorld).normalize();
  const phase = Math.acos(Math.max(-1, Math.min(1, fromWorldToSun.dot(dir.clone().negate()))));
  const lit = lambertPhase(phase) * albedo * sun * KEY;
  const lum = 0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2];
  const radiance = new Vector3(tint[0], tint[1], tint[2]).multiplyScalar(lit / Math.max(lum, 1e-6));
  // an eclipse: the world's disc over the star's, as seen from the ship (only when the world is nearer)
  const ds = toSun.length();
  let sunSeen = 1;
  if (d < ds) {
    const sunAng = Math.asin(Math.min(1, sunRadius / ds));
    const worldAng = Math.asin(sin);
    const sep = Math.acos(Math.max(-1, Math.min(1, dir.dot(toSun.clone().divideScalar(ds)))));
    sunSeen = 1 - discCovered(sunAng, worldAng, sep);
  }
  return { sin, dir, radiance, sunSeen };
}

/** The star's display strength from its irradiance (W/m^2-like units of magToIrradiance; pi at 1 AU from the Sun). */
export function starStrength(E: number): number {
  return Math.max(0, Math.min(1.3, 1 + 0.25 * Math.log10(E / Math.PI)));
}

const _rel = new Vector3();

/** Set SHIP_LIGHT from where the ship is (the camera's place): call once a frame while in the ship. */
export function updateShipLight(app: App, time: number): void {
  const rig = app.rig;
  const sun = app.system.sun;
  const toSun = sun.upos.sub(rig.upos, new Vector3());
  let dir = toSun.clone().normalize(), E = Math.PI * (AU / Math.max(toSun.length(), 1)) ** 2, teff = sun.teff;
  let starRadius = sun.radius, starDist = toSun.length(), solar = true;
  for (const s of app.near.stars) {
    const rel = s.upos.sub(rig.upos, _rel);
    const Es = magToIrradiance(s.absMag + 5 * Math.log10(Math.max(rel.length(), 1) / PC) - 5);
    if (Es > E) { E = Es; dir = rel.clone().normalize(); teff = s.teff; starRadius = s.radius; starDist = rel.length(); solar = false; }
  }
  const strength = starStrength(E);
  const L = SHIP_LIGHT;
  L.uSunDir.value.copy(dir);
  const c = blackbodyRGB(teff), l = luminance(c);
  L.uSunColor.value.set(c[0] / l, c[1] / l, c[2] / l);
  L.uSunSize.value = Math.min(0.5, Math.asin(Math.min(1, starRadius / Math.max(starDist, starRadius))));
  L.uTime.value = time;
  // the world nearest in the sky (largest): its light, and whether it hides the star
  let best = null as null | { b: (typeof app.system.bodies)[number]; s: number };
  if (solar) {
    for (const b of app.system.bodies) {
      if (!b.valid || b.kind === 'star' || !(b.radius > 0)) continue;
      const d = b.upos.sub(rig.upos, _rel).length();
      const s = b.radius / Math.max(d, b.radius);
      if (!best || s > best.s) best = { b, s };
    }
  }
  if (best && best.s > 2e-3) {
    const b = best.b;
    const tint = WORLD_TINT[b.name] ?? b.color;
    const shine = worldShine(b.upos.sub(rig.upos, new Vector3()), b.radius, toSun, sun.radius, b.albedo, tint, strength);
    L.uSun.value = strength * shine.sunSeen;
    L.uPlanetDir.value.copy(shine.dir);
    L.uPlanetSin.value = shine.sin;
    L.uPlanetLight.value.copy(shine.radiance);
  } else {
    L.uSun.value = strength;
    L.uPlanetSin.value = 0;
    L.uPlanetLight.value.set(0, 0, 0);
  }
}
