/**
 * Measures the gap between careless play and skilled play. A good action game
 * has a big gap: a random player rarely rips it, a player who knows when to
 * open almost always can.
 */
import { runDive, type Plan } from './simtest.ts';
import { TUNE } from '../src/sim/body.ts';

const rnd = (seed: number) => { let x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); };

function randomPlayer(n: number, spots = [0, 1, 2, 3, 4]) {
  let clean = 0, perfect = 0, crash = 0, flop = 0, tot = 0, score = 0;
  for (let i = 0; i < n; i++) {
    const tr = runDive({
      spot: spots[Math.floor(rnd(i * 3.1) * spots.length)],
      charge: 0.15 + rnd(i * 5.7) * 0.45,
      spinDir: rnd(i * 7.3) < 0.5 ? -1 : 1,
      spinHold: rnd(i * 9.1) * 0.5,
      tuckAt: 0.1 + rnd(i * 11.3) * 0.4,
      tuckFor: rnd(i * 13.7) * 2.6,
      stretchFor: 9, scoop: 0,
    });
    tot++; score += tr.score;
    if (tr.grade === 'Perfect') { perfect++; clean++; }
    else if (tr.grade === 'Clean') clean++;
    else if (tr.grade === 'Crash') crash++;
    else if (tr.grade.includes('Flop')) flop++;
  }
  return { cleanPct: clean / tot * 100, perfectPct: perfect / tot * 100, crashPct: crash / tot * 100, flopPct: flop / tot * 100, avgScore: score / tot };
}

/** A player who knows the spot: searches for the best moment to open. */
function skilledPlayer(n: number, spots = [0, 1, 2, 3, 4]) {
  let perfect = 0, clean = 0, tot = 0, score = 0;
  for (let i = 0; i < n; i++) {
    const base: Plan = {
      spot: spots[i % spots.length],
      charge: 0.55, spinDir: rnd(i * 7.3) < 0.5 ? -1 : 1,
      spinHold: 0.12 + rnd(i * 9.1) * 0.38,
      tuckAt: 0.12, tuckFor: 0, stretchFor: 9, scoop: 0,
    };
    let bestQ = 0, bestScore = 0, bestGrade = '-';
    for (let tf = 0.1; tf < 3.2; tf += 0.05) {
      const tr = runDive({ ...base, tuckFor: tf });
      if (tr.quality > bestQ) { bestQ = tr.quality; bestGrade = tr.grade; }
      bestScore = Math.max(bestScore, tr.score);
    }
    tot++; score += bestScore;
    if (bestGrade === 'Perfect') { perfect++; clean++; } else if (bestGrade === 'Clean') clean++;
  }
  return { cleanPct: clean / tot * 100, perfectPct: perfect / tot * 100, avgScore: score / tot };
}

/** Width of the "open now" window, in milliseconds, for a Clean-or-better entry. */
function windowMs(spot: number, spinHold: number) {
  let best = 0, run = 0;
  for (let tf = 0.05; tf < 3.2; tf += 0.025) {
    const tr = runDive({ spot, charge: 0.55, spinDir: 1, spinHold, tuckAt: 0.12, tuckFor: tf, stretchFor: 9, scoop: 0 });
    if (tr.grade === 'Perfect' || tr.grade === 'Clean') { run += 25; best = Math.max(best, run); } else run = 0;
  }
  return best;
}

const arg = process.argv[2];
if (arg === 'sweep') {
  console.log('align  damp  |  randomClean%  randomPerf%  crash%  flop%  | skilledPerf%  | windowMs(plank)');
  for (const a of [1.8, 2.4, 3.0, 3.6, 4.2]) {
    for (const d of [1.6, 2.2, 3.0]) {
      (TUNE as any).alignAccel = a; (TUNE as any).alignDamp = d;
      const r = randomPlayer(150);
      const s = skilledPlayer(10);
      const w = windowMs(3, 0.45);
      console.log(`${a.toFixed(1)}   ${d.toFixed(1)}   |   ${r.cleanPct.toFixed(0).padStart(4)}%        ${r.perfectPct.toFixed(0).padStart(3)}%      ${r.crashPct.toFixed(0).padStart(3)}%   ${r.flopPct.toFixed(0).padStart(3)}%  |    ${s.perfectPct.toFixed(0).padStart(3)}%       |  ${w}`);
    }
  }
} else {
  const r = randomPlayer(250);
  const s = skilledPlayer(15);
  console.log(`align=${TUNE.alignAccel} damp=${TUNE.alignDamp} scoop=${TUNE.scoopAccel}`);
  console.log(`  careless player: clean+ ${r.cleanPct.toFixed(0)}%  perfect ${r.perfectPct.toFixed(0)}%  crash ${r.crashPct.toFixed(0)}%  flop ${r.flopPct.toFixed(0)}%  avg ${r.avgScore.toFixed(0)}`);
  console.log(`  skilled player:  clean+ ${s.cleanPct.toFixed(0)}%  perfect ${s.perfectPct.toFixed(0)}%  avg ${s.avgScore.toFixed(0)}`);
  for (const sp of [0, 1, 2, 3, 4]) console.log(`  spot ${sp} open-window: ${windowMs(sp, 0.45)} ms`);
}
