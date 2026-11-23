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
export function collectErrors(page, errors) {
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
}
