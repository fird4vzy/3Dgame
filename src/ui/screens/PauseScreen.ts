import type { EventBus } from '@core/events/EventBus';
import type { SettingsManager } from '@engine/settings/SettingsManager';
import type { UIScreen } from '../UIManager';

interface PauseStats {
  elapsedSeconds: number;
  contractsComplete: number;
  shards: number;
}

/**
 * Pause overlay with inline settings.
 *
 * An overlay, not a scene replacement — the frozen world stays visible and
 * loaded behind the blur, which is why the scene manager is a stack.
 */
export class PauseScreen implements UIScreen {
  readonly id = 'pause';

  constructor(
    private readonly bus: EventBus,
    private readonly settings: SettingsManager,
    private readonly getStats: () => PauseStats,
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
    panel.setAttribute('aria-label', 'Paused');

    const stats = this.getStats();
    const minutes = Math.floor(stats.elapsedSeconds / 60);
    const seconds = Math.floor(stats.elapsedSeconds % 60);

    const title = document.createElement('h2');
    title.className = 'lp-title';
    title.textContent = 'Paused';

    const sub = document.createElement('p');
    sub.className = 'lp-sub';
    sub.textContent =
      `${minutes}:${String(seconds).padStart(2, '0')} · ` +
      `${stats.contractsComplete}/5 delivered · ${stats.shards}/24 shards`;

    const actions = document.createElement('div');
    actions.className = 'lp-actions';
    actions.append(
      this.button('Resume', () => this.bus.emit('ui:requestResume'), true),
      this.slider('Master volume', this.settings.get().masterVolume, (v) =>
        this.settings.set('masterVolume', v),
      ),
      this.slider('Music', this.settings.get().musicVolume, (v) =>
        this.settings.set('musicVolume', v),
      ),
      this.slider('Sound effects', this.settings.get().sfxVolume, (v) =>
        this.settings.set('sfxVolume', v),
      ),
      this.toggle('Reduce motion', this.settings.get().reduceMotion, (v) =>
        this.settings.set('reduceMotion', v),
      ),
      this.button('Quit to menu', () => this.bus.emit('ui:requestQuit')),
    );

    const hint = document.createElement('p');
    hint.className = 'lp-hint';
    hint.textContent = 'Esc or Start to resume · WASD move · Shift run · Space jump';

    panel.append(title, sub, actions, hint);
    root.appendChild(panel);
    return root;
  }

  /** Escape resumes rather than merely closing the screen. */
  onBack(): boolean {
    this.bus.emit('ui:requestResume');
    return true;
  }

  private button(label: string, onClick: () => void, primary = false): HTMLElement {
    const button = document.createElement('button');
    button.className = `lp-btn${primary ? ' lp-btn--primary' : ''}`;
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private slider(
    label: string,
    value: number,
    onInput: (value: number) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'lp-row';

    const id = `set_${label.replace(/\s+/g, '_').toLowerCase()}`;
    const text = document.createElement('label');
    text.textContent = label;
    text.htmlFor = id;

    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = '0';
    input.max = '1';
    input.step = '0.05';
    input.value = String(value);
    input.addEventListener('input', () => onInput(Number(input.value)));

    row.append(text, input);
    return row;
  }

  private toggle(
    label: string,
    value: boolean,
    onChange: (value: boolean) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'lp-row';

    const id = `set_${label.replace(/\s+/g, '_').toLowerCase()}`;
    const text = document.createElement('label');
    text.textContent = label;
    text.htmlFor = id;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = value;
    input.style.accentColor = 'var(--lp-lumen)';
    input.style.width = '20px';
    input.style.height = '20px';
    input.addEventListener('change', () => onChange(input.checked));

    row.append(text, input);
    return row;
  }
}
