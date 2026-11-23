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
//     says so; never a crash or a blank screen
// Usage: node scripts/share.mjs [baseUrl] [outDir]   (SHARE_ONLY=view,broken: those blocks alone; SHARE_KINDS=desk)
import { collectErrors, launchBrowser } from './lib/browser.mjs';
import { phoneContext } from './lib/touch.mjs';
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
const press = async (page, sel) => { const b = page.locator(sel).first(); await b.scrollIntoViewIfNeeded(); await b.tap().catch(() => b.click()); };
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

/** Ask for a rate of time with the Time sheet's buttons: `label` is what the clock chip then shows ("1 h/s"); `pause`: then paused. */
async function setTime(page, label, pause) {
  if (!(await shown(page, '#hud .sheet.time.on'))) await press(page, '#hud .hud-tabs [data-tab="time"]');
  for (let i = 0; i < 16 && (await text(page, '#hud .chip.clock small')) !== label; i++) {
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

/** How far apart two scenes are: the camera's place (as a share of its distance), its look (rad), the date (ms). */
function apart(a, b) {
  const d = Math.hypot(...a.off), off = Math.hypot(a.off[0] - b.off[0], a.off[1] - b.off[1], a.off[2] - b.off[2]) / d;
  const ang = (u, v) => Math.acos(Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
  return { off, look: ang(a.fwd, b.fwd), roll: ang(a.up, b.up), ms: Math.abs(a.jd - b.jd) * 86_400_000 };
}

/** The note the app shows over its panels (src/ui/Hud.ts notice), or '' when there is none. */
const note = (page) => page.evaluate(() => { const n = document.querySelector('#hud .hud-notice'); return n && !n.hidden ? n.querySelector('span').textContent : ''; });

/** Share through the interface (the card's button, or More's row): the link it handed on, and the scene at that moment. */
async function share(page, kind, from) {
  if (from === 'more') {
    await press(page, '#hud .hud-tabs [data-tab="more"]');
    await press(page, '#hud .sheet.more [data-act="share"]');
  } else await press(page, '#hud .card [data-act="share"]');
  await frames(page, 3);
  const before = await scene(page);
  if (kind === 'desk') {
    await page.waitForFunction(() => document.querySelector('#hud .hud-toast').textContent === 'Link copied', null, { timeout: 20000 }).catch(() => undefined);
    const url = await page.evaluate(() => navigator.clipboard.readText());
    return { url, before, toast: await text(page, '#hud .hud-toast'), sheet: null };
  }
  await page.waitForFunction(() => window.shared.length > 0, null, { timeout: 20000 }).catch(() => undefined);
  const sheet = await page.evaluate(() => window.shared[window.shared.length - 1] ?? null);
  return { url: sheet?.url ?? '', before, toast: await text(page, '#hud .hud-toast'), sheet };
}

const only = process.env.SHARE_ONLY ?? '';
const want = (name) => !only || only.split(',').includes(name);
const kinds = (process.env.SHARE_KINDS ?? 'phone,side,desk').split(',');
let phoneLink = null;

for (const kind of kinds) {
  const on = (name) => `${kind}: ${name}`;

  // ------------------------------------------------------------------ the real universe: a view shared and opened again
  if (want('view')) {
    const { ctx, page } = await open(kind, `${base}?menu=0&time=${START}&paused=1&target=Earth&dist=6`);
    await setTime(page, '1 h/s', true);
    // (setup: the Moon selected while the camera stays at the Earth, as a tap on the Moon leaves it; and the camera
    // turned off the way the app put it: a view of the explorer's own, not the default)
    await page.evaluate(() => { const a = window.app; a.select(a.findByName('Moon')); a.rig.turn(0.15); a.rig.quat.multiply(a.rig.quat.clone().setFromAxisAngle(a.rig.forward().set(1, 0, 0), 0.05)); });
    await page.waitForFunction(() => document.querySelector('#hud').dataset.sheet === 'card' && document.querySelector('#hud .card h2').textContent === 'Moon', null, { timeout: 20000 });
    await frames(page, 3);
    check(on('Share is on the card of what is selected, in reach (not hunted for)'), await reachable(page, '#hud .card [data-act="share"]'));
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
  if (want('running') && kind === 'phone') {
    const { ctx, page } = await open(kind, `${base}?menu=0&time=${START}&paused=0&target=Mars&dist=5`);
    await find(page, 'Mars');
    await setTime(page, '1 d/s', false);
    await frames(page, 10);
    const s = await share(page, kind, 'card');
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
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
if (errors.length) { console.log('page errors:'); for (const e of [...new Set(errors)].slice(0, 20)) console.log(`  ${e}`); }
await browser.close();
process.exit(results.every((r) => r.ok) && results.length > 0 && !errors.length ? 0 : 1);
