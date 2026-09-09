/// <reference lib="webworker" />
import { Level, mapIdFrom, type MapId } from '../sim/level.ts';
import { buildRockMesh } from './surfacenets.ts';

/** Mesh only the ground SDF. High islands are rendered separately from exact collision OBBs. */
self.onmessage = (e: MessageEvent<{ cell: number; mapId?: MapId | string }>) => {
  const level = new Level(mapIdFrom(e.data.mapId));
  const m = buildRockMesh(level.rock, e.data.cell);
  (self as unknown as Worker).postMessage(
    { positions: m.positions, normals: m.normals, ao: m.ao, indices: m.indices, triangles: m.triangles },
    [m.positions.buffer, m.normals.buffer, m.ao.buffer, m.indices.buffer],
  );
};
