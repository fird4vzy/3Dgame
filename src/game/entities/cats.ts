import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createToonMaterial } from '@engine/render/ToonMaterial';
import { makeRng } from '@core/math/rng';
import { PlanetTerrain } from '@game/world/PlanetTerrain';

/**
 * Cats.
 *
 * A world can have buildings, lamps, grass and a sky and still feel abandoned,
 * because none of those things *do* anything. One small animal that turns its
 * head does more for the sense of a place being inhabited than another hundred
 * props would — it is the only thing on screen with an apparent will of its
 * own, and the eye goes straight to it.
 *
 * They are deliberately not simulated. There is no pathfinding, no state
 * machine and no collision: a cat sits where it was placed and shifts its
 * weight, flicks its tail and looks around on its own clock. That reads as
 * alive from three metres away, which is the only distance that matters, and
 * costs a handful of sines per frame.
 *
 * Each cat is one merged geometry in one instanced draw — but the *animation*
 * needs per-cat bones, so the tail and head are separate objects parented to a
 * shared body. Fifteen cats is fifteen small groups, which is nothing.
 */

interface Cat {
  group: THREE.Group;
  head: THREE.Object3D;
  tail: THREE.Object3D;
  /** Phase offset, so no two cats move together. */
  phase: number;
  /** How fidgety this one is. */
  restlessness: number;
  /** Seconds until the next look-around. */
  lookTimer: number;
  lookTarget: number;
  lookCurrent: number;
}

/** Coats, chosen per cat. Muted, to sit inside the palette. */
const COATS = ['#3a3630', '#8a7a63', '#c6bcae', '#5d5348', '#2e2f36'];

function buildBody(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const torso = new THREE.CapsuleGeometry(0.1, 0.2, 3, 7);
  torso.rotateZ(Math.PI / 2);
  torso.translate(0, 0.13, 0);
  parts.push(torso);

  // Front legs tucked, back legs folded — a sitting cat, which is the pose
  // they hold for ninety per cent of the time anyone sees one.
  for (const x of [-0.06, 0.06]) {
    const leg = new THREE.CylinderGeometry(0.026, 0.03, 0.13, 5);
    leg.translate(x, 0.065, 0.11);
    parts.push(leg);
  }
  const haunch = new THREE.SphereGeometry(0.09, 7, 6);
  haunch.scale(1, 0.85, 1.1);
  haunch.translate(0, 0.09, -0.1);
  parts.push(haunch);

  return mergeGeometries(parts);
}

function buildHead(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const skull = new THREE.SphereGeometry(0.072, 8, 7);
  skull.scale(1, 0.94, 1.02);
  parts.push(skull);

  const muzzle = new THREE.SphereGeometry(0.038, 6, 5);
  muzzle.scale(1, 0.8, 1.1);
  muzzle.translate(0, -0.018, 0.06);
  parts.push(muzzle);

  // Ears. Triangles, and they are most of what says "cat" at this size.
  for (const x of [-0.042, 0.042]) {
    const ear = new THREE.ConeGeometry(0.032, 0.062, 4);
    ear.rotateY(Math.PI / 4);
    ear.translate(x, 0.068, -0.004);
    parts.push(ear);
  }

  return mergeGeometries(parts);
}

export class Cats {
  readonly group = new THREE.Group();
  private readonly cats: Cat[] = [];
  private time = 0;

  /**
   * @param spots  Surface positions to place cats at.
   * @param seed   Deterministic placement and colouring.
   */
  constructor(spots: THREE.Vector3[], seed = 4242) {
    this.group.name = 'cats';

    const bodyGeometry = buildBody();
    const headGeometry = buildHead();
    const tailGeometry = new THREE.CapsuleGeometry(0.018, 0.16, 3, 5);
    // Origin at the base, so rotating the tail sweeps its tip rather than
    // pivoting about its middle.
    tailGeometry.translate(0, 0.09, 0);

    const rng = makeRng(seed);

    for (const spot of spots) {
      const coat = COATS[Math.floor(rng() * COATS.length)] ?? COATS[0]!;
      const material = createToonMaterial({ color: coat });

      const group = new THREE.Group();
      // Stand it on the surface, facing a random way around the local up.
      const up = spot.clone().normalize();
      group.position.copy(spot);
      group.quaternion.copy(surfaceQuaternionAt(up, rng() * Math.PI * 2));

      group.add(new THREE.Mesh(bodyGeometry, material));

      const head = new THREE.Object3D();
      head.position.set(0, 0.235, 0.13);
      head.add(new THREE.Mesh(headGeometry, material));
      group.add(head);

      const tail = new THREE.Object3D();
      tail.position.set(0, 0.14, -0.17);
      tail.rotation.x = 0.7;
      tail.add(new THREE.Mesh(tailGeometry, material));
      group.add(tail);

      this.group.add(group);
      this.cats.push({
        group,
        head,
        tail,
        phase: rng() * Math.PI * 2,
        restlessness: 0.6 + rng() * 0.9,
        lookTimer: 1 + rng() * 5,
        lookTarget: 0,
        lookCurrent: 0,
      });
    }
  }

  /**
   * Breathing, a flicking tail, and the occasional glance.
   *
   * The tail is the loudest of the three by a distance: it is the fastest thing
   * on the animal and the only part that moves when nothing else does, so it is
   * what reads as "alive" from across a square.
   */
  update(dt: number): void {
    this.time += dt;

    for (const cat of this.cats) {
      const t = this.time * cat.restlessness + cat.phase;

      // Breathing, in the body itself.
      cat.group.scale.setScalar(1 + Math.sin(t * 1.6) * 0.012);

      // Tail: a slow base sweep with a faster flick riding on it.
      cat.tail.rotation.x = 0.7 + Math.sin(t * 0.9) * 0.14;
      cat.tail.rotation.z = Math.sin(t * 2.3) * 0.34 + Math.sin(t * 5.1) * 0.08;

      // A glance every few seconds, held, then released.
      cat.lookTimer -= dt;
      if (cat.lookTimer <= 0) {
        cat.lookTimer = 2.5 + Math.random() * 6;
        cat.lookTarget = (Math.random() - 0.5) * 1.5;
      }
      cat.lookCurrent += (cat.lookTarget - cat.lookCurrent) * (1 - Math.exp(-3 * dt));
      cat.head.rotation.y = cat.lookCurrent;
      cat.head.rotation.x = Math.sin(t * 1.3) * 0.05;
    }
  }

  dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material as THREE.Material | undefined;
      material?.dispose?.();
    });
  }
}

const _tangent = new THREE.Vector3();
const _bitangent = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _quat = new THREE.Quaternion();

/** Orientation whose +Y is the surface normal, with a yaw about it. */
function surfaceQuaternionAt(up: THREE.Vector3, yaw: number): THREE.Quaternion {
  _tangent.set(0, 1, 0).projectOnPlane(up);
  if (_tangent.lengthSq() < 1e-6) _tangent.set(1, 0, 0).projectOnPlane(up);
  _tangent.normalize().applyAxisAngle(up, yaw);
  _bitangent.copy(up).cross(_tangent).normalize();
  _basis.makeBasis(_bitangent, up, _tangent);
  return _quat.setFromRotationMatrix(_basis);
}

/** Scatter cats near a set of district centres. */
export function catSpots(
  centres: Array<{ centre: THREE.Vector3; radius: number }>,
  perDistrict: number,
  seed = 991,
): THREE.Vector3[] {
  const rng = makeRng(seed);
  const spots: THREE.Vector3[] = [];

  for (const { centre, radius } of centres) {
    const up = centre.clone().normalize();
    for (let i = 0; i < perDistrict; i++) {
      // Cats keep to the edges of a settlement rather than its middle.
      const distance = radius * (0.35 + rng() * 0.5);
      const angle = rng() * Math.PI * 2;
      const t = new THREE.Vector3(0, 1, 0).projectOnPlane(up);
      if (t.lengthSq() < 1e-6) t.set(1, 0, 0).projectOnPlane(up);
      t.normalize().applyAxisAngle(up, angle);
      // Project back onto the terrain: the offset is a direction, and the
      // ground under it is at whatever height the noise says.
      const direction = centre.clone().addScaledVector(t, distance).normalize();
      spots.push(direction.multiplyScalar(PlanetTerrain.heightAt(direction)));
    }
  }
  return spots;
}
