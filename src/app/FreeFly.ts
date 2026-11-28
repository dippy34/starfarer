import type { App } from './App';

/** a push of the stick past this share of its radius is a boost (the keys' Shift: ten times the speed) */
const BOOST_AT = 0.92;
/** the boost, as Shift gives it */
const BOOST = 10;
/** the stick's dead middle (a thumb resting on it does not move you) */
const DEAD = 0.08;

/**
 * Free flight by touch: the explorer's own flight (the keys W A S D R F: speed in proportion to the
 * height above whatever is nearest, ten times with Shift) without a keyboard. Moving freely (the chip
 * at the top, App.toggleStay) brings a stick under the left thumb, Up and Down under the right; while it
 * is on one finger dragged on the view looks around (as the "One finger looks around" switch does,
 * which it puts back as it was when it is turned off) and everything else is as it was: tap to select,
 * double-tap to fly there, a pinch to zoom, two fingers to look or to twist. Not in the ship nor on
 * foot: they bring their own controls, and starting either puts this away.
 *
 * The stick moves the camera as the keys do (`CameraRig.ext.move`, a direction of the camera's axes
 * with a length up to 1, which the rig smooths and scales by the height above the surface); pushed to
 * the rim it takes the ten times speed.
 */
export class FreeFly {
  private on = false;
  /** the stick (x right, y down, -1..1) and the vertical buttons (+1 up, -1 down) */
  private stick = { x: 0, y: 0 };
  private vert = 0;
  /** what the last frame asked of the rig: the push (0..1 of the stick's travel past its dead middle) and the speed multiplier (1, or 10 at the rim) */
  private asked = { push: 0, boost: 1 };
  /** what one finger did before: put back when it is over */
  private dragBefore: 'orbit' | 'look' | null = null;
  private padEl: HTMLDivElement | null = null;
  private layoutTimer = 0;

  constructor(private app: App) {
    if (typeof document !== 'undefined' && app.hud?.root) this.buildPad(app.hud.root);
  }

  /** flying freely now */
  get active(): boolean {
    return this.on;
  }

  /** the push and the speed multiplier the last frame gave the rig (for the tests and the read-outs) */
  get lastPush(): { push: number; boost: number } {
    return this.asked;
  }

  /** The stick's place (x right, y down, each -1..1, within the unit circle), and Up (+1) or Down (-1) held; 0 when let go. */
  setStick(x: number, y: number): void {
    this.stick.x = x;
    this.stick.y = y;
  }

  setVertical(v: number): void {
    this.vert = v;
  }
  toggle(): void {
    if (this.on) this.stop();
    else this.start();
  }

  /** Begin: false (with a message) where the ship or walking has the controls. */
  start(): boolean {
    const app = this.app;
    if (this.on) return true;
    if (app.game.active || app.walk.active || app.vr.active) {
      app.hud.toast(app.walk.active ? 'On foot: B to fly first' : 'In the ship: it has its own controls (leave it first)');
      return false;
    }
    this.on = true;
    app.rig.cancelGoto();
    this.dragBefore = app.rig.touchDrag;
    app.rig.touchDrag = 'look';
    if (this.padEl) this.padEl.hidden = false;
    this.layout();
    app.hud.toast('Moving freely: the stick flies you (all the way: ten times faster), drag to look. Tap the chip at the top to stay on something', 4);
    return true;
  }

  /** Put it away: the stick and buttons go, one finger does what it did. */
  stop(): void {
    if (!this.on) return;
    this.on = false;
    this.stick.x = this.stick.y = 0;
    this.vert = 0;
    if (this.padEl) this.padEl.hidden = true;
    if (this.dragBefore) this.app.rig.touchDrag = this.dragBefore;
    this.dragBefore = null;
  }

  /** Every frame, before the camera moves: the controls' push as the rig's external move. */
  update(dt: number): void {
    if (!this.on) return;
    const app = this.app, rig = app.rig;
    // (the ship and walking bring their own controls: the camera stays with them, and the chip says so)
    if (app.game.active || app.walk.active || app.vr.active) { this.stop(); app.stay = true; return; }
    this.layoutTimer -= dt;
    if (this.layoutTimer <= 0) { this.layoutTimer = 0.2; this.layout(); }
    const m = Math.hypot(this.stick.x, this.stick.y);
    const push = m < DEAD ? 0 : Math.min(1, (m - DEAD) / (1 - DEAD));
    this.asked.push = push;
    this.asked.boost = m >= BOOST_AT ? BOOST : 1;
    // the camera's axes: x right, y up, z behind it (a stick pushed up is forward)
    const local = rig.ext.move.set(m > 0 ? (this.stick.x / m) * push : 0, this.vert, m > 0 ? (this.stick.y / m) * push : 0);
    if (local.lengthSq() > 1) local.normalize();
    if (local.lengthSq() < 1e-6) return;
    rig.cancelGoto();
    local.applyQuaternion(rig.quat);
    rig.ext.boost = this.asked.boost;
  }

  /**
   * The stick under the left thumb and Up and Down under the right, over the tab bar (upright)
   * or beside it (on its side, where the tabs stand at the left). Measured, as the ship's controls are:
   * what the interface has at the foot of the screen decides where these stand.
   */
  private layout(): void {
    const pad = this.padEl;
    if (!pad || pad.hidden) return;
    const tabs = this.app.hud.root.querySelector<HTMLElement>('.hud-tabs')?.getBoundingClientRect();
    const root = this.app.hud.root.getBoundingClientRect();
    if (!tabs || tabs.width === 0) return;
    const upright = tabs.width > tabs.height;
    pad.style.setProperty('--free-bottom', upright ? `${Math.round(root.bottom - tabs.top + 10)}px` : 'calc(var(--safe-b, 0px) + 12px)');
    pad.style.setProperty('--free-left', upright ? 'calc(var(--safe-l, 0px) + 12px)' : `${Math.round(tabs.right - root.left + 12)}px`);
  }

  private buildPad(root: HTMLElement): void {
    const pad = document.createElement('div');
    pad.className = 'free-pad touch-only';
    pad.hidden = true;
    const arrow = (d: string) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
    pad.innerHTML = '<div class="free-stick" data-cover role="slider" aria-label="Fly: push the way to go, all the way for ten times the speed"><i></i></div>'
      + '<div class="free-buttons" data-cover>'
      + `<button class="free-up" type="button" aria-label="Fly up">${arrow('M12 19V5M6 11l6-6 6 6')}</button>`
      + `<button class="free-down" type="button" aria-label="Fly down">${arrow('M12 5v14M6 13l6 6 6-6')}</button>`
      + '</div>';
    root.appendChild(pad);
    this.padEl = pad;
    const stick = pad.querySelector<HTMLElement>('.free-stick')!, knob = stick.querySelector<HTMLElement>('i')!;
    let id = -1;
    const at = (e: PointerEvent) => {
      const b = stick.getBoundingClientRect(), R = b.width / 2;
      let x = (e.clientX - (b.left + R)) / R, y = (e.clientY - (b.top + R)) / R;
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }
      this.setStick(x, y);
      knob.style.transform = `translate(${(x * R * 0.6).toFixed(1)}px, ${(y * R * 0.6).toFixed(1)}px)`;
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      this.setStick(0, 0);
      knob.style.transform = '';
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; try { stick.setPointerCapture(id); } catch { /* gone */ } at(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) at(e); });
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    // Up and Down, held (the keys R and F)
    for (const [cls, v] of [['.free-up', 1], ['.free-down', -1]] as const) {
      const b = pad.querySelector<HTMLElement>(cls)!;
      let held = -1;
      b.addEventListener('pointerdown', (e) => { held = e.pointerId; try { b.setPointerCapture(held); } catch { /* gone */ } this.setVertical(v); b.toggleAttribute('data-held', true); });
      const lift = (e: PointerEvent) => { if (e.pointerId !== held) return; held = -1; if (this.vert === v) this.setVertical(0); b.toggleAttribute('data-held', false); };
      b.addEventListener('pointerup', lift);
      b.addEventListener('pointercancel', lift);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }
}
