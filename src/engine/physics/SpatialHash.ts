import * as THREE from 'three';

export interface SpatialItem {
  id: string;
  position: THREE.Vector3;
}

const _key = { x: 0, y: 0, z: 0 };

/**
 * Uniform-grid spatial hash for proximity queries.
 *
 * Used for interactables and collectibles. On a 60 m planet a linear scan of
 * ~60 items would honestly be fine, but the hash keeps the query cost flat as
 * districts fill up with props, and it is the same structure trigger volumes
 * will use in Phase 4.
 */
export class SpatialHash<T extends SpatialItem> {
  private readonly cells = new Map<string, T[]>();
  private readonly itemCell = new Map<string, string>();

  constructor(private readonly cellSize = 8) {}

  private hash(position: THREE.Vector3): string {
    _key.x = Math.floor(position.x / this.cellSize);
    _key.y = Math.floor(position.y / this.cellSize);
    _key.z = Math.floor(position.z / this.cellSize);
    return `${_key.x},${_key.y},${_key.z}`;
  }

  insert(item: T): void {
    const key = this.hash(item.position);
    const existing = this.itemCell.get(item.id);
    if (existing === key) return;
    if (existing) this.removeFromCell(existing, item.id);

    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push(item);
    this.itemCell.set(item.id, key);
  }

  remove(item: T): void {
    const key = this.itemCell.get(item.id);
    if (!key) return;
    this.removeFromCell(key, item.id);
    this.itemCell.delete(item.id);
  }

  /** Re-bucket an item whose position changed. */
  update(item: T): void {
    this.insert(item);
  }

  /**
   * Every item within `radius` of `position`.
   *
   * Scans the 3×3×3 neighbourhood, which is correct as long as the radius does
   * not exceed the cell size — asserted in dev so a future tuning change cannot
   * silently start missing items.
   */
  query(position: THREE.Vector3, radius: number, out: T[] = []): T[] {
    out.length = 0;
    if (import.meta.env?.DEV && radius > this.cellSize) {
      console.warn(
        `[SpatialHash] query radius ${radius} exceeds cell size ${this.cellSize}; ` +
          'results may be incomplete.',
      );
    }

    const cx = Math.floor(position.x / this.cellSize);
    const cy = Math.floor(position.y / this.cellSize);
    const cz = Math.floor(position.z / this.cellSize);
    const radiusSq = radius * radius;

    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (let z = cz - 1; z <= cz + 1; z++) {
          const bucket = this.cells.get(`${x},${y},${z}`);
          if (!bucket) continue;
          for (const item of bucket) {
            if (item.position.distanceToSquared(position) <= radiusSq) out.push(item);
          }
        }
      }
    }
    return out;
  }

  get size(): number {
    return this.itemCell.size;
  }

  clear(): void {
    this.cells.clear();
    this.itemCell.clear();
  }

  private removeFromCell(key: string, id: string): void {
    const bucket = this.cells.get(key);
    if (!bucket) return;
    const index = bucket.findIndex((i) => i.id === id);
    if (index >= 0) bucket.splice(index, 1);
    if (bucket.length === 0) this.cells.delete(key);
  }
}
