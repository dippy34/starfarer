// What if: a moon made for a world, and the working behind the facts (src/app/WhatIf.ts,
// src/app/Worked.ts), on a phone and at a desk, in headless Chromium:
//   - a world's details show what is worked out from its facts, each line opening to its working
//   - a planet's card offers to add a moon; taking the offer makes one: a body like any other,
//     between the planet and the eye, moving as Kepler says, drawn, named and selected, and
//     simulated from the start (scripts/live.mjs has the planets and the suns that can be made)
//   - the moon says it was made, and is taken away like any world; with the return to reality
//     nothing of it is left
// (Changes are not watched here: "Show me what happens" is switched off in More first. The watch moves the
// camera and runs time on, and this measures where the moon starts against the eye and times a quarter of its
// period by the clock; scripts/live.mjs watches changes.)
// God mode, wave 2 (HANDOFF.md "God mode, wave 2"), each on a phone upright, on its side and at a desk:
//   - the slingshot's mark of escape near the top of the clear part of the view keeps its word, wholly in sight
//   - a world's temperature says which it is: the year's average in the real Solar System, where it is now in live physics
//   - a world made like the Earth is rock squeezed by its own weight: five Earths, 1.54 times its size
// Usage: node scripts/whatif.mjs [baseUrl] [outDir]   (WHATIF_ONLY=facts,escape,warm,size: those blocks alone; WHATIF_KINDS=desk:
// the wave-2 blocks at a desk only)
import { collectErrors, launchBrowser } from './lib/browser.mjs';
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

const frames = (page, n) => page.evaluate((n) => new Promise((done) => { const f0 = window.app.frameCount; const t = setInterval(() => { if (window.app.frameCount >= f0 + n) { clearInterval(t); done(); } }, 30); }), n);
const card = (page) => page.evaluate(() => {
  const c = document.querySelector('#hud .card');
  const shown = (el) => !!el && !el.hidden && !el.closest('[hidden]');
  return {
    title: c.querySelector('h2').textContent,
    facts: [...c.querySelectorAll('.facts dt')].map((d) => d.textContent),
    type: [...c.querySelectorAll('.facts dl div')].find((d) => d.querySelector('dt').textContent === 'Type')?.querySelector('dd').textContent ?? '',
    worked: [...c.querySelectorAll('.worked details')].map((d) => ({ label: d.querySelector('span').textContent, text: d.querySelector('b').textContent, math: d.querySelector('code').textContent, open: d.open })),
    add: shown(c.querySelector('[data-power="add"]')),
    offers: [...c.querySelectorAll('[data-panel="add"] .row')].filter(shown).map((r) => r.querySelector('b').textContent),
    remove: shown(c.querySelector('[data-act="remove"]')),
    toast: document.querySelector('#hud .hud-toast').textContent,
  };
});
const details = async (page) => {
  if (await page.evaluate(() => document.querySelector('#hud .card .facts').hidden)) await page.locator('#hud .card [data-details]').tap().catch(() => page.locator('#hud .card [data-details]').click());
  await page.waitForSelector('#hud .card .facts:not([hidden])');
  await frames(page, 2);
};
const press = async (page, sel) => { const b = page.locator(sel); await b.scrollIntoViewIfNeeded(); await b.tap().catch(() => b.click()); };
/** Changes not watched (More: "Show me what happens", off). */
const quiet = async (page) => {
  await press(page, '#hud .hud-tabs [data-tab="more"]');
  if ((await page.locator('#hud .switch[data-act="show-me"]').getAttribute('aria-checked')) === 'true') await press(page, '#hud .switch[data-act="show-me"]');
  await press(page, '#hud .sheet.more [data-close]');
  await frames(page, 2);
};

/** some blocks only, by name (WHATIF_ONLY=escape,warm: facts, escape, warm, size); the rest are left out */
const only = process.env.WHATIF_ONLY ?? '';
const want = (name) => !only || only.split(',').includes(name);

for (const kind of want('facts') ? ['phone', 'desk'] : []) {
  const ctx = kind === 'phone' ? await phoneContext(browser) : await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  collectErrors(page, errors);
  await page.goto(`${base}?menu=0&target=Earth&dist=6&time=2026-10-01T20:00:00Z`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.app && window.app.frameCount > 30 && !document.getElementById('boot'), null, { timeout: 600000 });
  const on = (name) => `${kind}: ${name}`;
  await quiet(page);

  // --- the working behind the facts
  await details(page);
  let c = await card(page);
  const g = c.worked.find((w) => w.label === 'Surface gravity');
  check(on("the Earth's details show what is worked out from its facts"), c.worked.length >= 6 && g?.text === '9.82 m/s²', c.worked.map((w) => `${w.label} ${w.text}`).join(' · '));
  check(on('a fact that is worked out is not listed a second time'), !c.facts.includes('Surface gravity') && !c.facts.includes('Mean density') && c.facts.includes('Radius'), c.facts.join(', '));
  await press(page, '#hud .card .worked details:first-child summary');
  await frames(page, 2);
  c = await card(page);
  check(on('a line opens to show its working: the formula, the numbers put in, the result'), c.worked[0].open && /^g = GM \/ R² = .+ kg \/ \(.+ m\)² = 9\.82 m\/s²$/.test(c.worked[0].math), c.worked[0].math);
  const year = c.worked.find((w) => w.label === 'Once round the Sun');
  check(on('its year is the catalogued one in the real Solar System'), !!year && /^365\.256 d$/.test(year.text) && /mean period/.test(year.math), year?.text);

  // --- a moon for the Earth
  check(on("a planet's card offers to add something"), c.add && c.remove && c.offers.length === 0);
  await press(page, '#hud .card [data-power="add"]');
  await frames(page, 2);
  c = await card(page);
  check(on('what can be added to a planet is a moon'), c.offers.join() === 'A moon', c.offers.join(', '));
  // (where the eye is as Add is tapped: the new moon starts between it and the Earth; the camera may then ease out, to
  // show the new moon clear of the card while it is put in place)
  const before = await page.evaluate(() => {
    const a = window.app, earth = a.findByName('Earth');
    return { bodies: a.system.bodies.length, moons: earth.children.length, live: a.physics.on, eye: a.rig.upos.sub(earth.upos, new (a.rig.ray(0, 0).constructor)()).toArray() };
  });
  await press(page, '#hud .card [data-act="add-moon"]');
  await frames(page, 6);
  const made = await page.evaluate((eyeThen) => {
    const a = window.app, m = a.selection, earth = a.findByName('Earth');
    const V = a.rig.ray(0, 0).constructor;
    const rel = m.pos.clone().sub(earth.pos), eye = new V(...eyeThen);
    const v = a.bodies.views.get(m);
    const p = a.project(m.upos.sub(a.rig.upos, new V()));
    return {
      name: m.name, parent: m.parent?.name, bodies: a.system.bodies.length, moons: earth.children.length, made: a.made.length,
      live: a.physics.on, simulated: a.physics.simulated(m),
      orbit: rel.length() / earth.radius, eye: eye.length() / earth.radius, towardsEye: rel.clone().normalize().dot(eye.normalize()),
      speed: m.vel.clone().sub(earth.vel).length(), circular: Math.sqrt((earth.gm + m.gm) / rel.length()),
      px: v?.pixelRadius ?? 0, resolved: !!v?.resolved, at: p, size: [innerWidth, innerHeight], radius: m.radius / earth.radius,
    };
  }, before.eye);
  c = await card(page);
  check(on('taking the offer makes one: it is a body of the system, and selected'), made.bodies === before.bodies + 1 && made.moons === before.moons + 1 && made.made === 1 && made.name === "Earth's new moon" && c.title === made.name,
    `${made.name}; ${made.bodies} bodies (${before.bodies} before); the card: ${c.title}`);
  check(on('making it is a change like any other: physics is live from then on, and the moon is simulated'), !before.live && made.live && made.simulated && /Live physics is on/.test(c.toast));
  check(on('it says what was made'), /new moon is new: .+ up, once round in .+ (h|d)\./.test(c.toast), c.toast);
  check(on('it is between the Earth and the eye, on a circular orbit'), Math.abs(made.orbit - 0.55 * made.eye) < 0.02 && made.towardsEye > 0.9 && Math.abs(made.speed / made.circular - 1) < 1e-3,
    `${made.orbit.toFixed(2)} radii out (the eye at ${made.eye.toFixed(2)}), ${(Math.acos(Math.min(1, made.towardsEye)) * 57.3).toFixed(1)} deg from the eye's direction, ${(made.speed / 1000).toFixed(3)} km/s (circular: ${(made.circular / 1000).toFixed(3)})`);
  check(on('it is drawn, in the frame'), made.resolved && made.px > 4 && !!made.at && made.at.x > 0 && made.at.x < made.size[0] && made.at.y > 0 && made.at.y < made.size[1],
    `${made.px.toFixed(0)} px in radius at ${made.at ? `${made.at.x.toFixed(0)}, ${made.at.y.toFixed(0)}` : 'nowhere'}`);
  await page.evaluate(() => { window.app.hud.setHidden(true); });
  await frames(page, 4);
  await page.screenshot({ path: path.join(outDir, `whatif-${kind}-moon.png`) });
  await page.evaluate(() => { window.app.hud.setHidden(false); });

  // --- it moves on: a quarter of its period later, a quarter of the way round
  const turned = await page.evaluate(async () => {
    const a = window.app, m = a.selection, earth = a.findByName('Earth');
    const dir = () => m.pos.clone().sub(earth.pos).normalize();
    const d0 = dir();
    const P = (2 * Math.PI * Math.sqrt(m.pos.distanceTo(earth.pos) ** 3 / (earth.gm + m.gm))) / 86400;
    const to = a.clock.jdTdb + P / 4, live = a.physics.live;
    // (the clock is put there, and the simulation given the frames it needs to follow: to within ten seconds)
    await new Promise((done) => { const t = setInterval(() => { if (Math.abs(live.jd0 + live.sim.time / 86400 - to) < 1e-4) { clearInterval(t); done(); } else a.clock.jdTdb = to; }, 30); });
    await new Promise((done) => { const f0 = a.frameCount; const t = setInterval(() => { if (a.frameCount >= f0 + 3) { clearInterval(t); done(); } }, 30); });
    return { cos: d0.dot(dir()), periodDays: P };
  });
  check(on('a quarter of its period later it is a quarter of the way round'), Math.abs(turned.cos) < 0.02, `cosine of the angle turned through: ${turned.cos.toFixed(4)} (period ${(turned.periodDays * 24).toFixed(1)} h)`);

  // --- its own details: made by you, worked out like any moon, and it can be taken away
  await details(page);
  c = await card(page);
  const round = c.worked.find((w) => w.label === 'Once round Earth');
  check(on('its details say it was made, and work out its orbit like any moon\'s'), c.type === 'Moon (made by you)' && !!round && c.worked.some((w) => w.label === 'Surface gravity'), `${c.type}; ${round?.label} ${round?.text}`);
  check(on('it can be removed like any world, and is not offered a moon of its own'), c.remove && !c.add);
  await page.screenshot({ path: path.join(outDir, `whatif-${kind}-details.png`) });
  await press(page, '#hud .card [data-act="remove"]');
  await frames(page, 6);
  const after = await page.evaluate(() => {
    const a = window.app, m = a.made[0];
    return { gone: a.system.isGone(m), drawn: a.bodies.views.has(m), found: a.searchItems('new moon').length, selection: a.selection?.name, target: a.rig.target?.name, toast: document.querySelector('#hud .hud-toast').textContent };
  });
  check(on('taken away, it is gone: not drawn, not found by name, and the Earth is selected again'), after.gone && !after.drawn && after.found === 0 && after.selection === 'Earth' && after.target === 'Earth' && /is gone/.test(after.toast),
    `selection ${after.selection}, "${after.toast}"`);

  // --- back to reality: nothing of it is left
  await press(page, '#hud .live-back');
  await frames(page, 6);
  const real = await page.evaluate(() => ({ bodies: window.app.system.bodies.length, moons: window.app.findByName('Earth').children.length, made: window.app.made.length, live: window.app.physics.on }));
  check(on('back to reality, nothing of it is left'), real.bodies === before.bodies && real.moons === before.moons && real.made === 0 && !real.live, `${real.bodies} bodies, ${real.moons} moon of the Earth's`);

  // --- what is not offered: a moon for a moon
  await page.evaluate(() => window.app.select(window.app.findByName('Moon')));
  await frames(page, 3);
  await details(page);
  c = await card(page);
  check(on("the Moon is not offered a moon of its own"), c.title === 'Moon' && !c.add && c.remove && c.worked.length >= 4, `${c.title}: ${c.worked.length} lines worked out`);
  await ctx.close();
}

// ================================================================== god mode, wave 2: on a phone upright, on its side, and at a desk
// (HANDOFF.md "God mode, wave 2". The blocks are new pages of their own; changes are not watched, as above.)

/** A fresh page: a phone upright ('phone') or on its side ('side'), with fingers, or a desk with the mouse. */
async function openKind(kind, query) {
  const ctx = kind === 'desk' ? await browser.newContext({ viewport: { width: 1280, height: 800 } }) : await phoneContext(browser, { landscape: kind === 'side' });
  const page = await ctx.newPage();
  collectErrors(page, errors);
  await page.goto(`${base}?menu=0&time=2026-10-01T20:00:00Z&paused=1&${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.app && window.app.frameCount > 30 && !document.getElementById('boot'), null, { timeout: 600000 });
  return { ctx, page, touch: kind === 'desk' ? null : await fingers(page) };
}

/** The mouse at a desk, its events given their times as the fingers' are (16 ms apart): press, slide, lift (scripts/live.mjs). */
async function mouseHand(page) {
  const cdp = await page.context().newCDPSession(page);
  let clock = Date.now() / 1000, at = { x: 0, y: 0 };
  const send = (type, p, buttons) => { clock += 0.016; at = p; return cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: 1, timestamp: clock }); };
  return {
    async press(p) { await send('mouseMoved', p, 0); await send('mousePressed', p, 1); await frames(page, 1); },
    async slide(p) { await send('mouseMoved', p, 1); await frames(page, 1); },
    async lift(rest = 0.3) { clock += rest; await send('mouseReleased', at, 0); await frames(page, 1); },
  };
}
const handOf = async (page, touch) => (touch ? { press: (p) => touch.press(p), slide: (p) => touch.slide(p), lift: () => touch.lift() } : mouseHand(page));

/** Find a place by name and choose it (as scripts/live.mjs does): its card up. */
async function find(page, name) {
  if (!(await page.evaluate(() => !!document.querySelector('#hud .sheet.explore.on')))) await press(page, '#hud .hud-tabs [data-tab="search"]');
  await page.locator('#hud .searchbox input').fill(name);
  const row = page.locator('#hud .explore .list .row').filter({ has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) }).first();
  await row.waitFor({ timeout: 20000 });
  await row.tap().catch(() => row.click());
  await page.waitForFunction((n) => window.app.selection?.name === n && document.querySelector('#hud').dataset.sheet === 'card' && document.querySelector('#hud .card h2').textContent === n, name, { timeout: 20000 });
}
const until = (page, test, arg, seconds = 120) => page.waitForFunction(test, arg, { timeout: seconds * 1000, polling: 100 }).then(() => true, () => false);
const text = (page, sel) => page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', sel);

/**
 * The knob of a slider (`sel`) dragged from where it is to `to` (0 to 1 along its track: the knob is 30 px wide and stays
 * inside it). (Once more if it did not get there: at a desk, a drag begun as the card settles has been seen to miss the knob.)
 */
async function slide(page, hand, sel, to) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await frames(page, 3);
    const el = page.locator(sel), box = await el.boundingBox(), min = Number((await el.getAttribute('min')) ?? 0), max = Number((await el.getAttribute('max')) ?? 1);
    const now = (Number(await el.inputValue()) - min) / (max - min);
    const at = (s) => ({ x: box.x + 15 + s * (box.width - 30), y: box.y + box.height / 2 });
    const from = at(now), end = at(to);
    await hand.press(from);
    for (let i = 1; i <= 6; i++) await hand.slide({ x: from.x + ((end.x - from.x) * i) / 6, y: from.y });
    await hand.lift();
    await frames(page, 2);
    if (Math.abs((Number(await el.inputValue()) - min) / (max - min) - to) < 0.01) return;
  }
}

/** on a phone upright, on its side and at a desk, or some of them (WHATIF_KINDS=desk) */
const kinds = (process.env.WHATIF_KINDS ?? 'phone,side,desk').split(',');

for (const kind of kinds) {
  const on = (name) => `${kind}: ${name}`;

  // ------------------------------------------------------------------ the mark of escape at the top of the clear part keeps its word
  if (want('escape')) {
    const { ctx, page, touch } = await openKind(kind, 'target=Earth&dist=6');
    const hand = await handOf(page, touch);
    await quiet(page);
    await find(page, 'Moon');
    await press(page, '#hud .hud-flight [data-act="stop"]').catch(() => undefined);
    await press(page, '#hud .card [data-act="move"]');
    await press(page, '#hud .card [data-act="move-throw"]');
    await frames(page, 3);
    // (setup, not a power: the eye high over the Earth, the Moon in the clear part of the view with room above it for an
    // arrow to reach the top of that part, its way ahead mostly across the screen, and room below it for the finger)
    const view = await page.evaluate(() => {
      const a = window.app, earth = a.findByName('Earth'), moon = a.findByName('Moon'), V = moon.pos.constructor;
      // (the clear part of the view as it will be once the throw has made physics live: with the mark of live physics shown,
      // which on a phone upright comes in under the chips)
      const mark = document.querySelector('#hud .live-mark'), hidden = mark.hidden;
      mark.hidden = false;
      const free = a.hud.freeArea();
      mark.hidden = hidden;
      for (const el of [75, 60, 45]) for (const dist of [60, 90, 120, 180, 260, 350]) for (let az = 0; az < 360; az += 10) {
        a.placeNear(earth, dist * earth.radius, az, el);
        a.frame();
        const r = moon.pos.clone().sub(earth.pos), ahead = r.clone().cross(moon.vel.clone().sub(earth.vel)).cross(r).normalize();
        const dot = a.project(moon.upos.sub(a.rig.upos, new V())), tip = a.project(moon.upos.sub(a.rig.upos, new V()).addScaledVector(ahead, 1e5));
        if (!dot || !tip) continue;
        const l = Math.hypot(tip.x - dot.x, tip.y - dot.y), ay = (tip.y - dot.y) / l;
        const below = dot.y - free.top;
        if (dot.x > free.left + 110 && dot.x < free.right - 60 && below > 95 && below < 150 && dot.y + 120 < innerHeight - 10 && Math.abs(ay) < 0.5) return { dot };
      }
      return null;
    });
    await frames(page, 3);
    let at = null;
    if (view) {
      await hand.press(view.dot);
      // the finger pulled back down and to the right: the arrow up and to the left; then turned, a slide at a time, until the
      // mark of escape is at the top of the clear part of the view (under the mark of live physics, which the throw brings)
      let u = { x: -0.5, y: -Math.sqrt(0.75) };
      for (let i = 0; i < 10; i++) {
        await hand.slide({ x: view.dot.x - u.x * 107, y: view.dot.y - u.y * 107 });
        await frames(page, 3);
        at = await page.evaluate(() => {
          const a = window.app, aim = a.mover.aim(), free = a.hud.freeArea();
          if (!aim || !(aim.length > 0)) return null;
          const k = aim.edge + aim.escape, mark = { x: aim.x + aim.ux * k, y: aim.y + aim.uy * k };
          return { aim, free, mark };
        });
        if (!at) break;
        const off = at.mark.y - at.free.top;
        if (off >= -5 && off <= 3) break;
        const uy = Math.max(-0.97, Math.min(-0.2, (at.free.top - 1 - at.aim.y) / (at.aim.edge + at.aim.escape)));
        u = { x: -Math.sqrt(1 - uy * uy), y: uy };
      }
    }
    await frames(page, 3);
    const seen = await page.evaluate(() => {
      const svg = document.querySelector('#hud .aim'), t = svg.querySelector('[data-mark="escape"] text'), c = svg.querySelector('[data-mark="circle"] text');
      const v = (/inset\(([^)]*)\)/.exec(svg.style.clipPath)?.[1] ?? '').split(' ').filter(Boolean).map(parseFloat);
      const clip = v.length ? { left: v[3] ?? v[1] ?? v[0], top: v[0], right: innerWidth - (v[1] ?? v[0]), bottom: innerHeight - (v[2] ?? v[0]) } : null;
      const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width }; };
      const g = svg.querySelector('.aim-guide'), line = ['x1', 'y1', 'x2', 'y2'].map((k) => +g.getAttribute(k));
      return { shown: !svg.hasAttribute('hidden'), escape: getComputedStyle(t).display !== 'none' ? box(t) : null, circle: getComputedStyle(c).display !== 'none' ? box(c) : null, clip, line, live: window.app.physics.on };
    });
    const e = seen.escape, inside = !!e && !!seen.clip && e.w > 20 && e.l >= seen.clip.left - 0.5 && e.r <= seen.clip.right + 0.5 && e.t >= seen.clip.top - 0.5 && e.b <= seen.clip.bottom + 0.5;
    const near = !!e && !!at && Math.hypot(Math.max(e.l - at.mark.x, 0, at.mark.x - e.r), Math.max(e.t - at.mark.y, 0, at.mark.y - e.b)) < 45;
    const apart = !!e && (!seen.circle || e.r <= seen.circle.l || e.l >= seen.circle.r || e.b <= seen.circle.t || e.t >= seen.circle.b);
    const [x1, y1, x2, y2] = seen.line, steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
    const onLine = !!e && Array.from({ length: steps + 1 }, (_, k) => [x1 + ((x2 - x1) * k) / steps, y1 + ((y2 - y1) * k) / steps]).some(([x, y]) => x > e.l - 1 && x < e.r + 1 && y > e.t - 1 && y < e.b + 1);
    check(on('the Moon aimed with its mark of escape at the top of the clear part of the view, under the mark of live physics: the word "escape" is shown whole in the clear part, by its mark, clear of the arrow and of the word "circle"'),
      !!view && !!at && seen.shown && seen.live && at.mark.y - at.free.top >= -5 && at.mark.y - at.free.top <= 3 && inside && near && apart && !onLine,
      at ? `the mark ${(at.mark.y - at.free.top).toFixed(1)} px from the top of the clear part (${at.free.top.toFixed(0)}); the word at ${e ? `${e.l.toFixed(0)}-${e.r.toFixed(0)} x ${e.t.toFixed(0)}-${e.b.toFixed(0)}` : 'none'}, drawn in ${seen.clip ? `${seen.clip.left.toFixed(0)}-${seen.clip.right.toFixed(0)} x ${seen.clip.top.toFixed(0)}-${seen.clip.bottom.toFixed(0)}` : 'everywhere'}; by its mark ${near}, apart from "circle" ${apart}, on the line ${onLine}` : 'no view found, or no arrow');
    await page.screenshot({ path: path.join(outDir, `whatif-${kind}-escape.png`) });
    await ctx.close();
  }

  // ------------------------------------------------------------------ a world's temperature: the year's average, or where it is now
  if (want('warm')) {
    const { ctx, page, touch } = await openKind(kind, 'target=Earth&dist=6');
    const hand = await handOf(page, touch);
    await quiet(page);
    await find(page, 'Moon');
    await press(page, '#hud .hud-flight [data-act="stop"]').catch(() => undefined);
    const real = await text(page, '#hud .card .card-warmth');
    const where = await page.evaluate(() => window.app.findByName('Moon').pos.toArray());
    // live physics on, the Moon not moved: twice as heavy, with its mass slider
    if (!(await page.evaluate(() => { const el = document.querySelector('#hud .card [data-panel="mass"] .slider:not(.size-slider)'); return !!el && el.getBoundingClientRect().height > 0; }))) await press(page, '#hud .card [data-power="mass"]');
    await frames(page, 2);
    await slide(page, hand, '#hud .card [data-panel="mass"] .slider:not(.size-slider)', (3 + Math.log10(2)) / 6);
    await frames(page, 4);
    const now = await page.evaluate((where) => {
      const a = window.app, m = a.findByName('Moon'), el = document.querySelector('#hud .card .card-warmth');
      return { on: a.physics.on, factor: m.gm / a.physics.realGm(m), moved: Math.hypot(...m.pos.toArray().map((x, k) => x - where[k])), line: el?.textContent ?? '', live: !!el?.classList.contains('live'), shown: !!el && el.getBoundingClientRect().height > 0 };
    }, where);
    if (await page.evaluate(() => document.querySelector('#hud .card .facts').hidden)) await press(page, '#hud .card [data-details]');
    await frames(page, 3);
    const working = await page.evaluate(() => [...document.querySelectorAll('#hud .card .worked details')].map((d) => ({ label: d.querySelector('span').textContent, math: d.querySelector('code').textContent })).find((w) => w.label === 'Temperature without air')?.math ?? '');
    const said = /^On average, without air: (−?\d+) °C$/.exec(real);
    check(on('in the real Solar System the Moon\'s card says its temperature is the year\'s average'), !!said, `"${real}"`);
    check(on('live physics on, the Moon not moved: its card says where it is now ("here"), and its working says both, the year\'s average beside it'),
      now.on && Math.abs(now.factor - 2) < 0.1 && now.moved < 1 && now.shown && now.live && /^The Moon here: −?\d+ °C$/.test(now.line)
        && working.includes('the sunlight where it is now') && !!said && working.includes(`on average over the year, at its mean distance from the Sun (1361 W/m², NASA's fact sheet), it is ${said[1]} °C`),
      `"${now.line}"; ${now.factor.toFixed(2)} times its mass, moved ${now.moved.toFixed(3)} m; the working: "…${working.slice(-140)}"`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ a world made like the Earth: rock squeezed by its own weight
  if (want('size')) {
    const { ctx, page, touch } = await openKind(kind, 'target=Sun&dist=473&el=40');
    const hand = await handOf(page, touch);
    await quiet(page);
    await press(page, '#hud .card [data-power="add"]');
    await press(page, '#hud .card [data-act="add-earth"]');
    await until(page, () => !window.app.glide, null, 60);
    await frames(page, 2);
    await slide(page, hand, '#hud .card .placing .slider', Math.log(5 / 0.05) / Math.log(10 / 0.05));
    const made = await page.evaluate(() => {
      const a = window.app, m = a.selection, panel = document.querySelector('#hud .card .placing');
      return { name: m.name, read: panel.querySelector('b').textContent, what: panel.querySelector('small').textContent, earths: m.gm / 6.6743e-11 / 5.9722e24, ratio: m.radius / 6.371e6, placing: a.mover.placing };
    });
    if (await page.evaluate(() => document.querySelector('#hud .card .facts').hidden)) await press(page, '#hud .card [data-details]');
    await frames(page, 3);
    const working = await page.evaluate(() => [...document.querySelectorAll('#hud .card .worked details')].map((d) => ({ label: d.querySelector('span').textContent, math: d.querySelector('code').textContent })).find((w) => w.label === 'Its size (made by you)')?.math ?? '');
    // (R = R⊕ (M / M⊕)^(1/3.7): Zeng, Sasselov & Jacobsen 2016; at the Earth's density it was 1.71 times, the cube root)
    check(on('a planet like the Earth made 5 Earths heavy is rock and iron squeezed by its own weight: 1.54 times the Earth\'s size, and its details say by what rule'),
      made.name === 'Earth 2' && made.placing && /^(4\.9|5|5\.1) Earths$/.test(made.read) && /^Rock, 1\.5\d times the Earth's size$/.test(made.what) && Math.abs(made.ratio - made.earths ** (1 / 3.7)) < 1e-4
        && /^R = R⊕ \(M \/ M⊕\)\^\(1\/3\.7\) = .*Zeng, Sasselov & Jacobsen 2016, fitted from 1 to 8 Earths\)$/.test(working),
      `"${made.read}", "${made.what}"; ${made.earths.toFixed(3)} Earths, ${made.ratio.toFixed(4)} of its radius (${(made.earths ** (1 / 3.7)).toFixed(4)} by the rule); "${working}"`);
    await page.screenshot({ path: path.join(outDir, `whatif-${kind}-size.png`) });
    await ctx.close();
  }
}

console.log(errors.length ? `console errors:\n${errors.slice(0, 10).join('\n')}` : 'no console errors');
check('no console errors', errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
