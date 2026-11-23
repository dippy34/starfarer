import { Matrix4, Vector2, Vector3 } from 'three';
import { type Finish, GROUP, MeshBuilder, PATTERN, roundedPolygon, roundedPolyline } from './shipGeometry';
import { paintText, textWidth } from './stencil';

/**
 * The player's ship, designed here (original: a surveyor of the near future, not any film's).
 * About 18 m long, nose towards -z, up +y, starboard +x:
 *  - a crew cabin shaped as a lifting body (it lands on worlds): painted plates over a frame, a
 *    dark tiled heat shield underneath, a wraparound canopy on top with slim frame members (the
 *    same ones the cockpit view looks out between);
 *  - a waist carrying the reactionless drive's emitter band (the invented drive: it pushes with no
 *    exhaust, so all it shows is the band's glow);
 *  - two radiators swept back like wings: a fusion torch must reject its waste heat, and they glow
 *    a dull red while it burns; the navigation lights on their tips (red to port, green to
 *    starboard), a strobe on the engine;
 *  - the fusion torch: the reactor's housing and a magnetic nozzle (field coils held by struts
 *    round an open throat), the plume a glow that follows the throttle.
 * Pure geometry (no three.js objects but its maths): `ShipModel` makes the meshes.
 */

export interface GlowSpec {
  /** model-space centre (m) */
  at: [number, number, number];
  color: [number, number, number];
  /** half-size of the quad (m) */
  size: number;
  /** light channel (0 cabin, 1 port, 2 starboard, 3 strobe, 4 field, 5 throat, 6 beacon, 7 plume) */
  channel: number;
  /** 0 a lamp's halo, 1 a puff of the plume, 2 a streak */
  shape: number;
}

export interface ShipDesign {
  hull: MeshBuilder;
  glows: GlowSpec[];
  /** the lamps that light the hull near them: port, starboard, strobe */
  lamps: [Vector3, Vector3, Vector3];
  /** where the plume leaves the nozzle (model space), and its axis */
  throat: Vector3;
  /** length and span (m) */
  length: number;
  span: number;
  /** what the ship covers, coarsely, for the names' mask: thick segments (ends, radius) and the radiators' quads */
  cover: { capsules: [Vector3, Vector3, number][]; quads: Vector3[][] };
}

// finishes (base colours linear; `hull` and `trim` groups take the look's own paint)
const PAINT: Finish = { color: [1, 1, 1], rough: 0.42, metal: 0, pattern: PATTERN.paint, group: GROUP.hull };
const PAINT_DARK: Finish = { color: [0.36, 0.37, 0.39], rough: 0.5, metal: 0, pattern: PATTERN.paint, group: GROUP.hull };
const TRIM: Finish = { color: [1, 1, 1], rough: 0.45, metal: 0, pattern: PATTERN.plain, group: GROUP.trim };
const TILES: Finish = { color: [0.05, 0.05, 0.055], rough: 0.78, metal: 0, pattern: PATTERN.tiles };
const RADIATOR: Finish = { color: [1, 1, 1], rough: 0.5, metal: 0, pattern: PATTERN.radiator, group: GROUP.radiator };
const TITANIUM: Finish = { color: [0.6, 0.58, 0.56], rough: 0.42, metal: 1, pattern: PATTERN.brushed };
const STEEL: Finish = { color: [0.55, 0.56, 0.58], rough: 0.4, metal: 1, pattern: PATTERN.brushed };
const DARK_METAL: Finish = { color: [0.12, 0.12, 0.13], rough: 0.45, metal: 1, pattern: PATTERN.dark };
/** the field coils' housings: insulated, painted a light grey (they are cryogenic) */
const COIL: Finish = { color: [0.72, 0.73, 0.74], rough: 0.38, metal: 0, pattern: PATTERN.plain, group: GROUP.hull };
const BLACK: Finish = { color: [0.03, 0.03, 0.032], rough: 0.32, metal: 0, pattern: PATTERN.dark };
const GOLD: Finish = { color: [1.0, 0.72, 0.32], rough: 0.28, metal: 1, pattern: PATTERN.foil };
const GLASS: Finish = { color: [0.006, 0.007, 0.009], rough: 0.06, metal: 0, pattern: PATTERN.glass, group: GROUP.cabin };
/** the radiators' frame: booms, joint bars and tip pods painted a light grey, so that any light the
 * panels catch (the star's, the world's) draws their outline against black space */
const RAD_EDGE: Finish = { color: [0.6, 0.61, 0.62], rough: 0.36, metal: 0, pattern: PATTERN.plain };
const MARK: Finish = { color: [1, 1, 1], rough: 0.5, metal: 0, pattern: PATTERN.plain, group: GROUP.radiatorMark };
const MARK_DARK: Finish = { color: [1, 1, 1], rough: 0.5, metal: 0, pattern: PATTERN.plain, group: GROUP.hullMark };
const lamp = (color: [number, number, number], group: number): Finish => ({ color, rough: 0.3, metal: 0, pattern: PATTERN.emit, group });
const FIELD: Finish = { color: [1, 1, 1], rough: 0.3, metal: 0, pattern: PATTERN.emit, group: GROUP.field };
const THROAT: Finish = { color: [0.75, 0.85, 1.0], rough: 0.3, metal: 0, pattern: PATTERN.emit, group: GROUP.throat };
/** the bell's inside: dark metal, lit by the throat while the torch burns, glowing with its heat after */
const BELL_INSIDE: Finish = { color: [0.16, 0.15, 0.15], rough: 0.4, metal: 1, pattern: PATTERN.bell, group: GROUP.throat };

/** The cabin's cross-section at a station: the top (paint, chine over the crown to chine) and the belly (tiles). */
function cabinSection(W: number, Ht: number, Hb: number): { top: Vector2[]; belly: Vector2[] } {
  const w = W / 2;
  const top = roundedPolyline([
    [w * 0.93, -Hb], [w, -Hb * 0.3], [w * 0.7, Ht * 0.72], [0, Ht], [-w * 0.7, Ht * 0.72], [-w, -Hb * 0.3], [-w * 0.93, -Hb],
  ], [0, W * 0.25, W * 0.3, W * 0.9, W * 0.3, W * 0.25, 0], 3);
  const belly = roundedPolyline([[-w * 0.93, -Hb], [0, -Hb * 1.1], [w * 0.93, -Hb]], [0, W * 1.5, 0], 6);
  return { top, belly };
}

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** Rings of a section list in 3D (x, y offsets per station; z the station). */
function rings(stations: { z: number; pts: Vector2[]; dy?: number }[]): Vector3[][] {
  return stations.map((s) => s.pts.map((p) => V(p.x, p.y + (s.dy ?? 0), s.z)));
}

export function buildShip(): ShipDesign {
  const b = new MeshBuilder();
  const glows: GlowSpec[] = [];

  // ---- the cabin: a lifting body from the nose to the waist
  // stations: z, width, height above the chine line's centre, depth below it
  const st: [number, number, number, number][] = [
    [-9.0, 0.16, 0.06, 0.06],
    [-8.85, 0.62, 0.22, 0.2],
    [-8.4, 1.22, 0.44, 0.34],
    [-7.6, 1.86, 0.68, 0.46],
    [-6.5, 2.45, 0.9, 0.56],
    [-5.3, 2.84, 1.06, 0.63],
    [-4.1, 3.02, 1.14, 0.67],
    [-2.9, 3.04, 1.14, 0.68],
    [-2.1, 2.86, 1.06, 0.66],
    [-1.5, 2.3, 0.95, 0.66],
    [-1.1, 2.08, 0.92, 0.66],
  ];
  const secs = st.map(([z, W, Ht, Hb]) => ({ z, ...cabinSection(W, Ht, Hb) }));
  // (stations run nose to tail, +z; the outlines run counter-clockwise, right over the top to left
  // and left under the belly to right: flipped, the faces turn outwards)
  b.grid(rings(secs.map((s) => ({ z: s.z, pts: s.top }))), PAINT, false, true);
  b.grid(rings(secs.map((s) => ({ z: s.z, pts: s.belly }))), TILES, false, true);
  // the nose's tip, closed
  {
    const first = secs[0];
    const tip = [...first.top, ...first.belly.slice(1, -1)].map((p) => V(p.x, p.y, first.z));
    b.cap(tip, V(0, 0, -1), TILES);
  }
  // a dark accent along the chines (the heat shield's edge), and the cabin's flank plates darker
  for (const sgn of [-1, 1]) {
    const edge = secs.slice(1).map((s) => {
      const p = sgn > 0 ? s.top[0] : s.top[s.top.length - 1];
      return V(p.x + sgn * 0.012, p.y + 0.02, s.z);
    });
    b.sweep(edge, roundedPolygon([[0.03, -0.03], [0.03, 0.03], [-0.03, 0.03], [-0.03, -0.03]], 0.012, 1), DARK_METAL, V(0, 1, 0), true);
  }

  // ---- the canopy: a glass dome on the crown, slim dark frame members over it
  const can: [number, number, number][] = [
    // z, half-width, height above the crown line
    [-7.05, 0.18, 0.0],
    [-6.7, 0.58, 0.16],
    [-6.2, 0.86, 0.33],
    [-5.6, 0.98, 0.44],
    [-4.95, 0.98, 0.46],
    [-4.35, 0.9, 0.38],
    [-3.85, 0.7, 0.2],
    [-3.5, 0.4, 0.0],
  ];
  const crown = (z: number) => {
    // the hull's crown height at z (interpolated from the stations)
    for (let i = 0; i + 1 < st.length; i++) {
      if (z >= st[i][0] && z <= st[i + 1][0]) {
        const t = (z - st[i][0]) / (st[i + 1][0] - st[i][0]);
        return st[i][2] + (st[i + 1][2] - st[i][2]) * t;
      }
    }
    return st[st.length - 1][2];
  };
  const dome = (hw: number, h: number) => {
    const pts: Vector2[] = [];
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI;
      const c = Math.cos(a), s = Math.sin(a);
      // a superellipse: fuller shoulders than a circle
      pts.push(new Vector2(hw * Math.sign(c) * Math.abs(c) ** 0.8, -0.12 + (h + 0.12) * Math.abs(s) ** 0.7));
    }
    return pts;
  };
  const canRings = can.map(([z, hw, h]) => ({ z, pts: dome(hw, h), dy: crown(z) - 0.02 }));
  b.grid(rings(canRings), GLASS, false, true);
  // frame members: two pillars and the bow over the windscreen (the rest of the glazing is one piece)
  const frameProfile = roundedPolygon([[0.035, -0.012], [0.035, 0.02], [-0.035, 0.02], [-0.035, -0.012]], 0.01, 1);
  const onDome = (z: number, t: number, lift = 0.012) => {
    // a point on the dome at station z, t from -1 (port) through 0 (top) to 1 (starboard)
    let i = 0;
    while (i + 2 < can.length && can[i + 1][0] < z) i++;
    const k = Math.min(1, Math.max(0, (z - can[i][0]) / (can[i + 1][0] - can[i][0])));
    const hw = can[i][1] + (can[i + 1][1] - can[i][1]) * k, h = can[i][2] + (can[i + 1][2] - can[i][2]) * k;
    const a = ((1 - t) / 2) * Math.PI;
    const c = Math.cos(a), s = Math.sin(a);
    const x = hw * Math.sign(c) * Math.abs(c) ** 0.8, y = -0.12 + (h + 0.12) * Math.abs(s) ** 0.7;
    return V(x, y + crown(z) - 0.02 + lift, z);
  };
  {
    const path = (zs: number[], ts: number[]) => zs.map((z, i) => onDome(z, ts[i]));
    // pillars: from the front corners up and back to the top
    // (each member's profile lies flat on the glass: its up is the dome's outward side where it starts)
    for (const s of [-1, 1]) b.sweep(path([-6.75, -6.45, -6.1, -5.75, -5.4], [s * 0.98, s * 0.8, s * 0.6, s * 0.42, s * 0.3]), frameProfile, BLACK, V(s, 0.35, 0).normalize());
    // the bow over the windscreen
    const arch = (z: number) => Array.from({ length: 11 }, (_, i) => onDome(z, -1 + i / 5));
    b.sweep(arch(-5.4), frameProfile, BLACK, V(-1, 0.1, 0).normalize());
  }
  // a docking collar behind the canopy, its hatch, and the beacon
  {
    // (a lathe's axis is its z: turned to point up, heights above the crown)
    const up = new Matrix4().makeRotationX(-Math.PI / 2).premultiply(new Matrix4().makeTranslation(0, crown(-2.8) - 0.06, -2.8));
    b.lathe([[0.5, 0], [0.5, 0], [0.5, 0.15], [0.42, 0.2], [0.42, 0.2]], 24, STEEL, up);
    b.lathe([[0.42, 0.19], [0.2, 0.215], [0.0, 0.22]], 24, PAINT_DARK, up);
  }

  // ---- the waist: narrower, plated, with the drive's emitter band
  const waist: [number, number, number, number][] = [
    [-1.1, 2.08, 0.92, 0.66],
    [0.0, 2.02, 0.9, 0.66],
    [1.2, 2.0, 0.9, 0.66],
    [2.6, 2.0, 0.9, 0.66],
    [4.0, 1.96, 0.88, 0.64],
  ];
  const wsecs = waist.map(([z, W, Ht, Hb]) => ({ z, ...cabinSection(W, Ht, Hb) }));
  b.grid(rings(wsecs.map((s) => ({ z: s.z, pts: s.top }))), PAINT, false, true);
  b.grid(rings(wsecs.map((s) => ({ z: s.z, pts: s.belly }))), PAINT_DARK, false, true);
  // the emitter band: a ring standing a little proud of the waist, framed by two steel rings
  {
    const band = (grow: number) => {
      const s = cabinSection(2.02 + grow * 2, 0.9 + grow, 0.66 + grow);
      return [...s.top, ...s.belly.slice(1, -1)];
    };
    const ring = (z0: number, z1: number, grow: number, f: Finish) => {
      b.loft([{ z: z0, outline: band(grow) }, { z: z1, outline: band(grow) }], f, false);
    };
    // (the outline runs counter-clockwise from the right chine, as `loft` wants)
    ring(-0.25, -0.1, 0.07, STEEL);
    ring(-0.1, 0.75, 0.05, FIELD);
    ring(0.75, 0.9, 0.07, STEEL);
  }

  // ---- the radiators: swept panels with heat pipes, edged in metal, lights on their tips
  const RAD = { root: 1.0, span: 6.7, rootLead: 0.9, rootTrail: 4.4, tipLead: 3.0, tipTrail: 4.6, thick: 0.1, dihedral: 0.12 };
  const rad = new Matrix4().makeRotationZ(RAD.dihedral).premultiply(new Matrix4().makeTranslation(RAD.root, 0.15, 0));
  {
    const [v0, i0] = b.mark();
    // the panel: a loft along the span (x), its outline in the chord (z) and thickness (y)
    const n = 8;
    const panel: Vector3[][] = [];
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const x = s * RAD.span;
      const zl = RAD.rootLead + (RAD.tipLead - RAD.rootLead) * s, zt = RAD.rootTrail + (RAD.tipTrail - RAD.rootTrail) * s;
      const h = RAD.thick / 2;
      const out = roundedPolygon([[zl, -h], [zt, -h], [zt, h], [zl, h]], h * 0.9, 2);
      panel.push(out.map((p) => V(x, p.y, p.x)));
    }
    // (rings along +x, outlines counter-clockwise in (z, y): the faces turn outwards unflipped)
    b.at(rad);
    b.grid(panel, RADIATOR, true, false);
    b.at();
    // metal edges: leading and trailing, a bar across at each joint, the tip's frame
    const edge = (s0: number, s1: number, lead: boolean) => {
      const pts: Vector3[] = [];
      for (let k = 0; k <= 6; k++) {
        const s = s0 + ((s1 - s0) * k) / 6;
        const z = lead ? RAD.rootLead + (RAD.tipLead - RAD.rootLead) * s - 0.03 : RAD.rootTrail + (RAD.tipTrail - RAD.rootTrail) * s + 0.03;
        pts.push(V(s * RAD.span, 0, z).applyMatrix4(rad));
      }
      return pts;
    };
    const tube = roundedPolygon([[0.05, -0.05], [0.05, 0.05], [-0.05, 0.05], [-0.05, -0.05]], 0.04, 2);
    // the leading edge is the panel's spine: a boom that carries it, thicker
    const boom = roundedPolygon([[0.085, -0.075], [0.085, 0.075], [-0.085, 0.075], [-0.085, -0.075]], 0.06, 2);
    b.sweep(edge(0, 1, true), boom, RAD_EDGE, V(0, 1, 0));
    b.sweep(edge(0, 1, false), tube, RAD_EDGE, V(0, 1, 0));
    for (const s of [1 / 3, 2 / 3]) {
      const zl = RAD.rootLead + (RAD.tipLead - RAD.rootLead) * s, zt = RAD.rootTrail + (RAD.tipTrail - RAD.rootTrail) * s;
      b.sweep([V(s * RAD.span, 0, zl - 0.03).applyMatrix4(rad), V(s * RAD.span, 0, zt + 0.03).applyMatrix4(rad)], tube, RAD_EDGE, V(0, 1, 0));
    }
    // the root: a coolant manifold along the chord, and a fairing into the waist
    b.sweep([V(-0.05, 0, RAD.rootLead - 0.1).applyMatrix4(rad), V(-0.05, 0, RAD.rootTrail + 0.1).applyMatrix4(rad)],
      roundedPolygon([[0.11, -0.11], [0.11, 0.11], [-0.11, 0.11], [-0.11, -0.11]], 0.1, 3), STEEL, V(0, 1, 0));
    b.box(RAD.root - 0.02, 0.15, (RAD.rootLead + RAD.rootTrail) / 2, 0.42, 0.34, RAD.rootTrail - RAD.rootLead + 0.5, PAINT_DARK, 0.08);
    // the tip: a slim pod with the navigation light
    const tip = V(RAD.span + 0.1, 0, RAD.tipLead + 0.5).applyMatrix4(rad);
    b.box(tip.x, tip.y, tip.z + 0.2, 0.2, 0.16, 1.2, RAD_EDGE, 0.06);
    b.box(tip.x, tip.y, tip.z - 0.42, 0.12, 0.1, 0.08, lamp([1.0, 0.07, 0.03], GROUP.starboard), 0.03);
    // a trim stripe along the leading edge's top
    {
      const top = RAD.thick / 2 + 0.004;
      const q = (s: number, dz: number) => V(s * RAD.span, top, RAD.rootLead + (RAD.tipLead - RAD.rootLead) * s + dz).applyMatrix4(rad);
      b.quad(q(0.04, 0.1), q(0.04, 0.24), q(0.96, 0.24), q(0.96, 0.1), TRIM);
    }
    b.mirrorX(v0, i0, (g) => (g === GROUP.starboard ? GROUP.port : g));
  }
  // (the mirror made both tips' lamps; their colours: the starboard one green, the port one red)
  recolourLamps(b);
  // the registration on both radiators, read from behind (letters' tops towards the nose)
  {
    const reg = 'SF-07', h = 0.62;
    const width = textWidth(reg, h);
    for (const sgn of [-1, 1]) {
      // the text's first letter: inboard on starboard, outboard on port (it reads left to right)
      const s0 = sgn > 0 ? 0.17 : 0.17 + width / RAD.span;
      const p = V(s0 * RAD.span, RAD.thick / 2 + 0.005, RAD.rootTrail - 0.38).applyMatrix4(rad);
      const m = new Matrix4().makeRotationX(-Math.PI / 2).premultiply(new Matrix4().makeRotationZ(RAD.dihedral));
      if (sgn < 0) {
        // (the port panel is the starboard one mirrored: its tilt goes the other way)
        m.copy(new Matrix4().makeRotationX(-Math.PI / 2).premultiply(new Matrix4().makeRotationZ(-RAD.dihedral)));
        p.x = -p.x;
      }
      m.premultiply(new Matrix4().makeTranslation(p.x, p.y, p.z));
      paintText(b, reg, h, MARK, m, 0.14);
    }
  }

  // ---- the engine: the reactor's housing (painted, a band of gold foil), and the nozzle: a bell of
  // brushed metal, dark inside, held by two field coils (the plasma is steered by the field as much as
  // by the bell), the throat glowing deep in it
  b.lathe([
    [0.96, 3.95], [1.12, 4.15], [1.15, 4.4], [1.15, 4.4], [1.15, 5.4], [1.15, 5.4], [1.08, 5.62], [0.82, 5.85], [0.82, 5.85], [0.6, 5.95],
  ], 32, PAINT);
  b.lathe([[1.165, 4.6], [1.165, 5.1]], 32, GOLD);
  b.torus(1.0, 0.06, 32, 8, STEEL, new Matrix4().makeTranslation(0, 0, 3.96));
  const bellOut: [number, number][] = [[0.44, 5.9], [0.5, 6.2], [0.63, 6.7], [0.8, 7.3], [0.94, 7.9], [1.0, 8.3]];
  b.lathe(bellOut, 40, TITANIUM);
  // (the inside, from the lip in to the throat: its faces turn inwards, to be seen from behind)
  b.lathe([[0.975, 8.3], [0.91, 7.9], [0.77, 7.3], [0.6, 6.7], [0.47, 6.2], [0.4, 5.98]], 40, BELL_INSIDE);
  b.torus(0.99, 0.035, 48, 6, STEEL, new Matrix4().makeTranslation(0, 0, 8.3));
  b.lathe([[0.4, 5.985], [0.0, 5.985]], 28, THROAT);
  for (const [R, z, r] of [[0.74, 7.05, 0.075], [1.06, 8.15, 0.085]] as [number, number, number][]) {
    b.torus(R, r, 48, 10, COIL, new Matrix4().makeTranslation(0, 0, z));
    b.torus(R + r * 0.55, r * 0.45, 48, 6, DARK_METAL, new Matrix4().makeTranslation(0, 0, z));
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const c = Math.cos(a), s = Math.sin(a);
    const pts = [[0.95, 5.6], [0.9, 6.3], [0.86, 7.0], [1.02, 7.7], [1.16, 8.2]].map(([r, z]) => V(r * c, r * s, z));
    b.sweep(pts, roundedPolygon([[0.04, -0.035], [0.04, 0.035], [-0.04, 0.035], [-0.04, -0.035]], 0.015, 1), DARK_METAL, V(c, s, 0));
  }
  // coolant lines from the housing out to the radiators' roots
  for (const sgn of [-1, 1]) {
    const pts = [V(sgn * 0.9, 0.35, 4.6), V(sgn * 1.14, 0.3, 4.4), V(sgn * 1.26, 0.22, 4.1), V(sgn * 1.12, 0.15, 3.6)];
    b.sweep(pts, roundedPolygon([[0.06, -0.06], [0.06, 0.06], [-0.06, 0.06], [-0.06, -0.06]], 0.055, 2), STEEL, V(0, 1, 0));
  }

  // ---- small things: thruster quads, an antenna, the strobe's mount
  const rcs = (x: number, y: number, z: number) => {
    const [v0, i0] = b.mark();
    b.box(x, y, z, 0.26, 0.26, 0.3, PAINT_DARK, 0.05);
    for (const [dx, dy, dz] of [[0.16, 0, 0], [0, 0.16, 0], [0, -0.16, 0]]) {
      // (the nozzle's axis, its z, out along (dx, dy, dz))
      const m = new Matrix4().lookAt(V(dx, dy, dz), V(0, 0, 0), Math.abs(dy) > 0 ? V(1, 0, 0) : V(0, 1, 0));
      m.premultiply(new Matrix4().makeTranslation(x + dx * 0.9, y + dy * 0.9, z + dz));
      b.lathe([[0.03, -0.05], [0.055, 0.05], [0.055, 0.05], [0.04, 0.05]], 10, DARK_METAL, m);
    }
    b.mirrorX(v0, i0);
  };
  rcs(1.42, 0.05, -6.2);
  rcs(1.48, 0.1, -2.6);
  rcs(1.18, 0.05, 5.0);
  // high-gain antenna: a dish on a short mast, on the waist's top to port
  {
    const base = V(-0.55, 0.92, 1.9);
    b.sweep([base, base.clone().add(V(0, 0.45, 0.1))], roundedPolygon([[0.04, -0.04], [0.04, 0.04], [-0.04, 0.04], [-0.04, -0.04]], 0.03, 2), STEEL, V(0, 0, 1));
    const dish = new Matrix4().makeRotationX(-Math.PI / 2 - 0.5).premultiply(new Matrix4().makeTranslation(base.x, base.y + 0.5, base.z + 0.12));
    b.lathe([[0.0, 0.0], [0.2, 0.02], [0.38, 0.075], [0.5, 0.13], [0.5, 0.13], [0.48, 0.13], [0.36, 0.085], [0.18, 0.035], [0.0, 0.018]], 24, PAINT, dish);
  }
  // the strobe sits on a short mast over the engine housing
  b.box(0, 1.24, 4.9, 0.12, 0.2, 0.16, DARK_METAL, 0.03);
  b.box(0, 1.37, 4.9, 0.1, 0.07, 0.1, lamp([1, 1, 1], GROUP.strobe), 0.03);
  // a red beacon under the cabin
  b.box(0, -0.78, -3.8, 0.12, 0.07, 0.12, lamp([1.0, 0.06, 0.03], GROUP.beacon), 0.03);
  // the name on the cabin's flanks, at their widest, reading from nose to tail on both sides
  {
    const name = 'STARFARER', h = 0.26;
    const width = textWidth(name, h);
    const sec = cabinSection(3.03, 1.14, 0.675);
    const widest = sec.top.reduce((a, p) => (p.x > a.x ? p : a), sec.top[0]);
    for (const sgn of [-1, 1]) {
      const m = new Matrix4().makeRotationY(sgn * Math.PI / 2);
      // (starboard the text runs towards the nose, port towards the tail)
      m.premultiply(new Matrix4().makeTranslation(sgn * (widest.x + 0.006), widest.y - h / 2, sgn > 0 ? -2.55 : -2.55 - width));
      paintText(b, name, h, MARK_DARK, m, 0.14);
    }
  }

  // ---- the lights' glows (halos, the drive's band, the throat, the plume)
  const tipLamp = V(RAD.span + 0.1, 0, RAD.tipLead + 0.08).applyMatrix4(rad);
  const port = V(-tipLamp.x, tipLamp.y, tipLamp.z), star = tipLamp.clone();
  glows.push({ at: [star.x + 0.02, star.y, star.z - 0.02], color: [0.15, 1.0, 0.35], size: 0.7, channel: 2, shape: 0 });
  glows.push({ at: [port.x - 0.02, port.y, port.z - 0.02], color: [1.0, 0.08, 0.04], size: 0.7, channel: 1, shape: 0 });
  glows.push({ at: [0, 1.42, 4.9], color: [1, 1, 1], size: 0.85, channel: 3, shape: 0 });
  glows.push({ at: [0, -0.84, -3.8], color: [1.0, 0.06, 0.03], size: 0.5, channel: 6, shape: 0 });
  // the throat's own glow, and the plume: puffs along the axis behind the nozzle, wider and fainter
  glows.push({ at: [0, 0, 6.3], color: [0.75, 0.85, 1.0], size: 1.0, channel: 5, shape: 0 });
  // (the exhaust itself is all but invisible: a bright core leaving the bell, fading within a few metres)
  for (let k = 0; k < 9; k++) {
    const t = k / 8;
    glows.push({ at: [0, 0, 6.3 + 9 * t * t + 1.2 * t], color: [0.85 - 0.3 * t, 0.85 - 0.35 * t, 1.0], size: 0.55 + 1.8 * t, channel: 7, shape: 1 });
  }

  const radQuad = (sgn: number) => [V(0, 0, RAD.rootLead), V(0, 0, RAD.rootTrail), V(RAD.span + 0.2, 0, RAD.tipTrail), V(RAD.span + 0.2, 0, RAD.tipLead)]
    .map((p) => p.applyMatrix4(rad)).map((p) => V(sgn * p.x, p.y, p.z));
  return {
    hull: b,
    glows,
    lamps: [port, star, V(0, 1.42, 4.9)],
    throat: V(0, 0, 6.0),
    length: 17.4,
    span: 2 * (tipLamp.x + 0.15),
    cover: {
      // (the cabin narrows to its nose in three steps: one capsule 1.25 m round from -8.5 m reached
      // 0.75 m beyond the tip and as far above and below it, sky taken for ship there, so an orbit
      // line crossing just ahead of the nose counted as drawn over the ship)
      capsules: [[V(0, 0.1, -8.55), V(0, 0.1, -7.9), 0.45], [V(0, 0.1, -7.9), V(0, 0.1, -6.6), 0.8], [V(0, 0.1, -6.6), V(0, 0.1, -2.5), 1.25],
        [V(0, 0.1, -2.5), V(0, 0.1, 4.0), 1.0], [V(0, 0, 4.3), V(0, 0, 8.3), 1.15]],
      quads: [radQuad(1), radQuad(-1)],
    },
  };
}

/** The tip lamps after mirroring: the port one (negative x) red, the starboard one green. */
function recolourLamps(b: MeshBuilder): void {
  for (let v = 0; v < b.vertexCount; v++) {
    const g = b.mat[v * 4 + 3];
    if (g === GROUP.starboard) b.col.splice(v * 3, 3, 0.1, 1.0, 0.3);
    else if (g === GROUP.port) b.col.splice(v * 3, 3, 1.0, 0.07, 0.03);
  }
}
