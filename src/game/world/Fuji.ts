import * as THREE from 'three';

/**
 * Mount Fuji, painted on the horizon.
 *
 * The planet is sixty metres across, so a mountain *on* it could never look
 * like a distant mountain — it would be a hill you can walk up. An earlier
 * version stood it a few hundred metres off in the world, which looked right
 * from the village and wrong everywhere else: a few dozen steps round a world
 * this small is a large fraction of the way to it, and from the far side of
 * the hill its flank filled half the sky.
 *
 * So it is a backdrop, like the sky: it travels with the camera, always the
 * same distance off and the same size, its foot tucked just under the visible
 * horizon and its summit a few degrees above it — the way it sits behind a
 * shop front in a photograph. It stays toward one compass direction, which on
 * a sphere cannot be defined everywhere (a direction projected onto the
 * ground vanishes where the ground faces it), so it fades into the haze as
 * you approach those two spots rather than spinning round them.
 *
 * It has its own small shader rather than a world material, because the
 * atmosphere is built for things within a few dozen metres: at that range
 * the height mist and haze would have fogged it out entirely. Instead it is
 * lit by the same sun, and fades toward the same haze colour on its own
 * terms — its foot lost in the air, its snow cap clear. The snow follows the
 * ravines down from a line two-thirds of the way up, as Fuji's does.
 */

export interface FujiBackdrop {
  /** World direction the mountain lies toward, projected onto the local ground. */
  bearing: THREE.Vector3;
  /** Horizontal distance from the camera, metres. Inside the camera's far plane. */
  distance: number;
  /** How far the summit stands above the visible horizon, radians. */
  peak: number;
  /** Radius of the sphere whose rim is the horizon. */
  planetRadius: number;
}

export interface FujiLight {
  sunDirection: THREE.Vector3;
  sun: THREE.DirectionalLight;
  haze: THREE.Color;
  /** Haze density per metre, as the atmosphere has it. */
  hazeDensity: number;
}

/** How concave the flanks are: 1 is a straight cone, Fuji's are well past it. */
const CONCAVITY = 1.35;
/** Radius of the summit crater, as a fraction of the foot. */
const CRATER = 0.045;

/**
 * The silhouette, foot to summit, as lathe points (x = radius, y = height).
 *
 * Height falls off as `(1 - r/R)^1.35`: about 30° at the top, 24° halfway
 * down, 14° near the foot — the long concave sweep that makes the shape
 * Fuji rather than a cone. A shallow crater flattens the top, and a skirt
 * runs on below the foot so no edge ever shows over the planet's rim.
 */
export function fujiProfile(height: number, radius: number, steps = 56): THREE.Vector2[] {
  const points: THREE.Vector2[] = [new THREE.Vector2(radius * 1.12, -height * 0.35)];
  const top = CRATER * radius;
  for (let i = 0; i <= steps; i++) {
    // Denser toward the summit, where the silhouette bends most.
    const t = 1 - (1 - i / steps) ** 1.6;
    const r = radius - (radius - top) * t;
    points.push(new THREE.Vector2(r, height * (1 - r / radius) ** CONCAVITY));
  }
  const rim = points[points.length - 1]!.y;
  points.push(new THREE.Vector2(top * 0.6, rim - height * 0.012));
  points.push(new THREE.Vector2(top * 0.05, rim - height * 0.016));
  return points;
}

const VERTEX = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColour;
  uniform vec3 uHaze;
  uniform vec3 uRock;
  uniform vec3 uForest;
  uniform vec3 uSnow;
  uniform float uHeight;
  uniform float uHazeAmount;
  uniform float uOpacity;
  varying vec3 vNormalW;
  varying vec3 vLocal;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    float h = clamp(vLocal.y / uHeight, 0.0, 1.0);
    // Angle round the cone, wrapped seamlessly for the noise.
    vec2 around = normalize(vLocal.xz + 1e-4);

    // Ravines run straight down the flanks; snow lies in them longest.
    float ravine = noise(around * 9.0 + vec2(h * 1.5, 0.0)) * 0.6 + noise(around * 23.0 + vec2(0.0, h * 2.0)) * 0.4;
    float line = 0.64 - 0.22 * pow(ravine, 2.0) - 0.05 * around.x;
    float snow = smoothstep(line - 0.012, line + 0.012, h);

    float grain = noise(around * 70.0 + vec2(h * 30.0));
    vec3 ground = mix(uForest, uRock, smoothstep(0.18, 0.45, h)) * (0.85 + 0.3 * grain);
    vec3 albedo = mix(ground, uSnow, snow);

    vec3 n = normalize(vNormalW);
    float sun = max(dot(n, uSunDir), 0.0);
    // The sky's light in the shade: distant shadow takes the colour of the air.
    vec3 light = uSunColour * sun * 0.32 + uHaze * 0.55;
    vec3 colour = albedo * light;

    // Aerial perspective, heavier toward the foot, which is lost in the air.
    float haze = mix(uHazeAmount * 0.35, min(0.95, uHazeAmount + 0.35), pow(1.0 - h, 1.8));
    gl_FragColor = vec4(mix(colour, uHaze, haze), uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The silhouette's proportions; the mesh is scaled to the size it must appear. */
const PROFILE_HEIGHT = 150;
const PROFILE_RADIUS = 350;
/** How far the foot sinks below the horizon, radians, so no edge ever shows. */
const FOOT_BELOW = THREE.MathUtils.degToRad(4);

const _up = new THREE.Vector3();
const _toward = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);

export class Fuji {
  readonly mesh: THREE.Mesh;
  private readonly bearing: THREE.Vector3;
  private readonly uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColour: { value: new THREE.Color(1, 1, 1) },
    uHaze: { value: new THREE.Color(0.8, 0.85, 0.9) },
    uRock: { value: new THREE.Color('#4a4652') },
    uForest: { value: new THREE.Color('#2f3c3a') },
    uSnow: { value: new THREE.Color('#f1f4fa') },
    uHeight: { value: PROFILE_HEIGHT },
    uHazeAmount: { value: 0.5 },
    uOpacity: { value: 1 },
  };

  constructor(private readonly backdrop: FujiBackdrop) {
    this.bearing = backdrop.bearing.clone().normalize();
    const geometry = new THREE.LatheGeometry(fujiProfile(PROFILE_HEIGHT, PROFILE_RADIUS), 192);
    const material = new THREE.ShaderMaterial({
      name: 'Fuji',
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      // Only so it can fade where its bearing is undefined; it still writes
      // depth, and everything on the planet is nearer and drawn over it.
      transparent: true,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'fuji';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // It follows the camera, so its bounds are never stale enough to matter,
    // but it is never worth testing either: it is always in the distance.
    this.mesh.frustumCulled = false;
  }

  /**
   * Stand it on the horizon as seen from `camera`: upright on the local up,
   * toward the bearing, its foot under the rim and its summit `peak` above.
   */
  place(camera: THREE.Vector3): void {
    const { distance, peak, planetRadius } = this.backdrop;
    const altitude = Math.max(camera.length(), planetRadius + 0.01);
    _up.copy(camera).divideScalar(altitude);
    _toward.copy(this.bearing).projectOnPlane(_up);
    const along = _toward.length();
    this.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(along, 0.22, 0.45);
    this.mesh.visible = this.uniforms.uOpacity.value > 0.002;
    if (!this.mesh.visible) return;
    _toward.divideScalar(along);

    // The rim of a sphere sits below level by this much, more the higher you are.
    const dip = Math.acos(planetRadius / altitude);
    const footY = distance * Math.tan(-dip - FOOT_BELOW);
    const summitY = distance * Math.tan(-dip + peak);
    const scale = (summitY - footY) / PROFILE_HEIGHT;

    this.mesh.scale.setScalar(scale);
    this.mesh.quaternion.setFromUnitVectors(_yAxis, _up);
    this.mesh.position.copy(camera).addScaledVector(_toward, distance).addScaledVector(_up, footY);
  }

  /** Follow the mood: the sun's colour and direction, and how thick the air is. */
  update(light: FujiLight): void {
    const u = this.uniforms;
    u.uSunDir.value.copy(light.sunDirection);
    u.uSunColour.value.copy(light.sun.color).multiplyScalar(light.sun.intensity);
    u.uHaze.value.copy(light.haze);
    u.uHazeAmount.value = 1 - Math.exp(-light.hazeDensity * 95);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
