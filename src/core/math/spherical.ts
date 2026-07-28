/**
 * Spherical-world maths, kept renderer-agnostic so it is unit-testable without
 * a GPU. Vectors are plain `{x,y,z}`; the game layer adapts to THREE.Vector3.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Frame-rate-independent exponential smoothing.
 *
 * `lerp(a, b, rate * dt)` is wrong — it changes behaviour with frame rate. This
 * is the correct form and is used everywhere we damp toward a target.
 */
export const damp = (a: number, b: number, rate: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-rate * dt));

export const length = (v: V3): number => Math.hypot(v.x, v.y, v.z);

export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export function normalize(v: V3): V3 {
  const len = length(v);
  if (len < 1e-9) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function cross(a: V3, b: V3): V3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Remove the component of `v` parallel to the unit vector `n`. */
export function projectOnPlane(v: V3, n: V3): V3 {
  const d = dot(v, n);
  return { x: v.x - n.x * d, y: v.y - n.y * d, z: v.z - n.z * d };
}

/**
 * Geographic authoring helper: latitude/longitude in degrees plus an altitude
 * above sea level, converted to world Cartesian coordinates.
 *
 * Level data is authored as (lat, lon, alt) because that is readable and
 * diffable in JSON; nobody can hand-edit a Cartesian point on a sphere.
 */
export function latLonToCartesian(
  latDeg: number,
  lonDeg: number,
  radius: number,
  altitude = 0,
): V3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const r = radius + altitude;
  const cosLat = Math.cos(lat);
  return {
    x: r * cosLat * Math.cos(lon),
    y: r * Math.sin(lat),
    z: r * cosLat * Math.sin(lon),
  };
}

/** Inverse of {@link latLonToCartesian}. Altitude is relative to `radius`. */
export function cartesianToLatLon(
  p: V3,
  radius: number,
): { lat: number; lon: number; altitude: number } {
  const r = length(p);
  if (r < 1e-9) return { lat: 0, lon: 0, altitude: -radius };
  return {
    lat: (Math.asin(clamp(p.y / r, -1, 1)) * 180) / Math.PI,
    lon: (Math.atan2(p.z, p.x) * 180) / Math.PI,
    altitude: r - radius,
  };
}

/**
 * Great-circle distance across the surface — the real "how far must I walk",
 * which is always longer than the straight-line distance through the planet.
 */
export function surfaceDistance(a: V3, b: V3, radius: number): number {
  const na = normalize(a);
  const nb = normalize(b);
  return Math.acos(clamp(dot(na, nb), -1, 1)) * radius;
}

/**
 * Distance from the eye to the visible horizon on a sphere.
 *
 * At eye height 1.5 m on a 60 m planet this is ~27 m, which is the number the
 * whole game's legibility rests on (docs/03-gameplay-specification.md §3.1).
 */
export const horizonDistance = (radius: number, eyeHeight: number): number =>
  Math.sqrt(Math.max(0, 2 * radius * eyeHeight + eyeHeight * eyeHeight));

/**
 * Is `point` beyond the horizon as seen from `viewer`?
 *
 * Used for horizon culling: on a sphere everything on the far side is provably
 * invisible, so one dot product per object removes roughly half the scene.
 */
export function isBeyondHorizon(
  point: V3,
  viewer: V3,
  radius: number,
  slack = 0.06,
): boolean {
  const up = normalize(viewer);
  const toPoint = normalize(point);
  // cos of the angular radius of the visible cap, from the viewer's altitude.
  const viewerRadius = Math.max(length(viewer), radius);
  const cosCap = radius / viewerRadius;
  return dot(up, toPoint) < cosCap - slack;
}
