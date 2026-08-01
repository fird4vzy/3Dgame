import * as THREE from 'three';
import type { EventBus } from '@core/events/EventBus';
import { SpatialHash } from '@engine/physics/SpatialHash';

interface Shard {
  id: string;
  position: THREE.Vector3;
  object: THREE.Object3D;
  collected: boolean;
}

const COLLECT_RADIUS = 1.4;

/**
 * Hide or show a shard's mesh.
 *
 * `userData.hidden` is the authoritative flag, not `visible` — the scene's
 * horizon culler rewrites `visible` every frame and would otherwise bring a
 * collected shard straight back.
 */
function setHidden(object: THREE.Object3D, hidden: boolean): void {
  object.userData.hidden = hidden;
  object.visible = !hidden;
}

/**
 * Lumen Shards — optional collectibles.
 *
 * They auto-collect on proximity rather than needing a button press: an
 * interaction prompt for something with no decision attached is just friction.
 * Their real job is to give the glide verb a reason beyond speed, and to reward
 * the looking-around that a tiny dense planet invites (docs/03 §3.6).
 */
export class ShardSystem {
  private readonly hash = new SpatialHash<Shard>(8);
  private readonly shards = new Map<string, Shard>();
  private readonly scratch: Shard[] = [];
  private collectedCount = 0;
  private spin = 0;

  constructor(private readonly bus: EventBus) {}

  add(id: string, object: THREE.Object3D): void {
    const shard: Shard = {
      id,
      position: object.position.clone(),
      object,
      collected: false,
    };
    this.shards.set(id, shard);
    this.hash.insert(shard);
  }

  get total(): number {
    return this.shards.size;
  }

  get collected(): number {
    return this.collectedCount;
  }

  /** Make every shard collectable again, for a fresh run. */
  reset(): void {
    for (const shard of this.shards.values()) {
      if (!shard.collected) continue;
      shard.collected = false;
      setHidden(shard.object, false);
      this.hash.insert(shard);
    }
    this.collectedCount = 0;
  }

  restore(collectedIds: readonly string[]): void {
    for (const id of collectedIds) {
      const shard = this.shards.get(id);
      if (!shard || shard.collected) continue;
      shard.collected = true;
      setHidden(shard.object, true);
      this.hash.remove(shard);
      this.collectedCount++;
    }
  }

  /** Positions of shards still out there, for the minimap. */
  uncollectedPositions(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const shard of this.shards.values()) {
      if (!shard.collected) out.push(shard.position);
    }
    return out;
  }

  get collectedIds(): string[] {
    return [...this.shards.values()].filter((s) => s.collected).map((s) => s.id);
  }

  update(dt: number, playerPosition: THREE.Vector3): void {
    // A slow spin and bob is what makes them read as collectible at a glance.
    this.spin += dt;
    for (const shard of this.shards.values()) {
      if (shard.collected) continue;
      shard.object.rotation.y = this.spin * 1.4;
      shard.object.position.copy(shard.position);
      shard.object.position.addScaledVector(
        shard.position.clone().normalize(),
        Math.sin(this.spin * 2 + shard.position.x) * 0.08,
      );
    }

    const nearby = this.hash.query(playerPosition, COLLECT_RADIUS, this.scratch);
    for (const shard of nearby) {
      if (shard.collected) continue;
      shard.collected = true;
      setHidden(shard.object, true);
      this.hash.remove(shard);
      this.collectedCount++;

      this.bus.emit('shard:collected', {
        id: shard.id,
        total: this.collectedCount,
        of: this.shards.size,
        // The shard's own spot, not the player's — the burst should read as
        // the shard coming apart, not as something happening to the courier.
        position: { x: shard.position.x, y: shard.position.y, z: shard.position.z },
      });
    }
  }

  clear(): void {
    this.hash.clear();
    this.shards.clear();
    this.collectedCount = 0;
  }
}
