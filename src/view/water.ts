import * as THREE from 'three';
import type { Level } from '../sim/level.ts';
import { SUN_DIR } from './sky.ts';

/**
 * The sea.
 *
 * The wave sum here is character-for-character the one in Level.waterHeight, so
 * the surface you can see is the surface you land on. If those two ever drift
 * apart the game starts lying to the player about where the water is.
 *
 * Shoreline foam and depth tint come from a lookup texture baked once at load
 * from the rock field: for every point on the sea we know the distance to the
 * nearest rock and how deep the seabed is. That gives correct foam collars
 * around every rock with no runtime cost.
 */

const WAVE_GLSL = /* glsl */`
float waveHeight(vec2 p, float t) {
  return 0.115 * sin(p.x * 0.135 + p.y * 0.055 + t * 1.05)
       + 0.072 * sin(p.x * 0.061 - p.y * 0.190 + t * 1.47)
       + 0.040 * sin(p.x * 0.310 + p.y * 0.245 - t * 2.15);
}`;

const vert = /* glsl */`
precision highp float;
${WAVE_GLSL}
uniform float uTime;
uniform vec3  uEye;
varying vec3 vWPos;
varying vec2 vUvW;

void main() {
  vec3 p = position;
  // Ring-shaped grid centred on the camera: dense underfoot, coarse at the
  // horizon, so the sea can extend for kilometres without wasting vertices.
  p.xz += uEye.xz;
  p.y = waveHeight(p.xz, uTime);
  vWPos = p;
  vUvW = p.xz;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const frag = /* glsl */`
precision highp float;
${WAVE_GLSL}
uniform float uTime;
uniform vec3  uEye;
uniform vec3  uSun;
uniform sampler2D uShore;   // R = distance to rock, G = seabed depth
uniform vec2  uShoreMin;
uniform vec2  uShoreSize;
uniform samplerCube uEnv;
uniform float uSplashT;
uniform vec3  uSplashP;
uniform float uSplashMag;
varying vec3 vWPos;
varying vec2 vUvW;

float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y);
}
// Three octaves, not four. The fourth is invisible on a moving water surface
// and this function is evaluated several times for every pixel of a full-screen
// sea, so its cost multiplies fast.
float fbm2(vec2 p){
  float v = n2(p) * 0.5;
  v += n2(p * 2.11) * 0.25;
  v += n2(p * 4.37) * 0.125;
  return v * 1.1428;
}

void main() {
  vec2 p = vWPos.xz;
  float t = uTime;

  // --- Normal: analytic swell derivative plus one layer of ripple detail.
  float e = 0.35;
  float hx = waveHeight(p + vec2(e,0.0), t) - waveHeight(p - vec2(e,0.0), t);
  float hz = waveHeight(p + vec2(0.0,e), t) - waveHeight(p - vec2(0.0,e), t);
  vec3 n = normalize(vec3(-hx / (2.0*e), 1.0, -hz / (2.0*e)));

  float dist = length(vWPos - uEye);
  float detailFade = 1.0 - smoothstep(24.0, 150.0, dist);

  // One ripple field, sampled three times for its gradient, and then reused for
  // every foam mask below rather than evaluating fresh noise for each.
  vec2 rp = p * 1.35 + vec2(t * 0.20, -t * 0.13);
  float r1 = fbm2(rp);
  float rgx = fbm2(rp + vec2(0.12, 0.0)) - r1;
  float rgy = fbm2(rp + vec2(0.0, 0.12)) - r1;
  n = normalize(n + vec3(-rgx / 0.12 * 0.19, 0.0, -rgy / 0.12 * 0.19) * detailFade);

  vec3 V = normalize(uEye - vWPos);
  float fres = pow(clamp(1.0 - max(dot(n, V), 0.0), 0.0, 1.0), 4.4);
  fres = mix(0.023, 1.0, fres);

  // --- Shore data.
  vec2 suv = (p - uShoreMin) / uShoreSize;
  vec4 shore = texture2D(uShore, clamp(suv, 0.001, 0.999));
  float toRock = shore.r * 40.0;
  float depth  = shore.g * 24.0;
  // Beyond the baked area the clamped edge value carries on, and the distance
  // haze takes over long before it could read as a seam.
  float outside = max(max(-suv.x, suv.x - 1.0), max(-suv.y, suv.y - 1.0));
  toRock = mix(toRock, 40.0, clamp(outside * 6.0, 0.0, 1.0));
  depth = mix(depth, 24.0, clamp(outside * 3.0, 0.0, 1.0));

  // --- Body colour: shallow turquoise over sand, deep ink offshore.
  vec3 shallow = vec3(0.185, 0.455, 0.455);
  vec3 mid     = vec3(0.038, 0.183, 0.258);
  vec3 deep    = vec3(0.010, 0.055, 0.100);
  vec3 body = mix(shallow, mid, smoothstep(0.3, 4.6, depth));
  body = mix(body, deep, smoothstep(4.0, 15.0, depth));

  // Sun scattering through the wave backs makes the sea look lit, not painted.
  float back = pow(max(dot(V, -normalize(uSun - n * 0.6)), 0.0), 3.0);
  body += vec3(0.055, 0.145, 0.110) * back * (1.0 - smoothstep(0.0, 9.0, depth));

  // --- Reflection from the baked sky cube.
  vec3 R = reflect(-V, n);
  R.y = abs(R.y) * 0.65 + 0.02;
  vec3 refl = textureCube(uEnv, R).rgb;
  vec3 col = mix(body, refl, fres);

  // --- Specular.
  vec3 H = normalize(uSun + V);
  col += vec3(1.0, 0.90, 0.74) * pow(max(dot(n, H), 0.0), 260.0) * 2.4;
  col += vec3(1.0, 0.86, 0.66) * pow(max(dot(n, H), 0.0), 26.0) * 0.10;

  // --- Foam. Wave crests, a collar around every rock, and a widening ring
  //     where the diver went in.
  float crest = smoothstep(0.055, 0.115, waveHeight(p, t)) * smoothstep(0.42, 0.82, r1);
  float collar = 1.0 - smoothstep(0.0, 2.1, toRock);
  collar *= 0.42 + 0.58 * n2(p * 2.6 + vec2(sin(t * 0.7) * 0.3, t * 0.16));
  collar *= 0.55 + 0.45 * sin(t * 1.6 + toRock * 2.2);

  float ring = 0.0;
  if (uSplashT >= 0.0) {
    float rr = length(p - uSplashP.xz);
    float age = uSplashT;
    // Both the size of the disturbance and how fast it spreads scale with how
    // much water was actually displaced.
    float m = uSplashMag;
    float rad = 0.6 + m * 0.9 + age * (3.4 + 4.2 * m);
    float w = 0.7 + 1.1 * m;
    ring = smoothstep(w, 0.0, abs(rr - rad)) * exp(-age * 1.9) * smoothstep(0.02, 0.18, age) * (0.45 + 0.55 * m);
    ring += smoothstep(rad * 0.7, 0.0, rr) * exp(-age * 3.4) * 0.55 * m;
  }

  float foam = clamp(crest * 0.45 + collar * 0.80 + ring, 0.0, 1.0);
  foam *= 0.35 + 0.65 * mix(r1, n2(p * 6.5 + t * 0.4), 0.6);
  col = mix(col, vec3(0.93, 0.965, 0.975), clamp(foam, 0.0, 0.92));

  // Distance haze so the sea meets the sky instead of ending at a hard line.
  float haze = smoothstep(230.0, 950.0, dist);
  col = mix(col, vec3(0.470, 0.545, 0.600), haze);

  gl_FragColor = vec4(col, 1.0);
}`;

/** Radial grid: fine near the camera, huge triangles at the horizon. */
function radialGrid(rings: number, segs: number, inner: number, outer: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const rad = inner + (outer - inner) * Math.pow(t, 3.4);
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
    const a = r * segs + s, b = r * segs + (s + 1) % segs;
    const c = (r + 1) * segs + s, d = (r + 1) * segs + (s + 1) % segs;
    idx.push(a, c, b, b, c, d);
  }
  // Cap the middle so there is no hole under the camera.
  const centre = pos.length / 3;
  pos.push(0, 0, 0);
  for (let s = 0; s < segs; s++) idx.push(centre, s, (s + 1) % segs);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

/** Bake distance-to-rock and seabed depth over the play area. */
function bakeShoreTexture(level: Level, size = 512): { tex: THREE.DataTexture; min: THREE.Vector2; span: THREE.Vector2 } {
  const min = new THREE.Vector2(-60, -75);
  const span = new THREE.Vector2(120, 130);
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    const z = min.y + (j + 0.5) / size * span.y;
    for (let i = 0; i < size; i++) {
      const x = min.x + (i + 0.5) / size * span.x;
      // Nearest rock in the splash zone, sampled over the band the waves reach.
      let d = 1e3;
      for (let y = -1.0; y <= 1.6; y += 0.65) d = Math.min(d, level.rock.sample(x, y, z));
      const o = (j * size + i) * 4;
      data[o] = Math.max(0, Math.min(255, Math.round(d / 40 * 255)));
      data[o + 1] = Math.max(0, Math.min(255, Math.round(level.depthAt(x, z) / 24 * 255)));
      data[o + 2] = 0; data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { tex, min, span };
}

export class Water {
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(level: Level, env: THREE.Texture) {
    const shore = bakeShoreTexture(level);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uTime: { value: 0 },
        uEye: { value: new THREE.Vector3() },
        uSun: { value: SUN_DIR.clone() },
        uShore: { value: shore.tex },
        uShoreMin: { value: shore.min },
        uShoreSize: { value: shore.span },
        uEnv: { value: env },
        uSplashT: { value: -1 },
        uSplashP: { value: new THREE.Vector3() },
        uSplashMag: { value: 0.5 },
      },
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(radialGrid(150, 128, 0.4, 1800), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'water';
  }

  update(time: number, eye: THREE.Vector3) {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uEye.value.copy(eye);
  }

  /** @param mag 0..1 splash magnitude, from the displaced volume rate. */
  splash(x: number, z: number, mag: number) {
    this.mat.uniforms.uSplashP.value.set(x, 0, z);
    this.mat.uniforms.uSplashT.value = 0;
    this.mat.uniforms.uSplashMag.value = Math.max(0.12, mag);
  }

  tickSplash(dt: number) {
    const u = this.mat.uniforms.uSplashT;
    if (u.value >= 0) { u.value += dt; if (u.value > 5) u.value = -1; }
  }
}
