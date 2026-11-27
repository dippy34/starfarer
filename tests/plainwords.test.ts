import { describe, expect, it } from 'vitest';
import { brightnessWords, plainDistance, plainSpeedWords } from '../src/app/plainWords';

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

describe('the chip at the top in plain words: how far, how fast (never AU, parsecs or c)', () => {
  const AU = 1.495978707e11, C = 299_792_458;
  it('distances in km, millions or billions of km, then light years', () => {
    expect(plainDistance(13.36 * AU)).toBe('2 billion km');
    expect(plainDistance(0.5 * AU)).toBe('74.8 million km');
    expect(plainDistance(384_400e3)).toBe('384,400 km');
    expect(plainDistance(4.24 * 9.4607e15)).toMatch(/^4\.2\d? light years$/);
    for (const m of [0.01 * AU, AU, 30 * AU, 2000 * AU]) expect(plainDistance(m)).not.toMatch(/AU|pc|ly\b/);
  });
  it('speeds in km/h, then km/s, then against light', () => {
    expect(plainSpeedWords(250)).toBe('900 km/h');
    expect(plainSpeedWords(12_340)).toBe('12.3 km/s');
    expect(plainSpeedWords(0.25 * C)).toBe('0.25 × light speed');
    expect(plainSpeedWords(1234 * C)).toBe('1,230 × light speed');
    for (const v of [5, 5e3, 5e6, 5e9]) expect(plainSpeedWords(v)).not.toMatch(/m\/s\b(?<!km\/s)| c$/);
  });
});
