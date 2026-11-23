import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, Line, ShaderMaterial, Vector3 } from 'three';
import type { UPos } from '../core/upos';
import type { Body } from '../universe/Body';
import { FIX_LOGDEPTH, GLOBALS, OUTPUT_FRAGMENT, PROJECT_PARS } from './shaders/xr';

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PROJECT_PARS}
attribute float aAlong;
varying float vAlong;
void main() {
  vAlong = aAlong;
  gl_Position = projectView(modelViewMatrix * vec4(position, 1.0));
  #include <logdepthbuf_vertex>
${FIX_LOGDEPTH}
}`;
// dashes: uDash metres of line, a little over half of each drawn
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uDash;
varying float vAlong;
void main() {
  if (fract(vAlong / uDash) > 0.6) discard;
  gl_FragColor = vec4(uColor, 0.95);
${OUTPUT_FRAGMENT}
  #include <logdepthbuf_fragment>
}`;

/** dashes along the whole path */
const DASHES = 70;

/** A path ahead: places from what the world goes round (m), three numbers each, `count` of them, the first where it is now. */
export interface PathAhead { at: Float64Array; count: number }

/**
 * Where the world held, aimed or weighed will really go: a dashed line from it along the path the
 * simulation run ahead takes (src/app/Foresight.ts), measured from what it goes round, as an orbit
 * reads (and as src/render/Trails.ts draws where it has been). The orbit line beside it is the
 * two-body orbit it is on now; this is what all the pulls make of it.
 */
export class FuturesLayer {
  readonly group = new Group();
  private line: Line;
  private positions: Float32Array;
  private along: Float32Array;
  private mat: ShaderMaterial;
  private rel = new Vector3();

  /** `most`: places a path can have */
  constructor(most: number) {
    this.group.name = 'futures';
    this.positions = new Float32Array(3 * most);
    this.along = new Float32Array(most);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('aAlong', new BufferAttribute(this.along, 1).setUsage(DynamicDrawUsage));
    this.mat = new ShaderMaterial({
      name: 'future-path', vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uColor: { value: new Vector3(1.0, 0.69, 0.48) }, uDash: { value: 1 }, uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK },
      transparent: true, depthWrite: false, depthTest: true,
    });
    this.line = new Line(geo, this.mat);
    this.line.frustumCulled = false;
    this.line.matrixAutoUpdate = false;
    this.line.renderOrder = 6;
    this.line.visible = false;
    this.group.add(this.line);
  }

  /** The line, for the app to compile its shader with the others. */
  warmupObject(): Line {
    return this.line;
  }

  /**
   * Draw the path `f` from the world `b` for the eye at `cam` (nothing for null). Returns where the
   * path ends, from the eye (m), for what ends it to be said there; null if nothing is drawn.
   */
  update(cam: UPos, f: PathAhead | null, b: Body | null): Vector3 | null {
    this.line.visible = false;
    if (!f || !b || !b.valid || f.count < 2) return null;
    const at = f.at, pos = this.positions, along = this.along;
    // each place from where the world is now (the first place), so the line starts exactly on it
    let length = 0;
    for (let k = 0; k < f.count; k++) {
      pos[3 * k] = at[3 * k] - at[0];
      pos[3 * k + 1] = at[3 * k + 1] - at[1];
      pos[3 * k + 2] = at[3 * k + 2] - at[2];
      if (k > 0) length += Math.hypot(at[3 * k] - at[3 * k - 3], at[3 * k + 1] - at[3 * k - 2], at[3 * k + 2] - at[3 * k - 1]);
      along[k] = length;
    }
    if (!(length > 0)) return null;
    const geo = this.line.geometry;
    geo.setDrawRange(0, f.count);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAlong.needsUpdate = true;
    this.mat.uniforms.uDash.value = length / DASHES;
    const here = b.upos.sub(cam, this.rel);
    this.line.matrix.makeTranslation(here.x, here.y, here.z);
    this.line.matrixWorldNeedsUpdate = true;
    this.line.visible = true;
    const k = 3 * (f.count - 1);
    return here.clone().add(new Vector3(pos[k], pos[k + 1], pos[k + 2]));
  }
}
