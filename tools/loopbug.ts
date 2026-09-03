import { Game, type GameInput } from '../src/sim/game.ts';

/** Reproduces "I jump once and then I'm stuck in a jump loop". */
function run(label: string, holdJump: (t: number) => boolean) {
  const g = new Game();
  g.teleport(0);
  const inp: GameInput = { jump: false, jumpEdge: false, stretch: false, rot: 0, restart: false, spotDelta: 0, trickDelta: 0, mx: 0, mz: 0, run: false, camYaw: 0 };
  let prev = false;
  let launches = 0, spawns = 0;
  let last = g.phase;
  const log: string[] = [];
  for (let i = 0; i < 1200; i++) {
    const t = i / 60;
    const j = holdJump(t);
    inp.jump = j;
    inp.jumpEdge = j;               // what Input.poll actually produces today
    prev = j;
    g.update(1 / 60, inp);
    for (const e of g.events) {
      if (e.t === 'launch') launches++;
      if (e.t === 'spawn') spawns++;
    }
    g.events.length = 0;
    if (g.phase !== last) { if (log.length < 14) log.push(`${t.toFixed(2)}s ${last}->${g.phase}`); last = g.phase; }
  }
  console.log(`${label.padEnd(34)} launches=${String(launches).padStart(3)} spawns=${String(spawns).padStart(3)}`);
  console.log('   ' + log.join('  '));
}

run('hold jump forever', () => true);
run('tap once at t=0.5', (t) => t > 0.5 && t < 0.7);
run('tap every 2s', (t) => (t % 2) < 0.15);
