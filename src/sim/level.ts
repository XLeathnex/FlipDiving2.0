import { V3, clamp01, smoothstep } from '../core/vec.ts';
import { SdfField, sphere, box, capsule, carve, type Shape } from './sdf.ts';
import type { CollisionWorld, Contact } from './body.ts';

/**
 * CALA NERA -- one cove, five ways down.
 *
 * Layout convention: the sea is the +X half of the world, the limestone
 * headland is to the -X side, and divers launch eastward out over open water.
 * The camera lives to the south, giving a profile read on body angle, which is
 * what you actually need in order to judge an entry.
 *
 * Every jump-off point sits above genuinely deep water, but the routes differ:
 * the Arch makes you clear its own far leg, the Mast is a long lonely drop, the
 * Plank overhangs a shallow shelf with rocks off to one side. The variety comes
 * from the geography, not from rules.
 */

export interface Spot {
  id: string;
  name: string;
  /** Standing surface position. */
  pos: V3;
  /** Facing yaw: 0 = +X (out to sea). */
  yaw: number;
  /** Height above mean water. */
  height: number;
  blurb: string;
}

interface Obb {
  x: number; y: number; z: number;
  hx: number; hy: number; hz: number;
  yaw: number;
  hard: number;
}

const _g = { x: 0, y: 1, z: 0 };

export class Level implements CollisionWorld {
  rock = new SdfField();
  /** Man-made structures: exact boxes, because they really are boxes. */
  props: Obb[] = [];
  spots: Spot[] = [];
  time = 0;

  /** Mean sea level. */
  readonly seaY = 0;
  /** Rendering / play bounds. */
  readonly extent = 130;

  constructor() {
    this.buildRock();
    this.buildProps();
    this.buildSpots();
    this.rock.build();
  }

  // ---------------------------------------------------------------- geometry

  private buildRock() {
    const R = this.rock;

    // --- Main headland: a stack of broad, slightly rotated slabs. Rotating each
    // one a little and letting the smooth-union fuse them is what stops the
    // cliff reading as "a pile of boxes" up close.
    const slabs: [number, number, number, number, number, number, number][] = [
      // x,    y,    z,   hx,  hy,  hz,  yaw
      [-30, 4, 0, 17, 10, 30, 0.05],
      [-28, 16, -4, 15, 9, 26, -0.10],
      [-30, 27, 2, 14, 8, 22, 0.14],
      [-33, 36, -2, 12, 7, 17, -0.06],
      [-37, 44, 3, 10, 6, 13, 0.09],
    ];
    for (const [x, y, z, hx, hy, hz, yaw] of slabs) R.add(box(x, y, z, hx, hy, hz, 1.4, yaw, 3.2));

    // Buttresses that make the seaward face steep and undercut, so an eastward
    // jump from any ledge is always clean.
    R.add(
      box(-16.5, 12, 8, 5.5, 13, 9, 1.6, 0.22, 3.0),
      box(-15.0, 6, -10, 6.0, 8, 10, 1.5, -0.18, 3.0),
      box(-17.5, 22, -3, 4.5, 11, 7, 1.4, 0.10, 2.8),
      sphere(-13.5, 3.0, 2, 5.2, 3.4),
      sphere(-14.5, 9.5, -16, 5.6, 3.2),
      sphere(-12.0, 2.0, 16, 4.6, 3.0),
    );

    // Ledges. Each one is a shelf pushed out of the face; the visual mesh and
    // the surface you stand on are the same surface.
    R.add(
      box(-7.9, 5.4, 6.0, 3.7, 1.5, 3.0, 0.5, 0.16, 1.6),   // The Shelf
      box(-9.6, 12.1, -6.0, 3.4, 1.5, 2.6, 0.5, -0.12, 1.6), // Gull Ledge
    );

    // --- Sea stack: "The Mast". Tall, tapering, standing alone in deep water.
    R.add(
      capsule(9.4, -10, -19.4, 11.2, 21, -18.6, 4.7, 3.0),
      capsule(11.2, 19, -18.6, 11.0, 32.4, -18.3, 2.9, 2.4),
      sphere(11.0, 33.2, -18.3, 2.6, 1.8),
      sphere(12.6, 1.0, -21.8, 3.9, 3.0),
      sphere(7.6, 0.4, -15.6, 3.4, 2.8),
    );

    // --- Natural arch spanning the inlet, with the opening carved out.
    R.add(
      capsule(-6.0, -8, 14.0, -5.0, 19.0, 14.6, 4.2, 2.8),   // inland leg
      capsule(8.2, -8, 19.0, 9.2, 18.0, 19.5, 3.5, 2.6),     // seaward leg
      box(2.8, 21.6, 17.2, 10.4, 2.9, 3.6, 1.0, 0.09, 2.6),  // span
      sphere(-4.0, 20.0, 15.0, 3.4, 2.4),
      sphere(9.0, 19.4, 19.2, 2.8, 2.4),
    );
    R.add(carve(capsule(1.6, 6.0, 16.6, 1.9, 15.0, 16.9, 5.4, 2.2)));
    R.add(carve(sphere(1.7, 13.0, 16.8, 5.0, 2.2)));

    // --- Hazards: rocks breaking the surface. These are the reason you look
    // before you leap rather than the reason you are forbidden to.
    R.add(
      sphere(-3.0, -1.2, 21.0, 3.2, 1.6),
      sphere(-1.0, -2.0, 24.5, 2.8, 1.6),
      sphere(-5.5, -0.4, -20.0, 2.6, 1.4),
      sphere(-2.5, -2.4, -23.0, 3.0, 1.5),
      sphere(19.0, -1.6, 6.0, 3.4, 1.8),
    );

    // --- Far headland closing the bay to the north, for composition and depth.
    R.add(
      box(-14, 6, -52, 22, 12, 14, 2.0, 0.10, 4.0),
      box(6, 3, -58, 16, 8, 10, 2.0, -0.12, 4.0),
      sphere(16, 1.0, -46, 6.0, 3.0),
    );
  }

  private buildProps() {
    // The Plank: a weathered timber diving board bolted into the cliff at 28 m.
    // Man-made, so it is an honest box rather than an SDF blob.
    this.props.push(
      { x: -6.6, y: 27.7, z: -0.4, hx: 4.6, hy: 0.22, hz: 1.05, yaw: 0.0, hard: 0.55 },
      // supports
      { x: -10.2, y: 26.3, z: -1.3, hx: 0.9, hy: 1.5, hz: 0.18, yaw: 0.0, hard: 0.55 },
      { x: -10.2, y: 26.3, z: 0.5, hx: 0.9, hy: 1.5, hz: 0.18, yaw: 0.0, hard: 0.55 },
    );
    // The Mast platform: a timber deck cantilevered east off the summit, so the
    // drop is clean all the way down the seaward face.
    this.props.push(
      { x: 15.4, y: 33.6, z: -18.3, hx: 4.2, hy: 0.22, hz: 1.5, yaw: 0.0, hard: 0.6 },
      { x: 12.2, y: 34.6, z: -19.5, hx: 0.16, hy: 0.85, hz: 0.16, yaw: 0, hard: 0.5 },
      { x: 12.2, y: 34.6, z: -17.1, hx: 0.16, hy: 0.85, hz: 0.16, yaw: 0, hard: 0.5 },
    );
  }

  private buildSpots() {
    this.spots = [
      { id: 'shelf', name: 'The Shelf', pos: new V3(-4.9, 6.90, 6.0), yaw: 0.10, height: 6.9, blurb: 'Low and forgiving. Learn the timing here.' },
      { id: 'gull', name: 'Gull Ledge', pos: new V3(-6.9, 13.62, -6.0), yaw: -0.08, height: 13.6, blurb: 'Enough air for a double. Mind the face on the way out.' },
      { id: 'arch', name: 'The Arch', pos: new V3(12.0, 24.50, 17.4), yaw: 0.04, height: 24.5, blurb: 'The far leg is right under you. Jump lazy and you find it.' },
      { id: 'plank', name: 'The Plank', pos: new V3(-3.2, 27.92, -0.4), yaw: 0.0, height: 27.9, blurb: 'Weathered timber, deep water, nothing in the way.' },
      { id: 'mast', name: 'The Mast', pos: new V3(18.4, 33.82, -18.3), yaw: -0.05, height: 33.8, blurb: 'Four seconds of falling. Do something with them.' },
    ];
  }

  // ------------------------------------------------------------------- water

  /** Gentle swell. Small enough to never make an entry unfair. */
  waterHeight(x: number, z: number): number {
    const t = this.time;
    return (
      0.115 * Math.sin(x * 0.135 + z * 0.055 + t * 1.05) +
      0.072 * Math.sin(x * 0.061 - z * 0.190 + t * 1.47) +
      0.040 * Math.sin(x * 0.310 + z * 0.245 - t * 2.15)
    );
  }

  waterNormal(x: number, z: number, out: V3): V3 {
    const e = 0.5;
    const hx = this.waterHeight(x + e, z) - this.waterHeight(x - e, z);
    const hz = this.waterHeight(x, z + e) - this.waterHeight(x, z - e);
    return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  }

  /** Seabed: shelves up steeply against the headland, deep out in the bay. */
  bedHeight(x: number, z: number): number {
    const toShore = smoothstep(-14, 14, x);
    const base = -3.2 - 15.0 * toShore;
    const ripple = 0.9 * Math.sin(x * 0.09 + z * 0.13) + 0.6 * Math.cos(x * 0.17 - z * 0.07);
    return Math.min(-1.2, base + ripple * (0.3 + 0.7 * toShore));
  }

  /** Water depth below the surface at (x, z). Used for splash + murk shading. */
  depthAt(x: number, z: number): number {
    return Math.max(0, this.seaY - this.bedHeight(x, z));
  }

  // --------------------------------------------------------------- collision

  probeSphere(cx: number, cy: number, cz: number, r: number, out: Contact): boolean {
    let hit = false;
    let best = 0;

    // Rock field.
    const d = this.rock.sample(cx, cy, cz);
    if (d < r) {
      this.rock.gradient(cx, cy, cz, _g);
      out.nx = _g.x; out.ny = _g.y; out.nz = _g.z;
      out.depth = r - d; out.hard = 1;
      best = out.depth; hit = true;
    }

    // Man-made boxes (exact OBB test).
    for (let i = 0; i < this.props.length; i++) {
      const b = this.props[i];
      let dx = cx - b.x, dy = cy - b.y, dz = cz - b.z;
      let c = 1, s = 0;
      if (b.yaw !== 0) { c = Math.cos(-b.yaw); s = Math.sin(-b.yaw); const nx = dx * c - dz * s; dz = dx * s + dz * c; dx = nx; }
      const qx = Math.max(-b.hx, Math.min(b.hx, dx));
      const qy = Math.max(-b.hy, Math.min(b.hy, dy));
      const qz = Math.max(-b.hz, Math.min(b.hz, dz));
      let ox = dx - qx, oy = dy - qy, oz = dz - qz;
      let dist = Math.hypot(ox, oy, oz);
      if (dist > r) continue;
      if (dist < 1e-5) {
        // Centre inside the box: push out along the shallowest face.
        const px = b.hx - Math.abs(dx), py = b.hy - Math.abs(dy), pz = b.hz - Math.abs(dz);
        if (py <= px && py <= pz) { ox = 0; oy = Math.sign(dy) || 1; oz = 0; dist = -py; }
        else if (px <= pz) { ox = Math.sign(dx) || 1; oy = 0; oz = 0; dist = -px; }
        else { ox = 0; oy = 0; oz = Math.sign(dz) || 1; dist = -pz; }
      } else { ox /= dist; oy /= dist; oz /= dist; }
      const depth = r - dist;
      if (depth <= best) continue;
      if (b.yaw !== 0) { const cc = Math.cos(b.yaw), ss = Math.sin(b.yaw); const nx = ox * cc - oz * ss; oz = ox * ss + oz * cc; ox = nx; }
      out.nx = ox; out.ny = oy; out.nz = oz;
      out.depth = depth; out.hard = b.hard;
      best = depth; hit = true;
    }

    // Seabed -- sand, soft, but you do not want to find it.
    const bed = this.bedHeight(cx, cz);
    if (cy - r < bed) {
      const depth = bed - (cy - r);
      if (depth > best) {
        const e = 1.0;
        const gx = this.bedHeight(cx + e, cz) - this.bedHeight(cx - e, cz);
        const gz = this.bedHeight(cx, cz + e) - this.bedHeight(cx, cz - e);
        const n = new V3(-gx / (2 * e), 1, -gz / (2 * e)).normalize();
        out.nx = n.x; out.ny = n.y; out.nz = n.z;
        out.depth = depth; out.hard = 0.15;
        hit = true;
      }
    }
    return hit;
  }

  /** Approximate distance to the nearest solid surface. Used for near-miss scoring. */
  clearance(x: number, y: number, z: number): number {
    return Math.min(this.rock.sample(x, y, z), y - this.bedHeight(x, z));
  }
}
