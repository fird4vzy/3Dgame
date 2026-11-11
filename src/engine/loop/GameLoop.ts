import { FIXED_DT, MAX_FRAME_TIME } from '@config/constants';

export interface LoopCallbacks {
  /** Runs at exactly 60 Hz. Simulation only — controller, collision, quests. */
  fixedUpdate(dt: number): void;
  /**
   * Places everything simulated where it should be *drawn* this frame, between
   * the last two fixed steps. `alpha` is 0..1. Runs before `update`, so every
   * per-frame system — animation, lights, the camera — reads the same smooth
   * transforms that are about to be rendered.
   */
  interpolate?(alpha: number): void;
  /** Runs once per frame at display rate. Animation, particles, lerps. */
  update(dt: number): void;
  /** After transforms have settled. Camera follow, UI world anchors. */
  lateUpdate(dt: number): void;
  /** Draw. */
  render(): void;
  /** Roll edge-triggered input state at the very end of the frame. */
  endFrame?(): void;
  /** Poll devices at the very start of the frame. `dt` is the real frame time. */
  beginFrame?(dt: number): void;
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

    this.callbacks.beginFrame?.(frameTime);

    this.accumulator += frameTime;
    let ticked = false;
    while (this.accumulator >= FIXED_DT) {
      this.callbacks.fixedUpdate(FIXED_DT);
      this.accumulator -= FIXED_DT;
      ticked = true;
    }

    // Interpolate first. It used to run after `update`, which meant everything
    // in `update` saw the raw 60 Hz position on frames where a tick ran and
    // last frame's smoothed one on frames where none did.
    this.callbacks.interpolate?.(this.accumulator / FIXED_DT);
    this.callbacks.update(frameTime);
    this.callbacks.lateUpdate(frameTime);
    this.callbacks.render();

    // Only retire one-shot input once a fixed tick has actually had the chance
    // to read it.
    //
    // `endFrame` clears "pressed this frame", and gameplay reads those flags in
    // `fixedUpdate`, which runs at 60 Hz. Above 60 fps most render frames run
    // *no* tick at all — at 150 fps, two in every three — so a press that
    // landed and was cleared inside one of those frames was never seen by
    // anything. A quick tap of interact or jump simply did nothing, and the
    // faster the machine the more often it happened.
    //
    // Below 60 fps every frame runs at least one tick, so this is a no-op
    // there, which is exactly why it went unnoticed: the whole test suite ran
    // on software rendering at 5 fps.
    if (ticked) this.callbacks.endFrame?.();
  };

  private trackFrameTime(dt: number): void {
    this.frameTimes.push(dt);
    this.frameTimeSum += dt;
    if (this.frameTimes.length > 30) {
      this.frameTimeSum -= this.frameTimes.shift() ?? 0;
    }
  }
}
