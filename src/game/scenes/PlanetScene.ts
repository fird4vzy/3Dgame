import * as THREE from 'three';
import { World } from '@engine/entity/World';
import { Entity } from '@engine/entity/Entity';
import { BvhWorld } from '@engine/physics/BvhWorld';
import type { InputManager } from '@engine/input/InputManager';
import type { EventBus } from '@core/events/EventBus';
import type { RendererService } from '@engine/render/RendererService';
import type { MusicDirector } from '@engine/audio/MusicDirector';
import type { IScene } from '@engine/scene/IScene';
import type { LoadedCharacter } from '@engine/character/CharacterFactory';
import { shouldBeVisible, horizonDistance } from '@core/math/spherical';
import { PLANET_RADIUS, PLAYER_HEIGHT } from '@config/constants';

import { PlanetTerrain } from '@game/world/PlanetTerrain';
import { DistrictRegistry } from '@game/world/DistrictRegistry';
import { surfacePoint, surfaceQuaternion, scatterAround } from '@game/world/placement';
import { SphericalCharacterController } from '@game/components/SphericalCharacterController';
import { GlideComponent } from '@game/components/GlideComponent';
import { FollowRig } from '@game/camera/FollowRig';
import { createPlaceholderCharacter } from '@game/entities/PlaceholderCharacter';
import {
  createLamp,
  createParcel,
  createShard,
  createVillager,
  createInteractionRing,
} from '@game/entities/props';

import { InteractionSystem } from '@game/systems/InteractionSystem';
import { WarmthSystem } from '@game/systems/WarmthSystem';
import { QuestSystem } from '@game/systems/QuestSystem';
import { DialogueSystem } from '@game/systems/DialogueSystem';
import { IlluminationSystem } from '@game/systems/IlluminationSystem';
import { DeliverySystem } from '@game/systems/DeliverySystem';
import { ShardSystem } from '@game/systems/ShardSystem';
import { ParticleSystem } from '@engine/vfx/ParticleSystem';
import { buildDistrictProps, buildLighthouse } from '@game/entities/districtProps';
import { buildGroundCover } from '@game/entities/groundCover';
import { Skydome, createStarfield } from '@game/world/Skydome';
import type { MinimapMarker } from '@game/world/mapMarkers';
import { buildCourier, type RenRig } from '@game/entities/CourierCharacter';
import { VILLAGER_SPECS } from '@game/entities/characterSpec';
import { Fireflies } from '@game/world/Fireflies';

import { DISTRICTS, NPCS, npcById, type DistrictId, type ParcelWeight } from '../../data/content';

const _forward = new THREE.Vector3();
const _sunUp = new THREE.Vector3();
const _sunTangent = new THREE.Vector3();
const _sunDir = new THREE.Vector3();
const _charFacing = new THREE.Vector3();
const _characterUp = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _tint = new THREE.Color();
const DUSK_TINT = new THREE.Color('#7f8aa8');
const LIT_TINT = new THREE.Color('#ffffff');
const _emitUp = new THREE.Vector3();
const _emitPos = new THREE.Vector3();
const DUST_COLOUR = new THREE.Color('#b9ae94');
/** Matches the shard mesh's emissive, so the burst reads as the shard itself. */
const SHARD_COLOUR = new THREE.Color('#f6bd60');
const _skyUp = new THREE.Vector3();
const _fillRight = new THREE.Vector3();
const _lightAnchor = new THREE.Vector3();

export interface PlanetSceneCallbacks {
  onDistrictChanged?(id: DistrictId, displayName: string): void;
}

/**
 * The playable scene: planet, districts, cast, and the full delivery loop.
 *
 * This is the composition point for gameplay — it owns the systems and wires
 * them together, but contains as little rule logic as possible itself. Adding a
 * sixth district or contract means editing `data/content.ts`, not this file.
 */
export class PlanetScene implements IScene {
  readonly id = 'planet';
  readonly assetBundles: readonly string[] = [];

  readonly world = new World();
  readonly terrain = new PlanetTerrain();
  readonly collision = new BvhWorld();
  readonly districts = new DistrictRegistry();

  player!: Entity;
  controller!: SphericalCharacterController;
  glide!: GlideComponent;
  rig!: FollowRig;

  readonly interaction: InteractionSystem;
  readonly warmth: WarmthSystem;
  readonly quests: QuestSystem;
  readonly dialogue: DialogueSystem;
  readonly shards: ShardSystem;
  readonly particles = new ParticleSystem(420);
  illumination!: IlluminationSystem;
  delivery!: DeliverySystem;

  private character: LoadedCharacter | null = null;
  private paused = false;
  private playerLocked = false;

  private readonly cullables: THREE.Object3D[] = [];
  private readonly npcObjects = new Map<string, THREE.Object3D>();
  private readonly thermals: THREE.Vector3[] = [];
  private readonly cameraOccluders: THREE.Object3D[] = [];
  private sun!: THREE.DirectionalLight;
  private ambient!: THREE.HemisphereLight;
  /** Short-range lights that follow the player, so she reads in the dark. */
  private characterFill!: THREE.PointLight;
  private characterRim!: THREE.PointLight;
  private lighthouse: { lamp: THREE.Mesh; light: THREE.PointLight } | null = null;
  private stars: THREE.Points | null = null;
  private skyLevel = -1;
  private skydome!: Skydome;
  /** Resident rigs, for the idle sway. */
  private readonly villagerRigs: Array<{ rig: RenRig; phase: number }> = [];
  private villagerSway = 0;
  private fireflies!: Fireflies;
  private readonly firefliesColour = new THREE.Color();

  private parcelVisual: { group: THREE.Group; glow: THREE.PointLight; core: THREE.Mesh } | null =
    null;
  private carriedWeight: ParcelWeight = 'light';
  /** Whatever the parcel was parented to — a hand socket, or the body. */
  private parcelParent: THREE.Object3D | null = null;
  private currentDistrict: DistrictId | null = null;
  private bobTimer = 0;
  private lastDelta = 1 / 60;
  private menuMode = false;
  private menuOrbit = 0;

  constructor(
    private readonly renderer: RendererService,
    private readonly input: InputManager,
    private readonly bus: EventBus,
    private readonly music: MusicDirector | null = null,
    private readonly callbacks: PlanetSceneCallbacks = {},
  ) {
    this.interaction = new InteractionSystem(bus);
    this.warmth = new WarmthSystem(bus);
    this.quests = new QuestSystem(bus);
    this.dialogue = new DialogueSystem(bus);
    this.shards = new ShardSystem(bus);
  }

  async onEnter(): Promise<void> {
    this.bus.emit('scene:willEnter', { id: this.id });

    this.buildEnvironment();
    this.buildLighting();
    this.buildPlayer();
    this.buildDistricts();
    this.buildCast();
    this.buildShardsAndThermals();

    this.illumination = new IlluminationSystem(
      this.bus,
      this.districts,
      this.music,
      this.ambient,
    );
    this.registerDistrictLamps();

    this.delivery = new DeliverySystem(
      this.bus,
      this.quests,
      this.dialogue,
      this.warmth,
      this.illumination,
      {
        attachParcel: (id, colour, weight) => this.attachParcel(id, colour, weight),
        detachParcel: () => this.detachParcel(),
        celebrate: () => this.celebrate(),
        setPlayerLocked: (locked) => this.setPlayerLocked(locked),
      },
    );

    // Ignition throws motes up from each lamp as it catches.
    this.bus.on('district:igniting', ({ district }) => {
      this.burstDistrict(district as DistrictId);
    });

    this.rig.addOccluders(this.cameraOccluders);

    this.quests.reevaluate();
    this.bus.emit('scene:entered', { id: this.id });
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.input.setEnabled(!paused && !this.playerLocked);
  }

  /** Freeze the player during conversations without pausing the world. */
  setPlayerLocked(locked: boolean): void {
    this.playerLocked = locked;
    this.input.setEnabled(!locked && !this.paused);
  }

  /**
   * Re-apply saved progress.
   *
   * Runs after `onEnter`, and restores *silently*: districts snap to lit with
   * no ignition animation and no `delivery:completed` events are replayed. A
   * returning player should find the world as they left it, not sit through
   * five cutscenes.
   */
  restoreProgress(progress: {
    completedContracts: readonly string[];
    litDistricts: readonly string[];
    collectedShards: readonly string[];
  }): void {
    this.quests.restore(progress.completedContracts);
    this.illumination.restore(progress.litDistricts);
    this.shards.restore(progress.collectedShards);
    this.refreshNpcPrompts();
  }

  /**
   * Wipe the world back to its opening state for a fresh run.
   *
   * Reloading the page would be simpler and is tempting, but it lands the
   * player back on the menu instead of in the run they just asked for. Each
   * system owns a reset symmetrical with its restore, so this is cheap.
   */
  resetRun(): void {
    this.quests.reset();
    this.illumination.reset();
    this.shards.reset();
    this.warmth.clear();
    this.detachParcel();
    this.particles.clear();
    this.refreshNpcPrompts();

    const odd = npcById('odd');
    if (odd) {
      const spawn = surfacePoint({ lat: odd.at.lat - 2.2, lon: odd.at.lon + 1.4 }, 0.2);
      this.player.object3D.position.copy(spawn);
      this.controller.velocity.set(0, 0, 0);
      _forward.set(0, 1, 0).projectOnPlane(spawn.clone().normalize());
      if (_forward.lengthSq() < 1e-6) _forward.set(1, 0, 0);
      this.rig.reset(spawn, _forward.normalize());
    }
  }

  /**
   * Menu mode: the player is frozen and the camera drifts slowly around the
   * planet, so the main menu has a live backdrop rather than a still image.
   * The world is already loaded, so this costs nothing but a camera path.
   */
  setMenuMode(active: boolean): void {
    this.menuMode = active;
    this.input.setEnabled(!active && !this.paused && !this.playerLocked);

    // The shadow frustum is sized tightly around the player for gameplay. From
    // the menu's orbital camera that box is visible as a hard rectangular seam
    // across the planet, so shadows come off entirely while in orbit.
    if (this.sun) this.sun.castShadow = !active && this.renderer.renderer.shadowMap.enabled;
    if (!active) {
      this.player.object3D.getWorldDirection(_forward);
      this.rig.reset(this.controller.smoothedPosition, _forward);
    }
  }

  get isMenuMode(): boolean {
    return this.menuMode;
  }

  /** Which district the player is standing in right now. */
  get currentDistrictId(): DistrictId {
    return this.districts.at(this.player.object3D.position).def.id;
  }

  /**
   * Swap in a character model.
   *
   * `modelHeight` scales it to the gameplay height. An authored model is
   * whatever height its author made it — a VRoid export is typically well over
   * 1.6 m — and the collision capsule, camera arm and interaction radii are all
   * tuned against a fixed figure, so the model is fitted to the game rather
   * than the game re-tuned around the model.
   */
  setCharacter(character: LoadedCharacter, modelHeight?: number): void {
    this.character?.dispose();
    this.character = character;
    for (const child of [...this.player.object3D.children]) {
      if (child !== this.parcelVisual?.group) this.player.object3D.remove(child);
    }

    if (modelHeight && modelHeight > 0.1) {
      const scale = PLAYER_HEIGHT / modelHeight;
      // Only rescale when it actually matters. VRM springbone physics is
      // simulated in world space and misbehaves under a scaled ancestor — the
      // hair fans out into spikes — and a model within ~12% of the target is
      // close enough that correcting it costs far more than it buys.
      if (Math.abs(1 - scale) > 0.12) character.object3D.scale.setScalar(scale);
    }

    this.player.object3D.add(character.object3D);
    character.play('idle');
  }

  fixedUpdate(dt: number): void {
    if (this.paused || this.menuMode) return;
    this.world.fixedUpdate(dt);
    this.warmth.tick(dt);

    if (!this.playerLocked) {
      this.player.object3D.getWorldDirection(_forward);
      this.interaction.update(this.player.object3D.position, _forward);

      if (this.input.wasPressed('interact')) {
        this.input.consume('interact');
        this.interaction.activate();
      }
    }
  }

  update(dt: number): void {
    if (this.paused) return;
    this.lastDelta = dt;
    this.world.update(dt);
    this.updateSun();
    this.illumination.update(dt);
    this.shards.update(dt, this.player.object3D.position);
    this.syncCharacterAnimation(dt);
    this.updateCharacterTint();
    this.updateVillagers(dt);
    this.updateFireflies(dt);
    this.updateParcelVisual(dt);
    this.updateLighthouse();
    this.updateSky();
    this.particles.update(dt, this.renderer.camera);
    this.trackDistrict();
  }

  interpolate(alpha: number): void {
    if (this.paused) return;
    this.controller.interpolate(alpha);
  }

  lateUpdate(dt: number): void {
    if (this.paused) return;
    this.world.lateUpdate(dt);

    if (this.menuMode) this.updateMenuCamera(dt);
    else this.rig.update(dt, this.controller.smoothedPosition);
    this.cullBelowHorizon();

    if (this.character) {
      this.player.object3D.getWorldDirection(_charFacing);
      this.character.lateUpdate(this.renderer.camera, _charFacing);
    }
  }

  render(): void {
    this.renderer.render(this.world.scene, this.lastDelta);
  }

  dispose(): void {
    this.skydome.dispose();
    this.fireflies.dispose();
    this.particles.dispose();
    this.character?.dispose();
    this.interaction.clear();
    this.shards.clear();
    this.warmth.clear();
    this.collision.dispose();
    this.terrain.dispose();
    this.world.dispose();
  }

  // ── queries used by the HUD ─────────────────────────────────────────────

  /** Where the compass should point: the giver, then the recipient. */
  get objectiveTarget(): { position: THREE.Vector3; hint: string } | null {
    const active = this.quests.active;
    if (active) {
      const object = this.npcObjects.get(active.def.recipient);
      if (object) return { position: object.position, hint: active.def.hint };
    }
    const next = this.quests.nextAvailable;
    if (next) {
      const object = this.npcObjects.get(next.def.giver);
      if (object) {
        return { position: object.position, hint: 'The postmaster has work for you.' };
      }
    }
    return null;
  }

  /**
   * Everything worth showing on the minimap.
   *
   * Rebuilt on demand rather than cached: it is a handful of entries, the scene
   * is the only thing that knows what exists, and a cache would be one more
   * thing to invalidate when a shard is collected or a contract advances.
   */
  get minimapMarkers(): MinimapMarker[] {
    const markers: MinimapMarker[] = [];

    const objective = this.objectiveTarget;
    if (objective) markers.push({ position: objective.position, kind: 'objective' });

    for (const [id, object] of this.npcObjects) {
      // The objective already has its own, brighter marker.
      if (objective && object.position.equals(objective.position)) continue;
      markers.push({ position: object.position, kind: 'npc', label: id });
    }

    for (const shard of this.shards.uncollectedPositions()) {
      markers.push({ position: shard, kind: 'shard' });
    }

    return markers;
  }

  /** 0–1 across the whole planet, for the minimap rim and the sky. */
  get illuminationFraction(): number {
    const total = this.districts.all.reduce((sum, d) => sum + d.light, 0);
    return total / Math.max(1, this.districts.all.length);
  }

  get cameraForward(): THREE.Vector3 {
    return this.renderer.camera.getWorldDirection(_camForward);
  }

  // ── construction ────────────────────────────────────────────────────────

  private buildEnvironment(): void {
    const scene = this.world.scene;
    // No flat clear colour: the dome's gradient follows the player's local up,
    // which a fixed background cannot do on a planet you can walk right around.
    // Fog range is set from the planet, not picked by eye.
    //
    // This was `Fog(40, 190)` — numbers that belong to a flat world. On a
    // 60 m sphere the horizon from eye height is `sqrt(2Rh)` ≈ 13.9 m, so
    // *nothing in view was ever far enough away to be fogged at all* and the
    // terrain cut against the sky at a razor edge with no depth whatsoever.
    // That single mismatch is most of why the world looked flat.
    //
    // Deriving it from `horizonDistance` also means it stays correct if the
    // planet is ever resized.
    const horizon = horizonDistance(PLANET_RADIUS, PLAYER_HEIGHT);
    scene.fog = new THREE.Fog('#1b2033', horizon * 1.1, horizon * 5.5);

    this.skydome = new Skydome();
    scene.add(this.skydome.mesh);

    this.fireflies = new Fireflies();
    scene.add(this.fireflies.mesh);

    scene.add(this.terrain.mesh);
    scene.add(this.terrain.water);
    this.collision.build(this.terrain.mesh);
    this.addStars(scene);
    scene.add(this.particles.mesh);
  }

  private buildLighting(): void {
    const scene = this.world.scene;

    // Dusk, but legible: the planet is dim, not black. Characters still have
    // to be readable before their district is lit.
    this.ambient = new THREE.HemisphereLight(0x8894b4, 0x242a3a, 0.95);
    scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xffd9a0, 1.5);
    this.sun.castShadow = this.renderer.renderer.shadowMap.enabled;
    if (this.sun.castShadow) {
      this.sun.shadow.mapSize.set(1024, 1024);
      const cam = this.sun.shadow.camera;
      cam.near = 1;
      cam.far = 160;
      cam.left = cam.bottom = -25;
      cam.right = cam.top = 25;
      cam.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.06;
    }
    // A key light that belongs to the character, not to the world.
    //
    // The premise puts the player in an unlit district for the whole opening,
    // and the honest consequence was that she rendered as a black silhouette
    // with two pale arms — a dark-haired figure in dark clothes under a
    // hemisphere light is simply not readable. Raising the ambient instead
    // would have flattened the entire planet and thrown away the "light is
    // returning" hook, so this is local: a short-range, cool fill that rides
    // above and behind the camera and reaches almost nothing else.
    //
    // Every third-person game does this. It is not cheating; it is the reason
    // you can see the protagonist at night.
    this.characterFill = new THREE.PointLight(0xa8bce8, 2.1, 4.5, 2);
    scene.add(this.characterFill);

    // ...and a warm rim from the opposite side, which is what separates her
    // from the background rather than merely brightening her.
    this.characterRim = new THREE.PointLight(0xffd2a0, 1.3, 4.0, 2);
    scene.add(this.characterRim);

    scene.add(this.sun, this.sun.target);
  }

  private buildPlayer(): void {
    // Spawn beside the postmaster, so the first thing on screen is the hook.
    const odd = npcById('odd');
    const spawn = odd
      ? surfacePoint({ lat: odd.at.lat - 2.2, lon: odd.at.lon + 1.4 }, 0.2)
      : PlanetTerrain.findSpawn();

    this.player = new Entity('player', new THREE.Group());
    this.player.object3D.add(createPlaceholderCharacter());
    this.player.tags.add('player');
    this.player.object3D.position.copy(spawn);

    this.controller = this.player.addComponent(
      new SphericalCharacterController({
        world: this.collision,
        input: this.input,
        bus: this.bus,
        camera: this.renderer.camera,
        // The rig is created just below; the closure defers the lookup so the
        // controller always reads the current, stable tangent heading.
        heading: (out) => (this.rig ? this.rig.getHeading(out) : out.set(0, 0, 1)),
      }),
    );

    this.glide = this.player.addComponent(
      new GlideComponent({
        controller: this.controller,
        input: this.input,
        bus: this.bus,
        world: this.collision,
        thermals: this.thermals,
        // Heavy parcels ground you — the contract data says which are heavy.
        canGlide: () => this.carriedWeight !== 'heavy',
      }),
    );

    this.world.add(this.player);

    this.rig = new FollowRig(this.renderer.camera, this.input, this.collision);
    const up = spawn.clone().normalize();
    _forward.set(0, 1, 0).projectOnPlane(up);
    if (_forward.lengthSq() < 1e-6) _forward.set(1, 0, 0).projectOnPlane(up);
    this.rig.reset(spawn, _forward.normalize());

    this.bus.emit('player:spawned', { entityId: this.player.id });
  }

  private buildDistricts(): void {
    for (const def of DISTRICTS) {
      const centre = this.districts.centreOf(def.id);
      const positions = scatterAround(centre, def.lampCount, def.radius * 0.55, def.id.length * 977);

      const lights: THREE.PointLight[] = [];
      const bulbs: THREE.Mesh[] = [];
      const delays: number[] = [];

      positions.forEach((position, index) => {
        const { group, light, bulb } = createLamp();
        group.position.copy(position);
        group.quaternion.copy(surfaceQuaternion(position));
        this.world.scene.add(group);
        this.cullables.push(group);

        lights.push(light);
        bulbs.push(bulb);
        // Stagger so lamps catch one after another rather than in unison.
        delays.push(Math.min(0.6, index * 0.04));
      });

      this.lampGroups.set(def.id, { district: def.id, lights, bulbs, delays });

      // District silhouettes — the landmarks the player navigates by, since the
      // horizon is only 13.5 m away and there is no map screen.
      const propSpots = scatterAround(
        centre,
        def.id === 'spire' ? 10 : 16,
        def.radius * 0.7,
        def.id.length * 613 + 7,
      );
      for (const mesh of buildDistrictProps(def.id, propSpots, def.id.length * 331)) {
        this.world.scene.add(mesh);
        // Scenery has to block the camera, or it parks inside a rock.
        this.cameraOccluders.push(mesh);
      }

      // Ground cover: flowers, grass, mushrooms, pebbles. The world had trees
      // and lamps and bare ground between them, which reads as empty however
      // good the sky is. Dense on purpose — it is instanced, unshadowed, and
      // costs nothing per frame.
      // A district covers roughly 4,000 m² of surface, so a couple of hundred
      // plants is one every twenty metres — invisible. This is the density that
      // actually reads as ground cover when you are standing in it.
      const coverSpots = scatterAround(
        centre,
        1000,
        def.radius * 0.8,
        def.id.length * 1231 + 3,
      );
      for (const mesh of buildGroundCover(def.id, coverSpots, def.id.length * 787)) {
        this.world.scene.add(mesh);
      }
    }

    // The Spire's lighthouse: tall enough to crest the horizon from outside its
    // own district, which is what makes the final delivery navigable.
    const spireCentre = this.districts.centreOf('spire');
    const spirePoint = surfacePoint(
      { lat: DISTRICTS[4]!.centre.lat, lon: DISTRICTS[4]!.centre.lon },
      0,
    );
    const { group, lamp, light } = buildLighthouse();
    group.position.copy(spirePoint);
    group.quaternion.copy(surfaceQuaternion(spirePoint));
    this.world.scene.add(group);
    this.lighthouse = { lamp, light };
    void spireCentre;
  }

  private readonly lampGroups = new Map<
    DistrictId,
    { district: DistrictId; lights: THREE.PointLight[]; bulbs: THREE.Mesh[]; delays: number[] }
  >();

  private registerDistrictLamps(): void {
    for (const lamps of this.lampGroups.values()) this.illumination.registerLamps(lamps);
  }

  private buildCast(): void {
    for (const npc of NPCS) {
      const position = surfacePoint(npc.at, 0.05);

      // Residents are built from the same rig as the player. They were capsules
      // with a cone for a nose, which made "the people" the least convincing
      // thing in a game entirely about visiting people.
      const spec = VILLAGER_SPECS[npc.id];
      const body = new THREE.Group();
      body.name = 'villager';
      if (spec) {
        const rig = buildCourier(spec);
        rig.root.position.y = 0;
        body.add(rig.root);
        // A slow idle sway, seeded per person so they are not synchronised.
        this.villagerRigs.push({ rig, phase: Math.random() * Math.PI * 2 });
      } else {
        body.add(createVillager(npc.colour));
      }

      body.position.copy(position);
      body.quaternion.copy(surfaceQuaternion(position, Math.PI));

      const ring = createInteractionRing();
      body.add(ring);

      this.world.scene.add(body);
      this.cullables.push(body);
      this.npcObjects.set(npc.id, body);

      this.interaction.register({
        id: `npc_${npc.id}`,
        position,
        radius: 2.4,
        prompt: 'Talk',
        enabled: true,
        onInteract: () => void this.delivery.interactWith(npc.id),
      });
    }

    // Only NPCs with something to say show a prompt, refreshed as the quest
    // graph advances.
    const refresh = () => this.refreshNpcPrompts();
    this.bus.on('contract:accepted', refresh);
    this.bus.on('delivery:completed', refresh);
    this.bus.on('contract:available', refresh);
    this.refreshNpcPrompts();

    this.bus.on('player:footstep', ({ position }) => {
      _emitPos.set(position.x, position.y, position.z);
      _emitUp.copy(_emitPos).normalize();
      this.particles.emit({
        position: _emitPos,
        count: 2,
        colour: DUST_COLOUR,
        speed: [0.3, 0.9],
        life: [0.25, 0.5],
        size: [0.05, 0.1],
        direction: _emitUp,
        spread: 0.9,
        drag: 2.2,
      });
    });

    // A shard vanishing on its own is a state change with no moment attached.
    // The burst is what makes the pickup land as an event.
    this.bus.on('shard:collected', ({ position }) => {
      _emitPos.set(position.x, position.y, position.z);
      _emitUp.copy(_emitPos).normalize();
      this.particles.emit({
        position: _emitPos,
        count: 18,
        colour: SHARD_COLOUR,
        speed: [1.2, 3.0],
        life: [0.5, 1.1],
        size: [0.06, 0.13],
        direction: _emitUp,
        spread: 1.0,
        gravity: _emitUp.clone().multiplyScalar(-2.2),
        drag: 1.4,
      });
    });

    this.bus.on('player:landed', ({ impactSpeed }) => {
      if (impactSpeed < 4) return;
      const position = this.player.object3D.position.clone();
      _emitUp.copy(position).normalize();
      this.particles.emit({
        position,
        count: Math.min(16, Math.round(impactSpeed)),
        colour: DUST_COLOUR,
        speed: [0.8, 2.2],
        life: [0.3, 0.7],
        size: [0.06, 0.13],
        direction: _emitUp,
        spread: 1,
        drag: 2.6,
      });
    });
  }

  private refreshNpcPrompts(): void {
    for (const npc of NPCS) {
      const role = this.delivery?.roleFor(npc.id) ?? null;
      const object = this.npcObjects.get(npc.id);
      const ring = object?.children.find((c) => c.type === 'Mesh' && c !== object.children[0]);

      this.interaction.setEnabled(`npc_${npc.id}`, role !== null);
      if (ring) ring.visible = role !== null;
    }
  }

  private buildShardsAndThermals(): void {
    let index = 0;
    for (const def of DISTRICTS) {
      const centre = this.districts.centreOf(def.id);

      for (const position of scatterAround(centre, 5, def.radius * 0.8, 5501 + index)) {
        const shard = createShard();
        // Lift them so some need a glide or a climb to reach.
        shard.position.copy(position).addScaledVector(position.clone().normalize(), 0.9);
        this.world.scene.add(shard);
        this.cullables.push(shard);
        this.shards.add(`shard_${index}_${def.id}`, shard);
        index++;
      }

      // One thermal per district, ringing the planet.
      const thermal = centre.clone().addScaledVector(centre.clone().normalize(), 3);
      this.thermals.push(thermal);
    }
  }

  // ── parcel handling ─────────────────────────────────────────────────────

  private attachParcel(_id: string, colour: string, weight: ParcelWeight): void {
    this.detachParcel();
    this.carriedWeight = weight;

    const parcel = createParcel(colour);

    // Parent to the character's hand if it has one, so the lumen travels with
    // the arm as it swings instead of floating alongside the body. Characters
    // without a skeleton (a sprite) return null, and it falls back to a fixed
    // offset — which is exactly what the socket contract is for.
    const hand = this.character?.getSocket('hand_R') ?? null;
    if (hand) {
      parcel.group.position.set(0, 0, 0);
      hand.add(parcel.group);
      this.parcelParent = hand;
    } else {
      parcel.group.position.set(0.34, 1.0, 0.16);
      this.player.object3D.add(parcel.group);
      this.parcelParent = this.player.object3D;
    }

    this.parcelVisual = parcel;
  }

  private detachParcel(): void {
    if (!this.parcelVisual) return;
    (this.parcelParent ?? this.player.object3D).remove(this.parcelVisual.group);
    this.parcelParent = null;
    this.parcelVisual.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material as THREE.Material | undefined;
      material?.dispose?.();
    });
    this.parcelVisual = null;
    this.carriedWeight = 'light';
  }

  /** Bob the carried parcel and tint it by warmth. */
  private updateParcelVisual(dt: number): void {
    if (!this.parcelVisual) return;
    this.bobTimer += dt;

    const active = this.quests.active;
    const warmth = active ? this.warmth.warmthOf(active.def.id) : 1;

    // When held in a socket the arm supplies the motion, so the parcel only
    // needs its own slow spin and a hint of float.
    const inHand = this.parcelParent !== null && this.parcelParent !== this.player.object3D;
    this.parcelVisual.group.position.y = inHand
      ? Math.sin(this.bobTimer * 1.6 * Math.PI * 2) * 0.012
      : 1.0 + Math.sin(this.bobTimer * 1.6 * Math.PI * 2) * 0.02;
    this.parcelVisual.group.rotation.y += dt * 0.8;

    const colour = new THREE.Color('#69a5d8').lerp(new THREE.Color('#f6bd60'), warmth);
    const material = this.parcelVisual.core.material as THREE.MeshStandardMaterial;
    material.emissive.copy(colour);
    material.color.copy(colour);
    this.parcelVisual.glow.color.copy(colour);
    this.parcelVisual.glow.intensity = 1.1 + warmth * 1.1;
  }

  /** The hand-off burst: lumen motes rising off the parcel as it changes hands. */
  private celebrate(): void {
    const position = this.player.object3D.position.clone();
    _emitUp.copy(position).normalize();
    position.addScaledVector(_emitUp, 1.1);

    this.particles.emit({
      position,
      count: 34,
      colour: new THREE.Color('#f6bd60'),
      speed: [1.4, 3.6],
      life: [0.7, 1.5],
      size: [0.07, 0.16],
      direction: _emitUp,
      spread: 0.85,
      // Gentle downward pull so the motes arc rather than escaping.
      gravity: _emitUp.clone().multiplyScalar(-2.2),
      drag: 0.5,
    });
  }

  /**
   * The sky warms as the planet comes back.
   *
   * Background, fog and star brightness all track total illumination, so the
   * change is visible even when you are standing in a district that is still
   * dark — the whole world is coming back, not just the block you are on.
   */
  private updateSky(): void {
    const total = this.districts.all.reduce((sum, d) => sum + d.light, 0);
    const fraction = total / Math.max(1, this.districts.all.length);

    // The gradient axis is the player's local up — walk far enough and world +Y
    // stops meaning "overhead". This has to run every frame because the player
    // moves; the palette work below only runs when illumination changes.
    _skyUp.copy(this.controller.smoothedPosition).normalize();
    this.skydome.update(_skyUp, fraction);

    if (Math.abs(fraction - this.skyLevel) < 0.002) return;
    this.skyLevel = fraction;

    const fog = this.world.scene.fog as THREE.Fog | null;
    if (fog) {
      // Fog must match the horizon band, or the terrain edge cuts against it
      // — but against the horizon *as drawn*, which the dome darkens as it
      // approaches the ground. Matching the raw uniform instead washes the
      // whole surface out to a flat pale sheet, which is what it did.
      this.skydome.horizonColour(fog.color, fraction).multiplyScalar(0.62);
      // Visibility opens up as the world lights: dusk hides the far side.
      const horizon = horizonDistance(PLANET_RADIUS, PLAYER_HEIGHT);
      fog.near = horizon * (1.1 + fraction * 0.5);
      fog.far = horizon * (5.5 + fraction * 2.5);
    }

    if (this.stars) {
      const material = this.stars.material as THREE.PointsMaterial;
      material.opacity = Math.max(0, 1 - fraction * 0.85);
    }
  }

  /** A mote burst at every lamp in a district as it wakes. */
  private burstDistrict(district: DistrictId): void {
    const lamps = this.lampGroups.get(district);
    if (!lamps) return;

    const colour = new THREE.Color(this.districts.get(district).def.litColour);
    for (const light of lamps.lights) {
      const position = new THREE.Vector3();
      light.getWorldPosition(position);
      _emitUp.copy(position).normalize();

      this.particles.emit({
        position,
        count: 14,
        colour,
        speed: [0.9, 2.6],
        life: [1.0, 2.1],
        size: [0.10, 0.20],
        direction: _emitUp,
        spread: 0.7,
        gravity: _emitUp.clone().multiplyScalar(-1.4),
        drag: 0.55,
      });
    }
  }

  /** The lighthouse lamp tracks The Spire's illumination. */
  private updateLighthouse(): void {
    if (!this.lighthouse) return;
    const level = this.districts.get('spire').light;
    const material = this.lighthouse.lamp.material as THREE.MeshToonMaterial;
    material.emissiveIntensity = level * 3;
    // Same physical-units correction as the street lamps, and more of it: the
    // lighthouse is the one landmark meant to be visible across the district.
    this.lighthouse.light.intensity = level * 300;
  }

  // ── per-frame helpers ───────────────────────────────────────────────────

  /** A slow high orbit of the planet, framing it whole behind the menu. */
  private updateMenuCamera(dt: number): void {
    this.menuOrbit += dt * 0.06;

    const camera = this.renderer.camera;
    // Far enough that the whole planet sits in frame with sky around it — the
    // menu shot is selling "this world is small", so it has to fit.
    const radius = PLANET_RADIUS + 78;
    camera.position.set(
      Math.cos(this.menuOrbit) * radius,
      PLANET_RADIUS * 0.3,
      Math.sin(this.menuOrbit) * radius,
    );
    // A menu shot is a conventional framing, so world up is right here —
    // unlike gameplay, where up is local to the player's position.
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
  }

  private syncCharacterAnimation(dt: number): void {
    if (!this.character) return;

    // Hand the rig the body's actual motion before it poses anything. A
    // generated gait that cannot see the speed it is meant to be walking at
    // can only guess the cadence, and a guessed cadence slides.
    if (this.character.setLocomotion) {
      const position = this.player.object3D.position;
      _characterUp.copy(position).normalize();
      this.character.setLocomotion({
        speed: this.controller.planarSpeed,
        verticalSpeed: this.controller.velocity.dot(_characterUp),
        grounded: this.controller.grounded,
        turnRate: 0,
      });
    }

    this.character.update(dt);

    if (this.glide.isGliding) {
      this.character.play('glide');
      return;
    }

    switch (this.controller.state) {
      case 'idle':
        this.character.play(this.parcelVisual ? 'carry_idle' : 'idle');
        break;
      case 'walking':
        this.character.play(this.parcelVisual ? 'carry_walk' : 'walk');
        break;
      case 'running':
        this.character.play(this.parcelVisual ? 'carry_run' : 'run');
        break;
      case 'jumping':
        this.character.play('jump_start');
        break;
      case 'falling':
        this.character.play('fall');
        break;
      case 'landing':
        this.character.play('land');
        break;
    }
  }

  /**
   * Match the sprite's tint to the light where it is standing.
   *
   * Sprites are unlit, so without this the character stays fully bright while
   * the world around it is dusk and reads as pasted on. Driving the tint from
   * the district's illumination also makes the courier visibly warm up as the
   * planet lights, which serves the core hook rather than fighting it.
   */
  /**
   * A slow breathing sway on every resident.
   *
   * Perfectly still humanoids read as mannequins — worse than the capsules did,
   * because a person-shaped thing that never moves is uncanny in a way an
   * abstract shape is not. Two sine waves each is enough, and costs nothing.
   */
  private updateVillagers(dt: number): void {
    this.villagerSway += dt;
    for (const { rig, phase } of this.villagerRigs) {
      const t = this.villagerSway + phase;
      rig.torso.rotation.z = Math.sin(t * 0.7) * 0.022;
      rig.torso.position.y = Math.sin(t * 1.4) * 0.006;
      // An occasional glance around, so they seem to be waiting rather than
      // switched off.
      rig.head.rotation.y = Math.sin(t * 0.42) * 0.22;
      rig.armL.rotation.x = Math.sin(t * 0.7) * 0.05;
      rig.armR.rotation.x = -Math.sin(t * 0.7) * 0.05;
    }
  }

  /** Motes follow the player, and multiply as the district around them wakes. */
  private updateFireflies(dt: number): void {
    const runtime = this.districts.at(this.player.object3D.position);
    this.firefliesColour.set(runtime.def.litColour);
    this.fireflies.update(
      dt,
      this.controller.smoothedPosition,
      this.renderer.camera,
      runtime.light,
      this.firefliesColour,
    );
  }

  private updateCharacterTint(): void {
    if (!this.character?.setTint) return;
    const runtime = this.districts.at(this.player.object3D.position);
    _tint.copy(DUSK_TINT).lerp(LIT_TINT, runtime.light);
    this.character.setTint(_tint);
  }

  private trackDistrict(): void {
    const runtime = this.districts.at(this.player.object3D.position);
    if (runtime.def.id === this.currentDistrict) return;

    this.currentDistrict = runtime.def.id;
    this.bus.emit('district:entered', {
      district: runtime.def.id,
      displayName: runtime.def.displayName,
    });
    this.callbacks.onDistrictChanged?.(runtime.def.id, runtime.def.displayName);
  }

  private updateSun(): void {
    const position = this.player.object3D.position;
    _sunUp.copy(position).normalize();

    _sunTangent.set(0, 1, 0).projectOnPlane(_sunUp);
    if (_sunTangent.lengthSq() < 1e-6) _sunTangent.set(1, 0, 0).projectOnPlane(_sunUp);
    _sunTangent.normalize();

    _sunDir.copy(_sunUp).multiplyScalar(0.75).addScaledVector(_sunTangent, 0.66).normalize();

    this.sun.position.copy(position).addScaledVector(_sunDir, 70);
    this.sun.target.position.copy(position);
    this.sun.target.updateMatrixWorld();

    // Character lights ride with the camera, so she is lit from the side the
    // player is looking from however the camera is orbited. Both sit close to
    // her — their range is metres, not tens of metres, so the terrain and the
    // props around her stay as dark as the district's own illumination says.
    this.renderer.camera.getWorldDirection(_camForward);
    _fillRight.copy(_sunUp).cross(_camForward).normalize();
    const chest = _lightAnchor.copy(position).addScaledVector(_sunUp, PLAYER_HEIGHT * 0.75);

    this.characterFill.position
      .copy(chest)
      .addScaledVector(_camForward, -1.6)
      .addScaledVector(_fillRight, 1.5)
      .addScaledVector(_sunUp, 1.2);

    this.characterRim.position
      .copy(chest)
      .addScaledVector(_camForward, 1.5)
      .addScaledVector(_fillRight, -1.6)
      .addScaledVector(_sunUp, 1.0);
  }

  private addStars(scene: THREE.Scene): void {
    this.stars = createStarfield();
    scene.add(this.stars);
  }

  /**
   * Horizon culling: on a sphere everything on the far side is provably
   * invisible, so one dot product per object removes roughly half the scene
   * before the frustum test runs.
   */
  private cullBelowHorizon(): void {
    const viewer = this.controller.smoothedPosition;
    for (const object of this.cullables) {
      object.visible = shouldBeVisible(object, viewer, PLANET_RADIUS);
    }
  }
}
