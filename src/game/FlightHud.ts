import { C } from '../sim/Gravity';
import { G0, SHIP_SPEC } from '../sim/ShipPhysics';
import { ICON } from '../ui/icons';
import { type EndReport, type FlightReadout, type SasMode, fmtClock, fmtDist, fmtG, fmtGamma, fmtLight, fmtSpeed, fmtPace, fmtTime, fmtWarp, sasLabel, WARP_STEPS } from './Flight';

const CSS = `
.fl-panel { font: 12px/1.45 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; color: #cfe8ff; }
.fl-desk { position: absolute; right: 10px; top: 76px; width: 300px; background: rgba(4, 10, 20, 0.72); border: 1px solid rgba(120, 220, 255, 0.35);
  border-radius: 8px; padding: 8px 11px; pointer-events: none; }
.fl-panel .t { color: #7fd4ff; font-weight: 700; letter-spacing: 0.08em; font-size: 11px; display: flex; justify-content: space-between; }
.fl-panel .row { display: flex; justify-content: space-between; gap: 8px; }
.fl-panel .k { color: #7f9bb8; }
.fl-panel .v { color: #fff; text-align: right; }
.fl-panel .bad, .fl-glance .bad { color: var(--sf-warning); }
.fl-panel .ok, .fl-glance .ok { color: var(--sf-nominal); }
.fl-glance .caution { color: var(--sf-caution); }
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
/* the end of a flight: an event display, as a spacecraft's caution and warning panel shows one (HANDOFF.md
   "Design"): what happened in a sentence, the numbers against their limit, the one thing to do next, and
   when the flight starts again. Flat, opaque, squared, left-aligned; red only for what went wrong. */
.fl-end { position: absolute; inset: 0; z-index: 3; display: flex; align-items: center; pointer-events: none; opacity: 0; transition: opacity 0.6s;
  padding: calc(var(--safe-t, 0px) + 16px) calc(var(--safe-r, 0px) + 16px) calc(var(--safe-b, 0px) + 16px) calc(var(--safe-l, 0px) + 16px); }
.fl-end[hidden] { display: none; }
.fl-end-panel { width: 100%; max-width: 460px; margin: 0 auto; box-sizing: border-box; padding: var(--sf-s4) var(--sf-s4) var(--sf-s3);
  background: var(--sf-panel); border: var(--sf-edge-line); border-left: 4px solid var(--sf-warning); border-radius: var(--sf-r-panel);
  font: var(--sf-t-body); color: var(--sf-ink); text-align: left; }
.fl-end-legend { margin: 0 0 var(--sf-s2); font: var(--sf-t-legend); letter-spacing: var(--sf-legend-track); text-transform: uppercase; color: var(--sf-warning); }
.fl-end-head { margin: 0 0 var(--sf-s4); font: var(--sf-t-display); letter-spacing: -0.01em; text-wrap: balance; }
.fl-end-reads { display: flex; gap: var(--sf-s5); margin: 0 0 var(--sf-s3); }
.fl-end-reads div { min-width: 0; }
.fl-end-reads span { display: block; font: var(--sf-t-legend); letter-spacing: var(--sf-legend-track); text-transform: uppercase; color: var(--sf-ink-2); }
.fl-end-reads b { display: block; margin-top: 2px; font: var(--sf-t-readout); font-variant-numeric: tabular-nums; }
.fl-end-reads div:first-child b { color: var(--sf-warning); }
.fl-end-reads.words b { font: var(--sf-t-body); }
.fl-end-reads.words div:first-child b { color: var(--sf-ink); }
/* the speed on a scale from 0: the safe part up to its limit's tick, the speed it hit at as a bar */
.fl-end-gauge { position: relative; height: 10px; margin: var(--sf-s1) 0 var(--sf-s5); background: var(--sf-panel-2); border-radius: 2px; }
.fl-end-gauge .safe { position: absolute; left: 0; top: 0; bottom: 0; background: color-mix(in srgb, var(--sf-nominal) 35%, transparent); border-radius: 2px 0 0 2px; }
.fl-end-gauge .hit { position: absolute; left: 0; top: 3px; height: 4px; background: var(--sf-warning); }
.fl-end-gauge .tick { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; background: var(--sf-nominal); }
.fl-end-gauge .tick-label { position: absolute; top: 14px; transform: translateX(-50%); font: var(--sf-t-legend); color: var(--sf-nominal); white-space: nowrap; text-transform: uppercase; letter-spacing: var(--sf-legend-track); font-variant-numeric: tabular-nums; }
.fl-end-gauge .tick-label.start { transform: none; }
.fl-end-next { margin: 0 0 var(--sf-s3); padding-top: var(--sf-s3); border-top: var(--sf-edge-line); }
.fl-end-next b { font-weight: 650; }
.fl-end-back { margin: 0; font: var(--sf-t-small); color: var(--sf-ink-2); font-variant-numeric: tabular-nums; }
/* (while it is shown the warning banner says no more: the panel says it; and the ship's controls, which do
   nothing until the flight starts again, step out from under it) */
.fl-ending .fl-warn { display: none !important; }
.fl-ending :is(.fl-desk, .fl-top, .fl-stick, .fl-aids, .fl-rcs, .fl-modes, .fl-keys) { visibility: hidden; }
@media (max-width: 520px) { .fl-end-head { font-size: 24px; line-height: 29px; } }
.fl-keys { position: absolute; right: 14px; bottom: 54px; font: 11px/1.5 system-ui, sans-serif; color: rgba(200, 220, 240, 0.7); text-align: right; pointer-events: none;
  background: rgba(4, 10, 20, 0.5); border-radius: 6px; padding: 6px 9px; }
.fl-keys b { color: #cfe8ff; font-weight: 600; }
/* a touch screen: one slim, flat instrument strip (a tap opens the full read-out), then the drive */
.fl-top { position: absolute; right: calc(var(--safe-r, 0px) + 10px); top: calc(var(--safe-t, 0px) + 62px); width: 360px; box-sizing: border-box;
  display: flex; flex-direction: column; gap: var(--sf-s1); pointer-events: none; }
#hud .fl-glance { pointer-events: auto; position: relative; display: flex; flex-direction: column; align-items: stretch; width: 100%; box-sizing: border-box;
  padding: var(--sf-s1) 32px var(--sf-s1) var(--sf-s2); border-radius: var(--sf-r-panel); background: var(--sf-panel); border: var(--sf-edge-line);
  text-align: left; color: var(--sf-ink); font: var(--sf-t-small); }
#hud .fl-glance:active { background: var(--sf-panel-2); }
.fl-glance > span { min-width: 0; }
.fl-glance > .icon { position: absolute; right: var(--sf-s2); top: 50%; width: 18px; height: 18px; margin-top: -9px; color: var(--sf-accent); transform: rotate(90deg); transition: transform var(--sf-quick) var(--sf-ease); }
.fl-glance[aria-expanded='true'] > .icon { transform: rotate(-90deg); }
.fl-glance .fl-l1 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: var(--sf-s3); }
.fl-l1 > span { min-width: 0; }
.fl-l1 small { display: block; font: var(--sf-t-legend); letter-spacing: var(--sf-legend-track); text-transform: uppercase; color: var(--sf-ink-2); }
.fl-l1 b, .fl-l1 i { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--sf-t-title); font-style: normal; font-variant-numeric: tabular-nums; color: var(--sf-ink); }
.fl-glance > .fl-l2 { flex: none; height: 16px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 16px; }
.fl-glance > .fl-l2:empty { visibility: hidden; }
.fl-glance [hidden] { display: none !important; }
.fl-touch { display: flex; align-items: stretch; gap: var(--sf-s1); height: var(--sf-touch); font: var(--sf-t-small); color: var(--sf-ink); pointer-events: none; }
/* Flat opaque displays, not blurred glass: sky labels cannot read through the instruments or controls. */
#hud .fl-touch button { pointer-events: auto; min-width: var(--sf-touch); border-radius: var(--sf-r-key); border: var(--sf-edge-line); background: var(--sf-panel);
  color: var(--sf-accent); font: 600 18px/1 var(--sf-font); touch-action: manipulation; }
#hud .fl-touch .fl-which { flex: 1; min-width: 0; padding: 0 var(--sf-s2); text-align: left; font: var(--sf-t-small); font-weight: 600; line-height: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--sf-ink); }
.fl-which small { display: block; overflow: hidden; text-overflow: ellipsis; font: var(--sf-t-legend); letter-spacing: 0; text-transform: none; color: var(--sf-ink-2); }
#hud .fl-touch button:active { background: var(--sf-panel-2); }
.fl-touch span { min-width: 92px; display: flex; align-items: center; justify-content: center; padding: 0 var(--sf-s1); border: var(--sf-edge-line); border-radius: var(--sf-r-key); background: var(--sf-panel);
  font: var(--sf-t-small); font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
#hud.touch .fl-desk { display: none; }
#hud.touch[data-mode='ship'] .hud-toast { top: calc(var(--fl-bottom, 200px) + 8px); z-index: 3; }
/* flying by hand on a touch screen: the throttle lever and Stop, at the right edge under the right
   thumb (upright, under the instruments; on its side, in the corner) */
.fl-stick { align-self: flex-end; display: flex; flex-direction: column; align-items: stretch; gap: var(--sf-s1); width: 64px; margin-top: 0; pointer-events: none; }
#hud .fl-lever { pointer-events: auto; position: relative; height: 96px; border-radius: var(--sf-r-panel); overflow: hidden; touch-action: none; cursor: ns-resize;
  background: var(--sf-panel); border: var(--sf-edge-line); }
.fl-lever i { position: absolute; left: 0; right: 0; bottom: 0; height: calc(var(--v, 0) * 100%); background: color-mix(in srgb, var(--sf-accent) 45%, transparent); }
.fl-lever b, .fl-lever small { position: absolute; left: 0; right: 0; text-align: center; color: var(--sf-ink); pointer-events: none; }
.fl-lever b { top: var(--sf-s2); font: var(--sf-t-small); font-weight: 650; font-variant-numeric: tabular-nums; }
.fl-lever small { bottom: var(--sf-s2); font: var(--sf-t-legend); letter-spacing: var(--sf-legend-track); color: var(--sf-ink-2); }
#hud .fl-lever[data-dragging] { border-color: var(--sf-accent); }
#hud .fl-stop { pointer-events: auto; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; height: var(--sf-touch); border-radius: var(--sf-r-key);
  border: 1px solid var(--sf-warning); background: var(--sf-panel); color: var(--sf-warning); font: var(--sf-t-small); font-weight: 650; touch-action: manipulation; }
#hud .fl-stop .icon { width: 16px; height: 16px; }
#hud .fl-stop[aria-pressed='true'] { background: var(--sf-warning); color: var(--sf-accent-ink); }
#hud .fl-stop:active { background: var(--sf-panel-2); }
#hud .fl-view { pointer-events: auto; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0; height: var(--sf-touch); border-radius: var(--sf-r-key);
  border: var(--sf-edge-line); background: var(--sf-panel); color: var(--sf-ink); font: var(--sf-t-small); font-weight: 650; touch-action: manipulation; }
#hud .fl-view .icon { width: 14px; height: 14px; color: var(--sf-accent); }
#hud .fl-view b { line-height: 16px; }
.fl-view small { font: var(--sf-t-legend); line-height: 11px; color: var(--sf-ink-2); }
#hud .fl-view:active { background: var(--sf-panel-2); }
/* the steering assist and the side thrusters, by touch (the keys Y and A D R F Shift+W S): two chips
   under the left thumb (upright: down the left side under the instruments, where the sky is clear;
   on its side: along the right, above the lever), the thrusters' pad opening only while flying by
   hand, the assist's modes in a small list that opens at its chip */
.fl-aids { position: absolute; left: 0; top: var(--aids-top, 200px); display: flex; flex-direction: column; align-items: flex-start; gap: var(--sf-s1); pointer-events: none; }
.fl-chips { display: flex; flex-direction: column; gap: var(--sf-s1); pointer-events: none; }
#hud .fl-chips button { pointer-events: auto; width: 76px; height: var(--sf-touch); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; border-radius: var(--sf-r-key);
  border: var(--sf-edge-line); background: var(--sf-panel); color: var(--sf-ink); font: var(--sf-t-legend); touch-action: manipulation; overflow: hidden; }
#hud .fl-chips button small { font: var(--sf-t-legend); font-size: 9px; letter-spacing: var(--sf-legend-track); text-transform: uppercase; color: var(--sf-ink-2); }
#hud .fl-chips button b { max-width: 100%; padding: 0 2px; box-sizing: border-box; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--sf-ink); }
#hud .fl-chips .icon { width: 16px; height: 16px; color: var(--sf-accent); }
#hud .fl-chips button[aria-pressed='true'], #hud .fl-chips button[aria-expanded='true'] { border-color: var(--sf-accent); background: var(--sf-panel-2); }
#hud .fl-chips button:active { background: var(--sf-panel-2); }
.fl-aids.fl-beside { flex-direction: row; align-items: flex-start; }
.fl-chips [hidden], .fl-aids[hidden], .fl-rcs[hidden], .fl-modes[hidden] { display: none !important; }
.fl-rcs { display: grid; grid-template-columns: repeat(3, var(--sf-touch)); grid-auto-rows: var(--sf-touch); gap: var(--sf-s1); padding: var(--sf-s1); border-radius: var(--sf-r-panel); pointer-events: none;
  background: var(--sf-panel); border: var(--sf-edge-line); }
#hud .fl-rcs button { pointer-events: auto; display: flex; align-items: center; justify-content: center; border-radius: var(--sf-r-key); border: var(--sf-edge-line);
  background: var(--sf-panel-2); color: var(--sf-ink); font: var(--sf-t-legend); touch-action: none; }
#hud .fl-rcs button .icon { width: 22px; height: 22px; }
#hud .fl-rcs button[data-held] { background: var(--sf-accent); color: var(--sf-accent-ink); }
.fl-modes { position: fixed; z-index: 4; display: grid; grid-template-columns: repeat(2, 84px); gap: var(--sf-s1); padding: var(--sf-s1); border-radius: var(--sf-r-panel); pointer-events: none;
  background: var(--sf-panel); border: var(--sf-edge-line); }
#hud .fl-modes button { pointer-events: auto; height: var(--sf-touch); padding: 0 var(--sf-s1); border-radius: var(--sf-r-key); border: var(--sf-edge-line); background: var(--sf-panel-2); color: var(--sf-ink);
  font: var(--sf-t-small); white-space: nowrap; touch-action: manipulation; }
#hud .fl-modes button .sh { display: none; }
.fl-modes.fl-short { padding: var(--sf-s1); gap: var(--sf-s1); }
#hud .fl-modes.fl-short button { padding: 0 1px; font-size: 11px; }
#hud .fl-modes.fl-short button .sh { display: inline; }
#hud .fl-modes.fl-short button .lg { display: none; }
#hud .fl-modes button[aria-checked='true'] { background: var(--sf-accent); color: var(--sf-accent-ink); border-color: var(--sf-accent); }
#hud .fl-modes button[aria-disabled='true'] { color: var(--sf-ink-3); }
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
  #hud[data-sheet='time'] :is(.fl-stick, .fl-aids, .fl-modes) { display: none; }
  .fl-warn { font-size: 15px; top: auto; bottom: 40%; }
}
@media (max-width: 520px), (pointer: coarse) { .fl-keys { display: none; } }
/* a wide view (a phone on its side, a tablet): the panels of the interface stand at the left (the
   ship asks a little less width of them); the instruments take the room to their right, no more,
   and the lever lies along the foot of that room, Stop beside it */
@media (min-width: 760px), (orientation: landscape) {
  #hud.touch[data-mode='ship'] .hud-slot { width: min(340px, 40vw); }
  .fl-top { width: min(400px, calc(100vw - var(--safe-l, 0px) - var(--safe-r, 0px) - 124px - min(340px, 40vw))); }
  .fl-stick { position: fixed; right: calc(var(--safe-r, 0px) + 10px); bottom: calc(var(--safe-b, 0px) + 10px); margin: 0;
    width: min(400px, calc(100vw - var(--safe-l, 0px) - var(--safe-r, 0px) - 124px - min(340px, 40vw))); height: var(--sf-touch); flex-direction: row; }
  #hud .fl-lever { flex: 1; height: auto; cursor: ew-resize; }
  .fl-lever i { top: 0; right: auto; width: calc(var(--v, 0) * 100%); height: auto; background: color-mix(in srgb, var(--sf-accent) 45%, transparent); }
  .fl-lever b, .fl-lever small { top: 50%; bottom: auto; transform: translateY(-50%); text-align: left; padding: 0 12px; }
  .fl-lever small { text-align: right; }
  #hud .fl-stop { flex: none; width: 76px; height: auto; flex-direction: row; gap: 5px; font-size: 13px; }
  #hud .fl-view { flex: none; width: 64px; height: auto; }
  /* ("Stopping" fills the button lying down: its square steps aside for it) */
  #hud .fl-stop[aria-pressed='true'] .icon { display: none; }
  #hud .fl-touch button { min-width: var(--sf-touch); }
  .fl-touch span { min-width: 68px; }
  /* (the chips along the right above the lever, the pad above them) */
  .fl-aids { position: fixed; left: auto; top: auto; right: calc(var(--safe-r, 0px) + 10px); bottom: calc(var(--safe-b, 0px) + 68px); flex-direction: column-reverse; align-items: flex-end; }
  .fl-aids.fl-beside { flex-direction: row-reverse; align-items: flex-end; }
  .fl-chips { flex-direction: row; }
  #hud .fl-chips button { width: auto; min-width: 84px; height: var(--sf-touch); flex-direction: row; gap: 5px; padding: 0 var(--sf-s2); }
  #hud .fl-chips button small { font-size: 11px; letter-spacing: 0; text-transform: none; }
  .fl-modes { grid-template-columns: repeat(5, 74px); }
}
/* where there is not room for everything (a short view, the browser's bars shown): the one
   conditional line gives way first; the drive stays. Upright the lever shortens, then steps aside
   (FlightHud.fit). An open assist list or thruster pad can put the strip aside for that moment. */
#hud .fl-top.fl-tight .fl-l2, #hud .fl-top.fl-tighter .fl-l2 { display: none; }
#hud .fl-top.fl-tightest :is(.fl-glance, .fl-touch) { display: none; }
#hud .fl-stick.fl-away { display: none; }
#hud .fl-aids.fl-away { display: none; }
/* the engine chip spans the strip, and its menu lays the buttons out two by two */
.fl-touch[hidden] { display: none !important; }
#hud .fl-touch .fl-engine-button { width: 100%; }
.fl-modes.fl-engine-menu { width: min(300px, calc(100vw - 16px)); grid-template-columns: repeat(2, minmax(0, 1fr)); }
#hud .fl-engine-menu button { min-width: 0; white-space: normal; }
`;

/** the assist's modes, as the list names them (the chip names the current one shorter) */
const MODES: [SasMode, string][] = [
  ['off', 'Off'], ['stability', 'Hold'], ['prograde', 'Prograde'], ['retrograde', 'Retrograde'], ['normal', 'Normal'],
  ['antinormal', 'Anti-normal'], ['radial-out', 'Radial out'], ['radial-in', 'Radial in'], ['target', 'To target'], ['anti-target', 'From target'],
];
const CHIP: Record<SasMode, string> = {
  off: 'Off', stability: 'Hold', prograde: 'Prograde', retrograde: 'Retro', normal: 'Normal', antinormal: 'Anti-norm', 'radial-out': 'Rad out', 'radial-in': 'Rad in', target: 'Target', 'anti-target': 'Away',
};
/** Four plain choices, each a setting the drive row already offers (Flight's DRIVE_STEPS). */
const ENGINE: readonly [string, number][] = [['Gentle', 1], ['Fast', 100], ['Very fast', 10000], ['Near light speed', 1000000]];
/** arrows for the thruster pad */
const ARROW = {
  up: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  left: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  right: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

/** What the touch controls ask of the ship. */
export interface FlightControls {
  /** the reactionless drive's setting, a step up or down (choosing that drive) */
  stepDrive(up: boolean): void;
  /** one of the drive row's settings, chosen by its plain name (choosing that drive) */
  setDrive(g: number): void;
  /** the fusion torch or the reactionless drive */
  toggleDrive(): void;
  /** the throttle (0..1), from the lever */
  setThrottle(x: number): void;
  /** brake to rest beside the nearest world, and hold there */
  stop(): void;
  /** from the cockpit, or from behind the ship (the chase view) */
  toggleView(): void;
  /** a steering assist mode, from the list (false: refused, as with no target to point at) */
  setSas(mode: SasMode): boolean;
  /** the side thrusters held, ship axes (x right, y up, z aft), each -1..1 */
  setRcs(x: number, y: number, z: number): void;
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
  private engineRow: HTMLElement;
  private engineBtn: HTMLElement;
  private engineMenu: HTMLElement;
  private lever: HTMLElement;
  private stopBtn: HTMLElement;
  private viewBtn: HTMLElement;
  private aids: HTMLElement;
  private assistBtn: HTMLElement;
  private thrustBtn: HTMLElement;
  private pad: HTMLElement;
  private modes: HTMLElement;
  /** the thrusters' pad is open (it shows only while flying by hand) */
  private padOpen = false;
  private modesOpen = false;
  private engineOpen = false;
  private pilotControls = false;
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
    this.el.innerHTML = `<div class="fl-panel fl-desk" data-cover></div><div class="fl-warn"></div><div class="fl-end" role="alert" hidden><div class="fl-end-panel"><p class="fl-end-legend"></p><p class="fl-end-head"></p><div class="fl-end-reads"></div><div class="fl-end-gauge" hidden><i class="safe"></i><i class="hit"></i><i class="tick"></i><span class="tick-label"></span></div><p class="fl-end-next"></p><p class="fl-end-back"></p></div></div>
      <div class="fl-top touch-only">
        <button class="fl-glance" type="button" data-cover aria-expanded="false" aria-label="The ship's instruments: tap for the full read-out">
          <span class="fl-l1"><span><small>Speed</small><b></b></span><span><small>Above ground</small><i></i></span></span><span class="fl-l2"></span>${ICON.chevron}
        </button>
        <div class="fl-touch fl-drive-row" data-cover><button class="fl-which" type="button" data-drive aria-label="Change the drive"></button><button type="button" data-step="down" aria-label="Weaker">−</button><span></span><button type="button" data-step="up" aria-label="Stronger">+</button></div>
        <div class="fl-touch fl-engine" data-cover><button class="fl-which fl-engine-button" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Engine: choose its power">Engine<small>Choose power</small></button></div>
        <div class="fl-stick" data-cover>
          <div class="fl-lever" role="slider" aria-label="Throttle" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i><b>0%</b><small>THRUST</small></div>
          <button class="fl-stop" type="button" aria-pressed="false" aria-label="Stop: brake to rest beside the nearest world">${ICON.stop}<span>Stop</span></button>
          <button class="fl-view" type="button" aria-label="Switch the view: from the cockpit, or from behind the ship">${ICON.look}<b></b><small>view</small></button>
        </div>
        <div class="fl-aids">
          <div class="fl-chips" data-cover>
            <button class="fl-assist" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Steering assist: what the ship holds its nose to"><small>steering</small><b>Hold</b></button>
            <button class="fl-thrust" type="button" aria-pressed="false" aria-label="Side thrusters">${ICON.move}<b>Side thrust</b></button>
          </div>
          <div class="fl-rcs" data-cover role="group" aria-label="Side thrusters" hidden>
          <button type="button" data-rcs="x-" aria-label="Thrust left">${ARROW.left}</button><button type="button" data-rcs="y+" aria-label="Thrust up">${ARROW.up}</button><button type="button" data-rcs="x+" aria-label="Thrust right">${ARROW.right}</button>
          <button type="button" data-rcs="z+" aria-label="Thrust backwards">Back</button><button type="button" data-rcs="y-" aria-label="Thrust down">${ARROW.down}</button><button type="button" data-rcs="z-" aria-label="Thrust forwards">Forward</button>
          </div>
        </div>
        <div class="fl-modes" role="menu" data-cover hidden>${MODES.map(([m, l]) => `<button type="button" role="menuitemradio" aria-checked="false" data-sas="${m}"><span class="lg">${l}</span><span class="sh">${CHIP[m]}</span></button>`).join('')}</div>
        <div class="fl-modes fl-engine-menu" role="menu" data-cover hidden>${ENGINE.map(([label, g]) => `<button type="button" role="menuitem" data-drive-g="${g}">${label}</button>`).join('')}</div>
      </div>
      <div class="fl-keys"><b>W/S</b> throttle · <b>Z/X</b> full/cut · <b>arrows/drag</b> pitch-yaw · <b>Q/E</b> roll<br>
      <b>A/D R/F Shift+W/S</b> RCS · <b>Y</b> SAS mode · <b>I</b> drive · <b>= -</b> its setting · <b>[ ]</b> time warp · <b>J</b> autopilot</div>`;
    root.appendChild(this.el);
    this.desk = this.el.querySelector('.fl-desk')!;
    this.warn = this.el.querySelector('.fl-warn')!;
    this.end = this.el.querySelector('.fl-end')!;
    this.keys = this.el.querySelector('.fl-keys')!;
    this.glanceEl = this.el.querySelector('.fl-glance')!;
    this.driveRow = this.el.querySelector('.fl-drive-row')!;
    this.drive = this.el.querySelector('.fl-drive-row span')!;
    this.which = this.el.querySelector('.fl-which')!;
    this.engineRow = this.el.querySelector('.fl-engine')!;
    this.engineBtn = this.el.querySelector('.fl-engine-button')!;
    this.engineMenu = this.el.querySelector('.fl-engine-menu')!;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.fl-drive-row [data-step]')) b.addEventListener('click', () => controls.stepDrive(b.dataset.step === 'up'));
    this.which.addEventListener('click', () => controls.toggleDrive());
    this.engineBtn.addEventListener('click', () => this.showEngine(!this.engineOpen));
    for (const b of this.engineMenu.querySelectorAll<HTMLButtonElement>('[data-drive-g]')) {
      b.addEventListener('click', () => { controls.setDrive(Number(b.dataset.driveG)); this.showEngine(false); this.timer = 0; });
    }
    this.lever = this.el.querySelector('.fl-lever')!;
    this.stopBtn = this.el.querySelector('.fl-stop')!;
    this.stopBtn.addEventListener('click', () => controls.stop());
    this.viewBtn = this.el.querySelector('.fl-view')!;
    this.viewBtn.addEventListener('click', () => { controls.toggleView(); this.timer = 0; });
    this.holdLever(controls);
    this.aids = this.el.querySelector('.fl-aids')!;
    this.assistBtn = this.el.querySelector('.fl-assist')!;
    this.thrustBtn = this.el.querySelector('.fl-thrust')!;
    this.pad = this.el.querySelector('.fl-rcs')!;
    this.modes = this.el.querySelector('.fl-modes')!;
    this.assistBtn.addEventListener('click', () => this.showModes(!this.modesOpen));
    this.thrustBtn.addEventListener('click', () => { this.showModes(false); this.showPad(!this.padOpen, controls); });
    for (const b of this.modes.querySelectorAll<HTMLButtonElement>('[data-sas]')) {
      b.addEventListener('click', () => { if (controls.setSas(b.dataset.sas as SasMode)) this.showModes(false); });
    }
    // (a touch anywhere else puts an open list away)
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Element | null;
      if (this.modesOpen && !t?.closest?.('.fl-modes:not(.fl-engine-menu), .fl-assist')) this.showModes(false);
      if (this.engineOpen && !t?.closest?.('.fl-engine-menu, .fl-engine-button')) this.showEngine(false);
    }, true);
    this.holdPad(controls);
    this.glanceEl.addEventListener('click', () => {
      if (sheet.open === 'flight') sheet.closeSheet();
      else sheet.openSheet('flight');
      this.timer = 0;
    });
    this.setPilotControls(false);
    this.setVisible(false);
  }

  /** Simple controls by default; the setting in More brings every pilot control back. */
  setPilotControls(on: boolean): void {
    this.pilotControls = on;
    this.driveRow.hidden = !on;
    this.engineRow.hidden = on;
    this.aids.hidden = !on;
    this.showEngine(false);
    if (!on) { this.showModes(false); this.showPad(false); }
    this.timer = 0;
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
    setText(this.lever.querySelector('b')!, `${pct}\u00a0%`);
    this.lever.setAttribute('aria-valuenow', String(pct));
  }

  /** The thrusters' pad: a finger held on a button thrusts that way (two at once, along different axes, do both); lifting stops it. */
  private holdPad(controls: FlightControls): void {
    const held = new Map<number, string>();
    const apply = () => {
      const v = { x: 0, y: 0, z: 0 };
      for (const k of held.values()) v[k[0] as 'x' | 'y' | 'z'] = k[1] === '+' ? 1 : -1;
      controls.setRcs(v.x, v.y, v.z);
      for (const b of this.pad.querySelectorAll<HTMLElement>('[data-rcs]')) b.toggleAttribute('data-held', [...held.values()].includes(b.dataset.rcs!));
    };
    this.releasePad = () => { held.clear(); apply(); };
    for (const b of this.pad.querySelectorAll<HTMLElement>('[data-rcs]')) {
      b.addEventListener('pointerdown', (e) => {
        try { b.setPointerCapture(e.pointerId); } catch { /* gone already */ }
        for (const [id, k] of held) if (k[0] === b.dataset.rcs![0]) held.delete(id);
        held.set(e.pointerId, b.dataset.rcs!);
        apply();
      });
      const end = (e: PointerEvent) => { if (held.delete(e.pointerId)) apply(); };
      b.addEventListener('pointerup', end);
      b.addEventListener('pointercancel', end);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }
  private releasePad: () => void = () => undefined;

  /** The list of the assist's modes, open or shut (it opens beside its chip). */
  private showModes(open: boolean): void {
    this.modesOpen = open;
    this.modes.hidden = !open;
    this.assistBtn.setAttribute('aria-expanded', String(open));
    if (open) this.placeModes();
  }

  /** The Engine chip's four plain choices, opening below it upright and above it on its side. */
  private showEngine(open: boolean): void {
    this.engineOpen = open && !this.pilotControls;
    this.engineMenu.hidden = !this.engineOpen;
    this.engineBtn.setAttribute('aria-expanded', String(this.engineOpen));
    if (this.engineOpen) this.placeEngine();
  }

  private placeEngine(): void {
    const chip = this.engineBtn.getBoundingClientRect(), m = this.engineMenu;
    const lying = getComputedStyle(this.el.querySelector('.fl-stick')!).position === 'fixed';
    const width = Math.min(300, window.innerWidth - 16);
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, lying ? chip.right - width : chip.left));
    m.style.left = `${Math.round(left)}px`;
    m.style.right = 'auto';
    if (lying) {
      m.style.top = 'auto';
      m.style.bottom = `${Math.round(window.innerHeight - chip.top + 6)}px`;
    } else {
      m.style.top = `${Math.round(chip.bottom + 4)}px`;
      m.style.bottom = 'auto';
    }
  }

  private showPad(open: boolean, controls?: FlightControls): void {
    this.padOpen = open;
    if (!open) { this.releasePad(); void controls; }
    this.thrustBtn.setAttribute('aria-pressed', String(open));
    this.pad.hidden = !open;
    this.timer = 0;
  }

  /**
   * The list stands beside the assist chip: right of it upright (the left side is the chips'); on its
   * side above the chips, its right edge at theirs, two rows of five, with the short names where the
   * room between the card and the edge of the screen is less than the full names take.
   */
  private placeModes(): void {
    const chip = this.assistBtn.getBoundingClientRect(), row = this.el.querySelector('.fl-chips')!.getBoundingClientRect(), m = this.modes;
    const lying = getComputedStyle(this.el.querySelector('.fl-stick')!).position === 'fixed';
    m.style.left = m.style.right = m.style.top = m.style.bottom = '';
    m.style.gridTemplateColumns = '';
    m.classList.remove('fl-short');
    if (lying) {
      // (what stands at the left: the tab bar and the card)
      const left = Math.max(0, ...[...this.root.querySelectorAll<HTMLElement>('.hud-tabs, .hud-slot > .on')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.left < window.innerWidth / 2).map((r) => r.right));
      const room = row.right - left - 8;
      // (five columns of the full names; else five of the short ones; else four)
      const full = room >= 5 * 74 + 4 * 4 + 14, five = room >= 5 * 54 + 4 * 4 + 14;
      m.classList.toggle('fl-short', !full);
      m.style.gridTemplateColumns = `repeat(${five ? 5 : 4}, ${full ? 74 : 54}px)`;
      m.style.right = `${Math.round(window.innerWidth - row.right)}px`;
      m.style.bottom = `${Math.round(window.innerHeight - row.top + 6)}px`;
    } else {
      m.style.left = `${Math.round(chip.right + 6)}px`;
      m.style.top = `${Math.round(chip.top)}px`;
    }
  }

  /** The chips and the pad: only while the pilot flies (the autopilot, Stop or a dock have the ship otherwise); the chip names the mode. */
  private renderAids(r: FlightReadout): void {
    const auto = !!r.autopilot || !!r.stop;
    const mode = auto ? 'Auto' : CHIP[r.sas];
    setText(this.assistBtn.querySelector('b')!, mode);
    for (const b of this.modes.querySelectorAll<HTMLElement>('[data-sas]')) {
      b.setAttribute('aria-checked', String(!auto && b.dataset.sas === r.sas));
      b.setAttribute('aria-disabled', String((b.dataset.sas === 'target' || b.dataset.sas === 'anti-target') && !r.target));
    }
    // (the thrusters are for flying by hand: with the autopilot or Stop at the controls they are put away)
    this.thrustBtn.hidden = auto;
    if (auto && this.padOpen) this.showPad(false);
    this.pad.hidden = !this.padOpen || auto;
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? '' : 'none';
    // (out of the ship its read-out and menus are not left open)
    if (!v) { this.showEngine(false); this.showModes(false); }
    if (!v && this.sheet.open === 'flight') this.sheet.closeSheet();
  }

  /**
   * The end of a flight as an event display (Flight.ts endReport), with opacity 0..1 and the whole
   * seconds left before the flight starts again; null when no flight has ended.
   */
  setEnd(report: EndReport | null, opacity: number, secondsLeft: number): void {
    const end = this.end;
    end.hidden = !report;
    this.el.classList.toggle('fl-ending', !!report);
    end.style.opacity = String(opacity);
    end.style.transition = opacity > 0 ? 'opacity 0.6s' : 'none';
    if (!report) { this.endKey = ''; return; }
    // (the full read-out folds away too: left open, it lay over the panel and still said "impact in 3 min")
    if (this.sheet.open === 'flight') this.sheet.closeSheet();
    const q = (sel: string) => end.querySelector(sel) as HTMLElement;
    const key = `${report.legend}|${report.head}`;
    if (key !== this.endKey) {
      this.endKey = key;
      q('.fl-end-legend').textContent = report.legend;
      q('.fl-end-head').textContent = report.head;
      const reads = q('.fl-end-reads');
      reads.classList.toggle('words', !report.gauge);
      reads.replaceChildren(...report.readouts.map(([k, v]) => {
        const d = document.createElement('div'), sp = document.createElement('span'), b = document.createElement('b');
        sp.textContent = k; b.textContent = v; d.append(sp, b);
        return d;
      }));
      const gauge = q('.fl-end-gauge');
      gauge.hidden = !report.gauge;
      if (report.gauge) {
        // (a scale from 0 to a quarter past the larger of the two: the limit's tick and the speed's bar on it)
        const { value, limit } = report.gauge, top = Math.max(value, limit) * 1.25, at = (x: number) => `${(100 * x) / top}%`;
        (gauge.querySelector('.safe') as HTMLElement).style.width = at(limit);
        (gauge.querySelector('.hit') as HTMLElement).style.width = at(value);
        (gauge.querySelector('.tick') as HTMLElement).style.left = at(limit);
        const label = gauge.querySelector('.tick-label') as HTMLElement;
        label.style.left = '0';
        label.textContent = 'safe';
        label.className = 'tick-label start';
      }
      const next = q('.fl-end-next');
      const [first, ...rest] = report.next.split(', ');
      next.replaceChildren(Object.assign(document.createElement('b'), { textContent: rest.length ? `${first},` : first }), rest.length ? ` ${rest.join(', ')}` : '');
    }
    q('.fl-end-back').textContent = `Back in orbit around ${report.back} in ${Math.max(1, secondsLeft)}\u00a0s`;
  }
  private endKey = '';

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
    if (touch && this.modesOpen) this.placeModes();
    if (touch && this.engineOpen) this.placeEngine();
    if (touch) this.fit();
    this.glanceEl.setAttribute('aria-expanded', String(open));
    if (touch) { this.renderGlance(r); this.renderAids(r); }
    // the full read-out: the panel at the right with a mouse, the sheet on a touch screen (when open)
    if (!touch) this.desk.innerHTML = readout(r);
    else if (open) this.sheet.flightBody.innerHTML = `<div class="fl-panel">${readout(r, true)}</div>`;
  }

  /**
   * Nothing of the ship's over the view may cover the interface's own (the chips, the tab bar, the
   * card or sheet that is open), on any screen, however much of it the browser's bars take. The
   * CSS lays it out for the usual sizes; here what is laid out is measured, and where it still
   * meets something the one conditional instrument line gives way (the drive stays), and upright
   * the lever shortens to the room left, or steps aside.
   */
  private fit(): void {
    const top = this.el.querySelector<HTMLElement>('.fl-top')!, stick = this.el.querySelector<HTMLElement>('.fl-stick')!;
    if (top.offsetParent === null && getComputedStyle(top).display === 'none') return;
    top.classList.remove('fl-tight', 'fl-tighter', 'fl-tightest');
    this.aids.classList.remove('fl-beside');
    stick.classList.remove('fl-away');
    this.lever.style.height = '';
    const others = [...this.root.querySelectorAll<HTMLElement>('.hud-top .chip, .hud-tabs, .hud-slot > .on, .hud-flight:not([hidden]), .live-mark:not([hidden])')]
      .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    const lying = getComputedStyle(stick).position === 'fixed';
    const mine = () => [...top.querySelectorAll<HTMLElement>('.fl-glance, .fl-touch')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    // (the chips and the pad: what is shown of them)
    const aidsBoxes = () => [...this.aids.querySelectorAll<HTMLElement>('.fl-chips, .fl-rcs')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    const hitsOthers = (boxes: DOMRect[]) => boxes.some((a) => others.some((o) => meets(a, o, 2)));
    const blocked = () => {
      const list = this.modesOpen ? [this.modes.getBoundingClientRect()] : [];
      const against = lying ? [...others, stick.getBoundingClientRect(), ...aidsBoxes(), ...list] : others;
      return mine().some((m) => against.some((o) => meets(m, o, 2)));
    };
    if (blocked()) top.classList.add('fl-tight');
    if (blocked()) top.classList.add('fl-tighter');
    // on its side the pad stands over the chips; where that is still too tall for the instruments, beside them (if the card is not there)
    if (lying && this.padOpen && blocked()) {
      this.aids.classList.add('fl-beside');
      if (hitsOthers(aidsBoxes())) this.aids.classList.remove('fl-beside');
    }
    // upright the chips stand down the left side from just under the instruments (the pad below them,
    // or, where the card is too near, beside them)
    if (!lying) {
      const t = top.getBoundingClientRect(), bottom = Math.max(t.top, ...mine().map((m) => m.bottom));
      top.style.setProperty('--aids-top', `${Math.round(bottom - t.top + 4)}px`);
      if (hitsOthers(aidsBoxes())) this.aids.classList.add('fl-beside');
      // an open list that would lie on the card instead goes up, to the foot of the clock
      if (this.modesOpen && hitsOthers([this.modes.getBoundingClientRect()])) { this.modes.style.top = `${Math.round(t.top)}px`; top.classList.add('fl-tightest'); }
    }
    // (the pad or the list open on a short screen: the instruments give way for as long as it is open)
    if ((this.modesOpen || this.padOpen) && blocked()) top.classList.add('fl-tightest');
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
    const [l1, l2] = this.glanceEl.children as unknown as HTMLElement[];
    setText(l1.querySelector('b')!, g.speed);
    const altitude = l1.querySelector('i')!;
    setText(altitude, g.side);
    (altitude.parentElement as HTMLElement).hidden = !g.side;
    setText(l2, g.state);
    l2.className = `fl-l2 ${g.stateClass}`;
    const torch = r.drive === 'torch';
    this.driveRow.dataset.drive = r.drive;
    // (− and + set the reactionless drive, and choose it: the setting is its own)
    const name = 'Main drive';
    if (this.which.dataset.name !== name) {
      this.which.dataset.name = name;
      this.which.innerHTML = `${name}<small></small>`;
    }
    // (in plain words what each is, and what the number counts: "Torch · 100 %" said neither, the fix list's #14)
    setText(this.which.querySelector('small')!, torch ? `Rocket · ${Math.round(r.fuel * 100)}\u00a0% fuel left` : 'Field drive · needs no fuel');
    setText(this.drive, fmtG(r.driveG).replace(/ g$/, '\u00a0×\u00a0gravity'));
    const chosen = ENGINE.find(([, g]) => !torch && Math.abs(g - r.driveG) < 1e-9);
    // (a power that is none of the four, as the autopilot sets one for the trip, is named for who set it, not by its drive)
    setText(this.engineBtn.querySelector('small')!, chosen?.[0] ?? (torch ? 'Rocket' : r.autopilot ? 'Set by the autopilot' : 'Your own setting'));
    // the lever shows the throttle as it is (the autopilot's, Stop's) unless a finger is on it
    if (!this.leverHeld) this.showLever(r.throttle);
    this.stopBtn.setAttribute('aria-pressed', String(!!r.stop));
    setText(this.stopBtn.querySelector('span')!, r.stop ? 'Stopping' : 'Stop');
    // (the switch names the view it goes to)
    setText(this.viewBtn.querySelector('b')!, this.view === 'chase' ? 'Cockpit' : 'Chase');
  }
}

/**
 * The folded touch instruments: speed and height in plain units, and at most one status line when
 * something needs the pilot's attention. The orbit, target, clocks and the rest stay one tap away
 * in the full read-out. `target` and `toGo` remain the full read-out's words for its unit checks.
 */
export function glance(r: FlightReadout): { speed: string; side: string; state: string; stateClass: string; target: string; toGo: string } {
  const speed = plainSpeed(r.properSpeed);
  const side = Number.isFinite(r.altitude) ? plainAltitude(r.altitude) : '';
  let state = '', stateClass = '';
  if (r.autopilot) { state = `Autopilot: ${r.apState}`; stateClass = 'ok'; }
  else if (r.stop) { state = `Stop: ${r.stop}${Number.isFinite(r.stopTau) && r.stopTau > 1 ? ` · ${timeWords(r.stopTau)} aboard` : ''}`; stateClass = 'ok'; }
  else if (r.landed) state = `Landed on ${r.landed}`;
  else if (r.throttle > 0) state = `Thrust at ${Math.round(r.throttle * 100)}\u00a0%`;
  else if (r.target && r.refusal) { state = 'Drive too weak to go there'; stateClass = 'caution'; }
  if (!r.autopilot && Number.isFinite(r.tImpact) && !r.landed) { state = `Hits the ground in ${timeWords(r.tImpact)}`; stateClass = 'caution'; }
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
 * The same proper speed the read-out shows, in plain words: below 1 % of c, the coordinate speed in
 * whole km/h, or in km/s rounded as fmtSpeed rounds it (the sign kept); past that, fmtLight's own
 * nines against `× light speed`.
 */
export function plainSpeed(properSpeed: number): string {
  const v = properSpeed / Math.hypot(1, properSpeed / C); // the coordinate speed, as fmtLight derives it
  const a = Math.abs(v);
  if (a < 1000) return `${Math.round(v * 3.6).toLocaleString('en-US')}\u00a0km/h`;
  if (a < 0.01 * C) return `${(v / 1000).toFixed(a < 1e5 ? 2 : 0)}\u00a0km/s`;
  return fmtLight(properSpeed).replace(/ c$/, '\u00a0×\u00a0light speed');
}

/** Height above the ground in km (or plain millions of km far out), from the read-out's metres. */
export function plainAltitude(metres: number): string {
  const km = metres / 1000, a = Math.abs(km);
  if (!Number.isFinite(km)) return '—';
  if (a >= 1e9) return `${(km / 1e9).toLocaleString('en-US', { maximumSignificantDigits: 4 })}\u00a0billion km`;
  if (a >= 1e6) return `${(km / 1e6).toLocaleString('en-US', { maximumSignificantDigits: 4 })}\u00a0million km`;
  return `${km.toLocaleString('en-US', { maximumFractionDigits: a < 10 ? 2 : a < 1000 ? 1 : 0 })}\u00a0km`;
}

/** fmtTime's own value, with every number kept on the same line as its unit. */
function timeWords(seconds: number): string {
  return fmtTime(seconds).replace(/(\d) (s|min|h|d|yr)\b/g, '$1\u00a0$2');
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
  if (r.drive === 'torch') return 'The torch\'s fuel can never get you there sooner: tap Main drive to switch to the field drive';
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
  if (r.landed) orbit = row('status', `landed on ${esc(r.landed)}`, 'ok');
  // (past a tenth of light's speed a Newtonian orbit is not the ship's path: the speed says more)
  else if ((c || Number.isFinite(r.pe)) && r.properSpeed < 0.1 * C) {
    if (Number.isFinite(r.ap) && (bound || r.ap > 0)) orbit += row('apoapsis', `${fmtDist(r.ap)} <span class="k">in</span> ${fmtTime(r.tAp)}`);
    else orbit += row('apoapsis', r.escape ? 'escape' : 'unbound', 'bad');
    orbit += row('periapsis', `${fmtDist(r.pe)}${Number.isFinite(r.tPe) ? ` <span class="k">in</span> ${fmtTime(r.tPe)}` : ''}`, r.pe < 0 ? 'bad' : '');
    if (c && bound) orbit += row('period · e · i', `${fmtTime(c.period)} · ${c.e.toFixed(3)} · ${(c.inc * 57.2958).toFixed(1)}°`);
  }
  if (Number.isFinite(r.tImpact) && !r.landed) orbit += row('impact in', fmtTime(r.tImpact), 'bad');
  if (r.encounter) orbit += row('encounter', esc(r.encounter), 'ok');
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
