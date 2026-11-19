/**
 * In-world labels and constellation figures.
 *
 * Labels are plain HTML elements positioned over the canvas each frame: the
 * selected object's marker, the bodies of the current system, the brightest
 * named stars, famous galaxies and deep-sky objects. A small greedy layout
 * keeps them from piling on top of each other, most important first.
 */
import * as THREE from 'three';
import { type UPos, uposFromMeters, uposSub } from '../../core/hp';
import { MPC, PC } from '../../core/units';
import type { Catalog } from '../../data/catalog';
import { galaxyPosition, starPosition } from '../../data/decode';
import { dqStarDist } from '../../data/format/schema';
import { lineMaterial } from '../../render/bodyVisuals';
import type { Engine } from '../../render/engine';

interface Candidate {
  text: string;
  pos: UPos;
  /** Absolute magnitude (for apparent-brightness ranking) or null for always-on labels. */
  absMag: number | null;
  /** Metres per "10 pc" unit conversion handled by the caller: distance in metres is used directly. */
  cls: string;
  /** Faintest apparent magnitude at which the label is shown. */
  limit: number;
}

export interface DynamicLabel {
  text: string;
  /** Position relative to the camera (world axes, metres). */
  rel: THREE.Vector3;
  priority: number;
  cls?: string;
}

const MAX_LABELS = 36;
const tmp = { x: 0, y: 0, z: 0 };
const v = new THREE.Vector3();

export class Labels {
  private readonly pool: HTMLElement[] = [];
  private readonly marker: HTMLElement;
  private readonly fixed: Candidate[] = [];
  private constellations: Array<{ name: string; centroid: UPos }> = [];
  private lines: THREE.LineSegments | null = null;
  private built = false;
  private readonly placed: Array<[number, number, number, number]> = [];

  constructor(private readonly root: HTMLElement, private readonly engine: Engine, private readonly catalog: Catalog) {
    this.marker = document.createElement('div');
    this.marker.className = 'sf-marker';
    this.marker.hidden = true;
    root.append(this.marker);
  }

  /** Build the candidate lists once the names chunk and constellation data are in memory. */
  private build(): void {
    const famous = this.catalog.names.famous();
    if (famous.length === 0) return;
    this.built = true;
    for (const r of famous) {
      const name = r.names[0]!;
      if (r.kind === 's') {
        // Stars with a proper name (not a Greek-letter / number designation) and a catalogued V magnitude.
        const vmag = typeof r.extra?.v === 'number' ? r.extra.v : null;
        if (vmag === null || vmag > 3.6 || /^[α-ω\d]|^HIP|^HD/.test(name)) continue;
        const [x, y, z] = starPosition(r.a, r.b, r.c);
        this.fixed.push({ text: name, pos: uposFromMeters(x * PC, y * PC, z * PC), absMag: vmag - 5 * Math.log10(dqStarDist(r.c) / 10), cls: '', limit: 3.2 });
      } else if (r.kind === 'g') {
        if (/^(NGC|IC|UGC|PGC|ESO|MCG|CGCG|2MASX|\d)/.test(name) || !r.extra?.q) continue;
        const [x, y, z] = galaxyPosition(r.a, r.b, r.c);
        this.fixed.push({ text: name, pos: uposFromMeters(x * MPC, y * MPC, z * MPC), absMag: -20.5, cls: '', limit: 11.5 });
      } else if (r.kind === 'd') {
        const d = this.catalog.dso[r.a];
        if (!d || !d.d || /^(NGC|IC|PSR|Theia|UPK|HSC|CWNU|OC |FSR|UBC|\d)/.test(name)) continue;
        if (d.t !== 'bh' && d.t !== 'psr' && d.m === undefined && !/Nebula|Cluster|Pleiades|Hyades/i.test(name)) continue;
        const [ux, uy, uz] = [Math.cos((d.dec * Math.PI) / 180) * Math.cos((d.ra * Math.PI) / 180), Math.cos((d.dec * Math.PI) / 180) * Math.sin((d.ra * Math.PI) / 180), Math.sin((d.dec * Math.PI) / 180)];
        this.fixed.push({ text: name, pos: uposFromMeters(ux * d.d * PC, uy * d.d * PC, uz * d.d * PC), absMag: (d.m ?? 6) - 5 * Math.log10(d.d / 10), cls: '', limit: 6.5 });
      }
    }
    // Constellation figures: line segments between real star positions (parsecs from the Sun).
    const segs: number[] = [];
    for (const con of this.catalog.constellations) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      let n = 0;
      for (const line of con.lines) {
        for (let i = 0; i < line.length; i++) {
          const [x, y, z] = starPosition(line[i]![0]!, line[i]![1]!, line[i]![2]!);
          if (i > 0) {
            const [px, py, pz] = starPosition(line[i - 1]![0]!, line[i - 1]![1]!, line[i - 1]![2]!);
            segs.push(px, py, pz, x, y, z);
          }
          // Centroid of directions (not positions): where the figure sits on the sky.
          const d = Math.hypot(x, y, z) || 1;
          cx += x / d;
          cy += y / d;
          cz += z / d;
          n++;
        }
      }
      if (n > 0) {
        const l = Math.hypot(cx, cy, cz) || 1;
        this.constellations.push({ name: con.name, centroid: uposFromMeters((cx / l) * 300 * PC, (cy / l) * 300 * PC, (cz / l) * 300 * PC) });
      }
    }
    if (segs.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs), 3));
      this.lines = new THREE.LineSegments(geo, lineMaterial([0.3, 0.5, 0.9]));
      this.lines.frustumCulled = false;
      this.lines.renderOrder = 18;
      (this.lines.material as THREE.Material).depthTest = false;
      this.lines.visible = false;
      this.engine.background.add(this.lines);
    }
  }

  private element(i: number): HTMLElement {
    while (this.pool.length <= i) {
      const e = document.createElement('div');
      e.className = 'sf-label';
      e.hidden = true;
      this.root.append(e);
      this.pool.push(e);
    }
    return this.pool[i]!;
  }

  /**
   * Lay out this frame's labels.
   * @param dynamic  labels supplied by the mode (bodies of the current system…)
   * @param selected camera-relative position of the selection marker, or null
   */
  update(camPos: UPos, showNames: boolean, showConstellations: boolean, dynamic: DynamicLabel[], selected: THREE.Vector3 | null, starLimit: number, dim: number): void {
    if (!this.built) this.build();
    const engine = this.engine;
    const cam = engine.camera;
    const w = engine.canvas.clientWidth;
    const h = engine.canvas.clientHeight;
    const tanY = Math.tan(engine.fovY / 2);
    const tanX = tanY * cam.aspect;
    const inv = cam.quaternion.clone().invert();
    const project = (rel: THREE.Vector3): [number, number] | null => {
      v.copy(rel).applyQuaternion(inv);
      if (v.z >= 0) return null;
      const x = (v.x / -v.z / tanX) * 0.5 + 0.5;
      const y = 0.5 - (v.y / -v.z / tanY) * 0.5;
      return x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05 ? null : [x * w, y * h];
    };

    // Selection marker.
    const m = selected ? project(selected) : null;
    this.marker.hidden = !m;
    if (m) this.marker.style.transform = `translate(${m[0].toFixed(1)}px, ${m[1].toFixed(1)}px)`;

    // Constellation lines follow the camera (their vertices are parsecs from the Sun).
    uposSub(uposFromMeters(0, 0, 0), camPos, tmp);
    const sunDist = Math.hypot(tmp.x, tmp.y, tmp.z);
    // The figures only make sense near home: fade them out by ~150 pc from the Sun.
    const conFade = showConstellations ? Math.max(0, 1 - sunDist / (150 * PC)) * (1 - 0.8 * dim) : 0;
    if (this.lines) {
      this.lines.visible = conFade > 0.01;
      this.lines.position.set(tmp.x, tmp.y, tmp.z);
      this.lines.scale.setScalar(PC);
      (this.lines.material as THREE.ShaderMaterial).uniforms.uAlpha!.value = 0.5 * conFade;
    }

    const items: Array<{ text: string; x: number; y: number; priority: number; cls: string }> = [];
    for (const d of dynamic) {
      const p = project(d.rel);
      if (p) items.push({ text: d.text, x: p[0], y: p[1], priority: d.priority, cls: d.cls ?? '' });
    }
    if (showNames && dim < 0.6) {
      for (const c of this.fixed) {
        uposSub(c.pos, camPos, tmp);
        const dist = Math.hypot(tmp.x, tmp.y, tmp.z);
        if (dist < 1e9) continue;
        const mag = c.absMag! + 5 * Math.log10(dist / PC / 10);
        // Named stars are labelled while clearly visible; relax the limit as the sky gets deeper.
        if (mag > c.limit + Math.max(0, starLimit - 7.6)) continue;
        const p = project(v.set(tmp.x, tmp.y, tmp.z).clone());
        if (p) items.push({ text: c.text, x: p[0], y: p[1], priority: 50 + mag, cls: '' });
      }
    }
    if (conFade > 0.3) {
      for (const c of this.constellations) {
        uposSub(c.centroid, camPos, tmp);
        const p = project(v.set(tmp.x, tmp.y, tmp.z).clone());
        if (p) items.push({ text: c.name, x: p[0], y: p[1], priority: 200, cls: 'sf-const' });
      }
    }
    items.sort((a, b) => a.priority - b.priority);

    // Greedy placement: skip a label if it would overlap one already placed.
    this.placed.length = 0;
    let used = 0;
    for (const it of items) {
      if (used >= MAX_LABELS) break;
      const lw = it.text.length * 7 + 14;
      const x0 = it.x + 9;
      const y0 = it.y - 9;
      let clash = false;
      for (const r of this.placed) {
        if (x0 < r[2] && x0 + lw > r[0] && y0 < r[3] && y0 + 18 > r[1]) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      this.placed.push([x0, y0, x0 + lw, y0 + 18]);
      const e = this.element(used++);
      if (e.textContent !== it.text) e.textContent = it.text;
      const cn = `sf-label ${it.cls}`;
      if (e.className !== cn) e.className = cn;
      e.hidden = false;
      e.style.transform = `translate(${x0.toFixed(1)}px, ${y0.toFixed(1)}px)`;
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i]!.hidden = true;
  }

  dispose(): void {
    for (const e of this.pool) e.remove();
    this.marker.remove();
    if (this.lines) {
      this.lines.geometry.dispose();
      (this.lines.material as THREE.Material).dispose();
      this.lines.removeFromParent();
    }
  }
}
