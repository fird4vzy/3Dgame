import type { EventBus } from '@core/events/EventBus';
import { t } from '@engine/i18n/Localization';
import type { UIScreen } from '../UIManager';

export interface MenuProgress {
  completed: number;
  total: number;
  hasProgress: boolean;
  /** Journal entries, for the continue line. */
  journal: number;
  journalTotal: number;
}

/**
 * The main menu, over the live planet.
 *
 * The world is already loaded, so a slow high orbit of it is a better backdrop
 * than anything we could author — it previews the reward state and costs one
 * camera path. The title sits on it like the cover of a volume: the name, a
 * line of copy on a pasted strip, and the festival's name down the edge.
 *
 * **Continue is primary whenever a save exists.** Returning players outnumber
 * first runs, and making them hunt past "New run" every time is the small
 * rudeness menus are usually guilty of.
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
    root.classList.add('lp-menu');

    const scrim = document.createElement('div');
    scrim.setAttribute('aria-hidden', 'true');
    scrim.className = 'lp-menu-scrim';
    root.append(scrim);

    // The festival's name, set vertically as on a book's spine.
    const spine = document.createElement('div');
    spine.className = 'lp-menu-vertical';
    spine.setAttribute('aria-hidden', 'true');
    spine.innerHTML = '<b>灯</b>籠祭';
    root.append(spine);

    const card = document.createElement('div');
    card.className = 'lp-menu-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', t('game.title'));

    const title = document.createElement('h1');
    title.className = 'lp-menu-title';
    title.textContent = t('game.title');

    const tagline = document.createElement('p');
    tagline.className = 'lp-menu-tagline';
    tagline.textContent = t('game.tagline');

    const actions = document.createElement('div');
    actions.className = 'lp-actions';
    actions.style.minWidth = '270px';

    if (this.progress.hasProgress) {
      actions.appendChild(
        this.button(
          t('menu.continue'),
          t('menu.continueDetail', {
            done: this.progress.completed,
            total: this.progress.total,
            found: this.progress.journal,
            all: this.progress.journalTotal,
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

    card.append(title, tagline, actions);
    root.appendChild(card);
    return root;
  }

  /** Escape does nothing here — there is nowhere further back to go. */
  onBack(): boolean {
    return true;
  }

  private button(label: string, detail: string | null, onClick: () => void, primary = false): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lp-btn${primary ? ' lp-btn--primary' : ''}`;

    const text = document.createElement('span');
    text.textContent = label;
    button.appendChild(text);

    if (detail) {
      const hint = document.createElement('small');
      hint.textContent = detail;
      button.appendChild(hint);
    }

    button.addEventListener('click', onClick);
    return button;
  }
}
