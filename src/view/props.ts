import * as THREE from 'three';
import type { Level, Scenery } from '../sim/level.ts';

/** Built geometry that is not part of the ground SDF: decks, masonry, high islands and vegetation. */
export function buildProps(level: Level): THREE.Group {
  const grp = new THREE.Group();
  grp.name = 'props';

  const wood = new THREE.MeshStandardMaterial({ color: 0x8a7358, roughness: 0.88, metalness: 0 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x5e4c3a, roughness: 0.92, metalness: 0 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x6b6f74, roughness: 0.52, metalness: 0.75 });
  const stone = new THREE.MeshStandardMaterial({ color: level.id === 'spain' ? 0xc0ad86 : level.id === 'italy' ? 0xb5a486 : 0x9a8f7d, roughness: 0.86, metalness: 0 });
  const stoneDark = new THREE.MeshStandardMaterial({ color: level.id === 'spain' ? 0x8e7b58 : 0x7d7363, roughness: 0.9, metalness: 0 });
  const islandRock = new THREE.MeshStandardMaterial({ color: level.id === 'jungle' ? 0x52624d : 0x766d60, roughness: 0.96, metalness: 0 });
  const grass = new THREE.MeshStandardMaterial({ color: level.id === 'spain' ? 0x7d8753 : 0x426a43, roughness: 1, metalness: 0 });

  // Draw the exact collision boxes. Rock islands use nested faceted boxes so
  // their rendered silhouette is the same physical solid the diver collides with.
  for (const b of level.props) {
    if (b.mat === 'rock') {
      const geo = new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2, 2, 2, 2);
      const m = new THREE.Mesh(geo, islandRock);
      m.position.set(b.x, b.y, b.z);
      m.rotation.y = b.yaw;
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
      // Thin vegetation cap on the broad, walkable top slabs only.
      if (b.hy < 1.1 && b.hx > 5) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 1.92, 0.16, b.hz * 1.92), grass);
        cap.position.set(b.x, b.y + b.hy + 0.05, b.z);
        cap.rotation.y = b.yaw;
        cap.receiveShadow = true;
        grp.add(cap);
      }
      continue;
    }

    const isStone = b.mat === 'stone';
    const isDeck = !isStone && b.hy < 0.4 && b.hx > 0.5;
    if (isStone) {
      const g = new THREE.Group();
      const courses = Math.max(1, Math.round((b.hy * 2) / 1.05));
      for (let i = 0; i < courses; i++) {
        const h = (b.hy * 2) / courses;
        const inset = i % 2 === 0 ? 1.0 : 0.975;
        const m = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2 * inset, h * 0.94, b.hz * 2 * inset), i % 2 ? stone : stoneDark);
        m.position.set(0, -b.hy + h * (i + 0.5), 0);
        m.castShadow = true; m.receiveShadow = true;
        g.add(m);
      }
      g.position.set(b.x, b.y, b.z); g.rotation.y = b.yaw; grp.add(g);
    } else if (isDeck) {
      const planks = Math.max(2, Math.round(b.hz * 2 / 0.28));
      for (let i = 0; i < planks; i++) {
        const w = (b.hz * 2) / planks;
        const m = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.hy * 2, w * 0.9), i % 2 ? wood : woodDark);
        m.position.set(0, 0, -b.hz + w * (i + 0.5));
        m.castShadow = true; m.receiveShadow = true;
        const g = new THREE.Group(); g.add(m); g.position.set(b.x, b.y, b.z); g.rotation.y = b.yaw; grp.add(g);
      }
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2), woodDark);
      m.position.set(b.x, b.y, b.z); m.rotation.y = b.yaw; m.castShadow = true; m.receiveShadow = true; grp.add(m);
    }
  }

  const brace = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, mat: THREE.Material) => {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 7), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.castShadow = true; grp.add(m);
  };

  if (level.id === 'calanera') {
    brace(-11.0, 27.6, -1.3, -8.6, 24.4, -1.3, 0.075, steel);
    brace(-11.0, 27.6, 0.5, -8.6, 24.4, 0.5, 0.075, steel);
    brace(11.6, 33.4, -19.5, 18.4, 33.5, -19.5, 0.07, steel);
    brace(11.6, 33.4, -17.1, 18.4, 33.5, -17.1, 0.07, steel);
    const spireTop = new THREE.Vector3(-38, 111, 1);
    brace(-38, 102.9, 1, spireTop.x, spireTop.y, spireTop.z, 0.5, steel);
  }

  for (const s of level.scenery) grp.add(makePlant(s, level.id));

  return grp;
}

function makePlant(s: Scenery, mapId: string): THREE.Group {
  const g = new THREE.Group();
  g.position.set(s.x, s.y, s.z); g.rotation.y = s.yaw; g.scale.setScalar(s.scale);

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5f4934, roughness: 1 });
  const leafColor = mapId === 'jungle' ? 0x2f6a3a : mapId === 'spain' ? 0x506c45 : 0x375d3a;
  const leafMat = new THREE.MeshStandardMaterial({ color: leafColor, roughness: 1 });

  if (s.kind === 'agave') {
    for (let i = 0; i < 9; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.55, 5), leafMat);
      leaf.position.y = 0.55; leaf.rotation.z = 0.75; leaf.rotation.y = i / 9 * Math.PI * 2; g.add(leaf);
    }
    return g;
  }

  if (s.kind === 'palm') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.25, 4.7, 7), trunkMat);
    trunk.position.y = 2.35; trunk.castShadow = true; g.add(trunk);
    for (let i = 0; i < 8; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.22, 3.5, 5), leafMat);
      leaf.position.y = 4.7; leaf.rotation.z = Math.PI / 2.7; leaf.rotation.y = i / 8 * Math.PI * 2; g.add(leaf);
    }
    return g;
  }

  const tall = s.kind === 'cypress';
  const jungle = s.kind === 'jungle';
  const h = tall ? 5.6 : jungle ? 5.0 : 4.3;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.24, h * 0.72, 7), trunkMat);
  trunk.position.y = h * 0.36; trunk.castShadow = true; g.add(trunk);
  if (tall) {
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.72, h * 0.9, 9), leafMat);
    crown.position.y = h * 0.72; crown.castShadow = true; g.add(crown);
  } else {
    const layers = jungle ? 4 : 3;
    for (let i = 0; i < layers; i++) {
      const crown = new THREE.Mesh(new THREE.ConeGeometry((jungle ? 1.9 : 1.45) * (1 - i * 0.12), 2.2, 8), leafMat);
      crown.position.y = h * 0.48 + i * 0.72; crown.castShadow = true; g.add(crown);
    }
  }
  return g;
}
