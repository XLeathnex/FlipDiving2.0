import { Game, type GameInput } from '../src/sim/game.ts';

/**
 * Reproduces "I tap retry right as I crash and nothing happens." The result
 * screen has a short cooldown so the tap that ends one dive can't also start
 * the next one, but a tap landing inside that cooldown must still be honoured
 * once it clears -- not silently dropped, which is what this used to do.
 */
function run() {
  const g = new Game();
  g.teleport(4);
  const inp: GameInput = { jump: false, jumpEdge: false, stretch: false, rot: 0, restart: false, spotDelta: 0, trickDelta: 0, mx: 0, mz: 0, run: false, camYaw: 0 };
  const dt = 1 / 40;

  inp.jump = true;
  for (let i = 0; i < 30; i++) g.update(dt, inp);
  inp.jump = false;
  g.update(dt, inp);

  let steps = 0;
  while (g.phase !== 'result' && steps < 2000) { g.update(dt, inp); steps++; }
  const reachedResult: boolean = g.phase === 'result';
  if (!reachedResult) { console.log('FAIL: never reached a result to retry from'); process.exit(1); }

  // Tap on the very next frame after the result appears -- sinceResult is
  // near zero here, well inside the cooldown window.
  inp.jump = true; inp.jumpEdge = true;
  g.update(dt, inp);
  inp.jump = false; inp.jumpEdge = false;
  g.update(dt, inp);

  // No further input. The buffered tap should fire once the cooldown clears.
  let firedAt = -1;
  for (let i = 0; i < 40; i++) {
    g.update(dt, inp);
    if (g.phase === 'walk') { firedAt = i; break; }
  }
  if (firedAt < 0) {
    console.log('FAIL: retry tap during the cooldown was dropped -- stuck on the result screen');
    process.exit(1);
  }
  console.log(`ok: buffered tap fired ${firedAt} frames after the cooldown started clearing`);
}

run();
