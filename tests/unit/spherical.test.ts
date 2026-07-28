import { describe, it, expect } from 'vitest';
import {
  cartesianToLatLon,
  clamp,
  cross,
  damp,
  dot,
  horizonDistance,
  isBeyondHorizon,
  latLonToCartesian,
  normalize,
  projectOnPlane,
  surfaceDistance,
} from '../../src/core/math/spherical';

describe('spherical math', () => {
  it('normalises to unit length and survives a zero vector', () => {
    const n = normalize({ x: 3, y: 0, z: 4 });
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 10);
    expect(normalize({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('round-trips lat/lon through cartesian', () => {
    const radius = 60;
    for (const [lat, lon, alt] of [
      [0, 0, 0],
      [45, 90, 3],
      [-30, -170, -2],
      [89, 12, 0],
    ] as const) {
      const point = latLonToCartesian(lat, lon, radius, alt);
      const back = cartesianToLatLon(point, radius);
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(back.lon).toBeCloseTo(lon, 6);
      expect(back.altitude).toBeCloseTo(alt, 6);
    }
  });

  it('places latitude on the correct hemisphere', () => {
    expect(latLonToCartesian(90, 0, 60).y).toBeCloseTo(60, 6);
    expect(latLonToCartesian(-90, 0, 60).y).toBeCloseTo(-60, 6);
  });

  it('measures surface distance along a great circle, not through the planet', () => {
    const radius = 60;
    const a = latLonToCartesian(0, 0, radius);
    const b = latLonToCartesian(0, 90, radius);
    // A quarter of the circumference.
    expect(surfaceDistance(a, b, radius)).toBeCloseTo((Math.PI / 2) * radius, 6);
    // Always longer than the chord through the interior.
    const chord = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    expect(surfaceDistance(a, b, radius)).toBeGreaterThan(chord);
  });

  it('puts the horizon ~13.5m away at eye height on a 60m planet', () => {
    // The number the game's legibility rests on (docs/03 §3.1). Pinned here so
    // a change to PLANET_RADIUS cannot quietly alter how far you can see.
    expect(horizonDistance(60, 1.5)).toBeCloseTo(13.5, 2);
  });

  it('grows the horizon with the square root of the radius', () => {
    // The lever if playtesting says 13.5m is too claustrophobic. Quadrupling the
    // radius roughly doubles the sightline (the h² term makes it slightly less).
    const ratio = horizonDistance(240, 1.5) / horizonDistance(60, 1.5);
    expect(ratio).toBeGreaterThan(1.98);
    expect(ratio).toBeLessThanOrEqual(2);
  });

  it('culls points on the far side of the planet but not nearby ones', () => {
    const radius = 60;
    const viewer = { x: 0, y: 61.5, z: 0 };
    const antipode = { x: 0, y: -60, z: 0 };
    const nearby = latLonToCartesian(86, 0, radius);

    expect(isBeyondHorizon(antipode, viewer, radius)).toBe(true);
    expect(isBeyondHorizon(nearby, viewer, radius)).toBe(false);
  });

  it('projects onto the tangent plane, removing the radial component', () => {
    const up = { x: 0, y: 1, z: 0 };
    const projected = projectOnPlane({ x: 2, y: 5, z: -1 }, up);
    expect(projected.y).toBeCloseTo(0, 10);
    expect(dot(projected, up)).toBeCloseTo(0, 10);
  });

  it('builds a right-handed basis with cross', () => {
    const c = cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(c).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('damps frame-rate independently', () => {
    // One 0.1s step must land in the same place as ten 0.01s steps.
    const once = damp(0, 10, 5, 0.1);
    let stepped = 0;
    for (let i = 0; i < 10; i++) stepped = damp(stepped, 10, 5, 0.01);
    expect(once).toBeCloseTo(stepped, 6);
  });

  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});
