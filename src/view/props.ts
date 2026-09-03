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
  const stone = new THREE.MeshStandardMaterial({ color: 0x9a8f7d, roughness: 0.85, metalness: 0.0 });
  const stoneDark = new THREE.MeshStandardMaterial({ color: 0x847a6a, roughness: 0.88, metalness: 0.0 });

  // Collision boxes, drawn as planked decks so they read as built objects.
  for (const b of level.props) {
    const isStone = b.mat === 'stone';
    const isDeck = !isStone && b.hy < 0.4 && b.hx > 0.5;
    if (isStone) {
      // Square masonry, coursed: a stack of slightly recessed courses reads as
      // built stone far more than one flat-shaded box ever will.
      const g = new THREE.Group();
      const courseH = 1.1;
      const courses = Math.max(1, Math.round((b.hy * 2) / courseH));
      for (let i = 0; i < courses; i++) {
        const h = (b.hy * 2) / courses;
        const inset = i % 2 === 0 ? 1.0 : 0.975;
        const m = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2 * inset, h * 0.94, b.hz * 2 * inset), i % 2 ? stone : stoneDark);
        m.position.set(0, -b.hy + h * (i + 0.5), 0);
        m.castShadow = true; m.receiveShadow = true;
        g.add(m);
      }
      g.position.set(b.x, b.y, b.z);
      g.rotation.y = b.yaw;
      grp.add(g);
    } else if (isDeck) {
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

  // The Watchtower: a hundred-metre span like this cannot be braced from
  // below the way a short jetty can (there is nothing underneath most of it
  // but open air), so instead it hangs the way a real cable-stayed bridge
  // does -- from a spire above, not a leg below.
  const spireTop = new THREE.Vector3(-38, 111, 1);
  brace(-38, 102.9, 1, spireTop.x, spireTop.y, spireTop.z, 0.5, steel);
  const gangwaySegs: [number, number][] = [[-32.0, 4.0], [-23.5, 5.0], [-14.5, 5.5], [-7.5, 4.5]];
  for (const [sx, half] of gangwaySegs) {
    for (const sz of [-0.6, 2.6]) {
      brace(spireTop.x, spireTop.y, spireTop.z, sx - half * 0.7, 102.5, sz, 0.045, steel);
      brace(spireTop.x, spireTop.y, spireTop.z, sx + half * 0.7, 102.5, sz, 0.045, steel);
    }
  }
  // Handrail at the jump-off end, the one place on the walk you would
  // actually notice its absence.
  brace(-3.2, 102.6, -1.4, -3.2, 103.7, -1.4, 0.045, steel);
  brace(-3.2, 102.6, 3.4, -3.2, 103.7, 3.4, 0.045, steel);
  brace(-3.2, 103.65, -1.4, -3.2, 103.65, 3.4, 0.04, steel);

  return grp;
}
