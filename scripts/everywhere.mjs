// The same works-everywhere sweep at every kind of place, on a 390 x 844 touch page. Search by the
// name a person types, open the card, go there, tap the thing itself, check which powers work and
// tap every other for its reason, use Move and Mass with Undo where offered, and open a shared link.
// Usage: node scripts/everywhere.mjs [baseUrl] [outDir] [solar|stars|planets|deep|all]
//   EVERYWHERE_ONLY=Earth,Gl 9848 b runs just those places while developing; the four parts together are the suite.
import { collectErrors, launchBrowser, openCard } from './lib/browser.mjs';
import { fingers, phoneContext } from './lib/touch.mjs';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'screenshots';
const part = process.argv[4] ?? 'all';
const START = '2026-10-01T20:00:00Z';
const SEARCH_WAIT = 30_000;
const ARRIVAL_WAIT = 600_000;

// The powers that work today, from the support matrix in docs/notes/works-everywhere.md. Every other
// power must remain visible and dimmed, and tapping it must show its own short reason.
const POWERS = {
  planet: ['Mass', 'Size', 'Move', 'Add', 'Remove'],
  moon: ['Mass', 'Size', 'Move', 'Remove'],
  sun: ['Mass', 'Move', 'Add', 'Remove'],
  dwarf: ['Mass', 'Size', 'Move', 'Add', 'Remove'],
  // another star's planets and their star, under live physics one system at a time (src/universe/PlanetarySim.ts): Size
  // only for a planet measured in transit, Add round the Sun only
  transiting: ['Mass', 'Size', 'Move', 'Remove'],
  exoplanet: ['Mass', 'Move', 'Remove'],
  host: ['Mass', 'Move', 'Remove'],
  // a comet can be taken away, moved and thrown (task/comet-powers); Mass, Size and Add stay off, each with its reason
  comet: ['Move', 'Remove'],
  none: [],
};

const PLACES = [
  { part: 'solar', label: 'Earth', query: 'Earth', rows: ['Earth'], powers: POWERS.planet },
  { part: 'solar', label: 'Moon', query: 'Moon', rows: ['Moon'], powers: POWERS.moon },
  { part: 'solar', label: 'Sun', query: 'Sun', rows: ['Sun'], powers: POWERS.sun },
  { part: 'solar', label: 'Jupiter', query: 'Jupiter', rows: ['Jupiter'], powers: POWERS.planet },
  { part: 'solar', label: 'Ceres', query: 'Ceres', rows: ['Ceres'], powers: POWERS.dwarf },
  { part: 'solar', label: 'Halley', query: 'Halley', rows: ['1P/Halley'], fallback: '1P/Halley', powers: POWERS.comet },
  { part: 'stars', label: 'Sirius', query: 'Sirius', rows: ['Sirius'], powers: POWERS.none },
  { part: 'stars', label: 'Betelgeuse', query: 'Betelgeuse', rows: ['Betelgeuse'], powers: POWERS.none },
  // Alpha Centauri is the system name people type; today's catalogue calls its two stars Rigil
  // Kentaurus and Toliman. Either real catalogue entry is a valid answer to that name.
  // (Rigil Kentaurus is within 10 pc and has no planets in the archive: a star people know gets no made-up ones)
  { part: 'stars', label: 'Alpha Centauri', query: 'Alpha Centauri', rows: ['Rigil Kentaurus', 'Toliman', 'Alpha Centauri'], fallback: 'Rigil Kentaurus', powers: POWERS.none },
  { part: 'stars', label: 'TRAPPIST-1 (the star)', query: 'TRAPPIST-1', rows: ['TRAPPIST-1'], powers: POWERS.host },
  { part: 'planets', label: 'Proxima Cen b', query: 'Proxima Cen b', rows: ['Proxima Cen b'], powers: POWERS.exoplanet },
  { part: 'planets', label: 'TRAPPIST-1 e', query: 'TRAPPIST-1 e', rows: ['TRAPPIST-1 e'], powers: POWERS.transiting },
  { part: 'planets', label: '51 Peg b', query: '51 Peg b', rows: ['51 Peg b'], powers: POWERS.exoplanet },
  // (a made-up planet: of a faint star far off, Gl 9848, 56 pc and magnitude 11; a star people know gets none, Vega included)
  { part: 'planets', label: 'Gl 9848 b (generated)', query: 'Gl 9848 b', rows: ['Gl 9848 b'], powers: POWERS.exoplanet },
  { part: 'deep', label: 'deep space', openSpace: true },
  { part: 'deep', label: 'Sagittarius A*', query: 'Sagittarius A*', rows: ['Sagittarius A*'], powers: POWERS.none },
  { part: 'deep', label: 'Cygnus X-1', query: 'Cygnus X-1', rows: ['Cygnus X-1'], detail: /^black hole$/, powers: POWERS.none },
  { part: 'deep', label: 'inside the Orion Nebula', query: 'Orion Nebula', rows: ['Orion Nebula'], inside: true, powers: POWERS.none },
  { part: 'deep', label: 'beside Andromeda', query: 'Andromeda', rows: ['Andromeda Galaxy'], fallback: 'Andromeda Galaxy', powers: POWERS.none },
  { part: 'deep', label: 'Milky Way', query: 'Milky Way', rows: ['Milky Way'], powers: POWERS.none },
];

const only = (process.env.EVERYWHERE_ONLY ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const places = PLACES.filter((p) => (part === 'all' || p.part === part) && (!only.length || only.some((n) => [p.label, p.query, p.fallback].includes(n))));
if (!['all', 'solar', 'stars', 'planets', 'deep'].includes(part) || !places.length) {
  console.error(`no places for part "${part}"${only.length ? ` and EVERYWHERE_ONLY=${only.join(',')}` : ''}`);
  process.exit(2);
}

fs.mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser();
const results = [];
const check = (place, name, ok, detail = '') => {
  results.push({ part: place.part, place: place.label, name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${place.label}: ${name}${detail ? ` ${detail}` : ''}`);
};

const frames = async (page, n) => {
  const f = await page.evaluate(() => window.app.frameCount);
  await page.waitForFunction((x) => window.app.frameCount >= x, f + n, { timeout: 600000, polling: 50 });
};
const until = (page, test, arg = null, timeout = ARRIVAL_WAIT) => page.waitForFunction(test, arg, { timeout, polling: 100 }).then(() => true, () => false);
const shown = (page, sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  return !!el && !el.hidden && !el.closest('[hidden]') && el.getBoundingClientRect().height > 0;
}, sel);
// What is under the card's bar is one tap on the bar away.
const press = async (page, sel) => {
  if (/\.card \[data-(power|act="(move|remove|share|centre)")/.test(sel)) await openCard(page);
  const b = page.locator(sel).first();
  await b.scrollIntoViewIfNeeded();
  // An unavailable power is deliberately still a real tap target: it explains itself. Playwright
  // otherwise treats aria-disabled as a reason not to touch it at all.
  const force = (await b.getAttribute('aria-disabled')) === 'true';
  await b.tap({ timeout: 120000, force }).catch(() => b.click({ timeout: 120000, force }));
};

async function openPage(url, errors) {
  const ctx = await phoneContext(browser);
  // Headless Chromium has no system share sheet. Keep exactly what the app hands to it.
  await ctx.addInitScript(() => {
    window.shared = [];
    navigator.share = async (data) => { window.shared.push({ ...data }); };
    navigator.canShare = () => true;
  });
  const page = await ctx.newPage();
  collectErrors(page, errors);
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => (window.app && window.app.frameCount > 30 && !document.getElementById('boot')) || window.appError, null, { timeout: 600000 });
  const appError = await page.evaluate(() => window.appError ?? '');
  if (appError) throw new Error(String(appError));
  return { ctx, page, touch: await fingers(page) };
}

async function drain(page) {
  // A page left while its star regions are arriving can otherwise report the cancelled downloads.
  await page.waitForFunction(() => !window.app?.debugState || window.app.debugState().pendingTiles === 0, null, { timeout: 180000 }).catch(() => undefined);
}
async function close(session) {
  if (!session?.ctx) return;
  await drain(session.page).catch(() => undefined);
  await session.ctx.close().catch(() => undefined);
  session.ctx = null;
}

async function shot(page, place, suffix) {
  const slug = place.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await page.screenshot({ path: path.join(outDir, `everywhere-${part}-${slug}-${suffix}.png`), timeout: 180000 })
    .catch((e) => console.log(`NOTE ${place.label}: picture failed: ${String(e).split('\n')[0]}`));
}

const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rowsNow = (page) => page.evaluate(() => [...document.querySelectorAll('#hud .explore .list .row')].map((r) => ({
  name: r.querySelector('b')?.textContent ?? '', detail: r.querySelector('small')?.textContent ?? '',
})));

/** Find by the typed name and choose a real result. If there is none, report it and use the named object for the later checks. */
async function searchAndSelect(page, place) {
  if (!(await shown(page, '#hud .sheet.explore.on'))) await press(page, '#hud .hud-tabs [data-tab="search"]');
  await page.locator('#hud .searchbox input').fill(place.query);
  const names = new RegExp(`^(?:${place.rows.map(escaped).join('|')})$`);
  let rows = page.locator('#hud .explore .list .row').filter({ has: page.locator('b', { hasText: names }) });
  if (place.detail) rows = rows.filter({ has: page.locator('small', { hasText: place.detail }) });
  const row = rows.first();
  const found = await row.waitFor({ timeout: SEARCH_WAIT }).then(() => true, () => false);
  let selected = null;
  if (found) {
    await row.tap({ timeout: 120000 }).catch(() => row.click({ timeout: 120000 }));
    await until(page, () => !!window.app.selection && document.querySelector('#hud').dataset.sheet === 'card', null, 120000);
    selected = await page.evaluate(() => window.app.selection?.name ?? null);
  }
  const accepted = new Set([...place.rows, place.fallback].filter(Boolean));
  const ok = found && selected && accepted.has(selected);
  if (!ok) {
    const rowsSeen = await rowsNow(page);
    const fallback = place.fallback ?? place.rows[0];
    const direct = await page.evaluate((name) => {
      const a = window.app, o = a.findByName(name);
      if (!o) return false;
      a.select(o);
      a.goTo(o);
      return true;
    }, fallback);
    if (!direct) return { ok: false, selected, detail: JSON.stringify({ query: place.query, found, selected, rows: rowsSeen, fallback: 'not found' }) };
    selected = fallback;
    return { ok: false, selected, detail: JSON.stringify({ query: place.query, found, selected, rows: rowsSeen, fallback }) };
  }
  // A result starts flying as soon as it is picked. Stop that flight so the next check really uses Go there.
  if (await shown(page, '#hud .hud-flight')) await press(page, '#hud .hud-flight [data-act="stop"]').catch(() => undefined);
  await frames(page, 2);
  await page.evaluate(() => { window.__everywhereObject = window.app.selection; });
  return { ok: true, selected, detail: JSON.stringify({ query: place.query, selected }) };
}

async function ensureObject(page, place) {
  // Also used after a failed pick: the failure stays recorded, while the remaining checks still concern the intended place.
  const has = await page.evaluate(() => !!window.__everywhereObject);
  if (has) return true;
  const name = place.fallback ?? place.rows[0];
  return page.evaluate((name) => {
    const a = window.app, o = a.findByName(name);
    if (!o) return false;
    window.__everywhereObject = o;
    a.select(o);
    a.goTo(o);
    return true;
  }, name);
}

async function cardTitle(page) {
  await until(page, () => {
    const a = window.app, o = window.__everywhereObject;
    return !!o && a.selection === o && document.querySelector('#hud').dataset.sheet === 'card' && document.querySelector('#hud .card h2').textContent === o.name;
  }, null, 120000);
  return page.evaluate(() => ({
    title: document.querySelector('#hud .card h2')?.textContent ?? '', selection: window.app.selection?.name ?? null,
    expected: window.__everywhereObject?.name ?? null, sheet: document.querySelector('#hud').dataset.sheet ?? null,
  }));
}

async function goThere(page, place) {
  const f0 = await page.evaluate(() => window.app.frameCount);
  await press(page, '#hud .card [data-act="go"]');
  const arrived = await until(page, () => {
    const a = window.app, o = window.__everywhereObject;
    return !!o && a.rig.target === o && !a.rig.autopilot;
  });
  await frames(page, 2);
  const state = await page.evaluate(() => {
    const a = window.app, o = window.__everywhereObject, V = a.rig.forward().constructor;
    return {
      frame: a.frameCount, selected: a.selection?.key ?? null, expected: o?.key ?? null,
      target: a.rig.target?.key ?? null, autopilot: !!a.rig.autopilot, here: a.hud.state.selection?.here ?? false,
      distance: o ? o.upos.sub(a.rig.upos, new V()).length() : 0,
    };
  });
  return { ok: arrived && state.target === state.expected && state.selected === state.expected && state.here, frames: state.frame - f0, state };
}

async function tapSelect(page, place, touch) {
  await press(page, '#hud .card [data-act="deselect"]');
  await until(page, () => !window.app.selection, null, 20000);
  await frames(page, 4);
  const at = await page.evaluate(() => {
    const a = window.app, o = window.__everywhereObject, V = a.rig.forward().constructor;
    if (!o) return null;
    const p = a.project(o.upos.sub(a.rig.upos, new V()));
    return p ? { ...p, width: innerWidth, height: innerHeight } : null;
  });
  if (at && at.x >= 0 && at.x <= at.width && at.y >= 0 && at.y <= at.height) await touch.tap(at);
  await frames(page, 2);
  const got = await page.evaluate(() => ({ key: window.app.selection?.key ?? null, name: window.app.selection?.name ?? null, expected: window.__everywhereObject?.key ?? null }));
  const ok = !!at && got.key === got.expected;
  if (!ok) {
    await shot(page, place, 'pick');
    await page.evaluate(() => { const a = window.app; a.select(window.__everywhereObject ?? null); });
    await frames(page, 2);
  }
  return { ok, at, got };
}

/** Changes not watched: the camera and clock must stay still while the two powers are checked. */
async function quiet(page) {
  await press(page, '#hud .hud-tabs [data-tab="more"]');
  if ((await page.locator('#hud .switch[data-act="show-me"]').getAttribute('aria-checked')) === 'true') await press(page, '#hud .switch[data-act="show-me"]');
  await press(page, '#hud .sheet.more [data-close]');
  await frames(page, 2);
}

const POWER_BUTTONS = [
  ['Mass', '[data-power="mass"]'], ['Size', '[data-power="size"]'], ['Move', '[data-act="move"]'],
  ['Add', '[data-power="add"]'], ['Remove', '[data-act="remove"]'],
];

/** All five stay shown, at least a thumb's target; the expected ones work, and every other tap says why not. */
async function powersWorkAndReasons(page, place) {
  await openCard(page);
  const states = await page.evaluate((buttons) => buttons.map(([power, sel]) => {
    const b = document.querySelector(`#hud .card ${sel}`), r = b?.getBoundingClientRect();
    const shown = !!b && !b.hidden && !b.closest('[hidden]') && !!r && r.height > 0;
    return {
      power, shown, width: r?.width ?? 0, height: r?.height ?? 0,
      disabled: b?.getAttribute('aria-disabled') === 'true', works: shown && b?.getAttribute('aria-disabled') !== 'true',
    };
  }), POWER_BUTTONS);
  const working = states.filter((s) => s.works).map((s) => s.power);
  const targets = states.every((s) => s.shown && s.width >= 44 && s.height >= 44 && s.disabled === !s.works);
  const reasons = [];
  for (const state of states.filter((s) => !s.works)) {
    const sel = POWER_BUTTONS.find(([power]) => power === state.power)[1];
    if (state.shown) await press(page, `#hud .card ${sel}`);
    await frames(page, 1);
    const seen = await page.evaluate(() => {
      const el = document.querySelector('#hud .card .power-reason');
      return { text: el?.textContent?.trim() ?? '', shown: !!el && !el.hidden && !el.closest('[hidden]') && el.getBoundingClientRect().height > 0 };
    });
    reasons.push({ power: state.power, ...seen, ok: state.shown && seen.shown && seen.text.length > 0 && seen.text.length <= 60 });
  }
  return {
    ok: targets && working.join() === place.powers.join() && reasons.every((r) => r.ok),
    working, detail: JSON.stringify({ expected: place.powers, states, reasons }),
  };
}

const bodyState = (page) => page.evaluate(() => {
  const a = window.app, b = window.__everywhereObject;
  if (b?.pos) return { gm: b.gm, radius: b.radius, pos: b.pos.toArray(), vel: b.vel.toArray(), jd: a.clock.jdTdb, on: a.physics.on };
  // another star or its planet: the mass the powers act on (the body standing for it in its system, src/app/App.ts
  // powerBody), and where it is drawn, to the last bit of its place in the universe (it has no velocity of its own)
  const p = b && a.powerBody?.(b, false), u = b?.upos;
  return p && u ? { gm: p.gm, radius: b.radius, pos: [u.xh, u.xl, u.yh, u.yl, u.zh, u.zl], vel: [], jd: a.clock.jdTdb, on: a.physics.on } : null;
});
const sameBody = (a, b) => !!a && !!b && a.gm === b.gm && a.radius === b.radius && a.jd === b.jd && a.on === b.on
  && ['pos', 'vel'].every((k) => a[k].every((x, i) => x === b[k][i]));

async function backToReal(page) {
  if (await shown(page, '#hud .live-back')) {
    await press(page, '#hud .live-back');
    await frames(page, 3);
  }
}

async function massAndUndo(page, touch) {
  const before = await bodyState(page);
  let changed = null, changedOk = false, undoShown = false, detail = '';
  try {
    await press(page, '#hud .card [data-power="mass"]');
    await frames(page, 2);
    const slider = page.locator('#hud .card [data-panel="mass"] .mass-slider');
    const box = await slider.boundingBox();
    if (!box || !before) throw new Error('no mass slider or body state');
    const point = (value) => ({ x: box.x + 15 + ((value + 3) / 6) * (box.width - 30), y: box.y + box.height / 2 });
    const from = point(Number(await slider.inputValue())), to = point(Math.log10(2));
    await touch.press(from);
    for (let i = 1; i <= 6; i++) await touch.slide({ x: from.x + ((to.x - from.x) * i) / 6, y: from.y });
    await touch.lift();
    await frames(page, 2);
    changed = await bodyState(page);
    const factor = changed.gm / before.gm;
    changedOk = changed.on && factor > 1.5 && factor < 2.5;
    undoShown = await shown(page, '#hud .live-mark .live-undo');
    if (undoShown) { await press(page, '#hud .live-mark .live-undo'); await frames(page, 3); }
    detail = `mass ×${factor.toFixed(3)}, physics on ${changed.on}`;
  } catch (e) { detail = String(e).split('\n')[0]; }
  const restored = await bodyState(page);
  if (!sameBody(before, restored)) await backToReal(page);
  return { ok: changedOk && undoShown && sameBody(before, restored), detail: `${detail}; Undo offered ${undoShown}, exact state restored ${sameBody(before, restored)}` };
}

async function moveAndUndo(page, touch) {
  const before = await bodyState(page);
  let changed = null, changedOk = false, undoShown = false, detail = '', from = null, to = null;
  try {
    await press(page, '#hud .card [data-act="move"]');
    await frames(page, 3);
    const points = await page.evaluate(() => {
      const a = window.app, o = window.__everywhereObject, b = a.powerBody?.(o, false), v = b ? a.viewOf(b) : a.bodies.views.get(o);
      const at = v && a.project(v.rel);
      if (!at) return null;
      const to = { x: Math.max(45, Math.min(innerWidth - 45, at.x + (at.x < innerWidth / 2 ? 60 : -60))), y: at.y };
      return { from: at, to };
    });
    if (!points || !before) throw new Error('the world is not on screen for Move');
    ({ from, to } = points);
    await touch.drag(from, to, { steps: 6, rest: 0.3 });
    await frames(page, 2);
    changed = await bodyState(page);
    const moved = Math.hypot(...changed.pos.map((x, i) => x - before.pos[i]));
    const holding = await page.evaluate(() => window.app.mover.holding);
    changedOk = changed.on && moved > 0 && !holding;
    undoShown = await shown(page, '#hud .live-mark .live-undo');
    if (undoShown) { await press(page, '#hud .live-mark .live-undo'); await frames(page, 3); }
    detail = `moved ${moved.toExponential(3)} m, physics on ${changed.on}, still held ${holding}`;
  } catch (e) { detail = String(e).split('\n')[0]; }
  const restored = await bodyState(page);
  if (!sameBody(before, restored)) await backToReal(page);
  return { ok: changedOk && undoShown && sameBody(before, restored), detail: `${detail}; from ${JSON.stringify(from)} to ${JSON.stringify(to)}; Undo offered ${undoShown}, exact state restored ${sameBody(before, restored)}` };
}

/** Selection, target and distance as shared; with nothing selected, distance is from the Solar System barycentre. */
const scene = (page) => page.evaluate(() => {
  const a = window.app, s = a.selection, V = a.rig.forward().constructor;
  return {
    key: s?.key ?? null, name: s?.name ?? null, target: a.rig.target?.key ?? null,
    distance: s ? s.upos.sub(a.rig.upos, new V()).length() : a.rig.upos.toVector3().length(),
  };
});

/** The camera's distance from the selection (or barycentre) unchanged for eight rendered frames. */
const settled = (page) => page.waitForFunction(() => {
  const a = window.app, s = a.selection, V = a.rig.forward().constructor;
  const st = (window.__everywhereSettle ??= { f: -1, d: 0, n: 0 });
  if (a.frameCount === st.f) return false;
  const d = s ? s.upos.sub(a.rig.upos, new V()).length() : a.rig.upos.toVector3().length();
  st.n = Math.abs(d - st.d) <= 1e-9 * Math.max(d, 1) ? st.n + 1 : 0;
  st.f = a.frameCount; st.d = d;
  return st.n >= 8;
}, null, { timeout: 600000, polling: 50 }).then(() => true, () => false);

async function shareAndReopen(session, place, errors) {
  const { page } = session;
  const sentSettled = await settled(page);
  if (!place.openSpace) await openCard(page);
  const before = await scene(page);
  if (place.openSpace) {
    await press(page, '#hud .hud-tabs [data-tab="more"]');
    await press(page, '#hud .sheet.more [data-act="share"]');
  } else await press(page, '#hud .card [data-act="share"]');
  await until(page, () => window.shared.length > 0, null, 120000);
  const sheet = await page.evaluate(() => window.shared[window.shared.length - 1] ?? null);
  const url = sheet?.url ?? '';
  await close(session);
  if (!url) return { ok: false, detail: `nothing was shared; before ${JSON.stringify(before)}` };

  let opened = null;
  try {
    opened = await openPage(url, errors);
    const openedSettled = await settled(opened.page);
    const after = await scene(opened.page);
    const ratio = after.distance / before.distance;
    const sameSelection = before.key === after.key && before.name === after.name;
    const closeDistance = Number.isFinite(ratio) && Math.abs(ratio - 1) <= 0.01;
    await shot(opened.page, place, 'shared');
    return {
      ok: sentSettled && openedSettled && sameSelection && closeDistance,
      detail: JSON.stringify({ sentSettled, openedSettled, before, after, ratio }),
    };
  } catch (e) {
    return { ok: false, detail: `opening the link failed: ${String(e).split('\n')[0]}; before ${JSON.stringify(before)}` };
  } finally { await close(opened); }
}

async function insideOrion(page) {
  // Go there's arrival and the pick are checked at the normal arrival view first. Then put the eye
  // inside the cloud, as the place in the fixed table asks, for its picture and shared link.
  await page.evaluate(() => {
    const a = window.app, o = window.__everywhereObject, V = a.rig.forward().constructor;
    const d = o.upos.sub(a.rig.upos, new V()).normalize();
    a.rig.upos.copy(o.upos).addVec(d, -o.radius * 0.6);
    a.rig.lookAt(d);
    a.rig.target = o;
    a.rig.setAnchor(null);
  });
  await frames(page, 15);
}

async function visitOpenSpace(session, place, errors) {
  const { page } = session;
  // Open space is a camera state, not a catalogue object: there is honestly no name to search, no
  // card to open and nothing to tap. Exercise that state and its a=- share link without inventing one.
  await page.evaluate(() => {
    const a = window.app;
    a.rig.cancelGoto();
    a.rig.target = null;
    a.rig.setAnchor(null);
    a.rig.upos.set(2e21, -3e21, 1e21);
    a.select(null);
  });
  await frames(page, 6);
  const state = await page.evaluate(() => ({
    selected: window.app.selection?.name ?? null, target: window.app.rig.target?.name ?? null,
    place: document.querySelector('#hud .chip.place b')?.textContent ?? '', card: document.querySelector('#hud').dataset.sheet === 'card',
    powers: [...document.querySelectorAll('#hud .card .card-powers button')].filter((b) => !b.hidden && b.getBoundingClientRect().height > 0).length,
  }));
  check(place, 'open space is reached with no selected object or destination', !state.selected && !state.target && state.place === 'Open space', JSON.stringify(state));
  check(place, 'open space has no object card or powers', !state.card && state.powers === 0, JSON.stringify(state));
  await shot(page, place, 'view');
  const shared = await shareAndReopen(session, place, errors);
  check(place, 'share reopens the same no-selection view and camera distance within 1%', shared.ok, shared.detail);
}

async function visit(place) {
  console.log(`\nPLACE ${place.part}/${place.label}`);
  const errors = [];
  let session = null;
  try {
    session = await openPage(`${base}?menu=0&time=${START}&paused=1&target=Earth&dist=6`, errors);
    if (place.openSpace) { await visitOpenSpace(session, place, errors); return; }
    const { page, touch } = session;

    const found = await searchAndSelect(page, place);
    await ensureObject(page, place);
    check(place, `found by the typed name "${place.query}"`, found.ok, found.detail);
    const card = await cardTitle(page);
    check(place, 'the card opens with the selection as its title', !!card.title && card.title === card.expected && card.selection === card.expected && card.sheet === 'card', JSON.stringify(card));
    const gone = await goThere(page, place);
    check(place, 'Go there arrives (rendered frames, with a ten-minute bound)', gone.ok, `frames ${gone.frames}; ${JSON.stringify(gone.state)}`);
    const picked = await tapSelect(page, place, touch);
    check(place, 'tapping the object on screen selects it', picked.ok, JSON.stringify({ at: picked.at, got: picked.got }));

    await quiet(page);
    const powers = await powersWorkAndReasons(page, place);
    check(place, 'all five powers are thumb-sized; the expected ones work and every other tap shows a short reason', powers.ok, powers.detail);
    if (place.powers.includes('Mass')) {
      const mass = await massAndUndo(page, touch);
      check(place, 'Mass works and Undo restores the exact body state', mass.ok, mass.detail);
    }
    if (place.powers.includes('Move')) {
      const moved = await moveAndUndo(page, touch);
      check(place, 'Move works and Undo restores the exact body state', moved.ok, moved.detail);
    }
    if (place.inside) await insideOrion(page);
    await openCard(page);
    await shot(page, place, 'view');
    const shared = await shareAndReopen(session, place, errors);
    check(place, 'share reopens the same selection and camera distance within 1%', shared.ok, shared.detail);
  } catch (e) {
    check(place, 'the whole place check runs without a driver exception', false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
  } finally {
    await close(session);
    check(place, 'no console errors, page errors or failed requests', errors.length === 0, [...new Set(errors)].slice(0, 5).join(' | '));
  }
}

for (const place of places) await visit(place);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed (${part}${only.length ? `: ${only.join(', ')}` : ''})`);
for (const f of failed) console.log(`FAILED ${f.place}: ${f.name}`);
process.exit(failed.length || !results.length ? 1 : 0);
