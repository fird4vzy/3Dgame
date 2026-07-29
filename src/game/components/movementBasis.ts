import * as THREE from 'three';

/**
 * The camera-relative tangent basis a character moves in.
 *
 * Pulled out of the controller as a pure function because its sign convention
 * is exactly the kind of thing that is easy to get backwards and impossible to
 * eyeball — A and D were swapped for five phases behind a stray `.negate()`,
 * and a browser probe that made the *same* sign error happily confirmed it was
 * fine. A unit test on the basis itself catches it; a playtest catches it only
 * if someone notices which way their character strafes.
 *
 * Convention: `forward × up` is screen-right in a right-handed system. With the
 * usual forward = -Z and up = +Y that evaluates to +X.
 */
export interface MovementBasis {
  forward: THREE.Vector3;
  right: THREE.Vector3;
}

const _fallback = new THREE.Vector3();

/**
 * Build the basis. `cameraForward` need not be normalised or tangent — it is
 * projected onto the plane defined by `up`.
 *
 * Writes into `outForward` / `outRight` so the hot path never allocates.
 */
export function computeMovementBasis(
  cameraForward: THREE.Vector3,
  up: THREE.Vector3,
  outForward: THREE.Vector3,
  outRight: THREE.Vector3,
): MovementBasis {
  outForward.copy(cameraForward).projectOnPlane(up);

  if (outForward.lengthSq() < 1e-6) {
    // Camera is looking straight along the up axis: any tangent will do, but it
    // must be deterministic or the character jitters when looking at their feet.
    _fallback.set(0, 1, 0).projectOnPlane(up);
    if (_fallback.lengthSq() < 1e-6) _fallback.set(1, 0, 0).projectOnPlane(up);
    outForward.copy(_fallback);
  }

  outForward.normalize();
  outRight.copy(outForward).cross(up).normalize();

  return { forward: outForward, right: outRight };
}

/**
 * Map a 2D input vector into world space using the basis.
 *
 * `input.x` is strafe (+1 = right, matching D) and `input.y` is forward
 * (+1 = away from camera, matching W).
 */
export function inputToWorld(
  input: { x: number; y: number },
  basis: MovementBasis,
  out: THREE.Vector3,
): THREE.Vector3 {
  return out
    .set(0, 0, 0)
    .addScaledVector(basis.right, input.x)
    .addScaledVector(basis.forward, input.y);
}
