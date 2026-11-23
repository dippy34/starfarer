// The link preview's picture (index.html, og:image): the app's own view, captured from it, 1200 x 630,
// with every control, name and orbit line hidden (photo mode). Not a browser suite: run it by hand when
// the look changes. Usage: node scripts/og-image.mjs [baseUrl] [out]   (default out: public/og-image.png)
// The scene: Saturn from a little above its rings, the Sun behind the eye's shoulder, in June 2017, when
// the rings were open to the Sun as wide as they get; asked for with the query the tests use (App.applyUrl).
import { launchBrowser } from './lib/browser.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const out = process.argv[3] ?? 'public/og-image.png';
const scene = process.env.OG_SCENE ?? 'menu=0&time=2017-06-15T00:00:00Z&paused=1&target=Saturn&dist=5.4&az=-38&el=20';
const browser = await launchBrowser();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
await page.goto(`${base}?${scene}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.app && window.app.frameCount > 30 && !document.getElementById('boot'), null, { timeout: 600000 });
// (photo mode, the orbit lines off: the view alone; the maps given time to arrive and the eye to settle)
await page.evaluate(() => { const a = window.app; a.select(null); a.act('photo'); if (a.orbits.enabled) a.act('orbits'); });
await page.evaluate(() => new Promise((done) => { const f0 = window.app.frameCount; const t = setInterval(() => { if (window.app.frameCount >= f0 + 240) { clearInterval(t); done(); } }, 50); }));
await page.evaluate(() => { const t = document.querySelector('#hud .hud-toast'); if (t) t.classList.remove('show'); });
await page.waitForTimeout(800);
await page.screenshot({ path: out });
console.log(`saved ${out}`);
await browser.close();
