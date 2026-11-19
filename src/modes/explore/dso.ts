/**
 * Deep-sky objects of the real catalogues inside the world: marker points for
 * every cluster / nebula / pulsar / black hole, a volumetric model for the
 * nebula being approached, and member stars for the cluster being approached.
 */
import * as THREE from 'three';
import { raDecToUnit } from '../../core/astro';
import { blackbodyLinear } from '../../core/color';
import { comovingDistanceMpc } from '../../core/cosmology';
import { hashString } from '../../core/hash';
import { type UPos, uposFromMeters, uposSub, uposZero } from '../../core/hp';
import { Rng } from '../../core/rng';
import { MPC, PC } from '../../core/units';
import type { Catalog, DsoRecord } from '../../data/catalog';
import { type PointChunkData, STYLE_COMPACT, STYLE_GALAXY, STYLE_GIANT, STYLE_QUASAR, STYLE_STAR } from '../../data/decode';
import type { Engine } from '../../render/engine';
import { NebulaRenderer, type NebulaView } from '../../render/nebulaRenderer';
import type { PointLayer } from '../../render/pointLayer';
import { mainSequenceTeff } from '../../universe/star';
import type { SystemInput } from '../../universe/system';
import { type WorldTarget, dsoRadius, dsoTarget } from './targets';
import { GROUP_CATALOG, GROUP_PROCEDURAL } from './world';

export const DSO_KEY = 'dso';
const CLUSTER_PREFIX = 'dsoc:';

const TYPE_STYLE: Record<DsoRecord['t'], { rgb: [number, number, number]; absMag: number; style: number; nebula: number }> = {
  oc: { rgb: [190, 215, 255], absMag: -4.5, style: STYLE_GALAXY, nebula: -1 },
  gc: { rgb: [255, 228, 185], absMag: -7.5, style: STYLE_GALAXY, nebula: -1 },
  pn: { rgb: [110, 255, 215], absMag: -1.5, style: STYLE_GALAXY, nebula: 2 },
  en: { rgb: [255, 120, 150], absMag: -6, style: STYLE_GALAXY, nebula: 0 },
  rn: { rgb: [140, 170, 255], absMag: -3, style: STYLE_GALAXY, nebula: 1 },
  dn: { rgb: [90, 70, 60], absMag: 4, style: STYLE_GALAXY, nebula: 4 },
  snr: { rgb: [255, 140, 120], absMag: -3.5, style: STYLE_GALAXY, nebula: 3 },
  psr: { rgb: [140, 190, 255], absMag: 7.5, style: STYLE_COMPACT, nebula: -1 },
  bh: { rgb: [255, 140, 60], absMag: 6, style: STYLE_COMPACT, nebula: -1 },
  qso: { rgb: [166, 200, 255], absMag: -26.7, style: STYLE_QUASAR, nebula: -1 },
};

const tmp = { x: 0, y: 0, z: 0 };

export class DsoManager {
  readonly positions: UPos[];
  private readonly nebula: NebulaRenderer;
  private nebulaIndex = -1;
  private nebulaFade = 0;
  private readonly nebulaView: NebulaView = { type: 0, rel: new THREE.Vector3(), radius: 1, seed: 1, opacity: 0 };
  private clusterIndex = -1;
  private scanTimer = 0;
  /** Edge distance (m) to the nearest deep-sky object, for travel-speed scaling. */
  nearestEdge = Infinity;
  nearestIndex = -1;

  constructor(private readonly engine: Engine, private readonly catalog: Catalog, private readonly starLayer: PointLayer, galaxyLayer: PointLayer) {
    this.nebula = new NebulaRenderer(engine.renderer, engine.background, engine.noise, engine.post.isHdr);
    const list = catalog.dso;
    this.positions = list.map((d) => {
      const u = raDecToUnit(d.ra, d.dec);
      const dist = d.z !== undefined ? comovingDistanceMpc(d.z) * MPC : (d.d ?? 0) * PC;
      return uposFromMeters(u.x * dist, u.y * dist, u.z * dist);
    });
    // Marker points: Milky Way objects go in the star layer (parsecs), the odd quasar in the galaxy layer (megaparsecs).
    const build = (pick: (d: DsoRecord) => boolean, unit: number): PointChunkData => {
      const n = list.length;
      const positions = new Float32Array(n * 3);
      const absMag = new Float32Array(n).fill(40);
      const colors = new Uint8Array(n * 4);
      let radius = 1;
      list.forEach((d, i) => {
        if (!pick(d)) return;
        const p = this.positions[i]!;
        uposSub(p, uposZero(), tmp);
        positions[i * 3] = tmp.x / unit;
        positions[i * 3 + 1] = tmp.y / unit;
        positions[i * 3 + 2] = tmp.z / unit;
        radius = Math.max(radius, Math.hypot(tmp.x, tmp.y, tmp.z) / unit);
        const s = TYPE_STYLE[d.t];
        // Catalogued apparent magnitude → absolute magnitude; otherwise a typical value for the type.
        absMag[i] = d.m !== undefined && d.d ? d.m - 5 * Math.log10(d.d / 10) : s.absMag;
        colors[i * 4] = s.rgb[0];
        colors[i * 4 + 1] = s.rgb[1];
        colors[i * 4 + 2] = s.rgb[2];
        colors[i * 4 + 3] = s.style;
      });
      return { count: n, positions, absMag, colors, radius };
    };
    if (list.length > 0) {
      starLayer.addChunk(DSO_KEY, uposZero(), build((d) => d.t !== 'qso', PC), { group: GROUP_CATALOG });
      galaxyLayer.addChunk(DSO_KEY, uposZero(), build((d) => d.t === 'qso', MPC), { group: GROUP_CATALOG });
    }
  }

  target(index: number): WorldTarget | null {
    const d = this.catalog.dso[index];
    return d ? dsoTarget(d, index, this.positions[index]!) : null;
  }

  /** Pulsars and black holes are visited as star systems: describe one as a system input. */
  systemInput(index: number): SystemInput | null {
    const d = this.catalog.dso[index];
    if (!d || (d.t !== 'psr' && d.t !== 'bh')) return null;
    const x = d.x ?? {};
    const smbh = x.smbh === 1;
    return {
      id: `dso:${index}`, name: d.n, seed: hashString(`dso:${d.n}`), origin: this.positions[index]!,
      star: { absMag: d.t === 'psr' ? 7.5 : 6, teff: d.t === 'psr' ? 800_000 : 0, type: d.t === 'psr' ? 'pulsar' : 'blackhole', real: true },
      compact: {
        massSun: typeof x.massSun === 'number' ? x.massSun : undefined, periodSec: typeof x.period === 'number' ? x.period : undefined,
        // Sagittarius A* is famously quiet; stellar-mass black holes in the list are X-ray binaries, i.e. actively feeding.
        accretion: d.t === 'bh' ? (smbh ? 0.22 : 0.75) : undefined,
      },
      noPlanets: true,
    };
  }

  /** Activation distance for a compact object's "system" (bigger for supermassive holes, whose lensing is visible from afar). */
  enterDistance(index: number): number {
    const d = this.catalog.dso[index];
    const mass = d && typeof d.x?.massSun === 'number' ? d.x.massSun : 10;
    const rs = 2953 * mass;
    return Math.max(0.05 * PC, rs * 4e4);
  }

  /** Deterministic member stars for a real cluster (their number and extent come from the catalogue). */
  private clusterStars(index: number): PointChunkData {
    const d = this.catalog.dso[index]!;
    const rng = new Rng(hashString(`cluster:${d.n}`));
    const rPc = dsoRadius(d) / PC;
    const globular = d.t === 'gc';
    const members = typeof d.x?.stars === 'number' ? d.x.stars : globular ? 4000 : 250;
    const n = Math.round(Math.min(3500, Math.max(40, globular ? 3500 : members)));
    const ageYr = typeof d.x?.age === 'number' ? d.x.age : globular ? 1.2e10 : 2e8;
    // Stars brighter than the main-sequence turn-off have evolved away (or into giants).
    const turnoff = Math.min(4.5, Math.max(-5, -2.5 + 2.6 * Math.log10(Math.max(ageYr, 3e6) / 1e7)));
    const positions = new Float32Array(n * 3);
    const absMag = new Float32Array(n);
    const colors = new Uint8Array(n * 4);
    const core = rPc * (globular ? 0.22 : 0.4);
    for (let i = 0; i < n; i++) {
      // Plummer sphere.
      const m = Math.pow(rng.range(0.02, 0.97), -2 / 3) - 1;
      const r = Math.min(core / Math.sqrt(m), rPc * 2.2);
      const [x, y, z] = rng.unitVector();
      positions[i * 3] = x * r;
      positions[i * 3 + 1] = y * r;
      positions[i * 3 + 2] = z * r;
      const giant = rng.chance(globular ? 0.12 : 0.04);
      const mag = giant ? rng.range(-2.5, 1.5) : turnoff + 9 * Math.pow(rng.next(), 0.55);
      const teff = giant ? rng.range(3900, 5000) : mainSequenceTeff(mag) * (globular ? 0.92 : 1);
      const [cr, cg, cb] = blackbodyLinear(teff);
      absMag[i] = mag;
      colors[i * 4] = Math.round(cr * 255);
      colors[i * 4 + 1] = Math.round(cg * 255);
      colors[i * 4 + 2] = Math.round(cb * 255);
      colors[i * 4 + 3] = giant ? STYLE_GIANT : STYLE_STAR;
    }
    return { count: n, positions, absMag, colors, radius: rPc * 2.3 };
  }

  update(camPos: UPos, dt: number): void {
    const list = this.catalog.dso;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.5;
      let bestNeb = -1;
      let bestNebRatio = 40; // show the volume within 40 radii
      let bestCl = -1;
      let bestClRatio = 120;
      let nearest = Infinity;
      let nearestIndex = -1;
      for (let i = 0; i < list.length; i++) {
        const d = list[i]!;
        if (d.t === 'psr' || d.t === 'bh' || d.t === 'qso') continue;
        uposSub(this.positions[i]!, camPos, tmp);
        const dist = Math.hypot(tmp.x, tmp.y, tmp.z);
        const r = dsoRadius(d);
        const ratio = dist / r;
        const edge = Math.max(dist - r, r * 0.03);
        if (edge < nearest) {
          nearest = edge;
          nearestIndex = i;
        }
        if (TYPE_STYLE[d.t].nebula >= 0) {
          if (ratio < bestNebRatio) {
            bestNebRatio = ratio;
            bestNeb = i;
          }
        } else if (ratio < bestClRatio) {
          bestClRatio = ratio;
          bestCl = i;
        }
      }
      this.nearestEdge = nearest;
      this.nearestIndex = nearestIndex;
      if (bestNeb !== this.nebulaIndex && (this.nebulaFade <= 0 || bestNeb < 0)) {
        if (bestNeb >= 0 || this.nebulaFade <= 0) this.nebulaIndex = bestNeb;
      }
      this.wantNebula = bestNeb;
      if (bestCl !== this.clusterIndex) {
        if (this.clusterIndex >= 0) this.starLayer.removeChunk(`${CLUSTER_PREFIX}${this.clusterIndex}`);
        this.clusterIndex = bestCl;
        if (bestCl >= 0) this.starLayer.addChunk(`${CLUSTER_PREFIX}${bestCl}`, this.positions[bestCl]!, this.clusterStars(bestCl), { group: GROUP_PROCEDURAL });
      }
    }
    // Cross-fade the nebula volume in and out.
    const showing = this.nebulaIndex >= 0 && this.wantNebula === this.nebulaIndex;
    this.nebulaFade = Math.min(1, Math.max(0, this.nebulaFade + (showing ? dt : -dt) * 1.5));
    if (!showing && this.nebulaFade <= 0) this.nebulaIndex = this.wantNebula;
    const engine = this.engine;
    if (this.nebulaIndex >= 0 && this.nebulaFade > 0) {
      const d = list[this.nebulaIndex]!;
      uposSub(this.positions[this.nebulaIndex]!, camPos, tmp);
      const v = this.nebulaView;
      v.rel.set(tmp.x, tmp.y, tmp.z);
      v.radius = dsoRadius(d);
      v.type = TYPE_STYLE[d.t].nebula;
      v.seed = hashString(d.n);
      // Fade in as it grows on screen, so the marker point hands over to the volume smoothly.
      const px = (v.radius / Math.max(v.rel.length(), v.radius * 0.1)) * engine.pixelsPerRadian;
      v.opacity = this.nebulaFade * Math.min(1, Math.max(0, (px - 5) / 14));
      this.nebula.update(v.opacity > 0.01 ? v : null, engine.camera, engine.renderWidth, engine.renderHeight, engine.tier, dt);
    } else this.nebula.update(null, engine.camera, engine.renderWidth, engine.renderHeight, engine.tier, dt);
  }

  private wantNebula = -1;

  dispose(): void {
    this.nebula.dispose();
  }
}
