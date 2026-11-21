import { describe, expect, it } from 'vitest';
import { Vector3, type Vector2, type Vector4 } from 'three';
import {
  applyStarLook, FACE_KEY, FACE_TOP, faceColor, faceLight, faceResponse, fire, SPOT_SLOTS, spinAt, spotAt, starLook, starLookUniforms, turnShare, untone,
} from '../src/render/StarLook';

const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** The display's tone curve (shaders/tone.ts: spToneCurve), in the same arithmetic. */
const tone = (y: number) => Math.min(Math.max((y * (y + 0.0245786) - 0.000090537) / (y * (0.983729 * y + 0.432951) + 0.238081), 0), 1);

describe("the colours of a star's face", () => {
  it('the Sun is the orange of the observatories\' pictures; cooler stars redder, hotter ones gold, white, blue', () => {
    const sun = faceColor(5772);
    expect(sun[0]).toBeGreaterThan(0.7);
    expect(sun[1] / sun[0]).toBeGreaterThan(0.1);
    expect(sun[1] / sun[0]).toBeLessThan(0.25);
    expect(sun[2]).toBeLessThan(0.02);
    // the green falls away as the star cools: orange, red-orange, red
    const green = [5772, 5000, 4300, 3700, 3200, 2500].map((t) => faceColor(t)[1] / faceColor(t)[0]);
    for (let i = 1; i < green.length; i++) expect(green[i]).toBeLessThan(green[i - 1]);
    // an F star is gold, an A star white, B and O stars blue
    const gold = faceColor(6800), white = faceColor(8500), blue = faceColor(20000);
    expect(gold[1] / gold[0]).toBeGreaterThan(0.3);
    expect(gold[2]).toBeLessThan(gold[1]);
    expect(Math.max(...white) - Math.min(...white)).toBeLessThan(0.15);
    expect(blue[2]).toBeGreaterThan(2 * blue[0]);
    // nothing to fall off: beyond the ends of the table, the end
    expect(faceColor(900)).toEqual(faceColor(2500));
    expect(faceColor(90000)).toEqual(faceColor(25000));
    expect(faceColor(0)).toEqual(faceColor(5800));
    // and no step anywhere between
    for (let t = 2400; t < 30000; t *= 1.01) {
      const a = faceColor(t), b = faceColor(t * 1.01);
      for (let c = 0; c < 3; c++) expect(Math.abs(a[c] - b[c])).toBeLessThan(0.045);
    }
  });

  it('where the face is as bright as its mean it is its own colour; darker is deeper, brighter paler, the brightest white-hot', () => {
    for (const t of [3000, 4300, 5772, 6500, 9940, 25000]) {
      const face = faceColor(t);
      const mean = fire(face, 1);
      for (let c = 0; c < 3; c++) expect(mean[c]).toBeCloseTo(face[c], 9);
      // every colour grows with the brightness, and none is shown above the top
      let last = [0, 0, 0];
      for (let I = 0.05; I < 30; I *= 1.15) {
        const d = fire(face, I);
        for (let c = 0; c < 3; c++) {
          expect(d[c]).toBeGreaterThanOrEqual(last[c]);
          expect(d[c]).toBeLessThanOrEqual(FACE_TOP);
        }
        last = d;
      }
      // the colour it has least of comes in last: what is dark is deeper in the star's colour, what is bright paler
      const weak = face.indexOf(Math.min(...face)), strong = face.indexOf(Math.max(...face));
      const share = (I: number) => fire(face, I)[weak] / fire(face, I)[strong];
      expect(share(0.4)).toBeLessThan(share(1));
      expect(share(1)).toBeLessThan(share(3));
      // far above its mean it is white-hot
      expect(Math.min(...fire(face, 25))).toBeGreaterThan(0.8);
    }
    // the Sun's own: a dark patch is deep red, a bright thread yellow, the core of an active region white
    const sun = faceColor(5772);
    expect(fire(sun, 0.4)[1] / fire(sun, 0.4)[0]).toBeLessThan(0.07);
    expect(fire(sun, 2)[1] / fire(sun, 2)[0]).toBeGreaterThan(0.35);
    expect(fire(sun, 2)[2]).toBeLessThan(0.1);
    expect(fire(sun, 8)[2]).toBeGreaterThan(0.5);
  });

  it('the light written is the light the display\'s tone curve brings to the colour designed', () => {
    for (const y of [0.01, 0.1, 0.25, 0.4, 0.6, 0.8, 0.9]) expect(tone(untone(y))).toBeCloseTo(y, 9);
    for (const t of [3000, 5772, 9940]) {
      const face = faceColor(t);
      for (const I of [0.3, 1, 2, 5]) {
        const light = faceLight(face, I), shown = fire(face, I);
        // (the curve scales a colour by the response of its brightness)
        const k = tone(lum(light)) / lum(light);
        for (let c = 0; c < 3; c++) expect(light[c] * k).toBeCloseTo(shown[c], 9);
      }
    }
    // a face at its mean is written near the level the exposure aims at for it
    expect(lum(faceLight(faceColor(5772), 1))).toBeGreaterThan(0.5 * FACE_KEY);
    expect(lum(faceLight(faceColor(5772), 1))).toBeLessThan(1.5 * FACE_KEY);
  });

  it('the shader is handed the same answer', () => {
    const look = starLook('sun', 5772, 1, 4.83, true);
    const u = starLookUniforms(look);
    const { k, p } = faceResponse(look.face);
    expect((u.uFaceK.value as Vector3).toArray()).toEqual(k);
    expect((u.uFaceP.value as Vector3).toArray()).toEqual(p);
    for (let c = 0; c < 3; c++) expect(FACE_TOP * (1 - Math.exp(-k[c] * 2 ** p[c]))).toBeCloseTo(fire(look.face, 2)[c], 12);
  });
});

describe('how a star is drawn up close', () => {
  it('the Sun: a seething surface, a little activity, a glowing skin at its limb', () => {
    const sun = starLook('sun', 5772, 1, 4.83, true);
    expect(sun.face).toEqual(faceColor(5772));
    expect(sun.texAmp).toBeGreaterThan(0.6);
    // the mottling that stands out is a few hundredths of the radius across
    expect(sun.texFreq).toBeGreaterThan(30);
    expect(sun.texFreq).toBeLessThan(60);
    expect(sun.limb).toBe(0);
    expect(sun.chromosphere).toBeGreaterThan(0.5);
    expect(sun.rays).toBe(1);
    expect(sun.flattening).toBe(0);
  });

  it('the Sun has a handful of active regions in its two belts, none of them large', () => {
    const sun = starLook('sun', 5772, 1, 4.83, true);
    expect(sun.spots.length).toBeGreaterThanOrEqual(10);
    expect(sun.spots.length).toBeLessThanOrEqual(SPOT_SLOTS);
    const deg = 180 / Math.PI;
    for (const s of sun.spots) {
      expect(Math.abs(s.lat) * deg).toBeGreaterThan(5);
      expect(Math.abs(s.lat) * deg).toBeLessThan(35);
      // (the largest spots seen on the Sun are a twentieth of its radius or so across)
      expect(s.size).toBeGreaterThan(0.004);
      expect(s.size).toBeLessThan(0.06);
    }
    expect(sun.spots.some((s) => s.lat > 0)).toBe(true);
    expect(sun.spots.some((s) => s.lat < 0)).toBe(true);
    // the groups are not copies of one another
    const leaders = sun.spots.filter((s, i) => i === 0 || s.size > sun.spots[i - 1].size);
    expect(new Set(leaders.map((s) => s.size.toFixed(4))).size).toBe(leaders.length);
    expect(new Set(leaders.map((s) => s.lat.toFixed(3))).size).toBe(leaders.length);
    // and are spread round the star: some are in view from any side
    for (let side = 0; side < 4; side++) {
      const from = (side * Math.PI) / 2;
      expect(sun.spots.some((s) => Math.cos(s.lon - from) > 0.3)).toBe(true);
    }
  });

  it('with a map of its face, the Sun\'s active regions are the map\'s, and go round with it', () => {
    // (latitude, longitude east, radius: degrees, as pipeline/build_sun_map.py lists them)
    const regions: [number, number, number][] = [[-18.5, -95.4, 4.6], [26.2, 166.8, 4.6], [17.4, 123.2, 2.8]];
    const sun = starLook('sun', 5772, 1, 4.83, regions);
    const deg = Math.PI / 180;
    expect(sun.spots.length).toBe(2 * regions.length);
    regions.forEach(([lat, lon, radius], i) => {
      // a leader and a follower, east and west of the region's middle and well inside it
      const [a, b] = [sun.spots[2 * i], sun.spots[2 * i + 1]];
      expect(a.lat).toBeCloseTo(lat * deg, 12);
      expect(b.lat).toBeCloseTo(lat * deg, 12);
      expect((a.lon + b.lon) / 2).toBeCloseTo(lon * deg, 12);
      expect(a.lon).toBeGreaterThan(b.lon);
      expect((a.lon - b.lon) * Math.cos(a.lat)).toBeLessThan(2 * radius * deg);
      expect(a.size).toBeLessThan(radius * deg);
      // and a loop stands on them
      expect(sun.proms.some((p) => !p.curtain && p.a.lon === a.lon && p.b.lon === b.lon)).toBe(true);
    });
    // a map is one picture: every latitude goes round at the same rate, the pattern with them
    expect(sun.shear).toBe(0);
    const t = 500;
    for (const s of sun.spots) expect(Math.atan2(spotAt(sun, s, t).y, spotAt(sun, s, t).x)).toBeCloseTo(Math.atan2(Math.sin(s.lon + spinAt(sun, t)), Math.cos(s.lon + spinAt(sun, t))), 9);
    // no more of them than the shader's list holds, however many the map has
    const many = Array.from({ length: 20 }, (_, i): [number, number, number] => [10, i * 18 - 180, 3]);
    expect(starLook('sun', 5772, 1, 4.83, many).spots.length).toBe(SPOT_SLOTS);
    // otherwise it is the Sun it was
    const plain = starLook('sun', 5772, 1, 4.83, true);
    expect(sun.face).toEqual(plain.face);
    expect(sun.texFreq).toBe(plain.texFreq);
    expect(sun.rotRate).toBe(plain.rotRate);
  });

  it('a spot goes round at the rate of its latitude, slower towards the poles; the surface with them', () => {
    const look = starLook('sun', 5772, 1, 4.83, true);
    const t = 40;
    const lonAt = (lat: number) => {
      const p = spotAt(look, { lat, lon: 0 }, t);
      expect(p.length()).toBeCloseTo(1, 12);
      expect(p.z).toBeCloseTo(Math.sin(lat), 12);
      return Math.atan2(p.y, p.x);
    };
    expect(lonAt(0)).toBeCloseTo(look.rotRate * t, 9);
    expect(lonAt(1)).toBeLessThan(lonAt(0.3));
    expect(lonAt(0.3)).toBeLessThan(lonAt(0));
    expect(lonAt(Math.PI / 2 - 1e-9) / lonAt(0)).toBeCloseTo(1 - look.shear, 6);
    // the surface pattern turns at the rate of the spots' own latitudes: between the slowest and the fastest of them
    const rates = look.spots.map((s) => look.rotRate * (1 - look.shear * Math.sin(s.lat) ** 2));
    expect(spinAt(look, t) / t).toBeGreaterThanOrEqual(Math.min(...rates) - 1e-12);
    expect(spinAt(look, t) / t).toBeLessThanOrEqual(Math.max(...rates) + 1e-12);
    // and the angles handed to the shader stay within a turn however long the app has run
    expect(Math.abs(spinAt(look, 1e7))).toBeLessThan(2 * Math.PI);
    const far = spotAt(look, look.spots[0], 1e7);
    expect(far.length()).toBeCloseTo(1, 9);
  });

  it('from close by the turning is slowed: the surface under the eye passes at a few pixels a second', () => {
    const look = starLook('sun', 5772, 1, 4.83, true);
    const R = 6.957e8, pixel = 0.00124;            // a phone held upright: 60 degrees over 844 px
    // from where the whole disk is in view: all of it (the active regions cross in minutes)
    expect(turnShare(look, R, 8 * R, pixel)).toBe(1);
    expect(turnShare(look, R, 4 * R, pixel)).toBe(1);
    // nearer, less and less; the surface below passes at the same few pixels a second throughout
    const speed = (d: number) => (look.rotRate * turnShare(look, R, d, pixel) * R) / ((d - R) * pixel);
    expect(turnShare(look, R, 1.2 * R, pixel)).toBeLessThan(0.3);
    expect(turnShare(look, R, 1.02 * R, pixel)).toBeLessThan(turnShare(look, R, 1.2 * R, pixel) / 5);
    for (const d of [1.5, 1.2, 1.05, 1.02, 1.005]) expect(speed(d * R)).toBeCloseTo(6, 6);
    expect(speed(4 * R)).toBeLessThan(6);
    // (and at the surface itself it does not divide by nothing)
    expect(turnShare(look, R, R, pixel)).toBeGreaterThan(0);
    // the rotation clock is the time unless told otherwise
    const a = starLookUniforms(look), b = starLookUniforms(look);
    applyStarLook(a, look, 50);
    applyStarLook(b, look, 50, 50);
    expect(a.uSpin.value).toBe(b.uSpin.value);
    applyStarLook(b, look, 50, 10);
    expect(b.uSpin.value).not.toBe(a.uSpin.value);
    expect((b.uBoil.value as Vector2).equals(a.uBoil.value as Vector2)).toBe(true);
  });

  it('the uniforms carry the spots where they are now, and no more of them than the shader has room for', () => {
    const look = starLook('sun', 5772, 1, 4.83, true);
    const u = starLookUniforms(look);
    const list = u.uSpotList.value as Vector4[];
    expect(list.length).toBe(SPOT_SLOTS);
    expect(u.uSpotCount.value).toBe(look.spots.length);
    applyStarLook(u, look, 25);
    const p = spotAt(look, look.spots[3], 25);
    expect(list[3].x).toBeCloseTo(p.x, 12);
    expect(list[3].y).toBeCloseTo(p.y, 12);
    expect(list[3].z).toBeCloseTo(p.z, 12);
    expect(list[3].w).toBe(look.spots[3].size);
    const boil = (u.uBoil.value as Vector2).clone();
    for (const b of [boil.x, boil.y]) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(1);
    }
    // (the two cycles are never in step again: after a whole number of the first, the second is elsewhere)
    applyStarLook(u, look, 25 + 3 / look.boilRate);
    expect((u.uBoil.value as Vector2).x).toBeCloseTo(boil.x, 6);
    expect(Math.abs((u.uBoil.value as Vector2).y - boil.y)).toBeGreaterThan(0.05);
    applyStarLook(u, look, 25);
    // a quiet star's material, reused: the spots of the star before it are gone, its colours its own
    const vega = starLook('vega', 9600, 2.4, 0.58);
    applyStarLook(u, vega, 25);
    expect(u.uSpotCount.value).toBe(0);
    expect(u.uTexAmp.value).toBe(vega.texAmp);
    expect((u.uFaceK.value as Vector3).toArray()).toEqual(faceResponse(vega.face).k);
  });

  it('a red dwarf is a red dwarf, however small its estimated radius comes out', () => {
    // Proxima Centauri as the catalogue has it: 3383 K, and 0.022 solar radii by the estimate
    // without a bolometric correction (it is 0.15): not a white dwarf's smooth, quiet face
    const proxima = starLook('proxima', 3383, 0.022, 15.5);
    expect(proxima.texAmp).toBeGreaterThan(0.6);
    expect(proxima.corona).toBeGreaterThan(0.4);
    expect(proxima.face[1] / proxima.face[0]).toBeLessThan(0.08);
    // its active regions are few, and larger than the Sun's
    expect(proxima.spots.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...proxima.spots.map((s) => s.size))).toBeGreaterThan(0.03);
    // and a white dwarf is one: hot, small, smooth
    const sirusB = starLook('sirius b', 25000, 0.0084, 11.2);
    expect(sirusB.texAmp).toBeLessThan(0.1);
    expect(sirusB.mottle).toBeLessThan(0.05);
    expect(sirusB.spots.length).toBe(0);
    expect(sirusB.face[2]).toBeGreaterThan(sirusB.face[0]);
  });

  it('a star is drawn flattened only as it has been measured to be: any other is round', () => {
    // (how fast a star spins is in no catalogue the app has: Sirius, a slow rotator, is not to come out an egg)
    for (let i = 0; i < 200; i++) {
      expect(starLook(`hot star ${i}`, 9000 + 60 * i, 2, 1).flattening).toBe(0);
      expect(starLook(`hot star ${i}`, 9000 + 60 * i, 2, 1).gravDark).toBe(0);
    }
    // Altair as the interferometers found it: a fifth shorter from pole to pole, darker round its equator
    const axis = new Vector3(0.3, -0.5, 0.81).normalize();
    const altair = starLook('altair', 8004, 2.03, 2.21, false, { flattening: 0.195, axis });
    expect(altair.flattening).toBe(0.195);
    expect(altair.gravDark).toBeGreaterThan(0.2);
    expect(altair.axis.angleTo(axis)).toBeLessThan(1e-12);
    // and it is otherwise the star it would have been
    const round = starLook('altair', 8004, 2.03, 2.21);
    expect(round.flattening).toBe(0);
    expect(altair.texFreq).toBe(round.texFreq);
    expect(altair.face).toEqual(round.face);
    expect(altair.rotRate).toBe(round.rotRate);
  });

  it('hot stars are nearly smooth; a supergiant seethes in a few giant cells', () => {
    const sun = starLook('sun', 5772, 1, 4.83, true);
    const vega = starLook('vega', 9600, 2.4, 0.58);
    // (a faint texture, a few times weaker than the Sun's: not a plate, not a boiling surface)
    expect(vega.texAmp).toBeLessThan(sun.texAmp / 2.5);
    expect(vega.texAmp).toBeGreaterThan(0.1);
    expect(vega.spots.length).toBe(0);
    // what is seen of it is its photosphere: darker towards the limb; no glowing skin, no streamers to speak of
    expect(vega.limb).toBeLessThan(-0.2);
    expect(vega.chromosphere).toBe(0);
    expect(vega.rays).toBeLessThan(0.5);
    expect(starLook('rigel', 12100, 78.9, -7.84).chromosphere).toBe(0);
    const betelgeuse = starLook('betelgeuse', 3600, 760, -5.8);
    expect(betelgeuse.chromosphere).toBeGreaterThan(0);
    // a handful of cells across its disk, where the Sun's mottling is dozens to a radius
    expect(betelgeuse.texFreq).toBeLessThan(7);
    expect(betelgeuse.texAmp).toBeGreaterThan(sun.texAmp);
    expect(betelgeuse.spots.length).toBe(0);
    // a giant's are between the two
    const arcturus = starLook('arcturus', 4290, 25.4, -0.3);
    expect(arcturus.texFreq).toBeGreaterThan(betelgeuse.texFreq);
    expect(arcturus.texFreq).toBeLessThan(sun.texFreq);
  });

  it('a star looks the same every time, and no two alike', () => {
    expect(starLook('tau ceti', 5340, 0.79, 5.7)).toEqual(starLook('tau ceti', 5340, 0.79, 5.7));
    // stars whose names differ in the last letter alone are as different as any two
    const a = starLook('HIP 1001', 5340, 0.79, 5.7), b = starLook('HIP 1002', 5340, 0.79, 5.7);
    expect(Math.abs(a.seed - b.seed)).toBeGreaterThan(1);
    expect(a.axis.angleTo(b.axis)).toBeGreaterThan(0.05);
    // and the numbers a look is drawn from are not one number four times: over many stars the
    // spin axes point all ways
    let sx = 0, sy = 0, sz = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const ax = starLook(`star ${i}`, 5000, 1, 5).axis;
      sx += ax.x; sy += ax.y; sz += ax.z;
    }
    expect(Math.hypot(sx, sy, sz) / n).toBeLessThan(0.15);
  });
});

/**
 * The arithmetic of the star points (render/shaders/psf.ts), tried here in the same form: a
 * star's light is summed over each pixel's area with an approximate error function. Whatever
 * the approximation's error, a star must keep all of its light wherever it sits on the pixels.
 */
describe("a star's light on the pixels", () => {
  const erf = (x: number) => {
    const x2 = x * x;
    return Math.sign(x) * Math.sqrt(1 - Math.exp((-x2 * (1.2732395 + 0.147 * x2)) / (1 + 0.147 * x2)));
  };
  const onPixel = (x: number, s: number) => 0.5 * (erf(((x + 0.5) * 0.70710678) / s) - erf(((x - 0.5) * 0.70710678) / s));
  const total = (cx: number, cy: number, s: number) => {
    let sum = 0;
    for (let j = -8; j <= 8; j++) for (let i = -8; i <= 8; i++) sum += onPixel(i - cx, s) * onPixel(j - cy, s);
    return sum;
  };

  it('is all there, wherever the star sits between the pixels', () => {
    for (const s of [0.5, 0.7, 1, 1.6]) {
      for (const [cx, cy] of [[0, 0], [0.5, 0], [0.5, 0.5], [0.13, 0.37], [0.25, 0.75]]) {
        expect(total(cx, cy, s)).toBeCloseTo(1, 5);
      }
    }
  });

  it('a star half a pixel wide in the middle of a pixel is mostly that pixel; on a corner, four alike', () => {
    expect(onPixel(0, 0.5) ** 2).toBeGreaterThan(0.45);
    const corner = onPixel(-0.5, 0.5) * onPixel(-0.5, 0.5);
    expect(corner).toBeCloseTo(0.25 * (erf(1.41421356) ** 2), 6);
    expect(corner).toBeGreaterThan(0.22);
  });

  it('wide, it is the plain bell curve', () => {
    const s = 1.6;
    for (const x of [0, 1, 2.5, 4]) expect(onPixel(x, s)).toBeCloseTo(Math.exp((-x * x) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI)), 2);
  });
});
