/**
 * Headless playtest harness. Drives the real game in a real browser, presses
 * real keys, and saves frames -- so "does it feel right" can at least become
 * "does it look right", and console errors surface immediately.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'fs';

const OUT = process.env.SHOT_DIR || 'shots';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const script = JSON.parse(process.argv[2] || '[]');
const W = +(process.env.W || 1280), H = +(process.env.H || 720);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (m.text().includes('[cala nera]')) console.log(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto('http://127.0.0.1:4173/?shot=1', { waitUntil: 'domcontentloaded' });

// Wait for the level build to finish.
await page.waitForFunction(() => (window).__cala !== undefined, null, { timeout: 90000 });
await page.waitForFunction(() => (window).__cala.isReady(), null, { timeout: 180000 });
await page.waitForTimeout(900);

// Freeze real time: the game reads performance.now(), so we can step it exactly.
await page.evaluate(() => {
  let t = performance.now();
  const real = performance.now.bind(performance);
  (window).__step = (ms) => { t += ms; };
  performance.now = () => t;
  (window).__realNow = real;
});

// SwiftShader renders a 200k-triangle scene slowly, so drive the loop in as few
// round-trips as possible: batch the whole advance into one page call.
async function advance(seconds, fps = 40) {
  const n = Math.max(1, Math.round(seconds * fps));
  await page.evaluate(async ([n, ms]) => {
    for (let i = 0; i < n; i++) {
      (window).__step(ms);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }, [n, 1000 / fps]);
}

let shotN = 0;
for (const cmd of script) {
  try {
    if (cmd.set) await page.evaluate((o) => (window).__cala.set(o), cmd.set);
    if (cmd.crash) await page.evaluate(() => (window).__cala.crash());
    if (cmd.hud !== undefined) await page.evaluate((v) => v ? (window).__cala.hudOn() : (window).__cala.hudOff(), cmd.hud);
    if (cmd.key) await page.keyboard.down(cmd.key);
    if (cmd.up) await page.keyboard.up(cmd.up);
    if (cmd.press) await page.keyboard.press(cmd.press);
    if (cmd.wait) await advance(cmd.wait);
    if (cmd.look) { await page.evaluate((a) => { (window).__cala.look(...a); }, cmd.look); await advance(0.1); }
    if (cmd.shot || cmd.look) {
      const name = `${OUT}/${String(shotN++).padStart(2, '0')}-${cmd.name || cmd.shot}.png`;
      await page.screenshot({ path: name });
      console.log('shot ' + name);
    }
    if (cmd.eval) console.log(cmd.label || 'eval', JSON.stringify(await page.evaluate(cmd.eval)));
  } catch (e) {
    console.log('CMD FAILED', JSON.stringify(cmd).slice(0, 90), '->', String(e).split('\n')[0]);
  }
}

if (errors.length) { console.log('\n=== CONSOLE ERRORS ==='); for (const e of errors.slice(0, 12)) console.log(' ! ' + e); }
else console.log('\nno console errors');
await browser.close();
