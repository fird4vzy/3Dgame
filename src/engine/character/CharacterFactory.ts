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
 * How the body is actually moving this frame.
 *
 * A clip name says *what* the character is doing; this says how hard. Rigs that
 * generate their animation need it to lock cadence to ground speed and to shape
 * a jump around its real arc — without it they can only guess, and a guessed
 * cadence is what makes feet slide. Sampled-clip rigs use the speed to set
 * the playback rate of walk and run clips for the same reason.
 */
export interface LocomotionSample {
  /** Speed across the surface, m/s. */
  speed: number;
  /** Speed along the local up axis; positive is rising. */
  verticalSpeed: number;
  grounded: boolean;
  /** Signed yaw rate about the character's own up axis, rad/s. Positive turns left. */
  turnRate: number;
}

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
  /** Optional: feed the rig this frame's motion. Ignored by clip-driven rigs. */
  setLocomotion?(sample: LocomotionSample): void;
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

/** Canonical clips that loop; everything else plays once and holds its last pose. */
const LOOPING = new Set<ClipName>(['idle', 'idle_look', 'walk', 'run', 'glide', 'carry_idle', 'carry_walk', 'carry_run', 'sit', 'fall']);
/** Clips whose own rise must not stack on the controller's real jump. */
const AIRBORNE = new Set<ClipName>(['jump_start', 'fall', 'land']);
/** Clips whose playback rate follows ground speed. */
const WALKING = new Set<ClipName>(['walk', 'run', 'carry_walk', 'carry_run']);

const _scale = new THREE.Vector3();

/**
 * Make a captured clip play in place, and measure how fast it was walking.
 *
 * Library clips are recorded walking across a stage: the hips travel. Played
 * on a character the controller is already moving, that travel is added on
 * top — she drifts ahead of her own body and snaps back every loop. So the
 * hips' horizontal drift is removed (linearly, which keeps the side-to-side
 * sway), and what was removed tells us the clip's native ground speed, in
 * the hips' parent space.
 *
 * Jumps are the vertical version of the same problem: the controller does
 * the real jump, so the clip's own rise above standing height is clipped off,
 * keeping the crouch before and the absorption after.
 */
export function prepareClip(clip: THREE.AnimationClip, hipsName: string, airborne: boolean): number {
  const track = clip.tracks.find((t) => t.name === `${hipsName}.position`);
  if (!track || track.values.length < 6) return 0;
  const v = track.values;
  const times = track.times;
  const count = times.length;
  const duration = Math.max(1e-3, times[count - 1]! - times[0]!);
  const dx = v[(count - 1) * 3]! - v[0]!;
  const dz = v[(count - 1) * 3 + 2]! - v[2]!;
  const standY = v[1]!;
  for (let i = 0; i < count; i++) {
    const f = (times[i]! - times[0]!) / duration;
    v[i * 3] = v[i * 3]! - dx * f;
    v[i * 3 + 2] = v[i * 3 + 2]! - dz * f;
    if (airborne) v[i * 3 + 1] = Math.min(v[i * 3 + 1]!, standY);
  }
  return Math.hypot(dx, dz) / duration;
}

class MeshCharacter implements LoadedCharacter {
  private readonly mixer: THREE.AnimationMixer;
  private readonly clips = new Map<string, THREE.AnimationClip>();
  /** Native ground speed of each source clip, in the hips' parent space. */
  private readonly nativeSpeed = new Map<string, number>();
  private readonly resolver: ClipResolver;
  private readonly hips: THREE.Object3D | null;
  private current: THREE.AnimationAction | null = null;
  private currentSource = '';
  private currentRole: ClipName = 'idle';
  private speed = 0;

  constructor(
    readonly definition: CharacterDefinition,
    readonly object3D: THREE.Object3D,
    clips: THREE.AnimationClip[],
  ) {
    this.mixer = new THREE.AnimationMixer(object3D);
    // The root of the skeleton: the first bone under the model.
    this.hips = object3D.getObjectByProperty('isBone', true) ?? null;

    // Which source clips play which canonical role, to know how to prepare them.
    const roles = new Map<string, ClipName>();
    for (const [ours, theirs] of Object.entries(definition.clips ?? {})) {
      if (theirs) roles.set(theirs, ours as ClipName);
    }
    for (const clip of clips) {
      this.clips.set(clip.name, clip);
      if (this.hips) {
        const role = roles.get(clip.name);
        prepareClip(clip, this.hips.name, role !== undefined && AIRBORNE.has(role));
        // Speed from the planted foot, always: clips delivered in place have
        // no travel to measure, and a clip that did travel is in place by now.
        // (The hips' drift is no guide either way — a run's half-centimetre of
        // wobble per loop once read as its speed and played it flat out.)
        if (role !== undefined && WALKING.has(role)) {
          const speed = this.measureStance(clip);
          if (speed > 0) this.nativeSpeed.set(clip.name, speed);
        }
      }
    }
    this.resolver = new ClipResolver(definition, new Set(this.clips.keys()));
  }

  /**
   * Ground speed of an in-place walk or run, from its feet.
   *
   * While a foot is planted it slides backward under the hips at exactly the
   * speed the body would be moving forward — that is what planted means. So
   * the clip is sampled, each foot's lowest frames are taken as its stance,
   * and its horizontal speed there is the clip's speed. Measured in the hips'
   * parent space, like the drift-based figure.
   */
  private measureStance(clip: THREE.AnimationClip): number {
    const parent = this.hips?.parent;
    const feet = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase', 'leftFoot', 'rightFoot']
      .map((name) => this.object3D.getObjectByName(name))
      .filter((o): o is THREE.Object3D => !!o)
      .slice(0, 2);
    if (!parent || feet.length < 2) return 0;

    const sampler = new THREE.AnimationMixer(this.object3D);
    const action = sampler.clipAction(clip);
    action.play();
    const steps = 48;
    const track = feet.map(() => [] as THREE.Vector3[]);
    for (let i = 0; i <= steps; i++) {
      sampler.setTime((clip.duration * i) / steps);
      this.object3D.updateMatrixWorld(true);
      feet.forEach((foot, f) => {
        track[f]!.push(parent.worldToLocal(foot.getWorldPosition(new THREE.Vector3())));
      });
    }
    sampler.stopAllAction();
    sampler.uncacheRoot(this.object3D);

    const dt = clip.duration / steps;
    let sum = 0;
    let count = 0;
    for (const points of track) {
      const lowest = Math.min(...points.map((p) => p.y));
      const highest = Math.max(...points.map((p) => p.y));
      const planted = lowest + (highest - lowest) * 0.15;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        if (a.y > planted || b.y > planted) continue;
        sum += Math.hypot(b.x - a.x, b.z - a.z) / dt;
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  play(clip: ClipName, restart = false): void {
    const resolved = this.resolver.resolve(clip);
    if (!resolved) return;

    const animation = this.clips.get(resolved.sourceName);
    if (!animation) return;

    const next = this.mixer.clipAction(animation);
    if (next === this.current && !restart) return;

    const loops = LOOPING.has(resolved.via);
    next.setLoop(loops ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loops;
    next.timeScale = 1;
    next.reset().play();
    if (this.current && this.current !== next) {
      // Cross-fade rather than cut; 0.18s reads as smooth without feeling soft.
      this.current.crossFadeTo(next, 0.18, false);
    }
    this.current = next;
    this.currentSource = resolved.sourceName;
    this.currentRole = resolved.via;
  }

  setLocomotion(sample: LocomotionSample): void {
    this.speed = sample.speed;
  }

  update(dt: number): void {
    // Walk and run clips play at the speed the body is actually moving, so
    // the feet stay planted: a clip recorded at 1.3 m/s and played under a
    // body doing 2.2 m/s would otherwise slide every stance.
    const native = WALKING.has(this.currentRole) ? this.nativeSpeed.get(this.currentSource) : undefined;
    if (this.current && native && this.hips?.parent) {
      const worldNative = native * this.hips.parent.getWorldScale(_scale).x;
      this.current.timeScale = THREE.MathUtils.clamp(this.speed / worldNative, 0.55, 1.9);
    }
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
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // A skinned mesh's bounds are its bind pose, not where the animation put
    // it: a crouch or a reaching arm gets culled at the edge of the frame.
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
    // Same response as the rest of the world: matte, not metal.
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const standard = material as THREE.MeshStandardMaterial;
      if (!standard.isMeshStandardMaterial) continue;
      standard.metalness = Math.min(standard.metalness, 0.1);
      standard.roughness = Math.max(standard.roughness, 0.6);
    }
  });

  return new MeshCharacter(definition, root, gltf.animations);
}
