/** Confirms the splash is a function of the entry, and ordered the right way. */
import { Game, type GameInput } from '../src/sim/game.ts';
import { TRICKS } from '../src/sim/tricks.ts';

interface Row { label: string; speed: number; align: number; area: number; disp: number; slam: number; grade: string; score: number }

function dive(trickIdx: number, tuckFor: number, openAfter: boolean, spot = 3): Row {
  const g = new Game();
  g.teleport(spot);
  g.selectTrick(trickIdx);
  const inp: GameInput = { jump: false, jumpEdge: false, stretch: false, rot: 0, restart: false, spotDelta: 0, trickDelta: 0, mx: 0, mz: 0, run: false, camYaw: 0 };
  let t = 0, launch = -1;
  let phys: any = null;
  for (let i = 0; i < 2400; i++) {
    const air = launch >= 0 ? t - launch : -1;
    inp.jump = launch < 0 ? t < 0.55 : (air > 0.12 && air < 0.12 + tuckFor);
    inp.stretch = launch >= 0 && openAfter && air >= 0.12 + tuckFor;
    inp.rot = launch < 0 && t < 0.30 ? 1 : 0;
    g.update(1 / 120, inp);
    if (launch < 0 && g.phase === 'air') launch = t;
    for (const e of g.events) if (e.t === 'entry') phys = e.phys;
    g.events.length = 0;
    t += 1 / 120;
    if (g.phase === 'result' && g.sinceResult > 0.05) break;
  }
  const r = g.result!;
  return {
    label: TRICKS[trickIdx].name + (openAfter ? ' + open' : ' (held)'),
    speed: phys?.speed ?? 0, align: phys?.align ?? 0, area: phys?.area ?? 0,
    disp: phys?.displace ?? 0, slam: phys?.slam ?? 0, grade: r.grade, score: r.score,
  };
}

console.log('SPLASH PHYSICS FROM THE PLANK (28 m) -- area m^2, displace m^3/s\n');
console.log('  entry                    speed  align   area   displace    slam   grade        score');
const rows: Row[] = [];
for (let i = 0; i < TRICKS.length; i++) {
  rows.push(dive(i, 1.35, true));   // committed, then opened out for the entry
  rows.push(dive(i, 9.0, false));   // held all the way in
}
for (const r of rows) {
  console.log(`  ${r.label.padEnd(22)} ${r.speed.toFixed(1).padStart(5)}  ${r.align.toFixed(2)}  ${r.area.toFixed(3).padStart(6)}  ${r.disp.toFixed(1).padStart(7)}  ${r.slam.toFixed(0).padStart(6)}   ${r.grade.padEnd(11)} ${r.score}`);
}
const held = rows.filter((r) => r.label.includes('held')).sort((a, b) => a.disp - b.disp);
console.log('\n  ordered by water moved: ' + held.map((r) => `${r.label.split(' ')[0]} ${r.disp.toFixed(1)}`).join('  <  '));
