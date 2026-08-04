import * as THREE from 'three';

const COUNT = 140;
/** Radius around the player that petals inhabit, in metres. */
const FIELD = 14;
/** How high above the ground the field reaches. */
const CEILING = 6.5;

const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tanA = new THREE.Vector3();
const _tanB = new THREE.Vector3();
const _spin = new THREE.Quaternion();
const _basis = new THREE.Matrix4();

/**
 * Cherry blossom on the wind.
 *
 * Built the same way as {@link Fireflies} and for the same reason: each petal
 * owns a fixed offset in a cylinder around the player and is re-anchored to the
 * player's tangent frame every update, so a hundred and forty of them cost one
 * instanced draw call, none can be left on the far side of the planet, and none
 * can end up inside a hill.
 *
 * **What makes a petal read as a petal rather than as snow** is that it does
 * not fall straight. A real one stalls, slips sideways, tips over and catches
 * the air again, and the give-away of a cheap effect is a dot descending in a
 * line. So each one carries three superimposed drifts at different rates, and —
 * more importantly — **tumbles as it goes**, presenting its face and then its
 * edge. The flicker as a flat quad rotates through edge-on is not an artefact
 * here; it is most of the effect.
 *
 * They wrap rather than respawn: a petal that reaches the ground reappears at
 * the ceiling with its horizontal offset kept. Respawning at a random place
 * makes the field visibly *pop*, and on a small planet the player is always
 * close enough to notice.
 */
export class Petals {
  readonly mesh: THREE.InstancedMesh;

  private readonly seeds: Array<{
    r: number;
    theta: number;
    /** Height in the field, 0..1, advanced by fall speed and wrapped. */
    height: number;
    fall: number;
    swayRate: number;
    swayPhase: number;
    driftRate: number;
    driftPhase: number;
    tumbleRate: number;
    tumblePhase: number;
    size: number;
  }> = [];

  private time = 0;
  private density = 0;

  constructor() {
    // A petal shape, not a square: two triangles pinched at one end. At this
    // size the silhouette is three pixels, but it is three pixels that are not
    // a rectangle, and that is the difference between blossom and confetti.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-0.5, -0.5, 0, 0.5, -0.35, 0, 0.15, 0.5, 0, -0.5, -0.5, 0, 0.15, 0.5, 0, -0.35, 0.2, 0],
        3,
      ),
    );
    geometry.computeVertexNormals();

    const material = new THREE.MeshBasicMaterial({
      color: '#f7c9d8',
      transparent: true,
      opacity: 0.9,
      // Both faces: a tumbling petal shows its back half the time, and a
      // single-sided one would blink out of existence every half turn.
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, COUNT);
    this.mesh.name = 'petals';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.count = 0;

    for (let i = 0; i < COUNT; i++) {
      this.seeds.push({
        // sqrt keeps the density even across the disc instead of clumping at
        // the player's feet.
        r: Math.sqrt(Math.random()) * FIELD,
        theta: Math.random() * Math.PI * 2,
        height: Math.random(),
        fall: 0.035 + Math.random() * 0.05,
        swayRate: 0.5 + Math.random() * 0.8,
        swayPhase: Math.random() * Math.PI * 2,
        driftRate: 0.2 + Math.random() * 0.35,
        driftPhase: Math.random() * Math.PI * 2,
        tumbleRate: 1.2 + Math.random() * 2.4,
        tumblePhase: Math.random() * Math.PI * 2,
        size: 0.07 + Math.random() * 0.06,
      });
    }
  }

  /**
   * @param density 0..1. How much of the field is in use.
   *
   * Driven by how close the player is to blossom rather than being constant:
   * petals everywhere would say the whole planet is in bloom, and the trees are
   * only in one district.
   */
  setDensity(density: number): void {
    this.density = THREE.MathUtils.clamp(density, 0, 1);
  }

  update(dt: number, playerPosition: THREE.Vector3): void {
    const active = Math.round(COUNT * this.density);
    this.mesh.count = active;
    if (active === 0) return;

    this.time += dt;

    // The player's tangent frame. Everything below is expressed in it.
    _up.copy(playerPosition).normalize();
    _tanA.set(0, 1, 0).projectOnPlane(_up);
    if (_tanA.lengthSq() < 1e-6) _tanA.set(1, 0, 0).projectOnPlane(_up);
    _tanA.normalize();
    _tanB.copy(_up).cross(_tanA).normalize();

    for (let i = 0; i < active; i++) {
      const s = this.seeds[i]!;

      s.height -= s.fall * dt;
      if (s.height < 0) s.height += 1;

      // Three drifts at different rates. One would read as a pendulum; three
      // never repeat inside the time anyone watches a single petal.
      const sway = Math.sin(this.time * s.swayRate + s.swayPhase) * 1.1;
      const drift = Math.cos(this.time * s.driftRate + s.driftPhase) * 0.7;
      const rise = Math.sin(this.time * s.swayRate * 0.7 + s.swayPhase) * 0.25;

      _pos
        .copy(playerPosition)
        .addScaledVector(_tanA, Math.cos(s.theta) * s.r + sway)
        .addScaledVector(_tanB, Math.sin(s.theta) * s.r + drift)
        .addScaledVector(_up, s.height * CEILING + rise);

      // Tumble. Two axes, so it turns over as well as spinning — a petal that
      // only spins about one axis reads as a coin.
      _basis.makeBasis(_tanB, _up, _tanA);
      _quat.setFromRotationMatrix(_basis);
      _spin.setFromAxisAngle(_tanA, this.time * s.tumbleRate + s.tumblePhase);
      _quat.multiply(_spin);
      _spin.setFromAxisAngle(_tanB, this.time * s.tumbleRate * 0.6 + s.tumblePhase);
      _quat.multiply(_spin);

      _scale.setScalar(s.size);
      _matrix.compose(_pos, _quat, _scale);
      this.mesh.setMatrixAt(i, _matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
