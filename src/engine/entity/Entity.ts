import * as THREE from 'three';

/**
 * Component-oriented entity model (Unity-like), deliberately not a data-oriented
 * ECS: our entity count is ~200, not ~200,000, and readability matters more than
 * cache locality here. High-count things (particles, foliage, emotes) bypass
 * this entirely and use pooled flat arrays.
 *
 * See docs/04-technical-architecture.md §4.3 for the reasoning.
 */
export abstract class Component {
  entity!: Entity;

  onAttach(): void {}
  fixedUpdate(_dt: number): void {}
  update(_dt: number): void {}
  lateUpdate(_dt: number): void {}
  onDetach(): void {}
}

type ComponentClass<T extends Component> = new (...args: never[]) => T;

let nextId = 0;

export class Entity {
  readonly id: string;
  readonly object3D: THREE.Object3D;
  readonly tags = new Set<string>();

  private readonly components: Component[] = [];
  private destroyed = false;

  constructor(name = 'entity', object3D?: THREE.Object3D) {
    this.id = `${name}_${nextId++}`;
    this.object3D = object3D ?? new THREE.Object3D();
    this.object3D.name = this.id;
  }

  addComponent<T extends Component>(component: T): T {
    component.entity = this;
    this.components.push(component);
    component.onAttach();
    return component;
  }

  getComponent<T extends Component>(type: ComponentClass<T>): T | undefined {
    return this.components.find((c): c is T => c instanceof type);
  }

  requireComponent<T extends Component>(type: ComponentClass<T>): T {
    const found = this.getComponent(type);
    if (!found) throw new Error(`[Entity] ${this.id} is missing ${type.name}`);
    return found;
  }

  removeComponent<T extends Component>(type: ComponentClass<T>): void {
    const index = this.components.findIndex((c) => c instanceof type);
    if (index < 0) return;
    const [component] = this.components.splice(index, 1);
    component?.onDetach();
  }

  fixedUpdate(dt: number): void {
    for (const c of this.components) c.fixedUpdate(dt);
  }

  update(dt: number): void {
    for (const c of this.components) c.update(dt);
  }

  lateUpdate(dt: number): void {
    for (const c of this.components) c.lateUpdate(dt);
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const c of this.components) c.onDetach();
    this.components.length = 0;
    this.object3D.removeFromParent();
  }
}
