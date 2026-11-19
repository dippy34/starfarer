/**
 * Observable game state shared by the engine, the modes and the UI.
 * Persistent parts (settings, bookmarks, recents, onboarding flag) are saved
 * through the platform key–value store.
 */
import { platform } from '../platform';
import type { TierName } from '../render/qualityTiers';
import { Store } from './store';

export type QualitySetting = 'auto' | TierName;
export type ScaleLevel = 'surface' | 'planet' | 'system' | 'galaxy' | 'cluster' | 'universe';
export type Panel = 'none' | 'search' | 'bookmarks' | 'settings' | 'about';
export type Screen = 'loading' | 'start' | 'explore' | 'photo';

export interface Settings {
  showData: boolean;
  quality: QualitySetting;
  sound: boolean;
  perfHud: boolean;
  constellations: boolean;
  labels: boolean;
  orbits: boolean;
  haptics: boolean;
}

export const DEFAULT_SETTINGS: Settings = { showData: false, quality: 'auto', sound: true, perfHud: false, constellations: false, labels: true, orbits: true, haptics: true };

/** A saved place: where the camera was and what it was looking at. */
export interface SavedPlace {
  /** Display name (target name, or a description of the region). */
  name: string;
  /** Short context such as "Planet · Solar System". */
  detail: string;
  /** Share-link payload that restores the exact view. */
  link: string;
  /** Unix ms. */
  savedAt: number;
}

/** A row in the data overlay: label + formatted value (+ whether it is an estimate). */
export interface DataRow {
  label: string;
  value: string;
  estimated?: boolean;
}

/** What the info card shows for the selected object. */
export interface SelectionInfo {
  id: string;
  name: string;
  /** Plain-language type, e.g. "Ocean world", "Spiral galaxy". */
  type: string;
  description: string;
  /** "Real" (from a catalogue) or "Procedural". */
  real: boolean;
  source: string;
  /** Distance from the camera, metres (updated live). */
  distance: number;
  rows: DataRow[];
  /** True while extra details (ids, names) are still streaming in. */
  pending: boolean;
  canLand: boolean;
}

export interface PerfStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  points: number;
  triangles: number;
  tier: TierName;
  renderScale: number;
  tilesLoaded: number;
  tilesPending: number;
  memoryMb: number;
}

export interface AppState {
  screen: Screen;
  /** Active mode id from the mode registry. */
  mode: string;
  panel: Panel;
  settings: Settings;

  /** Loading progress 0–1 and a friendly status line. */
  loadProgress: number;
  loadStatus: string;
  /** Fatal start-up problem (e.g. WebGL2 missing), shown on the start screen. */
  fatalError: string | null;
  online: boolean;

  // ---- HUD (written by the Explore mode every few frames)
  scale: ScaleLevel;
  /** Breadcrumb of where the player is, outermost first: ["Milky Way", "Solar System", "Earth"]. */
  location: string[];
  speed: number;
  /** Throttle −1…1. */
  throttle: number;
  /** Simulation seconds per real second (0 = paused). */
  timeRate: number;
  /** Simulation time, Unix ms. */
  simTime: number;
  /** Altitude above the nearest surface in metres, or null in open space. */
  altitude: number | null;
  selection: SelectionInfo | null;
  /** Name of the body the camera is orbiting ("focus"), or null in free flight. */
  focusName: string | null;
  /** Autopilot: destination name while flying, else null. */
  flyingTo: string | null;
  /** Black-hole proximity effects: time-dilation factor (≥ 1) or null when no black hole is near. */
  timeDilation: number | null;

  bookmarks: SavedPlace[];
  recents: SavedPlace[];
  onboardingDone: boolean;
  /** Transient message. */
  toast: { text: string; id: number } | null;
  perf: PerfStats | null;
  /** Totals from the data manifest for the About panel. */
  dataTotals: Record<string, number> | null;
}

const storage = platform.storage;

export const appState = new Store<AppState>({
  screen: 'loading',
  mode: 'explore',
  panel: 'none',
  settings: { ...DEFAULT_SETTINGS, ...storage.get<Partial<Settings>>('settings', {}) },
  loadProgress: 0,
  loadStatus: 'Warming up the engines…',
  fatalError: null,
  online: true,
  scale: 'system',
  location: [],
  speed: 0,
  throttle: 0,
  timeRate: 1,
  simTime: Date.now(),
  altitude: null,
  selection: null,
  focusName: null,
  flyingTo: null,
  timeDilation: null,
  bookmarks: storage.get<SavedPlace[]>('bookmarks', []),
  recents: storage.get<SavedPlace[]>('recents', []),
  onboardingDone: storage.get<boolean>('onboardingDone', false),
  toast: null,
  perf: null,
  dataTotals: null,
});

// Persist the durable slices whenever they change.
appState.select((s) => s.settings, (v) => storage.set('settings', v));
appState.select((s) => s.bookmarks, (v) => storage.set('bookmarks', v));
appState.select((s) => s.recents, (v) => storage.set('recents', v));
appState.select((s) => s.onboardingDone, (v) => storage.set('onboardingDone', v));

export function updateSettings(patch: Partial<Settings>): void {
  appState.set({ settings: { ...appState.get().settings, ...patch } });
}

let toastId = 0;
export function showToast(text: string): void {
  appState.set({ toast: { text, id: ++toastId } });
}

const MAX_RECENTS = 20;

/** Remember a visited place (most recent first, de-duplicated by name). */
export function addRecent(place: SavedPlace): void {
  const rest = appState.get().recents.filter((r) => r.name !== place.name);
  appState.set({ recents: [place, ...rest].slice(0, MAX_RECENTS) });
}

export function addBookmark(place: SavedPlace): void {
  const rest = appState.get().bookmarks.filter((b) => b.link !== place.link && b.name !== place.name);
  appState.set({ bookmarks: [place, ...rest] });
}

export function removeBookmark(link: string): void {
  appState.set({ bookmarks: appState.get().bookmarks.filter((b) => b.link !== link) });
}
