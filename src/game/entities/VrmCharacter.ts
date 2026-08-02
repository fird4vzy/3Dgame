import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import type { LoadedCharacter, LocomotionSample } from '@engine/character/CharacterFactory';
import type { CharacterDefinition, ClipName } from '@engine/character/CharacterDefinition';
import { POSES, CLIP_POSE, type Pose } from './CourierAnimator';
import {
  airPose,
  armSwing,
  hipAmplitude,
  hipDrop,
  lateralShift,
  legPose,
  nearestFootfall,
  phaseAdvance,
  stanceFraction,
  stanceTravel,
  wrapPhase,
  type FootGeometry,
} from './gait';

const damp = (a: number, b: number, rate: number, dt: number): number =>
  a + (b - a) * (1 - Math.exp(-rate * dt));

const _delta = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _forward = new THREE.Vector3();
const _localUp = new THREE.Vector3();
const _cross = new THREE.Vector3();
const _bonePos = new THREE.Vector3();
const _footPos = new THREE.Vector3();
const _kneePos = new THREE.Vector3();
const _toePos = new THREE.Vector3();

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

/**
 * Sign that flexes a **hip** forward — the opposite of `S`.
 *
 * A thigh hangs down from the hip and a shin folds back from the knee, so the
 * rotation that swings one forward is the rotation that folds the other. They
 * cannot share a sign, and for a long time they did.
 *
 * A symmetric sine wave hides this completely: mirror a sine walk and you get
 * a sine walk. It only became visible once the cycle had a real stance and a
 * real swing, at which point the character was unmistakably moonwalking — the
 * planted foot travelling *forwards* under a body moving forwards. Found by
 * measuring foot travel per frame in `tools/shoot-gait.mjs`, not by eye.
 */
const HIP = -S;

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

  /** Gait phase, in turns. 0 is left heel strike. */
  private phase = 0;
  private carrying = false;
  private hipRestY = 0;
  private hipRestX = 0;

  /** Seconds since the current clip started, for phased jump and land. */
  private clipTime = 0;

  // ── locomotion, as measured rather than assumed ─────────────────────────
  private motion: LocomotionSample = {
    speed: 0,
    verticalSpeed: 0,
    grounded: true,
    turnRate: 0,
  };
  /** Smoothed gait amplitude, 0 at a standstill through 1 at a full run. */
  private effort = 0;
  /** Smoothed airborne weight, so take-off and landing blend rather than cut. */
  private airborne = 0;
  /** Smoothed bank angle for turning. */
  private bank = 0;
  /** Hip-to-ankle distance, measured from the rig. Sets the stride reach. */
  private legLength = 0.85;
  /** Segment lengths, measured from the rig. The sole is what touches ground. */
  private readonly foot: FootGeometry = {
    thighLength: 0.44,
    shinLength: 0.41,
    toeLength: 0.15,
    heelLength: 0.07,
  };
  /** This frame's gait shape, kept so the pelvis can be placed from it. */
  private legAmp = 0;
  /** Smoothed ground speed. Shapes the pose; never the phase. See `update`. */
  private speed = 0;
  private stance = 0.62;
  /** Peak downward speed since leaving the ground, so landings scale with the drop. */
  private fallSpeed = 0;
  /** Strength of the current landing absorb, 0..1. */
  private landForce = 0;

  private readonly prevForward = new THREE.Vector3();
  private hasPrevForward = false;

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

    // Measure the leg rather than assuming it. `hipAmplitude` inverts the
    // step-length relationship using this, so a mis-measured leg is a
    // mis-matched stride — and the whole point of deriving amplitude is that
    // swapping in a character of a different height still walks correctly.
    const thigh = this.bones.get('leftUpperLeg');
    const shin = this.bones.get('leftLowerLeg');
    const ankle = this.bones.get('leftFoot');
    const toes = this.bones.get('leftToes');
    if (thigh && shin && ankle) {
      vrm.scene.updateWorldMatrix(true, true);
      thigh.getWorldPosition(_bonePos);
      shin.getWorldPosition(_kneePos);
      ankle.getWorldPosition(_footPos);
      const upper = _bonePos.distanceTo(_kneePos);
      const lower = _kneePos.distanceTo(_footPos);
      if (upper > 0.05 && lower > 0.05) {
        this.foot.thighLength = upper;
        this.foot.shinLength = lower;
        this.legLength = upper + lower;
      }
      if (toes) {
        toes.getWorldPosition(_toePos);
        const span = _footPos.distanceTo(_toePos);
        if (span > 0.02) {
          this.foot.toeLength = span;
          // Roughly half the forefoot again, behind the ankle.
          this.foot.heelLength = span * 0.45;
        }
      }
    }

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

    // Scale the absorb to the drop that caused it, then clear the meter.
    if (clip === 'land') {
      this.landForce = Math.max(0.25, Math.min(1, this.fallSpeed / 9));
      this.fallSpeed = 0;
    }

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

  /** Feed the rig this frame's real motion. See `gait.ts` for why it matters. */
  setLocomotion(sample: LocomotionSample): void {
    this.motion = sample;
  }

  update(dt: number): void {
    this.clipTime += dt;

    const rate = 9;
    const c = this.current;
    const p = this.pose;
    // The pose table no longer owns the gait — `stride`, `legSwing` and
    // `armSwing` are measured from the body now. What it still owns is
    // everything that is a *stance* rather than a cycle: elbow bend, torso
    // lean, shoulder lift. Those are what makes a glide look like a glide.
    c.elbow = damp(c.elbow, p.elbow, rate, dt);
    c.lean = damp(c.lean, p.lean, rate, dt);
    c.bob = damp(c.bob, p.bob, rate, dt);
    c.shoulder = damp(c.shoulder, p.shoulder, rate, dt);

    const m = this.motion;

    // Gliding is an authored stance, not a fall, so it opts out of the
    // velocity-driven air pose entirely.
    const gliding = this.clip === 'glide' || this.clip === 'glide_in';
    this.airborne = damp(this.airborne, !m.grounded && !gliding ? 1 : 0, 11, dt);
    if (!m.grounded) this.fallSpeed = Math.max(this.fallSpeed, -m.verticalSpeed);

    // ── cadence ──
    //
    // Advance by distance travelled. This is the whole fix for sliding feet:
    // one stride now covers exactly one stride's worth of ground at any speed,
    // including through acceleration.
    //
    // Phase uses the *raw* speed, deliberately: it is an integral, so noise
    // averages out of it and damping here would lose ground-lock.
    if (m.grounded) this.phase = wrapPhase(this.phase + phaseAdvance(m.speed, dt));

    // Everything that shapes the *pose* uses a smoothed speed instead.
    //
    // This is what stopped the shaking. `planarSpeed` comes off a fixed-timestep
    // controller, so between physics ticks it is a held value that jumps, and
    // capsule depenetration makes it noisy tick to tick anyway. Feeding that
    // straight into leg amplitude and pelvis height put the noise directly into
    // her limbs — every frame the stride length and hip height twitched, and she
    // visibly trembled while walking. A pose is a shape, not a measurement; it
    // wants the trend, not the sample.
    this.speed = damp(this.speed, m.grounded ? m.speed : 0, 9, dt);
    const speed = this.speed;

    // Coming to a stop, settle onto the nearer double-support moment rather
    // than fading out mid-swing with one leg hanging.
    if (m.grounded && speed < 0.4) {
      this.phase = damp(this.phase, nearestFootfall(this.phase), 7, dt);
    }

    // Effort fades the cycle out at a crawl. Below 0.6 m/s the residual slide
    // is a few centimetres a second, which nobody can see; above it the legs
    // are geometrically locked to the ground.
    const wanted = m.grounded ? Math.min(1, speed / 0.6) : 0;
    this.effort = damp(this.effort, wanted, 12, dt);

    // Amplitude is derived from the ground the foot has to cover, not read
    // from a table, so reach and cadence always agree — and the same code
    // fits a character of any height.
    this.stance = stanceFraction(speed);
    this.legAmp = hipAmplitude(stanceTravel(speed), this.legLength) * this.effort;
    // Arm swing is smaller than it looks like it should be. Most of the
    // apparent reach of a swinging arm is the elbow, not the shoulder, and
    // driving the shoulder hard instead gives the straight-armed march the
    // first pass had.
    const armAmp = 0.17 + 0.28 * Math.min(1, speed / 5.2);

    this.trackTurn(dt);
    this.poseLegs(this.legAmp, this.effort, this.stance);
    this.poseArms(armAmp * this.effort, c);
    this.poseSpine(c, this.effort);
    this.poseLanding();
    this.updateFace(dt);

    // Everything the VRM needs, **except** springbones.
    //
    // Springbone physics assumes a world with one fixed "down" and a character
    // whose root does not rotate much. This game breaks both: down is toward
    // the planet centre and changes continuously, and the root is re-oriented
    // to the surface normal every frame. The simulation reads that as violent
    // motion and answers by flinging every hair strand outward into a spiked
    // crown. Re-pointing gravity per joint and giving them a `center` improved
    // it but did not fix it.
    //
    // So the hair sits in its authored rest pose instead. Static hair that
    // hangs correctly beats dynamic hair that looks broken, and this is the
    // honest trade until the springbone solver can be run in the character's
    // local frame properly.
    this.vrm.humanoid?.update();
    this.vrm.expressionManager?.update();
    this.vrm.lookAt?.update(dt);
  }

  /**
   * Legs: the ground cycle and the air pose, blended by how airborne she is.
   *
   * The sole is kept level by countering the accumulated chain rotation
   * (`-thigh - knee`) before the ankle's own action is added on top. Without
   * that the foot pivots rigidly with the shin and the character skates.
   */
  private poseLegs(legAmp: number, gaitWeight: number, stance: number): void {
    const air = airPose(this.motion.verticalSpeed);
    const a = this.airborne;

    const leg = (side: 'left' | 'right', offset: number, lead: number): void => {
      const g = legPose(this.phase + offset, legAmp, stance);

      let thigh = g.thigh;
      let knee = g.knee;
      let ankle = g.ankle;

      if (a > 0.001) {
        // Tuck under the body at the apex, reach for the ground on the way
        // down — and let one leg lead, because two legs doing exactly the same
        // thing is what makes a jump read as a mannequin being lifted.
        const airThigh = air.tuck * 0.9 + air.reach * (0.35 + lead * 0.3);
        const airKnee = air.tuck * 1.3 + air.reach * (0.35 - lead * 0.2);
        const airAnkle = air.tuck * 0.2 - air.reach * 0.35;

        thigh = thigh + (airThigh - thigh) * a;
        knee = knee + (airKnee - knee) * a;
        ankle = ankle + (airAnkle - ankle) * a;
      }

      // Pitch accumulated down the chain by the time it reaches the ankle.
      // Cancelling it is what keeps the sole level through the stance instead
      // of pivoting rigidly with the shin.
      const chain = HIP * thigh + S * knee;

      this.rotate(`${side}UpperLeg` as BoneName, HIP * thigh, 0, 0);
      this.rotate(`${side}LowerLeg` as BoneName, S * knee, 0, 0);
      this.rotate(`${side}Foot` as BoneName, -chain + S * ankle, 0, 0);
      // Toes only articulate for the toe-off push, and only on the ground.
      this.rotate(`${side}Toes` as BoneName, S * Math.max(0, ankle) * 0.7 * gaitWeight, 0, 0);
    };

    leg('left', 0, 1);
    leg('right', 0.5, -1);
  }

  /**
   * Arms, swinging from a lowered rest.
   *
   * Identity for a VRM humanoid is a T-pose, so "no rotation" means arms
   * straight out — everything here is relative to a 72° drop. The elbow bends
   * *more* on the forward swing than the back, which is what real arms do and
   * is most of the difference between a swing and a pendulum.
   */
  private poseArms(armAmp: number, c: Pose): void {
    const armIn = 0.12;
    const air = airPose(this.motion.verticalSpeed);
    const a = this.airborne;

    const arm = (side: 'left' | 'right', offset: number, sign: number): void => {
      const s = armSwing(this.phase + offset);
      let shoulderPitch = s * armAmp + c.shoulder;
      // Forward swing (negative pitch here) gets extra bend.
      // The elbow folds much harder on the forward swing than the back, which
      // is what real arms do and is most of the difference between a swing and
      // a pendulum.
      let bend = c.elbow - Math.max(0, -s) * (0.5 + armAmp * 1.6);
      let out = ARM_DOWN + armIn;

      if (a > 0.001) {
        // Leaving the ground, the arms trail back and down behind the leap.
        // Coming down, they come *out to the sides* to balance.
        //
        // The `z` term is what actually raises an arm — pitch alone only
        // swings it fore and aft, so driving pitch forward to "lift" the arms
        // put them straight out in front like a sleepwalker, which is exactly
        // how the first jump read.
        const airPitch = 0.5 * air.rise - 0.12 * air.fall;
        const airBend = -0.3 - 0.4 * air.fall;
        const airOut = ARM_DOWN + armIn - 0.8 * air.fall - 0.18 * air.rise;
        shoulderPitch = shoulderPitch + (airPitch - shoulderPitch) * a;
        bend = bend + (airBend - bend) * a;
        out = out + (airOut - out) * a;
      }

      this.rotate(`${side}UpperArm` as BoneName, S * shoulderPitch, 0, sign * out);
      this.rotate(`${side}LowerArm` as BoneName, S * bend, 0, 0);
      // A relaxed wrist, following the forearm a beat late.
      this.rotate(`${side}Hand` as BoneName, S * bend * 0.25, 0, 0);
    };

    // The left arm swings against the left leg, so it shares its phase.
    arm('left', 0, 1);
    arm('right', 0.5, -1);

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
  private poseSpine(c: Pose, gaitWeight: number): void {
    const shift = lateralShift(this.phase);
    const pelvisYaw = shift * 0.16 * gaitWeight;

    // Lean into speed on top of whatever the current stance asks for. A run
    // that stands as upright as a walk is the giveaway that the lean is a
    // constant rather than a response.
    const speedLean = Math.min(1, this.speed / 5.2) * 0.16 * (1 - this.airborne);
    const lean = c.lean + speedLean;

    this.rotate('hips', 0, pelvisYaw, this.bank * 0.35);
    this.rotate('spine', S * lean * 0.35, -pelvisYaw * 0.5, this.bank * 0.3);
    this.rotate('chest', S * lean * 0.45, -pelvisYaw * 0.8, this.bank * 0.25);
    this.rotate('upperChest', S * lean * 0.2, -pelvisYaw * 0.4, 0);
    // Head counter-rotates the whole chain, so the gaze stays forward and
    // steady rather than swaying with the shoulders, and tips into the turn.
    this.rotate('neck', S * -lean * 0.5, pelvisYaw * 0.6 + this.bank * 0.5, -this.bank * 0.25);

    const hips = this.bones.get('hips');
    if (!hips) return;

    // Put the pelvis where the legs need it, rather than on a decorative sine.
    // This is what makes the feet actually reach the floor at full stride, and
    // the rise and fall it produces is the real one — see `hipDrop`.
    const drop = hipDrop(this.phase, this.legAmp, this.stance, this.foot);
    hips.position.y =
      this.hipRestY - drop * (1 - this.airborne) + c.bob * Math.max(0, 1 - gaitWeight);
    // Lateral weight shift toward the standing leg.
    hips.position.x = this.hipRestX + shift * 0.026 * gaitWeight;
  }

  /**
   * Measure how fast she is turning, for the bank.
   *
   * Taken from the root's own world orientation rather than plumbed in from the
   * controller: travelling forward on a sphere rotates the body about its right
   * axis, so the component about its *up* axis is genuine steering and nothing
   * else. Leaning into a turn is a small thing that reads as weight.
   */
  private trackTurn(dt: number): void {
    this.object3D.getWorldQuaternion(_worldQuat);
    _forward.set(0, 0, 1).applyQuaternion(_worldQuat);
    _localUp.set(0, 1, 0).applyQuaternion(_worldQuat);

    let rate = 0;
    if (this.hasPrevForward && dt > 1e-5) {
      _cross.copy(this.prevForward).cross(_forward);
      rate = Math.atan2(_cross.dot(_localUp), this.prevForward.dot(_forward)) / dt;
    }
    this.prevForward.copy(_forward);
    this.hasPrevForward = true;

    // Only bank when actually travelling — spinning on the spot should not
    // tip her over.
    const wanted = Math.max(-0.35, Math.min(0.35, rate * 0.12)) * this.effort;
    this.bank = damp(this.bank, wanted, 6, dt);
  }

  /**
   * The landing absorb.
   *
   * Everything else about being in the air is now a function of vertical
   * velocity (see `airPose`), which is why the jump no longer plays the same
   * canned arc whether you hopped off a kerb or fell off a cliff. But the
   * absorb *is* genuinely a timed event — it starts at the instant of contact
   * and recovers over about a third of a second — so this one stays on a clock.
   *
   * Its strength scales with how hard she hit. A gentle step down should not
   * play the same crumple as a long drop; that mismatch is most of what made
   * landings look wrong even once the arc was right.
   */
  private poseLanding(): void {
    if (this.clip !== 'land') return;

    const absorb = Math.max(0, 1 - this.clipTime * 3.2) * this.landForce;
    if (absorb <= 0.001) return;

    // Hips flex forward, knees fold, and the sole stays flat on the ground it
    // just hit — the same chain cancellation the walk uses.
    const thigh = 0.55 * absorb;
    const knee = 0.95 * absorb;
    const chain = HIP * thigh + S * knee;
    for (const side of ['left', 'right'] as const) {
      this.rotate(`${side}UpperLeg` as BoneName, HIP * thigh, 0, 0);
      this.rotate(`${side}LowerLeg` as BoneName, S * knee, 0, 0);
      this.rotate(`${side}Foot` as BoneName, -chain, 0, 0);
    }
    // Arms come forward and down to catch the weight.
    this.rotate('leftUpperArm', S * -0.35 * absorb, 0, ARM_DOWN + 0.12 - 0.25 * absorb);
    this.rotate('rightUpperArm', S * -0.35 * absorb, 0, -(ARM_DOWN + 0.12 - 0.25 * absorb));

    this.rotate('spine', S * 0.22 * absorb, 0, 0);

    const hips = this.bones.get('hips');
    if (hips) hips.position.y = this.hipRestY - 0.11 * absorb;
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

  /** Current gait phase in turns, for tooling. */
  get gaitPhase(): number {
    return this.phase;
  }

  /**
   * A posed bone, for tooling.
   *
   * `tools/gait-preview.html` measures foot travel through stance to prove the
   * feet are not sliding — a thing screenshots cannot show and unit tests
   * cannot reach, because it needs a real skeleton. Read-only by nature: the
   * caller gets the node the rig already poses, and posing it back would simply
   * be overwritten next frame.
   */
  getBone(name: string): THREE.Object3D | null {
    return this.bones.get(name as BoneName) ?? null;
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
