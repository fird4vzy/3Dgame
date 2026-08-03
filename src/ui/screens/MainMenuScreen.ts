import type { EventBus } from '@core/events/EventBus';
import { t } from '@engine/i18n/Localization';
import type { UIScreen } from '../UIManager';

export interface MenuProgress {
  completed: number;
  total: number;
  hasProgress: boolean;
}

/**
 * The main menu, over the live planet.
 *
 * The world is already loaded, so a slow high orbit of it is a better backdrop
 * than anything we could author — it previews the reward state and costs one
 * camera path.
 *
 * **Continue is primary whenever a save exists.** After launch, returning
 * players outnumber first runs, and making them hunt past "New run" every time
 * is the small rudeness menus are usually guilty of.
 */
export class MainMenuScreen implements UIScreen {
  readonly id = 'main-menu';

  constructor(
    private readonly bus: EventBus,
    private readonly progress: MenuProgress,
    private readonly onOpenSettings: () => void,
  ) {}

  render(): HTMLElement {
    const root = document.createElement('div');
    // `justify-content` (not justify-items) is what actually moves a single
    // grid child off centre.
    // No `position` here. `.lp-screen` is already `position:absolute; inset:0`,
    // and it is that which gives the backdrop below something to fill — setting
    // `position:relative` inline overrides the class, drops the element back
    // into flow, and collapses the screen to the height of its own text.
    root.style.cssText =
      'align-content:center;justify-content:start;padding-left:min(11vw,110px)';

    // Only the scrim. The painted key art went here for a while and it was the
    // wrong call: a still image, however good, is a poster, and the live planet
    // turning slowly behind the title is the game showing you itself. It looked
    // bad only because it was unlit and fogged out — both since fixed — and a
    // static replacement papered over that instead of solving it.
    //
    // The art is kept as `assets/ui/menu-key-art.webp` for a loading screen or
    // a share card, where nothing is moving anyway.
    root.append(this.scrim());

    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', t('game.title'));
    panel.style.cssText =
      'display:flex;flex-direction:column;gap:var(--lp-space-2);max-width:420px';

    const title = document.createElement('h1');
    title.textContent = t('game.title');
    title.style.cssText = [
      'font-family:var(--lp-font-display)',
      'font-weight:700',
      'font-size:clamp(44px,7vw,76px)',
      'line-height:1',
      'letter-spacing:.02em',
      'margin:0',
      'color:var(--lp-ink)',
      // Outlined by offset copies, matching every other heading. A blur alone
      // leaves a light serif floating over a starfield with nothing holding it.
      'text-shadow:-3px 0 #14101c,3px 0 #14101c,0 -3px #14101c,0 3px #14101c,0 8px 26px rgba(0,0,0,.8)',
    ].join(';');

    const tagline = document.createElement('p');
    tagline.textContent = t('game.tagline');
    tagline.style.cssText = [
      'font-family:var(--lp-font-display)',
      'font-weight:500',
      'font-size:clamp(15px,1.7vw,19px)',
      'color:var(--lp-ink-soft)',
      'margin:0 0 var(--lp-space-5)',
      'max-width:30ch',
      'text-shadow:0 2px 20px rgba(0,0,0,.85)',
    ].join(';');

    panel.append(title, tagline);

    const actions = document.createElement('div');
    actions.className = 'lp-actions';
    actions.style.minWidth = '260px';

    if (this.progress.hasProgress) {
      actions.appendChild(
        this.button(
          t('menu.continue'),
          t('menu.continueDetail', {
            done: this.progress.completed,
            total: this.progress.total,
          }),
          () => this.bus.emit('ui:requestStart', { newRun: false }),
          true,
        ),
      );
      actions.appendChild(
        this.button(t('menu.newRun'), null, () => {
          // Overwriting a run in progress is the only destructive thing this
          // menu can do, so it asks first.
          if (window.confirm(t('menu.newRunConfirm'))) {
            this.bus.emit('ui:requestStart', { newRun: true });
          }
        }),
      );
    } else {
      actions.appendChild(
        this.button(t('menu.start'), null, () => this.bus.emit('ui:requestStart', { newRun: true }), true),
      );
    }

    actions.appendChild(this.button(t('menu.settings'), null, this.onOpenSettings));
    panel.appendChild(actions);
    root.appendChild(panel);
    return root;
  }

  /** Escape does nothing here — there is nowhere further back to go. */
  onBack(): boolean {
    return true;
  }

  /**
   * A scrim under the text.
   *
   * A serif title over a turning starfield is a contrast gamble at small window
   * sizes. This costs nothing and makes the
   * copy legible at every aspect ratio the art gets cropped to.
   */
  private scrim(): HTMLElement {
    const scrim = document.createElement('div');
    scrim.setAttribute('aria-hidden', 'true');
    scrim.className = 'lp-menu-scrim';
    scrim.style.cssText = 'position:absolute;inset:0;z-index:-1;pointer-events:none';
    return scrim;
  }

  private button(
    label: string,
    detail: string | null,
    onClick: () => void,
    primary = false,
  ): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lp-btn${primary ? ' lp-btn--primary' : ''}`;

    const text = document.createElement('span');
    text.textContent = label;
    button.appendChild(text);

    if (detail) {
      const hint = document.createElement('span');
      hint.textContent = detail;
      hint.style.cssText = 'font-size:.78em;font-weight:500;opacity:.75';
      button.appendChild(hint);
    }

    button.addEventListener('click', onClick);
    return button;
  }
}
