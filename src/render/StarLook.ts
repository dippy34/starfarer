import { Vector2, Vector3, Vector4 } from 'three';

/**
 * How a particular star looks up close, derived from its temperature, size and brightness plus a
 * per-star seed: no two stars look alike, and each looks like its kind.
 *
 * A star's face is drawn the way the space observatories show the Sun's (SDO, SOHO: the pictures
 * of a star that everyone knows): glowing plasma, mottled and threaded all over, hotter where it
 * is brighter; white-hot active regions in two belts either side of the equator; a ragged edge
 * with prominences standing on it. (Not as a telescope with a white-light filter shows it: a pale
 * disc with a dark limb and a few dots. Said so in the README.)
 *
 *  - Its colour is its kind's, and stronger than the black body's own pale tint: a red dwarf deep
 *    red, the Sun orange, an F star gold, an A star white, an O star blue (faceColor).
 *  - A cool star's convection shows in the texture: fine on a dwarf, a handful of giant cells
 *    across a red supergiant (as interferometric images of Betelgeuse and Antares show). A hot
 *    star's envelope carries its heat by radiation: its face is nearly smooth; many spin fast,
 *    which flattens them and darkens their equators (as interferometry shows for Vega and Altair).
 *  - Magnetic activity (active regions, flares, prominences) is strongest in cool dwarfs, and
 *    varies from star to star.
 */

/** The most active regions a star's face is drawn with (the length of the shader's list). */
export const SPOT_SLOTS = 16;

/** One part of an active region: a spot of a group's (the leader, the follower behind it, a lesser one between). */
export interface StarSpot {
  /** latitude, and longitude at time 0 (rad; the spin axis is the pole) */
  lat: number;
  lon: number;
  /** angular radius of its core on the star (rad); the bright ground round it reaches four times as far */
  size: number;
}

/** The most prominences drawn round a star at a time (the length of the corona shader's list). */
export const PROM_SLOTS = 8;

/**
 * A prominence: gas held up by the magnetic field between two feet on the surface. Over an active
 * region it is a loop from one spot to the other; away from them a curtain hanging along the line
 * between two fields, for weeks. It goes round with the star, and is seen where the turning
 * carries it to the limb.
 */
export interface StarProm {
  /** its feet: latitude, and longitude at time 0 (rad) */
  a: { lat: number; lon: number };
  b: { lat: number; lon: number };
  /** how high its top stands over the surface (star radii) */
  height: number;
  /** a loop of light between its feet (false) or a curtain filling the space under it (true) */
  curtain: boolean;
}

export interface StarLook {
  seed: number;
  /** the face's colour where it is as bright as its mean, as the display shows it (linear sRGB, 0 to 1) */
  face: [number, number, number];
  /** the scale of the texture that stands out (threads across a radius), and its contrast */
  texFreq: number;
  texAmp: number;
  /** unevenness of the whole face: brighter and darker over tenths of the radius */
  mottle: number;
  /** the star's active regions (none on a hot star or a quiet one), and how bright they are */
  spots: StarSpot[];
  active: number;
  /**
   * The limb against the middle of the face: brighter (> 0: the glowing skin of a cool star, seen
   * edge on) or darker (< 0: a hot star's photosphere, whose limb shows cooler layers).
   */
  limb: number;
  /** visible rotation of surface features (rad/s at the equator, sped up so they can be seen move) */
  rotRate: number;
  /** how much slower the poles go round than the equator (the Sun's: a quarter) */
  shear: number;
  /** how fast the surface seethes (turns of its cycle per second: sped up like the rotation) */
  boilRate: number;
  /** polar flattening (0 = sphere) and equatorial gravity darkening */
  flattening: number;
  gravDark: number;
  /** rotation axis (unit, world) */
  axis: Vector3;
  /** corona/glow strength, and how much of it is streamers and rays (a hot star's wind is smooth) */
  corona: number;
  rays: number;
  /** how bright the ragged skin at the limb is (0: the star has none) */
  chromosphere: number;
  /** prominence activity (0: none), and the prominences themselves */
  prominences: number;
  proms: StarProm[];
  /** chance of a flare being under way at any moment */
  flares: number;
}

/**
 * The level (before the tone curve) of a star's face's mean brightness at which it is shown as
 * designed: STAR_FRAG works in the display's own colours and undoes the tone curve from this
 * level; the exposure aims at it for a disk large enough to show its face (App: starCap).
 */
export const FACE_KEY = 0.55;

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A star's face colour by its temperature (K): what the display shows where the face is as bright
 * as its mean (linear sRGB). The Sun's is the orange of the observatories' pictures; cooler stars
 * are redder, hotter ones gold, then white, then blue. (Between the rows: by log temperature.)
 */
const FACE_COLORS: [number, number, number, number][] = [
  [2500, 0.66, 0.022, 0.0008],
  [3200, 0.70, 0.036, 0.0012],
  [3700, 0.74, 0.056, 0.0018],
  [4300, 0.77, 0.082, 0.0026],
  [5000, 0.78, 0.104, 0.0034],
  [5772, 0.78, 0.120, 0.0040],
  [6500, 0.82, 0.270, 0.0200],
  [7000, 0.83, 0.420, 0.0700],
  [7500, 0.84, 0.560, 0.2000],
  [8000, 0.82, 0.660, 0.4200],
  [8500, 0.78, 0.730, 0.6400],
  [9000, 0.70, 0.720, 0.8000],
  [10000, 0.50, 0.600, 0.9000],
  [12000, 0.33, 0.470, 0.9100],
  [15000, 0.22, 0.380, 0.9100],
  [25000, 0.14, 0.260, 0.9100],
];
export function faceColor(teff: number): [number, number, number] {
  const T = Math.max(teff || 5800, 1);
  const rows = FACE_COLORS;
  if (T <= rows[0][0]) return [rows[0][1], rows[0][2], rows[0][3]];
  for (let i = 1; i < rows.length; i++) {
    if (T > rows[i][0]) continue;
    const a = rows[i - 1], b = rows[i];
    const t = Math.log(T / a[0]) / Math.log(b[0] / a[0]);
    return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
  }
  const last = rows[rows.length - 1];
  return [last[1], last[2], last[3]];
}

/** The brightest a colour of the face's is shown (STAR_FRAG: fire). */
export const FACE_TOP = 0.92;

/**
 * How each colour of a face answers to its brightness I (1: the mean): 0.92 (1 - exp(-k I^p)).
 * The colour the face is strongest in is there at any brightness; one it has little of comes in
 * steeply, the less of it the more steeply. So what is darker is deeper in the star's own colour
 * (on the Sun: red), what is brighter paler (yellow), and the brightest white-hot.
 */
export function faceResponse(face: [number, number, number]): { k: [number, number, number]; p: [number, number, number] } {
  const k = face.map((c) => -Math.log(1 - Math.min(c, FACE_TOP - 0.005) / FACE_TOP)) as [number, number, number];
  const p = face.map((c) => 1 + 1.05 * -Math.log10(Math.max(c, 1e-4))) as [number, number, number];
  return { k, p };
}

/**
 * What the display shows where a face is `I` times as bright as its mean (linear sRGB): the same
 * arithmetic as the shader's (STAR_FACE_GLSL: fire).
 */
export function fire(face: [number, number, number], I: number): [number, number, number] {
  const { k, p } = faceResponse(face);
  return k.map((kc, c) => FACE_TOP * (1 - Math.exp(-kc * Math.max(I, 0) ** p[c]))) as [number, number, number];
}

/**
 * The display's tone curve the other way round (shaders/tone.ts: spToneCurve): the light that it
 * shows at brightness `yt`.
 */
export function untone(yt: number): number {
  const y = Math.min(yt, 0.985);
  const a = 1 - 0.983729 * y, b = 0.0245786 - 0.432951 * y, c = -(0.000090537 + 0.238081 * y);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/** The light to write for a face's colour at brightness `I`, so that the display shows fire(face, I) (the shader's faceLight). */
export function faceLight(face: [number, number, number], I: number): [number, number, number] {
  const d = fire(face, I);
  const y = Math.max(0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2], 1e-5);
  const k = untone(y) / y;
  return [d[0] * k, d[1] * k, d[2] * k];
}

/**
 * The active regions of a star of activity `activity` (0: none), from the star's own stream of
 * numbers: groups in its active latitudes, each a leader, a smaller follower behind it (the star
 * turns towards greater longitude) and a little nearer the pole, and often a lesser spot between.
 * A sun-like star has a handful of groups between 8 and 30 degrees either side of the equator; an
 * active red dwarf a few vast ones, near its poles if it spins fast; a giant one or two, if any.
 */
function makeSpots(rand: () => number, activity: number, kind: 'dwarf' | 'red dwarf' | 'giant', fast: boolean): { spots: StarSpot[]; pairs: [StarSpot, StarSpot][] } {
  const spots: StarSpot[] = [], pairs: [StarSpot, StarSpot][] = [];
  if (activity <= 0) return { spots, pairs };
  const groups = kind === 'red dwarf' ? 2 + Math.round(3 * activity) : kind === 'giant' ? Math.round(8 * activity) : Math.min(5, Math.round(40 * activity));
  const base = kind === 'red dwarf' ? 0.035 + 0.06 * activity : kind === 'giant' ? 0.035 + 0.1 * activity : 0.022 + 0.11 * activity;
  const deg = Math.PI / 180;
  for (let g = 0; g < groups; g++) {
    const side = (g % 2 ? -1 : 1) * (rand() < 0.8 ? 1 : -1);
    const lat0 = kind === 'red dwarf' ? (fast ? 48 + 30 * rand() : 5 + 55 * rand()) : kind === 'giant' ? 10 + 40 * rand() : 8 + 22 * rand();
    const lat = side * lat0 * deg;
    // spread round the star, so that some are in view from anywhere
    const lon = ((g + 0.8 * rand()) / groups) * 2 * Math.PI;
    const size = base * (0.55 + 0.9 * rand());
    const leader = { lat, lon, size };
    spots.push(leader);
    const behind = (2.1 + 0.8 * rand()) * size / Math.cos(lat);
    const follower = { lat: lat + side * 0.4 * size, lon: lon - behind, size: size * (0.5 + 0.25 * rand()) };
    const lesser = rand(), lesserLat = rand(), lesserLon = rand();
    if (spots.length < SPOT_SLOTS) {
      spots.push(follower);
      pairs.push([leader, follower]);
    }
    if (kind !== 'red dwarf' && lesser > 0.35 && spots.length < SPOT_SLOTS) {
      spots.push({ lat: lat + side * (0.9 * lesserLat - 0.2) * size, lon: lon - behind * (0.35 + 0.3 * lesserLon), size: size * 0.32 });
    }
  }
  return { spots, pairs };
}

/**
 * The prominences of a star of prominence activity `strength`: a loop over each active region,
 * from the leader to the follower and about as high as they are apart; and curtains away from
 * them, at higher latitudes, lying east to west.
 */
function makeProms(rand: () => number, strength: number, pairs: [StarSpot, StarSpot][]): StarProm[] {
  const proms: StarProm[] = [];
  if (strength <= 0) return proms;
  const curtains = Math.max(1, Math.min(4, Math.round(2 + 4 * strength)));
  for (const [a, b] of pairs.slice(0, PROM_SLOTS - curtains)) {
    const apart = Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos(a.lat));
    proms.push({ a: { lat: a.lat, lon: a.lon }, b: { lat: b.lat, lon: b.lon }, height: Math.min(0.3, apart * (0.5 + 0.5 * rand())), curtain: false });
  }
  for (let k = 0; k < curtains; k++) {
    const lat = (k % 2 ? -1 : 1) * (0.45 + 0.5 * rand());
    const lon = ((k + rand()) / curtains) * 2 * Math.PI;
    const half = (0.05 + 0.1 * rand()) * (1 + 1.5 * strength);
    const lean = 0.25 * (rand() - 0.5) * half;
    proms.push({
      a: { lat: lat - lean, lon: lon - half / Math.cos(lat) }, b: { lat: lat + lean, lon: lon + half / Math.cos(lat) },
      height: (0.035 + 0.045 * rand()) * (1 + 2 * strength), curtain: true,
    });
  }
  return proms;
}

/** An active region as a star's own map shows it: latitude, longitude east, radius (degrees). */
export type MapRegion = [number, number, number];

/**
 * The spots of the active regions on a star's map: across each region a leader and a follower,
 * east and west of its middle (as the two polarities of a region on the Sun lie), for a loop to
 * stand on.
 */
function mapSpots(regions: MapRegion[]): { spots: StarSpot[]; pairs: [StarSpot, StarSpot][] } {
  const spots: StarSpot[] = [], pairs: [StarSpot, StarSpot][] = [];
  const deg = Math.PI / 180;
  for (const [lat, lon, radius] of regions.slice(0, SPOT_SLOTS / 2)) {
    const apart = (0.6 * radius * deg) / Math.cos(lat * deg);
    const leader = { lat: lat * deg, lon: lon * deg + apart, size: 0.4 * radius * deg };
    const follower = { lat: lat * deg, lon: lon * deg - apart, size: 0.3 * radius * deg };
    spots.push(leader, follower);
    pairs.push([leader, follower]);
  }
  return { spots, pairs };
}

/** A stream of numbers in [0, 1) that is the same every time for the same seed (mulberry32). */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `key` identifies the star (stable seed); `teff` K; `radiusSun` in solar radii; `absMag` V.
 * `sun` gives the Sun its measured look (moderate activity, slow rotation): `true`, or the active
 * regions of its map (the textures' manifest: maps.sun.regions), which then are the star's.
 */
export function starLook(key: string, teff: number, radiusSun: number, absMag: number, sun: boolean | MapRegion[] = false): StarLook {
  // (drawn from one stream: hashes of the key with a different ending come out nearly alike)
  const rand = stream(Math.floor(hashString(key) * 4294967296));
  const r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand();
  const T = Math.max(teff || 5800, 1500);
  const R = Math.max(radiusSun, 1e-3);
  // (the radius is estimated without a bolometric correction: a red dwarf, nearly all of whose
  // light is infrared, comes out several times too small. Small and cool is a red dwarf.)
  const whiteDwarf = R < 0.05 && T >= 4500;
  const supergiant = R > 80 || absMag < -4.5;
  const giant = !supergiant && R > 3.5;
  const convective = T < 7200 && !whiteDwarf;
  // activity: cool dwarfs most active, fast-rotating M dwarfs above all
  let activity: number;
  if (whiteDwarf || T > 7200) activity = 0;
  else if (supergiant) activity = 0.3 * r1;
  else if (giant) activity = 0.25 * r1 * r1;
  else if (T < 3900) activity = 0.15 + 0.85 * r1 * r1;
  else if (T < 5300) activity = 0.6 * r1 * r1;
  else activity = 0.4 * r1 ** 3;
  if (sun) activity = 0.12;
  const fast = !sun && (T < 3900 ? r4 > 0.5 : r4 > 0.85);
  const mapped = typeof sun === 'object';
  const { spots, pairs } = mapped ? mapSpots(sun) : supergiant ? { spots: [], pairs: [] } : makeSpots(rand, activity, giant ? 'giant' : T < 3900 ? 'red dwarf' : 'dwarf', fast);
  const prominences = convective && !supergiant ? Math.min(1, activity * 1.4) : 0;
  const hotRotator = T > 7400 && !whiteDwarf;
  const flattening = hotRotator ? 0.22 * r2 * r2 : 0;
  // a random spin axis
  const u = 2 * r3 - 1, phi = 2 * Math.PI * r4;
  const axis = new Vector3(Math.sqrt(1 - u * u) * Math.cos(phi), Math.sqrt(1 - u * u) * Math.sin(phi), u);
  return {
    seed: r1 * 1000,
    face: faceColor(T),
    // The scale that stands out: the mottling of a dwarf's face, a few hundredths of its radius
    // across; a giant's cells are larger for its size, and a red supergiant has a handful across
    // its whole disk.
    texFreq: supergiant && convective ? 4 + 2 * r2 : giant ? 14 + 6 * r2 : 38 + 14 * r2,
    // (strong on a star whose surface boils; a hot star's is nearly smooth, a white dwarf's all but)
    texAmp: whiteDwarf ? 0.05 : convective ? 0.7 + 0.2 * smooth(3, 200, R) + 0.1 * r3 : 0.16 + 0.08 * r3,
    mottle: whiteDwarf ? 0.03 : convective ? 0.24 + 0.2 * activity + (supergiant ? 0.1 : 0) : 0.07 + 0.04 * r3,
    spots, active: 0.75 + 0.9 * activity,
    limb: convective ? 0 : -0.45,
    rotRate: (fast ? 0.05 : 0.012) * (supergiant ? 0.2 : giant ? 0.4 : 1) * (0.6 + 0.8 * r2),
    // (a map goes round all of a piece)
    shear: mapped ? 0 : convective ? 0.25 : 0.05,
    // (a dwarf's surface changes in minutes, a supergiant's cells in months: all sped up alike)
    boilRate: (supergiant ? 0.012 : giant ? 0.025 : 0.05) * (0.8 + 0.4 * r4),
    flattening, gravDark: flattening * 1.4,
    axis,
    corona: whiteDwarf ? 0.2 : supergiant ? 0.9 : 0.5 + 0.5 * activity + (T > 15000 ? 0.4 : 0),
    // (a cool star's corona is held in streamers by its magnetic field; a hot star's wind and a
    // supergiant's envelope are nearly even all round)
    rays: whiteDwarf ? 0.1 : supergiant ? 0.45 : convective ? 1 : 0.25,
    // (a star with a convection zone has a chromosphere, a ragged glowing skin: the more active,
    // the brighter)
    chromosphere: convective ? 0.5 + 0.5 * prominences : 0,
    prominences, proms: makeProms(rand, prominences, pairs),
    flares: T < 3900 && !giant && !supergiant ? activity * 0.25 : 0,
  };
}

const TAU = 2 * Math.PI;

/**
 * Where a spot is when the star has turned for `turned` seconds at its full rate: unit vector in
 * the star's own frame (z: its spin axis). Each goes round at its own latitude's rate, slower
 * towards the poles (differential rotation).
 */
export function spotAt(look: StarLook, spot: { lat: number; lon: number }, turned: number, out = new Vector3()): Vector3 {
  const s = Math.sin(spot.lat), c = Math.cos(spot.lat);
  const lon = spot.lon + ((look.rotRate * (1 - look.shear * s * s) * turned) % TAU);
  return out.set(c * Math.cos(lon), c * Math.sin(lon), s);
}

/**
 * How far the surface pattern has turned by then (rad, within a turn). It turns all of a piece,
 * at the rate of the latitudes the star's active regions are in (so they stay where they are on it).
 */
export function spinAt(look: StarLook, turned: number): number {
  let s2 = 0;
  for (const sp of look.spots) s2 += Math.sin(sp.lat) ** 2 / look.spots.length;
  return (look.rotRate * (1 - look.shear * s2) * turned) % TAU;
}

/** The fastest the surface under the eye is shown passing (CSS px a second). */
const DRIFT = 6;

/**
 * How much of its full rate a star's turning is shown at from `dist` (m, from its centre; its
 * radius `radius`), a CSS pixel taking `pixelAngle` rad: all of it from afar, where the active
 * regions take minutes to cross the disk. That rate is thousands of times the real one, and from
 * close by the surface would race past, gone before it has changed: there it is slowed, so that
 * what is under the eye passes at DRIFT pixels a second at the most, and seethes in place.
 */
export function turnShare(look: StarLook, radius: number, dist: number, pixelAngle: number): number {
  const pxPerRad = radius / (Math.max(dist - radius, radius * 1e-4) * pixelAngle);
  return Math.min(1, DRIFT / (pxPerRad * look.rotRate));
}

/** Shader uniforms for a star surface (STAR_LOOK_UNIFORMS). `axisBF`: spin axis in the mesh's own frame. */
export function starLookUniforms(look: StarLook, axisBF = new Vector3(0, 0, 1)): Record<string, { value: unknown }> {
  const u: Record<string, { value: unknown }> = {
    uSeed: { value: 0 }, uFaceK: { value: new Vector3() }, uFaceP: { value: new Vector3() },
    uTexFreq: { value: 1 }, uTexAmp: { value: 0 }, uMottle: { value: 0 }, uActive: { value: 0 }, uLimb: { value: 0 },
    uGravDark: { value: 0 }, uAxis: { value: axisBF.clone() }, uFlares: { value: 0 }, uFlat: { value: 0 },
    uSpin: { value: 0 }, uBoil: { value: new Vector2() },
    uSpotList: { value: Array.from({ length: SPOT_SLOTS }, () => new Vector4(0, 0, 1, 0)) }, uSpotCount: { value: 0 },
  };
  applyStarLook(u, look, 0);
  return u;
}

/**
 * Copy a look into existing uniforms, as it is at `time` (s; the surface seethes by it) with the
 * star turned for `turned` seconds at its full rate (turnShare): one material is reused for
 * different stars, and the active regions, the spin and the seething move on every frame.
 */
export function applyStarLook(u: Record<string, { value: unknown }>, look: StarLook, time: number, turned = time): void {
  const { k, p } = faceResponse(look.face);
  (u.uFaceK.value as Vector3).set(...k);
  (u.uFaceP.value as Vector3).set(...p);
  u.uSeed.value = look.seed; u.uTexFreq.value = look.texFreq; u.uTexAmp.value = look.texAmp; u.uMottle.value = look.mottle;
  u.uActive.value = look.active; u.uLimb.value = look.limb;
  u.uGravDark.value = look.gravDark; u.uFlares.value = look.flares; u.uFlat.value = look.flattening;
  u.uSpin.value = spinAt(look, turned);
  // (two cycles in the golden ratio: the surface never comes round to where it was)
  (u.uBoil.value as Vector2).set((look.boilRate * time) % 1, (look.boilRate * 0.6180339887 * time) % 1);
  const list = u.uSpotList.value as Vector4[];
  const n = Math.min(look.spots.length, SPOT_SLOTS);
  for (let i = 0; i < n; i++) {
    spotAt(look, look.spots[i], turned, spotDir);
    list[i].set(spotDir.x, spotDir.y, spotDir.z, look.spots[i].size);
  }
  u.uSpotCount.value = n;
}
const spotDir = new Vector3();
