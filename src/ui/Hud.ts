import { CATEGORIES, type Category, type Destination, type Picture } from '../app/destinations';
import { type Box, isClear, largestClear, worth } from '../core/clearArea';
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
  // board the ship (src/game/Game.ts) or leave it; board it and fly to the selection in it
  | 'ship' | 'ship-go'
  // back to today's date; back to the title screen
  | 'today' | 'menu'
  // night at a place: on to its sunrise; land and walk here (src/app/Walk.ts); fly freely by touch, or stop (src/app/FreeFly.ts)
  | 'sunrise' | 'walk' | 'free'
  // what if (src/app/WhatIf.ts): give the selected world a moon; the selected star a planet like the Earth, one like Jupiter, another sun
  | 'add-moon' | 'add-earth' | 'add-jupiter' | 'add-sun'
  // the powers (src/app/LivePhysics.ts): take the selected world away; undo everything that was changed;
  // begin or end moving it with a finger, and what it is to do where it is left (or throw it); a world just made is in place
  | 'remove' | 'reality' | 'move' | 'move-keep' | 'move-circle' | 'move-throw' | 'place-done'
  // undo the last change; watching what a change does (src/app/Watch.ts): stop, watch it again, put the offer away;
  // whether changes are watched at all
  | 'undo' | 'watch-stop' | 'replay' | 'watch-close' | 'show-me';

export interface HudHost {
  act(action: HudAction): void;
  /** places matching what was typed */
  searchItems(query: string): Destination[];
  /** the places of a section of the Explore sheet */
  browse(category: Category): Destination[];
  /** a place was chosen from a list */
  pickDestination(id: string, from?: Category): void;
  /** the mass slider of the selected world was put at `slider` (src/app/Powers.ts: massFactor) */
  setMass(slider: number): void;
  /** a finger (or the pointer) came down on the mass slider, or lifted (or the slider was left): all between is one change */
  massHeld(held: boolean): void;
  /** the mass slider of a world just made, being put in place, was put at `s` (0 to 1; src/app/WhatIf.ts: madeMassAt) */
  setMadeMass(s: number): void;
}

/** The slingshot's arrow over the view (src/app/Mover.ts: Aim): where the world is and its edge, the way and length of the arrow, and its marks (CSS px). */
export interface AimView {
  x: number; y: number; edge: number;
  ux: number; uy: number; length: number;
  circle: number; escape: number;
  snapped: 'circle' | 'escape' | null;
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
    /** what can be added to it (src/app/WhatIf.ts); nothing: an empty list */
    add: readonly ('moon' | 'earth' | 'jupiter' | 'sun')[];
    /**
     * Its mass, where it has a known one to change: where the slider stands, the mass and its factor
     * in words, and what the textbook predicts of a body of that mass ('' where it says nothing).
     */
    mass: { slider: number; words: string; times: string; theory: string } | null;
    /** it can be taken away (a world of the Solar System) */
    removable: boolean;
    /**
     * It can be moved with a finger, and that is under way (`on`): what it does where it is left
     * (keeps its speed, goes in a circle, or is thrown), whether it has just been made and is being
     * put in place, which plane the finger moves it in and the orbit it is on now, both in words.
     */
    move: { on: boolean; how: 'keep' | 'circle' | 'throw'; placing: boolean; plane: string; orbit: string } | null;
    /** It has just been made and is being put in place: where its mass slider stands (0 to 1), its mass and what it is at that mass, in words. */
    place: { slider: number; mass: string; what: string } | null;
  } | null;
  /**
   * Live physics, or null while the Solar System is the real one: since when, what the mark at the
   * top says under its name (short: a phone's width), how fast time gets on when that is slower
   * than asked ('' otherwise), what is carried on rails ('' when nothing is), what the simulation
   * leaves out, and what has happened, newest first.
   */
  live: { since: string; mark: string; slow: string; rails: string; leftOut: readonly string[]; log: { day: string; text: string }[] } | null;
  /** the last change can be undone */
  undo: boolean;
  /** the real Solar System has just come back (Back to reality, or its first change undone): Undo is offered at the top for a moment */
  realAgain: boolean;
  /**
   * Watching what a change does (src/app/Watch.ts): what the chip says, whether the watch is over,
   * and if so whether it can be watched again (Replay). Null: no watch, nothing offered.
   */
  watch: { text: string; ended: boolean; replay?: boolean } | null;
  /** changes are watched: time speeds up and the camera frames what follows (the switch in More) */
  showMe: boolean;
  /** the destination of the flight in progress */
  flying: string | null;
  labels: boolean;
  orbits: boolean;
  minor: boolean;
  /** one finger looks around instead of orbiting */
  look: boolean;
  /** flying freely by touch: a stick, Up and Down over the view (src/app/FreeFly.ts) */
  free?: boolean;
  /** exploring, or in a mode that brings its own controls */
  mode: 'explore' | 'ship' | 'walk';
  /** a finger has been used: speak of taps, show the touch controls */
  touch: boolean;
  /**
   * In the ship (src/game/Flight.ts, timeReport): its time warp is its own clock's, measured as it
   * runs: the chip's words, the rates and clocks for the Time sheet, and why the warp is not what
   * was asked ('' when it is). Null outside the ship.
   */
  ship?: { chip: string; rows: [string, string][]; why: string } | null;
  /** the missions (src/game/Missions.ts): how many are done, and each with whether it is */
  missions?: { done: number; total: number; items: { title: string; detail: string; done: boolean }[] } | null;
  /** the date shown is far from today's: the words of the way back ('' when it is today, or cannot go back) */
  today?: string;
  /** there is ground below to land and walk on (a touch screen shows a Walk button) */
  canWalk?: boolean;
  /** small print: frame rate, stars, the data in use */
  status: string;
}

/** the thumbnail sheet of world photographs (public/data/textures/thumbs.json) */
export interface ThumbSheet { url: string; cols: number; rows: number; bodies: Record<string, [number, number]> }

/** (`flight`: the ship's full read-out, opened from its instruments on a touch screen) */
type Sheet = 'explore' | 'time' | 'more' | 'flight';

/** the height the selection's card takes above the tab bar, with its gap (px): its three buttons, and the powers under them */
const CARD_ROOM = 196;
/** a watch is given at least this share of an upright view's height: an open panel of the card folds away for it (makeRoom) */
const FOLD_BELOW = 0.4;
/** the clear part of the view: room kept round each part of the interface (px, as markers keep it), the least size worth holding a marker, how wide a rectangle is worth against its height, how much better a new one must be to take over, and the farthest its middle may be from the view's (of the view's size) */
const CLEAR_PAD = 4;
const CLEAR_MIN_W = 112;
const CLEAR_MIN_H = 96;
const CLEAR_STAY = 1.25;
const CLEAR_WIDE = 1.6;
const CLEAR_SHIFT = 0.3;
/** the keys a range input moves by (they are the mass slider's while it has the focus; the rest stay shortcuts) */
const SLIDER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

const TOUCH_HELP: [string, string][] = [
  ['Drag', 'Turn round the world you are at'],
  ['Pinch', 'Zoom, all the way down to the ground'],
  ['Two-finger drag', 'Look around'],
  ['Twist', 'Roll the view'],
  ['Tap', 'Select what you tapped (its name works too)'],
  ['Double-tap', 'Fly there; on the world you are at, come closer'],
  ['Fly freely', 'More turns it on: the stick under the left thumb moves you (all the way: ten times faster), Up and Down, drag to look; Done puts it away'],
  ['In the ship', 'Drag to turn it (a twist rolls it, a pinch zooms) · the lever is the thrust · Assist sets what the nose holds to (a list of modes) · RCS opens the side thrusters (held to push) · Stop brakes to rest · Chase / Cockpit switches the view · tap the instruments for all of them'],
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
  ['Ctrl+Z', 'Undo the last change to a world'],
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
    <button class="live-undo" type="button" data-act="undo" aria-label="Undo the last change">${ICON.undo}<span>Undo</span></button>
    <button class="live-back" type="button" data-act="reality">${ICON.back}<span>Back to reality</span></button>
  </div>
  <div class="hud-toast" role="status" aria-live="polite"></div>
  <div class="move-handle" hidden></div>
  <svg class="aim" hidden aria-hidden="true">
    <line class="aim-guide"/><line class="aim-shaft"/><path class="aim-head"/>
    <g class="aim-mark" data-mark="circle"><line/><text>circle</text></g>
    <g class="aim-mark" data-mark="escape"><line/><text>escape</text></g>
  </svg>
  <div class="hud-dock">
    <div class="hud-fabs">
      <button class="fab look-fab touch-only" type="button" data-act="look" aria-pressed="false" aria-label="What dragging one finger does now: turn round the world, or look around. Tap to change">${ICON.orbit}${ICON.look}<span></span></button>
      <button class="fab ship-fab" type="button" data-act="ship-go">${ICON.ship}<span>Your ship</span></button>
      <button class="fab walk-fab touch-only" type="button" data-act="walk" hidden>${ICON.walk}<span>Land and walk</span></button>
    </div>
    <div class="hud-slot">
      <div class="hud-notice" role="status" hidden><span></span><button class="notice-act" type="button"></button><button class="icon-btn" type="button" data-notice-close aria-label="Close">${ICON.close}</button></div>
      <div class="hud-flight" hidden><span></span><button type="button" data-act="stop">${ICON.stop}Stop</button></div>
      <div class="hud-watch" role="status" hidden>
        <span class="watch-text"></span>
        <button class="watch-stop" type="button" data-act="watch-stop">${ICON.stop}Stop</button>
        <button class="watch-replay" type="button" data-act="replay">${ICON.replay}Replay</button>
        <button class="watch-close" type="button" data-act="watch-close" aria-label="Close">${ICON.close}</button>
      </div>
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
          <button class="power" type="button" data-power="add" aria-expanded="false">${ICON.add}<span>Add</span></button>
          <button class="power" type="button" data-act="remove">${ICON.unmake}<span>Remove</span></button>
        </div>
        <div class="power-panel" data-panel="mass" hidden>
          <div class="power-read"><span><b></b><small></small></span><button type="button" data-mass-real>Real mass</button></div>
          <input class="slider" type="range" min="-3" max="3" step="0.01" value="0" aria-label="Its mass, from a thousandth of its real mass to a thousand times it"/>
          <div class="slider-ends"><span>÷ 1,000</span><span>Only its pull changes, not its size or look</span><span>× 1,000</span></div>
          <p class="theory" hidden><b>Theory predicts</b><span></span></p>
        </div>
        <div class="power-panel" data-panel="move" hidden>
          <div class="placing" hidden>
            <div class="power-read"><span><b></b><small></small></span><button class="place-done" type="button" data-act="place-done">Done</button></div>
            <input class="slider" type="range" min="0" max="1" step="0.001" value="0.5" aria-label="Its mass"/>
          </div>
          <p class="power-hint">
            <span class="hint-move"><span class="touch-only">Put a finger on it and drag it to where you want it.</span><span class="mouse-only">Drag it to where you want it.</span> Time waits while you hold it.</span>
            <span class="hint-throw"><span class="touch-only">Pull back from it and let go, like a slingshot, or flick it.</span><span class="mouse-only">Drag back from it and let go, like a slingshot, or flick it.</span> The arrow's marks: going round in a circle, and escaping.</span>
            <span class="hint-place">Drag it to where you want it: let go and it goes round in a circle there, or flick it to throw it. Time waits until Done.</span>
            <span class="move-plane"></span>
          </p>
          <div class="seg" role="group" aria-label="What it does where you leave it">
            <button type="button" data-act="move-keep" aria-pressed="true">Keeps its speed</button>
            <button type="button" data-act="move-circle" aria-pressed="false">Goes in a circle</button>
            <button type="button" data-act="move-throw" aria-pressed="false">Throw</button>
          </div>
          <p class="power-now"></p>
        </div>
        <div class="power-panel" data-panel="add" hidden>
          <button class="row" type="button" data-act="add-moon">${ICON.moon}<span class="row-text"><b>A moon</b><small>A new one, on a circle round it, between you and it</small></span></button>
          <button class="row" type="button" data-act="add-earth">${ICON.rocky}<span class="row-text"><b>A planet like Earth</b><small>Its size and mass, on a circle round this star</small></span></button>
          <button class="row" type="button" data-act="add-jupiter">${ICON.giant}<span class="row-text"><b>A planet like Jupiter</b><small>318 Earths: heavy enough to throw worlds out</small></span></button>
          <button class="row" type="button" data-act="add-sun">${ICON.sun}<span class="row-text"><b>A second sun</b><small>A star like the Sun: they go round each other</small></span></button>
          <p class="power-hint">It starts between you and this world, with time waiting: put it where you want it, give it the mass you want, then Done. After that it is moved, made heavier and removed like any other.</p>
        </div>
        <div class="facts" hidden>
          <dl></dl>
          <div class="worked" hidden><h3>Worked out <small>tap a line to see how</small></h3><div class="worked-rows"></div></div>
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
        <button class="btn time-today" type="button" data-act="today" hidden>${ICON.now}<span>Back to today</span></button>
        <div class="ship-time" hidden><dl></dl><p></p></div>
        <div class="live-sheet" hidden>
          <h3>Live physics</h3>
          <div class="live-ways">
            <button class="btn" type="button" data-act="undo">${ICON.undo}<span>Undo</span></button>
            <button class="btn" type="button" data-act="reality">${ICON.back}<span>Back to reality</span></button>
          </div>
          <p class="live-about"></p>
          <div class="live-log"></div>
          <details class="live-left"><summary><span>What the simulation leaves out</span>${ICON.chevron}</summary><ul></ul></details>
        </div>
        <div class="transport">
          <button type="button" data-act="reverse" aria-pressed="false">${ICON.reverse}<span>Reverse</span></button>
          <button type="button" data-act="slower">${ICON.slower}<span>Slower</span></button>
          <button type="button" class="big" data-act="pause" aria-label="Pause or resume time">${ICON.pause}${ICON.play}</button>
          <button type="button" data-act="faster">${ICON.faster}<span>Faster</span></button>
          <button type="button" data-act="now">${ICON.now}<span>Now</span></button>
        </div>
      </section>
      <section class="sheet flight" data-sheet="flight" aria-label="The ship's instruments">
        <div class="sheet-grab"></div>
        <div class="sheet-head"><h2>Instruments</h2><button class="icon-btn" type="button" data-close aria-label="Close">${ICON.close}</button></div>
        <div class="flight-body"></div>
      </section>
      <section class="sheet more" data-sheet="more" aria-label="Settings and help">
        <div class="sheet-grab"></div>
        <div class="sheet-head"><h2>${PRODUCT_NAME}</h2><button class="icon-btn" type="button" data-close aria-label="Close">${ICON.close}</button></div>
        <div class="list">
          <button class="row" type="button" data-help>${ICON.help}<span class="row-text"><b>How to move</b><small class="touch-only">Every touch, in the ship too</small><small class="mouse-only">Every key and click</small></span>${ICON.chevron}</button>
          <details class="missions"><summary>${ICON.flag}<span class="row-text"><b>Missions</b><small></small></span>${ICON.chevron}</summary><ul></ul></details>
          <button class="row" type="button" data-act="menu">${ICON.menu}<span class="row-text"><b>Start menu</b><small>Back to the title screen</small></span>${ICON.chevron}</button>
          <h3>Show</h3>
          <button class="switch" type="button" role="switch" data-act="labels" aria-checked="true"><span><b>Names</b></span><i></i></button>
          <button class="switch" type="button" role="switch" data-act="orbits" aria-checked="true"><span><b>Orbits</b></span><i></i></button>
          <button class="switch" type="button" role="switch" data-act="minor" aria-checked="false"><span><b>Orbits of asteroids and comets</b></span><i></i></button>
          <button class="switch" type="button" role="switch" data-act="show-me" aria-checked="true"><span><b>Show me what happens</b><small>After you change a world, time speeds up for a while and the view frames what follows</small></span><i></i></button>
          <h3>Travel</h3>
          <button class="switch" type="button" role="switch" data-act="ship" aria-checked="false"><span><b>Spaceship</b><small>Physics all the way up: as fast as you like, never faster than light. Go there flies it</small></span><i></i></button>
          <h3>Camera</h3>
          <button class="switch touch-only" type="button" role="switch" data-act="free" aria-checked="false"><span><b>Fly freely</b><small>A stick moves you, Up and Down, drag to look: the keys' flight without a keyboard</small></span><i></i></button>
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
  /** the selection whose facts were last shown */
  private factsKey: string | null = null;
  private details = false;
  /** the selection has changed by itself: the open sheet is not to give way to its card (see `selectionMoved`) */
  private moved = false;
  /** the power whose panel is open on the card */
  private power: 'mass' | 'add' | null = null;
  /** a finger is on the mass slider (or on the one of a world being put in place): where it stands is the finger's business */
  private sliding = false;
  private placeSliding = false;
  /** what the slingshot's arrow was last drawn as */
  private aimKey = '';
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
  private readonly placeSlider: HTMLInputElement;
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
    this.slider = el.querySelector<HTMLInputElement>('.card [data-panel="mass"] .slider')!;
    this.placeSlider = el.querySelector<HTMLInputElement>('.card .placing .slider')!;
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
    // the mass slider reports where it is put, as it is moved, and when a finger comes down on it and lifts (one change, to undo and to watch)
    this.slider.addEventListener('input', () => this.host.setMass(Number(this.slider.value)));
    this.slider.addEventListener('pointerdown', () => { this.sliding = true; this.host.massHeld(true); });
    for (const done of ['pointerup', 'pointercancel', 'change', 'blur']) this.slider.addEventListener(done, () => { this.sliding = false; });
    // (not on 'change': a key press changes it too, and a run of them is one change, which the app ends after a pause)
    for (const done of ['pointerup', 'pointercancel', 'blur']) this.slider.addEventListener(done, () => this.host.massHeld(false));
    // (the keys that move a slider are its own; every other key is still a shortcut while it has the focus)
    this.slider.addEventListener('keydown', (e) => { if (SLIDER_KEYS.has(e.key)) e.stopPropagation(); });
    // the mass of a world being put in place: part of its making, until Done
    this.placeSlider.addEventListener('input', () => this.host.setMadeMass(Number(this.placeSlider.value)));
    this.placeSlider.addEventListener('pointerdown', () => { this.placeSliding = true; });
    for (const done of ['pointerup', 'pointercancel', 'change', 'blur']) this.placeSlider.addEventListener(done, () => { this.placeSliding = false; });
    this.placeSlider.addEventListener('keydown', (e) => { if (SLIDER_KEYS.has(e.key)) e.stopPropagation(); });
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

  /**
   * The parts of the interface that stand over the view (the chips, the tab bar, the open card or
   * sheet, the round buttons, the chip of a flight or of a watch, and whatever else is marked
   * `data-cover`, as the ship's instruments are): no name of the sky is to be drawn under them
   * (src/render/Labels.ts). Measured at most five times a second; none in photo mode.
   */
  covers(): readonly { l: number; t: number; r: number; b: number }[] {
    const now = performance.now();
    if (now - this.coversAt < 200) return this.coverBoxes;
    this.coversAt = now;
    if (this.el.classList.contains('ui-off')) return (this.coverBoxes = []);
    const sel = '.hud-top .chip, .hud-tabs, .hud-slot > .on, .hud-flight:not([hidden]), .hud-watch:not([hidden]), .live-mark:not([hidden]), .hud-fabs > *, [data-cover]';
    const root = this.el.getBoundingClientRect();
    this.coverBoxes = [...this.el.querySelectorAll<HTMLElement>(sel)].map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ l: r.left - root.left, t: r.top - root.top, r: r.right - root.left, b: r.bottom - root.top }));
    return this.coverBoxes;
  }
  private coversAt = -1e9;
  private coverBoxes: readonly { l: number; t: number; r: number; b: number }[] = [];

  /**
   * The part of the view the interface leaves clear: the widest clear rectangle among the parts of
   * the interface that cover the view (`covers`), room enough for a marker in it (null in photo mode,
   * or where nothing is). One that has been chosen is kept until a clearly better one appears, so a
   * chip growing a few pixels does not move anything. The edge pointer of the ship's target is
   * pinned in it (src/game/Game.ts).
   *
   * And, on a phone held on its side, where its middle is from the middle of the view (`x`, `y`: CSS
   * px, to the right and down): the camera holds what it is aimed at there (src/app/App.ts, `centre`),
   * as a map app pads its view by the card that stands over it (`shifts`: that is so). Upright the
   * middle is clear and the subject is lifted by `subjectLift`; with a mouse the view is as it was:
   * 0, 0.
   */
  clearPart(): { box: Box; x: number; y: number; shifts: boolean } | null {
    const boxes = this.covers();
    if (boxes === this.clearFor) return this.clearNow;
    this.clearFor = boxes;
    const root = this.el.getBoundingClientRect();
    const W = root.width, H = root.height;
    let found: Box | null = null;
    if (boxes.length > 0 && W > 0 && H > 0) {
      found = largestClear(W, H, boxes, CLEAR_PAD, CLEAR_MIN_W, CLEAR_MIN_H, CLEAR_WIDE);
      const was = this.clearBox;
      if (found && was && isClear(was, boxes, CLEAR_PAD) && worth(found, CLEAR_WIDE) < CLEAR_STAY * worth(was, CLEAR_WIDE)) found = was;
    }
    this.clearBox = found;
    const shifts = !!found && (this.coarse || !!this.state?.touch) && W > H && getComputedStyle(this.$('.hud-dock')).flexDirection !== 'column';
    // (not so far off the middle that the view is stretched out of shape at its other side)
    const x = found && shifts ? Math.max(-CLEAR_SHIFT * W, Math.min(CLEAR_SHIFT * W, (found.l + found.r) / 2 - W / 2)) : 0;
    const y = found && shifts ? Math.max(-CLEAR_SHIFT * H, Math.min(CLEAR_SHIFT * H, (found.t + found.b) / 2 - H / 2)) : 0;
    return (this.clearNow = found ? { box: found, x, y, shifts } : null);
  }
  private clearFor: readonly Box[] | null = null;
  private clearBox: Box | null = null;
  private clearNow: { box: Box; x: number; y: number; shifts: boolean } | null = null;

  /** where the ship's full read-out goes on a touch screen (src/game/FlightHud.ts fills it) */
  get flightBody(): HTMLElement {
    return this.$('.flight-body');
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
   * Room for watching what a change does: where the card with a power's panel or the details open
   * would leave less than FOLD_BELOW of an upright view's height clear, or does not fit beside a
   * wide view with the chip above it (a phone on its side), the panel folds away (the card keeps
   * its buttons; one tap opens it again). Moving a world keeps its panel: the finger is still at
   * work on it.
   */
  makeRoom(): void {
    if (this.power === null && !this.details) return;
    const card = this.$('.card');
    const cramped = getComputedStyle(this.$('.hud-dock')).flexDirection === 'column'
      ? this.freeArea().bottom - this.freeArea().top < FOLD_BELOW * window.innerHeight
      : card.scrollHeight > card.clientHeight + 1;
    if (!cramped) return;
    this.power = null;
    this.details = false;
    if (this.state) this.renderCard(this.state);
  }

  /**
   * The part of the view the interface leaves clear as it stands now (CSS px from the view's
   * top-left corner), for a frame to fit in: below the chips and the mark of live physics, and
   * above the panel and the tab bar (beside them, where they stand at the left of a wide view),
   * with a margin. The whole view if what is left is too small to frame anything in.
   */
  freeArea(): { left: number; top: number; right: number; bottom: number } {
    const W = window.innerWidth, H = window.innerHeight, MARGIN = 8;
    const box = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };
    let top = 0, left = 0, bottom = H;
    for (const el of [this.$('.hud-top'), this.$('.live-mark')]) {
      const r = (el as HTMLElement).hidden ? null : box(el);
      if (r && r.top < H / 2) top = Math.max(top, r.bottom);
    }
    const row = getComputedStyle(this.$('.hud-dock')).flexDirection !== 'column';
    for (const el of [...this.slot.children, this.$('.hud-tabs')]) {
      const r = box(el);
      if (!r) continue;
      if (row) left = Math.max(left, r.right);
      else bottom = Math.min(bottom, r.top);
    }
    const free = { left: left + MARGIN, top: top + MARGIN, right: W - MARGIN, bottom: bottom - MARGIN };
    return free.right - free.left > 120 && free.bottom - free.top > 120 ? free : { left: 0, top: 0, right: W, bottom: H };
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

  /**
   * The slingshot's arrow (null: none is being pulled): from the edge of the world being thrown,
   * the way it will go, as long as the throw is fast; behind it, faint, the rest of the way to the
   * marks of a circle and of escape, the one the throw is exactly lit.
   */
  setAim(aim: AimView | null): void {
    const svg = this.$('.aim');
    const draw = !!aim && aim.length > 0;
    const key = draw ? [aim.x, aim.y, aim.edge, aim.ux, aim.uy, aim.length].map((v) => v.toFixed(1)).join() + aim.snapped : '';
    if (key === this.aimKey) return;
    this.aimKey = key;
    svg.toggleAttribute('hidden', !draw);
    if (!draw) return;
    const { ux, uy } = aim, nx = -uy, ny = ux;
    const x0 = aim.x + ux * aim.edge, y0 = aim.y + uy * aim.edge, at = (d: number) => [x0 + ux * d, y0 + uy * d];
    const line = (el: Element, a: number[], b: number[]) => { el.setAttribute('x1', a[0].toFixed(1)); el.setAttribute('y1', a[1].toFixed(1)); el.setAttribute('x2', b[0].toFixed(1)); el.setAttribute('y2', b[1].toFixed(1)); };
    line(svg.querySelector('.aim-guide')!, at(0), at(Math.max(aim.length, aim.escape) + 24));
    const tip = at(aim.length), HEAD = 12;
    line(svg.querySelector('.aim-shaft')!, at(0), at(Math.max(0, aim.length - HEAD)));
    svg.querySelector('.aim-head')!.setAttribute('d', `M${tip[0].toFixed(1)},${tip[1].toFixed(1)} L${(tip[0] - ux * HEAD + nx * 7).toFixed(1)},${(tip[1] - uy * HEAD + ny * 7).toFixed(1)} L${(tip[0] - ux * HEAD - nx * 7).toFixed(1)},${(tip[1] - uy * HEAD - ny * 7).toFixed(1)} Z`);
    for (const g of svg.querySelectorAll<SVGGElement>('.aim-mark')) {
      const which = g.dataset.mark as 'circle' | 'escape', p = at(aim[which]);
      line(g.querySelector('line')!, [p[0] + nx * 9, p[1] + ny * 9], [p[0] - nx * 9, p[1] - ny * 9]);
      // (the word stands beside its mark, on the side away from the screen's nearer edge)
      const side = p[0] + nx * 20 < 40 || p[0] + nx * 20 > window.innerWidth - 40 ? -1 : 1;
      const text = g.querySelector('text')!;
      text.setAttribute('x', (p[0] + side * nx * 22).toFixed(1));
      text.setAttribute('y', (p[1] + side * ny * 22 + 4).toFixed(1));
      g.classList.toggle('on', aim.snapped === which);
    }
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
    el.toggleAttribute('data-free', !!s.free);
    setText(this.$('.place b'), s.place);
    // (a long name gets a smaller letter before it gets cut: "Apollo 11 landing site" whole on a phone)
    this.$('.place b').dataset.long = s.place.length > 26 ? '2' : s.place.length > 17 ? '1' : '';
    setText(this.$('.place small'), s.placeDetail);
    const [day, clock] = splitDate(s.date);
    setText(this.$('.clock b'), `${shortDay(day)}, ${clock.slice(0, 5)}`);
    const ship = s.ship ?? null;
    setText(this.$('.clock small'), s.paused ? 'paused' : ship ? ship.chip : s.rate);
    this.$('.clock').classList.toggle('paused', s.paused);
    setText(this.$('.time-date'), longDay(day));
    setText(this.$('.time-clock'), `${clock} UTC`);
    setText(this.$('.time-rate'), s.paused ? 'Paused' : ship ? ship.chip : s.rate === 'real time' ? 'Real time' : s.live?.slow ? `${s.rate} asked, ${s.live.slow}` : `${s.rate}`);
    this.renderShipTime(ship);
    this.$('.time').classList.toggle('paused', s.paused);
    this.$('.transport [data-act="reverse"]').setAttribute('aria-pressed', String(s.reversed));
    const flight = this.$('.hud-flight');
    flight.hidden = !s.flying;
    if (s.flying) setText(flight.firstElementChild as HTMLElement, `Flying to ${s.flying}`);
    for (const [name, on] of [['labels', s.labels], ['orbits', s.orbits], ['minor', s.minor], ['show-me', s.showMe], ['look', s.look], ['free', !!s.free], ['ship', s.mode === 'ship']] as const) {
      this.$(`.switch[data-act="${name}"]`).setAttribute('aria-checked', String(on));
    }
    this.$('.look-fab').setAttribute('aria-pressed', String(s.look));
    // (the button says what dragging does now; a tap changes it)
    setText(this.$('.look-fab span'), s.look ? 'Drag: look' : 'Drag: orbit');
    setText(this.$('.ship-fab span'), s.selection && !s.selection.here ? 'Fly there in your ship' : 'Your ship');
    const today = this.$('.time-today');
    today.hidden = !s.today;
    if (s.today) setText(today.querySelector('span')!, s.today);
    this.renderMissions(s.missions ?? null);
    this.$('.walk-fab').hidden = !s.canWalk;
    setText(this.$('.status'), s.status);
    this.renderLive(s);
    this.renderWatch(s);
    this.renderCard(s);
    this.showSlot();
  }

  /**
   * A notice over the panels that stays until it is closed or another takes its place (night at a
   * place, and the way on to its sunrise): its words, and the action its button asks for (null: none).
   */
  notice(text: string, action: HudAction | null = null, label = ''): void {
    const el = this.$('.hud-notice');
    setText(el.querySelector('span')!, text);
    const b = el.querySelector<HTMLElement>('.notice-act')!;
    b.hidden = !action;
    if (action) { b.dataset.act = action; setText(b, label); }
    el.hidden = false;
  }

  clearNotice(): void {
    this.$('.hud-notice').hidden = true;
  }

  /** The missions in the More sheet: how many are done, and the list (rebuilt only when it changes). */
  private renderMissions(m: HudState['missions']): void {
    const box = this.$('.more .missions');
    box.hidden = !m;
    if (!m) return;
    setText(box.querySelector('summary small')!, `${m.done} of ${m.total} done · goals to fly to`);
    const key = m.items.map((i) => `${i.done ? 1 : 0}${i.title}`).join('\n');
    if (key === this.missionsKey) return;
    this.missionsKey = key;
    box.querySelector('ul')!.innerHTML = m.items.map((i) => `<li class="${i.done ? 'done' : ''}"><b>${i.done ? '✓ ' : ''}${escapeHtml(i.title)}</b><small>${escapeHtml(i.detail)}</small></li>`).join('');
  }
  private missionsKey = '';
  /** Watching what a change does: the chip above the panel, with Stop while it runs, and Replay once it is over. */
  private renderWatch(s: HudState): void {
    const chip = this.$('.hud-watch'), w = s.watch;
    chip.hidden = !w;
    if (!w) return;
    chip.classList.toggle('ended', w.ended);
    setText(this.$('.watch-text'), w.text);
    this.$('.watch-replay').hidden = !w.ended || !w.replay;
  }

  /** In the ship, the Time sheet says how fast each clock runs, and why the warp is not what was asked. */
  private renderShipTime(ship: HudState['ship']): void {
    const box = this.$('.ship-time');
    box.hidden = !ship;
    if (!ship) return;
    const list = box.querySelector('dl')!;
    if (list.children.length !== ship.rows.length) list.innerHTML = ship.rows.map(() => '<div><dt></dt><dd></dd></div>').join('');
    ship.rows.forEach(([k, v], i) => { setText(list.children[i].firstElementChild!, k); setText(list.children[i].lastElementChild!, v); });
    const why = box.querySelector('p')!;
    why.hidden = !ship.why;
    setText(why, ship.why);
  }

  /**
   * Live physics: the mark at the top, with Undo and the way back; in the Time sheet, what has
   * happened and what is left out. Just after the real Solar System has come back, the mark says so
   * for a moment, with Undo: the changed world can be had back.
   */
  private renderLive(s: HudState): void {
    const live = s.live, after = !live && s.realAgain;
    this.el.toggleAttribute('data-live', !!live || after);
    const mark = this.$('.live-mark');
    mark.hidden = !live && !after;
    mark.classList.toggle('after', after);
    this.$('.live-undo').hidden = !s.undo;
    this.$('.live-back').hidden = !live;
    this.$('.live-ways [data-act="undo"]').hidden = !s.undo;
    const sheet = this.$('.live-sheet');
    sheet.hidden = !live;
    if (after) {
      setText(this.$('.live-what b'), 'Back to reality');
      setText(this.$('.live-what small'), 'the real Solar System again');
    }
    if (!live) return;
    setText(this.$('.live-what b'), 'Live physics');
    setText(this.$('.live-what small'), live.mark);
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
    }
    // (every time: a catalogue star's name or number arrives after it is chosen)
    setText(card.querySelector('h2')!, sel.name);
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
    const addButton = powers.querySelector<HTMLElement>('[data-power="add"]')!;
    addButton.hidden = sel.add.length === 0;
    powers.querySelector<HTMLElement>('[data-act="remove"]')!.hidden = !sel.removable;
    const moving = sel.move?.on ?? false;
    const moveButton = powers.querySelector<HTMLElement>('[data-act="move"]')!;
    moveButton.hidden = !sel.move;
    moveButton.setAttribute('aria-expanded', String(moving));
    // (one panel at a time: moving it takes the place of its mass, of what can be added and of its details)
    if (moving || (this.power === 'mass' && !sel.mass) || (this.power === 'add' && !sel.add.length)) this.power = null;
    if (moving) this.details = false;
    massButton.setAttribute('aria-expanded', String(this.power === 'mass'));
    addButton.setAttribute('aria-expanded', String(this.power === 'add'));
    const addPanel = card.querySelector<HTMLElement>('[data-panel="add"]')!;
    addPanel.hidden = this.power !== 'add';
    if (this.power === 'add') for (const kind of ['moon', 'earth', 'jupiter', 'sun'] as const) addPanel.querySelector<HTMLElement>(`[data-act="add-${kind}"]`)!.hidden = !sel.add.includes(kind);
    const movePanel = card.querySelector<HTMLElement>('[data-panel="move"]')!;
    movePanel.hidden = !moving;
    if (sel.move && moving) {
      const { how, placing } = sel.move;
      setText(movePanel.querySelector('.move-plane')!, sel.move.plane);
      setText(movePanel.querySelector('.power-now')!, sel.move.orbit);
      // (a world just made, being put in place: its mass, Done, and how a finger puts it; otherwise the choice of what it does where it is left)
      movePanel.querySelector<HTMLElement>('.hint-move')!.hidden = placing || how === 'throw';
      movePanel.querySelector<HTMLElement>('.hint-throw')!.hidden = placing || how !== 'throw';
      movePanel.querySelector<HTMLElement>('.hint-place')!.hidden = !placing;
      movePanel.querySelector<HTMLElement>('.seg')!.hidden = placing;
      for (const h of ['keep', 'circle', 'throw'] as const) movePanel.querySelector(`[data-act="move-${h}"]`)!.setAttribute('aria-pressed', String(how === h));
      const place = movePanel.querySelector<HTMLElement>('.placing')!;
      place.hidden = !sel.place;
      if (sel.place) {
        setText(place.querySelector('.power-read b')!, sel.place.mass);
        setText(place.querySelector('.power-read small')!, sel.place.what);
        if (!this.placeSliding && Math.abs(Number(this.placeSlider.value) - sel.place.slider) > 0.002) this.placeSlider.value = String(sel.place.slider);
      }
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
    // another body's facts open at their top (a hidden list keeps where it was scrolled to)
    if (this.factsKey !== sel.key) { this.factsKey = sel.key; facts.scrollTop = 0; }
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
    // (where it was picked from: a section of places, or what was typed)
    this.host.pickDestination(id, this.input.value.trim() ? undefined : this.category);
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
    else if (d.power) { this.endMove(); this.power = this.power === d.power ? null : (d.power as 'mass' | 'add'); this.details = false; if (this.state) this.renderCard(this.state); }
    else if ('noticeClose' in d) this.clearNotice();
    else if ('help' in d) this.$('.more .help-title').scrollIntoView({ block: 'start', behavior: 'smooth' });
    else if ('massReal' in d) { this.slider.value = '0'; this.host.massHeld(true); this.host.setMass(0); this.host.massHeld(false); }
    else if ('live' in d) { if (this.state?.live) { this.openSheet('time'); this.$('.live-sheet').scrollIntoView({ block: 'start' }); } }
    else if ('coach' in d) { this.coach.hidden = true; store('coached'); }
    else if ('fullscreen' in d) void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => this.toast('Full screen is not available here'));
    else if (d.act) {
      if (b.classList.contains('notice-act')) this.clearNotice();
      // (nothing is left open behind the picture, or the cockpit; a picture saved shows the view it saved)
      if (d.act === 'photo' || d.act === 'ship' || d.act === 'screenshot' || d.act === 'free') this.closeSheet();
      this.host.act(d.act as HudAction);
    }
  }

  /** Another panel of the card is opened: if the world was being moved (or put in place), that is over. */
  private endMove(): void {
    const move = this.state?.selection?.move;
    if (!move?.on) return;
    this.host.act('move');
    // (the card is drawn again at once, before the app's next word: as it now is, the world no longer moved, or the
    // panel just opened would close again)
    move.on = false;
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
