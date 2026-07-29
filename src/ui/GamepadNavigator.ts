export type NavDirection = 'up' | 'down' | 'left' | 'right';

export interface NavRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Spatial focus scoring, as a pure function of geometry.
 *
 * Extracted from the DOM so the part that decides whether "down" *feels* right
 * can be tested without a browser — the same discipline that finally pinned
 * down the A/D handedness bug.
 *
 * Returns the index of the best candidate, or -1 if nothing lies that way.
 * Distance along the axis is the primary cost; drift across it is penalised
 * 2.5×, so "down" prefers the item directly below over one that is marginally
 * nearer but off to the side. Tab order is fine for a form and wrong for a menu.
 */
export function pickInDirection(
  from: NavRect,
  candidates: readonly NavRect[],
  direction: NavDirection,
): number {
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;

  let best = -1;
  let bestScore = Infinity;

  candidates.forEach((rect, index) => {
    const dx = rect.left + rect.width / 2 - fromX;
    const dy = rect.top + rect.height / 2 - fromY;

    const along =
      direction === 'up' ? -dy : direction === 'down' ? dy : direction === 'left' ? -dx : dx;
    // A few pixels of drift is not a direction.
    if (along <= 4) return;

    const across = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
    const score = along + across * 2.5;

    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });

  return best;
}

const DEADZONE = 0.55;
/** Delay before a held stick repeats, then the repeat interval. */
const REPEAT_DELAY = 0.42;
const REPEAT_RATE = 0.14;

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Gamepad navigation for DOM menus.
 *
 * Sliders are special-cased: left/right adjusts the value rather than moving
 * focus, which is what a player expects and what keyboard users already get.
 */
export class GamepadNavigator {
  private repeatTimer = 0;
  private lastDirection: NavDirection | null = null;
  private confirmHeld = false;
  private cancelHeld = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly onCancel: () => void,
  ) {}

  /** Poll the pad. Call once per frame while a menu screen is open. */
  update(dt: number): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;

    const pad = Array.from(navigator.getGamepads()).find((p) => p?.connected);
    if (!pad) {
      this.lastDirection = null;
      return;
    }

    this.handleDirection(pad, dt);
    this.handleButtons(pad);
  }

  private handleDirection(pad: Gamepad, dt: number): void {
    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    const pressed = (i: number) => pad.buttons[i]?.pressed ?? false;

    let direction: NavDirection | null = null;
    if (pressed(12) || y < -DEADZONE) direction = 'up';
    else if (pressed(13) || y > DEADZONE) direction = 'down';
    else if (pressed(14) || x < -DEADZONE) direction = 'left';
    else if (pressed(15) || x > DEADZONE) direction = 'right';

    if (!direction) {
      this.lastDirection = null;
      this.repeatTimer = 0;
      return;
    }

    if (direction !== this.lastDirection) {
      // First press fires immediately; holding then repeats.
      this.lastDirection = direction;
      this.repeatTimer = REPEAT_DELAY;
      this.move(direction);
      return;
    }

    this.repeatTimer -= dt;
    if (this.repeatTimer <= 0) {
      this.repeatTimer = REPEAT_RATE;
      this.move(direction);
    }
  }

  private handleButtons(pad: Gamepad): void {
    const confirm = pad.buttons[0]?.pressed ?? false;
    const cancel = pad.buttons[1]?.pressed ?? false;

    if (confirm && !this.confirmHeld) {
      const active = document.activeElement as HTMLElement | null;
      if (active && this.root.contains(active)) active.click();
    }
    this.confirmHeld = confirm;

    if (cancel && !this.cancelHeld) this.onCancel();
    this.cancelHeld = cancel;
  }

  private move(direction: NavDirection): void {
    const elements = [...this.root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null,
    );
    if (elements.length === 0) return;

    const active = document.activeElement as HTMLElement | null;
    if (!active || !this.root.contains(active)) {
      elements[0]?.focus();
      return;
    }

    // Horizontal input on a slider adjusts it instead of moving focus.
    if (
      (direction === 'left' || direction === 'right') &&
      active instanceof HTMLInputElement &&
      active.type === 'range'
    ) {
      const step = Number(active.step) || 0.05;
      const delta = direction === 'right' ? step : -step;
      const next = Math.min(
        Number(active.max || 1),
        Math.max(Number(active.min || 0), Number(active.value) + delta),
      );
      active.value = String(next);
      active.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    const others = elements.filter((el) => el !== active);
    const index = pickInDirection(
      active.getBoundingClientRect(),
      others.map((el) => el.getBoundingClientRect()),
      direction,
    );
    if (index >= 0) others[index]?.focus();
  }
}
