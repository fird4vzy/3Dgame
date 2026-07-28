import type { EventBus } from '@core/events/EventBus';
import { migrate } from './migrations';
import { createDefaultSave, SAVE_KEY, type SaveData } from './schema';

/** Storage seam, so tests run without a browser and we can swap backends. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DEBOUNCE_MS = 800;

/**
 * Versioned, migrating, debounced save.
 *
 * `localStorage` rather than IndexedDB because saves are under 8 KB and
 * synchronous access keeps the flush-on-`pagehide` path simple and reliable —
 * an async write there is not guaranteed to complete.
 */
export class SaveManager {
  private data: SaveData;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(
    private readonly bus: EventBus,
    private readonly storage: StorageLike = safeLocalStorage(),
  ) {
    this.data = this.load();
    this.installFlushHandler();
  }

  get(): Readonly<SaveData> {
    return this.data;
  }

  /** Mutate and schedule a write. Cheap to call every frame. */
  update(mutator: (draft: SaveData) => void): void {
    mutator(this.data);
    this.data.updatedAt = Date.now();
    this.dirty = true;
    this.scheduleWrite();
  }

  /** Write immediately, bypassing the debounce. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;

    try {
      const json = JSON.stringify(this.data);
      this.storage.setItem(SAVE_KEY, json);
      this.dirty = false;
      this.bus.emit('save:written', { bytes: json.length });
    } catch (error) {
      // Quota exceeded or storage disabled (private mode). The game must keep
      // running — losing progress is bad, crashing is worse.
      console.error('[Save] write failed', error);
    }
  }

  reset(): void {
    this.data = createDefaultSave();
    this.dirty = true;
    this.flush();
  }

  private load(): SaveData {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(SAVE_KEY);
    } catch (error) {
      console.warn('[Save] storage unavailable; running without persistence', error);
      return createDefaultSave();
    }
    if (!raw) return createDefaultSave();

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const result = migrate(parsed);
      if (result.migrated) {
        console.info(`[Save] migrated v${result.fromVersion} → v${result.save.schemaVersion}`);
        this.dirty = true;
      }
      return result.save;
    } catch (error) {
      // Preserve the damaged save under a timestamped key so it can be
      // recovered or diagnosed, then start clean and tell the player.
      const backupKey = `${SAVE_KEY}.corrupt.${Date.now()}`;
      try {
        this.storage.setItem(backupKey, raw);
      } catch {
        // If even the backup fails, there is nothing more to do.
      }
      console.error('[Save] could not read save; starting fresh', error);
      this.bus.emit('save:corrupt', { backupKey });
      return createDefaultSave();
    }
  }

  private scheduleWrite(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, DEBOUNCE_MS);
  }

  private installFlushHandler(): void {
    if (typeof window === 'undefined') return;
    // `pagehide` fires on mobile tab kills where `beforeunload` does not.
    window.addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.flush();
    });
  }
}

/** localStorage can throw on access in private mode; degrade to a no-op. */
function safeLocalStorage(): StorageLike {
  try {
    const probe = '__lumenpost_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
    };
  }
}
