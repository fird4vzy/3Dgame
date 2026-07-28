export interface Transition<S extends string, E extends string, C> {
  from: S | S[];
  event: E;
  to: S;
  guard?: (ctx: C) => boolean;
  onExit?: (ctx: C) => void;
  onEnter?: (ctx: C) => void;
}

export type TransitionListener<S extends string, E extends string> = (
  from: S,
  to: S,
  event: E,
) => void;

/**
 * Table-driven finite state machine.
 *
 * Transitions are data, so an illegal transition is impossible rather than
 * merely discouraged: `send` returns false and does nothing if no rule matches.
 * It never throws — a dropped input must not crash the game.
 */
export class StateMachine<S extends string, E extends string, C> {
  private state: S;
  private readonly listeners = new Set<TransitionListener<S, E>>();

  constructor(
    initial: S,
    private readonly ctx: C,
    private readonly table: readonly Transition<S, E, C>[],
  ) {
    this.state = initial;
  }

  get current(): S {
    return this.state;
  }

  is(state: S): boolean {
    return this.state === state;
  }

  can(event: E): boolean {
    return this.find(event) !== undefined;
  }

  send(event: E): boolean {
    const transition = this.find(event);
    if (!transition) return false;

    const from = this.state;
    transition.onExit?.(this.ctx);
    this.state = transition.to;
    transition.onEnter?.(this.ctx);

    for (const listener of [...this.listeners]) listener(from, transition.to, event);
    return true;
  }

  onTransition(listener: TransitionListener<S, E>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private find(event: E): Transition<S, E, C> | undefined {
    return this.table.find((t) => {
      if (t.event !== event) return false;
      const matches = Array.isArray(t.from) ? t.from.includes(this.state) : t.from === this.state;
      if (!matches) return false;
      return t.guard ? t.guard(this.ctx) : true;
    });
  }
}
