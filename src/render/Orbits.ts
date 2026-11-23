import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, Line, Matrix3, ShaderMaterial, Vector3 } from 'three';
import { isOpen, openPath, perifocalMatrix, solveKeplerElliptic, stateToElements, type OrbitalElements } from '../astro/kepler';
import { OBLIQUITY_J2000 } from '../core/frames';
import { AU } from '../core/units';
import type { UPos } from '../core/upos';
import type { Body } from '../universe/Body';
import type { SolarSystem } from '../universe/SolarSystem';
import { FIX_LOGDEPTH, GLOBALS, OUTPUT_FRAGMENT, PROJECT_PARS } from './shaders/xr';

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PROJECT_PARS}
void main() {
  gl_Position = projectView(modelViewMatrix * vec4(position, 1.0));
  #include <logdepthbuf_vertex>
${FIX_LOGDEPTH}
}`;
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  gl_FragColor = vec4(uColor, uAlpha);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;

const BASE_SAMPLES = 192;
const REFINE = 14; // geometric refinement steps on each side of the body
const MAX_VERTS = BASE_SAMPLES + 2 * REFINE + 2;
/** an open path is drawn from the body on until it is this many times as far out as it is now (or as its nearest point) */
const OPEN_REACH = 4;

export const COLORS: Record<string, [number, number, number]> = {
  star: [1.0, 0.72, 0.5],
  planet: [0.35, 0.55, 1.0],
  dwarf: [1.0, 0.65, 0.3],
  moon: [0.45, 0.85, 0.6],
  asteroid: [0.75, 0.6, 0.45],
  tno: [0.7, 0.5, 0.9],
  selected: [1.0, 0.9, 0.35],
};

const ECL_TO_EQU = new Matrix3().set(
  1, 0, 0,
  0, Math.cos(OBLIQUITY_J2000), -Math.sin(OBLIQUITY_J2000),
  0, Math.sin(OBLIQUITY_J2000), Math.cos(OBLIQUITY_J2000),
);

interface OrbitObj { line: Line; positions: Float32Array; mat: ShaderMaterial }

export class OrbitsLayer {
  readonly group = new Group();
  enabled = true;
  showMinor = false;
  selected: Body | null = null;
  /** body the camera is currently co-moving with */
  focus: Body | null = null;
  /**
   * Live physics: the bodies whose motion is the simulation's. Their line is the orbit each is on
   * now, from where it is and how it moves about what it goes round now; the catalogue's orbit
   * is no longer theirs. Null: every line is the catalogue's.
   */
  simulated: ((b: Body) => boolean) | null = null;
  private objs = new Map<Body, OrbitObj>();
  private angles = new Float64Array(MAX_VERTS);
  private flat = new Float64Array(2 * MAX_VERTS);
  private tmpR = new Vector3();
  private tmpV = new Vector3();
  private m3 = new Matrix3();

  constructor(private system: SolarSystem) {
    this.group.name = 'orbits';
  }

  /** A body has left the system (src/app/WhatIf.ts): its orbit line goes with it. */
  forget(b: Body): void {
    const o = this.objs.get(b);
    if (!o) return;
    this.group.remove(o.line);
    o.line.geometry.dispose();
    o.mat.dispose();
    this.objs.delete(b);
    if (this.selected === b) this.selected = null;
    if (this.focus === b) this.focus = null;
  }

  private obj(b: Body): OrbitObj {
    let o = this.objs.get(b);
    if (o) return o;
    const positions = new Float32Array(MAX_VERTS * 3);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
    const mat = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uColor: { value: new Vector3(...(COLORS[b.kind] ?? COLORS.asteroid)) }, uAlpha: { value: 0.5 }, uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK },
      transparent: true, depthWrite: false, depthTest: true,
    });
    const line = new Line(geo, mat);
    line.frustumCulled = false;
    line.matrixAutoUpdate = false;
    line.renderOrder = 5;
    this.group.add(line);
    o = { line, positions, mat };
    this.objs.set(b, o);
    return o;
  }

  /**
   * Orbit elements of `b` about its primary, plus the frame matrix to ICRF, and whether the orbit is
   * open: a body of the simulation is on an open path when the orbit its card tells of is
   * (src/app/Powers.ts: orbitOf, from the two masses alone), which a thrown body at exactly the speed
   * of escape is.
   */
  private elements(b: Body, p: Body, jd: number): { el: OrbitalElements; frame: Matrix3; open: boolean } | null {
    const kind = this.simulated?.(b) ? 'simulated' : this.system.ephemerisKind(b);
    if (kind === 'satellite' && b.id !== 301) {
      const res = this.system.satelliteElements(b, jd);
      return res && { ...res, open: res.el.e >= 1 };
    }
    if (kind === 'kepler') {
      const el = this.system.heliocentricElements(b);
      return el ? { el, frame: ECL_TO_EQU, open: el.e >= 1 } : null;
    }
    // Osculating elements from the body's state (planets and the Moon from the ephemeris; any simulated body)
    const r = this.tmpR.copy(b.pos).sub(p.pos);
    const v = this.tmpV.copy(b.vel).sub(p.vel);
    const mu = (p.kind === 'star' ? p.gm : p.gm) + (b.systemGm || b.gm);
    const el = stateToElements(r, v, mu, jd);
    const d = r.length(), two = p.gm + b.gm;
    return { el, frame: this.m3.identity(), open: kind === 'simulated' ? isOpen(v.lengthSq() / 2 - two / d, two, d) : el.e >= 1 };
  }

  /**
   * A body of the simulation that goes round nothing (it is bound to nothing: src/app/LivePhysics.ts)
   * is on an open path past the Sun, which it is leaving: its line is that path. Null for any other.
   */
  private leaving(b: Body): Body | null {
    const sun = this.system.sun;
    if (!this.simulated?.(b) || b === sun || !sun.valid) return null;
    const r = this.tmpR.copy(b.pos).sub(sun.pos), v = this.tmpV.copy(b.vel).sub(sun.vel), d = r.length(), mu = sun.gm + b.gm;
    return isOpen(v.lengthSq() / 2 - mu / d, mu, d) ? sun : null;
  }

  update(cam: UPos, pixelAngle: number, jd: number): void {
    for (const o of this.objs.values()) o.line.visible = false;
    if (!this.enabled) return;
    const sun = this.system.sun;
    const camToSun = sun.upos.sub(cam, new Vector3()).length();
    for (const b of this.system.bodies) {
      const p = b.valid ? b.parent ?? this.leaving(b) : null;
      if (!p) continue;
      const isSel = b === this.selected;
      if (!isSel && (b.kind === 'asteroid' || b.kind === 'tno') && !this.showMinor) continue;
      // Small irregular moons (no measured size) only on request
      if (!isSel && b.kind === 'moon' && b.radiusEstimated && !this.showMinor) continue;
      // Screen size of the orbit: semi-major axis seen from the camera at the primary's distance
      const pr = p.upos.sub(cam, this.tmpR);
      const dPrimary = Math.max(pr.length(), 1);
      const orbitR = b.pos.distanceTo(p.pos);
      const px = orbitR / dPrimary / pixelAngle;
      if (!isSel && (px < 12 || (b.kind === 'moon' && px < 25))) continue;
      if (!isSel && p === sun && camToSun > 2e4 * AU) continue;
      const res = this.elements(b, p, jd);
      if (!res) continue;
      const o = this.obj(b);
      const n = res.open ? this.fillOpen(o, res.el, res.frame, this.tmpR.copy(b.pos).sub(p.pos)) : this.fill(o, res.el, res.frame, jd);
      if (n < 2) continue;
      const rel = b.upos.sub(cam, this.tmpV);
      o.line.matrix.makeTranslation(rel.x, rel.y, rel.z);
      o.line.matrixWorldNeedsUpdate = true;
      o.line.geometry.setDrawRange(0, n);
      (o.line.geometry.attributes.position as BufferAttribute).needsUpdate = true;
      const col = isSel ? COLORS.selected : COLORS[b.kind] ?? COLORS.asteroid;
      o.mat.uniforms.uColor.value.set(col[0], col[1], col[2]);
      // Near a planet or moon, de-emphasise orbits that belong to other systems
      const f = this.focus;
      const local = !f || f.kind === 'star' || b === f || p === f || f.parent === b
        || (f.kind === 'moon' && p === f.parent);
      const base = Math.min(0.45, 0.12 + px / 600) * (b.kind === 'planet' || b.kind === 'moon' ? 1 : 0.6);
      o.mat.uniforms.uAlpha.value = isSel ? 0.85 : local ? base : base * 0.25;
      o.line.visible = true;
    }
  }

  /**
   * Sample the ellipse in eccentric anomaly with extra samples converging on the
   * body's current anomaly; positions are written relative to the body.
   */
  private fill(o: OrbitObj, el: OrbitalElements, frame: Matrix3, jd: number): number {
    const a = el.q / (1 - el.e);
    const e = el.e;
    const b = a * Math.sqrt(1 - e * e);
    const n = Math.sqrt(el.mu / (a * a * a));
    const Eb = solveKeplerElliptic(n * (jd - el.tp) * 86400, e);
    let k = 0;
    const ang = this.angles;
    // body first and last so the loop closes exactly at the body
    ang[k++] = Eb;
    const step = (2 * Math.PI) / BASE_SAMPLES;
    for (let r = REFINE; r >= 1; r--) ang[k++] = Eb + step * Math.pow(0.5, r);
    for (let i = 1; i < BASE_SAMPLES; i++) ang[k++] = Eb + i * step;
    for (let r = 1; r <= REFINE; r++) ang[k++] = Eb + 2 * Math.PI - step * Math.pow(0.5, r);
    ang[k++] = Eb + 2 * Math.PI;
    const R = perifocalMatrix(el.i, el.node, el.peri).premultiply(frame).elements; // column-major
    const xb = a * (Math.cos(Eb) - e), yb = b * Math.sin(Eb);
    const pos = o.positions;
    for (let i = 0; i < k; i++) {
      const E = ang[i];
      // difference in the perifocal plane computed directly (exact near the body)
      const dx = a * (Math.cos(E) - e) - xb;
      const dy = b * Math.sin(E) - yb;
      pos[i * 3] = R[0] * dx + R[3] * dy;
      pos[i * 3 + 1] = R[1] * dx + R[4] * dy;
      pos[i * 3 + 2] = R[2] * dx + R[5] * dy;
    }
    return k;
  }

  /**
   * An open path (a parabola at exactly the speed of escape, a hyperbola beyond): from the body on
   * outwards, to OPEN_REACH times as far out as it is (where it went before it was thrown is no
   * path of its own); `rel`, where it is from what it goes round (ICRF), places it on the path.
   * Positions are written relative to the body.
   */
  private fillOpen(o: OrbitObj, el: OrbitalElements, frame: Matrix3, rel: Vector3): number {
    const e = Math.max(1, el.e);
    const R = perifocalMatrix(el.i, el.node, el.peri).premultiply(frame).elements; // column-major
    // (its true anomaly: where it is, against the line to the nearest point, in the plane of the path)
    const nu0 = Math.atan2(rel.x * R[3] + rel.y * R[4] + rel.z * R[5], rel.x * R[0] + rel.y * R[1] + rel.z * R[2]);
    const flat = this.flat;
    const k = openPath(el.q, e, nu0, OPEN_REACH * Math.max(rel.length(), el.q), BASE_SAMPLES, REFINE, flat);
    const pos = o.positions;
    for (let i = 0; i < k; i++) {
      const dx = flat[2 * i], dy = flat[2 * i + 1];
      pos[i * 3] = R[0] * dx + R[3] * dy;
      pos[i * 3 + 1] = R[1] * dx + R[4] * dy;
      pos[i * 3 + 2] = R[2] * dx + R[5] * dy;
    }
    return k;
  }
}
