import * as THREE from 'three';
import type { EventBus } from '@core/events/EventBus';
import { createWorldMaterial } from '@engine/render/WorldMaterial';
import type { BvhWorld } from '@engine/physics/BvhWorld';
import { SEA_LEVEL_RADIUS } from '@config/constants';
import type { InteractionSystem } from '@game/systems/InteractionSystem';
import type { JournalSystem } from '@game/systems/JournalSystem';
import { PlanetTerrain } from './PlanetTerrain';
import { surfacePoint, surfaceQuaternion } from './placement';
import type { MinimapMarker } from './mapMarkers';
import type { GeoPoint } from '../../data/content';
import {
  COURSES,
  POSTCARDS,
  SOUVENIRS,
  STAMPS,
  type CourseDef,
  type PostcardDef,
  type SouvenirDef,
} from '../../data/activities';

/** What the activities need to know about the rest of the world. */
export interface ActivityWorld {
  scene: THREE.Scene;
  bus: EventBus;
  interaction: InteractionSystem;
  journal: JournalSystem;
  collision: BvhWorld;
  /** Named places a postcard can ask for. */
  landmarks: Record<'lighthouse' | 'seaTorii' | 'shrine', THREE.Vector3 | null>;
  /** Where each resident stands. */
  residents: ReadonlyMap<string, THREE.Object3D>;
  /** Where the cats are. */
  cats: () => THREE.Vector3[];
  /** Unit vector along the ground toward the mountain. */
  mountain: () => THREE.Vector3;
  /** Things that hide and show with the horizon. */
  cullables: THREE.Object3D[];
}

const GATE_RADIUS = 2.4;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const _forward = new THREE.Vector3();

/**
 * The nearest dry ground to an authored point.
 *
 * Content is written as latitude and longitude by someone looking at a debug
 * readout; a keepsake that lands a metre into the lagoon should move, not
 * drown. A spiral outward, first point comfortably above the waterline.
 */
export function landPoint(at: GeoPoint, lift = 0): THREE.Vector3 {
  const origin = surfacePoint(at, 0);
  const dry = (p: THREE.Vector3): boolean => PlanetTerrain.heightAt(p) > SEA_LEVEL_RADIUS + 0.45;
  if (dry(origin)) return origin.addScaledVector(origin.clone().normalize(), lift);

  const up = origin.clone().normalize();
  const along = new THREE.Vector3(0, 1, 0).projectOnPlane(up);
  if (along.lengthSq() < 1e-6) along.set(1, 0, 0).projectOnPlane(up);
  along.normalize();
  const side = up.clone().cross(along);
  for (let ring = 1.5; ring <= 30; ring += 1.5) {
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const direction = origin
        .clone()
        .addScaledVector(along, Math.cos(angle) * ring)
        .addScaledVector(side, Math.sin(angle) * ring)
        .normalize();
      if (dry(direction)) return direction.multiplyScalar(PlanetTerrain.heightAt(direction) + lift);
    }
  }
  return origin.addScaledVector(up, lift);
}

/** A square of paper with one character on it, as a texture. */
function sealTexture(character: string, ink: string, paper: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = '700 72px "Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(character, 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A stamp stand: a little roofed desk with the place's seal hung over it. */
function buildStampStand(seal: string): { group: THREE.Group; sign: THREE.Mesh } {
  const group = new THREE.Group();
  group.name = 'stamp-stand';
  const wood = createWorldMaterial({ color: '#6b4a33' });
  const dark = createWorldMaterial({ color: '#3d2c22' });
  const red = createWorldMaterial({ color: '#c8402f' });

  const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.0, 0.14), wood);
  post.position.y = 0.5;
  const desk = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.46), wood);
  desk.position.set(0, 1.02, 0);
  desk.rotation.x = -0.22;
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.14), dark);
  pad.position.set(-0.14, 1.08, 0.02);
  const hanko = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.15, 10), red);
  hanko.position.set(0.14, 1.13, 0.02);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.3, 4), dark);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 1.95;
  const poleL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), wood);
  poleL.position.set(-0.3, 1.45, -0.18);
  const poleR = poleL.clone();
  poleR.position.x = 0.3;

  const texture = sealTexture(seal, '#b5301f', '#f4ecd8');
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, 0.44),
    new THREE.MeshBasicMaterial({ map: texture, color: texture ? 0xffffff : 0xf4ecd8, side: THREE.DoubleSide }),
  );
  sign.position.set(0, 1.58, -0.17);
  // Two faces, each reading the right way round: a single double-sided plane
  // shows its character mirrored from behind.
  const back = sign.clone();
  back.rotation.y = Math.PI;
  back.position.set(0, 0, -0.004);
  sign.add(back);
  (sign.material as THREE.MeshBasicMaterial).side = THREE.FrontSide;

  for (const mesh of [post, desk, pad, hanko, roof, poleL, poleR]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.add(sign);
  return { group, sign };
}

/** A keepsake, as a few primitives: small, bright, and recognisable from above. */
function buildSouvenir(def: SouvenirDef): THREE.Group {
  const group = new THREE.Group();
  group.name = 'souvenir';
  const main = createWorldMaterial({ color: def.colour, emissive: def.colour, emissiveIntensity: 0.25 });
  const ink = createWorldMaterial({ color: '#2a2230' });
  const gold = createWorldMaterial({ color: '#e0b040', emissive: '#e0b040', emissiveIntensity: 0.3 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };

  switch (def.shape) {
    case 'daruma':
      add(new THREE.SphereGeometry(0.17, 14, 10), main).scale.set(1, 1.08, 1);
      add(new THREE.SphereGeometry(0.1, 12, 8), createWorldMaterial({ color: '#f1e3d0' }), 0, 0.03, 0.1);
      add(new THREE.SphereGeometry(0.022, 8, 6), ink, -0.04, 0.05, 0.19);
      break;
    case 'cat':
      add(new THREE.CapsuleGeometry(0.11, 0.12, 4, 10), main);
      add(new THREE.SphereGeometry(0.1, 12, 8), main, 0, 0.19, 0);
      add(new THREE.ConeGeometry(0.035, 0.07, 4), main, -0.06, 0.29, 0);
      add(new THREE.ConeGeometry(0.035, 0.07, 4), main, 0.06, 0.29, 0);
      add(new THREE.CapsuleGeometry(0.025, 0.1, 3, 6), main, 0.13, 0.14, 0.02);
      add(new THREE.TorusGeometry(0.075, 0.016, 6, 14), createWorldMaterial({ color: '#c8402f' }), 0, 0.11, 0).rotation.x = Math.PI / 2;
      break;
    case 'kokeshi':
      add(new THREE.CylinderGeometry(0.07, 0.085, 0.26, 12), main, 0, -0.03, 0);
      add(new THREE.SphereGeometry(0.1, 12, 10), main, 0, 0.17, 0);
      add(new THREE.SphereGeometry(0.102, 12, 6, 0, Math.PI * 2, 0, 1.1), ink, 0, 0.17, 0);
      add(new THREE.CylinderGeometry(0.073, 0.08, 0.05, 12), createWorldMaterial({ color: '#c8402f' }), 0, 0.0, 0);
      break;
    case 'chime':
      add(new THREE.SphereGeometry(0.12, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), main, 0, 0.12, 0);
      add(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4), ink, 0, -0.02, 0);
      add(new THREE.BoxGeometry(0.07, 0.2, 0.004), createWorldMaterial({ color: '#f4ecd8' }), 0, -0.2, 0);
      break;
    case 'charm':
      add(new THREE.BoxGeometry(0.16, 0.24, 0.035), main);
      add(new THREE.BoxGeometry(0.1, 0.13, 0.04), gold, 0, -0.01, 0);
      add(new THREE.TorusGeometry(0.035, 0.008, 5, 12), gold, 0, 0.15, 0);
      break;
    case 'fan': {
      const fan = add(new THREE.CircleGeometry(0.24, 16, Math.PI * 0.18, Math.PI * 0.64), main, 0, -0.1, 0);
      (fan.material as THREE.MeshToonMaterial).side = THREE.DoubleSide;
      add(new THREE.CircleGeometry(0.11, 12, Math.PI * 0.18, Math.PI * 0.64), createWorldMaterial({ color: '#3f78b8', side: THREE.DoubleSide }), 0, -0.1, 0.004);
      break;
    }
    case 'top':
      add(new THREE.ConeGeometry(0.15, 0.2, 14), main, 0, 0, 0).rotation.x = Math.PI;
      add(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 14), createWorldMaterial({ color: '#c8402f' }), 0, 0.11, 0);
      add(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 6), ink, 0, 0.19, 0);
      break;
    case 'fox':
      add(new THREE.SphereGeometry(0.15, 12, 10), main).scale.set(1, 1.05, 0.45);
      add(new THREE.ConeGeometry(0.05, 0.13, 4), main, -0.09, 0.18, 0);
      add(new THREE.ConeGeometry(0.05, 0.13, 4), main, 0.09, 0.18, 0);
      add(new THREE.ConeGeometry(0.04, 0.1, 4), createWorldMaterial({ color: '#c8402f' }), 0, -0.07, 0.07).rotation.x = Math.PI / 2;
      add(new THREE.SphereGeometry(0.02, 6, 6), ink, -0.055, 0.04, 0.065);
      add(new THREE.SphereGeometry(0.02, 6, 6), ink, 0.055, 0.04, 0.065);
      break;
  }

  // A ring of light on the ground under it, so it reads as something to find.
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.4, 28),
    new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.52;
  halo.name = 'halo';
  group.add(halo);
  return group;
}

/** A paper lantern on a post, and the ring to run through. */
function buildGate(): { group: THREE.Group; paper: THREE.MeshToonMaterial; ring: THREE.MeshBasicMaterial } {
  const group = new THREE.Group();
  group.name = 'course-gate';
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.6, 0.08), createWorldMaterial({ color: '#4a3526' }));
  post.position.y = 1.3;
  const paper = createWorldMaterial({ color: '#f1e6cf', emissive: '#ff9d3c', emissiveIntensity: 0 });
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.46, 12), paper);
  lantern.position.y = 2.75;
  const ring = new THREE.MeshBasicMaterial({ color: '#ffb44a', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const hoop = new THREE.Mesh(new THREE.RingGeometry(GATE_RADIUS - 0.12, GATE_RADIUS, 40), ring);
  hoop.rotation.x = -Math.PI / 2;
  hoop.position.y = 0.12;
  group.add(post, lantern, hoop);
  return { group, paper, ring };
}

function buildBell(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'course-bell';
  const wood = createWorldMaterial({ color: '#8a3b2c' });
  const bronze = createWorldMaterial({ color: '#8f7a3c', emissive: '#5a4a1c', emissiveIntensity: 0.4 });
  for (const x of [-0.45, 0.45]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.0, 0.12), wood);
    post.position.set(x, 1.0, 0);
    post.castShadow = true;
    group.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.16), wood);
  beam.position.y = 2.0;
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.25, 0.42, 14), bronze);
  bell.position.y = 1.62;
  bell.name = 'bell';
  group.add(beam, bell);
  return group;
}

interface RunningCourse {
  def: CourseDef;
  next: number;
  seconds: number;
}

/**
 * The things to do on the planet: stamp stands, mislaid keepsakes, a timed
 * round of lanterns, and what a camera can be pointed at.
 *
 * It builds their places in the world and runs their rules; what is *in* them
 * is `data/activities.ts`, and what the player has done is the journal's.
 */
export class Activities {
  private readonly souvenirs = new Map<string, { def: SouvenirDef; object: THREE.Group; position: THREE.Vector3 }>();
  private readonly stamps = new Map<string, { sign: THREE.Mesh; position: THREE.Vector3 }>();
  private readonly courses = new Map<
    string,
    {
      def: CourseDef;
      bell: THREE.Group;
      start: THREE.Vector3;
      gates: Array<{ position: THREE.Vector3; paper: THREE.MeshToonMaterial; ring: THREE.MeshBasicMaterial }>;
    }
  >();
  private running: RunningCourse | null = null;
  private clock = 0;
  private tickClock = 0;
  private framed: PostcardDef | null = null;

  constructor(private readonly world: ActivityWorld) {
    this.buildStamps();
    this.buildSouvenirs();
    this.buildCourses();
    this.refresh();
  }

  /** Show the world as the journal has it: found keepsakes gone, stamps taken. */
  refresh(): void {
    const { journal, interaction } = this.world;
    for (const [id, entry] of this.souvenirs) {
      const found = journal.has('souvenir', id);
      entry.object.userData.hidden = found;
      entry.object.visible = !found;
      interaction.setEnabled(`souvenir:${id}`, !found);
    }
    for (const [id, entry] of this.stamps) {
      const taken = journal.has('stamp', id);
      (entry.sign.material as THREE.MeshBasicMaterial).color.set(taken ? '#cfc4ad' : '#ffffff');
      interaction.setEnabled(`stamp:${id}`, !taken);
    }
  }

  /** Abandon anything in progress; the journal is reset by its owner. */
  reset(): void {
    this.stopCourse(false);
    this.refresh();
  }

  get courseRunning(): boolean {
    return this.running !== null;
  }

  update(dt: number, player: THREE.Vector3): void {
    this.clock += dt;

    for (const entry of this.souvenirs.values()) {
      if (!entry.object.visible) continue;
      entry.object.rotation.y = this.clock * 1.1;
      const lift = Math.sin(this.clock * 2 + entry.position.x) * 0.05;
      entry.object.position.copy(entry.position).addScaledVector(_a.copy(entry.position).normalize(), lift);
    }
    for (const [id, entry] of this.stamps) {
      if (this.world.journal.has('stamp', id)) continue;
      entry.sign.position.y = 1.58 + Math.sin(this.clock * 2.2) * 0.03;
    }

    const run = this.running;
    if (!run) return;
    run.seconds += dt;
    const course = this.courses.get(run.def.id)!;
    const gate = course.gates[run.next]!;
    // The next lantern breathes, so it can be picked out across the village.
    gate.paper.emissiveIntensity = 2.2 + Math.sin(this.clock * 6) * 0.6;
    gate.ring.opacity = 0.55 + Math.sin(this.clock * 6) * 0.2;

    this.tickClock += dt;
    if (this.tickClock > 0.1) {
      this.tickClock = 0;
      this.world.bus.emit('course:tick', { seconds: run.seconds, gate: run.next, gates: course.gates.length });
    }

    if (player.distanceToSquared(gate.position) < GATE_RADIUS * GATE_RADIUS) {
      gate.paper.emissiveIntensity = 1.2;
      gate.ring.opacity = 0;
      run.next++;
      this.world.bus.emit('course:gate', { index: run.next, gates: course.gates.length, seconds: run.seconds });
      if (run.next >= course.gates.length) this.finishCourse();
    } else if (run.seconds > run.def.bronze * 2.5) {
      // Wandered off. No failure, no scolding: the lanterns simply go out.
      this.stopCourse(true);
    }
  }

  /** Where the next lantern of a running course is, for the compass. */
  get courseTarget(): THREE.Vector3 | null {
    const run = this.running;
    if (!run) return null;
    return this.courses.get(run.def.id)?.gates[run.next]?.position ?? null;
  }

  /** Markers for the dial. Keepsakes only once she has the compass for them. */
  markers(showFinds: boolean): MinimapMarker[] {
    const markers: MinimapMarker[] = [];
    for (const [id, entry] of this.stamps) {
      if (!this.world.journal.has('stamp', id)) markers.push({ position: entry.position, kind: 'stamp' });
    }
    if (showFinds) {
      for (const [id, entry] of this.souvenirs) {
        if (!this.world.journal.has('souvenir', id)) markers.push({ position: entry.position, kind: 'souvenir' });
      }
    }
    for (const course of this.courses.values()) markers.push({ position: course.start, kind: 'course' });
    return markers;
  }

  // ── postcards ────────────────────────────────────────────────────────────

  /**
   * What the camera is framing, if it is something the journal asks for.
   * A picture she has not taken yet wins over one she has.
   */
  frame(camera: THREE.PerspectiveCamera): PostcardDef | null {
    camera.updateMatrixWorld();
    camera.getWorldDirection(_forward);
    let best: PostcardDef | null = null;
    for (const card of POSTCARDS) {
      if (!this.inFrame(card, camera)) continue;
      const taken = this.world.journal.has('postcard', card.id);
      if (!taken) {
        best = card;
        break;
      }
      best ??= card;
    }
    if (best !== this.framed) {
      this.framed = best;
      this.world.bus.emit('photo:framed', {
        id: best?.id ?? null,
        title: best?.title ?? null,
        taken: best ? this.world.journal.has('postcard', best.id) : false,
      });
    }
    return best;
  }

  /** Press the shutter. Returns the card it filled, if any. */
  shoot(camera: THREE.PerspectiveCamera): PostcardDef | null {
    const card = this.frame(camera);
    const fresh = card ? this.world.journal.add('postcard', card.id) : false;
    this.world.bus.emit('photo:taken', { id: card?.id ?? null, title: card?.title ?? null, fresh });
    if (card && fresh) {
      this.world.bus.emit('journal:found', { kind: 'postcard', title: card.title, note: 'A postcard for the journal.' });
    }
    this.framed = null;
    return card;
  }

  private inFrame(card: PostcardDef, camera: THREE.PerspectiveCamera): boolean {
    const eye = camera.position;
    const subject = card.subject;

    if (subject.kind === 'mountain') {
      // The summit stands about twelve degrees up, a long way off.
      const up = _a.copy(eye).normalize();
      const toward = _b.copy(this.world.mountain()).multiplyScalar(0.985).addScaledVector(up, 0.17).normalize();
      if (_forward.dot(toward) < Math.cos(THREE.MathUtils.degToRad(11))) return false;
      return this.world.collision.raycast(eye, toward, 80) === null;
    }

    const points: THREE.Vector3[] = [];
    if (subject.kind === 'landmark') {
      const place = this.world.landmarks[subject.landmark];
      if (place) {
        const lift = subject.landmark === 'lighthouse' ? 8 : subject.landmark === 'seaTorii' ? 4 : 2.4;
        points.push(place.clone().addScaledVector(place.clone().normalize(), lift));
      }
    } else if (subject.kind === 'cat') {
      for (const cat of this.world.cats()) points.push(cat.clone().addScaledVector(cat.clone().normalize(), 0.2));
    } else {
      const resident = this.world.residents.get(subject.npc);
      if (resident) points.push(resident.position.clone().addScaledVector(resident.position.clone().normalize(), 1.2));
    }

    const within = card.within ?? 30;
    for (const point of points) {
      const distance = point.distanceTo(eye);
      if (distance > within) continue;
      _ndc.copy(point).project(camera);
      if (_ndc.z > 1 || Math.abs(_ndc.x) > 0.6 || Math.abs(_ndc.y) > 0.65) continue;
      const toPoint = _b.copy(point).sub(eye).normalize();
      if (_forward.dot(toPoint) < 0) continue;
      // The ground between is the only thing that can hide it from here.
      const hit = this.world.collision.raycast(eye, toPoint, distance);
      if (hit && hit.distance < distance - 1.5) continue;
      return true;
    }
    return false;
  }

  // ── construction ─────────────────────────────────────────────────────────

  private buildStamps(): void {
    for (const def of STAMPS) {
      const position = landPoint(def.at);
      const { group, sign } = buildStampStand(def.seal);
      group.position.copy(position);
      group.quaternion.copy(surfaceQuaternion(position));
      this.world.scene.add(group);
      this.world.cullables.push(group);
      this.stamps.set(def.id, { sign, position });

      this.world.interaction.register({
        id: `stamp:${def.id}`,
        position,
        radius: 2.2,
        prompt: 'Stamp your journal',
        enabled: true,
        onInteract: () => {
          if (!this.world.journal.add('stamp', def.id)) return;
          this.world.bus.emit('journal:found', { kind: 'stamp', title: def.name, note: def.note, seal: def.seal });
          this.refresh();
        },
      });
    }
  }

  private buildSouvenirs(): void {
    for (const def of SOUVENIRS) {
      const position = landPoint(def.at, 0.55);
      const object = buildSouvenir(def);
      object.position.copy(position);
      object.quaternion.copy(surfaceQuaternion(position));
      this.world.scene.add(object);
      this.world.cullables.push(object);
      this.souvenirs.set(def.id, { def, object, position });

      this.world.interaction.register({
        id: `souvenir:${def.id}`,
        position,
        radius: 1.9,
        prompt: 'Pick up',
        enabled: true,
        onInteract: () => {
          if (!this.world.journal.add('souvenir', def.id)) return;
          this.world.bus.emit('journal:found', { kind: 'souvenir', title: def.name, note: def.note });
          this.refresh();
        },
      });
    }
  }

  private buildCourses(): void {
    for (const def of COURSES) {
      const start = landPoint(def.start);
      const bell = buildBell();
      bell.position.copy(start);
      bell.quaternion.copy(surfaceQuaternion(start));
      this.world.scene.add(bell);
      this.world.cullables.push(bell);

      const gates = def.gates.map((at) => {
        const position = landPoint(at);
        const { group, paper, ring } = buildGate();
        group.position.copy(position);
        group.quaternion.copy(surfaceQuaternion(position));
        this.world.scene.add(group);
        this.world.cullables.push(group);
        return { position, paper, ring };
      });
      this.courses.set(def.id, { def, bell, start, gates });

      this.world.interaction.register({
        id: `course:${def.id}`,
        position: start,
        radius: 2.4,
        prompt: 'Ring the bell',
        enabled: true,
        onInteract: () => this.startCourse(def),
      });
    }
  }

  private startCourse(def: CourseDef): void {
    this.stopCourse(false);
    const course = this.courses.get(def.id)!;
    for (const gate of course.gates) {
      gate.paper.emissiveIntensity = 0;
      gate.ring.opacity = 0;
    }
    this.running = { def, next: 0, seconds: 0 };
    this.world.bus.emit('course:started', { id: def.id, name: def.name, gates: course.gates.length });
  }

  private finishCourse(): void {
    const run = this.running;
    if (!run) return;
    this.running = null;
    const result = this.world.journal.finishCourse(run.def.id, run.seconds);
    this.world.bus.emit('course:finished', {
      id: run.def.id,
      seconds: run.seconds,
      medal: result.medal,
      best: result.best,
    });
  }

  private stopCourse(announce: boolean): void {
    const run = this.running;
    if (!run) return;
    this.running = null;
    const course = this.courses.get(run.def.id)!;
    for (const gate of course.gates) {
      gate.paper.emissiveIntensity = 0;
      gate.ring.opacity = 0;
    }
    if (announce) this.world.bus.emit('course:abandoned', { id: run.def.id });
  }
}
