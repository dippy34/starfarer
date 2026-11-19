/**
 * Adaptive quality: measures frame time and steers render resolution and the
 * quality tier to hold ~60 fps.
 *
 *   too slow  → lower the render scale; at the tier's minimum, drop a tier
 *   headroom  → raise the render scale; at the maximum (and in "auto"), go up a tier
 *
 * Changes are rate-limited and hitches (tile uploads, shader compiles, tab
 * switches) are ignored so quality does not oscillate.
 *
 * It also polices the tier's draw-call budget: when a frame issues more draw
 * calls than budgeted, `detailScale` drops and the systems that own many small
 * draws (terrain patches above all) thin themselves out until the frame fits.
 */
import { platform } from '../platform';
import type { QualitySetting } from '../state/appState';
import { type QualityTier, TIERS, TIER_ORDER, type TierName } from './qualityTiers';

const TARGET_MS = 1000 / 60;

export class QualityController {
  tier: QualityTier;
  renderScale: number;
  private setting: QualitySetting = 'auto';
  private avgMs = TARGET_MS;
  private slowFor = 0;
  private fastFor = 0;
  private cooldown = 2;
  /** 0.5…1: multiplier on draw-call-heavy detail (terrain patch count), lowered while over the draw-call budget. */
  detailScale = 1;
  private drawTimer = 0;
  private readonly listeners = new Set<(tier: QualityTier) => void>();

  constructor() {
    // First guess from the device class; the controller corrects it within seconds.
    const d = platform.device;
    const guess: TierName = d.mobile ? ((d.memoryGb ?? 4) <= 3 || d.cores <= 4 ? 'low' : 'medium') : 'high';
    this.tier = TIERS[guess];
    this.renderScale = this.tier.maxRenderScale;
  }

  /** Smoothed frame time in milliseconds. */
  get frameMs(): number {
    return this.avgMs;
  }

  onTierChange(listener: (tier: QualityTier) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Apply the user's setting: 'auto' or a pinned tier. */
  setSetting(setting: QualitySetting): void {
    this.setting = setting;
    if (setting !== 'auto' && this.tier.name !== setting) this.changeTier(setting);
  }

  private changeTier(name: TierName): void {
    this.tier = TIERS[name];
    this.renderScale = Math.min(this.tier.maxRenderScale, Math.max(this.tier.minRenderScale, this.renderScale));
    // Shader recompiles and buffer reallocations follow a tier change: do not judge performance for a moment.
    this.cooldown = 2.5;
    this.slowFor = this.fastFor = 0;
    for (const l of [...this.listeners]) l(this.tier);
  }

  /** Feed one frame's draw-call count; adjusts `detailScale` a few times per second. */
  noteDrawCalls(calls: number, dt: number): void {
    this.drawTimer -= dt;
    if (this.drawTimer > 0) return;
    this.drawTimer = 0.25;
    const budget = this.tier.drawCallBudget;
    if (calls > budget) this.detailScale = Math.max(0.5, this.detailScale - 0.04);
    else if (calls < budget * 0.85) this.detailScale = Math.min(1, this.detailScale + 0.01);
  }

  /** Feed one frame's duration (seconds). Returns true if the render scale changed. */
  frame(dt: number): boolean {
    const ms = dt * 1000;
    // Ignore hitches and background-tab frames.
    if (ms > 120 || ms <= 0) return false;
    this.avgMs += (ms - this.avgMs) * 0.08;
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return false;
    }
    const before = this.renderScale;
    if (this.avgMs > TARGET_MS * 1.17) {
      this.slowFor += dt;
      this.fastFor = 0;
      if (this.slowFor > 1.2) {
        this.slowFor = 0;
        // Step harder when far below target.
        const step = this.avgMs > TARGET_MS * 1.8 ? 0.15 : 0.07;
        if (this.renderScale > this.tier.minRenderScale + 1e-3) {
          this.renderScale = Math.max(this.tier.minRenderScale, this.renderScale - step);
          this.cooldown = 0.6;
        } else if (this.setting === 'auto') {
          const i = TIER_ORDER.indexOf(this.tier.name);
          if (i > 0) {
            this.changeTier(TIER_ORDER[i - 1]!);
            this.renderScale = Math.min(this.tier.maxRenderScale, this.tier.minRenderScale + 0.2);
          }
        }
      }
    } else if (this.avgMs < TARGET_MS * 0.86) {
      this.fastFor += dt;
      this.slowFor = 0;
      if (this.fastFor > 4) {
        this.fastFor = 0;
        if (this.renderScale < this.tier.maxRenderScale - 1e-3) {
          this.renderScale = Math.min(this.tier.maxRenderScale, this.renderScale + 0.05);
          this.cooldown = 0.6;
        } else if (this.setting === 'auto' && this.avgMs < TARGET_MS * 0.7) {
          const i = TIER_ORDER.indexOf(this.tier.name);
          if (i < TIER_ORDER.length - 1) {
            this.changeTier(TIER_ORDER[i + 1]!);
            this.renderScale = Math.max(this.tier.minRenderScale, this.tier.maxRenderScale - 0.2);
          }
        }
      }
    } else {
      this.slowFor = Math.max(0, this.slowFor - dt);
      this.fastFor = Math.max(0, this.fastFor - dt);
    }
    return this.renderScale !== before;
  }
}
