import { V3, clamp01, lerp } from '../core/vec.ts';

/**
 * Body-shape model.
 *
 * `shape` is a single scalar the player drives:
 *    0.0 = LAYOUT  (straight, arms overhead, "pencil")
 *    0.5 = PIKE    (folded at hips, legs straight)
 *    1.0 = TUCK    (knees to chest, a ball)
 *
 * Everything physical about the diver -- moment of inertia, drag area, height,
 * where the collision spheres sit -- is derived from this one number. That is
 * what makes the core mechanic legible: one input, one visible body change, one
 * physical consequence.
 *
 * Inertia values are per-unit-mass (radius of gyration squared, m^2) and come
 * from published human-body segment data for a ~70 kg adult:
 *   somersault axis: layout ~13.5, pike ~6.5, tuck ~3.7 kg m^2
 * The layout:tuck ratio of ~3.6:1 is why a tuck spins so much faster, and we
 * keep it honest rather than inventing a multiplier.
 */

// Body frame: +Y = feet -> head, +Z = chest/facing, +X = diver's right.
// Somersault rotates about X, twist about Y, cartwheel about Z.

const I_SOM = [0.1930, 0.0929, 0.0529]; // layout, pike, tuck
const I_TWI = [0.0143, 0.0300, 0.0357];
const I_CAR = [0.2000, 0.1150, 0.0580];

/** Piecewise-linear through the three anchor shapes. */
function anchorLerp(a: number[], s: number): number {
  s = clamp01(s);
  return s < 0.5 ? lerp(a[0], a[1], s * 2) : lerp(a[1], a[2], (s - 0.5) * 2);
}

export interface PoseData {
  /** Body-frame principal moments of inertia (per unit mass). */
  inertia: V3;
  /** Half-length of the body's long axis, metres (collision + rendering). */
  halfLength: number;
  /** Cross-section radius, metres. */
  radius: number;
  /** 0 = balled up, 1 = fully extended. Drives aero alignment + entry quality. */
  extension: number;
  /** Frontal drag area per unit mass when broadside (m^2/kg-ish, tuned). */
  areaBroad: number;
  /** Drag area when perfectly streamlined. */
  areaSlim: number;
}

const _pose: PoseData = {
  inertia: new V3(),
  halfLength: 1,
  radius: 0.2,
  extension: 1,
  areaBroad: 0.0097,
  areaSlim: 0.0013,
};

export function poseAt(shape: number, out: PoseData = _pose): PoseData {
  const s = clamp01(shape);
  out.inertia.set(anchorLerp(I_SOM, s), anchorLerp(I_TWI, s), anchorLerp(I_CAR, s));
  // Standing height ~1.80 m; arms overhead in layout reaches ~2.30 m tip to toe.
  out.halfLength = lerp(1.15, 0.42, s);
  out.radius = lerp(0.19, 0.34, s);
  // Extension falls off faster than shape so a half-tuck is already "not lined up".
  out.extension = (1 - s) * (1 - s);
  out.areaBroad = lerp(0.0097, 0.0060, s);
  out.areaSlim = lerp(0.0013, 0.0042, s);
  return out;
}

/** Named shapes, for scoring readouts. */
export function shapeName(shape: number): 'Layout' | 'Pike' | 'Tuck' | 'Free' {
  if (shape < 0.22) return 'Layout';
  if (shape > 0.78) return 'Tuck';
  if (shape > 0.38 && shape < 0.62) return 'Pike';
  return 'Free';
}

/**
 * Collision sphere layout along the body's long axis, in body space.
 * Three spheres: legs/feet, torso, head. In a tuck they collapse toward the
 * centre so a balled-up diver really does present a smaller target.
 */
export function collisionSpheres(p: PoseData, out: { off: number; r: number }[]) {
  const h = p.halfLength;
  out[0].off = -h * 0.66; out[0].r = p.radius * 0.90; // legs
  out[1].off = 0.0;       out[1].r = p.radius * 1.05; // torso
  out[2].off = h * 0.70;  out[2].r = p.radius * 0.82; // head/shoulders
  return out;
}
