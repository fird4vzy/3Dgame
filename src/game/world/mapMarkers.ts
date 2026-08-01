import type * as THREE from 'three';

/**
 * What the minimap can show.
 *
 * Declared in `game/` rather than alongside the widget because it describes
 * *world contents*, not presentation — and because the dependency has to point
 * that way. `ui/` sits above `game/` in the layering, so the HUD imports this;
 * the scene importing a type out of the HUD would be an upward dependency, and
 * the fact that a `import type` erases at runtime does not make it right.
 */
export type MarkerKind = 'objective' | 'npc' | 'shard' | 'lamp';

export interface MinimapMarker {
  position: THREE.Vector3;
  kind: MarkerKind;
  /** Optional identifier, for debugging and future labelled markers. */
  label?: string;
}
