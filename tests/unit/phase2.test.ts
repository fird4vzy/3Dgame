import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../../src/core/events/EventBus';
import { SceneManager } from '../../src/engine/scene/SceneManager';
import type { IScene } from '../../src/engine/scene/IScene';
import type { IAssetManager } from '../../src/engine/assets/types';
import { migrate } from '../../src/engine/save/migrations';
import { SAVE_VERSION, createDefaultSave } from '../../src/engine/save/schema';
import { SaveManager, type StorageLike } from '../../src/engine/save/SaveManager';
import { ClipResolver } from '../../src/engine/character/ClipResolver';
import {
  validateCharacterDefinition,
  type CharacterDefinition,
} from '../../src/engine/character/CharacterDefinition';
import { GameStateManager } from '../../src/game/state/GameStateManager';

/** In-memory storage so save tests need no browser. */
function makeStorage(seed?: Record<string, string>): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function makeScene(id: string, overlay = false): IScene & { calls: string[] } {
  const calls: string[] = [];
  return {
    id,
    overlay,
    calls,
    assetBundles: [`${id}_bundle`],
    onEnter: () => void calls.push('enter'),
    onExit: () => void calls.push('exit'),
    dispose: () => void calls.push('dispose'),
    fixedUpdate: () => void calls.push('fixed'),
    render: () => void calls.push('render'),
  };
}

function makeAssets(): IAssetManager & { acquired: string[]; released: string[] } {
  const acquired: string[] = [];
  const released: string[] = [];
  return {
    acquired,
    released,
    acquire: async (b) => void acquired.push(b),
    release: (b) => void released.push(b),
    get: <T>() => undefined as T,
    tryGet: <T>() => undefined as T | undefined,
    has: () => false,
    refCount: () => 0,
  };
}

describe('SceneManager', () => {
  let bus: EventBus;
  let assets: ReturnType<typeof makeAssets>;
  let manager: SceneManager;

  beforeEach(() => {
    bus = new EventBus();
    assets = makeAssets();
    manager = new SceneManager(bus, assets);
  });

  it('acquires bundles on push and releases them on pop', async () => {
    const scene = makeScene('planet');
    await manager.push(scene);
    expect(assets.acquired).toEqual(['planet_bundle']);

    await manager.pop();
    expect(assets.released).toEqual(['planet_bundle']);
    expect(scene.calls).toContain('dispose');
  });

  it('keeps the scene below loaded when an overlay is pushed', async () => {
    const planet = makeScene('planet');
    const pause = makeScene('pause', true);

    await manager.push(planet);
    await manager.push(pause);

    expect(manager.depth).toBe(2);
    expect(planet.calls).not.toContain('exit');
    // Only the deepest non-overlay scene simulates.
    expect(manager.simulating?.id).toBe('planet');
    expect(manager.current?.id).toBe('pause');
  });

  it('routes fixedUpdate only to the simulating scene', async () => {
    const planet = makeScene('planet');
    const pause = makeScene('pause', true);
    await manager.push(planet);
    await manager.push(pause);

    manager.fixedUpdate(1 / 60);
    expect(planet.calls.filter((c) => c === 'fixed')).toHaveLength(1);
    expect(pause.calls.filter((c) => c === 'fixed')).toHaveLength(0);
  });

  it('disposes the outgoing scene only after the incoming one is ready', async () => {
    const order: string[] = [];
    const outgoing: IScene = {
      id: 'a',
      assetBundles: [],
      onEnter: () => {},
      onExit: () => void order.push('a:exit'),
      dispose: () => void order.push('a:dispose'),
    };
    const incoming: IScene = {
      id: 'b',
      assetBundles: [],
      onEnter: () => void order.push('b:enter'),
    };

    await manager.push(outgoing);
    await manager.replace(incoming);

    // b enters before a is disposed — that is what avoids a blank frame.
    expect(order).toEqual(['a:exit', 'b:enter', 'a:dispose']);
    expect(manager.depth).toBe(1);
  });

  it('ignores re-entrant transitions', async () => {
    const a = makeScene('a');
    const b = makeScene('b');
    // Fire both without awaiting the first; the second must be dropped.
    const first = manager.push(a);
    const second = manager.push(b);
    await Promise.all([first, second]);
    expect(manager.depth).toBe(1);
  });
});

describe('save migrations', () => {
  it('upgrades a v1 save and derives the new stem field', () => {
    const v1 = {
      schemaVersion: 1,
      progress: { completedContracts: ['c01'], litDistricts: ['landing', 'bramblewood'] },
      settings: { masterVolume: 0.5 },
      stats: { deliveriesMade: 2 },
    };

    const result = migrate(v1);
    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(1);
    expect(result.save.schemaVersion).toBe(SAVE_VERSION);
    // v1 had no explicit stems; they are derived from the lit districts.
    expect(result.save.progress.enabledStems).toEqual(['landing', 'bramblewood']);
    expect(result.save.progress.completedContracts).toEqual(['c01']);
  });

  it('backfills every missing field with defaults', () => {
    const result = migrate({ schemaVersion: SAVE_VERSION });
    expect(result.save.progress.collectedShards).toEqual([]);
    expect(result.save.stats.runsCompleted).toBe(0);
    expect(result.save.settings.masterVolume).toBeGreaterThan(0);
    expect(result.save.progress.currentContract).toBeNull();
  });

  it('preserves values the player already set', () => {
    const result = migrate({ schemaVersion: SAVE_VERSION, settings: { masterVolume: 0.15 } });
    expect(result.save.settings.masterVolume).toBe(0.15);
  });

  it('refuses to downgrade a save from a newer build', () => {
    expect(() => migrate({ schemaVersion: SAVE_VERSION + 5 })).toThrow(/newer than this build/);
  });

  it('is a no-op for a current save', () => {
    const current = createDefaultSave();
    const result = migrate(current as unknown as Record<string, unknown>);
    expect(result.migrated).toBe(false);
  });
});

describe('SaveManager', () => {
  it('quarantines a corrupt save and starts fresh', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const storage = makeStorage({ 'lumenpost.save': '{not json at all' });
    const bus = new EventBus();
    const corrupt = vi.fn();
    bus.on('save:corrupt', corrupt);

    const save = new SaveManager(bus, storage);

    expect(corrupt).toHaveBeenCalledTimes(1);
    expect(save.get().schemaVersion).toBe(SAVE_VERSION);
    // The damaged data is kept for recovery rather than thrown away.
    const backups = [...storage.map.keys()].filter((k) => k.includes('corrupt'));
    expect(backups).toHaveLength(1);
    expect(storage.map.get(backups[0]!)).toBe('{not json at all');
  });

  it('writes on flush and reports the byte count', () => {
    const storage = makeStorage();
    const bus = new EventBus();
    const written = vi.fn();
    bus.on('save:written', written);

    const save = new SaveManager(bus, storage);
    save.update((draft) => {
      draft.stats.deliveriesMade = 3;
    });
    save.flush();

    expect(written).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.map.get('lumenpost.save')!).stats.deliveriesMade).toBe(3);
  });

  it('survives storage that throws on write', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bus = new EventBus();
    const hostile: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    const save = new SaveManager(bus, hostile);
    save.update((d) => void (d.stats.deliveriesMade = 1));
    expect(() => save.flush()).not.toThrow();
  });
});

describe('ClipResolver', () => {
  const definition: CharacterDefinition = {
    id: 'test',
    displayName: 'Test',
    height: 1.6,
    source: { kind: 'gltf', url: 'x.glb' },
    clips: { idle: 'Idle', walk: 'Walk_Fwd', run: 'Run_Fwd', glide: 'GlideLoop' },
    fallback: { clips: { glide: 'fall', carry_walk: 'walk' } },
  };

  it('resolves a directly mapped clip', () => {
    const resolver = new ClipResolver(definition, new Set(['Idle', 'Walk_Fwd']));
    expect(resolver.resolve('idle')).toEqual({ sourceName: 'Idle', substituted: false, via: 'idle' });
  });

  it('substitutes through the fallback chain when a clip is absent', () => {
    // carry_walk is not mapped at all, but falls back to walk.
    const resolver = new ClipResolver(definition, new Set(['Walk_Fwd']));
    expect(resolver.resolve('carry_walk')).toEqual({
      sourceName: 'Walk_Fwd',
      substituted: true,
      via: 'walk',
    });
  });

  it('returns null rather than throwing when nothing can satisfy a clip', () => {
    const resolver = new ClipResolver(definition, new Set([]));
    expect(resolver.resolve('idle')).toBeNull();
  });

  it('reports which clips a partial rig cannot satisfy', () => {
    const resolver = new ClipResolver(definition, new Set(['Idle', 'Walk_Fwd', 'Run_Fwd']));
    expect(resolver.missing()).toEqual(['glide']);
  });
});

describe('character manifest validation', () => {
  it('accepts a well-formed spritesheet definition', () => {
    const def: CharacterDefinition = {
      id: 'ren',
      displayName: 'Ren',
      height: 1.8,
      source: {
        kind: 'spritesheet',
        url: 'atlas.png',
        frames: { idle: { x: 0, y: 0, w: 48, h: 112 } },
        animations: { idle: { frames: ['idle'] } },
      },
    };
    expect(validateCharacterDefinition(def)).toEqual([]);
  });

  it('catches an animation referencing a frame that does not exist', () => {
    const def = {
      id: 'ren',
      displayName: 'Ren',
      height: 1.8,
      source: {
        kind: 'spritesheet',
        url: 'atlas.png',
        frames: { idle: { x: 0, y: 0, w: 10, h: 10 } },
        animations: { walk: { frames: ['walk_01'] } },
      },
    } as CharacterDefinition;
    expect(validateCharacterDefinition(def)).toContain(
      'animation "walk" references unknown frame "walk_01"',
    );
  });

  it('rejects a definition with no height', () => {
    const def = { id: 'x', displayName: 'x', source: { kind: 'gltf', url: 'a.glb' } } as CharacterDefinition;
    expect(validateCharacterDefinition(def)).toContain(
      '"height" must be a positive number of metres',
    );
  });
});

describe('GameStateManager', () => {
  it('walks the happy path from boot to playing', () => {
    const bus = new EventBus();
    const state = new GameStateManager(bus);
    expect(state.current).toBe('boot');
    state.send('engineReady');
    state.send('assetsReady');
    state.send('startRun');
    state.send('worldReady');
    expect(state.current).toBe('playing');
    expect(state.simulates).toBe(true);
  });

  it('suspends simulation but keeps rendering while paused', () => {
    const state = new GameStateManager(new EventBus());
    for (const e of ['engineReady', 'assetsReady', 'startRun', 'worldReady', 'pause'] as const) {
      state.send(e);
    }
    expect(state.current).toBe('paused');
    expect(state.simulates).toBe(false);
    expect(state.rendersWorld).toBe(true);
  });

  it('refuses illegal transitions', () => {
    const state = new GameStateManager(new EventBus());
    expect(state.send('pause')).toBe(false);
    expect(state.current).toBe('boot');
  });

  it('announces every transition on the bus', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('state:changed', (p) => seen.push(`${p.from}->${p.to}`));
    new GameStateManager(bus).send('engineReady');
    expect(seen).toEqual(['boot->preload']);
  });
});
