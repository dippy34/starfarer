import { keplerDrift } from './KeplerDrift';

/**
 * The pieces of a world that came apart (src/sim/Tides.ts: torn apart by tides; later, by a hit),
 * followed as bodies that are pulled and do not pull, each on its own two-body orbit about the body
 * they go round (`host`): a Kepler orbit, exact for that one pull, worked out for any moment without
 * stepping. Nothing else pulls on them: not the Sun, not the other moons, not each other, and they do
 * not hit each other. A piece whose orbit takes it into the host falls back at the moment it reaches
 * its surface; one on an open path that goes past `reach` (the host's Hill sphere) has left it.
 *
 * Everything a swarm is follows from a few numbers (where the world was and how it moved as it
 * came apart, its size, a seed): Undo and Replay keep the record, a link carries it in a few dozen
 * bytes, and every device makes the same pieces from it. Plain numbers; no allocation per frame.
 */

export interface Swarm {
  /** its own number (kept by Undo and by links) */
  id: number;
  /** what came apart: its number, name, G x mass (m³/s²) and radius (m), colour (linear RGB) and the share of light its rock sends back */
  from: number; name: string; gm: number; radius: number; color: [number, number, number]; albedo: number;
  /** what took it apart: the tides of the host */
  cause: 'tides';
  /** the body its pieces go round: its number, G x its mass then (m³/s²), its radius (m), and how far out its pull holds sway (m; Infinity: everywhere) */
  host: number; mu: number; hostRadius: number; reach: number;
  /** the simulation's time it came apart (s), and where it was then and how it moved, from the host (m, m/s) */
  t0: number; pos: [number, number, number]; vel: [number, number, number];
  /** how many pieces, and the seed they are spread by */
  count: number; seed: number;
}

/** what the pieces do, worked out once from the record (`spread`) */
export interface Spread {
  /** each piece's place and motion from the host as it came apart (m, m/s; three numbers a piece each) */
  r0: Float64Array; v0: Float64Array;
  /** room for their motion now (three numbers a piece) */
  v: Float64Array;
  /** the time after t0 at which each piece falls back onto the host (s; Infinity: never) */
  fall: Float64Array;
  /** each piece is on a closed orbit that never meets the host (it goes round, and may make a ring) */
  ring: Uint8Array;
  /** how fast the ring pieces' angles part: the spread of their mean motions (rad/s), and their least and greatest distance from the host (m) */
  shear: number; inner: number; outer: number;
  /** the share of the ring pieces' time spent at each distance from `inner` to `outer`, in PROFILE equal steps, the most 1 (for drawing the ring) */
  profile: Float32Array;
  /** the pole of the ring: the direction of the pieces' angular momentum about the host (a unit vector) */
  pole: [number, number, number];
  /** a piece's radius (m): the world's volume shared equally among them */
  piece: number;
}

/** the steps of the ring's profile */
export const PROFILE = 64;

/** A number in [0, 1) from a seed, the same on every device (integer arithmetic only: Mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The pieces' starting places and motions, what becomes of each, and the ring they make. */
export function spread(sw: Swarm): Spread {
  const n = sw.count, rnd = random(sw.seed), r0 = new Float64Array(3 * n), v0 = new Float64Array(3 * n);
  const [px, py, pz] = sw.pos, [vx, vy, vz] = sw.vel;
  // (it turned once round on each turn of its orbit, as a moon's tides keep it: its own spin is its orbit's, ω = r × v / r²)
  const r2 = px * px + py * py + pz * pz;
  const wx = (py * vz - pz * vy) / r2, wy = (pz * vx - px * vz) / r2, wz = (px * vy - py * vx) / r2;
  for (let k = 0; k < n; k++) {
    // a place in the world (evenly through its volume: points of a cube kept where they are in the ball)
    let x = 0, y = 0, z = 0;
    do { x = 2 * rnd() - 1; y = 2 * rnd() - 1; z = 2 * rnd() - 1; } while (x * x + y * y + z * z > 1);
    x *= sw.radius; y *= sw.radius; z *= sw.radius;
    const o = 3 * k;
    r0[o] = px + x; r0[o + 1] = py + y; r0[o + 2] = pz + z;
    v0[o] = vx + (wy * z - wz * y); v0[o + 1] = vy + (wz * x - wx * z); v0[o + 2] = vz + (wx * y - wy * x);
  }
  const fall = new Float64Array(n).fill(Infinity), ring = new Uint8Array(n);
  let nMin = Infinity, nMax = 0, inner = Infinity, outer = 0;
  const hx = [0, 0, 0], mu = sw.mu, R = sw.hostRadius;
  const orbits: { a: number; e: number }[] = [];
  for (let k = 0; k < n; k++) {
    const o = 3 * k, x = r0[o], y = r0[o + 1], z = r0[o + 2], u = v0[o], v = v0[o + 1], w = v0[o + 2];
    const d = Math.sqrt(x * x + y * y + z * z), energy = (u * u + v * v + w * w) / 2 - mu / d;
    const cx = y * w - z * v, cy = z * u - x * w, cz = x * v - y * u, h2 = cx * cx + cy * cy + cz * cz;
    hx[0] += cx; hx[1] += cy; hx[2] += cz;
    const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h2) / (mu * mu))), q = h2 / (mu * (1 + e));
    if (q < R) fall[k] = fallTime(r0, v0, o, mu, R, energy, e);
    if (energy < 0 && !(fall[k] < Infinity)) {
      const a = -mu / (2 * energy);
      if (a * (1 + e) < sw.reach) {
        ring[k] = 1;
        const nk = Math.sqrt(mu / (a * a * a));
        nMin = Math.min(nMin, nk); nMax = Math.max(nMax, nk);
        inner = Math.min(inner, q); outer = Math.max(outer, a * (1 + e));
        orbits.push({ a, e });
      }
    }
  }
  // the ring's profile: each ring piece's time spread over its distances (its mean anomaly in equal steps)
  const profile = new Float32Array(PROFILE);
  if (orbits.length && outer > inner) {
    const STEPS = 48;
    for (const { a, e } of orbits) {
      for (let j = 0; j < STEPS; j++) {
        const M = (2 * Math.PI * (j + 0.5)) / STEPS;
        let E = M;
        for (let it = 0; it < 30; it++) {
          const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
          E -= dE;
          if (Math.abs(dE) < 1e-12) break;
        }
        const rr = a * (1 - e * Math.cos(E)), b = Math.min(PROFILE - 1, Math.max(0, Math.floor(((rr - inner) / (outer - inner)) * PROFILE)));
        profile[b] += 1;
      }
    }
    // (smoothed over three steps: forty-eight places an orbit leave gaps)
    const raw = Float32Array.from(profile);
    for (let b = 0; b < PROFILE; b++) profile[b] = (raw[Math.max(0, b - 1)] + raw[b] + raw[Math.min(PROFILE - 1, b + 1)]) / 3;
    const most = Math.max(...profile);
    for (let b = 0; b < PROFILE; b++) profile[b] /= most;
  }
  const hl = Math.hypot(hx[0], hx[1], hx[2]) || 1;
  return {
    r0, v0, v: new Float64Array(3 * n), fall, ring, shear: orbits.length > 1 ? nMax - nMin : 0, inner: orbits.length ? inner : 0, outer, profile,
    pole: [hx[0] / hl, hx[1] / hl, hx[2] / hl], piece: sw.radius / Math.cbrt(n),
  };
}

/** The time (s) from its start until the piece at offset `o` of `r0`, `v0`, on an orbit about `mu` whose nearest point is inside `R`, reaches `R` (Infinity if it never comes in). */
function fallTime(r0: Float64Array, v0: Float64Array, o: number, mu: number, R: number, energy: number, e: number): number {
  const r = r0.slice(o, o + 3), v = v0.slice(o, o + 3), d0 = Math.hypot(r[0], r[1], r[2]);
  if (d0 <= R) return 0;
  // (stepped along its own orbit to where it first comes within R, then the moment found by halving: exact for that orbit)
  const turn = energy < 0 ? 2 * Math.PI * Math.sqrt((-mu / (2 * energy)) ** 3 / mu) : 2 * Math.PI * Math.sqrt(d0 ** 3 / mu);
  const step = turn / 512, a = new Float64Array(6), b = new Float64Array(6);
  let t = 0;
  for (let k = 0; k < 2048; k++) {
    a.set(r); a.set(v, 3);
    keplerDrift(a, a.subarray(3), 0, mu, t + step);
    if (Math.hypot(a[0], a[1], a[2]) <= R) {
      let lo = t, hi = t + step;
      for (let it = 0; it < 60; it++) {
        const mid = (lo + hi) / 2;
        b.set(r); b.set(v, 3);
        keplerDrift(b, b.subarray(3), 0, mu, mid);
        if (Math.hypot(b[0], b[1], b[2]) <= R) hi = mid; else lo = mid;
      }
      return hi;
    }
    t += step;
    // (an open path going out never comes back)
    if (!(energy < 0) && e >= 1) {
      const rv = a[0] * a[3] + a[1] * a[4] + a[2] * a[5];
      if (rv > 0) return Infinity;
    }
  }
  return Infinity;
}

/**
 * Where the pieces are `t` seconds of the simulation's time (its own clock: `t` against `t0`), from
 * the host (m): written into `out` (three numbers a piece), with `shown` 1 for each piece still there
 * (not fallen back, not gone past `reach`). Returns how many are there.
 */
export function piecesAt(sw: Swarm, sp: Spread, t: number, out: Float64Array, shown: Uint8Array): number {
  const dt = t - sw.t0, n = sw.count, reach2 = sw.reach * sw.reach;
  let there = 0;
  for (let k = 0; k < n; k++) {
    const o = 3 * k;
    if (!(dt >= 0) || !(dt < sp.fall[k])) { shown[k] = 0; continue; }
    keplerDrift(sp.r0, sp.v0, o, sw.mu, dt, out, sp.v, o);
    const far = out[o] * out[o] + out[o + 1] * out[o + 1] + out[o + 2] * out[o + 2] > reach2;
    shown[k] = far ? 0 : 1;
    if (!far) there++;
  }
  return there;
}
