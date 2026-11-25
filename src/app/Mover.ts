import { Vector3 } from 'three';
import type { Body } from '../universe/Body';
import type { App } from './App';
import type { Hold } from './Input';
import {
  AIM_PER_CIRCLE, AIM_SHORTEST, aimFactor, circularVelocity, dragPlane, farWords, type FingerAt, fingerVelocity, flickFactor, flickOf, onPlane,
  orbitWords, squareThrow, the, throwVelocity,
} from './Powers';

/**
 * The power to move a world (src/app/LivePhysics.ts does the moving; the card of src/ui/Hud.ts
 * offers it). While it is on for the selected world, a finger put down on that world takes hold
 * of it, and it goes where the finger goes: in the plane of the orbit it is on, so that a drag
 * moves it along and across its path (or across the view, where the eye is in that plane). Time
 * waits while the finger is down, and the orbit line of the world, drawn afresh each frame from
 * where it is and how it moves, shows where it would go from there. Where it is left it keeps the
 * velocity it had, or, if asked, is given the one that keeps it on a circle round whatever holds
 * sway at that place, going the way it was going.
 *
 * Or it is thrown (`how` 'throw'): the world stays where it is and the finger draws the throw.
 * Pulled back from the world, as a slingshot is, an arrow shows which way it will go and how fast,
 * marked where it would go round in a circle and where it would escape, and the orbit line and the
 * card show the orbit it would be on; let go, and it goes. A quick flick throws it the way the
 * finger went, as fast as the finger was going (src/app/Powers.ts: flickOf). Speeds are told in
 * speeds of a circle about what holds sway where the world is.
 *
 * A world just made is put in place (`placing`, src/app/App.ts: add): it goes where the finger
 * takes it and is left on a circle there, or, let go while the finger is still going, thrown the
 * way it went. That is all one change with its making, until Done.
 */

/** how near the world's dot a finger, or the mouse's pointer, must come down to take hold of it (px) */
const FINGER_REACH = 30, POINTER_REACH = 14;
/** nothing is left nearer what holds sway there than this many times the two radii together */
const CLEAR = 1.05;
/** a way on the screen is found in space by following it this far from the world (px) */
const STEP = 24;

type What = Pick<App, 'rig' | 'physics' | 'clock' | 'viewOf' | 'view' | 'project' | 'tellNews' | 'beginChange' | 'endChange' | 'cancelChange' | 'placed'>;

/** What a world being moved does where it is left: keeps the velocity it had, goes round in a circle, or is thrown. */
export type Leave = 'keep' | 'circle' | 'throw';

/** The slingshot's arrow, as drawn over the view (src/ui/Hud.ts: setAim). */
export interface Aim {
  /** where the world is on the screen, and how far from there its edge is (CSS px) */
  x: number; y: number; edge: number;
  /** the way the arrow points on the screen (a unit vector) and how long it is from the edge (CSS px; 0: no throw yet) */
  ux: number; uy: number; length: number;
  /** how far along it the speeds of a circle and of escape are (CSS px from the edge) */
  circle: number; escape: number;
  /** the throw is exactly one of them */
  snapped: 'circle' | 'escape' | null;
}

export class Mover {
  /** the world that can be moved now (its card's Move is on), or null */
  body: Body | null = null;
  /** what it does where it is left */
  how: Leave = 'keep';
  /** it has just been made and is being put in place: one change with its making, until Done (App.placed) */
  placing = false;
  /** a finger has hold of it */
  holding = false;
  /** being put in place, it was last let go with a flick: a new mass does not put it back on a circle */
  private thrown = false;
  /** the velocity it keeps if it is not put on a circle (m/s): what it had when moving it began, or when it was last taken hold of */
  private kept = new Vector3();
  /** the slingshot being pulled: its speed in speeds of a circle (0: no throw yet) and its way in space */
  private aiming: { f: number; dir: Vector3 | null } | null = null;

  constructor(private app: What) {}

  /** Begin moving `b` (or stop, if it is the one being moved; stop too for null). */
  toggle(b: Body | null): void {
    if (!b || b === this.body) { this.stop(); return; }
    this.stop();
    this.body = b;
    this.how = 'keep';
    this.kept.copy(b.vel);
  }

  /** Put `b`, just made, in place: Move on, left on a circle where a finger leaves it, until Done. */
  place(b: Body): void {
    this.stop();
    this.body = b;
    this.how = 'circle';
    this.placing = true;
    this.thrown = false;
    this.kept.copy(b.vel);
  }

  /** Moving is over (`done`: a world being put in place is where it is wanted: its making ends, watched). */
  stop(done = false): void {
    const placing = this.placing;
    this.body = null;
    this.holding = false;
    this.placing = false;
    this.aiming = null;
    if (placing) this.app.placed(done);
  }

  /** What it does where it is left, from now. Keeping its speed or going in a circle is a change of its own where it is now (to undo and to watch). */
  leave(how: Leave): void {
    const b = this.body;
    if (!b || how === this.how) return;
    const was = this.how;
    this.how = how;
    if (how === 'throw' || was === 'throw') { this.kept.copy(b.vel); return; }
    this.app.beginChange('move', b, true, `moving ${the(b.name)}`);
    this.put(b, b.pos.clone());
    this.app.endChange();
  }

  /** The world being put in place has a new mass: on a circle again, unless it was thrown. */
  recircle(): void {
    const b = this.body;
    if (b && this.placing && !this.thrown) this.put(b, b.pos.clone());
  }

  /** A pointer has come down at (x, y), at `t` (ms): if it is on the world being moved, it has hold of it until it lifts. */
  grab(x: number, y: number, touch: boolean, t: number): Hold | null {
    const app = this.app, b = this.body, view = b?.valid ? app.viewOf(b) : undefined;
    const at = view && app.project(view.rel);
    if (!b || !view || !at) return null;
    if (Math.hypot(at.x - x, at.y - y) > Math.max(view.pixelRadius / app.view.pixelRatio, touch ? FINGER_REACH : POINTER_REACH)) return null;
    // the plane it moves in, through what it goes round (or through itself, across the view)
    const plane = this.plane(b);
    if (this.how === 'throw' && !this.placing) return this.sling(b, plane.normal, x, y, t);
    const round = plane.orbit && b.parent ? app.viewOf(b.parent)?.rel : undefined;
    const through = (round ?? view.rel).clone(), normal = plane.normal;
    // (it does not jump to the finger: the finger keeps the place on it that it took hold of)
    const first = onPlane(app.rig.ray(x, y).toArray(), through.toArray(), normal);
    const off = first ? view.rel.clone().sub(new Vector3(...first)) : new Vector3();
    if (this.how !== 'circle') this.kept.copy(b.vel);
    // (the hold is one change, to undo and to watch: a watch under way ends first, its rate of time put back. Putting a
    // world just made in place is part of its making)
    if (!this.placing) app.beginChange('move', b, true, `moving ${the(b.name)}`);
    const paused = app.clock.paused, places: FingerAt[] = [{ t, x, y }];
    const origin = app.physics.system.origin, eyeAt = () => (origin ? app.rig.upos.sub(origin, new Vector3()) : app.rig.upos.toVector3());
    app.clock.paused = true;
    this.holding = true;
    return {
      move: (px, py, pt) => {
        places.push({ t: pt, x: px, y: py });
        const hit = onPlane(app.rig.ray(px, py).toArray(), through.toArray(), normal);
        // (from the eye to the system's origin: the Solar System's is the universe's own, another star's is that star's place: src/sim/SystemSim.ts)
        if (hit && this.body === b) this.put(b, eyeAt().add(off).add(new Vector3(...hit)));
      },
      end: (px, py, pt, cancelled) => {
        places.push({ t: pt, x: px, y: py });
        // (time runs again as it did before the hold, then the watch of the change begins; unless the hold was ended from
        // elsewhere meanwhile: Undo sets the clock itself)
        if (this.holding) app.clock.paused = paused;
        this.holding = false;
        // a world being put in place, let go while the finger was still going: thrown the way it went
        if (this.placing && this.body === b && !cancelled) {
          const v = fingerVelocity(places), f = flickFactor(v.speed);
          this.thrown = f !== null && this.throwAt(b, normal, f, v.dx / v.speed, v.dy / v.speed);
        }
        if (!this.placing) app.endChange();
      },
    };
  }

  /**
   * The slingshot (and the flick): the world stays where it is; the arrow points from it the other
   * way from the finger's pull, as long as the pull (AIM_PER_CIRCLE for each speed of a circle), and
   * the world is given that throw at once, for its orbit line and the card to show; let go, it goes.
   * Let go where it was taken hold of, or taken away by the browser: nothing was thrown. A quick
   * flick throws it the finger's way instead.
   */
  private sling(b: Body, normal: [number, number, number], x0: number, y0: number, t0: number): Hold {
    const app = this.app, physics = app.physics;
    app.beginChange('move', b, true, `throwing ${the(b.name)}`);
    const paused = app.clock.paused, wasLive = physics.on, kept = b.vel.clone(), places: FingerAt[] = [{ t: t0, x: x0, y: y0 }];
    const aiming = (this.aiming = { f: 0, dir: null as Vector3 | null });
    app.clock.paused = true;
    this.holding = true;
    return {
      move: (x, y, t) => {
        places.push({ t, x, y });
        if (this.body !== b) return;
        const px = x0 - x, py = y0 - y, len = Math.hypot(px, py);
        if (len >= AIM_SHORTEST) {
          aiming.f = aimFactor(len);
          aiming.dir = this.throwAt(b, normal, aiming.f, px / len, py / len) ? this.thrownDir : null;
        } else if (aiming.f > 0) {
          // (back where it took hold: no throw, the world as it was)
          aiming.f = 0;
          aiming.dir = null;
          physics.move(b, b.pos.toArray(), kept.toArray(), app.clock.jdTdb);
        }
      },
      end: (x, y, t, cancelled) => {
        places.push({ t, x, y });
        if (this.aiming === aiming) this.aiming = null;
        if (this.holding) app.clock.paused = paused;
        this.holding = false;
        const here = this.body === b && !cancelled;
        const flick = here ? flickOf(places) : null;
        if (flick) this.throwAt(b, normal, flick.f, flick.dx, flick.dy);
        else if (!here || aiming.f === 0) { app.cancelChange(); return; }
        app.tellNews(wasLive);
        app.endChange();
      },
    };
  }

  /** the way in space of the last throw (a unit vector) */
  private thrownDir = new Vector3();

  /**
   * Throw `b` at `f` speeds of a circle, the way (ux, uy) points on the screen from where it is, in
   * the plane whose normal is `normal`; square to the line from what holds sway when nearly so
   * (src/app/Powers.ts: squareThrow). False if there is no way to tell which way that is in space,
   * or nothing holds sway there.
   */
  private throwAt(b: Body, normal: [number, number, number], f: number, ux: number, uy: number): boolean {
    const physics = this.app.physics, sway = physics.swayAt(b.pos.toArray(), b), dir = this.along(b, normal, ux, uy);
    if (!sway || !dir) return false;
    const r = b.pos.clone().sub(sway.pos).toArray(), d = squareThrow(dir.toArray(), r, normal), v = throwVelocity(r, sway.gm + b.gm, d, f);
    this.thrownDir.set(...d);
    physics.move(b, b.pos.toArray(), [sway.vel.x + v[0], sway.vel.y + v[1], sway.vel.z + v[2]], this.app.clock.jdTdb);
    return true;
  }

  /** The way in space (a unit vector, in the plane whose normal is `normal`) that (ux, uy) on the screen points from where `b` is; null if the view cannot tell. */
  private along(b: Body, normal: [number, number, number], ux: number, uy: number): Vector3 | null {
    const app = this.app, view = app.viewOf(b), at = view && app.project(view.rel);
    if (!view || !at) return null;
    const through = view.rel.toArray();
    const p = onPlane(app.rig.ray(at.x, at.y).toArray(), through, normal);
    const q = onPlane(app.rig.ray(at.x + STEP * ux, at.y + STEP * uy).toArray(), through, normal);
    if (!p || !q) return null;
    const d = new Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    return d.lengthSq() > 0 ? d.normalize() : null;
  }

  /** Where the world being moved is on the screen (px), for the ring drawn round it; null if none is, or it is out of view. */
  handle(): { x: number; y: number } | null {
    const view = this.body?.valid ? this.app.viewOf(this.body) : undefined;
    return view ? this.app.project(view.rel) : null;
  }

  /** The slingshot's arrow as it is to be drawn now, or null while none is being pulled. */
  aim(): Aim | null {
    const a = this.aiming, b = this.body, app = this.app;
    const view = a && b?.valid ? app.viewOf(b) : undefined;
    const at = view && app.project(view.rel);
    if (!a || !view || !at) return null;
    const edge = Math.max(10, view.pixelRadius / app.view.pixelRatio);
    const aim: Aim = { x: at.x, y: at.y, edge, ux: 0, uy: 0, length: 0, circle: AIM_PER_CIRCLE, escape: Math.SQRT2 * AIM_PER_CIRCLE, snapped: null };
    if (!(a.f > 0) || !a.dir) return aim;
    // (the arrow points the way the world goes: in space, then seen from the eye)
    const tip = app.project(view.rel.clone().addScaledVector(a.dir, 1e-3 * view.rel.length()));
    const dx = tip ? tip.x - at.x : 0, dy = tip ? tip.y - at.y : 0, len = Math.hypot(dx, dy);
    if (!(len > 0)) return aim;
    return { ...aim, ux: dx / len, uy: dy / len, length: a.f * AIM_PER_CIRCLE, snapped: a.f === 1 ? 'circle' : a.f === Math.SQRT2 ? 'escape' : null };
  }

  /** What the card says while a world is being moved: what it does where it is left, the plane a finger moves it in, and the orbit it is on now. */
  describe(b: Body): { on: boolean; how: Leave; placing: boolean; plane: string; orbit: string } {
    const on = b === this.body;
    if (!on) return { on, how: 'keep', placing: false, plane: '', orbit: '' };
    const o = this.app.physics.orbit(b), sun = this.app.physics.system.sun;
    // (one bound to nothing is leaving: on an open path past the Sun, unless it is the Sun)
    const free = !b.parent && b !== sun && sun.valid ? this.app.physics.orbit(b, sun) : null;
    const orbit = !b.parent ? (free && !free.bound ? `Now on an open path past the Sun: it passes at ${farWords(free.peri)}, then leaves.` : 'Now it goes round nothing.')
      : !o ? `Now it goes round ${the(b.parent.name)}.`
        // (its nearest is inside what it goes round: it falls into it)
        : o.peri < b.parent.radius + b.radius ? `Now on a path into ${the(b.parent.name)}: it hits it.`
          : o.bound ? `Now round ${the(b.parent.name)}: ${orbitWords(o)}.`
            : `Now on an open path past ${the(b.parent.name)}: it passes at ${farWords(o.peri)}, then leaves.`;
    return { on, how: this.how, placing: this.placing, plane: this.plane(b).orbit ? 'It moves in the plane of its orbit.' : 'It moves across your view.', orbit };
  }

  private plane(b: Body): { normal: [number, number, number]; orbit: boolean } {
    const p = b.parent, sight = new Vector3(0, 0, -1).applyQuaternion(this.app.view.quat);
    return dragPlane(p ? b.pos.clone().sub(p.pos).toArray() : null, p ? b.vel.clone().sub(p.vel).toArray() : null, sight.toArray());
  }

  /** Put the world at `pos` (m from the system's centre) with the velocity it is to have there. */
  private put(b: Body, pos: Vector3): void {
    const physics = this.app.physics, sway = physics.swayAt(pos.toArray(), b);
    const vel = this.kept.clone();
    if (sway) {
      const r = pos.clone().sub(sway.pos), least = CLEAR * (sway.radius + b.radius);
      if (r.length() < least) pos.copy(sway.pos).addScaledVector(r.lengthSq() > 0 ? r.normalize() : r.set(1, 0, 0), least);
      if (this.how === 'circle') {
        // round what holds sway there, going the way it was going
        const from = pos.clone().sub(sway.pos), turning = from.clone().cross(this.kept.clone().sub(sway.vel));
        const normal = turning.lengthSq() > 0 ? turning.normalize() : new Vector3(...this.plane(b).normal);
        vel.copy(sway.vel).add(new Vector3(...circularVelocity(from.toArray(), sway.gm + b.gm, normal.toArray())));
      }
    }
    const wasLive = physics.on;
    physics.move(b, pos.toArray(), vel.toArray(), this.app.clock.jdTdb);
    this.app.tellNews(wasLive);
  }
}
