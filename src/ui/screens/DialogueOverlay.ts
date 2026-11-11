import type { EventBus } from '@core/events/EventBus';

const CHARS_PER_SECOND = 48;

/**
 * A speech bubble along the bottom of the frame, with a typewriter reveal.
 *
 * Not a UIScreen: dialogue must not trap focus or steal Escape, because the
 * player is still standing in the world and Escape still means pause. It is a
 * HUD-layer element that happens to accept a click.
 *
 * Tap, Space, Enter or the interact key completes the current line first, then
 * advances — never skipping text the player has not seen.
 */
export class DialogueOverlay {
  private readonly root: HTMLElement;
  private readonly speaker: HTMLElement;
  private readonly body: HTMLElement;
  private readonly next: HTMLElement;

  private fullText = '';
  private revealed = 0;
  private active = false;
  private instant = false;

  constructor(
    parent: HTMLElement,
    private readonly bus: EventBus,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'lp-dialogue';
    this.root.style.display = 'none';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');

    this.speaker = document.createElement('div');
    this.speaker.className = 'lp-dialogue-speaker';

    this.body = document.createElement('p');
    this.body.className = 'lp-dialogue-body';

    this.next = document.createElement('div');
    this.next.className = 'lp-dialogue-next';
    this.next.textContent = 'Continue ▾';

    this.root.append(this.speaker, this.body, this.next);
    parent.appendChild(this.root);

    this.root.addEventListener('click', () => this.advanceOrComplete());
    window.addEventListener('keydown', this.onKeyDown);

    this.bus.on('dialogue:started', () => this.open());
    this.bus.on('dialogue:line', ({ speaker, text }) => this.setLine(speaker, text));
    this.bus.on('dialogue:ended', () => this.close());
  }

  /** Show each line whole, at once, instead of typing it out. */
  setInstant(instant: boolean): void {
    this.instant = instant;
  }

  /** Advance the typewriter. Driven from the frame loop. */
  update(dt: number): void {
    if (!this.active || this.revealed >= this.fullText.length) return;

    this.revealed = this.instant
      ? this.fullText.length
      : Math.min(this.fullText.length, this.revealed + CHARS_PER_SECOND * dt);
    this.body.textContent = this.fullText.slice(0, Math.floor(this.revealed));

    if (this.revealed >= this.fullText.length) this.next.dataset.shown = 'true';
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active || event.repeat) return;
    if (event.code === 'Space' || event.code === 'Enter' || event.code === 'KeyE' || event.code === 'KeyF') {
      event.preventDefault();
      this.advanceOrComplete();
    }
  };

  /**
   * One button, two meanings: finish the reveal if it is still running,
   * otherwise move on. Players reliably mash this, and skipping unseen text
   * would feel like a bug.
   */
  private advanceOrComplete(): void {
    if (!this.active) return;
    if (this.revealed < this.fullText.length) {
      this.revealed = this.fullText.length;
      this.body.textContent = this.fullText;
      this.next.dataset.shown = 'true';
      return;
    }
    this.bus.emit('ui:requestDialogueAdvance');
  }

  private open(): void {
    this.active = true;
    this.root.style.display = '';
    requestAnimationFrame(() => {
      this.root.dataset.shown = 'true';
    });
  }

  private setLine(speaker: string, text: string): void {
    this.speaker.textContent = speaker;
    this.fullText = text;
    this.revealed = 0;
    this.body.textContent = '';
    this.next.dataset.shown = 'false';
  }

  private close(): void {
    this.active = false;
    this.root.dataset.shown = 'false';
    setTimeout(() => {
      if (!this.active) this.root.style.display = 'none';
    }, 240);
  }
}
