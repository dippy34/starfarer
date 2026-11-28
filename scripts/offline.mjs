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
// Every request the offline download makes carries this mark; the full file list is one of them.
const NETWORK = '__starfarer_offline_network';
const manifestRequests = [];
const fileResponses = [];   // paths the download fetched successfully
const fileRequests = [];    // paths the download asked for, one entry per attempt
page.on('request', (request) => {
  const url = new URL(request.url());
  if (!url.searchParams.has(NETWORK)) return;
  if (url.pathname.endsWith('/offline-manifest.json')) manifestRequests.push(url.pathname);
  else if (!url.pathname.endsWith('/offline-size.json')) fileRequests.push(url.pathname);
});
page.on('response', (response) => {
  const url = new URL(response.url());
  if (url.searchParams.has(NETWORK) && response.ok() && !/\/offline-(manifest|size)\.json$/.test(url.pathname)) fileResponses.push(url.pathname);
});
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
};
const shot = (name) => page.screenshot({ path: path.join(outDir, name), timeout: 180000 });
/**
 * The app is up: its loading screen gone and the shaders it compiles at the start ready. (The loading screen gives
 * up waiting for them after a while; on a slow runner the last of them then compile after it, and a tap's touch
 * events wait for the page's thread meanwhile: a tap that timed out at 30 s had opened More by the time of the
 * failure's picture.)
 */
const ready = async (on = page) => {
  await on.waitForFunction(() => window.app && window.app.frameCount > 12 && !document.getElementById('boot'), null, { timeout: 600000 });
  await on.evaluate(() => Promise.race([window.app.warmed, new Promise((done) => setTimeout(done, 300000))]));
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

  check('opening More before asking for a copy does not fetch the 1.5 MB file list', manifestRequests.length === 0, JSON.stringify(manifestRequests));
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
    return { anchor: a.rig.anchor?.name, distance: m.upos.sub(a.rig.upos).length() / m.radius, expected: 2.2 * a.rig.framing };
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

  // ---- Stopped downloads, old copies, two tabs and the kill switch (second try) ----
  const offlineNames = () => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('starfarer-offline-')));
  const stagingCount = () => page.evaluate(async () => {
    const name = (await caches.keys()).find((k) => k.startsWith('starfarer-offline-v-'));
    return name ? { name, entries: (await (await caches.open(name)).keys()).length, complete: !!(await (await caches.open(name)).match(new URL('offline-copy.json', location.href).href)) } : null;
  });
  // Polls from here: an async predicate given to waitForFunction does not wait.
  const until = async (fn, arg, what, timeout = 60000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await page.evaluate(fn, arg)) return true;
      await page.waitForTimeout(200);
    }
    check(`(waiting) ${what}`, false, 'timed out');
    return false;
  };
  const status = () => page.locator('[data-offline-status]').innerText();
  await page.reload({ waitUntil: 'load', timeout: 180000 });
  await ready();
  await openMore();
  await page.waitForFunction(() => /about [\d,]+ MB/.test(document.querySelector('[data-offline-download]')?.textContent ?? ''), null, { timeout: 60000 });
  const failing = '/data/solar/albedos.json';
  // The page's own fetch fails for one file, as a dropped connection does (a reload undoes this).
  await page.evaluate(({ failing, NETWORK }) => {
    const original = window.fetch.bind(window);
    window.__aborts = 0;
    window.fetch = (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes(failing) && url.includes(NETWORK)) { window.__aborts++; return Promise.reject(new TypeError('Failed to fetch')); }
      return original(input, init);
    };
  }, { failing, NETWORK });
  fileRequests.length = 0; fileResponses.length = 0; manifestRequests.length = 0;
  await page.locator('[data-offline-download]').tap();
  await page.waitForFunction(() => /download stopped/i.test(document.querySelector('[data-offline-status]')?.textContent ?? ''), null, { timeout: 600000, polling: 100 });
  const words1 = await status();
  check('a network failure says the download stopped and to download again, in plain words',
    /^The download stopped \(no connection\?\)\. Download again to carry on/.test(words1) && !/TypeError|Failed to fetch|Error/.test(words1), words1);
  const aborts = await page.evaluate(() => window.__aborts);
  check('a failing file is tried 3 times before the download gives up', aborts === 3, `attempts=${aborts}`);
  const sizeA = await stagingCount();
  await page.waitForTimeout(2500);
  const sizeB = await stagingCount();
  check('after a failure no loop still writes, and the staging cache is kept, not deleted',
    !!sizeA && sizeA.entries > 2 && !sizeA.complete && sizeA.entries === sizeB?.entries, JSON.stringify({ sizeA, sizeB }));
  await page.screenshot({ path: path.join(outDir, 'offline-4-stopped.png'), timeout: 180000 });
  const fetchedBefore = new Set(fileResponses);
  await page.reload({ waitUntil: 'load', timeout: 180000 });
  await ready();
  await openMore();
  await page.waitForFunction(() => /A download stopped at/.test(document.querySelector('[data-offline-status]')?.textContent ?? ''), null, { timeout: 60000 });
  const offered = await page.locator('.offline-panel').innerText();
  check('a reloaded page offers the stopped download: "A download stopped at N MB of M MB", Download carries on, with Remove',
    /A download stopped at [\d,]+ MB of [\d,]+ MB\. Download carries on/.test(offered) && /Download again to carry on/.test(offered) && await page.locator('[data-offline-remove]').isVisible(), offered.replace(/\s+/g, ' '));
  await page.screenshot({ path: path.join(outDir, 'offline-5-offered.png'), timeout: 180000 });
  check('the stopped download is still the one staging cache after the reload', (await offlineNames()).filter((n) => n.includes('-v-')).length === 1, JSON.stringify(await offlineNames()));
  fileRequests.length = 0; fileResponses.length = 0;
  await page.locator('[data-offline-download]').tap();
  await page.waitForFunction(() => document.querySelector('[data-offline-status]')?.textContent === 'Starfarer works offline', null, { timeout: 900000, polling: 100 });
  const again = fileRequests.slice();
  const repeated = again.filter((p) => fetchedBefore.has(p));
  const resumed = await stagingCount();
  // The staging cache holds every file once, plus the full list and the copy list.
  check('Download again carries on: it fetches only the files the staging cache lacked', again.length > 0 && repeated.length === 0 && resumed && again.length + fetchedBefore.size === resumed.entries - 2, `fetched ${again.length} now, ${fetchedBefore.size} before, repeated ${repeated.length}, cache ${resumed?.entries}`);
  check('the carried-on download is complete and active', !!resumed?.complete, JSON.stringify(resumed));

  // An update's old copy and a stopped download of an older version go: the old copy when a page loads,
  // the older stopped download when More loads, and the old copy again when the worker starts.
  const seed = (name, complete) => page.evaluate(async ({ name, complete }) => {
    const cache = await caches.open(name);
    await cache.put(new URL(complete ? 'offline-copy.json' : 'junk.txt', location.href).href, new Response('{}'));
  }, { name, complete });
  await seed('starfarer-offline-v-0old-complete', true);
  await seed('starfarer-offline-v-0old-stopped', false);
  await page.reload({ waitUntil: 'load', timeout: 180000 });
  await ready();
  await openMore();
  await until(async () => !(await caches.keys()).some((k) => k.startsWith('starfarer-offline-v-0old')), null, 'the old copies are pruned');
  const left = await offlineNames();
  check('a page load prunes the old finished copy, and More clears an older stopped download', !left.some((k) => k.includes('0old')), JSON.stringify(left));
  check('pruning keeps the active copy', !!(await stagingCount())?.complete);
  await seed('starfarer-offline-v-0old-restart', true);
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await page.evaluate(() => fetch('data/solar/albedos.json').then((r) => r.arrayBuffer()));
  await until(async () => !(await caches.keys()).includes('starfarer-offline-v-0old-restart'), null, 'the worker prunes on start');
  check('a worker that starts prunes the old finished copy', !(await offlineNames()).includes('starfarer-offline-v-0old-restart'), JSON.stringify(await offlineNames()));

  // The kill switch: sw-off.js in place of sw.js deletes every offline cache and unregisters itself.
  await page.evaluate(() => navigator.serviceWorker.register(new URL('sw-off.js', location.href).href, { scope: new URL('./', location.href).href }));
  await until(async () => (await navigator.serviceWorker.getRegistrations()).length === 0 && !(await caches.keys()).some((k) => k.startsWith('starfarer-offline-')), null, 'the kill switch finishes');
  const killed = { regs: await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), caches: await offlineNames() };
  check('the kill switch sw-off.js leaves no worker and no offline cache', killed.regs === 0 && killed.caches.length === 0, JSON.stringify(killed));

  // Two tabs: while another tab holds the download lock, Download starts nothing.
  // (the other tab is a page of the same site holding the download's lock, as a tab downloading holds it: a second copy of
  // the app there drew on the same runner's processor as this one, and this page's taps waited over 30 s for its thread)
  const other = await context.newPage();
  await other.goto(new URL('sw-off.js', base).href, { waitUntil: 'load' });
  await other.evaluate(() => { navigator.locks.request('starfarer-offline-download', () => new Promise(() => undefined)); });
  await page.reload({ waitUntil: 'load', timeout: 180000 });
  await ready();
  await openMore();
  await page.waitForFunction(() => /about [\d,]+ MB/.test(document.querySelector('[data-offline-download]')?.textContent ?? ''), null, { timeout: 60000 });
  await page.locator('[data-offline-download]').tap();
  await page.waitForFunction(() => /Another tab/.test(document.querySelector('[data-offline-status]')?.textContent ?? ''), null, { timeout: 60000 });
  const busy = { words: await status(), regs: await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), caches: await offlineNames() };
  check('while another tab downloads, Download says so and starts nothing', /Another tab is downloading/.test(busy.words) && busy.regs === 0 && busy.caches.length === 0, JSON.stringify(busy));
  await other.close();
  check('no console errors in the second part', errors.length === 0, JSON.stringify(errors.slice(0, 10)));
} catch (error) {
  check('the offline browser check runs without a driver exception', false, String(error).split('\n')[0]);
  await shot('offline-failure.png').catch(() => undefined);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
