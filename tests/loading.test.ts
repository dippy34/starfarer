import { describe, expect, it } from 'vitest';
import { count, formatBytes, LOAD_PLAN, LoadProgress } from '../src/app/Loading';

const plan = [['a', 'First', 1], ['b', 'Second', 3], ['c', 'Third', 4]] as const;

describe('what the loading screen is told', () => {
  it('a stage is waiting, then running, then done with what it brought', async () => {
    const p = new LoadProgress(plan);
    const seen: string[] = [];
    p.onChange = () => seen.push(p.stages.map((s) => s.state[0]).join(''));
    let finish!: (n: number) => void;
    const work = p.run('b', new Promise<number>((r) => { finish = r; }), (n) => `${n} things`);
    expect(p.running.map((s) => s.id)).toEqual(['b']);
    expect(p.fraction).toBe(0);
    finish(42);
    expect(await work).toBe(42);
    expect(p.done.map((s) => `${s.label} · ${s.note}`)).toEqual(['Second · 42 things']);
    expect(p.running).toEqual([]);
    expect(seen).toEqual(['wrw', 'wdw']);
  });

  it('the bar is the share of the work done, by weight: it never runs ahead and never goes back', () => {
    const p = new LoadProgress(plan);
    expect(p.fraction).toBe(0);
    p.begin('c');
    expect(p.fraction).toBe(0);           // started is not done
    p.end('a');
    expect(p.fraction).toBeCloseTo(1 / 8, 12);
    p.advance('c', 0.5, '2 of 4');
    expect(p.fraction).toBeCloseTo(3 / 8, 12);
    expect(p.running[0].note).toBe('2 of 4');
    p.advance('c', 0.25);                 // a piece counted late does not take the bar back
    expect(p.fraction).toBeCloseTo(3 / 8, 12);
    p.end('c', '4 pieces');
    p.end('b');
    expect(p.fraction).toBe(1);
    expect(p.finished).toBe(true);
  });

  it('stages are listed in the order they started and finished, whatever the plan says', () => {
    const p = new LoadProgress(plan);
    p.begin('c');
    p.begin('a');
    expect(p.running.map((s) => s.id)).toEqual(['c', 'a']);
    p.end('a');
    p.end('b'); // (finished without ever being seen running)
    expect(p.done.map((s) => s.id)).toEqual(['a', 'b']);
    expect(p.running.map((s) => s.id)).toEqual(['c']);
  });

  it('a stage can say what it is once that is known', () => {
    const p = new LoadProgress(plan);
    p.begin('a', 'Maps of Earth');
    expect(p.running[0].label).toBe('Maps of Earth');
  });

  it('a failure names the stage and keeps the first cause', async () => {
    const p = new LoadProgress(plan);
    await expect(p.run('a', Promise.reject(new Error('HTTP 404')))).rejects.toThrow('HTTP 404');
    p.fail('b', new Error('follows from it'));
    expect(p.error?.stage?.id).toBe('a');
    expect(p.error?.message).toBe('HTTP 404');
    expect(p.stages[0].state).toBe('failed');
    expect(p.finished).toBe(false);
  });

  it('counts what the browser says it downloaded', () => {
    const p = new LoadProgress(plan);
    p.received(1_500_000);
    p.received(0); // from the cache
    expect(p.files).toBe(2);
    expect(p.bytes).toBe(1_500_000);
  });

  it('an unknown stage is a mistake in the code, not something to show', () => {
    expect(() => new LoadProgress(plan).begin('nope')).toThrow('no loading stage');
  });

  it("the app's own plan has no stage twice and no weightless one", () => {
    expect(new Set(LOAD_PLAN.map(([id]) => id)).size).toBe(LOAD_PLAN.length);
    for (const [, label, weight] of LOAD_PLAN) {
      expect(label.length).toBeGreaterThan(3);
      expect(weight).toBeGreaterThan(0);
    }
  });
});

describe('numbers as people read them', () => {
  it('sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(840_400)).toBe('840 KB');
    expect(formatBytes(3_240_000)).toBe('3.2 MB');
    expect(formatBytes(27_700_000)).toBe('28 MB');
  });

  it('counts', () => {
    expect(count(1, 'moon')).toBe('1 moon');
    expect(count(459, 'moon')).toBe('459 moons');
    expect(count(119614, 'star')).toBe('119,614 stars');
    expect(count(2_750_000, 'star')).toBe('2.75 million stars');
    expect(count(3_000_000, 'star')).toBe('3 million stars');
    expect(count(2, 'galaxy', 'galaxies')).toBe('2 galaxies');
  });
});
