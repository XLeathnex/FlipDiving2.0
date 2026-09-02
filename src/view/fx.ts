import * as THREE from 'three';
import { clamp01, lerp } from '../core/vec.ts';

/**
 * Particles and the motion trail.
 *
 * The splash is the game's biggest single piece of feedback: it has to tell you
 * how well you did before you have read a single word of UI. So its shape is
 * driven directly by entry quality -- a rip throws a narrow, fast, vertical
 * spike, a belly flop throws a wide flat sheet of fat droplets. You learn to
 * read the splash, and after a while you stop needing the grade text at all.
 */

const MAX = 3000;

const pvert = /* glsl */`
precision highp float;
attribute float aSize;
attribute float aLife;
attribute float aKind;
varying float vLife;
varying float vKind;
uniform float uPix;
void main() {
  vLife = aLife;
  vKind = aKind;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // aSize is a diameter in METRES; uPix converts metres at one metre of depth
  // into pixels for the current viewport and field of view. The clamp stops a
  // puff of mist next to the lens from becoming a full-screen white quad.
  gl_PointSize = clamp(aSize * uPix / max(-mv.z, 0.5), 1.0, 320.0);
}`;

const pfrag = /* glsl */`
precision highp float;
varying float vLife;
varying float vKind;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  float soft = 1.0 - smoothstep(0.06, 0.25, r);
  // 0 = water droplet, 1 = fine mist, 2 = rock dust, 3 = bubble
  vec3 col = vKind < 0.5 ? vec3(0.93, 0.97, 0.99)
           : vKind < 1.5 ? vec3(0.90, 0.95, 0.97)
           : vKind < 2.5 ? vec3(0.72, 0.67, 0.58)
                         : vec3(0.82, 0.93, 0.96);
  float a = soft * vLife;
  if (vKind > 0.5 && vKind < 1.5) a *= 0.26;
  if (vKind > 2.5) a *= 0.55;
  gl_FragColor = vec4(col, a);
}`;

export class Particles {
  points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private kind: Float32Array;
  private drag: Float32Array;
  private n = 0;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;

  constructor() {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.kind = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aKind', new THREE.BufferAttribute(this.kind, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: pvert, fragmentShader: pfrag,
      uniforms: { uPix: { value: 300 } },
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, kind: number, drag: number) {
    const i = this.n < MAX ? this.n++ : Math.floor(Math.random() * MAX);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = 1; this.maxLife[i] = life; this.size[i] = size;
    this.kind[i] = kind; this.drag[i] = drag;
  }

  /**
   * @param quality 0..1 entry quality. Shapes the whole splash.
   * @param speed   entry speed in m/s.
   */
  splash(x: number, y: number, z: number, quality: number, speed: number, vx = 0, vz = 0) {
    const power = clamp01(speed / 26);
    const rip = clamp01(quality);
    // A clean entry makes a narrow hole; a flat one slaps a wide sheet of water.
    const spread = lerp(9.0, 1.1, rip);
    const upBias = lerp(0.55, 1.65, rip);
    const count = Math.round(lerp(90, 200, 1 - rip) * (0.4 + power));

    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), rip > 0.7 ? 2.2 : 0.7);
      const sp = (2.5 + Math.random() * 9) * (0.45 + power);
      const ux = Math.cos(a) * r * spread * 0.42;
      const uz = Math.sin(a) * r * spread * 0.42;
      const uy = (1.2 + Math.random() * 1.5) * upBias;
      const l = Math.hypot(ux, uy, uz) || 1;
      this.spawn(
        x + Math.cos(a) * r * spread * 0.16, y + 0.05, z + Math.sin(a) * r * spread * 0.16,
        ux / l * sp + vx * 0.12, uy / l * sp * 1.35, uz / l * sp + vz * 0.12,
        0.7 + Math.random() * 0.9, lerp(0.045, 0.135, Math.random()) * (0.6 + power * 0.6),
        Math.random() < 0.35 ? 1 : 0, 0.4,
      );
    }
    // The vertical plume: tall and tight when you rip it.
    const plume = Math.round(lerp(20, 70, rip) * (0.3 + power));
    for (let i = 0; i < plume; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * lerp(1.8, 0.42, rip);
      this.spawn(
        x + Math.cos(a) * r, y, z + Math.sin(a) * r,
        Math.cos(a) * r * 0.7, (7 + Math.random() * 11) * lerp(0.55, 1.35, rip) * (0.5 + power),
        Math.sin(a) * r * 0.7,
        0.85 + Math.random() * 0.75, lerp(0.05, 0.16, Math.random()), Math.random() < 0.5 ? 1 : 0, 0.55,
      );
    }
    // Low mist hanging over the impact.
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread * 0.7;
      this.spawn(x + Math.cos(a) * r, y + Math.random() * 0.8, z + Math.sin(a) * r,
        Math.cos(a) * 1.4, 0.7 + Math.random(), Math.sin(a) * 1.4,
        1.2 + Math.random() * 1.4, 0.55 + Math.random() * 1.05, 1, 1.7);
    }
  }

  /** Bubbles dragged down by a body still moving under the surface. */
  bubbles(x: number, y: number, z: number, speed: number, dt: number) {
    const n = Math.min(6, Math.floor(speed * dt * 2.2));
    for (let i = 0; i < n; i++) {
      this.spawn(
        x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 0.7, 0.9 + Math.random() * 1.6, (Math.random() - 0.5) * 0.7,
        1.4 + Math.random() * 1.6, 0.028 + Math.random() * 0.055, 3, 2.4,
      );
    }
  }

  /** Grit and chips knocked off the rock. */
  rockHit(x: number, y: number, z: number, nx: number, ny: number, nz: number, force: number) {
    const n = Math.round(12 + force * 3.5);
    for (let i = 0; i < n; i++) {
      const sp = 1.5 + Math.random() * force * 0.7;
      this.spawn(x, y, z,
        (nx + (Math.random() - 0.5) * 1.4) * sp,
        (ny + (Math.random() - 0.5) * 1.4) * sp + 1.0,
        (nz + (Math.random() - 0.5) * 1.4) * sp,
        0.5 + Math.random() * 0.8, 0.035 + Math.random() * 0.075, 2, 1.1);
    }
  }

  /** Grit and dust kicked off the platform at the moment of takeoff. */
  takeoff(x: number, y: number, z: number, power: number) {
    const n = Math.round(10 + power * 16);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 2.2 * (0.4 + power);
      this.spawn(x + (Math.random() - 0.5) * 0.5, y - 0.9, z + (Math.random() - 0.5) * 0.5,
        Math.cos(a) * sp, 0.4 + Math.random() * 1.3, Math.sin(a) * sp,
        0.55 + Math.random() * 0.6, 0.06 + Math.random() * 0.13, 2, 1.6);
    }
  }

  /** Spray torn off a fast-moving body -- only shows up when you are really moving. */
  speedSpray(x: number, y: number, z: number, speed: number, dt: number) {
    if (speed < 19) return;
    const n = Math.floor((speed - 19) * dt * 9);
    for (let i = 0; i < n; i++) {
      this.spawn(x + (Math.random() - 0.5) * 1.1, y + (Math.random() - 0.5) * 1.4, z + (Math.random() - 0.5) * 1.1,
        (Math.random() - 0.5) * 1.2, speed * 0.22 + Math.random() * 2, (Math.random() - 0.5) * 1.2,
        0.35 + Math.random() * 0.3, 0.06 + Math.random() * 0.09, 1, 1.4);
    }
  }

  update(dt: number, waterY: number) {
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt / this.maxLife[i];
      if (this.life[i] <= 0) { this.life[i] = 0; continue; }
      const k = this.kind[i];
      const i3 = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      if (k > 2.5) {
        // Bubbles rise and stop at the surface.
        this.vel[i3 + 1] += 2.6 * dt;
        if (this.pos[i3 + 1] > waterY) { this.life[i] = Math.min(this.life[i], 0.25); }
      } else if (k > 0.5 && k < 1.5) {
        this.vel[i3 + 1] += -1.1 * dt;   // mist hangs
      } else {
        this.vel[i3 + 1] += -9.81 * dt;
      }
      this.vel[i3] *= d; this.vel[i3 + 1] *= d; this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      // Droplets vanish when they fall back into the sea.
      if (k < 2.5 && this.pos[i3 + 1] < waterY - 0.05) this.life[i] = 0;
      live++;
    }
    // Compact so dead particles do not cost draw work.
    if (this.n > 0) {
      let w = 0;
      for (let i = 0; i < this.n; i++) {
        if (this.life[i] <= 0) continue;
        if (w !== i) {
          this.pos[w * 3] = this.pos[i * 3]; this.pos[w * 3 + 1] = this.pos[i * 3 + 1]; this.pos[w * 3 + 2] = this.pos[i * 3 + 2];
          this.vel[w * 3] = this.vel[i * 3]; this.vel[w * 3 + 1] = this.vel[i * 3 + 1]; this.vel[w * 3 + 2] = this.vel[i * 3 + 2];
          this.life[w] = this.life[i]; this.maxLife[w] = this.maxLife[i];
          this.size[w] = this.size[i]; this.kind[w] = this.kind[i]; this.drag[w] = this.drag[i];
        }
        w++;
      }
      this.n = w;
    }
    this.geo.setDrawRange(0, this.n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aKind as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Pixels per metre at one metre of depth, for the current viewport and FOV. */
  setPixelScale(pixelHeight: number, fovDeg: number) {
    this.mat.uniforms.uPix.value = pixelHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }
  clear() { this.n = 0; this.geo.setDrawRange(0, 0); }
}

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
