import * as THREE from 'three';

/**
 * Draw only the copies of an instanced prop that can be seen over the curve of
 * the planet.
 *
 * The props are instanced across the whole sphere, and an InstancedMesh draws
 * every instance it has: a hundred and fifteen bamboo stands, forty-odd stone
 * lanterns, every shrine, house and tree on the planet, whether they are in
 * front of the camera or on the far side of the world. The horizon here is
 * thirteen metres off, so at any moment most of them are round the curve —
 * and each one was drawn three times a frame, for the picture, the shadow map
 * and the water's reflection. Measured on integrated graphics that was 1.7
 * million triangles a pass and about 23 fps, at any resolution.
 *
 * So the instances are compacted every frame: the ones that can be seen are
 * written to the front of the instance buffer and `count` stops after them.
 * Only when the visible set actually changes is the buffer rewritten, which on
 * foot is a handful of times a second.
 *
 * Only for meshes whose instances never move. `add` snapshots the instances;
 * from then on this class owns the buffer, and anything that wrote to it by
 * index would be writing into a shuffled array. Collision is unaffected — the
 * obstacle BVH is built from the instances when a prop is added, before any
 * culling — and the camera only ever bumps into things it can see.
 */

/** A slack on every reach, radians: the terrain is not quite a sphere. */
const MARGIN = 0.03;

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
  visible: Uint8Array;
  primed: boolean;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();

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
    const box = geometry.boundingBox!;
    // Props stand on their own +Y with their feet at the origin.
    const top = Math.max(box.max.y, 0);
    const half = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z, 0);

    const matrices = (mesh.instanceMatrix.array as Float32Array).slice(0, total * 16);
    const colours = mesh.instanceColor
      ? (mesh.instanceColor.array as Float32Array).slice(0, total * 3)
      : null;
    const ups = new Float32Array(total * 3);
    const reach = new Float32Array(total);
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
      visible: new Uint8Array(total),
      primed: false,
    });
  }

  /** Show what can be seen from `viewer` (world space; the planet at the origin). */
  update(viewer: THREE.Vector3): void {
    const R = this.occluder;
    const viewerRadius = Math.max(viewer.length(), R);
    const cap = Math.acos(Math.min(1, R / viewerRadius));
    const vx = viewer.x / viewerRadius;
    const vy = viewer.y / viewerRadius;
    const vz = viewer.z / viewerRadius;

    for (const entry of this.entries) {
      const { ups, reach, visible, total } = entry;
      let changed = !entry.primed;
      for (let i = 0; i < total; i++) {
        const dot = vx * ups[i * 3]! + vy * ups[i * 3 + 1]! + vz * ups[i * 3 + 2]!;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        const seen = angle < cap + reach[i]! ? 1 : 0;
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
