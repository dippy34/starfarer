import { Vector3 } from 'three';
import { formatDistance, LY } from '../core/units';
import { BlackHole } from '../universe/BlackHoles';
import { Body, type SpaceObject } from '../universe/Body';
import { DeepSkyObject } from '../universe/DeepSky';
import { Galaxy } from '../universe/Galaxies';
import { Landmark } from '../universe/Landmarks';
import { MilkyWay } from '../universe/MilkyWay';
import { ExoPlanet, type PlanetType } from '../universe/Planets';
import { RingSpot } from '../universe/RingSpot';
import { Comet } from '../render/SmallBodies';
import { Spacecraft } from '../universe/Spacecraft';
import { CatalogStar } from '../universe/Stars';
import type { App } from './App';
import { the } from './Powers';

/**
 * Places worth offering by name: the lists behind the Explore sheet (src/ui/Hud.ts) and the
 * headset's menu (src/vr/Menu.ts), and how one of them is described and pictured in a list.
 * Every name here is that of a real object in the app's data; nothing is made up for a list.
 * (What the explorer has made is listed after them: a made planet or sun with the Solar System,
 * a made moon with the moons.)
 */

export const PLANETS = ['Sun', 'Mercury', 'Venus', 'Earth', 'Moon', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'Ceres'];
export const MOON_PARENTS = ['Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
export const STARS = ['Proxima Centauri', 'Rigil Kentaurus', 'Sirius', 'Betelgeuse', 'Rigel', 'Vega', 'Polaris', 'Arcturus', 'Antares', 'Aldebaran',
  'Canopus', 'Deneb', "Barnard's Star", 'Tau Ceti', 'Altair', 'Capella', 'Spica', 'Fomalhaut', 'Procyon', 'Mira'];
/** famous confirmed planets of other stars (NASA Exoplanet Archive names) */
export const EXOPLANETS = ['Proxima Cen b', 'TRAPPIST-1 e', 'Kepler-186 f', '51 Peg b', 'HD 189733 b', '55 Cnc e', 'eps Eri b', 'TOI-700 d',
  'LHS 1140 b', 'K2-18 b', 'Kepler-452 b', 'HR 8799 e'];
export const NEBULAE = ['Orion Nebula', 'Carina Nebula', 'Eagle Nebula', 'Lagoon Nebula', 'Ring Nebula', 'Helix Nebula', 'Crab Nebula', 'Veil Nebula (Cygnus Loop)',
  'Tarantula Nebula', 'Pleiades', 'Omega Centauri', 'Hercules Cluster (M13)'];
export const GALAXIES = ['Andromeda Galaxy', 'Triangulum Galaxy', 'Large Magellanic Cloud', 'Small Magellanic Cloud', 'Whirlpool Galaxy', 'Sombrero Galaxy', 'Centaurus A', 'Pinwheel Galaxy', 'M87'];
export const HOLES = ['Sagittarius A*', 'M87*', 'Cygnus X-1', 'Gaia BH1', 'Gaia BH2', 'Gaia BH3', '3A 0620-003', 'GS 2023+338', 'GRS 1915+105',
  'XTE J1118+480', '4U 1543-475'];
export const COMETS = ['Halley', 'Hale-Bopp', 'Churyumov', 'Encke', 'Tempel 1', 'Wild 2', 'Hartley 2', 'Swift-Tuttle'];
/** the landmarks shown first among the places */
export const HIGHLIGHTS = ['Mount Everest', 'Grand Canyon', 'Olympus Mons', 'Valles Marineris', 'Apollo 11 landing site', 'Tycho'];

/** the base colour of a generated planet, by type (for its picture in a list) */
export const EXO_COLOR: Record<PlanetType, [number, number, number]> = {
  lava: [0.55, 0.18, 0.08], hot: [0.62, 0.55, 0.5], desert: [0.85, 0.6, 0.35], terran: [0.35, 0.55, 0.45], ocean: [0.2, 0.42, 0.8],
  ice: [0.88, 0.92, 0.98], subneptune: [0.55, 0.75, 0.85], icegiant: [0.35, 0.55, 0.95], giant: [0.85, 0.72, 0.55], hotgiant: [0.3, 0.22, 0.4],
};

/** a star's tint by temperature in kelvin (list pictures only) */
export function starTint(teff: number): [number, number, number] {
  const t = teff || 5800;
  if (t > 9000) return [0.75, 0.85, 1.0];
  if (t > 6500) return [0.92, 0.94, 1.0];
  if (t > 5200) return [1.0, 0.95, 0.85];
  if (t > 4000) return [1.0, 0.82, 0.6];
  return [1.0, 0.7, 0.45];
}

/** How a destination is pictured in a list: a world's photograph where there is one, else a drawn shape in its colour. */
export interface Picture {
  shape: 'world' | 'star' | 'galaxy' | 'hole' | 'cloud' | 'cluster' | 'craft' | 'comet';
  /** the world whose photograph to show (a name in the thumbnail sheet, public/data/textures/thumbs.json) */
  world?: string;
  /** base colour, 0..1 */
  tint: [number, number, number];
}

/** One line of a list of places to go. */
export interface Destination {
  label: string;
  detail: string;
  /** what App.pickDestination takes */
  id: string;
  picture?: Picture;
}

export function pictureOf(o: SpaceObject): Picture {
  if (o instanceof Body) return { shape: o.kind === 'star' ? 'star' : 'world', world: o.nature, tint: o.kind === 'star' ? [1, 0.93, 0.8] : o.color };
  if (o instanceof Landmark) return { shape: 'world', world: o.world.name, tint: o.world.color };
  if (o instanceof RingSpot) return { shape: 'world', world: 'Saturn', tint: [0.85, 0.78, 0.6] };
  if (o instanceof CatalogStar) return { shape: 'star', tint: starTint(o.teff) };
  if (o instanceof ExoPlanet) return { shape: 'world', tint: EXO_COLOR[o.spec.type] };
  if (o instanceof BlackHole) return { shape: 'hole', tint: o.diskOuter > 0 ? (o.supermassive ? [1, 0.67, 0.35] : [0.67, 0.8, 1]) : [0.78, 0.78, 0.84] };
  if (o instanceof MilkyWay || o instanceof Galaxy) return { shape: 'galaxy', tint: [1, 0.92, 0.78] };
  if (o instanceof DeepSkyObject) return o.data.kind === 'open' || o.data.kind === 'globular' ? { shape: 'cluster', tint: [0.8, 0.88, 1] } : { shape: 'cloud', tint: [1, 0.5, 0.65] };
  if (o instanceof Spacecraft) return { shape: 'craft', tint: [0.95, 0.78, 0.4] };
  if (o instanceof Comet) return { shape: 'comet', tint: [0.62, 0.92, 1] };
  return { shape: 'world', tint: [0.7, 0.72, 0.78] };
}

/**
 * How far something is from the explorer (m): to the surface of a world (what its height above it
 * becomes close up), to the centre of anything else.
 */
export function distanceTo(app: App, o: SpaceObject): number {
  const d = o.upos.sub(app.rig.upos, new Vector3()).length();
  // (the world the camera is at: its ground as the camera knows it, hills and all)
  if (o === app.rig.target && app.rig.surface > 0) return Math.max(d - app.rig.surface, 0);
  return o instanceof Body || o instanceof ExoPlanet || o instanceof CatalogStar ? Math.max(d - o.radius, 0) : d;
}

/** One line about an object as seen from where the explorer is: what it is, how far. */
export function describe(app: App, o: SpaceObject): string {
  const d = distanceTo(app, o);
  // (in the units the place chip uses: near a star "5.066 million km" or "11.40 AU", not "0.00 light years")
  if (o instanceof CatalogStar) return `star · ${distanceText(d)}${o.distanceUncertain ? ' (uncertain)' : ''}`;
  if (o instanceof MilkyWay) return 'our galaxy, from outside';
  if (o instanceof Landmark) return `on ${o.def.body} · ${o.def.about}`;
  if (o instanceof RingSpot) return 'among the ice of the B ring';
  if (o instanceof Galaxy) return `galaxy · ${distanceText(d)}`;
  if (o instanceof DeepSkyObject) return `${o.data.kind === 'open' || o.data.kind === 'globular' ? `${o.data.kind} cluster` : o.kind} · ${distanceText(d)}`;
  if (o instanceof Spacecraft) {
    const au = o.upos.sub(app.system.sun.upos, new Vector3()).length() / 1.495978707e11;
    return o.isOrbiter ? `Earth orbit · ${formatDistance(d)}` : o.parentObject ? `near Earth · ${formatDistance(d)}` : `${au.toFixed(au > 10 ? 0 : 2)} AU from the Sun`;
  }
  if (o instanceof ExoPlanet) {
    const far = o.system.host.upos.sub(app.rig.upos, new Vector3()).length();
    return `${o.info()[0][1].replace(/^Exoplanet: /, '').replace(/, found.*$/, '')} · ${far < 0.01 * LY ? formatDistance(d) : distanceText(far)}`;
  }
  if (o instanceof BlackHole) {
    const mass = o.massSun >= 1e9 ? `${(o.massSun / 1e9).toPrecision(2)} billion Suns` : o.massSun >= 1e6 ? `${(o.massSun / 1e6).toPrecision(3)} million Suns` : `${o.massSun.toFixed(1)} Suns`;
    return `${mass} · ${distanceText(d)}`;
  }
  if (o instanceof Body) {
    const kind = o.kind === 'moon' ? moonWords(o) : o.kind === 'dwarf' ? 'dwarf planet' : o.kind === 'tno' ? 'trans-Neptunian object' : o.kind;
    return `${kind} · ${formatDistance(d)}`;
  }
  return `${o.kind} · ${formatDistance(d)}`;
}

/** Whose moon a moon is, in a line about it; or, where live physics has had it let go (src/app/LivePhysics.ts), what became of it. */
export function moonWords(b: Body): string {
  const p = b.parent;
  return !p ? 'moon, flying free' : p.kind === 'star' ? `moon, round ${the(p.name)} now` : `moon of ${p.name}`;
}

/** A distance in words anyone reads: metres and kilometres nearby, light years beyond the Solar System. */
export function distanceText(m: number): string {
  return m < 0.01 * LY ? formatDistance(m) : lightYears(m);
}

/** a distance in light years, in words a list can show */
function lightYears(m: number): string {
  const ly = m / LY;
  if (ly >= 1e9) return `${(ly / 1e9).toFixed(ly < 1e10 ? 1 : 0)} billion light years`;
  if (ly >= 1e6) return `${(ly / 1e6).toFixed(ly < 1e7 ? 1 : 0)} million light years`;
  if (ly >= 1e4) return `${Math.round(ly / 1000).toLocaleString('en-US')} thousand light years`;
  if (ly >= 100) return `${Math.round(ly).toLocaleString('en-US')} light years`;
  return `${ly.toFixed(ly < 10 ? 2 : 1)} light years`;
}

/** The sections of the Explore sheet, in order. */
export const CATEGORIES = [
  ['tour', 'Tour'], ['solar', 'Solar System'], ['moons', 'Moons'], ['small', 'Small worlds'], ['stars', 'Stars'], ['exo', 'Real exoplanets'],
  ['nebulae', 'Nebulae'], ['galaxies', 'Galaxies'], ['holes', 'Black holes'], ['craft', 'Spacecraft'], ['places', 'Places'],
] as const;
export type Category = (typeof CATEGORIES)[number][0];

/** The objects of a section (those the app has: a list never shows a name it cannot take you to). */
export function objectsOf(app: App, category: Category): SpaceObject[] {
  const named = (names: string[]) => names.map((n) => app.findByName(n)).filter(nonNull);
  switch (category) {
    case 'solar': return [...named(PLANETS), ...app.made.filter((b) => b.kind !== 'moon')];
    case 'moons': return [...MOON_PARENTS.flatMap((p) => measuredMoons(app, p).slice(0, 6)), ...app.made.filter((b) => b.kind === 'moon')];
    case 'small': return [...smallWorlds(app), ...comets(app)];
    case 'stars': return named(STARS);
    case 'exo': return named(EXOPLANETS);
    case 'nebulae': return named(NEBULAE);
    case 'galaxies': return [app.milkyWay, ...named(GALAXIES)];
    case 'holes': return HOLES.map((n) => app.blackHoles.find((h) => h.name === n)).filter(nonNull);
    case 'craft': return app.craft.craft.filter((c) => c.valid);
    case 'places': {
      const all = app.landmarks;
      const first = HIGHLIGHTS.map((n) => all.find((l) => l.name === n)).filter(nonNull);
      return [app.findByName("Saturn's rings"), ...first, ...all.filter((l) => !first.includes(l))].filter(nonNull);
    }
    default: return [];
  }
}

/** A planet's moons of measured size, largest first. */
export function measuredMoons(app: App, parent: string): Body[] {
  const p = app.system.bodies.find((b) => b.name === parent);
  return app.system.bodies.filter((b) => b.kind === 'moon' && b.parent === p && !b.radiusEstimated).sort((x, y) => y.radius - x.radius);
}

/** The largest dwarf planets, asteroids and trans-Neptunian objects of measured size. */
export function smallWorlds(app: App): Body[] {
  return app.system.bodies
    .filter((b) => (b.kind === 'dwarf' || b.kind === 'asteroid' || b.kind === 'tno') && !b.radiusEstimated)
    .sort((x, y) => y.radius - x.radius)
    .slice(0, 8);
}

/** The best-known comets the app has elements for. */
export function comets(app: App): SpaceObject[] {
  const out: SpaceObject[] = [];
  for (const n of COMETS) {
    const c = app.small.cometObjects.find((x) => x.name.includes(n));
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

export function nonNull<T>(x: T | null | undefined): x is T {
  return x !== null && x !== undefined;
}
