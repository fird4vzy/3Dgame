import * as THREE from 'three';
import { Component } from '@engine/entity/Entity';
import type { InputManager } from '@engine/input/InputManager';
import type { EventBus } from '@core/events/EventBus';
import type { BvhWorld } from '@engine/physics/BvhWorld';
import { tuning } from '@config/tuning';
import type { SphericalCharacterController } from './SphericalCharacterController';

const _up = new THREE.Vector3();
const _horizontal = new THREE.Vector3();
const _vertical = new THREE.Vector3();
const _down = new THREE.Vector3();
const _toThermal = new THREE.Vector3();

export interface GlideDeps {
  controller: SphericalCharacterController;
  input: InputManager;
  bus: EventBus;
  world: BvhWorld;
  /** Thermal column positions on the surface. */
  thermals: THREE.Vector3[];
  /** Heavy parcels ground you — the contract that says so is data-driven. */
  canGlide: () => boolean;
}

/**
 * Glide traversal: optional skill expression that can never punish.
 *
 * Deploy by pressing jump again while falling with clearance below. Gliding is
 * strictly optional — every destination is walkable — but it is faster, it
 * feels wonderful, and the thermal ring gives the tiny sphere a skill ceiling
 * (GDD §2.3B). Falling does no damage in either case.
 *
 * This component post-processes the controller's velocity each tick rather than
 * replacing it, so all the spherical-frame logic stays in one place.
 */
export class GlideComponent extends Component {
  private gliding = false;
  private airtime = 0;
  /** Blocks re-deploying on the same press that stowed the wing. */
  private cooldown = 0;

  constructor(private readonly deps: GlideDeps) {
    super();
  }

  get isGliding(): boolean {
    return this.gliding;
  }

  override fixedUpdate(dt: number): void {
    const controller = this.deps.controller;
    this.cooldown = Math.max(0, this.cooldown - dt);

    if (controller.grounded) {
      if (this.gliding) this.stow();
      this.airtime = 0;
      return;
    }

    this.airtime += dt;

    _up.copy(this.entity.object3D.position).normalize();
    _vertical.copy(controller.velocity).projectOnPlane(_up);
    _horizontal.copy(_vertical);
    const descentRate = controller.velocity.dot(_up);

    if (!this.gliding) {
      const falling = descentRate < 0;
      const pressed = this.deps.input.wasPressed('jump');
      if (
        pressed &&
        falling &&
        this.cooldown <= 0 &&
        this.deps.canGlide() &&
        this.hasClearance()
      ) {
        this.deploy();
      }
      return;
    }

    // Stowing mid-air drops you back into a normal fall.
    if (this.deps.input.wasPressed('jump') && this.cooldown <= 0) {
      this.stow();
      return;
    }

    this.applyGlidePhysics(dt, controller);
  }

  private applyGlidePhysics(dt: number, controller: SphericalCharacterController): void {
    _up.copy(this.entity.object3D.position).normalize();

    // Split into tangential and radial parts and shape each separately.
    _horizontal.copy(controller.velocity).projectOnPlane(_up);

    const inThermal = this.thermalLift();
    const targetSpeed = inThermal > 0 ? tuning.glide.thermalForwardSpeed : tuning.glide.forwardSpeed;

    if (_horizontal.lengthSq() > 1e-6) {
      const current = _horizontal.length();
      // Ease toward the glide speed rather than snapping, so entering a thermal
      // reads as being lifted rather than teleported.
      const next = current + (targetSpeed - current) * Math.min(1, dt * 2.2);
      _horizontal.setLength(next);
    }

    // Terminal descent, plus lift while inside a thermal column.
    const descent = -tuning.glide.descentSpeed + inThermal;
    _vertical.copy(_up).multiplyScalar(descent);

    controller.velocity.copy(_horizontal).add(_vertical);
  }

  /** Lift from the nearest thermal, falling off toward its edge. */
  private thermalLift(): number {
    const position = this.entity.object3D.position;
    let best = 0;

    for (const thermal of this.deps.thermals) {
      _toThermal.copy(thermal).sub(position);
      // Compare along the surface, not through the planet.
      const distance = _toThermal.length();
      if (distance > tuning.glide.thermalRadius) continue;

      const falloff = 1 - distance / tuning.glide.thermalRadius;
      best = Math.max(best, tuning.glide.thermalLift * falloff);
    }
    return best;
  }

  private hasClearance(): boolean {
    _up.copy(this.entity.object3D.position).normalize();
    _down.copy(_up).negate();
    const hit = this.deps.world.raycast(
      this.entity.object3D.position,
      _down,
      tuning.glide.minClearance,
    );
    return hit === null;
  }

  private deploy(): void {
    this.gliding = true;
    this.cooldown = 0.25;
    this.deps.input.consume('jump');
    this.deps.bus.emit('player:glideStarted');
  }

  private stow(): void {
    if (!this.gliding) return;
    this.gliding = false;
    this.cooldown = 0.2;
    this.deps.input.consume('jump');
    this.deps.bus.emit('player:glideEnded', { airtime: this.airtime });
  }
}
