import * as THREE from 'three';
import { clamp01, lerp } from '../core/vec.ts';
import type { DiverBody } from '../sim/body.ts';

/**
 * The diver.
 *
 * A jointed rig of capsules rather than a skinned mesh: no asset pipeline here,
 * and at the distances this game is played the silhouette is what matters.
 * The silhouette is also the entire read on how the dive is going, so the poses
 * are shaped for legibility first -- a tuck must look like a ball and a layout
 * must look like a line, instantly, from any angle.
 *
 * Joints are springs rather than direct assignments. That gives the limbs a
 * little lag and overshoot for free, and lets a crash simply drop the stiffness
 * so the body goes limp and flails instead of holding a tidy pose.
 */

interface Joint {
  /** Current angle, radians. */
  a: number;
  v: number;
  target: number;
}

const j = (): Joint => ({ a: 0, v: 0, target: 0 });

/** Joint set. Angles in radians; positive folds the body forwards. */
interface PoseSet {
  hip: number; knee: number; ankle: number;
  shoulder: number; elbow: number;
  /** Sideways arm spread, for the standing/ready pose. */
  armOut: number;
  spine: number;
  head: number;
}

const P = {
  layout:  { hip: 0.00, knee: 0.02, ankle: -0.55, shoulder: 2.95, elbow: 0.04, armOut: 0.06, spine: -0.06, head: 0.10 },
  pike:    { hip: 1.85, knee: 0.06, ankle: -0.50, shoulder: 2.05, elbow: 0.12, armOut: 0.16, spine: 0.20, head: 0.35 },
  tuck:    { hip: 2.25, knee: 2.55, ankle: -0.30, shoulder: 1.10, elbow: 2.05, armOut: 0.22, spine: 0.34, head: 0.42 },
  stand:   { hip: 0.02, knee: 0.06, ankle: 0.00, shoulder: 0.10, elbow: 0.14, armOut: 0.13, spine: 0.00, head: 0.00 },
  crouch:  { hip: 0.72, knee: 1.15, ankle: 0.42, shoulder: -0.55, elbow: 0.42, armOut: 0.20, spine: 0.30, head: -0.12 },
  limp:    { hip: 0.55, knee: 0.85, ankle: -0.10, shoulder: 0.75, elbow: 0.75, armOut: 0.40, spine: 0.15, head: 0.30 },
} satisfies Record<string, PoseSet>;

function blend(a: PoseSet, b: PoseSet, t: number, out: PoseSet): PoseSet {
  out.hip = lerp(a.hip, b.hip, t); out.knee = lerp(a.knee, b.knee, t);
  out.ankle = lerp(a.ankle, b.ankle, t); out.shoulder = lerp(a.shoulder, b.shoulder, t);
  out.elbow = lerp(a.elbow, b.elbow, t); out.armOut = lerp(a.armOut, b.armOut, t);
  out.spine = lerp(a.spine, b.spine, t); out.head = lerp(a.head, b.head, t);
  return out;
}

const SKIN = 0xc98d63;
const SUIT = 0xd4541f;      // strong warm accent: readable against sea and stone
const SUIT_DARK = 0x1d2733;

function capsule(len: number, r: number, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 10);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A limb segment hanging downward from its pivot, so rotation is intuitive. */
function segment(parent: THREE.Object3D, len: number, r: number, mat: THREE.Material): THREE.Group {
  const grp = new THREE.Group();
  const c = capsule(len, r, mat);
  c.position.y = -len / 2;
  grp.add(c);
  parent.add(grp);
  return grp;
}

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

  private joints = {
    hip: j(), knee: j(), ankle: j(), shoulder: j(), elbow: j(), armOut: j(), spine: j(), head: j(),
  };
  private cur: PoseSet = { ...P.stand };
  private tgt: PoseSet = { ...P.stand };
  /** 0 = fully controlled, 1 = limp. */
  private limp = 0;
  private asym = 0;
  private t = 0;

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.62, metalness: 0.0 });
    const suit = new THREE.MeshStandardMaterial({ color: SUIT, roughness: 0.55, metalness: 0.0 });
    const dark = new THREE.MeshStandardMaterial({ color: SUIT_DARK, roughness: 0.48, metalness: 0.0 });

    this.root.add(this.pelvis);

    // Pelvis + chest, with the chest pivoting at the waist.
    const hips = capsule(0.10, 0.135, suit);
    hips.position.y = 0.02;
    this.pelvis.add(hips);

    this.chest.position.y = 0.13;
    this.pelvis.add(this.chest);
    const torso = capsule(0.30, 0.145, skin);
    torso.position.y = 0.20;
    torso.scale.set(1.06, 1, 0.82);
    this.chest.add(torso);
    const shoulders = capsule(0.16, 0.115, skin);
    shoulders.position.y = 0.385;
    shoulders.rotation.z = Math.PI / 2;
    shoulders.scale.set(1, 1, 0.85);
    this.chest.add(shoulders);

    // Head.
    this.head.position.y = 0.44;
    this.chest.add(this.head);
    const neck = capsule(0.05, 0.048, skin);
    neck.position.y = 0.03;
    this.head.add(neck);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.106, 14, 12), skin);
    skull.position.y = 0.135;
    skull.scale.set(0.92, 1.06, 1.0);
    skull.castShadow = true;
    this.head.add(skull);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.111, 12, 10), dark);
    hair.position.set(0, 0.152, -0.012);
    hair.scale.set(0.92, 0.86, 1.0);
    this.head.add(hair);

    for (const side of [-1, 1]) {
      // Legs.
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.085, -0.02, 0);
      this.pelvis.add(thigh);
      const thighMesh = capsule(0.30, 0.088, suit);
      thighMesh.position.y = -0.19;
      thigh.add(thighMesh);
      this.thighs.push(thigh);

      const shin = new THREE.Group();
      shin.position.y = -0.40;
      thigh.add(shin);
      const shinMesh = capsule(0.30, 0.066, skin);
      shinMesh.position.y = -0.185;
      shin.add(shinMesh);
      this.shins.push(shin);

      const foot = new THREE.Group();
      foot.position.y = -0.375;
      shin.add(foot);
      const footMesh = capsule(0.10, 0.048, skin);
      footMesh.position.set(0, -0.045, 0.03);
      footMesh.rotation.x = 1.15;
      foot.add(footMesh);
      this.feet.push(foot);

      // Arms.
      const ua = new THREE.Group();
      ua.position.set(side * 0.155, 0.375, 0);
      this.chest.add(ua);
      const uaMesh = capsule(0.22, 0.058, skin);
      uaMesh.position.y = -0.145;
      ua.add(uaMesh);
      this.upperArms.push(ua);

      const fa = new THREE.Group();
      fa.position.y = -0.285;
      ua.add(fa);
      const faMesh = capsule(0.21, 0.048, skin);
      faMesh.position.y = -0.135;
      fa.add(faMesh);
      const hand = capsule(0.05, 0.045, skin);
      hand.position.y = -0.27;
      fa.add(hand);
      this.foreArms.push(fa);
    }

    this.root.name = 'diver';
  }

  /** Where the head is in world space -- used for the motion trail. */
  headWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.head.getWorldPosition(out);
  }

  setPose(phase: 'ground' | 'charge' | 'air' | 'crashed', shape: number, charge: number) {
    if (phase === 'ground') { Object.assign(this.tgt, P.stand); return; }
    if (phase === 'charge') { blend(P.stand, P.crouch, clamp01(charge), this.tgt); return; }
    if (phase === 'crashed') { Object.assign(this.tgt, P.limp); return; }
    // In the air the pose tracks the physical shape scalar exactly, so what the
    // player sees is literally what the inertia tensor is doing.
    const s = clamp01(shape);
    if (s < 0.5) blend(P.layout, P.pike, s * 2, this.tgt);
    else blend(P.pike, P.tuck, (s - 0.5) * 2, this.tgt);
  }

  update(dt: number, body: DiverBody, phase: 'ground' | 'charge' | 'air' | 'crashed') {
    this.t += dt;
    this.setPose(phase, body.shape, 0);

    const wantLimp = phase === 'crashed' ? 1 : 0;
    this.limp += (wantLimp - this.limp) * Math.min(1, dt * (wantLimp ? 9 : 3));

    // Spring the joints toward the target. Going limp mostly means turning the
    // stiffness down; the same solver then produces the flail.
    const stiff = lerp(255, 26, this.limp);
    const damp = lerp(29, 6.5, this.limp);
    const keys = Object.keys(this.joints) as (keyof typeof this.joints)[];
    for (const k of keys) {
      const jt = this.joints[k];
      jt.target = (this.tgt as any)[k];
      const acc = (jt.target - jt.a) * stiff - jt.v * damp;
      jt.v += acc * dt;
      // Spin makes the limbs trail, which is most of what sells the rotation.
      if (this.limp > 0.01) jt.v += Math.sin(this.t * (7.3 + keys.indexOf(k)) ) * this.limp * dt * 5.5;
      jt.a += jt.v * dt;
      (this.cur as any)[k] = jt.a;
    }

    // A touch of asymmetry so the diver never looks like a mannequin.
    this.asym = Math.sin(this.t * 2.1) * 0.03 + this.limp * Math.sin(this.t * 5.7) * 0.22;

    const c = this.cur;
    this.chest.rotation.x = c.spine;
    this.head.rotation.x = c.head;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const a = this.asym * side;
      this.thighs[i].rotation.set(c.hip + a, 0, side * -c.armOut * 0.55);
      this.shins[i].rotation.x = -c.knee - a * 0.5;
      this.feet[i].rotation.x = c.ankle;
      // Shoulder swings the arm from alongside the body up past the head.
      this.upperArms[i].rotation.set(-c.shoulder - a * 0.8, 0, side * -c.armOut);
      this.foreArms[i].rotation.x = c.elbow + a * 0.6;
    }
  }

  syncTransform(body: DiverBody) {
    this.root.position.set(body.pos.x, body.pos.y, body.pos.z);
    this.root.quaternion.set(body.orient.x, body.orient.y, body.orient.z, body.orient.w);
  }
}
