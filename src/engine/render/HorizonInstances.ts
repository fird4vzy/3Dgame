import * as THREE from 'three';

/**
 * Draw only the copies of an instanced prop that can be seen.
 *
 * The props are instanced across the whole sphere, and an InstancedMesh draws
 * every instance it has: a hundred and fifteen bamboo stands, forty-odd stone
 * lanterns, every shrine, house and tree on the planet, whether they are in
 * front of the camera or on the far side of the world. Two tests remove most
 * of them, per instance:
 *
 * - **The horizon.** It is thirteen metres off, so at any moment most of the
 *   planet is round the curve.
 * - **The view.** Of what is left, most is behind the camera or off to the
 *   side. three cannot frustum-cull an InstancedMesh — it has one bounding
 *   volume for a whole planet's worth of copies — so every house in the
 *   village was being transformed, vertex by vertex, three times a frame, and
 *   the ten shrines alone are 115,000 triangles. Only detailed meshes take
 *   this second test; a flower is cheaper to draw than to cull.
 *
 * Anything within `keepWithin` of the viewer is drawn whatever the camera
 * sees, because it may be standing just out of shot with its shadow in the
 * picture.
 *
 * The survivors are written to the front of the instance buffer and `count`
 * stops after them. The buffer is rewritten only when the set changes.
 *
 * Only for meshes whose instances never move. `add` snapshots the instances;
 * from then on this class owns the buffer, and anything that wrote to it by
 * index would be writing into a shuffled array. Collision is unaffected — the
 * obstacle BVH is built from the instances when a prop is added, before any
 * culling — and the camera only ever bumps into things it can see.
 */

/** A slack on every reach, radians: the terrain is not quite a sphere. */
const MARGIN = 0.03;
/** Triangles a mesh needs before testing each copy against the view pays. */
const WORTH_VIEW_CULLING = 300;

/**
 * How far round the planet a point can be and still be seen, radians, as the
 * sum of two tangents to the occluding sphere: the viewer's down to the
 * horizon, and the point's own (a tall thing crests the horizon from further
 * away than a short one).
 */
export function horizonReach(occluder: number, viewerRadius: number, pointRadius: number): number {
  const cap = (r: number): number => Math.acos(Math.min(1, occluder / Math.max(r, occluder)));
  return cap(viewerRadius) + cap(pointRadius);
}

/** What the camera can see, and what must be drawn regardless. */
export interface ViewCull {
  frustum: THREE.Frustum;
  /** The point shadows are cast around — the player. */
  centre: THREE.Vector3;
  /** Metres from `centre` inside which nothing is culled by the view. */
  keepWithin: number;
}

interface Entry {
  mesh: THREE.InstancedMesh;
  total: number;
  /** Every instance's matrix, as it was when taken over. */
  matrices: Float32Array;
  colours: Float32Array | null;
  /** Unit direction from the planet's centre to each instance. */
  ups: Float32Array;
  /** Each instance's own share of the reach: its top's tangent plus its width. */
  reach: Float32Array;
  /** Centre (xyz) and radius (w) of a sphere round each instance. */
  spheres: Float32Array;
  /** Whether this mesh is detailed enough to test against the view. */
  viewCulled: boolean;
  visible: Uint8Array;
  primed: boolean;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _sphere = new THREE.Sphere();

export class HorizonInstances {
  private readonly entries: Entry[] = [];
  private readonly known = new WeakSet<THREE.InstancedMesh>();

  /** @param occluder Radius of the sphere that hides things: the lowest ground. */
  constructor(private readonly occluder: number) {}

  get size(): number {
    return this.entries.length;
  }

  /** Take over a mesh whose instances will never move again. */
  add(mesh: THREE.InstancedMesh): void {
    if (this.known.has(mesh)) return;
    this.known.add(mesh);
    const total = mesh.count;
    if (total === 0) return;

    mesh.updateWorldMatrix(true, false);
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const box = geometry.boundingBox!;
    const bound = geometry.boundingSphere!;
    // Props stand on their own +Y with their feet at the origin.
    const top = Math.max(box.max.y, 0);
    const half = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z, 0);
    const index = geometry.getIndex();
    const triangles = (index ? index.count : (geometry.getAttribute('position')?.count ?? 0)) / 3;

    const matrices = (mesh.instanceMatrix.array as Float32Array).slice(0, total * 16);
    const colours = mesh.instanceColor
      ? (mesh.instanceColor.array as Float32Array).slice(0, total * 3)
      : null;
    const ups = new Float32Array(total * 3);
    const reach = new Float32Array(total);
    const spheres = new Float32Array(total * 4);
    const R = this.occluder;
    for (let i = 0; i < total; i++) {
      _m.fromArray(matrices, i * 16).premultiply(mesh.matrixWorld);
      _p.setFromMatrixPosition(_m);
      const radius = Math.max(_p.length(), 1e-6);
      const scale = _m.getMaxScaleOnAxis();
      ups[i * 3] = _p.x / radius;
      ups[i * 3 + 1] = _p.y / radius;
      ups[i * 3 + 2] = _p.z / radius;
      // horizonReach's second term, kept per instance; the viewer's is added per frame.
      const crest = Math.acos(Math.min(1, R / Math.max(radius + top * scale, R)));
      reach[i] = crest + (half * scale) / radius + MARGIN;

      _p.copy(bound.center).applyMatrix4(_m);
      spheres[i * 4] = _p.x;
      spheres[i * 4 + 1] = _p.y;
      spheres[i * 4 + 2] = _p.z;
      spheres[i * 4 + 3] = bound.radius * scale;
    }

    // From now on its bounds change with the view; frustum-testing a whole
    // planet's worth of instances never culled anything anyway.
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.entries.push({
      mesh,
      total,
      matrices,
      colours,
      ups,
      reach,
      spheres,
      viewCulled: triangles >= WORTH_VIEW_CULLING,
      visible: new Uint8Array(total),
      primed: false,
    });
  }

  /**
   * Show what can be seen from `viewer` (world space; the planet at the
   * origin). With `view`, detailed meshes are also culled to the camera.
   */
  update(viewer: THREE.Vector3, view?: ViewCull): void {
    const R = this.occluder;
    const viewerRadius = Math.max(viewer.length(), R);
    const cap = Math.acos(Math.min(1, R / viewerRadius));
    const vx = viewer.x / viewerRadius;
    const vy = viewer.y / viewerRadius;
    const vz = viewer.z / viewerRadius;

    for (const entry of this.entries) {
      const { ups, reach, spheres, visible, total } = entry;
      const cullToView = view !== undefined && entry.viewCulled;
      let changed = !entry.primed;
      for (let i = 0; i < total; i++) {
        const dot = vx * ups[i * 3]! + vy * ups[i * 3 + 1]! + vz * ups[i * 3 + 2]!;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        let seen = angle < cap + reach[i]! ? 1 : 0;
        if (seen && cullToView) {
          _sphere.center.set(spheres[i * 4]!, spheres[i * 4 + 1]!, spheres[i * 4 + 2]!);
          _sphere.radius = spheres[i * 4 + 3]!;
          const near = view.keepWithin + _sphere.radius;
          if (
            _sphere.center.distanceToSquared(view.centre) > near * near &&
            !view.frustum.intersectsSphere(_sphere)
          ) {
            seen = 0;
          }
        }
        if (seen !== visible[i]) {
          visible[i] = seen;
          changed = true;
        }
      }
      if (changed) this.compact(entry);
    }
  }

  private compact(entry: Entry): void {
    const { mesh, matrices, colours, visible, total } = entry;
    const out = mesh.instanceMatrix.array as Float32Array;
    const outColours = mesh.instanceColor ? (mesh.instanceColor.array as Float32Array) : null;
    let n = 0;
    for (let i = 0; i < total; i++) {
      if (!visible[i]) continue;
      // Always copied: slot n may hold another instance from the last set.
      out.set(matrices.subarray(i * 16, i * 16 + 16), n * 16);
      if (colours && outColours) outColours.set(colours.subarray(i * 3, i * 3 + 3), n * 3);
      n++;
    }
    entry.primed = true;
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // Raycasts test the bounds first, and they were computed for another set.
    mesh.boundingSphere = null;
    mesh.boundingBox = null;
  }
}
