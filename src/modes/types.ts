/**
 * Mode system. A "mode" is a top-level way of playing on the shared universe
 * (Explore today; Play — story, creatures, friends — later). Modes register a
 * descriptor; the registry is a small state machine that enters and exits them.
 * Adding a mode means adding one folder that calls `modes.register(...)`.
 */
import type { Engine } from '../render/engine';

/** Services every mode gets when it is created. */
export interface ModeContext {
  engine: Engine;
  /** Root element for mode-specific UI. */
  uiRoot: HTMLElement;
}

/** A running mode. */
export interface ModeInstance {
  /** Called when the mode becomes active. */
  enter(): void | Promise<void>;
  /** Called every frame while active (dt in seconds, already clamped). */
  update(dt: number): void;
  /** Called when the player leaves the mode; must release everything it created. */
  exit(): void;
}

export interface ModeDescriptor {
  id: string;
  /** Shown on the start screen's mode switcher. */
  title: string;
  tagline: string;
  /** Emoji/glyph for the mode card. */
  icon: string;
  /** False = shown as "Coming soon" and cannot be entered. */
  available: boolean;
  /** Sort order on the start screen. */
  order: number;
  /** Factory, present only for available modes. */
  create?: (ctx: ModeContext) => ModeInstance;
}
