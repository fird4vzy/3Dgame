import * as THREE from 'three';
import { PLANET_RADIUS } from '@config/constants';
import { FAR_COUNTRY_GLSL } from './Fuji';

/**
 * What the sky looks like this frame. Owned and interpolated by
 * `Environment`; the dome only draws it.
 */
export interface SkyState {
  /** The viewer's local up — the horizon is perpendicular to it. */
  up: THREE.Vector3;
  /**
   * The sky's own frame in the ground plane. Clouds, sun, mountain and ridges
   * are all laid out in it, so they keep their places relative to each other;
   * `Environment` carries it along with the player without ever turning it.
   */
  tanA: THREE.Vector3;
  tanB: THREE.Vector3;
  /** Unit vector toward the sun. */
  sunDir: THREE.Vector3;
  /** Unit vector along the ground toward the mountain. */
  fujiDir: THREE.Vector3;
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
  /** The mountain's bare flank and its snow. */
  fujiRock: THREE.Color;
  fujiSnow: THREE.Color;
  ridgeFar: THREE.Color;
  ridgeNear: THREE.Color;
  /** Mist lying between the ranges. */
  mistBand: THREE.Color;
  /** The country below the ridges, where the planet's rim does not hide it. */
  lowland: THREE.Color;
  /** 0..1, how much air stands between here and the far country. */
  farHaze: number;
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
 * the sun disk lands exactly where the atmosphere's sun glow says it is.
 *
 * It is painted the way an animation background is: a clean gradient, cumulus
 * in two flat tones with a crisp edge — piled up along the horizon, scattered
 * overhead — and behind the planet a whole country it does not have room for:
 * a wooded ridge, a paler one beyond it, mist between, and the mountain (see
 * `Fuji`). None of it has parallax, because none of it should: it is far away.
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
      name: 'Sky',
      side: THREE.BackSide,
      depthWrite: false,
      // Tested against the far plane (see the vertex shader): the sky is
      // drawn after the world, and only where the world left a gap.
      depthTest: true,
      fog: false,
      uniforms: {
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uTanA: { value: new THREE.Vector3(1, 0, 0) },
        uTanB: { value: new THREE.Vector3(0, 0, 1) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uFujiDir: { value: new THREE.Vector3(1, 0, 0) },
        uFujiRight: { value: new THREE.Vector3(0, 0, 1) },
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
        uFujiRock: { value: new THREE.Color('#4d5f95') },
        uFujiSnow: { value: new THREE.Color('#ffffff') },
        uRidgeFar: { value: new THREE.Color('#7f9cc4') },
        uRidgeNear: { value: new THREE.Color('#4d7a72') },
        uMistBand: { value: new THREE.Color('#e9f1f6') },
        uLowland: { value: new THREE.Color('#a8c4b4') },
        uFarHaze: { value: 0.5 },
        uTime: { value: 0 },
        uEnvMode: { value: options.envMode ? 1 : 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vViewRay;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vViewRay = worldPosition.xyz - cameraPosition;
          // On the far plane exactly, whatever the dome's radius.
          gl_Position = (projectionMatrix * viewMatrix * worldPosition).xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uUp;
        uniform vec3 uTanA;
        uniform vec3 uTanB;
        uniform vec3 uSunDir;
        uniform vec3 uFujiDir;
        uniform vec3 uFujiRight;
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
        uniform vec3 uFujiRock;
        uniform vec3 uFujiSnow;
        uniform vec3 uRidgeFar;
        uniform vec3 uRidgeNear;
        uniform vec3 uMistBand;
        uniform vec3 uLowland;
        uniform float uFarHaze;
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
        float fbm3(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 3; i++) {
            v += a * noise(p);
            p = p * 2.03 + vec2(17.1, 9.7);
            a *= 0.5;
          }
          return v / 0.875;
        }
        // Cauliflower rather than cotton wool: round lumps with a crease
        // between them, which is what a cumulus edge is made of.
        float billow3(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 3; i++) {
            v += a * abs(noise(p) * 2.0 - 1.0);
            p = p * 2.11 + vec2(5.3, 12.9);
            a *= 0.5;
          }
          return v / 0.875;
        }

        ${FAR_COUNTRY_GLSL}

        // How much cloud lies along a point of the upper sky.
        float cloudField(vec2 p) {
          vec2 warp = vec2(noise(p * 1.3 + 4.1), noise(p * 1.3 - 7.7)) - 0.5;
          p += warp * 0.6;
          return fbm3(p * 0.8) * 0.74 + billow3(p * 2.7) * 0.36;
        }

        void main() {
          vec3 dir = normalize(vViewRay);
          float h = dot(dir, uUp);
          float sun = max(dot(dir, uSunDir), 0.0);
          float t = max(h, 0.0);
          vec2 flat2 = vec2(dot(dir, uTanA), dot(dir, uTanB));
          vec2 around = normalize(flat2 + 1e-5);
          vec2 toSun = normalize(vec2(dot(uSunDir, uTanA), dot(uSunDir, uTanB)) + 1e-4);

          // Horizon to zenith, with the change sitting low in the frame.
          vec3 sky = mix(uHorizon, uMid, smoothstep(0.0, 0.34, pow(t, 0.78)));
          sky = mix(sky, uZenith, smoothstep(0.26, 1.0, t));
          // Every long sight-line ends in the same air the ground fades into.
          sky = mix(sky, uHaze, exp(-t * 10.0) * 0.8);
          vec3 clear = sky;
          float covered = 0.0;

          // ── cumulus standing along the horizon ─────────────────────────
          // Laid out by bearing and height, not on a ceiling, so they stand
          // upright: a flat cloud deck seen edge-on is a row of streaks.
          if (h > -0.12 && h < 0.5) {
            float turn = uTime * 0.0011;
            vec2 ring = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * around;
            float mass = fbm3(ring * 2.1 + 2.3);
            float stands = smoothstep(0.60 - uCloudCover * 0.42, 0.74 - uCloudCover * 0.36, mass);
            float crown = fbm3(ring * 5.2 + 9.0);
            float top = 0.05 + stands * (0.14 + crown * 0.30);
            float lumps = billow3(ring * (8.5 * (1.0 + h * 1.3)) + 3.0);
            float body = (top - h) + (lumps - 0.42) * 0.13;
            float density = smoothstep(0.0, 0.022, body) * stands;
            if (density > 0.001) {
              float within = clamp(h / max(top, 0.02), 0.0, 1.0);
              // Lit from above and from the sun's side; flat-toned, with one
              // crisp step between light and shade.
              float side = dot(around, toSun) * 0.16;
              float lit = smoothstep(0.40, 0.46, within + (lumps - 0.42) * 0.9 + side);
              vec3 tower = mix(uCloudShade, uCloudLit, lit);
              tower += uSunColour * pow(sun, 6.0) * 0.10;
              // The foot of every tower stands in the horizon's haze.
              tower = mix(tower, uHaze, smoothstep(0.10, -0.03, h) * 0.75);
              sky = mix(sky, tower, density);
              covered = max(covered, density);
            }
          }

          // ── scattered cumulus overhead ─────────────────────────────────
          if (h > 0.08) {
            // A dome, not a plane: without the offset everything toward the
            // horizon is squeezed thin.
            vec2 uv = flat2 / (h + 0.24);
            vec2 drift = vec2(uTime * 0.0030, uTime * 0.0011);
            vec2 p = uv * 1.15 + drift;
            float threshold = mix(0.84, 0.52, uCloudCover);
            float d0 = cloudField(p);
            float density = smoothstep(threshold, threshold + 0.022, d0);
            if (density > 0.001) {
              float d1 = cloudField(p + toSun * 0.13);
              float lit = smoothstep(-0.015, 0.03, d0 - d1);
              float thick = smoothstep(threshold + 0.10, threshold + 0.30, d0);
              vec3 cloud = mix(uCloudShade, uCloudLit, max(lit, 1.0 - thick * 0.9));
              cloud = mix(cloud, uCloudShade, thick * (1.0 - lit) * 0.9);
              // Silver lining: thin cloud near the sun is lit through.
              cloud += uSunColour * pow(sun, 5.0) * (1.0 - thick) * 0.22;
              float reach = smoothstep(0.08, 0.22, h);
              density *= reach;
              sky = mix(sky, cloud, density);
              covered = max(covered, density);
            }
          }

          // In-scattering toward the sun — the identical expression to the
          // atmosphere's, so hills and sky warm together.
          float veil = 1.0 - covered * 0.7;
          sky += uSunColour * (pow(sun, 8.0) * 0.55 + pow(sun, 48.0) * 0.45) * uGlow * veil;

          // The disk, with a soft limb. Bright enough to bloom into the halo
          // the eye expects; dimmed in the capture so reflections do not
          // sparkle.
          float disk = smoothstep(0.99962, 0.99988, sun);
          sky += uSunColour * disk * mix(30.0, 2.0, uEnvMode) * (1.0 - covered);

          if (uEnvMode > 0.5) {
            // The capture lights the scene: below the horizon is the ground
            // the bounce comes from.
            sky = mix(sky, uGround, smoothstep(0.0, -0.1, h));
          } else if (h < 0.3) {
            sky = farCountry(dir, h, sky, clear);
          }

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = options.envMode ? 'skydome_capture' : 'skydome';
    // Drawn after everything solid, never culled. It used to be drawn first,
    // with no depth test, so its shader — the most expensive per pixel in the
    // game — ran for every pixel of the screen and was then painted over by
    // the ground, the houses and the trees.
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
  }

  apply(state: SkyState): void {
    const u = this.material.uniforms;
    const vector = (name: string): THREE.Vector3 => u[name]!.value as THREE.Vector3;
    const colour = (name: string): THREE.Color => u[name]!.value as THREE.Color;

    vector('uUp').copy(state.up).normalize();
    vector('uTanA').copy(state.tanA);
    vector('uTanB').copy(state.tanB);
    vector('uSunDir').copy(state.sunDir);
    vector('uFujiDir').copy(state.fujiDir);
    // Screen-right of the mountain as you face it.
    vector('uFujiRight').crossVectors(state.fujiDir, state.up).normalize();
    colour('uSunColour').copy(state.sunColour);
    u.uGlow!.value = state.glow;
    colour('uZenith').copy(state.zenith);
    colour('uMid').copy(state.mid);
    colour('uHorizon').copy(state.horizon);
    colour('uHaze').copy(state.haze);
    colour('uGround').copy(state.ground);
    u.uCloudCover!.value = state.cloudCover;
    colour('uCloudLit').copy(state.cloudLit);
    colour('uCloudShade').copy(state.cloudShade);
    colour('uFujiRock').copy(state.fujiRock);
    colour('uFujiSnow').copy(state.fujiSnow);
    colour('uRidgeFar').copy(state.ridgeFar);
    colour('uRidgeNear').copy(state.ridgeNear);
    colour('uMistBand').copy(state.mistBand);
    colour('uLowland').copy(state.lowland);
    u.uFarHaze!.value = state.farHaze;
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
