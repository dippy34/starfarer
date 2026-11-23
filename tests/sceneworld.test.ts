import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Foresight } from '../src/app/Foresight';
import { LivePhysics } from '../src/app/LivePhysics';
import { aheadWords, circularVelocity, whenWords } from '../src/app/Powers';
import { decodeLink, encodeLink } from '../src/app/SceneLink';
import { decodeWorld, encodeWorld, fromBase64Url, type LiveWorld, toBase64Url, WorldError } from '../src/app/SceneWorld';
import { MADE_FIRST_ID, madeAgain, newMoon, newTwin, TWIN_OF } from '../src/app/WhatIf';
import { SimClock } from '../src/core/time';
import { NBody } from '../src/sim/NBody';
import { liveDate } from '../src/sim/SystemSim';
import { SolarSystem } from '../src/universe/SolarSystem';

// The Solar System as the app has it: its catalogue and the JPL ephemeris, read from public/ as the browser fetches them.
const PUBLIC = join(fileURLToPath(new URL('..', import.meta.url)), 'public');
globalThis.fetch = (async (url: string | URL) => new Response(readFileSync(join(PUBLIC, String(url).replace(/^\//, ''))))) as typeof fetch;

const DAY = 86_400;
const JD = 2461300.5; // 2026-09-17 (TDB)

async function universe(jd = JD) {
  const sys = await SolarSystem.load('/data');
  await sys.ephemeris.request(jd);
  sys.update(jd);
  const physics = new LivePhysics(sys, { left: () => undefined, dropped: () => undefined });
  const named = (name: string) => sys.bodies.find((b) => b.name === name)!;
  const clock = new SimClock(jd);
  /** time run on to `to` as the app's frames run it (a frame of `frame` seconds at a time), the simulation following */
  const run = (to: number, frame = 1 / 60) => {
    for (let n = 0; clock.jdTdb < to && n < 1e7; n++) {
      clock.jdTdb = to;
      physics.follow(clock, frame);
      sys.update(clock.jdTdb);
      physics.place(clock.jdTdb);
    }
  };
  return { sys, physics, named, clock, run };
}
type U = Awaited<ReturnType<typeof universe>>;

/** The scenes a link is measured on (HANDOFF.md, Save & share). */
const SCENES: Record<string, (u: U) => void> = {
  // the Moon thrown out of the Earth's hold: 1.6 times the speed of a circle, along its way
  'the Moon thrown': ({ physics, named }) => {
    const earth = named('Earth'), moon = named('Moon');
    const r = moon.pos.clone().sub(earth.pos), w = moon.vel.clone().sub(earth.vel);
    const v = circularVelocity(r.toArray(), earth.gm + moon.gm, r.clone().cross(w).normalize().toArray());
    physics.move(moon, moon.pos.toArray(), [earth.vel.x + 1.6 * v[0], earth.vel.y + 1.6 * v[1], earth.vel.z + 1.6 * v[2]], JD);
  },
  // a planet like the Earth added for the Sun, on its circle
  'Earth 2 added': ({ physics, named, sys }) => {
    const like = named('Earth'), sun = sys.sun;
    const plan = newTwin(like, null, sun, [1.2e11, 4e10, 0], 0, MADE_FIRST_ID);
    physics.make(plan.json, sun, plan.pos, plan.vel, JD, `${plan.json.name} is new.`);
  },
  // Mars put 40 Earth radii from the Earth and sent at it (as live.mjs's hit block sets it up, then thrown)
  'Mars sent at the Earth': ({ physics, named, sys }) => {
    const earth = named('Earth'), mars = named('Mars'), sun = sys.sun;
    const r = earth.pos.clone().sub(sun.pos), side = r.clone().cross(earth.vel.clone().sub(sun.vel)).cross(r).normalize();
    const at = earth.pos.clone().addScaledVector(side, 40 * earth.radius);
    physics.move(mars, at.toArray(), earth.vel.clone().addScaledVector(side, -3000).toArray(), JD);
  },
  // Jupiter made ten times heavier (every moon of it simulated), then fifty years on
  'fifty years after Jupiter ×10': ({ physics, named, run }) => {
    const jup = named('Jupiter');
    physics.setMass(jup, 10 * jup.gm, JD);
    run(JD + 50 * 365.25, 1);
  },
  // the Moon left on a circle 15,000 km from the Earth, inside its Roche limit, a day on: torn apart into 200 pieces
  'the Moon torn into a ring': ({ physics, named, run }) => {
    const earth = named('Earth'), moon = named('Moon');
    const r = moon.pos.clone().sub(earth.pos), n = r.clone().cross(moon.vel.clone().sub(earth.vel)).normalize(), at = r.normalize().multiplyScalar(15000e3);
    const v = circularVelocity(at.toArray(), earth.gm + moon.gm, n.toArray());
    physics.move(moon, [earth.pos.x + at.x, earth.pos.y + at.y, earth.pos.z + at.z], [earth.vel.x + v[0], earth.vel.y + v[1], earth.vel.z + v[2]], JD);
    run(JD + 1, 1);
  },
};

/** More kinds of change, for the round trips: a second sun, a moon made, sizes and masses, a world taken away, a hit. */
const MORE: Record<string, (u: U) => void> = {
  'a second sun': ({ physics, named, sys }) => {
    const plan = newTwin(sys.sun, null, sys.sun, [3e11, 1e11, 0], 0, MADE_FIRST_ID);
    const sun = physics.make(plan.json, sys.sun, plan.pos, plan.vel, JD, 'new');
    sun.teff = 5100; sun.absMag = 5.9;
    void named;
  },
  'a moon made for Mars, Saturn larger and lighter, Venus taken away': ({ physics, named }) => {
    const mars = named('Mars'), plan = newMoon(mars, [3e7, 0, 0], 2.3e11, 0, MADE_FIRST_ID);
    physics.make(plan.json, mars, plan.pos, plan.vel, JD, 'new');
    physics.setSize(named('Saturn'), 2 * named('Saturn').radius, JD);
    physics.setMass(named('Saturn'), 0.5 * named('Saturn').gm, JD);
    physics.remove(named('Venus'), JD);
  },
  'Mars into the Earth, a month on': (u) => { SCENES['Mars sent at the Earth'](u); u.run(JD + 30, 1); },
};

/** The link a scene comes to (as App.sceneView writes it): the readable view part, and the changed universe in base64url. */
function linkOf(world: LiveWorld) {
  const raw = encodeWorld(world);
  const view = encodeLink({ selected: { name: 'Moon', id: 301 }, at: { name: 'Earth', id: 399 }, camera: [-18412345.68, 3100000.25, 2200000.125], turn: [0.1, -0.2, 0.3, 0.9273618], fov: 50, jd: world.jd0 + world.sim.time / DAY, rate: 86400, paused: true, world: toBase64Url(raw) });
  return { raw, view, url: `https://dippy34.github.io/starfarer/#${view}` };
}

/** Deflate (raw, as CompressionStream('deflate-raw') would): what packing would have saved, measured. */
const deflated = (b: Uint8Array) => deflateRawSync(b, { level: 9 }).length;

/** The doubles of the structure kept in place, for the measure of storing them byte plane by byte plane. */
function unplaned(bytes: Uint8Array, doubles: number): Uint8Array {
  const head = bytes.length - 8 * doubles, out = bytes.slice();
  for (let i = 0; i < doubles; i++) for (let k = 0; k < 8; k++) out[head + 8 * i + k] = bytes[head + k * doubles + i];
  return out;
}

/** What `adoptWorld` needs to make a world again: its look from the catalogue. */
const remake = (sys: SolarSystem) => (m: Parameters<typeof madeAgain>[0]) => madeAgain(m, sys.byId.get(m.home)!, m.kind === 'moon' ? null : sys.byId.get(TWIN_OF[m.kind])!, null);

/** Every simulated body's place and motion, to the last bit. */
const bits = (sim: NBody) => { sim.read(); return [...sim.ids].map((id, i) => [id, ...[0, 1, 2].map((c) => sim.pos[3 * i + c]), ...[0, 1, 2].map((c) => sim.vel[3 * i + c])]); };

describe('the changed universe in a link', () => {
  it('measured: the four scenes, raw, packed, and as links', async () => {
    const rows: string[] = [];
    for (const [name, make] of Object.entries(SCENES)) {
      const u = await universe();
      make(u);
      const world = u.physics.world()!;
      const { raw, url } = linkOf(world);
      const doubles = countDoubles(world);
      rows.push(`${name}: ${world.sim.ids.length} bodies simulated, ${raw.length} bytes (${doubles} doubles, ${raw.length - 8 * doubles} of the rest); deflated ${deflated(raw)} (doubles in place: ${deflated(unplaned(raw, doubles))}); the link ${url.length} characters (deflated it would be ${url.length - Math.ceil((raw.length * 4) / 3) + Math.ceil((deflated(raw) * 4) / 3)})`);
      // (a link of this app is read back whole)
      const d = decodeLink(url.split('#')[1]);
      expect(d.ok).toBe(true);
      // (the size the decision rests on: HANDOFF.md, Save & share)
      expect(url.length).toBeLessThan(16_000);
    }
    console.log(rows.join('\n'));
  }, 240_000);

  it('round trips every kind of scene: what was written is what is read', async () => {
    for (const make of [...Object.values(SCENES), ...Object.values(MORE)]) {
      const u = await universe();
      make(u);
      const world = u.physics.world()!;
      const raw = encodeWorld(world);
      const back = decodeWorld(fromBase64Url(toBase64Url(raw))!);
      // (what both ends have from the catalogue is not written: it is read back as 0, and filled in from the bodies)
      const blank = structuredClone(world);
      blank.asBody.forEach((f, i) => { if (f & 1) blank.sim.gm[i] = 0; if (f & 2) blank.sim.radius[i] = 0; });
      expect(back).toEqual(blank);
      expect(world.asBody.filter((f) => f === 3).length).toBeGreaterThan(world.sim.ids.length / 2);
      // and made again in a fresh universe, it is the sender's, started again from the same (App.share)
      u.physics.rebase(back);
      const v = await universe(liveDate(u.physics.live!));
      v.physics.adoptWorld(back, remake(v.sys));
      expect(bits(v.physics.live!.sim)).toEqual(bits(u.physics.live!.sim));
      // (the worlds torn apart: the same records, so the same pieces, where the sender's are)
      expect(v.physics.swarms).toEqual(u.physics.swarms);
      for (const b of u.sys.bodies) {
        const c = v.sys.byId.get(b.id)!;
        // (what a body taken away goes round is no matter: it is not there)
        expect([c.valid, c.gm, c.radius, c.teff, c.absMag, b.valid ? c.parent?.id : 0], b.name).toEqual([b.valid, b.gm, b.radius, b.teff, b.absMag, b.valid ? b.parent?.id : 0]);
      }
      expect(fromBase64Url(toBase64Url(raw))).toEqual(raw);
    }
  }, 240_000);

  it('opened on another device, the scene goes on bit for bit as on the sender\'s, and the card\'s prediction reads the same', async () => {
    const a = await universe();
    SCENES['Mars sent at the Earth'](a);
    // the sender shares: what the link holds, read back, is what its own simulation goes on from (App.share)
    const sent = decodeWorld(encodeWorld(a.physics.world()!));
    a.physics.rebase(sent);
    // the receiver: a fresh universe at the link's date, the changed one adopted
    const b = await universe(liveDate(a.physics.live!));
    b.physics.adoptWorld(decodeWorld(encodeWorld(sent)), remake(b.sys));
    expect(bits(b.physics.live!.sim)).toEqual(bits(a.physics.live!.sim));
    // the card's prediction for Mars, run ahead on each (App.lookAhead), in the card's words
    const said = (u: U) => {
      const mars = u.named('Mars'), earth = u.named('Earth'), live = u.physics.live!, f = new Foresight();
      const o = u.physics.orbit(mars);
      f.start(live.sim.snapshot(), mars.id, mars.parent ? mars.parent.id : -1, o?.bound ? o.period : 2 * Math.PI * Math.sqrt(mars.pos.distanceTo(earth.pos) ** 3 / (earth.gm + mars.gm)));
      for (let k = 0; !f.done && k < 1e5; k++) f.grow(50);
      const end = f.end!;
      return { end, words: end.kind === 'hit' ? aheadWords({ kind: 'hit', other: u.sys.byId.get(end.other)!.name, when: whenWords(end.time, live.jd0 + (f.from + end.time) / DAY) }).line : end.kind };
    };
    const sa = said(a), sb = said(b);
    expect(sb.words).toMatch(/^With every pull counted, it hits Earth in [\d.]+ (hours|days)\.$/);
    expect(sb).toEqual(sa);
    // stepped alike, the two simulations stay alike to the last bit, through the hit
    const copyA = NBody.restore(a.physics.live!.sim.snapshot()), copyB = NBody.restore(b.physics.live!.sim.snapshot());
    copyA.advance(30 * DAY);
    copyB.advance(30 * DAY);
    expect(bits(copyB)).toEqual(bits(copyA));
    expect(copyA.ids.includes(499)).toBe(false);
    // run frame by frame as the app runs them, where what is carried on rails follows each machine's pace (LivePhysics.follow),
    // the same happens: Mars hits the Earth, told in the same words, and the Earth ends where the sender's does, to a kilometre
    a.run(a.clock.jdTdb + 30);
    b.run(b.clock.jdTdb + 30);
    expect(b.named('Mars').valid).toBe(false);
    const hit = (u: U) => u.physics.log.find((e) => /^Mars hit Earth/.test(e.text))?.text.replace(/at [\d.]+ km\/s/, 'at … km/s');
    expect(hit(b)).toBeTruthy();
    expect(hit(b)).toEqual(hit(a));
    expect(b.named('Earth').pos.distanceTo(a.named('Earth').pos)).toBeLessThan(1000);
  }, 240_000);

  it('a world torn apart comes back as its pieces: one record each, the same pieces in the same places on the receiver\'s device; and a link of the first form still opens', async () => {
    const a = await universe();
    SCENES['the Moon torn into a ring'](a);
    expect(a.physics.swarms.length).toBe(1);
    const sent = decodeWorld(encodeWorld(a.physics.world()!));
    a.physics.rebase(sent);
    const b = await universe(liveDate(a.physics.live!));
    b.physics.adoptWorld(decodeWorld(encodeWorld(sent)), remake(b.sys));
    const pa = a.physics.swarmsNow(), pb = b.physics.swarmsNow();
    expect(pb.time).toBe(pa.time);
    expect(Array.from(pb.list[0].sp.r0)).toEqual(Array.from(pa.list[0].sp.r0));
    expect(b.sys.isGone(b.named('Moon'))).toBe(true);
    expect(pb.list[0].host).toBe(b.named('Earth'));
    // (a link made before worlds could be torn apart: form 1, no swarms; read as it was written)
    const plain = await universe();
    SCENES['the Moon thrown'](plain);
    const w = plain.physics.world()!, raw = encodeWorld(w), head = raw.length - 8 * countDoubles(w);
    expect(raw[0]).toBe(2);
    // (form 2 ends its structure with the number of swarms ever made and of those there are: 0 and 0)
    expect([raw[head - 2], raw[head - 1]]).toEqual([0, 0]);
    const first = Uint8Array.from([1, ...raw.slice(1, head - 2), ...raw.slice(head)]);
    const old = decodeWorld(first);
    expect(old.swarms).toEqual([]);
    expect(old.sim).toEqual(decodeWorld(raw).sim);
  }, 240_000);

  it('a world made comes back as it was: its name, mass, size, what it goes round', async () => {
    const a = await universe();
    SCENES['Earth 2 added'](a);
    const moonPlan = newMoon(a.named('Mars'), [3e7, 0, 0], 1.5 * 1.496e11, 0, MADE_FIRST_ID + 1);
    a.physics.make(moonPlan.json, a.named('Mars'), moonPlan.pos, moonPlan.vel, JD, 'new');
    a.physics.setMass(a.sys.byId.get(MADE_FIRST_ID)!, 2 * a.sys.byId.get(MADE_FIRST_ID)!.gm, JD);
    a.physics.remove(a.named('Venus'), JD);
    const sent = decodeWorld(encodeWorld(a.physics.world()!));
    a.physics.rebase(sent);
    const b = await universe();
    b.physics.adoptWorld(sent, remake(b.sys));
    for (const id of [MADE_FIRST_ID, MADE_FIRST_ID + 1, 299, 399, 499]) {
      const x = a.sys.byId.get(id)!, y = b.sys.byId.get(id)!;
      expect([y.name, y.gm, y.systemGm, y.radius, y.valid, y.parent?.id, b.physics.realGm(y), b.physics.realRadius(y)]).toEqual([x.name, x.gm, x.systemGm, x.radius, x.valid, x.parent?.id, a.physics.realGm(x), a.physics.realRadius(x)]);
      expect([y.pos.x, y.pos.y, y.pos.z]).toEqual([x.pos.x, x.pos.y, x.pos.z]);
    }
    expect(b.sys.isGone(b.named('Venus'))).toBe(true);
    expect(b.physics.made.map((m) => m.name)).toEqual(['Earth 2', "Mars's new moon"]);
    expect(b.physics.log.map((e) => e.text)).toEqual(a.physics.log.map((e) => e.text));
  }, 240_000);

  it('is checked against the catalogue: a link that names what is not here changes nothing', async () => {
    const a = await universe();
    SCENES['Earth 2 added'](a);
    const good = a.physics.world()!;
    const wrong: [string, (w: LiveWorld) => void][] = [
      ['a body that is not in the catalogue', (w) => { w.sim.ids[3] = 123456; }],
      ['a body taken away twice', (w) => { w.gone.push(299, 299); }],
      ['a body taken away and simulated', (w) => { w.gone.push(w.sim.ids[2]); }],
      ['a made world not simulated', (w) => { w.sim.ids[w.sim.ids.indexOf(MADE_FIRST_ID)] = 2000001 + 1e6; }],
      ['a moon made for the Sun', (w) => { w.made[0].kind = 'moon'; }],
      ['a moon carried by what it does not go round', (w) => { w.carried.push([599, [301]]); }],
    ];
    for (const [what, spoil] of wrong) {
      const b = await universe(), w = structuredClone(good);
      spoil(w);
      expect(() => b.physics.adoptWorld(w, remake(b.sys)), what).toThrow(WorldError);
      expect(b.physics.on, what).toBe(false);
      expect(b.physics.made.length, what).toBe(0);
      expect(b.sys.byId.has(MADE_FIRST_ID), what).toBe(false);
    }
  }, 240_000);

  it('checked before the universe here is let go: in a changed universe, a damaged save is refused and nothing here changes; a sound one is accepted', async () => {
    // a save from elsewhere: Mars sent at the Earth
    const other = await universe();
    SCENES['Mars sent at the Earth'](other);
    const sound = decodeWorld(encodeWorld(other.physics.world()!));
    // here: Earth 2 added and the Moon thrown, its prediction taken
    const here = await universe();
    SCENES['Earth 2 added'](here);
    SCENES['the Moon thrown'](here);
    const ahead = (u: U) => {
      const moon = u.named('Moon'), f = new Foresight(), o = u.physics.orbit(moon);
      f.start(u.physics.live!.sim.snapshot(), moon.id, moon.parent ? moon.parent.id : -1, o?.bound ? o.period : 30 * DAY);
      for (let k = 0; !f.done && k < 1e5; k++) f.grow(50);
      return JSON.stringify([f.end, f.count, f.times[f.count - 1]]);
    };
    const before = { bits: bits(here.physics.live!.sim), made: here.physics.made.map((b) => b.name), log: here.physics.log.length, ahead: ahead(here) };
    // damaged: a body the catalogue does not have, a moon in another's family, a world made for what it cannot be
    const damaged: ((w: LiveWorld) => void)[] = [(w) => { w.sim.ids[0] = 11; }, (w) => { w.carried.push([599, [301]]); }, (w) => { w.made.push({ ...here.physics.world()!.made[0], kind: 'moon' }); }];
    for (const spoil of damaged) {
      const w = structuredClone(sound);
      spoil(w);
      expect(() => here.physics.checkWorld(w)).toThrow(WorldError);
    }
    expect(bits(here.physics.live!.sim)).toEqual(before.bits);
    expect([here.physics.made.map((b) => b.name), here.physics.log.length, ahead(here)]).toEqual([before.made, before.log, before.ahead]);
    // the sound one checks out here too, though a world numbered as one made here (Earth 2) is in this universe
    expect(() => here.physics.checkWorld(sound)).not.toThrow();
    const made = decodeWorld(encodeWorld(here.physics.world()!));
    expect(() => here.physics.checkWorld(made)).not.toThrow();
  }, 240_000);

  it('fuzz: damaged changed universes never throw out of the reader but as WorldError, and never put NaN or Infinity into the simulation', async () => {
    let seed = 99;
    const r = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    const worlds: Uint8Array[] = [];
    for (const name of ['the Moon thrown', 'Earth 2 added']) {
      const u = await universe();
      SCENES[name](u);
      worlds.push(encodeWorld(u.physics.world()!));
    }
    let read = 0, adopted = 0;
    let base = await universe();
    for (let n = 0; n < 3000; n++) {
      const src = worlds[n % worlds.length];
      let bytes: Uint8Array;
      if (n % 10 === 0) bytes = Uint8Array.from({ length: Math.floor(r() * 400) }, () => Math.floor(r() * 256));
      else {
        bytes = src.slice();
        // a few bytes changed, or the end cut off, or bytes put in
        const k = 1 + Math.floor(r() * 3);
        for (let j = 0; j < k; j++) {
          const at = Math.floor(r() * bytes.length), what = r();
          if (what < 0.6) bytes[at] ^= 1 << Math.floor(r() * 8);
          else if (what < 0.8) bytes = bytes.slice(0, at);
          else bytes = Uint8Array.from([...bytes.slice(0, at), Math.floor(r() * 256), ...bytes.slice(at)]);
        }
      }
      let w: LiveWorld;
      try {
        w = decodeWorld(bytes);
      } catch (e) {
        expect(e).toBeInstanceOf(WorldError);
        continue;
      }
      read++;
      try {
        base.physics.adoptWorld(w, remake(base.sys));
      } catch (e) {
        expect(e).toBeInstanceOf(WorldError);
        expect(base.physics.on).toBe(false);
        continue;
      }
      adopted++;
      // what was adopted runs: a day of it, and every body's place and motion is a finite number
      base.run(base.clock.jdTdb + 1, 1);
      for (const b of base.sys.bodies) if (b.valid) expect([b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.gm, b.radius].every(Number.isFinite), b.name).toBe(true);
      base = await universe();
    }
    console.log(`fuzz: ${read} of 3000 read, ${adopted} adopted and run`);
    expect(read).toBeGreaterThan(100);
    expect(adopted).toBeGreaterThan(10);
  }, 600_000);
});

/** How many doubles a world writes (as encodeWorld does). */
function countDoubles(w: LiveWorld): number {
  // (the date it left the real universe, the simulation's time, its three settings of rails and its edge)
  let n = 6;
  for (let i = 0; i < w.sim.ids.length; i++) n += (w.asBody[i] & 1 ? 0 : 1) + (w.asBody[i] & 2 ? 0 : 1) + (w.sim.rs[i] > 0 ? 1 : 0) + (w.sim.zon[i] > 0 ? 4 : 0) + 6;
  for (const m of w.made) n += 3 + (m.kind === 'sun' ? 2 : 0);
  n += 2 * w.changed.length + w.log.length;
  // (a world torn apart: its mass and size, colour and how bright its rock, what its pieces go round and when, where and how it moved)
  n += 16 * w.swarms.length;
  return n;
}
