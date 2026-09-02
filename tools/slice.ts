import { Level } from '../src/sim/level.ts';
const L = new Level();

function sideView(z: number) {
  console.log(`\n=== SIDE VIEW  (z = ${z})   X right -> sea,  Y up ===`);
  for (let y = 44; y >= -6; y -= 1.5) {
    let row = String(Math.round(y)).padStart(3) + ' ';
    for (let x = -46; x <= 30; x += 1) {
      const d = L.rock.sample(x, y, z);
      let ch = d < 0 ? '#' : d < 1.2 ? '+' : ' ';
      if (ch === ' ' && Math.abs(y) < 0.75 && x > -10) ch = '~';
      if (ch === ' ' && y < L.bedHeight(x, z)) ch = '.';
      for (const p of L.props) {
        if (Math.abs(x - p.x) < p.hx && Math.abs(y - p.y) < p.hy + 0.7 && Math.abs(z - p.z) < p.hz) ch = '=';
      }
      row += ch;
    }
    console.log(row);
  }
  console.log('    ' + '-46'.padEnd(20) + '-26'.padEnd(20) + '-6'.padEnd(20) + '14');
}

function topView(y: number) {
  console.log(`\n=== TOP VIEW  (y = ${y})   X right,  Z down ===`);
  for (let z = -40; z <= 34; z += 2) {
    let row = String(Math.round(z)).padStart(4) + ' ';
    for (let x = -46; x <= 30; x += 1) {
      const d = L.rock.sample(x, y, z);
      row += d < 0 ? '#' : d < 1.2 ? '+' : (y < 0.5 ? '~' : ' ');
    }
    console.log(row);
  }
}

sideView(6);   // through The Shelf
sideView(-18); // through The Mast
sideView(17);  // through The Arch
topView(2);
for (const s of L.spots) {
  const clr = L.rock.sample(s.pos.x, s.pos.y + 0.9, s.pos.z);
  console.log(`spot ${s.name.padEnd(12)} y=${s.pos.y.toFixed(1)} clearanceAtHead=${clr.toFixed(2)}`);
}
