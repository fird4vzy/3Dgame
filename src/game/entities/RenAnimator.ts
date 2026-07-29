import * as THREE from 'three';
import type { LoadedCharacter } from '@engine/character/CharacterFactory';
import type { CharacterDefinition, ClipName } from '@engine/character/CharacterDefinition';
import { buildRen, REN_HEIGHT, REN_HIP_Y, type RenRig } from './RenCharacter';

/**
 * Procedural animation for Ren's rig.
 *
 * Locomotion is generated from a single phase value rather than sampled from
 * authored clips: legs swing on a sine, arms counter-swing, the hips bob at
 * twice the stride rate, and the torso leans into speed. That is why walking
 * finally *cycles* — the gap the sprite could never close, and it needs no art
 * at all.
 *
 * Poses are blended toward, never snapped to, so a state change reads as the
 * character shifting rather than teleporting. Every target below is a local
 * rotation in radians; `damp` does the smoothing frame-rate independently.
 */

type Pose = {
  /** Stride frequency in cycles per second. 0 disables limb swing. */
  stride: number;
  /** Peak leg swing, radians. */
  legSwing: number;
  /** Peak arm swing, radians. */
  armSwing: number;
  /** Constant elbow bend. */
  elbow: number;
  /** Forward torso lean. */
  lean: number;
  /** Vertical bob amplitude, metres. */
  bob: number;
  /** Static shoulder lift, radians (used for glide and celebrate). */
  shoulder: number;
};

const POSES: Record<string, Pose> = {
  idle:   { stride: 0,    legSwing: 0,    armSwing: 0,    elbow: -0.18, lean: 0.02, bob: 0.006, shoulder: 0.06 },
  walk:   { stride: 0.92, legSwing: 0.52, armSwing: 0.42, elbow: -0.30, lean: 0.06, bob: 0.022, shoulder: 0 },
  run:    { stride: 1.45, legSwing: 0.86, armSwing: 0.78, elbow: -0.85, lean: 0.22, bob: 0.045, shoulder: 0 },
  jump:   { stride: 0,    legSwing: 0,    armSwing: 0,    elbow: -1.10, lean: -0.10, bob: 0,     shoulder: -0.9 },
  fall:   { stride: 0,    legSwing: 0,    armSwing: 0,    elbow: -0.70, lean: 0.10, bob: 0,     shoulder: -0.5 },
  land:   { stride: 0,    legSwing: 0,    armSwing: 0,    elbow: -0.60, lean: 0.30, bob: 0,     shoulder: 0.3 },
  glide:  { stride: 0,    legSwing: 0,    armSwing: 0,    elbow: -0.08, lean: 0.34, bob: 0,     shoulder: -1.45 },
  carry:  { stride: 0,    legSwing: 0,    armSwing: 0,    elbow: -1.25, lean: 0.03, bob: 0.008, shoulder: -0.45 },
  cheer:  { stride: 0,    legSwing: 0,    armSwing: 0,    elbow: -0.35, lean: -0.06, bob: 0.02, shoulder: -2.5 },
  sit:    { stride: 0,    legSwing: 0,    armSwing: 0,    elbow: -1.4,  lean: 0.25, bob: 0.004, shoulder: 0.2 },
};

/** Canonical clip → pose. Unknown clips fall back to idle. */
const CLIP_POSE: Partial<Record<ClipName, keyof typeof POSES>> = {
  idle: 'idle',
  idle_look: 'idle',
  walk: 'walk',
  run: 'run',
  jump_start: 'jump',
  fall: 'fall',
  land: 'land',
  glide_in: 'glide',
  glide: 'glide',
  glide_out: 'fall',
  carry_idle: 'carry',
  carry_walk: 'walk',
  carry_run: 'run',
  handoff: 'carry',
  sit: 'sit',
  celebrate: 'cheer',
  emote_cheer: 'cheer',
  emote_wave: 'cheer',
  emote_sad: 'sit',
};

/** Frame-rate independent smoothing. */
const damp = (a: number, b: number, rate: number, dt: number): number =>
  a + (b - a) * (1 - Math.exp(-rate * dt));

const _camPos = new THREE.Vector3();
const _selfPos = new THREE.Vector3();
const _toCamera = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tint = new THREE.Color();
const WHITE = new THREE.Color('#ffffff');

export class RenAnimator implements LoadedCharacter {
  readonly definition: CharacterDefinition;
  readonly object3D: THREE.Object3D;

  private readonly rig: RenRig;
  private readonly baseColours = new Map<THREE.Mesh, THREE.Color>();

  private clip: ClipName = 'idle';
  private pose: Pose = POSES.idle!;
  /** Smoothed pose, so state changes blend rather than snap. */
  private current: Pose = { ...POSES.idle! };

  private phase = 0;
  private carrying = false;
  /** Blink and idle look-around timers, so he is never perfectly still. */
  private blinkTimer = 2 + Math.random() * 3;
  private lookTimer = 3 + Math.random() * 4;
  private lookTarget = 0;
  private lookCurrent = 0;

  constructor() {
    this.rig = buildRen();
    this.object3D = this.rig.root;

    for (const m of this.rig.meshes) {
      const material = m.material as THREE.MeshToonMaterial;
      this.baseColours.set(m, material.color.clone());
    }

    this.definition = {
      id: 'ren_cypher_3d',
      displayName: "Ren 'Cypher' Kairo",
      height: REN_HEIGHT,
      source: { kind: 'gltf', url: 'procedural://ren' },
      notes: {
        origin: 'Procedurally rigged from the concept sheet specification.',
        animation: 'Locomotion is generated, not keyframed — so it cycles.',
      },
    };
  }

  play(clip: ClipName): void {
    if (this.clip === clip) return;
    this.clip = clip;
    this.carrying = clip.startsWith('carry') || clip === 'handoff';
    this.pose = POSES[CLIP_POSE[clip] ?? 'idle'] ?? POSES.idle!;
  }

  update(dt: number): void {
    // Blend toward the target pose. 9/s is fast enough to feel responsive and
    // slow enough that a walk→run transition reads as acceleration.
    const rate = 9;
    this.current.stride = damp(this.current.stride, this.pose.stride, rate, dt);
    this.current.legSwing = damp(this.current.legSwing, this.pose.legSwing, rate, dt);
    this.current.armSwing = damp(this.current.armSwing, this.pose.armSwing, rate, dt);
    this.current.elbow = damp(this.current.elbow, this.pose.elbow, rate, dt);
    this.current.lean = damp(this.current.lean, this.pose.lean, rate, dt);
    this.current.bob = damp(this.current.bob, this.pose.bob, rate, dt);
    this.current.shoulder = damp(this.current.shoulder, this.pose.shoulder, rate, dt);

    // Advance the stride. Phase only runs while there is a stride, so stopping
    // leaves the legs where they were rather than snapping to neutral.
    this.phase += this.current.stride * dt * Math.PI * 2;
    const swing = Math.sin(this.phase);
    const swingOpposite = Math.sin(this.phase + Math.PI);

    const { rig, current } = this;

    // Legs: opposed swing, with the knee bending only on the backswing so the
    // foot clears the ground instead of scything through it.
    rig.legL.rotation.x = swing * current.legSwing;
    rig.legR.rotation.x = swingOpposite * current.legSwing;
    rig.shinL.rotation.x = Math.max(0, -swing) * current.legSwing * 1.5;
    rig.shinR.rotation.x = Math.max(0, -swingOpposite) * current.legSwing * 1.5;

    // Arms counter-swing against the legs.
    rig.armL.rotation.x = swingOpposite * current.armSwing + current.shoulder;
    rig.armR.rotation.x = swing * current.armSwing + current.shoulder;
    rig.armL.rotation.z = 0.08;
    rig.armR.rotation.z = -0.08;
    rig.forearmL.rotation.x = current.elbow;
    rig.forearmR.rotation.x = current.elbow;

    // Gliding spreads the arms wide rather than swinging them.
    if (this.clip === 'glide' || this.clip === 'glide_in') {
      rig.armL.rotation.z = damp(rig.armL.rotation.z, 1.25, rate, dt);
      rig.armR.rotation.z = damp(rig.armR.rotation.z, -1.25, rate, dt);
    }

    // Carrying holds the right arm forward, cradling the parcel.
    if (this.carrying) {
      rig.armR.rotation.x = damp(rig.armR.rotation.x, -1.05, rate, dt);
      rig.forearmR.rotation.x = damp(rig.forearmR.rotation.x, -0.75, rate, dt);
      rig.armR.rotation.z = damp(rig.armR.rotation.z, -0.28, rate, dt);
    }

    // Hips bob at twice the stride rate — one dip per footfall, not per cycle.
    rig.hips.position.y = REN_HIP_Y - Math.abs(Math.cos(this.phase)) * current.bob;
    rig.hips.rotation.y = swing * current.legSwing * 0.12;

    // Torso leans into speed and counter-rotates against the hips.
    rig.torso.rotation.x = current.lean;
    rig.torso.rotation.y = -swing * current.armSwing * 0.16;

    this.updateHead(dt, swing, current);
  }

  /**
   * Idle life: a slow look-around and periodic blink.
   *
   * Small, but it is the difference between a character and a mannequin — a
   * figure that is perfectly still reads as broken, not as calm.
   */
  private updateHead(dt: number, swing: number, current: Pose): void {
    const rig = this.rig;

    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = 3 + Math.random() * 5;
      this.lookTarget = (Math.random() - 0.5) * 0.7;
    }
    // The head settles back to centre while moving; glancing about is an
    // idle behaviour.
    const wantLook = current.stride > 0.1 ? 0 : this.lookTarget;
    this.lookCurrent = damp(this.lookCurrent, wantLook, 2.2, dt);

    rig.head.rotation.y = this.lookCurrent;
    rig.head.rotation.x = -current.lean * 0.8 + Math.sin(this.phase * 2) * current.bob * 0.6;
    rig.head.rotation.z = swing * current.armSwing * 0.05;

    this.blinkTimer -= dt;
    let lensScale = 1;
    if (this.blinkTimer <= 0) {
      // A blink is a brief squash of the lenses — cheap, and it reads.
      const t = -this.blinkTimer;
      if (t > 0.14) this.blinkTimer = 2.5 + Math.random() * 4;
      else lensScale = 1 - Math.sin((t / 0.14) * Math.PI) * 0.8;
    }
    for (const lens of rig.lenses) lens.scale.y = lensScale;
  }

  /** A rigged 3D character is oriented by the controller; nothing to do here. */
  lateUpdate(): void {}

  getSocket(name: string): THREE.Object3D | null {
    if (name === 'hand_R') return this.rig.handSocket;
    if (name === 'back') return this.rig.satchel;
    if (name === 'head') return this.rig.head;
    return null;
  }

  /**
   * Tint toward the local light level.
   *
   * A toon material is *lit*, so unlike the sprite this needs almost nothing —
   * scene lighting already darkens him in a dormant district. Multiplying the
   * base colour by a tint (as the sprite path did) compounds two values below 1
   * and turns him into a silhouette, so this is a gentle lerp and nothing more.
   */
  setTint(colour: THREE.Color): void {
    for (const [m, base] of this.baseColours) {
      const material = m.material as THREE.MeshToonMaterial;
      _tint.copy(colour).lerp(WHITE, 0.55);
      material.color.copy(base).lerp(_tint, 0.16);
    }
  }

  /** Keep the lenses facing camera-ward brightness. Optional polish hook. */
  faceCamera(camera: THREE.Camera): void {
    camera.getWorldPosition(_camPos);
    this.object3D.getWorldPosition(_selfPos);
    _up.copy(_selfPos).normalize();
    _toCamera.copy(_camPos).sub(_selfPos).projectOnPlane(_up).normalize();
  }

  dispose(): void {
    this.object3D.traverse((object) => {
      const m = object as THREE.Mesh;
      m.geometry?.dispose?.();
      const material = m.material as THREE.Material | undefined;
      material?.dispose?.();
    });
  }
}
