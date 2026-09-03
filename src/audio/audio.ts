import { clamp01, lerp } from '../core/vec.ts';

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
   * Water entry, driven by the same physics as the visual splash rather than
   * by a grade. `displace` (m^3/s) sets how big and long the sound is, `slam`
   * (area * v^2) sets how violent the initial strike is, and `align` decides
   * whether it is a tight bright crack or a broad low slap.
   */
  splash(displace: number, slam: number, align: number, speed: number) {
    const mag = clamp01(displace / 20);
    const hit = clamp01(slam / 420);
    const arrow = clamp01(align);
    const flat = 1 - arrow;

    // The strike itself: narrow and bright when streamlined, broad and low when flat.
    this.burst(
      lerp(0.09, 0.34, flat), 'bandpass',
      lerp(3800, 900, flat), lerp(1500, 240, flat),
      lerp(3.2, 0.9, flat), lerp(0.22, 0.44, flat) * (0.35 + hit),
    );
    // Body of water closing over: length and weight follow the volume moved.
    this.burst(
      0.22 + mag * 0.75, 'lowpass',
      lerp(1600, 2600, mag), lerp(220, 130, mag),
      0.7, (0.10 + 0.34 * mag) * (0.4 + hit * 0.7), true, 0.03,
    );
    // The slap. Only a flat entry has one, and it is the sound you learn to dread.
    if (flat > 0.45) {
      this.tone(lerp(130, 66, flat) * (0.85 + 0.3 * mag), 0.26 + 0.2 * mag, 0.34 * hit * flat, 'sine', 42);
    }
    // Low thump of displacement, present in anything big.
    if (mag > 0.25) this.tone(lerp(120, 58, mag), 0.30, 0.26 * mag * (0.4 + hit), 'sine', 38);

    // The cavity collapsing back up, a fifth of a second later. Tight and
    // whistling after a clean entry, a fat gulp after a cannonball.
    const cavity = clamp01(speed / 22) * (0.18 + 0.82 * arrow);
    if (cavity > 0.08) {
      const delay = 0.13 + 0.011 * speed;
      this.burst(0.20 + 0.2 * mag, 'bandpass', lerp(500, 2200, arrow), lerp(1400, 620, arrow),
        lerp(1.4, 3.0, arrow), 0.18 * cavity, false, delay);
      this.tone(lerp(180, 320, arrow), 0.24, 0.09 * cavity, 'sine', lerp(90, 150, arrow), delay);
    }
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

  /** A single footfall on rock. Quiet -- this plays a lot. */
  footstep() {
    this.burst(0.06, 'bandpass', 900, 500, 1.6, 0.028 + Math.random() * 0.012);
  }

  /** Landing back on solid ground after a hop, scaled by impact speed. */
  land(speed: number) {
    const f = clamp01(speed / 6);
    this.burst(0.09, 'lowpass', 1000, 300, 1.0, 0.05 + f * 0.09);
  }
}
