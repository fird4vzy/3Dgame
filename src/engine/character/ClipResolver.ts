import type { CharacterDefinition, ClipName } from './CharacterDefinition';

export interface ResolvedClip {
  /** The clip name in the supplied asset. */
  sourceName: string;
  /** True if we substituted a different canonical clip via `fallback`. */
  substituted: boolean;
  /** Which canonical clip actually supplied the animation. */
  via: ClipName;
}

/**
 * Maps canonical clip names onto whatever the supplied art calls them, applying
 * the manifest's fallback chain when a clip is missing.
 *
 * The point of this indirection is that a *partial* character still runs. Hand
 * us a rig with only idle, walk and run and the game degrades gracefully rather
 * than throwing the first time the player glides.
 */
export class ClipResolver {
  private readonly warned = new Set<string>();

  constructor(
    private readonly definition: CharacterDefinition,
    /** Clip names actually present in the loaded asset. */
    private readonly available: ReadonlySet<string>,
  ) {}

  /** Resolve a canonical clip, following one level of fallback. */
  resolve(clip: ClipName): ResolvedClip | null {
    const direct = this.definition.clips?.[clip];
    if (direct && this.available.has(direct)) {
      return { sourceName: direct, substituted: false, via: clip };
    }

    const fallback = this.definition.fallback?.clips?.[clip];
    if (fallback) {
      const mapped = this.definition.clips?.[fallback];
      if (mapped && this.available.has(mapped)) {
        return { sourceName: mapped, substituted: true, via: fallback };
      }
    }

    this.warnOnce(clip, direct);
    return null;
  }

  /** Every canonical clip that cannot be satisfied, for the asset report. */
  missing(): ClipName[] {
    const result: ClipName[] = [];
    for (const clip of Object.keys(this.definition.clips ?? {}) as ClipName[]) {
      if (!this.resolve(clip)) result.push(clip);
    }
    return result;
  }

  private warnOnce(clip: ClipName, attempted: string | undefined): void {
    if (this.warned.has(clip)) return;
    this.warned.add(clip);
    if (!import.meta.env?.DEV) return;
    console.warn(
      `[ClipResolver] "${this.definition.id}" has no usable clip for "${clip}"` +
        (attempted ? ` (manifest points at "${attempted}", which the asset does not contain)` : '') +
        '. Add it to the rig, map it in the manifest, or give it a fallback.',
    );
  }
}
