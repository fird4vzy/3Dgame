import * as THREE from 'three';
import type { InputManager } from '@engine/input/InputManager';
import type { BvhWorld } from '@engine/physics/BvhWorld';
import { tuning } from '@config/tuning';
import { clamp } from '@core/math/spherical';

const _up = new THREE.Vector3();
const _prevUp = new THREE.Vector3();
const _transport = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();
const _pitchQuat = new THREE.Quaternion();
const _right = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _toCamera = new THREE.Vector3();

/**
 * Third-person spring-arm rig for a spherical world.
 *
 * **The problem.** On a sphere the "up" axis changes continuously as you walk,
 * so camera yaw cannot be stored as an Euler angle against a fixed world axis.
 * A naive `lookAt(player, worldUp)` makes the camera roll and snap as the player
 * crosses the poles of whatever axis you picked — which reads to players as
 * motion sickness, not as a bug.
 *
 * **The fix.** We keep the rig's heading as a *vector in the tangent plane* and
 * parallel-transport it every frame: when local up rotates by `q`, the heading
 * is rotated by the same `q` and re-orthonormalised. Yaw input then rotates the
 * heading about the current up, and pitch is applied in that transported frame.
 * There is no global reference axis anywhere, so there is nothing to gimbal.
 *
 * See docs/03-gameplay-specification.md §3.4.
 */
export class FollowRig {
  /** Heading in the tangent plane at the player's current up. */
  private readonly heading = new THREE.Vector3(0, 0, 1);
  private readonly lastUp = new THREE.Vector3(0, 1, 0);
  private pitch = 0.28;

  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private currentArm: number = tuning.camera.armLength;
  private initialised = false;

  /**
   * Props the camera must not see through.
   *
   * The BVH holds only the terrain, so without this a rock, hut or tree
   * between the camera and the player fills the entire screen — the camera
   * happily sits inside geometry because nothing told it not to.
   */
  private readonly occluders: THREE.Object3D[] = [];
  private readonly raycaster = new THREE.Raycaster();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: InputManager,
    private readonly world: BvhWorld,
  ) {}

  /** Seed the rig behind the player so frame one is not a swoop from origin. */
  reset(playerPosition: THREE.Vector3, playerForward: THREE.Vector3): void {
    _up.copy(playerPosition).normalize();
    this.lastUp.copy(_up);
    this.heading.copy(playerForward).projectOnPlane(_up);
    if (this.heading.lengthSq() < 1e-6) {
      this.heading.set(0, 1, 0).projectOnPlane(_up);
      if (this.heading.lengthSq() < 1e-6) this.heading.set(1, 0, 0).projectOnPlane(_up);
    }
    this.heading.normalize();

    this.buildTarget(playerPosition);
    this.computeDesired(_target);
    this.position.copy(_desired);
    this.velocity.set(0, 0, 0);
    this.camera.position.copy(this.position);
    this.camera.lookAt(_target);
    this.initialised = true;
  }

  /**
   * Runs in lateUpdate, after the player's transform has settled — a camera that
   * follows a stale position judders at exactly the worst moment.
   */
  update(dt: number, playerPosition: THREE.Vector3): void {
    if (!this.initialised) {
      this.reset(playerPosition, new THREE.Vector3(0, 0, 1));
      return;
    }

    _up.copy(playerPosition).normalize();
    _prevUp.copy(this.lastUp);

    // ── parallel transport ────────────────────────────────────────────────
    // Rotate the heading by the same rotation that carried prevUp to up, so it
    // stays "the same direction" in the player's frame as the ground curves.
    if (_prevUp.dot(_up) < 0.999999) {
      _transport.setFromUnitVectors(_prevUp, _up);
      this.heading.applyQuaternion(_transport);
    }
    this.heading.projectOnPlane(_up);
    if (this.heading.lengthSq() < 1e-8) {
      this.heading.set(0, 1, 0).projectOnPlane(_up);
      if (this.heading.lengthSq() < 1e-8) this.heading.set(1, 0, 0).projectOnPlane(_up);
    }
    this.heading.normalize();
    this.lastUp.copy(_up);

    // ── look input, applied in the transported frame ──────────────────────
    const look = this.input.getAxis2D('look');
    const sensitivity =
      this.input.activeDevice === 'touch'
        ? tuning.camera.touchSensitivity
        : tuning.camera.mouseSensitivity;

    if (look.x !== 0) {
      _yawQuat.setFromAxisAngle(_up, -look.x * sensitivity);
      this.heading.applyQuaternion(_yawQuat).normalize();
    }
    this.pitch = clamp(
      this.pitch + look.y * sensitivity,
      (tuning.camera.minPitchDeg * Math.PI) / 180,
      (tuning.camera.maxPitchDeg * Math.PI) / 180,
    );

    // ── desired pose ──────────────────────────────────────────────────────
    this.buildTarget(playerPosition);
    this.computeDesired(_target);
    this.resolveOcclusion(_target, dt);

    // Critically damped spring: no overshoot, no wobble, frame-rate independent.
    const omega = tuning.camera.positionOmega;
    const exp = Math.exp(-omega * dt);
    _toCamera.copy(this.position).sub(_desired);
    const temp = _toCamera
      .clone()
      .multiplyScalar(omega)
      .add(this.velocity)
      .multiplyScalar(dt);
    this.velocity.sub(temp.clone().multiplyScalar(omega)).multiplyScalar(exp);
    this.position.copy(_desired).add(_toCamera.add(temp).multiplyScalar(exp));

    this.camera.position.copy(this.position);
    // `up` must be the *local* up, or the camera rolls as the player walks.
    this.camera.up.copy(_up);
    this.camera.lookAt(_target);
  }

  /** Register scenery the camera should pull in front of. */
  addOccluders(objects: readonly THREE.Object3D[]): void {
    this.occluders.push(...objects);
  }

  /** The rig's current heading, so the controller can move camera-relative. */
  getHeading(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.heading);
  }

  private buildTarget(playerPosition: THREE.Vector3): void {
    _up.copy(playerPosition).normalize();
    _target.copy(playerPosition).addScaledVector(_up, tuning.camera.heightOffset);
  }

  /** Place the camera behind and above the heading, pitched in the local frame. */
  private computeDesired(target: THREE.Vector3): void {
    _right.copy(this.heading).cross(_up).normalize();
    _pitchQuat.setFromAxisAngle(_right, this.pitch);
    _dir.copy(this.heading).applyQuaternion(_pitchQuat).normalize();
    _desired.copy(target).addScaledVector(_dir, -this.currentArm);
  }

  /**
   * Pull the camera in when terrain gets between it and the player. On a small
   * planet the ground itself is the most common occluder — walk into a valley
   * and the far wall would otherwise fill the screen.
   */
  private resolveOcclusion(target: THREE.Vector3, dt: number): void {
    const full = tuning.camera.armLength;
    _toCamera.copy(_desired).sub(target);
    const distance = _toCamera.length();
    if (distance < 1e-4) return;
    _toCamera.divideScalar(distance);

    // Terrain first — it is the most common occluder and the BVH is cheapest.
    let nearest = this.world.raycast(target, _toCamera, distance)?.distance ?? Infinity;

    // Then scenery. Instanced props raycast correctly, so one call covers every
    // instance of a prop type.
    if (this.occluders.length > 0) {
      this.raycaster.set(target, _toCamera);
      this.raycaster.far = distance;
      for (const hit of this.raycaster.intersectObjects(this.occluders, false)) {
        if (hit.distance < nearest) nearest = hit.distance;
      }
    }

    if (nearest < Infinity) {
      const safe = Math.max(0.8, nearest - tuning.camera.occlusionRadius);
      this.currentArm = Math.min(this.currentArm, safe);
    } else {
      this.currentArm = Math.min(
        full,
        this.currentArm + tuning.camera.occlusionRecoverSpeed * dt,
      );
    }
    this.computeDesired(target);
  }
}
