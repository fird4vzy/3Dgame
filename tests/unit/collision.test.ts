import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { footprintBoxes, colliderTriangles } from '../../src/engine/physics/colliders';
import { BvhWorld } from '../../src/engine/physics/BvhWorld';
import { Entity } from '../../src/engine/entity/Entity';
import { SphericalCharacterController } from '../../src/game/components/SphericalCharacterController';
import type { InputManager } from '../../src/engine/input/InputManager';
import type { EventBus } from '../../src/core/events/EventBus';

/** A torii in miniature: two posts and a beam well above head height. */
function gate(): THREE.BufferGeometry {
  const left = new THREE.BoxGeometry(0.4, 4, 0.4).translate(-1.5, 2, 0);
  const right = new THREE.BoxGeometry(0.4, 4, 0.4).translate(1.5, 2, 0);
  const beam = new THREE.BoxGeometry(4, 0.4, 0.4).translate(0, 3.6, 0);
  return mergeGeometries([left, right, beam])!;
}

describe('prop colliders', () => {
  it('gives a gate its posts and leaves the way through it open', () => {
    const boxes = footprintBoxes(gate());
    expect(boxes.length).toBeGreaterThan(0);
    // Nothing near the middle, where the player walks through.
    for (const box of boxes) {
      expect(box.max.x < -1 || box.min.x > 1).toBe(true);
    }
  });

  it('is tall enough that nothing can be stood on', () => {
    for (const box of footprintBoxes(gate())) expect(box.max.y).toBeGreaterThanOrEqual(2.4);
  });

  it('ignores what is above head height or below the knee', () => {
    const awning = new THREE.BoxGeometry(3, 0.2, 3).translate(0, 2.8, 0);
    const step = new THREE.BoxGeometry(3, 0.1, 3).translate(0, 0.05, 0);
    expect(footprintBoxes(awning)).toHaveLength(0);
    expect(footprintBoxes(step)).toHaveLength(0);
  });

  it('places one set of boxes per instance', () => {
    const mesh = new THREE.InstancedMesh(gate(), new THREE.MeshBasicMaterial(), 3);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 3; i++) mesh.setMatrixAt(i, m.makeTranslation(i * 10, 0, 0));
    const perInstance = footprintBoxes(mesh.geometry).length * 36 * 3;
    expect(colliderTriangles(mesh).length).toBe(perInstance * 3);
  });
});

/** Flat ground through (0, 60, 0) tilted `degrees` about Z, as a planet's surface would be. */
function slope(degrees: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(40, 40, 8, 8).rotateX(-Math.PI / 2);
  geometry.rotateZ(THREE.MathUtils.degToRad(degrees));
  geometry.translate(0, 60, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  return mesh;
}

describe('obstacles', () => {
  it('push a capsule sideways and report it as a wall, not as ground', () => {
    const world = new BvhWorld();
    world.build(slope(0));
    const wall = new THREE.BoxGeometry(0.4, 3, 4).translate(0.5, 61.5, 0).toNonIndexed();
    world.setObstacles(new Float32Array(wall.getAttribute('position').array));

    // Walked 15 cm into the wall's face from outside.
    const start = new THREE.Vector3(0.1, 60.6, 0);
    const end = new THREE.Vector3(0.1, 61.3, 0);
    const hit = world.resolveCapsule(start, end, 0.35);

    expect(hit.wallNormal).not.toBeNull();
    expect(hit.wallNormal!.x).toBeLessThan(-0.99);
    expect(Math.abs(hit.wallNormal!.y)).toBeLessThan(1e-6);
    expect(hit.normal).toBeNull();
    // Out of the wall, and not lifted: walls never push up.
    expect(start.x).toBeLessThanOrEqual(0.3 - 0.35 + 1e-4);
    expect(start.y).toBeCloseTo(60.6, 6);
  });

  it('are never ray-cast, so nothing stands on them', () => {
    const world = new BvhWorld();
    world.build(slope(0));
    const block = new THREE.BoxGeometry(2, 2, 2).translate(0, 61, 0).toNonIndexed();
    world.setObstacles(new Float32Array(block.getAttribute('position').array));
    const hit = world.raycast(new THREE.Vector3(0, 65, 0), new THREE.Vector3(0, -1, 0), 10);
    expect(hit!.point.y).toBeCloseTo(60, 5);
  });
});

describe('standing still', () => {
  it('does not creep down a slope', () => {
    const world = new BvhWorld();
    world.build(slope(12));

    const input = {
      getAxis2D: () => ({ x: 0, y: 0 }),
      isDown: () => false,
      wasPressedWithin: () => false,
      consume: () => {},
    } as unknown as InputManager;
    const bus = { emit: () => {} } as unknown as EventBus;

    const player = new Entity('player', new THREE.Group());
    player.object3D.position.set(0, 60, 0);
    const controller = player.addComponent(
      new SphericalCharacterController({
        world,
        input,
        bus,
        camera: new THREE.PerspectiveCamera(),
        heading: (out) => out.set(0, 0, 1),
      }),
    );

    // Settle, then watch for five seconds of standing.
    for (let i = 0; i < 60; i++) controller.fixedUpdate(1 / 60);
    const settled = player.object3D.position.clone();
    for (let i = 0; i < 300; i++) controller.fixedUpdate(1 / 60);

    // It crept at about five centimetres a second before the fix.
    expect(player.object3D.position.distanceTo(settled)).toBeLessThan(0.002);
    expect(controller.planarSpeed).toBeLessThan(1e-3);
  });

  it('stands plumb on a slope, not tilted to it', () => {
    const world = new BvhWorld();
    world.build(slope(22));

    const input = {
      getAxis2D: () => ({ x: 0, y: 0 }),
      isDown: () => false,
      wasPressedWithin: () => false,
      consume: () => {},
    } as unknown as InputManager;
    const bus = { emit: () => {} } as unknown as EventBus;

    const player = new Entity('player', new THREE.Group());
    player.object3D.position.set(0, 60, 0);
    const controller = player.addComponent(
      new SphericalCharacterController({
        world,
        input,
        bus,
        camera: new THREE.PerspectiveCamera(),
        heading: (out) => out.set(0, 0, 1),
      }),
    );
    for (let i = 0; i < 120; i++) controller.fixedUpdate(1 / 60);

    // On the ground, and the ground is tilted...
    expect(controller.grounded).toBe(true);
    const radial = player.object3D.position.clone().normalize();
    expect(controller.groundNormal.angleTo(radial)).toBeGreaterThan(THREE.MathUtils.degToRad(15));
    // ...but she is not: a body tilted to a 22° slope leaned back like
    // someone about to fall over.
    const bodyUp = new THREE.Vector3(0, 1, 0).applyQuaternion(player.object3D.quaternion);
    expect(THREE.MathUtils.radToDeg(bodyUp.angleTo(radial))).toBeLessThan(1);
  });
});
