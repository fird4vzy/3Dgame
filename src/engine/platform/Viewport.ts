import type { EventBus } from '@core/events/EventBus';

export type QualityTier = 'low' | 'medium' | 'high';

const DPR_CAP: Record<QualityTier, number> = { low: 1.0, medium: 1.5, high: 2.0 };
/**
 * The most pixels a frame may have, whatever the screen. A laptop panel at
 * 2880×1800 asks for five megapixels at its native density, and every one of
 * them pays for MSAA, the grass and the post stack; past about 1080p the extra
 * sharpness is hard to see and the frame rate is not. Adaptive resolution
 * (RendererService) scales down from here when even this is too much.
 */
const PIXEL_BUDGET: Record<QualityTier, number> = {
  low: 1280 * 720,
  // Integrated graphics land here: measured on one, 2 Mpx ran at 28 fps and
  // 1.3 Mpx near 40, with every effect still on.
  medium: 1536 * 864,
  high: 2560 * 1440,
};

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
    const cap = Math.min(window.devicePixelRatio || 1, DPR_CAP[this.tier]);
    const budget = Math.sqrt(PIXEL_BUDGET[this.tier] / (this.width * this.height));
    return Math.max(0.5, Math.min(cap, budget));
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

    // A software rasteriser is the floor whatever the CPU count says: a
    // sixteen-core machine running SwiftShader draws a grass field at a
    // frame every few seconds. CI and GPU-less VMs land here too.
    const gpu = Viewport.rendererName();
    if (isSoftwareRenderer(gpu)) return 'low';

    const cores = navigator.hardwareConcurrency ?? 4;
    const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;

    if (cores <= 4 || memory <= 2) return 'low';
    if (coarse && (cores <= 6 || memory <= 4)) return 'medium';
    // Graphics built into the CPU share its memory bandwidth; a big core count
    // beside one says nothing about what it can draw. Medium at most.
    if (isIntegratedGpu(gpu)) return 'medium';
    if (cores >= 8 && memory >= 8 && !coarse) return 'high';
    return 'medium';
  }

  /** The GPU's own name for itself, or '' where the browser will not say. */
  private static rendererName(): string {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return '';
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return name;
    } catch {
      return '';
    }
  }
}

/** Whether a WebGL renderer string names a CPU rasteriser rather than a GPU. */
export function isSoftwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render driver/i.test(name);
}

/**
 * Whether a WebGL renderer string names graphics built into the CPU: Intel's
 * (except the discrete Arc cards), AMD's APUs ("Radeon Graphics" with no
 * model number) and phone GPUs.
 */
export function isIntegratedGpu(name: string): boolean {
  if (/intel/i.test(name) && !/\barc\b/i.test(name)) return true;
  if (/radeon(\(tm\))? graphics|vega \d+ graphics/i.test(name)) return true;
  return /mali|adreno|powervr/i.test(name);
}
