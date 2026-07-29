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
import { shouldBeVisible } from '@core/math/spherical';
import { PLANET_RADIUS } from '@config/constants';

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

import { DISTRICTS, NPCS, npcById, type DistrictId, type ParcelWeight } from '../../data/content';

const _forward = new THREE.Vector3();
const _sunUp = new THREE.Vector3();
const _sunTangent = new THREE.Vector3();
const _sunDir = new THREE.Vector3();
const _charFacing = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _tint = new THREE.Color();
const DUSK_TINT = new THREE.Color('#7f8aa8');
const LIT_TINT = new THREE.Color('#ffffff');
const _emitUp = new THREE.Vector3();
const _emitPos = new THREE.Vector3();
const DUST_COLOUR = new THREE.Color('#b9ae94');
/** Matches the shard mesh's emissive, so the burst reads as the shard itself. */
const SHARD_COLOUR = new THREE.Color('#f6bd60');
const _skyColour = new THREE.Color();
const SKY_DUSK = new THREE.Color('#141724');
const SKY_LIT = new THREE.Color('#413a5c');

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
  private lighthouse: { lamp: THREE.Mesh; light: THREE.PointLight } | null = null;
  private stars: THREE.Points | null = null;
  private skyLevel = -1;

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

  setCharacter(character: LoadedCharacter): void {
    this.character?.dispose();
    this.character = character;
    for (const child of [...this.player.object3D.children]) {
      if (child !== this.parcelVisual?.group) this.player.object3D.remove(child);
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

  get cameraForward(): THREE.Vector3 {
    return this.renderer.camera.getWorldDirection(_camForward);
  }

  // ── construction ────────────────────────────────────────────────────────

  private buildEnvironment(): void {
    const scene = this.world.scene;
    scene.background = new THREE.Color('#141724');
    scene.fog = new THREE.Fog('#1b2033', 40, 190);

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
      const body = createVillager(npc.colour);
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
    this.parcelVisual.glow.intensity = 3 + warmth * 4;
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
    if (Math.abs(fraction - this.skyLevel) < 0.002) return;
    this.skyLevel = fraction;

    _skyColour.copy(SKY_DUSK).lerp(SKY_LIT, fraction);
    (this.world.scene.background as THREE.Color)?.copy(_skyColour);

    const fog = this.world.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.copy(_skyColour);
      // Visibility opens up as the world lights: dusk hides the far side.
      fog.near = 40 + fraction * 30;
      fog.far = 190 + fraction * 90;
    }

    if (this.stars) {
      const material = this.stars.material as THREE.PointsMaterial;
      material.opacity = 1 - fraction * 0.75;
      material.transparent = true;
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
    this.lighthouse.light.intensity = level * 40;
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
  }

  private addStars(scene: THREE.Scene): void {
    const count = 900;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const radius = 240 + Math.random() * 40;
      positions[i * 3] = r * Math.cos(theta) * radius;
      positions[i * 3 + 1] = u * radius;
      positions[i * 3 + 2] = r * Math.sin(theta) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: 0xcfd6ee, size: 1.1, sizeAttenuation: false }),
    );
    this.stars.name = 'stars';
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
