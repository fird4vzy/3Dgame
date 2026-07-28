import type { EventBus } from '@core/events/EventBus';

const CHARS_PER_SECOND = 45;

/**
 * Bottom-anchored dialogue card with a typewriter reveal.
 *
 * Not a UIScreen: dialogue must not trap focus or steal Escape, because the
 * player is still standing in the world and Escape still means pause. It is a
 * HUD-layer element that happens to accept a click.
 *
 * Tap or Space completes the current line first, then advances — never skipping
 * text the player has not seen.
 */
export class DialogueOverlay {
  private readonly root: HTMLElement;
  private readonly speaker: HTMLElement;
  private readonly body: HTMLElement;
  private readonly chevron: HTMLElement;

  private fullText = '';
  private revealed = 0;
  private active = false;

  constructor(
    parent: HTMLElement,
    private readonly bus: EventBus,
  ) {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:absolute',
      'left:50%',
      'bottom:calc(28px + env(safe-area-inset-bottom))',
      'transform:translateX(-50%) translateY(10px)',
      'width:min(560px,calc(100vw - 40px))',
      'padding:16px 20px',
      'background:rgba(20,23,36,.94)',
      'border:1px solid var(--lp-rule)',
      'border-radius:var(--lp-radius)',
      'box-shadow:0 18px 50px -24px rgba(0,0,0,.9)',
      'pointer-events:auto',
      'cursor:pointer',
      'opacity:0',
      'transition:opacity 220ms ease,transform 220ms ease',
      'display:none',
    ].join(';');

    this.speaker = document.createElement('div');
    this.speaker.style.cssText = [
      'font:650 11.5px/1 var(--lp-font-body)',
      'letter-spacing:.12em',
      'text-transform:uppercase',
      'color:var(--lp-lumen)',
      'margin-bottom:8px',
    ].join(';');

    this.body = document.createElement('p');
    this.body.style.cssText = [
      'margin:0',
      'font:400 15.5px/1.55 var(--lp-font-body)',
      'color:var(--lp-ink)',
      'min-height:3em',
    ].join(';');

    this.chevron = document.createElement('div');
    this.chevron.textContent = '▾';
    this.chevron.style.cssText = [
      'position:absolute',
      'right:16px;bottom:10px',
      'color:var(--lp-lumen)',
      'font-size:13px',
      'opacity:0',
      'transition:opacity 200ms ease',
      'animation:none',
    ].join(';');

    this.root.append(this.speaker, this.body, this.chevron);
    parent.appendChild(this.root);

    this.root.addEventListener('click', () => this.advanceOrComplete());
    window.addEventListener('keydown', this.onKeyDown);

    this.bus.on('dialogue:started', () => this.open());
    this.bus.on('dialogue:line', ({ speaker, text }) => this.setLine(speaker, text));
    this.bus.on('dialogue:ended', () => this.close());
  }

  /** Advance the typewriter. Driven from the frame loop. */
  update(dt: number): void {
    if (!this.active || this.revealed >= this.fullText.length) return;

    this.revealed = Math.min(this.fullText.length, this.revealed + CHARS_PER_SECOND * dt);
    this.body.textContent = this.fullText.slice(0, Math.floor(this.revealed));

    if (this.revealed >= this.fullText.length) this.chevron.style.opacity = '1';
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active) return;
    if (event.code === 'Space' || event.code === 'Enter') {
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
      this.chevron.style.opacity = '1';
      return;
    }
    this.bus.emit('ui:requestDialogueAdvance');
  }

  private open(): void {
    this.active = true;
    this.root.style.display = '';
    requestAnimationFrame(() => {
      this.root.style.opacity = '1';
      this.root.style.transform = 'translateX(-50%) translateY(0)';
    });
  }

  private setLine(speaker: string, text: string): void {
    this.speaker.textContent = speaker;
    this.fullText = text;
    this.revealed = 0;
    this.body.textContent = '';
    this.chevron.style.opacity = '0';
  }

  private close(): void {
    this.active = false;
    this.root.style.opacity = '0';
    this.root.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => {
      if (!this.active) this.root.style.display = 'none';
    }, 240);
  }
}
