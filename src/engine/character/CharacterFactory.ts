import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BillboardCharacter } from './BillboardCharacter';
import { ClipResolver } from './ClipResolver';
import {
  validateCharacterDefinition,
  type CharacterDefinition,
  type ClipName,
} from './CharacterDefinition';

/**
 * A loaded character, whatever form its art arrived in.
 *
 * Gameplay code drives this interface and never learns whether it is animating
 * a rigged mesh or flipping through sprite frames — which is the whole point of
 * the character contract.
 */
export interface LoadedCharacter {
  readonly definition: CharacterDefinition;
  readonly object3D: THREE.Object3D;
  /** Play a canonical clip; unknown clips resolve through the fallback chain. */
  play(clip: ClipName, restart?: boolean): void;
  update(dt: number): void;
  /** Orient for rendering. `facing` is the character's own forward direction. */
  lateUpdate(camera: THREE.Camera, facing?: THREE.Vector3): void;
  /** Attach an object to a named socket, if the character exposes one. */
  getSocket(name: string): THREE.Object3D | null;
  /** Tint to match local lighting. A no-op for lit (mesh) characters. */
  setTint?(colour: THREE.Color): void;
  dispose(): void;
}

class SpriteCharacter implements LoadedCharacter {
  private readonly billboard: BillboardCharacter;

  constructor(
    readonly definition: CharacterDefinition,
    texture: THREE.Texture,
  ) {
    if (definition.source.kind !== 'spritesheet') {
      throw new Error('SpriteCharacter requires a spritesheet source');
    }
    this.billboard = new BillboardCharacter({
      source: definition.source,
      texture,
      height: definition.height,
    });
  }

  get object3D(): THREE.Object3D {
    return this.billboard.object3D;
  }

  play(clip: ClipName, restart = false): void {
    const source = this.definition.source;
    if (source.kind !== 'spritesheet') return;

    if (source.animations?.[clip]) {
      this.billboard.play(clip, restart);
      return;
    }
    // Fall back to a substitute so a partial sheet still animates.
    const substitute = this.definition.fallback?.clips?.[clip];
    if (substitute && source.animations?.[substitute]) {
      this.billboard.play(substitute, restart);
    }
  }

  update(dt: number): void {
    this.billboard.update(dt);
  }

  lateUpdate(camera: THREE.Camera, facing?: THREE.Vector3): void {
    this.billboard.faceCamera(camera, undefined, facing);
  }

  getSocket(): THREE.Object3D | null {
    // A flat sprite has no skeleton, so nothing can be parented to it in a way
    // that survives the turnaround. Carried props are drawn into the art.
    return null;
  }

  setTint(colour: THREE.Color): void {
    this.billboard.setTint(colour);
  }

  dispose(): void {
    this.billboard.dispose();
  }
}

class MeshCharacter implements LoadedCharacter {
  private readonly mixer: THREE.AnimationMixer;
  private readonly clips = new Map<string, THREE.AnimationClip>();
  private readonly resolver: ClipResolver;
  private current: THREE.AnimationAction | null = null;

  constructor(
    readonly definition: CharacterDefinition,
    readonly object3D: THREE.Object3D,
    clips: THREE.AnimationClip[],
  ) {
    this.mixer = new THREE.AnimationMixer(object3D);
    for (const clip of clips) this.clips.set(clip.name, clip);
    this.resolver = new ClipResolver(definition, new Set(this.clips.keys()));
  }

  play(clip: ClipName, restart = false): void {
    const resolved = this.resolver.resolve(clip);
    if (!resolved) return;

    const animation = this.clips.get(resolved.sourceName);
    if (!animation) return;

    const next = this.mixer.clipAction(animation);
    if (next === this.current && !restart) return;

    next.reset().play();
    if (this.current && this.current !== next) {
      // Cross-fade rather than cut; 0.18s reads as smooth without feeling soft.
      this.current.crossFadeTo(next, 0.18, false);
    }
    this.current = next;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  lateUpdate(): void {
    // A rigged mesh is oriented by the character controller itself.
  }

  getSocket(name: string): THREE.Object3D | null {
    const bone = this.definition.sockets?.[name as 'hand_R'];
    if (!bone) return null;
    return this.object3D.getObjectByName(bone) ?? null;
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
}

const textureLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();

/**
 * Build a character from its manifest.
 *
 * Supplying new character art is a manifest edit: this function is the only
 * place that knows the difference between a rigged glTF and a sprite atlas.
 */
export async function loadCharacter(
  definition: CharacterDefinition,
  baseUrl = '',
): Promise<LoadedCharacter> {
  const problems = validateCharacterDefinition(definition);
  if (problems.length > 0) {
    throw new Error(`[Character] "${definition.id}" manifest is invalid:\n  ${problems.join('\n  ')}`);
  }

  const url = `${baseUrl}${definition.source.url}`;

  if (definition.source.kind === 'spritesheet') {
    const texture = await textureLoader.loadAsync(url);
    return new SpriteCharacter(definition, texture);
  }

  const gltf = await gltfLoader.loadAsync(url);
  const root = gltf.scene;

  const source = definition.source;
  if (source.scale && source.scale !== 1) root.scale.setScalar(source.scale);
  if (source.yawOffset) root.rotation.y = (source.yawOffset * Math.PI) / 180;
  if (source.yOffset) root.position.y = source.yOffset;

  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  return new MeshCharacter(definition, root, gltf.animations);
}
