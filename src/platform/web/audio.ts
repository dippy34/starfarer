/**
 * WebAudio sound manager — everything is synthesised, so there are no audio
 * files to download. Provides the hooks the game needs:
 *   - short UI effects,
 *   - an ambient pad that cross-fades with the player's surroundings,
 *   - a warp whoosh tied to travel speed,
 *   - the black-hole rumble: a low drone that rises in pitch and volume.
 * A native build can replace this class with real music behind the same interface.
 */
import type { AmbientScene, AudioEngine, SoundEffect } from '../types';

interface Voice {
  osc: OscillatorNode[];
  gain: GainNode;
}

/** Chord (Hz) + brightness for each ambient scene. */
const SCENES: Record<Exclude<AmbientScene, 'none'>, { notes: number[]; cutoff: number; level: number }> = {
  cosmic: { notes: [55, 82.4, 123.5, 164.8], cutoff: 500, level: 0.16 },
  space: { notes: [65.4, 98, 146.8, 196], cutoff: 650, level: 0.15 },
  galaxy: { notes: [73.4, 110, 146.8, 220], cutoff: 800, level: 0.15 },
  system: { notes: [87.3, 130.8, 174.6, 261.6], cutoff: 950, level: 0.14 },
  planet: { notes: [98, 146.8, 196, 293.7], cutoff: 1100, level: 0.13 },
  surface: { notes: [110, 164.8, 220, 277.2], cutoff: 1300, level: 0.11 },
};

export class WebAudioEngine implements AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private suspended = false;
  private ambient: { scene: AmbientScene; voice: Voice | null; filter: BiquadFilterNode | null } = { scene: 'none', voice: null, filter: null };
  private pendingScene: AmbientScene = 'none';
  private warp: { noise: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private rumble: { a: OscillatorNode; b: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.suspended && this.enabled) void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    // A gentle compressor keeps layered pads + effects from clipping on phone speakers.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(this.ctx.destination);
    if (this.pendingScene !== 'none') this.setAmbient(this.pendingScene);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(enabled ? 0.9 : 0, this.ctx.currentTime, 0.08);
    if (enabled && !this.suspended) void this.ctx.resume();
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (!this.ctx) return;
    if (suspended) void this.ctx.suspend();
    else if (this.enabled) void this.ctx.resume();
  }

  private envelope(freq: number, type: OscillatorType, dur: number, level: number, slideTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.enabled) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(level, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  playEffect(effect: SoundEffect): void {
    switch (effect) {
      case 'tap':
        this.envelope(660, 'sine', 0.07, 0.08);
        break;
      case 'toggle':
        this.envelope(520, 'triangle', 0.08, 0.08, 780);
        break;
      case 'select':
        this.envelope(523.3, 'sine', 0.16, 0.1);
        this.envelope(784, 'sine', 0.22, 0.08, undefined, 0.07);
        break;
      case 'open':
        this.envelope(392, 'sine', 0.18, 0.07, 587.3);
        break;
      case 'close':
        this.envelope(587.3, 'sine', 0.16, 0.06, 392);
        break;
      case 'flyStart':
        this.envelope(110, 'sawtooth', 0.9, 0.05, 440);
        this.envelope(220, 'sine', 0.9, 0.07, 660);
        break;
      case 'flyArrive':
        this.envelope(659.3, 'sine', 0.35, 0.09);
        this.envelope(987.8, 'sine', 0.5, 0.07, undefined, 0.1);
        this.envelope(1318.5, 'sine', 0.7, 0.05, undefined, 0.2);
        break;
      case 'shutter':
        this.envelope(1800, 'square', 0.04, 0.05, 600);
        this.envelope(900, 'square', 0.05, 0.04, 300, 0.07);
        break;
      case 'error':
        this.envelope(196, 'triangle', 0.25, 0.09, 147);
        break;
    }
  }

  setAmbient(scene: AmbientScene): void {
    this.pendingScene = scene;
    const ctx = this.ctx;
    if (!ctx || !this.master || this.ambient.scene === scene) return;
    const now = ctx.currentTime;
    // Fade the old pad out…
    const old = this.ambient.voice;
    if (old) {
      old.gain.gain.setTargetAtTime(0, now, 1.2);
      old.osc.forEach((o) => o.stop(now + 6));
    }
    this.ambient = { scene, voice: null, filter: null };
    if (scene === 'none') return;
    // …and bring the new one in: detuned sine/triangle pairs through a slow low-pass.
    const def = SCENES[scene];
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = def.cutoff;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(def.level, now, 2.5);
    const oscs: OscillatorNode[] = [];
    def.notes.forEach((f, i) => {
      for (const detune of [-5, 6]) {
        const o = ctx.createOscillator();
        o.type = i % 2 === 0 ? 'sine' : 'triangle';
        o.frequency.value = f;
        o.detune.value = detune + i * 1.5;
        const g = ctx.createGain();
        g.gain.value = 0.25 / (1 + i * 0.35);
        o.connect(g).connect(filter);
        o.start(now);
        oscs.push(o);
      }
    });
    // Slow breathing of the filter keeps the pad alive.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = def.cutoff * 0.35;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start(now);
    oscs.push(lfo);
    filter.connect(gain).connect(this.master);
    this.ambient = { scene, voice: { osc: oscs, gain }, filter };
  }

  setWarp(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const x = Math.max(0, Math.min(1, intensity));
    if (!this.warp) {
      if (x < 0.02) return;
      // Looping white noise through a band-pass = wind/whoosh.
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[i] = seed / 2147483648 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      noise.connect(filter).connect(gain).connect(this.master);
      noise.start();
      this.warp = { noise, filter, gain };
    }
    const now = ctx.currentTime;
    this.warp.gain.gain.setTargetAtTime(0.11 * x * x, now, 0.15);
    this.warp.filter.frequency.setTargetAtTime(180 + 1500 * x, now, 0.2);
  }

  setRumble(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const x = Math.max(0, Math.min(1, intensity));
    if (!this.rumble) {
      if (x < 0.01) return;
      const a = ctx.createOscillator();
      const b = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      a.type = 'sawtooth';
      b.type = 'sine';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 220;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const trem = ctx.createGain();
      trem.gain.value = 0.3;
      lfo.frequency.value = 3;
      lfo.connect(trem).connect(gain.gain);
      a.connect(filter);
      b.connect(filter);
      filter.connect(gain).connect(this.master);
      a.start();
      b.start();
      lfo.start();
      this.rumble = { a, b, lfo, gain };
    }
    const now = ctx.currentTime;
    // 28 Hz → 70 Hz as you fall inward; the second oscillator beats against the first.
    const f = 28 + 42 * x * x;
    this.rumble.a.frequency.setTargetAtTime(f, now, 0.2);
    this.rumble.b.frequency.setTargetAtTime(f * 1.5 + 1.3, now, 0.2);
    this.rumble.lfo.frequency.setTargetAtTime(2 + 9 * x, now, 0.3);
    this.rumble.gain.gain.setTargetAtTime(0.5 * x, now, 0.25);
  }
}
