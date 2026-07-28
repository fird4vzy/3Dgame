export interface SceneParams {
  [key: string]: unknown;
}

/**
 * Scene lifecycle contract (docs/09-scene-flow.md §9.3).
 *
 * `overlay: true` means the scene is pushed *over* whatever is below without
 * unloading it — this is what lets Pause render the frozen world behind its
 * menu instead of tearing it down and rebuilding it.
 */
export interface IScene {
  readonly id: string;
  readonly assetBundles: readonly string[];
  readonly overlay?: boolean;

  preload?(onProgress: (fraction: number) => void): Promise<void>;
  onEnter(params?: SceneParams): Promise<void> | void;

  fixedUpdate?(dt: number): void;
  update?(dt: number): void;
  interpolate?(alpha: number): void;
  lateUpdate?(dt: number): void;
  render?(): void;

  onExit?(): Promise<void> | void;
  dispose?(): void;
}
