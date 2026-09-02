import { Level } from '../src/sim/level.ts';
const L = new Level();
/** Find the solid surface height near (x,z) by scanning down from `top`. */
function surfaceY(x: number, z: number, top: number, bottom: number): number {
  let y = top;
  for (; y > bottom; y -= 0.02) {
    if (L.rock.sample(x, y, z) < 0.02) return y;
    for (const p of L.props) {
      if (Math.abs(x - p.x) <= p.hx && Math.abs(z - p.z) <= p.hz && Math.abs(y - p.y) <= p.hy + 0.01) return p.y + p.hy;
    }
  }
  return NaN;
}
const cand: [string, number, number, number][] = [
  ['shelf', -4.9, 6.0, 10],
  ['gull', -6.9, -6.0, 16],
  ['arch', 12.0, 17.4, 28],
  ['plank', -3.2, -0.4, 32],
  ['mast', 18.4, -18.3, 40],
];
for (const [id, x, z, top] of cand) {
  const y = surfaceY(x, z, top, -4);
  // forward clearance profile
  let worst = 99, worstY = 0;
  for (let dy = 0; dy > -(y + 2); dy -= 0.5) {
    for (let dx = 0; dx < 26; dx += 0.5) {
      if (L.rock.sample(x + dx, y + dy, z) < 0.3) { if (dx < worst) { worst = dx; worstY = y + dy; } break; }
    }
  }
  console.log(`${id.padEnd(7)} surfaceY=${y.toFixed(2)}  headroom=${L.rock.sample(x, y + 1.9, z).toFixed(2)}  nearestRockEastward=${worst === 99 ? 'clear' : worst.toFixed(1) + 'm at y=' + worstY.toFixed(0)}  depth=${L.depthAt(x + 6, z).toFixed(1)}m`);
}
