import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import type { InputManager } from '@engine/input/InputManager';
import type { BvhWorld } from '@engine/physics/BvhWorld';
import { tuning } from '@config/tuning';
import { clamp } from '@core/math/spherical';
import { PlanetTerrain } from '@game/world/PlanetTerrain';

const _up = new THREE.Vector3();
const _prevUp = new THREE.Vector3();
const _transport = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();
const _pitchQuat = new THREE.Quaternion();
const _right = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _target = new THREE.Vector3();
const _error = new THREE.Vector3();
const _step = new THREE.Vector3();
const _camera = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _pivotUp = new THREE.Vector3();

/** Scenery under this many triangles is cheaper to test directly than to index. */
const BVH_WORTH_IT = 96;

/**
 * Step a critically damped spring toward `target`. No overshoot, no wobble,
 * and the same motion at any frame rate.
 */
function springVector(
  value: THREE.Vector3,
  velocity: THREE.Vector3,
  target: THREE.Vector3,
  omega: number,
  dt: number,
): void {
  const decay = Math.exp(-omega * dt);
  _error.copy(value).sub(target);
  _step.copy(_error).multiplyScalar(omega).add(velocity).multiplyScalar(dt);
  velocity.addScaledVector(_step, -omega).multiplyScalar(decay);
  value.copy(target).add(_error.add(_step).multiplyScalar(decay));
}

export interface LookOptions {
  /** Multiplier on every look device; 1 is the tuned default. */
  sensitivity: number;
  invertY: boolean;
  /** Skip the widening of the lens at a run. */
  reduceMotion: boolean;
}

/**
 * Third-person camera for a spherical world.
 *
 * **The frame.** On a sphere "up" changes continuously as you walk, so yaw
 * cannot be an Euler angle against a fixed world axis: a naive
 * `lookAt(player, worldUp)` rolls and snaps near the poles of whatever axis you
 * picked. The rig keeps its heading as a *vector in the tangent plane* and
 * parallel-transports it every frame — when local up rotates by `q`, so does
 * the heading — so there is no global reference axis and nothing to gimbal.
 *
 * **What is smoothed, and what is not.** The camera orbits a *pivot* that
 * follows the player on a critically damped spring. Looking is not smoothed at
 * all: the camera is placed exactly where the heading and pitch say, every
 * frame, so the view turns with the hand that turns it.
 *
 * It used to be the other way round — the camera's own position chased a
 * target on a spring. That put the spring between the mouse and the picture,
 * so every turn arrived a fifth of a second late, and it let the camera fall a
 * metre behind a run, changing the framing with every start and stop.
 *
 * See docs/03-gameplay-specification.md §3.4.
 */
export class FollowRig {
  /** Heading in the tangent plane at the player's current up. */
  private readonly heading = new THREE.Vector3(0, 0, 1);
  private readonly lastUp = new THREE.Vector3(0, 1, 0);
  private pitch: number = tuning.camera.startPitch;

  /** The smoothed point the camera orbits: a little above the player's head. */
  private readonly pivot = new THREE.Vector3();
  private readonly pivotVelocity = new THREE.Vector3();
  /** The pivot's distance from the planet's centre, smoothed more slowly. */
  private pivotRadius = 0;
  private pivotRadiusVelocity = 0;

  private currentArm: number = tuning.camera.armLength;
  /**
   * Player-chosen arm length, before occlusion has its say.
   *
   * Kept separate from `currentArm` on purpose. Occlusion *shortens* the arm
   * when something gets in the way and lets it recover afterwards; if the zoom
   * wrote to the same variable, every time you walked behind a hut the camera
   * would forget the distance you had chosen and spring back to the default.
   */
  private wantedArm: number = tuning.camera.armLength;
  /** How long something has been in the way, seconds. */
  private blockedFor = 0;
  /** Metres the camera is raised to clear the ground under it. */
  private lift = 0;
  private fovKick = 0;
  private initialised = false;
  /** Looking through the postcard camera: at her eyes, with a longer lens. */
  private photo = false;
  private photoBlend = 0;

  private look: LookOptions = { sensitivity: 1, invertY: false, reduceMotion: false };

  /**
   * Props the camera must not see through.
   *
   * The collision BVH holds only the terrain, so without this a rock, hut or
   * tree between the camera and the player fills the entire screen — the
   * camera happily sits inside geometry because nothing told it not to.
   */
  private readonly occluders: THREE.Object3D[] = [];
  private readonly raycaster = new THREE.Raycaster();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: InputManager,
    private readonly world: BvhWorld,
    /** Called with the field of view the rig wants, in degrees. */
    private readonly setFov: (deg: number) => void = () => undefined,
  ) {
    (this.raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
  }

  setLookOptions(options: Partial<LookOptions>): void {
    this.look = { ...this.look, ...options };
  }

  /** Raise or lower the postcard camera. */
  setPhotoMode(active: boolean): void {
    this.photo = active;
  }

  /** 0 behind her, 1 through the viewfinder. */
  get photoAmount(): number {
    return this.photoBlend;
  }

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

    this.targetFor(playerPosition, _target);
    this.pivot.copy(_target);
    this.pivotVelocity.set(0, 0, 0);
    this.pivotRadius = _target.length();
    this.pivotRadiusVelocity = 0;
    this.blockedFor = 0;
    this.lift = 0;
    this.initialised = true;
    this.place();
  }

  /**
   * Runs in lateUpdate, after the player's transform has settled — a camera that
   * follows a stale position judders at exactly the worst moment.
   *
   * `speed` is how fast she is covering ground, for the lens.
   */
  update(dt: number, playerPosition: THREE.Vector3, speed = 0): void {
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
      (this.input.activeDevice === 'touch'
        ? tuning.camera.touchSensitivity
        : tuning.camera.mouseSensitivity) * this.look.sensitivity;

    if (look.x !== 0) {
      _yawQuat.setFromAxisAngle(_up, -look.x * sensitivity);
      this.heading.applyQuaternion(_yawQuat).normalize();
    }
    // Pitch is positive looking up. Pushing the mouse (or the stick) away
    // looks up, as everywhere else; it used to be the other way round, with
    // the setting that would have corrected it wired to nothing.
    this.pitch = clamp(
      this.pitch - look.y * sensitivity * (this.look.invertY ? -1 : 1),
      (tuning.camera.minPitchDeg * Math.PI) / 180,
      (tuning.camera.maxPitchDeg * Math.PI) / 180,
    );

    // ── zoom ──────────────────────────────────────────────────────────────
    //
    // Multiplicative, not additive. A notch that removes a fixed number of
    // metres is enormous up close and imperceptible far away; a constant
    // *fraction* feels like the same gesture at every distance.
    const zoom = this.input.consumeZoom();
    if (zoom !== 0) {
      this.wantedArm = clamp(
        this.wantedArm * Math.pow(0.88, zoom),
        tuning.camera.minArmLength,
        tuning.camera.maxArmLength,
      );
    }

    // ── the pivot follows; the camera does not lag behind it ──────────────
    this.targetFor(playerPosition, _target);
    // A long way off is a respawn, not a walk: arrive, do not fly there.
    if (this.pivot.distanceToSquared(_target) > 64) {
      this.pivot.copy(_target);
      this.pivotVelocity.set(0, 0, 0);
      this.pivotRadius = _target.length();
      this.pivotRadiusVelocity = 0;
    }
    springVector(this.pivot, this.pivotVelocity, _target, tuning.camera.followOmega, dt);
    // Height on its own, slower spring, so a jump moves her in the frame
    // rather than taking the whole picture up and down with her. The quick
    // spring keeps only its motion along the ground.
    _pivotUp.copy(this.pivot).normalize();
    this.pivotVelocity.addScaledVector(_pivotUp, -this.pivotVelocity.dot(_pivotUp));
    const wantedRadius = _target.length();
    const slow = tuning.camera.followOmegaVertical;
    const decay = Math.exp(-slow * dt);
    const radiusError = this.pivotRadius - wantedRadius;
    const radiusStep = (radiusError * slow + this.pivotRadiusVelocity) * dt;
    this.pivotRadiusVelocity = (this.pivotRadiusVelocity - radiusStep * slow) * decay;
    this.pivotRadius = wantedRadius + (radiusError + radiusStep) * decay;
    this.pivot.setLength(this.pivotRadius);

    this.photoBlend += ((this.photo ? 1 : 0) - this.photoBlend) * (1 - Math.exp(-9 * dt));
    if (this.photo) {
      // Through her eyes: nothing can come between the lens and itself.
      this.currentArm += (0.12 - this.currentArm) * (1 - Math.exp(-12 * dt));
      this.blockedFor = 0;
    } else {
      this.resolveOcclusion(dt);
    }

    // A little wider at a run: speed you can see without the camera moving.
    const run = this.look.reduceMotion ? 0 : clamp(speed / tuning.move.runSpeed, 0, 1.2);
    this.fovKick += (run * run * tuning.camera.runFovKick - this.fovKick) * (1 - Math.exp(-5 * dt));
    this.setFov(
      THREE.MathUtils.lerp(tuning.camera.fov + this.fovKick, tuning.camera.photoFov, this.photoBlend),
    );

    this.place(dt);
  }

  /** Register scenery the camera should pull in front of. */
  addOccluders(objects: readonly THREE.Object3D[]): void {
    for (const object of objects) {
      const mesh = object as THREE.Mesh;
      // Index anything detailed once, so a ray costs a tree walk and not a
      // loop over every triangle of every house it passes.
      if (mesh.isMesh && mesh.geometry && !mesh.geometry.boundsTree) {
        const position = mesh.geometry.getAttribute('position');
        const index = mesh.geometry.getIndex();
        const triangles = (index ? index.count : (position?.count ?? 0)) / 3;
        if (triangles >= BVH_WORTH_IT) mesh.geometry.boundsTree = new MeshBVH(mesh.geometry);
      }
      if (mesh.isMesh && mesh.geometry?.boundsTree) mesh.raycast = acceleratedRaycast;
      this.occluders.push(object);
    }
  }

  /** The rig's current heading, so the controller can move camera-relative. */
  getHeading(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.heading);
  }

  /** The point the camera is looking at this frame. */
  getPivot(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pivot);
  }

  /** Turn the rig to face along `forward` (projected onto the ground), keeping its place. */
  face(forward: THREE.Vector3): void {
    _up.copy(this.lastUp);
    _dir.copy(forward).projectOnPlane(_up);
    if (_dir.lengthSq() > 1e-8) this.heading.copy(_dir).normalize();
  }

  private targetFor(playerPosition: THREE.Vector3, out: THREE.Vector3): void {
    _up.copy(playerPosition).normalize();
    out.copy(playerPosition).addScaledVector(_up, tuning.camera.heightOffset);
  }

  /** The unit direction the camera looks along, in the pivot's own frame. */
  private viewDirection(out: THREE.Vector3): THREE.Vector3 {
    _pivotUp.copy(this.pivot).normalize();
    // The heading is tangent at the player; the pivot is within a step of her.
    out.copy(this.heading).projectOnPlane(_pivotUp).normalize();
    _right.copy(out).cross(_pivotUp).normalize();
    _pitchQuat.setFromAxisAngle(_right, this.pitch);
    return out.applyQuaternion(_pitchQuat).normalize();
  }

  /** Put the camera where heading, pitch and arm say. Never smoothed. */
  private place(dt = 0): void {
    this.viewDirection(_dir);
    _camera.copy(this.pivot).addScaledVector(_dir, -this.currentArm);
    this.keepAboveGround(_camera, dt);

    this.camera.position.copy(_camera);
    // `up` must be the *local* up, or the camera rolls as the player walks.
    this.camera.up.copy(_pivotUp);
    this.camera.lookAt(this.pivot);
  }

  /**
   * Never let the camera end up underground.
   *
   * Occlusion handles things *between* the camera and the player. It cannot
   * handle the camera being below the surface entirely, which on a world this
   * small is not an edge case: the arm swings back along a straight line and
   * the ground curves up away from that line, so past about eight metres the
   * camera simply sinks through the planet.
   *
   * Solved by raising the camera along its own local up rather than by
   * shortening the arm, because shortening fights the zoom the player just
   * asked for. The lift eases back down but never lags going up, so the lens
   * rides over a rise like a crane and never dips into it.
   */
  private keepAboveGround(position: THREE.Vector3, dt: number): void {
    _camUp.copy(position).normalize();
    const minimum = PlanetTerrain.heightAt(_camUp) + tuning.camera.groundClearance;
    const needed = Math.max(0, minimum - position.length());
    this.lift = needed > this.lift ? needed : this.lift + (needed - this.lift) * (1 - Math.exp(-6 * dt));
    if (this.lift > 1e-4) position.addScaledVector(_camUp, this.lift);
  }

  /**
   * Pull the camera in when something gets between it and the player.
   *
   * Quickly, but not in one frame, and not for something that is only passing
   * through the view: a lantern post crossing between her and the lens used
   * to yank the camera in and let it out again, twice a second along a street.
   * What is about to swallow the lens itself gets no such patience.
   */
  private resolveOcclusion(dt: number): void {
    this.viewDirection(_dir).negate();
    const reach = this.wantedArm + tuning.camera.occlusionRadius;

    // Terrain first — it is the most common occluder and its BVH is cheapest.
    let nearest = this.world.raycast(this.pivot, _dir, reach)?.distance ?? Infinity;

    if (this.occluders.length > 0) {
      this.raycaster.set(this.pivot, _dir);
      this.raycaster.far = Math.min(reach, nearest);
      for (const hit of this.raycaster.intersectObjects(this.occluders, false)) {
        if (hit.distance < nearest) nearest = hit.distance;
      }
    }

    if (nearest === Infinity) {
      this.blockedFor = 0;
      this.currentArm += (this.wantedArm - this.currentArm) * (1 - Math.exp(-tuning.camera.occlusionRecoverRate * dt));
      return;
    }

    this.blockedFor += dt;
    const safe = Math.max(0.8, nearest - tuning.camera.occlusionRadius);
    // Whatever happens, the lens stays on this side of the thing.
    const insideIt = nearest < this.currentArm + 0.35 && nearest > this.currentArm - 0.9;
    if (insideIt || this.blockedFor >= tuning.camera.occlusionPatience) {
      if (safe < this.currentArm) {
        this.currentArm += (safe - this.currentArm) * (1 - Math.exp(-tuning.camera.occlusionPullRate * dt));
        if (insideIt) this.currentArm = Math.min(this.currentArm, Math.max(0.8, nearest - 0.08));
      } else {
        this.currentArm += (Math.min(safe, this.wantedArm) - this.currentArm) * (1 - Math.exp(-tuning.camera.occlusionRecoverRate * dt));
      }
    }
  }
}
