import type { EventBus } from '@core/events/EventBus';
import { Store } from '@core/state/Store';
import type { SaveManager } from '@engine/save/SaveManager';
import type { SettingsData } from '@engine/save/schema';

export type SettingsListener = (settings: Readonly<SettingsData>) => void;

/**
 * Player settings, applied live and persisted through the save file.
 *
 * Settings live inside the save rather than a separate key so a single flush
 * keeps everything consistent, and so "reset progress" and "reset settings" can
 * be kept deliberately separate operations.
 */
export class SettingsManager {
  private readonly store: Store<SettingsData>;

  constructor(
    private readonly save: SaveManager,
    private readonly bus: EventBus,
  ) {
    this.store = new Store<SettingsData>({ ...save.get().settings });
  }

  get(): Readonly<SettingsData> {
    return this.store.get();
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    if (Object.is(this.store.get()[key], value)) return;

    this.store.set({ [key]: value } as Partial<SettingsData>);
    this.save.update((draft) => {
      draft.settings[key] = value;
    });

    if (key === 'qualityTier') {
      this.bus.emit('quality:changed', {
        tier: value === 'auto' ? 'medium' : (value as 'low' | 'medium' | 'high'),
        reason: 'user',
      });
    }
  }

  /** Subscribe to one setting. Fires only when that value actually changes. */
  observe<K extends keyof SettingsData>(
    key: K,
    callback: (value: SettingsData[K]) => void,
  ): () => void {
    return this.store.subscribe((s) => s[key], callback);
  }

  /**
   * Whether motion should be reduced — the player's explicit choice, or the OS
   * preference when they have not expressed one.
   */
  get prefersReducedMotion(): boolean {
    if (this.store.get().reduceMotion) return true;
    return typeof window !== 'undefined'
      ? (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
      : false;
  }
}
