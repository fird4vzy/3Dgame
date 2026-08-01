import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import type { LoadedCharacter } from '@engine/character/CharacterFactory';
import type { CharacterDefinition, ClipName } from '@engine/character/CharacterDefinition';
import { POSES, CLIP_POSE, type Pose } from './CourierAnimator';

const damp = (a: number, b: number, rate: number, dt: number): number =>
  a + (b - a) * (1 - Math.exp(-rate * dt));

const _camPos = new THREE.Vector3();
const _selfPos = new THREE.Vector3();
const _delta = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();

/** The humanoid bones we actually pose. VRoid always provides all of them. */
const BONES = [
  'hips',
  'spine',
  'chest',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'rightUpperArm',
  'rightLowerArm',
  'leftUpperLeg',
  'leftLowerLeg',
  'rightUpperLeg',
  'rightLowerLeg',
] as const;

type BoneName = (typeof BONES)[number];

/**
 * A VRM character, driven by the same procedural locomotion as the built-in rig.
 *
 * The important idea: a VRM has **no animation clips**. VRoid exports a rigged
 * mesh and nothing else, so a conventional pipeline would need Mixamo clips
 * bolted on. But this project already generates locomotion from a phase value
 * rather than sampling authored clips, and VRM guarantees a *named humanoid
 * skeleton* — so the existing pose tables map straight onto it and the model
 * walks, runs, jumps and carries with no animation data at all.
 *
 * Two things have to be handled that the built-in rig does not need:
 *
 * 1. **Rest poses.** Our poses are absolute local rotations, which is fine for
 *    a rig we authored at identity. A VRM's bones have their own rest
 *    orientation (VRoid exports an A-pose), so assigning absolute rotations
 *    would flatten the character into a T-pose the moment it loaded. Every
 *    rotation here is applied as a *delta* against the captured rest pose.
 * 2. **Facing.** VRM 0.0 models look down −Z; everything in this game faces
 *    +Z. `VRMUtils.rotateVRM0` bakes the correction in at load.
 */
export class VrmCharacter implements LoadedCharacter {
  readonly definition: CharacterDefinition;
  readonly object3D: THREE.Object3D;

  private readonly vrm: VRM;
  private readonly bones = new Map<BoneName, THREE.Object3D>();
  /** Rest orientation per bone, captured before anything is posed. */
  private readonly rest = new Map<BoneName, THREE.Quaternion>();
  private readonly baseColours = new Map<THREE.Material, THREE.Color>();

  private clip: ClipName = 'idle';
  private pose: Pose = POSES.idle!;
  private current: Pose = { ...POSES.idle! };

  private phase = 0;
  private carrying = false;
  private hipRestY = 0;

  private constructor(vrm: VRM, displayName: string, height: number) {
    this.vrm = vrm;
    this.object3D = vrm.scene;

    for (const name of BONES) {
      const bone = vrm.humanoid?.getNormalizedBoneNode(name) ?? null;
      if (!bone) continue;
      this.bones.set(name, bone);
      this.rest.set(name, bone.quaternion.clone());
    }
    this.hipRestY = this.bones.get('hips')?.position.y ?? 0;

    // Remember material colours so the scene's day/night tint can be applied
    // without compounding every frame.
    vrm.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const withColour = material as THREE.Material & { color?: THREE.Color };
        if (withColour.color && !this.baseColours.has(material)) {
          this.baseColours.set(material, withColour.color.clone());
        }
      }
    });

    this.definition = {
      id: 'aria_vrm',
      displayName,
      height,
      source: { kind: 'gltf', url: 'assets/characters/aria.vrm' },
      notes: {
        origin: 'VRoid Studio export (VRM 0.0).',
        animation: 'No clips in the file; locomotion is generated from the shared pose tables.',
      },
    };
  }

  /**
   * Load a `.vrm`. Resolves to null rather than throwing if anything is wrong,
   * so a bad or missing model leaves the procedural character in place instead
   * of taking the game down.
   */
  static async load(url: string, displayName = 'Aria Chen'): Promise<VrmCharacter | null> {
    try {
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));

      const gltf = await loader.loadAsync(url);
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm) {
        console.warn(`[VRM] ${url} loaded but contains no VRM extension`);
        return null;
      }

      // VRM 0.0 faces -Z; the rest of the game faces +Z.
      VRMUtils.rotateVRM0(vrm);

      // Only the safe optimisation. `combineSkeletons` and
      // `removeUnnecessaryVertices` rewrite skinning data, and on this export
      // they shredded the arms — trailing streaks of stretched geometry
      // following the hands. Unused morph targets are the bulk of a VRoid
      // file's runtime cost anyway, and dropping them touches no skin weights.
      VRMUtils.combineMorphs(vrm);

      vrm.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        // A VRoid body is tens of thousands of triangles. Putting it in the
        // shadow pass as well as the main pass roughly doubles its cost for a
        // silhouette on the ground nobody looks at, and it was most of the
        // stutter. It still *receives* shadows.
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        // Skinned bounds go stale as bones move; without this she vanishes at
        // the screen edge mid-stride.
        mesh.frustumCulled = false;
      });

      _box.setFromObject(vrm.scene);
      _box.getSize(_size);

      return new VrmCharacter(vrm, displayName, _size.y || 1.65);
    } catch (error) {
      console.warn(`[VRM] could not load ${url}`, error);
      return null;
    }
  }

  /** Measured height of the loaded model, in metres. */
  get height(): number {
    return this.definition.height;
  }

  play(clip: ClipName): void {
    if (this.clip === clip) return;
    this.clip = clip;
    this.carrying = clip.startsWith('carry') || clip === 'handoff';
    this.pose = POSES[CLIP_POSE[clip] ?? 'idle'] ?? POSES.idle!;
  }

  update(dt: number): void {
    const rate = 9;
    const c = this.current;
    const p = this.pose;
    c.stride = damp(c.stride, p.stride, rate, dt);
    c.legSwing = damp(c.legSwing, p.legSwing, rate, dt);
    c.armSwing = damp(c.armSwing, p.armSwing, rate, dt);
    c.elbow = damp(c.elbow, p.elbow, rate, dt);
    c.lean = damp(c.lean, p.lean, rate, dt);
    c.bob = damp(c.bob, p.bob, rate, dt);
    c.shoulder = damp(c.shoulder, p.shoulder, rate, dt);

    this.phase += c.stride * dt * Math.PI * 2;
    const swing = Math.sin(this.phase);
    const opposite = Math.sin(this.phase + Math.PI);

    // Legs: opposed swing, knee bending only on the backswing so the foot
    // clears the ground rather than scything through it.
    //
    // Every X rotation is negated relative to the procedural rig. `rotateVRM0`
    // turns the scene to face +Z, but the normalized bone space it wraps still
    // has forward at -Z, so a pitch that swings a limb forward on our own rig
    // swings it backward here. Unnegated, the knees hinged the wrong way and
    // she walked like an ostrich — and jumped with her arms behind her.
    const S = -1;
    this.rotate('leftUpperLeg', S * swing * c.legSwing, 0, 0);
    this.rotate('rightUpperLeg', S * opposite * c.legSwing, 0, 0);
    this.rotate('leftLowerLeg', S * Math.max(0, -swing) * c.legSwing * 1.5, 0, 0);
    this.rotate('rightLowerLeg', S * Math.max(0, -opposite) * c.legSwing * 1.5, 0, 0);

    // Arms counter-swing, from a *lowered* rest.
    //
    // three-vrm's normalized bones have an identity rest pose, and the identity
    // pose for a VRM humanoid is a **T-pose** — arms straight out. So unlike
    // the procedural rig, "no rotation" here means arms horizontal, and the
    // first version of this left her walking around like a scarecrow. In
    // normalized space bringing them down is a rotation about Z of roughly 72°,
    // positive on the left and negative on the right. (Verified by rendering —
    // the opposite sign raises them into a victory pose.)
    const ARM_DOWN = 1.25;
    const armIn = 0.12;
    this.rotate('leftUpperArm', S * (opposite * c.armSwing + c.shoulder), 0, ARM_DOWN + armIn);
    this.rotate('rightUpperArm', S * (swing * c.armSwing + c.shoulder), 0, -ARM_DOWN - armIn);
    this.rotate('leftLowerArm', S * c.elbow, 0, 0);
    this.rotate('rightLowerArm', S * c.elbow, 0, 0);

    // Carrying holds the right arm forward, cradling the parcel.
    if (this.carrying) {
      this.rotate('rightUpperArm', S * -1.0, 0, -ARM_DOWN * 0.75);
      this.rotate('rightLowerArm', S * -0.8, 0, 0);
    }

    // Lean into speed, and bob at twice the stride rate.
    this.rotate('chest', S * c.lean, 0, 0);
    this.rotate('spine', S * c.lean * 0.4, 0, 0);

    const hips = this.bones.get('hips');
    if (hips) hips.position.y = this.hipRestY + Math.abs(Math.cos(this.phase)) * c.bob;

    // Springbones (hair, skirt) and look-at. This is what makes VRoid hair
    // swing when she moves, and it is the main thing a VRM gives us that the
    // procedural rig never could.
    this.vrm.update(dt);
  }

  lateUpdate(): void {}

  getSocket(name: string): THREE.Object3D | null {
    if (name !== 'hand_R') return null;
    return this.vrm.humanoid?.getNormalizedBoneNode('rightHand') ?? null;
  }

  setTint(colour: THREE.Color): void {
    // Same restraint as the procedural rig: a light touch toward the ambient
    // colour, applied from the stored base so it cannot compound.
    for (const [material, base] of this.baseColours) {
      const withColour = material as THREE.Material & { color?: THREE.Color };
      withColour.color?.copy(base).lerp(colour, 0.14);
    }
  }

  dispose(): void {
    VRMUtils.deepDispose(this.vrm.scene);
  }

  /** Apply a rotation as a delta against the bone's captured rest pose. */
  private rotate(name: BoneName, x: number, y: number, z: number): void {
    const bone = this.bones.get(name);
    const rest = this.rest.get(name);
    if (!bone || !rest) return;

    _euler.set(x, y, z, 'XYZ');
    _delta.setFromEuler(_euler);
    bone.quaternion.copy(rest).multiply(_delta);
  }

  /** Not used by the VRM path, but part of the character interface. */
  faceCamera(camera: THREE.Camera): void {
    camera.getWorldPosition(_camPos);
    this.object3D.getWorldPosition(_selfPos);
  }
}
