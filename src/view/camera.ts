import * as THREE from 'three';
import { V3, clamp, clamp01, damp, lerp, smoothstep } from '../core/vec.ts';
import type { Game } from '../sim/game.ts';

/**
 * Camera director.
 *
 * Two quite different jobs live here, and the phase decides which one runs.
 *
 * On foot, this is an ordinary third-person action camera: it orbits the
 * player under mouse control and otherwise stays out of the way, the way the
 * camera in any game with a walking human being in it behaves. Its only
 * opinion is that it will not let itself end up inside the rock.
 *
 * In the air, it goes back to being a director rather than a passenger: it
 * swings toward a clean side-on profile as the water approaches (profile is
 * the only angle from which body angle is readable), frames between the diver
 * and the predicted impact point so the drop below stays visible, and holds
 * itself level. Shake is impulse-driven and short; nothing shakes while the
 * player still has decisions to make.
 */

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _look = new THREE.Vector3();
const _g = { x: 0, y: 1, z: 0 };
const _wc = new V3();

const ORBIT = {
  sensitivity: 0.0026,
  minPitch: -0.85,
  maxPitch: 1.15,
  distWalk: 5.4,
  distCharge: 4.2,
  eyeHeight: 1.5,
};

export class CameraDirector {
  cam: THREE.PerspectiveCamera;
  private pos = new THREE.Vector3(-20, 34, -34);
  private target = new THREE.Vector3();
  private fov = 58;
  private shake = 0;
  private shakeT = 0;
  private roll = 0;
  private launchPunch = 0;
  private hitStop = 0;
  /** 0 = staging view on the platform, 1 = full profile tracking. */
  private profile = 0;

  /** Mouse-look orbit state, shared by walking and the charge-up aim. */
  orbitYaw = Math.PI / 2;
  orbitPitch = 0.18;
  private orbitDist = ORBIT.distWalk;

  constructor(aspect: number) {
    this.cam = new THREE.PerspectiveCamera(58, aspect, 0.1, 3000);
    this.cam.position.copy(this.pos);
  }

  kick(amount: number) { this.shake = Math.min(1.4, this.shake + amount); }
  punch() { this.launchPunch = 1; }
  /** Very short freeze on a hard impact. Sells weight without stealing control. */
  freeze(seconds: number) { this.hitStop = Math.max(this.hitStop, seconds); }

  /** Mouse-look input, in pixels since the last poll. */
  applyLook(dx: number, dy: number) {
    this.orbitYaw -= dx * ORBIT.sensitivity;
    this.orbitPitch = clamp(this.orbitPitch - dy * ORBIT.sensitivity, ORBIT.minPitch, ORBIT.maxPitch);
  }

  /** Returns a time scale for the simulation (used for impact hit-stop). */
  consumeTimeScale(dt: number): number {
    if (this.hitStop <= 0) return 1;
    this.hitStop -= dt;
    return 0.12;
  }

  update(dt: number, game: Game, aspect: number) {
    if (game.onFoot) this.updateFreeRoam(dt, game, aspect);
    else this.updateDive(dt, game, aspect);
  }

  // ------------------------------------------------------------ on foot

  private updateFreeRoam(dt: number, game: Game, aspect: number) {
    const w = game.walker;
    const lvl = game.level;
    const charging = game.phase === 'charge';

    const wantDist = charging ? ORBIT.distCharge : ORBIT.distWalk;
    this.orbitDist = damp(this.orbitDist, wantDist, 6, dt);

    w.centre(_wc);
    const targetY = _wc.y + (charging ? 0.15 : 0);

    const cy = Math.cos(this.orbitYaw), sy = Math.sin(this.orbitYaw);
    const cp = Math.cos(this.orbitPitch), sp = Math.sin(this.orbitPitch);
    // Standard orbit placement: behind the target along -forward, raised by
    // pitch. This is also, not coincidentally, the "forward" the walker itself
    // uses to turn camera-relative movement into world movement.
    let desiredDist = this.orbitDist;

    // Occlusion: march from the target toward the desired camera position and
    // stop short of the first thing in the way, rather than pushing out again
    // after the fact -- which is what lets the lens duck under an overhang
    // instead of clipping through it for one frame first.
    const dirX = -cy * cp, dirY = sp, dirZ = -sy * cp;
    let marched = 0.3;
    for (; marched < desiredDist; marched += 0.25) {
      const px = w.pos.x + dirX * marched, py = targetY + dirY * marched, pz = w.pos.z + dirZ * marched;
      if (lvl.rock.sample(px, py, pz) < 0.35) { desiredDist = Math.max(0.6, marched - 0.25); break; }
    }

    _p.set(w.pos.x + dirX * desiredDist, targetY + dirY * desiredDist, w.pos.z + dirZ * desiredDist);
    _p.y = Math.max(_p.y, lvl.waterHeight(_p.x, _p.z) + 0.3);

    const rate = charging ? 10 : 13;
    this.pos.x = damp(this.pos.x, _p.x, rate, dt);
    this.pos.y = damp(this.pos.y, _p.y, rate, dt);
    this.pos.z = damp(this.pos.z, _p.z, rate, dt);

    _look.set(w.pos.x, targetY + ORBIT.eyeHeight * 0.3, w.pos.z);
    this.target.x = damp(this.target.x, _look.x, 16, dt);
    this.target.y = damp(this.target.y, _look.y, 16, dt);
    this.target.z = damp(this.target.z, _look.z, 16, dt);

    // A hint of zoom while a jump is loading -- looking down the barrel of it.
    const wantFov = charging ? lerp(56, 47, game.charge) : 58;
    this.fov = damp(this.fov, wantFov, 8, dt);
    this.roll = damp(this.roll, 0, 6, dt);
    this.shake = damp(this.shake, 0, 7.5, dt);

    this.cam.position.copy(this.pos);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.target);
    if (this.cam.fov !== this.fov || this.cam.aspect !== aspect) {
      this.cam.fov = this.fov; this.cam.aspect = aspect; this.cam.updateProjectionMatrix();
    }
  }

  // --------------------------------------------------------------- diving

  private updateDive(dt: number, game: Game, aspect: number) {
    const b = game.body;
    const lvl = game.level;
    const heading = game.takeoffYaw;
    const fx = Math.cos(heading), fz = Math.sin(heading);
    const sx = -fz, sz = fx;                   // side vector: the profile axis

    const waterY = lvl.waterHeight(b.pos.x, b.pos.z);
    const h = Math.max(0, b.pos.y - waterY);
    const airborne = true;

    // --- Predict where this dive ends, so the camera can frame the whole arc.
    const vy = b.vel.y, g = 9.81;
    const disc = vy * vy + 2 * g * h;
    const tImpact = disc > 0 ? (vy + Math.sqrt(disc)) / g : 0;
    _p.set(b.pos.x + b.vel.x * tImpact, waterY, b.pos.z + b.vel.z * tImpact);

    const urgency = 1 - smoothstep(0.35, 1.9, tImpact);
    this.profile = damp(this.profile, 1, 2.4, dt);

    const drop = Math.max(h, 4);
    let dist = clamp(6.1 + drop * 0.105, 6.1, 12.6);
    let sideBias = lerp(0.90, 1.0, this.profile);
    let outBias = lerp(0.30, 0.09, this.profile);
    let camY = b.pos.y + lerp(1.6, -0.4, urgency);
    camY = Math.max(camY, waterY + 2.2);
    if (game.phase === 'result') {
      const t = clamp01((game.sinceResult - 0.55) * 1.6);
      dist = lerp(dist, 13.5, t);
      camY = Math.max(lerp(camY, waterY + 7.5, t), waterY + 2.4);
    }

    const desiredX = b.pos.x + sx * sideBias * dist + fx * outBias * dist;
    const desiredZ = b.pos.z + sz * sideBias * dist + fz * outBias * dist;
    _v.set(desiredX, camY, desiredZ);

    const posRate = lerp(3.2, 7.0, urgency);
    this.pos.x = damp(this.pos.x, _v.x, posRate, dt);
    this.pos.y = damp(this.pos.y, _v.y, posRate * 1.25, dt);
    this.pos.z = damp(this.pos.z, _v.z, posRate, dt);

    for (let i = 0; i < 3; i++) {
      const d = lvl.rock.sample(this.pos.x, this.pos.y, this.pos.z);
      if (d > 1.1) break;
      lvl.rock.gradient(this.pos.x, this.pos.y, this.pos.z, _g, 0.3);
      const push = 1.15 - d;
      this.pos.x += _g.x * push; this.pos.y += _g.y * push; this.pos.z += _g.z * push;
    }
    this.pos.y = Math.max(this.pos.y, waterY + 2.2);

    const lead = clamp01(0.26 - urgency * 0.26);
    const lx = lerp(b.pos.x, _p.x, lead);
    const lz = lerp(b.pos.z, _p.z, lead);
    const flat = Math.hypot(this.pos.x - b.pos.x, this.pos.z - b.pos.z);
    const wantUp = lerp(0.42, 0.16, urgency);
    const droparm = flat * Math.tan((wantUp * this.fov * Math.PI) / 360);
    const ty = game.phase === 'result'
      ? lerp(b.pos.y, waterY + 0.4, clamp01(game.sinceResult * 1.6))
      : b.pos.y - droparm;
    _look.set(lx, ty, lz);
    this.target.x = damp(this.target.x, _look.x, posRate * 1.5, dt);
    this.target.y = damp(this.target.y, _look.y, posRate * 1.5, dt);
    this.target.z = damp(this.target.z, _look.z, posRate * 1.5, dt);

    let wantFov = 52 + clamp(b.vel.len() * 0.34, 0, 12) - urgency * 3.5;
    this.launchPunch = damp(this.launchPunch, 0, 6.5, dt);
    wantFov += this.launchPunch * 9;
    this.fov = damp(this.fov, wantFov, 7, dt);

    this.shake = damp(this.shake, 0, 7.5, dt);
    this.shakeT += dt * 42;
    const s = this.shake * this.shake;

    const wantRoll = clamp(b.omegaBody.x * 0.030, -0.10, 0.10);
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
