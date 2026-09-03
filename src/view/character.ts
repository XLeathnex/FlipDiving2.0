import * as THREE from 'three';
import { V3, clamp, clamp01, lerp } from '../core/vec.ts';
import type { DiverBody } from '../sim/body.ts';
import type { Trick } from '../sim/tricks.ts';

/**
 * The diver.
 *
 * A jointed rig of capsules with spheres at the joints, driven by springs.
 *
 * Sign conventions, because getting these wrong produces a body that folds
 * backwards and reads as a broken puppet. Body frame is +Y up, +Z forward
 * (chest), +X to the diver's right, and every limb hangs along -Y at rest:
 *
 *   hip flexion   knee toward chest  -> thigh.rotation.x    = -hip
 *   knee flexion  heel toward seat   -> shin.rotation.x     = +knee
 *   shoulder      side -> front -> overhead -> upperArm.x   = -shoulder
 *   elbow flexion hand toward shoulder -> forearm.x         = -elbow
 *   trunk flexion chest toward knees -> chest.rotation.x    = +spine
 *   abduction     limb out sideways  -> rotation.z          = side * out
 *
 * The limbs point down and the trunk points up, which is why their flexion
 * signs are opposite. That asymmetry is the whole trap.
 */

interface Joint { a: number; v: number; target: number }
const j = (): Joint => ({ a: 0, v: 0, target: 0 });
const _axis = new V3();
const _upAxis = new THREE.Vector3(0, 1, 0);

interface PoseSet {
  hip: number; knee: number; ankle: number;
  shoulder: number; elbow: number;
  /** Sideways spread, arms and legs separately. */
  armOut: number; legOut: number;
  spine: number; head: number;
}

const POSES: Record<string, PoseSet> = {
  stand:   { hip: 0.02, knee: 0.05, ankle: 0.00, shoulder: 0.12, elbow: 0.16, armOut: 0.12, legOut: 0.04, spine: 0.00, head: 0.00 },
  crouch:  { hip: 0.78, knee: 1.30, ankle: 0.48, shoulder: -0.62, elbow: 0.40, armOut: 0.20, legOut: 0.07, spine: 0.38, head: -0.12 },
  // Two layouts: arms overhead to make the hole for a head-first entry, arms
  // locked at the sides for a feet-first one. Both are correct form.
  layout:  { hip: 0.00, knee: 0.02, ankle: -1.05, shoulder: 2.95, elbow: 0.05, armOut: 0.05, legOut: 0.02, spine: -0.05, head: 0.10 },
  layoutFeet: { hip: 0.00, knee: 0.02, ankle: -1.10, shoulder: 0.08, elbow: 0.06, armOut: 0.05, legOut: 0.02, spine: -0.02, head: -0.04 },
  limp:    { hip: 0.55, knee: 0.90, ankle: -0.20, shoulder: 0.80, elbow: 0.70, armOut: 0.45, legOut: 0.30, spine: 0.12, head: 0.28 },

  // --- one per trick ---
  tuck:    { hip: 2.30, knee: 2.55, ankle: -0.25, shoulder: 1.15, elbow: 2.10, armOut: 0.30, legOut: 0.18, spine: 0.38, head: 0.40 },
  pike:    { hip: 1.95, knee: 0.06, ankle: -0.90, shoulder: 1.78, elbow: 0.18, armOut: 0.14, legOut: 0.05, spine: 0.22, head: 0.30 },
  pencil:  { hip: 0.00, knee: 0.00, ankle: -1.15, shoulder: 3.05, elbow: 0.02, armOut: 0.02, legOut: 0.00, spine: -0.02, head: 0.06 },
  star:    { hip: 0.34, knee: 0.05, ankle: -0.45, shoulder: 1.88, elbow: 0.08, armOut: 1.18, legOut: 0.52, spine: 0.02, head: 0.06 },
  twister: { hip: 0.02, knee: 0.02, ankle: -0.70, shoulder: 0.30, elbow: 1.35, armOut: 0.02, legOut: 0.00, spine: 0.02, head: 0.02 },
  bomb:    { hip: 2.38, knee: 2.72, ankle: -0.15, shoulder: 1.02, elbow: 2.45, armOut: 0.55, legOut: 0.44, spine: 0.44, head: 0.46 },
  manu:    { hip: 2.10, knee: 0.45, ankle: -0.55, shoulder: 1.55, elbow: 0.58, armOut: 0.24, legOut: 0.09, spine: -0.30, head: 0.24 },
  candle:  { hip: 0.10, knee: 0.55, ankle: 0.10, shoulder: 0.35, elbow: 1.55, armOut: 0.04, legOut: 0.02, spine: 0.05, head: 0.00 },
  watermelon: { hip: 0.15, knee: 0.08, ankle: -0.30, shoulder: 1.95, elbow: 0.05, armOut: 1.35, legOut: 0.85, spine: 0.05, head: 0.05 },
};

const KEYS = ['hip', 'knee', 'ankle', 'shoulder', 'elbow', 'armOut', 'legOut', 'spine', 'head'] as const;

function blend(a: PoseSet, b: PoseSet, t: number, out: PoseSet): PoseSet {
  for (const k of KEYS) out[k] = lerp(a[k], b[k], t);
  return out;
}

const SKIN = 0xd39a70;
const TRUNKS = 0xe2381c;
const TRUNKS_TRIM = 0xf4ede2;
const HAIR = 0x2b1c12;
const EYE = 0x1a1410;

export class Character {
  root = new THREE.Group();
  private pelvis = new THREE.Group();
  private chest = new THREE.Group();
  private head = new THREE.Group();
  private thighs: THREE.Group[] = [];
  private shins: THREE.Group[] = [];
  private feet: THREE.Group[] = [];
  private upperArms: THREE.Group[] = [];
  private foreArms: THREE.Group[] = [];

  private joints: Record<string, Joint> = Object.fromEntries(KEYS.map((k) => [k, j()]));
  private cur: PoseSet = { ...POSES.stand };
  private tgt: PoseSet = { ...POSES.stand };
  private lay: PoseSet = { ...POSES.layout };
  private limp = 0;
  private asym = 0;
  private t = 0;
  private leadSmooth = 1;
  private walkPhase = 0;
  private walkHipB = 0;

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.55 });
    const trunks = new THREE.MeshStandardMaterial({ color: TRUNKS, roughness: 0.58 });
    const trim = new THREE.MeshStandardMaterial({ color: TRUNKS_TRIM, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: HAIR, roughness: 0.5 });
    const eye = new THREE.MeshStandardMaterial({ color: EYE, roughness: 0.35 });

    /** Capsule of the given length, hanging downward from y = 0. */
    const limb = (parent: THREE.Object3D, len: number, r: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
      m.position.y = -len / 2;
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    /** A sphere at a pivot, so the joint reads as flesh and not a gap. */
    const knuckle = (parent: THREE.Object3D, r: number, mat: THREE.Material, y = 0) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
      m.position.y = y;
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    this.root.add(this.pelvis);

    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.140, 0.11, 4, 12), trunks);
    hips.position.y = 0.02;
    hips.scale.set(1.0, 1.0, 0.86);
    hips.castShadow = true;
    this.pelvis.add(hips);
    const waistband = new THREE.Mesh(new THREE.TorusGeometry(0.142, 0.016, 6, 16), trim);
    waistband.position.y = 0.10;
    waistband.rotation.x = Math.PI / 2;
    waistband.scale.set(1.0, 1.0, 0.86);
    this.pelvis.add(waistband);

    this.chest.position.y = 0.13;
    this.pelvis.add(this.chest);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.158, 0.30, 4, 12), skin);
    torso.position.y = 0.20;
    torso.scale.set(1.10, 1, 0.86);
    torso.castShadow = true; torso.receiveShadow = true;
    this.chest.add(torso);
    const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.124, 0.19, 4, 10), skin);
    shoulders.position.y = 0.385;
    shoulders.rotation.z = Math.PI / 2;
    shoulders.scale.set(1, 1, 0.85);
    shoulders.castShadow = true;
    this.chest.add(shoulders);

    this.head.position.y = 0.44;
    this.chest.add(this.head);
    limb(this.head, 0.06, 0.05, skin);
    const skull = knuckle(this.head, 0.108, skin, 0.135);
    skull.scale.set(0.92, 1.06, 1.0);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.113, 12, 10), dark);
    hair.position.set(0, 0.152, -0.012);
    hair.scale.set(0.92, 0.86, 1.0);
    this.head.add(hair);

    // A simple face reads far better up close than a blank ball, for the cost
    // of two spheres. Positioned on the skull's front (+Z) surface.
    for (const side of [-1, 1]) {
      const eyeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), eye);
      eyeMesh.position.set(side * 0.040, 0.148, 0.096);
      this.head.add(eyeMesh);
    }

    for (const side of [-1, 1]) {
      // --- leg ---
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.085, -0.03, 0);
      this.pelvis.add(thigh);
      knuckle(thigh, 0.093, trunks);
      limb(thigh, 0.30, 0.090, trunks);
      this.thighs.push(thigh);

      const shin = new THREE.Group();
      shin.position.y = -0.40;
      thigh.add(shin);
      knuckle(shin, 0.076, skin);
      limb(shin, 0.30, 0.068, skin);
      this.shins.push(shin);

      const foot = new THREE.Group();
      foot.position.y = -0.375;
      shin.add(foot);
      const footMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.050, 0.11, 3, 8), skin);
      footMesh.position.set(0, -0.048, 0.030);
      footMesh.rotation.x = 1.20;
      footMesh.castShadow = true;
      foot.add(footMesh);
      this.feet.push(foot);

      // --- arm ---
      const ua = new THREE.Group();
      ua.position.set(side * 0.158, 0.375, 0);
      this.chest.add(ua);
      knuckle(ua, 0.070, skin);
      limb(ua, 0.22, 0.064, skin);
      this.upperArms.push(ua);

      const fa = new THREE.Group();
      fa.position.y = -0.285;
      ua.add(fa);
      knuckle(fa, 0.054, skin);
      limb(fa, 0.21, 0.050, skin);
      const hand = new THREE.Mesh(new THREE.CapsuleGeometry(0.046, 0.06, 3, 8), skin);
      hand.position.y = -0.272;
      hand.castShadow = true;
      fa.add(hand);
      this.foreArms.push(fa);
    }

    this.root.name = 'diver';
  }

  headWorld(out: THREE.Vector3): THREE.Vector3 { return this.head.getWorldPosition(out); }

  private setPose(phase: 'ground' | 'charge' | 'air' | 'crashed', shape: number, charge: number, lead: number, trick: Trick) {
    if (phase === 'ground') { Object.assign(this.tgt, POSES.stand); return; }
    if (phase === 'charge') { blend(POSES.stand, POSES.crouch, clamp01(charge), this.tgt); return; }
    if (phase === 'crashed') { Object.assign(this.tgt, POSES.limp); return; }
    // In the air the pose tracks the physical shape scalar exactly, so what the
    // player sees is literally what the inertia tensor is doing.
    blend(POSES.layoutFeet, POSES.layout, clamp01(lead * 0.5 + 0.5), this.lay);
    blend(this.lay, POSES[trick.id] ?? POSES.tuck, clamp01(shape), this.tgt);
  }

  update(dt: number, body: DiverBody, phase: 'ground' | 'charge' | 'air' | 'crashed', charge: number) {
    this.t += dt;

    // Which end goes in first, smoothed so the arms do not snap around as the
    // body passes through horizontal.
    const speed = body.vel.len();
    let lead = 1;
    if (speed > 3) {
      body.bodyAxis(_axis);
      lead = clamp((_axis.x * body.vel.x + _axis.y * body.vel.y + _axis.z * body.vel.z) / speed * 2.2, -1, 1);
    }
    this.leadSmooth += (lead - this.leadSmooth) * Math.min(1, dt * 3.2);
    this.setPose(phase, body.shape, charge, this.leadSmooth, body.trick);
    this.applySprings(dt, phase === 'crashed' ? 1 : 0);
  }

  /**
   * On-foot pose: standing, walking or crouching to load a jump. No DiverBody
   * exists yet at this point in the state machine -- the rigid body only takes
   * over at the instant of launch -- so this drives the same rig from the
   * walker instead, with a simple procedural gait cycle standing in for real
   * root motion. It does not need to be more than legible at the distances a
   * third-person camera actually shows a pair of legs.
   */
  updateOnFoot(dt: number, gait: number, charging: boolean, charge: number) {
    this.t += dt;
    this.walkPhase += dt * (2.4 + gait * 4.2);

    if (charging) {
      blend(POSES.stand, POSES.crouch, clamp01(charge), this.tgt);
    } else {
      Object.assign(this.tgt, POSES.stand);
      const swing = Math.sin(this.walkPhase) * gait;
      const swingB = Math.sin(this.walkPhase + Math.PI) * gait;
      this.tgt.hip += swing * 0.62;
      this.tgt.shoulder -= swing * 0.42;
      this.walkHipB = swingB;
    }
    this.applySprings(dt, 0);

    // The walk cycle needs the two legs and two arms out of phase with each
    // other, which the shared symmetric spring loop does not know how to do on
    // its own -- so nudge the trailing leg/arm here, after the springs settle.
    if (!charging && gait > 0.02) {
      const swingB = this.walkHipB * 0.62;
      this.thighs[1].rotation.x = -(this.cur.hip - Math.sin(this.walkPhase) * 0.62 + swingB);
      this.shins[1].rotation.x = Math.max(0, -swingB) * 1.3;
      this.upperArms[0].rotation.x = -(this.cur.shoulder + swingB * 0.68);
      this.upperArms[1].rotation.x = -(this.cur.shoulder - swingB * 0.68);
    }
  }

  private applySprings(dt: number, wantLimp: number) {
    this.limp += (wantLimp - this.limp) * Math.min(1, dt * (wantLimp ? 9 : 3));

    // Spring the joints toward the target. Going limp mostly means turning the
    // stiffness down; the same solver then produces the flail.
    const stiff = lerp(255, 26, this.limp);
    const damp = lerp(29, 6.5, this.limp);
    for (let i = 0; i < KEYS.length; i++) {
      const k = KEYS[i];
      const jt = this.joints[k];
      jt.target = this.tgt[k];
      jt.v += ((jt.target - jt.a) * stiff - jt.v * damp) * dt;
      if (this.limp > 0.01) jt.v += Math.sin(this.t * (7.3 + i)) * this.limp * dt * 5.5;
      jt.a += jt.v * dt;
      this.cur[k] = jt.a;
    }

    // A touch of asymmetry so the diver never looks like a mannequin.
    this.asym = Math.sin(this.t * 2.1) * 0.03 + this.limp * Math.sin(this.t * 5.7) * 0.22;

    const c = this.cur;
    this.chest.rotation.x = c.spine;
    this.head.rotation.x = c.head;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const a = this.asym * side;
      this.thighs[i].rotation.set(-(c.hip + a), 0, side * (c.legOut + Math.abs(a) * 0.3));
      this.shins[i].rotation.x = c.knee + a * 0.5;
      this.feet[i].rotation.x = c.ankle;
      this.upperArms[i].rotation.set(-(c.shoulder + a * 0.8), 0, side * c.armOut);
      this.foreArms[i].rotation.x = -(c.elbow + a * 0.6);
    }
  }

  syncTransform(body: DiverBody) {
    this.root.position.set(body.pos.x, body.pos.y, body.pos.z);
    this.root.quaternion.set(body.orient.x, body.orient.y, body.orient.z, body.orient.w);
  }

  /** Position and face the rig from the walk controller instead of the body. */
  syncFromWalker(x: number, y: number, z: number, yaw: number) {
    this.root.position.set(x, y, z);
    // Walker yaw: 0 = +X. The character model's own forward is +Z, so it needs
    // the quarter-turn correction the dive path gets for free from the body's
    // own orientation.
    this.root.quaternion.setFromAxisAngle(_upAxis, -yaw + Math.PI / 2);
  }
}
