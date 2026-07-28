export type Unsubscribe = () => void;

/**
 * Minimal reactive store with selector-based subscriptions.
 *
 * The UI reads game state through this and never mutates it; intents travel
 * back over the EventBus (docs/10-ui-flow.md §10.3).
 */
export class Store<T extends object> {
  private state: T;
  private readonly subscribers = new Set<() => void>();

  constructor(initial: T) {
    this.state = initial;
  }

  get(): Readonly<T> {
    return this.state;
  }

  /** Shallow-merge a patch. Notifies only if something actually changed. */
  set(patch: Partial<T>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof T)[]) {
      const next = patch[key];
      if (next !== undefined && !Object.is(this.state[key], next)) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    this.state = { ...this.state, ...patch };
    for (const notify of [...this.subscribers]) notify();
  }

  /**
   * Subscribe to a derived slice. The callback fires only when the selected
   * value changes by `Object.is`, so a store-wide write does not wake every
   * consumer.
   */
  subscribe<S>(selector: (state: Readonly<T>) => S, callback: (value: S) => void): Unsubscribe {
    let previous = selector(this.state);
    const notify = () => {
      const next = selector(this.state);
      if (Object.is(next, previous)) return;
      previous = next;
      callback(next);
    };
    this.subscribers.add(notify);
    return () => this.subscribers.delete(notify);
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}
