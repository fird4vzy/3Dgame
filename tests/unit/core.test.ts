import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/core/events/EventBus';
import { Store } from '../../src/core/state/Store';
import { StateMachine, type Transition } from '../../src/core/fsm/StateMachine';
import { ObjectPool } from '../../src/core/pool/ObjectPool';
import { ServiceContainer, createToken } from '../../src/core/di/ServiceContainer';
import { makeRng, fbm3 } from '../../src/core/math/rng';

describe('EventBus', () => {
  it('delivers typed payloads and unsubscribes', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const off = bus.on('scene:entered', (p) => seen.push(p.id));

    bus.emit('scene:entered', { id: 'planet' });
    off();
    bus.emit('scene:entered', { id: 'menu' });

    expect(seen).toEqual(['planet']);
    expect(bus.listenerCount('scene:entered')).toBe(0);
  });

  it('fires once handlers exactly once', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.once('player:jumped', handler);
    bus.emit('player:jumped');
    bus.emit('player:jumped');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('keeps dispatching when one handler throws', () => {
    const bus = new EventBus();
    const second = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.on('player:jumped', () => {
      throw new Error('boom');
    });
    bus.on('player:jumped', second);
    bus.emit('player:jumped');
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('survives a handler unsubscribing during dispatch', () => {
    const bus = new EventBus();
    const b = vi.fn();
    const offA = bus.on('player:jumped', () => offA());
    bus.on('player:jumped', b);
    expect(() => bus.emit('player:jumped')).not.toThrow();
    expect(b).toHaveBeenCalled();
  });
});

describe('Store', () => {
  it('notifies only when the selected slice changes', () => {
    const store = new Store({ lit: 0, name: 'fennwick' });
    const onLit = vi.fn();
    store.subscribe((s) => s.lit, onLit);

    store.set({ name: 'other' });
    expect(onLit).not.toHaveBeenCalled();

    store.set({ lit: 1 });
    expect(onLit).toHaveBeenCalledWith(1);
  });

  it('ignores no-op writes', () => {
    const store = new Store({ lit: 3 });
    const onLit = vi.fn();
    store.subscribe((s) => s.lit, onLit);
    store.set({ lit: 3 });
    expect(onLit).not.toHaveBeenCalled();
  });

  it('unsubscribes cleanly', () => {
    const store = new Store({ lit: 0 });
    const off = store.subscribe((s) => s.lit, vi.fn());
    expect(store.subscriberCount).toBe(1);
    off();
    expect(store.subscriberCount).toBe(0);
  });
});

describe('StateMachine', () => {
  type S = 'idle' | 'walking' | 'falling';
  type E = 'move' | 'stop' | 'fall';
  const ctx = { canMove: true };

  const table: Transition<S, E, typeof ctx>[] = [
    { from: 'idle', event: 'move', to: 'walking', guard: (c) => c.canMove },
    { from: 'walking', event: 'stop', to: 'idle' },
    { from: ['idle', 'walking'], event: 'fall', to: 'falling' },
  ];

  it('follows legal transitions and reports them', () => {
    const fsm = new StateMachine<S, E, typeof ctx>('idle', ctx, table);
    const seen: string[] = [];
    fsm.onTransition((from, to, event) => seen.push(`${from}->${to}:${event}`));

    expect(fsm.send('move')).toBe(true);
    expect(fsm.current).toBe('walking');
    expect(seen).toEqual(['idle->walking:move']);
  });

  it('refuses illegal transitions without throwing', () => {
    const fsm = new StateMachine<S, E, typeof ctx>('idle', ctx, table);
    expect(fsm.send('stop')).toBe(false);
    expect(fsm.current).toBe('idle');
  });

  it('respects guards', () => {
    const blocked = { canMove: false };
    const fsm = new StateMachine<S, E, typeof blocked>('idle', blocked, table);
    expect(fsm.can('move')).toBe(false);
    expect(fsm.send('move')).toBe(false);
  });

  it('matches multi-source transitions', () => {
    const fsm = new StateMachine<S, E, typeof ctx>('walking', ctx, table);
    expect(fsm.send('fall')).toBe(true);
    expect(fsm.current).toBe('falling');
  });

  it('runs exit and enter hooks in order', () => {
    const order: string[] = [];
    const fsm = new StateMachine<S, E, typeof ctx>('idle', ctx, [
      {
        from: 'idle',
        event: 'move',
        to: 'walking',
        onExit: () => order.push('exit'),
        onEnter: () => order.push('enter'),
      },
    ]);
    fsm.send('move');
    expect(order).toEqual(['exit', 'enter']);
  });
});

describe('ObjectPool', () => {
  it('reuses released objects instead of allocating', () => {
    let created = 0;
    const pool = new ObjectPool(() => ({ created: created++, reset: () => {} }));

    const a = pool.acquire();
    pool.release(a);
    const b = pool.acquire();

    expect(b).toBe(a);
    expect(created).toBe(1);
    expect(pool.activeCount).toBe(1);
  });

  it('prewarms without handing objects out', () => {
    const pool = new ObjectPool(() => ({ reset: () => {} }), 5);
    expect(pool.freeCount).toBe(5);
    expect(pool.activeCount).toBe(0);
  });

  it('ignores a double release', () => {
    const pool = new ObjectPool(() => ({ reset: () => {} }));
    const item = pool.acquire();
    pool.release(item);
    pool.release(item);
    expect(pool.freeCount).toBe(1);
  });

  it('calls reset on acquire', () => {
    const reset = vi.fn();
    const pool = new ObjectPool(() => ({ reset }));
    pool.release(pool.acquire());
    pool.acquire();
    expect(reset).toHaveBeenCalledTimes(2);
  });
});

describe('ServiceContainer', () => {
  it('resolves lazily and caches the singleton', () => {
    const token = createToken<{ n: number }>('thing');
    const factory = vi.fn(() => ({ n: 1 }));
    const container = new ServiceContainer().register(token, factory);

    expect(factory).not.toHaveBeenCalled();
    const first = container.resolve(token);
    expect(container.resolve(token)).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('throws a useful error for an unregistered token', () => {
    const token = createToken<number>('missing');
    expect(() => new ServiceContainer().resolve(token)).toThrow(/missing/);
  });

  it('disposes resolved singletons', () => {
    const dispose = vi.fn();
    const token = createToken<{ dispose: () => void }>('disposable');
    const container = new ServiceContainer().register(token, () => ({ dispose }));
    container.resolve(token);
    container.disposeAll();
    expect(dispose).toHaveBeenCalled();
  });
});

describe('deterministic generation', () => {
  it('produces identical sequences from the same seed', () => {
    const a = makeRng(1234);
    const b = makeRng(1234);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('generates terrain noise in range and reproducibly', () => {
    const first = fbm3(0.3, 1.2, -0.7, 4, 2, 0.5, 42);
    const second = fbm3(0.3, 1.2, -0.7, 4, 2, 0.5, 42);
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(1);
  });
});
