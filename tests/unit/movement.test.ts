import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeMovementBasis, inputToWorld } from '../../src/game/components/movementBasis';

const v = () => new THREE.Vector3();

/** Build a basis for a camera looking along `cameraForward` with the given up. */
function basisFor(cameraForward: THREE.Vector3, up = new THREE.Vector3(0, 1, 0)) {
  return computeMovementBasis(cameraForward, up, v(), v());
}

describe('movement basis', () => {
  it('puts screen-right at +X for the canonical camera', () => {
    // Camera looking down -Z with +Y up: right must be +X. This single
    // assertion is the one that would have caught A and D being swapped.
    const basis = basisFor(new THREE.Vector3(0, 0, -1));
    expect(basis.forward.x).toBeCloseTo(0, 6);
    expect(basis.forward.z).toBeCloseTo(-1, 6);
    expect(basis.right.x).toBeCloseTo(1, 6);
    expect(basis.right.z).toBeCloseTo(0, 6);
  });

  it('produces a right-handed frame: right × forward = up', () => {
    const up = new THREE.Vector3(0, 1, 0);
    const basis = basisFor(new THREE.Vector3(0.3, -0.8, -1), up);
    const cross = basis.right.clone().cross(basis.forward).normalize();
    expect(cross.dot(up)).toBeCloseTo(1, 5);
  });

  it('keeps forward and right perpendicular and tangent to the surface', () => {
    const up = new THREE.Vector3(0.4, 0.9, 0.2).normalize();
    const basis = basisFor(new THREE.Vector3(1, 0.5, -0.7), up);

    expect(basis.forward.dot(basis.right)).toBeCloseTo(0, 6);
    expect(basis.forward.dot(up)).toBeCloseTo(0, 6);
    expect(basis.right.dot(up)).toBeCloseTo(0, 6);
    expect(basis.forward.length()).toBeCloseTo(1, 6);
    expect(basis.right.length()).toBeCloseTo(1, 6);
  });

  it('holds the convention anywhere on the sphere, not just at the pole', () => {
    for (const up of [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(-0.6, 0.3, 0.74).normalize(),
    ]) {
      // Any camera direction not parallel to up.
      const cam = new THREE.Vector3(0.2, 0.5, -0.9);
      const basis = computeMovementBasis(cam, up, v(), v());
      const cross = basis.right.clone().cross(basis.forward).normalize();
      expect(cross.dot(up)).toBeCloseTo(1, 5);
    }
  });

  it('falls back to a deterministic tangent when looking along up', () => {
    const up = new THREE.Vector3(0, 1, 0);
    const a = computeMovementBasis(new THREE.Vector3(0, 1, 0), up, v(), v());
    const b = computeMovementBasis(new THREE.Vector3(0, 1, 0), up, v(), v());

    // Degenerate input must not produce NaN, and must not jitter between frames.
    expect(Number.isFinite(a.forward.x)).toBe(true);
    expect(a.forward.length()).toBeCloseTo(1, 6);
    expect(a.forward.distanceTo(b.forward)).toBeCloseTo(0, 6);
  });
});

describe('input mapping', () => {
  const basis = basisFor(new THREE.Vector3(0, 0, -1));

  it('maps W (+y) away from the camera', () => {
    const out = inputToWorld({ x: 0, y: 1 }, basis, v());
    expect(out.z).toBeCloseTo(-1, 6);
  });

  it('maps S (-y) toward the camera', () => {
    const out = inputToWorld({ x: 0, y: -1 }, basis, v());
    expect(out.z).toBeCloseTo(1, 6);
  });

  it('maps D (+x) to screen-right', () => {
    const out = inputToWorld({ x: 1, y: 0 }, basis, v());
    expect(out.x).toBeCloseTo(1, 6);
  });

  it('maps A (-x) to screen-left', () => {
    const out = inputToWorld({ x: -1, y: 0 }, basis, v());
    expect(out.x).toBeCloseTo(-1, 6);
  });

  it('maps A and D to exactly opposite directions', () => {
    const left = inputToWorld({ x: -1, y: 0 }, basis, v());
    const right = inputToWorld({ x: 1, y: 0 }, basis, v());
    expect(left.dot(right)).toBeCloseTo(-1, 6);
  });

  it('combines diagonals into the expected quadrant', () => {
    // W+D should go forward-and-right: -Z and +X.
    const out = inputToWorld({ x: 1, y: 1 }, basis, v());
    expect(out.x).toBeGreaterThan(0);
    expect(out.z).toBeLessThan(0);
  });

  it('produces no movement for no input', () => {
    expect(inputToWorld({ x: 0, y: 0 }, basis, v()).length()).toBeCloseTo(0, 6);
  });
});
