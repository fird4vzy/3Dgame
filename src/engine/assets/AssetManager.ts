import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { EventBus } from '@core/events/EventBus';
import { disposeObject } from '@engine/entity/World';
import type { AssetEntry, AssetManifest, IAssetManager } from './types';
import { pickAudioFormat } from '@engine/audio/formats';

interface LoadedAsset {
  value: unknown;
  type: AssetEntry['type'];
}

/**
 * Manifest-driven, bundle-scoped, reference-counted asset loading.
 *
 * Reference counting is centralised here for one reason: disposal of GPU
 * resources is the single most common source of WebGL memory leaks, and it is
 * far easier to get right in one place than at every call site. A bundle whose
 * count reaches zero has its geometries, materials and textures disposed.
 */
export class AssetManager implements IAssetManager {
  private manifest: AssetManifest = { version: 1, bundles: [] };

  private readonly loaded = new Map<string, LoadedAsset>();
  private readonly refCounts = new Map<string, number>();
  /** In-flight loads, so two acquires of the same bundle share one request. */
  private readonly inFlight = new Map<string, Promise<void>>();

  private readonly textureLoader = new THREE.TextureLoader();
  private readonly gltfLoader = new GLTFLoader();
  private audioContext: AudioContext | null = null;

  constructor(private readonly bus: EventBus) {}

  /** Provide the audio context so audio assets decode into the right one. */
  setAudioContext(context: AudioContext): void {
    this.audioContext = context;
  }

  async loadManifest(url: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`[Assets] manifest ${url} → HTTP ${response.status}`);
    this.manifest = (await response.json()) as AssetManifest;
  }

  /** Register a manifest directly. Used by tests and by generated content. */
  setManifest(manifest: AssetManifest): void {
    this.manifest = manifest;
  }

  async acquire(bundleId: string, onProgress?: (fraction: number) => void): Promise<void> {
    this.refCounts.set(bundleId, (this.refCounts.get(bundleId) ?? 0) + 1);

    // Already resident: the extra reference is all that was needed.
    const existing = this.inFlight.get(bundleId);
    if (existing) return existing;
    if (this.isBundleLoaded(bundleId)) {
      onProgress?.(1);
      return;
    }

    const bundle = this.manifest.bundles.find((b) => b.id === bundleId);
    if (!bundle) {
      // Undo the reference we optimistically took.
      this.refCounts.set(bundleId, (this.refCounts.get(bundleId) ?? 1) - 1);
      throw new Error(`[Assets] unknown bundle "${bundleId}"`);
    }

    const promise = this.loadBundle(bundle.assets, onProgress).finally(() => {
      this.inFlight.delete(bundleId);
    });
    this.inFlight.set(bundleId, promise);
    return promise;
  }

  release(bundleId: string): void {
    const count = (this.refCounts.get(bundleId) ?? 0) - 1;
    if (count > 0) {
      this.refCounts.set(bundleId, count);
      return;
    }

    this.refCounts.delete(bundleId);
    const bundle = this.manifest.bundles.find((b) => b.id === bundleId);
    if (!bundle) return;

    for (const entry of bundle.assets) {
      // An asset shared with a still-referenced bundle must survive.
      if (this.isAssetNeededElsewhere(entry.id, bundleId)) continue;
      this.disposeAsset(entry.id);
    }
  }

  get<T>(id: string): T {
    const asset = this.loaded.get(id);
    if (!asset) {
      throw new Error(
        `[Assets] "${id}" is not loaded. Acquire the bundle that contains it first.`,
      );
    }
    return asset.value as T;
  }

  tryGet<T>(id: string): T | undefined {
    return this.loaded.get(id)?.value as T | undefined;
  }

  has(id: string): boolean {
    return this.loaded.has(id);
  }

  refCount(bundleId: string): number {
    return this.refCounts.get(bundleId) ?? 0;
  }

  get loadedCount(): number {
    return this.loaded.size;
  }

  disposeAll(): void {
    for (const id of [...this.loaded.keys()]) this.disposeAsset(id);
    this.refCounts.clear();
  }

  private isBundleLoaded(bundleId: string): boolean {
    const bundle = this.manifest.bundles.find((b) => b.id === bundleId);
    if (!bundle) return false;
    return bundle.assets.every((a) => this.loaded.has(a.id));
  }

  private isAssetNeededElsewhere(assetId: string, excludingBundle: string): boolean {
    return this.manifest.bundles.some(
      (b) =>
        b.id !== excludingBundle &&
        (this.refCounts.get(b.id) ?? 0) > 0 &&
        b.assets.some((a) => a.id === assetId),
    );
  }

  private async loadBundle(
    assets: AssetEntry[],
    onProgress?: (fraction: number) => void,
  ): Promise<void> {
    const pending = assets.filter((a) => !this.loaded.has(a.id));
    if (pending.length === 0) {
      onProgress?.(1);
      return;
    }

    // Weight progress by byte size where known, so the bar does not stall on
    // one large file after racing through twenty small ones.
    const total = pending.reduce((sum, a) => sum + (a.bytes ?? 1), 0);
    let done = 0;

    await Promise.all(
      pending.map(async (entry) => {
        try {
          const value = await this.loadOne(entry);
          this.loaded.set(entry.id, { value, type: entry.type });
        } catch (error) {
          // A missing prop must never be a black screen: log it, carry on, and
          // let `get` throw only if gameplay genuinely depends on it.
          console.error(`[Assets] failed to load "${entry.id}" from ${entry.url}`, error);
        } finally {
          done += entry.bytes ?? 1;
          const fraction = Math.min(1, done / total);
          onProgress?.(fraction);
          this.bus.emit('asset:progress', { loaded: done, total });
        }
      }),
    );
  }

  private async loadOne(entry: AssetEntry): Promise<unknown> {
    // Manifest URLs carry an `{ext}` token for audio, resolved to whichever
    // container this browser can decode (Opus/WebM, or AAC/MP4 on Safari).
    const url = entry.url.replace('{ext}', pickAudioFormat());

    switch (entry.type) {
      case 'texture':
        return this.textureLoader.loadAsync(url);

      case 'json': {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }

      case 'audio': {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (!this.audioContext) throw new Error('no AudioContext registered');
        return this.audioContext.decodeAudioData(buffer);
      }

      case 'gltf':
        return this.gltfLoader.loadAsync(url);
    }
  }

  private disposeAsset(id: string): void {
    const asset = this.loaded.get(id);
    if (!asset) return;

    switch (asset.type) {
      case 'texture':
        (asset.value as THREE.Texture).dispose();
        break;
      case 'gltf':
        disposeObject((asset.value as GLTF).scene);
        break;
      // JSON and decoded audio are plain GC-able objects.
      case 'json':
      case 'audio':
        break;
    }
    this.loaded.delete(id);
  }
}
