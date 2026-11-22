import { touchFirst } from '../core/device';
import { TouchGestures, type Delta, type Drag, type Point } from './Gestures';

/** What the pointing devices did since the last frame (positions in CSS px from the view's top-left). */
export interface InputFrame {
  /** mouse: left-button drag (px): look around */
  look: Delta;
  /** mouse: right-button or Shift drag (px) and where the pointer is: orbit */
  orbit: Drag;
  /** touch: one finger dragging (px) and where it is */
  touch: Drag;
  /** touch: two fingers travelling together (px) */
  pan: Delta;
  /** wheel ticks (towards the user: positive) and where the pointer was */
  wheel: number;
  wheelAt: Point | null;
  /** pinch: the natural log of the factor by which the fingers closed in (spread apart: negative), and its middle */
  pinch: number;
  pinchAt: Point | null;
  /** two-finger twist (rad), clockwise on the screen positive */
  twist: number;
}

export function emptyFrame(): InputFrame {
  return {
    look: { dx: 0, dy: 0 }, orbit: { dx: 0, dy: 0, x: 0, y: 0 }, touch: { dx: 0, dy: 0, x: 0, y: 0 }, pan: { dx: 0, dy: 0 },
    wheel: 0, wheelAt: null, pinch: 0, pinchAt: null, twist: 0,
  };
}

/**
 * A pointer that has taken hold of something in the view: told where it goes and when (`t`: the
 * event's time, ms), and where and when it lets go; `cancelled`: the browser took it away (a
 * system gesture, a call), and what it was doing is not to be finished.
 */
export interface Hold {
  move(x: number, y: number, t: number): void;
  end(x: number, y: number, t: number, cancelled: boolean): void;
}

/** Keyboard, mouse and touch, collected between frames. */
export class Input {
  readonly keys = new Set<string>();
  /** a click or a tap on the view; `touch`: made with a finger (it needs a finger-sized target) */
  onTap: ((x: number, y: number, touch: boolean) => void) | null = null;
  onDoubleTap: ((x: number, y: number, touch: boolean) => void) | null = null;
  onKey: ((ev: KeyboardEvent) => void) | null = null;
  /** any finger or button that comes down on the view, and the wheel turned over it: the explorer has the camera in hand */
  onDown: (() => void) | null = null;
  /**
   * Asked whenever a finger or the left mouse button comes down on the view: is there something
   * under it to take hold of (a world the explorer is moving)? If so that pointer is the hold's
   * until it lifts: it neither turns the view nor taps.
   */
  grab: ((x: number, y: number, touch: boolean, t: number) => Hold | null) | null = null;
  private held: { id: number; hold: Hold; x: number; y: number } | null = null;
  /** mouse motion while the pointer is locked (walking, src/app/Walk.ts) */
  look = { dx: 0, dy: 0 };
  /** a finger has touched the view */
  touched = false;
  /** the device is held and touched (a phone, a tablet), not pointed at with a mouse */
  readonly coarse = touchFirst();
  readonly gestures = new TouchGestures();
  private frame = emptyFrame();
  private down: { button: number; x: number; y: number; moved: boolean } | null = null;
  private mouse: Point | null = null;
  private lastPointer = 'mouse';

  constructor(private el: HTMLElement) {
    // the view takes every touch itself: the browser must not scroll, zoom or refresh the page with it
    el.style.touchAction = 'none';
    el.addEventListener('gesturestart', (e) => e.preventDefault()); // (Safari's own pinch)
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.gestures.onTap = (x, y) => this.onTap?.(x, y, true);
    this.gestures.onDoubleTap = (x, y) => this.onDoubleTap?.(x, y, true);
    el.addEventListener('pointerdown', (e) => {
      // (a pointer that is already gone cannot be captured: nothing is lost)
      try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      const p = this.local(e);
      this.lastPointer = e.pointerType;
      this.onDown?.();
      // (touching the view leaves any text field: the on-screen keyboard goes away)
      if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
      if (!this.held && (e.pointerType !== 'mouse' || e.button === 0)) {
        const hold = this.grab?.(p.x, p.y, e.pointerType !== 'mouse', e.timeStamp);
        if (hold) {
          if (e.pointerType !== 'mouse') this.touched = true;
          this.held = { id: e.pointerId, hold, x: p.x, y: p.y };
          return;
        }
      }
      if (e.pointerType === 'mouse') {
        this.down = { button: e.button, x: p.x, y: p.y, moved: false };
        return;
      }
      this.touched = true;
      this.gestures.down(e.pointerId, p.x, p.y, e.timeStamp);
    });
    el.addEventListener('pointermove', (e) => {
      if (document.pointerLockElement === el) { this.look.dx += e.movementX; this.look.dy += e.movementY; return; }
      const p = this.local(e);
      if (this.held?.id === e.pointerId) { this.held.x = p.x; this.held.y = p.y; this.held.hold.move(p.x, p.y, e.timeStamp); return; }
      if (e.pointerType !== 'mouse') { this.gestures.move(e.pointerId, p.x, p.y, e.timeStamp); return; }
      this.mouse = p;
      const d = this.down;
      if (!d) return;
      if (Math.abs(p.x - d.x) + Math.abs(p.y - d.y) > 4) d.moved = true;
      const f = this.frame;
      if (d.button === 0 && !e.shiftKey) { f.look.dx += e.movementX; f.look.dy += e.movementY; }
      else { f.orbit.dx += e.movementX; f.orbit.dy += e.movementY; }
    });
    el.addEventListener('pointerup', (e) => {
      const p = this.local(e);
      if (this.letGo(e.pointerId, p, e.timeStamp, false)) return;
      if (e.pointerType !== 'mouse') { this.gestures.up(e.pointerId, p.x, p.y, e.timeStamp); return; }
      if (this.down && !this.down.moved && this.down.button === 0) this.onTap?.(p.x, p.y, false);
      this.down = null;
    });
    el.addEventListener('pointercancel', (e) => {
      if (this.held?.id === e.pointerId && this.letGo(e.pointerId, this.held, e.timeStamp, true)) return;
      if (e.pointerType !== 'mouse') this.gestures.cancel(e.pointerId);
      else this.down = null;
    });
    // (browsers also report a double tap as a double click: the gestures have already handled it)
    el.addEventListener('dblclick', (e) => { if (this.lastPointer === 'mouse') { const p = this.local(e); this.onDoubleTap?.(p.x, p.y, false); } });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.onDown?.();
      this.frame.wheel += Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 100 + 0.5);
      this.frame.wheelAt = this.local(e);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      // typing in a text field is not flying (a checkbox or slider with focus doesn't take the keys)
      const t = e.target as HTMLInputElement | null;
      if (t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT' || (t?.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(t.type))) return;
      // (a button with the keyboard's focus is pressed by Space and Enter: they are not shortcuts then)
      if (t?.tagName === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter')) return;
      this.keys.add(e.code);
      this.onKey?.(e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** The pointer that held something has lifted at `at` (or been cancelled there): true if it was this one. */
  private letGo(id: number, at: Point, t: number, cancelled: boolean): boolean {
    const held = this.held;
    if (held?.id !== id) return false;
    this.held = null;
    held.hold.end(at.x, at.y, t, cancelled);
    return true;
  }

  /** Everything since the last call; the next frame starts empty. */
  consume(): InputFrame {
    const f = this.frame;
    const g = this.gestures.take(performance.now());
    f.touch = g.drag;
    f.pan = g.pan;
    f.pinch = g.pinch;
    f.pinchAt = g.pinchAt;
    f.twist = g.twist;
    if (this.mouse) { f.orbit.x = this.mouse.x; f.orbit.y = this.mouse.y; }
    this.frame = emptyFrame();
    return f;
  }

  get element(): HTMLElement {
    return this.el;
  }

  /** fingers are in use, or expected: the interface speaks of taps, not keys */
  get touch(): boolean {
    return this.coarse || this.touched;
  }

  /** an event's position from the view's top-left corner */
  private local(e: MouseEvent): Point {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
}
