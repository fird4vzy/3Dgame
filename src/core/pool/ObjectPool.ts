export interface Poolable {
  /** Called when the object is handed out. */
  reset?(): void;
}

/**
 * Fixed-behaviour object pool.
 *
 * Used for particles, emotes, floating text, decals and audio voices — the
 * high-count things that bypass the entity model entirely so hot paths never
 * allocate (docs/04-technical-architecture.md §4.3).
 */
export class ObjectPool<T extends Poolable> {
  private readonly free: T[] = [];
  private readonly active = new Set<T>();

  constructor(
    private readonly factory: () => T,
    prewarm = 0,
    private readonly maxSize = Infinity,
  ) {
    for (let i = 0; i < prewarm; i++) this.free.push(factory());
  }

  acquire(): T {
    const item = this.free.pop() ?? this.factory();
    item.reset?.();
    this.active.add(item);
    return item;
  }

  release(item: T): void {
    if (!this.active.delete(item)) return; // ignore double-release
    if (this.free.length < this.maxSize) this.free.push(item);
  }

  releaseAll(): void {
    for (const item of [...this.active]) this.release(item);
  }

  get activeCount(): number {
    return this.active.size;
  }

  get freeCount(): number {
    return this.free.length;
  }

  forEachActive(fn: (item: T) => void): void {
    for (const item of this.active) fn(item);
  }
}
