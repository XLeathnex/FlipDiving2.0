/// <reference lib="webworker" />
import { Level } from '../sim/level.ts';
import { buildRockMesh } from './surfacenets.ts';

/**
 * Meshing the cove takes a few seconds, and doing it on the main thread means a
 * frozen tab and a loading screen that cannot even animate. The field is
 * deterministic, so the worker just rebuilds the level and meshes it.
 */
self.onmessage = (e: MessageEvent<{ cell: number }>) => {
  const level = new Level();
  const m = buildRockMesh(level.rock, e.data.cell);
  (self as unknown as Worker).postMessage(
    { positions: m.positions, normals: m.normals, ao: m.ao, indices: m.indices, triangles: m.triangles },
    [m.positions.buffer, m.normals.buffer, m.ao.buffer, m.indices.buffer],
  );
};
