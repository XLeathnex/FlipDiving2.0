import * as THREE from 'three';

/**
 * Hand-tuned late-afternoon sky. A physical model (Preetham/Hosek) would be
 * more "correct" but harder to art-direct; this is cheaper and lets me put the
 * warmth exactly where the composition wants it.
 */
export const SUN_DIR = new THREE.Vector3(0.60, 0.50, -0.62).normalize();

const skyVert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uSun;
uniform float uTime;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  float up = max(h, 0.0);

  vec3 zenith  = vec3(0.115, 0.255, 0.520);
  vec3 mid     = vec3(0.400, 0.560, 0.760);
  vec3 horizon = vec3(0.830, 0.790, 0.720);

  vec3 col = mix(mid, zenith, pow(up, 0.62));
  col = mix(horizon, col, smoothstep(-0.02, 0.34, h));

  // Warm glow gathered around the sun, strongest near the horizon.
  float sd = max(dot(d, uSun), 0.0);
  col += vec3(1.00, 0.62, 0.30) * pow(sd, 5.0) * 0.42;
  col += vec3(1.00, 0.80, 0.55) * pow(sd, 42.0) * 0.85;
  col += vec3(1.00, 0.95, 0.86) * smoothstep(0.9994, 0.99985, sd) * 9.0;

  // Thin cirrus, sheared and drifting. Only above the horizon.
  if (h > 0.0) {
    vec2 uv = d.xz / max(d.y + 0.14, 0.06);
    float c = fbm(uv * 0.55 + vec2(uTime * 0.004, uTime * 0.002));
    c = smoothstep(0.52, 0.92, c) * smoothstep(0.0, 0.28, h);
    vec3 cloud = mix(vec3(0.86, 0.87, 0.90), vec3(1.0, 0.92, 0.82), pow(sd, 3.0));
    col = mix(col, cloud, c * 0.62);
  }

  // Sea haze below the horizon line.
  col = mix(vec3(0.62, 0.66, 0.68), col, smoothstep(-0.30, 0.01, h));
  gl_FragColor = vec4(col, 1.0);
}`;

export function makeSky(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    uniforms: { uSun: { value: SUN_DIR.clone() }, uTime: { value: 0 } },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return mesh;
}

/** Bake the sky into a small cubemap so PBR surfaces get believable ambient. */
export function bakeEnvironment(renderer: THREE.WebGLRenderer, sky: THREE.Mesh): THREE.Texture {
  const scene = new THREE.Scene();
  const s = sky.clone();
  s.scale.setScalar(10);
  scene.add(s);
  const cubeRT = new THREE.WebGLCubeRenderTarget(128, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cam = new THREE.CubeCamera(0.1, 100, cubeRT);
  cam.update(renderer, scene);
  return cubeRT.texture;
}
