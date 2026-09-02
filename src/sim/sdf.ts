/**
 * The natural rock in the level is one signed distance field built from a
 * handful of primitives with smooth blending. Collision queries and the visual
 * mesh are both generated from this same function, which means the cliff you
 * can see is exactly the cliff you can hit -- no "invisible wall" or "clipped
 * through the rock" class of bug is possible by construction.
 */

export const Prim = { Sphere: 0, Box: 1, Capsule: 2 } as const;
export type PrimKind = 0 | 1 | 2;

export interface Shape {
  kind: PrimKind;
  /** centre / segment start */
  ax: number; ay: number; az: number;
  /** box half extents, or segment end for capsules */
  bx: number; by: number; bz: number;
  r: number;
  /** yaw rotation for boxes, radians */
  yaw: number;
  /** blend radius with the accumulated field */
  k: number;
  /** negative shapes carve caves and arch openings */
  subtract: boolean;
  // cached broadphase bounding sphere
  cx: number; cy: number; cz: number; cr: number;
}

export function sphere(x: number, y: number, z: number, r: number, k = 2): Shape {
  return finish({ kind: Prim.Sphere, ax: x, ay: y, az: z, bx: 0, by: 0, bz: 0, r, yaw: 0, k, subtract: false } as Shape);
}
export function box(x: number, y: number, z: number, hx: number, hy: number, hz: number, round = 0.6, yaw = 0, k = 2): Shape {
  return finish({ kind: Prim.Box, ax: x, ay: y, az: z, bx: hx, by: hy, bz: hz, r: round, yaw, k, subtract: false } as Shape);
}
export function capsule(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, k = 2): Shape {
  return finish({ kind: Prim.Capsule, ax: x0, ay: y0, az: z0, bx: x1, by: y1, bz: z1, r, yaw: 0, k, subtract: false } as Shape);
}
export function carve(s: Shape): Shape { s.subtract = true; return s; }

function finish(s: Shape): Shape {
  if (s.kind === Prim.Sphere) { s.cx = s.ax; s.cy = s.ay; s.cz = s.az; s.cr = s.r; }
  else if (s.kind === Prim.Box) {
    s.cx = s.ax; s.cy = s.ay; s.cz = s.az;
    s.cr = Math.hypot(s.bx, s.by, s.bz) + s.r;
  } else {
    s.cx = (s.ax + s.bx) * 0.5; s.cy = (s.ay + s.by) * 0.5; s.cz = (s.az + s.bz) * 0.5;
    s.cr = Math.hypot(s.bx - s.ax, s.by - s.ay, s.bz - s.az) * 0.5 + s.r;
  }
  return s;
}

function sdShape(s: Shape, px: number, py: number, pz: number): number {
  switch (s.kind) {
    case Prim.Sphere:
      return Math.hypot(px - s.ax, py - s.ay, pz - s.az) - s.r;
    case Prim.Box: {
      let dx = px - s.ax, dy = py - s.ay, dz = pz - s.az;
      if (s.yaw !== 0) {
        const c = Math.cos(-s.yaw), si = Math.sin(-s.yaw);
        const nx = dx * c - dz * si; dz = dx * si + dz * c; dx = nx;
      }
      const qx = Math.abs(dx) - (s.bx - s.r);
      const qy = Math.abs(dy) - (s.by - s.r);
      const qz = Math.abs(dz) - (s.bz - s.r);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
      const outside = Math.hypot(ox, oy, oz);
      const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
      return outside + inside - s.r;
    }
    default: {
      const ax = s.bx - s.ax, ay = s.by - s.ay, az = s.bz - s.az;
      const px0 = px - s.ax, py0 = py - s.ay, pz0 = pz - s.az;
      const dd = ax * ax + ay * ay + az * az;
      let t = dd > 1e-9 ? (px0 * ax + py0 * ay + pz0 * az) / dd : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      return Math.hypot(px0 - ax * t, py0 - ay * t, pz0 - az * t) - s.r;
    }
  }
}

// --- Cheap 3D value noise. Called a lot (once per SDF sample, and the SDF is
// sampled seven times per collision probe), so it is written for speed: an
// integer hash, no gradients, no lookup tables.
function vhash(i: number, j: number, k: number): number {
  let n = (i * 374761393 + j * 668265263 + k * 1274126177) | 0;
  n = (n ^ (n >>> 13)) * 1274126177 | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const c000 = vhash(ix, iy, iz), c100 = vhash(ix + 1, iy, iz);
  const c010 = vhash(ix, iy + 1, iz), c110 = vhash(ix + 1, iy + 1, iz);
  const c001 = vhash(ix, iy, iz + 1), c101 = vhash(ix + 1, iy, iz + 1);
  const c011 = vhash(ix, iy + 1, iz + 1), c111 = vhash(ix + 1, iy + 1, iz + 1);
  const x00 = c000 + (c100 - c000) * fx, x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx, x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

/**
 * Surface detail folded into the distance field itself rather than added as a
 * displacement at mesh time. That costs a little performance on every collision
 * probe, and buys the thing that matters: the ledge you can see is the ledge you
 * land on, right down to the bumps.
 *
 * Three layers, chosen to look like bedded limestone: broad erosion, horizontal
 * bedding planes that undulate, and a medium fracture roughness.
 */
function detail(x: number, y: number, z: number): number {
  const warp = vnoise(x * 0.031, y * 0.019, z * 0.031) - 0.5;
  const bedding = Math.abs(Math.sin(y * 0.46 + warp * 5.6)); // 0 at a plane, 1 mid-bed
  const broad = vnoise(x * 0.058, y * 0.041, z * 0.058) - 0.5;
  const mediumA = vnoise(x * 0.165, y * 0.135, z * 0.165) - 0.5;
  const mediumB = vnoise(x * 0.42, y * 0.36, z * 0.42) - 0.5;
  // Positive = pushed outward. Bedding planes cut IN, so ledges form on top.
  return broad * 1.65 + mediumA * 0.62 + mediumB * 0.26 - (1 - bedding) * 0.30;
}

/** Polynomial smooth min -- gives rock the fused, weathered look of real stone. */
function smin(a: number, b: number, k: number): number {
  if (k <= 1e-4) return Math.min(a, b);
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a: number, b: number, k: number): number {
  if (k <= 1e-4) return Math.max(a, b);
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

export class SdfField {
  shapes: Shape[] = [];
  /** Broadphase grid over XZ so runtime probes only test nearby shapes. */
  private cell = 8;
  private grid = new Map<number, Shape[]>();
  private bounds = { x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 };

  add(...s: Shape[]): this { for (const x of s) this.shapes.push(x); return this; }

  build(): this {
    this.grid.clear();
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (const s of this.shapes) {
      const pad = s.cr + s.k + 1.5;
      x0 = Math.min(x0, s.cx - pad); x1 = Math.max(x1, s.cx + pad);
      y0 = Math.min(y0, s.cy - pad); y1 = Math.max(y1, s.cy + pad);
      z0 = Math.min(z0, s.cz - pad); z1 = Math.max(z1, s.cz + pad);
      const gx0 = Math.floor((s.cx - pad) / this.cell), gx1 = Math.floor((s.cx + pad) / this.cell);
      const gz0 = Math.floor((s.cz - pad) / this.cell), gz1 = Math.floor((s.cz + pad) / this.cell);
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        const key = gx * 73856093 ^ gz * 19349663;
        let list = this.grid.get(key);
        if (!list) this.grid.set(key, list = []);
        list.push(s);
      }
    }
    this.bounds = { x0, y0, z0, x1, y1, z1 };
    return this;
  }

  get aabb() { return this.bounds; }

  nearby(x: number, z: number): Shape[] | undefined {
    const gx = Math.floor(x / this.cell), gz = Math.floor(z / this.cell);
    return this.grid.get(gx * 73856093 ^ gz * 19349663);
  }

  /** Distance to the rock surface. Positive outside. */
  sample(px: number, py: number, pz: number): number {
    const list = this.nearby(px, pz);
    if (!list) return 1e4;
    let d = 1e4;
    let cut = -1e4;   // union of carved volumes, expressed as "inside-ness"
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const bs = Math.hypot(px - s.cx, py - s.cy, pz - s.cz) - s.cr - s.k;
      if (bs > 2.5) continue;                       // far: cannot influence the blend
      const v = sdShape(s, px, py, pz);
      if (s.subtract) cut = smax(cut, -v, s.k);
      else d = smin(d, v, s.k);
    }
    if (cut > -1e3) d = smax(d, cut, 1.2);
    // Only worth evaluating the detail near the surface, where it can matter.
    if (d < 6 && d > -6) d = (d - detail(px, py, pz)) * 0.72;
    return d;
  }

  /** Central-difference gradient (surface normal). */
  gradient(px: number, py: number, pz: number, out: { x: number; y: number; z: number }, h = 0.12) {
    const dx = this.sample(px + h, py, pz) - this.sample(px - h, py, pz);
    const dy = this.sample(px, py + h, pz) - this.sample(px, py - h, pz);
    const dz = this.sample(px, py, pz + h) - this.sample(px, py, pz - h);
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-7) { out.x = 0; out.y = 1; out.z = 0; }
    else { out.x = dx / l; out.y = dy / l; out.z = dz / l; }
  }
}
