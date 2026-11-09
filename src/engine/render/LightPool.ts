import * as THREE from 'three';

/**
 * A fixed handful of point lights, lent each frame to the nearest lit lamps.
 *
 * three compiles the number of lights into every lit material's shader. Each
 * street lamp used to carry its own PointLight, and the lamps are culled at
 * the horizon, so walking anywhere changed how many lights the scene had —
 * and every change recompiled every material on the planet. Measured: the
 * program count climbing 69 → 124 over eight seconds of running, with single
 * frames taking over a second. On top of that, a fragment of ground lit by a
 * dozen lamps paid for a dozen lights, nearly all of them out of reach.
 *
 * Now the lamps' own lights are never drawn. They stay where they are, and the
 * illumination system goes on setting their colour and brightness exactly as
 * before; this copies the nearest few that are lit into lights that are always
 * in the scene, so the count never changes. The last of them fades out as the
 * next lamp along comes as close, so a light changing hands never pops.
 */

/** Over this many metres the furthest borrowed light gives way to the next. */
const HANDOVER = 3;

interface Source {
  light: THREE.PointLight;
  position: THREE.Vector3;
  distance: number;
}

export class LightPool {
  readonly lights: THREE.PointLight[] = [];
  private readonly sources: Source[] = [];
  private readonly lit: Source[] = [];

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 18, 1.4);
      light.name = 'lamp-light';
      this.lights.push(light);
    }
  }

  /**
   * Hand a lamp's light over. It must already be where it will stay; from
   * here on it is never drawn itself, only lent.
   */
  addSource(light: THREE.PointLight): void {
    light.updateWorldMatrix(true, false);
    this.sources.push({ light, position: light.getWorldPosition(new THREE.Vector3()), distance: 0 });
    light.visible = false;
  }

  update(viewer: THREE.Vector3): void {
    const lit = this.lit;
    lit.length = 0;
    for (const source of this.sources) {
      if (source.light.intensity <= 0.001) continue;
      source.distance = source.position.distanceTo(viewer);
      lit.push(source);
    }
    lit.sort((a, b) => a.distance - b.distance);

    const size = this.lights.length;
    const next = lit[size]?.distance ?? Infinity;
    for (let i = 0; i < size; i++) {
      const light = this.lights[i]!;
      const source = lit[i];
      if (!source) {
        light.intensity = 0;
        continue;
      }
      const handover = Math.min(1, Math.max(0, (next - source.distance) / HANDOVER));
      light.position.copy(source.position);
      light.color.copy(source.light.color);
      light.intensity = source.light.intensity * handover;
      light.distance = source.light.distance;
      light.decay = source.light.decay;
    }
  }
}
