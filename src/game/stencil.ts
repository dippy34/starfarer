import { Vector3, type Matrix4 } from 'three';
import type { Finish, MeshBuilder } from './shipGeometry';

/**
 * A stencil lettering for the ship's markings (made up: a registration and a name, no agency's),
 * drawn as painted strokes lying on a surface. Glyphs on a 4 x 6 grid, as polylines.
 */
const GLYPHS: Record<string, [number, number][][]> = {
  S: [[[4, 6], [0.6, 6], [0, 5.4], [0, 3.6], [0.6, 3], [3.4, 3], [4, 2.4], [4, 0.6], [3.4, 0], [0, 0]]],
  F: [[[0, 0], [0, 6], [4, 6]], [[0, 3.2], [3, 3.2]]],
  T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
  A: [[[0, 0], [0, 4.6], [1.4, 6], [2.6, 6], [4, 4.6], [4, 0]], [[0, 2.8], [4, 2.8]]],
  R: [[[0, 0], [0, 6], [3.4, 6], [4, 5.4], [4, 3.8], [3.4, 3.2], [0, 3.2]], [[2.2, 3.2], [4, 0]]],
  E: [[[4, 0], [0, 0], [0, 6], [4, 6]], [[0, 3.1], [3, 3.1]]],
  V: [[[0, 6], [2, 0], [4, 6]]],
  Y: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]],
  '-': [[[0.6, 3], [3.4, 3]]],
  '0': [[[0.6, 0], [3.4, 0], [4, 0.6], [4, 5.4], [3.4, 6], [0.6, 6], [0, 5.4], [0, 0.6], [0.6, 0]]],
  '1': [[[1, 4.8], [2.4, 6], [2.4, 0]], [[1, 0], [3.6, 0]]],
  '2': [[[0, 5.2], [0.8, 6], [3.2, 6], [4, 5.2], [4, 3.8], [0, 0], [4, 0]]],
  '7': [[[0, 6], [4, 6], [1.4, 0]]],
};

/** How long `text` is painted `height` metres tall (m). */
export function textWidth(text: string, height: number): number {
  const s = height / 6;
  let x = 0, n = 0;
  for (const ch of text) {
    if (ch === ' ') { x += 3 * s; continue; }
    if (!GLYPHS[ch]) continue;
    x += 4 * s + 1.6 * s;
    n++;
  }
  return n ? x - 1.6 * s : x;
}

/**
 * `text` painted at `m` (its local x along the text, y up the letters, z out of the surface),
 * letters `height` metres tall, strokes `weight` of the height wide. Returns the width.
 */
export function paintText(b: MeshBuilder, text: string, height: number, f: Finish, m: Matrix4, weight = 0.13): number {
  const s = height / 6, w = weight * height, gap = 1.6 * s;
  let x = 0;
  b.at(m);
  for (const ch of text) {
    if (ch === ' ') { x += 3 * s; continue; }
    const g = GLYPHS[ch];
    if (!g) continue;
    for (const line of g) {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = new Vector3(x + line[i][0] * s, line[i][1] * s, 0), c = new Vector3(x + line[i + 1][0] * s, line[i + 1][1] * s, 0);
        const d = c.clone().sub(a);
        const len = d.length();
        if (len <= 0) continue;
        d.divideScalar(len);
        const n = new Vector3(-d.y, d.x, 0).multiplyScalar(w / 2);
        // (each stroke runs half a width past its ends, so corners close)
        const a0 = a.clone().addScaledVector(d, -w / 2), c0 = c.clone().addScaledVector(d, w / 2);
        const up = new Vector3(0, 0, 1);
        const i0 = b.vertex(a0.clone().sub(n), up, 0, 0, f), i1 = b.vertex(c0.clone().sub(n), up, len, 0, f);
        const i2 = b.vertex(c0.clone().add(n), up, len, w, f), i3 = b.vertex(a0.clone().add(n), up, 0, w, f);
        b.tri(i0, i1, i2);
        b.tri(i0, i2, i3);
      }
    }
    x += 4 * s + gap;
  }
  b.at();
  return x - gap;
}
