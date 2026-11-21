import { CATEGORIES, type Category, type Destination, type Picture } from '../app/destinations';
import { touchFirst } from '../core/device';
import { PRODUCT_NAME, STORAGE_PREFIX } from '../core/product';
import { ICON } from './icons';

/**
 * The interface over the view, laid out as a phone app: two chips at the top (where you are, what
 * time it is), a tab bar under the thumb, and one panel above it at a time — the card of what is
 * selected, or the sheet a tab opens (search and places to go, time, settings and help). On a wide
 * screen the tab bar stands at the left edge and the panel beside it (src/ui/styles.css).
 *
 * The Hud draws and reports; what a button does is the host's business (src/app/App.ts): it is
 * told the action's name and decides. Texts are updated in place ten times a second, never
 * rebuilt: a button being pressed must still be there when the finger lifts.
 */

/** what the interface can ask the app to do */
export type HudAction =
  | 'go' | 'centre' | 'deselect' | 'stop' | 'home'
  | 'pause' | 'faster' | 'slower' | 'reverse' | 'now'
  | 'labels' | 'orbits' | 'minor' | 'look' | 'photo' | 'screenshot'
  // board the ship (src/game/Game.ts) or leave it
  | 'ship'
  // what if (src/app/WhatIf.ts): give the selected world a moon; take away one that was made
  | 'add-moon' | 'unmake'
  // the powers (src/app/LivePhysics.ts): take the selected world away; undo everything that was changed;
  // begin or end moving it with a finger, and what it is to do where it is left
  | 'remove' | 'reality' | 'move' | 'move-keep' | 'move-circle';

export interface HudHost {
  act(action: HudAction): void;
  /** places matching what was typed */
  searchItems(query: string): Destination[];
  /** the places of a section of the Explore sheet */
  browse(category: Category): Destination[];
  /** a place was chosen from a list */
  pickDestination(id: string): void;
  /** the mass slider of the selected world was put at `slider` (src/app/Powers.ts: massFactor) */
  setMass(slider: number): void;
}

export interface HudState {
  /** where the camera is: the name of what it is at, and how high or far */
  place: string;
  placeDetail: string;
  /** the simulated time, "YYYY-MM-DD HH:MM:SS UTC" */
  date: string;
  /** how fast it runs, in words */
  rate: string;
  paused: boolean;
  reversed: boolean;
  selection: {
    key: string; name: string; detail: string; rows: [string, string][]; picture: Picture; here: boolean;
    /** what follows from those facts by the textbook, each with its working (src/app/Worked.ts) */
    worked: { label: string; text: string; math: string }[];
    /** what can be done to it (src/app/WhatIf.ts): given a moon; taken away again, if the explorer made it */
    canAddMoon: boolean;
    made: boolean;
    /**
     * Its mass, where it has a known one to change: where the slider stands, the mass and its factor
     * in words, and what the textbook predicts of a body of that mass ('' where it says nothing).
     */
    mass: { slider: number; words: string; times: string; theory: string } | null;
    /** it can be taken away (a world of the Solar System) */
    removable: boolean;
    /**
     * It can be moved with a finger, and that is under way (`on`): whether it is to be left on a
     * circle, which plane the finger moves it in and the orbit it is on now, both in words.
     */
    move: { on: boolean; circle: boolean; plane: string; orbit: string } | null;
  } | null;
  /**
   * Live physics, or null while the Solar System is the real one: since when, how fast time gets on
   * when that is slower than asked ('' otherwise), what is carried on rails ('' when nothing is),
   * what the simulation leaves out, and what has happened, newest first.
   */
  live: { since: string; slow: string; rails: string; leftOut: readonly string[]; log: { day: string; text: string }[] } | null;
  /** the destination of the flight in progress */
  flying: string | null;
  labels: boolean;
  orbits: boolean;
  minor: boolean;
  /** one finger looks around instead of orbiting */
  look: boolean;
  /** exploring, or in a mode that brings its own controls */
  mode: 'explore' | 'ship' | 'walk';
  /** a finger has been used: speak of taps, show the touch controls */
  touch: boolean;
  /** small print: frame rate, stars, the data in use */
  status: string;
}

/** the thumbnail sheet of world photographs (public/data/textures/thumbs.json) */
export interface ThumbSheet { url: string; cols: number; rows: number; bodies: Record<string, [number, number]> }

type Sheet = 'explore' | 'time' | 'more';

/** the height the selection's card takes above the tab bar, with its gap (px): its three buttons, and the powers under them */
const CARD_ROOM = 188;

const TOUCH_HELP: [string, string][] = [
  ['Drag', 'Turn round the world you are at'],
  ['Pinch', 'Zoom, all the way down to the ground'],
  ['Two-finger drag', 'Look around'],
  ['Twist', 'Roll the view'],
  ['Tap', 'Select what you tapped (its name works too)'],
  ['Double-tap', 'Fly there; on the world you are at, come closer'],
];

const KEY_HELP: [string, string][] = [
  ['Left drag', 'Look around'],
  ['Right drag / Shift+drag', 'Turn round the world you are at'],
  ['Wheel', 'Zoom (in open space: flying speed)'],
  ['W A S D  R F', 'Fly (speed scales with altitude)'],
  ['Shift / Ctrl', '×10 / ×0.1 speed'],
  ['Q / E', 'Roll'],
  ['Click · double-click', 'Select · fly there (or come closer)'],
  ['G · C', 'Go to the selection · look at it'],
  ['Enter or /', 'Search'],
  ['T', 'Tour: places worth a visit'],
  ['Space', 'Pause / resume time'],
  ['[  ]  \\', 'Slower / faster / reverse time'],
  ['Backspace', 'Real time, now'],
  ['L / O / M', 'Names / orbits / minor-body orbits'],
  ['U · P', 'Photo mode · save a picture'],
  ['Esc', 'Stop a flight / clear the selection / close a panel'],
  ['B', 'Walk on the ground (land first if high up); B again to fly'],
  ['Walking', 'W A S D move · mouse look · Shift run · Space jump · C crouch'],
  ['V', 'Spaceship: cockpit view / chase view / off'],
  ['J', 'In the ship: autopilot to the selection (flip-and-burn, never faster than light)'],
  ['In the ship', 'W/S throttle · Z/X full/cut · arrows or drag to turn · Q/E roll'],
  ['', 'A/D R/F Shift+W/S RCS · Y SAS mode · I reactionless drive · = / - its setting · [ ] time warp'],
  ['K / N', 'Missions and discoveries / ship sound'],
  ['H', 'This help'],
];

const TEMPLATE = `
  <header class="hud-top">
    <button class="chip place" type="button" data-act="home" aria-label="Where you are. Tap to look at it">
      <span class="chip-icon">${ICON.centre}</span><span class="chip-text"><b></b><small></small></span>
    </button>
    <button class="chip clock" type="button" data-tab="time" aria-label="Date and time">
      <span class="chip-text"><b></b><small></small></span>
    </button>
  </header>
  <div class="live-mark" hidden>
    <button class="live-what" type="button" data-live aria-label="Live physics: what is simulated, and what has happened">${ICON.live}<span><b>Live physics</b><small></small></span></button>
    <button class="live-back" type="button" data-act="reality">${ICON.back}<span>Back to reality</span></button>
  </div>
  <div class="hud-toast" role="status" aria-live="polite"></div>
  <div class="move-handle" hidden></div>
  <div class="hud-dock">
    <div class="hud-fabs">
      <button class="fab look-fab touch-only" type="button" data-act="look" aria-pressed="false" aria-label="What one finger does: orbit, or look around">${ICON.orbit}${ICON.look}<span></span></button>
    </div>
    <div class="hud-slot">
      <div class="hud-flight" hidden><span></span><button type="button" data-act="stop">${ICON.stop}Stop</button></div>
      <section class="sheet card" data-sheet="card" aria-label="Selected">
        <div class="card-head">
          <span class="thumb"></span>
          <div class="card-title"><h2></h2><p></p></div>
          <button class="icon-btn" type="button" data-act="deselect" aria-label="Close">${ICON.close}</button>
        </div>
        <div class="card-actions">
          <button class="btn primary" type="button" data-act="go">${ICON.go}<span>Go there</span></button>
          <button class="btn" type="button" data-act="centre">${ICON.centre}<span>Look at</span></button>
          <button class="btn" type="button" data-details aria-expanded="false">${ICON.info}<span>Details</span></button>
        </div>
        <div class="card-powers" hidden>
          <button class="power" type="button" data-power="mass" aria-expanded="false">${ICON.mass}<span>Mass</span></button>
          <button class="power" type="button" data-act="move" aria-expanded="false">${ICON.move}<span>Move</span></button>
          <button class="power" type="button" data-act="remove">${ICON.unmake}<span>Remove</span></button>
        </div>
        <div class="power-panel" data-panel="mass" hidden>
          <div class="power-read"><span><b></b><small></small></span><button type="button" data-mass-real>Real mass</button></div>
          <input class="slider" type="range" min="-3" max="3" step="0.01" value="0" aria-label="Its mass, from a thousandth of its real mass to a thousand times it"/>
          <div class="slider-ends"><span>÷ 1,000</span><span>Only its pull changes, not its size or look</span><span>× 1,000</span></div>
          <p class="theory" hidden><b>Theory predicts</b><span></span></p>
        </div>
        <div class="power-panel" data-panel="move" hidden>
          <p class="power-hint"><span class="touch-only">Put a finger on it and drag it to where you want it.</span><span class="mouse-only">Drag it to where you want it.</span> Time waits while you hold it. <span class="move-plane"></span></p>
          <div class="seg" role="group" aria-label="What it does where you leave it">
            <button type="button" data-act="move-keep" aria-pressed="true">Keeps its speed</button>
            <button type="button" data-act="move-circle" aria-pressed="false">Goes in a circle</button>
          </div>
          <p class="power-now"></p>
        </div>
        <div class="facts" hidden>
          <dl></dl>
          <div class="worked" hidden><h3>Worked out <small>tap a line to see how</small></h3><div class="worked-rows"></div></div>
          <div class="whatif" hidden>
            <h3>What if</h3>
            <button class="row" type="button" data-act="add-moon">${ICON.moon}<span class="row-text"><b>Give it a moon</b><small>A new one, on a circular orbit between you and it</small></span></button>
            <button class="row" type="button" data-act="unmake">${ICON.unmake}<span class="row-text"><b>Take it away</b><small>You made this moon: this unmakes it</small></span></button>
          </div>
        </div>
      </section>
      <section class="sheet explore" data-sheet="explore" aria-label="Search and places to go">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <label class="searchbox">${ICON.search}<input type="search" enterkeyhint="go" placeholder="Search planets, stars, galaxies…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Search"/></label>
          <button class="icon-btn cancel" type="button" data-close aria-label="Close">${ICON.close}<span>Cancel</span></button>
        </div>
        <div class="cats" role="tablist">${CATEGORIES.map(([id, label]) => `<button type="button" role="tab" data-cat="${id}">${label}</button>`).join('')}</div>
        <div class="list" role="list"></div>
      </section>
      <section class="sheet time" data-sheet="time" aria-label="Time">
        <div class="sheet-grab"></div>
        <div class="sheet-head"><h2>Time</h2><button class="icon-btn" type="button" data-close aria-label="Close">${ICON.close}</button></div>
        <div class="time-now"><div class="time-date"></div><div class="time-clock"></div><div class="time-rate"></div></div>
        <div class="transport">
          <button type="button" data-act="reverse" aria-pressed="false">${ICON.reverse}<span>Reverse</span></button>
          <button type="button" data-act="slower">${ICON.slower}<span>Slower</span></button>
          <button type="button" class="big" data-act="pause" aria-label="Pause or resume time">${ICON.pause}${ICON.play}</button>
          <button type="button" data-act="faster">${ICON.faster}<span>Faster</span></button>
          <button type="button" data-act="now">${ICON.now}<span>Now</span></button>
        </div>
        <div class="live-sheet" hidden>
          <h3>Live physics</h3>
          <p class="live-about"></p>
          <div class="live-log"></div>
          <details class="live-left"><summary><span>What the simulation leaves out</span>${ICON.chevron}</summary><ul></ul></details>
          <button class="btn" type="button" data-act="reality">${ICON.back}<span>Back to reality</span></button>
        </div>
      </section>
      <section class="sheet more" data-sheet="more" aria-label="Settings and help">
        <div class="sheet-grab"></div>
        <div class="sheet-head"><h2>${PRODUCT_NAME}</h2><button class="icon-btn" type="button" data-close aria-label="Close">${ICON.close}</button></div>
        <div class="list">
          <h3>Show</h3>
          <button class="switch" type="button" role="switch" data-act="labels" aria-checked="true"><span><b>Names</b></span><i></i></button>
          <button class="switch" type="button" role="switch" data-act="orbits" aria-checked="true"><span><b>Orbits</b></span><i></i></button>
          <button class="switch" type="button" role="switch" data-act="minor" aria-checked="false"><span><b>Orbits of asteroids and comets</b></span><i></i></button>
          <h3>Travel</h3>
          <button class="switch" type="button" role="switch" data-act="ship" aria-checked="false"><span><b>Spaceship</b><small>Physics all the way up: as fast as you like, never faster than light. Go there flies it</small></span><i></i></button>
          <h3>Camera</h3>
          <button class="switch touch-only" type="button" role="switch" data-act="look" aria-checked="false"><span><b>One finger looks around</b><small>instead of turning round the world you are at</small></span><i></i></button>
          <button class="row" type="button" data-act="photo">${ICON.photo}<span class="row-text"><b>Photo mode</b><small class="touch-only">Hides everything; tap to bring it back</small><small class="mouse-only">Hides everything; U brings it back</small></span></button>
          <button class="row" type="button" data-act="screenshot">${ICON.camera}<span class="row-text"><b>Save a picture</b><small>The view as a PNG</small></span></button>
          <button class="row" type="button" data-fullscreen hidden>${ICON.fullscreen}<span class="row-text"><b>Full screen</b><small>Without the browser around it</small></span></button>
          <h3 class="help-title">How to move</h3>
          <table class="help touch-only">${TOUCH_HELP.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
          <table class="help mouse-only">${KEY_HELP.map(([k, v]) => `<tr><th>${k ? `<kbd>${escapeHtml(k)}</kbd>` : ''}</th><td>${v}</td></tr>`).join('')}</table>
          <p class="status"></p>
        </div>
      </section>
    </div>
    <nav class="hud-tabs" aria-label="Main">
      <button type="button" data-tab="search">${ICON.search}<span>Search</span></button>
      <button type="button" data-tab="explore">${ICON.explore}<span>Explore</span></button>
      <button type="button" data-tab="time">${ICON.time}<span>Time</span></button>
      <button type="button" data-tab="more">${ICON.more}<span>More</span></button>
    </nav>
  </div>
  <div class="hud-coach" hidden>
    <div class="coach-card" role="dialog" aria-label="Getting around">
      <h2>Getting around</h2>
      <ul>
        <li><b>Drag</b> to turn round the world in front of you</li>
        <li><b>Pinch</b> to zoom, all the way down to the ground</li>
        <li><b>Two fingers</b> to look around</li>
        <li><b>Tap</b> anything to see what it is, <b>double-tap</b> to fly there</li>
      </ul>
      <button class="btn primary" type="button" data-coach>Start exploring</button>
    </div>
  </div>`;

export class Hud {
  private sheet: Sheet | null = null;
  /** the Explore sheet is being typed in: it takes the screen, above the keyboard */
  private typing = false;
  private category: Category = 'tour';
  private state: HudState | null = null;
  private selectionKey: string | null = null;
  private details = false;
  /** the selection has changed by itself: the open sheet is not to give way to its card (see `selectionMoved`) */
  private moved = false;
  /** the power whose panel is open on the card */
  private power: 'mass' | null = null;
  /** a finger is on the mass slider: where it stands is the finger's business */
  private sliding = false;
  private logKey = '';
  private leftOutKey = '';
  private thumbs: ThumbSheet | null = null;
  private toastTimer = 0;
  private coarse: boolean;
  /** the card's picture is to be drawn again (another selection, or the photographs have arrived) */
  private pictureStale = true;
  private factKeys = '';
  private factValues: HTMLElement[] = [];
  private workedKeys = '';
  private workedValues: [HTMLElement, HTMLElement][] = [];

  private readonly slot: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly slider: HTMLInputElement;
  private readonly cats: HTMLElement;
  private readonly list: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly fabs: HTMLElement;
  private readonly coach: HTMLElement;
  private readonly $: (sel: string) => HTMLElement;

  constructor(private el: HTMLElement, private host: HudHost) {
    el.innerHTML = TEMPLATE;
    // (the elements looked up here are never replaced: each is found once)
    const found = new Map<string, HTMLElement>();
    this.$ = (sel) => found.get(sel) ?? found.set(sel, el.querySelector<HTMLElement>(sel)!).get(sel)!;
    this.slot = this.$('.hud-slot');
    this.input = el.querySelector<HTMLInputElement>('.searchbox input')!;
    this.slider = el.querySelector<HTMLInputElement>('.card .slider')!;
    this.cats = this.$('.cats');
    this.list = this.$('.explore .list');
    this.toastEl = this.$('.hud-toast');
    this.fabs = this.$('.hud-fabs');
    this.coach = this.$('.hud-coach');
    // a phone or a tablet: touch wording from the start (a finger on the view says so too, see update)
    this.coarse = touchFirst();
    el.classList.toggle('touch', this.coarse);
    el.addEventListener('click', (e) => this.click(e));
    this.input.addEventListener('input', () => this.renderList());
    this.input.addEventListener('focus', () => this.setTyping(true));
    this.input.addEventListener('blur', () => { if (!this.input.value.trim()) this.setTyping(false); });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeSheet();
      if (e.key === 'Enter') {
        const first = this.list.querySelector<HTMLElement>('[data-id]');
        if (first) this.pick(first.dataset.id!);
      }
      e.stopPropagation(); // typing a name is not flying
    });
    // the mass slider reports where it is put, as it is moved
    this.slider.addEventListener('input', () => this.host.setMass(Number(this.slider.value)));
    this.slider.addEventListener('pointerdown', () => { this.sliding = true; });
    for (const done of ['pointerup', 'pointercancel', 'change', 'blur']) this.slider.addEventListener(done, () => { this.sliding = false; });
    this.slider.addEventListener('keydown', (e) => e.stopPropagation()); // (its arrow keys are its own)
    for (const s of el.querySelectorAll<HTMLElement>('.sheet')) this.swipeToClose(s);
    // full screen, where the browser offers it (an iPhone does not; there the app is added to the home screen)
    const full = this.$('[data-fullscreen]');
    full.hidden = !document.fullscreenEnabled;
    document.addEventListener('fullscreenchange', () => setText(full.querySelector('b')!, document.fullscreenElement ? 'Leave full screen' : 'Full screen'));
    this.trackKeyboard();
    this.showSlot();
  }

  get root(): HTMLElement {
    return this.el;
  }

  /** the sheet that is open, if any */
  get open(): Sheet | null {
    return this.sheet;
  }

  // ------------------------------------------------------------------ sheets
  /** Open the search field, ready to type. */
  openSearch(): void {
    this.openSheet('explore');
    this.input.value = '';
    this.renderList();
    this.input.focus();
  }

  /** Open the places to go, at a section. */
  openExplore(category?: Category): void {
    if (category) this.category = category;
    this.input.value = '';
    this.setTyping(false);
    this.openSheet('explore');
    this.renderList();
  }

  openSheet(sheet: Sheet): void {
    if (this.sheet === sheet) return;
    if (this.sheet === 'explore') this.leaveSearch();
    this.sheet = sheet;
    this.showSlot();
  }

  closeSheet(): void {
    if (!this.sheet) return;
    if (this.sheet === 'explore') this.leaveSearch();
    this.sheet = null;
    this.showSlot();
  }

  /** H: the help, in the More sheet. */
  toggleHelp(): void {
    if (this.sheet === 'more') { this.closeSheet(); return; }
    this.openSheet('more');
    this.$('.more .help-title').scrollIntoView({ block: 'start' });
  }

  /**
   * The selection is about to change without the explorer having chosen anything (what was
   * selected has become part of another body, which is selected in its place): whatever sheet is
   * open stays open. A button under a finger must not vanish because two moons collided.
   */
  selectionMoved(): void {
    this.moved = true;
  }

  /** A catalogue finished loading: what was typed may now find more. */
  refreshSearch(): void {
    if (this.sheet === 'explore') this.renderList();
  }

  /** Hide every control (the title screen, photo mode); messages still show. */
  setHidden(hidden: boolean): void {
    this.el.classList.toggle('ui-off', hidden);
  }

  /**
   * How far above the middle of the view (px) a subject sits best. Upright, the chips take the top
   * and the tab bar with the card above it take the foot of the screen: the middle of what is left.
   * In the wide layout the panels stand at the side and the middle is the middle: 0.
   */
  subjectLift(): number {
    if (getComputedStyle(this.$('.hud-dock')).flexDirection !== 'column') return 0;
    const top = this.$('.hud-top').getBoundingClientRect().bottom;
    const bottom = this.$('.hud-tabs').getBoundingClientRect().top - CARD_ROOM;
    return Math.max(0, window.innerHeight / 2 - (top + bottom) / 2);
  }

  /**
   * Where the world being moved is on the screen (px), or null when none is: a ring is drawn round
   * it, for the finger to find it by.
   */
  setHandle(at: { x: number; y: number } | null): void {
    const ring = this.$('.move-handle');
    if (!at && ring.hidden) return;
    ring.hidden = !at;
    if (at) ring.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
  }

  /** A control from elsewhere that belongs with the round buttons (the headset's "Enter VR"). */
  addFab(button: HTMLElement): void {
    this.fabs.appendChild(button);
  }

  setThumbs(sheet: ThumbSheet): void {
    this.thumbs = sheet;
    // (absolute: a relative address in a custom property is taken from the stylesheet that uses it)
    this.el.style.setProperty('--thumbs', `url("${new URL(sheet.url, document.baseURI).href}")`);
    this.el.style.setProperty('--thumbs-size', `${sheet.cols * 100}% ${sheet.rows * 100}%`);
    this.pictureStale = true;
    if (this.sheet === 'explore') this.renderList();
  }

  toast(msg: string, seconds = 2.2): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), seconds * 1000);
  }

  /** After the title screen: how to get around, once, for fingers; a line of keys otherwise. */
  welcome(touch = this.coarse): void {
    if (!touch) { this.toast('H: help · T: tour · Enter: search', 4); return; }
    if (stored('coached')) return;
    this.coach.hidden = false;
  }

  // ------------------------------------------------------------------ state
  update(s: HudState): void {
    this.state = s;
    const el = this.el;
    el.classList.toggle('touch', this.coarse || s.touch);
    el.dataset.mode = s.mode;
    setText(this.$('.place b'), s.place);
    setText(this.$('.place small'), s.placeDetail);
    const [day, clock] = splitDate(s.date);
    setText(this.$('.clock b'), `${shortDay(day)}, ${clock.slice(0, 5)}`);
    setText(this.$('.clock small'), s.paused ? 'paused' : s.rate);
    this.$('.clock').classList.toggle('paused', s.paused);
    setText(this.$('.time-date'), longDay(day));
    setText(this.$('.time-clock'), `${clock} UTC`);
    setText(this.$('.time-rate'), s.paused ? 'Paused' : s.rate === 'real time' ? 'Real time' : s.live?.slow ? `${s.rate} asked, ${s.live.slow}` : `${s.rate}`);
    this.$('.time').classList.toggle('paused', s.paused);
    this.$('.transport [data-act="reverse"]').setAttribute('aria-pressed', String(s.reversed));
    const flight = this.$('.hud-flight');
    flight.hidden = !s.flying;
    if (s.flying) setText(flight.firstElementChild as HTMLElement, `Flying to ${s.flying}`);
    for (const [name, on] of [['labels', s.labels], ['orbits', s.orbits], ['minor', s.minor], ['look', s.look], ['ship', s.mode === 'ship']] as const) {
      this.$(`.switch[data-act="${name}"]`).setAttribute('aria-checked', String(on));
    }
    this.$('.look-fab').setAttribute('aria-pressed', String(s.look));
    setText(this.$('.look-fab span'), s.look ? 'Look' : 'Orbit');
    setText(this.$('.status'), s.status);
    this.renderLive(s);
    this.renderCard(s);
    this.showSlot();
  }

  /** Live physics: the mark at the top, with the way back; in the Time sheet, what has happened and what is left out. */
  private renderLive(s: HudState): void {
    const live = s.live;
    this.el.toggleAttribute('data-live', !!live);
    this.$('.live-mark').hidden = !live;
    const sheet = this.$('.live-sheet');
    sheet.hidden = !live;
    if (!live) return;
    setText(this.$('.live-what small'), live.slow || `since ${live.since}`);
    setText(this.$('.live-about'), `Since ${live.since} everything here moves under its own gravity: each world pulls on every other, and nothing is on its catalogued path any more.${live.rails ? ` Carried on rails while time runs this fast: ${live.rails}.` : ''}`);
    const key = live.log.map((e) => `${e.day}\n${e.text}`).join('\n');
    if (key !== this.logKey) {
      this.logKey = key;
      this.$('.live-log').innerHTML = live.log.length
        ? live.log.map((e) => `<p><small>${escapeHtml(e.day)}</small>${escapeHtml(e.text)}</p>`).join('')
        : '<p class="quiet">Nothing has collided, been thrown out or been captured yet.</p>';
    }
    const left = live.leftOut.join('\n');
    if (left !== this.leftOutKey) {
      this.leftOutKey = left;
      this.$('.live-left ul').innerHTML = live.leftOut.map((t) => `<li>${escapeHtml(t)}</li>`).join('');
    }
  }

  private renderCard(s: HudState): void {
    const sel = s.selection;
    if (!sel) { this.selectionKey = null; return; }
    const card = this.$('.card');
    if (sel.key !== this.selectionKey) {
      // something new was chosen: its card takes the panel
      this.selectionKey = sel.key;
      this.details = false;
      this.power = null;
      this.pictureStale = true;
      if (!this.moved) this.closeSheet();
      this.moved = false;
      setText(card.querySelector('h2')!, sel.name);
    }
    if (this.pictureStale) {
      this.pictureStale = false;
      card.querySelector('.thumb')!.outerHTML = this.thumb(sel.picture);
    }
    setText(card.querySelector('.card-title p')!, sel.detail);
    setText(card.querySelector('[data-act="go"] span')!, sel.here ? 'Recentre' : 'Go there');
    // what can be done to it: its buttons, and the panel of the one that is open
    const powers = card.querySelector<HTMLElement>('.card-powers')!;
    powers.hidden = !sel.mass && !sel.removable;
    const massButton = powers.querySelector<HTMLElement>('[data-power="mass"]')!;
    massButton.hidden = !sel.mass;
    powers.querySelector<HTMLElement>('[data-act="remove"]')!.hidden = !sel.removable;
    const moving = sel.move?.on ?? false;
    const moveButton = powers.querySelector<HTMLElement>('[data-act="move"]')!;
    moveButton.hidden = !sel.move;
    moveButton.setAttribute('aria-expanded', String(moving));
    // (one panel at a time: moving it takes the place of its mass and of its details)
    if (!sel.mass || moving) this.power = null;
    if (moving) this.details = false;
    massButton.setAttribute('aria-expanded', String(this.power === 'mass'));
    const movePanel = card.querySelector<HTMLElement>('[data-panel="move"]')!;
    movePanel.hidden = !moving;
    if (sel.move && moving) {
      setText(movePanel.querySelector('.move-plane')!, sel.move.plane);
      setText(movePanel.querySelector('.power-now')!, sel.move.orbit);
      movePanel.querySelector('[data-act="move-keep"]')!.setAttribute('aria-pressed', String(!sel.move.circle));
      movePanel.querySelector('[data-act="move-circle"]')!.setAttribute('aria-pressed', String(sel.move.circle));
    }
    const panel = card.querySelector<HTMLElement>('[data-panel="mass"]')!;
    panel.hidden = this.power !== 'mass';
    if (sel.mass && this.power === 'mass') {
      setText(panel.querySelector('.power-read b')!, sel.mass.words);
      setText(panel.querySelector('.power-read small')!, sel.mass.times);
      if (!this.sliding && Math.abs(Number(this.slider.value) - sel.mass.slider) > 0.004) this.slider.value = String(sel.mass.slider);
      const theory = panel.querySelector<HTMLElement>('.theory')!;
      theory.hidden = !sel.mass.theory;
      setText(theory.querySelector('span')!, sel.mass.theory);
    }
    const facts = card.querySelector<HTMLElement>('.facts')!;
    facts.hidden = !this.details;
    card.querySelector('[data-details]')!.setAttribute('aria-expanded', String(this.details));
    if (!this.details) return;
    // the facts: rebuilt when their headings change, otherwise only the values are refreshed
    const keys = sel.rows.map((r) => r[0]).join('\n');
    if (keys !== this.factKeys) {
      this.factKeys = keys;
      const list = facts.querySelector('dl')!;
      list.innerHTML = sel.rows.map(([k]) => `<div><dt>${escapeHtml(k)}</dt><dd></dd></div>`).join('');
      this.factValues = [...list.querySelectorAll<HTMLElement>('dd')];
    }
    sel.rows.forEach((r, i) => setText(this.factValues[i], r[1]));
    // what is worked out from them: a line each, which opens to show its working (and stays open while the numbers move)
    const worked = facts.querySelector<HTMLElement>('.worked')!;
    worked.hidden = sel.worked.length === 0;
    const labels = sel.worked.map((w) => w.label).join('\n');
    if (labels !== this.workedKeys) {
      this.workedKeys = labels;
      const rows = worked.querySelector('.worked-rows')!;
      rows.innerHTML = sel.worked.map((w) => `<details><summary><span>${escapeHtml(w.label)}</span><b></b>${ICON.chevron}</summary><code></code></details>`).join('');
      this.workedValues = [...rows.querySelectorAll<HTMLElement>('details')].map((d) => [d.querySelector('b')!, d.querySelector('code')!]);
    }
    sel.worked.forEach((w, i) => { setText(this.workedValues[i][0], w.text); setText(this.workedValues[i][1], w.math); });
    // what can be done to it
    const whatif = facts.querySelector<HTMLElement>('.whatif')!;
    whatif.hidden = !sel.canAddMoon && !sel.made;
    whatif.querySelector<HTMLElement>('[data-act="add-moon"]')!.hidden = !sel.canAddMoon;
    whatif.querySelector<HTMLElement>('[data-act="unmake"]')!.hidden = !sel.made;
  }

  /** One panel at a time: the open sheet, else the card of the selection. */
  private showSlot(): void {
    const show = this.sheet ?? (this.state?.selection ? 'card' : null);
    for (const s of this.slot.children) s.classList.toggle('on', (s as HTMLElement).dataset.sheet === show);
    this.el.dataset.sheet = show ?? 'none';
    const tab = this.sheet === 'explore' ? (this.typing ? 'search' : 'explore') : this.sheet;
    for (const b of this.el.querySelectorAll<HTMLElement>('.hud-tabs [data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  }

  // ------------------------------------------------------------------ lists
  /** The Explore sheet's list: what matches the text typed, or the chosen section. */
  private renderList(): void {
    const q = this.input.value.trim();
    this.cats.hidden = q !== '';
    for (const b of this.cats.children) {
      const on = (b as HTMLElement).dataset.cat === this.category;
      b.setAttribute('aria-selected', String(on));
      // (the chosen section stays in sight in the row of sections)
      if (on && !q) this.cats.scrollTo({ left: (b as HTMLElement).offsetLeft - (this.cats.clientWidth - (b as HTMLElement).offsetWidth) / 2 });
    }
    const items = q ? this.host.searchItems(q) : this.host.browse(this.category);
    this.list.innerHTML = items.length
      ? items.map((d) => `<button class="row" type="button" role="listitem" data-id="${escapeHtml(d.id)}">${this.thumb(d.picture)}<span class="row-text"><b>${escapeHtml(d.label)}</b><small>${escapeHtml(d.detail)}</small></span>${ICON.chevron}</button>`).join('')
      : `<p class="empty">${q ? 'Nothing by that name' : 'Loading…'}</p>`;
    this.list.scrollTop = 0;
  }

  /** A destination's picture: a world's photograph, or a shape in its colour. */
  private thumb(p?: Picture): string {
    if (!p) return '<span class="thumb plain"></span>';
    const cell = p.world ? this.thumbs?.bodies[p.world] : undefined;
    if (cell && this.thumbs) {
      const { cols, rows } = this.thumbs;
      return `<span class="thumb photo" style="background-position:${(cell[0] / (cols - 1)) * 100}% ${(cell[1] / (rows - 1)) * 100}%"></span>`;
    }
    const c = (k: number) => `rgb(${p.tint.map((v) => Math.round(255 * Math.min(1, v * k))).join(' ')})`;
    return `<span class="thumb ${p.shape}" style="--lit:${c(1.25)};--tint:${c(1)};--dark:${c(0.18)}"></span>`;
  }

  private pick(id: string): void {
    this.closeSheet();
    this.host.pickDestination(id);
  }

  // ------------------------------------------------------------------ input
  private click(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('button');
    if (!b || !this.el.contains(b)) return;
    // a button pressed with a pointer does not keep the keyboard: Space is "pause", not "press again"
    if (e.detail > 0) b.blur();
    const d = b.dataset;
    if (d.id !== undefined) this.pick(d.id);
    else if (d.cat) { this.category = d.cat as Category; this.renderList(); }
    else if (d.tab) this.tab(d.tab);
    else if ('close' in d) this.closeSheet();
    else if ('details' in d) { this.endMove(); this.details = !this.details; this.power = null; if (this.state) this.renderCard(this.state); }
    else if (d.power) { this.endMove(); this.power = this.power === d.power ? null : 'mass'; this.details = false; if (this.state) this.renderCard(this.state); }
    else if ('massReal' in d) { this.slider.value = '0'; this.host.setMass(0); }
    else if ('live' in d) { this.openSheet('time'); this.$('.live-sheet').scrollIntoView({ block: 'start' }); }
    else if ('coach' in d) { this.coach.hidden = true; store('coached'); }
    else if ('fullscreen' in d) void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => this.toast('Full screen is not available here'));
    else if (d.act) {
      if (d.act === 'photo' || d.act === 'ship') this.closeSheet(); // (nothing is left open behind the picture, or the cockpit)
      this.host.act(d.act as HudAction);
    }
  }

  /** Another panel of the card is opened: if the world was being moved, that is over. */
  private endMove(): void {
    if (this.state?.selection?.move?.on) this.host.act('move');
  }

  private tab(name: string): void {
    if (name === 'search') {
      if (this.sheet === 'explore' && this.typing) this.closeSheet();
      else this.openSearch();
    } else if (name === 'explore') {
      if (this.sheet === 'explore' && !this.typing) this.closeSheet();
      else this.openExplore();
    } else if (this.sheet === name) this.closeSheet();
    else this.openSheet(name as Sheet);
  }

  private setTyping(on: boolean): void {
    if (this.typing === on) return;
    this.typing = on;
    this.$('.explore').classList.toggle('typing', on);
    this.showSlot();
  }

  private leaveSearch(): void {
    this.input.blur();
    this.input.value = '';
    this.setTyping(false);
  }

  /** A sheet is pulled down by its handle or its heading to close it. */
  private swipeToClose(sheet: HTMLElement): void {
    const handles = sheet.querySelectorAll<HTMLElement>('.sheet-grab, .sheet-head h2');
    let y0 = 0, id = -1;
    const end = (close: boolean) => {
      id = -1;
      sheet.style.transform = '';
      sheet.style.transition = '';
      if (close) this.closeSheet();
    };
    for (const h of handles) {
      h.addEventListener('pointerdown', (e) => { id = e.pointerId; y0 = e.clientY; h.setPointerCapture(id); sheet.style.transition = 'none'; });
      h.addEventListener('pointermove', (e) => { if (e.pointerId === id) sheet.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
      h.addEventListener('pointerup', (e) => { if (e.pointerId === id) end(e.clientY - y0 > 60); });
      h.addEventListener('pointercancel', () => end(false));
    }
  }

  /** The on-screen keyboard covers the bottom of the page: the search sheet is sized to what is left above it. */
  private trackKeyboard(): void {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const fit = () => this.el.style.setProperty('--visible-height', `${vv.height}px`);
    vv.addEventListener('resize', fit);
    fit();
  }
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** "YYYY-MM-DD HH:MM:SS UTC" -> the day and the time of day */
function splitDate(date: string): [string, string] {
  const i = date.indexOf(' ');
  return [date.slice(0, i), date.slice(i + 1).replace(' UTC', '')];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-10-01" -> "1 October 2026" (years before 1 keep their sign: "-0500" -> "-500") */
function longDay(day: string, months = MONTHS): string {
  const m = /^(-?\d+)-(\d\d)-(\d\d)$/.exec(day);
  if (!m) return day;
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? m[2]} ${Number(m[1])}`;
}

function shortDay(day: string): string {
  return longDay(day, MONTHS.map((n) => n.slice(0, 3)));
}

function stored(key: string): boolean {
  try { return localStorage.getItem(`${STORAGE_PREFIX}-${key}`) === '1'; } catch { return false; }
}

function store(key: string): void {
  try { localStorage.setItem(`${STORAGE_PREFIX}-${key}`, '1'); } catch { /* private browsing: shown again next time */ }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
