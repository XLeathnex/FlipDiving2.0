/**
 * Headless playtesting. Runs scripted dives through the real simulation and
 * reports what actually happens, so tuning is measured rather than guessed.
 */
import { Game, type GameInput } from '../src/sim/game.ts';

const NO: GameInput = { jump: false, jumpEdge: false, stretch: false, rot: 0, restart: false, spotDelta: 0 };

export interface Plan {
  spot: number;
  charge: number;      // seconds to hold the jump key
  spinDir: number;     // -1 back, +1 front
  spinHold: number;    // seconds to hold the rotation key while charging
  tuckAt: number;      // seconds after launch to start tucking
  tuckFor: number;     // seconds to stay tucked
  stretchFor: number;  // seconds of layout after the tuck (then loose)
  scoop: number;       // scoop input applied during the layout phase
}

export interface Trace {
  ok: boolean;
  grade: string;
  score: number;
  quality: number;
  fall: number;
  halfRots: number;
  airTime: number;
  peakOmega: number;
  tuckOmega: number;
  layoutOmega: number;
  entrySpeed: number;
  nearestSolid: number;
  crashedOnRock: boolean;
  maxSpeed: number;
  note: string;
}

export function runDive(plan: Plan, dt = 1 / 120): Trace {
  const g = new Game();
  g.selectSpot(plan.spot);
  let t = 0;
  let peakOmega = 0, tuckOmega = 0, layoutOmega = 0, maxSpeed = 0;
  let crashedOnRock = false;
  let launchT = -1;
  const inp: GameInput = { ...NO };

  for (let step = 0; step < 3000; step++) {
    const air = launchT >= 0 ? t - launchT : -1;
    inp.jump = false; inp.stretch = false; inp.rot = 0; inp.jumpEdge = false;
    if (launchT < 0) {
      inp.jump = t < plan.charge;
      inp.rot = t < plan.spinHold ? plan.spinDir : 0;
    } else {
      if (air >= plan.tuckAt && air < plan.tuckAt + plan.tuckFor) inp.jump = true;
      else if (air >= plan.tuckAt + plan.tuckFor && air < plan.tuckAt + plan.tuckFor + plan.stretchFor) {
        inp.stretch = true;
        inp.rot = plan.scoop;
      }
    }
    g.update(dt, inp);
    if (launchT < 0 && g.phase === 'air') launchT = t;

    const b = g.body;
    if (!b.pos.isFinite() || !b.vel.isFinite()) {
      return { ...blank(), note: 'NaN/instability at t=' + t.toFixed(2) };
    }
    const w = Math.abs(b.omegaBody.x);
    peakOmega = Math.max(peakOmega, w);
    maxSpeed = Math.max(maxSpeed, b.vel.len());
    if (b.shape > 0.9) tuckOmega = Math.max(tuckOmega, w);
    if (b.shape < 0.1 && launchT >= 0) layoutOmega = Math.max(layoutOmega, w);
    if (b.mode === 'crashed') crashedOnRock = true;

    t += dt;
    if (g.phase === 'result' && g.sinceResult > 0.05) {
      const r = g.result!;
      return {
        ok: true, grade: r.grade, score: r.score, quality: r.quality,
        fall: r.fall, halfRots: r.halfRots, airTime: b.airTime,
        peakOmega, tuckOmega, layoutOmega,
        entrySpeed: maxSpeed, nearestSolid: b.nearestSolid,
        crashedOnRock, maxSpeed, note: '',
      };
    }
  }
  return { ...blank(), note: 'never landed (t=' + t.toFixed(1) + ')' };
}

function blank(): Trace {
  return { ok: false, grade: '-', score: 0, quality: 0, fall: 0, halfRots: 0, airTime: 0, peakOmega: 0, tuckOmega: 0, layoutOmega: 0, entrySpeed: 0, nearestSolid: 0, crashedOnRock: false, maxSpeed: 0, note: '' };
}

// ---------------------------------------------------------------- reports

function hdr(s: string) { console.log('\n\x1b[1m' + s + '\x1b[0m'); }

function clearanceSweep() {
  hdr('LEVEL CLEARANCE  -- plain jumps, no rotation, from every spot at every power');
  const g0 = new Game();
  for (let spot = 0; spot < g0.level.spots.length; spot++) {
    const name = g0.level.spots[spot].name;
    const rows: string[] = [];
    for (const c of [0.0, 0.15, 0.3, 0.55]) {
      const tr = runDive({ spot, charge: c, spinDir: 0, spinHold: 0, tuckAt: 0.2, tuckFor: 0, stretchFor: 9, scoop: 0 });
      rows.push(`${(c / 0.55 * 100).toFixed(0).padStart(3)}% ${tr.crashedOnRock ? '\x1b[31mROCK\x1b[0m' : ' ok '} clr=${tr.nearestSolid.toFixed(1).padStart(5)}`);
    }
    console.log(`  ${name.padEnd(12)} ${rows.join('  |  ')}`);
  }
}

function rotationCheck() {
  hdr('ROTATION MODEL  -- does tucking actually pay off?');
  console.log('  spot          spin  tuckW  layW  ratio   halfRots  air');
  const g0 = new Game();
  for (let spot = 0; spot < 5; spot++) {
    for (const sh of [0.15, 0.45]) {
      const tr = runDive({ spot, charge: 0.55, spinDir: 1, spinHold: sh, tuckAt: 0.15, tuckFor: 1.4, stretchFor: 9, scoop: 0 });
      console.log(`  ${g0.level.spots[spot].name.padEnd(12)} ${(sh / 0.45).toFixed(2)}  ${tr.tuckOmega.toFixed(2).padStart(5)} ${tr.layoutOmega.toFixed(2).padStart(5)}  ${(tr.tuckOmega / Math.max(0.01, tr.layoutOmega)).toFixed(2).padStart(5)}   ${tr.halfRots.toString().padStart(4)}     ${tr.airTime.toFixed(2)}`);
    }
  }
}

function skillCurve() {
  hdr('SKILL CURVE  -- sweeping tuck duration from The Plank (28 m), full charge, full front spin');
  console.log('  tuckFor  halfRots  grade        q      score   entry m/s');
  let bestScore = 0, bestTuck = 0;
  for (let tf = 0; tf <= 2.6; tf += 0.2) {
    const tr = runDive({ spot: 3, charge: 0.55, spinDir: 1, spinHold: 0.45, tuckAt: 0.12, tuckFor: tf, stretchFor: 9, scoop: 0 });
    if (tr.score > bestScore) { bestScore = tr.score; bestTuck = tf; }
    console.log(`  ${tf.toFixed(1).padStart(6)}   ${tr.halfRots.toString().padStart(6)}   ${tr.grade.padEnd(11)} ${tr.quality.toFixed(2)}  ${tr.score.toString().padStart(6)}   ${tr.entrySpeed.toFixed(1)}`);
  }
  console.log(`  --> best ${bestScore} at tuckFor=${bestTuck.toFixed(1)}`);
}

function precisionWindow() {
  hdr('PRECISION WINDOW  -- how tight is the timing for a Perfect? (Plank, 2.5 front)');
  let first = -1, last = -1, n = 0;
  for (let tf = 0.6; tf <= 2.2; tf += 0.02) {
    const tr = runDive({ spot: 3, charge: 0.55, spinDir: 1, spinHold: 0.45, tuckAt: 0.12, tuckFor: tf, stretchFor: 9, scoop: 0 });
    if (tr.grade === 'Perfect' || tr.grade === 'Clean') { if (first < 0) first = tf; last = tf; n++; }
  }
  console.log(`  Clean-or-better window: ${n} of 80 samples, tuckFor ${first.toFixed(2)}..${last.toFixed(2)} (${((last - first) * 1000).toFixed(0)} ms wide)`);
}

function stability() {
  hdr('STABILITY  -- 400 randomised dives incl. deliberate rock strikes');
  let bad = 0, crash = 0, landed = 0;
  const grades: Record<string, number> = {};
  for (let i = 0; i < 400; i++) {
    const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
    const tr = runDive({
      spot: Math.floor(r(1) * 5), charge: r(2) * 0.6, spinDir: r(3) < 0.5 ? -1 : 1,
      spinHold: r(4) * 0.5, tuckAt: r(5) * 0.6, tuckFor: r(6) * 3.0,
      stretchFor: 9, scoop: (r(7) - 0.5) * 2,
    });
    if (!tr.ok) { bad++; console.log('   \x1b[31mFAIL\x1b[0m ' + tr.note); }
    else { landed++; grades[tr.grade] = (grades[tr.grade] || 0) + 1; if (tr.crashedOnRock) crash++; }
  }
  console.log(`  landed ${landed}/400, failures ${bad}, rock crashes ${crash}`);
  console.log('  grades: ' + Object.entries(grades).map(([k, v]) => `${k}=${v}`).join('  '));
}

if (process.argv[1]?.endsWith('simtest.ts')) {
  clearanceSweep();
  rotationCheck();
  skillCurve();
  precisionWindow();
  stability();
}
