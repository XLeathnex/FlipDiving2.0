import { V3, Quat, clamp, clamp01, lerp } from '../core/vec.ts';
import { poseAt, collisionSpheres, newPose, trickById, BODY_MASS, type PoseData, type Trick } from './tricks.ts';

export const GRAVITY = 9.80665;
const EARTH_RADIUS = 6_371_000;
const SEA_LEVEL_AIR_RHO = 1.225;
const ATMOSPHERE_SCALE_HEIGHT = 8500;
const WATER_RHO = 1025;

/** Real-enough environmental functions for the 0-500 m playable altitude range. */
export function gravityAtAltitude(y: number): number {
  const h = Math.max(-100, y);
  const r = EARTH_RADIUS / (EARTH_RADIUS + h);
  return GRAVITY * r * r;
}
export function airDensityAtAltitude(y: number): number {
  return SEA_LEVEL_AIR_RHO * Math.exp(-Math.max(0, y) / ATMOSPHERE_SCALE_HEIGHT);
}

export const TUNE = {
  tuckTime: 0.20,
  openTime: 0.30,
  scoopAccel: 2.2,
  scoopBudget: 2.3,
  alignAccel: 3.2,
  alignDamp: 2.6,
  aeroRefSpeed: 20,
  axisStab: 2.4,
  angDrag: 1.2e-3,
  /** Numerical guard only; normal human terminal velocities are far below this. */
  maxOmega: 30,
  maxSpeed: 180,
  crashSpeed: 1.8,
  launchGrace: 0.10,
};

export type BodyMode = 'ground' | 'air' | 'water' | 'crashed';

export interface Contact {
  nx: number; ny: number; nz: number;
  depth: number;
  hard: number;
}
export interface CollisionWorld {
  probeSphere(cx: number, cy: number, cz: number, r: number, out: Contact): boolean;
  waterHeight(x: number, z: number): number;
}
export interface DiverControl {
  shape: number;
  pitch: number;
}
export interface ImpactEvent {
  kind: 'solid' | 'water' | 'churn';
  speed: number;
  normalSpeed: number;
  x: number; y: number; z: number;
  hard: number;
  area: number;
  displace: number;
  slam: number;
  align: number;
  vx: number; vy: number; vz: number;
}

const _acc = new V3(), _torque = new V3(), _axis = new V3();
const _t1 = new V3(), _t2 = new V3(), _t3 = new V3();
const _c1 = new V3();
const _spheres = [{ off: 0, r: 0 }, { off: 0, r: 0 }, { off: 0, r: 0 }];
const _contact: Contact = { nx: 0, ny: 1, nz: 0, depth: 0, hard: 1 };
const BODY_Y = new V3(0, 1, 0);
const BODY_X = new V3(1, 0, 0);
const BODY_Z = new V3(0, 0, 1);

export class DiverBody {
  pos = new V3();
  vel = new V3();
  orient = new Quat();
  /** World-space angular momentum per unit mass. Conserved except real torques. */
  L = new V3();

  shape = 0.32;
  shapeTarget = 0.32;
  trick: Trick = trickById('front-tuck');
  pose: PoseData = newPose();
  mode: BodyMode = 'ground';
  omega = new V3();
  omegaBody = new V3();

  airTime = 0;
  launchY = 0;
  peakY = 0;
  somersault = 0;
  twist = 0;
  scoopUsed = 0;
  scoopDelta = 0;
  submerged = 0;
  depth = 0;
  impacts: ImpactEvent[] = [];
  sinceSolid = 99;
  nearestSolid = 99;
  restingTime = 0;
  projArea = 0.1;
  displaceRate = 0;

  private timeSinceLaunch = 0;
  private wasSubmerged = 0;
  private churn = 0;

  reset(x: number, y: number, z: number, facing: number) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.L.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.omegaBody.set(0, 0, 0);
    this.shape = this.shapeTarget = 0;
    poseAt(this.shape, this.trick, this.pose);
    this.orient.setAxisAngle(new V3(0, 1, 0), facing);
    this.mode = 'ground';
    this.airTime = 0; this.launchY = y; this.peakY = y;
    this.somersault = 0; this.twist = 0; this.scoopUsed = 0; this.scoopDelta = 0;
    this.submerged = 0; this.depth = 0;
    this.timeSinceLaunch = 0; this.sinceSolid = 99; this.nearestSolid = 99; this.restingTime = 0;
    this.wasSubmerged = 0; this.churn = 0; this.impacts.length = 0;
  }

  get standHalf(): number { return 0.95; }
  bodyAxis(out = new V3()): V3 { return this.orient.rotate(BODY_Y, out); }
  bodyRight(out = new V3()): V3 { return this.orient.rotate(BODY_X, out); }
  bodyFacing(out = new V3()): V3 { return this.orient.rotate(BODY_Z, out); }

  launch(vel: V3, spinL: number, lateralL = 0) {
    this.vel.copy(vel);
    this.mode = 'air';
    this.timeSinceLaunch = 0; this.airTime = 0;
    this.launchY = this.pos.y; this.peakY = this.pos.y;
    this.somersault = 0; this.twist = 0; this.scoopUsed = 0; this.scoopDelta = 0;
    this.nearestSolid = 99; this.restingTime = 0;
    poseAt(this.shape, this.trick, this.pose);
    _t1.set(spinL, 0, lateralL);
    this.orient.rotate(_t1, this.L);
  }

  private syncOmega() {
    const I = this.pose.inertia;
    this.orient.unrotate(this.L, _t1);
    this.omegaBody.set(_t1.x / I.x, _t1.y / I.y, _t1.z / I.z);
    this.orient.rotate(this.omegaBody, this.omega);
  }

  step(dt: number, ctrl: DiverControl, world: CollisionWorld) {
    const rate = ctrl.shape > this.shape ? 1 / TUNE.tuckTime : 1 / TUNE.openTime;
    const maxStep = rate * dt;
    this.shape = clamp01(this.shape + clamp(ctrl.shape - this.shape, -maxStep, maxStep));
    poseAt(this.shape, this.trick, this.pose);
    this.syncOmega();

    const speed = this.vel.len();
    const waterY = world.waterHeight(this.pos.x, this.pos.z);
    this.bodyAxis(_axis);
    const vext = Math.abs(_axis.y) * this.pose.halfLength + this.pose.radius;
    const sub = clamp01((waterY - (this.pos.y - vext)) / (2 * vext));
    this.submerged = sub;
    this.depth = Math.max(0, waterY - this.pos.y);

    const g = gravityAtAltitude(this.pos.y);
    const acc = _acc.set(0, -g, 0);

    let align = 1;
    if (speed > 0.01) {
      _t1.copy(this.vel).scale(1 / speed);
      align = Math.abs(_axis.dot(_t1));
      const areaPerMass = lerp(this.pose.areaBroad, this.pose.areaSlim, align);
      const airRho = airDensityAtAltitude(this.pos.y);
      const rho = lerp(airRho, WATER_RHO, sub);
      // Human Cd varies with posture. A streamlined long-axis entry is lower,
      // broadside spread positions are higher. Water uses a larger Cd.
      const airCd = lerp(1.05, 0.72, align) * lerp(1.0, 0.92, this.pose.extension);
      const cd = lerp(airCd, 1.15, sub);
      // Fd/m = 0.5*rho*Cd*(A/m)*v^2. Multiplying vel by speed gives v^2 directionally.
      const dragA = 0.5 * rho * cd * areaPerMass * speed;
      acc.addScaled(this.vel, -dragA);
      this.projArea = areaPerMass * BODY_MASS;
      this.displaceRate = this.projArea * speed;
    }

    // Human average density is slightly below seawater. Buoyancy grows with submerged fraction.
    acc.y += sub * g * 1.06;

    const torque = _torque.set(0, 0, 0);
    const I = this.pose.inertia;
    if (this.mode !== 'crashed') {
      if (ctrl.pitch !== 0 && sub < 0.5) {
        const spent = this.scoopDelta * Math.sign(ctrl.pitch);
        const gain = spent <= 0 ? 1 : clamp01(1 - spent / TUNE.scoopBudget);
        const alpha = TUNE.scoopAccel * ctrl.pitch * gain;
        this.scoopDelta += alpha * dt;
        _t2.set(I.x * alpha, 0, 0);
        this.orient.rotate(_t2, _t2);
        torque.add(_t2);
        this.scoopUsed += Math.abs(ctrl.pitch) * gain * dt;
      }
      _t2.set(0, -TUNE.axisStab * I.y * this.omegaBody.y, -TUNE.axisStab * I.z * this.omegaBody.z);
      this.orient.rotate(_t2, _t2);
      torque.add(_t2);
    }

    const ext = this.pose.extension;
    if (ext > 0.01 && speed > 2.5 && sub < 0.7) {
      const q = speed / TUNE.aeroRefSpeed;
      const densityScale = airDensityAtAltitude(this.pos.y) / SEA_LEVEL_AIR_RHO;
      const wet = 1 - sub / 0.7;
      _t2.copy(this.vel).scale(1 / speed);
      const sgn = _axis.dot(_t2) >= 0 ? 1 : -1;
      _t2.scale(sgn);
      _t3.set(
        _axis.y * _t2.z - _axis.z * _t2.y,
        _axis.z * _t2.x - _axis.x * _t2.z,
        _axis.x * _t2.y - _axis.y * _t2.x,
      ).scale(TUNE.alignAccel * ext * q * q * wet * densityScale);
      _t3.addScaled(this.omega, -TUNE.alignDamp * ext * q * wet * densityScale);
      this.alphaToTorque(_t3, _t3);
      torque.add(_t3);
    }

    const kd = TUNE.angDrag * (0.25 + 0.75 * ext) * (speed + 2) * lerp(1, 320, sub);
    torque.addScaled(this.omega, -kd);

    this.vel.addScaled(acc, dt);
    this.L.addScaled(torque, dt);
    this.syncOmega();
    this.orient.integrate(this.omega, dt);
    this.pos.addScaled(this.vel, dt);

    if (this.mode === 'air' || this.mode === 'crashed') {
      this.somersault += this.omegaBody.x * dt;
      this.twist += this.omegaBody.y * dt;
      this.airTime += dt;
      this.timeSinceLaunch += dt;
      this.peakY = Math.max(this.peakY, this.pos.y);
    }

    if ((this.mode === 'air' || this.mode === 'crashed') && sub > 0.02 && this.wasSubmerged <= 0.02) {
      this.impacts.push({
        kind: 'water', speed, normalSpeed: Math.abs(this.vel.y),
        x: this.pos.x, y: waterY, z: this.pos.z, hard: 0,
        area: this.projArea, displace: this.projArea * speed, slam: this.projArea * speed * speed,
        align, vx: this.vel.x, vy: this.vel.y, vz: this.vel.z,
      });
      if (this.mode === 'air') this.mode = 'water';
    } else if (sub > 0.02 && sub < 0.99 && speed > 3.5) {
      this.churn += this.projArea * speed * dt;
      if (this.churn > 0.55) {
        this.churn = 0;
        this.impacts.push({
          kind: 'churn', speed, normalSpeed: Math.abs(this.vel.y),
          x: this.pos.x, y: waterY, z: this.pos.z, hard: 0,
          area: this.projArea, displace: this.projArea * speed, slam: this.projArea * speed * speed,
          align, vx: this.vel.x, vy: this.vel.y, vz: this.vel.z,
        });
      }
    }
    this.wasSubmerged = sub;
    if (this.mode === 'water' && sub <= 0.001) this.mode = 'air';

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
        if (!world.probeSphere(cx, cy, cz, s.r, _contact)) continue;
        any = true;
        const n = _c1.set(_contact.nx, _contact.ny, _contact.nz);

        const rx = _axis.x * s.off - n.x * s.r;
        const ry = _axis.y * s.off - n.y * s.r;
        const rz = _axis.z * s.off - n.z * s.r;
        const w = this.omega;
        const pvx = this.vel.x + (w.y * rz - w.z * ry);
        const pvy = this.vel.y + (w.z * rx - w.x * rz);
        const pvz = this.vel.z + (w.x * ry - w.y * rx);
        const vn = pvx * n.x + pvy * n.y + pvz * n.z;

        this.pos.addScaled(n, Math.min(_contact.depth, 0.35));
        if (_contact.depth > s.r * 1.1) continue;

        if (vn < 0) {
          const impactSpeed = -vn;
          if (this.mode === 'air' && this.timeSinceLaunch > TUNE.launchGrace && impactSpeed > TUNE.crashSpeed) this.mode = 'crashed';
          if (impactSpeed > 0.6 && this.sinceSolid > 0.08) {
            this.impacts.push({
              kind: 'solid', speed: Math.hypot(pvx, pvy, pvz), normalSpeed: impactSpeed,
              x: cx - n.x * s.r, y: cy - n.y * s.r, z: cz - n.z * s.r, hard: _contact.hard,
              area: this.projArea, displace: 0, slam: 0, align: 1,
              vx: this.vel.x, vy: this.vel.y, vz: this.vel.z,
            });
            this.sinceSolid = 0;
          }

          const restitution = this.mode === 'crashed' ? 0.22 : 0;
          const friction = this.mode === 'crashed' ? 0.45 : 0.85;
          const jn = -(1 + restitution) * vn / this.effMass(rx, ry, rz, n);
          this.applyImpulse(jn, n, rx, ry, rz);

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

    if (this.mode === 'ground') {
      this.vel.scale(Math.exp(-14 * dt));
      this.L.scale(Math.exp(-14 * dt));
    }

    const sp = this.vel.len();
    if (sp > TUNE.maxSpeed) this.vel.scale(TUNE.maxSpeed / sp);
    this.syncOmega();
    const w = this.omega.len();
    if (w > TUNE.maxOmega) this.L.scale(TUNE.maxOmega / w);

    if ((this.mode === 'crashed' || this.mode === 'air') && nearest === 0 && sp < 1.2 && this.submerged < 0.3) this.restingTime += dt;
    else if (sp > 2) this.restingTime = 0;

    if (!this.pos.isFinite() || !this.vel.isFinite() || !this.orient.isFinite() || !this.L.isFinite()) {
      this.vel.set(0, 0, 0); this.L.set(0, 0, 0); this.orient.identity();
      if (!this.pos.isFinite()) this.pos.set(0, 30, 0);
    }
  }

  private alphaToTorque(alpha: V3, out: V3): V3 {
    this.orient.unrotate(alpha, out);
    const I = this.pose.inertia;
    out.set(out.x * I.x, out.y * I.y, out.z * I.z);
    return this.orient.rotate(out, out);
  }

  private effMass(rx: number, ry: number, rz: number, n: V3): number {
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
    this.L.x += ry * dir.z * j - rz * dir.y * j;
    this.L.y += rz * dir.x * j - rx * dir.z * j;
    this.L.z += rx * dir.y * j - ry * dir.x * j;
  }
}
