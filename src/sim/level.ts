import { V3 } from '../core/vec.ts';
import { SdfField, sphere, box, capsule, carve } from './sdf.ts';
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

export interface Obb {
  x: number; y: number; z: number;
  hx: number; hy: number; hz: number;
  yaw: number;
  hard: number;
  /** Rendering hint. Defaults to a size-based guess (see props.ts) if unset. */
  mat?: 'wood' | 'stone';
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
    // The broadphase must exist before anything can query the field, and
    // buildSpots ray-marches it to find each standing surface.
    this.rock.build();
    this.buildSpots();
  }

  // ---------------------------------------------------------------- geometry

  private buildRock() {
    const R = this.rock;

    // --- Main headland. One tall leaning mass rather than a stack of slabs,
    // then vertical buttress ribs down the seaward face. Those ribs are what
    // makes real limestone sea cliffs read as tall: the eye follows the flutes.
    R.add(
      box(-31, 12, -2, 18, 26, 30, 1.2, 0.07, 1.1),
      box(-34, 33, -4, 15, 12, 24, 1.0, -0.12, 1.2),
      box(-39, 43, 1, 12, 8, 17, 0.9, 0.10, 1.2),
      box(-26, 4, 18, 12, 12, 12, 0.9, 0.30, 1.3),
      box(-25, 3, -26, 13, 11, 12, 0.9, -0.24, 1.3),
    );

    // Buttress ribs on the face, at varied heights so the skyline is not level.
    const ribs: [number, number, number, number, number][] = [
      // xTop, zTop, topY, baseX, radius
      [-13.6, 12.0, 20.0, -17.5, 3.2],
      [-12.2, 4.5, 27.5, -16.5, 3.6],
      [-13.0, -3.0, 33.0, -17.0, 3.3],
      [-14.4, -11.0, 24.0, -18.0, 3.5],
      [-13.2, -19.0, 17.0, -17.0, 3.0],
      [-15.5, 20.0, 14.0, -19.0, 2.8],
    ];
    for (const [xt, zt, topY, xb, r] of ribs) {
      R.add(capsule(xb, -10, zt, xt, topY, zt, r, 1.1));
    }

    // Overhangs and a couple of caves cut into the face.
    R.add(
      box(-15.5, 30.5, -3.0, 4.0, 2.6, 6.0, 0.6, 0.16, 1.0),
      box(-16.0, 19.0, 11.0, 3.4, 2.2, 5.0, 0.6, -0.14, 1.0),
    );
    R.add(
      carve(capsule(-11.5, 2.0, -8.0, -16.5, 3.4, -8.4, 2.9, 1.6)),
      carve(sphere(-13.0, 6.5, 15.5, 3.2, 1.6)),
      carve(sphere(-15.5, 26.0, 5.0, 2.8, 1.4)),
    );

    // Talus: boulders piled where the face has collapsed into the sea.
    R.add(
      sphere(-11.5, 1.0, 2.0, 3.6, 2.0),
      sphere(-9.8, -0.6, -14.5, 3.2, 1.8),
      sphere(-12.5, 0.4, 22.0, 3.4, 1.9),
      sphere(-10.2, 2.6, -21.0, 2.7, 1.6),
    );

    // Ledges. Each one is a shelf pushed out of the face; the visual mesh and
    // the surface you stand on are the same surface.
    R.add(
      box(-7.9, 5.4, 6.0, 3.7, 1.5, 3.0, 0.5, 0.16, 1.4),   // The Shelf
      box(-9.6, 12.1, -6.0, 3.4, 1.5, 2.6, 0.5, -0.12, 1.4), // Gull Ledge
    );

    // --- Sea stack: "The Mast". Tall, tapering, standing alone in deep water.
    R.add(
      capsule(9.4, -10, -19.4, 11.2, 21, -18.6, 4.7, 2.2),
      capsule(11.2, 19, -18.6, 11.0, 32.4, -18.3, 2.9, 1.8),
      sphere(11.0, 33.2, -18.3, 2.6, 1.4),
      capsule(13.6, -6, -21.0, 12.8, 13, -20.6, 2.6, 1.8),
      capsule(7.4, -6, -16.4, 8.2, 9, -16.8, 2.3, 1.8),
      sphere(12.6, 1.0, -21.8, 3.9, 2.2),
      sphere(7.6, 0.4, -15.6, 3.4, 2.0),
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

    // --- The Watchtower's stone plinth: the last few courses of masonry
    // blend into the summit rock, the way an old coastal tower's base always
    // does after a century of weather. The straight shaft above is a prop.
    R.add(
      box(-38, 52, 1, 3.4, 2.0, 3.4, 0.5, 0.0, 1.0),
    );


    // --- Far headland closing the bay to the north, for composition and depth.
    R.add(
      box(-30, 5, -86, 30, 13, 16, 3.0, 0.06, 3.0),
      box(4, 3, -96, 26, 9, 13, 3.0, -0.10, 3.0),
      sphere(24, 1.0, -80, 7.5, 3.0),
      sphere(-6, 4.0, -78, 8.0, 3.0),
      box(58, 2, 46, 22, 7, 15, 3.0, 0.22, 3.0),
      sphere(40, 1.0, 40, 8.0, 3.0),
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

    // --- The Watchtower: a square stone lookout tower built on the headland's
    // highest point, tapering as it rises the way real masonry towers do to
    // keep their weight down.
    this.props.push(
      { x: -38, y: 61.5, z: 1, hx: 2.9, hy: 8.0, hz: 2.9, yaw: 0.0, hard: 0.7, mat: 'stone' },   // lower shaft
      { x: -38, y: 77.5, z: 1, hx: 2.45, hy: 8.0, hz: 2.45, yaw: 0.05, hard: 0.7, mat: 'stone' }, // mid shaft
      { x: -38, y: 92.5, z: 1, hx: 2.0, hy: 7.0, hz: 2.0, yaw: 0.09, hard: 0.7, mat: 'stone' },   // upper shaft
      { x: -38, y: 101.2, z: 1, hx: 2.55, hy: 1.7, hz: 2.55, yaw: 0.09, hard: 0.7, mat: 'stone' }, // lookout room
    );
    // A hundred-metre drop straight off the tower's own footprint would clip
    // the headland's upper face at exactly the charge levels that push you
    // just far enough out to reach it and no further -- the same cliff every
    // other spot on the headland already launches clear of, because they all
    // stand nearer its edge than the summit ever gets you. So a long wooden
    // gangway walks the jump-off point out past the whole silhouette instead,
    // to the same longitude the Shelf and Gull Ledge already prove safe.
    // Collision is just the walking surface: four level deck segments. The
    // bracing back to the tower is decoration (see props.ts) kept clear of
    // the launch path on purpose, the same way a real gangway's underside
    // strutwork is nowhere near where you'd actually take off from.
    this.props.push(
      { x: -32.0, y: 102.4, z: 1, hx: 4.0, hy: 0.20, hz: 1.3, yaw: 0.0, hard: 0.55 },
      { x: -23.5, y: 102.4, z: 1, hx: 5.0, hy: 0.20, hz: 1.3, yaw: 0.0, hard: 0.55 },
      { x: -14.5, y: 102.4, z: 1, hx: 5.5, hy: 0.20, hz: 1.3, yaw: 0.0, hard: 0.55 },
      { x: -7.5, y: 102.4, z: 1, hx: 4.5, hy: 0.20, hz: 1.6, yaw: 0.0, hard: 0.6 },  // jump-off deck
    );
  }

  /**
   * Find the standing surface below a point. Spots resolve their own height
   * this way rather than carrying a hardcoded number, so retuning the rock can
   * never quietly leave a diver spawning inside a cliff or hovering above one.
   */
  surfaceBelow(x: number, z: number, fromY: number): number {
    for (const p of this.props) {
      if (Math.abs(x - p.x) <= p.hx && Math.abs(z - p.z) <= p.hz && p.y + p.hy <= fromY) {
        return p.y + p.hy;
      }
    }
    let y = fromY;
    let d = this.rock.sample(x, y, z);
    for (let i = 0; i < 400 && y > -6; i++) {
      if (d < 0.015) return y;
      y -= Math.max(0.02, Math.min(d * 0.6, 1.0));
      d = this.rock.sample(x, y, z);
    }
    return y;
  }

  private buildSpots() {
    this.spots = [
      { id: 'shelf', name: 'The Shelf', pos: new V3(-4.9, 6.58, 6.0), yaw: 0.10, height: 6.6, blurb: 'Low and forgiving. Learn the timing here.' },
      { id: 'gull', name: 'Gull Ledge', pos: new V3(-6.9, 13.68, -6.0), yaw: -0.08, height: 13.6, blurb: 'Enough air for a double. Mind the face on the way out.' },
      { id: 'arch', name: 'The Arch', pos: new V3(12.0, 24.32, 17.4), yaw: 0.04, height: 24.3, blurb: 'The far leg is right under you. Jump lazy and you find it.' },
      { id: 'plank', name: 'The Plank', pos: new V3(-3.2, 27.92, -0.4), yaw: 0.0, height: 27.9, blurb: 'Weathered timber, deep water, nothing in the way.' },
      { id: 'mast', name: 'The Mast', pos: new V3(18.4, 33.82, -18.3), yaw: -0.05, height: 33.8, blurb: 'Four seconds of falling. Do something with them.' },
      { id: 'tower', name: 'The Watchtower', pos: new V3(-3.5, 102.62, 1.0), yaw: 0.0, height: 102.6, blurb: 'A hundred metres up. You will have time to think about this on the way down.' },
    ];
    // Resolve each spot onto the surface that is actually there.
    for (const s of this.spots) {
      s.pos.y = this.surfaceBelow(s.pos.x, s.pos.z, s.pos.y + 6);
      s.height = s.pos.y - this.seaY;
    }
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

  /**
   * Seabed, derived from distance to the rock rather than from a coordinate
   * ramp. That gives every stack and boulder its own steep sandy collar and
   * leaves the middle of the bay properly deep, which is both what a limestone
   * coast actually looks like and what the game wants: nowhere you would
   * plausibly land is shallow.
   */
  bedHeight(x: number, z: number): number {
    const toRock = Math.max(0, this.rock.sample(x, 0.3, z));
    const ripple = 0.8 * Math.sin(x * 0.09 + z * 0.13) + 0.5 * Math.cos(x * 0.17 - z * 0.07);
    const shelf = -1.1 - toRock * 2.45 - Math.max(0, toRock - 7) * 1.1;
    return Math.max(-26, Math.min(-1.1, shelf + ripple * Math.min(1, toRock * 0.25)));
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

  /** Unique id, so per-spot bests can be kept per map. */
  readonly id: string = 'calanera';

  /** Nearest named landmark to a point, within `range` metres. */
  nearestSpot(x: number, y: number, z: number, range: number): Spot | null {
    let best: Spot | null = null;
    let bestD = range * range;
    for (const s of this.spots) {
      const dx = s.pos.x - x, dy = (s.pos.y - y) * 1.6, dz = s.pos.z - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /** Is this point inside a man-made prop? Used by the walker's edge probe. */
  propAt(x: number, y: number, z: number): boolean {
    for (let i = 0; i < this.props.length; i++) {
      const b = this.props[i];
      let dx = x - b.x, dz = z - b.z;
      if (b.yaw !== 0) {
        const c = Math.cos(-b.yaw), s = Math.sin(-b.yaw);
        const nx = dx * c - dz * s; dz = dx * s + dz * c; dx = nx;
      }
      if (Math.abs(dx) <= b.hx && Math.abs(y - b.y) <= b.hy && Math.abs(dz) <= b.hz) return true;
    }
    return false;
  }

  /** Approximate distance to the nearest solid surface. Used for near-miss scoring. */
  clearance(x: number, y: number, z: number): number {
    return Math.min(this.rock.sample(x, y, z), y - this.bedHeight(x, z));
  }
}
