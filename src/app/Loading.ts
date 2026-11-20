/**
 * What the app is doing while it starts, for the loading screen (src/ui/Splash.ts).
 *
 * The work is a list of stages, each a real piece of it: a stage is "running" from the moment its
 * download or its computation starts until it has finished, and then says what it brought (counts
 * read from the data itself: nothing here is a made-up number). The bar is the share of the work
 * done, each stage weighted by about what it costs; it never runs ahead of the work and never
 * goes back. The bytes are those the browser itself reports for each download.
 *
 * No DOM here (tests/loading.test.ts).
 */

export type StageState = 'waiting' | 'running' | 'done' | 'failed';

export interface Stage {
  readonly id: string;
  /** what is being fetched or built, as shown while it runs: "The Solar System" */
  label: string;
  /** its share of the whole wait (megabytes to download, or the like) */
  readonly weight: number;
  state: StageState;
  /** how much of it is done while it runs, 0..1: for work that arrives in pieces */
  part: number;
  /** what it has brought: "37 of 82 regions" while it runs, "9 planets, 459 moons" once done */
  note: string;
}

export type StagePlan = readonly (readonly [id: string, label: string, weight: number])[];

/**
 * The stages of starting the app (App.create, App.firstView), in the order they are shown.
 * The weights are megabytes on the wire, or for work on this device about as long as that.
 */
export const LOAD_PLAN: StagePlan = [
  ['solar', 'The Solar System', 1.6],
  ['stars', 'The star catalogue', 0.4],
  ['named', 'Named stars', 1.7],
  ['exo', 'Planets of other stars', 2.4],
  ['deep', 'Black holes, galaxies and nebulae', 0.3],
  ['small', 'Asteroids and comets', 2.9],
  ['craft', 'Spacecraft', 1.0],
  ['today', 'Where everything is today', 0.6],
  ['sky', 'The Milky Way', 3.1],
  ['world', 'The first world', 4.5],
  ['shaders', 'Preparing the graphics', 3],
  ['field', 'The stars around you', 8],
];

export class LoadProgress {
  readonly stages: Stage[];
  /** called whenever anything here changes */
  onChange: (() => void) | null = null;
  /** downloads finished so far, and their size over the network (0 for what the browser had cached) */
  files = 0;
  bytes = 0;
  /** what went wrong, once something has */
  error: { stage: Stage | null; message: string } | null = null;

  private order: Stage[] = [];
  private finishedOrder: Stage[] = [];
  private shown = 0;

  constructor(plan: StagePlan = LOAD_PLAN) {
    this.stages = plan.map(([id, label, weight]) => ({ id, label, weight, state: 'waiting' as StageState, part: 0, note: '' }));
  }

  /** the share of the work that is done, 0..1: it never goes back */
  get fraction(): number {
    let done = 0, all = 0;
    for (const s of this.stages) {
      all += s.weight;
      done += s.weight * (s.state === 'done' ? 1 : s.state === 'running' ? s.part : 0);
    }
    this.shown = Math.max(this.shown, all > 0 ? done / all : 1);
    return this.shown;
  }

  get finished(): boolean {
    return this.stages.every((s) => s.state === 'done');
  }

  /** the stages under way, in the order they started */
  get running(): Stage[] {
    return this.order.filter((s) => s.state === 'running');
  }

  /** the stages finished, the latest last */
  get done(): Stage[] {
    return this.finishedOrder;
  }

  /** A stage starts. `label` says more exactly what it is, when that is only known now ("Maps of Earth"). */
  begin(id: string, label?: string): void {
    const s = this.stage(id);
    if (s.state !== 'waiting') return;
    s.state = 'running';
    if (label) s.label = label;
    this.order.push(s);
    this.onChange?.();
  }

  /** A running stage has come this far (0..1), and has this to show for it. */
  advance(id: string, part: number, note?: string): void {
    const s = this.stage(id);
    if (s.state === 'waiting') this.begin(id);
    if (s.state !== 'running') return;
    const p = Math.max(s.part, Math.min(1, Math.max(0, part)));
    if (p === s.part && (note === undefined || note === s.note)) return;
    s.part = p;
    if (note !== undefined) s.note = note;
    this.onChange?.();
  }

  end(id: string, note = ''): void {
    const s = this.stage(id);
    if (s.state === 'done') return;
    if (s.state === 'waiting') this.order.push(s);
    s.state = 'done';
    s.part = 1;
    s.note = note;
    this.finishedOrder.push(s);
    this.onChange?.();
  }

  /**
   * Run a stage: it is under way until `work` settles. `note` says what it brought, from the result.
   * A failure is recorded (see `error`) and passed on.
   */
  async run<T>(id: string, work: Promise<T> | (() => Promise<T>), note?: (result: T) => string): Promise<T> {
    this.begin(id);
    try {
      const result = await (typeof work === 'function' ? work() : work);
      this.end(id, note ? note(result) : '');
      return result;
    } catch (err) {
      this.fail(id, err);
      throw err;
    }
  }

  fail(id: string | null, err: unknown): void {
    const s = id ? this.stage(id) : null;
    if (s && s.state !== 'done') s.state = 'failed';
    // (the first failure is the cause; what follows from it is not news)
    this.error ??= { stage: s, message: err instanceof Error ? err.message : String(err) };
    this.onChange?.();
  }

  /** A download finished (from the browser's own record of it). */
  received(bytes: number): void {
    this.files++;
    this.bytes += bytes;
    this.onChange?.();
  }

  private stage(id: string): Stage {
    const s = this.stages.find((x) => x.id === id);
    if (!s) throw new Error(`no loading stage "${id}"`);
    return s;
  }
}

/** "3.2 MB", "840 KB": a download size as people read it */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${Math.round(bytes)} B`;
}

/** "459 moons", "1 moon", "2.75 million stars": a count with its noun */
export function count(n: number, one: string, many = `${one}s`): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')} million ${many}`;
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}
