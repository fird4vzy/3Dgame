import type { EventBus } from '@core/events/EventBus';
import type { Rating } from '../../data/content';

interface TrackedParcel {
  id: string;
  warmth: number;
  decayPerSecond: number;
}

/** Thresholds from docs/03-gameplay-specification.md §3.3. */
const BRIGHT_ABOVE = 0.66;
const WARM_ABOVE = 0.25;

export function ratingFor(warmth: number): Rating {
  if (warmth > BRIGHT_ABOVE) return 'bright';
  if (warmth > WARM_ABOVE) return 'warm';
  return 'cool';
}

/**
 * Parcel warmth — the opt-in mastery layer.
 *
 * Warmth decays while carried and determines the delivery's rating. It **never
 * blocks completion**: a cold parcel still completes the contract, still
 * resolves the story, still lights the district. Cozy players never notice it;
 * optimisers get a chase (GDD Pillar 2, §2.3C).
 *
 * It is deliberately surfaced only as the parcel's glow colour, never as a HUD
 * bar — a visible draining meter would turn a gentle bonus into pressure.
 */
export class WarmthSystem {
  private readonly parcels = new Map<string, TrackedParcel>();
  /** Emit at ~10 Hz rather than 60; nothing downstream needs more. */
  private emitAccumulator = 0;

  constructor(private readonly bus: EventBus) {}

  track(id: string, warmthSeconds: number): void {
    this.parcels.set(id, {
      id,
      warmth: 1,
      decayPerSecond: warmthSeconds > 0 ? 1 / warmthSeconds : 0,
    });
  }

  forget(id: string): void {
    this.parcels.delete(id);
  }

  warmthOf(id: string): number {
    return this.parcels.get(id)?.warmth ?? 0;
  }

  ratingOf(id: string): Rating {
    return ratingFor(this.warmthOf(id));
  }

  tick(dt: number): void {
    if (this.parcels.size === 0) return;

    for (const parcel of this.parcels.values()) {
      parcel.warmth = Math.max(0, parcel.warmth - parcel.decayPerSecond * dt);
    }

    this.emitAccumulator += dt;
    if (this.emitAccumulator < 0.1) return;
    this.emitAccumulator = 0;

    for (const parcel of this.parcels.values()) {
      this.bus.emit('parcel:warmthChanged', { parcelId: parcel.id, warmth: parcel.warmth });
    }
  }

  clear(): void {
    this.parcels.clear();
  }
}
