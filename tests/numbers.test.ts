import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fmtDuration, fmtLength, hillRadius, M_EARTH, num, shown, YEAR } from '../src/sim/physics';
import { SolarSystem } from '../src/universe/SolarSystem';

// The figures on a card read alike (playtest D3: "57200 km" beside "1.471e6 km", radii without their thousands marked).
const PUBLIC = join(fileURLToPath(new URL('..', import.meta.url)), 'public');
globalThis.fetch = (async (url: string | URL) => new Response(readFileSync(join(PUBLIC, String(url).replace(/^\//, ''))))) as typeof fetch;

describe('numbers as the card shows them', () => {
  it('a result from a thousand to a billion is written whole, its thousands marked; the working keeps the short form', () => {
    expect(shown(57_213)).toBe('57,210');
    expect(shown(1.4713e6)).toBe('1,471,000');
    expect(shown(999.94)).toBe('999.9');
    expect(shown(9.8196)).toBe('9.82');
    expect(shown(1.32712440041e20)).toBe('1.327e20');
    expect(shown(0.00123)).toBe('1.23e-3');
    expect(num(57_213)).toBe('57210');
    expect(fmtLength(1.4713e9)).toBe('1,471,000 km');
    expect(fmtDuration(12_000 * YEAR)).toBe('12,000 yr');
    // the Moon's Hill sphere (the card said "57200 km"), its working keeping the short form
    const moon = hillRadius(384_400e3, 0.0549, 7.342e22, M_EARTH);
    expect(moon.text).toMatch(/^\d\d,\d\d0 km$/);
    expect(moon.math.endsWith(`= ${moon.text}`)).toBe(true);
    expect(moon.math).not.toMatch(/\d,\d\d\d m·/);
  });

  it("a world's three radii are written as its mean radius is", async () => {
    const sys = await SolarSystem.load('/data');
    const radius = (name: string) => new Map(sys.bodies.find((b) => b.name === name)!.info()).get('Radius');
    expect(radius('Earth')).toMatch(/^6,371(\.\d)? km \(6,378\.1 × 6,378\.1 × 6,356\.8\)/);
    expect(radius('Jupiter')).toMatch(/^69,911 km \(71,492 × 71,492 × 66,854\)/);
  });
});
