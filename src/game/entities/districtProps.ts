import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createToonMaterial } from '@engine/render/ToonMaterial';
import { makeRng } from '@core/math/rng';
import type { DistrictId } from '../../data/content';

/**
 * District silhouettes.
 *
 * Each district needs to be recognisable from its shape alone, because the
 * horizon is 13.5 m away and the player navigates by landmarks cresting into
 * view (Pillar 3). These are procedural stand-ins for authored art, but the
 * *silhouettes* are the real design: round canopies for the wood, verticals and
 * pipes for the plant, low decks for the shore, one tall spire at the pole.
 *
 * All geometry is merged per prop type and drawn with `InstancedMesh`, so a
 * district costs one draw call per prop kind rather than one per object.
 */

export interface PropSet {
  /** One instanced mesh per prop kind. */
  meshes: THREE.InstancedMesh[];
  /** Placement is caller-supplied; this only builds the meshes. */
}

const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _bitangent = new THREE.Vector3();
const _tint = new THREE.Color();

/** Orientation whose +Y is the surface normal, with a yaw about it. */
function orientTo(position: THREE.Vector3, yaw: number): THREE.Quaternion {
  _up.copy(position).normalize();
  _tangent.set(0, 1, 0).projectOnPlane(_up);
  if (_tangent.lengthSq() < 1e-6) _tangent.set(1, 0, 0).projectOnPlane(_up);
  _tangent.normalize().applyAxisAngle(_up, yaw);
  _bitangent.copy(_up).cross(_tangent).normalize();
  return _quat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(_bitangent, _up, _tangent));
}

export interface InstanceOptions {
  /** Uniform scale range, applied to every axis. */
  scaleRange?: [number, number];
  /**
   * Extra per-axis jitter on top of the uniform scale, as a fraction.
   *
   * A uniform scale makes every instance the *same shape at a different size*,
   * which is why a street of cottages read as one cottage stamped nine times.
   * Letting height vary independently of footprint is the cheapest thing that
   * gives a district a skyline.
   */
  stretch?: { x?: number; y?: number; z?: number };
  /**
   * Per-instance colour jitter, as a fraction. Multiplies the material colour
   * through `instanceColor`, so there is no extra material and no extra draw
   * call — a row of nine huts just stops being nine identical swatches.
   */
  tint?: number;
}

/**
 * Build one instanced mesh.
 *
 * **The rng is consumed in a fixed order regardless of which options are set.**
 * Parts of the same prop — a wall and its roof — are separate instanced meshes
 * built from the same seed, and they stay aligned *only* because they draw the
 * same random numbers in the same sequence. Skipping a draw when an option is
 * absent would slide every roof off its wall.
 */
function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  positions: THREE.Vector3[],
  seed: number,
  options: InstanceOptions | [number, number] = {},
): THREE.InstancedMesh {
  const opts: InstanceOptions = Array.isArray(options) ? { scaleRange: options } : options;
  const [lo, hi] = opts.scaleRange ?? [0.85, 1.25];

  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, positions.length));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.count = positions.length;

  const base = (material as THREE.Material & { color?: THREE.Color }).color;

  const rng = makeRng(seed);
  positions.forEach((position, index) => {
    const scale = lo + rng() * (hi - lo);
    const yaw = rng() * Math.PI * 2;

    // Always drawn, never conditionally — see the note above.
    const jx = (rng() - 0.5) * 2;
    const jy = (rng() - 0.5) * 2;
    const jz = (rng() - 0.5) * 2;
    const jt = (rng() - 0.5) * 2;

    const s = opts.stretch;
    _scale.set(
      scale * (1 + jx * (s?.x ?? 0)),
      scale * (1 + jy * (s?.y ?? 0)),
      scale * (1 + jz * (s?.z ?? 0)),
    );

    _matrix.compose(position, orientTo(position, yaw), _scale);
    mesh.setMatrixAt(index, _matrix);

    if (opts.tint && base) {
      // instanceColor multiplies the material colour, so this stays a shade of
      // the authored colour rather than replacing it.
      const k = 1 + jt * opts.tint;
      _tint.setRGB(k, k * (1 + jt * opts.tint * 0.35), k * (1 - jt * opts.tint * 0.3));
      mesh.setColorAt(index, _tint);
    }
  });

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

/** Bramblewood: round canopies on short trunks. Reads as woodland at a glance. */
function buildTrees(positions: THREE.Vector3[], seed: number): THREE.InstancedMesh[] {
  const trunk = new THREE.CylinderGeometry(0.13, 0.19, 1.5, 6);
  trunk.translate(0, 0.75, 0);

  const canopy = new THREE.IcosahedronGeometry(1.05, 1);
  canopy.translate(0, 2.1, 0);

  const shape: InstanceOptions = {
    scaleRange: [0.9, 1.3],
    stretch: { x: 0.12, y: 0.28, z: 0.12 },
    tint: 0.16,
  };

  return [
    instanced(trunk, createToonMaterial({ color: '#4a3a2c' }), positions, seed, shape),
    instanced(canopy, createToonMaterial({ color: '#3f7d4a' }), positions, seed, shape),
  ];
}

/** The Coil: vertical pipes and squat tanks — industrial verticality. */
function buildPipes(positions: THREE.Vector3[], seed: number): THREE.InstancedMesh[] {
  const pipe = new THREE.CylinderGeometry(0.22, 0.22, 3.4, 8);
  pipe.translate(0, 1.7, 0);

  const collar = new THREE.TorusGeometry(0.3, 0.07, 6, 12);
  collar.rotateX(Math.PI / 2);
  collar.translate(0, 2.6, 0);

  const shape: InstanceOptions = {
    scaleRange: [0.7, 1.4],
    stretch: { y: 0.4 },
    tint: 0.1,
  };

  return [
    instanced(pipe, createToonMaterial({ color: '#5d6472' }), positions, seed, shape),
    instanced(collar, createToonMaterial({ color: '#8a6a3f' }), positions, seed, shape),
  ];
}

/** Tidebreak: low boardwalk decks and mooring posts. */
function buildBoardwalk(positions: THREE.Vector3[], seed: number): THREE.InstancedMesh[] {
  const deck = new THREE.BoxGeometry(2.6, 0.16, 1.4);
  deck.translate(0, 0.1, 0);

  const post = new THREE.CylinderGeometry(0.1, 0.1, 1.1, 6);
  post.translate(0, 0.55, 0);

  return [
    instanced(deck, createToonMaterial({ color: '#7a6248' }), positions, seed, [0.8, 1.2]),
    instanced(post, createToonMaterial({ color: '#5f4c38' }), positions, seed, [0.8, 1.2]),
  ];
}

/**
 * The Landing: mailbox plaza — small huts and posts.
 *
 * Every part shares one options object so they scale and rotate together; the
 * `y` stretch is what gives the row a skyline instead of nine identical boxes.
 */
function buildHuts(positions: THREE.Vector3[], seed: number): THREE.InstancedMesh[] {
  const wall = new THREE.BoxGeometry(1.6, 1.5, 1.6);
  wall.translate(0, 0.75, 0);

  const roof = new THREE.ConeGeometry(1.35, 0.9, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 1.95, 0);

  // A chimney is two dozen triangles and does more for a cottage silhouette
  // than any amount of surface detail would.
  const chimney = new THREE.BoxGeometry(0.3, 0.9, 0.3);
  chimney.translate(0.45, 2.1, -0.35);

  const shape: InstanceOptions = {
    scaleRange: [0.8, 1.15],
    stretch: { x: 0.16, y: 0.3, z: 0.16 },
    tint: 0.12,
  };

  return [
    instanced(wall, createToonMaterial({ color: '#8a7a63' }), positions, seed, shape),
    instanced(roof, createToonMaterial({ color: '#9c5f3c' }), positions, seed, shape),
    instanced(chimney, createToonMaterial({ color: '#7d6a55' }), positions, seed, shape),
  ];
}

/** Scatter rocks — used everywhere to break up empty ground. */
export function buildRocks(positions: THREE.Vector3[], seed: number): THREE.InstancedMesh {
  const rock = new THREE.DodecahedronGeometry(0.45, 0);
  rock.scale(1, 0.6, 1);
  rock.translate(0, 0.2, 0);
  return instanced(rock, createToonMaterial({ color: '#6b6a72' }), positions, seed, {
    scaleRange: [0.5, 1.5],
    stretch: { x: 0.3, y: 0.35, z: 0.3 },
    tint: 0.14,
  });
}

/**
 * Village fittings, shared by every district.
 *
 * The world had a distinct silhouette per district and *nothing between them* —
 * a stand of trees, then bare ground, then some pipes. Landmarks tell you which
 * district you are in; they do not make a place feel inhabited. These do: a
 * gate you walk under, a lantern someone lit, a stall someone runs.
 *
 * All four are built from primitives at the same low-poly weight as the rest of
 * the world, and each is one instanced draw. Nothing here is a texture.
 */
export function buildVillageSet(
  positions: THREE.Vector3[],
  seed: number,
): THREE.InstancedMesh[] {
  const shape: InstanceOptions = {
    scaleRange: [0.85, 1.2],
    stretch: { x: 0.1, y: 0.18, z: 0.1 },
    tint: 0.1,
  };

  // A gate. Two posts, a curved-up lintel and the second crossbar beneath it —
  // the whole silhouette is in that lintel, so it gets the flare.
  const gate = new THREE.BufferGeometry();
  {
    const parts: THREE.BufferGeometry[] = [];
    for (const x of [-0.9, 0.9]) {
      const post = new THREE.CylinderGeometry(0.11, 0.14, 3.0, 7);
      post.translate(x, 1.5, 0);
      parts.push(post);
    }
    const lintel = new THREE.BoxGeometry(2.5, 0.17, 0.34);
    lintel.translate(0, 3.0, 0);
    parts.push(lintel);
    const crossbar = new THREE.BoxGeometry(2.05, 0.12, 0.24);
    crossbar.translate(0, 2.6, 0);
    parts.push(crossbar);
    gate.copy(mergeGeometries(parts));
  }

  // A stone lantern: plinth, shaft, light box, flared cap.
  const lantern = new THREE.BufferGeometry();
  {
    const parts: THREE.BufferGeometry[] = [];
    const base = new THREE.CylinderGeometry(0.26, 0.32, 0.18, 6);
    base.translate(0, 0.09, 0);
    parts.push(base);
    const shaft = new THREE.CylinderGeometry(0.11, 0.13, 0.62, 6);
    shaft.translate(0, 0.49, 0);
    parts.push(shaft);
    const box = new THREE.CylinderGeometry(0.24, 0.24, 0.3, 6);
    box.translate(0, 0.95, 0);
    parts.push(box);
    const cap = new THREE.CylinderGeometry(0.06, 0.42, 0.24, 6);
    cap.translate(0, 1.22, 0);
    parts.push(cap);
    lantern.copy(mergeGeometries(parts));
  }

  // A market stall: counter, two posts, a sloped awning.
  const stall = new THREE.BufferGeometry();
  {
    const parts: THREE.BufferGeometry[] = [];
    const counter = new THREE.BoxGeometry(1.7, 0.75, 0.7);
    counter.translate(0, 0.38, 0);
    parts.push(counter);
    for (const x of [-0.78, 0.78]) {
      const post = new THREE.CylinderGeometry(0.05, 0.05, 1.9, 5);
      post.translate(x, 0.95, -0.28);
      parts.push(post);
    }
    const awning = new THREE.BoxGeometry(1.9, 0.08, 1.0);
    awning.rotateX(-0.32);
    awning.translate(0, 1.92, 0.06);
    parts.push(awning);
    stall.copy(mergeGeometries(parts));
  }

  // Split the spots between the three, deterministically.
  const rng = makeRng(seed ^ 0x5f3a);
  const forGate: THREE.Vector3[] = [];
  const forLantern: THREE.Vector3[] = [];
  const forStall: THREE.Vector3[] = [];
  for (const position of positions) {
    const roll = rng();
    if (roll < 0.18) forGate.push(position);
    else if (roll < 0.68) forLantern.push(position);
    else forStall.push(position);
  }

  return [
    instanced(gate, createToonMaterial({ color: '#9c4a3c' }), forGate, seed + 11, shape),
    instanced(lantern, createToonMaterial({ color: '#8f9098' }), forLantern, seed + 23, shape),
    instanced(stall, createToonMaterial({ color: '#7d6a52' }), forStall, seed + 37, {
      ...shape,
      tint: 0.18,
    }),
  ];
}

export function buildDistrictProps(
  district: DistrictId,
  positions: THREE.Vector3[],
  seed: number,
): THREE.InstancedMesh[] {
  switch (district) {
    case 'bramblewood':
      return buildTrees(positions, seed);
    case 'coil':
      return buildPipes(positions, seed);
    case 'tidebreak':
      return buildBoardwalk(positions, seed);
    case 'landing':
      return buildHuts(positions, seed);
    case 'spire':
      // The Spire's landmark is the lighthouse itself, built separately; the
      // ground around it stays deliberately bare so the tower dominates.
      return [buildRocks(positions, seed)];
  }
}

/**
 * The lighthouse at the pole — the game's one true landmark.
 *
 * Tall enough to crest the horizon from well outside its district, which is the
 * entire point: it is the thing you navigate the last delivery by.
 */
export function buildLighthouse(): { group: THREE.Group; lamp: THREE.Mesh; light: THREE.PointLight } {
  const group = new THREE.Group();
  group.name = 'lighthouse';

  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.9, 11, 10),
    createToonMaterial({ color: '#d9d2c4' }),
  );
  tower.position.y = 5.5;
  tower.castShadow = true;
  group.add(tower);

  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(1.16, 1.4, 2.2, 10),
    createToonMaterial({ color: '#b3543a' }),
  );
  band.position.y = 4.2;
  group.add(band);

  const gallery = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 0.35, 10),
    createToonMaterial({ color: '#4a4f60' }),
  );
  gallery.position.y = 11;
  group.add(gallery);

  const lamp = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.95, 1),
    createToonMaterial({
      color: '#3a3d52',
      emissive: '#f6e0b0',
      emissiveIntensity: 0,
    }),
  );
  lamp.position.y = 11.9;
  group.add(lamp);

  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(1.2, 1.4, 10),
    createToonMaterial({ color: '#4a4f60' }),
  );
  cap.position.y = 13.1;
  group.add(cap);

  // Decay 1.25, not the physical 2 — and here it matters far more than it does
  // on a street lamp.
  //
  // This light has to be seen from across a district *and* stood underneath.
  // Under strict inverse-square that is a range of maybe 5 m to 50 m, a 100:1
  // swing, and the intensity that reads from the far side turns anything
  // standing at its foot into a white cut-out. Which is exactly what it did.
  const light = new THREE.PointLight(0xf6e0b0, 0, 70, 1.25);
  light.position.y = 11.9;
  group.add(light);

  return { group, lamp, light };
}
