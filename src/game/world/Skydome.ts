import * as THREE from 'three';
import { PLANET_RADIUS } from '@config/constants';

/**
 * What the sky looks like this frame. Owned and interpolated by
 * `Environment`; the dome only draws it.
 */
export interface SkyState {
  /** The viewer's local up — the horizon is perpendicular to it. */
  up: THREE.Vector3;
  /** The cloud deck's own frame, held steady as the player walks. */
  tanA: THREE.Vector3;
  tanB: THREE.Vector3;
  /** Unit vector toward the sun. */
  sunDir: THREE.Vector3;
  /** Linear, HDR. Shared with the atmosphere so the two glows match. */
  sunColour: THREE.Color;
  /** Strength of the forward-scattering glow around the sun. */
  glow: number;
  zenith: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  /** The colour distant air settles to; also the fog colour. */
  haze: THREE.Color;
  /** What the lower hemisphere is, for the environment capture. */
  ground: THREE.Color;
  cloudCover: number;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  time: number;
}

/**
 * The sky.
 *
 * A shader dome rather than a background colour, for a reason specific to this
 * game: **the gradient axis has to follow the player's local up.** On a planet
 * you can walk right around, a sky whose horizon is fixed to world +Y is correct
 * in exactly one place.
 *
 * It is drawn around the *camera*, with every direction measured from it, so
 * the sun disk lands exactly where the atmosphere's sun glow says it is. (It
 * used to be measured from the planet centre, which is sixty metres away and
 * puts the sun up to ten degrees off — invisible on a gradient, glaring once
 * there is a disk and a halo to line up.)
 *
 * Its in-scattering term is the same expression the atmosphere adds to every
 * surface, so a hill in the haze and the sky behind it brighten toward the sun
 * together and the horizon melts instead of cutting.
 *
 * The same class renders the environment capture (`envMode`): there the disk
 * is dimmed so it does not seed a single blazing texel into every reflection,
 * and the lower hemisphere is ground-coloured, so surfaces facing down are lit
 * by bounce from the grass rather than by more sky.
 */
export class Skydome {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(options: { envMode?: boolean; radius?: number } = {}) {
    const geometry = new THREE.SphereGeometry(options.radius ?? PLANET_RADIUS * 5, 48, 32);

    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uTanA: { value: new THREE.Vector3(1, 0, 0) },
        uTanB: { value: new THREE.Vector3(0, 0, 1) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColour: { value: new THREE.Color(1, 1, 1) },
        uGlow: { value: 0.6 },
        uZenith: { value: new THREE.Color('#2a6bc6') },
        uMid: { value: new THREE.Color('#5ea6e8') },
        uHorizon: { value: new THREE.Color('#bfe0f5') },
        uHaze: { value: new THREE.Color('#d8e2e8') },
        uGround: { value: new THREE.Color('#4b5a3a') },
        uCloudCover: { value: 0.45 },
        uCloudLit: { value: new THREE.Color('#ffffff') },
        uCloudShade: { value: new THREE.Color('#a9bfd9') },
        uTime: { value: 0 },
        uEnvMode: { value: options.envMode ? 1 : 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vViewRay;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vViewRay = worldPosition.xyz - cameraPosition;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uUp;
        uniform vec3 uTanA;
        uniform vec3 uTanB;
        uniform vec3 uSunDir;
        uniform vec3 uSunColour;
        uniform float uGlow;
        uniform vec3 uZenith;
        uniform vec3 uMid;
        uniform vec3 uHorizon;
        uniform vec3 uHaze;
        uniform vec3 uGround;
        uniform float uCloudCover;
        uniform vec3 uCloudLit;
        uniform vec3 uCloudShade;
        uniform float uTime;
        uniform float uEnvMode;

        varying vec3 vViewRay;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p = p * 2.03 + vec2(17.1, 9.7);
            a *= 0.5;
          }
          return v;
        }

        // Cloud density along a direction, 0..1, on a deck above the viewer.
        float clouds(vec2 uv) {
          vec2 drift = vec2(uTime * 0.004, uTime * 0.0016);
          // Round blobs first — cumulus are blobs — then a finer edge that only
          // bites where the blob is already thin.
          float shape = fbm(uv * 0.55 + drift);
          float detail = fbm(uv * 2.4 - drift * 1.6 + 4.2);
          float d = shape + (detail - 0.5) * 0.22;
          float threshold = 1.0 - uCloudCover;
          return smoothstep(threshold - 0.04, threshold + 0.16, d);
        }

        void main() {
          vec3 dir = normalize(vViewRay);
          float h = dot(dir, uUp);
          float sun = max(dot(dir, uSunDir), 0.0);
          float t = max(h, 0.0);

          // Horizon to zenith, with the change sitting low in the frame.
          vec3 sky = mix(uHorizon, uMid, smoothstep(0.0, 0.35, pow(t, 0.8)));
          sky = mix(sky, uZenith, smoothstep(0.28, 1.0, t));

          // The air between here and the horizon: every long sight-line ends in
          // the same haze the fog gives the ground, so the two meet without a
          // seam.
          sky = mix(sky, uHaze, exp(-t * 9.0));

          if (h > 0.01) {
            float layer = 700.0;
            vec3 hit = dir * (layer / h);
            vec2 uv = vec2(dot(hit, uTanA), dot(hit, uTanB)) * 0.0014;

            float density = clouds(uv);
            // Where the deck thickens toward the sun the pixel is in its own
            // shadow; where it thins toward the sun, light gets through.
            vec2 toSun = normalize(vec2(dot(uSunDir, uTanA), dot(uSunDir, uTanB)) + 1e-4);
            float towardSun = clouds(uv + toSun * 0.06);
            float lit = smoothstep(-0.35, 0.35, density - towardSun);

            vec3 cloud = mix(uCloudShade, uCloudLit, lit);
            // Silver lining: thin cloud near the sun is lit through.
            cloud += uSunColour * pow(sun, 5.0) * (1.0 - density) * 0.6;
            // Distant cloud is seen through more air.
            cloud = mix(cloud, uHaze, exp(-t * 5.0) * 0.7);

            float horizonFade = smoothstep(0.02, 0.24, h);
            float zenithThin = 1.0 - smoothstep(0.75, 1.0, h) * 0.35;
            sky = mix(sky, cloud, density * horizonFade * zenithThin * 0.95);
          }

          // In-scattering toward the sun — the identical expression to the
          // atmosphere's, so hills and sky warm together.
          sky += uSunColour * (pow(sun, 8.0) * 0.55 + pow(sun, 48.0) * 0.45) * uGlow;

          // The disk, with a soft limb. Bright enough to bloom into the halo the
          // eye expects; dimmed in the capture so reflections do not sparkle.
          float disk = smoothstep(0.99962, 0.99988, sun);
          sky += uSunColour * disk * mix(36.0, 2.0, uEnvMode);

          // Below the horizon: in play the planet covers it, but a sliver shows
          // from hilltops and it should read as distant ground. In the capture
          // it is the ground the bounce light comes from.
          float below = smoothstep(0.0, -0.1, h);
          vec3 low = mix(mix(uHaze, uGround, 0.55), uGround, uEnvMode);
          sky = mix(sky, low, below);

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = options.envMode ? 'skydome_capture' : 'skydome';
    // Drawn first, never culled — it surrounds everything.
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
  }

  apply(state: SkyState): void {
    const u = this.material.uniforms;
    (u.uUp!.value as THREE.Vector3).copy(state.up).normalize();
    (u.uTanA!.value as THREE.Vector3).copy(state.tanA);
    (u.uTanB!.value as THREE.Vector3).copy(state.tanB);
    (u.uSunDir!.value as THREE.Vector3).copy(state.sunDir);
    (u.uSunColour!.value as THREE.Color).copy(state.sunColour);
    u.uGlow!.value = state.glow;
    (u.uZenith!.value as THREE.Color).copy(state.zenith);
    (u.uMid!.value as THREE.Color).copy(state.mid);
    (u.uHorizon!.value as THREE.Color).copy(state.horizon);
    (u.uHaze!.value as THREE.Color).copy(state.haze);
    (u.uGround!.value as THREE.Color).copy(state.ground);
    u.uCloudCover!.value = state.cloudCover;
    (u.uCloudLit!.value as THREE.Color).copy(state.cloudLit);
    (u.uCloudShade!.value as THREE.Color).copy(state.cloudShade);
    u.uTime!.value = state.time;
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
