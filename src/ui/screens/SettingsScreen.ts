import type { EventBus } from '@core/events/EventBus';
import type { SettingsManager } from '@engine/settings/SettingsManager';
import type { SettingsData } from '@engine/save/schema';
import { t } from '@engine/i18n/Localization';
import type { UIScreen } from '../UIManager';

type NumberKey = { [K in keyof SettingsData]: SettingsData[K] extends number ? K : never }[keyof SettingsData];
type BooleanKey = { [K in keyof SettingsData]: SettingsData[K] extends boolean ? K : never }[keyof SettingsData];

/**
 * Build the settings controls. Shared by the settings screen and the pause
 * menu, so there is one list and both always offer the same things.
 *
 * Every control writes through `SettingsManager` immediately — no Apply
 * button — and every control here does something: the two that never did
 * (camera shake, subtitles) are gone.
 */
export function settingsControls(bus: EventBus, settings: SettingsManager): HTMLElement[] {
  const group = (label: string): HTMLElement => {
    const heading = document.createElement('div');
    heading.className = 'lp-group';
    heading.textContent = label;
    return heading;
  };

  const row = (labelKey: string, control: HTMLElement, id: string): HTMLElement => {
    const element = document.createElement('div');
    element.className = 'lp-row';
    const label = document.createElement('label');
    label.textContent = t(labelKey);
    label.htmlFor = id;
    element.append(label, control);
    return element;
  };

  const slider = (labelKey: string, key: NumberKey, min = 0, max = 1, step = 0.05): HTMLElement => {
    const id = `set_${key}`;
    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(settings.get()[key]);
    input.addEventListener('input', () => {
      settings.set(key, Number(input.value));
      bus.emit('ui:settingChanged', { key, value: Number(input.value) });
    });
    return row(labelKey, input, id);
  };

  const toggle = (labelKey: string, key: BooleanKey): HTMLElement => {
    const id = `set_${key}`;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = settings.get()[key];
    input.addEventListener('change', () => {
      settings.set(key, input.checked);
      bus.emit('ui:settingChanged', { key, value: input.checked });
    });
    return row(labelKey, input, id);
  };

  const quality = (): HTMLElement => {
    const id = 'set_qualityTier';
    const select = document.createElement('select');
    select.id = id;
    for (const tier of ['auto', 'low', 'medium', 'high'] as const) {
      const option = document.createElement('option');
      option.value = tier;
      option.textContent = t(`settings.quality.${tier}`);
      select.appendChild(option);
    }
    select.value = settings.get().qualityTier;
    select.addEventListener('change', () => {
      settings.set('qualityTier', select.value as SettingsData['qualityTier']);
      note.hidden = false;
    });
    const wrap = document.createElement('div');
    const note = document.createElement('p');
    note.className = 'lp-hint';
    note.style.margin = '0 0 8px';
    note.textContent = t('settings.quality.note');
    note.hidden = true;
    wrap.append(row('settings.quality', select, id), note);
    return wrap;
  };

  return [
    group(t('settings.audio')),
    slider('settings.master', 'masterVolume'),
    slider('settings.music', 'musicVolume'),
    slider('settings.sfx', 'sfxVolume'),
    slider('settings.ambience', 'ambienceVolume'),

    group(t('settings.controls')),
    slider('settings.sensitivity', 'cameraSensitivity', 0.25, 3, 0.05),
    toggle('settings.invertY', 'invertY'),
    toggle('settings.alwaysRun', 'alwaysRun'),

    group(t('settings.display')),
    quality(),
    toggle('settings.reduceMotion', 'reduceMotion'),
    slider('settings.uiScale', 'uiScale', 0.8, 1.5, 0.05),
  ];
}

/** Settings, applied live. */
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

    const scrim = document.createElement('div');
    scrim.className = 'lp-scrim';
    root.appendChild(scrim);

    const panel = document.createElement('div');
    panel.className = 'lp-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', t('settings.title'));

    const title = document.createElement('h2');
    title.className = 'lp-title';
    title.textContent = t('settings.title');
    panel.append(title, ...settingsControls(this.bus, this.settings));

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
      reset.className = 'lp-btn lp-btn--danger';
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
}
