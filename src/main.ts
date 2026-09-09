import * as THREE from 'three';
import { Game } from './sim/game.ts';
import { Level, MAP_IDS, MAP_NAMES, mapIdFrom } from './sim/level.ts';
import { Input } from './core/input.ts';
import { clamp01 } from './core/vec.ts';
import { makeSky, bakeEnvironment, SUN_DIR } from './view/sky.ts';
import { rockFromMesh } from './view/rock.ts';
import { buildProps } from './view/props.ts';
import { Water } from './view/water.ts';
import { Character } from './view/character.ts';
import { CameraDirector } from './view/camera.ts';
import { Trail } from './view/fx.ts';
import { Spray } from './view/spray.ts';
import { SplashFX } from './view/splash.ts';
import { Hud, showLoader } from './view/hud.ts';
import { TRICKS } from './sim/tricks.ts';
import { Post } from './view/post.ts';
import { Audio } from './audio/audio.ts';

const params = new URLSearchParams(location.search);
const mapId = mapIdFrom(params.get('map'));
const loader = showLoader();

const BEST_KEY = 'flipdiving.bests.v2';
function loadBests() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) if (typeof v === 'number') game.bestBySpot[k] = v;
      game.best = Math.max(0, ...Object.values(game.bestBySpot));
    }
  } catch { /* storage can be blocked */ }
}
function saveBests() {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(game.bestBySpot)); } catch { /* ignore */ }
}

function cycleMap() {
  const i = MAP_IDS.indexOf(game.level.id);
  const next = MAP_IDS[(i + 1) % MAP_IDS.length];
  const p = new URLSearchParams(location.search);
  p.set('map', next);
  location.search = p.toString();
}

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

const CAPTURE = params.has('shot');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: CAPTURE });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const game = new Game(new Level(mapId));
const director = new CameraDirector(innerWidth / innerHeight);
const input = new Input();
const hud = new Hud();
const audio = new Audio();
const post = new Post(renderer);

const sky = makeSky();
sky.scale.setScalar(2400);
scene.add(sky);
const env = bakeEnvironment(renderer, sky);
scene.environment = env;

const palette = game.level.id === 'jungle'
  ? { sun: 0xffd7a5, hemiSky: 0x8abddd, hemiGround: 0x193b2b, bounce: 0x5da9a1 }
  : game.level.id === 'spain'
    ? { sun: 0xffc47e, hemiSky: 0x91b9dd, hemiGround: 0x473d2a, bounce: 0x65aeca }
    : game.level.id === 'italy'
      ? { sun: 0xffc998, hemiSky: 0x91b8d4, hemiGround: 0x333127, bounce: 0x6ca8bd }
      : { sun: 0xffd2a0, hemiSky: 0x8fb6e0, hemiGround: 0x1e2c30, bounce: 0x62a9bd };

const sun = new THREE.DirectionalLight(palette.sun, 3.9);
sun.position.copy(SUN_DIR).multiplyScalar(120);
sun.castShadow = true;
const SHADOW_CENTRE = new THREE.Vector3(-14, 40, -4);
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 30;
sun.shadow.camera.far = 760;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.09;
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = -105; sc.right = 105; sc.top = 115; sc.bottom = -115;
sc.updateProjectionMatrix();
sun.target.position.copy(SHADOW_CENTRE);
sun.position.copy(SHADOW_CENTRE).addScaledVector(SUN_DIR, 300);
scene.add(sun); scene.add(sun.target);
scene.add(new THREE.HemisphereLight(palette.hemiSky, palette.hemiGround, 0.28));
const bounce = new THREE.DirectionalLight(palette.bounce, 0.22);
bounce.position.set(0.3, -1, 0.4); scene.add(bounce);

const character = new Character(); scene.add(character.root);
const spray = new Spray(); scene.add(spray.mesh);
const splash = new SplashFX(spray);
const trail = new Trail(); scene.add(trail.mesh);

let water: Water;
let rockMat: THREE.MeshStandardMaterial | null = null;

const t0 = performance.now();
const mesher = new Worker(new URL('./view/mesh.worker.ts', import.meta.url), { type: 'module' });
mesher.postMessage({ cell: game.level.id === 'jungle' ? 0.65 : 0.60, mapId: game.level.id });
mesher.onmessage = (e) => {
  const { mesh, tris } = rockFromMesh(game.level, e.data);
  rockMat = mesh.material as THREE.MeshStandardMaterial;
  scene.add(mesh);
  scene.add(buildProps(game.level));
  water = new Water(game.level, env);
  scene.add(water.mesh);
  mesher.terminate();
  console.log(`[${game.level.name}] rock ${tris.toLocaleString()} tris in ${(performance.now() - t0).toFixed(0)}ms`);

  hud.mount(document.body);
  loadBests();
  hud.setSpots(game.level.spots, game.spotIndex, game.bestBySpot);
  hud.setTrickList(TRICKS, game.trickIndex);
  input.attach(canvas);
  input.onFirstInput = () => { audio.start(); audio.resume(); };
  director.orbitYaw = Math.PI + game.walker.yaw;
  director.snap(game, innerWidth / innerHeight);
  resize();

  loader.querySelector('.t')!.textContent = MAP_NAMES[game.level.id];
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
  spray.setStretch(h * px, director.cam.fov);
}
addEventListener('resize', resize);
resize();

const _hp = new THREE.Vector3();
let prev = performance.now();
let flash = 0;
let posePaused = false;

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min((now - prev) / 1000, 0.05);
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
  if (intent.toggleMap) { cycleMap(); return; }
  if (intent.spotIndex >= 0 && intent.spotIndex < game.level.spots.length) { game.teleport(intent.spotIndex, intent.jump); audio.ui(); }
  if (intent.trickIndex >= 0 && intent.trickIndex < TRICKS.length) { game.selectTrick(intent.trickIndex); hud.setTrickCurrent(game.trickIndex); audio.ui(); }
  hud.setLocked(intent.pointerLocked);

  director.applyLook(intent.lookDX, intent.lookDY);
  const scale = director.consumeTimeScale(dt);

  if (!posePaused) game.update(dt * scale, {
    mx: intent.mx, mz: intent.mz, run: intent.run,
    jump: intent.jump, jumpEdge: intent.jumpEdge, stretch: intent.stretch, rot: intent.rot,
    restart: intent.restart, spotDelta: intent.spotDelta, trickDelta: intent.trickDelta,
    camYaw: director.orbitYaw,
  });
  if (intent.spotDelta) { hud.setSpots(game.level.spots, game.spotIndex, game.bestBySpot); audio.ui(); }

  const b = game.body;
  const w = game.walker;
  const lvl = game.level;

  for (const ev of game.events) {
    switch (ev.t) {
      case 'spawn':
        trail.reset(_hp.set(w.pos.x, w.pos.y, w.pos.z));
        spray.clear(); splash.reset();
        hud.setSpots(lvl.spots, game.spotIndex, game.bestBySpot);
        break;
      case 'charge': audio.charge(); break;
      case 'launch':
        audio.jump(game.charge); director.punch();
        spray.takeoff(b.pos.x, b.pos.y, b.pos.z, game.charge); hud.noteDive();
        break;
      case 'trick': hud.setTrickCurrent(game.trickIndex); audio.ui(); break;
      case 'footstep': audio.footstep(); break;
      case 'land': audio.land(ev.speed); break;
      case 'crash': director.kick(0.95); director.freeze(0.085); flash = 0.55; break;
      case 'impact':
        if (ev.e.kind === 'solid') {
          audio.crash(ev.e.normalSpeed, ev.e.hard);
          spray.rockHit(ev.e.x, ev.e.y, ev.e.z, 0, 1, 0, ev.e.normalSpeed);
          director.kick(clamp01(ev.e.normalSpeed / 18) * 0.7);
        }
        break;
      case 'churn': splash.churn(ev.e); break;
      case 'entry': {
        saveBests();
        // A rock-rest result carries zero displacement. Do not fabricate a water splash.
        if (ev.phys.displace > 0) {
          splash.entry(ev.phys);
          water.splash(ev.x, ev.z, splash.lastMagnitude);
          audio.splash(ev.phys.displace, ev.phys.slam, ev.phys.align, ev.speed);
          if (ev.reward > 0.72) audio.chime(ev.reward > 0.88);
          director.kick(clamp01(ev.phys.slam / 380) * 0.85);
        }
        break;
      }
    }
  }
  game.events.length = 0;

  if (game.onFoot) {
    character.updateOnFoot(dt, w.gait, game.phase === 'charge', game.charge);
    character.syncFromWalker(w.pos.x, w.pos.y, w.pos.z, w.yaw);
  } else {
    const phase = b.mode === 'crashed' ? 'crashed' : 'air';
    character.update(dt, b, phase, game.charge);
    character.syncTransform(b);
  }

  director.update(dt, game, innerWidth / innerHeight);
  const cam = director.cam;
  const refX = game.onFoot ? w.pos.x : b.pos.x;
  const refZ = game.onFoot ? w.pos.z : b.pos.z;
  const waterY = lvl.waterHeight(refX, refZ);
  water.update(game.time, cam.position);
  water.tickSplash(dt);

  const speed = game.onFoot ? Math.hypot(w.vel.x, w.vel.y, w.vel.z) : b.vel.len();
  const submerged = game.onFoot ? 0 : b.submerged;
  character.headWorld(_hp);
  trail.update(_hp, cam.position, speed, game.phase === 'air' && speed > 5);
  if (submerged > 0.3 && speed > 1.5) spray.bubbles(b.pos.x, b.pos.y, b.pos.z, speed, dt);
  spray.setStretch(innerHeight * renderer.getPixelRatio(), cam.fov);
  splash.update(dt); spray.update(dt, waterY);

  audio.setAirspeed(speed, submerged);
  const h = game.hud();
  if (game.phase === 'air') audio.approach(h.timeToWater);

  (sky.material as THREE.ShaderMaterial).uniforms.uTime.value = game.time;
  sky.position.copy(cam.position);
  const rs = rockMat?.userData.shader;
  if (rs) rs.uniforms.uTime.value = game.time;

  hud.update(h, game.result, game.sinceResult, game.spot.blurb, game.best, game.lastScore);
  hud.showSpots(game.phase === 'walk' || game.phase === 'result');

  flash = Math.max(0, flash - dt * 5.5);
  post.flash = flash * 0.5;

  renderer.setRenderTarget(post.target);
  renderer.clear();
  if (debugView) {
    sky.position.copy(debugCam.position);
    water.update(game.time, debugCam.position);
    renderer.render(scene, debugCam);
  } else renderer.render(scene, cam);
  post.render(game.time);
}
requestAnimationFrame(frame);

const debugCam = new THREE.PerspectiveCamera(50, 1, 0.5, 5000);
let debugView = false;
(window as any).__cala = {
  game, director, renderer, scene, input, THREE,
  isReady: () => ready,
  look(px: number | null, py = 0, pz = 0, tx = 0, ty = 0, tz = 0, fov = 50) {
    if (px === null) { debugView = false; return; }
    debugView = true;
    debugCam.fov = fov; debugCam.aspect = innerWidth / innerHeight;
    debugCam.position.set(px, py, pz); debugCam.up.set(0, 1, 0); debugCam.lookAt(tx, ty, tz); debugCam.updateProjectionMatrix();
  },
  audioState: () => ({ started: !!audio.ctx, state: audio.ctx?.state ?? 'none', muted: audio.muted }),
  pausePose(trickIdx: number, shape = 1, x = 6, y = 18, z = -2) {
    game.teleport(0); game.selectTrick(trickIdx); game.phase = 'air'; game.body.mode = 'air';
    game.body.pos.set(x, y, z); game.body.vel.set(0, 0, 0); game.body.L.set(0, 0, 0); game.body.shape = shape; posePaused = true;
  },
  resumeSim() { posePaused = false; },
  crash() { game.body.mode = 'crashed'; },
  hudOff() { document.getElementById('hud')!.style.display = 'none'; },
  hudOn() { document.getElementById('hud')!.style.display = ''; },
  nextMap() { cycleMap(); },
  set(opts: Record<string, number>) {
    if ('sun' in opts) sun.intensity = opts.sun;
    if ('hemi' in opts) (scene.children.find((c) => c instanceof THREE.HemisphereLight) as any).intensity = opts.hemi;
    if ('bounce' in opts) bounce.intensity = opts.bounce;
    if ('exposure' in opts) post.exposure = opts.exposure;
    if ('env' in opts) scene.environment = opts.env ? env : null;
    if ('envInt' in opts && rockMat) rockMat.envMapIntensity = opts.envInt;
    if ('shadows' in opts) { renderer.shadowMap.enabled = !!opts.shadows; renderer.shadowMap.needsUpdate = true; }
    if ('water' in opts) water.mesh.visible = !!opts.water;
    const rock = scene.getObjectByName('rock');
    if ('rock' in opts && rock) rock.visible = !!opts.rock;
    if ('sky' in opts) sky.visible = !!opts.sky;
  },
};
