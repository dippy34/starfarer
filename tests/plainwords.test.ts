import { describe, expect, it } from 'vitest';
import { brightnessWords } from '../src/app/plainWords';

describe("a star's brightness in plain words (the card's first read)", () => {
  it('says how many times brighter, or what share, or how many times fainter: never "0 times"', () => {
    expect(brightnessWords(25.4)).toBe('25.4 times as bright as the Sun');
    expect(brightnessWords(1.02)).toBe('about as bright as the Sun');
    expect(brightnessWords(0.8)).toBe('80% as bright as the Sun');
    expect(brightnessWords(0.15)).toBe('15% as bright as the Sun');
    // TRAPPIST-1: about 0.00055 of the Sun's light
    expect(brightnessWords(0.000552)).toBe('1,800 times fainter than the Sun');
    expect(brightnessWords(0.05)).toBe('20 times fainter than the Sun');
  });
});
