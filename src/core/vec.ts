/**
 * Minimal 3D math. Deliberately dependency-free so the whole simulation layer
 * can run in plain Node for headless physics testing.
 */

export class V3 {
  x: number; y: number; z: number;
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }

  set(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: V3): this { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone(): V3 { return new V3(this.x, this.y, this.z); }

  add(v: V3): this { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaled(v: V3, s: number): this { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  sub(v: V3): this { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  scale(s: number): this { this.x *= s; this.y *= s; this.z *= s; return this; }
  mulEach(v: V3): this { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  neg(): this { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }

  dot(v: V3): number { return this.x * v.x + this.y * v.y + this.z * v.z; }
  len(): number { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  lenSq(): number { return this.x * this.x + this.y * this.y + this.z * this.z; }

  normalize(): this {
    const l = this.len();
    if (l > 1e-9) { this.x /= l; this.y /= l; this.z /= l; }
    return this;
  }

  cross(a: V3, b: V3): this {
    const x = a.y * b.z - a.z * b.y;
    const y = a.z * b.x - a.x * b.z;
    const z = a.x * b.y - a.y * b.x;
    return this.set(x, y, z);
  }

  lerp(v: V3, t: number): this {
    this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t;
    return this;
  }

  distTo(v: V3): number {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  isFinite(): boolean {
    return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z);
  }

  static sub(a: V3, b: V3): V3 { return new V3(a.x - b.x, a.y - b.y, a.z - b.z); }
  static add(a: V3, b: V3): V3 { return new V3(a.x + b.x, a.y + b.y, a.z + b.z); }
  static cross(a: V3, b: V3): V3 { return new V3().cross(a, b); }
}

/** Quaternion (x, y, z, w). Represents body -> world rotation. */
export class Quat {
  x: number; y: number; z: number; w: number;
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }

  set(x: number, y: number, z: number, w: number): this { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q: Quat): this { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  clone(): Quat { return new Quat(this.x, this.y, this.z, this.w); }
  identity(): this { return this.set(0, 0, 0, 1); }

  setAxisAngle(ax: V3, ang: number): this {
    const h = ang * 0.5, s = Math.sin(h);
    return this.set(ax.x * s, ax.y * s, ax.z * s, Math.cos(h));
  }

  /** this = a * b  (apply b first, then a) */
  mul(a: Quat, b: Quat): this {
    const ax = a.x, ay = a.y, az = a.z, aw = a.w;
    const bx = b.x, by = b.y, bz = b.z, bw = b.w;
    return this.set(
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    );
  }

  premul(q: Quat): this { return this.mul(q, this); }
  postmul(q: Quat): this { return this.mul(this, q); }

  conjugate(): this { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }

  normalize(): this {
    const l = Math.hypot(this.x, this.y, this.z, this.w);
    if (l > 1e-9) { this.x /= l; this.y /= l; this.z /= l; this.w /= l; } else { this.identity(); }
    return this;
  }

  /** Rotate a vector by this quaternion (in place on `out`). */
  rotate(v: V3, out = new V3()): V3 {
    const { x, y, z, w } = this;
    // t = 2 * (q_vec x v)
    const tx = 2 * (y * v.z - z * v.y);
    const ty = 2 * (z * v.x - x * v.z);
    const tz = 2 * (x * v.y - y * v.x);
    return out.set(
      v.x + w * tx + (y * tz - z * ty),
      v.y + w * ty + (z * tx - x * tz),
      v.z + w * tz + (x * ty - y * tx),
    );
  }

  /** Rotate a vector by the inverse of this quaternion. */
  unrotate(v: V3, out = new V3()): V3 {
    const { x, y, z, w } = this;
    const tx = 2 * (-y * v.z + z * v.y);
    const ty = 2 * (-z * v.x + x * v.z);
    const tz = 2 * (-x * v.y + y * v.x);
    return out.set(
      v.x + w * tx + (-y * tz + z * ty),
      v.y + w * ty + (-z * tx + x * tz),
      v.z + w * tz + (-x * ty + y * tx),
    );
  }

  /** Integrate orientation by angular velocity w (world space) over dt. */
  integrate(w: V3, dt: number): this {
    const hx = w.x * dt * 0.5, hy = w.y * dt * 0.5, hz = w.z * dt * 0.5;
    const { x, y, z, w: qw } = this;
    this.x += qw * hx + hy * z - hz * y;
    this.y += qw * hy + hz * x - hx * z;
    this.z += qw * hz + hx * y - hy * x;
    this.w += -(hx * x + hy * y + hz * z);
    return this.normalize();
  }

  slerp(q: Quat, t: number): this {
    let cos = this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
    let bx = q.x, by = q.y, bz = q.z, bw = q.w;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let s0: number, s1: number;
    if (cos > 0.9995) { s0 = 1 - t; s1 = t; }
    else {
      const theta = Math.acos(cos), sin = Math.sin(theta);
      s0 = Math.sin((1 - t) * theta) / sin;
      s1 = Math.sin(t * theta) / sin;
    }
    return this.set(
      this.x * s0 + bx * s1, this.y * s0 + by * s1,
      this.z * s0 + bz * s1, this.w * s0 + bw * s1,
    ).normalize();
  }

  isFinite(): boolean {
    return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z) && Number.isFinite(this.w);
  }

  /** Shortest-arc rotation taking unit vector `from` to unit vector `to`. */
  static between(from: V3, to: V3): Quat {
    const d = from.dot(to);
    if (d > 0.999999) return new Quat();
    if (d < -0.999999) {
      // 180 degrees: pick any perpendicular axis
      let ax = V3.cross(new V3(1, 0, 0), from);
      if (ax.lenSq() < 1e-6) ax = V3.cross(new V3(0, 1, 0), from);
      return new Quat().setAxisAngle(ax.normalize(), Math.PI);
    }
    const c = V3.cross(from, to);
    return new Quat(c.x, c.y, c.z, 1 + d).normalize();
  }
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach. `rate` = how much closes per second. */
export const damp = (a: number, b: number, rate: number, dt: number) =>
  b + (a - b) * Math.exp(-rate * dt);
export const dampV = (a: V3, b: V3, rate: number, dt: number) => {
  const k = Math.exp(-rate * dt);
  a.x = b.x + (a.x - b.x) * k;
  a.y = b.y + (a.y - b.y) * k;
  a.z = b.z + (a.z - b.z) * k;
  return a;
};
/** Deterministic hash-based noise, for reproducible level detail. */
export function hash11(n: number): number {
  let x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}
export function hash21(x: number, y: number): number {
  let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
