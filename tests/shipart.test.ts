import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MeshBuilder, PATTERN, roundedPolygon, smoothPath } from '../src/game/shipGeometry';
import { canopyFrame } from '../src/game/cockpitDesign';
import { buildShip } from '../src/game/shipDesign';
import { ViewMask } from '../src/render/ViewMask';
import { starStrength, worldShine } from '../src/game/ShipLight';
import { ShipModel } from '../src/game/ShipModel';
import { layoutLabels, type LabelCandidate } from '../src/render/Labels';

/** Share of triangles whose winding turns them the way their vertices' normals point (degenerate ones left out). */
function agreement(b: MeshBuilder): { agree: number; total: number; nan: number } {
  let agree = 0, total = 0, nan = 0;
  const p = (i: number) => new Vector3(b.pos[i * 3], b.pos[i * 3 + 1], b.pos[i * 3 + 2]);
  const n = (i: number) => new Vector3(b.nrm[i * 3], b.nrm[i * 3 + 1], b.nrm[i * 3 + 2]);
  for (const v of b.pos) if (!Number.isFinite(v)) nan++;
  for (const v of b.nrm) if (!Number.isFinite(v)) nan++;
  for (let t = 0; t < b.idx.length; t += 3) {
    const [i, j, k] = [b.idx[t], b.idx[t + 1], b.idx[t + 2]];
    const face = new Vector3().subVectors(p(j), p(i)).cross(new Vector3().subVectors(p(k), p(i)));
    if (face.lengthSq() < 1e-14) continue;
    total++;
    if (face.dot(n(i).add(n(j)).add(n(k))) > 0) agree++;
  }
  return { agree, total, nan };
}

describe('ship geometry', () => {
  it('primitives wind their faces the way their normals point, outwards', () => {
    const f = { color: [1, 1, 1] as [number, number, number], rough: 0.5, metal: 0, pattern: PATTERN.paint };
    const cases: [string, (b: MeshBuilder) => void][] = [
      ['box', (b) => b.box(0, 0, 0, 1, 2, 3, f)],
      ['bevelled box', (b) => b.box(0, 0, 0, 1, 2, 3, f, 0.2)],
      ['lathe', (b) => b.lathe([[0.5, 0], [1, 1], [0.8, 2]], 16, f)],
      ['torus', (b) => b.torus(2, 0.3, 24, 8, f)],
      ['sweep', (b) => b.sweep([new Vector3(0, 0, 0), new Vector3(1, 1, 0), new Vector3(2, 1, 1)], roundedPolygon([[0.1, -0.1], [0.1, 0.1], [-0.1, 0.1], [-0.1, -0.1]], 0.03, 2), f)],
      ['loft', (b) => b.loft([{ z: 0, outline: roundedPolygon([[1, -1], [1, 1], [-1, 1], [-1, -1]], 0.3, 2) }, { z: 2, outline: roundedPolygon([[1, -1], [1, 1], [-1, 1], [-1, -1]], 0.3, 2), sx: 0.5 }], f, true)],
    ];
    for (const [name, make] of cases) {
      const b = new MeshBuilder();
      make(b);
      const a = agreement(b);
      expect(a.nan, name).toBe(0);
      expect(a.agree / a.total, name).toBeGreaterThan(0.99);
      // outwards: the normals point away from the part's middle (all these are convex or nearly;
      // a torus's from the circle through its tube)
      const c = b.bounds().centre;
      let out = 0;
      for (let v = 0; v < b.vertexCount; v++) {
        const p = new Vector3(b.pos[v * 3], b.pos[v * 3 + 1], b.pos[v * 3 + 2]);
        const mid = name === 'torus' ? new Vector3(p.x, p.y, 0).setLength(2) : c;
        if (p.sub(mid).dot(new Vector3(b.nrm[v * 3], b.nrm[v * 3 + 1], b.nrm[v * 3 + 2])) > 0) out++;
      }
      if (name !== 'sweep') expect(out / b.vertexCount, name).toBeGreaterThan(0.9);
    }
  });

  it('the ship is modest in triangles, sound, and turns its faces outwards', () => {
    const d = buildShip();
    const a = agreement(d.hull);
    expect(a.nan).toBe(0);
    expect(a.agree / a.total).toBeGreaterThan(0.995);
    expect(d.hull.triangleCount).toBeLessThan(30000);
    expect(d.hull.vertexCount).toBeLessThan(40000);
    const bb = d.hull.bounds();
    // about 18 m long, 16 m across the radiators, nose towards -z
    expect(bb.max.z - bb.min.z).toBeGreaterThan(16);
    expect(bb.max.z - bb.min.z).toBeLessThan(21);
    expect(bb.max.x - bb.min.x).toBeGreaterThan(13);
    expect(bb.min.z).toBeLessThan(-8);
    // left and right alike: the port lamp red, the starboard green
    expect(d.lamps[0].x).toBeLessThan(0);
    expect(d.lamps[1].x).toBeGreaterThan(0);
    expect(Math.abs(d.lamps[0].x + d.lamps[1].x)).toBeLessThan(1e-6);
  });
});

describe('the names mask', () => {
  it('a point under a member or inside the dashboard is covered; a name across a member overlaps it', () => {
    const m = new ViewMask();
    expect(m.empty).toBe(true);
    m.capsules.push({ ax: 100, ay: 0, bx: 100, by: 400, r: 5 });
    m.polys.push({ pts: [0, 700, 390, 700, 390, 900, 0, 900] });
    expect(m.covers(103, 200)).toBe(true);
    expect(m.covers(107, 200)).toBe(false);
    expect(m.covers(200, 750)).toBe(true);
    expect(m.covers(200, 650)).toBe(false);
    // a label's box: across the member, beside it, overlapping the dashboard
    expect(m.overlapsRect(80, 190, 40, 14)).toBe(true);
    expect(m.overlapsRect(110, 190, 40, 14)).toBe(false);
    expect(m.overlapsRect(200, 690, 40, 14)).toBe(true);
    // a member crossing a box with no corner of either inside the other
    const k = new ViewMask();
    k.capsules.push({ ax: 0, ay: 0, bx: 400, by: 400, r: 0.5 });
    expect(k.overlapsRect(150, 190, 100, 14)).toBe(true);
  });
});

describe('the cockpit\'s frame', () => {
  /** The frame's members on a screen (CSS px): what share they cover, and where. */
  const onScreen = (w: number, h: number, fovY: number) => {
    const t = Math.tan((fovY * Math.PI) / 360), aspect = w / h, px = (2 * t) / h;
    const mask = new ViewMask(), sill = new ViewMask();
    for (const m of canopyFrame()) {
      const path = smoothPath(m.pts, m.per ?? 6);
      for (let i = 0; i + 1 < path.length; i++) {
        const [a, b] = [path[i], path[i + 1]];
        if (a.z >= -0.01 || b.z >= -0.01) continue;
        const s = (p: Vector3) => [(p.x / -p.z / (t * aspect)) * 0.5 * w + w / 2, h / 2 - (p.y / -p.z / t) * 0.5 * h];
        const [ax, ay] = s(a), [bx, by] = s(b);
        (m.sill ? sill : mask).capsules.push({ ax, ay, bx, by, r: m.half / Math.min(a.length(), b.length()) / px });
      }
    }
    let n = 0, hit = 0, sillTop = Infinity;
    for (let y = 1; y < h; y += 3) {
      for (let x = 1; x < w; x += 3) {
        n++;
        if (mask.covers(x, y)) hit++;
        if (sill.covers(x, y) && x > w * 0.2 && x < w * 0.8) sillTop = Math.min(sillTop, y);
      }
    }
    return { share: hit / n, mask, sillTop };
  };

  it('takes little of a phone\'s view: a line under an upright phone\'s instruments, pillars near a sideways one\'s edges', () => {
    // the cockpit's field (72 degrees wide, opened up to 95 upright, as CameraRig.verticalFov does)
    const up = onScreen(390, 844, 95.1), side = onScreen(844, 390, 72);
    // the members above the sill
    expect(up.share).toBeGreaterThan(0.002);
    expect(up.share).toBeLessThan(0.015);
    expect(side.share).toBeLessThan(0.04);
    // the sill (the dashboard's edge) low: in the bottom fifth upright (under the card and the tabs),
    // the bottom tenth sideways
    expect(up.sillTop).toBeGreaterThan(844 * 0.8);
    expect(side.sillTop).toBeGreaterThan(390 * 0.9);
    // upright: the middle of the view is clear from just under the instruments (200 px) down
    for (let y = 215; y < 600; y += 5) for (let x = 20; x < 370; x += 10) expect(up.mask.covers(x, y), `${x},${y}`).toBe(false);
    // sideways: the middle half of the view is clear from top to bottom but the bow's line
    for (let y = 60; y < 360; y += 5) for (let x = 211; x < 633; x += 10) expect(side.mask.covers(x, y), `${x},${y}`).toBe(false);
  });
});

describe('names in the ship', () => {
  it('a name whose object is behind the frame goes; one across a member moves to the other side, or goes', () => {
    const cand = (key: string, x: number, y: number): LabelCandidate => ({ key, text: key, x, y, radius: 0, priority: 1, cls: 'star' });
    const m = new ViewMask();
    // a pillar down the screen at x = 300, 8 px wide
    m.capsules.push({ ax: 300, ay: 0, bx: 300, by: 844, r: 4 });
    const shown = layoutLabels([cand('behind', 300, 200), cand('across', 280, 400), cand('clear', 100, 600)], 390, 844, m);
    const by = new Map(shown.map((s) => [s.c.key, s]));
    expect(by.has('behind')).toBe(false);
    expect(by.has('clear')).toBe(true);
    // 'across' would have run over the pillar to its right: it stands left of its point instead
    const across = by.get('across')!;
    expect(across.x + across.w).toBeLessThanOrEqual(280);
    for (const s of shown) expect(m.overlapsRect(s.x, s.y, s.w, s.h)).toBe(false);
    // with no mask (outside the ship) every one is named where it always was
    expect(layoutLabels([cand('behind', 300, 200)], 390, 844, new ViewMask()).length).toBe(1);
  });
});

describe('the ship\'s light', () => {
  it('the star\'s strength: 1 at the Earth\'s distance from the Sun, half by Saturn\'s, none in the dark', () => {
    expect(starStrength(Math.PI)).toBeCloseTo(1, 6);
    expect(starStrength(Math.PI / 9.5 ** 2)).toBeCloseTo(0.511, 2);
    expect(starStrength(1e-12)).toBe(0);
  });

  it('a world lights the side turned to it by its albedo and phase, and hides the star in its shadow', () => {
    const AU = 1.496e11, R = 6.371e6;
    const toSun = new Vector3(AU, 0, 0);
    const lum = (v: Vector3) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
    // day side, 4 radii out, the world straight below the Sun-ward ship: full phase
    const day = worldShine(new Vector3(-4 * R, 0, 0), R, toSun, 6.96e8, 0.367, [0.68, 0.8, 1.15], 1);
    expect(day.sin).toBeCloseTo(0.25, 6);
    expect(day.sunSeen).toBe(1);
    expect(lum(day.radiance)).toBeCloseTo(0.367 * 1.4, 3);
    expect(day.radiance.z).toBeGreaterThan(day.radiance.x);
    // a quarter of the way round: half lit (Lambert's phase at 90 degrees is 1/pi)
    const side = worldShine(new Vector3(0, 4 * R, 0), R, toSun.clone().sub(new Vector3(0, 4 * R, 0)), 6.96e8, 0.367, [1, 1, 1], 1);
    expect(lum(side.radiance)).toBeCloseTo((0.367 * 1.4) / Math.PI, 2);
    expect(side.sunSeen).toBe(1);
    // behind the world, in its shadow: the star hidden, the world's face dark
    const night = worldShine(new Vector3(4 * R, 0, 0), R, toSun, 6.96e8, 0.367, [1, 1, 1], 1);
    expect(night.sunSeen).toBe(0);
    expect(lum(night.radiance)).toBeLessThan(1e-6);
  });
});

describe('the chase view', () => {
  it('frames the ship below the middle, its radiators a set share of the width, upright and sideways', () => {
    const fit = (w: number, h: number, fovY: number) => {
      const s = new ShipModel();
      s.group.position.set(0, -3.4, -22);
      s.frameChase(w / h, fovY);
      s.group.updateMatrixWorld(true);
      const t = Math.tan((fovY * Math.PI) / 360), aspect = w / h;
      const px = (p: Vector3) => ({ x: (p.x / -p.z / (t * aspect)) * 0.5 + 0.5, y: 0.5 - (p.y / -p.z / t) * 0.5 });
      const tips = s.cover.quads.map((q) => px(q[2].clone().applyMatrix4(s.body.matrixWorld)));
      const centre = px(new Vector3().applyMatrix4(s.body.matrixWorld));
      return { span: Math.abs(tips[0].x - tips[1].x), centre };
    };
    // an upright phone (the field opened up to 70 degrees), and the same held sideways (50)
    const up = fit(390, 844, 70), side = fit(844, 390, 50);
    expect(up.span).toBeGreaterThan(0.55);
    expect(up.span).toBeLessThan(0.8);
    expect(up.centre.y).toBeGreaterThan(0.55);
    expect(up.centre.y).toBeLessThan(0.7);
    expect(Math.abs(up.centre.x - 0.5)).toBeLessThan(0.01);
    expect(side.span).toBeGreaterThan(0.2);
    expect(side.span).toBeLessThan(0.4);
    // sideways it stands to the right of the middle, over the shoulder (the middle stays clear)
    expect(side.centre.x).toBeGreaterThan(0.6);
    expect(side.centre.x).toBeLessThan(0.8);
  });
});
