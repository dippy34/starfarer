import { describe, expect, it } from 'vitest';
import { type FlightReadout, fmtPace, fmtWarp, WARP_STEPS } from '../src/game/Flight';
import { glance } from '../src/game/FlightHud';
import { C } from '../src/sim/Gravity';

/** a readout as Flight fills it, with what a test changes */
function readout(over: Partial<FlightReadout>): FlightReadout {
  return {
    frame: 'Sun', altitude: 1e20, vertSpeed: 0, orbitSpeed: 0, surfSpeed: 0, conic: null, tImpact: NaN, tAp: NaN, tPe: NaN, ap: NaN, pe: NaN,
    escape: false, encounter: '', gForce: 0, tidal: 0, throttle: 0, fuel: 1, dv: 0, sas: 'stability', rails: false, rate: 1, limited: false,
    dilation: 1, shipTime: 0, universeTime: 0, heat: 0, hullTemp: 290, drive: 'reactionless', driveG: 1000, atLimit: false, properSpeed: 0, gamma: 1,
    target: '', targetDist: NaN, etaShip: NaN, etaUniverse: NaN, arrival: NaN, etaBy: '', autopilot: '', apState: '', stop: '', stopTau: NaN, halfSky: Math.PI / 2, doppler: 1,
    landed: '', refusal: '', warning: '', warnLevel: 0, pace: 1, paceUniverse: 1, asked: 1, why: '',
    ...over,
  };
}

describe('the instruments at a glance (a touch screen)', () => {
  it('give the speed with its nines and the Lorentz factor, never "1.000 c"', () => {
    // γ = 2.5×10⁶: 1 - β = 8×10⁻¹⁴
    const gamma = 2.5e6, w = Math.sqrt(gamma * gamma - 1) * C;
    const g = glance(readout({ properSpeed: w, gamma }));
    expect(g.speed).toBe('0.999 999 999 999 92 c');
    expect(g.side).toBe('γ 2.5×10⁶');
    expect(g.speed).not.toMatch(/^1\.0/);
  });

  it('give the target with the time to it in both clocks, and what the autopilot is doing', () => {
    const g = glance(readout({
      properSpeed: 0.5 * C, gamma: 1.1547, target: 'Andromeda Galaxy', targetDist: 2.466e6 * 9.4607e15,
      etaShip: 12 * 86400 + 2 * 3600, etaUniverse: 2.28e6 * 3.15576e7, etaBy: 'flip-and-burn', autopilot: 'Andromeda Galaxy · accelerating', apState: 'accelerating',
    }));
    expect(g.state).toBe('Autopilot: accelerating');
    expect(g.target).toBe('Andromeda Galaxy · 2.466 million ly');
    expect(g.toGo).toBe('there in 12 d 2 h for you · 2.28 million yr outside');
  });

  it('while slow near a world: the height and the orbit', () => {
    const g = glance(readout({ frame: 'Earth', altitude: 393e3, properSpeed: 7670, gamma: 1 + 3.3e-10, conic: { e: 0.001 } as FlightReadout['conic'], pe: 391e3, ap: 395e3, driveG: 1 }));
    expect(g.speed).toBe('7.67 km/s');
    expect(g.side).toBe('393 km up');
    expect(g.state).toBe('Orbit 391 km × 395 km over Earth');
  });
});

describe('a trip that would take years, in plain words', () => {
  it('on the fusion torch: why, and what to do', () => {
    // Sirius coasting on the torch (a playtester read "to go 130,252 yr" and nothing else)
    const g = glance(readout({ drive: 'torch', target: 'Sirius', targetDist: 8.1e16, etaShip: 130_252 * 3.15576e7, etaUniverse: 130_252 * 3.15576e7, etaBy: 'coasting' }));
    expect(g.toGo).toBe("there in 130,252 yr for you · 130,252 yr outside. The torch's fuel can never get you there sooner: tap Fusion torch for the reactionless drive");
  });
  it('a short trip needs no advice', () => {
    expect(glance(readout({ target: 'Moon', targetDist: 3.8e8, etaShip: 3600, etaUniverse: 3600, etaBy: 'flip-and-burn' })).toGo).toBe('there in 1 h 0 min for you · 1 h 0 min outside');
  });
});

describe('Stop at a glance', () => {
  it('says what it does and the time to go aboard', () => {
    const g = glance(readout({ stop: 'braking beside Sun', stopTau: 3 * 3600 + 120 }));
    expect(g.state).toBe('Stop: braking beside Sun · 3 h 2 min aboard');
    expect(g.stateClass).toBe('ok');
  });
});

describe('the ship\'s time warp in words', () => {
  it('names the steps exactly, and a rate held between them to two figures', () => {
    expect(WARP_STEPS.map(fmtWarp)).toEqual(['×1', '×10', '×100', '×1,000', '×10,000', '×100,000']);
    expect(fmtWarp(99_990)).toBe('×100,000');
    expect(fmtWarp(3712)).toBe('×3,700');
    expect(fmtWarp(0)).toBe('×0');
  });

  it('says how fast a clock runs', () => {
    expect(fmtPace(1)).toBe('real time');
    expect(fmtPace(100_000)).toBe('1.16 days a second');
    expect(fmtPace(2468 * 3.15576e7)).toBe('2,470 years a second');
    expect(fmtPace(2.5e6 * 3.15576e7)).toBe('2.5 million years a second');
    expect(fmtPace(0)).toBe('stopped');
  });
});
