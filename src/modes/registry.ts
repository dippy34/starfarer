/**
 * Mode registry + state machine: idle → entering → active → exiting → idle.
 */
import { appState } from '../state/appState';
import type { ModeContext, ModeDescriptor, ModeInstance } from './types';

export type ModeMachineState = 'idle' | 'entering' | 'active' | 'exiting';

export class ModeRegistry {
  private readonly descriptors = new Map<string, ModeDescriptor>();
  private active: { id: string; instance: ModeInstance } | null = null;
  private machine: ModeMachineState = 'idle';

  register(descriptor: ModeDescriptor): void {
    if (this.descriptors.has(descriptor.id)) throw new Error(`Mode "${descriptor.id}" is already registered`);
    if (descriptor.available && !descriptor.create) throw new Error(`Available mode "${descriptor.id}" needs a create() factory`);
    this.descriptors.set(descriptor.id, descriptor);
  }

  /** All registered modes in display order. */
  list(): ModeDescriptor[] {
    return [...this.descriptors.values()].sort((a, b) => a.order - b.order);
  }

  get(id: string): ModeDescriptor | undefined {
    return this.descriptors.get(id);
  }

  get state(): ModeMachineState {
    return this.machine;
  }

  get activeId(): string | null {
    return this.active?.id ?? null;
  }

  /** Enter a mode (leaving the current one first). Resolves false if the mode cannot be entered. */
  async enter(id: string, ctx: ModeContext): Promise<boolean> {
    const descriptor = this.descriptors.get(id);
    if (!descriptor || !descriptor.available || !descriptor.create) return false;
    if (this.machine === 'entering' || this.machine === 'exiting') return false;
    if (this.active?.id === id) return true;
    this.exit();
    this.machine = 'entering';
    try {
      const instance = descriptor.create(ctx);
      await instance.enter();
      this.active = { id, instance };
      this.machine = 'active';
      appState.set({ mode: id });
      return true;
    } catch (err) {
      console.error(`Failed to enter mode "${id}"`, err);
      this.machine = 'idle';
      return false;
    }
  }

  /** Leave the active mode, if any. */
  exit(): void {
    if (!this.active) return;
    this.machine = 'exiting';
    try {
      this.active.instance.exit();
    } finally {
      this.active = null;
      this.machine = 'idle';
    }
  }

  /** Per-frame update of the active mode. */
  update(dt: number): void {
    if (this.machine === 'active') this.active?.instance.update(dt);
  }
}

/** The app-wide registry. Mode folders register themselves by importing this. */
export const modes = new ModeRegistry();
