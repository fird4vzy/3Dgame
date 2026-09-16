import * as THREE from 'three';
import { PLANET_RADIUS } from '@config/constants';

const _up = new THREE.Vector3();
const _tanA = new THREE.Vector3();
const _tanB = new THREE.Vector3();
const _colour = new THREE.Color();

/**
 * The sky.
 *
 * A shader dome rather than a flat clear colour, for a reason specific to this
 * game: **the gradient axis has to follow the player's local up.** On a planet
 * you can walk right around, a sky whose horizon band is fixed to world +Y is
 * correct in exactly one place and visibly wrong everywhere else — you would
 * see the horizon glow overhead once you reached the poles.
 *
 * It is a *day* sky. The first version was a dusk that brightened into evening
 * as districts lit, on the reading that "a dark world" meant a dark sky — and
 * what that bought, in every screenshot, was a pale grey-white sheet: a dim
 * three-stop ramp with a warm band *added* on top at the horizon, then pushed
 * over the bloom threshold. The reference the game is chasing is a Ghibli
 * afternoon — a deep saturated blue overhead, cumulus with shaded undersides,
 * a warm pale horizon — and the premise survives the change: the unlit world
 * is that sky with the colour drained out of it and the clouds gone grey, and
 * each lit district puts the colour back.
 *
 * The clouds are procedural, drawn in the same pass. Billboards would need
 * anchoring to the player's tangent frame and would still read as cards; a
 * noise field projected onto a plane a few hundred metres up gives cumulus
 * that flatten and crowd towards the horizon the way real ones do, for one
 * extra lookup per sky pixel.
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
        uTanA: { value: new THREE.Vector3(1, 0, 0) },
        uTanB: { value: new THREE.Vector3(0, 0, 1) },
        uIllumination: { value: 0 },

        // Unlit — the planet as the player finds it.
        //
        // Still a blue sky, so the world keeps its silhouette and the horizon
        // its place. What has gone is the saturation: overcast rather than
        // night, a day with the colour turned down.
        uZenithDark: { value: new THREE.Color('#4d80bf') },
        uMidDark: { value: new THREE.Color('#86b0da') },
        uHorizonDark: { value: new THREE.Color('#c8dbea') },
        uGlowDark: { value: new THREE.Color('#e4dccd') },
        // Lit — the reference afternoon. The zenith goes *darker* as the
        // horizon brightens: contrast between them is the sky, brightness
        // alone is exposure.
        uZenithLit: { value: new THREE.Color('#2a6bc6') },
        uMidLit: { value: new THREE.Color('#5ea6e8') },
        uHorizonLit: { value: new THREE.Color('#bfe0f5') },
        uGlowLit: { value: new THREE.Color('#fff0d2') },

        // Dawn — the *reward*, not a clock. Only the last district brings it,
        // and it is a golden hour laid over the afternoon rather than a
        // different sky swapped in.
        uDawn: { value: 0 },
        uZenithDawn: { value: new THREE.Color('#2e63b4') },
        uMidDawn: { value: new THREE.Color('#84b4e4') },
        uHorizonDawn: { value: new THREE.Color('#ffd9b4') },
        uGlowDawn: { value: new THREE.Color('#ffc088') },

        // Clouds. Lit face and shaded underside, each for the unlit and the
        // lit world; the shading is what makes them cumulus and not fog.
        uCloudLitDark: { value: new THREE.Color('#eef1f5') },
        uCloudShadeDark: { value: new THREE.Color('#a4b1c2') },
        uCloudLitLit: { value: new THREE.Color('#fbfcff') },
        uCloudShadeLit: { value: new THREE.Color('#a9bfd9') },
        /** Fraction of the sky covered, 0..1. */
        uCloudCover: { value: 0.46 },

        /** Seconds, for the drift. */
        uTime: { value: 0 },
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
        uniform vec3 uTanA;
        uniform vec3 uTanB;
        uniform float uIllumination;
        uniform vec3 uZenithDark;
        uniform vec3 uMidDark;
        uniform vec3 uHorizonDark;
        uniform vec3 uGlowDark;
        uniform vec3 uZenithLit;
        uniform vec3 uMidLit;
        uniform vec3 uHorizonLit;
        uniform vec3 uGlowLit;
        uniform float uDawn;
        uniform vec3 uZenithDawn;
        uniform vec3 uMidDawn;
        uniform vec3 uHorizonDawn;
        uniform vec3 uGlowDawn;
        uniform vec3 uCloudLitDark;
        uniform vec3 uCloudShadeDark;
        uniform vec3 uCloudLitLit;
        uniform vec3 uCloudShadeLit;
        uniform float uCloudCover;
        uniform float uTime;

        varying vec3 vWorldDirection;

        // Value noise. Cheap, and cumulus does not need the anisotropy that
        // simplex would buy.
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

        // Cloud density along a direction, 0..1, sampled on a layer a fixed
        // height above the player's tangent plane.
        float clouds(vec2 uv) {
          vec2 drift = vec2(uTime * 0.004, uTime * 0.0016);
          // Big, round shapes first — cumulus are *blobs* — then a finer
          // cauliflower edge that only bites where the blob is already thin.
          float shape = fbm(uv * 0.55 + drift);
          float detail = fbm(uv * 2.4 - drift * 1.6 + 4.2);
          float d = shape + (detail - 0.5) * 0.22;
          float threshold = 1.0 - uCloudCover;
          // A hard-ish edge: a soft one reads as haze, not as a cloud.
          return smoothstep(threshold - 0.02, threshold + 0.11, d);
        }

        void main() {
          vec3 dir = normalize(vWorldDirection);

          // Height relative to the *player's* horizon, not the world's.
          float height = dot(dir, normalize(uUp));

          vec3 zenith  = mix(uZenithDark,  uZenithLit,  uIllumination);
          vec3 mid     = mix(uMidDark,     uMidLit,     uIllumination);
          vec3 horizon = mix(uHorizonDark, uHorizonLit, uIllumination);
          vec3 glow    = mix(uGlowDark,    uGlowLit,    uIllumination);

          zenith  = mix(zenith,  uZenithDawn,  uDawn);
          mid     = mix(mid,     uMidDawn,     uDawn);
          horizon = mix(horizon, uHorizonDawn, uDawn);
          glow    = mix(glow,    uGlowDawn,    uDawn);

          // Three-stop gradient, eased so the transition sits low in the frame
          // rather than splitting the sky in half.
          float t = clamp(height * 0.5 + 0.5, 0.0, 1.0);
          float k = pow(t, 0.7);
          vec3 colour = mix(
            mix(horizon, mid, smoothstep(0.0, 0.6, k)),
            zenith,
            smoothstep(0.6, 1.0, k)
          );

          // A warm band hugging the horizon — *mixed in*, never added. Adding
          // light to an already-pale horizon is how the first sky went white.
          float breathe = sin(uTime * 0.021) * 0.5 + sin(uTime * 0.0083) * 0.5;
          float tightness = 6.0 - breathe * 1.2;
          float band = exp(-abs(height) * tightness);
          colour = mix(colour, glow, band * (0.35 + uDawn * 0.35));

          // Clouds, on a plane above the player. Intersect the view ray with
          // it; near the horizon the hit point runs off to infinity, which is
          // exactly the crowding and flattening real cloud decks show.
          if (height > 0.015) {
            // High and large: the deck is far enough up that its shapes
            // stay round overhead instead of foreshortening into streaks.
            float layer = 700.0;
            float dist = layer / height;
            vec3 hit = dir * dist;
            vec2 uv = vec2(dot(hit, uTanA), dot(hit, uTanB)) * 0.0014;

            float density = clouds(uv);
            // Shade by re-sampling a little towards the sky: where the deck
            // thickens above a pixel, that pixel is the underside.
            float above = clouds(uv + vec2(0.05, 0.07));
            float lit = smoothstep(-0.3, 0.4, density - above);

            vec3 cloudLit   = mix(uCloudLitDark,   uCloudLitLit,   uIllumination);
            vec3 cloudShade = mix(uCloudShadeDark, uCloudShadeLit, uIllumination);
            // Golden hour warms the lit faces and turns the shade violet.
            cloudLit   = mix(cloudLit,   vec3(1.0, 0.86, 0.72), uDawn * 0.6);
            cloudShade = mix(cloudShade, vec3(0.72, 0.58, 0.66), uDawn * 0.6);
            vec3 cloud = mix(cloudShade, cloudLit, lit);

            // Fade into the haze at the horizon and thin at the zenith, where
            // a flat deck would otherwise read as a ceiling.
            float horizonFade = smoothstep(0.03, 0.28, height);
            float zenithThin = 1.0 - smoothstep(0.75, 1.0, height) * 0.35;
            colour = mix(colour, cloud, density * horizonFade * zenithThin * 0.96);
          }

          // Below the horizon the dome is mostly hidden by the planet, but a
          // sliver shows from hilltops; keep it dark so it reads as ground.
          colour *= mix(0.6, 1.0, smoothstep(-0.35, 0.05, height));

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
  update(up: THREE.Vector3, illumination: number, elapsed = 0): void {
    _up.copy(up).normalize();
    const u = this.material.uniforms;
    (u.uUp!.value as THREE.Vector3).copy(_up);

    // The cloud layer's own frame. Held to world +Y where possible so the deck
    // does not spin as the player walks; it only has to flip near the poles.
    _tanA.set(0, 1, 0).projectOnPlane(_up);
    if (_tanA.lengthSq() < 1e-6) _tanA.set(1, 0, 0).projectOnPlane(_up);
    _tanA.normalize();
    _tanB.copy(_up).cross(_tanA).normalize();
    (u.uTanA!.value as THREE.Vector3).copy(_tanA);
    (u.uTanB!.value as THREE.Vector3).copy(_tanB);

    u.uIllumination!.value = illumination;
    u.uTime!.value = elapsed;

    // Dawn begins only in the last stretch. Below 0.8 there is none at all, so
    // four districts out of five still buys you afternoon — the golden hour
    // belongs to the fifth delivery, and it should feel like that one earned it.
    u.uDawn!.value = THREE.MathUtils.smoothstep(illumination, 0.8, 1.0);
  }

  /** How far into dawn the sky is, 0..1. */
  get dawn(): number {
    return this.material.uniforms.uDawn!.value as number;
  }

  /**
   * The horizon *as drawn* — the base horizon stop with the glow band mixed in
   * at full strength — so that fog set to it meets the sky without a seam.
   */
  horizonColour(target: THREE.Color, illumination: number): THREE.Color {
    const u = this.material.uniforms;
    const dawn = u.uDawn!.value as number;
    target
      .copy(u.uHorizonDark!.value as THREE.Color)
      .lerp(u.uHorizonLit!.value as THREE.Color, illumination)
      .lerp(u.uHorizonDawn!.value as THREE.Color, dawn);
    _colour
      .copy(u.uGlowDark!.value as THREE.Color)
      .lerp(u.uGlowLit!.value as THREE.Color, illumination)
      .lerp(u.uGlowDawn!.value as THREE.Color, dawn);
    return target.lerp(_colour, 0.35 + dawn * 0.35);
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
