import * as THREE from 'three';

const _carry = new THREE.Quaternion();

/**
 * Carry a direction in the ground plane from one place on the planet to
 * another without turning it — parallel transport.
 *
 * `axis` is tangent at `fromUp`; it is rotated by the same rotation that takes
 * `fromUp` to `toUp`, then squared up against `toUp`. Done every frame over
 * the few centimetres walked, this is what "the same direction as before"
 * means on a sphere, and it is how both the camera's heading and the sky's
 * frame are kept: neither turns unless something turns it.
 *
 * The alternative — rebuilding the direction from a fixed world axis, a
 * compass — looks equivalent and is not. A compass needle swings relative to
 * a walker going straight, by `tan(latitude) / radius` radians for each metre
 * east or west: 1.7° a metre at the village, and without limit at the poles.
 *
 * Mutates and returns `axis`.
 */
export function carryTangent(axis: THREE.Vector3, fromUp: THREE.Vector3, toUp: THREE.Vector3): THREE.Vector3 {
  if (fromUp.dot(toUp) < 0.9999999) {
    _carry.setFromUnitVectors(fromUp, toUp);
    axis.applyQuaternion(_carry);
  }
  axis.projectOnPlane(toUp);
  if (axis.lengthSq() < 1e-8) {
    axis.set(0, 1, 0).projectOnPlane(toUp);
    if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0).projectOnPlane(toUp);
  }
  return axis.normalize();
}
