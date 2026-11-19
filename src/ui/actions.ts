/**
 * The contract between the UI and whichever mode is running. The UI never
 * reaches into the engine; it calls these actions, and reads state from the store.
 */
import type { SavedPlace } from '../state/appState';

export interface SearchResult {
  title: string;
  subtitle: string;
  icon: string;
  /** Opaque handle the mode understands. */
  payload: unknown;
}

export interface UIActions {
  /** Start-screen button: enter a mode and begin. */
  start(modeId: string): void;
  setThrottle(value: number): void;
  setTimeRate(rate: number): void;
  /** Info card buttons. */
  flyToSelection(): void;
  landOnSelection(): void;
  clearSelection(): void;
  bookmarkSelection(): void;
  shareView(): void;
  /** Focus / flight chips. */
  releaseFocus(): void;
  cancelFlight(): void;
  /** Search. Results may arrive more than once (fast partial list, then complete). */
  search(query: string, onResults: (results: SearchResult[], done: boolean) => void): void;
  openResult(result: SearchResult): void;
  /** Bookmarks & recents. */
  bookmarkView(): void;
  openPlace(place: SavedPlace): void;
  /** Photo mode. */
  enterPhoto(): void;
  exitPhoto(): void;
  takePhoto(): void;
  /** Quick destinations. */
  goHome(): void;
  surpriseMe(): void;
  /** Sound must be unlocked from a user gesture. */
  userGesture(): void;
}

const noop = (): void => undefined;

/** Filled in by the active mode; safe no-ops until then. */
export const actions: UIActions = {
  start: noop, setThrottle: noop, setTimeRate: noop, flyToSelection: noop, landOnSelection: noop, clearSelection: noop, bookmarkSelection: noop, shareView: noop,
  releaseFocus: noop, cancelFlight: noop, search: (_q, cb) => cb([], true), openResult: noop, bookmarkView: noop, openPlace: noop,
  enterPhoto: noop, exitPhoto: noop, takePhoto: noop, goHome: noop, surpriseMe: noop, userGesture: noop,
};

export function setActions(partial: Partial<UIActions>): void {
  Object.assign(actions, partial);
}
