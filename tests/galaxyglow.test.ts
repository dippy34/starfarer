import { Vector3, WebGLCoordinateSystem, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { GalaxyGlow, nextFaces } from '../src/render/GalaxyLayer';

/**
 * A stand-in for the renderer: it records, for every face of every cube map, the place the glow
 * was ray-marched from when that face was last drawn.
 */
function fakeRenderer(glow: GalaxyGlow) {
  const drawnFrom = new Map<object, (number[] | null)[]>();
  let bound: { t: object | null; f: number } = { t: null, f: 0 };
  const uCam = (glow as unknown as { mat: { uniforms: { uCam: { value: Vector3 } } } }).mat.uniforms.uCam;
  const gl = {
    coordinateSystem: WebGLCoordinateSystem,
    xr: { enabled: false },
    getRenderTarget: () => bound.t,
    getActiveCubeFace: () => bound.f,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: (t: object | null, f = 0) => { bound = { t, f }; },
    render: () => {
      if (!bound.t) return;
      const faces = drawnFrom.get(bound.t) ?? [null, null, null, null, null, null];
      faces[bound.f] = uCam.value.toArray();
      drawnFrom.set(bound.t, faces);
    },
  } as unknown as WebGLRenderer;
  return { gl, shownFrom: () => drawnFrom.get(glow.target) ?? [] };
}

describe('the Milky Way glow', () => {
  it('draws the faces not yet done, the map whole after the sixth', () => {
    expect(nextFaces([false, false, false, false, false, false], 1)).toEqual({ faces: [0], whole: false });
    expect(nextFaces([true, true, true, true, true, false], 1)).toEqual({ faces: [5], whole: true });
    expect(nextFaces([false, false, false, false, false, false], 6)).toEqual({ faces: [0, 1, 2, 3, 4, 5], whole: true });
  });

  it('shows a map of one place only, while the eye flies thousands of parsecs a frame', () => {
    const glow = new GalaxyGlow();
    const { gl, shownFrom } = fakeRenderer(glow);
    const eye = new Vector3(-8200, 0, 20);
    glow.update(gl, eye, 6);
    expect(glow.ready).toBe(true);
    for (let frame = 0; frame < 40; frame++) {
      eye.add(new Vector3(-700, 300, 1200)); // the app's flight out of the galaxy: kpc a frame
      glow.update(gl, eye, 1);
      const faces = shownFrom();
      expect(faces.every((p) => p !== null)).toBe(true);
      const places = new Set(faces.map((p) => p!.join(',')));
      expect(places.size).toBe(1);
      expect([...places][0]).toBe(glow.cam.toArray().join(','));
    }
    // and it follows: the map shown is never more than eleven frames behind (six to draw one, five waiting for it)
    expect(glow.cam.distanceTo(eye)).toBeLessThanOrEqual(11 * Math.hypot(700, 300, 1200) + 1);
  });

  it('does nothing while the eye stays put', () => {
    const glow = new GalaxyGlow();
    const { gl, shownFrom } = fakeRenderer(glow);
    const eye = new Vector3(-8200, 0, 20);
    glow.update(gl, eye, 6);
    const before = JSON.stringify(shownFrom());
    for (let i = 0; i < 10; i++) glow.update(gl, eye, 1);
    expect(JSON.stringify(shownFrom())).toBe(before);
  });
});
