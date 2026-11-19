/**
 * Starfarer entry point: boots the platform, the engine, the mode registry and the UI shell.
 *
 * Boot order: UI shell (start screen appears immediately) → WebGL engine →
 * Explore mode loads its first-launch data and renders the universe behind the
 * start screen → the player presses Start.
 */
import './ui/styles.css';
import './modes/explore';
import './modes/play';
import { modes } from './modes/registry';
import { platform } from './platform';
import { Engine } from './render/engine';
import { appState } from './state/appState';
import { mountUI } from './ui/shell';

async function boot(): Promise<void> {
  const root = document.getElementById('app')!;
  const labelLayer = mountUI(root);
  let engine: Engine;
  try {
    engine = new Engine(root);
  } catch (err) {
    appState.set({ fatalError: err instanceof Error ? err.message : String(err) });
    return;
  }
  // The canvas must sit beneath the UI.
  root.prepend(engine.canvas);
  engine.onFrame = (dt) => modes.update(dt);
  platform.lifecycle.registerOfflineSupport();
  engine.start();
  // Handy for automated checks and for poking around in the console.
  (window as unknown as { __starfarer: unknown }).__starfarer = { engine, modes, appState };

  const entered = await modes.enter('explore', { engine, uiRoot: labelLayer });
  if (!entered) {
    appState.set({ fatalError: platform.lifecycle.isOnline() ? 'The star catalogues could not be loaded. Please reload to try again.' : 'You appear to be offline and the star catalogues are not cached yet. Connect once to download them.' });
  }
}

void boot();
