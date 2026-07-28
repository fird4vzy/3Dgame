import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../../src/core/events/EventBus';
import { QuestSystem } from '../../src/game/systems/QuestSystem';
import { WarmthSystem, ratingFor } from '../../src/game/systems/WarmthSystem';
import { DialogueSystem } from '../../src/game/systems/DialogueSystem';
import { InteractionSystem } from '../../src/game/systems/InteractionSystem';
import { ShardSystem } from '../../src/game/systems/ShardSystem';
import { DistrictRegistry } from '../../src/game/world/DistrictRegistry';
import { SpatialHash } from '../../src/engine/physics/SpatialHash';
import { CONTRACTS, DISTRICTS, NPCS } from '../../src/data/content';

describe('QuestSystem', () => {
  let bus: EventBus;
  let quests: QuestSystem;

  beforeEach(() => {
    bus = new EventBus();
    quests = new QuestSystem(bus);
  });

  it('unlocks only the prerequisite-free contract at the start', () => {
    quests.reevaluate();
    const available = quests.all.filter((r) => r.state === 'available');
    expect(available).toHaveLength(1);
    expect(available[0]!.def.id).toBe('c01_landing');
  });

  it('unlocks the next contract when one completes, in chain order', () => {
    quests.reevaluate();
    quests.accept('c01_landing', 0);
    quests.complete('c01_landing', 'bright', 1000);

    expect(quests.nextAvailable?.def.id).toBe('c02_bramblewood');
    expect(quests.completedCount).toBe(1);
  });

  it('refuses to accept a locked contract', () => {
    quests.reevaluate();
    expect(quests.accept('c05_spire', 0)).toBeNull();
  });

  it('records elapsed time and rating on completion', () => {
    quests.reevaluate();
    quests.accept('c01_landing', 1000);
    const record = quests.complete('c01_landing', 'warm', 4000);
    expect(record?.rating).toBe('warm');
    expect(record?.seconds).toBeCloseTo(3, 5);
  });

  it('announces completion on the bus', () => {
    const seen: string[] = [];
    bus.on('delivery:completed', (p) => seen.push(`${p.contractId}:${p.rating}`));
    quests.reevaluate();
    quests.accept('c01_landing', 0);
    quests.complete('c01_landing', 'cool', 0);
    expect(seen).toEqual(['c01_landing:cool']);
  });

  it('restores progress from a save without replaying events', () => {
    const seen: string[] = [];
    bus.on('delivery:completed', (p) => seen.push(p.contractId));
    quests.restore(['c01_landing', 'c02_bramblewood']);

    expect(quests.completedCount).toBe(2);
    expect(quests.nextAvailable?.def.id).toBe('c03_coil');
    expect(seen).toEqual([]);
  });

  it('reports all complete only after the final contract', () => {
    quests.restore(CONTRACTS.slice(0, 4).map((c) => c.id));
    expect(quests.allComplete).toBe(false);
    quests.accept('c05_spire', 0);
    quests.complete('c05_spire', 'bright', 0);
    expect(quests.allComplete).toBe(true);
  });

  it('has no failure state — every contract state is recoverable', () => {
    // Guarding the design commitment from GDD §2.6 in code.
    const states = quests.all.map((r) => r.state);
    expect(states).not.toContain('failed');
  });
});

describe('WarmthSystem', () => {
  it('maps warmth onto the documented rating bands', () => {
    expect(ratingFor(1)).toBe('bright');
    expect(ratingFor(0.67)).toBe('bright');
    expect(ratingFor(0.5)).toBe('warm');
    expect(ratingFor(0.26)).toBe('warm');
    expect(ratingFor(0.2)).toBe('cool');
    expect(ratingFor(0)).toBe('cool');
  });

  it('decays linearly over the contract duration', () => {
    const warmth = new WarmthSystem(new EventBus());
    warmth.track('p', 100);
    warmth.tick(50);
    expect(warmth.warmthOf('p')).toBeCloseTo(0.5, 5);
  });

  it('floors at zero rather than going negative', () => {
    const warmth = new WarmthSystem(new EventBus());
    warmth.track('p', 10);
    warmth.tick(999);
    expect(warmth.warmthOf('p')).toBe(0);
    expect(warmth.ratingOf('p')).toBe('cool');
  });

  it('emits at roughly 10 Hz, not once per tick', () => {
    const bus = new EventBus();
    const onChange = vi.fn();
    bus.on('parcel:warmthChanged', onChange);

    const warmth = new WarmthSystem(bus);
    warmth.track('p', 100);
    // 7 ticks of 1/60s crosses 0.1s once. (6 ticks is 0.0999... in floating
    // point and would sit just under the threshold.)
    for (let i = 0; i < 7; i++) warmth.tick(1 / 60);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('forgets a delivered parcel', () => {
    const warmth = new WarmthSystem(new EventBus());
    warmth.track('p', 10);
    warmth.forget('p');
    expect(warmth.warmthOf('p')).toBe(0);
  });
});

describe('DialogueSystem', () => {
  it('walks lines in order and resolves when finished', async () => {
    const bus = new EventBus();
    const lines: string[] = [];
    bus.on('dialogue:line', (p) => lines.push(p.text));

    const dialogue = new DialogueSystem(bus);
    const done = dialogue.start('t', [
      { speaker: 'A', text: 'one' },
      { speaker: 'B', text: 'two' },
    ]);

    expect(lines).toEqual(['one']);
    dialogue.advance();
    expect(lines).toEqual(['one', 'two']);

    dialogue.advance();
    await done;
    expect(dialogue.isActive).toBe(false);
  });

  it('resolves immediately for an empty conversation', async () => {
    const dialogue = new DialogueSystem(new EventBus());
    await expect(dialogue.start('empty', [])).resolves.toBeUndefined();
  });

  it('skip ends the conversation and resolves', async () => {
    const dialogue = new DialogueSystem(new EventBus());
    const done = dialogue.start('t', [{ speaker: 'A', text: 'x' }]);
    dialogue.skip();
    await done;
    expect(dialogue.isActive).toBe(false);
  });
});

describe('InteractionSystem', () => {
  const make = (id: string, position: THREE.Vector3, radius = 3) => ({
    id,
    position,
    radius,
    prompt: 'Talk',
    enabled: true,
    onInteract: vi.fn(),
  });

  it('focuses an interactable in range and clears it out of range', () => {
    const bus = new EventBus();
    const system = new InteractionSystem(bus);
    system.register(make('a', new THREE.Vector3(0, 0, 2)));

    system.update(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1));
    expect(system.current?.id).toBe('a');

    system.update(new THREE.Vector3(0, 0, -20), new THREE.Vector3(0, 0, 1));
    expect(system.current).toBeNull();
  });

  it('prefers what you are looking at over what is marginally closer', () => {
    const system = new InteractionSystem(new EventBus());
    // `behind` is nearer, `ahead` is in front of the player.
    system.register(make('behind', new THREE.Vector3(0, 0, -1.5)));
    system.register(make('ahead', new THREE.Vector3(0, 0, 2.0)));

    system.update(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1));
    expect(system.current?.id).toBe('ahead');
  });

  it('ignores disabled interactables', () => {
    const system = new InteractionSystem(new EventBus());
    system.register(make('a', new THREE.Vector3(0, 0, 1)));
    system.setEnabled('a', false);
    system.update(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1));
    expect(system.current).toBeNull();
  });

  it('activate fires the focused handler and reports whether it ran', () => {
    const system = new InteractionSystem(new EventBus());
    const item = make('a', new THREE.Vector3(0, 0, 1));
    system.register(item);

    expect(system.activate()).toBe(false); // nothing focused yet
    system.update(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1));
    expect(system.activate()).toBe(true);
    expect(item.onInteract).toHaveBeenCalledTimes(1);
  });

  it('announces focus changes exactly once per change', () => {
    const bus = new EventBus();
    const onFocus = vi.fn();
    bus.on('interaction:focusChanged', onFocus);

    const system = new InteractionSystem(bus);
    system.register(make('a', new THREE.Vector3(0, 0, 1)));

    const at = new THREE.Vector3(0, 0, 0);
    const forward = new THREE.Vector3(0, 0, 1);
    system.update(at, forward);
    system.update(at, forward);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});

describe('ShardSystem', () => {
  it('collects on proximity and reports progress', () => {
    const bus = new EventBus();
    const events: string[] = [];
    bus.on('shard:collected', (p) => events.push(`${p.total}/${p.of}`));

    const shards = new ShardSystem(bus);
    const object = new THREE.Object3D();
    object.position.set(0, 0, 0);
    shards.add('s1', object);

    shards.update(0.016, new THREE.Vector3(0, 0, 40));
    expect(shards.collected).toBe(0);

    shards.update(0.016, new THREE.Vector3(0, 0, 0));
    expect(shards.collected).toBe(1);
    expect(object.visible).toBe(false);
    expect(events).toEqual(['1/1']);
  });

  it('never double-collects', () => {
    const shards = new ShardSystem(new EventBus());
    const object = new THREE.Object3D();
    shards.add('s1', object);

    shards.update(0.016, new THREE.Vector3(0, 0, 0));
    shards.update(0.016, new THREE.Vector3(0, 0, 0));
    expect(shards.collected).toBe(1);
  });

  it('restores collected shards from a save', () => {
    const shards = new ShardSystem(new EventBus());
    const a = new THREE.Object3D();
    const b = new THREE.Object3D();
    shards.add('s1', a);
    shards.add('s2', b);

    shards.restore(['s1']);
    expect(shards.collected).toBe(1);
    expect(a.visible).toBe(false);
    expect(b.visible).toBe(true);
    expect(shards.collectedIds).toEqual(['s1']);
  });
});

describe('DistrictRegistry', () => {
  it('assigns every district a distinct direction', () => {
    const registry = new DistrictRegistry();
    expect(registry.all).toHaveLength(DISTRICTS.length);

    for (const a of registry.all) {
      for (const b of registry.all) {
        if (a === b) continue;
        // No two centres should sit on top of each other.
        expect(a.direction.dot(b.direction)).toBeLessThan(0.98);
      }
    }
  });

  it('resolves a point at a district centre to that district', () => {
    const registry = new DistrictRegistry();
    for (const runtime of registry.all) {
      const point = runtime.direction.clone().multiplyScalar(60);
      expect(registry.at(point).def.id).toBe(runtime.def.id);
    }
  });

  it('covers the whole sphere — every point belongs somewhere', () => {
    const registry = new DistrictRegistry();
    for (let i = 0; i < 200; i++) {
      const p = new THREE.Vector3(
        Math.sin(i * 1.7),
        Math.cos(i * 2.3),
        Math.sin(i * 0.9),
      ).normalize().multiplyScalar(60);
      expect(registry.at(p)).toBeDefined();
    }
  });

  it('starts with every district dark', () => {
    expect(new DistrictRegistry().litCount).toBe(0);
  });
});

describe('SpatialHash', () => {
  it('finds items within the radius and excludes those outside', () => {
    const hash = new SpatialHash<{ id: string; position: THREE.Vector3 }>(8);
    hash.insert({ id: 'near', position: new THREE.Vector3(1, 0, 0) });
    hash.insert({ id: 'far', position: new THREE.Vector3(40, 0, 0) });

    const found = hash.query(new THREE.Vector3(0, 0, 0), 5);
    expect(found.map((f) => f.id)).toEqual(['near']);
  });

  it('re-buckets an item that moved across a cell boundary', () => {
    const hash = new SpatialHash<{ id: string; position: THREE.Vector3 }>(8);
    const item = { id: 'a', position: new THREE.Vector3(0, 0, 0) };
    hash.insert(item);

    item.position.set(30, 0, 0);
    hash.update(item);

    expect(hash.query(new THREE.Vector3(0, 0, 0), 5)).toHaveLength(0);
    expect(hash.query(new THREE.Vector3(30, 0, 0), 5)).toHaveLength(1);
  });

  it('removes items', () => {
    const hash = new SpatialHash<{ id: string; position: THREE.Vector3 }>(8);
    const item = { id: 'a', position: new THREE.Vector3(0, 0, 0) };
    hash.insert(item);
    hash.remove(item);
    expect(hash.size).toBe(0);
    expect(hash.query(new THREE.Vector3(0, 0, 0), 5)).toHaveLength(0);
  });
});

describe('content integrity', () => {
  it('gives every contract a giver and recipient that exist', () => {
    const ids = new Set(NPCS.map((n) => n.id));
    for (const contract of CONTRACTS) {
      expect(ids.has(contract.giver)).toBe(true);
      expect(ids.has(contract.recipient)).toBe(true);
    }
  });

  it('references only districts that exist', () => {
    const districtIds = new Set(DISTRICTS.map((d) => d.id));
    for (const contract of CONTRACTS) {
      expect(districtIds.has(contract.district)).toBe(true);
    }
  });

  it('forms one unbroken prerequisite chain with a single entry point', () => {
    const roots = CONTRACTS.filter((c) => c.prerequisites.length === 0);
    expect(roots).toHaveLength(1);

    // Every prerequisite must name a real contract.
    const ids = new Set(CONTRACTS.map((c) => c.id));
    for (const contract of CONTRACTS) {
      for (const prerequisite of contract.prerequisites) {
        expect(ids.has(prerequisite)).toBe(true);
      }
    }
  });

  it('gives every district a unique music stem', () => {
    const stems = DISTRICTS.map((d) => d.stem);
    expect(new Set(stems).size).toBe(stems.length);
  });

  it('gives every contract dialogue at both ends', () => {
    for (const contract of CONTRACTS) {
      expect(contract.onAccept.length).toBeGreaterThan(0);
      expect(contract.onDeliver.length).toBeGreaterThan(0);
    }
  });
});
