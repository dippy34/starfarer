/**
 * Targets: the things a player can select, read about, orbit and fly to —
 * bodies of a star system, galaxies and deep-sky objects — with the friendly
 * and (optionally) numeric descriptions shown on the info card.
 */
import { formatDec, formatRa, unitToRaDec } from '../../core/astro';
import { type UPos, uposAddInPlace, uposCopy, uposSub, uposZero } from '../../core/hp';
import { lookbackTimeGyr } from '../../core/cosmology';
import { AU, C, DAY, G, KPC, L_SUN, LY, M_SUN, PC, formatBig, formatDistanceSci, formatDuration, formatMass, formatRadius, formatSig, formatTemperature } from '../../core/units';
import type { DsoRecord } from '../../data/catalog';
import type { DataRow, SelectionInfo } from '../../state/appState';
import { describePlanet, planetTypeLabel } from '../../universe/planet';
import { SOL_BLURBS } from '../../universe/solarSystem';
import { describeStar } from '../../universe/star';
import { bodyPositions } from '../../universe/system';
import type { Body, GalaxyModel, ObjectKind, PlanetBody, StarBody, SystemModel } from '../../universe/types';
import type { CameraTarget } from './cameraController';
import type { GalaxyEntry } from './galaxies';
import type { StarSource } from './systems';

export interface WorldTarget extends CameraTarget {
  id: string;
  kind: ObjectKind;
  real: boolean;
  /** Distance from the centre at which a fly-to stops. */
  arrive: number;
  /** Lowest sensible camera distance (surface). */
  canLand: boolean;
  system?: SystemModel;
  bodyIndex?: number;
  source?: StarSource | null;
  galaxy?: GalaxyEntry;
  dso?: DsoRecord;
  /** Build the info card (distance is filled in live by the caller). */
  info(): Omit<SelectionInfo, 'distance'>;
}

const SUN = uposZero();
const tmp = { x: 0, y: 0, z: 0 };
const row = (label: string, value: string, estimated = false): DataRow => ({ label, value, estimated });

/** Sky position + distance from the Sun rows for anything with a fixed position. */
function skyRows(pos: UPos, cosmological = false): DataRow[] {
  uposSub(pos, SUN, tmp);
  const d = Math.hypot(tmp.x, tmp.y, tmp.z);
  if (d < 1e10) return [];
  const { ra, dec } = unitToRaDec(tmp);
  return [row(cosmological ? 'From the Milky Way' : 'From the Sun', formatDistanceSci(d)), row('Right ascension', formatRa(ra)), row('Declination', formatDec(dec))];
}

function starInfo(sys: SystemModel, body: StarBody): Omit<SelectionInfo, 'distance'> {
  const p = body.star;
  const est = p.estimated;
  const rows: DataRow[] = [];
  if (p.type === 'blackhole') {
    rows.push(row('Mass', formatMass(p.mass)), row('Event horizon', `${formatSig(p.schwarzschildRadius / 1000)} km`), row('Schwarzschild radius', formatDistanceSci(p.schwarzschildRadius)));
  } else {
    rows.push(row('Spectral class', p.spectral), row('Temperature', formatTemperature(p.teff), est), row('Mass', formatMass(p.mass), est), row('Radius', formatRadius(p.radius, true), est));
    rows.push(row('Luminosity', `${formatSig(p.luminosity / L_SUN)} × Sun`, est), row('Surface gravity', `${formatSig((G * p.mass) / (p.radius * p.radius) / 9.80665)} g`, est), row('Absolute magnitude', p.absMag.toFixed(2)));
    if (p.type === 'pulsar') rows.push(row('Spin period', formatDuration(p.rotationPeriod)));
    if (p.magneticField > 0) rows.push(row('Magnetic field', `${p.magneticField.toExponential(1)} T`, true));
  }
  if (body.orbit) rows.push(row('Orbital period', formatDuration(body.orbit.period)), row('Orbit size', formatDistanceSci(body.orbit.a)));
  const planets = sys.bodies.filter((b) => b.kind === 'planet').length;
  rows.push(row('Planets', planets ? String(planets) : sys.real && !sys.bodies.some((b) => b.kind === 'planet' && b.real) ? 'none known' : '0'));
  rows.push(...skyRows(sys.origin));
  const typeName =
    p.type === 'blackhole' ? 'Black hole' : p.type === 'pulsar' ? 'Pulsar' : p.type === 'neutron' ? 'Neutron star' : p.type === 'whitedwarf' ? 'White dwarf' : p.type === 'browndwarf' ? 'Brown dwarf' :
    p.type === 'supergiant' ? 'Supergiant star' : p.type === 'giant' ? 'Giant star' : p.type === 'subgiant' ? 'Subgiant star' : 'Star';
  return {
    id: body.id, name: body.name, type: typeName, description: SOL_BLURBS[body.id] ?? describeStar(p), real: body.real,
    source: body.id.startsWith('sol:') ? 'Solar System · NASA/JPL' : body.real ? 'Real star · Gaia DR3 / Hipparcos' : 'Procedurally generated', rows, pending: false, canLand: false,
  };
}

function planetInfo(sys: SystemModel, body: PlanetBody): Omit<SelectionInfo, 'distance'> {
  const n = body.notes;
  const rows: DataRow[] = [
    row('Mass', formatMass(body.mass), n.massEstimated === 1), row('Radius', formatRadius(body.radius), n.radiusEstimated === 1), row('Gravity', `${formatSig(body.gravity / 9.80665)} g`, n.massEstimated === 1 || n.radiusEstimated === 1),
    row(body.type === 'gasgiant' || body.type === 'icegiant' ? 'Cloud-top temperature' : 'Surface temperature', formatTemperature(body.tSurface), !body.id.startsWith('sol:')),
  ];
  if (body.orbit) {
    const parent = sys.bodies[Math.max(0, body.parent)]!;
    rows.push(row(body.kind === 'moon' ? 'Orbital period' : 'Year', formatDuration(body.orbit.period), n.orbitEstimated === 1));
    rows.push(row(body.kind === 'moon' ? `Distance from ${parent.name}` : 'Distance from star', formatDistanceSci(body.orbit.a), n.orbitEstimated === 1));
    if (body.orbit.e > 0.005) rows.push(row('Orbit eccentricity', body.orbit.e.toFixed(3)));
  }
  rows.push(row('Day', n.tidallyLocked === 1 ? 'tidally locked' : formatDuration(Math.abs(body.rotationPeriod)), !body.real || !body.id.startsWith('sol:')));
  if (body.atmosphere) rows.push(row('Atmosphere', `${body.atmosphere.composition} · ${formatSig(body.atmosphere.pressure)} bar`, !body.id.startsWith('sol:')));
  else rows.push(row('Atmosphere', 'none'));
  if (body.kind === 'planet') rows.push(row('Habitable zone', body.habitableZone ? 'yes' : 'no'));
  if (body.rings) rows.push(row('Rings', 'yes'));
  if (typeof n.method === 'string') rows.push(row('Discovered', `${n.method}${n.year ? `, ${n.year}` : ''}`));
  if (typeof n.facility === 'string') rows.push(row('Discovered by', n.facility));
  const exo = body.real && !body.id.startsWith('sol:');
  return {
    id: body.id, name: body.name, type: `${planetTypeLabel(body.type)}${body.kind === 'moon' ? ' (moon)' : ''}`,
    description: SOL_BLURBS[body.id] ?? (exo ? `A confirmed exoplanet. ${describePlanet(body)} (How it looks is an artist’s impression.)` : describePlanet(body)),
    real: body.real, source: body.id.startsWith('sol:') ? 'Solar System · NASA/JPL' : exo ? 'Confirmed exoplanet · NASA Exoplanet Archive' : 'Procedurally generated', rows, pending: false,
    canLand: body.type !== 'gasgiant' && body.type !== 'icegiant',
  };
}

/** A body of a star system as a target. `simTime` is read lazily so the target tracks the body. */
export function bodyTarget(sys: SystemModel, index: number, simTime: () => number, source: StarSource | null = null): WorldTarget {
  const body = sys.bodies[index]!;
  const scratch = new Float64Array(sys.bodies.length * 3);
  const star = body.kind === 'star' ? body : null;
  let arrive: number;
  if (star) {
    const t = star.star.type;
    arrive = t === 'blackhole' ? body.radius * 45 : t === 'neutron' || t === 'pulsar' ? 150_000 : t === 'whitedwarf' ? body.radius * 8 : body.radius * 5.5;
    // In a close binary, stand back far enough to take in both stars.
    // (Not for black holes: the point of visiting one is to be close enough to see it.)
    if (t !== 'blackhole') for (const other of sys.bodies) if (other !== body && other.kind === 'star' && other.orbit && other.orbit.a < AU * 2) arrive = Math.max(arrive, other.orbit.a * 3.5);
  } else arrive = body.radius * ((body as PlanetBody).rings ? 6.5 : 3.6);
  return {
    id: body.id, kind: star ? (star.star.type === 'blackhole' ? 'blackhole' : star.star.type === 'pulsar' ? 'pulsar' : 'star') : body.kind, name: body.name, real: body.real, radius: body.radius, arrive,
    canLand: !star && (body as PlanetBody).type !== 'gasgiant' && (body as PlanetBody).type !== 'icegiant',
    system: sys, bodyIndex: index, source,
    position(out) {
      bodyPositions(sys, simTime(), scratch);
      uposCopy(out, sys.origin);
      return uposAddInPlace(out, scratch[index * 3]!, scratch[index * 3 + 1]!, scratch[index * 3 + 2]!);
    },
    info: () => (star ? starInfo(sys, star) : planetInfo(sys, body as PlanetBody)),
  };
}

/** Distance-method codes of the Updated Nearby Galaxy Catalog (Karachentsev et al. 2013). */
const DIST_METHOD: Record<string, string> = {
  Cep: 'Cepheid variable stars', TRGB: 'tip of the red-giant branch', SBF: 'surface-brightness fluctuations', TF: 'Tully–Fisher relation', mem: 'membership of a group',
  BS: 'brightest stars', HB: 'horizontal-branch stars', CMD: 'colour–magnitude diagram', h: 'redshift (Hubble flow)', "h'": 'redshift (Hubble flow)', txt: 'published measurement',
  SN: 'supernova', RR: 'RR Lyrae stars', PNLF: 'planetary-nebula luminosity function', FP: 'fundamental plane',
};

const GALAXY_TYPE: Record<GalaxyModel['type'], [string, string]> = {
  spiral: ['Spiral galaxy', 'A grand pinwheel of stars, gas and dust, with bright young stars lighting up its arms.'],
  barred: ['Barred spiral galaxy', 'A spiral galaxy whose arms unwind from the ends of a central bar of stars.'],
  elliptical: ['Elliptical galaxy', 'A vast, smooth swarm of old golden stars with almost no gas left to make new ones.'],
  lenticular: ['Lenticular galaxy', 'A disc of old stars without spiral arms — halfway between a spiral and an elliptical.'],
  irregular: ['Irregular galaxy', 'A ragged, shapeless galaxy bursting with newborn stars.'],
  dwarf: ['Dwarf galaxy', 'A small, faint galaxy of just a few million to a few billion stars.'],
  ring: ['Ring galaxy', 'A galaxy with a brilliant ring of young stars — the splash left by a head-on collision.'],
};

export function galaxyTarget(entry: GalaxyEntry): WorldTarget {
  const g = entry.model;
  const [typeName, blurb] = GALAXY_TYPE[g.type];
  const quasar = g.activity > 0.8;
  return {
    id: g.id, kind: quasar ? 'quasar' : 'galaxy', name: quasar && !g.real ? `${g.name} Quasar` : g.real || g.id === 'mw' ? g.name : `${g.name} Galaxy`, real: g.real, radius: g.radius * KPC, arrive: g.radius * KPC * 2.3, canLand: false, galaxy: entry,
    position: (out) => uposCopy(out, entry.center),
    info() {
      const rows: DataRow[] = [row('Class', g.hubble), row('Diameter', `${formatSig((g.radius * 2 * KPC) / LY / 1000)} thousand light-years`, g.real && g.id !== 'mw'), row('Stars', `about ${formatBig(g.starCount)}`, true)];
      rows.push(row('Absolute magnitude', g.absMag.toFixed(1)), row('Central black hole', `${formatBig(g.smbhMassSun)} × Sun`, g.id !== 'mw'));
      if (entry.velocity !== undefined) rows.push(row('Radial velocity', `${formatSig(entry.velocity, 4)} km/s (${entry.velocity < 0 ? 'approaching us' : 'receding'})`));
      // Very nearby galaxies are placed by measured distances, not by redshift: their stored redshift is just that distance re-expressed.
      const z = entry.redshift;
      if (z !== undefined && z >= 0.003) {
        rows.push(row('Redshift', `z = ${z.toFixed(z < 0.1 ? 4 : 3)}`));
        if (entry.velocity === undefined && z < 0.3) rows.push(row('Recession velocity', `${formatSig(z * (C / 1000), 4)} km/s`));
        if (z >= 0.01) rows.push(row('Light left it', `${formatSig(lookbackTimeGyr(z) * (z < 0.07 ? 1000 : 1))} ${z < 0.07 ? 'million' : 'billion'} years ago`));
      }
      if (g.real && g.id !== 'mw') rows.push(row('Distance from', entry.distMethod ? (DIST_METHOD[entry.distMethod] ?? 'published measurement') : 'redshift (Hubble flow)'));
      if (entry.designation && entry.designation !== g.name) rows.push(row('Catalogue', entry.designation));
      if (g.id !== 'mw') rows.push(...skyRows(entry.center, true));
      const active = g.activity > 0.8 ? ' Its core is a quasar: a supermassive black hole swallowing matter and outshining the entire galaxy.' : g.activity > 0.25 ? ' Its core is active — a feeding supermassive black hole.' : '';
      const collide = g.companion ? ' It is caught in a slow-motion collision with a neighbour.' : '';
      return {
        id: g.id, name: this.name, type: quasar ? 'Quasar' : typeName, description: g.id === 'mw' ? 'Our home galaxy: a barred spiral of over a hundred billion stars, one of which is the Sun.' : blurb + active + collide, real: g.real,
        source: g.id === 'mw' ? 'Our galaxy' : g.real ? `Real galaxy · ${entry.designation?.startsWith('SDSS') ? 'Sloan Digital Sky Survey' : '2MASS Redshift Survey / OpenNGC'} (shape is an artist’s impression)` : 'Procedurally generated', rows, pending: false, canLand: false,
      };
    },
  };
}

const DSO_TYPE: Record<DsoRecord['t'], [string, string, ObjectKind]> = {
  oc: ['Open star cluster', 'A family of young stars born together from the same cloud, slowly drifting apart.', 'cluster'],
  gc: ['Globular cluster', 'A dense ball of hundreds of thousands of ancient stars — among the oldest things in the galaxy.', 'cluster'],
  pn: ['Planetary nebula', 'The glowing shell a dying Sun-like star puffed into space, lit by the white-hot core left behind.', 'nebula'],
  en: ['Emission nebula', 'A stellar nursery: a cloud of hydrogen glowing pink where newborn stars set it alight.', 'nebula'],
  rn: ['Reflection nebula', 'A cloud of dust shining blue with the reflected light of nearby stars.', 'nebula'],
  dn: ['Dark nebula', 'A cold, inky cloud of dust that blots out the stars behind it.', 'nebula'],
  snr: ['Supernova remnant', 'The expanding wreckage of a star that blew itself apart.', 'nebula'],
  psr: ['Pulsar', 'A spinning neutron star sweeping beams of radiation through space like a lighthouse.', 'pulsar'],
  bh: ['Black hole', 'A place where gravity has won: not even light can escape.', 'blackhole'],
  qso: ['Quasar', 'A supermassive black hole feeding so fast that it outshines its whole galaxy.', 'quasar'],
};

/** Default physical radius (metres) of a deep-sky object when the catalogue gives no size. */
export function dsoRadius(d: DsoRecord): number {
  if (d.r) return d.r * PC;
  return (d.t === 'gc' ? 20 : d.t === 'oc' ? 4 : d.t === 'pn' ? 0.25 : d.t === 'snr' ? 8 : d.t === 'qso' ? 20_000 : 6) * PC;
}

export function dsoTarget(d: DsoRecord, index: number, pos: UPos): WorldTarget {
  const [typeName, blurb, kind] = DSO_TYPE[d.t];
  const radius = dsoRadius(d);
  return {
    id: `dso:${index}:${d.n}`, kind, name: d.n, real: true, radius, arrive: radius * 2.6, canLand: false, dso: d,
    position: (out) => uposCopy(out, pos),
    info() {
      const x = d.x ?? {};
      const rows: DataRow[] = [];
      if (d.r) rows.push(row('Size', `${formatSig((d.r * 2 * PC) / LY)} light-years across`));
      if (d.m !== undefined) rows.push(row('Apparent magnitude', d.m.toFixed(1)));
      if (typeof x.stars === 'number') rows.push(row('Member stars (Gaia)', String(x.stars)));
      if (typeof x.age === 'number') rows.push(row('Age', formatDuration(x.age * 365.25 * DAY)));
      if (typeof x.period === 'number') rows.push(row('Spin period', formatDuration(x.period)));
      if (typeof x.massSun === 'number') rows.push(row('Mass', formatMass(x.massSun * M_SUN)));
      if (typeof x.feh === 'number') rows.push(row('Metallicity [Fe/H]', x.feh.toFixed(2)));
      if (d.z !== undefined) rows.push(row('Redshift', `z = ${d.z}`));
      rows.push(...skyRows(pos, d.t === 'qso'));
      return { id: this.id, name: d.n, type: typeName, description: blurb, real: true, source: `Real object · ${typeof x.src === 'string' ? x.src : 'OpenNGC'}`, rows, pending: false, canLand: false };
    },
  };
}

/** Is the straight line from `from` to `to` blocked by body `index` of the active system? Returns the body's radius if so. */
export function blockedBy(sys: SystemModel | null, bodyPos: Float64Array, from: UPos, to: UPos): number {
  if (!sys) return 0;
  uposSub(to, from, tmp);
  const len = Math.hypot(tmp.x, tmp.y, tmp.z);
  if (len < 1) return 0;
  const dx = tmp.x / len;
  const dy = tmp.y / len;
  const dz = tmp.z / len;
  uposSub(sys.origin, from, tmp);
  const ox = tmp.x;
  const oy = tmp.y;
  const oz = tmp.z;
  for (let i = 0; i < sys.bodies.length; i++) {
    const b: Body = sys.bodies[i]!;
    const cx = ox + bodyPos[i * 3]!;
    const cy = oy + bodyPos[i * 3 + 1]!;
    const cz = oz + bodyPos[i * 3 + 2]!;
    const along = cx * dx + cy * dy + cz * dz;
    if (along <= 0 || along >= len) continue;
    const off2 = cx * cx + cy * cy + cz * cz - along * along;
    if (off2 < b.radius * b.radius * 1.2) return b.radius;
  }
  return 0;
}

