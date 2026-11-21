import { Vector3 } from 'three';
import type { Body } from '../universe/Body';
import type { App } from './App';
import type { Hold } from './Input';
import { circularVelocity, dragPlane, onPlane, reachWords, shapeWords, the } from './Powers';

/**
 * The power to move a world (src/app/LivePhysics.ts does the moving; the card of src/ui/Hud.ts
 * offers it). While it is on for the selected world, a finger put down on that world takes hold
 * of it, and it goes where the finger goes: in the plane of the orbit it is on, so that a drag
 * moves it along and across its path (or across the view, where the eye is in that plane). Time
 * waits while the finger is down, and the orbit line of the world, drawn afresh each frame from
 * where it is and how it moves, shows where it would go from there. Where it is left it keeps the
 * velocity it had, or, if asked, is given the one that keeps it on a circle round whatever holds
 * sway at that place, going the way it was going.
 */

/** how near the world's dot a finger, or the mouse's pointer, must come down to take hold of it (px) */
const FINGER_REACH = 30, POINTER_REACH = 14;
/** nothing is left nearer what holds sway there than this many times the two radii together */
const CLEAR = 1.05;

type What = Pick<App, 'rig' | 'physics' | 'clock' | 'bodies' | 'view' | 'project' | 'tellNews'>;

export class Mover {
  /** the world that can be moved now (its card's Move is on), or null */
  body: Body | null = null;
  /** where it is left, it is put on a circle */
  circle = false;
  /** a finger has hold of it */
  holding = false;
  /** the velocity it keeps if it is not put on a circle (m/s): what it had when moving it began, or when it was last taken hold of */
  private kept = new Vector3();

  constructor(private app: What) {}

  /** Begin moving `b` (or stop, if it is the one being moved; stop too for null). */
  toggle(b: Body | null): void {
    if (!b || b === this.body) { this.stop(); return; }
    this.body = b;
    this.circle = false;
    this.kept.copy(b.vel);
  }

  stop(): void {
    this.body = null;
    this.holding = false;
  }

  /** Where it is left it goes in a circle (`on`), or keeps the velocity it had: from now, where it is. */
  leave(circle: boolean): void {
    const b = this.body;
    if (!b || circle === this.circle) return;
    this.circle = circle;
    this.put(b, b.pos.clone());
  }

  /** A pointer has come down at (x, y): if it is on the world being moved, it has hold of it until it lifts. */
  grab(x: number, y: number, touch: boolean): Hold | null {
    const app = this.app, b = this.body, view = b?.valid ? app.bodies.views.get(b) : undefined;
    const at = view && app.project(view.rel);
    if (!b || !view || !at) return null;
    if (Math.hypot(at.x - x, at.y - y) > Math.max(view.pixelRadius / app.view.pixelRatio, touch ? FINGER_REACH : POINTER_REACH)) return null;
    // the plane it moves in, through what it goes round (or through itself, across the view)
    const plane = this.plane(b);
    const round = plane.orbit && b.parent ? app.bodies.views.get(b.parent)?.rel : undefined;
    const through = (round ?? view.rel).clone(), normal = plane.normal;
    // (it does not jump to the finger: the finger keeps the place on it that it took hold of)
    const first = onPlane(app.rig.ray(x, y).toArray(), through.toArray(), normal);
    const off = first ? view.rel.clone().sub(new Vector3(...first)) : new Vector3();
    if (!this.circle) this.kept.copy(b.vel);
    const paused = app.clock.paused;
    app.clock.paused = true;
    this.holding = true;
    return {
      move: (px, py) => {
        const hit = onPlane(app.rig.ray(px, py).toArray(), through.toArray(), normal);
        if (hit && this.body === b) this.put(b, app.rig.upos.toVector3().add(off).add(new Vector3(...hit)));
      },
      end: () => {
        app.clock.paused = paused;
        this.holding = false;
      },
    };
  }

  /** Where the world being moved is on the screen (px), for the ring drawn round it; null if none is, or it is out of view. */
  handle(): { x: number; y: number } | null {
    const view = this.body?.valid ? this.app.bodies.views.get(this.body) : undefined;
    return view ? this.app.project(view.rel) : null;
  }

  /** What the card says while a world is being moved: the plane a finger moves it in, and the orbit it is on now. */
  describe(b: Body): { on: boolean; circle: boolean; plane: string; orbit: string } {
    const on = b === this.body;
    if (!on) return { on, circle: false, plane: '', orbit: '' };
    const o = this.app.physics.orbit(b);
    const orbit = !b.parent ? 'Now it goes round nothing.'
      : !o ? `Now it goes round ${the(b.parent.name)}.`
        : o.bound ? `Now round ${the(b.parent.name)}: ${shapeWords(o)}, ${reachWords(o)}.`
          : `Now on an open path past ${the(b.parent.name)}: it ${reachWords(o)}.`;
    return { on, circle: this.circle, plane: this.plane(b).orbit ? 'It moves in the plane of its orbit.' : 'It moves across your view.', orbit };
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
      if (this.circle) {
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
