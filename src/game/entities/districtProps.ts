import * as THREE from 'three';
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

/** Orientation whose +Y is the surface normal, with a yaw about it. */
function orientTo(position: THREE.Vector3, yaw: number): THREE.Quaternion {
  _up.copy(position).normalize();
  _tangent.set(0, 1, 0).projectOnPlane(_up);
  if (_tangent.lengthSq() < 1e-6) _tangent.set(1, 0, 0).projectOnPlane(_up);
  _tangent.normalize().applyAxisAngle(_up, yaw);
  _bitangent.copy(_up).cross(_tangent).normalize();
  return _quat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(_bitangent, _up, _tangent));
}

function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  positions: THREE.Vector3[],
  seed: number,
  scaleRange: [number, number] = [0.85, 1.25],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, positions.length));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.count = positions.length;

  const rng = makeRng(seed);
  positions.forEach((position, index) => {
    const scale = scaleRange[0] + rng() * (scaleRange[1] - scaleRange[0]);
    _scale.set(scale, scale, scale);
    _matrix.compose(position, orientTo(position, rng() * Math.PI * 2), _scale);
    mesh.setMatrixAt(index, _matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** Bramblewood: round canopies on short trunks. Reads as woodland at a glance. */
function buildTrees(positions: THREE.Vector3[], seed: number): THREE.InstancedMesh[] {
  const trunk = new THREE.CylinderGeometry(0.13, 0.19, 1.5, 6);
  trunk.translate(0, 0.75, 0);

  const canopy = new THREE.IcosahedronGeometry(1.05, 1);
  canopy.translate(0, 2.1, 0);

  return [
    instanced(trunk, createToonMaterial({ color: '#4a3a2c' }), positions, seed, [0.9, 1.3]),
    instanced(canopy, createToonMaterial({ color: '#3f7d4a' }), positions, seed, [0.9, 1.3]),
  ];
}

/** The Coil: vertical pipes and squat tanks — industrial verticality. */
function buildPipes(positions: THREE.Vector3[], seed: number): THREE.InstancedMesh[] {
  const pipe = new THREE.CylinderGeometry(0.22, 0.22, 3.4, 8);
  pipe.translate(0, 1.7, 0);

  const collar = new THREE.TorusGeometry(0.3, 0.07, 6, 12);
  collar.rotateX(Math.PI / 2);
  collar.translate(0, 2.6, 0);

  return [
    instanced(pipe, createToonMaterial({ color: '#5d6472' }), positions, seed, [0.7, 1.4]),
    instanced(collar, createToonMaterial({ color: '#8a6a3f' }), positions, seed, [0.7, 1.4]),
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

/** The Landing: mailbox plaza — small huts and posts. */
function buildHuts(positions: THREE.Vector3[], seed: number): THREE.InstancedMesh[] {
  const wall = new THREE.BoxGeometry(1.6, 1.5, 1.6);
  wall.translate(0, 0.75, 0);

  const roof = new THREE.ConeGeometry(1.35, 0.9, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 1.95, 0);

  return [
    instanced(wall, createToonMaterial({ color: '#8a7a63' }), positions, seed, [0.8, 1.15]),
    instanced(roof, createToonMaterial({ color: '#9c5f3c' }), positions, seed, [0.8, 1.15]),
  ];
}

/** Scatter rocks — used everywhere to break up empty ground. */
export function buildRocks(positions: THREE.Vector3[], seed: number): THREE.InstancedMesh {
  const rock = new THREE.DodecahedronGeometry(0.45, 0);
  rock.scale(1, 0.6, 1);
  rock.translate(0, 0.2, 0);
  return instanced(rock, createToonMaterial({ color: '#6b6a72' }), positions, seed, [0.5, 1.5]);
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

  const light = new THREE.PointLight(0xf6e0b0, 0, 60, 2);
  light.position.y = 11.9;
  group.add(light);

  return { group, lamp, light };
}
