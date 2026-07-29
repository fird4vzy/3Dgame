import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../../src/core/events/EventBus';
import { QuestSystem } from '../../src/game/systems/QuestSystem';
import { ShardSystem } from '../../src/game/systems/ShardSystem';
import { pickInDirection, type NavRect } from '../../src/ui/GamepadNavigator';
import { AmbienceDirector } from '../../src/engine/audio/AmbienceDirector';
import { t, setLocale, getLocale, registerLocale } from '../../src/engine/i18n/Localization';
import { DISTRICTS, CONTRACTS } from '../../src/data/content';

const rect = (left: number, top: number, width = 100, height = 40): NavRect => ({
  left,
  top,
  width,
  height,
});

describe('gamepad menu navigation', () => {
  it('moves to the item directly below on "down"', () => {
    expect(pickInDirection(rect(0, 0), [rect(0, 100), rect(0, 200)], 'down')).toBe(0);
  });

  it('prefers alignment over raw proximity', () => {
    const candidates = [rect(400, 60), rect(0, 100)];
    // Tab order would take the first; a player pressing "down" means the second.
    expect(pickInDirection(rect(0, 0), candidates, 'down')).toBe(1);
  });

  it('returns -1 when nothing lies that way', () => {
    expect(pickInDirection(rect(0, 200), [rect(0, 300)], 'up')).toBe(-1);
  });

  it('ignores items essentially level with the current one', () => {
    expect(pickInDirection(rect(0, 100), [rect(300, 102)], 'down')).toBe(-1);
  });

  it('handles left and right symmetrically', () => {
    const from = rect(200, 0);
    expect(pickInDirection(from, [rect(400, 0), rect(0, 0)], 'right')).toBe(0);
    expect(pickInDirection(from, [rect(400, 0), rect(0, 0)], 'left')).toBe(1);
  });

  it('picks the nearest of several aligned options', () => {
    expect(pickInDirection(rect(0, 0), [rect(0, 300), rect(0, 100), rect(0, 200)], 'down')).toBe(1);
  });

  it('copes with an empty candidate list', () => {
    expect(pickInDirection(rect(0, 0), [], 'down')).toBe(-1);
  });
});

/** Minimal Web Audio stand-in: only what AmbienceDirector actually touches. */
function fakeContext() {
  const ramps: Array<{ id: string; target: number; at: number }> = [];
  let gainCount = 0;

  const context = {
    currentTime: 0,
    createGain: () => {
      const id = `gain${gainCount++}`;
      return {
        gain: {
          value: 0,
          cancelScheduledValues: vi.fn(),
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: (target: number, at: number) => ramps.push({ id, target, at }),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    },
    createBufferSource: () => ({
      buffer: null as AudioBuffer | null,
      loop: false,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }),
  };
  return { context, ramps };
}

const fakeBuffer = () => ({ duration: 20 }) as unknown as AudioBuffer;

describe('AmbienceDirector', () => {
  const build = () => {
    const { context, ramps } = fakeContext();
    const destination = context.createGain();
    const director = new AmbienceDirector(
      context as unknown as AudioContext,
      destination as unknown as GainNode,
    );
    return { director, ramps };
  };

  it('registers beds and starts them together', () => {
    const { director } = build();
    director.addBed('landing', fakeBuffer());
    director.addBed('coil', fakeBuffer());
    expect(director.bedCount).toBe(2);
    expect(director.isPlaying).toBe(false);

    director.start();
    expect(director.isPlaying).toBe(true);
  });

  it('crossfades: target ramps to 1, every other to 0', () => {
    const { director, ramps } = build();
    director.addBed('landing', fakeBuffer());
    director.addBed('coil', fakeBuffer());
    director.start();

    ramps.length = 0;
    director.setDistrict('coil');

    expect(ramps).toHaveLength(2);
    expect(ramps.map((r) => r.target).sort()).toEqual([0, 1]);
    expect(director.currentDistrict).toBe('coil');
  });

  it('does nothing when asked for the district already playing', () => {
    const { director, ramps } = build();
    director.addBed('landing', fakeBuffer());
    director.start();
    director.setDistrict('landing');

    ramps.length = 0;
    // Called every frame in practice, so a repeat must be free.
    director.setDistrict('landing');
    expect(ramps).toHaveLength(0);
  });

  it('ignores setDistrict before start, so nothing plays out of phase', () => {
    const { director, ramps } = build();
    director.addBed('landing', fakeBuffer());
    director.setDistrict('landing');
    expect(ramps).toHaveLength(0);
    expect(director.currentDistrict).toBeNull();
  });

  it('refuses beds added after start', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { director } = build();
    director.addBed('landing', fakeBuffer());
    director.start();
    director.addBed('coil', fakeBuffer());
    expect(director.bedCount).toBe(1);
  });

  it('silence ramps every bed to zero and clears the district', () => {
    const { director, ramps } = build();
    director.addBed('landing', fakeBuffer());
    director.addBed('coil', fakeBuffer());
    director.start();
    director.setDistrict('landing');

    ramps.length = 0;
    director.silence();
    expect(ramps.every((r) => r.target === 0)).toBe(true);
    expect(director.currentDistrict).toBeNull();
  });
});

describe('run reset and restore', () => {
  it('reset returns contracts to locked, then re-unlocks the first', () => {
    const quests = new QuestSystem(new EventBus());
    quests.restore(['c01_landing', 'c02_bramblewood']);
    expect(quests.completedCount).toBe(2);

    quests.reset();
    expect(quests.completedCount).toBe(0);
    expect(quests.nextAvailable?.def.id).toBe('c01_landing');
  });

  it('reset clears ratings so a new run inherits no score', () => {
    const quests = new QuestSystem(new EventBus());
    quests.reevaluate();
    quests.accept('c01_landing', 0);
    quests.complete('c01_landing', 'bright', 5000);

    quests.reset();
    expect(quests.ratings).toHaveLength(0);
    expect(quests.all.every((r) => r.seconds === null)).toBe(true);
  });

  it('restores the same chain position that was saved', () => {
    const first = new QuestSystem(new EventBus());
    first.reevaluate();
    first.accept('c01_landing', 0);
    first.complete('c01_landing', 'warm', 100);

    const second = new QuestSystem(new EventBus());
    second.restore(first.completedIds);
    expect(second.nextAvailable?.def.id).toBe(first.nextAvailable?.def.id);
  });

  it('makes collected shards collectable again after reset', () => {
    const shards = new ShardSystem(new EventBus());
    const object = new THREE.Object3D();
    shards.add('s1', object);

    shards.update(0.016, new THREE.Vector3(0, 0, 0));
    expect(shards.collected).toBe(1);

    shards.reset();
    expect(shards.collected).toBe(0);
    expect(object.visible).toBe(true);

    // And the spatial hash was repopulated, so it can be picked up again.
    shards.update(0.016, new THREE.Vector3(0, 0, 0));
    expect(shards.collected).toBe(1);
  });

  it('maps lit districts onto stems, not onto their own ids', () => {
    // The save stores district ids; the music director keys on stem names.
    // Conflating them restores no music at all.
    const stems = ['landing', 'bramblewood'].map(
      (id) => DISTRICTS.find((d) => d.id === id)?.stem,
    );
    expect(stems).toEqual(['bass', 'guitar']);
  });
});

describe('localisation', () => {
  it('returns the string for a known key', () => {
    expect(t('menu.settings')).toBe('Settings');
  });

  it('substitutes parameters', () => {
    expect(t('toast.districtLit', { name: 'Bramblewood', count: 2, total: 5 })).toBe(
      'Bramblewood is awake — 2 of 5',
    );
  });

  it('returns the key itself when missing, rather than blank or throwing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  it('falls back to English for an unknown locale', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setLocale('klingon');
    expect(getLocale()).toBe('en');
    expect(t('menu.settings')).toBe('Settings');
  });

  it('uses a registered locale, falling back per key', () => {
    registerLocale('test', { 'menu.settings': 'Réglages' });
    setLocale('test');
    expect(t('menu.settings')).toBe('Réglages');
    // A key absent from the locale falls back rather than vanishing.
    expect(t('menu.back')).toBe('Back');
    setLocale('en');
  });

  it('has a label for every rating a delivery can earn', () => {
    for (const rating of ['bright', 'warm', 'cool']) {
      expect(t(`rating.${rating}`)).not.toBe(`rating.${rating}`);
    }
  });

  it('renders the continue line with the real contract count', () => {
    expect(t('menu.continueDetail', { done: 3, total: CONTRACTS.length })).toBe(
      `3 of ${CONTRACTS.length} delivered`,
    );
  });
});
