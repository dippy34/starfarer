import { describe, expect, it } from 'vitest';
import { RIDE_ALTITUDE, RIDE_MOST, rideShift } from '../src/game/GroundRide';

describe('a ship over refined ground rides with it', () => {
  it('moves by what the ground changed, up when it rose and down when it sank', () => {
    expect(rideShift(200, 100, false)).toBe(200);
    expect(rideShift(-184, 12, false)).toBe(-184);
    expect(rideShift(0.4, 1500, false)).toBe(0.4);
  });

  it('is not moved when nothing changed', () => {
    expect(rideShift(0, 100, false)).toBe(0);
  });

  it('is not moved when landed (the ground carries it already), or when the number is not one', () => {
    expect(rideShift(50, 0, true)).toBe(0);
    expect(rideShift(Number.NaN, 100, false)).toBe(0);
    expect(rideShift(50, Number.NaN, false)).toBe(0);
    expect(rideShift(Number.POSITIVE_INFINITY, 100, false)).toBe(0);
  });

  it('only rides low over the ground: above about 3 km the ground is a distance, not a floor', () => {
    expect(rideShift(100, RIDE_ALTITUDE, false)).toBe(100);
    expect(rideShift(100, RIDE_ALTITUDE + 1, false)).toBe(0);
    expect(rideShift(100, -RIDE_ALTITUDE - 1, false)).toBe(0);
    expect(rideShift(100, -10, false)).toBe(100);
  });

  it('is bounded, against a broken tile', () => {
    expect(rideShift(5000, 10, false)).toBe(RIDE_MOST);
    expect(rideShift(-5000, 10, false)).toBe(-RIDE_MOST);
  });
});
