import * as THREE from 'three';
import { Game } from './sim/game.ts';
import { Input } from './core/input.ts';
import { clamp01, lerp } from './core/vec.ts';
import { makeSky, bakeEnvironment, SUN_DIR } from './view/sky.ts';
import { rockFromMesh } from './view/rock.ts';
import { buildProps } from './view/props.ts';
import { Water } from './view/water.ts';
import { Character } from './view/character.ts';
import { CameraDirector } from './view/camera.ts';
import { Particles, Trail } from './view/fx.ts';
import { Hud, showLoader } from './view/hud.ts';
import { Post } from './view/post.ts';
import { Audio } from './audio/audio.ts';

const loader = showLoader();

// Personal bests survive a reload. Storage can throw (private windows, blocked
// site data), and a missing high score is never worth breaking the game over.
const BEST_KEY = 'calanera.bests.v1';
function loadBests() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) if (typeof v === 'number') game.bestBySpot[k] = v;
      game.best = Math.max(0, ...Object.values(game.bestBySpot));
    }
  } catch { /* no stored bests; carry on */ }
}
function saveBests() {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(game.bestBySpot)); } catch { /* ignore */ }
}

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

// The screenshot harness needs a stable framebuffer to capture.
const CAPTURE = new URLSearchParams(location.search).has('shot');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance',
  preserveDrawingBuffer: CAPTURE,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// The scene renders linear into a float target; tone mapping happens in the
// composite, after bloom, which is the only order that blooms highlights
// instead of mid-tones.
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const game = new Game();
const director = new CameraDirector(innerWidth / innerHeight);
const input = new Input();
const hud = new Hud();
const audio = new Audio();
const post = new Post(renderer);

const sky = makeSky();
sky.scale.setScalar(2200);
scene.add(sky);
const env = bakeEnvironment(renderer, sky);
scene.environment = env;

// --- Lighting. Late afternoon: a warm low key light, cool sky fill, and a weak
// bounce from the water so undersides are not dead black.
const sun = new THREE.DirectionalLight(0xffd2a0, 3.9);
sun.position.copy(SUN_DIR).multiplyScalar(120);
sun.castShadow = true;
// One shadow camera fixed over the cove rather than chasing the diver. The
// cove is only ~120 m across, so a single 2048 map gives ~6 cm texels, and a
// stationary frustum means shadow edges never crawl while the camera moves.
const SHADOW_CENTRE = new THREE.Vector3(-14, 16, -4);
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 60;
sun.shadow.camera.far = 330;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.09;
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = -66; sc.right = 66; sc.top = 60; sc.bottom = -60;
sc.updateProjectionMatrix();
sun.target.position.copy(SHADOW_CENTRE);
sun.position.copy(SHADOW_CENTRE).addScaledVector(SUN_DIR, 190);
scene.add(sun);
scene.add(sun.target);

scene.add(new THREE.HemisphereLight(0x8fb6e0, 0x1e2c30, 0.26));
const bounce = new THREE.DirectionalLight(0x62a9bd, 0.22);
bounce.position.set(0.3, -1, 0.4);
scene.add(bounce);

const character = new Character();
scene.add(character.root);

const particles = new Particles();
scene.add(particles.points);
const trail = new Trail();
scene.add(trail.mesh);

let water: Water;
let rockMat: THREE.MeshStandardMaterial | null = null;

// --- Mesh the cove in a worker so the loading screen stays alive.
const t0 = performance.now();
const mesher = new Worker(new URL('./view/mesh.worker.ts', import.meta.url), { type: 'module' });
mesher.postMessage({ cell: 0.55 });
mesher.onmessage = (e) => {
  const { mesh, tris } = rockFromMesh(game.level, e.data);
  rockMat = mesh.material as THREE.MeshStandardMaterial;
  scene.add(mesh);
  scene.add(buildProps(game.level));
  water = new Water(game.level, env);
  scene.add(water.mesh);
  mesher.terminate();
  console.log(`[cala nera] rock ${tris.toLocaleString()} tris in ${(performance.now() - t0).toFixed(0)}ms`);

  hud.mount(document.body);
  loadBests();
  hud.setSpots(game.level.spots, game.spotIndex, game.bestBySpot);
  input.attach(canvas);
  input.onFirstInput = () => { audio.start(); audio.resume(); };
  director.snap(game, innerWidth / innerHeight);
  resize();

  loader.style.opacity = '0';
  setTimeout(() => loader.remove(), 520);
  ready = true;
};

let ready = false;

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  const px = renderer.getPixelRatio();
  post.resize(Math.max(1, Math.round(w * px)), Math.max(1, Math.round(h * px)));
  particles.setPixelScale(h * px, director.cam.fov);
}
addEventListener('resize', resize);
resize();

// --- Frame loop -------------------------------------------------------------

const _hp = new THREE.Vector3();
let prev = performance.now();
let flash = 0;

function frame() {
  requestAnimationFrame(frame);
  // performance.now() rather than the rAF timestamp: identical in practice, and
  // it lets the headless harness drive the clock deterministically.
  const now = performance.now();
  let dt = Math.min((now - prev) / 1000, 0.05);
  prev = now;
  if (!ready) {
    renderer.setRenderTarget(post.target);
    renderer.clear();
    renderer.render(scene, director.cam);
    post.render(0);
    return;
  }

  const intent = input.poll();
  if (intent.toggleMute) audio.setMuted(!audio.muted);
  if (intent.toggleHelp) hud.toggleHelp();
  if (intent.spotIndex >= 0) { game.selectSpot(intent.spotIndex); audio.ui(); }

  // Hit-stop: a very short freeze on hard impacts. Long enough to feel the
  // collision, short enough that it never eats an input.
  const scale = director.consumeTimeScale(dt);

  game.update(dt * scale, {
    jump: intent.jump, jumpEdge: intent.jumpEdge, stretch: intent.stretch, rot: intent.rot,
    restart: intent.restart, spotDelta: intent.spotDelta,
  });
  if (intent.spotDelta) { hud.setSpots(game.level.spots, game.spotIndex, game.bestBySpot); audio.ui(); }

  const b = game.body;
  const lvl = game.level;

  // --- Consume simulation events into presentation.
  for (const ev of game.events) {
    switch (ev.t) {
      case 'spawn':
        trail.reset(_hp.set(b.pos.x, b.pos.y, b.pos.z));
        particles.clear();
        hud.setSpots(lvl.spots, game.spotIndex, game.bestBySpot);
        break;
      case 'charge':
        audio.charge();
        break;
      case 'launch':
        audio.jump(game.charge);
        director.punch();
        particles.takeoff(b.pos.x, b.pos.y, b.pos.z, game.charge);
        hud.noteDive();
        break;
      case 'crash':
        director.kick(0.95);
        director.freeze(0.085);
        flash = 0.55;
        break;
      case 'impact':
        if (ev.e.kind === 'solid') {
          audio.crash(ev.e.normalSpeed, ev.e.hard);
          particles.rockHit(ev.e.x, ev.e.y, ev.e.z, 0, 1, 0, ev.e.normalSpeed);
          director.kick(clamp01(ev.e.normalSpeed / 18) * 0.7);
        }
        break;
      case 'entry': {
        saveBests();
        const q = ev.q;
        particles.splash(ev.x, ev.y, ev.z, q, ev.speed, b.vel.x, b.vel.z);
        water.splash(ev.x, ev.z);
        audio.splash(q, ev.speed);
        if (q > 0.72) audio.chime(q > 0.88);
        director.kick(lerp(0.75, 0.18, q) * clamp01(ev.speed / 24));
        break;
      }
    }
  }
  game.events.length = 0;

  // --- Presentation update.
  const phase = b.mode === 'crashed' ? 'crashed'
    : game.phase === 'charge' ? 'charge'
    : game.phase === 'ready' ? 'ground' : 'air';
  character.update(dt, b, phase);
  character.syncTransform(b);

  director.update(dt, game, innerWidth / innerHeight);
  const cam = director.cam;

  const waterY = lvl.waterHeight(b.pos.x, b.pos.z);
  water.update(game.time, cam.position);
  water.tickSplash(dt);

  const speed = b.vel.len();
  character.headWorld(_hp);
  trail.update(_hp, cam.position, speed, game.phase === 'air' && speed > 5);

  if (game.phase === 'air') {
    particles.speedSpray(b.pos.x, b.pos.y, b.pos.z, speed, dt);
  }
  if (b.submerged > 0.3 && speed > 1.5) {
    particles.bubbles(b.pos.x, b.pos.y, b.pos.z, speed, dt);
  }
  particles.setPixelScale(innerHeight * renderer.getPixelRatio(), cam.fov);
  particles.update(dt, waterY);

  // Wind rises with airspeed; the last moment before the water tightens it.
  audio.setAirspeed(speed, b.submerged);
  const h = game.hud();
  if (game.phase === 'air') {
    audio.approach(h.timeToWater);
  }

  (sky.material as THREE.ShaderMaterial).uniforms.uTime.value = game.time;
  sky.position.copy(cam.position);
  const rs = rockMat?.userData.shader;
  if (rs) rs.uniforms.uTime.value = game.time;

  hud.update(h, game.result, game.sinceResult, game.spot.blurb, game.best, game.lastScore);
  hud.showSpots(game.phase === 'ready' || game.phase === 'result');

  // Impact flash: a very short lift on the frame a crash lands.
  flash = Math.max(0, flash - dt * 5.5);
  post.flash = flash * 0.5;

  renderer.setRenderTarget(post.target);
  renderer.clear();
  if (debugView) {
    sky.position.copy(debugCam.position);
    water.update(game.time, debugCam.position);
    renderer.render(scene, debugCam);
  } else {
    renderer.render(scene, cam);
  }
  post.render(game.time);
}
requestAnimationFrame(frame);

// Expose for the headless screenshot harness.
const debugCam = new THREE.PerspectiveCamera(50, 1, 0.5, 4000);
let debugView = false;
(window as any).__cala = {
  game, director, renderer, scene, input, THREE,
  isReady: () => ready,
  /** Override the view for level inspection. Persists until look(null). */
  look(px: number | null, py = 0, pz = 0, tx = 0, ty = 0, tz = 0, fov = 50) {
    if (px === null) { debugView = false; return; }
    debugView = true;
    debugCam.fov = fov;
    debugCam.aspect = innerWidth / innerHeight;
    debugCam.position.set(px, py, pz);
    debugCam.up.set(0, 1, 0);
    debugCam.lookAt(tx, ty, tz);
    debugCam.updateProjectionMatrix();
  },
  audioState: () => ({ started: !!audio.ctx, state: audio.ctx?.state ?? 'none', muted: audio.muted }),
  /** Force the crash state, for inspecting the limp-body response. */
  crash() { game.body.mode = 'crashed'; },
  hudOff() { document.getElementById('hud')!.style.display = 'none'; },
  hudOn() { document.getElementById('hud')!.style.display = ''; },
  set(opts: Record<string, number>) {
    if ('sun' in opts) sun.intensity = opts.sun;
    if ('hemi' in opts) (scene.children.find((c) => c instanceof THREE.HemisphereLight) as any).intensity = opts.hemi;
    if ('bounce' in opts) bounce.intensity = opts.bounce;
    if ('exposure' in opts) post.exposure = opts.exposure;
    if ('env' in opts) { scene.environment = opts.env ? env : null; }
    if ('envInt' in opts && rockMat) rockMat.envMapIntensity = opts.envInt;
    if ('shadows' in opts) { renderer.shadowMap.enabled = !!opts.shadows; renderer.shadowMap.needsUpdate = true; }
    if ('water' in opts) water.mesh.visible = !!opts.water;
    if ('rock' in opts) scene.getObjectByName('rock')!.visible = !!opts.rock;
    if ('sky' in opts) sky.visible = !!opts.sky;
    if ('normals' in opts) {
      const r = scene.getObjectByName('rock') as THREE.Mesh;
      if (opts.normals) { (r as any)._m = r.material; r.material = new THREE.MeshNormalMaterial(); }
      else if ((r as any)._m) r.material = (r as any)._m;
    }
  },
};
