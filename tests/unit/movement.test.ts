import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeMovementBasis, inputToWorld } from '../../src/game/components/movementBasis';
import { InputManager } from '../../src/engine/input/InputManager';
import type { EventBus } from '../../src/core/events/EventBus';

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

describe('mouse look', () => {
  /** Just enough of the pointer-lock API: a document and a canvas that can be locked. */
  function fakePage(): { input: InputManager; calls: string[]; restore: () => void } {
    const calls: string[] = [];
    const page = { pointerLockElement: null as unknown, exitPointerLock: () => undefined };
    const canvas = {
      requestPointerLock: () => {
        calls.push('lock');
        page.pointerLockElement = canvas;
        return Promise.resolve();
      },
    };
    page.exitPointerLock = () => {
      calls.push('unlock');
      page.pointerLockElement = null;
    };
    const had = 'document' in globalThis;
    const previous = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = page;
    const input = new InputManager(canvas as unknown as HTMLElement, { emit: () => undefined } as unknown as EventBus);
    const restore = (): void => {
      if (had) (globalThis as { document?: unknown }).document = previous;
      else delete (globalThis as { document?: unknown }).document;
    };
    return { input, calls, restore };
  }

  it('takes the pointer when play starts and gives it back for menus', () => {
    const { input, calls, restore } = fakePage();
    try {
      input.setEnabled(false);
      expect(calls).toEqual([]);
      input.setEnabled(true);
      expect(input.pointerLocked).toBe(true);
      input.setEnabled(false);
      expect(calls).toEqual(['lock', 'unlock']);
      expect(input.pointerLocked).toBe(false);
    } finally {
      restore();
    }
  });

  it('turns the camera on plain mouse movement while locked, no button held', () => {
    const { input, restore } = fakePage();
    try {
      input.setEnabled(true);
      const move = (input as unknown as { onPointerMove: (e: Partial<PointerEvent>) => void }).onPointerMove;
      move({ pointerType: 'mouse', pointerId: 1, movementX: 6, movementY: -3 });
      move({ pointerType: 'mouse', pointerId: 1, movementX: 4, movementY: 1 });
      input.beginFrame(1 / 60);
      expect(input.getAxis2D('look')).toEqual({ x: 10, y: -2 });
    } finally {
      restore();
    }
  });

  it('ignores plain movement when not locked, as before', () => {
    const { input, restore } = fakePage();
    try {
      input.setEnabled(false);
      const move = (input as unknown as { onPointerMove: (e: Partial<PointerEvent>) => void }).onPointerMove;
      (input as unknown as { enabled: boolean }).enabled = true;
      move({ pointerType: 'mouse', pointerId: 1, movementX: 6, movementY: -3 });
      input.beginFrame(1 / 60);
      expect(input.getAxis2D('look')).toEqual({ x: 0, y: 0 });
    } finally {
      restore();
    }
  });
});
