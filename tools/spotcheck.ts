import { Level } from '../src/sim/level.ts';
const L = new Level();
for (const s of L.spots) {
  const head = L.rock.sample(s.pos.x, s.pos.y + 1.95, s.pos.z);
  let worst = 99, wy = 0;
  for (let dy = -1.2; dy > -(s.pos.y + 2); dy -= 0.4) {
    for (let dx = 0; dx < 26; dx += 0.4) {
      if (L.rock.sample(s.pos.x + dx, s.pos.y + dy, s.pos.z) < 0.3) { if (dx < worst) { worst = dx; wy = s.pos.y + dy; } break; }
    }
  }
  console.log(`${s.id.padEnd(6)} y=${s.pos.y.toFixed(2).padStart(6)} h=${s.height.toFixed(1).padStart(5)} head=${head.toFixed(2).padStart(5)} eastRock=${worst === 99 ? 'clear' : worst.toFixed(1) + 'm@y' + wy.toFixed(0)} depth6=${L.depthAt(s.pos.x + 6, s.pos.z).toFixed(1)}`);
}
