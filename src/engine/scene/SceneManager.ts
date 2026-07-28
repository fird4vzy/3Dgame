import type { EventBus } from '@core/events/EventBus';
import type { IAssetManager } from '@engine/assets/types';
import type { IScene, SceneParams } from './IScene';

export interface Transition {
  out(): Promise<void>;
  in(): Promise<void>;
}

/** No-op transition, used in tests and when the player disables motion. */
export const INSTANT_TRANSITION: Transition = {
  out: async () => {},
  in: async () => {},
};

/**
 * A scene *stack*, not a list.
 *
 * The stack is what makes overlays possible: Pause and the Route Report sit on
 * top of a still-loaded, still-rendered Planet scene. Only the topmost
 * non-overlay scene simulates; every scene from the deepest non-overlay upward
 * renders.
 */
export class SceneManager {
  private readonly stack: IScene[] = [];
  private busy = false;

  constructor(
    private readonly bus: EventBus,
    private readonly assets: IAssetManager,
    private transition: Transition = INSTANT_TRANSITION,
  ) {}

  setTransition(transition: Transition): void {
    this.transition = transition;
  }

  get current(): IScene | undefined {
    return this.stack[this.stack.length - 1];
  }

  /** The deepest scene that owns simulation — i.e. the last non-overlay one. */
  get simulating(): IScene | undefined {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const scene = this.stack[i];
      if (scene && !scene.overlay) return scene;
    }
    return undefined;
  }

  get depth(): number {
    return this.stack.length;
  }

  /** True while a transition is running; input should be ignored meanwhile. */
  get isTransitioning(): boolean {
    return this.busy;
  }

  async push(scene: IScene, params?: SceneParams): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      // Overlays appear instantly — a wipe on the pause menu would feel awful.
      if (!scene.overlay) await this.transition.out();

      this.bus.emit('scene:willEnter', { id: scene.id });
      await this.load(scene);
      await scene.onEnter(params);
      this.stack.push(scene);
      this.bus.emit('scene:entered', { id: scene.id });

      if (!scene.overlay) await this.transition.in();
    } finally {
      this.busy = false;
    }
  }

  async pop(): Promise<void> {
    if (this.busy || this.stack.length === 0) return;
    this.busy = true;
    try {
      const scene = this.stack[this.stack.length - 1];
      if (!scene) return;

      if (!scene.overlay) await this.transition.out();
      this.bus.emit('scene:willExit', { id: scene.id });
      await scene.onExit?.();
      this.stack.pop();

      scene.dispose?.();
      for (const bundle of scene.assetBundles) this.assets.release(bundle);

      if (!scene.overlay) await this.transition.in();
    } finally {
      this.busy = false;
    }
  }

  /**
   * Replace everything on the stack with one scene.
   *
   * The outgoing scene is disposed only *after* the incoming one is ready. That
   * costs a little peak memory and buys a transition with no blank frame; on a
   * 15 MB game it is the right trade (docs/09-scene-flow.md §9.3).
   */
  async replace(scene: IScene, params?: SceneParams): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.transition.out();

      const outgoing = [...this.stack];
      for (const old of outgoing.reverse()) {
        this.bus.emit('scene:willExit', { id: old.id });
        await old.onExit?.();
      }
      this.stack.length = 0;

      this.bus.emit('scene:willEnter', { id: scene.id });
      await this.load(scene);
      await scene.onEnter(params);
      this.stack.push(scene);

      // Now that the new scene is live, tear the old ones down.
      for (const old of outgoing) {
        old.dispose?.();
        for (const bundle of old.assetBundles) this.assets.release(bundle);
      }

      this.bus.emit('scene:entered', { id: scene.id });
      await this.transition.in();
    } finally {
      this.busy = false;
    }
  }

  fixedUpdate(dt: number): void {
    this.simulating?.fixedUpdate?.(dt);
  }

  update(dt: number): void {
    for (const scene of this.stack) scene.update?.(dt);
  }

  interpolate(alpha: number): void {
    this.simulating?.interpolate?.(alpha);
  }

  lateUpdate(dt: number): void {
    for (const scene of this.stack) scene.lateUpdate?.(dt);
  }

  render(): void {
    // Render from the deepest non-overlay scene upward; anything below it is
    // fully occluded and would be wasted draw calls.
    let start = 0;
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (!this.stack[i]?.overlay) {
        start = i;
        break;
      }
    }
    for (let i = start; i < this.stack.length; i++) this.stack[i]?.render?.();
  }

  private async load(scene: IScene): Promise<void> {
    for (const bundle of scene.assetBundles) {
      await this.assets.acquire(bundle);
    }
    await scene.preload?.(() => {});
  }
}
