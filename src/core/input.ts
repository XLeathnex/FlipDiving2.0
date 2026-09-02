import { clamp } from './vec.ts';

/**
 * Input is deliberately thin: it produces an intent struct, and nothing else in
 * the game knows what a key is. Adding touch or a gamepad later means writing
 * another producer for the same struct, not touching gameplay.
 */
export interface Intent {
  jump: boolean;
  stretch: boolean;
  rot: number;
  restart: boolean;
  spotDelta: number;
  spotIndex: number;
  toggleHelp: boolean;
  toggleMute: boolean;
  anyPress: boolean;
}

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private mouse = [false, false];
  intent: Intent = {
    jump: false, stretch: false, rot: 0, restart: false,
    spotDelta: 0, spotIndex: -1, toggleHelp: false, toggleMute: false, anyPress: false,
  };
  onFirstInput: (() => void) | null = null;
  private gotFirst = false;

  attach(el: HTMLElement) {
    const key = (e: KeyboardEvent, isDown: boolean) => {
      if (e.repeat) return;
      const k = e.code;
      if (isDown) {
        if (!this.down.has(k)) this.pressed.add(k);
        this.down.add(k);
        this.fireFirst();
      } else this.down.delete(k);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(k)) e.preventDefault();
    };
    window.addEventListener('keydown', (e) => key(e, true));
    window.addEventListener('keyup', (e) => key(e, false));
    window.addEventListener('blur', () => { this.down.clear(); this.mouse[0] = this.mouse[1] = false; });

    el.addEventListener('mousedown', (e) => { this.mouse[e.button === 2 ? 1 : 0] = true; this.fireFirst(); e.preventDefault(); });
    window.addEventListener('mouseup', (e) => { this.mouse[e.button === 2 ? 1 : 0] = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    // Touch: left half of the screen stretches, right half tucks/charges.
    // Enough to be playable on a phone without a separate control scheme.
    el.addEventListener('touchstart', (e) => {
      this.fireFirst();
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < window.innerWidth * 0.35) this.mouse[1] = true; else this.mouse[0] = true;
      }
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) { this.mouse[0] = this.mouse[1] = false; }
      e.preventDefault();
    }, { passive: false });
  }

  private fireFirst() {
    if (!this.gotFirst) { this.gotFirst = true; this.onFirstInput?.(); }
  }

  private has(...codes: string[]) { return codes.some((c) => this.down.has(c)); }
  private hit(...codes: string[]) { return codes.some((c) => this.pressed.has(c)); }

  poll(): Intent {
    const i = this.intent;
    i.jump = this.has('Space', 'ArrowDown', 'KeyS') || this.mouse[0];
    i.stretch = this.has('ArrowUp', 'KeyW') || this.mouse[1];
    i.rot = (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0);
    i.restart = this.hit('KeyR', 'Enter');
    i.spotDelta = (this.hit('KeyE', 'BracketRight') ? 1 : 0) - (this.hit('KeyQ', 'BracketLeft') ? 1 : 0);
    i.spotIndex = -1;
    for (let n = 1; n <= 5; n++) if (this.hit('Digit' + n)) i.spotIndex = n - 1;
    i.toggleHelp = this.hit('KeyH', 'Slash', 'Escape');
    i.toggleMute = this.hit('KeyM');
    i.anyPress = this.pressed.size > 0;
    this.pressed.clear();
    return i;
  }
}
