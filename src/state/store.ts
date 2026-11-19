/**
 * Minimal observable store. The whole app shares one typed state object;
 * UI components subscribe to the slices they care about and the game loop
 * publishes changes with `set`. No framework, no magic.
 */

export type Listener<T> = (state: T, previous: T) => void;

export class Store<T extends object> {
  private state: T;
  private readonly listeners = new Set<Listener<T>>();

  constructor(initial: T) {
    this.state = initial;
  }

  get(): T {
    return this.state;
  }

  /** Shallow-merge a patch. Listeners run only if at least one value actually changed. */
  set(patch: Partial<T>): void {
    let changed = false;
    for (const key in patch) {
      if (!Object.is(patch[key], this.state[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    const previous = this.state;
    this.state = { ...previous, ...patch };
    for (const listener of [...this.listeners]) listener(this.state, previous);
  }

  /** Subscribe to every change. Returns an unsubscribe function. */
  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Subscribe to a derived value; the callback fires only when the selected
   * value changes (compared with Object.is), and once immediately.
   */
  select<S>(selector: (state: T) => S, callback: (value: S, state: T) => void): () => void {
    let last = selector(this.state);
    callback(last, this.state);
    return this.subscribe((state) => {
      const next = selector(state);
      if (!Object.is(next, last)) {
        last = next;
        callback(next, state);
      }
    });
  }
}
