import type { EventBus } from '@core/events/EventBus';
import './theme/tokens.css';

export interface UIScreen {
  readonly id: string;
  /** Build the screen's DOM. Called once, when it is pushed. */
  render(): HTMLElement;
  onEnter?(): void;
  onExit?(): void;
  /** Return true if the screen handled Escape itself. */
  onBack?(): boolean;
}

/**
 * DOM-overlay UI with a screen stack.
 *
 * The canvas draws the world; the DOM draws the interface. That buys crisp text
 * at any DPI, real accessibility (focus order, screen readers, reduced motion)
 * and CSS layout for free, at zero draw calls
 * (docs/04-technical-architecture.md §4.1).
 *
 * Screens read a projection of game state and emit intents on the EventBus.
 * They never mutate game state directly.
 */
export class UIManager {
  private readonly root: HTMLElement;
  private readonly stack: Array<{ screen: UIScreen; element: HTMLElement }> = [];
  private readonly hudLayer: HTMLElement;
  private readonly toastLayer: HTMLElement;
  private previousFocus: HTMLElement | null = null;

  constructor(
    container: HTMLElement,
    private readonly bus: EventBus,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'lp-root';
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;';

    this.hudLayer = document.createElement('div');
    this.hudLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';

    this.toastLayer = document.createElement('div');
    this.toastLayer.style.cssText = [
      'position:absolute',
      'top:calc(16px + env(safe-area-inset-top))',
      'right:calc(16px + env(safe-area-inset-right))',
      'display:flex',
      'flex-direction:column',
      'gap:8px',
      'pointer-events:none',
    ].join(';');

    this.root.append(this.hudLayer, this.toastLayer);
    container.appendChild(this.root);

    window.addEventListener('keydown', this.onKeyDown);
  }

  get hud(): HTMLElement {
    return this.hudLayer;
  }

  get depth(): number {
    return this.stack.length;
  }

  get top(): UIScreen | undefined {
    return this.stack[this.stack.length - 1]?.screen;
  }

  push(screen: UIScreen): void {
    // Remember where focus was so popping can restore it — the difference
    // between a menu that is keyboard-usable and one that is not.
    if (this.stack.length === 0) {
      this.previousFocus = document.activeElement as HTMLElement | null;
    }

    const element = screen.render();
    element.classList.add('lp-screen');
    element.dataset.screen = screen.id;
    // Insert below the toast layer so notifications stay on top.
    this.root.insertBefore(element, this.toastLayer);

    this.stack.push({ screen, element });
    screen.onEnter?.();
    this.focusFirst(element);
  }

  pop(): void {
    const entry = this.stack.pop();
    if (!entry) return;

    entry.screen.onExit?.();
    entry.element.remove();

    const next = this.stack[this.stack.length - 1];
    if (next) this.focusFirst(next.element);
    else this.previousFocus?.focus();
  }

  popAll(): void {
    while (this.stack.length > 0) this.pop();
  }

  showToast(message: string, durationMs = 2500): void {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = [
      'padding:10px 14px',
      'border-radius:8px',
      'background:rgba(28,32,50,.92)',
      'border:1px solid var(--lp-rule)',
      'color:var(--lp-ink)',
      'font:500 14px/1.4 var(--lp-font-body)',
      'opacity:0',
      'transform:translateY(-6px)',
      'transition:opacity var(--lp-fast) var(--lp-ease),transform var(--lp-fast) var(--lp-ease)',
    ].join(';');
    this.toastLayer.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 220);
    }, durationMs);
  }

  setHudVisible(visible: boolean): void {
    this.hudLayer.style.display = visible ? '' : 'none';
  }

  setUiScale(scale: number): void {
    document.documentElement.style.setProperty('--lp-ui-scale', String(scale));
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.popAll();
    this.root.remove();
  }

  /** Escape backs out one level, letting the top screen intercept first. */
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    const top = this.stack[this.stack.length - 1];
    if (!top) {
      this.bus.emit('ui:requestPause');
      return;
    }
    event.preventDefault();
    if (top.screen.onBack?.()) return;
    this.pop();
  };

  private focusFirst(element: HTMLElement): void {
    const focusable = element.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }
}
