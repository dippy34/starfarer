import { Vector3 } from 'three';
import { cometElements, cometState } from '../astro/comet';
import type { OrbitalElements } from '../astro/kepler';
import type { Comet } from '../render/SmallBodies';
import { Body } from '../universe/Body';

/** the comets' numbers in the simulation: far from the Solar System's own (NAIF's), the made worlds' (from 900,000,001) and other stars' (from 800,000,000) */
export const COMET_FIRST_ID = 600_000_000;

/**
 * A comet as live physics knows it once it is moved or thrown (src/app/LivePhysics.ts): a body of
 * no mass (pulled, pulling nothing) standing for what the app draws (`shows`), as `SimBody` is for
 * the planets of other stars. It is not one of the Solar System's bodies. Until the simulation
 * carries it, it is on its recorded path (`onPath`: where the comet's own orbit has it at a date,
 * as the worker that moves every comet works it out); from then on the simulation says where it is.
 */
export class CometBody extends Body {
  private readonly el: OrbitalElements;

  constructor(readonly shows: Comet) {
    super(COMET_FIRST_ID + shows.row[11], shows.name, 'comet');
    (this as { key: string }).key = `sim:${shows.key}`;
    this.el = cometElements(shows.row);
    // (a nucleus of unknown size is drawn 4 km across: src/render/CometTails.ts)
    const r = shows.radius > 0 ? shows.radius : 2000;
    this.radius = r;
    this.radii = [r, r, r];
  }

  /** On its recorded path round the Sun at `jd` (TDB): its place and motion from its own elements, `sun` where the Sun is then. */
  onPath(jd: number, sun: Body): void {
    const rel = new Vector3(), v = new Vector3();
    cometState(this.el, jd, rel, v);
    this.pos.copy(sun.pos).add(rel);
    this.vel.copy(sun.vel).add(v);
    this.upos.set(this.pos.x, this.pos.y, this.pos.z);
    this.parent = sun;
  }
}
