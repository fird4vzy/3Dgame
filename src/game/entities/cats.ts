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
  /** Seconds of being pleased about something, counting down. */
  happy: number;
  /** How many times this one has been petted, so it can warm to you. */
  pets: number;
}

const _matrix = new THREE.Matrix4();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _toPoint = new THREE.Vector3();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _tilt = new THREE.Quaternion();
const _axisX = new THREE.Vector3(1, 0, 0);
const _hiddenMatrix = new THREE.Matrix4();

/** How long the delight from one pet lasts, in seconds. */
const PET_DURATION = 1.4;

export class Cats {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  /** The same cats with their eyes shut, shown while being petted. */
  private happyMesh: THREE.InstancedMesh | null = null;
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
        happy: 0,
        pets: 0,
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
    const options = {
      // A cat is about 45 cm sitting. Getting this wrong is the single most
      // obvious import error there is.
      height: 0.45,
      anchor: 'feet' as const,
      // Left alone: the model's own colours are the point of buying it, and
      // this one already sits inside the palette.
      harmonise: 0,
      castShadow: true,
      receiveShadow: true,
    };

    // Two models, one per expression.
    //
    // A rigid mesh has no blendshapes and no bones, so its face cannot change —
    // the expression is painted into the texture. Body language alone got the
    // *feeling* across, but a cat being petted with its eyes wide open is still
    // a cat that has not reacted, and that was the honest limit of the previous
    // pass.
    //
    // So there are two: eyes open, and eyes squeezed shut mid-purr. Same
    // colours, same collar, same bell. Both are instanced over the same spots,
    // and `update` writes a zero scale into whichever one should not be seen —
    // a degenerate instance costs nothing and needs no per-instance visibility,
    // which InstancedMesh does not have.
    const [calm, happy] = await Promise.all([
      loadInstancedProp(`${baseUrl}assets/models/cat.glb`, this.spots, this.seed, options),
      loadInstancedProp(`${baseUrl}assets/models/cat_happy.glb`, this.spots, this.seed, options),
    ]);

    this.mesh = calm;
    this.happyMesh = happy;
    if (calm) this.group.add(calm);
    if (happy) this.group.add(happy);
  }

  /**
   * Breathing, and the occasional decision to look somewhere else.
   *
   * The turn is what carries it. Breathing alone reads as an object with a
   * wobble; a body that *changes where it is facing*, holds it, and later
   * changes again reads as something making up its own mind.
   */
  update(dt: number, playerPosition?: THREE.Vector3): void {
    const mesh = this.mesh;
    if (!mesh) return;

    this.time += dt;
    const follow = 1 - Math.exp(-2.4 * dt);

    for (let i = 0; i < this.cats.length; i++) {
      const cat = this.cats[i]!;
      const t = this.time * cat.restlessness + cat.phase;

      if (cat.happy > 0) cat.happy = Math.max(0, cat.happy - dt);

      // A cat that has been petted watches you instead of the middle distance.
      //
      // This is the cheapest possible bond and it does an enormous amount: an
      // animal that keeps facing you after you touched it reads as having
      // *remembered*, where one that goes back to staring at the horizon reads
      // as scenery that happened to have an animation on it.
      const watching = playerPosition && (cat.happy > 0 || cat.pets > 0);
      if (watching) {
        cat.targetYaw = this.yawToward(cat, playerPosition);
      } else {
        cat.turnTimer -= dt;
        if (cat.turnTimer <= 0) {
          cat.turnTimer = 3 + Math.random() * 7;
          // A glance, not a spin: cats reorient by less than a right angle far
          // more often than they turn around.
          cat.targetYaw += (Math.random() - 0.5) * 1.6;
        }
      }
      cat.yaw += (cat.targetYaw - cat.yaw) * (watching ? follow * 1.6 : follow);

      // Breathing, plus a slower settle that makes it look like weight is
      // being shifted rather than the whole animal pulsing.
      let breath = 1 + Math.sin(t * 1.6) * 0.014 + Math.sin(t * 0.43) * 0.008;

      // Being petted.
      //
      // The first attempt was a 9% squash, which on a rigid mesh is no reaction
      // at all. The second made it *hop* — visible, and wrong: a hop is a
      // spring, and it turned the animal into a toy. That is the whole lesson
      // here. Speed is what separates a creature from a mechanism, and the
      // instinct to make a reaction louder by making it faster is exactly
      // backwards.
      //
      // What a cat actually does when you touch it is **press into the hand**.
      // So: it leans *toward* whoever is petting it, rises briefly onto its
      // front paws, arches, and settles — slowly, on a single eased swell with
      // no bounce anywhere in it.
      let lift = 0;
      let pressToward = 0;
      if (cat.happy > 0) {
        const k = cat.happy / PET_DURATION;
        // One swell: in, hold, out. `k` runs 1 -> 0, so this peaks in the
        // middle of the window and eases off both sides.
        const swell = Math.sin((1 - k) * Math.PI);
        lift = swell * 0.045;
        // An arch, not a pulse — up through the shoulders as it presses.
        breath += swell * 0.05;
        pressToward = swell * 0.34;
      }

      _scale.setScalar(cat.scale * breath);
      _up.copy(cat.position).normalize();
      _position.copy(cat.position).addScaledVector(_up, lift);

      _quat.copy(orientToSurface(cat.position, cat.yaw));
      if (pressToward > 0) {
        // Tip *forward*, into the hand. Tipping back reads as recoiling — as
        // an animal avoiding the touch, which is the opposite of the point.
        _tilt.setFromAxisAngle(_axisX, pressToward);
        _quat.multiply(_tilt);
      }

      _matrix.compose(_position, _quat, _scale);

      // Show exactly one face.
      //
      // The expression flips a beat *before* the delight fades, not with it: a
      // cat whose eyes snap open the instant the hand stops looks startled.
      // Holding the squint slightly longer than the body movement is what makes
      // it read as contentment trailing off.
      const showHappy = cat.happy > PET_DURATION * 0.12;
      const shown = showHappy ? this.happyMesh : mesh;
      const hidden = showHappy ? mesh : this.happyMesh;

      shown?.setMatrixAt(i, _matrix);
      if (hidden) {
        _hiddenMatrix.makeScale(0, 0, 0);
        hidden.setMatrixAt(i, _hiddenMatrix);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (this.happyMesh) this.happyMesh.instanceMatrix.needsUpdate = true;
  }

  /** Yaw about the local up that faces this cat at a world point. */
  private yawToward(cat: Cat, point: THREE.Vector3): number {
    const up = _up.copy(cat.position).normalize();
    _forward.set(0, 1, 0).projectOnPlane(up);
    if (_forward.lengthSq() < 1e-6) _forward.set(1, 0, 0).projectOnPlane(up);
    _forward.normalize();
    _right.copy(up).cross(_forward).normalize();

    _toPoint.copy(point).sub(cat.position).projectOnPlane(up);
    if (_toPoint.lengthSq() < 1e-8) return cat.yaw;
    _toPoint.normalize();

    return Math.atan2(_right.dot(_toPoint), _forward.dot(_toPoint));
  }

  /** Every cat, with its world position — for registering interactions. */
  positions(): ReadonlyArray<{ index: number; position: THREE.Vector3 }> {
    return this.cats.map((cat, index) => ({ index, position: cat.position }));
  }

  /** Whether this cat has been petted before. */
  isFriend(index: number): boolean {
    return (this.cats[index]?.pets ?? 0) > 0;
  }

  /**
   * Pet one.
   *
   * Returns false if the index is wrong, so the caller can tell a real
   * interaction from a stale one rather than silently doing nothing.
   */
  pet(index: number): boolean {
    const cat = this.cats[index];
    if (!cat) return false;
    cat.happy = PET_DURATION;
    cat.pets++;
    return true;
  }

  dispose(): void {
    for (const mesh of [this.mesh, this.happyMesh]) {
      mesh?.geometry.dispose();
      (mesh?.material as THREE.Material | undefined)?.dispose();
    }
    this.mesh = null;
    this.happyMesh = null;
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
