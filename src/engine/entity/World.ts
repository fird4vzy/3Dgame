import * as THREE from 'three';
import type { Entity } from './Entity';

/**
 * The entity registry and update driver for a scene.
 *
 * Update order is fixed and matters: fixedUpdate moves things, update animates
 * them, lateUpdate reads the settled transforms (camera follow, UI anchors).
 * See docs/12-event-flow.md §12.3.
 */
export class World {
  readonly scene = new THREE.Scene();

  private readonly entities: Entity[] = [];
  private readonly pending: Entity[] = [];

  add(entity: Entity): Entity {
    this.pending.push(entity);
    this.scene.add(entity.object3D);
    return entity;
  }

  remove(entity: Entity): void {
    entity.destroy();
  }

  query(tag: string): Entity[] {
    return this.entities.filter((e) => e.tags.has(tag));
  }

  find(id: string): Entity | undefined {
    return this.entities.find((e) => e.id === id);
  }

  fixedUpdate(dt: number): void {
    this.flush();
    for (const e of this.entities) if (!e.isDestroyed) e.fixedUpdate(dt);
    this.reap();
  }

  update(dt: number): void {
    for (const e of this.entities) if (!e.isDestroyed) e.update(dt);
  }

  lateUpdate(dt: number): void {
    for (const e of this.entities) if (!e.isDestroyed) e.lateUpdate(dt);
  }

  get entityCount(): number {
    return this.entities.length;
  }

  dispose(): void {
    for (const e of [...this.entities]) e.destroy();
    this.entities.length = 0;
    this.pending.length = 0;
    disposeObject(this.scene);
  }

  /** Entities spawned mid-tick join at the next step, never mid-iteration. */
  private flush(): void {
    if (this.pending.length === 0) return;
    this.entities.push(...this.pending);
    this.pending.length = 0;
  }

  private reap(): void {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      if (this.entities[i]?.isDestroyed) this.entities.splice(i, 1);
    }
  }
}

/**
 * Recursively dispose geometries, materials and textures.
 *
 * Centralised here because scattered, partial disposal is the usual source of
 * WebGL memory leaks across scene cycles.
 */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose?.();

    const material = mesh.material;
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const mat of materials) {
      for (const value of Object.values(mat)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      mat.dispose();
    }
  });
}
