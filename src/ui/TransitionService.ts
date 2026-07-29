export interface TransitionOptions {
  durationMs?: number;
  colour?: string;
}

/**
 * The lumen iris wipe.
 *
 * A DOM overlay, not a shader pass. Three reasons, and the third is the one
 * that decides it: it costs nothing on the GPU; it covers the whole frame
 * *including* HUD and menus, which a WebGL wipe would leave hanging on top; and
 * it keeps working when the render loop stalls mid-load — which is exactly when
 * a transition is on screen.
 *
 * `prefers-reduced-motion` collapses it to a cross-fade. A large shrinking
 * circle is precisely the full-field motion that setting exists for, so this is
 * not a token gesture.
 */
export class TransitionService {
  private readonly overlay: HTMLElement;
  private reduceMotion = false;

  constructor(parent: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.dataset.role = 'transition';
    this.overlay.style.cssText = [
      'position:absolute',
      'inset:0',
      'pointer-events:none',
      'z-index:40',
      'background:#141724',
      'opacity:0',
      // Fully open: the circle is larger than the viewport diagonal.
      'clip-path:circle(150% at 50% 50%)',
    ].join(';');
    parent.appendChild(this.overlay);
  }

  setReduceMotion(reduce: boolean): void {
    this.reduceMotion = reduce;
  }

  /** Close the iris. Resolves when the screen is covered. */
  async out(options: TransitionOptions = {}): Promise<void> {
    const duration = options.durationMs ?? 420;
    this.overlay.style.background = options.colour ?? '#141724';
    this.overlay.style.pointerEvents = 'auto';

    if (this.reduceMotion) {
      await this.animate({ opacity: ['0', '1'] }, duration);
      this.overlay.style.opacity = '1';
      return;
    }

    this.overlay.style.opacity = '1';
    await this.animate(
      { clipPath: ['circle(150% at 50% 50%)', 'circle(0% at 50% 50%)'] },
      duration,
    );
    this.overlay.style.clipPath = 'circle(0% at 50% 50%)';
  }

  /** Open the iris. Resolves when the screen is clear. */
  async in(options: TransitionOptions = {}): Promise<void> {
    const duration = options.durationMs ?? 520;

    if (this.reduceMotion) {
      await this.animate({ opacity: ['1', '0'] }, duration);
    } else {
      await this.animate(
        { clipPath: ['circle(0% at 50% 50%)', 'circle(150% at 50% 50%)'] },
        duration,
      );
      this.overlay.style.clipPath = 'circle(150% at 50% 50%)';
    }

    this.overlay.style.opacity = '0';
    this.overlay.style.pointerEvents = 'none';
  }

  /** Close, run `work`, then open. The common case. */
  async wrap(work: () => void | Promise<void>, options: TransitionOptions = {}): Promise<void> {
    await this.out(options);
    await work();
    await this.in(options);
  }

  dispose(): void {
    this.overlay.remove();
  }

  /**
   * Run a keyframe set and resolve when it finishes.
   *
   * Falls back to a timeout if the animation is cancelled or unsupported — a
   * transition that never resolves deadlocks the caller mid-load, which is far
   * worse than an unanimated cut.
   */
  private animate(keyframes: Record<string, string[]>, duration: number): Promise<void> {
    if (typeof this.overlay.animate !== 'function') {
      return new Promise((resolve) => setTimeout(resolve, duration));
    }

    const animation = this.overlay.animate(keyframes as unknown as Keyframe[], {
      duration,
      easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
      fill: 'forwards',
    });

    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      animation.addEventListener('finish', done);
      animation.addEventListener('cancel', done);
      setTimeout(done, duration + 120);
    });
  }
}
