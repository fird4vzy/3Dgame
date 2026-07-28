import * as THREE from 'three';
import type { EventBus } from '@core/events/EventBus';
import type { Viewport } from '@engine/platform/Viewport';
import { clamp } from '@core/math/spherical';

const BASE_VFOV_DEG = 55;
const BASE_ASPECT = 16 / 9;
const MIN_FOV = 45;
const MAX_FOV = 82;

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

  private resolutionScale = 1;
  private targetScale = 1;
  private baseFov = BASE_VFOV_DEG;
  private contextLost = false;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly viewport: Viewport,
    private readonly bus: EventBus,
  ) {
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

    this.camera = new THREE.PerspectiveCamera(BASE_VFOV_DEG, 1, 0.1, 400);

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

  get isContextLost(): boolean {
    return this.contextLost;
  }

  /**
   * Feed the current frame rate in; the render target scales down when we are
   * below target and recovers slowly when we are comfortably above it.
   */
  updateAdaptiveResolution(fps: number, dt: number): void {
    if (fps <= 0) return;
    if (fps < 55) this.targetScale = Math.max(0.65, this.targetScale - 0.1);
    else if (fps > 58) this.targetScale = Math.min(1, this.targetScale + 0.02 * dt * 60);

    if (Math.abs(this.targetScale - this.resolutionScale) > 0.01) {
      this.resolutionScale = this.targetScale;
      this.applySize();
    }
  }

  render(scene: THREE.Scene): void {
    if (this.contextLost) return;
    this.renderer.render(scene, this.camera);
  }

  dispose(): void {
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
