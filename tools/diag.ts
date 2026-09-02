import { Level } from '../src/sim/level.ts';
import { Game } from '../src/sim/game.ts';
const L = new Level();

console.log('--- SPOT SURFACE PROBE (SDF distance at heights above the listed standing y) ---');
for (const s of L.spots) {
  const col: string[] = [];
  for (const dy of [-1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]) {
    col.push(`${dy >= 0 ? '+' : ''}${dy}:${L.rock.sample(s.pos.x, s.pos.y + dy, s.pos.z).toFixed(1)}`);
  }
  console.log(` ${s.name.padEnd(12)} ${col.join(' ')}`);
}

console.log('\n--- FORWARD CLEARANCE: SDF along +X from each spot at the standing height and below ---');
for (const s of L.spots) {
  console.log(` ${s.name}`);
  for (const dy of [0, -3, -6, -10, -15, -20]) {
    const y = s.pos.y + dy; if (y < -3) continue;
    let row = `   dy=${String(dy).padStart(4)} y=${y.toFixed(0).padStart(3)}  `;
    for (let dx = 0; dx <= 16; dx += 1) row += L.rock.sample(s.pos.x + dx, y, s.pos.z) < 0.4 ? '#' : '.';
    console.log(row);
  }
}

console.log('\n--- PROP OVERLAP with spots ---');
for (const s of L.spots) for (const p of L.props) {
  const dx = Math.abs(s.pos.x - p.x) - p.hx, dy = Math.abs(s.pos.y + 0.95 - p.y) - p.hy, dz = Math.abs(s.pos.z - p.z) - p.hz;
  if (dx < 1 && dy < 1.2 && dz < 1) console.log(`  ${s.name} near prop  gap=(${dx.toFixed(2)},${dy.toFixed(2)},${dz.toFixed(2)})`);
}

console.log('\n--- WATER DEPTH under each spot, 0..18m out ---');
for (const s of L.spots) {
  let row = ` ${s.name.padEnd(12)}`;
  for (let dx = 0; dx <= 18; dx += 3) row += ` ${L.depthAt(s.pos.x + dx, s.pos.z).toFixed(1).padStart(5)}`;
  console.log(row);
}
