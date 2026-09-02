import { Game, type GameInput } from '../src/sim/game.ts';
const g = new Game(); g.selectSpot(3);
const inp: GameInput = { jump: false, jumpEdge: false, stretch: false, rot: 0, restart: false, spotDelta: 0 };
let t = 0, launchT = -1;
const dt = 1/120;
console.log('  t     y      vy     spd   shape  wx     som    mode    phase');
for (let i = 0; i < 900; i++) {
  const air = launchT >= 0 ? t - launchT : -1;
  inp.jump = launchT < 0 ? t < 0.55 : (air >= 0.12 && air < 0.12 + 1.4);
  inp.stretch = launchT >= 0 && air >= 1.52;
  inp.rot = launchT < 0 && t < 0.45 ? 1 : 0;
  g.update(dt, inp);
  if (launchT < 0 && g.phase === 'air') launchT = t;
  const b = g.body;
  if (i % 12 === 0) console.log(`${t.toFixed(2).padStart(5)} ${b.pos.y.toFixed(1).padStart(6)} ${b.vel.y.toFixed(1).padStart(6)} ${b.vel.len().toFixed(1).padStart(6)} ${b.shape.toFixed(2).padStart(5)} ${b.omegaBody.x.toFixed(2).padStart(6)} ${(b.somersault/Math.PI).toFixed(2).padStart(6)}  ${b.mode.padEnd(8)}${g.phase}`);
  t += dt;
  if (g.phase === 'result' && g.sinceResult > 0.2) { console.log('RESULT', JSON.stringify(g.result)); break; }
}
