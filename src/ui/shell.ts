/**
 * UI shell: start screen (with the mode switcher), HUD, info card, toasts,
 * perf overlay, photo mode and the first-run tutorial.
 */
import { formatDistance, formatSpeed } from '../core/units';
import { modes } from '../modes/registry';
import { platform } from '../platform';
import { type AppState, type ScaleLevel, appState } from '../state/appState';
import { actions } from './actions';
import { cls, el, esc, setChildren } from './dom';
import { mountPanels } from './panels';

const SCALE_ORDER: ScaleLevel[] = ['surface', 'planet', 'system', 'galaxy', 'cluster', 'universe'];
const SCALE_LABEL: Record<ScaleLevel, string> = { surface: 'On the surface', planet: 'Planet', system: 'Star system', galaxy: 'Galaxy', cluster: 'Galaxy cluster', universe: 'Universe' };
const TIME_STEPS: Array<[number, string, string]> = [
  [0, '⏸', 'Pause time'],
  [1, '1×', 'Real time'],
  [3600, '▶▶', 'Fast: one hour per second'],
  [86_400, '▶▶▶', 'Very fast: one day per second'],
  [2_592_000, '⏩', 'Ludicrous: one month per second'],
];

function tap(): void {
  actions.userGesture();
  platform.audio.playEffect('tap');
  if (appState.get().settings.haptics) platform.haptics.fire('tap');
}

function startScreen(root: HTMLElement): void {
  let chosen = 'explore';
  const cards = el('div', { class: 'sf-modes' });
  const renderCards = (): void => {
    setChildren(
      cards,
      modes.list().map((m) =>
        el('button', {
          class: `sf-mode${m.id === chosen ? ' sf-selected' : ''}`, disabled: !m.available, title: m.available ? m.title : `${m.title} — coming soon`,
          onClick: () => {
            if (!m.available) return;
            chosen = m.id;
            tap();
            renderCards();
          },
        }, [
          el('span', { class: 'sf-mode-icon', text: m.icon }), el('b', { text: m.title }), el('span', { class: 'sf-mode-sub', text: m.tagline }),
          !m.available && el('span', { class: 'sf-soon', text: 'Coming soon' }),
        ]),
      ),
    );
  };
  renderCards();
  const bar = el('i');
  const status = el('p', { class: 'sf-status' });
  const error = el('p', { class: 'sf-error', hidden: true });
  const cta = el('button', {
    class: 'sf-cta', text: 'Loading…', disabled: true,
    onClick: () => {
      tap();
      actions.start(chosen);
    },
  });
  const credit = el('div', { class: 'sf-credit', text: 'Real stars and galaxies: ESA Gaia · Hipparcos · SDSS · 2MASS · NASA Exoplanet Archive · OpenNGC' });
  const screen = el('div', { class: 'sf-start' }, [
    el('h1', { class: 'sf-logo', text: 'Starfarer' }),
    el('p', { class: 'sf-tagline', text: 'The whole universe is yours to wander — from the surface of a distant moon to the cosmic web.' }),
    cards, cta, el('div', { class: 'sf-progress' }, [bar]), status, error, credit,
  ]);
  root.append(screen);
  appState.subscribe((s, prev) => {
    if (s.loadProgress !== prev.loadProgress || s.loadStatus !== prev.loadStatus || s.screen !== prev.screen || s.fatalError !== prev.fatalError) update(s);
  });
  const update = (s: AppState): void => {
    bar.style.width = `${Math.round(s.loadProgress * 100)}%`;
    status.textContent = s.screen === 'start' ? 'Ready when you are.' : s.loadStatus;
    cta.disabled = s.screen !== 'start';
    cta.textContent = s.screen === 'start' ? 'Start exploring' : 'Loading…';
    cls(screen, 'sf-out', s.screen === 'explore' || s.screen === 'photo');
    if (s.fatalError) {
      error.hidden = false;
      error.textContent = `Starfarer can’t start here: ${s.fatalError}`;
      cta.hidden = true;
      status.hidden = true;
    }
  };
  update(appState.get());
}

function hud(root: HTMLElement): void {
  const crumbs = el('div', { class: 'sf-crumbs' });
  const scaleBars = SCALE_ORDER.map(() => el('i'));
  const scaleLabel = el('div', { class: 'sf-scale-label' });
  const where = el('div', { class: 'sf-where sf-glass', title: 'Where you are' }, [crumbs, el('div', { class: 'sf-scale' }, scaleBars), scaleLabel]);
  const panelButton = (icon: string, title: string, panel: AppState['panel']): HTMLButtonElement =>
    el('button', {
      class: 'sf-icon', text: icon, title,
      onClick: () => {
        tap();
        platform.audio.playEffect('open');
        appState.set({ panel: appState.get().panel === panel ? 'none' : panel });
      },
    });
  const buttons = el('div', { class: 'sf-buttons' }, [
    panelButton('🔍', 'Search', 'search'), panelButton('⭐', 'Bookmarks', 'bookmarks'),
    el('button', { class: 'sf-icon', text: '📷', title: 'Photo mode', onClick: () => { tap(); actions.enterPhoto(); } }),
    panelButton('⚙️', 'Settings', 'settings'),
  ]);

  // ---- Throttle: drag up to fly forward, down to reverse, release anywhere to hold; double-tap to stop.
  const fill = el('div', { class: 'sf-throttle-fill' });
  const knob = el('div', { class: 'sf-throttle-knob', text: '•' });
  const throttle = el('div', { class: 'sf-throttle sf-glass', title: 'Throttle' }, [
    el('div', { class: 'sf-throttle-tip sf-t', text: 'Faster' }), el('div', { class: 'sf-throttle-track' }, [fill]), knob, el('div', { class: 'sf-throttle-tip sf-b', text: 'Reverse' }),
  ]);
  let dragging = false;
  let lastDown = 0;
  const setFromEvent = (ev: PointerEvent): void => {
    const r = throttle.getBoundingClientRect();
    const t = 1 - (ev.clientY - (r.top + 14)) / (r.height - 28);
    let v = Math.max(-1, Math.min(1, t * 2 - 1));
    if (Math.abs(v) < 0.08) v = 0; // dead zone around "stop"
    actions.setThrottle(v);
  };
  throttle.addEventListener('pointerdown', (ev) => {
    actions.userGesture();
    if (ev.timeStamp - lastDown < 320) {
      actions.setThrottle(0);
      lastDown = 0;
      return;
    }
    lastDown = ev.timeStamp;
    dragging = true;
    throttle.setPointerCapture(ev.pointerId);
    setFromEvent(ev);
  });
  throttle.addEventListener('pointermove', (ev) => {
    if (dragging) setFromEvent(ev);
  });
  const end = (): void => {
    dragging = false;
  };
  throttle.addEventListener('pointerup', end);
  throttle.addEventListener('pointercancel', end);

  const speedText = el('b');
  const altText = el('small');
  const speed = el('div', { class: 'sf-speed sf-glass' }, [speedText, altText]);
  const dateText = el('span', { class: 'sf-date' });
  const timeButtons = TIME_STEPS.map(([rate, label, title]) => el('button', { text: label, title, onClick: () => { tap(); actions.setTimeRate(rate); } }));
  const time = el('div', { class: 'sf-time sf-glass' }, [...timeButtons, dateText]);

  const chipText = el('span');
  const chip = el('div', { class: 'sf-chip sf-glass', hidden: true }, [
    chipText,
    el('button', { text: '✕', title: 'Release', onClick: () => { tap(); if (appState.get().flyingTo) actions.cancelFlight(); else actions.releaseFocus(); } }),
  ]);
  const dilation = el('div', { class: 'sf-dilation sf-glass', hidden: true });
  const offline = el('div', { class: 'sf-offline sf-glass', hidden: true, text: 'Offline — showing what’s already been explored' });
  const perf = el('div', { class: 'sf-perf sf-glass', hidden: true });
  const reticle = el('div', { class: 'sf-reticle' });
  const node = el('div', { class: 'sf-hud sf-hidden' }, [
    reticle, el('div', { class: 'sf-top' }, [where, buttons]), throttle, el('div', { class: 'sf-bottom-left' }, [speed, time]), chip, dilation, offline, perf,
  ]);
  root.append(node);

  const update = (s: AppState): void => {
    cls(node, 'sf-hidden', s.screen !== 'explore');
    const loc = s.location;
    crumbs.innerHTML = loc.length ? loc.map((n, i) => (i === loc.length - 1 ? esc(n) : `<span>${esc(n)} › </span>`)).join('') : '<span>Deep space</span>';
    const idx = SCALE_ORDER.indexOf(s.scale);
    scaleBars.forEach((b, i) => cls(b, 'sf-on', i === idx));
    scaleLabel.textContent = SCALE_LABEL[s.scale];
    speedText.textContent = formatSpeed(s.speed);
    altText.textContent = s.altitude !== null ? `${formatDistance(s.altitude)} above the surface` : '';
    altText.hidden = s.altitude === null;
    const y = (1 - (s.throttle + 1) / 2) * 100;
    knob.style.top = `calc(14px + (100% - 28px) * ${y / 100})`;
    knob.textContent = s.throttle > 0.02 ? '▲' : s.throttle < -0.02 ? '▼' : '•';
    fill.style.top = `${Math.min(y, 50)}%`;
    fill.style.bottom = `${Math.min(100 - y, 50)}%`;
    timeButtons.forEach((b, i) => cls(b, 'sf-on', TIME_STEPS[i]![0] === s.timeRate));
    dateText.textContent = new Date(s.simTime).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const label = s.flyingTo ? `Flying to ${s.flyingTo}…` : s.focusName ? `Orbiting ${s.focusName}` : '';
    chip.hidden = !label;
    chipText.textContent = label;
    cls(chip, 'sf-flying', Boolean(s.flyingTo));
    reticle.hidden = Boolean(s.selection) || Boolean(s.flyingTo);
    dilation.hidden = !(s.settings.showData && s.timeDilation !== null && s.timeDilation > 1.0005);
    if (!dilation.hidden) dilation.innerHTML = `Time dilation ×${s.timeDilation!.toFixed(s.timeDilation! < 10 ? 3 : 1)}<small>1 second here = ${s.timeDilation!.toFixed(2)} s far away</small>`;
    offline.hidden = s.online;
    perf.hidden = !s.settings.perfHud || !s.perf;
    if (s.perf && s.settings.perfHud) {
      const p = s.perf;
      perf.textContent = `${p.fps.toFixed(0)} fps  ${p.frameMs.toFixed(1)} ms\ntier ${p.tier}  scale ${(p.renderScale * 100).toFixed(0)}%\ndraw calls ${p.drawCalls}\npoints ${p.points.toLocaleString()}\ntriangles ${p.triangles.toLocaleString()}\ntiles ${p.tilesLoaded} (+${p.tilesPending})${p.memoryMb ? `\nheap ${p.memoryMb.toFixed(0)} MB` : ''}`;
    }
  };
  appState.subscribe(update);
  update(appState.get());
}

function infoCard(root: HTMLElement): void {
  const card = el('div', { class: 'sf-card sf-glass' });
  root.append(card);
  let shownId = '';
  const render = (s: AppState): void => {
    const sel = s.selection;
    cls(card, 'sf-show', Boolean(sel) && s.screen === 'explore' && s.panel === 'none');
    if (!sel) {
      shownId = '';
      return;
    }
    const rows = [{ label: 'Distance', value: formatDistance(sel.distance) }, ...(s.settings.showData ? sel.rows : [])];
    const signature = `${sel.id}|${s.settings.showData}|${sel.pending}|${sel.rows.length}|${sel.name}`;
    if (signature === shownId) {
      // Only the live numbers changed: update them in place (keeps scroll position and button focus).
      const dds = card.querySelectorAll('dd');
      rows.forEach((r, i) => {
        const dd = dds[i];
        if (dd && dd.firstChild && dd.firstChild.nodeValue !== r.value) dd.firstChild.nodeValue = r.value;
      });
      return;
    }
    shownId = signature;
    const dl = el('dl', { class: 'sf-rows' });
    for (const r of rows) dl.append(el('dt', { text: r.label }), el('dd', {}, [r.value, r.estimated ? el('em', { text: 'est.' }) : null]));
    setChildren(card, [
      el('button', { class: 'sf-close', text: '✕', title: 'Close', onClick: () => { tap(); actions.clearSelection(); } }),
      el('div', { class: 'sf-type' }, [sel.type, el('span', { class: `sf-badge ${sel.real ? 'sf-real' : 'sf-proc'}`, text: sel.real ? 'Real' : 'Imagined' })]),
      el('h2', { text: sel.name }),
      el('p', { text: sel.description }),
      dl,
      el('div', { class: 'sf-actions' }, [
        el('button', { class: 'sf-btn sf-primary', text: '🚀 Fly there', onClick: () => { tap(); actions.flyToSelection(); } }),
        sel.canLand ? el('button', { class: 'sf-btn', text: '🛬 Land', onClick: () => { tap(); actions.landOnSelection(); } }) : null,
        el('button', { class: 'sf-btn', text: '⭐ Save', onClick: () => { tap(); actions.bookmarkSelection(); } }),
        el('button', { class: 'sf-btn', text: '🔗 Share', onClick: () => { tap(); actions.shareView(); } }),
      ]),
      s.settings.showData ? el('div', { class: 'sf-source', text: sel.pending ? `${sel.source} · loading details…` : sel.source }) : null,
    ]);
  };
  appState.subscribe(render);
}

function toast(root: HTMLElement): void {
  const node = el('div', { class: 'sf-toast sf-glass' });
  root.append(node);
  let timer = 0;
  appState.select((s) => s.toast, (t) => {
    if (!t) return;
    node.textContent = t.text;
    cls(node, 'sf-show', true);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => cls(node, 'sf-show', false), 2600);
  });
}

function photoMode(root: HTMLElement): void {
  const flash = el('div', { class: 'sf-flash' });
  const node = el('div', { class: 'sf-photo', hidden: true }, [
    el('div', { class: 'sf-photo-tip sf-glass', text: 'Photo mode — drag to frame your shot' }),
    el('button', { class: 'sf-icon sf-photo-exit', text: '✕', title: 'Leave photo mode', onClick: () => { tap(); actions.exitPhoto(); } }),
    el('button', {
      class: 'sf-shutter', title: 'Take photo',
      onClick: () => {
        actions.userGesture();
        platform.audio.playEffect('shutter');
        flash.classList.remove('sf-go');
        void flash.offsetWidth; // restart the animation
        flash.classList.add('sf-go');
        actions.takePhoto();
      },
    }),
    flash,
  ]);
  root.append(node);
  appState.select((s) => s.screen, (screen) => {
    node.hidden = screen !== 'photo';
  });
}

const TUTORIAL: Array<[string, string, string]> = [
  ['👆', 'Look around', 'Drag with one finger (or the mouse) to look around. After you fly somewhere, dragging circles around it.'],
  ['🤏', 'Move', 'Pinch — or scroll — to glide toward what you’re looking at. The slider on the right is your throttle: push it up and go!'],
  ['✨', 'Discover', 'Tap anything that shines to learn what it is. Double-tap to fly straight to it.'],
  ['🔍', 'Go anywhere', 'Search for Saturn, Andromeda, Betelgeuse… or just wander. Every star you see is a place you can visit.'],
];

function onboarding(root: HTMLElement): void {
  let step = 0;
  const big = el('span', { class: 'sf-big' });
  const title = el('h3');
  const text = el('p');
  const dots = el('div', { class: 'sf-dots' }, TUTORIAL.map(() => el('i')));
  const next = el('button', { class: 'sf-btn sf-primary' });
  const skip = el('button', { class: 'sf-btn', text: 'Skip' });
  const node = el('div', { class: 'sf-onboard', hidden: true }, [el('div', { class: 'sf-onboard-card sf-glass' }, [big, title, text, dots, el('div', { class: 'sf-row' }, [skip, next])])]);
  root.append(node);
  const show = (): void => {
    const [icon, t, body] = TUTORIAL[step]!;
    big.textContent = icon;
    title.textContent = t;
    text.textContent = body;
    [...dots.children].forEach((d, i) => cls(d as HTMLElement, 'sf-on', i === step));
    next.textContent = step === TUTORIAL.length - 1 ? 'Let’s go!' : 'Next';
  };
  const finish = (): void => {
    node.hidden = true;
    appState.set({ onboardingDone: true });
  };
  next.addEventListener('click', () => {
    tap();
    if (step >= TUTORIAL.length - 1) finish();
    else {
      step++;
      show();
    }
  });
  skip.addEventListener('click', () => {
    tap();
    finish();
  });
  appState.select((s) => s.screen === 'explore' && !s.onboardingDone, (needed) => {
    if (needed) {
      step = 0;
      show();
      node.hidden = false;
    } else node.hidden = true;
  });
}

/** Build the whole UI under `root`. Returns the layer that hosts in-world labels. */
export function mountUI(root: HTMLElement): HTMLElement {
  const ui = el('div', { class: 'sf-ui' });
  const labels = el('div', { class: 'sf-labels' });
  ui.append(labels);
  root.append(ui);
  hud(ui);
  infoCard(ui);
  mountPanels(ui);
  toast(ui);
  photoMode(ui);
  onboarding(ui);
  startScreen(ui);
  appState.select((s) => s.screen, (screen) => {
    labels.hidden = screen !== 'explore';
  });
  return labels;
}
