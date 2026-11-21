import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, Line, ShaderMaterial, Vector3 } from 'three';
import type { UPos } from '../core/upos';
import type { Body } from '../universe/Body';
import { COLORS } from './Orbits';
import { FIX_LOGDEPTH, GLOBALS, OUTPUT_FRAGMENT, PROJECT_PARS } from './shaders/xr';

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PROJECT_PARS}
attribute float aFade;
varying float vFade;
void main() {
  vFade = aFade;
  gl_Position = projectView(modelViewMatrix * vec4(position, 1.0));
  #include <logdepthbuf_vertex>
${FIX_LOGDEPTH}
}`;
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uAlpha;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColor, uAlpha * vFade);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;

/** places kept per trail */
const SAMPLES = 256;
/** a place is kept each time the body has turned this far about what it goes round (rad): four turns in all */
const TURN = (2 * Math.PI * 4) / SAMPLES;
/** a body that has turned further than this between two frames is going round too fast for its trail to mean anything */
const TOO_FAST = Math.PI / 4;
/** a body that goes round nothing: a place is kept each time it has gone this share of its distance from where its trail starts */
const STRIDE = 0.02;

interface Trail {
  /** what it went round while these places were kept: they are measured from it (null: from the centre of the system) */
  about: Body | null;
  /** the places (m), oldest to newest from `first`, `count` of them */
  at: Float64Array;
  first: number;
  count: number;
  line: Line | null;
}

/**
 * Where each simulated body has been (live physics): a line that fades behind it, drawn about what
 * it goes round, so a moon's trail is the loops it has made round its planet and not its corkscrew
 * round the Sun; a body that goes round nothing leaves its trail against the stars. Beside the
 * orbit lines, which show where each would go from here if nothing else pulled, the trails show
 * what did happen.
 */
export class TrailsLayer {
  readonly group = new Group();
  enabled = true;
  showMinor = false;
  selected: Body | null = null;
  private trails = new Map<Body, Trail>();
  private rel = new Vector3();
  private last = new Vector3();
  private tmp = new Vector3();

  constructor() {
    this.group.name = 'trails';
  }

  /** A line that draws nothing, for the app to compile the trails' shader with the others (before the first trail is wanted). */
  warmupObject(): Line {
    const line = this.make('none');
    line.geometry.setDrawRange(0, 0);
    return line;
  }

  /** Note where these bodies are now (each frame, once they have been placed). */
  record(bodies: Iterable<Body>): void {
    for (const b of bodies) {
      let t = this.trails.get(b);
      if (!t) {
        t = { about: b.parent, at: new Float64Array(3 * SAMPLES), first: 0, count: 0, line: null };
        this.trails.set(b, t);
      }
      // (it goes round something else now: what was kept is in another frame)
      if (t.about !== b.parent) { t.about = b.parent; t.count = 0; }
      const rel = this.rel.copy(b.pos);
      if (t.about) rel.sub(t.about.pos);
      if (t.count === 0) { this.push(t, rel); continue; }
      const k = 3 * ((t.first + t.count - 1) % SAMPLES);
      const last = this.last.set(t.at[k], t.at[k + 1], t.at[k + 2]);
      if (t.about) {
        const turned = last.angleTo(rel);
        if (turned > TOO_FAST) t.count = 0;
        if (turned > TURN) this.push(t, rel);
      } else {
        const from = 3 * t.first;
        const gone = this.tmp.set(t.at[from], t.at[from + 1], t.at[from + 2]).distanceTo(rel);
        if (last.distanceTo(rel) > Math.max(STRIDE * gone, 1e6)) this.push(t, rel);
      }
    }
  }

  private push(t: Trail, p: Vector3): void {
    if (t.count === SAMPLES) t.first = (t.first + 1) % SAMPLES;
    else t.count++;
    const k = 3 * ((t.first + t.count - 1) % SAMPLES);
    t.at[k] = p.x; t.at[k + 1] = p.y; t.at[k + 2] = p.z;
  }

  /** Draw them for the camera at `cam`. Which bodies get one follows the orbit lines: the larger worlds, and what is selected. */
  update(cam: UPos, pixelAngle: number): void {
    for (const [b, t] of this.trails) {
      if (t.line) t.line.visible = false;
      if (!this.enabled || !b.valid || t.count < 2) continue;
      const isSel = b === this.selected;
      if (!isSel && !this.showMinor && (b.kind === 'asteroid' || b.kind === 'tno' || (b.kind === 'moon' && b.radiusEstimated))) continue;
      // how large on the screen: its distance from what it goes round (or its trail's length), seen from here
      const rel = this.rel.copy(b.pos);
      if (t.about) rel.sub(t.about.pos);
      const first = 3 * t.first;
      const span = t.about ? rel.length() : this.tmp.set(t.at[first], t.at[first + 1], t.at[first + 2]).distanceTo(rel);
      const here = b.upos.sub(cam, this.tmp);
      const px = span / Math.max(here.length(), 1) / pixelAngle;
      if (!isSel && px < (b.kind === 'moon' ? 25 : 12)) continue;
      const line = t.line ??= this.make(b.name);
      const pos = (line.geometry.attributes.position as BufferAttribute).array as Float32Array;
      const fade = (line.geometry.attributes.aFade as BufferAttribute).array as Float32Array;
      // each place from where the body is now, so the line ends exactly on it, whatever the distances
      for (let i = 0; i < t.count; i++) {
        const k = 3 * ((t.first + i) % SAMPLES);
        pos[3 * i] = t.at[k] - rel.x; pos[3 * i + 1] = t.at[k + 1] - rel.y; pos[3 * i + 2] = t.at[k + 2] - rel.z;
        fade[i] = (i + 1) / (t.count + 1);
      }
      pos[3 * t.count] = pos[3 * t.count + 1] = pos[3 * t.count + 2] = 0;
      fade[t.count] = 1;
      line.geometry.setDrawRange(0, t.count + 1);
      line.geometry.attributes.position.needsUpdate = true;
      line.geometry.attributes.aFade.needsUpdate = true;
      line.matrix.makeTranslation(here.x, here.y, here.z);
      line.matrixWorldNeedsUpdate = true;
      const col = isSel ? COLORS.selected : COLORS[b.kind] ?? COLORS.asteroid;
      const mat = line.material as ShaderMaterial;
      mat.uniforms.uColor.value.set(col[0], col[1], col[2]);
      mat.uniforms.uAlpha.value = isSel ? 1 : 0.8;
      line.visible = true;
    }
  }

  private make(name: string): Line {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(3 * (SAMPLES + 1)), 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('aFade', new BufferAttribute(new Float32Array(SAMPLES + 1), 1).setUsage(DynamicDrawUsage));
    const mat = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uColor: { value: new Vector3() }, uAlpha: { value: 0.7 }, uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK },
      transparent: true, depthWrite: false, depthTest: true,
    });
    const line = new Line(geo, mat);
    line.name = `trail of ${name}`;
    line.frustumCulled = false;
    line.matrixAutoUpdate = false;
    line.renderOrder = 5;
    line.visible = false;
    this.group.add(line);
    return line;
  }

  /** A body has left the scene: its trail goes with it. */
  forget(b: Body): void {
    const t = this.trails.get(b);
    if (!t) return;
    if (t.line) {
      this.group.remove(t.line);
      t.line.geometry.dispose();
      (t.line.material as ShaderMaterial).dispose();
    }
    this.trails.delete(b);
    if (this.selected === b) this.selected = null;
  }

  /** Back to reality: no trails. */
  clear(): void {
    for (const b of [...this.trails.keys()]) this.forget(b);
  }
}
