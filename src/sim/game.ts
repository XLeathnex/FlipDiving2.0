import { V3, clamp, clamp01, lerp } from '../core/vec.ts';
import { DiverBody, type DiverControl, type ImpactEvent } from './body.ts';
import { Walker, WALK } from './walker.ts';
import { Level, type Spot } from './level.ts';
import { TRICKS, shapeLabel, type Trick } from './tricks.ts';
import { gradeEntry, scoreDive, type DiveResult, type EntrySample, type DiveStats } from './scoring.ts';

/**
 * You are always a person standing somewhere, and a dive is something that
 * person decides to do. There is no level select between you and the water:
 * walk to any edge in the world, load a jump, and go. Quick-travel to a named
 * spot exists because retrying from the top of a hundred-metre tower should not
 * mean walking back up, not because the game is a menu of jumping-off points.
 */
export type Phase = 'walk' | 'charge' | 'air' | 'result';

export interface GameInput {
  /** Camera-relative movement on foot, each -1..1. */
  mx: number; mz: number;
  run: boolean;
  /** Held. On foot: hop or load a dive. In the air: commit to the trick. */
  jump: boolean;
  jumpEdge: boolean;
  /** Held. In the air: straighten out. */
  stretch: boolean;
  /** -1 back / +1 front. While loading: lean. In the air: scoop. */
  rot: number;
  restart: boolean;
  spotDelta: number;
  trickDelta: number;
  /** Where the camera is looking along the ground, radians. */
  camYaw: number;
}

/**
 * Take-off.
 *
 * Rotation is not a separate thing you charge up. Your legs push through your
 * feet, and if your centre of mass is not directly above your feet, that push
 * has a moment arm. Angular momentum is literally `lean * pushSpeed`: lean
 * further and you spin more, push harder and you spin more, and a weak jump
 * with a big lean gives you far less rotation than a strong one.
 *
 * The whole take-off is therefore two things a player can feel -- how long you
 * loaded it, and what angle you left at -- rather than two meters to fill.
 */
export const LAUNCH = {
  chargeTime: 0.62,
  upMin: 2.6, upMax: 5.6,
  outMin: 1.5, outMax: 3.5,
  leanRate: 3.2,
  /** Furthest the centre of mass gets from the feet, metres. */
  leanMax: 0.145,
  /**
   * Leaning out also carries you out, and leaning back drops you closer to the
   * wall you just left. That is what makes a big back rotation frightening.
   */
  leanOut: 3.2,
} as const;

const SHAPE_COMMIT = 1.0;
const SHAPE_LOOSE = 0.42;
const SHAPE_LAYOUT = 0.0;

const _v = new V3(), _axis = new V3(), _chest = new V3(), _vd = new V3();

export interface HudState {
  phase: Phase;
  charge: number;
  /** -1 back .. +1 front, the take-off angle. */
  lean: number;
  altitude: number;
  toWater: number;
  timeToWater: number;
  speed: number;
  halfRots: number;
  halfTwists: number;
  shape: number;
  spotName: string;
  spotHeight: number;
  crashed: boolean;
  trick: Trick;
  /** On foot: how big the drop in front of you is. */
  edgeDrop: number;
  onFoot: boolean;
  /** Height of the ledge the current dive started from. */
  takeoffHeight: number;
}

export type GameEvent =
  | { t: 'launch' }
  | { t: 'impact'; e: ImpactEvent }
  | { t: 'churn'; e: ImpactEvent }
  | { t: 'entry'; reward: number; speed: number; x: number; y: number; z: number; phys: ImpactEvent }
  | { t: 'crash' }
  | { t: 'spawn' }
  | { t: 'charge' }
  | { t: 'trick' }
  | { t: 'footstep'; x: number; y: number; z: number }
  | { t: 'land'; speed: number };

export class Game {
  level: Level;
  body = new DiverBody();
  walker = new Walker();
  phase: Phase = 'walk';

  spotIndex = 0;
  trickIndex = 0;
  charge = 0;
  lean = 0;

  result: DiveResult | null = null;
  sinceResult = 0;
  sinceSpawn = 0;
  time = 0;

  best = 0;
  lastScore = 0;
  bestBySpot: Record<string, number> = {};

  events: GameEvent[] = [];

  /** Where this dive started, for scoring and for the instant retry. */
  takeoff = new V3();
  takeoffYaw = 0;
  takeoffHeight = 0;
  /** Nearest named spot while on foot, or null. */
  nearSpot: Spot | null = null;

  private ctrl: DiverControl = { shape: SHAPE_LOOSE, pitch: 0 };
  private lastShapeKey: 'commit' | 'layout' | 'none' = 'none';
  private prevJump = false;
  private prevStretch = false;
  private needsJumpRelease = false;
  private shapeAccum = 0;
  private shapeWeight = 0;
  private lastLooseTime = 0;
  private entered = false;
  private hadSolidHit = false;
  private stepPhase = 0;
  private wasGrounded = true;
  /**
   * A retry tap that lands during the post-result cooldown (see `update`)
   * shouldn't just be dropped -- a player who taps the instant they see
   * "Crash" is reacting exactly on time, not too early. Latch it and fire as
   * soon as the cooldown clears, instead of demanding a second tap.
   */
  private wantsRetryTap = false;

  constructor(level?: Level) {
    this.level = level ?? new Level();
    this.teleport(0);
  }

  get spot(): Spot { return this.level.spots[this.spotIndex]; }
  get trick(): Trick { return TRICKS[this.trickIndex]; }
  get onFoot(): boolean { return this.phase === 'walk' || this.phase === 'charge'; }

  selectTrick(i: number) {
    this.trickIndex = (i + TRICKS.length) % TRICKS.length;
    this.body.trick = this.trick;
  }

  /** Quick-travel to a named spot and stand there. */
  teleport(i: number, holdingJump = false) {
    this.spotIndex = (i + this.level.spots.length) % this.level.spots.length;
    const s = this.spot;
    // Walker.yaw follows the (cos,sin) = forward convention used everywhere in
    // the walk controller (probeEdge included), which is a quarter turn away
    // from the body's own facing parameter -- see handOffToBody for the other
    // half of this conversion. Getting only one side of it right is what
    // produces a character who stands facing the cliff instead of the sea.
    this.standAt(s.pos.x, s.pos.y, s.pos.z, -s.yaw, holdingJump);
  }

  /** Put the player on their feet at a point, ending any dive in progress. */
  standAt(x: number, y: number, z: number, yaw: number, holdingJump = false) {
    this.walker.reset(x, y, z, yaw);
    // Settle immediately: grounded and atEdge are only ever known correct
    // after a real physics step, but reset() has to assume something in the
    // meantime. Priming them here with a zero-length step means the very
    // first real frame already has the truth, rather than one frame of
    // "assumed grounded" turning a jump held from the moment you land into a
    // stray hop before the edge check has ever run.
    this.walker.update(0, { mx: 0, mz: 0, run: false, jump: false, camYaw: yaw }, this.level);
    this.phase = 'walk';
    this.charge = 0;
    this.lean = 0;
    this.result = null;
    this.sinceResult = 0;
    this.sinceSpawn = 0;
    this.wantsRetryTap = false;
    this.needsJumpRelease = holdingJump;
    this.body.trick = this.trick;
    this.events.push({ t: 'spawn' });
  }

  /** Back to the ledge this dive started from. The fast-retry path. */
  retry(holdingJump = false) {
    this.standAt(this.takeoff.x, this.takeoff.y, this.takeoff.z, this.takeoffYaw, holdingJump);
  }

  update(dt: number, input: GameInput) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.level.time = this.time;
    this.sinceSpawn += dt;

    if (input.spotDelta) { this.teleport(this.spotIndex + input.spotDelta, input.jump); return; }
    if (input.trickDelta) {
      this.selectTrick(this.trickIndex + input.trickDelta);
      this.events.push({ t: 'trick' });
    }
    if (!input.jump) this.needsJumpRelease = false;

    const jumpEdge = input.jumpEdge && !this.prevJump;
    if (this.phase === 'result' && jumpEdge) this.wantsRetryTap = true;
    if (input.restart || (this.phase === 'result' && this.wantsRetryTap && this.sinceResult > 0.22)) {
      if (this.phase !== 'walk' || this.sinceSpawn > 0.1) {
        this.wantsRetryTap = false;
        this.prevJump = input.jump;
        this.retry(input.jump);
        return;
      }
    }

    switch (this.phase) {
      case 'walk': this.updateWalk(dt, input); break;
      case 'charge': this.updateCharge(dt, input); break;
      case 'air': case 'result': this.updateAir(dt, input); break;
    }

    this.prevJump = input.jump;
    this.prevStretch = input.stretch;
    if (this.phase === 'result') this.sinceResult += dt;
  }

  // ------------------------------------------------------------------ on foot

  private updateWalk(dt: number, input: GameInput) {
    const w = this.walker;
    const wantCharge = input.jump && !this.needsJumpRelease && w.grounded && w.atEdge;
    // A hop is for getting around; loading a dive only makes sense at an edge,
    // and the walker measures that from the world rather than from level data.
    w.update(dt, {
      mx: input.mx, mz: input.mz, run: input.run,
      jump: input.jump && !this.needsJumpRelease && !w.atEdge,
      camYaw: input.camYaw,
    }, this.level);

    if (wantCharge) { this.beginCharge(); return; }

    // Walking off the edge is a legitimate way to start a dive; you just do not
    // get the push, which is exactly what stepping off a cliff feels like.
    if (!w.grounded && w.airTime > 0.18 && w.vel.y < -1.5) {
      this.beginFall();
      return;
    }

    // Footsteps.
    if (w.grounded) {
      this.stepPhase += w.gait * dt * 3.4;
      if (this.stepPhase > 1) {
        this.stepPhase -= 1;
        this.events.push({ t: 'footstep', x: w.pos.x, y: w.pos.y, z: w.pos.z });
      }
      if (!this.wasGrounded) this.events.push({ t: 'land', speed: Math.abs(w.vel.y) });
    }
    this.wasGrounded = w.grounded;

    this.nearSpot = this.level.nearestSpot(w.pos.x, w.pos.y, w.pos.z, 7);
  }

  private beginCharge() {
    this.phase = 'charge';
    this.charge = 0;
    this.lean = 0;
    this.events.push({ t: 'charge' });
  }

  private updateCharge(dt: number, input: GameInput) {
    this.charge = clamp01(this.charge + dt / LAUNCH.chargeTime);
    // W/S set the lean, and it is the same physical motion as walking forward
    // or back: lean forward (W) over your toes for a front rotation, rock back
    // onto your heels (S) for a back rotation. It follows the stick directly
    // and springs back when released, so the angle is something you hold, not
    // something you accumulate.
    const want = clamp(input.mz, -1, 1);
    this.lean = clamp(this.lean + (want - this.lean) * clamp01(dt * LAUNCH.leanRate * 2.2), -1, 1);

    // Aim with the camera while you load. Look where you want to go, hold the
    // charge, and that is the direction you take off in -- there is no extra
    // step of shuffling your feet to face a fixed platform edge.
    let d = input.camYaw - this.walker.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.walker.yaw += d * clamp01(dt * WALK.turnRate);

    if (!input.jump) this.doLaunch();
  }

  // -------------------------------------------------------------------- dive

  /** Move the simulation from the walker to the rigid body. */
  private handOffToBody(): number {
    const w = this.walker;
    const yaw = w.yaw;
    // See teleport() for the other half of this conversion.
    this.body.reset(w.pos.x, w.pos.y + this.body.standHalf, w.pos.z, Math.PI / 2 - yaw);
    this.body.trick = this.trick;
    this.takeoff.set(w.pos.x, w.pos.y, w.pos.z);
    this.takeoffYaw = yaw;
    this.takeoffHeight = w.pos.y - this.level.seaY;
    this.shapeAccum = 0; this.shapeWeight = 0;
    this.lastLooseTime = 0;
    this.entered = false;
    this.hadSolidHit = false;
    this.lastShapeKey = 'none';
    this.result = null;
    this.phase = 'air';
    return yaw;
  }

  private doLaunch() {
    const yaw = this.handOffToBody();
    const fx = Math.cos(yaw), fz = Math.sin(yaw);

    const push = lerp(LAUNCH.upMin, LAUNCH.upMax, this.charge);
    const out = lerp(LAUNCH.outMin, LAUNCH.outMax, this.charge) + this.lean * LAUNCH.leanOut * this.charge;
    _v.set(fx * out, push, fz * out);

    // Angular momentum = moment arm x push. One expression, and every bit of
    // the take-off's feel comes out of it.
    const spinL = this.lean * LAUNCH.leanMax * push;
    this.body.launch(_v, spinL, 0);
    this.body.vel.add(this.walker.vel.clone().scale(0.55));
    this.events.push({ t: 'launch' });
  }

  /** Walked off an edge: no push, whatever momentum you had. */
  private beginFall() {
    this.handOffToBody();
    this.body.vel.copy(this.walker.vel);
    this.body.launch(this.body.vel.clone(), 0, 0);
    this.events.push({ t: 'launch' });
  }

  private updateAir(dt: number, input: GameInput) {
    if (input.jump && !this.prevJump) this.lastShapeKey = 'commit';
    if (input.stretch && !this.prevStretch) this.lastShapeKey = 'layout';
    if (!input.jump && this.lastShapeKey === 'commit') this.lastShapeKey = input.stretch ? 'layout' : 'none';
    if (!input.stretch && this.lastShapeKey === 'layout') this.lastShapeKey = input.jump ? 'commit' : 'none';

    this.ctrl.shape = this.lastShapeKey === 'commit' ? SHAPE_COMMIT
      : this.lastShapeKey === 'layout' ? SHAPE_LAYOUT : SHAPE_LOOSE;
    this.ctrl.pitch = this.body.mode === 'crashed' ? 0 : input.rot;

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
        const wgt = Math.abs(this.body.omegaBody.x) * h;
        this.shapeAccum += this.body.shape * wgt;
        this.shapeWeight += wgt;
        if (this.body.pose.extension < 0.62) this.lastLooseTime = this.body.airTime;
        const c = this.level.clearance(this.body.pos.x, this.body.pos.y, this.body.pos.z);
        if (this.body.airTime > 0.25) this.body.nearestSolid = Math.min(this.body.nearestSolid, c);
      }
      this.drainImpacts();
      if (this.phase === 'air' && this.body.restingTime > 0.45) { this.finishOnRock(); break; }
      if (this.entered) break;
    }
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
      } else if (e.kind === 'churn') {
        this.events.push({ t: 'churn', e });
      } else if (e.kind === 'water') {
        this.events.push({ t: 'impact', e });
      }
    }
    list.length = 0;
  }

  private finishOnRock() {
    const b = this.body;
    this.entered = true;
    this.hadSolidHit = true;
    this.finishDive({
      kind: 'water', speed: 0, normalSpeed: 0, x: b.pos.x, y: b.pos.y, z: b.pos.z, hard: 1,
      area: 0, displace: 0, slam: 0, align: 1, vx: 0, vy: 0, vz: 0,
    });
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
      intent: b.trick.intent,
      displace: e.displace,
      align: Math.abs(d),
      vertical: clamp01(-_vd.y),
      spin: b.omegaBody.len(),
      extension: b.pose.extension,
      lead: d >= 0 ? 1 : -1,
      chest: _chest.dot(_vd),
      crashed: b.mode === 'crashed' || this.hadSolidHit,
    };
    const entry = gradeEntry(sample);
    const meanShape = this.shapeWeight > 1e-4 ? this.shapeAccum / this.shapeWeight : b.shape;

    const stats: DiveStats = {
      fall: Math.max(0, b.peakY - e.y),
      difficulty: b.trick.difficulty,
      trickName: b.trick.name,
      somersault: b.somersault,
      twist: b.twist,
      meanShape,
      shapeName: shapeLabel(meanShape, b.trick),
      scoopUsed: b.scoopUsed,
      nearestSolid: b.nearestSolid,
      lineUpTime: b.airTime - this.lastLooseTime,
      airTime: b.airTime,
    };

    this.result = scoreDive(stats, entry);
    this.lastScore = this.result.score;
    this.best = Math.max(this.best, this.result.score);
    const key = `${this.level.id}:${this.nearestTakeoffId()}`;
    if (this.result.score > (this.bestBySpot[key] ?? 0)) {
      this.bestBySpot[key] = this.result.score;
      this.result.newBest = true;
    }
    this.phase = 'result';
    this.sinceResult = 0;
    this.events.push({ t: 'entry', reward: entry.quality, speed, x: e.x, y: e.y, z: e.z, phys: e });
  }

  private nearestTakeoffId(): string {
    const s = this.level.nearestSpot(this.takeoff.x, this.takeoff.y, this.takeoff.z, 9);
    return s ? s.id : `free${Math.round(this.takeoffHeight)}`;
  }

  hud(): HudState {
    const onFoot = this.onFoot;
    const px = onFoot ? this.walker.pos.x : this.body.pos.x;
    const py = onFoot ? this.walker.pos.y : this.body.pos.y;
    const pz = onFoot ? this.walker.pos.z : this.body.pos.z;
    const waterY = this.level.waterHeight(px, pz);
    const toWater = py - waterY;
    const vy = onFoot ? this.walker.vel.y : this.body.vel.y;
    const g = 9.81;
    const disc = vy * vy + 2 * g * Math.max(0, toWater);
    const tt = disc > 0 ? (vy + Math.sqrt(disc)) / g : 0;
    const spot = this.nearSpot ?? this.spot;
    return {
      phase: this.phase,
      charge: this.charge,
      lean: this.lean,
      altitude: py,
      toWater,
      timeToWater: tt,
      speed: onFoot ? Math.hypot(this.walker.vel.x, this.walker.vel.z) : this.body.vel.len(),
      halfRots: Math.abs(this.body.somersault) / Math.PI,
      halfTwists: Math.abs(this.body.twist) / Math.PI,
      shape: this.body.shape,
      spotName: onFoot ? (this.nearSpot ? this.nearSpot.name : 'Cala Nera') : this.spot.name,
      spotHeight: onFoot ? toWater : this.takeoffHeight,
      crashed: this.body.mode === 'crashed',
      trick: this.trick,
      edgeDrop: this.walker.edgeDrop,
      onFoot,
      takeoffHeight: this.takeoffHeight,
    };
  }
}
