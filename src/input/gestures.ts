/**
 * Input abstraction: turns raw pointer / wheel / keyboard events into the
 * handful of semantic gestures the game understands. Touch is the primary
 * path; mouse and keyboard map onto the same gestures.
 *
 *   one finger drag        → look
 *   two finger pinch       → zoom (move toward / away from what you look at)
 *   two finger twist       → roll
 *   tap                    → select
 *   double tap             → fly to
 *   mouse drag / wheel     → look / zoom;  right-drag → roll
 *   keys                   → exposed as a held-key set for the flight controller
 */

export interface GestureHandlers {
  /** Drag delta in CSS pixels. */
  look(dx: number, dy: number): void;
  /** Multiplicative pinch factor for this event (> 1 = fingers moving apart). */
  pinch(factor: number): void;
  /** Roll delta in radians. */
  twist(angle: number): void;
  /** Tap position in CSS pixels relative to the element. */
  tap(x: number, y: number): void;
  doubleTap(x: number, y: number): void;
  /** Any direct interaction started (used to cancel autopilot / dismiss hints). */
  interact(): void;
  /** A key went down (already lower-cased; repeats are filtered). */
  key(code: string): void;
}

const TAP_MAX_MS = 280;
const TAP_MAX_MOVE = 10;
const DOUBLE_TAP_MS = 330;
const DOUBLE_TAP_DIST = 36;

interface Pointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
  moved: number;
  button: number;
}

export class GestureInput {
  /** Currently held keyboard keys (KeyboardEvent.code, lower-cased), for continuous flight controls. */
  readonly held = new Set<string>();
  private readonly pointers = new Map<number, Pointer>();
  private lastTap = { time: 0, x: 0, y: 0 };
  private pinchDist = 0;
  private pinchAngle = 0;
  private enabled = true;

  constructor(private readonly el: HTMLElement, private readonly handlers: GestureHandlers) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.pointers.clear();
      this.held.clear();
    }
  }

  private local(ev: PointerEvent | WheelEvent): [number, number] {
    const r = this.el.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  private readonly onDown = (ev: PointerEvent): void => {
    if (!this.enabled) return;
    const [x, y] = this.local(ev);
    this.pointers.set(ev.pointerId, { id: ev.pointerId, x, y, startX: x, startY: y, startTime: ev.timeStamp, moved: 0, button: ev.button });
    try {
      this.el.setPointerCapture(ev.pointerId);
    } catch {
      /* synthetic events may not be capturable */
    }
    if (this.pointers.size === 2) this.beginPinch();
    this.handlers.interact();
  };

  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    this.pinchDist = Math.hypot(b!.x - a!.x, b!.y - a!.y);
    this.pinchAngle = Math.atan2(b!.y - a!.y, b!.x - a!.x);
  }

  private readonly onMove = (ev: PointerEvent): void => {
    const p = this.pointers.get(ev.pointerId);
    if (!p || !this.enabled) return;
    const [x, y] = this.local(ev);
    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;
    p.moved += Math.abs(dx) + Math.abs(dy);
    if (this.pointers.size === 1) {
      if (p.moved <= TAP_MAX_MOVE * 0.6) return; // still a potential tap: do not jitter the view
      if (ev.pointerType === 'mouse' && p.button === 2) this.handlers.twist(dx * 0.006);
      else this.handlers.look(dx, dy);
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(b!.x - a!.x, b!.y - a!.y);
      const angle = Math.atan2(b!.y - a!.y, b!.x - a!.x);
      if (this.pinchDist > 8 && dist > 8) this.handlers.pinch(dist / this.pinchDist);
      let da = angle - this.pinchAngle;
      if (da > Math.PI) da -= 2 * Math.PI;
      else if (da < -Math.PI) da += 2 * Math.PI;
      if (Math.abs(da) < 0.5) this.handlers.twist(da);
      this.pinchDist = dist;
      this.pinchAngle = angle;
    }
  };

  private readonly onUp = (ev: PointerEvent): void => {
    const p = this.pointers.get(ev.pointerId);
    this.pointers.delete(ev.pointerId);
    if (!p || !this.enabled) return;
    if (this.pointers.size === 1) {
      // Going from two fingers to one: restart the drag from the remaining finger so the view does not jump.
      const rest = [...this.pointers.values()][0]!;
      rest.moved = TAP_MAX_MOVE * 10;
      return;
    }
    if (this.pointers.size === 0 && ev.timeStamp - p.startTime < TAP_MAX_MS && p.moved < TAP_MAX_MOVE && p.button === 0) {
      const since = ev.timeStamp - this.lastTap.time;
      if (since < DOUBLE_TAP_MS && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < DOUBLE_TAP_DIST) {
        this.lastTap.time = 0;
        this.handlers.doubleTap(p.x, p.y);
      } else {
        this.lastTap = { time: ev.timeStamp, x: p.x, y: p.y };
        this.handlers.tap(p.x, p.y);
      }
    }
  };

  private readonly onCancel = (ev: PointerEvent): void => {
    this.pointers.delete(ev.pointerId);
  };

  private readonly onWheel = (ev: WheelEvent): void => {
    if (!this.enabled) return;
    ev.preventDefault();
    // Trackpad pinch arrives as ctrl+wheel with small deltas; normal wheels as ±100 per notch.
    const unit = ev.deltaMode === 1 ? 33 : 1;
    const delta = ev.deltaY * unit * (ev.ctrlKey ? 4 : 1);
    this.handlers.pinch(Math.exp(-delta * 0.0018));
    this.handlers.interact();
  };

  private readonly onContext = (ev: Event): void => {
    ev.preventDefault();
  };

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (!this.enabled) return;
    const target = ev.target as HTMLElement | null;
    // Never steal typing from text fields.
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const code = ev.code.toLowerCase();
    if (!ev.repeat) {
      this.held.add(code);
      this.handlers.key(code);
    }
    if (code === 'space' || code.startsWith('arrow')) ev.preventDefault();
  };

  private readonly onKeyUp = (ev: KeyboardEvent): void => {
    this.held.delete(ev.code.toLowerCase());
  };

  private readonly onBlur = (): void => {
    this.held.clear();
    this.pointers.clear();
  };

  dispose(): void {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onCancel);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
