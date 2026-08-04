import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toonGradient } from './ToonMaterial';

/**
 * Bring an imported model into this world.
 *
 * Generated and marketplace assets arrive as physically-shaded glTF at an
 * arbitrary scale, with the origin wherever the exporter felt like putting it.
 * Dropped straight into the scene they look *wrong* in three separate ways at
 * once — wrong size, floating or sunk, and shaded by a completely different
 * lighting model than everything around them — and the natural reaction is that
 * the asset is bad. It usually is not. It has simply never been converted.
 *
 * This is that conversion, and it exists as one function so that every import
 * gets the identical treatment. The moment two models come in through two
 * different paths, they stop looking like they belong to the same game, and no
 * amount of per-model fiddling puts that back.
 *
 * The screen-space ink outline applies to anything in the depth buffer, so
 * imported geometry gets outlined for free — nothing to do here for that.
 */

export interface StyliseOptions {
  /**
   * Target height in metres, measured across the model's bounding box.
   *
   * Almost always the right control. Exporters disagree about units — some
   * write centimetres, some write "1 unit = whatever looked right" — and a
   * scale *factor* propagates that disagreement into our scene. A height is
   * unambiguous: a cottage is three metres tall wherever it came from.
   */
  height?: number;
  /**
   * Where the origin should end up.
   *
   * `feet` puts it on the ground under the model's centre, which is what
   * anything standing on the planet needs. `centre` is for things that hang or
   * orbit.
   */
  anchor?: 'feet' | 'centre';
  /** Cel bands. Matches the rest of the world at 3. */
  bands?: number;
  /**
   * Pull every colour this far toward the world palette, 0..1.
   *
   * Imported art is almost always more saturated than a cel-shaded scene wants
   * — see the note in `PlanetTerrain` about flat fills exaggerating saturation.
   * A small pull toward a shared tint is what makes a set of models from
   * different sources read as one art direction. 0 keeps the author's colours.
   */
  harmonise?: number;
  /** The colour `harmonise` pulls toward. */
  harmonyTint?: THREE.Color;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

const DEFAULT_TINT = new THREE.Color('#b9b49c');

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _centre = new THREE.Vector3();

/**
 * Convert one material to the world's cel shading, keeping what matters.
 *
 * The base colour map is carried over — that is the whole reason to buy a
 * textured model — while everything physical about the original is discarded,
 * because `MeshToonMaterial` has no use for roughness or metalness and keeping
 * them would only confuse anyone reading it later. Emissive survives, since the
 * illumination system drives emissive on lamps and it costs nothing to let an
 * imported lantern do the same.
 */
function toToon(source: THREE.Material, options: StyliseOptions): THREE.MeshToonMaterial {
  const from = source as THREE.MeshStandardMaterial;

  const material = new THREE.MeshToonMaterial({
    color: from.color?.clone() ?? new THREE.Color('#ffffff'),
    map: from.map ?? null,
    gradientMap: toonGradient(options.bands ?? 3),
    transparent: from.transparent ?? false,
    opacity: from.opacity ?? 1,
    alphaTest: from.alphaTest ?? 0,
    side: from.side ?? THREE.FrontSide,
  });

  if (from.emissive) {
    material.emissive = from.emissive.clone();
    material.emissiveMap = from.emissiveMap ?? null;
    material.emissiveIntensity = from.emissiveIntensity ?? 1;
  }

  const pull = options.harmonise ?? 0;
  if (pull > 0) {
    material.color.lerp(options.harmonyTint ?? DEFAULT_TINT, pull);
  }

  material.name = `${source.name || 'imported'}_toon`;
  return material;
}

/**
 * Restyle, rescale and re-anchor a loaded glTF scene, in place.
 *
 * Returns the same object for chaining. Safe to call on a group that has
 * already been added to a scene.
 */
export function styliseModel(root: THREE.Object3D, options: StyliseOptions = {}): THREE.Object3D {
  // Materials first: converting after scaling would be identical, but doing it
  // first means the bounding box below is measured on the final materials, which
  // matters if any of them turn out to be double-sided.
  const converted = new Map<THREE.Material, THREE.MeshToonMaterial>();

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;

    const replace = (material: THREE.Material): THREE.MeshToonMaterial => {
      const existing = converted.get(material);
      if (existing) return existing;
      const toon = toToon(material, options);
      converted.set(material, toon);
      // The original is ours to dispose: GLTFLoader created it for this scene
      // and nothing else references it.
      material.dispose();
      return toon;
    };

    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(replace)
      : replace(mesh.material);

    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
  });

  // Scale to a real-world height.
  root.updateWorldMatrix(true, true);
  _box.setFromObject(root);
  _box.getSize(_size);

  const target = options.height;
  if (target && _size.y > 1e-4) {
    const scale = target / _size.y;
    root.scale.multiplyScalar(scale);
    root.updateWorldMatrix(true, true);
    _box.setFromObject(root);
    _box.getSize(_size);
  }

  // Re-anchor.
  //
  // Done by shifting the *children*, not the root, so the caller keeps a clean
  // object whose own position means "where this thing is in the world". Move
  // the root instead and every placement afterwards has to know about a hidden
  // offset.
  _box.getCenter(_centre);
  const anchor = options.anchor ?? 'feet';
  const shift = new THREE.Vector3(
    -_centre.x,
    anchor === 'feet' ? -_box.min.y : -_centre.y,
    -_centre.z,
  );

  // The bounding box is in **world** units; a child's position is in the
  // root's local space. After the rescale above those two differ by exactly
  // the root's scale, so applying a world-space shift to a local position
  // under-corrects by that factor.
  //
  // On a model scaled to 0.46 that left a farmhouse hovering six and a half
  // metres in the air, and it only showed up because the instanced path
  // re-anchors on the baked geometry and therefore looked right in game while
  // the preview tool looked wrong. A tool that disagrees with the game is
  // worse than no tool.
  shift.divide(root.scale);

  if (shift.lengthSq() > 1e-8) {
    for (const child of root.children) child.position.add(shift);
  }
  root.updateWorldMatrix(true, true);

  return root;
}

const loader = new GLTFLoader();

/** Load a glTF/GLB and stylise it. */
export async function loadStylisedModel(
  url: string,
  options: StyliseOptions = {},
): Promise<THREE.Object3D> {
  const gltf = await loader.loadAsync(url);
  return styliseModel(gltf.scene, options);
}

/**
 * Report what an imported model actually contains.
 *
 * Called by `tools/model-preview.html`. Worth having as a function rather than
 * an ad-hoc traversal in the tool, because the numbers it prints — triangle
 * count, material count, texture sizes — are exactly the ones that decide
 * whether an asset can be used as-is or needs decimating first, and they should
 * be measured the same way every time.
 */
export function describeModel(root: THREE.Object3D): {
  triangles: number;
  meshes: number;
  materials: number;
  textures: string[];
  size: { x: number; y: number; z: number };
} {
  let triangles = 0;
  let meshes = 0;
  const materials = new Set<THREE.Material>();
  const textures = new Set<string>();

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes++;

    const geometry = mesh.geometry;
    const index = geometry.getIndex();
    const position = geometry.getAttribute('position');
    triangles += index ? index.count / 3 : (position?.count ?? 0) / 3;

    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      const map = (material as THREE.MeshStandardMaterial).map;
      if (map?.image) textures.add(`${map.image.width}x${map.image.height}`);
    }
  });

  _box.setFromObject(root);
  _box.getSize(_size);

  return {
    triangles: Math.round(triangles),
    meshes,
    materials: materials.size,
    textures: [...textures],
    size: { x: +_size.x.toFixed(3), y: +_size.y.toFixed(3), z: +_size.z.toFixed(3) },
  };
}
