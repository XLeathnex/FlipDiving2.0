import { clamp01 } from '../core/vec.ts';
import type { HudState } from '../sim/game.ts';
import type { DiveResult } from '../sim/scoring.ts';

/**
 * DOM overlay.
 *
 * The rule here is that anything on screen has to earn its place by helping the
 * player time the next thing they do. So there is an altitude ladder (how long
 * have I got), a live rotation count (how far round am I), and a takeoff meter.
 * Score and grade appear after the fact and never block a retry.
 */

const CSS = `
:root { --ink: #f2f5f8; --dim: rgba(242,245,248,.55); --warm: #ffb562; }
* { box-sizing: border-box; }
#hud, #hud * { pointer-events: none; }
#hud {
  position: fixed; inset: 0; z-index: 10;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  text-shadow: 0 1px 14px rgba(0,20,35,.55), 0 0 2px rgba(0,20,35,.5);
  user-select: none;
}
.corner { position: absolute; padding: 18px 22px; }
.tl { top: 0; left: 0; }
.tr { top: 0; right: 0; text-align: right; }
.lbl { font-size: 10.5px; letter-spacing: .19em; text-transform: uppercase; color: var(--dim); font-weight: 600; }
.spot { font-size: 25px; font-weight: 650; letter-spacing: -.015em; margin-top: 3px; }
.height { font-size: 13px; color: var(--dim); margin-top: 1px; font-variant-numeric: tabular-nums; }
.score { font-size: 34px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.best { font-size: 12px; color: var(--dim); font-variant-numeric: tabular-nums; margin-top: 2px; }

/* Altitude ladder: how much time is left, at a glance. */
#ladder { position: absolute; left: 26px; top: 50%; transform: translateY(-50%); width: 46px; height: 46vh; min-height: 220px; opacity: 0; transition: opacity .22s; }
#ladder.on { opacity: 1; }
#ladder .rail { position: absolute; left: 15px; top: 0; bottom: 0; width: 2px; background: linear-gradient(to bottom, rgba(255,255,255,.05), rgba(255,255,255,.28)); border-radius: 2px; }
#ladder .sea { position: absolute; left: 6px; right: 6px; bottom: 0; height: 2px; background: var(--ink); opacity: .8; }
#ladder .mark { position: absolute; left: 8px; width: 16px; height: 1px; background: rgba(255,255,255,.30); }
#ladder .diver { position: absolute; left: 8px; width: 16px; height: 2px; background: var(--warm); box-shadow: 0 0 12px var(--warm); border-radius: 2px; }
#ladder .alt { position: absolute; left: 34px; font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; transform: translateY(-50%); white-space: nowrap; }
#ladder .ttw { position: absolute; left: 34px; bottom: -20px; font-size: 11px; letter-spacing: .1em; color: var(--dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
#ladder .sealbl { position: absolute; left: 34px; bottom: 4px; font-size: 9.5px; letter-spacing: .18em; text-transform: uppercase; color: rgba(242,245,248,.38); }

/* Live rotation readout. */
#rot { position: absolute; left: 50%; top: 15%; transform: translateX(-50%); text-align: center; opacity: 0; transition: opacity .14s; }
#rot.on { opacity: 1; }
#rot .n { font-size: 58px; font-weight: 300; font-variant-numeric: tabular-nums; letter-spacing: -.03em; line-height: 1; }
#rot .d { font-size: 10.5px; letter-spacing: .24em; text-transform: uppercase; color: var(--dim); margin-top: 5px; }

/* Takeoff: power on the left of the bar, rotation charge on the right. */
#takeoff { position: absolute; left: 50%; bottom: 12%; transform: translateX(-50%); width: 260px; opacity: 0; transition: opacity .16s; }
#takeoff.on { opacity: 1; }
#takeoff .bar { height: 5px; background: rgba(255,255,255,.14); border-radius: 3px; overflow: hidden; }
#takeoff .fill { height: 100%; width: 0%; background: linear-gradient(90deg, #ffd9a0, var(--warm)); border-radius: 3px; }
#takeoff .cap { position: absolute; right: 0; top: -1px; width: 2px; height: 7px; background: rgba(255,255,255,.5); }
#takeoff .row { display: flex; justify-content: space-between; margin-top: 8px; font-size: 10.5px; letter-spacing: .16em; text-transform: uppercase; color: var(--dim); }
#spin { height: 5px; margin-top: 7px; background: rgba(255,255,255,.14); border-radius: 3px; position: relative; }
#spin .mid { position: absolute; left: 50%; top: -2px; width: 1px; height: 9px; background: rgba(255,255,255,.35); }
#spin .f { position: absolute; top: 0; bottom: 0; background: #7fd2ff; border-radius: 3px; }

/* Result. Appears fast, never blocks the retry. */
#result { position: absolute; left: 50%; top: 44%; transform: translate(-50%,-50%); text-align: center; opacity: 0; transition: opacity .16s; padding: 30px 54px; border-radius: 24px;
  background: radial-gradient(closest-side, rgba(6,16,26,.62), rgba(6,16,26,.34) 62%, rgba(6,16,26,0)); }
#result.on { opacity: 1; }
#result .grade { font-size: 62px; font-weight: 700; letter-spacing: -.035em; line-height: 1; }
#result .grade.good { color: #8ef0c9; }
#result .grade.mid { color: #ffe08a; }
#result .grade.bad { color: #ff8f76; }
#result .trick { font-size: 15px; margin-top: 9px; letter-spacing: .01em; }
#result .pts { font-size: 30px; font-weight: 650; margin-top: 12px; font-variant-numeric: tabular-nums; }
#result .chips { display: flex; gap: 7px; justify-content: center; margin-top: 12px; flex-wrap: wrap; }
#result .chip { font-size: 11px; padding: 4px 10px; border-radius: 99px; background: rgba(255,255,255,.13); letter-spacing: .04em; }
#result .again { font-size: 11px; letter-spacing: .2em; text-transform: uppercase; color: var(--dim); margin-top: 20px; }

/* Spot list. */
#spots { position: absolute; right: 22px; top: 50%; transform: translateY(-50%); text-align: right; opacity: .0; transition: opacity .25s; }
#spots.on { opacity: 1; }
#spots .s { font-size: 12.5px; padding: 3px 0; color: rgba(242,245,248,.42); font-variant-numeric: tabular-nums; }
#spots .s.cur { color: var(--ink); font-weight: 600; }
#spots .s .h { color: rgba(242,245,248,.35); margin-left: 8px; font-size: 11px; }
#spots .s .pb { display: block; font-size: 10px; color: rgba(255,181,98,.72); letter-spacing: .04em; }
#result .newbest { font-size: 11px; letter-spacing: .22em; text-transform: uppercase; color: var(--warm); margin-top: 10px; }

/* Help. */
#help { position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%); display: flex; gap: 20px; font-size: 11.5px; color: var(--dim); transition: opacity .35s; }
#help b { color: var(--ink); font-weight: 600; }
#hint { position: absolute; left: 50%; bottom: 66px; transform: translateX(-50%); font-size: 13px; color: rgba(242,245,248,.78); transition: opacity .3s; text-align: center; max-width: 62vw; }
#blurb { font-size: 12.5px; color: var(--dim); max-width: 250px; line-height: 1.42; margin-top: 10px; transition: opacity .3s; }
.hide { opacity: 0 !important; }

#load { position: fixed; inset: 0; z-index: 40; background: #0b1420; display: flex; flex-direction: column;
  align-items: center; justify-content: center; color: #f2f5f8; font-family: ui-sans-serif, system-ui, sans-serif; transition: opacity .5s; }
#load .t { font-size: 12px; letter-spacing: .34em; text-transform: uppercase; opacity: .55; }
#load .n { font-size: 40px; font-weight: 300; letter-spacing: .04em; margin-top: 12px; }
#load .b { width: 190px; height: 2px; background: rgba(255,255,255,.14); margin-top: 26px; overflow: hidden; }
#load .b i { display: block; height: 100%; width: 34%; background: #ffb562; animation: slide 1.35s ease-in-out infinite; }
@keyframes slide { 0% { transform: translateX(-110%); } 100% { transform: translateX(320%); } }
`;

let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export class Hud {
  private el!: HTMLDivElement;
  private q: Record<string, HTMLElement> = {};
  private helpVisible = true;
  private dives = 0;

  mount(parent: HTMLElement) {
    injectCss();
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.innerHTML = `
      <div class="corner tl">
        <div class="lbl">Cala Nera</div>
        <div class="spot" id="spotName">The Plank</div>
        <div class="height" id="spotH">28 m</div>
        <div id="blurb"></div>
      </div>
      <div class="corner tr">
        <div class="lbl">Score</div>
        <div class="score" id="score">0</div>
        <div class="best" id="best">Best 0</div>
      </div>
      <div id="ladder">
        <div class="rail"></div><div class="sea"></div>
        <div class="mark" id="m1"></div><div class="mark" id="m2"></div><div class="mark" id="m3"></div>
        <div class="diver" id="dmark"></div>
        <div class="alt" id="altTxt">0 m</div>
        <div class="sealbl">Sea</div>
        <div class="ttw" id="ttwTxt"></div>
      </div>
      <div id="rot"><div class="n" id="rotN">0</div><div class="d" id="rotD">Rotations</div></div>
      <div id="takeoff">
        <div class="bar"><div class="fill" id="powFill"></div></div>
        <div id="spin"><div class="mid"></div><div class="f" id="spinFill"></div></div>
        <div class="row"><span>Power</span><span id="spinLbl">Rotation</span></div>
      </div>
      <div id="result">
        <div class="grade" id="grade">Clean</div>
        <div class="trick" id="trick"></div>
        <div class="pts" id="pts">0</div>
        <div class="chips" id="chips"></div>
        <div class="newbest" id="newbest"></div>
        <div class="again">Space to go again</div>
      </div>
      <div id="spots"></div>
      <div id="hint"></div>
      <div id="help">
        <span><b>Hold Space</b> charge</span>
        <span><b>A / D</b> rotation</span>
        <span><b>Space</b> tuck</span>
        <span><b>W</b> straighten</span>
        <span><b>R</b> retry</span>
        <span><b>Q / E</b> spot</span>
      </div>`;
    parent.appendChild(this.el);
    for (const id of ['spotName', 'spotH', 'score', 'best', 'ladder', 'dmark', 'altTxt', 'ttwTxt',
      'rot', 'rotN', 'rotD', 'takeoff', 'powFill', 'spinFill', 'spinLbl', 'result', 'grade', 'trick',
      'pts', 'chips', 'newbest', 'spots', 'help', 'hint', 'blurb', 'm1', 'm2', 'm3']) {
      this.q[id] = document.getElementById(id)!;
    }
  }

  setSpots(names: { id: string; name: string; height: number }[], cur: number, bests: Record<string, number> = {}) {
    this.q.spots.innerHTML = names.map((s, i) => {
      const b = bests[s.id];
      return `<div class="s ${i === cur ? 'cur' : ''}">${s.name}<span class="h">${s.height.toFixed(0)} m</span>`
        + (b ? `<span class="pb">${b.toLocaleString()}</span>` : '') + '</div>';
    }).join('');
  }

  showSpots(on: boolean) { this.q.spots.classList.toggle('on', on); }

  update(h: HudState, result: DiveResult | null, sinceResult: number, blurb: string, best: number, lastScore: number) {
    this.q.spotName.textContent = h.spotName;
    this.q.spotH.textContent = `${h.spotHeight.toFixed(0)} m`;
    this.q.best.textContent = `Best ${best.toLocaleString()}`;
    this.q.score.textContent = (result ? result.score : lastScore).toLocaleString();

    const airborne = h.phase === 'air' || h.phase === 'result';

    // --- Takeoff meter.
    this.q.takeoff.classList.toggle('on', h.phase === 'charge');
    if (h.phase === 'charge') {
      (this.q.powFill as HTMLElement).style.width = `${h.charge * 100}%`;
      const s = h.spinCharge;
      const f = this.q.spinFill as HTMLElement;
      f.style.left = s >= 0 ? '50%' : `${50 + s * 50}%`;
      f.style.width = `${Math.abs(s) * 50}%`;
      f.style.background = s >= 0 ? '#7fd2ff' : '#ffa1e0';
      this.q.spinLbl.textContent = Math.abs(s) < 0.05 ? 'No rotation'
        : `${s > 0 ? 'Front' : 'Back'} ${Math.abs(s) > 0.75 ? 'hard' : Math.abs(s) > 0.4 ? '' : 'easy'}`.trim();
    }

    // --- Altitude ladder.
    this.q.ladder.classList.toggle('on', airborne || h.phase === 'charge');
    if (airborne || h.phase === 'charge') {
      const top = Math.max(h.spotHeight * 1.12, 10);
      const f = clamp01(h.toWater / top);
      (this.q.dmark as HTMLElement).style.bottom = `${f * 100}%`;
      (this.q.altTxt as HTMLElement).style.bottom = `${f * 100}%`;
      this.q.altTxt.textContent = `${Math.max(0, h.toWater).toFixed(0)} m`;
      this.q.ttwTxt.textContent = airborne && h.toWater > 0.5 ? `${h.timeToWater.toFixed(1)}s to water` : '';
      for (let i = 0; i < 3; i++) {
        const frac = (i + 1) / 4;
        (this.q['m' + (i + 1)] as HTMLElement).style.bottom = `${frac * 100}%`;
      }
    }

    // --- Rotation counter.
    const showRot = h.phase === 'air' && h.halfRots > 0.14 && !h.crashed;
    this.q.rot.classList.toggle('on', showRot);
    if (showRot) {
      const half = h.halfRots;
      const full = Math.floor(half / 2);
      const isHalf = half - full * 2 >= 1;
      this.q.rotN.textContent = full === 0 ? (isHalf ? '½' : '') : `${full}${isHalf ? '½' : ''}`;
      this.q.rotD.textContent = h.shape > 0.75 ? 'Tuck' : h.shape < 0.22 ? 'Layout' : 'Pike';
    }
    // Losing control is worth saying out loud, immediately.
    if (h.crashed && h.phase === 'air') {
      this.q.rot.classList.add('on');
      this.q.rotN.textContent = '';
      this.q.rotD.textContent = 'Out of control';
    }

    // --- Result card.
    const showResult = h.phase === 'result' && sinceResult > 0.06;
    this.q.result.classList.toggle('on', showResult);
    if (showResult && result) {
      const g = this.q.grade;
      g.textContent = result.grade;
      g.className = 'grade ' + (result.quality > 0.7 ? 'good' : result.quality > 0.42 ? 'mid' : 'bad');
      this.q.trick.textContent = result.trickName;
      this.q.pts.textContent = `+${result.score.toLocaleString()}`;
      this.q.chips.innerHTML = result.chips.map((c) => `<div class="chip">${c}</div>`).join('');
      this.q.newbest.textContent = result.newBest ? 'Personal best' : '';
    }

    this.q.blurb.textContent = h.phase === 'ready' ? blurb : '';
    this.q.blurb.classList.toggle('hide', h.phase !== 'ready');

    // Contextual coaching, only for the first few attempts.
    let hint = '';
    if (this.dives < 4) {
      if (h.phase === 'ready') hint = 'Hold Space to load the jump. Hold A or D at the same time to set your rotation.';
      else if (h.phase === 'charge') hint = 'Release to launch.';
      else if (h.phase === 'air' && h.toWater > 4) hint = 'Space tucks and spins you up. W straightens you out for the entry.';
    }
    this.q.hint.textContent = hint;
    this.q.hint.classList.toggle('hide', !hint);
    this.q.help.classList.toggle('hide', !this.helpVisible);
  }

  noteDive() { this.dives++; }
  toggleHelp() { this.helpVisible = !this.helpVisible; }
}

export function showLoader(): HTMLElement {
  injectCss();
  const d = document.createElement('div');
  d.id = 'load';
  d.innerHTML = `<div class="t">Cala Nera</div><div class="n">Carving the cove</div><div class="b"><i></i></div>`;
  document.body.appendChild(d);
  return d;
}
