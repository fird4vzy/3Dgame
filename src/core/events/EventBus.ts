import type { EventMap } from './EventMap';

export type Unsubscribe = () => void;

type Handler<K extends keyof EventMap> = (payload: EventMap[K]) => void;

/**
 * Typed publish/subscribe bus.
 *
 * Systems coordinate through this rather than holding references to each other,
 * which is what keeps the dependency graph acyclic (docs/12-event-flow.md).
 *
 * Handlers must not emit synchronously into the event they are handling; in dev
 * builds that re-entrancy is caught and reported rather than silently recursing.
 */
export class EventBus {
  private readonly handlers = new Map<keyof EventMap, Set<Handler<never>>>();
  private readonly emitting = new Set<keyof EventMap>();

  on<K extends keyof EventMap>(event: K, handler: Handler<K>): Unsubscribe {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  once<K extends keyof EventMap>(event: K, handler: Handler<K>): Unsubscribe {
    const wrapped: Handler<K> = (payload) => {
      off();
      handler(payload);
    };
    const off = this.on(event, wrapped);
    return off;
  }

  off<K extends keyof EventMap>(event: K, handler: Handler<K>): void {
    this.handlers.get(event)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof EventMap>(
    event: K,
    ...args: EventMap[K] extends void ? [] : [EventMap[K]]
  ): void {
    const payload = args[0] as EventMap[K];

    if (import.meta.env?.DEV && this.emitting.has(event)) {
      console.warn(`[EventBus] re-entrant emit of "${String(event)}" — check your handlers.`);
    }

    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;

    this.emitting.add(event);
    // Copy so a handler that unsubscribes during dispatch cannot corrupt iteration.
    for (const handler of [...set]) {
      try {
        (handler as Handler<K>)(payload);
      } catch (error) {
        console.error(`[EventBus] handler for "${String(event)}" threw:`, error);
      }
    }
    this.emitting.delete(event);
  }

  /** Number of live subscribers, for tests and leak checks. */
  listenerCount<K extends keyof EventMap>(event: K): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
    this.emitting.clear();
  }
}
