import type { EventBus } from '@core/events/EventBus';
import { CONTRACTS, type ContractDef, type Rating } from '../../data/content';

export type ContractState =
  | 'locked'
  | 'available'
  | 'accepted'
  | 'carrying'
  | 'completed';

export interface ContractRecord {
  def: ContractDef;
  state: ContractState;
  rating: Rating | null;
  acceptedAt: number | null;
  seconds: number | null;
}

/**
 * The contract graph.
 *
 * Contracts declare prerequisites and the available set is recomputed whenever
 * one completes, so adding a sixth delivery is a data edit in `data/content.ts`
 * and nothing else. There is deliberately **no failed state** — every path out
 * of a dropped parcel leads back to carrying it (docs/08-state-machine.md §8.3).
 */
export class QuestSystem {
  private readonly records = new Map<string, ContractRecord>();

  constructor(private readonly bus: EventBus) {
    for (const def of CONTRACTS) {
      this.records.set(def.id, {
        def,
        state: 'locked',
        rating: null,
        acceptedAt: null,
        seconds: null,
      });
    }
  }

  /** Recompute availability. Call once after construction and on completion. */
  reevaluate(): void {
    for (const record of this.records.values()) {
      if (record.state !== 'locked') continue;

      const ready = record.def.prerequisites.every(
        (id) => this.records.get(id)?.state === 'completed',
      );
      if (ready) {
        record.state = 'available';
        this.bus.emit('contract:available', { id: record.def.id });
      }
    }
  }

  /** Restore from a save, without replaying any events. */
  restore(completedIds: readonly string[]): void {
    for (const id of completedIds) {
      const record = this.records.get(id);
      if (record) {
        record.state = 'completed';
        record.rating = 'warm';
      }
    }
    this.reevaluate();
  }

  get(id: string): ContractRecord | undefined {
    return this.records.get(id);
  }

  get all(): ContractRecord[] {
    return [...this.records.values()];
  }

  /** The contract currently offered or in progress, if any. */
  get active(): ContractRecord | null {
    for (const record of this.records.values()) {
      if (record.state === 'accepted' || record.state === 'carrying') return record;
    }
    return null;
  }

  /** The next contract the player can pick up. */
  get nextAvailable(): ContractRecord | null {
    for (const record of this.records.values()) {
      if (record.state === 'available') return record;
    }
    return null;
  }

  get completedCount(): number {
    return this.all.filter((r) => r.state === 'completed').length;
  }

  get allComplete(): boolean {
    return this.completedCount === this.records.size;
  }

  accept(id: string, now: number): ContractRecord | null {
    const record = this.records.get(id);
    if (!record || record.state !== 'available') return null;

    record.state = 'accepted';
    record.acceptedAt = now;
    this.bus.emit('contract:accepted', {
      id,
      recipient: record.def.recipient,
      title: record.def.title,
    });
    return record;
  }

  markCarrying(id: string): void {
    const record = this.records.get(id);
    if (record?.state === 'accepted') record.state = 'carrying';
  }

  complete(id: string, rating: Rating, now: number): ContractRecord | null {
    const record = this.records.get(id);
    if (!record || record.state === 'completed') return null;

    record.state = 'completed';
    record.rating = rating;
    record.seconds = record.acceptedAt !== null ? (now - record.acceptedAt) / 1000 : null;

    this.bus.emit('delivery:completed', {
      contractId: id,
      rating,
      seconds: record.seconds ?? 0,
    });

    this.reevaluate();
    return record;
  }

  get completedIds(): string[] {
    return this.all.filter((r) => r.state === 'completed').map((r) => r.def.id);
  }

  get ratings(): Rating[] {
    return this.all
      .filter((r) => r.state === 'completed' && r.rating)
      .map((r) => r.rating as Rating);
  }
}
