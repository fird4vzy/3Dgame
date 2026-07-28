import type { EventBus } from '@core/events/EventBus';

export type QualityTier = 'low' | 'medium' | 'high';

const DPR_CAP: Record<QualityTier, number> = { low: 1.0, medium: 1.5, high: 2.0 };

/**
 * Viewport tracking and quality-tier detection.
 *
 * Uses `visualViewport` where available: on mobile the URL bar collapses and
 * expands without firing a useful `window.resize`, which leaves the HUD sitting
 * under browser chrome if you only listen to the latter.
 */
export class Viewport {
  private disposers: Array<() => void> = [];

  readonly tier: QualityTier;

  constructor(
    private readonly bus: EventBus,
    tierOverride?: QualityTier,
  ) {
    this.tier = tierOverride ?? Viewport.detectTier();
  }

  attach(): void {
    const emit = () => this.emitResize();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', emit);
      vv.addEventListener('scroll', emit);
      this.disposers.push(() => {
        vv.removeEventListener('resize', emit);
        vv.removeEventListener('scroll', emit);
      });
    }
    window.addEventListener('resize', emit);
    window.addEventListener('orientationchange', emit);
    this.disposers.push(() => {
      window.removeEventListener('resize', emit);
      window.removeEventListener('orientationchange', emit);
    });

    this.emitResize();
  }

  get width(): number {
    return Math.max(1, Math.floor(window.visualViewport?.width ?? window.innerWidth));
  }

  get height(): number {
    return Math.max(1, Math.floor(window.visualViewport?.height ?? window.innerHeight));
  }

  get dpr(): number {
    return Math.min(window.devicePixelRatio || 1, DPR_CAP[this.tier]);
  }

  get portrait(): boolean {
    return this.height > this.width;
  }

  dispose(): void {
    for (const off of this.disposers) off();
    this.disposers = [];
  }

  private emitResize(): void {
    this.bus.emit('viewport:resized', {
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      portrait: this.portrait,
    });
  }

  /**
   * Heuristic quality tier from device signals. Deliberately conservative —
   * a wrong guess upward costs frame rate, a wrong guess downward costs a
   * little fidelity, and the player can override it in Settings.
   */
  static detectTier(): QualityTier {
    if (typeof navigator === 'undefined') return 'medium';

    const cores = navigator.hardwareConcurrency ?? 4;
    const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;

    if (cores <= 4 || memory <= 2) return 'low';
    if (coarse && (cores <= 6 || memory <= 4)) return 'medium';
    if (cores >= 8 && memory >= 8 && !coarse) return 'high';
    return 'medium';
  }
}
