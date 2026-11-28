import { AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Group, Mesh, Quaternion, ShaderMaterial, Vector2, Vector3, Vector4 } from 'three';
import type { UPos } from '../core/upos';
import { PC } from '../core/units';
import type { BlackHole } from '../universe/BlackHoles';
import { JET_BASE, JET_FRAG, JET_VERT } from './shaders/jet';
import { GLOBALS } from './shaders/xr';

/** below this height (rs) a jet widens as a parabola, radius 1.5 z^0.58; above it, as a cone */
const PARABOLA_TO = 1e5;

/** A hole's pair of jets, as shaders/jet.ts draws them. */
export interface JetShape {
  /** a jet's length, the height at which its parabola turns into a cone, its radius there (all rs), and the cone's slope */
  shape: Vector4;
  /** its colour as bright as it is drawn from the side (rgb), and a seed for its knots (w) */
  glow: Vector4;
  /** its length (m) */
  length: number;
}

/** The jets of a hole that has them: M87's, seen in visible light; a microquasar's, which are radio jets and drawn faintly. */
export function jetShape(bh: BlackHole): JetShape | null {
  if (!bh.jet) return null;
  const optical = bh.jet === 'optical';
  // M87: ~1.5 kpc; microquasar radio jets: ~0.05 pc
  const length = optical ? 1500 * PC : 0.05 * PC;
  const reach = length / bh.radius, turn = Math.min(PARABOLA_TO, reach * 0.1);
  // (blue-white: a synchrotron glow has more blue in it than sunlight)
  const [r, g, b] = optical ? [0.5, 0.74, 1.0] : [0.7, 0.55, 1.0];
  const level = optical ? 1.6 : 0.45;
  return {
    shape: new Vector4(reach, turn, 1.5 * turn ** 0.58, Math.tan(((optical ? 1.5 : 1.0) * Math.PI) / 180)),
    glow: new Vector4(r * level, g * level, b * level, bh.diskLook.seed),
    length,
  };
}

/**
 * The tube a pair of jets is drawn within, along +y and -y, in rs: rings logarithmically spaced
 * from the base to the tip, each carrying its radius.
 */
function jetGeometry(shape: Vector4): BufferGeometry {
  const rings = 110, seg = 24;
  const pos: number[] = [], nrm: number[] = [], rad: number[] = [], idx: number[] = [];
  const k = Math.log(shape.x / JET_BASE);
  for (const side of [1, -1]) {
    const first = pos.length / 3;
    for (let i = 0; i <= rings; i++) {
      const z = JET_BASE * Math.exp((k * i) / rings);
      // (a tenth to spare: the glow ends at the jet's edge, and the tube's flat sides must not cut into it)
      const r = 1.1 * (z < shape.y ? 1.5 * z ** 0.58 : shape.z + (z - shape.y) * shape.w);
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        pos.push(Math.cos(a) * r, side * z, Math.sin(a) * r);
        nrm.push(Math.cos(a), 0, Math.sin(a));
        rad.push(r);
      }
    }
    // (both halves wound the same way round as seen from outside)
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = first + i * (seg + 1) + j, b = a + seg + 1;
      if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('aRadius', new BufferAttribute(new Float32Array(rad), 1));
  g.setIndex(idx);
  return g;
}

interface Pair { bh: BlackHole; mesh: Mesh; length: number }

/**
 * Relativistic jets of the black holes that have them, along the spin axis (taken as the disk
 * normal). A pair is a glow worked out along the sight line of every pixel of the tube that holds
 * it (shaders/jet.ts): there is no surface to it, and nothing shows of the tube. Where a hole is
 * drawn with its bending of light, that pass draws its jets too, in front of the hole and behind
 * it as they are, over what the tubes here have drawn; so the jets are no part of the
 * surroundings the holes bend (the app keeps them out of BlackHoleLayer.capture).
 */
export class JetsLayer {
  readonly group = new Group();
  private pairs: Pair[] = [];

  constructor(holes: BlackHole[]) {
    this.group.name = 'jets';
    for (const bh of holes) {
      const jet = jetShape(bh);
      if (!jet) continue;
      const mesh = new Mesh(jetGeometry(jet.shape), new ShaderMaterial({
        name: 'jets', vertexShader: JET_VERT, fragmentShader: JET_FRAG,
        uniforms: {
          uJet: { value: jet.shape }, uJetGlow: { value: jet.glow }, uJetView: { value: new Vector2(0, 1e-3) },
          uO: { value: new Vector3() }, uAxis: { value: bh.diskNormal.clone() }, uRs: { value: bh.radius },
          uClipScale: { value: 1 }, uPullIn: GLOBALS.uPullIn, uDepthK: GLOBALS.uDepthK,
        },
        // (the tube's far wall: one fragment to a pixel, from inside the jet too)
        transparent: true, depthWrite: false, blending: AdditiveBlending, side: BackSide,
      }));
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 11;
      mesh.name = `${bh.name} jets`;
      this.group.add(mesh);
      this.pairs.push({ bh, mesh, length: jet.length });
    }
  }

  /**
   * The mass of `bh` was changed (its horizon with it): its jets are drawn in horizon radii and are as long in metres as they were,
   * so their shape in radii is worked out again, and their tube made again, from the next frame.
   */
  massChanged(bh: BlackHole): void {
    const p = this.pairs.find((x) => x.bh === bh), jet = jetShape(bh);
    if (!p || !jet) return;
    p.mesh.geometry.dispose();
    p.mesh.geometry = jetGeometry(jet.shape);
    const u = (p.mesh.material as ShaderMaterial).uniforms;
    u.uJet.value = jet.shape;
    u.uJetGlow.value = jet.glow;
    u.uRs.value = bh.radius;
  }

  /** A pair of jets to compile the shader with before one is first needed. */
  warmupObjects(): Mesh[] {
    return this.pairs.length ? [this.pairs[0].mesh] : [];
  }

  update(cam: UPos, pixelAngle: number, time: number): void {
    const rel = new Vector3();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    for (const p of this.pairs) {
      p.bh.upos.sub(cam, rel);
      const dist = rel.length();
      // only worth drawing once the jets span a few pixels
      p.mesh.visible = Math.atan2(p.length, dist) / pixelAngle > 3;
      if (!p.mesh.visible) continue;
      const rs = p.bh.radius;
      q.setFromUnitVectors(up, p.bh.diskNormal);
      p.mesh.matrix.compose(rel, q, new Vector3(rs, rs, rs)); // (the tube is in rs)
      p.mesh.matrixWorldNeedsUpdate = true;
      const u = (p.mesh.material as ShaderMaterial).uniforms;
      (u.uO.value as Vector3).copy(rel).multiplyScalar(-1 / rs);
      (u.uJetView.value as Vector2).set(time, pixelAngle);
      u.uClipScale.value = 1 / Math.max(dist, p.length);
    }
  }
}
