import { afterEach, describe, expect, it } from 'vitest';
import { deleteScene, savedFragment, savedScenes, saveScene, SAVES_MOST } from '../src/app/Saves';

/** A browser's storage, in memory: `room` characters at most (keys and values), or none at all (`broken`: every write throws, as an older Safari's private browsing). */
function storage(room = Infinity, broken = false) {
  const m = new Map<string, string>();
  const used = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const quota = () => { const e = new DOMException('full', 'QuotaExceededError'); return e; };
  return {
    get length() { return m.size; },
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (broken) throw quota();
      const before = m.get(k);
      m.set(k, v);
      if (used() > room) { if (before === undefined) m.delete(k); else m.set(k, before); throw quota(); }
    },
    removeItem: (k: string) => { m.delete(k); },
    key: (i: number) => [...m.keys()][i] ?? null,
    clear: () => m.clear(),
  };
}

const g = globalThis as { localStorage?: unknown };
afterEach(() => { delete g.localStorage; });

describe('saved scenes on this device', () => {
  it('a scene is kept with a name and a date, listed newest first, opened and deleted', () => {
    g.localStorage = storage();
    expect(saveScene('Moon, 1 Oct 2026', 'v=1&o=Moon', false, new Date('2026-11-23T15:00:00Z'))).toBe('kept');
    expect(saveScene('Jupiter, 1 Oct 2026, changed', 'v=1&o=Jupiter&w=AAAA', true, new Date('2026-11-23T15:05:00Z'))).toBe('kept');
    const list = savedScenes();
    expect(list.map((s) => [s.name, s.saved, s.live])).toEqual([['Jupiter, 1 Oct 2026, changed', '2026-11-23T15:05:00.000Z', true], ['Moon, 1 Oct 2026', '2026-11-23T15:00:00.000Z', false]]);
    expect(savedFragment(list[0].id)).toBe('v=1&o=Jupiter&w=AAAA');
    deleteScene(list[0].id);
    expect(savedScenes().map((s) => s.name)).toEqual(['Moon, 1 Oct 2026']);
    expect(savedFragment(list[0].id)).toBeNull();
  });

  it('at most SAVES_MOST, then it says so', () => {
    g.localStorage = storage();
    for (let i = 0; i < SAVES_MOST; i++) expect(saveScene(`s${i}`, 'v=1', false)).toBe('kept');
    expect(saveScene('one more', 'v=1', false)).toBe('too many');
    expect(savedScenes()).toHaveLength(SAVES_MOST);
  });

  it('storage full: not kept, said so, and nothing half kept', () => {
    g.localStorage = storage(3000);
    expect(saveScene('small', 'v=1', false)).toBe('kept');
    expect(saveScene('big', `v=1&w=${'A'.repeat(4000)}`, true)).toBe('full');
    expect(savedScenes().map((s) => s.name)).toEqual(['small']);
    expect((g.localStorage as Storage).length).toBe(2);
  });

  it('a browser that keeps nothing (private browsing), or none at all: not kept, said so, never a throw', () => {
    g.localStorage = storage(Infinity, true);
    expect(saveScene('x', 'v=1', false)).toBe('unavailable');
    expect(savedScenes()).toEqual([]);
    delete g.localStorage;
    expect(saveScene('x', 'v=1', false)).toBe('unavailable');
    expect(savedScenes()).toEqual([]);
  });

  it('an index changed by hand is read as far as it can be, never thrown on', () => {
    g.localStorage = storage();
    const s = g.localStorage as Storage;
    s.setItem('starfarer-saves', 'not json');
    expect(savedScenes()).toEqual([]);
    s.setItem('starfarer-saves', JSON.stringify([{ id: '../x', name: 'a', saved: '2026-01-01', live: false }, { id: 'ok1', name: '<b>x</b>', saved: '2026-01-01T00:00:00Z', live: true }, 7, null]));
    expect(savedScenes().map((x) => x.id)).toEqual(['ok1']);
  });
});
