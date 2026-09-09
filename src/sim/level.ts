import { V3 } from '../core/vec.ts';
import { SdfField, sphere, box, capsule, carve } from './sdf.ts';
import type { CollisionWorld, Contact } from './body.ts';

export type MapId = 'calanera' | 'jungle' | 'spain' | 'italy';
export const MAP_IDS: MapId[] = ['calanera', 'jungle', 'spain', 'italy'];
export const MAP_NAMES: Record<MapId, string> = {
  calanera: 'Cala Nera',
  jungle: 'Emerald Gorge',
  spain: 'Costa Brava',
  italy: 'Amalfi Heights',
};

export function mapIdFrom(value: string | null | undefined): MapId {
  return MAP_IDS.includes(value as MapId) ? value as MapId : 'calanera';
}

export interface Spot {
  id: string;
  name: string;
  pos: V3;
  /** Facing yaw: 0 = +X. */
  yaw: number;
  height: number;
  blurb: string;
}

export interface Obb {
  x: number; y: number; z: number;
  hx: number; hy: number; hz: number;
  yaw: number;
  hard: number;
  /** `rock` is used for high islands so they do not enlarge the ground SDF mesh. */
  mat?: 'wood' | 'stone' | 'rock';
}

export interface Scenery {
  kind: 'pine' | 'palm' | 'jungle' | 'cypress' | 'agave';
  x: number; y: number; z: number;
  scale: number;
  yaw: number;
}

const _g = { x: 0, y: 1, z: 0 };

/**
 * One physical world. Natural ground is an SDF so visible rock and collision
 * are the same object. High floating islands are intentionally kept as exact
 * OBB clusters: putting 500 m islands inside the ground SDF would make the
 * surface-net volume span ground -> 500 m and waste hundreds of MB meshing air.
 */
export class Level implements CollisionWorld {
  rock = new SdfField();
  props: Obb[] = [];
  spots: Spot[] = [];
  scenery: Scenery[] = [];
  time = 0;

  readonly seaY = 0;
  readonly extent: number;
  readonly id: MapId;
  readonly name: string;

  constructor(id: MapId | string = 'calanera') {
    this.id = mapIdFrom(String(id));
    this.name = MAP_NAMES[this.id];
    this.extent = this.id === 'jungle' ? 165 : 150;

    if (this.id === 'jungle') this.buildJungleRock();
    else if (this.id === 'spain') this.buildSpainRock();
    else if (this.id === 'italy') this.buildItalyRock();
    else this.buildCalaRock();

    if (this.id === 'jungle') this.buildJungleProps();
    else if (this.id === 'spain') this.buildSpainProps();
    else if (this.id === 'italy') this.buildItalyProps();
    else this.buildCalaProps();

    this.rock.build();
    this.buildSpots();
    this.buildScenery();
  }

  // ----------------------------------------------------------------- CALA NERA

  private buildCalaRock() {
    const R = this.rock;
    R.add(
      box(-31, 12, -2, 18, 26, 30, 1.2, 0.07, 1.1),
      box(-34, 33, -4, 15, 12, 24, 1.0, -0.12, 1.2),
      box(-39, 43, 1, 12, 8, 17, 0.9, 0.10, 1.2),
      box(-26, 4, 18, 12, 12, 12, 0.9, 0.30, 1.3),
      box(-25, 3, -26, 13, 11, 12, 0.9, -0.24, 1.3),
      // Long coastal shoulders stop the headland reading like one isolated blob.
      box(-53, 18, 30, 23, 20, 15, 2.2, 0.20, 3.4),
      box(-57, 14, -36, 26, 17, 17, 2.4, -0.16, 3.6),
      capsule(-74, -8, 36, -48, 27, 28, 6.2, 3.2),
      capsule(-78, -8, -42, -47, 24, -32, 6.5, 3.1),
    );

    const ribs: [number, number, number, number, number][] = [
      [-13.6, 12.0, 20.0, -17.5, 3.2], [-12.2, 4.5, 27.5, -16.5, 3.6],
      [-13.0, -3.0, 33.0, -17.0, 3.3], [-14.4, -11.0, 24.0, -18.0, 3.5],
      [-13.2, -19.0, 17.0, -17.0, 3.0], [-15.5, 20.0, 14.0, -19.0, 2.8],
    ];
    for (const [xt, zt, topY, xb, r] of ribs) R.add(capsule(xb, -10, zt, xt, topY, zt, r, 1.1));

    R.add(
      box(-15.5, 30.5, -3.0, 4.0, 2.6, 6.0, 0.6, 0.16, 1.0),
      box(-16.0, 19.0, 11.0, 3.4, 2.2, 5.0, 0.6, -0.14, 1.0),
      carve(capsule(-11.5, 2.0, -8.0, -16.5, 3.4, -8.4, 2.9, 1.6)),
      carve(sphere(-13.0, 6.5, 15.5, 3.2, 1.6)),
      carve(sphere(-15.5, 26.0, 5.0, 2.8, 1.4)),
    );

    R.add(
      sphere(-11.5, 1.0, 2.0, 3.6, 2.0), sphere(-9.8, -0.6, -14.5, 3.2, 1.8),
      sphere(-12.5, 0.4, 22.0, 3.4, 1.9), sphere(-10.2, 2.6, -21.0, 2.7, 1.6),
      box(-7.9, 5.4, 6.0, 3.7, 1.5, 3.0, 0.5, 0.16, 1.4),
      box(-9.6, 12.1, -6.0, 3.4, 1.5, 2.6, 0.5, -0.12, 1.4),
    );

    R.add(
      capsule(9.4, -10, -19.4, 11.2, 21, -18.6, 4.7, 2.2),
      capsule(11.2, 19, -18.6, 11.0, 32.4, -18.3, 2.9, 1.8),
      sphere(11.0, 33.2, -18.3, 2.6, 1.4),
      capsule(13.6, -6, -21.0, 12.8, 13, -20.6, 2.6, 1.8),
      capsule(7.4, -6, -16.4, 8.2, 9, -16.8, 2.3, 1.8),
      sphere(12.6, 1.0, -21.8, 3.9, 2.2), sphere(7.6, 0.4, -15.6, 3.4, 2.0),
    );

    R.add(
      capsule(-6.0, -8, 14.0, -5.0, 19.0, 14.6, 4.2, 2.8),
      capsule(8.2, -8, 19.0, 9.2, 18.0, 19.5, 3.5, 2.6),
      box(2.8, 21.6, 17.2, 10.4, 2.9, 3.6, 1.0, 0.09, 2.6),
      sphere(-4.0, 20.0, 15.0, 3.4, 2.4), sphere(9.0, 19.4, 19.2, 2.8, 2.4),
      carve(capsule(1.6, 6.0, 16.6, 1.9, 15.0, 16.9, 5.4, 2.2)),
      carve(sphere(1.7, 13.0, 16.8, 5.0, 2.2)),
    );

    R.add(
      sphere(-3.0, -1.2, 21.0, 3.2, 1.6), sphere(-1.0, -2.0, 24.5, 2.8, 1.6),
      sphere(-5.5, -0.4, -20.0, 2.6, 1.4), sphere(-2.5, -2.4, -23.0, 3.0, 1.5),
      sphere(19.0, -1.6, 6.0, 3.4, 1.8),
      box(-38, 52, 1, 3.4, 2.0, 3.4, 0.5, 0.0, 1.0),
      box(-30, 5, -86, 30, 13, 16, 3.0, 0.06, 3.0),
      box(4, 3, -96, 26, 9, 13, 3.0, -0.10, 3.0),
      sphere(24, 1.0, -80, 7.5, 3.0), sphere(-6, 4.0, -78, 8.0, 3.0),
      box(58, 2, 46, 22, 7, 15, 3.0, 0.22, 3.0), sphere(40, 1.0, 40, 8.0, 3.0),
    );
  }

  private buildCalaProps() {
    this.props.push(
      { x: -6.6, y: 27.7, z: -0.4, hx: 4.6, hy: 0.22, hz: 1.05, yaw: 0, hard: 0.55 },
      { x: -10.2, y: 26.3, z: -1.3, hx: 0.9, hy: 1.5, hz: 0.18, yaw: 0, hard: 0.55 },
      { x: -10.2, y: 26.3, z: 0.5, hx: 0.9, hy: 1.5, hz: 0.18, yaw: 0, hard: 0.55 },
      { x: 15.4, y: 33.6, z: -18.3, hx: 4.2, hy: 0.22, hz: 1.5, yaw: 0, hard: 0.6 },
      { x: 12.2, y: 34.6, z: -19.5, hx: 0.16, hy: 0.85, hz: 0.16, yaw: 0, hard: 0.5 },
      { x: 12.2, y: 34.6, z: -17.1, hx: 0.16, hy: 0.85, hz: 0.16, yaw: 0, hard: 0.5 },
      { x: -38, y: 61.5, z: 1, hx: 2.9, hy: 8, hz: 2.9, yaw: 0, hard: 0.7, mat: 'stone' },
      { x: -38, y: 77.5, z: 1, hx: 2.45, hy: 8, hz: 2.45, yaw: 0.05, hard: 0.7, mat: 'stone' },
      { x: -38, y: 92.5, z: 1, hx: 2.0, hy: 7, hz: 2.0, yaw: 0.09, hard: 0.7, mat: 'stone' },
      { x: -38, y: 101.2, z: 1, hx: 2.55, hy: 1.7, hz: 2.55, yaw: 0.09, hard: 0.7, mat: 'stone' },
      { x: -32, y: 102.4, z: 1, hx: 4, hy: 0.20, hz: 1.3, yaw: 0, hard: 0.55 },
      { x: -23.5, y: 102.4, z: 1, hx: 5, hy: 0.20, hz: 1.3, yaw: 0, hard: 0.55 },
      { x: -14.5, y: 102.4, z: 1, hx: 5.5, hy: 0.20, hz: 1.3, yaw: 0, hard: 0.55 },
      { x: -7.5, y: 102.4, z: 1, hx: 4.5, hy: 0.20, hz: 1.6, yaw: 0, hard: 0.6 },
    );
    this.addSkyIsland(34, 180, 24, 8.5, 6.5, 8, 0.18);
    this.addSkyIsland(10, 320, -32, 10.5, 8.0, 10, -0.12);
    this.addSkyIsland(48, 500, -2, 13.0, 9.5, 12, 0.08);
  }

  // ------------------------------------------------------------- EMERALD GORGE

  private buildJungleRock() {
    const R = this.rock;
    // A long karst gorge with several separate towers instead of one solid mass.
    R.add(
      box(-48, 15, 0, 20, 27, 54, 3.2, -0.08, 4.0),
      box(46, 13, 3, 18, 23, 50, 3.2, 0.10, 4.0),
      capsule(-22, -8, -44, -17, 48, -38, 8.0, 4.0),
      capsule(25, -8, -31, 20, 58, -28, 7.5, 4.0),
      capsule(-18, -8, 42, -12, 64, 37, 8.5, 4.0),
      capsule(18, -8, 50, 13, 42, 46, 7.0, 3.5),
      sphere(-10, 70, 35, 8.0, 3.2),
      sphere(19, 62, -28, 7.0, 3.0),
      // River-level boulders and shelves.
      sphere(-7, 0, 5, 6.2, 2.5), sphere(11, -1, -2, 5.5, 2.3),
      sphere(5, -2, 26, 4.8, 2.0), sphere(-12, -1, -22, 5.2, 2.1),
      box(-20, 16, 8, 8, 2.0, 7, 1.2, 0.12, 2.0),
      box(22, 28, 14, 7, 2.1, 6, 1.1, -0.18, 2.0),
      // Real openings through the karst.
      carve(capsule(-39, 6, -16, -39, 24, -15, 8.2, 3.0)),
      carve(capsule(40, 4, 26, 40, 21, 24, 7.0, 2.8)),
    );
  }

  private buildJungleProps() {
    // Rope-bridge style decks are walkable but still use exact box collision.
    this.props.push(
      { x: -13, y: 36.5, z: -38, hx: 5.5, hy: 0.18, hz: 1.2, yaw: 0.08, hard: 0.5 },
      { x: 15, y: 57.5, z: -28, hx: 5.0, hy: 0.18, hz: 1.25, yaw: -0.06, hard: 0.5 },
      { x: -7, y: 67.2, z: 36, hx: 5.8, hy: 0.18, hz: 1.2, yaw: 0.02, hard: 0.5 },
    );
    this.addSkyIsland(5, 420, 12, 14, 11, 13, 0.21);
  }

  // ------------------------------------------------------------------- SPAIN

  private buildSpainRock() {
    const R = this.rock;
    // Dry Mediterranean cala: lower layered limestone, sea caves and detached needles.
    R.add(
      box(-40, 11, -5, 28, 20, 38, 3.0, 0.08, 4.2),
      box(-66, 8, 26, 25, 15, 20, 3.0, 0.20, 4.0),
      box(-62, 7, -38, 27, 14, 21, 3.0, -0.16, 4.0),
      capsule(-16, -9, 22, -10, 33, 20, 5.8, 2.8),
      capsule(-13, -9, -18, -7, 25, -17, 5.1, 2.6),
      capsule(22, -10, 28, 21, 29, 28, 4.3, 2.4),
      capsule(31, -10, -26, 31, 39, -25, 4.8, 2.5),
      box(-8, 19, 5, 7, 2.2, 8, 1.0, 0.04, 2.0),
      sphere(8, -1, 12, 4.8, 2.0), sphere(14, -2, -10, 4.2, 1.9),
      carve(capsule(-18, 2, 7, -21, 10, 8, 6.0, 2.5)),
      carve(sphere(-20, 12, -17, 5.0, 2.0)),
    );
  }

  private buildSpainProps() {
    this.props.push(
      { x: -3, y: 21.2, z: 5, hx: 4.8, hy: 0.18, hz: 1.0, yaw: 0, hard: 0.55 },
      { x: -48, y: 31, z: -7, hx: 3.0, hy: 6.5, hz: 3.0, yaw: 0.05, hard: 0.7, mat: 'stone' },
      { x: -43, y: 37.7, z: -7, hx: 5.0, hy: 0.18, hz: 1.2, yaw: 0, hard: 0.55 },
    );
    this.addSkyIsland(40, 460, 18, 12, 9, 11, -0.14);
  }

  // -------------------------------------------------------------------- ITALY

  private buildItalyRock() {
    const R = this.rock;
    // Amalfi-like steep coast: tall wall broken by terraces, needles and coves.
    R.add(
      box(-55, 25, 0, 28, 42, 50, 4.0, 0.05, 5.0),
      box(-80, 34, 22, 22, 35, 22, 3.2, 0.18, 4.0),
      box(-76, 30, -34, 24, 32, 24, 3.2, -0.14, 4.2),
      capsule(-24, -10, 30, -18, 50, 27, 6.3, 3.1),
      capsule(-18, -10, -29, -11, 72, -25, 6.6, 3.3),
      capsule(18, -10, 12, 18, 44, 11, 4.5, 2.4),
      capsule(33, -10, -22, 31, 62, -20, 5.2, 2.7),
      box(-26, 38, 7, 10, 2.0, 8, 1.0, 0.08, 2.0),
      box(-31, 58, -18, 8, 2.0, 6, 1.0, -0.10, 2.0),
      sphere(-5, -1, 8, 5.2, 2.2), sphere(9, -2, -13, 4.5, 2.0),
      carve(capsule(-28, 4, 22, -28, 18, 22, 7.0, 2.8)),
      carve(sphere(-20, 27, -28, 5.8, 2.4)),
    );
  }

  private buildItalyProps() {
    this.props.push(
      // Old stone terraces and a monastery-like lookout.
      { x: -20, y: 40.1, z: 7, hx: 5.0, hy: 0.22, hz: 1.2, yaw: 0.04, hard: 0.6, mat: 'stone' },
      { x: -49, y: 69, z: -8, hx: 3.2, hy: 8.0, hz: 3.2, yaw: 0.06, hard: 0.72, mat: 'stone' },
      { x: -44, y: 77.3, z: -8, hx: 5.0, hy: 0.20, hz: 1.2, yaw: 0.02, hard: 0.58 },
    );
    this.addSkyIsland(26, 500, -16, 15, 11, 14, 0.10);
  }

  // --------------------------------------------------------------- HIGH ISLANDS

  /**
   * Build one floating island from several exact OBB rocks. Their broad shape is
   * rendered as faceted stone, but collision remains the same boxes used here.
   * `topY` is the walkable top surface.
   */
  private addSkyIsland(x: number, topY: number, z: number, rx: number, rz: number, depth: number, yaw: number) {
    const hard = 0.95;
    this.props.push(
      { x, y: topY - 0.9, z, hx: rx, hy: 0.9, hz: rz, yaw, hard, mat: 'rock' },
      { x: x - rx * 0.28, y: topY - depth * 0.42, z: z + rz * 0.14, hx: rx * 0.72, hy: depth * 0.38, hz: rz * 0.72, yaw: yaw + 0.18, hard, mat: 'rock' },
      { x: x + rx * 0.24, y: topY - depth * 0.68, z: z - rz * 0.20, hx: rx * 0.54, hy: depth * 0.34, hz: rz * 0.58, yaw: yaw - 0.22, hard, mat: 'rock' },
      { x: x - rx * 0.08, y: topY - depth * 0.93, z: z + rz * 0.04, hx: rx * 0.34, hy: depth * 0.28, hz: rz * 0.38, yaw: yaw + 0.10, hard, mat: 'rock' },
    );
  }

  // --------------------------------------------------------------------- SPOTS

  private buildSpots() {
    if (this.id === 'jungle') {
      this.spots = [
        this.spotDef('river', 'River Shelf', -12, 11, 7, 0.02, 'Low jungle shelf with a wide clean pool.'),
        this.spotDef('fern', 'Fern Wall', -13, 36.7, -38, 0.05, 'A wet karst wall with a long view down the gorge.'),
        this.spotDef('canopy', 'Canopy Deck', 19, 57.7, -28, -0.04, 'Above the canopy. Enough air for serious combinations.'),
        this.spotDef('temple', 'Temple Crown', -2, 67.4, 36, 0.02, 'Highest natural tower in the gorge.'),
        this.spotDef('needle', 'Green Needle', 25, 59, 17, 0.10, 'A narrow detached pinnacle over deep water.'),
        this.spotDef('skyjungle', 'Monsoon Island', 5, 420, 12, 0.04, 'A 420 m floating island. Long fall, thin air, huge speed.'),
      ];
    } else if (this.id === 'spain') {
      this.spots = [
        this.spotDef('cala', 'Cala Shelf', -5, 10, 13, 0.04, 'Warm limestone and an easy first drop.'),
        this.spotDef('cave', 'Blue Cave', -9, 24, -17, -0.03, 'Launch over a carved sea cave.'),
        this.spotDef('needle', 'White Needle', 31, 40, -25, Math.PI, 'A detached limestone needle with open sea below.'),
        this.spotDef('board', 'Fisherman Board', 1, 21.5, 5, 0.0, 'A simple timber board over the cala.'),
        this.spotDef('tower', 'Old Torre', -42, 38, -7, 0.0, 'An old coastal watchtower jump.'),
        this.spotDef('skyspain', 'Sol Island', 40, 460, 18, 0.0, '460 m above the Mediterranean.'),
      ];
    } else if (this.id === 'italy') {
      this.spots = [
        this.spotDef('harbour', 'Harbour Shelf', -8, 14, 16, 0.03, 'A low terrace above clear water.'),
        this.spotDef('terrace', 'Lemon Terrace', -15, 40.4, 7, 0.05, 'A stone terrace cut into the cliff.'),
        this.spotDef('arch', 'Sea Arch', -19, 52, 27, 0.02, 'A high limestone rib above the arch.'),
        this.spotDef('needle', 'Positano Needle', 31, 63, -20, Math.PI, 'Detached rock, nothing but sea below.'),
        this.spotDef('monastery', 'Monastery Walk', -40, 77.6, -8, 0.0, 'Old stone at nearly eighty metres.'),
        this.spotDef('skyitaly', 'Azzurro Island', 26, 500, -16, 0.0, 'The full 500 m simulation drop.'),
      ];
    } else {
      this.spots = [
        this.spotDef('shelf', 'The Shelf', -4.9, 6.58, 6.0, 0.10, 'Low and forgiving. Learn the timing here.'),
        this.spotDef('gull', 'Gull Ledge', -6.9, 13.68, -6.0, -0.08, 'Enough air for a double. Mind the face on the way out.'),
        this.spotDef('arch', 'The Arch', 12.0, 24.32, 17.4, 0.04, 'The far leg is right under you. Jump lazy and you find it.'),
        this.spotDef('plank', 'The Plank', -3.2, 27.92, -0.4, 0, 'Weathered timber, deep water, nothing in the way.'),
        this.spotDef('mast', 'The Mast', 18.4, 33.82, -18.3, -0.05, 'Four seconds of falling. Do something with them.'),
        this.spotDef('tower', 'The Watchtower', -3.5, 102.62, 1.0, 0, 'A hundred metres up. Plenty of time to make a mistake.'),
        this.spotDef('cloudbreak', 'Cloudbreak Island', 34, 180, 24, Math.PI, '180 m. The first high-altitude island.'),
        this.spotDef('highrift', 'High Rift', 10, 320, -32, 0.0, '320 m of real acceleration and aerodynamic drag.'),
        this.spotDef('skyfall', 'Skyfall 500', 48, 500, -2, Math.PI, '500 m above the water. Terminal velocity matters here.'),
      ];
    }

    for (const s of this.spots) {
      s.pos.y = this.surfaceBelow(s.pos.x, s.pos.z, s.pos.y + 6);
      s.height = s.pos.y - this.seaY;
    }
  }

  private spotDef(id: string, name: string, x: number, y: number, z: number, yaw: number, blurb: string): Spot {
    return { id, name, pos: new V3(x, y, z), yaw, height: y - this.seaY, blurb };
  }

  // ------------------------------------------------------------------ SCENERY

  private buildScenery() {
    const add = (kind: Scenery['kind'], pts: Array<[number, number, number]>, base = 1) => {
      for (let i = 0; i < pts.length; i++) {
        const [x, z, scale] = pts[i];
        const y = this.surfaceBelow(x, z, 95);
        if (y < -4 || y > 90) continue;
        this.scenery.push({ kind, x, y, z, scale: scale * base, yaw: (i * 2.399963) % (Math.PI * 2) });
      }
    };

    if (this.id === 'jungle') {
      add('jungle', [[-34,-34,1.2],[-30,-17,1.0],[-38,14,1.3],[-31,32,1.15],[34,-36,1.2],[38,-10,1.0],[35,19,1.25],[30,37,1.1],[-18,28,0.9],[17,34,1.05],[-20,-31,1.1],[23,-22,1.0]], 1.2);
      add('palm', [[-22,8,1],[27,8,1.1],[-14,-8,0.9],[17,21,1]], 1.1);
    } else if (this.id === 'spain') {
      add('pine', [[-43,-28,1],[-48,-12,1.2],[-52,9,1.1],[-46,28,0.9],[-67,16,1.2],[-64,-30,1.0]], 1.0);
      add('agave', [[-18,16,1],[-23,-6,1.2],[-37,25,1.1],[-31,-22,0.9]], 1.0);
    } else if (this.id === 'italy') {
      add('cypress', [[-48,-30,1.1],[-55,-12,1],[-58,12,1.15],[-52,31,1.05],[-70,20,1.2],[-68,-28,1.1]], 1.1);
      add('pine', [[-33,22,1],[-36,-22,1.1],[-44,5,0.9]], 0.95);
    } else {
      add('pine', [[-44,-27,1],[-46,-14,0.9],[-51,15,1.1],[-47,29,1],[-62,31,1.1],[-61,-31,1.05]], 0.85);
    }
  }

  // ------------------------------------------------------------------- SURFACE

  surfaceBelow(x: number, z: number, fromY: number): number {
    let propTop = -Infinity;
    for (const p of this.props) {
      let dx = x - p.x, dz = z - p.z;
      if (p.yaw !== 0) {
        const c = Math.cos(-p.yaw), s = Math.sin(-p.yaw);
        const nx = dx * c - dz * s; dz = dx * s + dz * c; dx = nx;
      }
      const top = p.y + p.hy;
      if (Math.abs(dx) <= p.hx && Math.abs(dz) <= p.hz && top <= fromY) propTop = Math.max(propTop, top);
    }
    if (Number.isFinite(propTop)) return propTop;

    let y = fromY;
    let d = this.rock.sample(x, y, z);
    for (let i = 0; i < 700 && y > -8; i++) {
      if (d < 0.015) return y;
      y -= Math.max(0.02, Math.min(d * 0.6, 1.2));
      d = this.rock.sample(x, y, z);
    }
    return y;
  }

  // ------------------------------------------------------------------- WATER

  waterHeight(x: number, z: number): number {
    const t = this.time;
    return 0.115 * Math.sin(x * 0.135 + z * 0.055 + t * 1.05)
      + 0.072 * Math.sin(x * 0.061 - z * 0.190 + t * 1.47)
      + 0.040 * Math.sin(x * 0.310 + z * 0.245 - t * 2.15);
  }

  waterNormal(x: number, z: number, out: V3): V3 {
    const e = 0.5;
    const hx = this.waterHeight(x + e, z) - this.waterHeight(x - e, z);
    const hz = this.waterHeight(x, z + e) - this.waterHeight(x, z - e);
    return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  }

  bedHeight(x: number, z: number): number {
    const toRock = Math.max(0, this.rock.sample(x, 0.3, z));
    const ripple = 0.8 * Math.sin(x * 0.09 + z * 0.13) + 0.5 * Math.cos(x * 0.17 - z * 0.07);
    const shelf = -1.1 - toRock * 2.45 - Math.max(0, toRock - 7) * 1.1;
    return Math.max(-34, Math.min(-1.1, shelf + ripple * Math.min(1, toRock * 0.25)));
  }

  depthAt(x: number, z: number): number { return Math.max(0, this.seaY - this.bedHeight(x, z)); }

  // --------------------------------------------------------------- COLLISION

  probeSphere(cx: number, cy: number, cz: number, r: number, out: Contact): boolean {
    let hit = false;
    let best = 0;

    const d = this.rock.sample(cx, cy, cz);
    if (d < r) {
      this.rock.gradient(cx, cy, cz, _g);
      out.nx = _g.x; out.ny = _g.y; out.nz = _g.z;
      out.depth = r - d; out.hard = 1;
      best = out.depth; hit = true;
    }

    for (let i = 0; i < this.props.length; i++) {
      const b = this.props[i];
      let dx = cx - b.x, dy = cy - b.y, dz = cz - b.z;
      if (b.yaw !== 0) {
        const c = Math.cos(-b.yaw), s = Math.sin(-b.yaw);
        const nx = dx * c - dz * s; dz = dx * s + dz * c; dx = nx;
      }
      const qx = Math.max(-b.hx, Math.min(b.hx, dx));
      const qy = Math.max(-b.hy, Math.min(b.hy, dy));
      const qz = Math.max(-b.hz, Math.min(b.hz, dz));
      let ox = dx - qx, oy = dy - qy, oz = dz - qz;
      let dist = Math.hypot(ox, oy, oz);
      if (dist > r) continue;
      if (dist < 1e-5) {
        const px = b.hx - Math.abs(dx), py = b.hy - Math.abs(dy), pz = b.hz - Math.abs(dz);
        if (py <= px && py <= pz) { ox = 0; oy = Math.sign(dy) || 1; oz = 0; dist = -py; }
        else if (px <= pz) { ox = Math.sign(dx) || 1; oy = 0; oz = 0; dist = -px; }
        else { ox = 0; oy = 0; oz = Math.sign(dz) || 1; dist = -pz; }
      } else { ox /= dist; oy /= dist; oz /= dist; }
      const depth = r - dist;
      if (depth <= best) continue;
      if (b.yaw !== 0) {
        const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
        const nx = ox * c - oz * s; oz = ox * s + oz * c; ox = nx;
      }
      out.nx = ox; out.ny = oy; out.nz = oz;
      out.depth = depth; out.hard = b.hard;
      best = depth; hit = true;
    }

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

  propAt(x: number, y: number, z: number): boolean {
    for (const b of this.props) {
      let dx = x - b.x, dz = z - b.z;
      if (b.yaw !== 0) {
        const c = Math.cos(-b.yaw), s = Math.sin(-b.yaw);
        const nx = dx * c - dz * s; dz = dx * s + dz * c; dx = nx;
      }
      if (Math.abs(dx) <= b.hx && Math.abs(y - b.y) <= b.hy && Math.abs(dz) <= b.hz) return true;
    }
    return false;
  }

  /** Approximate distance to the nearest solid, including high islands. */
  clearance(x: number, y: number, z: number): number {
    let d = Math.min(this.rock.sample(x, y, z), y - this.bedHeight(x, z));
    for (const b of this.props) d = Math.min(d, this.distanceToObb(x, y, z, b));
    return d;
  }

  private distanceToObb(x: number, y: number, z: number, b: Obb): number {
    let dx = x - b.x, dz = z - b.z;
    if (b.yaw !== 0) {
      const c = Math.cos(-b.yaw), s = Math.sin(-b.yaw);
      const nx = dx * c - dz * s; dz = dx * s + dz * c; dx = nx;
    }
    const qx = Math.abs(dx) - b.hx, qy = Math.abs(y - b.y) - b.hy, qz = Math.abs(dz) - b.hz;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  }
}
