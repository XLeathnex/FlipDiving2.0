import { V3, clamp01, lerp } from '../core/vec.ts';

export type Intent = 'dive' | 'bomb';
export type ShapeKind = 'tuck' | 'pike' | 'layout' | 'swan' | 'twist' | 'cannonball' | 'manu' | 'candle' | 'watermelon';
export type RotationIntent = 'front' | 'back' | 'gainer' | 'reverse' | 'neutral';

export interface Trick {
  id: string;
  name: string;
  blurb: string;
  intent: Intent;
  shapeKind: ShapeKind;
  /** Intended take-off family. This only biases take-off angular momentum; physics still decides what actually happens. */
  rotationIntent: RotationIntent;
  /** Desired twist angular momentum added at take-off, per-unit-mass m²/s. Never injected mid-air. */
  twistL: number;
  /** Human-readable planned number of somersaults. Used for UI/description only. */
  plannedRots: number;
  inertia: [number, number, number];
  halfLength: number;
  radius: number;
  extension: number;
  areaBroad: number;
  areaSlim: number;
  difficulty: number;
}

export const LAYOUT = {
  inertia: [0.1930, 0.0143, 0.2000] as [number, number, number],
  halfLength: 1.15,
  radius: 0.19,
  extension: 1.0,
  areaBroad: 0.0097,
  areaSlim: 0.0013,
};

const SHAPES: Record<ShapeKind, Omit<Trick, 'id' | 'name' | 'blurb' | 'intent' | 'shapeKind' | 'rotationIntent' | 'twistL' | 'plannedRots' | 'difficulty'>> = {
  tuck: { inertia: [0.0529, 0.0357, 0.0580], halfLength: 0.42, radius: 0.34, extension: 0.0, areaBroad: 0.0060, areaSlim: 0.0042 },
  pike: { inertia: [0.0929, 0.0300, 0.1150], halfLength: 0.72, radius: 0.26, extension: 0.22, areaBroad: 0.0078, areaSlim: 0.0026 },
  layout: { inertia: [0.205, 0.0135, 0.210], halfLength: 1.18, radius: 0.185, extension: 1.0, areaBroad: 0.0092, areaSlim: 0.0012 },
  swan: { inertia: [0.2300, 0.0900, 0.2400], halfLength: 0.95, radius: 0.30, extension: 0.52, areaBroad: 0.0132, areaSlim: 0.0072 },
  twist: { inertia: [0.150, 0.0068, 0.160], halfLength: 1.05, radius: 0.20, extension: 0.62, areaBroad: 0.0085, areaSlim: 0.0020 },
  cannonball: { inertia: [0.0620, 0.0400, 0.0660], halfLength: 0.44, radius: 0.38, extension: 0.0, areaBroad: 0.0090, areaSlim: 0.0070 },
  manu: { inertia: [0.0820, 0.0340, 0.0980], halfLength: 0.62, radius: 0.31, extension: 0.10, areaBroad: 0.0122, areaSlim: 0.0076 },
  candle: { inertia: [0.075, 0.032, 0.088], halfLength: 0.68, radius: 0.24, extension: 0.30, areaBroad: 0.0068, areaSlim: 0.0034 },
  watermelon: { inertia: [0.2400, 0.0980, 0.2500], halfLength: 0.98, radius: 0.33, extension: 0.15, areaBroad: 0.0145, areaSlim: 0.0080 },
};

function dive(id: string, name: string, shapeKind: ShapeKind, rotationIntent: RotationIntent, plannedRots: number, difficulty: number, twistL = 0, blurb?: string): Trick {
  return {
    id, name,
    blurb: blurb ?? `${name}. Take-off creates the angular momentum; body shape only changes inertia after launch.`,
    intent: 'dive', shapeKind, rotationIntent, twistL, plannedRots, difficulty,
    ...SHAPES[shapeKind],
  };
}
function bomb(id: string, name: string, shapeKind: ShapeKind, difficulty: number, blurb: string): Trick {
  return { id, name, blurb, intent: 'bomb', shapeKind, rotationIntent: 'neutral', twistL: 0, plannedRots: 0, difficulty, ...SHAPES[shapeKind] };
}

/**
 * Actual dive families instead of nine generic body poses. These are not canned
 * animations: selecting one defines the intended take-off rotation family,
 * twist angular momentum and committed body configuration. Once the feet leave
 * the platform, only forces/torques, inertia and player body-shape input move it.
 */
export const TRICKS: Trick[] = [
  dive('front-tuck', 'Front Flip Tuck', 'tuck', 'front', 1, 1.00),
  dive('front-pike', 'Front Flip Pike', 'pike', 'front', 1, 1.16),
  dive('front-layout', 'Front Flip Layout', 'layout', 'front', 1, 1.30),
  dive('front-15-tuck', 'Front 1½ Tuck', 'tuck', 'front', 1.5, 1.28),
  dive('front-double-tuck', 'Double Front Tuck', 'tuck', 'front', 2, 1.48),
  dive('front-double-pike', 'Double Front Pike', 'pike', 'front', 2, 1.68),
  dive('front-triple-tuck', 'Triple Front Tuck', 'tuck', 'front', 3, 2.05),

  dive('back-tuck', 'Back Flip Tuck', 'tuck', 'back', 1, 1.04),
  dive('back-pike', 'Back Flip Pike', 'pike', 'back', 1, 1.20),
  dive('back-layout', 'Back Flip Layout', 'layout', 'back', 1, 1.34),
  dive('back-15-tuck', 'Back 1½ Tuck', 'tuck', 'back', 1.5, 1.32),
  dive('back-double-tuck', 'Double Back Tuck', 'tuck', 'back', 2, 1.52),
  dive('back-double-pike', 'Double Back Pike', 'pike', 'back', 2, 1.72),
  dive('back-triple-tuck', 'Triple Back Tuck', 'tuck', 'back', 3, 2.10),

  dive('gainer-tuck', 'Gainer Tuck', 'tuck', 'gainer', 1, 1.34, 0, 'Forward travel with backward angular momentum. The classic gainer relationship.'),
  dive('gainer-pike', 'Gainer Pike', 'pike', 'gainer', 1, 1.50),
  dive('gainer-layout', 'Gainer Layout', 'layout', 'gainer', 1, 1.68),
  dive('gainer-double', 'Double Gainer Tuck', 'tuck', 'gainer', 2, 1.92),
  dive('reverse-tuck', 'Reverse Tuck', 'tuck', 'reverse', 1, 1.34, 0, 'Backward take-off travel with forward rotation.'),
  dive('reverse-pike', 'Reverse Pike', 'pike', 'reverse', 1, 1.50),

  dive('barani', 'Barani', 'twist', 'front', 1, 1.58, 0.030, 'Front somersault with a half twist, all angular momentum established at take-off.'),
  dive('front-full', 'Front Full', 'twist', 'front', 1, 1.76, 0.060, 'Front somersault with one full twist.'),
  dive('front-rudy', 'Rudolph', 'twist', 'front', 1, 1.94, 0.090, 'Front somersault with one-and-a-half twists.'),
  dive('back-half', 'Back ½ Twist', 'twist', 'back', 1, 1.56, 0.030),
  dive('back-full', 'Back Full', 'twist', 'back', 1, 1.76, 0.060),
  dive('back-15-full', 'Back 1½ + Full Twist', 'twist', 'back', 1.5, 2.02, 0.060),
  dive('double-front-half', 'Double Front + ½ Twist', 'twist', 'front', 2, 2.04, 0.030),
  dive('double-back-full', 'Double Back + Full Twist', 'twist', 'back', 2, 2.24, 0.060),

  dive('swan', 'Swan Dive', 'swan', 'front', 0.5, 1.42, 0, 'Extended swan: large area, slow rotation, strong aerodynamic alignment.'),
  dive('pencil', 'Pencil Dive', 'layout', 'neutral', 0, 1.62, 0, 'Straight-line entry. Almost no inertia change to save a bad take-off.'),

  bomb('cannonball', 'Cannonball', 'cannonball', 0.90, 'Compact bomb; judged on displaced water, not entry cleanliness.'),
  bomb('manu', 'Manu', 'manu', 1.00, 'Seat-first V shape with high projected area.'),
  bomb('candle', 'Candle', 'candle', 1.00, 'Narrow feet-first bomb. The cleanest bomb is also the smallest splash.'),
  bomb('watermelon', 'Watermelon', 'watermelon', 1.08, 'Maximum broadside area for the biggest possible surface hit.'),
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
  out.extension = lerp(LAYOUT.extension, trick.extension, Math.sqrt(t));
  out.areaBroad = lerp(LAYOUT.areaBroad, trick.areaBroad, t);
  out.areaSlim = lerp(LAYOUT.areaSlim, trick.areaSlim, t);
  return out;
}

export function shapeLabel(shape: number, trick: Trick): string {
  if (shape < 0.22) return 'Layout';
  if (shape > 0.72) {
    if (trick.shapeKind === 'tuck') return 'Tuck';
    if (trick.shapeKind === 'pike') return 'Pike';
    if (trick.shapeKind === 'twist') return 'Twist';
    return trick.name;
  }
  return 'Free';
}

export function collisionSpheres(p: PoseData, out: { off: number; r: number }[]) {
  const h = p.halfLength;
  out[0].off = -h * 0.66; out[0].r = p.radius * 0.90;
  out[1].off = 0.0;       out[1].r = p.radius * 1.05;
  out[2].off = h * 0.70;  out[2].r = p.radius * 0.82;
  return out;
}

export const BODY_MASS = 72;
