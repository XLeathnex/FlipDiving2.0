import * as THREE from 'three';
import { clamp, clamp01, damp, lerp, smoothstep } from '../core/vec.ts';
import type { Game } from '../sim/game.ts';

/**
 * Camera director.
 *
 * The camera's job is to answer the two questions the player is actually asking
 * -- "how am I oriented?" and "how long have I got?" -- and to answer them
 * without ever making the diver harder to control.
 *
 * So it swings toward a clean side-on profile as the water approaches (profile
 * is the only angle from which body angle is readable), it frames between the
 * diver and the predicted impact point so the drop below is always visible, and
 * it keeps itself level. Shake is impulse-driven and short; nothing shakes
 * while the player still has decisions to make.
 */

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _look = new THREE.Vector3();
const _g = { x: 0, y: 1, z: 0 };

export class CameraDirector {
  cam: THREE.PerspectiveCamera;
  private pos = new THREE.Vector3(-20, 34, -34);
  private target = new THREE.Vector3();
  private fov = 52;
  private shake = 0;
  private shakeT = 0;
  private roll = 0;
  private launchPunch = 0;
  private hitStop = 0;
  /** 0 = staging view on the platform, 1 = full profile tracking. */
  private profile = 0;

  constructor(aspect: number) {
    this.cam = new THREE.PerspectiveCamera(52, aspect, 0.12, 3000);
    this.cam.position.copy(this.pos);
  }

  kick(amount: number) { this.shake = Math.min(1.4, this.shake + amount); }
  punch() { this.launchPunch = 1; }
  /** Very short freeze on a hard impact. Sells weight without stealing control. */
  freeze(seconds: number) { this.hitStop = Math.max(this.hitStop, seconds); }

  /** Returns a time scale for the simulation (used for impact hit-stop). */
  consumeTimeScale(dt: number): number {
    if (this.hitStop <= 0) return 1;
    this.hitStop -= dt;
    return 0.12;
  }

  update(dt: number, game: Game, aspect: number) {
    const b = game.body;
    const lvl = game.level;
    const spot = game.spot;
    const heading = Math.PI / 2 + spot.yaw;
    // Jump direction, and the horizontal axis perpendicular to it.
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const sx = fz, sz = -fx;                   // side vector: the profile axis

    const waterY = lvl.waterHeight(b.pos.x, b.pos.z);
    const h = Math.max(0, b.pos.y - waterY);
    const airborne = game.phase === 'air' || game.phase === 'result';

    // --- Predict where this dive ends, so the camera can frame the whole arc.
    const vy = b.vel.y, g = 9.81;
    const disc = vy * vy + 2 * g * h;
    const tImpact = airborne && disc > 0 ? (vy + Math.sqrt(disc)) / g : 0;
    _p.set(b.pos.x + b.vel.x * tImpact, waterY, b.pos.z + b.vel.z * tImpact);

    // How urgent is the entry? Drives profile framing and the audio ducking.
    const urgency = airborne ? 1 - smoothstep(0.35, 1.9, tImpact) : 0;
    const wantProfile = game.phase === 'ready' || game.phase === 'charge' ? 0 : 1;
    this.profile = damp(this.profile, wantProfile, 2.4, dt);

    let dist: number, camY: number, sideBias: number, backBias: number;

    if (!airborne) {
      // Staging: three-quarter view from below the lip, so the drop reads.
      dist = 6.4;
      sideBias = 0.80;
      backBias = -0.62;
      camY = b.pos.y + 1.05 - smoothstep(0, 1, game.charge) * 0.5;
      // Pull further out from tall spots so the height is legible.
      dist += smoothstep(6, 36, spot.height) * 2.2;
    } else {
      // Tracking: distance grows with remaining drop so the arc stays framed.
      const drop = Math.max(h, 4);
      dist = clamp(7.2 + drop * 0.155, 7.2, 17.5);
      sideBias = lerp(0.86, 1.0, this.profile);
      backBias = lerp(-0.5, -0.06, this.profile);
      // Sit below the diver, biased toward the water, so you can see it coming.
      camY = lerp(b.pos.y, waterY + 2.6, clamp01(0.30 + urgency * 0.22));
      camY = Math.max(camY, waterY + 1.4);
    }

    const desiredX = b.pos.x + sx * sideBias * dist + fx * backBias * dist;
    const desiredZ = b.pos.z + sz * sideBias * dist + fz * backBias * dist;
    _v.set(desiredX, camY, desiredZ);

    // Controlled lag: loose while falling for a sense of speed, tight when the
    // entry is close and the player needs an accurate read.
    const posRate = airborne ? lerp(3.2, 7.0, urgency) : 5.0;
    this.pos.x = damp(this.pos.x, _v.x, posRate, dt);
    this.pos.y = damp(this.pos.y, _v.y, posRate * 1.25, dt);
    this.pos.z = damp(this.pos.z, _v.z, posRate, dt);

    // --- Never let the camera end up inside the cliff.
    for (let i = 0; i < 3; i++) {
      const d = lvl.rock.sample(this.pos.x, this.pos.y, this.pos.z);
      if (d > 1.1) break;
      lvl.rock.gradient(this.pos.x, this.pos.y, this.pos.z, _g, 0.3);
      const push = 1.15 - d;
      this.pos.x += _g.x * push; this.pos.y += _g.y * push; this.pos.z += _g.z * push;
    }
    this.pos.y = Math.max(this.pos.y, waterY + 0.55);

    // --- Look target: between the diver and where they are going to land.
    const lead = airborne ? clamp01(0.34 - urgency * 0.34) : 0;
    _look.set(
      lerp(b.pos.x, _p.x, lead),
      lerp(b.pos.y, _p.y, lead) + (airborne ? 0.2 : -0.35),
      lerp(b.pos.z, _p.z, lead),
    );
    this.target.x = damp(this.target.x, _look.x, posRate * 1.5, dt);
    this.target.y = damp(this.target.y, _look.y, posRate * 1.5, dt);
    this.target.z = damp(this.target.z, _look.z, posRate * 1.5, dt);

    // --- Field of view: narrows under load on the platform, punches on takeoff,
    //     opens with speed. Small moves; big ones read as a zoom effect.
    let wantFov = 52;
    if (game.phase === 'charge') wantFov = 52 - game.charge * 4.5;
    else if (airborne) wantFov = 52 + clamp(b.vel.len() * 0.34, 0, 12) - urgency * 3.5;
    this.launchPunch = damp(this.launchPunch, 0, 6.5, dt);
    wantFov += this.launchPunch * 9;
    this.fov = damp(this.fov, wantFov, 7, dt);

    // --- Shake.
    this.shake = damp(this.shake, 0, 7.5, dt);
    this.shakeT += dt * 42;
    const s = this.shake * this.shake;

    // A whisper of roll coupled to the diver's rotation. Enough to feel the
    // spin in your gut, far too little to hurt the read.
    const wantRoll = airborne ? clamp(b.omegaBody.x * 0.030, -0.10, 0.10) : 0;
    this.roll = damp(this.roll, wantRoll, 3.0, dt);

    this.cam.position.set(
      this.pos.x + Math.sin(this.shakeT * 1.7) * s * 0.55,
      this.pos.y + Math.sin(this.shakeT * 2.3 + 1.1) * s * 0.55,
      this.pos.z + Math.sin(this.shakeT * 1.3 + 2.7) * s * 0.55,
    );
    this.cam.up.set(Math.sin(this.roll), Math.cos(this.roll), 0);
    this.cam.lookAt(this.target);
    this.cam.rotateZ(Math.sin(this.shakeT * 3.1) * s * 0.02);

    if (this.cam.fov !== this.fov || this.cam.aspect !== aspect) {
      this.cam.fov = this.fov;
      this.cam.aspect = aspect;
      this.cam.updateProjectionMatrix();
    }
  }

  /** Snap straight to the framing for a fresh spawn -- no swooping between tries. */
  snap(game: Game, aspect: number) {
    for (let i = 0; i < 40; i++) this.update(1 / 30, game, aspect);
  }
}
