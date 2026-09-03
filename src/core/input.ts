/**
 * Input is deliberately thin: it produces an intent struct, and nothing else in
 * the game knows what a key is. Adding touch or a gamepad later means writing
 * another producer for the same struct, not touching gameplay.
 */
export interface Intent {
  jump: boolean;
  /**
   * True if the jump control went down at any point since the last poll, even
   * if it was released again before this frame. Sampling held state alone drops
   * very short taps, and on a retry screen a dropped tap feels like the game
   * ignored you.
   */
  jumpEdge: boolean;
  stretch: boolean;
  rot: number;
  restart: boolean;
  spotDelta: number;
  spotIndex: number;
  /** -1 / +1 to cycle the air trick. */
  trickDelta: number;
  trickIndex: number;
  toggleHelp: boolean;
  toggleMute: boolean;
  anyPress: boolean;
}

export class Input {
  private down = new Set<string>();
  /**
   * Presses since the last poll, COUNTED rather than flagged. A set collapses a
   * burst of taps on the same key into one, which loses inputs whenever the
   * frame rate dips -- exactly when the player is mashing.
   */
  private pressed = new Map<string, number>();
  private mouse = [false, false];
  /** Set by the pointer/touch handlers; consumed by the next poll. */
  private tapped = false;
  intent: Intent = {
    jump: false, jumpEdge: false, stretch: false, rot: 0, restart: false,
    spotDelta: 0, spotIndex: -1, trickDelta: 0, trickIndex: -1,
    toggleHelp: false, toggleMute: false, anyPress: false,
  };
  onFirstInput: (() => void) | null = null;
  private gotFirst = false;

  attach(el: HTMLElement) {
    const key = (e: KeyboardEvent, isDown: boolean) => {
      if (e.repeat) return;
      const k = e.code;
      if (isDown) {
        if (!this.down.has(k)) this.pressed.set(k, (this.pressed.get(k) ?? 0) + 1);
        this.down.add(k);
        this.fireFirst();
      } else this.down.delete(k);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(k)) e.preventDefault();
    };
    window.addEventListener('keydown', (e) => key(e, true));
    window.addEventListener('keyup', (e) => key(e, false));
    window.addEventListener('blur', () => { this.down.clear(); this.mouse[0] = this.mouse[1] = false; });

    el.addEventListener('mousedown', (e) => {
      this.mouse[e.button === 2 ? 1 : 0] = true;
      if (e.button !== 2) this.tapped = true;
      this.fireFirst(); e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => { this.mouse[e.button === 2 ? 1 : 0] = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    // Touch: left half of the screen stretches, right half tucks/charges.
    // Enough to be playable on a phone without a separate control scheme.
    el.addEventListener('touchstart', (e) => {
      this.fireFirst();
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < window.innerWidth * 0.35) this.mouse[1] = true;
        else { this.mouse[0] = true; this.tapped = true; }
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
  private hit(...codes: string[]) { return codes.some((c) => (this.pressed.get(c) ?? 0) > 0); }
  /** How many times any of these were pressed since the last poll. */
  private count(...codes: string[]) {
    let n = 0;
    for (const c of codes) n += this.pressed.get(c) ?? 0;
    return n;
  }

  poll(): Intent {
    const i = this.intent;
    i.jump = this.has('Space', 'ArrowDown', 'KeyS') || this.mouse[0];
    // A genuine edge: went down since the last poll. Writing this as
    // `i.jump || ...` makes it true for the whole hold, which turns "press to
    // retry" into "retry every single frame you are holding the key".
    i.jumpEdge = this.tapped || this.hit('Space', 'ArrowDown', 'KeyS');
    this.tapped = false;
    i.stretch = this.has('ArrowUp', 'KeyW') || this.mouse[1];
    i.rot = (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0);
    i.restart = this.hit('KeyR', 'Enter');
    i.spotDelta = this.count('KeyE', 'BracketRight') - this.count('KeyQ', 'BracketLeft');
    i.spotIndex = -1;
    for (let n = 1; n <= 5; n++) if (this.hit('Digit' + n)) i.spotIndex = n - 1;
    i.trickDelta = this.count('KeyX', 'Tab') - this.count('KeyZ');
    i.trickIndex = -1;
    for (let n = 1; n <= 5; n++) if (this.hit('F' + n)) i.trickIndex = n - 1;
    i.toggleHelp = this.hit('KeyH', 'Slash', 'Escape');
    i.toggleMute = this.hit('KeyM');
    i.anyPress = this.pressed.size > 0;
    this.pressed.clear();
    return i;
  }
}
