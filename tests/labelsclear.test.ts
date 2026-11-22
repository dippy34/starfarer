import { describe, expect, it } from 'vitest';
import { type LabelCandidate, layoutLabels } from '../src/render/Labels';

const name = (key: string, x: number, y: number, priority = 1): LabelCandidate => ({ key, text: key, x, y, radius: 3, priority, cls: 'star' });

describe('names and the interface', () => {
  it('no name is set under a part of the interface over the view, nor at its edge', () => {
    // a card from (400, 60) to (760, 200), as the ship's instruments on a phone on its side
    const card = { l: 400, t: 60, r: 760, b: 200 };
    const shown = layoutLabels([
      name('Aldebaran', 500, 120, 5), // under the card
      name('M35', 395, 120, 4), // its name would run onto the card
      name('Uranus', 200, 120, 3), // clear of it
      name('James Webb Space Telescope', 420, 215, 2), // its name would sit just under the card's foot
    ], 844, 390, null, [card]);
    expect(shown.map((s) => s.c.key)).toEqual(['Uranus']);
    for (const s of shown) expect(s.x + s.w <= card.l || s.x >= card.r || s.y + s.h <= card.t || s.y >= card.b).toBe(true);
  });

  it('with nothing kept clear, names go where they did', () => {
    expect(layoutLabels([name('Aldebaran', 500, 120)], 844, 390).length).toBe(1);
  });
});
