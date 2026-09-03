import { clamp01, lerp, smoothstep } from '../core/vec.ts';

export type Grade =
  // Dives are judged on how little water you move.
  | 'Perfect' | 'Clean' | 'Good' | 'Rough' | 'Belly Flop' | 'Back Flop'
  // Bombs are judged on how much.
  | 'Colossal' | 'Huge' | 'Solid' | 'Small' | 'Weak'
  | 'Crash';

export interface EntrySample {
  speed: number;
  /** 'dive' judges cleanliness, 'bomb' judges displacement. */
  intent: 'dive' | 'bomb';
  /** Volume of water displaced per second at contact, m^3/s. */
  displace: number;
  /** |dot(bodyAxis, velocityDir)| -- 1 means travelling exactly along your own axis. */
  align: number;
  /** -velocityDir.y -- 1 means straight down. */
  vertical: number;
  /** Magnitude of body angular velocity at the instant of contact. */
  spin: number;
  /** Pose extension 0..1. */
  extension: number;
  /** +1 head first, -1 feet first. */
  lead: number;
  /** dot(chestNormal, velocityDir) -- tells belly from back on a flat landing. */
  chest: number;
  crashed: boolean;
}

export interface DiveResult {
  grade: Grade;
  /** 0..1 entry quality. */
  quality: number;
  /** Multiplier applied to the air score. */
  multiplier: number;
  score: number;
  fall: number;
  halfRots: number;
  halfTwists: number;
  shapeName: string;
  chips: string[];
  trickName: string;
  /** The air trick that was flown, e.g. "Manu". */
  shape: string;
  /** Set by the game layer when this beat the spot's personal best. */
  newBest?: boolean;
}

/**
 * Entry quality.
 *
 * The single thing that matters most is whether the body is travelling along
 * its own long axis -- that is what a "rip" entry physically is, the body
 * following the hole it makes. Everything else modulates it. Note there is no
 * landing zone anywhere in here: the water decides, and only the water.
 */
export function gradeEntry(s: EntrySample): { grade: Grade; quality: number; multiplier: number } {
  if (s.crashed) return { grade: 'Crash', quality: 0, multiplier: 0.06 };

  // --- Bombs invert the whole thing. The goal is to move as much water as
  // possible, so the grade reads straight off the displacement the physics
  // produced: broad shape, high speed, hitting flat. Nothing else to balance.
  if (s.intent === 'bomb') {
    const q = clamp01((s.displace - 2.5) / 12.0);
    let grade: Grade;
    if (q >= 0.82) grade = 'Colossal';
    else if (q >= 0.62) grade = 'Huge';
    else if (q >= 0.40) grade = 'Solid';
    else if (q >= 0.20) grade = 'Small';
    else grade = 'Weak';
    return { grade, quality: q, multiplier: lerp(0.25, 2.15, Math.pow(q, 1.25)) };
  }

  const aAlign = Math.pow(s.align, 1.35);
  // Rotating on the way in tears the entry open. Fast dives are less forgiving.
  const spinTol = lerp(3.2, 5.0, smoothstep(6, 26, s.speed));
  const aSpin = clamp01(1 - s.spin / spinTol);
  const aExt = 0.30 + 0.70 * s.extension;
  const aVert = 0.62 + 0.38 * s.vertical;

  let q = aAlign * (0.30 + 0.70 * aSpin) * aExt * aVert;

  // A slow, low entry is easy; do not hand out Perfects for stepping off a rock.
  q *= lerp(0.86, 1.0, smoothstep(5, 13, s.speed));
  q = clamp01(q);

  let grade: Grade;
  if (s.align < 0.38 && s.speed > 8) {
    grade = s.chest > 0 ? 'Belly Flop' : 'Back Flop';
  } else if (q >= 0.88) grade = 'Perfect';
  else if (q >= 0.72) grade = 'Clean';
  else if (q >= 0.50) grade = 'Good';
  else grade = 'Rough';

  // Multiplier curve: heavily rewards the top end so a rip really pays.
  const multiplier = grade === 'Belly Flop' || grade === 'Back Flop'
    ? lerp(0.10, 0.28, q / 0.5)
    : lerp(0.22, 2.20, Math.pow(q, 1.5));

  return { grade, quality: q, multiplier };
}

const ORDINAL = ['', 'Single', 'Double', 'Triple', 'Quad', 'Quint', 'Sextuple', 'Septuple'];

/** Human-readable trick name, e.g. "Double Front Tuck", "1½ Back Pike". */
export function trickName(somersault: number, twist: number, shape: string): string {
  const dir = somersault >= 0 ? 'Front' : 'Back';
  const halves = Math.round(Math.abs(somersault) / Math.PI);
  let rot: string;
  if (halves === 0) return twistName(twist) || 'Straight Drop';
  if (halves === 1) rot = `${dir} Dive`;
  else if (halves % 2 === 0) {
    const full = halves / 2;
    rot = `${ORDINAL[Math.min(full, 7)] || full + 'x'} ${dir}`;
  } else {
    rot = `${Math.floor(halves / 2)}½ ${dir}`;
  }
  const tw = twistName(twist);
  return [rot, tw, shape !== 'Free' ? shape : ''].filter(Boolean).join(' ');
}

function twistName(twist: number): string {
  const halves = Math.round(Math.abs(twist) / Math.PI);
  if (halves === 0) return '';
  if (halves === 1) return 'with ½ Twist';
  if (halves % 2 === 0) return `with ${halves / 2} Twist`;
  return `with ${Math.floor(halves / 2)}½ Twist`;
}

export interface DiveStats {
  fall: number;
  /** Rotation-scoring multiplier from the trick that was flown. */
  difficulty: number;
  trickName: string;
  somersault: number;
  twist: number;
  /** Mean body shape while actually rotating -- drives the difficulty multiplier. */
  meanShape: number;
  shapeName: string;
  scoopUsed: number;
  nearestSolid: number;
  /** Time between reaching full extension and touching water. */
  lineUpTime: number;
  airTime: number;
}

export function scoreDive(st: DiveStats, entry: ReturnType<typeof gradeEntry>): DiveResult {
  const halfRots = Math.round(Math.abs(st.somersault) / Math.PI);
  const halfTwists = Math.round(Math.abs(st.twist) / Math.PI);

  // Harder shapes rotate more slowly, so they are worth more per somersault.
  // Committing less than fully to the shape scales the bonus back down.
  const difficulty = lerp(1.0, st.difficulty, clamp01(st.meanShape * 1.3));
  const heightPts = st.fall * 3.1;
  const rotPts = halfRots * 38 * difficulty;
  const twistPts = halfTwists * 22;
  let base = heightPts + rotPts + twistPts;

  const chips: string[] = [];
  let bonus = 0;

  if (st.scoopUsed < 0.18 && halfRots > 0) { bonus += base * 0.08; chips.push('No Scoop +8%'); }
  if (st.lineUpTime > 0.02 && st.lineUpTime < 0.55 && entry.quality > 0.6) {
    bonus += 45; chips.push('Late Line-Up +45');
  }
  if (st.nearestSolid < 2.2) {
    const b = Math.round(lerp(70, 15, smoothstep(0.7, 2.2, st.nearestSolid)));
    bonus += b; chips.push(`Close Call +${b}`);
  }

  const score = Math.max(0, Math.round(base * entry.multiplier + bonus * entry.multiplier));

  return {
    grade: entry.grade,
    quality: entry.quality,
    multiplier: entry.multiplier,
    score,
    fall: st.fall,
    halfRots,
    halfTwists,
    shapeName: st.shapeName,
    chips: chips.slice(0, 3),
    trickName: trickName(st.somersault, st.twist, st.shapeName),
    shape: st.trickName,
  };
}
