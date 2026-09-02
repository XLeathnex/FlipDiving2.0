import * as THREE from 'three';
import type { Level } from '../sim/level.ts';

/**
 * The timber. These are the only man-made things in the cove, and the only
 * geometry that is authored rather than grown from the distance field -- which
 * is right, because a plank really is a box.
 */
export function buildProps(level: Level): THREE.Group {
  const grp = new THREE.Group();
  grp.name = 'props';

  const wood = new THREE.MeshStandardMaterial({ color: 0x8a7358, roughness: 0.88, metalness: 0.0 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x5e4c3a, roughness: 0.9, metalness: 0.0 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x6b6f74, roughness: 0.52, metalness: 0.75 });

  // Collision boxes, drawn as planked decks so they read as built objects.
  for (const b of level.props) {
    const isDeck = b.hy < 0.4 && b.hx > 0.5;
    if (isDeck) {
      const planks = Math.max(2, Math.round(b.hz * 2 / 0.28));
      for (let i = 0; i < planks; i++) {
        const w = (b.hz * 2) / planks;
        const m = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.hy * 2, w * 0.9), i % 2 ? wood : woodDark);
        m.position.set(0, 0, -b.hz + w * (i + 0.5));
        m.castShadow = true; m.receiveShadow = true;
        const g = new THREE.Group();
        g.add(m);
        g.position.set(b.x, b.y, b.z);
        g.rotation.y = b.yaw;
        grp.add(g);
      }
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2), woodDark);
      m.position.set(b.x, b.y, b.z);
      m.rotation.y = b.yaw;
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
    }
  }

  // Non-colliding decoration: the braces that make the cantilevers believable.
  const brace = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, mat: THREE.Material) => {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 7), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.castShadow = true;
    grp.add(m);
  };

  // The Plank: two diagonal stays back into the cliff face.
  brace(-11.0, 27.6, -1.3, -8.6, 24.4, -1.3, 0.075, steel);
  brace(-11.0, 27.6, 0.5, -8.6, 24.4, 0.5, 0.075, steel);
  brace(-10.6, 27.9, -1.35, -10.6, 27.9, 0.55, 0.05, steel);

  // The Mast: a proper little truss under the cantilevered deck.
  brace(11.6, 33.4, -19.5, 18.4, 33.5, -19.5, 0.07, steel);
  brace(11.6, 33.4, -17.1, 18.4, 33.5, -17.1, 0.07, steel);
  brace(11.2, 30.6, -18.3, 17.6, 33.4, -19.4, 0.075, steel);
  brace(11.2, 30.6, -18.3, 17.6, 33.4, -17.2, 0.075, steel);
  // Handrail on the landward end, so the drop end reads as deliberately open.
  brace(12.0, 33.8, -19.6, 12.0, 34.9, -19.6, 0.045, steel);
  brace(12.0, 33.8, -17.0, 12.0, 34.9, -17.0, 0.045, steel);
  brace(12.0, 34.85, -19.6, 12.0, 34.85, -17.0, 0.04, steel);

  return grp;
}
