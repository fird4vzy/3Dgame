import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export interface CapsuleHit {
  /** Total depenetration applied this call. */
  displacement: THREE.Vector3;
  /** Averaged contact normal, or null if nothing was touched. */
  normal: THREE.Vector3 | null;
  contacts: number;
}

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
}

// Module-level scratch objects: the collision path runs 60 times a second and
// must not allocate. Never hold a reference to these across a call.
const _box = new THREE.Box3();
const _segment = new THREE.Line3();
const _triPoint = new THREE.Vector3();
const _capsulePoint = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _normalSum = new THREE.Vector3();
const _originalStart = new THREE.Vector3();
const _worldStart = new THREE.Vector3();
const _ray = new THREE.Ray();
const _invMatrix = new THREE.Matrix4();
const _localOrigin = new THREE.Vector3();

/**
 * Static world collision built on a bounded-volume hierarchy.
 *
 * We deliberately do not use a physics engine: movement is kinematic and
 * deterministic, so Rapier/Ammo would add several hundred KB of WASM for solver
 * features we never touch (docs/04-technical-architecture.md §4.1). Swapping one
 * in later means implementing this same small surface.
 */
export class BvhWorld {
  private bvh: MeshBVH | null = null;
  private mesh: THREE.Mesh | null = null;

  /** Build the acceleration structure. ~1.5 ms for our terrain. */
  build(mesh: THREE.Mesh): void {
    this.mesh = mesh;
    this.bvh = new MeshBVH(mesh.geometry, { maxLeafTris: 8 });
    mesh.geometry.boundsTree = this.bvh;
    mesh.updateMatrixWorld(true);
  }

  get isReady(): boolean {
    return this.bvh !== null;
  }

  /**
   * Resolve a capsule against the world, pushing it out of any triangle it
   * overlaps and sliding it along contact planes.
   *
   * `start` and `end` are the capsule's segment endpoints in world space and are
   * mutated in place. Runs `iterations` depenetration passes, because pushing
   * out of one triangle can push you into another (corners, stairs, crevices).
   */
  resolveCapsule(
    start: THREE.Vector3,
    end: THREE.Vector3,
    radius: number,
    iterations = 3,
  ): CapsuleHit {
    const result: CapsuleHit = {
      displacement: new THREE.Vector3(),
      normal: null,
      contacts: 0,
    };
    if (!this.bvh || !this.mesh) return result;

    _invMatrix.copy(this.mesh.matrixWorld).invert();
    _normalSum.set(0, 0, 0);
    _originalStart.copy(start);
    let contacts = 0;

    // Work in the mesh's local space, which is where the BVH lives.
    _segment.start.copy(start).applyMatrix4(_invMatrix);
    _segment.end.copy(end).applyMatrix4(_invMatrix);

    for (let iteration = 0; iteration < iterations; iteration++) {
      _box.makeEmpty();
      _box.expandByPoint(_segment.start);
      _box.expandByPoint(_segment.end);
      _box.min.addScalar(-radius);
      _box.max.addScalar(radius);

      let iterationContacts = 0;

      this.bvh.shapecast({
        intersectsBounds: (bounds) => bounds.intersectsBox(_box),
        intersectsTriangle: (tri) => {
          const distance = tri.closestPointToSegment(_segment, _triPoint, _capsulePoint);
          if (distance >= radius) return false;

          const depth = radius - distance;
          _delta.copy(_capsulePoint).sub(_triPoint);
          if (_delta.lengthSq() < 1e-12) {
            // Segment lies exactly in the triangle plane — use the face normal.
            tri.getNormal(_delta);
          } else {
            _delta.normalize();
          }

          // Correct the segment immediately, so the next triangle is tested
          // against the already-resolved pose. Summing every triangle's push
          // and applying it afterwards double-counts shared overlaps and
          // launches the capsule off the surface; averaging them instead
          // under-corrects in corners. Sequential correction is the only
          // version that converges.
          _segment.start.addScaledVector(_delta, depth);
          _segment.end.addScaledVector(_delta, depth);

          _normalSum.addScaledVector(_delta, depth);
          iterationContacts++;
          return false;
        },
      });

      contacts += iterationContacts;
      if (iterationContacts === 0) break;
    }

    if (contacts > 0) {
      // Back to world space and report the net movement.
      _worldStart.copy(_segment.start).applyMatrix4(this.mesh.matrixWorld);
      result.displacement.copy(_worldStart).sub(_originalStart);
      start.copy(_worldStart);
      end.copy(_segment.end).applyMatrix4(this.mesh.matrixWorld);

      if (_normalSum.lengthSq() > 1e-12) {
        result.normal = _normalSum.clone().transformDirection(this.mesh.matrixWorld).normalize();
      }
    }
    result.contacts = contacts;
    return result;
  }

  /** Nearest hit along a ray, or null. Distances are in world units. */
  raycast(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance = Infinity): RayHit | null {
    if (!this.bvh || !this.mesh) return null;

    _invMatrix.copy(this.mesh.matrixWorld).invert();
    _localOrigin.copy(origin).applyMatrix4(_invMatrix);
    _ray.origin.copy(_localOrigin);
    _ray.direction.copy(direction).transformDirection(_invMatrix).normalize();

    const hit = this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, maxDistance);
    if (!hit) return null;

    const point = hit.point.clone().applyMatrix4(this.mesh.matrixWorld);
    const normal = hit.face
      ? hit.face.normal.clone().transformDirection(this.mesh.matrixWorld).normalize()
      : new THREE.Vector3(0, 1, 0);

    return { point, normal, distance: point.distanceTo(origin) };
  }

  dispose(): void {
    if (this.mesh) this.mesh.geometry.boundsTree = undefined;
    this.bvh = null;
    this.mesh = null;
  }
}
