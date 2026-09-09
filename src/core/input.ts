/** Input adapter: keys/touch become gameplay intent; simulation never sees browser events. */
export interface Intent {
  mx: number;
  mz: number;
  run: boolean;
  jump: boolean;
  jumpEdge: boolean;
  stretch: boolean;
  rot: number;
  restart: boolean;
  spotDelta: number;
  spotIndex: number;
  trickDelta: number;
  trickIndex: number;
  toggleHelp: boolean;
  toggleMute: boolean;
  toggleMap: boolean;
  anyPress: boolean;
  lookDX: number;
  lookDY: number;
  pointerLocked: boolean;
}

export class Input {
  private down = new Set<string>();
  private pressed = new Map<string, number>();
  private mouseDown = [false, false];
  private tapped = false;
  private accumDX = 0;
  private accumDY = 0;
  private el: HTMLElement | null = null;
  private activeTouches = new Map<number, 'commit' | 'stretch'>();

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
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouseDown[0] = this.mouseDown[1] = false;
      this.activeTouches.clear();
    });

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
      this.fireFirst();
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => { this.mouseDown[e.button === 2 ? 1 : 0] = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    // Each touch keeps its own role so releasing one finger no longer leaves
    // another virtual control stuck until every finger has left the screen.
    el.addEventListener('touchstart', (e) => {
      this.fireFirst();
      for (const t of Array.from(e.changedTouches)) {
        const role: 'commit' | 'stretch' = t.clientX < window.innerWidth * 0.35 ? 'stretch' : 'commit';
        this.activeTouches.set(t.identifier, role);
        if (role === 'commit') this.tapped = true;
      }
      this.syncTouches();
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchend', (e) => {
      for (const t of Array.from(e.changedTouches)) this.activeTouches.delete(t.identifier);
      this.syncTouches();
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchcancel', (e) => {
      for (const t of Array.from(e.changedTouches)) this.activeTouches.delete(t.identifier);
      this.syncTouches();
      e.preventDefault();
    }, { passive: false });
  }

  private syncTouches() {
    let commit = false, stretch = false;
    for (const role of this.activeTouches.values()) {
      if (role === 'commit') commit = true;
      else stretch = true;
    }
    this.mouseDown[0] = commit;
    this.mouseDown[1] = stretch;
  }

  private fireFirst() {
    if (!this.gotFirst) { this.gotFirst = true; this.onFirstInput?.(); }
  }
  private has(...codes: string[]) { return codes.some((c) => this.down.has(c)); }
  private hit(...codes: string[]) { return codes.some((c) => (this.pressed.get(c) ?? 0) > 0); }
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
    i.jumpEdge = this.tapped || this.hit('Space');
    this.tapped = false;

    // W really does straighten in the air now, matching the HUD/README. On foot
    // it still remains forward movement because the game state decides meaning.
    i.stretch = this.has('KeyW', 'ArrowUp') || this.mouseDown[1];
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
