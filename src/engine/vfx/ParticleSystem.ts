import * as THREE from 'three';

export interface EmitOptions {
  position: THREE.Vector3;
  count: number;
  colour: THREE.Color;
  /** Initial speed range, metres per second. */
  speed?: [number, number];
  /** Lifetime range, seconds. */
  life?: [number, number];
  size?: [number, number];
  /** Acceleration applied every tick — usually gravity toward the planet. */
  gravity?: THREE.Vector3;
  /** Bias the initial direction (e.g. "up" on a sphere). */
  direction?: THREE.Vector3;
  /** 0 = perfectly along `direction`, 1 = fully spherical. */
  spread?: number;
  drag?: number;
}

interface Particle {
  alive: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  colour: THREE.Color;
  age: number;
  life: number;
  size: number;
  gravity: THREE.Vector3 | null;
  drag: number;
}

const _matrix = new THREE.Matrix4();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _dir = new THREE.Vector3();
const _tangentA = new THREE.Vector3();
const _tangentB = new THREE.Vector3();

/**
 * Pooled, instanced particles.
 *
 * Particles bypass the entity/component model entirely — a few hundred of them
 * are exactly the case where a flat array plus one `InstancedMesh` beats
 * per-object overhead, and it is the split called out in
 * docs/04-technical-architecture.md §4.3. Nothing here allocates after
 * construction: the pool is fixed and dead particles are reused in place.
 *
 * One draw call covers every emitter, because they all share one mesh.
 */
export class ParticleSystem {
  readonly mesh: THREE.InstancedMesh;

  private readonly particles: Particle[] = [];
  private readonly capacity: number;
  private cursor = 0;
  private liveCount = 0;

  constructor(capacity = 400) {
    this.capacity = capacity;

    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      map: softDotTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // Colour comes from the instance attribute, not the material, so one
      // system serves every emitter regardless of palette.
      vertexColors: true,
      toneMapped: false,
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = 'particles';

    const colours = new Float32Array(capacity * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colours, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < capacity; i++) {
      this.particles.push({
        alive: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        colour: new THREE.Color(),
        age: 0,
        life: 1,
        size: 0.1,
        gravity: null,
        drag: 0,
      });
    }
  }

  get activeCount(): number {
    return this.liveCount;
  }

  emit(options: EmitOptions): void {
    const {
      position,
      count,
      colour,
      speed = [1, 3],
      life = [0.5, 1.2],
      size = [0.06, 0.14],
      gravity,
      direction,
      spread = 1,
      drag = 0.6,
    } = options;

    // Build a basis around the bias direction so `spread` is meaningful.
    if (direction) {
      _dir.copy(direction).normalize();
      _tangentA.set(0, 1, 0).cross(_dir);
      if (_tangentA.lengthSq() < 1e-6) _tangentA.set(1, 0, 0).cross(_dir);
      _tangentA.normalize();
      _tangentB.copy(_dir).cross(_tangentA).normalize();
    }

    for (let i = 0; i < count; i++) {
      const particle = this.nextFree();
      if (!particle) return;

      particle.alive = true;
      particle.age = 0;
      particle.life = randomBetween(life);
      particle.size = randomBetween(size);
      particle.colour.copy(colour);
      particle.position.copy(position);
      particle.gravity = gravity ?? null;
      particle.drag = drag;

      const magnitude = randomBetween(speed);
      if (direction) {
        const theta = Math.random() * Math.PI * 2;
        const radial = Math.random() * spread;
        particle.velocity
          .copy(_dir)
          .multiplyScalar(1 - radial * 0.5)
          .addScaledVector(_tangentA, Math.cos(theta) * radial)
          .addScaledVector(_tangentB, Math.sin(theta) * radial)
          .normalize()
          .multiplyScalar(magnitude);
      } else {
        particle.velocity
          .set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
          .normalize()
          .multiplyScalar(magnitude);
      }
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    if (this.liveCount === 0) {
      this.mesh.count = 0;
      return;
    }

    // Camera-facing quads: one quaternion for every particle this frame.
    camera.getWorldQuaternion(_quat);

    const colours = this.mesh.instanceColor;
    let written = 0;
    let live = 0;

    for (const particle of this.particles) {
      if (!particle.alive) continue;

      particle.age += dt;
      if (particle.age >= particle.life) {
        particle.alive = false;
        continue;
      }
      live++;

      if (particle.gravity) particle.velocity.addScaledVector(particle.gravity, dt);
      if (particle.drag > 0) particle.velocity.multiplyScalar(1 - particle.drag * dt);
      particle.position.addScaledVector(particle.velocity, dt);

      // Fade out and shrink over the second half of life.
      const t = particle.age / particle.life;
      const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      const scale = particle.size * (0.6 + fade * 0.4);

      _scale.setScalar(scale);
      _matrix.compose(particle.position, _quat, _scale);
      this.mesh.setMatrixAt(written, _matrix);

      if (colours) {
        // Additive blending means brightness *is* opacity.
        colours.setXYZ(
          written,
          particle.colour.r * fade,
          particle.colour.g * fade,
          particle.colour.b * fade,
        );
      }
      written++;
    }

    this.liveCount = live;
    this.mesh.count = written;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colours) colours.needsUpdate = true;
  }

  clear(): void {
    for (const particle of this.particles) particle.alive = false;
    this.liveCount = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  /**
   * Ring-buffer allocation: at capacity the oldest particle is recycled rather
   * than dropping the emit. A burst that visibly fails to appear is worse than
   * one that quietly steals a fading particle.
   */
  private nextFree(): Particle | null {
    for (let attempt = 0; attempt < this.capacity; attempt++) {
      const particle = this.particles[this.cursor];
      this.cursor = (this.cursor + 1) % this.capacity;
      if (particle && !particle.alive) {
        this.liveCount++;
        return particle;
      }
    }
    // Everything is alive — steal the one the cursor lands on.
    const victim = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    return victim ?? null;
  }
}

const randomBetween = ([min, max]: [number, number]): number => min + Math.random() * (max - min);

let _softDot: THREE.Texture | null = null;

/**
 * A radial falloff, generated rather than shipped.
 *
 * Without it an additive quad renders as a hard-edged square — visibly wrong
 * for embers and dust. Generating the 64x64 ramp in code costs nothing, saves
 * an asset round-trip, and means particles look right before any art exists.
 */
function softDotTexture(): THREE.Texture {
  if (_softDot) return _softDot;

  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const centre = (size - 1) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - centre) / centre;
      const dy = (y - centre) / centre;
      const distance = Math.sqrt(dx * dx + dy * dy);
      // Smooth falloff to zero at the edge, with a brighter core.
      const falloff = Math.max(0, 1 - distance);
      const value = Math.round(Math.pow(falloff, 2.2) * 255);

      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = value;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  _softDot = texture;
  return texture;
}
