// The offline copy, in headless Chromium on a phone. The test-only offlineTest=earth-moon option limits
// the download to this open Earth view's startup files and the Earth/Moon maps and terrain. Then the
// network is switched off: the app reloads, Earth wears its map, Go there reaches the Moon, and Remove
// unregisters the worker and empties every Starfarer offline cache.
// Usage: node scripts/offline.mjs [baseUrl] [outDir]
import { collectErrors, launchBrowser } from './lib/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'screenshots';
fs.mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const results = [];
const errors = [];
const failedRequests = [];
collectErrors(page, errors);
page.on('requestfailed', (request) => {
  const error = request.failure()?.errorText ?? 'failed';
  // Reloading a page can cancel an optional request it no longer needs. A missing offline file instead
  // reports ERR_INTERNET_DISCONNECTED / ERR_FAILED and is never filtered out here.
  if (error !== 'net::ERR_ABORTED') failedRequests.push(`${error} ${request.url()}`);
});
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
};
const shot = (name) => page.screenshot({ path: path.join(outDir, name), timeout: 180000 });
const ready = async () => {
  await page.waitForFunction(() => window.app && window.app.frameCount > 12 && !document.getElementById('boot'), null, { timeout: 600000 });
};
const openMore = async () => {
  if (await page.evaluate(() => document.querySelector('#hud').dataset.sheet !== 'more')) await page.tap('#hud .hud-tabs [data-tab="more"]');
  await page.waitForSelector('#hud .sheet.more.on', { timeout: 30000 });
};
const mapReady = async (key) => {
  await page.waitForFunction((key) => {
    const bodies = window.app?.bodies;
    return !!bodies && (bodies.smallLoaded.has(key) || bodies.loadedTex.has(key));
  }, key, { timeout: 180000 });
};

try {
  const query = '?menu=0&gaia=0&procedural=0&offlineTest=earth-moon&time=2026-10-01T20:00:00Z&paused=1&target=Earth&dist=6';
  await page.goto(`${base}${query}`, { waitUntil: 'load' });
  await ready();
  await mapReady('earth_day');
  await openMore();
  if (await page.locator('.offline-panel').count()) await page.locator('.offline-panel').scrollIntoViewIfNeeded();
  await shot('offline-0-more.png');
  const notAsked = await page.evaluate(async () => ({
    registrations: (await navigator.serviceWorker.getRegistrations()).length,
    caches: (await caches.keys()).filter((name) => name.startsWith('starfarer-offline-')),
  }));
  check('opening More without asking for a copy registers no worker and creates no offline cache', notAsked.registrations === 0 && notAsked.caches.length === 0, JSON.stringify(notAsked));

  const download = page.locator('[data-offline-download]');
  await download.waitFor({ timeout: 15000 });
  await page.waitForFunction(() => /about [\d,]+ MB/.test(document.querySelector('[data-offline-download]')?.textContent ?? ''), null, { timeout: 60000 });
  const offer = await page.locator('.offline-panel').innerText();
  check('More offers everything for offline use, with its measured size and a Wi-Fi note',
    /Use offline/i.test(offer) && /Download everything for offline use \(about [\d.]+ (?:MB|GB)\)/.test(offer) && /Wi-Fi/.test(offer) && /free/.test(offer), offer.replace(/\s+/g, ' '));

  await download.tap();
  await page.waitForFunction(() => document.querySelector('[data-offline-status]')?.textContent === 'Starfarer works offline', null, { timeout: 900000, polling: 100 });
  check('the small test copy downloads and says Starfarer works offline', true);
  const installed = await page.evaluate(async () => ({
    registrations: (await navigator.serviceWorker.getRegistrations()).filter((r) => r.scope === new URL('./', location.href).href).length,
    caches: (await caches.keys()).filter((k) => k.startsWith('starfarer-offline-')),
  }));
  check('downloading installs one scoped worker and an offline cache', installed.registrations === 1 && installed.caches.length > 0, JSON.stringify(installed));
  await shot('offline-1-downloaded.png');

  await page.tap('#hud .sheet.more [data-close]');
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load', timeout: 180000 });
  await ready();
  await mapReady('earth_day');
  const earth = await page.evaluate(() => ({ selected: window.app.selection?.name, target: window.app.rig.target?.name, error: window.appError ?? '' }));
  check('offline reload starts the app at Earth with its map and no application error', earth.selected === 'Earth' && earth.target === 'Earth' && !earth.error, JSON.stringify(earth));
  await shot('offline-2-earth.png');

  await page.evaluate(() => { const a = window.app, moon = a.findByName('Moon'); a.select(moon); a.goTo(moon); });
  await page.waitForFunction(() => {
    const a = window.app;
    return a.selection?.name === 'Moon' && a.rig.target?.name === 'Moon' && !a.rig.autopilot;
  }, null, { timeout: 600000 });
  await mapReady('moon');
  const moon = await page.evaluate(() => {
    const a = window.app, m = a.findByName('Moon');
    return { anchor: a.rig.anchor?.name, distance: m.upos.sub(a.rig.upos).length() / m.radius, expected: 3.5 * a.rig.framing };
  });
  check('a flight to the Moon arrives at the rig\'s intended upright-phone framing while offline', moon.anchor === 'Moon' && Math.abs(moon.distance / moon.expected - 1) < 0.001, JSON.stringify(moon));
  check('no request fails in the offline Earth–Moon journey', failedRequests.length === 0, JSON.stringify(failedRequests.slice(0, 12)));
  await shot('offline-3-moon.png');

  await openMore();
  await page.tap('[data-offline-remove]');
  await page.waitForFunction(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    const names = await caches.keys();
    return !regs.some((r) => r.scope === new URL('./', location.href).href) && !names.some((k) => k.startsWith('starfarer-offline-'));
  }, null, { timeout: 60000 });
  const removed = await page.evaluate(async () => ({ registrations: (await navigator.serviceWorker.getRegistrations()).length, caches: await caches.keys() }));
  check('Remove the offline copy leaves no service worker and no offline cache', removed.registrations === 0 && !removed.caches.some((k) => k.startsWith('starfarer-offline-')), JSON.stringify(removed));
  await context.setOffline(false);
  const afterUse = await page.evaluate(async () => {
    await fetch('data/solar/albedos.json', { cache: 'reload' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { registrations: (await navigator.serviceWorker.getRegistrations()).length, caches: (await caches.keys()).filter((name) => name.startsWith('starfarer-offline-')) };
  });
  check('a later network fetch does not recreate a worker or cache after removal', afterUse.registrations === 0 && afterUse.caches.length === 0, JSON.stringify(afterUse));
  check('no console errors', errors.length === 0, JSON.stringify(errors.slice(0, 10)));
} catch (error) {
  check('the offline browser check runs without a driver exception', false, String(error).split('\n')[0]);
  await shot('offline-failure.png').catch(() => undefined);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
