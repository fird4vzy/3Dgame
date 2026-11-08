import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { GradeEffect } from './GradeEffect';
import type { QualityTier } from '@engine/platform/Viewport';

/**
 * Post-processing stack.
 *
 * Uses pmndrs `postprocessing` rather than three's own `EffectComposer` for one
 * reason that matters on weaker hardware: it **merges every effect into a single
 * fragment shader**, so bloom, grade and vignette together cost one full-screen
 * pass instead of several ping-ponged render targets.
 *
 * The chain is the one a film camera implies: render linear HDR, let the
 * brightest light spill (bloom), compress to display range (tone mapping),
 * then grade and vignette the *picture*. Every step out of that order does
 * something recognisably wrong — bloom after tone mapping cannot find the sun,
 * grading before it fights the curve.
 *
 * Antialiasing is MSAA on the composer's own buffer. The renderer's `antialias`
 * flag does nothing once a composer is in the way — it only applies to the
 * default framebuffer — and without it every roof edge and blade of grass
 * crawled, which reads as "cheap" faster than any lighting flaw.
 *
 * The whole stack is bypassed on the low tier, because a full-screen pass is
 * exactly what a weak GPU cannot afford.
 */
export class PostFX {
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: BloomEffect | null = null;
  private enabled: boolean;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly camera: THREE.PerspectiveCamera,
    tier: QualityTier,
  ) {
    this.enabled = tier !== 'low';
    if (!this.enabled) return;

    this.composer = new EffectComposer(renderer, {
      // Half-float so emissive lamps and the sun disk can exceed 1.0, which is
      // what gives bloom something to find.
      frameBufferType: THREE.HalfFloatType,
      multisampling: tier === 'high' ? 4 : 2,
    });

    this.bloom = new BloomEffect({
      blendFunction: BlendFunction.ADD,
      // Lamps, the sun and its glints off water bloom; a sunlit wall does not.
      luminanceThreshold: 0.95,
      luminanceSmoothing: 0.35,
      intensity: tier === 'high' ? 0.9 : 0.7,
      mipmapBlur: true,
      radius: 0.78,
    });

    // Tone mapping has to happen at the END of the chain, not in the renderer:
    // three tone-maps as it writes into the composer's buffer, so bloom would
    // read values already compressed to display range and wash out.
    renderer.toneMapping = THREE.NoToneMapping;
    // AgX, not ACES. ACES's toe crushes everything near black by about five
    // times, and the player's VRM is in dark navy denim on an MToon material
    // that cannot see the sky's environment light — under ACES she rendered
    // as a black cut-out (measured: skirt 19,19,21 against 21,32,45 before).
    // AgX keeps dark fabric legible; the grade puts back the saturation and
    // contrast AgX gives away. tools/probe-character-light.mjs measures it.
    const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });

    const grade = new GradeEffect({ contrast: 1.15, saturation: 1.32 });
    const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.42 });

    // The RenderPass is retargeted per scene rather than rebuilt, since scenes
    // are swapped at runtime.
    this.renderPass = new RenderPass(new THREE.Scene(), camera);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new EffectPass(camera, this.bloom, toneMapping, grade, vignette));
  }

  get isEnabled(): boolean {
    return this.enabled && this.composer !== null;
  }

  /** Toggle at runtime, from Settings. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled && this.composer !== null;
  }

  setBloomIntensity(intensity: number): void {
    if (this.bloom) this.bloom.intensity = intensity;
  }

  setSize(width: number, height: number): void {
    this.composer?.setSize(width, height);
  }

  /**
   * Draw a scene. Falls through to a direct render whenever post is disabled,
   * so callers never have to branch.
   */
  render(scene: THREE.Scene, deltaTime: number): void {
    if (!this.isEnabled || !this.composer || !this.renderPass) {
      this.renderer.render(scene, this.camera);
      return;
    }
    this.renderPass.mainScene = scene;
    this.composer.render(deltaTime);
  }

  dispose(): void {
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    this.bloom = null;
  }
}
