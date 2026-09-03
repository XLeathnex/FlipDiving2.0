import { V3, clamp01, lerp } from '../core/vec.ts';

/**
 * Air tricks.
 *
 * The body-shape control is still one scalar -- 0 is a straight layout, 1 is
 * fully committed -- but WHAT "fully committed" means is now selectable. A tuck
 * is a fast-spinning ball; a star is a slow, draggy spread; a manu is a folded
 * V that goes in seat-first and moves a huge amount of water.
 *
 * Every number here is physical rather than cosmetic. The inertia decides how
 * fast the shape rotates, the areas decide how it falls and how hard it hits,
 * and the splash model reads the same areas back out -- so a manu makes a
 * bigger splash than a pike because it genuinely presents more of itself to the
 * water, not because it is flagged as "the splashy one".
 */

export type Intent = 'dive' | 'bomb';

export interface Trick {
  id: string;
  name: string;
  /** Single line shown under the trick name. */
  blurb: string;
  /** How the entry is judged: cleanliness, or how much water you move. */
  intent: Intent;
  /** Body-frame principal moments of inertia at full commitment (m^2/kg). */
  inertia: [number, number, number];
  /** Half-length of the long axis, and cross-section radius, at full commitment. */
  halfLength: number;
  radius: number;
  /** Aerodynamic extension at full commitment. 0 = no weathervane at all. */
  extension: number;
  /** Drag area per unit mass, broadside and streamlined, at full commitment. */
  areaBroad: number;
  areaSlim: number;
  /** Rotation-scoring multiplier. Harder shapes pay more per somersault. */
  difficulty: number;
}

/** Straight, arms overhead. Shape 0 for every trick. */
export const LAYOUT = {
  inertia: [0.1930, 0.0143, 0.2000] as [number, number, number],
  halfLength: 1.15,
  radius: 0.19,
  extension: 1.0,
  areaBroad: 0.0097,
  areaSlim: 0.0013,
};

export const TRICKS: Trick[] = [
  {
    id: 'tuck', name: 'Tuck', blurb: 'Knees to chest. Spins fastest, opens quickest.',
    intent: 'dive',
    inertia: [0.0529, 0.0357, 0.0580], halfLength: 0.42, radius: 0.34,
    extension: 0.0, areaBroad: 0.0060, areaSlim: 0.0042, difficulty: 1.0,
  },
  {
    id: 'pike', name: 'Pike', blurb: 'Folded at the hips, legs dead straight. Worth more.',
    intent: 'dive',
    inertia: [0.0929, 0.0300, 0.1150], halfLength: 0.72, radius: 0.26,
    extension: 0.22, areaBroad: 0.0078, areaSlim: 0.0026, difficulty: 1.28,
  },
  {
    id: 'star', name: 'Star', blurb: 'Spread wide. Barely rotates, and the air really grabs you.',
    intent: 'dive',
    inertia: [0.2300, 0.0900, 0.2400], halfLength: 0.95, radius: 0.30,
    extension: 0.52, areaBroad: 0.0132, areaSlim: 0.0072, difficulty: 1.55,
  },
  {
    id: 'bomb', name: 'Cannonball', blurb: 'Hug your knees and land on it. Judged on the splash.',
    intent: 'bomb',
    inertia: [0.0620, 0.0400, 0.0660], halfLength: 0.44, radius: 0.38,
    extension: 0.0, areaBroad: 0.0090, areaSlim: 0.0070, difficulty: 0.85,
  },
  {
    id: 'manu', name: 'Manu', blurb: 'A folded V, in seat first. Moves the most water of anything.',
    intent: 'bomb',
    inertia: [0.0820, 0.0340, 0.0980], halfLength: 0.62, radius: 0.31,
    extension: 0.10, areaBroad: 0.0122, areaSlim: 0.0076, difficulty: 1.0,
  },
];

export function trickById(id: string): Trick {
  return TRICKS.find((t) => t.id === id) ?? TRICKS[0];
}

export interface PoseData {
  inertia: V3;
  halfLength: number;
  radius: number;
  extension: number;
  areaBroad: number;
  areaSlim: number;
}

export function newPose(): PoseData {
  return { inertia: new V3(), halfLength: 1, radius: 0.2, extension: 1, areaBroad: 0, areaSlim: 0 };
}

/**
 * Interpolate between a straight layout and the trick's committed shape.
 *
 * The curve is eased so that the first part of the input opens the body out
 * quickly (which is what you want when you are scrambling to line up) while the
 * last part commits hard into the shape.
 */
export function poseAt(shape: number, trick: Trick, out: PoseData): PoseData {
  const s = clamp01(shape);
  const t = s * s * (3 - 2 * s);
  out.inertia.set(
    lerp(LAYOUT.inertia[0], trick.inertia[0], t),
    lerp(LAYOUT.inertia[1], trick.inertia[1], t),
    lerp(LAYOUT.inertia[2], trick.inertia[2], t),
  );
  out.halfLength = lerp(LAYOUT.halfLength, trick.halfLength, t);
  out.radius = lerp(LAYOUT.radius, trick.radius, t);
  // Extension falls off faster than shape: a half-committed body is already
  // well past the point where the airflow will straighten it out for you.
  out.extension = lerp(LAYOUT.extension, trick.extension, Math.sqrt(t));
  out.areaBroad = lerp(LAYOUT.areaBroad, trick.areaBroad, t);
  out.areaSlim = lerp(LAYOUT.areaSlim, trick.areaSlim, t);
  return out;
}

/** Name for the shape actually held through the rotation, for the readout. */
export function shapeLabel(shape: number, trick: Trick): string {
  if (shape < 0.22) return 'Layout';
  if (shape > 0.72) return trick.name;
  return 'Free';
}

/**
 * Collision spheres along the long axis, in body space. In a committed shape
 * they collapse toward the centre, so a balled-up diver really is a smaller
 * target than a stretched one.
 */
export function collisionSpheres(p: PoseData, out: { off: number; r: number }[]) {
  const h = p.halfLength;
  out[0].off = -h * 0.66; out[0].r = p.radius * 0.90; // legs
  out[1].off = 0.0;       out[1].r = p.radius * 1.05; // torso
  out[2].off = h * 0.70;  out[2].r = p.radius * 0.82; // head/shoulders
  return out;
}

/** Reference body mass, used to turn per-unit-mass areas into real m^2. */
export const BODY_MASS = 72;
