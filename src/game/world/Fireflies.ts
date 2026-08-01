import * as THREE from 'three';

const COUNT = 90;
/** Radius around the player that fireflies inhabit. */
const FIELD = 16;

const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tanA = new THREE.Vector3();
const _tanB = new THREE.Vector3();
const _colour = new THREE.Color();

/**
 * Drifting motes that follow the player around the planet.
 *
 * They are not simulated in world space. Each one owns a fixed offset within a
 * disc around the player and wanders on its own pair of sine waves; the whole
 * field is re-anchored to the player's tangent frame every update. That means
 * ninety of them cost one instanced draw call and no bookkeeping, and — the
 * part that matters on a planet this small — none of them can be left behind on
 * the far side of the world or found floating inside a hill.
 *
 * Density follows the local district's illumination: a dark district gets a
 * handful of cold sparks, a lit one fills with warm ones. The world getting
 * *livelier* as it wakes is the same promise the lamps and the music stems
 * make, and this is the cheapest possible way to say it again.
 */
export class Fireflies {
  readonly mesh: THREE.InstancedMesh;

  /** Per-mote constants: disc offset, drift rates, phases, height. */
  private readonly seeds: Array<{
    r: number;
    theta: number;
    height: number;
    rateA: number;
    rateB: number;
    phaseA: number;
    phaseB: number;
    size: number;
  }> = [];

  private time = 0;

  constructor() {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      map: softDot(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      toneMapped: false,
      fog: false,
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'fireflies';
    this.mesh.count = 0;

    for (let i = 0; i < COUNT; i++) {
      this.seeds.push({
        // sqrt keeps the disc evenly filled rather than clumped at the centre.
        r: Math.sqrt(Math.random()) * FIELD,
        theta: Math.random() * Math.PI * 2,
        height: 0.5 + Math.random() * 2.6,
        rateA: 0.25 + Math.random() * 0.5,
        rateB: 0.18 + Math.random() * 0.4,
        phaseA: Math.random() * Math.PI * 2,
        phaseB: Math.random() * Math.PI * 2,
        size: 0.05 + Math.random() * 0.07,
      });
    }
  }

  /**
   * @param playerPosition Where the field is centred.
   * @param camera         For billboarding.
   * @param light          0–1 illumination of the district underfoot.
   * @param litColour      That district's lit colour, for warm motes.
   */
  update(
    dt: number,
    playerPosition: THREE.Vector3,
    camera: THREE.Camera,
    light: number,
    litColour: THREE.Color,
  ): void {
    this.time += dt;

    // Even a dark district keeps a few, so the world is never sterile.
    const active = Math.round(COUNT * (0.18 + light * 0.82));
    this.mesh.count = active;
    if (active === 0) return;

    // Tangent frame at the player, so the disc lies on the ground wherever
    // they are standing.
    _up.copy(playerPosition).normalize();
    _tanA.set(0, 1, 0).projectOnPlane(_up);
    if (_tanA.lengthSq() < 1e-6) _tanA.set(1, 0, 0).projectOnPlane(_up);
    _tanA.normalize();
    _tanB.copy(_up).cross(_tanA).normalize();

    camera.getWorldQuaternion(_quat);
    const colours = this.mesh.instanceColor;

    for (let i = 0; i < active; i++) {
      const s = this.seeds[i]!;

      // Wander: the offset breathes in and out and swings a little.
      const wobbleR = Math.sin(this.time * s.rateA + s.phaseA) * 1.6;
      const wobbleT = Math.sin(this.time * s.rateB + s.phaseB) * 0.22;
      const bob = Math.sin(this.time * s.rateA * 1.7 + s.phaseB) * 0.35;

      const r = s.r + wobbleR;
      const theta = s.theta + wobbleT;

      _pos
        .copy(playerPosition)
        .addScaledVector(_tanA, Math.cos(theta) * r)
        .addScaledVector(_tanB, Math.sin(theta) * r)
        .addScaledVector(_up, s.height + bob);

      // Blink: never fully out, so they read as fireflies rather than as
      // flickering artefacts.
      const blink = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.time * (1.1 + s.rateB) + s.phaseA));

      _scale.setScalar(s.size);
      _matrix.compose(_pos, _quat, _scale);
      this.mesh.setMatrixAt(i, _matrix);

      if (colours) {
        // Cold sparks in the dark, the district's own colour once it is lit.
        _colour.set('#7fa8d8').lerp(litColour, light).multiplyScalar(blink);
        colours.setXYZ(i, _colour.r, _colour.g, _colour.b);
      }
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (colours) colours.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

let _dot: THREE.Texture | null = null;

/** Radial falloff, generated so a mote is a glow and not a square. */
function softDot(): THREE.Texture {
  if (_dot) return _dot;

  const size = 32;
  const data = new Uint8Array(size * size * 4);
  const centre = (size - 1) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - centre) / centre;
      const dy = (y - centre) / centre;
      const falloff = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(Math.pow(falloff, 2.0) * 255);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  _dot = texture;
  return texture;
}
