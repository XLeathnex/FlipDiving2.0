import { V3, clamp, clamp01, damp, lerp } from '../core/vec.ts';
import type { Contact } from './body.ts';
import type { Level } from './level.ts';

/**
 * On-foot character controller.
 *
 * The whole world is already a signed distance field, which makes this much
 * simpler than it usually is: there is no mesh to sweep against and no
 * broadphase to maintain. Push three spheres out of the field, look at the
 * normal that pushed hardest, and you have ground contact, wall sliding and
 * slope limits from the same query.
 *
 * The point of walking is that you choose your own take-off. Every ledge in
 * the world is a diving board if you can get to it, so the controller has to
 * be good enough to trust near a two-hundred-foot drop: no sliding off flat
 * rock, no catching on seams, and a step height that clears the bumps the
 * limestone detail puts everywhere.
 */

export const WALK = {
  radius: 0.32,
  height: 1.78,
  /** Ground speeds, m/s. */
  walkSpeed: 3.1,
  runSpeed: 6.4,
  accelGround: 26,
  accelAir: 5.5,
  /** Standing jump, m/s. */
  hopSpeed: 4.4,
  gravity: 20.5,
  /** Steepest ground you can stand on, as normal.y. */
  slopeLimit: 0.52,
  /** How far up a ledge you can walk without jumping. */
  stepHeight: 0.55,
  /** How far below the feet we still count as ground, to stay glued on slopes. */
  snapDist: 0.42,
  turnRate: 11,
} as const;

const _c: Contact = { nx: 0, ny: 1, nz: 0, depth: 0, hard: 1 };
const _n = new V3();
const _tmp = new V3();

export interface WalkInput {
  /** Camera-relative movement, each -1..1. */
  mx: number; mz: number;
  run: boolean;
  jump: boolean;
  /** Camera yaw, so movement is relative to where you are looking. */
  camYaw: number;
}

export class Walker {
  /** Foot position. */
  pos = new V3();
  vel = new V3();
  /** Facing direction, radians. 0 = +X. */
  yaw = 0;
  grounded = false;
  groundNormal = new V3(0, 1, 0);
  /** 0..1 how fast the legs should be cycling, for the walk animation. */
  gait = 0;
  /** Time since we last had ground under us. Coyote time for edge jumps. */
  airTime = 0;
  /** True when standing close enough to a drop that a dive makes sense. */
  atEdge = false;
  /** Height of the drop directly ahead, metres. */
  edgeDrop = 0;

  reset(x: number, y: number, z: number, yaw: number) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.grounded = true;
    this.gait = 0;
    this.airTime = 0;
  }

  /** Centre of the capsule, for rendering and camera framing. */
  centre(out = new V3()): V3 {
    return out.set(this.pos.x, this.pos.y + WALK.height * 0.5, this.pos.z);
  }

  update(dt: number, input: WalkInput, level: Level): void {
    // --- desired horizontal velocity, in camera space ---
    let mx = input.mx, mz = input.mz;
    const mag = Math.hypot(mx, mz);
    if (mag > 1) { mx /= mag; mz /= mag; }
    // camYaw is the world direction (cos,sin) the camera looks along the
    // ground; forward (mz) walks along that direction and right (mx) is a
    // -90-degree turn from it, matching the same (cos,sin) convention this.yaw
    // itself uses. Getting the sign of the mx term backwards here is the
    // classic bug where strafing works but feels mirrored.
    const c = Math.cos(input.camYaw), s = Math.sin(input.camYaw);
    const wantX = c * mz - s * mx;
    const wantZ = s * mz + c * mx;
    const speed = input.run ? WALK.runSpeed : WALK.walkSpeed;
    const targetX = wantX * speed, targetZ = wantZ * speed;

    const accel = this.grounded ? WALK.accelGround : WALK.accelAir;
    this.vel.x = damp(this.vel.x, targetX, accel * (mag > 0.01 ? 1 : 1.6), dt);
    this.vel.z = damp(this.vel.z, targetZ, accel * (mag > 0.01 ? 1 : 1.6), dt);

    if (mag > 0.02) {
      // Turn toward travel. Short-way-round on the angle difference.
      const want = Math.atan2(wantZ, wantX);
      let d = want - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * clamp01(dt * WALK.turnRate);
    }

    this.vel.y -= WALK.gravity * dt;
    if (this.grounded && this.vel.y < 0) this.vel.y = Math.max(this.vel.y, -2.0);

    if (input.jump && (this.grounded || this.airTime < 0.14)) {
      this.vel.y = WALK.hopSpeed;
      this.grounded = false;
      this.airTime = 0.5;
    }

    // --- integrate, then resolve ---
    const stepY = this.grounded ? WALK.stepHeight : 0;
    this.pos.addScaled(this.vel, dt);
    this.resolve(level, stepY);

    if (this.grounded) this.airTime = 0; else this.airTime += dt;

    const horiz = Math.hypot(this.vel.x, this.vel.z);
    this.gait = damp(this.gait, this.grounded ? clamp01(horiz / WALK.runSpeed) : 0, 9, dt);

    this.probeEdge(level);
  }

  /** Push the body out of the world and work out what it is standing on. */
  private resolve(level: Level, stepY: number) {
    const r = WALK.radius;
    const offs = [r + 0.02, WALK.height * 0.5, WALK.height - r];
    let bestY = -1;
    let hit = false;

    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const oy of offs) {
        if (!level.probeSphere(this.pos.x, this.pos.y + oy, this.pos.z, r, _c)) continue;
        // A wall we can step over should lift us instead of blocking us.
        if (_c.ny < WALK.slopeLimit && oy < stepY + r && stepY > 0) {
          const lifted = this.pos.y + Math.min(stepY, _c.depth + 0.05);
          if (!level.probeSphere(this.pos.x, lifted + WALK.height - r, this.pos.z, r, _c)) {
            this.pos.y = lifted;
            moved = true;
            continue;
          }
        }
        _n.set(_c.nx, _c.ny, _c.nz);
        this.pos.addScaled(_n, Math.min(_c.depth, 0.6));
        // Remove the velocity going into the surface.
        const vn = this.vel.dot(_n);
        if (vn < 0) this.vel.addScaled(_n, -vn);
        if (_n.y > bestY) { bestY = _n.y; this.groundNormal.copy(_n); }
        hit = true;
        moved = true;
      }
      if (!moved) break;
    }

    this.grounded = hit && bestY >= WALK.slopeLimit;

    // Stay glued to the ground on the way down slopes and over small steps.
    if (!this.grounded && this.vel.y <= 0.6) {
      for (let d = 0.06; d <= WALK.snapDist; d += 0.06) {
        if (!level.probeSphere(this.pos.x, this.pos.y - d + WALK.radius + 0.02, this.pos.z, WALK.radius, _c)) continue;
        if (_c.ny < WALK.slopeLimit) break;
        this.pos.y += _c.depth - d;
        this.groundNormal.set(_c.nx, _c.ny, _c.nz);
        this.grounded = true;
        this.vel.y = 0;
        break;
      }
    }
    if (this.grounded && this.vel.y < 0) this.vel.y = 0;

    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z)) this.pos.set(0, 40, 0);
  }

  /**
   * How big is the drop in front of you? Drives the "you could dive from here"
   * prompt and the take-off, and it is measured rather than tagged, so any
   * ledge in the world works and no level data has to know about it.
   */
  private probeEdge(level: Level) {
    if (!this.grounded) { this.atEdge = false; this.edgeDrop = 0; return; }
    const fx = Math.cos(this.yaw), fz = Math.sin(this.yaw);
    let best = 0;
    for (const ahead of [0.8, 1.5, 2.4]) {
      const px = this.pos.x + fx * ahead, pz = this.pos.z + fz * ahead;
      let drop = 0;
      for (let d = 0.5; d <= 130; d *= 1.35) {
        const y = this.pos.y - d;
        if (y < level.seaY) { drop = this.pos.y - level.seaY; break; }
        if (level.rock.sample(px, y, pz) < 0.4 || level.propAt(px, y, pz)) break;
        drop = d;
      }
      best = Math.max(best, drop);
    }
    this.edgeDrop = best;
    this.atEdge = best > 3.0;
  }
}
