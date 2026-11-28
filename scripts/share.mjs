// Save & share (src/app/SceneLink.ts, src/platform/share.ts): a scene shared and opened again in a
// fresh browser, on a phone upright, on a phone on its side and at a desk, in headless Chromium.
//   - Share is where it is found without hunting: on the card of what is selected, and first in More
//   - on a phone it opens the system's share sheet (navigator.share; headless Chromium has none, so the
//     page is given one that keeps what it was handed: the sheet is the system's, the link is the app's),
//     at a desk the link is copied (the real clipboard) and the toast says so
//   - the link opened in a fresh browser (a new context: nothing of the first is kept) goes straight to the
//     scene, without the title screen: what is selected, what the camera is at, where the camera is from it
//     and which way it looks (within a tolerance), the date, the rate of time and whether it is paused, and
//     a short plain note of what it is; the real universe stays real (no live physics)
//   - a link made on a phone opened at a desk: the same way of looking, on another screen
//   - a broken link, one of a newer version, one naming what is not here: the app as usual, and a note that
//     says so; never a crash or a blank screen; a name with markup in a link is shown as text
//   - a planet of another star (TRAPPIST-1 e and 51 Peg b from the NASA Exoplanet Archive, Gl 9848 b, one the app generates for a faint far star):
//     shared with the camera close to it and opened in a fresh browser, which is at another date until the link sets
//     its own, the same selection and the camera the same distance from it (within 1 %): the planet is where the link's
//     date puts it, not where the date of the page that opened it did
//   - a changed universe (live physics): Mars sent at the Earth (phone), a planet like the Earth added through the
//     card (on its side), the Moon thrown out and twenty years and more run on at a hundred years a second (desk);
//     shared and opened in a fresh browser: every simulated body where it was and moving as it was to the last bit,
//     at the same moment, the same worlds made and taken away, the note; and the card's prediction (the simulation
//     run ahead, with a finger held on the world in Move) reads the same on both
//   - saved on this device (More): listed with a name and a date, opened again after the page is closed, deleted
//     with two taps; with the storage full, and where the browser keeps nothing, it says so
// Usage: node scripts/share.mjs [baseUrl] [outDir]
//   (SHARE_ONLY=view,running,exo,broken,live,saves: those blocks alone; SHARE_KINDS=phone,side,desk)
import { collectErrors, launchBrowser, liveWay, openCard, undoOffered } from './lib/browser.mjs';
import { fingers, phoneContext } from './lib/touch.mjs';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'screenshots';
fs.mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const errors = [];
const START = '2026-10-01T20:00:00Z';

const frames = (page, n) => page.evaluate((n) => new Promise((done) => { const f0 = window.app.frameCount; const t = setInterval(() => { if (window.app.frameCount >= f0 + n) { clearInterval(t); done(); } }, 30); }), n);
// (what is on the selection's card under its bar is a tap on the bar away: openCard)
const press = async (page, sel) => { if (/\.card \[data-(power|act="(move|remove|share|centre)")/.test(sel)) await openCard(page); const b = page.locator(sel).first(); await b.scrollIntoViewIfNeeded(); await b.tap().catch(() => b.click()); };
const text = (page, sel) => page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', sel);
const shown = (page, sel) => page.evaluate((sel) => { const el = document.querySelector(sel); return !!el && !el.hidden && !el.closest('[hidden]') && el.getBoundingClientRect().height > 0; }, sel);
/** Is the middle of an element in the view and the topmost thing there (a finger landing on it lands on it)? */
const reachable = (page, sel) => page.evaluate((sel) => {
  const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().height > 0 && !e.closest('[hidden]'));
  if (!el) return false;
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  return x > 0 && y > 0 && x < innerWidth && y < innerHeight && !!document.elementFromPoint(x, y)?.closest(sel);
}, sel);

/** A phone upright, a phone on its side, or a desk: a fresh browser each time (nothing of another is kept). */
async function context(kind) {
  if (kind === 'desk') {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
    return ctx;
  }
  const ctx = await phoneContext(browser, { landscape: kind === 'side' });
  // (the system's share sheet: headless Chromium has none. This one keeps what it is handed, and when, as the
  // explorer would see it in the sheet; the app's part, the link and the call, is what is checked)
  await ctx.addInitScript(() => {
    window.shared = [];
    navigator.share = async (data) => { window.shared.push({ ...data, jd: window.app?.clock.jdTdb }); };
    navigator.canShare = () => true;
  });
  return ctx;
}

async function open(kind, url) {
  const ctx = await context(kind);
  const page = await ctx.newPage();
  collectErrors(page, errors);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => (window.app && window.app.frameCount > 30 && !document.getElementById('boot')) || window.appError, null, { timeout: 600000 });
  return { ctx, page };
}

/** Find a place by name and choose it (it is selected, and the camera sets off for it). */
async function find(page, name) {
  if (!(await shown(page, '#hud .sheet.explore.on'))) await press(page, '#hud .hud-tabs [data-tab="search"]');
  await page.locator('#hud .searchbox input').fill(name);
  const row = page.locator('#hud .explore .list .row').filter({ has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) }).first();
  await row.waitFor({ timeout: 20000 });
  await row.tap().catch(() => row.click());
  await page.waitForFunction((n) => window.app.selection?.name === n && document.querySelector('#hud').dataset.sheet === 'card' && document.querySelector('#hud .card h2').textContent === n, name, { timeout: 20000 });
  // (the flight there stopped where it is: the camera stays with what it was at)
  if (await shown(page, '#hud .hud-flight')) await page.locator('#hud .hud-flight [data-act="stop"]').tap({ timeout: 3000 }).catch(() => undefined);
  await frames(page, 2);
}

/** Ask for a rate of time with the Time sheet's buttons: `label` is what the clock chip then shows ("1 hour a second"); `pause`: then paused. */
async function setTime(page, label, pause) {
  if (!(await shown(page, '#hud .sheet.time.on'))) await press(page, '#hud .hud-tabs [data-tab="time"]');
  for (let i = 0; i < 16 && (await text(page, '#hud .time-rate')) !== label; i++) {
    await press(page, '#hud .transport [data-act="faster"]');
    await frames(page, 2);
  }
  if (pause !== (await page.evaluate(() => window.app.clock.paused))) await press(page, '#hud .transport [data-act="pause"]');
  await press(page, '#hud .sheet.time [data-close]');
  await frames(page, 2);
}

/**
 * The scene as the app has it: what is selected, what the camera is at, the camera from it (m), which way it
 * looks (its forward and up, without the tilt an upright phone gives it to put the world above the card), the
 * date, the rate of time, live physics.
 */
const scene = (page) => page.evaluate(() => {
  const a = window.app, V = a.rig.forward().constructor, q = a.rig.quat.clone();
  // (the tilt about the camera's own x axis, taken off)
  const pure = q.clone().multiply(q.clone().setFromAxisAngle(new V(1, 0, 0), a.rig.aim));
  const fwd = new V(0, 0, -1).applyQuaternion(pure), up = new V(0, 1, 0).applyQuaternion(pure);
  const at = a.rig.target, off = at ? a.rig.upos.sub(at.upos, new V()) : null;
  return {
    selected: a.selection?.name ?? null, at: at?.name ?? null, off: off ? [off.x, off.y, off.z] : null,
    fwd: [fwd.x, fwd.y, fwd.z], up: [up.x, up.y, up.z], fov: a.rig.fov,
    jd: a.clock.jdTdb, rate: a.clock.rate, paused: a.clock.paused, live: a.physics.on,
    card: document.querySelector('#hud').dataset.sheet === 'card' ? document.querySelector('#hud .card h2').textContent : null,
    menu: !!document.getElementById('start-menu'),
  };
});

/** The camera has stopped moving from what it is at: its distance the same for 8 frames in a row (a planet's system settles over the first frames). */
const settled = (page) => page.waitForFunction(() => {
  const a = window.app, at = a.rig.target;
  if (!at) return false;
  const st = (window.settle ??= { f: -1, d: 0, n: 0 });
  if (a.frameCount === st.f) return false;
  const d = a.rig.upos.sub(at.upos, new (a.rig.forward().constructor)()).length();
  st.n = Math.abs(d - st.d) <= 1e-9 * d ? st.n + 1 : 0;
  st.f = a.frameCount; st.d = d;
  return st.n >= 8;
}, null, { timeout: 600000, polling: 50 });

/** How far apart two scenes are: the camera's place (as a share of its distance), its look (rad), the date (ms). */
function apart(a, b) {
  const d = Math.hypot(...a.off), off = Math.hypot(a.off[0] - b.off[0], a.off[1] - b.off[1], a.off[2] - b.off[2]) / d;
  const ang = (u, v) => Math.acos(Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
  return { off, look: ang(a.fwd, b.fwd), roll: ang(a.up, b.up), ms: Math.abs(a.jd - b.jd) * 86_400_000 };
}

/** The note the app shows over its panels (src/ui/Hud.ts notice), or '' when there is none. */
const note = (page) => page.evaluate(() => { const n = document.querySelector('#hud .hud-notice'); return n && !n.hidden ? n.querySelector('span').textContent : ''; });

/** Share through the interface (the card's button, or More's row): the link it handed on, and the scene at that moment. */
async function share(page, kind, from, bound = 10000) {
  // (where there is no Share to press, nothing is shared: the checks that follow say so, one by one)
  try {
    if (from === 'more') {
      await press(page, '#hud .hud-tabs [data-tab="more"]');
      await page.locator('#hud .sheet.more [data-act="share"]').first().click({ timeout: bound });
      await press(page, '#hud .sheet.more [data-close]');
    } else { await openCard(page); await page.locator('#hud .card [data-act="share"]').first().click({ timeout: bound }); }
  } catch {
    return { url: '', before: await scene(page), toast: '', sheet: null };
  }
  await frames(page, 3);
  const before = await scene(page);
  if (kind === 'desk') {
    await page.waitForFunction(() => document.querySelector('#hud .hud-toast').textContent === 'Link copied', null, { timeout: Math.max(20000, bound) }).catch(() => undefined);
    const url = await page.evaluate(() => navigator.clipboard.readText());
    return { url, before, toast: await text(page, '#hud .hud-toast'), sheet: null };
  }
  await page.waitForFunction(() => window.shared.length > 0, null, { timeout: Math.max(20000, bound) }).catch(() => undefined);
  const sheet = await page.evaluate(() => window.shared[window.shared.length - 1] ?? null);
  return { url: sheet?.url ?? '', before, toast: await text(page, '#hud .hud-toast'), sheet };
}

/** Time is stopped (the big button of the Time sheet). */
async function pause(page) {
  if (await page.evaluate(() => window.app.clock.paused)) return;
  if (!(await shown(page, '#hud .sheet.time.on'))) await press(page, '#hud .hud-tabs [data-tab="time"]');
  await press(page, '#hud .transport [data-act="pause"]');
  await press(page, '#hud .sheet.time [data-close]');
  await frames(page, 2);
}

/** Live physics as the page has it: every simulated body's place and motion (to the bit), the date, the worlds made and taken away, the log. */
const liveState = (page) => page.evaluate(() => {
  const a = window.app, sim = a.physics.live?.sim;
  if (!sim) return { on: false, ids: [], pos: [], vel: [], jd: a.clock.jdTdb, made: [], gone: [], log: [] };
  sim.read();
  return {
    on: true, ids: [...sim.ids], pos: [...sim.pos], vel: [...sim.vel], jd: a.clock.jdTdb,
    made: a.physics.made.map((b) => b.name), gone: a.system.bodies.filter((b) => a.system.isGone(b)).map((b) => b.name), log: a.physics.log.map((e) => e.text),
  };
});

/**
 * The card's prediction for a world (the simulation run ahead with every pull counted: src/app/Foresight.ts), as the
 * explorer gets it: Move on its card, a finger (or the mouse) put on the world and held still while the card says what
 * ends its path, then lifted where it was (nothing changed). '' if it said nothing.
 */
async function foresee(page, name, kind) {
  await page.evaluate((n) => { const a = window.app, b = a.findByName(n); a.select(b); }, name);
  await page.waitForFunction((n) => document.querySelector('#hud .card h2')?.textContent === n, name, { timeout: 20000 });
  if ((await page.locator('#hud .card [data-act="move"]').getAttribute('aria-expanded')) !== 'true') await press(page, '#hud .card [data-act="move"]');
  await frames(page, 3);
  const at = await page.evaluate((n) => { const a = window.app, b = a.findByName(n); a.frame(); return a.project(b.upos.sub(a.rig.upos, new b.pos.constructor())); }, name);
  if (!at) return '';
  const touch = kind === 'desk' ? null : await fingers(page);
  if (touch) await touch.press(at);
  else { await page.mouse.move(at.x, at.y); await page.mouse.down(); }
  // (it grows a few milliseconds a frame: three of the Moon's turns round the Sun, every pull counted, take minutes at a
  // runner's few frames a second)
  await page.waitForFunction(() => window.app.mover.holding && window.app.ahead.done && !!document.querySelector('#hud .card .power-ahead')?.textContent, null, { timeout: 900000, polling: 500 }).catch((e) => console.log(`  (the wait ended: ${String(e).split('\n')[0]})`));
  await frames(page, 3);
  const said = await text(page, '#hud .card .power-ahead');
  if (!said) console.log(`  (nothing said: ${JSON.stringify(await page.evaluate(() => ({ holding: window.app.mover.holding, done: window.app.ahead.done, count: window.app.ahead.count })))})`);
  if (touch) await touch.lift();
  else await page.mouse.up();
  await frames(page, 2);
  return said;
}

/**
 * A scene's link (the part after the '#') with its changed universe damaged where only the catalogue can tell: its first
 * simulated body (the Sun, 10) renumbered 11, a number the catalogue has not got. (The bytes: the form, then the
 * simulation's next number, its steps and its count of bodies, then the first body's number: SceneWorld.ts.)
 */
function damage(fragment) {
  const m = /&w=([A-Za-z0-9_-]+)$/.exec(fragment);
  const b = Buffer.from(m[1], 'base64url');
  let i = 1;
  const skip = () => { while (b[i] & 128) i++; i++; };
  skip(); skip(); skip();
  if (b[i] !== 10) throw new Error('the first simulated body is not the Sun');
  b[i] = 11;
  return fragment.replace(m[1], b.toString('base64url'));
}

const only = process.env.SHARE_ONLY ?? '';
const want = (name) => !only || only.split(',').includes(name);
const kinds = (process.env.SHARE_KINDS ?? 'phone,side,desk').split(',');
let phoneLink = null;

for (const kind of kinds) {
  const on = (name) => `${kind}: ${name}`;

  // ------------------------------------------------------------------ the real universe: a view shared and opened again
  if (want('view')) view: {
    const { ctx, page } = await open(kind, `${base}?menu=0&time=${START}&paused=1&target=Earth&dist=6`);
    await setTime(page, '1 hour a second', true);
    // (setup: the Moon selected while the camera stays at the Earth, as a tap on the Moon leaves it; and the camera
    // turned off the way the app put it: a view of the explorer's own, not the default)
    await page.evaluate(() => { const a = window.app; a.select(a.findByName('Moon')); a.rig.turn(0.15); a.rig.quat.multiply(a.rig.quat.clone().setFromAxisAngle(a.rig.forward().set(1, 0, 0), 0.05)); });
    await page.waitForFunction(() => document.querySelector('#hud').dataset.sheet === 'card' && document.querySelector('#hud .card h2').textContent === 'Moon', null, { timeout: 20000 });
    await frames(page, 3);
    // (one tap on the card's bar, and Share is there)
    await openCard(page);
    check(on('Share is on the card of what is selected, one tap on it away and in reach (not hunted for)'), await reachable(page, '#hud .card [data-act="share"]'));
    await page.screenshot({ path: path.join(outDir, `share-${kind}-card.png`) });
    const from = kind === 'side' ? 'more' : 'card';
    if (from === 'more') {
      await press(page, '#hud .hud-tabs [data-tab="more"]');
      await frames(page, 2);
      check(on('Share is at the top of More, under How to move, in sight'), await page.evaluate(() => [...document.querySelectorAll('#hud .sheet.more .list > .row')].slice(0, 2).some((r) => r.dataset.act === 'share')) && await reachable(page, '#hud .sheet.more [data-act="share"]'));
      await page.screenshot({ path: path.join(outDir, `share-${kind}-more.png`) });
      await press(page, '#hud .sheet.more [data-close]');
      await page.evaluate(() => { const a = window.app; a.select(a.findByName('Moon')); });
      await page.waitForFunction(() => document.querySelector('#hud').dataset.sheet === 'card', null, { timeout: 20000 });
    }
    const s = await share(page, kind, from);
    if (!s.url) { check(on('Share hands on a link'), false, 'nothing was shared'); await ctx.close(); break view; }
    const fragment = s.url.split('#')[1] ?? '';
    if (kind === 'desk') check(on('at a desk the link is copied, and the toast says so'), s.toast === 'Link copied' && s.url.startsWith(base), `"${s.toast}" ${s.url.slice(0, 160)}`);
    else check(on('on a phone the system share sheet is opened with the link, a title and a line of text'), !!s.sheet && s.url.startsWith(base) && s.sheet.title === 'Starfarer' && /^Moon, \d+ \w+ 2026, in Starfarer$/.test(s.sheet.text), JSON.stringify(s.sheet)?.slice(0, 220));
    check(on('the link is readable: a version, what is selected, the camera, the date, the rate, paused'),
      /^v=1&o=Moon&oi=301&a=Earth&ai=399&c=[-\d.e]+,[-\d.e]+,[-\d.e]+&q=[-\d.e]+,[-\d.e]+,[-\d.e]+,[-\d.e]+&t=2026-10-0[12]T\d\d:\d\d:\d\d\.\d{3}Z&r=3600&p=1$/.test(fragment), fragment);
    await ctx.close();

    const got = await open(kind, s.url);
    const after = await scene(got.page);
    const d = apart(s.before, after);
    const said = await note(got.page);
    check(on('the link opens straight to the scene in a fresh browser, without the title screen, with no error'), !after.menu && !(await got.page.evaluate(() => window.appError ?? '')), after.menu ? 'the title screen' : '');
    check(on('what is selected and what the camera is at are the same, and the card is up'), after.selected === 'Moon' && after.at === 'Earth' && after.card === 'Moon', JSON.stringify({ selected: after.selected, at: after.at, card: after.card }));
    check(on('the camera is where it was from the Earth (to a millionth of its distance) and looks the same way (to 0.001°)'),
      d.off < 1e-6 && d.look < 2e-5 && d.roll < 2e-5, `${(d.off * 1e6).toFixed(3)} millionths; ${(d.look * 57.3).toExponential(2)}°, roll ${(d.roll * 57.3).toExponential(2)}°`);
    check(on('the date (to the millisecond), the rate of time and the pause are the same'), d.ms <= 1 && after.rate === 3600 && after.paused === true, `${d.ms.toFixed(3)} ms; ${after.rate}, paused ${after.paused}`);
    check(on('the real universe stays real: opening it switches on no live physics'), !after.live && !(await shown(got.page, '#hud .live-mark')));
    check(on('a short plain note says what it is'), /^A shared view: the Moon, [12] October 2026, \d\d:\d\d UTC, time paused\.$/.test(said), `"${said}"`);
    check(on('the link is taken off the address once opened'), !(await got.page.evaluate(() => location.hash)));
    await got.page.screenshot({ path: path.join(outDir, `share-${kind}-opened.png`) });
    if (kind === 'phone') phoneLink = { url: s.url, before: s.before };
    await got.ctx.close();
  }

  // ------------------------------------------------------------------ time running: the link has the moment it was shared
  if (want('running') && kind === 'phone') running: {
    const { ctx, page } = await open(kind, `${base}?menu=0&time=${START}&paused=0&target=Mars&dist=5`);
    await find(page, 'Mars');
    await setTime(page, '1 day a second', false);
    await frames(page, 10);
    const s = await share(page, kind, 'card');
    if (!s.url) { check(on('Share hands on a link'), false, 'nothing was shared'); await ctx.close(); break running; }
    await ctx.close();
    const got = await open(kind, s.url);
    const after = await scene(got.page);
    const link = s.url.split('#')[1];
    const t = new URLSearchParams(link).get('t'), linkJd = Date.parse(t) / 86_400_000 + 2_440_587.5;
    check(on('time running: the link holds the moment it was shared, and the opened scene runs on from it at that rate'),
      Math.abs((s.sheet.jd - (linkJd + 69.184 / 86400)) * 86_400_000) < 1 && after.rate === 86400 && !after.paused && after.jd > s.sheet.jd && /time at 1 day a second\.$/.test(await note(got.page)),
      `shared at ${s.sheet.jd}, link ${t}; opened running at ${after.rate} s/s: "${await note(got.page)}"`);
    await got.ctx.close();
  }

  // ------------------------------------------------------------------ a planet of another star: shared close to it, opened at the date of the link
  if (want('exo') && kind !== 'side') for (const name of ['TRAPPIST-1 e', '51 Peg b', 'Gl 9848 b']) exo: {
    const { ctx, page } = await open(kind, `${base}?menu=0&time=${START}&paused=1&target=Earth&dist=6`);
    // (setup: the camera put near the planet as the app's own flight to it leaves it, and the planet selected)
    const made = await page.evaluate((n) => { const a = window.app, pl = a.findByName(n); if (!pl) return null; a.placeNear(pl, 3.4 * pl.radius * a.rig.framing, 35, 12); a.select(pl); return { real: !!pl.spec?.real }; }, name);
    if (!made) { check(on(`${name} is found`), false, 'no such planet'); await ctx.close(); break exo; }
    await page.waitForFunction((n) => document.querySelector('#hud').dataset.sheet === 'card' && document.querySelector('#hud .card h2')?.textContent === n, name, { timeout: 600000 });
    await settled(page);
    // (a planet close up is a frame a second or less under software drawing, and a click waits for frames: the bound is long)
    const s = await share(page, kind, 'card', 600000);
    await ctx.close();
    if (!s.url) { check(on(`${name}: Share hands on a link`), false, 'nothing was shared'); break exo; }
    const got = await open(kind, s.url);
    await settled(got.page);
    const after = await scene(got.page);
    const far = Math.hypot(...s.before.off), now = Math.hypot(...after.off);
    check(on(`${name} (${made.real ? 'from the archive' : 'generated'}): the link opens with the same planet selected and the camera at it`), s.before.selected === name && after.selected === name && after.at === name, JSON.stringify({ sent: [s.before.selected, s.before.at], opened: [after.selected, after.at] }));
    check(on(`${name}: the camera is the same distance from it as when it was shared (within 1%)`), Math.abs(now / far - 1) < 0.01, `${far.toExponential(4)} m shared, ${now.toExponential(4)} m opened (${(now / far).toFixed(4)} times)`);
    await got.ctx.close();
    if (name === 'TRAPPIST-1 e') {
      // the same link with time running at a day a second (made by hand: the fragment's rate and pause): the planet moves
      // with the clock, and the camera, which rides with it, stays where it was from it
      const run = s.url.replace(/&r=[^&]+&p=1/, '&r=86400&p=0');
      const going = await open(kind, run);
      await frames(going.page, 12);
      const then = await scene(going.page), held = await going.page.evaluate(() => window.app.rig.anchor?.name ?? null);
      const fell = Math.hypot(...then.off);
      check(on(`${name}: opened with time running at a day a second, the camera goes on with it (the same distance, within 1%, and it rides with the planet)`), run !== s.url && !then.paused && then.rate === 86400 && Math.abs(fell / far - 1) < 0.01 && held === name, `${far.toExponential(4)} m shared, ${fell.toExponential(4)} m after 12 frames; rides with ${held}`);
      await going.ctx.close();
    }
  }

  // ------------------------------------------------------------------ a phone's link opened at a desk
  if (want('view') && kind === 'desk' && phoneLink) {
    const got = await open(kind, phoneLink.url);
    const after = await scene(got.page);
    const d = apart(phoneLink.before, after);
    check(on('a link made on an upright phone opens at a desk with the same camera and the same way of looking (the phone\'s tilt for its card is not carried over)'),
      after.selected === 'Moon' && d.off < 1e-6 && d.look < 2e-5 && d.roll < 2e-5, `${(d.off * 1e6).toFixed(3)} millionths; ${(d.look * 57.3).toExponential(2)}°`);
    await got.ctx.close();
  }

  // ------------------------------------------------------------------ broken, newer, missing: the app as usual, and a note
  if (want('broken')) {
    const cases = [
      ['a damaged link', '#v=1&o=Moon&c=1,2,banana&q=0,0,0,1&t=2026-10-01T20:00:00.000Z', /^This link could not be opened: the camera's place is not a number\. Here is Starfarer as usual\.$/],
      ['a link of a newer version', '#v=7&o=Moon&zz=1', /^This link could not be opened: it was made by a newer version of the app \(form 7\)\. Here is Starfarer as usual\.$/],
      ['something that is not a link', '#hello', /^This link could not be opened: it is not a link to a scene\. Here is Starfarer as usual\.$/],
      ['a link naming what is not here', '#v=1&o=Planet%20Nine&a=-&c=1e12,0,0&q=0,0,0,1&t=2026-10-01T20:00:00.000Z&r=1&p=0', /^A shared view: open space, 1 October 2026, 20:00 UTC, time running\. "Planet Nine" could not be found here\.$/],
    ];
    for (const [what, frag, words] of cases) {
      const got = await open(kind, `${base}${frag}`);
      const said = await note(got.page);
      const ok = await got.page.evaluate(() => !!window.app && !window.appError && window.app.frameCount > 30 && !window.app.physics.on);
      const lit = await got.page.evaluate(() => { const c = document.getElementById('view'); return c.width > 0 && c.height > 0; });
      check(on(`${what}: the app opens as usual (no crash, no blank screen) and says so plainly`), ok && lit && words.test(said), `"${said}"`);
      if (what === 'a damaged link') await got.page.screenshot({ path: path.join(outDir, `share-${kind}-broken.png`) });
      await got.ctx.close();
    }
  }
  // ------------------------------------------------------------------ a changed universe (live physics): shared, and opened again
  if (want('live')) live: {
    // a change per kind: Mars sent at the Earth (phone), a planet added through the card (on its side: rocky, the Earth's mass),
    // the Moon thrown out and many years run on (desk)
    const setup = { phone: 'target=Earth&dist=60', side: 'target=Sun&dist=4000', desk: 'target=Earth&dist=60' }[kind];
    const { ctx, page } = await open(kind, `${base}?menu=0&time=${START}&paused=1&${setup}`);
    const subject = { phone: 'Mars', side: 'New rocky world', desk: 'Moon' }[kind];
    if (kind === 'side') {
      // Add, through the card of the Sun: a planet (made rocky, of the Earth's mass), put in place where it starts, Done
      await page.evaluate(() => { const a = window.app; a.select(a.findByName('Sun')); });
      await page.waitForFunction(() => document.querySelector('#hud .card h2')?.textContent === 'Sun', null, { timeout: 20000 });
      await press(page, '#hud .card [data-power="add"]');
      await press(page, '#hud .card [data-act="add-planet"]');
      await page.waitForFunction(() => window.app.selection?.name === 'New rocky world', null, { timeout: 20000 });
      await press(page, '#hud .card [data-act="place-done"]');
    } else {
      // (setup, the change itself: as the powers make it, through LivePhysics, which the live suite drives with fingers)
      await page.evaluate((kind) => {
        const a = window.app, earth = a.findByName('Earth'), V = earth.pos.constructor;
        if (kind === 'phone') {
          const mars = a.findByName('Mars'), sun = a.findByName('Sun');
          const r = earth.pos.clone().sub(sun.pos), side = r.clone().cross(earth.vel.clone().sub(sun.vel)).cross(r).normalize();
          a.physics.move(mars, earth.pos.clone().addScaledVector(side, 40 * earth.radius).toArray(), earth.vel.clone().addScaledVector(side, -3000).toArray(), a.clock.jdTdb);
        } else {
          const moon = a.findByName('Moon'), r = moon.pos.clone().sub(earth.pos), w = moon.vel.clone().sub(earth.vel);
          const n = r.clone().cross(w).normalize(), v = n.clone().cross(r).normalize().multiplyScalar(1.6 * Math.sqrt((earth.gm + moon.gm) / r.length()));
          a.physics.move(moon, moon.pos.toArray(), earth.vel.clone().add(v).toArray(), a.clock.jdTdb);
        }
        a.tellNews(false);
        void V;
      }, kind);
    }
    await frames(page, 3);
    if (kind === 'desk') {
      // many years on: time at a hundred years a second for a few seconds of the screen
      await setTime(page, '100 years a second', false);
      await page.waitForFunction((jd) => window.app.clock.jdTdb > jd + 20 * 365.25, await page.evaluate(() => window.app.clock.jdTdb), { timeout: 300000 }).catch(() => undefined);
    }
    await pause(page);
    await page.evaluate((n) => { const a = window.app, b = a.findByName(n); a.placeNear(b, 9 * b.radius * a.rig.framing, 35, 12); a.select(b); }, subject);
    await page.waitForFunction((n) => document.querySelector('#hud .card h2')?.textContent === n, subject, { timeout: 20000 });
    const years = await page.evaluate(() => (window.app.clock.jdTdb - window.app.physics.live.jd0) / 365.25);
    const s = await share(page, kind, kind === 'side' ? 'more' : 'card');
    if (!s.url) { check(on('Share hands on a link'), false, 'nothing was shared'); await ctx.close(); break live; }
    const fragment = s.url.split('#')[1] ?? '';
    const sent = await liveState(page);
    check(on(`the link of a changed universe (${subject}${kind === 'desk' ? `, ${years.toFixed(0)} years on` : ''}) holds it: readable as before, the changed universe after w=, ${s.url.length} characters`),
      /^v=1&o=[^&]+&oi=\d+&c=[^&]+&q=[^&]+&t=[^&]+&r=[^&]+&p=1&w=[A-Za-z0-9_-]+$/.test(fragment) && sent.on && s.url.length < 16000, fragment.replace(/&w=.*/, '&w=…'));
    const before = await foresee(page, subject, kind);
    await ctx.close();

    const got = await open(kind, s.url);
    const after = await liveState(got.page);
    const view = await scene(got.page);
    const said = await note(got.page);
    check(on('opened in a fresh browser: live physics on, the same worlds made and taken away, the same log'),
      after.on && JSON.stringify(after.made) === JSON.stringify(sent.made) && JSON.stringify(after.gone) === JSON.stringify(sent.gone) && JSON.stringify(after.log.slice(-6)) === JSON.stringify(sent.log.slice(-6)) && await shown(got.page, '#hud .live-mark'),
      `made ${JSON.stringify(after.made)}; gone ${JSON.stringify(after.gone)}; ${after.log.length} lines`);
    check(on('every simulated body is where it was and moving as it was, to the last bit, at the same moment'),
      after.ids.join() === sent.ids.join() && after.pos.every((x, i) => x === sent.pos[i]) && after.vel.every((x, i) => x === sent.vel[i]) && after.jd === sent.jd,
      `${after.ids.length} bodies; date ${((after.jd - sent.jd) * 86_400_000).toFixed(3)} ms apart`);
    const d = apart(s.before, view);
    check(on('the same selection and camera, and time paused'), view.selected === subject && d.off < 1e-6 && d.look < 2e-5 && view.paused, `${view.selected}; ${(d.off * 1e6).toFixed(3)} millionths, ${(d.look * 57.3).toExponential(2)}°`);
    check(on('a short plain note says it is a changed universe, and since when'), new RegExp(`^A shared scene: ${subject === 'Moon' ? 'the Moon' : subject}, \\d+ \\w+ \\d{4}, \\d\\d:\\d\\d UTC, time paused\\. Changed with live physics since 1 October 2026\\.$`).test(said), `"${said}"`);
    const again = await foresee(got.page, subject, kind);
    check(on('the card\'s prediction, the simulation run ahead with every pull counted, reads the same on both'), !!before && before === again && (kind !== 'phone' || /^With every pull counted, it hits Earth in [\d.]+ (hours|days)\.$/.test(again)), `"${before}" / "${again}"`);
    await got.page.screenshot({ path: path.join(outDir, `share-${kind}-live-opened.png`) });
    await got.ctx.close();
  }

  // ------------------------------------------------------------------ saved on this device: a list in More, opened again, deleted; full, and private
  if (want('saves') && kind !== 'side') saves: {
    const ctx = await context(kind);
    const page = await ctx.newPage();
    collectErrors(page, errors);
    const go = async (url) => { await page.goto(url, { waitUntil: 'load' }); await page.waitForFunction(() => window.app && window.app.frameCount > 30 && !document.getElementById('boot'), null, { timeout: 600000 }); };
    await go(`${base}?menu=0&time=${START}&paused=1&target=Jupiter&dist=8`);
    // a change (Jupiter twice as heavy), then saved
    await page.evaluate(() => { const a = window.app, j = a.findByName('Jupiter'); a.physics.setMass(j, 2 * j.gm, a.clock.jdTdb); a.select(j); });
    await press(page, '#hud .hud-tabs [data-tab="more"]');
    if (!(await page.locator('#hud .sheet.more [data-act="save"]').count())) { check(on('Save this scene is in More'), false, 'no such row'); await ctx.close(); break saves; }
    await press(page, '#hud .sheet.more [data-act="save"]');
    await frames(page, 2);
    const toastSaved = await text(page, '#hud .hud-toast');
    const sent = await liveState(page);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#hud .more .saves .save-row')].map((r) => ({ name: r.querySelector('b').textContent, detail: r.querySelector('small').textContent })));
    check(on('Save this scene keeps it on this device, and More lists it with a name and a date'), /^Saved: Jupiter, \d+ Oct 2026, changed$/.test(toastSaved) && rows.length === 1 && /^Jupiter, \d+ Oct 2026, changed$/.test(rows[0].name) && /^Saved \d+ \w{3} \d{4}, \d\d:\d\d UTC · live physics$/.test(rows[0].detail), `"${toastSaved}" ${JSON.stringify(rows)}`);
    await page.screenshot({ path: path.join(outDir, `share-${kind}-saves.png`) });
    // the page opened again, the real universe: the save opened from the list
    await go(`${base}?menu=0&time=${START}&paused=1&target=Earth&dist=6`);
    await press(page, '#hud .hud-tabs [data-tab="more"]');
    await press(page, '#hud .more .saves [data-save-open]');
    await page.waitForFunction(() => window.app.physics.on, null, { timeout: 60000 }).catch(() => undefined);
    await frames(page, 2);
    const back = await liveState(page);
    check(on('a save opens again after the page is closed: the changed universe as it was, to the last bit, and a note'),
      back.on && back.ids.join() === sent.ids.join() && back.pos.every((x, i) => x === sent.pos[i]) && back.jd === sent.jd && /^A saved scene: Jupiter, /.test(await note(page)), `"${await note(page)}"`);
    // (the save as it is kept, for the damaged one below)
    const kept = await page.evaluate(() => { const [s] = JSON.parse(localStorage.getItem('starfarer-saves')); return localStorage.getItem(`starfarer-save-${s.id}`); });
    // deleted: one tap asks, a second deletes
    await press(page, '#hud .hud-tabs [data-tab="more"]');
    await press(page, '#hud .more .saves [data-save-delete]');
    const asked = await text(page, '#hud .more .saves [data-save-delete]');
    await press(page, '#hud .more .saves [data-save-delete]');
    const left = await page.evaluate(() => document.querySelectorAll('#hud .more .saves .save-row').length);
    check(on('a save is deleted with two taps (the first asks)'), asked === 'Delete?' && left === 0, `"${asked}", ${left} left`);
    // a damaged save (its first body one the catalogue has not got) opened in this changed universe: refused, plainly, and
    // the changed universe here stays as it was, its prediction too; then the same as a link come in while the app is open
    {
      const bad = damage(kept);
      await page.evaluate((frag) => {
        localStorage.setItem('starfarer-save-damaged1', frag);
        localStorage.setItem('starfarer-saves', JSON.stringify([{ id: 'damaged1', name: 'A damaged scene', saved: new Date().toISOString(), live: true }]));
        window.app.showSaves();
      }, bad);
      await page.evaluate(() => { const a = window.app, e = a.findByName('Europa'); a.placeNear(e, 9 * e.radius * a.rig.framing, 35, 12); });
      const was = await liveState(page), wasAhead = await foresee(page, 'Europa', kind);
      await press(page, '#hud .hud-tabs [data-tab="more"]');
      await press(page, '#hud .more .saves [data-save-open]');
      await frames(page, 5);
      const said = await note(page), now = await liveState(page), nowAhead = await foresee(page, 'Europa', kind);
      const same = (x) => x.on && x.ids.join() === was.ids.join() && x.pos.every((v, i) => v === was.pos[i]) && x.vel.every((v, i) => v === was.vel[i]) && x.jd === was.jd && JSON.stringify(x.log) === JSON.stringify(was.log);
      check(on('a damaged save opened in a changed universe is refused, plainly, and the changed universe here stays as it was, its prediction too'),
        /^This saved scene could not be opened: its simulation has a body that is not here\. Here is Starfarer as it was\.$/.test(said) && same(now) && !!wasAhead && wasAhead === nowAhead, `"${said}"; "${wasAhead}" / "${nowAhead}"`);
      await page.evaluate((frag) => { location.hash = frag.replace(/^#?/, ''); }, bad);
      await page.waitForFunction(() => !location.hash, null, { timeout: 60000 }).catch(() => undefined);
      await frames(page, 5);
      const said2 = await note(page), now2 = await liveState(page);
      check(on('the same, as a link come in while the app is open: refused, plainly, and the changed universe here as it was'),
        /^This link could not be opened: its simulation has a body that is not here\. Here is Starfarer as usual\.$/.test(said2) && same(now2), `"${said2}"`);
      await page.evaluate(() => { localStorage.removeItem('starfarer-save-damaged1'); localStorage.setItem('starfarer-saves', '[]'); window.app.showSaves(); });
      if (!(await shown(page, '#hud .sheet.more.on'))) await press(page, '#hud .hud-tabs [data-tab="more"]');
    }
    // the browser's storage full: saying so, nothing lost
    // (filled to the last few characters: large pieces while they go in, then ever smaller ones)
    await page.evaluate(() => { let i = 0; for (let size = 1 << 18; size >= 1; size >>= 1) { try { for (;;) localStorage.setItem(`filler-${i++}`, 'x'.repeat(size)); } catch { /* full at this size */ } } });
    await press(page, '#hud .sheet.more [data-act="save"]');
    await frames(page, 2);
    const full = await text(page, '#hud .hud-toast');
    check(on('with the storage full it says so plainly'), /^Not saved: this browser's storage for the app is full/.test(full), `"${full}"`);
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('filler-')) localStorage.removeItem(k); });
    await ctx.close();
    // private browsing as an older Safari has it: storage that keeps nothing
    const priv = await context(kind);
    await priv.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
    const pp = await priv.newPage();
    collectErrors(pp, errors);
    await pp.goto(`${base}?menu=0&time=${START}&paused=1&target=Earth&dist=6`, { waitUntil: 'load' });
    await pp.waitForFunction(() => window.app && window.app.frameCount > 30 && !document.getElementById('boot'), null, { timeout: 600000 });
    await press(pp, '#hud .hud-tabs [data-tab="more"]');
    await press(pp, '#hud .sheet.more [data-act="save"]');
    await frames(pp, 2);
    const none = await text(pp, '#hud .hud-toast');
    check(on('where the browser keeps nothing (private browsing) it says so, and the app goes on'), /^Not saved: this browser keeps nothing for the app/.test(none) && await pp.evaluate(() => !window.appError), `"${none}"`);
    await priv.close();
  }

  // ------------------------------------------------------------------ a link is written by a stranger: its text is text
  if (want('broken') && kind === 'desk') {
    const got = await open(kind, `${base}#v=1&o=${encodeURIComponent('<img src=x onerror="window.pwned=1">')}&a=-&c=1e12,0,0&q=0,0,0,1&t=2026-10-01T20:00:00.000Z&r=1&p=1`);
    await frames(got.page, 5);
    const r = await got.page.evaluate(() => ({ pwned: !!window.pwned, imgs: document.querySelectorAll('img[src="x"]').length, said: document.querySelector('#hud .hud-notice span').textContent }));
    check(on('a name from a link is shown as text, never as markup'), !r.pwned && r.imgs === 0 && r.said.includes('"<img src=x onerror="window.pwned=1">" could not be found here.'), `"${r.said}"`);
    await got.ctx.close();
  }
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
if (errors.length) { console.log('page errors:'); for (const e of [...new Set(errors)].slice(0, 20)) console.log(`  ${e}`); }
await browser.close();
process.exit(results.every((r) => r.ok) && results.length > 0 && !errors.length ? 0 : 1);
