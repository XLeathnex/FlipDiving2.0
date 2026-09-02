import { V3, Quat, clamp, clamp01, damp, lerp } from '../core/vec.ts';
import { poseAt, collisionSpheres, type PoseData } from './pose.ts';

export const GRAVITY = 9.81;
const AIR_RHO = 1.225;
const WATER_RHO = 1000;
const CD_AIR = 1.0;
const CD_WATER = 1.2;

/** Everything a designer might want to feel-tune, in one place. */
export const TUNE = {
  /** Seconds to snap from fully open to fully tucked (fast: it's a snap). */
  tuckTime: 0.20,
  /** Seconds to open back out (slower: opening is a controlled unfurl). */
  openTime: 0.30,
  /** Player's pitch "scoop" authority, rad/s^2. Enough to fix a near miss, not to fly. */
  scoopAccel: 2.0,
  /** Aero weathervane strength: rad/s^2 at 20 m/s, fully extended, broadside. */
  alignAccel: 3.2,
  /** Rotational air damping when extended, 1/s at 20 m/s. Settles the weathervane. */
  alignDamp: 2.6,
  /** Reference speed the two aero terms above are quoted at. */
  aeroRefSpeed: 20,
  /** Active control damping about twist/cartwheel axes (1/s). Keeps dives readable. */
  axisStab: 2.4,
  /** Baseline air damping on rotation, independent of pose. */
  angDrag: 1.2e-3,
  /** Safety caps. Real bodies do not spin at 3000 rad/s, and neither should bugs. */
  maxOmega: 26,
  maxSpeed: 95,
  /** Impact speed above which an airborne contact with solid geometry is a crash. */
  crashSpeed: 1.8,
  /** Grace period after launch where platform contacts cannot crash you. */
  launchGrace: 0.10,
};

export type BodyMode = 'ground' | 'air' | 'water' | 'crashed';

export interface Contact {
  nx: number; ny: number; nz: number;
  depth: number;
  /** Surface hardness 0..1 (used for impact audio + how badly it hurts). */
  hard: number;
}

export interface CollisionWorld {
  /** Deepest contact for a sphere, or false. Fills `out`. */
  probeSphere(cx: number, cy: number, cz: number, r: number, out: Contact): boolean;
  /** Water surface height at (x, z). */
  waterHeight(x: number, z: number): number;
}

export interface DiverControl {
  /** Target body shape, 0 = layout, 1 = tuck. */
  shape: number;
  /** Pitch scoop, -1..1. Positive = rotate forward (front somersault direction). */
  pitch: number;
}

// Scratch vectors. Each has ONE job for the whole of step(); sharing them
// between "acceleration" and "torque" once cost an afternoon.
const _acc = new V3(), _torque = new V3(), _axis = new V3();
const _t1 = new V3(), _t2 = new V3(), _t3 = new V3();
const _c1 = new V3();
const _q = new Quat();
const _spheres = [{ off: 0, r: 0 }, { off: 0, r: 0 }, { off: 0, r: 0 }];
const _contact: Contact = { nx: 0, ny: 1, nz: 0, depth: 0, hard: 1 };

const BODY_Y = new V3(0, 1, 0);
const BODY_X = new V3(1, 0, 0);
const BODY_Z = new V3(0, 0, 1);

export interface ImpactEvent {
  kind: 'solid' | 'water';
  speed: number;
  /** Normal-component of impact speed. */
  normalSpeed: number;
  x: number; y: number; z: number;
  hard: number;
}

export class DiverBody {
  pos = new V3();
  vel = new V3();
  orient = new Quat();
  /** Angular momentum in WORLD space (per unit mass). This is what is conserved. */
  L = new V3();

  shape = 0.32;
  shapeTarget = 0.32;
  pose: PoseData = poseAt(0.32, { inertia: new V3(), halfLength: 1, radius: 0.2, extension: 1, areaBroad: 0, areaSlim: 0 });

  mode: BodyMode = 'ground';
  /** World-space angular velocity, derived each step. */
  omega = new V3();
  /** Body-frame angular velocity: .x somersault, .y twist, .z cartwheel. */
  omegaBody = new V3();

  // --- dive bookkeeping (scoring + HUD read these) ---
  airTime = 0;
  launchY = 0;
  peakY = 0;
  /** Signed accumulated somersault rotation, radians. */
  somersault = 0;
  /** Signed accumulated twist, radians. */
  twist = 0;
  /** How much scoop input has been used this dive (style penalty). */
  scoopUsed = 0;
  /** Set when the body first touches water. */
  submerged = 0;
  depth = 0;
  /** Impact events produced this step; consumed by the game layer. */
  impacts: ImpactEvent[] = [];
  /** Time since the last solid contact while airborne. */
  sinceSolid = 99;
  /** Closest approach to any solid surface while airborne, for near-miss bonuses. */
  nearestSolid = 99;

  private timeSinceLaunch = 0;
  /** How long we have been motionless against solid geometry. */
  restingTime = 0;

  reset(x: number, y: number, z: number, facing: number) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.L.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.omegaBody.set(0, 0, 0);
    this.shape = this.shapeTarget = 0.0;
    poseAt(this.shape, this.pose);
    // Face `facing` (radians about world Y), upright.
    this.orient.setAxisAngle(new V3(0, 1, 0), facing);
    this.mode = 'ground';
    this.airTime = 0; this.launchY = y; this.peakY = y;
    this.somersault = 0; this.twist = 0; this.scoopUsed = 0;
    this.submerged = 0; this.depth = 0;
    this.timeSinceLaunch = 0;
    this.sinceSolid = 99;
    this.nearestSolid = 99;
    this.restingTime = 0;
    this.impacts.length = 0;
  }

  /** Standing half-height, used to place feet on a platform. */
  get standHalf(): number { return 0.95; }

  bodyAxis(out = new V3()): V3 { return this.orient.rotate(BODY_Y, out); }
  bodyRight(out = new V3()): V3 { return this.orient.rotate(BODY_X, out); }
  bodyFacing(out = new V3()): V3 { return this.orient.rotate(BODY_Z, out); }

  launch(vel: V3, spin: number, lateralSpin = 0) {
    this.vel.copy(vel);
    this.mode = 'air';
    this.timeSinceLaunch = 0;
    this.airTime = 0;
    this.launchY = this.pos.y;
    this.peakY = this.pos.y;
    this.somersault = 0; this.twist = 0; this.scoopUsed = 0;
    this.nearestSolid = 99;
    this.restingTime = 0;
    // Angular momentum about the diver's own somersault axis, converted to world.
    poseAt(this.shape, this.pose);
    _t1.set(this.pose.inertia.x * spin, 0, this.pose.inertia.z * lateralSpin);
    this.orient.rotate(_t1, this.L);
  }

  /** Recompute omega from L and the current orientation/inertia. */
  private syncOmega() {
    const I = this.pose.inertia;
    this.orient.unrotate(this.L, _t1);          // L in body frame
    this.omegaBody.set(_t1.x / I.x, _t1.y / I.y, _t1.z / I.z);
    this.orient.rotate(this.omegaBody, this.omega);
  }

  step(dt: number, ctrl: DiverControl, world: CollisionWorld) {
    // --- 1. Body shape follows the player's input at a physical rate ---
    const rate = ctrl.shape > this.shape ? 1 / TUNE.tuckTime : 1 / TUNE.openTime;
    const maxStep = rate * dt;
    const d = clamp(ctrl.shape - this.shape, -maxStep, maxStep);
    this.shape = clamp01(this.shape + d);
    poseAt(this.shape, this.pose);

    this.syncOmega();

    const speed = this.vel.len();
    const waterY = world.waterHeight(this.pos.x, this.pos.z);

    // Vertical extent of the body, for a smooth submergence fraction.
    this.bodyAxis(_axis);
    const vext = Math.abs(_axis.y) * this.pose.halfLength + this.pose.radius;
    const sub = clamp01((waterY - (this.pos.y - vext)) / (2 * vext));
    this.submerged = sub;
    this.depth = Math.max(0, waterY - this.pos.y);

    // --- 2. Linear forces (accelerations; mass is normalised to 1) ---
    const acc = _acc.set(0, -GRAVITY, 0);

    if (speed > 0.01) {
      _t1.copy(this.vel).scale(1 / speed);            // velocity direction
      const align = Math.abs(_axis.dot(_t1));         // 1 = arrow, 0 = broadside
      const area = lerp(this.pose.areaBroad, this.pose.areaSlim, align);
      const rho = lerp(AIR_RHO, WATER_RHO, sub);
      const cd = lerp(CD_AIR, CD_WATER, sub);
      const dragA = 0.5 * rho * cd * area * speed;    // per unit speed
      acc.addScaled(this.vel, -dragA);
    }
    // Buoyancy: a human is very slightly less dense than seawater, so a deep
    // entry decelerates and then floats back up. That "come up for air" beat is
    // a big part of why a clean dive feels good.
    acc.y += sub * GRAVITY * 1.06;

    // --- 3. Torques (world space, added straight into angular momentum) ---
    const torque = _torque.set(0, 0, 0);
    const I = this.pose.inertia;

    if (this.mode !== 'crashed') {
      // (a) Player scoop: specified as an angular *acceleration* so it feels the
      //     same whether tucked or extended, then converted to a torque.
      if (ctrl.pitch !== 0 && sub < 0.5) {
        _t2.set(I.x * TUNE.scoopAccel * ctrl.pitch, 0, 0);
        this.orient.rotate(_t2, _t2);
        torque.add(_t2);
        this.scoopUsed += Math.abs(ctrl.pitch) * dt;
      }
      // (b) Active axis control: a real diver fights unwanted twist/cartwheel.
      _t2.set(0, -TUNE.axisStab * I.y * this.omegaBody.y, -TUNE.axisStab * I.z * this.omegaBody.z);
      this.orient.rotate(_t2, _t2);
      torque.add(_t2);
    }

    // (c) Aerodynamic weathervane -- the heart of the whole control scheme.
    //     A body that is stretched out and moving fast gets pushed into line with
    //     the airflow, and rotational drag then settles it there. So opening out
    //     late genuinely helps you find the entry, but it costs you every bit of
    //     your rotation. Choosing that instant IS the game.
    //
    //     Both terms scale with speed, which gives the level its difficulty curve
    //     for free: from the Mast the air really does straighten you out, while
    //     off the Shelf you are on your own and have to time it yourself.
    const ext = this.pose.extension;
    if (ext > 0.01 && speed > 2.5 && sub < 0.7) {
      const q = speed / TUNE.aeroRefSpeed;
      const wet = 1 - sub / 0.7;
      _t2.copy(this.vel).scale(1 / speed);
      const sgn = _axis.dot(_t2) >= 0 ? 1 : -1;       // align whichever end leads
      _t2.scale(sgn);
      // axis = bodyAxis x flowDir; |axis| = sin(misalignment)
      _t3.set(
        _axis.y * _t2.z - _axis.z * _t2.y,
        _axis.z * _t2.x - _axis.x * _t2.z,
        _axis.x * _t2.y - _axis.y * _t2.x,
      ).scale(TUNE.alignAccel * ext * q * q * wet);
      _t3.addScaled(this.omega, -TUNE.alignDamp * ext * q * wet);
      this.alphaToTorque(_t3, _t3);
      torque.add(_t3);
    }

    // (d) Baseline air/water damping, present in every pose.
    {
      const kd = TUNE.angDrag * (0.25 + 0.75 * ext) * (speed + 2) * lerp(1, 320, sub);
      torque.addScaled(this.omega, -kd);
    }

    // --- 4. Integrate ---
    this.vel.addScaled(acc, dt);
    this.L.addScaled(torque, dt);
    this.syncOmega();
    this.orient.integrate(this.omega, dt);
    this.pos.addScaled(this.vel, dt);

    // Accumulate rotation in body terms, for scoring.
    if (this.mode === 'air' || this.mode === 'crashed') {
      this.somersault += this.omegaBody.x * dt;
      this.twist += this.omegaBody.y * dt;
      this.airTime += dt;
      this.timeSinceLaunch += dt;
      this.peakY = Math.max(this.peakY, this.pos.y);
    }

    // --- 5. Water surface crossing ---
    if ((this.mode === 'air' || this.mode === 'crashed') && sub > 0.02) {
      this.impacts.push({
        kind: 'water', speed, normalSpeed: Math.abs(this.vel.y),
        x: this.pos.x, y: waterY, z: this.pos.z, hard: 0,
      });
      if (this.mode === 'air') this.mode = 'water';
    }
    if (this.mode === 'water' && sub <= 0.001) {
      // Left the water again (a skip off the surface) -- back to falling.
      this.mode = 'air';
    }

    // --- 6. Solid collision ---
    this.resolveContacts(dt, world);
    this.sinceSolid += dt;
  }

  private resolveContacts(dt: number, world: CollisionWorld) {
    collisionSpheres(this.pose, _spheres);
    this.bodyAxis(_axis);
    let nearest = this.nearestSolid;

    for (let iter = 0; iter < 2; iter++) {
      let any = false;
      for (let i = 0; i < 3; i++) {
        const s = _spheres[i];
        const cx = this.pos.x + _axis.x * s.off;
        const cy = this.pos.y + _axis.y * s.off;
        const cz = this.pos.z + _axis.z * s.off;
        // A generous query radius on the first iteration also gives us the
        // near-miss distance used for "close call" scoring.
        if (!world.probeSphere(cx, cy, cz, s.r, _contact)) continue;
        any = true;
        const n = _c1.set(_contact.nx, _contact.ny, _contact.nz);

        // Contact point offset from centre of mass.
        const rx = _axis.x * s.off - n.x * s.r;
        const ry = _axis.y * s.off - n.y * s.r;
        const rz = _axis.z * s.off - n.z * s.r;

        // Velocity at the contact point (v + omega x r).
        const w = this.omega;
        const pvx = this.vel.x + (w.y * rz - w.z * ry);
        const pvy = this.vel.y + (w.z * rx - w.x * rz);
        const pvz = this.vel.z + (w.x * ry - w.y * rx);
        const vn = pvx * n.x + pvy * n.y + pvz * n.z;

        // Positional correction (Baumgarte-ish, no energy added).
        const push = Math.min(_contact.depth, 0.35);
        this.pos.addScaled(n, push);

        // Deep penetration means we started inside geometry (or the SDF gradient
        // is unreliable there). Push out, but never fire an impulse -- that is
        // how a solver ends up launching the body at a thousand radians a second.
        if (_contact.depth > s.r * 1.1) continue;

        if (vn < 0) {
          const impactSpeed = -vn;
          if (this.mode === 'air' && this.timeSinceLaunch > TUNE.launchGrace && impactSpeed > TUNE.crashSpeed) {
            this.mode = 'crashed';
          }
          if (impactSpeed > 0.6 && this.sinceSolid > 0.08) {
            this.impacts.push({
              kind: 'solid', speed: Math.hypot(pvx, pvy, pvz), normalSpeed: impactSpeed,
              x: cx - n.x * s.r, y: cy - n.y * s.r, z: cz - n.z * s.r, hard: _contact.hard,
            });
            this.sinceSolid = 0;
          }

          const restitution = this.mode === 'crashed' ? 0.22 : 0.0;
          const friction = this.mode === 'crashed' ? 0.45 : 0.85;

          // Effective mass along the normal for a body with inertia tensor I.
          const jn = -(1 + restitution) * vn / this.effMass(rx, ry, rz, n);
          this.applyImpulse(jn, n, rx, ry, rz);

          // Tangential friction impulse.
          const tvx = pvx - vn * n.x, tvy = pvy - vn * n.y, tvz = pvz - vn * n.z;
          const tl = Math.hypot(tvx, tvy, tvz);
          if (tl > 1e-4) {
            const t = _t1.set(tvx / tl, tvy / tl, tvz / tl);
            let jt = -tl / this.effMass(rx, ry, rz, t);
            const maxF = friction * Math.abs(jn);
            jt = clamp(jt, -maxF, maxF);
            this.applyImpulse(jt, t, rx, ry, rz);
          }
        }
        nearest = 0;
      }
      if (!any) break;
    }

    // Standing on solid ground: kill residual jitter.
    if (this.mode === 'ground') {
      this.vel.scale(Math.exp(-14 * dt));
      this.L.scale(Math.exp(-14 * dt));
    }

    // Hard caps. A crash should fling you convincingly, not into orbit.
    const sp = this.vel.len();
    if (sp > TUNE.maxSpeed) this.vel.scale(TUNE.maxSpeed / sp);
    this.syncOmega();
    const w = this.omega.len();
    if (w > TUNE.maxOmega) this.L.scale(TUNE.maxOmega / w);

    // Came to rest on rock: the dive is over even though we never reached water.
    if ((this.mode === 'crashed' || this.mode === 'air') && nearest === 0 && sp < 1.2 && this.submerged < 0.3) {
      this.restingTime += dt;
    } else if (sp > 2) {
      this.restingTime = 0;
    }

    // Numerical safety net -- never let the sim produce NaNs.
    if (!this.pos.isFinite() || !this.vel.isFinite() || !this.orient.isFinite() || !this.L.isFinite()) {
      this.vel.set(0, 0, 0); this.L.set(0, 0, 0); this.orient.identity();
      if (!this.pos.isFinite()) this.pos.set(0, 30, 0);
    }
  }

  /**
   * Convert a desired world-space angular acceleration into the torque that
   * produces it, given the current orientation and pose: tau = I_world * alpha.
   * Working in acceleration terms keeps the controls feeling identical whether
   * the diver is tucked or stretched.
   */
  private alphaToTorque(alpha: V3, out: V3): V3 {
    this.orient.unrotate(alpha, out);
    const I = this.pose.inertia;
    out.set(out.x * I.x, out.y * I.y, out.z * I.z);
    return this.orient.rotate(out, out);
  }

  /** 1 / (1/m + n . (I^-1 (r x n)) x r), with m = 1. */
  private effMass(rx: number, ry: number, rz: number, n: V3): number {
    // rxn in world, then to body, divide by I, back to world, cross with r, dot n.
    const ax = ry * n.z - rz * n.y;
    const ay = rz * n.x - rx * n.z;
    const az = rx * n.y - ry * n.x;
    _t3.set(ax, ay, az);
    this.orient.unrotate(_t3, _t3);
    const I = this.pose.inertia;
    _t3.set(_t3.x / I.x, _t3.y / I.y, _t3.z / I.z);
    this.orient.rotate(_t3, _t3);
    const bx = _t3.y * rz - _t3.z * ry;
    const by = _t3.z * rx - _t3.x * rz;
    const bz = _t3.x * ry - _t3.y * rx;
    return 1 + (bx * n.x + by * n.y + bz * n.z);
  }

  private applyImpulse(j: number, dir: V3, rx: number, ry: number, rz: number) {
    this.vel.addScaled(dir, j);
    // dL = r x (j * dir)
    this.L.x += ry * dir.z * j - rz * dir.y * j;
    this.L.y += rz * dir.x * j - rx * dir.z * j;
    this.L.z += rx * dir.y * j - ry * dir.x * j;
  }
}
