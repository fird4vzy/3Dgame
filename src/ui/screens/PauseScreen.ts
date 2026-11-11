import type { EventBus } from '@core/events/EventBus';
import type { SettingsManager } from '@engine/settings/SettingsManager';
import { t } from '@engine/i18n/Localization';
import type { UIScreen } from '../UIManager';
import { settingsControls } from './SettingsScreen';

export interface PauseStats {
  elapsedSeconds: number;
  delivered: number;
  deliveries: number;
  shards: number;
  shardTotal: number;
  journal: number;
  journalTotal: number;
  rank: string;
}

/**
 * Pause overlay with the settings inline.
 *
 * An overlay, not a scene replacement — the frozen world stays visible and
 * loaded behind the paper. The line under the title is the run as it stands;
 * it used to read "0/5 delivered · 0/24 shards" whatever had happened, because
 * nothing ever told it otherwise.
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

    const scrim = document.createElement('div');
    scrim.className = 'lp-scrim';
    root.appendChild(scrim);

    const panel = document.createElement('div');
    panel.className = 'lp-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', t('pause.title'));

    const stats = this.getStats();
    const minutes = Math.floor(stats.elapsedSeconds / 60);
    const seconds = Math.floor(stats.elapsedSeconds % 60);

    const title = document.createElement('h2');
    title.className = 'lp-title';
    title.textContent = t('pause.title');

    const sub = document.createElement('p');
    sub.className = 'lp-sub';
    sub.textContent = t('pause.stats', {
      rank: stats.rank,
      time: `${minutes}:${String(seconds).padStart(2, '0')}`,
      delivered: stats.delivered,
      deliveries: stats.deliveries,
      shards: stats.shards,
      shardTotal: stats.shardTotal,
      journal: stats.journal,
      journalTotal: stats.journalTotal,
    });

    const top = document.createElement('div');
    top.className = 'lp-actions';
    top.append(
      this.button(t('pause.resume'), () => this.bus.emit('ui:requestResume'), true),
      this.button(t('pause.journal'), () => this.bus.emit('ui:requestJournal')),
    );

    const bottom = document.createElement('div');
    bottom.className = 'lp-actions';
    bottom.style.marginTop = 'var(--lp-space-4)';
    bottom.append(this.button(t('pause.quit'), () => this.bus.emit('ui:requestQuit')));

    const hint = document.createElement('p');
    hint.className = 'lp-hint';
    hint.textContent = t('pause.hint');

    panel.append(title, sub, top, ...settingsControls(this.bus, this.settings), bottom, hint);
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
}
