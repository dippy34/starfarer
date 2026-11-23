import { Quaternion, Vector3 } from 'three';
import type { App } from '../app/App';
import { VIEW_MASK } from '../render/ViewMask';
import type { Game } from './Game';
import { updateShipLight } from './ShipLight';
import { GLOW_VIEW, SHIP_LIGHT } from './shipShader';
import { ShipShadow } from './shipShadow';

/**
 * The ship's looks, once a frame while aboard: its light (the star, the world nearby), the drive it
 * shows (the torch's plume and hot radiators, or the reactionless drive's glow), the chase view's
 * framing for the screen's shape, the head-up markers' size in CSS pixels, and the mask that keeps
 * the names on the sky off the cockpit's frame and the ship (`render/ViewMask.ts`).
 */
export class ShipArt {
  /** the names' mask (the same one `Labels` reads), here for the browser suite to measure */
  readonly mask = VIEW_MASK;
  private shadow = new ShipShadow();
  /** the rig's orientation a frame ago, and how fast it turns (rad/s about its own axes, smoothed) */
  private lastQ = new Quaternion();
  private turn = new Vector3();
  private turnRaw = new Vector3();
  /** the share of the view's width and height that the interface leaves clear, eased (for the chase view's framing) */
  private clear = { w: 1, h: 1 };

  constructor(private app: App, private game: Game) {}

  update(dt: number): void {
    VIEW_MASK.clear();
    const app = this.app, g = this.game;
    // (out of the ship the turn is only followed, so boarding starts from rest)
    if (!g.active) { this.lastQ.copy(app.rig.quat); this.turn.set(0, 0, 0); return; }
    updateShipLight(app, performance.now() / 1000);
    GLOW_VIEW.uPixel.value = app.view.pixelAngle;
    // (radians per CSS pixel: the markers keep their size on the screen whatever the frame's resolution)
    const cssPixel = app.view.pixelAngle * app.view.pixelRatio;
    g.hud.cssPixel = cssPixel;
    g.viz.cssPixel = cssPixel;
    const f = g.flight;
    if (f.on) {
      const s = f.ship;
      const pushing = s.throttle > 0 && (s.drive === 'reactionless' || s.fuel > 0);
      g.ship.setDrive(s.drive, pushing ? s.throttle : 0);
    }
    g.ship.update(dt);
    // how fast the ship turns, in its own axes (a frame's rotation over its duration, smoothed)
    const dq = this.lastQ.invert().multiply(app.rig.quat);
    if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
    const ang = 2 * Math.acos(Math.min(1, dq.w)), s = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
    if (dt > 0 && s > 1e-9 && ang < 1) this.turnRaw.set(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(ang / dt);
    else this.turnRaw.set(0, 0, 0);
    this.turn.lerp(this.turnRaw, 1 - Math.exp(-dt / 0.35));
    this.lastQ.copy(app.rig.quat);
    if (g.mode === 'chase') {
      // (framed as in the part of the view the interface leaves clear, as the optical centre eases to its middle)
      const part = app.hud.clearPart(), k = 1 - Math.exp(-dt / 0.1);
      this.clear.w += ((part?.shifts ? Math.min(1, (part.box.r - part.box.l) / app.view.width) : 1) - this.clear.w) * k;
      this.clear.h += ((part?.shifts ? Math.min(1, (part.box.b - part.box.t) / app.view.height) : 1) - this.clear.h) * k;
      g.ship.frameChase(app.view.aspect, app.view.fovY, this.turn, this.clear);
      // its shadows from the star (none when the star is hidden: nothing to cast)
      if (SHIP_LIGHT.uSun.value > 0) {
        const geo = g.ship.hull.geometry;
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        this.shadow.render(app.renderer.gl, g.ship.hull, SHIP_LIGHT.uSunDir.value, geo.boundingSphere!.radius * g.ship.group.scale.x + 0.5);
      } else this.shadow.off();
    } else this.shadow.off();
    // (a headset has no names laid over a screen)
    if (app.vr.active) return;
    if (g.mode === 'cockpit') this.maskCockpit(cssPixel);
    else if (g.mode === 'chase') this.maskShip(cssPixel);
  }

  /** The frame's members as thick lines on the screen, the dashboard as all that is under its edge. */
  private maskCockpit(cssPixel: number): void {
    const app = this.app, c = this.game.cockpit;
    const q = app.renderer.rig.quaternion;
    const w = new Vector3();
    for (const m of c.members) {
      let px = 0, py = 0, pr = 0, have = false;
      for (let i = 0; i < m.path.length; i += 2) {
        w.copy(m.path[i]).applyQuaternion(q);
        // (the frame stays where it is on the screen when the optical centre moves: Game.holdCockpit)
        const s = app.project(w, true);
        if (!s) { have = false; continue; }
        const r = m.half / w.length() / cssPixel + 1.5;
        if (have) VIEW_MASK.capsules.push({ ax: px, ay: py, bx: s.x, by: s.y, r: Math.max(pr, r) });
        px = s.x; py = s.y; pr = r; have = true;
      }
    }
    const edge: number[] = [];
    let first: { x: number; y: number } | null = null, last: { x: number; y: number } | null = null;
    for (const p of c.edge) {
      const s = app.project(w.copy(p).applyQuaternion(q), true);
      if (!s) continue;
      edge.push(s.x, s.y);
      first ??= s;
      last = s;
    }
    if (first && last && edge.length >= 4) {
      const below = app.view.height + 4000;
      edge.push(last.x, below, first.x, below);
      VIEW_MASK.polys.push({ pts: edge });
    }
  }

  /** The ship's body as thick lines, its radiators as quads. */
  private maskShip(cssPixel: number): void {
    const app = this.app, s = this.game.ship;
    s.group.updateMatrixWorld(true);
    const m = s.body.matrixWorld;
    const scale = s.group.scale.x;
    const a = new Vector3(), b = new Vector3();
    for (const [p0, p1, r] of s.cover.capsules) {
      a.copy(p0).applyMatrix4(m);
      b.copy(p1).applyMatrix4(m);
      const sa = app.project(a), sb = app.project(b);
      if (!sa || !sb) continue;
      VIEW_MASK.capsules.push({ ax: sa.x, ay: sa.y, bx: sb.x, by: sb.y, r: (r * scale) / Math.min(a.length(), b.length()) / cssPixel });
    }
    for (const quad of s.cover.quads) {
      const pts: number[] = [];
      for (const p of quad) {
        const sp = app.project(a.copy(p).applyMatrix4(m));
        if (!sp) break;
        pts.push(sp.x, sp.y);
      }
      if (pts.length === quad.length * 2) VIEW_MASK.polys.push({ pts });
    }
  }
}
