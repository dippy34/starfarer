/**
 * Undo: the state the worlds were in before each of the last changes, the newest last, and what
 * makes one change of many small ones. Kept clear of the page and of the simulation (what a state
 * holds is src/app/LivePhysics.ts's and src/app/App.ts's business), so that it can be tested by
 * itself.
 */

/** Undo goes back this many changes at most; there is no redo */
export const UNDO_STEPS = 20;
/** key presses on a control with less than this between them (ms) are one change */
export const RUN_GAP = 600;

/** The states before the last changes, at most `most` of them: the oldest is let go to make room. */
export class History<T> {
  private list: T[] = [];

  constructor(readonly most = UNDO_STEPS) {}

  get size(): number {
    return this.list.length;
  }

  /** The state before a change, kept to go back to. */
  push(state: T): void {
    this.list.push(state);
    if (this.list.length > this.most) this.list.shift();
  }

  /** The state before the last change, taken off: nothing to go forward to again. */
  pop(): T | undefined {
    return this.list.pop();
  }

  /** The newest state kept, not taken off (undefined: none). */
  last(): T | undefined {
    return this.list[this.list.length - 1];
  }

  /** Let go of every state `keep` is false for, the others staying in their order. */
  keepOnly(keep: (state: T) => boolean): void {
    this.list = this.list.filter(keep);
  }

  clear(): void {
    this.list.length = 0;
  }
}

/**
 * One change per gesture, never one per frame or per event: a finger on the mass slider from the
 * moment it comes down until it lifts, however many places it passes; a world held and dragged; a
 * run of arrow keys on the slider with less than RUN_GAP between them. `begin` says when a change
 * begins (the state before it is the one to keep), `end` and `due` when it is over.
 */
export class Gesture {
  /** a change is under way */
  open = false;
  /** a finger or the mouse is down on the control: the change ends when it lifts, not after a pause */
  private held = false;
  private last = 0;

  /**
   * Something happened at `now` (ms): a finger came down on the control (`held`), or the control
   * changed by itself (a key). True if a change begins with it.
   */
  begin(now: number, held = false): boolean {
    this.last = now;
    if (held) this.held = true;
    if (this.open) return false;
    this.open = true;
    return true;
  }

  /** The finger has lifted (or the control was left): true if a change ends with it. */
  end(): boolean {
    const was = this.open;
    this.open = this.held = false;
    return was;
  }

  /** Is a run of changes made without a finger down over by `now` (ms)? */
  due(now: number): boolean {
    return this.open && !this.held && now - this.last >= RUN_GAP;
  }
}
