import * as THREE from 'three';
import { clamp01 } from '../core/vec.ts';

/** A short ribbon behind the diver. Reads rotation far better than the body alone. */
export class Trail {
  mesh: THREE.Mesh;
  private N = 34;
  private hist: THREE.Vector3[] = [];
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private alpha: Float32Array;
  private active = false;

  constructor() {
    this.pos = new Float32Array(this.N * 2 * 3);
    this.alpha = new Float32Array(this.N * 2);
    const idx: number[] = [];
    for (let i = 0; i < this.N - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const mat = new THREE.ShaderMaterial({
      vertexShader: `attribute float aAlpha; varying float vA;
        void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA;
        void main(){ gl_FragColor = vec4(0.88, 0.95, 1.0, vA * 0.46); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    for (let i = 0; i < this.N; i++) this.hist.push(new THREE.Vector3());
  }

  reset(p: THREE.Vector3) {
    for (const v of this.hist) v.copy(p);
    this.active = false;
    this.mesh.visible = false;
  }

  update(p: THREE.Vector3, camPos: THREE.Vector3, speed: number, on: boolean) {
    this.mesh.visible = on;
    if (!on) { this.active = false; return; }
    if (!this.active) { for (const v of this.hist) v.copy(p); this.active = true; }
    // Rotate the ring: take the oldest sample, move it to the head, reuse the
    // vector. Writing through the array after popping corrupts the tail.
    const oldest = this.hist.pop()!;
    oldest.copy(p);
    this.hist.unshift(oldest);

    const dir = new THREE.Vector3(), toCam = new THREE.Vector3(), side = new THREE.Vector3();
    const width = clamp01((speed - 3) / 22) * 0.20 + 0.04;
    for (let i = 0; i < this.N; i++) {
      const a = this.hist[Math.max(0, i - 1)], b = this.hist[Math.min(this.N - 1, i + 1)];
      dir.subVectors(b, a);
      if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
      toCam.subVectors(camPos, this.hist[i]).normalize();
      side.crossVectors(dir, toCam).normalize().multiplyScalar(width * (1 - i / this.N));
      const h = this.hist[i];
      this.pos[i * 6] = h.x - side.x; this.pos[i * 6 + 1] = h.y - side.y; this.pos[i * 6 + 2] = h.z - side.z;
      this.pos[i * 6 + 3] = h.x + side.x; this.pos[i * 6 + 4] = h.y + side.y; this.pos[i * 6 + 5] = h.z + side.z;
      const a2 = (1 - i / this.N) * (1 - i / this.N);
      this.alpha[i * 2] = a2; this.alpha[i * 2 + 1] = a2;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}
