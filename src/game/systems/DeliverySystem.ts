import type { EventBus } from '@core/events/EventBus';
import type { QuestSystem, ContractRecord } from './QuestSystem';
import type { DialogueSystem } from './DialogueSystem';
import type { WarmthSystem } from './WarmthSystem';
import type { IlluminationSystem } from './IlluminationSystem';
import type { ParcelWeight } from '../../data/content';

export interface DeliveryHooks {
  /** Show the parcel in the player's hand. */
  attachParcel(contractId: string, colour: string, weight: ParcelWeight): void;
  /** Remove it, on hand-off. */
  detachParcel(): void;
  /** Burst of lumen particles at the hand-off. */
  celebrate(): void;
  /** Suspend/resume player control during conversations. */
  setPlayerLocked(locked: boolean): void;
}

/**
 * Orchestrates one delivery from offer to hand-off.
 *
 * This is the only place that knows the *order* of a delivery — dialogue, then
 * parcel transfer, then district ignition, then autosave, then the next
 * contract. Every participating system is notified through the bus rather than
 * called directly where a direct call would create a cycle, which is what keeps
 * the system graph acyclic (docs/12-event-flow.md §12.2).
 */
export class DeliverySystem {
  private busy = false;

  constructor(
    private readonly bus: EventBus,
    private readonly quests: QuestSystem,
    private readonly dialogue: DialogueSystem,
    private readonly warmth: WarmthSystem,
    private readonly illumination: IlluminationSystem,
    private readonly hooks: DeliveryHooks,
  ) {}

  get isBusy(): boolean {
    return this.busy;
  }

  /** True if this NPC currently has something to offer or receive. */
  roleFor(npcId: string): 'giver' | 'recipient' | null {
    const active = this.quests.active;
    if (active && active.def.recipient === npcId) return 'recipient';

    const next = this.quests.nextAvailable;
    if (!active && next && next.def.giver === npcId) return 'giver';

    return null;
  }

  /** Talk to an NPC. Routes to the right half of the loop. */
  async interactWith(npcId: string): Promise<void> {
    if (this.busy) return;

    const role = this.roleFor(npcId);
    if (role === 'giver') await this.offer();
    else if (role === 'recipient') await this.deliver();
  }

  private async offer(): Promise<void> {
    const record = this.quests.nextAvailable;
    if (!record) return;

    this.busy = true;
    this.hooks.setPlayerLocked(true);
    try {
      this.bus.emit('contract:offered', { id: record.def.id, giver: record.def.giver });
      await this.dialogue.start(`${record.def.id}:accept`, record.def.onAccept);

      this.quests.accept(record.def.id, performance.now());
      this.quests.markCarrying(record.def.id);

      this.warmth.track(record.def.id, record.def.parcel.warmthSeconds);
      this.hooks.attachParcel(
        record.def.id,
        record.def.parcel.colour,
        record.def.parcel.weight,
      );
      this.bus.emit('parcel:picked', { parcelId: record.def.id });
    } finally {
      this.hooks.setPlayerLocked(false);
      this.busy = false;
    }
  }

  private async deliver(): Promise<void> {
    const record = this.quests.active;
    if (!record) return;

    this.busy = true;
    this.hooks.setPlayerLocked(true);
    try {
      const rating = this.warmth.ratingOf(record.def.id);

      await this.dialogue.start(`${record.def.id}:deliver`, record.def.onDeliver);

      this.hooks.detachParcel();
      this.hooks.celebrate();
      this.warmth.forget(record.def.id);

      this.quests.complete(record.def.id, rating, performance.now());

      // The payoff: the district wakes up. Lamps, colour, music, life.
      this.illumination.ignite(record.def.district);

      if (this.quests.allComplete) this.finishRun(record);
    } finally {
      this.hooks.setPlayerLocked(false);
      this.busy = false;
    }
  }

  private finishRun(last: ContractRecord): void {
    const ratings = this.quests.ratings;
    const total = this.quests.all.reduce((sum, r) => sum + (r.seconds ?? 0), 0);
    void last;

    this.bus.emit('run:completed', {
      seconds: total,
      ratings,
      shards: 0,
      districtsLit: this.quests.completedCount,
    });
  }
}
