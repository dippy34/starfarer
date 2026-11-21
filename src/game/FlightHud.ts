import { C } from '../sim/Gravity';
import { G0, SHIP_SPEC } from '../sim/ShipPhysics';
import { type FlightReadout, fmtClock, fmtDist, fmtG, fmtGamma, fmtLight, fmtSpeed, fmtTime, sasLabel } from './Flight';

const CSS = `
.fl-panel { position: absolute; right: 10px; top: 76px; width: 300px; background: rgba(4, 10, 20, 0.72); border: 1px solid rgba(120, 220, 255, 0.35);
  border-radius: 8px; padding: 8px 11px; font: 12px/1.45 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; color: #cfe8ff; pointer-events: none; }
.fl-panel .t { color: #7fd4ff; font-weight: 700; letter-spacing: 0.08em; font-size: 11px; display: flex; justify-content: space-between; }
.fl-panel .row { display: flex; justify-content: space-between; gap: 8px; }
.fl-panel .k { color: #7f9bb8; }
.fl-panel .v { color: #fff; text-align: right; }
.fl-panel .bad { color: #ff7a6a; }
.fl-panel .ok { color: #9dff8a; }
.fl-panel .bar { height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; margin: 2px 0 4px; overflow: hidden; }
.fl-panel .bar i { display: block; height: 100%; background: #7fd4ff; }
.fl-panel .sep { border-top: 1px solid rgba(120, 220, 255, 0.18); margin: 4px 0; }
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
.fl-touch { position: absolute; right: 10px; top: 76px; width: 300px; box-sizing: border-box; display: flex; align-items: center; gap: 8px;
  font: 13px/1 system-ui, sans-serif; color: #cfe8ff; }
.fl-touch b { flex: 1; font-weight: 600; text-shadow: 0 0 4px #000; }
.fl-touch b, .fl-touch span { align-self: stretch; display: flex; align-items: center; padding: 0 8px; border-radius: 8px; background: rgba(4, 10, 20, 0.72); }
#hud .fl-touch button { pointer-events: auto; min-width: 48px; height: 36px; border-radius: 8px; border: 1px solid rgba(120, 220, 255, 0.45); background: rgba(4, 10, 20, 0.8);
  color: #fff; font: 600 18px/1 system-ui, sans-serif; touch-action: manipulation; }
.fl-touch span { min-width: 84px; justify-content: center; font: 600 13px/1 ui-monospace, 'SF Mono', Menlo, monospace; }
#hud.touch .fl-panel { top: 120px; }
@media (max-width: 520px) {
  .fl-panel, #hud.touch .fl-panel { left: 8px; right: 8px; width: auto; top: 64px; font-size: 11px; line-height: 1.3; }
  #hud.touch .fl-panel { top: 104px; }
  .fl-touch { left: 8px; right: 8px; width: auto; top: 62px; }
  /* (the search and the settings take the whole screen: the instruments step aside for them) */
  #hud:is([data-sheet='explore'], [data-sheet='more']) :is(.fl-panel, .fl-touch) { display: none; }
  .fl-warn { font-size: 15px; top: auto; bottom: 40%; }
  .fl-end h1 { font-size: 34px; }
}
@media (max-width: 520px), (pointer: coarse) { .fl-keys { display: none; } }
`;

/**
 * Flight instruments (desk and phone): orbit, speeds (as a fraction of light's when fast, with the
 * Lorentz factor), engine, the target with the time to it in both clocks, the ship's clock and the
 * universe's; warnings; the end-of-flight card.
 */
export class FlightHud {
  private el: HTMLElement;
  private panel: HTMLElement;
  private warn: HTMLElement;
  private end: HTMLElement;
  private keys: HTMLElement;
  private drive: HTMLElement;
  private timer = 0;
  private lastWarn = '';

  /** `stepDrive`: the touch buttons' step of the reactionless drive's setting */
  constructor(root: HTMLElement, stepDrive: (up: boolean) => void) {
    if (!document.getElementById('flight-css')) {
      const st = document.createElement('style');
      st.id = 'flight-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.className = 'flight-hud';
    this.el.innerHTML = `<div class="fl-panel"></div><div class="fl-warn"></div><div class="fl-end"><h1></h1><p></p></div>
      <div class="fl-touch touch-only"><b>Reactionless drive</b><button type="button" data-step="down" aria-label="Weaker">−</button><span></span><button type="button" data-step="up" aria-label="Stronger">+</button></div>
      <div class="fl-keys"><b>W/S</b> throttle · <b>Z/X</b> full/cut · <b>arrows/drag</b> pitch-yaw · <b>Q/E</b> roll<br>
      <b>A/D R/F Shift+W/S</b> RCS · <b>Y</b> SAS mode · <b>I</b> drive · <b>= -</b> its setting · <b>[ ]</b> time warp · <b>J</b> autopilot</div>`;
    root.appendChild(this.el);
    this.panel = this.el.querySelector('.fl-panel')!;
    this.warn = this.el.querySelector('.fl-warn')!;
    this.end = this.el.querySelector('.fl-end')!;
    this.keys = this.el.querySelector('.fl-keys')!;
    this.drive = this.el.querySelector('.fl-touch span')!;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.fl-touch button')) b.addEventListener('click', () => stepDrive(b.dataset.step === 'up'));
    this.setVisible(false);
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? '' : 'none';
  }

  /** End-of-flight card: title/text with opacity 0..1. */
  setEnd(title: string, text: string, opacity: number): void {
    (this.end.querySelector('h1') as HTMLElement).textContent = title;
    (this.end.querySelector('p') as HTMLElement).textContent = text;
    this.end.style.opacity = String(opacity);
    this.end.style.transition = opacity > 0 ? 'opacity 0.6s' : 'none';
  }

  update(dt: number, r: FlightReadout, showKeys: boolean): void {
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
    const c = r.conic;
    this.drive.textContent = fmtG(r.driveG);
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
    const warp = r.rate <= 0 ? 'paused' : `×${r.rate.toLocaleString()}${r.rails ? ' rails' : r.rate > 1 ? ' physics' : ''}${r.limited ? ' (limited)' : ''}`;
    const dil = r.dilation < 0.9999 ? ` <span class="bad">×${r.dilation < 1e-3 ? r.dilation.toExponential(2) : r.dilation.toPrecision(3)}</span>` : '';
    const torch = r.drive === 'torch';
    const fast = r.properSpeed > 0.01 * C;
    // what speed does to the view ahead (shown once it is a tenth of light's)
    const ahead = r.properSpeed > 0.1 * C
      ? row('ahead', `half the sky in ${fmtAngle(r.halfSky)} · ×${fmtFactor(r.doppler)} bluer`) : '';
    let target = '';
    if (r.target) {
      target = `<div class="sep"></div>${row('target', `${esc(r.target)} · ${fmtDist(r.targetDist)}`)}`;
      if (Number.isFinite(r.etaShip)) target += row(`to go (${r.etaBy})`, `${fmtTime(r.etaShip)} <span class="k">aboard ·</span> ${fmtTime(r.etaUniverse)} <span class="k">universe</span>`);
      // (far short of it, as at a galaxy: the times are to there, not to the target itself)
      if (r.arrival > 0.05 * r.targetDist) target += row('stopping', `${fmtDist(r.arrival)} <span class="k">short of it</span>`);
    }
    const ap = r.refusal && !r.autopilot ? row('autopilot', r.refusal.startsWith('In the air') ? 'in the air' : 'drive too weak here', 'bad') : row('autopilot', r.autopilot ? esc(r.autopilot) : r.target ? 'ready (J)' : 'select a target', r.autopilot || r.target ? 'ok' : '');
    this.panel.innerHTML = `
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
      ${row('universe clock', fmtClock(r.universeTime))}`;
  }
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
