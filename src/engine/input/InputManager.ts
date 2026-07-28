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
}

const makeButton = (): ButtonState => ({
  down: false,
  pressedThisFrame: false,
  releasedThisFrame: false,
  sincePress: Infinity,
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
  }

  dispose(): void {
    for (const off of this.disposers) off();
    this.disposers = [];
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  get activeDevice(): DeviceKind {
    return this.device;
  }

  /** Poll pad state and fold every source into the action map. */
  beginFrame(dt: number): void {
    if (!this.enabled) {
      this.moveVector = { x: 0, y: 0 };
      this.lookDelta = { x: 0, y: 0 };
      return;
    }

    for (const state of Object.values(this.buttons)) {
      if (state.sincePress !== Infinity) state.sincePress += dt;
    }

    const pad = this.pollGamepad();

    // Movement: keyboard and pad and touch all contribute; the largest wins.
    const keyMove = this.readKeyboardMove();
    this.moveVector = pickLargest(pickLargest(keyMove, pad.move), this.touchMove);

    // Look: pointer drag, right stick (scaled by dt), or touch drag.
    this.lookDelta = {
      x: this.pointerDelta.x + pad.look.x * tuning.camera.gamepadSensitivity * dt * 1000 + this.touchLookDelta.x,
      y: this.pointerDelta.y + pad.look.y * tuning.camera.gamepadSensitivity * dt * 1000 + this.touchLookDelta.y,
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
    return this.buttons[action].down;
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
        // Space and arrows scroll the page otherwise.
        if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
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
