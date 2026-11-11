import type { EventBus } from '@core/events/EventBus';
import type { UIScreen } from '../UIManager';
import type { Rating } from '../../data/content';

export interface RouteReport {
  seconds: number;
  ratings: Rating[];
  shards: number;
  shardTotal: number;
  districtsLit: number;
  districtTotal: number;
  bestSeconds: number | null;
  rank: string;
  journal: number;
  journalTotal: number;
}

const RATING_LABEL: Record<Rating, string> = {
  bright: 'Bright',
  warm: 'Warm',
  cool: 'Cool',
};

const RATING_COLOUR: Record<Rating, string> = {
  bright: '#ffc45c',
  warm: '#f0a52e',
  cool: '#69a5d8',
};

/**
 * The festival: what the run came to, and an invitation to stay.
 *
 * There is no lose counterpart — the game has no fail state. The ending is
 * not the end either: the fireworks go on behind this card, and whatever is
 * still blank in the journal is still out there.
 */
export class RouteReportScreen implements UIScreen {
  readonly id = 'route-report';

  constructor(
    private readonly bus: EventBus,
    private readonly report: RouteReport,
  ) {}

  render(): HTMLElement {
    const root = document.createElement('div');

    const scrim = document.createElement('div');
    scrim.className = 'lp-scrim';
    // The fireworks are the point; let them through.
    scrim.style.background = 'rgba(247,240,223,.18)';
    scrim.style.backdropFilter = 'none';
    root.appendChild(scrim);

    const panel = document.createElement('div');
    panel.className = 'lp-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'The festival begins');

    const title = document.createElement('h2');
    title.className = 'lp-title';
    title.textContent = 'The festival begins';

    const sub = document.createElement('p');
    sub.className = 'lp-sub';
    sub.textContent = 'Every lantern in Fennwick is lit, and the valley can see the mountain again. You did that on foot.';

    const seals = document.createElement('div');
    seals.className = 'lp-report-seals';
    for (const character of ['灯', '籠', '祭']) {
      const seal = document.createElement('span');
      seal.className = 'lp-seal lp-seal--stamped';
      seal.textContent = character;
      seals.appendChild(seal);
    }

    panel.append(title, sub, seals);
    panel.append(
      this.stat('Standing', this.report.rank),
      this.stat('Route time', formatTime(this.report.seconds)),
      this.stat('Districts lit', `${this.report.districtsLit} / ${this.report.districtTotal}`),
      this.stat('Journal', `${this.report.journal} / ${this.report.journalTotal}`),
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

    const left = this.report.journalTotal - this.report.journal;
    const hint = document.createElement('p');
    hint.className = 'lp-hint';
    hint.textContent =
      left > 0
        ? `${left} page${left === 1 ? '' : 's'} of your journal ${left === 1 ? 'is' : 'are'} still blank. The festival will wait.`
        : 'Your journal is full. There is nothing on this planet you have not seen.';

    const actions = document.createElement('div');
    actions.className = 'lp-actions';
    actions.style.marginTop = 'var(--lp-space-4)';

    const roam = document.createElement('button');
    roam.className = 'lp-btn lp-btn--primary';
    roam.type = 'button';
    roam.textContent = 'Keep exploring';
    roam.addEventListener('click', () => this.bus.emit('ui:requestResume'));

    actions.appendChild(roam);
    panel.append(hint, actions);

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

    const text = document.createElement('span');
    text.className = 'lp-label';
    text.textContent = label;

    const readout = document.createElement('span');
    readout.className = 'lp-value';
    readout.textContent = value;

    row.append(text, readout);
    return row;
  }

  private ratingRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'lp-row';

    const text = document.createElement('span');
    text.className = 'lp-label';
    text.textContent = 'Deliveries';

    const pips = document.createElement('div');
    pips.className = 'lp-pips';

    for (const rating of this.report.ratings) {
      const pip = document.createElement('span');
      pip.className = 'lp-pip';
      pip.title = RATING_LABEL[rating];
      pip.setAttribute('aria-label', RATING_LABEL[rating]);
      pip.style.background = RATING_COLOUR[rating];
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
