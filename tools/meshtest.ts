import { Level } from '../src/sim/level.ts';
import { buildRockMesh } from '../src/view/surfacenets.ts';
const L = new Level();
for (const cell of [0.55, 0.45]) {
  const t0 = Date.now();
  const m = buildRockMesh(L.rock, cell);
  const dt = Date.now() - t0;
  let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9;
  for (let i = 0; i < m.positions.length; i += 3) {
    minX = Math.min(minX, m.positions[i]); maxX = Math.max(maxX, m.positions[i]);
    minY = Math.min(minY, m.positions[i + 1]); maxY = Math.max(maxY, m.positions[i + 1]);
  }
  let aoSum = 0; for (const a of m.ao) aoSum += a;
  console.log(`cell=${cell}  verts=${(m.positions.length / 3).toLocaleString()}  tris=${m.triangles.toLocaleString()}  ${dt}ms  x[${minX.toFixed(0)},${maxX.toFixed(0)}] y[${minY.toFixed(0)},${maxY.toFixed(0)}]  meanAO=${(aoSum / m.ao.length).toFixed(2)}`);
}
