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
import { InkOutlineEffect } from './InkOutlineEffect';
import type { QualityTier } from '@engine/platform/Viewport';

/**
 * Post-processing stack.
 *
 * Uses pmndrs `postprocessing` rather than three's own `EffectComposer` for one
 * reason that matters on weaker hardware: it **merges every effect into a single
 * fragment shader**, so bloom and vignette together cost one full-screen pass
 * instead of two ping-ponged render targets.
 *
 * Bloom is not decoration here. The entire premise is light returning to a dark
 * planet — without it, lamps, lumens and Ren's glasses merely get *brighter*
 * rather than appearing to emit, and the payoff of a district igniting lands
 * far softer.
 *
 * The whole stack is bypassed on the low tier, because a full-screen pass is
 * exactly what a weak GPU cannot afford.
 */
export class PostFX {
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: BloomEffect | null = null;
  private outline: InkOutlineEffect | null = null;
  private enabled: boolean;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly camera: THREE.PerspectiveCamera,
    tier: QualityTier,
  ) {
    this.enabled = tier !== 'low';
    if (!this.enabled) return;

    this.composer = new EffectComposer(renderer, {
      // A half-float buffer lets emissive materials exceed 1.0, which is what
      // gives bloom something to find. On an 8-bit buffer everything clips to
      // white first and the threshold has nothing left to separate.
      frameBufferType: THREE.HalfFloatType,
    });

    this.bloom = new BloomEffect({
      blendFunction: BlendFunction.ADD,
      // Sits above lit terrain but below a lamp's emissive, so dusk stays dusk
      // and only genuine light sources glow.
      luminanceThreshold: 0.55,
      luminanceSmoothing: 0.28,
      intensity: tier === 'high' ? 1.35 : 1.0,
      mipmapBlur: true,
      radius: 0.6,
    });

    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.4 });

    // Tone mapping has to happen at the END of the chain, not in the renderer.
    // Three tone-maps as it writes into the composer's buffer, so the values
    // bloom then reads are already compressed to display range — bloom adds on
    // top of that and the whole image washes out. Rendering linear and mapping
    // last is the only ordering that preserves contrast.
    renderer.toneMapping = THREE.NoToneMapping;
    const toneMapping = new ToneMappingEffect({
      mode: ToneMappingMode.AGX,
      // Matches the exposure the renderer was applying before.
      whitePoint: 4,
      middleGrey: 0.6,
    });

    // Ink outlines, before bloom.
    //
    // Order matters and this is the only one that works: bloom has to see the
    // lines already drawn, or the glow bleeds *over* them and the silhouette it
    // is meant to be lighting dissolves. Drawn first, a lamp blooms around a
    // line that stays crisp — which is exactly how the reference reads.
    this.outline = new InkOutlineEffect({
      // A fatter line on the high tier, where there are pixels to spare.
      thickness: tier === 'high' ? 1.2 : 1.0,
      strength: 0.85,
    });

    // The RenderPass is retargeted per scene rather than rebuilt, since scenes
    // are swapped at runtime.
    this.renderPass = new RenderPass(new THREE.Scene(), camera);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(
      new EffectPass(camera, this.outline, this.bloom, toneMapping, vignette),
    );
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
    this.outline = null;
  }
}
