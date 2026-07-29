import * as THREE from 'three';
import { Component } from '@engine/entity/Entity';
import type { BvhWorld } from '@engine/physics/BvhWorld';
import type { InputManager } from '@engine/input/InputManager';
import type { EventBus } from '@core/events/EventBus';
import { tuning } from '@config/tuning';
import { GRAVITY, PLAYER_HEIGHT, PLAYER_RADIUS } from '@config/constants';
import { PlanetTerrain } from '@game/world/PlanetTerrain';

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

export interface ControllerDeps {
  world: BvhWorld;
  input: InputManager;
  bus: EventBus;
  /** Supplies the camera's forward vector so movement is camera-relative. */
  camera: THREE.Object3D;
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

  /** Interpolated render transform, written by the loop's interpolate phase. */
  private readonly renderPosition = new THREE.Vector3();
  private readonly previousPosition = new THREE.Vector3();

  private timeSinceGrounded = Infinity;
  private landingTimer = 0;
  private footstepAccumulator = 0;

  constructor(private readonly deps: ControllerDeps) {
    super();
  }

  override onAttach(): void {
    this.previousPosition.copy(this.entity.object3D.position);
    this.renderPosition.copy(this.entity.object3D.position);
    this.groundNormal.copy(this.entity.object3D.position).normalize();
  }

  /** Planar speed, for animation blending and the run/walk threshold. */
  get planarSpeed(): number {
    _up.copy(this.entity.object3D.position).normalize();
    return _horizontal.copy(this.velocity).projectOnPlane(_up).length();
  }

  override fixedUpdate(dt: number): void {
    const transform = this.entity.object3D;
    _prevPosition.copy(transform.position);
    this.previousPosition.copy(transform.position);

    // 1. Local frame. `up` is the defining quantity of a spherical world.
    _up.copy(transform.position).normalize();

    // 2. Camera-relative tangent basis. Projecting the camera's forward onto the
    //    tangent plane is what makes "W" mean "away from the camera" no matter
    //    where on the sphere the player is standing.
    this.deps.camera.getWorldDirection(_forward);
    _forward.projectOnPlane(_up);
    if (_forward.lengthSq() < 1e-6) {
      // Camera is looking straight down the up axis — pick any tangent.
      _forward.set(0, 1, 0).projectOnPlane(_up);
      if (_forward.lengthSq() < 1e-6) _forward.set(1, 0, 0).projectOnPlane(_up);
    }
    _forward.normalize();
    _right.copy(_forward).cross(_up).normalize().negate();

    // 3. Desired velocity in the tangent plane.
    const move = this.deps.input.getAxis2D('move');
    _wish.set(0, 0, 0).addScaledVector(_right, move.x).addScaledVector(_forward, move.y);
    const inputMagnitude = Math.min(_wish.length(), 1);
    if (inputMagnitude > 1e-4) _wish.normalize();

    const running = this.deps.input.isDown('run');
    const targetSpeed =
      inputMagnitude * (running ? tuning.move.runSpeed : tuning.move.walkSpeed);

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
      this.setState('jumping');
      this.deps.bus.emit('player:jumped');
    }

    this.velocity.copy(_horizontal).add(_vertical);

    // 7. Integrate, then resolve.
    transform.position.addScaledVector(this.velocity, dt);
    const wasGrounded = this.grounded;
    this.resolveCollision(dt);
    this.snapToGround();

    if (!wasGrounded && this.grounded) this.onLand();

    // 8. Orientation and animation state.
    this.orientToSurface(dt);
    this.updateState(dt);
    this.emitFootsteps(dt, _prevPosition);
  }

  /** Smooth the visible transform between fixed steps. */
  interpolate(alpha: number): void {
    this.renderPosition.lerpVectors(this.previousPosition, this.entity.object3D.position, alpha);
  }

  get smoothedPosition(): THREE.Vector3 {
    return this.renderPosition;
  }

  private resolveCollision(dt: number): void {
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

    if (!hit.normal) return;

    _up.copy(transform.position).normalize();
    const slopeCos = Math.cos((tuning.move.maxSlopeDeg * Math.PI) / 180);
    const alignment = hit.normal.dot(_up);

    if (alignment > slopeCos) {
      this.grounded = true;
      this.groundNormal.copy(hit.normal);
      // Kill velocity into the surface, keep the tangential part — this is what
      // produces sliding along walls instead of sticking to them.
      const into = this.velocity.dot(hit.normal);
      if (into < 0) this.velocity.addScaledVector(hit.normal, -into);
    } else {
      // Too steep to stand on: slide, but do not count as ground.
      const into = this.velocity.dot(hit.normal);
      if (into < 0) this.velocity.addScaledVector(hit.normal, -into);
      this.grounded = false;
    }

    void dt;
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
   * Align the character's local +Y to the ground normal and its local +Z to the
   * direction of travel, then slerp so the correction is never a snap.
   */
  private orientToSurface(dt: number): void {
    const transform = this.entity.object3D;
    _up.copy(transform.position).normalize();

    const surfaceUp = this.grounded ? this.groundNormal : _up;

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
    this.landingTimer = 0.16;
    this.setState('landing');
    this.deps.bus.emit('player:landed', {
      impactSpeed: impact,
      surface: PlanetTerrain.surfaceAt(this.entity.object3D.position),
    });
  }

  /** Distance-based footsteps, so cadence matches speed without animation events. */
  private emitFootsteps(dt: number, previous: THREE.Vector3): void {
    if (!this.grounded) {
      this.footstepAccumulator = 0;
      return;
    }
    const travelled = this.entity.object3D.position.distanceTo(previous);
    this.footstepAccumulator += travelled;

    const stride = this.state === 'running' ? 1.55 : 0.95;
    if (this.footstepAccumulator < stride) return;
    this.footstepAccumulator = 0;

    const position = this.entity.object3D.position;
    this.deps.bus.emit('player:footstep', {
      surface: PlanetTerrain.surfaceAt(position),
      position: { x: position.x, y: position.y, z: position.z },
    });
    void dt;
  }

  private setState(next: LocomotionState): void {
    if (this.state === next) return;
    const from = this.state;
    this.state = next;
    this.deps.bus.emit('player:stateChanged', { from, to: next });
  }
}
