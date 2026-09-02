import { clamp, clamp01, lerp } from '../core/vec.ts';

/**
 * Everything is synthesised at runtime. No sample library means no licensing
 * questions and no download, but the real reason is that a synthesised splash
 * can be a continuous function of the impact rather than one of five recordings:
 * a rip is a tight bright crack, a belly flop is a broad low slap, and every
 * entry in between sounds like exactly where it sits on that scale.
 */

function noiseBuffer(ctx: AudioContext, seconds: number, brown = false): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else d[i] = w;
  }
  return buf;
}

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private ambGain!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private started = false;
  muted = false;

  /** Must be called from a user gesture. */
  start() {
    if (this.started) return;
    this.started = true;
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;
    const ctx: AudioContext = new Ctor();
    this.ctx = ctx;
    this.noise = noiseBuffer(ctx, 2.5);
    this.brown = noiseBuffer(ctx, 3.0, true);

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);

    // --- Ambience: distant surf and a low sea-air bed, always running.
    this.ambGain = ctx.createGain();
    this.ambGain.gain.value = 0.0;
    const ambFilter = ctx.createBiquadFilter();
    ambFilter.type = 'lowpass';
    ambFilter.frequency.value = 620;
    ambFilter.Q.value = 0.4;
    const surf = ctx.createBufferSource();
    surf.buffer = this.brown; surf.loop = true;
    surf.connect(ambFilter); ambFilter.connect(this.ambGain); this.ambGain.connect(this.master);
    surf.start();
    // Slow swell in the surf level.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.085;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.055;
    lfo.connect(lfoGain); lfoGain.connect(this.ambGain.gain); lfo.start();
    this.ambGain.gain.value = 0.10;

    // --- Wind: gain and brightness both track fall speed.
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.55;
    const wsrc = ctx.createBufferSource();
    wsrc.buffer = this.noise; wsrc.loop = true;
    wsrc.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.master);
    wsrc.start();
  }

  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.85;
  }

  /** Continuous wind, driven by airspeed and how deep underwater we are. */
  setAirspeed(speed: number, submerged: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = clamp01((speed - 3) / 26);
    const g = s * s * 0.30 * (1 - submerged);
    this.windGain.gain.setTargetAtTime(g, t, 0.06);
    this.windFilter.frequency.setTargetAtTime(lerp(260, 1500, s), t, 0.08);
    this.ambGain.gain.setTargetAtTime(submerged > 0.5 ? 0.03 : 0.10, t, 0.15);
  }

  private burst(dur: number, filterType: BiquadFilterType, f0: number, f1: number, q: number, gain: number, brown = false, delay = 0) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = brown ? this.brown : this.noise;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo = 0, delay = 0) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.03);
  }

  charge() { this.burst(0.16, 'lowpass', 400, 1200, 1.0, 0.06); }

  jump(power: number) {
    // Board flex, then the scuff of feet leaving it.
    this.tone(lerp(90, 130, power), 0.16, 0.16, 'sine', 62);
    this.burst(0.13, 'bandpass', 900, 2600, 0.9, 0.10 + power * 0.06);
  }

  /**
   * @param quality 0..1 entry quality
   * @param speed   entry speed
   */
  splash(quality: number, speed: number) {
    const p = clamp01(speed / 26);
    const rip = clamp01(quality);
    // The rip: short, tight, bright -- the sound of a body making a small hole.
    if (rip > 0.55) {
      this.burst(lerp(0.16, 0.09, rip), 'bandpass', lerp(1800, 4200, rip), lerp(700, 1600, rip), lerp(1.2, 3.4, rip), 0.30 * (0.5 + p));
      this.tone(lerp(140, 220, rip), 0.22, 0.16 * p, 'sine', 60);
    }
    // The body of the splash: broader and lower the flatter you land.
    const flat = 1 - rip;
    this.burst(lerp(0.30, 0.75, flat), 'lowpass', lerp(2400, 1500, flat), lerp(300, 160, flat), 0.7, lerp(0.16, 0.42, flat) * (0.45 + p));
    if (flat > 0.5) {
      // The slap. This is the sound you learn to dread.
      this.tone(lerp(120, 74, flat), 0.30, 0.30 * p * flat, 'sine', 44);
      this.burst(0.20, 'bandpass', 700, 220, 1.4, 0.28 * flat * p);
    }
    // Water closing over the hole.
    this.burst(0.55, 'lowpass', 900, 220, 0.6, 0.10 * p, true, lerp(0.12, 0.26, flat));
  }

  crash(force: number, hard: number) {
    const f = clamp01(force / 22);
    this.burst(0.10, 'bandpass', lerp(1400, 3200, hard), 500, 2.2, 0.34 * f);
    this.tone(lerp(96, 58, f), 0.24, 0.34 * f, 'sine', 38);
    this.burst(0.30, 'lowpass', 1100, 180, 0.8, 0.22 * f, true, 0.02);
    if (f > 0.5) this.burst(0.16, 'highpass', 2600, 1400, 0.9, 0.13 * f, false, 0.03);
  }

  /** A quiet two-note lift, only for a genuinely clean entry. */
  chime(perfect: boolean) {
    if (!perfect) { this.tone(523.25, 0.30, 0.045, 'triangle'); return; }
    this.tone(659.25, 0.42, 0.055, 'triangle');
    this.tone(987.77, 0.55, 0.042, 'triangle', 0, 0.09);
  }

  /** Rising tension in the last moment before the water. */
  approach(t: number) {
    if (!this.ctx) return;
    this.windFilter.Q.setTargetAtTime(lerp(0.55, 1.4, clamp01(1 - t)), this.ctx.currentTime, 0.1);
  }

  ui() { this.tone(760, 0.06, 0.035, 'triangle'); }
}
