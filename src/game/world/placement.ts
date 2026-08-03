import * as THREE from 'three';
import { latLonToCartesian } from '@core/math/spherical';
import { makeRng } from '@core/math/rng';
import { PLANET_RADIUS, SEA_LEVEL_RADIUS } from '@config/constants';
import { PlanetTerrain } from './PlanetTerrain';
import type { GeoPoint } from '../../data/content';

const _up = new THREE.Vector3();
const _tangentA = new THREE.Vector3();
const _tangentB = new THREE.Vector3();

/**
 * Put an authored lat/lon point on the terrain surface.
 *
 * Content is authored geographically and resolved to Cartesian here, using the
 * same analytic height function the terrain mesh was built from — so props sit
 * exactly on the ground with no raycasting and no risk of two implementations
 * disagreeing.
 */
export function surfacePoint(at: GeoPoint, offset = 0): THREE.Vector3 {
  const unit = latLonToCartesian(at.lat, at.lon, 1);
  const direction = new THREE.Vector3(unit.x, unit.y, unit.z).normalize();
  const height = PlanetTerrain.heightAt(direction);
  return direction.multiplyScalar(height + offset);
}

/** Orientation whose local +Y is the surface normal at `position`. */
export function surfaceQuaternion(position: THREE.Vector3, yaw = 0): THREE.Quaternion {
  _up.copy(position).normalize();

  _tangentA.set(0, 1, 0).projectOnPlane(_up);
  if (_tangentA.lengthSq() < 1e-6) _tangentA.set(1, 0, 0).projectOnPlane(_up);
  _tangentA.normalize().applyAxisAngle(_up, yaw);

  _tangentB.copy(_up).cross(_tangentA).normalize();

  const basis = new THREE.Matrix4().makeBasis(_tangentB, _up, _tangentA);
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

/**
 * Scatter points around a centre direction, rejecting anything underwater.
 *
 * Deterministic from `seed`, so the world regenerates identically and a bug
 * report about "the lamp in the sea" is reproducible.
 */
export function scatterAround(
  centre: THREE.Vector3,
  count: number,
  angularRadiusDeg: number,
  seed: number,
  minAltitude = SEA_LEVEL_RADIUS + 0.4,
  /**
   * Metres that must separate this point from every point in `occupied`, and
   * from the others this call places.
   *
   * Without it each prop set scatters in ignorance of the others, and with
   * enough sets on the same ground you get a stone lantern standing inside a
   * cottage. Rejection sampling is the right tool here: the counts are in the
   * dozens, the attempt budget already exists, and anything cleverer would be
   * solving a problem this world does not have.
   */
  minSeparation = 0,
  occupied: THREE.Vector3[] = [],
): THREE.Vector3[] {
  const rng = makeRng(seed);
  const results: THREE.Vector3[] = [];
  const centreDir = centre.clone().normalize();

  _tangentA.set(0, 1, 0).projectOnPlane(centreDir);
  if (_tangentA.lengthSq() < 1e-6) _tangentA.set(1, 0, 0).projectOnPlane(centreDir);
  _tangentA.normalize();
  _tangentB.copy(centreDir).cross(_tangentA).normalize();

  const maxAngle = (angularRadiusDeg * Math.PI) / 180;
  let attempts = 0;

  while (results.length < count && attempts < count * 40) {
    attempts++;
    // sqrt keeps the distribution even across the disc rather than clumping
    // at the centre.
    const angle = Math.sqrt(rng()) * maxAngle;
    const spin = rng() * Math.PI * 2;

    const direction = centreDir
      .clone()
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(_tangentA, Math.sin(angle) * Math.cos(spin))
      .addScaledVector(_tangentB, Math.sin(angle) * Math.sin(spin))
      .normalize();

    const height = PlanetTerrain.heightAt(direction);
    if (height < minAltitude) continue;

    const point = direction.multiplyScalar(height);

    if (minSeparation > 0) {
      // Compared as a straight line rather than a great circle: at these
      // distances on a 60 m sphere the two differ by millimetres, and the chord
      // is a subtraction where the arc is an acos per candidate per neighbour.
      const tooClose =
        occupied.some((other) => other.distanceToSquared(point) < minSeparation * minSeparation) ||
        results.some((other) => other.distanceToSquared(point) < minSeparation * minSeparation);
      if (tooClose) continue;
    }

    results.push(point);
  }

  return results;
}

/** Great-circle distance between two surface points, in metres. */
export function walkingDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  const na = a.clone().normalize();
  const nb = b.clone().normalize();
  return Math.acos(THREE.MathUtils.clamp(na.dot(nb), -1, 1)) * PLANET_RADIUS;
}
