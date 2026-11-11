import type { EventBus } from '@core/events/EventBus';
import type { InputManager } from '@engine/input/InputManager';
import type { ButtonAction } from '@engine/input/actions';

/**
 * On-screen controls for a phone or a tablet.
 *
 * The input layer has understood touch from the start — a thumb on the left
 * half moves, a thumb on the right half looks — but nothing was ever drawn,
 * and there was no way at all to jump, talk to anyone or pause. A game you
 * cannot start the first conversation of is not a game that works on a phone,
 * however well the canvas fits the screen.
 *
 * So: the stick is drawn where the thumb lands, and four things the thumbs
 * cannot say by dragging get buttons (how fast to go is how far the stick is pushed). They appear the first time the screen
 * is touched and go away again when a key or a pad is used.
 */
export class TouchControls {
  private readonly root: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly hint: HTMLElement;
  private shown = false;
  private used = false;

  constructor(
    parent: HTMLElement,
    private readonly input: InputManager,
    private readonly bus: EventBus,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'lp-touch';

    this.stick = document.createElement('div');
    this.stick.className = 'lp-stick';
    this.knob = document.createElement('i');
    this.stick.appendChild(this.knob);

    this.hint = document.createElement('div');
    this.hint.className = 'lp-stick-hint';
    this.hint.textContent = 'Move';

    const buttons = document.createElement('div');
    buttons.className = 'lp-touch-buttons';
    buttons.append(
      this.hold('camera', 'Photo'),
      this.hold('jump', 'Jump'),
      this.hold('interact', 'Talk', true),
    );

    const top = document.createElement('div');
    top.className = 'lp-touch-top';
    top.append(
      this.tap('Book', () => this.bus.emit('ui:requestJournal')),
      this.tap('II', () => this.bus.emit('ui:requestPause')),
    );

    this.root.append(this.stick, this.hint, buttons, top);
    parent.appendChild(this.root);

    // Coarse pointers get the controls straight away; anything else, the
    // first time a finger actually lands.
    if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) this.setShown(true);
    window.addEventListener('pointerdown', this.onPointer, { passive: true });
    this.bus.on('input:deviceChanged', ({ device }) => this.setShown(device === 'touch'));
  }

  /** Follow the thumb. Called once a frame. */
  update(): void {
    if (!this.shown) return;
    const stick = this.input.touchStick;
    this.stick.dataset.shown = String(stick !== null);
    if (!stick) return;
    if (!this.used) {
      this.used = true;
      this.hint.style.display = 'none';
    }
    this.stick.style.left = `${stick.origin.x}px`;
    this.stick.style.top = `${stick.origin.y}px`;
    this.knob.style.transform = `translate(${stick.vector.x * 34}px, ${-stick.vector.y * 34}px)`;
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.onPointer);
    this.root.remove();
  }

  private onPointer = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') this.setShown(true);
  };

  private setShown(shown: boolean): void {
    this.shown = shown;
    this.root.dataset.shown = String(shown);
  }

  /** A button that is down for as long as the finger is. */
  private hold(action: ButtonAction, label: string, main = false): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lp-touch-btn${main ? ' lp-touch-btn--main' : ''}`;
    button.textContent = label;
    button.setAttribute('aria-label', label);
    const down = (event: PointerEvent): void => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      button.dataset.down = 'true';
      this.input.pressTouchButton(action);
    };
    const up = (): void => {
      button.dataset.down = 'false';
      this.input.releaseTouchButton(action);
    };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    return button;
  }

  private tap(label: string, onTap: () => void): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lp-touch-btn';
    button.textContent = label;
    button.setAttribute('aria-label', label === 'II' ? 'Pause' : 'Journal');
    button.addEventListener('click', onTap);
    return button;
  }
}
