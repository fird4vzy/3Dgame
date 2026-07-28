import * as THREE from 'three';
import { DISTRICTS, type DistrictDef, type DistrictId } from '../../data/content';
import { latLonToCartesian } from '@core/math/spherical';
import { PLANET_RADIUS } from '@config/constants';

const _dir = new THREE.Vector3();

export interface DistrictRuntime {
  def: DistrictDef;
  /** Unit vector from the planet centre toward the district centre. */
  direction: THREE.Vector3;
  lit: boolean;
  /** 0 while dormant, 1 once fully lit. Drives colour and lamp emissive. */
  light: number;
}

/**
 * Where the districts are and which one you are standing in.
 *
 * Membership is nearest-centre by angle rather than by a polygon boundary: on a
 * sphere the whole surface is covered with no gaps and no seams to author, and
 * "which district am I in" becomes five dot products.
 */
export class DistrictRegistry {
  private readonly runtimes = new Map<DistrictId, DistrictRuntime>();

  constructor() {
    for (const def of DISTRICTS) {
      const p = latLonToCartesian(def.centre.lat, def.centre.lon, 1);
      this.runtimes.set(def.id, {
        def,
        direction: new THREE.Vector3(p.x, p.y, p.z).normalize(),
        lit: false,
        light: 0,
      });
    }
  }

  get all(): DistrictRuntime[] {
    return [...this.runtimes.values()];
  }

  get(id: DistrictId): DistrictRuntime {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new Error(`[Districts] unknown district "${id}"`);
    return runtime;
  }

  get litCount(): number {
    return this.all.filter((d) => d.lit).length;
  }

  /** Which district contains this world position. */
  at(position: THREE.Vector3): DistrictRuntime {
    _dir.copy(position).normalize();

    let best = this.all[0]!;
    let bestDot = -Infinity;
    for (const runtime of this.runtimes.values()) {
      const dot = runtime.direction.dot(_dir);
      if (dot > bestDot) {
        bestDot = dot;
        best = runtime;
      }
    }
    return best;
  }

  /** World-space centre of a district, on the terrain surface. */
  centreOf(id: DistrictId, radius = PLANET_RADIUS): THREE.Vector3 {
    return this.get(id).direction.clone().multiplyScalar(radius);
  }
}
