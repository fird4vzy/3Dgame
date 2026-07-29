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
    root.style.cssText =
      'align-content:center;justify-content:start;padding-left:min(11vw,110px)';

    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', t('game.title'));
    panel.style.cssText =
      'display:flex;flex-direction:column;gap:var(--lp-space-2);max-width:420px';

    const title = document.createElement('h1');
    title.textContent = t('game.title');
    title.style.cssText = [
      'font-family:var(--lp-font-display)',
      'font-weight:400',
      'font-size:clamp(44px,7vw,76px)',
      'line-height:1',
      'letter-spacing:.02em',
      'margin:0',
      'color:var(--lp-ink)',
      'text-shadow:0 4px 40px rgba(0,0,0,.75)',
    ].join(';');

    const tagline = document.createElement('p');
    tagline.textContent = t('game.tagline');
    tagline.style.cssText = [
      'font-family:var(--lp-font-display)',
      'font-style:italic',
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
