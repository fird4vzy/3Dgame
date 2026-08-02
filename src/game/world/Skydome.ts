import * as THREE from 'three';
import { PLANET_RADIUS } from '@config/constants';

const _up = new THREE.Vector3();

/**
 * The sky.
 *
 * A shader dome rather than a flat clear colour, for a reason specific to this
 * game: **the gradient axis has to follow the player's local up.** On a planet
 * you can walk right around, a sky whose horizon band is fixed to world +Y is
 * correct in exactly one place and visibly wrong everywhere else — you would
 * see the horizon glow overhead once you reached the poles.
 *
 * It also has to *change*. The premise is light returning to a dark world, so
 * zenith colour, horizon glow and star visibility are all driven by total
 * illumination. That is also why a photographic skybox cannot simply be dropped
 * in — see docs/20-sky-and-art-assets.md.
 */
export class Skydome {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    // Inside-out sphere, comfortably outside everything else in the scene.
    const geometry = new THREE.SphereGeometry(PLANET_RADIUS * 5.5, 32, 24);

    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uIllumination: { value: 0 },
        // Dusk palette — the planet as the player finds it.
        //
        // Deliberately *not* as dark as it was. A near-black sky is a literal
        // reading of "unlit world" that costs you the world: with nothing in
        // the sky, the terrain has no silhouette to sit against, the horizon
        // vanishes, and the opening half hour is a black rectangle with a
        // character in it. Deep blue twilight still reads as "the light has
        // gone" while leaving the planet legible — and it makes the amber of
        // the first lit district land against a complement rather than against
        // nothing.
        //
        // The stops are read off a painted dusk colour key rather than picked
        // by eye. A real twilight is not two colours: it runs amber at the
        // horizon, through dusty rose and mauve, into slate, and only then to
        // indigo overhead. Two stops cannot hold that, so there is a third —
        // `uMid` — and the difference is most of what separates a sky from a
        // background.
        uZenithDark: { value: new THREE.Color('#111930') },
        uMidDark: { value: new THREE.Color('#2b3559') },
        uHorizonDark: { value: new THREE.Color('#46527a') },
        uGlowDark: { value: new THREE.Color('#7a6a86') },
        // Restored palette — a warm evening, not a blue afternoon.
        //
        // This is the colour key at full strength; the dusk set above is the
        // same ramp with the warmth drained out of it. Keeping them the same
        // family is what makes ignition read as *the light coming back* rather
        // than as a different sky being swapped in.
        uZenithLit: { value: new THREE.Color('#1c2547') },
        uMidLit: { value: new THREE.Color('#6f6b93') },
        uHorizonLit: { value: new THREE.Color('#c08a92') },
        uGlowLit: { value: new THREE.Color('#e8a87c') },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDirection;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldDirection = normalize(worldPosition.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uUp;
        uniform float uIllumination;
        uniform vec3 uZenithDark;
        uniform vec3 uMidDark;
        uniform vec3 uHorizonDark;
        uniform vec3 uGlowDark;
        uniform vec3 uZenithLit;
        uniform vec3 uMidLit;
        uniform vec3 uHorizonLit;
        uniform vec3 uGlowLit;

        varying vec3 vWorldDirection;

        void main() {
          vec3 dir = normalize(vWorldDirection);

          // Height relative to the *player's* horizon, not the world's.
          float height = dot(dir, normalize(uUp));

          vec3 zenith  = mix(uZenithDark,  uZenithLit,  uIllumination);
          vec3 mid     = mix(uMidDark,     uMidLit,     uIllumination);
          vec3 horizon = mix(uHorizonDark, uHorizonLit, uIllumination);
          vec3 glow    = mix(uGlowDark,    uGlowLit,    uIllumination);

          // Three-stop gradient, eased so the transition sits low in the frame
          // rather than splitting the sky in half. Branchless: the two mixes
          // hand over at k = 0.58, and smoothstep keeps the seam invisible.
          float t = clamp(height * 0.5 + 0.5, 0.0, 1.0);
          float k = pow(t, 0.75);
          vec3 colour = mix(
            mix(horizon, mid, smoothstep(0.0, 0.58, k)),
            zenith,
            smoothstep(0.58, 1.0, k)
          );

          // A warm band hugging the horizon, tightest and brightest once the
          // planet is lit. This is what reads as atmosphere.
          float band = exp(-abs(height) * 5.5);
          colour += glow * band * (0.45 + uIllumination * 0.75);

          // Below the horizon the dome is mostly hidden by the planet, but a
          // sliver shows from hilltops; keep it dark so it reads as ground.
          colour *= mix(0.55, 1.0, smoothstep(-0.35, 0.05, height));

          gl_FragColor = vec4(colour, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'skydome';
    // Drawn first, never culled — it surrounds everything.
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
  }

  /**
   * @param up            The player's local up vector.
   * @param illumination  0 = fully dark planet, 1 = every district lit.
   */
  update(up: THREE.Vector3, illumination: number): void {
    _up.copy(up).normalize();
    (this.material.uniforms.uUp!.value as THREE.Vector3).copy(_up);
    this.material.uniforms.uIllumination!.value = illumination;
  }

  /** Fog must match the horizon, or the terrain edge cuts against the sky. */
  horizonColour(target: THREE.Color, illumination: number): THREE.Color {
    const dark = this.material.uniforms.uHorizonDark!.value as THREE.Color;
    const lit = this.material.uniforms.uHorizonLit!.value as THREE.Color;
    return target.copy(dark).lerp(lit, illumination);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Star field.
 *
 * Kept separate from the dome because stars need to fade out as the planet
 * lights, and doing that inside the dome shader would mean a per-pixel hash
 * every frame for something a few thousand points render for free.
 */
export function createStarfield(count = 1400): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);

  const warm = new THREE.Color('#ffe6c4');
  const cool = new THREE.Color('#cfd8ff');
  const colour = new THREE.Color();

  for (let i = 0; i < count; i++) {
    // Uniform on a shell — naive lat/lon sampling clusters at the poles.
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const radius = PLANET_RADIUS * 4.6;

    positions[i * 3] = r * Math.cos(theta) * radius;
    positions[i * 3 + 1] = u * radius;
    positions[i * 3 + 2] = r * Math.sin(theta) * radius;

    // A few bright stars among many faint ones reads far better than a
    // uniform sprinkle of identical dots.
    const brightness = Math.pow(Math.random(), 3);
    colour.copy(Math.random() > 0.7 ? warm : cool);
    colour.multiplyScalar(0.35 + brightness * 0.65);
    colours[i * 3] = colour.r;
    colours[i * 3 + 1] = colour.g;
    colours[i * 3 + 2] = colour.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));

  const material = new THREE.PointsMaterial({
    vertexColors: true,
    size: 1.5,
    sizeAttenuation: false,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });

  const stars = new THREE.Points(geometry, material);
  stars.name = 'stars';
  stars.renderOrder = -999;
  stars.frustumCulled = false;
  return stars;
}
