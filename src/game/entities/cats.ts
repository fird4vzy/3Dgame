import * as THREE from 'three';
import { makeRng } from '@core/math/rng';
import { PlanetTerrain } from '@game/world/PlanetTerrain';
import { loadInstancedProp, orientToSurface } from '@engine/render/instancedProp';

/**
 * Cats.
 *
 * A world can have buildings, lamps, grass and a sky and still feel abandoned,
 * because none of those things *do* anything. One small animal that shifts its
 * weight does more for the sense of a place being inhabited than another
 * hundred props would — it is the only thing on screen with an apparent will of
 * its own, and the eye goes straight to it.
 *
 * These were assembled from capsules and cones, which read as *a cat* by
 * silhouette and could never read as *cute*: that lives in fur and eyes, and
 * those are texture, not geometry. They are now an authored model.
 *
 * **The animation had to change with the art.** A primitive cat had a head and
 * a tail as separate objects, so it could flick and glance. An imported model
 * is one rigid mesh with no bones, so nothing inside it can move on its own.
 * Rather than fake a hierarchy by cutting the mesh up, this animates the whole
 * body — breathing, a slow settle, and a deliberate turn to look at something
 * — which is what a sitting cat does anyway, and it keeps all fifteen of them
 * in a **single draw call** through one InstancedMesh.
 *
 * The trade is honest: no tail flick, and one draw call instead of forty-five.
 */

interface Cat {
  position: THREE.Vector3;
  /** Facing, in radians about the surface normal. */
  yaw: number;
  targetYaw: number;
  /** Phase offset, so no two cats breathe together. */
  phase: number;
  /** How fidgety this one is. */
  restlessness: number;
  scale: number;
  /** Seconds until it next decides to face somewhere else. */
  turnTimer: number;
}

const _matrix = new THREE.Matrix4();
const _scale = new THREE.Vector3();

export class Cats {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private readonly cats: Cat[] = [];
  private time = 0;

  constructor(private readonly spots: THREE.Vector3[], private readonly seed = 4242) {
    this.group.name = 'cats';

    const rng = makeRng(seed);
    for (const spot of spots) {
      const yaw = rng() * Math.PI * 2;
      this.cats.push({
        position: spot,
        yaw,
        targetYaw: yaw,
        phase: rng() * Math.PI * 2,
        restlessness: 0.6 + rng() * 0.9,
        scale: 0.9 + rng() * 0.3,
        turnTimer: 2 + rng() * 6,
      });
    }
  }

  /**
   * Load the art and build the instanced mesh.
   *
   * Separate from the constructor because loading is async and the scene is
   * assembled synchronously. A cat that never arrives is a missing cat, not a
   * broken world — `loadInstancedProp` returns null rather than throwing.
   */
  async load(baseUrl = ''): Promise<void> {
    this.mesh = await loadInstancedProp(
      `${baseUrl}assets/models/cat.glb`,
      this.spots,
      this.seed,
      {
        // A cat is about 45 cm sitting. Getting this wrong is the single most
        // obvious import error there is.
        height: 0.45,
        anchor: 'feet',
        // Left alone: the model's own colours are the point of buying it, and
        // this one already sits inside the palette.
        harmonise: 0,
        castShadow: true,
        receiveShadow: true,
      },
    );
    if (this.mesh) this.group.add(this.mesh);
  }

  /**
   * Breathing, and the occasional decision to look somewhere else.
   *
   * The turn is what carries it. Breathing alone reads as an object with a
   * wobble; a body that *changes where it is facing*, holds it, and later
   * changes again reads as something making up its own mind.
   */
  update(dt: number): void {
    const mesh = this.mesh;
    if (!mesh) return;

    this.time += dt;
    const follow = 1 - Math.exp(-2.4 * dt);

    for (let i = 0; i < this.cats.length; i++) {
      const cat = this.cats[i]!;
      const t = this.time * cat.restlessness + cat.phase;

      cat.turnTimer -= dt;
      if (cat.turnTimer <= 0) {
        cat.turnTimer = 3 + Math.random() * 7;
        // A glance, not a spin: cats reorient by less than a right angle far
        // more often than they turn around.
        cat.targetYaw += (Math.random() - 0.5) * 1.6;
      }
      cat.yaw += (cat.targetYaw - cat.yaw) * follow;

      // Breathing, plus a slower settle that makes it look like weight is
      // being shifted rather than the whole animal pulsing.
      const breath = 1 + Math.sin(t * 1.6) * 0.014 + Math.sin(t * 0.43) * 0.008;
      _scale.setScalar(cat.scale * breath);

      _matrix.compose(cat.position, orientToSurface(cat.position, cat.yaw), _scale);
      mesh.setMatrixAt(i, _matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh?.geometry.dispose();
    (this.mesh?.material as THREE.Material | undefined)?.dispose();
    this.mesh = null;
  }
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
