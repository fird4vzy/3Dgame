import * as THREE from 'three';
import type { EventBus } from '@core/events/EventBus';
import type { QualityTier, Viewport } from '@engine/platform/Viewport';
import { clamp } from '@core/math/spherical';
import { PostFX } from './PostFX';
import { installAtmosphere } from './Atmosphere';

const BASE_VFOV_DEG = 55;
const BASE_ASPECT = 16 / 9;
const MIN_FOV = 45;
const MAX_FOV = 82;
/** The lowest dynamic resolution: below this the picture is mush, and it buys little. */
const MIN_SCALE = 0.6;

/**
 * Owns the WebGL renderer and the main camera.
 *
 * Two responsibilities worth calling out:
 *
 * 1. **Aspect handling.** We preserve framing by adapting vertical FOV rather
 *    than letterboxing, so a phone in portrait sees a taller slice of the world
 *    instead of black bars (docs/04-technical-architecture.md §4.5).
 * 2. **Dynamic resolution.** When the rolling frame rate sags we scale the
 *    render target down rather than dropping features, which is far less
 *    visible to the player.
 */
export class RendererService {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly postFX: PostFX;

  private resolutionScale = 1;
  private targetScale = 1;
  private adaptClock = 0;
  private baseFov = BASE_VFOV_DEG;
  private contextLost = false;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly viewport: Viewport,
    private readonly bus: EventBus,
  ) {
    // Before anything compiles: every material's fog becomes the atmosphere.
    installAtmosphere();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: viewport.tier !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x141724, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    if (viewport.tier !== 'low') {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    // Far enough for the mountain past the rim (game/world/Fuji, ~400 m).
    this.camera = new THREE.PerspectiveCamera(BASE_VFOV_DEG, 1, 0.1, 650);
    this.postFX = new PostFX(this.renderer, this.camera, viewport.tier);

    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    this.bus.on('viewport:resized', () => this.applySize());
    this.applySize();
  }

  /** Base field of view before aspect correction. Contextual cameras set this. */
  setBaseFov(deg: number): void {
    this.baseFov = deg;
    this.applyFov();
  }

  /** The device's quality tier, for anything that scales its own cost. */
  get tier(): QualityTier {
    return this.viewport.tier;
  }

  get isContextLost(): boolean {
    return this.contextLost;
  }

  /**
   * Feed the current frame rate in; the render target scales down when we are
   * below target and recovers when we are comfortably above it.
   *
   * Judged twice a second, not every frame. The rate is a 30-frame average, so
   * a change of scale takes half a second to show in it; judged every frame,
   * one slow patch (shaders compiling at load) stepped the scale to the floor
   * before the first step could register. And a band rather than a line: it
   * used to recover only above 58 fps, which a 60 Hz display rarely reports,
   * so once down it stayed down — a blurred picture for no frames gained.
   */
  updateAdaptiveResolution(fps: number, dt: number): void {
    if (fps <= 0) return;
    this.adaptClock += dt;
    if (this.adaptClock < 0.5) return;
    this.adaptClock = 0;
    if (fps < 40) this.targetScale = Math.max(MIN_SCALE, this.targetScale - 0.1);
    else if (fps > 52) this.targetScale = Math.min(1, this.targetScale + 0.05);

    if (Math.abs(this.targetScale - this.resolutionScale) > 0.01) {
      this.resolutionScale = this.targetScale;
      this.applySize();
    }
  }

  render(scene: THREE.Scene, deltaTime = 1 / 60): void {
    if (this.contextLost) return;
    this.postFX.render(scene, deltaTime);
  }

  dispose(): void {
    this.postFX.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.renderer.dispose();
  }

  private applySize(): void {
    const w = this.viewport.width;
    const h = this.viewport.height;

    this.renderer.setPixelRatio(this.viewport.dpr * this.resolutionScale);
    this.renderer.setSize(w, h, false);
    this.postFX?.setSize(w, h);

    this.camera.aspect = w / h;
    this.applyFov();
  }

  private applyFov(): void {
    // Hold the horizontal framing constant as the aspect ratio changes.
    const aspect = this.camera.aspect || BASE_ASPECT;
    const baseRad = (this.baseFov * Math.PI) / 180;
    const fovRad = 2 * Math.atan(Math.tan(baseRad / 2) * (BASE_ASPECT / aspect));
    this.camera.fov = clamp((fovRad * 180) / Math.PI, MIN_FOV, MAX_FOV);
    this.camera.updateProjectionMatrix();
  }

  private onContextLost = (event: Event): void => {
    // Without preventDefault the context can never be restored.
    event.preventDefault();
    this.contextLost = true;
    this.bus.emit('engine:contextLost');
  };

  private onContextRestored = (): void => {
    this.contextLost = false;
    this.applySize();
    this.bus.emit('engine:contextRestored');
  };
}
