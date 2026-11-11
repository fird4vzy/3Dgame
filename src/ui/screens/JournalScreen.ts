import type { UIScreen } from '../UIManager';

export interface JournalEntry {
  title: string;
  /** Shown once found; the hint is shown until then. */
  note: string;
  hint: string;
  found: boolean;
  /** A stamp's character. */
  seal?: string;
  /** A postcard's picture, as a data URL. */
  image?: string | null;
}

export interface JournalStep {
  title: string;
  detail: string;
  state: 'done' | 'now' | 'later';
  /** A word on the right: a rating, or "Now". */
  tag?: string;
}

export interface JournalView {
  rank: string;
  points: number;
  total: number;
  /** What the next standing is and how far off, or null at the top. */
  next: { title: string; need: number; reward: string | null } | null;
  story: JournalStep[];
  stamps: JournalEntry[];
  souvenirs: JournalEntry[];
  postcards: JournalEntry[];
  /** Timed rounds and other things that are neither found nor photographed. */
  feats: JournalEntry[];
}

type Tab = 'story' | 'stamps' | 'souvenirs' | 'postcards' | 'feats';

function el(tag: string, className = '', text?: string): HTMLElement {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/**
 * The courier's journal: the stamp book, opened.
 *
 * One place for everything the player might ask about their own progress —
 * what the story wants next, what has been found, and what the blank spaces
 * are waiting for. A blank is never just a blank: it carries a hint, because
 * a list of question marks is a list of chores.
 */
export class JournalScreen implements UIScreen {
  readonly id = 'journal';
  private tab: Tab = 'story';
  private body!: HTMLElement;
  private readonly tabs = new Map<Tab, HTMLElement>();

  constructor(
    private readonly view: JournalView,
    private readonly onClose: () => void,
  ) {}

  render(): HTMLElement {
    const root = el('div');
    root.append(el('div', 'lp-scrim'));

    const panel = el('div', 'lp-panel lp-journal');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Journal');

    const head = el('div', 'lp-journal-head');
    head.append(el('h2', 'lp-title', 'Courier’s Journal'));
    const rank = el('div', 'lp-journal-rank');
    rank.append(el('b', '', this.view.rank));
    rank.append(
      document.createTextNode(
        this.view.next
          ? `${this.view.points} of ${this.view.total} · ${this.view.next.need} more to ${this.view.next.title}`
          : `${this.view.points} of ${this.view.total} · every page full`,
      ),
    );
    head.append(rank);

    const tablist = el('div', 'lp-tabs');
    tablist.setAttribute('role', 'tablist');
    const count = (entries: JournalEntry[]): string => `${entries.filter((e) => e.found).length}/${entries.length}`;
    const defs: Array<[Tab, string, string]> = [
      ['story', 'Deliveries', `${this.view.story.filter((s) => s.state === 'done').length}/${this.view.story.length}`],
      ['stamps', 'Stamps', count(this.view.stamps)],
      ['souvenirs', 'Keepsakes', count(this.view.souvenirs)],
      ['postcards', 'Postcards', count(this.view.postcards)],
      ['feats', 'Feats', count(this.view.feats)],
    ];
    for (const [id, label, tally] of defs) {
      const tab = el('button', 'lp-tab');
      (tab as HTMLButtonElement).type = 'button';
      tab.setAttribute('role', 'tab');
      tab.append(document.createTextNode(label), el('small', '', tally));
      tab.addEventListener('click', () => this.show(id));
      this.tabs.set(id, tab);
      tablist.append(tab);
    }

    this.body = el('div', 'lp-journal-body');
    this.body.setAttribute('role', 'tabpanel');

    const foot = el('div', 'lp-journal-foot');
    const hint = el('span', 'lp-hint', 'Tab or Esc to close');
    hint.style.margin = '0';
    const close = el('button', 'lp-btn lp-btn--primary', 'Close');
    (close as HTMLButtonElement).type = 'button';
    close.addEventListener('click', this.onClose);
    foot.append(hint, close);

    panel.append(head, tablist, this.body, foot);
    root.append(panel);
    this.show(this.tab);
    return root;
  }

  onEnter(): void {
    window.addEventListener('keydown', this.onKey);
  }

  onExit(): void {
    window.removeEventListener('keydown', this.onKey);
  }

  onBack(): boolean {
    this.onClose();
    return true;
  }

  /** Tab closes the book it opened; the arrows turn its pages. */
  private onKey = (event: KeyboardEvent): void => {
    if (event.code === 'Tab' || event.code === 'KeyJ') {
      event.preventDefault();
      this.onClose();
      return;
    }
    const order: Tab[] = ['story', 'stamps', 'souvenirs', 'postcards', 'feats'];
    const step = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    this.show(order[(order.indexOf(this.tab) + step + order.length) % order.length]!);
  };

  private show(tab: Tab): void {
    this.tab = tab;
    for (const [id, element] of this.tabs) element.setAttribute('aria-selected', String(id === tab));
    this.body.replaceChildren(tab === 'story' ? this.story() : this.grid(this.view[tab], tab));
    this.body.scrollTop = 0;
  }

  private story(): HTMLElement {
    const list = el('ol', 'lp-steps');
    for (const step of this.view.story) {
      const item = el('li', 'lp-step');
      item.dataset.state = step.state;
      const text = el('div');
      text.append(el('b', '', step.title), el('span', '', step.detail));
      item.append(text, el('em', '', step.tag ?? ''));
      list.append(item);
    }
    return list;
  }

  private grid(entries: JournalEntry[], tab: Tab): HTMLElement {
    const grid = el('div', 'lp-grid');
    for (const entry of entries) {
      const card = el('div', 'lp-card');
      card.dataset.missing = String(!entry.found);

      if (tab === 'postcards') {
        if (entry.found && entry.image) {
          const picture = document.createElement('img');
          picture.className = 'lp-card-photo';
          picture.src = entry.image;
          picture.alt = entry.title;
          card.append(picture);
        } else {
          card.append(el('div', 'lp-card-photo'));
        }
      }
      if (entry.seal !== undefined) {
        const seal = el('span', `lp-seal${entry.found ? '' : ' lp-seal--blank'}`, entry.found ? entry.seal : '?');
        card.append(seal);
      }
      card.append(
        el('div', 'lp-card-title', entry.found || tab !== 'souvenirs' ? entry.title : '— — —'),
        el('div', 'lp-card-note', entry.found ? entry.note : entry.hint),
      );
      grid.append(card);
    }
    return grid;
  }
}
