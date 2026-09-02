import * as THREE from 'three';

/**
 * Post-processing: bright-pass bloom, tone mapping, a warm/cool grade and a
 * vignette, in one composite.
 *
 * Deliberately restrained. The brief's warning about hiding weak geometry
 * behind bloom is the right one, so the bloom threshold sits high enough that
 * only genuine highlights -- sun glitter on the water, spray, rim-lit rock --
 * ever reach it, and the grade only separates the warm key from the cool sky
 * fill that the lighting already establishes.
 *
 * The scene renders linear into a float target and tone mapping happens here,
 * after the bloom is added, which is the only order that makes highlights
 * bloom rather than the mid-tones.
 */

const QUAD = new THREE.PlaneGeometry(2, 2);

const VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uThreshold;
uniform float uKnee;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float s = smoothstep(uThreshold, uThreshold + uKnee, l);
  gl_FragColor = vec4(c * s, 1.0);
}`;

const BLUR = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
  // 9-tap gaussian, linear-sampled so it costs 5 fetches.
  vec3 c = texture2D(uTex, vUv).rgb * 0.2270270270;
  c += texture2D(uTex, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(uTex, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(uTex, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(uTex, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMPOSITE = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomAmount;
uniform float uExposure;
uniform float uVignette;
uniform vec2 uRes;
uniform float uTime;
uniform float uFlash;

// ACES filmic approximation.
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec3 col = texture2D(uScene, vUv).rgb;
  col += texture2D(uBloom, vUv).rgb * uBloomAmount;
  col *= uExposure;
  col *= 1.0 + uFlash;

  col = aces(col);

  // Grade: cool the shadows toward the sea, warm the highlights toward the sun.
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * vec3(0.86, 0.94, 1.10), (1.0 - smoothstep(0.0, 0.42, l)) * 0.42);
  col = mix(col, col * vec3(1.07, 1.01, 0.90), smoothstep(0.55, 1.0, l) * 0.40);
  // Gentle S-curve for contrast.
  col = clamp((col - 0.5) * 1.17 + 0.5, 0.0, 1.0);

  // Vignette.
  vec2 q = vUv - 0.5;
  q.x *= uRes.x / uRes.y;
  col *= 1.0 - uVignette * dot(q, q) * 0.85;

  // Ordered dither so wide gradients in the sky do not band.
  float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (d - 0.5) / 255.0;

  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

function pass(frag: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.Mesh(QUAD, new THREE.RawShaderMaterial({
    vertexShader: `precision highp float;
      attribute vec3 position; attribute vec2 uv; varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: 'precision highp float;\n' + frag.replace('precision highp float;', ''),
    uniforms, depthTest: false, depthWrite: false,
  }));
}

export class Post {
  private sceneRT!: THREE.WebGLRenderTarget;
  private rtA!: THREE.WebGLRenderTarget;
  private rtB!: THREE.WebGLRenderTarget;
  private rtC!: THREE.WebGLRenderTarget;
  private rtD!: THREE.WebGLRenderTarget;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quadScene = new THREE.Scene();
  private brightM: THREE.Mesh;
  private blurM: THREE.Mesh;
  private compM: THREE.Mesh;
  private w = 1; private h = 1;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.brightM = pass(BRIGHT, { uTex: { value: null }, uThreshold: { value: 1.30 }, uKnee: { value: 0.85 } });
    this.blurM = pass(BLUR, { uTex: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.compM = pass(COMPOSITE, {
      uScene: { value: null }, uBloom: { value: null },
      uBloomAmount: { value: 0.30 }, uExposure: { value: 0.88 },
      uVignette: { value: 0.52 }, uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 }, uFlash: { value: 0 },
    });
    this.resize(1, 1);
  }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true };
    this.sceneRT?.dispose(); this.rtA?.dispose(); this.rtB?.dispose(); this.rtC?.dispose(); this.rtD?.dispose();
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, opts);
    const q = { ...opts, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(Math.max(1, w >> 2), Math.max(1, h >> 2), q);
    this.rtB = new THREE.WebGLRenderTarget(Math.max(1, w >> 2), Math.max(1, h >> 2), q);
    this.rtC = new THREE.WebGLRenderTarget(Math.max(1, w >> 3), Math.max(1, h >> 3), q);
    this.rtD = new THREE.WebGLRenderTarget(Math.max(1, w >> 3), Math.max(1, h >> 3), q);
    (this.compM.material as THREE.RawShaderMaterial).uniforms.uRes.value.set(w, h);
  }

  get target() { return this.sceneRT; }

  set exposure(v: number) { (this.compM.material as THREE.RawShaderMaterial).uniforms.uExposure.value = v; }
  /** Brief full-screen lift, used on a hard impact. */
  set flash(v: number) { (this.compM.material as THREE.RawShaderMaterial).uniforms.uFlash.value = v; }

  private draw(mesh: THREE.Mesh, target: THREE.WebGLRenderTarget | null) {
    this.quadScene.clear();
    this.quadScene.add(mesh);
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.cam);
  }

  render(time: number) {
    const bu = this.brightM.material as THREE.RawShaderMaterial;
    const lu = this.blurM.material as THREE.RawShaderMaterial;
    const cu = this.compM.material as THREE.RawShaderMaterial;

    bu.uniforms.uTex.value = this.sceneRT.texture;
    this.draw(this.brightM, this.rtA);

    // Two blur scales give the bloom a soft, wide falloff without a big kernel.
    lu.uniforms.uTex.value = this.rtA.texture;
    lu.uniforms.uDir.value.set(1 / this.rtA.width, 0);
    this.draw(this.blurM, this.rtB);
    lu.uniforms.uTex.value = this.rtB.texture;
    lu.uniforms.uDir.value.set(0, 1 / this.rtA.height);
    this.draw(this.blurM, this.rtA);

    lu.uniforms.uTex.value = this.rtA.texture;
    lu.uniforms.uDir.value.set(1 / this.rtC.width, 0);
    this.draw(this.blurM, this.rtC);
    lu.uniforms.uTex.value = this.rtC.texture;
    lu.uniforms.uDir.value.set(0, 1 / this.rtC.height);
    this.draw(this.blurM, this.rtD);

    cu.uniforms.uScene.value = this.sceneRT.texture;
    cu.uniforms.uBloom.value = this.rtD.texture;
    cu.uniforms.uTime.value = time;
    this.renderer.setRenderTarget(null);
    this.draw(this.compM, null);
  }
}
