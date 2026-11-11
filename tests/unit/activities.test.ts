import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../../src/core/events/EventBus';
import { Entity } from '../../src/engine/entity/Entity';
import { BvhWorld } from '../../src/engine/physics/BvhWorld';
import type { InputManager } from '../../src/engine/input/InputManager';
import { InputManager as RealInput } from '../../src/engine/input/InputManager';
import { HorizonInstances } from '../../src/engine/render/HorizonInstances';
import { migrate } from '../../src/engine/save/migrations';
import { SAVE_VERSION, emptyJournal } from '../../src/engine/save/schema';
import { SphericalCharacterController } from '../../src/game/components/SphericalCharacterController';
import { JournalSystem } from '../../src/game/systems/JournalSystem';
import { landPoint } from '../../src/game/world/Activities';
import { PlanetTerrain } from '../../src/game/world/PlanetTerrain';
import { SEA_LEVEL_RADIUS } from '../../src/config/constants';
import { tuning } from '../../src/config/tuning';
import { CONTRACTS, NPCS } from '../../src/data/content';
import {
  COURSES,
  POSTCARDS,
  RANKS,
  SMALL_TALK,
  SOUVENIRS,
  STAMPS,
  medalFor,
} from '../../src/data/activities';

describe('the journal', () => {
  const make = (): { journal: JournalSystem; events: string[] } => {
    const bus = new EventBus();
    const events: string[] = [];
    bus.on('journal:changed', ({ kind, id }) => events.push(`${kind}:${id}`));
    bus.on('journal:rankUp', ({ title }) => events.push(`rank:${title}`));
    return { journal: new JournalSystem(bus), events };
  };

  it('records a find once, and says so once', () => {
    const { journal, events } = make();
    expect(journal.add('stamp', 'stamp_post')).toBe(true);
    expect(journal.add('stamp', 'stamp_post')).toBe(false);
    expect(journal.has('stamp', 'stamp_post')).toBe(true);
    expect(journal.points).toBe(1);
    expect(events).toEqual(['stamp:stamp_post']);
  });

  it('counts deliveries, finds and medals alike, and has room for all of them', () => {
    const { journal } = make();
    journal.deliveryTotal = CONTRACTS.length;
    expect(journal.total).toBe(STAMPS.length + SOUVENIRS.length + POSTCARDS.length + COURSES.length + CONTRACTS.length);
    journal.setDeliveries(2);
    journal.add('souvenir', SOUVENIRS[0]!.id);
    journal.add('postcard', POSTCARDS[0]!.id);
    expect(journal.points).toBe(4);
    // Cats are friends, not pages.
    journal.add('cat', '3');
    expect(journal.points).toBe(4);
    expect(journal.count('cat')).toBe(1);
  });

  it('raises her standing at the thresholds, and each reward is earned there', () => {
    const { journal, events } = make();
    expect(journal.rank.title).toBe(RANKS[0]!.title);
    expect(journal.owns('compass')).toBe(false);
    for (let i = 0; i < 5; i++) journal.add('stamp', STAMPS[i]!.id);
    expect(journal.rank.title).toBe('Courier');
    expect(journal.owns('compass')).toBe(true);
    expect(journal.owns('geta')).toBe(false);
    expect(events.filter((e) => e.startsWith('rank:'))).toEqual(['rank:Courier']);
    expect(journal.nextRank?.at).toBe(12);
  });

  it('every rank can actually be reached', () => {
    const { journal } = make();
    journal.deliveryTotal = CONTRACTS.length;
    for (const rank of RANKS) expect(rank.at).toBeLessThanOrEqual(journal.total);
  });

  it('keeps the best time on a course and the medal it earns', () => {
    const { journal } = make();
    const course = COURSES[0]!;
    expect(journal.medal(course.id)).toBeNull();
    const slow = journal.finishCourse(course.id, course.bronze - 1);
    expect(slow).toEqual({ medal: 'bronze', best: true });
    const fast = journal.finishCourse(course.id, course.gold - 1);
    expect(fast).toEqual({ medal: 'gold', best: true });
    // A slower run afterwards takes nothing away.
    expect(journal.finishCourse(course.id, course.silver).best).toBe(false);
    expect(journal.medal(course.id)).toBe('gold');
    expect(journal.courseBest(course.id)).toBe(course.gold - 1);
    // One point for the medal, whatever its colour and however often.
    expect(journal.points).toBe(1);
  });

  it('gives no medal for a time past bronze, and never fails the player for it', () => {
    const course = COURSES[0]!;
    expect(medalFor(course, course.bronze + 1)).toBeNull();
    expect(course.gold).toBeLessThan(course.silver);
    expect(course.silver).toBeLessThan(course.bronze);
  });

  it('survives a round trip through the save', () => {
    const { journal } = make();
    journal.add('stamp', 'stamp_post');
    journal.add('cat', '2');
    journal.finishCourse(COURSES[0]!.id, 40);
    journal.markIntroSeen();
    const { journal: restored } = make();
    restored.restore(JSON.parse(JSON.stringify(journal.snapshot())), 3);
    expect(restored.has('stamp', 'stamp_post')).toBe(true);
    expect(restored.introSeen).toBe(true);
    expect(restored.points).toBe(journal.points + 3);
    restored.reset();
    expect(restored.points).toBe(0);
    expect(restored.introSeen).toBe(false);
  });
});

describe('activity content', () => {
  it('has no two entries with the same id', () => {
    const ids = [...STAMPS, ...SOUVENIRS, ...POSTCARDS, ...COURSES].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every blank page a hint and every found one a note', () => {
    for (const stamp of STAMPS) {
      expect(stamp.hint.length).toBeGreaterThan(8);
      expect(stamp.note.length).toBeGreaterThan(8);
      expect([...stamp.seal]).toHaveLength(1);
    }
    for (const item of SOUVENIRS) {
      expect(item.hint.length).toBeGreaterThan(8);
      expect(item.note.length).toBeGreaterThan(8);
    }
    for (const card of POSTCARDS) expect(card.brief.length).toBeGreaterThan(8);
  });

  it('gives every resident something to say, lit or dark', () => {
    for (const npc of NPCS) {
      const talk = SMALL_TALK[npc.id];
      expect(talk, npc.id).toBeDefined();
      expect(talk!.dark.length).toBeGreaterThan(0);
      expect(talk!.lit.length).toBeGreaterThan(0);
    }
  });

  it('only photographs residents who exist', () => {
    for (const card of POSTCARDS) {
      if (card.subject.kind === 'resident') {
        expect(NPCS.some((npc) => npc.id === (card.subject as { npc: string }).npc)).toBe(true);
      }
    }
  });

  it('stands everything on dry ground, wherever it was authored', () => {
    PlanetTerrain.setPads([]);
    const places = [...STAMPS.map((s) => s.at), ...SOUVENIRS.map((s) => s.at), ...COURSES.flatMap((c) => [c.start, ...c.gates])];
    for (const at of places) {
      const point = landPoint(at);
      expect(PlanetTerrain.heightAt(point)).toBeGreaterThan(SEA_LEVEL_RADIUS + 0.4);
    }
    // Even a point authored in the middle of the sea comes ashore, if there is shore near.
    const wet = { lat: 0, lon: 0 };
    const moved = landPoint(wet);
    expect(Number.isFinite(moved.length())).toBe(true);
  });

  it('lays a course out as a round that can be run inside its bronze time', () => {
    PlanetTerrain.setPads([]);
    for (const course of COURSES) {
      const points = [landPoint(course.start), ...course.gates.map((g) => landPoint(g))];
      let metres = 0;
      for (let i = 1; i < points.length; i++) metres += points[i]!.distanceTo(points[i - 1]!);
      const flatOut = metres / tuning.move.runSpeed;
      // Gold is hard but possible; bronze forgives a wrong turn or two.
      expect(course.gold).toBeGreaterThan(flatOut * 1.02);
      expect(course.bronze).toBeGreaterThan(flatOut * 1.5);
    }
  });
});

describe('save v3', () => {
  it('gives an old save an empty journal and drops the two dead settings', () => {
    const result = migrate({
      schemaVersion: 2,
      progress: { completedContracts: ['c01_landing'], litDistricts: ['landing'] },
      settings: { masterVolume: 0.3, cameraShake: true, subtitles: false },
    });
    expect(result.save.schemaVersion).toBe(SAVE_VERSION);
    expect(result.save.progress.journal).toEqual(emptyJournal());
    expect(result.save.progress.completedContracts).toEqual(['c01_landing']);
    expect(result.save.settings.masterVolume).toBe(0.3);
    expect('cameraShake' in result.save.settings).toBe(false);
    expect(result.save.settings.alwaysRun).toBe(true);
  });

  it('repairs a damaged journal instead of trusting it', () => {
    const result = migrate({
      schemaVersion: SAVE_VERSION,
      progress: { journal: { stamps: ['a', 4, null], courseBest: { x: 'fast', y: 31.5 }, introSeen: 'yes' } },
    });
    expect(result.save.progress.journal.stamps).toEqual(['a']);
    expect(result.save.progress.journal.courseBest).toEqual({ y: 31.5 });
    expect(result.save.progress.journal.introSeen).toBe(false);
  });
});

describe('view culling of instanced props', () => {
  function ring(): THREE.InstancedMesh {
    // Eight detailed props in a ring a few metres round the north pole.
    const geometry = new THREE.SphereGeometry(0.5, 24, 16);
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 8);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const p = new THREE.Vector3(Math.cos(a) * 30, 60, Math.sin(a) * 30).setLength(60.5);
      mesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
    }
    return mesh;
  }
  const frustumFrom = (camera: THREE.PerspectiveCamera): THREE.Frustum => {
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    return new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
  };

  it('draws only what the camera can see, of what is over the horizon', () => {
    const mesh = ring();
    const culler = new HorizonInstances(40);
    culler.add(mesh);
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
    camera.position.set(0, 75, 0);
    camera.lookAt(new THREE.Vector3(30, 60, 0).setLength(60.5));

    culler.update(camera.position);
    const overHorizon = mesh.count;
    expect(overHorizon).toBe(8);

    culler.update(camera.position, { frustum: frustumFrom(camera), centre: new THREE.Vector3(0, -500, 0), keepWithin: 0 });
    expect(mesh.count).toBeGreaterThan(0);
    expect(mesh.count).toBeLessThan(overHorizon);
  });

  it('keeps what stands near the player whichever way the camera looks', () => {
    const mesh = ring();
    const culler = new HorizonInstances(40);
    culler.add(mesh);
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
    camera.position.set(0, 75, 0);
    camera.lookAt(0, 500, 0); // straight up: nothing on the planet is in view
    const frustum = frustumFrom(camera);

    culler.update(camera.position, { frustum, centre: new THREE.Vector3(0, -500, 0), keepWithin: 0 });
    expect(mesh.count).toBe(0);
    // ...but anything within shadow range of the player must still be drawn.
    culler.update(camera.position, { frustum, centre: new THREE.Vector3(0, 60, 0), keepWithin: 40 });
    expect(mesh.count).toBe(8);
  });

  it('does not bother culling something cheaper to draw than to test', () => {
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial(), 2);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 60.5, 0));
    mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(3, 60.4, 0));
    const culler = new HorizonInstances(40);
    culler.add(mesh);
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
    camera.position.set(0, 62, 0);
    camera.lookAt(0, 500, 0);
    culler.update(camera.position, { frustum: frustumFrom(camera), centre: new THREE.Vector3(0, -500, 0), keepWithin: 0 });
    expect(mesh.count).toBe(2);
  });
});

describe('the body is drawn between steps', () => {
  /** A flat-topped planet patch at the north pole and a controller walking +X on it. */
  function walker(): { player: Entity; controller: SphericalCharacterController } {
    const ground = new THREE.Mesh(new THREE.BoxGeometry(200, 2, 200));
    ground.position.y = 59;
    ground.updateMatrixWorld(true);
    ground.geometry.applyMatrix4(ground.matrixWorld);
    ground.position.set(0, 0, 0);
    ground.updateMatrixWorld(true);
    const world = new BvhWorld();
    world.build(ground);

    const input = {
      getAxis2D: () => ({ x: 0, y: 1 }),
      isDown: (action: string) => action === 'run',
      wasPressedWithin: () => false,
      consume: () => {},
    } as unknown as InputManager;
    const player = new Entity('player', new THREE.Group());
    player.object3D.position.set(0, 60, 0);
    const controller = player.addComponent(
      new SphericalCharacterController({
        world,
        input,
        bus: { emit: () => {} } as unknown as EventBus,
        camera: new THREE.PerspectiveCamera(),
        heading: (out) => out.set(1, 0, 0),
      }),
    );
    return { player, controller };
  }

  it('moves the drawn body evenly when frames and steps do not line up', () => {
    const { player, controller } = walker();
    for (let i = 0; i < 90; i++) controller.fixedUpdate(1 / 60);

    // A 50 fps display over a 60 Hz simulation: one step most frames, two now
    // and then. Drawn raw, the body advanced 7.7 cm or 15.3 cm a frame.
    const frame = 1 / 50;
    let accumulator = 0;
    let last = player.object3D.position.x;
    const advances: number[] = [];
    for (let f = 0; f < 60; f++) {
      accumulator += frame;
      while (accumulator >= 1 / 60) {
        controller.fixedUpdate(1 / 60);
        accumulator -= 1 / 60;
      }
      controller.interpolate(accumulator / (1 / 60));
      advances.push(player.object3D.position.x - last);
      last = player.object3D.position.x;
    }
    const expected = tuning.move.runSpeed * frame;
    // The first sample starts from an un-interpolated pose; every one after it is even.
    for (const advance of advances.slice(1)) expect(Math.abs(advance - expected)).toBeLessThan(0.004);
    // And the camera follows exactly the point that is drawn.
    expect(controller.smoothedPosition.distanceTo(player.object3D.position)).toBe(0);
  });

  it('believes a teleport, and does not glide across it', () => {
    const { player, controller } = walker();
    for (let i = 0; i < 30; i++) controller.fixedUpdate(1 / 60);
    controller.teleport(new THREE.Vector3(20, 60, 0).setLength(60.05), new THREE.Vector3(0, 0, 1));
    controller.interpolate(0.5);
    expect(player.object3D.position.x).toBeGreaterThan(18.5);
    expect(controller.velocity.length()).toBe(0);
    // A tool that moves the object directly is believed as well.
    player.object3D.position.set(0, 60.05, 10);
    controller.interpolate(0.3);
    expect(player.object3D.position.z).toBeCloseTo(10, 6);
    expect(controller.simulatedPosition.z).toBeCloseTo(10, 6);
  });

  it('makes a tap a hop and a held press a jump', () => {
    const height = (hold: boolean): number => {
      const { player, controller } = walker();
      let frames = 0;
      (controller as unknown as { deps: { input: Record<string, unknown> } }).deps.input = {
        getAxis2D: () => ({ x: 0, y: 0 }),
        isDown: (action: string) => action === 'jump' && hold,
        wasPressedWithin: () => frames === 30,
        consume: () => {},
      };
      let top = 0;
      for (frames = 0; frames < 120; frames++) {
        controller.fixedUpdate(1 / 60);
        top = Math.max(top, player.object3D.position.length() - 60);
      }
      return top;
    };
    const held = height(true);
    const tapped = height(false);
    expect(held).toBeGreaterThan(1.0);
    expect(tapped).toBeLessThan(held * 0.6);
    expect(tapped).toBeGreaterThan(0.15);
  });
});

describe('input', () => {
  const make = (): RealInput =>
    new RealInput({} as unknown as HTMLElement, { emit: () => undefined } as unknown as EventBus);
  const press = (input: RealInput, code: string): void =>
    (input as unknown as { onKeyDown: (e: Partial<KeyboardEvent>) => void }).onKeyDown({ code, repeat: false, preventDefault: () => {} });

  it('runs by default on a keyboard when asked to, and Shift then walks', () => {
    const input = make();
    expect(input.isDown('run')).toBe(false);
    input.setAlwaysRun(true);
    expect(input.isDown('run')).toBe(true);
    press(input, 'ShiftLeft');
    expect(input.isDown('run')).toBe(false);
  });

  it('still remembers a press after one very slow frame', () => {
    // At five frames a second a frame is longer than the whole jump buffer.
    const input = make();
    press(input, 'Space');
    input.beginFrame(0.2);
    expect(input.wasPressedWithin('jump', tuning.move.jumpBuffer)).toBe(true);
    // ...and forgets it after the next, as it should.
    input.beginFrame(0.2);
    expect(input.wasPressedWithin('jump', tuning.move.jumpBuffer)).toBe(false);
  });

  it('opens the journal on Tab and raises the camera on C', () => {
    const input = make();
    press(input, 'Tab');
    press(input, 'KeyC');
    expect(input.wasPressed('journal')).toBe(true);
    expect(input.wasPressed('camera')).toBe(true);
  });
});
