import { formatBytes, type LoadProgress, type Stage } from '../app/Loading';

/**
 * The loading screen. Its markup and its styles are in index.html, so it is on the screen before
 * any script has arrived; this fills it in from the real state of the loading
 * (src/app/Loading.ts): a bar for the share of the work done, a line for each piece under way,
 * and, as each piece finishes, what it brought. If something fails it says what, and offers to
 * try again.
 */

/** lines kept on the screen: those under way, and the latest finished above them */
const LINES = 7;
/** once everything is in, the full bar and the last ticks are left to be seen for this long (ms), then it fades over FADE */
const BEAT = 420;
const FADE = 650;

export class Splash {
  private bar: HTMLElement;
  private meter: HTMLElement;
  private percent: HTMLElement;
  private received: HTMLElement;
  private log: HTMLElement;
  private rows = new Map<string, HTMLLIElement>();
  private gone = false;

  constructor(private el: HTMLElement) {
    this.meter = el.querySelector<HTMLElement>('.boot-meter')!;
    this.bar = el.querySelector<HTMLElement>('.boot-meter i')!;
    this.percent = el.querySelector<HTMLElement>('.boot-percent')!;
    this.received = el.querySelector<HTMLElement>('.boot-received')!;
    this.log = el.querySelector<HTMLElement>('.boot-log')!;
  }

  /** Show the loading as it stands. */
  show(p: LoadProgress): void {
    if (this.gone) return;
    if (p.error) { this.fail(p); return; }
    const pct = Math.floor(p.fraction * 100);
    this.bar.style.transform = `scaleX(${p.fraction})`;
    this.meter.setAttribute('aria-valuenow', String(pct));
    setText(this.percent, `${pct} %`);
    setText(this.received, p.bytes > 0 ? `${formatBytes(p.bytes)} received` : p.files > 0 ? 'Already on this device' : 'Starting');
    // one line per piece of the work: the finished ones in the order they finished, then those under way
    const shown = [...p.done, ...p.running];
    shown.forEach((s, i) => this.row(s, i));
    // the oldest finished lines make room (they fold away, they are not cut off)
    const keep = new Set(shown.slice(-Math.max(LINES, p.running.length)).map((s) => s.id));
    for (const [id, li] of this.rows) li.classList.toggle('old', !keep.has(id));
  }

  /**
   * Everything is in: the full bar is left to be seen for a beat, then the screen fades away.
   * From the first moment it lets every touch through to what is behind it. Resolves when it is gone.
   */
  done(): Promise<void> {
    if (this.gone) return Promise.resolve();
    this.gone = true;
    this.el.classList.add('ready');
    return new Promise((resolve) => {
      setTimeout(() => this.el.classList.add('done'), BEAT);
      setTimeout(() => { this.el.remove(); resolve(); }, BEAT + FADE);
    });
  }

  /** Something failed: say what, and offer to start again. */
  fail(cause: LoadProgress | unknown): void {
    if (this.gone) return;
    const p = isProgress(cause) ? cause : null;
    const stage = p?.error?.stage ?? null;
    const detail = p ? p.error?.message ?? '' : cause instanceof Error ? cause.message : String(cause);
    this.el.classList.add('failed');
    if (stage) this.row(stage, this.rows.size);
    let box = this.el.querySelector<HTMLElement>('.boot-error');
    if (!box) {
      box = document.createElement('div');
      box.className = 'boot-error';
      box.setAttribute('role', 'alert');
      box.innerHTML = '<b></b><span></span><button type="button">Try again</button>';
      box.querySelector('button')!.addEventListener('click', () => location.reload());
      this.log.after(box);
    }
    setText(box.querySelector('b')!, stage ? `Could not load ${inSentence(stage.label)}.` : 'Could not start.');
    setText(box.querySelector('span')!, navigator.onLine === false ? 'This device is offline.' : detail);
  }

  private row(s: Stage, position: number): void {
    let li = this.rows.get(s.id);
    if (!li) {
      li = document.createElement('li');
      li.innerHTML = '<i></i><p><b></b><span></span></p>';
      this.rows.set(s.id, li);
    }
    // (the lines stand in the order given: a line moves up when its piece finishes)
    if (this.log.children[position] !== li) this.log.insertBefore(li, this.log.children[position] ?? null);
    if (li.dataset.state !== s.state) li.dataset.state = s.state;
    setText(li.querySelector('b')!, s.label);
    setText(li.querySelector('span')!, s.note);
  }
}

/**
 * Count what is downloaded, from the browser's own record of each request (the size on the wire:
 * nothing for what it already had). Returns a function that stops the counting.
 */
export function countDownloads(p: LoadProgress): () => void {
  if (typeof PerformanceObserver === 'undefined') return () => undefined;
  const seen = (list: PerformanceObserverEntryList) => {
    for (const e of list.getEntries()) p.received((e as PerformanceResourceTiming).transferSize || 0);
  };
  try {
    const observer = new PerformanceObserver(seen);
    observer.observe({ type: 'resource', buffered: true });
    return () => observer.disconnect();
  } catch {
    return () => undefined;
  }
}

function isProgress(x: unknown): x is LoadProgress {
  return typeof x === 'object' && x !== null && 'stages' in x && 'error' in x;
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** a stage's label as it reads inside a sentence: "the Solar System", "named stars" */
function inSentence(label: string): string {
  if (label.startsWith('The ')) return `the ${label.slice(4)}`;
  if (/^(Maps of|Where) /.test(label)) return label[0].toLowerCase() + label.slice(1);
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}
