import { C } from '../sim/Gravity';
import { G0, SHIP_SPEC } from '../sim/ShipPhysics';
import { ICON } from '../ui/icons';
import { type FlightReadout, fmtClock, fmtDist, fmtG, fmtGamma, fmtLight, fmtSpeed, fmtPace, fmtTime, fmtWarp, sasLabel, WARP_STEPS } from './Flight';

const CSS = `
.fl-panel { font: 12px/1.45 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; color: #cfe8ff; }
.fl-desk { position: absolute; right: 10px; top: 76px; width: 300px; background: rgba(4, 10, 20, 0.72); border: 1px solid rgba(120, 220, 255, 0.35);
  border-radius: 8px; padding: 8px 11px; pointer-events: none; }
.fl-panel .t { color: #7fd4ff; font-weight: 700; letter-spacing: 0.08em; font-size: 11px; display: flex; justify-content: space-between; }
.fl-panel .row { display: flex; justify-content: space-between; gap: 8px; }
.fl-panel .k { color: #7f9bb8; }
.fl-panel .v { color: #fff; text-align: right; }
.fl-panel .bad, .fl-glance .bad { color: #ff7a6a; }
.fl-panel .ok, .fl-glance .ok { color: #9dff8a; }
.fl-panel .bar { height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; margin: 2px 0 4px; overflow: hidden; }
.fl-panel .bar i { display: block; height: 100%; background: #7fd4ff; }
.fl-panel .tip { margin: 2px 0 4px; font: 12px/1.35 system-ui, sans-serif; color: #9fb6cf; }
.fl-panel .sep { border-top: 1px solid rgba(120, 220, 255, 0.18); margin: 4px 0; }
/* the full read-out in its sheet, on a touch screen: larger, and the sheet scrolls it */
#hud .flight-body .fl-panel { font-size: 13px; line-height: 1.5; -webkit-user-select: text; user-select: text; }
#hud .flight-body .fl-panel .t { font-size: 12px; }
#hud .flight-body .fl-panel .row { width: auto; min-height: 0; padding: 0; border-radius: 0; gap: 8px; align-items: baseline; }
.fl-warn { position: absolute; top: 92px; left: 50%; transform: translateX(-50%); font: 700 20px/1.2 system-ui, sans-serif; letter-spacing: 0.06em;
  padding: 6px 16px; border-radius: 6px; pointer-events: none; text-shadow: 0 0 6px #000; white-space: nowrap; }
.fl-warn.l1 { color: #ffd166; background: rgba(40, 30, 0, 0.45); }
.fl-warn.l2 { color: #ff5a4a; background: rgba(50, 0, 0, 0.5); animation: fl-blink 0.8s steps(2) infinite; }
@keyframes fl-blink { 50% { opacity: 0.55; } }
.fl-end { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none;
  font-family: system-ui, sans-serif; text-align: center; opacity: 0; transition: opacity 0.6s; }
.fl-end h1 { font-size: 54px; letter-spacing: 0.2em; margin: 0 0 14px; color: #fff; text-shadow: 0 0 24px rgba(255,120,80,0.8); }
.fl-end p { font-size: 17px; max-width: 640px; color: #e8eef8; text-shadow: 0 0 6px #000; margin: 0 20px; }
.fl-keys { position: absolute; right: 14px; bottom: 54px; font: 11px/1.5 system-ui, sans-serif; color: rgba(200, 220, 240, 0.7); text-align: right; pointer-events: none;
  background: rgba(4, 10, 20, 0.5); border-radius: 6px; padding: 6px 9px; }
.fl-keys b { color: #cfe8ff; font-weight: 600; }
/* a touch screen: the instruments at a glance under the clock (a tap opens the full read-out), and the drive */
.fl-top { position: absolute; right: calc(var(--safe-r, 0px) + 10px); top: calc(var(--safe-t, 0px) + 62px); width: 360px; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
#hud .fl-glance { pointer-events: auto; position: relative; display: flex; flex-direction: column; align-items: stretch; width: 100%; box-sizing: border-box;
  padding: 6px 34px 7px 12px; border-radius: 14px; background: rgba(6, 11, 22, 0.9); border: 1px solid rgba(120, 220, 255, 0.35);
  -webkit-backdrop-filter: blur(22px); backdrop-filter: blur(22px); text-align: left; color: #cfe8ff; font: 12.5px/1.4 system-ui, sans-serif; }
#hud .fl-glance:active { background: rgba(14, 24, 40, 0.95); }
.fl-glance > span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fl-glance > .icon { position: absolute; right: 8px; top: 50%; width: 20px; height: 20px; margin-top: -10px; color: #7fd4ff; transform: rotate(90deg); transition: transform 0.15s; }
.fl-glance[aria-expanded='true'] > .icon { transform: rotate(-90deg); }
.fl-glance .fl-l1 { display: flex; flex-wrap: wrap; justify-content: space-between; column-gap: 10px; white-space: normal;
  font: 700 14px/1.35 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; color: #fff; font-variant-numeric: tabular-nums; }
.fl-l1 i { font-style: normal; font-weight: 600; color: #cfe8ff; white-space: nowrap; }
.fl-l1 b { font-weight: 700; overflow-wrap: anywhere; }
.fl-glance .fl-l3 { color: #fff; }
.fl-glance .fl-l4 { color: #9fb6cf; font-variant-numeric: tabular-nums; white-space: normal; }
.fl-touch { display: flex; align-items: stretch; gap: 6px; height: 40px; font: 13px/1 system-ui, sans-serif; color: #cfe8ff; pointer-events: none; }
/* (every piece over the view is as opaque as the card, and blurs what is behind it: no sky label
   reads through the instruments or the controls) */
#hud :is(.fl-glance, .fl-touch button, .fl-touch span, .fl-lever, .fl-stop, .fl-view) { -webkit-backdrop-filter: blur(22px); backdrop-filter: blur(22px); }
#hud .fl-touch button { pointer-events: auto; min-width: 46px; border-radius: 12px; border: 1px solid rgba(120, 220, 255, 0.45); background: rgba(6, 11, 22, 0.9);
  color: #fff; font: 600 18px/1 system-ui, sans-serif; touch-action: manipulation; }
#hud .fl-touch .fl-which { flex: 1; min-width: 0; padding: 0 10px; text-align: left; font: 600 13px/1.1 system-ui, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fl-which small { display: block; font-size: 10.5px; font-weight: 500; color: #7f9bb8; }
#hud .fl-touch button:active { background: rgba(30, 50, 80, 0.95); }
.fl-touch span { min-width: 84px; display: flex; align-items: center; justify-content: center; padding: 0 6px; border-radius: 12px; background: rgba(6, 11, 22, 0.9);
  font: 600 13px/1 ui-monospace, 'SF Mono', Menlo, monospace; white-space: nowrap; }
#hud.touch .fl-desk { display: none; }
#hud.touch[data-mode='ship'] .hud-toast { top: calc(var(--fl-bottom, 200px) + 8px); z-index: 3; }
/* flying by hand on a touch screen: the throttle lever and Stop, at the right edge under the right
   thumb (upright, under the instruments; on its side, in the corner) */
.fl-stick { align-self: flex-end; display: flex; flex-direction: column; align-items: stretch; gap: 8px; width: 64px; margin-top: 4px; pointer-events: none; }
#hud .fl-lever { pointer-events: auto; position: relative; height: 136px; border-radius: 18px; overflow: hidden; touch-action: none; cursor: ns-resize;
  background: rgba(6, 11, 22, 0.9); border: 1px solid rgba(120, 220, 255, 0.45); }
.fl-lever i { position: absolute; left: 0; right: 0; bottom: 0; height: calc(var(--v, 0) * 100%); background: linear-gradient(rgba(127, 212, 255, 0.85), rgba(127, 212, 255, 0.45)); }
.fl-lever b, .fl-lever small { position: absolute; left: 0; right: 0; text-align: center; color: #fff; text-shadow: 0 0 4px #000; pointer-events: none; }
.fl-lever b { top: 8px; font: 700 14px/1 ui-monospace, 'SF Mono', Menlo, monospace; font-variant-numeric: tabular-nums; }
.fl-lever small { bottom: 7px; font: 600 10px/1 system-ui, sans-serif; letter-spacing: 0.04em; color: #cfe8ff; }
#hud .fl-lever[data-dragging] { border-color: #7fd4ff; }
#hud .fl-stop { pointer-events: auto; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; height: 52px; border-radius: 16px;
  border: 1px solid rgba(255, 140, 120, 0.6); background: rgba(40, 10, 8, 0.9); color: #ffb3a6; font: 650 12px/1 system-ui, sans-serif; touch-action: manipulation; }
#hud .fl-stop .icon { width: 18px; height: 18px; }
#hud .fl-stop[aria-pressed='true'] { background: rgba(255, 140, 120, 0.9); color: #2a0a04; }
#hud .fl-stop:active { filter: brightness(1.25); }
#hud .fl-view { pointer-events: auto; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; height: 52px; border-radius: 16px;
  border: 1px solid rgba(120, 220, 255, 0.45); background: rgba(6, 11, 22, 0.9); color: #cfe8ff; font: 650 12px/1 system-ui, sans-serif; touch-action: manipulation; }
#hud .fl-view .icon { width: 18px; height: 18px; color: #7fd4ff; }
.fl-view small { font-size: 10px; font-weight: 500; color: #7f9bb8; }
#hud .fl-view:active { filter: brightness(1.25); }
@media (max-width: 520px) {
  .fl-desk { left: 8px; right: 8px; width: auto; top: 64px; font-size: 11px; line-height: 1.3; }
  .fl-top { left: calc(var(--safe-l, 0px) + 8px); right: calc(var(--safe-r, 0px) + 8px); width: auto; }
  #hud[data-live] .fl-top { top: calc(var(--safe-t, 0px) + 122px); }
  /* (upright the lever and Stop stand at the right under the instruments: a message keeps left of them) */
  #hud.touch[data-mode='ship'] .hud-toast { left: calc(var(--safe-l, 0px) + 8px); max-width: calc(100vw - 96px); transform: translate(0, -6px); }
  #hud.touch[data-mode='ship'] .hud-toast.show { transform: none; }
  /* (the search and the settings take the whole screen: the instruments step aside for them; the
     time sheet reaches up to where the lever is) */
  #hud:is([data-sheet='explore'], [data-sheet='more']) :is(.fl-desk, .fl-top) { display: none; }
  #hud[data-sheet='time'] .fl-stick { display: none; }
  .fl-warn { font-size: 15px; top: auto; bottom: 40%; }
  .fl-end h1 { font-size: 34px; }
}
@media (max-width: 520px), (pointer: coarse) { .fl-keys { display: none; } }
/* a wide view (a phone on its side, a tablet): the panels of the interface stand at the left (the
   ship asks a little less width of them); the instruments take the room to their right, no more,
   and the lever lies along the foot of that room, Stop beside it */
@media (min-width: 760px), (orientation: landscape) {
  #hud.touch[data-mode='ship'] .hud-slot { width: min(340px, 40vw); }
  .fl-top { width: min(400px, calc(100vw - var(--safe-l, 0px) - var(--safe-r, 0px) - 124px - min(340px, 40vw))); }
  .fl-stick { position: fixed; right: calc(var(--safe-r, 0px) + 10px); bottom: calc(var(--safe-b, 0px) + 10px); margin: 0;
    width: min(400px, calc(100vw - var(--safe-l, 0px) - var(--safe-r, 0px) - 124px - min(340px, 40vw))); height: 52px; flex-direction: row; }
  #hud .fl-lever { flex: 1; height: auto; cursor: ew-resize; }
  .fl-lever i { top: 0; right: auto; width: calc(var(--v, 0) * 100%); height: auto; background: linear-gradient(90deg, rgba(127, 212, 255, 0.45), rgba(127, 212, 255, 0.85)); }
  .fl-lever b, .fl-lever small { top: 50%; bottom: auto; transform: translateY(-50%); text-align: left; padding: 0 12px; }
  .fl-lever small { text-align: right; }
  #hud .fl-stop { flex: none; width: 76px; height: auto; flex-direction: row; gap: 5px; font-size: 13px; }
  #hud .fl-view { flex: none; width: 64px; height: auto; }
  /* ("Stopping" fills the button lying down: its square steps aside for it) */
  #hud .fl-stop[aria-pressed='true'] .icon { display: none; }
  #hud .fl-touch button { min-width: 40px; }
  .fl-touch span { min-width: 64px; }
}
/* where there is not room for everything (a short view, the browser's bars shown): the instruments
   give up their lower lines, then the drive (the full read-out keeps it all); upright the lever
   shortens, then steps aside (FlightHud.fit) */
#hud .fl-top.fl-tight :is(.fl-l3, .fl-l4) { display: none; }
#hud .fl-top.fl-tighter :is(.fl-l2, .fl-touch) { display: none; }
#hud .fl-stick.fl-away { display: none; }
`;

/** What the touch controls ask of the ship. */
export interface FlightControls {
  /** the reactionless drive's setting, a step up or down (choosing that drive) */
  stepDrive(up: boolean): void;
  /** the fusion torch or the reactionless drive */
  toggleDrive(): void;
  /** the throttle (0..1), from the lever */
  setThrottle(x: number): void;
  /** brake to rest beside the nearest world, and hold there */
  stop(): void;
  /** from the cockpit, or from behind the ship (the chase view) */
  toggleView(): void;
}

/** Where the full read-out goes on a touch screen: a sheet of the app's interface (src/ui/Hud.ts). */
export interface FlightSheet {
  readonly open: string | null;
  openSheet(sheet: 'flight'): void;
  closeSheet(): void;
  readonly flightBody: HTMLElement;
}

/**
 * Flight instruments: orbit, speeds (as a fraction of light's when fast, with the Lorentz factor),
 * engine, the target with the time to it in both clocks, the ship's clock and the universe's;
 * warnings; the end-of-flight card. With a mouse, the full panel stands at the right. On a touch
 * screen what the pilot needs at a glance stands under the clock, the drive under it, and a tap
 * opens the full read-out as a sheet of the interface.
 */
export class FlightHud {
  private el: HTMLElement;
  private desk: HTMLElement;
  private warn: HTMLElement;
  private end: HTMLElement;
  private keys: HTMLElement;
  private glanceEl: HTMLElement;
  private driveRow: HTMLElement;
  private drive: HTMLElement;
  private which: HTMLElement;
  private lever: HTMLElement;
  private stopBtn: HTMLElement;
  private viewBtn: HTMLElement;
  /** the view the ship is seen in now */
  private view: 'cockpit' | 'chase' = 'cockpit';
  /** the lever is under a finger: it shows the finger's setting */
  private leverHeld = false;
  private timer = 0;
  private lastWarn = '';

  constructor(private root: HTMLElement, private sheet: FlightSheet, controls: FlightControls) {
    if (!document.getElementById('flight-css')) {
      const st = document.createElement('style');
      st.id = 'flight-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.className = 'flight-hud';
    this.el.innerHTML = `<div class="fl-panel fl-desk" data-cover></div><div class="fl-warn"></div><div class="fl-end"><h1></h1><p></p></div>
      <div class="fl-top touch-only">
        <button class="fl-glance" type="button" data-cover aria-expanded="false" aria-label="The ship's instruments: tap for the full read-out">
          <span class="fl-l1"><b></b><i></i></span><span class="fl-l2"></span><span class="fl-l3"></span><span class="fl-l4"></span>${ICON.chevron}
        </button>
        <div class="fl-touch" data-cover><button class="fl-which" type="button" data-drive aria-label="Change the drive"></button><button type="button" data-step="down" aria-label="Weaker">−</button><span></span><button type="button" data-step="up" aria-label="Stronger">+</button></div>
        <div class="fl-stick" data-cover>
          <div class="fl-lever" role="slider" aria-label="Throttle" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i><b>0%</b><small>THRUST</small></div>
          <button class="fl-stop" type="button" aria-pressed="false" aria-label="Stop: brake to rest beside the nearest world">${ICON.stop}<span>Stop</span></button>
          <button class="fl-view" type="button" aria-label="Switch the view: from the cockpit, or from behind the ship">${ICON.look}<b></b><small>view</small></button>
        </div>
      </div>
      <div class="fl-keys"><b>W/S</b> throttle · <b>Z/X</b> full/cut · <b>arrows/drag</b> pitch-yaw · <b>Q/E</b> roll<br>
      <b>A/D R/F Shift+W/S</b> RCS · <b>Y</b> SAS mode · <b>I</b> drive · <b>= -</b> its setting · <b>[ ]</b> time warp · <b>J</b> autopilot</div>`;
    root.appendChild(this.el);
    this.desk = this.el.querySelector('.fl-desk')!;
    this.warn = this.el.querySelector('.fl-warn')!;
    this.end = this.el.querySelector('.fl-end')!;
    this.keys = this.el.querySelector('.fl-keys')!;
    this.glanceEl = this.el.querySelector('.fl-glance')!;
    this.driveRow = this.el.querySelector('.fl-touch')!;
    this.drive = this.el.querySelector('.fl-touch span')!;
    this.which = this.el.querySelector('.fl-which')!;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.fl-touch [data-step]')) b.addEventListener('click', () => controls.stepDrive(b.dataset.step === 'up'));
    this.which.addEventListener('click', () => controls.toggleDrive());
    this.lever = this.el.querySelector('.fl-lever')!;
    this.stopBtn = this.el.querySelector('.fl-stop')!;
    this.stopBtn.addEventListener('click', () => controls.stop());
    this.viewBtn = this.el.querySelector('.fl-view')!;
    this.viewBtn.addEventListener('click', () => { controls.toggleView(); this.timer = 0; });
    this.holdLever(controls);
    this.glanceEl.addEventListener('click', () => {
      if (sheet.open === 'flight') sheet.closeSheet();
      else sheet.openSheet('flight');
      this.timer = 0;
    });
    this.setVisible(false);
  }

  /**
   * The throttle lever: a finger put on it sets the thrust where it is (the foot is off, the top full,
   * the ends snap), and the setting follows it until it lifts.
   */
  private holdLever(controls: FlightControls): void {
    const lever = this.lever;
    let id = -1;
    const at = (e: PointerEvent) => {
      // (upright it stands, the top full; on its side it lies, the right end full)
      const b = lever.getBoundingClientRect();
      const x = b.width > b.height ? (e.clientX - b.left - 10) / Math.max(1, b.width - 20) : 1 - (e.clientY - b.top - 10) / Math.max(1, b.height - 20);
      const v = x < 0.04 ? 0 : x > 0.96 ? 1 : x;
      this.showLever(v);
      controls.setThrottle(v);
    };
    lever.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      try { lever.setPointerCapture(id); } catch { /* gone already */ }
      this.leverHeld = true;
      lever.toggleAttribute('data-dragging', true);
      at(e);
    });
    lever.addEventListener('pointermove', (e) => { if (e.pointerId === id) at(e); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      this.leverHeld = false;
      lever.toggleAttribute('data-dragging', false);
    };
    lever.addEventListener('pointerup', end);
    lever.addEventListener('pointercancel', end);
  }

  private showLever(v: number): void {
    const pct = Math.round(v * 100);
    this.lever.style.setProperty('--v', String(pct / 100));
    setText(this.lever.querySelector('b')!, `${pct}%`);
    this.lever.setAttribute('aria-valuenow', String(pct));
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? '' : 'none';
    // (out of the ship its read-out is not left open)
    if (!v && this.sheet.open === 'flight') this.sheet.closeSheet();
  }

  /** End-of-flight card: title/text with opacity 0..1. */
  setEnd(title: string, text: string, opacity: number): void {
    (this.end.querySelector('h1') as HTMLElement).textContent = title;
    (this.end.querySelector('p') as HTMLElement).textContent = text;
    this.end.style.opacity = String(opacity);
    this.end.style.transition = opacity > 0 ? 'opacity 0.6s' : 'none';
  }

  update(dt: number, r: FlightReadout, showKeys: boolean, view: 'cockpit' | 'chase' = 'cockpit'): void {
    this.view = view;
    this.keys.style.display = showKeys ? '' : 'none';
    if (r.warning !== this.lastWarn) {
      this.lastWarn = r.warning;
      this.warn.textContent = r.warning;
      this.warn.className = `fl-warn ${r.warning ? `l${r.warnLevel}` : ''}`;
      this.warn.style.display = r.warning ? '' : 'none';
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    const touch = this.root.classList.contains('touch');
    const open = this.sheet.open === 'flight';
    if (touch) this.fit();
    this.glanceEl.setAttribute('aria-expanded', String(open));
    if (touch) this.renderGlance(r);
    // the full read-out: the panel at the right with a mouse, the sheet on a touch screen (when open)
    if (!touch) this.desk.innerHTML = readout(r);
    else if (open) this.sheet.flightBody.innerHTML = `<div class="fl-panel">${readout(r, true)}</div>`;
  }

  /**
   * Nothing of the ship's over the view may cover the interface's own (the chips, the tab bar, the
   * card or sheet that is open), on any screen, however much of it the browser's bars take. The
   * CSS lays it out for the usual sizes; here what is laid out is measured, and where it still
   * meets something the instruments give up their lower lines, then the drive (the full read-out
   * has it all), and upright the lever shortens to the room left, or steps aside.
   */
  private fit(): void {
    const top = this.el.querySelector<HTMLElement>('.fl-top')!, stick = this.el.querySelector<HTMLElement>('.fl-stick')!;
    if (top.offsetParent === null && getComputedStyle(top).display === 'none') return;
    top.classList.remove('fl-tight', 'fl-tighter');
    stick.classList.remove('fl-away');
    this.lever.style.height = '';
    const others = [...this.root.querySelectorAll<HTMLElement>('.hud-top .chip, .hud-tabs, .hud-slot > .on, .hud-flight:not([hidden]), .live-mark:not([hidden])')]
      .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    const lying = getComputedStyle(stick).position === 'fixed';
    const mine = () => [...top.querySelectorAll<HTMLElement>('.fl-glance, .fl-touch')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    const blocked = () => {
      const against = lying ? [...others, stick.getBoundingClientRect()] : others;
      return mine().some((m) => against.some((o) => meets(m, o, 2)));
    };
    if (blocked()) top.classList.add('fl-tight');
    if (blocked()) top.classList.add('fl-tighter');
    // (a message shows under the instruments, not behind them)
    this.root.style.setProperty('--fl-bottom', `${Math.round(Math.max(0, ...mine().map((m) => m.bottom)))}px`);
    if (lying) return;
    // upright the lever and Stop stand under the instruments: shorten the lever to what is left above the panel below
    const s = stick.getBoundingClientRect(), lever = this.lever.getBoundingClientRect();
    const below = others.filter((o) => o.left < s.right && o.right > s.left && o.top >= s.top - 1).reduce((y, o) => Math.min(y, o.top), window.innerHeight);
    const spare = below - 8 - s.bottom;
    if (spare >= 0) return;
    const h = lever.height + spare;
    if (h >= 72) this.lever.style.height = `${h}px`;
    else stick.classList.add('fl-away');
  }

  private renderGlance(r: FlightReadout): void {
    const g = glance(r);
    const [l1, l2, l3, l4] = this.glanceEl.children as unknown as HTMLElement[];
    setText(l1.firstElementChild!, g.speed);
    setText(l1.lastElementChild!, g.side);
    setText(l2, g.state);
    l2.className = `fl-l2 ${g.stateClass}`;
    setText(l3, g.target);
    l3.hidden = !g.target;
    setText(l4, g.toGo);
    l4.hidden = !g.toGo;
    const torch = r.drive === 'torch';
    this.driveRow.dataset.drive = r.drive;
    // (− and + set the reactionless drive, and choose it: the setting is its own)
    const name = torch ? 'Fusion torch' : 'Reactionless';
    if (this.which.dataset.name !== name) {
      this.which.dataset.name = name;
      this.which.innerHTML = `${name}<small></small>`;
    }
    setText(this.which.querySelector('small')!, torch ? `fuel ${Math.round(r.fuel * 100)} % · tap to change` : 'tap to change');
    setText(this.drive, fmtG(r.driveG));
    // the lever shows the throttle as it is (the autopilot's, Stop's) unless a finger is on it
    if (!this.leverHeld) this.showLever(r.throttle);
    this.stopBtn.setAttribute('aria-pressed', String(!!r.stop));
    setText(this.stopBtn.querySelector('span')!, r.stop ? 'Stopping' : 'Stop');
    // (the switch names the view it goes to)
    setText(this.viewBtn.querySelector('b')!, this.view === 'chase' ? 'Cockpit' : 'Chase');
  }
}

/**
 * What the pilot needs at a glance (a touch screen's instruments): the speed (with its nines) and
 * the Lorentz factor, or the height while slow; what the ship is doing; the target and the time to
 * it in both clocks. Every number is the full read-out's own.
 */
export function glance(r: FlightReadout): { speed: string; side: string; state: string; stateClass: string; target: string; toGo: string } {
  const speed = fmtLight(r.properSpeed);
  const side = r.landed ? `on ${r.landed}`
    : r.gamma >= 1.0001 ? `γ ${fmtGamma(r.gamma)}`
    : Number.isFinite(r.altitude) ? `${fmtDist(r.altitude)} up` : '';
  let state: string, stateClass = '';
  const c = r.conic;
  if (r.autopilot) { state = `Autopilot: ${r.apState}`; stateClass = 'ok'; }
  else if (r.stop) { state = `Stop: ${r.stop}${Number.isFinite(r.stopTau) && r.stopTau > 1 ? ` · ${fmtTime(r.stopTau)} aboard` : ''}`; stateClass = 'ok'; }
  else if (r.landed) state = `Landed on ${r.landed}`;
  else if (r.throttle > 0) state = `Thrust ${Math.round(r.throttle * 100)} % · ${r.drive === 'torch' ? 'fusion torch' : `${fmtG(r.driveG * r.throttle)} reactionless`}`;
  else if (c && c.e < 1 && r.properSpeed < 0.1 * C && Number.isFinite(r.pe) && Number.isFinite(r.ap)) state = `Orbit ${fmtDist(r.pe)} × ${fmtDist(r.ap)} over ${r.frame}`;
  else state = `Coasting · nearest pull: ${r.frame}`;
  if (!r.autopilot && Number.isFinite(r.tImpact) && !r.landed) { state = `Impact in ${fmtTime(r.tImpact)}`; stateClass = 'bad'; }
  let target = '', toGo = '';
  if (r.target) {
    target = `${r.target} · ${fmtDist(r.targetDist)}`;
    if (Number.isFinite(r.etaShip)) toGo = `there in ${fmtTime(r.etaShip)} for you · ${fmtTime(r.etaUniverse)} outside`;
    else if (r.refusal) toGo = 'autopilot: drive too weak here';
  }
  const tip = advice(r);
  if (tip) toGo = toGo ? `${toGo}. ${tip}` : tip;
  return { speed, side, state, stateClass, target, toGo };
}

/**
 * Why a trip would take so long, and what to do about it, in plain words ('' when there is
 * nothing to say): the torch's propellant gives 25 km/s in all, so it coasts; a weak setting of the
 * reactionless drive.
 */
function advice(r: FlightReadout): string {
  if (!r.target || r.autopilot) return '';
  const year = 3.15576e7;
  const long = !Number.isFinite(r.etaShip) || r.etaShip > year;
  if (!long) return '';
  if (r.drive === 'torch') return 'The torch\'s fuel can never get you there sooner: tap Fusion torch for the reactionless drive';
  if (r.etaBy === 'flip-and-burn') return 'At this setting it takes years: + makes the drive stronger';
  return '';
}

/** The full read-out (HTML rows). */
/** The full read-out (HTML rows); `plain`: with a line of plain words where a number needs one (the touch screen's sheet). */
function readout(r: FlightReadout, plain = false): string {
  const c = r.conic;
  const row = (k: string, v: string, cls = '') => `<div class="row"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
  const bound = c && c.e < 1;
  let orbit = '';
  if (r.landed) orbit = row('status', `landed on ${r.landed}`, 'ok');
  // (past a tenth of light's speed a Newtonian orbit is not the ship's path: the speed says more)
  else if ((c || Number.isFinite(r.pe)) && r.properSpeed < 0.1 * C) {
    if (Number.isFinite(r.ap) && (bound || r.ap > 0)) orbit += row('apoapsis', `${fmtDist(r.ap)} <span class="k">in</span> ${fmtTime(r.tAp)}`);
    else orbit += row('apoapsis', r.escape ? 'escape' : 'unbound', 'bad');
    orbit += row('periapsis', `${fmtDist(r.pe)}${Number.isFinite(r.tPe) ? ` <span class="k">in</span> ${fmtTime(r.tPe)}` : ''}`, r.pe < 0 ? 'bad' : '');
    if (c && bound) orbit += row('period · e · i', `${fmtTime(c.period)} · ${c.e.toFixed(3)} · ${(c.inc * 57.2958).toFixed(1)}°`);
  }
  if (Number.isFinite(r.tImpact) && !r.landed) orbit += row('impact in', fmtTime(r.tImpact), 'bad');
  if (r.encounter) orbit += row('encounter', r.encounter, 'ok');
  // the warp as it runs (measured from the clocks), and what was asked when that differs
  const warp = r.asked === 0 ? 'paused'
    : `${fmtWarp(r.pace)}${r.rails ? ' rails' : r.pace > 1.005 ? ' physics' : ''}${r.why ? ` <span class="k">(${r.asked < 0 ? 'reverse' : WARP_STEPS.includes(r.asked) ? fmtWarp(r.asked) : fmtPace(r.asked)} asked)</span>` : ''}`;
  const dil = r.dilation < 0.9999 ? ` <span class="bad">×${r.dilation < 1e-3 ? r.dilation.toExponential(2) : r.dilation.toPrecision(3)}</span>` : '';
  const torch = r.drive === 'torch';
  const fast = r.properSpeed > 0.01 * C;
  // what speed does to the view ahead (shown once it is a tenth of light's)
  const ahead = r.properSpeed > 0.1 * C
    ? row('ahead', `half the sky in ${fmtAngle(r.halfSky)} · ×${fmtFactor(r.doppler)} bluer`) : '';
  let target = '';
  if (r.target) {
    target = `<div class="sep"></div>${row('target', `${esc(r.target)} · ${fmtDist(r.targetDist)}`)}`;
    if (Number.isFinite(r.etaShip)) target += row(`to go (${r.etaBy === 'flip-and-burn' ? 'speed up, turn, brake' : r.etaBy})`, `${fmtTime(r.etaShip)} <span class="k">aboard ·</span> ${fmtTime(r.etaUniverse)} <span class="k">outside</span>`);
    const tip = plain ? advice(r) : '';
    if (tip) target += `<div class="tip">${esc(tip)}</div>`;
    // (far short of it, as at a galaxy: the times are to there, not to the target itself)
    if (r.arrival > 0.05 * r.targetDist) target += row('stopping', `${fmtDist(r.arrival)} <span class="k">short of it</span>`);
  }
  const ap = r.refusal && !r.autopilot ? row('autopilot', 'drive too weak here', 'bad') : row('autopilot', r.autopilot ? esc(r.autopilot) : r.target ? 'ready (J)' : 'select a target', r.autopilot || r.target ? 'ok' : '');
  return `
    <div class="t"><span>ORBIT · ${esc(r.frame.toUpperCase())}</span><span>${torch ? 'TORCH' : `REACTIONLESS ${fmtG(r.driveG)}`}</span></div>
    ${row('altitude', fmtDist(r.altitude))}
    ${row('vertical', `${r.vertSpeed >= 0 ? '+' : ''}${fmtSpeed(r.vertSpeed)}`, r.vertSpeed < -50 && r.altitude < 20e3 ? 'bad' : '')}
    ${fast ? row('speed', fmtLight(r.properSpeed)) : row('orbital · surface', `${fmtSpeed(r.orbitSpeed)} · ${fmtSpeed(r.surfSpeed)}`)}
    ${row('Lorentz factor', fmtGamma(r.gamma))}
    ${ahead}
    ${orbit}
    <div class="sep"></div>
    ${row('throttle', `${Math.round(r.throttle * 100)} %`)}<div class="bar"><i style="width:${r.throttle * 100}%"></i></div>
    ${torch ? row('propellant · Δv', `${Math.round(r.fuel * 100)} % · ${fmtSpeed(r.dv)}`, r.fuel < 0.1 ? 'bad' : '') : row('drive', `${fmtG(r.driveG)} · no propellant${r.atLimit ? ' · at its limit' : ''}`, r.atLimit ? 'bad' : '')}
    ${row(torch ? 'g-force' : 'g-force (felt)', `${r.gForce.toFixed(2)} g`, r.gForce > 6 ? 'bad' : '')}
    ${row('SAS', sasLabel(r.sas))}
    ${r.tidal > 0.01 ? row('tides', `${(r.tidal / G0).toPrecision(3)} g / ${(SHIP_SPEC.tidalLimit / G0).toFixed(0)} g`, r.tidal > SHIP_SPEC.tidalLimit * 0.3 ? 'bad' : '') : ''}
    ${r.hullTemp > 500 ? row('hull', `${Math.round(r.hullTemp)} K`, r.hullTemp > 1800 ? 'bad' : '') : ''}
    ${target}
    ${ap}
    <div class="sep"></div>
    ${row('time warp', warp)}
    ${row('ship clock', fmtClock(r.shipTime) + dil)}
    ${row('universe clock', fmtClock(r.universeTime))}
    ${plain ? `<div class="tip">Aboard, time runs ${r.gamma > 1.0001 ? `${fmtGamma(r.gamma)} times slower than outside: that is the Lorentz factor` : 'as it does outside'}; nothing goes as fast as light, so the speed gains nines instead.</div>` : ''}`;
}

/** an angle: "2.6°", "0.004″" */
function fmtAngle(rad: number): string {
  const deg = (rad * 180) / Math.PI;
  if (deg >= 0.1) return `${deg.toFixed(deg < 10 ? 1 : 0)}°`;
  if (deg * 60 >= 1) return `${(deg * 60).toFixed(1)}′`;
  return `${Number((deg * 3600).toPrecision(2))}″`;
}

/** a large factor: "2.31", "2,000", "1.4×10⁹" */
function fmtFactor(x: number): string {
  if (x < 10) return x.toFixed(2);
  if (x < 1e6) return Math.round(x).toLocaleString('en-US');
  return fmtGamma(x);
}

function esc(t: string): string {
  return t.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'));
}

/** two boxes come within `gap` px of each other */
function meets(a: DOMRect, b: DOMRect, gap: number): boolean {
  return a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
