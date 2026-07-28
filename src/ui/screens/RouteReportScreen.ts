import type { EventBus } from '@core/events/EventBus';
import type { UIScreen } from '../UIManager';
import type { Rating } from '../../data/content';

export interface RouteReport {
  seconds: number;
  ratings: Rating[];
  shards: number;
  shardTotal: number;
  districtsLit: number;
  bestSeconds: number | null;
}

const RATING_LABEL: Record<Rating, string> = {
  bright: 'Bright',
  warm: 'Warm',
  cool: 'Cool',
};

const RATING_COLOUR: Record<Rating, string> = {
  bright: '#f6bd60',
  warm: '#e8a33a',
  cool: '#69a5d8',
};

/**
 * The win screen: what you did, and an invitation to go back.
 *
 * There is no lose counterpart in v1 — the main game has no fail state (GDD
 * §2.6). The component is built to be reusable for Storm Run's ending, which is
 * the only mode that can end badly.
 */
export class RouteReportScreen implements UIScreen {
  readonly id = 'route-report';

  constructor(
    private readonly bus: EventBus,
    private readonly report: RouteReport,
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
    panel.setAttribute('aria-label', 'Route report');

    const title = document.createElement('h2');
    title.className = 'lp-title';
    title.textContent = 'The planet is lit';

    const sub = document.createElement('p');
    sub.className = 'lp-sub';
    sub.textContent = 'Every lumen delivered. Fennwick is awake.';

    panel.append(title, sub);
    panel.append(
      this.stat('Route time', formatTime(this.report.seconds)),
      this.stat('Districts lit', `${this.report.districtsLit} / 5`),
      this.stat('Lumen shards', `${this.report.shards} / ${this.report.shardTotal}`),
    );

    if (this.report.bestSeconds !== null) {
      const delta = this.report.seconds - this.report.bestSeconds;
      panel.append(
        this.stat(
          'Personal best',
          delta < 0
            ? `${formatTime(this.report.seconds)} — new best`
            : `${formatTime(this.report.bestSeconds)} (+${formatTime(delta)})`,
        ),
      );
    }

    panel.append(this.ratingRow());

    const actions = document.createElement('div');
    actions.className = 'lp-actions';
    actions.style.marginTop = 'var(--lp-space-5)';

    const roam = document.createElement('button');
    roam.className = 'lp-btn lp-btn--primary';
    roam.type = 'button';
    roam.textContent = 'Keep exploring';
    roam.addEventListener('click', () => this.bus.emit('ui:requestResume'));

    actions.appendChild(roam);
    panel.appendChild(actions);

    root.appendChild(panel);
    return root;
  }

  onBack(): boolean {
    this.bus.emit('ui:requestResume');
    return true;
  }

  private stat(label: string, value: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'lp-row';

    const text = document.createElement('label');
    text.textContent = label;

    const readout = document.createElement('span');
    readout.textContent = value;
    readout.style.cssText =
      'font-variant-numeric:tabular-nums;font-weight:600;color:var(--lp-ink)';

    row.append(text, readout);
    return row;
  }

  private ratingRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'lp-row';
    row.style.alignItems = 'center';

    const text = document.createElement('label');
    text.textContent = 'Deliveries';

    const pips = document.createElement('div');
    pips.style.cssText = 'display:flex;gap:6px';

    for (const rating of this.report.ratings) {
      const pip = document.createElement('span');
      pip.title = RATING_LABEL[rating];
      pip.setAttribute('aria-label', RATING_LABEL[rating]);
      pip.style.cssText = [
        'width:14px;height:14px;border-radius:50%',
        `background:${RATING_COLOUR[rating]}`,
        `box-shadow:0 0 10px ${RATING_COLOUR[rating]}`,
      ].join(';');
      pips.appendChild(pip);
    }

    row.append(text, pips);
    return row;
  }
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
