import { Vector3 } from 'three';
import { formatRaDec } from '../core/frames';
import { UPos } from '../core/upos';
import { LY, PC, SUN_ABS_MAG, SUN_RADIUS } from '../core/units';
import type { SpaceObject } from './Body';
import { estimateStarRadius, measuredStar, type MeasuredStar } from './StarRadii';
import type { StarRef } from './StarCatalog';
import { shapeFlattening, starShape, type StarShape } from './StarShapes';

/** Notable stars (proper names, Bayer/Flamsteed, HR, Gliese) used for labels, search and the info panel. */
export interface NamedStar {
  index: number;
  names: string[];
  pos: Vector3; // pc
  absMag: number;
  teff: number;
  spect: string;
  node: number;
  slot: number;
  /** has an IAU proper name (first designation) */
  proper: boolean;
}

export class NamedStars {
  readonly list: NamedStar[] = [];
  readonly byNodeSlot = new Map<string, NamedStar>();

  static async load(base: string): Promise<NamedStars> {
    const res = await fetch(`${base}/named.json`);
    if (!res.ok) throw new Error(`named stars: HTTP ${res.status}`);
    const js = await res.json();
    const ns = new NamedStars();
    js.stars.forEach((s: [string[], number, number, number, number, number, string, number, number, number], i: number) => {
      const [names, x, y, z, absMag, teff, spect, node, slot, proper] = s;
      const star: NamedStar = { index: i, names, pos: new Vector3(x, y, z), absMag, teff, spect, node, slot, proper: proper === 1 };
      ns.list.push(star);
      ns.byNodeSlot.set(`${node}:${slot}`, star);
    });
    return ns;
  }
}

export { estimateStarRadius } from './StarRadii';

/** what a star with no name or number in any catalogue the app has is called */
const UNNAMED = 'Unnamed star';

/** A star from the catalogue presented as a selectable object. */
export class CatalogStar implements SpaceObject {
  readonly kind = 'star';
  readonly upos: UPos;
  /** true once the position comes from the decoded catalogue tile (exact) */
  exact = false;
  /** its radius (m): measured (`measured`, or across its equator, `shape`), or else estimated from its brightness and temperature */
  radius: number;
  /** its shape, for the few stars whose shape has been measured (StarShapes.ts) */
  shape: StarShape | null = null;
  /** its radius (and temperature) as measured, for the stars that have one (StarRadii.ts) */
  measured: MeasuredStar | null = null;
  /** effective temperature (K): the catalogue's (from its colour), or as measured */
  teff: number;
  readonly parentObject = null;
  name: string;
  designations: string[];
  /** filled asynchronously for stars without a classical designation */
  private resolving = false;

  constructor(
    readonly key: string,
    readonly posPc: Vector3,
    readonly absMag: number,
    teff: number,
    readonly spect: string,
    names: string[],
    readonly ref: StarRef | null,
  ) {
    this.upos = UPos.from(posPc.x * PC, posPc.y * PC, posPc.z * PC);
    this.teff = teff;
    this.radius = estimateStarRadius(absMag, teff);
    // a star of the catalogue whose number is still on its way is "Star" until it comes (resolve)
    this.name = names[0] ?? (ref ? 'Star' : UNNAMED);
    this.designations = names;
    this.measure();
  }

  /** A star whose size has been measured is as wide as it was found to be (and as hot, where that was measured too). */
  private measure(): void {
    this.shape = starShape(this.designations);
    this.measured = this.shape ? null : measuredStar(this.designations);
    if (this.shape) this.radius = this.shape.rEq;
    else if (this.measured) {
      this.radius = this.measured.radius;
      if (this.measured.teff) this.teff = this.measured.teff;
    }
  }

  /** Adopt the exact catalogue position (pc). */
  setPosition(pc: Vector3): void {
    this.posPc.copy(pc);
    this.upos.set(pc.x * PC, pc.y * PC, pc.z * PC);
  }

  /** Resolve the designation of an anonymous catalogue star (HIP/HD/TYC/Gaia). */
  resolve(named: NamedStars, onDone: () => void): void {
    if (!this.ref || this.resolving || this.designations.length) return;
    this.resolving = true;
    this.ref.catalog.designation(this.ref).then((d) => {
      if (d.notable !== null) {
        const s = named.list[d.notable];
        this.designations = s.names;
      } else if (d.text) {
        this.designations = [d.text];
      }
      this.name = this.designations[0] ?? UNNAMED;
      this.measure();
      onDone();
    }).catch(() => { this.resolving = false; }); // (asked again the next time it is chosen)
  }

  info(): [string, string][] {
    const rows: [string, string][] = [['Type', 'Star']];
    if (this.spect) rows.push(['Spectral type', this.spect]);
    rows.push(['Temperature', `${Math.round(this.teff).toLocaleString()} K${this.measured?.teff ? ` (measured: ${this.measured.source})` : ''}`]);
    rows.push(['Absolute mag (V)', this.absMag.toFixed(2)]);
    rows.push(['Luminosity (V)', `${Math.pow(10, -0.4 * (this.absMag - SUN_ABS_MAG)).toPrecision(3)} L☉`]);
    const shape = this.shape;
    if (shape) {
      const tilt = (shape.incl * 180) / Math.PI;
      rows.push(['Radius', `${(shape.rEq / SUN_RADIUS).toPrecision(3)} R☉ across the equator, ${(shape.rPol / SUN_RADIUS).toPrecision(3)} R☉ at the poles (measured)`]);
      rows.push(['Shape', `Flattened ${Math.round(100 * shapeFlattening(shape))} % by its spin; from the Sun it is seen ${
        tilt < 25 ? 'nearly pole-on' : tilt > 75 ? 'nearly equator-on' : `${Math.round(tilt)}° from pole-on`} (${shape.source})`]);
    } else rows.push(['Radius', `${(this.radius / SUN_RADIUS).toPrecision(3)} R☉ ${this.measured ? `(measured: ${this.measured.source})` : '(estimated)'}`]);
    const d = this.posPc.length();
    rows.push(['Distance from Sun', `${d.toPrecision(4)} pc (${((d * PC) / LY).toPrecision(4)} ly)`]);
    rows.push(['RA / Dec (from Sun)', formatRaDec(this.posPc)]);
    if (this.designations.length > 1) rows.push(['Designations', this.designations.slice(1, 6).join(', ')]);
    if (this.ref) rows.push(['Catalogue', `${this.ref.catalog.source.split(' (')[0]} — ${this.ref.catalog.license}`]);
    return rows;
  }
}
