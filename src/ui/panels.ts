/**
 * Slide-in panels: search, bookmarks & recents, settings, about.
 */
import { platform } from '../platform';
import { type AppState, type Panel, type QualitySetting, type SavedPlace, type Settings, appState, removeBookmark, updateSettings } from '../state/appState';
import { type SearchResult, actions } from './actions';
import { cls, el, setChildren } from './dom';

function close(): void {
  platform.audio.playEffect('close');
  appState.set({ panel: 'none' });
}

function panelFrame(title: string): { node: HTMLElement; body: HTMLElement } {
  const body = el('div', { class: 'sf-body' });
  const node = el('div', { class: 'sf-panel sf-glass' }, [el('header', {}, [el('h2', { text: title }), el('button', { text: '✕', title: 'Close', onClick: close })]), body]);
  return { node, body };
}

function resultList(results: SearchResult[], onPick: (r: SearchResult) => void): HTMLElement {
  return el('ul', { class: 'sf-list' }, results.map((r) =>
    el('li', { onClick: () => onPick(r) }, [el('span', { class: 'sf-li-icon', text: r.icon }), el('div', { class: 'sf-li-main' }, [el('b', { text: r.title }), el('small', { text: r.subtitle })])]),
  ));
}

function searchPanel(): { node: HTMLElement; onOpen: () => void } {
  const { node, body } = panelFrame('Search');
  const input = el('input', { class: 'sf-search-input', attrs: { type: 'search', placeholder: 'Saturn, Andromeda, Vega…', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'search' } });
  const hint = el('p', { class: 'sf-hint' });
  const out = el('div');
  const quick = el('div', { class: 'sf-actions' }, [
    el('button', { class: 'sf-btn', text: '🏠 Home (Earth)', onClick: () => { actions.goHome(); appState.set({ panel: 'none' }); } }),
    el('button', { class: 'sf-btn', text: '🎲 Surprise me', onClick: () => { actions.surpriseMe(); appState.set({ panel: 'none' }); } }),
  ]);
  setChildren(body, [input, quick, hint, out]);
  const pick = (r: SearchResult): void => {
    actions.userGesture();
    platform.audio.playEffect('select');
    input.blur();
    appState.set({ panel: 'none' });
    actions.openResult(r);
  };
  let serial = 0;
  let timer = 0;
  const idleHint = 'Try a planet, star, galaxy or nebula — or type coordinates like “RA 10h 08m, Dec +12°, 79 ly”, or any word to use as a seed.';
  const run = (): void => {
    const q = input.value.trim();
    const mine = ++serial;
    if (!q) {
      hint.textContent = idleHint;
      setChildren(out, []);
      return;
    }
    hint.textContent = 'Searching…';
    actions.search(q, (results, done) => {
      if (mine !== serial) return; // a newer query superseded this one
      setChildren(out, [resultList(results, pick)]);
      hint.textContent = results.length ? (done ? '' : 'Searching the full catalogue…') : done ? 'Nothing by that name — but press Enter to visit the place this word leads to.' : 'Searching…';
    });
  };
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, 140);
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      const first = out.querySelector('li');
      if (first) (first as HTMLElement).click();
    } else if (ev.key === 'Escape') close();
  });
  hint.textContent = idleHint;
  return {
    node,
    onOpen: () => {
      // Focus after the slide-in so mobile keyboards do not fight the animation.
      window.setTimeout(() => input.focus(), 250);
      input.select();
    },
  };
}

function placeList(places: SavedPlace[], icon: string, empty: string, removable: boolean): HTMLElement {
  if (places.length === 0) return el('p', { class: 'sf-hint', text: empty });
  return el('ul', { class: 'sf-list' }, places.map((p) =>
    el('li', { onClick: () => { actions.userGesture(); appState.set({ panel: 'none' }); actions.openPlace(p); } }, [
      el('span', { class: 'sf-li-icon', text: icon }),
      el('div', { class: 'sf-li-main' }, [el('b', { text: p.name }), el('small', { text: p.detail })]),
      removable ? el('button', { class: 'sf-li-del', text: '🗑', title: 'Remove bookmark', onClick: (ev) => { ev.stopPropagation(); removeBookmark(p.link); } }) : null,
    ]),
  ));
}

function bookmarksPanel(): HTMLElement {
  const { node, body } = panelFrame('Places');
  let tab: 'bookmarks' | 'recents' = 'bookmarks';
  const tabs = el('div', { class: 'sf-tabs' });
  const out = el('div');
  const save = el('button', { class: 'sf-btn sf-primary', text: '⭐ Bookmark this view', onClick: () => { actions.userGesture(); actions.bookmarkView(); } });
  const render = (): void => {
    const s = appState.get();
    setChildren(tabs, [
      el('button', { class: tab === 'bookmarks' ? 'sf-on' : '', text: `Bookmarks (${s.bookmarks.length})`, onClick: () => { tab = 'bookmarks'; render(); } }),
      el('button', { class: tab === 'recents' ? 'sf-on' : '', text: 'Recent', onClick: () => { tab = 'recents'; render(); } }),
    ]);
    setChildren(out, [
      tab === 'bookmarks'
        ? placeList(s.bookmarks, '⭐', 'No bookmarks yet. Find somewhere wonderful and save it!', true)
        : placeList(s.recents, '🕘', 'Places you fly to will show up here.', false),
    ]);
  };
  setChildren(body, [tabs, el('div', { class: 'sf-actions' }, [save]), out]);
  appState.subscribe((s, prev) => {
    if (s.bookmarks !== prev.bookmarks || s.recents !== prev.recents) render();
  });
  render();
  return node;
}

function settingsPanel(): HTMLElement {
  const { node, body } = panelFrame('Settings');
  const toggle = (key: keyof Settings, title: string, sub: string): HTMLElement => {
    const sw = el('button', { class: 'sf-switch', title, attrs: { role: 'switch' } });
    sw.addEventListener('click', () => {
      actions.userGesture();
      updateSettings({ [key]: !appState.get().settings[key] } as Partial<Settings>);
      platform.audio.playEffect('toggle');
    });
    appState.select((s) => s.settings[key], (v) => {
      cls(sw, 'sf-on', Boolean(v));
      sw.setAttribute('aria-checked', String(Boolean(v)));
    });
    return el('div', { class: 'sf-setting' }, [el('div', {}, [el('b', { text: title }), el('small', { text: sub })]), sw]);
  };
  const qualities: Array<[QualitySetting, string]> = [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High']];
  const seg = el('div', { class: 'sf-seg' }, qualities.map(([q, label]) => el('button', { text: label, onClick: () => { actions.userGesture(); updateSettings({ quality: q }); } })));
  appState.select((s) => s.settings.quality, (q) => {
    [...seg.children].forEach((b, i) => cls(b as HTMLElement, 'sf-on', qualities[i]![0] === q));
  });
  setChildren(body, [
    el('div', { class: 'sf-section', text: 'Explore' }),
    toggle('showData', 'Show data', 'Real numbers: distance, temperature, mass, redshift…'),
    toggle('labels', 'Names', 'Label planets, bright stars and galaxies'),
    toggle('constellations', 'Constellations', 'Draw the constellation figures'),
    toggle('orbits', 'Orbits', 'Show the paths of planets and moons'),
    el('div', { class: 'sf-section', text: 'Display & sound' }),
    el('div', { class: 'sf-setting' }, [el('div', {}, [el('b', { text: 'Quality' }), el('small', { text: 'Auto keeps things smooth on your device' })]), seg]),
    toggle('sound', 'Sound', 'Ambient music and effects'),
    toggle('haptics', 'Vibration', 'Little taps when you touch things'),
    toggle('perfHud', 'Performance overlay', 'Frames per second, draw calls, point count'),
    el('div', { class: 'sf-section', text: 'More' }),
    el('div', { class: 'sf-actions' }, [
      el('button', { class: 'sf-btn', text: '🎓 Replay tutorial', onClick: () => appState.set({ onboardingDone: false, panel: 'none' }) }),
      el('button', { class: 'sf-btn', text: 'ℹ️ About & credits', onClick: () => appState.set({ panel: 'about' }) }),
    ]),
  ]);
  return node;
}

function aboutPanel(): HTMLElement {
  const { node, body } = panelFrame('About Starfarer');
  const stats = el('div', { class: 'sf-stats' });
  const fmt = (n: number | undefined): string => (n ?? 0).toLocaleString();
  appState.select((s) => s.dataTotals, (t) => {
    if (!t) return;
    setChildren(stats, [
      el('div', {}, [el('b', { text: fmt(t.stars) }), el('small', { text: 'real stars' })]),
      el('div', {}, [el('b', { text: fmt(t.galaxies) }), el('small', { text: 'real galaxies' })]),
      el('div', {}, [el('b', { text: fmt(t.quasars) }), el('small', { text: 'real quasars' })]),
      el('div', {}, [el('b', { text: fmt(t.exoplanets) }), el('small', { text: 'confirmed exoplanets' })]),
    ]);
  });
  body.classList.add('sf-about');
  setChildren(body, [
    el('p', { text: 'Starfarer puts real astronomical catalogues at their true places in space, then fills everything nobody has charted yet with a deterministic, procedurally generated universe — the same for everyone, forever.' }),
    stats,
    el('p', { html: 'Things marked <b>Real</b> come from the catalogues below. Things marked <b>Imagined</b> are generated: plausible, but not observed. For real stars and exoplanets, values marked “est.” are standard estimates from measured brightness and colour; surface appearances of exoplanets are artist’s impressions.' }),
    el('div', { class: 'sf-section', text: 'Data & acknowledgements' }),
    el('p', { html: 'This work has made use of data from the European Space Agency (ESA) mission <i>Gaia</i> (<a href="https://www.cosmos.esa.int/gaia" target="_blank" rel="noopener">cosmos.esa.int/gaia</a>), processed by the <i>Gaia</i> Data Processing and Analysis Consortium (DPAC). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the <i>Gaia</i> Multilateral Agreement.' }),
    el('p', { html: 'Hipparcos (ESA 1997; van Leeuwen 2007) · Gaia Catalogue of Nearby Stars (Gaia Collaboration, Smart et al. 2021) · 2MASS Redshift Survey (Huchra et al. 2012) · Updated Nearby Galaxy Catalog (Karachentsev et al. 2013) · SDSS DR17 and the DR16 quasar catalogue (Lyke et al. 2020) · NASA Exoplanet Archive · OpenNGC by Mattia Verga (CC BY-SA 4.0) · Harris globular clusters · Hunt & Reffert (2023) star clusters · ATNF Pulsar Catalogue · IAU star names · Stellarium constellation figures · JPL Horizons. Catalogue access via VizieR (CDS, Strasbourg).' }),
    el('p', { html: 'Funding for the Sloan Digital Sky Survey IV has been provided by the Alfred P. Sloan Foundation, the U.S. Department of Energy Office of Science, and the Participating Institutions. This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology under contract with NASA.' }),
    el('p', { class: 'sf-hint', text: 'Full sources and licenses are in the project README.' }),
  ]);
  return node;
}

/** Mount all panels and the scrim behind them. */
export function mountPanels(root: HTMLElement): void {
  const scrim = el('div', { class: 'sf-scrim', onClick: close });
  const search = searchPanel();
  const panels: Record<Exclude<Panel, 'none'>, HTMLElement> = { search: search.node, bookmarks: bookmarksPanel(), settings: settingsPanel(), about: aboutPanel() };
  root.append(scrim, ...Object.values(panels));
  appState.select((s: AppState) => s.panel, (panel) => {
    cls(scrim, 'sf-show', panel !== 'none');
    for (const [name, node] of Object.entries(panels)) cls(node, 'sf-show', name === panel);
    if (panel === 'search') search.onOpen();
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && appState.get().panel !== 'none') close();
  });
}
