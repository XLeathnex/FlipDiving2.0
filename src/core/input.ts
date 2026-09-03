/**
 * Input is deliberately thin: it produces an intent struct, and nothing else in
 * the game knows what a key is. Adding touch or a gamepad later means writing
 * another producer for the same struct, not touching gameplay.
 *
 * Free-roam changes what the same physical keys mean depending on context, the
 * way a real body's controls would: W/S move you forward and back on your feet,
 * but the instant you plant at an edge and start loading a jump, that same
 * lean-forward/lean-back is exactly what sets your rotation -- because it is
 * the same motion. The game layer decides which meaning applies; this module
 * just reports the raw axis.
 */
export interface Intent {
  /** Movement axes, camera-relative, each -1..1. mz forward, mx right. */
  mx: number;
  mz: number;
  run: boolean;
  jump: boolean;
  /**
   * True if the jump control went down at any point since the last poll, even
   * if it was released again before this frame. Sampling held state alone drops
   * very short taps, and on a retry screen a dropped tap feels like the game
   * ignored you.
   */
  jumpEdge: boolean;
  stretch: boolean;
  /** Air pitch scoop, -1..1. */
  rot: number;
  restart: boolean;
  spotDelta: number;
  spotIndex: number;
  /** -1 / +1 to cycle the air trick. */
  trickDelta: number;
  trickIndex: number;
  toggleHelp: boolean;
  toggleMute: boolean;
  toggleMap: boolean;
  anyPress: boolean;
  /** Mouse-look motion since the last poll, in pixels. Zero unless locked. */
  lookDX: number;
  lookDY: number;
  pointerLocked: boolean;
}

export class Input {
  private down = new Set<string>();
  /**
   * Presses since the last poll, COUNTED rather than flagged. A set collapses a
   * burst of taps on the same key into one, which loses inputs whenever the
   * frame rate dips -- exactly when the player is mashing.
   */
  private pressed = new Map<string, number>();
  private mouseDown = [false, false];
  /** Set by the pointer/touch handlers; consumed by the next poll. */
  private tapped = false;
  private accumDX = 0;
  private accumDY = 0;
  private el: HTMLElement | null = null;
  intent: Intent = {
    mx: 0, mz: 0, run: false,
    jump: false, jumpEdge: false, stretch: false, rot: 0, restart: false,
    spotDelta: 0, spotIndex: -1, trickDelta: 0, trickIndex: -1,
    toggleHelp: false, toggleMute: false, toggleMap: false, anyPress: false,
    lookDX: 0, lookDY: 0, pointerLocked: false,
  };
  onFirstInput: (() => void) | null = null;
  private gotFirst = false;

  attach(el: HTMLElement) {
    this.el = el;
    const key = (e: KeyboardEvent, isDown: boolean) => {
      if (e.repeat) return;
      const k = e.code;
      if (isDown) {
        if (!this.down.has(k)) this.pressed.set(k, (this.pressed.get(k) ?? 0) + 1);
        this.down.add(k);
        this.fireFirst();
      } else this.down.delete(k);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(k)) e.preventDefault();
    };
    window.addEventListener('keydown', (e) => key(e, true));
    window.addEventListener('keyup', (e) => key(e, false));
    window.addEventListener('blur', () => { this.down.clear(); this.mouseDown[0] = this.mouseDown[1] = false; });

    // Pointer lock for mouse-look, the way any first/third-person game does it.
    // A click on the canvas requests it; the browser forces it back off on its
    // own Escape handling, which we just observe rather than fight.
    el.addEventListener('click', () => {
      this.fireFirst();
      if (document.pointerLockElement !== el) el.requestPointerLock?.();
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== el) return;
      this.accumDX += e.movementX || 0;
      this.accumDY += e.movementY || 0;
    });
    el.addEventListener('mousedown', (e) => {
      this.mouseDown[e.button === 2 ? 1 : 0] = true;
      if (e.button !== 2) this.tapped = true;
      this.fireFirst(); e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => { this.mouseDown[e.button === 2 ? 1 : 0] = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    // Touch: a coarse fallback for the dive loop. Free-roam movement is not
    // supported on touch in this pass -- fast travel between named spots
    // covers getting to a jump-off point, which is the part that matters most.
    el.addEventListener('touchstart', (e) => {
      this.fireFirst();
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < window.innerWidth * 0.35) this.mouseDown[1] = true;
        else { this.mouseDown[0] = true; this.tapped = true; }
      }
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) { this.mouseDown[0] = this.mouseDown[1] = false; }
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
    i.mz = (this.has('KeyW', 'ArrowUp') ? 1 : 0) - (this.has('KeyS', 'ArrowDown') ? 1 : 0);
    i.mx = (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0);
    i.run = this.has('ShiftLeft', 'ShiftRight');

    i.jump = this.has('Space') || this.mouseDown[0];
    // A genuine edge: went down since the last poll. Writing this as
    // `i.jump || ...` makes it true for the whole hold, which turns "press to
    // retry" into "retry every single frame you are holding the key".
    i.jumpEdge = this.tapped || this.hit('Space');
    this.tapped = false;
    i.stretch = this.mouseDown[1];
    i.rot = (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0);
    i.restart = this.hit('KeyR', 'Enter');
    i.spotDelta = this.count('BracketRight') - this.count('BracketLeft');
    i.spotIndex = -1;
    for (let n = 1; n <= 9; n++) if (this.hit('Digit' + n)) i.spotIndex = n - 1;
    i.trickDelta = this.count('KeyX', 'Tab') - this.count('KeyZ');
    i.trickIndex = -1;
    for (let n = 1; n <= 9; n++) if (this.hit('F' + n)) i.trickIndex = n - 1;
    i.toggleHelp = this.hit('KeyH', 'Slash');
    i.toggleMute = this.hit('KeyM');
    i.toggleMap = this.hit('KeyG');
    i.anyPress = this.pressed.size > 0;
    this.pressed.clear();

    i.pointerLocked = !!this.el && document.pointerLockElement === this.el;
    i.lookDX = this.accumDX; i.lookDY = this.accumDY;
    this.accumDX = 0; this.accumDY = 0;
    return i;
  }
}
