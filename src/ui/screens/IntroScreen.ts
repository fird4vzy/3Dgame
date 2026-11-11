import type { UIScreen } from '../UIManager';

/**
 * The opening: three panels and one instruction.
 *
 * A new player needs to know three things before they can enjoy the first
 * minute — where they are, what has gone wrong, and what they personally are
 * supposed to do about it — and a page of manga says that faster than a
 * paragraph does. It is shown once per run and can be passed with one key.
 */
const PANELS: Array<{ caption: string; art: string }> = [
  {
    caption: 'Festival morning in Fennwick, a valley on a world you can walk round before lunch.',
    // The mountain over the valley.
    art: `<svg viewBox="0 0 200 260" preserveAspectRatio="xMidYMid slice" width="100%" height="100%"><path d="M-10 150 L70 60 L84 60 L100 74 L210 150 Z" fill="#5b6f9e" stroke="#221c2b" stroke-width="3"/><path d="M52 80 L70 60 L84 60 L100 74 L92 82 L84 72 L78 84 L70 74 L62 86 Z" fill="#f7f0df" stroke="#221c2b" stroke-width="2.5"/><circle cx="158" cy="46" r="15" fill="#f7f0df" stroke="#221c2b" stroke-width="3"/></svg>`,
  },
  {
    caption: 'But every lantern is dark. The lumen that lights them never arrived.',
    art: `<svg viewBox="0 0 200 260" preserveAspectRatio="xMidYMid slice" width="100%" height="100%"><g stroke="#f7f0df" stroke-width="3" fill="none"><path d="M100 30 V70"/><rect x="74" y="70" width="52" height="70" rx="8" fill="#2c3b6b"/><path d="M74 88 H126 M74 122 H126"/><path d="M100 140 V160"/></g><g fill="#f7f0df" opacity=".5"><circle cx="40" cy="60" r="2"/><circle cx="160" cy="110" r="2"/><circle cx="30" cy="150" r="2"/><circle cx="170" cy="40" r="2"/></g></svg>`,
  },
  {
    caption: 'You are the new courier. Five parcels of light, five districts — and a festival to save by dusk.',
    art: `<svg viewBox="0 0 200 260" preserveAspectRatio="xMidYMid slice" width="100%" height="100%"><circle cx="100" cy="92" r="34" fill="#ffd27a" stroke="#221c2b" stroke-width="3"/><g stroke="#221c2b" stroke-width="3"><path d="M100 36 V20 M100 148 V164 M44 92 H28 M156 92 H172 M60 52 L48 40 M140 52 L152 40 M60 132 L48 144 M140 132 L152 144"/></g></svg>`,
  },
];

export class IntroScreen implements UIScreen {
  readonly id = 'intro';

  constructor(private readonly onDone: () => void) {}

  render(): HTMLElement {
    const root = document.createElement('div');
    root.classList.add('lp-intro');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'How the story begins');

    const page = document.createElement('div');
    page.className = 'lp-intro-page';
    PANELS.forEach((panel, index) => {
      const frame = document.createElement('div');
      frame.className = 'lp-intro-panel';
      const art = document.createElement('div');
      art.className = 'lp-intro-art';
      art.setAttribute('aria-hidden', 'true');
      art.innerHTML = panel.art;
      const number = document.createElement('div');
      number.className = 'lp-intro-no';
      number.textContent = String(index + 1);
      const caption = document.createElement('div');
      caption.className = 'lp-intro-caption';
      caption.textContent = panel.caption;
      frame.append(art, number, caption);
      page.append(frame);
    });

    const foot = document.createElement('div');
    foot.className = 'lp-intro-foot';
    const hint = document.createElement('p');
    hint.className = 'lp-hint';
    hint.style.margin = '0';
    hint.style.maxWidth = '46ch';
    hint.textContent =
      'First: talk to Postmaster Odd, right in front of you. Your journal (Tab) keeps track of everything else worth finding.';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'lp-btn lp-btn--primary';
    go.textContent = 'Step off the boat';
    go.addEventListener('click', this.onDone);
    foot.append(hint, go);

    root.append(page, foot);
    return root;
  }

  onBack(): boolean {
    this.onDone();
    return true;
  }
}
