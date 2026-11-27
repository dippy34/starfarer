import { describe, expect, it, vi } from 'vitest';
import { NAME_WHY, WORLD_LIMITS, takeName } from '../src/app/SceneWorld';

const takenBy = (n: string) => ['earth', 'sirius', 'new gas giant'].includes(n.toLowerCase());
const never = () => false;

describe('takeName', () => {
  it('takes a plain name as it is', () => {
    expect(takeName('Big Blue', never)).toEqual({ name: 'Big Blue' });
  });

  it('trims spaces at either end', () => {
    expect(takeName('  Big Blue  ', never)).toEqual({ name: 'Big Blue' });
  });

  it('refuses a name of only spaces, or an empty one, as not plain', () => {
    expect(takeName('   ', never)).toEqual({ why: NAME_WHY.plain });
    expect(takeName('', never)).toEqual({ why: NAME_WHY.plain });
  });

  it('takes a name of exactly WORLD_LIMITS.name characters, and refuses one longer', () => {
    expect(WORLD_LIMITS.name).toBe(40);
    expect(takeName('a'.repeat(40), never)).toEqual({ name: 'a'.repeat(40) });
    expect(takeName('a'.repeat(41), never)).toEqual({ why: NAME_WHY.plain });
  });

  it('trims before the length is counted', () => {
    expect(takeName(`   ${'a'.repeat(40)}   `, never)).toEqual({ name: 'a'.repeat(40) });
  });

  it('refuses markup and odd marks as not plain', () => {
    for (const s of ['<b>x</b>', 'Big_Blue', 'a\nb', '-Big']) {
      expect(takeName(s, never)).toEqual({ why: NAME_WHY.plain });
    }
  });

  it('takes names with apostrophes, hyphens and points', () => {
    for (const s of ["Mars's Twin", 'Kepler-22 b', 'Earth 2.0']) {
      expect(takeName(s, never)).toEqual({ name: s });
    }
  });

  it('refuses a name another thing has, in any letter case, and trims first', () => {
    for (const s of ['Earth', 'earth', 'EARTH', '  Sirius ', 'new gas giant']) {
      expect(takeName(s, takenBy)).toEqual({ why: NAME_WHY.taken });
    }
    expect(NAME_WHY.taken).toBe('That name is taken');
  });

  it('gives the taken predicate the trimmed name', () => {
    const taken = vi.fn(never);
    takeName('  Big Blue  ', taken);
    expect(taken).toHaveBeenCalledTimes(1);
    expect(taken).toHaveBeenCalledWith('Big Blue');
  });

  it('does not ask the taken predicate about a name that is not plain', () => {
    const taken = vi.fn(never);
    takeName('<b>x</b>', taken);
    takeName('   ', taken);
    takeName('a'.repeat(41), taken);
    expect(taken).not.toHaveBeenCalled();
  });
});
