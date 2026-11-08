import * as THREE from 'three';

/**
 * Mount Fuji, beyond the edge of the world.
 *
 * The planet is sixty metres across, so a mountain *on* it could never look
 * like a distant mountain — it would be a hill you can walk up. This one
 * stands some four hundred and sixty metres out, past the planet's rim as seen
 * from the village, with its foot below that rim. From the village it rises over
 * the curve of the world the way a real mountain rises over the curve of the
 * sea, and like the sun it sets behind the planet as you walk round to the
 * far side.
 *
 * It has its own small shader rather than a world material, because the
 * atmosphere is built for things within a few dozen metres: at that range
 * the height mist and haze would have fogged it out entirely. Instead it is
 * lit by the same sun, and fades toward the same haze colour on its own
 * terms — its foot lost in the air, its snow cap clear. The snow follows the
 * ravines down from a line two-thirds of the way up, as Fuji's does.
 */

export interface FujiPlacement {
  /** Local up at the place it is meant to be seen from. */
  up: THREE.Vector3;
  /** Unit vector in that place's tangent plane, toward the mountain. */
  toward: THREE.Vector3;
  /** Horizontal distance from the planet's axis through `up`, metres. */
  distance: number;
  /** Height of the mountain's foot along `up`, from the planet's centre. */
  base: number;
  height: number;
  /** Radius of the foot. */
  radius: number;
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
    gl_FragColor = vec4(mix(colour, uHaze, haze), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Fuji {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColour: { value: new THREE.Color(1, 1, 1) },
    uHaze: { value: new THREE.Color(0.8, 0.85, 0.9) },
    uRock: { value: new THREE.Color('#4a4652') },
    uForest: { value: new THREE.Color('#2f3c3a') },
    uSnow: { value: new THREE.Color('#f1f4fa') },
    uHeight: { value: 1 },
    uHazeAmount: { value: 0.5 },
  };

  constructor(placement: FujiPlacement) {
    const geometry = new THREE.LatheGeometry(fujiProfile(placement.height, placement.radius), 192);
    this.uniforms.uHeight.value = placement.height;
    const material = new THREE.ShaderMaterial({
      name: 'Fuji',
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'fuji';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;

    // Stand it on its own up, which is the village's: seen from there it is
    // upright, and from anywhere it can be seen at all it leans no more than
    // a distant mountain on a round world should.
    const up = placement.up.clone().normalize();
    const toward = placement.toward.clone().projectOnPlane(up).normalize();
    this.mesh.position.copy(up).multiplyScalar(placement.base).addScaledVector(toward, placement.distance);
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
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
