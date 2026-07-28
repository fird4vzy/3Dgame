import * as THREE from 'three';
import type { EventBus } from '@core/events/EventBus';
import { SpatialHash } from '@engine/physics/SpatialHash';

export interface Interactable {
  id: string;
  position: THREE.Vector3;
  radius: number;
  /** Prompt verb shown to the player, e.g. "Talk", "Deliver". */
  prompt: string;
  enabled: boolean;
  onInteract: () => void;
}

const _toTarget = new THREE.Vector3();

/**
 * Proximity interaction with look-weighted candidate scoring.
 *
 * When two things are in range, the one you are *looking at* wins even if the
 * other is marginally closer — otherwise brushing past a lamp on the way to an
 * NPC steals the prompt, which feels broken in a way players notice but cannot
 * articulate (docs/03-gameplay-specification.md §3.5).
 */
export class InteractionSystem {
  private readonly hash = new SpatialHash<Interactable>(8);
  private readonly items = new Map<string, Interactable>();
  private readonly scratch: Interactable[] = [];

  private focused: Interactable | null = null;

  constructor(private readonly bus: EventBus) {}

  register(item: Interactable): void {
    this.items.set(item.id, item);
    this.hash.insert(item);
  }

  unregister(id: string): void {
    const item = this.items.get(id);
    if (!item) return;
    this.hash.remove(item);
    this.items.delete(id);
    if (this.focused?.id === id) this.setFocus(null);
  }

  /** Call after moving an interactable so the hash stays correct. */
  moved(id: string): void {
    const item = this.items.get(id);
    if (item) this.hash.update(item);
  }

  setEnabled(id: string, enabled: boolean): void {
    const item = this.items.get(id);
    if (!item) return;
    item.enabled = enabled;
    if (!enabled && this.focused?.id === id) this.setFocus(null);
  }

  get current(): Interactable | null {
    return this.focused;
  }

  /** Fire the focused interactable, if any. Returns true if something ran. */
  activate(): boolean {
    if (!this.focused || !this.focused.enabled) return false;
    this.focused.onInteract();
    return true;
  }

  update(playerPosition: THREE.Vector3, playerForward: THREE.Vector3): void {
    // 8 m matches the hash cell size — the largest radius we can query safely.
    const candidates = this.hash.query(playerPosition, 8, this.scratch);

    let best: Interactable | null = null;
    let bestScore = -Infinity;

    for (const item of candidates) {
      if (!item.enabled) continue;

      const distance = item.position.distanceTo(playerPosition);
      if (distance > item.radius) continue;

      _toTarget.copy(item.position).sub(playerPosition).normalize();
      const facing = _toTarget.dot(playerForward); // -1 behind … 1 ahead

      // Closeness dominates; facing breaks ties and rescues the thing you are
      // clearly looking at. Facing is remapped to 0..1 so it never goes negative
      // and flips the ordering outright.
      const score = (1 - distance / item.radius) + (facing + 1) * 0.35;
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }

    if (best?.id !== this.focused?.id) this.setFocus(best);
  }

  clear(): void {
    this.hash.clear();
    this.items.clear();
    this.setFocus(null);
  }

  private setFocus(next: Interactable | null): void {
    this.focused = next;
    this.bus.emit('interaction:focusChanged', {
      id: next?.id ?? null,
      prompt: next?.prompt ?? null,
    });
  }
}
