import { StateMachine, type Transition } from '@core/fsm/StateMachine';
import type { EventBus } from '@core/events/EventBus';

export type GameState =
  | 'boot'
  | 'preload'
  | 'menu'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'dialogue'
  | 'cinematic'
  | 'complete'
  | 'fatal';

export type GameEvent =
  | 'engineReady'
  | 'assetsReady'
  | 'startRun'
  | 'worldReady'
  | 'pause'
  | 'resume'
  | 'quitToMenu'
  | 'dialogueStart'
  | 'dialogueEnd'
  | 'cinematicStart'
  | 'cinematicEnd'
  | 'finalDelivery'
  | 'fail';

interface Context {
  bus: EventBus;
}

/**
 * The global game state machine (docs/08-state-machine.md §8.1).
 *
 * Paused, dialogue and cinematic states *suspend simulation but keep
 * rendering* — the world stays visible behind the overlay. That is why the
 * scene manager is a stack and why {@link simulates} exists.
 */
const table: Transition<GameState, GameEvent, Context>[] = [
  { from: 'boot', event: 'engineReady', to: 'preload' },
  { from: 'boot', event: 'fail', to: 'fatal' },
  { from: 'preload', event: 'assetsReady', to: 'menu' },
  { from: 'preload', event: 'fail', to: 'fatal' },

  { from: 'menu', event: 'startRun', to: 'loading' },
  { from: 'loading', event: 'worldReady', to: 'playing' },

  { from: 'playing', event: 'pause', to: 'paused' },
  { from: 'paused', event: 'resume', to: 'playing' },
  { from: ['paused', 'complete'], event: 'quitToMenu', to: 'menu' },

  { from: 'playing', event: 'dialogueStart', to: 'dialogue' },
  { from: 'dialogue', event: 'dialogueEnd', to: 'playing' },

  { from: 'playing', event: 'cinematicStart', to: 'cinematic' },
  { from: 'cinematic', event: 'cinematicEnd', to: 'playing' },

  { from: 'playing', event: 'finalDelivery', to: 'complete' },
];

export class GameStateManager {
  private readonly fsm: StateMachine<GameState, GameEvent, Context>;

  constructor(private readonly bus: EventBus) {
    this.fsm = new StateMachine<GameState, GameEvent, Context>('boot', { bus }, table);
    this.fsm.onTransition((from, to) => {
      this.bus.emit('state:changed', { from, to });
    });
  }

  get current(): GameState {
    return this.fsm.current;
  }

  send(event: GameEvent): boolean {
    return this.fsm.send(event);
  }

  can(event: GameEvent): boolean {
    return this.fsm.can(event);
  }

  /** Only `playing` advances the simulation. */
  get simulates(): boolean {
    return this.fsm.current === 'playing';
  }

  /** Everything from `playing` onward keeps drawing the world. */
  get rendersWorld(): boolean {
    return ['playing', 'paused', 'dialogue', 'cinematic', 'complete'].includes(this.fsm.current);
  }
}
