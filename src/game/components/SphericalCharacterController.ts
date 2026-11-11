import * as THREE from 'three';
import { Component } from '@engine/entity/Entity';
import type { BvhWorld } from '@engine/physics/BvhWorld';
import type { InputManager } from '@engine/input/InputManager';
import type { EventBus } from '@core/events/EventBus';
import { tuning } from '@config/tuning';
import { GRAVITY, PLAYER_HEIGHT, PLAYER_RADIUS } from '@config/constants';
import { PlanetTerrain } from '@game/world/PlanetTerrain';
import { stepLength } from '@game/entities/gait';
import { computeMovementBasis, inputToWorld } from './movementBasis';

export type LocomotionState = 'idle' | 'walking' | 'running' | 'jumping' | 'falling' | 'landing';

// Hot-path scratch. Nothing here escapes a single fixedUpdate call.
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _horizontal = new THREE.Vector3();
const _vertical = new THREE.Vector3();
const _capsuleStart = new THREE.Vector3();
const _capsuleEnd = new THREE.Vector3();
const _prevPosition = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();
const _lookMatrix = new THREE.Matrix4();
const _rayOrigin = new THREE.Vector3();
const _down = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _camForward = new THREE.Vector3();

export interface ControllerDeps {
  world: BvhWorld;
  input: InputManager;
  bus: EventBus;
  /** Supplies the camera's forward vector so movement is camera-relative. */
  camera: THREE.Object3D;
  /**
   * Preferred source of the movement heading.
   *
   * The camera's own forward vector is a poor reference: when occlusion pulls
   * the arm in tight against a prop the camera ends up close to and below its
   * target, so its direction is nearly parallel to `up` and projecting it onto
   * the tangent plane collapses to noise — movement then jitters or wanders.
   * The follow rig already maintains a stable, parallel-transported heading
   * that is tangent by construction, so use it when one is available.
   */
  heading?: (out: THREE.Vector3) => THREE.Vector3;
  /** Multiplier on walk and run speed — a reward the player has earned. */
  speedScale?: () => number;
}

/**
 * Walking on the outside of a sphere.
 *
 * The whole game rests on this. Every tick we rebuild a local frame from the
 * player's position (`up` always points away from the planet core), map input
 * into the tangent plane, integrate, resolve the capsule against the terrain
 * BVH, snap to the ground, and slerp the character's orientation so its local
 * +Y matches the surface normal.
 *
 * Two details that are not optional:
 *
 * - **Ground snapping** stops the player launching off convex hilltops, which
 *   on a sphere is *every* hilltop.
 * - **Coyote time and jump buffering** are what make the whole thing feel solid
 *   rather than slippery. See docs/03-gameplay-specification.md §3.2.
 */
export class SphericalCharacterController extends Component {
  readonly velocity = new THREE.Vector3();

  grounded = false;
  groundNormal = new THREE.Vector3(0, 1, 0);
  state: LocomotionState = 'idle';

  /**
   * The simulation's own transform, and the one before it.
   *
   * The entity's object3D is what gets *drawn*, so between fixed steps it holds
   * a pose interpolated between these two. It used to hold the raw step: the
   * camera followed a smoothed position while the body was drawn at the last
   * 60 Hz tick, and at any frame rate that is not exactly 60 the two slid
   * against each other — up to nine centimetres, a different amount every
   * frame. That sliding was most of "the movement is not smooth".
   */
  private readonly simPosition = new THREE.Vector3();
  private readonly simQuaternion = new THREE.Quaternion();
  private readonly previousPosition = new THREE.Vector3();
  private readonly previousQuaternion = new THREE.Quaternion();
  private readonly renderPosition = new THREE.Vector3();
  /** What this component last wrote to the object, to notice a teleport. */
  private readonly writtenPosition = new THREE.Vector3();
  private readonly writtenQuaternion = new THREE.Quaternion();

  private timeSinceGrounded = Infinity;
  /** True while a jump is still rising on the press that started it. */
  private jumpHeld = false;
  /** Seconds since take-off, while that is still true. */
  private jumpAge = 0;
  private landingTimer = 0;
  private footstepAccumulator = 0;

  constructor(private readonly deps: ControllerDeps) {
    super();
  }

  override onAttach(): void {
    this.adoptTransform();
    this.groundNormal.copy(this.entity.object3D.position).normalize();
  }

  /**
   * Put the character somewhere else, at once.
   *
   * `forward` faces her along a direction (projected onto the ground there).
   * Nothing is interpolated across the jump and she arrives standing still.
   */
  teleport(position: THREE.Vector3, forward?: THREE.Vector3): void {
    const transform = this.entity.object3D;
    transform.position.copy(position);
    if (forward) {
      _up.copy(position).normalize();
      _forward.copy(forward).projectOnPlane(_up);
      if (_forward.lengthSq() > 1e-8) {
        _forward.normalize();
        _tmp.copy(position).sub(_forward);
        _lookMatrix.lookAt(position, _tmp, _up);
        transform.quaternion.setFromRotationMatrix(_lookMatrix);
      }
    }
    this.velocity.set(0, 0, 0);
    this.adoptTransform();
  }

  /** Planar speed, for animation blending and the run/walk threshold. */
  get planarSpeed(): number {
    _up.copy(this.simPosition).normalize();
    return _horizontal.copy(this.velocity).projectOnPlane(_up).length();
  }

  override fixedUpdate(dt: number): void {
    const transform = this.entity.object3D;
    // The object holds the drawn pose; the step runs on the simulated one.
    if (this.movedExternally()) this.adoptTransform();
    transform.position.copy(this.simPosition);
    transform.quaternion.copy(this.simQuaternion);
    _prevPosition.copy(transform.position);
    this.previousPosition.copy(transform.position);
    this.previousQuaternion.copy(transform.quaternion);

    // 1. Local frame. `up` is the defining quantity of a spherical world.
    _up.copy(transform.position).normalize();

    // 2. Camera-relative tangent basis. Projecting the camera's forward onto the
    //    tangent plane is what makes "W" mean "away from the camera" no matter
    //    where on the sphere the player is standing. The sign convention lives
    //    in computeMovementBasis, where it is unit-tested.
    if (this.deps.heading) this.deps.heading(_camForward);
    else this.deps.camera.getWorldDirection(_camForward);
    const basis = computeMovementBasis(_camForward, _up, _forward, _right);

    // 3. Desired velocity in the tangent plane.
    const move = this.deps.input.getAxis2D('move');
    inputToWorld(move, basis, _wish);
    const inputMagnitude = Math.min(_wish.length(), 1);
    if (inputMagnitude > 1e-4) _wish.normalize();

    const running = this.deps.input.isDown('run');
    const scale = this.deps.speedScale?.() ?? 1;
    const targetSpeed =
      inputMagnitude * (running ? tuning.move.runSpeed : tuning.move.walkSpeed) * scale;

    // 4. Split velocity into tangent and radial parts and accelerate each.
    _horizontal.copy(this.velocity).projectOnPlane(_up);
    _vertical.copy(this.velocity).sub(_horizontal);

    const accel = this.grounded ? tuning.move.groundAccel : tuning.move.airAccel;
    if (inputMagnitude > 1e-4) {
      _tmp.copy(_wish).multiplyScalar(targetSpeed).sub(_horizontal);
      const maxDelta = accel * dt;
      if (_tmp.length() > maxDelta) _tmp.setLength(maxDelta);
      _horizontal.add(_tmp);
    } else if (this.grounded) {
      const friction = tuning.move.groundFriction * dt;
      const speed = _horizontal.length();
      _horizontal.setLength(Math.max(0, speed - friction));
    }

    // 5. Gravity, always toward the core.
    _vertical.addScaledVector(_up, -GRAVITY * dt);
    const fallSpeed = _vertical.dot(_up);
    if (fallSpeed < -tuning.move.maxFallSpeed) {
      _vertical.copy(_up).multiplyScalar(-tuning.move.maxFallSpeed);
    }

    // 6. Jump — buffered press plus coyote grace.
    this.timeSinceGrounded = this.grounded ? 0 : this.timeSinceGrounded + dt;
    const canJump = this.grounded || this.timeSinceGrounded <= tuning.move.coyoteTime;
    if (canJump && this.deps.input.wasPressedWithin('jump', tuning.move.jumpBuffer)) {
      this.deps.input.consume('jump');
      _vertical.copy(_up).multiplyScalar(tuning.move.jumpSpeed);
      this.grounded = false;
      this.timeSinceGrounded = Infinity;
      this.jumpHeld = true;
      this.jumpAge = 0;
      this.setState('jumping');
      this.deps.bus.emit('player:jumped');
    } else if (this.jumpHeld) {
      // Letting go early makes a hop of it: the rise is cut once, so a tap and
      // a held press are two different jumps and the height is in the thumb.
      // ...but not before the hop is a hop: the briefest tap still leaves
      // the ground properly.
      this.jumpAge += dt;
      if (_vertical.dot(_up) <= 0) {
        this.jumpHeld = false;
      } else if (this.jumpAge >= tuning.move.minJumpTime && !this.deps.input.isDown('jump')) {
        _vertical.multiplyScalar(tuning.move.jumpCut);
        this.jumpHeld = false;
      }
    }

    this.velocity.copy(_horizontal).add(_vertical);

    // 7. Integrate, then resolve.
    transform.position.addScaledVector(this.velocity, dt);
    const wasGrounded = this.grounded;
    this.resolveCollision();
    this.snapToGround();

    // Standing still on walkable ground means standing still.
    //
    // Every step gravity presses the capsule a few millimetres into the
    // slope, and the depenetration pushes it back out along the slope's
    // normal — which leans downhill. A millimetre a step is five centimetres
    // a second: she crept down every hill while "idle", and the debug panel
    // never read 0.00 m/s. So once friction has stopped her, the point on the
    // surface is pinned and only her height may change.
    if (wasGrounded && this.grounded && inputMagnitude <= 1e-4 && _horizontal.lengthSq() < 1e-8) {
      const radius = transform.position.length();
      transform.position.copy(_prevPosition).setLength(radius);
      _tmp.copy(this.velocity).projectOnPlane(_up);
      this.velocity.sub(_tmp);
    }

    if (!wasGrounded && this.grounded) this.onLand();

    // 8. Orientation and animation state.
    this.orientToSurface(dt);
    this.updateState(dt);
    this.emitFootsteps(_prevPosition);

    this.simPosition.copy(transform.position);
    this.simQuaternion.copy(transform.quaternion);
    this.writtenPosition.copy(transform.position);
    this.writtenQuaternion.copy(transform.quaternion);
  }

  /**
   * Pose the drawn object between the last two fixed steps.
   *
   * Runs once a frame, after any steps and before anything reads the
   * transform to draw with it. From here until the next step the object, the
   * camera and every per-frame system agree about where she is.
   */
  interpolate(alpha: number): void {
    const transform = this.entity.object3D;
    if (this.movedExternally()) this.adoptTransform();
    this.renderPosition.lerpVectors(this.previousPosition, this.simPosition, alpha);
    transform.position.copy(this.renderPosition);
    transform.quaternion.slerpQuaternions(this.previousQuaternion, this.simQuaternion, alpha);
    this.writtenPosition.copy(transform.position);
    this.writtenQuaternion.copy(transform.quaternion);
  }

  /** Where she is drawn this frame: what the object3D holds after `interpolate`. */
  get smoothedPosition(): THREE.Vector3 {
    return this.renderPosition;
  }

  /** Where the simulation has her, whatever is being drawn. */
  get simulatedPosition(): THREE.Vector3 {
    return this.simPosition;
  }

  /** Take the object's current transform as the simulation's, with no history. */
  private adoptTransform(): void {
    const transform = this.entity.object3D;
    this.simPosition.copy(transform.position);
    this.simQuaternion.copy(transform.quaternion);
    this.previousPosition.copy(transform.position);
    this.previousQuaternion.copy(transform.quaternion);
    this.renderPosition.copy(transform.position);
    this.writtenPosition.copy(transform.position);
    this.writtenQuaternion.copy(transform.quaternion);
  }

  /**
   * Something outside moved the object since we last wrote it — a respawn, a
   * tool standing her at a viewpoint. Believe it rather than overwrite it.
   */
  private movedExternally(): boolean {
    const transform = this.entity.object3D;
    return (
      !transform.position.equals(this.writtenPosition) ||
      !transform.quaternion.equals(this.writtenQuaternion)
    );
  }

  private resolveCollision(): void {
    const transform = this.entity.object3D;
    _up.copy(transform.position).normalize();

    // Capsule segment runs from the lower sphere centre to the upper one.
    _capsuleStart.copy(transform.position).addScaledVector(_up, PLAYER_RADIUS);
    _capsuleEnd.copy(transform.position).addScaledVector(_up, PLAYER_HEIGHT - PLAYER_RADIUS);

    const hit = this.deps.world.resolveCapsule(_capsuleStart, _capsuleEnd, PLAYER_RADIUS);
    if (hit.contacts === 0) {
      this.grounded = false;
      return;
    }

    // The capsule was pushed out; move the entity by the same displacement.
    transform.position.add(hit.displacement);

    // A wall stops what is moving into it and lets the rest slide along it.
    if (hit.wallNormal) {
      const into = this.velocity.dot(hit.wallNormal);
      if (into < 0) this.velocity.addScaledVector(hit.wallNormal, -into);
    }

    if (!hit.normal) {
      // Touching only a wall says nothing about the ground; ground snapping
      // decides that, as it does when touching nothing at all.
      this.grounded = false;
      return;
    }

    _up.copy(transform.position).normalize();
    const slopeCos = Math.cos((tuning.move.maxSlopeDeg * Math.PI) / 180);
    const alignment = hit.normal.dot(_up);

    // Kill velocity into the surface, keep the tangential part — this is what
    // produces sliding along a face instead of sticking to it. Only ground
    // shallow enough to stand on counts as ground.
    const into = this.velocity.dot(hit.normal);
    if (into < 0) this.velocity.addScaledVector(hit.normal, -into);
    this.grounded = alignment > slopeCos;
    if (this.grounded) this.groundNormal.copy(hit.normal);
  }

  /**
   * Pull the character onto the surface when they are a hair above it.
   *
   * Without this, walking over a convex hilltop launches the player: the ground
   * curves away faster than gravity pulls them down. On a sphere every hill is
   * convex, so this is load-bearing, not a nicety.
   */
  private snapToGround(): void {
    if (this.velocity.dot(_up) > 0.5) return; // rising — do not yank them down

    const transform = this.entity.object3D;
    _up.copy(transform.position).normalize();
    _rayOrigin.copy(transform.position).addScaledVector(_up, 0.3);
    _down.copy(_up).negate();

    const hit = this.deps.world.raycast(
      _rayOrigin,
      _down,
      0.3 + tuning.move.groundSnapDistance,
    );
    if (!hit) return;

    const slopeCos = Math.cos((tuning.move.maxSlopeDeg * Math.PI) / 180);
    if (hit.normal.dot(_up) < slopeCos) return;

    transform.position.copy(hit.point);
    this.groundNormal.copy(hit.normal);
    this.grounded = true;

    const into = this.velocity.dot(hit.normal);
    if (into < 0) this.velocity.addScaledVector(hit.normal, -into);
  }

  /**
   * Stand the character up along local gravity, face the direction of
   * travel, and slerp so the correction is never a snap.
   *
   * Plumb, not along the ground normal. People stand vertical on a slope;
   * a body tilted to the slope leans back going uphill and forward going
   * down, and on the 25° flanks of the village hills she leaned back like
   * someone about to fall over. The feet meet the slope a few centimetres
   * off, in grass that hides them.
   */
  private orientToSurface(dt: number): void {
    const transform = this.entity.object3D;
    _up.copy(transform.position).normalize();

    const surfaceUp = _up;

    _horizontal.copy(this.velocity).projectOnPlane(surfaceUp);
    if (_horizontal.lengthSq() > 0.04) {
      _forward.copy(_horizontal).normalize();
    } else {
      // Standing still — keep facing where we already face, re-projected onto
      // the new tangent plane so the character stays upright as ground shifts.
      transform.getWorldDirection(_forward);
      _forward.projectOnPlane(surfaceUp);
      if (_forward.lengthSq() < 1e-6) return;
      _forward.normalize();
    }

    // `Matrix4.lookAt(eye, target, up)` follows the *camera* convention: the
    // resulting +Z axis points from the target back toward the eye, because a
    // camera looks down its own -Z. Characters are authored facing +Z, so
    // aiming the eye at `position + forward` turns the model 180° — it moves
    // correctly but moonwalks. Placing the target *behind* by `forward` puts
    // +Z along the direction of travel, which is what the asset contract says.
    _tmp.copy(transform.position).sub(_forward);
    _lookMatrix.lookAt(transform.position, _tmp, surfaceUp);
    _targetQuat.setFromRotationMatrix(_lookMatrix);

    const t = 1 - Math.exp(-tuning.move.orientLerp * dt);
    transform.quaternion.slerp(_targetQuat, t);
  }

  private updateState(dt: number): void {
    if (this.landingTimer > 0) {
      this.landingTimer -= dt;
      if (this.landingTimer > 0) return;
    }

    if (!this.grounded) {
      this.setState(this.velocity.dot(_up) > 0 ? 'jumping' : 'falling');
      return;
    }

    const speed = _horizontal.copy(this.velocity).projectOnPlane(_up).length();
    if (speed < 0.1) this.setState('idle');
    else if (speed < tuning.move.runThreshold) this.setState('walking');
    else this.setState('running');
  }

  private onLand(): void {
    const impact = Math.abs(this.velocity.dot(_up));
    this.jumpHeld = false;
    this.landingTimer = 0.16;
    this.setState('landing');
    this.deps.bus.emit('player:landed', {
      impactSpeed: impact,
      surface: PlanetTerrain.surfaceAt(this.entity.object3D.position),
    });
  }

  /** Distance-based footsteps, so cadence matches speed without animation events. */
  private emitFootsteps(previous: THREE.Vector3): void {
    if (!this.grounded) {
      this.footstepAccumulator = 0;
      return;
    }
    const travelled = this.entity.object3D.position.distanceTo(previous);
    this.footstepAccumulator += travelled;

    // The *same* function the character rig advances its gait phase with, so a
    // footfall sound always lands on a frame where a foot is on the ground.
    // Two independent cadences is why the old walk sounded a beat off itself.
    const stride = stepLength(this.planarSpeed);
    if (this.footstepAccumulator < stride) return;
    this.footstepAccumulator = 0;

    const position = this.entity.object3D.position;
    this.deps.bus.emit('player:footstep', {
      surface: PlanetTerrain.surfaceAt(position),
      position: { x: position.x, y: position.y, z: position.z },
    });
  }

  private setState(next: LocomotionState): void {
    if (this.state === next) return;
    const from = this.state;
    this.state = next;
    this.deps.bus.emit('player:stateChanged', { from, to: next });
  }
}
