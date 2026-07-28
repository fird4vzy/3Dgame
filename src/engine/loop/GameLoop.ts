import { FIXED_DT, MAX_FRAME_TIME } from '@config/constants';

export interface LoopCallbacks {
  /** Runs at exactly 60 Hz. Simulation only — controller, collision, quests. */
  fixedUpdate(dt: number): void;
  /** Runs once per frame at display rate. Animation, particles, lerps. */
  update(dt: number): void;
  /** Smooths render transforms between fixed steps. `alpha` is 0..1. */
  interpolate?(alpha: number): void;
  /** After transforms have settled. Camera follow, UI world anchors. */
  lateUpdate(dt: number): void;
  /** Draw. */
  render(): void;
  /** Roll edge-triggered input state at the very end of the frame. */
  endFrame?(): void;
  /** Poll devices at the very start of the frame. */
  beginFrame?(): void;
}

/**
 * Fixed-timestep simulation with an accumulator, variable-rate rendering.
 *
 * Fixed-step is required for the character controller: without it, collision
 * resolution and jump arcs vary with frame rate, and a 144 Hz monitor plays a
 * different game than a 30 FPS phone (docs/04-technical-architecture.md §4.4).
 */
export class GameLoop {
  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private running = false;

  /** Rolling average frame time, for the dynamic-resolution controller. */
  private readonly frameTimes: number[] = [];
  private frameTimeSum = 0;

  constructor(private readonly callbacks: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Smoothed frames per second over the last ~30 frames. */
  get fps(): number {
    if (this.frameTimes.length === 0) return 0;
    const mean = this.frameTimeSum / this.frameTimes.length;
    return mean > 0 ? 1 / mean : 0;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    // Clamping guards against the spiral of death: a long stall (tab restore,
    // GC pause) must not queue up hundreds of catch-up ticks.
    const frameTime = Math.min((now - this.lastTime) / 1000, MAX_FRAME_TIME);
    this.lastTime = now;
    this.trackFrameTime(frameTime);

    this.callbacks.beginFrame?.();

    this.accumulator += frameTime;
    while (this.accumulator >= FIXED_DT) {
      this.callbacks.fixedUpdate(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }

    this.callbacks.update(frameTime);
    this.callbacks.interpolate?.(this.accumulator / FIXED_DT);
    this.callbacks.lateUpdate(frameTime);
    this.callbacks.render();
    this.callbacks.endFrame?.();
  };

  private trackFrameTime(dt: number): void {
    this.frameTimes.push(dt);
    this.frameTimeSum += dt;
    if (this.frameTimes.length > 30) {
      this.frameTimeSum -= this.frameTimes.shift() ?? 0;
    }
  }
}
