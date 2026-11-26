// The one way every verification script starts its browser: headless Chromium with software
// (SwiftShader) WebGL, so the suites run the same on a laptop, in CI and in a container.
//
// Environment:
//   CHROMIUM_PATH  use this Chromium binary instead of the one Playwright downloads for itself
//                  (needed wherever the installed browser is not the build Playwright expects)
//   TRUSTED_SPKI   trust one extra certificate authority by public-key hash
//                  (e.g. behind a TLS-intercepting proxy)
import { chromium } from '@playwright/test';

/**
 * SLOW_FRAME_MS=n: every animation frame of every page takes at least n ms (the app's frame is held that long before it
 * runs), as on a GitHub runner at a frame a second (SLOW_FRAME_MS=1000): to reproduce here what is frame-bound there.
 */
function slowFrames(browser, ms) {
  const script = `(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((t) => { const s = performance.now(); while (performance.now() - s < ${ms}); cb(t); }); })();`;
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (o) => { const c = await newContext(o); await c.addInitScript(script); return c; };
  return browser;
}

export async function launchBrowser() {
  const browser = await launchChromium();
  return process.env.SLOW_FRAME_MS ? slowFrames(browser, Number(process.env.SLOW_FRAME_MS)) : browser;
}

function launchChromium() {
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      ...(process.env.TRUSTED_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.TRUSTED_SPKI}`] : []),
    ],
  });
}

/**
 * Record on `errors` everything that should fail a run: console errors, uncaught exceptions and
 * failed requests. (A failed request is reported from the response, which names the URL; the
 * browser's own console line for it does not.)
 */
/**
 * Once the element's animations have ended (a sheet slides up 18 px as it opens: sheet-in in
 * styles.css), at most `ms` on: a box read two frames after a tap may still be on its way. Nothing
 * to wait for where there is no such element or nothing moves.
 */
export function atRest(page, selector, ms = 2000) {
  return page.evaluate(([s, t]) => Promise.race([
    Promise.all((document.querySelector(s)?.getAnimations() ?? []).map((a) => a.finished.catch(() => undefined))),
    new Promise((done) => setTimeout(done, t)),
  ]), [selector, ms]);
}

/**
 * The selection's card, opened if it is folded to its bar (its name, a line in plain words, Go there):
 * Look at, Share, the powers and the facts are one tap on it away (HANDOFF.md "Design"). A tap where
 * the page has a touch screen, else a click. Nothing to do with no card, or one already open.
 */
export async function openCard(page) {
  const folded = () => page.evaluate(() => { const c = document.querySelector('#hud .card'); return !!c && c.classList.contains('on') && !c.classList.contains('open'); });
  // (a card drawn for a selection the app has not yet given it folds again when the app's word arrives: tapped
  // again then, a few times; each wait is for the app's frames, which on a runner can be seconds each)
  for (let i = 0; i < 8 && (await folded()); i++) {
    const b = page.locator('#hud .card [data-details]');
    await b.tap().catch(() => b.click());
    await page.waitForFunction(() => {
      const a = window.app, w = (window.__cardWait ??= { f: a.frameCount, t: Date.now() });
      // (a few of the app's frames; or, where a check holds the app's loop, the card open and a few seconds)
      const done = a.frameCount > w.f + 2 || (document.querySelector('#hud .card')?.classList.contains('open') && Date.now() > w.t + 3000);
      if (done) delete window.__cardWait;
      return done;
    }, null, { timeout: 600000, polling: 100 });
  }
}

export function collectErrors(page, errors) {
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
}
