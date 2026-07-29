import type { EventBus } from '@core/events/EventBus';
import type { SettingsManager } from '@engine/settings/SettingsManager';
import type { SettingsData } from '@engine/save/schema';
import { t } from '@engine/i18n/Localization';
import type { UIScreen } from '../UIManager';

/**
 * Settings, applied live.
 *
 * Every control writes through `SettingsManager` immediately — no Apply button.
 * A settings screen that needs confirmation makes the player guess what a
 * slider does before they can hear or see it.
 *
 * Accessibility is a top-level group in the main list, not a tab behind a
 * click: reduce motion, interface size and subtitles belong where people will
 * actually find them.
 */
export class SettingsScreen implements UIScreen {
  readonly id = 'settings';

  constructor(
    private readonly bus: EventBus,
    private readonly settings: SettingsManager,
    private readonly onBackPressed: () => void,
    private readonly onResetProgress?: () => void,
  ) {}

  render(): HTMLElement {
    const root = document.createElement('div');
    root.style.placeContent = 'center';
    root.style.justifyItems = 'center';

    const scrim = document.createElement('div');
    scrim.className = 'lp-scrim';
    root.appendChild(scrim);

    const panel = document.createElement('div');
    panel.className = 'lp-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', t('settings.title'));
    panel.style.maxHeight = '82vh';
    panel.style.overflowY = 'auto';

    const title = document.createElement('h2');
    title.className = 'lp-title';
    title.textContent = t('settings.title');
    panel.appendChild(title);

    panel.append(
      this.group(t('settings.audio')),
      this.slider('settings.master', 'masterVolume'),
      this.slider('settings.music', 'musicVolume'),
      this.slider('settings.sfx', 'sfxVolume'),
      this.slider('settings.ambience', 'ambienceVolume'),

      this.group(t('settings.controls')),
      this.slider('settings.sensitivity', 'cameraSensitivity', 0.25, 3, 0.05),
      this.toggle('settings.invertY', 'invertY'),

      this.group(t('settings.accessibility')),
      this.toggle('settings.reduceMotion', 'reduceMotion'),
      this.toggle('settings.cameraShake', 'cameraShake'),
      this.toggle('settings.subtitles', 'subtitles'),
      this.slider('settings.uiScale', 'uiScale', 0.8, 1.5, 0.05),
    );

    const actions = document.createElement('div');
    actions.className = 'lp-actions';
    actions.style.marginTop = 'var(--lp-space-5)';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'lp-btn lp-btn--primary';
    back.textContent = t('menu.back');
    back.addEventListener('click', this.onBackPressed);
    actions.appendChild(back);

    if (this.onResetProgress) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'lp-btn';
      reset.style.borderColor = 'var(--lp-danger)';
      reset.style.color = 'var(--lp-danger)';
      reset.textContent = t('settings.resetProgress');
      reset.addEventListener('click', () => {
        // The only irreversible action in the game, so it confirms.
        if (window.confirm(t('settings.resetConfirm'))) this.onResetProgress?.();
      });
      actions.appendChild(reset);
    }

    panel.appendChild(actions);
    root.appendChild(panel);
    return root;
  }

  onBack(): boolean {
    this.onBackPressed();
    return true;
  }

  private group(label: string): HTMLElement {
    const heading = document.createElement('div');
    heading.textContent = label;
    heading.style.cssText = [
      'font-size:11px',
      'letter-spacing:.14em',
      'text-transform:uppercase',
      'color:var(--lp-lumen)',
      'font-weight:700',
      'margin:var(--lp-space-5) 0 var(--lp-space-2)',
      'padding-bottom:var(--lp-space-1)',
      'border-bottom:1px solid var(--lp-rule)',
    ].join(';');
    return heading;
  }

  private row(labelKey: string, control: HTMLElement, id: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'lp-row';

    const label = document.createElement('label');
    label.textContent = t(labelKey);
    label.htmlFor = id;

    row.append(label, control);
    return row;
  }

  private slider<K extends keyof SettingsData>(
    labelKey: string,
    key: K,
    min = 0,
    max = 1,
    step = 0.05,
  ): HTMLElement {
    const id = `set_${String(key)}`;
    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(this.settings.get()[key]);
    input.setAttribute('aria-label', t(labelKey));

    input.addEventListener('input', () => {
      const value = Number(input.value) as SettingsData[K];
      this.settings.set(key, value);
      this.bus.emit('ui:settingChanged', { key: String(key), value });
    });

    return this.row(labelKey, input, id);
  }

  private toggle<K extends keyof SettingsData>(labelKey: string, key: K): HTMLElement {
    const id = `set_${String(key)}`;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = Boolean(this.settings.get()[key]);
    input.style.cssText = 'width:20px;height:20px;accent-color:var(--lp-lumen)';
    input.setAttribute('aria-label', t(labelKey));

    input.addEventListener('change', () => {
      this.settings.set(key, input.checked as SettingsData[K]);
      this.bus.emit('ui:settingChanged', { key: String(key), value: input.checked });
    });

    return this.row(labelKey, input, id);
  }
}
