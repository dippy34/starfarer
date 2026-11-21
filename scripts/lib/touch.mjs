// Real multi-touch for the browser suites: fingers on the page through the DevTools protocol
// (Playwright's own touchscreen only taps). Positions are CSS pixels.

/** A phone in the hand: an upright (or `landscape`) touch screen with no mouse. */
export function phoneContext(browser, { landscape = false, scale = 1 } = {}) {
  const [w, h] = landscape ? [844, 390] : [390, 844];
  return browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: scale });
}

export async function fingers(page) {
  const cdp = await page.context().newCDPSession(page);
  // event times are given explicitly (16 ms apart), so speeds and tap timings do not depend on how
  // fast this machine renders
  let clock = Date.now() / 1000;
  const send = (type, points) => {
    clock += 0.016;
    return cdp.send('Input.dispatchTouchEvent', {
      type, timestamp: clock,
      touchPoints: points.map((p, i) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, id: p.id ?? i, radiusX: 9, radiusY: 9, force: 0.5 })),
    });
  };
  /** let the app take what the fingers did: wait for `n` rendered frames */
  const frames = async (n = 1) => {
    const f = await page.evaluate(() => window.app.frameCount);
    await page.waitForFunction((x) => window.app.frameCount >= x, f + n, { timeout: 600000 });
  };
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  return {
    frames,
    /** time passes with no finger down (seconds on the event clock) */
    wait(seconds) { clock += seconds; },
    async tap(p) {
      await send('touchStart', [p]);
      clock += 0.05;
      await send('touchEnd', []);
      await frames(1);
    },
    async doubleTap(p) {
      await send('touchStart', [p]);
      clock += 0.04;
      await send('touchEnd', []);
      clock += 0.12;
      await send('touchStart', [p]);
      clock += 0.04;
      await send('touchEnd', []);
      await frames(1);
    },
    /** one finger put down, slid and lifted a call at a time: for looking at what happens while it is still down */
    async press(p) { await send('touchStart', [p]); await frames(1); },
    async slide(p) { await send('touchMove', [p]); await frames(1); },
    async lift() { clock += 0.3; await send('touchEnd', []); await frames(1); },
    /** one finger from `a` to `b`; `rest` seconds still before lifting (0: a flick) */
    async drag(a, b, { steps = 12, rest = 0.3 } = {}) {
      await send('touchStart', [a]);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', [lerp(a, b, i / steps)]);
        await frames(1);
      }
      clock += rest;
      await send('touchEnd', []);
      await frames(1);
    },
    /** two fingers about `c`, from `d0` to `d1` pixels apart, along `angle` (rad); `turn`: twist by this much on the way */
    async pinch(c, d0, d1, { steps = 12, angle = 0, turn = 0 } = {}) {
      const pair = (t) => {
        const d = d0 + (d1 - d0) * t, a = angle + turn * t;
        return [{ x: c.x - (d / 2) * Math.cos(a), y: c.y - (d / 2) * Math.sin(a), id: 0 }, { x: c.x + (d / 2) * Math.cos(a), y: c.y + (d / 2) * Math.sin(a), id: 1 }];
      };
      await send('touchStart', pair(0));
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', pair(i / steps));
        await frames(1);
      }
      clock += 0.3;
      await send('touchEnd', []);
      await frames(1);
    },
    /** two fingers `apart` pixels from each other, travelling together from about `a` to about `b` */
    async dragTwo(a, b, { steps = 12, apart = 90 } = {}) {
      const pair = (t) => {
        const c = lerp(a, b, t);
        return [{ x: c.x - apart / 2, y: c.y, id: 0 }, { x: c.x + apart / 2, y: c.y, id: 1 }];
      };
      await send('touchStart', pair(0));
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', pair(i / steps));
        await frames(1);
      }
      clock += 0.3;
      await send('touchEnd', []);
      await frames(1);
    },
  };
}
