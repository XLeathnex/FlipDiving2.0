import { V3, Quat, clamp, clamp01, lerp, smoothstep } from '../core/vec.ts';
import { DiverBody, TUNE, type DiverControl, type ImpactEvent } from './body.ts';
import { Level, type Spot } from './level.ts';
import { shapeName } from './pose.ts';
import { gradeEntry, scoreDive, type DiveResult, type EntrySample, type DiveStats } from './scoring.ts';

export type Phase = 'ready' | 'charge' | 'air' | 'result';

export interface GameInput {
  /** Held. On the ground: charge. In the air: tuck. */
  jump: boolean;
  /** Went down at some point since the last frame, however briefly. */
  jumpEdge: boolean;
  /** Held. In the air: stretch to layout. */
  stretch: boolean;
  /** -1 back / +1 front. On the ground: takeoff rotation. In the air: scoop. */
  rot: number;
  restart: boolean;
  spotDelta: number;
}

/** Launch feel. Small numbers, big consequences -- these get tuned by hand. */
export const LAUNCH = {
  chargeTime: 0.55,
  spinChargeTime: 0.45,
  upMin: 2.9, upMax: 5.5,
  outMin: 1.7, outMax: 4.4,
  /** Peak takeoff angular velocity in the (near-straight) takeoff pose, rad/s. */
  spinMax: 3.7,
  /** Hard rotation costs some of your outward travel, as it does in reality. */
  spinDragOnOut: 0.26,
} as const;

/** Body shape targets for the three held states. */
const SHAPE_TUCK = 1.0;
const SHAPE_LOOSE = 0.42;   // pike-ish: the useful middle gear you get for free
const SHAPE_LAYOUT = 0.0;

const _v = new V3(), _axis = new V3(), _chest = new V3(), _vd = new V3();

export interface HudState {
  phase: Phase;
  charge: number;
  spinCharge: number;
  altitude: number;
  /** Distance from the body to the water surface directly below. */
  toWater: number;
  /** Estimated seconds until the body reaches the water. */
  timeToWater: number;
  speed: number;
  halfRots: number;
  halfTwists: number;
  shape: number;
  spotName: string;
  spotHeight: number;
}

export class Game {
  level = new Level();
  body = new DiverBody();
  phase: Phase = 'ready';

  spotIndex = 3;
  charge = 0;
  spinCharge = 0;

  result: DiveResult | null = null;
  /** Time since the dive ended, for restart gating and UI timing. */
  sinceResult = 0;
  /** Time since the last respawn. */
  sinceSpawn = 0;

  best = 0;
  lastScore = 0;

  /** Events for the presentation layer to consume each frame. */
  events: ({ t: 'launch' } | { t: 'impact'; e: ImpactEvent } | { t: 'entry'; q: number; speed: number; x: number; y: number; z: number }
    | { t: 'crash' } | { t: 'spawn' } | { t: 'charge' })[] = [];

  private ctrl: DiverControl = { shape: SHAPE_LOOSE, pitch: 0 };
  private lastShapeKey: 'tuck' | 'layout' | 'none' = 'none';
  private prevJump = false;
  private prevStretch = false;
  private shapeAccum = 0;
  private shapeWeight = 0;
  private lastLooseTime = 0;
  private entered = false;
  private hadSolidHit = false;
  time = 0;

  constructor() { this.spawn(); }

  get spot(): Spot { return this.level.spots[this.spotIndex]; }

  spawn() {
    const s = this.spot;
    // yaw is stored as a small offset from "facing out to sea" (+X).
    this.body.reset(s.pos.x, s.pos.y + this.body.standHalf, s.pos.z, Math.PI / 2 + s.yaw);
    this.phase = 'ready';
    this.charge = 0; this.spinCharge = 0;
    this.result = null;
    this.sinceResult = 0;
    this.sinceSpawn = 0;
    this.shapeAccum = 0; this.shapeWeight = 0;
    this.lastLooseTime = 0;
    this.entered = false;
    this.hadSolidHit = false;
    this.ctrl.shape = SHAPE_LAYOUT;
    this.ctrl.pitch = 0;
    this.lastShapeKey = 'none';
    this.events.push({ t: 'spawn' });
  }

  selectSpot(i: number) {
    this.spotIndex = (i + this.level.spots.length) % this.level.spots.length;
    this.spawn();
  }

  /** One frame. Runs the physics at a fixed 240 Hz internally. */
  update(dt: number, input: GameInput) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.level.time = this.time;
    this.sinceSpawn += dt;

    if (input.spotDelta && (this.phase === 'ready' || this.phase === 'result')) {
      this.selectSpot(this.spotIndex + input.spotDelta);
      return;
    }
    // Retrying has to be immediate. A fresh press of the jump key during the
    // result restarts straight away, and because it is the same key you charge
    // the next jump with, holding it through the restart just starts loading
    // the next attempt. Crash, read the word, and you are already going again.
    const jumpEdge = input.jumpEdge && !this.prevJump;
    const wantsRestart = input.restart || (this.phase === 'result' && jumpEdge && this.sinceResult > 0.22);
    if (wantsRestart && (this.phase !== 'result' || this.sinceResult > 0.22)) {
      if (this.phase !== 'ready' || this.sinceSpawn > 0.1) {
        this.prevJump = input.jump;
        this.spawn();
        return;
      }
    }

    switch (this.phase) {
      case 'ready':
        if (input.jump) { this.phase = 'charge'; this.events.push({ t: 'charge' }); }
        break;

      case 'charge': {
        this.charge = clamp01(this.charge + dt / LAUNCH.chargeTime);
        if (input.rot !== 0) {
          this.spinCharge = clamp(this.spinCharge + input.rot * dt / LAUNCH.spinChargeTime, -1, 1);
        } else {
          this.spinCharge *= Math.exp(-1.5 * dt);
        }
        if (!input.jump) this.doLaunch();
        break;
      }

      case 'air':
      case 'result':
        break;
    }

    // --- Air control ---
    if (this.phase === 'air' || this.phase === 'result') {
      // Last key pressed wins, so a panic-stretch always answers immediately.
      if (input.jump && !this.prevJump) this.lastShapeKey = 'tuck';
      if (input.stretch && !this.prevStretch) this.lastShapeKey = 'layout';
      if (!input.jump && this.lastShapeKey === 'tuck') this.lastShapeKey = input.stretch ? 'layout' : 'none';
      if (!input.stretch && this.lastShapeKey === 'layout') this.lastShapeKey = input.jump ? 'tuck' : 'none';

      const target = this.lastShapeKey === 'tuck' ? SHAPE_TUCK
        : this.lastShapeKey === 'layout' ? SHAPE_LAYOUT : SHAPE_LOOSE;
      this.ctrl.shape = target;
      this.ctrl.pitch = this.body.mode === 'crashed' ? 0 : input.rot;
    } else {
      this.ctrl.shape = SHAPE_LAYOUT;
      this.ctrl.pitch = 0;
    }
    this.prevJump = input.jump;
    this.prevStretch = input.stretch;

    // --- Fixed-step physics ---
    const H = 1 / 240;
    let acc = dt;
    while (acc > 1e-6) {
      const h = Math.min(H, acc);
      acc -= h;
      const wasCrashed = this.body.mode === 'crashed';
      this.body.step(h, this.ctrl, this.level);
      if (!wasCrashed && this.body.mode === 'crashed') {
        this.hadSolidHit = true;
        this.events.push({ t: 'crash' });
      }
      if (this.phase === 'air') {
        // Weighted mean shape, weighted by how fast we were actually rotating.
        const w = Math.abs(this.body.omegaBody.x) * h;
        this.shapeAccum += this.body.shape * w;
        this.shapeWeight += w;
        if (this.body.pose.extension < 0.62) this.lastLooseTime = this.body.airTime;
        // Track how close we came to the rock, for the close-call bonus.
        const c = this.level.clearance(this.body.pos.x, this.body.pos.y, this.body.pos.z);
        if (this.body.airTime > 0.25) this.body.nearestSolid = Math.min(this.body.nearestSolid, c);
      }
      this.drainImpacts();
      // Landed on rock and stopped: the dive is over even without water.
      if (this.phase === 'air' && this.body.restingTime > 0.45) { this.finishOnRock(); break; }
      if (this.entered) break;
    }

    if (this.phase === 'result') this.sinceResult += dt;
  }

  private drainImpacts() {
    const list = this.body.impacts;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.kind === 'water' && !this.entered && this.phase === 'air') {
        this.entered = true;
        this.finishDive(e);
      } else if (e.kind === 'solid') {
        this.events.push({ t: 'impact', e });
      } else if (e.kind === 'water') {
        this.events.push({ t: 'impact', e });
      }
    }
    list.length = 0;
  }

  private doLaunch() {
    const b = this.body;
    const s = this.spot;
    const heading = Math.PI / 2 + s.yaw;
    // Facing direction in world space (body +Z).
    const fx = Math.sin(heading), fz = Math.cos(heading);

    const spinMag = Math.abs(this.spinCharge);
    const up = lerp(LAUNCH.upMin, LAUNCH.upMax, this.charge);
    const out = lerp(LAUNCH.outMin, LAUNCH.outMax, this.charge) * (1 - LAUNCH.spinDragOnOut * spinMag);

    _v.set(fx * out, up, fz * out);
    b.launch(_v, this.spinCharge * LAUNCH.spinMax, 0);
    this.phase = 'air';
    this.lastShapeKey = 'none';
    this.events.push({ t: 'launch' });
  }

  /** Came to rest against rock without ever reaching the water. */
  private finishOnRock() {
    const b = this.body;
    this.entered = true;
    this.hadSolidHit = true;
    this.finishDive({ kind: 'water', speed: 0, normalSpeed: 0, x: b.pos.x, y: b.pos.y, z: b.pos.z, hard: 1 });
  }

  private finishDive(e: ImpactEvent) {
    const b = this.body;
    b.bodyAxis(_axis);
    b.bodyFacing(_chest);
    const speed = b.vel.len();
    _vd.copy(b.vel).scale(speed > 1e-4 ? 1 / speed : 0);

    const d = _axis.dot(_vd);
    const sample: EntrySample = {
      speed,
      align: Math.abs(d),
      vertical: clamp01(-_vd.y),
      spin: b.omegaBody.len(),
      extension: b.pose.extension,
      lead: d >= 0 ? 1 : -1,
      chest: _chest.dot(_vd),
      crashed: b.mode === 'crashed' || this.hadSolidHit,
    };
    const entry = gradeEntry(sample);

    const stats: DiveStats = {
      fall: Math.max(0, b.peakY - e.y),
      somersault: b.somersault,
      twist: b.twist,
      meanShape: this.shapeWeight > 1e-4 ? this.shapeAccum / this.shapeWeight : b.shape,
      shapeName: shapeName(this.shapeWeight > 1e-4 ? this.shapeAccum / this.shapeWeight : b.shape),
      scoopUsed: b.scoopUsed,
      nearestSolid: b.nearestSolid,
      lineUpTime: b.airTime - this.lastLooseTime,
      airTime: b.airTime,
    };

    this.result = scoreDive(stats, entry);
    this.lastScore = this.result.score;
    this.best = Math.max(this.best, this.result.score);
    this.phase = 'result';
    this.sinceResult = 0;
    this.events.push({ t: 'entry', q: entry.quality, speed, x: e.x, y: e.y, z: e.z });
  }

  hud(): HudState {
    const b = this.body;
    const waterY = this.level.waterHeight(b.pos.x, b.pos.z);
    const toWater = b.pos.y - waterY;
    // Ballistic estimate, good enough for a HUD and stable frame to frame.
    const vy = b.vel.y, g = 9.81;
    const disc = vy * vy + 2 * g * Math.max(0, toWater);
    const tt = disc > 0 ? (vy + Math.sqrt(disc)) / g : 0;
    return {
      phase: this.phase,
      charge: this.charge,
      spinCharge: this.spinCharge,
      altitude: b.pos.y,
      toWater,
      timeToWater: tt,
      speed: b.vel.len(),
      halfRots: Math.abs(b.somersault) / Math.PI,
      halfTwists: Math.abs(b.twist) / Math.PI,
      shape: b.shape,
      spotName: this.spot.name,
      spotHeight: this.spot.height,
    };
  }
}
