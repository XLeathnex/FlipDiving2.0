import { runDive } from './simtest.ts';
import { Game } from '../src/sim/game.ts';
const g0 = new Game();
console.log('BEST ACHIEVABLE SCORE PER SPOT (searching over open timing and spin)');
console.log('  spot          best   trick                          grade     halfRots');
for (let spot = 0; spot < 5; spot++) {
  let best = 0, note = '', grade = '', hr = 0;
  for (const sh of [0.10, 0.20, 0.30, 0.40, 0.50]) {
    for (let tf = 0.05; tf < 3.4; tf += 0.05) {
      const tr = runDive({ spot, charge: 0.55, spinDir: 1, spinHold: sh, tuckAt: 0.12, tuckFor: tf, stretchFor: 9, scoop: 0 });
      if (tr.score > best) { best = tr.score; grade = tr.grade; hr = tr.halfRots; note = `spin=${(sh / 0.45).toFixed(2)} tuck=${tf.toFixed(2)}s`; }
    }
  }
  console.log(`  ${g0.level.spots[spot].name.padEnd(12)} ${String(best).padStart(5)}   ${note.padEnd(28)}   ${grade.padEnd(8)} ${hr}`);
}
console.log('\nWHAT A CASUAL GOOD DIVE PAYS (single somersault, clean entry)');
for (let spot = 0; spot < 5; spot++) {
  let best = 0, grade = '';
  for (let tf = 0.05; tf < 1.2; tf += 0.05) {
    const tr = runDive({ spot, charge: 0.4, spinDir: 1, spinHold: 0.12, tuckAt: 0.12, tuckFor: tf, stretchFor: 9, scoop: 0 });
    if (tr.score > best) { best = tr.score; grade = tr.grade; }
  }
  console.log(`  ${g0.level.spots[spot].name.padEnd(12)} ${String(best).padStart(5)}  ${grade}`);
}
