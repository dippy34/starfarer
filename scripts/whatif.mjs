// What if: a moon made for a world, and the working behind the facts (src/app/WhatIf.ts,
// src/app/Worked.ts), on a phone and at a desk, in headless Chromium:
//   - a world's details show what is worked out from its facts, each line opening to its working
//   - a planet's card offers to add a moon; taking the offer makes one: a body like any other,
//     between the planet and the eye, moving as Kepler says, drawn, named and selected, and
//     simulated from the start (scripts/live.mjs has the planets and the suns that can be made)
//   - the moon says it was made, and is taken away like any world; with the return to reality
//     nothing of it is left
// Usage: node scripts/whatif.mjs [baseUrl] [outDir]
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

for (const kind of ['phone', 'desk']) {
  const ctx = kind === 'phone' ? await phoneContext(browser) : await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  collectErrors(page, errors);
  await page.goto(`${base}?menu=0&target=Earth&dist=6&time=2026-10-01T20:00:00Z`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.app && window.app.frameCount > 30 && !document.getElementById('boot'), null, { timeout: 600000 });
  const on = (name) => `${kind}: ${name}`;

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
  const before = await page.evaluate(() => ({ bodies: window.app.system.bodies.length, moons: window.app.findByName('Earth').children.length, live: window.app.physics.on }));
  await press(page, '#hud .card [data-act="add-moon"]');
  await frames(page, 6);
  const made = await page.evaluate(() => {
    const a = window.app, m = a.selection, earth = a.findByName('Earth');
    const V = a.rig.ray(0, 0).constructor;
    const rel = m.pos.clone().sub(earth.pos), eye = a.rig.upos.sub(earth.upos, new V());
    const v = a.bodies.views.get(m);
    const p = a.project(m.upos.sub(a.rig.upos, new V()));
    return {
      name: m.name, parent: m.parent?.name, bodies: a.system.bodies.length, moons: earth.children.length, made: a.made.length,
      live: a.physics.on, simulated: a.physics.simulated(m),
      orbit: rel.length() / earth.radius, eye: eye.length() / earth.radius, towardsEye: rel.clone().normalize().dot(eye.normalize()),
      speed: m.vel.clone().sub(earth.vel).length(), circular: Math.sqrt((earth.gm + m.gm) / rel.length()),
      px: v?.pixelRadius ?? 0, resolved: !!v?.resolved, at: p, size: [innerWidth, innerHeight], radius: m.radius / earth.radius,
    };
  });
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

console.log(errors.length ? `console errors:\n${errors.slice(0, 10).join('\n')}` : 'no console errors');
check('no console errors', errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
