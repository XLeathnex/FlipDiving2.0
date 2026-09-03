import { clamp01, lerp } from '../core/vec.ts';
import { Spray, KIND } from './spray.ts';

/**
 * Splash.
 *
 * Nothing here is a lookup table of "belly flop splash" versus "clean splash".
 * Everything is computed from three numbers the simulation already produces at
 * the moment of contact:
 *
 *   area      m^2 the body presents to the flow
 *   displace  area * speed  -- cubic metres of water shoved aside per second
 *   align     1 if travelling along your own long axis, 0 if broadside
 *
 * From those the splash builds itself, and it comes out right for cases nobody
 * tuned individually. Three things happen, in the order real water does them:
 *
 *  1. CROWN. The sheet thrown radially outward. Its size follows `displace`
 *     directly, and its angle follows `align` -- a flat body shoves water
 *     sideways in a low wide skirt, a streamlined one pushes a narrow collar
 *     almost straight up.
 *
 *  2. CAVITY. A body moving fast leaves an air-filled hole behind it. How deep
 *     and how narrow depends on how streamlined it was.
 *
 *  3. WORTHINGTON JET. A fifth of a second later that cavity collapses and
 *     fires a column straight back up. This is the part people actually
 *     recognise: the thin spike after a clean entry, the fat column after a
 *     cannonball, and nothing at all after a belly flop, because a belly flop
 *     never makes a cavity to collapse.
 */

export interface EntryPhysics {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  speed: number;
  /** Projected area, m^2. */
  area: number;
  /** Displaced volume rate, m^3/s. */
  displace: number;
  /** area * speed^2. */
  slam: number;
  /** 1 = arrow, 0 = broadside. */
  align: number;
}

interface PendingJet {
  t: number;
  x: number; z: number; y: number;
  height: number; width: number; strength: number;
}

/** Displacement rate treated as "as big as splashes get", m^3/s. */
const BIG = 20;

export class SplashFX {
  private pending: PendingJet[] = [];
  /** Set on entry, read by the water shader to size the surface disturbance. */
  lastMagnitude = 0;

  constructor(private spray: Spray) {}

  entry(e: EntryPhysics) {
    const disp = Math.max(0, e.displace);
    const mag = clamp01(disp / BIG);
    const flat = 1 - clamp01(e.align);
    const speed = Math.max(1, e.speed);
    this.lastMagnitude = mag;

    // Horizontal component of travel, so the splash leans the way you were going.
    const hx = e.vx * 0.16, hz = e.vz * 0.16;

    // --- 1. Crown. Volume rate sets how much; alignment sets the angle.
    const ringR = 0.22 + Math.sqrt(Math.max(e.area, 0.01)) * 1.15;
    const radial = 2.0 + 13.5 * mag;
    const upFrac = lerp(2.10, 0.50, flat);      // arrow throws up, flat throws out
    const drops = Math.round(lerp(30, 330, mag));
    for (let i = 0; i < drops; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = ringR * (0.55 + Math.random() * 0.75);
      const sp = radial * (0.45 + Math.random() * 0.9);
      const up = radial * upFrac * (0.35 + Math.random() * 0.95);
      this.spray.spawn(
        e.x + Math.cos(a) * r + hx, e.y + 0.04, e.z + Math.sin(a) * r + hz,
        Math.cos(a) * sp + e.vx * 0.10, up, Math.sin(a) * sp + e.vz * 0.10,
        0.55 + Math.random() * 0.85,
        lerp(0.045, 0.165, Math.random()) * (0.7 + mag * 0.8),
        KIND.DROP, 0.30,
      );
    }
    // A few broad slabs so the crown reads as a sheet of water and not confetti.
    const sheets = Math.round(lerp(4, 46, mag));
    for (let i = 0; i < sheets; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = radial * (0.35 + Math.random() * 0.55);
      this.spray.spawn(
        e.x + Math.cos(a) * ringR * 0.8 + hx, e.y + 0.06, e.z + Math.sin(a) * ringR * 0.8 + hz,
        Math.cos(a) * sp, radial * upFrac * 0.55 * (0.5 + Math.random() * 0.7), Math.sin(a) * sp,
        0.5 + Math.random() * 0.5,
        lerp(0.38, 1.30, mag) * (0.6 + Math.random() * 0.9),
        KIND.SHEET, 1.3,
      );
    }

    // --- 2. Aerosol torn off by the violence of the strike, not its volume.
    const fine = Math.round(clamp01(e.slam / 380) * 140);
    for (let i = 0; i < fine; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = ringR * (0.3 + Math.random() * 1.5);
      this.spray.spawn(
        e.x + Math.cos(a) * r, e.y + Math.random() * 0.5, e.z + Math.sin(a) * r,
        Math.cos(a) * 2.2 * (0.3 + mag), 0.8 + Math.random() * 2.2 * (0.4 + mag), Math.sin(a) * 2.2 * (0.3 + mag),
        1.0 + Math.random() * 1.5, 0.28 + Math.random() * 0.85, KIND.MIST, 1.4,
      );
    }

    // --- 3. Queue the cavity collapse. A deep narrow cavity fires a tall thin
    //     spike; a wide one fires a fat column; a flat slap makes no cavity and
    //     therefore no jet at all.
    const cavity = clamp01(speed / 22) * (0.18 + 0.82 * clamp01(e.align));
    if (cavity > 0.06) {
      this.pending.push({
        t: 0.13 + 0.011 * speed,
        x: e.x + hx * 0.5, y: e.y, z: e.z + hz * 0.5,
        height: speed * (0.30 + 0.70 * clamp01(e.align)) * 0.62,
        width: 0.09 + Math.sqrt(Math.max(e.area, 0.01)) * 0.42,
        strength: cavity,
      });
    }
  }

  /** Water still being torn open as the body drives through the surface. */
  churn(e: EntryPhysics, scale = 1) {
    const mag = clamp01(e.displace / BIG) * scale;
    const n = Math.round(3 + mag * 22);
    const sp = 1.2 + 7.0 * mag;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.15 + Math.random() * 0.7;
      this.spray.spawn(
        e.x + Math.cos(a) * r, e.y + 0.05, e.z + Math.sin(a) * r,
        Math.cos(a) * sp * (0.4 + Math.random() * 0.7),
        sp * (0.5 + Math.random() * 1.1),
        Math.sin(a) * sp * (0.4 + Math.random() * 0.7),
        0.45 + Math.random() * 0.7, 0.040 + Math.random() * 0.085, KIND.DROP, 0.45,
      );
    }
  }

  update(dt: number) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t > 0) continue;
      this.pending.splice(i, 1);
      this.fireJet(p);
    }
  }

  /** The column that comes back up out of the hole. */
  private fireJet(p: PendingJet) {
    const n = Math.round(24 + p.strength * 130);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      // Tight at the base, fanning slightly with height. Squaring the random
      // keeps most of the mass in the core of the column.
      const rr = Math.pow(Math.random(), 1.8) * p.width;
      const up = p.height * (0.45 + Math.random() * 0.75);
      this.spray.spawn(
        p.x + Math.cos(a) * rr, p.y + 0.05, p.z + Math.sin(a) * rr,
        Math.cos(a) * rr * 1.4, up, Math.sin(a) * rr * 1.4,
        0.7 + Math.random() * 0.9,
        lerp(0.042, 0.125, Math.random()) * (0.7 + p.width),
        KIND.DROP, 0.18,
      );
    }
    // The stem of the column: a couple of tall soft slabs.
    const stems = Math.round(3 + p.strength * 12);
    for (let i = 0; i < stems; i++) {
      this.spray.spawn(
        p.x + (Math.random() - 0.5) * p.width, p.y + 0.1, p.z + (Math.random() - 0.5) * p.width,
        0, p.height * (0.35 + Math.random() * 0.5), 0,
        0.6 + Math.random() * 0.6, p.width * (1.6 + Math.random() * 1.4), KIND.SHEET, 0.8,
      );
    }
    // Ring of fallback droplets thrown clear of the collapsing rim.
    const ring = Math.round(p.strength * 44);
    for (let i = 0; i < ring; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spray.spawn(
        p.x + Math.cos(a) * p.width * 2.2, p.y, p.z + Math.sin(a) * p.width * 2.2,
        Math.cos(a) * 1.8, p.height * 0.3 * Math.random(), Math.sin(a) * 1.8,
        0.5 + Math.random() * 0.6, 0.038 + Math.random() * 0.075, KIND.DROP, 0.45,
      );
    }
  }

  reset() { this.pending.length = 0; this.lastMagnitude = 0; }
}
