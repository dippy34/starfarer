import { App } from './app/App';
import { LoadProgress } from './app/Loading';
import { StartMenu } from './app/StartMenu';
import { installPerfTools } from './perf/tools';
import { countDownloads, Splash } from './ui/Splash';

declare global {
  interface Window { app?: App; appError?: string; startMenu?: StartMenu }
}

/**
 * Start: the loading screen (index.html has it up before this runs) follows the real loading;
 * when the first view is complete behind it, it gives way to the title screen, or straight to
 * the explorer for a link that says where to be (src/app/StartMenu.ts).
 */
async function main(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const labels = document.getElementById('labels')!;
  const splash = new Splash(document.getElementById('boot')!);
  const progress = new LoadProgress();
  progress.onChange = () => splash.show(progress);
  const stopCounting = countDownloads(progress);
  splash.show(progress);
  try {
    if (!document.createElement('canvas').getContext('webgl2')) throw new Error('WebGL 2 is not available in this browser.');
    const app = await App.create(canvas, hud, labels, progress);
    app.start();
    await app.firstView(progress);
    const menu = StartMenu.wanted() ? new StartMenu(app) : null;
    if (menu) window.startMenu = menu;
    installPerfTools(app, () => menu?.start());
    // (from here the explorer is ready to be used: the test scripts wait for this)
    window.app = app;
    stopCounting();
    await splash.done();
    app.afterStart();
  } catch (err) {
    console.error(err);
    window.appError = String(err instanceof Error ? err.stack ?? err.message : err);
    stopCounting();
    splash.fail(progress.error ? progress : err);
  }
}

void main();
