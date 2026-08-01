import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import type { LoadedCharacter } from '@engine/character/CharacterFactory';
import type { CharacterDefinition, ClipName } from '@engine/character/CharacterDefinition';
import { POSES, CLIP_POSE, type Pose } from './CourierAnimator';

const damp = (a: number, b: number, rate: number, dt: number): number =>
  a + (b - a) * (1 - Math.exp(-rate * dt));

const _delta = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _camPos = new THREE.Vector3();

/**
 * Bones we pose.
 *
 * Beyond the basic chain this adds neck, upper chest, feet and toes — the parts
 * that separate "limbs swinging" from "someone walking". A leg swing with a
 * rigid ankle reads as a doll on a stick.
 */
const BONES = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToes',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToes',
] as const;

type BoneName = (typeof BONES)[number];

/**
 * `rotateVRM0` turns the scene to face +Z, but the normalized bone space it
 * wraps still has forward at −Z. Every pitch is therefore negated relative to
 * the procedural rig — unnegated, the knees hinge the wrong way.
 */
const S = -1;

/** Rotation that brings a T-posed arm down to the side, about Z. */
const ARM_DOWN = 1.25;

export class VrmCharacter implements LoadedCharacter {
  readonly definition: CharacterDefinition;
  readonly object3D: THREE.Object3D;

  private readonly vrm: VRM;
  private readonly bones = new Map<BoneName, THREE.Object3D>();
  private readonly rest = new Map<BoneName, THREE.Quaternion>();
  private readonly baseColours = new Map<THREE.Material, THREE.Color>();

  private clip: ClipName = 'idle';
  private pose: Pose = POSES.idle!;
  private current: Pose = { ...POSES.idle! };

  private phase = 0;
  private carrying = false;
  private hipRestY = 0;
  private hipRestX = 0;

  /** Seconds since the current clip started, for phased jump and land. */
  private clipTime = 0;

  // ── face ────────────────────────────────────────────────────────────────
  private blinkTimer = 1 + Math.random() * 3;
  private blinkValue = 0;
  /** Target and smoothed value for the emotional expression. */
  private expression: 'neutral' | 'happy' | 'relaxed' | 'sad' = 'neutral';
  private expressionValue = 0;
  private expressionHold = 0;

  /** What the eyes track. Parented to the scene, moved to the camera. */
  private readonly lookTarget = new THREE.Object3D();

  private constructor(vrm: VRM, displayName: string, height: number) {
    this.vrm = vrm;
    this.object3D = vrm.scene;

    for (const name of BONES) {
      const bone = vrm.humanoid?.getNormalizedBoneNode(name) ?? null;
      if (!bone) continue;
      this.bones.set(name, bone);
      this.rest.set(name, bone.quaternion.clone());
    }

    const hips = this.bones.get('hips');
    this.hipRestY = hips?.position.y ?? 0;
    this.hipRestX = hips?.position.x ?? 0;

    // Eyes track a target we move to the camera each frame. VRM look-at drives
    // the eye bones, so she actually meets your gaze rather than staring
    // through you — the cheapest possible "there is someone in there".
    vrm.scene.add(this.lookTarget);
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;

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
        animation: 'No clips in the file; locomotion, face and gaze are all generated.',
      },
    };
  }

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

      VRMUtils.rotateVRM0(vrm);
      // Only the optimisation that does not rewrite skin weights.
      // `combineSkeletons` and `removeUnnecessaryVertices` shredded the arms.
      VRMUtils.combineMorphs(vrm);

      vrm.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        // Tens of thousands of triangles; the shadow pass roughly doubled its
        // cost for a ground silhouette nobody looks at.
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        // Skinned bounds go stale as bones move.
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

  get height(): number {
    return this.definition.height;
  }

  play(clip: ClipName): void {
    if (this.clip === clip) return;
    this.clip = clip;
    this.clipTime = 0;
    this.carrying = clip.startsWith('carry') || clip === 'handoff';
    this.pose = POSES[CLIP_POSE[clip] ?? 'idle'] ?? POSES.idle!;

    // Landing hard and completing a delivery both deserve a face.
    if (clip === 'land') this.setExpression('relaxed', 0.5);
    if (clip === 'celebrate' || clip === 'emote_cheer') this.setExpression('happy', 2.2);
    if (clip === 'handoff') this.setExpression('happy', 1.6);
  }

  /** Trigger a facial expression for `hold` seconds. */
  setExpression(name: 'neutral' | 'happy' | 'relaxed' | 'sad', hold = 1.5): void {
    this.expression = name;
    this.expressionHold = hold;
  }

  update(dt: number): void {
    this.clipTime += dt;

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
    const opposite = -swing;
    /** 0..1 measure of how much locomotion is happening. */
    const gait = Math.min(1, c.legSwing / 0.5);

    this.poseLegs(swing, opposite, c, gait);
    this.poseArms(swing, opposite, c);
    this.poseSpine(swing, c, gait);
    this.poseAirborne(dt);
    this.updateFace(dt);

    // Springbones (hair, skirt) and eye look-at.
    this.vrm.update(dt);
  }

  /**
   * Legs, with ankles.
   *
   * The ankle is what makes a walk read as a walk: the foot stays roughly
   * parallel to the ground through the stance instead of pivoting rigidly with
   * the shin, and rolls onto the toe as the leg leaves the ground. Without it
   * the character skates, which is exactly what the first pass looked like.
   */
  private poseLegs(swing: number, opposite: number, c: Pose, gait: number): void {
    const leg = (
      side: 'left' | 'right',
      s: number,
    ): void => {
      const thigh = s * c.legSwing;
      // Knee bends only on the backswing, so the foot clears the ground.
      const knee = Math.max(0, -s) * c.legSwing * 1.5;

      this.rotate(`${side}UpperLeg` as BoneName, S * thigh, 0, 0);
      this.rotate(`${side}LowerLeg` as BoneName, S * knee, 0, 0);

      // Counter the limb chain so the sole stays level, then add a toe-off
      // push as the leg swings back behind the body.
      const toeOff = Math.max(0, -s) * 0.35 * gait;
      this.rotate(`${side}Foot` as BoneName, S * (-thigh - knee + toeOff), 0, 0);
      this.rotate(`${side}Toes` as BoneName, S * toeOff * 0.8, 0, 0);
    };

    leg('left', swing);
    leg('right', opposite);
  }

  /**
   * Arms, swinging from a lowered rest.
   *
   * Identity for a VRM humanoid is a T-pose, so "no rotation" means arms
   * straight out — everything here is relative to a 72° drop. The elbow bends
   * *more* on the forward swing than the back, which is what real arms do and
   * is most of the difference between a swing and a pendulum.
   */
  private poseArms(swing: number, opposite: number, c: Pose): void {
    const armIn = 0.12;

    const arm = (side: 'left' | 'right', s: number, sign: number): void => {
      const shoulderPitch = s * c.armSwing + c.shoulder;
      // Forward swing (negative pitch here) gets extra bend.
      const bend = c.elbow - Math.max(0, -s) * c.armSwing * 0.55;

      this.rotate(
        `${side}UpperArm` as BoneName,
        S * shoulderPitch,
        0,
        sign * (ARM_DOWN + armIn),
      );
      this.rotate(`${side}LowerArm` as BoneName, S * bend, 0, 0);
      // A relaxed wrist, following the forearm a beat late.
      this.rotate(`${side}Hand` as BoneName, S * bend * 0.25, 0, 0);
    };

    arm('left', opposite, 1);
    arm('right', swing, -1);

    // Carrying: the right arm comes forward and up to cradle the parcel.
    if (this.carrying) {
      this.rotate('rightUpperArm', S * -1.0, 0, -ARM_DOWN * 0.72);
      this.rotate('rightLowerArm', S * -0.95, 0, 0);
      this.rotate('rightHand', S * -0.2, 0, 0);
    }
  }

  /**
   * Spine, pelvis and head.
   *
   * The three things that turn swinging limbs into a body: the pelvis rotates
   * with the stride, the chest counter-rotates against it, and the head stays
   * level while everything beneath it moves. Real walking is mostly this — the
   * legs are the least interesting part.
   */
  private poseSpine(swing: number, c: Pose, gait: number): void {
    const pelvisYaw = swing * 0.14 * gait;

    this.rotate('hips', 0, pelvisYaw, 0);
    this.rotate('spine', S * c.lean * 0.35, -pelvisYaw * 0.5, 0);
    this.rotate('chest', S * c.lean * 0.45, -pelvisYaw * 0.8, 0);
    this.rotate('upperChest', S * c.lean * 0.2, -pelvisYaw * 0.4, 0);
    // Head counter-rotates the whole chain, so the gaze stays forward and
    // steady rather than swaying with the shoulders.
    this.rotate('neck', S * -c.lean * 0.5, pelvisYaw * 0.6, 0);

    const hips = this.bones.get('hips');
    if (!hips) return;

    // Vertical bob peaks twice per stride, at each mid-stance.
    hips.position.y = this.hipRestY + Math.abs(Math.cos(this.phase)) * c.bob;
    // Lateral weight shift toward the standing leg.
    hips.position.x = this.hipRestX + swing * 0.022 * gait;
  }

  /**
   * Jump and landing, phased over time rather than held as one pose.
   *
   * A single static pose for a whole jump is what makes it read as a puppet
   * being lifted. This tucks the legs at the top of the arc, reaches them out
   * to meet the ground on the way down, and absorbs through the knees on
   * contact.
   */
  private poseAirborne(dt: number): void {
    void dt;
    const t = this.clipTime;

    if (this.clip === 'jump_start') {
      // Extend hard off the ground, arms driving up.
      const drive = Math.max(0, 1 - t * 4);
      for (const side of ['left', 'right'] as const) {
        this.rotate(`${side}UpperLeg` as BoneName, S * -0.25 * drive, 0, 0);
        this.rotate(`${side}LowerLeg` as BoneName, S * 0.35 * drive, 0, 0);
        this.rotate(`${side}Foot` as BoneName, S * 0.45 * drive, 0, 0);
      }
    } else if (this.clip === 'fall' || this.clip === 'glide') {
      // Legs tuck slightly and trail; arms already handled by the pose table.
      for (const side of ['left', 'right'] as const) {
        this.rotate(`${side}UpperLeg` as BoneName, S * 0.18, 0, 0);
        this.rotate(`${side}LowerLeg` as BoneName, S * 0.5, 0, 0);
        this.rotate(`${side}Foot` as BoneName, S * -0.2, 0, 0);
      }
    } else if (this.clip === 'land') {
      // Absorb: deep on contact, recovering over ~0.3 s.
      const absorb = Math.max(0, 1 - t * 3.2);
      for (const side of ['left', 'right'] as const) {
        this.rotate(`${side}UpperLeg` as BoneName, S * 0.5 * absorb, 0, 0);
        this.rotate(`${side}LowerLeg` as BoneName, S * 0.85 * absorb, 0, 0);
        this.rotate(`${side}Foot` as BoneName, S * -0.35 * absorb, 0, 0);
      }
      const hips = this.bones.get('hips');
      if (hips) hips.position.y = this.hipRestY - 0.09 * absorb;
    }
  }

  /**
   * Blinking and expression.
   *
   * Blinking is the single highest-value animation in any character: a face
   * that never blinks reads as dead within about four seconds, and it costs one
   * timer and one blendshape.
   */
  private updateFace(dt: number): void {
    const expressions = this.vrm.expressionManager;
    if (!expressions) return;

    // ── blink ──
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      // Randomised, and occasionally a double blink — a metronome reads as a
      // tic rather than as breathing.
      this.blinkTimer = 1.8 + Math.random() * 4;
      this.blinkValue = 1;
    }
    // Closing is fast, opening slower, which is how eyelids actually move.
    this.blinkValue = Math.max(0, this.blinkValue - dt * 7.5);
    expressions.setValue('blink', Math.min(1, this.blinkValue * 1.6));

    // ── emotion ──
    if (this.expressionHold > 0) {
      this.expressionHold -= dt;
      if (this.expressionHold <= 0) this.expression = 'neutral';
    }
    const target = this.expression === 'neutral' ? 0 : 1;
    this.expressionValue = damp(this.expressionValue, target, 6, dt);

    for (const name of ['happy', 'relaxed', 'sad'] as const) {
      expressions.setValue(name, this.expression === name ? this.expressionValue : 0);
    }
  }

  /** Point the gaze at the camera, so she looks at the player. */
  lateUpdate(camera: THREE.Camera): void {
    camera.getWorldPosition(_camPos);
    this.lookTarget.parent?.worldToLocal(_camPos);
    this.lookTarget.position.copy(_camPos);
  }

  getSocket(name: string): THREE.Object3D | null {
    if (name !== 'hand_R') return null;
    return this.vrm.humanoid?.getNormalizedBoneNode('rightHand') ?? null;
  }

  setTint(colour: THREE.Color): void {
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
}
