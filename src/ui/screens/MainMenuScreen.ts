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

    root.append(this.backdrop(), this.scrim());

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

  /**
   * Painted key art behind the title.
   *
   * The menu used to sit over the live 3D planet, which is a lovely idea and
   * was not working: the orbital camera has no key light of its own, the ground
   * fog swallowed the whole globe, and it read as a flat grey disc. Painted art
   * shows the thing the menu is actually selling — one district alight, the rest
   * of the little world still dark — at a quality the real-time renderer is not
   * going to reach on a title screen.
   *
   * `object-position` is pinned right because the art is composed with its left
   * third empty for exactly this text.
   */
  private backdrop(): HTMLElement {
    const image = document.createElement('img');
    image.src = `${import.meta.env.BASE_URL}assets/ui/menu-key-art.webp`;
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.className = 'lp-menu-art';
    // `inset:0` does not stretch a replaced element — it needs explicit size.
    // `object-position` lives in the stylesheet because it has to respond to
    // aspect ratio, which inline styles cannot do.
    image.style.cssText = [
      'position:absolute',
      'inset:0',
      'width:100%',
      'height:100%',
      'object-fit:cover',
      'z-index:-2',
      'pointer-events:none',
    ].join(';');
    return image;
  }

  /**
   * A scrim under the text.
   *
   * Even with the art's empty left third, a serif title over starfield is a
   * contrast gamble at small window sizes. This costs nothing and makes the
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
