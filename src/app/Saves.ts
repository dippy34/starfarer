import { forget, keep, type Kept, recall } from '../platform/storage';

/**
 * Scenes saved on this device (More: Saved scenes): each is kept as the part after the '#' of its
 * link (src/app/SceneLink.ts), so a save opens exactly as its link would, and an index lists them
 * with a name and a date. The browser's storage is src/platform/storage.ts's; where it keeps
 * nothing (private browsing in an older Safari, storage switched off) or is full, saving says so
 * and nothing else is lost. What is read back is checked like a link (it could have been changed
 * by hand): an index that cannot be read is an empty list.
 */

export interface SavedScene {
  /** its own key */
  id: string;
  /** what it is, as the list shows it: "Moon, 2 Oct 2026" */
  name: string;
  /** when it was saved (ISO 8601, UTC) */
  saved: string;
  /** a changed universe (live physics), not the real one */
  live: boolean;
}

/** at most this many scenes are kept */
export const SAVES_MOST = 20;
const INDEX = 'saves';
const sceneKey = (id: string) => `save-${id}`;

/** The scenes saved, newest first. */
export function savedScenes(): SavedScene[] {
  let raw: unknown;
  try {
    raw = JSON.parse(recall(INDEX) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is SavedScene => !!s && typeof s === 'object'
    && typeof s.id === 'string' && /^[a-z0-9]{1,24}$/.test(s.id)
    && typeof s.name === 'string' && s.name.length > 0 && s.name.length <= 120
    && typeof s.saved === 'string' && Number.isFinite(Date.parse(s.saved))
    && typeof s.live === 'boolean').slice(0, SAVES_MOST);
}

/** Why a scene was not saved, or that it was: as `keep` says, or that the list is full. */
export type Saved = Kept | 'too many';

/** Save a scene (`fragment`: its link's part after the '#') under `name`, now. */
export function saveScene(name: string, fragment: string, live: boolean, now = new Date()): Saved {
  const list = savedScenes();
  if (list.length >= SAVES_MOST) return 'too many';
  const id = `${now.getTime().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`;
  const kept = keep(sceneKey(id), fragment);
  if (kept !== 'kept') return kept;
  const index = keep(INDEX, JSON.stringify([{ id, name, saved: now.toISOString(), live }, ...list]));
  // (the scene without its place in the list would be kept for nothing)
  if (index !== 'kept') forget(sceneKey(id));
  return index;
}

/** A saved scene's link (the part after the '#'), or null if it is not kept any more. */
export function savedFragment(id: string): string | null {
  return savedScenes().some((s) => s.id === id) ? recall(sceneKey(id)) : null;
}

/** Forget a saved scene. */
export function deleteScene(id: string): void {
  const list = savedScenes();
  keep(INDEX, JSON.stringify(list.filter((s) => s.id !== id)));
  forget(sceneKey(id));
}
