import type { EventBus } from '@core/events/EventBus';
import type { DeviceKind } from '@core/events/EventMap';
import { tuning } from '@config/tuning';
import { clamp } from '@core/math/spherical';
import {
  DEFAULT_KEY_BINDINGS,
  MOVE_KEYS,
  type Axis2DAction,
  type ButtonAction,
  type Vec2,
} from './actions';

interface ButtonState {
  down: boolean;
  pressedThisFrame: boolean;
  releasedThisFrame: boolean;
  /** Seconds since the last press, used for jump buffering. */
  sincePress: number;
  /** Pressed since the last frame began, and so not yet aged. */
  fresh: boolean;
}

const makeButton = (): ButtonState => ({
  down: false,
  pressedThisFrame: false,
  releasedThisFrame: false,
  sincePress: Infinity,
  fresh: false,
});

/**
 * Device-agnostic input.
 *
 * Merges keyboard/mouse, gamepad and touch into one action map, and publishes
 * `input:deviceChanged` so the UI can swap prompt glyphs the moment a player
 * picks up a controller mid-run.
 */
export class InputManager {
  private readonly buttons: Record<ButtonAction, ButtonState> = {
    run: makeButton(),
    jump: makeButton(),
    interact: makeButton(),
    emote: makeButton(),
    pause: makeButton(),
    camera: makeButton(),
    journal: makeButton(),
  };

  private readonly keysDown = new Set<string>();
  private moveVector: Vec2 = { x: 0, y: 0 };
  private lookDelta: Vec2 = { x: 0, y: 0 };

  /** Accumulated pointer movement, drained once per frame. */
  private pointerDelta: Vec2 = { x: 0, y: 0 };
  private pointerDragging = false;
  private activePointerId: number | null = null;

  private touchMove: Vec2 = { x: 0, y: 0 };
  private touchLookDelta: Vec2 = { x: 0, y: 0 };
  private moveTouchId: number | null = null;
  private lookTouchId: number | null = null;
  private moveTouchOrigin: Vec2 = { x: 0, y: 0 };
  private lastLookTouch: Vec2 = { x: 0, y: 0 };

  private device: DeviceKind = 'keyboard';
  private disposers: Array<() => void> = [];
  private enabled = true;
  /** On a keyboard: run unless Shift is held, instead of only while it is. */
  private alwaysRun = false;

  constructor(
    private readonly target: HTMLElement,
    private readonly bus: EventBus,
  ) {}

  attach(): void {
    const on = <K extends keyof WindowEventMap>(
      el: EventTarget,
      type: K,
      handler: (e: WindowEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, handler as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(type, handler as EventListener));
    };

    on(window, 'keydown', this.onKeyDown);
    on(window, 'keyup', this.onKeyUp);
    on(window, 'blur', this.releaseAll);

    on(this.target, 'pointerdown', this.onPointerDown as (e: Event) => void);
    on(window, 'pointermove', this.onPointerMove as (e: Event) => void);
    on(window, 'pointerup', this.onPointerUp as (e: Event) => void);
    on(window, 'pointercancel', this.onPointerUp as (e: Event) => void);
    on(this.target, 'contextmenu', (e) => e.preventDefault());

    // Zoom. `passive: false` because this must call preventDefault — without
    // it the browser scrolls the page behind the canvas while the camera also
    // moves, which feels broken in a way players cannot describe.
    on(this.target, 'wheel', this.onWheel as (e: Event) => void, { passive: false });
  }

  /**
   * Accumulated zoom intent since the last read, in notches.
   *
   * Accumulated rather than sampled because a wheel fires in bursts that do not
   * line up with frames: reading "the last event" drops most of a fast flick
   * and makes the zoom feel like it is ignoring you. Positive pulls the camera
   * in.
   */
  private zoomAccumulator = 0;

  /** Take the accumulated zoom and reset it. Call once per frame. */
  consumeZoom(): number {
    const value = this.zoomAccumulator;
    this.zoomAccumulator = 0;
    return value;
  }

  private onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    this.device = 'keyboard';

    // deltaMode 1 is lines, 2 is pages; normalising keeps a trackpad and a
    // notched wheel roughly comparable instead of one being twenty times the
    // other.
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
    this.zoomAccumulator += (-event.deltaY * scale) / 100;
  };

  dispose(): void {
    for (const off of this.disposers) off();
    this.disposers = [];
  }

  /**
   * Gameplay input on or off. Off also hands the cursor back, since every
   * reason to turn input off — a menu, the pause screen, a conversation —
   * wants a pointer to click with. On takes it again, if the browser allows
   * (it needs a recent click or key press; failing that, the next click on
   * the canvas takes it).
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.releaseAll();
      this.unlockPointer();
    } else {
      this.lockPointer();
    }
  }

  // ── mouse look ───────────────────────────────────────────────────────────
  //
  // Moving the mouse turns the camera, with no button held: the pointer is
  // locked to the canvas while playing, the way a game on the desktop works.
  // Dragging with a button still turns it wherever the lock is unavailable
  // (or refused), so nothing depends on the lock.

  /** True while the pointer is locked to the canvas. */
  get pointerLocked(): boolean {
    return typeof document !== 'undefined' && document.pointerLockElement === this.target;
  }

  /** Ask for the pointer lock. Harmless when not allowed; the browser just refuses. */
  lockPointer(): void {
    if (!this.enabled || this.device === 'touch' || this.pointerLocked) return;
    const request = (this.target as HTMLElement & { requestPointerLock?: () => Promise<void> | void })
      .requestPointerLock;
    if (typeof request !== 'function') return;
    try {
      const pending: unknown = request.call(this.target);
      // Current browsers return a promise and reject it without a gesture.
      if (pending instanceof Promise) pending.catch(() => undefined);
    } catch {
      // Older ones throw instead.
    }
  }

  unlockPointer(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  get activeDevice(): DeviceKind {
    return this.device;
  }

  /**
   * Run by default on a keyboard, with Shift to slow to a walk.
   *
   * A stick already says how fast by how far it is pushed; a keyboard can only
   * say "W", and holding a second key for the whole of every journey is a
   * chore. Sticks and touch are unaffected.
   */
  setAlwaysRun(alwaysRun: boolean): void {
    this.alwaysRun = alwaysRun;
  }

  /** Where the floating touch stick is, for the HUD to draw it. Null when no thumb is down. */
  get touchStick(): { origin: Vec2; vector: Vec2 } | null {
    if (this.moveTouchId === null) return null;
    return { origin: this.moveTouchOrigin, vector: this.touchMove };
  }

  /** Poll pad state and fold every source into the action map. `dt` is the real frame time. */
  beginFrame(dt: number): void {
    if (!this.enabled) {
      this.moveVector = { x: 0, y: 0 };
      this.lookDelta = { x: 0, y: 0 };
      return;
    }

    // A press ages from the frame *after* the one it arrived before. The
    // simulation reads "pressed within the last 0.14 s" in its fixed steps,
    // which run after this; aged by a whole slow frame first, a press could be
    // too old before any step had seen it, and below about seven frames a
    // second the jump stopped working altogether.
    for (const state of Object.values(this.buttons)) {
      if (state.fresh) state.fresh = false;
      else if (state.sincePress !== Infinity) state.sincePress += dt;
    }

    const pad = this.pollGamepad();

    // Movement: keyboard and pad and touch all contribute; the largest wins.
    const keyMove = this.readKeyboardMove();
    this.moveVector = pickLargest(pickLargest(keyMove, pad.move), this.touchMove);

    // Look: pointer travel, touch drag, or the right stick. The stick is a
    // rate, so it is scaled by the real frame time (this was a constant 1/60,
    // which made the camera turn faster the faster the machine) and expressed
    // in the pixels of mouse travel that would turn the camera as far. Squared,
    // so the middle of the stick is fine control and the rim is a full turn.
    const px = 1 / tuning.camera.mouseSensitivity;
    const curve = (v: number): number => v * Math.abs(v);
    this.lookDelta = {
      x: this.pointerDelta.x + this.touchLookDelta.x + curve(pad.look.x) * tuning.camera.gamepadYawSpeed * px * dt,
      y: this.pointerDelta.y + this.touchLookDelta.y + curve(pad.look.y) * tuning.camera.gamepadPitchSpeed * px * dt,
    };
    this.pointerDelta = { x: 0, y: 0 };
    this.touchLookDelta = { x: 0, y: 0 };

    // Auto-run when a stick or virtual joystick is pushed past the threshold.
    const magnitude = Math.hypot(this.moveVector.x, this.moveVector.y);
    if (this.device !== 'keyboard' && magnitude > tuning.input.runThreshold) {
      this.buttons.run.down = true;
    } else if (this.device !== 'keyboard') {
      this.buttons.run.down = false;
    }
  }

  /** Clear edge-triggered state. Must run at the very end of the frame. */
  endFrame(): void {
    for (const state of Object.values(this.buttons)) {
      state.pressedThisFrame = false;
      state.releasedThisFrame = false;
    }
  }

  getAxis2D(action: Axis2DAction): Vec2 {
    return action === 'move' ? this.moveVector : this.lookDelta;
  }

  isDown(action: ButtonAction): boolean {
    const down = this.buttons[action].down;
    // Shift means "the other gait": with always-run on, it walks.
    if (action === 'run' && this.alwaysRun && this.device === 'keyboard') return !down;
    return down;
  }

  wasPressed(action: ButtonAction): boolean {
    return this.buttons[action].pressedThisFrame;
  }

  wasReleased(action: ButtonAction): boolean {
    return this.buttons[action].releasedThisFrame;
  }

  /**
   * True if the action was pressed within `window` seconds — this is what makes
   * a jump pressed just before landing still fire (docs/03 §3.2).
   */
  wasPressedWithin(action: ButtonAction, window: number): boolean {
    return this.buttons[action].sincePress <= window;
  }

  /** Consume a buffered press so it cannot trigger twice. */
  consume(action: ButtonAction): void {
    this.buttons[action].sincePress = Infinity;
  }

  // ── touch surface, driven by the on-screen controls ──────────────────────

  /** Virtual joystick output in the range [-1, 1]. */
  setTouchMove(v: Vec2): void {
    this.touchMove = v;
    if (v.x !== 0 || v.y !== 0) this.setDevice('touch');
  }

  pressTouchButton(action: ButtonAction): void {
    this.setDevice('touch');
    this.press(action);
  }

  releaseTouchButton(action: ButtonAction): void {
    this.release(action);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private readKeyboardMove(): Vec2 {
    const held = (codes: readonly string[]) => codes.some((c) => this.keysDown.has(c));
    const x = (held(MOVE_KEYS.right) ? 1 : 0) - (held(MOVE_KEYS.left) ? 1 : 0);
    const y = (held(MOVE_KEYS.forward) ? 1 : 0) - (held(MOVE_KEYS.back) ? 1 : 0);
    if (x === 0 && y === 0) return { x: 0, y: 0 };
    // Normalise so diagonal movement is not faster than cardinal.
    const len = Math.hypot(x, y);
    return { x: x / len, y: y / len };
  }

  private pollGamepad(): { move: Vec2; look: Vec2 } {
    const zero = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 } };
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return zero;

    const pad = Array.from(navigator.getGamepads()).find((p) => p?.connected);
    if (!pad) return zero;

    const dz = tuning.input.stickDeadzone;
    const axis = (i: number) => {
      const raw = pad.axes[i] ?? 0;
      if (Math.abs(raw) < dz) return 0;
      // Rescale past the deadzone so control is smooth from zero.
      const sign = Math.sign(raw);
      return sign * ((Math.abs(raw) - dz) / (1 - dz));
    };

    const move = { x: axis(0), y: -axis(1) };
    const look = { x: axis(2), y: axis(3) };

    const pressed = (i: number) => pad.buttons[i]?.pressed ?? false;
    const anyInput =
      move.x !== 0 || move.y !== 0 || look.x !== 0 || look.y !== 0 || pressed(0) || pressed(9);
    if (anyInput) this.setDevice('gamepad');

    this.syncHeld('jump', pressed(0));
    this.syncHeld('interact', pressed(2));
    this.syncHeld('emote', pressed(12));
    this.syncHeld('pause', pressed(9));
    this.syncHeld('camera', pressed(3));
    this.syncHeld('journal', pressed(8));

    return { move, look };
  }

  /** Drive a button from a polled (level-triggered) source, deriving edges. */
  private syncHeld(action: ButtonAction, held: boolean): void {
    const state = this.buttons[action];
    if (held && !state.down) this.press(action);
    else if (!held && state.down) this.release(action);
  }

  private press(action: ButtonAction): void {
    const state = this.buttons[action];
    if (state.down) return;
    state.down = true;
    state.pressedThisFrame = true;
    state.sincePress = 0;
    state.fresh = true;
  }

  private release(action: ButtonAction): void {
    const state = this.buttons[action];
    if (!state.down) return;
    state.down = false;
    state.releasedThisFrame = true;
  }

  private setDevice(device: DeviceKind): void {
    if (this.device === device) return;
    this.device = device;
    this.bus.emit('input:deviceChanged', { device });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled || e.repeat) return;
    this.keysDown.add(e.code);
    this.setDevice('keyboard');

    for (const [action, codes] of Object.entries(DEFAULT_KEY_BINDINGS) as [
      ButtonAction,
      string[],
    ][]) {
      if (codes.includes(e.code)) {
        this.press(action);
        // Space and arrows scroll the page otherwise, and Tab leaves the canvas.
        if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.code);
    for (const [action, codes] of Object.entries(DEFAULT_KEY_BINDINGS) as [
      ButtonAction,
      string[],
    ][]) {
      if (codes.includes(e.code)) this.release(action);
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;

    if (e.pointerType === 'touch') {
      this.setDevice('touch');
      const leftHalf = e.clientX < window.innerWidth * 0.5;
      if (leftHalf && this.moveTouchId === null) {
        // Floating-origin joystick: it appears wherever the thumb lands.
        this.moveTouchId = e.pointerId;
        this.moveTouchOrigin = { x: e.clientX, y: e.clientY };
      } else if (!leftHalf && this.lookTouchId === null) {
        this.lookTouchId = e.pointerId;
        this.lastLookTouch = { x: e.clientX, y: e.clientY };
      }
      return;
    }

    this.setDevice('keyboard');
    // A click on the canvas is the gesture the lock needs.
    if (!this.pointerLocked) this.lockPointer();
    this.pointerDragging = true;
    this.activePointerId = e.pointerId;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.enabled) return;

    if (e.pointerType === 'touch') {
      if (e.pointerId === this.moveTouchId) {
        const dx = e.clientX - this.moveTouchOrigin.x;
        const dy = e.clientY - this.moveTouchOrigin.y;
        const radius = 56;
        this.touchMove = {
          x: clamp(dx / radius, -1, 1),
          y: clamp(-dy / radius, -1, 1),
        };
      } else if (e.pointerId === this.lookTouchId) {
        this.touchLookDelta.x += e.clientX - this.lastLookTouch.x;
        this.touchLookDelta.y += e.clientY - this.lastLookTouch.y;
        this.lastLookTouch = { x: e.clientX, y: e.clientY };
      }
      return;
    }

    // Locked: every movement looks, button or not.
    if (this.pointerLocked) {
      this.pointerDelta.x += e.movementX;
      this.pointerDelta.y += e.movementY;
      return;
    }
    if (!this.pointerDragging || e.pointerId !== this.activePointerId) return;
    this.pointerDelta.x += e.movementX;
    this.pointerDelta.y += e.movementY;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId === this.moveTouchId) {
      this.moveTouchId = null;
      this.touchMove = { x: 0, y: 0 };
    } else if (e.pointerId === this.lookTouchId) {
      this.lookTouchId = null;
    } else if (e.pointerId === this.activePointerId) {
      this.pointerDragging = false;
      this.activePointerId = null;
    }
  };

  private releaseAll = (): void => {
    this.keysDown.clear();
    this.touchMove = { x: 0, y: 0 };
    this.moveTouchId = null;
    this.lookTouchId = null;
    this.pointerDragging = false;
    for (const action of Object.keys(this.buttons) as ButtonAction[]) this.release(action);
  };
}

/** Return whichever vector has the larger magnitude. */
function pickLargest(a: Vec2, b: Vec2): Vec2 {
  return Math.hypot(b.x, b.y) > Math.hypot(a.x, a.y) ? b : a;
}
