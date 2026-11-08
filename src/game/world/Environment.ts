import * as THREE from 'three';
import { atmosphereUniforms } from '@engine/render/Atmosphere';
import { PLANET_RADIUS, SEA_LEVEL_RADIUS } from '@config/constants';
import { Skydome, type SkyState } from './Skydome';

/**
 * One lighting mood: everything the environment blends between.
 *
 * Colours are authored as sRGB hex, the way an artist picks them, and blended
 * in linear space by three.
 */
interface Mood {
  zenith: string;
  mid: string;
  horizon: string;
  /** Far air. Also the fog colour, so it must sit inside the sky's range. */
  haze: string;
  /** Low mist over water and in hollows. */
  mist: string;
  /** Bounce from below, for the environment capture. */
  ground: string;
  sun: string;
  /** Direct light, in lux-ish three units. */
  sunIntensity: number;
  sunElevationDeg: number;
  /** In-scattering toward the sun, sky and fog alike. */
  glow: number;
  hazeDensity: number;
  mistDensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  /** Scale on the sky-captured image-based lighting. */
  envIntensity: number;
  cloudCover: number;
  cloudLit: string;
  cloudShade: string;
}

/**
 * The planet as the player finds it: an overcast, misty morning. Still a
 * daytime sky — the world keeps its silhouette — but with the colour gone out
 * of it and the sun a pale disk behind the murk.
 */
const DORMANT: Mood = {
  zenith: '#5d7fa8',
  mid: '#8fa9c2',
  horizon: '#c3ccd2',
  haze: '#b9c2c8',
  mist: '#c9d0d4',
  ground: '#3f4a3c',
  sun: '#fff1de',
  sunIntensity: 1.6,
  sunElevationDeg: 34,
  glow: 0.35,
  hazeDensity: 0.012,
  mistDensity: 0.03,
  hemiSky: '#a9b8c8',
  hemiGround: '#4a5244',
  hemiIntensity: 0.35,
  envIntensity: 0.8,
  cloudCover: 0.62,
  cloudLit: '#e4e8ec',
  cloudShade: '#9aa6b3',
};

/**
 * Every district lit: a warm late afternoon. The zenith deepens as the
 * horizon warms — contrast between them is the sky; brightness alone is just
 * exposure.
 */
const AWAKE: Mood = {
  zenith: '#3569b5',
  mid: '#7fb0de',
  horizon: '#f1e3c8',
  haze: '#e6dcc6',
  mist: '#efe9dc',
  ground: '#4a5a34',
  sun: '#ffe6bf',
  sunIntensity: 3.2,
  sunElevationDeg: 26,
  glow: 0.75,
  hazeDensity: 0.008,
  mistDensity: 0.014,
  hemiSky: '#bcd3f0',
  hemiGround: '#5b6a45',
  hemiIntensity: 0.3,
  envIntensity: 1.0,
  cloudCover: 0.42,
  cloudLit: '#fffaf0',
  cloudShade: '#a9bad0',
};

/**
 * The reward for the last delivery: golden hour. A low sun straight into the
 * haze, long shadows, and the air itself glowing.
 */
const DAWN: Mood = {
  zenith: '#3f68a6',
  mid: '#b9b4b4',
  horizon: '#ffd6a0',
  haze: '#f3cf9f',
  mist: '#f6dfc0',
  ground: '#56553a',
  sun: '#ffc27a',
  sunIntensity: 3.4,
  sunElevationDeg: 13,
  glow: 1.25,
  hazeDensity: 0.011,
  mistDensity: 0.024,
  hemiSky: '#e8c9a8',
  hemiGround: '#5d5a3c',
  hemiIntensity: 0.3,
  envIntensity: 1.0,
  cloudCover: 0.4,
  cloudLit: '#ffe2b8',
  cloudShade: '#b49aa6',
};

/**
 * How sharply mist thins with altitude, per metre. At 0.9 it is down to 40% a
 * metre above the water and gone by four: it lies *on* the lagoon and in the
 * hollows rather than hanging in front of everything.
 */
const MIST_FALLOFF = 0.9;
/** Sun azimuth in the local frame. Fixed: the sun follows the player. */
const SUN_AZIMUTH = 0.35;

export interface EnvironmentFrame {
  /** Where the player is — defines local up. */
  anchor: THREE.Vector3;
  camera: THREE.Camera;
  /** 0 = every district dark, 1 = all lit. */
  illumination: number;
  elapsed: number;
  /** Orbital menu shot: no fog, sun keyed from the camera. */
  menu: boolean;
}

const _up = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _bitangent = new THREE.Vector3();
const _sunLocal = new THREE.Vector3();
const _menuOut = new THREE.Vector3();
const _menuSide = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _euler = new THREE.Euler();
const _a = new THREE.Color();
const _b = new THREE.Color();

function blendColour(target: THREE.Color, from: string, to: string, t: number): THREE.Color {
  return target.set(from).lerp(_b.set(to), t);
}

/**
 * Sky, sun, air and the light they cast — one object, because they are one
 * thing. The sky colour *is* the ambient light; the sun in the sky *is* the
 * shadow-casting light; the haze in front of the hills *is* the colour of the
 * horizon behind them. Kept in separate places, those relationships drift and
 * the image stops agreeing with itself, which is most of what makes a render
 * look like a render.
 *
 * Image-based lighting is captured from the sky itself, once per mood change,
 * in a canonical frame (local up = +Y), and then *rotated* to the player's
 * frame every frame via `scene.environmentRotation`. Walking round the planet
 * turns the whole sky with you, so recapturing per step would be pure waste.
 */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
  readonly skydome: Skydome;

  private readonly fog = new THREE.Fog('#ffffff', 1, 1000);
  private readonly captureScene = new THREE.Scene();
  private readonly captureDome = new Skydome({ envMode: true, radius: 50 });
  private readonly pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private capturedAt = -1;
  private captureClock = 0;

  private readonly state: SkyState = {
    up: new THREE.Vector3(0, 1, 0),
    tanA: new THREE.Vector3(1, 0, 0),
    tanB: new THREE.Vector3(0, 0, 1),
    sunDir: new THREE.Vector3(0, 1, 0),
    sunColour: new THREE.Color(),
    glow: 0,
    zenith: new THREE.Color(),
    mid: new THREE.Color(),
    horizon: new THREE.Color(),
    haze: new THREE.Color(),
    ground: new THREE.Color(),
    cloudCover: 0.45,
    cloudLit: new THREE.Color(),
    cloudShade: new THREE.Color(),
    time: 0,
  };
  private dawnLevel = 0;
  private sunElevation = 0.5;
  private hazeDensity = 0.01;
  private mistDensity = 0.04;
  private hemiIntensity = 0.3;
  private envIntensity = 1;
  private sunIntensity = 2;
  private readonly sunLightColour = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    shadows: boolean,
    shadowMapSize: number,
  ) {
    this.skydome = new Skydome();
    scene.add(this.skydome.mesh);
    this.captureScene.add(this.captureDome.mesh);

    this.ambient = new THREE.HemisphereLight(0xbcd3f0, 0x55654a, 0.3);
    scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
      const cam = this.sun.shadow.camera;
      cam.near = 1;
      cam.far = 180;
      cam.left = cam.bottom = -22;
      cam.right = cam.top = 22;
      cam.updateProjectionMatrix();
      // A low sun grazes the ground, which is where acne lives; the normal
      // offset does most of the work so the depth bias can stay small enough
      // not to detach shadows from the feet.
      this.sun.shadow.bias = -0.0002;
      this.sun.shadow.normalBias = 0.05;
      this.sun.shadow.radius = 3;
    }
    scene.add(this.sun, this.sun.target);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.fog = this.fog;
    atmosphereUniforms.atmoSeaRadius.value = SEA_LEVEL_RADIUS;
  }

  /** How far into the golden hour the sky is, 0..1. */
  get dawn(): number {
    return this.dawnLevel;
  }

  /** The current far-air colour, for anything that must match the horizon. */
  get hazeColour(): THREE.Color {
    return this.state.haze;
  }

  /** Unit vector toward the sun, world space. */
  get sunDirection(): THREE.Vector3 {
    return this.state.sunDir;
  }

  update(frame: EnvironmentFrame, dt: number): void {
    this.blendMood(frame.illumination);
    this.state.time = frame.elapsed;

    // Local frame at the player. Tangent held to world +Y where possible so the
    // cloud deck and the sun do not spin as she walks; it only flips near the
    // poles. Right-handed (tangent × up = bitangent), because it doubles as a
    // rotation matrix below.
    _up.copy(frame.anchor).normalize();
    _tangent.set(0, 1, 0).projectOnPlane(_up);
    if (_tangent.lengthSq() < 1e-6) _tangent.set(1, 0, 0).projectOnPlane(_up);
    _tangent.normalize();
    _bitangent.crossVectors(_tangent, _up).normalize();

    // The sun in that frame, at the mood's elevation.
    const e = this.sunElevation;
    _sunLocal.set(
      Math.cos(e) * Math.cos(SUN_AZIMUTH),
      Math.sin(e),
      Math.cos(e) * Math.sin(SUN_AZIMUTH),
    );

    if (frame.menu) {
      this.keyFromCamera(frame.camera);
    } else {
      this.state.sunDir
        .copy(_tangent)
        .multiplyScalar(_sunLocal.x)
        .addScaledVector(_up, _sunLocal.y)
        .addScaledVector(_bitangent, _sunLocal.z)
        .normalize();
      this.sun.position.copy(frame.anchor).addScaledVector(this.state.sunDir, 80);
      this.sun.target.position.copy(frame.anchor);
    }
    this.sun.target.updateMatrixWorld();

    this.state.up.copy(_up);
    this.state.tanA.copy(_tangent);
    this.state.tanB.copy(_bitangent);
    this.skydome.apply(this.state);
    // Centred on the camera so its directions are the camera's directions.
    this.skydome.mesh.position.copy(frame.camera.position);
    // The orbital menu shot is the planet against space: a sky seen from
    // eighty metres out is a sky the planet is not inside, and it read as a
    // grey wash behind the title.
    this.skydome.mesh.visible = !frame.menu;

    this.sun.color.copy(this.sunLightColour);
    this.sun.intensity = this.sunIntensity;
    this.ambient.intensity = this.hemiIntensity;

    // The air.
    this.scene.fog = frame.menu ? null : this.fog;
    this.fog.color.copy(this.state.haze);
    const u = atmosphereUniforms;
    u.atmoSunDir.value.copy(this.state.sunDir);
    u.atmoSunColour.value.copy(this.state.sunColour);
    u.atmoParams.value.set(this.hazeDensity, this.mistDensity, MIST_FALLOFF, this.state.glow);

    // The sky as light: recapture when the mood has moved, rotate every frame.
    this.captureClock += dt;
    if (
      this.capturedAt < 0 ||
      (Math.abs(frame.illumination - this.capturedAt) > 0.01 && this.captureClock > 0.25)
    ) {
      this.capture();
      this.capturedAt = frame.illumination;
      this.captureClock = 0;
    }
    this.scene.environmentIntensity = this.envIntensity;

    // Canonical → world is the basis (tangent, up, bitangent). three samples
    // the map at `M(-rotation) · direction`, so to look up `Bᵀ · direction`
    // the stored rotation is the negated Euler of Bᵀ.
    _basis.makeBasis(_tangent, _up, _bitangent).transpose();
    _euler.setFromRotationMatrix(_basis, 'XYZ');
    this.scene.environmentRotation.set(-_euler.x, -_euler.y, -_euler.z, 'XYZ');
  }

  dispose(): void {
    this.skydome.dispose();
    this.captureDome.dispose();
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.scene.environment = null;
  }

  private blendMood(illumination: number): void {
    const lit = THREE.MathUtils.clamp(illumination, 0, 1);
    // Golden hour belongs to the fifth delivery: none at all below 0.8, so
    // four districts out of five still buys you afternoon.
    const dawn = THREE.MathUtils.smoothstep(lit, 0.8, 1.0);
    this.dawnLevel = dawn;

    const colour = (target: THREE.Color, key: keyof Mood): void => {
      blendColour(target, DORMANT[key] as string, AWAKE[key] as string, lit);
      target.lerp(_a.set(DAWN[key] as string), dawn);
    };
    const scalar = (key: keyof Mood): number => {
      const base = THREE.MathUtils.lerp(DORMANT[key] as number, AWAKE[key] as number, lit);
      return THREE.MathUtils.lerp(base, DAWN[key] as number, dawn);
    };

    const s = this.state;
    colour(s.zenith, 'zenith');
    colour(s.mid, 'mid');
    colour(s.horizon, 'horizon');
    colour(s.haze, 'haze');
    colour(s.ground, 'ground');
    colour(s.cloudLit, 'cloudLit');
    colour(s.cloudShade, 'cloudShade');
    colour(atmosphereUniforms.atmoMistColour.value, 'mist');
    colour(this.ambient.color, 'hemiSky');
    colour(this.ambient.groundColor, 'hemiGround');
    colour(this.sunLightColour, 'sun');

    s.cloudCover = scalar('cloudCover');
    s.glow = scalar('glow');
    this.sunIntensity = scalar('sunIntensity');
    this.sunElevation = THREE.MathUtils.degToRad(scalar('sunElevationDeg'));
    this.hazeDensity = scalar('hazeDensity');
    this.mistDensity = scalar('mistDensity');
    this.hemiIntensity = scalar('hemiIntensity');
    this.envIntensity = scalar('envIntensity');

    // The colour scattered toward the eye is the sun's colour at a strength
    // that reads as glow, not as a second sun.
    s.sunColour.copy(this.sunLightColour).multiplyScalar(0.55 + this.sunIntensity * 0.12);
  }

  /** Re-render the sky into the image-based lighting, in the canonical frame. */
  private capture(): void {
    const s = this.state;
    const canonicalSun = new THREE.Vector3(
      Math.cos(this.sunElevation) * Math.cos(SUN_AZIMUTH),
      Math.sin(this.sunElevation),
      Math.cos(this.sunElevation) * Math.sin(SUN_AZIMUTH),
    );
    this.captureDome.apply({
      ...s,
      up: new THREE.Vector3(0, 1, 0),
      tanA: new THREE.Vector3(1, 0, 0),
      tanB: new THREE.Vector3(0, 0, 1),
      sunDir: canonicalSun,
    });
    const target = this.pmrem.fromScene(this.captureScene, 0, 0.1, 200, { size: 128 });
    this.envTarget?.dispose();
    this.envTarget = target;
    this.scene.environment = target.texture;
  }

  /**
   * Menu: the camera orbits far above the planet, and the sun keys the face
   * we are looking at — a three-quarter light from up and to the left, which
   * gives the sphere a terminator, the only thing that makes a ball read as a
   * world.
   */
  private keyFromCamera(camera: THREE.Camera): void {
    const outward = _menuOut.copy(camera.position).normalize();
    const side = _menuSide.set(0, 1, 0).cross(outward).normalize();
    this.state.sunDir
      .copy(outward)
      .multiplyScalar(0.55)
      .addScaledVector(side, 0.7)
      .addScaledVector(camera.up, 0.45)
      .normalize();
    this.sun.position.copy(this.state.sunDir).multiplyScalar(PLANET_RADIUS * 3);
    this.sun.target.position.set(0, 0, 0);
  }
}
