export type AssetType = 'texture' | 'json' | 'audio' | 'gltf';

export interface AssetEntry {
  id: string;
  type: AssetType;
  url: string;
  /** Approximate compressed size in bytes, used to weight the progress bar. */
  bytes?: number;
}

export interface BundleEntry {
  id: string;
  assets: AssetEntry[];
}

export interface AssetManifest {
  version: number;
  bundles: BundleEntry[];
}

export interface IAssetManager {
  /** Load a bundle (or take another reference to an already-loaded one). */
  acquire(bundle: string, onProgress?: (fraction: number) => void): Promise<void>;
  /** Drop a reference. At zero, the bundle's GPU resources are disposed. */
  release(bundle: string): void;
  /** Retrieve a loaded asset. Throws if it is not loaded — a programming error. */
  get<T>(id: string): T;
  /** Retrieve a loaded asset, or undefined. */
  tryGet<T>(id: string): T | undefined;
  has(id: string): boolean;
  refCount(bundle: string): number;
}
