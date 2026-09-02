import { runDive } from './simtest.ts';
console.log('SCOOP EXPLOIT CHECK -- holding the rotation key for the whole fall');
console.log('  spot  scoop   halfRots  grade      score');
for (const spot of [3, 4]) {
  for (const sc of [0, 1]) {
    const tr = runDive({ spot, charge: 0.55, spinDir: 1, spinHold: 0.05, tuckAt: 0.12, tuckFor: 0.2, stretchFor: 12, scoop: sc });
    console.log(`  ${spot}     ${sc}       ${String(tr.halfRots).padStart(4)}      ${tr.grade.padEnd(10)} ${tr.score}`);
  }
}
