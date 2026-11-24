import { Vector3 } from 'three';
import { formatRaDec } from '../core/frames';
import { UPos } from '../core/upos';
import { LY, PC, SUN_ABS_MAG, SUN_RADIUS } from '../core/units';
import type { SpaceObject } from './Body';
import { estimateStarRadius, measuredStar, type MeasuredStar } from './StarRadii';
import type { DistanceGrade, StarRef, TeffSource } from './StarCatalog';
import { shapeFlattening, starShape, type StarShape } from './StarShapes';

/**
 * The dust's extinction in V for a reddening E(B-V): R_V = 3.1, the diffuse interstellar medium's
 * mean (Cardelli, Clayton & Mathis 1989, ApJ 345, 245). A star whose type is taken though its colour
 * is reddened is that much brighter than it looks, and its size is worked out from that.
 */
export const R_V = 3.1;

/** Where a star's temperature came from, for its card (TeffSource). */
export function teffSourceText(t: TeffSource): string {
  const src = t.source === 'colour' ? 'from its colour'
    : t.source === 'classColour' ? 'from the usual colour of its spectral class (its own is not known)'
      : t.source === 'gaia' ? 'Gaia DR3, from its spectrum'
        : t.source === 'dwarfs' ? (t.dwarfScale ? "from its spectral type, on the dwarfs' scale (Pecaut & Mamajek 2013; none for its class here)" : 'from its spectral type (Pecaut & Mamajek 2013)')
          : `from its spectral type (${t.source === 'martins' ? 'Martins et al. 2005' : 'Crowther et al. 2006'})`;
  return t.reddened ? `${src}; its light is reddened by dust, E(B−V) ${t.ebv.toFixed(2)}` : src;
}

/** What is said of a catalogue type that the temperature does not follow (TeffSource), or ''. */
export function spectNote(t: TeffSource): string {
  if (t.flagged) return t.composite ? ' — of two stars (a composite spectrum), and not matching its colour: not used' : ' — does not match its colour or its brightness: not used';
  if (t.redder) return " — its colour is redder: dust, or a wrong type (its colour's temperature used)";
  return '';
}

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
  /** how far its distance can be trusted (StarCatalog.distanceGrade), once asked for (gradeDistance) */
  distanceGrade: DistanceGrade | null = null;
  private grading = false;
  /** where its temperature comes from (StarCatalog.teffSource), once asked for (describeTemperature) */
  teffSource: TeffSource | null = null;
  private sourcing = false;

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

  /** Ask the catalogue how good its distance is (once; `onDone` when it is known). */
  gradeDistance(onDone: () => void): void {
    if (!this.ref || this.grading || this.distanceGrade) return;
    this.grading = true;
    this.ref.catalog.distanceGrade(this.ref).then((g) => {
      this.grading = false;
      if (!g) return;
      this.distanceGrade = g;
      onDone();
    }).catch(() => { this.grading = false; });
  }

  /**
   * Ask the catalogue where its temperature comes from (once; `onDone` when it is known). Gaia's,
   * where that is the one used, becomes its temperature (unless one was measured); a star whose
   * type is taken though dust has reddened it is sized for the light the dust took.
   */
  describeTemperature(onDone: () => void): void {
    if (!this.ref || this.sourcing || this.teffSource) return;
    this.sourcing = true;
    this.ref.catalog.teffSource(this.ref).then((t) => {
      this.sourcing = false;
      if (!t) return;
      this.teffSource = t;
      if (t.gaiaTeff !== null && !this.measured?.teff) this.teff = t.gaiaTeff;
      if (!this.shape && !this.measured) this.radius = estimateStarRadius(this.absMag - (t.reddened ? R_V * t.ebv : 0), this.teff);
      onDone();
    }).catch(() => { this.sourcing = false; });
  }

  /** its distance is a poor parallax's, or Hipparcos's alone from far off: what follows from it is not known */
  get distanceUncertain(): boolean {
    return this.distanceGrade?.grade === 'poor' || this.distanceGrade?.grade === 'hipFar';
  }

  info(): [string, string][] {
    const rows: [string, string][] = [['Type', 'Star']];
    const unsure = this.distanceUncertain;
    // (what is worked out from its distance is said to be as uncertain as the distance is)
    const fromDistance = unsure ? ' (uncertain: from its distance)' : '';
    const ts = this.teffSource;
    if (this.spect) rows.push(['Spectral type', `${this.spect}${ts ? spectNote(ts) : ''}`]);
    rows.push(['Temperature', `${Math.round(this.teff).toLocaleString('en-US')} K${this.measured?.teff ? ` (measured: ${this.measured.source})` : ts ? ` (${teffSourceText(ts)})` : ''}`]);
    rows.push(['Absolute mag (V)', `${this.absMag.toFixed(2)}${fromDistance}`]);
    rows.push(['Luminosity (V)', `${Math.pow(10, -0.4 * (this.absMag - SUN_ABS_MAG)).toPrecision(3)} L☉${fromDistance}`]);
    const shape = this.shape;
    if (shape) {
      const tilt = (shape.incl * 180) / Math.PI;
      rows.push(['Radius', `${(shape.rEq / SUN_RADIUS).toPrecision(3)} R☉ across the equator, ${(shape.rPol / SUN_RADIUS).toPrecision(3)} R☉ at the poles (measured)`]);
      rows.push(['Shape', `Flattened ${Math.round(100 * shapeFlattening(shape))} % by its spin; from the Sun it is seen ${
        tilt < 25 ? 'nearly pole-on' : tilt > 75 ? 'nearly equator-on' : `${Math.round(tilt)}° from pole-on`} (${shape.source})`]);
    } else rows.push(['Radius', `${(this.radius / SUN_RADIUS).toPrecision(3)} R☉ ${this.measured ? `(measured: ${this.measured.source})` : unsure ? '(estimated from its brightness and an uncertain distance)' : ts?.reddened ? '(estimated, with the light the dust took)' : '(estimated)'}`]);
    const d = this.posPc.length();
    const g = this.distanceGrade;
    const how = g?.grade === 'poor' ? ` — distance uncertain (parallax ${g.parallaxMas.toFixed(3)} ± ${g.errorMas.toFixed(3)} mas)`
      : g?.grade === 'hipFar' ? ' — distance uncertain (from Hipparcos alone, this far off)' : '';
    rows.push(['Distance from Sun', `${d.toPrecision(4)} pc (${((d * PC) / LY).toPrecision(4)} ly)${how}`]);
    rows.push(['RA / Dec (from Sun)', formatRaDec(this.posPc)]);
    if (this.designations.length > 1) rows.push(['Designations', this.designations.slice(1, 6).join(', ')]);
    if (this.ref) rows.push(['Catalogue', `${this.ref.catalog.source.split(' (')[0]} — ${this.ref.catalog.license}`]);
    return rows;
  }
}
