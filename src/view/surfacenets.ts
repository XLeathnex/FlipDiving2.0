import { SdfField } from '../sim/sdf.ts';

/**
 * Naive surface nets over the level's distance field.
 *
 * Marching cubes would work too, but surface nets give rounder, more evenly
 * sized triangles on organic shapes and need no lookup tables. Since we have a
 * real distance field we can also skip whole 8x8x8 blocks whose centre is
 * further from the surface than the block's own radius -- the surface is a thin
 * shell inside a big volume, and this turns the cost from O(volume) into
 * roughly O(area).
 */

export interface RockMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Ambient occlusion, 0 = buried in a crevice, 1 = fully open sky. */
  ao: Float32Array;
  /** Upward-facing-ness, 0..1. Drives where moss and dry weathering sit. */
  up: Float32Array;
  indices: Uint32Array;
  triangles: number;
}

const BLOCK = 8;

export function buildRockMesh(field: SdfField, cell: number, pad = 1.5): RockMesh {
  const bb = field.aabb;
  const x0 = Math.floor((bb.x0 - pad) / cell) * cell;
  const y0 = Math.floor((bb.y0 - pad) / cell) * cell;
  const z0 = Math.floor((bb.z0 - pad) / cell) * cell;
  const nx = Math.ceil((bb.x1 + pad - x0) / cell) + 1;
  const ny = Math.ceil((bb.y1 + pad - y0) / cell) + 1;
  const nz = Math.ceil((bb.z1 + pad - z0) / cell) + 1;

  // Sparse sample storage: only blocks near the surface get filled.
  const vals = new Float32Array(nx * ny * nz).fill(NaN);
  const si = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  const blockRadius = (BLOCK * cell * Math.SQRT2 * 0.87) + cell * 2;
  const bx = Math.ceil(nx / BLOCK), by = Math.ceil(ny / BLOCK), bz = Math.ceil(nz / BLOCK);

  for (let bk = 0; bk < bz; bk++) for (let bj = 0; bj < by; bj++) for (let bi = 0; bi < bx; bi++) {
    const ci = bi * BLOCK + BLOCK / 2, cj = bj * BLOCK + BLOCK / 2, ck = bk * BLOCK + BLOCK / 2;
    const d = field.sample(x0 + ci * cell, y0 + cj * cell, z0 + ck * cell);
    if (Math.abs(d) > blockRadius) continue;
    const iEnd = Math.min(nx, bi * BLOCK + BLOCK + 1);
    const jEnd = Math.min(ny, bj * BLOCK + BLOCK + 1);
    const kEnd = Math.min(nz, bk * BLOCK + BLOCK + 1);
    for (let k = bk * BLOCK; k < kEnd; k++) {
      const wz = z0 + k * cell;
      for (let j = bj * BLOCK; j < jEnd; j++) {
        const wy = y0 + j * cell;
        for (let i = bi * BLOCK; i < iEnd; i++) {
          const idx = si(i, j, k);
          if (!Number.isNaN(vals[idx])) continue;
          vals[idx] = field.sample(x0 + i * cell, wy, wz);
        }
      }
    }
  }

  const at = (i: number, j: number, k: number) => {
    const v = vals[si(i, j, k)];
    return Number.isNaN(v) ? 1e3 : v;
  };

  // --- Pass 1: one vertex per sign-changing cell, placed at the average of the
  // zero crossings on that cell's twelve edges.
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const ci3 = (i: number, j: number, k: number) => (k * (ny - 1) + j) * (nx - 1) + i;
  const pos: number[] = [];
  const corner = new Float64Array(8);
  const EDGES: [number, number][] = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3],
    [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const CX = [0, 1, 0, 1, 0, 1, 0, 1];
  const CY = [0, 0, 1, 1, 0, 0, 1, 1];
  const CZ = [0, 0, 0, 0, 1, 1, 1, 1];

  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) {
      const v = at(i + CX[c], j + CY[c], k + CZ[c]);
      corner[c] = v;
      if (v < 0) neg++;
    }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) {
      const va = corner[a], vb = corner[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += CX[a] + (CX[b] - CX[a]) * t;
      sy += CY[a] + (CY[b] - CY[a]) * t;
      sz += CZ[a] + (CZ[b] - CZ[a]) * t;
      n++;
    }
    if (!n) continue;
    cellVert[ci3(i, j, k)] = pos.length / 3;
    pos.push(x0 + (i + sx / n) * cell, y0 + (j + sy / n) * cell, z0 + (k + sz / n) * cell);
  }

  // --- Pass 2: quads across every sign-changing grid edge.
  const idx: number[] = [];
  // Winding matters: get it backwards and every surface you can see is really
  // the inside of the far side of the rock, which looks almost right in
  // silhouette and is completely wrong under a light.
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) { idx.push(a, c, b, a, d, c); } else { idx.push(a, b, c, a, c, d); }
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = at(i, j, k);
    if (v0 >= 1e2) continue;
    // +X edge
    if (i + 1 < nx) {
      const v1 = at(i + 1, j, k);
      if (v1 < 1e2 && (v0 < 0) !== (v1 < 0)) {
        quad(cellVert[ci3(i, j - 1, k - 1)], cellVert[ci3(i, j, k - 1)], cellVert[ci3(i, j, k)], cellVert[ci3(i, j - 1, k)], v0 >= 0);
      }
    }
    // +Y edge
    if (j + 1 < ny) {
      const v1 = at(i, j + 1, k);
      if (v1 < 1e2 && (v0 < 0) !== (v1 < 0)) {
        quad(cellVert[ci3(i - 1, j, k - 1)], cellVert[ci3(i, j, k - 1)], cellVert[ci3(i, j, k)], cellVert[ci3(i - 1, j, k)], v0 < 0);
      }
    }
    // +Z edge
    if (k + 1 < nz) {
      const v1 = at(i, j, k + 1);
      if (v1 < 1e2 && (v0 < 0) !== (v1 < 0)) {
        quad(cellVert[ci3(i - 1, j - 1, k)], cellVert[ci3(i, j - 1, k)], cellVert[ci3(i, j, k)], cellVert[ci3(i - 1, j, k)], v0 >= 0);
      }
    }
  }

  // --- Pass 3: exact normals from the field, plus SDF ambient occlusion.
  // Having a real distance field means AO is close to free and actually correct:
  // step away along the normal and ask how much rock is still nearby.
  const count = pos.length / 3;
  const positions = new Float32Array(pos);
  const normals = new Float32Array(count * 3);
  const ao = new Float32Array(count);
  const up = new Float32Array(count);
  const g = { x: 0, y: 1, z: 0 };
  for (let v = 0; v < count; v++) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    field.gradient(px, py, pz, g, cell * 0.5);
    normals[v * 3] = g.x; normals[v * 3 + 1] = g.y; normals[v * 3 + 2] = g.z;
    up[v] = g.y * 0.5 + 0.5;
    let occ = 0, w = 0;
    for (let s = 1; s <= 5; s++) {
      const t = s * cell * 0.9;
      const d = field.sample(px + g.x * t, py + g.y * t, pz + g.z * t);
      occ += (t - d) / t * (1 / s);
      w += 1 / s;
    }
    ao[v] = Math.max(0, Math.min(1, 1 - occ / w * 0.85));
  }

  return { positions, normals, ao, up, indices: new Uint32Array(idx), triangles: idx.length / 3 };
}
