import * as THREE from 'three';

/**
 * Collision volumes for props, derived from their own geometry.
 *
 * The world collided with the terrain and nothing else: the player walked
 * straight through houses, gates and tree trunks, and the camera followed
 * her inside. A box per model is the obvious fix and the wrong one — a torii
 * as a box is a wall you cannot walk through, which is the one thing a gate
 * is for, and a farmhouse's box includes its eaves.
 *
 * So a model's collider is what it is *at body height*: the geometry is
 * sampled in a horizontal slab from knee to shoulder, the cells it occupies
 * on a fine grid are marked, and runs of marked cells become boxes. A gate
 * gives two pillars, a house its walls, a tree its trunk, a lantern its post.
 * The boxes are extruded well above head height, so there is no invisible
 * ledge to land on.
 */

export interface FootprintOptions {
  /** Grid cell, metres (model units). */
  cell?: number;
  /** The slab sampled, in model units above the model's feet. */
  slabMin?: number;
  slabMax?: number;
}

const footprintCache = new WeakMap<THREE.BufferGeometry, THREE.Box3[]>();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Boxes, in the geometry's own space, covering what the model occupies at
 * body height. Cached per geometry.
 */
export function footprintBoxes(geometry: THREE.BufferGeometry, options: FootprintOptions = {}): THREE.Box3[] {
  const cached = footprintCache.get(geometry);
  if (cached) return cached;

  const cell = options.cell ?? 0.2;
  const slabMin = options.slabMin ?? 0.3;
  const slabMax = options.slabMax ?? 1.5;

  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const triangles = index ? index.count / 3 : position.count / 3;
  const corner = (t: number, k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);

  let topY = -Infinity;
  for (let i = 0; i < position.count; i++) topY = Math.max(topY, position.getY(i));

  const occupied = new Set<string>();
  for (let t = 0; t < triangles; t++) {
    _a.fromBufferAttribute(position, corner(t, 0));
    _b.fromBufferAttribute(position, corner(t, 1));
    _c.fromBufferAttribute(position, corner(t, 2));
    const lo = Math.min(_a.y, _b.y, _c.y);
    const hi = Math.max(_a.y, _b.y, _c.y);
    if (hi < slabMin || lo > slabMax) continue;

    // Sample the triangle densely enough that no cell it crosses is missed.
    const longest = Math.max(_a.distanceTo(_b), _b.distanceTo(_c), _c.distanceTo(_a));
    const n = Math.max(1, Math.ceil(longest / (cell * 0.5)));
    for (let i = 0; i <= n; i++) {
      for (let j = 0; i + j <= n; j++) {
        const u = i / n;
        const v = j / n;
        _p.copy(_a).multiplyScalar(1 - u - v).addScaledVector(_b, u).addScaledVector(_c, v);
        if (_p.y < slabMin || _p.y > slabMax) continue;
        occupied.add(`${Math.floor(_p.x / cell)},${Math.floor(_p.z / cell)}`);
      }
    }
  }

  // Merge each row's runs into boxes. Tall enough that nothing can be stood
  // on: the controller only ever stands on terrain.
  const bottom = -0.5;
  const top = Math.min(Math.max(topY, 2.4), 3.2);
  const rows = new Map<number, number[]>();
  for (const key of occupied) {
    const [x, z] = key.split(',').map(Number) as [number, number];
    const row = rows.get(z) ?? [];
    row.push(x);
    rows.set(z, row);
  }
  const boxes: THREE.Box3[] = [];
  for (const [z, xs] of rows) {
    xs.sort((p, q) => p - q);
    let start = xs[0]!;
    let previous = start;
    const flush = (end: number) => {
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(start * cell, bottom, z * cell),
          new THREE.Vector3((end + 1) * cell, top, (z + 1) * cell),
        ),
      );
    };
    for (let k = 1; k < xs.length; k++) {
      const x = xs[k]!;
      if (x !== previous + 1) {
        flush(previous);
        start = x;
      }
      previous = x;
    }
    flush(previous);
  }

  footprintCache.set(geometry, boxes);
  return boxes;
}

// A unit box's twelve triangles, as corner indices into its eight corners.
const BOX_TRIANGLES = [
  0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5,
];
const _corners = Array.from({ length: 8 }, () => new THREE.Vector3());
const _instance = new THREE.Matrix4();
const _world = new THREE.Matrix4();

const _inverse = new THREE.Matrix4();
const _relative = new THREE.Matrix4();

/**
 * Bake every visible mesh under `root` into one geometry in `root`'s own
 * space — metres, feet at the origin, for anything placed on the planet —
 * so a model built as a hierarchy gets the same footprint treatment as one
 * flattened into an instanced mesh.
 */
function bakeHierarchy(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateWorldMatrix(true, true);
  _inverse.copy(root.matrixWorld).invert();
  const parts: number[] = [];
  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    _relative.multiplyMatrices(_inverse, mesh.matrixWorld);
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i++) {
      _p.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(_relative);
      parts.push(_p.x, _p.y, _p.z);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(parts, 3));
  return geometry;
}

/**
 * World-space triangles for the colliders of an object — every instance of
 * an instanced mesh, or a whole hierarchy — ready to be merged into the
 * obstacle BVH.
 */
export function colliderTriangles(object: THREE.Object3D, options: FootprintOptions = {}): Float32Array {
  const instanced = (object as THREE.InstancedMesh).isInstancedMesh ? (object as THREE.InstancedMesh) : null;
  const geometry = instanced ? instanced.geometry : bakeHierarchy(object);
  const boxes = footprintBoxes(geometry, options);
  object.updateWorldMatrix(true, false);
  const count = instanced ? instanced.count : 1;
  const out = new Float32Array(count * boxes.length * BOX_TRIANGLES.length * 3);

  let o = 0;
  for (let i = 0; i < count; i++) {
    if (instanced) {
      instanced.getMatrixAt(i, _instance);
      _world.multiplyMatrices(object.matrixWorld, _instance);
    } else {
      _world.copy(object.matrixWorld);
    }
    for (const box of boxes) {
      for (let k = 0; k < 8; k++) {
        _corners[k]!.set(
          k & 1 ? box.max.x : box.min.x,
          k & 2 ? box.max.y : box.min.y,
          k & 4 ? box.max.z : box.min.z,
        ).applyMatrix4(_world);
      }
      for (const c of BOX_TRIANGLES) {
        const v = _corners[c]!;
        out[o++] = v.x;
        out[o++] = v.y;
        out[o++] = v.z;
      }
    }
  }
  return out;
}
