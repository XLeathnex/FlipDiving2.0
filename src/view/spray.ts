import * as THREE from 'three';
import { clamp01, lerp } from '../core/vec.ts';

/**
 * Water particles, rendered as instanced billboards that stretch along their
 * own velocity.
 *
 * Round points read as snow. Real spray is made of ligaments and droplets
 * elongated along the direction they are travelling, and stretching the quad by
 * its screen-space speed is enough to sell that for almost nothing.
 */

export const KIND = {
  DROP: 0,    // dense water, falls, stretches hard
  MIST: 1,    // fine spray, hangs, barely falls
  DUST: 2,    // rock grit
  BUBBLE: 3,  // rises to the surface and pops
  SHEET: 4,   // large soft slab; several of these read as a continuous curtain
} as const;

const MAX = 6000;

const vert = /* glsl */`
precision highp float;
attribute vec3 position;
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iData;      // x: size (m), y: life 0..1, z: kind, w: seed
uniform mat4 modelViewMatrix, projectionMatrix;
uniform float uStretch;
varying float vLife;
varying float vKind;
varying vec2  vUv;
varying float vSeed;

void main() {
  vLife = iData.y; vKind = iData.z; vSeed = iData.w;
  vUv = position.xy;

  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;

  float size = iData.x;
  // Stretch along the screen-space velocity. Mist and bubbles stay round.
  float k = (vKind < 0.5 || vKind > 3.5) ? uStretch : uStretch * 0.25;
  float sp = length(vv.xy);
  float stretch = 1.0 + clamp(sp * k, 0.0, 4.0);
  vec2 dir = sp > 1e-4 ? vv.xy / sp : vec2(0.0, 1.0);

  vec2 local = vec2(position.x * size, position.y * size * stretch);
  mv.xy += vec2(dir.y * local.x + dir.x * local.y,
               -dir.x * local.x + dir.y * local.y);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */`
precision highp float;
varying float vLife;
varying float vKind;
varying vec2  vUv;
varying float vSeed;

void main() {
  float r = dot(vUv, vUv) * 4.0;
  if (r > 1.0) discard;
  float soft = 1.0 - smoothstep(0.15, 1.0, r);

  vec3 col;
  float a;
  if (vKind < 0.5) {            // droplet: bright water, hard edge
    col = vec3(0.90, 0.965, 0.995);
    a = soft * vLife;
  } else if (vKind < 1.5) {     // mist: soft, faint
    col = vec3(0.88, 0.935, 0.960);
    a = soft * soft * vLife * 0.20;
  } else if (vKind < 2.5) {     // rock grit
    col = vec3(0.66, 0.615, 0.535);
    a = soft * vLife * 0.85;
  } else if (vKind < 3.5) {     // bubble: rim-lit, hollow
    float rim = smoothstep(0.35, 0.95, r);
    col = vec3(0.80, 0.92, 0.97);
    a = (soft * 0.35 + rim * 0.55) * vLife * 0.55;
  } else {                      // sheet: broad, translucent water curtain
    col = vec3(0.86, 0.935, 0.965);
    a = soft * soft * vLife * 0.55;
  }
  gl_FragColor = vec4(col, a);
}`;

export class Spray {
  mesh: THREE.Mesh;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private data = new Float32Array(MAX * 4);
  private maxLife = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private n = 0;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.RawShaderMaterial;

  constructor() {
    const quad = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(quad, 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('iVel', new THREE.InstancedBufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('iData', new THREE.InstancedBufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.instanceCount = 0;
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.mat = new THREE.RawShaderMaterial({
      vertexShader: vert, fragmentShader: frag,
      uniforms: { uStretch: { value: 0.012 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number,
        life: number, size: number, kind: number, drag: number) {
    const i = this.n < MAX ? this.n++ : (Math.random() * MAX) | 0;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.data[i * 4] = size; this.data[i * 4 + 1] = 1;
    this.data[i * 4 + 2] = kind; this.data[i * 4 + 3] = Math.random();
    this.maxLife[i] = life; this.drag[i] = drag;
  }

  update(dt: number, waterY: number) {
    for (let i = 0; i < this.n; i++) {
      const d4 = i * 4;
      if (this.data[d4 + 1] <= 0) continue;
      this.data[d4 + 1] -= dt / this.maxLife[i];
      if (this.data[d4 + 1] <= 0) { this.data[d4 + 1] = 0; continue; }
      const k = this.data[d4 + 2];
      const i3 = i * 3;
      const f = Math.exp(-this.drag[i] * dt);
      if (k > 2.5 && k < 3.5) {
        this.vel[i3 + 1] += 2.6 * dt;                       // bubbles rise
        if (this.pos[i3 + 1] > waterY) this.data[d4 + 1] = Math.min(this.data[d4 + 1], 0.2);
      } else if (k > 0.5 && k < 1.5) {
        this.vel[i3 + 1] += -1.0 * dt;                      // mist hangs
      } else if (k > 3.5) {
        this.vel[i3 + 1] += -6.2 * dt;                      // sheets are heavy but broad
      } else {
        this.vel[i3 + 1] += -9.81 * dt;
      }
      this.vel[i3] *= f; this.vel[i3 + 1] *= f; this.vel[i3 + 2] *= f;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (k < 2.5 && this.pos[i3 + 1] < waterY - 0.05) this.data[d4 + 1] = 0;
    }
    // Compact, so dead instances cost nothing.
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.data[i * 4 + 1] <= 0) continue;
      if (w !== i) {
        for (let c = 0; c < 3; c++) { this.pos[w * 3 + c] = this.pos[i * 3 + c]; this.vel[w * 3 + c] = this.vel[i * 3 + c]; }
        for (let c = 0; c < 4; c++) this.data[w * 4 + c] = this.data[i * 4 + c];
        this.maxLife[w] = this.maxLife[i]; this.drag[w] = this.drag[i];
      }
      w++;
    }
    this.n = w;
    this.geo.instanceCount = this.n;
    (this.geo.getAttribute('iPos') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('iVel') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('iData') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Screen-space stretch factor, kept constant in pixels across resolutions. */
  setStretch(pixelHeight: number, fovDeg: number) {
    this.mat.uniforms.uStretch.value = 0.34 / (pixelHeight / (2 * Math.tan((fovDeg * Math.PI) / 360)));
  }

  // --- emitters that are not splashes ---

  /** Grit knocked off the rock by a body hitting it. */
  rockHit(x: number, y: number, z: number, nx: number, ny: number, nz: number, force: number) {
    const n = Math.round(10 + force * 3.2);
    for (let i = 0; i < n; i++) {
      const sp = 1.4 + Math.random() * force * 0.7;
      this.spawn(x, y, z,
        (nx + (Math.random() - 0.5) * 1.4) * sp,
        (ny + (Math.random() - 0.5) * 1.4) * sp + 1.0,
        (nz + (Math.random() - 0.5) * 1.4) * sp,
        0.5 + Math.random() * 0.8, 0.030 + Math.random() * 0.065, KIND.DUST, 1.1);
    }
  }

  /** Air dragged down by a body still moving under the surface. */
  bubbles(x: number, y: number, z: number, speed: number, dt: number) {
    const n = Math.min(6, Math.floor(speed * dt * 2.4));
    for (let i = 0; i < n; i++) {
      this.spawn(
        x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 0.7, 0.9 + Math.random() * 1.6, (Math.random() - 0.5) * 0.7,
        1.4 + Math.random() * 1.6, 0.022 + Math.random() * 0.05, KIND.BUBBLE, 2.4);
    }
  }

  /** Dust kicked off the platform at the moment of takeoff. */
  takeoff(x: number, y: number, z: number, power: number) {
    const n = Math.round(8 + power * 14);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 2.2 * (0.4 + power);
      this.spawn(x + (Math.random() - 0.5) * 0.5, y - 0.9, z + (Math.random() - 0.5) * 0.5,
        Math.cos(a) * sp, 0.4 + Math.random() * 1.3, Math.sin(a) * sp,
        0.55 + Math.random() * 0.6, 0.04 + Math.random() * 0.09, KIND.DUST, 1.6);
    }
  }

  clear() { this.n = 0; this.geo.instanceCount = 0; }
  get count() { return this.n; }
}
