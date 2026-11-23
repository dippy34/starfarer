import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { App } from '../src/app/App';
import { FreeFly } from '../src/app/FreeFly';

/** the parts of the app free flight touches: a rig with the external move, and the ship and walking not in use */
function fake() {
  const rig = {
    ext: { move: new Vector3(), boost: 1 },
    quat: new Quaternion(),
    touchDrag: 'orbit' as 'orbit' | 'look',
    cancelled: 0,
    cancelGoto() { this.cancelled++; },
  };
  const toasts: string[] = [];
  const app = { rig, game: { active: false }, walk: { active: false }, vr: { active: false }, hud: { toast: (t: string) => toasts.push(t) } };
  return { rig, app, toasts, free: new FreeFly(app as unknown as App) };
}

describe('free flight by touch', () => {
  it('turns on with one finger set to look, and puts it back when it is turned off', () => {
    const { free, rig } = fake();
    rig.touchDrag = 'orbit';
    expect(free.start()).toBe(true);
    expect(free.active).toBe(true);
    expect(rig.touchDrag).toBe('look');
    free.stop();
    expect(free.active).toBe(false);
    expect(rig.touchDrag).toBe('orbit');
    // (and one that was set to look stays so)
    rig.touchDrag = 'look';
    free.start();
    free.stop();
    expect(rig.touchDrag).toBe('look');
  });

  it('moves the rig along the camera\'s axes: up on the stick is forward, right is right, Up is up', () => {
    const { free, rig } = fake();
    free.start();
    free.setStick(0, -0.54);
    free.update(0.016);
    // (the dead middle is 8 %: 0.54 of the travel is (0.54 - 0.08) / 0.92 = 0.5 of a push)
    expect(rig.ext.move.x).toBeCloseTo(0, 9);
    expect(rig.ext.move.z).toBeCloseTo(-0.5, 9);
    expect(rig.ext.boost).toBe(1);
    free.setStick(0.54, 0);
    free.update(0.016);
    expect(rig.ext.move.x).toBeCloseTo(0.5, 9);
    free.setStick(0, 0);
    free.setVertical(1);
    free.update(0.016);
    expect(rig.ext.move.y).toBeCloseTo(1, 9);
    free.setVertical(-1);
    free.update(0.016);
    expect(rig.ext.move.y).toBeCloseTo(-1, 9);
  });

  it('turns the move with the camera', () => {
    const { free, rig } = fake();
    free.start();
    // the camera turned a quarter to the left about its up axis: forward is now along -x
    rig.quat.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    free.setStick(0, -1);
    free.update(0.016);
    expect(rig.ext.move.x).toBeCloseTo(-1, 9);
    expect(rig.ext.move.z).toBeCloseTo(0, 9);
  });

  it('is ten times faster at the rim (Shift) and not just short of it; nothing in the dead middle', () => {
    const { free, rig } = fake();
    free.start();
    free.setStick(0, -1);
    free.update(0.016);
    expect(free.lastPush).toEqual({ push: 1, boost: 10 });
    expect(rig.ext.boost).toBe(10);
    free.setStick(0, -0.88);
    free.update(0.016);
    expect(free.lastPush.boost).toBe(1);
    expect(free.lastPush.push).toBeCloseTo(0.87, 2);
    rig.ext.move.set(0, 0, 0);
    free.setStick(0.05, 0.05);
    free.update(0.016);
    expect(rig.ext.move.length()).toBe(0);
  });

  it('never asks for more than a full push, however it is pushed (stick and Up together)', () => {
    const { free, rig } = fake();
    free.start();
    free.setStick(0, -1);
    free.setVertical(1);
    free.update(0.016);
    expect(rig.ext.move.length()).toBeCloseTo(1, 9);
  });

  it('asks for nothing when it is off, and is put away where the ship or walking has the controls', () => {
    const { free, rig, app, toasts } = fake();
    free.setStick(0, -1);
    free.update(0.016);
    expect(rig.ext.move.length()).toBe(0);
    app.game.active = true;
    expect(free.start()).toBe(false);
    expect(toasts.some((t) => /ship/.test(t))).toBe(true);
    app.game.active = false;
    expect(free.start()).toBe(true);
    app.walk.active = true;
    free.update(0.016);
    expect(free.active).toBe(false);
    expect(rig.touchDrag).toBe('orbit');
  });
});
