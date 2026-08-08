import * as THREE from 'three';
import { loadStylisedModel, type StyliseOptions } from './stylise';

/**
 * Turn an imported model into one instanced draw.
 *
 * A bought asset arrives as a small hierarchy — a scene node holding a mesh,
 * sometimes several. Adding fifteen copies of that hierarchy to the scene is
 * fifteen draw calls for what is visually one object repeated, and the whole
 * reason the procedural props could be scattered so freely was that they were
 * instanced. Imported art has to earn its place the same way.
 *
 * The flattening is the interesting part: a mesh inside the loaded scene may
 * carry its own transform, and instancing throws the hierarchy away, so that
 * transform has to be baked into the geometry first or every copy sits in the
 * wrong place. `applyMatrix4` on a clone does it once, at load, rather than
 * per instance per frame.
 *
 * Only single-material models are instanced. A multi-material import would need
 * one InstancedMesh per material with matched instance counts, which is
 * possible but not worth the complexity until something needs it — and the
 * asset budget says one material anyway.
 */
export interface InstancedPropOptions extends StyliseOptions {
  /** Uniform scale jitter, as a fraction. */
  scaleJitter?: number;
  /** Random yaw about the surface normal. */
  randomYaw?: boolean;
}

const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _bitangent = new THREE.Vector3();
const _basis = new THREE.Matrix4();

/** Orientation whose +Y is the surface normal, with a yaw about it. */
export function orientToSurface(position: THREE.Vector3, yaw: number): THREE.Quaternion {
  _up.copy(position).normalize();
  _tangent.set(0, 1, 0).projectOnPlane(_up);
  if (_tangent.lengthSq() < 1e-6) _tangent.set(1, 0, 0).projectOnPlane(_up);
  _tangent.normalize().applyAxisAngle(_up, yaw);
  _bitangent.copy(_up).cross(_tangent).normalize();
  _basis.makeBasis(_bitangent, _up, _tangent);
  return _quat.setFromRotationMatrix(_basis);
}

/** Collapse a loaded model to a single geometry + material, baking transforms. */
export function flatten(root: THREE.Object3D): {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
} | null {
  root.updateWorldMatrix(true, true);

  let found: THREE.Mesh | null = null;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && !found) found = mesh;
  });
  if (!found) return null;

  const mesh = found as THREE.Mesh;
  const geometry = mesh.geometry.clone();
  // Bake the whole chain of transforms down from the root, including the
  // scale and the feet-anchoring offset that `styliseModel` applied.
  geometry.applyMatrix4(mesh.matrixWorld);

  // Re-anchor on the *baked* geometry, which is the only thing that is
  // actually drawn.
  //
  // `styliseModel` anchors the scene graph, and that is correct for a model
  // added as a hierarchy — but instancing throws the hierarchy away and keeps
  // only this geometry, and any node the traversal did not pick up, or any
  // difference between the group's bounds and this mesh's own, survives as a
  // vertical offset. In play that is a cat buried to its ankles and a torii
  // hovering a hand's width off the grass. Measuring here removes a whole class
  // of "why is it floating" by construction.
  geometry.computeBoundingBox();
  const minY = geometry.boundingBox?.min.y ?? 0;
  if (Math.abs(minY) > 1e-4) {
    geometry.translate(0, -minY, 0);
    geometry.computeBoundingBox();
  }
  geometry.computeBoundingSphere();

  const material = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
  return { geometry, material };
}

/**
 * Load a model and scatter it as one InstancedMesh.
 *
 * Returns null rather than throwing when the file is missing, because a
 * decorative prop failing to load must never take the world down with it — the
 * game is perfectly playable without a stone lantern.
 */
export async function loadInstancedProp(
  url: string,
  positions: THREE.Vector3[],
  seed: number,
  options: InstancedPropOptions = {},
): Promise<THREE.InstancedMesh | null> {
  if (positions.length === 0) return null;

  let model: THREE.Object3D;
  try {
    model = await loadStylisedModel(url, options);
  } catch (error) {
    console.warn(`[prop] ${url} did not load; skipping`, error);
    return null;
  }

  const flat = flatten(model);
  if (!flat) {
    console.warn(`[prop] ${url} contained no mesh`);
    return null;
  }

  const mesh = new THREE.InstancedMesh(flat.geometry, flat.material, positions.length);
  mesh.name = url.split('/').pop() ?? 'prop';
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;

  // Never frustum-cull one of these.
  //
  // An InstancedMesh gets its bounding volume from the *geometry*, not from
  // where the instances ended up, and these instances are scattered across a
  // whole planet — so the test is meaningless at best. At worst it is a bug:
  // the cats keep a second mesh for their happy face whose instances all sit at
  // zero scale until someone pets one, three computes a degenerate bounding
  // sphere from that, and the mesh is culled forever. The symptom was a cat
  // that *vanished* the moment you reached for it.
  //
  // Horizon culling already removes what is on the far side of the world, and
  // it works per instance, which is the level this actually needs.
  mesh.frustumCulled = false;

  // Deterministic jitter from the seed, so a district looks the same on every
  // load — the same reason the procedural scatter is seeded.
  let state = seed >>> 0;
  const rng = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const jitter = options.scaleJitter ?? 0;
  positions.forEach((position, index) => {
    const scale = 1 + (rng() - 0.5) * 2 * jitter;
    _scale.setScalar(scale);
    _matrix.compose(
      position,
      orientToSurface(position, options.randomYaw === false ? 0 : rng() * Math.PI * 2),
      _scale,
    );
    mesh.setMatrixAt(index, _matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;

  return mesh;
}
