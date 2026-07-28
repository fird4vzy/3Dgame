/**
 * A tiny typed service container.
 *
 * Every subsystem is consumed through an interface and resolved here, which is
 * what lets gameplay systems be unit-tested against fakes with no GPU
 * (docs/04-technical-architecture.md §4.2).
 */

/** A token carries its service type in a phantom field, erased at runtime. */
export interface Token<T> {
  readonly key: symbol;
  readonly name: string;
  readonly __type?: T;
}

export function createToken<T>(name: string): Token<T> {
  return { key: Symbol(name), name };
}

type Factory<T> = (container: ServiceContainer) => T;

export class ServiceContainer {
  private readonly factories = new Map<symbol, Factory<unknown>>();
  private readonly instances = new Map<symbol, unknown>();

  /** Register a lazily-constructed singleton. */
  register<T>(token: Token<T>, factory: Factory<T>): this {
    this.factories.set(token.key, factory as Factory<unknown>);
    return this;
  }

  /** Register an already-constructed value. */
  registerValue<T>(token: Token<T>, value: T): this {
    this.instances.set(token.key, value);
    return this;
  }

  resolve<T>(token: Token<T>): T {
    const existing = this.instances.get(token.key);
    if (existing !== undefined) return existing as T;

    const factory = this.factories.get(token.key);
    if (!factory) throw new Error(`[DI] no registration for "${token.name}"`);

    const instance = factory(this) as T;
    this.instances.set(token.key, instance);
    return instance;
  }

  has(token: Token<unknown>): boolean {
    return this.instances.has(token.key) || this.factories.has(token.key);
  }

  /** Dispose any resolved singleton exposing `dispose()`, then forget it. */
  disposeAll(): void {
    for (const instance of this.instances.values()) {
      const disposable = instance as { dispose?: () => void };
      if (typeof disposable?.dispose === 'function') disposable.dispose();
    }
    this.instances.clear();
    this.factories.clear();
  }
}
